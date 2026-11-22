import { expect, test } from '@playwright/test';
import { ID, etatDe, simulateur, surveiller } from '../outils';

const inventaire = `/dossiers/${ID.dupain}/inventaire`;

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

/** Écritures fictives posées dans le simulateur : le VRAI moteur d'inventaire les rapproche du fichier saisi. */
const BALANCE = [
  { compteNum: '218300', compteLib: 'Matériel informatique', ecritureDate: '2025-07-01', debit: '12000.00' },
  { compteNum: '215400', compteLib: 'Matériel industriel', ecritureDate: '2025-11-15', debit: '10000.00' },
  { compteNum: '218400', compteLib: 'Mobilier', ecritureDate: '2025-03-01', debit: '2500.00' },
];
/** Dotation déjà comptabilisée par le cabinet sur l'exercice, au compte 68112. */
const dotationPassee = (montant: string) => [
  { compteNum: '681120', compteLib: 'Dotations amortissements corporels', ecritureDate: '2025-12-31', debit: montant },
  { compteNum: '281830', compteLib: 'Amortissements', ecritureDate: '2025-12-31', credit: montant },
];

test.describe('amortissements — saisie, dégressif, rapprochement', () => {
  test.use({ storageState: etatDe('chloe') });

  test('dégressif NON ACTIVÉ par défaut : l’écran le dit, la déclaration est enregistrée, aucun calcul ni proposition n’en découle, le linéaire continue', async ({ page }) => {
    const erreurs = surveiller(page);
    await simulateur('amortissements', { lignes: BALANCE }); // degressifActive absent : faux, comme l'API par défaut
    await page.goto(inventaire);
    const etat = page.getByTestId('etat-degressif');
    await expect(etat).toHaveAttribute('data-degressif-active', 'non');
    await expect(etat).toContainText('Amortissement dégressif : non activé');
    await expect(etat).toContainText('Calcul du dégressif non activé : le texte de loi (CGI art. 39 A) n’a pas été vérifié sur une source officielle');
    await expect(etat).toContainText('L’activation relève de l’éditeur');
    await page.getByText('Saisir une immobilisation').click();
    const f = page.locator('form[data-formulaire="saisir-immobilisation"]');
    await f.getByLabel('Mode d’amortissement (plan comptable)').selectOption('degressif');
    await expect(f.getByRole('option', { name: /calcul non activé/ })).toHaveCount(1);
    await expect(f.getByTestId('avertissement-degressif')).toContainText('aucun calcul ni aucune proposition d’écriture n’en découle');
    await expect(f.getByTestId('avertissement-degressif')).toContainText('CGI art. 39 A');
    await expect(f.getByTestId('explication-mode')).toContainText('premier jour du mois d’acquisition');
    await expect(f.getByTestId('explication-mode')).toContainText('faculté de l’entreprise');
    await expect(f.getByTestId('explication-mode')).toContainText('coefficients majorés ou diminués de certains biens d’équipement ne sont pas pris en charge');
    // La date d'acquisition est obligatoire en dégressif.
    await expect(f.getByLabel('Date d’acquisition ou de construction')).toHaveAttribute('required', '');
    await f.getByLabel('Désignation').fill('Machine-outil');
    await f.getByLabel('Compte d’immobilisation (classe 2)').fill('215400');
    await f.getByLabel('Valeur brute à amortir (€)').fill('10000,00');
    await f.getByLabel('Date d’acquisition ou de construction').fill('2025-11-05');
    await f.getByLabel('Date de mise en service').fill('2025-11-15');
    await f.getByLabel('Durée d’amortissement (mois)').fill('120');
    await f.getByLabel('Coefficient dégressif déclaré').selectOption('2.25');
    await f.getByLabel('Je confirme que le bien remplit les conditions du dégressif').check();
    await f.getByTestId('justification-degressif').fill('Matériel neuf, durée normale de 10 ans, bien visé selon le cabinet (fiche fictive).');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/immobilisations'));
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    expect((await envoi).postDataJSON()).toMatchObject({ modeAmortissement: 'degressif', dateAcquisition: '2025-11-05', dateMiseEnService: '2025-11-15' });
    await expect(page.locator('[data-immobilisation]')).toHaveCount(1);
    // Aucune proposition dégressive, aucun point dérogatoire ; l'abstention est motivée.
    await expect(page.locator('[data-proposition^="INV-AMORT-DEG|"]')).toHaveCount(0);
    await expect(page.locator('[data-signalement="amortissement_derogatoire"]')).toHaveCount(0);
    await expect(page.getByTestId('etat-degressif')).toContainText('non activé');
    await page.getByText(/Le moteur s’est abstenu/).click();
    await expect(page.getByText(/Calcul du dégressif non activé : le texte de loi/).first()).toBeVisible();
    // Le linéaire n'est pas concerné.
    await f.getByLabel('Mode d’amortissement (plan comptable)').selectOption('lineaire');
    await f.getByLabel('Désignation').fill('Serveur de fichiers');
    await f.getByLabel('Compte d’immobilisation (classe 2)').fill('218300');
    await f.getByLabel('Valeur brute à amortir (€)').fill('12000');
    await f.getByLabel('Date de mise en service').fill('2025-07-01');
    await f.getByLabel('Durée d’amortissement (mois)').fill('60');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    await expect(page.locator('[data-proposition^="INV-AMORT|"]')).toHaveCount(1);
    await expect(page.locator('[data-proposition^="INV-AMORT-DEG|"]')).toHaveCount(0);
    expect(erreurs).toEqual([]);
  });

  test('le dégressif se déclare explicitement ; la proposition porte son plan année par année, ses sources et le point dérogatoire ; une dotation déjà comptabilisée n’est pas reproposée', async ({ page }) => {
    const erreurs = surveiller(page);
    // Ici le calcul du dégressif est ACTIVÉ explicitement dans le simulateur (il est désactivé par défaut) pour exercer l'affichage du plan.
    await simulateur('amortissements', { lignes: BALANCE, degressifActive: true });
    await page.goto(inventaire);
    await expect(page.getByTestId('etat-degressif')).toHaveAttribute('data-degressif-active', 'oui');
    await page.getByText('Saisir une immobilisation').click();
    const f = page.locator('form[data-formulaire="saisir-immobilisation"]');

    // Linéaire par défaut : l'explication dit ce que le mode suppose et qui en répond.
    await expect(f.getByTestId('explication-mode')).toContainText('Vous répondez de la durée retenue');
    await expect(f.getByTestId('champs-degressif')).toHaveCount(0);

    // Dégressif : explication, coefficient à déclarer, éligibilité à confirmer par le cabinet, point dérogatoire annoncé.
    await f.getByLabel('Mode d’amortissement (plan comptable)').selectOption('degressif');
    await expect(f.getByTestId('explication-mode')).toContainText('Comtaple ne devine ni le mode, ni l’éligibilité, ni le coefficient');
    await expect(f.getByTestId('explication-mode')).toContainText('amortissement dérogatoire (comptes 145, 6872, 7872)');
    await expect(f.getByTestId('explication-mode')).toContainText('ne sont pas validées par un professionnel');
    await f.getByLabel('Désignation').fill('Machine-outil');
    await f.getByLabel('Compte d’immobilisation (classe 2)').fill('215400');
    await f.getByLabel('Valeur brute à amortir (€)').fill('10 000,00');
    await f.getByLabel('Date d’acquisition ou de construction').fill('2025-11-05');
    await f.getByLabel('Date de mise en service').fill('2025-11-15');
    await f.getByLabel('Durée d’amortissement (mois)').fill('120');
    await expect(f.getByTestId('coefficient-attendu')).toContainText('le coefficient cohérent est 2,25');
    await expect(f.getByLabel('Je confirme que le bien remplit les conditions du dégressif')).not.toBeChecked();

    // Coefficient incohérent avec la durée : refusé par le serveur, rien n'est enregistré.
    await f.getByLabel('Coefficient dégressif déclaré').selectOption('1.75');
    await f.getByLabel('Je confirme que le bien remplit les conditions du dégressif').check();
    await f.getByTestId('justification-degressif').fill('Matériel neuf, durée normale de 10 ans, bien visé selon le cabinet (fiche fictive).');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    await expect(f.getByRole('alert')).toContainText('Coefficient incohérent avec la durée de 10 ans');
    await expect(page.locator('[data-immobilisation]')).toHaveCount(0);

    const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/immobilisations'));
    await f.getByLabel('Coefficient dégressif déclaré').selectOption('2.25');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    expect((await envoi).postDataJSON()).toMatchObject({ modeAmortissement: 'degressif', dateAcquisition: '2025-11-05', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true, baseAmortissable: '10000.00', dureeMois: 120 });
    const ligne = page.locator('[data-immobilisation]');
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText('Dégressif (coefficient 2,25, éligibilité confirmée)');

    // Proposition : dotation de 375,00 (10 000 × 22,5 % × 2 ÷ 12), plan de 10 exercices, dernière valeur nette nulle.
    const proposition = page.locator('[data-proposition^="INV-AMORT-DEG|"]');
    await expect(proposition).toContainText('Dotation aux amortissements (dégressif)');
    await expect(proposition).toContainText('règle INV-AMORT-DEG v1.1.0');
    const plan = proposition.getByTestId('plan-amortissement');
    await expect(plan.locator('tbody tr')).toHaveCount(10);
    await expect(plan.locator('tr[data-courant="oui"]')).toHaveCount(1);
    await expect(plan.locator('tr[data-rang="1"]')).toContainText('(proposée)');
    await expect(plan.locator('tr[data-rang="1"] td').nth(2)).toContainText('375,00');
    await expect(plan.locator('tr[data-rang="7"]')).toContainText('Linéaire'); // bascule au linéaire
    await expect(plan.locator('tr[data-rang="10"] td').nth(4)).toContainText('0,00'); // valeur nette soldée
    await expect(plan).toContainText('au centime');
    await proposition.getByText('Sources de la règle').click();
    await expect(proposition.getByTestId('sources-proposition')).toContainText('BOFiP BOI-BIC-AMT-20-20-30');
    await expect(proposition.getByTestId('sources-proposition')).toContainText('En vigueur du 12/09/2012 à aujourd’hui');
    await expect(proposition.getByTestId('sources-proposition')).toContainText('BOI-BIC-AMT-20-20-20-10');
    await expect(proposition.getByTestId('sources-proposition')).toContainText('non vérifiée en ligne'); // CGI art. 39 A
    await expect(proposition.getByTestId('sources-proposition')).toContainText('Aucune règle n’est validée par un professionnel');

    // Point à traiter par le professionnel : amortissement dérogatoire, signalé sans écriture.
    const signalement = page.locator('[data-signalement="amortissement_derogatoire"]');
    await expect(signalement).toContainText('Machine-outil');
    await expect(signalement).toContainText('145');
    await expect(proposition.locator('tr', { hasText: /^145|6872|7872/ })).toHaveCount(0);

    // Linéaire sur le compte 218300 avec valeur résiduelle : dotation proposée seulement s'il n'y en a pas déjà une.
    await f.getByLabel('Mode d’amortissement (plan comptable)').selectOption('lineaire');
    await f.getByLabel('Désignation').fill('Serveur de fichiers');
    await f.getByLabel('Compte d’immobilisation (classe 2)').fill('218300');
    await f.getByLabel('Valeur brute à amortir (€)').fill('12000');
    await f.getByLabel('Valeur résiduelle (€, facultatif)').fill('2000');
    await f.getByLabel('Date de mise en service').fill('2025-07-01');
    await f.getByLabel('Durée d’amortissement (mois)').fill('60');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    await expect(page.locator('[data-immobilisation]')).toHaveCount(2);
    const lineaire = page.locator('[data-proposition^="INV-AMORT|"]');
    await expect(lineaire).toHaveCount(1);
    await expect(lineaire).toContainText('Valeur résiduelle (déduite) : 2000.00');
    await expect(lineaire).toContainText('1000.00'); // (12 000 − 2 000) × 6 ÷ 60

    // Le cabinet a déjà passé la dotation (375,00 + 1 000,00) : rien n'est reproposé, l'identité est constatée.
    await simulateur('amortissements', { lignes: [...BALANCE, ...dotationPassee('1375.00')] });
    await page.reload();
    await expect(page.locator('[data-proposition]')).toHaveCount(0);
    const dotation = page.locator('[data-rapprochement-dotation="68112"]');
    await expect(dotation).toHaveAttribute('data-etat', 'identique');
    await expect(dotation).toContainText(/Calculée par le moteur : 1\s375,00/);
    await page.getByText(/Le moteur s’est abstenu/).click();
    await expect(page.getByText(/déjà comptabilisée sur l’exercice au compte 68112/).first()).toBeVisible();

    // Dotation passée différente : l'écart est affiché, jamais corrigé, et rien n'est reproposé en doublon.
    await simulateur('amortissements', { lignes: [...BALANCE, ...dotationPassee('1000.00')] });
    await page.reload();
    await expect(page.locator('[data-proposition]')).toHaveCount(0);
    await expect(dotation).toHaveAttribute('data-etat', 'differente');
    await expect(dotation).toContainText(/écart \(comptabilisé − calculé\) : −375,00/);

    // Rapprochement avec la balance : compte 2184 de la balance sans immobilisation saisie.
    await expect(page.locator('[data-compte-a-saisir="218400"]')).toContainText('2 500,00');
    await expect(page.locator('[data-rapprochement-compte="2183"]')).toContainText('Solde du compte 2183');

    // Aucun débordement horizontal de la page, ni sur ordinateur ni à 360 px (les tableaux défilent dans leur propre cadre).
    for (const largeur of [1280, 360]) {
      await page.setViewportSize({ width: largeur, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `débordement à ${largeur} px`).toBe(true);
    }
    expect(erreurs).toEqual([]);
  });

  test('sortie d’actif, composants et écart avec la comptabilité : abstention ou écart dits, rien n’est corrigé', async ({ page }) => {
    await simulateur('amortissements', { lignes: BALANCE });
    await page.goto(inventaire);
    await page.getByText('Saisir une immobilisation').click();
    const f = page.locator('form[data-formulaire="saisir-immobilisation"]');
    const saisir = async (libelle: string, compte: string, brut: string, mes: string, duree: string, extra?: (g: typeof f) => Promise<unknown>) => {
      await f.getByLabel('Désignation').fill(libelle);
      await f.getByLabel('Compte d’immobilisation (classe 2)').fill(compte);
      await f.getByLabel('Valeur brute à amortir (€)').fill(brut);
      await f.getByLabel('Date de mise en service').fill(mes);
      await f.getByLabel('Durée d’amortissement (mois)').fill(duree);
      if (extra) await extra(f);
      await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    };
    // Cession en cours d'exercice : le moteur le dit, il n'ignore pas l'immobilisation.
    await saisir('Camion cédé', '218200', '20000', '2022-03-01', '60', async (g) => g.getByLabel('Date de sortie de l’actif (facultatif)').fill('2025-09-30'));
    await expect(page.locator('[data-immobilisation]')).toHaveCount(1);
    await page.getByText(/Le moteur s’est abstenu/).click();
    await expect(page.getByText(/sortie de l’actif saisie au 2025-09-30/)).toBeVisible();
    await expect(page.getByText(/plus ou moins-value de cession/)).toBeVisible();
    // Structure puis composant : le composant se rattache à la structure ; chacun a son plan.
    await saisir('Entrepôt — structure', '213500', '150000', '2025-01-01', '480');
    await expect(page.locator('[data-immobilisation]')).toHaveCount(2);
    await saisir('Entrepôt — toiture', '213500', '30000', '2025-01-01', '240', async (g) => g.getByLabel('Composant de (facultatif)').selectOption({ label: 'Entrepôt — structure' }));
    await expect(page.locator('[data-immobilisation]')).toHaveCount(3);
    await expect(page.locator('[data-immobilisation]', { hasText: 'Entrepôt — toiture' })).toContainText('Entrepôt — structure');
    await expect(page.locator('[data-proposition^="INV-AMORT|"]')).toHaveCount(2);
    // Écart avec la comptabilité : une dotation de 1 000,00 passée sur 68112 ne ressemble pas à la somme des dotations calculées (3 750,00 + 1 500,00, le camion cédé étant écarté).
    await simulateur('amortissements', { lignes: [...BALANCE, ...dotationPassee('1000.00')] });
    await page.reload();
    const dotation = page.locator('[data-rapprochement-dotation="68112"]');
    await expect(dotation).toHaveAttribute('data-etat', 'differente');
    await expect(dotation).toContainText(/écart \(comptabilisé − calculé\) : −4\s250,00/);
    await expect(page.locator('[data-proposition]')).toHaveCount(0);
    // La structure ne se retire pas tant qu'un composant en dépend.
    await page.getByRole('button', { name: 'Retirer du fichier : Entrepôt — structure' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'structure d’au moins un composant' })).toBeVisible();
    await expect(page.locator('[data-immobilisation]')).toHaveCount(3);
  });
});

test.describe('amortissements — droits', () => {
  test.use({ storageState: etatDe('client') });
  test('le déposant ne voit pas le fichier ni ne le modifie', async ({ page }) => {
    await page.goto(inventaire);
    await expect(page.getByTestId('erreur-403')).toBeVisible();
  });
});
