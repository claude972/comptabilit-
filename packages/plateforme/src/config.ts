import { z } from 'zod';

const schema = z.object({
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('local'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().default('comtaple-api'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  /** Si vrai, une pièce n'est jamais libérée de quarantaine sans verdict antivirus. */
  ANTIVIRUS_OBLIGATOIRE: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  OCR_URL: z.string().url().default('http://127.0.0.1:8500'),
  /** Passerelle IA : vide = non connecté (aucun appel sortant). */
  IA_OVH_ENDPOINT: z.string().optional().default(''),
  IA_OVH_JETON: z.string().optional().default(''),
  /**
   * Tarifs IA DATÉS pour l'estimation de coût, en JSON : { relevesLe, devise, source, parMillionDeJetons: { <modèle>: { entree, sortie } } }.
   * Vide (défaut) = aucun coût estimé. Le code n'embarque aucun tarif (voir packages/ia/docs/passerelle.md).
   */
  IA_TARIFS: z.string().optional().default(''),
  /**
   * Agrégation bancaire : vide = non connecté. Aucun prestataire n'est choisi à ce jour (voir agregation-bancaire.ts).
   * AGREGATION_SIMULATEUR_URL : tests uniquement, refusé en production.
   */
  AGREGATION_PRESTATAIRE: z.string().optional().default(''),
  AGREGATION_URL: z.string().optional().default(''),
  AGREGATION_JETON: z.string().optional().default(''),
  AGREGATION_SIMULATEUR_URL: z.string().optional().default(''),
  TAILLE_MAX_PIECE: z.coerce.number().int().default(50 * 1024 * 1024),
  TAILLE_MAX_FEC: z.coerce.number().int().default(500 * 1024 * 1024),
  /**
   * Bornes du processus enfant qui décode une pièce (un processus par fichier, voir apps/worker/src/analyse-isolee.ts) :
   * durée, tas JavaScript, mémoire résidente, taille du résultat. Au-delà, l'enfant est arrêté et la pièce le dit.
   */
  ANALYSE_DUREE_MAX_MS: z.coerce.number().int().min(1000).default(60_000),
  ANALYSE_TAS_MAX_MO: z.coerce.number().int().min(64).default(512),
  ANALYSE_MEMOIRE_MAX_MO: z.coerce.number().int().min(128).default(1024),
  ANALYSE_SORTIE_MAX_OCTETS: z.coerce.number().int().min(65_536).default(8 * 1024 * 1024),
  /**
   * Seuil du chemin EN MÉMOIRE : nombre maximal de lignes d'écriture chargées en mémoire par UN traitement du worker
   * (contrôles : exercice + exercice précédent ; rapprochement : exercice). Dimensionné sur les mesures du 2026-11-19
   * (D-061) : environ 1,45 Ko de tas par ligne, deux traitements simultanés, tas plafonné à 2 048 Mo.
   * Au-delà, le traitement passe par le chemin EN FLUX (passages successifs sur la base, mémoire bornée) : même
   * résultat pour les contrôles dont l'égalité est prouvée, « non réalisé » motivé pour ce qui ne tient pas dans le budget.
   */
  LIGNES_MAX_PAR_TRAITEMENT: z.coerce.number().int().min(1000).default(500_000),
  /**
   * Budget d'état d'un traitement EN FLUX : nombre maximal de lignes d'écriture qu'il garde en mémoire au même moment
   * (écritures candidates au doublon, lignes de banque à rapprocher). Dix fois ce nombre pour les éléments compacts (un
   * par écriture distincte). Au-delà, le contrôle concerné n'est PAS réalisé et le dit : jamais de résultat partiel.
   */
  LIGNES_MAX_ETAT_FLUX: z.coerce.number().int().min(1000).default(100_000),
  TAILLE_MORCEAU: z.coerce.number().int().default(4 * 1024 * 1024),
  API_PORT: z.coerce.number().int().default(4000),
  /** Adresse d'écoute de l'API : locale par défaut ; 0.0.0.0 dans un conteneur, derrière un réseau privé. */
  API_HOTE: z.string().default('127.0.0.1'),
  /** Ports des points de collecte Prometheus (adresse locale uniquement) ; 0 = désactivé. */
  METRIQUES_PORT_API: z.coerce.number().int().default(9464),
  METRIQUES_PORT_WORKER: z.coerce.number().int().default(9465),
  METRIQUES_HOTE: z.string().default('127.0.0.1'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Préfixe des clés BullMQ dans Redis : permet à une pile de test de ne pas partager ses files avec la pile normale. */
  FILES_PREFIXE: z.string().regex(/^[a-z0-9-]{1,40}$/).default('bull'),
  NODE_ENV: z.string().optional().default(''),

  // ── Traces OpenTelemetry (traces.ts) ──
  /** Point d'accès OTLP/HTTP du collecteur (ex. http://127.0.0.1:4318). VIDE = aucune trace, aucun appel réseau. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
  /** Part des traces enregistrées, de 0 à 1, décidée à la racine (requête, travail planifié) et suivie par le worker. */
  TRACES_TAUX_ECHANTILLONNAGE: z.coerce.number().min(0).max(1).default(1),
  /** Nom de l'environnement porté par les traces ; vide = NODE_ENV, sinon « local ». */
  TRACES_ENVIRONNEMENT: z.string().regex(/^[a-z0-9-]{0,40}$/).optional().default(''),
  /** Version du service portée par les traces : empreinte de commit des images en production ; vide = version du dépôt. */
  COMTAPLE_VERSION: z.string().regex(/^[A-Za-z0-9._-]{0,64}$/).optional().default(''),

  // ── Collecte par mail (@comtaple/mail) ──
  /** Secret dont sont dérivées la clé de chiffrement des jetons OAuth et la clé de liaison du `state`. */
  JETONS_CLE_CHIFFREMENT: z.string().optional().default(''),
  /** Rotation : anciens secrets (séparés par des virgules), acceptés pour DÉCHIFFRER seulement ; à retirer une fois les jetons rechiffrés. */
  JETONS_CLES_ANCIENNES: z.string().optional().default(''),
  /** Identifiants des clients OAuth : VIDES = connecteur « non connecté », aucune connexion possible. */
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  /** Sujet Pub/Sub (`projects/<projet>/topics/<sujet>`) ; vide = synchronisation périodique seule. */
  GOOGLE_SUJET_PUBSUB: z.string().optional().default(''),
  /** Audience et compte de service du push Pub/Sub authentifié. */
  GOOGLE_PUSH_AUDIENCE: z.string().optional().default(''),
  GOOGLE_PUSH_COMPTE_SERVICE: z.string().optional().default(''),
  MICROSOFT_CLIENT_ID: z.string().optional().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().optional().default(''),
  MICROSOFT_LOCATAIRE: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/).default('common'),
  /** URI de redirection OAuth inscrite chez les fournisseurs ; par défaut la page de retour de l'application web. */
  MAIL_URI_REDIRECTION: z.string().optional().default(''),
  /** URL HTTPS publique de l'API pour les notifications Graph ; vide = synchronisation périodique seule. */
  MAIL_URL_PUBLIQUE_API: z.string().optional().default(''),
  /** Période de la synchronisation de rattrapage, en secondes. */
  MAIL_PERIODE_RATTRAPAGE_S: z.coerce.number().int().min(2).default(900),
  /**
   * TESTS UNIQUEMENT : origine du simulateur `@comtaple/mail/simulateur` qui remplace les URL de Google et de Microsoft.
   * Refusée si NODE_ENV=production. Une connexion établie ainsi ne donne jamais le statut d'intégration « connecte ».
   */
  MAIL_SIMULATEUR_URL: z.string().optional().default(''),

  // ── Notifications poussées discrètes (notifications-poussees.ts) — DÉSACTIVÉES tant que ces variables sont vides ──
  /**
   * Paire de clés VAPID (RFC 8292) et contact de l'éditeur (« mailto:… » ou « https://… »). VIDES (défaut) : statut
   * « non_configure », aucun abonnement accepté, aucun envoi vers un service de notification. Générées par
   * `node scripts/editeur.mjs cles-vapid` ; la clé privée ne va jamais dans le dépôt (voir docs/exploitation.md).
   */
  PUSH_VAPID_CLE_PUBLIQUE: z.string().optional().default(''),
  PUSH_VAPID_CLE_PRIVEE: z.string().optional().default(''),
  PUSH_VAPID_SUJET: z.string().optional().default(''),
  /** TESTS UNIQUEMENT : origine du simulateur de service de notification. Refusée si NODE_ENV=production ; statut « simule ». */
  PUSH_SIMULATEUR_URL: z.string().optional().default(''),
  /** Regroupement : au plus UNE notification poussée par destinataire et par fenêtre de cette durée, en secondes. */
  PUSH_FENETRE_REGROUPEMENT_S: z.coerce.number().int().min(1).max(3600).default(60),
  /** Période du relevé des envois en attente par le worker, en secondes. */
  PUSH_PERIODE_RELEVE_S: z.coerce.number().int().min(1).max(600).default(15),
  /** Délai avant la première reprise d'un envoi en erreur temporaire, en secondes (doublé à chaque reprise, 5 tentatives au plus). */
  PUSH_DELAI_REPRISE_S: z.coerce.number().int().min(1).max(3600).default(30),
});

export type Config = z.infer<typeof schema>;

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    // Les valeurs ne sont jamais affichées : seulement le nom des variables fautives.
    const champs = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide ou incomplète : ${champs}`);
  }
  if (r.data.MAIL_SIMULATEUR_URL !== '') {
    if (r.data.NODE_ENV === 'production') {
      throw new Error('Configuration refusée : MAIL_SIMULATEUR_URL (simulateur de test) est défini alors que NODE_ENV=production.');
    }
    const u = new URL(r.data.MAIL_SIMULATEUR_URL);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
      throw new Error('Configuration refusée : MAIL_SIMULATEUR_URL doit désigner un simulateur local (127.0.0.1).');
    }
  }
  if (r.data.PUSH_SIMULATEUR_URL !== '') {
    if (r.data.NODE_ENV === 'production') {
      throw new Error('Configuration refusée : PUSH_SIMULATEUR_URL (simulateur de test) est défini alors que NODE_ENV=production.');
    }
    let hote = '';
    try {
      hote = new URL(r.data.PUSH_SIMULATEUR_URL).hostname;
    } catch {
      /* refusé ci-dessous */
    }
    if (hote !== '127.0.0.1' && hote !== 'localhost') {
      throw new Error('Configuration refusée : PUSH_SIMULATEUR_URL doit désigner un simulateur local (127.0.0.1).');
    }
  }
  return r.data;
}
