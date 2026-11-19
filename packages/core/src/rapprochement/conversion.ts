/**
 * Conversions vers `ElementRapprochable`, selon la convention de sens documentée dans `types.ts` :
 * positif = encaissement réalisé ou à recevoir, négatif = décaissement réalisé ou à payer.
 */
import { nettoyerTexteBancaire } from '../banque/commun.js';
import type { MouvementBancaire } from '../banque/types.js';
import type { LigneEcriture } from '../controles/types.js';
import { dec, versChaine } from '../montant.js';
import type { ElementRapprochable } from './types.js';

/**
 * Mouvement bancaire → élément. Montant repris tel quel (positif = crédit du compte bancaire).
 * `id` = clé d'idempotence ; `reference` = référence de bout en bout (la référence interne de la banque
 * ne figure jamais en comptabilité) ; `tiers` = null sauf si l'appelant fournit le code tiers qu'il a résolu
 * (le nom de la contrepartie est un contenu non fiable, laissé hors des critères).
 */
export function elementDepuisMouvement(m: MouvementBancaire, options: { tiers?: string | null } = {}): ElementRapprochable {
  return {
    id: m.cleIdempotence,
    type: 'mouvement_bancaire',
    date: m.dateOperation,
    montant: m.montant,
    reference: m.referenceBoutEnBout,
    libelle: m.libelle,
    tiers: options.tiers ?? null,
    compte: m.compte.iban ?? m.compte.identifiant,
  };
}

/**
 * Ligne d'écriture d'un compte 512, 411 ou 401 → élément. Montant = débit − crédit :
 *  - 512 : encaissement positif, décaissement négatif (même sens que le relevé) ;
 *  - 411 : facture client positive (à encaisser), avoir négatif ;
 *  - 401 : facture fournisseur négative (à payer), avoir positif.
 * `inverser: true` change le signe : à utiliser pour le côté « règlements » lorsqu'on rapproche,
 * à l'intérieur d'un même compte de tiers, les factures (un côté) et leurs règlements (l'autre côté).
 * `reference` = PieceRef ; `tiers` = compte auxiliaire, sauf valeur fournie ; `date` = date d'écriture.
 */
export function elementDepuisLigneEcriture(
  l: LigneEcriture,
  options: { inverser?: boolean; type?: 'ligne_ecriture' | 'facture'; tiers?: string | null } = {},
): ElementRapprochable {
  const mouvement = dec(l.debit).minus(dec(l.credit));
  const montant = options.inverser === true ? mouvement.negated() : mouvement;
  return {
    id: l.id,
    type: options.type ?? 'ligne_ecriture',
    date: l.ecritureDate,
    montant: versChaine(montant, Math.min(6, Math.max(2, montant.decimalPlaces()))),
    reference: l.pieceRef === '' ? null : l.pieceRef,
    libelle: nettoyerTexteBancaire(l.ecritureLib),
    tiers: options.tiers !== undefined ? options.tiers : l.compAuxNum,
    compte: l.compteNum,
  };
}

/**
 * Lignes d'un compte de banque (512) prêtes pour le rapprochement bancaire. Le tiers d'une ligne de
 * banque est celui de SA contrepartie : l'unique compte auxiliaire porté par les autres lignes de la
 * même écriture (journal + numéro). Plusieurs tiers ou aucun → null (pas de choix arbitraire).
 * Fournir TOUTES les lignes des écritures (et non les seules lignes 512), sans quoi le tiers reste inconnu.
 */
export function elementsBanqueDepuisEcritures(
  lignes: readonly LigneEcriture[],
  options: { prefixesBanque?: readonly string[]; compteNum?: string } = {},
): ElementRapprochable[] {
  const prefixes = options.prefixesBanque ?? ['512'];
  const estBanque = (l: LigneEcriture): boolean => (options.compteNum !== undefined ? l.compteNum === options.compteNum : prefixes.some((p) => l.compteNum.startsWith(p)));
  const tiersParEcriture = new Map<string, Set<string>>();
  for (const l of lignes) {
    if (l.compAuxNum === null || l.compAuxNum === '') continue;
    const cle = `${l.journalCode}\u0001${l.ecritureNum}`;
    const s = tiersParEcriture.get(cle);
    if (s === undefined) tiersParEcriture.set(cle, new Set([l.compAuxNum]));
    else s.add(l.compAuxNum);
  }
  return lignes.filter(estBanque).map((l) => {
    const tiers = tiersParEcriture.get(`${l.journalCode}\u0001${l.ecritureNum}`);
    return elementDepuisLigneEcriture(l, { tiers: tiers !== undefined && tiers.size === 1 ? ([...tiers][0] as string) : null });
  });
}
