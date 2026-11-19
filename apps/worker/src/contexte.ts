import type { AccesBd } from '@comtaple/db';
import type { Config, Files, ServicesIa, Stockage } from '@comtaple/plateforme';

export interface Contexte {
  bd: AccesBd;
  stockage: Stockage;
  taches: Files;
  cfg: Config;
  /** Passerelle IA (facultative) : absente ou non connectée, aucun vecteur n'est calculé et rien n'est appelé. */
  ia?: ServicesIa;
}
