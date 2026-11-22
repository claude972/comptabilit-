/** Recette du tableau 2059-A (D-121) : plus et moins-values par saisie ligne par ligne ; totaux énoncés seulement quand la saisie est complète. */
import { describe, expect, it } from 'vitest';
import { type SaisieTableau, validerSaisieTableau } from './saisies-tableaux.js';
import { preparerFormulaire2059A } from './formulaire-2059a.js';

const TRACE = { note: 'Registre des immobilisations', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const s = (tableau: SaisieTableau['tableau'], ligne: string, valeurs: Record<string, string>, x: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau, ligne, valeurs, ...TRACE, ...x });
const CESSION = { nature: 'Camionnette 2021', c2: '30000.00', c4: '0.00', c5: '24000.00', c6: '6000.00', c7: '9000.00', c8: '3000.00', c9: '3000.00' };
const FIXES = [s('2059A_AUT', '13', { c9: '0.00' }), s('2059A_AUT', '14', { c9: '0.00' }), s('2059A_AUT', '15', { c9: '0.00' }), s('2059A_AUT', '16', { c9: '0.00' }), s('2059A_AUT', '18', { c10a: '0.00' }), s('2059A_AUT', '19', { c10b: '100.00' }), s('2059A_AUT', '20', { c11: '-5.00' })];
const prep = (l: SaisieTableau[] = []) => preparerFormulaire2059A({ versionDonnees: 7, saisiesTableaux: l });

describe('2059-A', () => {
  it('sans saisie : à saisir, cadres en abstention', () => {
    const f = prep();
    expect(f.etat).toBe('a_saisir');
    expect(f.immobilisations).toHaveLength(12);
    expect(f.autres.map((l) => l.ligne)).toEqual(['13', '14', '15', '16', '18', '19', '20']);
    expect(f.cadres.A.statut).toBe('abstention');
  });
  it('totaux établis seulement avec une cession et les sept lignes fixes ; néant ; à revoir', () => {
    expect(prep([s('2059A_IM', '01', CESSION)]).cadres.A.statut).toBe('abstention');
    const f = prep([s('2059A_IM', '01', CESSION), s('2059A_IM', '02', { nature: 'Titres X', c8: '500.00', c10b: '500.00' }), ...FIXES]);
    expect(f.etat).toBe('saisi');
    expect(f.cadres.A).toEqual({ statut: 'etabli', montant: '3000.00' });
    expect(f.cadres.B).toEqual({ statut: 'etabli', montant: '600.00' });
    // Cadre B par taux (D-153) : somme des trois colonnes = cadre B, mêmes conditions d'établissement.
    const parTaux = Object.values(f.cadreBParTaux).map((t) => (t.statut === 'etabli' ? Number(t.montant) : NaN));
    expect(parTaux.reduce((a, b) => a + b, 0).toFixed(2)).toBe('600.00');
    expect(f.cadres.C).toEqual({ statut: 'etabli', montant: '-5.00' });
    expect(prep([s('2059A_IM', 'NEANT', {})]).etat).toBe('neant');
    expect(prep([s('2059A_IM', 'NEANT', {}), s('2059A_IM', '01', CESSION)]).controles.some((c) => c.code === 'A59_NEANT_ET_LIGNES')).toBe(true);
    const r = prep([s('2059A_IM', '01', CESSION, { versionDonnees: 3 }), ...FIXES]);
    expect(r.immobilisations[0]).toMatchObject({ statut: 'a_revoir', valeurs: null });
    expect(r.cadres.A.statut).toBe('abstention');
  });
  it('contrôles indicatifs : col. 8 = col. 7 − col. 6, qualification = col. 8 ; jamais corrigés', () => {
    const f = prep([s('2059A_IM', '01', { ...CESSION, c8: '2500.00' })]);
    expect(f.controles.find((c) => c.code === 'A59_PV_01')).toMatchObject({ statut: 'ecart', ecart: '-500.00' });
    expect(f.controles.find((c) => c.code === 'A59_QUALIF_01')).toMatchObject({ statut: 'ecart', ecart: '500.00' });
    expect(f.immobilisations[0]!.valeurs!.c8).toBe('2500.00');
    expect(prep([s('2059A_IM', '01', CESSION)]).controles.some((c) => c.code.startsWith('A59_PV') || c.code.startsWith('A59_QUALIF'))).toBe(false);
  });
  it('forme des saisies', () => {
    expect(validerSaisieTableau('2059A_IM', '12', CESSION)).toEqual([]);
    expect(validerSaisieTableau('2059A_IM', '13', CESSION).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059A_IM', '01', { nature: 'X1' }).join(' ')).toMatch(/Au moins une colonne/);
    expect(validerSaisieTableau('2059A_IM', '01', { nature: 'Bien', c2: '-1.00' }).join(' ')).toMatch(/positif/);
    expect(validerSaisieTableau('2059A_IM', '01', { nature: 'Bien', c8: '-1.00' })).toEqual([]);
    expect(validerSaisieTableau('2059A_AUT', '13', { c9: '5.00' })).toEqual([]);
    expect(validerSaisieTableau('2059A_AUT', '13', { c10a: '5.00' }).join(' ')).toMatch(/non servie/);
    expect(validerSaisieTableau('2059A_AUT', '17', { c9: '5.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2059A_AUT', '20', { c11: '-5.00' })).toEqual([]);
  });
});
