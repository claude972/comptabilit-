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
});
