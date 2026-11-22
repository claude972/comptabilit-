#!/usr/bin/env node
/**
 * Démonstration FICTIVE des reports 2059 → 2058-A, des feuillets du 2056 et du 2057 et du rapprochement du 2057 avec le projet de bilan (D-153, D-154), contre la pile locale.
 * Crée un dossier fictif (FEC avec créances, dettes, charges et produits constatés d'avance), saisit des valeurs NON NULLES, lit la liasse et vérifie : proposition WN
 * (jamais retenue sans saisie), rapprochements indicatifs avec écarts affichés et jamais corrigés, feuillets rapprochés des cases du 2056. Aucune décision fiscale.
 *   node scripts/demo-reports-feuillets.mjs [dossierId exerciceId]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const env = {};
for (const l of readFileSync(join(racine, '.env'), 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].trim(); }
const API = 'http://127.0.0.1:4000';
const WEB = 'http://localhost:3100';
const sortie = join(racine, 'var/captures/');
mkdirSync(sortie, { recursive: true });
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'ÉCHEC '} ${m}`); if (!c) process.exitCode = 1; };
const jeton = async (email) => (await (await fetch(`${env.OIDC_ISSUER}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env.DEV_MDP_UTILISATEURS, scope: 'openid' }) })).json()).access_token;
const T = await jeton('alice.admin@cabinet-a.test');
async function api(methode, chemin, corps) {
  const bin = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${T}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps) : JSON.stringify(corps) });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {}
  return { statut: r.status, json, texte: t };
}
let [dossier, exercice] = process.argv.slice(2);
if (!dossier) {
  dossier = (await api('POST', '/v1/dossiers', { raisonSociale: 'Atelier Démo Reports et Feuillets SAS (fictive)', territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [['11111111-1111-4111-8111-111111111101', 'validation'], ['11111111-1111-4111-8111-111111111102', 'revision']]) await api('PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau });
  exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  const L = []; let n = 0;
  const e = (j, date, lignes, lib) => { n++; for (const [c, cl, d, k] of lignes) L.push([j, j, String(n).padStart(4, '0'), date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t')); };
  e('AN', '20250101', [['512000', 'Banque', 200300, 0], ['101000', 'Capital', 0, 200000], ['106400', 'Réserves réglementées', 0, 300]], 'À-nouveaux');
  e('VT', '20250630', [['411000', 'Clients', 900, 0], ['416000', 'Clients douteux ou litigieux', 100, 0], ['706000', 'Prestations de services', 0, 1000]], 'Ventes');
  e('AC', '20250930', [['616000', 'Primes d’assurance', 50, 0], ['512000', 'Banque', 0, 50]], 'Assurance');
  e('OD', '20251231', [['486000', 'Charges constatées d’avance', 50, 0], ['616000', 'Primes d’assurance', 0, 50]], 'CCA');
  e('AC', '20251015', [['622600', 'Honoraires', 700, 0], ['401000', 'Fournisseurs', 0, 700]], 'Honoraires');
  e('OD', '20251231', [['706000', 'Prestations de services', 30, 0], ['487000', 'Produits constatés d’avance', 0, 30]], 'PCA');
  const contenu = Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\r\n' + L.join('\r\n') + '\r\n');
  const o = await api('POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  let dec = o.json.octetsRecus;
  while (dec < contenu.length) dec = (await api('PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('POST', `/v1/televersements/${o.json.id}/terminer`);
  let lot; for (let i = 0; i < 120; i++) { lot = (await api('GET', `/v1/imports/${fin.json.lotImportId}`)).json; if (['termine', 'termine_avec_erreurs', 'echec'].includes(lot?.statut)) break; await new Promise((r) => setTimeout(r, 500)); }
  ok(lot?.statut === 'termine', `dossier fictif ${dossier} : FEC importé`);

  const tab = async (tableau, ligne, valeurs, note = 'Saisie du cabinet pour la démonstration (fictive)') => { const r = await api('PUT', `/v1/exercices/${exercice}/tableaux/${tableau}/${ligne}`, { valeurs, note }); if (r.statut >= 300) console.log('  refus', tableau, ligne, r.statut, r.texte.slice(0, 200)); return r.statut < 300; };
  const cas = async (code, montant, note = 'Saisie du cabinet pour la démonstration (fictive)') => { const r = await api('PUT', `/v1/exercices/${exercice}/qualifications/renvois/${code}`, { montant, note }); if (r.statut >= 300) console.log('  refus', code, r.statut, r.texte.slice(0, 200)); return r.statut < 300; };
  // 2059-B : détail des plus-values à court terme des exercices antérieurs (total 2, colonne 3 = 40,00)
  const ligneB = (c) => ({ a: '100.00', b: '30.00', c, d: '50.00' });
  for (const [ligne, c] of [['T3N1', '20.00'], ['T3N2', '15.00'], ['T10N1', '5.00'], ...Array.from({ length: 8 }, (_, i) => [`T10N${i + 2}`, '0.00'])]) await tab('2059B_A', ligne, ligneB(c));
  // En-têtes cochables du 2059-B (déclarés explicitement) et rappels du 2059-C (montants)
  await tab('2059B_ENT', 'EU', { v: 'non' }); await tab('2059B_ENT', 'FUSION', { v: 'oui' }); await tab('2059B_ENT', 'APPIND', { v: 'non' });
  await tab('2059C_RAPPEL', 'R15', { m: '2000.00' }); await tab('2059C_RAPPEL', 'SPI', { m: '0.00' }); await tab('2059C_RAPPEL', 'T228', { m: '0.00' });
  // Reports entre 2059-B, 2059-D, 2058-A et 2051 (D-164) : cadre B du 2059-B (WO proposée : 20,00), réserve spéciale du 2059-D (ligne 7 = 250,00 au taux de 10 %), EF du 2051 saisi à 250,00, WQ du 2058-A saisi à 400,00
  await tab('2059B_B', '01', { origine: 'Fusion 2019 (fictive)', a: '100.00', b: '30.00', c: '20.00', d: '50.00' });
  const taux = (m) => ({ t10: m, t15: '0.00', t18: '0.00', t19: '0.00', t25: '0.00' });
  await tab('2059D_I', 'L1', taux('300.00')); await tab('2059D_I', 'L2', taux('0.00')); await tab('2059D_I', 'L4', taux('50.00')); await tab('2059D_I', 'L5', taux('0.00'));
  await tab('2059D_II', 'U', { c1: '40.00', c2: '0.00', c3: '20.00', c4: '0.00', c5: '30.00' });
  await cas('R51_EF', '250.00', 'Dont réserve spéciale des plus-values à long terme (renvoi 3), saisie du cabinet'); await cas('A58_WQ', '400.00', 'Réintégrations diverses (dont prélèvements sur la réserve spéciale), saisie du cabinet');
  // 2059-A : une cession (plus-value de 2 000 € à long terme, taux 15 %) et les sept lignes fixes
  await tab('2059A_IM', '01', { nature: 'Participation fictive (acquise le 2018-05-01)', c2: '10000.00', c3: '0.00', c4: '2000.00', c5: '1000.00', c6: '7000.00', c7: '9000.00', c8: '2000.00', c9: '0.00', c10a: '0.00', c10b: '2000.00', c10c: '0.00' });
  for (const l of ['13', '14', '15', '16']) await tab('2059A_AUT', l, { c9: '0.00' });
  for (const l of ['18', '19']) await tab('2059A_AUT', l, { c10a: '0.00', c10b: '0.00', c10c: '0.00' });
  await tab('2059A_AUT', '20', { c9: '500.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '10.00' });
  // Note annexe de la ligne 20 : détail 300 + 200 en colonne 9 (cohérent), 15 en colonne 11 contre 10 à la ligne 20 (écart affiché)
  await tab('2059A_NOTE', '01', { origine: 'Ajustement comptable / fiscal (fictif)', c9: '300.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '0.00' });
  await tab('2059A_NOTE', '02', { origine: 'Ajustement de calcul de plus-value (fictif)', c9: '200.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '15.00' });
  // 2058-A : WV saisi égal au cadre B 15 % ; WH saisi (100) différent du cadre B 0 % (0) : écart AFFICHÉ ; WN laissée sans saisie : proposition seulement
  await cas('A58_WV', '2000.00', 'Plus-value à long terme à 15 % (cession de titres fictive), reprise par le cabinet');
  await cas('A58_WH', '100.00', 'Montant saisi par le cabinet pour la démonstration : volontairement différent du 2059-A');
  // 2056 : ligne « Autres provisions pour risques et charges » (1) : début 1 500, dotations 200, reprises 100, fin 1 600 ; feuillet : deux années de constitution (reprises détaillées 90 : écart affiché)
  for (const [code, m] of [['P56_5V', '1500.00'], ['P56_5W', '200.00'], ['P56_5X', '100.00'], ['P56_5Y', '1600.00']]) await cas(code, m);
  await tab('2056_F_ARC', '01', { origine: 'Provision constituée en 2023', d: '1000.00', a: '0.00', r: '0.00', f: '1000.00' });
  await tab('2056_F_ARC', '02', { origine: 'Provision constituée en 2024', d: '500.00', a: '200.00', r: '90.00', f: '610.00' });
  // 2057 : lignes citées (VA, UX, VS, 8B, 8L) ; VS saisie 55 (le bilan porte 50 : écart affiché)
  const c = (m) => ({ c1: m, c2: m, c3: '0.00' });
  const d4 = (m) => ({ c1: m, c2: m, c3: '0.00', c4: '0.00' });
  await tab('2057_A', 'VA', c('100.00')); await tab('2057_A', 'UX', c('900.00')); await tab('2057_A', 'VS', c('55.00'));
  await tab('2057_B', '8B', d4('700.00')); await tab('2057_B', '8L', d4('30.00'));
  await tab('2057_F_PRET', '01', { origine: 'Actions fictives (prêtées)', m: '800.00' });
  await tab('2057_F_PRET', '02', { origine: 'Obligations fictives (remises en garantie)', m: '200.00' });
}
const liasse = (await api('GET', `/v1/exercices/${exercice}/liasse?regime=reel_normal`)).json;
writeFileSync(`${sortie}demo-reports-liasse.json`, JSON.stringify({ formulairesCases: liasse.formulairesCases, formulaire2059A: liasse.formulaire2059A, formulaire2057: liasse.formulaire2057, feuilles2058: liasse.feuilles2058 }, null, 1));
const f58 = liasse.formulairesCases.find((f) => f.id === '2058-A');
const caseA = (code) => f58.cases.find((x) => x.code === code);
const ctl = (code) => f58.controles.find((x) => x.code === `A58_${code}`);
ok(caseA('WN').statut === 'a_saisir' && caseA('WN').proposition?.montant === '40.00', `2058-A, WN : proposition ${caseA('WN').proposition?.montant} (total 2, colonne 3 du 2059-B), non retenue (statut ${caseA('WN').statut})`);
ok(['WV', 'WP', 'I6'].every((c) => caseA(c).proposition === null), 'WV, WH, WP, I6 : aucune proposition (la notice ne donne pas d’égalité)');
ok(liasse.formulaire2059A.cadreBParTaux.c10b.montant === '2000.00' && ctl('WV_2059A')?.statut === 'coherent', `WV saisi 2000,00 = cadre B 2059-A à 15 % : ${ctl('WV_2059A')?.statut}`);
ok(ctl('WH_2059A')?.statut === 'ecart' && ctl('WH_2059A').ecart === '100.00', `WH saisi 100,00 contre 0,00 au 2059-A : écart ${ctl('WH_2059A')?.ecart} AFFICHÉ, rien corrigé (WH reste ${caseA('WH').montant})`);
const g59b = liasse.grilles2059.find((g) => g.id === '2059-B'); const g59c = liasse.grilles2059.find((g) => g.id === '2059-C');
ok(g59b.cadres[0].lignes.map((l) => l.valeurs?.v).join(',') === 'non,oui,non' && g59b.etat === 'saisi' && g59c.cadres[0].lignes[0].valeurs.m === '2000.00', `2059-B : cases EU non / fusion oui / apport non ; 2059-C : rappel 15 % = ${g59c.cadres[0].lignes[0].valeurs.m} (les en-têtes ne changent pas l’état « saisi » : ${g59b.etat})`);
ok(caseA('WO').statut === 'a_saisir' && caseA('WO').proposition?.montant === '20.00', `2058-A, WO : proposition ${caseA('WO').proposition?.montant} (cadre B du 2059-B, colonne 3), non retenue`);
const g59d = liasse.grilles2059.find((g) => g.id === '2059-D'); const kd = (c) => g59d.controles.find((x) => x.code === `2059-D_${c}`);
ok(kd('L7_EF')?.statut === 'coherent' && kd('L7_DF')?.statut === 'coherent' && kd('C5_DF')?.statut === 'coherent' && kd('L4_WQ')?.statut === 'non_verifie' && kd('C3_WQ')?.statut === 'non_verifie', `2059-D : ligne 7 (250,00) = EF du 2051 et comprise dans DF (${kd('L7_EF')?.statut}/${kd('L7_DF')?.statut}), réserve du cadre II comprise dans DF (${kd('C5_DF')?.statut}), lignes à reporter en WQ : information sans verdict (${kd('L4_WQ')?.statut})`);
const g56 = liasse.feuilles2058.find((g) => g.id === '2056-FEUILLETS');
const k56 = (c) => g56.controles.find((x) => x.code === `2056-FEUILLETS_${c}`);
ok(k56('SOMME_D')?.statut === 'coherent' && k56('SOMME_A')?.statut === 'coherent' && k56('SOMME_F')?.statut === 'ecart' && k56('SOMME_R')?.statut === 'ecart', `feuillet 2056 (autres provisions pour risques et charges) : début ${k56('SOMME_D')?.statut}, dotations ${k56('SOMME_A')?.statut}, reprises ${k56('SOMME_R')?.statut} (${k56('SOMME_R')?.ecart}), fin ${k56('SOMME_F')?.statut} (${k56('SOMME_F')?.ecart})`);
const gn = liasse.feuilles2058.find((g) => g.id === '2059-A-NOTE');
const kn = (c) => gn.controles.find((x) => x.code === `2059-A-NOTE_${c}`);
ok(kn('SOMME_C9')?.statut === 'coherent' && kn('SOMME_C11')?.statut === 'ecart' && kn('SOMME_C11').ecart === '5.00', `note annexe de la ligne 20 du 2059-A : colonne 9 ${kn('SOMME_C9')?.statut} (500,00), colonne 11 ${kn('SOMME_C11')?.statut} (écart ${kn('SOMME_C11')?.ecart} affiché, jamais corrigé)`);
const k57 = (c) => liasse.formulaire2057.controles.find((x) => x.code === `2057_${c}`);
ok(k57('CLIENTS_BILAN')?.statut === 'coherent' && k57('FOURNISSEURS_BILAN')?.statut === 'coherent' && k57('PCA_BILAN')?.statut === 'coherent', 'rapprochement 2057 / projet de bilan : clients, fournisseurs et produits constatés d’avance cohérents');
ok(k57('CCA_BILAN')?.statut === 'ecart' && k57('CCA_BILAN').ecart === '5.00', `charges constatées d’avance : saisie 55,00 contre 50,00 au bilan : écart ${k57('CCA_BILAN')?.ecart} AFFICHÉ, jamais corrigé`);
console.log(`\nLien local : ${WEB}/dossiers/${dossier}/fiscal?vue=liasse`);
console.log(JSON.stringify({ dossier, exercice }));
