/**
 * Versions de pièce, aperçu d'un CSV bancaire, pièces jointes, annulation / rétablissement d'un import, campagnes
 * d'import et rentabilité d'une mission sur la pile RÉELLE (web 3100, API, worker, Keycloak, base, stockage, antivirus).
 * Rejouable : chaque exécution crée DEUX dossiers neufs (par l'API, à travers le BFF de l'application) et n'utilise que
 * des données synthétiques (@comtaple/core).
 * Données partagées : aucun compte n'est désactivé, aucun rôle n'est changé, aucune habilitation existante n'est retirée,
 * le compte client déposant n'est habilité nulle part ; le coût horaire interne du cabinet n'est modifié que s'il était
 * vide, et il est remis à vide dans un bloc de nettoyage, même en cas d'échec.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { genererFecSynthetique, genererTexteFactureSynthetique } from '@comtaple/core';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { ordinateur } from './profils';
import { PDFDocument, StandardFonts } from 'pdf-lib';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}
async function ouvrir(browser: Browser, email: string, destination: string): Promise<Page> {
  const contexte = await browser.newContext({ ...ordinateur(browser), viewport: { width: 1440, height: 900 } });
  const page = await contexte.newPage();
  await page.goto(destination);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  return page;
}
/** Appel de l'API réelle à travers le BFF de l'application (même origine, en-tête CSRF) : préparation et vérifications. */
async function bff<T = Record<string, unknown>>(page: Page, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: T }> {
  return page.evaluate(
    async ([m, c, d]) => {
      const r = await fetch(`/api/bff/${c}`, { method: m, headers: { ...(m === 'GET' ? {} : { 'X-Comtaple-Csrf': '1' }), ...(d !== null ? { 'Content-Type': 'application/json' } : {}) }, body: d });
      return { statut: r.status, json: await r.json().catch(() => null) };
    },
    [methode, chemin, corps === undefined ? null : JSON.stringify(corps)] as const,
  ) as Promise<{ statut: number; json: T }>;
}
/** PDF à couche texte (lu sans OCR par le worker) portant une facture SYNTHÉTIQUE ; `marque` rend le fichier unique. */
async function pdfFacture(graine: number, marque: string): Promise<Buffer> {
  const facture = genererTexteFactureSynthetique({ graine });
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const lignes = [...facture.pages[0]!.texte.split('\n'), `Référence d’essai ${marque}`];
  lignes.forEach((l, i) => page.drawText(l.replace(/[   ]/g, ' ').replace(/[^ -ÿ€’]/g, '?'), { x: 50, y: 800 - 14 * i, size: 10, font: police }));
  return Buffer.from(await doc.save());
}
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const ALICE_MAIL = 'alice.admin@cabinet-a.test';
const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';
const CHLOE = '11111111-1111-4111-8111-111111111103';

const SEL = randomBytes(4).toString('hex').toUpperCase();
const graine = Number.parseInt(SEL.slice(0, 6), 16);
const NOM_A = `Essai nouveautés A ${SEL} SAS (fictif)`;
const NOM_B = `Essai nouveautés B ${SEL} SARL (fictif)`;
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const fecA = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 150, graine });
const fecB = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 120, graine: graine + 1 });
const PIECE_V1 = `facture-${SEL}-v1.pdf`;
const PIECE_V2 = `facture-${SEL}-v2.pdf`;
let dossierA = '';
let dossierB = '';
let pieceV1 = '';
let pieceV2 = '';
/** Vrai entre la saisie du coût horaire par le test et sa remise à vide confirmée par l'API. */
let coutARemettreAVide = false;

test.describe.configure({ mode: 'serial' });

test('préparation : deux dossiers neufs, habilitations (validation, révision, collaboration), un exercice chacun', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  for (const [nom, affecter] of [[NOM_A, (id: string) => (dossierA = id)], [NOM_B, (id: string) => (dossierB = id)]] as const) {
    const cree = await bff<{ id: string }>(alice, 'POST', 'v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole' });
    expect(cree.statut).toBe(201);
    affecter(cree.json.id);
    for (const [utilisateur, niveau] of [[ALICE, 'validation'], [REMI, 'revision'], [CHLOE, 'collaboration']] as const) {
      expect((await bff(alice, 'PUT', `v1/dossiers/${cree.json.id}/habilitations/${utilisateur}`, { niveau })).statut).toBe(200);
    }
    expect((await bff(alice, 'POST', `v1/dossiers/${cree.json.id}/exercices`, EXERCICE)).statut).toBe(201);
  }
  await alice.context().close();
});

test('(a) nouvelle version : pièce validée par le réviseur, version 2 déposée depuis l’écran de revue, validation invalidée, ancien fichier toujours consultable', async ({ browser }) => {
  const v1 = await pdfFacture(graine, `${SEL}-v1`);
  const v2 = await pdfFacture(graine + 7, `${SEL}-v2`);
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossierA}`);
  await chloe.getByTestId('entree-pieces').setInputFiles({ name: PIECE_V1, mimeType: 'application/pdf', buffer: v1 });
  await expect(chloe.getByTestId('liste-envois').getByRole('listitem')).toContainText('Reçu', { timeout: 60_000 });
  await chloe.getByRole('link', { name: PIECE_V1 }).click();
  await expect(chloe).toHaveURL(/\/pieces\/[0-9a-f-]{36}/);
  pieceV1 = /\/pieces\/([0-9a-f-]{36})/.exec(chloe.url())![1]!;
  // Analyse asynchrone (antivirus, lecture du PDF, extraction) : on recharge jusqu'au statut « À contrôler ».
  await expect(async () => {
    await chloe.reload();
    await expect(chloe.getByTestId('entete-piece')).toContainText('À contrôler', { timeout: 3_000 });
  }).toPass({ timeout: 150_000, intervals: [3_000] });
  await expect(chloe.getByTestId('versions').getByRole('listitem')).toHaveCount(1);

  // Le réviseur valide la version 1.
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossierA}/pieces/${pieceV1}`);
  await remi.getByTestId('decision-reviseur').getByRole('button', { name: /^Valider la version \d+$/ }).click();
  await expect(remi.getByTestId('entete-piece')).toContainText('Traité', { timeout: 20_000 });
  await expect(remi.getByText(/Validé par un réviseur/)).toBeVisible();

  // La collaboratrice dépose une nouvelle version depuis l'écran de revue.
  await chloe.reload();
  await expect(chloe.getByText(/Validé par un réviseur/)).toBeVisible();
  await expect(chloe.getByTestId('nouvelle-version')).toContainText('cette validation ne vaut pas pour la nouvelle version, qui devra être contrôlée à nouveau');
  await chloe.getByTestId('entree-nouvelle-version').setInputFiles({ name: PIECE_V2, mimeType: 'application/pdf', buffer: v2 });
  await chloe.getByRole('button', { name: 'Envoyer la nouvelle version' }).click();
  const compteRendu = chloe.getByTestId('compte-rendu-version');
  await expect(compteRendu).toContainText('Version 2 reçue', { timeout: 60_000 });
  await expect(compteRendu).toContainText('cette validation ne vaut pas pour la version 2');

  // Ancienne version : remplacée, validation invalidée (jamais « Validé »), aucune action, fichier d'origine servi à l'identique.
  await expect(chloe.getByTestId('version-remplacee')).toContainText('Cette version a été remplacée par la version 2 — elle est conservée pour mémoire');
  await expect(chloe.getByTestId('entete-piece')).toContainText('Remplacée');
  await expect(chloe.getByTestId('entete-piece')).toContainText('Validation invalidée par l’arrivée d’une nouvelle version');
  await expect(chloe.getByText(/Validé par un réviseur/)).toHaveCount(0);
  await expect(chloe.locator('[data-formulaire="correction"]')).toHaveCount(0);
  await expect(chloe.getByTestId('apercu-piece')).toHaveAttribute('data-type', 'application/pdf', { timeout: 30_000 });
  const empreinte = await chloe.evaluate(async (id) => {
    const r = await fetch(`/api/bff/v1/documents/${id}/contenu`, { cache: 'no-store' });
    const condense = await crypto.subtle.digest('SHA-256', await r.arrayBuffer());
    return { statut: r.status, sha: Array.from(new Uint8Array(condense), (o) => o.toString(16).padStart(2, '0')).join('') };
  }, pieceV1);
  expect(empreinte).toEqual({ statut: 200, sha: sha256(v1) });
  expect((await bff(chloe, 'PUT', `v1/documents/${pieceV1}/extraction`, { champs: { numero: 'X' } })).statut).toBe(409);
  await remi.reload();
  await expect(remi.getByTestId('version-remplacee')).toBeVisible();
  await expect(remi.getByTestId('decision-reviseur')).toHaveCount(0);

  // Nouvelle version : à contrôler, jamais validée d'office.
  await compteRendu.getByRole('link', { name: 'Ouvrir la version 2' }).click();
  await expect(chloe.getByRole('heading', { level: 2, name: PIECE_V2 })).toBeVisible();
  pieceV2 = /\/pieces\/([0-9a-f-]{36})/.exec(chloe.url())![1]!;
  expect(pieceV2).not.toBe(pieceV1);
  await expect(async () => {
    await chloe.reload();
    await expect(chloe.getByTestId('entete-piece')).toContainText('À contrôler', { timeout: 3_000 });
  }).toPass({ timeout: 150_000, intervals: [3_000] });
  await expect(chloe.getByTestId('entete-piece')).toContainText('Version 2');
  await expect(chloe.getByText('Extraction automatique — projet')).toBeVisible();
  await expect(chloe.getByText(/Validé par un réviseur/)).toHaveCount(0);
  const versions = chloe.getByTestId('versions').getByRole('listitem');
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText('Remplacée');
  await expect(versions.nth(1)).toHaveAttribute('aria-current', 'true');
  // File des pièces : la version remplacée est masquée par défaut, visible sur demande.
  await chloe.goto(`/dossiers/${dossierA}`);
  await expect(chloe.getByRole('link', { name: PIECE_V1 })).toHaveCount(0);
  await expect(chloe.locator('tbody tr', { hasText: PIECE_V2 })).toContainText('Version 2');
  await chloe.getByTestId('filtre-remplacees').getByRole('link').click();
  await expect(chloe.locator('tbody tr[data-remplacee="oui"]')).toContainText(PIECE_V1);
  await chloe.context().close();
  await remi.context().close();
});

test('(b) CSV bancaire non reconnu : aperçu affiché, profil confirmé par l’utilisatrice, import terminé', async ({ browser }) => {
  const page = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossierA}/banque`);
  const csv = `Quand;Quoi;Combien\n05/02/2025;Abonnement <b>logiciel</b> ${SEL};-12,50\n06/02/2025;Remise de chèques ${SEL};100,00\n`;
  await page.getByTestId('entree-releve').setInputFiles({ name: `export-${SEL}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  const lot = page.getByTestId('imports-releves').getByRole('listitem').first();
  await expect(lot).toContainText('Import en attente de votre confirmation', { timeout: 90_000 });
  const profil = lot.locator('form[data-formulaire="profil-csv"]');
  const apercu = profil.getByTestId('apercu-csv');
  await expect(apercu.getByTestId('apercu-lignes-brutes')).toContainText('Quand;Quoi;Combien', { timeout: 30_000 });
  await expect(apercu.getByTestId('apercu-lignes-brutes')).toContainText(`Abonnement <b>logiciel</b> ${SEL};-12,50`); // texte brut
  await expect(apercu.locator('b')).toHaveCount(0);
  await expect(apercu.getByRole('columnheader')).toHaveText(['Colonne 1Quand', 'Colonne 2Quoi', 'Colonne 3Combien']);
  await expect(apercu.getByRole('cell', { name: '-12,50' })).toBeVisible();
  await expect(profil.getByTestId('raisons-profil').getByRole('listitem').first()).toBeVisible();
  await expect(profil.getByTestId('profil-propose')).toHaveCount(0); // l'API ne propose rien : rien n'est pré-rempli
  await profil.getByLabel('Colonne de la date').fill('Quand');
  await profil.getByLabel('Colonne du libellé').fill('2');
  await profil.getByLabel('Colonne du montant').fill('Combien');
  await profil.getByRole('button', { name: 'Je confirme ce profil et relance la lecture' }).click();
  await expect(lot).toContainText(/2 mouvements lus · 2 nouveaux/, { timeout: 90_000 });
  await expect(lot).toContainText('profil confirmé par un utilisateur');
  await expect(lot).toHaveAttribute('data-statut', /^termine/);
  await page.context().close();
});

test('(c) pièces jointes : une pièce du dossier jointe à un conseil et à une écriture d’inventaire, visible avec son nom', async ({ browser }) => {
  const page = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossierA}/mission/conseils`);
  await page.getByRole('button', { name: 'Rédiger un conseil' }).click();
  const f = page.locator('form[data-formulaire="rediger-conseil"]');
  await f.getByLabel('Date du conseil').fill('2025-06-01');
  await f.getByLabel('Objet').fill(`Conseil avec pièce ${SEL}`);
  await f.getByLabel('Destinataire').fill('Gérant');
  await f.getByLabel('Contenu').fill('Voir la facture jointe.');
  const selecteur = f.getByTestId('selecteur-pieces');
  await selecteur.getByRole('button', { name: 'Choisir des pièces du dossier' }).click();
  const disponibles = selecteur.getByTestId('pieces-disponibles');
  await expect(disponibles).toContainText(PIECE_V2, { timeout: 20_000 });
  await expect(disponibles).not.toContainText(PIECE_V1); // version remplacée exclue par défaut
  await selecteur.getByLabel('Rechercher par nom (dans la page affichée)').fill(`${SEL}-v2`);
  await disponibles.getByRole('checkbox').check();
  await f.getByRole('button', { name: 'Enregistrer le projet' }).click();
  const jointes = page.locator('[data-conseil]').getByTestId('pieces-jointes');
  await expect(jointes).toContainText('Pièces jointes (1)');
  await expect(jointes).toContainText('version 2');
  await expect(jointes.getByRole('link', { name: PIECE_V2 })).toHaveAttribute('href', `/dossiers/${dossierA}/pieces/${pieceV2}`);

  await page.goto(`/dossiers/${dossierA}/inventaire`);
  const e = page.locator('form[data-formulaire="proposer-ecriture"]');
  await e.getByLabel('Date de l’écriture (dans l’exercice)').fill('2025-12-31');
  await e.getByLabel('Libellé', { exact: true }).fill(`Charge constatée d’avance ${SEL}`);
  await e.getByLabel('Justification (pourquoi cette écriture)').fill('Abonnement annuel payé en décembre, couvrant l’exercice suivant.');
  await e.getByLabel('Calcul (détail du montant)').fill('600,00 × 11/12');
  await e.getByLabel('Compte (ligne 1)', { exact: true }).fill('486');
  await e.getByLabel('Libellé du compte (ligne 1)').fill('Charges constatées d’avance');
  await e.getByLabel('Débit (ligne 1)').fill('550,00');
  await e.getByLabel('Compte (ligne 2)', { exact: true }).fill('6135');
  await e.getByLabel('Libellé du compte (ligne 2)').fill('Locations mobilières');
  await e.getByLabel('Crédit (ligne 2)').fill('550,00');
  const choix = e.getByTestId('selecteur-pieces');
  await choix.getByRole('button', { name: 'Choisir des pièces du dossier' }).click();
  await choix.getByTestId('pieces-disponibles').getByRole('listitem').filter({ hasText: PIECE_V2 }).getByRole('checkbox').check();
  await e.getByRole('button', { name: 'Proposer l’écriture (projet)' }).click();
  const justificatives = page.getByTestId('pieces-jointes');
  await expect(justificatives).toContainText('Pièces justificatives (1)', { timeout: 20_000 });
  await expect(justificatives.getByRole('link', { name: PIECE_V2 })).toBeVisible();
  await page.context().close();
  // Vue par le réviseur : auteur de la proposition nommé par l'API.
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossierA}/inventaire`);
  await expect(remi.getByRole('main')).toContainText('par Chloé Collab');
  await expect(remi.getByTestId('pieces-jointes').getByRole('link', { name: PIECE_V2 })).toBeVisible();
  await remi.context().close();
});

test('(d) import comptable annulé avec motif par le réviseur : statut « Annulé », plus de données actives, puis rétabli', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossierA}/comptabilite`);
  await chloe.getByTestId('entree-fec').setInputFiles({ name: fecA.nomFichier, mimeType: 'text/plain', buffer: Buffer.from(fecA.contenu) });
  await chloe.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
  await chloe.getByRole('button', { name: 'Importer' }).click();
  await expect(chloe.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 120_000 });
  await expect(chloe.getByRole('button', { name: 'Annuler l’import' })).toHaveCount(0); // révision requise
  await chloe.context().close();

  const page = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossierA}/comptabilite`);
  const ligne = page.locator('tr[data-lot]');
  await expect(ligne).toHaveCount(1);
  await expect(ligne).toHaveAttribute('data-actif', 'true');
  await ligne.getByRole('button', { name: 'Annuler l’import' }).click();
  await expect(ligne.getByTestId('explication-import')).toContainText('Rien n’est supprimé');
  await expect(ligne.getByTestId('explication-import')).toContainText('le lot précédent encore valable redevient actif');
  await ligne.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await expect(ligne.getByRole('alert')).toContainText('Le motif est obligatoire');
  await ligne.getByLabel('Motif de l’annulation (obligatoire)').fill(`Fichier importé par erreur (essai ${SEL})`);
  await ligne.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await expect(ligne).toHaveAttribute('data-statut', 'annule', { timeout: 20_000 });
  await expect(ligne).toHaveAttribute('data-actif', 'false');
  const trace = ligne.getByTestId('trace-annulation');
  await expect(trace).toContainText('Annulé le ');
  await expect(trace).toContainText('par Rémi Réviseur');
  await expect(trace).toContainText(`motif : Fichier importé par erreur (essai ${SEL})`);
  await expect(page.getByTestId('sans-donnees-actives')).toContainText('Cet exercice n’a plus de données comptables actives');

  await ligne.getByRole('button', { name: 'Rétablir' }).click();
  await ligne.getByLabel('Motif du rétablissement (obligatoire)').fill('Vérification faite : c’était le bon fichier');
  await ligne.getByRole('button', { name: 'Confirmer le rétablissement' }).click();
  await expect(ligne).toHaveAttribute('data-actif', 'true', { timeout: 20_000 });
  await expect(ligne).toHaveAttribute('data-statut', /^termine/);
  await expect(ligne.getByTestId('trace-annulation')).toHaveCount(0);
  await expect(page.getByTestId('sans-donnees-actives')).toHaveCount(0);
  await page.context().close();
});

test('(e) campagne d’import : fichiers déposés pour deux dossiers, dont un illisible — un succès et un échec, chacun isolé', async ({ browser }) => {
  const page = await ouvrir(browser, CHLOE_MAIL, '/campagnes');
  const creation = page.locator('form[data-formulaire="creer-campagne"]');
  await creation.getByLabel('Libellé de la campagne').fill(`Campagne d’essai ${SEL}`);
  await creation.getByRole('radio', { name: 'Import comptable' }).check();
  await creation.getByRole('button', { name: 'Ouvrir la campagne' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Campagne d’essai ${SEL}` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('phrase-isolement')).toContainText('Chaque dossier est traité séparément : l’échec de l’un n’affecte pas les autres.');
  const f = page.locator('form[data-formulaire="depot-campagne"]');
  const deposer = async (dossier: string, nom: string, contenu: Buffer) => {
    await f.getByLabel('Dossier (parmi ceux où vous êtes habilité en collaboration)').selectOption({ label: dossier });
    await expect(f.getByLabel('Exercice')).toBeEnabled({ timeout: 20_000 });
    await f.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
    await f.getByTestId('entree-campagne').setInputFiles({ name: nom, mimeType: 'text/plain', buffer: contenu });
    await f.getByRole('button', { name: 'Déposer pour ce dossier' }).click();
  };
  await deposer(NOM_B, fecB.nomFichier, Buffer.from(fecB.contenu));
  await expect(page.getByTestId('liste-envois').getByRole('listitem')).toHaveCount(1);
  await deposer(NOM_A, `illisible-${SEL}.txt`, Buffer.from(`fichier illisible ${SEL}\nce n’est pas un fichier d’écritures\n`));
  const envois = page.getByTestId('liste-envois').getByRole('listitem');
  await expect(envois).toHaveCount(2);
  await expect(envois.nth(0)).toContainText('Reçu', { timeout: 60_000 });
  await expect(envois.nth(1)).toContainText('Reçu', { timeout: 60_000 });

  const reussi = page.locator(`tr[data-dossier="${dossierB}"]`);
  const echoue = page.locator(`tr[data-dossier="${dossierA}"]`);
  await expect(reussi).toHaveAttribute('data-statut', /^termine/, { timeout: 150_000 });
  await expect(echoue).toHaveAttribute('data-statut', 'echec', { timeout: 150_000 });
  await expect(reussi.locator('[data-indicateur="Lisible"]')).toHaveText('Lisible : oui');
  await expect(reussi.locator('[data-indicateur="Suffisant"]')).toHaveText('Suffisant : oui');
  await expect(echoue.locator('[data-indicateur="Lisible"]')).toHaveText('Lisible : non');
  await expect(page.locator('[data-synthese="echec"]')).toHaveText('Échec : 1');
  await expect(page.getByTestId('synthese-campagne')).toContainText('Synthèse (2 imports dans vos dossiers)');
  // L'échec du dossier A n'a pas touché ses données actives (le lot rétabli au parcours précédent).
  await page.goto(`/dossiers/${dossierA}/comptabilite`);
  await expect(page.locator('tr[data-lot][data-actif="true"]')).toHaveCount(1);
  await expect(page.locator('tr[data-lot][data-actif="true"]')).toContainText(fecA.nomFichier);
  await expect(page.locator('tr[data-lot][data-statut="echec"]').getByRole('button', { name: 'Reprendre' })).toBeVisible();
  await page.context().close();
});

test('(f) rentabilité : honoraires et temps observés affichés ; marge « non calculable » tant qu’aucun coût horaire n’est saisi', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossierA}/mission`);
  const mission = await bff<{ id: string }>(chloe, 'POST', `v1/dossiers/${dossierA}/missions`, { libelle: `Mission comptable ${SEL}` });
  expect(mission.statut).toBe(201);
  const contenu = {
    perimetre: [{ prestation: 'tenue' }],
    duree: { debut: '2025-01-01', fin: null, taciteReconduction: true },
    honoraires: { mode: 'forfait', montantAnnuelHt: '3600.00', tauxHoraireHt: null, conditionsRevision: '' },
    obligationsCabinet: '', obligationsClient: '', livrables: [], mandats: [], limites: '',
  };
  const lettre = await bff<{ id: string }>(chloe, 'POST', `v1/missions/${mission.json.id}/lettres`, { dateEffet: '2025-01-01', contenu });
  expect(lettre.statut).toBe(201);
  for (const t of [
    { dateTravail: '2025-02-10', prestation: 'tenue', description: 'Saisie de février', tempsObserveMinutes: 120 },
    { dateTravail: '2025-04-02', prestation: 'tenue', description: 'Saisie de mars, temps non relevé' },
  ]) expect((await bff(chloe, 'POST', `v1/dossiers/${dossierA}/travaux`, t)).statut).toBe(201);
  // Affectation explicite d'un travail à la mission, par l'interface : enregistrée, et relue après rechargement.
  await chloe.reload();
  const ligne = chloe.locator('tr[data-travail]', { hasText: 'Saisie de février' });
  await expect(ligne.getByLabel('Mission de ce travail')).toHaveValue('');
  await ligne.getByLabel('Mission de ce travail').selectOption(mission.json.id);
  await expect(ligne.getByText('Travail affecté.')).toBeVisible({ timeout: 20_000 });
  // Aucune requête en vol avant le rechargement (D-151) : Firefox en CI a interrompu ce rechargement (NS_BINDING_ABORTED) ; hypothèse non confirmée.
  await chloe.waitForLoadState('networkidle');
  await chloe.reload();
  await expect(chloe.locator('tr[data-travail]', { hasText: 'Saisie de février' }).getByLabel('Mission de ce travail')).toHaveValue(mission.json.id);
  // Une collaboratrice n'accède pas à la rentabilité.
  await chloe.goto(`/dossiers/${dossierA}/mission/rentabilite`);
  await expect(chloe.getByTestId('rentabilite-reservee')).toBeVisible();
  await chloe.context().close();

  const url = `/dossiers/${dossierA}/mission/rentabilite?du=2025-01-01&au=2025-12-31`;
  const alice = await ouvrir(browser, ALICE_MAIL, url);
  // Tant que la lettre est un projet, aucun honoraire n'est supposé.
  await expect(alice.getByTestId('honoraires').getByTestId('non-calculable')).toContainText('Aucune lettre de mission validée');
  await expect(alice.getByTestId('honoraires')).not.toContainText('0,00');
  expect((await bff(alice, 'POST', `v1/lettres/${lettre.json.id}/validation`)).statut).toBe(200);
  await alice.reload();
  await expect(alice.getByTestId('mention-generale')).toContainText('ni une facturation');
  await expect(alice.getByTestId('honoraires').locator('[data-valeur="total"]')).toHaveText(/^3\s600,00\s€$/);
  await expect(alice.getByTestId('honoraires').locator('tr[data-detail]')).toContainText('365');
  await expect(alice.getByTestId('temps-observes').locator('[data-valeur="dans-perimetre"]')).toHaveText('2 h');
  await expect(alice.getByTestId('temps-observes').locator('[data-valeur="sans-temps"]')).toContainText('1');
  await expect(alice.getByTestId('taux-horaire')).toHaveAttribute('data-statut', 'partiel');
  await expect(alice.getByTestId('taux-horaire').locator('[data-valeur="taux"]')).toContainText(/1\s800,00\s€/);
  await expect(alice.getByTestId('mentions').getByRole('listitem').first()).toBeVisible();

  const initial = await bff<{ coutHoraireInterneHt: string | null }>(alice, 'GET', 'v1/cabinet/cout-horaire');
  expect(initial.statut).toBe(200);
  test.skip(initial.json.coutHoraireInterneHt !== null, 'Un coût horaire est déjà saisi pour le cabinet (autre chantier en cours) : il n’est pas modifié par ce test.');
  await expect(alice.getByTestId('marge').getByTestId('non-calculable')).toHaveText('Non calculable — Coût horaire interne du cabinet non renseigné : aucune marge n’est calculée.');
  await expect(alice.getByTestId('marge').locator('[data-valeur]')).toHaveCount(0);
  // Réviseur non gestionnaire : même page, motif propre de l'API.
  const remi = await ouvrir(browser, REMI_MAIL, url);
  await expect(remi.getByTestId('marge').getByTestId('non-calculable')).toContainText('réservés aux administrateurs et associés');
  await remi.context().close();

  // Saisie du coût horaire par l'administratrice, puis remise à vide QUOI QU'IL ARRIVE.
  try {
    await alice.goto('/administration');
    const f = alice.locator('form[data-formulaire="cout-horaire"]');
    await expect(f.getByTestId('cout-horaire-actuel')).toContainText('non saisi');
    await expect(f).toContainText('Aucune valeur par défaut : tant qu’il n’est pas saisi, aucune marge n’est calculée.');
    await f.getByLabel('Coût horaire interne HT (en euros)').fill('60');
    coutARemettreAVide = true;
    await f.getByRole('button', { name: 'Enregistrer le coût horaire' }).click();
    await expect(f.getByTestId('cout-horaire-actuel')).toContainText('60,00 € HT par heure', { timeout: 20_000 });
    await alice.goto(url);
    await expect(alice.getByTestId('marge').locator('[data-valeur="cout"]')).toHaveText(/^120,00\s€$/); // 2 h observées × 60 €
    await expect(alice.getByTestId('marge').locator('[data-valeur="marge"]')).toHaveText(/^3\s480,00\s€$/);
    await expect(alice.getByTestId('marge')).toHaveAttribute('data-statut', 'partiel');
  } finally {
    await alice.goto('/administration').catch(() => undefined);
    const remise = await bff<{ coutHoraireInterneHt: string | null }>(alice, 'PUT', 'v1/cabinet/cout-horaire', { coutHoraireInterneHt: null });
    expect(remise.statut).toBe(200);
    expect(remise.json.coutHoraireInterneHt).toBeNull();
    coutARemettreAVide = false;
  }
  await alice.goto(url);
  await expect(alice.getByTestId('marge').getByTestId('non-calculable')).toContainText('Coût horaire interne du cabinet non renseigné');
  await alice.context().close();
});

// Filet de sécurité : si la remise à vide ci-dessus n'a pas pu être confirmée (page fermée, délai dépassé), on la refait
// avec une session neuve. Le coût horaire du cabinet ne doit jamais rester saisi par un test.
test.afterAll(async ({ browser }) => {
  if (!coutARemettreAVide) return;
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  const remise = await bff<{ coutHoraireInterneHt: string | null }>(alice, 'PUT', 'v1/cabinet/cout-horaire', { coutHoraireInterneHt: null });
  await alice.context().close();
  if (remise.statut !== 200 || remise.json.coutHoraireInterneHt !== null) throw new Error('Le coût horaire interne du cabinet n’a pas pu être remis à vide : à corriger à la main (PUT v1/cabinet/cout-horaire avec null).');
});
