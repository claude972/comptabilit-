/**
 * RECETTE D'USAGE (D-172) sur la pile RÉELLE, entièrement par l'INTERFACE : depuis l'écran du dossier, ouvrir la ventilation 2050, saisir et justifier les lignes, constater l'écart,
 * le corriger, décider la reprise dans les cases BN à BS, puis vérifier l'état joint imprimable (PDF produit par le navigateur) et le CSV téléchargé : mêmes montants que l'écran.
 * Aucune décision fiscale ; données synthétiques ; nom du dossier unique à chaque exécution.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { ordinateur } from './profils';

const env = (cle: string): string => {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = new RegExp(`^${cle}=(.*)$`, 'm').exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error(`${cle} absent`);
  return m[1]!.trim();
};
const API = 'http://127.0.0.1:4000';
const jeton = async (email: string): Promise<string> => {
  const r = await fetch(`${env('OIDC_ISSUER')}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env('DEV_MDP_UTILISATEURS'), scope: 'openid' }) });
  return ((await r.json()) as { access_token: string }).access_token;
};

function fec(): Buffer {
  const L: string[] = [];
  let n = 0;
  const e = (j: string, date: string, lignes: Array<[string, string, number, number]>, lib: string) => {
    n++;
    for (const [c, cl, d, k] of lignes) L.push([j, j, String(n).padStart(4, '0'), date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t'));
  };
  e('AN', '20250101', [['512000', 'Banque', 1000, 0], ['331000', 'En-cours de production de biens', 700, 0], ['341000', 'En-cours de production de services', 300, 0], ['351000', 'Produits finis', 500, 0], ['393000', 'Dépréciation des en-cours', 0, 100], ['101000', 'Capital', 0, 2400]], 'À-nouveaux');
  e('VT', '20250630', [['411000', 'Clients', 100, 0], ['706000', 'Prestations de services', 0, 100]], 'Ventes');
  return Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\n' + L.join('\n') + '\n', 'utf8');
}

test('ventilation 2050 par l’interface : saisir et justifier, retenir la reprise, état joint imprimable et CSV concordants', async ({ browser }) => {
  const t = await jeton('alice.admin@cabinet-a.test');
  const api = async (methode: string, chemin: string, corps?: unknown) => {
    const bin = Buffer.isBuffer(corps);
    const r = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${t}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps as Buffer) : JSON.stringify(corps) });
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { statut: r.status, json, texte };
  };
  const dossier = (await api('POST', '/v1/dossiers', { raisonSociale: `Atelier ventilation 2050 ${Date.now()} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, niveau] of [['11111111-1111-4111-8111-111111111101', 'validation'], ['11111111-1111-4111-8111-111111111102', 'revision']]) await api('PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau });
  const exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id as string;
  const contenu = fec();
  const o = await api('POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  expect(o.statut).toBe(201);
  let dec = o.json.octetsRecus as number;
  while (dec < contenu.length) dec = (await api('PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('POST', `/v1/televersements/${o.json.id}/terminer`);
  await expect.poll(async () => (await api('GET', `/v1/imports/${fin.json.lotImportId}`)).json?.statut, { timeout: 120_000 }).toBe('termine');

  const contexte = await browser.newContext({ ...ordinateur(browser), acceptDownloads: true });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${dossier}/fiscal?vue=liasse`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(env('DEV_MDP_UTILISATEURS'));
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.waitForLoadState('networkidle');
  await page.goto(`/dossiers/${dossier}/fiscal?vue=liasse`);

  // 1. La ventilation est ouverte depuis l'écran du dossier ; sans saisie, la reprise est en abstention.
  const grille = page.getByTestId('grille-2050-STOCKS');
  await expect(grille).toBeVisible();
  await expect(page.getByTestId('reprise-2050-stocks')).toHaveAttribute('data-etat', 'aucune_decision');
  await expect(page.locator('[data-testid="reprise-2050-stocks"] [data-case="BN"]')).toContainText('abstention');

  // 2. Saisie et justification de chaque ligne par le formulaire de l'écran.
  const saisir = async (ligne: string, champs: Record<string, string>, note: string) => {
    const f = page.getByTestId(`saisie-2050_STOCKS-${ligne}`);
    for (const [libelle, valeur] of Object.entries(champs)) {
      const champ = f.getByLabel(libelle, { exact: true });
      if ((await champ.evaluate((x) => x.tagName)) === 'SELECT') await champ.selectOption(valeur);
      else await champ.fill(valeur);
    }
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: /^Enregistrer/ }).click();
    await expect(f.getByText(/enregistr|Saisie/i).first()).toBeVisible();
  };
  await saisir('ECB', { Brut: '700.00', 'Amortissements et provisions': '100.00' }, 'Ventilation d’après le dossier de production (fictif)');
  await saisir('ECS', { Brut: '300.00', 'Amortissements et provisions': '0.00' }, 'Ventilation d’après les prestations en cours (fictif)');
  await saisir('PIF', { Brut: '450.00', 'Amortissements et provisions': '0.00' }, 'Inventaire des produits finis du 31/12 (fictif)');
  await page.reload();
  await page.waitForLoadState('networkidle');

  // 3. Les rapprochements disent l'écart sur les produits (450 contre 500) et rien n'est corrigé.
  await expect(grille).toContainText(/450\.00 ici contre 500\.00|écart/i);
  await expect(page.getByTestId('reprise-2050-stocks')).toHaveAttribute('data-etat', 'aucune_decision');

  // 4. Décision de reprise par l'écran : les en-cours sont retenus, les produits restent en abstention (écart).
  await saisir('REPRISE', { 'Reprise décidée': 'oui' }, 'Reprise décidée après relecture de la ventilation (fictif)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  const reprise = page.getByTestId('reprise-2050-stocks');
  await expect(reprise).toHaveAttribute('data-etat', 'decidee');
  // À l'écran les montants sont au format français (700,00) ; l'état joint, le CSV et le PDF portent les montants exacts de l'API (700.00) : mêmes valeurs.
  await expect(reprise.locator('[data-case="BN"]')).toContainText(/700[,.]00/);
  await expect(reprise.locator('[data-case="BP"]')).toContainText(/300[,.]00/);
  await expect(reprise.locator('[data-case="BR"]')).toContainText('abstention');
  await expect(page.getByTestId('reprise-2050-total')).toContainText(/1\s?000[,.]00/);

  // 5. Correction de la ligne des produits (500) : la case BR est retenue ; rien n'a été réécrit ni écrasé par le logiciel.
  await saisir('PIF', { Brut: '500.00', 'Amortissements et provisions': '0.00' }, 'Inventaire corrigé après recomptage (fictif)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('reprise-2050-stocks').locator('[data-case="BR"]')).toContainText(/500[,.]00/);

  // 6. État joint : mêmes montants ; CSV téléchargé ; PDF produit par le navigateur (rendu d'impression).
  await page.getByTestId('lien-etat-joint').click();
  await page.waitForURL(/\/fiscal\/etat-joint/);
  const joint = page.locator('[data-tableau-joint="liasse-2050-STOCKS-REPRISE"]');
  await expect(joint).toContainText('700.00');
  await expect(joint).toContainText('300.00');
  await expect(joint).toContainText('500.00');
  const lien = page.getByTestId('export-csv-etat-joint');
  const csv = decodeURIComponent((await lien.getAttribute('href'))!.replace('data:text/csv;charset=utf-8,', ''));
  const bloc = csv.split('\n').filter((l) => /;(BN|BO|BP|BQ|BR|BS);/.test(l));
  expect(bloc.map((l) => l.trim().split(';').slice(-2).join(';'))).toEqual(['BN;700.00', 'BO;100.00', 'BP;300.00', 'BQ;0.00', 'BR;500.00', 'BS;0.00']);
  expect(csv).toContain('2050-STOCKS');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
  const { getDocument } = await import(path.resolve(import.meta.dirname, '../../../../node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  let texte = '';
  for (let i = 1; i <= doc.numPages; i++) texte += ((await (await doc.getPage(i)).getTextContent()).items as Array<{ str: string }>).map((x) => x.str).join(' ') + '\n';
  expect(texte).toMatch(/cases BN à BS retenues/);
  for (const m of ['700.00', '300.00', '500.00']) expect(texte, `PDF : ${m}`).toContain(m);
  expect(texte).toMatch(/PROJET, non validé/);
  await contexte.close();
});
