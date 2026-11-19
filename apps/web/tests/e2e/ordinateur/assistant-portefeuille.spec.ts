import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, journal, seConnecter, simulateur, statutBff, surveiller } from '../outils';

/**
 * Assistant sur un PORTEFEUILLE de dossiers — API SIMULÉE (tests/faux-api.ts), dans l'état de l'application réelle :
 * AUCUNE IA connectée. Rémi est habilité sur deux dossiers (Dupain, Martin), Chloé sur un seul (Dupain).
 */
const MESSAGE_ETAT = 'IA non connectée : les réponses ci-dessous sont des résultats de recherche et des calculs du moteur, sans rédaction par un modèle.';
const DUPAIN = 'Boulangerie Dupain SAS (fictive)';
const MARTIN = 'Garage Martin SARL (fictif)';
const REMI = '11111111-1111-4111-8111-111111111102';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

async function poser(page: import('@playwright/test').Page, question: string) {
  await page.getByLabel('Votre question sur ces dossiers').fill(question);
  await page.getByRole('button', { name: 'Poser la question' }).click();
  const zone = page.getByTestId('zone-reponse');
  await expect(zone).toContainText(`Question : ${question}`);
  return zone.getByTestId('reponse-portefeuille');
}
const corpsEnvoye = (page: import('@playwright/test').Page) => page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/assistant/questions'));

test.describe('assistant du cabinet, sur le portefeuille autorisé', () => {
  test.use({ storageState: etatDe('remi') });

  test('lien de navigation, bandeau d’état, tous les dossiers autorisés par défaut, périmètre et période par dossier, citations vers le bon dossier', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Assistant' }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible();
    const bandeau = page.getByTestId('etat-ia');
    await expect(bandeau).toHaveText(MESSAGE_ETAT);
    await expect(bandeau).toHaveAttribute('data-statut-ia', 'non_connecte');
    await expect(page.getByTestId('zone-reponse')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('historique-portefeuille')).toContainText('Aucune question de portefeuille enregistrée');

    // Choix des dossiers : ceux où Rémi est habilité, tous cochés ; aucun autre dossier du cabinet ni d'un autre cabinet.
    const choix = page.getByTestId('choix-dossiers');
    await expect(choix).toContainText('Dossiers interrogés (2 sur 2 autorisés)');
    await expect(choix.getByRole('checkbox')).toHaveCount(2);
    await expect(choix.getByRole('checkbox', { name: DUPAIN })).toBeChecked();
    await expect(choix.getByRole('checkbox', { name: MARTIN })).toBeChecked();
    await expect(choix).not.toContainText('Leroy');

    // Tous les dossiers cochés : aucun identifiant n'est envoyé, le serveur calcule le périmètre.
    const envoi = corpsEnvoye(page);
    const reponse = await poser(page, 'Quels constats ont été relevés et quel solde du compte 530000 ?');
    expect((await envoi).postDataJSON()).toEqual({ question: 'Quels constats ont été relevés et quel solde du compte 530000 ?' });
    await expect(reponse).toHaveAttribute('data-mode', 'sans_ia');
    await expect(reponse.getByTestId('mode-reponse')).toHaveText('Sans IA');
    await expect(reponse.getByTestId('etiquette-reponse')).toHaveText('Sans IA : résultats de recherche et calculs du moteur, sans rédaction');
    await expect(reponse.getByTestId('confiance')).toContainText('Confiance non évaluée');
    // Périmètre et période, dossier par dossier ; données manquantes du dossier sans import.
    const perimetre = reponse.getByTestId('perimetre-portefeuille');
    await expect(perimetre).toContainText('Périmètre analysé : 2 dossiers');
    const dupain = perimetre.locator(`[data-dossier-interroge="${ID.dupain}"]`);
    await expect(dupain).toContainText(DUPAIN);
    await expect(dupain.getByTestId('periode-dossier')).toHaveText('période analysée : du 01/01/2025 au 31/12/2025');
    await expect(dupain.getByTestId('manquantes-dossier')).toHaveCount(0);
    const martin = perimetre.locator(`[data-dossier-interroge="${ID.martin}"]`);
    await expect(martin).toContainText(MARTIN);
    await expect(martin).toContainText('0 source consultée');
    await expect(martin.getByTestId('manquantes-dossier')).toContainText('Aucune donnée comptable importée pour cet exercice.');
    await expect(reponse.getByTestId('dossiers-ecartes')).toHaveCount(0);
    await expect(reponse.getByTestId('dossiers-non-interroges')).toHaveCount(0);

    // Segments typés ; chaque citation nomme son dossier, et mène à la page DE CE dossier.
    const calcul = reponse.locator('[data-segment="calcul"]').first();
    await expect(calcul).toContainText('Calcul');
    await expect(calcul).toContainText('solde créditeur : 320.50');
    await expect(calcul.locator('[data-nature="resultat_moteur"]')).toContainText(`${DUPAIN} — Calcul du moteur : Balance — compte 530000 Caisse`);
    await expect(calcul.getByRole('link')).toHaveCount(0);
    const constat = reponse.locator('[data-nature="constat"]').first();
    await expect(constat).toContainText(`${DUPAIN} — Constat :`);
    await expect(constat.getByRole('link')).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    for (const href of await reponse.locator('[data-citation] a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))) expect(href.startsWith(`/dossiers/${ID.dupain}/`)).toBe(true);

    // Le bandeau reste affiché ; l'échange est enregistré pour son auteur, avec son périmètre.
    await expect(bandeau).toHaveText(MESSAGE_ETAT);
    await expect(page.getByTestId('historique-portefeuille')).toContainText('Mes questions précédentes (1)');
    const echanges = (await etatSuite()).echangesPortefeuille ?? [];
    expect(echanges).toEqual([expect.objectContaining({ utilisateurId: REMI, mode: 'sans_ia', statut: 'repondu' })]);
    expect(echanges[0]!.perimetre.dossiers.map((d) => d.id)).toEqual([ID.dupain, ID.martin]);

    // Navigation par la citation : on arrive sur le constat du dossier Dupain.
    await constat.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    expect(erreurs).toEqual([]);
  });

  test('sélection de dossiers : seuls les dossiers cochés sont demandés ; aucune sélection : refus sans appel ; pièce citée avec son dossier', async ({ page }) => {
    await page.goto('/assistant');
    const choix = page.getByTestId('choix-dossiers');
    await choix.getByRole('checkbox', { name: MARTIN }).uncheck();
    await expect(choix).toContainText('Dossiers interrogés (1 sur 2 autorisés)');
    const envoi = corpsEnvoye(page);
    const reponse = await poser(page, 'Que contient la facture de la Meunerie du Moulin ?');
    expect((await envoi).postDataJSON()).toEqual({ question: 'Que contient la facture de la Meunerie du Moulin ?', dossierIds: [ID.dupain] });
    await expect(reponse.getByTestId('perimetre-portefeuille')).toContainText('Périmètre analysé : 1 dossier');
    await expect(reponse.locator(`[data-dossier-interroge="${ID.martin}"]`)).toHaveCount(0);
    const piece = reponse.locator('[data-nature="piece"]').first();
    await expect(piece).toContainText(`${DUPAIN} — Pièce : facture-meunerie-2025-03.pdf — page 1`);
    await expect(piece.getByRole('link')).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/pieces/[0-9a-f-]{36}$`));
    // Le texte d'une pièce ou d'une écriture reste une donnée : aucun script n'est injecté dans la page.
    expect(await page.locator('[data-testid="zone-reponse"] script').count()).toBe(0);

    const avant = (await journal()).filter((j) => j.methode === 'POST' && j.chemin.endsWith('/assistant/questions')).length;
    await choix.getByRole('button', { name: 'Tout désélectionner' }).click();
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByTestId('erreur-question')).toHaveText('Sélectionnez au moins un dossier.');
    await choix.getByRole('button', { name: 'Tout sélectionner' }).click();
    await page.getByLabel('Votre question sur ces dossiers').fill('ab');
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByTestId('erreur-question')).toHaveText('Saisissez une question de 3 à 1000 caractères.');
    expect((await journal()).filter((j) => j.methode === 'POST' && j.chemin.endsWith('/assistant/questions')).length).toBe(avant);
    // Abstention, avec son motif.
    const abstention = await poser(page, 'xyzzyqwertz plughfrobnitz');
    await expect(abstention).toHaveAttribute('data-statut', 'abstention');
    await expect(abstention.getByTestId('abstention')).toContainText('Aucun élément trouvé par la recherche et les fonctions du moteur pour cette question.');
  });

  test('habilitation retirée après coup : l’échange relu ne montre plus ce dossier, et le dit sans le nommer', async ({ page, browser }) => {
    await page.goto('/assistant');
    await poser(page, 'Quels constats ont été relevés ?');
    const historique = page.getByTestId('historique-portefeuille');
    const echange = historique.locator('[data-echange]').first();
    await echange.locator('summary').click();
    await expect(echange.getByTestId('perimetre-portefeuille')).toContainText(MARTIN);
    await expect(echange.getByTestId('echange-masque')).toHaveCount(0);

    // L'administratrice ramène l'habilitation de Rémi sur Dupain au niveau « dépôt » : ce dossier sort de son périmètre.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/');
    expect(await statutBff(alice, 'PUT', `v1/dossiers/${ID.dupain}/habilitations/${REMI}`, { niveau: 'depot' })).toBe(200);
    await alice.context().close();

    await page.reload();
    await expect(page.getByTestId('choix-dossiers').getByRole('checkbox')).toHaveCount(1);
    const relu = page.getByTestId('historique-portefeuille').locator('[data-echange]').first();
    await expect(relu.locator('summary')).toContainText('Périmètre réduit depuis');
    await relu.locator('summary').click();
    await expect(relu.getByTestId('echange-masque')).toContainText('1 dossier de cet échange n’est plus dans votre périmètre');
    await expect(relu.getByTestId('perimetre-portefeuille')).toContainText('Périmètre analysé : 1 dossier');
    await expect(relu).not.toContainText('Dupain');
    await expect(relu.locator(`[data-dossier-interroge="${ID.dupain}"]`)).toHaveCount(0);
    await expect(relu.locator('[data-nature="constat"]')).toHaveCount(0);
    expect(await relu.locator('a').evaluateAll((els) => els.filter((e) => (e.getAttribute('href') ?? '').includes('/dossiers/')).length)).toBe(0);
    // Tout venait du dossier masqué : la réponse relue le dit.
    await expect(relu.getByTestId('abstention')).toContainText('provenaient de dossiers auxquels vous n’avez plus accès');
  });

  test('utilisable au clavier, et sans débordement horizontal à 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/assistant');
    await expect(page.getByTestId('etat-ia')).toHaveText(MESSAGE_ETAT);
    await page.getByTestId('choix-dossiers').getByRole('checkbox', { name: MARTIN }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('choix-dossiers').getByRole('checkbox', { name: MARTIN })).not.toBeChecked();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Votre question sur ces dossiers')).toBeFocused();
    await page.keyboard.type('Quelles écritures de retrait espèces, quels constats et quel solde du compte 530000 ?');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Poser la question' })).toBeFocused();
    await page.keyboard.press('Enter');
    const reponse = page.getByTestId('zone-reponse').getByTestId('reponse-portefeuille');
    await expect(reponse.locator('[data-segment="calcul"]').first()).toBeVisible();
    await expect(reponse.locator('[data-segment="fait"]').first()).toBeVisible();
    const mesurer = () => page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
    let debordement = await mesurer();
    expect(debordement.contenu).toBeLessThanOrEqual(debordement.fenetre);
    for (const boite of await reponse.locator('[data-segment], [data-dossier-interroge]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(boite).toBeLessThanOrEqual(360);
    // Historique déplié : toujours sans débordement.
    await page.reload();
    await page.getByTestId('historique-portefeuille').locator('[data-echange] summary').first().click();
    await expect(page.getByTestId('historique-portefeuille').getByTestId('reponse-portefeuille')).toBeVisible();
    debordement = await mesurer();
    expect(debordement.contenu).toBeLessThanOrEqual(debordement.fenetre);
  });
});

test.describe('périmètre et refus', () => {
  test('un dossier demandé hors périmètre est écarté et signalé, sans dire s’il existe ; chacun ses échanges', async ({ browser }) => {
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto('http://localhost:3000/assistant');
    // Chloé n'est habilitée que sur Dupain : un seul dossier proposé.
    await expect(chloe.getByTestId('choix-dossiers').getByRole('checkbox')).toHaveCount(1);
    await expect(chloe.getByTestId('choix-dossiers')).not.toContainText('Martin');
    // Identifiants forgés : dossier du cabinet sans habilitation, dossier d'un autre cabinet — même traitement.
    expect(await statutBff(chloe, 'POST', 'v1/assistant/questions', { question: 'Que contient ce dossier ?', dossierIds: [ID.martin] })).toBe(404);
    expect(await statutBff(chloe, 'POST', 'v1/assistant/questions', { question: 'Que contient ce dossier ?', dossierIds: [ID.leroy] })).toBe(404);
    expect(await statutBff(chloe, 'POST', 'v1/assistant/questions', { question: 'Une question', cabinetId: ID.leroy })).toBe(400);
    expect(await statutBff(chloe, 'POST', 'v1/assistant/questions', { question: 'Quels constats ont été relevés ?', dossierIds: [ID.dupain, ID.martin, ID.leroy] })).toBe(200);
    await chloe.reload();
    const echange = chloe.getByTestId('historique-portefeuille').locator('[data-echange]').first();
    await echange.locator('summary').click();
    await expect(echange.getByTestId('dossiers-ecartes')).toHaveText('2 dossiers demandés hors de votre périmètre : non interrogés.');
    await expect(echange.getByTestId('perimetre-portefeuille')).toContainText('Périmètre analysé : 1 dossier');
    await expect(echange).not.toContainText('Martin');
    await expect(echange).not.toContainText('Leroy');
    await chloe.context().close();

    // Rémi ne voit aucune des questions de Chloé.
    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto('http://localhost:3000/assistant');
    await expect(remi.getByTestId('historique-portefeuille')).toContainText('Mes questions précédentes (0)');
    await remi.context().close();
  });

  test('un déposant n’a ni lien, ni écran, ni API ; un autre cabinet ne voit que les siens', async ({ browser }) => {
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/assistant');
    await expect(client.getByTestId('erreur-403')).toContainText('L’assistant n’est pas ouvert aux déposants.');
    await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Assistant' })).toHaveCount(0);
    await expect(client.getByLabel('Votre question sur ces dossiers')).toHaveCount(0);
    expect(await statutBff(client, 'POST', 'v1/assistant/questions', { question: 'Que contiennent mes dossiers ?' })).toBe(403);
    expect(await statutBff(client, 'GET', 'v1/assistant/questions')).toBe(403);
    expect(await statutBff(client, 'GET', 'v1/assistant/perimetre')).toBe(403);
    await client.context().close();

    const bruno = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await seConnecter(bruno, 'bruno', '/assistant');
    const choix = bruno.getByTestId('choix-dossiers');
    await expect(choix.getByRole('checkbox')).toHaveCount(1);
    await expect(choix).toContainText('Menuiserie Leroy SAS (fictive)');
    await expect(choix).not.toContainText('Dupain');
    expect(await statutBff(bruno, 'POST', 'v1/assistant/questions', { question: 'Que contient ce dossier ?', dossierIds: [ID.dupain] })).toBe(404);
    await bruno.context().close();
  });
});
