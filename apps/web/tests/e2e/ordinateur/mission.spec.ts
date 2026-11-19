import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, simulateur, statutBff, surveiller } from '../outils';

const mission = `/dossiers/${ID.dupain}/mission`;
const conseils = `${mission}/conseils`;

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

async function enregistrerTravail(page: Page, date: string, prestation: string, description: string, minutes?: string) {
  const f = page.locator('form[data-formulaire="enregistrer-travail"]');
  await f.getByLabel('Date du travail').fill(date);
  await f.getByLabel('Prestation').selectOption(prestation);
  await f.getByLabel('Description').fill(description);
  await f.getByLabel('Temps OBSERVÉ, en minutes (facultatif)').fill(minutes ?? '');
  await f.getByRole('button', { name: 'Enregistrer le travail' }).click();
  await expect(page.locator('tr[data-travail]').filter({ hasText: description })).toBeVisible();
}

test.describe('missions, lettres, travaux', () => {
  test.use({ storageState: etatDe('chloe') });

  test('lettre en projet puis validée par une personne habilitée ; rattachement en trois états ; projet d’avenant avec ou sans base d’estimation ; barème', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto(`/dossiers/${ID.dupain}`);
    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Mission' }).click();
    await expect(page.getByText('Aucune mission enregistrée sur ce dossier.')).toBeVisible();
    await page.locator('form[data-formulaire="creer-mission"]').getByLabel('Libellé de la mission').fill('Mission comptable 2025');
    await page.getByRole('button', { name: 'Créer la mission' }).click();
    const carte = page.locator('[data-mission]');
    await expect(carte).toContainText('Mission comptable 2025');

    // Lettre : formulaire structuré, périmètre choisi dans le référentiel des prestations.
    await carte.getByRole('button', { name: 'Rédiger une lettre ou un avenant' }).click();
    const f = carte.locator('form[data-formulaire="rediger-lettre"]');
    await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
    await expect(f.getByRole('alert')).toContainText('Le périmètre comporte au moins une prestation.');
    await f.getByLabel('Date d’effet').fill('2025-01-01');
    await f.getByRole('checkbox', { name: 'Tenue de comptabilité' }).check();
    await f.getByRole('checkbox', { name: 'Établissement des comptes annuels' }).check();
    await f.getByLabel('Début de la mission').fill('2025-01-01');
    await f.getByRole('checkbox', { name: 'Tacite reconduction' }).check();
    await f.getByLabel('Honoraires annuels HT (vide : non renseignés)').fill('3 600,00');
    await f.getByLabel('Conditions de révision des honoraires').fill('Révision annuelle selon l’indice convenu');
    await f.getByLabel('Obligations du client').fill('Transmission des pièces chaque mois');
    await f.getByLabel('Livrables (un par ligne)').fill('Comptes annuels\nLiasse fiscale');
    await f.getByLabel('Limites de la mission').fill('Hors missions sociales et juridiques');
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && /\/missions\/[0-9a-f-]+\/lettres$/.test(r.url()));
    await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
    expect((await envoi).postDataJSON()).toEqual({
      dateEffet: '2025-01-01',
      contenu: {
        perimetre: [{ prestation: 'tenue' }, { prestation: 'comptes_annuels' }],
        duree: { debut: '2025-01-01', fin: null, taciteReconduction: true },
        honoraires: { mode: 'forfait', montantAnnuelHt: '3600.00', tauxHoraireHt: null, conditionsRevision: 'Révision annuelle selon l’indice convenu' },
        obligationsCabinet: '', obligationsClient: 'Transmission des pièces chaque mois', livrables: ['Comptes annuels', 'Liasse fiscale'], mandats: [], limites: 'Hors missions sociales et juridiques',
      },
    });
    const lettre = carte.locator('[data-lettre]');
    await expect(lettre).toHaveAttribute('data-statut', 'projet');
    await expect(lettre).toContainText('Projet — non validé');
    await expect(lettre.getByTestId('perimetre').getByRole('listitem')).toHaveText(['Tenue de comptabilité', 'Établissement des comptes annuels']);
    await expect(lettre.getByTestId('contenu-lettre')).toContainText('annuels HT : 3 600,00');
    await expect(lettre.getByTestId('contenu-lettre')).toContainText('taux horaire HT : non renseigné');
    await expect(lettre).toContainText('La validation est réservée au niveau « Validation » sur ce dossier.');
    const lettreId = (await etatSuite()).lettres[0]!.id;
    expect(await statutBff(page, 'POST', `v1/lettres/${lettreId}/validation`)).toBe(403);

    // Tant que la lettre est un projet, aucun travail ne s'y rattache.
    await enregistrerTravail(page, '2025-02-10', 'tenue', 'Saisie de février', '120');
    const travail = (description: string) => page.locator('tr[data-travail]').filter({ hasText: description });
    await expect(travail('Saisie de février').getByTestId('rattachement')).toHaveText('Aucune lettre applicable à cette date');
    await expect(travail('Saisie de février')).toContainText('2 h');

    // Validation par l'administratrice (niveau validation), avec confirmation.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto(`http://localhost:3000${mission}`);
    await alice.locator(`[data-lettre="${lettreId}"]`).getByRole('button', { name: 'Valider' }).click();
    await expect(alice.locator(`[data-lettre="${lettreId}"]`)).toContainText('une lettre validée ne se modifie plus');
    await alice.locator(`[data-lettre="${lettreId}"]`).getByRole('button', { name: 'Confirmer la validation' }).click();
    await expect(alice.locator(`[data-lettre="${lettreId}"]`)).toHaveAttribute('data-statut', 'validee');

    await page.reload();
    await expect(travail('Saisie de février').getByTestId('rattachement')).toHaveText('Dans le périmètre');
    await enregistrerTravail(page, '2025-03-05', 'fiscal_tva', 'Déclaration de TVA de février');
    const tva = travail('Déclaration de TVA de février');
    await expect(tva.getByTestId('rattachement')).toHaveText('Potentiellement hors périmètre — à examiner');
    await expect(tva).toContainText('ne figure pas dans le périmètre de la lettre applicable');
    await expect(tva).toContainText('Non saisi'); // temps non observé : jamais un zéro
    // Sans barème ni temps observés suffisants : abstention dite telle quelle.
    await tva.getByRole('button', { name: 'Préparer un projet d’avenant' }).click();
    await expect(tva.getByTestId('estimation')).toHaveText('Estimation impossible : aucune base');
    await expect(tva.getByTestId('projet-avenant')).toContainText('non validé');
    expect((await etatSuite()).lettres.find((l) => l.origine === 'proposition_avenant')).toMatchObject({ statut: 'projet', avenantDe: lettreId, version: 2 });
    await page.reload();
    await expect(tva.getByTestId('avenant-existant')).toContainText('Un projet d’avenant (version 2) a déjà été préparé');
    await expect(tva.getByTestId('rattachement')).toHaveText('Potentiellement hors périmètre — à examiner'); // un projet ne change rien
    await expect(page.locator('[data-lettre][data-statut="projet"]')).toContainText('Préparé par le logiciel à partir d’un travail');

    // Barème : réservé aux gestionnaires ; il devient la base nommée de l'estimation.
    await expect(page.locator('tr[data-bareme="fiscal_tva"]')).toContainText('Non défini');
    await expect(page.getByRole('button', { name: /Enregistrer le barème/ })).toHaveCount(0);
    expect(await statutBff(page, 'PUT', 'v1/cabinet/baremes/fiscal_tva', { minutesReference: 60 })).toBe(403);
    await alice.reload();
    const bareme = alice.locator('tr[data-bareme="fiscal_tva"]');
    await bareme.getByLabel('Temps de référence en minutes pour « Déclarations de TVA »').fill('60');
    await bareme.getByRole('button', { name: 'Enregistrer le barème de « Déclarations de TVA »' }).click();
    await expect(bareme.locator('td').first()).toHaveText('1 h');
    await alice.context().close();
    await enregistrerTravail(page, '2025-04-07', 'fiscal_tva', 'Déclaration de TVA de mars', '45');
    const tvaMars = travail('Déclaration de TVA de mars');
    await tvaMars.getByRole('button', { name: 'Préparer un projet d’avenant' }).click();
    await expect(tvaMars.getByTestId('estimation')).toHaveText('Temps estimé : 1 h — base : barème du cabinet');
    await expect(tvaMars.getByTestId('estimation')).toHaveAttribute('data-base', 'bareme_cabinet');
    expect(erreurs).toEqual([]);
  });

  test('registre des conseils : projet, validation puis autorisation d’envoi (deux étapes), faits consignés avec justificatif, « Non établi », nouvelle version', async ({ page, browser }) => {
    const erreurs = surveiller(page);
    await page.goto(mission);
    await page.getByRole('navigation', { name: 'Pages de l’onglet Mission' }).getByRole('link', { name: 'Registre des conseils' }).click();
    await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Mission' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('mention-registre')).toContainText('Le logiciel n’envoie rien : il trace.');
    await expect(page.getByTestId('mention-registre')).toContainText('deux étapes distinctes');

    await page.getByRole('button', { name: 'Rédiger un conseil' }).click();
    const f = page.locator('form[data-formulaire="rediger-conseil"]');
    await f.getByLabel('Date du conseil').fill('2025-05-12');
    await f.getByLabel('Objet').fill('Option pour le régime réel de TVA');
    await f.getByLabel('Destinataire').fill('Gérant de la société');
    await f.getByLabel('Contenu').fill('Projet de note <img src=x onerror=alert(1)> sur les conséquences de l’option.');
    await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
    const fiche = page.locator('[data-conseil]');
    await expect(fiche).toHaveAttribute('data-statut', 'projet');
    await expect(fiche.getByTestId('contenu-conseil')).toHaveText('Projet de note <img src=x onerror=alert(1)> sur les conséquences de l’option.'); // texte brut
    const ligne = page.locator('tr[data-ligne-conseil]');
    await expect(ligne).toContainText('rédigé par Chloé Collab');
    // Quatre colonnes de faits : l'absence se lit « Non établi », jamais « Non ».
    await expect(page.getByRole('columnheader')).toHaveText(['Date', 'Objet', 'Destinataire', 'Statut', 'Envoi', 'Remise', 'Réception', 'Lecture']);
    await expect(ligne.locator('td[data-fait]')).toHaveText(['Non établi', 'Non établi', 'Non établi', 'Non établi']);
    const id = (await etatSuite()).conseils[0]!.id;

    // Modification tant que projet.
    await fiche.getByRole('button', { name: 'Modifier ce projet' }).click();
    await fiche.getByLabel('Contenu').fill('Note relue.');
    await fiche.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(fiche.getByTestId('contenu-conseil')).toHaveText('Note relue.');
    // Ni validation ni consignation pour une collaboratrice sur un projet.
    await expect(fiche).toContainText('La validation est réservée au niveau « Validation » sur ce dossier.');
    await expect(fiche.locator('form[data-formulaire="consigner-fait"]')).toHaveCount(0);
    const evenement = { type: 'envoi', dateEvenement: '2025-05-13T09:00:00+02:00', canal: 'courriel', justificatif: 'Message envoyé depuis la messagerie du cabinet' };
    expect(await statutBff(page, 'POST', `v1/conseils/${id}/evenements`, evenement)).toBe(409); // projet : pas d'envoi

    // Étape 1 : validation. Elle n'autorise pas encore l'envoi.
    const alice = await (await browser.newContext({ storageState: etatDe('alice') })).newPage();
    await alice.goto(`http://localhost:3000${conseils}`);
    const chezAlice = alice.locator(`[data-conseil="${id}"]`);
    expect(await statutBff(alice, 'POST', `v1/conseils/${id}/autorisation-envoi`)).toBe(409); // pas encore validé
    await chezAlice.getByRole('button', { name: 'Valider ce conseil' }).click();
    await expect(chezAlice).toContainText('Étape 1 sur 2');
    await chezAlice.getByRole('button', { name: 'Confirmer la validation' }).click();
    await expect(chezAlice).toHaveAttribute('data-statut', 'valide');
    await expect(chezAlice).toContainText('Validé — envoi non autorisé');
    await page.reload();
    await expect(fiche.getByRole('button', { name: 'Modifier ce projet' })).toHaveCount(0); // validé : immuable
    await expect(fiche.locator('form[data-formulaire="consigner-fait"]')).toHaveCount(0);
    expect(await statutBff(page, 'POST', `v1/conseils/${id}/evenements`, evenement)).toBe(409); // validé mais envoi non autorisé
    expect(await statutBff(page, 'POST', `v1/conseils/${id}/autorisation-envoi`)).toBe(403);
    // Étape 2 : autorisation d'envoi.
    await chezAlice.getByRole('button', { name: 'Autoriser l’envoi' }).click();
    await expect(chezAlice).toContainText('Étape 2 sur 2');
    await expect(chezAlice).toContainText('Comtaple n’envoie rien');
    await chezAlice.getByRole('button', { name: 'Confirmer l’autorisation d’envoi' }).click();
    await expect(chezAlice).toHaveAttribute('data-statut', 'envoi_autorise');
    await alice.context().close();

    // Consignation des faits : l'envoi d'abord, justificatif obligatoire.
    await page.reload();
    const fait = fiche.locator('form[data-formulaire="consigner-fait"]');
    await expect(fait.getByLabel('Fait constaté').locator('option')).toHaveText(['Envoi']);
    await fait.getByLabel('Date et heure').fill('2025-05-13T09:00');
    await fait.getByLabel('Canal').fill('courriel');
    await fait.getByRole('button', { name: 'Consigner ce fait' }).click();
    await expect(fait.getByRole('alert')).toContainText('Le justificatif est obligatoire');
    await fait.getByLabel('Justificatif (obligatoire : ce qui établit le fait)').fill('Message envoyé depuis la messagerie du cabinet');
    await fait.getByRole('button', { name: 'Consigner ce fait' }).click();
    await expect(ligne.locator('td[data-fait="envoi"]')).toHaveText(/^13\/05\/2025 09:00$/);
    await expect(ligne.locator('td[data-fait="envoi"]')).toHaveAttribute('data-etabli', 'true');
    // La réception n'est ni déduite ni supposée.
    await expect(ligne.locator('td[data-fait="reception"]')).toHaveText('Non établi');
    await expect(ligne.locator('td[data-fait="lecture"]')).toHaveText('Non établi');
    await expect(fiche.getByTestId('evenements')).toContainText('justificatif : Message envoyé depuis la messagerie du cabinet');
    await expect(fait.getByLabel('Fait constaté').locator('option')).toHaveText(['Remise', 'Réception', 'Lecture']);
    await fait.getByLabel('Fait constaté').selectOption('remise');
    await fait.getByLabel('Date et heure').fill('2025-05-13T09:01');
    await fait.getByLabel('Canal').fill('courriel');
    await fait.getByLabel('Justificatif (obligatoire : ce qui établit le fait)').fill('Accusé de remise du prestataire de messagerie');
    await fait.getByRole('button', { name: 'Consigner ce fait' }).click();
    await expect(ligne.locator('td[data-fait="remise"]')).toHaveAttribute('data-etabli', 'true');
    await expect(ligne.locator('td[data-fait="reception"]')).toHaveText('Non établi'); // remise ≠ réception
    expect((await etatSuite()).evenements.map((e) => e.type)).toEqual(['envoi', 'remise']);

    // Nouvelle version : l'ancienne reste au registre avec ses faits.
    await fiche.getByRole('button', { name: 'Créer une nouvelle version' }).click();
    await fiche.getByRole('button', { name: 'Créer le projet de nouvelle version' }).click();
    await expect(page.locator('tr[data-ligne-conseil]')).toHaveCount(2);
    expect((await etatSuite()).conseils.map((c) => [c.version, c.statut])).toEqual([[1, 'envoi_autorise'], [2, 'projet']]);
    await expect(page.locator(`tr[data-ligne-conseil="${id}"] td[data-fait="envoi"]`)).toHaveAttribute('data-etabli', 'true');
    expect(await page.getByRole('main').innerText()).not.toMatch(/(^|\s)Non(\s|$)(?!établi)/m);
    expect(erreurs).toEqual([]);
  });
});
