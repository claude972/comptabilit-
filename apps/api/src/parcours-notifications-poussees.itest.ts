/**
 * Notifications poussées DISCRÈTES, de bout en bout, sur de VRAIS processus et contre le SIMULATEUR de service de
 * notification (aucun service réel — Google, Mozilla, Apple, Microsoft — n'est contacté, aucun appareil réel ne reçoit rien).
 *
 * Le test démarre le simulateur, puis une SECONDE pile API + worker (`dist/main.js`, port libre, préfixe de files propre à
 * l'exécution) dont la seule destination admise est ce simulateur, avec une paire de clés VAPID ÉPHÉMÈRE (créée en mémoire,
 * jamais écrite, perdue à la fin). La pile normale n'est pas touchée : elle sert à vérifier le statut « non_configure ».
 * Cabinet NEUF à chaque exécution. Prérequis : services démarrés, migrations appliquées, paquets construits.
 *
 * Ce que ce parcours ne peut PAS montrer : la réception par un vrai service de notification, l'affichage sur un
 * téléphone, le comportement d'un écran verrouillé, iOS.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import { type AbonnementSimule, connexionRedis, demarrerSimulateurPoussees, Files, genererClesVapid, type SimulateurPoussees } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API as API_NORMALE, attendre, jetons, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const PREFIXE = `essai-poussees-${SEL}`;
const racineApi = join(dirname(fileURLToPath(import.meta.url)), '..');
const vapid = genererClesVapid(); // éphémère : ni dans le dépôt, ni dans un fichier, ni dans un journal
const FENETRE_S = 3;
const NOM = `Dossier confidentiel ${SEL} (fictif)`;
const FICHIER = `facture-secrete-${SEL}.pdf`;
const MONTANT = '9 876,54 €';
let API = '';
let sim: SimulateurPoussees;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let documentId = '';
const processus: ChildProcess[] = [];
const journaux = { api: '', worker: '' };
const appareils: Record<string, AbonnementSimule> = {};
const idsAbonnements: Record<string, string> = {};

const portLibre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

async function api(qui: string, methode: string, chemin: string, corps?: unknown, base = API): Promise<{ statut: number; json: any; texte: string }> {
  const binaire = Buffer.isBuffer(corps);
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { ...(qui ? { authorization: `Bearer ${jetons[qui]}`, 'x-cabinet-id': qui === 'bruno' ? DEMO.cabinetB : cabinet } : {}), ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps as Buffer) : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* réponse non JSON */
  }
  return { statut: r.status, json, texte };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const messagesDe = (qui: string) => sim.messages.filter((m) => m.endpoint === appareils[qui]!.endpoint);
const corpsAbonnement = (a: AbonnementSimule, agentUtilisateur = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Mobile Safari/537.36') => ({ endpoint: a.endpoint, keys: a.keys, agentUtilisateur });
const lignesAbonnements = async () => (await editeur.query('select id, utilisateur_id, service, agent, secrets_chiffres, empreinte_point_acces, dernier_succes_le from abonnements_pousses where cabinet_id = $1 order by cree_le, id', [cabinet])).rows;
const lignesEnvois = async (destinataire: string) => (await editeur.query('select id, type, nombre, issue, appareils from envois_pousses where cabinet_id = $1 and destinataire_id = $2 order by cree_le, id', [cabinet, destinataire])).rows;
const demanderComplement = (qui: string, message: string) => api(qui, 'POST', `/v1/documents/${documentId}/echanges`, { type: 'demande_complement', message });
/** Laisse passer la fenêtre de regroupement, le relevé et la livraison, puis rend les messages reçus : « rien n'est arrivé » se constate. */
const apresFenetre = async () => {
  await pause((FENETRE_S + 3) * 1000);
  return sim.messages.length;
};

beforeAll(async () => {
  await ouvrirSessions();
  sim = await demarrerSimulateurPoussees();
  const port = await portLibre();
  API = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: String(port),
    FILES_PREFIXE: PREFIXE,
    METRIQUES_PORT_API: '0',
    METRIQUES_PORT_WORKER: '0',
    PUSH_VAPID_CLE_PUBLIQUE: vapid.publique,
    PUSH_VAPID_CLE_PRIVEE: vapid.privee,
    PUSH_VAPID_SUJET: 'mailto:essai-poussees@editeur.example',
    PUSH_SIMULATEUR_URL: sim.origine,
    PUSH_FENETRE_REGROUPEMENT_S: String(FENETRE_S),
    PUSH_PERIODE_RELEVE_S: '1',
    PUSH_DELAI_REPRISE_S: '1',
  };
  for (const [nom, dossierProcessus] of [['api', racineApi], ['worker', join(racineApi, '..', 'worker')]] as const) {
    const p = spawn(process.execPath, ['dist/main.js'], { cwd: dossierProcessus, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => (journaux[nom] += d.toString()));
    p.stderr.on('data', (d: Buffer) => (journaux[nom] += d.toString()));
    processus.push(p);
  }
  try {
    await attendre(() => fetch(`${API}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok && /Worker Comtaple démarré/.test(journaux.worker), 40_000);
  } catch (e) {
    for (const p of processus) p.kill('SIGKILL');
    throw new Error(`pile d'essai non démarrée : ${(e as Error).message}\n${journaux.api.slice(-1500)}\n${journaux.worker.slice(-1500)}`);
  }

  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai notifications poussées ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: NOM, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  // Une pièce déposée par le client, analysée par le worker de la pile d'essai : c'est sur elle que portent les demandes.
  const contenu = pdfTexte(['Facture d’essai', `Référence ${SEL}`, `Total TTC ${MONTANT}`], SEL);
  const o = await api('client', 'POST', '/v1/televersements', { entiteId: dossier, nomFichier: FICHIER, taille: contenu.length, sha256: sha(contenu), canal: 'telephone' });
  expect(o.statut, o.texte).toBe(201);
  expect((await api('client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu)).statut).toBe(200);
  documentId = (await api('client', 'POST', `/v1/televersements/${o.json.id}/terminer`)).json.documentId;
  await attendre(() => api('chloe', 'GET', `/v1/documents/${documentId}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
}, 180_000);

afterAll(async () => {
  await Promise.all(
    processus.map(
      (p) =>
        new Promise<void>((r) => {
          if (p.exitCode !== null || p.signalCode !== null) return r();
          const garde = setTimeout(() => p.kill('SIGKILL'), 20_000);
          p.once('exit', () => (clearTimeout(garde), r()));
          p.kill('SIGTERM');
        }),
    ),
  );
  if (editeur) {
    // Abonnements et envois de l'essai : retirés (leur simulateur disparaît avec le test).
    await editeur.query('delete from envois_pousses where cabinet_id = $1', [cabinet]);
    await editeur.query('delete from abonnements_pousses where cabinet_id = $1', [cabinet]);
    await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
    await editeur.end();
  }
  const files = new Files(connexionRedis(process.env.REDIS_URL!), PREFIXE);
  for (const f of [files.mail, files.documents, files.comptabilite, files.exports, files.pousses]) await f.obliterate({ force: true }).catch(() => undefined);
  await files.fermer();
  await sim?.arreter();
}, 120_000);

describe('désactivé par défaut : pile normale', () => {
  it('statut « non_configure », aucune clé publique, aucun abonnement accepté, « envoiExterne » faux', async () => {
    const e = await api('client', 'GET', '/v1/notifications/poussees', undefined, API_NORMALE);
    expect(e.statut).toBe(200);
    expect(e.json).toMatchObject({ statut: 'non_configure', activees: false, clePublique: null, verifieSurAppareilReel: false, appareils: [] });
    expect(e.json.detail).toBe('Les notifications poussées ne sont pas activées sur ce service.');
    const refus = await api('client', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(sim.abonner(vapid.publique)), API_NORMALE);
    expect(refus.statut).toBe(503);
    expect(refus.json).toMatchObject({ code: 'poussees_non_configurees', message: 'Les notifications poussées ne sont pas activées sur ce service.' });
    // Même un point d'accès d'un vrai service est refusé avant tout examen : rien n'est enregistré.
    expect((await api('client', 'POST', '/v1/notifications/poussees/abonnements', { endpoint: 'https://fcm.googleapis.com/fcm/send/jamais-contacte', keys: sim.abonner(vapid.publique).keys }, API_NORMALE)).statut).toBe(503);
    expect(await lignesAbonnements()).toEqual([]);
    expect((await api('client', 'GET', '/v1/notifications/poussees/abonnements', undefined, API_NORMALE)).json).toEqual({ appareils: [] });
    expect((await api('client', 'GET', '/v1/notifications', undefined, API_NORMALE)).json.envoiExterne).toBe(false);
    expect((await api('client', 'GET', '/v1/notifications/preferences', undefined, API_NORMALE)).json.envoiExterne).toBe(false);
    expect((await api('alice', 'GET', '/v1/integrations', undefined, API_NORMALE)).json.notificationsPoussees).toEqual({ statut: 'non_configure', detail: 'Les notifications poussées ne sont pas activées sur ce service.' });
    expect((await api('', 'GET', '/v1/notifications/poussees', undefined, API_NORMALE)).statut).toBe(401);
  });
});

describe('pile d’essai : état, abonnement, protection du point d’accès', () => {
  it('statut « simulé », jamais « vérifié » ; clé publique VAPID et liste fermée des phrases', async () => {
    const e = (await api('client', 'GET', '/v1/notifications/poussees')).json;
    expect(e).toMatchObject({ statut: 'simule', activees: true, clePublique: vapid.publique, verifieSurAppareilReel: false, preference: { active: true }, appareils: [] });
    expect(e.detail).toMatch(/SIMULATEUR de test/);
    expect(e.phrases).toEqual(['Vous avez une nouvelle notification dans Comtaple.', 'Vous avez de nouvelles notifications dans Comtaple.', 'Un complément vous est demandé.', 'Une réponse a été apportée à une demande de complément.']);
    expect(JSON.stringify(e)).not.toContain(vapid.privee);
    expect((await api('alice', 'GET', '/v1/integrations')).json.notificationsPoussees.statut).toBe('simule');
    expect((await api('client', 'GET', '/v1/notifications')).json.envoiExterne).toBe(true);
    expect((await api('', 'GET', '/v1/notifications/poussees')).statut).toBe(401);
    expect((await api('', 'POST', '/v1/notifications/poussees/abonnements', {})).statut).toBe(401);
  });

  it('requête forgée côté serveur : toute adresse interne, privée, inconnue ou non https est refusée, sans être appelée ni recopiée', async () => {
    const cles = sim.abonner(vapid.publique).keys;
    const portApi = new URL(API).port;
    const hostiles = [
      `http://127.0.0.1:${portApi}/v1/sante`, // l'API elle-même
      `http://localhost:${new URL(sim.origine).port}/push/abcdefghijklmnopqrstuvwx`, // le simulateur sous un autre nom d'hôte
      `http://127.0.0.1:${Number(new URL(sim.origine).port) + 1}/push/abcdefghijklmnopqrstuvwx`, // un autre port local
      'http://169.254.169.254/latest/meta-data/', // métadonnées d'un hébergeur
      'http://10.0.0.1/push', 'https://192.168.1.10/push', 'https://[::1]/push', 'https://2130706433/push', 'https://0x7f.1/push',
      'http://postgres:5432/', 'http://redis:6379/', 'https://keycloak.interne/realms/comtaple',
      'file:///etc/passwd', 'ftp://exemple.test/x', 'gopher://127.0.0.1:6379/_FLUSHALL',
      'https://exemple.test/push/abc', 'https://fcm.googleapis.com.exemple.test/fcm/send/abc', `https://fcm.googleapis.com@127.0.0.1:${portApi}/x`,
      // Pile simulée : même un vrai service n'est pas une destination admise (elle ne doit pouvoir joindre que le simulateur).
      'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc',
    ];
    const avant = sim.messages.length + sim.refus.length;
    for (const endpoint of hostiles) {
      const r = await api('client', 'POST', '/v1/notifications/poussees/abonnements', { endpoint, keys: cles });
      expect(r.statut, endpoint).toBe(400);
      expect(r.json.code, endpoint).toBe('point_acces_refuse');
      expect(r.texte, endpoint).not.toContain(endpoint); // l'adresse soumise n'est pas renvoyée
    }
    // Clés mal formées ou hors courbe, corps incomplet.
    const bon = sim.abonner(vapid.publique);
    for (const corps of [{ endpoint: bon.endpoint }, { endpoint: bon.endpoint, keys: { p256dh: 'abc', auth: bon.keys.auth } }, { endpoint: bon.endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: bon.keys.auth } }, { keys: bon.keys }, {}]) {
      expect((await api('client', 'POST', '/v1/notifications/poussees/abonnements', corps)).statut, JSON.stringify(corps)).toBe(400);
    }
    expect(await lignesAbonnements()).toEqual([]);
    expect(sim.messages.length + sim.refus.length).toBe(avant); // le simulateur n'a rien reçu
  });

  it('abonnement d’un appareil : secrets chiffrés au repos, agent réduit, visible de son seul titulaire, rejouable', async () => {
    appareils.client = sim.abonner(vapid.publique);
    appareils.alice = sim.abonner(vapid.publique);
    const r = await api('client', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(appareils.client));
    expect(r.statut, r.texte).toBe(201);
    expect(r.json).toMatchObject({ service: 'simulateur', agent: 'Chrome sur Android', dernierEnvoiAccepteLe: null });
    expect(r.json.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(r.texte).not.toContain(appareils.client.endpoint);
    expect(r.texte).not.toContain(appareils.client.keys.auth);
    idsAbonnements.client = r.json.id;
    // Rejoué par le même appareil : même abonnement, pas de doublon.
    expect((await api('client', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(appareils.client))).json.id).toBe(r.json.id);
    const a = await api('alice', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(appareils.alice, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'));
    expect(a.json).toMatchObject({ agent: 'Firefox sur Windows' });
    idsAbonnements.alice = a.json.id;

    const lignes = await lignesAbonnements();
    expect(lignes.map((l) => [l.utilisateur_id, l.service, l.agent])).toEqual([[DEMO.client, 'simulateur', 'Chrome sur Android'], [DEMO.alice, 'simulateur', 'Firefox sur Windows']]);
    const brut = JSON.stringify(lignes);
    for (const qui of ['client', 'alice']) {
      const jeton = appareils[qui]!.endpoint.split('/').pop()!;
      for (const secret of [jeton, appareils[qui]!.keys.p256dh, appareils[qui]!.keys.auth]) expect(brut).not.toContain(secret);
    }
    expect(brut).not.toContain('127.0.0.1'); // l'adresse du point d'accès n'est nulle part en clair
    expect(brut).not.toContain('Pixel');
    expect(lignes.every((l) => /^a1\.p-[0-9a-f]{12}\./.test(l.secrets_chiffres))).toBe(true);

    // Chacun ne voit et ne retire que les siens.
    expect((await api('client', 'GET', '/v1/notifications/poussees/abonnements')).json.appareils.map((x: any) => x.id)).toEqual([idsAbonnements.client]);
    expect((await api('alice', 'GET', '/v1/notifications/poussees')).json.appareils.map((x: any) => x.id)).toEqual([idsAbonnements.alice]);
    expect((await api('chloe', 'GET', '/v1/notifications/poussees/abonnements')).json.appareils).toEqual([]);
    expect((await api('alice', 'DELETE', `/v1/notifications/poussees/abonnements/${idsAbonnements.client}`)).statut).toBe(404);
    expect((await api('bruno', 'DELETE', `/v1/notifications/poussees/abonnements/${idsAbonnements.client}`)).statut).toBe(404);
    expect((await api('client', 'DELETE', '/v1/notifications/poussees/abonnements/pas-un-identifiant')).statut).toBe(400);
    expect(await lignesAbonnements()).toHaveLength(2);
    const audit = (await editeur.query(`select action, details from journal_audit where cabinet_id = $1 and action like 'notification_poussee.%' order by id`, [cabinet])).rows;
    expect(audit.map((x) => x.action)).toEqual(['notification_poussee.appareil_abonne', 'notification_poussee.appareil_abonne', 'notification_poussee.appareil_abonne']);
    expect(JSON.stringify(audit)).not.toContain('127.0.0.1');
  });
});

describe('envoi par le worker, déclenché par un événement réel', () => {
  it('demande de complément : l’appareil du déposant reçoit UNE charge discrète — ni dossier, ni fichier, ni montant, ni message', async () => {
    const question = `Merci de préciser la nature de cette dépense de ${MONTANT} pour ${NOM}.`;
    expect((await demanderComplement('chloe', question)).statut).toBeLessThan(300);
    const recus = await attendre(async () => messagesDe('client'), (m) => m.length >= 1, 30_000);
    expect(recus).toHaveLength(1);
    const m = recus[0]!;
    // La notification interne, elle, porte bien le détail — lisible seulement une fois connecté.
    const interne = (await api('client', 'GET', '/v1/notifications')).json.notifications[0];
    expect(interne).toMatchObject({ type: 'document.complement_demande', lien: `/depots/${documentId}` });
    expect(interne.message).toContain(NOM);
    const [envoi] = await lignesEnvois(DEMO.client);
    expect(envoi).toMatchObject({ type: 'document.complement_demande', nombre: 1, issue: 'distribue', appareils: 1 });
    // Charge utile EXACTE déchiffrée par le simulateur : version, type générique, identifiant opaque (celui de l'envoi).
    expect(m.clair).toBe(`{"v":1,"t":"complement","i":"${envoi.id}"}`);
    expect(Object.keys(JSON.parse(m.clair))).toEqual(['v', 't', 'i']);
    expect(envoi.id).not.toBe(interne.id);
    for (const interdit of [NOM, 'Dossier', 'confidentiel', SEL, FICHIER, 'facture', '.pdf', MONTANT, '9 876', 'dépense', documentId, dossier, cabinet, DEMO.client, DEMO.chloe, interne.id, 'document', 'depots']) {
      expect(m.clair, interdit).not.toContain(interdit);
      expect(m.chiffre.includes(Buffer.from(interdit)), interdit).toBe(false);
    }
    // En-têtes : rien non plus n'y désigne le dossier ; le sujet de regroupement est générique.
    expect(m.enTetes).toEqual({ ttl: '86400', urgency: 'normal', topic: 'comtaple-complement', contentEncoding: 'aes128gcm' });
    expect(m.sujet).toBe('mailto:essai-poussees@editeur.example');
    expect(sim.refus).toEqual([]);
    // Personne d'autre n'est notifié : ni l'auteure, ni l'administratrice abonnée mais non concernée.
    await pause(1500);
    expect(messagesDe('alice')).toEqual([]);
    expect(sim.messages).toHaveLength(1);
    expect((await lignesAbonnements()).find((l) => l.id === idsAbonnements.client).dernier_succes_le).not.toBeNull();
    expect((await api('client', 'GET', '/v1/notifications/poussees')).json.appareils[0].dernierEnvoiAccepteLe).toBeTruthy();
  });

  it('pas de rafale : plusieurs notifications dans la fenêtre → UNE seule notification poussée, de type « plusieurs » si elles diffèrent', async () => {
    const avant = sim.messages.length;
    // Alice est prévenue, coup sur coup, d'une règle proposée et d'une réponse à sa demande de complément.
    expect((await demanderComplement('alice', 'Quel est le fournisseur ?')).statut).toBeLessThan(300); // → client (complement)
    expect((await api('chloe', 'POST', '/v1/regles', { controleId: 'TIE-001', entiteId: dossier, motif: 'Petits avoirs sans enjeu', parametres: { seuil: '50.00' } })).statut).toBe(201); // → alice
    expect((await api('client', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'reponse', message: 'Meunerie du Nord.' })).statut).toBeLessThan(300); // → alice (reponse)
    await attendre(async () => [messagesDe('alice').length, messagesDe('client').length], ([a, c]) => a! >= 1 && c! >= 2, 30_000);
    await pause((FENETRE_S + 2) * 1000); // rien d'autre n'arrive ensuite
    expect(sim.messages.length - avant).toBe(2); // une pour Alice (deux notifications internes), une pour le client
    const pourAlice = messagesDe('alice');
    expect(pourAlice).toHaveLength(1);
    const envoiAlice = (await lignesEnvois(DEMO.alice))[0];
    expect(envoiAlice).toMatchObject({ type: 'mixte', nombre: 2, issue: 'distribue', appareils: 1 });
    expect((await api('alice', 'GET', '/v1/notifications')).json.notifications.map((n: any) => n.type).sort()).toEqual(['document.reponse', 'regle.a_decider']);
    expect(pourAlice[0]!.clair).toBe(`{"v":1,"t":"plusieurs","i":"${envoiAlice.id}"}`);
    expect(pourAlice[0]!.enTetes.topic).toBe('comtaple-plusieurs');
    expect(messagesDe('client').at(-1)!.clair).toMatch(/^\{"v":1,"t":"complement","i":"[0-9a-f-]{36}"\}$/);
    expect(JSON.stringify(sim.messages.map((m) => m.clair))).not.toContain('TIE-001');
  });

  it('préférences : famille désactivée → ni notification interne ni poussée ; préférence globale coupée → interne seulement ; rétablie → poussée', async () => {
    const internes = async () => (await api('client', 'GET', '/v1/notifications')).json.total as number;
    const depart = { messages: sim.messages.length, internes: await internes(), envois: (await lignesEnvois(DEMO.client)).length };
    // 1) Famille « pièces » désactivée par le déposant.
    expect((await api('client', 'PUT', '/v1/notifications/preferences', { famille: 'pieces', active: false })).statut).toBe(200);
    expect((await demanderComplement('chloe', 'Question pendant que la famille est désactivée.')).statut).toBeLessThan(300);
    expect(await apresFenetre()).toBe(depart.messages);
    expect(await internes()).toBe(depart.internes);
    expect(await lignesEnvois(DEMO.client)).toHaveLength(depart.envois);
    expect((await api('client', 'PUT', '/v1/notifications/preferences', { famille: 'pieces', active: true })).statut).toBe(200);
    // 2) Préférence globale « notifications poussées » coupée : la notification interne existe, rien n'est poussé.
    expect((await api('client', 'PUT', '/v1/notifications/poussees/preference', { active: 'non' })).statut).toBe(400);
    expect((await api('client', 'PUT', '/v1/notifications/poussees/preference', { active: false })).json).toEqual({ active: false });
    expect((await api('client', 'GET', '/v1/notifications/poussees')).json.preference).toEqual({ active: false });
    expect((await api('alice', 'GET', '/v1/notifications/poussees')).json.preference).toEqual({ active: true }); // celle d'Alice n'est pas touchée
    expect((await api('client', 'GET', '/v1/notifications/preferences')).json.familles.every((f: any) => f.active)).toBe(true); // les familles non plus
    expect((await demanderComplement('chloe', 'Question pendant que les notifications poussées sont coupées.')).statut).toBeLessThan(300);
    expect(await apresFenetre()).toBe(depart.messages);
    expect(await internes()).toBe(depart.internes + 1);
    expect(await lignesEnvois(DEMO.client)).toHaveLength(depart.envois);
    expect(await lignesAbonnements()).toHaveLength(2); // l'appareil reste abonné
    // 3) Rétablie : la demande suivante est poussée.
    expect((await api('client', 'PUT', '/v1/notifications/poussees/preference', { active: true })).json).toEqual({ active: true });
    expect((await demanderComplement('chloe', 'Question après rétablissement.')).statut).toBeLessThan(300);
    await attendre(async () => sim.messages.length, (n) => n === depart.messages + 1, 30_000);
    expect(messagesDe('client').at(-1)!.clair).toContain('"t":"complement"');
  });

  it('erreurs temporaires du service (503 puis 429) : rejouées, puis la notification arrive une seule fois', async () => {
    const avant = messagesDe('client').length;
    sim.forcer(appareils.client!.endpoint, 503, 429);
    expect((await demanderComplement('chloe', 'Question pendant une indisponibilité du service.')).statut).toBeLessThan(300);
    await attendre(async () => messagesDe('client').length, (n) => n === avant + 1, 40_000);
    await pause(2500);
    expect(messagesDe('client')).toHaveLength(avant + 1); // pas de doublon après les reprises
    expect(journaux.worker).toMatch(/\[pousses\] tâche livrer \S+ en échec \(tentative 1\) : service de notification momentanément indisponible \(HTTP 503\)/);
    expect(await lignesAbonnements()).toHaveLength(2);
  });

  it('410 du service : l’abonnement est retiré, le retrait journalisé, et plus rien n’est adressé à cet appareil', async () => {
    const avant = sim.messages.length;
    sim.revoquer(appareils.client!.endpoint);
    expect((await demanderComplement('chloe', 'Question après révocation de l’appareil.')).statut).toBeLessThan(300);
    await attendre(lignesAbonnements, (l) => l.length === 1, 30_000);
    expect((await lignesAbonnements())[0].utilisateur_id).toBe(DEMO.alice);
    expect((await api('client', 'GET', '/v1/notifications/poussees')).json.appareils).toEqual([]);
    const retrait = (await editeur.query(`select acteur_type, cible_id, details from journal_audit where cabinet_id = $1 and action = 'notification_poussee.appareil_retire' order by id desc limit 1`, [cabinet])).rows[0];
    expect(retrait).toMatchObject({ acteur_type: 'systeme', cible_id: idsAbonnements.client, details: { service: 'simulateur', par: 'service', motif: 'perime', statut: 410 } });
    // Événement suivant : notification interne créée, aucun envoi mis en file, rien n'arrive.
    const envois = (await lignesEnvois(DEMO.client)).length;
    expect((await demanderComplement('chloe', 'Question sans appareil abonné.')).statut).toBeLessThan(300);
    expect(await apresFenetre()).toBe(avant);
    expect(await lignesEnvois(DEMO.client)).toHaveLength(envois);
  });

  it('désabonnement par la personne : l’appareil disparaît, plus rien ne lui est adressé', async () => {
    expect((await api('alice', 'DELETE', `/v1/notifications/poussees/abonnements/${idsAbonnements.alice}`)).json).toEqual({ retire: true });
    expect((await api('alice', 'DELETE', `/v1/notifications/poussees/abonnements/${idsAbonnements.alice}`)).statut).toBe(404);
    expect(await lignesAbonnements()).toEqual([]);
    const avant = sim.messages.length;
    const internes = (await api('alice', 'GET', '/v1/notifications')).json.total as number;
    expect((await demanderComplement('alice', 'Dernière question.')).statut).toBeLessThan(300);
    expect((await api('client', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'reponse', message: 'Dernière réponse.' })).statut).toBeLessThan(300);
    expect((await api('alice', 'GET', '/v1/notifications')).json.total).toBe(internes + 1); // la notification interne existe toujours
    expect(await apresFenetre()).toBe(avant);
    expect(await lignesEnvois(DEMO.alice)).toHaveLength(1); // aucun nouvel envoi mis en file
  });

  it('renouvellement par le navigateur : remplacement ATOMIQUE — jamais deux abonnements pour l’appareil, jamais celui d’une autre personne ; le nouvel abonnement reçoit, l’ancien plus rien', async () => {
    const REMPLACEMENT = '/v1/notifications/poussees/abonnements/remplacement';
    appareils.clientAncien = sim.abonner(vapid.publique);
    const premier = await api('client', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(appareils.clientAncien));
    expect(premier.statut, premier.texte).toBe(201);
    const ancienneEmpreinte = premier.json.empreinte as string;
    appareils.client = sim.abonner(vapid.publique); // ce que le navigateur détient après renouvellement
    const duClient = async () => (await lignesAbonnements()).filter((l) => l.utilisateur_id === DEMO.client);

    // Sans session : refusé (c'est le cas où le service worker laisse une marque pour l'écran).
    expect((await api('', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.client), ancienneEmpreinte })).statut).toBe(401);
    // Nouveau point d'accès refusé : RIEN n'est retiré (l'ancien abonnement reste tant que le nouveau n'est pas enregistré).
    const refuse = await api('client', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.client), endpoint: 'https://service-inconnu.example/push/abc', ancienneEmpreinte });
    expect(refuse.statut).toBe(400);
    expect(refuse.json.code).toBe('point_acces_refuse');
    expect((await api('client', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.client), ancienneEmpreinte: 'pas-une-empreinte' })).statut).toBe(400);
    expect((await duClient()).map((l) => l.id)).toEqual([premier.json.id]);

    // Une AUTRE personne présente l'empreinte de l'abonnement du client : son propre appareil est enregistré, celui du client n'est pas touché.
    appareils.alice = sim.abonner(vapid.publique);
    const autre = await api('alice', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.alice), ancienneEmpreinte });
    expect(autre.statut, autre.texte).toBe(200);
    expect(autre.json.ancienRetire).toBe(false);
    expect((await duClient()).map((l) => [l.id, l.empreinte_point_acces])).toEqual([[premier.json.id, ancienneEmpreinte]]);

    // Le remplacement par le titulaire : un seul abonnement après, le nouveau.
    const r = await api('client', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.client), ancienneEmpreinte });
    expect(r.statut, r.texte).toBe(200);
    expect(r.json).toMatchObject({ service: 'simulateur', ancienRetire: true });
    expect(r.json.empreinte).not.toBe(ancienneEmpreinte);
    expect(r.texte).not.toContain(appareils.client!.endpoint);
    expect((await duClient()).map((l) => [l.id, l.empreinte_point_acces])).toEqual([[r.json.id, r.json.empreinte]]);
    // Rejoué (le service worker puis l'écran, par exemple) : toujours un seul abonnement, le même.
    const rejoue = await api('client', 'POST', REMPLACEMENT, { ...corpsAbonnement(appareils.client), ancienneEmpreinte });
    expect(rejoue.json).toMatchObject({ id: r.json.id, ancienRetire: false });
    expect(await duClient()).toHaveLength(1);
    expect((await api('client', 'GET', '/v1/notifications/poussees')).json.appareils.map((x: any) => x.empreinte)).toEqual([r.json.empreinte]);
    const audit = (await editeur.query(`select action, acteur_id, cible_id, details from journal_audit where cabinet_id = $1 and action like 'notification_poussee.%' and acteur_id = $2 order by id desc limit 3`, [cabinet, DEMO.client])).rows.reverse();
    expect(audit[0]).toMatchObject({ action: 'notification_poussee.appareil_retire', cible_id: premier.json.id, details: { par: 'navigateur', motif: 'renouvellement' } });
    expect(audit[1]).toMatchObject({ action: 'notification_poussee.appareil_abonne', cible_id: r.json.id, details: { renouvellement: true, ancienRetire: true } });
    expect(JSON.stringify(audit)).not.toContain('127.0.0.1');

    // De bout en bout : l'événement suivant arrive au NOUVEL abonnement, et à lui seul.
    expect((await demanderComplement('chloe', 'Question après renouvellement de l’abonnement.')).statut).toBeLessThan(300);
    await attendre(async () => messagesDe('client').length, (n) => n === 1, 30_000);
    await pause(1500);
    expect(messagesDe('client')).toHaveLength(1);
    expect(messagesDe('clientAncien')).toEqual([]);
  });

  it('membre désactivé : ses abonnements pour ce cabinet sont retirés dans la même transaction, l’envoi en attente n’est jamais émis ; réactivé, rien n’est recréé', async () => {
    appareils.chloe = sim.abonner(vapid.publique);
    expect((await api('chloe', 'POST', '/v1/notifications/poussees/abonnements', corpsAbonnement(appareils.chloe))).statut).toBe(201);
    const deChloe = async () => (await lignesAbonnements()).filter((l) => l.utilisateur_id === DEMO.chloe);
    const [abonnementChloe] = await deChloe();
    // Un envoi est mis en attente pour Chloé (réponse du client à sa demande), puis elle est désactivée PENDANT la fenêtre de regroupement.
    expect((await demanderComplement('chloe', 'Question posée juste avant la désactivation.')).statut).toBeLessThan(300);
    expect((await api('client', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'reponse', message: 'Réponse arrivée juste avant la désactivation.' })).statut).toBeLessThan(300);
    expect((await lignesEnvois(DEMO.chloe)).at(-1)).toMatchObject({ issue: null });
    const d = await api('alice', 'PATCH', `/v1/cabinet/membres/${DEMO.chloe}`, { actif: false });
    expect(d.statut, d.texte).toBe(200);
    // Dès la réponse : plus aucun abonnement, envoi clos sans émission, retrait journalisé au nom de qui a désactivé.
    expect(await deChloe()).toEqual([]);
    expect((await lignesEnvois(DEMO.chloe)).at(-1)).toMatchObject({ issue: 'destinataire_inactif', appareils: 0 });
    const retrait = (await editeur.query(`select acteur_id, acteur_type, cible_id, details from journal_audit where cabinet_id = $1 and action = 'notification_poussee.appareil_retire' order by id desc limit 1`, [cabinet])).rows[0];
    expect(retrait).toMatchObject({ acteur_id: DEMO.alice, acteur_type: 'utilisateur', cible_id: abonnementChloe.id, details: { service: 'simulateur', par: 'systeme', motif: 'membre_desactive', membre: DEMO.chloe } });
    expect(JSON.stringify(retrait)).not.toContain('127.0.0.1');
    await apresFenetre();
    expect(messagesDe('chloe')).toEqual([]);

    // Réactivation : l'accès revient, AUCUN abonnement n'est recréé (la personne réactive elle-même son appareil).
    expect((await api('alice', 'PATCH', `/v1/cabinet/membres/${DEMO.chloe}`, { actif: true })).statut).toBe(200);
    expect(await deChloe()).toEqual([]);
    expect((await api('chloe', 'GET', '/v1/notifications/poussees')).json.appareils).toEqual([]);
    const envois = (await lignesEnvois(DEMO.chloe)).length;
    expect((await demanderComplement('chloe', 'Question après réactivation.')).statut).toBeLessThan(300);
    expect((await api('client', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'reponse', message: 'Réponse après réactivation.' })).statut).toBeLessThan(300);
    await apresFenetre();
    expect(messagesDe('chloe')).toEqual([]);
    expect(await lignesEnvois(DEMO.chloe)).toHaveLength(envois); // sans appareil abonné, aucun envoi n'est mis en file
  });

  it('journaux des deux processus : ni point d’accès, ni clé d’appareil, ni clé privée VAPID, ni nom de dossier ou de fichier', async () => {
    const tout = journaux.api + journaux.worker;
    expect(journaux.worker).toContain('Notifications poussées : SIMULATEUR de test');
    expect(tout).toMatch(/\[pousses\] tâche livrer pousse-[0-9a-f-]{36}-[0-9a-f-]{36} terminée/);
    for (const a of Object.values(appareils)) {
      for (const secret of [a.endpoint, a.endpoint.split('/').pop()!, a.keys.p256dh, a.keys.auth]) expect(tout.includes(secret)).toBe(false);
    }
    for (const secret of [vapid.privee, sim.origine, NOM, FICHIER, MONTANT]) expect(tout.includes(secret), secret.slice(0, 12)).toBe(false);
    // Tout ce que le simulateur a reçu appartient à l'ensemble fermé des charges utiles.
    for (const m of sim.messages) expect(m.clair).toMatch(/^\{"v":1,"t":"(notification|plusieurs|complement|reponse)","i":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"\}$/);
    expect(sim.refus).toEqual([]);
  });
});
