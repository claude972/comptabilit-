import type { AccesBd } from '@comtaple/db';
import type { Config, Files, Stockage } from '@comtaple/plateforme';

export interface Contexte {
  bd: AccesBd;
  stockage: Stockage;
  taches: Files;
  cfg: Config;
}
