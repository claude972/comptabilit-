import { describe, expect, it } from 'vitest';
import { type ContenuLettre, estimerTemps, lettreApplicable, schemaContenuLettre, situerTravail } from './missions.js';

const contenu = (prestations: string[], debut = '2025-01-01', fin: string | null = null, tacite = true): ContenuLettre =>
  schemaContenuLettre.parse({
    perimetre: prestations.map((prestation) => ({ prestation })),
    duree: { debut, fin, taciteReconduction: tacite },
    honoraires: { mode: 'forfait', montantAnnuelHt: '3600.00', tauxHoraireHt: null, conditionsRevision: '' },
    obligationsCabinet: '',
    obligationsClient: '',
    livrables: [],
    mandats: [],
    limites: '',
  });
const lettres = [
  { id: 'L1', dateEffet: '2025-01-01', statut: 'validee', version: 1, contenu: contenu(['tenue', 'comptes_annuels']) },
  { id: 'A1', dateEffet: '2025-07-01', statut: 'validee', version: 2, contenu: contenu(['tenue', 'comptes_annuels', 'fiscal_tva']) },
  { id: 'P1', dateEffet: '2025-09-01', statut: 'projet', version: 3, contenu: contenu(['tenue', 'comptes_annuels', 'fiscal_tva', 'social_paie']) },
];

describe('lettre applicable et périmètre', () => {
  it('retient la dernière lettre validée dont la date d’effet est atteinte ; un projet ne compte jamais', () => {
    expect(lettreApplicable(lettres, '2024-12-31')).toBeNull();
    expect(lettreApplicable(lettres, '2025-06-30')!.id).toBe('L1');
    expect(lettreApplicable(lettres, '2025-07-01')!.id).toBe('A1');
    expect(lettreApplicable(lettres, '2025-12-01')!.id).toBe('A1');
  });
  it('respecte la fin de durée sans tacite reconduction', () => {
    const l = [{ id: 'F', dateEffet: '2025-01-01', statut: 'validee', version: 1, contenu: contenu(['tenue'], '2025-01-01', '2025-12-31', false) }];
    expect(lettreApplicable(l, '2025-12-31')!.id).toBe('F');
    expect(lettreApplicable(l, '2026-01-01')).toBeNull();
  });
  it('situe un travail selon la lettre applicable À SA DATE', () => {
    expect(situerTravail(lettres, { date: '2025-03-10', prestation: 'fiscal_tva' })).toMatchObject({ situation: 'potentiellement_hors_perimetre', lettreId: 'L1' });
    expect(situerTravail(lettres, { date: '2025-08-10', prestation: 'fiscal_tva' })).toEqual({ situation: 'dans_le_perimetre', lettreId: 'A1' });
    expect(situerTravail(lettres, { date: '2025-10-10', prestation: 'social_paie' }).situation).toBe('potentiellement_hors_perimetre'); // l'avenant en projet n'a pas d'effet
    expect(situerTravail(lettres, { date: '2024-06-01', prestation: 'tenue' }).situation).toBe('aucune_lettre_applicable');
  });
  it('refuse un contenu de lettre invalide (périmètre vide, montant flottant)', () => {
    expect(schemaContenuLettre.safeParse({ ...contenu(['tenue']), perimetre: [] }).success).toBe(false);
    expect(schemaContenuLettre.safeParse({ ...contenu(['tenue']), honoraires: { mode: 'forfait', montantAnnuelHt: 3600.5, tauxHoraireHt: null, conditionsRevision: '' } }).success).toBe(false);
  });
});

describe('estimerTemps', () => {
  it('utilise le barème en priorité, sinon la médiane des temps observés, sinon s’abstient', () => {
    expect(estimerTemps({ baremeMinutes: 90, tempsObservesMinutes: [10, 500] })).toMatchObject({ statut: 'estime', minutes: 90, base: 'bareme_cabinet' });
    expect(estimerTemps({ baremeMinutes: null, tempsObservesMinutes: [30, 45, 600] })).toMatchObject({ minutes: 45, base: 'temps_observes', nbObservations: 3 });
    expect(estimerTemps({ baremeMinutes: null, tempsObservesMinutes: [30, 40, 50, 61] })).toMatchObject({ minutes: 45 });
    expect(estimerTemps({ baremeMinutes: null, tempsObservesMinutes: [30, 45] })).toMatchObject({ statut: 'non_estimable', minutes: null, base: null });
    expect(estimerTemps({ baremeMinutes: null, tempsObservesMinutes: [0, -5, 30, 45] }).statut).toBe('non_estimable'); // valeurs invalides ignorées
    expect(estimerTemps({ baremeMinutes: 0, tempsObservesMinutes: [] }).statut).toBe('non_estimable');
  });
});
