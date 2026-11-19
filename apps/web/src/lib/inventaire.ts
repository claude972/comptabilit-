/** Écritures d'inventaire proposées et balance ajustée : formes de `apps/api/src/inventaire.controller.ts`, logique pure. */
import type { Balance, LigneBalance } from './analyse';
import { difference, normaliserMontantSaisi, totaliserSaisies } from './centimes';
import type { Exercice } from './types-api';

export type StatutEcriture = 'proposee' | 'approuvee' | 'rejetee' | 'exportee';
export interface LigneInventaire {
  compteNum: string;
  compteLib: string;
  debit: string;
  credit: string;
}
export interface EcritureInventaire {
  id: string;
  exerciceId: string;
  dateEcriture: string;
  libelle: string;
  origine: string;
  justification: string;
  calcul: string;
  pieces: string[];
  lignes: LigneInventaire[];
  totalDebit: string;
  statut: StatutEcriture;
  versionDonnees: number;
  proposeePar: string;
  decideePar: string | null;
  decideeLe: string | null;
  motifDecision: string | null;
  exporteeLe: string | null;
  creeLe: string;
  aRevoir: boolean;
}
export interface BalanceAjustee {
  mention: string;
  exercice: Exercice;
  ecrituresPrisesEnCompte: Array<{ id: string; libelle: string; dateEcriture: string; total: string; statut: StatutEcriture }>;
  ecrituresEcarteesCarDonneesModifiees: number;
  balanceImportee: Balance;
  balanceAjustee: Balance;
  impact: { resultatAvant: string; resultatApres: string; variation: string };
}

export const LIBELLE_STATUT_ECRITURE: Record<StatutEcriture, string> = { proposee: 'Proposée', approuvee: 'Approuvée', rejetee: 'Rejetée', exportee: 'Exportée' };
export const PHRASE_EXPORT = 'Exporter n’est pas intégrer : vous importez vous-même ce fichier dans votre logiciel comptable.';

export interface LigneSaisie {
  compteNum: string;
  compteLib: string;
  debit: string;
  credit: string;
}
export const ligneVide = (): LigneSaisie => ({ compteNum: '', compteLib: '', debit: '', credit: '' });

/** Totaux affichés pendant la saisie, additionnés en centimes entiers à partir des chaînes saisies. */
export function totauxSaisie(lignes: readonly LigneSaisie[]): { totalDebit: string; totalCredit: string; ecart: string; equilibre: boolean; invalides: number } {
  const d = totaliserSaisies(lignes.map((l) => l.debit));
  const c = totaliserSaisies(lignes.map((l) => l.credit));
  const ecart = difference(d.total, c.total) ?? '0.00';
  return { totalDebit: d.total, totalCredit: c.total, ecart, equilibre: ecart === '0.00' && d.invalides + c.invalides === 0, invalides: d.invalides + c.invalides };
}

export interface SaisieEcriture {
  dateEcriture: string;
  libelle: string;
  justification: string;
  calcul: string;
  lignes: LigneSaisie[];
}
/** Vérifications locales (les mêmes que l'API, qui reste seule juge) et corps de la proposition. */
export function propositionDepuis(f: SaisieEcriture): { ok: true; corps: { dateEcriture: string; libelle: string; justification: string; calcul: string; lignes: LigneInventaire[] } } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dateEcriture)) erreurs.push('Indiquez la date de l’écriture.');
  if (!f.libelle.trim()) erreurs.push('Le libellé est obligatoire.');
  if (f.justification.trim().length < 10) erreurs.push('La justification doit compter au moins 10 caractères.');
  if (f.calcul.trim().length < 3) erreurs.push('Détaillez le calcul du montant (3 caractères au moins).');
  const remplies = f.lignes.filter((l) => l.compteNum.trim() || l.compteLib.trim() || l.debit.trim() || l.credit.trim());
  if (remplies.length < 2) erreurs.push('Une écriture comporte au moins deux lignes.');
  const lignes: LigneInventaire[] = [];
  remplies.forEach((l, i) => {
    const n = i + 1;
    if (!/^[1-7]\d{2,11}$/.test(l.compteNum.trim())) erreurs.push(`Ligne ${n} : numéro de compte du PCG attendu (classes 1 à 7, 3 chiffres au moins).`);
    if (!l.compteLib.trim()) erreurs.push(`Ligne ${n} : libellé du compte obligatoire.`);
    const debit = l.debit.trim() ? normaliserMontantSaisi(l.debit) : '0.00';
    const credit = l.credit.trim() ? normaliserMontantSaisi(l.credit) : '0.00';
    if (debit === null || credit === null) return void erreurs.push(`Ligne ${n} : montant invalide (positif, deux décimales au plus).`);
    if ((debit === '0.00') === (credit === '0.00')) return void erreurs.push(`Ligne ${n} : un montant au débit OU au crédit.`);
    lignes.push({ compteNum: l.compteNum.trim(), compteLib: l.compteLib.trim(), debit, credit });
  });
  if (erreurs.length) return { ok: false, erreurs };
  return { ok: true, corps: { dateEcriture: f.dateEcriture, libelle: f.libelle.trim(), justification: f.justification.trim(), calcul: f.calcul.trim(), lignes } };
}

export interface LigneComparee {
  compteNum: string;
  compteLib: string;
  importee: LigneBalance | null;
  ajustee: LigneBalance | null;
  modifiee: boolean;
}
/** Balance importée et balance ajustée côte à côte, compte par compte (aucun calcul : simple appariement). */
export function comparerBalances(importee: Balance, ajustee: Balance): LigneComparee[] {
  const parCompte = new Map<string, LigneComparee>();
  for (const l of importee.lignes) parCompte.set(l.compteNum, { compteNum: l.compteNum, compteLib: l.compteLib, importee: l, ajustee: null, modifiee: true });
  for (const l of ajustee.lignes) {
    const x = parCompte.get(l.compteNum);
    if (x) {
      x.ajustee = l;
      x.modifiee = x.importee!.soldeDebiteur !== l.soldeDebiteur || x.importee!.soldeCrediteur !== l.soldeCrediteur;
    } else parCompte.set(l.compteNum, { compteNum: l.compteNum, compteLib: l.compteLib, importee: null, ajustee: l, modifiee: true });
  }
  return [...parCompte.values()].sort((a, b) => a.compteNum.localeCompare(b.compteNum));
}
