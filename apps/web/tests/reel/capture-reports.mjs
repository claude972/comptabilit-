// Preuve d'usage (D-153, D-154) : écrans 2058-A (proposition WN, rapprochements), 2059-A (cadre B par taux), feuillets du 2056 et du 2057 (rapprochement avec le bilan) sur le dossier fictif. Lecture seule.
// Usage : node tests/reel/capture-reports.mjs <dossierId>   (écrit dans var/captures/reports-*.png)
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const [dossier] = process.argv.slice(2);
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
mkdirSync(sortie, { recursive: true });
const nav = await chromium.launch();
const page = await (await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1000 } })).newPage();
const url = `http://localhost:3100/dossiers/${dossier}/fiscal?vue=liasse`;
await page.goto(url);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
await page.locator('#password').fill(mdp);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
await page.goto(url);
await page.waitForLoadState('networkidle');
// Chaque preuve : un texte attendu à l'écran, puis une capture de la zone qui l'entoure (le texte est vérifié, pas seulement photographié).
const preuves = [
  ['2058a-proposition-WN', /Total 2 de la colonne 3 du cadre A du 2059-B/],
  ['2058a-rapprochement-WH', /voir également le tableau 2059-A.*sans énoncer d’égalité/],
  ['2059a-cadre-B-par-taux', /dont par taux : 19 %/],
  ['2056-feuillet-ecart', /Détail — reprises/],
  ['2057-bilan-ecart', /charges constatées d’avance du projet de bilan/],
];
for (const [nom, motif] of preuves) {
  const t = page.getByText(motif).first();
  if ((await t.count()) === 0) { console.log('ÉCHEC introuvable :', nom); process.exitCode = 1; continue; }
  await t.scrollIntoViewIfNeeded();
  const b = await t.boundingBox();
  await page.screenshot({ path: `${sortie}reports-${nom}.png`, fullPage: true, clip: { x: 0, y: Math.max(0, b.y - 220 + (await page.evaluate(() => scrollY))), width: 1280, height: 520 } });
  console.log('OK capture :', nom);
}
await nav.close();
