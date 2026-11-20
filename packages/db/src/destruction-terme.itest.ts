/**
 * Destruction à terme des éléments conservés, scellement et destruction du journal, clôture avec certificat (D-100).
 *
 * BASE NEUVE et ISOLÉE (comtaple_essai_…), créée puis supprimée par le test. Rien n'est lu ni écrit dans la base
 * « comtaple ». Le temps est simulé par le paramètre `aujourdhui` : les durées du jeu d'essai sont courtes (jours), les
 * dates d'échéance sont atteintes en avançant « aujourd'hui », sans attendre.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BaseJetable, creerBaseJetable } from './base-jetable.js';
import { PARAMETRES_PROPOSES, type ParametresDurees, chargerParametres } from './durees-conservation.js';
import {
  type CertificatDestruction,
  cloturerCabinetEssai,
  detruireElementsConservesEssai,
  lireRapportDestruction,
  planDestructionTerme,
  verifierCertificat,
} from './destruction-terme.js';
import { echeancierConservation } from './echeancier-conservation.js';
import { ScellementPerime, detruireJournalEssai, scellerJournal, verifierScellement } from './journal-fin-de-vie.js';
import { type Cabinet, creerPeuplement } from './peuplement-essai.js';
import { OFFRES_DEMO, POLITIQUE_FIN_DE_CONTRAT, definirOffre, finDeContrat } from './provisionnement.js';
import { rendreEcheancierLisible, rendreFinDeVieJournalLisible, rendrePlanDestructionLisible, rendreSimulationLisible } from './rapport-lisible.js';
import { simulerConservationCabinet, simulerFinDeVieJournal } from './simulation-conservation.js';

const REF = 'AVIS-ESSAI-TERME-1';
let base: BaseJetable;
let admin: pg.Client;
let P: ReturnType<typeof creerPeuplement>;
let dossier: string;
let chargees: ReturnType<typeof chargerParametres>;

const jour = async (n: number) => (await admin.query<{ d: string }>('select (current_date + $1::int)::text as d', [n])).rows[0]!.d;
const strict = async (id: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [id])).rows[0]!.r;
const nb = async (table: string, id: string) => Number((await admin.query<{ n: string }>(`select count(*)::text as n from "${table}" where cabinet_id = $1`, [id])).rows[0]!.n);
/** Empreinte de toutes les lignes de toutes les tables d'UN cabinet : prouve qu'une opération n'a pas touché un autre cabinet. */
async function empreinteCabinet(id: string): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const t of P.tablesCabinet) r[t] = (await admin.query<{ e: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(h, '' order by h)), '') as e from (select md5(x::text) as h from "${t}" x where cabinet_id = $1) s`, [id])).rows[0]!.e;
  return r;
}
const confirmer = (c: Cabinet) => ({ cabinetId: c.id, nom: c.nom });
const base_ = (c: Cabinet, aujourdhui: string, extra: Record<string, unknown> = {}) => ({ cabinetId: c.id, confirmation: confirmer(c), parametres: chargees, dureesValidees: REF, aujourdhui, env: process.env, fichierRapport: join(dossier, `rapport-${c.id}.jsonl`), ...extra });

beforeAll(async () => {
  base = await creerBaseJetable('terme');
  admin = base.admin;
  for (const o of OFFRES_DEMO) await definirOffre(admin, o);
  P = creerPeuplement(admin);
  await P.lireCatalogue();
  dossier = mkdtempSync(join(tmpdir(), 'comtaple-terme-'));
  const p = JSON.parse(JSON.stringify(PARAMETRES_PROPOSES)) as ParametresDurees;
  p.version = 'essai-terme';
  p.statut = 'VALIDÉE';
  p.validation = { reference: REF, date: '2026-11-20', par: 'essai' };
  // Durées COURTES d'essai (jours) : toutes les échéances sont atteintes en avançant « aujourd'hui ».
  p.categories.traces_ia!.duree = { jours: 5 };
  p.categories.abonnement_facturation!.duree = { jours: 30 };
  p.categories.restitutions_cabinet!.duree = { jours: 400 };
  p.categories.politiques_conservation!.duree = { jours: 600 };
  p.categories.fin_de_contrat!.duree = { jours: 700 };
  p.categories.journal_audit!.duree = { jours: 30 };
  const chemin = join(dossier, 'jeu.json');
  writeFileSync(chemin, JSON.stringify(p));
  chargees = chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories, chemin);
}, 180_000);

afterAll(async () => {
  await base?.detruire();
  rmSync(dossier, { recursive: true, force: true });
});

describe('garde-fous : base d’essai, référence, confirmation, fin de contrat exécutée', () => {
  it('refus sur toute base qui n’est pas une base d’essai isolée, avant toute lecture ou écriture', async () => {
    const faux = { query: async () => ({ rows: [{ b: 'comtaple' }] }) } as unknown as pg.Client;
    const c = { cabinetId: randomUUID(), parametres: chargees, dureesValidees: REF, aujourdhui: '2030-01-01', cheminManifeste: 'x' };
    await expect(detruireElementsConservesEssai(faux, c)).rejects.toThrow(/n’est pas une base d’essai isolée/);
    await expect(detruireJournalEssai(faux, c)).rejects.toThrow(/n’est pas une base d’essai isolée/);
    await expect(cloturerCabinetEssai(faux, { ...c, fichierCertificat: join(dossier, 'x.json'), journalDetruit: null })).rejects.toThrow(/n’est pas une base d’essai isolée/);
  });

  it('refuse sans référence, avec confirmation inexacte, ou avant la fin de contrat ; la simulation le dit et ne modifie rien', async () => {
    const c = await P.pret('Garde');
    const plan = await planDestructionTerme(admin, c.id, chargees, { aujourdhui: await jour(1000) });
    expect(plan.finDeContratExecutee).toBe(false);
    expect(plan.avertissements.join(' ')).toMatch(/Fin de contrat non exécutée/);
    await expect(detruireElementsConservesEssai(admin, base_(c, await jour(1000)))).rejects.toThrow(/fin de contrat n’a pas été exécutée/);
    await expect(detruireElementsConservesEssai(admin, base_(c, await jour(1000), { dureesValidees: undefined }))).rejects.toThrow(/déclarées validées/);
    await expect(detruireElementsConservesEssai(admin, base_(c, await jour(1000), { dureesValidees: 'oui' }))).rejects.toThrow(/référence de validation exploitable/);
    await expect(detruireElementsConservesEssai(admin, base_(c, await jour(1000), { confirmation: { cabinetId: c.id, nom: 'Autre nom' } }))).rejects.toThrow(/confirmation/);
    await expect(detruireElementsConservesEssai(admin, base_(c, await jour(1000), { confirmation: undefined }))).rejects.toThrow(/confirmation/);
  });
});

describe('simulation lisible par une personne', () => {
  it('dit en français ce qui est supprimé, conservé puis détruit, avec les dates et le bandeau « non validé » ; ne modifie rien', async () => {
    const c = await P.pret('Lisible');
    const avant = await empreinteCabinet(c.id);
    const defaut = chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories);
    const texte = rendreSimulationLisible(await simulerConservationCabinet(admin, c.id, defaut));
    expect(texte).toContain(`Conservation et fin de contrat — ${c.nom}`);
    expect(texte).toMatch(/PROPOSITION NON VALIDÉE\. Aucune de ces dates/);
    expect(texte).toMatch(/pourra être exécutée à partir du \d{2}\/\d{2}\/\d{4}/);
    expect(texte).toMatch(/tout est supprimé, après restitution/);
    expect(texte).toMatch(/- lignes_ecriture : \d+ lignes? — .*SUPPRIMER/);
    expect(texte).toMatch(/- restitutions_cabinet : .*CONSERVER jusqu’à l’échéance, puis SUPPRIMER.*Échéance du \d{2}\/\d{2}\/\d{4}/);
    expect(texte).toMatch(/journal_audit : .*SCELLER/);
    expect(texte).not.toMatch(/undefined|\[object|NaN/);
    const j = rendreFinDeVieJournalLisible(await simulerFinDeVieJournal(admin, c.id, defaut));
    expect(j).toMatch(/Le journal compte \d+ lignes?/);
    expect(j).toMatch(/jamais automatique|décision humaine/);
    expect(await empreinteCabinet(c.id)).toEqual(avant);
  });
});

describe('cycle complet sur un cabinet d’essai', () => {
  let A: Cabinet;
  let B: Cabinet;
  let empB: Record<string, string>;
  let T: Record<string, string>;
  let scellement1: Awaited<ReturnType<typeof scellerJournal>>;
  let rapportA: string;

  it('prépare : deux cabinets, fin de contrat exécutée pour A seulement', async () => {
    A = await P.pret('Cabinet visé');
    B = await P.pret('Cabinet voisin');
    // Le peuplement générique date la période d'une échéance du passé lointain : la ramener à aujourd'hui (comme un cabinet réel).
    await admin.query('update echeances_abonnement set periode_fin = current_date where cabinet_id in ($1, $2)', [A.id, B.id]);
    await finDeContrat(admin, { cabinetId: A.id, confirmation: confirmer(A), appliquer: true, parametres: chargees, dureesValidees: REF });
    empB = await empreinteCabinet(B.id);
    T = { t0: await jour(0), t1: await jour(10), t2: await jour(210), t3: await jour(410), t4: await jour(710) };
    rapportA = join(dossier, `rapport-${A.id}.jsonl`);
    const plan = await planDestructionTerme(admin, A.id, chargees, { aujourdhui: T.t0! });
    expect(plan.finDeContratExecutee).toBe(true);
    expect(plan.categories.map((c) => c.code)).toEqual(['traces_ia', 'abonnement_facturation', 'restitutions_cabinet', 'politiques_conservation', 'journal_audit', 'fin_de_contrat']);
    expect(plan.categories.filter((c) => c.etat === 'vide')).toEqual([]);
    expect(plan.categories.filter((c) => c.etat !== 'a_echoir').map((c) => JSON.stringify(c.tables))).toEqual([]);
    expect(plan.termine).toBe(false);
  });

  it('T0 : rien n’est échu, rien n’est détruit, aucune ligne de journal ; la simulation ne modifie rien', async () => {
    const avant = await empreinteCabinet(A.id);
    const r = await detruireElementsConservesEssai(admin, base_(A, T.t0!));
    expect(r.categories.map((c) => c.action)).toEqual(['rien_d_echu', 'rien_d_echu', 'rien_d_echu', 'rien_d_echu']);
    expect(await empreinteCabinet(A.id)).toEqual(avant);
    const lisible = rendrePlanDestructionLisible(r.plan);
    expect(lisible).toMatch(/Destruction à terme des éléments conservés/);
    expect(lisible).toMatch(/Prochaine échéance/);
    expect(lisible).not.toMatch(/undefined|\[object/);
  });

  it('T1 : seules les traces d’IA échues sont détruites ; une ligne de journal ; l’autre cabinet est intact', async () => {
    const traces = await nb('evenements_ia', A.id);
    expect(traces).toBeGreaterThan(0);
    const avant = await empreinteCabinet(A.id);
    const r = await detruireElementsConservesEssai(admin, base_(A, T.t1!));
    expect(r.categories.map((c) => c.action)).toEqual(['detruite', 'rien_d_echu', 'rien_d_echu', 'rien_d_echu']);
    expect(await nb('evenements_ia', A.id)).toBe(0);
    const apres = await empreinteCabinet(A.id);
    for (const t of Object.keys(avant)) if (!['evenements_ia', 'journal_audit'].includes(t)) expect(apres[t], t).toBe(avant[t]);
    const lignes = (await admin.query<{ details: { categorie: string; dureesConservation: { reference: string } } }>(`select details from journal_audit where cabinet_id = $1 and action = 'conservation.destruction_terme'`, [A.id])).rows;
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.details).toMatchObject({ categorie: 'traces_ia', dureesConservation: { reference: REF } });
    expect(await strict(A.id)).toBeNull();
    expect(await empreinteCabinet(B.id)).toEqual(empB);
  });

  it('journal : scellement non destructif, vérifiable hors base ; la destruction est refusée tant que le journal n’est pas échu', async () => {
    const avant = await empreinteCabinet(A.id);
    scellement1 = await scellerJournal(admin, A.id, { repertoire: join(dossier, 'scellements') });
    expect(await empreinteCabinet(A.id)).toEqual(avant);
    expect(scellement1.deja).toBe(false);
    expect(scellement1.manifeste.rang).toBe(1);
    expect(await verifierScellement(scellement1.cheminManifeste)).toMatchObject({ conforme: true, lignes: await nb('journal_audit', A.id) });
    // Idempotent : rien n'a changé, même scellement.
    expect(await scellerJournal(admin, A.id, { repertoire: join(dossier, 'scellements') })).toMatchObject({ deja: true });
    const decision = { reference: 'DECISION-ESSAI-1', par: 'Responsable d’essai', date: T.t1!, motif: 'Essai de fin de vie du journal' };
    await expect(detruireJournalEssai(admin, { ...base_(A, T.t1!), cheminManifeste: scellement1.cheminManifeste, decision })).rejects.toThrow(/ne sont pas échues/);
    expect(await strict(A.id)).toBeNull();
  });

  it('T2 interrompu entre deux catégories : la catégorie validée reste détruite, la suite reprend ; idempotent ensuite', async () => {
    const facturation = ['abonnements', 'echeances_abonnement', 'evenements_facturation'];
    for (const t of facturation) expect(await nb(t, A.id), t).toBeGreaterThan(0);
    await expect(
      detruireElementsConservesEssai(admin, base_(A, T.t2!, { surCategorie: (code: string) => { if (code === 'abonnement_facturation') throw new Error('interruption simulée'); } })),
    ).rejects.toThrow(/interruption simulée/);
    for (const t of facturation) expect(await nb(t, A.id), t).toBe(0);
    expect(await nb('restitutions_cabinet', A.id)).toBeGreaterThan(0);
    // Reprise : restitutions du cabinet (échues à +200), pas les politiques (+400).
    const r = await detruireElementsConservesEssai(admin, base_(A, T.t2!));
    expect(r.categories.map((c) => c.action)).toEqual(['vide', 'vide', 'detruite', 'rien_d_echu']);
    expect(await nb('restitutions_cabinet', A.id)).toBe(0);
    expect(await nb('politiques_conservation', A.id)).toBeGreaterThan(0);
    const encore = await detruireElementsConservesEssai(admin, base_(A, T.t2!));
    expect(encore.categories.every((c) => c.action !== 'detruite')).toBe(true);
    // Rapport cumulé sur plusieurs passages, une ligne par table.
    const lignes = lireRapportDestruction(rapportA);
    expect(Math.max(...lignes.map((l) => l.passage))).toBeGreaterThanOrEqual(4);
    expect(lignes.filter((l) => l.supprimees > 0).map((l) => l.table).sort()).toEqual(['abonnements', 'echeances_abonnement', 'evenements_facturation', 'evenements_ia', 'restitutions_cabinet']);
    expect(await strict(A.id)).toBeNull();
    expect(await empreinteCabinet(B.id)).toEqual(empB);
  });

  it('T3 : politiques détruites ; le journal ne se détruit pas sur un scellement périmé, sans décision, ou sur une décision invalide', async () => {
    const r = await detruireElementsConservesEssai(admin, base_(A, T.t3!));
    expect(r.categories.find((c) => c.code === 'politiques_conservation')!.action).toBe('detruite');
    expect(await nb('politiques_conservation', A.id)).toBe(0);
    // Le journal a reçu des lignes depuis le scellement 1 : périmé.
    const decision = { reference: 'DECISION-ESSAI-1', par: 'Responsable d’essai', date: T.t3!, motif: 'Essai de fin de vie du journal' };
    await expect(detruireJournalEssai(admin, { ...base_(A, T.t3!), cheminManifeste: scellement1.cheminManifeste, decision })).rejects.toBeInstanceOf(ScellementPerime);
    const avant = await nb('journal_audit', A.id);
    expect(avant).toBeGreaterThan(1);
    scellement1 = await scellerJournal(admin, A.id, { repertoire: join(dossier, 'scellements') });
    expect(scellement1.manifeste.rang).toBe(2);
    expect(await verifierScellement(scellement1.cheminManifeste)).toMatchObject({ conforme: true });
    for (const d of [undefined, { ...decision, reference: 'oui' }, { ...decision, par: '' }, { ...decision, motif: 'court' }, { ...decision, date: await jour(5000) }]) {
      await expect(detruireJournalEssai(admin, { ...base_(A, T.t3!), cheminManifeste: scellement1.cheminManifeste, decision: d })).rejects.toThrow(/Destruction du journal refusée/);
    }
    expect(await nb('journal_audit', A.id)).toBe(avant);
  });

  it('un export falsifié ne se vérifie plus : la destruction est refusée', async () => {
    const m = scellement1.manifeste;
    const exportCopie = join(dossier, 'scellements', m.exportFichier);
    const original = readFileSync(exportCopie, 'utf8');
    const lignes = original.split('\n').filter(Boolean);
    const l = JSON.parse(lignes[1]!) as { detailsTexte: string };
    l.detailsTexte = '{"falsifie":true}';
    lignes[1] = JSON.stringify(l);
    writeFileSync(exportCopie, `${lignes.join('\n')}\n`);
    const v = await verifierScellement(scellement1.cheminManifeste);
    expect(v.conforme).toBe(false);
    expect(v.motifs.join(' ')).toMatch(/empreinte du fichier d’export|non conforme/);
    const decision = { reference: 'DECISION-ESSAI-1', par: 'Responsable d’essai', date: T.t3!, motif: 'Essai de fin de vie du journal' };
    await expect(detruireJournalEssai(admin, { ...base_(A, T.t3!), cheminManifeste: scellement1.cheminManifeste, decision })).rejects.toThrow(/ne se vérifie pas hors base/);
    writeFileSync(exportCopie, original);
    expect((await verifierScellement(scellement1.cheminManifeste)).conforme).toBe(true);
    expect(await strict(A.id)).toBeNull();
  });

  it('la clôture est refusée tant que le procès-verbal n’est pas échu ni le journal détruit', async () => {
    const cert = join(dossier, 'certificat.json');
    await expect(cloturerCabinetEssai(admin, { ...base_(A, T.t3!), fichierCertificat: cert, journalDetruit: null })).rejects.toThrow(/n’est pas échue/);
    await expect(cloturerCabinetEssai(admin, { ...base_(A, T.t4!), fichierCertificat: cert, journalDetruit: null })).rejects.toThrow(/subsistent.*journal_audit/);
    expect(existsSync(cert)).toBe(false);
  });

  it('une écriture au journal entre la vérification et la suppression est détectée : rien n’est détruit ; puis destruction après nouveau scellement', async () => {
    const decision = { reference: 'DECISION-ESSAI-1', par: 'Responsable d’essai', date: T.t4!, motif: 'Essai de fin de vie du journal' };
    const avant = await nb('journal_audit', A.id);
    await expect(
      detruireJournalEssai(admin, {
        ...base_(A, T.t4!),
        cheminManifeste: scellement1.cheminManifeste,
        decision,
        avantSuppression: async () => {
          await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'essai.concurrent', 'cabinet', 'x')`, [A.id]);
        },
      }),
    ).rejects.toBeInstanceOf(ScellementPerime);
    expect(await nb('journal_audit', A.id)).toBe(avant + 1);
    expect(await strict(A.id)).toBeNull();

    const s3 = await scellerJournal(admin, A.id, { repertoire: join(dossier, 'scellements') });
    expect(s3.manifeste.rang).toBe(3);
    const r = await detruireJournalEssai(admin, { ...base_(A, T.t4!), cheminManifeste: s3.cheminManifeste, decision });
    expect(r).toMatchObject({ etat: 'detruit', lignes: avant + 1, decision: { reference: 'DECISION-ESSAI-1' } });
    expect(await nb('journal_audit', A.id)).toBe(0);
    // Protections d'ajout seul rétablies : une suppression directe est de nouveau refusée.
    await expect(admin.query(`delete from journal_audit where cabinet_id = $1`, [B.id])).rejects.toThrow(/ajout seul|interdit/);
    // L'autre cabinet : journal intact, chaîne intègre.
    expect(await strict(B.id)).toBeNull();
    expect(await empreinteCabinet(B.id)).toEqual(empB);
    // Rejouée : déjà détruit.
    expect(await detruireJournalEssai(admin, { ...base_(A, T.t4!), cheminManifeste: s3.cheminManifeste, decision })).toMatchObject({ etat: 'deja_detruit' });
    // L'export reste vérifiable hors base après la destruction.
    expect((await verifierScellement(s3.cheminManifeste)).conforme).toBe(true);
    scellement1 = s3;
  });

  it('T4 : clôture avec certificat, interrompue entre le certificat et la suppression, reprise sans doublon ; rejouée : déjà close', async () => {
    const cert = join(dossier, 'certificat.json');
    const journalDetruit: CertificatDestruction['journal'] = { lignes: scellement1.manifeste.lignes, anomalies: 0, empreinteTete: scellement1.manifeste.empreinteTete, exportSha256: scellement1.manifeste.exportSha256, ancreEmpreinte: scellement1.manifeste.ancreEmpreinte, decision: { reference: 'DECISION-ESSAI-1', par: 'Responsable d’essai', date: T.t4!, motif: 'Essai de fin de vie du journal' } };
    await expect(cloturerCabinetEssai(admin, { ...base_(A, T.t4!), fichierCertificat: cert, journalDetruit, avantSuppression: () => { throw new Error('interruption simulée'); } })).rejects.toThrow(/interruption simulée/);
    expect(existsSync(cert)).toBe(true);
    expect(await nb('fins_de_contrat', A.id)).toBe(1); // rien n'est supprimé avant le certificat, ni après l'interruption
    const premier = JSON.parse(readFileSync(cert, 'utf8')) as CertificatDestruction;
    const r = await cloturerCabinetEssai(admin, { ...base_(A, T.t4!), fichierCertificat: cert, journalDetruit });
    expect(r.etat).toBe('cloture');
    expect(r.certificat.empreinte).toBe(premier.empreinte); // certificat réutilisé, pas réécrit
    expect(verifierCertificat(r.certificat)).toBe(true);
    expect(r.certificat.journal).toMatchObject({ lignes: scellement1.manifeste.lignes });
    expect(r.certificat.elementsDetruits.map((e) => e.table)).toEqual(['abonnements', 'echeances_abonnement', 'evenements_facturation', 'evenements_ia', 'politiques_conservation', 'restitutions_cabinet']);
    expect((await admin.query('select 1 from cabinets where id = $1', [A.id])).rowCount).toBe(0);
    expect(await nb('fins_de_contrat', A.id)).toBe(0);
    for (const t of P.tablesCabinet) expect(await nb(t, A.id), t).toBe(0);
    // Falsification du certificat : détectée.
    expect(verifierCertificat({ ...r.certificat, cabinet: { ...r.certificat.cabinet, nom: 'Autre' } })).toBe(false);
    expect(await cloturerCabinetEssai(admin, { ...base_(A, T.t4!), fichierCertificat: cert, journalDetruit })).toMatchObject({ etat: 'deja_cloture' });
    // Le cabinet voisin, ses données, son journal et son procès-verbal (absent) n'ont pas bougé.
    expect(await empreinteCabinet(B.id)).toEqual(empB);
    expect((await admin.query('select 1 from cabinets where id = $1', [B.id])).rowCount).toBe(1);
    // Les protections d'ajout seul sont actives.
    await expect(admin.query('truncate fins_de_contrat')).rejects.toThrow(/ajout seul/);
  });

  it('échéancier lisible, tous cabinets, en lecture seule', async () => {
    const e = await echeancierConservation(admin, chargees, { aujourdhui: T.t4! });
    const b = e.cabinets.find((c) => c.cabinetId === B.id)!;
    expect(b).toMatchObject({ phase: 'fin_de_contrat_executable' }); // résilié depuis 200 jours, grâce 90
    expect(e.cabinets.find((c) => c.cabinetId === A.id)).toBeUndefined();
    const texte = rendreEcheancierLisible(e);
    expect(texte).toMatch(/Échéancier de conservation/);
    expect(texte).toMatch(/fin de contrat exécutable/);
    expect(texte).not.toMatch(/undefined|\[object/);
  });
});

describe('une ligne parente n’est jamais détruite tant qu’un enfant non échu la référence', () => {
  it('abonnement échu mais événements de facturation non échus : l’abonnement reste, sans violation de clé étrangère', async () => {
    const c = await P.pret('Parent échu');
    await admin.query(`update abonnements set fin = '2020-03-01' where cabinet_id = $1`, [c.id]);
    await finDeContrat(admin, { cabinetId: c.id, confirmation: confirmer(c), appliquer: true, parametres: chargees, dureesValidees: REF }).catch(async (e: Error) => {
      // La date d'abonnement modifiée après la restitution peut exiger une restitution plus récente.
      if (!/restitution/i.test(e.message)) throw e;
      await P.restituer(c);
      await finDeContrat(admin, { cabinetId: c.id, confirmation: confirmer(c), appliquer: true, parametres: chargees, dureesValidees: REF });
    });
    // Abonnement : fin 2020-03-01 → clôture 2020-12-31 + 30 j = 2021-01-30. Événements de facturation : créés en 2026 → 2027-01-30.
    const r = await detruireElementsConservesEssai(admin, base_(c, '2026-12-01'));
    const fact = r.plan.categories.find((k) => k.code === 'abonnement_facturation')!;
    const t = (n: string) => fact.tables.find((x) => x.table === n)!;
    expect(t('abonnements').total).toBe(1);
    expect(t('evenements_facturation').total).toBeGreaterThan(0);
    // Plus tard : tout est échu, enfants puis parent.
    await detruireElementsConservesEssai(admin, base_(c, '2027-02-01'));
    expect(await nb('abonnements', c.id)).toBe(0);
    expect(await nb('evenements_facturation', c.id)).toBe(0);
  });
});
