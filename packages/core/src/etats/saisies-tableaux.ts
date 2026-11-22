/**
 * Tableaux de la liasse servis par SAISIE LIGNE PAR LIGNE (D-112, D-113) : cadre III du 2033-C (cessions d'immobilisations, plus-values et
 * moins-values), tableau 2054 bis (écarts de réévaluation des immobilisations amortissables, cadres A et B) et tableau 2055 cadres B
 * (amortissements dérogatoires) et C (charges réparties sur plusieurs exercices).
 *
 * Principes (mêmes que D-106, D-110) :
 *  - la balance ne porte ni le détail des cessions ni les écarts de réévaluation : le cabinet SAISIT chaque ligne, avec une justification
 *    obligatoire ; la saisie est tracée (auteur, date, version des données) et historisée ; « à revoir » quand les données changent ;
 *  - une ligne non saisie n'est jamais présumée nulle : « néant » est une déclaration explicite du tableau entier (ligne NEANT) ;
 *    sans ligne ni néant, les totaux sont en ABSTENTION motivée, sans chiffre ;
 *  - seul le calcul que le FORMULAIRE porte lui-même est fait : cadre III : valeur résiduelle = valeur d'actif − amortissements (col. 3),
 *    plus ou moins-value = prix de cession − valeur résiduelle, placée dans la colonne du régime d'imposition choisi par le cabinet (court
 *    terme, 19 %, 15 % ou 12,8 %, 0 %), totaux de colonnes, totaux avec régularisations ; 2054 bis : écart = col. 1 − col. 2 (cadre A), col. 6 =
 *    (col. 1 − col. 2) − col. 5, totaux de colonnes (ligne 10), cadre B ligne 3 = ligne 1 − ligne 2 ;
 *  - AUCUNE décision fiscale : le régime d'imposition d'une plus-value (court ou long terme, taux) est choisi par le cabinet, jamais déduit ;
 *  - statut « projet », jamais « complet », aucune transmission, aucune validation professionnelle.
 *
 * Cases du cadre III (2033-C-SD, millésime 2026) : lues sur `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), vérifiées sur le rendu image le 2026-11-21 :
 * ligne « Total » 578 (valeur d'actif), 580 (amortissements), 582 (valeur résiduelle), 584 (prix de cession), 586 (court terme), 581 (long terme
 * 19 %), 587 (15 % ou 12,8 %), 589 (0 %) ; 579 (plus-values taxables à 19 %) ; régularisations 590, 583, 594, 595 ; TOTAL 596, 585, 597, 599.
 * Le tableau 2054 bis-SD (`2050-liasse_5320.pdf`, page 6) n'a pas de code de case : les colonnes sont numérotées ① à ⑥.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, estChaineDecimale, versChaine } from '../montant.js';
import type { Balance } from './types.js';
import { type ControleDetail, type EtatCodeCase } from './detail-resultat.js';
import { type ImpotSurLeResultat, type LiasseAbstention, PERIMETRE_LIASSE, type RegimeLiasse, type TerritoireFiscal, motifsAbstention } from './liasse.js';
import { descriptionLigneGrille } from './formulaire-grilles.js';
import { descriptionLigneSaisieImmobilisations } from './tableaux-immobilisations.js';
import { MENTION_PROJET } from './sources-fiscales.js';

const ZERO = new Decimal(0);

export type TableauSaisi = '2033C_III' | '2054BIS_A' | '2054BIS_B' | '2055_B' | '2055_C' | '2033D_C' | '2033F_NB' | '2033F_PM' | '2033F_PP' | '2033G_NB' | '2033G_FIL' | '2059A_IM' | '2059A_AUT' | '2059B_A' | '2059B_B' | '2059C_I' | '2059C_II' | '2059D_I' | '2059D_II' | '2065_C1' | '2065_C2' | '2065_C3' | '2065_C4' | '2065_F' | '2065_I' | '2065_D' | '2065_E' | '2033E_DATES' | '2057_A' | '2057_AX' | '2057_B' | '2057_BX' | '2065B_G' | '2065B_H' | '2065B_I' | '2065B_J1' | '2065B_J2' | '2065B_K' | '2033D_982' | '2058B_K4BIS' | '2058A_REINT' | '2058A_DEDUC' | 'IMMO_CELL' | '2053_D7' | '2053_D8' | '2065_X' | '2065_T' | '2058B_NAT' | '2058B_COMP' | '2065_ID' | '2065_IDG' | '2056_F_HPX' | '2056_F_APR' | '2056_F_IMP' | '2056_F_ARC' | '2056_F_AIF' | '2056_F_ADE' | '2057_F_PRET' | '2057_F_EMPR';
export const TABLEAUX_SAISIS: readonly TableauSaisi[] = ['2033C_III', '2054BIS_A', '2054BIS_B', '2055_B', '2055_C', '2033D_C', '2033F_NB', '2033F_PM', '2033F_PP', '2033G_NB', '2033G_FIL', '2059A_IM', '2059A_AUT', '2059B_A', '2059B_B', '2059C_I', '2059C_II', '2059D_I', '2059D_II', '2065_C1', '2065_C2', '2065_C3', '2065_C4', '2065_F', '2065_I', '2065_D', '2065_E', '2033E_DATES', '2057_A', '2057_AX', '2057_B', '2057_BX', '2065B_G', '2065B_H', '2065B_I', '2065B_J1', '2065B_J2', '2065B_K', '2033D_982', '2058B_K4BIS', '2058A_REINT', '2058A_DEDUC', 'IMMO_CELL', '2053_D7', '2053_D8', '2065_X', '2065_T', '2058B_NAT', '2058B_COMP', '2065_ID', '2065_IDG', '2056_F_HPX', '2056_F_APR', '2056_F_IMP', '2056_F_ARC', '2056_F_AIF', '2056_F_ADE', '2057_F_PRET', '2057_F_EMPR'];

export interface SaisieTableau {
  tableau: TableauSaisi;
  /** 01 à 10 (lignes), REG (régularisations), PV19 (case 579), NEANT (tableau déclaré néant), B1, B2 (cadre B du 2054 bis). */
  ligne: string;
  valeurs: Record<string, string>;
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}

export type ClassementPlusValue = 'court_terme' | 'long_terme_19' | 'long_terme_15_12_8' | 'long_terme_0';
export const CLASSEMENTS: readonly ClassementPlusValue[] = ['court_terme', 'long_terme_19', 'long_terme_15_12_8', 'long_terme_0'];
const COLONNE_CLASSEMENT: Record<ClassementPlusValue, 'c5' | 'c6' | 'c7' | 'c8'> = { court_terme: 'c5', long_terme_19: 'c6', long_terme_15_12_8: 'c7', long_terme_0: 'c8' };
export const LIBELLE_CLASSEMENT: Record<ClassementPlusValue, string> = {
  court_terme: 'Court terme (colonne 5)',
  long_terme_19: 'Long terme à 19 % (colonne 6)',
  long_terme_15_12_8: 'Long terme à 15 % ou 12,8 % (colonne 7)',
  long_terme_0: 'Long terme à 0 % (colonne 8)',
};

// ── Validation d'une saisie (utilisée par l'API : un refus = 400) ───────────────────────────────────────────────────────────

const POSITIFS_III = ['valeurActif', 'amortissements', 'prixCession'] as const;
const COLONNES_BIS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

/** Erreurs d'une saisie (liste vide = valide). Ne dit rien de la justesse fiscale, seulement de la forme. */
export function validerSaisieTableau(tableau: string, ligne: string, valeurs: unknown): string[] {
  const e: string[] = [];
  if (!(TABLEAUX_SAISIS as readonly string[]).includes(tableau)) return [`Tableau inconnu : ${tableau}`];
  if (valeurs === null || typeof valeurs !== 'object' || Array.isArray(valeurs)) return ['Les valeurs doivent former un objet.'];
  const v = valeurs as Record<string, unknown>;
  const decimal = (cle: string, positif: boolean) => {
    const x = v[cle];
    if (typeof x !== 'string' || !estChaineDecimale(x)) e.push(`${cle} : montant décimal attendu (« 1234.56 »).`);
    else if (positif && new Decimal(x).isNegative()) e.push(`${cle} : montant positif attendu (le sens est celui du formulaire).`);
  };
  const exactement = (cles: readonly string[]) => {
    for (const k of Object.keys(v)) if (!cles.includes(k)) e.push(`${k} : champ inconnu pour cette ligne.`);
    for (const k of cles) if (!(k in v)) e.push(`${k} : champ obligatoire.`);
  };
  if (tableau === '2033C_III') {
    if (/^(0[1-9]|[12][0-9]|30)$/.test(ligne)) {
      exactement(['nature', ...POSITIFS_III, 'classement']);
      if (typeof v.nature !== 'string' || v.nature.trim().length < 2 || v.nature.length > 200) e.push('nature : libellé de 2 à 200 caractères.');
      for (const k of POSITIFS_III) decimal(k, true);
      if (!(CLASSEMENTS as readonly unknown[]).includes(v.classement)) e.push(`classement : l'une des valeurs ${CLASSEMENTS.join(', ')}.`);
    } else if (ligne === 'REG') {
      exactement(['c5', 'c6', 'c7', 'c8']);
      for (const k of ['c5', 'c6', 'c7', 'c8']) decimal(k, false); // une régularisation peut être négative
    } else if (ligne === 'PV19') {
      exactement(['montant']);
      decimal('montant', true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le cadre III : ${ligne}.`);
  } else if (tableau === '2054BIS_A') {
    if (/^(0[1-9])$/.test(ligne)) {
      exactement([...COLONNES_BIS]);
      for (const k of COLONNES_BIS) decimal(k, true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le cadre A du 2054 bis : ${ligne}.`);
  } else if (tableau === '2055_B') {
    if (/^(0[1-9]|1[0-2])$/.test(ligne)) {
      exactement(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
      for (const k of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) decimal(k, true);
    } else if (ligne === '13') {
      exactement(['c1', 'c4']); // frais d'acquisition de titres de participation : colonnes 1 et 4 seulement (notice 2032-NOT-SD)
      for (const k of ['c1', 'c4']) decimal(k, true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le cadre B du 2055 : ${ligne}.`);
  } else if (tableau === '2055_C') {
    if (ligne === '01' || ligne === '02') {
      exactement(['debut', 'augmentations', 'dotations']);
      for (const k of ['debut', 'augmentations', 'dotations']) decimal(k, true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le cadre C du 2055 : ${ligne}.`);
  } else if (tableau === '2033D_C') {
    if (/^(0[1-9]|1[0-9]|20)$/.test(ligne)) {
      exactement(['nature', 'montant']);
      if (typeof v.nature !== 'string' || v.nature.trim().length < 2 || v.nature.length > 200) e.push('nature : libellé de 2 à 200 caractères.');
      decimal('montant', true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le cadre C du 2033-D : ${ligne}.`);
  } else if (tableau === '2033F_NB') {
    if (ligne === 'NB') {
      exactement(['c901', 'c902', 'c903', 'c904']);
      for (const k of ['c901', 'c902', 'c903', 'c904']) decimal(k, true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le tableau 2033-F : ${ligne}.`);
  } else if (tableau === '2033F_PM' || tableau === '2033F_PP') {
    const pm = tableau === '2033F_PM';
    const maxLigne = pm ? CAPACITES_LIGNES.associesPM.max : CAPACITES_LIGNES.associesPP.max;
    if (/^(0[1-9]|1[0-9]|20)$/.test(ligne) && Number(ligne) <= maxLigne) {
      const textes = pm ? ['formeJuridique', 'denomination', 'siren', 'adresseNumero', 'adresseVoie', 'codePostal', 'commune', 'pays'] : ['titre', 'nomFamille', 'nomUsage', 'prenoms', 'naissanceDate', 'naissanceDepartement', 'naissanceCommune', 'naissancePays', 'adresseNumero', 'adresseVoie', 'codePostal', 'commune', 'pays'];
      exactement([...textes, 'pourcentage', 'parts']);
      for (const k of textes) if (typeof v[k] !== 'string' || (v[k] as string).length > 200) e.push(`${k} : texte de 200 caractères au plus (peut être vide si l'information n'existe pas).`);
      const obligatoire = pm ? 'denomination' : 'nomFamille';
      if (typeof v[obligatoire] !== 'string' || (v[obligatoire] as string).trim().length < 1) e.push(`${obligatoire} : obligatoire.`);
      if (pm && typeof v.siren === 'string' && v.siren !== '' && !/^\d{9}$/.test(v.siren)) e.push('siren : 9 chiffres ou vide (société non établie en France).');
      if (!pm && v.titre !== 'M' && v.titre !== 'MME') e.push('titre : « M » ou « MME » (formulaire, renvoi 2).');
      if (!pm && typeof v.naissanceDate === 'string' && v.naissanceDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v.naissanceDate)) e.push('naissanceDate : AAAA-MM-JJ ou vide.');
      decimal('pourcentage', true);
      if (typeof v.pourcentage === 'string' && estChaineDecimale(v.pourcentage) && new Decimal(v.pourcentage).greaterThan(100)) e.push('pourcentage : au plus 100.');
      decimal('parts', true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le tableau 2033-F : ${ligne}.`);
  } else if (tableau === '2033G_NB') {
    if (ligne === 'NB') {
      exactement(['c905']);
      decimal('c905', true);
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le tableau 2033-G : ${ligne}.`);
  } else if (tableau === '2033G_FIL') {
    if (/^(0[1-9]|[12][0-9]|30)$/.test(ligne)) {
      const textes = ['formeJuridique', 'denomination', 'siren', 'adresseNumero', 'adresseVoie', 'codePostal', 'commune', 'pays'];
      exactement([...textes, 'pourcentage']);
      for (const k of textes) if (typeof v[k] !== 'string' || (v[k] as string).length > 200) e.push(`${k} : texte de 200 caractères au plus (peut être vide si l'information n'existe pas).`);
      if (typeof v.denomination !== 'string' || v.denomination.trim().length < 1) e.push('denomination : obligatoire.');
      if (typeof v.siren === 'string' && v.siren !== '' && !/^\d{9}$/.test(v.siren)) e.push('siren : 9 chiffres ou vide (société non établie en France).');
      decimal('pourcentage', true);
      if (typeof v.pourcentage === 'string' && estChaineDecimale(v.pourcentage) && new Decimal(v.pourcentage).greaterThan(100)) e.push('pourcentage : au plus 100.');
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le tableau 2033-G : ${ligne}.`);
  } else if (tableau === '2059A_IM') {
    if (/^(0[1-9]|1[0-2])$/.test(ligne)) {
      const champs = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10a', 'c10b', 'c10c', 'c11'];
      for (const k of Object.keys(v)) if (k !== 'nature' && !champs.includes(k)) e.push(`${k} : champ inconnu pour cette ligne.`);
      if (typeof v.nature !== 'string' || v.nature.trim().length < 2 || v.nature.length > 200) e.push('nature : libellé de 2 à 200 caractères (nature et date d’acquisition).');
      const presents = champs.filter((k) => k in v);
      if (presents.length === 0) e.push('Au moins une colonne doit être renseignée (une case vide du formulaire n’est pas un zéro).');
      for (const k of presents) decimal(k, ['c2', 'c3', 'c4', 'c5', 'c7'].includes(k));
    } else if (ligne === 'NEANT') exactement([]);
    else e.push(`Ligne inconnue pour le tableau 2059-A : ${ligne}.`);
  } else if (tableau === '2059A_AUT') {
    const colonnes: Record<string, string[]> = { '13': ['c9'], '14': ['c9'], '15': ['c9'], '16': ['c9'], '18': ['c10a', 'c10b', 'c10c'], '19': ['c10a', 'c10b', 'c10c'], '20': ['c9', 'c10a', 'c10b', 'c10c', 'c11'] };
    const permis = colonnes[ligne];
    if (permis !== undefined) {
      for (const k of Object.keys(v)) if (!permis.includes(k)) e.push(`${k} : colonne non servie sur la ligne ${ligne} du formulaire.`);
      const presents = permis.filter((k) => k in v);
      if (presents.length === 0) e.push('Au moins une colonne doit être renseignée (zéro compris).');
      for (const k of presents) decimal(k, ligne !== '20');
    } else e.push(`Ligne inconnue pour la rubrique II du 2059-A : ${ligne}.`);
  } else if (descriptionLigneGrille(tableau, ligne) !== null) {
    const d = descriptionLigneGrille(tableau, ligne);
    if (d === 'neant') exactement([]);
    else if (d === 'inconnue' || d === null) e.push(`Ligne inconnue pour le tableau ${tableau} : ${ligne}.`);
    else {
      exactement(d.libre ? ['origine', ...d.colonnes] : d.colonnes);
      if (d.libre && (typeof v.origine !== 'string' || v.origine.trim().length < 2 || v.origine.length > 200)) e.push('origine : libellé de 2 à 200 caractères.');
      const t = typeof v.t === 'string' ? v.t.trim() : '';
      if (((tableau === '2065_ID' && ligne === 'SIRET') || (tableau === '2065_IDG' && ligne === 'MERESIR')) && t !== '' && !/^\d{14}$/.test(t)) e.push('t : SIRET de 14 chiffres, sans espace.');
      if (tableau === '2065_ID' && ligne === 'MEL' && t !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) e.push('t : adresse électronique valide attendue.');
      for (const k of d.colonnes) {
        if (d.booleens.includes(k)) {
          if (v[k] !== 'oui' && v[k] !== 'non') e.push(`${k} : « oui » ou « non » attendu.`);
        } else if (d.textes.includes(k)) {
          const x = v[k];
          if (typeof x !== 'string' || x.trim().length < 1 || x.length > 500) e.push(`${k} : texte de 1 à 500 caractères.`);
        } else if (d.annees.includes(k)) {
          const x = v[k];
          if (typeof x !== 'string' || !/^\d{4}$/.test(x) || Number(x) < 1900 || Number(x) > 2100) e.push(`${k} : année sur quatre chiffres (1900 à 2100).`);
        } else if (d.dates.includes(k)) {
          const x = v[k];
          if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(`${x}T00:00:00Z`)) || new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) !== x) e.push(`${k} : date AAAA-MM-JJ valide attendue.`);
        } else decimal(k, !d.signees.includes(k));
      }
    }
  } else if (tableau === 'IMMO_CELL') {
    const d = descriptionLigneSaisieImmobilisations(ligne);
    if (d === null) e.push(`Ligne inconnue pour les cellules d'immobilisations : ${ligne}.`);
    else {
      const permises = d.colonnes.map((c) => c.cle);
      for (const k of Object.keys(v)) if (!permises.includes(k)) e.push(`${k} : colonne non saisissable sur cette ligne.`);
      const presentes = permises.filter((k) => k in v);
      if (presentes.length === 0) e.push('Au moins une cellule doit être renseignée (zéro compris).');
      for (const k of presentes) decimal(k, true);
    }
  } else if (tableau === '2054BIS_B') {
    if (ligne === 'B1' || ligne === 'B2') {
      exactement(['montant']);
      decimal('montant', true);
    } else e.push(`Ligne inconnue pour le cadre B du 2054 bis : ${ligne}.`);
  }
  return e;
}

// ── Résultats ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StatutLigneSaisie = 'a_saisir' | 'saisi' | 'a_revoir';

export interface TraceSaisie {
  note: string;
  qualifieePar: string;
  le: string;
  versionDonnees: number;
}

export type CelluleMontant = { statut: 'etabli'; montant: ChaineDecimale; codeCase: string | null; etatCodeCase: EtatCodeCase } | { statut: 'abstention'; motifs: string[]; codeCase: string | null; etatCodeCase: EtatCodeCase };

/** Numéros de ligne « 01 », « 02 »… jusqu'à `n` (inclus). */
export const lignesNumerotees = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, '0'));
/**
 * Capacités (D-128) : lignes du FORMULAIRE, puis lignes d'« état joint » (même modèle, feuillet supplémentaire exigé au-delà) jusqu'au maximum accepté.
 * Les lignes au-delà de la capacité du formulaire sont saisies, justifiées et historisées comme les autres, et comptées dans les totaux.
 */
export const CAPACITES_LIGNES = {
  cessions: { formulaire: 10, max: 30 },
  cadreC2033D: { formulaire: 7, max: 20 },
  filiales: { formulaire: 7, max: 30 },
  associesPM: { formulaire: 4, max: 20 },
  associesPP: { formulaire: 2, max: 20 },
} as const;
export const LIGNES_CESSIONS = lignesNumerotees(CAPACITES_LIGNES.cessions.max);

export interface LigneCession {
  ligne: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  nature: string | null;
  valeurActif: ChaineDecimale | null;
  amortissements: ChaineDecimale | null;
  /** Calculée par le formulaire : valeur d'actif − amortissements (colonne 3). */
  valeurResiduelle: ChaineDecimale | null;
  prixCession: ChaineDecimale | null;
  classement: ClassementPlusValue | null;
  /** Calculée par le formulaire : prix de cession − valeur résiduelle, signée (plus-value > 0, moins-value < 0). */
  plusOuMoinsValue: ChaineDecimale | null;
  /** Colonne (5 à 8) qui reçoit la plus ou moins-value, selon le classement choisi par le cabinet. */
  colonnePlusValue: 'c5' | 'c6' | 'c7' | 'c8' | null;
}

export interface CadreIIIProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneCession[];
  /** Ligne « Total » : 578, 580, 582, 584, 586, 581, 587, 589. */
  totaux: { valeurActif: CelluleMontant; amortissements: CelluleMontant; valeurResiduelle: CelluleMontant; prixCession: CelluleMontant; c5: CelluleMontant; c6: CelluleMontant; c7: CelluleMontant; c8: CelluleMontant };
  /** Case 579 : plus-values taxables à 19 % (1), saisie. */
  plusValues19: { statut: StatutLigneSaisie; montant: ChaineDecimale | null; trace: TraceSaisie | null; codeCase: string };
  /** Régularisations 590, 583, 594, 595 (saisie, signées). */
  regularisations: { statut: StatutLigneSaisie; trace: TraceSaisie | null; c5: ChaineDecimale | null; c6: ChaineDecimale | null; c7: ChaineDecimale | null; c8: ChaineDecimale | null; codes: { c5: string; c6: string; c7: string; c8: string } };
  /** Ligne TOTAL : 596, 585, 597, 599 = total de la colonne + régularisation. */
  totalGeneral: { c5: CelluleMontant; c6: CelluleMontant; c7: CelluleMontant; c8: CelluleMontant };
  controles: ControleDetail[];
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}

export interface LigneEcartReevaluation {
  ligne: string;
  libelle: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  /** ① augmentation du montant brut ; ② augmentation des amortissements ; ③ suppléments d'amortissement ; ④ fraction résiduelle (éléments cédés) ; ⑤ montant cumulé. */
  c1: ChaineDecimale | null;
  c2: ChaineDecimale | null;
  c3: ChaineDecimale | null;
  c4: ChaineDecimale | null;
  c5: ChaineDecimale | null;
  /** Écart (col. 1 − col. 2), calculé. */
  ecart: ChaineDecimale | null;
  /** ⑥ provision spéciale en fin d'exercice = (col. 1 − col. 2) − col. 5, calculée. */
  c6: ChaineDecimale | null;
}

export const LIBELLES_2054_BIS: Record<string, string> = {
  '01': 'Concessions, brevets et droits similaires',
  '02': 'Fonds commercial',
  '03': 'Terrains',
  '04': 'Constructions',
  '05': 'Installations techniques, matériel et outillage industriels',
  '06': 'Autres immobilisations corporelles',
  '07': 'Immobilisations en cours',
  '08': 'Participations',
  '09': 'Autres titres immobilisés',
};

export interface EcartsReevaluationProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneEcartReevaluation[];
  /** Ligne 10 « TOTAUX » : somme des lignes saisies, colonnes ①, ②, ③, ④, ⑤ et ⑥. */
  totaux: { c1: CelluleMontant; c2: CelluleMontant; c3: CelluleMontant; c4: CelluleMontant; c5: CelluleMontant; c6: CelluleMontant };
  /** Cadre B : 1 fraction au début, 2 fraction rattachée au résultat, 3 = 1 − 2 (calculée). */
  cadreB: { b1: { statut: StatutLigneSaisie; montant: ChaineDecimale | null; trace: TraceSaisie | null }; b2: { statut: StatutLigneSaisie; montant: ChaineDecimale | null; trace: TraceSaisie | null }; b3: CelluleMontant };
  controles: ControleDetail[];
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}

// ── 2055, cadre B : amortissements dérogatoires ─────────────────────────────────────────────────────────────────────────────

/** Lignes du cadre B du 2055-SD (ordre du formulaire) et leurs cases (colonnes 1 à 7), lues sur 2050-liasse_5320.pdf page 7, vérifiées sur le rendu image. */
export const LIGNES_2055_B: ReadonlyArray<{ ligne: string; libelle: string; groupe: 'I' | 'II' | 'III'; cases: readonly string[] }> = [
  { ligne: '01', libelle: 'Frais d’établissement', groupe: 'I', cases: ['M9', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6'] },
  { ligne: '02', libelle: 'Fonds commercial', groupe: 'I', cases: ['RP', 'RQ', 'RR', 'RS', 'RT', 'RU', 'RV'] },
  { ligne: '03', libelle: 'Autres immobilisations incorporelles', groupe: 'I', cases: ['N7', 'N8', 'P6', 'P7', 'P8', 'P9', 'Q1'] },
  { ligne: '04', libelle: 'Terrains', groupe: 'II', cases: ['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'] },
  { ligne: '05', libelle: 'Constructions : sur sol propre', groupe: 'II', cases: ['Q9', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'] },
  { ligne: '06', libelle: 'Constructions : sur sol d’autrui', groupe: 'II', cases: ['R7', 'R8', 'R9', 'S1', 'S2', 'S3', 'S4'] },
  { ligne: '07', libelle: 'Constructions : installations générales, agencements, aménagements divers', groupe: 'II', cases: ['S5', 'S6', 'S7', 'S8', 'S9', 'T1', 'T2'] },
  { ligne: '08', libelle: 'Installations techniques, matériel et outillage industriels', groupe: 'II', cases: ['T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'] },
  { ligne: '09', libelle: 'Autres immobilisations corporelles : installations générales, agencements, aménagements divers', groupe: 'II', cases: ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7'] },
  { ligne: '10', libelle: 'Autres immobilisations corporelles : matériel de transport', groupe: 'II', cases: ['U8', 'U9', 'V1', 'V2', 'V3', 'V4', 'V5'] },
  { ligne: '11', libelle: 'Autres immobilisations corporelles : matériel de bureau et informatique, mobilier', groupe: 'II', cases: ['V6', 'V7', 'V8', 'V9', 'W1', 'W2', 'W3'] },
  { ligne: '12', libelle: 'Autres immobilisations corporelles : emballages récupérables et divers', groupe: 'II', cases: ['W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'X1'] },
  { ligne: '13', libelle: 'Frais d’acquisition de titres de participation (colonnes 1, 4 et 7 seulement)', groupe: 'III', cases: ['NL', '', '', 'NM', '', '', 'NO'] },
];
/** Totaux du cadre B : TOTAL I, TOTAL II, TOTAL III (cases NL, NM, NO), Total général (I + II + III) NP à NV. */
const CASES_TOTAL_2055_B = {
  I: ['RW', 'RX', 'RY', 'RZ', 'SB', 'SC', 'SD'],
  II: ['X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8'],
  III: ['NL', '', '', 'NM', '', '', 'NO'],
  general: ['NP', 'NQ', 'NR', 'NS', 'NT', 'NU', 'NV'],
} as const;
export const LIBELLES_COLONNES_2055_B = [
  'Dotations : différentiel de durée et autres (col. 1)',
  'Dotations : mode dégressif (col. 2)',
  'Dotations : amortissement fiscal exceptionnel (col. 3)',
  'Reprises : différentiel de durée et autres (col. 4)',
  'Reprises : mode dégressif (col. 5)',
  'Reprises : amortissement fiscal exceptionnel (col. 6)',
  'Mouvement net des amortissements à la fin de l’exercice (col. 7)',
] as const;

export interface CelluleCase {
  /** Case du formulaire ; null quand la cellule n'en porte pas. */
  codeCase: string | null;
  montant: ChaineDecimale | null;
}
export interface LigneDerogatoire {
  ligne: string;
  libelle: string;
  groupe: 'I' | 'II' | 'III';
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  /** Sept colonnes : 1 à 6 saisies, 7 = (col. 1 + 2 + 3) − (col. 4 + 5 + 6), calculée (notice 2032-NOT-SD) ; vide pour les colonnes sans objet (ligne 13). */
  colonnes: Array<CelluleCase | null>;
}
export interface AmortissementsDerogatoiresProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneDerogatoire[];
  /** TOTAL I, II, III et Total général : sept colonnes, somme des lignes saisies. */
  totaux: { I: Array<CelluleMontant | null>; II: Array<CelluleMontant | null>; III: Array<CelluleMontant | null>; general: Array<CelluleMontant | null> };
  /** Total général non ventilé : NW (dotations NP + NQ + NR), NY (reprises NS + NT + NU), NZ (NW − NY). */
  nonVentile: { NW: CelluleMontant; NY: CelluleMontant; NZ: CelluleMontant };
  controles: ControleDetail[];
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}

// ── 2055, cadre C : charges réparties sur plusieurs exercices ───────────────────────────────────────────────────────────────

export const LIGNES_2055_C: ReadonlyArray<{ ligne: string; libelle: string; caseDotations: string; caseFin: string; compteControle: string; libelleCompte: string }> = [
  { ligne: '01', libelle: 'Frais d’émission d’emprunt à étaler', caseDotations: 'Z9', caseFin: 'Z8', compteControle: '481', libelleCompte: 'charges à répartir sur plusieurs exercices' },
  { ligne: '02', libelle: 'Primes de remboursement des obligations', caseDotations: 'SP', caseFin: 'SR', compteControle: '169', libelleCompte: 'primes de remboursement des obligations' },
];
export interface LigneChargeRepartie {
  ligne: string;
  libelle: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  /** Colonne 1 (montant net au début) et 2 (augmentations) : saisies, sans case ; colonne 3 : dotations (case Z9 ou SP) ; colonne 4 : montant net à la fin (case Z8 ou SR), calculée. */
  debut: ChaineDecimale | null;
  augmentations: ChaineDecimale | null;
  dotations: ChaineDecimale | null;
  fin: ChaineDecimale | null;
  caseDotations: string;
  caseFin: string;
}
export interface ChargesRepartiesProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  lignes: LigneChargeRepartie[];
  controles: ControleDetail[];
  limites: string[];
  neant: TraceSaisie | null;
  mention: string;
}

export interface DemandeSaisiesTableaux {
  balance: Balance;
  exercice: { debut: string; fin: string };
  regime: RegimeLiasse;
  territoire: TerritoireFiscal;
  impotSurLeResultat: ImpotSurLeResultat;
  referentielComptable: string;
  devise: string;
  societeCommerciale: boolean | null;
  versionDonnees: number;
  saisies: readonly SaisieTableau[];
}

export type ResultatSaisiesTableaux =
  | { statut: 'projet'; cadreIII: CadreIIIProjet | null; ecartsReevaluation: EcartsReevaluationProjet | null; amortissementsDerogatoires: AmortissementsDerogatoiresProjet | null; chargesRepartiesPlusieursExercices: ChargesRepartiesProjet | null }
  | LiasseAbstention;

const trace = (s: SaisieTableau): TraceSaisie => ({ note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees });
const etabli = (m: Decimal, codeCase: string | null): CelluleMontant => ({ statut: 'etabli', montant: versChaine(m), codeCase, etatCodeCase: 'lu_verifie' });
const abstention = (motifs: string[], codeCase: string | null): CelluleMontant => ({ statut: 'abstention', motifs, codeCase, etatCodeCase: 'lu_verifie' });
const d = (v: string | null | undefined): Decimal => new Decimal(v ?? '0');
const soldeCrediteur = (l: { totalCredit: string; totalDebit: string }): Decimal => new Decimal(l.totalCredit).minus(l.totalDebit);
const soldeDebiteur = (l: { totalCredit: string; totalDebit: string }): Decimal => new Decimal(l.totalDebit).minus(l.totalCredit);

function statutDe(s: SaisieTableau | undefined, version: number): StatutLigneSaisie {
  return s === undefined ? 'a_saisir' : s.versionDonnees !== version ? 'a_revoir' : 'saisi';
}

const CODES_TOTAL_III = { valeurActif: '578', amortissements: '580', valeurResiduelle: '582', prixCession: '584', c5: '586', c6: '581', c7: '587', c8: '589' } as const;
const CODES_REG = { c5: '590', c6: '583', c7: '594', c8: '595' } as const;
const CODES_TOTAL_GENERAL = { c5: '596', c6: '585', c7: '597', c8: '599' } as const;

function cadreIII(demande: DemandeSaisiesTableaux): CadreIIIProjet {
  const saisies = demande.saisies.filter((s) => s.tableau === '2033C_III');
  const parLigne = new Map(saisies.map((s) => [s.ligne, s]));
  const v = demande.versionDonnees;
  const lignes: LigneCession[] = LIGNES_CESSIONS.map((ligne) => {
    const s = parLigne.get(ligne);
    const statut = statutDe(s, v);
    if (s === undefined || statut !== 'saisi') return { ligne, statut, trace: s ? trace(s) : null, nature: null, valeurActif: null, amortissements: null, valeurResiduelle: null, prixCession: null, classement: null, plusOuMoinsValue: null, colonnePlusValue: null };
    const va = d(s.valeurs.valeurActif), am = d(s.valeurs.amortissements), px = d(s.valeurs.prixCession);
    const classement = s.valeurs.classement as ClassementPlusValue;
    const residuelle = va.minus(am);
    return { ligne, statut, trace: trace(s), nature: s.valeurs.nature ?? null, valeurActif: versChaine(va), amortissements: versChaine(am), valeurResiduelle: versChaine(residuelle), prixCession: versChaine(px), classement, plusOuMoinsValue: versChaine(px.minus(residuelle)), colonnePlusValue: COLONNE_CLASSEMENT[classement] };
  });
  const neantSaisie = parLigne.get('NEANT');
  const neantStatut = statutDe(neantSaisie, v);
  const retenues = lignes.filter((l) => l.statut === 'saisi');
  const aRevoir = lignes.filter((l) => l.statut === 'a_revoir').length + (neantStatut === 'a_revoir' ? 1 : 0);
  const etat: CadreIIIProjet['etat'] = retenues.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (retenues.length > 0 && neantStatut === 'saisi') controles.push({ code: 'III_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le cadre est déclaré « néant » ET porte des cessions : retirer l’une des deux saisies ; les lignes saisies sont retenues.' });

  const motifs: string[] = [];
  if (etat === 'a_saisir') motifs.push('Aucune cession saisie et le cadre n’est pas déclaré « néant » : rien n’est présumé nul.');
  if (aRevoir > 0) motifs.push(`${aRevoir} saisie(s) donnée(s) sur une autre version des données (« à revoir ») ne comptent plus.`);
  const somme = (f: (l: LigneCession) => Decimal): Decimal => retenues.reduce((acc, l) => acc.plus(f(l)), ZERO);
  const colonne = (c: 'c5' | 'c6' | 'c7' | 'c8') => somme((l) => (l.colonnePlusValue === c ? d(l.plusOuMoinsValue) : ZERO));
  const cellule = (valeur: () => Decimal, code: string): CelluleMontant => (etat === 'a_saisir' || aRevoir > 0 ? abstention(motifs, code) : etabli(etat === 'neant' ? ZERO : valeur(), code));
  const totaux = {
    valeurActif: cellule(() => somme((l) => d(l.valeurActif)), CODES_TOTAL_III.valeurActif),
    amortissements: cellule(() => somme((l) => d(l.amortissements)), CODES_TOTAL_III.amortissements),
    valeurResiduelle: cellule(() => somme((l) => d(l.valeurResiduelle)), CODES_TOTAL_III.valeurResiduelle),
    prixCession: cellule(() => somme((l) => d(l.prixCession)), CODES_TOTAL_III.prixCession),
    c5: cellule(() => colonne('c5'), CODES_TOTAL_III.c5),
    c6: cellule(() => colonne('c6'), CODES_TOTAL_III.c6),
    c7: cellule(() => colonne('c7'), CODES_TOTAL_III.c7),
    c8: cellule(() => colonne('c8'), CODES_TOTAL_III.c8),
  };

  const pv19 = parLigne.get('PV19');
  const pv19Statut = statutDe(pv19, v);
  const reg = parLigne.get('REG');
  const regStatut = statutDe(reg, v);
  const regVal = regStatut === 'saisi' ? { c5: reg!.valeurs.c5 ?? null, c6: reg!.valeurs.c6 ?? null, c7: reg!.valeurs.c7 ?? null, c8: reg!.valeurs.c8 ?? null } : { c5: null, c6: null, c7: null, c8: null };
  const totalGeneral = {} as CadreIIIProjet['totalGeneral'];
  for (const c of ['c5', 'c6', 'c7', 'c8'] as const) {
    const t = totaux[c];
    const m = [...(t.statut === 'abstention' ? t.motifs : []), ...(regStatut !== 'saisi' ? ['Régularisations (cases 590, 583, 594, 595) sans saisie retenue : saisir un montant ou déclarer « néant » ; rien n’est présumé nul.'] : [])];
    totalGeneral[c] = m.length > 0 || t.statut !== 'etabli' ? abstention(m, CODES_TOTAL_GENERAL[c]) : etabli(new Decimal(t.montant).plus(regVal[c]!), CODES_TOTAL_GENERAL[c]);
  }

  // Contrôle indicatif avec la balance : comptes 775 (produits des cessions d'éléments d'actif) et 675 (valeurs comptables des éléments cédés).
  const prix775 = demande.balance.lignes.filter((l) => l.compteNum.startsWith('775')).reduce((acc, l) => acc.plus(soldeCrediteur(l)), ZERO);
  const vnc675 = demande.balance.lignes.filter((l) => l.compteNum.startsWith('675')).reduce((acc, l) => acc.plus(soldeDebiteur(l)), ZERO);
  if (etat === 'saisi' && aRevoir === 0) {
    const ecartPrix = prix775.minus(somme((l) => d(l.prixCession)));
    controles.push(ecartPrix.isZero()
      ? { code: 'III_PRIX_775', statut: 'coherent', message: `Prix de cession saisis (${totaux.prixCession.statut === 'etabli' ? totaux.prixCession.montant : ''}) égaux au compte 775 de la balance. Contrôle indicatif.` }
      : { code: 'III_PRIX_775', statut: 'ecart', message: `Prix de cession saisis différents du solde créditeur du compte 775 (${versChaine(prix775)}) : cessions non détaillées, cessions de titres, ou compte non utilisé. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecartPrix) });
    const ecartVnc = vnc675.minus(somme((l) => d(l.valeurResiduelle)));
    controles.push(ecartVnc.isZero()
      ? { code: 'III_VNC_675', statut: 'coherent', message: 'Valeurs résiduelles saisies égales au compte 675 de la balance. Contrôle indicatif.' }
      : { code: 'III_VNC_675', statut: 'ecart', message: `Valeurs résiduelles saisies différentes du solde débiteur du compte 675 (${versChaine(vnc675)}) : rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecartVnc) });
    const excedent = retenues.filter((l) => d(l.amortissements).greaterThan(d(l.valeurActif)));
    if (excedent.length > 0) controles.push({ code: 'III_AMORT_EXCEDE_ACTIF', statut: 'ecart', message: `Ligne(s) ${excedent.map((l) => l.ligne).join(', ')} : amortissements supérieurs à la valeur d’actif (valeur résiduelle négative) : à vérifier.` });
  } else if (etat === 'neant' && (prix775.greaterThan(0) || vnc675.greaterThan(0))) {
    controles.push({ code: 'III_NEANT_CESSIONS_COMPTABILISEES', statut: 'ecart', message: `Cadre déclaré « néant » alors que la balance porte des cessions (compte 775 : ${versChaine(prix775)} ; compte 675 : ${versChaine(vnc675)}). Rien n’est corrigé. Contrôle indicatif.` });
  } else if (etat === 'a_saisir' && (prix775.greaterThan(0) || vnc675.greaterThan(0))) {
    controles.push({ code: 'III_CESSIONS_A_DETAILLER', statut: 'non_verifie', message: `La balance porte des cessions (compte 775 : ${versChaine(prix775)} ; compte 675 : ${versChaine(vnc675)}) : à détailler ligne par ligne ou à déclarer.` });
  }

  return {
    statut: 'projet',
    etat,
    lignes,
    totaux,
    plusValues19: { statut: pv19Statut, montant: pv19Statut === 'saisi' ? pv19!.valeurs.montant ?? null : null, trace: pv19 ? trace(pv19) : null, codeCase: '579' },
    regularisations: { statut: regStatut, trace: reg ? trace(reg) : null, ...regVal, codes: { ...CODES_REG } },
    totalGeneral,
    controles,
    limites: [
      'Le classement d’une plus ou moins-value (court terme, long terme à 19 %, à 15 % ou 12,8 %, à 0 %) est une décision du cabinet : Comtaple ne la déduit pas ; pour une société à l’IS le régime du long terme vise des cas précis (notice 2033-NOT-SD, page 13).',
      'Seul le calcul que le formulaire porte est fait (valeur résiduelle, plus ou moins-value, totaux de colonnes, totaux avec régularisations) ; la nature fiscale de chaque cession n’est pas vérifiée.',
      'L’état joint papier du cadre III (exigé au-delà de dix lignes) : non produit ; les lignes 11 à 30 sont saisies comme lignes d’état joint (même saisie, mêmes totaux).',
      'Le contrôle avec la balance (comptes 775 et 675) est indicatif : une cession de titres ou une cession portée à d’autres comptes l’écarte légitimement.',
    ],
    neant: neantSaisie ? trace(neantSaisie) : null,
    mention: MENTION_PROJET,
  };
}

function ecartsReevaluation(demande: DemandeSaisiesTableaux): EcartsReevaluationProjet {
  const v = demande.versionDonnees;
  const a = demande.saisies.filter((s) => s.tableau === '2054BIS_A');
  const b = demande.saisies.filter((s) => s.tableau === '2054BIS_B');
  const parLigne = new Map(a.map((s) => [s.ligne, s]));
  const lignes: LigneEcartReevaluation[] = Object.keys(LIBELLES_2054_BIS).map((ligne) => {
    const s = parLigne.get(ligne);
    const statut = statutDe(s, v);
    const base = { ligne, libelle: LIBELLES_2054_BIS[ligne]!, statut, trace: s ? trace(s) : null };
    if (s === undefined || statut !== 'saisi') return { ...base, c1: null, c2: null, c3: null, c4: null, c5: null, ecart: null, c6: null };
    const [c1, c2, c3, c4, c5] = ['c1', 'c2', 'c3', 'c4', 'c5'].map((k) => d(s.valeurs[k]));
    return { ...base, c1: versChaine(c1!), c2: versChaine(c2!), c3: versChaine(c3!), c4: versChaine(c4!), c5: versChaine(c5!), ecart: versChaine(c1!.minus(c2!)), c6: versChaine(c1!.minus(c2!).minus(c5!)) };
  });
  const neantSaisie = parLigne.get('NEANT');
  const neantStatut = statutDe(neantSaisie, v);
  const retenues = lignes.filter((l) => l.statut === 'saisi');
  const aRevoir = lignes.filter((l) => l.statut === 'a_revoir').length + (neantStatut === 'a_revoir' ? 1 : 0);
  const etat: EcartsReevaluationProjet['etat'] = retenues.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (retenues.length > 0 && neantStatut === 'saisi') controles.push({ code: 'BIS_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le tableau est déclaré « néant » ET porte des lignes : retirer l’une des deux saisies ; les lignes saisies sont retenues.' });
  const motifs: string[] = [];
  if (etat === 'a_saisir') motifs.push('Aucune ligne saisie et le tableau n’est pas déclaré « néant » : rien n’est présumé nul.');
  if (aRevoir > 0) motifs.push(`${aRevoir} saisie(s) donnée(s) sur une autre version des données (« à revoir ») ne comptent plus.`);
  const total = (f: (l: LigneEcartReevaluation) => string | null): CelluleMontant => (motifs.length > 0 ? abstention(motifs, null) : etabli(etat === 'neant' ? ZERO : retenues.reduce((acc, l) => acc.plus(d(f(l))), ZERO), null));
  const totaux = { c1: total((l) => l.c1), c2: total((l) => l.c2), c3: total((l) => l.c3), c4: total((l) => l.c4), c5: total((l) => l.c5), c6: total((l) => l.c6) };
  const neg = retenues.filter((l) => d(l.c6).isNegative());
  if (neg.length > 0) controles.push({ code: 'BIS_PROVISION_NEGATIVE', statut: 'ecart', message: `Ligne(s) ${neg.map((l) => l.ligne).join(', ')} : provision spéciale (colonne 6) négative : colonne 5 supérieure à l’écart (colonne 1 − colonne 2), à vérifier.` });
  const bs = new Map(b.map((s) => [s.ligne, s]));
  const cadreLigne = (cle: 'B1' | 'B2') => {
    const s = bs.get(cle);
    const statut = statutDe(s, v);
    return { statut, montant: statut === 'saisi' ? s!.valeurs.montant ?? null : null, trace: s ? trace(s) : null };
  };
  const b1 = cadreLigne('B1');
  const b2 = cadreLigne('B2');
  const b3: CelluleMontant = b1.statut === 'saisi' && b2.statut === 'saisi' ? etabli(d(b1.montant).minus(d(b2.montant)), null) : abstention(['Cadre B : lignes 1 et 2 à saisir (ou à laisser sans objet : le cadre ne sert que si des déficits au 31 décembre 1976 ont été imputés sur la provision spéciale).'], null);
  if (b3.statut === 'etabli' && new Decimal(b3.montant).isNegative()) controles.push({ code: 'BIS_B3_NEGATIVE', statut: 'ecart', message: 'Cadre B : la ligne 3 (ligne 1 − ligne 2) est négative : à vérifier.' });
  return {
    statut: 'projet',
    etat,
    lignes,
    totaux,
    cadreB: { b1, b2, b3 },
    controles,
    limites: [
      'Le tableau ne concerne que les entreprises ayant pratiqué la réévaluation légale de leurs immobilisations amortissables (art. 238 bis J du CGI) et jusqu’à l’exercice où la provision spéciale devient nulle (formulaire).',
      'Seul le calcul que le formulaire porte est fait : écart = colonne 1 − colonne 2, colonne 6 = (colonne 1 − colonne 2) − colonne 5, ligne 10 = somme des lignes, cadre B ligne 3 = ligne 1 − ligne 2. La colonne 5 (montant cumulé, note 4 : sommes des colonnes 3 et 4 et cumul de l’exercice précédent) se saisit, elle n’est pas reconstituée.',
      'Le formulaire n’a pas de code de case : les colonnes sont numérotées ① à ⑥ ; la colonne 6 est le montant à reporter au passif du bilan en « provisions réglementées » (tableau 2051).',
      'Aucune donnée de la balance ne porte ce tableau : aucun contrôle croisé n’est fait.',
    ],
    neant: neantSaisie ? trace(neantSaisie) : null,
    mention: MENTION_PROJET,
  };
}

function amortissementsDerogatoires(demande: DemandeSaisiesTableaux): AmortissementsDerogatoiresProjet {
  const v = demande.versionDonnees;
  const saisies = demande.saisies.filter((x) => x.tableau === '2055_B');
  const parLigne = new Map(saisies.map((x) => [x.ligne, x]));
  const lignes: LigneDerogatoire[] = LIGNES_2055_B.map((def) => {
    const x = parLigne.get(def.ligne);
    const statut = statutDe(x, v);
    const base = { ligne: def.ligne, libelle: def.libelle, groupe: def.groupe, statut, trace: x ? trace(x) : null };
    if (x === undefined || statut !== 'saisi') return { ...base, colonnes: def.cases.map((c) => (c === '' ? null : { codeCase: c, montant: null })) };
    const val = (k: string) => d(x.valeurs[k]);
    const dotations = def.ligne === '13' ? val('c1') : val('c1').plus(val('c2')).plus(val('c3'));
    const reprises = def.ligne === '13' ? val('c4') : val('c4').plus(val('c5')).plus(val('c6'));
    const net = dotations.minus(reprises);
    const cellules: Array<CelluleCase | null> = def.ligne === '13'
      ? [{ codeCase: 'NL', montant: versChaine(val('c1')) }, null, null, { codeCase: 'NM', montant: versChaine(val('c4')) }, null, null, { codeCase: 'NO', montant: versChaine(net) }]
      : ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((k, i) => ({ codeCase: def.cases[i]!, montant: versChaine(val(k)) })).concat([{ codeCase: def.cases[6]!, montant: versChaine(net) }]);
    return { ...base, colonnes: cellules };
  });
  const neantSaisie = parLigne.get('NEANT');
  const neantStatut = statutDe(neantSaisie, v);
  const retenues = lignes.filter((l) => l.statut === 'saisi');
  const aRevoir = lignes.filter((l) => l.statut === 'a_revoir').length + (neantStatut === 'a_revoir' ? 1 : 0);
  const etat: AmortissementsDerogatoiresProjet['etat'] = retenues.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (retenues.length > 0 && neantStatut === 'saisi') controles.push({ code: 'B2055_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le cadre B est déclaré « néant » ET porte des lignes : retirer l’une des deux saisies ; les lignes saisies sont retenues.' });
  const motifs: string[] = [];
  if (etat === 'a_saisir') motifs.push('Aucune ligne saisie et le cadre n’est pas déclaré « néant » : rien n’est présumé nul.');
  if (aRevoir > 0) motifs.push(`${aRevoir} saisie(s) donnée(s) sur une autre version des données (« à revoir ») ne comptent plus.`);
  const somme = (groupes: ReadonlyArray<'I' | 'II' | 'III'>, col: number): Decimal => retenues.filter((l) => groupes.includes(l.groupe)).reduce((acc, l) => acc.plus(l.colonnes[col]?.montant ?? '0'), ZERO);
  const cellule = (groupes: ReadonlyArray<'I' | 'II' | 'III'>, col: number, code: string): CelluleMontant | null => {
    if (code === '') return null;
    return motifs.length > 0 ? abstention(motifs, code) : etabli(etat === 'neant' ? ZERO : somme(groupes, col), code);
  };
  const ligneTotaux = (groupes: ReadonlyArray<'I' | 'II' | 'III'>, cases: readonly string[]) => cases.map((c, i) => cellule(groupes, i, c));
  const totaux = { I: ligneTotaux(['I'], CASES_TOTAL_2055_B.I), II: ligneTotaux(['II'], CASES_TOTAL_2055_B.II), III: ligneTotaux(['III'], CASES_TOTAL_2055_B.III), general: ligneTotaux(['I', 'II', 'III'], CASES_TOTAL_2055_B.general) };
  const general = totaux.general;
  const sommeCols = (cols: number[]): Decimal => cols.reduce((acc, i) => acc.plus(general[i]!.statut === 'etabli' ? general[i]!.montant : 0), ZERO);
  const pasEtabli = motifs.length > 0;
  const NW = pasEtabli ? abstention(motifs, 'NW') : etabli(sommeCols([0, 1, 2]), 'NW');
  const NY = pasEtabli ? abstention(motifs, 'NY') : etabli(sommeCols([3, 4, 5]), 'NY');
  const NZ = NW.statut === 'etabli' && NY.statut === 'etabli' ? etabli(new Decimal(NW.montant).minus(NY.montant), 'NZ') : abstention(motifs, 'NZ');
  // Contrôle indicatif avec la balance : dotations aux provisions réglementées (6872) et reprises (7872) ; la notice rattache NZ aux lignes HG et HC du 2053.
  if (etat === 'saisi' && motifs.length === 0) {
    const debit6872 = demande.balance.lignes.filter((l) => l.compteNum.startsWith('6872')).reduce((acc, l) => acc.plus(soldeDebiteur(l)), ZERO);
    const credit7872 = demande.balance.lignes.filter((l) => l.compteNum.startsWith('7872')).reduce((acc, l) => acc.plus(soldeCrediteur(l)), ZERO);
    for (const [code, saisi, compte, solde] of [['B2055_DOTATIONS_6872', NW, '6872', debit6872], ['B2055_REPRISES_7872', NY, '7872', credit7872]] as const) {
      const m = new Decimal(saisi.statut === 'etabli' ? saisi.montant : 0);
      const ecart = solde.minus(m);
      controles.push(ecart.isZero()
        ? { code, statut: 'coherent', message: `Total saisi (${versChaine(m)}) égal au compte ${compte} de la balance. Contrôle indicatif.` }
        : { code, statut: 'ecart', message: `Total saisi (${versChaine(m)}) différent du compte ${compte} de la balance (${versChaine(solde)}) : dotations ou reprises portées à d’autres comptes, ou lignes non saisies. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
    if (retenues.length < lignes.length) controles.push({ code: 'B2055_LIGNES_NON_SAISIES', statut: 'non_verifie', message: `${lignes.length - retenues.length} ligne(s) non saisie(s) : les totaux ne comptent que les lignes saisies ; rien n’est présumé nul.` });
  }
  return {
    statut: 'projet',
    etat,
    lignes,
    totaux,
    nonVentile: { NW, NY, NZ },
    controles,
    limites: [
      'Aucune donnée de la balance ne ventile les amortissements dérogatoires par poste et par origine : chaque ligne se saisit (colonnes 1 à 6) avec sa justification ; l’origine d’une dotation ou d’une reprise (différence de durée, dégressif, amortissement fiscal exceptionnel) est une décision du cabinet (notice 2032-NOT-SD, cadre B).',
      'Seul le calcul que le formulaire porte est fait : colonne 7 = (colonnes 1 + 2 + 3) − (colonnes 4 + 5 + 6) ; totaux I, II, III et général ; non ventilé NW = NP + NQ + NR, NY = NS + NT + NU, NZ = NW − NY. Frais d’acquisition de titres de participation : colonnes 1 et 4 seulement.',
      'Le contrôle avec la balance (comptes 6872 et 7872) est indicatif : la notice rattache la case NZ aux lignes HG et HC du tableau 2053 et aux cases TM et TN du tableau 2056, non préparées.',
    ],
    neant: neantSaisie ? trace(neantSaisie) : null,
    mention: MENTION_PROJET,
  };
}

function chargesReparties(demande: DemandeSaisiesTableaux): ChargesRepartiesProjet {
  const v = demande.versionDonnees;
  const parLigne = new Map(demande.saisies.filter((x) => x.tableau === '2055_C').map((x) => [x.ligne, x]));
  const lignes: LigneChargeRepartie[] = LIGNES_2055_C.map((def) => {
    const x = parLigne.get(def.ligne);
    const statut = statutDe(x, v);
    const base = { ligne: def.ligne, libelle: def.libelle, statut, trace: x ? trace(x) : null, caseDotations: def.caseDotations, caseFin: def.caseFin };
    if (x === undefined || statut !== 'saisi') return { ...base, debut: null, augmentations: null, dotations: null, fin: null };
    const debut = d(x.valeurs.debut), aug = d(x.valeurs.augmentations), dot = d(x.valeurs.dotations);
    return { ...base, debut: versChaine(debut), augmentations: versChaine(aug), dotations: versChaine(dot), fin: versChaine(debut.plus(aug).minus(dot)) };
  });
  const neantSaisie = parLigne.get('NEANT');
  const neantStatut = statutDe(neantSaisie, v);
  const retenues = lignes.filter((l) => l.statut === 'saisi');
  const etat: ChargesRepartiesProjet['etat'] = retenues.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (retenues.length > 0 && neantStatut === 'saisi') controles.push({ code: 'C2055_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le cadre C est déclaré « néant » ET porte des lignes : retirer l’une des deux saisies ; les lignes saisies sont retenues.' });
  for (const l of retenues) {
    if (d(l.fin).isNegative()) controles.push({ code: `C2055_FIN_NEGATIVE_${l.ligne}`, statut: 'ecart', message: `Ligne ${Number(l.ligne)} : montant net à la fin négatif (dotations supérieures au début plus les augmentations) : à vérifier.`, ecart: l.fin! });
    const def = LIGNES_2055_C.find((x) => x.ligne === l.ligne)!;
    const solde = demande.balance.lignes.filter((b) => b.compteNum.startsWith(def.compteControle)).reduce((acc, b) => acc.plus(soldeDebiteur(b)), ZERO);
    const ecart = solde.minus(d(l.fin));
    controles.push(ecart.isZero()
      ? { code: `C2055_COMPTE_${def.compteControle}`, statut: 'coherent', message: `Ligne ${Number(l.ligne)} : montant net à la fin égal au solde du compte ${def.compteControle} (${def.libelleCompte}). Contrôle indicatif.` }
      : { code: `C2055_COMPTE_${def.compteControle}`, statut: 'ecart', message: `Ligne ${Number(l.ligne)} : montant net à la fin (${l.fin}) différent du solde du compte ${def.compteControle} (${def.libelleCompte}) : ${versChaine(solde)}. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
  }
  if (etat === 'neant') {
    const soldes = LIGNES_2055_C.map((def) => ({ def, solde: demande.balance.lignes.filter((b) => b.compteNum.startsWith(def.compteControle)).reduce((acc, b) => acc.plus(soldeDebiteur(b)), ZERO) })).filter((x) => !x.solde.isZero());
    for (const x of soldes) controles.push({ code: `C2055_NEANT_COMPTE_${x.def.compteControle}`, statut: 'ecart', message: `Cadre déclaré « néant » alors que le compte ${x.def.compteControle} (${x.def.libelleCompte}) porte ${versChaine(x.solde)}. Rien n’est corrigé. Contrôle indicatif.` });
  }
  return {
    statut: 'projet',
    etat,
    lignes,
    controles,
    limites: [
      'Aucune donnée de la balance ne porte les mouvements de l’exercice : les colonnes 1 (montant net au début), 2 (augmentations) et 3 (dotations, cases Z9 et SP) se saisissent avec leur justification ; le formulaire n’a pas de case pour les colonnes 1 et 2.',
      'Seul le calcul que le formulaire porte est fait : colonne 4 (montant net à la fin, cases Z8 et SR) = colonne 1 + colonne 2 − colonne 3 (notice 2032-NOT-SD : amortissement imputé directement aux comptes d’actif correspondants).',
      'Le contrôle avec la balance (comptes 481 et 169) est indicatif : le compte 481 regroupe toutes les charges à répartir, pas seulement les frais d’émission d’emprunt.',
    ],
    neant: neantSaisie ? trace(neantSaisie) : null,
    mention: MENTION_PROJET,
  };
}

export function preparerSaisiesTableaux(demande: DemandeSaisiesTableaux): ResultatSaisiesTableaux {
  const motifs = motifsAbstention({ exercice: demande.exercice, regime: demande.regime, territoire: demande.territoire, impotSurLeResultat: demande.impotSurLeResultat, referentielComptable: demande.referentielComptable, devise: demande.devise, societeCommerciale: demande.societeCommerciale });
  if (motifs.length > 0) return { statut: 'abstention', motifs, perimetreCouvert: PERIMETRE_LIASSE, mention: MENTION_PROJET };
  return demande.regime === 'reel_simplifie'
    ? { statut: 'projet', cadreIII: cadreIII(demande), ecartsReevaluation: null, amortissementsDerogatoires: null, chargesRepartiesPlusieursExercices: null }
    : { statut: 'projet', cadreIII: null, ecartsReevaluation: ecartsReevaluation(demande), amortissementsDerogatoires: amortissementsDerogatoires(demande), chargesRepartiesPlusieursExercices: chargesReparties(demande) };
}
