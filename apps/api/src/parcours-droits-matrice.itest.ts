/**
 * Matrice profils × fonctions (P3, D-101) — pile réelle locale, DEUX cabinets NEUFS créés pour l'essai (aucune donnée
 * existante lue ni modifiée ; appartenances d'essai désactivées à la fin).
 *
 * Chaque case (profil, fonction) est jouée sur l'API réelle et classée : « A » = la demande atteint la logique métier
 * (2xx, ou 400/409/422 d'état), « 403 » = refus d'habilitation (l'existence est connue), « 404 » = refus qui ne révèle pas
 * l'existence, « 401 » = non authentifié. Aucune case ne doit jamais donner une erreur 5xx. La table ATTENDU est la politique
 * documentée (docs/exigences.md, D-101) : elle a été relue ligne à ligne, ce n'est pas un instantané de la sortie.
 *
 * Profils (cabinet 1) : administrateur habilité « validation » (ADM), réviseur « revision » (REV), collaborateur
 * « collaboration » (COL), client déposant « depot » (DEP), support temporaire « lecture » (SUP), collaborateur SANS
 * habilitation sur le dossier voisin (COL-D2 : même cabinet, même rôle, autre dossier).
 * Profils (cabinet 2) : associé « validation » (ASS), collaborateur « lecture » (COL-L), client en lecture « lecture » (CLL),
 * membre dont l'appartenance a expiré (EXP), personne étrangère au cabinet qui force l'en-tête (ETR).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirAccesSupport, ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, attendre, attendreLot, deposer as deposerOutil, jetons, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const EX = { debut: '2025-01-01', fin: '2025-12-31' };

let editeur: pg.Client;
const cabinets: string[] = [];
/**
 * API d'essai dédiée (même base, mêmes files, même worker que la pile) : la limite de 20 questions par minute de l'assistant
 * est tenue en mémoire par PROCESSUS et par personne ; la matrice pose une question par profil et ne doit pas entamer le
 * quota des autres essais qui s'exécutent dans la même minute sur l'API de la pile.
 */
let base = API;
let processusApi: ChildProcess | null = null;
async function lancerApiDediee(): Promise<string> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  processusApi = spawn(process.execPath, ['dist/main.js'], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, NODE_ENV: 'test', API_PORT: String(port), METRIQUES_PORT_API: '0' }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  await attendre(() => fetch(`${url}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok, 40_000);
  return url;
}

/** Appel avec un cabinet EXPLICITE (en-tête X-Cabinet-Id) : plusieurs cabinets sont manipulés dans le même essai. */
async function appel(qui: string, cabinet: string, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: any }> {
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { ...(qui ? { authorization: `Bearer ${jetons[qui]}` } : {}), 'x-cabinet-id': cabinet, ...(corps !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const t = await r.text();
  let json: any = null;
  try { json = JSON.parse(t); } catch { /* corps non JSON */ }
  return { statut: r.status, json };
}

interface Cible { cabinet: string; dossier: string; exercice: string; doc: string; constat: string; autre: string }
interface Profil { id: string; qui: string; cible: Cible }

const MEMBRES = (c: string) => `/v1/dossiers/${c}`;

async function monter(cabinet: string, dossierNom: string, alice = 'alice'): Promise<{ dossier: string; exercice: string; doc: string; constat: string }> {
  const dossier = (await appel(alice, cabinet, 'POST', '/v1/dossiers', { raisonSociale: `${dossierNom} ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  expect((await appel(alice, cabinet, 'PUT', `${MEMBRES(dossier)}/habilitations/${DEMO.alice}`, { niveau: 'validation' })).statut).toBe(200);
  const exercice = (await appel(alice, cabinet, 'POST', `${MEMBRES(dossier)}/exercices`, EX)).json.id as string;
  return { dossier, exercice, doc: '', constat: '' };
}

async function preparer(cabinet: string, d: { dossier: string; exercice: string }, graine: number): Promise<{ doc: string; constat: string }> {
  const { choisirCabinet, api } = await import('./essais/outils.js');
  choisirCabinet('alice', cabinet);
  try {
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 60, graine, anomalies: ['caisse_crediteur', 'client_crediteur'] });
    const dep = await deposerOutil('alice', d.dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    expect((await attendreLot('alice', dep.fin.json.lotImportId)).json.statut).toBe('termine');
    const revue = await attendre(() => api('alice', 'GET', `/v1/exercices/${d.exercice}/revue`), (x) => x.json?.execution?.statut === 'termine' || x.json?.execution === null, 120_000);
    if (revue.json.execution === null) {
      const lance = await api('alice', 'POST', `/v1/exercices/${d.exercice}/controles`);
      await attendre(() => api('alice', 'GET', `/v1/exercices/${d.exercice}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 120_000);
    }
    const constats = (await api('alice', 'GET', `/v1/exercices/${d.exercice}/revue`)).json.constats as Array<{ id: string }>;
    expect(constats.length).toBeGreaterThanOrEqual(2);
    const piece = await deposerOutil('alice', d.dossier, pdfTexte(['Facture d’essai des droits', `Référence ${SEL}-${graine}`, 'Total TTC : 120,00 €'], `${SEL}-${graine}`), {}, 'droits.pdf');
    const doc = piece.fin.json.documentId as string;
    await attendre(() => api('alice', 'GET', `/v1/documents/${doc}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));
    return { doc, constat: constats[0]!.id };
  } finally {
    choisirCabinet('alice', null);
  }
}

const profils: Profil[] = [];
const cibles: Record<string, Cible> = {};

beforeAll(async () => {
  await ouvrirSessions();
  base = await lancerApiDediee();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  const creer = async (nom: string) => {
    const id = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`${nom} ${SEL} (fictif)`])).rows[0].id as string;
    await ouvrirEssai(editeur, id, 'demo-essentiel', new Date().toISOString().slice(0, 10));
    cabinets.push(id);
    return id;
  };
  const membre = (c: string, u: string, role: string, expire = `now() + interval '60 minutes'`) =>
    editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, ${expire})`, [c, u, role]);

  // Cabinet 1 : administrateur, réviseur, collaborateur, client déposant + support temporaire.
  const c1 = await creer('Cabinet d’essai droits 1');
  for (const [u, r] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) await membre(c1, u, r);
  await ouvrirAccesSupport(editeur, { cabinetId: c1, sujetOidc: DEMO.bruno, email: 'bruno.admin@cabinet-b.test', nom: 'Bruno Admin', heures: 1, motif: 'Essai de la matrice des droits (cabinet fictif)' });
  // Cabinet 2 : associé, collaborateur en lecture, client en lecture, membre expiré ; Bruno n'en est pas membre.
  const c2 = await creer('Cabinet d’essai droits 2');
  await membre(c2, DEMO.alice, 'associe');
  await membre(c2, DEMO.remi, 'collaborateur');
  await membre(c2, DEMO.chloe, 'client_lecture');
  await membre(c2, DEMO.client, 'reviseur', `now() - interval '1 minute'`);

  // Cabinet 1 : dossier D1 (habilitations par profil) et dossier voisin D2 (aucune habilitation hors gestionnaire).
  const d1 = await monter(c1, 'Société droits un');
  const d2 = await monter(c1, 'Société droits deux');
  for (const [u, n] of [[DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot'], [DEMO.bruno, 'lecture']] as const) {
    expect((await appel('alice', c1, 'PUT', `${MEMBRES(d1.dossier)}/habilitations/${u}`, { niveau: n })).statut, `habilitation ${n}`).toBe(200);
  }
  const p1 = await preparer(c1, d1, 11);
  const p2 = await preparer(c1, d2, 12);
  // Cabinet 2.
  const e1 = await monter(c2, 'Société droits trois');
  for (const [u, n] of [[DEMO.remi, 'lecture'], [DEMO.chloe, 'lecture']] as const) {
    expect((await appel('alice', c2, 'PUT', `${MEMBRES(e1.dossier)}/habilitations/${u}`, { niveau: n })).statut, `habilitation ${n} (cabinet 2)`).toBe(200);
  }
  const p3 = await preparer(c2, e1, 13);

  const cible1: Cible = { cabinet: c1, ...d1, ...p1, autre: d2.dossier };
  const cible2: Cible = { cabinet: c1, ...d2, ...p2, autre: d1.dossier };
  const cible3: Cible = { cabinet: c2, ...e1, ...p3, autre: e1.dossier };
  Object.assign(cibles, { cible1, cible2, cible3 });
  profils.push(
    { id: 'DEP', qui: 'client', cible: cible1 },
    { id: 'SUP', qui: 'bruno', cible: cible1 },
    { id: 'COL-D2', qui: 'chloe', cible: cible2 },
    { id: 'COL', qui: 'chloe', cible: cible1 },
    { id: 'REV', qui: 'remi', cible: cible1 },
    { id: 'ADM', qui: 'alice', cible: cible1 },
    { id: 'ETR', qui: 'bruno', cible: cible3 },
    { id: 'EXP', qui: 'client', cible: cible3 },
    { id: 'CLL', qui: 'chloe', cible: cible3 },
    { id: 'COL-L', qui: 'remi', cible: cible3 },
    { id: 'ASS', qui: 'alice', cible: cible3 },
  );
}, 900_000);

afterAll(async () => {
  processusApi?.kill('SIGKILL');
  for (const c of cabinets) await editeur.query('update appartenances set actif = false where cabinet_id = $1', [c]);
  await editeur.end();
});

type Verdict = 'A' | '401' | '403' | '404' | '5xx';
const verdict = (s: number): Verdict => (s === 401 ? '401' : s === 403 ? '403' : s === 404 ? '404' : s >= 500 ? '5xx' : 'A');

interface Fonction { nom: string; appeler: (p: Profil) => Promise<{ statut: number }> }
const f = (nom: string, appeler: (p: Profil, c: Cible) => Promise<{ statut: number }>): Fonction => ({ nom, appeler: (p) => appeler(p, p.cible) });
const a = (p: Profil, methode: string, chemin: string, corps?: unknown) => appel(p.qui, p.cible.cabinet, methode, chemin, corps);

const FONCTIONS: Fonction[] = [
  f('lire le dossier', (p, c) => a(p, 'GET', `/v1/dossiers/${c.dossier}`)),
  f('lister les pièces', (p, c) => a(p, 'GET', `/v1/documents?entiteId=${c.dossier}`)),
  f('lire une pièce', (p, c) => a(p, 'GET', `/v1/documents/${c.doc}`)),
  f('ouvrir un dépôt', (p, c) => a(p, 'POST', '/v1/televersements', { entiteId: c.dossier, nomFichier: 'matrice.pdf', taille: 20, sha256: sha(Buffer.from(`${SEL}-${p.id}`)), canal: 'ordinateur' })),
  f('rechercher dans le dossier', (p, c) => a(p, 'GET', `/v1/recherche?entiteId=${c.dossier}&q=facture`)),
  f('corriger l’extraction d’une pièce', (p, c) => a(p, 'PUT', `/v1/documents/${c.doc}/extraction`, { champs: { numero: `M-${p.id}` } })),
  f('valider une pièce', (p, c) => a(p, 'POST', `/v1/documents/${c.doc}/validation`, { decision: 'valider' })),
  f('créer un exercice', (p, c) => a(p, 'POST', `/v1/dossiers/${c.dossier}/exercices`, { debut: '2031-01-01', fin: '2031-12-31' })),
  f('lire la revue des contrôles', (p, c) => a(p, 'GET', `/v1/exercices/${c.exercice}/revue`)),
  f('lire les états', (p, c) => a(p, 'GET', `/v1/exercices/${c.exercice}/etats`)),
  f('lire les tiers et factures', (p, c) => a(p, 'GET', `/v1/exercices/${c.exercice}/tiers`)),
  f('prendre en charge un constat', (p, c) => a(p, 'PATCH', `/v1/constats/${c.constat}`, { action: 'prendre_en_charge' })),
  f('conclure un constat (motif)', (p, c) => a(p, 'PATCH', `/v1/constats/${c.constat}`, { action: 'accepter', motif: 'Essai de la matrice des droits' })),
  f('demander le dossier de révision', (p, c) => a(p, 'POST', `/v1/exercices/${c.exercice}/dossier-revision`)),
  f('poser une question à l’assistant', (p, c) => a(p, 'POST', `/v1/dossiers/${c.dossier}/assistant/questions`, { question: 'Quels sont les constats ouverts ?' })),
  f('demander la restitution du dossier (lecture de l’état)', (p, c) => a(p, 'GET', `/v1/dossiers/${c.dossier}/restitutions`)),
  f('créer un dossier', (p) => a(p, 'POST', '/v1/dossiers', { raisonSociale: `Création refusée ${SEL}`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })),
  f('modifier le dossier', (p, c) => a(p, 'PATCH', `/v1/dossiers/${c.dossier}`, { territoireFiscal: 'metropole' })),
  f('habiliter une personne', (p, c) => a(p, 'PUT', `/v1/dossiers/${c.dossier}/habilitations/${DEMO.client}`, { niveau: 'depot' })),
  f('lister les membres du dossier', (p, c) => a(p, 'GET', `/v1/dossiers/${c.dossier}/membres`)),
  f('lister les membres du cabinet', (p) => a(p, 'GET', '/v1/cabinet/membres')),
  f('lire le journal d’audit', (p) => a(p, 'GET', '/v1/audit?limite=5')),
  f('lire les indicateurs du cabinet', (p) => a(p, 'GET', '/v1/cabinet/indicateurs')),
  f('lire l’abonnement détaillé', (p) => a(p, 'GET', '/v1/abonnement')),
  f('lire les connexions de messagerie', (p) => a(p, 'GET', '/v1/mail/connexions')),
  f('lister les règles du cabinet', (p) => a(p, 'GET', '/v1/regles')),
  f('périmètre de la restitution du cabinet', (p) => a(p, 'GET', '/v1/cabinet/restitutions/perimetre')),
  f('lire ses notifications', (p) => a(p, 'GET', '/v1/notifications')),
];

/** Politique attendue, relue case par case. A = atteint la logique métier ; 4 = refus 403 ; 0 = refus 404 (existence non révélée). Colonnes : DEP SUP COL-D2 COL REV ADM ETR EXP CLL COL-L ASS. */
const ATTENDU: Record<string, string> = {
  'lire le dossier': 'A A 0 A A A 4 4 A A A',
  'lister les pièces': 'A A 0 A A A 4 4 A A A',
  'lire une pièce': '0 A 0 A A A 4 4 A A A',
  'ouvrir un dépôt': 'A 4 0 A A A 4 4 A A A',
  'rechercher dans le dossier': 'A A 0 A A A 4 4 A A A',
  'corriger l’extraction d’une pièce': '0 4 0 A A A 4 4 4 4 A',
  'valider une pièce': '0 4 0 4 A A 4 4 4 4 A',
  'créer un exercice': '4 4 0 A A A 4 4 4 4 A',
  'lire la revue des contrôles': '0 A 0 A A A 4 4 A A A',
  'lire les états': '0 A 0 A A A 4 4 A A A',
  'lire les tiers et factures': '0 A 0 A A A 4 4 A A A',
  'prendre en charge un constat': '0 4 0 A A A 4 4 4 4 A',
  'conclure un constat (motif)': '0 4 0 4 A A 4 4 4 4 A',
  'demander le dossier de révision': '0 4 0 A A A 4 4 4 4 A',
  'poser une question à l’assistant': '4 4 0 A A A 4 4 A A A',
  'demander la restitution du dossier (lecture de l’état)': '4 4 0 4 4 A 4 4 4 4 A',
  'créer un dossier': '4 4 4 4 4 A 4 4 4 4 A',
  'modifier le dossier': '4 4 4 4 4 A 4 4 4 4 A',
  'habiliter une personne': '4 4 4 4 4 A 4 4 4 4 A',
  'lister les membres du dossier': '4 A 0 A A A 4 4 A A A',
  'lister les membres du cabinet': '4 4 4 4 4 A 4 4 4 4 A',
  'lire le journal d’audit': '4 4 4 4 4 A 4 4 4 4 A',
  'lire les indicateurs du cabinet': '4 4 4 4 4 A 4 4 4 4 A',
  'lire l’abonnement détaillé': '4 4 4 4 4 A 4 4 4 4 A',
  'lire les connexions de messagerie': '4 4 4 4 4 A 4 4 4 4 A',
  'lister les règles du cabinet': '4 A A A A A 4 4 4 A A',
  'périmètre de la restitution du cabinet': '4 4 4 4 4 A 4 4 4 4 A',
  'lire ses notifications': 'A A A A A A 4 4 A A A',
};

const CODE: Record<Verdict, string> = { A: 'A', '403': '4', '404': '0', '401': 'N', '5xx': 'X' };

describe('matrice profils × fonctions : chaque case est celle de la politique, aucune ne donne une erreur 5xx', () => {
  it('toutes les cases, dans l’ordre des profils (du moins au plus privilégié du cabinet 1, puis cabinet 2)', async () => {
    const ecarts: string[] = [];
    for (const fn of FONCTIONS) {
      const attendu = ATTENDU[fn.nom]!.split(' ');
      expect(attendu).toHaveLength(profils.length);
      for (const [i, p] of profils.entries()) {
        const r = await fn.appeler(p);
        const obtenu = CODE[verdict(r.statut)];
        if (obtenu !== attendu[i]) ecarts.push(`${fn.nom} × ${p.id} : attendu ${attendu[i]}, obtenu ${r.statut}`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  it('chaque fonction de la matrice a une ligne attendue, et inversement', () => {
    expect(FONCTIONS.map((x) => x.nom).sort()).toEqual(Object.keys(ATTENDU).sort());
  });

  it('sans jeton ou avec un jeton falsifié : 401 partout, jamais une réponse métier', async () => {
    const faux = `${jetons.alice!.slice(0, -6)}AAAAAA`;
    for (const fn of FONCTIONS) {
      for (const [nom, qui] of [['sans jeton', ''], ['falsifié', 'faux']] as const) {
        jetons.faux = faux;
        const p: Profil = { id: nom, qui, cible: cibles.cible1! };
        const r = await fn.appeler(p);
        expect(r.statut, `${fn.nom} (${nom})`).toBe(401);
      }
    }
    delete jetons.faux;
  });
});

describe('multi-cabinet : un compte membre de plusieurs cabinets', () => {
  it('doit préciser le cabinet, ne voit que celui-ci, et les identifiants d’un autre cabinet y sont introuvables (404, jamais 403 ni 200)', async () => {
    const c1 = cibles.cible1!;
    const c3 = cibles.cible3!;
    // Alice est membre du cabinet de démonstration A, du cabinet 1 et du cabinet 2 : sans en-tête, la demande est ambiguë.
    const sans = await fetch(`${base}/v1/dossiers`, { headers: { authorization: `Bearer ${jetons.alice}` } });
    expect(sans.status).toBe(400);
    const dans1 = (await appel('alice', c1.cabinet, 'GET', '/v1/dossiers')).json.map((d: any) => d.id);
    const dans2 = (await appel('alice', c3.cabinet, 'GET', '/v1/dossiers')).json.map((d: any) => d.id);
    expect(dans1).toEqual(expect.arrayContaining([c1.dossier, c1.autre]));
    expect(dans1).not.toContain(c3.dossier);
    expect(dans2).toContain(c3.dossier);
    expect(dans2).not.toContain(c1.dossier);
    for (const chemin of [
      `/v1/dossiers/${c1.dossier}`,
      `/v1/documents/${c1.doc}`,
      `/v1/documents/${c1.doc}/contenu`,
      `/v1/exercices/${c1.exercice}/revue`,
      `/v1/exercices/${c1.exercice}/etats`,
      `/v1/constats/${c1.constat}`,
      `/v1/dossiers/${c1.dossier}/membres`,
    ]) {
      expect((await appel('alice', c3.cabinet, 'GET', chemin)).statut, chemin).toBe(404);
    }
    expect((await appel('alice', c3.cabinet, 'PATCH', `/v1/constats/${c1.constat}`, { action: 'prendre_en_charge' })).statut).toBe(404);
    expect((await appel('alice', c3.cabinet, 'POST', `/v1/documents/${c1.doc}/validation`, { decision: 'valider' })).statut).toBe(404);
    // Et dans l'autre sens : la même personne, mêmes identifiants, cabinet 1 → ils existent.
    expect((await appel('alice', c1.cabinet, 'GET', `/v1/documents/${c1.doc}`)).statut).toBe(200);
  });

  it('un en-tête de cabinet inventé ou mal formé est refusé (403 / 400), jamais interprété', async () => {
    expect((await appel('alice', '00000000-0000-4000-8000-000000000000', 'GET', '/v1/dossiers')).statut).toBe(403);
    expect((await appel('alice', 'pas-un-uuid', 'GET', '/v1/dossiers')).statut).toBeGreaterThanOrEqual(400);
    expect((await appel('alice', 'pas-un-uuid', 'GET', '/v1/dossiers')).statut).toBeLessThan(500);
  });
});

describe('habilitation par dossier : un même compte, le même rôle, deux dossiers', () => {
  it('retirer l’habilitation ferme l’accès au dossier sans toucher au dossier voisin ; la rétablir le rouvre', async () => {
    const c1 = cibles.cible1!;
    const peut = async (c: Cible) => (await appel('chloe', c1.cabinet, 'GET', `/v1/documents/${c.doc}`)).statut;
    expect(await peut(c1)).toBe(200);
    expect(await peut(cibles.cible2!)).toBe(404);
    expect((await appel('alice', c1.cabinet, 'PUT', `/v1/dossiers/${cibles.cible2!.dossier}/habilitations/${DEMO.chloe}`, { niveau: 'lecture' })).statut).toBe(200);
    expect(await peut(cibles.cible2!)).toBe(200);
    // « lecture » ne suffit pas à corriger : la politique se lit dossier par dossier.
    expect((await appel('chloe', c1.cabinet, 'PUT', `/v1/documents/${cibles.cible2!.doc}/extraction`, { champs: { numero: 'X' } })).statut).toBe(403);
    expect((await appel('alice', c1.cabinet, 'DELETE', `/v1/dossiers/${cibles.cible2!.dossier}/habilitations/${DEMO.chloe}`)).statut).toBe(204);
    expect(await peut(cibles.cible2!)).toBe(404);
    expect(await peut(c1)).toBe(200);
  });

  it('une appartenance qui expire pendant l’essai ferme l’accès immédiatement', async () => {
    const c1 = cibles.cible1!;
    expect((await appel('client', c1.cabinet, 'GET', `/v1/dossiers/${c1.dossier}`)).statut).toBe(200);
    await editeur.query(`update appartenances set expire_le = now() - interval '1 second' where cabinet_id = $1 and utilisateur_id = $2`, [c1.cabinet, DEMO.client]);
    expect((await appel('client', c1.cabinet, 'GET', `/v1/dossiers/${c1.dossier}`)).statut).toBe(403);
    expect((await appel('client', c1.cabinet, 'POST', '/v1/televersements', { entiteId: c1.dossier, nomFichier: 'x.pdf', taille: 20, sha256: sha(Buffer.from('x')), canal: 'ordinateur' })).statut).toBe(403);
  });
});
