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

export async function lireJson(reponse: Response): Promise<Record<string, unknown>> {
  try {
    const corps: unknown = await reponse.json();
    if (typeof corps === 'object' && corps !== null && !Array.isArray(corps)) return corps as Record<string, unknown>;
  } catch {
    // traité ci-dessous
  }
  throw new ErreurProtocole(`Réponse non JSON du fournisseur (statut ${reponse.status}).`);
}

export function exigerSucces(reponse: Response, operation: string): void {
  if (!reponse.ok) throw new ErreurProtocole(`Échec de l’opération « ${operation} » (statut ${reponse.status}).`);
}

export const chaine = (valeur: unknown): string | null => (typeof valeur === 'string' ? valeur : null);

export function tableau(valeur: unknown): Record<string, unknown>[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];
}
