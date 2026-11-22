// Captures de l'écran « États fiscaux » (comparatif N / N-1, tableaux 2054 / 2055 / 2033-C, euros entiers) sur un dossier fictif.
// Usage : node tests/reel/captures-fiscal.mjs <dossierId> <exerciceId> [--qualifier]   (écrit dans var/captures/)
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const [dossier, exercice] = process.argv.slice(2, 4);
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
mkdirSync(sortie, { recursive: true });
const nav = await chromium.launch();
const ctx = await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const base = `http://localhost:3100/dossiers/${dossier}/fiscal?exercice=${exercice}`;
await page.goto(base);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
await page.locator('#password').fill(mdp);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
// Captures ciblées (la page complète fait plus de 20 000 px) : bilan N / N-1, puis tableau 2054, puis 2033-C.
async function cible(nom, url, titre, hauteur = 1000) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const t = typeof titre === 'string' ? page.getByTestId(titre) : page.getByRole('heading', { name: titre }).first();
  await t.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({ path: `${sortie}${nom}.png` });
}
await cible('fiscal-bilan-n-n1-centimes', `${base}&vue=liasse&regime=reel_normal`, /^2050/);
await cible('fiscal-2054-euros', `${base}&vue=liasse&regime=reel_normal&montants=euros`, 'tableaux-immobilisations');
await cible('fiscal-2055-centimes', `${base}&vue=liasse&regime=reel_normal`, 'immobilisations-fichier');
await cible('fiscal-2033c-euros', `${base}&vue=liasse&regime=reel_simplifie&montants=euros`, 'tableaux-immobilisations');
// Détail 2052 / 2053 (D-106) : avant et après la qualification d'un compte par le formulaire (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--qualifier')) {
  const detail = `${base}&vue=liasse&regime=reel_normal`;
  await page.goto(detail);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-resultat').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -20));
  await page.screenshot({ path: `${sortie}fiscal-detail-avant.png` });
  const f = page.getByTestId('qualifier-707100');
  await f.scrollIntoViewIfNeeded();
  await f.getByLabel('France').fill('5000.00');
  await f.getByLabel('Export. et intracom.').fill('0.00');
  await f.getByLabel('Justification (obligatoire)').fill('Ventes au comptoir en France (démonstration fictive)');
  await f.getByRole('button', { name: /Qualifier le compte 707100/ }).click();
  await page.getByText('Qualification enregistrée.').first().waitFor();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-resultat').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-apres.png` });
  await page.getByTestId('qualification-comptes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-qualification.png` });
  await page.getByTestId('renvois-detail').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-renvois.png` });
}
await nav.close();
console.log('captures écrites dans', sortie);
