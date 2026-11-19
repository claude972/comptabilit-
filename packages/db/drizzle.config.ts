import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  migrations: { table: 'migrations_drizzle', schema: 'public' },
});
