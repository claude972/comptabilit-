/**
 * Tableau 2059-A « Détermination des plus ou moins-values » (D-121), régime réel normal : partie A (valeur résiduelle des éléments cédés,
 * colonnes 1 à 6), partie B (prix de vente, plus-value ou moins-value, qualification fiscale colonnes 9 à 11), lignes 1 à 12 (« I – Immobilisations »)
 * et lignes 13 à 16, 18 à 20 (« II – Autres éléments »), cadres récapitulatifs A (colonne 9), B (colonne 10) et C (colonne 11).
 *
 * Saisie ligne par ligne, justifiée, tracée, historisée ; NÉANT explicite du tableau ; abstention sans saisie ; aucune décision fiscale : la
 * qualification (court terme, long terme 19 %, 15 % ou 12,8 %, 0 %) est celle que le cabinet a saisie, jamais déduite. Une case non remplie est
 * une case vide du formulaire, jamais un zéro présumé.
 *
 * Seuls les calculs énoncés par le formulaire sont faits : cadre A = total algébrique des lignes 1 à 20 de la colonne 9 ; cadre B = total algébrique
 * des lignes 1 à 20 de la colonne 10 (trois taux) ; cadre C = total de la colonne 11. Ils ne sont établis que si le tableau comporte des saisies
 * ET si les sept lignes fixes 13 à 16 et 18 à 20 ont toutes été saisies (zéro compris) : sinon abstention motivée, sans chiffre. Les rapprochements
 * lus sur la disposition (plus-value = prix de vente − valeur résiduelle ; plus-value = somme de la qualification) sont des CONTRÔLES INDICATIFS,
 * jamais bloquants ni corrigés.
 *
 * Disposition lue sur `2050-liasse_5320.pdf` (SHA-256 0bba3352…f8453e1), page 13, rendu image vérifié (2026-11-22). Pas de code de case.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail } from './detail-resultat.js';
import type { SaisieTableau, StatutLigneSaisie, TraceSaisie } from './saisies-tableaux.js';
import { MENTION_PROJET } from './sources-fiscales.js';

export const LIGNES_2059_A_IM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;
/** Lignes fixes de la rubrique II (la ligne 17 n'existe pas sur le formulaire). */
export const LIGNES_2059_A_AUT: ReadonlyArray<{ ligne: string; libelle: string; colonnes: readonly string[] }> = [
  { ligne: '13', libelle: 'Fraction résiduelle de la provision spéciale de réévaluation afférente aux éléments cédés', colonnes: ['c9'] },
  { ligne: '14', libelle: 'Amortissements irrégulièrement différés se rapportant aux éléments cédés', colonnes: ['c9'] },
  { ligne: '15', libelle: 'Amortissements afférents aux éléments cédés mais exclus des charges déductibles par une disposition légale', colonnes: ['c9'] },
  { ligne: '16', libelle: 'Amortissements non pratiqués en comptabilité et correspondant à la déduction fiscale pour investissement, définie par les lois de 1966, 1968 et 1975, effectivement utilisée', colonnes: ['c9'] },
  { ligne: '18', libelle: 'Provisions pour dépréciation des titres relevant du régime des plus-values à long terme devenues sans objet au cours de l’exercice', colonnes: ['c10a', 'c10b', 'c10c'] },
  { ligne: '19', libelle: 'Dotations de l’exercice aux comptes de provisions pour dépréciation des titres relevant du régime des plus et moins-values à long terme', colonnes: ['c10a', 'c10b', 'c10c'] },
  { ligne: '20', libelle: 'Divers (détail à donner sur une note annexe)', colonnes: ['c9', 'c10a', 'c10b', 'c10c', 'c11'] },
];
export const CHAMPS_2059_A_IM = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10a', 'c10b', 'c10c', 'c11'] as const;
/** Colonnes qui ne peuvent être négatives (montants d'origine, d'amortissement, de vente) ; les autres sont algébriques. */
export const CHAMPS_2059_A_POSITIFS: readonly string[] = ['c2', 'c3', 'c4', 'c5', 'c7'];
export const LIBELLES_COLONNES_2059_A: Record<string, string> = {
  c2: '2 Valeur d’origine',
  c3: '3 Valeur nette réévaluée',
  c4: '4 Amortissements pratiqués en franchise d’impôt',
  c5: '5 Autres amortissements',
  c6: '6 Valeur résiduelle',
  c7: '7 Prix de vente',
  c8: '8 Montant global de la plus-value ou de la moins-value',
  c9: '9 Court terme',
  c10a: '10 Long terme 19 %',
  c10b: '10 Long terme 15 % ou 12,80 %',
  c10c: '10 Long terme 0 %',
  c11: '11 Plus-value taxable à 19 %',
};

export interface LigneImmobilisation2059A {
  ligne: string;
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  nature: string | null;
  valeurs: Record<string, string> | null;
}
export interface LigneAutre2059A {
  ligne: string;
  libelle: string;
  colonnes: readonly string[];
  statut: StatutLigneSaisie;
  trace: TraceSaisie | null;
  valeurs: Record<string, string> | null;
}
export type TotalCadre2059A = { statut: 'etabli'; montant: ChaineDecimale } | { statut: 'abstention'; motifs: string[] };
export interface Formulaire2059AProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  immobilisations: LigneImmobilisation2059A[];
  autres: LigneAutre2059A[];
  cadres: { A: TotalCadre2059A; B: TotalCadre2059A; C: TotalCadre2059A };
  /** Totaux du cadre B par taux (colonne 10 : 19 %, 15 % ou 12,80 %, 0 %), mêmes conditions d'établissement que le cadre B : base des rapprochements indicatifs avec le 2058-A (D-153). */
  cadreBParTaux: { c10a: TotalCadre2059A; c10b: TotalCadre2059A; c10c: TotalCadre2059A };
  neant: TraceSaisie | null;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
export interface DemandeFormulaire2059A {
  versionDonnees: number;
  saisiesTableaux: readonly SaisieTableau[];
}

const trace = (s: SaisieTableau): TraceSaisie => ({ note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees });
const statutDe = (s: SaisieTableau | undefined, v: number): StatutLigneSaisie => (s === undefined ? 'a_saisir' : s.versionDonnees !== v ? 'a_revoir' : 'saisi');
const somme = (valeurs: Array<Record<string, string> | null>, cles: readonly string[]) =>
  valeurs.reduce((t, x) => (x === null ? t : cles.reduce((u, k) => (x[k] !== undefined ? u.plus(x[k]!) : u), t)), new Decimal(0));

export function preparerFormulaire2059A(demande: DemandeFormulaire2059A): Formulaire2059AProjet {
  const v = demande.versionDonnees;
  const im = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2059A_IM').map((s) => [s.ligne, s]));
  const aut = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2059A_AUT').map((s) => [s.ligne, s]));
  const immobilisations: LigneImmobilisation2059A[] = LIGNES_2059_A_IM.map((l) => {
    const s = im.get(l);
    const statut = statutDe(s, v);
    return { ligne: l, statut, trace: s ? trace(s) : null, nature: statut === 'saisi' ? s!.valeurs.nature ?? null : null, valeurs: statut === 'saisi' ? s!.valeurs : null };
  });
  const autres: LigneAutre2059A[] = LIGNES_2059_A_AUT.map((d) => {
    const s = aut.get(d.ligne);
    const statut = statutDe(s, v);
    return { ...d, statut, trace: s ? trace(s) : null, valeurs: statut === 'saisi' ? s!.valeurs : null };
  });
  const neantS = im.get('NEANT');
  const neantStatut = statutDe(neantS, v);
  const retenuesIm = immobilisations.filter((l) => l.statut === 'saisi');
  const retenuesAut = autres.filter((l) => l.statut === 'saisi');
  const etat: Formulaire2059AProjet['etat'] = retenuesIm.length + retenuesAut.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';

  const controles: ControleDetail[] = [];
  if (neantStatut === 'saisi' && etat === 'saisi') controles.push({ code: 'A59_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le tableau est déclaré « néant » ET porte des saisies : retirer l’une des deux ; les saisies sont retenues.' });
  for (const l of retenuesIm) {
    const x = l.valeurs!;
    if (x.c6 !== undefined && x.c7 !== undefined && x.c8 !== undefined) {
      const attendu = new Decimal(x.c7).minus(x.c6);
      if (!attendu.equals(x.c8)) controles.push({ code: `A59_PV_${l.ligne}`, statut: 'ecart', message: `Ligne ${Number(l.ligne)} : plus ou moins-value (col. 8) ${versChaine(new Decimal(x.c8))} différente de prix de vente − valeur résiduelle (col. 7 − col. 6) = ${versChaine(attendu)}. Contrôle indicatif.`, ecart: versChaine(new Decimal(x.c8).minus(attendu)) });
    }
    if (x.c8 !== undefined && (x.c9 !== undefined || x.c10a !== undefined || x.c10b !== undefined || x.c10c !== undefined)) {
      const q = somme([x], ['c9', 'c10a', 'c10b', 'c10c']);
      if (!q.equals(x.c8)) controles.push({ code: `A59_QUALIF_${l.ligne}`, statut: 'ecart', message: `Ligne ${Number(l.ligne)} : la qualification (col. 9 + col. 10 = ${versChaine(q)}) ne reprend pas le montant global de la colonne 8 (${versChaine(new Decimal(x.c8))}). Contrôle indicatif.`, ecart: versChaine(q.minus(x.c8)) });
    }
  }
  const sansLigne = LIGNES_2059_A_AUT.length - retenuesAut.length;
  if (sansLigne > 0 && etat === 'saisi') controles.push({ code: 'A59_LIGNES_FIXES', statut: 'non_verifie', message: `${sansLigne} ligne(s) de la rubrique II (13 à 16, 18 à 20) sans saisie retenue : aucune n’est présumée nulle ; les cadres A, B et C restent en abstention tant que les sept lignes ne sont pas saisies (zéro compris).` });
  controles.push({ code: 'A59_SANS_SAISIE', statut: 'non_verifie', message: 'Les lignes 1 à 12 non saisies sont des lignes non servies du formulaire (aucune cession déclarée sur ces lignes) ; l’exhaustivité des cessions relève du cabinet.' });

  const motifsCadres: string[] = [];
  if (etat === 'neant') motifsCadres.push('Tableau déclaré « néant » : aucun total à établir.');
  else if (etat === 'a_saisir') motifsCadres.push('Aucune ligne saisie et tableau non déclaré « néant ».');
  else {
    if (retenuesIm.length === 0) motifsCadres.push('Aucune cession saisie aux lignes 1 à 12.');
    if (sansLigne > 0) motifsCadres.push(`${sansLigne} ligne(s) fixe(s) de la rubrique II sans saisie (aucune présumée nulle).`);
  }
  const aRevoir = [...immobilisations, ...autres].filter((l) => l.statut === 'a_revoir').length;
  if (aRevoir > 0) motifsCadres.push(`${aRevoir} ligne(s) à revoir : données modifiées depuis la saisie.`);
  const tous = [...retenuesIm.map((l) => l.valeurs), ...retenuesAut.map((l) => l.valeurs)];
  const total = (cles: readonly string[]): TotalCadre2059A => (motifsCadres.length > 0 ? { statut: 'abstention', motifs: motifsCadres } : { statut: 'etabli', montant: versChaine(somme(tous, cles)) });

  return {
    statut: 'projet',
    etat,
    immobilisations,
    autres,
    cadres: { A: total(['c9']), B: total(['c10a', 'c10b', 'c10c']), C: total(['c11']) },
    cadreBParTaux: { c10a: total(['c10a']), c10b: total(['c10b']), c10c: total(['c10c']) },
    neant: neantS ? trace(neantS) : null,
    controles,
    nonPrepare: [
      'Identification de l’entreprise (SIREN, dénomination, adresse), numéro de dépôt et exercice : repris du dossier, non ressaisis ici.',
      'Détail des « Divers » de la ligne 20 sur note annexe : non préparé.',
      'Tableaux supplémentaires au-delà de douze lignes de cessions : non préparés.',
      'Report des totaux vers le 2058-A : AUCUN transfert automatique. Rapprochements INDICATIFS affichés au 2058-A (lignes WV, WH, WP et I6, que la notice rattache au 2059-A par « voir également » sans donner d’égalité) ; la répartition entre ces lignes reste la décision du cabinet. Report vers les 2059-B, C et D : non préparé.',
    ],
    limites: [
      'Chaque ligne est une saisie justifiée du cabinet ; la qualification en court ou long terme (et le taux) est celle saisie, jamais déduite ni décidée par le logiciel.',
      'Une case non remplie est une case vide du formulaire, jamais un zéro présumé ; « néant » est une déclaration explicite du tableau.',
      'Cadres A, B et C : totaux algébriques énoncés par le formulaire, établis seulement quand les sept lignes fixes et au moins une cession sont saisies.',
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
