import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };
export { and, asc, desc, eq, inArray, isNull, ne, or, sql, count, gt, lt, gte, lte } from 'drizzle-orm';

export type Bd = NodePgDatabase<typeof schema>;
/** Transaction Drizzle dans laquelle le contexte de sécurité (cabinet, utilisateur) est posé. */
export type Tx = Parameters<Parameters<Bd['transaction']>[0]>[0];

export interface ContexteAcces {
  /** Cabinet issu de l'identité authentifiée (jamais d'un paramètre libre ni d'un modèle d'IA). */
  cabinetId?: string | null;
  utilisateurId?: string | null;
  /** Sujet OIDC du jeton vérifié. */
  sujet?: string | null;
}

export type RoleBd = 'admin' | 'app' | 'worker';

/** Construit l'URL de connexion d'un rôle technique à partir des variables d'environnement. */
export function urlBd(role: RoleBd, env: NodeJS.ProcessEnv = process.env): string {
  const hote = env.PG_HOST ?? '127.0.0.1';
  const port = env.PG_PORT ?? '5432';
  const base = env.PG_DATABASE ?? 'comtaple';
  const [utilisateur, motDePasse] =
    role === 'admin'
      ? [env.PG_ADMIN_USER ?? 'comtaple_admin', env.PG_ADMIN_PASSWORD]
      : role === 'app'
        ? ['comtaple_app', env.PG_APP_PASSWORD]
        : ['comtaple_worker', env.PG_WORKER_PASSWORD];
  if (!motDePasse) throw new Error(`Mot de passe PostgreSQL manquant pour le rôle « ${role} » (voir .env).`);
  return `postgres://${encodeURIComponent(utilisateur)}:${encodeURIComponent(motDePasse)}@${hote}:${port}/${base}`;
}

export interface AccesBd {
  pool: pg.Pool;
  /** Exécute `fn` dans une transaction où les politiques RLS voient ce contexte. Sans contexte, aucune ligne n'est visible. */
  avecContexte<T>(ctx: ContexteAcces, fn: (tx: Tx) => Promise<T>): Promise<T>;
  fermer(): Promise<void>;
}

export function creerAccesBd(url: string, options: { max?: number } = {}): AccesBd {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return {
    pool,
    avecContexte(ctx, fn) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          select set_config('app.cabinet_id', ${ctx.cabinetId ?? ''}, true),
                 set_config('app.utilisateur_id', ${ctx.utilisateurId ?? ''}, true),
                 set_config('app.sujet', ${ctx.sujet ?? ''}, true)`);
        return fn(tx);
      });
    },
    fermer: () => pool.end(),
  };
}

export interface EvenementAudit {
  cabinetId: string;
  acteurId?: string | null;
  acteurType?: 'utilisateur' | 'systeme';
  action: string;
  cibleType?: string | null;
  cibleId?: string | null;
  entiteId?: string | null;
  /** Ne jamais y placer de secret, de jeton, ni de contenu de pièce. */
  details?: Record<string, unknown>;
}

/** Ajoute une ligne au journal d'audit (ajout seul, chaîné par empreinte côté base). */
export async function journaliser(tx: Tx, e: EvenementAudit): Promise<void> {
  await tx.insert(schema.journalAudit).values({
    cabinetId: e.cabinetId,
    acteurId: e.acteurId ?? null,
    acteurType: e.acteurType ?? 'utilisateur',
    action: e.action,
    cibleType: e.cibleType ?? null,
    cibleId: e.cibleId ?? null,
    entiteId: e.entiteId ?? null,
    details: e.details ?? {},
  });
}
