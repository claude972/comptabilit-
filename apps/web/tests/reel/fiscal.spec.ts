/**
 * États fiscaux sur la pile RÉELLE — parcours court, en lecture seule (aucune donnée n'est créée ni modifiée).
 * Selon l'état du dossier de démonstration au moment du test, l'écran montre un projet de liasse, ou dit qu'aucune
 * donnée comptable n'est importée : les deux sont des états corrects, et le test vérifie que l'écran dit lequel.
 * Dans tous les cas : mention « projet », aucune télétransmission, onglet présent.
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

test('états fiscaux : projets de liasse et d’annexe, propositions du moteur — jamais présentés comme validés ni transmis', async ({ browser }) => {
  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${DOSSIER_DEMO}/fiscal`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.goto(`/dossiers/${DOSSIER_DEMO}/fiscal`);

  await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'États fiscaux' })).toHaveAttribute('aria-current', 'page');
  const avertissement = page.getByTestId('avertissement-fiscal');
  await expect(avertissement).toContainText('projets de préparation');
  await expect(avertissement).toContainText('ne transmet aucune déclaration');

  // Liasse : un projet (codes de cases « à confirmer », tableaux non couverts listés), une abstention motivée, ou l'absence de données.
  const liasse = page.getByTestId('liasse');
  const autre = page.getByTestId('sans-donnees').or(page.getByTestId('abstention'));
  await expect(liasse.or(autre).first()).toBeVisible();
  if (await liasse.isVisible()) {
    await expect(liasse).toContainText('Projet incomplet par construction');
    await expect(liasse.getByRole('heading', { name: /^2050/ })).toBeVisible();
    await expect(liasse.getByText('à confirmer').first()).toBeVisible();
    await expect(page.getByTestId('tableaux-non-couverts').locator('li').first()).toBeVisible();
    await expect(page.getByTestId('controles-liasse').locator('li').first()).toBeVisible();
    // Euros entiers (D-105) : présentation seulement, la note dit les limites ; retour aux centimes.
    await expect(page.getByTestId('choix-montants')).toContainText('au centime');
    await page.getByTestId('choix-montants').getByRole('link', { name: /euros entiers/ }).click();
    await expect(page.getByTestId('choix-montants')).toContainText('en euros entiers');
    await expect(page.getByTestId('note-arrondi')).toContainText('0,50 compté pour 1');
    await expect(page.getByTestId('liasse').locator('td.tabular-nums').filter({ hasText: /,\d\d$/ })).toHaveCount(0);
    await page.getByTestId('choix-montants').getByRole('link', { name: 'Afficher les centimes' }).click();
    await expect(page.getByTestId('choix-montants')).toContainText('au centime');
    await page.getByRole('navigation', { name: 'États fiscaux' }).getByRole('link', { name: /Régime simplifié/ }).click();
    await expect(page.getByTestId('liasse').getByRole('heading', { name: /^2033-A/ })).toBeVisible();
  }

  // Annexe : incomplète tant que les rubriques requises ne sont pas confirmées par une personne.
  await page.getByRole('navigation', { name: 'États fiscaux' }).getByRole('link', { name: 'Projet d’annexe' }).click();
  const annexe = page.getByTestId('annexe');
  await expect(annexe.or(page.getByTestId('sans-donnees')).or(page.getByTestId('abstention')).first()).toBeVisible();
  if (await annexe.isVisible()) {
    await expect(page.getByTestId('etat-annexe')).toContainText(/Projet d’annexe incomplet|Toutes les rubriques requises sont confirmées/);
    await expect(page.getByTestId('categorie-indicative')).toContainText('jamais appliquée d’office');
    await expect(annexe.locator('li[data-rubrique]').first()).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);

  // Inventaire : les propositions du moteur sont annoncées comme calculées sans IA et non enregistrées d'office.
  await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
  const propositions = page.getByTestId('propositions-moteur');
  await expect(propositions).toBeVisible();
  await expect(propositions).toContainText(/sans IA|ne peut rien proposer/);
  await contexte.close();
});
