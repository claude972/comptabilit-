/** Interface commune aux adaptateurs de messagerie (Gmail, Microsoft 365). Lecture seule. */
import { ErreurProtocole } from '../erreurs.js';
import type { Aleatoire, DemandeAutorisation, DemandeEnAttente, ResultatRevocation, TypeBoite } from '../oauth.js';
import type { Http, InitHttp } from '../ports.js';
import type { EtatCurseur, EtatSurveillance, IdFournisseur, JeuDeJetons, MessageBrut, PieceJointeBrute } from '../types.js';

export interface ContexteAppel {
  /** Requête authentifiée, limitée aux hôtes du fournisseur, avec reprise sur quota (fournie par le moteur). */
  requete(url: string, init?: InitHttp): Promise<Response>;
  boite: TypeBoite;
  dateDebut: Date;
}

export interface PageChangements {
  /** Identifiants des messages à examiner (ajouts). Peut contenir des messages déjà traités. */
  idsMessages: string[];
  /** Position de la page suivante, à persister une fois la page entièrement traitée. */
  reprise: string | null;
  /** Nouveau curseur incrémental, renseigné quand le tour est terminé. */
  curseur: string | null;
  termine: boolean;
}

export type JetonsObtenus = Omit<JeuDeJetons, 'etatClient'>;

export interface ParametresSurveillance {
  cles: string[];
  actuelle: EtatSurveillance | null;
  maintenant: Date;
  etatClient: string;
  /** Renouveler même si l'échéance est lointaine (événement de cycle de vie). */
  forcer: boolean;
}

export interface FournisseurMail {
  readonly id: IdFournisseur;
  readonly urlApi: string;
  readonly urlJeton: string;
  /** Seules URL de base vers lesquelles le paquet a le droit d'émettre des requêtes. */
  urlsAutorisees(): string[];

  preparerAutorisation(p: {
    boite: TypeBoite;
    sessionId: string;
    secretEtat: Uint8Array;
    maintenant: Date;
    aleatoire?: Aleatoire;
    indiceConnexion?: string;
  }): DemandeAutorisation;
  echangerCode(http: Http, p: { code: string; attendu: DemandeEnAttente; maintenant: Date }): Promise<{ jetons: JetonsObtenus; adresse: string | null }>;
  rafraichir(http: Http, jetons: JeuDeJetons, maintenant: Date): Promise<JeuDeJetons>;
  revoquer(http: Http, jetons: JeuDeJetons): Promise<ResultatRevocation>;

  /** Appel de lecture minimal : confirme l'accès et renvoie l'adresse de la boîte quand l'API la donne. */
  sonder(ctx: ContexteAppel): Promise<{ adresse: string | null; reponseSimulateur: boolean }>;

  /** Une page de changements pour la portée `cle`. Lève `ErreurCurseurExpire` si le curseur n'est plus valable. */
  pageSuivante(ctx: ContexteAppel, cle: string, etat: EtatCurseur): Promise<PageChangements>;
  /** `null` si le message n'existe plus. */
  lireMessage(ctx: ContexteAppel, idMessage: string): Promise<MessageBrut | null>;
  ouvrirPieceJointe(ctx: ContexteAppel, idMessage: string, piece: PieceJointeBrute): Promise<AsyncIterable<Uint8Array>>;

  assurerSurveillance(ctx: ContexteAppel, p: ParametresSurveillance): Promise<EtatSurveillance>;
  arreterSurveillance(ctx: ContexteAppel, actuelle: EtatSurveillance | null): Promise<void>;
}

/**
 * Taille maximale d'une réponse JSON lue en mémoire. Les plus grosses réponses légitimes sont un message Gmail complet
 * ou le contenu d'une pièce jointe Gmail (base64 dans du JSON) : 25 Mo de message au plus chez Google, soit environ
 * 34 Mo encodés. Au-delà de 64 Mo, la réponse est abandonnée sans être analysée.
 */
export const REPONSE_JSON_MAX_OCTETS = 64 * 1024 * 1024;

/** Lit le corps d'une réponse sans jamais dépasser `tailleMax` octets en mémoire ; `null` si la borne est franchie. */
async function lireCorpsBorne(reponse: Response, tailleMax: number): Promise<Uint8Array | null> {
  const annoncee = Number(reponse.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(annoncee) && annoncee > tailleMax) {
    await reponse.body?.cancel().catch(() => undefined);
    return null;
  }
  if (reponse.body === null) return new Uint8Array(0);
  const lecteur = reponse.body.getReader();
  const blocs: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > tailleMax) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    blocs.push(value);
  }
  return Buffer.concat(blocs);
}

/**
 * Lit une réponse JSON du fournisseur. Taille bornée ; l'analyse est celle du moteur JavaScript (`JSON.parse`), aucune
 * bibliothèque de décodage n'intervient. Une réponse trop volumineuse, non JSON ou trop imbriquée pour être analysée
 * donne la même erreur de protocole, sans détail technique.
 */
export async function lireJson(reponse: Response, tailleMax: number = REPONSE_JSON_MAX_OCTETS): Promise<Record<string, unknown>> {
  let octets: Uint8Array | null = null;
  try {
    octets = await lireCorpsBorne(reponse, tailleMax);
    if (octets !== null) {
      const corps: unknown = JSON.parse(new TextDecoder('utf-8').decode(octets));
      if (typeof corps === 'object' && corps !== null && !Array.isArray(corps)) return corps as Record<string, unknown>;
    }
  } catch {
    // traité ci-dessous
  }
  if (octets === null) throw new ErreurProtocole(`Réponse du fournisseur trop volumineuse (statut ${reponse.status}).`);
  throw new ErreurProtocole(`Réponse non JSON du fournisseur (statut ${reponse.status}).`);
}

export function exigerSucces(reponse: Response, operation: string): void {
  if (!reponse.ok) throw new ErreurProtocole(`Échec de l’opération « ${operation} » (statut ${reponse.status}).`);
}

export const chaine = (valeur: unknown): string | null => (typeof valeur === 'string' ? valeur : null);

export function tableau(valeur: unknown): Record<string, unknown>[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];
}
