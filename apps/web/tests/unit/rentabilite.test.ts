import { describe, expect, it } from 'vitest';
import { LIBELLE_STATUT_CALCUL, type Rentabilite, coutHoraireSaisi, margeAffichable, periodeDemandeeInvalide, periodeRentabilite } from '@/lib/rentabilite';

const exercices = [{ debut: '2026-07-01', fin: '2027-06-30' }, { debut: '2025-07-01', fin: '2026-06-30' }];

describe('période de la rentabilité', () => {
  it('prend la période demandée quand elle est valide', () => {
    expect(periodeRentabilite({ du: '2025-01-01', au: '2025-03-31' }, exercices, '2026-11-19')).toEqual({ du: '2025-01-01', au: '2025-03-31', origine: 'demandee' });
  });
  it('à défaut, l’exercice du dossier qui contient la date du jour', () => {
    expect(periodeRentabilite({}, exercices, '2026-11-19')).toEqual({ du: '2026-07-01', au: '2027-06-30', origine: 'exercice_en_cours' });
    expect(periodeRentabilite({ du: '2025-12-31', au: '2025-01-01' }, exercices, '2026-01-15')).toEqual({ du: '2025-07-01', au: '2026-06-30', origine: 'exercice_en_cours' });
  });
  it('à défaut d’exercice en cours, l’année civile', () => {
    expect(periodeRentabilite({}, [], '2026-11-19')).toEqual({ du: '2026-01-01', au: '2026-12-31', origine: 'annee_civile' });
    expect(periodeRentabilite({ du: 'hier', au: '2026-01-01' }, [{ debut: '2024-01-01', fin: '2024-12-31' }], '2026-11-19').origine).toBe('annee_civile');
  });
  it('signale une période saisie mais inutilisable', () => {
    expect(periodeDemandeeInvalide({})).toBe(false);
    expect(periodeDemandeeInvalide({ du: '2025-01-01', au: '2025-12-31' })).toBe(false);
    expect(periodeDemandeeInvalide({ du: '2025-12-31', au: '2025-01-01' })).toBe(true);
    expect(periodeDemandeeInvalide({ du: '2025-01-01' })).toBe(true);
  });
});

describe('coût et marge', () => {
  const marge = (m: Partial<Rentabilite['marge']>): Rentabilite['marge'] => ({ statut: 'non_calculable', coutHoraire: null, cout: null, valeur: null, tauxPourcent: null, motif: null, ...m });
  it('n’est affichable que si l’API a renvoyé le coût ET la marge', () => {
    expect(margeAffichable(marge({ statut: 'calcule', coutHoraire: '60.00', cout: '165.00', valeur: '3435.00' }))).toBe(true);
    expect(margeAffichable(marge({ statut: 'partiel', coutHoraire: '60.00', cout: '165.00', valeur: '3435.00' }))).toBe(true);
    expect(margeAffichable(marge({ motif: 'Coût horaire interne du cabinet non renseigné : aucune marge n’est calculée.' }))).toBe(false);
    expect(margeAffichable(marge({ statut: 'partiel', motif: 'Le coût et la marge sont réservés aux administrateurs et associés du cabinet.' }))).toBe(false); // statut renvoyé, valeurs masquées
    expect(margeAffichable(marge({ statut: 'non_calculable', cout: '0.00', valeur: '0.00' }))).toBe(false); // jamais un zéro à la place d'un « non calculable »
  });
  it('libelle les trois statuts d’un calcul', () => {
    expect(LIBELLE_STATUT_CALCUL).toEqual({ calcule: 'Calculé', partiel: 'Partiel', non_calculable: 'Non calculable' });
  });
  it('accepte un coût horaire strictement positif et le rend en chaîne décimale', () => {
    expect(coutHoraireSaisi('62,5')).toEqual({ ok: true, valeur: '62.50' });
    expect(coutHoraireSaisi(' 1 200 ')).toEqual({ ok: true, valeur: '1200.00' });
  });
  it('refuse le vide, zéro, le négatif et ce qui n’est pas un montant — aucune valeur par défaut', () => {
    for (const saisie of ['', '   ', '0', '0,00', '-5', 'abc', '12,345']) expect(coutHoraireSaisi(saisie).ok).toBe(false);
    expect(coutHoraireSaisi('0')).toMatchObject({ erreur: expect.stringMatching(/strictement positif/) });
    expect(coutHoraireSaisi('')).toMatchObject({ erreur: expect.stringMatching(/Effacer/) });
  });
});
