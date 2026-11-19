import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSimule, pdf, simulateur, statutBff, surveiller } from '../outils';

const dossier = `/dossiers/${ID.dupain}`;
const ouvrir = async (page: Page, nom: string) => {
  await page.goto(dossier);
  await page.getByRole('link', { name: nom }).click();
  await expect(page.getByRole('heading', { level: 2, name: nom })).toBeVisible();
};
const envoyerVersion = async (page: Page, nom: string, contenu: Buffer) => {
  await page.getByTestId('entree-nouvelle-version').setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: contenu });
  await page.getByRole('button', { name: 'Envoyer la nouvelle version' }).click();
};

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('nouvelle version d’une pièce — collaboratrice', () => {
  test.use({ storageState: etatDe('chloe') });

  test('pièce validée : explication avant l’envoi, « Version 2 reçue », validation invalidée, ancienne version conservée sans action', async ({ page }) => {
    const erreurs = surveiller(page);
    await ouvrir(page, 'facture-levure-2025-02.pdf');
    await expect(page.getByText('Validé par un réviseur (version 2)')).toBeVisible();
    const bloc = page.getByTestId('nouvelle-version');
    await expect(bloc).toContainText('L’ancienne version et son fichier sont conservés');
    await expect(bloc).toContainText('cette validation ne vaut pas pour la nouvelle version, qui devra être contrôlée à nouveau');
    await expect(page.getByTestId('versions').getByRole('listitem')).toHaveCount(1);

    await envoyerVersion(page, 'facture-levure-corrigee.pdf', pdf('levure-v2'));
    const compteRendu = page.getByTestId('compte-rendu-version');
    await expect(compteRendu).toContainText('Version 2 reçue');
    await expect(compteRendu).toContainText('cette validation ne vaut pas pour la version 2');

    // La page est maintenant celle d'une version remplacée : bandeau, validation invalidée, plus aucune action.
    const bandeau = page.getByTestId('version-remplacee');
    await expect(bandeau).toContainText('Cette version a été remplacée par la version 2 — elle est conservée pour mémoire');
    await expect(page.getByTestId('entete-piece')).toContainText('Remplacée');
    await expect(page.getByTestId('entete-piece')).toContainText('Validation invalidée par l’arrivée d’une nouvelle version');
    await expect(page.getByTestId('validation-invalidee')).toBeVisible();
    await expect(page.getByText(/Validé par un réviseur/)).toHaveCount(0);
    await expect(page.locator('[data-formulaire="correction"]')).toHaveCount(0);
    await expect(page.locator('[data-formulaire="qualification"]')).toHaveCount(0);
    await expect(page.getByTestId('entree-nouvelle-version')).toHaveCount(0);
    await expect(page.getByTestId('actions-indisponibles')).toBeVisible();
    const versions = page.getByTestId('versions').getByRole('listitem');
    await expect(versions).toHaveCount(2);
    await expect(versions.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(versions.nth(0)).toContainText('Remplacée');
    await expect(versions.nth(1)).toContainText('Reçu');
    // L'API refuse de toute façon le travail sur une version remplacée.
    const ancien = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-levure-2025-02.pdf')!;
    expect(await statutBff(page, 'PUT', `v1/documents/${ancien.id}/extraction`, { champs: { numero: 'X' } })).toBe(409);

    // La nouvelle version : à contrôler, jamais validée d'office.
    await bandeau.getByRole('link', { name: 'Ouvrir la version 2' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'facture-levure-corrigee.pdf' })).toBeVisible();
    await expect(page.getByTestId('entete-piece')).toContainText('Version 2');
    await expect(page.getByTestId('version-remplacee')).toHaveCount(0);
    await expect(page.getByText(/Validé par un réviseur/)).toHaveCount(0);
    await expect(page.getByTestId('versions').getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('versions').getByRole('link', { name: 'Version 1' }).click();
    await expect(page.getByTestId('version-remplacee')).toBeVisible();

    // Listes : version remplacée masquée par défaut, numéro de version affiché, distinction visuelle sur demande.
    await page.goto(dossier);
    await expect(page.getByRole('link', { name: 'facture-levure-2025-02.pdf' })).toHaveCount(0);
    const ligne = page.locator('tbody tr', { hasText: 'facture-levure-corrigee.pdf' });
    await expect(ligne).toContainText('Version 2');
    const filtre = page.getByTestId('filtre-remplacees');
    await expect(filtre.getByRole('link', { name: 'Masquer les versions remplacées' })).toHaveAttribute('aria-current', 'true');
    await expect(filtre).toContainText('1 version remplacée masquée');
    await filtre.getByRole('link', { name: 'Masquer les versions remplacées' }).click();
    const ancienne = page.locator('tbody tr[data-remplacee="oui"]');
    await expect(ancienne).toHaveCount(1);
    await expect(ancienne).toContainText('facture-levure-2025-02.pdf');
    await expect(ancienne).toContainText('Remplacée');
    await expect(ancienne).toContainText('Remplacé par la version 2');
    expect(erreurs).toEqual([]);
  });

  test('fichier identique : rien n’est remplacé, et c’est dit', async ({ page }) => {
    const contenu = pdf('identique');
    await page.goto(dossier);
    await page.getByTestId('entree-pieces').setInputFiles({ name: 'bon-de-livraison.pdf', mimeType: 'application/pdf', buffer: contenu });
    await expect(page.getByTestId('liste-envois').getByRole('listitem')).toContainText('Reçu');
    await ouvrir(page, 'bon-de-livraison.pdf');
    await envoyerVersion(page, 'bon-de-livraison-bis.pdf', contenu);
    const compteRendu = page.getByTestId('compte-rendu-version');
    await expect(compteRendu).toContainText('Fichier identique à l’existant');
    await expect(compteRendu).toContainText('rien n’a été remplacé');
    await expect(page.getByTestId('version-remplacee')).toHaveCount(0);
    await expect(page.getByTestId('versions').getByRole('listitem')).toHaveCount(1);
    expect((await etatSimule()).documents.filter((d) => d.nomOrigine.startsWith('bon-de-livraison'))).toHaveLength(1);
  });
});

test.describe('nouvelle version d’une pièce — réviseur et déposant', () => {
  test('réviseur : aucune décision proposée sur une version remplacée', async ({ browser }) => {
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await ouvrir(chloe, 'facture-meunerie-2025-03.pdf');
    await envoyerVersion(chloe, 'facture-meunerie-v2.pdf', pdf('meunerie-v2'));
    await expect(chloe.getByTestId('compte-rendu-version')).toContainText('Version 2 reçue');
    await expect(chloe.getByTestId('compte-rendu-version')).not.toContainText('ne vaut pas'); // rien n'était validé
    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto(`${dossier}?remplacees=afficher`);
    await remi.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' }).click();
    await expect(remi.getByTestId('version-remplacee')).toBeVisible();
    await expect(remi.getByTestId('decision-reviseur')).toHaveCount(0);
    const ancien = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-meunerie-2025-03.pdf')!;
    expect(await statutBff(remi, 'POST', `v1/documents/${ancien.id}/validation`, { decision: 'valider' })).toBe(409);
  });

  test('déposant : sa pièce non validée se remplace ; une pièce validée par le cabinet ne se remplace pas', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await page.goto('/depots');
    await page.getByRole('link', { name: /facture-levure-2025-02\.pdf/ }).click();
    await expect(page.getByTestId('nouvelle-version-indisponible')).toContainText('validée par le cabinet : seul un collaborateur habilité');
    await expect(page.getByTestId('entree-nouvelle-version')).toHaveCount(0);
    const valide = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-levure-2025-02.pdf')!;
    const refus = { entiteId: ID.dupain, nomFichier: 'x.pdf', taille: 10, sha256: 'a'.repeat(64), canal: 'telephone', remplaceDocumentId: valide.id };
    expect(await statutBff(page, 'POST', 'v1/televersements', refus)).toBe(403);

    await page.goto('/depots');
    await page.getByRole('link', { name: /facture-meunerie-2025-03\.pdf/ }).click();
    await expect(page.getByTestId('versions').getByRole('listitem')).toHaveCount(1);
    await envoyerVersion(page, 'facture-meunerie-nette.pdf', pdf('meunerie-nette'));
    await expect(page.getByTestId('compte-rendu-version')).toContainText('Version 2 reçue');
    await expect(page.getByTestId('version-remplacee')).toContainText('remplacée par la version 2');
    await expect(page.locator('[data-formulaire="signalement_erreur"]')).toHaveCount(0);
    await page.getByTestId('compte-rendu-version').getByRole('link', { name: 'Ouvrir la version 2' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'facture-meunerie-nette.pdf' })).toBeVisible();
    await page.goto('/depots');
    await expect(page.getByRole('link', { name: /facture-meunerie-2025-03\.pdf/ })).toHaveCount(0); // masquée par défaut
    await page.getByTestId('filtre-remplacees').getByRole('link').click();
    await expect(page.locator('li[data-remplacee="oui"]')).toContainText('facture-meunerie-2025-03.pdf');
  });
});
