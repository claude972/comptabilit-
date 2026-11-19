#!/usr/bin/env node
/**
 * MESURE (environnement local) : campagne d'import comptable sur N dossiers, par l'API réelle.
 * Crée N dossiers d'essai FICTIFS dans le cabinet de démonstration Bêta, y importe un petit FEC synthétique chacun,
 * et relève les durées. Ne supprime rien. Usage : node scripts/mesure-campagne.mjs [N=200] [écritures par FEC=150]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { genererFecSynthetique } = await import('../packages/core/dist/index.js');
const N = Number(process.argv[2] ?? 200);
const ECRITURES = Number(process.argv[3] ?? 150);
const API = process.env.API_URL;
const marque = Date.now().toString(36);

async function jeton() {
  const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: 'bruno.admin@cabinet-b.test', password: process.env.DEV_MDP_UTILISATEURS, scope: 'openid' }),
  });
  return (await r.json()).access_token;
}
let acces = await jeton();
let obtenuLe = Date.now();
async function api(methode, chemin, corps) {
  if (Date.now() - obtenuLe > 200_000) {
    acces = await jeton();
    obtenuLe = Date.now();
  }
  const binaire = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${acces}`, ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}) },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps) : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* vide */ }
  if (r.status >= 400) throw new Error(`${methode} ${chemin} → ${r.status} ${texte.slice(0, 200)}`);
  return json;
}
const moi = await api('GET', '/v1/moi');
const t0 = Date.now();
console.log(`Préparation de ${N} dossiers d'essai fictifs (cabinet ${moi.cabinet.nom})…`);
const dossiers = [];
for (let i = 0; i < N; i++) {
  const e = await api('POST', '/v1/dossiers', { raisonSociale: `Mesure ${marque} n° ${String(i + 1).padStart(3, '0')} (fictif)`, territoireFiscal: 'metropole' });
  await api('PUT', `/v1/dossiers/${e.id}/habilitations/${moi.utilisateur.id}`, { niveau: 'validation' });
  const ex = await api('POST', `/v1/dossiers/${e.id}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' });
  dossiers.push({ entiteId: e.id, exerciceId: ex.id });
}
const tPrepare = Date.now();
const campagne = await api('POST', '/v1/campagnes', { libelle: `Mesure ${marque} — ${N} dossiers`, type: 'fec' });
let lignes = 0;
let octets = 0;
for (const [i, d] of dossiers.entries()) {
  // Un dossier sur 25 reçoit un fichier illisible, pour vérifier l'isolation des échecs à cette échelle.
  const illisible = i % 25 === 24;
  const f = illisible ? { contenu: Buffer.from(`fichier illisible ${marque} ${i}\n`), nomFichier: 'illisible.txt', nbLignes: 0 } : genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: ECRITURES, graine: 1000 + i });
  const contenu = Buffer.from(f.contenu);
  lignes += f.nbLignes;
  octets += contenu.length;
  const o = await api('POST', '/v1/televersements', { entiteId: d.entiteId, nomFichier: f.nomFichier, taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: d.exerciceId, statutDonnees: 'travail_avant_cloture', campagneId: campagne.id });
  for (let p = 0; p < contenu.length; p += o.tailleMorceau) await api('PUT', `/v1/televersements/${o.id}/morceaux?decalage=${p}`, contenu.subarray(p, p + o.tailleMorceau));
  await api('POST', `/v1/televersements/${o.id}/terminer`);
}
const tDepose = Date.now();
let suivi;
for (;;) {
  suivi = await api('GET', `/v1/campagnes/${campagne.id}`);
  if (suivi.synthese.enCours === 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const tImporte = Date.now();
// Les contrôles sont lancés automatiquement après chaque import réussi : on attend la fin du dernier.
const reussis = suivi.elements.filter((e) => e.statut.startsWith('termine'));
for (;;) {
  let restants = 0;
  for (const e of reussis.slice(-10)) {
    const r = await api('GET', `/v1/exercices/${e.exerciceId}/revue`);
    if (r.execution?.statut !== 'termine') restants++;
  }
  if (restants === 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const tControle = Date.now();
const s = (a, b) => ((b - a) / 1000).toFixed(1);
console.log(JSON.stringify({
  dossiers: N,
  ecrituresParFichier: ECRITURES,
  lignesImportees: lignes,
  octetsDeposes: octets,
  parStatut: suivi.synthese.parStatut,
  echecsAttendus: Math.floor(N / 25),
  dossiersHorsHabilitation: suivi.dossiersHorsHabilitation,
  secondes: { preparationDesDossiers: s(t0, tPrepare), depotDesFichiers: s(tPrepare, tDepose), finDesImportsApresDernierDepot: s(tDepose, tImporte), finDesControlesApresImports: s(tImporte, tControle), depotJusquAuxControles: s(tPrepare, tControle) },
  campagneId: campagne.id,
}, null, 2));
