import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, simulateur, statutBff, surveiller } from '../outils';

const ALICE = '11111111-1111-4111-8111-111111111101';
const CHLOE = '11111111-1111-4111-8111-111111111103';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('règles du cabinet', () => {
  test.use({ storageState: etatDe('chloe') });

  test('proposition par une collaboratrice, impact mesuré, approbation par une AUTRE personne, effet visible dans la révision, retrait', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Règles du cabinet' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Règles du cabinet');
    const jeu = page.getByTestId('regles-du-jeu');
    await expect(jeu).toContainText('Une proposition n’a aucun effet tant qu’elle n’est pas approuvée.');
    await expect(jeu).toContainText('L’impact doit être mesuré sur un exercice avant toute approbation.');
    await expect(jeu).toContainText('Pas d’auto-approbation');
    for (const statut of ['proposee', 'approuvee', 'retiree', 'refusee']) await expect(page.locator(`[data-statut-regles="${statut}"]`)).toContainText('(0)');

    const f = page.locator('form[data-formulaire="proposer-regle"]');
    // Contrôle à fondement réglementaire : affiché non paramétrable, avec l'explication ; aucun champ, aucun envoi possible.
    await f.getByLabel('Contrôle').selectOption('TRE_001');
    await expect(f.getByTestId('non-parametrable')).toContainText('Ce contrôle repose sur une règle réglementaire : ses paramètres ne se modifient pas par une préférence de cabinet.');
    await expect(f.getByTestId('parametres-regle')).toHaveCount(0);
    await expect(f.getByRole('button', { name: 'Proposer cette règle' })).toBeDisabled();
    expect(await statutBff(page, 'POST', 'v1/regles', { controleId: 'TRE_001', entiteId: ID.dupain, parametres: { seuil: '50.00' }, motif: 'Essai sur une règle réglementaire' })).toBe(409);

    // Contrôle interne : champs déduits de parametresParDefaut (montant en chaîne décimale, liste, entier, case à cocher).
    await f.getByLabel('Contrôle').selectOption('TIE_001');
    await expect(f.getByLabel(/Seuil \(seuil\)/)).toHaveValue('0.00');
    await expect(f.getByLabel(/Prefixes comptes/)).toHaveValue('411');
    await expect(f.getByLabel(/Max constats/)).toHaveValue('200');
    await expect(f.getByRole('checkbox', { name: /Inclure comptes soldes/ })).not.toBeChecked();
    // Une collaboratrice ne propose pas pour tout le cabinet : portée « dossier » seulement.
    await expect(f.getByRole('radio', { name: 'Tout le cabinet' })).toBeDisabled();
    await expect(f.getByRole('radio', { name: 'Un dossier' })).toBeChecked();
    await f.getByRole('button', { name: 'Proposer cette règle' }).click();
    await expect(f.getByRole('alert')).toContainText('Choisissez le dossier concerné.');
    await expect(f.getByRole('alert')).toContainText('Le motif est obligatoire');
    await expect(f.getByRole('alert')).toContainText('Modifiez au moins un paramètre');
    await f.getByLabel('Dossier concerné').selectOption({ label: 'Boulangerie Dupain SAS (fictive)' });
    await f.getByLabel(/Seuil \(seuil\)/).fill('cent euros');
    await f.getByLabel('Motif de la proposition (obligatoire)').fill('Petits avoirs clients en attente de remboursement, sans enjeu');
    await f.getByRole('button', { name: 'Proposer cette règle' }).click();
    await expect(f.getByRole('alert')).toContainText('« seuil » : nombre décimal attendu');
    await f.getByLabel(/Seuil \(seuil\)/).fill('100,00');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/regles'));
    await f.getByRole('button', { name: 'Proposer cette règle' }).click();
    // Seul le paramètre modifié part, et le montant reste une chaîne décimale.
    expect((await envoi).postDataJSON()).toEqual({ controleId: 'TIE_001', entiteId: ID.dupain, parametres: { seuil: '100.00' }, motif: 'Petits avoirs clients en attente de remboursement, sans enjeu' });

    const regle = page.locator('[data-statut-regles="proposee"] [data-regle]');
    await expect(regle).toHaveCount(1);
    await expect(regle).toContainText('Projet — sans effet tant qu’elle n’est pas approuvée');
    await expect(regle.getByTestId('portee')).toHaveText('Portée : dossier « Boulangerie Dupain SAS (fictive) »');
    await expect(regle.getByTestId('parametres')).toContainText('100.00');
    await expect(regle.getByTestId('parametres')).toContainText('(par défaut : 0.00)');
    await expect(regle).toContainText('Proposée par vous');
    await expect(regle.getByTestId('impact-absent')).toContainText('L’approbation est impossible tant que l’impact n’a pas été mesuré.');
    // Une collaboratrice ne voit aucun bouton de décision, et l'API refuse de toute façon.
    await expect(regle.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
    const id = (await etatSuite()).regles[0]!.id;
    expect(await statutBff(page, 'POST', `v1/regles/${id}/approuver`)).toBe(403);

    // Sans approbation, aucun effet : la révision relancée donne toujours le constat, sans mention de règle.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto('http://localhost:3000/regles');
    const chezAlice = alice.locator(`[data-regle="${id}"]`);
    await expect(chezAlice).toContainText('Proposée par Chloé Collab');
    await expect(chezAlice.getByRole('button', { name: 'Approuver' })).toBeDisabled();
    await expect(chezAlice.getByTestId('blocage-approbation')).toHaveText('Mesurez l’impact avant d’approuver.');
    expect(await statutBff(alice, 'POST', `v1/regles/${id}/approuver`)).toBe(409); // l'API exige la mesure

    // Mesure d'impact par la collaboratrice, sur l'exercice du dossier.
    await regle.getByRole('button', { name: 'Mesurer l’impact' }).click();
    const mesure = regle.locator('form[data-formulaire="mesurer-impact"]');
    await expect(mesure.getByLabel('Exercice')).toContainText('Du 01/01/2025 au 31/12/2025');
    await mesure.getByRole('button', { name: 'Mesurer sur cet exercice' }).click();
    await expect(regle.getByTestId('impact-avant')).toContainText('Constat à examiner');
    await expect(regle.getByTestId('impact-avant')).toContainText('1 constat(s)');
    await expect(regle.getByTestId('impact-apres')).toContainText('Exécuté sans anomalie détectée');
    await expect(regle.getByTestId('impact-apres')).toContainText('0 constat(s)');
    await expect(regle.getByTestId('impact-disparaissent')).toHaveText('1');
    await expect(regle.getByTestId('impact-apparaissent')).toHaveText('0');

    // Approbation par l'administratrice (autre personne que l'auteure).
    await alice.reload();
    await chezAlice.getByRole('button', { name: 'Approuver' }).click();
    await expect(alice.locator(`[data-statut-regles="approuvee"] [data-regle="${id}"]`)).toContainText('Approuvée');
    expect((await etatSuite()).regles[0]).toMatchObject({ statut: 'approuvee', proposeePar: CHLOE, approuveePar: ALICE });

    // Effet dans la révision : exécution précédente obsolète, puis résultat tracé « paramètres propres au dossier ».
    await alice.goto(`http://localhost:3000/dossiers/${ID.dupain}/revision`);
    await expect(alice.getByTestId('bandeau-obsolete')).toBeVisible();
    await expect(alice.getByTestId('origine-parametres')).toHaveCount(0);
    await alice.getByRole('button', { name: 'Relancer les contrôles' }).click();
    const ligne = alice.locator('tr[data-controle="TIE_001"]');
    await expect(ligne.getByTestId('origine-parametres')).toContainText('Paramètres propres au dossier — règle v1', { timeout: 20_000 });
    await expect(ligne).toHaveAttribute('data-statut', 'sans_anomalie');
    await expect(alice.locator('tr[data-controle="TRE_001"]').getByTestId('origine-parametres')).toHaveCount(0);

    // Retrait (réversible, historisé), avec confirmation.
    await alice.goto('http://localhost:3000/regles');
    await chezAlice.getByRole('button', { name: 'Retirer' }).click();
    await chezAlice.getByRole('button', { name: 'Confirmer le retrait' }).click();
    await expect(alice.locator(`[data-statut-regles="retiree"] [data-regle="${id}"]`)).toBeVisible();
    await alice.context().close();
    expect(erreurs).toEqual([]);
  });
});

test.describe('règles du cabinet — gestionnaire et client', () => {
  test.use({ storageState: etatDe('alice') });

  test('pas d’auto-approbation ; préférence de tout le cabinet ; refus avec motif', async ({ page }) => {
    await page.goto('/regles');
    const f = page.locator('form[data-formulaire="proposer-regle"]');
    await f.getByLabel('Contrôle').selectOption('GEN_005');
    await expect(f.getByRole('radio', { name: 'Tout le cabinet' })).toBeChecked();
    await f.getByLabel(/Seuil \(seuil\)/).fill('25000');
    await f.getByLabel('Motif de la proposition (obligatoire)').fill('Seuil relevé pour les grands dossiers');
    await f.getByRole('button', { name: 'Proposer cette règle' }).click();
    const regle = page.locator('[data-statut-regles="proposee"] [data-regle]');
    await expect(regle.getByTestId('portee')).toHaveText('Portée : tout le cabinet');
    // Règle de tout le cabinet : le dossier servant à la mesure se choisit.
    await regle.getByRole('button', { name: 'Mesurer l’impact' }).click();
    await regle.getByLabel('Dossier servant à la mesure').selectOption({ label: 'Boulangerie Dupain SAS (fictive)' });
    await expect(regle.getByLabel('Exercice')).toContainText('Du 01/01/2025');
    await regle.getByRole('button', { name: 'Mesurer sur cet exercice' }).click();
    await expect(regle.getByTestId('impact')).toBeVisible();
    // Impact mesuré, mais c'est sa propre proposition : approbation impossible, côté écran comme côté API.
    await expect(regle.getByRole('button', { name: 'Approuver' })).toBeDisabled();
    await expect(regle.getByTestId('blocage-approbation')).toContainText('Vous avez proposé cette règle');
    const id = (await etatSuite()).regles[0]!.id;
    expect(await statutBff(page, 'POST', `v1/regles/${id}/approuver`)).toBe(403);
    await regle.getByRole('button', { name: 'Refuser' }).click();
    await regle.getByRole('button', { name: 'Confirmer le refus' }).click();
    await expect(regle.getByRole('alert')).toContainText('Un motif est requis pour refuser.');
    await regle.getByLabel('Motif du refus (obligatoire)').fill('Essai');
    await regle.getByRole('button', { name: 'Confirmer le refus' }).click();
    await expect(page.locator(`[data-statut-regles="refusee"] [data-regle="${id}"]`)).toContainText('Refusée');
    await expect(page.locator('[data-statut-regles="proposee"]')).toContainText('(0)');
  });

  test('au-delà d’une page : décomptes sur toutes les règles, pages « plus anciennes » et « plus récentes »', async ({ page }) => {
    await page.goto('/regles');
    for (let i = 0; i < 53; i++) {
      expect(await statutBff(page, 'POST', 'v1/regles', { controleId: 'TIE_001', entiteId: ID.dupain, motif: `Proposition d’essai n° ${i + 1}`, parametres: { seuil: `${i + 1}.00` } })).toBe(201);
    }
    await page.goto('/regles');
    const proposees = page.locator('section[data-statut-regles="proposee"]');
    await expect(proposees.getByRole('heading')).toContainText('(53)'); // total, pas le nombre affiché
    await expect(proposees.getByRole('listitem').filter({ hasText: 'Proposition d’essai n° 53' })).toHaveCount(1);
    await expect(page.getByTestId('pagination-regles')).toContainText('Page 1 — 50 règle(s) affichée(s) sur 53');
    await expect(page.getByText(/Proposition d’essai n° 3(?!\d)/)).toHaveCount(0); // sur la page suivante
    await page.getByRole('link', { name: 'Plus anciennes →' }).click();
    await expect(page).toHaveURL(/\/regles\?page=2$/);
    await expect(page.getByTestId('pagination-regles')).toContainText('Page 2 — 3 règle(s) affichée(s) sur 53');
    await expect(proposees.getByRole('heading')).toContainText('(53)');
    for (const n of [1, 2, 3]) await expect(proposees.getByText(new RegExp(`Proposition d’essai n° ${n}(?!\\d)`))).toHaveCount(1);
    await expect(page.getByText(/Proposition d’essai n° 53/)).toHaveCount(0);
    await page.getByRole('link', { name: '← Plus récentes' }).click();
    await expect(page).toHaveURL(/\/regles\?page=1$/);
  });

  test('refusé aux clients : écran et API', async ({ browser }) => {
    const client = await (await browser.newContext({ storageState: etatDe('client') })).newPage();
    await client.goto('http://localhost:3000/regles');
    await expect(client.getByTestId('erreur-403')).toContainText('réservées aux membres du cabinet');
    await expect(client.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Règles du cabinet' })).toHaveCount(0);
    expect(await statutBff(client, 'GET', 'v1/regles')).toBe(403);
    await client.context().close();
  });
});
