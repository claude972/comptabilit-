#!/usr/bin/env node
/**
 * Vérifie une archive de restitution (dossier ou cabinet) HORS de l'application, sans base ni réseau :
 *   node scripts/verifier-restitution.mjs <archive.zip> [empreinte SHA-256 attendue de l'archive]
 *
 *  1) empreinte de l'archive elle-même, si elle est fournie (celle affichée par l'application) ;
 *  2) chaque fichier listé au manifeste est présent, à la bonne taille et à la bonne empreinte ;
 *  3) aucun fichier de l'archive n'est absent du manifeste ; aucun chemin ne sort de l'archive ;
 *  4) restitution de cabinet : un original nommé par son empreinte contient bien ce contenu, sauf s'il est signalé
 *     au manifeste comme non conforme.
 * Les fichiers sont lus en flux. Code de sortie 0 si tout est conforme, 1 sinon.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

const yauzl = createRequire(new URL('../apps/api/package.json', import.meta.url))('yauzl');
const [chemin, empreinteAttendue] = process.argv.slice(2);
if (!chemin) {
  console.error('Usage : verifier-restitution.mjs <archive.zip> [empreinte SHA-256 de l’archive]');
  process.exit(2);
}
const ecarts = [];

async function empreinteFichier(c) {
  const h = createHash('sha256');
  for await (const m of createReadStream(c)) h.update(m);
  return h.digest('hex');
}

function lireArchive(c) {
  return new Promise((ok, ko) => {
    yauzl.open(c, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return ko(err ?? new Error('archive illisible'));
      const entrees = new Map();
      let manifeste = null;
      zip.on('entry', (entree) => {
        if (entree.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entree, (e, flux) => {
          if (e || !flux) return ko(e ?? new Error('entrée illisible'));
          const h = createHash('sha256');
          let taille = 0;
          const morceaux = [];
          flux.on('data', (m) => {
            h.update(m);
            taille += m.length;
            if (entree.fileName === 'manifeste.json') morceaux.push(m);
          });
          flux.on('error', ko);
          flux.on('end', () => {
            if (entrees.has(entree.fileName)) ecarts.push(`entrée en double : ${entree.fileName}`);
            entrees.set(entree.fileName, { taille, sha256: h.digest('hex') });
            if (entree.fileName === 'manifeste.json') manifeste = Buffer.concat(morceaux).toString('utf8');
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => ok({ entrees, manifeste }));
      zip.on('error', ko);
      zip.readEntry();
    });
  });
}

try {
  if (empreinteAttendue) {
    const lue = await empreinteFichier(chemin);
    if (lue !== empreinteAttendue.toLowerCase()) ecarts.push(`empreinte de l'archive différente de celle attendue (lue : ${lue})`);
  }
  const { entrees, manifeste: brut } = await lireArchive(chemin);
  if (!brut) throw new Error('manifeste.json absent de l’archive');
  const manifeste = JSON.parse(brut);
  if (!/^comtaple\.restitution(-cabinet)?\/1$/.test(manifeste.format ?? '')) ecarts.push(`format de manifeste inconnu : ${manifeste.format}`);
  const attendus = new Map(manifeste.fichiers.map((f) => [f.chemin, f]));
  if (attendus.size !== manifeste.fichiers.length) ecarts.push('le manifeste liste deux fois un même chemin');
  for (const [nom, f] of attendus) {
    const e = entrees.get(nom);
    if (!e) ecarts.push(`absent de l'archive : ${nom}`);
    else if (e.taille !== f.taille) ecarts.push(`taille différente : ${nom}`);
    else if (e.sha256 !== f.sha256) ecarts.push(`empreinte différente : ${nom}`);
  }
  for (const nom of entrees.keys()) {
    if (nom !== 'manifeste.json' && !attendus.has(nom)) ecarts.push(`présent dans l'archive mais absent du manifeste : ${nom}`);
    if (/\.\.|^\/|\\|\u0000/.test(nom)) ecarts.push(`chemin dangereux : ${JSON.stringify(nom)}`);
  }
  if (manifeste.format === 'comtaple.restitution-cabinet/1') {
    const signales = new Set((manifeste.originauxNonConformes ?? []).map((x) => x.sha256));
    for (const [nom, e] of entrees) {
      const m = /^originaux\/([0-9a-f]{64})$/.exec(nom);
      if (m && m[1] !== e.sha256 && !signales.has(m[1])) ecarts.push(`original dont le contenu ne correspond pas à son nom, et non signalé : ${nom}`);
    }
  }
  console.log(`Format : ${manifeste.format} ; généré le ${manifeste.genereLe}`);
  if (manifeste.format === 'comtaple.restitution-cabinet/1') {
    console.log(`Périmètre : ${manifeste.dossiersInclus} dossier(s) inclus, ${manifeste.dossiersEcartes} écarté(s) — ${manifeste.complet ? 'restitution COMPLÈTE du cabinet' : 'restitution INCOMPLÈTE (voir perimetre.ecartes)'}`);
    console.log(`Journal d'audit au moment de la génération (vérification stricte) : ${manifeste.journalAudit?.verificationStricte}${manifeste.journalAudit?.partiel ? ' ; journal restitué partiellement' : ''}`);
    if ((manifeste.originauxNonConformes ?? []).length) console.log(`ATTENTION : ${manifeste.originauxNonConformes.length} original(aux) signalé(s) non conforme(s) à leur empreinte enregistrée.`);
  }
  console.log(`Fichiers au manifeste : ${attendus.size} ; entrées de l'archive : ${entrees.size}`);
} catch (e) {
  ecarts.push(`archive illisible : ${e.message}`);
}
if (ecarts.length) {
  console.log(`NON CONFORME — ${ecarts.length} écart(s) :`);
  for (const e of ecarts.slice(0, 20)) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('CONFORME : chaque fichier correspond au manifeste, et rien ne s’y ajoute.');
