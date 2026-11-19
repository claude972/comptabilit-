/**
 * Intégration de la passerelle IA interne (`@comtaple/ia`) à la plateforme : fabrique à partir de la configuration,
 * journal d'audit écrit dans `evenements_ia`, et règle d'emploi du modèle.
 *
 * - Sans `IA_OVH_ENDPOINT` ou sans `IA_OVH_JETON`, aucun fournisseur n'existe : statut `non_connecte`, aucun appel sortant.
 * - Le SIMULATEUR de test n'est jamais instancié ici et n'est activable par AUCUNE variable de configuration : seul
 *   le code de test peut en passer un à `assemblerIa`.
 * - `active()` ne rend la passerelle reliée au fournisseur que si le statut est `connecte` (ou `simule` dans un test).
 *   Un fournisseur configuré mais non vérifié n'est donc jamais sollicité par une tâche métier.
 */
import { type AccesBd, schema as s } from '@comtaple/db';
import { creerFournisseurOvhDepuisEnv, type EvenementAuditIa, type FournisseurIa, type JournalAuditIa, PasserelleIa, type StatutIa, type TarifsIa } from '@comtaple/ia';
import { z } from 'zod';
import type { Config } from './config.js';

const prix = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/);
const schemaTarifs = z.strictObject({
  relevesLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  devise: z.string().regex(/^[A-Z]{3}$/),
  source: z.string().min(1).max(500),
  parMillionDeJetons: z.record(z.string().min(1).max(200), z.strictObject({ entree: prix, sortie: prix })),
});

/**
 * Tarifs datés pour l'estimation de coût (`IA_TARIFS`, objet JSON). Vide : `null`, aucun coût n'est estimé.
 * Le code n'embarque aucun tarif. Une valeur illisible est refusée au démarrage, sans être affichée.
 */
export function lireTarifsIa(cfg: Pick<Config, 'IA_TARIFS'>): TarifsIa | null {
  const brut = cfg.IA_TARIFS.trim();
  if (brut === '') return null;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    throw new Error('Configuration invalide : IA_TARIFS n’est pas un objet JSON.');
  }
  const r = schemaTarifs.safeParse(lu);
  if (!r.success) throw new Error(`Configuration invalide : IA_TARIFS (${r.error.issues.map((i) => i.path.join('.')).join(', ')}).`);
  return r.data;
}

export type NatureEvenementIa = 'reel' | 'simulateur' | 'sans_ia';

/**
 * Journal d'audit de la passerelle : une ligne de `evenements_ia` par événement, SANS CONTENU (identifiants, tailles,
 * empreinte, durées, codes). La table est en ajout seul. `consigner` est synchrone (port du paquet) : les écritures
 * sont regroupées et faites en arrière-plan ; `vider()` attend qu'elles soient terminées.
 * Une écriture en échec est signalée au journal technique (code seulement) et ne bloque jamais la réponse.
 */
export class JournalIaBd implements JournalAuditIa {
  readonly #bd: AccesBd;
  readonly #natureFournisseur: 'reel' | 'simulateur' | null;
  #tampon: EvenementAuditIa[] = [];
  #minuteur: NodeJS.Timeout | null = null;
  readonly #enCours = new Set<Promise<void>>();

  constructor(bd: AccesBd, natureFournisseur: 'reel' | 'simulateur' | null) {
    this.#bd = bd;
    this.#natureFournisseur = natureFournisseur;
  }

  consigner(evenement: EvenementAuditIa): void {
    this.#tampon.push(evenement);
    if (this.#minuteur === null) {
      this.#minuteur = setTimeout(() => void this.vider(), 100);
      this.#minuteur.unref();
    }
  }

  /** Écrit les événements en attente et attend la fin de toutes les écritures en cours. */
  async vider(): Promise<void> {
    if (this.#minuteur !== null) {
      clearTimeout(this.#minuteur);
      this.#minuteur = null;
    }
    const lot = this.#tampon;
    this.#tampon = [];
    if (lot.length > 0) {
      const ecriture = this.#ecrire(lot).catch((e: unknown) => {
        console.error(`[ia] trace d’audit non enregistrée : ${(e as { code?: string } | null)?.code ?? 'erreur'}`);
      });
      this.#enCours.add(ecriture);
      void ecriture.finally(() => this.#enCours.delete(ecriture));
    }
    await Promise.all([...this.#enCours]);
  }

  /** Ligne de `evenements_ia` correspondant à un événement du paquet. Aucun contenu n'existe dans l'événement lui-même. */
  ligne(e: EvenementAuditIa): typeof s.evenementsIa.$inferInsert {
    const commun = { cabinetId: e.contexte.cabinetId, entiteIdCible: e.contexte.dossierId, utilisateurId: e.contexte.utilisateurId, type: e.type, tache: e.tache };
    if (e.type === 'appel_ia') {
      return {
        ...commun,
        // Sans fournisseur, aucun modèle n'a été appelé : l'événement est compté « sans IA », jamais comme un appel réel.
        nature: e.nature ?? 'sans_ia',
        modele: e.modele,
        resultat: e.nature === null ? 'indisponible' : e.resultat,
        codes: e.codes,
        dureeMs: e.dureeMs,
        jetonsEntree: e.jetons.entree,
        jetonsSortie: e.jetons.sortie,
        coutEstime: e.coutEstime?.montant ?? null,
        devise: e.coutEstime?.devise ?? null,
        empreintePrompt: e.empreintePrompt,
        mesures: { trace: e.id, operation: e.operation, prompt: e.prompt, fournisseur: e.fournisseur, tailles: e.tailles, pseudonymes: e.pseudonymes, tarifsRelevesLe: e.coutEstime?.tarifsRelevesLe ?? null },
      };
    }
    return {
      ...commun,
      nature: e.mode === 'sans_ia' ? 'sans_ia' : (this.#natureFournisseur ?? 'sans_ia'),
      modele: null,
      resultat: e.issue,
      codes: e.code === null ? [] : [e.code],
      mesures: { trace: e.id, fonction: e.fonction, mode: e.mode, tailles: e.tailles },
    };
  }

  async #ecrire(lot: EvenementAuditIa[]): Promise<void> {
    // Une transaction par contexte (cabinet, utilisateur) : la politique d'isolation du cabinet s'applique à l'ajout.
    const groupes = new Map<string, EvenementAuditIa[]>();
    for (const e of lot) {
      const cle = `${e.contexte.cabinetId}\u0001${e.contexte.utilisateurId ?? ''}`;
      groupes.set(cle, [...(groupes.get(cle) ?? []), e]);
    }
    for (const evenements of groupes.values()) {
      const { cabinetId, utilisateurId } = (evenements[0] as EvenementAuditIa).contexte;
      await this.#bd.avecContexte({ cabinetId, utilisateurId }, async (tx) => {
        await tx.insert(s.evenementsIa).values(evenements.map((e) => this.ligne(e)));
      });
    }
  }
}

export interface ServicesIa {
  /** Passerelle construite sur le fournisseur configuré (ou sans fournisseur). Sert au statut et à la vérification de connexion. */
  passerelle: PasserelleIa;
  journal: JournalIaBd;
  tarifs: TarifsIa | null;
  /** `reel`, `simulateur` (tests uniquement) ou `null` sans fournisseur. */
  natureFournisseur: 'reel' | 'simulateur' | null;
  statut(): { statut: StatutIa; raisons: string[] };
  /** Vrai seulement si un modèle peut être sollicité : statut `connecte`, ou `simule` dans un test. */
  modeleUtilisable(): boolean;
  /**
   * Passerelle à donner aux tâches et à l'assistant : celle du fournisseur si `modeleUtilisable()`, sinon une
   * passerelle sans fournisseur (toute tâche rend alors « IA indisponible » et son repli, sans aucun appel sortant).
   */
  active(): PasserelleIa;
}

/** Assemble la passerelle sur un fournisseur donné. Hors des tests, le fournisseur vient toujours de `creerIa`. */
export function assemblerIa(bd: AccesBd, fournisseur: FournisseurIa | null, tarifs: TarifsIa | null = null): ServicesIa {
  const natureFournisseur = fournisseur?.nature ?? null;
  const journal = new JournalIaBd(bd, natureFournisseur);
  const passerelle = new PasserelleIa({ fournisseur, journal, tarifs });
  const sansFournisseur = fournisseur === null ? passerelle : new PasserelleIa({ fournisseur: null, journal, tarifs: null });
  const modeleUtilisable = (): boolean => ['connecte', 'simule'].includes(passerelle.statut().statut);
  return { passerelle, journal, tarifs, natureFournisseur, statut: () => passerelle.statut(), modeleUtilisable, active: () => (modeleUtilisable() ? passerelle : sansFournisseur) };
}

/** Passerelle IA de l'application, à partir de la configuration. Aujourd'hui : aucun jeton, donc `non_connecte`. */
export function creerIa(cfg: Pick<Config, 'IA_OVH_ENDPOINT' | 'IA_OVH_JETON' | 'IA_TARIFS'>, bd: AccesBd): ServicesIa {
  return assemblerIa(bd, creerFournisseurOvhDepuisEnv({ IA_OVH_ENDPOINT: cfg.IA_OVH_ENDPOINT, IA_OVH_JETON: cfg.IA_OVH_JETON }), lireTarifsIa(cfg));
}
