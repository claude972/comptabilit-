/** Recette du tableau 2033-D (D-114) : saisie case par case, néant distinct du manque, calculs seulement énoncés par la notice, contrôles indicatifs. */
import { describe, expect, it } from 'vitest';
import type { QualificationRenvoi, ResultatFiscalProjet } from './detail-resultat.js';
import { CASES_2033_D, preparerFormulaire2033D, type DemandeFormulaire2033D } from './formulaire-2033d.js';
import { validerSaisieTableau, type SaisieTableau } from './saisies-tableaux.js';

const TRACE = { note: 'Saisie du cabinet pour l’essai', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const rv = (cle: string, montant: string, s: Partial<QualificationRenvoi> = {}): QualificationRenvoi => ({ code: `D_${cle}`, montant, ...TRACE, ...s });
const ligneC = (ligne: string, valeurs: Record<string, string>, s: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau: '2033D_C', ligne, valeurs, ...TRACE, ...s });
const rf = (surcharge: Partial<ResultatFiscalProjet> = {}): ResultatFiscalProjet => ({
  resultatComptable: { statut: 'etabli', sens: 'benefice', montant: '1000.00', codeCase: '312', etatCodeCase: 'lu_verifie' },
  lignes: [
    { cle: 'RF_322', codeCase: '322', etatCodeCase: 'lu_verifie', libelle: 'Provisions non déductibles', role: 'reintegration', statut: 'saisi', neant: false, montant: '300.00', saisie: null, precision: '', detail: [], controleDetail: null },
    { cle: 'RF_360', codeCase: '360', etatCodeCase: 'lu_verifie', libelle: 'Imputés', role: 'imputation', statut: 'saisi', neant: false, montant: '200.00', saisie: null, precision: '', detail: [], controleDetail: null },
  ],
  avantImputation: { statut: 'etabli', sens: 'deficit', montant: '90.00', codeCase: '354', etatCodeCase: 'lu_verifie' },
  plafondImputation: null,
  apresImputation: { statut: 'etabli', sens: 'deficit', montant: '90.00', codeCase: '372', etatCodeCase: 'lu_verifie' },
  controles: [], lignesManquantes: [], nonPrepare: [],
  ...surcharge,
});
const prep = (renvois: QualificationRenvoi[] = [], saisiesTableaux: SaisieTableau[] = [], resultatFiscal: ResultatFiscalProjet | null = null) =>
  preparerFormulaire2033D({ versionDonnees: 7, renvois, saisiesTableaux, resultatFiscal } as DemandeFormulaire2033D);
const cas = (f: ReturnType<typeof prep>, code: string) => f.cases.find((c) => c.codeCase === code)!;

describe('2033-D : définition des cases', () => {
  it('69 cases lues sur le formulaire (cadres I-A, I-B, II, III), clés uniques', () => {
    expect(CASES_2033_D.length).toBe(36 + 18 + 7 + 7); // I-A : 9 lignes × 4 ; I-B : 9 lignes × 2 ; II : 7 ; III : 7
    expect(new Set(CASES_2033_D.map((c) => c.cle)).size).toBe(CASES_2033_D.length);
    expect(CASES_2033_D.map((c) => c.codeCase)).toEqual(expect.arrayContaining(['600', '606', '680', '686', '681', '683', '770', '775', '982', '982 bis', '982 ter', '983', '984', '860', '381', '325', '327', '374', '378', '399', '398', '397']));
  });
});

describe('2033-D : saisie, néant, abstention', () => {
  it('sans saisie : aucune case présumée nulle, 870 et 780 en abstention sans chiffre', () => {
    const f = prep();
    expect(f.cases.every((c) => c.statut === 'a_saisir' && c.montant === null && !c.neant && c.etatCodeCase === 'lu_verifie')).toBe(true);
    expect(f.total870).toMatchObject({ statut: 'abstention', codeCase: '870' });
    expect(f.cadreC.total780).toMatchObject({ statut: 'abstention', codeCase: '780' });
    expect(JSON.stringify(f.total870)).not.toMatch(/"montant"/);
    expect(f.cadreC.etat).toBe('a_saisir');
  });

  it('néant (0,00) distinct d’une case non renseignée ; saisie « à revoir » après changement des données', () => {
    const f = prep([rv('600', '0.00'), rv('602', '50.00', { versionDonnees: 6 })]);
    expect(cas(f, '600')).toMatchObject({ statut: 'saisi', neant: true, montant: '0.00', saisie: { qualifieePar: 'u-1' } });
    expect(cas(f, '602')).toMatchObject({ statut: 'a_revoir', montant: null });
    expect(cas(f, '604')).toMatchObject({ statut: 'a_saisir', neant: false });
  });

  it('870 = 984 + 860 seulement quand les deux sont saisies (notice) ; sinon abstention nommant la case manquante', () => {
    expect(prep([rv('984', '1000.00')]).total870).toMatchObject({ statut: 'abstention' });
    expect(JSON.stringify(prep([rv('984', '1000.00')]).total870)).toMatch(/860/);
    expect(prep([rv('984', '1000.00'), rv('860', '250.50')]).total870).toMatchObject({ statut: 'etabli', montant: '1250.50', codeCase: '870' });
  });
});

describe('2033-D : cadre C et lien avec le 2033-B', () => {
  it('sept lignes : total 780 calculé sur les lignes saisies ; néant ; néant ET lignes signalé ; contrôle avec la case 322', () => {
    const f = prep([], [ligneC('01', { nature: 'Indemnités de congés à payer', montant: '200.00' }), ligneC('02', { nature: 'Charges à payer non déductibles', montant: '100.00' })], rf());
    expect(f.cadreC.etat).toBe('saisi');
    expect(f.cadreC.total780).toMatchObject({ statut: 'etabli', montant: '300.00', codeCase: '780' });
    expect(f.controles.find((c) => c.code === 'D_780_322')?.statut).toBe('coherent');
    const ecart = prep([], [ligneC('01', { nature: 'Indemnités', montant: '250.00' })], rf());
    expect(ecart.controles.find((c) => c.code === 'D_780_322')).toMatchObject({ statut: 'ecart', ecart: '-50.00' });
    expect(prep([], [ligneC('NEANT', {})]).cadreC.total780).toMatchObject({ statut: 'etabli', montant: '0.00' });
    expect(prep([], [ligneC('NEANT', {}), ligneC('01', { nature: 'Indemnités', montant: '1.00' })]).controles.some((c) => c.code === 'D_C_NEANT_ET_LIGNES')).toBe(true);
    expect(prep([], [ligneC('01', { nature: 'Indemnités', montant: '1.00' }, { versionDonnees: 3 })]).cadreC.total780.statut).toBe('abstention');
  });

  it('983 et 860 : PROPOSÉS par la partie B du 2033-B (360 saisie, 372 déficit), jamais retenus sans saisie ; contrôle si saisis', () => {
    const f = prep([], [], rf());
    expect(cas(f, '983')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '200.00' } });
    expect(cas(f, '860')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '90.00' } });
    expect(f.total870.statut).toBe('abstention'); // la proposition n'est pas retenue
    const saisi = prep([rv('983', '200.00'), rv('860', '95.00')], [], rf());
    expect(saisi.controles.find((c) => c.code === 'D_983_2033B')?.statut).toBe('coherent');
    expect(saisi.controles.find((c) => c.code === 'D_860_2033B')).toMatchObject({ statut: 'ecart', ecart: '5.00' });
    expect(cas(saisi, '983').proposition).toBeNull(); // saisi : plus de proposition
  });
});

describe('2033-D : contrôles indicatifs du cadre I', () => {
  it('début + augmentations − diminutions = fin ; totaux de colonnes ; 770 et 775 ; jamais de correction', () => {
    const f = prep([rv('600', '100.00'), rv('602', '50.00'), rv('604', '20.00'), rv('606', '130.00'), rv('610', '10.00'), rv('612', '0.00'), rv('614', '0.00'), rv('616', '10.00')]);
    expect(f.controles.find((c) => c.code === 'D_FIN_AD')?.statut).toBe('coherent');
    expect(f.controles.find((c) => c.code === 'D_FIN_APR')?.statut).toBe('coherent');
    const faux = prep([rv('600', '100.00'), rv('602', '50.00'), rv('604', '20.00'), rv('606', '999.00')]);
    expect(faux.controles.find((c) => c.code === 'D_FIN_AD')).toMatchObject({ statut: 'ecart', ecart: '869.00' });
    expect(cas(faux, '606').montant).toBe('999.00');
    const lignes = ['700', '710', '720', '730', '740', '750', '760', '681'].map((c) => rv(c, '10.00'));
    expect(prep([...lignes, rv('770', '80.00')]).controles.find((c) => c.code === 'D_DEROG_770')?.statut).toBe('coherent');
    expect(prep([...lignes, rv('770', '70.00')]).controles.find((c) => c.code === 'D_DEROG_770')).toMatchObject({ statut: 'ecart', ecart: '-10.00' });
  });

  it('transfert de plein droit sans opération : signalé ; cadre IV hors périmètre : dit', () => {
    expect(prep([rv('982B', '500.00'), rv('982T', '0.00')]).controles.some((c) => c.code === 'D_982_OPERATIONS')).toBe(true);
    expect(prep().nonPrepare.join(' ')).toMatch(/Cadre IV/);
  });
});

describe('2033-D : forme des saisies du cadre C', () => {
  it('lignes 01 à 07 : nature et montant positif ; néant sans valeur', () => {
    expect(validerSaisieTableau('2033D_C', '03', { nature: 'Congés à payer', montant: '100.00' })).toEqual([]);
    expect(validerSaisieTableau('2033D_C', '03', { nature: 'x', montant: '-1.00' }).join(' ')).toMatch(/nature|positif/);
    expect(validerSaisieTableau('2033D_C', '08', { nature: 'Congés', montant: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2033D_C', 'NEANT', {})).toEqual([]);
  });
});
