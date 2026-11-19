#!/usr/bin/env node
/**
 * Sauvegarde, restauration ISOLÉE et vérification du stockage objet LOCAL (développement et essai de restauration).
 * En production, la sauvegarde du stockage objet relève de l'hébergeur (versions, réplication : docs/deploiement.md).
 *
 *   node scripts/objets.mjs sauvegarder <manifeste.json>
 *       Copie TOUS les objets du bucket local dans var/sauvegardes/objets/ (fichiers adressés par empreinte SHA-256,
 *       donc jamais dupliqués d'une sauvegarde à l'autre) et écrit un manifeste : clé, taille, empreinte.
 *       Lecture seule sur le stockage source.
 *
 *   node scripts/objets.mjs restaurer <manifeste.json>
 *       Recharge le manifeste dans le stockage CIBLE décrit par ESSAI_S3_ENDPOINT / ESSAI_S3_ACCESS_KEY /
 *       ESSAI_S3_SECRET_KEY / ESSAI_S3_BUCKET. Refuse d'écrire dans le stockage de l'application.
 *
 *   node scripts/objets.mjs verifier <references.txt> <manifeste.json>
 *       Relit dans le stockage CIBLE chaque objet référencé par la base restaurée (lignes « clé empreinte » ; empreinte
 *       « - » quand la base n'en enregistre pas) et compare son SHA-256 à celui de la base, sinon à celui du manifeste.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../packages/plateforme/package.json', import.meta.url));
const { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const DEPOT = join(racine, 'var', 'sauvegardes', 'objets');
const cheminBlob = (sha) => join(DEPOT, sha.slice(0, 2), sha);

const client = (endpoint, cle, secret) => new S3Client({ endpoint, region: process.env.S3_REGION ?? 'local', forcePathStyle: true, credentials: { accessKeyId: cle, secretAccessKey: secret } });
const source = () => ({ s3: client(process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY), bucket: process.env.S3_BUCKET });
function cible() {
  const { ESSAI_S3_ENDPOINT: endpoint, ESSAI_S3_ACCESS_KEY: cle, ESSAI_S3_SECRET_KEY: secret, ESSAI_S3_BUCKET: bucket } = process.env;
  if (!endpoint || !cle || !secret || !bucket) throw new Error('Stockage cible non décrit (ESSAI_S3_ENDPOINT, ESSAI_S3_ACCESS_KEY, ESSAI_S3_SECRET_KEY, ESSAI_S3_BUCKET).');
  const normaliser = (u) => new URL(u).host.replace('localhost', '127.0.0.1');
  if (normaliser(endpoint) === normaliser(process.env.S3_ENDPOINT)) throw new Error('Refus : le stockage cible est celui de l’application. Une restauration d’essai ne s’y écrit jamais.');
  return { s3: client(endpoint, cle, secret), bucket };
}

async function lister({ s3, bucket }) {
  const objets = [];
  let suite;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: suite }));
    for (const o of r.Contents ?? []) objets.push({ cle: o.Key, taille: Number(o.Size), etag: o.ETag ?? null, modifie: o.LastModified?.toISOString() ?? null });
    suite = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (suite);
  return objets;
}

async function empreinteDe({ s3, bucket }, cle, versFichier) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: cle }));
  const h = createHash('sha256');
  let taille = 0;
  if (versFichier) {
    const sortie = createWriteStream(versFichier);
    await pipeline(r.Body, async function* (flux) {
      for await (const m of flux) {
        h.update(m);
        taille += m.length;
        yield m;
      }
    }, sortie);
  } else {
    for await (const m of r.Body) {
      h.update(m);
      taille += m.length;
    }
  }
  return { sha256: h.digest('hex'), taille };
}

async function sauvegarder(cheminManifeste) {
  const src = source();
  mkdirSync(DEPOT, { recursive: true });
  // Un objet déjà sauvegardé (même clé, taille, étiquette et date) n'est pas relu : son fichier est déjà au dépôt.
  const precedents = new Map();
  if (existsSync(join(DEPOT, 'dernier-manifeste.json'))) {
    for (const o of JSON.parse(readFileSync(join(DEPOT, 'dernier-manifeste.json'), 'utf8')).objets) precedents.set(o.cle, o);
  }
  const objets = await lister(src);
  let lus = 0;
  let octets = 0;
  for (const o of objets) {
    const p = precedents.get(o.cle);
    if (p && p.taille === o.taille && p.etag === o.etag && p.modifie === o.modifie && existsSync(cheminBlob(p.sha256))) {
      o.sha256 = p.sha256;
    } else {
      const provisoire = join(DEPOT, `.en-cours-${process.pid}`);
      const r = await empreinteDe(src, o.cle, provisoire);
      if (r.taille !== o.taille) throw new Error(`Taille lue différente de la taille annoncée pour ${o.cle}`);
      o.sha256 = r.sha256;
      mkdirSync(dirname(cheminBlob(r.sha256)), { recursive: true });
      if (existsSync(cheminBlob(r.sha256))) rmSync(provisoire);
      else renameSync(provisoire, cheminBlob(r.sha256));
      lus++;
    }
    octets += o.taille;
  }
  const manifeste = { cree: new Date().toISOString(), bucket: src.bucket, nombre: objets.length, octets, objets };
  writeFileSync(cheminManifeste, JSON.stringify(manifeste));
  writeFileSync(join(DEPOT, 'dernier-manifeste.json'), JSON.stringify(manifeste));
  console.log(`Stockage objet : ${objets.length} objet(s), ${(octets / 1e6).toFixed(1)} Mo au manifeste ; ${lus} relu(s) et copié(s), ${objets.length - lus} déjà au dépôt.`);
}

async function restaurer(cheminManifeste) {
  const dst = cible();
  const { objets } = JSON.parse(readFileSync(cheminManifeste, 'utf8'));
  try {
    await dst.s3.send(new HeadBucketCommand({ Bucket: dst.bucket }));
  } catch {
    await dst.s3.send(new CreateBucketCommand({ Bucket: dst.bucket }));
  }
  let octets = 0;
  for (const o of objets) {
    const fichier = cheminBlob(o.sha256);
    if (!existsSync(fichier) || statSync(fichier).size !== o.taille) throw new Error(`Fichier de sauvegarde absent ou tronqué pour ${o.cle}`);
    await dst.s3.send(new PutObjectCommand({ Bucket: dst.bucket, Key: o.cle, Body: createReadStream(fichier), ContentLength: o.taille }));
    octets += o.taille;
  }
  console.log(`Stockage d'essai : ${objets.length} objet(s) rechargé(s), ${(octets / 1e6).toFixed(1)} Mo.`);
}

async function verifier(cheminReferences, cheminManifeste) {
  const dst = cible();
  const parCle = new Map(JSON.parse(readFileSync(cheminManifeste, 'utf8')).objets.map((o) => [o.cle, o]));
  const references = readFileSync(cheminReferences, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
  const presents = new Set((await lister(dst)).map((o) => o.cle));
  let conformes = 0;
  let parLaBase = 0;
  const absents = [];
  const differents = [];
  for (const [cle, attenduBase] of references) {
    if (!presents.has(cle)) {
      absents.push(cle);
      continue;
    }
    const attendu = attenduBase !== '-' ? attenduBase : parCle.get(cle)?.sha256;
    const { sha256 } = await empreinteDe(dst, cle);
    if (sha256 !== attendu) differents.push(cle);
    else {
      conformes++;
      if (attenduBase !== '-') parLaBase++;
    }
  }
  console.log(`Objets référencés par la base restaurée : ${references.length} ; relus et conformes dans le stockage d'essai : ${conformes} (dont ${parLaBase} comparés à l'empreinte enregistrée en base, ${conformes - parLaBase} à celle du manifeste).`);
  if (absents.length) console.log(`ABSENTS du stockage restauré : ${absents.length} (ex. …${absents[0].slice(-40)})`);
  if (differents.length) console.log(`EMPREINTE DIFFÉRENTE : ${differents.length} (ex. …${differents[0].slice(-40)})`);
  if (absents.length || differents.length) process.exit(1);
}

const [commande, a, b] = process.argv.slice(2);
try {
  if (commande === 'sauvegarder' && a) await sauvegarder(a);
  else if (commande === 'restaurer' && a) await restaurer(a);
  else if (commande === 'verifier' && a && b) await verifier(a, b);
  else {
    console.error('Usage : objets.mjs sauvegarder <manifeste> | restaurer <manifeste> | verifier <références> <manifeste>');
    process.exit(2);
  }
} catch (e) {
  console.error(`ÉCHEC : ${e.message}`);
  process.exit(1);
}
