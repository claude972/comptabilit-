import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, simulateur, statutBff, surveiller } from '../outils';

const inventaire = `/dossiers/${ID.dupain}/inventaire`;
const F = ' '; // espace fine insécable des montants

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

async function saisir(page: Page, credit: string) {
  const f = page.locator('form[data-formulaire="proposer-ecriture"]');
  await f.getByLabel('Date de l’écriture (dans l’exercice)').fill('2025-12-31');
  await f.getByLabel('Libellé', { exact: true }).fill('Facture non parvenue — fournitures');
  await f.getByLabel('Justification (pourquoi cette écriture)').fill('Livraison du 18 décembre reçue, facture non parvenue à la clôture.');
  await f.getByLabel('Calcul (détail du montant)').fill('Bon de livraison : 1 200,00 € HT');
  await f.getByLabel('Compte (ligne 1)', { exact: true }).fill('6061');
  await f.getByLabel('Libellé du compte (ligne 1)').fill('Fournitures non stockables');
  await f.getByLabel('Débit (ligne 1)').fill('1 200,00');
  await f.getByLabel('Compte (ligne 2)', { exact: true }).fill('408');
  await f.getByLabel('Libellé du compte (ligne 2)').fill('Fournisseurs — factures non parvenues');
  await f.getByLabel('Crédit (ligne 2)').fill(credit);
  return f;
}

test.describe('écritures d’inventaire', () => {
  test.use({ storageState: etatDe('chloe') });

  test('proposition : totaux au fil de la saisie sans flottant, écart renvoyé par l’API, projet sans effet ; approbation par une autre personne ; balance ajustée ; export', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Inventaire' }).click();
    await expect(page.getByText('Aucune écriture d’inventaire proposée pour cet exercice.')).toBeVisible();
    await expect(page.getByTestId('ecritures-prises-en-compte')).toContainText('Aucune : seules les écritures approuvées comptent');

    // Totaux additionnés en centimes entiers : 0,1 + 0,2 = 0,30 exactement.
    const f = page.locator('form[data-formulaire="proposer-ecriture"]');
    await f.getByLabel('Débit (ligne 1)').fill('0,1');
    await f.getByLabel('Débit (ligne 2)').fill('0,2');
    await expect(f.getByTestId('total-debit')).toHaveText('0,30');
    await f.getByLabel('Débit (ligne 2)').fill('abc');
    await expect(f.getByTestId('totaux-saisie')).toContainText('1 montant(s) illisible(s)');
    await f.getByLabel('Débit (ligne 2)').fill('');

    await saisir(page, '1199,99');
    await expect(f.getByTestId('total-debit')).toHaveText(`1${F}200,00`);
    await expect(f.getByTestId('total-credit')).toHaveText(`1${F}199,99`);
    await expect(f.getByTestId('ecart-saisie')).toHaveText('0,01');
    await expect(f.getByTestId('totaux-saisie')).toHaveAttribute('data-equilibre', 'false');
    // L'écran ne bloque pas un déséquilibre : c'est l'API qui refuse et renvoie SON calcul de l'écart.
    await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
    await expect(f.getByTestId('refus-api')).toContainText('Écriture déséquilibrée');
    await expect(f.getByTestId('ecart-api')).toHaveText(`Calcul du serveur — total débit : 1${F}200,00 · total crédit : 1${F}199,99 · écart : 0,01`);
    expect((await etatSuite()).ecritures).toEqual([]);

    await f.getByLabel('Crédit (ligne 2)').fill('1200');
    await expect(f.getByTestId('totaux-saisie')).toContainText('équilibrée');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/ecritures-inventaire'));
    await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
    expect((await envoi).postDataJSON().lignes).toEqual([
      { compteNum: '6061', compteLib: 'Fournitures non stockables', debit: '1200.00', credit: '0.00' },
      { compteNum: '408', compteLib: 'Fournisseurs — factures non parvenues', debit: '0.00', credit: '1200.00' },
    ]);
    const ecriture = page.locator('[data-ecriture]');
    await expect(ecriture).toHaveAttribute('data-statut', 'proposee');
    await expect(ecriture).toContainText('Projet — sans effet');
    await expect(ecriture).toContainText('La décision est réservée au niveau « Révision » sur ce dossier.');
    // Aucun effet tant qu'elle n'est pas approuvée.
    await expect(page.getByTestId('variation-resultat')).toHaveText('0,00');
    await expect(page.getByText('L’export est réservé au niveau « Révision » sur ce dossier.')).toBeVisible();
    const id = (await etatSuite()).ecritures[0]!.id;
    expect(await statutBff(page, 'POST', `v1/ecritures-inventaire/${id}/decision`, { decision: 'approuver' })).toBe(403);

    // Approbation par le réviseur (autre personne que l'auteure).
    const remi = await (await browser.newContext({ storageState: etatDe('remi'), acceptDownloads: true })).newPage();
    await remi.goto(`http://localhost:3000${inventaire}`);
    await expect(remi.getByText('Aucune écriture approuvée à exporter pour l’instant.')).toBeVisible();
    await remi.locator(`[data-ecriture="${id}"]`).getByRole('button', { name: 'Approuver' }).click();
    await expect(remi.locator(`[data-ecriture="${id}"]`)).toHaveAttribute('data-statut', 'approuvee');
    await expect(remi.getByTestId('mention-balance-ajustee')).toContainText('PROJET — balance de travail');
    await expect(remi.getByTestId('ecritures-prises-en-compte')).toContainText('Écritures prises en compte (1)');
    await expect(remi.getByTestId('ecritures-prises-en-compte')).toContainText(`31/12/2025 — Facture non parvenue — fournitures : 1${F}200,00 (approuvée)`);
    await expect(remi.getByTestId('variation-resultat')).toHaveText(`−1${F}200,00`); // une charge de plus
    const modifies = remi.getByRole('region', { name: 'Comptes modifiés par les écritures d’inventaire' });
    await expect(modifies.locator('tr[data-compte]')).toHaveCount(2);
    await expect(modifies.locator('tr[data-compte="6061"]')).toContainText('absent'); // absent de la balance importée
    await expect(modifies.locator('tr[data-compte="408"] td').nth(3)).toHaveText(`1${F}200,00`);

    // Export : un fichier est remis, les écritures passent « exportées » ; exporter n'est pas intégrer.
    await expect(remi.getByTestId('phrase-export')).toHaveText('Exporter n’est pas intégrer : vous importez vous-même ce fichier dans votre logiciel comptable.');
    const telechargement = remi.waitForEvent('download');
    await remi.getByRole('button', { name: 'Exporter les écritures approuvées (CSV)' }).click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toBe(`ecritures-inventaire-${ID.exDupain}.csv`);
    const lignes = readFileSync(await fichier.path(), 'utf8').trim().split('\r\n');
    expect(lignes[0]).toBe('JournalCode;EcritureNum;EcritureDate;CompteNum;CompteLib;EcritureLib;Debit;Credit');
    expect(lignes[1]).toMatch(/^INV;INV-[0-9a-f]{8};20251231;6061;Fournitures non stockables;.*;1200,00;0,00$/);
    expect(lignes).toHaveLength(3);
    await expect(remi.locator(`[data-ecriture="${id}"]`)).toHaveAttribute('data-statut', 'exportee');
    await expect(remi.locator(`[data-ecriture="${id}"]`)).toContainText('intégration non réalisée par Comtaple');

    // Les données importées changent : l'écriture est « à revoir » et sort de la balance ajustée.
    await simulateur('administration', { exercice: { versionDonnees: 3 } });
    await remi.reload();
    await expect(remi.locator(`[data-ecriture="${id}"]`).getByTestId('a-revoir')).toBeVisible();
    await expect(remi.getByTestId('ecritures-ecartees')).toContainText('1 écriture(s) approuvée(s) écartée(s) car les données importées ont changé');
    await expect(remi.getByTestId('ecritures-prises-en-compte')).toContainText('Écritures prises en compte (0)');
    await remi.context().close();
    expect(erreurs).toEqual([]);
  });
});

test.describe('écritures d’inventaire — décision', () => {
  test.use({ storageState: etatDe('remi') });

  test('l’auteur ne décide pas de sa propre écriture ; rejet avec motif obligatoire ; refusé au déposant', async ({ page, browser }) => {
    await page.goto(inventaire);
    const f = await saisir(page, '1200,00');
    await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
    const ecriture = page.locator('[data-ecriture]');
    await expect(ecriture.getByTestId('decision-auteur')).toContainText('une autre personne habilitée en révision doit l’approuver ou la rejeter');
    await expect(ecriture.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
    const id = (await etatSuite()).ecritures[0]!.id;
    expect(await statutBff(page, 'POST', `v1/ecritures-inventaire/${id}/decision`, { decision: 'approuver' })).toBe(403);

    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto(`http://localhost:3000${inventaire}`);
    const chezAlice = alice.locator(`[data-ecriture="${id}"]`);
    await chezAlice.getByRole('button', { name: 'Rejeter' }).click();
    await chezAlice.getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(chezAlice.getByRole('alert')).toContainText('Un motif est requis pour rejeter.');
    await chezAlice.getByLabel('Motif du rejet (obligatoire)').fill('Doublon <b>à supprimer</b>');
    await chezAlice.getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(chezAlice).toHaveAttribute('data-statut', 'rejetee');
    await expect(chezAlice).toContainText('motif : Doublon <b>à supprimer</b>'); // texte brut
    await expect(alice.getByTestId('ecritures-prises-en-compte')).toContainText('(0)'); // une écriture rejetée ne compte pas
    await alice.context().close();

    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto(`http://localhost:3000${inventaire}`);
    await expect(client.getByTestId('erreur-403')).toBeVisible();
    expect(await statutBff(client, 'GET', `v1/exercices/${ID.exDupain}/ecritures-inventaire`)).toBe(404);
    await client.context().close();
  });
});
