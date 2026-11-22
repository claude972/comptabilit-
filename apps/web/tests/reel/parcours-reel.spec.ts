import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './base';
import { ordinateur, telephone } from './profils';

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

// Alphabet SANS caractères que l'OCR confond (0/O/D, 1/I/L, 5/S, 8/B, 2/Z, G/6) : le numéro de facture doit être lu à l'identique sur tout
// moteur de rendu (la CI Firefox a échoué quand le tirage aléatoire contenait des caractères ambigus : « Numéro : non extrait »).
const ALPHABET_LISIBLE = 'ACEFHKMNPRTWXY347';
const SEL = Array.from(randomBytes(8), (o) => ALPHABET_LISIBLE[o % ALPHABET_LISIBLE.length]).join('');
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
  // Entrée plus lisible pour l'OCR (D-143) : rendu à l'échelle 2, police plus grosse, graisse moyenne, familles explicites ; la CI Firefox a échoué par intermittence (« Numéro : non extrait »), non reproductible localement.
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:60px;background:#fff"><pre style="font:600 36px/1.7 'DejaVu Sans','Liberation Sans',Arial,sans-serif;letter-spacing:1px;color:#000"></pre></body>`);
  await page.locator('pre').evaluate((el, t) => (el.textContent = t), TEXTE);
  const image = await page.screenshot({ type: 'png' });
  await page.close();
  return image;
}

let urlPiece = '';

test('téléphone (émulation) : photo → envoi → « Reçu » confirmé par le serveur → OCR → champs visibles par le déposant', async ({ browser }) => {
  const image = await imageFacture(browser);
  const contexte = await browser.newContext({ ...telephone(browser) });
  const page = await contexte.newPage();
  await seConnecter(page, 'client.depot@client-a.test', '/deposer');

  await expect(page.getByRole('heading', { name: 'Déposer une pièce' })).toBeVisible();
  // La base réelle est partagée : d'autres parcours peuvent avoir habilité ce déposant sur des dossiers d'essai.
  // Dossier unique → présélectionné ; sinon on choisit explicitement le dossier de démonstration.
  const choix = page.getByLabel('Dossier', { exact: true });
  if (await page.getByTestId('dossier-unique').count()) await expect(page.getByTestId('dossier-unique')).toHaveText('Boulangerie Dupain SAS (fictive)');
  else await choix.selectOption({ label: 'Boulangerie Dupain SAS (fictive)' });
  await page.getByTestId('entree-photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('radio', { name: 'Facture d’achat' }).check();
  await expect(page.getByTestId('liste-recus')).toHaveCount(0);
  await page.getByTestId('envoyer').click();

  const recu = page.getByTestId('liste-recus').getByRole('listitem');
  await expect(recu).toContainText('Reçu', { timeout: 60_000 });
  // Firefox interrompt parfois une navigation lancée juste après l'envoi (NS_BINDING_ABORTED, vu en CI) : on la reprend
  // tant que la page de suivi n'est pas atteinte.
  await expect(async () => {
    if (!/\/depots\/[0-9a-f-]{36}/.test(page.url())) await recu.getByRole('link', { name: 'Suivre cette pièce' }).click();
    await expect(page).toHaveURL(/\/depots\/[0-9a-f-]{36}/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000, intervals: [1_000] });

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
  const contexte = await browser.newContext({ ...ordinateur(browser) });
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
  const contexte = await browser.newContext({ ...ordinateur(browser) });
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
  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  // La liste est paginée (50 par page) : le dossier est cherché par son nom, comme le ferait une utilisatrice.
  await seConnecter(page, 'alice.admin@cabinet-a.test', '/dossiers');
  await page.goto('/dossiers?q=Garage+Martin');
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

test('messagerie : « non connecté » et « connecteur non configuré » pour l’administratrice ; refus pour le réviseur et le déposant', async ({ browser }) => {
  // État RÉEL de l'installation : sans application OAuth configurée, aucune boîte ne peut être connectée.
  const admin = await browser.newContext({ ...ordinateur(browser) });
  const page = await admin.newPage();
  await seConnecter(page, 'alice.admin@cabinet-a.test', '/messagerie');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Messagerie');
  await expect(page.getByTestId('bandeau-non-connecte')).toContainText('Aucune boîte réelle n’a été connectée');
  for (const f of ['gmail', 'microsoft']) {
    const carte = page.locator(`[data-connecteur="${f}"]`);
    await expect(carte).toContainText('Non connecté');
    await expect(carte.getByTestId('connecteur-non-configure')).toContainText('connecteur non configuré');
  }
  await expect(page.getByRole('link', { name: 'Connecter une boîte' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Messagerie' })).toBeVisible();
  // L'API réelle refuse de démarrer une connexion : 503 « connecteur_non_configure », relayé par le BFF.
  const reponse = await page.evaluate(async () => {
    const r = await fetch('/api/bff/v1/mail/connexions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ fournisseur: 'gmail' }) });
    return { statut: r.status, corps: (await r.json()) as { code?: string } };
  });
  expect(reponse.statut).toBe(503);
  expect(reponse.corps.code).toBe('connecteur_non_configure');
  // Un retour OAuth sans demande préalable n'aboutit à rien et ne laisse aucun code dans l'adresse.
  await page.goto('/connexions-mail/retour?state=inconnu&code=inconnu');
  await expect(page).toHaveURL(/\/messagerie\?retour=(connecteur_non_configure|state_invalide)$/);
  await expect(page.getByTestId('retour-oauth')).toBeVisible();
  await admin.close();

  for (const email of ['remi.reviseur@cabinet-a.test', 'client.depot@client-a.test']) {
    const contexte = await browser.newContext({ ...ordinateur(browser) });
    const p = await contexte.newPage();
    await seConnecter(p, email, '/messagerie');
    await expect(p.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
    await expect(p.getByRole('main')).toContainText('réservée aux gestionnaires du cabinet');
    await expect(p.locator('a[href^="/messagerie"]')).toHaveCount(0);
    expect(await p.evaluate(async () => (await fetch('/api/bff/v1/mail/connexions')).status)).toBe(403);
    await contexte.close();
  }
});
