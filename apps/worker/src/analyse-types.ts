/**
 * Types et bornes partagés entre le processus du worker (parent) et le processus enfant d'analyse.
 * Ce module ne charge AUCUN lecteur de fichier : le parent peut l'importer sans faire entrer pdf.js ni le lecteur XML
 * dans son propre processus.
 */
import type { ChampsFacture, LigneFec, PageTexte, ProfilCsvBanque, RapportFec, RapportReleve } from '@comtaple/core';

/** Types de pièce dont le décodage a lieu dans l'enfant. Les images ne sont décodées que par le service OCR. */
export type TypePieceDecodee = 'application/pdf' | 'application/xml';

export type MethodeLecture = 'structure' | 'couche_texte' | 'aucune';

/** Résultat structuré du décodage d'une pièce, tel que l'enfant le renvoie (puis validé par schéma côté parent). */
export interface ResultatPiece {
  pages: PageTexte[];
  nbPages: number | null;
  champs: ChampsFacture | null;
  methode: MethodeLecture;
  moteur: string | null;
  /** Le lecteur a refusé le fichier (endommagé, hostile, format inattendu) ; l'état partiel déjà lu est conservé. */
  lectureImpossible: boolean;
}

export interface ResultatTexte {
  champs: ChampsFacture | null;
}

/** En-tête de la demande transmise à l'enfant (les octets du fichier suivent, sans être interprétés par le parent). */
export type DemandeAnalyse =
  | { op: 'piece'; type: TypePieceDecodee }
  | { op: 'texte' }
  | { op: 'releve'; profilCsv: ProfilCsvBanque | null; profilInvalide: boolean }
  | { op: 'fec'; exerciceDebut: string; exerciceFin: string; nomFichier: string | null };

/** Taille maximale de l'en-tête d'une demande (un profil de colonnes CSV tient très largement dedans). */
export const ENTETE_MAX_OCTETS = 65_536;

/**
 * PROTOCOLE D'ENTRÉE À CRÉDIT (D-171). Pour ne jamais écrire dans l'entrée d'un conteneur qui ne lit plus (déclencheur du blocage amont de dockerd à l'arrêt forcé, D-098 bis, D-109), le
 * parent n'a jamais plus de `FENETRE_CREDIT_OCTETS` octets de corps « en vol » : l'enfant annonce, sur sa SORTIE D'ERREUR (canal distinct des résultats), le nombre d'octets de corps qu'il a
 * effectivement consommés (`\u0001CREDIT <n>\n`), et le parent n'écrit la suite que dans la fenêtre ainsi libérée. La fenêtre initiale est `FENETRE_CREDIT_OCTETS`. Un enfant d'essai qui ne
 * parle pas ce protocole est servi à l'ancienne (voir `executerEnfant`). Les lignes de crédit sont retirées du texte d'erreur du parent (jamais relayées).
 */
export const FENETRE_CREDIT_OCTETS = 256 * 1024;
export const MARQUEUR_CREDIT = '\u0001CREDIT ';

/**
 * Résultat de la lecture d'un relevé bancaire (camt.053, OFX, CSV, document d'agrégation) par l'enfant. Les refus qui
 * tiennent au FORMAT (non reconnu, colonnes CSV à confirmer) sont des résultats, pas des échecs de l'enfant.
 */
export type ResultatReleve =
  | { etat: 'lu'; encodage: string; rapport: RapportReleve; profil: ProfilCsvBanque | null; origineProfil: 'confirme' | 'propose_automatiquement' | null; raisons: string[] }
  | { etat: 'format_inconnu'; format: string }
  | { etat: 'profil_invalide'; format: string }
  | { etat: 'profil_a_confirmer'; format: string; raisons: string[] };

/**
 * Nombre maximal de mouvements acceptés dans un relevé lu par l'enfant. Mesure (docs/architecture.md) : un mouvement
 * pèse 0,38 à 0,42 Ko dans le résultat JSON sur les jeux synthétiques (libellés courts), et jusqu'à 1 Ko environ avec
 * des libellés et références à leur longueur maximale ; 200 000 mouvements tiennent donc dans la borne de sortie par
 * défaut des relevés (192 Mo), soit plusieurs années d'un compte très actif. Au-delà, le relevé est à scinder.
 */
export const MOUVEMENTS_MAX_RELEVE = 200_000;

/**
 * FEC : l'enfant renvoie les lignes normalisées par LOTS, chacun dans une trame (4 octets de longueur puis JSON), et
 * termine par le rapport. Un lot est émis dès qu'il atteint ce nombre de lignes ou cette taille approximative.
 */
export const LIGNES_PAR_LOT_FEC = 500;
export const OCTETS_PAR_LOT_FEC = 1024 * 1024;
export type TrameFec = { t: 'lignes'; lignes: LigneFec[] } | { t: 'rapport'; rapport: RapportFec };

/** Nombre minimal de caractères utiles pour considérer qu'une couche texte PDF existe réellement. */
export const SEUIL_COUCHE_TEXTE = 40;
/** Nombre maximal de pages lues dans un PDF (les suivantes sont ignorées ; le nombre total de pages reste connu). */
export const PAGES_MAX = 60;
/** Nombre maximal de pages acceptées en sortie de l'OCR pour l'extraction des champs. */
export const PAGES_MAX_TEXTE = 500;
/** Nombre maximal de lignes par page acceptées dans un résultat. */
export const LIGNES_MAX_PAR_PAGE = 20_000;

export const caracteresUtiles = (pages: PageTexte[]): number => pages.reduce((n, p) => n + p.texte.replace(/\s/g, '').length, 0);
