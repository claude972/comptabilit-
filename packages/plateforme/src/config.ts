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
  TAILLE_MAX_PIECE: z.coerce.number().int().default(50 * 1024 * 1024),
  TAILLE_MAX_FEC: z.coerce.number().int().default(500 * 1024 * 1024),
  TAILLE_MORCEAU: z.coerce.number().int().default(4 * 1024 * 1024),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
});

export type Config = z.infer<typeof schema>;

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    // Les valeurs ne sont jamais affichées : seulement le nom des variables fautives.
    const champs = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide ou incomplète : ${champs}`);
  }
  return r.data;
}
