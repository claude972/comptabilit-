import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, sha256, simulateur, statutBff, surveiller } from '../outils';

const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';
const CHLOE = '11111111-1111-4111-8111-111111111103';

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('restitution, indicateurs et membres — administratrice', () => {
  test.use({ storageState: etatDe('alice'), acceptDownloads: true });

  test('restitution : demande, suivi jusqu’à « terminé », archive téléchargée dont l’empreinte est celle affichée, résumé', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Restitution' }).click();
    await expect(page.getByText('Aucun export de restitution demandé pour ce dossier.')).toBeVisible();
    await page.getByRole('button', { name: 'Demander un export de restitution' }).click();
    const export_ = page.locator('[data-restitution]');
    await expect(export_).toHaveCount(1);
    // Suivi automatique jusqu'à la fin de la préparation (sans rechargement manuel).
    await expect(export_).toHaveAttribute('data-statut', 'termine', { timeout: 20_000 });
    await expect(export_.getByTestId('statut-restitution')).toHaveText('Terminé');
    const empreinte = (await export_.getByTestId('empreinte').innerText()).trim();
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
    await expect(export_.getByTestId('resume-pieces')).toHaveText('4');
    await expect(export_.getByTestId('resume-originaux')).toHaveText('3');
    await expect(export_.getByTestId('resume-exclus')).toContainText('écarté par l’antivirus');
    await expect(export_.getByTestId('resume-lignes')).toHaveText('3');
    const telechargement = page.waitForEvent('download');
    await export_.getByTestId('telecharger-archive').click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toMatch(/^restitution-[0-9a-f-]{36}\.zip$/);
    expect(sha256(readFileSync(await fichier.path()))).toBe(empreinte);
    expect((await etatSuite()).restitutions[0]).toMatchObject({ statut: 'termine', sha256: empreinte });
    // Fiche d'administration : lien vers la restitution quand l'habilitation de validation est là.
    await page.goto(`/administration/dossiers/${ID.dupain}`);
    await expect(page.getByRole('link', { name: 'Demander ou télécharger un export de restitution' })).toBeVisible();
    await page.goto(`/administration/dossiers/${ID.martin}`);
    await expect(page.getByTestId('restitution-impossible')).toContainText('le rôle d’administrateur du cabinet ne suffit pas');
    expect(erreurs).toEqual([]);
  });

  test('restitution réservée au niveau validation : pas d’onglet pour le réviseur, écran et API refusés', async ({ browser }) => {
    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto(`http://localhost:3000/dossiers/${ID.dupain}`);
    await expect(remi.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Restitution' })).toHaveCount(0);
    await remi.goto(`http://localhost:3000/dossiers/${ID.dupain}/restitution`);
    await expect(remi.getByTestId('erreur-403')).toContainText('réservée à l’habilitation « Validation »');
    expect(await statutBff(remi, 'POST', `v1/dossiers/${ID.dupain}/restitutions`)).toBe(403);
    expect(await statutBff(remi, 'GET', `v1/dossiers/${ID.dupain}/restitutions`)).toBe(403);
    await remi.context().close();
  });

  test('indicateurs du cabinet : période, blocs, mentions ; refusés au réviseur', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto('/administration');
    await page.getByRole('link', { name: 'Indicateurs du cabinet' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Indicateurs du cabinet');
    const mentions = page.getByTestId('mentions-indicateurs');
    await expect(mentions).toContainText('Aucun indicateur par personne.');
    await expect(mentions).toContainText('Ces chiffres mesurent l’activité enregistrée, pas la qualité des extractions.');
    await expect(page.getByTestId('periode')).toContainText(/Période : du 01\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}/); // par défaut : le mois en cours
    await expect(page.getByTestId('pieces-recues')).toHaveText('4');
    await expect(page.getByTestId('pieces-par-statut').locator('[data-cle="a_controler"]')).toContainText('À contrôler');
    await expect(page.getByTestId('receptions-par-canal').locator('[data-cle="telephone"]')).toHaveText('Téléphone3');
    await expect(page.getByTestId('delai-traitement')).toContainText('0,25 h');
    await expect(page.getByTestId('delai-traitement')).toContainText('Approximation');
    // Devenir des extractions automatiques : quatre catégories, dans l'ordre.
    await expect(page.getByTestId('bloc-extractions').locator('[data-devenir] dt')).toHaveText(['Acceptées sans correction', 'Corrigées puis validées', 'Rejetées', 'Non examinées']);
    await expect(page.getByTestId('bloc-extractions').locator('[data-devenir="nonExaminees"] dd')).toHaveText('1');
    await expect(page.getByTestId('bloc-extractions').locator('[data-devenir="corrigeesPuisValidees"] dd')).toHaveText('1');
    await expect(page.getByTestId('imports-par-type').locator('[data-cle="fec:termine"]')).toContainText('Écritures comptables — Terminé');
    await expect(page.getByTestId('constats-par-statut')).toContainText('À examiner');
    await expect(page.getByTestId('controles-par-statut')).toContainText('Non réalisé faute de données');
    await expect(page.getByTestId('bloc-rapprochements')).toContainText('Aucune donnée.');
    await expect(page.getByTestId('bloc-temps')).toContainText('Aucun temps observé saisi sur la période.');
    // Tableau par dossier : y compris un dossier où l'administratrice n'est pas habilitée (décomptes seulement).
    await expect(page.locator(`tr[data-dossier="${ID.martin}"]`)).toContainText('Garage Martin SARL (fictif)');
    await expect(page.locator(`tr[data-dossier="${ID.dupain}"] td`).first()).toHaveText('4');
    await expect(page.locator(`tr[data-dossier="${ID.leroy}"]`)).toHaveCount(0); // autre cabinet
    // Aucun nom de personne sur l'écran des indicateurs.
    for (const nom of ['Rémi', 'Chloé', 'Camille']) await expect(page.getByRole('main')).not.toContainText(nom);
    // Période choisie, puis période incohérente : message de l'API, pas d'écran cassé.
    await page.getByLabel('Du', { exact: true }).fill('2020-01-01');
    await page.getByLabel('Au', { exact: true }).fill('2026-12-31');
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page.getByTestId('periode')).toContainText('du 01/01/2020 au 31/12/2026');
    await page.goto('/administration/indicateurs?du=2026-12-31&au=2020-01-01');
    await expect(page.getByTestId('periode-invalide')).toContainText('Période invalide');

    const remi = await (await browser.newContext({ storageState: etatDe('remi') })).newPage();
    await remi.goto('http://localhost:3000/administration/indicateurs');
    await expect(remi.getByTestId('erreur-403')).toContainText('réservés aux administrateurs et associés');
    expect(await statutBff(remi, 'GET', 'v1/cabinet/indicateurs')).toBe(403);
    await remi.context().close();
    expect(erreurs).toEqual([]);
  });

  test('membres : changement de rôle et désactivation avec confirmation ; garde-fous de l’API affichés', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto('/administration');
    await expect(page.getByTestId('garde-fous-membres')).toContainText('le cabinet conserve toujours au moins un administrateur actif');
    const ligne = (id: string) => page.locator(`tr[data-membre="${id}"]`);
    // Sa propre appartenance : aucune commande, et l'API refuse.
    await expect(ligne(ALICE).getByTestId('membre-soi-meme')).toContainText('Vous ne pouvez pas modifier votre propre appartenance');
    await expect(ligne(ALICE).getByRole('button')).toHaveCount(0);
    expect(await statutBff(page, 'PATCH', `v1/cabinet/membres/${ALICE}`, { actif: false })).toBe(403);

    // Changement de rôle : confirmation obligatoire, annulable ; les habilitations au-dessus du plafond sont retirées et c'est dit.
    await expect(ligne(REMI).getByRole('button', { name: 'Changer le rôle de Rémi Réviseur' })).toBeDisabled(); // rôle inchangé
    await ligne(REMI).getByLabel('Rôle de Rémi Réviseur', { exact: true }).selectOption('collaborateur');
    await ligne(REMI).getByRole('button', { name: 'Changer le rôle de Rémi Réviseur' }).click();
    const confirmation = ligne(REMI).getByTestId('confirmation-membre');
    await expect(confirmation).toContainText('« Réviseur » → « Collaborateur »');
    await expect(confirmation).toContainText('seront retirées (et non rabaissées)');
    await confirmation.getByRole('button', { name: 'Annuler' }).click();
    expect((await etatSuite()).membres).toEqual([]); // rien n'est parti sans confirmation
    await ligne(REMI).getByRole('button', { name: 'Changer le rôle de Rémi Réviseur' }).click();
    await ligne(REMI).getByRole('button', { name: 'Confirmer le changement de rôle' }).click();
    await expect(ligne(REMI).getByTestId('resultat-membre')).toContainText('Rôle modifié : Collaborateur. 2 habilitation(s) de dossier au-dessus du plafond du nouveau rôle ont été retirées');
    await expect(ligne(REMI).locator('td').nth(1)).toHaveText('Collaborateur');
    expect((await etatSuite()).habilitations.filter((h) => h.utilisateurId === REMI)).toEqual([]);

    // Désactivation : accès fermés immédiatement, y compris pour une session ouverte ; réactivation.
    const chloe = await (await browser.newContext({ storageState: etatDe('chloe') })).newPage();
    await chloe.goto('http://localhost:3000/dossiers');
    await expect(chloe.getByRole('heading', { name: 'Dossiers' })).toBeVisible();
    await ligne(CHLOE).getByRole('button', { name: 'Désactiver Chloé Collab' }).click();
    await expect(ligne(CHLOE).getByTestId('confirmation-membre')).toContainText('tous ses accès au cabinet seront fermés immédiatement');
    await ligne(CHLOE).getByRole('button', { name: 'Confirmer la désactivation' }).click();
    await expect(ligne(CHLOE).getByTestId('resultat-membre')).toContainText('Membre désactivé');
    await expect(ligne(CHLOE).locator('td').nth(2)).toContainText('Inactif');
    await chloe.reload();
    await expect(chloe.getByRole('main')).toContainText('Aucun cabinet actif pour ce compte');
    await ligne(CHLOE).getByRole('button', { name: 'Réactiver Chloé Collab' }).click();
    await ligne(CHLOE).getByRole('button', { name: 'Confirmer la réactivation' }).click();
    await expect(ligne(CHLOE).locator('td').nth(2)).toContainText('Actif');
    await chloe.reload();
    await expect(chloe.getByRole('heading', { name: 'Dossiers' })).toBeVisible();

    // Dernier administrateur actif : une associée ne peut pas désactiver l'unique administratrice ; le refus de l'API est affiché.
    await ligne(CHLOE).getByLabel('Rôle de Chloé Collab', { exact: true }).selectOption('associe');
    await ligne(CHLOE).getByRole('button', { name: 'Changer le rôle de Chloé Collab' }).click();
    await ligne(CHLOE).getByRole('button', { name: 'Confirmer le changement de rôle' }).click();
    await expect(ligne(CHLOE).getByTestId('resultat-membre')).toContainText('Rôle modifié : Associé. Aucune habilitation de dossier n’a été retirée.');
    await chloe.goto('http://localhost:3000/administration');
    const alice = chloe.locator(`tr[data-membre="${ALICE}"]`);
    await alice.getByRole('button', { name: 'Désactiver Alice Admin' }).click();
    await alice.getByRole('button', { name: 'Confirmer la désactivation' }).click();
    await expect(alice.getByTestId('refus-membre')).toContainText('Le cabinet doit conserver au moins un administrateur actif');
    await expect(alice.locator('td').nth(2)).toContainText('Actif');
    await chloe.context().close();
    expect(erreurs).toEqual([]);
  });
});
