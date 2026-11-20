import { expect, test } from '@playwright/test';
import { ID, etatDe, seConnecter, simulateur, statutBff, surveiller } from '../outils';

/**
 * Recherche textuelle sur le PORTEFEUILLE (`/recherche`) — API SIMULÉE (tests/faux-api.ts, recherche par sous-chaîne).
 * Rémi est habilité sur Dupain et Martin ; Chloé sur Dupain seulement. Martin n'a ni pièce ni écriture.
 */
const DUPAIN = 'Boulangerie Dupain SAS (fictive)';
const MARTIN = 'Garage Martin SARL (fictif)';
const REMI = '11111111-1111-4111-8111-111111111102';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

async function chercher(page: import('@playwright/test').Page, terme: string) {
  const champ = page.getByRole('search', { name: 'Recherche dans mes dossiers' });
  await champ.getByLabel('Rechercher dans tous mes dossiers').fill(terme);
  await champ.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(new RegExp(`/recherche\\?q=${encodeURIComponent(terme).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

test.describe('recherche multi-dossiers du cabinet', () => {
  test.use({ storageState: etatDe('remi') });

  test('lien de navigation, résultats groupés par dossier, dossiers sans résultat décomptés mais ni listés ni nommés, liens vers le bon dossier', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Recherche' }).click();
    await expect(page).toHaveURL(/\/recherche$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Recherche' })).toBeVisible();
    await expect(page.getByTestId('recherche-invalide')).toContainText('Saisissez de 2 à 200 caractères');

    await chercher(page, 'caisse');
    const synthese = page.getByTestId('synthese-recherche');
    await expect(synthese).toContainText('Résultats pour « caisse » : 1 dossier avec résultat sur 2 autorisés.');
    await expect(page.getByTestId('dossiers-sans-resultat')).toHaveText('1 dossier autorisé sans résultat (non listé).');
    // Martin n'a rien : ni listé, ni nommé dans la page.
    await expect(page.locator('[data-resultat-dossier]')).toHaveCount(1);
    await expect(page.locator(`[data-resultat-dossier="${ID.dupain}"]`)).toContainText(DUPAIN);
    await expect(page.getByRole('main')).not.toContainText(MARTIN);
    const dupain = page.locator(`[data-resultat-dossier="${ID.dupain}"]`);
    await expect(dupain.getByTestId('totaux-dossier')).toContainText('constat');
    const constat = dupain.locator('[data-groupe="constats"] [data-resultat-constat]');
    await expect(constat).toContainText('TRE-001');
    await expect(constat.getByRole('link', { name: /Caisse créditrice/ })).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    await expect(dupain.getByRole('link', { name: 'Voir tous les résultats dans ce dossier' })).toHaveAttribute('href', `/dossiers/${ID.dupain}/recherche?q=caisse`);
    await expect(dupain.getByRole('link', { name: DUPAIN })).toHaveAttribute('href', `/dossiers/${ID.dupain}`);

    // Pièce : extrait surligné, lien vers la pièce DU dossier.
    await chercher(page, 'facture');
    const piece = page.locator(`[data-resultat-dossier="${ID.dupain}"] [data-resultat-piece]`).first();
    await expect(piece.locator('mark').first()).toBeVisible();
    await expect(piece.getByTestId('extrait')).not.toContainText('«');
    await expect(piece.getByRole('link').first()).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/pieces/[0-9a-f-]{36}$`));
    await piece.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/dossiers/${ID.dupain}/pieces/[0-9a-f-]{36}$`));
    expect(erreurs).toEqual([]);
  });

  test('un libellé hostile est une donnée : texte brut, aucun script exécuté', async ({ page }) => {
    let alerte = false;
    page.on('dialog', (d) => {
      alerte = true;
      void d.dismiss();
    });
    await page.goto('/recherche?q=retrait');
    const ecriture = page.locator(`[data-resultat-dossier="${ID.dupain}"] [data-resultat-ecriture]`);
    await expect(ecriture).toHaveCount(1);
    await expect(ecriture).toContainText('Retrait espèces <script>alert(1)</script>');
    await expect(ecriture).toContainText('débit 500,00');
    expect(await page.locator('main script').count()).toBe(0);
    expect(alerte).toBe(false);
  });

  test('requête trop courte : message clair ; aucun résultat : dit sans dossier nommé ; délai dépassé : refus explicite', async ({ page }) => {
    await page.goto('/recherche?q=a');
    await expect(page.getByTestId('recherche-invalide')).toContainText('Saisissez de 2 à 200 caractères');
    await page.goto('/recherche?q=xyzzyqwertz');
    await expect(page.getByTestId('aucun-resultat')).toHaveText('Aucun résultat dans vos dossiers.');
    await expect(page.getByTestId('dossiers-sans-resultat')).toHaveText('2 dossiers autorisés sans résultat (non listés).');
    await expect(page.getByRole('main')).not.toContainText('Dupain');
    await simulateur('pannes', { delaiRecherche: 1 });
    await page.goto('/recherche?q=caisse');
    await expect(page.getByTestId('recherche-invalide')).toContainText('La recherche a dépassé le délai de 8 s');
    await expect(page.locator('[data-resultat-dossier]')).toHaveCount(0);
  });

  test('pagination par dossier : pages disjointes, classement conservé, liens clavier', async ({ page }) => {
    await simulateur('dossiers-avec-pieces', { n: 12, mot: 'zzpagination' });
    await page.goto('/recherche?q=zzpagination');
    await expect(page.getByTestId('synthese-recherche')).toContainText('12 dossiers avec résultat sur 14 autorisés.');
    await expect(page.locator('[data-resultat-dossier]')).toHaveCount(10);
    const premiere = await page.locator('[data-resultat-dossier]').evaluateAll((els) => els.map((e) => e.getAttribute('data-resultat-dossier')));
    const nav = page.getByRole('navigation', { name: 'Pages de résultats' });
    await expect(nav).toContainText('Page 1 sur 2');
    await expect(nav.getByRole('link', { name: 'Page précédente' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Page suivante' }).click();
    await expect(page).toHaveURL(/q=zzpagination&page=2$/);
    await expect(page.locator('[data-resultat-dossier]')).toHaveCount(2);
    const seconde = await page.locator('[data-resultat-dossier]').evaluateAll((els) => els.map((e) => e.getAttribute('data-resultat-dossier')));
    expect(seconde.filter((x) => premiere.includes(x))).toEqual([]);
    await expect(page.getByRole('navigation', { name: 'Pages de résultats' }).getByRole('link', { name: 'Page précédente' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Pagination 11 SARL (fictive)');
    await expect(page.getByRole('main')).toContainText('Pagination 12 SARL (fictive)');
    // Page au-delà : dit, sans erreur.
    await page.goto('/recherche?q=zzpagination&page=9');
    await expect(page.getByTestId('aucun-resultat')).toContainText('revenez à la première page');
  });

  test('habilitation retirée : le dossier disparaît de la recherche suivante sans être nommé', async ({ page, browser }) => {
    await page.goto('/recherche?q=caisse');
    await expect(page.locator(`[data-resultat-dossier="${ID.dupain}"]`)).toBeVisible();
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/');
    expect(await statutBff(alice, 'PUT', `v1/dossiers/${ID.dupain}/habilitations/${REMI}`, { niveau: 'depot' })).toBe(200);
    await alice.context().close();
    await page.reload();
    await expect(page.getByTestId('synthese-recherche')).toContainText('0 dossier avec résultat sur 1 autorisé.');
    await expect(page.getByTestId('aucun-resultat')).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Dupain');
  });

  test('utilisable au clavier, sans débordement horizontal à 360 px (résultats dépliés compris)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/recherche');
    await page.getByLabel('Rechercher dans tous mes dossiers').focus();
    await page.keyboard.type('retrait');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Rechercher' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-resultat-ecriture]')).toBeVisible();
    for (const terme of ['retrait', 'facture', 'caisse']) {
      await page.goto(`/recherche?q=${terme}`);
      await expect(page.locator('[data-resultat-dossier]').first()).toBeVisible();
      const d = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
      expect(d.contenu, terme).toBeLessThanOrEqual(d.fenetre);
      for (const droite of await page.locator('[data-resultat-dossier] li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(droite).toBeLessThanOrEqual(360);
    }
  });
});

test.describe('périmètre et refus', () => {
  test('Chloé ne cherche que dans Dupain ; l’identifiant d’un autre dossier n’élargit rien', async ({ browser }) => {
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto('http://localhost:3000/recherche?q=caisse');
    await expect(chloe.getByTestId('synthese-recherche')).toContainText('1 dossier avec résultat sur 1 autorisé.');
    await expect(chloe.getByTestId('dossiers-sans-resultat')).toHaveText('Aucun dossier autorisé sans résultat.');
    await expect(chloe.getByRole('main')).not.toContainText('Martin');
    await expect(chloe.getByRole('main')).not.toContainText('Leroy');
    expect(await statutBff(chloe, 'GET', `v1/recherche?q=caisse&entiteId=${ID.martin}`)).toBe(404);
    await chloe.context().close();
  });

  test('un déposant n’a ni lien, ni écran, ni API ; un autre cabinet ne voit que les siens', async ({ browser }) => {
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/recherche');
    await expect(client.getByTestId('erreur-403')).toContainText('La recherche sur plusieurs dossiers n’est pas ouverte aux déposants.');
    await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Recherche' })).toHaveCount(0);
    expect(await statutBff(client, 'GET', 'v1/recherche?q=caisse')).toBe(403);
    await client.context().close();

    const bruno = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await seConnecter(bruno, 'bruno', '/recherche?q=caisse');
    await expect(bruno.getByTestId('synthese-recherche')).toContainText('0 dossier avec résultat sur 1 autorisé.');
    await expect(bruno.getByRole('main')).not.toContainText('Dupain');
    await bruno.context().close();
  });
});
