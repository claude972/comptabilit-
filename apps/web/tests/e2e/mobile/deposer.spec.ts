import { type Page, devices, expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { etatDe, etatSimule, journal, pdf, photoMauvaise, photoNette, seConnecter, sha256, simulateur, surveiller } from '../outils';

test.use({ storageState: etatDe('client') });
test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

const image = (nom: string, buffer: Buffer) => ({ name: nom, mimeType: 'image/png', buffer });
const fichierPdf = (nom: string, buffer: Buffer) => ({ name: nom, mimeType: 'application/pdf', buffer });
const enAttente = (page: Page) => page.getByTestId('liste-depots-en-attente').getByRole('listitem');
const recus = (page: Page) => page.getByTestId('liste-recus').getByRole('listitem');
/** Nombre de dépôts conservés dans IndexedDB sur l'appareil. */
const nbLocaux = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((ok) => {
        const o = indexedDB.open('comtaple-depots');
        o.onsuccess = () => {
          const bd = o.result;
          if (!bd.objectStoreNames.contains('depots')) return ok(0);
          const c = bd.transaction('depots').objectStore('depots').count();
          c.onsuccess = () => ok(c.result);
        };
        o.onerror = () => ok(-1);
      }),
  );
async function preparerPdf(page: Page, contenu: Buffer, nom = 'facture.pdf') {
  await page.getByTestId('entree-fichiers').setInputFiles(fichierPdf(nom, contenu));
  await page.getByRole('radio', { name: 'Facture d’achat' }).check();
}
const televersements = async () => (await journal()).filter((e) => e.chemin.startsWith('/v1/televersements'));

test.describe('dépôt depuis le téléphone (émulation mobile, API simulée)', () => {
  test('écran utilisable d’une main : dossier autorisé, boutons larges, appareil photo et photothèque', async ({ page }) => {
    const erreurs = surveiller(page);
    const reponse = await page.goto('/deposer');
    expect(reponse!.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: 'Déposer une pièce' })).toBeVisible();
    // Le déposant n'est habilité que sur un dossier : il est présélectionné.
    await expect(page.getByTestId('dossier-unique')).toHaveText('Boulangerie Dupain SAS (fictive)');

    const photo = page.getByTestId('entree-photo');
    await expect(photo).toHaveAttribute('accept', 'image/*');
    await expect(photo).toHaveAttribute('capture', 'environment');
    const fichiers = page.getByTestId('entree-fichiers');
    await expect(fichiers).toHaveAttribute('accept', 'image/*,application/pdf');
    await expect(fichiers).toHaveAttribute('multiple', '');

    const principal = await page.locator('label', { hasText: 'Ajouter une facture' }).boundingBox();
    expect(principal!.height).toBeGreaterThanOrEqual(56);
    expect(principal!.width).toBeGreaterThan(300);
    expect((await page.locator('label', { hasText: 'Depuis mes fichiers / ma photothèque' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText('Rien n’est envoyé tant que l’application est fermée.')).toBeVisible();
    await expect(page.getByText('reste en attente sur cet appareil')).toBeVisible();

    // Navigation du déposant : aucun lien vers l'espace cabinet.
    const liens = await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link').allInnerTexts();
    expect(liens).toEqual(['Déposer', 'Mes dépôts']);
    expect(await page.locator('a[href^="/dossiers"], a[href*="revision"], a[href^="/reference"]').count()).toBe(0);
    expect(erreurs).toEqual([]);
  });

  test('assemblage de pages : réordonner, pivoter, recadrer, supprimer, lisibilité indicative, PDF unique, « Reçu » seulement après terminer', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/deposer');
    await page.getByTestId('entree-photo').setInputFiles(image('page-a.png', photoNette(1)));
    const pages = page.getByTestId('liste-pages').getByRole('listitem');
    await expect(pages).toHaveCount(1);
    // Photo nette : l'indicateur ne signale rien, et se présente comme une indication.
    await expect(page.getByTestId('lisibilite')).toContainText('Aucun défaut évident détecté');
    await expect(page.getByTestId('lisibilite')).toContainText('il ne garantit pas');
    // Le bouton principal devient « Ajouter une page ».
    await expect(page.locator('label', { hasText: 'Ajouter une page' })).toBeVisible();
    await page.getByTestId('entree-fichiers').setInputFiles([image('page-b.png', photoMauvaise()), image('page-c.png', photoNette(2))]);
    await expect(pages).toHaveCount(3);
    // La photo sombre et petite est signalée… sans bloquer.
    await expect(pages.nth(1)).toContainText('Lisibilité à vérifier');
    await page.getByRole('button', { name: 'Ajuster la page 2 (rotation, recadrage)' }).click();
    const editeur = page.getByTestId('editeur-page');
    await expect(editeur.getByTestId('lisibilite')).toContainText('Résolution faible');
    await expect(editeur.getByTestId('lisibilite')).toContainText('floue');
    await expect(editeur.getByTestId('lisibilite')).toContainText('trop sombre');
    await expect(editeur.getByTestId('lisibilite')).toContainText('ne vous empêche pas');
    // Suppression de la mauvaise page.
    await editeur.getByRole('button', { name: 'Supprimer la page' }).click();
    await expect(pages).toHaveCount(2);

    // Réordonner : la page 2 passe en tête, puis revient.
    const source = (i: number) => pages.nth(i).locator('img').getAttribute('src');
    const [a, b] = [await source(0), await source(1)];
    await page.getByRole('button', { name: 'Monter la page 2' }).click();
    expect([await source(0), await source(1)]).toEqual([b, a]);
    await expect(page.getByRole('button', { name: 'Monter la page 1' })).toBeDisabled();
    await page.getByRole('button', { name: 'Descendre la page 1' }).click();
    expect([await source(0), await source(1)]).toEqual([a, b]);

    // Page 1 : rotation d'un quart de tour (portrait → paysage) et recadrage au curseur puis à la poignée.
    await page.getByRole('button', { name: 'Ajuster la page 1 (rotation, recadrage)' }).click();
    const apercu = editeur.getByRole('img', { name: 'Aperçu de la page 1' });
    const dimensions = () => apercu.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
    await expect.poll(dimensions).toEqual([750, 1000]);
    await editeur.getByRole('button', { name: 'Pivoter d’un quart de tour' }).click();
    await expect.poll(dimensions).toEqual([1000, 750]);
    await editeur.getByLabel(/Rogner à gauche/).fill('20');
    await expect(editeur.getByText('Rogner à gauche : 20 %')).toBeVisible();
    const poignee = (await editeur.locator('[data-poignee="bd"]').boundingBox())!;
    expect(Math.min(poignee.width, poignee.height)).toBeGreaterThanOrEqual(44); // zone de prise tactile
    const cadre = (await apercu.boundingBox())!;
    await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
    await page.mouse.down();
    await page.mouse.move(poignee.x + poignee.width / 2 - cadre.width * 0.3, poignee.y + poignee.height / 2 - cadre.height * 0.25, { steps: 5 });
    await page.mouse.up();
    await expect(editeur.getByText('Rogner à droite : 30 %')).toBeVisible();
    await expect(editeur.getByText('Rogner en bas : 25 %')).toBeVisible();
    await editeur.getByRole('button', { name: 'Terminer' }).click();
    await expect(pages.nth(0)).toContainText('Recadrée');

    await expect(page.getByTestId('mention-assemblage')).toContainText('assemblage de vos photos');
    await expect(page.getByTestId('mention-assemblage')).toContainText('vos 2 pages sont réunies');
    // Sans nature choisie, l'envoi est impossible.
    await expect(page.getByTestId('envoyer')).toBeDisabled();
    await page.getByRole('radio', { name: 'Je ne sais pas' }).check();
    await page.getByLabel('Commentaire pour le cabinet (facultatif)').fill('Deux pages recto verso');

    // On retient la réponse de « terminer » : tant qu'elle n'est pas arrivée, rien ne doit afficher « Reçu ».
    let liberer!: () => void;
    const retenue = new Promise<void>((ok) => (liberer = ok));
    await page.route('**/api/bff/v1/televersements/*/terminer', async (route) => {
      await retenue;
      await route.continue();
    });
    const morceaux: Buffer[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/morceaux')) morceaux.push(r.postDataBuffer()!);
    });
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toHaveCount(1);
    await expect(enAttente(page)).toContainText('100 % confirmés par le serveur');
    await expect(enAttente(page)).toContainText('Envoi en cours');
    await expect(enAttente(page)).toContainText('assemblage de 2 photos');
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
    await expect(page.getByText('Reçu', { exact: true })).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(1);
    await expect(page.getByTestId('annonce-envoi')).toContainText('Envoi en cours, 100 %');
    expect((await etatSimule()).documents.some((d) => d.nomOrigine.startsWith('photos-'))).toBe(false);

    liberer();
    await expect(recus(page)).toHaveCount(1);
    await expect(recus(page)).toContainText('Reçu');
    await expect(recus(page)).toContainText('assemblage de vos photos');
    await expect(page.getByTestId('liste-depots-en-attente')).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(0); // entrée locale supprimée dès la confirmation du serveur

    // Protocole : ouverture, morceaux contigus de 32 768 octets confirmés un à un, clôture.
    const appels = await televersements();
    expect(appels[0]).toMatchObject({ methode: 'POST', chemin: '/v1/televersements', statut: 201 });
    expect(appels.at(-1)).toMatchObject({ methode: 'POST', statut: 200 });
    expect(appels.at(-1)!.chemin).toMatch(/\/terminer$/);
    const decalages = appels.filter((e) => e.methode === 'PUT').map((e) => Number(new URL(`http://x${e.chemin}`).searchParams.get('decalage')));
    expect(decalages.length).toBeGreaterThan(2);
    expect(decalages).toEqual(decalages.map((_, i) => i * 32768));

    // Le fichier reçu est bien UN PDF de deux pages : la première, pivotée et recadrée, est en paysage.
    const envoye = Buffer.concat(morceaux);
    const doc = (await etatSimule()).documents.find((d) => d.nomOrigine.startsWith('photos-'))!;
    expect(doc).toMatchObject({ nature: 'a_qualifier', statut: 'recu', commentaire: 'Deux pages recto verso', canal: 'telephone', entete: '%PDF-', taille: envoye.length, sha256: sha256(envoye) });
    const lu = await PDFDocument.load(envoye);
    expect(lu.getPageCount()).toBe(2);
    const [p1, p2] = lu.getPages().map((p) => p.getSize());
    // Page 1 : 1600×1200 après rotation, rognée de 20 % + 30 % en largeur et 25 % en hauteur → 800×900.
    expect(p1!.width / p1!.height).toBeCloseTo(800 / 900, 1);
    expect(p2!.width / p2!.height).toBeCloseTo(1200 / 1600, 2);

    // Le lien de suivi mène à la pièce ; l'aperçu n'est pas proposé tant que l'antivirus n'a pas conclu.
    await recus(page).getByRole('link', { name: 'Suivre cette pièce' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('photos-');
    await expect(page.getByTestId('apercu-indisponible')).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('un PDF importé seul est envoyé tel quel ; le renvoyer signale « déjà reçue »', async ({ page }) => {
    await page.goto('/deposer');
    const original = pdf('tel-quel');
    await preparerPdf(page, original, 'facture-fournisseur.pdf');
    await expect(page.getByTestId('liste-pdf')).toContainText('facture-fournisseur.pdf');
    await expect(page.getByText('Chaque PDF est envoyé tel quel')).toBeVisible();
    await expect(page.getByTestId('mention-assemblage')).toHaveCount(0);
    await page.getByTestId('envoyer').click();
    await expect(recus(page)).toHaveCount(1);
    const doc = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-fournisseur.pdf')!;
    expect(doc.sha256).toBe(sha256(original)); // octets strictement identiques
    expect(doc.taille).toBe(original.length);
    expect(doc.nature).toBe('facture_achat');
    await expect(recus(page).first()).not.toContainText('déjà été reçue');

    await preparerPdf(page, original, 'facture-fournisseur.pdf');
    await page.getByTestId('envoyer').click();
    await expect(recus(page)).toHaveCount(2);
    await expect(recus(page).first()).toContainText('Cette pièce avait déjà été reçue');
    expect((await etatSimule()).documents.filter((d) => d.sha256 === sha256(original))).toHaveLength(1);
  });

  test('coupure réseau en cours d’envoi : « Interrompu — reprendre », dépôt conservé, reprise au bon décalage à la réouverture', async ({ page, context }) => {
    await page.goto('/deposer');
    const contenu = pdf('coupure');
    // La 3e requête de morceau n'aboutit pas (connexion perdue entre le téléphone et le serveur).
    let n = 0;
    await page.route('**/api/bff/v1/televersements/*/morceaux*', (route) => (++n === 3 ? route.abort('connectionfailed') : route.continue()));
    await preparerPdf(page, contenu);
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('Interrompu — reprendre');
    await expect(enAttente(page).getByRole('button', { name: 'Reprendre l’envoi' })).toBeVisible();
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(1);
    const avant = (await etatSimule()).televersements[0]!;
    expect(avant).toMatchObject({ statut: 'ouvert', octetsRecus: 65536 });

    // Fermeture de l'application, puis réouverture : la reprise est automatique, à partir de l'état du serveur.
    await page.close();
    await simulateur('pannes', {});
    const rouverte = await context.newPage();
    await rouverte.goto('/deposer');
    await expect(recus(rouverte)).toHaveCount(1);
    expect(await nbLocaux(rouverte)).toBe(0);
    const appels = (await televersements()).filter((e) => e.statut < 400);
    const reprise = appels.slice(appels.findIndex((e) => e.methode === 'GET'));
    expect(reprise[0]!.chemin).toBe(`/v1/televersements/${avant.id}`);
    expect(reprise[1]).toMatchObject({ methode: 'PUT', chemin: `/v1/televersements/${avant.id}/morceaux?decalage=65536` }); // pas de renvoi depuis le début
    const doc = (await etatSimule()).documents.find((d) => d.sha256 === sha256(contenu));
    expect(doc?.taille).toBe(contenu.length);
  });

  test('réponse perdue après réception d’un morceau : bouton « Reprendre », le serveur fait foi (aucun octet renvoyé en double)', async ({ page }) => {
    await page.goto('/deposer');
    const contenu = pdf('reponse-perdue');
    await simulateur('pannes', { couperMorceauNumero: 2 }); // le serveur enregistre le 2e morceau puis coupe sans répondre
    await preparerPdf(page, contenu);
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('Interrompu — reprendre');
    await expect(enAttente(page)).toContainText(/\d+ % confirmés par le serveur/);
    expect((await etatSimule()).televersements[0]!.octetsRecus).toBe(65536); // le serveur a 2 morceaux, le client n'en a confirmé qu'un
    await enAttente(page).getByRole('button', { name: 'Reprendre l’envoi' }).click();
    await expect(recus(page)).toHaveCount(1);
    const puts = (await televersements()).filter((e) => e.methode === 'PUT').map((e) => e.chemin.split('decalage=')[1]);
    expect(puts.filter((d) => d === '32768')).toHaveLength(1);
    expect(puts.slice(0, 3)).toEqual(['0', '32768', '65536']);
    expect((await etatSimule()).documents.some((d) => d.sha256 === sha256(contenu))).toBe(true);
  });

  test('409 « décalage inattendu » : l’envoi se recale sur octetsRecus et aboutit', async ({ page }) => {
    await page.goto('/deposer');
    const contenu = pdf('conflit');
    await simulateur('pannes', { conflitMorceauNumero: 2 });
    await preparerPdf(page, contenu);
    await page.getByTestId('envoyer').click();
    await expect(recus(page)).toHaveCount(1);
    const appels = await televersements();
    expect(appels.filter((e) => e.statut === 409)).toHaveLength(1);
    expect((await etatSimule()).documents.some((d) => d.sha256 === sha256(contenu))).toBe(true);
  });

  test('hors connexion : « En attente de connexion », conservation dans IndexedDB, envoi au retour du réseau', async ({ page, context }) => {
    await page.goto('/deposer');
    await expect(page.getByTestId('dossier-unique')).toBeVisible();
    await page.waitForLoadState('networkidle'); // l'assembleur PDF est préchargé tant qu'il y a du réseau
    await context.setOffline(true);
    await expect(page.getByText('Vous êtes hors connexion')).toBeVisible();
    await page.getByTestId('entree-photo').setInputFiles(image('ticket.png', photoNette(3, 600, 800)));
    await page.getByRole('radio', { name: 'Autre' }).check();
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('En attente de connexion');
    await expect(enAttente(page)).toContainText('0 % confirmés par le serveur');
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(1);
    expect(await televersements()).toHaveLength(0); // rien n'est parti
    // Le fichier assemblé est dans IndexedDB, pas dans le cache du service worker.
    const caches = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const nom of await window.caches.keys()) for (const r of await (await window.caches.open(nom)).keys()) urls.push(r.url);
      return urls;
    });
    expect(caches.filter((u) => /\.pdf|televersements|\/api\//.test(u))).toEqual([]);

    await context.setOffline(false);
    await expect(recus(page)).toHaveCount(1);
    expect(await nbLocaux(page)).toBe(0);
    expect((await etatSimule()).documents.filter((d) => d.nomOrigine.startsWith('photos-') && d.nature === 'autre')).toHaveLength(1);
  });

  test('« Supprimer ce dépôt en attente » efface le fichier de l’appareil ; refus du serveur (empreinte) affiché sans « Reçu »', async ({ page }) => {
    await page.goto('/deposer');
    await simulateur('pannes', { erreurTerminer: 50 });
    await preparerPdf(page, pdf('a-supprimer'));
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('Interrompu — reprendre');
    await expect(enAttente(page)).toContainText('100 % confirmés par le serveur'); // tout est envoyé mais non confirmé : pas « Reçu »
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(1);
    await enAttente(page).getByRole('button', { name: 'Supprimer ce dépôt en attente' }).click();
    await expect(page.getByTestId('liste-depots-en-attente')).toHaveCount(0);
    expect(await nbLocaux(page)).toBe(0);
    await page.reload();
    await expect(page.getByTestId('dossier-unique')).toBeVisible();
    await expect(page.getByTestId('liste-depots-en-attente')).toHaveCount(0);

    // Empreinte annoncée fausse (corps altéré en route) : le serveur refuse à la clôture.
    await simulateur('pannes', { erreurTerminer: 0 });
    await page.route(/\/morceaux\?decalage=0$/, async (route) => {
      const corps = Buffer.from(route.request().postDataBuffer()!);
      corps[10] = corps[10]! ^ 0xff;
      await route.continue({ postData: corps });
    });
    await preparerPdf(page, pdf('altere'));
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('Refusé');
    await expect(enAttente(page)).toContainText('ne correspond pas à l’empreinte annoncée');
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
  });

  test('déconnexion : les dépôts en attente sont purgés de l’appareil', async ({ browser }) => {
    // Session propre à ce test : la déconnexion clôt la session Keycloak.
    const contexte = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:3000', locale: 'fr-FR', storageState: { cookies: [], origins: [] } });
    const page = await contexte.newPage();
    await seConnecter(page, 'client', '/deposer');
    await simulateur('pannes', { erreurTerminer: 50 });
    await preparerPdf(page, pdf('avant-deconnexion'));
    await page.getByTestId('envoyer').click();
    await expect(enAttente(page)).toContainText('Interrompu — reprendre');
    expect(await nbLocaux(page)).toBe(1);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.waitForURL(/\/connexion\?deconnecte=1/);
    await expect(page.getByText('Les dépôts en attente ont été effacés de cet appareil')).toBeVisible();
    expect(await nbLocaux(page)).toBe(0);
    await contexte.close();
  });
});
