/**
 * Parcours de bout en bout sur la pile RÉELLE, immobilisations et amortissements NON NULS (D-148) : dossier fictif créé par l'API, FEC cohérent déposé,
 * fichier des immobilisations importé en XLSX PAR L'INTERFACE (aperçu sans écriture, confirmation explicite), liasse lue par l'API, état joint ouvert,
 * puis comparaison cellule par cellule de l'écran et du CSV avec les valeurs de l'API (2054, 2055 ; 2033-C au régime simplifié). Les contrôles de la
 * liasse (valeurs brutes, dotations) doivent être « ok » : la dotation comptabilisée est celle du moteur pour le nouveau poste.
 * Données synthétiques ; le nom du dossier est unique à chaque exécution.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { classeur, fec } from './donnees-parcours-immobilisations';
import { ordinateur } from './profils';

const env = (cle: string): string => {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = new RegExp(`^${cle}=(.*)$`, 'm').exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error(`${cle} absent`);
  return m[1]!.trim();
};
const API = 'http://127.0.0.1:4000';
const ALICE = '11111111-1111-4111-8111-111111111101';
const REMI = '11111111-1111-4111-8111-111111111102';

async function jeton(email: string): Promise<string> {
  const r = await fetch(`${env('OIDC_ISSUER')}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: env('DEV_MDP_UTILISATEURS'), scope: 'openid' }) });
  return ((await r.json()) as { access_token: string }).access_token;
}

type Cellule = { statut: 'etabli' | 'a_saisir' | 'abstention'; montant: string | null; motif: string | null };
type Cadre = { id: string; colonnes: Array<{ cle: string }>; lignes: Array<{ libelle: string; cellules: Record<string, Cellule> }> };
const attendu = (v: Cellule | undefined): string => (v === undefined ? '—' : v.statut === 'etabli' ? (v.montant ?? '') : v.statut === 'abstention' ? `abstention : ${v.motif ?? ''}` : '');

test('immobilisations et amortissements non nuls : FEC, import XLSX par l’interface, liasse, état joint écran et CSV concordants', async ({ browser }) => {
  const t = await jeton('alice.admin@cabinet-a.test');
  const api = async (methode: string, chemin: string, corps?: unknown) => {
    const bin = Buffer.isBuffer(corps);
    const r = await fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${t}`, ...(corps !== undefined ? { 'content-type': bin ? 'application/octet-stream' : 'application/json' } : {}) }, body: corps === undefined ? undefined : bin ? new Uint8Array(corps as Buffer) : JSON.stringify(corps) });
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { statut: r.status, json };
  };
  const nom = `Atelier parcours immobilisations ${Date.now()} SAS (fictive)`;
  const dossier = (await api('POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id as string;
  for (const [u, niveau] of [[ALICE, 'validation'], [REMI, 'revision']]) expect((await api('PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  const exercice = (await api('POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id as string;
  const contenu = fec('1300.93');
  const o = await api('POST', '/v1/televersements', { entiteId: dossier, nomFichier: '123456782FEC20251231.txt', taille: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex'), canal: 'ordinateur', usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' });
  expect(o.statut).toBe(201);
  let dec = o.json.octetsRecus as number;
  while (dec < contenu.length) dec = (await api('PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${dec}`, contenu.subarray(dec, dec + o.json.tailleMorceau))).json.octetsRecus;
  const fin = await api('POST', `/v1/televersements/${o.json.id}/terminer`);
  await expect.poll(async () => (await api('GET', `/v1/imports/${fin.json.lotImportId}`)).json?.statut, { timeout: 120_000 }).toBe('termine');

  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${dossier}/inventaire/reprise`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('alice.admin@cabinet-a.test');
  await page.locator('#password').fill(env('DEV_MDP_UTILISATEURS'));
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.waitForLoadState('networkidle');
  await page.goto(`/dossiers/${dossier}/inventaire/reprise`);
  await expect(page.getByRole('heading', { name: 'Reprise du fichier des immobilisations (import CSV ou XLSX)' })).toBeVisible();

  // Import XLSX par l'interface : l'aperçu n'écrit rien, la validation exige une confirmation explicite.
  const avant = (await api('GET', `/v1/dossiers/${dossier}/immobilisations`)).json;
  await page.getByLabel('Fichier des immobilisations (CSV ou XLSX)').setInputFiles({ name: 'immobilisations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: classeur() });
  await expect(page.getByTestId('apercu-reprise')).toBeVisible();
  await expect(page.getByTestId('decomptes-apercu')).toContainText('Valides : 4');
  await expect(page.getByTestId('classeur-xlsx')).toBeVisible();
  expect((await api('GET', `/v1/dossiers/${dossier}/immobilisations`)).json).toEqual(avant);
  const valider = page.getByRole('button', { name: /Valider l’import de 4 immobilisations/ });
  await expect(valider).toBeDisabled();
  await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check();
  await valider.click();
  await expect(page.getByTestId('decomptes-reprise')).toContainText('Créées : 4');

  for (const regime of ['reel_normal', 'reel_simplifie'] as const) {
    const liasse = (await api('GET', `/v1/exercices/${exercice}/liasse?regime=${regime}`)).json;
    const imm = liasse.tableauxImmobilisations;
    expect(imm.statut).toBe('projet');
    // Contrôles de la liasse : valeurs brutes et dotations concordent avec la balance, la dotation comptabilisée est celle du moteur.
    for (const code of ['valeur_brute_egale_projet_de_bilan', 'fichier_valeurs_brutes', 'fichier_dotations', 'dotations_egales_compte_6811']) {
      expect(imm.controles.find((c: any) => c.code === code)?.statut, `contrôle ${code} (${regime})`).toBe('ok');
    }
    await page.goto(`/dossiers/${dossier}/fiscal/etat-joint?exercice=${exercice}&regime=${regime}`);
    await expect(page.getByTestId('etat-joint')).toBeVisible();
    let nonNulles = 0;
    const csv = decodeURIComponent((await page.getByTestId('export-csv-etat-joint').getAttribute('href'))!.replace('data:text/csv;charset=utf-8,', '')).split('\r\n');
    for (const tab of imm.tableaux as Array<{ code: string; intitule: string; cadres: Array<Cadre & { titre: string }> }>) {
      for (const c of tab.cadres) {
        const lignes = page.locator(`[data-tableau-joint="${tab.code}/${c.id}"] tbody tr`);
        await expect(lignes).toHaveCount(c.lignes.length);
        const i0 = csv.findIndex((l) => l.startsWith(`${tab.code} — ${tab.intitule} — ${c.titre}`));
        expect(i0, `CSV : tableau ${tab.code}/${c.id}`).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < c.lignes.length; i++) {
          const cellules = await lignes.nth(i).locator('td').allInnerTexts();
          const champs = csv[i0 + 3 + i]!.split(';');
          c.colonnes.forEach((col, j) => {
            const a = attendu(c.lignes[i]!.cellules[col.cle]);
            expect(cellules[j + 2], `écran ${tab.code}/${c.id} ${c.lignes[i]!.libelle} ${col.cle}`).toBe(a);
            if (!champs[j + 2]!.startsWith('"')) expect(champs[j + 2], `CSV ${tab.code}/${c.id} ${c.lignes[i]!.libelle} ${col.cle}`).toBe(a);
            if (/^-?\d+\.\d\d$/.test(a) && Number(a) !== 0) nonNulles++;
          });
        }
      }
    }
    // Des valeurs RÉELLES, non nulles : ni zéros partout, ni test unitaire seul.
    expect(nonNulles, `cellules non nulles (${regime})`).toBeGreaterThan(20);
  }
  const clotureBrute = (await api('GET', `/v1/exercices/${exercice}/liasse?regime=reel_normal`)).json.tableauxImmobilisations.tableaux.find((x: any) => x.code === '2054').cadres.find((c: any) => c.id === 'B');
  expect(clotureBrute.lignes.find((l: any) => l.libelle.startsWith('Total général')).cellules.cloture.montant).toBe('177000.00');
  await contexte.close();
});
