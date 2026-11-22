/**
 * Tiers et factures : tolérance de montant et règlement groupé probable (D-096) sur la pile RÉELLE (web 3100, API, worker,
 * Keycloak, base, stockage, antivirus). Rejouable : chaque exécution crée UN dossier neuf (par l'API, à travers le BFF) et
 * n'utilise que des données synthétiques (écritures et factures écrites ici). Aucune IA, aucune dépense, aucune banque.
 * Données partagées : aucune habilitation existante n'est retirée ; le réglage de tolérance n'est posé que sur le dossier créé ici.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { genererTexteFactureSynthetique } from '@comtaple/core';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './base';
import { PDFDocument, StandardFonts } from 'pdf-lib';
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
/** Appel de l'API réelle à travers le BFF de l'application (même origine, en-tête CSRF). */
async function bff<T = Record<string, unknown>>(page: Page, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: T }> {
  return page.evaluate(
    async ([m, c, d]) => {
      const r = await fetch(`/api/bff/${c}`, { method: m, headers: { ...(m === 'GET' ? {} : { 'X-Comtaple-Csrf': '1' }), ...(d !== null ? { 'Content-Type': 'application/json' } : {}) }, body: d });
      return { statut: r.status, json: await r.json().catch(() => null) };
    },
    [methode, chemin, corps === undefined ? null : JSON.stringify(corps)] as const,
  ) as Promise<{ statut: number; json: T }>;
}
/** Dépôt d'un PDF par l'API de téléversement (ouverture, morceaux, clôture), à travers le BFF. */
async function deposerPdf(page: Page, dossier: string, nom: string, octets: Buffer): Promise<string> {
  const sha = createHash('sha256').update(octets).digest('hex');
  const o = await bff<{ id: string; tailleMorceau: number; octetsRecus: number }>(page, 'POST', 'v1/televersements', { entiteId: dossier, nomFichier: nom, taille: octets.length, sha256: sha, canal: 'ordinateur', nature: 'facture_achat' });
  expect(o.statut).toBe(201);
  const base64 = octets.toString('base64');
  const m = await page.evaluate(
    async ([id, b64]) => {
      const bin = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const r = await fetch(`/api/bff/v1/televersements/${id}/morceaux?decalage=0`, { method: 'PUT', headers: { 'X-Comtaple-Csrf': '1', 'Content-Type': 'application/octet-stream' }, body: bin });
      return r.status;
    },
    [o.json.id, base64] as const,
  );
  expect(m).toBe(200);
  const f = await bff<{ documentId: string }>(page, 'POST', `v1/televersements/${o.json.id}/terminer`);
  expect(f.statut).toBe(200);
  return f.json.documentId;
}

const SEL = randomBytes(4).toString('hex').toUpperCase();
const NOM_DOSSIER = `Essai tolérance ${SEL} SAS (fictif)`;
const ALICE_MAIL = 'alice.admin@cabinet-a.test';
const REMI_MAIL = 'remi.reviseur@cabinet-a.test';
const CHLOE_MAIL = 'chloe.collab@cabinet-a.test';
const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';
const CHLOE = '11111111-1111-4111-8111-111111111103';
const F = ' '; // espace fine insécable des montants
let dossier = '';

// ── Données synthétiques : factures PDF et FEC ──
const baseA = genererTexteFactureSynthetique({ graine: 101 });
const baseB = genererTexteFactureSynthetique({ graine: 202 });
const A = { nom: baseA.attendu.emetteurNom!, siren: baseA.attendu.emetteurSiren!, entete: baseA.pages[0]!.texte.split('\n').slice(0, 10) };
const B = { nom: baseB.attendu.emetteurNom!, siren: baseB.attendu.emetteurSiren!, entete: baseB.pages[0]!.texte.split('\n').slice(0, 10) };
const fr = (iso: string) => iso.split('-').reverse().join('/');
const mfr = (v: string) => v.replace('.', ',');
function texteFacture(e: typeof A, o: { numero: string; date: string; echeance: string; ht: string }): string[] {
  const ht = Number(o.ht) * 100;
  const tva = Math.round(ht * 0.2);
  const m = (c: number) => mfr((c / 100).toFixed(2));
  return [
    ...e.entete, `FACTURE N° ${o.numero}`, `Date de facture : ${fr(o.date)}`, `Date d'échéance : ${fr(o.echeance)}`, '', 'Désignation                 Montant HT', `Prestation de service       ${m(ht)}`, '',
    `Total HT : ${m(ht)} €`, `TVA 20 % sur ${m(ht)} : ${m(tva)}`, `Total TVA : ${m(tva)} €`, `Total TTC : ${m(ht + tva)} €`,
  ];
}
async function pdf(lignes: string[], marque: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const police = await doc.embedFont(StandardFonts.Helvetica);
  [...lignes, `Référence d’essai ${marque}`].forEach((l, i) => page.drawText(l.replace(/[   ]/g, ' ').replace(/[^ -ÿ€’]/g, '?'), { x: 50, y: 800 - 14 * i, size: 10, font: police }));
  return Buffer.from(await doc.save());
}
const PIECES = [
  { nom: `b1-${SEL}.pdf`, qui: B, o: { numero: 'FB-2026-001', date: '2026-03-01', echeance: '2026-03-31', ht: '100.00' } },
  { nom: `b2-${SEL}.pdf`, qui: B, o: { numero: 'FB-2026-002', date: '2026-03-05', echeance: '2026-04-05', ht: '250.00' } },
  { nom: `b3-${SEL}.pdf`, qui: B, o: { numero: 'FB-2026-003', date: '2026-03-10', echeance: '2026-04-10', ht: '400.00' } },
  { nom: `a1-${SEL}.pdf`, qui: A, o: { numero: 'FA-A-001', date: '2026-02-10', echeance: '2026-03-12', ht: '1000.00' } },
];
const ttcDe = (ht: string) => (Number(ht) * 1.2).toFixed(2);
const tvaDe = (ht: string) => (Number(ht) * 0.2).toFixed(2);
const lignesFec: string[] = [['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t')];
const compteurs: Record<string, number> = {};
function ecriture(journal: string, date: string, piece: string, lib: string, lignes: Array<{ compte: string; aux?: [string, string]; debit?: string; credit?: string }>): void {
  compteurs[journal] = (compteurs[journal] ?? 0) + 1;
  const num = `${journal}${String(compteurs[journal]).padStart(4, '0')}`;
  const d = date.replaceAll('-', '');
  for (const l of lignes) lignesFec.push([journal, journal, num, d, l.compte, `Compte ${l.compte}`, l.aux?.[0] ?? '', l.aux?.[1] ?? '', piece, d, lib, mfr(l.debit ?? '0.00'), mfr(l.credit ?? '0.00'), '', '', d, '', ''].join('\t'));
}
const achat = (aux: [string, string], date: string, piece: string, ht: string) => ecriture('ACH', date, piece, `Facture ${aux[1]}`, [{ compte: '606100', debit: ht }, { compte: '445660', debit: tvaDe(ht) }, { compte: '401000', aux, credit: ttcDe(ht) }]);
const paiement = (aux: [string, string], date: string, montant: string, lib: string) => ecriture('BQ', date, 'VIR', lib, [{ compte: '401000', aux, debit: montant }, { compte: '512000', credit: montant }]);
const FA: [string, string] = ['FA001', A.nom];
const FB: [string, string] = [`F${B.siren}`, 'Fournisseur B (fictif)'];
achat(FB, '2026-03-01', 'FB-2026-001', '100.00');
achat(FB, '2026-03-05', 'FB-2026-002', '250.00');
achat(FB, '2026-03-10', 'FB-2026-003', '400.00');
paiement(FB, '2026-04-20', '600.00', 'Virement fournisseur B'); // 120,00 + 480,00 : seule combinaison
achat(FA, '2026-02-10', 'FA-A-001', '1000.00');
paiement(FA, '2026-03-05', '1195.00', 'Virement fournisseur A'); // 5,00 de moins que la facture
const FEC = Buffer.from(`${lignesFec.join('\r\n')}\r\n`, 'utf8');

test.describe.configure({ mode: 'serial' });

test('préparation : dossier neuf, habilitations (révision, collaboration), exercice, quatre factures déposées, FEC importé', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration');
  const cree = await bff<{ id: string }>(alice, 'POST', 'v1/dossiers', { raisonSociale: NOM_DOSSIER, siren: '123456782', territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  expect(cree.statut).toBe(201);
  dossier = cree.json.id;
  for (const [utilisateur, niveau] of [[ALICE, 'validation'], [REMI, 'revision'], [CHLOE, 'collaboration']] as const) {
    expect((await bff(alice, 'PUT', `v1/dossiers/${dossier}/habilitations/${utilisateur}`, { niveau })).statut).toBe(200);
  }
  expect((await bff(alice, 'POST', `v1/dossiers/${dossier}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' })).statut).toBe(201);
  await alice.context().close();

  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}`);
  const documents: string[] = [];
  for (const p of PIECES) documents.push(await deposerPdf(chloe, dossier, p.nom, await pdf(texteFacture(p.qui, p.o), `${SEL}-${p.nom}`)));
  for (const id of documents) {
    await expect(async () => {
      const d = await bff<{ document: { statut: string } }>(chloe, 'GET', `v1/documents/${id}`);
      expect(['recu', 'en_analyse']).not.toContain(d.json.document.statut);
    }).toPass({ timeout: 150_000, intervals: [2_000] });
  }
  await chloe.goto(`/dossiers/${dossier}/comptabilite`);
  await chloe.getByTestId('entree-fec').setInputFiles({ name: `123456782FEC20261231-${SEL}.txt`, mimeType: 'text/plain', buffer: FEC });
  await chloe.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
  await chloe.getByRole('button', { name: 'Importer' }).click();
  await expect(chloe.getByTestId('rapport-import').locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 120_000 });
  await chloe.context().close();
});

test('réviseur : sans réglage, aucune tolérance ; le règlement groupé est PROPOSÉ « à confirmer », rien n’est lettré ; puis la tolérance réglée propose l’écart', async ({ browser }) => {
  const remi = await ouvrir(browser, REMI_MAIL, `/dossiers/${dossier}/tiers?vue=a-traiter`);
  await expect(remi.getByTestId('tolerance-en-vigueur')).toContainText('aucun réglage : aucune tolérance');
  await expect(remi.getByTestId('tolerance-en-vigueur')).toContainText('strictement égaux');
  const groupe = remi.getByTestId('reglements-groupes').locator('li').first();
  await expect(groupe).toContainText('Règlement groupé probable');
  await expect(groupe).toContainText('À confirmer');
  await expect(groupe).toContainText('Facture FB-2026-001');
  await expect(groupe).toContainText('Facture FB-2026-003');
  await expect(groupe).not.toContainText('Facture FB-2026-002');
  await expect(groupe).toContainText(`Somme exacte : 600,00`);
  await expect(groupe).toContainText('Rien n’est lettré ni imputé');

  // Réglage explicite : 5 euros, motif obligatoire.
  await remi.getByRole('navigation', { name: 'Tiers et factures' }).getByRole('link', { name: 'Réglages' }).click();
  await expect(remi.getByTestId('tolerance-courante')).toContainText('aucun réglage : aucune tolérance');
  const enregistrer = remi.getByRole('button', { name: 'Enregistrer la tolérance' });
  await remi.getByLabel(/Tolérance de montant, en euros/).fill('5');
  await expect(enregistrer).toBeDisabled();
  await remi.getByLabel('Motif (obligatoire)').fill('Escomptes de règlement habituels du fournisseur A');
  await enregistrer.click();
  await expect(remi.getByTestId('tolerance-courante')).toContainText('5,00', { timeout: 20_000 });
  await expect(remi.getByTestId('tolerance-courante')).toContainText('réglage du dossier');
  await expect(remi.getByTestId('reglages-tolerance')).toContainText('Escomptes de règlement habituels du fournisseur A');

  // L'écart est proposé, chiffré, à confirmer ; la facture n'est ni réglée ni imputée (reste dû inchangé).
  await remi.goto(`/dossiers/${dossier}/tiers?vue=echeancier`);
  await remi.getByTestId('ligne-facture').filter({ hasText: 'FA-A-001' }).getByRole('link').first().click();
  const propositions = remi.getByTestId('propositions-imputation');
  await expect(propositions).toContainText('Écart de −5,00');
  await expect(propositions).toContainText('dans la tolérance réglée de 5,00');
  await expect(propositions).toContainText('Proposition seulement');
  await expect(remi.getByTestId('reste-du')).toHaveText(`1${F}200,00`);
  await expect(remi.getByTestId('detail-facture')).toContainText('Règlements proposés, à confirmer (non comptés)');
  await remi.context().close();
});

test('collaboratrice : confirme la proposition d’écart — la facture devient « partiellement réglée » et les 5,00 restent visibles ; ne peut pas régler la tolérance', async ({ browser }) => {
  const chloe = await ouvrir(browser, CHLOE_MAIL, `/dossiers/${dossier}/tiers?vue=echeancier`);
  await chloe.getByTestId('ligne-facture').filter({ hasText: 'FA-A-001' }).getByRole('link').first().click();
  await chloe.getByTestId('propositions-imputation').getByRole('button', { name: /Confirmer ce règlement/ }).click();
  await expect(chloe.getByTestId('detail-facture')).toContainText('Partiellement réglée', { timeout: 20_000 });
  await expect(chloe.getByTestId('reste-du')).toHaveText('5,00');
  // Réglages : lecture seule pour elle, route refusée.
  await chloe.goto(`/dossiers/${dossier}/tiers?vue=reglages`);
  await expect(chloe.getByText('Régler la tolérance est réservé au niveau « révision » sur ce dossier.')).toBeVisible();
  await expect(chloe.getByRole('button', { name: 'Enregistrer la tolérance' })).toHaveCount(0);
  expect((await bff(chloe, 'PUT', `v1/dossiers/${dossier}/tiers-factures/reglages`, { toleranceMontant: '9.00', motif: 'tentative' })).statut).toBe(403);
  // Écran étroit : aucune vue ne déborde.
  await chloe.setViewportSize({ width: 360, height: 780 });
  for (const vue of ['a-traiter', 'reglages', 'echeancier']) {
    await chloe.goto(`/dossiers/${dossier}/tiers?vue=${vue}`);
    await expect(chloe.getByTestId('tolerance-en-vigueur').or(chloe.getByTestId('tolerance-courante'))).toBeVisible();
    expect(await chloe.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `débordement sur ${vue}`).toBe(true);
  }
  await chloe.context().close();
});

test('IA : sans fournisseur, aucune alerte d’expiration ; la famille de notification « ia » est réglable par un administrateur', async ({ browser }) => {
  const alice = await ouvrir(browser, ALICE_MAIL, '/administration/ia');
  await expect(alice.getByTestId('statut-passerelle')).toBeVisible();
  await expect(alice.getByTestId('expiration-preuve')).toHaveCount(0);
  await expect(alice.getByTestId('alerte-expiration-preuve')).toHaveCount(0);
  const api = await bff<{ verification: { expiration: unknown; verificationId: unknown } }>(alice, 'GET', 'v1/ia');
  expect(api.statut).toBe(200);
  expect(api.json.verification.expiration).toBeNull();
  await alice.goto('/notifications');
  await expect(alice.locator('[data-famille="ia"]')).toBeVisible();
  await alice.context().close();
});
