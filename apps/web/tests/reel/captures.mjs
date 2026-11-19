// Captures d'écran de l'application réelle locale (comptes de démonstration fictifs), pour illustration.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
const nav = await chromium.launch();
async function session(profil, email, chemin) {
  const ctx = await nav.newContext({ ...devices[profil] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3100${chemin}`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(mdp);
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.waitForLoadState('networkidle');
  return { ctx, page };
}
let s = await session('Pixel 7', 'client.depot@client-a.test', '/deposer');
await s.page.screenshot({ path: `${sortie}telephone-deposer.png`, fullPage: true });
await s.page.goto('http://localhost:3100/depots'); await s.page.waitForLoadState('networkidle');
await s.page.screenshot({ path: `${sortie}telephone-depots.png`, fullPage: true });
await s.ctx.close();
s = await session('Desktop Chrome', 'remi.reviseur@cabinet-a.test', '/dossiers/aaaaaaaa-0000-4000-8000-0000000000e1/revision');
await s.page.screenshot({ path: `${sortie}cabinet-revision.png`, fullPage: true });
await s.ctx.close();
await nav.close();
console.log('captures écrites');
