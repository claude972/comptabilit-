/** Corpus SYNTHÉTIQUE — tâche `suggerer_rapprochements`. Aucune donnée réelle. */
import type { EntreeRapprochements } from '../../taches/rapprochements.js';
import type { JeuEvaluation } from '../harnais.js';

const BASE: EntreeRapprochements = {
  mouvements: [
    { id: 'M1', date: '2025-03-14', montant: '1200.00', libelle: 'VIR CLIENT DURAND FAC 2025-031', reference: null, tiers: null },
    { id: 'M2', date: '2025-03-15', montant: '-350.50', libelle: 'PRLV ASSURANCE', reference: null, tiers: null },
  ],
  ecritures: [
    { id: 'E1', date: '2025-03-10', montant: '700.00', libelle: 'Facture 2025-031 acompte', reference: '2025-031', tiers: 'DURAND' },
    { id: 'E2', date: '2025-03-12', montant: '500.00', libelle: 'Facture 2025-031 solde', reference: '2025-031', tiers: 'DURAND' },
    { id: 'E3', date: '2025-03-15', montant: '-350.50', libelle: 'Assurance locaux', reference: null, tiers: 'ASSUREUR' },
    { id: 'E4', date: '2025-03-20', montant: '900.00', libelle: 'Facture 2025-040', reference: '2025-040', tiers: 'MARTIN' },
  ],
};

export const CORPUS_RAPPROCHEMENTS: JeuEvaluation<EntreeRapprochements> = {
  tache: 'suggerer_rapprochements',
  version: '1.0.0',
  cas: [
    {
      id: 'RA-01',
      description: 'Deux suggestions justes (dont un groupe 1 mouvement / 2 écritures).',
      entree: BASE,
      simulation: [
        {
          json: {
            suggestions: [
              { mouvementIds: ['M1'], ecritureIds: ['E1', 'E2'], explication: 'Le virement mentionne la facture 2025-031, comme les deux écritures du tiers DURAND.', indice: 0.8 },
              { mouvementIds: ['M2'], ecritureIds: ['E3'], explication: 'Prélèvement d’assurance du même jour.', indice: 0.7 },
            ],
          },
        },
      ],
      attendu: { issue: 'propose', cle: { retenues: [[['M1'], ['E1', 'E2']], [['M2'], ['E3']]], ecartees: 0 } },
    },
    {
      id: 'RA-02',
      description: 'Une suggestion fausse arithmétiquement est écartée et comptée ; la juste est gardée.',
      entree: BASE,
      simulation: [
        {
          json: {
            suggestions: [
              { mouvementIds: ['M1'], ecritureIds: ['E4'], explication: 'Montants proches.', indice: 0.6 },
              { mouvementIds: ['M2'], ecritureIds: ['E3'], explication: 'Prélèvement d’assurance.', indice: 0.7 },
            ],
          },
        },
      ],
      attendu: { issue: 'propose', cle: { retenues: [[['M2'], ['E3']]], ecartees: 1 } },
    },
    {
      id: 'RA-03',
      description: 'Aucune suggestion ne tombe juste : rejet.',
      entree: BASE,
      simulation: [{ json: { suggestions: [{ mouvementIds: ['M1'], ecritureIds: ['E1'], explication: 'Même facture.', indice: 0.9 }, { mouvementIds: ['M9'], ecritureIds: ['E3'], explication: 'Identifiant inventé.', indice: 0.9 }] } }],
      attendu: { issue: 'rejet', cle: { motifs: ['arithmetique_fausse', 'identifiant_inconnu'] } },
    },
    {
      id: 'RA-04',
      description: 'Le modèle ne propose rien : abstention.',
      entree: BASE,
      simulation: [{ json: { suggestions: [] } }],
      attendu: { issue: 'abstention' },
    },
  ],
};
