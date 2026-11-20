import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, journal, seConnecter, simulateur, statutBff, surveiller } from '../outils';

/**
 * Suggestions d'amélioration tirées des corrections — API SIMULÉE (tests/faux-api.ts). Le calcul est fait par le MOTEUR
 * RÉEL de `@comtaple/core` (critères versionnés), sur des décisions de revue fictives posées par la route de pilotage
 * `/__test/revue`. Une suggestion n'active rien : elle ne devient une règle proposée que par l'action d'une personne.
 */
const REMI = '11111111-1111-4111-8111-111111111102';
const DUPAIN = 'Boulangerie Dupain SAS (fictive)';
const MOTIF_REJET = 'Acompte fournisseur prévu au contrat, sans enjeu';
const EMPREINTE = `exception_dossier|TIE-002|${ID.dupain}`;
const rejet = (controleId: string, cle: string, montant: string, motif = MOTIF_REJET) => ({ entiteId: ID.dupain, controleId, cle, montant, motif, titre: `Constat fictif ${cle}` });
const RECURRENCE = { constatsRejetes: [rejet('TIE-002', '401ALPHA', '40.00'), rejet('TIE-002', '401BETA', '120.00'), rejet('TIE-002', '401GAMMA', '89.90'), ...['A', 'B', 'C'].map((x) => rejet('TRE-001', `530${x}`, '15.00', 'Erreur de date en caisse, corrigée depuis')) ] };

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('suggestions tirées des corrections', () => {
  test.use({ storageState: etatDe('remi') });

  test('sans décision : rien à suggérer ; deux rejets : rien non plus (corrections ponctuelles)', async ({ page }) => {
    await page.goto('/regles');
    const bloc = page.getByTestId('suggestions');
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (0)');
    await expect(bloc.getByTestId('cadre-suggestions')).toContainText('Calcul déterministe, sans IA');
    await expect(bloc.getByTestId('cadre-suggestions')).toContainText('non validées par un expert-comptable');
    await expect(bloc.getByTestId('cadre-suggestions')).toContainText('Une suggestion n’active rien');
    // Le jeu de démonstration contient une seule décision de revue (un constat accepté) : aucune récurrence.
    await expect(bloc.getByTestId('aucune-suggestion')).toHaveText('Aucune récurrence n’atteint les seuils : rien à suggérer.');

    await simulateur('revue', { constatsRejetes: RECURRENCE.constatsRejetes.slice(0, 2) });
    await page.reload();
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (0)');
    const ponctuelle = bloc.locator('[data-categorie="correction_donnee"]');
    await expect(ponctuelle).toContainText('Correction de données');
    await expect(ponctuelle).toContainText('Corrections ponctuelles : rien à proposer comme règle');
    await expect(ponctuelle.getByTestId('proposer-depuis-suggestion')).toHaveCount(0);
    await expect(ponctuelle.getByRole('button', { name: 'Écarter cette suggestion' })).toHaveCount(0);

    // Décision contraire : le jeu de démonstration a ACCEPTÉ un constat « clients créditeurs » de ce dossier ; trois rejets
    // motivés du même contrôle n'y fondent donc aucune suggestion.
    await simulateur('revue', { constatsRejetes: ['X', 'Y', 'Z'].map((x) => rejet('TIE-001', `411${x}`, '30.00')) });
    await page.reload();
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (0)');
    await expect(bloc.locator('[data-suggestion]')).toHaveCount(1);
    await expect(bloc.locator('[data-categorie="correction_donnee"]')).toContainText('5 rejet(s) de constat');
  });

  test('récurrence : suggestion avec preuves, paramètre et limites ; « proposer » pré-remplit le formulaire, rien n’est créé avant la validation par la personne', async ({ page }) => {
    const erreurs = surveiller(page);
    await simulateur('revue', RECURRENCE);
    await page.goto('/regles');
    const bloc = page.getByTestId('suggestions');
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (2)');
    const s = bloc.locator(`[data-suggestion="${EMPREINTE}"]`);
    await expect(s).toHaveAttribute('data-categorie', 'exception_dossier');
    await expect(s).toContainText('Exception propre à un dossier');
    await expect(s).toContainText('Suggestion — aucune règle créée');
    await expect(s).toContainText('TIE-002 — Fournisseurs débiteurs : exception possible pour ce dossier');
    await expect(s.getByTestId('dossiers-suggestion')).toHaveText(`Dossier : ${DUPAIN}`);
    await expect(s).toContainText('3 constats de ce contrôle ont été rejetés avec motif dans ce dossier, sans aucune décision contraire.');
    // Paramètre concerné : valeur indicative en chaîne décimale (le plus grand montant rejeté).
    await expect(s.getByTestId('parametre-suggestion')).toContainText('Paramètre concerné : seuil — valeur indicative 120.00 (par défaut : 0.00)');
    // Preuves : décisions sources avec leur motif, décomptes, critère versionné.
    await s.getByTestId('preuves-suggestion').locator('summary').click();
    await expect(s.getByTestId('preuves-suggestion')).toContainText('Critère appliqué : Même contrôle, même dossier : au moins 3 anomalies distinctes rejetées avec un motif d’au moins 10 caractères');
    await expect(s.getByTestId('decomptes')).toContainText('3 rejets motivés');
    await expect(s.getByTestId('decomptes')).toContainText('0 décisions contraires');
    await expect(s.locator('[data-decision]')).toHaveCount(3);
    await expect(s.locator('[data-decision]').first()).toContainText(`motif : ${MOTIF_REJET}`);
    await expect(s.locator('[data-decision]').first().getByRole('link', { name: 'constat' })).toHaveAttribute('href', new RegExp(`^/dossiers/${ID.dupain}/revision/constats/[0-9a-f-]{36}$`));
    await expect(s.getByTestId('ne-fait-pas')).toContainText('N’active rien : aucune règle n’est créée ni appliquée par cette suggestion.');
    await expect(s.getByTestId('ne-fait-pas')).toContainText('une AUTRE personne habilitée l’approuve');
    await expect(s.getByTestId('ne-fait-pas')).toContainText('aucune donnée d’un autre cabinet n’a servi');

    // Contrôle à fondement réglementaire : renvoi vers la veille, aucune proposition possible.
    const reglementaire = bloc.locator('[data-categorie="modification_regle_reglementaire"]');
    await expect(reglementaire).toContainText('Règle réglementaire (renvoi vers la veille)');
    await expect(reglementaire.getByTestId('renvoi-veille')).toContainText('Aucune règle de cabinet ne peut être proposée ici.');
    await expect(reglementaire.getByTestId('renvoi-veille').getByRole('link', { name: 'veille réglementaire' })).toHaveAttribute('href', '/veille/sources');
    await expect(reglementaire.getByTestId('proposer-depuis-suggestion')).toHaveCount(0);

    // Lire les suggestions n'a rien créé.
    expect((await etatSuite()).regles).toEqual([]);
    for (const statut of ['proposee', 'approuvee']) await expect(page.locator(`[data-statut-regles="${statut}"]`)).toContainText('(0)');

    // « Proposer cette règle » : le formulaire existant est pré-rempli ; aucune requête d'écriture n'est partie.
    const avant = (await journal()).filter((j) => j.methode === 'POST' && j.chemin.endsWith('/v1/regles')).length;
    await s.getByTestId('proposer-depuis-suggestion').click();
    await expect(page).toHaveURL(/\/regles\?suggestion=exception_dossier%7CTIE-002%7C[0-9a-f-]{36}#proposer$/);
    const f = page.locator('form[data-formulaire="proposer-regle"]');
    await expect(f.getByTestId('proposition-preremplie')).toContainText('Formulaire pré-rempli à partir d’une suggestion');
    await expect(f.getByLabel('Contrôle')).toHaveValue('TIE-002');
    await expect(f.getByRole('radio', { name: 'Un dossier' })).toBeChecked();
    await expect(f.getByLabel('Dossier concerné')).toHaveValue(ID.dupain);
    await expect(f.getByLabel(/Seuil \(seuil\)/)).toHaveValue('120.00');
    await expect(f.getByLabel(/Prefixes comptes/)).toHaveValue('401');
    await expect(f.getByLabel('Motif de la proposition (obligatoire)')).toHaveValue(/^Suggestion tirée de 3 rejets motivés du contrôle TIE-002 \(critères v\d+\.\d+\.\d+\)/);
    expect((await journal()).filter((j) => j.methode === 'POST' && j.chemin.endsWith('/v1/regles')).length).toBe(avant);
    expect((await etatSuite()).regles).toEqual([]);

    // La personne ajuste, complète le motif, puis propose elle-même : circuit existant.
    await f.getByLabel(/Seuil \(seuil\)/).fill('150,00');
    await f.getByLabel('Motif de la proposition (obligatoire)').fill('Acomptes fournisseurs contractuels récurrents sur ce dossier, sans enjeu sous 150 €');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/regles'));
    await f.getByRole('button', { name: 'Proposer cette règle' }).click();
    expect((await envoi).postDataJSON()).toEqual({ controleId: 'TIE-002', entiteId: ID.dupain, parametres: { seuil: '150.00' }, motif: 'Acomptes fournisseurs contractuels récurrents sur ce dossier, sans enjeu sous 150 €' });
    const regle = page.locator('[data-statut-regles="proposee"] [data-regle]');
    await expect(regle).toHaveCount(1);
    await expect(regle).toContainText('Projet — sans effet tant qu’elle n’est pas approuvée');
    await expect(regle.getByTestId('impact-absent')).toContainText('Impact non mesuré');
    // La suggestion a disparu (règle en cours pour la même cible) ; la règle n'est que PROPOSÉE, par Rémi, sans approbation.
    await expect(bloc.locator(`[data-suggestion="${EMPREINTE}"]`)).toHaveCount(0);
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (1)');
    expect((await etatSuite()).regles).toEqual([expect.objectContaining({ controleId: 'TIE-002', entiteId: ID.dupain, statut: 'proposee', proposeePar: REMI, approuveePar: null, impact: null })]);
    // Un réviseur ne peut pas approuver : aucun bouton, et l'API refuse.
    await expect(regle.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
    expect(await statutBff(page, 'POST', `v1/regles/${(await etatSuite()).regles[0]!.id}/approuver`)).toBe(403);
    expect(erreurs).toEqual([]);
  });

  test('écarter une suggestion : motif obligatoire, décision conservée, suggestion non reproposée', async ({ page }) => {
    await simulateur('revue', RECURRENCE);
    await page.goto('/regles');
    const bloc = page.getByTestId('suggestions');
    const s = bloc.locator(`[data-suggestion="${EMPREINTE}"]`);
    await s.getByRole('button', { name: 'Écarter cette suggestion' }).click();
    const f = s.locator('form[data-formulaire="ecarter-suggestion"]');
    await f.getByRole('button', { name: 'Confirmer' }).click();
    await expect(f.getByRole('alert')).toHaveText('Un motif de 5 caractères au moins est requis pour écarter une suggestion.');
    expect((await etatSuite()).suggestionsEcartees).toEqual([]);
    await f.getByLabel('Motif (obligatoire, conservé)').fill('Cas particuliers de ce client, pas une règle');
    await f.getByRole('button', { name: 'Confirmer' }).click();
    await expect(bloc.locator(`[data-suggestion="${EMPREINTE}"]`)).toHaveCount(0);
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (1)');
    const ecartees = bloc.getByTestId('suggestions-ecartees');
    await expect(ecartees.locator('summary')).toHaveText('Suggestions écartées ou déjà tranchées (1)');
    await ecartees.locator('summary').click();
    await expect(ecartees).toContainText('exception_dossier · TIE-002');
    await expect(ecartees).toContainText('Cas particuliers de ce client, pas une règle');
    expect((await etatSuite()).suggestionsEcartees).toEqual([expect.objectContaining({ empreinte: EMPREINTE, categorie: 'exception_dossier', controleId: 'TIE-002', entiteId: ID.dupain, ecarteePar: REMI, motif: 'Cas particuliers de ce client, pas une règle' })]);
    expect((await etatSuite()).regles).toEqual([]);
    // Elle ne s'écarte pas deux fois, une empreinte forgée est refusée, et l'adresse de pré-remplissage ne remplit plus rien.
    expect(await statutBff(page, 'POST', 'v1/regles/suggestions/ecarter', { empreinte: EMPREINTE, motif: 'Une seconde fois' })).toBe(404);
    expect(await statutBff(page, 'POST', 'v1/regles/suggestions/ecarter', { empreinte: `exception_dossier|TIE-002|${ID.leroy}`, motif: 'Empreinte forgée' })).toBe(404);
    expect(await statutBff(page, 'POST', 'v1/regles/suggestions/ecarter', { empreinte: 'correction_donnee', motif: 'Ne s’écarte pas' })).toBe(404);
    await page.goto(`/regles?suggestion=${encodeURIComponent(EMPREINTE)}`);
    await expect(page.locator('form[data-formulaire="proposer-regle"]').getByTestId('proposition-preremplie')).toHaveCount(0);
    await expect(page.locator('form[data-formulaire="proposer-regle"]').getByLabel('Contrôle')).toHaveValue('');
    // De nouveaux rejets, à eux seuls suffisants, la font revenir — et elle le dit.
    await simulateur('revue', { constatsRejetes: ['DELTA', 'EPSILON', 'ZETA'].map((x) => rejet('TIE-002', `401${x}`, '60.00')) });
    await page.goto('/regles');
    await expect(bloc.locator(`[data-suggestion="${EMPREINTE}"]`).getByTestId('deja-ecartee')).toContainText('Cas particuliers de ce client, pas une règle');
  });

  test('« nouvelle règle métier » : extraction (même champ, même émetteur) et rapprochement (même règle rejetée) — signalement à l’éditeur, rien à proposer, preuves et décomptes', async ({ page }) => {
    const erreurs = surveiller(page);
    const EMETTEUR = 'siren:552100554';
    const piecesCorrigees = ['p1', 'p2', 'p3'].map((x, i) => ({ documentId: `00000000-0000-4000-8000-00000000000${i + 1}`, dossierId: ID.dupain, emetteur: EMETTEUR, emetteurLibelle: 'ATELIER FICTIF 0042 SARL', champs: ['totalTtc'], date: `2026-11-1${i}T10:00:00.000Z` }));
    const ISOLEE = { documentId: '00000000-0000-4000-8000-0000000000a1', dossierId: ID.dupain, emetteur: 'siren:732829320', emetteurLibelle: 'AUTRE ÉMETTEUR', champs: ['totalTtc'], date: '2026-11-12T10:00:00.000Z' };
    const MOTIF = 'Libellé bancaire sans rapport avec cette écriture';
    const rappro = (action: string, motif: string) => ({ dossierId: ID.dupain, regle: 'paiement_groupe', action, motif });
    await simulateur('revue', { corrections: [...piecesCorrigees, ISOLEE], rapprochements: [...[1, 2, 3, 4, 5].map(() => rappro('rejeter', MOTIF)), rappro('rejeter', 'non')] });
    await page.goto('/regles');
    const bloc = page.getByTestId('suggestions');
    // Deux suggestions « nouvelle règle métier » ; la correction isolée et le rejet peu motivé restent des corrections de données.
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (2)');
    await expect(bloc.locator('[data-categorie="nouvelle_regle_metier"]')).toHaveCount(2);

    const extraction = bloc.locator(`[data-suggestion="nouvelle_regle_metier|extraction|${EMETTEUR}|totalTtc"]`);
    await expect(extraction).toContainText('Nouvelle règle métier (signalement)');
    await expect(extraction).toContainText('Extraction : champ « totalTtc » régulièrement corrigé pour l’émetteur ATELIER FICTIF 0042 SARL');
    await expect(extraction).toContainText('corrigé à la main sur 3 pièces distinctes de cet émetteur');
    await expect(extraction.getByTestId('renvoi-editeur')).toContainText('Simple signalement : à instruire par l’éditeur du logiciel. Rien n’est créé ni transmis automatiquement.');
    await expect(extraction.getByTestId('proposer-depuis-suggestion')).toHaveCount(0);
    await expect(extraction.getByTestId('parametre-suggestion')).toHaveCount(0);
    await extraction.getByTestId('preuves-suggestion').locator('summary').click();
    await expect(extraction.getByTestId('decomptes')).toContainText('3 pièces corrigées');
    await expect(extraction.getByTestId('decomptes')).toContainText('1 dossiers');
    await expect(extraction.locator('[data-decision]')).toHaveCount(3);
    const liens = await extraction.locator('[data-decision] a[href*="/pieces/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(liens.sort()).toEqual([1, 2, 3].map((n) => `/dossiers/${ID.dupain}/pieces/00000000-0000-4000-8000-00000000000${n}`));
    await expect(extraction.getByTestId('ne-fait-pas')).toContainText('Ne crée aucune règle d’extraction et ne modifie aucune pièce.');
    await expect(extraction.getByTestId('ne-fait-pas')).toContainText('Ne transmet rien à l’éditeur');

    const rapprochement = bloc.locator(`[data-suggestion="nouvelle_regle_metier|rapprochement|paiement_groupe|${ID.dupain}"]`);
    await expect(rapprochement).toContainText('Rapprochement : propositions de la règle « paiement_groupe » régulièrement rejetées dans ce dossier');
    await expect(rapprochement).toContainText('5 rapprochements proposés par la règle « paiement_groupe » ont été rejetés avec motif dans ce dossier, et aucun n’a été validé.');
    await expect(rapprochement.getByTestId('renvoi-editeur')).toBeVisible();
    await expect(rapprochement.getByTestId('proposer-depuis-suggestion')).toHaveCount(0);
    await rapprochement.getByTestId('preuves-suggestion').locator('summary').click();
    await expect(rapprochement.getByTestId('decomptes')).toContainText('5 rejets motivés');
    await expect(rapprochement.getByTestId('decomptes')).toContainText('0 validations');
    await expect(rapprochement.locator('[data-decision]')).toHaveCount(5);
    await expect(rapprochement.locator('[data-decision]').first()).toContainText(`motif : ${MOTIF}`);
    await expect(rapprochement.locator('[data-decision]').first().getByRole('link', { name: 'banque du dossier' })).toHaveAttribute('href', `/dossiers/${ID.dupain}/banque`);
    await expect(rapprochement.getByTestId('ne-fait-pas')).toContainText('Ne modifie ni la règle de rapprochement ni aucun rapprochement existant.');

    // La correction isolée est comptée comme correction de données ; rien n'est créé.
    await expect(bloc.locator('[data-categorie="correction_donnee"]')).toContainText('1 champ(s) extrait(s) corrigé(s)');
    expect((await etatSuite()).regles).toEqual([]);
    expect((await etatSuite()).suggestionsEcartees).toEqual([]);

    // Une validation d'une proposition de la même règle retire la suggestion de rapprochement ; l'extraction reste.
    await simulateur('revue', { rapprochements: [rappro('valider', MOTIF)] });
    await page.reload();
    await expect(bloc.locator(`[data-suggestion="nouvelle_regle_metier|rapprochement|paiement_groupe|${ID.dupain}"]`)).toHaveCount(0);
    await expect(bloc.locator(`[data-suggestion="nouvelle_regle_metier|extraction|${EMETTEUR}|totalTtc"]`)).toHaveCount(1);
    // Écarter le signalement d'extraction : motif conservé, rien n'est transmis (aucune règle).
    const s = bloc.locator(`[data-suggestion="nouvelle_regle_metier|extraction|${EMETTEUR}|totalTtc"]`);
    await s.getByRole('button', { name: 'Écarter cette suggestion' }).click();
    await s.locator('form[data-formulaire="ecarter-suggestion"]').getByLabel('Motif (obligatoire, conservé)').fill('Format propre à ce fournisseur, déjà connu');
    await s.locator('form[data-formulaire="ecarter-suggestion"]').getByRole('button', { name: 'Confirmer' }).click();
    await expect(bloc.locator(`[data-suggestion="nouvelle_regle_metier|extraction|${EMETTEUR}|totalTtc"]`)).toHaveCount(0);
    expect((await etatSuite()).suggestionsEcartees).toEqual([expect.objectContaining({ categorie: 'nouvelle_regle_metier', controleId: null, entiteId: null, ecarteePar: REMI })]);
    expect((await etatSuite()).regles).toEqual([]);
    expect(erreurs).toEqual([]);
  });

  test('sans débordement horizontal à 360 px, suggestions et preuves dépliées', async ({ page }) => {
    await simulateur('revue', RECURRENCE);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/regles');
    const bloc = page.getByTestId('suggestions');
    await expect(bloc.locator('[data-suggestion]')).toHaveCount(2);
    for (const preuves of await bloc.getByTestId('preuves-suggestion').locator('summary').all()) await preuves.click();
    await bloc.locator(`[data-suggestion="${EMPREINTE}"]`).getByRole('button', { name: 'Écarter cette suggestion' }).click();
    const debordement = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
    expect(debordement.contenu).toBeLessThanOrEqual(debordement.fenetre);
    for (const boite of await bloc.locator('[data-suggestion]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(boite).toBeLessThanOrEqual(360);
  });
});

test.describe('accès et cloisonnement', () => {
  test('réservé aux réviseurs, associés et administrateurs ; un autre cabinet ne voit rien de celui-ci', async ({ browser }) => {
    await simulateur('revue', RECURRENCE);
    // Collaboratrice : pas de bloc de suggestions, et l'API refuse.
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto('http://localhost:3000/regles');
    await expect(chloe.getByRole('heading', { level: 1 })).toHaveText('Règles du cabinet');
    await expect(chloe.getByTestId('suggestions')).toHaveCount(0);
    expect(await statutBff(chloe, 'GET', 'v1/regles/suggestions')).toBe(403);
    expect(await statutBff(chloe, 'POST', 'v1/regles/suggestions/ecarter', { empreinte: EMPREINTE, motif: 'Sans habilitation' })).toBe(403);
    await chloe.context().close();
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/deposer');
    expect(await statutBff(client, 'GET', 'v1/regles/suggestions')).toBe(403);
    await client.context().close();
    // Administratrice du même cabinet : elle voit la suggestion (elle est habilitée sur le dossier).
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/regles');
    await expect(alice.getByTestId('suggestions').locator(`[data-suggestion="${EMPREINTE}"]`)).toBeVisible();
    await alice.context().close();
    // Administrateur d'un AUTRE cabinet : aucune suggestion, aucune trace du dossier ni des motifs.
    const bruno = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await seConnecter(bruno, 'bruno', '/regles');
    const bloc = bruno.getByTestId('suggestions');
    await expect(bloc.getByRole('heading')).toHaveText('Suggestions tirées des corrections (0)');
    await expect(bloc.locator('[data-suggestion]')).toHaveCount(0);
    await expect(bloc).not.toContainText('Dupain');
    await expect(bloc).not.toContainText(MOTIF_REJET);
    expect(await statutBff(bruno, 'POST', 'v1/regles/suggestions/ecarter', { empreinte: EMPREINTE, motif: 'Depuis un autre cabinet' })).toBe(404);
    await bruno.context().close();
    expect((await etatSuite()).suggestionsEcartees).toEqual([]);
  });
});
