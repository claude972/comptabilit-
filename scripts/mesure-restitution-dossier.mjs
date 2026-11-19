#!/usr/bin/env node
/**
 * MESURE (environnement local) : mémoire du worker pendant la restitution EN FLUX d'un GROS dossier synthétique.
 * Crée un dossier d'essai FICTIF dans le cabinet de démonstration Bêta : un FEC volumineux et des pièces de grande
 * taille (contenu aléatoire, donc incompressible), puis demande sa restitution et relève la mémoire résidente du worker
 * toutes les 0,2 s. But : vérifier que la mémoire ne suit ni la taille totale du dossier, ni celle de ses originaux.
 * Ajoute durablement ce dossier et son archive aux données locales ; ne supprime rien.
 * Usage : node scripts/mesure-restitution-dossier.mjs [pièces=12] [Mo par pièce=45] [écritures=100000]
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { genererFecSynthetique } = await import('../packages/core/dist/index.js');
const [NB_PIECES, MO, ECRITURES] = [Number(process.argv[2] ?? 12), Number(process.argv[3] ?? 45), Number(process.argv[4] ?? 100000)];
const API = process.env.API_URL;
const marque = Date.now().toString(36);
const sha = (b) => createHash('sha256').update(b).digest('hex');

let acces;
let obtenuLe = 0;
async function jeton() {
  if (Date.now() - obtenuLe > 120_000) {
    const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: 'bruno.admin@cabinet-b.test', password: process.env.DEV_MDP_UTILISATEURS, scope: 'openid' }),
    });
    acces = (await r.json()).access_token;
    obtenuLe = Date.now();
  }
  return acces;
}
async function api(methode, chemin, corps) {
  const binaire = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${await jeton()}`, ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps) : JSON.stringify(corps),
  });
  if (r.status >= 400) throw new Error(`${methode} ${chemin} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => null);
}
async function deposer(entiteId, contenu, nomFichier, extra = {}) {
  const o = await api('POST', '/v1/televersements', { entiteId, nomFichier, taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur', ...extra });
  let decalage = o.octetsRecus;
  while (decalage < contenu.length) decalage = (await api('PUT', `/v1/televersements/${o.id}/morceaux?decalage=${decalage}`, contenu.subarray(decalage, decalage + o.tailleMorceau))).octetsRecus;
  return api('POST', `/v1/televersements/${o.id}/terminer`);
}
const attendre = async (lire, pret, delai = 900_000) => {
  for (const fin = Date.now() + delai; ; ) {
    const v = await lire();
    if (pret(v)) return v;
    if (Date.now() > fin) throw new Error('Délai dépassé');
    await new Promise((ok) => setTimeout(ok, 1000));
  }
};
const memoireWorker = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', readFileSync(new URL('../var/worker.pid', import.meta.url), 'utf8').trim()], { encoding: 'utf8' }).trim()) / 1024;

const moi = await api('GET', '/v1/moi');
console.log(`Préparation d'un gros dossier fictif (cabinet ${moi.cabinet.nom}) : ${NB_PIECES} pièces de ${MO} Mo, FEC de ${ECRITURES} écritures…`);
const dossier = (await api('POST', '/v1/dossiers', { raisonSociale: `Mesure restitution ${marque} (fictif)`, territoireFiscal: 'metropole' })).id;
await api('PUT', `/v1/dossiers/${dossier}/habilitations/${moi.utilisateur.id}`, { niveau: 'validation' });
const exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).id;
const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: ECRITURES, graine: Number.parseInt(marque.slice(-5), 36) % 1_000_000 });
const contenuFec = Buffer.from(fec.contenu);
const lot = await deposer(dossier, contenuFec, fec.nomFichier, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
const pieces = [];
for (let i = 0; i < NB_PIECES; i++) {
  // En-tête PDF suivi d'octets aléatoires : fichier unique, de taille connue, incompressible.
  const contenu = Buffer.concat([Buffer.from(`%PDF-1.4\n% piece de mesure ${marque}-${i}\n`), randomBytes(MO * 1024 * 1024)]);
  pieces.push((await deposer(dossier, contenu, `piece-${String(i + 1).padStart(2, '0')}.pdf`)).documentId);
}
await attendre(() => api('GET', `/v1/imports/${lot.lotImportId}`), (l) => ['termine', 'termine_avec_erreurs', 'echec'].includes(l.statut));
await attendre(() => api('GET', `/v1/exercices/${exercice}/revue`), (r) => ['termine', 'echec'].includes(r?.execution?.statut ?? ''));
for (const id of pieces) await attendre(() => api('GET', `/v1/documents/${id}`), (d) => !['recu', 'en_analyse'].includes(d.document.statut));
await new Promise((ok) => setTimeout(ok, 8000)); // laisser le worker revenir au repos
const totalOriginaux = contenuFec.length + NB_PIECES * (MO * 1024 * 1024 + 40);
console.log(`Dossier prêt : ${fec.nbLignes} lignes d'écriture, originaux ${(totalOriginaux / 1e6).toFixed(0)} Mo (plus gros : ${(Math.max(contenuFec.length, MO * 1024 * 1024) / 1e6).toFixed(0)} Mo).`);

const repos = memoireWorker();
let pic = repos;
let stop = false;
const releve = (async () => {
  while (!stop) {
    pic = Math.max(pic, memoireWorker());
    await new Promise((ok) => setTimeout(ok, 200));
  }
})();
const t0 = Date.now();
const demande = await api('POST', `/v1/dossiers/${dossier}/restitutions`);
const r = (await attendre(() => api('GET', `/v1/dossiers/${dossier}/restitutions`), (l) => ['termine', 'echec'].includes(l.find((x) => x.id === demande.id)?.statut))).find((x) => x.id === demande.id);
const duree = (Date.now() - t0) / 1000;
stop = true;
await releve;
if (r.statut !== 'termine') throw new Error(`Échec : ${r.erreur}`);
console.log(`Restitution : ${duree.toFixed(1)} s ; archive de ${(r.taille / 1e6).toFixed(0)} Mo ; ${r.resume.originaux} originaux restitués, ${r.resume.originauxExclus.length} exclu(s) ; ${r.resume.lignesEcriture} lignes d'écriture.`);
console.log(`Mémoire résidente du worker : ${repos.toFixed(0)} Mo au repos, ${pic.toFixed(0)} Mo au plus haut (relevé toutes les 0,2 s), soit +${(pic - repos).toFixed(0)} Mo pour une archive de ${(r.taille / 1e6).toFixed(0)} Mo.`);

mkdirSync(new URL('../var/mesures/', import.meta.url), { recursive: true });
const fichier = new URL(`../var/mesures/restitution-${demande.id}.zip`, import.meta.url);
const reponse = await fetch(`${API}/v1/restitutions/${demande.id}/archive`, { headers: { authorization: `Bearer ${await jeton()}` } });
const h = createHash('sha256');
await pipeline(Readable.fromWeb(reponse.body), async function* (flux) { for await (const m of flux) { h.update(m); yield m; } }, createWriteStream(fichier));
console.log(`Archive téléchargée : empreinte ${h.digest('hex') === r.sha256 ? 'identique à' : 'DIFFÉRENTE de'} celle enregistrée.`);
try {
  process.stdout.write(execFileSync('node', [fileURLToPath(new URL('./verifier-restitution.mjs', import.meta.url)), fileURLToPath(fichier), r.sha256], { encoding: 'utf8' }));
} finally {
  rmSync(fichier, { force: true });
}
