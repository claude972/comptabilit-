/**
 * Moteur GÉNÉRIQUE des formulaires de la liasse servis par SAISIE CASE PAR CASE (D-118) : une définition (cases lues sur le formulaire officiel,
 * calculs que le formulaire énonce, contrôles indicatifs, bloc « résultat fiscal » éventuel) produit, avec les mêmes garanties que D-110 à D-117 :
 * justification obligatoire, trace (auteur, date, version des données), historique en ajout seul, « à revoir » si les données changent, NÉANT
 * explicite (0,00 déclaré) distinct d'une case non renseignée, abstention sans chiffre, aucune décision fiscale.
 *
 * Trois sortes de calculs, toutes explicitement bornées :
 *  - `calculs` : une case que le formulaire énonce comme somme ou différence d'autres cases (« TOTAL », « I moins II ») : calculée SEULEMENT
 *    quand toutes ses composantes sont saisies (néant compris), avec un éventuel plancher à zéro (instruction du formulaire) ;
 *  - `controles` : un total saisi rapproché de la somme de ses composantes, lu sur la DISPOSITION du formulaire (cellule fusionnée) : INDICATIF,
 *    jamais bloquant, jamais corrigé ;
 *  - `imputation` : bloc « résultat fiscal » (bénéfice / déficit avant imputation, déficit reporté en arrière, déficits antérieurs imputés, résultat
 *    après imputation) : plafond d'imputation de la notice (1 000 000 €, majoré de 50 % du bénéfice excédant ce montant), report en arrière non
 *    interprété (abstention), comme la partie B du 2033-B (D-110).
 * Les cases s'enregistrent dans `qualifications_resultat` sous la clé `<préfixe>_<code>` (aucune migration par formulaire).
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail, EtatCodeCase, QualificationRenvoi } from './detail-resultat.js';
import { MENTION_PROJET } from './sources-fiscales.js';

const ZERO = new Decimal(0);

export interface DefinitionCase {
  /** Code de case du formulaire (peut contenir « Ø » : zéro barré). */
  code: string;
  libelle: string;
  groupe: string;
  type?: 'montant' | 'entier' | 'oui_non';
  precision?: string;
}
export interface DefinitionCalcul {
  code: string;
  libelle: string;
  groupe: string;
  /** Composantes (codes de cases ou d'autres calculs) avec leur signe. */
  composantes: ReadonlyArray<{ code: string; signe: 1 | -1 }>;
  /** Plancher à zéro (instruction du formulaire : « reporter 0 si négatif »). */
  plancherZero?: boolean;
  /** Valeur absolue de la différence si elle est négative, ailleurs 0 (case « déficit » d'une paire bénéfice / déficit). */
  partieNegative?: boolean;
}
export interface DefinitionControle {
  code: string;
  libelle: string;
  /** Case totale saisie. */
  total: string;
  somme: ReadonlyArray<{ code: string; signe: 1 | -1 }>;
}
export interface DefinitionImputation {
  avantBenefice: string;
  avantDeficit: string;
  reportArriere: string;
  imputes: string;
  apresBenefice: string;
  apresDeficit: string;
}
/** Proposition reprise d'un AUTRE tableau (valeur énoncée par le formulaire : « total des lignes XB et XL du tableau 2058-A »), jamais retenue sans saisie. */
export interface DefinitionProposition {
  code: string;
  origine: string;
  /** Clés de valeurs d'autres tableaux (`valeursAutres`), additionnées ; « =CODE » désigne un calcul ou une saisie de CE tableau ; la proposition n'existe que si toutes sont présentes. */
  sources: readonly string[];
  /** Vrai : proposition seulement pour un exercice de 12 mois (« report … le cas échéant ajusté à 12 mois » : l'ajustement n'est pas calculé). */
  douzeMoisSeulement?: boolean;
}
/** Rapprochement INDICATIF d'un total calculé ou saisi avec la valeur d'une case d'un autre tableau (« à reporter ligne WI du tableau 2058-A »). */
export interface DefinitionControleExterne {
  code: string;
  libelle: string;
  /** Case (ou calcul) de ce tableau. */
  case: string;
  /** Clé de valeur d'un autre tableau. */
  externe: string;
}
export interface DefinitionFormulaire {
  id: string;
  titre: string;
  /** Préfixe des clés de saisie (≤ 3 caractères). */
  prefixe: string;
  source: string;
  groupes: ReadonlyArray<{ id: string; titre: string }>;
  cases: readonly DefinitionCase[];
  calculs: readonly DefinitionCalcul[];
  controles: readonly DefinitionControle[];
  imputation?: DefinitionImputation;
  propositions?: readonly DefinitionProposition[];
  controlesExternes?: readonly DefinitionControleExterne[];
  nonPrepare: readonly string[];
  limites: readonly string[];
}

/** Clé de stockage d'une case : zéro barré remplacé par 0, séparateur « _ ». */
export const cleCase = (prefixe: string, code: string): string => `${prefixe}_${code.replace(/Ø/g, '0').replace(/[^0-9A-Za-z]/g, '').toUpperCase()}`;

export interface CaseFormulaire extends DefinitionCase {
  cle: string;
  etatCodeCase: EtatCodeCase;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: ChaineDecimale | null;
  saisie: QualificationRenvoi | null;
  /** Proposition reprise d'un autre tableau (jamais retenue sans saisie). */
  proposition: { montant: ChaineDecimale; origine: string } | null;
}
export type CelluleCalc =
  | { statut: 'etabli'; montant: ChaineDecimale; code: string; etatCodeCase: EtatCodeCase; calcul: string; libelle: string; groupe: string }
  | { statut: 'abstention'; motifs: string[]; code: string; etatCodeCase: EtatCodeCase; libelle: string; groupe: string };
export type ResultatSigneFormulaire =
  | { statut: 'etabli'; sens: 'benefice' | 'deficit' | 'nul'; montant: ChaineDecimale; codeCase: string }
  | { statut: 'abstention'; motifs: string[]; codesCases: string[] };

export interface FormulaireProjet {
  statut: 'projet';
  id: string;
  titre: string;
  source: string;
  groupes: ReadonlyArray<{ id: string; titre: string }>;
  cases: CaseFormulaire[];
  calculs: CelluleCalc[];
  imputation: { avant: ResultatSigneFormulaire; plafond: { montant: ChaineDecimale; regle: string } | null; apres: ResultatSigneFormulaire } | null;
  controles: ControleDetail[];
  nonPrepare: readonly string[];
  limites: readonly string[];
  mention: string;
}

export interface DemandeFormulaire {
  versionDonnees: number;
  renvois: readonly QualificationRenvoi[];
  /** Valeurs établies d'autres tableaux (saisies retenues et calculs), par clé `<préfixe>_<code>` : propositions et rapprochements entre tableaux. */
  valeursAutres?: Readonly<Record<string, ChaineDecimale>>;
  /** Durée de l'exercice en mois (arrondie) : conditionne les propositions « 12 mois seulement ». */
  dureeMois?: number;
}

const SEUIL = new Decimal(1_000_000);

export function preparerFormulaireCases(def: DefinitionFormulaire, demande: DemandeFormulaire): FormulaireProjet {
  const saisies = new Map(demande.renvois.map((r) => [r.code, r]));
  const cases: CaseFormulaire[] = def.cases.map((c) => {
    const cle = cleCase(def.prefixe, c.code);
    const s = saisies.get(cle) ?? null;
    const statut = s === null ? 'a_saisir' : s.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    const montant = statut === 'saisi' ? s!.montant : null;
    const p = def.propositions?.find((x) => x.code === c.code);
    const autres = demande.valeursAutres ?? {};
    const proposition = p !== undefined && statut !== 'saisi' && p.sources.every((k) => !k.startsWith('=') && autres[k] !== undefined) ? { montant: versChaine(p.sources.reduce((a, k) => a.plus(autres[k]!), ZERO)), origine: p.origine } : null;
    return { ...c, cle, etatCodeCase: 'lu_verifie', statut, neant: montant !== null && new Decimal(montant).isZero(), montant, saisie: s, proposition };
  });
  const valeurs = new Map<string, Decimal | null>();
  for (const c of cases) valeurs.set(c.code, c.statut === 'saisi' ? new Decimal(c.montant!) : null);
  const calculs: CelluleCalc[] = [];
  for (const k of def.calculs) {
    const manquantes = k.composantes.filter((x) => valeurs.get(x.code) === null || valeurs.get(x.code) === undefined).map((x) => x.code);
    if (manquantes.length > 0) {
      calculs.push({ statut: 'abstention', motifs: [`Case(s) ${manquantes.join(', ')} sans saisie retenue : saisir un montant ou déclarer « néant » ; rien n’est présumé nul.`], code: k.code, etatCodeCase: 'lu_verifie', libelle: k.libelle, groupe: k.groupe });
      valeurs.set(k.code, null);
      continue;
    }
    let somme = k.composantes.reduce((a, x) => a.plus(valeurs.get(x.code)!.times(x.signe)), ZERO);
    if (k.partieNegative) somme = somme.isNegative() ? somme.negated() : ZERO;
    else if (k.plancherZero && somme.isNegative()) somme = ZERO;
    valeurs.set(k.code, somme);
    calculs.push({ statut: 'etabli', montant: versChaine(somme), code: k.code, etatCodeCase: 'lu_verifie', libelle: k.libelle, groupe: k.groupe, calcul: k.composantes.map((x, i) => `${i === 0 ? (x.signe === -1 ? '− ' : '') : x.signe === 1 ? '+ ' : '− '}${x.code}`).join(' ') });
  }
  // Propositions fondées sur un calcul ou une saisie de CE tableau (« =CODE »), connues seulement après les calculs.
  for (const p of def.propositions ?? []) {
    if (!p.sources.some((k) => k.startsWith('='))) continue;
    const cible = cases.find((c) => c.code === p.code);
    if (cible === undefined || cible.statut === 'saisi') continue;
    if (p.douzeMoisSeulement === true && demande.dureeMois !== 12) continue;
    const vals = p.sources.map((k) => (k.startsWith('=') ? valeurs.get(k.slice(1)) : undefined));
    if (vals.every((v) => v !== null && v !== undefined)) cible.proposition = { montant: versChaine(vals.reduce((a, v) => a.plus(v!), ZERO)), origine: p.origine };
  }
  const controles: ControleDetail[] = [];
  for (const k of def.controles) {
    const total = valeurs.get(k.total);
    const manque = k.somme.filter((x) => valeurs.get(x.code) === null || valeurs.get(x.code) === undefined);
    if (total === null || total === undefined || manque.length > 0) continue;
    const somme = k.somme.reduce((a, x) => a.plus(valeurs.get(x.code)!.times(x.signe)), ZERO);
    const ecart = total.minus(somme);
    controles.push(ecart.isZero()
      ? { code: `${def.prefixe}_${k.code}`, statut: 'coherent', message: `${k.libelle} : le total saisi égale la somme de ses composantes. Contrôle indicatif (lecture de la disposition du formulaire).` }
      : { code: `${def.prefixe}_${k.code}`, statut: 'ecart', message: `${k.libelle} : le total saisi (${versChaine(total)}) diffère de la somme de ses composantes (${versChaine(somme)}). Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
  }

  for (const k of def.controlesExternes ?? []) {
    const interne = valeurs.get(k.case);
    const externe = demande.valeursAutres?.[k.externe];
    if (interne === null || interne === undefined || externe === undefined) continue;
    const ecart = interne.minus(externe);
    controles.push(ecart.isZero()
      ? { code: `${def.prefixe}_${k.code}`, statut: 'coherent', message: `${k.libelle} : égal à la valeur de l’autre tableau (${versChaine(interne)}). Contrôle indicatif.` }
      : { code: `${def.prefixe}_${k.code}`, statut: 'ecart', message: `${k.libelle} : ${versChaine(interne)} ici contre ${versChaine(new Decimal(externe))} dans l’autre tableau : le formulaire demande de les reporter l’un sur l’autre. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
  }

  let imputation: FormulaireProjet['imputation'] = null;
  if (def.imputation !== undefined) {
    const i = def.imputation;
    const b = valeurs.get(i.avantBenefice);
    const d = valeurs.get(i.avantDeficit);
    const abst = (motifs: string[], codes: string[]): ResultatSigneFormulaire => ({ statut: 'abstention', motifs, codesCases: codes });
    let avant: ResultatSigneFormulaire;
    if (b === null || b === undefined || d === null || d === undefined) avant = abst(['Les totaux I et II ne sont pas tous deux établis : le résultat fiscal avant imputation n’est pas calculé.'], [i.avantBenefice, i.avantDeficit]);
    else avant = b.greaterThan(0) ? { statut: 'etabli', sens: 'benefice', montant: versChaine(b), codeCase: i.avantBenefice } : d.greaterThan(0) ? { statut: 'etabli', sens: 'deficit', montant: versChaine(d), codeCase: i.avantDeficit } : { statut: 'etabli', sens: 'nul', montant: '0.00', codeCase: i.avantBenefice };
    let plafond: NonNullable<FormulaireProjet['imputation']>['plafond'] = null;
    if (avant.statut === 'etabli' && avant.sens === 'benefice') {
      const ben = new Decimal(avant.montant);
      plafond = { montant: versChaine(Decimal.min(SEUIL.plus(Decimal.max(ZERO, ben.minus(SEUIL)).times('0.5')), ben)), regle: 'Déficits antérieurs imputables dans la limite de 1 000 000 €, majorée de 50 % du bénéfice excédant ce montant, sans excéder le bénéfice (notice 2032-NOT-SD ; art. 209, I du CGI).' };
    }
    const reporte = valeurs.get(i.reportArriere);
    const imputes = valeurs.get(i.imputes);
    const motifs: string[] = [];
    if (avant.statut === 'abstention') motifs.push('Le résultat fiscal avant imputation n’est pas établi.');
    const manquantes = [reporte === null || reporte === undefined ? i.reportArriere : null, imputes === null || imputes === undefined ? i.imputes : null].filter((x): x is string => x !== null);
    if (manquantes.length > 0) motifs.push(`Case(s) ${manquantes.join(', ')} sans saisie retenue : saisir un montant ou déclarer « néant ».`);
    if (reporte !== null && reporte !== undefined && !reporte.isZero()) motifs.push(`Un déficit est reporté en arrière (case ${i.reportArriere}) : son effet sur le résultat après imputation n’est pas établi par Comtaple (créance, déclaration 2039-SD) : abstention.`);
    let apres: ResultatSigneFormulaire = abst(motifs, [i.apresBenefice, i.apresDeficit]);
    if (motifs.length === 0 && avant.statut === 'etabli' && imputes !== null && imputes !== undefined) {
      if (avant.sens === 'benefice') {
        const ben = new Decimal(avant.montant);
        if (imputes.greaterThan(plafond!.montant)) {
          controles.push({ code: `${def.prefixe}_IMPUTATION`, statut: 'ecart', message: `Déficits imputés (${versChaine(imputes)}) supérieurs au plafond d’imputation (${plafond!.montant}) : non retenu, à corriger.`, ecart: versChaine(imputes.minus(plafond!.montant)) });
          apres = abst([`Les déficits imputés dépassent le plafond d’imputation de ${plafond!.montant}.`], [i.apresBenefice, i.apresDeficit]);
        } else {
          const r = ben.minus(imputes);
          apres = { statut: 'etabli', sens: r.isZero() ? 'nul' : 'benefice', montant: versChaine(r), codeCase: i.apresBenefice };
          controles.push({ code: `${def.prefixe}_IMPUTATION`, statut: 'coherent', message: `Imputation de ${versChaine(imputes)} (plafond ${plafond!.montant}) : résultat fiscal après imputation ${versChaine(r)}.` });
        }
      } else if (!imputes.isZero()) {
        controles.push({ code: `${def.prefixe}_IMPUTATION`, statut: 'ecart', message: `Des déficits sont imputés (${versChaine(imputes)}) alors que le résultat avant imputation n’est pas un bénéfice : non retenu.`, ecart: versChaine(imputes) });
        apres = abst(['Des déficits sont imputés alors que le résultat avant imputation n’est pas un bénéfice.'], [i.apresBenefice, i.apresDeficit]);
      } else apres = avant.sens === 'deficit' ? { statut: 'etabli', sens: 'deficit', montant: avant.montant, codeCase: i.apresDeficit } : { statut: 'etabli', sens: 'nul', montant: '0.00', codeCase: i.apresBenefice };
    }
    imputation = { avant, plafond, apres };
  }
  const sansSaisie = cases.filter((c) => c.statut !== 'saisi').length;
  controles.push({ code: `${def.prefixe}_SANS_SAISIE`, statut: 'non_verifie', message: `${sansSaisie} case(s) sur ${cases.length} sans saisie retenue : aucune n’est présumée nulle ; seules les cases saisies (néant compris) sont comptées.` });
  return { statut: 'projet', id: def.id, titre: def.titre, source: def.source, groupes: def.groupes, cases, calculs, imputation, controles, nonPrepare: def.nonPrepare, limites: def.limites, mention: MENTION_PROJET };
}
