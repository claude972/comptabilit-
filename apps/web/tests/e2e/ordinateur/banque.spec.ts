import { type LigneFec, analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique } from '@comtaple/core';
import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, journal, simulateur, surveiller } from '../outils';

/**
 * Onglet Banque contre le simulateur d'API. Le FEC et le relevé sont des jeux SYNTHÉTIQUES cohérents entre eux ;
 * le simulateur les lit et les rapproche avec le vrai moteur (@comtaple/core), seuls stockage et délais sont simulés.
 */
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 600, graine: 4242 });
let releve: ReturnType<typeof genererReleveSynthetique>;
const banque = `/dossiers/${ID.dupain}/banque`;
const pieceJointe = (nom: string, contenu: string | Uint8Array, type = 'text/plain') => ({ name: nom, mimeType: type, buffer: Buffer.from(contenu) });

test.beforeAll(async () => {
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
  releve = genererReleveSynthetique({ graine: 4242, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 150, coherentAvec: lignes });
  if (releve.attendu.nbMouvements <= 100) throw new Error('jeu synthétique trop petit pour tester la pagination des mouvements');
});
test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

/** Importe le FEC synthétique par l'onglet Comptabilité et attend le nouveau lot actif. */
async function importerFec(page: Page) {
  await page.goto(`/dossiers/${ID.dupain}/comptabilite`);
  await page.getByTestId('entree-fec').setInputFiles(pieceJointe(fec.nomFichier, fec.contenu));
  await page.getByRole('radio', { name: 'FEC', exact: true }).check();
  await page.getByRole('button', { name: 'Importer' }).click();
  await expect(page.locator('tr[data-actif="true"]')).toContainText('v3', { timeout: 20_000 });
  await expect(page.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true');
}
async function importerReleve(page: Page, nom: string, contenu: string) {
  await page.goto(banque);
  await page.getByTestId('entree-releve').setInputFiles(pieceJointe(nom, contenu, 'application/xml'));
  await expect(page.getByTestId('liste-envois').getByRole('listitem')).toContainText('Reçu');
}
const imports = (page: Page) => page.getByTestId('imports-releves').getByRole('listitem');

test.describe('banque — collaboratrice (collaboration)', () => {
  test.use({ storageState: etatDe('chloe') });

  test('import d’un relevé camt.053 : suivi, mouvements, cadrage ; réimport sans doublon ; écart ; CSV à confirmer puis « non vérifiable »', async ({ page }) => {
    test.setTimeout(120_000);
    const erreurs = surveiller(page);
    await page.goto(banque);
    await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Banque' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('cela ne dépend d’aucune connexion bancaire')).toBeVisible();
    // Agrégation bancaire : aucun prestataire n'est connecté, l'écran le dit et ne propose aucune récupération automatique.
    const agregation = page.getByTestId('agregation-bancaire');
    await expect(agregation).toContainText('Agrégation bancaire : Non connectée');
    await expect(agregation).toContainText('Aucun prestataire d’agrégation choisi ni contracté');
    await expect(agregation.getByRole('button')).toHaveCount(0);
    await expect(page.getByText('camt.053')).toBeVisible();
    await expect(page.getByText('Aucun relevé importé pour ce dossier.')).toBeVisible();

    const ouverture = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/televersements'));
    await page.getByTestId('entree-releve').setInputFiles(pieceJointe(releve.nomFichier, releve.contenu, 'application/xml'));
    expect((await ouverture).postDataJSON()).toMatchObject({ usage: 'banque', canal: 'ordinateur', entiteId: ID.dupain });
    await expect(page.getByTestId('liste-envois').getByRole('listitem')).toContainText('Reçu');
    // Suivi par interrogation de GET v1/imports/:id jusqu'à la fin de la lecture.
    await expect(imports(page)).toHaveCount(1);
    await expect(imports(page).first()).toContainText(`${releve.attendu.nbMouvements} mouvements lus · ${releve.attendu.nbMouvements} nouveaux · 0 déjà connu`, { timeout: 20_000 });
    await expect(imports(page).first()).toContainText('camt.053');
    expect((await journal()).some((e) => e.methode === 'GET' && /^\/v1\/imports\/[0-9a-f-]{36}$/.test(e.chemin))).toBe(true);

    const ligne = page.locator('tr[data-releve]');
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText(`•••• ${releve.attendu.iban.slice(-4)}`);
    expect(await page.content()).not.toContain(releve.attendu.iban); // IBAN jamais affiché en entier
    await expect(ligne).toContainText('01/01/2025 → 31/12/2025');
    await expect(ligne.locator('[data-cadrage="ok"]')).toHaveText('Cadré');

    // Mouvements : pagination serveur (100 par page) et filtre de période ; montants signés mis en forme depuis la chaîne.
    const lignesMouvements = page.getByRole('region', { name: 'Mouvements bancaires importés' }).locator('tbody tr');
    await expect(lignesMouvements).toHaveCount(100);
    await expect(page.locator('[data-sens="decaissement"]').first()).toContainText('−');
    await expect(page.locator('[data-sens="encaissement"]').first()).toContainText('encaissement');
    await page.getByRole('navigation', { name: 'Pagination des mouvements' }).getByRole('link', { name: 'Suivants →' }).click();
    await expect(lignesMouvements).toHaveCount(releve.attendu.nbMouvements - 100);
    await page.getByLabel('Du', { exact: true }).fill('2025-03-01');
    await page.getByLabel('Au', { exact: true }).fill('2025-03-31');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page).toHaveURL(/du=2025-03-01&au=2025-03-31/);
    const attendusMars = releve.attendu.mouvements.filter((m) => m.dateOperation >= '2025-03-01' && m.dateOperation <= '2025-03-31').length;
    await expect(lignesMouvements).toHaveCount(attendusMars);

    // Réimport du même fichier : aucun nouvel import, aucun mouvement dupliqué.
    await importerReleve(page, releve.nomFichier, releve.contenu);
    await expect(page.getByTestId('liste-envois')).toContainText('avait déjà été importé dans ce dossier');
    await expect(imports(page)).toHaveCount(1);
    await expect(page.getByRole('heading', { name: `Mouvements bancaires (${releve.attendu.nbMouvements} au total)` })).toBeVisible();

    // Même relevé amputé d'une opération : mouvements déjà connus, et cadrage en ÉCART avec son montant.
    await importerReleve(page, 'releve-incomplet.xml', releve.contenu.replace(/<Ntry>.*?<\/Ntry>/s, ''));
    await expect(imports(page)).toHaveCount(2);
    await expect(imports(page).first()).toContainText(`0 nouveau · ${releve.attendu.nbMouvements - 1} déjà connus`, { timeout: 20_000 });
    const ecart = page.locator('[data-cadrage="ecart"]');
    await expect(ecart).toHaveText(/^Écart : −?[\d ]+,\d{2}$/);

    // Fichier qui n'est pas un relevé : échec avec son motif, rien d'enregistré.
    await importerReleve(page, 'releve.pdf', '%PDF-1.4 ceci n’est pas un relevé');
    await expect(imports(page).first()).toContainText('Échec de l’import', { timeout: 20_000 });
    await expect(imports(page).first()).toContainText('Format de relevé non reconnu');
    await expect(imports(page).first()).toContainText('Aucun mouvement de ce fichier n’a été enregistré');

    // CSV aux colonnes non reconnues : le logiciel s'abstient, l'utilisateur confirme le profil.
    await importerReleve(page, 'export-banque.csv', 'Quand;Quoi;Combien\n05/02/2024;Abonnement <b>logiciel</b>;-12,50\n06/02/2024;Remise de chèques;100,00\n');
    const csv = imports(page).first();
    await expect(csv).toContainText('Import en attente de votre confirmation', { timeout: 20_000 });
    const profil = csv.locator('form[data-formulaire="profil-csv"]');
    await expect(profil).toContainText('C’est vous qui confirmez le profil de colonnes, pas le logiciel');
    await expect(profil.getByTestId('raisons-profil')).toContainText('Séparateur « ; »');
    // Aperçu : lignes brutes en texte (jamais interprétées), découpage selon le séparateur plausible, colonnes numérotées.
    const apercu = profil.getByTestId('apercu-csv');
    await expect(apercu.getByTestId('apercu-lignes-brutes')).toContainText('Quand;Quoi;Combien');
    await expect(apercu.getByTestId('apercu-lignes-brutes')).toContainText('Abonnement <b>logiciel</b>;-12,50');
    await expect(apercu.locator('b')).toHaveCount(0);
    await expect(apercu.getByRole('columnheader')).toHaveText(['Colonne 1Quand', 'Colonne 2Quoi', 'Colonne 3Combien']);
    await expect(apercu.getByRole('cell', { name: '-12,50' })).toBeVisible();
    await expect(apercu.getByTestId('apercu-tronque')).toHaveCount(0);
    await expect(profil.getByTestId('profil-propose')).toHaveCount(0); // aucune proposition : rien n'est pré-rempli
    await expect(profil.getByLabel('Colonne de la date')).toHaveValue('');
    await expect(profil.getByLabel('Séparateur', { exact: true }).getByRole('option')).toHaveText(['Point-virgule ( ; )']); // seul séparateur plausible d'après l'API
    await expect(profil.getByLabel('Séparateur', { exact: true })).toHaveValue(';');
    await profil.getByRole('button', { name: 'Je confirme ce profil et relance la lecture' }).click();
    await expect(profil.getByRole('alert')).toContainText('Indiquez la colonne « date »');
    expect((await journal()).some((e) => e.chemin.endsWith('/relancer'))).toBe(false);
    await profil.getByLabel('Colonne de la date').fill('Quand');
    await profil.getByLabel('Colonne du libellé').fill('Quoi');
    await profil.getByLabel('Colonne du montant').fill('3');
    const relance = page.waitForRequest((r) => r.url().endsWith('/relancer'));
    await profil.getByRole('button', { name: 'Je confirme ce profil et relance la lecture' }).click();
    expect((await relance).postDataJSON()).toEqual({ profilCsv: { separateur: ';', lignesEntete: 1, colonnes: { date: 'Quand', libelle: 'Quoi', montant: 2 }, formatDate: 'JJ/MM/AAAA', decimale: ',' } });
    await expect(imports(page).first()).toContainText('2 mouvements lus · 2 nouveaux', { timeout: 20_000 });
    await expect(imports(page).first()).toContainText('profil confirmé par un utilisateur');
    await expect(page.locator('form[data-formulaire="profil-csv"]')).toHaveCount(0);

    // Trois états de cadrage, trois rendus : « non vérifiable » ne ressemble ni à « cadré » ni à un écart.
    const nonVerifiable = page.locator('[data-cadrage="non_verifiable"]');
    await expect(nonVerifiable).toHaveText('Non vérifiable (solde manquant)');
    const rendu = (c: string) =>
      page.locator(`[data-cadrage="${c}"]`).first().evaluate((e) => {
        const s = getComputedStyle(e);
        return { fond: s.backgroundColor, bordure: s.borderTopStyle, texte: s.color, icone: e.querySelector('svg')!.innerHTML };
      });
    const [ok, enEcart, nv] = [await rendu('ok'), await rendu('ecart'), await rendu('non_verifiable')];
    expect(new Set([ok.fond, enEcart.fond, nv.fond]).size).toBe(3);
    expect(new Set([ok.icone, enEcart.icone, nv.icone]).size).toBe(3);
    expect(nv.bordure).toBe('dashed');
    expect(nv.texte).not.toBe(ok.texte);
    // Libellé bancaire hostile : texte brut.
    await page.getByLabel('Du', { exact: true }).fill('2024-02-01');
    await page.getByLabel('Au', { exact: true }).fill('2024-02-28');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page.getByRole('cell', { name: 'Abonnement <b>logiciel</b>' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Abonnement/ })).toContainText('−12,50');
    expect(erreurs).toEqual([]);
  });

  test('rapprochement : refus sans données, lancement avec paramètres, synthèse et propositions ; pas de décision sans habilitation de révision', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(banque);
    const lancer = page.locator('form[data-formulaire="lancer-rapprochement"]');
    await expect(page.getByTestId('mention-proposition')).toContainText('Proposition du moteur — valider ne modifie aucune écriture dans votre logiciel comptable.');
    await expect(page.getByText('Aucun rapprochement n’a encore été lancé pour cet exercice.')).toBeVisible();
    await lancer.getByRole('button', { name: 'Lancer le rapprochement' }).click();
    await expect(lancer.getByRole('alert')).toContainText('Aucun mouvement bancaire importé sur la période de l’exercice');

    await importerFec(page);
    await importerReleve(page, releve.nomFichier, releve.contenu);
    await expect(imports(page).first()).toContainText('mouvements lus', { timeout: 20_000 });

    // Paramètres avancés repliés, valeurs par défaut lues dans la référence de l'API.
    await expect(lancer.getByLabel('Tolérance de montant')).toBeHidden();
    await lancer.getByText('Paramètres avancés').click();
    await expect(lancer.getByLabel('Tolérance de montant')).toHaveValue('0,00');
    await expect(lancer.getByLabel('Fenêtre des correspondances exactes (jours)')).toHaveValue('5');
    await expect(lancer.getByLabel('Fenêtre des règles (jours)')).toHaveValue('45');
    await expect(lancer.getByLabel('Paiements partiels')).toBeChecked();
    await lancer.getByLabel('Tolérance de montant').fill('abc');
    await lancer.getByRole('button', { name: 'Lancer le rapprochement' }).click();
    await expect(lancer.getByRole('alert')).toContainText('Tolérance de montant');
    await lancer.getByLabel('Tolérance de montant').fill('0,05');
    const demande = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/rapprochements'));
    await lancer.getByRole('button', { name: 'Lancer le rapprochement' }).click();
    expect((await demande).postDataJSON()).toEqual({ parametres: { toleranceMontant: '0.05' } }); // chaîne décimale, seuls les écarts aux défauts
    await expect(page.getByText('Rapprochement en cours de calcul')).toBeVisible();

    const synthese = page.getByTestId('synthese-rapprochement');
    await expect(synthese).toBeVisible({ timeout: 20_000 });
    await expect(synthese).toContainText('Une ambiguïté (plusieurs solutions équivalentes) n’est jamais tranchée par le logiciel');
    await expect(synthese).toContainText('la recherche a été interrompue par une borne de calcul, pas qu’il n’existe aucune solution');
    const attendu = releve.attendu.coherence!;
    const propositions = page.getByTestId('propositions').getByRole('listitem').filter({ has: page.locator('code') });
    const nombre = await page.locator('[data-proposition]').count();
    expect(nombre).toBeGreaterThanOrEqual(attendu.appariements.filter((a) => a.nature === 'exact').length);
    await expect(synthese).toContainText(`Propositions : ${nombre}`);
    await expect(synthese).toContainText(/EXACT-(REFERENCE|MONTANT-DATE)/);
    const premiere = page.locator('[data-proposition]').first();
    await expect(premiere).toContainText('Proposé');
    await expect(premiere).toContainText('Écritures comptables');
    await expect(premiere).toContainText('Mouvements bancaires');
    await expect(premiere).toContainText(/Débit [\d ]+,\d{2} · Crédit [\d ]+,\d{2}/);
    await premiere.getByText(/^Critères \(\d+\)$/).click();
    await expect(premiere.getByText('Satisfait', { exact: true }).first()).toBeVisible();
    void propositions;
    // Éléments non rapprochés : totaux réels annoncés par l'API.
    await expect(page.getByTestId('mouvements-sans-ecriture').getByRole('heading')).toContainText(/Mouvements sans écriture \(\d+\)/);
    await expect(page.getByTestId('ecritures-sans-mouvement').getByRole('heading')).toContainText(/Écritures de banque sans mouvement \(\d+\)/);
    // Niveau collaboration : aucune action de décision.
    await expect(page.getByRole('button', { name: 'Valider' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rejeter' })).toHaveCount(0);
    const id = await premiere.getAttribute('data-proposition');
    const statut = await page.evaluate(async (x) => (await fetch(`/api/bff/v1/rapprochements/${x}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ decision: 'valider' }) })).status, id);
    expect(statut).toBe(403);
  });
});

test.describe('banque — réviseur', () => {
  test.use({ storageState: etatDe('remi') });

  test('décisions : valider, rejeter avec motif obligatoire, remettre en proposition ; calcul obsolète = validation impossible', async ({ page }) => {
    test.setTimeout(120_000);
    await importerFec(page);
    await importerReleve(page, releve.nomFichier, releve.contenu);
    await expect(imports(page).first()).toContainText('mouvements lus', { timeout: 20_000 });
    await page.locator('form[data-formulaire="lancer-rapprochement"]').getByRole('button', { name: 'Lancer le rapprochement' }).click();
    await expect(page.getByTestId('synthese-rapprochement')).toBeVisible({ timeout: 20_000 });
    const p1 = page.locator('[data-proposition]').nth(0);
    const p2 = page.locator('[data-proposition]').nth(1);
    const [id1, id2] = [await p1.getAttribute('data-proposition'), await p2.getAttribute('data-proposition')];
    const prop = (id: string | null) => page.locator(`[data-proposition="${id}"]`);

    await prop(id1).getByRole('button', { name: 'Valider' }).click();
    await expect(prop(id1)).toHaveAttribute('data-statut', 'valide');
    await expect(prop(id1)).toContainText('Validé');
    await expect(prop(id1).getByRole('button', { name: 'Valider' })).toHaveCount(0);

    await prop(id2).getByRole('button', { name: 'Rejeter' }).click();
    await prop(id2).getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(prop(id2).getByRole('alert')).toContainText('Un motif est requis pour rejeter');
    expect((await journal()).filter((e) => e.methode === 'PATCH')).toHaveLength(1);
    await prop(id2).getByLabel('Motif du rejet (obligatoire)').fill('Ce règlement concerne une autre facture.');
    await prop(id2).getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(prop(id2)).toHaveAttribute('data-statut', 'rejete');
    await expect(prop(id2)).toContainText('Motif du rejet : Ce règlement concerne une autre facture.');
    await expect(page.getByTestId('synthese-rapprochement')).toContainText('Validées : 1');
    await expect(page.getByTestId('synthese-rapprochement')).toContainText('Rejetées : 1');
    const etat = await simulateur<{ propositions: Array<{ id: string; statut: string; motif: string | null }> }>('administration', {});
    expect(etat.propositions.find((x) => x.id === id1)).toMatchObject({ statut: 'valide' });
    expect(etat.propositions.find((x) => x.id === id2)).toMatchObject({ statut: 'rejete', motif: 'Ce règlement concerne une autre facture.' });

    await prop(id2).getByRole('button', { name: 'Remettre en proposition' }).click();
    await expect(prop(id2)).toHaveAttribute('data-statut', 'propose');

    // Les données changent : bandeau, validation désactivée, et l'API répond 409 à une validation forcée.
    await simulateur('administration', { obsoleteRapprochement: true });
    await page.reload();
    await expect(page.getByTestId('rapprochement-obsolete')).toContainText('Les données ont changé : relancez le rapprochement');
    await expect(prop(id2).getByRole('button', { name: 'Valider' })).toBeDisabled();
    await expect(prop(id2).getByRole('button', { name: 'Rejeter' })).toBeEnabled();
    const force = await page.evaluate(async (x) => (await fetch(`/api/bff/v1/rapprochements/${x}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ decision: 'valider' }) })).status, id2);
    expect(force).toBe(409);
  });
});

test.describe('banque — non habilité', () => {
  test.use({ storageState: etatDe('alice') });
  test('onglet Banque refusé sur un dossier sans habilitation ; déposant refusé', async ({ page, browser }) => {
    await page.goto(`/dossiers/${ID.martin}/banque`);
    await expect(page.getByTestId('erreur-403')).toContainText('Vous n’êtes pas habilité à consulter ce dossier');
    expect(await page.evaluate(async (id) => (await fetch(`/api/bff/v1/dossiers/${id}/banque`)).status, ID.martin)).toBe(404);
    const client = await browser.newContext({ storageState: etatDe('client') });
    const p = await client.newPage();
    await p.goto(`http://localhost:3000${banque}`);
    await expect(p.getByTestId('erreur-403')).toBeVisible();
    expect(await p.evaluate(async (id) => (await fetch(`/api/bff/v1/dossiers/${id}/banque`)).status, ID.dupain)).toBe(403);
    await client.close();
  });
});

test.describe('aperçu d’un CSV bancaire — proposition de profil et aperçu indisponible', () => {
  test.use({ storageState: etatDe('chloe') });
  const csv = 'Quand;Quoi;Combien\n05/02/2024;Abonnement;-12,50\n06/02/2024;Remise;100,00\n';
  const deposer = async (page: Page) => {
    await page.goto(banque);
    await page.getByTestId('entree-releve').setInputFiles(pieceJointe('export.csv', csv, 'text/csv'));
    await expect(page.getByTestId('imports-releves').getByRole('listitem').first()).toContainText('Import en attente de votre confirmation', { timeout: 20_000 });
  };

  test('un profil proposé pré-remplit le formulaire comme une proposition à confirmer ; un fichier tronqué est signalé', async ({ page }) => {
    // Réponse d'aperçu fournie par le test (même forme que l'API) : le simulateur, lui, ne propose rien pour ce fichier.
    // (`route.fetch` n'est pas utilisable ici : il ignore la règle de résolution qui envoie localhost:3000 vers le serveur de test.)
    await page.route('**/api/bff/v1/imports/*/apercu', (route) =>
      route.fulfill({
        json: {
          format: 'csv', encodage: 'utf-8', tronque: true, lignes: csv.trim().split('\n'),
          separateurs: [{ separateur: ';', nbColonnes: 3, cellules: csv.trim().split('\n').map((l) => l.split(';')) }],
          profilPropose: { separateur: ';', lignesEntete: 1, colonnes: { date: 'Quand', libelle: 1, montant: 'Combien' }, formatDate: 'JJ/MM/AAAA', decimale: ',' },
          raisons: ['Séparateur « ; » retenu.'],
        },
      }),
    );
    await deposer(page);
    const profil = page.locator('form[data-formulaire="profil-csv"]');
    await expect(profil.getByTestId('profil-propose')).toContainText('Proposition du logiciel, à vérifier');
    await expect(profil.getByTestId('profil-propose')).toContainText('Rien n’est appliqué tant que vous ne l’avez pas confirmé');
    await expect(profil.getByTestId('apercu-tronque')).toContainText('Fichier tronqué pour l’aperçu');
    await expect(profil.getByLabel('Colonne de la date')).toHaveValue('Quand');
    await expect(profil.getByLabel('Colonne du libellé')).toHaveValue('2'); // indice 1 de l'API → position 2
    await expect(profil.getByLabel('Colonne du montant')).toHaveValue('Combien');
    expect((await journal()).some((e) => e.chemin.endsWith('/relancer'))).toBe(false); // rien n'est envoyé sans confirmation
    await profil.getByLabel('Colonne du libellé').fill('Quoi');
    await expect(profil.getByTestId('profil-propose')).toContainText('vous l’avez modifié depuis');
    await profil.getByRole('button', { name: 'Je confirme ce profil et relance la lecture' }).click();
    await expect(page.getByTestId('imports-releves').getByRole('listitem').first()).toContainText('2 mouvements lus', { timeout: 20_000 });
  });

  test('aperçu refusé par le serveur : message clair, le formulaire reste utilisable', async ({ page }) => {
    await page.route('**/api/bff/v1/imports/*/apercu', (route) => route.fulfill({ status: 404, json: { message: 'Import de relevé introuvable' } }));
    await deposer(page);
    const profil = page.locator('form[data-formulaire="profil-csv"]');
    await expect(profil.getByTestId('apercu-csv-indisponible')).toContainText('Import de relevé introuvable');
    await expect(profil.getByLabel('Séparateur', { exact: true }).getByRole('option')).toHaveCount(3);
    await expect(profil.getByRole('button', { name: 'Je confirme ce profil et relance la lecture' })).toBeEnabled();
  });
});
