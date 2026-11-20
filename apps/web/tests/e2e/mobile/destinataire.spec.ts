import { expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, surveiller } from '../outils';

test.use({ storageState: etatDe('remi') });
test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

const sansDebordement = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

test.describe('destinataire et réanalyse sur téléphone (émulation mobile, API simulée)', () => {
  test('correction du destinataire : formulaire utilisable au doigt, sans débordement, correction tracée', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' }).click();
    const bloc = page.getByTestId('bloc-destinataire');
    await expect(bloc).toBeVisible();
    expect(await sansDebordement(page)).toBe(true);
    const formulaire = page.locator('[data-formulaire="destinataire"]');
    for (const nom of ['Nom du destinataire', 'SIREN', 'SIRET', 'N° de TVA intracommunautaire', 'Pays (code à 2 lettres)']) {
      const champ = formulaire.getByLabel(nom);
      await champ.scrollIntoViewIfNeeded();
      expect((await champ.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await formulaire.getByLabel('SIREN').fill('552100554');
    await formulaire.getByLabel('Motif de la correction (obligatoire)').fill('Client lu sur le bon de commande');
    const bouton = formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' });
    await bouton.scrollIntoViewIfNeeded();
    expect((await bouton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await bouton.click();
    await expect(page.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toBeVisible();
    await expect(page.locator('tr[data-champ="destinataireSiren"]')).toContainText('Saisie humaine');
    expect(await sansDebordement(page)).toBe(true);
    expect(erreurs).toEqual([]);
  });

  test('réanalyse : aperçu, simulation et rapport lisibles sans débordement horizontal', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}/reanalyse-destinataire`);
    await expect(page.getByTestId('nb-concernees')).toHaveText('2');
    expect(await sansDebordement(page)).toBe(true);
    const simulation = page.locator('[data-formulaire="simulation-reanalyse"]');
    await simulation.getByLabel('Motif de la demande (obligatoire)').fill('Relecture avant la clôture');
    const bouton = simulation.getByRole('button', { name: 'Lancer la simulation' });
    expect((await bouton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await bouton.click();
    await expect(page.getByTestId('rapport-reanalyse')).toHaveAttribute('data-statut', 'termine', { timeout: 20_000 });
    await expect(page.getByTestId('resume-reanalyse')).toContainText('changeraient');
    expect(await sansDebordement(page)).toBe(true);
    const execution = page.locator('[data-formulaire="execution-reanalyse"]');
    await execution.scrollIntoViewIfNeeded();
    expect((await execution.getByRole('button', { name: 'Confirmer et exécuter la réanalyse' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(erreurs).toEqual([]);
  });
});
