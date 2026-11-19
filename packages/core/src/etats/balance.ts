/**
 * Balance générale (et, sur demande, auxiliaire) calculée à partir des lignes d'écritures.
 * État de travail : aucun libellé n'est interprété, aucun montant n'est ajusté.
 */
import { Decimal } from 'decimal.js';
import { creditDe, debitDe } from '../controles/outils.js';
import type { LigneEcriture } from '../controles/types.js';
import { estDateIso } from '../dates.js';
import { versChaine } from '../montant.js';
import type { Balance, LigneBalance, LigneBalanceAuxiliaire, OptionsBalance } from './types.js';

const ZERO = new Decimal(0);

interface Cumul { compteNum: string; compteLib: string; debit: Decimal; credit: Decimal; nbLignes: number }

function versLigne(c: Cumul): LigneBalance {
  const solde = c.debit.minus(c.credit);
  return {
    compteNum: c.compteNum,
    compteLib: c.compteLib,
    totalDebit: versChaine(c.debit),
    totalCredit: versChaine(c.credit),
    soldeDebiteur: versChaine(solde.isPositive() ? solde : ZERO),
    soldeCrediteur: versChaine(solde.isNegative() ? solde.negated() : ZERO),
    nbLignes: c.nbLignes,
  };
}

const ordre = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function calculerBalance(lignes: readonly LigneEcriture[], options: OptionsBalance = {}): Balance {
  const { jusquau, auxiliaire = false, exclureJournaux = [] } = options;
  if (jusquau !== undefined && !estDateIso(jusquau)) throw new Error('Option « jusquau » invalide : date ISO AAAA-MM-JJ attendue.');
  const journauxExclus = new Set(exclureJournaux);
  const parCompte = new Map<string, Cumul>();
  const parAux = new Map<string, Cumul & { compAuxNum: string; compAuxLib: string }>();
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  for (const l of lignes) {
    if (jusquau !== undefined && l.ecritureDate > jusquau) continue;
    if (journauxExclus.has(l.journalCode)) continue;
    const debit = debitDe(l);
    const credit = creditDe(l);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    let c = parCompte.get(l.compteNum);
    if (c === undefined) {
      c = { compteNum: l.compteNum, compteLib: l.compteLib, debit: ZERO, credit: ZERO, nbLignes: 0 };
      parCompte.set(l.compteNum, c);
    }
    c.debit = c.debit.plus(debit);
    c.credit = c.credit.plus(credit);
    c.nbLignes++;
    if (auxiliaire && l.compAuxNum !== null && l.compAuxNum !== '') {
      const cle = `${l.compteNum}\u0001${l.compAuxNum}`;
      let a = parAux.get(cle);
      if (a === undefined) {
        a = { compteNum: l.compteNum, compteLib: l.compteLib, compAuxNum: l.compAuxNum, compAuxLib: l.compAuxLib ?? '', debit: ZERO, credit: ZERO, nbLignes: 0 };
        parAux.set(cle, a);
      }
      a.debit = a.debit.plus(debit);
      a.credit = a.credit.plus(credit);
      a.nbLignes++;
    }
  }
  const ecart = totalDebit.minus(totalCredit);
  const balance: Balance = {
    lignes: [...parCompte.values()].sort((a, b) => ordre(a.compteNum, b.compteNum)).map(versLigne),
    totalDebit: versChaine(totalDebit),
    totalCredit: versChaine(totalCredit),
    equilibree: ecart.isZero(),
    ecart: versChaine(ecart),
  };
  if (auxiliaire) {
    balance.parAuxiliaire = [...parAux.values()]
      .sort((a, b) => ordre(a.compteNum, b.compteNum) || ordre(a.compAuxNum, b.compAuxNum))
      .map((a): LigneBalanceAuxiliaire => ({ ...versLigne(a), compAuxNum: a.compAuxNum, compAuxLib: a.compAuxLib }));
  }
  return balance;
}
