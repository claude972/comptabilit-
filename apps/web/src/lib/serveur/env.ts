import { z } from 'zod';

const schema = z.object({
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  API_URL: z.url(),
  WEB_URL: z.url().default('http://localhost:3000'),
  /** Marge (secondes) avant l'expiration du jeton d'accès à partir de laquelle il est renouvelé. */
  SESSION_MARGE_RAFRAICHISSEMENT_S: z.coerce.number().int().min(5).max(3600).default(60),
});

export type Env = z.infer<typeof schema>;
let cache: Env | undefined;

/** Configuration serveur, validée à la première utilisation. Les valeurs ne sont jamais affichées : seuls les noms fautifs le sont. */
export function env(): Env {
  if (cache) return cache;
  const r = schema.safeParse(process.env);
  if (!r.success) {
    throw new Error(`Configuration web invalide ou incomplète : ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  cache = { ...r.data, API_URL: r.data.API_URL.replace(/\/+$/, ''), WEB_URL: r.data.WEB_URL.replace(/\/+$/, ''), OIDC_ISSUER: r.data.OIDC_ISSUER.replace(/\/+$/, '') };
  return cache;
}

/** Hôte local de développement : seul cas où le cookie n'est pas marqué `Secure` et où l'émetteur OIDC peut être en HTTP. */
export function estLocal(url: string): boolean {
  const h = new URL(url).hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}
