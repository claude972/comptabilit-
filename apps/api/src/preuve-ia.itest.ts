/**
 * Passerelle IA — preuve de connexion PERSISTÉE (`verifications_connexion_ia`) et statut qui en découle.
 *
 * AUCUN APPEL RÉEL : aucun jeton d'IA n'existe, et ce fichier n'en utilise aucun. Les « fournisseurs » sont, selon le
 * test : le SIMULATEUR du paquet, un faux serveur HTTP local qui imite l'API, ou un faux fournisseur écrit ici. Les
 * jetons et empreintes de configuration sont tirés au hasard à chaque exécution : aucune ligne écrite ici ne peut
 * correspondre à la configuration d'une pile réelle, et toutes sont supprimées à la fin.
 *
 * Ce que ces tests prouvent : le CÂBLAGE (la preuve est lue de la base, réévaluée, et commande l'emploi du modèle).
 * Ce qu'ils ne prouvent pas : qu'une connexion réelle au fournisseur fonctionne — cela n'a jamais été essayé.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type AccesBd, creerAccesBd, sql, urlBd } from '@comtaple/db';
import { type FournisseurIa, FournisseurOvh, HOTE_OFFICIEL_OVH, MODELES_IA, URL_BASE_OVH } from '@comtaple/ia';
import { SimulateurIa } from '@comtaple/ia/simulateur';
import { assemblerIa, creerIa, empreinteConfigurationIa, verifierConnexionIaConfiguree, verifierEtEnregistrerPreuveIa } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { API, jetons, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(6).toString('hex');
const JETON = `jeton-fictif-${SEL}`; // fictif : il ne sort jamais de cette machine
const EMPREINTE = empreinteConfigurationIa({ urlBase: URL_BASE_OVH, jeton: JETON });
const empreintes = new Set<string>([EMPREINTE]);
let admin: pg.Client;
let app: AccesBd;
let worker: AccesBd;
let cabinet = '';

/** Faux fournisseur « réel » sur l'hôte officiel : AUCUN réseau, il rend ce que le vrai service est censé rendre. */
function fauxFournisseurOfficiel(options: { modeleLangage?: string; dimensions?: number } = {}) {
  const completer = vi.fn(async (d: { modele: string }) => ({
    contenu: '{"a":"ok"}', appels: [], raisonFin: 'stop', usage: { jetonsEntree: 3, jetonsSortie: 2 }, modeleRenvoye: options.modeleLangage ?? d.modele, origine: { url: `${URL_BASE_OVH}/chat/completions`, simulateur: false },
  }));
  const vectoriser = vi.fn(async (d: { modele: string; textes: string[] }) => ({
    vecteurs: d.textes.map(() => Array.from({ length: options.dimensions ?? MODELES_IA.embeddings.dimensions }, () => 0.01)), usage: { jetonsEntree: 3 }, modeleRenvoye: d.modele, origine: { url: `${URL_BASE_OVH}/embeddings`, simulateur: false },
  }));
  const fournisseur = { nature: 'reel', nom: 'faux fournisseur de test', urlBase: URL_BASE_OVH, completer, vectoriser } as unknown as FournisseurIa;
  return { fournisseur, completer, vectoriser };
}

interface LigneForgee {
  empreinte?: string;
  resultat?: string;
  verifieeLe?: string;
  valideJusquAu?: string;
  urlBase?: string;
  hote?: string;
  urls?: string[];
  langage?: string | null;
  embeddings?: string | null;
  dimensions?: number | null;
  simulateur?: boolean;
}
/** Écrit une ligne directement en base avec le rôle d'administration (ce qu'un rôle applicatif ne peut pas faire). */
async function injecter(l: LigneForgee = {}): Promise<string> {
  const empreinte = l.empreinte ?? EMPREINTE;
  empreintes.add(empreinte);
  const r = await admin.query(
    `insert into verifications_connexion_ia (verifiee_le, resultat, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, reponse_simulateur, empreinte_configuration, valide_jusqu_au)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, coalesce($11::timestamptz, coalesce($1::timestamptz, now()) + interval '30 days')) returning id`,
    [
      l.verifieeLe ?? null, l.resultat ?? 'connecte', l.urlBase ?? URL_BASE_OVH, l.hote ?? HOTE_OFFICIEL_OVH, JSON.stringify(l.urls ?? [`${URL_BASE_OVH}/chat/completions`, `${URL_BASE_OVH}/embeddings`]),
      l.langage === undefined ? MODELES_IA.langage.id : l.langage, l.embeddings === undefined ? MODELES_IA.embeddings.id : l.embeddings, l.dimensions === undefined ? MODELES_IA.embeddings.dimensions : l.dimensions, l.simulateur ?? false, empreinte, l.valideJusquAu ?? null,
    ],
  );
  return r.rows[0].id;
}
const lignes = async (empreinte = EMPREINTE) => (await admin.query('select * from verifications_connexion_ia where empreinte_configuration = $1 order by verifiee_le, id', [empreinte])).rows;
const vider = async () => {
  for (const e of empreintes) await admin.query('delete from verifications_connexion_ia where empreinte_configuration = $1', [e]);
};
/** Assemble la passerelle comme le fait `creerIa`, sur le fournisseur donné, et relit la preuve en base. */
async function assembler(fournisseur: FournisseurIa | null, options: { bd?: AccesBd; empreinte?: string | null; maintenant?: () => Date; validiteJours?: number } = {}) {
  const ia = assemblerIa(options.bd ?? app, fournisseur, null, { empreinteConfiguration: options.empreinte === undefined ? EMPREINTE : options.empreinte, fraicheurMs: 0, ...(options.maintenant ? { maintenant: options.maintenant } : {}), ...(options.validiteJours ? { validiteJours: options.validiteJours } : {}) });
  await ia.rafraichirPreuve();
  return ia;
}
const tache = (ia: ReturnType<typeof assemblerIa>) => ia.active().completerJson({ tache: 'essai_preuve', prompt: null, contexte: { cabinetId: cabinet }, messages: [{ role: 'user', contenu: 'x' }], schema: z.strictObject({ a: z.string() }), nomSchema: 'essai' });

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  app = creerAccesBd(urlBd('app'), { max: 3 });
  worker = creerAccesBd(urlBd('worker'), { max: 2 });
  cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai preuve IA ${SEL} (fictif)`])).rows[0].id;
  await ouvrirSessions();
});
beforeEach(vider);
afterAll(async () => {
  await vider();
  await app.fermer();
  await worker.fermer();
  await admin.end();
});

describe('état réel : aucune IA configurée', () => {
  it('pile normale : « non_connecte », rien à vérifier, et AUCUNE route ne déclenche une vérification', async () => {
    const r = await fetch(`${API}/v1/ia`, { headers: { authorization: `Bearer ${jetons.alice}` } });
    const etat = (await r.json()) as any;
    expect(etat).toMatchObject({ statut: 'non_connecte', modeleSollicite: false, verification: { etat: 'sans_objet', verifieeLe: null, valideJusquAu: null, atteste: null } });
    expect(etat.verification.declenchement).toContain('ni automatique ni déclenchable');
    for (const [methode, chemin] of [['POST', '/v1/ia'], ['POST', '/v1/ia/verification'], ['PUT', '/v1/ia/verification'], ['POST', '/v1/ia/verifier'], ['GET', '/v1/ia/verification']] as const) {
      const essai = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${jetons.alice}`, 'content-type': 'application/json' }, ...(methode === 'GET' ? {} : { body: '{}' }) });
      expect(essai.status, `${methode} ${chemin}`).toBe(404);
    }
  });

  it('sans URL ou sans jeton : la vérification n’appelle rien et n’écrit rien ; `creerIa` ne lit même pas la table', async () => {
    const avant = (await admin.query('select count(*)::int as n from verifications_connexion_ia')).rows[0].n;
    for (const cfg of [{ IA_OVH_ENDPOINT: '', IA_OVH_JETON: '' }, { IA_OVH_ENDPOINT: URL_BASE_OVH, IA_OVH_JETON: '' }, { IA_OVH_ENDPOINT: '', IA_OVH_JETON: JETON }]) {
      expect(await verifierConnexionIaConfiguree(admin, cfg)).toMatchObject({ statut: 'non_connecte', enregistree: false, resultat: null, verification: null });
    }
    expect((await admin.query('select count(*)::int as n from verifications_connexion_ia')).rows[0].n).toBe(avant);
    // Même si une ligne « connecte » existait pour une configuration quelconque, sans fournisseur le statut ne bouge pas.
    await injecter();
    const ia = creerIa({ IA_OVH_ENDPOINT: '', IA_OVH_JETON: '', IA_TARIFS: '' }, app);
    await ia.rafraichirPreuve();
    expect(ia.statut().statut).toBe('non_connecte');
    expect(ia.preuve()).toBeNull();
    expect(ia.modeleUtilisable()).toBe(false);
  });
});

describe('vérification : jamais « connecté » hors de l’hôte officiel', () => {
  it('SIMULATEUR : statut « simulé », aucune ligne écrite — et une preuve « valide » en base n’y change rien', async () => {
    const sim = new SimulateurIa().programmerParDefaut({ texte: 'OK' });
    const r = await verifierEtEnregistrerPreuveIa(admin, { fournisseur: sim, empreinteConfiguration: EMPREINTE });
    expect(r).toMatchObject({ statut: 'simule', enregistree: false, resultat: null, verification: null });
    expect(sim.demandes.length + sim.demandesEmbeddings.length).toBeGreaterThan(0); // le simulateur a bien été sollicité, et lui seul
    expect(await lignes()).toEqual([]);
    // Simulateur en panne : toujours « simulé », toujours rien d'écrit.
    expect(await verifierEtEnregistrerPreuveIa(admin, { fournisseur: new SimulateurIa(), empreinteConfiguration: EMPREINTE })).toMatchObject({ statut: 'simule', enregistree: false });
    expect(await lignes()).toEqual([]);
    // Une ligne parfaite pour cette empreinte est injectée : avec le simulateur, le statut reste « simule », jamais « connecte ».
    await injecter();
    const ia = await assembler(sim);
    expect(ia.statut().statut).toBe('simule');
    expect(ia.preuve()).toBeNull();
  });

  describe('faux serveur HTTP local qui imite fidèlement l’API (bon format, bons modèles)', () => {
    let serveur: Server;
    let origine = '';
    const recues: Array<{ chemin: string; autorisation: string | undefined }> = [];
    beforeAll(async () => {
      serveur = createServer((req, res) => {
        let corps = '';
        req.on('data', (d) => (corps += d));
        req.on('end', () => {
          recues.push({ chemin: req.url ?? '', autorisation: req.headers.authorization });
          const d = JSON.parse(corps || '{}') as { model?: string; input?: string[] };
          res.writeHead(200, { 'content-type': 'application/json' }); // aucune marque de simulateur : imitation fidèle
          if (req.url === '/v1/chat/completions') res.end(JSON.stringify({ id: 'chatcmpl-faux', object: 'chat.completion', model: d.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }], usage: { prompt_tokens: 9, completion_tokens: 1 } }));
          else res.end(JSON.stringify({ object: 'list', model: d.model, data: (d.input ?? []).map((_, index) => ({ object: 'embedding', index, embedding: Array.from({ length: 1024 }, () => 0.01) })), usage: { prompt_tokens: 4 } }));
        });
      });
      await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
      origine = `http://127.0.0.1:${(serveur.address() as { port: number }).port}`;
    });
    afterAll(() => new Promise<void>((ok) => serveur.close(() => ok())));

    it('atteint sous un nom https non officiel : les deux appels RÉUSSISSENT, la vérification est REFUSÉE ; aucune tâche ne sollicite le modèle', async () => {
      // Le fournisseur réel du paquet, configuré sur « https://ia.fournisseur-imite.example/v1 » ; son transport est
      // dévié vers le faux serveur local (il n'existe pas de certificat pour ce nom, et rien ne sort de la machine).
      const urlBase = 'https://ia.fournisseur-imite.example/v1';
      const empreinte = empreinteConfigurationIa({ urlBase, jeton: JETON });
      empreintes.add(empreinte);
      const http = (url: string, init: any) => fetch(url.replace('https://ia.fournisseur-imite.example', origine), init);
      const fournisseur = new FournisseurOvh({ urlBase, jeton: JETON }, { http });
      recues.length = 0;
      const r = await verifierEtEnregistrerPreuveIa(admin, { fournisseur, empreinteConfiguration: empreinte });
      expect(recues.map((x) => x.chemin)).toEqual(['/v1/chat/completions', '/v1/embeddings']); // le format a bien été accepté de bout en bout
      expect(r).toMatchObject({ statut: 'configure_non_verifie', enregistree: true, resultat: 'refusee' });
      expect(r.raisons).toContain('L’hôte appelé n’est pas l’hôte officiel du fournisseur.');
      const [ligne] = await lignes(empreinte);
      expect(ligne).toMatchObject({ resultat: 'refusee', hote: 'ia.fournisseur-imite.example', modele_langage: MODELES_IA.langage.id, modele_embeddings: MODELES_IA.embeddings.id, dimensions_embeddings: 1024, reponse_simulateur: false });
      // Ni prompt, ni réponse, ni jeton dans la ligne.
      const brut = JSON.stringify(ligne);
      for (const interdit of [JETON, 'Réponds par le seul mot', 'vérification de connexion', '0.01']) expect(brut).not.toContain(interdit);
      const ia = await assembler(fournisseur, { empreinte });
      expect(ia.statut()).toMatchObject({ statut: 'configure_non_verifie' });
      expect(ia.preuve()).toMatchObject({ etat: 'non_concluante' });
      expect(ia.modeleUtilisable()).toBe(false);
      recues.length = 0;
      expect(await tache(ia)).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
      expect(recues).toEqual([]); // aucune requête n'est partie vers le « fournisseur »
      await ia.journal.vider();
    });

    it('adresse locale en clair (http://127.0.0.1) : refusée avant tout appel par l’adaptateur, ou vérification en échec — jamais « connecté »', async () => {
      const urlBase = `${origine}/v1`;
      const empreinte = empreinteConfigurationIa({ urlBase, jeton: JETON });
      empreintes.add(empreinte);
      let fournisseur: FournisseurIa | null = null;
      try {
        fournisseur = new FournisseurOvh({ urlBase, jeton: JETON });
      } catch {
        fournisseur = null; // l'adaptateur refuse une URL qui n'est pas en https
      }
      if (fournisseur) {
        const r = await verifierEtEnregistrerPreuveIa(admin, { fournisseur, empreinteConfiguration: empreinte });
        expect(r.statut).toBe('configure_non_verifie');
        expect(r.resultat).not.toBe('connecte');
      }
      expect((await lignes(empreinte)).filter((l) => l.resultat === 'connecte')).toEqual([]);
    });
  });

  it('modèle ou dimension inattendus sur l’hôte officiel (faux fournisseur) : refusée ; appel en échec : « echec » — et l’échec invalide une preuve antérieure', async () => {
    for (const options of [{ modeleLangage: 'un-autre-modele' }, { dimensions: 768 }]) {
      const r = await verifierEtEnregistrerPreuveIa(admin, { fournisseur: fauxFournisseurOfficiel(options).fournisseur, empreinteConfiguration: EMPREINTE });
      expect(r.statut).toBe('configure_non_verifie');
      expect(r.resultat).not.toBe('connecte');
    }
    await vider();
    await injecter({ verifieeLe: new Date(Date.now() - 3600_000).toISOString() });
    const faux = fauxFournisseurOfficiel();
    expect((await assembler(faux.fournisseur)).statut().statut).toBe('connecte');
    const enPanne = { ...faux.fournisseur, completer: async () => Promise.reject(new Error('panne')) } as unknown as FournisseurIa;
    expect(await verifierEtEnregistrerPreuveIa(admin, { fournisseur: enPanne, empreinteConfiguration: EMPREINTE })).toMatchObject({ statut: 'configure_non_verifie', enregistree: true, resultat: 'echec' });
    const apres = await assembler(faux.fournisseur);
    expect(apres.statut()).toEqual({ statut: 'configure_non_verifie', raisons: ['La dernière vérification a échoué : l’appel au fournisseur n’a pas abouti.'] });
    expect(apres.preuve()).toMatchObject({ etat: 'non_concluante' });
  });
});

describe('preuve forgée en base : ignorée', () => {
  const cas: Array<[string, LigneForgee, string]> = [
    ['empreinte d’une autre configuration', { empreinte: empreinteConfigurationIa({ urlBase: URL_BASE_OVH, jeton: `${JETON}-autre` }) }, 'autre_configuration'],
    ['périmée', { verifieeLe: new Date(Date.now() - 40 * 86_400_000).toISOString() }, 'perimee'],
    ['validité inscrite plus longue que la durée configurée', { verifieeLe: new Date(Date.now() - 40 * 86_400_000).toISOString(), valideJusquAu: new Date(Date.now() + 20 * 86_400_000).toISOString() }, 'perimee'],
    ['datée du futur', { verifieeLe: new Date(Date.now() + 3 * 86_400_000).toISOString() }, 'non_conforme'],
    ['hôte non officiel', { urlBase: 'https://ia.fournisseur-imite.example/v1', hote: 'ia.fournisseur-imite.example', urls: ['https://ia.fournisseur-imite.example/v1/chat/completions'] }, 'non_conforme'],
    ['hôte officiel affiché, mais adresses appelées ailleurs', { urls: ['https://ia.fournisseur-imite.example/v1/chat/completions'] }, 'non_conforme'],
    ['hôte officiel en http', { urlBase: URL_BASE_OVH, urls: [`http://${HOTE_OFFICIEL_OVH}/v1/chat/completions`] }, 'non_conforme'],
    ['modèle de langage différent', { langage: 'un-autre-modele' }, 'non_conforme'],
    ['dimension différente', { dimensions: 768 }, 'non_conforme'],
    ['résultat « refusee »', { resultat: 'refusee' }, 'non_concluante'],
  ];
  for (const [nom, ligne, etat] of cas) {
    it(`${nom} → « configuré, non vérifié », aucun appel au modèle`, async () => {
      await injecter(ligne);
      const faux = fauxFournisseurOfficiel();
      const ia = await assembler(faux.fournisseur);
      expect(ia.statut().statut).toBe('configure_non_verifie');
      expect(ia.statut().raisons.length).toBeGreaterThan(0);
      expect(ia.preuve()).toMatchObject({ etat });
      expect(ia.modeleUtilisable()).toBe(false);
      expect(await tache(ia)).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
      expect(faux.completer).not.toHaveBeenCalled();
      expect(faux.vectoriser).not.toHaveBeenCalled();
      await ia.journal.vider();
    });
  }

  it('la base elle-même refuse les lignes absurdes : « connecte » marquée simulateur, sans modèle, sans adresse, en http, validité de plus de 90 jours, résultat inconnu', async () => {
    for (const ligne of [{ simulateur: true }, { langage: null }, { dimensions: null }, { urls: [] }, { urlBase: 'http://exemple.invalid/v1' }, { valideJusquAu: new Date(Date.now() + 200 * 86_400_000).toISOString() }, { resultat: 'verifie' }, { empreinte: 'pas-une-empreinte' }] as LigneForgee[]) {
      await expect(injecter(ligne), JSON.stringify(ligne)).rejects.toThrow();
    }
    expect(await lignes()).toEqual([]);
  });
});

describe('preuve valide et configuration correspondante', () => {
  it('statut « connecté », et les tâches passent par le fournisseur — ici un FAUX fournisseur : cela prouve le câblage, pas une connexion réelle', async () => {
    // La preuve est INJECTÉE par le test et le fournisseur est un faux, sans réseau. Ce test montre que, preuve valide
    // à l'appui, la passerelle remise aux tâches est bien celle du fournisseur. Il ne montre PAS qu'OVHcloud répond.
    await injecter();
    const faux = fauxFournisseurOfficiel();
    const ia = await assembler(faux.fournisseur);
    expect(ia.statut()).toEqual({ statut: 'connecte', raisons: [] });
    expect(ia.preuve()).toMatchObject({ etat: 'valide', atteste: { hote: HOTE_OFFICIEL_OVH, modeleLangage: MODELES_IA.langage.id, modeleEmbeddings: MODELES_IA.embeddings.id, dimensionsEmbeddings: 1024 }, validiteJours: 30 });
    expect(ia.modeleUtilisable()).toBe(true);
    expect(ia.active()).toBe(ia.passerelle);
    expect(await tache(ia)).toMatchObject({ etat: 'ok', valeur: { a: 'ok' }, modele: MODELES_IA.langage.id });
    expect(faux.completer).toHaveBeenCalledTimes(1);
    await ia.journal.vider();
    // Le worker lit la même preuve avec son propre rôle : la table est partagée, en lecture, entre l'API et le worker.
    const coteWorker = await assembler(fauxFournisseurOfficiel().fournisseur, { bd: worker });
    expect(coteWorker.statut().statut).toBe('connecte');
  });

  it('la vérification elle-même, sur un faux fournisseur de l’hôte officiel, écrit une preuve « connecte » relue par l’API (chemin d’écriture ; aucun appel réel)', async () => {
    const faux = fauxFournisseurOfficiel();
    const r = await verifierEtEnregistrerPreuveIa(admin, { fournisseur: faux.fournisseur, empreinteConfiguration: EMPREINTE, validiteJours: 30 });
    expect(r).toMatchObject({ statut: 'connecte', raisons: [], enregistree: true, resultat: 'connecte', verification: { hote: HOTE_OFFICIEL_OVH, empreinteConfiguration: EMPREINTE, reponseSimulateur: false } });
    expect(faux.completer).toHaveBeenCalledTimes(1);
    expect(faux.vectoriser).toHaveBeenCalledTimes(1);
    const [ligne] = await lignes();
    const dureeJours = (new Date(ligne.valide_jusqu_au).getTime() - new Date(ligne.verifiee_le).getTime()) / 86_400_000;
    expect(Math.abs(dureeJours - 30)).toBeLessThan(0.1); // 30 jours calendaires (à une heure près lors d'un changement d'heure)
    expect(JSON.stringify(ligne)).not.toContain('Réponds par le seul mot');
    expect((await assembler(fauxFournisseurOfficiel().fournisseur)).statut().statut).toBe('connecte');
  });

  it('changement de configuration (jeton, URL) : la preuve ne vaut plus ; péremption : retour à « non vérifié » sans aucun appel automatique', async () => {
    await injecter();
    const faux = fauxFournisseurOfficiel();
    expect((await assembler(faux.fournisseur)).statut().statut).toBe('connecte');
    // Autre jeton, autre URL de base, configuration sans empreinte : chaque fois « configuré, non vérifié ».
    for (const empreinte of [empreinteConfigurationIa({ urlBase: URL_BASE_OVH, jeton: `${JETON}-renouvele` }), empreinteConfigurationIa({ urlBase: `${URL_BASE_OVH}/`, jeton: JETON }), null]) {
      const ia = await assembler(faux.fournisseur, { empreinte });
      expect(ia.statut().statut).toBe('configure_non_verifie');
      expect(ia.preuve()!.etat).toBe('autre_configuration');
      expect(ia.modeleUtilisable()).toBe(false);
    }
    expect(empreinteConfigurationIa({ urlBase: URL_BASE_OVH, jeton: JETON })).toBe(EMPREINTE); // stable pour une même configuration
    expect(EMPREINTE).not.toContain(JETON);

    // Le temps passe : au 31e jour la même preuve est périmée, pour un processus qui n'a pas redémarré.
    let maintenant = new Date();
    const ia = await assembler(faux.fournisseur, { maintenant: () => maintenant });
    expect(ia.statut().statut).toBe('connecte');
    maintenant = new Date(Date.now() + 29 * 86_400_000);
    expect(ia.statut().statut).toBe('connecte');
    maintenant = new Date(Date.now() + 31 * 86_400_000);
    expect(ia.statut().statut).toBe('configure_non_verifie');
    expect(ia.preuve()).toMatchObject({ etat: 'perimee' });
    expect(ia.statut().raisons[0]).toContain('périmée');
    expect(await tache(ia)).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
    // Aucun appel n'a été émis pour « revérifier » : la péremption ne déclenche rien.
    expect(faux.completer).not.toHaveBeenCalled();
    expect(faux.vectoriser).not.toHaveBeenCalled();
    // Une durée de validité configurée plus courte s'applique à une preuve déjà enregistrée.
    expect((await assembler(faux.fournisseur, { validiteJours: 1, maintenant: () => new Date(Date.now() + 2 * 86_400_000) })).statut().statut).toBe('configure_non_verifie');
    await ia.journal.vider();
  });

  it('un processus déjà démarré voit la preuve arriver, puis être invalidée, sans redémarrage', async () => {
    const faux = fauxFournisseurOfficiel();
    const ia = await assembler(faux.fournisseur);
    expect(ia.statut().statut).toBe('configure_non_verifie');
    await injecter({ verifieeLe: new Date(Date.now() - 60_000).toISOString() });
    ia.statut(); // déclenche la relecture en arrière-plan (fraîcheur nulle dans ce test, 30 s dans l'application)
    await ia.rafraichirPreuve();
    expect(ia.statut().statut).toBe('connecte');
    await injecter({ resultat: 'echec', langage: null, embeddings: null, dimensions: null, urls: [] });
    await ia.rafraichirPreuve();
    expect(ia.statut().statut).toBe('configure_non_verifie');
  });
});

describe('droits en base : lecture pour l’API et le worker, écriture pour personne d’autre que l’éditeur', () => {
  it('ni le rôle de l’application ni celui du worker ne peuvent ajouter, modifier ou supprimer une vérification ; ils la lisent', async () => {
    const id = await injecter();
    for (const [nom, bd] of [['application', app], ['worker', worker]] as const) {
      for (const contexte of [{}, { cabinetId: cabinet }]) {
        expect(await bd.avecContexte(contexte, async (tx) => (await tx.execute(sql`select id from verifications_connexion_ia where id = ${id}::uuid`)).rowCount), nom).toBe(1);
        for (const requete of [
          sql`insert into verifications_connexion_ia (resultat, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, empreinte_configuration, valide_jusqu_au)
              values ('connecte', ${URL_BASE_OVH}, ${HOTE_OFFICIEL_OVH}, ${JSON.stringify([`${URL_BASE_OVH}/chat/completions`])}::jsonb, ${MODELES_IA.langage.id}, ${MODELES_IA.embeddings.id}, 1024, ${EMPREINTE}, now() + interval '30 days')`,
          sql`update verifications_connexion_ia set valide_jusqu_au = now() + interval '60 days' where id = ${id}::uuid`,
          sql`update verifications_connexion_ia set resultat = 'connecte'`,
          sql`delete from verifications_connexion_ia where id = ${id}::uuid`,
          sql`truncate verifications_connexion_ia`,
        ]) {
          await expect(bd.avecContexte(contexte, (tx) => tx.execute(requete)), nom).rejects.toThrow();
        }
        // La vérification elle-même, lancée avec un rôle applicatif, échoue à l'écriture : aucune ligne n'apparaît.
        await expect(verifierEtEnregistrerPreuveIa(bd.pool, { fournisseur: fauxFournisseurOfficiel().fournisseur, empreinteConfiguration: EMPREINTE })).rejects.toThrow();
      }
    }
    expect(await lignes()).toHaveLength(1);
    // Ajout seul, même pour le rôle d'administration : une vérification ne se modifie pas, elle se refait.
    await expect(admin.query(`update verifications_connexion_ia set valide_jusqu_au = valide_jusqu_au + interval '1 day' where id = $1`, [id])).rejects.toThrow(/ajout seul/);
  });
});
