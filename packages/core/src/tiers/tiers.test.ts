import { describe, expect, it } from 'vitest';
import { ligne } from '../aides-tests.js';
import type { LigneEcriture } from '../controles/types.js';
import { normaliserNomTiers, suivreTiersEtFactures } from './moteur.js';
import type { DecisionFacture, DecisionTiers, DemandeTiersFactures, PieceFacture, RapprochementValide } from './types.js';

// SIREN synthétiques valides (clé de Luhn).
const SIREN_DOSSIER = '123456782';
const SIREN_DUPONT = '732829320';
const SIREN_AUTRE = '552100554';

let n = 0;
const num = (journal: string) => `${journal}${String(++n).padStart(5, '0')}`;

/** Facture d'achat comptabilisée : 606 + 44566 au débit, 401 au crédit. */
function achat(aux: string, lib: string, piece: string, date: string, ttc: string, extra: { lettre?: string; numero?: string; libelle?: string } = {}): LigneEcriture[] {
  const e = { journalCode: 'ACH', ecritureNum: extra.numero ?? num('ACH'), ecritureDate: date, pieceRef: piece, pieceDate: date, ecritureLib: extra.libelle ?? `Facture ${lib}` };
  return [
    ligne({ ...e, compteNum: '606100', debit: ttc }),
    ligne({ ...e, compteNum: '401000', compAuxNum: aux, compAuxLib: lib, credit: ttc, ecritureLet: extra.lettre ?? null }),
  ];
}
function avoirAchat(aux: string, lib: string, piece: string, date: string, ttc: string, extra: { lettre?: string; libelle?: string } = {}): LigneEcriture[] {
  const e = { journalCode: 'ACH', ecritureNum: num('ACH'), ecritureDate: date, pieceRef: piece, pieceDate: date, ecritureLib: extra.libelle ?? `Avoir ${lib}` };
  return [
    ligne({ ...e, compteNum: '401000', compAuxNum: aux, compAuxLib: lib, debit: ttc, ecritureLet: extra.lettre ?? null }),
    ligne({ ...e, compteNum: '606100', credit: ttc }),
  ];
}
/** Règlement fournisseur : 401 au débit, 512 au crédit. */
function paiement(aux: string, lib: string, date: string, montant: string, extra: { lettre?: string; piece?: string; libelle?: string; idBanque?: string } = {}): LigneEcriture[] {
  const e = { journalCode: 'BQ', ecritureNum: num('BQ'), ecritureDate: date, pieceRef: extra.piece ?? 'VIR', pieceDate: date, ecritureLib: extra.libelle ?? `Virement ${lib}` };
  return [
    ligne({ ...e, compteNum: '401000', compAuxNum: aux, compAuxLib: lib, debit: montant, ecritureLet: extra.lettre ?? null }),
    ligne({ ...e, compteNum: '512000', credit: montant, ...(extra.idBanque ? { id: extra.idBanque } : {}) }),
  ];
}
function vente(aux: string, lib: string, piece: string, date: string, ttc: string, lettre?: string): LigneEcriture[] {
  const e = { journalCode: 'VTE', ecritureNum: num('VTE'), ecritureDate: date, pieceRef: piece, pieceDate: date, ecritureLib: `Facture ${lib}` };
  return [
    ligne({ ...e, compteNum: '411000', compAuxNum: aux, compAuxLib: lib, debit: ttc, ecritureLet: lettre ?? null }),
    ligne({ ...e, compteNum: '706000', credit: ttc }),
  ];
}
function encaissement(aux: string, lib: string, date: string, montant: string, lettre?: string): LigneEcriture[] {
  const e = { journalCode: 'BQ', ecritureNum: num('BQ'), ecritureDate: date, pieceRef: 'REM', pieceDate: date, ecritureLib: `Encaissement ${lib}` };
  return [
    ligne({ ...e, compteNum: '512000', debit: montant }),
    ligne({ ...e, compteNum: '411000', compAuxNum: aux, compAuxLib: lib, credit: montant, ecritureLet: lettre ?? null }),
  ];
}

let d = 0;
function piece(p: Partial<PieceFacture> = {}): PieceFacture {
  d++;
  return {
    documentId: p.documentId ?? `doc-${String(d).padStart(3, '0')}`, nomFichier: `piece-${d}.pdf`, versionPiece: 1, versionExtraction: 1, nature: 'facture_achat', statutExtraction: 'valide', typeDocument: 'facture',
    numero: 'FA-2025-0042', dateEmission: '2025-03-10', dateEcheance: '2025-04-09', emetteurNom: 'DUPONT MATERIAUX SARL', emetteurSiren: SIREN_DUPONT, emetteurSiret: null, emetteurTva: null,
    totalHt: '1000.00', totalTva: '200.00', totalTtc: '1200.00', devise: 'EUR', ...p,
  };
}
function suivre(lignes: LigneEcriture[], pieces: PieceFacture[], extra: Partial<DemandeTiersFactures> = {}) {
  return suivreTiersEtFactures({
    lignes, exercice: { debut: '2025-01-01', fin: '2025-12-31' }, dateAppreciation: '2025-12-31', origineDateAppreciation: 'cloture_exercice', deviseDossier: 'EUR', sirenDossier: SIREN_DOSSIER, pieces,
    rapprochementsValides: [], decisionsTiers: [], decisionsFactures: [], ...extra,
  });
}
/** Tiers DUPONT lié par confirmation humaine : la plupart des cas partent d'un tiers identifié. */
const LIEN_DUPONT: DecisionTiers = { cleComptable: 'aux:FDUPONT', clePiece: `siren:${SIREN_DUPONT}`, decision: 'confirme' };

describe('normalisation des noms de tiers', () => {
  it('ignore accents, ponctuation, casse et forme juridique', () => {
    expect(normaliserNomTiers('Dupont Matériaux S.A.R.L.')).toBe('DUPONT MATERIAUX');
    expect(normaliserNomTiers('SAS  DUPONT-MATERIAUX')).toBe('DUPONT MATERIAUX');
    expect(normaliserNomTiers('  ')).toBeNull();
    expect(normaliserNomTiers(null)).toBeNull();
  });
});

describe('référentiel des tiers', () => {
  const lignes = [
    ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00'),
    ...paiement('FDUPONT', 'Dupont Matériaux', '2025-04-05', '500.00'),
    ...vente('CMARTIN', 'Martin SA', 'FV-001', '2025-02-01', '600.00'),
    ...vente('MIXTE', 'Mixte SAS', 'FV-002', '2025-02-02', '100.00'),
    ...achat('MIXTE', 'Mixte SAS', 'FM-1', '2025-02-03', '50.00'),
    ...achat('F1', 'Bernard', 'B-1', '2025-05-01', '10.00'),
    ...achat('F2', 'BERNARD SARL', 'B-2', '2025-05-02', '20.00'),
    ...achat(`F${SIREN_AUTRE}`, 'Fournisseur codé par SIREN', 'S-1', '2025-06-01', '30.00'),
    ligne({ journalCode: 'ACH', ecritureNum: 'ACH-SANSAUX', compteNum: '401000', credit: '75.00' }),
    ligne({ journalCode: 'ACH', ecritureNum: 'ACH-SANSAUX', compteNum: '606100', debit: '75.00' }),
  ];

  it('construit les tiers comptables : type, soldes tirés des écritures, écritures sans compte auxiliaire regroupées et signalées', () => {
    const r = suivre(lignes, []);
    const t = (cle: string) => r.tiers.find((x) => x.cle === cle)!;
    expect(t('aux:FDUPONT')).toMatchObject({ type: 'fournisseur', nom: 'Dupont Matériaux', totalDebit: '500.00', totalCredit: '1200.00', solde: '-700.00', nbLignes: 2, nbEcritures: 2, origine: 'comptable' });
    expect(t('aux:CMARTIN')).toMatchObject({ type: 'client', solde: '600.00' });
    expect(t('aux:MIXTE')).toMatchObject({ type: 'mixte', solde: '50.00', comptesGeneraux: ['401000', '411000'] });
    expect(t('general:401000')).toMatchObject({ sansAuxiliaire: true, compteAuxiliaire: null, solde: '-75.00' });
  });

  it('signale les homonymes sans jamais les fusionner', () => {
    const r = suivre(lignes, []);
    expect(r.tiers.find((x) => x.cle === 'aux:F1')!.homonymes).toEqual(['aux:F2']);
    expect(r.tiers.find((x) => x.cle === 'aux:F2')!.homonymes).toEqual(['aux:F1']);
    expect(r.tiers.filter((x) => x.cle === 'aux:F1' || x.cle === 'aux:F2')).toHaveLength(2);
  });

  it('rattache par identifiant fort (SIREN dans le compte auxiliaire) sans intervention', () => {
    const r = suivre(lignes, [piece({ emetteurSiren: SIREN_AUTRE, emetteurNom: 'Tout autre nom', numero: 'S-1', totalTtc: '30.00', dateEmission: '2025-06-01' })]);
    const t = r.tiers.find((x) => x.cle === `aux:F${SIREN_AUTRE}`)!;
    expect(t.tiersPieces).toEqual([{ cle: `siren:${SIREN_AUTRE}`, nom: 'Tout autre nom', lien: 'identifiant_fort' }]);
    expect(t.identifiants.map((i) => `${i.nature}:${i.origine}`)).toEqual(expect.arrayContaining(['siren:compte_auxiliaire', 'siren:piece']));
    expect(r.propositionsTiers).toEqual([]);
    expect(r.factures[0]!.comptabilisation.criteres!.tiers).toBe('identifie');
  });

  it('sans identifiant fort : PROPOSITION par nom normalisé, à confirmer ; le tiers de pièce reste distinct tant que personne ne confirme', () => {
    const r = suivre(lignes, [piece()]);
    expect(r.propositionsTiers).toEqual([
      expect.objectContaining({ clePiece: `siren:${SIREN_DUPONT}`, statut: 'a_confirmer', critere: 'nom_normalise_identique', nomNormalise: 'DUPONT MATERIAUX', candidats: [expect.objectContaining({ cle: 'aux:FDUPONT' })] }),
    ]);
    expect(r.tiers.find((x) => x.cle === 'aux:FDUPONT')!.tiersPieces).toEqual([]);
    expect(r.tiers.find((x) => x.cle === `piece:siren:${SIREN_DUPONT}`)).toMatchObject({ origine: 'piece', solde: null, totalDebit: null });
  });

  it('une confirmation humaine rattache ; une infirmation retire la proposition', () => {
    const confirme = suivre(lignes, [piece()], { decisionsTiers: [LIEN_DUPONT] });
    expect(confirme.propositionsTiers).toEqual([]);
    expect(confirme.tiers.find((x) => x.cle === 'aux:FDUPONT')!.tiersPieces).toEqual([{ cle: `siren:${SIREN_DUPONT}`, nom: 'DUPONT MATERIAUX SARL', lien: 'confirme' }]);
    expect(confirme.tiers.some((x) => x.cle.startsWith('piece:'))).toBe(false);
    const infirme = suivre(lignes, [piece()], { decisionsTiers: [{ ...LIEN_DUPONT, decision: 'infirme' }] });
    expect(infirme.propositionsTiers).toEqual([]);
    expect(infirme.tiers.find((x) => x.cle === 'aux:FDUPONT')!.tiersPieces).toEqual([]);
  });

  it('homonymes : la proposition liste tous les candidats et n’en retient aucun', () => {
    const r = suivre(lignes, [piece({ emetteurNom: 'Bernard', emetteurSiren: null, numero: 'B-1', totalTtc: '10.00', dateEmission: '2025-05-01' })]);
    expect(r.propositionsTiers[0]).toMatchObject({ statut: 'homonymes', clePiece: 'nom:BERNARD' });
    expect(r.propositionsTiers[0]!.candidats.map((c) => c.cle)).toEqual(['aux:F1', 'aux:F2']);
    // Le lien pièce ↔ écriture reste une proposition : le tiers n'est pas établi.
    expect(r.factures[0]!.comptabilisation).toMatchObject({ statut: 'a_confirmer', ecriture: null });
    expect(r.factures[0]!.comptabilisation.propositions[0]!.criteres.tiers).toBe('homonymes');
  });

  it('une décision portant sur un tiers disparu est signalée « à revoir » et n’est pas appliquée', () => {
    const r = suivre(lignes, [], { decisionsTiers: [LIEN_DUPONT] });
    expect(r.decisionsARevoir).toEqual([expect.objectContaining({ type: 'tiers', objet: 'aux:FDUPONT' })]);
  });
});

describe('factures : appariement avec les écritures', () => {
  it('nominal : tiers, référence, montant et date concordent → apparié, preuves jointes', () => {
    const lignes = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-12', '1200.00');
    const f = suivre(lignes, [piece()], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!;
    expect(f.comptabilisation).toMatchObject({ statut: 'apparie', criteres: { montant: 'exact', reference: 'identique', date: 'concordante', tiers: 'identifie' } });
    expect(f.comptabilisation.ecriture).toMatchObject({ journalCode: 'ACH', montant: '1200.00', sens: 'credit', compAuxNum: 'FDUPONT' });
    expect(f.tiersCle).toBe('aux:FDUPONT');
    expect(f.preuves.map((p) => p.libelle)).toEqual(['Pièce', 'Extraction', 'Date d’appréciation', 'Écriture', 'Lien pièce ↔ écriture']);
  });

  it('référence citée dans le libellé (et non dans la référence de pièce) : « mentionnée », sans confondre avec un numéro plus long', () => {
    const lignes = [
      ...achat('FDUPONT', 'Dupont Matériaux', 'P77', '2025-03-10', '1200.00', { libelle: 'Dupont fact. FA 2025 0042' }),
      ...achat('FDUPONT', 'Dupont Matériaux', 'P78', '2025-03-10', '1200.00', { libelle: 'Dupont FA-2025-00421' }),
    ];
    const f = suivre(lignes, [piece()], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!;
    expect(f.comptabilisation.statut).toBe('apparie');
    expect(f.comptabilisation.criteres!.reference).toBe('mentionnee');
    expect(f.comptabilisation.ecriture!.pieceRef).toBe('P77');
  });

  it('montant différent d’un centime : aucun appariement (aucune tolérance)', () => {
    const f = suivre(achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.01'), [piece()], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!;
    expect(f.comptabilisation).toMatchObject({ statut: 'non_trouve', ecriture: null });
    expect(f).toMatchObject({ etat: 'non_determinable', resteDu: null });
    expect(f.motifEtat).toMatch(/non identifiée/);
  });

  it('date éloignée ou tiers non établi : PROPOSITION à confirmer, jamais retenue d’office', () => {
    const lignes = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-09-30', '1200.00');
    lignes.forEach((l) => (l.pieceDate = '2025-09-30'));
    const f = suivre(lignes, [piece()], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!;
    expect(f.comptabilisation).toMatchObject({ statut: 'a_confirmer', ecriture: null });
    expect(f.comptabilisation.propositions).toEqual([expect.objectContaining({ niveau: 'proposable', criteres: expect.objectContaining({ date: 'ecart' }) })]);
    expect(f.etat).toBe('non_determinable');
  });

  it('une confirmation humaine établit le lien ; une infirmation écarte l’écriture, même parfaitement concordante', () => {
    const lignes = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-09-30', '1200.00', { numero: 'ACH-X' });
    lignes.forEach((l) => (l.pieceDate = '2025-09-30'));
    const p1 = piece({ documentId: 'doc-conf' });
    const conf: DecisionFacture = { type: 'comptabilisation', objet: 'doc-conf', cible: 'ACH|ACH-X', decision: 'confirme', versionExtraction: 1 };
    const f = suivre(lignes, [p1], { decisionsTiers: [LIEN_DUPONT], decisionsFactures: [conf] }).factures[0]!;
    expect(f.comptabilisation).toMatchObject({ statut: 'confirme', ecriture: { cle: 'ACH|ACH-X' } });
    expect(f.etat).toBe('echue_non_reglee');
    const concordant = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00', { numero: 'ACH-Y' });
    const g = suivre(concordant, [p1], { decisionsTiers: [LIEN_DUPONT], decisionsFactures: [{ ...conf, cible: 'ACH|ACH-Y', decision: 'infirme' }] }).factures[0]!;
    expect(g.comptabilisation.statut).toBe('non_trouve');
  });

  it('facture de vente : le client n’est pas lu sur la pièce → jamais apparié d’office, proposition par la référence', () => {
    const lignes = vente('CMARTIN', 'Martin SA', 'FV-2025-010', '2025-02-01', '600.00');
    const f = suivre(lignes, [piece({ nature: 'facture_vente', numero: 'FV-2025-010', totalTtc: '600.00', dateEmission: '2025-02-01', emetteurSiren: SIREN_DOSSIER })]).factures[0]!;
    expect(f).toMatchObject({ sens: 'vente', tiersPiece: null });
    expect(f.motifTiers).toMatch(/destinataire/);
    expect(f.comptabilisation.statut).toBe('a_confirmer');
    expect(f.comptabilisation.propositions[0]!.criteres).toMatchObject({ reference: 'identique', tiers: 'non_determinable' });
  });

  it('une écriture de règlement ou d’à-nouveau n’est jamais prise pour l’écriture de la facture', () => {
    const lignes = [
      ...encaissement('FDUPONT', 'x', '2025-03-10', '1200.00'),
      ligne({ journalCode: 'AN', ecritureNum: 'AN1', compteNum: '401000', compAuxNum: 'FDUPONT', compAuxLib: 'Dupont Matériaux', credit: '1200.00', pieceRef: 'FA-2025-0042', ecritureDate: '2025-03-10' }),
      ligne({ journalCode: 'AN', ecritureNum: 'AN1', compteNum: '120000', debit: '1200.00', pieceRef: 'FA-2025-0042', ecritureDate: '2025-03-10' }),
    ];
    expect(suivre(lignes, [piece()], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!.comptabilisation.statut).toBe('non_trouve');
  });
});

describe('échéances et règlements', () => {
  const D = { decisionsTiers: [LIEN_DUPONT] };
  const fa = (extra: { lettre?: string } = {}) => achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00', extra);

  it('réglée : règlement lettré, preuve bancaire par rapprochement VALIDÉ', () => {
    const lignes = [...fa({ lettre: 'A' }), ...paiement('FDUPONT', 'Dupont Matériaux', '2025-04-05', '1200.00', { lettre: 'A', idBanque: 'banque-1' })];
    const rapp: RapprochementValide = { id: 'rap-1', lignesEcriture: ['banque-1'], mouvements: [{ id: 'mvt-1', date: '2025-04-05', montant: '-1200.00', libelle: 'VIR DUPONT' }] };
    const f = suivre(lignes, [piece()], { ...D, rapprochementsValides: [rapp] }).factures[0]!;
    expect(f).toMatchObject({ etat: 'reglee', montantRegle: '1200.00', resteDu: '0.00' });
    expect(f.imputations).toEqual([expect.objectContaining({ nature: 'reglement', mode: 'lettrage', montant: '1200.00', partage: false, comptee: true, banque: { statut: 'valide', rapprochementId: 'rap-1', mouvements: rapp.mouvements } })]);
    // Sans rapprochement validé, le règlement reste identifié par le lettrage mais sans preuve bancaire.
    expect(suivre(lignes, [piece()], D).factures[0]!.imputations[0]!.banque).toEqual({ statut: 'non_rapproche', rapprochementId: null, mouvements: [] });
  });

  it('partiels : deux règlements lettrés sur une facture → partiellement réglée, reste dû calculé, échue', () => {
    const lignes = [...fa({ lettre: 'b' }), ...paiement('FDUPONT', 'D', '2025-04-05', '400.00', { lettre: 'b' }), ...paiement('FDUPONT', 'D', '2025-05-05', '300.00', { lettre: 'b' })];
    const f = suivre(lignes, [piece()], D).factures[0]!;
    expect(f).toMatchObject({ etat: 'partiellement_reglee', montantRegle: '700.00', resteDu: '500.00', echue: true, joursDeRetard: 266 });
    expect(f.imputations).toHaveLength(2);
  });

  it('partiel non lettré : le règlement qui cite le numéro de la facture est identifié ; celui qui ne cite rien n’est qu’une proposition', () => {
    const lignes = [
      ...fa(),
      ...paiement('FDUPONT', 'D', '2025-04-05', '400.00', { libelle: 'Acompte FA-2025-0042' }),
      ...paiement('FDUPONT', 'D', '2025-06-01', '800.00', { libelle: 'Virement' }),
    ];
    const f = suivre(lignes, [piece()], D).factures[0]!;
    expect(f).toMatchObject({ etat: 'partiellement_reglee', montantRegle: '400.00', resteDu: '800.00' });
    expect(f.imputations).toEqual([expect.objectContaining({ mode: 'reference', montant: '400.00' })]);
    expect(f.propositionsImputation).toEqual([expect.objectContaining({ critere: 'montant_exact', ambigue: false, nature: 'reglement' })]);
    // Confirmée par une personne, la proposition devient un règlement identifié.
    const cible = f.propositionsImputation[0]!.ecriture.cle;
    const g = suivre(lignes, [piece({ documentId: f.id })], { ...D, decisionsFactures: [{ type: 'imputation', objet: f.id, cible, decision: 'confirme' }] }).factures[0]!;
    expect(g).toMatchObject({ etat: 'reglee', resteDu: '0.00' });
    expect(g.imputations.map((i) => i.mode).sort()).toEqual(['confirmation', 'reference']);
    // Infirmée, elle disparaît.
    const h = suivre(lignes, [piece({ documentId: f.id })], { ...D, decisionsFactures: [{ type: 'imputation', objet: f.id, cible, decision: 'infirme' }] }).factures[0]!;
    expect(h.propositionsImputation).toEqual([]);
    expect(h.etat).toBe('partiellement_reglee');
  });

  it('groupé lettré : un règlement solde deux factures → chacune réglée, règlement marqué partagé', () => {
    const lignes = [
      ...fa({ lettre: 'C' }),
      ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0043', '2025-03-20', '800.00', { lettre: 'C' }),
      ...paiement('FDUPONT', 'D', '2025-04-30', '2000.00', { lettre: 'C' }),
    ];
    const r = suivre(lignes, [piece(), piece({ numero: 'FA-2025-0043', totalTtc: '800.00', dateEmission: '2025-03-20' })], D);
    expect(r.factures.map((f) => [f.etat, f.montantRegle, f.resteDu])).toEqual([['reglee', '1200.00', '0.00'], ['reglee', '800.00', '0.00']]);
    expect(r.factures.every((f) => f.imputations[0]!.partage && f.imputations[0]!.montant === null)).toBe(true);
  });

  it('groupé lettré NON soldé : la répartition n’est pas inventée → non déterminable, avec son motif', () => {
    const lignes = [
      ...fa({ lettre: 'C' }),
      ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0043', '2025-03-20', '800.00', { lettre: 'C' }),
      ...paiement('FDUPONT', 'D', '2025-04-30', '1500.00', { lettre: 'C' }),
    ];
    const r = suivre(lignes, [piece(), piece({ numero: 'FA-2025-0043', totalTtc: '800.00', dateEmission: '2025-03-20' })], D);
    for (const f of r.factures) {
      expect(f).toMatchObject({ etat: 'non_determinable', resteDu: null });
      expect(f.motifEtat).toMatch(/non soldé \(reste 500\.00\) regroupant 2 factures/);
    }
  });

  it('groupé non lettré : un règlement citant deux factures dont il égale la somme les règle toutes deux ; sinon proposition', () => {
    const base = [...fa(), ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0043', '2025-03-20', '800.00')];
    const pieces = () => [piece(), piece({ numero: 'FA-2025-0043', totalTtc: '800.00', dateEmission: '2025-03-20' })];
    const exact = suivre([...base, ...paiement('FDUPONT', 'D', '2025-04-30', '2000.00', { libelle: 'Rglt FA-2025-0042 FA-2025-0043' })], pieces(), D);
    expect(exact.factures.map((f) => f.etat)).toEqual(['reglee', 'reglee']);
    expect(exact.factures[0]!.imputations[0]).toMatchObject({ mode: 'reference', partage: true, montant: '1200.00' });
    const inexact = suivre([...base, ...paiement('FDUPONT', 'D', '2025-04-30', '1900.00', { libelle: 'Rglt FA-2025-0042 FA-2025-0043' })], pieces(), D);
    expect(inexact.factures.map((f) => f.etat)).toEqual(['echue_non_reglee', 'echue_non_reglee']);
    expect(inexact.factures[0]!.propositionsImputation[0]).toMatchObject({ critere: 'reference_multiple', ambigue: true });
  });

  it('avoir (compensation) : lettré avec la facture et son règlement → facture réglée, avoir imputé et relié à sa pièce', () => {
    const lignes = [
      ...fa({ lettre: 'D' }),
      ...avoirAchat('FDUPONT', 'Dupont Matériaux', 'AV-2025-0007', '2025-03-25', '200.00', { lettre: 'D' }),
      ...paiement('FDUPONT', 'D', '2025-04-05', '1000.00', { lettre: 'D' }),
    ];
    const avoir = piece({ documentId: 'doc-avoir', nature: 'avoir', typeDocument: 'avoir', numero: 'AV-2025-0007', totalHt: '-166.67', totalTva: '-33.33', totalTtc: '-200.00', dateEmission: '2025-03-25', dateEcheance: null });
    const r = suivre(lignes, [piece({ documentId: 'doc-fact' }), avoir], D);
    const f = r.factures.find((x) => x.id === 'doc-fact')!;
    const a = r.factures.find((x) => x.id === 'doc-avoir')!;
    expect(f).toMatchObject({ etat: 'reglee', montantRegle: '1200.00', resteDu: '0.00' });
    expect(f.imputations.map((i) => [i.nature, i.montant, i.avoirDocumentId]).sort()).toEqual([['avoir', '200.00', 'doc-avoir'], ['reglement', '1000.00', null]]);
    expect(a).toMatchObject({ type: 'avoir', sens: 'achat', montant: '200.00', etat: 'avoir_impute', imputeSur: [{ factureId: 'doc-fact', montant: '200.00' }] });
  });

  it('avoir non lettré du même tiers : PROPOSITION d’imputation ; confirmé → facture partiellement réglée par compensation', () => {
    const lignes = [...fa(), ...avoirAchat('FDUPONT', 'Dupont Matériaux', 'AV-2025-0007', '2025-03-25', '200.00')];
    const avoir = piece({ documentId: 'doc-avoir', nature: 'avoir', typeDocument: 'avoir', numero: 'AV-2025-0007', totalTtc: '-200.00', dateEmission: '2025-03-25', dateEcheance: null });
    const r = suivre(lignes, [piece({ documentId: 'doc-fact' }), avoir], D);
    const f = r.factures.find((x) => x.id === 'doc-fact')!;
    expect(f.etat).toBe('echue_non_reglee');
    expect(f.propositionsImputation).toEqual([expect.objectContaining({ critere: 'avoir_meme_tiers', nature: 'avoir', avoirDocumentId: 'doc-avoir' })]);
    expect(r.factures.find((x) => x.id === 'doc-avoir')!.etat).toBe('avoir_non_impute');
    const cible = f.propositionsImputation[0]!.ecriture.cle;
    const s = suivre(lignes, [piece({ documentId: 'doc-fact' }), avoir], { ...D, decisionsFactures: [{ type: 'imputation', objet: 'doc-fact', cible, decision: 'confirme' }] });
    expect(s.factures.find((x) => x.id === 'doc-fact')).toMatchObject({ etat: 'partiellement_reglee', montantRegle: '200.00', resteDu: '1000.00' });
    expect(s.factures.find((x) => x.id === 'doc-avoir')).toMatchObject({ etat: 'avoir_impute', resteDu: '0.00' });
  });

  it('trop-perçu : un règlement supérieur à la facture est dit, avec son excédent', () => {
    const lignes = [...fa({ lettre: 'E' }), ...paiement('FDUPONT', 'D', '2025-04-05', '1250.00', { lettre: 'E' })];
    const f = suivre(lignes, [piece()], D).factures[0]!;
    expect(f).toMatchObject({ etat: 'trop_percu', resteDu: '-50.00' });
    expect(f.motifEtat).toMatch(/50\.00/);
  });

  it('date d’appréciation explicite : non échue avant l’échéance ; un règlement postérieur est listé mais non compté', () => {
    const lignes = [...fa({ lettre: 'F' }), ...paiement('FDUPONT', 'D', '2025-04-05', '1200.00', { lettre: 'F' })];
    const avant = suivre(lignes, [piece()], { ...D, dateAppreciation: '2025-03-31', origineDateAppreciation: 'fournie' });
    expect(avant.dateAppreciation).toBe('2025-03-31');
    expect(avant.factures[0]).toMatchObject({ etat: 'non_echue', montantRegle: '0.00', resteDu: '1200.00', echue: false, joursDeRetard: null });
    expect(avant.factures[0]!.imputations[0]).toMatchObject({ comptee: false });
    expect(avant.factures[0]!.preuves.find((p) => p.libelle === 'Date d’appréciation')!.valeur).toBe('2025-03-31 (date fournie)');
    const echue = suivre(fa(), [piece()], { ...D, dateAppreciation: '2025-04-10', origineDateAppreciation: 'fournie' });
    expect(echue.factures[0]).toMatchObject({ etat: 'echue_non_reglee', joursDeRetard: 1 });
    // Le jour même de l'échéance, la facture n'est pas encore échue.
    expect(suivre(fa(), [piece()], { ...D, dateAppreciation: '2025-04-09', origineDateAppreciation: 'fournie' }).factures[0]!.etat).toBe('non_echue');
    expect(() => suivre(fa(), [piece()], { dateAppreciation: 'hier' })).toThrow(/Date d’appréciation/);
  });

  it('encaissement client lettré : une vente confirmée par une personne est suivie comme un achat', () => {
    const lignes = [...vente('CMARTIN', 'Martin SA', 'FV-2025-010', '2025-02-01', '600.00', 'G'), ...encaissement('CMARTIN', 'Martin SA', '2025-02-20', '600.00', 'G')];
    const p1 = piece({ documentId: 'doc-vente', nature: 'facture_vente', numero: 'FV-2025-010', totalTtc: '600.00', dateEmission: '2025-02-01', dateEcheance: '2025-03-03' });
    const cible = suivre(lignes, [p1]).factures[0]!.comptabilisation.propositions[0]!.ecriture.cle;
    const f = suivre(lignes, [p1], { decisionsFactures: [{ type: 'comptabilisation', objet: 'doc-vente', cible, decision: 'confirme' }] }).factures[0]!;
    expect(f).toMatchObject({ etat: 'reglee', tiersCle: 'aux:CMARTIN', comptabilisation: { statut: 'confirme' } });
  });
});

describe('données manquantes : jamais un résultat favorable', () => {
  const D = { decisionsTiers: [LIEN_DUPONT] };
  const lignes = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00');

  it('échéance non lue et aucun règlement : non déterminable (jamais « non échue »), reste dû tout de même calculé', () => {
    const f = suivre(lignes, [piece({ dateEcheance: null })], D).factures[0]!;
    expect(f).toMatchObject({ etat: 'non_determinable', echue: null, resteDu: '1200.00' });
    expect(f.motifEtat).toMatch(/échéance non lue/);
  });

  it('total TTC non lu, aucune écriture, émetteur non lu : non recherché, avec le motif', () => {
    expect(suivre(lignes, [piece({ totalTtc: null })], D).factures[0]).toMatchObject({ etat: 'non_determinable', montant: null, comptabilisation: { statut: 'non_recherche', motif: expect.stringMatching(/TTC non lu/) } });
    expect(suivre([], [piece()], D).factures[0]!.comptabilisation).toMatchObject({ statut: 'non_recherche', motif: expect.stringMatching(/Aucune écriture/) });
    const sansEmetteur = suivre(lignes, [piece({ emetteurNom: null, emetteurSiren: null })], D).factures[0]!;
    expect(sansEmetteur.tiersPiece).toBeNull();
    expect(sansEmetteur.motifTiers).toMatch(/Émetteur non lu/);
    expect(sansEmetteur.comptabilisation.statut).toBe('a_confirmer');
  });

  it('devise autre que l’euro : non traité, et dit', () => {
    const f = suivre(lignes, [piece({ devise: 'USD' })], D).factures[0]!;
    expect(f).toMatchObject({ etat: 'non_determinable', comptabilisation: { statut: 'non_recherche' } });
    expect(f.motifEtat).toMatch(/USD.*ne sont pas traitées/);
    const dossier = suivre(lignes, [piece()], { ...D, deviseDossier: 'CHF' });
    expect(dossier.reserves.join(' ')).toMatch(/CHF : seul l’euro est traité/);
    expect(dossier.factures[0]!.etat).toBe('non_determinable');
  });

  it('extraction non validée : la fiche existe mais porte la réserve « projet »', () => {
    const f = suivre(lignes, [piece({ statutExtraction: 'projet' })], D).factures[0]!;
    expect(f.statutExtraction).toBe('projet');
    expect(f.reserves.join(' ')).toMatch(/non validée/);
  });

  it('décisions devenues sans objet : pièce remplacée, extraction modifiée, écriture disparue → « à revoir », non appliquées', () => {
    const p1 = piece({ documentId: 'doc-v2', versionExtraction: 3 });
    const r = suivre(lignes, [p1], {
      ...D,
      decisionsFactures: [
        { type: 'comptabilisation', objet: 'doc-v1', cible: 'ACH|X', decision: 'confirme' },
        { type: 'comptabilisation', objet: 'doc-v2', cible: cleDe(lignes), decision: 'infirme', versionExtraction: 2 },
        { type: 'imputation', objet: 'doc-v2', cible: 'BQ|ABSENTE', decision: 'confirme', versionExtraction: 3 },
        { type: 'suspicion', objet: 'E:ACH|A+ACH|B', cible: 'suspicion', decision: 'infirme' },
      ],
    });
    expect(r.decisionsARevoir.map((x) => x.motif)).toEqual([
      expect.stringMatching(/remplacée/), expect.stringMatching(/champs extraits/), expect.stringMatching(/absente des données/), expect.stringMatching(/n’existe plus/),
    ]);
    // L'infirmation périmée n'écarte plus l'écriture.
    expect(r.factures[0]!.comptabilisation.statut).toBe('apparie');
  });
});
const cleDe = (lignes: LigneEcriture[]) => `${lignes[0]!.journalCode}|${lignes[0]!.ecritureNum}`;

describe('suspicion de double comptabilisation', () => {
  const D = { decisionsTiers: [LIEN_DUPONT] };

  it('une même facture portée par deux écritures : signalée avec ses preuves, aucune écriture retenue', () => {
    const lignes = [
      ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00', { numero: 'ACH-A' }),
      ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-28', '1200.00', { numero: 'ACH-B' }),
    ];
    const r = suivre(lignes, [piece({ documentId: 'doc-x' })], D);
    expect(r.suspicions).toEqual([
      expect.objectContaining({ cle: 'E:ACH|ACH-A+ACH|ACH-B', type: 'ecritures_multiples', tiers: 'aux:FDUPONT', montant: '1200.00', documentIds: ['doc-x'], statut: 'a_examiner' }),
    ]);
    expect(r.suspicions[0]!.ecritures.map((e) => e.cle)).toEqual(['ACH|ACH-A', 'ACH|ACH-B']);
    expect(r.factures[0]).toMatchObject({ etat: 'non_determinable', suspicions: ['E:ACH|ACH-A+ACH|ACH-B'], comptabilisation: { statut: 'ambigu', ecriture: null } });
    expect(r.factures[0]!.comptabilisation.propositions).toHaveLength(2);
    // Décision d'une personne habilitée : écartée ou confirmée — le lien reste à choisir explicitement.
    const ecartee = suivre(lignes, [piece({ documentId: 'doc-x' })], { ...D, decisionsFactures: [{ type: 'suspicion', objet: 'E:ACH|ACH-A+ACH|ACH-B', cible: 'suspicion', decision: 'infirme' }] });
    expect(ecartee.suspicions[0]!.statut).toBe('ecartee');
    expect(ecartee.factures[0]!.comptabilisation.statut).toBe('ambigu');
    const confirmee = suivre(lignes, [piece({ documentId: 'doc-x' })], { ...D, decisionsFactures: [{ type: 'suspicion', objet: 'E:ACH|ACH-A+ACH|ACH-B', cible: 'suspicion', decision: 'confirme' }] });
    expect(confirmee.suspicions[0]!.statut).toBe('confirmee');
  });

  it('détectée sur les seules écritures, même sans pièce déposée ; des montants ou des tiers différents ne la déclenchent pas', () => {
    const lignes = [
      ...achat('FDUPONT', 'Dupont Matériaux', 'LOYER-03', '2025-03-01', '900.00'),
      ...achat('FDUPONT', 'Dupont Matériaux', 'LOYER-03', '2025-03-01', '900.00'),
      ...achat('FDUPONT', 'Dupont Matériaux', 'LOYER-04', '2025-04-01', '900.00'),
      ...achat('FAUTRE', 'Autre', 'LOYER-03', '2025-03-01', '900.00'),
      ...achat('FDUPONT', 'Dupont Matériaux', 'LOYER-03', '2025-03-01', '901.00'),
    ];
    const r = suivre(lignes, []);
    expect(r.suspicions).toHaveLength(1);
    expect(r.suspicions[0]).toMatchObject({ type: 'ecritures_multiples', reference: 'LOYER-03', montant: '900.00', documentIds: [] });
    expect(r.suspicions[0]!.ecritures).toHaveLength(2);
  });

  it('deux pièces distinctes portant la même facture : signalées (ni doublon binaire, ni nouvelle version), l’écriture n’est attribuée à aucune', () => {
    const lignes = achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00');
    const r = suivre(lignes, [piece({ documentId: 'doc-a' }), piece({ documentId: 'doc-b' })], D);
    expect(r.suspicions).toEqual([expect.objectContaining({ cle: 'P:doc-a+doc-b', type: 'pieces_multiples', documentIds: ['doc-a', 'doc-b'], reference: 'FA-2025-0042', statut: 'a_examiner' })]);
    expect(r.suspicions[0]!.explication).toMatch(/ni un doublon binaire/);
    expect(r.factures.map((f) => f.comptabilisation.statut)).toEqual(['ambigu', 'ambigu']);
    expect(r.factures.every((f) => f.etat === 'non_determinable' && f.suspicions.includes('P:doc-a+doc-b'))).toBe(true);
    // Une personne rattache l'écriture à l'une des deux pièces : l'autre n'a plus de candidat.
    const s = suivre(lignes, [piece({ documentId: 'doc-a' }), piece({ documentId: 'doc-b' })], { ...D, decisionsFactures: [{ type: 'comptabilisation', objet: 'doc-a', cible: cleDe(lignes), decision: 'confirme' }] });
    expect(s.factures.map((f) => f.comptabilisation.statut)).toEqual(['confirme', 'non_trouve']);
    expect(s.suspicions[0]!.type).toBe('pieces_multiples');
  });

  it('des numéros différents ne sont pas une suspicion', () => {
    const lignes = [...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00'), ...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0050', '2025-03-15', '1200.00')];
    const r = suivre(lignes, [piece(), piece({ numero: 'FA-2025-0050', dateEmission: '2025-03-15' })], D);
    expect(r.suspicions).toEqual([]);
    expect(r.factures.map((f) => f.comptabilisation.statut)).toEqual(['apparie', 'apparie']);
  });
});

describe('déterminisme et montants', () => {
  it('même demande, même résultat ; tous les montants sont des chaînes décimales à deux décimales', () => {
    const lignes = [...achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '0.10', { lettre: 'Z' }), ...paiement('FDUPONT', 'D', '2025-03-11', '0.07', { lettre: 'Z' }), ...paiement('FDUPONT', 'D', '2025-03-12', '0.02', { lettre: 'Z' })];
    const pieces = [piece({ documentId: 'doc-d', totalTtc: '0.10' })];
    const a = suivre(lignes, pieces, { decisionsTiers: [LIEN_DUPONT] });
    const b = suivre([...lignes].reverse(), pieces, { decisionsTiers: [LIEN_DUPONT] });
    expect(a.factures[0]).toMatchObject({ montantRegle: '0.09', resteDu: '0.01', etat: 'partiellement_reglee' });
    expect(b.factures[0]).toMatchObject({ montantRegle: '0.09', resteDu: '0.01' });
    expect(JSON.stringify(a.tiers)).toBe(JSON.stringify(b.tiers));
    for (const m of JSON.stringify(a).matchAll(/"(montant|solde|resteDu|montantRegle|totalDebit|totalCredit)":"(-?\d[^"]*)"/g)) expect(m[2]).toMatch(/^-?\d+\.\d{2}$/);
  });
});

describe('ventes : le destinataire lu sur la pièce identifie le client', () => {
  const SIREN_MARTIN = SIREN_AUTRE;
  const pieceVente = (p: Partial<PieceFacture> = {}): PieceFacture =>
    piece({ nature: 'facture_vente', numero: 'FV-2025-010', totalTtc: '600.00', dateEmission: '2025-02-01', dateEcheance: '2025-03-03', emetteurNom: 'DOSSIER SARL', emetteurSiren: SIREN_DOSSIER, destinataireNom: 'MARTIN SA', destinataireSiren: SIREN_MARTIN, ...p });

  it('vente appariée d’office : montant égal, référence, date, client identifié par le SIREN du compte auxiliaire', () => {
    const lignes = vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00');
    const r = suivre(lignes, [pieceVente()]);
    const f = r.factures[0]!;
    expect(f).toMatchObject({ sens: 'vente', sensLu: 'vente', roleTiersPiece: 'destinataire', tiersCle: 'aux:CMARTIN', motifTiers: null });
    expect(f.tiersPiece).toMatchObject({ cle: `siren:${SIREN_MARTIN}`, nom: 'MARTIN SA', siren: SIREN_MARTIN });
    expect(f.comptabilisation).toMatchObject({ statut: 'apparie', criteres: { montant: 'exact', reference: 'identique', date: 'concordante', tiers: 'identifie' } });
    expect(f.comptabilisation.ecriture).toMatchObject({ compteNum: '411000', compAuxNum: 'CMARTIN', sens: 'debit' });
    expect(f.etat).toBe('echue_non_reglee');
    expect(r.tiers.find((t) => t.cle === 'aux:CMARTIN')!.tiersPieces).toEqual([{ cle: `siren:${SIREN_MARTIN}`, nom: 'MARTIN SA', lien: 'identifiant_fort' }]);
  });
  it('SIREN du client tiré de son SIRET ou de son numéro de TVA ; encaissement lettré suivi', () => {
    const lignes = [...vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00', 'A'), ...encaissement('CMARTIN', 'Martin SA', '2025-02-20', '600.00', 'A')];
    const f = suivre(lignes, [pieceVente({ destinataireSiren: null, destinataireTva: `FR96${SIREN_MARTIN}` })]).factures[0]!;
    expect(f.comptabilisation.statut).toBe('apparie');
    expect(f).toMatchObject({ etat: 'reglee', resteDu: '0.00' });
  });
  it('client proposé par son nom (candidat unique côté clients) : apparié comme un achat ; jamais sur un compte fournisseur homonyme', () => {
    const lignes = [...vente('CMARTIN', 'Martin SA', 'FV-2025-010', '2025-02-01', '600.00'), ...achat('FMARTIN', 'MARTIN', 'X-1', '2025-02-01', '50.00')];
    const r = suivre(lignes, [pieceVente({ destinataireSiren: null })]);
    expect(r.factures[0]!.comptabilisation).toMatchObject({ statut: 'apparie', criteres: { tiers: 'propose' } });
    expect(r.propositionsTiers).toHaveLength(1);
    expect(r.propositionsTiers[0]!.candidats.map((c) => c.cle)).toEqual(['aux:CMARTIN']);
  });
  it('mêmes exigences que pour un achat : référence absente ou date éloignée → à confirmer ; montant différent → non trouvé', () => {
    const base = (ref: string, date: string, ttc: string) => vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, ref, date, ttc);
    expect(suivre(base('AUTRE-REF', '2025-02-01', '600.00'), [pieceVente()]).factures[0]!.comptabilisation).toMatchObject({ statut: 'a_confirmer', propositions: [{ criteres: { reference: 'absente', tiers: 'identifie' } }] });
    expect(suivre(base('FV-2025-010', '2025-06-30', '600.00').map((l) => ({ ...l, pieceDate: '2025-06-30' })), [pieceVente()]).factures[0]!.comptabilisation).toMatchObject({ statut: 'a_confirmer', propositions: [{ criteres: { date: 'ecart' } }] });
    expect(suivre(base('FV-2025-010', '2025-02-01', '600.01'), [pieceVente()]).factures[0]!.comptabilisation.statut).toBe('non_trouve');
  });
  it('vente ambiguë : deux écritures réunissent tous les critères → aucune retenue ; client homonyme → à confirmer', () => {
    const deux = [...vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00'), ...vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-03', '600.00')];
    const a = suivre(deux, [pieceVente()]);
    expect(a.factures[0]!.comptabilisation).toMatchObject({ statut: 'ambigu', ecriture: null });
    expect(a.suspicions.some((x) => x.type === 'ecritures_multiples')).toBe(true);
    const homonymes = [...vente('CMARTIN1', 'Martin SA', 'FV-2025-010', '2025-02-01', '600.00'), ...vente('CMARTIN2', 'MARTIN', 'FV-2025-099', '2025-02-01', '10.00')];
    const h = suivre(homonymes, [pieceVente({ destinataireSiren: null })]);
    expect(h.factures[0]!.comptabilisation).toMatchObject({ statut: 'a_confirmer', propositions: [{ criteres: { tiers: 'homonymes' } }] });
    expect(h.propositionsTiers[0]!.statut).toBe('homonymes');
  });
  it('client lu différent du tiers de l’écriture : pas d’appariement d’office', () => {
    const lignes = vente('CDURAND', `Durand SAS ${SIREN_DUPONT}`, 'FV-2025-010', '2025-02-01', '600.00');
    const f = suivre(lignes, [pieceVente()], { decisionsTiers: [{ cleComptable: 'aux:CMARTIN', clePiece: `siren:${SIREN_MARTIN}`, decision: 'confirme' }] }).factures[0]!;
    expect(f.comptabilisation.statut).toBe('a_confirmer');
    expect(f.comptabilisation.propositions[0]!.criteres.tiers).toBe('sans_lien');
  });
  it('vente sans destinataire (extraction antérieure ou abstention) : comportement inchangé, à confirmer', () => {
    const lignes = vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00');
    for (const sans of [{ destinataireNom: null, destinataireSiren: null }, { destinataireNom: undefined, destinataireSiren: undefined }]) {
      const f = suivre(lignes, [pieceVente(sans)]).factures[0]!;
      expect(f).toMatchObject({ sens: 'vente', tiersPiece: null, roleTiersPiece: null });
      expect(f.motifTiers).toMatch(/destinataire n’a pas été lu/);
      expect(f.comptabilisation).toMatchObject({ statut: 'a_confirmer', propositions: [{ criteres: { tiers: 'non_determinable' } }] });
    }
  });
  it('destinataire dont la clé de SIREN est fausse : non retenu comme identifiant fort (le nom seul reste une proposition)', () => {
    const lignes = vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00');
    const f = suivre(lignes, [pieceVente({ destinataireSiren: '552100555', destinataireNom: 'INCONNU SAS' })]).factures[0]!;
    expect(f.tiersPiece).toMatchObject({ cle: 'nom:INCONNU', siren: null });
    expect(f.comptabilisation.statut).toBe('a_confirmer');
  });
  it('incohérences : émetteur lu ≠ dossier, destinataire = dossier, dossier des deux côtés → client non identifié, réserve affichée', () => {
    const lignes = vente('CMARTIN', `Martin SA ${SIREN_MARTIN}`, 'FV-2025-010', '2025-02-01', '600.00');
    const autreEmetteur = suivre(lignes, [pieceVente({ emetteurSiren: SIREN_DUPONT })]).factures[0]!;
    expect(autreEmetteur).toMatchObject({ tiersPiece: null, sensLu: 'indetermine' });
    expect(autreEmetteur.motifTiers).toMatch(/n’est pas le dossier/);
    expect(autreEmetteur.comptabilisation.statut).toBe('a_confirmer');
    const achatMalQualifie = suivre(lignes, [pieceVente({ emetteurSiren: SIREN_DUPONT, destinataireSiren: SIREN_DOSSIER })]).factures[0]!;
    expect(achatMalQualifie).toMatchObject({ tiersPiece: null, sensLu: 'achat' });
    expect(achatMalQualifie.reserves.join(' ')).toMatch(/qualifiée « facture de vente » mais ses identifiants indiquent un achat/);
    const deuxCotes = suivre(lignes, [pieceVente({ destinataireSiren: SIREN_DOSSIER })]).factures[0]!;
    expect(deuxCotes.tiersPiece).toBeNull();
    expect(deuxCotes.motifTiers).toMatch(/à la fois comme émetteur et comme destinataire/);
  });
  it('avoir : sens déduit par le destinataire quand l’émetteur n’est pas lu ; contradiction → indéterminé', () => {
    const avoirRecu = suivre([], [piece({ nature: 'avoir', typeDocument: 'avoir', emetteurSiren: null, emetteurNom: 'DUPONT', destinataireSiren: SIREN_DOSSIER })]).factures[0]!;
    expect(avoirRecu).toMatchObject({ sens: 'achat', roleTiersPiece: 'emetteur' });
    const avoirEmis = suivre([], [piece({ nature: 'avoir', typeDocument: 'avoir', emetteurSiren: SIREN_DOSSIER, destinataireSiren: SIREN_MARTIN, destinataireNom: 'MARTIN SA' })]).factures[0]!;
    expect(avoirEmis).toMatchObject({ sens: 'vente', roleTiersPiece: 'destinataire', tiersPiece: { cle: `siren:${SIREN_MARTIN}` } });
    const contradictoire = suivre([], [piece({ nature: 'avoir', typeDocument: 'avoir', emetteurSiren: SIREN_DOSSIER, destinataireSiren: SIREN_DOSSIER })]).factures[0]!;
    expect(contradictoire).toMatchObject({ sens: 'indetermine', tiersPiece: null });
  });
  it('achat : le destinataire lu ne change rien au tiers (l’émetteur) ; tiers connu des seules pièces typé client pour une vente', () => {
    const a = suivre(achat('FDUPONT', 'Dupont Matériaux', 'FA-2025-0042', '2025-03-10', '1200.00'), [piece({ destinataireSiren: SIREN_DOSSIER, destinataireNom: 'DOSSIER SARL' })], { decisionsTiers: [LIEN_DUPONT] }).factures[0]!;
    expect(a).toMatchObject({ sens: 'achat', sensLu: 'achat', roleTiersPiece: 'emetteur', tiersPiece: { cle: `siren:${SIREN_DUPONT}` } });
    expect(a.comptabilisation.statut).toBe('apparie');
    const r = suivre([], [pieceVente()]);
    expect(r.tiers.find((t) => t.cle === `piece:siren:${SIREN_MARTIN}`)).toMatchObject({ origine: 'piece', type: 'client' });
    expect(r.reserves.join(' ')).toMatch(/destinataire y a été lu de façon sûre/);
  });
});
