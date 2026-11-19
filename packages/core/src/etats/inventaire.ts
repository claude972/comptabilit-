/**
 * Propositions assistées d'écritures d'inventaire — déterministes, JAMAIS comptabilisées automatiquement (décision D-028).
 *
 * Quatre règles explicites, chacune versionnée :
 *  - INV-CCA / INV-PCA : charge ou produit de l'exercice dont la période couverte dépasse la clôture. La période vient d'une
 *    saisie du cabinet (`periodesCouvertes`) ou d'un libellé portant deux dates complètes (« du 01/10/2025 au 30/09/2026 ») ;
 *    prorata temporis en jours calendaires réels, bornes incluses ;
 *  - INV-FNP / INV-FAE : écriture passée après la clôture sur une pièce datée dans l'exercice, signalée par un constat du
 *    contrôle de césure CLO-001 ; l'écriture d'origine doit se réduire à « charge + TVA + fournisseur » (ou « produit + TVA + client ») ;
 *  - INV-AMORT : dotation linéaire, UNIQUEMENT si la base, la date de mise en service et la durée sont fournies.
 *
 * Dès qu'une donnée manque ou qu'un cas est ambigu : abstention motivée, jamais d'estimation silencieuse.
 * Chaque proposition est équilibrée (débit = crédit, vérifié en décimal exact), porte le statut `proposee`, son calcul détaillé,
 * ses sources et ses hypothèses. Aucun montant n'est un flottant.
 */
import { Decimal } from 'decimal.js';
import { creditDe, debitDe } from '../controles/outils.js';
import type { Constat, LigneEcriture, SourceRegle } from '../controles/types.js';
import { dateCivileValide, ecartEnJours, estBissextile, estDateIso, isoDepuisJours, joursDepuisEpoque, versIso } from '../dates.js';
import { type ChaineDecimale, estChaineDecimale, versChaine } from '../montant.js';
import { MENTION_PROJET, SOURCES_FISCALES } from './sources-fiscales.js';

const ZERO = new Decimal(0);

// ───────────────────────────── Types publics ─────────────────────────────

export type TypePropositionInventaire = 'charge_constatee_avance' | 'produit_constate_avance' | 'facture_non_parvenue' | 'facture_a_etablir' | 'dotation_amortissement_lineaire';
export type ConventionJoursAmortissement = 'base_360' | 'jours_reels';

/** Période couverte par une ligne de charge ou de produit, fournie par le cabinet. */
export interface PeriodeCouverte {
  /** Identifiant de la ligne d'écriture (`LigneEcriture.id`). */
  ligneId: string;
  /** Premier jour couvert (ISO). Absent : abstention, le prorata n'est pas calculable. */
  debut?: string | null;
  /** Dernier jour couvert (ISO). */
  fin: string;
}

/** Données d'une immobilisation à amortir en linéaire. Une donnée absente (`null`) provoque une abstention motivée. */
export interface ImmobilisationAAmortir {
  id: string;
  libelle: string;
  /** Compte d'immobilisation (20x ou 21x pour une dérivation automatique des comptes). */
  compteImmobilisation: string;
  /** Montant amortissable (valeur brute diminuée de la valeur résiduelle éventuelle). */
  baseAmortissable: ChaineDecimale | null;
  dateMiseEnService: string | null;
  /** Durée d'amortissement en mois entiers. */
  dureeMois: number | null;
  /** Amortissements cumulés à l'ouverture de l'exercice, s'ils sont connus : ils plafonnent la dotation et soldent le plan. */
  amortissementsAnterieurs?: ChaineDecimale | null;
  /** Compte d'amortissement (28x). Défaut : dérivé du compte d'immobilisation. */
  compteAmortissement?: string;
  /** Compte de dotation. Défaut : 68111 (comptes 20x) ou 68112 (comptes 21x). */
  compteDotation?: string;
}

export interface ComptesInventaire {
  chargesConstateesAvance: string;
  produitsConstatesAvance: string;
  facturesNonParvenues: string;
  tvaSurFacturesNonParvenues: string;
  facturesAEtablir: string;
  tvaSurFacturesAEtablir: string;
}

export interface DemandeInventaire {
  /** Écritures du dossier. Les écritures postérieures à la clôture sont nécessaires aux factures non parvenues et à établir. */
  lignes: readonly LigneEcriture[];
  exercice: { debut: string; fin: string };
  periodesCouvertes?: readonly PeriodeCouverte[];
  /** Lire les périodes « du JJ/MM/AAAA au JJ/MM/AAAA » dans les libellés d'écriture (défaut : oui). */
  lireLibelles?: boolean;
  /** Constats du contrôle de césure CLO-001 (`ResultatControle.constats`). Les autres constats sont ignorés. */
  constatsCesure?: readonly Constat[];
  immobilisations?: readonly ImmobilisationAAmortir[];
  options?: {
    /** Défaut : `base_360` (année de 360 jours, mois de 30 jours). */
    conventionJoursAmortissement?: ConventionJoursAmortissement;
    /** Comptes à utiliser ; à défaut ils sont repris des écritures ou construits à partir de la racine du plan de comptes. */
    comptes?: Partial<ComptesInventaire>;
  };
}

export interface LignePropositionInventaire { compteNum: string; libelle: string; debit: ChaineDecimale; credit: ChaineDecimale }

export interface PropositionEcritureInventaire {
  /** Clé stable entre deux exécutions sur les mêmes données. */
  id: string;
  type: TypePropositionInventaire;
  /** Toujours « proposee » : aucune écriture n'est comptabilisée par le moteur. */
  statut: 'proposee';
  /** Date de l'écriture proposée : date de clôture. */
  dateEcriture: string;
  libelle: string;
  origine: { regle: string; versionRegle: string; signal: string };
  justification: string;
  /** Calcul détaillé, étape par étape. */
  calcul: Array<{ libelle: string; valeur: string }>;
  lignes: LignePropositionInventaire[];
  totalDebit: ChaineDecimale;
  totalCredit: ChaineDecimale;
  /** Vérifié en décimal exact : une proposition déséquilibrée n'est jamais émise. */
  equilibree: true;
  sources: {
    /** Identifiants des lignes d'écriture sources. */
    lignesEcritures: string[];
    ecritures: Array<{ journalCode: string; ecritureNum: string; ecritureDate: string }>;
    pieces: string[];
    /** Clés des constats sources. */
    constats: string[];
    immobilisation: string | null;
  };
  /** Effets si l'écriture était comptabilisée. Positif = augmentation. */
  impacts: { resultat: ChaineDecimale; totalActif: ChaineDecimale; totalPassif: ChaineDecimale; commentaire: string };
  hypotheses: string[];
  /** L'écriture est à contre-passer à l'ouverture de l'exercice suivant (date indiquée), ou `null`. */
  extourneLe: string | null;
  source: SourceRegle;
}

export interface AbstentionInventaire {
  type: TypePropositionInventaire | 'cesure';
  code: string;
  motif: string;
  sources: { lignesEcritures: string[]; constat: string | null; immobilisation: string | null };
}

export interface RegleInventaire { id: string; version: string; type: TypePropositionInventaire; description: string; source: SourceRegle }

export interface ResultatInventaire {
  statut: 'projet';
  mention: string;
  exercice: { debut: string; fin: string };
  propositions: PropositionEcritureInventaire[];
  abstentions: AbstentionInventaire[];
  regles: RegleInventaire[];
  conventions: string[];
  /** Cumul des impacts si TOUTES les propositions étaient retenues (elles ne le sont jamais d'office). */
  totaux: { nbPropositions: number; nbAbstentions: number; impactResultat: ChaineDecimale; impactTotalActif: ChaineDecimale; impactTotalPassif: ChaineDecimale };
}

// ───────────────────────────── Règles ─────────────────────────────

export const REGLES_INVENTAIRE: readonly RegleInventaire[] = Object.freeze([
  { id: 'INV-CCA', version: '1.0.0', type: 'charge_constatee_avance', source: SOURCES_FISCALES.chargesConstateesAvance,
    description: 'Ligne de charge (classe 6, hors 603, 68 et 69) datée dans l’exercice dont la période couverte s’achève après la clôture : débit 486, crédit du compte de charge, pour montant × jours postérieurs à la clôture ÷ jours de la période.' },
  { id: 'INV-PCA', version: '1.0.0', type: 'produit_constate_avance', source: SOURCES_FISCALES.produitsConstatesAvance,
    description: 'Ligne de produit (classe 7, hors 71, 72, 78 et 79) datée dans l’exercice dont la période couverte s’achève après la clôture : débit du compte de produit, crédit 487, même prorata.' },
  { id: 'INV-FNP', version: '1.0.0', type: 'facture_non_parvenue', source: SOURCES_FISCALES.facturesNonParvenues,
    description: 'Écriture passée après la clôture sur une pièce datée dans l’exercice (constat CLO-001), réductible à « charges + TVA déductible + fournisseur » : débit des comptes de charges et du compte 44586, crédit 408 toutes taxes comprises.' },
  { id: 'INV-FAE', version: '1.0.0', type: 'facture_a_etablir', source: SOURCES_FISCALES.facturesAEtablir,
    description: 'Écriture passée après la clôture sur une pièce datée dans l’exercice (constat CLO-001), réductible à « produits + TVA collectée + client » : débit 4181 toutes taxes comprises, crédit des comptes de produits et du compte 44587.' },
  { id: 'INV-AMORT', version: '1.0.0', type: 'dotation_amortissement_lineaire', source: SOURCES_FISCALES.amortissementLineaire,
    description: 'Dotation linéaire = base amortissable × jours de l’exercice compris dans le plan ÷ jours du plan, à compter de la mise en service ; débit 6811x, crédit 28x. Uniquement si base, date de mise en service et durée sont fournies.' },
]);

export const CONVENTIONS_INVENTAIRE: readonly string[] = Object.freeze([
  'Charges et produits constatés d’avance : prorata temporis en jours calendaires réels, premier et dernier jours de la période inclus ; part postérieure à la clôture = jours du lendemain de la clôture à la fin de la période.',
  'Amortissement linéaire, convention « base_360 » (défaut) : année de 360 jours, mois de 30 jours (le dernier jour d’un mois compte pour le 30) ; jour de mise en service inclus ; durée du plan = nombre de mois × 30 jours.',
  'Amortissement linéaire, convention « jours_reels » : jours calendaires réels ; le plan s’achève la veille du jour anniversaire de la mise en service, décalé du nombre de mois.',
  'Arrondi au centime, demi-unité éloignée de zéro. Le montant de la ligne d’écriture est pris hors taxes tel qu’il figure au compte de charge ou de produit.',
  'Une période n’est lue dans un libellé que si deux dates complètes (jour, mois, année sur quatre chiffres) y figurent, une seule fois ; sinon abstention.',
  'Les propositions sont indépendantes : elles ne tiennent pas compte les unes des autres ni des écritures d’inventaire déjà passées (un avertissement signale les comptes déjà mouvementés à la clôture).',
]);

const regle = (id: string): RegleInventaire => REGLES_INVENTAIRE.find((r) => r.id === id) as RegleInventaire;

// ───────────────────────────── Outils ─────────────────────────────

const m2 = (d: Decimal): ChaineDecimale => versChaine(d, 2);
const arrondi = (d: Decimal): Decimal => new Decimal(versChaine(d, 2));
const estCompte = (c: unknown): c is string => typeof c === 'string' && /^\d{3,12}$/.test(c);
const cleEcriture = (l: LigneEcriture): string => `${l.journalCode}\u0001${l.ecritureNum}\u0001${l.ecritureDate}`;
const lendemain = (iso: string): string => isoDepuisJours(joursDepuisEpoque(iso) + 1);

function dernierJourDuMois(annee: number, mois: number): number {
  return mois === 2 ? (estBissextile(annee) ? 29 : 28) : [4, 6, 9, 11].includes(mois) ? 30 : 31;
}
function decomposer(iso: string): { a: number; m: number; j: number } {
  return { a: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), j: Number(iso.slice(8, 10)) };
}
/** Rang d'un jour dans un calendrier de 360 jours (mois de 30 jours ; le dernier jour d'un mois vaut 30). */
function rang360(iso: string): number {
  const { a, m, j } = decomposer(iso);
  return a * 360 + (m - 1) * 30 + (j >= dernierJourDuMois(a, m) ? 30 : Math.min(j, 30));
}
function ajouterMois(iso: string, mois: number): string {
  const { a, m, j } = decomposer(iso);
  const total = a * 12 + (m - 1) + mois;
  const annee = Math.floor(total / 12);
  const moisCible = (total % 12) + 1;
  return versIso(annee, moisCible, Math.min(j, dernierJourDuMois(annee, moisCible)));
}
const borner = (n: number, max: number): number => Math.max(0, Math.min(max, n));

const MOTIF_DATE = String.raw`(\d{1,2})[/.](\d{1,2})[/.](\d{4})`;
const PERIODE_COMPLETE = new RegExp(String.raw`(?<!\d)${MOTIF_DATE}\s*(?:au|à|a|-|–|—|>|→)\s*${MOTIF_DATE}(?!\d)`, 'giu');
const PERIODE_ANNEE_COURTE = /(?<!\d)\d{1,2}[/.]\d{1,2}[/.]\d{2}\s*(?:au|à|a|-|–|—|>|→)\s*\d{1,2}[/.]\d{1,2}[/.]\d{2}(?!\d)/iu;

type LecturePeriode = { etat: 'aucune' } | { etat: 'lue'; debut: string; fin: string; extrait: string } | { etat: 'illisible'; motif: string };

/** Lit une période « JJ/MM/AAAA au JJ/MM/AAAA » dans un libellé. N'interprète rien d'autre ; ambigu ou incomplet → `illisible`. */
export function lirePeriodeDansLibelle(libelle: string): LecturePeriode {
  if (typeof libelle !== 'string' || libelle.length > 500) return { etat: 'aucune' };
  const trouvees = [...libelle.matchAll(PERIODE_COMPLETE)];
  if (trouvees.length === 0) {
    return PERIODE_ANNEE_COURTE.test(libelle) ? { etat: 'illisible', motif: 'le libellé porte une période dont les années sont sur deux chiffres : elle n’est pas interprétée' } : { etat: 'aucune' };
  }
  if (trouvees.length > 1) return { etat: 'illisible', motif: 'le libellé porte plusieurs périodes : aucune n’est retenue' };
  const t = trouvees[0] as RegExpMatchArray;
  const n = (i: number): number => Number(t[i]);
  if (!dateCivileValide(n(3), n(2), n(1)) || !dateCivileValide(n(6), n(5), n(4))) return { etat: 'illisible', motif: 'le libellé porte une période dont une date n’existe pas' };
  const debut = versIso(n(3), n(2), n(1));
  const fin = versIso(n(6), n(5), n(4));
  if (fin < debut) return { etat: 'illisible', motif: 'le libellé porte une période dont la fin précède le début' };
  return { etat: 'lue', debut, fin, extrait: t[0] };
}

interface Brouillon {
  id: string;
  type: TypePropositionInventaire;
  libelle: string;
  regleId: string;
  signal: string;
  justification: string;
  calcul: Array<{ libelle: string; valeur: string }>;
  lignes: Array<{ compteNum: string; libelle: string; debit: Decimal; credit: Decimal }>;
  lignesSources: readonly LigneEcriture[];
  constats: string[];
  immobilisation: string | null;
  impacts: { resultat: Decimal; totalActif: Decimal; totalPassif: Decimal; commentaire: string };
  hypotheses: string[];
  extourne: boolean;
}

// ───────────────────────────── Calcul ─────────────────────────────

/**
 * Propose des écritures d'inventaire à partir des écritures et des données fournies. Ne comptabilise rien.
 * Lève une erreur si l'exercice est invalide ; tout le reste (donnée manquante, cas ambigu) est une abstention motivée.
 */
export function proposerEcrituresInventaire(demande: DemandeInventaire): ResultatInventaire {
  const { debut, fin } = demande.exercice;
  if (!estDateIso(debut) || !estDateIso(fin) || fin < debut) throw new Error('Exercice invalide : dates ISO AAAA-MM-JJ attendues, clôture postérieure ou égale à l’ouverture.');
  const lignes = demande.lignes;
  const parId = new Map(lignes.map((l) => [l.id, l]));
  const dansExercice = (d: string): boolean => d >= debut && d <= fin;
  const ouvertureSuivante = lendemain(fin);
  const brouillons: Brouillon[] = [];
  const abstentions: AbstentionInventaire[] = [];
  const sAbstenir = (type: AbstentionInventaire['type'], code: string, motif: string, sources: Partial<AbstentionInventaire['sources']> = {}): void => {
    abstentions.push({ type, code, motif, sources: { lignesEcritures: sources.lignesEcritures ?? [], constat: sources.constat ?? null, immobilisation: sources.immobilisation ?? null } });
  };

  // Comptes de régularisation : option explicite, sinon compte déjà utilisé dans les écritures, sinon racine complétée de zéros.
  const comptesUtilises = [...new Set(lignes.map((l) => l.compteNum))].sort();
  const cles: Record<keyof ComptesInventaire, string> = { chargesConstateesAvance: '486', produitsConstatesAvance: '487', facturesNonParvenues: '408', tvaSurFacturesNonParvenues: '44586', facturesAEtablir: '4181', tvaSurFacturesAEtablir: '44587' };
  const compteDe = (cle: keyof ComptesInventaire, modele: string): { compte: string; hypothese: string } => {
    const racine = cles[cle];
    const impose = demande.options?.comptes?.[cle];
    if (impose !== undefined) {
      if (!estCompte(impose)) throw new Error(`Option « comptes.${cle} » invalide : numéro de compte de 3 à 12 chiffres attendu.`);
      return { compte: impose, hypothese: `Compte ${impose} fourni par le cabinet.` };
    }
    const existants = comptesUtilises.filter((c) => c.startsWith(racine));
    if (existants.length === 1) return { compte: existants[0] as string, hypothese: `Compte ${existants[0]} repris des écritures du dossier.` };
    if (existants.length > 1) return { compte: existants[0] as string, hypothese: `Plusieurs comptes ${racine} existent dans le dossier (${existants.slice(0, 5).join(', ')}) : le premier par ordre de numéro est proposé, à confirmer.` };
    const compte = racine.padEnd(Math.max(racine.length, modele.length), '0');
    return { compte, hypothese: `Aucun compte ${racine} dans les écritures : le compte ${compte} est construit à partir de la racine du plan de comptes, à adapter au plan du dossier.` };
  };
  const dejaMouvemente = (racine: string): string[] =>
    lignes.some((l) => l.compteNum.startsWith(racine) && l.ecritureDate === fin) ? [`Le compte ${racine} est déjà mouvementé à la date de clôture : vérifier que la régularisation n’a pas déjà été passée (risque de doublon).`] : [];

  // ── 1. Charges et produits constatés d'avance ──────────────────────────────────────────────
  const periodes = new Map<string, PeriodeCouverte>();
  const periodesEnDouble = new Set<string>();
  for (const p of demande.periodesCouvertes ?? []) {
    if (periodes.has(p.ligneId)) periodesEnDouble.add(p.ligneId);
    else periodes.set(p.ligneId, p);
  }
  for (const ligneId of periodesEnDouble) {
    periodes.delete(ligneId);
    sAbstenir('charge_constatee_avance', 'periode_en_double', `Plusieurs périodes fournies pour la ligne ${ligneId} : aucune n’est retenue.`, { lignesEcritures: [ligneId] });
  }
  for (const ligneId of periodes.keys()) {
    if (!parId.has(ligneId)) sAbstenir('charge_constatee_avance', 'ligne_introuvable', `Période fournie pour la ligne ${ligneId}, absente des écritures.`, { lignesEcritures: [ligneId] });
  }
  const EXCLUS_CHARGES = ['603', '68', '69'];
  const EXCLUS_PRODUITS = ['71', '72', '78', '79'];
  const lireLibelles = demande.lireLibelles ?? true;
  for (const l of lignes) {
    const charge = l.compteNum.startsWith('6');
    const produit = l.compteNum.startsWith('7');
    const fournie = periodes.get(l.id);
    if (periodesEnDouble.has(l.id)) continue;
    const type: TypePropositionInventaire = produit ? 'produit_constate_avance' : 'charge_constatee_avance';
    const src = { lignesEcritures: [l.id] };
    if (!charge && !produit) {
      if (fournie !== undefined) sAbstenir(type, 'compte_hors_perimetre', `Période fournie pour la ligne ${l.id} au compte ${l.compteNum}, qui n’est ni un compte de charges ni un compte de produits.`, src);
      continue;
    }
    if (!dansExercice(l.ecritureDate)) {
      if (fournie !== undefined) sAbstenir(type, 'ecriture_hors_exercice', `Période fournie pour la ligne ${l.id}, datée du ${l.ecritureDate}, hors de l’exercice.`, src);
      continue;
    }
    let periode: { debut: string; fin: string } | null = null;
    let signal: string;
    if (fournie !== undefined) {
      if (!estDateIso(fournie.fin) || (fournie.debut !== undefined && fournie.debut !== null && !estDateIso(fournie.debut))) { sAbstenir(type, 'periode_invalide', `Période fournie pour la ligne ${l.id} invalide : dates ISO AAAA-MM-JJ attendues.`, src); continue; }
      if (fournie.fin <= fin) { sAbstenir(type, 'periode_dans_exercice', `La période fournie pour la ligne ${l.id} s’achève le ${fournie.fin}, au plus tard à la clôture : aucune régularisation.`, src); continue; }
      if (fournie.debut === undefined || fournie.debut === null) { sAbstenir(type, 'debut_de_periode_manquant', `La période fournie pour la ligne ${l.id} s’achève le ${fournie.fin}, après la clôture, mais son premier jour n’est pas fourni : prorata non calculable.`, src); continue; }
      if (fournie.fin < fournie.debut) { sAbstenir(type, 'periode_invalide', `Période fournie pour la ligne ${l.id} invalide : la fin précède le début.`, src); continue; }
      periode = { debut: fournie.debut, fin: fournie.fin };
      signal = `Période couverte du ${periode.debut} au ${periode.fin} fournie par le cabinet.`;
    } else {
      if (!lireLibelles) continue;
      const lecture = lirePeriodeDansLibelle(l.ecritureLib);
      if (lecture.etat === 'aucune') continue;
      if (lecture.etat === 'illisible') { sAbstenir(type, 'periode_illisible', `Ligne ${l.id} (${l.journalCode} ${l.ecritureNum}, compte ${l.compteNum}) : ${lecture.motif}. Fournir la période couverte pour obtenir une proposition.`, src); continue; }
      if (lecture.fin <= fin) continue;
      periode = { debut: lecture.debut, fin: lecture.fin };
      signal = `Période « ${lecture.extrait} » lue dans le libellé de l’écriture.`;
    }
    if ((charge ? EXCLUS_CHARGES : EXCLUS_PRODUITS).some((p) => l.compteNum.startsWith(p))) { sAbstenir(type, 'compte_exclu', `Ligne ${l.id} : le compte ${l.compteNum} (variation de stocks, dotations, reprises, production stockée ou immobilisée, impôts sur les bénéfices) n’est pas régularisé par cette règle.`, src); continue; }
    const net = charge ? debitDe(l).minus(creditDe(l)) : creditDe(l).minus(debitDe(l));
    if (!net.isPositive() || net.isZero()) { sAbstenir(type, 'sens_inverse', `Ligne ${l.id} : le compte ${l.compteNum} est mouvementé en sens inverse (avoir, annulation ou montant nul) : non traité.`, src); continue; }
    const joursPeriode = ecartEnJours(periode.debut, periode.fin) + 1;
    const debutApres = periode.debut > ouvertureSuivante ? periode.debut : ouvertureSuivante;
    const joursApres = ecartEnJours(debutApres, periode.fin) + 1;
    const montant = arrondi(net.times(joursApres).dividedBy(joursPeriode));
    if (montant.isZero()) { sAbstenir(type, 'montant_nul', `Ligne ${l.id} : la part postérieure à la clôture est nulle après arrondi.`, src); continue; }
    const cr = compteDe(charge ? 'chargesConstateesAvance' : 'produitsConstatesAvance', l.compteNum);
    const hypotheses = [
      signal.startsWith('Période «') ? 'La période est lue dans un libellé d’écriture, contenu non fiable : à rapprocher de la pièce.' : 'La période couverte est celle fournie par le cabinet.',
      'La charge ou le produit est réputé acquis uniformément sur la période (prorata en jours calendaires réels, bornes incluses).',
      'Le montant de la ligne est réputé hors taxes et porter sur la seule période indiquée.',
      ...(periode.debut < debut ? [`La période commence le ${periode.debut}, avant l’ouverture de l’exercice : la part antérieure n’est pas examinée.`] : []),
      cr.hypothese,
      ...dejaMouvemente(charge ? '486' : '487'),
    ];
    const calcul = [
      { libelle: 'Montant de la ligne (hors taxes)', valeur: m2(net) },
      { libelle: 'Période couverte', valeur: `${periode.debut} au ${periode.fin}` },
      { libelle: 'Jours de la période (bornes incluses)', valeur: String(joursPeriode) },
      { libelle: 'Jours postérieurs à la clôture', valeur: `${joursApres} (du ${debutApres} au ${periode.fin})` },
      { libelle: 'Formule', valeur: `${m2(net)} × ${joursApres} ÷ ${joursPeriode}` },
      { libelle: charge ? 'Charge constatée d’avance' : 'Produit constaté d’avance', valeur: m2(montant) },
    ];
    const piece = l.pieceRef === '' ? `${l.journalCode} ${l.ecritureNum}` : l.pieceRef;
    brouillons.push(charge
      ? {
        id: `INV-CCA|${l.id}`, type, regleId: 'INV-CCA', signal, libelle: `Charge constatée d’avance - pièce ${piece} - ${joursApres}/${joursPeriode} jours`,
        justification: `La charge enregistrée au compte ${l.compteNum} le ${l.ecritureDate} couvre une période qui s’achève le ${periode.fin}, après la clôture du ${fin} : la part correspondant à une fourniture ou une prestation postérieure à la clôture est une charge constatée d’avance (PCG art. 211-8 et 1214-48).`,
        calcul, lignesSources: [l], constats: [], immobilisation: null, hypotheses, extourne: true,
        lignes: [{ compteNum: cr.compte, libelle: 'Charges constatées d’avance', debit: montant, credit: ZERO }, { compteNum: l.compteNum, libelle: l.compteLib, debit: ZERO, credit: montant }],
        impacts: { resultat: montant, totalActif: montant, totalPassif: montant, commentaire: 'Diminue les charges de l’exercice ; augmente l’actif (charges constatées d’avance) et, par le résultat, le passif.' },
      }
      : {
        id: `INV-PCA|${l.id}`, type, regleId: 'INV-PCA', signal, libelle: `Produit constaté d’avance - pièce ${piece} - ${joursApres}/${joursPeriode} jours`,
        justification: `Le produit enregistré au compte ${l.compteNum} le ${l.ecritureDate} couvre une période qui s’achève le ${periode.fin}, après la clôture du ${fin} : la part correspondant à une prestation ou une fourniture non encore effectuée à la clôture est un produit constaté d’avance (PCG art. 1214-48).`,
        calcul, lignesSources: [l], constats: [], immobilisation: null, hypotheses, extourne: true,
        lignes: [{ compteNum: l.compteNum, libelle: l.compteLib, debit: montant, credit: ZERO }, { compteNum: cr.compte, libelle: 'Produits constatés d’avance', debit: ZERO, credit: montant }],
        impacts: { resultat: montant.negated(), totalActif: ZERO, totalPassif: ZERO, commentaire: 'Diminue les produits de l’exercice ; le passif augmente des produits constatés d’avance et diminue d’autant par le résultat (total du bilan inchangé).' },
      });
  }

  // ── 2. Factures non parvenues et factures à établir, à partir des constats de césure ─────────
  const parEcriture = new Map<string, LigneEcriture[]>();
  for (const l of lignes) { const k = cleEcriture(l); const g = parEcriture.get(k); if (g === undefined) parEcriture.set(k, [l]); else g.push(l); }
  const ecrituresTraitees = new Set<string>();
  for (const constat of demande.constatsCesure ?? []) {
    if (!constat.cle.startsWith('CLO-001|')) continue;
    const src = { constat: constat.cle, lignesEcritures: [...constat.lignesConcernees] };
    const concernees = constat.lignesConcernees.map((id) => parId.get(id)).filter((l): l is LigneEcriture => l !== undefined);
    if (concernees.length === 0) { sAbstenir('cesure', 'lignes_introuvables', `Constat ${constat.cle} : aucune des lignes concernées n’est dans les écritures fournies.`, src); continue; }
    const premiere = concernees[0] as LigneEcriture;
    const cle = cleEcriture(premiere);
    if (concernees.some((l) => cleEcriture(l) !== cle)) { sAbstenir('cesure', 'constat_sur_plusieurs_ecritures', `Constat ${constat.cle} : les lignes concernées relèvent de plusieurs écritures.`, src); continue; }
    if (ecrituresTraitees.has(cle)) continue;
    ecrituresTraitees.add(cle);
    const piece = premiere.pieceDate;
    const mention = `Écriture ${premiere.journalCode} ${premiere.ecritureNum} du ${premiere.ecritureDate}`;
    if (piece === null) { sAbstenir('cesure', 'date_de_piece_absente', `${mention} : date de pièce absente.`, src); continue; }
    if (dansExercice(premiere.ecritureDate)) {
      sAbstenir('cesure', piece > fin ? 'piece_posterieure_a_la_cloture' : 'piece_anterieure_a_l_ouverture',
        piece > fin
          ? `${mention}, comptabilisée dans l’exercice sur une pièce du ${piece} postérieure à la clôture : une charge ou un produit constaté d’avance est possible, mais la période couverte n’est pas connue. Fournir la période couverte de la ligne pour obtenir une proposition.`
          : `${mention}, comptabilisée dans l’exercice sur une pièce du ${piece} antérieure à l’ouverture : charge ou produit d’un exercice antérieur, aucune écriture d’inventaire de la clôture ne s’en déduit.`, src);
      continue;
    }
    if (premiere.ecritureDate < debut || !dansExercice(piece)) { sAbstenir('cesure', 'cas_non_traite', `${mention} sur une pièce du ${piece} : situation hors des cas traités (écriture postérieure à la clôture sur une pièce datée dans l’exercice).`, src); continue; }
    const ecriture = parEcriture.get(cle) ?? [];
    const idsEcriture = ecriture.map((l) => l.id);
    const srcEcriture = { constat: constat.cle, lignesEcritures: idsEcriture };
    const solde = (ls: readonly LigneEcriture[]): Decimal => ls.reduce((s, l) => s.plus(debitDe(l)).minus(creditDe(l)), ZERO);
    if (!solde(ecriture).isZero()) { sAbstenir('cesure', 'ecriture_desequilibree', `${mention} : écriture d’origine non équilibrée dans les données fournies.`, srcEcriture); continue; }
    const de = (f: (c: string) => boolean): LigneEcriture[] => ecriture.filter((l) => f(l.compteNum));
    const charges = de((c) => c.startsWith('6'));
    const produits = de((c) => c.startsWith('7'));
    const tvaDeductible = de((c) => c.startsWith('4456'));
    const tvaCollectee = de((c) => c.startsWith('4457'));
    const fournisseurs = de((c) => c.startsWith('40') && !c.startsWith('404') && !c.startsWith('405'));
    const clients = de((c) => c.startsWith('41'));
    const reconnues = new Set([...charges, ...produits, ...tvaDeductible, ...tvaCollectee, ...fournisseurs, ...clients]);
    const autres = ecriture.filter((l) => !reconnues.has(l));
    const estAchat = charges.length > 0 && produits.length === 0 && tvaCollectee.length === 0 && clients.length === 0 && fournisseurs.length > 0 && autres.length === 0;
    const estVente = produits.length > 0 && charges.length === 0 && tvaDeductible.length === 0 && fournisseurs.length === 0 && clients.length > 0 && autres.length === 0;
    if (!estAchat && !estVente) {
      sAbstenir('cesure', 'ecriture_non_reductible', `${mention} : l’écriture ne se réduit ni à « charges + TVA déductible + fournisseur » ni à « produits + TVA collectée + client » (comptes : ${[...new Set(ecriture.map((l) => l.compteNum))].sort().slice(0, 12).join(', ')}).`, srcEcriture);
      continue;
    }
    const type: TypePropositionInventaire = estAchat ? 'facture_non_parvenue' : 'facture_a_etablir';
    // Montants par compte, dans le sens naturel (charges et TVA déductible au débit ; produits et TVA collectée au crédit).
    const sens = estAchat ? 1 : -1;
    const parCompte = new Map<string, { lib: string; montant: Decimal }>();
    for (const l of estAchat ? charges : produits) {
      const c = parCompte.get(l.compteNum) ?? { lib: l.compteLib, montant: ZERO };
      c.montant = c.montant.plus(debitDe(l).minus(creditDe(l)).times(sens));
      parCompte.set(l.compteNum, c);
    }
    const tva = solde(estAchat ? tvaDeductible : tvaCollectee).times(sens);
    const horsTaxes = [...parCompte.values()].reduce((s, c) => s.plus(c.montant), ZERO);
    if ([...parCompte.values()].some((c) => c.montant.lessThan(0) || c.montant.isZero()) || tva.lessThan(0)) {
      sAbstenir(type, 'sens_inverse', `${mention} : un compte de ${estAchat ? 'charges' : 'produits'} ou de TVA est mouvementé en sens inverse (avoir ou annulation) : non traité.`, srcEcriture);
      continue;
    }
    const ttc = horsTaxes.plus(tva);
    const modele = (estAchat ? fournisseurs : clients)[0]?.compteNum ?? premiere.compteNum;
    const tiers = compteDe(estAchat ? 'facturesNonParvenues' : 'facturesAEtablir', modele);
    const compteTva = tva.isZero() ? null : compteDe(estAchat ? 'tvaSurFacturesNonParvenues' : 'tvaSurFacturesAEtablir', modele);
    const detail = [...parCompte.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([compteNum, c]) => ({ compteNum, libelle: c.lib, montant: c.montant }));
    const lignesProposees: Brouillon['lignes'] = estAchat
      ? [...detail.map((d) => ({ compteNum: d.compteNum, libelle: d.libelle, debit: d.montant, credit: ZERO })),
        ...(compteTva === null ? [] : [{ compteNum: compteTva.compte, libelle: 'Taxes sur le chiffre d’affaires sur factures non parvenues', debit: tva, credit: ZERO }]),
        { compteNum: tiers.compte, libelle: 'Fournisseurs - Factures non parvenues', debit: ZERO, credit: ttc }]
      : [{ compteNum: tiers.compte, libelle: 'Clients - Factures à établir', debit: ttc, credit: ZERO },
        ...detail.map((d) => ({ compteNum: d.compteNum, libelle: d.libelle, debit: ZERO, credit: d.montant })),
        ...(compteTva === null ? [] : [{ compteNum: compteTva.compte, libelle: 'Taxes sur le chiffre d’affaires sur factures à établir', debit: ZERO, credit: tva }])];
    const pieceRef = premiere.pieceRef === '' ? `${premiere.journalCode} ${premiere.ecritureNum}` : premiere.pieceRef;
    brouillons.push({
      id: `${estAchat ? 'INV-FNP' : 'INV-FAE'}|${premiere.journalCode}|${premiere.ecritureNum}|${premiere.ecritureDate}`,
      type, regleId: estAchat ? 'INV-FNP' : 'INV-FAE',
      signal: `Constat de césure ${constat.cle} : écriture du ${premiere.ecritureDate}, postérieure à la clôture, sur une pièce datée du ${piece}, dans l’exercice.`,
      libelle: `${estAchat ? 'Facture non parvenue' : 'Facture à établir'} - pièce ${pieceRef} du ${piece}`,
      justification: estAchat
        ? `La pièce est datée du ${piece}, dans l’exercice, mais la charge n’a été comptabilisée que le ${premiere.ecritureDate}, après la clôture du ${fin}. Si la livraison ou la prestation est bien intervenue avant la clôture, la charge est à rattacher à l’exercice par le compte 408 (PCG art. 1214-40).`
        : `La pièce est datée du ${piece}, dans l’exercice, mais le produit n’a été comptabilisé que le ${premiere.ecritureDate}, après la clôture du ${fin}. Si la livraison ou la prestation est bien intervenue avant la clôture, le produit est à rattacher à l’exercice par le compte 4181.`,
      calcul: [
        ...detail.map((d) => ({ libelle: `${estAchat ? 'Charge' : 'Produit'} hors taxes, compte ${d.compteNum}`, valeur: m2(d.montant) })),
        { libelle: 'Total hors taxes', valeur: m2(horsTaxes) },
        { libelle: `TVA de l’écriture d’origine (${estAchat ? 'comptes 4456' : 'comptes 4457'})`, valeur: m2(tva) },
        { libelle: 'Total toutes taxes comprises', valeur: `${m2(horsTaxes)} + ${m2(tva)} = ${m2(ttc)}` },
      ],
      lignes: lignesProposees, lignesSources: ecriture, constats: [constat.cle], immobilisation: null, extourne: true,
      impacts: estAchat
        ? { resultat: horsTaxes.negated(), totalActif: tva, totalPassif: tva, commentaire: 'Augmente les charges de l’exercice ; la dette fournisseurs augmente du montant toutes taxes comprises, l’actif de la TVA à régulariser.' }
        : { resultat: horsTaxes, totalActif: ttc, totalPassif: ttc, commentaire: 'Augmente les produits de l’exercice ; la créance clients augmente du montant toutes taxes comprises, le passif de la TVA à régulariser et du résultat.' },
      hypotheses: [
        'La date de pièce n’est qu’un indice : le rattachement à l’exercice dépend de la date de livraison ou d’exécution de la prestation, à vérifier sur la pièce.',
        'Les montants hors taxes et de TVA sont repris tels quels de l’écriture passée après la clôture.',
        'L’exigibilité et la déductibilité de la TVA à la clôture ne sont pas appréciées.',
        'L’écriture est à contre-passer à l’ouverture de l’exercice suivant ; si l’exercice suivant est déjà comptabilisé, l’écriture d’origine y fait double emploi avec la charge ou le produit rattaché tant que l’extourne n’est pas passée.',
        tiers.hypothese,
        ...(compteTva === null ? [] : [compteTva.hypothese]),
        ...dejaMouvemente(estAchat ? '408' : '418'),
      ],
    });
  }

  // ── 3. Dotations aux amortissements linéaires ──────────────────────────────────────────────
  const convention: ConventionJoursAmortissement = demande.options?.conventionJoursAmortissement ?? 'base_360';
  const idsImmobilisations = new Set<string>();
  for (const immo of demande.immobilisations ?? []) {
    const type = 'dotation_amortissement_lineaire' as const;
    const src = { immobilisation: immo.id };
    const mention = `Immobilisation ${immo.id}`;
    if (idsImmobilisations.has(immo.id)) { sAbstenir(type, 'immobilisation_en_double', `${mention} fournie plusieurs fois : seule la première occurrence est traitée.`, src); continue; }
    idsImmobilisations.add(immo.id);
    const manquantes = [immo.baseAmortissable === null || immo.baseAmortissable === undefined ? 'base amortissable' : null, immo.dateMiseEnService === null || immo.dateMiseEnService === undefined ? 'date de mise en service' : null, immo.dureeMois === null || immo.dureeMois === undefined ? 'durée d’amortissement' : null].filter((m): m is string => m !== null);
    if (manquantes.length > 0) { sAbstenir(type, 'donnee_manquante', `${mention} : ${manquantes.join(', ')} non fournie(s) : aucune dotation n’est estimée.`, src); continue; }
    const baseTexte = immo.baseAmortissable as string;
    const mes = immo.dateMiseEnService as string;
    const duree = immo.dureeMois as number;
    const anterieursTexte = immo.amortissementsAnterieurs ?? null;
    if (!estChaineDecimale(baseTexte) || !new Decimal(baseTexte).isPositive() || new Decimal(baseTexte).isZero()) { sAbstenir(type, 'donnee_invalide', `${mention} : base amortissable invalide (chaîne décimale strictement positive attendue).`, src); continue; }
    if (!estDateIso(mes)) { sAbstenir(type, 'donnee_invalide', `${mention} : date de mise en service invalide (date ISO AAAA-MM-JJ attendue).`, src); continue; }
    if (!Number.isInteger(duree) || duree < 1 || duree > 1200) { sAbstenir(type, 'donnee_invalide', `${mention} : durée invalide (nombre entier de mois de 1 à 1200 attendu).`, src); continue; }
    if (anterieursTexte !== null && (!estChaineDecimale(anterieursTexte) || new Decimal(anterieursTexte).lessThan(0))) { sAbstenir(type, 'donnee_invalide', `${mention} : amortissements antérieurs invalides (chaîne décimale positive ou nulle attendue).`, src); continue; }
    if (!estCompte(immo.compteImmobilisation)) { sAbstenir(type, 'donnee_invalide', `${mention} : compte d’immobilisation invalide.`, src); continue; }
    if (mes > fin) { sAbstenir(type, 'mise_en_service_posterieure', `${mention} : mise en service le ${mes}, après la clôture : aucune dotation sur l’exercice.`, src); continue; }
    // Comptes.
    const compteImmo = immo.compteImmobilisation;
    let compteAmortissement = immo.compteAmortissement;
    let compteDotation = immo.compteDotation;
    const hypothesesComptes: string[] = [];
    if (compteAmortissement === undefined) {
      if (!(compteImmo.startsWith('20') || compteImmo.startsWith('21'))) { sAbstenir(type, 'compte_a_fournir', `${mention} : le compte d’amortissement ne se déduit pas avec certitude du compte ${compteImmo} : fournir « compteAmortissement ».`, src); continue; }
      const derive = `28${compteImmo.slice(1)}`;
      // Même longueur que le compte d'immobilisation quand le dernier chiffre est un zéro de remplissage ; sinon un chiffre de plus.
      compteAmortissement = derive.endsWith('0') && compteImmo.length > 3 ? derive.slice(0, compteImmo.length) : derive;
      hypothesesComptes.push(`Compte d’amortissement ${compteAmortissement} déduit du compte ${compteImmo} (« même ventilation » que le compte d’immobilisation), à confirmer.`);
    }
    if (compteDotation === undefined) {
      if (!(compteImmo.startsWith('20') || compteImmo.startsWith('21'))) { sAbstenir(type, 'compte_a_fournir', `${mention} : le compte de dotation ne se déduit pas du compte ${compteImmo} : fournir « compteDotation ».`, src); continue; }
      const racine = compteImmo.startsWith('20') ? '68111' : '68112';
      compteDotation = racine.padEnd(Math.max(racine.length, compteImmo.length), '0');
      hypothesesComptes.push(`Compte de dotation ${compteDotation} construit à partir de la racine ${racine} du plan de comptes, à adapter au plan du dossier.`);
    }
    if (!estCompte(compteAmortissement) || !estCompte(compteDotation)) { sAbstenir(type, 'donnee_invalide', `${mention} : compte d’amortissement ou de dotation invalide.`, src); continue; }
    // Jours du plan et jours de l'exercice compris dans le plan.
    const base = new Decimal(baseTexte);
    let joursPlan: number;
    let consommesAvant: number;
    let consommesFin: number;
    let finPlan: string | null = null;
    if (convention === 'base_360') {
      joursPlan = duree * 30;
      consommesAvant = borner(rang360(debut) - rang360(mes), joursPlan);
      consommesFin = borner(rang360(fin) - rang360(mes) + 1, joursPlan);
    } else {
      finPlan = isoDepuisJours(joursDepuisEpoque(ajouterMois(mes, duree)) - 1);
      joursPlan = ecartEnJours(mes, finPlan) + 1;
      consommesAvant = borner(ecartEnJours(mes, debut), joursPlan);
      consommesFin = borner(ecartEnJours(mes, fin) + 1, joursPlan);
    }
    const joursExercice = consommesFin - consommesAvant;
    const theoriqueAnterieur = arrondi(base.times(consommesAvant).dividedBy(joursPlan));
    let dotation = arrondi(base.times(joursExercice).dividedBy(joursPlan));
    const calcul = [
      { libelle: 'Base amortissable', valeur: m2(base) },
      { libelle: 'Mise en service', valeur: mes },
      { libelle: 'Durée', valeur: `${duree} mois` },
      { libelle: 'Convention de décompte des jours', valeur: convention === 'base_360' ? 'année de 360 jours (mois de 30 jours)' : `jours réels (fin du plan le ${finPlan})` },
      { libelle: 'Jours du plan', valeur: String(joursPlan) },
      { libelle: 'Jours du plan écoulés avant l’ouverture de l’exercice', valeur: String(consommesAvant) },
      { libelle: 'Jours de l’exercice compris dans le plan', valeur: String(joursExercice) },
      { libelle: 'Formule', valeur: `${m2(base)} × ${joursExercice} ÷ ${joursPlan} = ${m2(dotation)}` },
    ];
    const hypotheses = [
      'Mode linéaire, sur la base, la date de mise en service et la durée fournies par le cabinet ; aucune dépréciation, cession ou révision du plan n’est prise en compte.',
      convention === 'base_360' ? 'Décompte des jours sur une année de 360 jours (convention interne, paramétrable).' : 'Décompte des jours en jours calendaires réels (convention interne, paramétrable).',
      ...hypothesesComptes,
    ];
    if (anterieursTexte === null) {
      if (joursExercice === 0) { sAbstenir(type, 'plan_acheve', `${mention} : le plan d’amortissement est achevé avant l’ouverture de l’exercice : aucune dotation.`, src); continue; }
      hypotheses.push(`Amortissements antérieurs non fournis : la dotation n’est pas rapprochée du cumul comptabilisé (cumul théorique à l’ouverture : ${m2(theoriqueAnterieur)}).`);
    } else {
      const anterieurs = new Decimal(anterieursTexte);
      const restant = base.minus(anterieurs);
      calcul.push({ libelle: 'Amortissements antérieurs fournis', valeur: m2(anterieurs) }, { libelle: 'Cumul théorique à l’ouverture', valeur: m2(theoriqueAnterieur) }, { libelle: 'Reste à amortir à l’ouverture', valeur: m2(restant) });
      if (!restant.isPositive() || restant.isZero()) { sAbstenir(type, 'totalement_amorti', `${mention} : les amortissements antérieurs fournis (${m2(anterieurs)}) atteignent ou dépassent la base (${m2(base)}) : aucune dotation.`, src); continue; }
      if (!anterieurs.equals(theoriqueAnterieur)) hypotheses.push(`Les amortissements antérieurs fournis (${m2(anterieurs)}) diffèrent du cumul théorique à l’ouverture (${m2(theoriqueAnterieur)}) : le plan fourni et le plan comptabilisé sont à rapprocher.`);
      if (consommesFin === joursPlan && joursExercice > 0) {
        dotation = restant;
        calcul.push({ libelle: 'Le plan s’achève dans l’exercice : dotation = reste à amortir', valeur: m2(dotation) });
      } else if (dotation.greaterThan(restant)) {
        dotation = restant;
        calcul.push({ libelle: 'Dotation plafonnée au reste à amortir', valeur: m2(dotation) });
      } else if (joursExercice === 0) { sAbstenir(type, 'plan_acheve', `${mention} : le plan d’amortissement fourni est achevé avant l’ouverture de l’exercice alors qu’il reste ${m2(restant)} à amortir : plan à revoir, aucune dotation n’est proposée.`, src); continue; }
    }
    if (dotation.isZero()) { sAbstenir(type, 'montant_nul', `${mention} : dotation nulle après arrondi.`, src); continue; }
    calcul.push({ libelle: 'Dotation de l’exercice', valeur: m2(dotation) });
    brouillons.push({
      id: `INV-AMORT|${immo.id}`, type, regleId: 'INV-AMORT',
      signal: `Données d’amortissement fournies par le cabinet pour l’immobilisation ${immo.id} (compte ${compteImmo}).`,
      libelle: `Dotation aux amortissements - immobilisation ${immo.id}`,
      justification: `Une dotation est comptabilisée à la clôture conformément au plan d’amortissement de chaque actif amortissable ; l’amortissement commence à la mise en service (${mes}) et le mode linéaire s’applique à défaut de mode mieux adapté (PCG art. 214-11 à 214-13).`,
      calcul, lignesSources: [], constats: [], immobilisation: immo.id, hypotheses, extourne: false,
      lignes: [{ compteNum: compteDotation, libelle: 'Dotations aux amortissements sur immobilisations', debit: dotation, credit: ZERO }, { compteNum: compteAmortissement, libelle: `Amortissements - ${immo.libelle}`.slice(0, 120), debit: ZERO, credit: dotation }],
      impacts: { resultat: dotation.negated(), totalActif: dotation.negated(), totalPassif: dotation.negated(), commentaire: 'Augmente les charges de l’exercice ; diminue l’actif net immobilisé et, par le résultat, le passif.' },
    });
  }

  // ── Finalisation : équilibre vérifié, tri déterministe ─────────────────────────────────────
  const ORDRE: TypePropositionInventaire[] = ['charge_constatee_avance', 'produit_constate_avance', 'facture_non_parvenue', 'facture_a_etablir', 'dotation_amortissement_lineaire'];
  const propositions: PropositionEcritureInventaire[] = [];
  for (const b of brouillons) {
    const totalDebit = b.lignes.reduce((s, l) => s.plus(l.debit), ZERO);
    const totalCredit = b.lignes.reduce((s, l) => s.plus(l.credit), ZERO);
    if (!totalDebit.equals(totalCredit) || totalDebit.isZero() || b.lignes.some((l) => l.debit.lessThan(0) || l.credit.lessThan(0))) {
      sAbstenir(b.type, 'proposition_desequilibree', `Proposition ${b.id} écartée : débit ${m2(totalDebit)} différent du crédit ${m2(totalCredit)}, ou montant négatif.`, { lignesEcritures: b.lignesSources.map((l) => l.id), immobilisation: b.immobilisation });
      continue;
    }
    const r = regle(b.regleId);
    const ecritures = new Map<string, { journalCode: string; ecritureNum: string; ecritureDate: string }>();
    for (const l of b.lignesSources) ecritures.set(cleEcriture(l), { journalCode: l.journalCode, ecritureNum: l.ecritureNum, ecritureDate: l.ecritureDate });
    propositions.push({
      id: b.id, type: b.type, statut: 'proposee', dateEcriture: fin, libelle: b.libelle,
      origine: { regle: r.id, versionRegle: r.version, signal: b.signal },
      justification: b.justification, calcul: b.calcul,
      lignes: b.lignes.map((l) => ({ compteNum: l.compteNum, libelle: l.libelle, debit: m2(l.debit), credit: m2(l.credit) })),
      totalDebit: m2(totalDebit), totalCredit: m2(totalCredit), equilibree: true,
      sources: { lignesEcritures: b.lignesSources.map((l) => l.id), ecritures: [...ecritures.values()], pieces: [...new Set(b.lignesSources.map((l) => l.pieceRef).filter((p) => p !== ''))], constats: b.constats, immobilisation: b.immobilisation },
      impacts: { resultat: m2(b.impacts.resultat), totalActif: m2(b.impacts.totalActif), totalPassif: m2(b.impacts.totalPassif), commentaire: b.impacts.commentaire },
      hypotheses: [...b.hypotheses, 'Proposition non comptabilisée : elle n’a d’effet qu’après approbation par un réviseur.'],
      extourneLe: b.extourne ? ouvertureSuivante : null,
      source: r.source,
    });
  }
  propositions.sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cumul = (f: (p: PropositionEcritureInventaire) => string): ChaineDecimale => m2(propositions.reduce((s, p) => s.plus(new Decimal(f(p))), ZERO));
  return {
    statut: 'projet',
    mention: MENTION_PROJET,
    exercice: { debut, fin },
    propositions,
    abstentions,
    regles: [...REGLES_INVENTAIRE],
    conventions: [...CONVENTIONS_INVENTAIRE],
    totaux: { nbPropositions: propositions.length, nbAbstentions: abstentions.length, impactResultat: cumul((p) => p.impacts.resultat), impactTotalActif: cumul((p) => p.impacts.totalActif), impactTotalPassif: cumul((p) => p.impacts.totalPassif) },
  };
}
