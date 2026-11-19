/**
 * Téléversement reprenable : `POST v1/televersements` → `PUT …/morceaux?decalage=N` → `POST …/terminer`.
 * Logique pure (le transport est injecté) : la progression rapportée est toujours celle que le serveur a confirmée,
 * et le dépôt n'est « reçu » qu'après la réponse `recu: true` de `terminer`.
 */
import type { NatureDocument, StatutDonnees, VueTeleversement, VueTerminee } from '../types-api';
import { prochainMorceau } from './morceaux';

export interface Ouverture {
  entiteId: string;
  nomFichier: string;
  taille: number;
  sha256: string;
  typeMime?: string;
  canal: 'telephone' | 'ordinateur';
  usage?: 'piece' | 'fec' | 'banque';
  nature?: NatureDocument;
  commentaire?: string;
  exerciceId?: string;
  statutDonnees?: StatutDonnees;
}

/** Erreur HTTP renvoyée par l'API (le corps JSON est conservé : il porte `octetsRecus` en cas de 409). */
export class ErreurHttp extends Error {
  constructor(
    readonly statut: number,
    readonly corps: unknown,
  ) {
    const m = (corps as { message?: unknown } | null)?.message;
    super(typeof m === 'string' ? m : `Erreur ${statut}`);
  }
}
/** La requête n'a pas abouti (coupure, hors connexion, délai) : rien ne dit ce que le serveur a reçu. */
export class ErreurReseau extends Error {}

export interface Transport {
  ouvrir(o: Ouverture, signal?: AbortSignal): Promise<VueTeleversement>;
  etat(id: string, signal?: AbortSignal): Promise<VueTeleversement>;
  envoyerMorceau(id: string, decalage: number, donnees: Blob, signal?: AbortSignal): Promise<VueTeleversement>;
  terminer(id: string, signal?: AbortSignal): Promise<VueTerminee>;
}

export type IssueEnvoi =
  | { issue: 'recu'; vue: VueTerminee }
  /** Coupure réseau : reprendre plus tard au décalage confirmé. */
  | { issue: 'coupure'; televersementId: string | null; octetsConfirmes: number }
  /** La session a expiré : se reconnecter puis reprendre. */
  | { issue: 'session_expiree'; televersementId: string | null; octetsConfirmes: number }
  /** Refus définitif (empreinte différente, fichier trop volumineux, droits) : le dépôt est à recommencer ou à abandonner. */
  | { issue: 'refuse'; statut: number; message: string }
  /** Erreur du serveur ou désaccords répétés : l'envoi est interrompu, la reprise reste possible. */
  | { issue: 'interrompu'; televersementId: string | null; octetsConfirmes: number; message: string }
  /** Abonnement du cabinet fermé (403 `abonnement_inactif`) : rien n'est envoyé, le dépôt est conservé pour plus tard. */
  | { issue: 'service_ferme'; situation: string; televersementId: string | null; octetsConfirmes: number }
  | { issue: 'annule'; televersementId: string | null; octetsConfirmes: number };

export interface ParametresEnvoi {
  fichier: Blob;
  ouverture: Ouverture;
  transport: Transport;
  /** Identifiant d'un téléversement déjà ouvert (reprise). */
  televersementId?: string | null;
  /** Appelé à chaque confirmation du serveur (jamais sur une simple émission locale). */
  surProgression?: (p: { televersementId: string; octetsConfirmes: number; taille: number }) => void;
  signal?: AbortSignal;
}

const MAX_DESACCORDS = 5;

function octetsDuConflit(e: ErreurHttp): number | null {
  const n = (e.corps as { octetsRecus?: unknown } | null)?.octetsRecus;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export async function televerser(p: ParametresEnvoi): Promise<IssueEnvoi> {
  const { fichier, ouverture, transport, signal } = p;
  const taille = fichier.size;
  let id: string | null = p.televersementId ?? null;
  let confirmes = 0;
  let desaccords = 0;
  let reouvertures = 0;

  const signaler = (v: VueTeleversement) => {
    id = v.id;
    confirmes = v.octetsRecus;
    p.surProgression?.({ televersementId: v.id, octetsConfirmes: v.octetsRecus, taille });
  };

  try {
    // 1) Reprise : on redemande l'état au serveur ; un téléversement inconnu, expiré ou clos est rouvert.
    let vue: VueTeleversement | null = null;
    if (id) {
      try {
        vue = await transport.etat(id, signal);
      } catch (e) {
        if (!(e instanceof ErreurHttp) || ![400, 403, 404, 410].includes(e.statut)) throw e;
      }
      if (vue && vue.statut !== 'ouvert' && vue.statut !== 'complet') vue = null;
      if (vue && vue.tailleAttendue !== taille) vue = null;
    }
    // 2) Ouverture : l'API renvoie le téléversement existant (même empreinte, même déposant) avec `octetsRecus`.
    vue ??= await transport.ouvrir({ ...ouverture, taille }, signal);
    signaler(vue);

    for (;;) {
      if (signal?.aborted) return { issue: 'annule', televersementId: id, octetsConfirmes: confirmes };
      const morceau = vue.statut === 'complet' ? null : prochainMorceau(taille, vue.tailleMorceau, Math.min(vue.octetsRecus, taille));
      if (morceau) {
        try {
          vue = await transport.envoyerMorceau(vue.id, morceau.decalage, fichier.slice(morceau.decalage, morceau.fin), signal);
          signaler(vue);
        } catch (e) {
          if (!(e instanceof ErreurHttp) || e.statut !== 409) throw e;
          if (++desaccords > MAX_DESACCORDS) {
            return { issue: 'interrompu', televersementId: id, octetsConfirmes: confirmes, message: 'Désaccords répétés avec le serveur sur la position d’envoi.' };
          }
          const attendu = octetsDuConflit(e);
          if (attendu !== null && attendu <= taille) {
            // Décalage inattendu : le serveur fait foi, on reprend exactement où il en est.
            vue = { ...vue, octetsRecus: attendu };
            signaler(vue);
          } else {
            // Téléversement clos entre-temps : on relit son état (terminé ailleurs, ou à rouvrir).
            vue = await transport.etat(vue.id, signal);
            if (vue.statut !== 'ouvert' && vue.statut !== 'complet') {
              if (++reouvertures > 1) return { issue: 'refuse', statut: 409, message: 'Le téléversement a été clos par le serveur.' };
              vue = await transport.ouvrir({ ...ouverture, taille }, signal);
            }
            signaler(vue);
          }
        }
        continue;
      }
      // 3) Clôture : le serveur vérifie taille et empreinte ; lui seul peut dire « reçu ».
      try {
        const fin = await transport.terminer(vue.id, signal);
        if (fin.recu !== true) return { issue: 'interrompu', televersementId: id, octetsConfirmes: confirmes, message: 'Réception non confirmée par le serveur.' };
        signaler(fin);
        return { issue: 'recu', vue: fin };
      } catch (e) {
        if (!(e instanceof ErreurHttp) || e.statut !== 409) throw e;
        const attendu = octetsDuConflit(e);
        if (attendu === null || attendu >= taille || ++desaccords > MAX_DESACCORDS) {
          return { issue: 'interrompu', televersementId: id, octetsConfirmes: confirmes, message: e.message };
        }
        vue = { ...vue, statut: 'ouvert', octetsRecus: attendu }; // incomplet côté serveur : on renvoie la suite
        signaler(vue);
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { issue: 'annule', televersementId: id, octetsConfirmes: confirmes };
    if (e instanceof ErreurReseau) return { issue: 'coupure', televersementId: id, octetsConfirmes: confirmes };
    if (e instanceof ErreurHttp) {
      if (e.statut === 401) return { issue: 'session_expiree', televersementId: id, octetsConfirmes: confirmes };
      const corps = e.corps as { code?: unknown; situation?: unknown } | null;
      if (e.statut === 403 && corps?.code === 'abonnement_inactif') return { issue: 'service_ferme', situation: typeof corps.situation === 'string' ? corps.situation : '', televersementId: id, octetsConfirmes: confirmes };
      if (e.statut >= 500 || e.statut === 429) return { issue: 'interrompu', televersementId: id, octetsConfirmes: confirmes, message: e.message };
      return { issue: 'refuse', statut: e.statut, message: e.message };
    }
    throw e;
  }
}
