/**
 * Reprise explicite de la ventilation des en-cours et produits dans les cases BN à BS du projet 2050 (D-170).
 *
 * Entrée : la grille `2050-STOCKS` préparée (saisies justifiées du cabinet, contrôles de rapprochement avec le projet de bilan). Sortie : pour chaque case (BN, BO, BP, BQ, BR, BS), un montant RETENU
 * ou une ABSTENTION motivée. Principes : aucune reprise sans décision explicite et justifiée (ligne REPRISE = « oui » sur la version courante des données) ; aucune case reprise si le montant
 * ventilé n'égale pas exactement le montant source du projet de bilan (aucun écrasement, aucune correction) ; le bilan source n'est jamais modifié et les totaux du 2050 restent ceux du projet de
 * bilan : les cases BN à BS sont du DÉTAIL de ces montants, jamais ajouté aux totaux (pas de double comptage). Statut « projet ».
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { GrilleProjet } from './formulaire-grilles.js';
import type { TraceSaisie } from './saisies-tableaux.js';

export interface CaseReprise2050 {
  code: 'BN' | 'BO' | 'BP' | 'BQ' | 'BR' | 'BS';
  libelle: string;
  /** Montant retenu ; `null` : abstention. */
  montant: ChaineDecimale | null;
  statut: 'repris' | 'abstention';
  motif: string | null;
}
export interface Reprise2050Stocks {
  statut: 'projet';
  etat: 'aucune_decision' | 'decision_a_revoir' | 'decision_retiree' | 'decidee';
  decision: TraceSaisie | null;
  cases: CaseReprise2050[];
  /** Totaux des en-cours RETENUS (BN + BP, BO + BQ) : `null` si l'une des quatre cases manque. */
  totalEnCours: { brut: ChaineDecimale | null; amortissements: ChaineDecimale | null };
  /** Montants sources du projet de bilan (comptes 33 et 34, 35 ; dépréciations 393 à 395), tels que rapprochés ; absents : `null`. */
  sources: { enCoursBrut: ChaineDecimale | null; enCoursAmortissements: ChaineDecimale | null; produitsBrut: ChaineDecimale | null; produitsAmortissements: ChaineDecimale | null };
  notes: string[];
}

const DEFINITION: ReadonlyArray<{ code: CaseReprise2050['code']; libelle: string; ligne: 'ECB' | 'ECS' | 'PIF'; colonne: 'c1' | 'c2'; controle: string }> = [
  { code: 'BN', libelle: 'En cours de production de biens — brut', ligne: 'ECB', colonne: 'c1', controle: 'EN_COURS_BRUT' },
  { code: 'BO', libelle: 'En cours de production de biens — amortissements et provisions', ligne: 'ECB', colonne: 'c2', controle: 'EN_COURS_AMORT' },
  { code: 'BP', libelle: 'En cours de production de services — brut', ligne: 'ECS', colonne: 'c1', controle: 'EN_COURS_BRUT' },
  { code: 'BQ', libelle: 'En cours de production de services — amortissements et provisions', ligne: 'ECS', colonne: 'c2', controle: 'EN_COURS_AMORT' },
  { code: 'BR', libelle: 'Produits intermédiaires et finis — brut', ligne: 'PIF', colonne: 'c1', controle: 'PIF_BRUT' },
  { code: 'BS', libelle: 'Produits intermédiaires et finis — amortissements et provisions', ligne: 'PIF', colonne: 'c2', controle: 'PIF_AMORT' },
];

export function reprendreVentilation2050(g: GrilleProjet, sourceBilan: Readonly<Record<string, string>>): Reprise2050Stocks {
  const cadre = g.cadres.find((c) => c.tableau === '2050_STOCKS');
  const ligneDe = (l: string) => cadre?.lignes.find((x) => x.ligne === l);
  const rep = ligneDe('REPRISE');
  const oui = rep?.statut === 'saisi' && rep.valeurs?.v === 'oui';
  const etat: Reprise2050Stocks['etat'] = rep === undefined || rep.statut === 'a_saisir' ? 'aucune_decision' : rep.statut === 'a_revoir' ? 'decision_a_revoir' : oui ? 'decidee' : 'decision_retiree';
  const motifAbsence = etat === 'aucune_decision' ? 'aucune reprise décidée : la ventilation reste une annexe, la case est en abstention' : etat === 'decision_a_revoir' ? 'décision de reprise prise sur une version antérieure des données : à revoir, case en abstention' : 'reprise retirée par le cabinet : case en abstention';
  const cases: CaseReprise2050[] = DEFINITION.map((d) => {
    if (!oui) return { code: d.code, libelle: d.libelle, montant: null, statut: 'abstention', motif: motifAbsence };
    const l = ligneDe(d.ligne);
    const v = l?.statut === 'saisi' ? l.valeurs?.[d.colonne] : undefined;
    if (v === undefined) return { code: d.code, libelle: d.libelle, montant: null, statut: 'abstention', motif: `ligne « ${d.ligne} » non saisie sur la version courante des données : rien n’est présumé nul` };
    const k = g.controles.find((c) => c.code === `${g.id}_${d.controle}`);
    if (k?.statut === 'coherent') return { code: d.code, libelle: d.libelle, montant: v, statut: 'repris', motif: null };
    if (k?.statut === 'ecart') return { code: d.code, libelle: d.libelle, montant: null, statut: 'abstention', motif: `le montant ventilé diffère du montant source du projet de bilan (écart ${k.ecart ?? 'non calculé'}) : reprise non appliquée, rien n’est corrigé ni écrasé` };
    return { code: d.code, libelle: d.libelle, montant: null, statut: 'abstention', motif: 'rapprochement avec le montant source impossible (ligne voisine non saisie ou montant source absent) : reprise non appliquée' };
  });
  const m = (c: CaseReprise2050['code']) => cases.find((x) => x.code === c)!.montant;
  const somme = (a: CaseReprise2050['code'], b: CaseReprise2050['code']): ChaineDecimale | null => (m(a) !== null && m(b) !== null ? versChaine(new Decimal(m(a)!).plus(m(b)!)) : null);
  const src = (cle: string): ChaineDecimale | null => sourceBilan[cle] ?? null;
  return {
    statut: 'projet',
    etat,
    decision: rep?.trace ?? null,
    cases,
    totalEnCours: { brut: somme('BN', 'BP'), amortissements: somme('BO', 'BQ') },
    sources: { enCoursBrut: src('BIL_EN_COURS_BRUT'), enCoursAmortissements: src('BIL_EN_COURS_AMORT'), produitsBrut: src('BIL_PIF_BRUT'), produitsAmortissements: src('BIL_PIF_AMORT') },
    notes: [
      'Les cases BN à BS sont du DÉTAIL des postes « en-cours de production » et « produits » du projet de bilan : elles ne sont jamais ajoutées aux totaux du 2050, qui restent ceux du projet de bilan (aucun double comptage).',
      'Le projet de bilan n’est jamais réécrit ; une case dont le montant ventilé diffère du montant source reste en abstention, avec l’écart.',
      'Statut « projet » : aucune validation professionnelle, aucune déclaration.',
    ],
  };
}
