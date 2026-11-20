import type { AccesBd } from '@comtaple/db';
import type { Config, Files, ServicesIa, Stockage } from '@comtaple/plateforme';

export interface Contexte {
  bd: AccesBd;
  stockage: Stockage;
  taches: Files;
  cfg: Config;
  /** Passerelle IA (facultative) : absente ou non connectée, aucun vecteur n'est calculé et rien n'est appelé. */
  ia?: ServicesIa;
  /** Isolement de l'analyse des pièces et des relevés bancaires : surcharge des bornes de la configuration (essais). */
  analyse?: import('./analyse-isolee.js').OptionsAnalyse;
  /** Isolement de l'analyse en flux des FEC : surcharge des bornes de la configuration (essais). */
  analyseFec?: import('./analyse-isolee.js').OptionsAnalyse;
}
