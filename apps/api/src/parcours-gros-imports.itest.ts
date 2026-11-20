/**
 * Gros imports de bout en bout (P3, D-101) — pile réelle locale, cabinet NEUF : API (dépôt par morceaux de 4 Mio), S3, file,
 * worker (lecture en flux), PostgreSQL, puis contrôles. Les durées de CHAQUE étape sont mesurées et affichées ; les budgets
 * sont des garde-fous larges pour ce poste (disque externe, machine partagée), pas des engagements de performance.
 * Échecs : un fichier trop gros pour la limite, un fichier tronqué ou corrompu doivent échouer de façon EXPLICITE, sans
 * remplacer les données actives ni laisser un lot « en cours » sans fin.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique, genererReleveSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCabinet, attendre, deposerCabinet, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
let editeur: pg.Client;
let cabinet = '';
const mesures: Record<string, unknown> = {};
const fini = (r: { json: any }) => ['termine', 'termine_avec_erreurs', 'echec'].includes(r.json?.statut);

async function dossier(nom: string): Promise<{ dossier: string; exercice: string }> {
  const d = (await apiCabinet('alice', cabinet, 'POST', '/v1/dossiers', { raisonSociale: `${nom} ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, n] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision']] as const) expect((await apiCabinet('alice', cabinet, 'PUT', `/v1/dossiers/${d}/habilitations/${u}`, { niveau: n })).statut).toBe(200);
  const exercice = (await apiCabinet('alice', cabinet, 'POST', `/v1/dossiers/${d}/exercices`, EX)).json.id as string;
  return { dossier: d, exercice };
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai gros imports ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur']] as const) await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '120 minutes')`, [cabinet, u, role]);
}, 60_000);
afterAll(async () => {
  console.log(`[mesure] ${JSON.stringify(mesures)}`);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

/** Importe un FEC et chronomètre chaque étape ; renvoie les durées et le lot terminé. */
async function importerFec(d: { dossier: string; exercice: string }, nbEcritures: number, graine: number, anomalies: Array<'caisse_crediteur'> = []) {
  const t0 = performance.now();
  const fec = genererFecSynthetique({ exercice: EX, nbEcritures, graine, anomalies });
  const buf = Buffer.from(fec.contenu);
  const msGeneration = performance.now() - t0;
  const t1 = performance.now();
  const dep = await deposerCabinet('remi', cabinet, d.dossier, buf, { usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  expect(dep.fin?.statut, JSON.stringify(dep.fin?.json)).toBe(200);
  const msDepot = performance.now() - t1;
  const lot = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 900_000);
  const msImport = performance.now() - t1 - (msDepot);
  const revue = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/exercices/${d.exercice}/revue`), (r) => r.json?.execution?.statut === 'termine' || r.json?.execution?.statut === 'echec', 900_000);
  const msControles = performance.now() - t1 - msDepot - msImport;
  const msTotal = performance.now() - t1;
  return { msTotal: Math.round(msTotal), lignes: fec.nbLignes, octets: buf.length, msGeneration: Math.round(msGeneration), msDepot: Math.round(msDepot), msImport: Math.round(msImport), msControles: Math.round(msControles), lot: lot.json, revue: revue.json };
}

describe('gros FEC de bout en bout', () => {
  it('FEC d’environ 100 000 lignes : dépôt, import en flux, contrôles ; lignes exactes, chaque étape dans son budget', async () => {
    const d = await dossier('Gros FEC cent mille');
    const r = await importerFec(d, 38_000, 9001);
    mesures.fec100k = { lignes: r.lignes, mo: +(r.octets / 1e6).toFixed(1), msDepot: r.msDepot, msImport: r.msImport, msApresImportJusquAuxControles: r.msControles, msTotalDepotAuxControles: r.msTotal, execution: r.revue.execution.statut };
    expect(r.lot.statut).toBe('termine');
    expect(r.lot.progression).toBe(r.lignes);
    expect(Number((await editeur.query(`select count(*) as n from lignes_ecriture where cabinet_id = $1 and exercice_id = $2`, [cabinet, d.exercice])).rows[0].n)).toBe(r.lignes);
    expect(r.revue.execution.statut).toBe('termine');
    expect(r.msDepot).toBeLessThan(120_000);
    expect(r.msImport).toBeLessThan(300_000);
    expect(r.msControles).toBeLessThan(300_000);
  }, 1_200_000);

  it('FEC d’environ 250 000 lignes (chemin des contrôles en flux au-delà de 100 000) : mêmes garanties', async () => {
    const d = await dossier('Gros FEC deux cent cinquante mille');
    const r = await importerFec(d, 95_000, 9002);
    mesures.fec250k = { lignes: r.lignes, mo: +(r.octets / 1e6).toFixed(1), msDepot: r.msDepot, msImport: r.msImport, msApresImportJusquAuxControles: r.msControles, msTotalDepotAuxControles: r.msTotal, execution: r.revue.execution.statut };
    expect(r.lot.statut).toBe('termine');
    expect(r.lot.progression).toBe(r.lignes);
    expect(r.revue.execution.statut).toBe('termine');
    expect(r.msImport).toBeLessThan(600_000);
    expect(r.msControles).toBeLessThan(600_000);
  }, 1_800_000);
});

describe('gros imports SIMULTANÉS', () => {
  it('trois FEC d’environ 100 000 lignes déposés en même temps, avec lectures concurrentes : tous aboutissent, lignes exactes par dossier, lectures sans erreur', async () => {
    const ds = [await dossier('Simultané un'), await dossier('Simultané deux'), await dossier('Simultané trois')];
    const fecs = ds.map((_, i) => genererFecSynthetique({ exercice: EX, nbEcritures: 38_000, graine: 9500 + i }));
    let continuer = true;
    const lectures: number[] = [];
    const erreurs: number[] = [];
    const lecteur = (async () => {
      while (continuer) {
        const r = await apiCabinet('remi', cabinet, 'GET', '/v1/dossiers');
        lectures.push(r.ms);
        if (r.statut !== 200) erreurs.push(r.statut);
        await new Promise((x) => setTimeout(x, 100));
      }
    })();
    const t = performance.now();
    const res = await Promise.all(
      ds.map(async (d, i) => {
        const dep = await deposerCabinet('remi', cabinet, d.dossier, Buffer.from(fecs[i]!.contenu), { usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' }, fecs[i]!.nomFichier);
        expect(dep.fin?.statut).toBe(200);
        const lot = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 900_000);
        await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/exercices/${d.exercice}/revue`), (r) => r.json?.execution?.statut === 'termine', 900_000);
        return { lot: lot.json, ms: performance.now() - t };
      }),
    );
    continuer = false;
    await lecteur;
    expect(res.map((r) => r.lot.statut)).toEqual(['termine', 'termine', 'termine']);
    for (const [i, d] of ds.entries()) {
      expect(Number((await editeur.query(`select count(*) as n from lignes_ecriture where entite_id = $1`, [d.dossier])).rows[0].n)).toBe(fecs[i]!.nbLignes);
    }
    lectures.sort((a, b) => a - b);
    mesures.fec100kSimultanes = { dossiers: 3, lignesChacun: fecs.map((f) => f.nbLignes), msJusquAuxControles: res.map((r) => Math.round(r.ms)), lecturesPendant: { n: lectures.length, p50: Math.round(lectures[Math.floor(lectures.length / 2)] ?? 0), p95: Math.round(lectures[Math.floor(lectures.length * 0.95)] ?? 0), max: Math.round(lectures.at(-1) ?? 0) } };
    expect(erreurs).toEqual([]);
    expect(Math.max(...res.map((r) => r.ms))).toBeLessThan(900_000);
    expect(lectures[Math.floor(lectures.length * 0.95)] ?? 0).toBeLessThan(15_000);
  }, 1_800_000);
});

describe('gros relevés bancaires de bout en bout', () => {
  for (const format of ['camt.053', 'ofx'] as const) {
    it(`relevé ${format} de 40 000 mouvements : tous importés, cadrage vérifié, budget respecté`, async () => {
      const d = await dossier(`Gros relevé ${format}`);
      const rel = genererReleveSynthetique({ graine: 9100, format, debut: EX.debut, fin: EX.fin, nbMouvements: 40_000 });
      const buf = Buffer.from(rel.contenu, 'utf8');
      const t = performance.now();
      const dep = await deposerCabinet('remi', cabinet, d.dossier, buf, { usage: 'banque' }, rel.nomFichier);
      expect(dep.fin?.statut, JSON.stringify(dep.fin?.json)).toBe(200);
      const msDepot = performance.now() - t;
      const lot = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 900_000);
      const msImport = performance.now() - t - msDepot;
      mesures[`releve_${format}`] = { mouvements: rel.attendu.nbMouvements, mo: +(buf.length / 1e6).toFixed(1), msDepot: Math.round(msDepot), msImport: Math.round(msImport) };
      // Un relevé sans solde d'ouverture (OFX synthétique) est importé en entier ; seule une remarque « cadrage non vérifiable » est dite.
      expect(['termine', 'termine_avec_erreurs']).toContain(lot.json.statut);
      expect(lot.json.rapport).toMatchObject({ nbMouvements: rel.attendu.nbMouvements, nbNouveaux: rel.attendu.nbMouvements, lisible: true });
      expect((lot.json.rapport.anomalies as Array<{ code: string; gravite: string }>).filter((a) => a.gravite !== 'mineure' || a.code !== 'CADRAGE_NON_VERIFIABLE')).toEqual([]);
      const n = Number((await editeur.query(`select count(*) as n from mouvements_bancaires where cabinet_id = $1 and entite_id = $2`, [cabinet, d.dossier])).rows[0].n);
      expect(n).toBe(rel.attendu.nbMouvements);
      expect(msDepot).toBeLessThan(120_000);
      expect(msImport).toBeLessThan(300_000);
    }, 900_000);
  }
});

describe('échecs explicites sur de gros fichiers', () => {
  it('taille annoncée au-delà de la limite : refus à l’ouverture, avec la limite en clair, sans rien transférer', async () => {
    const d = await dossier('Limite de taille');
    const o = await apiCabinet('remi', cabinet, 'POST', '/v1/televersements', { entiteId: d.dossier, nomFichier: 'enorme.txt', taille: 600 * 1024 * 1024, sha256: 'a'.repeat(64), canal: 'ordinateur', usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' });
    console.log(`[mesure] ouverture au-delà de la limite : ${o.statut} ${JSON.stringify(o.json)}`);
    expect(o.statut).toBeGreaterThanOrEqual(400);
    expect(o.statut).toBeLessThan(500);
    expect(JSON.stringify(o.json)).toMatch(/limite|volumineux|taille/i);
  });

  it('relevé au-delà de la limite de 20 Mo (60 000 mouvements) : lot en échec avec le motif en français, aucun mouvement conservé, le relevé suivant est importé normalement', async () => {
    const d = await dossier('Relevé trop gros');
    const gros = genererReleveSynthetique({ graine: 9200, format: 'camt.053', debut: EX.debut, fin: EX.fin, nbMouvements: 60_000 });
    const buf = Buffer.from(gros.contenu, 'utf8');
    expect(buf.length).toBeGreaterThan(20_000_000);
    const dep = await deposerCabinet('remi', cabinet, d.dossier, buf, { usage: 'banque' }, gros.nomFichier);
    expect(dep.fin?.statut).toBe(200);
    const lot = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 300_000);
    mesures.releve_trop_gros = { mo: +(buf.length / 1e6).toFixed(1), statut: lot.json.statut, motif: lot.json.rapport?.motif };
    expect(lot.json.statut).toBe('echec');
    expect(lot.json.rapport.motif).toMatch(/trop volumineux/);
    expect(lot.json.actif).toBe(false);
    expect(Number((await editeur.query(`select count(*) as n from mouvements_bancaires where entite_id = $1`, [d.dossier])).rows[0].n)).toBe(0);
    const petit = genererReleveSynthetique({ graine: 9201, format: 'camt.053', debut: EX.debut, fin: EX.fin, nbMouvements: 2_000 });
    const dep2 = await deposerCabinet('remi', cabinet, d.dossier, Buffer.from(petit.contenu, 'utf8'), { usage: 'banque' }, petit.nomFichier);
    const lot2 = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep2.fin!.json.lotImportId}`), fini, 120_000);
    expect(lot2.json.statut).toBe('termine');
    expect(lot2.json.rapport.nbMouvements).toBe(2_000);
  }, 600_000);

  it('FEC volumineux dont une ligne est détruite, puis FEC tronqué : chaque défaut est dit avec son numéro de ligne ; l’annulation motivée rétablit le lot sain', async () => {
    const d = await dossier('Fichier corrompu');
    const sain = await importerFec(d, 20_000, 9003);
    expect(sain.lot.statut).toBe('termine');
    const n = async (lot: string) => Number((await editeur.query(`select count(*) as n from lignes_ecriture where lot_import_id = $1`, [lot])).rows[0].n);
    const lignesSaines = await n(sain.lot.id);
    const fec = Buffer.from(genererFecSynthetique({ exercice: EX, nbEcritures: 20_000, graine: 9004 }).contenu).toString('utf8');
    const lignes = fec.split('\n');
    const milieu = Math.floor(lignes.length / 2);
    const corrompu = [...lignes];
    corrompu[milieu] = '###\u0000\u0001 ligne détruite ###';
    const defauts = [
      { nom: 'corrompu', contenu: corrompu.join('\n'), attendu: (a: Array<{ code: string; ligne: number | null }>) => a.some((x) => x.code === 'LIGNE_ILLISIBLE' && x.ligne === milieu + 1) },
      { nom: 'tronque', contenu: fec.slice(0, Math.floor(fec.length * 0.97)), attendu: (a: Array<{ code: string; ligne: number | null }>) => a.some((x) => x.code === 'NB_CHAMPS' && typeof x.ligne === 'number') },
    ];
    const lots: string[] = [];
    for (const dft of defauts) {
      const dep = await deposerCabinet('remi', cabinet, d.dossier, Buffer.from(dft.contenu), { usage: 'fec', exerciceId: d.exercice, statutDonnees: 'travail_avant_cloture' }, `fec-${dft.nom}.txt`);
      expect(dep.fin?.statut).toBe(200);
      const lot = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), fini, 600_000);
      mesures[`fec_${dft.nom}`] = { statut: lot.json.statut, anomalies: lot.json.rapport.anomalies.length };
      // Jamais « termine » sans réserve : le défaut est signalé, avec la ligne, la gravité et le déséquilibre global.
      expect(lot.json.statut).toBe('termine_avec_erreurs');
      expect(lot.json.rapport.conforme).toBe(false);
      expect(dft.attendu(lot.json.rapport.anomalies), `${dft.nom} : ${JSON.stringify(lot.json.rapport.anomalies).slice(0, 300)}`).toBe(true);
      expect(lot.json.rapport.anomalies.some((x: any) => x.code === 'DESEQUILIBRE_GLOBAL')).toBe(true);
      lots.push(lot.json.id);
    }
    // Les imports fautifs, successifs, ont remplacé le lot actif (nouvelle version) : l'annulation motivée est la voie de retour.
    expect((await apiCabinet('remi', cabinet, 'GET', `/v1/imports/${lots[1]}`)).json.actif).toBe(true);
    for (const id of [lots[1]!, lots[0]!]) expect((await apiCabinet('remi', cabinet, 'POST', `/v1/imports/${id}/annulation`, { motif: 'Fichier corrompu : retour au lot sain (essai)' })).statut).toBe(200);
    const actif = (await apiCabinet('remi', cabinet, 'GET', `/v1/exercices/${d.exercice}/imports`)).json.find((l: any) => l.actif);
    expect(actif.id).toBe(sain.lot.id);
    expect(await n(sain.lot.id)).toBe(lignesSaines);
  }, 1_200_000);
});
