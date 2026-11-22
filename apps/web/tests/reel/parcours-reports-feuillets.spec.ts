/**
 * Parcours sur la pile RÉELLE (D-153, D-154) : dossier fictif avec créances, dettes et comptes de régularisation ; saisies NON NULLES des 2059-A, 2059-B, 2056, 2057 et 2058-A ;
 * vérifie la PROPOSITION de la ligne WN (jamais retenue sans saisie), les rapprochements indicatifs avec écarts affichés et jamais corrigés, les feuillets du 2056 et du 2057,
 * et leur affichage à l'écran. Aucune décision fiscale ; données synthétiques ; nom du dossier unique à chaque exécution.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { ordinateur } from './profils';

const env = (cle: string): string => {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = new RegExp(`^${cle}=(.*)$`, 'm').exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error(`${cle} absent`);
  return m[1]!.trim();
};
const API = 'http://127.0.0.1:4000';
const jeton = async (email: string): Promise<string> => {
  const r = await fetch(`${env('OIDC_ISSUER')}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env('DEV_MDP_UTILISATEURS'), scope: 'openid' }) });
  return ((await r.json()) as { access_token: string }).access_token;
};

function fec(): Buffer {
  const L: string[] = [];
  let n = 0;
  const e = (j: string, date: string, lignes: Array<[string, string, number, number]>, lib: string) => {
    n++;
    for (const [c, cl, d, k] of lignes) L.push([j, j, String(n).padStart(4, '0'), date, c, cl, '', '', `${j}-${n}`, date, lib, d.toFixed(2).replace('.', ','), k.toFixed(2).replace('.', ','), '', '', date, '', ''].join('\t'));
  };
  e('AN', '20250101', [['512000', 'Banque', 200000, 0], ['101000', 'Capital', 0, 200000]], 'À-nouveaux');
  e('VT', '20250630', [['411000', 'Clients', 900, 0], ['416000', 'Clients douteux ou litigieux', 100, 0], ['706000', 'Prestations de services', 0, 1000]], 'Ventes');
  e('AC', '20250930', [['616000', 'Primes d’assurance', 50, 0], ['512000', 'Banque', 0, 50]], 'Assurance');
  e('OD', '20251231', [['486000', 'Charges constatées d’avance', 50, 0], ['616000', 'Primes d’assurance', 0, 50]], 'CCA');
  e('AC', '20251015', [['622600', 'Honoraires', 700, 0], ['401000', 'Fournisseurs', 0, 700]], 'Honoraires');
  e('OD', '20251231', [['706000', 'Prestations de services', 30, 0], ['487000', 'Produits constatés d’avance', 0, 30]], 'PCA');
  return Buffer.from(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t') + '\r\n' + L.join('\r\n') + '\r\n');
}

test('reports 2059 → 2058-A, feuillets du 2056 et du 2057, rapprochement du 2057 avec le bilan : valeurs non nulles, écarts affichés, rien de décidé', async ({ browser }) => {
  const t = await jeton('alice.admin@cabinet-a.test');
  const api = async (methode: string, chemin: string, corps?: unknown) => {
    const bin = Buffer.isBuffer(corps);
    const r = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${t}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps as Buffer) : JSON.stringify(corps) });
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { statut: r.status, json, texte };
  };
  const dossier = (await api('POST', '/v1/dossiers', { raisonSociale: `Atelier reports feuillets ${Date.now()} SAS (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, niveau] of [['11111111-1111-4111-8111-111111111101', 'validation'], ['11111111-1111-4111-8111-111111111102', 'revision']]) await api('PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau });
  const exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id as string;
  const contenu = fec();
  const o = await api('POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  expect(o.statut).toBe(201);
  let dec = o.json.octetsRecus as number;
  while (dec < contenu.length) dec = (await api('PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('POST', `/v1/televersements/${o.json.id}/terminer`);
  await expect.poll(async () => (await api('GET', `/v1/imports/${fin.json.lotImportId}`)).json?.statut, { timeout: 120_000 }).toBe('termine');

  const tab = async (tableau: string, ligne: string, valeurs: Record<string, string>) => expect((await api('PUT', `/v1/exercices/${exercice}/tableaux/${tableau}/${ligne}`, { valeurs, note: 'Saisie du cabinet pour l’essai (fictive)' })).statut, `${tableau} ${ligne}`).toBeLessThan(300);
  const cas = async (code: string, montant: string) => expect((await api('PUT', `/v1/exercices/${exercice}/qualifications/renvois/${code}`, { montant, note: 'Saisie du cabinet pour l’essai (fictive)' })).statut, code).toBeLessThan(300);

  // Avant toute saisie : aucune proposition, aucun rapprochement.
  const vide = (await api('GET', `/v1/exercices/${exercice}/liasse?regime=reel_normal`)).json;
  const f0 = vide.formulairesCases.find((f: any) => f.id === '2058-A');
  expect(f0.cases.find((c: any) => c.code === 'WN').proposition).toBeNull();
  expect(f0.controles.some((c: any) => c.code.endsWith('_2059A'))).toBe(false);

  const lignesB: Array<[string, string]> = [['T3N1', '20.00'], ['T3N2', '15.00'], ['T10N1', '5.00'], ...Array.from({ length: 8 }, (_, k): [string, string] => [`T10N${k + 2}`, '0.00'])];
  for (const [ligne, c] of lignesB) await tab('2059B_A', ligne, { a: '100.00', b: '30.00', c, d: '50.00' });
  await tab('2059B_ENT', 'EU', { v: 'non' }); await tab('2059B_ENT', 'FUSION', { v: 'oui' }); await tab('2059B_ENT', 'APPIND', { v: 'non' });
  await tab('2059C_RAPPEL', 'R15', { m: '2000.00' }); await tab('2059C_RAPPEL', 'SPI', { m: '0.00' }); await tab('2059C_RAPPEL', 'T228', { m: '0.00' });
  await tab('2059A_IM', '01', { nature: 'Participation fictive', c2: '10000.00', c3: '0.00', c4: '2000.00', c5: '1000.00', c6: '7000.00', c7: '9000.00', c8: '2000.00', c9: '0.00', c10a: '0.00', c10b: '2000.00', c10c: '0.00' });
  for (const l of ['13', '14', '15', '16']) await tab('2059A_AUT', l, { c9: '0.00' });
  for (const l of ['18', '19']) await tab('2059A_AUT', l, { c10a: '0.00', c10b: '0.00', c10c: '0.00' });
  await tab('2059A_AUT', '20', { c9: '500.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '10.00' });
  await tab('2059A_NOTE', '01', { origine: 'Ajustement comptable / fiscal (fictif)', c9: '300.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '0.00' });
  await tab('2059A_NOTE', '02', { origine: 'Ajustement de calcul de plus-value (fictif)', c9: '200.00', c10a: '0.00', c10b: '0.00', c10c: '0.00', c11: '15.00' });
  await cas('A58_WV', '2000.00');
  await cas('A58_WH', '100.00');
  for (const [code, m] of [['P56_5V', '1500.00'], ['P56_5W', '200.00'], ['P56_5X', '100.00'], ['P56_5Y', '1600.00']] as Array<[string, string]>) await cas(code, m);
  await tab('2056_F_ARC', '01', { origine: 'Provision constituée en 2023', d: '1000.00', a: '0.00', r: '0.00', f: '1000.00' });
  await tab('2056_F_ARC', '02', { origine: 'Provision constituée en 2024', d: '500.00', a: '200.00', r: '90.00', f: '610.00' });
  const c3 = (m: string) => ({ c1: m, c2: m, c3: '0.00' });
  const c4 = (m: string) => ({ c1: m, c2: m, c3: '0.00', c4: '0.00' });
  await tab('2057_A', 'VA', c3('100.00')); await tab('2057_A', 'UX', c3('900.00')); await tab('2057_A', 'VS', c3('55.00'));
  await tab('2057_B', '8B', c4('700.00')); await tab('2057_B', '8L', c4('30.00'));
  await tab('2057_F_PRET', '01', { origine: 'Actions fictives', m: '800.00' });

  const liasse = (await api('GET', `/v1/exercices/${exercice}/liasse?regime=reel_normal`)).json;
  const f58 = liasse.formulairesCases.find((f: any) => f.id === '2058-A');
  const cas58 = (code: string) => f58.cases.find((c: any) => c.code === code);
  const ctl = (code: string) => f58.controles.find((c: any) => c.code === `A58_${code}`);
  expect(cas58('WN')).toMatchObject({ statut: 'a_saisir', montant: null, proposition: { montant: '40.00' } }); // proposée, jamais retenue
  for (const c of ['WV', 'WH', 'WP', 'I6']) expect(cas58(c).proposition, c).toBeNull();
  expect(liasse.formulaire2059A.cadreBParTaux.c10b).toEqual({ statut: 'etabli', montant: '2000.00' });
  expect(ctl('WV_2059A').statut).toBe('coherent');
  expect(ctl('WH_2059A')).toMatchObject({ statut: 'ecart', ecart: '100.00' });
  expect(cas58('WH').montant).toBe('100.00'); // jamais corrigé
  const g56 = liasse.feuilles2058.find((g: any) => g.id === '2056-FEUILLETS');
  const k56 = (c: string) => g56.controles.find((x: any) => x.code === `2056-FEUILLETS_${c}`);
  expect([k56('SOMME_D').statut, k56('SOMME_A').statut, k56('SOMME_R').statut, k56('SOMME_F').statut]).toEqual(['coherent', 'coherent', 'ecart', 'ecart']);
  const g59b = liasse.grilles2059.find((g: any) => g.id === '2059-B');
  expect(g59b.cadres[0].lignes.map((l: any) => l.valeurs?.v)).toEqual(['non', 'oui', 'non']);
  expect(liasse.grilles2059.find((g: any) => g.id === '2059-C').cadres[0].lignes[0].valeurs).toEqual({ m: '2000.00' });
  const kn = (c: string) => liasse.feuilles2058.find((g: any) => g.id === '2059-A-NOTE').controles.find((x: any) => x.code === `2059-A-NOTE_${c}`);
  expect(kn('SOMME_C9').statut).toBe('coherent');
  expect(kn('SOMME_C11')).toMatchObject({ statut: 'ecart', ecart: '5.00' });
  const k57 = (c: string) => liasse.formulaire2057.controles.find((x: any) => x.code === `2057_${c}`);
  expect(['CLIENTS_BILAN', 'FOURNISSEURS_BILAN', 'PCA_BILAN'].map((c) => k57(c).statut)).toEqual(['coherent', 'coherent', 'coherent']);
  expect(k57('CCA_BILAN')).toMatchObject({ statut: 'ecart', ecart: '5.00' });
  expect(liasse.feuilles2058.find((g: any) => g.id === '2057-FEUILLETS').cadres[0].calculs[0].cellules.m).toMatchObject({ statut: 'etabli', montant: '800.00' });

  // À l'écran : la proposition et les écarts sont lisibles ; l'état joint reprend les feuillets.
  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${dossier}/fiscal?vue=liasse`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(env('DEV_MDP_UTILISATEURS'));
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.waitForLoadState('networkidle');
  await page.goto(`/dossiers/${dossier}/fiscal?vue=liasse`);
  await expect(page.getByText(/Total 2 de la colonne 3 du cadre A du 2059-B/).first()).toBeVisible();
  await expect(page.getByText(/dont par taux : 19 %/).first()).toBeVisible();
  await expect(page.getByText(/Formulaire déposé au titre de l’IR/).first()).toBeVisible();
  await expect(page.getByText(/Rappel de la plus-value de l’exercice relevant du taux de 15 %/).first()).toBeVisible();
  await expect(page.getByText(/voir également le tableau 2059-A.*sans énoncer d’égalité/).first()).toBeVisible();
  await expect(page.getByText(/charges constatées d’avance du projet de bilan.*55\.00 ici contre 50\.00/).first()).toBeVisible();
  await page.goto(`/dossiers/${dossier}/fiscal/etat-joint?exercice=${exercice}&regime=reel_normal`);
  await expect(page.locator('[data-tableau-joint="2056-FEUILLETS/2056_F_ARC"]')).toContainText('Provision constituée en 2024');
  await expect(page.locator('[data-tableau-joint="2057-FEUILLETS/2057_F_PRET"]')).toContainText('800.00');
  await contexte.close();
});
