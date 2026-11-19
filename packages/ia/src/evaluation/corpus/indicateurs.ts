/** Corpus SYNTHÉTIQUE — tâche `commenter_indicateurs`. Valeurs fictives. */
import type { EntreeIndicateurs } from '../../taches/indicateurs.js';
import type { JeuEvaluation } from '../harnais.js';

const PERIODE = { debut: '2025-01-01', fin: '2025-12-31' };

const BASE: EntreeIndicateurs = {
  indicateurs: [
    { id: 'chiffre_affaires', libelle: 'Chiffre d’affaires', statut: 'calcule', valeur: '125000.00', unite: 'euros', formule: 'Soldes créditeurs des comptes 70', periode: PERIODE, motif: null, precedent: { valeur: '118000.00', variation: '7000.00', variationPourcent: '5.93' }, mentions: [] },
    { id: 'marge_brute', libelle: 'Taux de marge brute', statut: 'calcule', valeur: '32.50', unite: 'pourcentage', formule: '(Ventes 707 − Achats 607) / Ventes 707', periode: PERIODE, motif: null, precedent: null, mentions: [] },
    { id: 'delai_clients', libelle: 'Délai de règlement clients', statut: 'non_calculable', valeur: null, unite: 'jours', formule: 'Créances clients / Ventes TTC × nombre de jours', periode: PERIODE, motif: 'Taux moyen de TVA non fourni.', precedent: null, mentions: [] },
  ],
};

export const CORPUS_INDICATEURS: JeuEvaluation<EntreeIndicateurs> = {
  tache: 'commenter_indicateurs',
  version: '1.0.0',
  cas: [
    {
      id: 'IN-01',
      description: 'Commentaire dont tous les chiffres figurent dans les indicateurs cités.',
      entree: BASE,
      simulation: [
        {
          json: {
            commentaire: 'Sur l’exercice 2025, le chiffre d’affaires s’établit à 125 000,00 €, contre 118 000,00 € l’exercice précédent (variation de 5,93 %). Le taux de marge brute est de 32,50 %.',
            indicateursCites: ['chiffre_affaires', 'marge_brute'],
            abstention: false,
            indice: 0.7,
          },
        },
      ],
      attendu: { issue: 'propose', cle: { cites: ['chiffre_affaires', 'marge_brute'] } },
    },
    {
      id: 'IN-02',
      description: 'Le modèle recalcule (moyenne mensuelle, arrondi) : rejet.',
      entree: BASE,
      simulation: [{ json: { commentaire: 'Le chiffre d’affaires progresse d’environ 6 %, soit 10 416,67 € par mois en moyenne.', indicateursCites: ['chiffre_affaires'], abstention: false, indice: 0.9 } }],
      attendu: { issue: 'rejet', cle: { motifs: ['chiffre_absent_des_indicateurs'] } },
    },
    {
      id: 'IN-03',
      description: 'Chiffre exact mais tiré d’un indicateur non cité : rejet.',
      entree: BASE,
      simulation: [{ json: { commentaire: 'Le taux de marge brute est de 32,50 % pour un chiffre d’affaires de 125 000,00 €.', indicateursCites: ['marge_brute'], abstention: false, indice: 0.9 } }],
      attendu: { issue: 'rejet', cle: { motifs: ['chiffre_absent_des_indicateurs'] } },
    },
    {
      id: 'IN-04',
      description: 'Le modèle s’abstient.',
      entree: BASE,
      simulation: [{ json: { commentaire: '', indicateursCites: [], abstention: true, indice: null } }],
      attendu: { issue: 'abstention' },
    },
  ],
};
