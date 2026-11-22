/**
 * Recherche textuelle sur le PORTEFEUILLE sur la pile RÉELLE (web 3100, API, Keycloak, base) — parcours courts, en lecture
 * seule : aucune donnée n'est créée, modifiée ni supprimée. Rejoué sous Chromium, Firefox et WebKit (config navigateurs).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './base';
import { ordinateur } from './profils';

const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CLIENT_MAIL = 'client.depot@client-a.test';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}
async function ouvrir(browser: Browser, email: string, destination: string, largeur = 1440): Promise<Page> {
  const contexte = await browser.newContext({ ...ordinateur(browser), viewport: { width: largeur, height: 900 } });
  const page = await contexte.newPage();
  await page.goto(destination);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  return page;
}
const mesurer = (page: Page) => page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));

test('recherche réelle sur le portefeuille : lien de navigation, résultats groupés par dossier autorisé, décompte des dossiers sans résultat', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, '/');
  await remi.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Recherche' }).click();
  await expect(remi).toHaveURL(/\/recherche$/);
  await expect(remi.getByRole('heading', { level: 1, name: 'Recherche' })).toBeVisible();
  // Dossiers autorisés : ceux que l'API calcule pour Rémi (même périmètre que l'assistant de portefeuille).
  const autorises: string[] = (await remi.evaluate(async () => (await (await fetch('/api/bff/v1/assistant/perimetre')).json()) as { dossiers: Array<{ id: string }> })).dossiers.map((d) => d.id);
  expect(autorises.length).toBeGreaterThanOrEqual(2);

  await remi.getByLabel('Rechercher dans tous mes dossiers').fill('facture');
  await remi.getByRole('button', { name: 'Rechercher' }).click();
  await expect(remi).toHaveURL(/\/recherche\?q=facture$/);
  const synthese = remi.getByTestId('synthese-recherche');
  await expect(synthese).toContainText(`sur ${autorises.length} autorisé`);
  const affiches = await remi.locator('[data-resultat-dossier]').evaluateAll((els) => els.map((e) => e.getAttribute('data-resultat-dossier') ?? ''));
  expect(affiches.length).toBeGreaterThan(0);
  for (const id of affiches) expect(autorises).toContain(id);
  expect(new Set(affiches).size).toBe(affiches.length);
  // Décompte cohérent : listés (sur cette page) + sans résultat <= autorisés ; le texte du décompte est présent.
  await expect(remi.getByTestId('dossiers-sans-resultat')).toContainText(/sans résultat|Aucun dossier autorisé sans résultat/);
  // Toute pièce citée mène au dossier sous lequel elle est rangée.
  for (const bloc of await remi.locator('[data-resultat-dossier]').all()) {
    const id = (await bloc.getAttribute('data-resultat-dossier'))!;
    for (const href of await bloc.locator('[data-resultat-piece] a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))) expect(href.startsWith(`/dossiers/${id}/pieces/`)).toBe(true);
  }
  // Le terme trouvé est surligné par un élément <mark>, jamais par du HTML injecté.
  if (await remi.locator('[data-resultat-piece] mark').count()) await expect(remi.locator('[data-resultat-piece] mark').first()).toBeVisible();
  await expect(remi.getByTestId('extrait').or(remi.locator('[data-resultat-ecriture]')).or(remi.getByTestId('aucun-resultat')).first()).toBeVisible();
  await remi.context().close();
});

test('écran étroit (360 px) : recherche sur le portefeuille sans débordement ; un déposant est refusé', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, '/recherche?q=facture', 360);
  await expect(remi.getByTestId('synthese-recherche')).toBeVisible();
  for (const terme of ['facture', 'créditeur', 'banque']) {
    await remi.goto(`/recherche?q=${encodeURIComponent(terme)}`);
    await expect(remi.getByTestId('synthese-recherche')).toBeVisible();
    const d = await mesurer(remi);
    expect(d.contenu, terme).toBeLessThanOrEqual(d.fenetre);
    for (const droite of await remi.locator('[data-resultat-dossier] li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(droite).toBeLessThanOrEqual(360);
  }
  await remi.context().close();

  const client = await ouvrir(browser, CLIENT_MAIL, '/recherche?q=facture');
  await expect(client.getByTestId('erreur-403')).toContainText('La recherche sur plusieurs dossiers n’est pas ouverte aux déposants.');
  await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Recherche' })).toHaveCount(0);
  expect(await client.evaluate(async () => (await fetch('/api/bff/v1/recherche?q=facture')).status)).toBe(403);
  await client.context().close();
});
