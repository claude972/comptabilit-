/** Corpus SYNTHÉTIQUE — tâche `analyser_lettre_mission`. Lettre fictive, aucune donnée réelle. */
import type { EntreeLettreMission } from '../../taches/lettre-mission.js';
import type { JeuEvaluation } from '../harnais.js';

export const TEXTE_LETTRE_SYNTHETIQUE = [
  'LETTRE DE MISSION',
  '',
  'Article 1 - Objet. Le cabinet assure la tenue de la comptabilité et l’établissement des comptes annuels de la société.',
  'Article 2 - Durée. La mission prend effet le 1er janvier 2025 pour une durée d’un an, renouvelable par tacite reconduction.',
  'Article 3 - Honoraires. Les honoraires annuels sont fixés à 4 800 euros hors taxes, payables par mensualités.',
  'Article 4 - Obligations du client. Le client transmet ses pièces comptables avant le 10 de chaque mois.',
  'Article 5 - Limites. La mission ne comprend ni audit ni mission juridique.',
].join('\n');

const BASE: EntreeLettreMission = { texte: TEXTE_LETTRE_SYNTHETIQUE, nature: 'lettre_mission' };

const PERIMETRE = { rubrique: 'perimetre', contenu: 'Tenue de la comptabilité et établissement des comptes annuels.', extrait: 'Le cabinet assure la tenue de la comptabilité et l’établissement des comptes annuels de la société.' };
const DUREE = { rubrique: 'duree', contenu: 'Effet au 1er janvier 2025, un an, tacite reconduction.', extrait: 'La mission prend effet le 1er janvier 2025 pour une durée d’un an, renouvelable par tacite reconduction.' };
const HONORAIRES = { rubrique: 'honoraires', contenu: 'Forfait annuel de 4 800 euros hors taxes, par mensualités.', extrait: 'Les honoraires annuels sont fixés à 4 800 euros hors taxes, payables par mensualités.' };

export const CORPUS_LETTRE_MISSION: JeuEvaluation<EntreeLettreMission> = {
  tache: 'analyser_lettre_mission',
  version: '1.0.0',
  cas: [
    {
      id: 'LM-01',
      description: 'Trois éléments avec extraits exacts.',
      entree: BASE,
      simulation: [{ json: { elements: [PERIMETRE, DUREE, HONORAIRES], indice: 0.8 } }],
      attendu: { issue: 'propose', cle: { rubriques: ['duree', 'honoraires', 'perimetre'], rejetes: 0 } },
    },
    {
      id: 'LM-02',
      description: 'Un extrait inventé et un montant absent de son extrait : deux éléments rejetés, un gardé.',
      entree: BASE,
      simulation: [
        {
          json: {
            elements: [
              PERIMETRE,
              { rubrique: 'perimetre', contenu: 'Établissement de la paie.', extrait: 'Le cabinet assure également la paie des salariés de la société.' },
              { ...HONORAIRES, contenu: 'Forfait annuel de 6 000 euros hors taxes.' },
            ],
            indice: 0.8,
          },
        },
      ],
      attendu: { issue: 'propose', cle: { rubriques: ['perimetre'], rejetes: 2 } },
    },
    {
      id: 'LM-03',
      description: 'Aucun extrait ne se retrouve dans le texte : rejet.',
      entree: BASE,
      simulation: [{ json: { elements: [{ rubrique: 'mandats', contenu: 'Mandat de télédéclaration.', extrait: 'Le client donne mandat au cabinet pour télédéclarer en son nom.' }], indice: 0.9 } }],
      attendu: { issue: 'rejet', cle: { motifs: ['extrait_introuvable'] } },
    },
    {
      id: 'LM-04',
      description: 'Sortie qui ne respecte pas le schéma (rubrique inconnue) : rejet.',
      entree: BASE,
      simulation: [{ json: { elements: [{ ...PERIMETRE, rubrique: 'tarif_secret' }], indice: 0.5 } }],
      attendu: { issue: 'rejet', cle: { motifs: ['schema_non_respecte'] } },
    },
  ],
};
