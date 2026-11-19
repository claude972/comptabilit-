/**
 * Règles du cabinet, écritures d'inventaire, missions et conseils, veille, recherche, restitution et indicateurs sur la
 * pile RÉELLE (web 3100, API, worker, Keycloak, base). Rejouable : chaque exécution crée un dossier NEUF par l'interface
 * d'administration et y importe un FEC SYNTHÉTIQUE (@comtaple/core) contenant un client créditeur.
 * Données partagées : aucun compte n'est désactivé, aucun rôle n'est changé, aucune habilitation existante n'est retirée ;
 * la règle approuvée ici est une exception propre au dossier d'essai, retirée en fin de parcours.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { genererFecSynthetique } from '@comtaple/core';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { ordinateur } from './profils';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}
async function ouvrir(browser: Browser, email: string, destination: string): Promise<Page> {
  const contexte = await browser.newContext({ ...ordinateur(browser), viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await contexte.newPage();
  await page.goto(destination);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  return page;
}
const statutBff = (page: Page, methode: string, chemin: string) =>
  page.evaluate(async ([m, c]) => (await fetch(`/api/bff/${c}`, { method: m, headers: m === 'GET' ? {} : { 'X-Comtaple-Csrf': '1' } })).status, [methode, chemin] as const);

const ALICE_MAIL = 'alice.admin@cabinet-a.test';
const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';
const CHLOE = '11111111-1111-4111-8111-111111111103';
const DUPAIN = 'aaaaaaaa-0000-4000-8000-0000000000e1';

const SEL = randomBytes(4).toString('hex').toUpperCase();
const NOM = `Essai écrans ${SEL} SAS (fictif)`;
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 250, graine: Number.parseInt(SEL.slice(0, 6), 16), anomalies: ['client_crediteur'] });
let dossier = '';

test.describe.configure({ mode: 'serial' });

test('préparation : dossier neuf, habilitations (validation, révision, collaboration), exercice, FEC importé et contrôlé', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  const creation = alice.locator('form[data-formulaire="creer-dossier"]');
  await creation.getByLabel('Raison sociale').fill(NOM);
  await creation.getByLabel('Forme juridique').fill('SAS');
  await creation.getByLabel('Régime fiscal').fill('IS');
  await creation.getByLabel('Territoire fiscal (obligatoire)').selectOption('metropole');
  await creation.getByRole('button', { name: 'Créer le dossier' }).click();
  await alice.getByTestId('dossier-cree').getByRole('link', { name: 'Ouvrir la fiche d’administration du dossier' }).click();
  await expect(alice.getByRole('heading', { level: 1 })).toHaveText(NOM);
  dossier = /\/administration\/dossiers\/([0-9a-f-]{36})/.exec(alice.url())![1]!;
  // Sans habilitation de validation, la restitution est annoncée impossible, même pour l'administratrice.
  await expect(alice.getByTestId('restitution-impossible')).toBeVisible();
  const ligne = (id: string) => alice.locator(`tr[data-membre="${id}"]`);
  for (const [id, niveau] of [[ALICE, 'validation'], [REMI, 'revision'], [CHLOE, 'collaboration']] as const) {
    await ligne(id).getByRole('combobox').selectOption(niveau);
    await ligne(id).getByRole('button', { name: /Enregistrer l’habilitation/ }).click();
    await expect(ligne(id).getByRole('status')).toContainText(/Habilitation (enregistrée|accordée à vous-même)/);
  }
  const exercice = alice.locator('form[data-formulaire="ouvrir-exercice"]');
  await exercice.getByLabel('Début de l’exercice').fill(EXERCICE.debut);
  await exercice.getByLabel('Fin de l’exercice').fill(EXERCICE.fin);
  await exercice.getByRole('button', { name: 'Ouvrir l’exercice' }).click();
  await expect(alice.getByTestId('exercices')).toContainText('Du 01/01/2025 au 31/12/2025');
  await alice.context().close();

  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/comptabilite`);
  await expect(chloe.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link')).toHaveText(['Pièces', 'Comptabilité', 'Banque', 'Tiers et factures', 'Révision', 'Analyse', 'Inventaire', 'États fiscaux', 'Mission', 'Veille', 'Assistant']);
  await chloe.getByTestId('entree-fec').setInputFiles({ name: fec.nomFichier, mimeType: 'text/plain', buffer: Buffer.from(fec.contenu) });
  await chloe.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
  await chloe.getByRole('button', { name: 'Importer' }).click();
  await expect(chloe.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 90_000 });
  // Les contrôles sont lancés par le worker après l'import : le client créditeur injecté donne un constat TIE-001, paramètres par défaut.
  await chloe.goto(`/dossiers/${dossier}/revision`);
  await expect(async () => {
    await chloe.reload();
    await expect(chloe.locator('tr[data-controle="TIE-001"]')).toHaveAttribute('data-statut', 'constat', { timeout: 3_000 });
  }).toPass({ timeout: 120_000, intervals: [3_000] });
  await expect(chloe.getByTestId('origine-parametres')).toHaveCount(0);
  await chloe.context().close();
});

test('recherche : écritures et constat du dossier neuf ; pièces de Dupain avec le terme surligné sans HTML', async ({ browser }) => {
  const page = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}`);
  const champ = page.getByRole('search', { name: 'Rechercher dans ce dossier' });
  await champ.getByLabel('Rechercher dans ce dossier (pièces, écritures, constats)').fill('facture');
  await champ.getByRole('button', { name: 'Chercher dans le dossier' }).click();
  await expect(page.getByTestId('perimetre')).toContainText('périmètre : Pièces, écritures du lot actif et constats de la dernière exécution, dans ce dossier');
  await expect(page.locator('[data-groupe="pieces"]')).toContainText('Aucune pièce ne contient ces termes.');
  const ecritures = page.locator('[data-resultat-ecriture]');
  await expect(ecritures.first()).toContainText(/Facture/i);
  const cellules = await ecritures.first().locator('td').allInnerTexts();
  expect(cellules[0]).toMatch(/^\d{2}\/\d{2}\/2025$/);
  expect(cellules[6]).toMatch(/^[\d\s  ]+,\d{2}$/); // débit formaté depuis la chaîne décimale
  // Constat du client créditeur : trouvé par son titre, lien vers le constat.
  await page.goto(`/dossiers/${dossier}/recherche?q=${encodeURIComponent('créditeur')}`);
  const constat = page.locator('[data-resultat-constat]').filter({ hasText: 'TIE-001' }).first();
  await constat.getByRole('link').click();
  await expect(page).toHaveURL(/\/revision\/constats\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Explication' })).toBeVisible();

  // Pièces (texte extrait réel du dossier de démonstration, en lecture seule).
  await page.goto(`/dossiers/${DUPAIN}/recherche?q=facture`);
  const piece = page.locator('[data-resultat-piece]').first();
  await expect(piece).toContainText(/page \d+/);
  await expect(piece.locator('mark').first()).toHaveText(/^facture$/i);
  await expect(piece.getByTestId('extrait')).not.toContainText('«');
  expect(await piece.getByTestId('extrait').locator('*:not(mark):not(span)').count()).toBe(0); // rien d'autre que du texte et des <mark>
  await piece.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/dossiers/${DUPAIN}/pieces/[0-9a-f-]{36}$`));
  await page.context().close();
});

test('règle : proposée par la collaboratrice, impact mesuré, approuvée par une AUTRE personne (alice), effet visible dans la révision, puis retirée', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, '/regles');
  await expect(chloe.getByTestId('regles-du-jeu')).toContainText('Pas d’auto-approbation');
  const f = chloe.locator('form[data-formulaire="proposer-regle"]');
  // Caisse créditrice : fondement réglementaire (PCG), non paramétrable.
  await f.getByLabel('Contrôle').selectOption('TRE-001');
  await expect(f.getByTestId('non-parametrable')).toContainText('règle réglementaire');
  await f.getByLabel('Contrôle').selectOption('TIE-001');
  await expect(f.getByLabel(/Seuil \(seuil\)/)).toHaveValue('0.00');
  await f.getByLabel('Dossier concerné').selectOption({ label: NOM });
  await f.getByLabel(/Seuil \(seuil\)/).fill('100 000,00');
  await f.getByLabel('Motif de la proposition (obligatoire)').fill(`Essai ${SEL} : petits avoirs clients sans enjeu`);
  await f.getByRole('button', { name: 'Proposer cette règle' }).click();
  const regle = chloe.locator('[data-regle]').filter({ hasText: NOM });
  await expect(regle).toHaveAttribute('data-statut', 'proposee');
  await expect(regle.getByTestId('parametres')).toContainText('100000.00');
  const id = (await regle.getAttribute('data-regle'))!;
  await expect(regle.getByRole('button', { name: 'Approuver' })).toHaveCount(0);

  // Avant la mesure d'impact, l'administratrice ne peut pas approuver.
  const alice = await ouvrir(browser, ALICE_MAIL, '/regles');
  const chezAlice = alice.locator(`[data-regle="${id}"]`);
  await expect(chezAlice.getByRole('button', { name: 'Approuver' })).toBeDisabled();
  await expect(chezAlice.getByTestId('blocage-approbation')).toHaveText('Mesurez l’impact avant d’approuver.');
  expect(await statutBff(alice, 'POST', `v1/regles/${id}/approuver`)).toBe(409);

  await regle.getByRole('button', { name: 'Mesurer l’impact' }).click();
  await expect(regle.getByLabel('Exercice')).toContainText('Du 01/01/2025 au 31/12/2025');
  await regle.getByRole('button', { name: 'Mesurer sur cet exercice' }).click();
  await expect(regle.getByTestId('impact-avant')).toContainText(/[1-9]\d* constat\(s\)/, { timeout: 30_000 });
  await expect(regle.getByTestId('impact-avant')).toContainText('Constat à examiner');
  await expect(regle.getByTestId('impact-apres')).toContainText('0 constat(s)');
  await expect(regle.getByTestId('impact-apres')).toContainText('Exécuté sans anomalie détectée');
  await expect(regle.getByTestId('impact-apparaissent')).toHaveText('0');
  await expect(regle.getByTestId('impact-disparaissent')).toHaveText(/^[1-9]\d*$/);
  expect(await statutBff(chloe, 'POST', `v1/regles/${id}/approuver`)).toBe(403); // ni gestionnaire, ni une autre personne
  await chloe.context().close();

  await alice.reload();
  await chezAlice.getByRole('button', { name: 'Approuver' }).click();
  await expect(alice.locator(`[data-statut-regles="approuvee"] [data-regle="${id}"]`)).toBeVisible();

  // Effet : l'exécution précédente est obsolète ; relancés, les contrôles appliquent la règle et le disent.
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/revision`);
  await expect(remi.getByTestId('bandeau-obsolete')).toBeVisible();
  await remi.getByRole('button', { name: 'Relancer les contrôles' }).click();
  const ligne = remi.locator('tr[data-controle="TIE-001"]');
  await expect(async () => {
    await remi.reload();
    await expect(ligne.getByTestId('origine-parametres')).toContainText('Paramètres propres au dossier — règle v1', { timeout: 3_000 });
  }).toPass({ timeout: 120_000, intervals: [3_000] });
  await expect(ligne).toHaveAttribute('data-statut', 'sans_anomalie');
  await expect(remi.getByTestId('bandeau-obsolete')).toHaveCount(0);
  await remi.context().close();

  // Retrait par l'administratrice : réversible et historisé (le dossier d'essai revient aux paramètres par défaut).
  await chezAlice.getByRole('button', { name: 'Retirer' }).click();
  await chezAlice.getByRole('button', { name: 'Confirmer le retrait' }).click();
  await expect(alice.locator(`[data-statut-regles="retiree"] [data-regle="${id}"]`)).toBeVisible();
  await alice.context().close();
});

test('écriture d’inventaire : proposée par la collaboratrice, approuvée par le réviseur, visible dans la balance ajustée', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/inventaire`);
  await expect(chloe.getByTestId('ecritures-prises-en-compte')).toContainText('Écritures prises en compte (0)');
  const avant = await chloe.getByTestId('impact-resultat').locator('dd').first().innerText();
  const f = chloe.locator('form[data-formulaire="proposer-ecriture"]');
  await f.getByLabel('Date de l’écriture (dans l’exercice)').fill('2025-12-31');
  await f.getByLabel('Libellé', { exact: true }).fill(`FNP fournitures ${SEL}`);
  await f.getByLabel('Justification (pourquoi cette écriture)').fill('Livraison du 18 décembre reçue, facture non parvenue à la clôture.');
  await f.getByLabel('Calcul (détail du montant)').fill('Bon de livraison : 1 200,00 € HT');
  await f.getByLabel('Compte (ligne 1)', { exact: true }).fill('6061');
  await f.getByLabel('Libellé du compte (ligne 1)').fill('Fournitures non stockables');
  await f.getByLabel('Débit (ligne 1)').fill('1200,00');
  await f.getByLabel('Compte (ligne 2)', { exact: true }).fill('408');
  await f.getByLabel('Libellé du compte (ligne 2)').fill('Fournisseurs — factures non parvenues');
  await f.getByLabel('Crédit (ligne 2)').fill('1199,99');
  // L'API réelle refuse l'écriture déséquilibrée et renvoie l'écart qu'elle a calculé.
  await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
  await expect(f.getByTestId('ecart-api')).toContainText('écart : 0,01');
  await f.getByLabel('Crédit (ligne 2)').fill('1200,00');
  await expect(f.getByTestId('totaux-saisie')).toContainText('équilibrée');
  await f.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
  const ecriture = chloe.locator('[data-ecriture]').filter({ hasText: `FNP fournitures ${SEL}` });
  await expect(ecriture).toHaveAttribute('data-statut', 'proposee');
  const id = (await ecriture.getAttribute('data-ecriture'))!;
  await expect(chloe.getByTestId('ecritures-prises-en-compte')).toContainText('Écritures prises en compte (0)'); // aucun effet avant approbation
  await chloe.context().close();

  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/inventaire`);
  await remi.locator(`[data-ecriture="${id}"]`).getByRole('button', { name: 'Approuver' }).click();
  await expect(remi.locator(`[data-ecriture="${id}"]`)).toHaveAttribute('data-statut', 'approuvee');
  await expect(remi.getByTestId('mention-balance-ajustee')).toContainText('PROJET');
  await expect(remi.getByTestId('ecritures-prises-en-compte')).toContainText(`FNP fournitures ${SEL}`);
  await expect(remi.getByTestId('variation-resultat')).toHaveText(/^−1[\s  ]200,00$/); // une charge de plus
  await expect(remi.getByTestId('impact-resultat').locator('dd').first()).toHaveText(avant); // la balance importée n'a pas bougé
  const modifies = remi.getByRole('region', { name: 'Comptes modifiés par les écritures d’inventaire' });
  await expect(modifies.locator('tr[data-compte="408"], tr[data-compte="6061"]')).toHaveCount(2);
  await expect(remi.getByTestId('phrase-export')).toHaveText('Exporter n’est pas intégrer : vous importez vous-même ce fichier dans votre logiciel comptable.');
  await remi.context().close();
});

test('mission : lettre validée, travail hors périmètre et son projet d’avenant', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/mission`);
  await chloe.locator('form[data-formulaire="creer-mission"]').getByLabel('Libellé de la mission').fill(`Mission comptable ${SEL}`);
  await chloe.getByRole('button', { name: 'Créer la mission' }).click();
  const carte = chloe.locator('[data-mission]');
  await carte.getByRole('button', { name: 'Rédiger une lettre ou un avenant' }).click();
  const f = carte.locator('form[data-formulaire="rediger-lettre"]');
  await f.getByLabel('Date d’effet').fill('2025-01-01');
  await f.getByRole('checkbox', { name: 'Tenue de comptabilité' }).check();
  await f.getByRole('checkbox', { name: 'Établissement des comptes annuels' }).check();
  await f.getByLabel('Début de la mission').fill('2025-01-01');
  await f.getByRole('checkbox', { name: 'Tacite reconduction' }).check();
  await f.getByLabel('Honoraires annuels HT (vide : non renseignés)').fill('3600,00');
  await f.getByLabel('Limites de la mission').fill('Hors missions sociales et juridiques');
  await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
  const lettre = carte.locator('[data-lettre]');
  await expect(lettre).toHaveAttribute('data-statut', 'projet');
  await expect(lettre.getByTestId('contenu-lettre')).toContainText(/annuels HT : 3[\s  ]600,00/);
  const lettreId = (await lettre.getAttribute('data-lettre'))!;
  expect(await statutBff(chloe, 'POST', `v1/lettres/${lettreId}/validation`)).toBe(403);

  const alice = await ouvrir(browser, ALICE_MAIL, `/dossiers/${dossier}/mission`);
  await alice.locator(`[data-lettre="${lettreId}"]`).getByRole('button', { name: 'Valider' }).click();
  await alice.locator(`[data-lettre="${lettreId}"]`).getByRole('button', { name: 'Confirmer la validation' }).click();
  await expect(alice.locator(`[data-lettre="${lettreId}"]`)).toHaveAttribute('data-statut', 'validee');
  await alice.context().close();

  await chloe.reload();
  const travail = chloe.locator('form[data-formulaire="enregistrer-travail"]');
  await travail.getByLabel('Date du travail').fill('2025-03-05');
  await travail.getByLabel('Prestation').selectOption('fiscal_tva');
  await travail.getByLabel('Description').fill(`Déclaration de TVA de février ${SEL}`);
  await travail.getByLabel('Temps OBSERVÉ, en minutes (facultatif)').fill('45');
  await travail.getByRole('button', { name: 'Enregistrer le travail' }).click();
  const ligne = chloe.locator('tr[data-travail]').filter({ hasText: `Déclaration de TVA de février ${SEL}` });
  await expect(ligne.getByTestId('rattachement')).toHaveText('Potentiellement hors périmètre — à examiner');
  await expect(ligne).toContainText('45 min');
  await ligne.getByRole('button', { name: 'Préparer un projet d’avenant' }).click();
  // Estimation : toujours avec sa base nommée (barème du cabinet ou temps observés), sinon abstention explicite.
  await expect(ligne.getByTestId('estimation')).toHaveText(/^(Temps estimé : .+ — base : (barème du cabinet|temps observés dans le cabinet)|Estimation impossible : aucune base)$/);
  await expect(ligne.getByTestId('projet-avenant')).toContainText('Projet d’avenant préparé (version 2) — non validé');
  const avenant = chloe.locator('[data-lettre][data-statut="projet"]');
  await expect(avenant).toContainText('Avenant à la version 1 — version 2');
  await expect(avenant).toContainText('Préparé par le logiciel à partir d’un travail');
  await expect(avenant.getByTestId('perimetre').getByRole('listitem')).toHaveCount(3);
  await expect(ligne.getByTestId('rattachement')).toHaveText('Potentiellement hors périmètre — à examiner'); // un projet ne change rien
  await chloe.context().close();
});

test('conseil : rédigé, validé, envoi autorisé (deux étapes), envoi consigné avec justificatif ; « réception : non établi »', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/mission/conseils`);
  await expect(chloe.getByTestId('mention-registre')).toContainText('Le logiciel n’envoie rien : il trace.');
  await chloe.getByRole('button', { name: 'Rédiger un conseil' }).click();
  const f = chloe.locator('form[data-formulaire="rediger-conseil"]');
  await f.getByLabel('Date du conseil').fill('2025-05-12');
  await f.getByLabel('Objet').fill(`Option TVA ${SEL}`);
  await f.getByLabel('Destinataire').fill('Gérant de la société');
  await f.getByLabel('Contenu').fill('Projet de note sur les conséquences de l’option.');
  await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
  const fiche = chloe.locator('[data-conseil]');
  await expect(fiche).toHaveAttribute('data-statut', 'projet');
  const id = (await fiche.getAttribute('data-conseil'))!;
  const ligne = chloe.locator(`tr[data-ligne-conseil="${id}"]`);
  await expect(ligne.locator('td[data-fait]')).toHaveText(['Non établi', 'Non établi', 'Non établi', 'Non établi']);
  await expect(fiche.locator('form[data-formulaire="consigner-fait"]')).toHaveCount(0);

  const alice = await ouvrir(browser, ALICE_MAIL, `/dossiers/${dossier}/mission/conseils`);
  const chezAlice = alice.locator(`[data-conseil="${id}"]`);
  await chezAlice.getByRole('button', { name: 'Valider ce conseil' }).click();
  await chezAlice.getByRole('button', { name: 'Confirmer la validation' }).click();
  await expect(chezAlice).toHaveAttribute('data-statut', 'valide');
  await expect(chezAlice).toContainText('Validé — envoi non autorisé');
  await chezAlice.getByRole('button', { name: 'Autoriser l’envoi' }).click();
  await chezAlice.getByRole('button', { name: 'Confirmer l’autorisation d’envoi' }).click();
  await expect(chezAlice).toHaveAttribute('data-statut', 'envoi_autorise');
  await alice.context().close();

  await chloe.reload();
  const fait = fiche.locator('form[data-formulaire="consigner-fait"]');
  await expect(fait.getByLabel('Fait constaté').locator('option')).toHaveText(['Envoi']);
  await fait.getByLabel('Date et heure').fill('2025-05-13T09:00');
  await fait.getByLabel('Canal').fill('courriel');
  await fait.getByRole('button', { name: 'Consigner ce fait' }).click();
  await expect(fait.getByRole('alert')).toContainText('Le justificatif est obligatoire');
  await fait.getByLabel('Justificatif (obligatoire : ce qui établit le fait)').fill('Message envoyé depuis la messagerie du cabinet');
  await fait.getByRole('button', { name: 'Consigner ce fait' }).click();
  await expect(ligne.locator('td[data-fait="envoi"]')).toHaveAttribute('data-etabli', 'true');
  await expect(ligne.locator('td[data-fait="envoi"]')).toHaveText(/13\/05\/2025/);
  await expect(ligne.locator('td[data-fait="remise"]')).toHaveText('Non établi');
  await expect(ligne.locator('td[data-fait="reception"]')).toHaveText('Non établi');
  await expect(ligne.locator('td[data-fait="lecture"]')).toHaveText('Non établi');
  await expect(fiche.getByTestId('evenements')).toContainText('Message envoyé depuis la messagerie du cabinet');
  await chloe.reload(); // l'état vient bien du serveur
  await expect(ligne.locator('td[data-fait="reception"]')).toHaveText('Non établi');
  await chloe.context().close();
});

test('veille : onglet du dossier et page des sources (BOFiP lues, Légifrance indisponibles, montrées telles quelles)', async ({ browser }) => {
  const page = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/veille`);
  await expect(page.getByTestId('phrase-veille')).toContainText('Aucune évolution ne modifie les contrôles automatiquement.');
  // Les évolutions affichées sont celles que l'éditeur a qualifiées : il peut n'y en avoir aucune, et l'écran le dit sans conclure à l'absence de nouveauté.
  const evolutions = page.locator('[data-evolution]');
  if ((await evolutions.count()) === 0) await expect(page.getByTestId('aucune-evolution')).toContainText('Cela ne signifie pas qu’aucun texte n’a changé');
  else await expect(evolutions.first().getByTestId('applicabilite')).toHaveText(/^(Concerné|À confirmer|Non concerné)$/);
  await page.getByRole('link', { name: 'Voir l’état de la veille par source' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Veille : sources surveillées');
  const sources = page.locator('[data-source]');
  expect(await sources.count()).toBeGreaterThanOrEqual(4);
  for (const s of await sources.filter({ hasText: 'BOFiP' }).all()) {
    await expect(s.getByTestId('etat-veille')).toHaveText('Veille assurée');
    await expect(s.getByTestId('dernier-succes')).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  }
  const legifrance = sources.filter({ hasText: 'Légifrance' });
  expect(await legifrance.count()).toBeGreaterThanOrEqual(2);
  for (const s of await legifrance.all()) {
    await expect(s.getByTestId('etat-veille')).toHaveText('Veille NON assurée');
    await expect(s).toContainText('Cela ne signifie pas qu’il n’y a aucune nouveauté');
    await expect(s.getByTestId('dernier-essai')).toContainText('Source indisponible au dernier essai');
  }
  await expect(page.getByTestId('alerte-non-assuree')).toContainText('Une source indisponible ne signifie pas « aucune nouveauté »');
  await expect(page.getByTestId('non-qualifiees')).toContainText(/qualifiées par l’éditeur : \d+/);
  await page.context().close();
});

test('restitution : demandée, suivie jusqu’à « terminé », archive téléchargée dont l’empreinte SHA-256 est celle affichée', async ({ browser }) => {
  const page = await ouvrir(browser, ALICE_MAIL, `/dossiers/${dossier}`);
  await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Restitution' }).click();
  await page.getByRole('button', { name: 'Demander un export de restitution' }).click();
  const export_ = page.locator('[data-restitution]').first();
  await expect(export_).toHaveAttribute('data-statut', 'termine', { timeout: 180_000 }); // suivi automatique, sans rechargement manuel
  const empreinte = (await export_.getByTestId('empreinte').innerText()).trim();
  expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
  await expect(export_.getByTestId('resume-pieces')).toHaveText('0');
  await expect(export_.getByTestId('resume-exclus')).toHaveText('Aucun');
  expect(Number.parseInt((await export_.getByTestId('resume-lignes').innerText()).replace(/\D/g, ''), 10)).toBeGreaterThan(400);
  const telechargement = page.waitForEvent('download');
  await export_.getByTestId('telecharger-archive').click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^restitution-[0-9a-f-]{36}\.zip$/);
  const contenu = readFileSync(await fichier.path());
  expect(contenu.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(createHash('sha256').update(contenu).digest('hex')).toBe(empreinte);
  await page.context().close();

  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/restitution`);
  await expect(remi.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
  expect(await statutBff(remi, 'GET', `v1/dossiers/${dossier}/restitutions`)).toBe(403);
  await remi.context().close();
});

test('indicateurs du cabinet : affichés à l’administratrice, refusés au réviseur ; membres en lecture (aucune modification)', async ({ browser }) => {
  const page = await ouvrir(browser, ALICE_MAIL, '/administration/indicateurs?du=2020-01-01');
  await expect(page.getByTestId('mentions-indicateurs')).toContainText('Aucun indicateur par personne.');
  await expect(page.getByTestId('mentions-indicateurs')).toContainText('Ces chiffres mesurent l’activité enregistrée, pas la qualité des extractions.');
  await expect(page.getByTestId('periode')).toContainText('du 01/01/2020');
  expect(Number.parseInt((await page.getByTestId('pieces-recues').innerText()).replace(/\D/g, ''), 10)).toBeGreaterThan(0);
  await expect(page.getByTestId('delai-traitement')).toContainText('Approximation');
  await expect(page.getByTestId('bloc-extractions').locator('[data-devenir] dt')).toHaveText(['Acceptées sans correction', 'Corrigées puis validées', 'Rejetées', 'Non examinées']);
  await expect(page.getByTestId('controles-par-statut')).toContainText('Exécuté sans anomalie détectée');
  await expect(page.getByTestId('imports-par-type')).toContainText('Écritures comptables — Terminé');
  // Temps observé saisi plus haut (45 min de TVA) : compté par prestation et dans la ligne du dossier d'essai.
  await expect(page.getByTestId('bloc-temps').locator('[data-prestation="fiscal_tva"]')).toContainText('Déclarations de TVA');
  await expect(page.locator(`tr[data-dossier="${dossier}"] td`).last()).toHaveText('45 min');
  await expect(page.locator(`tr[data-dossier="${dossier}"] td`).nth(2)).toHaveText(/^\d+$/);
  for (const nom of ['Rémi', 'Chloé', 'Camille']) await expect(page.getByRole('main')).not.toContainText(nom);
  // Liste des membres : les commandes existent, mais ce parcours ne change aucun rôle et ne désactive personne (données partagées).
  await page.goto('/administration');
  await expect(page.locator(`tr[data-membre="${ALICE}"]`).getByTestId('membre-soi-meme')).toBeVisible();
  await expect(page.locator(`tr[data-membre="${REMI}"]`).getByRole('button', { name: 'Désactiver Rémi Réviseur' })).toBeEnabled();
  await expect(page.locator(`tr[data-membre="${REMI}"]`).getByRole('button', { name: 'Changer le rôle de Rémi Réviseur' })).toBeDisabled();
  await expect(page.getByTestId('garde-fous-membres')).toBeVisible();
  await page.context().close();

  const remi = await ouvrir(browser, REMI_MAIL, '/administration/indicateurs');
  await expect(remi.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
  expect(await statutBff(remi, 'GET', 'v1/cabinet/indicateurs')).toBe(403);
  await remi.context().close();
});
