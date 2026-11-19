import { type Page, expect, test } from '@playwright/test';
import { FAUX_API, ID, etatDe, journal, seConnecter, simulateur, surveiller } from '../outils';

interface MailSimule {
  configure: boolean;
  connexions: Array<{ id: string; fournisseur: string; statut: string; configuration: { boite: { type: string }; dateDebut?: string; filtres: { expediteursAutorises: string[] }; rattachement: { dossiersComptables: string[]; dossierParDefaut?: string; regles: unknown[] }; tailleMaxPieceJointeOctets: number; dossiers: string[] } }>;
  pieces: Array<{ id: string; statut: string; dossierAffecteId: string | null }>;
  demandes: number;
}
const mail = (corps: object = {}) => simulateur<MailSimule>('mail', corps);

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

/** Choisit un fournisseur, lit l'écran d'explication et part chez le « fournisseur » (page de test du simulateur). */
async function demarrer(page: Page, fournisseur: 'Gmail' | 'Microsoft 365') {
  await page.goto('/messagerie');
  await page.getByRole('link', { name: 'Connecter une boîte' }).click();
  await page.getByRole('radio', { name: fournisseur }).check();
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await expect(page.getByTestId('explication-consentement')).toContainText('Lecture seule');
  await page.getByRole('button', { name: `Continuer vers ${fournisseur}` }).click();
  await page.waitForURL(new RegExp(`^${FAUX_API}/__test/fournisseur`));
}

test.describe('messagerie — gestionnaire (administratrice), API simulée', () => {
  test.use({ storageState: etatDe('alice') });

  test('connecteur non configuré : « non connecté » sans ambiguïté, explication à la place du bouton, écran non masqué', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Messagerie' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Messagerie');
    await expect(page.getByTestId('bandeau-non-connecte')).toContainText('Aucune boîte réelle n’a été connectée');
    await expect(page.getByTestId('rappel-conseil')).toContainText('échanges de conseil');
    for (const f of ['gmail', 'microsoft']) {
      const carte = page.locator(`[data-connecteur="${f}"]`);
      await expect(carte).toContainText('Non connecté');
      await expect(carte.getByTestId('connecteur-non-configure')).toContainText('connecteur non configuré');
      await expect(carte.getByTestId('connecteur-non-configure')).toContainText('packages/mail/docs/guide-connexion.md');
    }
    await expect(page.locator('[data-connecteur="gmail"]')).toContainText('GOOGLE_CLIENT_ID');
    await expect(page.getByRole('link', { name: 'Connecter une boîte' })).toHaveCount(0);
    await expect(page.getByTestId('connexion-impossible')).toBeVisible();
    await expect(page.getByText('Aucune boîte n’est connectée pour ce cabinet.')).toBeVisible();

    // Accès direct à l'écran de connexion : l'explication remplace le bouton ; même forcée, la demande est refusée (503).
    await page.goto('/messagerie/connecter');
    await page.getByRole('radio', { name: 'Gmail' }).check();
    await expect(page.getByTestId('connecteur-non-configure')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuer', exact: true })).toHaveCount(0);
    const reponse = await page.evaluate(async () => {
      const r = await fetch('/api/bff/v1/mail/connexions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ fournisseur: 'gmail' }) });
      return { statut: r.status, corps: await r.json() };
    });
    expect(reponse).toMatchObject({ statut: 503, corps: { code: 'connecteur_non_configure' } });
    expect(erreurs).toEqual([]);
  });

  test('retour OAuth nominal : explication avant le départ, code jamais affiché ni laissé dans l’historique, écran de la connexion créée', async ({ page }) => {
    const erreurs = surveiller(page);
    await mail({ configure: true });
    await page.goto('/messagerie');
    // Connecteur configuré mais simulé : toujours « non connecté » (aucune boîte réelle).
    await expect(page.getByTestId('bandeau-non-connecte')).toBeVisible();
    await expect(page.locator('[data-connecteur="gmail"]')).toContainText('Simulateur de test : aucune connexion réelle.');
    await page.getByRole('link', { name: 'Connecter une boîte' }).click();
    await page.getByRole('radio', { name: 'Gmail' }).check();
    await expect(page.getByLabel('Récupérer les messages reçus à partir du')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    const explication = page.getByTestId('explication-consentement');
    await expect(explication).toContainText('Lecture seule');
    await expect(explication).toContainText('Aucun envoi, aucune modification, aucune suppression');
    await expect(explication).toContainText('toute la boîte en lecture');
    expect(await mail()).toMatchObject({ demandes: 0 }); // rien n'est demandé avant la confirmation
    await page.getByRole('button', { name: 'Continuer vers Gmail' }).click();
    await page.waitForURL(new RegExp(`^${FAUX_API}/__test/fournisseur`));

    const urls: string[] = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && urls.push(f.url()));
    const retour = page.waitForResponse((r) => r.url().includes('/connexions-mail/retour'));
    await page.getByRole('link', { name: 'Accepter' }).click();
    const reponse = await retour;
    expect(reponse.status()).toBe(303);
    expect(reponse.headers()['referrer-policy']).toBe('no-referrer');
    expect(reponse.headers()['cache-control']).toContain('no-store');
    await page.waitForURL(/\/messagerie\/[0-9a-f-]{36}\?connectee=1$/);
    await expect(page.getByTestId('connexion-creee')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('factures@cabinet-alpha.test');
    await expect(page.locator('[data-statut-connexion="active"]')).toBeVisible();
    // Ni le code ni le state : absents de la page, de l'adresse, des adresses commitées et du référent.
    expect(await page.content()).not.toContain('code-de-test-valide');
    expect(urls.join(' ')).not.toMatch(/code=|state=/);
    expect(await page.evaluate(() => document.referrer)).not.toMatch(/code=|state=/);
    await page.goBack();
    expect(page.url()).not.toContain('/connexions-mail/retour'); // l'adresse de retour n'est pas dans l'historique
    // Le relais vers l'API a bien eu lieu côté serveur, une seule fois.
    expect((await journal()).filter((e) => e.chemin === '/v1/mail/retour')).toEqual([expect.objectContaining({ methode: 'POST', statut: 200, utilisateur: 'Alice Admin' })]);
    expect((await mail()).connexions).toHaveLength(1);
    expect(erreurs).toEqual([]);
  });

  test('retour OAuth en erreur : refus de consentement, state rejoué ou inconnu, retour incomplet, code refusé', async ({ page }) => {
    await mail({ configure: true });
    await demarrer(page, 'Gmail');
    const adresseRefus = await page.getByRole('link', { name: 'Refuser' }).getAttribute('href');
    await page.getByRole('link', { name: 'Refuser' }).click();
    await page.waitForURL(/\/messagerie\?retour=consentement_refuse$/);
    await expect(page.getByTestId('retour-oauth')).toContainText('L’autorisation a été refusée chez le fournisseur');
    expect((await mail()).connexions).toHaveLength(0);

    // La demande est à usage unique : la rejouer est refusé.
    await page.goto(adresseRefus!);
    await page.waitForURL(/\/messagerie\?retour=state_invalide$/);
    await expect(page.getByTestId('retour-oauth')).toContainText('inconnue, expirée, déjà utilisée');
    await page.goto('/connexions-mail/retour?state=invente&code=nimporte');
    await page.waitForURL(/\/messagerie\?retour=state_invalide$/);
    await page.goto('/connexions-mail/retour?code=sans-state');
    await page.waitForURL(/\/messagerie\?retour=retour_incomplet$/);
    await expect(page.getByTestId('retour-oauth')).toContainText('incomplet');
    await page.goto('/connexions-mail/retour');
    await page.waitForURL(/\/messagerie\?retour=retour_incomplet$/);

    await demarrer(page, 'Gmail');
    await page.getByRole('link', { name: 'Code invalide' }).click();
    await page.waitForURL(/\/messagerie\?retour=echec$/);
    await expect(page.getByTestId('retour-oauth')).toContainText('n’a pas abouti');
    // Un paramètre inconnu n'est jamais affiché.
    await page.goto('/messagerie?retour=%3Cb%3Einjection%3C%2Fb%3E');
    await expect(page.getByTestId('retour-oauth')).toHaveCount(0);

    // Connecteur dé-configuré entre le départ et le retour.
    await demarrer(page, 'Gmail');
    await mail({ configure: false });
    await page.getByRole('link', { name: 'Accepter' }).click();
    await page.waitForURL(/\/messagerie\?retour=connecteur_non_configure$/);
    await expect(page.getByTestId('retour-oauth')).toContainText('n’est pas configuré');
    expect((await mail()).connexions).toHaveLength(0);
  });

  test('retour OAuth sans session : connexion d’abord, reprise ensuite, sans code dans les adresses', async ({ browser }) => {
    await mail({ configure: true });
    const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await contexte.newPage();
    await seConnecter(page, 'alice', '/messagerie');
    await demarrer(page, 'Gmail');
    const adresse = await page.getByRole('link', { name: 'Accepter' }).getAttribute('href');
    // La session de l'application disparaît pendant que l'utilisateur est chez le fournisseur.
    await contexte.clearCookies({ name: /^comtaple_session/ });
    const urls: string[] = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && urls.push(f.url()));
    await page.goto(adresse!);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fconnexions-mail%2Fretour$/);
    const attente = (await contexte.cookies('http://localhost:3000/connexions-mail/retour')).find((c) => c.name === 'comtaple_mail_retour')!;
    expect(attente.httpOnly).toBe(true);
    expect(attente.value).not.toContain('code-de-test-valide'); // chiffré
    expect(attente.path).toBe('/connexions-mail');
    // Keycloak reconnaît encore l'utilisateur : la reprise aboutit sur l'écran de la connexion.
    await page.getByRole('link', { name: 'Se connecter' }).click();
    await page.waitForURL(/\/messagerie\/[0-9a-f-]{36}\?connectee=1$/);
    await expect(page.getByTestId('connexion-creee')).toBeVisible();
    expect(urls.join(' ')).not.toMatch(/code=|state=[0-9a-f]{32}/);
    expect((await contexte.cookies('http://localhost:3000/connexions-mail/retour')).some((c) => c.name === 'comtaple_mail_retour' && c.value)).toBe(false);
    await contexte.close();
  });

  test('boîte partagée Microsoft : avertissements (consentement supplémentaire, pas de notifications)', async ({ page }) => {
    await mail({ configure: true });
    await page.goto('/messagerie/connecter');
    await page.getByRole('radio', { name: 'Gmail' }).check();
    await expect(page.getByText('Il s’agit d’une boîte partagée')).toHaveCount(0); // option propre à Microsoft
    await page.getByRole('radio', { name: 'Microsoft 365' }).check();
    await page.getByLabel('Il s’agit d’une boîte partagée').check();
    await expect(page.getByTestId('avertissement-partagee')).toContainText('consentement supplémentaire');
    await expect(page.getByTestId('avertissement-partagee')).toContainText('pas de notifications');
    await expect(page.getByTestId('avertissement-partagee')).toContainText('périodique');
    await expect(page.getByRole('button', { name: 'Continuer', exact: true })).toBeDisabled();
    await page.getByLabel('Adresse de la boîte partagée').fill('Factures-Partagees@cabinet-alpha.test');
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await expect(page.getByTestId('explication-consentement')).toContainText('boîtes partagées');
    const requete = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/mail/connexions'));
    await page.getByRole('button', { name: 'Continuer vers Microsoft 365' }).click();
    expect((await requete).postDataJSON()).toEqual({ fournisseur: 'microsoft', boitePartagee: 'factures-partagees@cabinet-alpha.test' });
    await page.waitForURL(new RegExp(`^${FAUX_API}/__test/fournisseur`));
    await page.getByRole('link', { name: 'Accepter' }).click();
    await page.waitForURL(/\/messagerie\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('factures-partagees@cabinet-alpha.test');
    await expect(page.getByText('Boîte partagée')).toBeVisible();
    await expect(page.getByText('Synchronisation périodique (pas de notifications)')).toBeVisible();
    await expect(page.getByTestId('bloc-autorisation')).toContainText('Mail.Read.Shared');
  });

  test('détail : deux blocs distincts (autorisation / filtres), suivi, signalements, synchronisation, configuration enregistrée', async ({ page }) => {
    const erreurs = surveiller(page);
    await mail({ configure: true, amorcer: true });
    await page.goto('/messagerie');
    const lignes = page.locator('tr[data-connexion]');
    await expect(lignes).toHaveCount(3);
    await expect(lignes.filter({ hasText: 'ancienne@cabinet-alpha.test' })).toContainText('Expirée — à reconnecter');
    await expect(lignes.filter({ hasText: 'ancienne@cabinet-alpha.test' })).toContainText('jeton_de_rafraichissement_refuse');
    await expect(lignes.filter({ hasText: 'compta@cabinet-alpha.test' })).toContainText('interrompue');
    await page.getByRole('link', { name: 'factures@cabinet-alpha.test' }).click();

    const autorisation = page.getByTestId('bloc-autorisation');
    const filtres = page.getByTestId('bloc-filtres');
    await expect(autorisation.getByRole('heading')).toHaveText('Ce que l’autorisation permet techniquement');
    await expect(autorisation).toContainText('gmail.readonly');
    await expect(autorisation).toContainText('Lecture de TOUS les messages');
    await expect(filtres.getByRole('heading')).toHaveText('Ce que Comtaple récupère réellement (filtres)');
    await expect(filtres).toContainText('Libellés surveillés : INBOX');
    await expect(filtres).toContainText('Pièces jointes de 25 Mo au plus');
    await expect(filtres).not.toContainText('gmail.readonly');
    const style = (l: typeof autorisation) => l.evaluate((e) => `${getComputedStyle(e).backgroundColor}|${getComputedStyle(e).borderTopStyle}`);
    expect(await style(autorisation)).not.toBe(await style(filtres));
    await expect(page.getByTestId('phrase-filtre')).toContainText('Un filtre n’est pas une restriction technique du jeton');
    await expect(page.getByTestId('rappel-conseil')).toBeVisible();

    // Suivi et signalements : domaine seul, lien non suivi.
    const lien = page.locator('[data-signalement="facture_derriere_lien"]');
    await expect(lien).toContainText('Domaine : espace-client.operateur.test.');
    await expect(lien).toContainText('Le lien n’a pas été suivi');
    await expect(lien.getByRole('link')).toHaveCount(0);
    await expect(page.locator('[data-signalement="piece_ignoree"]')).toContainText('archives.zip — archive.');
    await expect(page.getByText('À qualifier : 1 · Importée dans un dossier : 1')).toBeVisible();
    const avant = await page.getByTestId('derniere-synchro').innerText();
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    await expect(page.getByText('Synchronisation demandée')).toBeVisible();
    await expect(page.getByTestId('derniere-synchro')).not.toHaveText(avant);

    // Configuration.
    const f = page.locator('form[data-formulaire="configuration-mail"]');
    await expect(f.getByLabel('Messages reçus à partir du')).toHaveValue('2026-10-19'); // 30 jours avant la connexion (fictive) du 18/11/2026
    await expect(f.getByLabel('Taille maximale d’une pièce jointe')).toHaveValue('25');
    await f.getByLabel('Libellés surveillés').fill('Label_Factures\nINBOX');
    await f.getByLabel('Expéditeurs autorisés').fill('compta@fournisseur.test\nedf.test');
    await f.getByLabel('L’objet doit contenir').fill('facture');
    await f.getByLabel('N’examiner que les messages avec pièce jointe').check();
    await f.getByLabel('Messages reçus à partir du').fill('2026-09-01');
    await f.getByLabel('Taille maximale d’une pièce jointe').fill('10');
    await f.getByRole('button', { name: 'Ajouter une règle' }).click();
    // Règle incomplète : refusée avant tout envoi.
    await f.getByRole('button', { name: 'Enregistrer la configuration' }).click();
    await expect(f.getByRole('alert')).toContainText('Règle n° 1');
    expect((await journal()).some((e) => e.methode === 'PUT')).toBe(false);
    const regle = f.locator('[data-regle="1"]');
    await regle.getByLabel('Adresse ou domaine').fill('edf.test');
    await regle.getByLabel('Dossier comptable').selectOption({ label: 'Boulangerie Dupain SAS (fictive)' });
    await f.getByRole('button', { name: 'Ajouter une règle' }).click();
    const regle2 = f.locator('[data-regle="2"]');
    await regle2.getByLabel('Règle 2 : critère').selectOption('destinataire');
    await regle2.getByLabel('Adresse (alias)').fill('martin@cabinet-alpha.test');
    await regle2.getByLabel('Dossier comptable').selectOption({ label: 'Garage Martin SARL (fictif)' });
    await f.getByLabel('Quand aucune règle ne correspond').selectOption({ label: 'Rattacher à Boulangerie Dupain SAS (fictive)' });
    const envoi = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/configuration'));
    await f.getByRole('button', { name: 'Enregistrer la configuration' }).click();
    const attendu = {
      dossiers: ['Label_Factures', 'INBOX'],
      filtres: { expediteursAutorises: ['compta@fournisseur.test', 'edf.test'], objetContient: ['facture'], avecPieceJointeUniquement: true },
      rattachement: {
        dossiersComptables: [ID.dupain, ID.martin],
        dossierParDefaut: ID.dupain,
        regles: [
          { type: 'expediteur', valeur: 'edf.test', dossierComptable: ID.dupain },
          { type: 'destinataire', valeur: 'martin@cabinet-alpha.test', dossierComptable: ID.martin },
        ],
      },
      dateDebut: '2026-09-01T00:00:00Z',
      tailleMaxPieceJointeOctets: 10 * 1024 * 1024,
    };
    expect((await envoi).postDataJSON()).toEqual(attendu);
    await expect(page.getByText('Configuration enregistrée.')).toBeVisible();
    // Le bloc « filtres » reflète la configuration renvoyée par l'API ; le bloc « autorisation » ne change pas.
    await expect(filtres).toContainText('Libellés surveillés : Label_Factures, INBOX');
    await expect(filtres).toContainText('Messages reçus à partir du 2026-09-01');
    await expect(filtres).toContainText('Expéditeurs autorisés : compta@fournisseur.test, edf.test');
    await expect(filtres).toContainText('Uniquement les messages avec pièce jointe');
    await expect(autorisation).toContainText('Lecture de TOUS les messages');
    const gmail = (await mail()).connexions.find((c) => c.fournisseur === 'gmail' && c.statut === 'active')!;
    expect(gmail.configuration).toMatchObject(attendu);
    // Après rechargement, le formulaire relit ce que l'API a conservé.
    await page.reload();
    await expect(f.getByLabel('Expéditeurs autorisés')).toHaveValue('compta@fournisseur.test\nedf.test');
    await expect(f.locator('[data-regle]')).toHaveCount(2);

    // Connexion expirée : pas de configuration ni de synchronisation, invitation à reconnecter.
    await page.goto('/messagerie');
    await page.getByRole('link', { name: 'ancienne@cabinet-alpha.test' }).click();
    await expect(page.getByText('Cette connexion n’est plus active')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synchroniser maintenant' })).toHaveCount(0);
    await expect(page.locator('form[data-formulaire="configuration-mail"]')).toHaveCount(0);
    expect(erreurs).toEqual([]);
  });

  test('pièce à qualifier : provenance, raisons, extrait non fiable rendu en texte, affectation à un dossier', async ({ page }) => {
    let alerte = false;
    page.on('dialog', async (d) => {
      alerte = true;
      await d.dismiss();
    });
    await mail({ configure: true, amorcer: true });
    await page.goto('/messagerie');
    await page.getByRole('link', { name: '1 pièce reçue par mail en attente d’un dossier' }).click();
    const piece = page.getByTestId('pieces-a-qualifier').getByRole('listitem').first();
    await expect(piece).toContainText('facture-2026-118.pdf');
    await expect(piece).toContainText('facturation@fournisseur-inconnu.test');
    await expect(piece).toContainText('17/11/2026');
    await expect(piece.getByTestId('raisons')).toContainText('Plusieurs dossiers sont possibles');
    await expect(piece.getByTestId('raisons')).toContainText('La règle n° 1 (expéditeur) s’applique.');
    await expect(piece).toContainText('Dossiers désignés par les règles : Boulangerie Dupain SAS (fictive), Garage Martin SARL (fictif).');
    const extrait = piece.getByTestId('extrait-non-fiable');
    await expect(extrait).toContainText('Contenu non fiable');
    await expect(extrait).toContainText('Objet : Votre facture <img src=x onerror=alert(1)> de novembre'); // balise affichée, pas interprétée
    expect(await extrait.locator('img').count()).toBe(0);
    // Seuls les dossiers où l'administratrice est habilitée sont proposés (Martin ne l'est pas).
    const choix = piece.getByLabel('Dossier comptable');
    await expect(choix.locator('option')).toHaveText(['Choisir un dossier…', 'Boulangerie Dupain SAS (fictive) (désigné par une règle)']);
    await expect(piece.getByRole('button', { name: 'Affecter' })).toBeDisabled();
    await choix.selectOption(ID.dupain);
    const requete = page.waitForRequest((r) => r.url().endsWith('/affecter'));
    await piece.getByRole('button', { name: 'Affecter' }).click();
    expect((await requete).postDataJSON()).toEqual({ entiteId: ID.dupain });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pièces à qualifier (0)');
    await expect(page.getByText('Aucune pièce en attente.')).toBeVisible();
    expect((await mail()).pieces).toEqual([expect.objectContaining({ statut: 'affectee', dossierAffecteId: ID.dupain })]);
    // La pièce est maintenant dans la file du dossier.
    await page.goto(`/dossiers/${ID.dupain}`);
    await expect(page.getByRole('link', { name: 'facture-2026-118.pdf' })).toBeVisible();
    // Dossier non habilité visé par une requête forgée : refus de l'API relayé.
    expect(alerte).toBe(false);
  });

  test('déconnexion : confirmation, jetons supprimés, démarches restantes affichées (Microsoft)', async ({ page }) => {
    await mail({ configure: true, amorcer: true });
    await page.goto('/messagerie');
    await page.getByRole('link', { name: 'compta@cabinet-alpha.test' }).click();
    await page.getByRole('button', { name: 'Déconnecter et supprimer les jetons' }).click();
    const confirmation = page.getByTestId('confirmation-deconnexion');
    await expect(confirmation).toContainText('Déconnecter compta@cabinet-alpha.test ?');
    expect((await journal()).some((e) => e.methode === 'DELETE')).toBe(false);
    await confirmation.getByRole('button', { name: 'Annuler' }).click();
    await expect(confirmation).toHaveCount(0);
    expect((await mail()).connexions.filter((c) => c.statut === 'supprimee')).toHaveLength(0);
    await page.getByRole('button', { name: 'Déconnecter et supprimer les jetons' }).click();
    await confirmation.getByRole('button', { name: 'Confirmer la déconnexion' }).click();
    const resultat = page.getByTestId('resultat-deconnexion');
    await expect(resultat).toContainText('Les jetons ont été supprimés');
    await expect(resultat).toContainText('n’a pas été révoquée chez le fournisseur');
    await expect(resultat).toContainText('Démarches restantes chez le fournisseur');
    await expect(resultat.getByRole('listitem')).toHaveCount(3);
    await expect(resultat).toContainText('Microsoft Entra');
    await expect(page.locator('[data-statut-connexion="supprimee"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synchroniser maintenant' })).toHaveCount(0);
    expect((await mail()).connexions.find((c) => c.fournisseur === 'microsoft')!.statut).toBe('supprimee');
    await page.goto('/messagerie');
    await expect(page.locator('tr[data-connexion]')).toHaveCount(2);
    await expect(page.getByText('compta@cabinet-alpha.test')).toHaveCount(0);
    // Gmail : révocation chez le fournisseur, aucune démarche restante.
    await page.getByRole('link', { name: 'factures@cabinet-alpha.test' }).click();
    await page.getByRole('button', { name: 'Déconnecter et supprimer les jetons' }).click();
    await page.getByRole('button', { name: 'Confirmer la déconnexion' }).click();
    await expect(page.getByTestId('resultat-deconnexion')).toContainText('révoquée chez le fournisseur');
    await expect(page.getByTestId('resultat-deconnexion')).not.toContainText('Démarches restantes');
  });
});

for (const [qui, nom] of [['remi', 'réviseur'], ['chloe', 'collaboratrice']] as const) {
  test.describe(`messagerie — ${nom} (non gestionnaire)`, () => {
    test.use({ storageState: etatDe(qui) });
    test('aucun lien, écrans refusés proprement, API en 403', async ({ page }) => {
      await mail({ configure: true, amorcer: true });
      const connexion = (await mail()).connexions[0]!.id;
      await page.goto('/');
      await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Messagerie' })).toHaveCount(0);
      expect(await page.locator('a[href^="/messagerie"]').count()).toBe(0);
      for (const chemin of ['/messagerie', '/messagerie/connecter', '/messagerie/a-qualifier', `/messagerie/${connexion}`]) {
        await page.goto(chemin);
        await expect(page.getByTestId('erreur-403')).toContainText('réservée aux gestionnaires du cabinet');
        await expect(page.getByRole('main')).not.toContainText('cabinet-alpha.test');
      }
      const statuts = await page.evaluate(async (id) => {
        const s = async (c: string, init?: RequestInit) => (await fetch(`/api/bff/v1/mail/${c}`, init)).status;
        const ecriture = (method: string, corps: object) => ({ method, headers: { 'X-Comtaple-Csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
        return [await s('connexions'), await s(`connexions/${id}/suivi`), await s('pieces-a-qualifier'), await s('connexions', ecriture('POST', { fournisseur: 'gmail' })), await s(`connexions/${id}`, ecriture('DELETE', {}))];
      }, connexion);
      expect(statuts).toEqual([403, 403, 403, 403, 403]);
      // Un retour OAuth présenté par un non-gestionnaire n'aboutit pas.
      await page.goto('/connexions-mail/retour?state=x&code=y');
      await expect(page.getByTestId('erreur-403')).toBeVisible();
      expect((await mail()).connexions).toHaveLength(3);
    });
  });
}

test.describe('messagerie — client déposant', () => {
  test.use({ storageState: etatDe('client') });
  test('aucun lien et refus', async ({ page }) => {
    await page.goto('/deposer');
    expect(await page.locator('a[href^="/messagerie"]').count()).toBe(0);
    await page.goto('/messagerie');
    await expect(page.getByTestId('erreur-403')).toContainText('réservée aux gestionnaires du cabinet');
    expect(await page.evaluate(async () => (await fetch('/api/bff/v1/mail/connexions')).status)).toBe(403);
  });
});
