import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de bout en bout.
 *  - Authentification : le VRAI Keycloak de développement (royaume « comtaple », `OIDC_ISSUER`).
 *  - API métier : le SIMULATEUR `tests/faux-api.ts` (l'API réelle n'est pas requise) ; `API_URL` pointe dessus.
 *  - Application : `next build` puis `next start` sur un port dédié. Les URL de redirection OIDC enregistrées étant
 *    `http://localhost:3000/…`, Chromium est lancé avec une règle de résolution qui envoie `localhost:3000` vers ce port :
 *    les tests fonctionnent même si un autre serveur occupe déjà le port 3000 de la machine.
 */
const racine = path.resolve(import.meta.dirname, '../..');
function chargerEnv(): void {
  const fichier = path.join(racine, '.env');
  if (!existsSync(fichier)) return;
  for (const ligne of readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne.trim());
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
}
chargerEnv();

const PORT_WEB = Number(process.env.E2E_PORT_WEB ?? 3200);
const PORT_API = Number(process.env.E2E_PORT_API ?? 4100);
const ORIGINE = 'http://localhost:3000';
process.env.E2E_FAUX_API = `http://127.0.0.1:${PORT_API}`;

const lancement = { args: [`--host-resolver-rules=MAP localhost:3000 127.0.0.1:${PORT_WEB}`] };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  // Le simulateur d'API garde un état en mémoire partagé : les fichiers de test s'exécutent l'un après l'autre.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: ORIGINE, locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure', launchOptions: lancement },
  projects: [
    { name: 'connexions', testMatch: /connexions\.setup\.ts/, use: { ...devices['Desktop Chrome'], launchOptions: lancement } },
    { name: 'mobile', testMatch: /mobile\/.*\.spec\.ts/, dependencies: ['connexions'], use: { ...devices['Pixel 7'], launchOptions: lancement } },
    { name: 'ordinateur', testMatch: /ordinateur\/.*\.spec\.ts/, dependencies: ['connexions'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: lancement } },
  ],
  webServer: [
    {
      command: 'node tests/faux-api.ts',
      url: `http://127.0.0.1:${PORT_API}/v1/sante`,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: { FAUX_API_PORT: String(PORT_API), OIDC_ISSUER: process.env.OIDC_ISSUER ?? '', OIDC_AUDIENCE: process.env.OIDC_AUDIENCE ?? 'comtaple-api', TAILLE_MORCEAU: '32768', FAUX_API_DELAI_MS: '1200' },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${PORT_WEB}`,
      url: `http://127.0.0.1:${PORT_WEB}/connexion`,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      env: {
        API_URL: `http://127.0.0.1:${PORT_API}`,
        WEB_URL: ORIGINE,
        // Jeton d'accès de 300 s renouvelé dès qu'il a plus de 10 s : le renouvellement est exercé pendant toute la campagne.
        SESSION_MARGE_RAFRAICHISSEMENT_S: '290',
      },
    },
  ],
});
