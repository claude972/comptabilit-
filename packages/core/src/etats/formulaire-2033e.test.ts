/** Recette du tableau 2033-E (D-115) : effectifs et valeur ajoutée par saisie ; totaux seulement quand le formulaire les énonce et que tout est saisi. */
import { describe, expect, it } from 'vitest';
import type { QualificationRenvoi } from './detail-resultat.js';
import { CASES_2033_E, dureeEnMois, preparerFormulaire2033E } from './formulaire-2033e.js';

const TRACE = { note: 'Saisie du cabinet pour l’essai', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const rv = (code: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: `E_${code}`, montant, ...TRACE, ...s });
const prep = (renvois: QualificationRenvoi[] = [], exercice = { debut: '2026-01-01', fin: '2026-12-30' }) => preparerFormulaire2033E({ versionDonnees: 7, exercice, renvois });
const T1 = ['108', '118', '119'], T2 = ['115', '143', '113', '111', '153'], T3 = ['121', '145', '125', '310', '133', '148', '128', '135', '150'];
const tous = (codes: string[], m: string) => codes.map((c) => rv(c, m));

describe('2033-E : cases', () => {
  it('25 cases lues sur le formulaire, clés uniques', () => {
    // effectifs 4, I 3, II 5, III 9, mono 4 = 25
    expect(CASES_2033_E).toHaveLength(25);
    expect(new Set(CASES_2033_E.map((c) => c.cle)).size).toBe(25);
  });
  it('durée de l’exercice en mois entiers (arrondie à l’unité la plus proche)', () => {
    expect(dureeEnMois('2026-01-01', '2026-12-30')).toBe(12);
    expect(dureeEnMois('2026-01-01', '2026-12-31')).toBe(12);
    expect(dureeEnMois('2026-04-01', '2026-12-31')).toBe(9);
    expect(dureeEnMois('2025-01-01', '2026-12-31')).toBe(24);
  });
});

describe('2033-E : abstention, néant, à revoir', () => {
  it('sans saisie : tous les totaux en abstention sans chiffre, aucune case présumée nulle', () => {
    const f = prep();
    expect(f.cases.every((c) => c.statut === 'a_saisir' && c.montant === null)).toBe(true);
    for (const t of [f.total1, f.total2, f.total3, f.valeurAjoutee137, f.valeurAjoutee117]) expect(t.statut).toBe('abstention');
    expect(JSON.stringify([f.total1, f.valeurAjoutee137])).not.toMatch(/"montant"/);
    expect(f.total1).toMatchObject({ codeCase: '106' });
  });
  it('un total n’est calculé que si toutes ses composantes sont saisies (néant compris) ; l’absence est nommée', () => {
    const f = prep([rv('108', '1000.00'), rv('118', '0.00')]);
    expect(f.total1).toMatchObject({ statut: 'abstention' });
    expect(JSON.stringify(f.total1)).toMatch(/119/);
    expect(prep([...tous(T1, '10.00')]).total1).toMatchObject({ statut: 'etabli', montant: '30.00', codeCase: '106' });
  });
  it('saisie « à revoir » : ne compte plus', () => {
    const f = prep([...tous(T1, '10.00').slice(0, 2), rv('119', '10.00', { versionDonnees: 3 })]);
    expect(f.cases.find((c) => c.codeCase === '119')).toMatchObject({ statut: 'a_revoir', montant: null });
    expect(f.total1.statut).toBe('abstention');
  });
});

describe('2033-E : calculs énoncés par le formulaire', () => {
  it('Total 1, Total 2, Total 3, valeur ajoutée (137) et case 117', () => {
    const f = prep([...T1.map((c) => rv(c, '1000.00')), ...T2.map((c) => rv(c, '100.00')), ...T3.map((c) => rv(c, '200.00'))]);
    expect(f.total1).toMatchObject({ montant: '3000.00', codeCase: '106' });
    expect(f.total2).toMatchObject({ montant: '500.00', codeCase: '144' });
    expect(f.total3).toMatchObject({ montant: '1800.00', codeCase: '152' });
    expect(f.valeurAjoutee137).toMatchObject({ statut: 'etabli', montant: '1700.00', codeCase: '137' });
    expect(f.valeurAjoutee117).toMatchObject({ statut: 'etabli', montant: '1700.00', codeCase: '117' });
  });
  it('valeur ajoutée négative : 137 négative, 117 reportée à 0 (instruction du formulaire)', () => {
    const f = prep([...T1.map((c) => rv(c, '10.00')), ...T2.map((c) => rv(c, '0.00')), ...T3.map((c) => rv(c, '100.00'))]);
    expect(f.valeurAjoutee137).toMatchObject({ montant: '-870.00' });
    expect(f.valeurAjoutee117).toMatchObject({ montant: '0.00' });
    expect(f.valeurAjoutee117.statut === 'etabli' && f.valeurAjoutee117.calcul).toMatch(/négative/);
  });
  it('décimaux exacts', () => {
    const f = prep([rv('108', '0.10'), rv('118', '0.20'), rv('119', '0.00')]);
    expect(f.total1).toMatchObject({ montant: '0.30' });
  });
});

describe('2033-E : case 022 et contrôles indicatifs', () => {
  const totaux = [...T1.map((c) => rv(c, '100.00'))];
  it('022 proposée (= 106) pour un exercice de 12 mois, jamais retenue sans saisie ; pas de proposition autrement', () => {
    expect(prep(totaux).cases.find((c) => c.codeCase === '022')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '300.00' } });
    expect(prep(totaux, { debut: '2026-04-01', fin: '2026-12-31' }).cases.find((c) => c.codeCase === '022')!.proposition).toBeNull();
    const saisie = prep([...totaux, rv('022', '300.00')]);
    expect(saisie.cases.find((c) => c.codeCase === '022')!.proposition).toBeNull();
    expect(saisie.controles.find((c) => c.code === 'E_022_106')?.statut).toBe('coherent');
    expect(prep([...totaux, rv('022', '250.00')]).controles.find((c) => c.code === 'E_022_106')).toMatchObject({ statut: 'ecart', ecart: '-50.00' });
  });
  it('apprentis, handicapés et effectif artisanal supérieurs à l’effectif moyen : signalé ; case 020 hors 0 / 1 : signalé', () => {
    const f = prep([rv('376', '10.00'), rv('657', '12.00'), rv('651', '2.00'), rv('020', '3.00')]);
    expect(f.controles.find((c) => c.code === 'E_657_EFFECTIF')?.statut).toBe('ecart');
    expect(f.controles.some((c) => c.code === 'E_651_EFFECTIF')).toBe(false);
    expect(f.controles.some((c) => c.code === 'E_020_FORME')).toBe(true);
  });
  it('le non préparé est dit (dates, règles CVAE)', () => {
    expect(prep().nonPrepare.join(' ')).toMatch(/024 et 016/);
  });
});
