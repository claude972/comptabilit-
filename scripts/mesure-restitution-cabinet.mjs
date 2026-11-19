#!/usr/bin/env node
/**
 * MESURE (environnement local) : restitution du cabinet de démonstration Alpha (fictif), par l'API réelle, demandée par
 * son administratrice. Relève la durée, la taille de l'archive et la mémoire résidente du worker pendant la génération
 * (pour constater que l'archive est bien construite en flux), puis vérifie l'archive hors application.
 * Ajoute UNE archive au stockage local ; ne supprime rien. Usage : node scripts/mesure-restitution-cabinet.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const API = process.env.API_URL;
async function jeton() {
  const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: 'alice.admin@cabinet-a.test', password: process.env.DEV_MDP_UTILISATEURS, scope: 'openid' }),
  });
  return (await r.json()).access_token;
}
const appel = async (methode, chemin) => fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${await jeton()}` } });
const memoireWorker = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', readFileSync(new URL('../var/worker.pid', import.meta.url), 'utf8').trim()], { encoding: 'utf8' }).trim()) / 1024;

const perimetre = await (await appel('GET', '/v1/cabinet/restitutions/perimetre')).json();
console.log(`Périmètre : ${perimetre.inclus.length} dossier(s) inclus, ${perimetre.ecartes.length} écarté(s) (habilitations de la demandeuse).`);
const repos = memoireWorker();
const t0 = Date.now();
const demande = process.env.REPRENDRE ? { status: 202 } : await appel('POST', '/v1/cabinet/restitutions');
if (demande.status !== 202) throw new Error(`Demande refusée : ${demande.status} ${await demande.text()}`);
const { id } = process.env.REPRENDRE ? { id: process.env.REPRENDRE } : await demande.json();
let pic = repos;
let r;
for (;;) {
  await new Promise((ok) => setTimeout(ok, 500));
  pic = Math.max(pic, memoireWorker());
  r = (await (await appel('GET', '/v1/cabinet/restitutions')).json()).find((x) => x.id === id);
  if (['termine', 'echec'].includes(r.statut)) break;
}
const duree = (Date.now() - t0) / 1000;
if (r.statut !== 'termine') throw new Error(`Échec : ${r.erreur}`);
console.log(`Génération : ${duree.toFixed(1)} s ; archive de ${(r.taille / 1e6).toFixed(1)} Mo ; ${r.resume.originaux} originaux (${(r.resume.octetsOriginaux / 1e6).toFixed(1)} Mo), ${r.resume.lignesEcriture} lignes d'écriture.`);
console.log(`Mémoire résidente du worker : ${repos.toFixed(0)} Mo au repos, ${pic.toFixed(0)} Mo au plus haut pendant la génération (relevé toutes les 0,5 s).`);
console.log(`Journal d'audit (vérification stricte) : ${r.resume.journalAudit.verificationStricte} ; originaux non conformes : ${r.resume.originauxNonConformes.length} ; exclus : ${r.resume.originauxExclus.length}.`);

mkdirSync(new URL('../var/mesures/', import.meta.url), { recursive: true });
const fichier = new URL(`../var/mesures/restitution-cabinet-${id}.zip`, import.meta.url);
const t1 = Date.now();
const reponse = await appel('GET', `/v1/cabinet/restitutions/${id}/archive`);
const h = createHash('sha256');
await pipeline(Readable.fromWeb(reponse.body), async function* (flux) { for await (const m of flux) { h.update(m); yield m; } }, createWriteStream(fichier));
console.log(`Téléchargement : ${((Date.now() - t1) / 1000).toFixed(1)} s ; empreinte ${h.digest('hex') === r.sha256 ? 'identique à' : 'DIFFÉRENTE de'} celle enregistrée.`);
try {
  process.stdout.write(execFileSync('node', [fileURLToPath(new URL('./verifier-restitution.mjs', import.meta.url)), fileURLToPath(fichier), r.sha256], { encoding: 'utf8' }));
} finally {
  rmSync(fichier, { force: true });
}
