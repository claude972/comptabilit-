/**
 * Prépare le contenu MINIMAL de l'image d'analyse (D-098) : ce que `analyse-enfant.js` charge réellement, et rien d'autre.
 * Lancé par le Dockerfile (cible `analyse`) dans l'étage de construction, après `pnpm run build`.
 *
 *   node scripts/preparer-image-analyse.mjs <racine du dépôt construit> <dossier de sortie>
 *
 * Copie, avec la même disposition que le dépôt (le parent impose ces chemins à Node : `--allow-fs-read=/app/...`) :
 *   - les seuls fichiers compilés de `apps/worker/dist` atteints depuis `analyse-enfant.js` par ses importations relatives ;
 *   - `packages/core` (compilé) ;
 *   - la fermeture des dépendances de production de ces deux paquets dans le magasin virtuel de pnpm.
 * Ni le code du worker (base, Redis, stockage, files), ni `.env`, ni les sources, ni les outils de test ne sont copiés.
 * Échoue (code 1) si un fichier attendu manque : l'image n'est alors pas construite à moitié.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const [racineArg, sortieArg] = process.argv.slice(2);
if (!racineArg || !sortieArg) {
  console.error('usage : preparer-image-analyse.mjs <racine> <sortie>');
  process.exit(2);
}
const racine = realpathSync(resolve(racineArg));
const sortie = resolve(sortieArg);
rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });

const echouer = (m) => {
  console.error(`préparation de l'image d'analyse impossible : ${m}`);
  process.exit(1);
};

// 1. Fichiers compilés de l'enfant : fermeture de ses importations relatives.
const dist = join(racine, 'apps/worker/dist');
const fichiers = new Set();
const visiter = (f) => {
  if (fichiers.has(f)) return;
  if (!existsSync(f)) echouer(`fichier compilé absent : ${f} (lancer « pnpm run build »)`);
  fichiers.add(f);
  const source = readFileSync(f, 'utf8');
  for (const m of source.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) visiter(resolve(dirname(f), m[1]));
};
visiter(join(dist, 'analyse-enfant.js'));
for (const f of fichiers) {
  const cible = join(sortie, relative(racine, f));
  mkdirSync(dirname(cible), { recursive: true });
  cpSync(f, cible);
}
cpSync(join(racine, 'apps/worker/package.json'), join(sortie, 'apps/worker/package.json'));

// 2. Paquet de cœur : compilé seulement.
mkdirSync(join(sortie, 'packages/core'), { recursive: true });
cpSync(join(racine, 'packages/core/dist'), join(sortie, 'packages/core/dist'), { recursive: true });
cpSync(join(racine, 'packages/core/package.json'), join(sortie, 'packages/core/package.json'));

// 3. Dépendances de production : fermeture dans `node_modules/.pnpm`, liens relatifs conservés.
const magasin = join(racine, 'node_modules/.pnpm');
const retenus = new Set(); // noms de dossiers du magasin
// Module natif facultatif de pdf.js (rendu d'images) : refusé de toute façon par le modèle de permissions de l'enfant (pas de
// `--allow-addons`) ; on ne l'embarque pas. pdf.js signale son absence sur la sortie d'erreur, jamais relayée.
const EXCLUS = /^@napi-rs\+canvas/;
const aVisiter = [];
const lierDepuis = (dossierModules, noms, sortieModules) => {
  for (const nom of noms) {
    const lien = join(dossierModules, nom);
    if (!existsSync(lien)) echouer(`dépendance absente : ${lien}`);
    const reel = realpathSync(lien);
    const id = relative(magasin, reel).split('/')[0];
    if (id.startsWith('..') || EXCLUS.test(id)) continue; // paquet du dépôt (ex. @comtaple/core) : copié à part
    if (!retenus.has(id)) {
      retenus.add(id);
      aVisiter.push(id);
    }
    const cible = join(sortieModules, nom);
    mkdirSync(dirname(cible), { recursive: true });
    symlinkSync(readlinkSync(lien), cible);
  }
};
lierDepuis(join(racine, 'apps/worker/node_modules'), ['pdfjs-dist', 'zod'], join(sortie, 'apps/worker/node_modules'));
mkdirSync(join(sortie, 'apps/worker/node_modules/@comtaple'), { recursive: true });
symlinkSync('../../../../packages/core', join(sortie, 'apps/worker/node_modules/@comtaple/core'));
lierDepuis(join(racine, 'packages/core/node_modules'), ['decimal.js', 'fast-xml-parser', 'iconv-lite', 'zod'], join(sortie, 'packages/core/node_modules'));
while (aVisiter.length > 0) {
  const id = aVisiter.pop();
  const source = join(magasin, id);
  cpSync(source, join(sortie, 'node_modules/.pnpm', id), { recursive: true, verbatimSymlinks: true });
  // Voisins du paquet (ses dépendances) : liens du dossier `node_modules` interne au magasin.
  const interne = join(source, 'node_modules');
  for (const entree of readdirSync(interne)) {
    const chemins = entree.startsWith('@') ? readdirSync(join(interne, entree)).map((n) => `${entree}/${n}`) : [entree];
    for (const nom of chemins) {
      const lien = join(interne, nom);
      if (!lstatSync(lien).isSymbolicLink()) continue;
      const id2 = relative(magasin, realpathSync(lien)).split('/')[0];
      if (!id2.startsWith('..') && !EXCLUS.test(id2) && !retenus.has(id2)) {
        retenus.add(id2);
        aVisiter.push(id2);
      }
    }
  }
}
console.log(`image d'analyse : ${fichiers.size} fichiers compilés, ${retenus.size} paquets du magasin (${[...retenus].map((i) => basename(i)).join(', ')})`);
