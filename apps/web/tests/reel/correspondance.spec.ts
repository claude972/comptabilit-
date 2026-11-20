/**
 * Correspondance comptes 512 / comptes bancaires sur la pile RÉELLE (web 3100, API, worker, Keycloak, base, stockage).
 * Rejouable : chaque exécution crée un dossier neuf, à deux comptes de banque et deux comptes bancaires, avec des
 * données synthétiques. Seule trace laissée dans le cabinet de démonstration : ce dossier et sa règle propre.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type LigneFec, analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique } from '@comtaple/core';
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
async function bff<T = Record<string, unknown>>(page: Page, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: T }> {
  return page.evaluate(
    async ([m, c, d]) => {
      const r = await fetch(`/api/bff/${c}`, { method: m, headers: { ...(m === 'GET' ? {} : { 'X-Comtaple-Csrf': '1' }), ...(d !== null ? { 'Content-Type': 'application/json' } : {}) }, body: d });
      return { statut: r.status, json: await r.json().catch(() => null) };
    },
    [methode, chemin, corps === undefined ? null : JSON.stringify(corps)] as const,
  ) as Promise<{ statut: number; json: T }>;
}

const ALICE_MAIL = 'alice.admin@cabinet-a.test';
const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
const [ALICE, REMI, CHLOE] = ['11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111103'];
const IBAN_A = 'FR7630006000011234567890189';
const IBAN_B = 'FR1420041010050500013M02606';
const SEL = randomBytes(4).toString('hex').toUpperCase();
const graine = Number.parseInt(SEL.slice(0, 6), 16);
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
let dossier = '';
let exercice = '';

test.describe.configure({ mode: 'serial' });

test('préparation : dossier neuf, FEC à deux comptes de banque et deux relevés importés par l’interface', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  const cree = await bff<{ id: string }>(alice, 'POST', 'v1/dossiers', { raisonSociale: `Essai deux banques ${SEL} SARL (fictif)`, territoireFiscal: 'metropole' });
  expect(cree.statut).toBe(201);
  dossier = cree.json.id;
  for (const [utilisateur, niveau] of [[ALICE, 'validation'], [REMI, 'revision'], [CHLOE, 'collaboration']] as const) {
    expect((await bff(alice, 'PUT', `v1/dossiers/${dossier}/habilitations/${utilisateur}`, { niveau })).statut).toBe(200);
  }
  const ex = await bff<{ id: string }>(alice, 'POST', `v1/dossiers/${dossier}/exercices`, EXERCICE);
  expect(ex.statut).toBe(201);
  exercice = ex.json.id;
  await alice.context().close();

  // FEC synthétique (un compte 512) complété d'un virement interne vers un second compte de banque.
  const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 120, graine });
  const virement = (compte: string, libelle: string, debit: string, credit: string) => ['BQ', 'Banque', 'BQVIR001', '20250615', compte, libelle, '', '', 'VIR-INT-1', '20250615', 'Virement interne entre comptes', debit, credit, '', '', '20250615', '', ''].join('\t');
  const contenu = Buffer.from(Buffer.from(fec.contenu).toString('utf8') + `${virement('51210000', 'Banque second compte', '500,00', '0,00')}\r\n${virement('51200000', 'Banque', '0,00', '500,00')}\r\n`, 'utf8');
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(contenu), { surLigne: (l) => void lignes.push(l) });
  const releveA = genererReleveSynthetique({ graine, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 5000, iban: IBAN_A, coherentAvec: lignes.filter((l) => l.compteNum === '51200000') });
  const releveB = genererReleveSynthetique({ graine: graine + 1, format: 'camt.053', debut: '2025-06-01', fin: '2025-06-30', nbMouvements: 5, iban: IBAN_B });

  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/comptabilite`);
  await remi.getByTestId('entree-fec').setInputFiles({ name: fec.nomFichier, mimeType: 'text/plain', buffer: contenu });
  await remi.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
  await remi.getByRole('button', { name: 'Importer' }).click();
  await expect(remi.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 90_000 });
  await remi.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Banque' }).click();
  for (const [i, r] of [releveA, releveB].entries()) {
    await remi.getByTestId('entree-releve').setInputFiles({ name: `releve-${SEL}-${i + 1}.xml`, mimeType: 'application/xml', buffer: Buffer.from(r.contenu, 'utf8') });
    await expect(remi.locator('tr[data-releve]')).toHaveCount(i + 1, { timeout: 90_000 });
  }
  await remi.context().close();
});

test('correspondance : indéterminée, proposée par la collaboratrice sans effet, puis en vigueur une fois approuvée par l’administratrice ; IBAN jamais affiché', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/banque?exercice=${exercice}`);
  await chloe.getByTestId('lien-correspondance').click();
  await expect(chloe.getByRole('heading', { name: 'Correspondance des comptes de banque' })).toBeVisible();
  const etat = chloe.getByTestId('etat-correspondance');
  await expect(etat).toHaveAttribute('data-etat', 'indeterminee');
  await expect(etat).toContainText('Association indéterminée entre 2 compte(s) 512 et 2 compte(s) bancaire(s)');
  for (const compte of ['51200000', '51210000']) {
    await expect(chloe.locator(`tr[data-compte="${compte}"]`)).toHaveAttribute('data-etat', 'non_associe');
    await expect(chloe.locator(`tr[data-compte="${compte}"]`).getByTestId('compte-bancaire')).toHaveText('—');
  }
  await expect(chloe.getByTestId('comptes-bancaires').getByRole('listitem')).toHaveCount(2);
  await expect(chloe.getByTestId('comptes-bancaires')).toContainText('••••••••0189');
  await expect(chloe.getByTestId('comptes-bancaires')).toContainText('••••••••2606');
  for (const iban of [IBAN_A, IBAN_B]) expect(await chloe.content()).not.toContain(iban);

  // Saisie incomplète refusée avant tout envoi, puis proposition complète.
  const formulaire = chloe.locator('form[data-formulaire="correspondance-banque"]');
  await formulaire.getByRole('button', { name: 'Proposer cette correspondance' }).click();
  await expect(formulaire.getByRole('alert')).toContainText('Associez au moins un compte de banque');
  await formulaire.getByLabel(/Compte 51200000/).selectOption({ label: 'Compte bancaire ••••••••0189' });
  await formulaire.getByLabel(/Compte 51210000/).selectOption({ label: 'Compte bancaire ••••••••0189' });
  await formulaire.getByLabel('Motif de cette correspondance').fill('Deux comptes de banque distincts');
  await formulaire.getByRole('button', { name: 'Proposer cette correspondance' }).click();
  await expect(formulaire.getByRole('alert')).toContainText('Un même compte bancaire ne peut pas être associé à deux comptes comptables');
  await formulaire.getByLabel(/Compte 51210000/).selectOption({ label: 'Compte bancaire ••••••••2606' });
  await formulaire.getByRole('button', { name: 'Proposer cette correspondance' }).click();
  await expect(formulaire.getByText('Proposition enregistrée : elle n’a aucun effet tant qu’elle n’est pas approuvée.')).toBeVisible();

  // Sans effet : toujours indéterminée, la proposition est listée avec son auteur.
  const proposition = chloe.getByTestId('propositions-correspondance').locator('[data-proposition]');
  await expect(proposition).toHaveCount(1);
  await expect(proposition).toContainText('par Chloé Collab');
  await expect(proposition).toContainText('impact à mesurer avant approbation');
  await expect(proposition).toContainText('51210000 ↔ ••••••••2606');
  await expect(etat).toHaveAttribute('data-etat', 'indeterminee');
  await expect(chloe.getByTestId('en-vigueur')).toContainText('Aucune règle approuvée');
  const regleId = (await proposition.getAttribute('data-proposition'))!;

  // Circuit des règles (ses écrans sont vérifiés ailleurs) : impact par la collaboratrice, approbation par l'administratrice.
  expect((await bff(chloe, 'POST', `v1/regles/${regleId}/approuver`)).statut).toBe(403);
  const impact = await bff<{ avant: { statut: string }; apres: { statut: string } }>(chloe, 'POST', `v1/regles/${regleId}/impact`, { exerciceId: exercice });
  expect(impact.statut).toBe(200);
  expect(impact.json.avant.statut).toBe('non_realise');
  expect(impact.json.apres.statut).not.toBe('non_realise');
  const alice = await ouvrir(browser, ALICE_MAIL, `/dossiers/${dossier}/banque/correspondance?exercice=${exercice}`);
  // Notification interne : l'administratrice est prévenue dans l'application qu'une correspondance attend sa décision.
  expect(Number(await alice.getByTestId('lien-notifications').getAttribute('data-non-lues'))).toBeGreaterThan(0);
  await alice.getByTestId('lien-notifications').click();
  await expect(alice.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(alice.getByTestId('mention-notifications')).toContainText('rien n’est envoyé par courriel, SMS ou notification sur votre appareil');
  const notification = alice.locator('li[data-type="regle.a_decider"][data-lue="false"]').filter({ hasText: `Essai deux banques ${SEL}` });
  await expect(notification).toHaveCount(1);
  await expect(notification).toContainText('Une correspondance de comptes de banque attend une décision');
  await expect(notification).toContainText('contrôle TRE-003, version 1');
  await expect(notification.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', '/regles');
  await notification.getByRole('button', { name: 'Marquer comme lue' }).click();
  await expect(alice.locator('li[data-type="regle.a_decider"][data-lue="true"]').filter({ hasText: `Essai deux banques ${SEL}` })).toHaveCount(1);
  await alice.goto(`/dossiers/${dossier}/banque/correspondance?exercice=${exercice}`);
  await expect(alice.getByTestId('propositions-correspondance').locator('[data-proposition]')).toContainText('impact mesuré, en attente d’approbation');
  expect((await bff(alice, 'POST', `v1/regles/${regleId}/approuver`)).statut).toBe(200);
  await alice.reload();
  await expect(alice.getByTestId('etat-correspondance')).toHaveAttribute('data-etat', 'determinee');
  await expect(alice.locator('tr[data-compte="51200000"]')).toHaveAttribute('data-etat', 'associe');
  await expect(alice.locator('tr[data-compte="51200000"]').getByTestId('compte-bancaire')).toHaveText('••••••••0189');
  await expect(alice.locator('tr[data-compte="51210000"]').getByTestId('compte-bancaire')).toHaveText('••••••••2606');
  await expect(alice.getByTestId('en-vigueur')).toContainText('Règle approuvée, version 1 (propre à ce dossier)');
  await expect(alice.getByTestId('propositions-correspondance').locator('[data-proposition]')).toHaveCount(0);
  for (const iban of [IBAN_A, IBAN_B]) expect(await alice.content()).not.toContain(iban);
  // L'auteure de la proposition est prévenue de la décision, dans l'application seulement.
  await chloe.goto('/notifications');
  await expect(chloe.locator('li[data-type="regle.decidee"]').filter({ hasText: `Essai deux banques ${SEL}` })).toContainText('Votre proposition de règle a été approuvée');
  // Archivage réversible : la notification de décision est archivée, retrouvée parmi les archivées, puis désarchivée.
  const decision = chloe.locator('li[data-type="regle.decidee"]').filter({ hasText: `Essai deux banques ${SEL}` });
  await decision.getByRole('button', { name: 'Archiver', exact: true }).click();
  await expect(decision).toHaveCount(0);
  await chloe.getByTestId('lien-archivees').click();
  await expect(chloe.getByText('Une notification archivée n’est pas supprimée')).toBeVisible();
  await expect(decision).toHaveCount(1);
  await decision.getByRole('button', { name: 'Désarchiver' }).click();
  await expect(decision).toHaveCount(0);
  await chloe.goto('/notifications');
  await expect(decision).toHaveCount(1);
  // Préférences internes : une famille se désactive puis se réactive (état d'origine rétabli), et le réglage est conservé.
  const preferences = chloe.getByTestId('preferences-notification');
  await expect(preferences.getByRole('checkbox')).toHaveCount(5);
  const imports = preferences.locator('input[data-famille="imports"]');
  const coche = await imports.isChecked();
  await imports.click();
  await expect(preferences.getByText(coche ? 'Notifications désactivées pour cette famille.' : 'Notifications réactivées.')).toBeVisible();
  // Firefox abandonne parfois un rechargement lancé pendant une requête en cours (NS_BINDING_ABORTED, vu en CI) : reprise.
  await expect(async () => {
    await chloe.reload();
  }).toPass({ timeout: 30_000, intervals: [1_000] });
  await expect(chloe.getByTestId('preferences-notification').locator('input[data-famille="imports"]')).toBeChecked({ checked: !coche });
  await chloe.getByTestId('preferences-notification').locator('input[data-famille="imports"]').click();
  await expect(chloe.getByTestId('preferences-notification').getByText(coche ? 'Notifications réactivées.' : 'Notifications désactivées pour cette famille.')).toBeVisible();
  await expect(chloe.getByTestId('preferences-notification')).toContainText('rien n’est envoyé à l’extérieur');
  await alice.context().close();
  await chloe.context().close();
});

test('habilitations : une personne non habilitée sur le dossier n’accède ni à l’écran ni à l’API', async ({ browser }) => {
  // Bruno appartient à un autre cabinet : le dossier n'existe pas pour lui.
  const bruno = await ouvrir(browser, 'bruno.admin@cabinet-b.test', `/dossiers/${dossier}/banque/correspondance?exercice=${exercice}`);
  await expect(bruno.getByTestId('etat-correspondance')).toHaveCount(0);
  expect((await bff(bruno, 'GET', `v1/exercices/${exercice}/correspondance-banque`)).statut).toBe(404);
  expect((await bff(bruno, 'POST', `v1/exercices/${exercice}/correspondance-banque`, { motif: 'Tentative', correspondances: [{ compteNum: '51200000', compteBancaireRef: 'a'.repeat(24) }] })).statut).toBe(404);
  await bruno.context().close();
});
