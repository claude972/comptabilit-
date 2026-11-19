import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, simulateur, statutBff, surveiller } from '../outils';

const veille = `/dossiers/${ID.dupain}/veille`;
const EV = { metropole: 'eeeeeeee-0000-4000-8000-000000000001', naf: 'eeeeeeee-0000-4000-8000-000000000002', martinique: 'eeeeeeee-0000-4000-8000-000000000003', brute: 'eeeeeeee-0000-4000-8000-000000000004' };

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('veille', () => {
  test.use({ storageState: etatDe('remi') });

  test('onglet Veille : applicabilité en trois états, raisons, exercices concernés, suivi consigné', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Veille' }).click();
    await expect(page.getByTestId('phrase-veille')).toContainText('Aucune évolution ne modifie les contrôles automatiquement.');
    // La détection brute non qualifiée n'est jamais présentée comme une évolution.
    await expect(page.locator('[data-evolution]')).toHaveCount(3);
    await expect(page.locator(`[data-evolution="${EV.brute}"]`)).toHaveCount(0);

    const concerne = page.locator(`[data-evolution="${EV.metropole}"]`);
    await expect(concerne.getByTestId('applicabilite')).toHaveText('Concerné');
    await expect(concerne.getByTestId('raisons')).toContainText('Territoire fiscal du dossier (metropole) visé par l\'évolution.');
    await expect(concerne.getByTestId('exercices-concernes')).toHaveText('du 01/01/2025 au 31/12/2025');
    const aConfirmer = page.locator(`[data-evolution="${EV.naf}"]`);
    await expect(aConfirmer.getByTestId('applicabilite')).toHaveText('À confirmer');
    await expect(aConfirmer.getByTestId('manquants')).toContainText('Code NAF');
    // Un réviseur n'administre pas le dossier : pas de lien mort vers la fiche d'administration.
    await expect(aConfirmer.getByRole('link', { name: 'Compléter la fiche d’administration du dossier' })).toHaveCount(0);
    await expect(aConfirmer.getByTestId('manquants')).toContainText('tenue par les administrateurs et associés');
    const non = page.locator(`[data-evolution="${EV.martinique}"]`);
    await expect(non.getByTestId('applicabilite')).toHaveText('Non concerné');
    await expect(non.getByTestId('raisons')).toContainText('non visé');
    await expect(non.getByTestId('exercices-concernes')).toHaveCount(0);

    await expect(concerne.getByTestId('suivi')).toContainText('Aucun suivi consigné');
    const suivi = concerne.locator('form[data-formulaire="suivi-evolution"]');
    await suivi.getByLabel(/^Suivi de/).selectOption('pris_en_compte');
    await suivi.getByLabel('Note (facultative)').fill('Vu avec la collaboratrice');
    await suivi.getByRole('button', { name: 'Consigner le suivi' }).click();
    await expect(concerne.getByTestId('suivi')).toContainText('Pris en compte');
    await expect(concerne.getByTestId('suivi')).toContainText('Note : Vu avec la collaboratrice');
    expect((await etatSuite()).suivis).toEqual([expect.objectContaining({ entiteId: ID.dupain, evolutionId: EV.metropole, statut: 'pris_en_compte', note: 'Vu avec la collaboratrice' })]);
    expect(await statutBff(page, 'PUT', `v1/dossiers/${ID.dupain}/veille/${EV.brute}`, { statut: 'pris_en_compte' })).toBe(404);
    expect(erreurs).toEqual([]);
  });

  test('sources : « Veille assurée » ou « Veille NON assurée », jamais « aucune nouveauté » pour une source indisponible', async ({ page, browser }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Veille' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Veille : sources surveillées');
    await expect(page.getByTestId('phrase-veille')).toContainText('Aucune évolution ne modifie les contrôles automatiquement.');
    await expect(page.locator('[data-source]')).toHaveCount(4);
    await expect(page.locator('[data-source][data-veille-assuree="true"]').getByTestId('etat-veille')).toHaveText(['Veille assurée', 'Veille assurée']);
    const ko = page.locator('[data-source][data-veille-assuree="false"]');
    await expect(ko.getByTestId('etat-veille')).toHaveText(['Veille NON assurée', 'Veille NON assurée']);
    await expect(ko.first()).toContainText('Légifrance');
    await expect(ko.first().getByTestId('detail')).toHaveText('HTTP 403');
    await expect(ko.first().getByTestId('dernier-succes')).toHaveText('Aucune');
    await expect(ko.first().getByTestId('dernier-essai')).toContainText('Source indisponible au dernier essai');
    await expect(ko.first().getByTestId('dernier-essai')).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} — /); // horodatage PostgreSQL mis en forme
    await expect(ko.first()).toContainText('Cela ne signifie pas qu’il n’y a aucune nouveauté');
    await expect(page.getByTestId('alerte-non-assuree')).toContainText('Veille non assurée sur 2 sources sur 4');
    await expect(page.getByTestId('alerte-non-assuree')).toContainText('Une source indisponible ne signifie pas « aucune nouveauté »');
    await expect(page.getByTestId('non-qualifiees')).toContainText('Évolutions détectées non encore qualifiées par l’éditeur : 1');

    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/veille/sources');
    await expect(client.getByTestId('erreur-403')).toBeVisible();
    expect(await statutBff(client, 'GET', 'v1/veille/sources')).toBe(403);
    await client.context().close();
  });
});

test.describe('veille — gestionnaire', () => {
  test.use({ storageState: etatDe('alice') });
  test('« À confirmer » : lien vers la fiche d’administration ; une fois la caractéristique renseignée, l’applicabilité est tranchée', async ({ page }) => {
    await page.goto(veille);
    const aConfirmer = page.locator(`[data-evolution="${EV.naf}"]`);
    await expect(aConfirmer.getByTestId('applicabilite')).toHaveText('À confirmer');
    await aConfirmer.getByRole('link', { name: 'Compléter la fiche d’administration du dossier' }).click();
    await expect(page).toHaveURL(new RegExp(`/administration/dossiers/${ID.dupain}$`));
    const f = page.locator('form[data-formulaire="modifier-dossier"]');
    await f.getByLabel('Code NAF (facultatif)').fill('10.71C');
    await f.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(f.getByRole('status')).toContainText('Dossier modifié.');
    await page.goto(veille);
    await expect(aConfirmer.getByTestId('applicabilite')).toHaveText('Concerné');
    await expect(aConfirmer.getByTestId('manquants')).toHaveCount(0);
  });
});

test.describe('recherche dans un dossier', () => {
  test.use({ storageState: etatDe('remi') });

  test('champ de l’en-tête, trois groupes, terme surligné sans HTML, liens vers la pièce et le constat, périmètre affiché', async ({ page }) => {
    const erreurs = surveiller(page);
    let alerte = false;
    page.on('dialog', (d) => {
      alerte = true;
      void d.dismiss();
    });
    await page.goto(`/dossiers/${ID.dupain}/revision`);
    const champ = page.getByRole('search', { name: 'Rechercher dans ce dossier' });
    await champ.getByLabel('Rechercher dans ce dossier (pièces, écritures, constats)').fill('facture');
    await champ.getByRole('button', { name: 'Chercher dans le dossier' }).click();
    await expect(page).toHaveURL(new RegExp(`/dossiers/${ID.dupain}/recherche\\?q=facture$`));
    await expect(page.getByTestId('perimetre')).toHaveText('Résultats pour « facture » — périmètre : Pièces, écritures du lot actif et constats de la dernière exécution, dans ce dossier.');
    const pieces = page.locator('[data-groupe="pieces"]');
    await expect(pieces.getByRole('heading')).toHaveText('Pièces (1)');
    const resultat = pieces.locator('[data-resultat-piece]');
    await expect(resultat).toContainText('page 1');
    // Le terme trouvé est dans des éléments <mark> ; les marqueurs « » ne sont plus affichés.
    await expect(resultat.locator('mark')).toHaveText(['FACTURE', 'Facture']);
    await expect(resultat.getByTestId('extrait')).toContainText('Facture n° FA-2025-0312');
    await expect(resultat.getByTestId('extrait')).not.toContainText('«');
    await expect(page.locator('[data-groupe="ecritures"]')).toContainText('Aucune écriture du lot actif ne contient ces termes.');
    await resultat.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' }).click();
    await expect(page).toHaveURL(new RegExp(`/dossiers/${ID.dupain}/pieces/[0-9a-f-]{36}$`));

    // Écritures : libellé hostile rendu en texte brut, montants formatés depuis les chaînes.
    await page.goto(`/dossiers/${ID.dupain}/recherche?q=retrait`);
    const ecriture = page.locator('[data-resultat-ecriture]');
    await expect(ecriture).toHaveCount(1);
    await expect(ecriture).toContainText('Retrait espèces <script>alert(1)</script>');
    await expect(ecriture.locator('td').nth(6)).toHaveText('500,00');
    expect(alerte).toBe(false);

    // Constats : lien vers le constat.
    await page.goto(`/dossiers/${ID.dupain}/recherche?q=caisse`);
    const constat = page.locator('[data-groupe="constats"] [data-resultat-constat]');
    await expect(constat).toContainText('TRE_001');
    await constat.getByRole('link', { name: /Caisse créditrice/ }).click();
    await expect(page).toHaveURL(/\/revision\/constats\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Explication' })).toBeVisible();

    // Requête trop courte : message clair, aucun appel inutile ; dossier d'un autre cabinet : 404.
    await page.goto(`/dossiers/${ID.dupain}/recherche?q=a`);
    await expect(page.getByTestId('recherche-invalide')).toContainText('Saisissez de 2 à 200 caractères');
    expect(await statutBff(page, 'GET', `v1/recherche?entiteId=${ID.leroy}&q=facture`)).toBe(404);
    expect(await statutBff(page, 'GET', `v1/recherche?entiteId=${ID.dupain}&q=a`)).toBe(400);
    expect(erreurs).toEqual([]);
  });
});
