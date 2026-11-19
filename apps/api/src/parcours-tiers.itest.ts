/**
 * Tiers, factures et avoirs suivis, échéances et règlements — pile réelle locale, cabinet NEUF.
 * Un FEC synthétique écrit à la main (tiers, factures, règlements lettrés ou non, avoir, doublon), des factures
 * synthétiques déposées en PDF et analysées par le worker réel, un relevé bancaire cohérent avec le compte 512 et un
 * rapprochement validé par un réviseur. Rien n'est jamais comptabilisé ni lettré : tout est aide à la révision.
 */
import { randomBytes } from 'node:crypto';
import { analyserFec, enBlocs, genererReleveSynthetique, genererTexteFactureSynthetique, type LigneFec } from '@comtaple/core';
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

// Deux émetteurs synthétiques (nom, SIRET, TVA) repris des factures du générateur : A et B.
const baseA = genererTexteFactureSynthetique({ graine: 101 });
const baseB = genererTexteFactureSynthetique({ graine: 202 });
const A = { nom: baseA.attendu.emetteurNom!, siren: baseA.attendu.emetteurSiren!, entete: baseA.pages[0]!.texte.split('\n').slice(0, 10) };
const B = { nom: baseB.attendu.emetteurNom!, siren: baseB.attendu.emetteurSiren!, entete: baseB.pages[0]!.texte.split('\n').slice(0, 10) };
const AUX_B = `F${B.siren}`;

const fr = (iso: string) => iso.split('-').reverse().join('/');
const montantFr = (v: string) => v.replace('.', ',');
/** Facture ou avoir synthétique à un taux (20 %), même mise en page que le générateur du moteur. */
function texte(e: typeof A, o: { numero: string; date: string; echeance?: string; ht: string; avoir?: boolean }): string[] {
  const ht = Number(o.ht) * 100;
  const tva = Math.round(ht * 0.2);
  const signe = o.avoir ? '-' : '';
  const m = (c: number) => `${signe}${montantFr((c / 100).toFixed(2))}`;
  return [
    ...e.entete,
    `${o.avoir ? 'AVOIR' : 'FACTURE'} N° ${o.numero}`,
    o.avoir ? `Date de l'avoir : ${fr(o.date)}` : `Date de facture : ${fr(o.date)}`,
    ...(o.echeance ? [`Date d'échéance : ${fr(o.echeance)}`] : []),
    '',
    'Désignation                 Montant HT',
    `Prestation de service       ${m(ht)}`,
    '',
    `Total HT : ${m(ht)} €`,
    `TVA 20 % sur ${m(ht)} : ${m(tva)}`,
    `Total TVA : ${m(tva)} €`,
    `Total TTC : ${m(ht + tva)} €`,
  ];
}

// ── FEC synthétique écrit à la main ──
const JOURNAUX: Record<string, string> = { ACH: 'Achats', VTE: 'Ventes', BQ: 'Banque' };
const LIBELLES: Record<string, string> = { '401000': 'Fournisseurs', '411000': 'Clients', '512000': 'Banque', '606100': 'Achats non stockés', '445660': 'TVA déductible', '706000': 'Prestations', '445710': 'TVA collectée' };
const lignesFec: string[] = [['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t')];
const compteurs: Record<string, number> = {};
function ecriture(journal: string, date: string, piece: string, lib: string, lignes: Array<{ compte: string; aux?: [string, string]; debit?: string; credit?: string; lettre?: string }>): string {
  compteurs[journal] = (compteurs[journal] ?? 0) + 1;
  const num = `${journal}${String(compteurs[journal]).padStart(4, '0')}`;
  const d = date.replaceAll('-', '');
  for (const l of lignes) {
    lignesFec.push([journal, JOURNAUX[journal], num, d, l.compte, LIBELLES[l.compte], l.aux?.[0] ?? '', l.aux?.[1] ?? '', piece, d, lib, montantFr(l.debit ?? '0.00'), montantFr(l.credit ?? '0.00'), l.lettre ?? '', l.lettre ? d : '', d, '', ''].join('\t'));
  }
  return `${journal}|${num}`;
}
const ttcDe = (ht: string) => (Number(ht) * 1.2).toFixed(2);
const tvaDe = (ht: string) => (Number(ht) * 0.2).toFixed(2);
const achat = (aux: [string, string], date: string, piece: string, ht: string, lettre?: string) =>
  ecriture('ACH', date, piece, `Facture ${aux[1]}`, [{ compte: '606100', debit: ht }, { compte: '445660', debit: tvaDe(ht) }, { compte: '401000', aux, credit: ttcDe(ht), lettre }]);
const paiement = (aux: [string, string], date: string, montant: string, lib: string, lettre?: string) =>
  ecriture('BQ', date, 'VIR', lib, [{ compte: '401000', aux, debit: montant, lettre }, { compte: '512000', credit: montant }]);

const FA: [string, string] = ['FA001', A.nom];
const FA_HOMONYME: [string, string] = ['FA002', A.nom.replace(' SARL', '')];
const FB: [string, string] = [AUX_B, 'Fournisseur B (fictif)'];
const CLIENT: [string, string] = ['C001', 'Client de démonstration (fictif)'];
const E = {
  f1: achat(FA, '2026-02-10', 'FA-A-001', '1000.00', 'AA'),
  f1Paiement: paiement(FA, '2026-03-05', '1200.00', 'Virement fournisseur A', 'AA'),
  homonyme: achat(FA_HOMONYME, '2026-02-11', 'HOMO-1', '10.00'),
  f2: achat(FB, '2026-03-01', 'FB-2026-001', '500.00'),
  f2Acompte: paiement(FB, '2026-03-20', '200.00', 'Acompte FB-2026-001'),
  f2Solde: paiement(FB, '2026-04-20', '400.00', 'Virement fournisseur B'),
  f3: achat(FB, '2026-04-01', 'FB-2026-002', '250.00', 'BB'),
  f4: achat(FB, '2026-04-02', 'FB-2026-003', '400.00', 'BB'),
  f34Paiement: paiement(FB, '2026-05-02', '780.00', 'Virement groupé fournisseur B', 'BB'),
  avoir: ecriture('ACH', '2026-06-10', 'AV-B-001', 'Avoir fournisseur B', [{ compte: '401000', aux: FB, debit: '120.00' }, { compte: '606100', credit: '100.00' }, { compte: '445660', credit: '20.00' }]),
  f6: achat(FB, '2026-12-16', 'FB-2026-004', '200.00'),
  double1: achat(FA, '2026-07-01', 'FA-A-002', '750.00'),
  double2: achat(FA, '2026-07-03', 'FA-A-002', '750.00'),
  f8: achat(FB, '2026-08-01', 'FB-2026-005', '125.00'),
  sansEcheance: achat(FB, '2026-09-01', 'FB-2026-006', '300.00'),
  usd: achat(FB, '2026-09-05', 'FB-2026-007', '50.00'),
  vente: ecriture('VTE', '2026-05-10', 'FV-2026-010', 'Facture client', [{ compte: '411000', aux: CLIENT, debit: '2400.00', lettre: 'CC' }, { compte: '706000', credit: '2000.00' }, { compte: '445710', credit: '400.00' }]),
  encaissement: ecriture('BQ', '2026-06-01', 'REM', 'Encaissement client', [{ compte: '512000', debit: '2400.00' }, { compte: '411000', aux: CLIENT, credit: '2400.00', lettre: 'CC' }]),
};
const FEC = Buffer.from(`${lignesFec.join('\r\n')}\r\n`, 'utf8');

/** Pièces déposées : identifiant de document par clé. */
const P: Record<string, string> = {};
const PIECES: Array<{ cle: string; qui: 'A' | 'B'; nature: string; o: Parameters<typeof texte>[1]; sel?: string }> = [
  { cle: 'f1', qui: 'A', nature: 'facture_achat', o: { numero: 'FA-A-001', date: '2026-02-10', echeance: '2026-03-12', ht: '1000.00' } },
  { cle: 'f2', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-001', date: '2026-03-01', echeance: '2026-03-31', ht: '500.00' } },
  { cle: 'f3', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-002', date: '2026-04-01', echeance: '2026-05-01', ht: '250.00' } },
  { cle: 'f4', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-003', date: '2026-04-02', echeance: '2026-05-02', ht: '400.00' } },
  { cle: 'avoir', qui: 'B', nature: 'avoir', o: { numero: 'AV-B-001', date: '2026-06-10', ht: '100.00', avoir: true } },
  { cle: 'f6', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-004', date: '2026-12-16', echeance: '2027-01-15', ht: '200.00' } },
  { cle: 'double', qui: 'A', nature: 'facture_achat', o: { numero: 'FA-A-002', date: '2026-07-01', echeance: '2026-07-31', ht: '750.00' } },
  { cle: 'f8a', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-005', date: '2026-08-01', echeance: '2026-08-31', ht: '125.00' } },
  { cle: 'f8b', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-005', date: '2026-08-01', echeance: '2026-08-31', ht: '125.00' }, sel: 'autre-scan' },
  { cle: 'sansEcheance', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-006', date: '2026-09-01', ht: '300.00' } },
  { cle: 'usd', qui: 'B', nature: 'facture_achat', o: { numero: 'FB-2026-007', date: '2026-09-05', echeance: '2026-10-05', ht: '50.00' } },
  { cle: 'vente', qui: 'A', nature: 'facture_vente', o: { numero: 'FV-2026-010', date: '2026-05-10', echeance: '2026-06-09', ht: '2000.00' } },
];

const base = () => `/v1/exercices/${exercice}`;
const lire = (chemin: string, qui = 'remi') => api(qui, 'GET', `${base()}${chemin}`);
const facture = async (cle: string, suffixe = '') => (await lire(`/factures/${P[cle]}${suffixe}`)).json;
const attendreDocument = (id: string) => attendre(() => api('remi', 'GET', `/v1/documents/${id}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai tiers ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '30 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai tiers ${SEL} SAS (fictive)`, siren: SIREN_DOSSIER, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  expect(d.statut).toBeLessThan(300);
  dossier = d.json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  exercice = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' })).json.id;
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('tiers, factures, échéances et règlements — aide à la révision', () => {
  it('sans écriture ni pièce : rien n’est inventé, et c’est dit', async () => {
    const t = await lire('/tiers');
    expect(t.statut).toBe(200);
    expect(t.json).toMatchObject({ tiers: [], donnees: null, nature: 'aide_a_la_revision', dateAppreciation: '2026-12-31', origineDateAppreciation: 'cloture_exercice' });
    expect(t.json.reserves.join(' ')).toMatch(/Aucune donnée comptable importée/);
    expect((await lire('/factures')).json).toMatchObject({ factures: [], pagination: { total: 0 } });
  });

  it('dépôt des factures synthétiques (analyse réelle par le worker) et import du FEC', async () => {
    for (const p of PIECES) {
      const pdf = pdfTexte(texte(p.qui === 'A' ? A : B, p.o), `${SEL}-${p.cle}-${p.sel ?? ''}`);
      const d = await deposer('chloe', dossier, pdf, { nature: p.nature }, `${p.cle}.pdf`);
      expect(d.fin.statut, p.cle).toBe(200);
      expect(d.fin.json.doublonBinaire, p.cle).toBe(false);
      P[p.cle] = d.fin.json.documentId;
    }
    for (const p of PIECES) {
      const doc = await attendreDocument(P[p.cle]!);
      const c = doc.json.extraction.champs;
      expect(c.numero?.valeur, p.cle).toBe(p.o.numero);
      expect(c.totalTtc?.valeur, p.cle).toBe(`${p.o.avoir ? '-' : ''}${ttcDe(p.o.ht)}`);
      expect(c.dateEcheance?.valeur ?? null, p.cle).toBe(p.o.echeance ?? null);
    }
    // Pièces sans écriture : fiches présentes, état non déterminable, jamais « non échue ».
    const avant = (await lire('/factures')).json;
    expect(avant.pagination.total).toBe(PIECES.length);
    expect(avant.factures.every((f: any) => f.etat === 'non_determinable' && f.resteDu === null && f.statutExtraction === 'projet')).toBe(true);
    const depot = await deposer('remi', dossier, FEC, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, `${SIREN_DOSSIER}FEC20261231.txt`);
    const lot = await attendreLot('remi', depot.fin.json.lotImportId);
    expect(lot.json.rapport.lisible).toBe(true);
    // Une extraction validée par le réviseur est distinguée d'un projet.
    expect((await api('remi', 'POST', `/v1/documents/${P.f1}/validation`, { decision: 'valider' })).statut).toBe(200);
  }, 240_000);

  it('référentiel des tiers : construit à partir des écritures, soldes recalculés, identifiant fort, homonymes signalés', async () => {
    const r = (await lire('/tiers')).json;
    const t = (cle: string) => r.tiers.find((x: any) => x.cle === cle);
    expect(r.donnees.statutDonnees).toBe('travail_avant_cloture');
    // Trois comptes auxiliaires fournisseurs, plus l'émetteur A connu des seules pièces tant qu'il n'est rattaché à aucun.
    expect(r.pagination.parType).toEqual({ fournisseur: 4, client: 1 });
    // A : 1200 + 900 + 900 au crédit, 1200 au débit.
    expect(t('aux:FA001')).toMatchObject({ type: 'fournisseur', nom: A.nom, totalCredit: '3000.00', totalDebit: '1200.00', solde: '-1800.00', homonymes: ['aux:FA002'], tiersPieces: [] });
    expect(t('aux:FA002').homonymes).toEqual(['aux:FA001']);
    expect(t('aux:C001')).toMatchObject({ type: 'client', solde: '0.00' });
    // B : le SIREN figure dans le numéro du compte auxiliaire → rattaché sans intervention.
    expect(t(`aux:${AUX_B}`).tiersPieces).toEqual([{ cle: `siren:${B.siren}`, nom: B.nom, lien: 'identifiant_fort' }]);
    expect(t(`aux:${AUX_B}`).identifiants.map((i: any) => `${i.nature}:${i.origine}`)).toEqual(expect.arrayContaining(['siren:compte_auxiliaire', 'siren:piece', 'tva:piece']));
    // A : connu des seules pièces tant que personne n'a confirmé ; proposition par nom, deux homonymes, aucun retenu.
    expect(t(`piece:siren:${A.siren}`)).toMatchObject({ origine: 'piece', solde: null });
    expect(r.nbPropositions).toBe(1);
    const aTraiter = (await lire('/tiers-factures/a-traiter')).json;
    expect(aTraiter.propositionsTiers).toEqual([expect.objectContaining({ clePiece: `siren:${A.siren}`, statut: 'homonymes', critere: 'nom_normalise_identique' })]);
    expect(aTraiter.propositionsTiers[0].candidats.map((c: any) => c.cle)).toEqual(['aux:FA001', 'aux:FA002']);
    // Recherche, filtre, pagination.
    expect((await lire(`/tiers?q=${encodeURIComponent(B.siren)}`)).json.tiers.map((x: any) => x.cle)).toEqual([`aux:${AUX_B}`]);
    expect((await lire('/tiers?type=client')).json.tiers.map((x: any) => x.cle)).toEqual(['aux:C001']);
    expect((await lire('/tiers?page=2')).json).toMatchObject({ tiers: [], pagination: { page: 2, suite: false } });
    for (const mauvais of ['/tiers?page=0', '/tiers?type=ami', '/tiers?date=31-12-2026', '/factures?etat=payee', '/tiers/fiche']) expect((await lire(mauvais)).statut, mauvais).toBe(400);
  });

  it('fiche d’un tiers : mouvements tirés des écritures, factures rattachées, reste dû', async () => {
    const f = (await lire(`/tiers/fiche?cle=${encodeURIComponent(`aux:${AUX_B}`)}`)).json;
    expect(f.tiers.cle).toBe(`aux:${AUX_B}`);
    expect(f.paginationMouvements.total).toBe(f.tiers.nbLignes);
    const debit = f.mouvements.reduce((s: number, m: any) => s + Math.round(Number(m.debit) * 100), 0);
    expect((debit / 100).toFixed(2)).toBe(f.tiers.totalDebit);
    expect(f.factures.map((x: any) => x.numero).sort()).toEqual(expect.arrayContaining(['FB-2026-001', 'FB-2026-002', 'FB-2026-003', 'FB-2026-004']));
    expect((await lire('/tiers/fiche?cle=aux:INCONNU')).statut).toBe(404);
  });

  it('tiers proposé par nom : la collaboratrice confirme, le lien devient effectif ; seul le niveau révision infirme', async () => {
    const corps = { cleComptable: 'aux:FA001', clePiece: `siren:${A.siren}` };
    // Tant que le tiers n'est pas établi, la facture F1 n'est pas appariée d'office.
    expect((await facture('f1')).facture.comptabilisation).toMatchObject({ statut: 'a_confirmer', ecriture: null });
    expect((await api('chloe', 'PUT', `${base()}/tiers/liens`, { ...corps, decision: 'infirme', motif: 'essai' })).statut).toBe(403);
    expect((await api('remi', 'PUT', `${base()}/tiers/liens`, { ...corps, decision: 'infirme' })).statut).toBe(400); // motif requis
    expect((await api('chloe', 'PUT', `${base()}/tiers/liens`, { ...corps, cleComptable: 'aux:ABSENT', decision: 'confirme' })).statut).toBe(404);
    expect((await api('chloe', 'PUT', `${base()}/tiers/liens`, { ...corps, decision: 'confirme' })).statut).toBe(200);
    const r = (await lire('/tiers')).json;
    expect(r.nbPropositions).toBe(0);
    expect(r.tiers.find((x: any) => x.cle === 'aux:FA001').tiersPieces).toEqual([{ cle: `siren:${A.siren}`, nom: A.nom, lien: 'confirme' }]);
    expect(r.tiers.some((x: any) => x.cle.startsWith('piece:'))).toBe(false);
  });

  it('F1 : appariée (tiers, référence, montant, date), réglée par lettrage ; preuve bancaire seulement après rapprochement VALIDÉ', async () => {
    const d = await facture('f1');
    expect(d.facture).toMatchObject({ statutExtraction: 'valide', etat: 'reglee', montant: '1200.00', montantRegle: '1200.00', resteDu: '0.00', tiersCle: 'aux:FA001' });
    expect(d.facture.comptabilisation).toMatchObject({ statut: 'apparie', ecriture: { cle: E.f1 }, criteres: { montant: 'exact', reference: 'identique', date: 'concordante', tiers: 'identifie' } });
    expect(d.lignesEcritures[E.f1]).toHaveLength(3);
    expect(d.facture.imputations).toEqual([expect.objectContaining({ mode: 'lettrage', nature: 'reglement', montant: '1200.00', banque: { statut: 'non_rapproche', rapprochementId: null, mouvements: [] } })]);
    expect(d.facture.preuves.map((p: any) => p.libelle)).toEqual(expect.arrayContaining(['Pièce', 'Extraction', 'Écriture', 'Date d’appréciation']));
    // Date d'appréciation fournie : avant le règlement et avant l'échéance → non échue, règlement listé mais non compté.
    const avant = await facture('f1', '?date=2026-02-20');
    expect(avant).toMatchObject({ dateAppreciation: '2026-02-20', origineDateAppreciation: 'fournie' });
    expect(avant.facture).toMatchObject({ etat: 'non_echue', resteDu: '1200.00', montantRegle: '0.00' });
    expect(avant.facture.imputations[0].comptee).toBe(false);

    // Relevé cohérent avec le compte 512, rapprochement lancé puis validé par le réviseur pour l'écriture de règlement.
    const lignes: LigneFec[] = [];
    await analyserFec(enBlocs(new Uint8Array(FEC)), { surLigne: (l) => void lignes.push(l) });
    const releve = genererReleveSynthetique({ graine: 7, format: 'camt.053', debut: '2026-01-01', fin: '2026-12-31', nbMouvements: 50, coherentAvec: lignes });
    const depot = await deposer('remi', dossier, Buffer.from(releve.contenu, 'utf8'), { usage: 'banque' }, releve.nomFichier);
    expect((await attendreLot('remi', depot.fin.json.lotImportId)).json.statut).toBe('termine');
    const lance = await api('remi', 'POST', `${base()}/rapprochements`, {});
    expect(lance.statut).toBe(202);
    const r = await attendre(() => lire('/rapprochements'), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine');
    const [, numero] = E.f1Paiement.split('|');
    const cible = r.json.rapprochements.find((x: any) => x.cotesEcritures.some((id: string) => r.json.ecritures[id]?.numero === numero));
    expect(cible, 'rapprochement de l’écriture de règlement de F1').toBeTruthy();
    // Proposé seulement : toujours pas de preuve bancaire.
    expect((await facture('f1')).facture.imputations[0].banque.statut).toBe('non_rapproche');
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${cible.id}`, { decision: 'valider' })).json.statut).toBe('valide');
    const apres = (await facture('f1')).facture.imputations[0].banque;
    expect(apres).toMatchObject({ statut: 'valide', rapprochementId: cible.id });
    expect(apres.mouvements).toEqual([expect.objectContaining({ montant: '-1200.00' })]);
  }, 240_000);

  it('F2 : règlement partiel identifié par la référence ; le solde sans référence est une PROPOSITION que la collaboratrice confirme et que seul le réviseur infirme', async () => {
    const d = (await facture('f2')).facture;
    expect(d).toMatchObject({ etat: 'partiellement_reglee', montant: '600.00', montantRegle: '200.00', resteDu: '400.00', echue: true, comptabilisation: { statut: 'apparie', criteres: { tiers: 'identifie' } } });
    expect(d.imputations).toEqual([expect.objectContaining({ mode: 'reference', montant: '200.00', ecriture: expect.objectContaining({ cle: E.f2Acompte }) })]);
    expect(d.propositionsImputation.map((p: any) => [p.ecriture.cle, p.critere])).toEqual(expect.arrayContaining([[E.f2Solde, 'montant_exact']]));
    const lien = `${base()}/factures/${P.f2}/liens`;
    const corps = { type: 'imputation', cible: E.f2Solde };
    expect((await api('chloe', 'PUT', lien, { ...corps, cible: 'BQ|ABSENTE', decision: 'confirme' })).statut).toBe(404);
    expect((await api('chloe', 'PUT', lien, { ...corps, cible: E.f2, decision: 'confirme' })).statut).toBe(409); // sa propre écriture
    expect((await api('chloe', 'PUT', lien, { ...corps, decision: 'confirme', montant: '-1.00' })).statut).toBe(400);
    const ok = await api('chloe', 'PUT', lien, { ...corps, decision: 'confirme' });
    expect(ok.statut).toBe(200);
    expect(ok.json.facture).toMatchObject({ etat: 'reglee', resteDu: '0.00' });
    expect((await facture('f2')).facture.imputations.map((i: any) => i.mode).sort()).toEqual(['confirmation', 'reference']);
    expect((await facture('f2')).decisions).toEqual([expect.objectContaining({ type: 'imputation', cible: E.f2Solde, decision: 'confirme', auteur: expect.any(String) })]);
    // Infirmer : niveau révision et motif.
    expect((await api('chloe', 'PUT', lien, { ...corps, decision: 'infirme', motif: 'Autre facture' })).statut).toBe(403);
    expect((await api('chloe', 'PUT', lien, { ...corps, decision: 'retirer' })).statut).toBe(403);
    expect((await api('remi', 'PUT', lien, { ...corps, decision: 'infirme' })).statut).toBe(400);
    const non = await api('remi', 'PUT', lien, { ...corps, decision: 'infirme', motif: 'Ce virement règle une autre facture' });
    expect(non.json.facture).toMatchObject({ etat: 'partiellement_reglee', resteDu: '400.00' });
    expect((await facture('f2')).facture.propositionsImputation.some((p: any) => p.ecriture.cle === E.f2Solde)).toBe(false);
    // Décision retirée : la proposition revient ; puis confirmée pour la suite.
    expect((await api('remi', 'PUT', lien, { ...corps, decision: 'retirer' })).statut).toBe(200);
    expect((await api('remi', 'PUT', lien, { ...corps, decision: 'retirer' })).statut).toBe(404);
    expect((await api('chloe', 'PUT', lien, { ...corps, decision: 'confirme' })).json.facture.etat).toBe('reglee');
  });

  it('F3 et F4 : un règlement groupé lettré solde les deux factures', async () => {
    for (const cle of ['f3', 'f4']) {
      const d = (await facture(cle)).facture;
      expect(d, cle).toMatchObject({ etat: 'reglee', resteDu: '0.00', comptabilisation: { statut: 'apparie' } });
      expect(d.imputations).toEqual([expect.objectContaining({ mode: 'lettrage', partage: true, montant: null, ecriture: expect.objectContaining({ cle: E.f34Paiement, montant: '780.00' }) })]);
    }
  });

  it('avoir : sens déduit du SIREN du dossier, proposé en compensation sur les factures du même tiers, imputé après confirmation', async () => {
    const a = (await facture('avoir')).facture;
    expect(a).toMatchObject({ type: 'avoir', sens: 'achat', montant: '120.00', totalTtc: '-120.00', etat: 'avoir_non_impute', comptabilisation: { statut: 'apparie', ecriture: { cle: E.avoir, sens: 'debit' } } });
    const f6 = (await facture('f6')).facture;
    expect(f6).toMatchObject({ etat: 'non_echue', resteDu: '240.00', echue: false, dateEcheance: '2027-01-15' });
    expect(f6.propositionsImputation).toEqual([expect.objectContaining({ critere: 'avoir_meme_tiers', nature: 'avoir', avoirDocumentId: P.avoir, ambigue: true })]);
    const ok = await api('chloe', 'PUT', `${base()}/factures/${P.f6}/liens`, { type: 'imputation', cible: E.avoir, decision: 'confirme' });
    expect(ok.json.facture).toMatchObject({ etat: 'partiellement_reglee', montantRegle: '120.00', resteDu: '120.00' });
    expect((await facture('f6')).facture.imputations).toEqual([expect.objectContaining({ nature: 'avoir', mode: 'confirmation', montant: '120.00', avoirDocumentId: P.avoir })]);
    expect((await facture('avoir')).facture).toMatchObject({ etat: 'avoir_impute', resteDu: '0.00', imputeSur: [{ factureId: P.f6, montant: '120.00' }] });
  });

  it('suspicion de double comptabilisation : une facture portée par deux écritures — signalée avec ses preuves, tranchée par le seul réviseur', async () => {
    const d = await facture('double');
    const cle = `E:${E.double1}+${E.double2}`;
    expect(d.facture).toMatchObject({ etat: 'non_determinable', suspicions: [cle], comptabilisation: { statut: 'ambigu', ecriture: null } });
    expect(d.facture.comptabilisation.propositions.map((p: any) => p.ecriture.cle)).toEqual([E.double1, E.double2]);
    expect(d.suspicions).toEqual([expect.objectContaining({ cle, type: 'ecritures_multiples', tiers: 'aux:FA001', montant: '900.00', documentIds: [P.double], statut: 'a_examiner' })]);
    expect(Object.keys(d.lignesEcritures).sort()).toEqual([E.double1, E.double2]);
    const s = `${base()}/suspicions`;
    expect((await api('chloe', 'PUT', s, { cle, decision: 'confirme' })).statut).toBe(403);
    expect((await api('remi', 'PUT', s, { cle, decision: 'infirme' })).statut).toBe(400);
    expect((await api('remi', 'PUT', s, { cle: 'E:ACH|X+ACH|Y', decision: 'confirme' })).statut).toBe(404);
    expect((await api('remi', 'PUT', s, { cle, decision: 'confirme' })).json).toEqual({ cle, statut: 'confirmee' });
    expect((await lire('/tiers-factures/a-traiter')).json.suspicions.find((x: any) => x.cle === cle).statut).toBe('confirmee');
    // Confirmer la suspicion ne choisit pas l'écriture : le lien reste à établir explicitement.
    expect((await facture('double')).facture.comptabilisation.statut).toBe('ambigu');
    const lien = await api('chloe', 'PUT', `${base()}/factures/${P.double}/liens`, { type: 'comptabilisation', cible: E.double1, decision: 'confirme' });
    expect(lien.json.facture).toMatchObject({ comptabilisation: 'confirme', etat: 'echue_non_reglee', resteDu: '900.00' });
  });

  it('deux pièces distinctes portant la même facture : suspicion distincte du doublon binaire et de la nouvelle version', async () => {
    const cle = `P:${[P.f8a, P.f8b].sort().join('+')}`;
    const r = (await lire('/tiers-factures/a-traiter')).json;
    const s = r.suspicions.find((x: any) => x.cle === cle);
    expect(s).toMatchObject({ type: 'pieces_multiples', reference: 'FB-2026-005', montant: '150.00', statut: 'a_examiner' });
    expect(s.explication).toMatch(/ni un doublon binaire/);
    expect(s.ecritures.map((e: any) => e.cle)).toEqual([E.f8]);
    for (const k of ['f8a', 'f8b']) expect((await facture(k)).facture).toMatchObject({ etat: 'non_determinable', comptabilisation: { statut: 'ambigu' } });
    expect(r.totaux.suspicions).toBe(2);
    expect(r.liensAConfirmer.map((x: any) => x.id)).toEqual(expect.arrayContaining([P.f8a, P.f8b]));
    // Le réviseur écarte (motif requis) ; les deux fiches restent sans écriture attribuée tant que personne ne choisit.
    expect((await api('remi', 'PUT', `${base()}/suspicions`, { cle, decision: 'infirme', motif: 'Second exemplaire reçu par courrier, à ne pas comptabiliser' })).json.statut).toBe('ecartee');
    expect((await facture('f8a')).facture.comptabilisation.statut).toBe('ambigu');
  });

  it('données manquantes et devise : jamais un état favorable', async () => {
    const sans = (await facture('sansEcheance')).facture;
    expect(sans).toMatchObject({ etat: 'non_determinable', dateEcheance: null, echue: null, resteDu: '360.00', comptabilisation: { statut: 'apparie' } });
    expect(sans.motifEtat).toMatch(/échéance non lue/);
    // Devise corrigée en dollars par la collaboratrice : non traité, et dit.
    expect((await facture('usd')).facture.etat).toBe('echue_non_reglee');
    expect((await api('chloe', 'PUT', `/v1/documents/${P.usd}/extraction`, { champs: { devise: 'USD' } })).statut).toBe(200);
    const usd = (await facture('usd')).facture;
    expect(usd).toMatchObject({ etat: 'non_determinable', devise: 'USD', resteDu: null, comptabilisation: { statut: 'non_recherche' } });
    expect(usd.motifEtat).toMatch(/USD.*ne sont pas traitées/);
    expect((await api('chloe', 'PUT', `${base()}/factures/${P.usd}/liens`, { type: 'comptabilisation', cible: E.usd, decision: 'confirme' })).statut).toBe(409);
  });

  it('vente : le client n’est pas lu sur la pièce → proposition à confirmer ; puis nouvelle version de la pièce → la décision ne s’applique plus', async () => {
    const v = (await facture('vente')).facture;
    expect(v).toMatchObject({ sens: 'vente', tiersPiece: null, etat: 'non_determinable', comptabilisation: { statut: 'a_confirmer' } });
    expect(v.comptabilisation.propositions).toEqual([expect.objectContaining({ ecriture: expect.objectContaining({ cle: E.vente }), criteres: expect.objectContaining({ reference: 'identique', tiers: 'non_determinable' }) })]);
    const ok = await api('chloe', 'PUT', `${base()}/factures/${P.vente}/liens`, { type: 'comptabilisation', cible: E.vente, decision: 'confirme' });
    expect(ok.json.facture).toMatchObject({ comptabilisation: 'confirme', etat: 'reglee', tiersCle: 'aux:C001' });
    // Nouvelle version déposée sur la pièce : l'ancienne n'est plus suivie, la décision qui en dépendait est « à revoir ».
    const ancienne = P.vente!;
    const v2 = pdfTexte([...texte(A, PIECES.find((p) => p.cle === 'vente')!.o), 'Facture rectifiée'], `${SEL}-vente-v2`);
    const depot = await deposer('chloe', dossier, v2, { remplaceDocumentId: ancienne }, 'vente-v2.pdf');
    expect(depot.fin.statut).toBe(200);
    P.vente = depot.fin.json.documentId;
    expect(P.vente).not.toBe(ancienne);
    await attendreDocument(P.vente!);
    expect((await lire(`/factures/${ancienne}`)).statut).toBe(404);
    expect((await facture('vente')).facture).toMatchObject({ versionPiece: 2, etat: 'non_determinable', comptabilisation: { statut: 'a_confirmer' } });
    const r = (await lire('/tiers-factures/a-traiter')).json;
    expect(r.decisionsARevoir).toEqual([expect.objectContaining({ type: 'comptabilisation', objet: ancienne, cible: E.vente, motif: expect.stringMatching(/remplacée/) })]);
  }, 120_000);

  it('échéancier : décomptes par état sur tout le filtre, restes dus, filtres et tri par échéance', async () => {
    const r = (await lire('/factures')).json;
    expect(r.pagination.total).toBe(PIECES.length);
    expect(r.pagination.parEtat).toMatchObject({
      reglee: { n: 4, resteDu: '0.00' }, partiellement_reglee: { n: 1, resteDu: '120.00' }, echue_non_reglee: { n: 1, resteDu: '900.00' }, avoir_impute: { n: 1, resteDu: '0.00' },
      non_determinable: { n: 5, resteDu: '360.00' },
    });
    const echeances = r.factures.map((f: any) => f.dateEcheance);
    const connues = echeances.filter((x: any) => x !== null);
    expect(connues).toEqual([...connues].sort());
    expect(echeances.slice(connues.length).every((x: any) => x === null)).toBe(true);
    expect(r.factures.every((f: any) => f.resteDu === null || /^-?\d+\.\d{2}$/.test(f.resteDu))).toBe(true);
    const echues = (await lire('/factures?etat=echue_non_reglee')).json;
    expect(echues.factures.map((f: any) => f.id)).toEqual([P.double]);
    expect(echues.factures[0]).toMatchObject({ tiersNom: A.nom, joursDeRetard: 153 });
    expect((await lire(`/factures?tiers=${encodeURIComponent('aux:C001')}`)).json.pagination.total).toBe(0); // la nouvelle version de la vente n'est plus rattachée
    expect((await lire('/factures?q=fb-2026-00')).json.pagination.total).toBe(8);
    // À une autre date d'appréciation, les états changent — et la date est rendue.
    const mars = (await lire('/factures?date=2026-03-15')).json;
    expect(mars.dateAppreciation).toBe('2026-03-15');
    expect(mars.factures.find((f: any) => f.id === P.f2)).toMatchObject({ etat: 'non_echue', resteDu: '600.00' });
  });

  it('droits : autre cabinet 404, déposant refusé, lecture seule sans décision, rien n’est écrit dans les écritures', async () => {
    const routes = ['/tiers', '/factures', `/factures/${P.f1}`, '/tiers-factures/a-traiter', `/tiers/fiche?cle=aux:FA001`];
    for (const chemin of routes) {
      expect((await lire(chemin, 'bruno')).statut, `bruno ${chemin}`).toBe(404);
      expect((await lire(chemin, 'client')).statut, `client ${chemin}`).toBe(404);
      expect((await lire(chemin, 'chloe')).statut, `chloe ${chemin}`).toBe(200);
    }
    expect((await api('bruno', 'PUT', `${base()}/suspicions`, { cle: 'E:x', decision: 'confirme' })).statut).toBe(404);
    expect((await api('client', 'PUT', `${base()}/factures/${P.f6}/liens`, { type: 'imputation', cible: E.avoir, decision: 'confirme' })).statut).toBe(404);
    // Niveau « lecture » : consulte, ne décide pas.
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.chloe}`, { niveau: 'lecture' })).statut).toBeLessThan(300);
    expect((await lire('/factures', 'chloe')).statut).toBe(200);
    expect((await api('chloe', 'PUT', `${base()}/factures/${P.f6}/liens`, { type: 'imputation', cible: E.avoir, decision: 'confirme' })).statut).toBe(403);
    expect((await api('chloe', 'PUT', `${base()}/tiers/liens`, { cleComptable: 'aux:FA001', clePiece: `siren:${A.siren}`, decision: 'confirme' })).statut).toBe(403);
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' })).statut).toBeLessThan(300);
    // Aucune écriture importée n'a été modifiée, aucun lettrage écrit ; les décisions sont journalisées.
    const { rows } = await editeur.query(`select count(*)::int as n, count(ecriture_let)::int as lettrees from lignes_ecriture where entite_id = $1`, [dossier]);
    expect(rows[0]).toEqual({ n: lignesFec.length - 1, lettrees: 7 });
    const audit = await editeur.query(`select action, count(*)::int as n from journal_audit where cabinet_id = $1 and (action like 'tiers.%' or action like 'facture.%' or action like 'suspicion.%') group by action`, [cabinet]);
    const actions = Object.fromEntries(audit.rows.map((x) => [x.action, x.n]));
    expect(actions).toMatchObject({ 'tiers.lien_confirme': 1, 'facture.imputation_confirme': 3, 'facture.imputation_infirme': 1, 'facture.imputation_retirer': 1, 'facture.comptabilisation_confirme': 2, 'suspicion.confirme': 1, 'suspicion.infirme': 1 });
  });
});
