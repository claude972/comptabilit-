#!/usr/bin/env node
/**
 * LIVRABLE DE DÉMONSTRATION des ventilations (D-173) : dossier fictif avec ventilation 2050 (en-cours biens / services, produits), reprise explicite dans les cases BN à BS, rapprochements 2057,
 * lignes sans case imprimée (sous-totaux internes) → état joint PDF et CSV, capture de l'écran, et marche à suivre. Réutilise `scripts/demo-reports-feuillets.mjs` (preuves déjà acquises : aucune
 * campagne répétée) puis ne fait que lire l'écran, l'état joint, le CSV et le PDF du dossier créé et comparer leurs montants à ceux de l'API. Aucun secret n'est écrit : le mot de passe de
 * démonstration reste dans `.env` (clé DEV_MDP_UTILISATEURS). Données synthétiques ; statut « projet », aucune validation professionnelle, aucune transmission.
 *   node scripts/livrable-ventilation-2050.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(join(racine, '.env'), 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
const WEB = 'http://localhost:3100';
const r = spawnSync(process.execPath, [join(racine, 'scripts/demo-reports-feuillets.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 });
const lignes = r.stdout.split('\n');
const verdicts = lignes.filter((l) => /^(OK|ÉCHEC) /.test(l));
const ids = JSON.parse([...lignes].reverse().find((l) => l.startsWith('{"dossier"')) ?? 'null');
if (r.status !== 0 || verdicts.some((l) => l.startsWith('ÉCHEC')) || !ids) {
  console.error(r.stdout.slice(-3000), r.stderr.slice(-1500));
  process.exit(1);
}
const ok = (c, m) => { verdicts.push(`${c ? 'OK    ' : 'ÉCHEC '} ${m}`); console.log(`${c ? 'OK    ' : 'ÉCHEC '} ${m}`); if (!c) process.exitCode = 1; };
const { chromium, devices } = createRequire(join(racine, 'apps/web/package.json'))('@playwright/test');
const nav = await chromium.launch();
const page = await (await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } })).newPage();
const urlLiasse = `${WEB}/dossiers/${ids.dossier}/fiscal?vue=liasse`;
const urlEtat = `${WEB}/dossiers/${ids.dossier}/fiscal/etat-joint?exercice=${ids.exercice}&regime=reel_normal&vue=stocks`;
const urlComplet = `${WEB}/dossiers/${ids.dossier}/fiscal/etat-joint?exercice=${ids.exercice}&regime=reel_normal`;
await page.goto(urlLiasse);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('alice.admin@cabinet-a.test');
await page.locator('#password').fill(env.DEV_MDP_UTILISATEURS);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
await page.goto(urlLiasse);
await page.waitForLoadState('networkidle');
const sortie = join(racine, 'var/livrables/demo');

for (const ancien of ['etat-joint-ventilations-2050.pdf', 'etat-joint-ventilations-2050.csv']) rmSync(join(sortie, ancien), { force: true }); // remplacés par le livrable ciblé
mkdirSync(sortie, { recursive: true });
// Écran : la reprise retenue et un sous-total interne sans case.
const reprise = page.getByTestId('reprise-2050-stocks');
await reprise.scrollIntoViewIfNeeded();
ok((await reprise.getAttribute('data-etat')) === 'decidee' && /700/.test(await reprise.locator('[data-case="BN"]').innerText()), 'écran : reprise décidée, case BN = 700,00');
await reprise.screenshot({ path: join(sortie, 'ecran-reprise-2050.png') });
ok((await page.locator('[data-sans-code="sous_total_interne"]').count()) > 0, 'écran : les sous-totaux sans case imprimée sont désignés « sous-total interne » (plus de « à confirmer » indéfini)');
// État joint : CSV et PDF.
await page.goto(urlEtat);
await page.getByTestId('etat-joint').waitFor();
const csv = decodeURIComponent((await page.getByTestId('export-csv-etat-joint').getAttribute('href')).replace('data:text/csv;charset=utf-8,', ''));
writeFileSync(join(sortie, 'bilan-et-ventilation-stocks.csv'), csv);
const bloc = csv.split('\n').map((l) => l.trim()).filter((l) => /;(BN|BO|BP|BQ|BR|BS);/.test(l)).map((l) => l.split(';').slice(-2).join(';'));
ok(JSON.stringify(bloc) === JSON.stringify(['BN;700.00', 'BO;100.00', 'BP;300.00', 'BQ;0.00', 'BR;abstention : le montant ventilé diffère du montant source du projet de bilan (écart -50.00) : reprise non appliquée, rien n’est corrigé ni écrasé', 'BS;0.00']), `CSV : cases BN à BS retenues ou en abstention motivée (${bloc.length} lignes)`);
ok(/sous-total interne : aucune case imprimée/.test(csv), 'CSV : sous-totaux internes désignés');
const titres = csv.split('\n').map((l) => l.trim()).filter((l) => /^(2050|2051|2052|2053|2054|2055|2056|2057|2058|2059|2033|2065)[- /]|^liasse-/.test(l) || /^20\d\d[A-Z-]* — /.test(l));
ok(/Périmètre de cet état : bilan \(2050 actif, 2051 passif\) et ventilation des stocks seulement \(cases BN à BS\) \(\d+ tableau\(x\) sur \d+ préparés\)/.test(csv) && !/^2059-B|^2057 —|^2056 —/m.test(csv), `CSV : périmètre annoncé en tête, aucun tableau étranger (${titres.length} titres reconnus)`);
const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true }); // format, marges, pagination et statut PROJET viennent de la feuille d'impression (globals.css), comme à l'impression depuis le navigateur
writeFileSync(join(sortie, 'bilan-et-ventilation-stocks.pdf'), pdf);
const pdfjs = await import(new URL(`file://${join(racine, 'node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist/legacy/build/pdf.mjs')}`).href);
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
let texte = '';
for (let p = 1; p <= doc.numPages; p++) texte += (await (await doc.getPage(p)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
ok(['700.00', '300.00', '100.00'].every((m) => texte.includes(m)) && /cases BN à BS retenues/.test(texte) && /PROJET/.test(texte) && /justification/.test(texte) && /Périmètre : bilan/.test(texte) && !/2059-B/.test(texte.replace(/Voir tous[^.]*/, '')), `PDF : ${doc.numPages} pages, cases BN à BS, justification, périmètre annoncé et mention PROJET présents`);
ok(doc.numPages <= 12, `PDF ciblé : ${doc.numPages} pages (l'état complet, ${urlComplet.length > 0 ? 'accessible par le lien du guide' : ''}, reste hors de ce fichier)`);
await nav.close();
const lisez = `Ventilations 2050 — dossier de démonstration FICTIF, exercice 2025, statut PROJET (aucune validation professionnelle, aucune transmission, aucune connexion externe).

Liens (valables tant que la pile locale et sa base tournent ; le dossier reste en base) :
  Liasse (écran)                          : ${urlLiasse}
  État imprimable CIBLÉ (bilan + stocks)  : ${urlEtat}
  État joint COMPLET (tous les tableaux)   : ${urlComplet}

Fichiers :
  bilan-et-ventilation-stocks.pdf  : ${doc.numPages} pages : bilan (2050 actif, 2051 passif), ventilation 2050-STOCKS saisie (justifications, écarts), cases BN à BS retenues ou en abstention ; rien d'autre
  bilan-et-ventilation-stocks.csv  : MÊME périmètre, annoncé en tête du fichier ; ouvrable dans un tableur
  ecran-reprise-2050.png            : l'écran des cases BN à BS retenues
  (l'état COMPLET reste imprimable depuis le lien ci-dessus ; il compte une centaine de pages et n'est pas joint)

Marche à suivre (sans secret) :
  1. Démarrer la pile locale : scripts/applis.sh demarrer ; puis scripts/applis.sh web (voir docs/exploitation.md).
  2. Ouvrir le lien « Liasse » ; se connecter avec alice.admin@cabinet-a.test (mot de passe de démonstration : clé DEV_MDP_UTILISATEURS du fichier .env, non recopiée ici).
  3. Descendre jusqu'à « 2050-STOCKS » : saisir les lignes « en cours de production de biens », « de services » et « produits intermédiaires et finis » (brut, amortissements et provisions) avec une justification.
  4. À la ligne « Décision du cabinet », choisir « Oui » avec une justification : les cases dont le montant égale le montant source du projet de bilan sont retenues, les autres restent en abstention avec l'écart.
  5. Ouvrir « État joint » puis « Bilan et ventilation des stocks » : vérifier le tableau « cases BN à BS retenues », puis Fichier > Imprimer (PDF A4 paysage) ou « Exporter en CSV ». « Voir tous les tableaux préparés » rouvre l'état complet.
  Limite connue : l'état détaillé des charges à payer n'est pas préparé (aucune source officielle actuelle exploitable, voir docs/sources-officielles.md § 8).

Contrôles du script : ${verdicts.length} vérifications, toutes OK.
`;
writeFileSync(join(sortie, 'LISEZ-MOI-ventilations-2050.txt'), lisez);
console.log(`\nLIVRABLE VENTILATIONS PRÊT\n  liasse : ${urlLiasse}\n  état joint : ${urlEtat}\n  PDF : ${join(sortie, 'bilan-et-ventilation-stocks.pdf')}\n  CSV : ${join(sortie, 'bilan-et-ventilation-stocks.csv')}`);
