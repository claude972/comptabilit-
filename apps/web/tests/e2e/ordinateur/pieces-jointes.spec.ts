import { type Locator, type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSimule, etatSuite, pdf, simulateur, statutBff, surveiller } from '../outils';

const dossier = `/dossiers/${ID.dupain}`;
const idPiece = async (nom: string) => (await etatSimule()).documents.find((d) => d.nomOrigine === nom)!.id;

/** Ouvre le sélecteur du formulaire et coche la pièce nommée. */
async function joindre(formulaire: Locator, nom: string) {
  const selecteur = formulaire.getByTestId('selecteur-pieces');
  await selecteur.getByRole('button', { name: /Choisir (des pièces|une pièce) du dossier/ }).click();
  await selecteur.getByTestId('pieces-disponibles').getByRole('listitem').filter({ hasText: nom }).locator('input').check();
  await expect(selecteur.getByTestId('pieces-choisies')).toContainText(nom);
}

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('pièces jointes — collaboratrice', () => {
  test.use({ storageState: etatDe('chloe') });

  test('conseil : sélecteur (recherche, versions remplacées exclues par défaut), pièce affichée avec nom, version, statut et lien ; modification ; pièce devenue « remplacée » signalée', async ({ page }) => {
    const erreurs = surveiller(page);
    const meunerie = await idPiece('facture-meunerie-2025-03.pdf');
    await page.goto(`${dossier}/mission/conseils`);
    await page.getByRole('button', { name: 'Rédiger un conseil' }).click();
    const f = page.locator('form[data-formulaire="rediger-conseil"]');
    await f.getByLabel('Date du conseil').fill('2025-05-12');
    await f.getByLabel('Objet').fill('Fournisseur de farine');
    await f.getByLabel('Destinataire').fill('Gérant');
    await f.getByLabel('Contenu').fill('Voir la facture jointe.');
    const selecteur = f.getByTestId('selecteur-pieces');
    await expect(selecteur).toContainText('Aucune pièce jointe.');
    await expect(selecteur).toContainText('Les joindre ne les envoie à personne');
    await selecteur.getByRole('button', { name: 'Choisir des pièces du dossier' }).click();
    const disponibles = selecteur.getByTestId('pieces-disponibles').getByRole('listitem');
    await expect(disponibles).toHaveCount(4);
    await selecteur.getByLabel('Rechercher par nom (dans la page affichée)').fill('MEUNERIE');
    await expect(disponibles).toHaveCount(1);
    await expect(disponibles).toContainText('À contrôler');
    await disponibles.getByRole('checkbox').check();
    await selecteur.getByLabel('Rechercher par nom (dans la page affichée)').fill('introuvable');
    await expect(selecteur).toContainText('Aucune pièce de cette page ne correspond.');
    await expect(selecteur.getByTestId('pieces-choisies')).toContainText('facture-meunerie-2025-03.pdf'); // la sélection ne dépend pas du filtre
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/conseils'));
    await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
    expect((await envoi).postDataJSON().pieces).toEqual([meunerie]);

    const fiche = page.locator('[data-conseil]');
    const jointes = fiche.getByTestId('pieces-jointes');
    await expect(jointes).toContainText('Pièces jointes (1)');
    await expect(jointes).toContainText('version 1');
    await expect(jointes).toContainText('À contrôler');
    await expect(jointes.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' })).toHaveAttribute('href', `${dossier}/pieces/${meunerie}`);

    // Modification : la sélection existante est reprise, on ajoute une seconde pièce.
    await fiche.getByRole('button', { name: 'Modifier ce projet' }).click();
    const modif = fiche.locator('form[data-formulaire="modifier-conseil"]');
    await expect(modif.getByTestId('pieces-choisies').getByRole('listitem')).toHaveCount(1);
    await joindre(modif, 'facture-levure-2025-02.pdf');
    await modif.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(jointes).toContainText('Pièces jointes (2)');
    expect((await etatSuite()).conseils[0]).toMatchObject({ statut: 'projet' });

    // La pièce jointe reçoit une nouvelle version : ce qui est joint n'est plus la version courante, et c'est signalé.
    await jointes.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' }).click();
    await page.getByTestId('entree-nouvelle-version').setInputFiles({ name: 'facture-meunerie-v2.pdf', mimeType: 'application/pdf', buffer: pdf('pj-v2') });
    await page.getByRole('button', { name: 'Envoyer la nouvelle version' }).click();
    await expect(page.getByTestId('compte-rendu-version')).toContainText('Version 2 reçue');
    await page.goto(`${dossier}/mission/conseils`);
    const remplacee = page.locator('[data-piece-jointe][data-remplacee="oui"]');
    await expect(remplacee).toHaveCount(1);
    await expect(remplacee).toContainText('facture-meunerie-2025-03.pdf');
    await expect(remplacee).toContainText('Remplacée');
    await expect(remplacee).toContainText('Une version plus récente de cette pièce existe');
    // Sélecteur : la version remplacée n'est proposée que sur demande.
    await page.getByRole('button', { name: 'Rédiger un conseil' }).click();
    const nouveau = page.locator('form[data-formulaire="rediger-conseil"]').getByTestId('selecteur-pieces');
    await nouveau.getByRole('button', { name: 'Choisir des pièces du dossier' }).click();
    await expect(nouveau.getByTestId('pieces-disponibles')).toContainText('facture-meunerie-v2.pdf');
    await expect(nouveau.getByTestId('pieces-disponibles')).not.toContainText('facture-meunerie-2025-03.pdf');
    await nouveau.getByLabel('Inclure les versions remplacées').check();
    await expect(nouveau.getByTestId('pieces-disponibles')).toContainText('facture-meunerie-2025-03.pdf');
    expect(erreurs).toEqual([]);
  });

  test('refus de l’API pour une pièce d’un autre dossier ; sélecteur indisponible : message clair', async ({ page }) => {
    await page.goto(`${dossier}/mission/conseils`);
    const corps = { dateConseil: '2025-05-12', objet: 'x', contenu: 'y', destinataire: 'z', pieces: ['aaaaaaaa-0000-4000-8000-00000000dead'] };
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/conseils`, corps)).toBe(400);
    await page.route('**/api/bff/v1/documents?*', (route) => route.fulfill({ status: 403, json: { message: 'Habilitation insuffisante sur ce dossier' } }));
    await page.getByRole('button', { name: 'Rédiger un conseil' }).click();
    const selecteur = page.getByTestId('selecteur-pieces');
    await selecteur.getByRole('button', { name: 'Choisir des pièces du dossier' }).click();
    await expect(selecteur.getByRole('alert')).toContainText('Action refusée : Habilitation insuffisante sur ce dossier');
  });

  test('lettre de mission : lettre signée jointe ; écriture d’inventaire : pièce justificative et auteur nommé', async ({ page, browser }) => {
    const levure = await idPiece('facture-levure-2025-02.pdf');
    await page.goto(`${dossier}/mission`);
    await page.getByLabel('Libellé de la mission').fill('Mission comptable 2025');
    await page.getByRole('button', { name: 'Créer la mission' }).click();
    await page.getByRole('button', { name: 'Rédiger une lettre ou un avenant' }).click();
    const lettre = page.locator('form[data-formulaire="rediger-lettre"]');
    await lettre.getByLabel('Date d’effet').fill('2025-01-01');
    await lettre.getByRole('checkbox', { name: 'Tenue de comptabilité' }).check();
    await lettre.getByLabel('Début de la mission').fill('2025-01-01');
    await joindre(lettre, 'facture-levure-2025-02.pdf');
    await expect(lettre.getByTestId('selecteur-pieces')).toContainText('La joindre ne vaut pas validation');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && /\/missions\/[0-9a-f-]+\/lettres$/.test(r.url()));
    await lettre.getByRole('button', { name: 'Enregistrer le projet' }).click();
    expect((await envoi).postDataJSON().documentId).toBe(levure);
    const signee = page.getByTestId('lettre-signee');
    await expect(signee).toContainText('Lettre signée jointe');
    await expect(signee.getByRole('link', { name: 'facture-levure-2025-02.pdf' })).toHaveAttribute('href', `${dossier}/pieces/${levure}`);
    await expect(page.locator('[data-lettre]')).toHaveAttribute('data-statut', 'projet'); // joindre ne valide rien

    await page.goto(`${dossier}/inventaire`);
    const f = page.locator('form[data-formulaire="proposer-ecriture"]');
    await f.getByLabel('Date de l’écriture (dans l’exercice)').fill('2025-12-31');
    await f.getByLabel('Libellé', { exact: true }).fill('Charge constatée d’avance');
    await f.getByLabel('Justification (pourquoi cette écriture)').fill('Abonnement annuel payé en décembre.');
    await f.getByLabel('Calcul (détail du montant)').fill('600,00 × 11/12');
    await f.getByLabel('Compte (ligne 1)', { exact: true }).fill('486');
    await f.getByLabel('Libellé du compte (ligne 1)').fill('Charges constatées d’avance');
    await f.getByLabel('Débit (ligne 1)').fill('550,00');
    await f.getByLabel('Compte (ligne 2)', { exact: true }).fill('6135');
    await f.getByLabel('Libellé du compte (ligne 2)').fill('Locations mobilières');
    await f.getByLabel('Crédit (ligne 2)').fill('550,00');
    await joindre(f, 'facture-levure-2025-02.pdf');
    await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
    const ecriture = page.getByTestId('pieces-jointes');
    await expect(ecriture).toContainText('Pièces justificatives (1)');
    await expect(ecriture.getByRole('link', { name: 'facture-levure-2025-02.pdf' })).toBeVisible();
    await expect(ecriture).toContainText('Traité');
    await expect(page.getByRole('main')).toContainText('par vous');
    expect((await etatSuite()).ecritures[0]).toMatchObject({ statut: 'proposee' });
    // Vue par le réviseur : l'auteur est nommé.
    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto(`${dossier}/inventaire`);
    await expect(remi.getByRole('main')).toContainText('par Chloé Collab');
    await expect(remi.getByTestId('pieces-jointes').getByRole('link', { name: 'facture-levure-2025-02.pdf' })).toBeVisible();
  });

  test('fait consigné : pièce justificative facultative, affichée avec le fait', async ({ page, browser }) => {
    const meunerie = await idPiece('facture-meunerie-2025-03.pdf');
    await page.goto(`${dossier}/mission/conseils`);
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/conseils`, { dateConseil: '2025-05-12', objet: 'Note', contenu: 'Contenu', destinataire: 'Gérant' })).toBe(201);
    const id = (await etatSuite()).conseils[0]!.id;
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto(`${dossier}/mission/conseils`);
    expect(await statutBff(alice, 'POST', `v1/conseils/${id}/validation`)).toBe(200);
    expect(await statutBff(alice, 'POST', `v1/conseils/${id}/autorisation-envoi`)).toBe(200);
    await page.reload();
    const f = page.locator('form[data-formulaire="consigner-fait"]');
    await f.getByLabel('Date et heure').fill('2025-05-13T10:00');
    await f.getByLabel('Canal').fill('Courrier recommandé');
    await f.getByLabel('Justificatif (obligatoire : ce qui établit le fait)').fill('Preuve de dépôt n° 1A 234 567');
    const selecteur = f.getByTestId('selecteur-pieces');
    await selecteur.getByRole('button', { name: 'Choisir une pièce du dossier' }).click();
    const radios = selecteur.getByTestId('pieces-disponibles').getByRole('radio');
    await radios.nth(0).check();
    await selecteur.getByTestId('pieces-disponibles').getByRole('listitem').filter({ hasText: 'facture-meunerie-2025-03.pdf' }).getByRole('radio').check();
    await expect(selecteur.getByTestId('pieces-choisies').getByRole('listitem')).toHaveCount(1); // choix unique
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/evenements'));
    await f.getByRole('button', { name: 'Consigner ce fait' }).click();
    expect((await envoi).postDataJSON().justificatifDocumentId).toBe(meunerie);
    const piece = page.getByTestId('justificatif-piece');
    await expect(piece).toContainText('Pièce justificative :');
    await expect(piece.getByRole('link', { name: 'facture-meunerie-2025-03.pdf' })).toBeVisible();
  });
});
