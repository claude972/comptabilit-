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
    // 2055 cadres B et C (D-113) : saisie ligne par ligne, totaux en abstention sans saisie ni néant.
    await expect(page.getByTestId('amortissements-derogatoires')).toBeVisible();
    await expect(page.getByTestId('lignes-2055-b').locator('tr[data-b2055]')).toHaveCount(17);
    await expect(page.getByTestId('charges-reparties')).toBeVisible();
    await expect(page.getByTestId('lignes-2055-c').locator('tr[data-c2055]')).toHaveCount(2);
    // 2058-A (D-118) : détermination du résultat fiscal par saisie case par case ; XI / XJ en abstention sans TOTAL I et TOTAL II saisis.
    const a58 = page.getByTestId('formulaire-2058-A');
    await expect(a58).toBeVisible();
    await expect(a58.locator('li[data-case-f]')).toHaveCount(73);
    await expect(a58.getByTestId('imputation-formulaire-2058-A')).toContainText('Plafond d’imputation');
    await expect(a58.getByTestId('non-prepare-formulaire-2058-A')).toContainText('feuillet séparé');
    // 2054 bis (D-112) : tableau servi par saisie, sans saisie les totaux restent en abstention.
    await expect(page.getByTestId('ecarts-reevaluation')).toBeVisible();
    await expect(page.getByTestId('lignes-2054-bis').locator('tr[data-bis]')).toHaveCount(10);
    // Détail 2052 / 2053 (D-106) : la ventilation France / exportations est qualifiée par le cabinet, jamais déduite ; renvois tracés.
    const detail = page.getByTestId('detail-resultat');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('qualifiée par le cabinet, jamais déduite');
    await expect(detail.getByTestId('ventilation-ca').locator('tr[data-ligne="CA_NET"]')).toBeVisible();
    await expect(detail.getByTestId('renvois-detail').locator('li[data-renvoi]').first()).toBeVisible();
    await expect(detail.getByTestId('renvois-non-prepares')).toContainText('exploitants individuels');
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
    // 2033-B (D-107) : « dont export » et lignes « dont » en saisie tracée, sans part France ni détail exceptionnel.
    const detailRsi = page.getByTestId('detail-resultat');
    await expect(detailRsi).toContainText('Détail du compte de résultat simplifié (2033-B)');
    await expect(detailRsi.getByTestId('renvois-detail').locator('li[data-renvoi="255"]')).toBeVisible();
    await expect(detailRsi.locator('#titre-2053')).toHaveCount(0);
    // 2033-G (D-117) : filiales et participations par saisie ligne par ligne.
    const g2033 = page.getByTestId('formulaire-2033-g');
    await expect(g2033).toBeVisible();
    await expect(g2033.getByTestId('filiales-2033-g').locator('li[data-filiale]')).toHaveCount(7);
    await expect(g2033.getByTestId('2033-g-non-prepare')).toContainText('Tableaux supplémentaires');
    // 2033-F (D-116) : composition du capital par saisie ligne par ligne ; 905 et 906 en abstention sans saisie.
    const f2033 = page.getByTestId('formulaire-2033-f');
    await expect(f2033).toBeVisible();
    await expect(f2033.getByTestId('personnes-morales-2033-f').locator('li[data-associe-pm]')).toHaveCount(4);
    await expect(f2033.getByTestId('personnes-physiques-2033-f').locator('li[data-associe-pp]')).toHaveCount(2);
    await expect(f2033.getByTestId('nombres-2033-f')).toContainText('905');
    await expect(f2033.getByTestId('2033-f-non-prepare')).toContainText('Tableaux supplémentaires');
    // 2033-E (D-115) : effectifs et valeur ajoutée par saisie ; totaux en abstention tant que toutes les composantes ne sont pas saisies.
    const e2033 = page.getByTestId('formulaire-2033-e');
    await expect(e2033).toBeVisible();
    await expect(e2033.getByTestId('groupe-2033-e-III').locator('tr[data-case-e]')).toHaveCount(10);
    await expect(e2033.getByTestId('valeur-ajoutee-2033-e')).toContainText('Valeur ajoutée assujettie à la CVAE');
    await expect(e2033.getByTestId('2033-e-non-prepare')).toContainText('024 et 016');
    // 2033-D (D-114) : cases saisies par le cabinet, total 870 et 780 en abstention sans saisie.
    const d2033 = page.getByTestId('formulaire-2033-d');
    await expect(d2033).toBeVisible();
    await expect(d2033.getByTestId('provisions-2033-d').locator('tr[data-provision]')).toHaveCount(9);
    await expect(d2033.getByTestId('derogatoires-2033-d').locator('tr[data-derogatoire]')).toHaveCount(9);
    await expect(d2033.getByTestId('total-870')).toContainText('870');
    await expect(d2033.getByTestId('2033-d-non-prepare')).toContainText('Cadre IV');
    // Cadre III du 2033-C (D-112) : dix lignes de cessions saisies par le cabinet, totaux en abstention sans saisie ni néant.
    await expect(page.getByTestId('cadre-iii')).toBeVisible();
    await expect(page.getByTestId('lignes-cessions').locator('tr[data-cession]')).toHaveCount(13);
    // Partie B (D-110) : résultat fiscal en saisie justifiée ; sans saisie, abstention explicite (jamais un résultat inventé).
    const resultatFiscal = detailRsi.getByTestId('resultat-fiscal');
    await expect(resultatFiscal).toBeVisible();
    await expect(resultatFiscal).toContainText('Aucune décision fiscale n’est prise par Comtaple');
    await expect(resultatFiscal.getByTestId('lignes-resultat-fiscal').locator(':scope > li[data-ligne-rf]')).toHaveCount(9);
    await expect(resultatFiscal.getByTestId('detail-rf-RF_330')).toContainText('Détail de la case 330');
    await expect(resultatFiscal.locator('li[data-ligne-rf="RF_248"]')).toHaveCount(1);
    await expect(resultatFiscal.getByTestId('rf-comptable')).toBeVisible();
    await expect(resultatFiscal.getByTestId('rf-avant')).toHaveAttribute('data-statut', /abstention|etabli/);
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
