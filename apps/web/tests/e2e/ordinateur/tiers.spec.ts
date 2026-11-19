import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, statutBff, surveiller } from '../outils';

/**
 * Onglet « Tiers et factures » contre le simulateur d'API (calcul fait par le vrai moteur sur un jeu fictif) :
 * référentiel des tiers, fiche, échéancier, détail d'une facture avec ses preuves, propositions à confirmer,
 * suspicion de double comptabilisation, droits par niveau, absence de données, écran étroit.
 */
const onglet = `/dossiers/${ID.dupain}/tiers`;
const F = ' '; // espace fine insécable des montants
const DOC = { f1: 'dddddddd-0000-4000-8000-000000000001', f2: 'dddddddd-0000-4000-8000-000000000002', double: 'dddddddd-0000-4000-8000-000000000003', sansEcheance: 'dddddddd-0000-4000-8000-000000000004' };
const EX_MARTIN = 'aaaaaaaa-0000-4000-8000-0000000000f2';
interface DecisionsSimulees {
  decisionsTiers: Array<{ cleComptable: string; clePiece: string; decision: string }>;
  decisionsFactures: Array<{ type: string; objet: string; cible: string; decision: string; motif: string | null }>;
}
const decisions = () => simulateur<DecisionsSimulees>('tiers');
const sections = (page: Page) => page.getByRole('navigation', { name: 'Tiers et factures' });
const ligneFacture = (page: Page, numero: string) => page.getByTestId('ligne-facture').filter({ hasText: numero });

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('tiers et factures — collaboratrice', () => {
  test.use({ storageState: etatDe('chloe') });

  test('référentiel des tiers : soldes tirés des écritures, recherche, homonymes signalés, fiche avec identifiants, mouvements et factures', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Tiers et factures' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Tiers et factures' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('avertissement-tiers')).toContainText('rien n’est comptabilisé ni lettré ici');
    // La date d'appréciation est toujours dite : par défaut, la clôture de l'exercice.
    await expect(page.getByTestId('date-appreciation')).toHaveText('31/12/2025');
    await expect(page.getByTestId('entete-tiers')).toContainText('clôture de l’exercice');

    const lignes = page.getByTestId('ligne-tiers');
    await expect(lignes).toHaveCount(6); // 5 comptes auxiliaires + l'émetteur « Dupont » connu des seules pièces
    const dupont = lignes.filter({ hasText: 'Compte auxiliaire FDUPONT' });
    await expect(dupont.locator('td').nth(0)).toHaveText('Fournisseur');
    await expect(dupont.locator('td').nth(3)).toHaveText('0,00'); // facture réglée : solde nul
    const code = lignes.filter({ hasText: 'Fournitures du Centre' });
    await expect(code.locator('td').nth(3)).toHaveText(`−2${F}160,00`); // 600 + 900 + 900 + 360 − 200 − 400
    await expect(lignes.filter({ hasText: 'Connu des seules pièces' })).toContainText('aucune écriture');
    await expect(lignes.filter({ hasText: 'Compte auxiliaire F1' })).toContainText('Homonyme de 1 autre(s) tiers');
    await expect(page.getByTestId('lien-propositions')).toContainText('1 rapprochement(s) de tiers proposé(s), à confirmer');

    // Recherche (formulaire GET) : par nom sans accent, puis par type.
    await page.getByLabel('Nom, compte auxiliaire ou identifiant').fill('materiaux');
    await page.getByRole('button', { name: 'Rechercher un tiers' }).click();
    await expect(page).toHaveURL(/q=materiaux/);
    await expect(lignes).toHaveCount(2);
    await page.getByLabel('Nom, compte auxiliaire ou identifiant').fill('zzz');
    await page.getByRole('button', { name: 'Rechercher un tiers' }).click();
    await expect(page.getByTestId('aucun-tiers')).toContainText('ne correspond à cette recherche');
    await page.getByLabel('Nom, compte auxiliaire ou identifiant').fill('');
    await page.getByLabel('Type', { exact: true }).selectOption('client');
    await page.getByRole('button', { name: 'Rechercher un tiers' }).click();
    await expect(lignes).toHaveCount(1);
    await expect(lignes).toContainText('Martin SA (fictif)');

    // Fiche d'un tiers : identifiant fort trouvé dans le compte auxiliaire et sur les pièces, mouvements, factures.
    await sections(page).getByRole('link', { name: 'Tiers', exact: true }).click();
    await lignes.filter({ hasText: 'Fournitures du Centre' }).getByRole('link').click();
    const fiche = page.getByTestId('fiche-tiers');
    await expect(fiche.getByRole('heading', { name: /Fournitures du Centre \(fictif\)/ })).toBeVisible();
    await expect(fiche.getByTestId('solde-tiers')).toHaveText(`−2${F}160,00`);
    await expect(fiche.getByTestId('identifiants')).toContainText('SIREN 552100554 — trouvé dans le compte auxiliaire des écritures');
    await expect(fiche.getByTestId('identifiants')).toContainText('SIREN 552100554 — lu sur 3 pièce(s)');
    await expect(fiche).toContainText('par identifiant fort (SIREN)');
    await expect(fiche.getByRole('region', { name: 'Mouvements du tiers tirés des écritures' }).locator('tbody tr')).toHaveCount(6);
    await expect(fiche.getByTestId('ligne-facture')).toHaveCount(3);
    // Une collaboratrice ne peut pas infirmer un rattachement.
    await expect(fiche.getByRole('button', { name: /Infirmer/ })).toHaveCount(0);
    expect(erreurs).toEqual([]);
  });

  test('échéancier : états à la date d’appréciation, filtres, échéance absente jamais inventée ; détail d’une facture avec pièce, écriture, règlements et preuves', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`${onglet}?vue=echeancier`);
    await expect(sections(page).getByRole('link', { name: 'Échéancier des factures' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('ligne-facture')).toHaveCount(5);
    await expect(ligneFacture(page, 'FA-2025-0042')).toContainText('Réglée');
    await expect(ligneFacture(page, 'FS-001')).toContainText('Partiellement réglée');
    await expect(ligneFacture(page, 'FS-001').locator('td').nth(3)).toHaveText('400,00');
    await expect(ligneFacture(page, 'FS-001')).toContainText('275 j de retard');
    // Ambiguïté (deux écritures) : état et reste dû « non déterminable », suspicion signalée.
    await expect(ligneFacture(page, 'FS-002')).toContainText('Non déterminable');
    await expect(ligneFacture(page, 'FS-002')).toContainText('Suspicion');
    await expect(ligneFacture(page, 'FS-002').locator('td').nth(3)).toHaveText('non déterminable');
    // Échéance non lue : dite « non déterminable », en fin de liste, reste dû tout de même calculé.
    await expect(page.getByTestId('ligne-facture').last()).toContainText('FS-003');
    await expect(ligneFacture(page, 'FS-003').locator('td').nth(1)).toHaveText('non déterminable');
    await expect(ligneFacture(page, 'FS-003').locator('td').nth(3)).toHaveText('360,00');
    await expect(page.getByTestId('decomptes-etats')).toContainText('Partiellement réglée : 1 — reste dû 400,00');
    await expect(page.getByTestId('decomptes-etats')).toContainText('Non déterminable : 3');

    // Filtre par état.
    await page.getByLabel('État', { exact: true }).selectOption('partiellement_reglee');
    await page.getByRole('button', { name: 'Filtrer', exact: true }).click();
    await expect(page).toHaveURL(/etat=partiellement_reglee/);
    await expect(page.getByTestId('ligne-facture')).toHaveCount(1);
    await page.getByLabel('État', { exact: true }).selectOption('trop_percu');
    await page.getByRole('button', { name: 'Filtrer', exact: true }).click();
    await expect(page.getByTestId('aucune-facture')).toHaveText('Aucune facture ne correspond à ce filtre.');

    // Date d'appréciation fournie : la facture FS-001 n'est pas encore échue au 15 mars, l'acompte du 20 n'est pas compté.
    await page.goto(`${onglet}?vue=echeancier`);
    await page.getByLabel('Apprécier les échéances au (vide : clôture)').fill('2025-03-15');
    await page.getByRole('button', { name: 'Appliquer la date' }).click();
    await expect(page.getByTestId('date-appreciation')).toHaveText('15/03/2025');
    await expect(page.getByTestId('entete-tiers')).toContainText('date fournie');
    await expect(ligneFacture(page, 'FS-001')).toContainText('Non échue');
    await expect(ligneFacture(page, 'FS-001').locator('td').nth(3)).toHaveText('600,00');

    // Détail (à la clôture) : pièce, écriture et critères, règlement identifié par la référence, proposition non comptée, preuves.
    await page.goto(`${onglet}?vue=echeancier`);
    await ligneFacture(page, 'FS-001').getByRole('link').click();
    const detail = page.getByTestId('detail-facture');
    await expect(detail.getByRole('heading', { name: /Facture FS-001/ })).toContainText('Partiellement réglée');
    await expect(detail.getByRole('link', { name: 'facture-fs-001.pdf' })).toHaveAttribute('href', `/dossiers/${ID.dupain}/pieces/${DOC.f2}`);
    await expect(detail).toContainText('extraction version 1, projet non validé');
    await expect(detail.getByTestId('ecriture-facture')).toContainText('ACH ACH0002 du 01/03/2025');
    await expect(detail).toContainText('Critères : montant identique ; référence identique ; dates concordantes ; tiers identifié.');
    await expect(detail.getByRole('region', { name: 'Lignes de l’écriture' }).locator('tbody tr')).toHaveCount(2);
    await expect(detail.getByTestId('imputations').locator('li')).toHaveCount(1);
    await expect(detail.getByTestId('imputations')).toContainText('Montant imputé à cette facture : 200,00 — identifié par : Référence de la facture citée');
    await expect(detail.getByTestId('imputations')).toContainText('Aucun rapprochement bancaire validé');
    await expect(detail.getByTestId('reste-du')).toHaveText('400,00');
    await expect(detail.getByTestId('preuves')).toContainText('2025-12-31 (clôture de l’exercice)');
    await expect(detail.getByTestId('preuves')).toContainText('déduit par le moteur (montant identique, référence identique, dates concordantes, tiers identifié)');

    // La collaboratrice confirme le règlement proposé (même montant que le reste dû) : la facture devient réglée.
    const proposition = detail.getByTestId('propositions-imputation').locator('li');
    await expect(proposition).toHaveCount(1);
    await expect(proposition).toContainText('Même montant que le reste dû, sans référence à la facture.');
    await expect(proposition.getByRole('button', { name: /Infirmer/ })).toHaveCount(0); // réservé au niveau révision
    const envoi = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes(`/factures/${DOC.f2}/liens`));
    await proposition.getByRole('button', { name: /Confirmer ce règlement/ }).click();
    expect((await envoi).postDataJSON()).toEqual({ type: 'imputation', cible: 'BQ|BQ0003', decision: 'confirme' });
    await expect(detail.getByRole('heading', { name: /Facture FS-001/ })).toContainText('Réglée');
    await expect(detail.getByTestId('reste-du')).toHaveText('0,00');
    await expect(detail.getByTestId('imputations')).toContainText('identifié par : Confirmé par une personne');
    expect((await decisions()).decisionsFactures).toEqual([expect.objectContaining({ type: 'imputation', objet: DOC.f2, cible: 'BQ|BQ0003', decision: 'confirme' })]);
    // L'API refuse à ce niveau d'infirmer ou de statuer sur une suspicion.
    expect(await statutBff(page, 'PUT', `v1/exercices/${ID.exDupain}/factures/${DOC.f2}/liens`, { type: 'imputation', cible: 'BQ|BQ0003', decision: 'infirme', motif: 'x' })).toBe(403);
    expect(await statutBff(page, 'PUT', `v1/exercices/${ID.exDupain}/suspicions`, { cle: 'E:ACH|ACH0003+ACH|ACH0004', decision: 'confirme' })).toBe(403);

    // Facture sans échéance : le motif est affiché, l'échéance n'est pas inventée.
    await page.goto(`${onglet}?vue=facture&facture=${DOC.sansEcheance}`);
    await expect(page.getByTestId('motif-etat')).toContainText('échéance non lue sur la pièce');
    await expect(page.getByTestId('detail-facture')).toContainText('non déterminable (non lue sur la pièce, jamais inventée)');
    expect(erreurs).toEqual([]);
  });

  test('à confirmer : la collaboratrice confirme un tiers proposé par son nom et un lien pièce ↔ écriture ; les homonymes ne sont jamais fusionnés', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`${onglet}?vue=a-traiter`);
    const proposition = page.getByTestId('proposition-tiers');
    await expect(proposition).toHaveCount(1);
    await expect(proposition).toContainText('DUPONT MATERIAUX SARL');
    await expect(proposition).toContainText('SIREN 732829320');
    await expect(proposition).toContainText('un nom identique ne prouve pas qu’il s’agit du même tiers');
    await proposition.getByRole('button', { name: /Confirmer : c’est le même tiers/ }).click();
    await expect(page.getByText('Aucun rapprochement de tiers à confirmer.')).toBeVisible();
    expect((await decisions()).decisionsTiers).toEqual([{ cleComptable: 'aux:FDUPONT', clePiece: 'siren:732829320', decision: 'confirme' }]);

    // Lien pièce ↔ écriture : la vente (client non lu sur la pièce) et la facture ambiguë attendent une personne.
    const liens = page.getByTestId('lien-a-confirmer');
    await expect(liens).toHaveCount(2);
    const vente = liens.filter({ hasText: 'FV-2025-010' });
    await expect(vente).toContainText('tiers non lu sur la pièce');
    await vente.getByRole('button', { name: /Confirmer cette écriture/ }).click();
    await expect(liens).toHaveCount(1);
    await sections(page).getByRole('link', { name: 'Échéancier des factures' }).click();
    await expect(ligneFacture(page, 'FV-2025-010')).toContainText('Réglée');
    await expect(ligneFacture(page, 'FV-2025-010')).toContainText('Martin SA (fictif)');

    // Suspicion : visible, mais la décision est réservée au niveau révision.
    await sections(page).getByRole('link', { name: 'À confirmer et suspicions' }).click();
    await expect(page.getByTestId('suspicion')).toContainText('Statuer sur une suspicion est réservé au niveau révision.');
    expect(erreurs).toEqual([]);
  });
});

test.describe('tiers et factures — réviseur', () => {
  test.use({ storageState: etatDe('remi') });

  test('suspicion de double comptabilisation : preuves affichées, écartée avec motif obligatoire, puis décision retirée ; distincte du doublon binaire', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`${onglet}?vue=a-traiter`);
    await expect(page.getByText('Ce n’est ni un doublon binaire (le même fichier reçu deux fois), ni une nouvelle version d’une pièce.')).toBeVisible();
    const suspicion = page.getByTestId('suspicion');
    await expect(suspicion).toHaveCount(1);
    await expect(suspicion).toContainText('Une même facture portée par plusieurs écritures');
    await expect(suspicion).toContainText('À examiner');
    await expect(suspicion.getByRole('list', { name: 'Preuves de la suspicion' }).locator('li')).toHaveCount(3); // deux écritures et la pièce
    await expect(suspicion).toContainText('ACH0003');
    await expect(suspicion).toContainText('ACH0004');
    // Écarter exige un motif : le bouton reste inactif tant qu'il est vide.
    const ecarter = suspicion.getByRole('button', { name: /^Écarter/ });
    await expect(ecarter).toBeDisabled();
    await suspicion.getByLabel('Motif (requis pour écarter)').fill('Loyer trimestriel facturé deux fois à juste titre');
    await ecarter.click();
    await expect(suspicion).toContainText('Écartée');
    expect((await decisions()).decisionsFactures).toEqual([expect.objectContaining({ type: 'suspicion', objet: 'E:ACH|ACH0003+ACH|ACH0004', decision: 'infirme', motif: 'Loyer trimestriel facturé deux fois à juste titre' })]);
    await suspicion.getByRole('button', { name: /Retirer la décision/ }).click();
    await expect(suspicion).toContainText('À examiner');
    await suspicion.getByRole('button', { name: /Confirmer la double comptabilisation/ }).click();
    await expect(suspicion).toContainText('Confirmée');

    // Confirmer la suspicion ne choisit pas l'écriture : la facture reste à rattacher explicitement.
    await suspicion.getByRole('link', { name: 'Pièce 1 de la suspicion' }).click();
    const detail = page.getByTestId('detail-facture');
    await expect(detail).toContainText('Ambiguïté à lever');
    await expect(detail.getByTestId('proposition-ecriture')).toHaveCount(2);
    await detail.getByTestId('proposition-ecriture').first().getByRole('button', { name: /Confirmer cette écriture/ }).click();
    await expect(detail).toContainText('Écriture confirmée par une personne');
    await expect(detail.getByRole('heading', { name: /Facture FS-002/ })).toContainText('Échue non réglée');
    await expect(detail.getByTestId('reste-du')).toHaveText('900,00');
    // Le réviseur infirme le lien qu'il vient de confirmer, avec un motif.
    const carte = detail.locator('div').filter({ has: page.getByTestId('ecriture-facture') }).last();
    await carte.getByLabel('Motif (requis pour infirmer)').first().fill('Mauvaise écriture');
    await carte.getByRole('button', { name: 'Infirmer : l’écriture retenue' }).click();
    await expect(detail).not.toContainText('Écriture confirmée par une personne');
    expect(erreurs).toEqual([]);
  });

  test('sans écriture ni pièce : l’écran le dit et n’invente rien', async ({ page }) => {
    await page.goto(`/dossiers/${ID.martin}/tiers?exercice=${EX_MARTIN}`);
    await expect(page.getByTestId('sans-donnees')).toContainText('Aucune donnée comptable importée pour cet exercice');
    await expect(page.getByTestId('aucun-tiers')).toBeVisible();
    await sections(page).getByRole('link', { name: 'Échéancier des factures' }).click();
    await expect(page.getByTestId('aucune-facture')).toContainText('Aucune facture ni avoir n’est suivi sur cet exercice');
    await sections(page).getByRole('link', { name: 'À confirmer et suspicions' }).click();
    await expect(page.getByTestId('aucune-suspicion')).toBeVisible();
  });

  test('écran étroit (360 px) : aucune vue ne déborde horizontalement', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const vue of ['tiers', 'echeancier', 'a-traiter', `facture&facture=${DOC.f2}`, `facture&facture=${DOC.double}`, `fiche&cle=${encodeURIComponent('aux:F552100554')}`]) {
      await page.goto(`${onglet}?vue=${vue}`);
      await expect(page.getByTestId('entete-tiers')).toBeVisible();
      const d = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
      expect(d.contenu, `débordement sur la vue ${vue}`).toBeLessThanOrEqual(d.fenetre + 1);
    }
  });
});

test.describe('tiers et factures — déposant', () => {
  test.use({ storageState: etatDe('client') });

  test('le déposant n’a pas accès aux tiers ni aux factures suivies', async ({ page }) => {
    await page.goto('/');
    expect(await statutBff(page, 'GET', `v1/exercices/${ID.exDupain}/tiers`)).toBe(404);
    expect(await statutBff(page, 'GET', `v1/exercices/${ID.exDupain}/factures`)).toBe(404);
    expect(await statutBff(page, 'PUT', `v1/exercices/${ID.exDupain}/suspicions`, { cle: 'E:x', decision: 'confirme' })).toBe(404);
  });
});
