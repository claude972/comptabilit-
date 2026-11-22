#!/usr/bin/env node
/**
 * Parcours de bout en bout sur un dossier FICTIF cohérent, immobilisations et amortissements NON NULS (D-148), contre la pile locale démarrée
 * (API 4000, worker, web 3100). Crée un dossier fictif, importe son FEC (écritures d'ouverture, acquisition, dotations), importe le fichier
 * des immobilisations en XLSX (aperçu sans écriture, puis validation confirmée), lit la liasse par l'API, puis ouvre l'état joint dans un navigateur
 * réel : tableau à l'écran, PDF A4 paysage, CSV ; et vérifie que les cellules de l'API, de l'écran, du CSV et du PDF CONCORDENT.
 *   node scripts/demo-parcours-immobilisations.mjs [dossierId exerciceId]   (sans argument : crée un nouveau dossier fictif)
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const env = {};
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); }
const API = 'http://127.0.0.1:4000';
const WEB = 'http://localhost:3100';
const sortie = join(racine, 'var/captures/');
mkdirSync(sortie, { recursive: true });
const REGIME = process.env.REGIME ?? 'reel_normal';
const DOTATION_NOUVEAU = process.env.DOTATION_NOUVEAU ?? '0.00';

const jeton = async (email) => (await (await fetch(`${env.OIDC_ISSUER}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env.DEV_MDP_UTILISATEURS, scope: 'openid' }) })).json()).access_token;
const T = { alice: await jeton('alice.admin@cabinet-a.test'), remi: await jeton('remi.reviseur@cabinet-a.test') };
async function api(qui, methode, chemin, corps) {
  const bin = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${T[qui]}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps) : JSON.stringify(corps) });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch {}
  return { statut: r.status, json, texte: t };
}
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'ÉCHEC '} ${m}`); if (!c) process.exitCode = 1; };

// ── FEC fictif cohérent (tabulations, UTF-8) : ouverture, une acquisition, dotations, un produit et une charge ──
function fec() {
  const L = [];
  let n = 0;
  const e = (j, jl, date, lignes, lib) => { n++; for (const [c, cl, d, k] of lignes) L.push([j, jl, String(n).padStart(4, '0'), date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t')); };
  e('AN', 'À nouveaux', '20250101', [
    ['211000', 'Terrains', 50000, 0], ['213000', 'Constructions', 80000, 0], ['218200', 'Matériel de transport', 30000, 0], ['218300', 'Matériel de bureau et informatique', 12000, 0],
    ['281300', 'Amortissements des constructions', 0, 40000], ['281820', 'Amortissements du matériel de transport', 0, 18000], ['281830', 'Amortissements du matériel informatique', 0, 8000],
    ['101000', 'Capital', 0, 200000], ['512000', 'Banque', 94000, 0]], 'À-nouveaux');
  e('AC', 'Achats', '20250320', [['218300', 'Matériel de bureau et informatique', 5000, 0], ['512000', 'Banque', 0, 5000]], 'Poste de travail');
  e('VT', 'Ventes', '20250630', [['512000', 'Banque', 40000, 0], ['706000', 'Prestations de services', 0, 40000]], 'Prestations');
  e('AC', 'Achats', '20250930', [['622600', 'Honoraires', 15000, 0], ['512000', 'Banque', 0, 15000]], 'Honoraires');
  const dotMat = (4000 + 6000 + 4000 + Number(DOTATION_NOUVEAU));
  e('OD', 'Opérations diverses', '20251231', [['681120', 'Dotations aux amortissements', dotMat, 0], ['281300', 'Amortissements des constructions', 0, 4000], ['281820', 'Amortissements du matériel de transport', 0, 6000], ['281830', 'Amortissements du matériel informatique', 0, 4000 + Number(DOTATION_NOUVEAU)]], 'Dotations de l’exercice');
  return Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\r\n' + L.join('\r\n') + '\r\n', 'utf8');
}

// ── Classeur XLSX fictif (mêmes pièces minimales que les essais de la pile) ──
function zip(parties) {
  const locaux = [], centraux = []; let decalage = 0;
  for (const [nom, contenu] of Object.entries(parties)) {
    const brut = Buffer.from(contenu, 'utf8'), donnees = deflateRawSync(brut), nomB = Buffer.from(nom), crc = crc32(brut);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(donnees.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nomB.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(donnees.length, 20); central.writeUInt32LE(brut.length, 24); central.writeUInt16LE(nomB.length, 28); central.writeUInt32LE(decalage, 42);
    locaux.push(local, nomB, donnees); centraux.push(central, nomB); decalage += 30 + nomB.length + donnees.length;
  }
  const rep = Buffer.concat(centraux), fin = Buffer.alloc(22), n = Object.keys(parties).length;
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(n, 8); fin.writeUInt16LE(n, 10); fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, rep, fin]);
}
function classeur() {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const enTetes = ['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (mois)'];
  const biens = [['Atelier (construction)', 213000, 80000, 42005, 240], ['Camionnette', 218200, 30000, 44562, 60], ['Serveurs', 218300, 12000, 44927, 36], ['Poste de travail', 218300, 5000, 45736, 36]];
  const chaines = [...enTetes, ...biens.map((b) => b[0])];
  const lignes = biens.map((b, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="s"><v>${5 + i}</v></c><c r="B${i + 2}"><v>${b[1]}</v></c><c r="C${i + 2}"><v>${b[2]}</v></c><c r="D${i + 2}" s="1"><v>${b[3]}</v></c><c r="E${i + 2}"><v>${b[4]}</v></c></row>`).join('');
  return zip({
    'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Immo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst ${NS}>${chaines.map((c) => `<si><t>${c}</t></si>`).join('')}</sst>`,
    'xl/styles.xml': `<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1">${[0, 1, 2, 3, 4].map((i) => `<c r="${'ABCDE'[i]}1" t="s"><v>${i}</v></c>`).join('')}</row>${lignes}</sheetData></worksheet>`,
  });
}

const { chromium, devices } = createRequire(join(racine, 'apps/web/package.json'))('@playwright/test');
async function session(urlCible) {
  const nav = await chromium.launch();
  const page = await (await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(urlCible);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('alice.admin@cabinet-a.test');
  await page.locator('#password').fill(env.DEV_MDP_UTILISATEURS);
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.goto(urlCible);
  return { nav, page };
}

let [dossier, exercice] = process.argv.slice(2);
if (!dossier) {
  const cr = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: 'Atelier Démo Immobilisations SAS (fictive, dotations concordantes)', territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
  dossier = cr.json?.id;
  // Habilitations du dossier fictif : comme pour les dossiers de démonstration (validation, révision).
  for (const [u, niveau] of [['11111111-1111-4111-8111-111111111101', 'validation'], ['11111111-1111-4111-8111-111111111102', 'revision']]) ok((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut < 300, `habilitation ${niveau}`);
  ok(!!dossier, `dossier fictif créé : ${dossier}`);
  exercice = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  const contenu = fec();
  const sha = createHash('sha256').update(contenu).digest('hex');
  const o = await api('alice', 'POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: sha, canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  ok(o.statut === 201, `dépôt du FEC : ${o.statut} ${o.statut !== 201 ? o.texte.slice(0, 400) : ''}`);
  let dec = o.json.octetsRecus;
  while (dec < contenu.length) dec = (await api('alice', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('alice', 'POST', `/v1/televersements/${o.json.id}/terminer`);
  let lot;
  for (let i = 0; i < 120; i++) { lot = (await api('alice', 'GET', `/v1/imports/${fin.json.lotImportId}`)).json; if (['termine', 'termine_avec_erreurs', 'echec'].includes(lot?.statut)) break; await new Promise((r) => setTimeout(r, 500)); }
  ok(lot?.statut === 'termine', `import du FEC : ${lot?.statut}`);
  // Import XLSX par l'INTERFACE (navigateur réel) : aperçu sans écriture, confirmation explicite, rapport.
  const xl = classeur();
  const { nav: navImport, page: pageImport } = await session(`${WEB}/dossiers/${dossier}/inventaire/reprise`);
  const avantImport = (await api('alice', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json;
  await pageImport.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles({ name: 'immobilisations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xl });
  await pageImport.getByTestId('apercu-reprise').waitFor();
  const decomptes = await pageImport.getByTestId('decomptes-apercu').innerText();
  ok(/Valides : 4/.test(decomptes) && /Classeur XLSX/.test(await pageImport.getByTestId('classeur-xlsx').innerText()), `aperçu dans l'interface : ${decomptes.replace(/\s+/g, ' ')}`);
  const apresApercu = (await api('alice', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json;
  ok(JSON.stringify(apresApercu) === JSON.stringify(avantImport), 'l\u2019aperçu n\u2019a rien écrit dans le fichier des immobilisations');
  await pageImport.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
  await pageImport.getByRole('button', { name: /Valider l’import de 4 immobilisations/ }).click();
  await pageImport.getByTestId('rapport-reprise').waitFor();
  const rapport = await pageImport.getByTestId('decomptes-reprise').innerText();
  ok(/Créées : 4/.test(rapport), `import validé dans l'interface : ${rapport.replace(/\s+/g, ' ')}`);
  await pageImport.screenshot({ path: `${sortie}parcours-immo-import-xlsx.png` });
  await navImport.close();
}
const liasse = (await api('alice', 'GET', `/v1/exercices/${exercice}/liasse?regime=${REGIME}`)).json;
writeFileSync(`${sortie}parcours-immo-liasse-${REGIME}.json`, JSON.stringify(liasse.tableauxImmobilisations, null, 1));
const t = liasse.tableauxImmobilisations;
ok(t?.statut === 'projet', `liasse : tableauxImmobilisations ${t?.statut}`);
for (const tab of t.tableaux) for (const c of tab.cadres) {
  console.log(`\n== ${tab.code} ${c.id} : ${c.colonnes.map((x) => x.cle).join(' | ')}`);
  for (const l of c.lignes) console.log(`  ${l.libelle.slice(0, 40).padEnd(40)} ${c.colonnes.map((x) => { const v = l.cellules[x.cle]; return v ? (v.statut === 'etabli' ? v.montant : v.statut === 'abstention' ? 'ABST' : '·') : '—'; }).join(' | ')}`);
}

// ── Navigateur réel : état joint à l'écran, CSV, PDF ; concordance avec les valeurs de l'API ──
const url = `${WEB}/dossiers/${dossier}/fiscal/etat-joint?exercice=${exercice}&regime=${REGIME}`;
const { nav, page } = await session(url);
await page.getByTestId('etat-joint').waitFor();
await page.screenshot({ path: `${sortie}parcours-immo-etat-joint.png` });
// Attendu, déduit de la réponse de l'API seule : montant établi, vide si à saisir, motif si abstention.
const attendu = (v) => (v === undefined ? '—' : v.statut === 'etabli' ? (v.montant ?? '') : v.statut === 'abstention' ? `abstention : ${v.motif ?? ''}` : '');
let nbCellules = 0, nbNonNulles = 0, ecarts = 0;
const montantsAttendus = new Set();
for (const tab of t.tableaux) for (const c of tab.cadres) {
  const sec = page.locator(`[data-tableau-joint="${tab.code}/${c.id}"]`);
  ok((await sec.count()) === 1, `écran : tableau ${tab.code}/${c.id} présent`);
  const lignes = sec.locator('tbody tr');
  ok((await lignes.count()) === c.lignes.length, `écran : ${tab.code}/${c.id} : ${c.lignes.length} lignes`);
  for (let i = 0; i < c.lignes.length; i++) {
    const cellules = await lignes.nth(i).locator('td').allInnerTexts();
    c.colonnes.forEach((col, j) => {
      const a = attendu(c.lignes[i].cellules[col.cle]);
      nbCellules++;
      if (cellules[j + 2] !== a) { ecarts++; console.log(`  ÉCART écran ${tab.code}/${c.id} ${c.lignes[i].libelle} ${col.cle} : écran « ${cellules[j + 2]} » ≠ API « ${a} »`); }
      if (/^-?\d+\.\d\d$/.test(a) && Number(a) !== 0) { nbNonNulles++; montantsAttendus.add(a); }
    });
  }
}
ok(ecarts === 0 && nbNonNulles > 20, `écran ↔ API : ${nbCellules} cellules comparées, ${nbNonNulles} non nulles, ${ecarts} écart(s)`);
// CSV : mêmes cellules, sous le titre de chaque tableau.
const href = await page.getByTestId('export-csv-etat-joint').getAttribute('href');
const csv = decodeURIComponent(href.replace('data:text/csv;charset=utf-8,', ''));
writeFileSync(`${sortie}parcours-immo-etat-joint.csv`, csv);
const lignesCsv = csv.split('\r\n');
let ecartsCsv = 0;
for (const tab of t.tableaux) for (const c of tab.cadres) {
  const i0 = lignesCsv.findIndex((l) => l.startsWith(`${tab.code} — ${tab.intitule} — ${c.titre}`));
  if (i0 < 0) { ecartsCsv++; continue; }
  c.lignes.forEach((l, i) => {
    const f = lignesCsv[i0 + 3 + i].split(';');
    c.colonnes.forEach((col, j) => { if (f[j + 2] !== attendu(l.cellules[col.cle]).replace(/^"|"$/g, '') && !f[j + 2].startsWith('"')) { ecartsCsv++; console.log(`  ÉCART CSV ${tab.code}/${c.id} ${l.libelle} ${col.cle} : « ${f[j + 2]} »`); } });
  });
}
ok(ecartsCsv === 0, `CSV ↔ API : toutes les cellules des tableaux 2054 et 2055 concordent (${ecartsCsv} écart)`);
// PDF A4 paysage : tous les montants non nuls de l'API doivent figurer dans le texte du PDF.
const pdf = await page.pdf({ format: 'A4', landscape: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:right;padding-right:12mm">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: '14mm', bottom: '18mm', left: '12mm', right: '12mm' } });
writeFileSync(`${sortie}parcours-immo-etat-joint.pdf`, pdf);
const pdfjs = await import(new URL(`file://${join(racine, 'node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist/legacy/build/pdf.mjs')}`).href);
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
let texte = '';
for (let p = 1; p <= doc.numPages; p++) texte += (await (await doc.getPage(p)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
const manquants = [...montantsAttendus].filter((m) => !texte.includes(m));
ok(manquants.length === 0 && /PROJET/.test(texte), `PDF ↔ API : ${doc.numPages} pages, ${montantsAttendus.size} montants non nuls distincts, ${manquants.length} absent(s) ${manquants.slice(0, 5)} ; mention PROJET présente`);
await nav.close();
console.log(`Lien local : ${WEB}/dossiers/${dossier}/fiscal?vue=liasse   (état joint : ${url})`);
console.log(JSON.stringify({ dossier, exercice }));
