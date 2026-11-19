import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSimule, simulateur, surveiller } from '../outils';

test.use({ storageState: etatDe('client') });
test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('suivi des dépôts par le déposant (émulation mobile, API simulée)', () => {
  test('mes dépôts : demandes de complément en premier, statuts libellés, uniquement mes propres pièces', async ({ page }) => {
    const erreurs = surveiller(page);
    const reponse = await page.goto('/depots');
    expect(reponse!.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: 'Mes dépôts' })).toBeVisible();
    const aCompleter = page.getByTestId('depots-a-completer');
    await expect(aCompleter.getByRole('listitem')).toHaveCount(1);
    await expect(aCompleter).toContainText('photo-ticket-caisse.png');
    await expect(aCompleter).toContainText('À compléter');
    await expect(aCompleter).toContainText('Complément demandé');
    // Le bloc « À compléter » précède les autres pièces dans la page.
    const ordre = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="depots-a-completer"]')!;
      const b = document.querySelector('[data-testid="depots-autres"]')!;
      return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(ordre).toBe(true);
    const autres = page.getByTestId('depots-autres');
    await expect(autres.getByRole('listitem')).toHaveCount(2);
    await expect(autres).toContainText('À contrôler');
    await expect(autres).toContainText('Traité');
    // La pièce déposée par une collaboratrice du cabinet n'est pas visible du déposant.
    await expect(page.getByText('facture-electronique.xml')).toHaveCount(0);
    for (const lien of await page.getByRole('main').getByRole('listitem').getByRole('link').all()) expect((await lien.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(erreurs).toEqual([]);
  });

  test('détail : statut, champs « extraction automatique — projet » avec méthode et confiance, vérifications, aperçu, signalement', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/depots');
    await page.getByRole('link', { name: /facture-meunerie-2025-03\.pdf/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('facture-meunerie-2025-03.pdf');
    await expect(page.getByText('Statut :')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('À contrôler');
    await expect(page.getByText('Extraction automatique — projet')).toBeVisible();
    const ligne = (nom: string) => page.locator(`tr[data-champ="${nom}"]`);
    await expect(ligne('totalTtc')).toContainText('1 302,50'); // chaîne décimale mise en forme, sans flottant
    await expect(ligne('totalTtc')).toContainText('Règle');
    await expect(ligne('totalTtc')).toContainText('Non évaluée');
    await expect(ligne('dateEmission')).toContainText('12/03/2025');
    await expect(ligne('emetteurSiren')).toContainText('Non extrait');
    await expect(page.locator('[data-verification="ecart"]')).toContainText('Écart');
    await expect(page.locator('[data-verification="ok"]')).toContainText('Cohérent');
    await expect(page.locator('[data-verification="non_verifiable"]')).toContainText('Non vérifiable');
    // Aperçu servi par le BFF (fichier déclaré sain).
    await expect(page.getByTestId('apercu-piece')).toHaveAttribute('data-type', 'application/pdf');
    await expect(page.getByTitle('Aperçu de la pièce facture-meunerie-2025-03.pdf')).toHaveAttribute('src', /^blob:http:\/\/localhost:3000\//);

    const formulaire = page.locator('form[data-formulaire="signalement_erreur"]');
    await formulaire.getByLabel('Décrivez l’erreur constatée').fill('Le total TTC est de 1302,46 et non 1302,50.');
    await formulaire.getByRole('button', { name: 'Signaler une erreur' }).click();
    await expect(page.getByText('Signalement transmis au cabinet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Échanges' })).toBeVisible();
    expect((await etatSimule()).echanges.at(-1)).toMatchObject({ type: 'signalement_erreur', message: 'Le total TTC est de 1302,46 et non 1302,50.' });
    // Pièce validée par un réviseur : plus de mention « projet ».
    await page.goto('/depots');
    await page.getByRole('link', { name: /facture-levure-2025-02\.pdf/ }).click();
    await expect(page.getByText('Validé par un réviseur (version 2)')).toBeVisible();
    await expect(page.getByText('Extraction automatique — projet')).toHaveCount(0);
    await expect(page.locator('tr[data-champ="totalTtc"]')).toContainText('Saisie humaine');
    await expect(page.locator('tr[data-champ="totalHt"]')).toContainText('Donnée structurée');
    expect(erreurs).toEqual([]);
  });

  test('réponse à une demande de complément', async ({ page }) => {
    await page.goto('/depots');
    await page.getByRole('link', { name: /photo-ticket-caisse\.png/ }).click();
    await expect(page.getByTestId('demande-complement')).toContainText('Votre cabinet vous demande un complément');
    await expect(page.getByText('Le bas du ticket est coupé')).toBeVisible();
    await expect(page.getByText('Pièce illisible ou incomplète')).toBeVisible(); // motif du statut
    await expect(page.getByTestId('apercu-piece')).toHaveAttribute('data-type', 'image/png');
    await page.getByLabel('Votre réponse').fill('Je vous renvoie une photo complète.');
    await page.getByRole('button', { name: 'Envoyer la réponse' }).click();
    await expect(page.getByTestId('demande-complement')).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText('À contrôler');
    await expect(page.getByText('Répondue')).toBeVisible();
    const etat = await etatSimule();
    expect(etat.echanges.at(-1)).toMatchObject({ type: 'reponse' });
    expect(etat.documents.find((d) => d.nomOrigine === 'photo-ticket-caisse.png')!.statut).toBe('a_controler');
    await page.goto('/depots');
    await expect(page.getByTestId('depots-a-completer')).toHaveCount(0);
  });

  test('un déposant n’accède pas à l’espace cabinet : pages refusées proprement, API en 403/404', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/deposer$/); // pas de tableau de bord cabinet
    await page.goto('/dossiers');
    await expect(page.getByTestId('erreur-403')).toContainText('Accès refusé');
    for (const chemin of [`/dossiers/${ID.dupain}`, `/dossiers/${ID.dupain}/revision`, `/dossiers/${ID.dupain}/comptabilite`]) {
      await page.goto(chemin);
      await expect(page.getByTestId('erreur-403')).toBeVisible();
      await expect(page.getByText('Contrôles')).toHaveCount(0);
    }
    await page.goto(`/dossiers/${ID.leroy}`); // dossier d'un autre cabinet : existence non révélée
    await expect(page.getByTestId('erreur-404')).toBeVisible();
    await page.goto('/reference/controles');
    await expect(page.getByTestId('erreur-403')).toBeVisible();
    await page.goto('/depots/00000000-0000-4000-8000-000000000000');
    await expect(page.getByTestId('erreur-404')).toContainText('Introuvable');
    await page.goto('/depots/pas-un-identifiant');
    await expect(page.getByTestId('erreur-404')).toBeVisible();
    // Même en appelant le BFF directement, l'API refuse.
    const statuts = await page.evaluate(async (id) => {
      const s = async (c: string, init?: RequestInit) => (await fetch(`/api/bff/v1/${c}`, init)).status;
      const ecriture = { method: 'POST', headers: { 'X-Comtaple-Csrf': '1', 'Content-Type': 'application/json' } };
      return [await s(`dossiers/${id}/exercices`), await s(`exercices/aaaaaaaa-0000-4000-8000-0000000000f1/revue`), await s(`exercices/aaaaaaaa-0000-4000-8000-0000000000f1/controles`, ecriture)];
    }, ID.dupain);
    expect(statuts).toEqual([403, 404, 404]);
  });
});
