import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, surveiller } from '../outils';

const dossier = `/dossiers/${ID.dupain}`;
const MEUNERIE = 'facture-meunerie-2025-03.pdf';
const LEVURE = 'facture-levure-2025-02.pdf';
const ouvrir = async (page: Page, nom: string) => {
  await page.goto(dossier);
  await page.getByRole('link', { name: nom }).click();
  await expect(page.getByRole('heading', { level: 2, name: nom })).toBeVisible();
};
const ligne = (page: Page, champ: string) => page.getByTestId('bloc-destinataire').locator(`tr[data-champ="${champ}"]`);

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('correction manuelle du destinataire — collaboratrice', () => {
  test.use({ storageState: etatDe('chloe') });

  test('pièce sans lecture du destinataire : alerte, correction avec motif obligatoire, valeurs côte à côte, historique, sens relu', async ({ page }) => {
    const erreurs = surveiller(page);
    await ouvrir(page, MEUNERIE);
    const bloc = page.getByTestId('bloc-destinataire');
    await expect(bloc.getByRole('heading', { name: 'Destinataire de la pièce (acheteur)' })).toBeVisible();
    await expect(page.getByTestId('destinataire-non-lu')).toContainText('La lecture automatique du destinataire n’a pas été faite');
    await expect(ligne(page, 'destinataireSiren').locator('[data-colonne="automatique"]')).toContainText('non lu');
    await expect(page.getByTestId('original-inchange')).toContainText('L’original n’est jamais modifié');

    const formulaire = page.locator('[data-formulaire="destinataire"]');
    // Rien n'est envoyé sans motif (champ obligatoire du navigateur ; le serveur l'exige aussi), ni sans modification.
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(formulaire.getByLabel('Motif de la correction (obligatoire)')).toBeFocused();
    await formulaire.getByLabel('Motif de la correction (obligatoire)').fill('Client lu sur le bon de commande');
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Modifiez au moins un champ du destinataire' })).toBeVisible();
    await formulaire.getByLabel('SIREN').fill('552100554');
    await formulaire.getByLabel('Nom du destinataire').fill('Client Humain SAS');
    await expect(formulaire).toContainText('Champs modifiés : Nom du destinataire, SIREN.');

    // SIREN à la clé fausse : refusé par le serveur, message en français, rien n'est enregistré.
    await formulaire.getByLabel('SIREN').fill('552100555');
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'SIREN du destinataire' })).toBeVisible();
    await expect(bloc).not.toContainText('Saisie humaine');

    await formulaire.getByLabel('SIREN').fill('552 100 554');
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toContainText('nouvelle version de l’extraction, non validée');
    // Valeurs côte à côte : la saisie humaine prime, la valeur automatique (absente) reste visible, qui/quand/pourquoi.
    const siren = ligne(page, 'destinataireSiren');
    await expect(siren.locator('[data-colonne="humaine"]')).toContainText('552100554');
    await expect(siren.locator('[data-colonne="retenue"]')).toContainText('552100554');
    await expect(siren).toContainText('Saisie humaine');
    await expect(siren).toContainText('Par Chloé');
    await expect(siren).toContainText('Motif : Client lu sur le bon de commande');
    await expect(page.getByTestId('desaccord-destinataireSiren')).toBeVisible();
    await expect(page.getByTestId('destinataire-non-lu')).toBeVisible(); // la lecture automatique reste à faire : la pièce reste concernée par une réanalyse
    // Sens relu d'après les identifiants (SIREN du dossier simulé : 123456782).
    await expect(page.getByTestId('sens-destinataire')).toContainText('Sens de la pièce relu d’après les identifiants');
    // Historique : deux versions, la version 1 intacte.
    const historique = page.getByTestId('historique-destinataire');
    await historique.locator('summary').click();
    await expect(historique).toContainText('Historique du destinataire (2 versions de l’extraction)');
    await expect(historique.getByRole('listitem').filter({ hasText: 'Version 1' }).first()).toBeVisible();
    await expect(historique).toContainText('par Chloé Collab, motif : Client lu sur le bon de commande');
    expect(erreurs).toEqual([]);
  });

  test('vider un champ le déclare sans valeur, tracé', async ({ page }) => {
    await ouvrir(page, MEUNERIE);
    const formulaire = page.locator('[data-formulaire="destinataire"]');
    await formulaire.getByLabel('Nom du destinataire').fill('Société Cliente');
    await formulaire.getByLabel('Motif de la correction (obligatoire)').fill('Premier essai');
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toBeVisible();
    await formulaire.getByLabel('Nom du destinataire').fill('');
    await formulaire.getByLabel('Motif de la correction (obligatoire)').fill('Nom illisible, à ne pas conserver');
    await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toBeVisible();
    await expect(ligne(page, 'destinataireNom').locator('[data-colonne="retenue"]')).toContainText('—');
    await expect(ligne(page, 'destinataireNom')).toContainText('Motif : Nom illisible, à ne pas conserver');
  });

  test('un collaborateur voit la réanalyse mais ne peut pas la demander', async ({ page }) => {
    await page.goto(dossier);
    await page.getByTestId('lien-reanalyse-destinataire').getByRole('link').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Réanalyse du destinataire des pièces déjà stockées' })).toBeVisible();
    await expect(page.getByTestId('nb-concernees')).toHaveText('2');
    await expect(page.getByTestId('demande-reservee')).toContainText('réservé au niveau « révision »');
    await expect(page.locator('[data-formulaire="simulation-reanalyse"]')).toHaveCount(0);
  });
});

test.describe('réanalyse explicite — réviseur', () => {
  test.use({ storageState: etatDe('remi') });

  test('aperçu, simulation sans écriture, confirmation explicite, rapport par pièce, correction humaine conservée, idempotence', async ({ page }) => {
    const erreurs = surveiller(page);
    // Une correction humaine préalable sur la pièce validée : elle doit survivre à la réanalyse.
    await ouvrir(page, LEVURE);
    await page.locator('[data-formulaire="destinataire"]').getByLabel('SIREN').fill('732829320');
    await page.locator('[data-formulaire="destinataire"]').getByLabel('Motif de la correction (obligatoire)').fill('Client confirmé par téléphone');
    await page.locator('[data-formulaire="destinataire"]').getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toBeVisible();
    // La lecture simulée de la pièce « levure » donne un autre SIREN que la saisie : désaccord attendu à la réanalyse.
    await simulateur('destinataire', { lectures: { [LEVURE]: { destinataireSiren: '552100554', destinataireNom: 'AUTRE CLIENT SA', destinataireAbstention: null } } });

    await page.goto(`${dossier}/reanalyse-destinataire`);
    await expect(page.getByTestId('nb-concernees')).toHaveText('2');
    await expect(page.getByTestId('nb-lot')).toContainText('2 (lot unique)');
    const apercu = page.getByTestId('apercu-reanalyse');
    await expect(apercu).toContainText('Aucune réanalyse ne démarre sans une demande explicite');
    await expect(apercu).toContainText('Dont corrigées à la main');
    // Aucune exécution possible tant qu'il n'y a pas de simulation.
    await expect(page.locator('[data-formulaire="execution-reanalyse"]')).toHaveCount(0);

    // 1. Simulation : motif obligatoire, puis rapport.
    const simulation = page.locator('[data-formulaire="simulation-reanalyse"]');
    await simulation.getByRole('button', { name: 'Lancer la simulation' }).click();
    await expect(simulation.getByLabel('Motif de la demande (obligatoire)')).toBeFocused();
    await simulation.getByLabel('Motif de la demande (obligatoire)').fill('Relire les anciennes factures avant la révision de clôture');
    await simulation.getByRole('button', { name: 'Lancer la simulation' }).click();
    const rapport = page.getByTestId('rapport-reanalyse');
    await expect(rapport).toBeVisible();
    await expect(rapport).toHaveAttribute('data-mode', 'simulation');
    await expect(rapport).toHaveAttribute('data-statut', 'termine', { timeout: 20_000 });
    await expect(page.getByTestId('resume-reanalyse')).toContainText('2 pièces sur 2 changeraient');
    await expect(page.getByTestId('resume-reanalyse')).toContainText('Rien n’a été modifié');
    await expect(page.getByTestId('decomptes-reanalyse').locator('[data-resultat="destinataire_trouve"]')).toContainText('Destinataire trouvé : 2');
    await expect(rapport.locator(`tr[data-resultat="destinataire_trouve"]`)).toHaveCount(2);
    await expect(page.getByTestId('desaccord-reanalyse')).toContainText('saisie humaine 732829320 conservée, lecture automatique 552100554');

    // La simulation n'a rien écrit : la pièce meunerie n'a toujours pas de lecture du destinataire, une seule version.
    await ouvrir(page, MEUNERIE);
    await expect(page.getByTestId('destinataire-non-lu')).toBeVisible();
    await page.getByTestId('historique-destinataire').locator('summary').click();
    await expect(page.getByTestId('historique-destinataire')).toContainText('Historique du destinataire (1 version de l’extraction)');

    // 2. Exécution : confirmation explicite requise.
    await page.goBack();
    await page.goBack();
    await expect(page.getByTestId('rapport-reanalyse')).toHaveAttribute('data-mode', 'simulation');
    const execution = page.locator('[data-formulaire="execution-reanalyse"]');
    await expect(execution).toContainText('nouvelle version d’extraction');
    await execution.getByLabel('Motif de la confirmation (obligatoire)').fill('Aperçu relu, exécution confirmée');
    await execution.getByRole('button', { name: 'Confirmer et exécuter la réanalyse' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Confirmez d’abord avoir lu l’aperçu' })).toBeVisible();
    await execution.getByRole('checkbox', { name: /J’ai lu le rapport de la simulation/ }).check();
    await execution.getByRole('button', { name: 'Confirmer et exécuter la réanalyse' }).click();
    const fin = page.getByTestId('rapport-reanalyse');
    await expect(fin).toHaveAttribute('data-mode', 'execution');
    await expect(fin).toHaveAttribute('data-statut', 'termine', { timeout: 20_000 });
    await expect(page.getByTestId('resume-reanalyse')).toContainText('2 nouvelles versions d’extraction créées');
    await expect(fin).toContainText('version 1 → 2');
    await expect(fin).toContainText('version 3 → 4');

    // Pièce meunerie : destinataire lu, ancienne version conservée dans l'historique.
    await ouvrir(page, MEUNERIE);
    await expect(page.getByTestId('destinataire-non-lu')).toHaveCount(0);
    await expect(ligne(page, 'destinataireSiren').locator('[data-colonne="retenue"]')).toContainText('123456782');
    await expect(ligne(page, 'destinataireSiren')).toContainText('Lecture automatique');
    await expect(page.getByTestId('sens-destinataire')).toContainText('Achat');
    await page.getByTestId('historique-destinataire').locator('summary').click();
    await expect(page.getByTestId('historique-destinataire')).toContainText('Historique du destinataire (2 versions de l’extraction)');
    // Pièce validée et corrigée à la main : la correction humaine n'est PAS écrasée, le désaccord est signalé.
    await ouvrir(page, LEVURE);
    const siren = ligne(page, 'destinataireSiren');
    await expect(siren.locator('[data-colonne="humaine"]')).toContainText('732829320');
    await expect(siren.locator('[data-colonne="automatique"]')).toContainText('552100554');
    await expect(siren.locator('[data-colonne="retenue"]')).toContainText('732829320');
    await expect(page.getByTestId('desaccord-destinataireSiren')).toBeVisible();
    await expect(siren).toContainText('Motif : Client confirmé par téléphone');

    // Idempotence : plus rien à réanalyser, les demandes passées restent consultables.
    await page.goto(`${dossier}/reanalyse-destinataire`);
    await expect(page.getByTestId('rien-a-reanalyser')).toBeVisible();
    await expect(page.getByTestId('nb-concernees')).toHaveText('0');
    await expect(page.locator('[data-formulaire="simulation-reanalyse"]')).toHaveCount(0);
    const demandes = page.getByRole('region', { name: 'Demandes de réanalyse du destinataire' });
    await expect(demandes.getByRole('row')).toHaveCount(3); // en-tête + simulation + exécution
    expect(erreurs).toEqual([]);
  });

  test('lot borné à 50 pièces : l’aperçu annonce les lots suivants ; la simulation ne retient que 50 pièces', async ({ page }) => {
    await simulateur('destinataire', { pieces: 60 });
    await page.goto(`${dossier}/reanalyse-destinataire`);
    await expect(page.getByTestId('nb-concernees')).toHaveText('62');
    await expect(page.getByTestId('nb-lot')).toContainText('50 (lots nécessaires : 2)');
    const simulation = page.locator('[data-formulaire="simulation-reanalyse"]');
    await expect(simulation).toContainText('Il reste 12 pièce(s) pour les lots suivants');
    await simulation.getByLabel('Motif de la demande (obligatoire)').fill('Premier lot');
    await simulation.getByRole('button', { name: 'Lancer la simulation' }).click();
    await expect(page.getByTestId('rapport-reanalyse')).toHaveAttribute('data-statut', 'termine', { timeout: 20_000 });
    await expect(page.getByTestId('rapport-reanalyse').locator('tbody tr')).toHaveCount(50);
  });
});

test.describe('déposant', () => {
  test.use({ storageState: etatDe('client') });
  test('le déposant n’a accès ni au destinataire ni à la réanalyse', async ({ page }) => {
    await page.goto(`${dossier}/reanalyse-destinataire`);
    await expect(page.getByText(/pas habilité|Accès refusé|Habilitation/i).first()).toBeVisible();
    await expect(page.getByTestId('apercu-reanalyse')).toHaveCount(0);
  });
});
