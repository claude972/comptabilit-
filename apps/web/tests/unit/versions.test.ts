import { describe, expect, it } from 'vitest';
import type { VersionDocument } from '@/lib/types-api';
import { LIBELLE_VALIDATION_INVALIDEE, compteRenduVersion, droitNouvelleVersion, estRemplacee, sansRemplacees, statutValidation, versionCourante, versionRemplacante } from '@/lib/versions';

const chaine: VersionDocument[] = [
  { id: 'a', version: 1, statut: 'remplace', creeLe: '2026-01-01' },
  { id: 'b', version: 2, statut: 'remplace', creeLe: '2026-01-02' },
  { id: 'c', version: 3, statut: 'a_controler', creeLe: '2026-01-03' },
];

describe('versions d’une pièce', () => {
  it('reconnaît une version remplacée par son statut ou par son lien vers la suivante', () => {
    expect(estRemplacee({ statut: 'remplace', remplacePar: null })).toBe(true);
    expect(estRemplacee({ statut: 'traite', remplacePar: 'b' })).toBe(true);
    expect(estRemplacee({ statut: 'traite', remplacePar: null })).toBe(false);
    expect(estRemplacee({ statut: null })).toBe(false);
  });
  it('masque les versions remplacées seulement quand le filtre est actif', () => {
    const pieces = [{ id: 1, statut: 'remplace' as const, remplacePar: 'x' }, { id: 2, statut: 'a_controler' as const, remplacePar: null }];
    expect(sansRemplacees(pieces, true).map((p) => p.id)).toEqual([2]);
    expect(sansRemplacees(pieces, false).map((p) => p.id)).toEqual([1, 2]);
  });
  it('retrouve la version remplaçante et la version courante de la chaîne', () => {
    expect(versionRemplacante(chaine, 'b')?.version).toBe(2);
    expect(versionRemplacante(chaine, null)).toBeNull();
    expect(versionRemplacante(chaine, 'inconnue')).toBeNull();
    expect(versionCourante(chaine)?.id).toBe('c');
    expect(versionCourante([])).toBeNull();
  });
  it('ne lit jamais « validation invalidée » comme une validation', () => {
    expect(statutValidation('valide')).toBe('validee');
    expect(statutValidation('validation_invalidee')).toBe('validation_invalidee');
    expect(statutValidation('projet')).toBe('projet');
    expect(statutValidation('rejete')).toBe('projet');
    expect(statutValidation(undefined)).toBe('projet');
    expect(LIBELLE_VALIDATION_INVALIDEE).toMatch(/invalidée/);
  });
});

describe('droit de déposer une nouvelle version', () => {
  const base = { estVersionCourante: true, statut: 'a_controler' as const, deposeeParMoi: false };
  it('collaborateur habilité : toute pièce courante, sauf quarantaine', () => {
    expect(droitNouvelleVersion({ ...base, niveau: 'collaboration' }).possible).toBe(true);
    expect(droitNouvelleVersion({ ...base, niveau: 'revision', statut: 'traite' }).possible).toBe(true);
    expect(droitNouvelleVersion({ ...base, niveau: 'validation', statut: 'quarantaine' })).toMatchObject({ possible: false, raison: expect.stringMatching(/quarantaine/) });
  });
  it('déposant : sa pièce seulement, et tant qu’elle n’est pas validée', () => {
    expect(droitNouvelleVersion({ ...base, niveau: 'depot', deposeeParMoi: true }).possible).toBe(true);
    expect(droitNouvelleVersion({ ...base, niveau: 'depot', deposeeParMoi: false })).toEqual({ possible: false, raison: null });
    expect(droitNouvelleVersion({ ...base, niveau: 'depot', deposeeParMoi: true, statut: 'traite' })).toMatchObject({ possible: false, raison: expect.stringMatching(/validée par le cabinet/) });
    expect(droitNouvelleVersion({ ...base, niveau: 'lecture', deposeeParMoi: false }).possible).toBe(false);
  });
  it('jamais sur une version remplacée', () => {
    expect(droitNouvelleVersion({ ...base, niveau: 'validation', estVersionCourante: false })).toMatchObject({ possible: false, raison: expect.stringMatching(/la plus récente/) });
  });
});

describe('compte rendu après l’envoi d’une nouvelle version', () => {
  it('annonce la version reçue et, le cas échéant, l’invalidation de la validation', () => {
    expect(compteRenduVersion({ doublonBinaire: false, nouvelleVersion: { version: 2, validationInvalidee: true } })).toMatchObject({ ton: 'attention', titre: 'Version 2 reçue', nouvelle: true, detail: expect.stringMatching(/ne vaut pas pour la version 2/) });
    const simple = compteRenduVersion({ doublonBinaire: false, nouvelleVersion: { version: 3, validationInvalidee: false } });
    expect(simple).toMatchObject({ ton: 'succes', titre: 'Version 3 reçue', nouvelle: true });
    expect(simple.detail).not.toMatch(/validation/);
  });
  it('dit qu’un fichier identique n’a rien remplacé', () => {
    expect(compteRenduVersion({ doublonBinaire: true, nouvelleVersion: null })).toMatchObject({ nouvelle: false, titre: 'Fichier identique à l’existant', detail: expect.stringMatching(/rien n’a été remplacé/) });
    expect(compteRenduVersion({ doublonBinaire: false }).nouvelle).toBe(false);
  });
});
