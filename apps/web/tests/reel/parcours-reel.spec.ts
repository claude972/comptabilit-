import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type Page, devices, expect, test } from '@playwright/test';

/** Mot de passe des comptes du royaume de développement, lu dans le .env local (jamais affiché). */
function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}

async function seConnecter(page: Page, email: string, destination: string) {
  await page.goto(destination);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
}

const SEL = randomBytes(4).toString('hex').toUpperCase();
const NUMERO = `FA-2026-${SEL}`;
// Facture fictive : 1 000,00 HT + 200,00 de TVA à 20 % = 1 200,00 TTC.
const TEXTE = [
  'ATELIER FICTIF DU TEST SARL',
  '12 rue de l’Exemple - 75000 Paris',
  '',
  `FACTURE N° ${NUMERO}`,
  'Date de facture : 14/03/2025',
  '',
  'Prestation de service        1 000,00',
  '',
  'Total HT : 1 000,00 €',
  'TVA 20 % : 200,00 €',
  'Total TTC : 1 200,00 €',
].join('\n');

/** Image de facture rendue par un navigateur : aucun texte exploitable sans OCR. Ce n'est pas une photo réelle. */
async function imageFacture(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
  await page.setContent(`<body style="margin:60px;background:#fff"><pre style="font:24px/1.7 Helvetica,Arial,sans-serif;color:#111"></pre></body>`);
  await page.locator('pre').evaluate((el, t) => (el.textContent = t), TEXTE);
  const image = await page.screenshot({ type: 'png' });
  await page.close();
  return image;
}

let urlPiece = '';

test('téléphone (émulation) : photo → envoi → « Reçu » confirmé par le serveur → OCR → champs visibles par le déposant', async ({ browser }) => {
  const image = await imageFacture(browser);
  const contexte = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await contexte.newPage();
  await seConnecter(page, 'client.depot@client-a.test', '/deposer');

  await expect(page.getByRole('heading', { name: 'Déposer une pièce' })).toBeVisible();
  await expect(page.getByTestId('dossier-unique')).toHaveText('Boulangerie Dupain SAS (fictive)');
  await page.getByTestId('entree-photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('radio', { name: 'Facture d’achat' }).check();
  await expect(page.getByTestId('liste-recus')).toHaveCount(0);
  await page.getByTestId('envoyer').click();

  const recu = page.getByTestId('liste-recus').getByRole('listitem');
  await expect(recu).toContainText('Reçu', { timeout: 60_000 });
  await recu.getByRole('link', { name: 'Suivre cette pièce' }).click();
  await expect(page).toHaveURL(/\/depots\/[0-9a-f-]{36}/);

  // L'analyse (antivirus, OCR, extraction) est asynchrone : on recharge jusqu'au statut « À contrôler ».
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('main')).toContainText('À contrôler', { timeout: 3_000 });
  }).toPass({ timeout: 150_000, intervals: [3_000] });
  await expect(page.getByText('Extraction automatique — projet')).toBeVisible();
  const principal = page.getByRole('main');
  await expect(principal).toContainText(NUMERO);
  await expect(principal).toContainText(/1[\s  ]200,00/);
  // Le déposant n'a aucun accès à la révision.
  const liens = await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link').allInnerTexts();
  expect(liens).toEqual(['Déposer', 'Mes dépôts']);
  urlPiece = new URL(page.url()).pathname.split('/').pop()!;
  await contexte.close();
});

test('ordinateur : le réviseur retrouve la pièce, voit l’aperçu et les vérifications, puis valide la version affichée', async ({ browser }) => {
  test.skip(!urlPiece, 'dépend du dépôt précédent');
  const contexte = await browser.newContext({ ...devices['Desktop Chrome'] });
  const page = await contexte.newPage();
  await seConnecter(page, 'remi.reviseur@cabinet-a.test', '/dossiers');
  await page.getByRole('link', { name: /Boulangerie Dupain/ }).first().click();
  await expect(page).toHaveURL(/\/dossiers\/[0-9a-f-]{36}/);
  await page.goto(`${new URL(page.url()).pathname.replace(/\/$/, '')}/pieces/${urlPiece}`);

  await expect(page.getByText('Projet — non validé')).toBeVisible();
  const principal = page.getByRole('main');
  await expect(principal).toContainText(NUMERO);
  await expect(principal).toContainText(/1[\s  ]200,00/);
  await expect(page.getByTestId('apercu-piece')).toBeVisible();
  const decision = page.getByTestId('decision-reviseur');
  await expect(decision).toContainText('La validation porte sur la version 1 affichée');
  await decision.getByRole('button', { name: 'Valider la version 1' }).click();
  await expect(page.getByText('Validé par un réviseur (version 1)')).toBeVisible();
  await expect(page.getByTestId('entete-piece')).toContainText('Traité');
  await contexte.close();
});

test('ordinateur : révision — contrôles avec statuts distincts et catalogue, sur les données réellement importées', async ({ browser }) => {
  const contexte = await browser.newContext({ ...devices['Desktop Chrome'] });
  const page = await contexte.newPage();
  await seConnecter(page, 'remi.reviseur@cabinet-a.test', '/dossiers');
  await page.getByRole('link', { name: /Boulangerie Dupain/ }).first().click();
  await expect(page).toHaveURL(/\/dossiers\/[0-9a-f-]{36}/);
  const base = new URL(page.url()).pathname.replace(/\/$/, '');
  await page.goto(`${base}/revision`);
  const principal = page.getByRole('main');
  await expect(principal).toContainText('GEN-001');
  await expect(principal).toContainText('Exécuté sans anomalie détectée');
  await page.goto(`${base}/comptabilite`);
  await expect(page.getByRole('main')).toContainText('Lisible');
  await page.goto('/reference/controles');
  await expect(page.getByRole('main')).toContainText('TRE-001');
  await contexte.close();
});

test('cloisonnement dans l’interface : l’administratrice ne peut pas ouvrir le dossier où elle n’est pas habilitée', async ({ browser }) => {
  const contexte = await browser.newContext({ ...devices['Desktop Chrome'] });
  const page = await contexte.newPage();
  await seConnecter(page, 'alice.admin@cabinet-a.test', '/dossiers');
  const martin = page.getByRole('main').getByText('Garage Martin SARL (fictif)');
  await expect(martin).toBeVisible();
  await expect(page.getByRole('link', { name: /Garage Martin/ })).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('Non habilité');
  // Accès direct par l'adresse : l'application affiche un refus, et l'API ne livre aucun contenu du dossier.
  await page.goto('/dossiers/aaaaaaaa-0000-4000-8000-0000000000e2');
  await expect(page.getByRole('heading', { name: /Accès refusé|Introuvable/ })).toBeVisible();
  await page.goto('/dossiers/aaaaaaaa-0000-4000-8000-0000000000e2/revision');
  await expect(page.getByRole('main')).not.toContainText('GEN-001');
  await contexte.close();
});
