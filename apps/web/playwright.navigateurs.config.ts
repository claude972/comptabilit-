/**
 * Mêmes parcours que `playwright.reel.config.ts` (pile RÉELLE, aucun simulateur), rejoués sous Firefox et WebKit.
 * WebKit est le moteur de Safari, pas Safari lui-même ; aucun appareil réel. Les parcours contre le simulateur d'API
 * restent propres à Chromium (ils reposent sur une option de résolution d'hôte que seul Chromium accepte).
 *   pnpm exec playwright test --config playwright.navigateurs.config.ts [--project firefox|webkit]
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/reel',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
