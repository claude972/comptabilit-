/**
 * Types de domaine du paquet @comtaple/mail.
 * Aucun de ces types ne dépend d'une base de données, de Redis ou d'un stockage.
 */
import type { ConfigurationConnexion } from './configuration.js';

export type IdFournisseur = 'gmail' | 'microsoft';

/**
 * Statut d'une connexion.
 * - `active` : synchronisable ;
 * - `expire` : le fournisseur refuse durablement le jeton d'accès (401 persistant après un renouvellement) ;
 * - `revoque` : le jeton de rafraîchissement est refusé (`invalid_grant`) ;
 * - `supprimee` : jetons effacés à la demande de l'utilisateur.
 * Une connexion non `active` n'est JAMAIS réessayée automatiquement.
 */
export type StatutConnexion = 'active' | 'expire' | 'revoque' | 'supprimee';

/** Secrets d'une connexion. Toujours chiffrés au repos (voir `chiffrement.ts`). */
export interface JeuDeJetons {
  jetonAcces: string;
  /** Date ISO d'expiration du jeton d'accès. */
  expireLe: string;
  jetonRafraichissement: string | null;
  /** Scopes réellement accordés (forme normalisée, voir `oauth.ts`). */
  scopes: string[];
  /** Secret `clientState` des abonnements Microsoft Graph (jamais journalisé). */
  etatClient: string;
}

/** Curseur d'une portée (libellé Gmail ou dossier Microsoft). Opaque pour l'appelant. */
export interface EtatCurseur {
  /** Jeton incrémental validé (historyId Gmail, deltaLink Graph). `null` = synchronisation complète bornée à faire. */
  curseur: string | null;
  /** Position de la page en cours, pour reprendre après une interruption. */
  reprise: string | null;
}

export type EtatSurveillance =
  | { mode: 'gmail_watch'; echeance: string; renouveleeLe: string }
  | { mode: 'graph_abonnements'; abonnements: { id: string; cle: string; echeance: string }[] }
  /** Aucune notification possible : seule la synchronisation périodique rattrape les messages. */
  | { mode: 'periodique'; raison: string };

/** État persistant d'une connexion, lu et écrit via le port `MagasinConnexions`. */
export interface EtatConnexion {
  id: string;
  fournisseur: IdFournisseur;
  statut: StatutConnexion;
  motifStatut: string | null;
  /** Adresse de la boîte autorisée (strict nécessaire à l'affichage et au routage des notifications). */
  adresse: string | null;
  configuration: ConfigurationConnexion;
  /** Scopes accordés, copie non secrète pour `decrirePerimetre`. */
  scopesAccordes: string[];
  /** Enveloppe chiffrée des jetons, ou `null` après suppression. */
  jetonsChiffres: string | null;
  curseurs: Record<string, EtatCurseur>;
  surveillance: EtatSurveillance | null;
  /** Date ISO de la connexion (sert au calcul de la date de début par défaut). */
  connecteeLe: string;
  derniereSynchronisation: string | null;
}

/** Pièce jointe telle que décrite par le fournisseur, avant toute décision. */
export interface PieceJointeBrute {
  /** Identifiant STABLE de la pièce dans le message (clé d'idempotence). */
  id: string;
  /** Référence de téléchargement (peut varier d'un appel à l'autre chez Gmail). */
  reference: string;
  nom: string;
  typeMime: string;
  taille: number;
  /** Déclarée « en ligne » par le fournisseur (Content-Disposition inline / isInline). */
  enLigne: boolean;
  contentId: string | null;
}

/** Message normalisé, interne au paquet. N'est jamais renvoyé tel quel à l'appelant. */
export interface MessageBrut {
  id: string;
  dateReception: Date;
  /** Adresse de l'expéditeur (en-tête From) — contenu NON FIABLE, falsifiable. */
  expediteur: string;
  destinataires: string[];
  objet: string;
  corpsTexte: string | null;
  corpsHtml: string | null;
  piecesJointes: PieceJointeBrute[];
}

/** Extrait borné transmis pour la qualification. Tous les champs texte sont NON FIABLES. */
export interface ExtraitQualification {
  nonFiable: true;
  expediteur: string;
  destinataires: string[];
  objet: string;
  dateReception: string;
  extrait: string;
}

export type Rattachement =
  | { statut: 'rattache'; dossierComptable: string; regles: string[] }
  | { statut: 'a_qualifier'; raisons: string[]; candidats: string[] };

export interface Provenance {
  connexionId: string;
  fournisseur: IdFournisseur;
  idMessage: string;
  idPieceJointe: string;
  dateReception: string;
  expediteur: string;
  nomFichier: string;
  taille: number;
  empreinteSha256: string;
}

/** Provenance remise à `deposer` : l'empreinte n'est connue qu'une fois le flux entièrement consommé. */
export interface ProvenanceDepot extends Omit<Provenance, 'empreinteSha256'> {
  /** Résolue quand le flux a été lu jusqu'au bout. NE PAS l'attendre avant d'avoir consommé le flux. */
  empreinteSha256: Promise<string>;
}

export type Signalement =
  | { type: 'facture_derriere_lien'; connexionId: string; idMessage: string; domaines: string[] }
  | {
      type: 'piece_ignoree';
      connexionId: string;
      idMessage: string;
      idPieceJointe: string;
      nomFichier: string;
      motif: 'archive' | 'executable' | 'trop_volumineuse';
    };

export type IssueSynchronisation =
  /** Tous les curseurs sont à jour. */
  | 'terminee'
  /** Erreur passagère (quota, 5xx) : état intact, à relancer plus tard. */
  | 'interrompue'
  /** Connexion expirée ou révoquée : arrêt, aucun nouvel essai. */
  | 'arretee'
  /** Connexion non active : rien n'a été tenté. */
  | 'ignoree'
  /** La configuration exige un scope non accordé : nouveau consentement explicite nécessaire. */
  | 'consentement_requis';

export interface ResultatSynchronisation {
  issue: IssueSynchronisation;
  statut: StatutConnexion;
  pieces: Provenance[];
  signalements: Signalement[];
  scopesManquants: string[];
  /** Délai conseillé avant reprise quand `issue = interrompue`. */
  reprendreApresMs: number | null;
  compteurs: {
    messagesExamines: number;
    messagesHorsPeriode: number;
    messagesFiltres: number;
    piecesDeposees: number;
    piecesDejaVues: number;
    piecesIgnorees: number;
    resynchronisationsCompletes: number;
  };
}
