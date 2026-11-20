/**
 * Base PostgreSQL JETABLE pour les essais : créée neuve (toutes les migrations rejouées, jeu d'essai amorcé), détruite à
 * la fin. Le nom commence toujours par `comtaple_essai_` : c'est lui que `exigerBaseEssai` reconnaît. Ne touche jamais
 * à la base configurée (PG_DATABASE).
 */
import pg from 'pg';
import { amorcer } from './amorcer.js';
import { chargerEnvLocal } from './env.js';
import { urlBd } from './index.js';
import { migrer } from './migrer.js';

export interface BaseJetable {
  nom: string;
  env: NodeJS.ProcessEnv;
  /** Connexion avec le rôle d'administration à la base jetable. */
  admin: pg.Client;
  detruire(): Promise<void>;
}

export async function creerBaseJetable(etiquette: string): Promise<BaseJetable> {
  if (!/^[a-z0-9_]{1,30}$/.test(etiquette)) throw new Error('Étiquette de base jetable invalide');
  chargerEnvLocal();
  const nom = `comtaple_essai_${etiquette}_${Date.now()}`;
  const env = { ...process.env, PG_DATABASE: nom };
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`create database ${nom}`);
  await racine.end();
  await migrer(env);
  await amorcer(env);
  const admin = new pg.Client({ connectionString: urlBd('admin', env) });
  await admin.connect();
  return {
    nom,
    env,
    admin,
    async detruire() {
      await admin.end().catch(() => undefined);
      const r = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
      await r.connect();
      await r.query(`drop database if exists ${nom} with (force)`);
      await r.end();
    },
  };
}
