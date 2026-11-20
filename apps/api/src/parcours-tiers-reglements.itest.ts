/**
 * Tiers et factures : tolérance de montant et règlement groupé probable (D-096) — pile réelle locale, cabinet NEUF.
 * Un FEC synthétique écrit à la main, des factures synthétiques déposées en PDF et analysées par le worker réel.
 * Ce que ces essais établissent : la tolérance n'existe QUE par un réglage explicite (habilitations vérifiées, isolation
 * entre cabinets, historique en ajout seul, journal) ; une tolérance ne fait que PROPOSER un écart toujours affiché ;
 * un règlement groupé est PROPOSÉ ; rien n'est jamais lettré, imputé ou compté sans la décision d'une personne.
 */
import { randomBytes } from 'node:crypto';
import { genererTexteFactureSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const SIREN_DOSSIER = '123456782';
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';

const baseA = genererTexteFactureSynthetique({ graine: 101 });
const baseB = genererTexteFactureSynthetique({ graine: 202 });
const A = { nom: baseA.attendu.emetteurNom!, siren: baseA.attendu.emetteurSiren!, entete: baseA.pages[0]!.texte.split('\n').slice(0, 10) };
const B = { nom: baseB.attendu.emetteurNom!, siren: baseB.attendu.emetteurSiren!, entete: baseB.pages[0]!.texte.split('\n').slice(0, 10) };
const fr = (iso: string) => iso.split('-').reverse().join('/');
const montantFr = (v: string) => v.replace('.', ',');
function texte(e: typeof A, o: { numero: string; date: string; echeance: string; ht: string }): string[] {
  const ht = Number(o.ht) * 100;
  const tva = Math.round(ht * 0.2);
  const m = (c: number) => montantFr((c / 100).toFixed(2));
  return [
    ...e.entete, `FACTURE N° ${o.numero}`, `Date de facture : ${fr(o.date)}`, `Date d'échéance : ${fr(o.echeance)}`, '', 'Désignation                 Montant HT', `Prestation de service       ${m(ht)}`, '',
    `Total HT : ${m(ht)} €`, `TVA 20 % sur ${m(ht)} : ${m(tva)}`, `Total TVA : ${m(tva)} €`, `Total TTC : ${m(ht + tva)} €`,
  ];
}

// ── FEC : fournisseur B (SIREN dans le compte auxiliaire) avec trois factures et UN règlement groupé non lettré ; fournisseur A avec une facture réglée de 5,00 en moins ──
const lignesFec: string[] = [['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t')];
const compteurs: Record<string, number> = {};
function ecriture(journal: string, date: string, piece: string, lib: string, lignes: Array<{ compte: string; aux?: [string, string]; debit?: string; credit?: string }>): string {
  compteurs[journal] = (compteurs[journal] ?? 0) + 1;
  const num = `${journal}${String(compteurs[journal]).padStart(4, '0')}`;
  const d = date.replaceAll('-', '');
  for (const l of lignes) {
    lignesFec.push([journal, journal, num, d, l.compte, `Compte ${l.compte}`, l.aux?.[0] ?? '', l.aux?.[1] ?? '', piece, d, lib, montantFr(l.debit ?? '0.00'), montantFr(l.credit ?? '0.00'), '', '', d, '', ''].join('\t'));
  }
  return `${journal}|${num}`;
}
const ttcDe = (ht: string) => (Number(ht) * 1.2).toFixed(2);
const tvaDe = (ht: string) => (Number(ht) * 0.2).toFixed(2);
const achat = (aux: [string, string], date: string, piece: string, ht: string) =>
  ecriture('ACH', date, piece, `Facture ${aux[1]}`, [{ compte: '606100', debit: ht }, { compte: '445660', debit: tvaDe(ht) }, { compte: '401000', aux, credit: ttcDe(ht) }]);
const paiement = (aux: [string, string], date: string, montant: string, lib: string) => ecriture('BQ', date, 'VIR', lib, [{ compte: '401000', aux, debit: montant }, { compte: '512000', credit: montant }]);
const FA: [string, string] = ['FA001', A.nom];
const FB: [string, string] = [`F${B.siren}`, 'Fournisseur B (fictif)'];
const E = {
  b1: achat(FB, '2026-03-01', 'FB-2026-001', '100.00'), // 120,00
  b2: achat(FB, '2026-03-05', 'FB-2026-002', '250.00'), // 300,00
  b3: achat(FB, '2026-03-10', 'FB-2026-003', '400.00'), // 480,00
  groupe: paiement(FB, '2026-04-20', '600.00', 'Virement fournisseur B'), // 120 + 480 : seule combinaison
  a1: achat(FA, '2026-02-10', 'FA-A-001', '1000.00'), // 1 200,00
  a1Paiement: paiement(FA, '2026-03-05', '1195.00', 'Virement fournisseur A'), // 5,00 de moins
};
const FEC = Buffer.from(`${lignesFec.join('\r\n')}\r\n`, 'utf8');
const P: Record<string, string> = {};
const PIECES = [
  { cle: 'b1', qui: B, o: { numero: 'FB-2026-001', date: '2026-03-01', echeance: '2026-03-31', ht: '100.00' } },
  { cle: 'b2', qui: B, o: { numero: 'FB-2026-002', date: '2026-03-05', echeance: '2026-04-05', ht: '250.00' } },
  { cle: 'b3', qui: B, o: { numero: 'FB-2026-003', date: '2026-03-10', echeance: '2026-04-10', ht: '400.00' } },
  { cle: 'a1', qui: A, o: { numero: 'FA-A-001', date: '2026-02-10', echeance: '2026-03-12', ht: '1000.00' } },
];

const base = () => `/v1/exercices/${exercice}`;
const lire = (chemin: string, qui = 'remi') => api(qui, 'GET', `${base()}${chemin}`);
const facture = async (cle: string) => (await lire(`/factures/${P[cle]}`)).json.facture;
const reglagesDossier = (qui = 'remi') => api(qui, 'GET', `/v1/dossiers/${dossier}/tiers-factures/reglages`);
const regler = (qui: string, toleranceMontant: string, motif = 'Escomptes de règlement habituels') => api(qui, 'PUT', `/v1/dossiers/${dossier}/tiers-factures/reglages`, { toleranceMontant, motif });
const nbDecisions = async () => Number((await editeur.query('select count(*) as n from liens_factures where cabinet_id = $1', [cabinet])).rows[0].n);

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai tolérance ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '40 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai tolérance ${SEL} SAS (fictive)`, siren: SIREN_DOSSIER, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  expect(d.statut).toBeLessThan(300);
  dossier = d.json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  exercice = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' })).json.id;
  for (const p of PIECES) {
    const dep = await deposer('chloe', dossier, pdfTexte(texte(p.qui, p.o), `${SEL}-${p.cle}`), { nature: 'facture_achat' }, `${p.cle}.pdf`);
    expect(dep.fin.statut, p.cle).toBe(200);
    P[p.cle] = dep.fin.json.documentId;
  }
  for (const p of PIECES) {
    const doc = await attendre(() => api('remi', 'GET', `/v1/documents/${P[p.cle]}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
    expect(doc.json.extraction.champs.totalTtc?.valeur, p.cle).toBe(ttcDe(p.o.ht));
  }
  const depot = await deposer('remi', dossier, FEC, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, `${SIREN_DOSSIER}FEC20261231.txt`);
  const lot = await attendreLot('remi', depot.fin.json.lotImportId);
  expect(lot.json.rapport.lisible).toBe(true);
}, 300_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('par défaut : aucune tolérance, règlement groupé seulement proposé', () => {
  it('tolérance 0.00 « par défaut » : aucun écart n’est proposé, la facture A reste sans règlement identifié', async () => {
    const r = (await reglagesDossier()).json;
    expect(r).toMatchObject({ dossierId: dossier, enVigueur: { montant: '0.00', origine: 'defaut', reglage: null }, maximum: '1000.00', historiqueDossier: [], historiqueCabinet: [] });
    const f = await facture('a1');
    expect(f.propositionsImputation).toEqual([]);
    expect(f).toMatchObject({ montantRegle: '0.00', resteDu: '1200.00', imputations: [] });
    expect((await lire('/factures')).json.tolerance).toEqual({ montant: '0.00', origine: 'defaut' });
  });

  it('règlement groupé probable : 600,00 = FB-2026-001 + FB-2026-003, proposé « à confirmer », rien imputé ni compté ; FB-2026-002 hors groupe', async () => {
    const t = (await lire('/tiers-factures/a-traiter')).json;
    expect(t.totaux).toMatchObject({ reglementsGroupesProbables: 1, abstentionsReglementsGroupes: 0 });
    const [g] = t.reglementsGroupesProbables;
    expect(g).toMatchObject({ statut: 'a_confirmer', somme: '600.00', ecriture: { montant: '600.00', sens: 'debit', compAuxNum: `F${B.siren}`, lettrage: null } });
    expect(g.factures.map((x: any) => [x.numero, x.resteDu]).sort()).toEqual([['FB-2026-001', '120.00'], ['FB-2026-003', '480.00']]);
    expect(g.explication).toMatch(/aucune autre combinaison/);
    expect(g.explication).toMatch(/Probable seulement/);
    for (const cle of ['b1', 'b3']) {
      const f = await facture(cle);
      expect(f.propositionsImputation).toEqual([expect.objectContaining({ critere: 'reglement_groupe_probable', ambigue: false, groupeDocumentIds: [P.b1, P.b3].sort() })]);
      expect(f).toMatchObject({ montantRegle: '0.00', imputations: [], etat: 'echue_non_reglee', resteDu: f.montant });
    }
    expect((await facture('b2')).propositionsImputation).toEqual([]);
    expect(await nbDecisions()).toBe(0); // aucune décision, donc rien d'appliqué
    // Les règlements proposés affichent les propositions, sans les compter.
    expect(t.reglementsProposes.map((x: any) => x.numero).sort()).toEqual(['FB-2026-001', 'FB-2026-003']);
  });
});

describe('réglage de la tolérance : habilitations, validation, isolation, historique', () => {
  it('un déposant et un lecteur n’y accèdent pas ; une collaboratrice lit mais ne règle pas ; seul le niveau révision règle un dossier', async () => {
    expect([403, 404]).toContain((await reglagesDossier('client')).statut);
    expect((await reglagesDossier('chloe')).statut).toBe(200);
    expect((await regler('chloe', '5.00')).statut).toBe(403);
    expect([403, 404]).toContain((await regler('client', '5.00')).statut);
    expect((await reglagesDossier()).json.enVigueur.origine).toBe('defaut'); // rien n'a été réglé par les refus
  });

  it('autre cabinet : le dossier est inconnu (404), ses propres réglages ne voient rien du cabinet d’essai', async () => {
    expect((await api('bruno', 'GET', `/v1/dossiers/${dossier}/tiers-factures/reglages`)).statut).toBe(404);
    expect((await api('bruno', 'PUT', `/v1/dossiers/${dossier}/tiers-factures/reglages`, { toleranceMontant: '5.00', motif: 'x' })).statut).toBe(404);
    expect((await api('bruno', 'GET', `${base()}/tiers`)).statut).toBe(404);
    const b = await api('bruno', 'GET', '/v1/cabinet/tiers-factures/reglages');
    expect(b.statut).toBe(200);
    expect(b.json.enVigueur).toMatchObject({ montant: '0.00', origine: 'defaut' });
    expect(b.json.historique).toEqual([]);
  });

  it('entrées invalides refusées : négatif, au-delà de 1 000, plus de deux décimales, texte, motif vide, absent', async () => {
    for (const toleranceMontant of ['-1', '1000.01', '5.001', 'cinq', '', '5,00', '1e2', '00000.5']) {
      expect((await regler('remi', toleranceMontant)).statut, toleranceMontant).toBe(400);
    }
    expect((await regler('remi', '5.00', '')).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/dossiers/${dossier}/tiers-factures/reglages`, { toleranceMontant: '5.00' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/dossiers/${dossier}/tiers-factures/reglages`, { toleranceMontant: 5, motif: 'x' })).statut).toBe(400);
    expect((await api('remi', 'PUT', '/v1/dossiers/pas-un-uuid/tiers-factures/reglages', { toleranceMontant: '5.00', motif: 'x' })).statut).toBe(400);
    expect((await reglagesDossier()).json.historiqueDossier).toEqual([]);
  });

  it('tolérance du cabinet : réservée aux administrateurs et associés ; elle vaut pour les dossiers sans réglage propre ; celle du dossier l’emporte', async () => {
    const cabinetPut = (qui: string, toleranceMontant: string) => api(qui, 'PUT', '/v1/cabinet/tiers-factures/reglages', { toleranceMontant, motif: 'Politique du cabinet' });
    for (const qui of ['remi', 'chloe', 'client']) {
      expect((await cabinetPut(qui, '3.00')).statut, qui).toBe(403);
      expect((await api(qui, 'GET', '/v1/cabinet/tiers-factures/reglages')).statut, qui).toBe(403);
    }
    expect((await cabinetPut('alice', '1000.01')).statut).toBe(400);
    const ok = await cabinetPut('alice', '3.00');
    expect(ok.statut).toBe(200);
    expect(ok.json.enVigueur).toMatchObject({ montant: '3.00', origine: 'cabinet' });
    expect((await reglagesDossier()).json.enVigueur).toMatchObject({ montant: '3.00', origine: 'cabinet' });
    expect((await lire('/factures')).json.tolerance).toEqual({ montant: '3.00', origine: 'cabinet' });
    // 3,00 < écart de 5,00 : toujours aucune proposition.
    expect((await facture('a1')).propositionsImputation).toEqual([]);
    // Le réglage du dossier l'emporte, même plus strict que celui du cabinet.
    expect((await regler('remi', '0.00', 'Aucune tolérance sur ce dossier')).statut).toBe(200);
    expect((await reglagesDossier()).json.enVigueur).toMatchObject({ montant: '0.00', origine: 'dossier' });
  });
});

describe('une tolérance réglée PROPOSE, avec l’écart affiché, et n’applique rien', () => {
  it('4,99 : hors tolérance, rien ; 5,00 : écart de −5,00 proposé « à confirmer » ; facture non lettrée, non imputée, reste dû inchangé', async () => {
    expect((await regler('remi', '4.99', 'Essai juste en dessous')).statut).toBe(200);
    expect((await facture('a1')).propositionsImputation).toEqual([]);
    const r = await regler('remi', '5.00', 'Escomptes de règlement habituels du fournisseur A');
    expect(r.statut).toBe(200);
    expect(r.json.enVigueur).toMatchObject({ montant: '5.00', origine: 'dossier' });
    const f = await facture('a1');
    expect(f.propositionsImputation).toEqual([expect.objectContaining({ critere: 'ecart_tolere', ecart: '-5.00', tolerance: '5.00', ambigue: false, nature: 'reglement', ecriture: expect.objectContaining({ montant: '1195.00', cle: E.a1Paiement }) })]);
    expect(f).toMatchObject({ montantRegle: '0.00', resteDu: '1200.00', imputations: [], etat: 'echue_non_reglee' });
    expect(f.comptabilisation.statut).toBe('apparie');
    expect(await nbDecisions()).toBe(0);
    const t = (await lire('/tiers-factures/a-traiter')).json;
    expect(t.reglementsProposes.map((x: any) => x.numero)).toEqual(expect.arrayContaining(['FA-A-001']));
    expect((await lire('/factures')).json.tolerance).toEqual({ montant: '5.00', origine: 'dossier' });
    expect((await lire('/factures')).json.reserves.join(' ')).toMatch(/Tolérance de montant réglée à 5\.00/);
  });

  it('historique en ajout seul : chaque réglage est une ligne (auteur, motif), l’ancien n’est ni modifié ni supprimé ; journal avec avant et après', async () => {
    const h = (await reglagesDossier()).json;
    expect(h.historiqueDossier.map((x: any) => x.toleranceMontant)).toEqual(['5.00', '4.99', '0.00']); // du plus récent au plus ancien
    expect(h.historiqueDossier[0]).toMatchObject({ motif: 'Escomptes de règlement habituels du fournisseur A', auteur: expect.stringContaining('Rémi') });
    expect(h.historiqueCabinet.map((x: any) => x.toleranceMontant)).toEqual(['3.00']);
    const lignes = (await editeur.query('select tolerance_montant::text as t, dossier_id from reglages_tiers_factures where cabinet_id = $1 order by cree_le, id', [cabinet])).rows;
    expect(lignes.map((l) => [l.t, l.dossier_id === null ? 'cabinet' : 'dossier'])).toEqual([['3.00', 'cabinet'], ['0.00', 'dossier'], ['4.99', 'dossier'], ['5.00', 'dossier']]);
    const journal = (await editeur.query(`select details from journal_audit where cabinet_id = $1 and action = 'tiers_factures.tolerance_reglee' order by id`, [cabinet])).rows.map((x) => x.details);
    expect(journal).toHaveLength(4);
    expect(journal[3]).toMatchObject({ portee: 'dossier', avant: '4.99', apres: '5.00', origineAvant: 'dossier' });
    expect(journal[0]).toMatchObject({ portee: 'cabinet', avant: '0.00', apres: '3.00' });
  });

  it('confirmée par une collaboratrice, la proposition devient un règlement identifié et l’ÉCART RESTE VISIBLE dans le reste dû (jamais effacé)', async () => {
    const cible = (await facture('a1')).propositionsImputation[0].ecriture.cle;
    const c = await api('chloe', 'PUT', `${base()}/factures/${P.a1}/liens`, { type: 'imputation', cible, decision: 'confirme' });
    expect(c.statut, JSON.stringify(c.json)).toBe(200);
    const f = await facture('a1');
    expect(f).toMatchObject({ etat: 'partiellement_reglee', montantRegle: '1195.00', resteDu: '5.00' });
    expect(f.imputations).toEqual([expect.objectContaining({ mode: 'confirmation', montant: '1195.00' })]);
    expect(await nbDecisions()).toBe(1);
  });

  it('groupe confirmé facture par facture : les deux factures sont réglées par la même écriture ; plus de proposition de groupe', async () => {
    const t = (await lire('/tiers-factures/a-traiter')).json;
    const cible = t.reglementsGroupesProbables[0].ecriture.cle;
    // Une seule confirmation ne suffit pas à régler le groupe : le reste dû de la première est couvert, jamais l'autre par déduction.
    const c1 = await api('chloe', 'PUT', `${base()}/factures/${P.b1}/liens`, { type: 'imputation', cible, decision: 'confirme' });
    expect(c1.statut, JSON.stringify(c1.json)).toBe(200);
    expect((await facture('b3')).imputations).toEqual([]);
    const c3 = await api('chloe', 'PUT', `${base()}/factures/${P.b3}/liens`, { type: 'imputation', cible, decision: 'confirme' });
    expect(c3.statut).toBe(200);
    for (const cle of ['b1', 'b3']) expect(await facture(cle), cle).toMatchObject({ etat: 'reglee', resteDu: '0.00' });
    expect((await facture('b2')).etat).toBe('echue_non_reglee');
    expect((await lire('/tiers-factures/a-traiter')).json.reglementsGroupesProbables).toEqual([]);
  });

  it('infirmé : seul le niveau révision infirme, avec motif ; la facture est écartée du groupe', async () => {
    // Le règlement groupé est déjà confirmé ; une nouvelle facture n'est pas à créer : on vérifie les droits sur A (écart tolérance).
    const cible = E.a1Paiement;
    expect((await api('chloe', 'PUT', `${base()}/factures/${P.a1}/liens`, { type: 'imputation', cible, decision: 'infirme', motif: 'x' })).statut).toBe(403);
    expect((await api('remi', 'PUT', `${base()}/factures/${P.a1}/liens`, { type: 'imputation', cible, decision: 'infirme' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `${base()}/factures/${P.a1}/liens`, { type: 'imputation', cible, decision: 'infirme', motif: 'Ce virement n’est pas le règlement de cette facture' })).statut).toBe(200);
    expect(await facture('a1')).toMatchObject({ montantRegle: '0.00', resteDu: '1200.00', propositionsImputation: [] });
  });
});
