/**
 * Parcours banque, rapprochement et administration sur la pile RÉELLE (web 3100, API, worker, Keycloak, base).
 * Rejouable : chaque exécution crée un dossier NEUF par l'interface d'administration (les mouvements bancaires
 * s'accumulent par dossier). FEC et relevé sont des jeux SYNTHÉTIQUES cohérents entre eux, produits par @comtaple/core.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type LigneFec, analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique } from '@comtaple/core';
import { type Browser, type Page, devices, expect, test } from '@playwright/test';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}
async function ouvrir(browser: Browser, email: string, destination: string): Promise<Page> {
  const contexte = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } });
  const page = await contexte.newPage();
  await page.goto(destination);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  return page;
}

const SEL = randomBytes(4).toString('hex').toUpperCase();
const NOM = `Essai web ${SEL} SARL (fictif)`;
const graine = Number.parseInt(SEL.slice(0, 6), 16);
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine, anomalies: ['caisse_crediteur', 'attente_non_solde'] });
let releve: ReturnType<typeof genererReleveSynthetique>;
let dossier = '';
const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
  releve = genererReleveSynthetique({ graine, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 5000, coherentAvec: lignes });
});

test('administration : création d’un dossier, habilitations et ouverture de l’exercice par l’interface', async ({ browser }) => {
  const page = await ouvrir(browser, 'alice.admin@cabinet-a.test', '/administration');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Administration du cabinet');
  await expect(page.locator('tr[data-membre]').filter({ hasText: 'Rémi Réviseur' })).toContainText('Réviseur');
  await expect(page.getByTestId('integrite-audit')).toContainText('Chaîne intacte');

  const creation = page.locator('form[data-formulaire="creer-dossier"]');
  await expect(creation.getByLabel('Territoire fiscal (obligatoire)')).toHaveValue('');
  await creation.getByLabel('Raison sociale').fill(NOM);
  await creation.getByLabel('Forme juridique').fill('SARL');
  await creation.getByLabel('Régime fiscal').fill('IS');
  await creation.getByLabel('Territoire fiscal (obligatoire)').selectOption('metropole');
  await creation.getByRole('button', { name: 'Créer le dossier' }).click();
  const cree = page.getByTestId('dossier-cree');
  await expect(cree).toContainText('Vous n’êtes pas habilité sur ce dossier');
  await cree.getByRole('link', { name: 'Ouvrir la fiche d’administration du dossier' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOM);
  dossier = /\/administration\/dossiers\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.getByTestId('non-habilite')).toBeVisible();
  await expect(page.getByTestId('exercice-impossible')).toBeVisible();

  const ligne = (id: string) => page.locator(`tr[data-membre="${id}"]`);
  await ligne(ALICE).getByRole('combobox').selectOption('collaboration');
  await ligne(ALICE).getByRole('button', { name: /Enregistrer l’habilitation/ }).click();
  await expect(ligne(ALICE)).toContainText('cette attribution est journalisée');
  await ligne(REMI).getByRole('combobox').selectOption('revision');
  await ligne(REMI).getByRole('button', { name: /Enregistrer l’habilitation/ }).click();
  await expect(ligne(REMI)).toContainText('Habilitation enregistrée.');
  await expect(ligne(REMI).locator('td').nth(1)).toContainText('Révision');

  const exercice = page.locator('form[data-formulaire="ouvrir-exercice"]');
  await exercice.getByLabel('Début de l’exercice').fill(EXERCICE.debut);
  await exercice.getByLabel('Fin de l’exercice').fill(EXERCICE.fin);
  await exercice.getByRole('button', { name: 'Ouvrir l’exercice' }).click();
  await expect(page.getByTestId('exercices')).toContainText('Du 01/01/2025 au 31/12/2025');

  // Le journal d'audit réel a tracé la création et l'habilitation que l'administratrice s'est accordée.
  await page.goto('/administration');
  const audit = page.getByRole('region', { name: 'Dernières lignes du journal d’audit' });
  await expect(audit.getByRole('row').filter({ hasText: 'habilitation.accordee' }).filter({ hasText: 'pourSoiMeme : true' }).first()).toContainText('Alice Admin');
  await expect(audit.getByRole('row').filter({ hasText: 'dossier.cree' }).first()).toBeVisible();
  await page.context().close();
});

test('comptabilité puis banque : FEC et relevé camt.053 importés par l’interface, cadrage « Cadré »', async ({ browser }) => {
  const page = await ouvrir(browser, 'remi.reviseur@cabinet-a.test', `/dossiers/${dossier}/comptabilite`);
  await page.getByTestId('entree-fec').setInputFiles({ name: fec.nomFichier, mimeType: 'text/plain', buffer: Buffer.from(fec.contenu) });
  await page.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
  await page.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 90_000 });
  await expect(page.locator('tr[data-actif="true"]')).toContainText('v1');

  await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Banque' }).click();
  await expect(page.getByText('cela ne dépend d’aucune connexion bancaire')).toBeVisible();
  await page.getByTestId('entree-releve').setInputFiles({ name: releve.nomFichier, mimeType: 'application/xml', buffer: Buffer.from(releve.contenu, 'utf8') });
  await expect(page.getByTestId('liste-envois').getByRole('listitem')).toContainText('Reçu', { timeout: 60_000 });
  const lot = page.getByTestId('imports-releves').getByRole('listitem').first();
  const n = releve.attendu.nbMouvements;
  await expect(lot).toContainText(new RegExp(`${n.toLocaleString('fr-FR').replace(/\s/g, '\\s')} mouvements? lus? · ${n.toLocaleString('fr-FR').replace(/\s/g, '\\s')} nouveaux?`), { timeout: 90_000 });
  const ligne = page.locator('tr[data-releve]');
  await expect(ligne).toHaveCount(1);
  await expect(ligne.locator('[data-cadrage="ok"]')).toHaveText('Cadré');
  await expect(ligne).toContainText(`•••• ${releve.attendu.iban.slice(-4)}`);
  expect(await page.content()).not.toContain(releve.attendu.iban);
  await expect(page.getByRole('heading', { name: new RegExp(`Mouvements bancaires \\(${n.toLocaleString('fr-FR').replace(/\s/g, '\\s')} au total\\)`) })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mouvements bancaires importés' }).locator('tbody tr').first()).toContainText(/\d{2}\/\d{2}\/2025/);
  await page.context().close();
});

test('rapprochement : lancement, une proposition validée et une rejetée avec motif par le réviseur', async ({ browser }) => {
  const page = await ouvrir(browser, 'remi.reviseur@cabinet-a.test', `/dossiers/${dossier}/banque`);
  await expect(page.getByTestId('mention-proposition')).toContainText('valider ne modifie aucune écriture dans votre logiciel comptable');
  await page.locator('form[data-formulaire="lancer-rapprochement"]').getByRole('button', { name: 'Lancer le rapprochement' }).click();
  const synthese = page.getByTestId('synthese-rapprochement');
  await expect(synthese).toBeVisible({ timeout: 120_000 });
  await expect(synthese).toContainText(/Propositions : [1-9]\d*/);
  await expect(page.locator('[data-proposition]').first()).toContainText(/Débit [\d\s  ]+,\d{2} · Crédit [\d\s  ]+,\d{2}/);
  const [id1, id2] = [await page.locator('[data-proposition]').nth(0).getAttribute('data-proposition'), await page.locator('[data-proposition]').nth(1).getAttribute('data-proposition')];
  const prop = (id: string | null) => page.locator(`[data-proposition="${id}"]`);
  await prop(id1).getByRole('button', { name: 'Valider' }).click();
  await expect(prop(id1)).toHaveAttribute('data-statut', 'valide', { timeout: 20_000 });
  await prop(id2).getByRole('button', { name: 'Rejeter' }).click();
  await prop(id2).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(prop(id2).getByRole('alert')).toContainText('Un motif est requis');
  await prop(id2).getByLabel('Motif du rejet (obligatoire)').fill(`Rejet d’essai ${SEL}`);
  await prop(id2).getByRole('button', { name: 'Confirmer le rejet' }).click();
  await expect(prop(id2)).toHaveAttribute('data-statut', 'rejete', { timeout: 20_000 });
  await expect(prop(id2)).toContainText(`Motif du rejet : Rejet d’essai ${SEL}`);
  // Après rechargement, les décisions viennent bien du serveur.
  await page.reload();
  await expect(synthese).toContainText('Validées : 1');
  await expect(synthese).toContainText('Rejetées : 1');
  await page.context().close();
});

test('révision : ouverture réelle d’un constat (écritures concernées lues depuis la vraie API)', async ({ browser }) => {
  const page = await ouvrir(browser, 'remi.reviseur@cabinet-a.test', `/dossiers/${dossier}/revision`);
  // Les contrôles sont lancés par le worker après l'import : on attend leurs constats.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('liste-constats').getByRole('listitem').first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000, intervals: [3_000] });
  // Parmi les constats réels (anomalies injectées dans le FEC synthétique), on ouvre le premier qui porte des écritures.
  const constats = page.getByTestId('liste-constats').getByRole('listitem');
  let ouvert = false;
  for (let i = 0; i < Math.min(await constats.count(), 12) && !ouvert; i++) {
    await constats.nth(i).getByRole('link').click();
    await expect(page.getByRole('heading', { name: 'Explication' })).toBeVisible();
    if (await page.getByRole('region', { name: 'Écritures concernées par le constat' }).count()) ouvert = true;
    else await page.goBack();
  }
  expect(ouvert).toBe(true);
  const lignes = page.getByRole('region', { name: 'Écritures concernées par le constat' }).locator('tbody tr');
  await expect(lignes.first()).toBeVisible();
  const cellules = await lignes.first().locator('td').allInnerTexts();
  expect(cellules[0]).toMatch(/^\d+$/); // n° de ligne du fichier
  expect(cellules[1]).toMatch(/^\d{2}\/\d{2}\/20\d{2}$/); // date d'écriture
  expect(cellules[2]!.trim().length).toBeGreaterThan(0); // journal
  expect(cellules[7]).toMatch(/^[\d\s  ]+,\d{2}$/); // débit
  expect(cellules[8]).toMatch(/^[\d\s  ]+,\d{2}$/); // crédit
  await expect(page.getByTestId('source-regle')).toBeVisible();
  // « Affecter » : la liste vient de GET v1/dossiers/:id/membres (personnes réellement habilitées sur ce dossier).
  const f = page.locator('form[data-formulaire="constat"]');
  await f.getByLabel('Action').selectOption('affecter');
  await expect(f.getByLabel('Affecter à').locator('option')).toHaveText(['Choisir une personne habilitée…', 'Alice Admin', 'Rémi Réviseur']);
  await page.context().close();
});

test('cloisonnement : l’onglet Banque est refusé à une personne non habilitée sur le dossier', async ({ browser }) => {
  const page = await ouvrir(browser, 'chloe.collab@cabinet-a.test', `/dossiers/${dossier}/banque`);
  await expect(page.getByRole('heading', { name: /Accès refusé|Introuvable/ })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Mouvements bancaires');
  expect(await page.evaluate(async (id) => (await fetch(`/api/bff/v1/dossiers/${id}/banque`)).status, dossier)).toBe(404);
  expect(await page.evaluate(async (id) => (await fetch(`/api/bff/v1/dossiers/${id}/banque/mouvements`)).status, dossier)).toBe(404);
  await page.context().close();
});
