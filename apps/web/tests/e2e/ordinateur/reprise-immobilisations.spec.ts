/**
 * Reprise du fichier des immobilisations par import CSV (D-092) — navigateur simulé : Keycloak réel pour l'authentification, API simulée
 * qui applique le VRAI analyseur du moteur. Aperçu sans écriture, correspondance modifiable, confirmation explicite, rapport ligne par
 * ligne, téléchargement neutralisé, habilitations (lecteur et déposant), refus des fichiers non CSV ou trop gros.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ID, etatDe, journal, simulateur, statutBff, surveiller } from '../outils';

const CHLOE = '11111111-1111-4111-8111-111111111103';
const reprise = `/dossiers/${ID.dupain}/inventaire/reprise`;
const ENTETE = 'Désignation;Compte;Valeur brute;Date d’acquisition;Date de mise en service;Durée (mois);Mode d’amortissement;Coefficient dégressif;Éligibilité dégressif;Justification dégressif';
const FICHIER = [
  ENTETE,
  'Serveur de fichiers;218300;12 345,60;;15/03/2024;60;;;;',
  'Four mixte;215400;10000,00;05/11/2025;15/11/2025;120;dégressif;2,25;oui;Matériel neuf, durée normale de 10 ans (fiche fictive)',
  'Machine sans date;215400;10000,00;;15/11/2025;120;dégressif;2,25;oui;Matériel neuf, durée normale de 10 ans (fiche fictive)',
  'serveur  de fichiers;218300;12345,60;;15/03/2024;36;;;;',
  '=HYPERLINK("http://exemple.test","x");218400;100,00;;01/01/2024;12;;;;',
  'Montant ambigu;218400;1.234;;01/01/2024;12;;;;',
].join('\r\n');
/** Alerte de l'écran (hors annonceur de navigation de Next). */
const alerte = (page: import('@playwright/test').Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const fichier = (contenu: string | Buffer, nom = 'immobilisations.csv') => ({ name: nom, mimeType: 'text/csv', buffer: Buffer.from(contenu) });

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('reprise des immobilisations — collaborateur', () => {
  test.use({ storageState: etatDe('chloe') });

  test('aperçu sans écriture, correspondance modifiable, confirmation explicite, rapport, téléchargement et rejeu', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}/inventaire`);
    await page.getByTestId('lien-reprise').click();
    await expect(page.getByRole('heading', { name: 'Reprise du fichier des immobilisations (import CSV ou XLSX)' })).toBeVisible();
    await expect(page.getByText('Le dégressif reste non activé')).toBeVisible();
    await expect(page.getByText('Aucune reprise pour ce dossier.')).toBeVisible();

    // 1. Choix du fichier → aperçu.
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier(FICHIER));
    const apercu = page.getByTestId('apercu-reprise');
    await expect(apercu).toBeVisible();
    await expect(apercu).toContainText('Aperçu : rien n’est encore enregistré');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 3');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Invalides : 2');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Doublons ignorés : 1');
    // Correspondance proposée d'après les en-têtes usuels.
    await expect(page.locator('select[data-champ="libelle"]')).toHaveValue('0');
    await expect(page.locator('select[data-champ="baseAmortissable"]')).toHaveValue('2');
    await expect(page.locator('select[data-champ="dureeMois"]')).toHaveValue('5');
    await expect(page.locator('select[data-champ="dureeAnnees"]')).toHaveValue('');
    // Lignes : statuts, motifs, valeurs lues (la désignation « formule » est neutralisée à l'affichage).
    await expect(page.locator('tr[data-ligne="2"]')).toHaveAttribute('data-statut', 'valide');
    await expect(page.locator('tr[data-ligne="4"]')).toContainText('Dégressif : la date d’acquisition');
    await expect(page.locator('tr[data-ligne="5"]')).toHaveAttribute('data-statut', 'doublon');
    await expect(page.locator('tr[data-ligne="6"]')).toContainText("'=HYPERLINK");
    await expect(page.locator('tr[data-ligne="7"]')).toContainText('ambigu');
    // Rien n'est écrit : seul l'aperçu a été appelé, aucune immobilisation n'existe.
    const appels = await journal();
    expect(appels.filter((a) => a.methode === 'POST' && /reprises-immobilisations/.test(a.chemin)).map((a) => a.chemin.split('?')[0]?.replace(ID.dupain, ':id'))).toEqual([`/v1/dossiers/:id/reprises-immobilisations/apercu`]);
    expect((await simulateur<{ immobilisations: number }>('amortissements', {})).immobilisations).toBe(0);

    // La validation exige la confirmation explicite.
    const valider = page.getByRole('button', { name: /Valider l’import de 3 immobilisations/ });
    await expect(valider).toBeDisabled();

    // Correspondance modifiée : sans durée, plus rien ne peut être validé, et le motif est affiché.
    await page.locator('select[data-champ="dureeMois"]').selectOption('');
    await expect(page.getByTestId('problemes-correspondance')).toContainText('la durée d’amortissement (en mois ou en années) n’est associée à aucune colonne');
    await expect(page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ })).toBeDisabled();
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 0');
    await page.locator('select[data-champ="dureeMois"]').selectOption('5');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 3');
    await expect(page.getByTestId('problemes-correspondance')).toHaveCount(0);

    // 3. Confirmation, validation, rapport.
    await expect(valider).toBeDisabled();
    await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
    await expect(valider).toBeEnabled();
    await valider.click();
    const rapport = page.getByTestId('rapport-reprise');
    await expect(rapport).toBeVisible();
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Créées : 3');
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Ignorées (doublons) : 1');
    await expect(page.getByTestId('decomptes-reprise')).toContainText('Rejetées : 2');
    await expect(rapport).toContainText('Chloé Collab');
    await expect(rapport).toContainText('immobilisations.csv');
    await expect(rapport.locator('tr[data-ligne="2"]')).toHaveAttribute('data-statut', 'creee');
    await expect(rapport.locator('tr[data-ligne="4"]')).toContainText('Rejetée');
    await expect(rapport.locator('tr[data-ligne="6"]')).toContainText("'=HYPERLINK");
    expect((await simulateur<{ immobilisations: number }>('amortissements', {})).immobilisations).toBe(3);
    // Filtre par statut.
    await rapport.getByRole('link', { name: /Rejetée \(2\)/ }).click();
    await expect(page.locator('[data-testid="rapport-reprise"] tbody tr')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Reprises du fichier des immobilisations de ce dossier' })).toContainText('immobilisations.csv');

    // Téléchargement du rapport : CSV UTF-8 avec BOM, valeurs neutralisées.
    const telechargement = page.waitForEvent('download');
    await page.getByTestId('telecharger-rapport').click();
    const dl = await telechargement;
    expect(dl.suggestedFilename()).toMatch(/^rapport-reprise-immobilisations-[0-9a-f]{8}\.csv$/);
    const csv = readFileSync(await dl.path(), 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Ligne du fichier;Statut;Motif;');
    expect(csv).toContain(`"'=HYPERLINK(""http://exemple.test"",""x"")"`);
    expect(csv).toMatch(/\r\n4;Rejetée;Date d’acquisition : Dégressif/);

    // Rejeu : le même fichier ne crée plus rien (toutes ses lignes valides ont déjà été reprises).
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier(FICHIER));
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 0');
    await expect(page.locator('tr[data-ligne="2"]')).toContainText('déjà été reprise');
    await expect(page.getByText('Aucune ligne valide : il n’y a rien à importer.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Valider l’import/ })).toBeDisabled();
    expect((await simulateur<{ immobilisations: number }>('amortissements', {})).immobilisations).toBe(3);
    // Le dégressif n'est ni calculé ni proposé : la fiche de l'inventaire montre l'immobilisation, et l'état « non activé ».
    await page.goto(`/dossiers/${ID.dupain}/inventaire`);
    await expect(page.locator('[data-immobilisation]')).toHaveCount(3);
    await expect(page.getByTestId('etat-degressif')).toHaveAttribute('data-degressif-active', 'non');
    expect(erreurs).toEqual([]);
  });

  test('fichiers refusés avec un message clair : classeur Excel, trop de lignes, trop gros, vide', async ({ page }) => {
    await page.goto(reprise);
    const entree = page.getByLabel('Fichier des immobilisations (CSV ou XLSX)');
    await entree.setInputFiles(fichier(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]), 'immobilisations.xlsx'));
    await expect(alerte(page)).toContainText('seuls les formats CSV et XLSX sont pris en charge');
    await expect(page.getByTestId('apercu-reprise')).toHaveCount(0);
    const ligne = 'A;218300;1,00;;01/01/2024;12;;;';
    await entree.setInputFiles(fichier([ENTETE, ...Array.from({ length: 5001 }, () => ligne)].join('\n')));
    await expect(alerte(page)).toContainText('Trop de lignes');
    await expect(alerte(page)).toContainText('5000');
    await entree.setInputFiles(fichier(Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'gros.csv'));
    await expect(alerte(page)).toContainText('Fichier trop volumineux');
    await expect(alerte(page)).toContainText('Rien n’a été envoyé');
    await entree.setInputFiles(fichier('   \n', 'vide.csv'));
    await expect(alerte(page)).toContainText('aucune donnée');
    expect((await simulateur<{ immobilisations: number }>('amortissements', {})).immobilisations).toBe(0);
    expect((await journal()).filter((a) => a.methode === 'POST' && a.statut >= 200 && a.statut < 300 && /reprises-immobilisations$/.test(a.chemin))).toHaveLength(0);
  });

  test('ISO-8859-15 et virgule : encodage et séparateur détectés, modifiables ; durée sans unité à choisir', async ({ page }) => {
    await page.goto(reprise);
    const texte = ['Libellé,Compte,Montant,Date de mise en service,Durée', '"Écran œuvre, 2 pièces",218300,"1 234,50",2024-02-29,5'].join('\n');
    const brut = Buffer.from([...texte].map((c) => (c === 'œ' ? 0xbd : c.charCodeAt(0))));
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier(brut));
    const apercu = page.getByTestId('apercu-reprise');
    await expect(apercu).toContainText('détecté : ISO-8859-15');
    await expect(page.getByLabel(/Séparateur/)).toHaveValue(',');
    // « Durée » sans unité n'est pas proposée : la personne choisit la colonne ET l'unité.
    await expect(page.locator('select[data-champ="dureeMois"]')).toHaveValue('');
    await expect(page.locator('select[data-champ="dureeAnnees"]')).toHaveValue('');
    await expect(apercu).toContainText('ne dit pas si la durée est en mois ou en années');
    await expect(page.getByTestId('problemes-correspondance')).toBeVisible();
    await page.locator('select[data-champ="dureeAnnees"]').selectOption('4');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 1');
    await expect(page.locator('tr[data-ligne="2"]')).toContainText('Écran œuvre, 2 pièces');
    // Forcer le mauvais encodage : avertissement de caractères illisibles.
    await page.getByLabel(/Encodage/).selectOption('utf-8');
    await expect(apercu).toContainText('caractères illisibles');
  });

  test('aperçu obsolète à la validation (une immobilisation identique apparaît entre-temps) : 409 expliqué, aperçu recalculé, rien d’importé', async ({ page }) => {
    await page.goto(reprise);
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier([ENTETE, 'Bureau;218400;500,00;;01/01/2024;60;;;;'].join('\n')));
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 1');
    await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
    // Pendant ce temps, une personne saisit la même immobilisation à la main.
    let saisie = false;
    await page.route('**/api/bff/v1/dossiers/*/reprises-immobilisations', async (route) => {
      if (!saisie) {
        saisie = true;
        expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/immobilisations`, { libelle: 'Bureau', compteImmobilisation: '218400', baseAmortissable: '500.00', dateMiseEnService: '2024-01-01', dureeMois: 60 })).toBe(201);
      }
      await route.continue();
    });
    await page.getByRole('button', { name: /Valider l’import/ }).click();
    await expect(alerte(page)).toContainText('L’aperçu n’est plus à jour');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 0');
    await expect(page.getByTestId('decomptes-apercu')).toContainText('Doublons ignorés : 1');
    expect((await simulateur<{ immobilisations: number }>('amortissements', {})).immobilisations).toBe(1);
  });

  test('un lecteur voit les rapports mais ne peut pas importer ; le déposant est refusé', async ({ page, browser }) => {
    // Une première reprise par la collaboratrice.
    await page.goto(reprise);
    await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles(fichier([ENTETE, 'Bureau;218400;500,00;;01/01/2024;60;;;;'].join('\n')));
    await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
    await page.getByRole('button', { name: /Valider l’import/ }).click();
    await expect(page.getByTestId('rapport-reprise')).toBeVisible();
    // L'administratrice ramène Chloé au niveau « lecture ».
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/');
    expect(await statutBff(alice, 'PUT', `v1/dossiers/${ID.dupain}/habilitations/${CHLOE}`, { niveau: 'lecture' })).toBe(200);
    await alice.context().close();
    await page.goto(reprise);
    await expect(page.getByTestId('import-reserve')).toContainText('réservé au niveau « collaboration »');
    await expect(page.getByLabel('Fichier des immobilisations (CSV ou XLSX)')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Reprises du fichier des immobilisations de ce dossier' })).toContainText('immobilisations.csv');
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/reprises-immobilisations/apercu`, { nomFichier: 'a.csv', contenuBase64: Buffer.from(`${ENTETE}\nA;218300;1,00;;01/01/2024;12;;;;`).toString('base64') })).toBe(403);
    // Le lien de l'inventaire devient une simple consultation des rapports.
    await page.goto(`/dossiers/${ID.dupain}/inventaire`);
    await expect(page.getByTestId('lien-reprise')).toHaveText('Rapports des reprises du fichier d’immobilisations');
    // Déposant : refusé à l'écran comme à l'API.
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    expect(await client.goto(`http://localhost:3000${reprise}`).then(() => statutBff(client, 'GET', `v1/dossiers/${ID.dupain}/reprises-immobilisations`))).toBe(403);
    await expect(client.getByTestId('rapport-reprise')).toHaveCount(0);
    await expect(client.getByLabel('Fichier des immobilisations (CSV ou XLSX)')).toHaveCount(0);
    await client.context().close();
  });
});
