// Preuve d'usage de l'état joint (D-138) : rendu écran, PDF A4 paysage paginé et CSV, sur le dossier fictif. Lecture seule.
// Usage : node tests/reel/capture-etat-joint.mjs <dossierId> <exerciceId> [reel_normal|reel_simplifie]   (écrit dans var/captures/)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const [dossier, exercice, regime = 'reel_normal'] = process.argv.slice(2, 5);
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
mkdirSync(sortie, { recursive: true });
const nav = await chromium.launch();
const page = await (await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } })).newPage();
const url = `http://localhost:3100/dossiers/${dossier}/fiscal/etat-joint?exercice=${exercice}&regime=${regime}`;
await page.goto(url);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
await page.locator('#password').fill(mdp);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
await page.goto(url);
await page.getByTestId('etat-joint').waitFor();
await page.screenshot({ path: `${sortie}etat-joint-${regime}.png` });
await page.pdf({ path: `${sortie}etat-joint-${regime}.pdf`, format: 'A4', landscape: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:right;padding-right:12mm">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: '14mm', bottom: '18mm', left: '12mm', right: '12mm' }, printBackground: false });
const href = await page.getByTestId('export-csv-etat-joint').getAttribute('href');
writeFileSync(`${sortie}etat-joint-${regime}.csv`, decodeURIComponent(href.replace('data:text/csv;charset=utf-8,', '')));
console.log('tableaux :', await page.locator('[data-tableau-joint]').count(), '| identification :', await page.getByTestId('identification-etat-joint').innerText());
await nav.close();
