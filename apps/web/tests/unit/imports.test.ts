import { describe, expect, it } from 'vitest';
import {
  PHRASE_ISOLEMENT, actionsImport, compteRenduAnnulationCampagne, explicationAnnulation, explicationRetablissement, libelleTroisEtats, mentionHorsHabilitation, motifValide, sansDonneesActives, syntheseParStatut,
} from '@/lib/imports';

describe('actions proposées sur un import', () => {
  it('annuler : niveau révision, tout import non annulé', () => {
    expect(actionsImport({ statut: 'termine' }, 'revision')).toEqual(['annuler']);
    expect(actionsImport({ statut: 'en_cours' }, 'validation')).toEqual(['annuler']);
    expect(actionsImport({ statut: 'termine' }, 'collaboration')).toEqual([]);
    expect(actionsImport({ statut: 'termine' }, 'lecture')).toEqual([]);
    expect(actionsImport({ statut: 'termine' }, null)).toEqual([]);
  });
  it('rétablir : niveau révision, seulement un import annulé qui avait abouti', () => {
    expect(actionsImport({ statut: 'annule', statutAvantAnnulation: 'termine' }, 'revision')).toEqual(['retablir']);
    expect(actionsImport({ statut: 'annule', statutAvantAnnulation: 'termine' }, 'collaboration')).toEqual([]);
    expect(actionsImport({ statut: 'annule', statutAvantAnnulation: null }, 'revision')).toEqual(['reprendre']);
  });
  it('reprendre : niveau collaboration, import en échec ou annulé avant d’aboutir', () => {
    expect(actionsImport({ statut: 'echec' }, 'collaboration')).toEqual(['reprendre']);
    expect(actionsImport({ statut: 'echec' }, 'revision')).toEqual(['reprendre', 'annuler']);
    expect(actionsImport({ statut: 'annule' }, 'collaboration')).toEqual(['reprendre']);
    expect(actionsImport({ statut: 'echec' }, 'lecture')).toEqual([]);
    expect(actionsImport({ statut: 'echec' }, 'depot')).toEqual([]);
  });
});

describe('motif et explications', () => {
  it('exige un motif de 5 à 2 000 caractères, espaces exclus', () => {
    expect(motifValide('')).toBe(false);
    expect(motifValide('  ab  ')).toBe(false);
    expect(motifValide('Mauvais fichier')).toBe(true);
    expect(motifValide('x'.repeat(2001))).toBe(false);
  });
  it('dit toujours d’abord que rien n’est supprimé et que c’est réversible', () => {
    for (const lot of [{ type: 'fec' as const, actif: true, statut: 'termine' as const }, { type: 'releve_bancaire' as const, actif: true, statut: 'termine_avec_erreurs' as const }, { type: 'fec' as const, actif: false, statut: 'echec' as const }]) {
      expect(explicationAnnulation(lot)[0]).toMatch(/Rien n’est supprimé.*réversible/);
    }
  });
  it('import comptable actif : le lot précédent redevient actif, travaux à revoir', () => {
    const actif = explicationAnnulation({ type: 'fec', actif: true, statut: 'termine' }).join(' ');
    expect(actif).toMatch(/le lot précédent encore valable redevient actif/);
    expect(actif).toMatch(/à revoir/);
    expect(explicationAnnulation({ type: 'fec', actif: false, statut: 'termine' }).join(' ')).toMatch(/les données actives de l’exercice ne changent pas/);
  });
  it('relevé : mouvements écartés sauf ceux d’un autre relevé actif ; import non abouti : reprise, pas de rétablissement', () => {
    expect(explicationAnnulation({ type: 'releve_bancaire', actif: true, statut: 'termine' }).join(' ')).toMatch(/sauf ceux qui figurent aussi dans un autre relevé actif/);
    expect(explicationAnnulation({ type: 'releve_bancaire', actif: false, statut: 'en_cours' }).join(' ')).toMatch(/« Reprendre », mais pas rétabli/);
    expect(explicationRetablissement('fec')).toMatch(/redevient le lot actif/);
    expect(explicationRetablissement('releve_bancaire')).toMatch(/de nouveau pris en compte/);
  });
  it('signale un exercice qui n’a plus de données actives, sans confondre avec un import en cours ou un exercice vide', () => {
    expect(sansDonneesActives([{ actif: false, statut: 'annule' }])).toBe(true);
    expect(sansDonneesActives([{ actif: false, statut: 'annule' }, { actif: true, statut: 'termine' }])).toBe(false);
    expect(sansDonneesActives([{ actif: false, statut: 'annule' }, { actif: false, statut: 'en_cours' }])).toBe(false);
    expect(sansDonneesActives([{ actif: false, statut: 'echec' }])).toBe(false);
    expect(sansDonneesActives([])).toBe(false);
  });
});

describe('campagnes d’import', () => {
  it('synthèse par statut dans un ordre stable, sans statuts absents', () => {
    expect(syntheseParStatut({ echec: 1, termine: 2, en_cours: 0 })).toEqual([{ statut: 'termine', nombre: 2 }, { statut: 'echec', nombre: 1 }]);
    expect(syntheseParStatut({})).toEqual([]);
  });
  it('mentionne les dossiers hors habilitation seulement quand l’API en compte', () => {
    expect(mentionHorsHabilitation(0)).toBeNull();
    expect(mentionHorsHabilitation(2)).toBe('2 dossier(s) hors de votre habilitation');
  });
  it('ne confond jamais « non évalué » avec « non »', () => {
    expect([libelleTroisEtats(true), libelleTroisEtats(false), libelleTroisEtats(null), libelleTroisEtats(undefined)]).toEqual(['oui', 'non', 'non évalué', 'non évalué']);
  });
  it('rend compte de l’annulation d’une campagne d’après la réponse de l’API', () => {
    expect(compteRenduAnnulationCampagne({ annules: 2, laissesFauteHabilitation: 1 })).toBe('2 import(s) annulé(s). 1 import(s) laissé(s) en place faute d’habilitation de révision sur leur dossier. Chaque import annulé reste rétablissable individuellement.');
    expect(compteRenduAnnulationCampagne({ annules: 3, laissesFauteHabilitation: 0 })).toMatch(/Aucun import laissé en place/);
    expect(PHRASE_ISOLEMENT).toBe('Chaque dossier est traité séparément : l’échec de l’un n’affecte pas les autres.');
  });
});
