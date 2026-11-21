/**
 * Tableaux d'immobilisations et d'amortissements de la liasse (D-104) — pile réelle locale, cabinet NEUF.
 * FEC écrits à la main (chiffres vérifiables) : 2054 et 2055 (régime normal), 2033-C (simplifié), N-1, fichier des immobilisations
 * saisi (écarts affichés, abstentions), abstention hors périmètre, droits (déposant : 404).
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
let outreMer = '';
let exN1 = '';
let exN = '';
let exOutreMer = '';

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

const FEC_2025: Piece[] = [
  ['AN', 'AN2025', '2025-01-01', [['218300', 'Materiel informatique', '10000.00', '0.00'], ['281830', 'Amortissements materiel informatique', '0.00', '2000.00'], ['101000', 'Capital', '0.00', '8000.00']]],
  ['AC', 'AC2501', '2025-03-10', [['215000', 'Materiel industriel', '30000.00', '0.00'], ['512000', 'Banque', '0.00', '30000.00']]],
  ['OD', 'OD2512', '2025-12-31', [['681120', 'Dotations aux amortissements', '4000.00', '0.00'], ['281830', 'Amortissements materiel informatique', '0.00', '1500.00'], ['281500', 'Amortissements materiel industriel', '0.00', '2500.00']]],
];
const FEC_2026: Piece[] = [
  ['AN', 'AN2026', '2026-01-01', [['218300', 'Materiel informatique', '10000.00', '0.00'], ['215000', 'Materiel industriel', '30000.00', '0.00'], ['129000', 'Perte de l exercice', '4000.00', '0.00'], ['281830', 'Amortissements materiel informatique', '0.00', '3500.00'], ['281500', 'Amortissements materiel industriel', '0.00', '2500.00'], ['101000', 'Capital', '0.00', '8000.00'], ['512000', 'Banque', '0.00', '30000.00']]],
  ['AC', 'AC2601', '2026-02-15', [['218400', 'Mobilier', '5000.00', '0.00'], ['512000', 'Banque', '0.00', '5000.00']]],
  ['OD', 'OD2604', '2026-04-30', [['281500', 'Amortissements materiel industriel', '2500.00', '0.00'], ['462000', 'Creances sur cessions', '8000.00', '0.00'], ['215000', 'Materiel industriel', '0.00', '10000.00'], ['775000', 'Produits des cessions', '0.00', '500.00']]],
  ['OD', 'OD2612', '2026-12-30', [['681120', 'Dotations aux amortissements', '5000.00', '0.00'], ['281830', 'Amortissements materiel informatique', '0.00', '2000.00'], ['281500', 'Amortissements materiel industriel', '0.00', '3000.00']]],
];

async function importer(d: string, ex: string, pieces: Piece[], fin: string) {
  const nom = genererFecSynthetique({ exercice: { debut: `${fin.slice(0, 4)}-01-01`, fin }, nbEcritures: 10, graine: 1 }).nomFichier;
  const depot = await deposer('remi', d, fec(pieces), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, nom);
  expect(depot.fin.statut, JSON.stringify(depot.fin.json)).toBeLessThan(300);
  await attendreLot('remi', depot.fin.json.lotImportId);
}
const liasse = (ex: string, regime = 'reel_normal', qui = 'remi') => api(qui, 'GET', `/v1/exercices/${ex}/liasse?regime=${regime}`);
const cellule = (t: any, cadre: string, ligne: string, cle: string) => t.cadres.find((c: any) => c.id === cadre).lignes.find((l: any) => l.id === ligne).cellules[cle];

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai immobilisations ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '25 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  const creer = async (nom: string, territoire: string) => {
    const d = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: territoire, formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
    for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
      expect((await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
    }
    return d;
  };
  dossier = await creer(`Société d’essai immobilisations ${SEL} SAS (fictive)`, 'metropole');
  outreMer = await creer(`Société d’essai immobilisations outre-mer ${SEL} SAS (fictive)`, 'martinique');
  exN1 = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  exN = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-30' })).json.id;
  exOutreMer = (await api('alice', 'POST', `/v1/dossiers/${outreMer}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('tableaux 2054, 2055 et 2033-C — projets déduits de la balance et du fichier des immobilisations', () => {
  it('sans données comptables : 409, rien n’est préparé', async () => {
    const r = await liasse(exN);
    expect(r.statut).toBe(409);
  });

  it('régime normal : 2054 et 2055 déduits de la balance, avec N-1 et sans fichier', async () => {
    await importer(dossier, exN1, FEC_2025, '2025-12-31');
    await importer(dossier, exN, FEC_2026, '2026-12-30');
    const r = await liasse(exN);
    expect(r.statut, JSON.stringify(r.json)).toBe(200);
    const t = r.json.tableauxImmobilisations;
    expect(t).toMatchObject({ statut: 'projet', complet: false, regime: 'reel_normal', aNouveauxIdentifies: true, comparatif: { statut: 'fourni' }, fichier: { fourni: false, nbImmobilisations: 0 } });
    expect(t.mention).toMatch(/en attente de validation professionnelle/);
    const t2054 = t.tableaux.find((x: any) => x.code === '2054');
    const t2055 = t.tableaux.find((x: any) => x.code === '2055');
    expect(cellule(t2054, 'A', 'BUREAU', 'ouverture')).toMatchObject({ montant: '10000.00', n1: '10000.00', codeCase: 'LB', etatCodeCase: 'lu_a_confirmer', statut: 'etabli' });
    expect(cellule(t2054, 'A', 'BUREAU', 'augmentation_acquisitions')).toMatchObject({ montant: '5000.00', codeCase: 'LD' });
    expect(cellule(t2054, 'B', 'INST_TECH', 'cloture')).toMatchObject({ montant: '20000.00', n1: '30000.00', codeCase: 'MK' });
    expect(cellule(t2054, 'B', 'INST_TECH', 'diminution_cession')).toMatchObject({ montant: null, statut: 'a_saisir', codeCase: 'MJ' });
    expect(cellule(t2054, 'B', 'INST_TECH', 'diminutions_totales').montant).toBe('10000.00');
    expect(cellule(t2054, 'B', 'TOTAL_GENERAL', 'cloture')).toMatchObject({ montant: '35000.00', n1: '40000.00', codeCase: 'ØL' });
    expect(cellule(t2054, 'A', 'TERRAINS', 'augmentation_reevaluation')).toMatchObject({ montant: null, statut: 'a_saisir' });
    expect(cellule(t2055, 'A', 'BUREAU', 'dotations')).toMatchObject({ montant: '2000.00', n1: '1500.00', codeCase: 'QM' });
    expect(cellule(t2055, 'A', 'INST_TECH', 'diminutions').montant).toBe('2500.00');
    expect(cellule(t2055, 'A', 'TOTAL_GENERAL', 'cloture')).toMatchObject({ montant: '8500.00', n1: '6000.00', codeCase: 'ØR' });
    expect(t.totaux).toEqual({ valeur_brute_cloture: '35000.00', amortissements_cloture: '8500.00', valeur_nette_cloture: '26500.00' });
    const controle = (code: string) => t.controles.find((c: any) => c.code === code);
    expect(controle('valeur_brute_egale_projet_de_bilan')).toMatchObject({ statut: 'ok' });
    expect(controle('ouverture_brute_egale_cloture_n1')).toMatchObject({ statut: 'ok' });
    expect(controle('ouverture_amortissements_egale_cloture_n1')).toMatchObject({ statut: 'ok' });
    expect(controle('fichier_valeurs_brutes').statut).toBe('non_verifiable');
    // La liasse elle-même ne présente plus 2054 et 2055 comme « non couverts » mais comme partiels, renvoyant au champ dédié.
    expect(r.json.resultat.tableauxNonCouverts.filter((x: any) => ['2054', '2055'].includes(x.code)).map((x: any) => x.couverture)).toEqual(['partiel', 'partiel']);
    // Aucun montant à virgule flottante : toutes les cellules sont des chaînes décimales à deux décimales.
    const montants = t.tableaux.flatMap((x: any) => x.cadres.flatMap((c: any) => c.lignes.flatMap((l: any) => Object.values(l.cellules)))) as Array<{ montant: string | null }>;
    for (const m of montants) if (m.montant !== null) expect(m.montant).toMatch(/^-?\d+\.\d{2}$/);
  }, 180_000);

  it('N-1 : l’exercice précédent seul donne les chiffres de la colonne N-1', async () => {
    const seul = (await liasse(exN1)).json.tableauxImmobilisations;
    expect(seul.comparatif.statut).toBe('indisponible');
    expect(cellule(seul.tableaux[0], 'B', 'TOTAL_GENERAL', 'cloture').montant).toBe('40000.00');
    expect(cellule(seul.tableaux[1], 'A', 'TOTAL_GENERAL', 'cloture').montant).toBe('6000.00');
  }, 120_000);

  it('fichier des immobilisations saisi : rapprochement avec écarts affichés, abstentions motivées, dégressif non activé', async () => {
    const saisir = (corps: unknown) => api('chloe', 'POST', `/v1/dossiers/${dossier}/immobilisations`, corps);
    const bureau = await saisir({ libelle: 'Ordinateurs', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2024-06-01', dureeMois: 60, amortissementsAnterieurs: '3500.00' });
    const machine = await saisir({ libelle: 'Machine A', compteImmobilisation: '215000', baseAmortissable: '30000.00', dateMiseEnService: '2025-03-10', dureeMois: 120, amortissementsAnterieurs: '2500.00' });
    const sortie = await saisir({ libelle: 'Presse cédée', compteImmobilisation: '215000', baseAmortissable: '1000.00', dateMiseEnService: '2025-03-10', dureeMois: 60, dateSortie: '2026-04-30' });
    const degressif = await saisir({ libelle: 'Compresseur dégressif', compteImmobilisation: '215000', baseAmortissable: '9000.00', dateAcquisition: '2026-01-10', dateMiseEnService: '2026-01-10', dureeMois: 60, modeAmortissement: 'degressif', coefficientDegressif: '1.75', eligibiliteDegressifConfirmee: true });
    for (const c of [bureau, machine, sortie, degressif]) expect(c.statut, JSON.stringify(c.json)).toBeLessThan(300);
    const t = (await liasse(exN)).json.tableauxImmobilisations;
    expect(t.fichier).toMatchObject({ fourni: true, nbImmobilisations: 4, degressif: { active: false } });
    expect(t.fichier.degressif.motif).toMatch(/non activé/);
    const codes = t.fichier.abstentions.map((a: any) => `${a.libelle}:${a.code}`);
    expect(codes).toContain('Presse cédée:sortie_d_actif');
    expect(codes).toContain('Compresseur dégressif:degressif_non_active');
    const t2054 = t.tableaux.find((x: any) => x.code === '2054');
    const t2055 = t.tableaux.find((x: any) => x.code === '2055');
    const ligne = (tab: any, cadre: string, id: string) => tab.cadres.find((c: any) => c.id === cadre).lignes.find((l: any) => l.id === id);
    // Matériel de bureau : le fichier concorde avec la balance à l'ouverture (10 000) ; les 5 000 acquis en 2026 ne sont pas saisis : écart affiché.
    expect(ligne(t2054, 'A', 'BUREAU').fichierBrut).toMatchObject({ valeurBruteOuverture: '10000.00', ecartOuverture: '0.00', valeurBruteCloture: '10000.00', ecartCloture: '5000.00' });
    // Installations techniques : 30 000 + 1 000 + 9 000 au fichier, 20 000 en balance : écarts affichés, jamais corrigés.
    const tech = ligne(t2054, 'A', 'INST_TECH').fichierBrut;
    expect(tech.sortiesDansExercice).toEqual({ nombre: 1, valeurBrute: '1000.00' });
    expect(tech.ecartCloture).toBe('-19000.00');
    expect(cellule(t2054, 'B', 'INST_TECH', 'cloture').montant).toBe('20000.00');
    expect(t.controles.find((c: any) => c.code === 'fichier_valeurs_brutes').statut).toBe('ecart');
    // Amortissements : la dotation calculée par le moteur n'est complète qu'en l'absence d'abstention.
    expect(ligne(t2055, 'A', 'BUREAU').fichierAmortissements).toMatchObject({ amortissementsOuverture: '3500.00', ecartOuverture: '0.00', dotationComptabilisee: '2000.00' });
    expect(ligne(t2055, 'A', 'INST_TECH').fichierAmortissements.calculComplet).toBe(false);
    expect(t.fichier.rapprochementMoteur.comptes.length).toBeGreaterThan(0);
    // Le fichier n'est pas modifié par la lecture ; et rien n'est comptabilisé.
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json).toHaveLength(4);
  }, 180_000);

  it('régime simplifié : 2033-C, cadres I et II, cadre III non préparé', async () => {
    const r = await liasse(exN, 'reel_simplifie');
    expect(r.statut).toBe(200);
    const t = r.json.tableauxImmobilisations;
    expect(t).toMatchObject({ statut: 'projet', regime: 'reel_simplifie', comparatif: { statut: 'fourni' } });
    const c = t.tableaux.find((x: any) => x.code === '2033-C');
    expect(t.tableaux).toHaveLength(1);
    expect(c.cadres.map((x: any) => x.id)).toEqual(['I', 'II']);
    expect(c.cadresNonCouverts.map((x: any) => x.cadre)).toEqual(['III']);
    expect(cellule(c, 'I', 'INST_TECH', 'cloture')).toMatchObject({ montant: '20000.00', n1: '30000.00', codeCase: '446' });
    expect(cellule(c, 'I', 'TOTAL', 'cloture')).toMatchObject({ montant: '35000.00', codeCase: '496' });
    expect(cellule(c, 'II', 'TOTAL', 'cloture')).toMatchObject({ montant: '8500.00', n1: '6000.00', codeCase: '576' });
    expect(r.json.resultat.tableauxNonCouverts.find((x: any) => x.code === '2033-C').couverture).toBe('partiel');
  }, 120_000);

  it('hors périmètre (outre-mer) : abstention motivée, aucun chiffre', async () => {
    await importer(outreMer, exOutreMer, FEC_2025, '2025-12-31');
    const r = await liasse(exOutreMer);
    expect(r.statut).toBe(200);
    expect(r.json.tableauxImmobilisations).toMatchObject({ statut: 'abstention', motifs: [expect.objectContaining({ code: 'territoire_hors_perimetre' })] });
    expect(JSON.stringify(r.json.tableauxImmobilisations)).not.toMatch(/\d+\.\d{2}/);
  }, 120_000);

  it('droits : lecture pour la révision, 404 pour le déposant, 404 pour un exercice inconnu', async () => {
    expect((await liasse(exN, 'reel_normal', 'chloe')).statut).toBe(200);
    expect((await liasse(exN, 'reel_normal', 'client')).statut).toBe(404);
    expect((await liasse('00000000-0000-4000-8000-000000000000')).statut).toBe(404);
    expect((await liasse(exN, 'inconnu')).statut).toBe(400);
  });
});
