#!/usr/bin/env node
/**
 * Exemple FICTIF du dégressif sur déclaration JUSTIFIÉE du cabinet (D-150). Le calcul n'est jamais activé par défaut : ce script lance une SECONDE API
 * (port 4011, même base, variable AMORTISSEMENT_DEGRESSIF_ACTIVE=true) pour montrer la fonction ; l'API de la pile (variable absente) reste
 * inchangée et le prouve. Aucune écriture comptable n'est créée : seules des propositions sont calculées.
 *   node scripts/demo-degressif.mjs
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const env = {};
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); }
const API = 'http://127.0.0.1:4000';
const API_ACTIVE = 'http://127.0.0.1:4011';
const sortie = join(racine, 'var/captures/');
mkdirSync(sortie, { recursive: true });
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'ÉCHEC '} ${m}`); if (!c) process.exitCode = 1; };
const jeton = async (email) => (await (await fetch(`${env.OIDC_ISSUER}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env.DEV_MDP_UTILISATEURS, scope: 'openid' }) })).json()).access_token;
const T = await jeton('alice.admin@cabinet-a.test');
async function appel(base, methode, chemin, corps) {
  const bin = Buffer.isBuffer(corps);
  const r = await fetch(`${base}${chemin}`, { method: methode, headers: { authorization: `Bearer ${T}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps) : JSON.stringify(corps) });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {}
  return { statut: r.status, json, texte: t };
}
const api = (m, c, b) => appel(API, m, c, b);

// ── Seconde API, dégressif activé par l'ÉDITEUR (variable d'environnement) ──
const proc = spawn(process.execPath, ['dist/main.js'], { cwd: join(racine, 'apps/api'), env: { ...process.env, ...env, API_PORT: '4011', METRIQUES_PORT_API: '0', FILES_PREFIXE: 'demo-degressif', AMORTISSEMENT_DEGRESSIF_ACTIVE: 'true' }, stdio: 'ignore' });
try {
  for (let i = 0; i < 80; i++) { if (await fetch(`${API_ACTIVE}/v1/sante`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 500)); }
  // ── Dossier fictif et FEC minimal : capital, banque, acquisition d'une machine de 10 000 € le 5 novembre 2025 ──
  const dossier = (await api('POST', '/v1/dossiers', { raisonSociale: 'Atelier Démo Dégressif SAS (fictive)', territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [['11111111-1111-4111-8111-111111111101', 'validation']]) await api('PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau });
  const exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  const L = [];
  const e = (j, n, date, lignes, lib) => { for (const [c, cl, d, k] of lignes) L.push([j, j, n, date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t')); };
  e('AN', '0001', '20250101', [['512000', 'Banque', 50000, 0], ['101000', 'Capital', 0, 50000]], 'À-nouveaux');
  e('AC', '0002', '20251105', [['215400', 'Matériel industriel', 10000, 0], ['512000', 'Banque', 0, 10000]], 'Machine-outil');
  const contenu = Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\r\n' + L.join('\r\n') + '\r\n');
  const o = await api('POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  let dec = o.json.octetsRecus;
  while (dec < contenu.length) dec = (await api('PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('POST', `/v1/televersements/${o.json.id}/terminer`);
  let lot; for (let i = 0; i < 120; i++) { lot = (await api('GET', `/v1/imports/${fin.json.lotImportId}`)).json; if (['termine', 'termine_avec_erreurs', 'echec'].includes(lot?.statut)) break; await new Promise((r) => setTimeout(r, 500)); }
  ok(lot?.statut === 'termine', `dossier fictif ${dossier} : FEC importé`);

  // ── Déclaration du cabinet : mode, coefficient, éligibilité ET justification écrite ──
  const machine = { libelle: 'Machine-outil (fictive)', compteImmobilisation: '215400', baseAmortissable: '10000.00', dateAcquisition: '2025-11-05', dateMiseEnService: '2025-11-15', dureeMois: 120, modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true };
  const sans = await api('POST', `/v1/dossiers/${dossier}/immobilisations`, machine);
  ok(sans.statut === 400 && /justification écrite du cabinet/.test(sans.texte), `sans justification : refusé (${sans.statut}) — le choix et l'éligibilité ne sont jamais présumés`);
  const creee = await api('POST', `/v1/dossiers/${dossier}/immobilisations`, { ...machine, justificationDegressif: 'Machine-outil neuve, durée normale d’utilisation de 10 ans ; dégressif retenu par le cabinet pour traduire la consommation des avantages (exemple fictif).' });
  ok(creee.statut === 201 && creee.json.justificationDegressif.startsWith('Machine-outil neuve'), 'avec justification : enregistré (auteur et date conservés avec la justification)');

  // ── Pile normale (dégressif NON activé par l'éditeur) : abstention, aucun montant ──
  const normale = (await api('GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
  ok(normale.degressif.active === false && normale.abstentions.some((a) => a.code === 'degressif_non_active') && !normale.propositions.some((p) => p.type === 'dotation_amortissement_degressif'), 'API de la pile (variable absente) : « non activé », aucune proposition dégressive — inchangé');
  // ── Seconde API, activée par l'éditeur : proposition calculée, jamais comptabilisée ──
  const active = (await appel(API_ACTIVE, 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
  const p = active.propositions.find((x) => x.type === 'dotation_amortissement_degressif');
  ok(!!p && p.totalDebit === '375.00', `API activée : dotation dégressive proposée ${p?.totalDebit} € (exemple BOFiP : 10 000 €, 10 ans, 22,5 %, 2/12 : 375,00 €)`);
  ok(p.planAmortissement.length === 10 && p.planAmortissement.reduce((t, l) => t + Number(l.dotation), 0).toFixed(2) === '10000.00', 'plan de 10 exercices, somme exacte = 10 000,00');
  ok(p.hypotheses.some((h) => h.includes('Justification écrite du cabinet : « Machine-outil neuve')), 'la justification du cabinet figure TELLE QUELLE dans les hypothèses de la proposition');
  ok(p.reprise === null && (await api('GET', `/v1/exercices/${exercice}/ecritures-inventaire`)).json.length === 0, 'aucune écriture comptabilisée : la proposition attend la décision du cabinet');
  writeFileSync(`${sortie}demo-degressif.json`, JSON.stringify({ dossier, exercice, proposition: { totalDebit: p.totalDebit, lignes: p.lignes, plan: p.planAmortissement, hypotheses: p.hypotheses } }, null, 1));
  console.log(`\nPlan année par année :\n${p.planAmortissement.map((l) => `  ${l.exerciceFin}  ${l.methode.padEnd(9)} dotation ${l.dotation.padStart(9)}  VNC ${l.vnc.padStart(9)}`).join('\n')}`);
  console.log(`\nDossier : http://localhost:3100/dossiers/${dossier}/inventaire (propositions ici : dégressif « non activé » côté pile normale)`);
} finally {
  proc.kill('SIGTERM');
}
