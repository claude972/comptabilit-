/**
 * Types de l'assistant documenté : périmètre imposé, fonctions métier (liste blanche), sources et réponse structurée.
 */
import { z } from 'zod';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const schemaPeriode = z.strictObject({ debut: dateIso, fin: dateIso }).refine((p) => p.debut <= p.fin, 'Période invalide : début après la fin.');
export type Periode = z.infer<typeof schemaPeriode>;

/**
 * Périmètre IMPOSÉ par l'appelant, après ses propres contrôles d'habilitation. Le modèle ne peut ni le choisir
 * ni l'élargir : il peut seulement désigner un dossier PARMI `dossierIds` et une sous-période de `periode`.
 */
export const schemaPerimetreImpose = z.strictObject({
  cabinetId: z.string().min(1),
  utilisateurId: z.string().min(1),
  dossierIds: z.array(z.string().min(1)).min(1).max(20),
  periode: schemaPeriode,
});
export type PerimetreImpose = z.infer<typeof schemaPerimetreImpose>;

export const NATURES_SOURCE = ['piece', 'ecriture', 'constat', 'resultat_moteur', 'source_officielle'] as const;
/** `resultat_moteur` : valeur calculée par le moteur déterministe (balance, indicateur). `source_officielle` : texte officiel référencé. */
export type NatureSource = (typeof NATURES_SOURCE)[number];

/** Élément renvoyé par une fonction métier : c'est la seule chose qu'une réponse peut citer. */
export const schemaElementSource = z.strictObject({
  /** Identifiant stable, attribué par l'application (jamais par le modèle). */
  id: z.string().min(1).max(200),
  nature: z.enum(NATURES_SOURCE),
  libelle: z.string().max(500),
  /** Contenu NON FIABLE (texte de pièce, libellé d'écriture, extrait de page). */
  contenu: z.string().max(100_000),
  /** Dossier d'appartenance ; `null` uniquement pour une source officielle. */
  dossierId: z.string().min(1).nullable(),
  /** Valeurs identifiées (montant, date, solde…), chaînes telles que le moteur les fournit. */
  valeurs: z.record(z.string().max(100), z.string().max(500)).optional(),
  reference: z.strictObject({ titre: z.string().max(500), url: z.string().max(1000).nullable(), dateVersion: z.string().max(40).nullable() }).optional(),
});
export type ElementSource = z.infer<typeof schemaElementSource>;

export interface ResultatFonction {
  elements: ElementSource[];
  /** Ce que la fonction n'a pas pu fournir (ex. « balance N-1 non importée »). */
  donneesManquantes?: string[];
}

/** Contexte transmis à une fonction métier : entièrement résolu par l'orchestrateur à partir du périmètre imposé. */
export interface ContexteFonction {
  cabinetId: string;
  utilisateurId: string;
  /** `null` pour une fonction sans portée de dossier (sources réglementaires). */
  dossierId: string | null;
  periode: Periode;
}

/**
 * Fonction métier déclarée et appelable par le modèle. Le modèle ne fournit QUE les arguments de
 * `schemaArguments` (objet strict), plus éventuellement `dossierId` et `periode`, vérifiés contre le périmètre.
 * `executer` n'est appelée qu'après : liste blanche, validation Zod, contrôle du périmètre, habilitation.
 */
export interface FonctionMetier<A = unknown> {
  /** `[a-zA-Z][a-zA-Z0-9_]{0,63}`. */
  nom: string;
  description: string;
  /** Habilitation exigée de l'utilisateur, vérifiée par le port `Habilitations` avant chaque exécution. */
  habilitation: string;
  /** Vrai si la fonction lit les données d'un dossier. */
  porteeDossier: boolean;
  /** Schéma d'objet (`z.strictObject(...)`) sans les clés réservées (`dossierId`, `periode`, `cabinetId`, `utilisateurId`). Toute clé non déclarée est refusée par l'orchestrateur. */
  schemaArguments: z.ZodType<A>;
  executer(args: A, contexte: ContexteFonction): Promise<ResultatFonction>;
  /** Utilisation par le mode sans IA : déclenchement par mots-clés simples et arguments déterministes. */
  sansIa?: {
    /** Mots (sans accents, minuscules) dont la présence dans la question déclenche la fonction. */
    motsCles: string[];
    /** Vrai : toujours exécutée (recherche par défaut). */
    toujours?: boolean;
    /** Arguments construits à partir de la question ; `null` : ne pas exécuter. */
    arguments(question: string): A | null;
  };
}

/** Port : contrôle d'habilitation de l'application. Appelé AVANT toute exécution de fonction métier. */
export interface Habilitations {
  autoriser(demande: { fonction: string; habilitation: string; cabinetId: string; utilisateurId: string; dossierId: string | null }): Promise<boolean>;
}

export type CodeRefus =
  | 'fonction_non_autorisee'
  | 'arguments_invalides'
  | 'changement_de_contexte_refuse'
  | 'dossier_hors_perimetre'
  | 'dossier_a_preciser'
  | 'periode_hors_perimetre'
  | 'habilitation_refusee'
  | 'habilitations_indisponibles'
  | 'fonction_en_echec'
  | 'reponse_prematuree'
  | 'trop_d_appels';

export interface RefusFonction {
  /** Nom demandé, assaini. */
  fonction: string;
  code: CodeRefus;
  etape: number;
}

export const TYPES_SEGMENT = ['fait', 'calcul', 'hypothese', 'interpretation'] as const;
export type TypeSegment = (typeof TYPES_SEGMENT)[number];

export interface Citation {
  id: string;
  nature: NatureSource;
  libelle: string;
  reference: ElementSource['reference'] | null;
}

export interface Segment {
  type: TypeSegment;
  texte: string;
  citations: Citation[];
  /** Affirmation réglementaire (déclarée par le modèle, repérée par le code, ou citant une source officielle) : toujours appuyée sur une source officielle. */
  reglementaire: boolean;
}

export type MotifEcartSegment =
  | 'citation_inconnue'
  | 'citation_absente'
  | 'calcul_sans_resultat_moteur'
  | 'chiffre_non_source'
  | 'url_non_sourcee'
  | 'reglementaire_sans_source_officielle'
  | 'jeton_non_restaure';

export interface ReponseAssistant {
  statut: 'repondu' | 'abstention';
  motifAbstention: string | null;
  mode: 'ia' | 'sans_ia';
  /** Mention à afficher. En mode sans IA : « Sans IA : résultats de recherche et calculs du moteur, sans rédaction ». */
  etiquette: string;
  segments: Segment[];
  /** Périmètre et période effectivement analysés (ceux imposés par l'appelant). */
  perimetre: { cabinetId: string; dossierIds: string[]; periode: Periode };
  donneesManquantes: string[];
  /** Passages de la réponse du modèle écartés par les garde-fous (le texte écarté n'est pas repris). */
  pointsEcartes: Array<{ index: number; type: TypeSegment; motif: MotifEcartSegment }>;
  /** Points sur lesquels l'assistant s'abstient faute de source officielle. */
  abstentionsPartielles: Array<{ index: number; motif: 'reglementaire_sans_source_officielle' }>;
  /** Appels de fonctions refusés (fonction hors liste, changement de dossier ou de cabinet, habilitation…). */
  refus: RefusFonction[];
  /** Toutes les sources consultées pendant la réponse. */
  sources: Citation[];
  etapes: number;
  confiance: { statut: 'non_evaluee'; mention: string };
  /** Renseigné quand le mode sans IA a été utilisé parce que l'IA était indisponible. */
  iaIndisponible: { code: string } | null;
  prompt: { id: string; version: string } | null;
}
