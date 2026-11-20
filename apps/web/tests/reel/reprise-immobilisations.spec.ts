/**
 * Reprise des immobilisations par import CSV sur la pile RÉELLE (Chromium, Firefox, WebKit) : fichier choisi dans le navigateur, aperçu
 * calculé par l'API réelle (rien n'est écrit), confirmation explicite, rapport ligne par ligne, téléchargement du rapport neutralisé,
 * rejeu du même fichier (rien de plus), absence de débordement horizontal à 360 px, puis nettoyage : les immobilisations d'essai sont
 * retirées du fichier saisi (le rapport de reprise reste, il est en ajout seul). Les libellés sont uniques à chaque exécution.
 * Aucune proposition n'est reprise ; le dégressif reste non activé.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ordinateur } from './profils';

const DOSSIER_DEMO = 'aaaaaaaa-0000-4000-8000-0000000000e1';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}

test('reprise des immobilisations : aperçu sans écriture, confirmation, rapport, téléchargement, rejeu, sans débordement à 360 px', async ({ browser }) => {
  const contexte = await browser.newContext({ ...ordinateur(browser), acceptDownloads: true });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  const sansDebordement = async (etape: string) => {
    const m = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
    expect(m.contenu, `débordement horizontal (${etape}) : ${m.contenu} > ${m.fenetre}`).toBeLessThanOrEqual(m.fenetre + 2);
  };

  const marque = `Essai reprise ${Date.now()}`;
  const libelles = [`${marque} serveur`, `${marque} écran`];
  const csv = [
    'Désignation;Compte;Valeur brute;Date de mise en service;Durée (mois)',
    `${libelles[0]};218300;12 345,60;15/03/2024;60`,
    `${libelles[1]};218300;1.234,50;2024-02-29;36`,
    `=HYPERLINK("http://exemple.test","${marque}");218400;100,00;01/01/2024;12`.replace('=HYPERLINK', '=SOMME'),
    `${marque} compte hors classe;231000;100,00;01/01/2024;12`,
    `${marque} montant ambigu;218400;1.234;01/01/2024;12`,
  ].join('\r\n');
  const fichier = { name: 'immobilisations-essai.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };

  try {
    await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
    await page.getByTestId('lien-reprise').click();
    await expect(page.getByRole('heading', { name: 'Reprise du fichier des immobilisations (import CSV)' })).toBeVisible();
    await expect(page.getByText('Le dégressif reste non activé')).toBeVisible();
    const avant = await page.locator('section[aria-labelledby="titre-reprises"] tbody tr').count();

    await page.getByLabel('Fichier des immobilisations (CSV)').setInputFiles(fichier);
    await expect(page.getByTestId('apercu-reprise')).toBeVisible();
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 3');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Invalides : 2');
    await expect(page.locator('select[data-champ="dureeMois"]')).toHaveValue('4');
    await expect(page.locator('tr[data-ligne="4"]')).toContainText("'=SOMME"); // préfixe neutralisé à l'affichage
    await expect(page.locator('tr[data-ligne="5"]')).toContainText('classe 20');
    await expect(page.locator('tr[data-ligne="6"]')).toContainText('ambigu');
    // L'aperçu n'a rien écrit : le fichier saisi ne contient pas les biens d'essai, aucune reprise de plus.
    await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
    await expect(page.locator('[data-immobilisation]', { hasText: marque })).toHaveCount(0);
    await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire/reprise`);
    await expect(page.locator('section[aria-labelledby="titre-reprises"] tbody tr')).toHaveCount(avant);

    // 360 px : aperçu lisible sans débordement.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByLabel('Fichier des immobilisations (CSV)').setInputFiles(fichier);
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 3');
    await sansDebordement('aperçu à 360 px');

    // Confirmation explicite, puis rapport.
    const valider = page.getByRole('button', { name: /Valider l’import de 3 immobilisations/ });
    await expect(valider).toBeDisabled();
    await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
    await valider.click();
    const rapport = page.getByTestId('rapport-reprise');
    await expect(rapport).toBeVisible();
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Créées : 3');
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Rejetées : 2');
    await expect(rapport.locator('tr[data-ligne="2"]')).toHaveAttribute('data-statut', 'creee');
    await expect(rapport.locator('tr[data-ligne="5"]')).toContainText('classe 20');
    await sansDebordement('rapport à 360 px');

    // Téléchargement du rapport (CSV neutralisé).
    const telechargement = page.waitForEvent('download');
    await page.getByTestId('telecharger-rapport').click();
    const dl = await telechargement;
    const contenu = readFileSync(await dl.path(), 'utf8');
    expect(contenu.charCodeAt(0)).toBe(0xfeff);
    expect(contenu).toContain(`'=SOMME(`);
    expect(contenu).toMatch(/\r\n5;Rejetée;Compte d’immobilisation : compte de classe 20/);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Rejeu du même fichier : rien de plus à importer.
    await page.getByLabel('Fichier des immobilisations (CSV)').setInputFiles(fichier);
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 0');
    await expect(page.getByText('Aucune ligne valide : il n’y a rien à importer.')).toBeVisible();
    await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
    for (const l of libelles) await expect(page.locator('[data-immobilisation]', { hasText: l })).toHaveCount(1);
    const etat = page.getByTestId('etat-degressif');
    if (await etat.isVisible()) await expect(etat).toHaveAttribute('data-degressif-active', 'non');
  } finally {
    // Nettoyage : les immobilisations d'essai sont retirées du fichier saisi (aucune écriture comptable n'avait été créée).
    await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
    for (const l of [...libelles, `=SOMME("http://exemple.test","${marque}")`]) {
      const retirer = page.getByRole('button', { name: `Retirer du fichier : ${l}` });
      if (await retirer.count()) {
        await retirer.click();
        await expect(page.locator('[data-immobilisation]', { hasText: l })).toHaveCount(0);
      }
    }
    await contexte.close();
  }
});
