/** Recette du tableau 2033-F (D-116) : composition du capital par saisie ligne par ligne ; totaux 905 et 906 de la notice seulement. */
import { describe, expect, it } from 'vitest';
import { type SaisieTableau, validerSaisieTableau } from './saisies-tableaux.js';
import { preparerFormulaire2033F } from './formulaire-2033f.js';

const TRACE = { note: 'Registre des associés au 31 décembre', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
const s = (tableau: SaisieTableau['tableau'], ligne: string, valeurs: Record<string, string>, x: Partial<SaisieTableau> = {}): SaisieTableau => ({ tableau, ligne, valeurs, ...TRACE, ...x });
const PM = { formeJuridique: 'SAS', denomination: 'Holding Exemple', siren: '123456789', adresseNumero: '12', adresseVoie: 'rue de l’Exemple', codePostal: '75000', commune: 'Paris', pays: 'France', pourcentage: '60.00', parts: '600.00' };
const PP = { titre: 'MME', nomFamille: 'Durand', nomUsage: '', prenoms: 'Alice', naissanceDate: '1980-05-17', naissanceDepartement: '75', naissanceCommune: 'Paris', naissancePays: 'France', adresseNumero: '3', adresseVoie: 'avenue du Test', codePostal: '69000', commune: 'Lyon', pays: 'France', pourcentage: '40.00', parts: '400.00' };
const NB = (a: string, b: string, c: string, d: string) => s('2033F_NB', 'NB', { c901: a, c902: b, c903: c, c904: d });
const prep = (l: SaisieTableau[] = []) => preparerFormulaire2033F({ versionDonnees: 7, saisiesTableaux: l });

describe('2033-F : abstention, néant, calcul de la notice', () => {
  it('sans saisie : 905 et 906 en abstention sans chiffre, six lignes à saisir', () => {
    const f = prep();
    expect(f.etat).toBe('a_saisir');
    expect(f.nombres.total905).toMatchObject({ statut: 'abstention', codeCase: '905' });
    expect(f.nombres.total906).toMatchObject({ statut: 'abstention', codeCase: '906' });
    expect(JSON.stringify([f.nombres.total905, f.nombres.total906])).not.toMatch(/"montant"/);
    expect([...f.personnesMorales, ...f.personnesPhysiques].every((l) => l.statut === 'a_saisir' && l.valeurs === null)).toBe(true);
    expect(f.personnesMorales).toHaveLength(4);
    expect(f.personnesPhysiques).toHaveLength(2);
  });
  it('901 à 904 saisies : 905 = 901 + 903 et 906 = 902 + 904 (formulaire)', () => {
    const f = prep([NB('1', '600.00', '1', '400.00')]);
    expect(f.nombres.total905).toMatchObject({ statut: 'etabli', montant: '2.00', codeCase: '905' });
    expect(f.nombres.total906).toMatchObject({ statut: 'etabli', montant: '1000.00', codeCase: '906' });
    expect(f.nombres.cases.map((c) => c.code)).toEqual(['901', '902', '903', '904']);
  });
  it('néant du tableau : totaux à zéro ; néant ET saisies signalé ; à revoir : abstention', () => {
    expect(prep([s('2033F_NB', 'NEANT', {})]).nombres.total905).toMatchObject({ statut: 'etabli', montant: '0.00' });
    expect(prep([s('2033F_NB', 'NEANT', {}), NB('1', '1.00', '0.00', '0.00')]).controles.some((c) => c.code === 'F_NEANT_ET_LIGNES')).toBe(true);
    expect(prep([s('2033F_NB', 'NB', { c901: '1', c902: '1.00', c903: '0', c904: '0.00' }, { versionDonnees: 3 })]).nombres.total905.statut).toBe('abstention');
  });
});

describe('2033-F : lignes d’associés et contrôles indicatifs', () => {
  it('lignes saisies, pourcentages et parts rapprochés des cases 901 à 904', () => {
    const f = prep([NB('1', '600.00', '1', '400.00'), s('2033F_PM', '01', PM), s('2033F_PP', '01', PP)]);
    expect(f.etat).toBe('saisi');
    expect(f.personnesMorales[0]).toMatchObject({ statut: 'saisi', valeurs: { denomination: 'Holding Exemple' }, trace: { qualifieePar: 'u-1' } });
    expect(f.controles.find((c) => c.code === 'F_POURCENTAGES')?.statut).toBe('coherent');
    expect(f.controles.some((c) => c.code.startsWith('F_PM_') || c.code.startsWith('F_PP_'))).toBe(false);
  });
  it('pourcentages au-delà de 100, associés ou parts au-delà des totaux déclarés : écarts signalés, jamais corrigés', () => {
    const f = prep([NB('0', '100.00', '0', '100.00'), s('2033F_PM', '01', { ...PM, pourcentage: '70.00' }), s('2033F_PP', '01', { ...PP, pourcentage: '40.00' })]);
    expect(f.controles.find((c) => c.code === 'F_POURCENTAGES')).toMatchObject({ statut: 'ecart', ecart: '10.00' });
    expect(f.controles.find((c) => c.code === 'F_PM_ASSOCIES')?.statut).toBe('ecart');
    expect(f.controles.find((c) => c.code === 'F_PM_PARTS')).toMatchObject({ statut: 'ecart', ecart: '500.00' });
    expect(f.personnesMorales[0]!.valeurs!.pourcentage).toBe('70.00');
  });
  it('une ligne donnée sur une autre version des données est « à revoir » et ne compte plus', () => {
    const f = prep([s('2033F_PM', '01', PM, { versionDonnees: 4 })]);
    expect(f.personnesMorales[0]).toMatchObject({ statut: 'a_revoir', valeurs: null });
    expect(f.etat).toBe('a_saisir');
  });
});

describe('2033-F : forme des saisies', () => {
  it('personne morale : dénomination obligatoire, SIREN à 9 chiffres ou vide, pourcentage borné, lignes 01 à 04 seulement', () => {
    expect(validerSaisieTableau('2033F_PM', '01', PM)).toEqual([]);
    expect(validerSaisieTableau('2033F_PM', '01', { ...PM, siren: '' })).toEqual([]);
    expect(validerSaisieTableau('2033F_PM', '01', { ...PM, siren: '12345' }).join(' ')).toMatch(/siren/);
    expect(validerSaisieTableau('2033F_PM', '01', { ...PM, denomination: '' }).join(' ')).toMatch(/denomination/);
    expect(validerSaisieTableau('2033F_PM', '01', { ...PM, pourcentage: '120.00' }).join(' ')).toMatch(/au plus 100/);
    expect(validerSaisieTableau('2033F_PM', '05', PM).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2033F_PM', '01', { ...PM, inconnu: 'x' }).join(' ')).toMatch(/inconnu/);
  });
  it('personne physique : titre M ou MME, date de naissance ISO, lignes 01 et 02 seulement', () => {
    expect(validerSaisieTableau('2033F_PP', '02', PP)).toEqual([]);
    expect(validerSaisieTableau('2033F_PP', '01', { ...PP, titre: 'X' }).join(' ')).toMatch(/titre/);
    expect(validerSaisieTableau('2033F_PP', '01', { ...PP, naissanceDate: '17/05/1980' }).join(' ')).toMatch(/naissanceDate/);
    expect(validerSaisieTableau('2033F_PP', '03', PP).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('2033F_NB', 'NB', { c901: '1', c902: '2', c903: '3', c904: '4' })).toEqual([]);
    expect(validerSaisieTableau('2033F_NB', 'NB', { c901: '-1', c902: '2', c903: '3', c904: '4' }).join(' ')).toMatch(/positif/);
  });
});
