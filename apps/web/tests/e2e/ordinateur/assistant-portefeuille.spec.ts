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
    // Les champs de période (facultatifs) viennent ensuite : on passe directement à la question.
    await page.getByLabel('Votre question sur ces dossiers').focus();
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

/** L'administratrice crée `n` dossiers vides « Portefeuille NN SARL (fictive) » et les ouvre en lecture à Rémi ; renvoie leurs identifiants dans l'ordre. */
async function peuplerDossiers(browser: import('@playwright/test').Browser, n: number): Promise<string[]> {
  const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
  await alice.goto('http://localhost:3000/');
  const ids = await alice.evaluate(
    async ([nb, remi]) => {
      const sortie: string[] = [];
      for (let i = 1; i <= (nb as number); i++) {
        const entetes = { 'X-Comtaple-Csrf': '1', 'Content-Type': 'application/json' };
        const c = await fetch('/api/bff/v1/dossiers', { method: 'POST', headers: entetes, body: JSON.stringify({ raisonSociale: `Portefeuille ${String(i).padStart(2, '0')} SARL (fictive)`, territoireFiscal: 'metropole' }) });
        const id = ((await c.json()) as { id: string }).id;
        await fetch(`/api/bff/v1/dossiers/${id}/habilitations/${remi}`, { method: 'PUT', headers: entetes, body: JSON.stringify({ niveau: 'lecture' }) });
        sortie.push(id);
      }
      return sortie;
    },
    [n, REMI] as const,
  );
  await alice.context().close();
  return ids;
}

test.describe('période commune dans l’interface', () => {
  test.use({ storageState: etatDe('remi') });

  test('choix de période validé côté écran, conservé dans l’adresse, envoyé à l’API, dossiers sans recoupement annoncés', async ({ page }) => {
    await page.goto('/assistant');
    const bloc = page.getByTestId('periode-commune');
    await expect(bloc).toContainText('Sans période, chaque dossier est interrogé sur son dernier exercice.');
    await expect(bloc).toContainText('un dossier dont aucun exercice ne la recoupe n’est pas interrogé sur la comptabilité');
    const debut = bloc.getByLabel('Début de la période');
    const fin = bloc.getByLabel('Fin de la période');
    await page.getByLabel('Votre question sur ces dossiers').fill('Quel est le solde du compte 530000 ?');
    const nbPost = async () => (await journal()).filter((j) => j.methode === 'POST' && j.chemin.endsWith('/assistant/questions')).length;
    const avant = await nbPost();

    // Une seule date, puis un début postérieur à la fin : refusé à l'écran, aucune requête.
    await debut.fill('2025-01-01');
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByTestId('erreur-periode')).toHaveText('Renseignez les deux dates de la période, ou aucune.');
    await expect(page.getByTestId('erreur-question')).toHaveText('Renseignez les deux dates de la période, ou aucune.');
    await fin.fill('2024-12-31');
    await expect(page.getByTestId('erreur-periode')).toHaveText('La date de début doit précéder ou égaler la date de fin.');
    await expect(debut).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Poser la question' }).click();
    expect(await nbPost()).toBe(avant);

    // Période valide : conservée dans l'adresse, envoyée telle quelle.
    await fin.fill('2025-03-31');
    await expect(page.getByTestId('erreur-periode')).toHaveCount(0);
    await expect(page).toHaveURL(/\/assistant\?debut=2025-01-01&fin=2025-03-31$/);
    const envoi = corpsEnvoye(page);
    const reponse = await poser(page, 'Quel est le solde du compte 530000 ?');
    expect((await envoi).postDataJSON()).toEqual({ question: 'Quel est le solde du compte 530000 ?', periode: { debut: '2025-01-01', fin: '2025-03-31' } });
    await expect(reponse.getByTestId('perimetre-portefeuille')).toContainText('période commune demandée : du 01/01/2025 au 31/03/2025');
    await expect(reponse.locator(`[data-dossier-interroge="${ID.dupain}"]`).getByTestId('periode-dossier')).toHaveText('période analysée : du 01/01/2025 au 31/03/2025');
    await expect(reponse.getByTestId('sans-recoupement')).toHaveCount(0);

    // Rechargement : la période est relue dans l'adresse ; une période hors de tout exercice est annoncée, dossier par dossier.
    await page.reload();
    await expect(bloc.getByLabel('Début de la période')).toHaveValue('2025-01-01');
    await expect(bloc.getByLabel('Fin de la période')).toHaveValue('2025-03-31');
    await bloc.getByLabel('Début de la période').fill('2019-01-01');
    await bloc.getByLabel('Fin de la période').fill('2019-06-30');
    const hors = await poser(page, 'Quel est le solde du compte 530000 ?');
    const sans = hors.getByTestId('sans-recoupement');
    await expect(sans).toContainText('2 dossiers sans exercice recoupant la période demandée : la comptabilité n’a pas été interrogée pour ces dossiers.');
    await expect(sans).toContainText(DUPAIN);
    await expect(sans).toContainText(MARTIN);
    await expect(hors.locator(`[data-dossier-interroge="${ID.dupain}"]`).getByTestId('periode-dossier')).toHaveText('aucune période comptable analysée');
    await expect(hors.locator(`[data-dossier-interroge="${ID.dupain}"]`).getByTestId('manquantes-dossier')).toContainText('Aucun exercice de ce dossier ne recoupe la période demandée');

    // Effacer la période la retire de l'adresse ; une adresse invalide n'est pas reprise.
    await bloc.getByRole('button', { name: 'Effacer la période' }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await page.goto('/assistant?debut=2025-02-30&fin=2025-03-31');
    await expect(page.getByTestId('periode-commune').getByLabel('Début de la période')).toHaveValue('');
  });

  test('utilisable au clavier, sans débordement horizontal à 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/assistant?debut=2025-01-01&fin=2025-03-31');
    const bloc = page.getByTestId('periode-commune');
    await expect(bloc.getByLabel('Début de la période')).toHaveValue('2025-01-01');
    // Un champ date se parcourt par segments (jour, mois, année) : on atteint le bouton « Effacer » en quelques Tab.
    await bloc.getByLabel('Fin de la période').focus();
    await expect(bloc.getByLabel('Fin de la période')).toBeFocused();
    const effacer = bloc.getByRole('button', { name: 'Effacer la période' });
    for (let i = 0; i < 4 && !(await effacer.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(effacer).toBeFocused();
    await page.getByLabel('Votre question sur ces dossiers').fill('Quel est le solde du compte 530000 ?');
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByTestId('zone-reponse').getByTestId('reponse-portefeuille')).toBeVisible();
    const d = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
    expect(d.contenu).toBeLessThanOrEqual(d.fenetre);
  });
});

test.describe('plus de vingt dossiers : tranches', () => {
  test.use({ storageState: etatDe('remi') });

  test('la première tranche est interrogée, la suivante se demande à part (réponses distinctes, jamais fusionnées), avec la même question et la même période', async ({ page, browser }) => {
    await peuplerDossiers(browser, 22);
    await page.goto('/assistant?debut=2025-01-01&fin=2025-03-31');
    const choix = page.getByTestId('choix-dossiers');
    await expect(choix).toContainText('Dossiers interrogés (24 sur 24 autorisés)');
    await expect(page.getByTestId('au-dela-de-la-borne')).toContainText('vos 24 dossiers forment 2 tranches de 20 au plus, classées par pertinence');
    const q = 'Quel est le solde du compte 530000 ?';
    const reponse1 = await poser(page, q);
    await expect(reponse1.getByTestId('tranche-interrogee')).toContainText('Tranche 1 sur 2 : dossiers 1 à 20 sur 24. Dossiers ayant des données comptables importées d’abord');
    await expect(reponse1.locator('[data-dossier-interroge]')).toHaveCount(20);
    // Classement : le dossier qui a des données (Dupain), puis celui qui a un exercice (Martin), puis les autres par ordre alphabétique.
    expect(await reponse1.locator('[data-dossier-interroge]').evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-dossier-interroge')))).toEqual([ID.dupain, ID.martin, expect.any(String)]);
    await expect(reponse1.getByTestId('sans-recoupement')).toContainText('18 dossiers sans exercice recoupant la période demandée');
    await expect(reponse1.getByTestId('dossiers-non-interroges')).toContainText('4 dossiers retenus n’ont pas été interrogés par cette réponse : ils sont dans les autres tranches.');
    await expect(reponse1.getByTestId('dossiers-non-interroges')).toContainText('Portefeuille 19 SARL (fictive) ; Portefeuille 20 SARL (fictive) ; Portefeuille 21 SARL (fictive) ; Portefeuille 22 SARL (fictive)');
    const suivante = page.getByTestId('tranche-suivante');
    await expect(suivante).toContainText('Tranche 1 sur 2 interrogée : 4 dossiers restent à interroger');

    const envoi = corpsEnvoye(page);
    await suivante.getByRole('button', { name: 'Interroger les 4 suivants' }).click();
    expect((await envoi).postDataJSON()).toEqual({ question: q, periode: { debut: '2025-01-01', fin: '2025-03-31' }, tranche: 2 });
    const blocs = page.getByTestId('zone-reponse').locator('[data-tranche-reponse]');
    await expect(blocs).toHaveCount(2);
    const seconde = blocs.nth(1).getByTestId('reponse-portefeuille');
    await expect(seconde.getByTestId('tranche-interrogee')).toContainText('Tranche 2 sur 2 : dossiers 21 à 24 sur 24.');
    await expect(seconde.locator('[data-dossier-interroge]')).toHaveCount(4);
    // Périmètres disjoints : aucun dossier de la tranche 2 n'est dans la tranche 1.
    const ids = (loc: import('@playwright/test').Locator) => loc.locator('[data-dossier-interroge]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dossier-interroge')));
    const [a, b] = [await ids(blocs.nth(0)), await ids(blocs.nth(1))];
    expect(a.filter((x) => b.includes(x))).toEqual([]);
    // Plus de tranche à demander ; deux échanges distincts sont conservés.
    await expect(page.getByTestId('tranche-suivante')).toHaveCount(0);
    expect(((await etatSuite()).echangesPortefeuille ?? []).map((e) => e.perimetre.tranche?.numero)).toEqual([1, 2]);
    await expect(page.getByTestId('historique-portefeuille')).toContainText('Mes questions précédentes (2)');
  });

  test('habilitations relues à chaque tranche : après retrait entre deux tranches, la suite l’annonce sans réponse trompeuse', async ({ page, browser }) => {
    const dossiers = await peuplerDossiers(browser, 22);
    await page.goto('/assistant');
    const reponse1 = await poser(page, 'Quels constats ont été relevés ?');
    await expect(reponse1.getByTestId('tranche-interrogee')).toContainText('Tranche 1 sur 2');
    // L'administratrice retire les quatre dossiers de la seconde tranche à Rémi : elle n'existe plus.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/');
    for (const id of dossiers.slice(18)) expect(await statutBff(alice, 'DELETE', `v1/dossiers/${id}/habilitations/${REMI}`)).toBeLessThan(300);
    await alice.context().close();
    await page.getByTestId('tranche-suivante').getByRole('button', { name: /Interroger les 4 suivants/ }).click();
    await expect(page.getByTestId('erreur-question')).toContainText('n’existe plus');
    await expect(page.getByTestId('zone-reponse').locator('[data-tranche-reponse]')).toHaveCount(1);
    // Le message d'erreur ne nomme aucun des dossiers retirés (la première réponse, établie avant le retrait, les citait comme « autres tranches »).
    await expect(page.getByTestId('erreur-question')).not.toContainText('Portefeuille 2');
  });
});
