/**
 * Plafonds des calculs immédiats de l'API (D-093).
 *
 * Un écran qui charge les lignes d'écriture (ou les mouvements, les pièces, les constats) EN MÉMOIRE ne le fait que sous un
 * plafond explicite, réglable par variable d'environnement. Au-delà : REFUS motivé en français (409, avec le volume, le plafond
 * et le nom de la variable), jamais un résultat partiel silencieux, jamais une erreur 500 ni un épuisement de la mémoire.
 *
 * Deuxième borne, globale : le total de lignes tenues en mémoire PAR TOUS LES CALCULS EN COURS (`API_LIGNES_MAX_SIMULTANEES`).
 * Un calcul qui ferait dépasser ce total est refusé tout de suite (503, « réessayez »), sans rien charger.
 */
import { applyDecorators, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { LigneEcriture } from '@comtaple/core';
import type { AccesBd, schema, Tx } from '@comtaple/db';
import { type Config, lignesDuLot } from '@comtaple/plateforme';
import type { Acces } from './acces.js';

type Lot = Pick<typeof schema.lotsImport.$inferSelect, 'id' | 'progression'>;

export type Plafond = 'calcul' | 'impact' | 'portefeuille';

const REGLAGES: Record<Plafond, { variable: 'API_LIGNES_MAX_CALCUL' | 'API_LIGNES_MAX_IMPACT_REGLE' | 'API_LIGNES_MAX_PORTEFEUILLE_DOSSIER' }> = {
  calcul: { variable: 'API_LIGNES_MAX_CALCUL' },
  impact: { variable: 'API_LIGNES_MAX_IMPACT_REGLE' },
  portefeuille: { variable: 'API_LIGNES_MAX_PORTEFEUILLE_DOSSIER' },
};

/** Documente (OpenAPI) les deux refus possibles d'un calcul immédiat : volume au-dessus du plafond (409) et budget simultané (503). */
export const ApiRefusVolume = () =>
  applyDecorators(
    ApiResponse({ status: 409, description: 'Volume au-dessus du plafond de calcul immédiat de l’API (D-093) : corps `{ code: "volume_trop_important", volume, plafond, variable, message }`, message motivé en français, aucun résultat partiel.' }),
    ApiResponse({ status: 503, description: 'D’autres calculs tiennent déjà trop de lignes en mémoire (D-093) : `{ code: "calculs_simultanes_trop_lourds", reessayerDansSecondes }` ; rien n’a été chargé, réessayez.' }),
  );

const nombre = (n: number): string => n.toLocaleString('fr-FR');

export interface DescriptionRefus {
  /** Nom de l'écran ou du calcul refusé (en tête du message). */
  ecran: string;
  /** Ce qui est compté, au pluriel (« lignes d’écriture », « pièces »…). */
  objet: string;
  volume: number;
  plafond: number;
  variable: string;
  /** Ce que la personne peut faire ; défaut : le conseil général. */
  remede?: string;
}

/** Refus explicite d'un volume au-dessus du plafond : 409, corps structuré (le client lit `message`, les outils lisent `code`). */
export function refusVolume(d: DescriptionRefus): ConflictException {
  const remede = d.remede ?? 'Ce calcul n’a pas de version en flux : l’éditeur peut relever le plafond après avoir vérifié la mémoire de l’API, ou le volume peut être scindé.';
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `${d.ecran} refusé : ${nombre(d.volume)} ${d.objet}, au-delà du plafond de ${nombre(d.plafond)} que l’API traite en direct (variable ${d.variable}). Aucun résultat partiel n’est fourni. ${remede}`,
    code: 'volume_trop_important',
    volume: d.volume,
    plafond: d.plafond,
    variable: d.variable,
  });
}

/**
 * Lignes tenues en mémoire en ce moment par les calculs en cours de CE processus. Un compteur de processus, pas une base
 * de données : chaque instance de l'API a sa propre mémoire, donc son propre total.
 */
let lignesEnMemoire = 0;
export const lignesReserveesMaintenant = (): number => lignesEnMemoire;

/** Réservations d'UNE requête ; `liberer` est appelée dans un `finally` par `avecCalcul`. */
export class Budget {
  private reservees = 0;

  /** Réserve `n` lignes ; refuse (503) si le total en mémoire dépasserait `max` alors qu'un autre calcul est déjà en cours. */
  reserver(n: number, max: number, ecran: string): void {
    // Un calcul seul n'est jamais refusé par ce total (son propre plafond le borne déjà) ; seules les réservations des AUTRES requêtes comptent.
    const autres = lignesEnMemoire - this.reservees;
    if (autres > 0 && autres + n > max) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: `${ecran} reporté : d’autres calculs tiennent déjà ${nombre(autres)} lignes en mémoire et celui-ci en demande ${nombre(n)} (total admis : ${nombre(max)}, variable API_LIGNES_MAX_SIMULTANEES). Rien n’a été chargé ni calculé : réessayez dans quelques instants.`,
        code: 'calculs_simultanes_trop_lourds',
        volume: n,
        plafond: max,
        variable: 'API_LIGNES_MAX_SIMULTANEES',
        reessayerDansSecondes: 5,
      });
    }
    lignesEnMemoire += n;
    this.reservees += n;
  }

  liberer(): void {
    lignesEnMemoire = Math.max(0, lignesEnMemoire - this.reservees);
    this.reservees = 0;
  }
}

/** Ouvre la transaction de l'utilisateur avec un budget de mémoire libéré quoi qu'il arrive (succès, refus ou erreur). */
export async function avecCalcul<T>(bd: AccesBd, acces: Acces, fn: (tx: Tx, budget: Budget) => Promise<T>): Promise<T> {
  const budget = new Budget();
  try {
    return await bd.avecContexte(acces, (tx) => fn(tx, budget));
  } finally {
    budget.liberer();
  }
}

export interface LignesChargees {
  lignes: LigneEcriture[];
  /** Lignes de l'exercice précédent, quand elles ont été demandées ET tiennent sous le plafond avec celles de l'exercice. */
  precedent: LigneEcriture[] | null;
  /** Pourquoi l'exercice précédent n'a pas été lu, quand il existait mais ne tenait pas sous le plafond ; sinon null. */
  motifPrecedent: string | null;
}

export interface DemandeLignes {
  ecran: string;
  plafond: Plafond;
  lot: Lot;
  /** Lot de l'exercice précédent, quand le calcul sait s'en servir. */
  lotPrecedent?: Lot | null;
}

/**
 * Charge les lignes d'un lot actif (et, si demandé, celles de l'exercice précédent) SOUS le plafond : volume vérifié AVANT
 * toute lecture, total simultané réservé, puis lecture. L'exercice précédent n'est lu que si les deux tiennent ensemble ;
 * sinon il est écarté AVEC son motif (le calcul le dit : « exercice précédent non fourni »).
 */
export async function chargerLignes(tx: Tx, budget: Budget, cfg: Config, d: DemandeLignes): Promise<LignesChargees> {
  const plafond = cfg[REGLAGES[d.plafond].variable];
  if (d.lot.progression > plafond) {
    throw refusVolume({ ecran: d.ecran, objet: 'lignes d’écriture dans l’exercice', volume: d.lot.progression, plafond, variable: REGLAGES[d.plafond].variable });
  }
  let motifPrecedent: string | null = null;
  let avecPrecedent = false;
  if (d.lotPrecedent) {
    if (d.lot.progression + d.lotPrecedent.progression <= plafond) avecPrecedent = true;
    else {
      motifPrecedent = `L’exercice précédent (${nombre(d.lotPrecedent.progression)} lignes) n’a pas été lu : avec l’exercice demandé (${nombre(d.lot.progression)} lignes), il dépasserait le plafond de ${nombre(plafond)} lignes (variable ${REGLAGES[d.plafond].variable}).`;
    }
  }
  budget.reserver(d.lot.progression + (avecPrecedent ? d.lotPrecedent!.progression : 0), cfg.API_LIGNES_MAX_SIMULTANEES, d.ecran);
  const lignes = await lignesDuLot(tx, d.lot.id);
  const precedent = avecPrecedent ? await lignesDuLot(tx, d.lotPrecedent!.id) : null;
  return { lignes, precedent, motifPrecedent };
}
