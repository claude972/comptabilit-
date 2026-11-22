/**
 * Détail du compte de résultat (2052 France / exportations, 2053 exceptionnel, renvois ; 2033-B « dont export » et renvois) — D-106, D-107, pile réelle locale, cabinet NEUF.
 * La ventilation France / exportations n'est JAMAIS déduite : qualification par compte, tracée, refusée si la somme n'égale pas le
 * solde, « à revoir » si les données changent ; renvois saisis ou en abstention ; droits ; journal.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exN = '';

type Piece = [journal: string, num: string, date: string, lignes: Array<[compte: string, libelle: string, debit: string, credit: string]>];
const LIBELLES_JOURNAUX: Record<string, string> = { AN: 'A nouveaux', AC: 'Achats', OD: 'Operations diverses' };

/** FEC (tabulations, virgule décimale, 18 colonnes) à partir d'écritures équilibrées. */
function fec(pieces: Piece[]): Buffer {
  const lignes = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t');
  const sortie = [lignes];
  for (const [journal, num, date, ls] of pieces) {
    const d = date.replaceAll('-', '');
    for (const [compte, libelle, debit, credit] of ls) sortie.push([journal, LIBELLES_JOURNAUX[journal] ?? journal, num, d, compte, libelle, '', '', `P-${num}`, d, libelle, debit.replace('.', ','), credit.replace('.', ','), '', '', d, '', ''].join('\t'));
  }
  return Buffer.from(`${sortie.join('\r\n')}\r\n`, 'utf8');
}


const FEC_2026: Piece[] = [
  ['VT', 'VT2601', '2026-03-01', [['411000', 'Clients', '12000.00', '0.00'], ['707100', 'Ventes de marchandises France', '0.00', '5000.00'], ['707200', 'Ventes de marchandises export', '0.00', '1000.00'], ['701100', 'Ventes de produits finis', '0.00', '4000.00'], ['706000', 'Prestations de services', '0.00', '2000.00']]],
  ['VT', 'VT2602', '2026-03-02', [['709700', 'RRR accordes sur marchandises', '200.00', '0.00'], ['411000', 'Clients', '0.00', '200.00']]],
  ['OD', 'OD2606', '2026-06-30', [['671200', 'Penalites', '300.00', '0.00'], ['675000', 'VNC elements cedes', '1500.00', '0.00'], ['512000', 'Banque', '0.00', '1800.00']]],
  ['OD', 'OD2607', '2026-06-30', [['775000', 'Produits des cessions', '0.00', '800.00'], ['512000', 'Banque', '800.00', '0.00']]],
  ['AC', 'AC2601', '2026-07-01', [['612200', 'Credit-bail mobilier', '2400.00', '0.00'], ['671300', 'Dons et liberalites', '150.00', '0.00'], ['512000', 'Banque', '0.00', '2550.00']]],
];

async function importer(d: string, ex: string, pieces: Piece[], fin: string) {
  const nom = genererFecSynthetique({ exercice: { debut: `${fin.slice(0, 4)}-01-01`, fin }, nbEcritures: 10, graine: 1 }).nomFichier;
  const depot = await deposer('remi', d, fec(pieces), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, nom);
  expect(depot.fin.statut, JSON.stringify(depot.fin.json)).toBeLessThan(300);
  await attendreLot('remi', depot.fin.json.lotImportId);
}
const liasse = (ex: string, regime = 'reel_normal', qui = 'remi') => api(qui, 'GET', `/v1/exercices/${ex}/liasse?regime=${regime}`);
const detail = async () => (await liasse(exN)).json.detailResultat;
const ligneCA = (d: any, id: string) => d.ventilationChiffreAffaires.lignes.find((l: any) => l.id === id);
const qualifier = (compte: string, france: string, exportation: string, note = 'Ventilation d’après le fichier des ventes', qui = 'remi') =>
  api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/ventilation/${compte}`, { montantFrance: france, montantExport: exportation, note });
const renvoi = (code: string, montant: string, note = 'Relevé des loyers de crédit-bail', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/renvois/${code}`, { montant, note });

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai détail résultat ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '25 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Société d’essai détail résultat ${SEL} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  exN = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-30' })).json.id;
  await importer(dossier, exN, FEC_2026, '2026-12-30');
}, 180_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('2033-B (régime simplifié) : « dont export » et renvois, mêmes qualifications que le régime normal (D-107)', () => {
  const rsi = async () => (await liasse(exN, 'reel_simplifie')).json.detailResultat;

  it('totaux de la balance avec leurs cases, « dont export » en abstention tant que les comptes ne sont pas qualifiés, aucun net ni détail exceptionnel', async () => {
    const d = await rsi();
    expect(d).toMatchObject({ statut: 'projet', complet: false, regime: 'reel_simplifie', detailExceptionnel: null });
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet).toBeNull();
    expect(ligneCA(d, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: '210', etatCodeCase: 'lu_verifie' });
    expect(ligneCA(d, 'BIENS').total).toMatchObject({ montant: '4000.00', codeCase: '214' });
    expect(ligneCA(d, 'SERVICES').total).toMatchObject({ montant: '2000.00', codeCase: '218' });
    expect(ligneCA(d, 'BIENS').export).toMatchObject({ statut: 'abstention', codeCase: '215' });
    expect(d.renvois.map((r: any) => r.code)).toEqual(['CB_MOB', 'CB_IMM', '243', '255', '259', '260', '347', '348']);
    expect(d.renvois.find((r: any) => r.code === 'CB_MOB')).toMatchObject({ codeCase: null, proposition: { montant: '2400.00' } });
  }, 120_000);

  it('la qualification d’un compte vaut pour les deux régimes ; un renvoi du 2033-B se saisit, se trace et se retire', async () => {
    expect((await qualifier('701100', '3000.00', '1000.00')).statut).toBeLessThan(300);
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/qualifications/renvois/255`, { montant: '1200.00', note: 'Amortissement du fonds acquis en 2023' })).statut).toBeLessThan(300);
    let d = await rsi();
    expect(ligneCA(d, 'BIENS').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: '215' });
    expect(d.renvois.find((r: any) => r.code === '255')).toMatchObject({ statut: 'saisi', montant: '1200.00', codeCase: '255', saisie: { qualifieePar: DEMO.remi } });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/255`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/ventilation/701100`)).statut).toBeLessThan(300);
    d = await rsi();
    expect(d.renvois.find((r: any) => r.code === '255')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect(ligneCA(d, 'BIENS').export.statut).toBe('abstention');
  }, 120_000);
});

describe('2033-B partie B « Résultat fiscal » : saisie justifiée, néant explicite, historique en ajout seul, abstention (D-110)', () => {
  const rsi = async () => (await liasse(exN, 'reel_simplifie')).json.detailResultat;
  const rf = (cle: string, montant: string, note = 'Saisie du cabinet pour l’essai', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/renvois/RF_${cle}`, { montant, note });
  const evenements = async (cle: string) => (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=RF_${cle}`)).json.evenements as any[];

  it('sans saisie : résultat comptable reporté (312), résultat fiscal en abstention listant les sept cases manquantes, rien n’est présumé nul', async () => {
    const d = await rsi();
    expect(d.resultatFiscal.resultatComptable).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '8250.00', codeCase: '312' });
    expect(d.resultatFiscal.avantImputation.statut).toBe('abstention');
    expect(JSON.stringify(d.resultatFiscal.avantImputation)).toMatch(/316, 318, 322, 324, 330, 342, 350/);
    expect(d.resultatFiscal.apresImputation.statut).toBe('abstention');
    expect(d.resultatFiscal.lignes.map((l: any) => l.statut)).toEqual(Array(9).fill('a_saisir'));
    expect((await liasse(exN, 'reel_normal')).json.detailResultat.resultatFiscal).toBeNull();
  }, 120_000);

  it('refus : note trop courte, montant négatif, montant mal formé, clé inconnue ; droits (collaboration : refus, déposant : 404)', async () => {
    expect((await rf('316', '10.00', 'ok')).statut).toBe(400);
    expect((await rf('316', '-10.00')).statut).toBe(400);
    expect((await rf('316', '10,00')).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/qualifications/renvois/RF_999`, { montant: '1.00', note: 'clé inconnue ici' })).statut).toBe(404);
    expect((await rf('316', '10.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await rf('316', '10.00', 'Essai déposant', 'client')).statut).toBe(404);
    expect((await rsi()).resultatFiscal.lignes.every((l: any) => l.statut === 'a_saisir')).toBe(true);
  });

  it('néant explicite + réintégrations et déductions saisies : bénéfice fiscal (352) puis imputation (370), trace complète', async () => {
    for (const c of ['318', '322', '330', '350']) expect((await rf(c, '0.00', 'Néant : aucune opération de cette nature')).statut, c).toBeLessThan(300);
    expect((await rf('316', '1000.00', 'Rémunération de l’exploitant non déductible (essai)')).statut).toBeLessThan(300);
    expect((await rf('324', '250.00', 'Amendes et pénalités du compte 6712')).statut).toBeLessThan(300);
    let d = await rsi();
    expect(d.resultatFiscal.avantImputation.statut).toBe('abstention'); // 342 non renseignée
    expect(JSON.stringify(d.resultatFiscal.avantImputation)).toMatch(/342/);
    expect((await rf('342', '500.00', 'Déduction de zone (essai)')).statut).toBeLessThan(300);
    d = await rsi();
    // 8 250 + (1 000 + 250) − (500 + 0) = 9 000
    expect(d.resultatFiscal.avantImputation).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '9000.00', codeCase: '352' });
    expect(d.resultatFiscal.plafondImputation.montant).toBe('9000.00');
    expect(d.resultatFiscal.apresImputation.statut).toBe('abstention'); // 356 et 360 non saisies
    const l318 = d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_318');
    expect(l318).toMatchObject({ statut: 'saisi', neant: true, montant: '0.00', saisie: { qualifieePar: DEMO.remi } });
    expect(d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_356')).toMatchObject({ statut: 'a_saisir', neant: false });
    expect((await rf('356', '0.00', 'Aucun report en arrière')).statut).toBeLessThan(300);
    expect((await rf('360', '2000.00', 'Déficits antérieurs imputés (essai)')).statut).toBeLessThan(300);
    d = await rsi();
    expect(d.resultatFiscal.apresImputation).toMatchObject({ statut: 'etabli', sens: 'benefice', montant: '7000.00', codeCase: '370' });
    expect(d.resultatFiscal.controles.find((c: any) => c.code === 'RF_IMPUTATION').statut).toBe('coherent');
  }, 120_000);

  it('imputation au-delà du plafond : abstention avec l’écart ; un déficit reporté en arrière : abstention ; jamais de chiffre inventé', async () => {
    expect((await rf('360', '9000.01', 'Imputation excessive (essai)')).statut).toBeLessThan(300);
    let d = await rsi();
    expect(d.resultatFiscal.apresImputation.statut).toBe('abstention');
    expect(d.resultatFiscal.controles.find((c: any) => c.code === 'RF_IMPUTATION')).toMatchObject({ statut: 'ecart', ecart: '0.01' });
    expect((await rf('360', '0.00', 'Aucun déficit imputé')).statut).toBeLessThan(300);
    expect((await rf('356', '100.00', 'Option de report en arrière (essai)')).statut).toBeLessThan(300);
    d = await rsi();
    expect(d.resultatFiscal.apresImputation.statut).toBe('abstention');
    expect(JSON.stringify(d.resultatFiscal.apresImputation)).toMatch(/report(é)? en arrière/);
    expect(d.resultatFiscal.avantImputation.statut).toBe('etabli'); // le résultat avant imputation reste établi
    expect((await rf('356', '0.00', 'Option abandonnée')).statut).toBeLessThan(300);
  }, 120_000);

  it('détail des totaux 330 / 342 / 350 : saisies justifiées indépendantes du total, contrôle indicatif, 248 seule négative acceptée', async () => {
    expect((await rf('247', '-1.00')).statut).toBe(400); // une réintégration négative est refusée
    expect((await rf('248', '-50.00', 'Écart net négatif sur OPC (essai)')).statut).toBeLessThan(300); // la notice la porte entre parenthèses
    expect((await rf('247', '200.00', 'Intérêts excédentaires du compte courant de l’associé (essai)')).statut).toBeLessThan(300);
    expect((await rf('251', '150.00', 'Fraction des loyers à réintégrer (essai)')).statut).toBeLessThan(300);
    expect((await rf('249', '999.00', 'Part dispensée, non additionnée (essai)')).statut).toBeLessThan(300);
    expect((await rf('330', '300.00', 'Total de la ligne Divers établi par le cabinet (essai)')).statut).toBeLessThan(300);
    let d = await rsi();
    const l330 = d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_330');
    expect(l330.detail.map((x: any) => [x.codeCase, x.statut, x.montant])).toEqual([['247', 'saisi', '200.00'], ['248', 'saisi', '-50.00'], ['251', 'saisi', '150.00'], ['249', 'saisi', '999.00']]);
    expect(l330.controleDetail).toMatchObject({ statut: 'coherent' }); // 200 − 50 + 150 = 300 ; 249 non additionnée
    // Le résultat fiscal repose sur le TOTAL saisi (jamais sur le détail) : 8 250 + 1 000 + 250 + 300 − 0 = 9 800 (342 retiré à l'essai précédent).
    expect((await rf('342', '500.00', 'Déduction de zone rétablie (essai)')).statut).toBeLessThan(300);
    d = await rsi();
    expect(d.resultatFiscal.avantImputation).toMatchObject({ statut: 'etabli', montant: '9300.00', codeCase: '352' }); // 8 250 + 1 550 − 500
    expect((await rf('330', '400.00', 'Total modifié, détail inchangé (essai)')).statut).toBeLessThan(300);
    d = await rsi();
    const l2 = d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_330');
    expect(l2.controleDetail).toMatchObject({ statut: 'ecart', ecart: '100.00' });
    expect(l2.montant).toBe('400.00'); // total inchangé par le contrôle
    expect(d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_342').controleDetail.statut).toBe('non_verifie'); // détail 342 vide
    expect((await evenements('248')).map((e) => [e.action, e.montant])).toEqual([['saisie', '-50.00']]);
  }, 120_000);

  it('historique en ajout seul : chaque saisie, avec montant, note, auteur et version ; un retrait est journalisé ; rien n’est modifié', async () => {
    const h = await evenements('360');
    expect(h.map((e) => [e.action, e.montant])).toEqual([['saisie', '0.00'], ['saisie', '9000.01'], ['saisie', '2000.00']]); // plus récent d'abord
    expect(h[2]).toMatchObject({ nature: 'renvoi', cle: 'RF_360', note: 'Déficits antérieurs imputés (essai)', auteurId: DEMO.remi, versionDonnees: expect.any(Number) });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/RF_342`)).statut).toBeLessThan(300);
    const h342 = await evenements('342');
    expect(h342.map((e) => e.action)).toEqual(['retrait', 'saisie', 'saisie']); // saisie initiale, nouvelle saisie du test du détail, retrait
    expect(h342[0]).toMatchObject({ montant: null, note: null });
    const d = await rsi();
    expect(d.resultatFiscal.lignes.find((l: any) => l.cle === 'RF_342')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect(d.resultatFiscal.avantImputation.statut).toBe('abstention');
    // La base refuse toute modification ou suppression de l'historique par le rôle applicatif.
    const refus = await editeur.query(`select has_table_privilege('comtaple_app', 'historique_qualifications', 'UPDATE') as maj, has_table_privilege('comtaple_app', 'historique_qualifications', 'DELETE') as sup, has_table_privilege('comtaple_worker', 'historique_qualifications', 'INSERT') as ins_worker`);
    expect(refus.rows[0]).toEqual({ maj: false, sup: false, ins_worker: false });
    expect((await api('chloe', 'GET', `/v1/exercices/${exN}/qualifications/historique`)).statut).toBe(200);
    expect((await api('client', 'GET', `/v1/exercices/${exN}/qualifications/historique`)).statut).toBe(404);
  }, 120_000);
});

describe('cadre III du 2033-C et 2054 bis : saisies ligne par ligne, tracées, historisées, abstention sans saisie (D-112)', () => {
  const tableaux = async (regime: 'reel_simplifie' | 'reel_normal') => (await liasse(exN, regime)).json.tableauxSaisis;
  const lig = (tableau: string, ligne: string, valeurs: Record<string, string>, note = 'Saisie du cabinet pour l’essai', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/tableaux/${tableau}/${ligne}`, { valeurs, note });
  const CESSION = { nature: 'Machine de découpe (essai)', valeurActif: '3000.00', amortissements: '1500.00', prixCession: '800.00', classement: 'court_terme' };

  it('cadre III sans saisie : totaux en abstention, cessions de la balance signalées ; le 2054 bis n’existe pas au régime simplifié', async () => {
    const t = await tableaux('reel_simplifie');
    expect(t).toMatchObject({ statut: 'projet', ecartsReevaluation: null });
    expect(t.cadreIII.etat).toBe('a_saisir');
    expect(t.cadreIII.totaux.prixCession).toMatchObject({ statut: 'abstention', codeCase: '584' });
    expect(t.cadreIII.controles.find((c: any) => c.code === 'III_CESSIONS_A_DETAILLER').statut).toBe('non_verifie');
    expect((await tableaux('reel_normal')).cadreIII).toBeNull();
  }, 120_000);

  it('refus : forme (montant, champ, classement, ligne), note, droits', async () => {
    expect((await lig('2033C_III', '01', { ...CESSION, prixCession: '800,00' })).statut).toBe(400);
    expect((await lig('2033C_III', '01', { ...CESSION, classement: 'inconnu' })).statut).toBe(400);
    expect((await lig('2033C_III', '01', { ...CESSION, valeurActif: '-3.00' })).statut).toBe(400);
    expect((await lig('2033C_III', '01', CESSION, 'ok')).statut).toBe(400);
    expect((await lig('2033C_III', '11', CESSION)).statut).toBe(400); // ligne bien formée mais inconnue de ce tableau
    expect((await lig('2033C_III', '14', CESSION)).statut).toBe(404); // identifiant de ligne mal formé
    expect((await lig('autre', '01', CESSION)).statut).toBe(404);
    expect((await lig('2033C_III', '01', CESSION, 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await lig('2033C_III', '01', CESSION, 'Essai déposant', 'client')).statut).toBe(404);
    expect((await tableaux('reel_simplifie')).cadreIII.etat).toBe('a_saisir');
  });

  it('cadre III : cession saisie, valeur résiduelle et moins-value calculées, totaux avec régularisations, contrôles avec la balance, trace', async () => {
    expect((await lig('2033C_III', '01', CESSION, 'Cession de la machine au registre des immobilisations')).statut).toBeLessThan(300);
    let c = (await tableaux('reel_simplifie')).cadreIII;
    expect(c.etat).toBe('saisi');
    expect(c.lignes[0]).toMatchObject({ statut: 'saisi', valeurResiduelle: '1500.00', plusOuMoinsValue: '-700.00', colonnePlusValue: 'c5', trace: { qualifieePar: DEMO.remi, note: 'Cession de la machine au registre des immobilisations' } });
    expect(c.totaux.c5).toMatchObject({ statut: 'etabli', montant: '-700.00', codeCase: '586' });
    expect(c.totalGeneral.c5.statut).toBe('abstention'); // régularisations non saisies
    expect(c.controles.find((x: any) => x.code === 'III_PRIX_775').statut).toBe('coherent'); // 800 au compte 775
    expect(c.controles.find((x: any) => x.code === 'III_VNC_675').statut).toBe('coherent'); // 1 500 au compte 675
    expect((await lig('2033C_III', 'REG', { c5: '100.00', c6: '0.00', c7: '0.00', c8: '0.00' }, 'Amortissements irrégulièrement différés (essai)')).statut).toBeLessThan(300);
    expect((await lig('2033C_III', 'PV19', { montant: '0.00' }, 'Aucune plus-value à 19 % (essai)')).statut).toBeLessThan(300);
    c = (await tableaux('reel_simplifie')).cadreIII;
    expect(c.totalGeneral.c5).toMatchObject({ statut: 'etabli', montant: '-600.00', codeCase: '596' });
    expect(c.plusValues19).toMatchObject({ statut: 'saisi', montant: '0.00', codeCase: '579' });
  }, 120_000);

  it('2054 bis (régime normal) : abstention, lignes saisies, écart et colonne 6 calculés, ligne 10, cadre B, néant', async () => {
    let t = (await tableaux('reel_normal')).ecartsReevaluation;
    expect(t.etat).toBe('a_saisir');
    expect(t.totaux.c6.statut).toBe('abstention');
    expect((await lig('2054BIS_A', '03', { c1: '5000.00', c2: '0.00', c3: '100.00', c4: '50.00', c5: '1200.00' }, 'Réévaluation légale des terrains (essai)')).statut).toBeLessThan(300);
    expect((await lig('2054BIS_A', '04', { c1: '8000.00', c2: '3000.00', c3: '200.00', c4: '0.00', c5: '2000.00' }, 'Réévaluation légale des constructions (essai)')).statut).toBeLessThan(300);
    expect((await lig('2054BIS_B', 'B1', { montant: '900.00' }, 'Fraction incluse au début (essai)')).statut).toBeLessThan(300);
    expect((await lig('2054BIS_B', 'B2', { montant: '250.50' }, 'Fraction rattachée au résultat (essai)')).statut).toBeLessThan(300);
    t = (await tableaux('reel_normal')).ecartsReevaluation;
    expect(t.lignes[2]).toMatchObject({ libelle: 'Terrains', statut: 'saisi', ecart: '5000.00', c6: '3800.00' });
    expect(t.totaux.c1).toMatchObject({ statut: 'etabli', montant: '13000.00' });
    expect(t.totaux.c6).toMatchObject({ statut: 'etabli', montant: '6800.00' });
    expect(t.cadreB.b3).toMatchObject({ statut: 'etabli', montant: '649.50' });
    expect((await lig('2054BIS_A', 'NEANT', {}, 'Tableau déclaré néant (essai)')).statut).toBeLessThan(300);
    expect((await tableaux('reel_normal')).ecartsReevaluation.controles.some((x: any) => x.code === 'BIS_NEANT_ET_LIGNES')).toBe(true);
  }, 120_000);

  it('historique en ajout seul des saisies de tableaux ; retrait journalisé ; la ligne retirée redevient « à saisir »', async () => {
    const h = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=2033C_III:01`)).json.evenements as any[];
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ nature: 'tableau', cle: '2033C_III:01', action: 'saisie', auteurId: DEMO.remi, note: 'Cession de la machine au registre des immobilisations' });
    expect(JSON.parse(h[0].montant)).toMatchObject({ nature: 'Machine de découpe (essai)', prixCession: '800.00' });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033C_III/01`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033C_III/01`)).statut).toBe(404);
    const h2 = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=2033C_III:01`)).json.evenements as any[];
    expect(h2.map((e) => e.action)).toEqual(['retrait', 'saisie']);
    const c = (await tableaux('reel_simplifie')).cadreIII;
    expect(c.lignes[0].statut).toBe('a_saisir');
    expect(c.etat).toBe('a_saisir');
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2054BIS_A/NEANT`)).statut).toBeLessThan(300);
  }, 120_000);
});

describe('2055 cadres B (amortissements dérogatoires) et C (charges réparties) : saisies ligne par ligne, historisées, abstention sans saisie (D-113)', () => {
  const t55 = async () => (await liasse(exN, 'reel_normal')).json.tableauxSaisis;
  const lig = (tableau: string, ligne: string, valeurs: Record<string, string>, note = 'Saisie du cabinet pour l’essai', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/tableaux/${tableau}/${ligne}`, { valeurs, note });
  const montant = (c: any) => (c && c.statut === 'etabli' ? c.montant : c?.statut ?? null);

  it('sans saisie : cadre B et cadre C en abstention, sans chiffre ; absents au régime simplifié', async () => {
    const t = await t55();
    expect(t.amortissementsDerogatoires.etat).toBe('a_saisir');
    expect(t.amortissementsDerogatoires.lignes).toHaveLength(13);
    expect(montant(t.amortissementsDerogatoires.totaux.general[0])).toBe('abstention');
    expect(t.amortissementsDerogatoires.nonVentile.NZ.statut).toBe('abstention');
    expect(t.chargesRepartiesPlusieursExercices.lignes.map((l: any) => l.fin)).toEqual([null, null]);
    const rsi = (await liasse(exN, 'reel_simplifie')).json.tableauxSaisis;
    expect(rsi.amortissementsDerogatoires).toBeNull();
    expect(rsi.chargesRepartiesPlusieursExercices).toBeNull();
  }, 120_000);

  it('refus : forme (colonne manquante, négatif, ligne 13 avec colonne 2, ligne 14), droits', async () => {
    expect((await lig('2055_B', '01', { c1: '1.00' })).statut).toBe(400);
    expect((await lig('2055_B', '01', { c1: '-1.00', c2: '0', c3: '0.00', c4: '0.00', c5: '0.00', c6: '0.00' })).statut).toBe(400);
    expect((await lig('2055_B', '13', { c1: '1.00', c4: '0.00', c2: '1.00' })).statut).toBe(400);
    expect((await lig('2055_B', '14', { c1: '1.00' })).statut).toBe(404);
    expect((await lig('2055_C', '03', { debut: '1.00', augmentations: '0.00', dotations: '0.00' })).statut).toBe(400);
    expect((await lig('2055_C', '01', { debut: '1.00', augmentations: '0.00', dotations: '0.00' }, 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await lig('2055_C', '01', { debut: '1.00', augmentations: '0.00', dotations: '0.00' }, 'Essai déposant', 'client')).statut).toBe(404);
    expect((await t55()).amortissementsDerogatoires.etat).toBe('a_saisir');
  });

  it('cadre B : colonne 7 et totaux calculés comme le formulaire ; cases lues ; trace ; contrôles avec la balance', async () => {
    expect((await lig('2055_B', '01', { c1: '100.00', c2: '0.00', c3: '0.00', c4: '20.00', c5: '0.00', c6: '0.00' }, 'Dérogatoire sur frais d’établissement (essai)')).statut).toBeLessThan(300);
    expect((await lig('2055_B', '04', { c1: '50.00', c2: '30.00', c3: '10.00', c4: '5.00', c5: '5.00', c6: '5.00' }, 'Dérogatoire sur terrains (essai)')).statut).toBeLessThan(300);
    expect((await lig('2055_B', '13', { c1: '40.00', c4: '15.00' }, 'Frais d’acquisition de titres (essai)')).statut).toBeLessThan(300);
    const b = (await t55()).amortissementsDerogatoires;
    expect(b.etat).toBe('saisi');
    expect(b.lignes[0].colonnes[6]).toEqual({ codeCase: 'N6', montant: '80.00' });
    expect(b.lignes[0]).toMatchObject({ statut: 'saisi', trace: { qualifieePar: DEMO.remi, note: 'Dérogatoire sur frais d’établissement (essai)' } });
    expect(montant(b.totaux.I[6])).toBe('80.00');
    expect(montant(b.totaux.general[0])).toBe('190.00');
    expect(b.nonVentile.NZ).toMatchObject({ statut: 'etabli', montant: '180.00', codeCase: 'NZ' });
    expect(b.controles.find((c: any) => c.code === 'B2055_DOTATIONS_6872').statut).toBe('ecart'); // la balance d'essai n'a pas de compte 6872
    expect((await lig('2055_B', 'NEANT', {}, 'Cadre B déclaré néant (essai)')).statut).toBeLessThan(300);
    expect((await t55()).amortissementsDerogatoires.controles.some((c: any) => c.code === 'B2055_NEANT_ET_LIGNES')).toBe(true);
  }, 120_000);

  it('cadre C : colonne 4 = 1 + 2 − 3 ; cases Z9 / Z8 et SP / SR ; néant', async () => {
    expect((await lig('2055_C', '01', { debut: '1000.00', augmentations: '500.00', dotations: '300.00' }, 'Frais d’émission de l’emprunt bancaire (essai)')).statut).toBeLessThan(300);
    expect((await lig('2055_C', '02', { debut: '0.00', augmentations: '0.00', dotations: '0.00' }, 'Aucune prime de remboursement (essai)')).statut).toBeLessThan(300);
    const c = (await t55()).chargesRepartiesPlusieursExercices;
    expect(c.etat).toBe('saisi');
    expect(c.lignes[0]).toMatchObject({ statut: 'saisi', fin: '1200.00', caseDotations: 'Z9', caseFin: 'Z8' });
    expect(c.lignes[1]).toMatchObject({ fin: '0.00', caseDotations: 'SP', caseFin: 'SR' });
  }, 120_000);

  it('historique en ajout seul ; retraits ; les lignes redeviennent « à saisir »', async () => {
    const h = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=2055_C:01`)).json.evenements as any[];
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ nature: 'tableau', cle: '2055_C:01', action: 'saisie', auteurId: DEMO.remi });
    expect(JSON.parse(h[0].montant)).toEqual({ debut: '1000.00', augmentations: '500.00', dotations: '300.00' });
    for (const [t, l] of [['2055_B', '01'], ['2055_B', '04'], ['2055_B', '13'], ['2055_B', 'NEANT'], ['2055_C', '01'], ['2055_C', '02']] as const) expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/${t}/${l}`)).statut, `${t} ${l}`).toBeLessThan(300);
    const t = await t55();
    expect(t.amortissementsDerogatoires.etat).toBe('a_saisir');
    expect(t.chargesRepartiesPlusieursExercices.etat).toBe('a_saisir');
    const h2 = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=2055_C:01`)).json.evenements as any[];
    expect(h2.map((e) => e.action)).toEqual(['retrait', 'saisie']);
  }, 120_000);
});

describe('2033-D (régime simplifié) : cases saisies, néant, abstention, calculs de la notice, contrôles indicatifs (D-114)', () => {
  const f2033d = async () => (await liasse(exN, 'reel_simplifie')).json.formulaire2033D;
  const cas = (f: any, code: string) => f.cases.find((c: any) => c.codeCase === code);
  const dd = (cle: string, montant: string, note = 'Saisie du cabinet pour l’essai', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/renvois/D_${cle}`, { montant, note });
  const lc = (ligne: string, valeurs: Record<string, string>, note = 'Dotation non déductible (essai)') => api('remi', 'PUT', `/v1/exercices/${exN}/tableaux/2033D_C/${ligne}`, { valeurs, note });

  it('sans saisie : 68 cases à saisir, 870 et 780 en abstention sans chiffre ; absent au régime normal', async () => {
    const f = await f2033d();
    expect(f.statut).toBe('projet');
    expect(f.cases).toHaveLength(68);
    expect(f.cases.every((c: any) => c.statut === 'a_saisir' && c.montant === null && c.etatCodeCase === 'lu_verifie')).toBe(true);
    expect(f.total870).toMatchObject({ statut: 'abstention', codeCase: '870' });
    expect(f.cadreC.total780).toMatchObject({ statut: 'abstention', codeCase: '780' });
    expect((await liasse(exN, 'reel_normal')).json.formulaire2033D).toBeNull();
    // 983 est proposée à partir de la case 360 du 2033-B quand elle est saisie (cas ici : néant), jamais retenue.
    expect(cas(f, '983')).toMatchObject({ statut: 'a_saisir', montant: null });
  }, 120_000);

  it('refus : note, négatif, entier pour 982 ter, droits', async () => {
    expect((await dd('600', '10.00', 'ok')).statut).toBe(400);
    expect((await dd('600', '-10.00')).statut).toBe(400);
    expect((await dd('982T', '2.5')).statut).toBe(400);
    expect((await dd('600', '10.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await dd('600', '10.00', 'Essai déposant', 'client')).statut).toBe(404);
    expect((await dd('999', '10.00')).statut).toBe(404);
    expect((await f2033d()).cases.every((c: any) => c.statut === 'a_saisir')).toBe(true);
  });

  it('cadre I : saisies, néant, contrôles indicatifs (fin = début + augmentations − diminutions) ; 870 = 984 + 860 ; trace et historique', async () => {
    for (const [c, m] of [['600', '100.00'], ['602', '50.00'], ['604', '20.00'], ['606', '130.00'], ['610', '0.00']] as const) expect((await dd(c, m, c === '610' ? 'Néant : aucune autre provision réglementée' : 'Amortissements dérogatoires (essai)')).statut, c).toBeLessThan(300);
    let f = await f2033d();
    expect(cas(f, '610')).toMatchObject({ statut: 'saisi', neant: true });
    expect(cas(f, '600')).toMatchObject({ statut: 'saisi', montant: '100.00', saisie: { qualifieePar: DEMO.remi } });
    expect(f.controles.find((c: any) => c.code === 'D_FIN_AD').statut).toBe('coherent');
    expect((await dd('606', '999.00', 'Fin erronée (essai)')).statut).toBeLessThan(300);
    f = await f2033d();
    expect(f.controles.find((c: any) => c.code === 'D_FIN_AD')).toMatchObject({ statut: 'ecart', ecart: '869.00' });
    expect(cas(f, '606').montant).toBe('999.00'); // jamais corrigé
    expect((await dd('984', '1000.00', 'Déficits reportables (essai)')).statut).toBeLessThan(300);
    expect((await f2033d()).total870.statut).toBe('abstention');
    expect((await dd('860', '250.50', 'Déficit de l’exercice (essai)')).statut).toBeLessThan(300);
    expect((await f2033d()).total870).toMatchObject({ statut: 'etabli', montant: '1250.50', codeCase: '870' });
    const h = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=D_606`)).json.evenements as any[];
    expect(h.map((e) => e.montant)).toEqual(['999.00', '130.00']);
  }, 120_000);

  it('cadre C : sept lignes par saisie de tableau, total 780 calculé, néant, historique', async () => {
    expect((await lc('01', { nature: 'Indemnités de congés à payer', montant: '200.00' })).statut).toBeLessThan(300);
    expect((await lc('02', { nature: 'Charges à payer non déductibles', montant: '100.50' })).statut).toBeLessThan(300);
    expect((await lc('08', { nature: 'Congés', montant: '1.00' })).statut).toBe(400); // la ligne 08 n'existe pas au cadre C (sept lignes)
    expect((await lc('03', { nature: 'x', montant: '-1.00' })).statut).toBe(400);
    let f = await f2033d();
    expect(f.cadreC.etat).toBe('saisi');
    expect(f.cadreC.total780).toMatchObject({ statut: 'etabli', montant: '300.50', codeCase: '780' });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033D_C/01`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033D_C/02`)).statut).toBeLessThan(300);
    expect((await f2033d()).cadreC.total780.statut).toBe('abstention');
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/tableaux/2033D_C/NEANT`, { valeurs: {}, note: 'Aucune dotation non déductible (essai)' })).statut).toBeLessThan(300);
    f = await f2033d();
    expect(f.cadreC).toMatchObject({ etat: 'neant', total780: { statut: 'etabli', montant: '0.00' } });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033D_C/NEANT`)).statut).toBeLessThan(300);
  }, 120_000);

  it('propositions 983 et 860 reprises de la partie B du 2033-B, jamais retenues sans saisie ; contrôle une fois saisies', async () => {
    const d = (await liasse(exN, 'reel_simplifie')).json.detailResultat.resultatFiscal;
    const l360 = d.lignes.find((l: any) => l.cle === 'RF_360');
    let f = await f2033d();
    if (l360.statut === 'saisi') expect(cas(f, '983')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: l360.montant } });
    expect((await dd('983', '1.00', 'Déficits imputés différents du 2033-B (essai)')).statut).toBeLessThan(300);
    f = await f2033d();
    expect(cas(f, '983')).toMatchObject({ statut: 'saisi', proposition: null });
    if (l360.statut === 'saisi') expect(f.controles.find((c: any) => c.code === 'D_983_2033B')).toMatchObject({ statut: 'ecart' });
  }, 120_000);
});

describe('2033-E (régime simplifié) : effectifs et valeur ajoutée, totaux calculés seulement quand tout est saisi (D-115)', () => {
  const f2033e = async () => (await liasse(exN, 'reel_simplifie')).json.formulaire2033E;
  const ee = (code: string, montant: string, note = 'Saisie du cabinet pour l’essai', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/qualifications/renvois/E_${code}`, { montant, note });
  const T1 = ['108', '118', '119'], T2 = ['115', '143', '113', '111', '153'], T3 = ['121', '145', '125', '310', '133', '148', '128', '135', '150'];

  it('sans saisie : 25 cases à saisir, totaux et valeur ajoutée en abstention sans chiffre ; absent au régime normal', async () => {
    const f = await f2033e();
    expect(f.statut).toBe('projet');
    expect(f.cases).toHaveLength(25);
    expect(f.cases.every((c: any) => c.statut === 'a_saisir' && c.montant === null)).toBe(true);
    for (const t of [f.total1, f.total2, f.total3, f.valeurAjoutee137, f.valeurAjoutee117]) expect(t.statut).toBe('abstention');
    expect(f.exercice.dureeMois).toBe(12);
    expect((await liasse(exN, 'reel_normal')).json.formulaire2033E).toBeNull();
  }, 120_000);

  it('refus : négatif, case 020 hors 0 / 1, note, droits', async () => {
    expect((await ee('108', '-1.00')).statut).toBe(400);
    expect((await ee('020', '2.00')).statut).toBe(400);
    expect((await ee('108', '1.00', 'ok')).statut).toBe(400);
    expect((await ee('108', '1.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await ee('108', '1.00', 'Essai déposant', 'client')).statut).toBe(404);
    expect((await f2033e()).cases.every((c: any) => c.statut === 'a_saisir')).toBe(true);
  });

  it('totaux 106, 144, 152, valeur ajoutée 137 et case 117 calculés seulement quand toutes les composantes sont saisies (néant compris)', async () => {
    for (const c of T1) expect((await ee(c, '1000.00', 'Produits retenus pour la CVAE (essai)')).statut, c).toBeLessThan(300);
    let f = await f2033e();
    expect(f.total1).toMatchObject({ statut: 'etabli', montant: '3000.00', codeCase: '106' });
    expect(f.total2.statut).toBe('abstention');
    expect(f.valeurAjoutee137.statut).toBe('abstention');
    for (const c of T2) expect((await ee(c, c === '153' ? '0.00' : '100.00', c === '153' ? 'Néant : aucune rentrée sur créance amortie' : 'Autres produits (essai)')).statut, c).toBeLessThan(300);
    for (const c of T3) expect((await ee(c, '200.00', 'Charges retenues pour la CVAE (essai)')).statut, c).toBeLessThan(300);
    f = await f2033e();
    expect(f.total2).toMatchObject({ montant: '400.00', codeCase: '144' });
    expect(f.total3).toMatchObject({ montant: '1800.00', codeCase: '152' });
    expect(f.valeurAjoutee137).toMatchObject({ statut: 'etabli', montant: '1600.00', codeCase: '137' });
    expect(f.valeurAjoutee117).toMatchObject({ statut: 'etabli', montant: '1600.00', codeCase: '117' });
    expect(f.cases.find((c: any) => c.codeCase === '153')).toMatchObject({ neant: true });
    expect(f.cases.find((c: any) => c.codeCase === '022')).toMatchObject({ statut: 'a_saisir', proposition: { montant: '3000.00' } });
  }, 120_000);

  it('valeur ajoutée négative : 137 négative, 117 reportée à 0 ; historique des saisies', async () => {
    expect((await ee('121', '9000.00', 'Achats en forte hausse (essai)')).statut).toBeLessThan(300);
    const f = await f2033e();
    expect(f.valeurAjoutee137).toMatchObject({ statut: 'etabli', montant: '-7200.00' });
    expect(f.valeurAjoutee117).toMatchObject({ statut: 'etabli', montant: '0.00' });
    const h = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=E_121`)).json.evenements as any[];
    expect(h.map((e) => e.montant)).toEqual(['9000.00', '200.00']);
  }, 120_000);
});

describe('2033-F (régime simplifié) : composition du capital par saisie ligne par ligne (D-116)', () => {
  const f2033f = async () => (await liasse(exN, 'reel_simplifie')).json.formulaire2033F;
  const tf = (tableau: string, ligne: string, valeurs: Record<string, string>, note = 'Registre des associés au 31 décembre (essai)', qui = 'remi') => api(qui, 'PUT', `/v1/exercices/${exN}/tableaux/${tableau}/${ligne}`, { valeurs, note });
  const PM = { formeJuridique: 'SAS', denomination: 'Holding Exemple (fictive)', siren: '123456789', adresseNumero: '12', adresseVoie: 'rue de l’Exemple', codePostal: '75000', commune: 'Paris', pays: 'France', pourcentage: '60.00', parts: '600.00' };
  const PP = { titre: 'MME', nomFamille: 'Durand (fictive)', nomUsage: '', prenoms: 'Alice', naissanceDate: '1980-05-17', naissanceDepartement: '75', naissanceCommune: 'Paris', naissancePays: 'France', adresseNumero: '3', adresseVoie: 'avenue du Test', codePostal: '69000', commune: 'Lyon', pays: 'France', pourcentage: '40.00', parts: '400.00' };

  it('sans saisie : 905 et 906 en abstention sans chiffre ; absent au régime normal', async () => {
    const f = await f2033f();
    expect(f).toMatchObject({ statut: 'projet', etat: 'a_saisir' });
    expect(f.nombres.total905).toMatchObject({ statut: 'abstention', codeCase: '905' });
    expect(f.personnesMorales).toHaveLength(4);
    expect(f.personnesPhysiques).toHaveLength(2);
    expect((await liasse(exN, 'reel_normal')).json.formulaire2033F).toBeNull();
  }, 120_000);

  it('refus de forme et de droits', async () => {
    expect((await tf('2033F_PM', '01', { ...PM, siren: '12' })).statut).toBe(400);
    expect((await tf('2033F_PM', '01', { ...PM, pourcentage: '101.00' })).statut).toBe(400);
    expect((await tf('2033F_PP', '01', { ...PP, titre: 'X' })).statut).toBe(400);
    expect((await tf('2033F_PM', '05', PM)).statut).toBe(400);
    expect((await tf('2033F_PM', '01', PM, 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await tf('2033F_PM', '01', PM, 'Essai déposant', 'client')).statut).toBe(404);
    expect((await f2033f()).etat).toBe('a_saisir');
  });

  it('nombres 901 à 904, une personne morale et une personne physique : 905 et 906 calculés, contrôles indicatifs, trace et historique', async () => {
    expect((await tf('2033F_NB', 'NB', { c901: '1', c902: '600.00', c903: '1', c904: '400.00' })).statut).toBeLessThan(300);
    expect((await tf('2033F_PM', '01', PM)).statut).toBeLessThan(300);
    expect((await tf('2033F_PP', '01', PP)).statut).toBeLessThan(300);
    let f = await f2033f();
    expect(f.etat).toBe('saisi');
    expect(f.nombres.total905).toMatchObject({ statut: 'etabli', montant: '2.00', codeCase: '905' });
    expect(f.nombres.total906).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: '906' });
    expect(f.personnesMorales[0]).toMatchObject({ statut: 'saisi', valeurs: { denomination: 'Holding Exemple (fictive)', siren: '123456789' }, trace: { qualifieePar: DEMO.remi } });
    expect(f.controles.find((c: any) => c.code === 'F_POURCENTAGES').statut).toBe('coherent');
    expect((await tf('2033F_PP', '02', { ...PP, nomFamille: 'Martin (fictif)', titre: 'M', pourcentage: '10.00', parts: '0.00' })).statut).toBeLessThan(300);
    f = await f2033f();
    expect(f.controles.find((c: any) => c.code === 'F_POURCENTAGES')).toMatchObject({ statut: 'ecart', ecart: '10.00' });
    const h = (await api('remi', 'GET', `/v1/exercices/${exN}/qualifications/historique?cle=2033F_PM:01`)).json.evenements as any[];
    expect(h).toHaveLength(1);
    expect(JSON.parse(h[0].montant)).toMatchObject({ denomination: 'Holding Exemple (fictive)' });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033F_PP/02`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033F_PM/01`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033F_PP/01`)).statut).toBeLessThan(300);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/tableaux/2033F_NB/NB`)).statut).toBeLessThan(300);
    expect((await f2033f()).etat).toBe('a_saisir');
  }, 120_000);
});

describe('détail du compte de résultat : qualification tracée, abstention sans qualification', () => {
  it('sans qualification : totaux de la balance, France et exportations en abstention, renvois à saisir, exceptionnel détaillé', async () => {
    const d = await detail();
    expect(d).toMatchObject({ statut: 'projet', complet: false, regime: 'reel_normal' });
    expect(d.mention).toMatch(/en attente de validation professionnelle/);
    expect(ligneCA(d, 'MARCHANDISES').total).toMatchObject({ statut: 'etabli', montant: '5800.00', codeCase: 'FC' });
    expect(ligneCA(d, 'BIENS').total.montant).toBe('4000.00');
    expect(ligneCA(d, 'SERVICES').total.montant).toBe('2000.00');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.total.montant).toBe('11800.00');
    for (const l of d.ventilationChiffreAffaires.lignes) {
      expect(l.france.statut).toBe('abstention');
      expect(JSON.stringify(l.france)).not.toMatch(/montant/);
    }
    expect(d.ventilationChiffreAffaires.nbComptesAQualifier).toBe(5);
    expect(d.detailExceptionnel).toMatchObject({ totalProduits: '800.00', totalCharges: '1950.00', resultatExceptionnel: '-1150.00' });
    expect(d.renvois.every((r: any) => r.statut === 'a_saisir' && r.montant === null)).toBe(true);
    expect(d.renvois.find((r: any) => r.code === 'HP').proposition).toMatchObject({ montant: '2400.00' });
  }, 120_000);

  it('une somme qui n’égale pas le solde est refusée en 409 avec l’écart, rien n’est enregistré', async () => {
    const r = await qualifier('706000', '1500.00', '0.00');
    expect(r.statut).toBe(409);
    expect(JSON.stringify(r.json)).toMatch(/écart 500\.00/);
    expect(ligneCA(await detail(), 'SERVICES').comptes[0].etat).toBe('a_qualifier');
  });

  it('refuse : note absente ou trop courte, montant mal formé, compte inconnu ou hors chiffre d’affaires, compte sans montant', async () => {
    expect((await qualifier('706000', '2000.00', '0.00', 'ok')).statut).toBe(400);
    expect((await qualifier('706000', '2 000,00', '0.00')).statut).toBe(400);
    expect((await qualifier('706999', '1.00', '0.00')).statut).toBe(404);
    expect((await qualifier('411000', '1.00', '0.00')).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exN}/qualifications/renvois/ZZ`, { montant: '1.00', note: 'inconnu ici' })).statut).toBe(404);
  });

  it('qualification complète : lignes et net établis, trace (auteur, version) et journal', async () => {
    for (const [c, f, e] of [['707100', '5000.00', '0.00'], ['707200', '0.00', '1000.00'], ['709700', '-200.00', '0.00'], ['701100', '3000.00', '1000.00']] as const) {
      const r = await qualifier(c, f, e);
      expect(r.statut, JSON.stringify(r.json)).toBeLessThan(300);
    }
    let d = await detail();
    expect(ligneCA(d, 'SERVICES').france.statut).toBe('abstention');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.france.statut).toBe('abstention');
    expect((await qualifier('706000', '2000.00', '0.00')).statut).toBeLessThan(300);
    d = await detail();
    expect(ligneCA(d, 'MARCHANDISES').france).toMatchObject({ statut: 'etabli', montant: '4800.00', codeCase: 'FA' });
    expect(ligneCA(d, 'MARCHANDISES').export).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: 'FB' });
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet).toMatchObject({ france: { montant: '9800.00', codeCase: 'FJ' }, export: { montant: '2000.00', codeCase: 'FK' } });
    expect(d.ventilationChiffreAffaires.complete).toBe(true);
    expect(d.controles.find((c: any) => c.code === 'CA_FRANCE_EXPORT').statut).toBe('coherent');
    const q = ligneCA(d, 'BIENS').comptes[0];
    expect(q).toMatchObject({ etat: 'qualifie', qualification: { montantFrance: '3000.00', montantExport: '1000.00', qualifieePar: DEMO.remi, versionDonnees: expect.any(Number) } });
    const journal = await editeur.query(`select action, details from journal_audit where cabinet_id = $1 and action = 'resultat.ventilation_qualifiee' order by id`, [cabinet]);
    expect(journal.rows.length).toBe(6); // 5 qualifications de ce test + 1 jouée par l'essai du 2033-B (retirée depuis, mais journalisée)
  }, 120_000);

  it('renvoi : saisi avec sa trace, proposition de la balance distincte ; retrait possible', async () => {
    expect((await renvoi('HP', '2000.00')).statut).toBeLessThan(300);
    let d = await detail();
    const hp = d.renvois.find((r: any) => r.code === 'HP');
    expect(hp).toMatchObject({ statut: 'saisi', montant: '2000.00', proposition: { montant: '2400.00' }, saisie: { qualifieePar: DEMO.remi, note: 'Relevé des loyers de crédit-bail' } });
    expect(d.renvois.find((r: any) => r.code === 'HQ')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/HP`)).statut).toBeLessThan(300);
    d = await detail();
    expect(d.renvois.find((r: any) => r.code === 'HP')).toMatchObject({ statut: 'a_saisir', montant: null });
    expect((await api('remi', 'DELETE', `/v1/exercices/${exN}/qualifications/renvois/HP`)).statut).toBe(404);
  });

  it('droits : la collaboration lit mais ne qualifie pas ; le déposant n’a aucun accès', async () => {
    expect((await qualifier('706000', '2000.00', '0.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await renvoi('HP', '1.00', 'Essai collaborateur', 'chloe')).statut).toBeGreaterThanOrEqual(400);
    expect((await liasse(exN, 'reel_normal', 'chloe')).statut).toBe(200);
    expect((await liasse(exN, 'reel_normal', 'client')).statut).toBe(404);
    expect((await qualifier('706000', '2000.00', '0.00', 'Essai déposant', 'client')).statut).toBe(404);
  });

  it('les données changent (nouvel import) : la qualification devient « à revoir » et ne compte plus', async () => {
    // Un FEC différent (une écriture de plus, sans effet sur la classe 70) : la version des données change, les soldes des comptes de ventes non.
    await importer(dossier, exN, [...FEC_2026, ['OD', 'OD2612', '2026-12-30', [['512000', 'Banque', '100.00', '0.00'], ['411000', 'Clients', '0.00', '100.00']]]], '2026-12-30');
    const d = await detail();
    expect(ligneCA(d, 'SERVICES').comptes[0].etat).toBe('a_revoir');
    expect(ligneCA(d, 'SERVICES').france.statut).toBe('abstention');
    expect(d.ventilationChiffreAffaires.chiffreAffairesNet.france.statut).toBe('abstention');
  }, 120_000);
});
