/**
 * Applique les migrations SQL versionnées avec le rôle d'administration.
 * Crée au préalable les rôles techniques (sans BYPASSRLS, non propriétaires) à partir des secrets d'environnement.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { chargerEnvLocal } from './env.js';
import { urlBd } from './index.js';

export async function migrer(): Promise<void> {
  const client = new pg.Client({ connectionString: urlBd('admin') });
  await client.connect();
  try {
    for (const [role, variable] of [
      ['comtaple_app', 'PG_APP_PASSWORD'],
      ['comtaple_worker', 'PG_WORKER_PASSWORD'],
    ] as const) {
      const motDePasse = process.env[variable];
      if (!motDePasse) throw new Error(`${variable} manquant`);
      const existe = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      const verbe = existe.rowCount ? 'ALTER' : 'CREATE';
      const { rows } = await client.query<{ requete: string }>(
        `select format('${verbe} ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', $1::text, $2::text) as requete`,
        [role, motDePasse],
      );
      await client.query(rows[0]!.requete);
    }
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    await migrate(drizzle(client), { migrationsFolder: dossier, migrationsTable: 'migrations_drizzle', migrationsSchema: 'public' });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  chargerEnvLocal();
  migrer().then(
    () => console.log('Migrations appliquées.'),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
