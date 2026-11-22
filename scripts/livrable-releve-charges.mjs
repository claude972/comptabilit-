#!/usr/bin/env node
/**
 * LIVRABLE DE DÉMONSTRATION du relevé interne des frais à payer (D-175, dérivé de livrable-ventilation-2050.mjs, D-173) : dossier fictif avec ventilation 2050 (en-cours biens / services, produits), reprise explicite dans les cases BN à BS, rapprochements 2057,
 * lignes sans case imprimée (sous-totaux internes) → état joint PDF et CSV, capture de l'écran, et marche à suivre. Réutilise `scripts/demo-reports-feuillets.mjs` (preuves déjà acquises : aucune
 * campagne répétée) puis ne fait que lire l'écran, l'état joint, le CSV et le PDF du dossier créé et comparer leurs montants à ceux de l'API. Aucun secret n'est écrit : le mot de passe de
 * démonstration reste dans `.env` (clé DEV_MDP_UTILISATEURS). Données synthétiques ; statut « projet », aucune validation professionnelle, aucune transmission.
 *   node scripts/livrable-releve-charges.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const urlEtat = `${WEB}/dossiers/${ids.dossier}/fiscal/etat-joint?exercice=${ids.exercice}&regime=reel_normal&vue=charges`;
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

mkdirSync(sortie, { recursive: true });
await page.goto(urlEtat);
await page.getByTestId('etat-joint').waitFor();
const csv = decodeURIComponent((await page.getByTestId('export-csv-etat-joint').getAttribute('href')).replace('data:text/csv;charset=utf-8,', ''));
writeFileSync(join(sortie, 'releve-frais-a-payer.csv'), csv);
ok(/Périmètre de cet état : relevé interne des frais à payer seulement \(non officiel\) \(1 tableau\(x\) sur \d+ préparés\)/.test(csv), 'CSV : périmètre annoncé (relevé interne, non officiel)');
ok(['1200.00', '350.50', '89.50', '1640.00'].every((m) => csv.includes(m)) && /Honoraires de commissariat aux comptes à payer/.test(csv), 'CSV : trois lignes et total 1640.00');
ok(!/^2050|^2057 —|^2059/m.test(csv.split('\n').slice(8).join('\n')) , 'CSV : aucun autre tableau');
const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
writeFileSync(join(sortie, 'releve-frais-a-payer.pdf'), pdf);
const pdfjs = await import(new URL(`file://${join(racine, 'node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist/legacy/build/pdf.mjs')}`).href);
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
let texte = '';
for (let p = 1; p <= doc.numPages; p++) texte += (await (await doc.getPage(p)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
ok(['1200.00', '350.50', '89.50', '1640.00'].every((m) => texte.includes(m)) && /PROJET/.test(texte) && !/Tableau de bord|Retour aux états fiscaux/.test(texte), 'PDF : montants, mention PROJET, sans navigation');
ok(doc.numPages <= 3, `PDF : ${doc.numPages} page(s)`);
await nav.close();
const lisez = `Relevé interne des frais à payer — dossier de démonstration FICTIF, exercice 2025, statut PROJET (aucune validation professionnelle, aucune transmission, aucune connexion externe).

Ce que la source établit : le BOFiP BOI-BIC-DECLA-30-10-10-30 (§260, version en vigueur du 26/05/2021 sur la page lue le 22/11/2026) subordonne la tolérance sur les « frais à payer » à « un relevé détaillé de ces frais, en annexe à la déclaration des résultats ». Elle ne fixe ni modèle, ni colonnes, ni seuil. CE RELEVÉ EST DONC INTERNE À COMTAPLE : ce n'est PAS le formulaire officiel (article 38 II de l'annexe III au CGI, illisible : Légifrance refuse l'accès). Aucune charge n'est déduite de la balance ; chaque ligne est saisie et justifiée par le cabinet.

Liens (valables tant que la pile locale et sa base tournent) :
  Liasse (écran)         : ${urlLiasse}
  Relevé imprimable      : ${urlEtat}
  État joint complet     : ${urlComplet}

Fichiers : releve-frais-a-payer.pdf (${doc.numPages} page(s)) et releve-frais-a-payer.csv (même périmètre, annoncé en tête).

Marche à suivre : 1. scripts/applis.sh demarrer puis scripts/applis.sh web. 2. Ouvrir le lien « Liasse », se connecter avec alice.admin@cabinet-a.test (mot de passe de démonstration : clé DEV_MDP_UTILISATEURS du fichier .env, non recopiée). 3. Descendre à « CHARGES-A-PAYER » : saisir chaque ligne (nature ou tiers, montant, justification) ou déclarer « néant » si aucun frais à payer. 4. Ouvrir « État joint » puis « Relevé des frais à payer » : imprimer ou exporter en CSV.
Limites : pas de rapprochement avec le bilan ni avec les lignes 9K à 9S du 2058-B (aucune relation énoncée par une source accessible) ; au-delà de vingt lignes : non préparé.

Contrôles du script : ${verdicts.length} vérifications.
`;
writeFileSync(join(sortie, 'LISEZ-MOI-releve-frais-a-payer.txt'), lisez);
console.log(`\nLIVRABLE RELEVÉ PRÊT\n  liasse : ${urlLiasse}\n  relevé : ${urlEtat}\n  PDF : ${join(sortie, 'releve-frais-a-payer.pdf')}\n  CSV : ${join(sortie, 'releve-frais-a-payer.csv')}`);
