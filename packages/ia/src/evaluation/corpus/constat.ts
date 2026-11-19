/** Corpus SYNTHÉTIQUE — tâche `expliquer_constat`. Constat fictif. */
import type { EntreeConstat } from '../../taches/constat.js';
import type { JeuEvaluation } from '../harnais.js';

const BASE: EntreeConstat = {
  constat: {
    id: 'CST-014',
    controle: 'Solde anormal d’un compte de banque',
    gravite: 'attention',
    message: 'Le compte 512000 présente un solde créditeur de 1250.00 euros au 2025-06-30.',
    faits: [
      { libelle: 'Compte', valeur: '512000 Banque' },
      { libelle: 'Solde', valeur: '-1250.00' },
      { libelle: 'Date d’arrêté', valeur: '2025-06-30' },
    ],
    regle: 'Un compte de banque est normalement débiteur (règle interne du moteur).',
  },
};

export const CORPUS_CONSTAT: JeuEvaluation<EntreeConstat> = {
  tache: 'expliquer_constat',
  version: '1.0.0',
  cas: [
    {
      id: 'CO-01',
      description: 'Reformulation fidèle, sans fait nouveau.',
      entree: BASE,
      simulation: [{ json: { explication: 'Le compte de banque 512000 affiche un solde créditeur de 1 250,00 euros au 30/06/2025, alors qu’un compte de banque est normalement débiteur. Ce point est à examiner.', abstention: false } }],
      attendu: { issue: 'propose', cle: { constatId: 'CST-014' } },
    },
    {
      id: 'CO-02',
      description: 'Référence de texte ajoutée par le modèle : rejet.',
      entree: BASE,
      simulation: [{ json: { explication: 'Le solde créditeur du compte 512000 est contraire à l’article L. 123-12 du Code de commerce.', abstention: false } }],
      attendu: { issue: 'rejet', cle: { motifs: ['chiffre_absent_du_constat', 'reference_absente_du_constat'] } },
    },
    {
      id: 'CO-03',
      description: 'Chiffre ajouté (découvert autorisé supposé) : rejet.',
      entree: BASE,
      simulation: [{ json: { explication: 'Le compte 512000 est créditeur de 1 250,00 euros, ce qui dépasse le découvert autorisé de 1 000 euros.', abstention: false } }],
      attendu: { issue: 'rejet', cle: { motifs: ['chiffre_absent_du_constat'] } },
    },
    {
      id: 'CO-04',
      description: 'Réponse qui n’est pas du JSON : rejet.',
      entree: BASE,
      simulation: [{ texte: 'Voici mon explication : le compte est créditeur.' }],
      attendu: { issue: 'rejet', cle: { motifs: ['json_invalide'] } },
    },
  ],
};
