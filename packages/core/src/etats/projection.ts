/**
 * Projets de compte de résultat et de bilan à partir d'une balance et d'une table de correspondance.
 *
 * Ce sont des ÉTATS DE TRAVAIL (« projets ») : ni comptes annuels, ni validation, ni certification. Hors périmètre :
 * annexe, liasse fiscale, écritures d'inventaire, affectation du résultat. Règles :
 *  - chaque compte de la balance est affecté à UNE rubrique au plus, sinon listé dans `comptesNonAffectes` ;
 *  - les comptes des classes 6 et 7 relèvent du compte de résultat, tous les autres du bilan ;
 *  - aucun montant n'est ajusté pour forcer une égalité : les écarts sont restitués par les contrôles ;
 *  - les libellés sont recopiés sans jamais être interprétés.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, dec, versChaine } from '../montant.js';
import { verifierCorrespondance } from './correspondance.js';
import type { Balance, ControleEtat, CorrespondanceRubriques, EtatProjet, EtatRubrique, LigneBalance, RegleAffectation, RubriqueDefinition, RubriqueProjetee } from './types.js';

const ZERO = new Decimal(0);

/** Ligne technique ajoutée à la rubrique « Résultat de l'exercice » du bilan quand les classes 6 et 7 ne sont pas soldées. */
export const COMPTE_RESULTAT_EN_COURS = '6-7';
const LIBELLE_RESULTAT_EN_COURS = 'Solde des comptes de charges (classe 6) et de produits (classe 7) non soldés — calculé, hors écriture';

const estCompteDeGestion = (compteNum: string): boolean => compteNum.startsWith('6') || compteNum.startsWith('7');
const soldeDe = (l: LigneBalance): Decimal => dec(l.totalDebit).minus(dec(l.totalCredit));

function prefixesCorrespondent(compte: string, g: RegleAffectation): boolean {
  return g.prefixes.some((p) => compte.startsWith(p)) && !(g.saufPrefixes ?? []).some((p) => compte.startsWith(p));
}

interface Affectation { rubrique: RubriqueDefinition; regle: RegleAffectation }
type Recherche = { affectation: Affectation } | { motif: 'aucune_regle' | 'sens_anormal' | 'regles_ambigues' };

function chercherAffectation(compte: string, solde: Decimal, rubriques: readonly RubriqueDefinition[]): Recherche {
  const candidates: Affectation[] = [];
  for (const rubrique of rubriques) {
    for (const regle of rubrique.regles) if (prefixesCorrespondent(compte, regle)) candidates.push({ rubrique, regle });
  }
  if (candidates.length === 0) return { motif: 'aucune_regle' };
  // Compte soldé : première règle par ordre de rubrique, sans condition de sens (montant nul, sans incidence).
  if (solde.isZero()) return { affectation: candidates[0] as Affectation };
  const retenues = candidates.filter(({ regle }) => regle.sens === 'solde' || (regle.sens === 'debiteur' ? solde.isPositive() : solde.isNegative()));
  if (retenues.length === 0) return { motif: 'sens_anormal' };
  if (new Set(retenues.map((a) => a.rubrique.code)).size > 1) return { motif: 'regles_ambigues' };
  return { affectation: retenues[0] as Affectation };
}

interface Cumul { brut: Decimal; deduction: Decimal; comptes: RubriqueProjetee['comptes'] }

interface Projection {
  rubriques: RubriqueProjetee[];
  montants: Map<string, { brut: Decimal; deduction: Decimal; net: Decimal }>;
  nonAffectes: Array<{ compteNum: string; compteLib: string; solde: Decimal; motif: 'aucune_regle' | 'sens_anormal' | 'regles_ambigues' }>;
  nbComptes: number;
}

function projeter(
  balance: Balance,
  correspondance: CorrespondanceRubriques,
  etats: readonly EtatRubrique[],
  dansPerimetre: (compteNum: string) => boolean,
  lignesTechniques: ReadonlyMap<string, { compteNum: string; compteLib: string; montant: Decimal }>,
): Projection {
  const definitions = correspondance.rubriques.filter((r) => etats.includes(r.etat)).sort((a, b) => a.ordre - b.ordre);
  const cumuls = new Map<string, Cumul>(definitions.map((r) => [r.code, { brut: ZERO, deduction: ZERO, comptes: [] }]));
  const nonAffectes: Projection['nonAffectes'] = [];
  let nbComptes = 0;
  for (const l of balance.lignes) {
    if (!dansPerimetre(l.compteNum)) continue;
    nbComptes++;
    const solde = soldeDe(l);
    const r = chercherAffectation(l.compteNum, solde, definitions);
    if (!('affectation' in r)) {
      nonAffectes.push({ compteNum: l.compteNum, compteLib: l.compteLib, solde, motif: r.motif });
      continue;
    }
    const { rubrique, regle } = r.affectation;
    const cumul = cumuls.get(rubrique.code) as Cumul;
    // Sens naturel : actif et charges au débit, passif et produits au crédit.
    const naturel = rubrique.etat === 'bilan_actif' || rubrique.etat === 'resultat_charges' ? solde : solde.negated();
    if (regle.colonne === 'amortissements_depreciations') cumul.deduction = cumul.deduction.minus(naturel);
    else cumul.brut = cumul.brut.plus(naturel);
    cumul.comptes.push({ compteNum: l.compteNum, compteLib: l.compteLib, montant: versChaine(naturel) });
  }
  for (const [code, t] of lignesTechniques) {
    const cumul = cumuls.get(code);
    if (cumul === undefined) continue;
    cumul.brut = cumul.brut.plus(t.montant);
    cumul.comptes.push({ compteNum: t.compteNum, compteLib: t.compteLib, montant: versChaine(t.montant) });
  }
  // Regroupements : somme des rubriques filles, des feuilles vers les racines.
  const enfants = new Map<string, RubriqueDefinition[]>();
  for (const r of definitions) if (r.parent !== null) enfants.set(r.parent, [...(enfants.get(r.parent) ?? []), r]);
  const montants: Projection['montants'] = new Map();
  const total = (r: RubriqueDefinition, pile: ReadonlySet<string>): { brut: Decimal; deduction: Decimal; net: Decimal } => {
    const connu = montants.get(r.code);
    if (connu !== undefined) return connu;
    const propre = cumuls.get(r.code) as Cumul;
    let brut = propre.brut;
    let deduction = propre.deduction;
    for (const e of enfants.get(r.code) ?? []) {
      if (pile.has(e.code)) continue; // table cyclique : signalée par verifierCorrespondance
      const t = total(e, new Set([...pile, r.code]));
      brut = brut.plus(t.brut);
      deduction = deduction.plus(t.deduction);
    }
    const resultat = { brut, deduction, net: brut.minus(deduction) };
    montants.set(r.code, resultat);
    return resultat;
  };
  const rubriques = definitions.map((r): RubriqueProjetee => {
    const t = total(r, new Set());
    const base = { code: r.code, libelle: r.libelle, montant: versChaine(t.net), comptes: (cumuls.get(r.code) as Cumul).comptes };
    return r.etat === 'bilan_actif' ? { ...base, brut: versChaine(t.brut), amortissementsDepreciations: versChaine(t.deduction) } : base;
  });
  return { rubriques, montants, nonAffectes, nbComptes };
}

const LIBELLES_MOTIFS = {
  aucune_regle: 'aucune règle de la table ne vise ce compte',
  sens_anormal: 'le sens du solde n’est prévu par aucune règle pour ce compte',
  regles_ambigues: 'plusieurs rubriques visent ce compte',
} as const;

function motifsNonAffectes(nonAffectes: Projection['nonAffectes']): string[] {
  const significatifs = nonAffectes.filter((c) => !c.solde.isZero());
  if (significatifs.length === 0) return [];
  const net = significatifs.reduce((s, c) => s.plus(c.solde), ZERO);
  const detail = significatifs.slice(0, 20).map((c) => `${c.compteNum} (${versChaine(c.solde)} ; ${LIBELLES_MOTIFS[c.motif]})`).join(', ');
  const suite = significatifs.length > 20 ? `, et ${significatifs.length - 20} autre(s)` : '';
  return [`${significatifs.length} compte(s) non affecté(s) à une rubrique, pour un solde net débiteur de ${versChaine(net)} : ${detail}${suite}. Ils ne figurent dans aucun total.`];
}

function controleBalance(balance: Balance): ControleEtat {
  if (balance.lignes.length === 0) return { code: 'balance_equilibree', statut: 'non_verifiable', message: 'Balance vide : équilibre non vérifiable.', ecart: null };
  const ecart = dec(balance.totalDebit).minus(dec(balance.totalCredit));
  return ecart.isZero()
    ? { code: 'balance_equilibree', statut: 'ok', message: 'Total des débits égal au total des crédits.', ecart: '0.00' }
    : { code: 'balance_equilibree', statut: 'ecart', message: `Balance non équilibrée : débits − crédits = ${versChaine(ecart)}.`, ecart: versChaine(ecart) };
}

function preliminaires(balance: Balance, correspondance: CorrespondanceRubriques): string[] {
  const motifs = verifierCorrespondance(correspondance).map((e) => `Table de correspondance incohérente : ${e}`);
  if (balance.lignes.length === 0) motifs.push('Balance vide : aucun compte à projeter.');
  return motifs;
}

const sommeDe = (p: Projection, codes: readonly string[]): Decimal | null => {
  let s = ZERO;
  for (const c of codes) {
    const m = p.montants.get(c);
    if (m === undefined) return null;
    s = s.plus(m.net);
  }
  return s;
};

/** Résultat des classes 6 et 7 de la balance (crédits − débits) et présence d'au moins un compte de gestion. */
function resultatDesComptesDeGestion(balance: Balance): { present: boolean; montant: Decimal } {
  let montant = ZERO;
  let present = false;
  for (const l of balance.lignes) {
    if (!estCompteDeGestion(l.compteNum)) continue;
    present = true;
    montant = montant.minus(soldeDe(l));
  }
  return { present, montant };
}

/**
 * Projet de compte de résultat (modèle en liste du système de base). Totaux restitués : niveaux de résultat de l'art. 821-2.
 * `totaux.resultat` ne comprend que les comptes affectés : l'écart avec le solde des classes 6 et 7 est restitué par le contrôle
 * `resultat_egal_solde_des_classes_6_et_7`.
 */
export function projeterCompteDeResultat(balance: Balance, correspondance: CorrespondanceRubriques): EtatProjet {
  const p = projeter(balance, correspondance, ['resultat_produits', 'resultat_charges'], estCompteDeGestion, new Map());
  const motifs = [...preliminaires(balance, correspondance), ...motifsNonAffectes(p.nonAffectes)];
  const gestion = resultatDesComptesDeGestion(balance);
  if (balance.lignes.length > 0 && !gestion.present) motifs.push('Aucun compte de charges ou de produits (classes 6 et 7) dans la balance : compte de résultat non projetable.');

  const totaux: Record<string, ChaineDecimale> = {};
  const controles: ControleEtat[] = [controleBalance(balance)];
  const niveaux = { pe: sommeDe(p, ['PE']), ce: sommeDe(p, ['CE']), qpp: sommeDe(p, ['QPP']), qpc: sommeDe(p, ['QPC']), pf: sommeDe(p, ['PF']), cf: sommeDe(p, ['CF']), px: sommeDe(p, ['PX']), cx: sommeDe(p, ['CX']), part: sommeDe(p, ['PART']), is: sommeDe(p, ['IS']) };
  const { pe, ce, qpp, qpc, pf, cf, px, cx, part, is } = niveaux;
  let resultat: Decimal | null = null;
  if (pe !== null && ce !== null && qpp !== null && qpc !== null && pf !== null && cf !== null && px !== null && cx !== null && part !== null && is !== null) {
    const produits = pe.plus(qpp).plus(pf).plus(px);
    const charges = ce.plus(qpc).plus(cf).plus(cx).plus(part).plus(is);
    resultat = produits.minus(charges);
    Object.assign(totaux, {
      total_produits_exploitation: versChaine(pe),
      total_charges_exploitation: versChaine(ce),
      resultat_exploitation: versChaine(pe.minus(ce)),
      total_produits_financiers: versChaine(pf),
      total_charges_financieres: versChaine(cf),
      resultat_financier: versChaine(pf.minus(cf)),
      resultat_courant_avant_impots: versChaine(pe.minus(ce).plus(qpp).minus(qpc).plus(pf).minus(cf)),
      resultat_exceptionnel: versChaine(px.minus(cx)),
      total_produits: versChaine(produits),
      total_charges: versChaine(charges),
      resultat: versChaine(resultat),
    });
  } else {
    motifs.push('La table de correspondance ne comporte pas toutes les rubriques réservées du compte de résultat (PE, CE, QPP, QPC, PF, CF, PX, CX, PART, IS) : niveaux de résultat non calculés.');
  }
  if (resultat === null || !gestion.present) {
    controles.push({ code: 'resultat_egal_solde_des_classes_6_et_7', statut: 'non_verifiable', message: 'Résultat projeté ou comptes de gestion absents : rapprochement non vérifiable.', ecart: null });
  } else {
    const ecart = resultat.minus(gestion.montant);
    controles.push(ecart.isZero()
      ? { code: 'resultat_egal_solde_des_classes_6_et_7', statut: 'ok', message: 'Le résultat projeté est égal au solde des comptes des classes 6 et 7 de la balance.', ecart: '0.00' }
      : { code: 'resultat_egal_solde_des_classes_6_et_7', statut: 'ecart', message: `Résultat projeté (${versChaine(resultat)}) différent du solde des classes 6 et 7 (${versChaine(gestion.montant)}) : comptes de gestion non affectés.`, ecart: versChaine(ecart) });
  }
  return {
    statut: 'projet',
    complet: motifs.length === 0,
    motifsIncompletude: motifs,
    correspondance: { id: correspondance.id, version: correspondance.version },
    rubriques: p.rubriques,
    totaux,
    comptesNonAffectes: p.nonAffectes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, solde: versChaine(c.solde) })),
    controles,
  };
}

/** Comptes collectifs dont les soldes par tiers de sens inverse devraient être présentés de l'autre côté du bilan (art. 112-2 : pas de compensation). */
const COLLECTIFS_CLIENTS = ['411', '413', '416', '418'];
const COLLECTIFS_FOURNISSEURS = ['401', '403', '404', '405', '408'];

function controleTiers(balance: Balance): ControleEtat {
  const code = 'tiers_soldes_inverses_non_reclasses';
  if (balance.parAuxiliaire === undefined) {
    return { code, statut: 'non_verifiable', message: 'Balance auxiliaire non fournie : les clients créditeurs et fournisseurs débiteurs compris dans les comptes collectifs ne sont ni détectés ni reclassés.', ecart: null };
  }
  const sensGeneral = new Map(balance.lignes.map((l) => [l.compteNum, soldeDe(l)]));
  let aReclasser = ZERO;
  for (const a of balance.parAuxiliaire) {
    const general = sensGeneral.get(a.compteNum) ?? ZERO;
    const solde = soldeDe(a);
    const client = COLLECTIFS_CLIENTS.some((p) => a.compteNum.startsWith(p));
    const fournisseur = COLLECTIFS_FOURNISSEURS.some((p) => a.compteNum.startsWith(p));
    if (!client && !fournisseur) continue;
    // Tiers de sens opposé à celui du compte général auquel il est agrégé.
    if (general.isPositive() && solde.isNegative()) aReclasser = aReclasser.plus(solde.negated());
    else if (general.isNegative() && solde.isPositive()) aReclasser = aReclasser.plus(solde);
  }
  return aReclasser.isZero()
    ? { code, statut: 'ok', message: 'Aucun tiers de sens inverse à celui de son compte collectif (clients et fournisseurs).', ecart: '0.00' }
    : { code, statut: 'ecart', message: `Des tiers de sens inverse à celui de leur compte collectif totalisent ${versChaine(aReclasser)} : ce montant est compensé dans le projet, alors qu’il devrait majorer à la fois l’actif et le passif. Non reclassé.`, ecart: versChaine(aReclasser) };
}

/**
 * Projet de bilan (modèle du système de base, avant répartition). Le résultat porté au bilan est celui de la BALANCE : solde du
 * compte 12, augmenté du solde des classes 6 et 7 tant qu'elles ne sont pas soldées. `options.resultatExercice` (résultat du
 * projet de compte de résultat) n'est jamais substitué à ce montant : il sert uniquement au contrôle de concordance.
 */
export function projeterBilan(balance: Balance, correspondance: CorrespondanceRubriques, options: { resultatExercice?: ChaineDecimale } = {}): EtatProjet {
  const gestion = resultatDesComptesDeGestion(balance);
  const techniques = new Map<string, { compteNum: string; compteLib: string; montant: Decimal }>();
  if (gestion.present) techniques.set('P_RESULTAT', { compteNum: COMPTE_RESULTAT_EN_COURS, compteLib: LIBELLE_RESULTAT_EN_COURS, montant: gestion.montant });
  const p = projeter(balance, correspondance, ['bilan_actif', 'bilan_passif'], (c) => !estCompteDeGestion(c), techniques);
  const motifs = [...preliminaires(balance, correspondance), ...motifsNonAffectes(p.nonAffectes)];
  const resultatPorte = p.montants.get('P_RESULTAT')?.net ?? null;
  if (resultatPorte === null) motifs.push('La table de correspondance ne comporte pas la rubrique réservée P_RESULTAT : le résultat de l’exercice n’est pas porté au passif.');
  if (balance.lignes.length > 0 && p.nbComptes === 0) motifs.push('Aucun compte de bilan (classes 1 à 5) dans la balance : bilan non projetable.');
  const soldeCompte12 = balance.lignes.filter((l) => l.compteNum.startsWith('12')).reduce((s, l) => s.minus(soldeDe(l)), ZERO);
  if (gestion.present && !gestion.montant.isZero() && !soldeCompte12.isZero()) {
    motifs.push(`Le compte 12 présente un solde créditeur de ${versChaine(soldeCompte12)} alors que les classes 6 et 7 ne sont pas soldées : résultat antérieur en instance d’affectation ou écriture de clôture partielle ? Les deux montants sont cumulés dans la rubrique « Résultat de l’exercice » sans retraitement.`);
  }

  const racines = (etat: EtatRubrique): RubriqueDefinition[] => correspondance.rubriques.filter((r) => r.etat === etat && r.parent === null);
  let actifBrut = ZERO;
  let actifDeduction = ZERO;
  for (const r of racines('bilan_actif')) {
    const m = p.montants.get(r.code);
    if (m !== undefined) { actifBrut = actifBrut.plus(m.brut); actifDeduction = actifDeduction.plus(m.deduction); }
  }
  const actif = actifBrut.minus(actifDeduction);
  const passif = racines('bilan_passif').reduce((s, r) => s.plus(p.montants.get(r.code)?.net ?? ZERO), ZERO);
  const totaux: Record<string, ChaineDecimale> = {
    total_actif_brut: versChaine(actifBrut),
    total_actif_amortissements_depreciations: versChaine(actifDeduction),
    total_actif: versChaine(actif),
    total_passif: versChaine(passif),
  };
  if (resultatPorte !== null) totaux['resultat_exercice'] = versChaine(resultatPorte);

  const controles: ControleEtat[] = [controleBalance(balance)];
  if (balance.lignes.length === 0) {
    controles.push({ code: 'total_actif_egal_total_passif', statut: 'non_verifiable', message: 'Balance vide : égalité actif / passif non vérifiable.', ecart: null });
  } else {
    const ecart = actif.minus(passif);
    controles.push(ecart.isZero()
      ? { code: 'total_actif_egal_total_passif', statut: 'ok', message: 'Total de l’actif égal au total du passif.', ecart: '0.00' }
      : { code: 'total_actif_egal_total_passif', statut: 'ecart', message: `Total de l’actif (${versChaine(actif)}) différent du total du passif (${versChaine(passif)}) : balance déséquilibrée ou comptes non affectés. Aucun ajustement n’est pratiqué.`, ecart: versChaine(ecart) });
  }
  const code = 'resultat_bilan_egal_compte_de_resultat';
  if (options.resultatExercice === undefined || resultatPorte === null) {
    controles.push({ code, statut: 'non_verifiable', message: options.resultatExercice === undefined ? 'Résultat du projet de compte de résultat non fourni : concordance non vérifiable.' : 'Résultat non porté au bilan : concordance non vérifiable.', ecart: null });
  } else {
    const ecart = resultatPorte.minus(dec(options.resultatExercice));
    controles.push(ecart.isZero()
      ? { code, statut: 'ok', message: 'Le résultat porté au bilan est égal au résultat du projet de compte de résultat.', ecart: '0.00' }
      : { code, statut: 'ecart', message: `Résultat porté au bilan (${versChaine(resultatPorte)}) différent du résultat du projet de compte de résultat (${versChaine(dec(options.resultatExercice))}).`, ecart: versChaine(ecart) });
  }
  controles.push(controleTiers(balance));

  return {
    statut: 'projet',
    complet: motifs.length === 0,
    motifsIncompletude: motifs,
    correspondance: { id: correspondance.id, version: correspondance.version },
    rubriques: p.rubriques,
    totaux,
    comptesNonAffectes: p.nonAffectes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, solde: versChaine(c.solde) })),
    controles,
  };
}
