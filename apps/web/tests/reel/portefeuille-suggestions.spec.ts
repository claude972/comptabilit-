/**
 * Assistant de PORTEFEUILLE et suggestions d'amélioration sur la pile RÉELLE (web 3100, API, worker, Keycloak, base) —
 * parcours courts, en lecture : une question est posée (un échange est ajouté pour son auteur), aucune donnée existante
 * n'est modifiée ni supprimée, aucune décision de revue n'est prise, aucune règle n'est créée.
 * État réel : AUCUNE IA n'est connectée ; la réponse attendue est « sans IA », étiquetée comme telle.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { ordinateur } from './profils';

const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
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

test('question réelle sur le portefeuille autorisé : réponse « sans IA », périmètre par dossier, citations vers le bon dossier', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, '/');
  await remi.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Assistant' }).click();
  await expect(remi).toHaveURL(/\/assistant$/);
  const bandeau = remi.getByTestId('etat-ia');
  await expect(bandeau).toHaveAttribute('data-statut-ia', 'non_connecte');
  await expect(bandeau).toContainText('IA non connectée');
  // Périmètre proposé = celui que l'API calcule pour Rémi ; tout est coché par défaut.
  const choix = remi.getByTestId('choix-dossiers');
  const cases = choix.getByRole('checkbox');
  const nb = await cases.count();
  expect(nb).toBeGreaterThanOrEqual(2);
  for (const c of await cases.all()) await expect(c).toBeChecked();
  const autorises = await cases.evaluateAll((els) => els.map((e) => e.getAttribute('data-dossier') ?? ''));
  await expect(choix).toContainText(`Dossiers interrogés (${nb} sur ${nb} autorisé`);

  await remi.getByLabel('Votre question sur ces dossiers').fill('Quels constats ont été relevés par les contrôles ?');
  await remi.getByRole('button', { name: 'Poser la question' }).click();
  const reponse = remi.getByTestId('zone-reponse').getByTestId('reponse-portefeuille');
  await expect(reponse).toHaveAttribute('data-mode', 'sans_ia', { timeout: 60_000 });
  await expect(reponse.getByTestId('mode-reponse')).toHaveText('Sans IA');
  await expect(reponse.getByTestId('etiquette-reponse')).toHaveText('Sans IA : résultats de recherche et calculs du moteur, sans rédaction');
  await expect(reponse.getByTestId('confiance')).toContainText('Confiance non évaluée');
  // Un bloc par dossier interrogé, chacun avec sa période (ou l'absence de période) ; uniquement des dossiers autorisés.
  const interroges = await reponse.locator('[data-dossier-interroge]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dossier-interroge') ?? ''));
  expect(interroges.length).toBe(Math.min(nb, 20));
  for (const id of interroges) expect(autorises).toContain(id);
  await expect(reponse.getByTestId('periode-dossier')).toHaveCount(interroges.length);
  // Toute citation cliquable mène à un dossier interrogé.
  const liens = await reponse.locator('[data-citation] a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  for (const href of liens.filter((h) => h.startsWith('/'))) expect(interroges.some((id) => href.startsWith(`/dossiers/${id}/`))).toBe(true);
  if (liens.some((h) => h.includes('/revision/constats/'))) {
    await expect(reponse.locator('[data-nature="constat"]').first()).toContainText('Constat :');
  } else {
    // Aucun constat à citer : l'écran dit pourquoi, dossier par dossier, ou l'assistant s'abstient.
    expect((await reponse.getByTestId('manquantes-dossier').count()) + (await reponse.getByTestId('abstention').count())).toBeGreaterThan(0);
  }
  await expect(remi.getByTestId('historique-portefeuille')).toContainText('Quels constats ont été relevés par les contrôles ?');
  await remi.context().close();
});

test('écran étroit (360 px) : assistant de portefeuille et suggestions sans débordement ; rôles : collaboratrice sans suggestions, déposant sans assistant', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, '/assistant', 360);
  await expect(remi.getByTestId('etat-ia')).toHaveAttribute('data-statut-ia', 'non_connecte');
  const mesurer = (page: Page) => page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
  // Historique déplié (l'échange du test précédent, s'il existe) : toujours dans la largeur de l'écran.
  const premier = remi.getByTestId('historique-portefeuille').locator('[data-echange] summary').first();
  if (await premier.count()) await premier.click();
  let d = await mesurer(remi);
  expect(d.contenu).toBeLessThanOrEqual(d.fenetre);

  // Suggestions tirées des corrections : calculées par l'API réelle sur les décisions du cabinet de démonstration, en lecture seule.
  await remi.goto('/regles');
  const bloc = remi.getByTestId('suggestions');
  await expect(bloc.getByRole('heading')).toContainText('Suggestions tirées des corrections (');
  await expect(bloc.getByTestId('cadre-suggestions')).toContainText('Calcul déterministe, sans IA');
  await expect(bloc.getByTestId('cadre-suggestions')).toContainText('non validées par un expert-comptable');
  for (const preuves of await bloc.getByTestId('preuves-suggestion').locator('summary').all()) await preuves.click();
  d = await mesurer(remi);
  expect(d.contenu).toBeLessThanOrEqual(d.fenetre);
  // Aucune suggestion n'est une règle : toute suggestion affichée le dit.
  for (const carte of await bloc.locator('[data-suggestion]').all()) await expect(carte.getByTestId('ne-fait-pas')).toContainText('N’active rien');
  await remi.context().close();

  const chloe = await ouvrir(browser, CHLOE_MAIL, '/regles');
  await expect(chloe.getByRole('heading', { level: 1 })).toHaveText('Règles du cabinet');
  await expect(chloe.getByTestId('suggestions')).toHaveCount(0);
  expect(await chloe.evaluate(async () => (await fetch('/api/bff/v1/regles/suggestions')).status)).toBe(403);
  await chloe.context().close();

  const client = await ouvrir(browser, CLIENT_MAIL, '/assistant');
  await expect(client.getByTestId('erreur-403')).toContainText('L’assistant n’est pas ouvert aux déposants.');
  await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Assistant' })).toHaveCount(0);
  expect(await client.evaluate(async () => (await fetch('/api/bff/v1/assistant/perimetre')).status)).toBe(403);
  await client.context().close();
});
