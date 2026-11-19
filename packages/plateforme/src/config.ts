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
   * Nombre maximal de lignes d'écriture chargées en mémoire par UN traitement du worker (contrôles : exercice + exercice
   * précédent ; rapprochement : exercice). Au-delà, le traitement n'est PAS réalisé et le dit. Dimensionné sur les
   * mesures du 2026-11-19 (D-061) : environ 1,45 Ko de tas par ligne, deux traitements simultanés, tas plafonné à 2 048 Mo.
   */
  LIGNES_MAX_PAR_TRAITEMENT: z.coerce.number().int().min(1000).default(500_000),
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
  return r.data;
}
