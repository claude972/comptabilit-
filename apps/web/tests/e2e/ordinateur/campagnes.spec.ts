import { genererFecSynthetique } from '@comtaple/core';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, statutBff, surveiller } from '../outils';

const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 80, graine: 77 });
const ouvrir = async (browser: Browser, qui: 'chloe' | 'remi' | 'alice' | 'client', chemin: string) => {
  const page = await (await browser.newContext({ storageState: etatDe(qui) })).newPage();
  await page.goto(chemin);
  return page;
};
const suite = () => simulateur<{ campagnes: Array<{ id: string; libelle: string; statut: string; type: string }>; lots: Array<{ id: string; entiteId: string; statut: string; actif: boolean; campagneId: string | null }> }>('suite');

async function creer(page: Page, libelle: string, type: 'Import comptable' | 'Relevés bancaires') {
  const f = page.locator('form[data-formulaire="creer-campagne"]');
  await f.getByLabel('Libellé de la campagne').fill(libelle);
  await f.getByRole('radio', { name: type }).check();
  await f.getByRole('button', { name: 'Ouvrir la campagne' }).click();
  await expect(page.getByRole('heading', { level: 1, name: libelle })).toBeVisible();
}
async function deposer(page: Page, dossier: string, nom: string, contenu: Uint8Array | string) {
  const f = page.locator('form[data-formulaire="depot-campagne"]');
  await f.getByLabel('Dossier (parmi ceux où vous êtes habilité en collaboration)').selectOption({ label: dossier });
  await expect(f.getByLabel('Exercice')).toBeEnabled();
  await f.getByRole('radio', { name: 'FEC', exact: true }).check();
  await f.getByTestId('entree-campagne').setInputFiles({ name: nom, mimeType: 'text/plain', buffer: Buffer.from(contenu) });
  await f.getByRole('button', { name: 'Déposer pour ce dossier' }).click();
}

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('campagnes d’import', () => {
  test('navigation et accès : lien pour les membres du cabinet, rien pour un client déposant', async ({ browser }) => {
    const client = await ouvrir(browser, 'client', '/deposer');
    await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Campagnes d’import' })).toHaveCount(0);
    await client.goto('/campagnes');
    await expect(client.getByTestId('erreur-403')).toBeVisible();
    expect(await statutBff(client, 'POST', 'v1/campagnes', { libelle: 'x', type: 'fec' })).toBe(403);
    const chloe = await ouvrir(browser, 'chloe', '/');
    await chloe.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Campagnes d’import' }).click();
    await expect(chloe.getByRole('heading', { level: 1, name: 'Campagnes d’import' })).toBeVisible();
    await expect(chloe.getByTestId('phrase-isolement')).toContainText('Chaque dossier est traité séparément : l’échec de l’un n’affecte pas les autres.');
    await expect(chloe.getByText('Aucune campagne d’import pour ce cabinet.')).toBeVisible();
    // Formulaire : libellé et type obligatoires.
    const creation = chloe.locator('form[data-formulaire="creer-campagne"]');
    await creation.getByRole('button', { name: 'Ouvrir la campagne' }).click();
    await expect(creation.getByRole('alert')).toContainText('Indiquez le libellé');
    await creation.getByLabel('Libellé de la campagne').fill('Balances');
    await creation.getByRole('button', { name: 'Ouvrir la campagne' }).click();
    await expect(creation.getByRole('alert')).toContainText('Choisissez le type');
    expect((await suite()).campagnes).toHaveLength(0);
  });

  test('réviseur : deux dossiers déposés à la suite, un succès et un échec isolés ; suivi, synthèse, reprise des échecs, clôture, annulation motivée', async ({ browser }) => {
    // Rémi est habilité en révision sur les deux dossiers ; l'exercice 2025 du garage Martin existe déjà dans le jeu de démonstration.
    const page = await ouvrir(browser, 'remi', '/campagnes');
    const erreurs = surveiller(page);
    await creer(page, 'Balances 2025 <b>cabinet</b>', 'Import comptable');
    await expect(page.locator('h1 b')).toHaveCount(0); // libellé en texte brut
    await expect(page.getByTestId('phrase-isolement')).toContainText('Chaque dossier est traité séparément : l’échec de l’un n’affecte pas les autres.');
    await expect(page.getByTestId('synthese-campagne')).toContainText('Aucun fichier déposé');
    await expect(page.getByRole('button', { name: 'Annuler la campagne' })).toBeDisabled();
    const options = page.getByLabel('Dossier (parmi ceux où vous êtes habilité en collaboration)').getByRole('option');
    await expect(options).toHaveText(['Choisir un dossier…', 'Boulangerie Dupain SAS (fictive)', 'Garage Martin SARL (fictif)']);
    // Rien n'est présumé : dossier, statut des données et fichier sont exigés.
    await page.getByRole('button', { name: 'Déposer pour ce dossier' }).click();
    await expect(page.locator('form[data-formulaire="depot-campagne"]').getByRole('alert')).toContainText('Choisissez le dossier');

    await deposer(page, 'Garage Martin SARL (fictif)', fec.nomFichier, fec.contenu);
    await deposer(page, 'Boulangerie Dupain SAS (fictive)', 'export-illisible.txt', 'ceci n’est pas un fichier d’écritures');
    const envois = page.getByTestId('liste-envois').getByRole('listitem');
    await expect(envois).toHaveCount(2); // les deux dépôts restent affichés, sans quitter la page
    await expect(envois.nth(0)).toContainText('Garage Martin SARL (fictif) — fichier reçu');
    await expect(envois.nth(1)).toContainText('Boulangerie Dupain SAS (fictive) — fichier reçu');
    await expect(page.getByTestId('synthese-campagne').getByRole('status')).toContainText('en cours de traitement'); // suivi rafraîchi tant que des imports sont en cours

    const martin = page.locator(`tr[data-dossier="${ID.martin}"]`);
    const dupain = page.locator(`tr[data-dossier="${ID.dupain}"]`);
    await expect(martin).toHaveAttribute('data-statut', /^termine/, { timeout: 30_000 });
    await expect(dupain).toHaveAttribute('data-statut', 'echec', { timeout: 30_000 });
    await expect(martin).toContainText(fec.nomFichier);
    await expect(martin.locator('[data-indicateur="Lisible"]')).toHaveText('Lisible : oui');
    await expect(martin.locator('[data-indicateur="Suffisant"]')).toHaveText('Suffisant : oui');
    await expect(martin).toContainText('Lot actif');
    await expect(dupain.locator('[data-indicateur="Lisible"]')).toHaveText('Lisible : non');
    await expect(dupain).toContainText('Fichier illisible');
    await expect(page.locator('[data-synthese="echec"]')).toHaveText('Échec : 1');
    await expect(page.getByTestId('synthese-campagne')).toContainText('Synthèse (2 imports dans vos dossiers)');
    await expect(page.getByTestId('synthese-campagne').getByRole('status')).toHaveCount(0); // plus rien en cours : plus d'actualisation
    await expect(page.getByTestId('hors-habilitation')).toHaveCount(0);
    // L'échec de Dupain n'a touché ni ses données actives ni l'import de Martin.
    const lots = (await suite()).lots;
    expect(lots.filter((l) => l.entiteId === ID.dupain && l.actif)).toHaveLength(1);
    expect(lots.find((l) => l.entiteId === ID.dupain && l.actif)!.campagneId).toBeNull();
    expect(lots.find((l) => l.entiteId === ID.martin)).toMatchObject({ actif: true });

    const actions = page.getByTestId('actions-campagne');
    await actions.getByRole('button', { name: 'Reprendre les échecs (1)' }).click();
    await expect(actions.getByTestId('compte-rendu-campagne')).toContainText('1 import(s) en échec repris');
    await expect(dupain).toHaveAttribute('data-statut', 'echec', { timeout: 30_000 });

    await actions.getByRole('button', { name: 'Clore la campagne' }).click();
    await expect(actions.locator('[data-panneau="clore"]')).toContainText('n’accepte plus de fichiers');
    await actions.getByRole('button', { name: 'Confirmer la clôture' }).click();
    await expect(page.getByTestId('entete-campagne')).toHaveAttribute('data-statut', 'close');
    await expect(page.getByTestId('campagne-fermee')).toContainText('Cette campagne est close');
    await expect(page.getByTestId('depot-campagne')).toHaveCount(0);
    const campagneId = (await suite()).campagnes[0]!.id;
    expect(await statutBff(page, 'POST', 'v1/televersements', { entiteId: ID.martin, nomFichier: 'x.txt', taille: 5, sha256: 'b'.repeat(64), canal: 'ordinateur', usage: 'fec', exerciceId: 'aaaaaaaa-0000-4000-8000-0000000000f2', statutDonnees: 'fec', campagneId })).toBe(409);

    await actions.getByRole('button', { name: 'Annuler la campagne' }).click();
    const explication = actions.getByTestId('explication-campagne');
    await expect(explication).toContainText('chaque import reste rétablissable individuellement');
    await expect(explication).toContainText('Seuls les dossiers où vous êtes habilité en révision sont concernés');
    await actions.getByRole('button', { name: 'Confirmer l’annulation de la campagne' }).click();
    await expect(actions.getByRole('alert')).toContainText('Le motif est obligatoire');
    expect((await suite()).campagnes[0]!.statut).toBe('close');
    await actions.getByLabel('Motif de l’annulation (obligatoire)').fill('Mauvaise période exportée pour toute la campagne');
    await actions.getByRole('button', { name: 'Confirmer l’annulation de la campagne' }).click();
    await expect(actions.getByTestId('compte-rendu-campagne')).toHaveText('2 import(s) annulé(s). Aucun import laissé en place faute d’habilitation. Chaque import annulé reste rétablissable individuellement.');
    await expect(page.getByTestId('entete-campagne')).toHaveAttribute('data-statut', 'annulee');
    await expect(martin).toHaveAttribute('data-statut', 'annule');
    // Chaque import reste rétablissable depuis son dossier.
    await martin.getByRole('link', { name: 'Garage Martin SARL (fictif)' }).click();
    await expect(page.locator('tr[data-lot][data-statut="annule"]').getByRole('button', { name: 'Rétablir' })).toBeVisible();
    await page.goto('/campagnes');
    await expect(page.locator('tr[data-campagne]')).toContainText('Annulée');
    expect(erreurs).toEqual([]);
  });

  test('habilitations : dossiers hors habilitation comptés sans être détaillés ; annulation limitée aux dossiers en révision', async ({ browser }) => {
    const remi = await ouvrir(browser, 'remi', '/campagnes');
    await creer(remi, 'Balances partagées', 'Import comptable');
    await deposer(remi, 'Garage Martin SARL (fictif)', fec.nomFichier, fec.contenu);
    await expect(remi.locator(`tr[data-dossier="${ID.martin}"]`)).toHaveAttribute('data-statut', /^termine/, { timeout: 30_000 });
    const campagneId = (await suite()).campagnes[0]!.id;

    // Chloé n'est habilitée que sur Dupain : elle ne voit pas l'import de Martin, seulement son existence.
    const chloe = await ouvrir(browser, 'chloe', `/campagnes/${campagneId}`);
    await expect(chloe.getByTestId('hors-habilitation')).toContainText('1 dossier(s) hors de votre habilitation');
    await expect(chloe.locator('tr[data-element]')).toHaveCount(0);
    await expect(chloe.getByRole('main')).not.toContainText('Garage Martin');
    await expect(chloe.getByLabel('Dossier (parmi ceux où vous êtes habilité en collaboration)').getByRole('option')).toHaveText(['Choisir un dossier…', 'Boulangerie Dupain SAS (fictive)']);
    await deposer(chloe, 'Boulangerie Dupain SAS (fictive)', 'balance-dupain.txt', 'contenu de test');
    await expect(chloe.locator(`tr[data-dossier="${ID.dupain}"]`)).toHaveAttribute('data-statut', /^termine/, { timeout: 30_000 });
    // Sans habilitation de révision, l'annulation n'annule rien : l'API le dit, la campagne garde son statut.
    const actions = chloe.getByTestId('actions-campagne');
    await actions.getByRole('button', { name: 'Annuler la campagne' }).click();
    await actions.getByLabel('Motif de l’annulation (obligatoire)').fill('Campagne à refaire');
    await actions.getByRole('button', { name: 'Confirmer l’annulation de la campagne' }).click();
    await expect(actions.getByRole('alert')).toContainText('Aucun import annulé : habilitation de révision requise');
    expect((await suite()).campagnes[0]!.statut).toBe('ouverte');

    // Alice (validation sur Dupain seulement) : l'import de Martin est laissé en place et compté.
    const alice = await ouvrir(browser, 'alice', `/campagnes/${campagneId}`);
    const a = alice.getByTestId('actions-campagne');
    await a.getByRole('button', { name: 'Annuler la campagne' }).click();
    await a.getByLabel('Motif de l’annulation (obligatoire)').fill('Mauvais export');
    await a.getByRole('button', { name: 'Confirmer l’annulation de la campagne' }).click();
    await expect(a.getByTestId('compte-rendu-campagne')).toHaveText('1 import(s) annulé(s). 1 import(s) laissé(s) en place faute d’habilitation de révision sur leur dossier. Chaque import annulé reste rétablissable individuellement.');
    expect((await suite()).lots.find((l) => l.entiteId === ID.martin)).toMatchObject({ statut: expect.stringMatching(/^termine/), actif: true });
  });

  test('campagne de relevés bancaires : un fichier comptable n’y entre pas ; nombre de mouvements au suivi', async ({ browser }) => {
    const page = await ouvrir(browser, 'remi', '/campagnes');
    await creer(page, 'Relevés de décembre', 'Relevés bancaires');
    const campagneId = (await suite()).campagnes[0]!.id;
    expect(await statutBff(page, 'POST', 'v1/televersements', { entiteId: ID.dupain, nomFichier: 'x.txt', taille: 5, sha256: 'c'.repeat(64), canal: 'ordinateur', usage: 'fec', exerciceId: ID.exDupain, statutDonnees: 'fec', campagneId })).toBe(400);
    const f = page.locator('form[data-formulaire="depot-campagne"]');
    await expect(f.getByLabel('Exercice')).toHaveCount(0); // ni exercice ni statut des données pour un relevé
    await f.getByLabel('Dossier (parmi ceux où vous êtes habilité en collaboration)').selectOption({ label: 'Boulangerie Dupain SAS (fictive)' });
    await f.getByTestId('entree-campagne').setInputFiles({ name: 'releve.csv', mimeType: 'text/csv', buffer: Buffer.from('Date;Libellé;Montant\n05/02/2025;Abonnement;-12,50\n06/02/2025;Remise;100,00\n') });
    await f.getByRole('button', { name: 'Déposer pour ce dossier' }).click();
    const ligne = page.locator(`tr[data-dossier="${ID.dupain}"]`);
    await expect(ligne).toHaveAttribute('data-statut', /^(termine|echec)/, { timeout: 30_000 });
    await expect(page.getByRole('columnheader', { name: 'Mouvements' })).toBeVisible();
  });
});
