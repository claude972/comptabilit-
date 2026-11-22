// Capture de l'aperçu d'un classeur XLSX dans l'écran de reprise (D-124). N'ÉCRIT RIEN : l'aperçu seul est demandé.
// Usage : node tests/reel/capture-xlsx.mjs <dossierId> <chemin.xlsx>   (écrit var/captures/reprise-xlsx-apercu.png)
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const [dossier, fichier] = process.argv.slice(2, 4);
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
mkdirSync(sortie, { recursive: true });
const nav = await chromium.launch();
const page = await (await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1000 } })).newPage();
await page.goto(`http://localhost:3100/dossiers/${dossier}/inventaire/reprise`);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
await page.locator('#password').fill(mdp);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
await page.goto(`http://localhost:3100/dossiers/${dossier}/inventaire/reprise`);
await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier);
await page.getByTestId('apercu-reprise').waitFor();
await page.getByTestId('apercu-reprise').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${sortie}reprise-xlsx-apercu.png` });
await nav.close();
console.log('capture écrite dans', sortie);
