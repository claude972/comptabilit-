import type { AccesBd } from '@comtaple/db';
import type { EvenementAuditIa, FournisseurIa } from '@comtaple/ia';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ALERTE_PREUVE_IA_JOURS, assemblerIa, creerIa, empreinteConfigurationIa, evaluerExpirationPreuveIa, JournalIaBd, jugerVerificationIa, lireTarifsIa, type VerificationIa } from './ia.js';

/** Base factice : enregistre les lignes qu'on lui demande d'insérer (aucune base réelle dans ce test unitaire). */
function fausseBd() {
  const lots: Array<{ contexte: unknown; lignes: unknown[] }> = [];
  const bd = {
    avecContexte: async (contexte: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ insert: () => ({ values: async (lignes: unknown[]) => void lots.push({ contexte, lignes }) }) }),
  } as unknown as AccesBd;
  return { bd, lots };
}
const contexte = { cabinetId: 'c1', dossierId: 'd1', utilisateurId: 'u1' };
const appel = (nature: 'reel' | 'simulateur' | null): EvenementAuditIa => ({
  type: 'appel_ia', id: 't1', horodatage: '2026-11-19T10:00:00.000Z', tache: 'assistant', operation: 'completion', prompt: { id: 'p', version: '1.0.0' }, fournisseur: nature ? 'f' : null, nature, modele: 'm',
  contexte, empreintePrompt: 'abc', tailles: { messages: 2, caracteresEntree: 10, caracteresSortie: 0, fonctionsDeclarees: 1, appelsFonctions: 0, textes: 0 },
  pseudonymes: {} as never, dureeMs: 12, jetons: { entree: nature ? 5 : null, sortie: null }, coutEstime: nature === 'reel' ? { montant: '0.000012', devise: 'EUR', tarifsRelevesLe: '2026-11-19' } : null,
  resultat: nature ? 'ok' : 'erreur', codes: nature ? [] : ['non_connecte'],
});
const fonction = (mode: 'ia' | 'sans_ia'): EvenementAuditIa => ({ type: 'fonction_metier', id: 't2', horodatage: '2026-11-19T10:00:00.000Z', tache: 'assistant', fonction: 'lireBalance', mode, issue: 'refusee', code: 'dossier_hors_perimetre', contexte, tailles: { arguments: 3, elements: 0, elementsEcartes: 0 } });

describe('tarifs IA', () => {
  it('vide : aucun tarif, donc aucun coût estimé', () => {
    expect(lireTarifsIa({ IA_TARIFS: '' })).toBeNull();
    expect(lireTarifsIa({ IA_TARIFS: '   ' })).toBeNull();
  });
  it('lit des tarifs datés, et refuse une valeur illisible sans la reproduire', () => {
    const tarifs = { relevesLe: '2026-11-19', devise: 'EUR', source: 'catalogue', parMillionDeJetons: { m: { entree: '0.09', sortie: '0.28' } } };
    expect(lireTarifsIa({ IA_TARIFS: JSON.stringify(tarifs) })).toEqual(tarifs);
    expect(() => lireTarifsIa({ IA_TARIFS: '{secret' })).toThrow(/^Configuration invalide : IA_TARIFS n’est pas un objet JSON\.$/);
    expect(() => lireTarifsIa({ IA_TARIFS: JSON.stringify({ ...tarifs, relevesLe: 'hier', cle: 'secret-xyz' }) })).toThrow(/IA_TARIFS/);
    try {
      lireTarifsIa({ IA_TARIFS: JSON.stringify({ ...tarifs, devise: 'secret-xyz' }) });
    } catch (e) {
      expect(String(e)).not.toContain('secret-xyz');
    }
  });
});

describe('journal d’audit IA', () => {
  it('sans fournisseur, un appel est compté « sans_ia » et « indisponible », jamais comme un appel réel', () => {
    const j = new JournalIaBd(fausseBd().bd, null);
    expect(j.ligne(appel(null))).toMatchObject({ cabinetId: 'c1', entiteIdCible: 'd1', utilisateurId: 'u1', type: 'appel_ia', nature: 'sans_ia', resultat: 'indisponible', codes: ['non_connecte'], coutEstime: null });
    expect(j.ligne(fonction('sans_ia'))).toMatchObject({ type: 'fonction_metier', nature: 'sans_ia', resultat: 'refusee', codes: ['dossier_hors_perimetre'], modele: null });
  });
  it('un appel au simulateur est étiqueté « simulateur » ; un appel réel porte son coût estimé', () => {
    const sim = new JournalIaBd(fausseBd().bd, 'simulateur');
    expect(sim.ligne(appel('simulateur'))).toMatchObject({ nature: 'simulateur', resultat: 'ok', jetonsEntree: 5 });
    expect(sim.ligne(fonction('ia'))).toMatchObject({ nature: 'simulateur' });
    expect(sim.ligne(fonction('sans_ia'))).toMatchObject({ nature: 'sans_ia' });
    const reel = new JournalIaBd(fausseBd().bd, 'reel');
    expect(reel.ligne(appel('reel'))).toMatchObject({ nature: 'reel', coutEstime: '0.000012', devise: 'EUR' });
  });
  it('écrit les événements par contexte et attend la fin des écritures', async () => {
    const { bd, lots } = fausseBd();
    const j = new JournalIaBd(bd, null);
    j.consigner(appel(null));
    j.consigner(fonction('sans_ia'));
    j.consigner({ ...fonction('sans_ia'), contexte: { ...contexte, cabinetId: 'c2' } });
    await j.vider();
    expect(lots.map((l) => [l.contexte, l.lignes.length])).toEqual([[{ cabinetId: 'c1', utilisateurId: 'u1' }, 2], [{ cabinetId: 'c2', utilisateurId: 'u1' }, 1]]);
    await j.vider();
    expect(lots).toHaveLength(2);
  });
  it('une écriture en échec ne lève pas', async () => {
    const bd = { avecContexte: async () => Promise.reject(Object.assign(new Error('refus'), { code: '42501' })) } as unknown as AccesBd;
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const j = new JournalIaBd(bd, null);
    j.consigner(appel(null));
    await expect(j.vider()).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledWith('[ia] trace d’audit non enregistrée : 42501');
    erreur.mockRestore();
  });
});

describe('assemblage de la passerelle', () => {
  it('sans jeton : « non_connecte », aucun modèle utilisable', () => {
    const ia = creerIa({ IA_OVH_ENDPOINT: '', IA_OVH_JETON: '', IA_TARIFS: '' }, fausseBd().bd);
    expect(ia.statut().statut).toBe('non_connecte');
    expect(ia.natureFournisseur).toBeNull();
    expect(ia.modeleUtilisable()).toBe(false);
    expect(ia.active()).toBe(ia.passerelle);
  });
  it('fournisseur configuré mais NON vérifié : jamais sollicité par une tâche', async () => {
    const completer = vi.fn();
    const fournisseur = { nature: 'reel', nom: 'essai', urlBase: 'https://exemple.invalid/v1', completer, vectoriser: vi.fn() } as unknown as FournisseurIa;
    const ia = assemblerIa(fausseBd().bd, fournisseur, null);
    expect(ia.statut().statut).toBe('configure_non_verifie');
    expect(ia.modeleUtilisable()).toBe(false);
    expect(ia.active()).not.toBe(ia.passerelle);
    const issue = await ia.active().completerJson({ tache: 'essai', prompt: null, contexte: { cabinetId: 'c1' }, messages: [{ role: 'user', contenu: 'x' }], schema: z.strictObject({ a: z.string() }), nomSchema: 'essai' });
    expect(issue).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
    expect(completer).not.toHaveBeenCalled();
    await ia.journal.vider();
  });
});

describe('preuve de connexion persistée : jugement d’une ligne relue de la base', () => {
  const URL_BASE = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
  const fournisseur = { nature: 'reel' as const, urlBase: URL_BASE };
  const E = empreinteConfigurationIa({ urlBase: URL_BASE, jeton: 'jeton-fictif-de-test' });
  const maintenant = new Date('2026-11-19T12:00:00.000Z');
  const ligne = (p: Partial<VerificationIa> = {}): VerificationIa => ({
    id: 'v1', verifieeLe: '2026-11-10T09:00:00.000Z', resultat: 'connecte', raisons: [], urlBase: URL_BASE, hote: 'oai.endpoints.kepler.ai.cloud.ovh.net', urlsAppelees: [`${URL_BASE}/chat/completions`, `${URL_BASE}/embeddings`],
    modeleLangage: 'Mistral-Small-3.2-24B-Instruct-2506', modeleEmbeddings: 'bge-m3', dimensionsEmbeddings: 1024, reponseSimulateur: false, empreinteConfiguration: E, valideJusquAu: '2026-12-10T09:00:00.000Z', ...p,
  });
  const juger = (courante: VerificationIa | null, autre: VerificationIa | null = null, quand = maintenant, jours = 30) => jugerVerificationIa(fournisseur, E, courante, autre, quand, jours);

  it('empreinte : stable, sensible à l’URL et au jeton, sans jamais contenir le jeton', () => {
    expect(E).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinteConfigurationIa({ urlBase: ` ${URL_BASE} `, jeton: 'jeton-fictif-de-test' })).toBe(E);
    expect(empreinteConfigurationIa({ urlBase: URL_BASE, jeton: 'jeton-fictif-de-test-2' })).not.toBe(E);
    expect(empreinteConfigurationIa({ urlBase: 'https://autre.exemple.test/v1', jeton: 'jeton-fictif-de-test' })).not.toBe(E);
    expect(E).not.toContain('jeton');
  });
  it('valide : preuve retenue, date et fin de validité données', () => {
    const j = juger(ligne());
    expect(j.preuve).toMatchObject({ urlBase: URL_BASE, reponseSimulateur: false, dimensionsEmbeddings: 1024 });
    expect(j.vue).toMatchObject({ etat: 'valide', verifieeLe: '2026-11-10T09:00:00.000Z', valideJusquAu: '2026-12-10T09:00:00.000Z', atteste: { hote: 'oai.endpoints.kepler.ai.cloud.ovh.net' } });
  });
  it('absente, autre configuration, non concluante, périmée, datée du futur, non conforme : jamais de preuve', () => {
    expect(juger(null).vue.etat).toBe('absente');
    expect(juger(null, ligne({ empreinteConfiguration: 'f'.repeat(64) })).vue.etat).toBe('autre_configuration');
    expect(juger(ligne({ empreinteConfiguration: 'f'.repeat(64) })).vue.etat).toBe('absente'); // une ligne d'une autre empreinte n'est jamais « la courante »
    expect(jugerVerificationIa(fournisseur, null, ligne(), null, maintenant, 30).preuve).toBeNull();
    expect(juger(ligne({ resultat: 'echec' })).vue.etat).toBe('non_concluante');
    expect(juger(ligne({ resultat: 'refusee' })).vue.etat).toBe('non_concluante');
    expect(juger(ligne(), null, new Date('2026-12-10T09:00:00.000Z')).vue.etat).toBe('perimee'); // la borne est exclue
    expect(juger(ligne({ valideJusquAu: '2027-02-01T00:00:00.000Z' }), null, new Date('2026-12-11T00:00:00.000Z')).vue.etat).toBe('perimee'); // la durée configurée borne aussi
    expect(juger(ligne(), null, maintenant, 5).vue.etat).toBe('perimee');
    expect(juger(ligne({ verifieeLe: '2026-11-25T09:00:00.000Z' })).vue.etat).toBe('non_conforme');
    for (const p of [{ reponseSimulateur: true }, { urlBase: 'https://autre.exemple.test/v1' }, { urlsAppelees: [] }, { urlsAppelees: ['https://autre.exemple.test/v1/embeddings'] }, { modeleLangage: 'autre' }, { modeleEmbeddings: null }, { dimensionsEmbeddings: 768 }]) {
      const j = juger(ligne(p));
      expect(j.preuve, JSON.stringify(p)).toBeNull();
      expect(j.vue.etat).toBe('non_conforme');
    }
    for (const j of [juger(null), juger(ligne({ resultat: 'echec' })), juger(ligne(), null, new Date('2027-01-01T00:00:00.000Z'))]) expect(j.preuve).toBeNull();
  });
  it('assemblage : la preuve lue en base commande le statut ; base illisible → jamais « connecte » ; le simulateur ne lit jamais la table', async () => {
    const brut = { id: 'v1', verifiee_le: new Date(Date.now() - 3600_000), resultat: 'connecte', raisons: [], url_base: URL_BASE, hote: 'oai.endpoints.kepler.ai.cloud.ovh.net', urls_appelees: [`${URL_BASE}/chat/completions`], modele_langage: 'Mistral-Small-3.2-24B-Instruct-2506', modele_embeddings: 'bge-m3', dimensions_embeddings: 1024, reponse_simulateur: false, empreinte_configuration: E, valide_jusqu_au: new Date(Date.now() + 86_400_000) };
    const requetes: string[] = [];
    const avecPool = (query: (t: string) => Promise<{ rows: unknown[] }>) => ({ ...fausseBd().bd, pool: { query: async (t: string) => (requetes.push(t), query(t)) } }) as unknown as AccesBd;
    const reel = { nature: 'reel', nom: 'essai', urlBase: URL_BASE, completer: vi.fn(), vectoriser: vi.fn() } as unknown as FournisseurIa;
    const ia = assemblerIa(avecPool(async () => ({ rows: [brut] })), reel, null, { empreinteConfiguration: E });
    expect(ia.statut().statut).toBe('configure_non_verifie'); // avant la première lecture : jamais « connecte » par défaut
    await ia.rafraichirPreuve();
    expect(ia.statut()).toEqual({ statut: 'connecte', raisons: [] });
    expect(ia.active()).toBe(ia.passerelle);
    expect(requetes.every((t) => /^select /.test(t))).toBe(true); // lecture seule

    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const illisible = assemblerIa(avecPool(async () => Promise.reject(Object.assign(new Error('refus'), { code: '42501' }))), reel, null, { empreinteConfiguration: E });
    await illisible.rafraichirPreuve();
    expect(illisible.statut().statut).toBe('configure_non_verifie');
    expect(erreur).toHaveBeenCalledWith('[ia] preuve de connexion illisible : 42501');
    erreur.mockRestore();

    requetes.length = 0;
    const sim = { nature: 'simulateur', nom: 'SIMULATEUR', urlBase: null, completer: vi.fn(), vectoriser: vi.fn() } as unknown as FournisseurIa;
    const simule = assemblerIa(avecPool(async () => ({ rows: [brut] })), sim, null, { empreinteConfiguration: E });
    await simule.rafraichirPreuve();
    expect(simule.statut().statut).toBe('simule');
    expect(simule.preuve()).toBeNull();
    const sans = assemblerIa(avecPool(async () => ({ rows: [brut] })), null, null, { empreinteConfiguration: E });
    await sans.rafraichirPreuve();
    expect(sans.statut().statut).toBe('non_connecte');
    expect(requetes).toEqual([]);
  });
});

describe('alerte d’expiration de la preuve (D-096) : calcul déterministe, sans appel', () => {
  const FIN = '2026-12-10T09:00:00.000Z';
  const J = 86_400_000;
  const fin = Date.parse(FIN);
  it('temps restant exact, jours arrondis au supérieur, borne du seuil comprise', () => {
    expect(evaluerExpirationPreuveIa(FIN, fin - 8 * J, 7)).toMatchObject({ restantMs: 8 * J, restantJours: 8, expireBientot: false, seuilJours: 7, expireLe: FIN });
    expect(evaluerExpirationPreuveIa(FIN, fin - 7 * J - 1, 7).expireBientot).toBe(false); // une milliseconde au-delà du seuil
    expect(evaluerExpirationPreuveIa(FIN, fin - 7 * J, 7)).toMatchObject({ restantJours: 7, expireBientot: true }); // la borne est comprise
    expect(evaluerExpirationPreuveIa(FIN, fin - 23 * 3_600_000, 7)).toMatchObject({ restantJours: 1, expireBientot: true }); // jamais « 0 jour » tant que la preuve vaut
    expect(evaluerExpirationPreuveIa(FIN, fin - 1, 7)).toMatchObject({ restantJours: 1, expireBientot: true });
  });
  it('échue ou datée de la fin : pas « expire bientôt » (c’est « périmée », autre état), 0 jour', () => {
    expect(evaluerExpirationPreuveIa(FIN, fin, 7)).toMatchObject({ restantMs: 0, restantJours: 0, expireBientot: false });
    expect(evaluerExpirationPreuveIa(FIN, fin + J, 7)).toMatchObject({ restantMs: -J, restantJours: 0, expireBientot: false });
  });
  it('seuil paramétrable et borné ; entrées invalides refusées', () => {
    expect(evaluerExpirationPreuveIa(FIN, fin - 20 * J, 30).expireBientot).toBe(true);
    expect(evaluerExpirationPreuveIa(FIN, fin - 20 * J, 1).expireBientot).toBe(false);
    for (const seuil of [0, -1, 91, 1.5, Number.NaN]) expect(() => evaluerExpirationPreuveIa(FIN, fin, seuil)).toThrow(/Seuil/);
    expect(() => evaluerExpirationPreuveIa('pas une date', fin, 7)).toThrow(/Date invalide/);
    expect(ALERTE_PREUVE_IA_JOURS).toBe(7);
  });
  it('jugement : seule une preuve VALIDE porte un temps restant ; ni absente, ni périmée, ni autre configuration, ni simulateur', () => {
    const URL_BASE = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
    const fournisseur = { nature: 'reel' as const, urlBase: URL_BASE };
    const E = empreinteConfigurationIa({ urlBase: URL_BASE, jeton: 'jeton-fictif-de-test' });
    const ligne = (p: Partial<VerificationIa> = {}): VerificationIa => ({
      id: 'v-alerte', verifieeLe: '2026-11-10T09:00:00.000Z', resultat: 'connecte', raisons: [], urlBase: URL_BASE, hote: 'oai.endpoints.kepler.ai.cloud.ovh.net', urlsAppelees: [`${URL_BASE}/chat/completions`, `${URL_BASE}/embeddings`],
      modeleLangage: 'Mistral-Small-3.2-24B-Instruct-2506', modeleEmbeddings: 'bge-m3', dimensionsEmbeddings: 1024, reponseSimulateur: false, empreinteConfiguration: E, valideJusquAu: '2026-12-10T09:00:00.000Z', ...p,
    });
    const juger = (courante: VerificationIa | null, quand: string, seuil?: number) => jugerVerificationIa(fournisseur, E, courante, null, new Date(quand), 30, seuil);
    // Valide le 2026-11-19 (21 jours restants) : pas encore ; le 2026-12-03 09:00 (7 jours) : bientôt ; le 2026-12-09 : 1 jour.
    expect(juger(ligne(), '2026-11-19T09:00:00.000Z').vue).toMatchObject({ etat: 'valide', verificationId: 'v-alerte', expiration: { restantJours: 21, expireBientot: false, seuilJours: 7 } });
    expect(juger(ligne(), '2026-12-03T09:00:00.000Z').vue.expiration).toMatchObject({ restantJours: 7, expireBientot: true });
    expect(juger(ligne(), '2026-12-09T09:00:01.000Z').vue.expiration).toMatchObject({ restantJours: 1, expireBientot: true });
    expect(juger(ligne(), '2026-11-19T09:00:00.000Z', 30).vue.expiration!.expireBientot).toBe(true); // seuil paramétrable
    // La borne la plus courte (durée de configuration) commande le temps restant.
    expect(jugerVerificationIa(fournisseur, E, ligne({ valideJusquAu: '2027-03-01T00:00:00.000Z' }), null, new Date('2026-11-19T09:00:00.000Z'), 30).vue.expiration).toMatchObject({ restantJours: 21 });
    // Aucune preuve valide : rien à signaler.
    for (const [courante, quand] of [[null, '2026-12-05T09:00:00.000Z'], [ligne({ resultat: 'echec' }), '2026-12-05T09:00:00.000Z'], [ligne(), '2026-12-10T09:00:00.000Z'], [ligne(), '2027-01-01T00:00:00.000Z'], [ligne({ empreinteConfiguration: 'f'.repeat(64) }), '2026-12-05T09:00:00.000Z']] as const) {
      const v = juger(courante, quand).vue;
      expect(v.expiration, `${v.etat}`).toBeNull();
      expect(v.verificationId).toBeNull();
    }
  });
});
