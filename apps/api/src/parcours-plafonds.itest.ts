/**
 * Plafonds des calculs immédiats de l'API (D-093) — pile réelle locale, cabinet NEUF.
 *
 * Deux API supplémentaires sont lancées contre la même base, avec des variables dédiées :
 *  - « juste » : chaque plafond est réglé EXACTEMENT sur le volume du jeu d'essai (le volume égal au plafond passe) ;
 *  - « bas »   : chaque plafond est réglé UNE UNITÉ en dessous (le volume dépasse le plafond d'une unité).
 * Sous le plafond, le résultat doit être identique à celui de l'API de la pile normale ; au-delà, le refus est un 409 motivé
 * en français (volume, plafond, variable), jamais un 500 ni un résultat partiel.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererFecSynthetique, genererReleveSynthetique, genererTexteFactureSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apiSur, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const racineApi = join(dirname(fileURLToPath(import.meta.url)), '..');
const EX_N = { debut: '2025-01-01', fin: '2025-12-31' };
const EX_P = { debut: '2024-01-01', fin: '2024-12-31' };

let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exN = '';
let exP = '';
let regleId = '';
/** Volumes réels du jeu d'essai. */
const V = { lignesN: 0, lignesP: 0, mouvements: 0, pieces: 2, constats: 0 };

interface Pile { url: string; processus: ChildProcess; journal: string }
const piles: Pile[] = [];
let juste: Pile;
let bas: Pile;
const sur = (p: Pile, qui: string, methode: string, chemin: string, corps?: unknown) => apiSur(p.url, qui, methode, chemin, corps);

async function lancerApi(variables: Record<string, string>): Promise<Pile> {
  const libre = createServer();
  await new Promise<void>((r) => libre.listen(0, '127.0.0.1', () => r()));
  const port = (libre.address() as { port: number }).port;
  await new Promise<void>((r) => libre.close(() => r()));
  const pile: Pile = { url: `http://127.0.0.1:${port}`, journal: '', processus: null as unknown as ChildProcess };
  const env = { ...process.env, NODE_ENV: 'test', API_PORT: String(port), METRIQUES_PORT_API: '0', FILES_PREFIXE: `essai-plafonds-${SEL}-${port}`, ...variables };
  pile.processus = spawn(process.execPath, ['dist/main.js'], { cwd: racineApi, env, stdio: ['ignore', 'pipe', 'pipe'] });
  pile.processus.stdout?.on('data', (d: Buffer) => (pile.journal += d.toString()));
  pile.processus.stderr?.on('data', (d: Buffer) => (pile.journal += d.toString()));
  piles.push(pile);
  try {
    await attendre(() => fetch(`${pile.url}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok, 40_000);
  } catch (e) {
    throw new Error(`API d'essai non démarrée : ${(e as Error).message}\n${pile.journal.slice(-1500)}`);
  }
  return pile;
}

const fr = (iso: string) => iso.split('-').reverse().join('/');
const enteteFacture = (graine: number) => genererTexteFactureSynthetique({ graine }).pages[0]!.texte.split('\n').slice(0, 10);
function facture(graine: number, numero: string, date: string): string[] {
  return [...enteteFacture(graine), `FACTURE N° ${numero}`, `Date de facture : ${fr(date)}`, `Date d'échéance : ${fr('2025-12-31')}`, '', 'Désignation                 Montant HT', 'Prestation de service       100,00', '', 'Total HT : 100,00 €', 'TVA 20 % sur 100,00 : 20,00', 'Total TVA : 20,00 €', 'Total TTC : 120,00 €'];
}

/** Retire ce qui change à chaque appel (horodatages) avant de comparer deux réponses. */
const stable = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (cle, x) => (cle === 'mesureLe' ? undefined : x)));

/**
 * Retire de la réponse tout ce qui relève de la colonne N-1 (comparatif, valeurs `n1`, indication d'exercice précédent
 * fourni, réserves « N-1 ») : c'est la seule chose qui change quand le plafond écarte l'exercice précédent.
 */
const sansN1 = (v: unknown): unknown => {
  const ESSAI_N1 = /^(Colonne N-1 indisponible|Exercice N-1)/;
  return JSON.parse(JSON.stringify(stable(v), (cle, x) => {
    if (cle === 'comparatif' || cle === 'n1' || cle === 'exercicePrecedentFourni' || cle === 'motifExercicePrecedentNonFourni') return undefined;
    return Array.isArray(x) ? x.filter((e) => !(typeof e === 'string' && ESSAI_N1.test(e))) : x;
  }));
};

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai plafonds ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '40 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai plafonds ${SEL} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const graine = Number.parseInt(SEL.slice(0, 6), 16);
  const importer = async (ex: typeof EX_N, nb: number, g: number): Promise<{ exercice: string; lignes: number }> => {
    const exercice = (await api('remi', 'POST', `/v1/dossiers/${dossier}/exercices`, ex)).json.id as string;
    const fec = genererFecSynthetique({ exercice: ex, nbEcritures: nb, graine: g, anomalies: ['caisse_crediteur', 'client_crediteur'] });
    const d = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    const lot = await attendreLot('remi', d.fin.json.lotImportId);
    expect(lot.json.statut).toBe('termine');
    const revue = await attendre(() => api('remi', 'GET', `/v1/exercices/${exercice}/revue`), (x) => x.json?.execution?.statut === 'termine' || x.json?.execution === null, 120_000);
    if (revue.json.execution === null) {
      const lance = await api('remi', 'POST', `/v1/exercices/${exercice}/controles`);
      await attendre(() => api('remi', 'GET', `/v1/exercices/${exercice}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 120_000);
    }
    return { exercice, lignes: lot.json.progression as number };
  };
  const p = await importer(EX_P, 120, graine + 1);
  exP = p.exercice;
  V.lignesP = p.lignes;
  const n = await importer(EX_N, 160, graine);
  exN = n.exercice;
  V.lignesN = n.lignes;
  V.constats = (await api('remi', 'GET', `/v1/exercices/${exN}/revue`)).json.constats.length;
  // Deux factures d'achat de l'exercice (analyse réelle par le worker).
  const ids: string[] = [];
  for (const [i, num] of ['PLAF-001', 'PLAF-002'].entries()) {
    const d = await deposer('chloe', dossier, pdfTexte(facture(101 + i, num, `2025-0${i + 3}-10`), `${SEL}-${i}`), { nature: 'facture_achat' }, `plafonds-${i}.pdf`);
    expect(d.fin.statut).toBe(200);
    ids.push(d.fin.json.documentId);
  }
  for (const id of ids) await attendre(() => api('remi', 'GET', `/v1/documents/${id}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
  // Un relevé bancaire (mouvements non rapprochés : base du rapprochement et des suggestions).
  const releve = genererReleveSynthetique({ graine: 5, format: 'camt.053', debut: EX_N.debut, fin: EX_N.fin, nbMouvements: 12 });
  const dr = await deposer('remi', dossier, Buffer.from(releve.contenu, 'utf8'), { usage: 'banque' }, releve.nomFichier);
  expect((await attendreLot('remi', dr.fin.json.lotImportId)).json.statut).toBe('termine');
  const lance = await api('remi', 'POST', `/v1/exercices/${exN}/rapprochements`, {});
  expect(lance.statut).toBe(202);
  await attendre(() => api('remi', 'GET', `/v1/exercices/${exN}/rapprochements`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine');
  V.mouvements = (await editeur.query('select count(*)::int as n from mouvements_bancaires where entite_id = $1', [dossier])).rows[0].n;
  // Règle proposée (mesure d'impact).
  const regle = await api('chloe', 'POST', '/v1/regles', { controleId: 'TIE-001', entiteId: dossier, motif: 'Petits avoirs clients en attente de remboursement, sans enjeu', parametres: { seuil: '100000.00' } });
  expect(regle.statut).toBe(201);
  regleId = regle.json.id;

  expect(V.lignesN).toBeGreaterThan(300);
  expect(V.lignesP).toBeGreaterThan(200);
  expect(V.mouvements).toBeGreaterThan(1);
  expect(V.constats).toBeGreaterThan(1);
  const reglage = (d: number): Record<string, string> => ({
    API_LIGNES_MAX_CALCUL: String(V.lignesN + d),
    API_LIGNES_MAX_IMPACT_REGLE: String(V.lignesN + d),
    API_LIGNES_MAX_PORTEFEUILLE_DOSSIER: String(V.lignesN + d),
    API_MOUVEMENTS_MAX_CALCUL: String(V.mouvements + d),
    API_PIECES_MAX_TIERS: String(V.pieces + d),
    API_CONSTATS_MAX_REVUE: String(V.constats + d),
    API_LIGNES_MAX_SIMULTANEES: String(V.lignesN + d),
  });
  [juste, bas] = await Promise.all([lancerApi(reglage(0)), lancerApi(reglage(-1))]);
}, 600_000);

afterAll(async () => {
  for (const pile of piles) pile.processus.kill('SIGKILL');
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

/** Routes de lecture déterministes : (méthode, chemin, qui). */
const lectures = (): Array<[string, string, string]> => [
  ['états de travail', `/v1/exercices/${exN}/etats`, 'remi'],
  ['états ajustés', `/v1/exercices/${exN}/etats?ajuste=1`, 'remi'],
  ['balance ajustée', `/v1/exercices/${exN}/balance-ajustee`, 'remi'],
  ['liasse', `/v1/exercices/${exN}/liasse`, 'remi'],
  ['annexe', `/v1/exercices/${exN}/annexe`, 'remi'],
  ['propositions d’inventaire', `/v1/exercices/${exN}/inventaire/propositions`, 'remi'],
  ['tiers', `/v1/exercices/${exN}/tiers`, 'remi'],
  ['factures', `/v1/exercices/${exN}/factures`, 'remi'],
  ['revue (constats)', `/v1/exercices/${exN}/revue`, 'remi'],
];

describe('plafonds des calculs immédiats : sous le plafond, résultat identique ; au-delà, refus motivé', () => {
  it('le volume égal au plafond passe, avec le même résultat que sur la pile normale', async () => {
    for (const [nom, chemin, qui] of lectures()) {
      const reference = await api(qui, 'GET', chemin);
      expect(reference.statut, `${nom} (référence)`).toBe(200);
      const r = await sur(juste, qui, 'GET', chemin);
      expect(r.statut, nom).toBe(200);
      // La colonne N-1 est la seule différence légitime : au plafond de l'exercice seul, l'exercice précédent ne tient
      // plus avec lui et n'est pas lu (motif dit) ; tout le reste, chiffres de N compris, doit être identique.
      expect(sansN1(r.json), nom).toEqual(sansN1(reference.json));
      const cmp = (j: unknown): { statut: string; motifs?: string[] } | undefined => (j as { comparatif?: { statut: string; motifs?: string[] } }).comparatif;
      if (cmp(reference.json) !== undefined) {
        const ref = cmp(reference.json)!;
        if (ref.statut === 'fourni') {
          // N-1 disponible sur la pile normale : sous plafond il n'est plus lu, avec son motif.
          expect(cmp(r.json), `${nom} (comparatif sous plafond)`).toMatchObject({ statut: 'indisponible' });
          expect(JSON.stringify(cmp(r.json)?.motifs), nom).toMatch(/exercice précédent .* n’a pas été lu .* dépasserait le plafond/);
        } else {
          // Ici N = 2025 : N-1 (2024) précède la première table de liasse vérifiée, donc « indisponible » PARTOUT, avec le même
          // motif légitime ; le plafond n'y change rien. LIMITE : la branche « fourni → indisponible sous plafond » n'est
          // PAS exercée par cet essai (exercice 2025) ; elle reste à couvrir par un essai sur un exercice dont N-1 est >= 2025.
          expect(ref.statut, `${nom} (comparatif de référence : ${JSON.stringify(ref.motifs)})`).toBe('indisponible');
          expect(cmp(r.json), `${nom} (comparatif sous plafond)`).toEqual(ref);
        }
      }
    }
  });

  it('un volume au-dessus du plafond est refusé en 409 avec le volume, le plafond et la variable ; jamais de 500', async () => {
    for (const [nom, chemin, qui] of lectures()) {
      const r = await sur(bas, qui, 'GET', chemin);
      expect(r.statut, `${nom} : ${JSON.stringify(r.json).slice(0, 200)}`).toBe(409);
      // La revue ne lit aucune ligne : seul son plafond de constats est franchi.
      const a = nom === 'revue (constats)' ? { variable: 'API_CONSTATS_MAX_REVUE', volume: V.constats, plafond: V.constats - 1 } : { variable: 'API_LIGNES_MAX_CALCUL', volume: V.lignesN, plafond: V.lignesN - 1 };
      expect(r.json, nom).toMatchObject({ code: 'volume_trop_important', ...a });
      expect(r.json.message, nom).toMatch(/refusé : .* au-delà du plafond de .* Aucun résultat partiel/);
      expect(r.json.message, nom).toContain(a.variable);
    }
  });

  it('tiers et factures : les pièces candidates sont comptées en base avant toute lecture ; au plafond, résultat identique', async () => {
    const piecesSeules = await lancerApi({ API_PIECES_MAX_TIERS: String(V.pieces - 1) });
    for (const chemin of [`/v1/exercices/${exN}/tiers`, `/v1/exercices/${exN}/factures`]) {
      const r = await sur(piecesSeules, 'remi', 'GET', chemin);
      expect(r.statut, chemin).toBe(409);
      expect(r.json, chemin).toMatchObject({ code: 'volume_trop_important', variable: 'API_PIECES_MAX_TIERS', volume: V.pieces, plafond: V.pieces - 1 });
      expect(r.json.message).toContain('pièces (factures et avoirs)');
    }
    // Le plafond de pièces est propre à ce suivi : les états de la même API répondent.
    expect((await sur(piecesSeules, 'remi', 'GET', `/v1/exercices/${exN}/etats`)).statut).toBe(200);
  });

  it('indicateurs : l’exercice précédent n’est lu que si les deux exercices tiennent ensemble, et le motif est dit', async () => {
    const ref = await api('remi', 'GET', `/v1/exercices/${exN}/indicateurs`);
    expect(ref.statut).toBe(200);
    expect(ref.json.donnees.exercicePrecedentFourni).toBe(true);
    // Plafond = exercice seul : l'exercice précédent ne tient plus avec lui.
    const r = await sur(juste, 'remi', 'GET', `/v1/exercices/${exN}/indicateurs`);
    expect(r.statut).toBe(200);
    expect(r.json.donnees.exercicePrecedentFourni).toBe(false);
    expect(r.json.donnees.motifExercicePrecedentNonFourni).toMatch(/exercice précédent .* n’a pas été lu .* dépasserait le plafond/);
    // Le premier exercice, lui, n'a pas de précédent : même résultat qu'avant sous le plafond.
    const premier = await sur(juste, 'remi', 'GET', `/v1/exercices/${exP}/indicateurs`);
    expect(premier.statut).toBe(200);
    expect(stable(premier.json)).toEqual(stable((await api('remi', 'GET', `/v1/exercices/${exP}/indicateurs`)).json));
    const refus = await sur(bas, 'remi', 'GET', `/v1/exercices/${exN}/indicateurs`);
    expect(refus.statut).toBe(409);
    expect(refus.json).toMatchObject({ code: 'volume_trop_important', variable: 'API_LIGNES_MAX_CALCUL' });
  });

  it('commentaire d’indicateurs : accepté au plafond, refusé au-dessus', async () => {
    const chemin = `/v1/exercices/${exN}/indicateurs/commentaire`;
    expect((await sur(juste, 'chloe', 'POST', chemin)).statut).toBe(200);
    const refus = await sur(bas, 'chloe', 'POST', chemin);
    expect(refus.statut).toBe(409);
    expect(refus.json).toMatchObject({ code: 'volume_trop_important', variable: 'API_LIGNES_MAX_CALCUL' });
  });

  it('suggestions de rapprochement : le lot entier est borné (l’ancienne garde ne comptait que les lignes de banque)', async () => {
    const chemin = `/v1/exercices/${exN}/rapprochements/suggestions`;
    const ok = await sur(juste, 'chloe', 'POST', chemin);
    expect(ok.statut, JSON.stringify(ok.json).slice(0, 300)).toBe(200);
    const refus = await sur(bas, 'chloe', 'POST', chemin);
    expect(refus.statut, JSON.stringify(refus.json).slice(0, 300)).toBe(409);
    expect(refus.json).toMatchObject({ code: 'volume_trop_important', variable: 'API_LIGNES_MAX_CALCUL', volume: V.lignesN });
  });

  it('mesure d’impact d’une règle : lignes et mouvements bancaires bornés ; résultat identique sous le plafond', async () => {
    const chemin = `/v1/regles/${regleId}/impact`;
    const reference = await api('chloe', 'POST', chemin, { exerciceId: exN });
    expect(reference.statut).toBe(200);
    const ok = await sur(juste, 'chloe', 'POST', chemin, { exerciceId: exN });
    expect(ok.statut).toBe(200);
    expect(stable(ok.json)).toEqual(stable(reference.json));
    const refus = await sur(bas, 'chloe', 'POST', chemin, { exerciceId: exN });
    expect(refus.statut).toBe(409);
    // Les mouvements sont vérifiés d'abord : seul leur plafond est franchi sur « bas » (les lignes le sont aussi, mais plus tard).
    expect(refus.json).toMatchObject({ code: 'volume_trop_important', variable: 'API_MOUVEMENTS_MAX_CALCUL', volume: V.mouvements, plafond: V.mouvements - 1 });
    // Plafond des lignes seul : on abaisse uniquement celui-ci sur une troisième API.
    const lignesSeules = await lancerApi({ API_LIGNES_MAX_IMPACT_REGLE: String(V.lignesN - 1) });
    const r = await sur(lignesSeules, 'chloe', 'POST', chemin, { exerciceId: exN });
    expect(r.statut).toBe(409);
    expect(r.json).toMatchObject({ code: 'volume_trop_important', variable: 'API_LIGNES_MAX_IMPACT_REGLE', volume: V.lignesN, plafond: V.lignesN - 1 });
    // Le plafond des états (400 000 par défaut) n'a pas bougé : la mesure d'un autre écran passe sur cette même API.
    expect((await sur(lignesSeules, 'remi', 'GET', `/v1/exercices/${exN}/etats`)).statut).toBe(200);
  });

  it('assistant d’un dossier : un indicateur au-dessus du plafond est dit « non calculé » (donnée manquante), jamais un chiffre partiel', async () => {
    const question = 'Quel est le chiffre d’affaires de l’exercice ?';
    const ok = await sur(juste, 'chloe', 'POST', `/v1/dossiers/${dossier}/assistant/questions`, { question });
    expect(ok.statut).toBe(200);
    expect(JSON.stringify(ok.json.reponse)).toContain(`indicateur:${exN}:SIG-CA`);
    const refus = await sur(bas, 'chloe', 'POST', `/v1/dossiers/${dossier}/assistant/questions`, { question });
    expect(refus.statut).toBe(200);
    expect(JSON.stringify(refus.json.reponse)).not.toContain(`indicateur:${exN}:SIG-CA`);
    expect(JSON.stringify(refus.json.reponse)).toMatch(/Indicateur non calculé : Indicateur refusé : .* au-delà du plafond/);
  });

  it('calculs simultanés : au plus le total admis est tenu en mémoire ; le reste est reporté (503, rien chargé), jamais une erreur 500', async () => {
    // « juste » n'admet que le volume d'un seul calcul à la fois : huit demandes simultanées.
    const reponses = await Promise.all(Array.from({ length: 8 }, () => sur(juste, 'remi', 'GET', `/v1/exercices/${exN}/etats`)));
    const statuts = reponses.map((r) => r.statut);
    expect(statuts.every((s) => s === 200 || s === 503), `statuts : ${statuts.join(',')}`).toBe(true);
    expect(statuts).toContain(200);
    for (const r of reponses.filter((x) => x.statut === 503)) {
      expect(r.json).toMatchObject({ code: 'calculs_simultanes_trop_lourds', variable: 'API_LIGNES_MAX_SIMULTANEES' });
      expect(r.json.message).toContain('réessayez');
    }
    // Une fois la rafale passée, plus rien n'est réservé : la même route répond à nouveau.
    expect((await sur(juste, 'remi', 'GET', `/v1/exercices/${exN}/etats`)).statut).toBe(200);
  });

  it('aucun refus n’est une erreur du serveur : les journaux des API d’essai ne contiennent aucune exception', async () => {
    for (const pile of piles) expect(pile.journal, pile.url).not.toMatch(/Unhandled|FATAL|heap out of memory|TypeError|RangeError/);
  });
});
