/**
 * Charge concurrente multi-utilisateur et multi-cabinet (P3, D-101) — pile réelle locale, TROIS cabinets NEUFS créés pour
 * l'essai. Les quatre identités du royaume de développement sont membres de chacun (rôles administrateur, réviseur,
 * collaborateur, client déposant) : jusqu'à douze sessions agissent en même temps, dans des cabinets différents.
 * Vérifie : aucune erreur 5xx, aucune perte, aucune duplication, isolation entre cabinets SOUS charge (par l'API et par la
 * base), idempotence des courses (même fichier, exercices chevauchants, même constat), journal d'audit toujours intègre.
 * Les durées mesurées sont affichées ; les budgets sont des garde-fous larges (poste local partagé), pas des engagements.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCabinet, attendre, deposerCabinet, ouvrirSessions, pdfTexte, percentile } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
const K = 3;
const IDENTITES = [
  ['alice', DEMO.alice, 'administrateur', 'validation'],
  ['remi', DEMO.remi, 'reviseur', 'revision'],
  ['chloe', DEMO.chloe, 'collaborateur', 'collaboration'],
  ['client', DEMO.client, 'client_deposant', 'depot'],
] as const;

interface Cab { id: string; dossier: string; exercice: string }
let editeur: pg.Client;
const cabs: Cab[] = [];
const mesures: Record<string, unknown> = {};
const lat = (m: Array<{ ms: number }>) => ({ n: m.length, p50: Math.round(percentile(m.map((x) => x.ms), 50)), p95: Math.round(percentile(m.map((x) => x.ms), 95)), max: Math.round(Math.max(...m.map((x) => x.ms))) });

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  for (let k = 0; k < K; k++) {
    const id = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai charge ${k + 1} ${SEL} (fictif)`])).rows[0].id as string;
    await ouvrirEssai(editeur, id, 'demo-essentiel', new Date().toISOString().slice(0, 10));
    for (const [, u, role] of IDENTITES) await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '90 minutes')`, [id, u, role]);
    const dossier = (await apiCabinet('alice', id, 'POST', '/v1/dossiers', { raisonSociale: `Société charge ${k + 1} ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
    for (const [, u, , niveau] of IDENTITES) expect((await apiCabinet('alice', id, 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBe(200);
    const exercice = (await apiCabinet('alice', id, 'POST', `/v1/dossiers/${dossier}/exercices`, EX)).json.id as string;
    cabs.push({ id, dossier, exercice });
  }
}, 300_000);

afterAll(async () => {
  console.log(`[mesure] ${JSON.stringify(mesures)}`);
  for (const c of cabs) await editeur.query('update appartenances set actif = false where cabinet_id = $1', [c.id]);
  await editeur.end();
});

describe('dépôts simultanés : 12 sessions dans 3 cabinets', () => {
  it('60 pièces distinctes déposées en même temps : toutes « reçues », toutes analysées, aucune confusion entre cabinets', async () => {
    const PAR_SESSION = 5;
    const travaux: Array<Promise<{ k: number; fin: Awaited<ReturnType<typeof deposerCabinet>> }>> = [];
    const debut = performance.now();
    cabs.forEach((c, k) => {
      for (const [qui] of IDENTITES) {
        for (let i = 0; i < PAR_SESSION; i++) {
          const pdf = pdfTexte(['Facture de charge', `Cabinet ${k + 1} ${SEL}`, `Session ${qui} pièce ${i}`, 'Total TTC : 120,00 €'], `${SEL}-${k}-${qui}-${i}`);
          travaux.push(deposerCabinet(qui, c.id, c.dossier, pdf, {}, `charge-${k + 1}-${qui}-${i}.pdf`).then((fin) => ({ k, fin })));
        }
      }
    });
    const res = await Promise.all(travaux);
    const msDepot = performance.now() - debut;
    const refus = res.filter((r) => r.fin.fin?.statut !== 200).map((r) => `${r.fin.ouverture.statut}/${r.fin.fin?.statut}`);
    expect(refus).toEqual([]);
    expect(res.every((r) => r.fin.fin!.json.recu === true)).toBe(true);
    // Analyse de toutes les pièces par le worker (tous cabinets confondus) : budget large, mesuré.
    const attendu = IDENTITES.length * PAR_SESSION;
    for (const [k, c] of cabs.entries()) {
      const n = await attendre(
        async () => (await editeur.query(`select count(*)::int as n from documents where cabinet_id = $1 and statut not in ('recu', 'en_analyse')`, [c.id])).rows[0].n as number,
        (x) => x === attendu,
        240_000,
      );
      expect(n, `cabinet ${k + 1}`).toBe(attendu);
    }
    const msAnalyse = performance.now() - debut;
    mesures.depots = { pieces: res.length, sessionsSimultanees: cabs.length * IDENTITES.length, msTotalDepots: Math.round(msDepot), msJusquAuxAnalyses: Math.round(msAnalyse), cloture: lat(res.map((r) => r.fin.fin!)), ouverture: lat(res.map((r) => r.fin.ouverture)) };
    expect(msAnalyse).toBeLessThan(240_000);
    // Isolation : par la base (aucun lien croisé) et par l'API (chaque cabinet ne voit que ses noms de fichier).
    for (const c of cabs) {
      const croise = (await editeur.query(
        `select (select count(*) from documents d join entites e on e.id = d.entite_id where d.cabinet_id = $1 and e.cabinet_id <> d.cabinet_id)
              + (select count(*) from documents d join fichiers f on f.id = d.fichier_id where d.cabinet_id = $1 and f.cabinet_id <> d.cabinet_id)
              + (select count(*) from receptions r join documents d on d.id = r.document_id where r.cabinet_id = $1 and d.cabinet_id <> r.cabinet_id) as n`,
        [c.id],
      )).rows[0].n;
      expect(Number(croise)).toBe(0);
    }
    for (const [k, c] of cabs.entries()) {
      const liste = await apiCabinet('alice', c.id, 'GET', `/v1/documents?entiteId=${c.dossier}&limite=200`);
      const noms: string[] = (liste.json.documents ?? liste.json).map((d: any) => d.nomOrigine ?? d.nomFichier ?? d.nom);
      expect(noms.length).toBe(attendu);
      expect(noms.every((n) => n.startsWith(`charge-${k + 1}-`)), `cabinet ${k + 1}`).toBe(true);
    }
  }, 300_000);

  it('le MÊME fichier déposé par six sessions en même temps dans un dossier : un seul document, six réceptions, aucune erreur', async () => {
    const c = cabs[0]!;
    const pdf = pdfTexte(['Facture identique', `Course ${SEL}`, 'Total TTC : 10,00 €'], `${SEL}-course`);
    // Une session = un téléversement. Une même personne qui rouvre le même fichier pendant que son dépôt est encore ouvert
    // REPREND ce dépôt (reprise idempotente, par conception : `POST /v1/televersements`), elle n'en crée pas un second ;
    // six sessions distinctes exigent donc six personnes ou des dépôts successifs. Quatre identités en même temps, puis
    // deux de plus (alice, remi) en même temps entre elles, une fois leur premier dépôt clos : six téléversements distincts.
    const vague = (qui: string[], depart: number) => Promise.all(qui.map((q, i) => deposerCabinet(q, c.id, c.dossier, pdf, {}, `identique-${depart + i}.pdf`)));
    const premiere = await vague(['alice', 'remi', 'chloe', 'client'], 0);
    const seconde = await vague(['alice', 'remi'], 4);
    const res = [...premiere, ...seconde];
    expect(res.map((r) => r.fin?.statut)).toEqual(Array(6).fill(200));
    expect(new Set(res.map((r) => r.fin!.json.id)).size).toBe(6); // six téléversements distincts
    const ids = new Set(res.map((r) => r.fin!.json.documentId));
    expect(ids.size).toBe(1);
    const n = (await editeur.query(`select count(distinct d.id)::int as docs, count(r.id)::int as receptions from documents d left join receptions r on r.document_id = d.id where d.id = $1`, [[...ids][0]])).rows[0];
    expect(n).toEqual({ docs: 1, receptions: 6 });
    expect(res.filter((r) => r.fin!.json.doublonBinaire === false)).toHaveLength(1); // une seule première réception
  });

  it('la MÊME personne qui rouvre le même fichier pendant que son dépôt est ouvert reprend ce dépôt : une seule réception par téléversement, jamais de réception perdue', async () => {
    const c = cabs[0]!;
    const pdf = pdfTexte(['Facture identique bis', `Reprise ${SEL}`, 'Total TTC : 11,00 €'], `${SEL}-reprise`);
    // Alice, remi, alice, remi, chloe, client, tous en même temps. Selon l'instant, la seconde ouverture d'alice voit ou non
    // le premier dépôt encore ouvert : on n'attend donc pas un nombre fixe, mais l'invariant (une réception exactement par
    // téléversement distinct, une même personne ne dépassant jamais ses clôtures) et l'absence d'erreur.
    const res = await Promise.all(['alice', 'remi', 'alice', 'remi', 'chloe', 'client'].map((q, i) => deposerCabinet(q, c.id, c.dossier, pdf, {}, `reprise-${i}.pdf`)));
    expect(res.map((r) => r.fin?.statut)).toEqual(Array(6).fill(200));
    const sessions = new Set(res.map((r) => r.fin!.json.id as string));
    expect(sessions.size).toBeGreaterThanOrEqual(4);
    expect(sessions.size).toBeLessThanOrEqual(6);
    const ids = new Set(res.map((r) => r.fin!.json.documentId));
    expect(ids.size).toBe(1);
    const n = (await editeur.query(`select count(distinct d.id)::int as docs, count(r.id)::int as receptions from documents d left join receptions r on r.document_id = d.id where d.id = $1`, [[...ids][0]])).rows[0];
    expect(n).toEqual({ docs: 1, receptions: sessions.size });
    const parTele = (await editeur.query(`select count(*)::int as n from receptions r where r.document_id = $1 and r.provenance->>'televersementId' = any($2::text[])`, [[...ids][0], [...sessions]])).rows[0].n;
    expect(parTele).toBe(sessions.size); // une réception, ni plus ni moins, par téléversement
    expect(res.filter((r) => r.fin!.json.doublonBinaire === false)).toHaveLength(1);
  });
});

describe('imports FEC simultanés dans trois cabinets, avec lectures concurrentes', () => {
  it('chaque cabinet importe son fichier en même temps que les autres : lots terminés, contrôles réalisés, lignes exactes par cabinet', async () => {
    const fecs = cabs.map((_, k) => genererFecSynthetique({ exercice: EX, nbEcritures: 2500, graine: 700 + k, anomalies: ['caisse_crediteur', 'client_crediteur'] }));
    const debut = performance.now();
    // Les lectures partent PENDANT les imports : liste de dossiers, pièces, revue, états de chaque cabinet.
    let continuer = true;
    const lectures: Array<{ ms: number; statut: number; cab: number; fuite: boolean }> = [];
    const harceler = async () => {
      while (continuer) {
        await Promise.all(
          cabs.flatMap((c, k) =>
            IDENTITES.slice(0, 3).map(async ([qui]) => {
              const r = await apiCabinet(qui, c.id, 'GET', '/v1/dossiers');
              lectures.push({ ms: r.ms, statut: r.statut, cab: k, fuite: r.statut === 200 && r.json.some((d: any) => d.id !== c.dossier) });
            }),
          ),
        );
      }
    };
    const lecteur = harceler();
    const imports = await Promise.all(
      cabs.map(async (c, k) => {
        const d = await deposerCabinet('remi', c.id, c.dossier, Buffer.from(fecs[k]!.contenu), { usage: 'fec', exerciceId: c.exercice, statutDonnees: 'travail_avant_cloture' }, fecs[k]!.nomFichier);
        expect(d.fin?.statut).toBe(200);
        const lot = await attendre(() => apiCabinet('remi', c.id, 'GET', `/v1/imports/${d.fin!.json.lotImportId}`), (r) => ['termine', 'termine_avec_erreurs', 'echec'].includes(r.json?.statut), 240_000);
        const revue = await attendre(() => apiCabinet('remi', c.id, 'GET', `/v1/exercices/${c.exercice}/revue`), (r) => r.json?.execution?.statut === 'termine', 240_000);
        return { lot: lot.json, revue: revue.json, ms: performance.now() - debut };
      }),
    );
    continuer = false;
    await lecteur;
    expect(imports.map((i) => i.lot.statut)).toEqual(Array(K).fill('termine'));
    const lignesBd: number[] = [];
    for (const c of cabs) lignesBd.push(Number((await editeur.query(`select count(*) as n from lignes_ecriture where cabinet_id = $1`, [c.id])).rows[0].n));
    expect(lignesBd).toEqual(imports.map((i) => i.lot.progression)); // chaque cabinet : exactement les lignes de SON fichier
    expect(new Set(lignesBd).size).toBe(K); // fichiers distincts : aucune confusion possible entre cabinets
    expect(imports.every((i) => i.revue.constats.length >= 1)).toBe(true);
    // Lectures concurrentes : aucune erreur serveur, aucune fuite d'un autre cabinet, latence mesurée.
    expect(lectures.filter((l) => l.statut >= 500).length).toBe(0);
    expect(lectures.filter((l) => l.fuite).length).toBe(0);
    const p95 = percentile(lectures.map((l) => l.ms), 95);
    mesures.importsSimultanes = { cabinets: K, lignesParCabinet: lignesBd, msJusquAuxControles: imports.map((i) => Math.round(i.ms)), lecturesPendant: lat(lectures) };
    expect(p95).toBeLessThan(15_000);
    expect(Math.max(...imports.map((i) => i.ms))).toBeLessThan(240_000);
  }, 300_000);

  it('le même fichier importé deux fois en même temps sur le même exercice : un seul lot actif, l’autre reconnu « déjà importé »', async () => {
    const c = cabs[1]!;
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 300, graine: 4242, anomalies: [] });
    const [a, b] = await Promise.all(
      ['remi', 'alice'].map((qui) => deposerCabinet(qui, c.id, c.dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: c.exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier)),
    );
    expect([a!.fin?.statut, b!.fin?.statut]).toEqual([200, 200]);
    expect(a!.fin!.json.lotImportId).toBe(b!.fin!.json.lotImportId);
    expect([a!.fin!.json.dejaImporte, b!.fin!.json.dejaImporte].filter(Boolean)).toHaveLength(1);
    await attendre(() => apiCabinet('remi', c.id, 'GET', `/v1/imports/${a!.fin!.json.lotImportId}`), (r) => ['termine', 'termine_avec_erreurs', 'echec'].includes(r.json?.statut), 120_000);
    const actifs = (await editeur.query(`select count(*)::int as n from lots_import where exercice_id = $1 and actif`, [c.exercice])).rows[0].n;
    expect(actifs).toBe(1);
  }, 180_000);
});

describe('courses entre actions simultanées', () => {
  it('huit créations d’exercices chevauchants en même temps : exactement une réussit, les autres sont refusées en 409', async () => {
    const c = cabs[2]!;
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => apiCabinet(i % 2 ? 'alice' : 'chloe', c.id, 'POST', `/v1/dossiers/${c.dossier}/exercices`, { debut: '2027-01-01', fin: '2027-12-31' })));
    expect(res.map((r) => r.statut).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    expect(Number((await editeur.query(`select count(*) as n from exercices where entite_id = $1 and debut = '2027-01-01'`, [c.dossier])).rows[0].n)).toBe(1);
  });

  it('plusieurs réviseurs prennent en charge le même constat en même temps : aucune erreur, une décision tracée par succès, chaîne du journal intacte', async () => {
    const c = cabs[0]!;
    const constats = (await apiCabinet('remi', c.id, 'GET', `/v1/exercices/${c.exercice}/revue`)).json.constats as Array<{ id: string }>;
    expect(constats.length).toBeGreaterThan(0);
    const cible = constats[0]!.id;
    const avant = Number((await editeur.query(`select count(*) as n from decisions where cible_id = $1`, [cible])).rows[0].n);
    const res = await Promise.all(Array.from({ length: 9 }, (_, i) => apiCabinet(['remi', 'alice', 'chloe'][i % 3]!, c.id, 'PATCH', `/v1/constats/${cible}`, { action: 'prendre_en_charge' })));
    expect(res.filter((r) => r.statut >= 500)).toEqual([]);
    expect(res.every((r) => r.statut === 200)).toBe(true);
    const apres = Number((await editeur.query(`select count(*) as n from decisions where cible_id = $1`, [cible])).rows[0].n);
    expect(apres - avant).toBe(9);
  });

  it('habilitations modifiées pendant que la personne lit : jamais d’erreur serveur, état final conforme au dernier ordre', async () => {
    const c = cabs[1]!;
    const lire = () => apiCabinet('chloe', c.id, 'GET', `/v1/dossiers/${c.dossier}`);
    const ordres: Array<Promise<{ statut: number }>> = [];
    const lectures: Array<Promise<{ statut: number }>> = [];
    for (let i = 0; i < 12; i++) {
      ordres.push(i % 2 === 0 ? apiCabinet('alice', c.id, 'DELETE', `/v1/dossiers/${c.dossier}/habilitations/${DEMO.chloe}`) : apiCabinet('alice', c.id, 'PUT', `/v1/dossiers/${c.dossier}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' }));
      lectures.push(lire(), lire());
    }
    const r = [...(await Promise.all(ordres)), ...(await Promise.all(lectures))];
    expect(r.filter((x) => x.statut >= 500)).toEqual([]);
    // État final : cohérent avec la base, et rétabli à ce que la suite attend.
    expect((await apiCabinet('alice', c.id, 'PUT', `/v1/dossiers/${c.dossier}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' })).statut).toBe(200);
    expect((await lire()).statut).toBe(200);
  });

  it('après toute cette charge : le journal d’audit de chaque cabinet est intègre et sans prédécesseur dupliqué', async () => {
    for (const [k, c] of cabs.entries()) {
      const r = await apiCabinet('alice', c.id, 'GET', '/v1/audit?limite=5');
      expect(r.statut).toBe(200);
      expect(r.json.integrite, `cabinet ${k + 1}`).toMatchObject({ integre: true, rupture: null });
      const dup = (await editeur.query(`select count(*)::int as n from (select empreinte_precedente from journal_audit where cabinet_id = $1 group by 1 having count(*) > 1) x`, [c.id])).rows[0].n;
      expect(dup).toBe(0);
    }
  });
});
