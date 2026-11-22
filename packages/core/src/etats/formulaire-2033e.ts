/**
 * Tableau 2033-E-SD « Détermination des effectifs et de la valeur ajoutée » (D-115), régime simplifié.
 *
 * Servi par SAISIE CASE PAR CASE (justification obligatoire, trace, version des données, historique en ajout seul, « à revoir », NÉANT
 * explicite distinct du manque, abstention sans saisie), comme le 2033-D (D-114). La balance ne fournit aucune de ces valeurs : le
 * rattachement des comptes aux lignes de la valeur ajoutée relève des règles de la CVAE, que le cabinet applique ; aucune décision fiscale
 * n'est prise par Comtaple.
 *
 * Seul le calcul que le FORMULAIRE énonce est fait, et seulement quand toutes ses composantes sont saisies (néant compris) :
 *  - TOTAL 1 (case 106) = 108 + 118 + 119 ;
 *  - TOTAL 2 (case 144) = 115 + 143 + 113 + 111 + 153 ;
 *  - TOTAL 3 (case 152) = 121 + 145 + 125 + 310 + 133 + 148 + 128 + 135 + 150 ;
 *  - case 137 « calcul de la valeur ajoutée » = (Total 1 + Total 2 − Total 3) ;
 *  - case 117 « valeur ajoutée assujettie à la CVAE » = case 137, ou 0 si elle est négative (« il convient de reporter un montant égal à 0 »).
 * Case 022 (chiffre d'affaires de référence CVAE) : « report de la ligne 106, le cas échéant ajusté à 12 mois » : PROPOSÉE (= case 106) pour un
 * exercice de 12 mois, jamais retenue sans saisie ; au-delà ou en deçà, aucune proposition (l'ajustement n'est pas calculé).
 * Contrôles INDICATIFS : dont apprentis, dont handicapés et effectifs artisanaux au plus égaux à l'effectif moyen.
 *
 * Cases lues sur `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), page 5, par extraction positionnée puis vérifiées sur le rendu image (2026-11-22).
 * Non préparés : période de référence et date de cessation (cases 024, 016 : dates), numéro de case 020 « mono-établissement » traité comme 0 / 1.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail, EtatCodeCase, QualificationRenvoi } from './detail-resultat.js';
import { MENTION_PROJET } from './sources-fiscales.js';

const ZERO = new Decimal(0);

export type GroupeE = 'effectifs' | 'I' | 'II' | 'III' | 'mono';
export interface DefinitionCase2033E {
  cle: string;
  codeCase: string;
  libelle: string;
  groupe: GroupeE;
  /** montant : décimal positif ; effectif : décimal positif (nombre de personnes, éventuellement moyen) ; oui_non : 0 (non coché) ou 1 (coché). */
  type: 'montant' | 'effectif' | 'oui_non';
  precision?: string;
}

const c = (code: string, libelle: string, groupe: GroupeE, type: DefinitionCase2033E['type'] = 'montant', precision?: string): DefinitionCase2033E => ({ cle: `E_${code}`, codeCase: code, libelle, groupe, type, ...(precision ? { precision } : {}) });

export const CASES_2033_E: readonly DefinitionCase2033E[] = [
  c('376', 'Effectif moyen du personnel', 'effectifs', 'effectif', 'Notice 2033-NOT-SD, « Déclaration des effectifs ».'),
  c('657', 'dont apprentis', 'effectifs', 'effectif'),
  c('651', 'dont handicapés', 'effectifs', 'effectif'),
  c('861', 'Effectifs affectés à l’activité artisanale', 'effectifs', 'effectif'),
  c('108', 'Ventes de produits fabriqués, prestations de services et marchandises', 'I'),
  c('118', 'Redevances pour concessions, brevets, licences et assimilées', 'I'),
  c('119', 'Plus-values de cession d’immobilisations corporelles ou incorporelles si rattachées à une activité normale et courante', 'I'),
  c('115', 'Autres produits de gestion courante, y compris les plus-values de cession non rattachées à une activité normale et courante (hors quotes-parts de résultat sur opérations faites en commun)', 'II'),
  c('143', 'Production immobilisée à hauteur des seules charges déductibles ayant concouru à sa formation', 'II'),
  c('113', 'Subventions d’exploitation reçues et certains abandons de créances à caractère commercial', 'II'),
  c('111', 'Variation positive des stocks', 'II'),
  c('153', 'Rentrées sur créances amorties lorsqu’elles se rapportent au résultat d’exploitation', 'II'),
  c('121', 'Achats', 'III'),
  c('145', 'Variation négative des stocks', 'III'),
  c('125', 'Services extérieurs, à l’exception des loyers et des redevances', 'III'),
  c('310', 'Loyers et redevances, à l’exception de ceux afférents à des immobilisations corporelles mises à disposition (location-gérance, crédit-bail, location de plus de 6 mois)', 'III'),
  c('133', 'Taxes déductibles de la valeur ajoutée', 'III'),
  c('148', 'Autres charges de gestion courante (hors quotes-parts de résultat sur opérations faites en commun)', 'III'),
  c('128', 'Charges déductibles de la valeur ajoutée afférentes à la production immobilisée déclarée', 'III', 'montant', 'Renvoi (1) du formulaire : ne pas tenir compte de ces charges dans les lignes 121 à 148.'),
  c('135', 'Fraction déductible de la valeur ajoutée des dotations aux amortissements afférentes à des immobilisations corporelles mises à disposition (location-gérance, crédit-bail, location de plus de 6 mois)', 'III'),
  c('150', 'Moins-values de cession d’immobilisations corporelles ou incorporelles rattachées ou non à une activité normale et courante', 'III'),
  c('020', 'Mono-établissement au sens de la CVAE (0 = non coché, 1 = coché)', 'mono', 'oui_non'),
  c('022', 'Chiffre d’affaires de référence CVAE (report de la ligne 106, le cas échéant ajusté à 12 mois)', 'mono', 'montant', 'Proposition = case 106 pour un exercice de 12 mois ; l’ajustement à 12 mois n’est pas calculé.'),
  c('023', 'Effectifs au sens de la CVAE', 'mono', 'effectif'),
  c('026', 'Chiffre d’affaires du groupe économique (art. 223 A du CGI)', 'mono'),
];
export const CLES_2033_E: readonly string[] = CASES_2033_E.map((x) => x.cle);

const TOTAL_1 = ['108', '118', '119'];
const TOTAL_2 = ['115', '143', '113', '111', '153'];
const TOTAL_3 = ['121', '145', '125', '310', '133', '148', '128', '135', '150'];

export interface CaseSaisie2033E extends DefinitionCase2033E {
  etatCodeCase: EtatCodeCase;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: ChaineDecimale | null;
  saisie: QualificationRenvoi | null;
  proposition: { montant: ChaineDecimale; origine: string } | null;
}

export type CelluleCalculee =
  | { statut: 'etabli'; montant: ChaineDecimale; codeCase: string; etatCodeCase: EtatCodeCase; calcul: string }
  | { statut: 'abstention'; motifs: string[]; codeCase: string; etatCodeCase: EtatCodeCase };

export interface Formulaire2033EProjet {
  statut: 'projet';
  exercice: { debut: string; fin: string; dureeMois: number };
  cases: CaseSaisie2033E[];
  total1: CelluleCalculee;
  total2: CelluleCalculee;
  total3: CelluleCalculee;
  valeurAjoutee137: CelluleCalculee;
  valeurAjoutee117: CelluleCalculee;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}

export interface DemandeFormulaire2033E {
  versionDonnees: number;
  exercice: { debut: string; fin: string };
  renvois: readonly QualificationRenvoi[];
}

/** Durée de l'exercice en mois entiers, arrondie à l'unité la plus proche (notice 2033-NOT-SD : « durées réelles arrondies à l'unité la plus proche »). */
export function dureeEnMois(debut: string, fin: string): number {
  const jours = (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000 + 1;
  return Math.round(jours / 30.4375);
}

const etabli = (m: Decimal, codeCase: string, calcul: string): CelluleCalculee => ({ statut: 'etabli', montant: versChaine(m), codeCase, etatCodeCase: 'lu_verifie', calcul });
const abstention = (motifs: string[], codeCase: string): CelluleCalculee => ({ statut: 'abstention', motifs, codeCase, etatCodeCase: 'lu_verifie' });

export function preparerFormulaire2033E(demande: DemandeFormulaire2033E): Formulaire2033EProjet {
  const saisies = new Map(demande.renvois.map((r) => [r.code, r]));
  const duree = dureeEnMois(demande.exercice.debut, demande.exercice.fin);
  const cases: CaseSaisie2033E[] = CASES_2033_E.map((def) => {
    const s = saisies.get(def.cle) ?? null;
    const statut = s === null ? 'a_saisir' : s.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    return { ...def, etatCodeCase: 'lu_verifie', statut, neant: statut === 'saisi' && new Decimal(s!.montant).isZero(), montant: statut === 'saisi' ? s!.montant : null, saisie: s, proposition: null };
  });
  const val = (code: string): Decimal | null => {
    const x = cases.find((k) => k.codeCase === code)!;
    return x.statut === 'saisi' ? new Decimal(x.montant!) : null;
  };
  const total = (codes: string[], code: string, libelle: string): CelluleCalculee => {
    const manquantes = codes.filter((k) => val(k) === null);
    return manquantes.length > 0 ? abstention([`Case(s) ${manquantes.join(', ')} sans saisie retenue : saisir un montant ou déclarer « néant » ; rien n’est présumé nul.`], code) : etabli(codes.reduce((a, k) => a.plus(val(k)!), ZERO), code, libelle);
  };
  const total1 = total(TOTAL_1, '106', `${TOTAL_1.join(' + ')}`);
  const total2 = total(TOTAL_2, '144', `${TOTAL_2.join(' + ')}`);
  const total3 = total(TOTAL_3, '152', `${TOTAL_3.join(' + ')}`);
  const motifs137 = [total1, total2, total3].flatMap((t) => (t.statut === 'abstention' ? t.motifs : []));
  const valeurAjoutee137: CelluleCalculee = motifs137.length > 0 || total1.statut !== 'etabli' || total2.statut !== 'etabli' || total3.statut !== 'etabli' ? abstention(['Un des totaux 1, 2 ou 3 n’est pas établi.', ...motifs137], '137') : etabli(new Decimal(total1.montant).plus(total2.montant).minus(total3.montant), '137', 'Total 1 + Total 2 − Total 3');
  const valeurAjoutee117: CelluleCalculee = valeurAjoutee137.statut === 'etabli' ? etabli(Decimal.max(ZERO, new Decimal(valeurAjoutee137.montant)), '117', new Decimal(valeurAjoutee137.montant).isNegative() ? 'Valeur ajoutée négative : le formulaire demande de reporter 0' : 'Valeur ajoutée (case 137)') : abstention(['La valeur ajoutée (case 137) n’est pas établie.'], '117');
  // Proposition 022 = case 106 pour un exercice de 12 mois.
  const c022 = cases.find((k) => k.codeCase === '022')!;
  if (c022.statut !== 'saisi' && total1.statut === 'etabli' && duree === 12) c022.proposition = { montant: total1.montant, origine: 'Case 106 (total 1), exercice de 12 mois' };
  const controles: ControleDetail[] = [];
  const effectif = val('376');
  for (const code of ['657', '651', '861']) {
    const v = val(code);
    if (effectif !== null && v !== null && v.greaterThan(effectif)) controles.push({ code: `E_${code}_EFFECTIF`, statut: 'ecart', message: `La case ${code} (${versChaine(v)}) excède l’effectif moyen (${versChaine(effectif)}) : à vérifier. Contrôle indicatif.`, ecart: versChaine(v.minus(effectif)) });
  }
  const v020 = val('020');
  if (v020 !== null && !v020.isZero() && !v020.equals(1)) controles.push({ code: 'E_020_FORME', statut: 'ecart', message: 'La case 020 se saisit 0 (non coché) ou 1 (coché).' });
  if (c022.statut === 'saisi' && total1.statut === 'etabli' && duree === 12) {
    const ecart = new Decimal(c022.montant!).minus(total1.montant);
    controles.push(ecart.isZero() ? { code: 'E_022_106', statut: 'coherent', message: 'Case 022 égale la case 106 (exercice de 12 mois). Contrôle indicatif.' } : { code: 'E_022_106', statut: 'ecart', message: `Case 022 (${c022.montant}) diffère de la case 106 (${total1.montant}) pour un exercice de 12 mois. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
  }
  controles.push({ code: 'E_CASES_SANS_SAISIE', statut: 'non_verifie', message: `${cases.filter((k) => k.statut !== 'saisi').length} case(s) sur ${cases.length} sans saisie retenue : aucune n’est présumée nulle ; seuls les totaux dont toutes les composantes sont saisies (néant compris) sont calculés.` });
  return {
    statut: 'projet',
    exercice: { ...demande.exercice, dureeMois: duree },
    cases,
    total1,
    total2,
    total3,
    valeurAjoutee137,
    valeurAjoutee117,
    controles,
    nonPrepare: [
      'Période de référence (cases 024 et 016) et date de cessation : dates, non préparées.',
      'Rattachement des comptes de la balance aux lignes de la valeur ajoutée : règles de la CVAE, décision du cabinet ; aucune proposition n’est tirée de la balance.',
      'Répartition des salariés et formulaire 1330-CVAE-SD (multi-établissements) : non préparés.',
    ],
    limites: [
      'Chaque case est une saisie justifiée du cabinet ; « néant » est une déclaration explicite ; une case sans saisie n’est jamais présumée nulle.',
      'Les totaux 106, 144, 152, la valeur ajoutée 137 et la case 117 sont calculés comme le formulaire l’énonce, uniquement quand toutes leurs composantes sont saisies.',
      `Durée de l'exercice retenue pour la proposition de la case 022 : ${duree} mois (arrondie à l'unité la plus proche).`,
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
