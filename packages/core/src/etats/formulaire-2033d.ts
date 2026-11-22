/**
 * Tableau 2033-D-SD « Relevé des provisions, amortissements dérogatoires, déficits reportables, divers » (D-114), régime simplifié.
 *
 * Servi par SAISIE CASE PAR CASE (cadres I, II et III) et ligne par ligne (cadre C, dotations non déductibles), avec les mêmes garanties que
 * les tranches D-110 à D-113 : justification obligatoire, trace (auteur, date, version des données), historique en ajout seul, « à revoir »
 * quand les données changent, NÉANT explicite (0,00 déclaré) distinct d'une case non renseignée, abstention sans saisie, aucune décision
 * fiscale prise par le logiciel.
 *
 * Seul le calcul que le formulaire ou sa notice énonce est fait :
 *  - case 870 « total des déficits restant à reporter » = 984 + 860 (notice 2033-NOT-SD : « somme des cases 984 et 860 ») ;
 *  - case 780 = total des sept lignes du cadre C (« TOTAL à reporter ligne 322 du tableau 2033-B-SD ») ;
 *  - cases 983 et 860 : la notice les identifie à la ligne 360 (déficits imputés) et à la ligne 372 (déficit de l'exercice) du 2033-B : elles
 *    sont PROPOSÉES par la partie B du 2033-B quand celle-ci est établie, jamais retenues sans saisie (même principe que les propositions de renvois).
 * Tous les autres rapprochements (début + augmentations − diminutions = fin ; totaux de colonnes ; 770 / 775 ; 780 et case 322) sont des
 * CONTRÔLES INDICATIFS : jamais bloquants, jamais corrigés. Cadre IV (travailleurs indépendants, cases 690 à 693) : hors périmètre (société à l'IS).
 *
 * Cases lues sur `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), page 4, par extraction positionnée puis VÉRIFIÉES sur le rendu image le 2026-11-22.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail, EtatCodeCase, QualificationRenvoi, ResultatFiscalProjet } from './detail-resultat.js';
import { MENTION_PROJET } from './sources-fiscales.js';
import type { SaisieTableau, TraceSaisie } from './saisies-tableaux.js';

const ZERO = new Decimal(0);

export type TypeCase = 'montant' | 'entier';

export interface DefinitionCase2033D {
  cle: string;
  codeCase: string;
  libelle: string;
  cadre: 'I-A' | 'I-B' | 'II' | 'III';
  type: TypeCase;
  precision?: string;
}

/** Cadre I-A : provisions (début, augmentations, diminutions, fin). Lignes puis colonnes. */
export const LIGNES_PROVISIONS: ReadonlyArray<{ id: string; libelle: string; cases: readonly [string, string, string, string] }> = [
  { id: 'AD', libelle: 'Provisions réglementées : amortissements dérogatoires', cases: ['600', '602', '604', '606'] },
  { id: 'AD30', libelle: 'dont majorations exceptionnelles de 30 %', cases: ['601', '603', '605', '607'] },
  { id: 'APR', libelle: 'Provisions réglementées : autres provisions réglementées', cases: ['610', '612', '614', '616'] },
  { id: 'PRC', libelle: 'Provisions pour risques et charges', cases: ['620', '622', '624', '626'] },
  { id: 'DIM', libelle: 'Provisions pour dépréciation : sur immobilisations', cases: ['630', '632', '634', '636'] },
  { id: 'DST', libelle: 'Provisions pour dépréciation : sur stocks et en cours', cases: ['640', '642', '644', '646'] },
  { id: 'DCL', libelle: 'Provisions pour dépréciation : sur comptes clients', cases: ['650', '652', '654', '656'] },
  { id: 'DAU', libelle: 'Provisions pour dépréciation : autres provisions pour dépréciation', cases: ['660', '662', '664', '666'] },
  { id: 'TOTAL', libelle: 'TOTAL', cases: ['680', '682', '684', '686'] },
];
export const COLONNES_PROVISIONS = ['Montant au début de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : reprises de l’exercice', 'Montant à la fin de l’exercice'] as const;

/** Cadre I-B : mouvements affectant la provision pour amortissements dérogatoires (dotations, reprises). */
export const LIGNES_DEROGATOIRES: ReadonlyArray<{ id: string; libelle: string; cases: readonly [string, string] }> = [
  { id: 'FC', libelle: 'Fonds commercial', cases: ['681', '683'] },
  { id: 'INC', libelle: 'Autres immobilisations incorporelles', cases: ['700', '705'] },
  { id: 'TER', libelle: 'Terrains', cases: ['710', '715'] },
  { id: 'CON', libelle: 'Constructions', cases: ['720', '725'] },
  { id: 'ITM', libelle: 'Installations techniques, matériel et outillage', cases: ['730', '735'] },
  { id: 'IGA', libelle: 'Installations générales, agencements et aménagements divers', cases: ['740', '745'] },
  { id: 'MTR', libelle: 'Matériel de transport', cases: ['750', '755'] },
  { id: 'AIC', libelle: 'Autres immobilisations corporelles', cases: ['760', '765'] },
  { id: 'TOTAL', libelle: 'TOTAL', cases: ['770', '775'] },
];

const casesDefinitions = (): DefinitionCase2033D[] => {
  const d: DefinitionCase2033D[] = [];
  for (const l of LIGNES_PROVISIONS) l.cases.forEach((code, i) => d.push({ cle: `D_${code}`, codeCase: code, libelle: `${l.libelle} — ${COLONNES_PROVISIONS[i]}`, cadre: 'I-A', type: 'montant' }));
  for (const l of LIGNES_DEROGATOIRES) l.cases.forEach((code, i) => d.push({ cle: `D_${code}`, codeCase: code, libelle: `Amortissements dérogatoires, ${l.libelle} — ${i === 0 ? 'dotations' : 'reprises'}`, cadre: 'I-B', type: 'montant' }));
  d.push(
    { cle: 'D_982', codeCase: '982', libelle: 'Déficits restant à reporter au titre de l’exercice précédent', cadre: 'II', type: 'montant', precision: 'Montant porté ligne 870 du 2033-D de l’exercice précédent (notice) : à saisir, jamais déduit.' },
    { cle: 'D_982B', codeCase: '982 bis', libelle: 'Déficits transférés de plein droit (art. 209, II-2 du CGI)', cadre: 'II', type: 'montant', precision: 'Identifier, opération par opération, la société d’origine sur feuillet séparé (formulaire, renvoi 2).' },
    { cle: 'D_982T', codeCase: '982 ter', libelle: 'Nombre d’opérations sur l’exercice (déficits transférés de plein droit)', cadre: 'II', type: 'entier' },
    { cle: 'D_983', codeCase: '983', libelle: 'Déficits imputés', cadre: 'II', type: 'montant', precision: 'La notice l’identifie à la ligne 360 du 2033-B : proposition reprise de la partie B quand elle est établie.' },
    { cle: 'D_984', codeCase: '984', libelle: 'Déficits reportables (fraction non imputée, reportable sans limite de durée)', cadre: 'II', type: 'montant' },
    { cle: 'D_860', codeCase: '860', libelle: 'Déficits de l’exercice', cadre: 'II', type: 'montant', precision: 'La notice l’identifie à la ligne 372 du 2033-B : proposition reprise de la partie B quand elle est établie.' },
    { cle: 'D_381', codeCase: '381', libelle: 'Primes et cotisations complémentaires facultatives', cadre: 'III', type: 'montant' },
    { cle: 'D_325', codeCase: '325', libelle: 'dont montant déductible des cotisations facultatives versées en application du I de l’article 154 bis du CGI (cotisations Madelin)', cadre: 'III', type: 'montant' },
    { cle: 'D_327', codeCase: '327', libelle: 'dont cotisations facultatives aux nouveaux plans d’épargne retraite', cadre: 'III', type: 'montant' },
    { cle: 'D_374', codeCase: '374', libelle: 'Montant de la TVA collectée', cadre: 'III', type: 'montant' },
    { cle: 'D_378', codeCase: '378', libelle: 'Montant de la TVA déductible sur biens et services (sauf immobilisations)', cadre: 'III', type: 'montant' },
    { cle: 'D_399', codeCase: '399', libelle: 'Montant des prélèvements personnels de l’exploitant', cadre: 'III', type: 'montant', precision: 'Notice : prélèvements de marchandises ou financiers effectués par l’exploitant ou le dirigeant pour ses besoins personnels ou ceux de ses salariés.' },
    { cle: 'D_398', codeCase: '398', libelle: 'Aides perçues ayant donné droit à la réduction d’impôt prévue au 4 de l’article 238 bis du CGI pour l’entreprise donatrice', cadre: 'III', type: 'montant' },
    { cle: 'D_397', codeCase: '397', libelle: 'Montant de l’investissement reçu ayant donné lieu à amortissement exceptionnel chez l’entreprise investisseur (art. 217 octies du CGI)', cadre: 'III', type: 'montant' },
  );
  return d;
};
export const CASES_2033_D: readonly DefinitionCase2033D[] = casesDefinitions();
export const CLES_2033_D: readonly string[] = CASES_2033_D.map((c) => c.cle);
export const LIGNES_CADRE_C = ['01', '02', '03', '04', '05', '06', '07'] as const;

export interface CaseSaisie2033D {
  cle: string;
  codeCase: string;
  etatCodeCase: EtatCodeCase;
  libelle: string;
  cadre: DefinitionCase2033D['cadre'];
  type: TypeCase;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  neant: boolean;
  montant: ChaineDecimale | null;
  saisie: QualificationRenvoi | null;
  precision: string | null;
  /** Proposition reprise du 2033-B (cases 983 et 860) : jamais retenue sans saisie. */
  proposition: { montant: ChaineDecimale; origine: string } | null;
}

export interface LigneCadreC {
  ligne: string;
  statut: 'a_saisir' | 'saisi' | 'a_revoir';
  trace: TraceSaisie | null;
  nature: string | null;
  montant: ChaineDecimale | null;
}

export type CelluleCalculee2033D =
  | { statut: 'etabli'; montant: ChaineDecimale; codeCase: string; etatCodeCase: EtatCodeCase; calcul: string }
  | { statut: 'abstention'; motifs: string[]; codeCase: string; etatCodeCase: EtatCodeCase };

export interface Formulaire2033DProjet {
  statut: 'projet';
  cases: CaseSaisie2033D[];
  cadreC: { etat: 'a_saisir' | 'neant' | 'saisi'; lignes: LigneCadreC[]; total780: CelluleCalculee2033D; neant: TraceSaisie | null };
  /** Case 870 = 984 + 860 (notice). */
  total870: CelluleCalculee2033D;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}

export interface DemandeFormulaire2033D {
  versionDonnees: number;
  /** Saisies de cases (clés `D_…`), mêmes règles que les renvois. */
  renvois: readonly QualificationRenvoi[];
  /** Saisies de tableaux (cadre C : tableau `2033D_C`). */
  saisiesTableaux: readonly SaisieTableau[];
  /** Partie B du 2033-B, pour les propositions 983 et 860 et le contrôle de la case 322. */
  resultatFiscal: ResultatFiscalProjet | null;
}

const etabli = (m: Decimal, codeCase: string, calcul: string): CelluleCalculee2033D => ({ statut: 'etabli', montant: versChaine(m), codeCase, etatCodeCase: 'lu_verifie', calcul });
const abstention = (motifs: string[], codeCase: string): CelluleCalculee2033D => ({ statut: 'abstention', motifs, codeCase, etatCodeCase: 'lu_verifie' });

export function preparerFormulaire2033D(demande: DemandeFormulaire2033D): Formulaire2033DProjet {
  const saisies = new Map(demande.renvois.map((r) => [r.code, r]));
  const rf = demande.resultatFiscal;
  const propositionPour = (cle: string): CaseSaisie2033D['proposition'] => {
    if (rf === null) return null;
    if (cle === 'D_983') {
      const l = rf.lignes.find((x) => x.cle === 'RF_360');
      return l !== undefined && l.statut === 'saisi' && l.montant !== null ? { montant: l.montant, origine: 'Ligne 360 du 2033-B (déficits antérieurs imputés), saisie du cabinet' } : null;
    }
    if (cle === 'D_860') {
      const a = rf.apresImputation;
      return a.statut === 'etabli' && a.sens === 'deficit' ? { montant: a.montant, origine: 'Ligne 372 du 2033-B (résultat fiscal après imputation : déficit)' } : null;
    }
    return null;
  };
  const cases: CaseSaisie2033D[] = CASES_2033_D.map((def) => {
    const s = saisies.get(def.cle) ?? null;
    const statut = s === null ? 'a_saisir' : s.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    const montant = statut === 'saisi' ? s!.montant : null;
    return { cle: def.cle, codeCase: def.codeCase, etatCodeCase: 'lu_verifie', libelle: def.libelle, cadre: def.cadre, type: def.type, statut, neant: montant !== null && new Decimal(montant).isZero(), montant, saisie: s, precision: def.precision ?? null, proposition: statut === 'saisi' ? null : propositionPour(def.cle) };
  });
  const parCode = (code: string) => cases.find((c) => c.codeCase === code)!;
  const valeur = (code: string): Decimal | null => {
    const c = parCode(code);
    return c.statut === 'saisi' ? new Decimal(c.montant!) : null;
  };
  const controles: ControleDetail[] = [];

  // Cadre C : sept lignes (nature + montant) servies par saisie de tableau `2033D_C`.
  const tableauC = demande.saisiesTableaux.filter((s) => s.tableau === '2033D_C');
  const parLigne = new Map(tableauC.map((s) => [s.ligne, s]));
  const lignesC: LigneCadreC[] = LIGNES_CADRE_C.map((ligne) => {
    const s = parLigne.get(ligne);
    const statut = s === undefined ? 'a_saisir' : s.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
    return { ligne, statut, trace: s ? { note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees } : null, nature: statut === 'saisi' ? s!.valeurs.nature ?? null : null, montant: statut === 'saisi' ? s!.valeurs.montant ?? null : null };
  });
  const neantC = parLigne.get('NEANT');
  const neantStatut = neantC === undefined ? 'a_saisir' : neantC.versionDonnees !== demande.versionDonnees ? 'a_revoir' : 'saisi';
  const retenuesC = lignesC.filter((l) => l.statut === 'saisi');
  const aRevoirC = lignesC.filter((l) => l.statut === 'a_revoir').length + (neantStatut === 'a_revoir' ? 1 : 0);
  const etatC: 'a_saisir' | 'neant' | 'saisi' = retenuesC.length > 0 ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const motifsC: string[] = [];
  if (etatC === 'a_saisir') motifsC.push('Aucune ligne saisie et le cadre C n’est pas déclaré « néant » : rien n’est présumé nul.');
  if (aRevoirC > 0) motifsC.push(`${aRevoirC} saisie(s) donnée(s) sur une autre version des données (« à revoir ») ne comptent plus.`);
  const total780 = motifsC.length > 0 ? abstention(motifsC, '780') : etabli(etatC === 'neant' ? ZERO : retenuesC.reduce((a, l) => a.plus(l.montant!), ZERO), '780', 'Total des sept lignes du cadre C (formulaire : « TOTAL à reporter ligne 322 du tableau 2033-B-SD »)');
  if (retenuesC.length > 0 && neantStatut === 'saisi') controles.push({ code: 'D_C_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le cadre C est déclaré « néant » ET porte des lignes : retirer l’une des deux saisies ; les lignes saisies sont retenues.' });
  // Contrôle indicatif : 780 est « à reporter ligne 322 » du 2033-B (provisions non déductibles).
  const l322 = rf?.lignes.find((x) => x.cle === 'RF_322');
  if (total780.statut === 'etabli' && l322 !== undefined && l322.statut === 'saisi') {
    const ecart = new Decimal(total780.montant).minus(l322.montant!);
    controles.push(ecart.isZero()
      ? { code: 'D_780_322', statut: 'coherent', message: `Le total du cadre C (${total780.montant}) égale la case 322 saisie au 2033-B. Contrôle indicatif.` }
      : { code: 'D_780_322', statut: 'ecart', message: `Le total du cadre C (${total780.montant}) diffère de la case 322 saisie au 2033-B (${l322.montant}) : le formulaire demande de reporter l’un sur l’autre. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
  }

  // Case 870 = 984 + 860 (notice).
  const v984 = valeur('984'), v860 = valeur('860');
  const manquants870 = [v984 === null ? '984' : null, v860 === null ? '860' : null].filter((x): x is string => x !== null);
  const total870: CelluleCalculee2033D = manquants870.length > 0 ? abstention([`Case(s) ${manquants870.join(', ')} sans saisie retenue : saisir un montant ou déclarer « néant » ; rien n’est présumé nul.`], '870') : etabli(v984!.plus(v860!), '870', 'Somme des cases 984 et 860 (notice 2033-NOT-SD)');

  // Contrôles indicatifs du cadre I-A : début + augmentations − diminutions = fin ; totaux de colonnes ; 770 / 775 ; 983 et 860 avec le 2033-B.
  for (const l of LIGNES_PROVISIONS) {
    const [a, b, c, f] = l.cases.map(valeur);
    if (a !== null && b !== null && c !== null && f !== null) {
      const ecart = f!.minus(a!.plus(b!).minus(c!));
      controles.push(ecart.isZero()
        ? { code: `D_FIN_${l.id}`, statut: 'coherent', message: `${l.libelle} : début + augmentations − diminutions = fin. Contrôle indicatif.` }
        : { code: `D_FIN_${l.id}`, statut: 'ecart', message: `${l.libelle} : la fin (${versChaine(f!)}) diffère de début + augmentations − diminutions (${versChaine(a!.plus(b!).minus(c!))}). Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  }
  const sommeColonne = (i: number, ids: string[]): Decimal | null => {
    const v = ids.map((id) => valeur(LIGNES_PROVISIONS.find((l) => l.id === id)!.cases[i]!));
    return v.some((x) => x === null) ? null : v.reduce((acc, x) => acc!.plus(x!), ZERO);
  };
  for (let i = 0; i < 4; i++) {
    const somme = sommeColonne(i, ['AD', 'APR', 'PRC', 'DIM', 'DST', 'DCL', 'DAU']); // « dont majorations » n'est pas additionnée
    const tot = valeur(LIGNES_PROVISIONS.at(-1)!.cases[i]!);
    if (somme !== null && tot !== null) {
      const ecart = tot.minus(somme);
      controles.push(ecart.isZero()
        ? { code: `D_TOTAL_COL${i + 1}`, statut: 'coherent', message: `Colonne ${i + 1} du cadre I-A : le total égale la somme des lignes (hors « dont majorations »). Contrôle indicatif.` }
        : { code: `D_TOTAL_COL${i + 1}`, statut: 'ecart', message: `Colonne ${i + 1} du cadre I-A : le total (${versChaine(tot)}) diffère de la somme des lignes (${versChaine(somme)}). Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  }
  for (let i = 0; i < 2; i++) {
    const ids = LIGNES_DEROGATOIRES.filter((l) => l.id !== 'TOTAL').map((l) => valeur(l.cases[i]!));
    const tot = valeur(LIGNES_DEROGATOIRES.at(-1)!.cases[i]!);
    if (!ids.some((x) => x === null) && tot !== null) {
      const somme = ids.reduce((acc, x) => acc!.plus(x!), ZERO)!;
      const ecart = tot.minus(somme);
      controles.push(ecart.isZero()
        ? { code: `D_DEROG_${i === 0 ? '770' : '775'}`, statut: 'coherent', message: `Cadre I-B, ${i === 0 ? 'dotations (770)' : 'reprises (775)'} : le total égale la somme des lignes. Contrôle indicatif.` }
        : { code: `D_DEROG_${i === 0 ? '770' : '775'}`, statut: 'ecart', message: `Cadre I-B, ${i === 0 ? 'dotations (770)' : 'reprises (775)'} : le total (${versChaine(tot)}) diffère de la somme des lignes (${versChaine(somme)}). Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  }
  for (const code of ['983', '860'] as const) {
    const c = parCode(code);
    const ref = propositionPour(`D_${code}`);
    if (c.statut === 'saisi' && ref !== null) {
      const ecart = new Decimal(c.montant!).minus(ref.montant);
      controles.push(ecart.isZero()
        ? { code: `D_${code}_2033B`, statut: 'coherent', message: `Case ${code} égale la valeur du 2033-B (${ref.origine}). Contrôle indicatif.` }
        : { code: `D_${code}_2033B`, statut: 'ecart', message: `Case ${code} (${c.montant}) diffère de la valeur du 2033-B (${ref.montant}) : le formulaire demande de les reporter l’une sur l’autre. Rien n’est corrigé. Contrôle indicatif.`, ecart: versChaine(ecart) });
    }
  }
  const ctrl982B = parCode('982 bis'), ctrl982T = parCode('982 ter');
  if (ctrl982B.statut === 'saisi' && !new Decimal(ctrl982B.montant!).isZero() && ctrl982T.statut === 'saisi' && new Decimal(ctrl982T.montant!).isZero()) controles.push({ code: 'D_982_OPERATIONS', statut: 'ecart', message: 'Des déficits sont transférés de plein droit (982 bis) mais le nombre d’opérations (982 ter) est nul : à vérifier.' });
  const nonSaisies = cases.filter((c) => c.statut !== 'saisi').length;
  controles.push({ code: 'D_CASES_SANS_SAISIE', statut: 'non_verifie', message: `${nonSaisies} case(s) sur ${cases.length} sans saisie retenue : aucune n’est présumée nulle ; seules les cases saisies (néant compris) sont comptées.` });

  return {
    statut: 'projet',
    cases,
    cadreC: { etat: etatC, lignes: lignesC, total780, neant: neantC ? { note: neantC.note, qualifieePar: neantC.qualifieePar, le: neantC.le, versionDonnees: neantC.versionDonnees } : null },
    total870,
    controles,
    nonPrepare: [
      'Cadre IV « Travailleurs indépendants » (cases 690, 691, 692, 693 : revenu brut social) : hors périmètre, la préparation ne couvre que la société commerciale à l’impôt sur les sociétés.',
      'Feuillet séparé des déficits transférés de plein droit (identification de la société d’origine, opération par opération) : non préparé.',
      'Au-delà de sept lignes, le cadre C exige un état du même modèle joint : non préparé.',
      'Explications de la notice sur chaque case (nature des provisions, calcul du déductible) : consultables dans la notice 2033-NOT-SD ; aucune décision fiscale n’est prise par Comtaple.',
    ],
    limites: [
      'Chaque case est une saisie justifiée du cabinet : la balance ne distingue pas les provisions réglementées, les déficits reportables ni les primes facultatives. « Néant » est une déclaration explicite ; une case sans saisie n’est jamais présumée nulle.',
      'Les rapprochements début + augmentations − diminutions = fin, totaux de colonnes, 770 / 775, 780 avec la case 322, 983 et 860 avec le 2033-B sont INDICATIFS : lecture de la disposition du formulaire, jamais bloquants, jamais corrigés.',
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
