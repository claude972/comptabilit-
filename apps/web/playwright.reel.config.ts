/**
 * Parcours sur la pile RÉELLE (aucun simulateur) : Keycloak, application web construite (port 3100), API, worker,
 * PostgreSQL, Redis, S3, ClamAV, OCR. Prérequis : `scripts/applis.sh demarrer` après construction de tous les paquets.
 * Navigateur : Chromium, profil mobile émulé puis profil ordinateur. Ce n'est pas un essai sur appareil réel.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/reel',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['./tests/reel/diagnostic-reporter.ts']],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', actionTimeout: 60_000 },
  projects: [{ name: 'reel', use: { ...devices['Desktop Chrome'] } }],
});
