import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSimule, etatSuite, journal, simulateur, statutBff, surveiller } from '../outils';

/**
 * Assistant documenté et tâches IA — API SIMULÉE (tests/faux-api.ts), dans l'état de l'application réelle :
 * AUCUNE IA connectée. Les réponses sont « sans IA » (recherche et calculs), étiquetées comme telles.
 */
const assistant = `/dossiers/${ID.dupain}/assistant`;
const MESSAGE_ETAT = 'IA non connectée : les réponses ci-dessous sont des résultats de recherche et des calculs du moteur, sans rédaction par un modèle.';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

async function poser(page: import('@playwright/test').Page, question: string) {
  await page.getByLabel('Votre question sur ce dossier').fill(question);
  await page.getByRole('button', { name: 'Poser la question' }).click();
  const zone = page.getByTestId('zone-reponse');
  await expect(zone).toContainText(`Question : ${question}`);
  return zone.getByTestId('reponse-assistant');
}

test.describe('assistant du dossier', () => {
  test.use({ storageState: etatDe('chloe') });

  test('bandeau d’état permanent, question, réponse structurée et citations cliquables', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Assistant' }).click();
    await expect(page).toHaveURL(new RegExp(`${assistant}$`));
    await expect(page.getByRole('heading', { level: 2, name: 'Assistant documenté' })).toBeVisible();
    const bandeau = page.getByTestId('etat-ia');
    await expect(bandeau).toHaveText(MESSAGE_ETAT);
    await expect(bandeau).toHaveAttribute('data-statut-ia', 'non_connecte');
    await expect(page.getByLabel('Exercice analysé')).toHaveValue(ID.exDupain);
    await expect(page.getByTestId('zone-reponse')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('historique-assistant')).toContainText('Aucune question enregistrée');

    // Pièce : segment « Fait », extrait restitué, citation vers la page de la pièce.
    const reponse = await poser(page, 'Que contient la facture de la Meunerie du Moulin ?');
    await expect(reponse).toHaveAttribute('data-mode', 'sans_ia');
    await expect(reponse.getByTestId('mode-reponse')).toHaveText('Sans IA');
    await expect(reponse.getByTestId('etiquette-reponse')).toHaveText('Sans IA : résultats de recherche et calculs du moteur, sans rédaction');
    await expect(reponse.getByTestId('perimetre-reponse')).toHaveText('Période analysée : du 01/01/2025 au 31/12/2025 — périmètre : le dossier « Boulangerie Dupain SAS (fictive) » seulement.');
    await expect(reponse.getByTestId('confiance')).toContainText('Confiance non évaluée');
    const fait = reponse.locator('[data-segment="fait"]').first();
    await expect(fait).toContainText('Fait');
    await expect(fait).toContainText('Meunerie du Moulin');
    const piece = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-meunerie-2025-03.pdf')!;
    const citation = fait.locator(`[data-citation="piece:${piece.id}:p1"]`);
    await expect(citation).toContainText('Pièce : facture-meunerie-2025-03.pdf — page 1');
    await expect(citation.getByRole('link')).toHaveAttribute('href', `/dossiers/${ID.dupain}/pieces/${piece.id}`);
    // Le bandeau reste affiché avec la réponse, et l'historique (les siennes seulement) s'enrichit.
    await expect(bandeau).toHaveText(MESSAGE_ETAT);
    await expect(page.getByTestId('historique-assistant')).toContainText('Mes questions précédentes (1)');
    expect((await etatSuite()).echangesAssistant).toEqual([expect.objectContaining({ entiteId: ID.dupain, question: 'Que contient la facture de la Meunerie du Moulin ?', mode: 'sans_ia', statut: 'repondu' })]);

    // Calcul du moteur : type lisible « Calcul », référence sans lien.
    const calcul = await poser(page, 'Quel est le solde du compte 530000 ?');
    const segCalcul = calcul.locator('[data-segment="calcul"]').first();
    await expect(segCalcul).toContainText('Calcul');
    await expect(segCalcul).toContainText('solde créditeur : 320.50');
    await expect(segCalcul.locator('[data-nature="resultat_moteur"]')).toContainText('Calcul du moteur : Balance — compte 530000 Caisse');
    await expect(segCalcul.getByRole('link')).toHaveCount(0);

    // Écriture : le libellé est une donnée, affichée en texte brut (aucun script exécuté) ; référence sans lien.
    const ecritures = await poser(page, 'Quelles écritures de retrait espèces ?');
    const segEcriture = ecritures.locator('[data-segment="fait"]').filter({ hasText: 'Retrait espèces' });
    await expect(segEcriture).toContainText('libellé : Retrait espèces <script>alert(1)</script>');
    await expect(segEcriture.locator('[data-nature="ecriture"]')).toContainText('Écriture : Écriture CA n° CA12 du 2025-03-14');
    await expect(segEcriture.getByRole('link')).toHaveCount(0);
    expect(await page.locator('[data-testid="zone-reponse"] script').count()).toBe(0);

    // Constat : citation vers la page du constat. Source officielle : lien externe protégé.
    const constats = await poser(page, 'Quels constats ont été relevés ?');
    const lienConstat = constats.locator('[data-nature="constat"]').first().getByRole('link');
    await expect(lienConstat).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    const sources = await poser(page, 'Quel seuil pour les sociétés à l’IS ?');
    const officielle = sources.locator('[data-nature="source_officielle"]').first();
    await expect(officielle.locator('xpath=ancestor::li[@data-segment]')).toContainText('Référence réglementaire');
    const lienSource = officielle.getByRole('link');
    await expect(lienSource).toHaveAttribute('href', 'https://bofip.impots.gouv.fr/bofip/2109-PGP.html');
    await expect(lienSource).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(lienSource).toHaveAttribute('target', '_blank');

    // Navigation par la citation d'un constat.
    await poser(page, 'Quels constats ont été relevés ?');
    await page.getByTestId('zone-reponse').locator('[data-nature="constat"]').first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    await expect(page.getByRole('link', { name: '← Retour à la révision' })).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('abstention et son motif ; question trop courte refusée sans appel ; historique repliable', async ({ page }) => {
    await page.goto(assistant);
    const abstention = await poser(page, 'xyzzyqwertz plughfrobnitz');
    await expect(abstention).toHaveAttribute('data-statut', 'abstention');
    await expect(abstention.getByTestId('abstention')).toContainText('L’assistant s’abstient');
    await expect(abstention.getByTestId('abstention')).toContainText('Aucun élément trouvé par la recherche et les fonctions du moteur pour cette question.');
    await expect(abstention.locator('[data-segment]')).toHaveCount(0);
    await expect(abstention.getByTestId('mode-reponse')).toHaveText('Sans IA');

    const avant = (await journal()).filter((j) => j.methode === 'POST' && j.chemin.includes('/assistant/questions')).length;
    await page.getByLabel('Votre question sur ce dossier').fill('ab');
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByTestId('erreur-question')).toHaveText('Saisissez une question de 3 à 1000 caractères.');
    expect((await journal()).filter((j) => j.methode === 'POST' && j.chemin.includes('/assistant/questions')).length).toBe(avant);
    // Le serveur applique la même borne, et refuse toute clé libre (cabinet, dossier).
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/assistant/questions`, { question: 'ab' })).toBe(400);
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.dupain}/assistant/questions`, { question: 'Une question', dossierId: ID.martin })).toBe(400);

    const historique = page.getByTestId('historique-assistant');
    await expect(historique).toContainText('Mes questions précédentes (1)');
    const echange = historique.locator('[data-echange]').first();
    await expect(echange.locator('summary')).toContainText('xyzzyqwertz plughfrobnitz');
    await expect(echange.locator('summary')).toContainText('Sans IA');
    await echange.locator('summary').click();
    await expect(echange.getByTestId('abstention')).toBeVisible();
  });

  test('utilisable au clavier, et sans débordement horizontal en écran étroit (412 px)', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(assistant);
    await expect(page.getByTestId('etat-ia')).toHaveText(MESSAGE_ETAT);
    await page.getByLabel('Exercice analysé').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Votre question sur ce dossier')).toBeFocused();
    await page.keyboard.type('Quelles écritures de retrait espèces et quel solde du compte 530000 ?');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Poser la question' })).toBeFocused();
    await page.keyboard.press('Enter');
    const reponse = page.getByTestId('zone-reponse').getByTestId('reponse-assistant');
    await expect(reponse.locator('[data-segment="calcul"]').first()).toBeVisible();
    await expect(reponse.locator('[data-segment="fait"]').first()).toBeVisible();
    const debordement = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
    expect(debordement.contenu).toBeLessThanOrEqual(debordement.fenetre);
    // Chaque bloc de réponse tient dans la largeur de l'écran.
    for (const boite of await reponse.locator('[data-segment]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(boite).toBeLessThanOrEqual(412);
  });

  test('chacun ne voit que ses questions ; un déposant et un autre cabinet n’accèdent pas à l’assistant', async ({ page, browser }) => {
    await page.goto(assistant);
    await poser(page, 'Que contient la facture de la Meunerie du Moulin ?');
    await expect(page.getByTestId('historique-assistant')).toContainText('Mes questions précédentes (1)');

    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto(`http://localhost:3000${assistant}`);
    await expect(remi.getByTestId('etat-ia')).toHaveText(MESSAGE_ETAT);
    await expect(remi.getByTestId('historique-assistant')).toContainText('Mes questions précédentes (0)');
    await expect(remi.getByTestId('historique-assistant')).not.toContainText('Meunerie');
    await remi.context().close();

    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto(`http://localhost:3000${assistant}`);
    await expect(client.getByTestId('erreur-403')).toBeVisible();
    await expect(client.getByLabel('Votre question sur ce dossier')).toHaveCount(0);
    await expect(client.getByRole('link', { name: 'Assistant' })).toHaveCount(0);
    expect(await statutBff(client, 'POST', `v1/dossiers/${ID.dupain}/assistant/questions`, { question: 'Que contient ce dossier ?' })).toBe(403);
    expect(await statutBff(client, 'GET', `v1/dossiers/${ID.dupain}/assistant/questions`)).toBe(403);
    // Dossier d'un autre cabinet : introuvable.
    expect(await statutBff(client, 'POST', `v1/dossiers/${ID.leroy}/assistant/questions`, { question: 'Que contient ce dossier ?' })).toBe(404);
    await client.context().close();
    expect(await statutBff(page, 'POST', `v1/dossiers/${ID.leroy}/assistant/questions`, { question: 'Que contient ce dossier ?' })).toBe(404);
  });
});

test.describe('tâches IA sur une pièce et un constat', () => {
  test.use({ storageState: etatDe('chloe') });

  test('« Proposer un classement » : proposition, preuves, origine « repli déterministe, sans IA », rien de modifié', async ({ page }) => {
    const piece = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-meunerie-2025-03.pdf')!;
    await page.goto(`/dossiers/${ID.dupain}/pieces/${piece.id}`);
    const bloc = page.locator('[data-bloc="proposition-classement"]');
    await expect(bloc.getByTestId('origine-proposition')).toHaveCount(0);
    await bloc.getByRole('button', { name: 'Proposer un classement' }).click();
    await expect(bloc.getByTestId('origine-proposition')).toHaveText('Repli déterministe, sans IA');
    await expect(bloc.getByTestId('etiquette-proposition')).toHaveText('Sans IA : rattachement par indice exact uniquement, type à qualifier.');
    await expect(bloc.getByTestId('etat-ia-tache')).toHaveText(MESSAGE_ETAT);
    await expect(bloc.getByTestId('type-propose')).toHaveText('À qualifier');
    await expect(bloc.getByTestId('dossier-propose')).toHaveText('À qualifier (aucun rattachement certain)');
    await expect(bloc.getByTestId('preuves-classement')).toHaveText('Aucun extrait probant.');
    await expect(bloc).toContainText('Confiance non évaluée');
    await expect(bloc.getByTestId('rien-applique')).toHaveText('Rien n’a été modifié sur la pièce.');
    // La pièce garde sa nature : seule une action humaine (qualification) la change.
    expect((await etatSimule()).documents.find((d) => d.id === piece.id)!.nature).toBe('facture_achat');
    expect((await journal()).filter((j) => j.methode === 'PATCH' && j.chemin.includes(piece.id))).toEqual([]);
  });

  test('« Expliquer ce constat » : le repli restitue le message du moteur, étiqueté', async ({ page }) => {
    await page.goto(`/dossiers/${ID.dupain}/revision?exercice=${ID.exDupain}`);
    const revue = await page.evaluate(async (ex) => (await fetch(`/api/bff/v1/exercices/${ex}/revue`)).json(), ID.exDupain);
    const constat = (revue.constats as Array<{ id: string; controleId: string }>).find((c) => c.controleId === 'TRE-001')!;
    await page.goto(`/dossiers/${ID.dupain}/revision/constats/${constat.id}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Caisse créditrice au 14/03/2025' })).toBeVisible();
    const bloc = page.locator('[data-bloc="explication-constat"]');
    await bloc.getByRole('button', { name: 'Expliquer ce constat' }).click();
    await expect(bloc.getByTestId('origine-proposition')).toHaveText('Repli déterministe, sans IA');
    await expect(bloc.getByTestId('etiquette-proposition')).toHaveText('Sans IA : message du constat tel que produit par le moteur, sans reformulation.');
    await expect(bloc.getByTestId('texte-explication')).toHaveText('Le solde du compte 530000 devient créditeur, ce qui est impossible pour une caisse.');
    await expect(bloc).toContainText('Le constat n’a pas été modifié.');
  });

  test('un déposant ne peut pas demander une tâche IA (403)', async ({ browser }) => {
    const piece = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-meunerie-2025-03.pdf')!;
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/');
    expect(await statutBff(client, 'POST', `v1/documents/${piece.id}/proposition-classement`)).toBe(403);
    await client.context().close();
  });
});

test.describe('administration : état et mesures de l’IA', () => {
  test('gestionnaire : passerelle non connectée, modèles figés, mesures distinguant réel, simulateur et sans IA', async ({ browser }) => {
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto(`http://localhost:3000${assistant}`);
    await poser(chloe, 'Quel est le solde du compte 530000 ?');
    await chloe.goto('http://localhost:3000/administration/ia');
    await expect(chloe.getByTestId('erreur-403')).toBeVisible();
    await chloe.context().close();

    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/administration');
    await alice.getByRole('link', { name: 'Intelligence artificielle : état et mesures' }).click();
    await expect(alice.getByRole('heading', { level: 1 })).toHaveText('Intelligence artificielle : état et mesures');
    await expect(alice.getByTestId('etat-ia')).toHaveText(MESSAGE_ETAT);
    await expect(alice.getByTestId('statut-passerelle')).toHaveText('Non connectée');
    await expect(alice.getByTestId('raisons-statut')).toContainText('Aucun fournisseur IA n’est configuré');
    await expect(alice.getByTestId('modeles-ia')).toContainText('Mistral-Small-3.2-24B-Instruct-2506');
    await expect(alice.getByTestId('modeles-ia')).toContainText('bge-m3 (1024 dimensions)');
    await expect(alice.getByTestId('modeles-ia')).toContainText('Aucun : le coût n’est pas estimé.');
    const cellules = (nature: string) => alice.locator(`[data-nature-mesure="${nature}"] td`);
    await expect(alice.locator('[data-nature-mesure="reel"] th')).toHaveText('Modèle réel');
    await expect(cellules('reel')).toHaveText(['0', '0', '0', '0', '0', '0', '0', '0']);
    await expect(cellules('simulateur')).toHaveText(['0', '0', '0', '0', '0', '0', '0', '0']);
    await expect(cellules('sans_ia')).toHaveText(['0', '0', '0', '0', '0', '1', '3', '0']);
    // État réel par défaut : rien à vérifier, et aucun bouton qui laisserait croire à une activation depuis l'écran.
    await expect(alice.getByTestId('verification-ia')).toHaveAttribute('data-etat-verification', 'sans_objet');
    await expect(alice.getByTestId('detail-verification')).toHaveText('Aucun fournisseur n’est configuré : il n’y a rien à vérifier.');
    await expect(alice.getByTestId('declenchement-verification')).toContainText('Elle n’est ni automatique ni déclenchable depuis cet écran.');
    await expect(alice.getByRole('main').getByRole('button')).toHaveCount(0);
    await alice.context().close();
  });

  test('preuve de connexion : chaque état est dit sans détour — non vérifiée, connectée depuis le…, périmée, autre configuration, échec — et l’écran n’offre aucun bouton', async ({ browser }) => {
    // AFFICHAGE seulement : l'API simulée de ces tests rend l'état demandé ; aucun modèle n'est appelé et rien n'est
    // « connecté ». Le calcul du statut à partir d'une preuve réelle est vérifié dans les tests d'intégration de l'API.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    const erreurs = surveiller(alice);
    const voir = async (preuve: string) => {
      await simulateur('ia', { preuve });
      await alice.goto('http://localhost:3000/administration/ia');
      await expect(alice.getByTestId('verification-ia')).toHaveAttribute('data-etat-verification', preuve === 'sans_fournisseur' ? 'sans_objet' : preuve);
      await expect(alice.getByRole('main').getByRole('button')).toHaveCount(0);
      await expect(alice.getByTestId('declenchement-verification')).toContainText('elle est faite par l’éditeur du service, sur demande explicite');
    };
    try {
      await voir('absente');
      await expect(alice.getByTestId('statut-passerelle')).toHaveText('Configurée, non vérifiée');
      await expect(alice.getByTestId('detail-verification')).toHaveText('Aucune vérification de connexion n’a été faite pour la configuration courante.');
      await expect(alice.getByTestId('consequence-verification')).toContainText('aucun modèle n’est sollicité');
      await expect(alice.getByTestId('preuve-ia')).toHaveCount(0);

      await voir('valide');
      await expect(alice.getByTestId('statut-passerelle')).toContainText('Connectée — vérifiée le 10/11/2026');
      await expect(alice.getByTestId('preuve-ia')).toContainText('Ce qu’elle atteste');
      await expect(alice.getByTestId('preuve-ia')).toContainText('hôte oai.endpoints.kepler.ai.cloud.ovh.net');
      await expect(alice.getByTestId('preuve-ia')).toContainText('Mistral-Small-3.2-24B-Instruct-2506');
      await expect(alice.getByTestId('preuve-ia')).toContainText('Fin de validité');
      await expect(alice.getByTestId('consequence-verification')).toHaveCount(0);
      await expect(alice.getByText('« Connectée » signifie seulement que le service répond')).toBeVisible();

      await voir('perimee');
      await expect(alice.getByTestId('statut-passerelle')).toHaveText('Configurée — vérification périmée');
      await expect(alice.getByTestId('detail-verification')).toContainText('est périmée (validité : 30 jours)');
      await expect(alice.getByTestId('preuve-ia')).toContainText('Périmée depuis le');
      await expect(alice.getByTestId('consequence-verification')).toContainText('aucun modèle n’est sollicité');

      await voir('autre_configuration');
      await expect(alice.getByTestId('statut-passerelle')).toHaveText('Configurée, non vérifiée');
      await expect(alice.getByTestId('detail-verification')).toContainText('concernait une autre configuration');

      await voir('non_concluante');
      await expect(alice.getByTestId('statut-passerelle')).toHaveText('Configurée, non vérifiée');
      await expect(alice.getByTestId('detail-verification')).toContainText('La dernière vérification a échoué');
      expect(erreurs).toEqual([]);
    } finally {
      await simulateur('ia', { preuve: 'sans_fournisseur' });
      await alice.context().close();
    }
  });

  test('preuve valide : temps restant dit ; « expire bientôt » alerte sans aucun bouton ; rien à signaler tant qu’aucune preuve n’existe', async ({ browser }) => {
    // AFFICHAGE seulement (simulateur) : le calcul du temps restant et la notification sont prouvés par les tests unitaires, de base et d'API.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    const erreurs = surveiller(alice);
    try {
      await simulateur('ia', { preuve: 'valide' });
      await alice.goto('http://localhost:3000/administration/ia');
      await expect(alice.getByTestId('expiration-preuve')).toHaveAttribute('data-expire-bientot', 'non');
      await expect(alice.getByTestId('jours-restants')).toHaveText('22 jour(s)');
      await expect(alice.getByTestId('alerte-expiration-preuve')).toHaveCount(0);

      await simulateur('ia', { preuve: 'expire_bientot' });
      await alice.goto('http://localhost:3000/administration/ia');
      await expect(alice.getByTestId('expiration-preuve')).toHaveAttribute('data-expire-bientot', 'oui');
      await expect(alice.getByTestId('jours-restants')).toHaveText('3 jour(s)');
      await expect(alice.getByTestId('alerte-expiration-preuve')).toContainText('La preuve de connexion expire bientôt.');
      await expect(alice.getByTestId('alerte-expiration-preuve')).toContainText('ni automatique ni déclenchable depuis cet écran');
      await expect(alice.getByRole('main').getByRole('button')).toHaveCount(0);

      for (const preuve of ['absente', 'perimee', 'sans_fournisseur']) {
        await simulateur('ia', { preuve: preuve === 'sans_fournisseur' ? 'sans_fournisseur' : preuve });
        await alice.goto('http://localhost:3000/administration/ia');
        await expect(alice.getByTestId('expiration-preuve'), preuve).toHaveCount(0);
      }
      expect(erreurs).toEqual([]);
    } finally {
      await simulateur('ia', { preuve: 'sans_fournisseur' });
      await alice.context().close();
    }
  });
});
