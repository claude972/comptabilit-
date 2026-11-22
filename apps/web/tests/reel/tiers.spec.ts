/**
 * Tiers et factures sur la pile RÉELLE — parcours court, en lecture seule (aucune donnée n'est créée ni modifiée).
 * Selon l'état du dossier de démonstration au moment du test, l'écran montre des tiers tirés des écritures, ou dit
 * qu'aucune donnée comptable n'est importée : les deux sont des états corrects, et le test vérifie que l'écran dit lequel.
 * Dans tous les cas : mention « aide à la révision », date d'appréciation explicite, onglet présent, pas de débordement.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { ordinateur } from './profils';

const DOSSIER_DEMO = 'aaaaaaaa-0000-4000-8000-0000000000e1';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}

test('tiers et factures : référentiel recalculé, échéancier à une date explicite, suspicions — toujours une aide à la révision', async ({ browser }) => {
  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${DOSSIER_DEMO}/tiers`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.goto(`/dossiers/${DOSSIER_DEMO}`);
  await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Tiers et factures' }).click();

  await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Tiers et factures' })).toHaveAttribute('aria-current', 'page');
  const avertissement = page.getByTestId('avertissement-tiers');
  await expect(avertissement).toContainText('Aide à la révision');
  await expect(avertissement).toContainText('rien n’est comptabilisé ni lettré ici');
  // La date d'appréciation est toujours affichée, et c'est la clôture de l'exercice tant qu'aucune date n'est fournie.
  await expect(page.getByTestId('date-appreciation')).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/);
  await expect(page.getByTestId('entete-tiers')).toContainText('clôture de l’exercice');

  // Référentiel : des tiers tirés des écritures, ou l'absence de données dite en clair.
  const tiers = page.getByTestId('ligne-tiers');
  await expect(tiers.first().or(page.getByTestId('aucun-tiers'))).toBeVisible();
  if (await page.getByTestId('sans-donnees').isVisible()) await expect(page.getByTestId('sans-donnees')).toContainText('Aucune donnée comptable importée');
  if ((await tiers.count()) > 0) {
    // Fiche du premier tiers : le solde affiché vient des écritures, les mouvements sont listés.
    await tiers.first().getByRole('link').click();
    const fiche = page.getByTestId('fiche-tiers');
    await expect(fiche).toBeVisible();
    await expect(fiche.getByRole('heading', { name: /Mouvements de l’exercice/ })).toBeVisible();
    await expect(fiche.getByRole('heading', { name: 'Identifiants connus et leur origine' })).toBeVisible();
  }

  // Échéancier à une date fournie : la date est rendue par l'écran, jamais remplacée par la date du jour.
  const sections = page.getByRole('navigation', { name: 'Tiers et factures' });
  await sections.getByRole('link', { name: 'Échéancier des factures' }).click();
  await expect(page.getByTestId('ligne-facture').first().or(page.getByTestId('aucune-facture'))).toBeVisible();
  const cloture = await page.getByTestId('date-appreciation').innerText();
  const [, , annee] = cloture.split('/');
  await page.getByLabel('Apprécier les échéances au (vide : clôture)').fill(`${annee}-06-30`);
  await page.getByRole('button', { name: 'Appliquer la date' }).click();
  await expect(page.getByTestId('date-appreciation')).toHaveText(`30/06/${annee}`);
  await expect(page.getByTestId('entete-tiers')).toContainText('date fournie');
  // Une facture sans écriture identifiée ou sans échéance n'est jamais dite « non échue » ou « réglée » par défaut :
  // chaque ligne porte un état explicite.
  for (const ligne of await page.getByTestId('ligne-facture').all()) await expect(ligne.locator('td').last()).toHaveText(/\S/);

  // À confirmer et suspicions : la définition de la suspicion est distinguée du doublon binaire et de la nouvelle version.
  await sections.getByRole('link', { name: 'À confirmer et suspicions' }).click();
  await expect(page.getByText('Ce n’est ni un doublon binaire (le même fichier reçu deux fois), ni une nouvelle version d’une pièce.')).toBeVisible();
  await expect(page.getByTestId('suspicion').first().or(page.getByTestId('aucune-suspicion'))).toBeVisible();

  // Écran étroit : pas de débordement horizontal.
  await page.setViewportSize({ width: 360, height: 780 });
  for (const vue of ['tiers', 'echeancier', 'a-traiter']) {
    await page.goto(`/dossiers/${DOSSIER_DEMO}/tiers?vue=${vue}`);
    await expect(page.getByTestId('entete-tiers')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `débordement sur ${vue}`).toBe(true);
  }
  await contexte.close();
});
