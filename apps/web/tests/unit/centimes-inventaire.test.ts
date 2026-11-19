import { describe, expect, it } from 'vitest';
import { depuisCentimes, difference, normaliserMontantSaisi, totaliserSaisies, versCentimes } from '@/lib/centimes';
import { comparerBalances, ligneVide, propositionDepuis, totauxSaisie } from '@/lib/inventaire';
import { formaterHorodatage } from '@/lib/montants';

describe('addition en centimes entiers à partir de chaînes', () => {
  it('convertit sans flottant, dans les deux sens', () => {
    expect(versCentimes('1200.5')).toBe(120050n);
    expect(versCentimes('0.07')).toBe(7n);
    expect(versCentimes('-3.10')).toBe(-310n);
    expect(versCentimes('1.234')).toBeNull(); // trois décimales : pas des centimes
    expect(versCentimes('1e3')).toBeNull();
    expect(versCentimes('')).toBeNull();
    expect(depuisCentimes(120050n)).toBe('1200.50');
    expect(depuisCentimes(-5n)).toBe('-0.05');
    expect(depuisCentimes(0n)).toBe('0.00');
  });
  it('donne le total exact là où les flottants se trompent', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // rappel du piège
    expect(totaliserSaisies(['0.1', '0.2'])).toEqual({ total: '0.30', invalides: 0 });
    expect(totaliserSaisies(['1.10', '2.20', '3.30'])).toEqual({ total: '6.60', invalides: 0 });
    expect(totaliserSaisies(Array.from({ length: 1000 }, () => '0,01')).total).toBe('10.00');
    expect(totaliserSaisies(['9999999999999.99', '0.01']).total).toBe('10000000000000.00'); // au-delà de la précision d'un double
  });
  it('accepte la saisie française, ignore les cases vides et signale les saisies illisibles', () => {
    expect(normaliserMontantSaisi('1 200,5')).toBe('1200.50');
    expect(normaliserMontantSaisi('1 200,50')).toBe('1200.50'); // espace fine insécable
    expect(normaliserMontantSaisi('12')).toBe('12.00');
    expect(normaliserMontantSaisi('-5')).toBeNull();
    expect(normaliserMontantSaisi('1,234')).toBeNull();
    expect(normaliserMontantSaisi('abc')).toBeNull();
    expect(normaliserMontantSaisi('')).toBeNull();
    expect(totaliserSaisies(['10', '', '  ', 'x', '2,5'])).toEqual({ total: '12.50', invalides: 1 });
    expect(difference('1200.00', '1199.99')).toBe('0.01');
    expect(difference('1.00', 'x')).toBeNull();
  });
});

describe('formulaire d’écriture d’inventaire', () => {
  const ligne = (compteNum: string, compteLib: string, debit: string, credit: string) => ({ compteNum, compteLib, debit, credit });
  it('affiche les totaux et l’écart au fil de la saisie', () => {
    expect(totauxSaisie([ligneVide(), ligneVide()])).toEqual({ totalDebit: '0.00', totalCredit: '0.00', ecart: '0.00', equilibre: true, invalides: 0 });
    const t = totauxSaisie([ligne('6061', 'Fournitures', '1200,00', ''), ligne('408', 'FNP', '', '1199,99')]);
    expect(t).toEqual({ totalDebit: '1200.00', totalCredit: '1199.99', ecart: '0.01', equilibre: false, invalides: 0 });
    expect(totauxSaisie([ligne('6061', 'x', '10', ''), ligne('408', 'y', '', 'dix')]).equilibre).toBe(false); // montant illisible : jamais « équilibrée »
    expect(totauxSaisie([ligne('1', 'x', '5', ''), ligne('2', 'y', '', '7,50')]).ecart).toBe('-2.50');
  });
  it('construit le corps avec des chaînes décimales et refuse les lignes incohérentes', () => {
    const base = { dateEcriture: '2025-12-31', libelle: ' FNP ', justification: 'Livraison reçue, facture non parvenue', calcul: 'BL : 1 200,00' };
    const ok = propositionDepuis({ ...base, lignes: [ligne('6061', 'Fournitures', '1 200', ''), ligne('408', 'FNP', '', '1200,00'), ligneVide()] });
    expect(ok).toEqual({
      ok: true,
      corps: { dateEcriture: '2025-12-31', libelle: 'FNP', justification: base.justification, calcul: base.calcul, lignes: [{ compteNum: '6061', compteLib: 'Fournitures', debit: '1200.00', credit: '0.00' }, { compteNum: '408', compteLib: 'FNP', debit: '0.00', credit: '1200.00' }] },
    });
    if (ok.ok) for (const l of ok.corps.lignes) expect(typeof l.debit === 'string' && typeof l.credit === 'string').toBe(true);
    const ko = propositionDepuis({ dateEcriture: '', libelle: '', justification: 'court', calcul: '', lignes: [ligne('8', '', '1', '1'), ligneVide()] });
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(ko.erreurs).toContain('Une écriture comporte au moins deux lignes.');
      expect(ko.erreurs.join(' ')).toMatch(/numéro de compte du PCG/);
      expect(ko.erreurs.join(' ')).toMatch(/débit OU au crédit/);
    }
    // Un déséquilibre n'est pas bloqué localement : c'est l'API qui tranche et renvoie l'écart.
    expect(propositionDepuis({ ...base, lignes: [ligne('6061', 'a', '10', ''), ligne('408', 'b', '', '9,99')] }).ok).toBe(true);
  });
  it('apparie balance importée et balance ajustée compte par compte', () => {
    const l = (compteNum: string, soldeDebiteur: string, soldeCrediteur: string) => ({ compteNum, compteLib: `Compte ${compteNum}`, totalDebit: soldeDebiteur, totalCredit: soldeCrediteur, soldeDebiteur, soldeCrediteur, nbLignes: 1 });
    const b = (lignes: ReturnType<typeof l>[]) => ({ lignes, totalDebit: '0.00', totalCredit: '0.00', equilibree: true, ecart: '0.00' });
    const r = comparerBalances(b([l('6061', '100.00', '0.00'), l('512', '50.00', '0.00')]), b([l('6061', '1300.00', '0.00'), l('512', '50.00', '0.00'), l('408', '0.00', '1200.00')]));
    expect(r.map((x) => [x.compteNum, x.modifiee, x.importee === null])).toEqual([['408', true, true], ['512', false, false], ['6061', true, false]]);
  });
});

describe('formaterHorodatage', () => {
  it('lit aussi la forme renvoyée par PostgreSQL (espace, décalage sans minutes)', () => {
    expect(formaterHorodatage('2026-11-19 07:02:35.673462+00')).toBe(formaterHorodatage('2026-11-19T07:02:35.673Z'));
    expect(formaterHorodatage('2026-11-19 07:02:35.673462+00')).toMatch(/^19\/11\/2026 08:02$/);
    expect(formaterHorodatage('pas une date')).toBe('pas une date');
    expect(formaterHorodatage(null)).toBe('—');
  });
});
