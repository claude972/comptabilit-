import { genererReleveSynthetique } from '@comtaple/core';
import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, statutBff, surveiller } from '../outils';

const comptabilite = `/dossiers/${ID.dupain}/comptabilite`;
const banque = `/dossiers/${ID.dupain}/banque`;
const lots = (page: Page) => page.locator('tr[data-lot]');
const lotsSimules = async () => (await simulateur<{ lots: Array<{ id: string; type: string; statut: string; actif: boolean; motifAnnulation: string | null }> }>('suite')).lots;

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('annulation, rétablissement et reprise d’un import comptable', () => {
  test('collaboratrice : ni annulation ni rétablissement proposés ; l’API les refuse aussi', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await page.goto(comptabilite);
    await expect(lots(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Annuler l’import' })).toHaveCount(0);
    const actif = (await lotsSimules()).find((l) => l.actif)!;
    expect(await statutBff(page, 'POST', `v1/imports/${actif.id}/annulation`, { motif: 'Mauvais fichier' })).toBe(403);
  });

  test('réviseur : annulation motivée et expliquée du lot actif, statut « Annulé » avec motif, auteur et date ; le lot précédent redevient actif ; rétablissement', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    const erreurs = surveiller(page);
    await page.goto(comptabilite);
    const v2 = lots(page).filter({ hasText: 'v2' });
    const v1 = lots(page).filter({ hasText: 'v1' });
    await expect(v2).toHaveAttribute('data-actif', 'true');
    await v2.getByRole('button', { name: 'Annuler l’import' }).click();
    const panneau = v2.locator('[data-panneau="annuler"]');
    await expect(panneau.getByTestId('explication-import')).toContainText('Rien n’est supprimé');
    await expect(panneau.getByTestId('explication-import')).toContainText('réversible');
    await expect(panneau.getByTestId('explication-import')).toContainText('le lot précédent encore valable redevient actif');
    await expect(panneau.getByTestId('explication-import')).toContainText('à revoir');
    // Motif obligatoire : rien n'est envoyé sans lui.
    await panneau.getByRole('button', { name: 'Confirmer l’annulation' }).click();
    await expect(v2.getByRole('alert')).toContainText('Le motif est obligatoire');
    expect((await lotsSimules()).filter((l) => l.statut === 'annule')).toHaveLength(0);
    // Renoncer ne change rien.
    await panneau.getByRole('button', { name: 'Renoncer' }).click();
    await expect(v2.locator('[data-panneau]')).toHaveCount(0);
    await v2.getByRole('button', { name: 'Annuler l’import' }).click();
    await v2.getByLabel('Motif de l’annulation (obligatoire)').fill('Fichier d’un autre exercice <b>importé</b> par erreur');
    await v2.getByRole('button', { name: 'Confirmer l’annulation' }).click();

    await expect(v2).toHaveAttribute('data-statut', 'annule');
    await expect(v2).toHaveAttribute('data-actif', 'false');
    const trace = v2.getByTestId('trace-annulation');
    await expect(trace).toContainText('Annulé le ');
    await expect(trace).toContainText('par Rémi Réviseur');
    await expect(trace).toContainText('motif : Fichier d’un autre exercice <b>importé</b> par erreur'); // texte brut
    await expect(trace).toContainText('Rien n’a été supprimé : cet import peut être rétabli.');
    await expect(v2).toContainText('Import annulé. Rien n’a été supprimé');
    // Le lot actif reste clairement identifié : c'est maintenant la version précédente.
    await expect(v1).toHaveAttribute('data-actif', 'true');
    await expect(v1).toContainText('Lot actif');
    await expect(page.locator('tr[data-actif="true"]')).toHaveCount(1);
    await expect(page.getByTestId('sans-donnees-actives')).toHaveCount(0);
    await expect(v2.getByRole('button', { name: 'Annuler l’import' })).toHaveCount(0);

    // Annuler aussi la version 1 : l'exercice n'a plus de données actives, et c'est dit.
    await v1.getByRole('button', { name: 'Annuler l’import' }).click();
    await expect(v1.getByTestId('explication-import')).toContainText('s’il n’y en a pas, l’exercice n’a plus de données actives');
    await v1.getByLabel('Motif de l’annulation (obligatoire)').fill('Extraction incomplète');
    await v1.getByRole('button', { name: 'Confirmer l’annulation' }).click();
    await expect(page.getByTestId('sans-donnees-actives')).toContainText('Cet exercice n’a plus de données comptables actives');
    await expect(page.getByTestId('sans-donnees-actives')).toContainText('Rien n’a été supprimé');
    await expect(page.locator('tr[data-actif="true"]')).toHaveCount(0);

    // Rétablissement motivé de la version 2 : elle redevient le lot actif.
    await v2.getByRole('button', { name: 'Rétablir' }).click();
    await expect(v2.getByTestId('explication-import')).toContainText('redevient le lot actif de son exercice');
    await v2.getByLabel('Motif du rétablissement (obligatoire)').fill('Vérification faite : c’était le bon fichier');
    await v2.getByRole('button', { name: 'Confirmer le rétablissement' }).click();
    await expect(v2).toHaveAttribute('data-actif', 'true');
    await expect(v2).toContainText('Import rétabli.');
    await expect(v2.getByTestId('trace-annulation')).toHaveCount(0);
    await expect(page.getByTestId('sans-donnees-actives')).toHaveCount(0);
    expect(await statutBff(page, 'POST', `v1/imports/${(await lotsSimules()).find((l) => l.actif)!.id}/retablissement`, { motif: 'pas annulé' })).toBe(409);
    expect(erreurs).toEqual([]);
  });

  test('import en échec : « Reprendre » pour la collaboratrice ; le réviseur peut l’annuler mais pas le rétablir', async ({ browser }) => {
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto(comptabilite);
    await chloe.getByTestId('entree-fec').setInputFiles({ name: 'fichier-illisible.txt', mimeType: 'text/plain', buffer: Buffer.from('ceci n’est pas un fichier d’écritures') });
    await chloe.getByRole('radio', { name: 'FEC', exact: true }).check();
    await chloe.getByRole('button', { name: 'Importer' }).click();
    const echec = lots(chloe).filter({ hasText: 'fichier-illisible.txt' });
    await expect(echec).toContainText('Échec', { timeout: 20_000 });
    await expect(chloe.locator('tr[data-actif="true"]')).toContainText('v2'); // les données actives n'ont pas bougé
    const reprise = chloe.waitForResponse((r) => r.url().endsWith('/reprise'));
    await echec.getByRole('button', { name: 'Reprendre' }).click();
    expect((await reprise).status()).toBe(202);
    await expect(echec).toContainText('Reprise demandée : le même fichier est traité à nouveau');
    await expect(echec).toContainText('Échec', { timeout: 20_000 }); // même fichier, même issue
    expect((await lotsSimules()).filter((l) => l.type === 'fec')).toHaveLength(3); // rien n'a été dupliqué

    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto(comptabilite);
    const ligne = lots(remi).filter({ hasText: 'fichier-illisible.txt' });
    await ligne.getByRole('button', { name: 'Annuler l’import' }).click();
    await expect(ligne.getByTestId('explication-import')).toContainText('Cet import n’a pas abouti');
    await ligne.getByLabel('Motif de l’annulation (obligatoire)').fill('Fichier inutilisable');
    await ligne.getByRole('button', { name: 'Confirmer l’annulation' }).click();
    await expect(ligne.getByTestId('trace-annulation')).toContainText('Annulé avant d’aboutir : il peut être repris, pas rétabli.');
    await expect(ligne.getByRole('button', { name: 'Rétablir' })).toHaveCount(0);
    await expect(ligne.getByRole('button', { name: 'Reprendre' })).toBeVisible();
  });
});

test.describe('annulation et rétablissement d’un relevé bancaire', () => {
  test('réviseur : mouvements écartés puis rétablis, explication propre aux relevés', async ({ browser }) => {
    const releve = genererReleveSynthetique({ graine: 7, format: 'camt.053', debut: '2025-01-01', fin: '2025-12-31', nbMouvements: 12 });
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto(banque);
    await chloe.getByTestId('entree-releve').setInputFiles({ name: releve.nomFichier, mimeType: 'application/xml', buffer: Buffer.from(releve.contenu) });
    const importChloe = chloe.getByTestId('imports-releves').getByRole('listitem').first();
    await expect(importChloe).toContainText(`${releve.attendu.nbMouvements} mouvements lus`, { timeout: 20_000 });
    await expect(importChloe.getByRole('button', { name: 'Annuler l’import' })).toHaveCount(0); // révision requise

    const page = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await page.goto(banque);
    const titre = page.getByRole('heading', { name: /Mouvements bancaires/ });
    await expect(titre).toContainText(`${releve.attendu.nbMouvements} au total`);
    const ligne = page.getByTestId('imports-releves').getByRole('listitem').first();
    await ligne.getByRole('button', { name: 'Annuler l’import' }).click();
    await expect(ligne.getByTestId('explication-import')).toContainText('Rien n’est supprimé');
    await expect(ligne.getByTestId('explication-import')).toContainText('sauf ceux qui figurent aussi dans un autre relevé actif');
    await ligne.getByLabel('Motif de l’annulation (obligatoire)').fill('Relevé d’un autre compte');
    await ligne.getByRole('button', { name: 'Confirmer l’annulation' }).click();
    await expect(ligne).toHaveAttribute('data-statut', 'annule');
    await expect(ligne).toContainText('Annulé');
    await expect(ligne.getByTestId('trace-annulation')).toContainText('par Rémi Réviseur — motif : Relevé d’un autre compte');
    await expect(titre).toContainText('0 au total');
    await expect(page.getByText('Aucun relevé lu.')).toBeVisible();
    await ligne.getByRole('button', { name: 'Rétablir' }).click();
    await ligne.getByLabel('Motif du rétablissement (obligatoire)').fill('Relevé finalement correct');
    await ligne.getByRole('button', { name: 'Confirmer le rétablissement' }).click();
    await expect(titre).toContainText(`${releve.attendu.nbMouvements} au total`);
    await expect(ligne.getByTestId('trace-annulation')).toHaveCount(0);
  });
});
