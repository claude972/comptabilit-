import { expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, surveiller } from '../outils';

test.use({ storageState: etatDe('chloe') });
test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

const ENTETE = 'Désignation;Compte;Valeur brute;Date de mise en service;Durée (mois)';
const sansDebordement = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);

test.describe('reprise des immobilisations sur téléphone (émulation mobile, API simulée)', () => {
  test('choix du fichier, aperçu, correspondance, confirmation et rapport : cibles tactiles de 44 px, aucun débordement horizontal', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}/inventaire/reprise`);
    expect(await sansDebordement(page)).toBe(true);
    const lignes = [ENTETE, ...Array.from({ length: 60 }, (_, i) => `Bien numéro ${i + 1} avec une désignation assez longue pour tester le retour à la ligne;218300;${100 + i},00;01/01/2024;12`), 'Ligne cassée;218300;abc;01/01/2024;12'];
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles({ name: 'immobilisations.csv', mimeType: 'text/csv', buffer: Buffer.from(lignes.join('\n')) });
    await expect(page.getByTestId('apercu-reprise')).toBeVisible();
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 60');
    expect(await sansDebordement(page)).toBe(true);
    for (const champ of ['libelle', 'dureeMois']) {
      const liste = page.locator(`select[data-champ="${champ}"]`);
      await liste.scrollIntoViewIfNeeded();
      expect((await liste.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Pagination de l'aperçu (50 lignes par page).
    await expect(page.locator('tr[data-ligne]')).toHaveCount(50);
    const suivante = page.getByRole('button', { name: 'Page suivante' });
    await suivante.scrollIntoViewIfNeeded();
    expect((await suivante.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await suivante.click();
    await expect(page.locator('tr[data-ligne]')).toHaveCount(11);
    const case_ = page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ });
    await case_.scrollIntoViewIfNeeded();
    await case_.check();
    const valider = page.getByRole('button', { name: /Valider l’import de 60 immobilisations/ });
    await valider.scrollIntoViewIfNeeded();
    expect((await valider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await valider.click();
    await expect(page.getByTestId('rapport-reprise')).toBeVisible();
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Créées : 60');
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Rejetées : 1');
    expect(await sansDebordement(page)).toBe(true);
    await expect(page.getByTestId('telecharger-rapport')).toBeVisible();
    expect(erreurs).toEqual([]);
  });
});
