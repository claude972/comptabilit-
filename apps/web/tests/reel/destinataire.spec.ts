/**
 * Destinataire des pièces (D-091) sur la pile RÉELLE (web 3100, API, worker et son processus enfant isolé, Keycloak, base,
 * stockage) : correction manuelle tracée, puis réanalyse explicite en deux temps (simulation, exécution confirmée).
 * Rejouable : chaque exécution crée un dossier neuf (par l'API, à travers le BFF) et dépose deux factures synthétiques.
 * Les extractions « antérieures à D-084 » sont fabriquées en retirant les clés du destinataire de l'extraction en vigueur
 * des deux pièces de CE dossier (connexion d'administration, comme les parcours d'API) ; rien d'autre n'est modifié.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { genererTexteFactureSynthetique } from '@comtaple/core';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { ordinateur } from './profils';

const RACINE = path.resolve(import.meta.dirname, '../../../..');
function env(): Record<string, string> {
  const fichier = path.join(RACINE, '.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  return Object.fromEntries(readFileSync(fichier, 'utf8').split(/\r?\n/).flatMap((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); return m ? [[m[1]!, m[2]!.replace(/^(['"])(.*)\1$/, '$2')]] : []; }));
}
const motDePasse = () => env().DEV_MDP_UTILISATEURS!;
async function ouvrir(browser: Browser, email: string, destination: string, largeur = 1440): Promise<Page> {
  const contexte = await browser.newContext({ ...ordinateur(browser), viewport: { width: largeur, height: 900 } });
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
/** Empreinte SHA-256 de l'original tel que l'API le sert (lue dans le navigateur, à travers le BFF). */
const empreinteServie = (page: Page, documentId: string) =>
  page.evaluate(async (id) => {
    const r = await fetch(`/api/bff/v1/documents/${id}/contenu`);
    const octets = new Uint8Array(await r.arrayBuffer());
    const h = await crypto.subtle.digest('SHA-256', octets);
    return `${r.status}:${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }, documentId);

const ALICE_MAIL = 'alice.admin@cabinet-a.test';
const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
const CLIENT_MAIL = 'client.depot@client-a.test';
const [ALICE, REMI, CHLOE] = ['11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111103'];
const SEL = randomBytes(4).toString('hex').toUpperCase();
const graine = 4000 + (Number.parseInt(SEL.slice(0, 4), 16) % 5000);
const AVEC = genererTexteFactureSynthetique({ graine, client: 'facture_a' });
const SANS = genererTexteFactureSynthetique({ graine, client: 'absent' });
const SIREN_DOSSIER = AVEC.attendu.emetteurSiren!;
const SIREN_CLIENT = AVEC.attendu.destinataireSiren!;
const SIREN_HUMAIN = '732829320';
const ANNEE = AVEC.attendu.dateEmission!.slice(0, 4);
const NOM_DOSSIER = `Essai destinataire ${SEL} SAS (fictif)`;
const P1 = `vente-client-lisible-${SEL}.pdf`;
const P2 = `vente-sans-client-${SEL}.pdf`;
let dossier = '';
const ids: Record<string, string> = {};

const latin1 = (t: string) =>
  Buffer.from([...t].map((ch) => (ch === '€' ? 0x80 : ch === ' ' || ch === ' ' ? 0x20 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f))).toString('latin1').replace(/[\\()]/g, (m) => `\\${m}`);
/** PDF minimal à couche texte, lu par le vrai processus d'analyse du worker. */
function pdfFacture(client: boolean, numero: string): Buffer {
  const f = client ? AVEC : SANS;
  const lignes = f.pages[0]!.texte.split('\n').map((l) => (f.attendu.numero ? l.replaceAll(f.attendu.numero, numero) : l));
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${latin1(l)}) Tj T*`).join('\n')}\nET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let corps = `%PDF-1.4\n%${SEL}-${numero}\n`;
  const decalages: number[] = [];
  objets.forEach((o, i) => {
    decalages.push(Buffer.byteLength(corps, 'latin1'));
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corps, 'latin1');
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}
/** Retire les clés du destinataire de l'extraction en vigueur : forme exacte des extractions d'avant D-084. */
async function vieillir(documents: string[]): Promise<void> {
  const e = env();
  const pg = createRequire(path.join(RACINE, 'packages/db/package.json'))('pg') as { Client: new (o: { connectionString: string }) => { connect(): Promise<void>; query(t: string, p?: unknown[]): Promise<{ rowCount: number | null }>; end(): Promise<void> } };
  const url = `postgres://${encodeURIComponent(e.PG_ADMIN_USER ?? 'comtaple_admin')}:${encodeURIComponent(e.PG_ADMIN_PASSWORD!)}@${e.PG_HOST ?? '127.0.0.1'}:${e.PG_PORT ?? '5432'}/${e.PG_DATABASE ?? 'comtaple'}`;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(`update extractions set champs = champs - 'destinataireNom' - 'destinataireSiren' - 'destinataireSiret' - 'destinataireTva' - 'destinatairePays' - 'destinataireAbstention' where document_id = any($1::uuid[]) and actuelle`, [documents]);
    expect(r.rowCount).toBe(documents.length);
  } finally {
    await c.end();
  }
}
const ligne = (page: Page, champ: string) => page.getByTestId('bloc-destinataire').locator(`tr[data-champ="${champ}"]`);
const sansDebordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);

test.describe.configure({ mode: 'serial' });

test('préparation : dossier neuf (SIREN = émetteur des ventes), deux factures de vente analysées par le worker, puis ramenées à la forme d’avant D-084', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  const cree = await bff<{ id: string }>(alice, 'POST', 'v1/dossiers', { raisonSociale: NOM_DOSSIER, siren: SIREN_DOSSIER, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  expect(cree.statut).toBe(201);
  dossier = cree.json.id;
  for (const [utilisateur, niveau] of [[ALICE, 'validation'], [REMI, 'revision'], [CHLOE, 'collaboration']] as const) {
    expect((await bff(alice, 'PUT', `v1/dossiers/${dossier}/habilitations/${utilisateur}`, { niveau })).statut).toBe(200);
  }
  expect((await bff(alice, 'POST', `v1/dossiers/${dossier}/exercices`, { debut: `${ANNEE}-01-01`, fin: `${ANNEE}-12-31` })).statut).toBe(201);
  await alice.context().close();

  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}`);
  for (const [nom, client, numero] of [[P1, true, `FA-${ANNEE}-7101`], [P2, false, `FA-${ANNEE}-7102`]] as const) {
    await chloe.getByTestId('entree-pieces').setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: pdfFacture(client, numero) });
    await expect(chloe.getByTestId('liste-envois').getByRole('listitem').filter({ hasText: nom })).toContainText('Reçu', { timeout: 60_000 });
  }
  for (const nom of [P1, P2]) {
    await chloe.goto(`/dossiers/${dossier}`);
    await chloe.getByRole('link', { name: nom }).click();
    await chloe.waitForURL(/\/pieces\/[0-9a-f-]{36}/);
    ids[nom] = /\/pieces\/([0-9a-f-]{36})/.exec(chloe.url())![1]!;
    // Analyse asynchrone (antivirus, lecture du PDF dans le processus enfant) : on recharge jusqu'au statut « À contrôler ».
    await expect(async () => {
      await chloe.reload();
      await expect(chloe.getByTestId('entete-piece')).toContainText('À contrôler', { timeout: 3_000 });
    }).toPass({ timeout: 150_000, intervals: [3_000] });
    // Analyseur actuel : le destinataire est lu (ou l'abstention est dite).
    await expect(chloe.getByTestId('destinataire-non-lu')).toHaveCount(0);
  }
  await expect(async () => {
    await chloe.goto(`/dossiers/${dossier}/pieces/${ids[P1]}`);
    await expect(ligne(chloe, 'destinataireSiren').locator('[data-colonne="retenue"]')).toContainText(SIREN_CLIENT, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await chloe.goto(`/dossiers/${dossier}/pieces/${ids[P2]}`);
  await expect(chloe.getByTestId('destinataire-abstention')).toContainText('Aucun destinataire retenu');
  await chloe.context().close();
  await vieillir([ids[P1]!, ids[P2]!]);
});

test('correction manuelle par le réviseur : motif obligatoire, valeurs côte à côte, historique, sens relu, original intact', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/pieces/${ids[P2]}`);
  const avant = await empreinteServie(remi, ids[P2]!);
  expect(avant).toMatch(/^200:[0-9a-f]{64}$/);
  const empreinteAffichee = (await remi.locator('dd.font-mono').first().innerText()).trim();
  expect(avant.split(':')[1]).toBe(empreinteAffichee);
  await expect(remi.getByTestId('destinataire-non-lu')).toContainText('La lecture automatique du destinataire n’a pas été faite');
  const formulaire = remi.locator('[data-formulaire="destinataire"]');
  await formulaire.getByLabel('SIREN').fill(SIREN_HUMAIN);
  await formulaire.getByLabel('Nom du destinataire').fill('Client Humain SAS');
  await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
  await expect(formulaire.getByLabel('Motif de la correction (obligatoire)')).toBeFocused(); // motif obligatoire
  // Clé de contrôle fausse : refus du serveur, en français, rien d'enregistré.
  await formulaire.getByLabel('SIREN').fill('732829321');
  await formulaire.getByLabel('Motif de la correction (obligatoire)').fill('Client lu sur le bon de commande papier');
  await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
  await expect(remi.getByRole('alert').filter({ hasText: 'SIREN du destinataire' })).toBeVisible();
  await formulaire.getByLabel('SIREN').fill(SIREN_HUMAIN);
  await formulaire.getByRole('button', { name: 'Enregistrer la correction du destinataire' }).click();
  await expect(remi.getByRole('status').filter({ hasText: 'Correction enregistrée' })).toContainText('L’original et les versions précédentes sont conservés');

  const siren = ligne(remi, 'destinataireSiren');
  await expect(siren.locator('[data-colonne="humaine"]')).toContainText(SIREN_HUMAIN);
  await expect(siren.locator('[data-colonne="retenue"]')).toContainText(SIREN_HUMAIN);
  await expect(siren).toContainText('Saisie humaine');
  await expect(siren).toContainText('Par Rémi Réviseur');
  await expect(siren).toContainText('Motif : Client lu sur le bon de commande papier');
  // Le sens relu d'après les identifiants : émetteur = dossier → vente (conforme à la qualification « facture de vente » si elle a été posée).
  await expect(remi.getByTestId('sens-destinataire')).toContainText('Sens de la pièce relu d’après les identifiants');
  const historique = remi.getByTestId('historique-destinataire');
  await historique.locator('summary').click();
  await expect(historique).toContainText('Historique du destinataire (2 versions de l’extraction)');
  await expect(historique).toContainText('par Rémi Réviseur, motif : Client lu sur le bon de commande papier');
  expect(await empreinteServie(remi, ids[P2]!)).toBe(avant);
  expect(await sansDebordement(remi)).toBe(true);
  await remi.context().close();
});

test('réanalyse explicite : aperçu, simulation sans écriture, confirmation, rapport par pièce, correction humaine conservée, idempotence', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}`);
  await remi.getByTestId('lien-reanalyse-destinataire').getByRole('link').click();
  await expect(remi.getByRole('heading', { level: 2, name: 'Réanalyse du destinataire des pièces déjà stockées' })).toBeVisible();
  await expect(remi.getByTestId('nb-concernees')).toHaveText('2'); // P1 (ancienne) et P2 (corrigée à la main, lecture automatique jamais faite)
  await expect(remi.getByTestId('nb-lot')).toContainText('2 (lot unique)');
  const sha1 = await empreinteServie(remi, ids[P1]!);
  const sha2 = await empreinteServie(remi, ids[P2]!);

  const simulation = remi.locator('[data-formulaire="simulation-reanalyse"]');
  await simulation.getByLabel('Motif de la demande (obligatoire)').fill('Relire les anciennes factures avant la révision de clôture');
  await simulation.getByRole('button', { name: 'Lancer la simulation' }).click();
  const rapport = remi.getByTestId('rapport-reanalyse');
  await expect(rapport).toHaveAttribute('data-mode', 'simulation');
  await expect(rapport).toHaveAttribute('data-statut', 'termine', { timeout: 120_000 });
  await expect(remi.getByTestId('resume-reanalyse')).toContainText('2 pièces sur 2 changeraient');
  await expect(remi.getByTestId('resume-reanalyse')).toContainText('Rien n’a été modifié');
  await expect(rapport.locator(`tr[data-resultat="destinataire_trouve"]`)).toHaveCount(1);
  await expect(rapport.locator(`tr[data-resultat="abstention"]`)).toHaveCount(1);
  await expect(rapport.locator(`tr[data-resultat="abstention"]`)).toContainText(P2);
  await expect(remi.getByTestId('desaccord-reanalyse')).toContainText(`saisie humaine ${SIREN_HUMAIN} conservée, lecture automatique (vide)`);
  // Rien n'a été écrit : P1 n'a toujours pas de lecture du destinataire.
  const v = await bff<{ historique: unknown[]; lectureAutomatiqueFaite: boolean }>(remi, 'GET', `v1/documents/${ids[P1]}/destinataire`);
  expect(v.json.historique).toHaveLength(1);
  expect(v.json.lectureAutomatiqueFaite).toBe(false);

  const execution = remi.locator('[data-formulaire="execution-reanalyse"]');
  await execution.getByLabel('Motif de la confirmation (obligatoire)').fill('Aperçu relu, exécution confirmée');
  await execution.getByRole('button', { name: 'Confirmer et exécuter la réanalyse' }).click();
  await expect(remi.getByRole('alert').filter({ hasText: 'Confirmez d’abord avoir lu l’aperçu' })).toBeVisible();
  await execution.getByRole('checkbox', { name: /J’ai lu le rapport de la simulation/ }).check();
  await execution.getByRole('button', { name: 'Confirmer et exécuter la réanalyse' }).click();
  await expect(remi.getByTestId('rapport-reanalyse')).toHaveAttribute('data-mode', 'execution');
  await expect(remi.getByTestId('rapport-reanalyse')).toHaveAttribute('data-statut', 'termine', { timeout: 120_000 });
  await expect(remi.getByTestId('resume-reanalyse')).toContainText('2 nouvelles versions d’extraction créées');
  await expect(remi.getByTestId('rapport-reanalyse')).toContainText('version 1 → 2');
  await expect(remi.getByTestId('rapport-reanalyse')).toContainText('version 2 → 3');

  // P1 : le destinataire est lu par l'analyseur ; l'ancienne version reste dans l'historique ; l'original est inchangé.
  await remi.goto(`/dossiers/${dossier}/pieces/${ids[P1]}`);
  await expect(remi.getByTestId('destinataire-non-lu')).toHaveCount(0);
  await expect(ligne(remi, 'destinataireSiren').locator('[data-colonne="retenue"]')).toContainText(SIREN_CLIENT);
  await expect(ligne(remi, 'destinataireSiren')).toContainText('Lecture automatique');
  await remi.getByTestId('historique-destinataire').locator('summary').click();
  await expect(remi.getByTestId('historique-destinataire')).toContainText('Historique du destinataire (2 versions de l’extraction)');
  expect(await empreinteServie(remi, ids[P1]!)).toBe(sha1);
  // P2 : la correction humaine n'est PAS écrasée ; la lecture automatique (abstention) est mémorisée à côté, désaccord signalé.
  await remi.goto(`/dossiers/${dossier}/pieces/${ids[P2]}`);
  const siren = ligne(remi, 'destinataireSiren');
  await expect(siren.locator('[data-colonne="retenue"]')).toContainText(SIREN_HUMAIN);
  await expect(siren.locator('[data-colonne="humaine"]')).toContainText(SIREN_HUMAIN);
  await expect(remi.getByTestId('desaccord-destinataireSiren')).toBeVisible();
  await expect(siren).toContainText('Motif : Client lu sur le bon de commande papier');
  await expect(remi.getByTestId('destinataire-non-lu')).toHaveCount(0);
  expect(await empreinteServie(remi, ids[P2]!)).toBe(sha2);
  await remi.getByTestId('historique-destinataire').locator('summary').click();
  await expect(remi.getByTestId('historique-destinataire')).toContainText('Historique du destinataire (3 versions de l’extraction)');

  // Idempotence : plus rien à réanalyser ; les deux demandes restent consultables.
  await remi.goto(`/dossiers/${dossier}/reanalyse-destinataire`);
  await expect(remi.getByTestId('rien-a-reanalyser')).toBeVisible();
  await expect(remi.getByTestId('nb-concernees')).toHaveText('0');
  await expect(remi.getByRole('region', { name: 'Demandes de réanalyse du destinataire' }).getByRole('row')).toHaveCount(3);
  const rejeu = await bff(remi, 'POST', `v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Rejeu' });
  expect(rejeu.statut).toBe(409);
  await remi.context().close();
});

test('rôles et écran étroit : collaboratrice sans droit de demande, déposant refusé, aucun débordement à 360 px', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/reanalyse-destinataire`);
  await expect(chloe.getByTestId('apercu-reanalyse')).toBeVisible();
  expect((await bff(chloe, 'POST', `v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Essai' })).statut).toBe(403);
  // Une personne habilitée à corriger peut encore corriger le destinataire (mêmes gardes que les autres champs).
  await chloe.goto(`/dossiers/${dossier}/pieces/${ids[P1]}`);
  await expect(chloe.locator('[data-formulaire="destinataire"]')).toBeVisible();
  await chloe.setViewportSize({ width: 360, height: 780 });
  for (const url of [`/dossiers/${dossier}/pieces/${ids[P1]}`, `/dossiers/${dossier}/pieces/${ids[P2]}`, `/dossiers/${dossier}/reanalyse-destinataire`]) {
    await chloe.goto(url);
    await expect(chloe.getByRole('main')).toBeVisible();
    expect(await sansDebordement(chloe), `débordement sur ${url}`).toBe(true);
  }
  await chloe.context().close();

  const client = await ouvrir(browser, CLIENT_MAIL, `/dossiers/${dossier}/reanalyse-destinataire`);
  await expect(client.getByTestId('apercu-reanalyse')).toHaveCount(0);
  expect((await bff(client, 'GET', `v1/documents/${ids[P1]}/destinataire`)).statut).toBeGreaterThanOrEqual(403);
  expect((await bff(client, 'GET', `v1/dossiers/${dossier}/reanalyse-destinataire`)).statut).toBeGreaterThanOrEqual(403);
  await client.context().close();
});
