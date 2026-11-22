/**
 * Renvois des tableaux 2050 (bilan-actif) et 2051 (bilan-passif) du régime réel normal, servis par le moteur générique de formulaires par cases (D-135).
 * Source : `2050-liasse_5320.pdf` (SHA-256 0bba3352…f8453e1), pages 1 et 2 ; les codes ont été lus par extraction positionnée puis vérifiés sur le rendu
 * image (2026-11-22). Ces montants (« dont… », parts à plus ou moins d'un an, écarts de réévaluation) ne se déduisent pas de la balance : chacun est une
 * saisie justifiée du cabinet ; aucun calcul n'est énoncé par le formulaire pour ces cases.
 */
import type { DefinitionFormulaire } from './formulaire-cases.js';

const c = (code: string, libelle: string, groupe: string, precision?: string) => ({ code, libelle, groupe, ...(precision ? { precision } : {}) });

export const FORMULAIRE_RENVOIS_BILAN: DefinitionFormulaire = {
  id: '2050-2051-RENVOIS',
  titre: '2050 et 2051 — Renvois du bilan (parts à moins ou plus d’un an, « dont », écarts de réévaluation)',
  prefixe: 'R51',
  source: '2050-liasse_5320.pdf, pages 1 et 2 (2050-SD et 2051-SD, millésime 2026).',
  groupes: [
    { id: 'ACTIF', titre: '2050 — Bilan-actif : renvois' },
    { id: 'CAPITAUX', titre: '2051 — Capitaux propres : renvois' },
    { id: 'DETTES', titre: '2051 — Dettes : renvois' },
  ],
  cases: [
    c('CP', 'Renvoi (2) du bilan-actif : part à moins d’un an des immobilisations financières nettes', 'ACTIF'),
    c('CR', 'Renvoi (3) du bilan-actif : part à plus d’un an (clients et comptes rattachés, autres créances, charges constatées d’avance)', 'ACTIF'),
    c('1B', 'Renvoi (1) du bilan-passif : écart de réévaluation incorporé au capital', 'CAPITAUX'),
    c('1C', 'Renvoi (1) du bilan-passif : réserve spéciale de réévaluation (1959)', 'CAPITAUX'),
    c('1D', 'Renvoi (2) du bilan-passif : dont écart de réévaluation libre', 'CAPITAUX'),
    c('1E', 'Renvoi (2) du bilan-passif : dont réserve de réévaluation (1976)', 'CAPITAUX'),
    c('EK', 'Écarts de réévaluation : dont écart d’équivalence', 'CAPITAUX'),
    c('B1', 'Réserves réglementées : dont réserve spéciale des provisions pour fluctuation des cours', 'CAPITAUX'),
    c('EJ', 'Autres réserves : dont réserve relative à l’achat d’œuvres originales d’artistes vivants', 'CAPITAUX'),
    c('EF', 'Renvoi (3) du bilan-passif : dont réserve spéciale des plus-values à long terme', 'CAPITAUX'),
    c('EI', 'Emprunts et dettes financières divers : dont emprunts participatifs', 'DETTES'),
    c('EG', 'Renvoi (4) du bilan-passif : dettes et produits constatés d’avance à moins d’un an', 'DETTES'),
    c('EH', 'Renvoi (5) du bilan-passif : dont concours bancaires courants et soldes créditeurs de banques et CCP', 'DETTES'),
  ],
  calculs: [],
  controles: [],
  nonPrepare: [
    'Cases sans code imprimé : « dont actions propres » des valeurs mobilières de placement, « clause de réserve de propriété » (immobilisations, stocks, créances) du bilan-actif et « dont versé » du capital : non préparées (le formulaire n’en porte pas de code lisible).',
    'Aucun rapprochement avec les postes du bilan (2050, 2051) n’est supposé : la relation entre ces « dont » et les postes n’est pas énoncée comme un calcul par le formulaire.',
    'Aucune de ces valeurs n’est déduite de la balance : chacune est une saisie justifiée du cabinet.',
  ],
  limites: [
    'Chaque case est saisie avec une justification obligatoire, tracée et historisée ; « néant » (0,00) est une déclaration explicite, distincte d’une case non renseignée.',
    'Statut « projet » : aucune transmission, aucune validation professionnelle.',
  ],
};

/**
 * Renvois du bilan simplifié 2033-A-SD (régime simplifié, D-135) : `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), page 1 ; codes lus par extraction positionnée puis
 * vérifiés sur le rendu image (2026-11-22). Mêmes principes que le tableau ci-dessus : saisies justifiées du cabinet, aucun calcul ni rapprochement supposé.
 */
export const FORMULAIRE_RENVOIS_2033A: DefinitionFormulaire = {
  id: '2033-A-RENVOIS',
  titre: '2033-A — Renvois du bilan simplifié',
  prefixe: 'R33',
  source: '2033-sd_5394.pdf, page 1 (2033-A-SD, millésime 2026).',
  groupes: [
    { id: 'PASSIF', titre: 'Passif : « dont »' },
    { id: 'RENVOIS', titre: 'Renvois du bas du bilan' },
  ],
  cases: [
    c('131', 'Autres réserves : dont réserve relative à l’achat d’œuvres originales d’artistes vivants', 'PASSIF'),
    c('169', 'Dettes fiscales et sociales : dont montant de la TVA', 'PASSIF'),
    c('193', 'Renvoi (1) : dont immobilisations financières à moins d’un an', 'RENVOIS'),
    c('197', 'Renvoi (2) : dont créances à plus d’un an', 'RENVOIS'),
    c('199', 'Renvoi (3) : dont compte courant d’associés débiteurs', 'RENVOIS'),
    c('195', 'Renvoi (4) : dont dettes à plus d’un an', 'RENVOIS'),
    c('182', 'Renvoi (5) : coût de revient des immobilisations acquises ou créées au cours de l’exercice', 'RENVOIS'),
    c('184', 'Renvoi (5) : prix de vente hors TVA des immobilisations cédées au cours de l’exercice', 'RENVOIS'),
  ],
  calculs: [],
  controles: [],
  nonPrepare: [
    'Aucun rapprochement avec les postes du bilan simplifié n’est supposé : la relation entre ces « dont » et les postes n’est pas énoncée comme un calcul par le formulaire.',
    'Aucune de ces valeurs n’est déduite de la balance : chacune est une saisie justifiée du cabinet ; le prix de vente et le coût de revient des immobilisations (renvoi 5) ne reprennent pas le cadre III du 2033-C, aucun report automatique.',
  ],
  limites: [
    'Chaque case est saisie avec une justification obligatoire, tracée et historisée ; « néant » (0,00) est une déclaration explicite, distincte d’une case non renseignée.',
    'Statut « projet » : aucune transmission, aucune validation professionnelle.',
  ],
};
