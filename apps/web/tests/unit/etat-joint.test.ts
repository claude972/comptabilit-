import { describe, expect, it } from 'vitest';
import { champCsv, csvEtatJoint, etatJointDe, type TableauEtatJoint } from '@/lib/etat-joint';
import type { GrilleProjet, ReponseLiasse } from '@/lib/fiscal';

const trace = { note: 'n', qualifieePar: 'u', le: '2026-01-01T00:00:00Z', versionDonnees: 1 };
const grille: GrilleProjet = {
  statut: 'projet', id: '2059-D', titre: 'Réserve', etat: 'saisi', neantPossible: true, neant: null, controles: [], nonPrepare: ['Identification non préparée'], limites: ['Limite 1'], mention: 'PROJET',
  cadres: [{
    tableau: '2059D_I', titre: 'I', colonnes: [{ cle: 't10', libelle: 'Taxées à 10 %' }], colonneCalculee: null, libelleOrigine: null,
    lignes: [{ ligne: 'L1', libelle: 'Ligne 1', groupe: null, colonnes: ['t10'], statut: 'saisi', trace, origine: null, valeurs: { t10: '100.00' }, calculee: null }, { ligne: 'L2', libelle: 'Ligne 2', groupe: null, colonnes: ['t10'], statut: 'a_saisir', trace: null, origine: null, valeurs: null, calculee: null }],
    calculs: [{ id: 'L3', libelle: 'TOTAL', cellules: { t10: { statut: 'abstention', motifs: ['Ligne 2 à saisir'] } } }],
  }],
};
const liasse = { regimeDemande: 'reel_normal', grilles2059: [grille] } as unknown as ReponseLiasse;

describe('état joint', () => {
  it('reprend les saisies, l’abstention des totaux et les limites sans rien recalculer', () => {
    const t = etatJointDe(liasse);
    expect(t).toHaveLength(1);
    expect(t[0]!.lignes.map((l) => [l.statut, l.cellules[0]])).toEqual([['saisi', '100.00'], ['à saisir', '']]);
    expect(t[0]!.totaux[0]!.cellules[0]).toMatch(/^abstention : Ligne 2 à saisir/);
    expect(t[0]!.limites).toEqual(['Limite 1', 'Identification non préparée']);
  });
  it('CSV : identification, statut et neutralisation des formules', () => {
    expect(champCsv('=1+1')).toBe("'=1+1");
    expect(champCsv('-5.00')).toBe('-5.00');
    expect(champCsv('-cmd')).toBe("'-cmd");
    expect(champCsv('a;b')).toBe('"a;b"');
    const csv = csvEtatJoint(etatJointDe(liasse) as TableauEtatJoint[], ['Dossier : Test', 'PROJET']);
    expect(csv.startsWith('﻿Dossier : Test')).toBe(true);
    expect(csv).toContain('TOTAL — TOTAL;;abstention : Ligne 2 à saisir');
  });
  it('reprend 2054 bis et 2055 cadres B et C tels que calculés par l’API, totaux et abstentions compris', () => {
    const ok = (montant: string) => ({ statut: 'etabli' as const, montant, codeCase: null, etatCodeCase: 'x' });
    const abst = { statut: 'abstention' as const, motifs: ['Ligne 2 à saisir'], codeCase: null, etatCodeCase: 'x' };
    const tr = { note: 'n', qualifieePar: 'u', le: '2026-01-01T00:00:00Z', versionDonnees: 1 };
    const l = { regimeDemande: 'reel_normal', tableauxSaisis: {
      statut: 'projet', cadreIII: null,
      ecartsReevaluation: { statut: 'projet', etat: 'saisi', lignes: [{ ligne: '01', libelle: 'Ligne 1', statut: 'saisi', trace: tr, c1: '100.00', c2: '60.00', c3: '0.00', c4: '0.00', c5: '0.00', ecart: '40.00', c6: '40.00' }], totaux: { c1: ok('100.00'), c2: ok('60.00'), c3: ok('0.00'), c4: ok('0.00'), c5: ok('0.00'), c6: abst }, cadreB: { b1: { statut: 'saisi', montant: '10.00', trace: tr }, b2: { statut: 'a_saisir', montant: null, trace: null }, b3: abst }, controles: [], limites: ['L1'], neant: null, mention: 'PROJET' },
      amortissementsDerogatoires: { statut: 'projet', etat: 'saisi', lignes: [{ ligne: '01', libelle: 'Frais', groupe: 'I', statut: 'saisi', trace: tr, colonnes: [{ codeCase: 'M9', montant: '5.00' }, null, null, null, null, null, { codeCase: 'N6', montant: '5.00' }] }], totaux: { I: [ok('5.00'), null, null, null, null, null, ok('5.00')], II: [], III: [], general: [] }, nonVentile: { NW: ok('5.00'), NY: abst, NZ: abst }, controles: [], limites: [], neant: null, mention: 'PROJET' },
      chargesRepartiesPlusieursExercices: { statut: 'projet', etat: 'saisi', lignes: [{ ligne: '01', libelle: 'Frais d’émission', statut: 'saisi', trace: tr, debut: '10.00', augmentations: '0.00', dotations: '2.00', fin: '8.00', caseDotations: 'Z9', caseFin: 'Z8' }], controles: [], limites: [], neant: null, mention: 'PROJET' },
    } } as unknown as ReponseLiasse;
    const t = etatJointDe(l);
    expect(t.map((x) => x.id)).toEqual(['2054-bis', '2055-B', '2055-C']);
    expect(t[0]!.lignes[0]!.cellules.slice(0, 2)).toEqual(['100.00', '60.00']);
    expect(t[0]!.totaux[0]!.cellules[6]).toMatch(/^abstention : Ligne 2 à saisir/);
    expect(t[1]!.lignes[0]!.cellules[0]).toBe('5.00');
    expect(t[1]!.totaux.at(-1)!.cellules[1]).toMatch(/^abstention/);
    expect(t[2]!.lignes[0]!.cellules).toEqual(['10.00', '0.00', '2.00', '8.00']);
  });
  it('reprend 2054, 2055 A et 2033-C depuis les valeurs de l’API, y compris celles issues de la balance, sans rien recalculer', () => {
    const c = (statut: 'etabli' | 'a_saisir' | 'abstention', montant: string | null, motif: string | null = null) => ({ codeCase: null, etatCodeCase: 'a_confirmer' as const, montant, n1: null, statut, motif });
    const l = { regimeDemande: 'reel_normal', tableauxImmobilisations: { statut: 'projet', complet: false, manques: ['M1'], mention: 'PROJET', reserves: ['R1'], tableaux: [{
      code: '2054', intitule: 'Immobilisations', cadresNonCouverts: [], cadres: [{ id: 'A', titre: 'Cadre A', colonnes: [{ cle: 'ouverture', numero: 1, libelle: 'Début', surFormulaire: true }, { cle: 'cloture', numero: 5, libelle: 'Fin', surFormulaire: true }], lignes: [
        { id: 'l1', libelle: 'Terrains', numeroRomain: 'I', nature: 'poste', cellules: { ouverture: c('etabli', '100.00'), cloture: c('abstention', null, 'Fichier incomplet') }, comptes: [], dontComposants: { codeCase: null, montant: '7.00', statut: 'etabli', motif: null }, fichierBrut: null, fichierAmortissements: null, note: null },
        { id: 'l2', libelle: 'Total', numeroRomain: null, nature: 'total', cellules: { ouverture: c('a_saisir', null), cloture: c('a_saisir', null) }, comptes: [], dontComposants: null, fichierBrut: null, fichierAmortissements: null, note: 'Note' },
      ] }],
    }] } } as unknown as ReponseLiasse;
    const t = etatJointDe(l);
    expect(t).toHaveLength(1);
    expect(t[0]!.colonnes).toEqual(['Ligne', 'Début', 'Fin', 'Dont composants']);
    expect(t[0]!.lignes[0]!.cellules).toEqual(['100.00', 'abstention : Fichier incomplet', '7.00']);
    expect(t[0]!.lignes[0]!.statut).toBe('poste · abstention');
    expect(t[0]!.lignes[1]!.cellules).toEqual(['', '', '']);
    expect(t[0]!.limites).toEqual(['R1', 'M1', 'Total : Note', 'PROJET']);
  });
  it('reprend le bilan et les comptes de résultat de la liasse (montants exacts, codes vérifiés ou « à confirmer »), en tête de l’état', () => {
    const ligne = (ligne: string, libelle: string, nature: 'poste' | 'total', montant: string, extra: Record<string, unknown> = {}) => ({ ligne, libelle, nature, codeCase: null, etatCodeCase: 'a_confirmer', montant, n1: null, comptes: [], note: null, ...extra });
    const l = { regimeDemande: 'reel_normal', resultat: { statut: 'projet', manques: ['M1'], mention: 'PROJET', tableaux: [
      { code: '2050', intitule: 'Bilan - actif', lignes: [ligne('RN_2050_A_TERRAINS', 'Terrains', 'poste', '50000.00', { brut: '50000.00', amortissementsDepreciations: '0.00', codesActif: { brut: 'AN', amortissements: 'AO' }, etatCodeCase: 'verifie' }), ligne('RN_2050_TOTAL_GENERAL', 'Total général', 'total', '95699.07', { brut: '177000.00', amortissementsDepreciations: '81300.93', codesActif: { brut: 'CO', amortissements: '1A' }, etatCodeCase: 'verifie' })] },
      { code: '2052', intitule: 'Compte de résultat', lignes: [ligne('RN_2052_PE', 'Total des produits d’exploitation (I)', 'total', '1000.00', { codeCase: 'FR', etatCodeCase: 'verifie' }), ligne('RN_2052_PE_PRODUCTION_VENDUE', 'Production vendue', 'poste', '800.00')] },
    ] } } as unknown as ReponseLiasse;
    const t = etatJointDe(l);
    expect(t.map((x) => x.id)).toEqual(['liasse-2050', 'liasse-2052']);
    expect(t[0]!.colonnes).toEqual(['Ligne', 'Code(s) de case', 'Brut', 'Amortissements et provisions', 'Net']);
    expect(t[0]!.lignes[1]!.cellules).toEqual(['CO / 1A', '177000.00', '81300.93', '95699.07']);
    expect(t[1]!.lignes.map((x) => x.cellules)).toEqual([['FR', '1000.00'], ['à confirmer', '800.00']]);
  });
});
