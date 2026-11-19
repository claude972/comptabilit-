import { expect, test } from '@playwright/test';
import { ID, etatDe, journal, seConnecter, simulateur, surveiller } from '../outils';

interface EtatAdmin {
  entites: Array<{ id: string; raisonSociale: string; territoireFiscal: string }>;
  habilitations: Array<{ entiteId: string; utilisateurId: string; niveau: string }>;
  exercices: Array<{ entiteId: string; debut: string; fin: string }>;
}
const etatAdmin = () => simulateur<EtatAdmin>('administration', {});
const ALICE = '11111111-1111-4111-8111-111111111101';
const CHLOE = '11111111-1111-4111-8111-111111111103';
const BRUNO = '22222222-2222-4222-8222-222222222201';
const CABINET_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const CABINET_B = 'bbbbbbbb-0000-4000-8000-000000000001';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('administration — administratrice', () => {
  test.use({ storageState: etatDe('alice') });

  test('membres, création d’un dossier (territoire obligatoire, non présélectionné), fiche, exercice, habilitations, audit', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Administration' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Administration du cabinet');
    await expect(page.locator('tr[data-membre]')).toHaveCount(4);
    await expect(page.locator(`tr[data-membre="${CHLOE}"]`)).toContainText('Collaborateur');
    await expect(page.getByTestId('sans-invitation')).toContainText('l’invitation de nouveaux utilisateurs');
    await expect(page.getByText('Bruno Admin')).toHaveCount(0); // autre cabinet

    const creation = page.locator('form[data-formulaire="creer-dossier"]');
    await expect(creation.getByLabel('Territoire fiscal (obligatoire)')).toHaveValue(''); // aucune valeur présélectionnée
    await creation.getByLabel('Raison sociale').fill('Fleuriste Pétale SARL (fictif)');
    await creation.getByRole('button', { name: 'Créer le dossier' }).click();
    await expect(creation.getByRole('alert')).toContainText('Choisissez le territoire fiscal');
    await creation.getByLabel('SIREN (facultatif)').fill('123456789');
    await creation.getByLabel('Territoire fiscal (obligatoire)').selectOption({ label: 'À confirmer' });
    await expect(creation.getByTestId('avertissement-territoire')).toContainText('les contrôles fiscaux ne sont pas réalisés');
    await creation.getByRole('button', { name: 'Créer le dossier' }).click();
    await expect(creation.getByRole('alert')).toContainText('SIREN invalide');
    expect((await journal()).some((e) => e.methode === 'POST' && e.chemin === '/v1/dossiers')).toBe(false);
    await creation.getByLabel('SIREN (facultatif)').fill('123456782');
    await creation.getByLabel('Forme juridique').fill('SARL');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/dossiers'));
    await creation.getByRole('button', { name: 'Créer le dossier' }).click();
    expect((await envoi).postDataJSON()).toEqual({ raisonSociale: 'Fleuriste Pétale SARL (fictif)', siren: '123456782', formeJuridique: 'SARL', territoireFiscal: 'a_confirmer' });
    const cree = page.getByTestId('dossier-cree');
    await expect(cree).toContainText('Vous n’êtes pas habilité sur ce dossier tant que vous ne vous êtes pas accordé une habilitation ; cette attribution est journalisée.');
    const id = (await etatAdmin()).entites.find((e) => e.raisonSociale.startsWith('Fleuriste'))!.id;
    expect((await etatAdmin()).habilitations.filter((h) => h.entiteId === id)).toEqual([]); // le créateur n'est pas habilité d'office

    await cree.getByRole('link', { name: 'Ouvrir la fiche d’administration du dossier' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fleuriste Pétale SARL (fictif)');
    await expect(page.getByTestId('non-habilite')).toBeVisible();
    await expect(page.getByTestId('exercice-impossible')).toContainText('le rôle d’administrateur du cabinet ne suffit pas');
    await expect(page.locator('form[data-formulaire="ouvrir-exercice"]')).toHaveCount(0);
    await page.goto(`/dossiers/${id}`);
    await expect(page.getByTestId('erreur-403')).toBeVisible(); // pas d'accès au contenu sans habilitation
    await page.goto(`/administration/dossiers/${id}`);

    // Habilitations : niveaux plafonnés par le rôle.
    const ligne = (utilisateur: string) => page.locator(`tr[data-membre="${utilisateur}"]`);
    await expect(ligne('11111111-1111-4111-8111-111111111104').locator('option')).toHaveText(['Aucune habilitation', 'Dépôt']);
    await expect(ligne(CHLOE).locator('option')).toHaveText(['Aucune habilitation', 'Dépôt', 'Lecture', 'Collaboration']);
    await expect(ligne(ALICE).locator('option')).toHaveCount(6);
    await ligne(ALICE).getByRole('combobox').selectOption('collaboration');
    await ligne(ALICE).getByRole('button', { name: 'Enregistrer l’habilitation de Alice Admin' }).click();
    await expect(ligne(ALICE)).toContainText('Habilitation accordée à vous-même : cette attribution est journalisée.');
    await expect(page.getByText('Votre habilitation : Collaboration')).toBeVisible();
    await expect(page.getByTestId('non-habilite')).toHaveCount(0);

    // Refus de l'API (400) affiché proprement : niveau au-delà du plafond du rôle, forcé dans la requête.
    await page.route('**/api/bff/v1/dossiers/*/habilitations/*', async (route) => {
      if (route.request().method() === 'PUT' && route.request().url().endsWith(CHLOE)) await route.continue({ postData: JSON.stringify({ niveau: 'validation' }) });
      else await route.continue();
    });
    await ligne(CHLOE).getByRole('combobox').selectOption('collaboration');
    await ligne(CHLOE).getByRole('button', { name: 'Enregistrer l’habilitation de Chloé Collab' }).click();
    await expect(ligne(CHLOE).getByRole('alert')).toContainText('Le rôle « collaborateur » ne peut pas recevoir le niveau « validation »');
    await page.unroute('**/api/bff/v1/dossiers/*/habilitations/*');
    await ligne(CHLOE).getByRole('button', { name: 'Enregistrer l’habilitation de Chloé Collab' }).click();
    await expect(ligne(CHLOE)).toContainText('Habilitation enregistrée.');
    await ligne(CHLOE).getByRole('combobox').selectOption('lecture');
    await ligne(CHLOE).getByRole('button', { name: 'Enregistrer l’habilitation de Chloé Collab' }).click();
    await expect(ligne(CHLOE).locator('td').nth(1)).toContainText('Lecture');
    await ligne(CHLOE).getByRole('combobox').selectOption('');
    await ligne(CHLOE).getByRole('button', { name: 'Enregistrer l’habilitation de Chloé Collab' }).click();
    await expect(ligne(CHLOE)).toContainText('Habilitation retirée.');
    expect((await etatAdmin()).habilitations.filter((h) => h.entiteId === id)).toEqual([{ entiteId: id, utilisateurId: ALICE, niveau: 'collaboration' }]);

    // Exercice : possible maintenant que l'habilitation de collaboration est accordée.
    const exercice = page.locator('form[data-formulaire="ouvrir-exercice"]');
    await exercice.getByLabel('Début de l’exercice').fill('2025-01-01');
    await exercice.getByLabel('Fin de l’exercice').fill('2025-12-31');
    await exercice.getByRole('button', { name: 'Ouvrir l’exercice' }).click();
    await expect(page.getByTestId('exercices')).toContainText('Du 01/01/2025 au 31/12/2025');
    await exercice.getByLabel('Début de l’exercice').fill('2025-06-01');
    await exercice.getByLabel('Fin de l’exercice').fill('2026-05-31');
    await exercice.getByRole('button', { name: 'Ouvrir l’exercice' }).click();
    await expect(exercice.getByRole('alert')).toContainText('chevauche un exercice existant');

    // Changement de territoire : avertissement avant, puis enregistrement.
    const fiche = page.locator('form[data-formulaire="modifier-dossier"]');
    await expect(fiche.getByLabel('Territoire fiscal (obligatoire)')).toHaveValue('a_confirmer');
    await fiche.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(fiche.getByRole('alert')).toContainText('Aucune modification');
    await fiche.getByLabel('Territoire fiscal (obligatoire)').selectOption('metropole');
    await expect(fiche.getByTestId('avertissement-changement-territoire')).toContainText('les contrôles déjà exécutés sur ce dossier deviennent obsolètes');
    const modification = page.waitForRequest((r) => r.method() === 'PATCH');
    await fiche.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    expect((await modification).postDataJSON()).toEqual({ territoireFiscal: 'metropole' });
    await expect(page.getByText('Dossier modifié.')).toBeVisible();
    expect((await etatAdmin()).entites.find((e) => e.id === id)!.territoireFiscal).toBe('metropole');

    // Journal d'audit : actions tracées, acteur nommé, précisions simples, chaîne intacte.
    await page.goto('/administration');
    await expect(page.locator(`tr[data-dossier="${id}"]`)).toContainText('Collaboration');
    await expect(page.getByTestId('integrite-audit')).toContainText('Chaîne intacte');
    const audit = page.getByRole('region', { name: 'Dernières lignes du journal d’audit' });
    await expect(audit.getByRole('row').filter({ hasText: 'dossier.cree' })).toContainText('Alice Admin');
    await expect(audit.getByRole('row').filter({ hasText: 'dossier.cree' })).toContainText('territoireFiscal : a_confirmer');
    await expect(audit.getByRole('row').filter({ hasText: 'habilitation.accordee' }).filter({ hasText: 'pourSoiMeme : true' })).toHaveCount(1);
    await expect(audit.getByRole('row').filter({ hasText: 'habilitation.retiree' })).toHaveCount(1);
    await expect(audit.getByRole('row').filter({ hasText: 'import.fec.termine' })).toContainText('Système');
    await expect(audit.getByRole('row').filter({ hasText: 'import.fec.termine' })).not.toContainText('CHAMP_VIDE'); // objet imbriqué non affiché
    await simulateur('administration', { rupture: 3 });
    await page.reload();
    await expect(page.getByTestId('integrite-audit')).toContainText('Première ligne incohérente : n° 3');
    expect(erreurs).toEqual([]);
  });
});

for (const qui of ['remi', 'client'] as const) {
  test.describe(`administration — ${qui} (non gestionnaire)`, () => {
    test.use({ storageState: etatDe(qui) });
    test('aucun lien, écrans refusés, API en 403', async ({ page }) => {
      await page.goto('/depots');
      expect(await page.locator('a[href^="/administration"]').count()).toBe(0);
      for (const chemin of ['/administration', `/administration/dossiers/${ID.dupain}`]) {
        await page.goto(chemin);
        await expect(page.getByTestId('erreur-403')).toContainText('réservée aux administrateurs et associés');
      }
      const statuts = await page.evaluate(async () => {
        const s = async (c: string, init?: RequestInit) => (await fetch(`/api/bff/v1/${c}`, init)).status;
        const post = { method: 'POST', headers: { 'X-Comtaple-Csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ raisonSociale: 'x', territoireFiscal: 'metropole' }) };
        return [await s('cabinet/membres'), await s('audit'), await s('dossiers', post)];
      });
      expect(statuts).toEqual([403, 403, 403]);
    });
  });
}

test.describe('compte membre de plusieurs cabinets (cas simulé : aucun compte de démonstration n’en a plusieurs)', () => {
  test('choix du cabinet mémorisé dans la session serveur et transmis par X-Cabinet-Id', async ({ browser }) => {
    await simulateur('administration', { appartenance: { utilisateurId: BRUNO, cabinetId: CABINET_A, role: 'collaborateur' } });
    const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await contexte.newPage();
    await seConnecter(page, 'bruno', '/depots');
    // Sans cabinet choisi, l'API répond 400 : l'application propose le choix.
    await expect(page).toHaveURL(/\/cabinet$/);
    const choix = page.getByTestId('choix-cabinet');
    await expect(choix.getByRole('button')).toHaveText([/Cabinet Alpha Expertise \(fictif\)\s*Collaborateur/, /Cabinet Bêta Conseil \(fictif\)\s*Administrateur du cabinet/]);
    expect((await journal()).some((e) => e.chemin === '/v1/cabinets' && e.statut === 200)).toBe(true);
    await choix.getByRole('button', { name: /Cabinet Alpha/ }).click();
    await expect(page).toHaveURL('http://localhost:3000/');
    await expect(page.getByRole('banner')).toContainText('Collaborateur · Cabinet Alpha Expertise (fictif)');
    await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Administration' })).toHaveCount(0);
    const moi = (entetes: Record<string, string> = {}) => page.evaluate(async (h) => (await (await fetch('/api/bff/v1/moi', { headers: h })).json()).cabinet.id as string, entetes);
    expect(await moi()).toBe(CABINET_A);
    // Un en-tête fourni par le navigateur ne change pas de cabinet : seul le choix de la session compte.
    expect(await moi({ 'X-Cabinet-Id': CABINET_B })).toBe(CABINET_A);
    // Le choix survit au renouvellement du jeton (marge de 290 s : renouvelé après 10 s).
    await page.waitForTimeout(11_000);
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('Cabinet Alpha Expertise (fictif)');

    await page.getByRole('link', { name: 'Changer de cabinet' }).click();
    await page.getByTestId('choix-cabinet').getByRole('button', { name: /Cabinet Bêta/ }).click();
    await expect(page.getByRole('banner')).toContainText('Administrateur du cabinet · Cabinet Bêta Conseil (fictif)');
    expect(await moi()).toBe(CABINET_B);
    await page.goto('/dossiers');
    await expect(page.getByRole('main')).toContainText('Menuiserie Leroy SAS (fictive)');
    await expect(page.getByRole('main')).not.toContainText('Boulangerie Dupain');
    // Cabinet dont le compte n'est pas membre : refusé, la session ne change pas.
    await page.goto('/cabinet');
    await page.locator('input[name="cabinetId"]').first().evaluate((e: HTMLInputElement) => (e.value = 'cccccccc-0000-4000-8000-000000000001'));
    await page.getByTestId('choix-cabinet').getByRole('button').first().click();
    await expect(page).toHaveURL(/\/cabinet\?erreur=1$/);
    await expect(page.getByRole('alert').filter({ hasText: 'ne fait pas partie' })).toBeVisible();
    expect(await moi()).toBe(CABINET_B);
    await contexte.close();
  });
});

test.describe('raccords — collaboratrice', () => {
  test.use({ storageState: etatDe('chloe') });

  test('constat : affectation à une personne habilitée sur le dossier', async ({ page }) => {
    await page.goto(`/dossiers/${ID.dupain}/revision`);
    await page.getByTestId('liste-constats').getByRole('link', { name: /Compte d’attente/ }).click();
    const f = page.locator('form[data-formulaire="constat"]');
    await f.getByLabel('Action').selectOption('affecter');
    // Personnes habilitées au moins en lecture (le déposant n'est pas proposé).
    await expect(f.getByLabel('Affecter à').locator('option')).toHaveText(['Choisir une personne habilitée…', 'Alice Admin', 'Rémi Réviseur', 'Chloé Collab']);
    await f.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(f.getByRole('alert')).toContainText('Choisissez la personne');
    await f.getByLabel('Affecter à').selectOption({ label: 'Rémi Réviseur' });
    const envoi = page.waitForRequest((r) => r.method() === 'PATCH');
    await f.getByRole('button', { name: 'Enregistrer' }).click();
    expect((await envoi).postDataJSON()).toEqual({ action: 'affecter', affecteA: '11111111-1111-4111-8111-111111111102' });
    await expect(page.getByTestId('affecte-a')).toHaveText('Affecté à : Rémi Réviseur');
    await expect(page.getByTestId('historique-decisions')).toContainText('Affecter');
  });

  test('pièces déposées : filtre « mes dépôts » ; pièces d’un dossier : pagination et filtre par le serveur au-delà d’une page', async ({ page }) => {
    await page.goto('/depots');
    await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: '.pdf' })).toHaveCount(2);
    await page.getByTestId('filtre-deposant').getByRole('link', { name: 'Mes dépôts' }).click();
    await expect(page).toHaveURL(/deposant=moi/);
    await expect(page.getByRole('main').getByRole('link', { name: /facture-electronique\.xml/ })).toBeVisible();
    await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: '.pdf' })).toHaveCount(0);
    expect((await journal()).some((e) => /deposant=moi/.test(e.chemin))).toBe(true);

    await simulateur('administration', { documents: 150 });
    await page.goto(`/dossiers/${ID.dupain}`);
    const lignes = page.getByRole('region', { name: 'Pièces du dossier' }).locator('tbody tr');
    await expect(lignes).toHaveCount(100);
    await expect(page.getByRole('link', { name: 'Toutes', exact: true })).toBeVisible(); // plus de décompte : il serait faux
    const pagination = page.getByRole('navigation', { name: 'Pagination des pièces' });
    await expect(pagination).toContainText('Page 1 (100 par page)');
    await pagination.getByRole('link', { name: 'Plus anciennes →' }).click();
    await expect(lignes).toHaveCount(54);
    await expect(pagination.getByText('Plus anciennes →')).not.toHaveAttribute('href');
    await page.getByRole('link', { name: 'À compléter', exact: true }).click();
    await expect(lignes).toHaveCount(1);
    await expect(lignes).toContainText('photo-ticket-caisse.png');
    expect((await journal()).some((e) => /statut=a_completer/.test(e.chemin))).toBe(true);
  });
});
