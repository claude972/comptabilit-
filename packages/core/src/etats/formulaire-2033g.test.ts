/** Recette du tableau 2033-G (D-117) : filiales et participations par saisie ligne par ligne ; aucun calcul énoncé, contrôles indicatifs seulement. */
import { describe, expect, it } from 'vitest';
import { type SaisieTableau, validerSaisieTableau } from './saisies-tableaux.js';
import { preparerFormulaire2033G } from './formulaire-2033g.js';

const TRACE = { note: 'Registre des titres de participation', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const s = (tableau: SaisieTableau['tableau'], ligne: string, valeurs: Record<string, string>, x: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau, ligne, valeurs, ...TRACE, ...x });
const FIL = { formeJuridique: 'SARL', denomination: 'Filiale Exemple', siren: '987654321', adresseNumero: '5', adresseVoie: 'rue du Test', codePostal: '33000', commune: 'Bordeaux', pays: 'France', pourcentage: '55.00' };
const prep = (l: SaisieTableau[] = []) => preparerFormulaire2033G({ versionDonnees: 7, saisiesTableaux: l });

describe('2033-G', () => {
  it('sans saisie : à saisir, case 905 sans valeur, sept lignes à saisir', () => {
    const f = prep();
    expect(f.etat).toBe('a_saisir');
    expect(f.nombre).toMatchObject({ codeCase: '905', statut: 'a_saisir', montant: null, etatCodeCase: 'lu_verifie' });
    expect(f.filiales).toHaveLength(30); // 7 du formulaire + lignes d’état joint
    expect(f.filiales.every((l) => l.statut === 'a_saisir' && l.valeurs === null)).toBe(true);
  });
  it('nombre et lignes saisis : retenus avec leur trace ; néant du tableau ; à revoir', () => {
    const f = prep([s('2033G_NB', 'NB', { c905: '2' }), s('2033G_FIL', '01', FIL)]);
    expect(f.etat).toBe('saisi');
    expect(f.nombre).toMatchObject({ statut: 'saisi', montant: '2', trace: { qualifieePar: 'u-1' } });
    expect(f.filiales[0]).toMatchObject({ statut: 'saisi', valeurs: { denomination: 'Filiale Exemple' } });
    expect(f.controles.find((c) => c.code === 'G_LIGNES_MANQUANTES')?.statut).toBe('non_verifie'); // 2 filiales annoncées, 1 listée
    expect(prep([s('2033G_NB', 'NEANT', {})]).etat).toBe('neant');
    expect(prep([s('2033G_NB', 'NEANT', {}), s('2033G_FIL', '01', FIL)]).controles.some((c) => c.code === 'G_NEANT_ET_LIGNES')).toBe(true);
    expect(prep([s('2033G_FIL', '01', FIL, { versionDonnees: 3 })]).filiales[0]).toMatchObject({ statut: 'a_revoir', valeurs: null });
  });
  it('contrôles indicatifs : plus de lignes que le nombre déclaré, détention inférieure à 10 %', () => {
    const f = prep([s('2033G_NB', 'NB', { c905: '1' }), s('2033G_FIL', '01', FIL), s('2033G_FIL', '02', { ...FIL, denomination: 'Autre', pourcentage: '5.00' })]);
    expect(f.controles.find((c) => c.code === 'G_LIGNES_NOMBRE')).toMatchObject({ statut: 'ecart', ecart: '1.00' });
    expect(f.controles.find((c) => c.code === 'G_SEUIL_10')?.statut).toBe('ecart');
    expect(f.filiales[1]!.valeurs!.pourcentage).toBe('5.00'); // jamais corrigé
  });
  it('forme des saisies : dénomination obligatoire, SIREN, pourcentage, sept lignes seulement, nombre positif', () => {
    expect(validerSaisieTableau('2033G_FIL', '07', FIL)).toEqual([]);
    expect(validerSaisieTableau('2033G_FIL', '08', FIL)).toEqual([]); // ligne d’état joint
    expect(validerSaisieTableau('2033G_FIL', '31', FIL).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2033G_FIL', '01', { ...FIL, denomination: '' }).join(' ')).toMatch(/denomination/);
    expect(validerSaisieTableau('2033G_FIL', '01', { ...FIL, siren: '1' }).join(' ')).toMatch(/siren/);
    expect(validerSaisieTableau('2033G_FIL', '01', { ...FIL, pourcentage: '101.00' }).join(' ')).toMatch(/au plus 100/);
    expect(validerSaisieTableau('2033G_NB', 'NB', { c905: '3' })).toEqual([]);
    expect(validerSaisieTableau('2033G_NB', 'NB', { c905: '-1' }).join(' ')).toMatch(/positif/);
  });
});
