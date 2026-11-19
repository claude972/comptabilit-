#!/usr/bin/env node
/**
 * Chiffrement des sauvegardes LOCALES (préparation ; voir packages/plateforme/src/chiffrement-fichiers.ts).
 *
 *   node scripts/chiffrer-sauvegardes.mjs generer-cles <dossier HORS du dépôt et hors des sauvegardes>
 *       Crée une paire de clés. La clé PRIVÉE n'est jamais affichée ; elle doit quitter ce poste (coffre, support
 *       déconnecté) : qui la détient lit toutes les sauvegardes, qui la perd ne peut plus rien restaurer.
 *   node scripts/chiffrer-sauvegardes.mjs chiffrer --cle-publique <fichier.pem> <fichier> [<fichier>…]
 *   node scripts/chiffrer-sauvegardes.mjs chiffrer-tout --cle-publique <fichier.pem>
 *       Chiffre les sauvegardes de var/sauvegardes qui ne le sont pas encore (base, manifestes d'objets, exports Keycloak).
 *   node scripts/chiffrer-sauvegardes.mjs copie-chiffree --cle-publique <fichier.pem> --destination <dossier> <sauvegarde.dump>
 *       Constitue, dans un AUTRE dossier, un jeu chiffré complet d'une sauvegarde : la base, le manifeste des objets et
 *       chaque objet du manifeste (un fichier chiffré par objet, jamais refait s'il existe déjà). Les sauvegardes
 *       d'origine ne sont ni modifiées ni chiffrées en place.
 *   node scripts/chiffrer-sauvegardes.mjs dechiffrer-copie --cle-privee <fichier.pem> --source <dossier chiffré> --destination <dossier> <nom.dump>
 *       Reconstitue en clair, dans un dossier VIDE, la base, le manifeste et les objets d'un jeu chiffré, en vérifiant
 *       chaque objet contre l'empreinte du manifeste.
 *   node scripts/chiffrer-sauvegardes.mjs verifier --cle-privee <fichier.pem> <fichier.chiffre> [<fichier.chiffre>…]
 *       Déchiffre sans rien écrire et compare l'empreinte du contenu à celle relevée au chiffrement.
 *   node scripts/chiffrer-sauvegardes.mjs dechiffrer --cle-privee <fichier.pem> <fichier.chiffre> <sortie>
 *
 * Rien n'est jamais supprimé ni écrasé : les fichiers en clair restent en place tant qu'une personne ne décide pas de
 * les retirer, après avoir vérifié les copies chiffrées ET mis la clé privée en lieu sûr.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const c = await import('../packages/plateforme/dist/chiffrement-fichiers.js');
const racine = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const SAUVEGARDES = join(racine, 'var', 'sauvegardes');
const args = process.argv.slice(2);
const commande = args.shift();
const option = (nom) => {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const [, valeur] = args.splice(i, 2);
  return valeur ?? null;
};
const sha256Fichier = async (chemin) => {
  const h = createHash('sha256');
  for await (const m of createReadStream(chemin)) h.update(m);
  return h.digest('hex');
};

async function chiffrer(fichiers, clePubliquePem) {
  let faits = 0;
  for (const fichier of fichiers) {
    const sortie = `${fichier}.chiffre`;
    if (existsSync(sortie)) {
      console.log(`déjà chiffré : ${sortie}`);
      continue;
    }
    const r = await c.chiffrerFichier(fichier, sortie, clePubliquePem);
    writeFileSync(`${sortie}.json`, `${JSON.stringify({ format: c.FORMAT_SAUVEGARDE_CHIFFREE, destinataire: r.destinataire, sha256Clair: r.sha256Clair, octetsClairs: r.octetsClairs, chiffreLe: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`chiffré : ${sortie} (${r.octetsClairs} octets en clair, destinataire ${r.destinataire}) — l'original est conservé`);
    faits++;
  }
  return faits;
}

try {
  if (commande === 'generer-cles' && args[0]) {
    const dossier = resolve(args[0]);
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const reel = realpathSync(dossier);
    if (reel === racine || reel.startsWith(racine + sep)) throw new Error('Refus : la clé privée ne doit être créée ni dans le dépôt, ni à côté des sauvegardes. Choisir un dossier extérieur.');
    const cles = c.genererPaireDeCles();
    writeFileSync(join(reel, 'comtaple-sauvegardes.cle-privee.pem'), cles.clePriveePem, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(reel, 'comtaple-sauvegardes.cle-publique.pem'), cles.clePubliquePem, { flag: 'wx', mode: 0o644 });
    console.log(`Paire de clés créée dans ${reel} (empreinte de la clé publique : ${cles.empreinte}).`);
    console.log('La clé PRIVÉE doit quitter ce poste. Sans elle, aucune sauvegarde chiffrée ne pourra être restaurée ; avec elle, toutes peuvent être lues.');
  } else if (commande === 'chiffrer' || commande === 'chiffrer-tout') {
    const chemin = option('--cle-publique');
    if (!chemin) throw new Error('Indiquer --cle-publique <fichier.pem>');
    const clePubliquePem = readFileSync(chemin, 'utf8');
    if (/PRIVATE/.test(clePubliquePem)) throw new Error('Ce fichier contient une clé PRIVÉE : seule la clé publique sert à chiffrer.');
    const fichiers = commande === 'chiffrer'
      ? args
      : (existsSync(SAUVEGARDES) ? readdirSync(SAUVEGARDES) : []).filter((f) => /\.dump$|\.objets\.json$|^keycloak-.*\.json$/.test(f)).sort().map((f) => join(SAUVEGARDES, f));
    if (!fichiers.length) throw new Error('Aucun fichier à chiffrer');
    const faits = await chiffrer(fichiers, clePubliquePem);
    console.log(`${faits} fichier(s) chiffré(s) sur ${fichiers.length}. Aucun fichier en clair n'a été supprimé.`);
    if (commande === 'chiffrer-tout') console.log('Rappel : cette commande ne chiffre pas les objets du stockage ; utiliser « copie-chiffree » pour un jeu complet dans un autre dossier.');
  } else if (commande === 'copie-chiffree') {
    const chemin = option('--cle-publique');
    const destination = option('--destination');
    if (!chemin || !destination || args.length !== 1) throw new Error('Indiquer --cle-publique <pem> --destination <dossier> <sauvegarde.dump>');
    const clePubliquePem = readFileSync(chemin, 'utf8');
    if (/PRIVATE/.test(clePubliquePem)) throw new Error('Ce fichier contient une clé PRIVÉE : seule la clé publique sert à chiffrer.');
    const dump = resolve(args[0]);
    const manifeste = dump.replace(/\.dump$/, '.objets.json');
    if (!existsSync(dump) || !existsSync(manifeste)) throw new Error('Sauvegarde ou manifeste des objets introuvable');
    const dest = resolve(destination);
    if (dest === dirname(dump)) throw new Error('Refus : le jeu chiffré se constitue dans un AUTRE dossier que les sauvegardes d’origine.');
    mkdirSync(join(dest, 'objets'), { recursive: true, mode: 0o700 });
    const depot = process.env.SAUVEGARDE_DEPOT_OBJETS ?? join(dirname(dump), 'objets');
    for (const f of [dump, manifeste]) {
      const sortie = join(dest, `${basename(f)}.chiffre`);
      if (!existsSync(sortie)) await c.chiffrerFichier(f, sortie, clePubliquePem);
    }
    const { objets } = JSON.parse(readFileSync(manifeste, 'utf8'));
    const empreintes = [...new Set(objets.map((o) => o.sha256))];
    let faits = 0;
    let octets = 0;
    for (const sha of empreintes) {
      const source = join(depot, sha.slice(0, 2), sha);
      const sortie = join(dest, 'objets', sha.slice(0, 2), `${sha}.chiffre`);
      if (existsSync(sortie)) continue;
      mkdirSync(dirname(sortie), { recursive: true, mode: 0o700 });
      const r = await c.chiffrerFichier(source, sortie, clePubliquePem);
      if (r.sha256Clair !== sha) throw new Error(`Objet de sauvegarde altéré avant chiffrement : ${sha.slice(0, 12)}…`);
      faits++;
      octets += r.octetsClairs;
    }
    console.log(`Jeu chiffré : base et manifeste, ${empreintes.length} objet(s) distinct(s) dont ${faits} chiffré(s) maintenant (${(octets / 1e6).toFixed(1)} Mo). Les sauvegardes d'origine n'ont pas été touchées.`);
  } else if (commande === 'dechiffrer-copie') {
    const chemin = option('--cle-privee');
    const source = option('--source');
    const destination = option('--destination');
    if (!chemin || !source || !destination || args.length !== 1) throw new Error('Indiquer --cle-privee <pem> --source <dossier chiffré> --destination <dossier vide> <nom.dump>');
    const clePriveePem = readFileSync(chemin, 'utf8');
    const dest = resolve(destination);
    mkdirSync(join(dest, 'objets'), { recursive: true, mode: 0o700 });
    if (readdirSync(dest).length > 1 || readdirSync(join(dest, 'objets')).length > 0) throw new Error('Refus : le dossier de destination doit être vide.');
    const nom = basename(args[0]);
    const nomManifeste = nom.replace(/\.dump$/, '.objets.json');
    const rDump = await c.dechiffrerFichier(join(source, `${nom}.chiffre`), join(dest, nom), clePriveePem);
    await c.dechiffrerFichier(join(source, `${nomManifeste}.chiffre`), join(dest, nomManifeste), clePriveePem);
    const { objets } = JSON.parse(readFileSync(join(dest, nomManifeste), 'utf8'));
    const empreintes = [...new Set(objets.map((o) => o.sha256))];
    let octets = 0;
    for (const sha of empreintes) {
      const sortie = join(dest, 'objets', sha.slice(0, 2), sha);
      mkdirSync(dirname(sortie), { recursive: true, mode: 0o700 });
      const r = await c.dechiffrerFichier(join(source, 'objets', sha.slice(0, 2), `${sha}.chiffre`), sortie, clePriveePem);
      // Le contenu déchiffré doit porter l'empreinte sous laquelle le manifeste le désigne.
      if (r.sha256Clair !== sha) throw new Error(`Objet déchiffré non conforme à son empreinte : ${sha.slice(0, 12)}…`);
      octets += r.octetsClairs;
    }
    console.log(`Jeu déchiffré : base (sha256 ${rDump.sha256Clair}), manifeste et ${empreintes.length} objet(s) (${(octets / 1e6).toFixed(1)} Mo), chacun conforme à son empreinte.`);
  } else if (commande === 'verifier') {
    const chemin = option('--cle-privee');
    if (!chemin || !args.length) throw new Error('Indiquer --cle-privee <fichier.pem> et au moins un fichier .chiffre');
    const clePriveePem = readFileSync(chemin, 'utf8');
    let ecarts = 0;
    for (const fichier of args) {
      const r = await c.dechiffrerFichier(fichier, null, clePriveePem);
      const attendu = existsSync(`${fichier}.json`) ? JSON.parse(readFileSync(`${fichier}.json`, 'utf8')).sha256Clair : null;
      const clair = fichier.replace(/\.chiffre$/, '');
      const original = clair !== fichier && existsSync(clair) ? await sha256Fichier(clair) : null;
      const ok = (attendu === null || attendu === r.sha256Clair) && (original === null || original === r.sha256Clair);
      if (!ok) ecarts++;
      console.log(`${ok ? 'conforme' : 'ÉCART   '} — ${fichier} : ${r.octetsClairs} octets déchiffrés${attendu ? ', empreinte relevée au chiffrement ' + (attendu === r.sha256Clair ? 'identique' : 'DIFFÉRENTE') : ', aucune empreinte relevée au chiffrement'}${original ? ', original en clair ' + (original === r.sha256Clair ? 'identique' : 'DIFFÉRENT') : ''}`);
    }
    process.exit(ecarts ? 1 : 0);
  } else if (commande === 'dechiffrer') {
    const chemin = option('--cle-privee');
    if (!chemin || args.length !== 2) throw new Error('Indiquer --cle-privee <fichier.pem> <fichier.chiffre> <sortie>');
    const r = await c.dechiffrerFichier(args[0], args[1], readFileSync(chemin, 'utf8'));
    console.log(`déchiffré : ${args[1]} (${r.octetsClairs} octets, sha256 ${r.sha256Clair})`);
  } else {
    console.error('Usage : chiffrer-sauvegardes.mjs generer-cles <dossier> | chiffrer --cle-publique <pem> <fichier…> | chiffrer-tout --cle-publique <pem> | verifier --cle-privee <pem> <fichier.chiffre…> | dechiffrer --cle-privee <pem> <fichier.chiffre> <sortie>');
    process.exit(2);
  }
} catch (e) {
  // Le message d'erreur ne contient jamais de contenu de clé.
  console.error(`ÉCHEC : ${e.message}`);
  process.exit(1);
}
