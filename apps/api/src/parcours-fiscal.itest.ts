/**
 * États fiscaux (lot 5) — pile réelle locale, cabinet NEUF : liasse (projet ou abstention), projet d'annexe et ses
 * confirmations, propositions d'écritures d'inventaire du moteur et leur reprise. Rien n'est jamais « validé » ici.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererFecSynthetique, MOTIF_DEGRESSIF_NON_ACTIVE } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apiSur, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';
let outreMer = '';
let exOutreMer = '';

// Seconde API, lancée avec AMORTISSEMENT_DEGRESSIF_ACTIVE=true : sert UNIQUEMENT à exercer le calcul du dégressif. L'API de la pile normale
// (variable absente, donc fausse) montre l'état par défaut, vérifié ci-dessous.
let apiActive: ChildProcess | null = null;
let urlApiActive = '';
let journalApiActive = '';
const racineApi = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDegressifActif = (qui: string, methode: string, chemin: string, corps?: unknown) => apiSur(urlApiActive, qui, methode, chemin, corps);

async function lancerApiDegressifActif(): Promise<void> {
  const libre = createServer();
  await new Promise<void>((r) => libre.listen(0, '127.0.0.1', () => r()));
  const port = (libre.address() as { port: number }).port;
  await new Promise<void>((r) => libre.close(() => r()));
  urlApiActive = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'test', API_PORT: String(port), METRIQUES_PORT_API: '0', FILES_PREFIXE: `essai-fiscal-${SEL}`, AMORTISSEMENT_DEGRESSIF_ACTIVE: 'true' };
  apiActive = spawn(process.execPath, ['dist/main.js'], { cwd: racineApi, env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiActive.stdout?.on('data', (d: Buffer) => (journalApiActive += d.toString()));
  apiActive.stderr?.on('data', (d: Buffer) => (journalApiActive += d.toString()));
  try {
    await attendre(() => fetch(`${urlApiActive}/v1/sante`).then((r) => r.ok, () => false), (ok) => ok, 40_000);
  } catch (e) {
    apiActive.kill('SIGKILL');
    throw new Error(`API « dégressif activé » non démarrée : ${(e as Error).message}\n${journalApiActive.slice(-1500)}`);
  }
}

async function creerDossier(nom: string, extra: Record<string, unknown>): Promise<{ dossier: string; exercice: string }> {
  const d = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, ...extra })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const ex = (await api('alice', 'POST', `/v1/dossiers/${d}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  return { dossier: d, exercice: ex };
}
async function importer(d: string, ex: string, graine: number) {
  const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 160, graine });
  const depot = await deposer('remi', d, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  await attendreLot('remi', depot.fin.json.lotImportId);
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai fiscal ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  ({ dossier, exercice } = await creerDossier(`Société d’essai fiscal ${SEL} SAS (fictive)`, { territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' }));
  ({ dossier: outreMer, exercice: exOutreMer } = await creerDossier(`Société d’essai outre-mer ${SEL} SAS (fictive)`, { territoireFiscal: 'martinique', formeJuridique: 'SAS', regimeFiscal: 'IS' }));
  await lancerApiDegressifActif();
}, 120_000);

afterAll(async () => {
  if (apiActive && apiActive.exitCode === null) {
    await new Promise<void>((r) => {
      const garde = setTimeout(() => apiActive?.kill('SIGKILL'), 20_000);
      apiActive?.once('exit', () => (clearTimeout(garde), r()));
      apiActive?.kill('SIGTERM');
    });
  }
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('états fiscaux — projets, jamais validés', () => {
  it('sans données comptables : rien n’est préparé (409), ni liasse, ni annexe, ni proposition', async () => {
    for (const chemin of ['liasse', 'annexe', 'inventaire/propositions']) {
      const r = await api('remi', 'GET', `/v1/exercices/${exercice}/${chemin}`);
      expect(r.statut, chemin).toBe(409);
      expect(r.json.message).toMatch(/Aucune donnée comptable/);
    }
  });

  it('liasse dans le périmètre : projet incomplet, tableaux 2050 à 2053, contrôles affichés, codes de cases « à confirmer », tableaux non couverts listés', async () => {
    await importer(dossier, exercice, Number.parseInt(SEL.slice(0, 6), 16));
    const r = await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`);
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ regimeDemande: 'reel_normal', regimeDeduit: false, teletransmission: 'non_disponible', donnees: { avantInventaire: true } });
    const l = r.json.resultat;
    expect(l).toMatchObject({ statut: 'projet', complet: false, table: { etat: 'en_attente_de_validation_professionnelle' } });
    expect(l.tableaux.map((t: any) => t.code)).toEqual(['2050', '2051', '2052', '2053']);
    expect(l.manques.length).toBeGreaterThan(0);
    expect(l.tableauxNonCouverts.length).toBeGreaterThan(5);
    const lignes = l.tableaux.flatMap((t: any) => t.lignes);
    expect(lignes.every((x: any) => x.etatCodeCase === 'a_confirmer' && x.codeCase === null)).toBe(true);
    expect(lignes.every((x: any) => typeof x.montant === 'string' && /^-?\d+\.\d{2}$/.test(x.montant))).toBe(true);
    expect(l.controles.length).toBeGreaterThan(0);
    // Cohérence avec le projet de bilan existant : même total de l'actif.
    const etats = (await api('remi', 'GET', `/v1/exercices/${exercice}/etats`)).json;
    expect(l.totaux.total_actif).toBe(etats.bilan.totaux.total_actif);
    // Régime simplifié : autres tableaux, toujours un projet.
    const s2 = (await api('remi', 'GET', `/v1/exercices/${exercice}/liasse?regime=reel_simplifie`)).json.resultat;
    expect(s2.tableaux.map((t: any) => t.code)).toEqual(['2033-A', '2033-B']);
    expect((await api('remi', 'GET', `/v1/exercices/${exercice}/liasse?regime=micro`)).statut).toBe(400);
  }, 120_000);

  it('hors périmètre (outre-mer) : ABSTENTION motivée, aucun chiffre', async () => {
    await importer(outreMer, exOutreMer, 4242);
    const r = (await api('remi', 'GET', `/v1/exercices/${exOutreMer}/liasse`)).json.resultat;
    expect(r.statut).toBe('abstention');
    expect(r.motifs.map((m: any) => m.code)).toContain('territoire_hors_perimetre');
    expect(r.tableaux).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/"montant"/);
  }, 120_000);

  it('caractéristique « à confirmer » (régime fiscal effacé) : abstention, puis de nouveau un projet une fois renseignée', async () => {
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { regimeFiscal: null })).statut).toBe(200);
    const r = (await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`)).json.resultat;
    expect(r.statut).toBe('abstention');
    expect(r.motifs.map((m: any) => m.code)).toContain('impot_a_confirmer');
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { regimeFiscal: 'IS' })).statut).toBe(200);
    expect((await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`)).json.resultat.statut).toBe('projet');
  });

  it('droits : le déposant et un autre cabinet n’y accèdent pas ; la collaboratrice lit mais ne confirme pas l’annexe', async () => {
    // Niveau « dépôt » : l'exercice lui-même n'est pas visible (politique de la base) — 404, son existence n'est pas révélée.
    expect((await api('client', 'GET', `/v1/exercices/${exercice}/liasse`)).statut).toBe(404);
    choisirCabinet('alice', null);
    expect((await api('bruno', 'GET', `/v1/exercices/${exercice}/annexe`)).statut).toBe(404);
    choisirCabinet('alice', cabinet);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/annexe`)).statut).toBe(200);
    expect((await api('chloe', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/ANX-831-1`, { etat: 'complete' })).statut).toBe(403);
    expect((await api('chloe', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'petite_entreprise' })).statut).toBe(403);
  });

  it('annexe : projet incomplet tant que les rubriques requises ne sont pas confirmées ; confirmation, retrait, catégorie déclarée', async () => {
    const lire = async () => (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json;
    const a = await lire();
    expect(a.resultat).toMatchObject({ statut: 'projet', complet: false, categorie: 'a_confirmer' });
    expect(a.categorieDeclaree).toBeNull();
    expect(a.categorieIndicative.mention).toMatch(/jamais appliquée d’office/);
    const requises = a.resultat.rubriques.filter((r: any) => r.requise);
    expect(requises.length).toBeGreaterThan(10);
    expect(a.resultat.rubriques.some((r: any) => r.statut === 'pre_rempli' && r.preRemplissage.length > 0)).toBe(true);
    expect(a.resultat.rubriques.some((r: any) => r.statut === 'a_completer' && r.aSaisir.length > 0)).toBe(true);
    const cible = requises[0].id;
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/ANX-inconnue`, { etat: 'complete' })).statut).toBe(404);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'validee' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'complete', note: 'Méthodes inchangées par rapport à l’exercice précédent.' })).statut).toBe(200);
    const b = await lire();
    expect(b.resultat.rubriques.find((r: any) => r.id === cible).confirmation).toBe('complete');
    expect(b.resultat.complet).toBe(false); // une seule rubrique confirmée ne rend pas l'annexe complète
    expect(b.confirmations).toEqual([expect.objectContaining({ rubrique: cible, etat: 'complete', aRevoir: false })]);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`)).statut).toBe(200);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`)).statut).toBe(404);
    // Catégorie déclarée : change les rubriques requises ; valeur inconnue refusée.
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'geante' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'micro_entreprise' })).statut).toBe(200);
    const c = await lire();
    expect(c.categorieDeclaree).toBe('micro_entreprise');
    expect(c.resultat.rubriques.filter((r: any) => r.requise).length).toBeLessThan(requises.length);
  });

  it('une confirmation d’annexe devient « à revoir » quand les données changent, et ne compte plus', async () => {
    const cible = (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json.resultat.rubriques.find((r: any) => r.requise).id;
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'non_applicable' })).statut).toBe(200);
    await importer(dossier, exercice, 777);
    const a = (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json;
    expect(a.confirmations.find((c: any) => c.rubrique === cible)).toMatchObject({ aRevoir: true });
    expect(a.resultat.rubriques.find((r: any) => r.id === cible).confirmation).toBeNull();
  }, 120_000);

  it('propositions du moteur : jamais enregistrées d’office ; reprise par la collaboratrice → écriture « proposée » d’origine moteur ; une seule reprise', async () => {
    // Une charge couvrant une période qui dépasse la clôture, reconnaissable dans son libellé, est ajoutée par un import de travail.
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 120, graine: 99 });
    // Lignes ajoutées en ASCII pur : elles se lisent de la même façon quel que soit l'encodage du fichier généré.
    const base = Buffer.from(fec.contenu);
    const sep = base.subarray(0, 400).toString('latin1').includes('\t') ? '\t' : '|';
    const ajout = (compte: string, lib: string, debit: string, credit: string) =>
      ['AC', 'Achats', 'ASS0001', '20251001', compte, lib, '', '', 'ASS-2025', '20251001', 'Assurance du 01/10/2025 au 30/09/2026', debit, credit, '', '', '20251001', '', ''].join(sep);
    const fin = base[base.length - 1] === 0x0a ? '' : '\n';
    const contenu = Buffer.concat([base, Buffer.from(`${fin}${ajout('616000', 'Primes d assurance', '1200,00', '0,00')}\n${ajout('401000', 'Fournisseurs', '0,00', '1200,00')}\n`, 'ascii')]);
    const depot = await deposer('remi', dossier, contenu, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', depot.fin.json.lotImportId);
    const liste = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    expect(liste.statut).toBe('projet');
    expect(liste.amortissements).toMatchObject({ proposes: false });
    const cca = liste.propositions.find((p: any) => p.type === 'charge_constatee_avance' && p.libelle.length > 0 && p.justification.includes('30/09/2026')) ?? liste.propositions.find((p: any) => p.type === 'charge_constatee_avance');
    expect(cca, JSON.stringify(liste.abstentions).slice(0, 400)).toBeTruthy();
    expect(cca).toMatchObject({ statut: 'proposee', equilibree: true, reprise: null });
    expect(cca.totalDebit).toBe(cca.totalCredit);
    expect(cca.calcul.length).toBeGreaterThan(0);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/ecritures-inventaire`)).json).toEqual([]); // rien n'est enregistré d'office
    // Le client déposant ne voit ni ne reprend ; un identifiant fantaisiste est refusé.
    expect((await api('client', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).statut).toBe(404);
    expect((await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/inconnue/reprise`)).statut).toBe(404);
    const reprise = await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(cca.id)}/reprise`);
    expect(reprise.statut).toBe(201);
    expect(reprise.json).toMatchObject({ origine: 'proposition_moteur', statut: 'proposee', totalDebit: cca.totalDebit });
    expect(reprise.json.origineDetail).toMatchObject({ regle: 'INV-CCA', propositionId: cca.id });
    expect((await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(cca.id)}/reprise`)).statut).toBe(409);
    const apres = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json.propositions.find((p: any) => p.id === cca.id);
    expect(apres.reprise).toMatchObject({ ecritureInventaireId: reprise.json.id, statut: 'proposee' });
    // Fichier des immobilisations SAISI par le cabinet : sans lui aucune dotation ; avec lui, une proposition linéaire équilibrée.
    expect(liste.propositions.some((p: any) => p.type === 'dotation_amortissement_lineaire')).toBe(false);
    const saisir = (corps: unknown, qui = 'chloe') => api(qui, 'POST', `/v1/dossiers/${dossier}/immobilisations`, corps);
    const immo = { libelle: 'Serveur de fichiers', compteImmobilisation: '218300', baseAmortissable: '12000.00', dateMiseEnService: '2025-07-01', dureeMois: 60 };
    expect((await saisir({ ...immo, baseAmortissable: '0.00' })).statut).toBe(400);
    expect((await saisir({ ...immo, compteImmobilisation: '606000' })).statut).toBe(400);
    expect((await saisir({ ...immo, baseAmortissable: 12000 })).statut).toBe(400); // nombre refusé : chaîne décimale exigée
    expect((await saisir(immo, 'client')).statut).toBeGreaterThanOrEqual(403);
    const cree = await saisir(immo);
    expect(cree.statut).toBe(201);
    const avecImmo = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    expect(avecImmo.amortissements).toMatchObject({ proposes: true });
    const dotation = avecImmo.propositions.find((p: any) => p.type === 'dotation_amortissement_lineaire');
    expect(dotation).toMatchObject({ equilibree: true, origine: { regle: 'INV-AMORT' }, totalDebit: '1200.00' }); // 12 000 € sur 60 mois, 6 mois en base 360
    expect(dotation.sources.immobilisation).toBe(cree.json.id);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json).toHaveLength(1);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${outreMer}/immobilisations/${cree.json.id}`)).statut).toBe(404); // autre dossier
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${cree.json.id}`)).statut).toBe(200);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json.propositions.some((p: any) => p.type === 'dotation_amortissement_lineaire')).toBe(false);
    // Circuit normal ensuite : l'auteure ne s'approuve pas elle-même ; le réviseur approuve.
    expect((await api('chloe', 'POST', `/v1/ecritures-inventaire/${reprise.json.id}/decision`, { decision: 'approuver' })).statut).toBeGreaterThanOrEqual(403);
    expect((await api('remi', 'POST', `/v1/ecritures-inventaire/${reprise.json.id}/decision`, { decision: 'approuver' })).statut).toBe(200);
  }, 180_000);
  it('dégressif NON ACTIVÉ par défaut : saisie possible, aucun calcul, aucune proposition, abstention motivée, aucune reprise', async () => {
    const saisir = (corps: unknown, qui = 'chloe') => api(qui, 'POST', `/v1/dossiers/${dossier}/immobilisations`, corps);
    const machine = { libelle: 'Machine-outil (défaut)', compteImmobilisation: '215400', baseAmortissable: '10000.00', dateAcquisition: '2025-11-05', dateMiseEnService: '2025-11-15', dureeMois: 120, modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true };
    // La date d'acquisition est obligatoire en dégressif, jamais postérieure à la mise en service, facultative en linéaire.
    expect((await saisir({ ...machine, dateAcquisition: undefined })).statut).toBe(400);
    expect((await saisir({ ...machine, dateAcquisition: null })).statut).toBe(400);
    expect((await saisir({ ...machine, dateAcquisition: '2025-11-16' })).statut).toBe(400);
    expect((await saisir({ ...machine, dateAcquisition: '2025-02-30' })).statut).toBe(400);
    expect((await saisir({ ...machine, dateAcquisition: '2025-11-15' })).statut).toBe(201); // même jour : accepté
    const lineaire = await saisir({ libelle: 'Camion', compteImmobilisation: '218200', baseAmortissable: '12000.00', dateMiseEnService: '2025-07-01', dureeMois: 60 });
    expect(lineaire.statut).toBe(201);
    expect(lineaire.json.dateAcquisition).toBeNull();
    expect((await saisir({ libelle: 'Camion bis', compteImmobilisation: '218200', baseAmortissable: '12000.00', dateAcquisition: '2025-08-01', dateMiseEnService: '2025-07-01', dureeMois: 60 })).statut).toBe(400);
    const creee = await saisir(machine);
    expect(creee.statut).toBe(201);
    expect(creee.json).toMatchObject({ modeAmortissement: 'degressif', dateAcquisition: '2025-11-05' });
    const liste = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    expect(liste.degressif).toEqual({ active: false, motif: MOTIF_DEGRESSIF_NON_ACTIVE });
    expect(liste.propositions.some((p: any) => p.type === 'dotation_amortissement_degressif')).toBe(false);
    const abstentions = liste.abstentions.filter((a: any) => a.type === 'dotation_amortissement_degressif');
    expect(abstentions).toHaveLength(2); // les deux machines saisies en dégressif
    for (const a of abstentions) {
      expect(a).toMatchObject({ code: 'degressif_non_active' });
      expect(a.motif).toContain(MOTIF_DEGRESSIF_NON_ACTIVE);
      expect(a.motif).not.toMatch(/\d+[.,]\d{2}/); // aucun montant
    }
    expect(liste.signalements).toEqual([]);
    // Le linéaire n'est pas concerné ; aucune écriture n'est proposée ni reprise pour le dégressif.
    expect(liste.propositions.find((p: any) => p.type === 'dotation_amortissement_lineaire')).toMatchObject({ totalDebit: '1200.00' });
    expect((await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(`INV-AMORT-DEG|${creee.json.id}`)}/reprise`)).statut).toBe(404);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/ecritures-inventaire`)).json.filter((e: any) => e.origineDetail?.regle === 'INV-AMORT-DEG')).toEqual([]);
    for (const i of (await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json) expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${i.id}`)).statut).toBe(200);
    // Même immobilisation sur une pile où l'éditeur a activé le calcul : la proposition apparaît (voir le test suivant pour le détail).
    expect((await apiDegressifActif('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json.degressif).toMatchObject({ active: true });
  }, 180_000);

  it('amortissements (dégressif ACTIVÉ sur une seconde API) : dégressif déclaré, valeur résiduelle, composants, sortie d’actif, rapprochement avec une dotation déjà comptabilisée, droits', async () => {
    const saisir = (corps: unknown, qui = 'chloe') => api(qui, 'POST', `/v1/dossiers/${dossier}/immobilisations`, corps);
    const propositions = async () => (await apiDegressifActif('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    const machine = { libelle: 'Machine-outil', compteImmobilisation: '215400', baseAmortissable: '10000.00', dateAcquisition: '2025-11-05', dateMiseEnService: '2025-11-15', dureeMois: 120, modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true };
    // Saisies refusées : le dégressif ne se devine pas ; chaque règle croisée est vérifiée côté serveur.
    const refus: Array<[string, Record<string, unknown>]> = [
      ['date d’acquisition manquante', { dateAcquisition: undefined }],
      ['date d’acquisition postérieure à la mise en service', { dateAcquisition: '2025-11-16' }],
      ['coefficient manquant', { coefficientDegressif: undefined }],
      ['coefficient incohérent avec la durée', { coefficientDegressif: '1.75' }],
      ['coefficient inconnu', { coefficientDegressif: '2.5' }],
      ['éligibilité non confirmée', { eligibiliteDegressifConfirmee: null }],
      ['durée non annuelle', { dureeMois: 54, coefficientDegressif: '1.75' }],
      ['durée inférieure à trois ans', { dureeMois: 24, coefficientDegressif: '1.25' }],
      ['compte incorporel', { compteImmobilisation: '205000' }],
      ['coefficient en mode linéaire', { modeAmortissement: 'lineaire' }],
      ['mode inconnu', { modeAmortissement: 'unites_d_oeuvre' }],
      ['valeur résiduelle égale à la valeur brute', { valeurResiduelle: '10000.00' }],
      ['valeur résiduelle négative', { valeurResiduelle: '-1.00' }],
      ['sortie avant la mise en service', { dateSortie: '2025-10-01' }],
      ['sortie impossible', { dateSortie: '2026-02-30' }],
      ['mise en service impossible', { dateMiseEnService: '2025-02-30' }],
      ['antérieurs supérieurs au montant amortissable', { amortissementsAnterieurs: '10000.01' }],
      ['structure introuvable', { composantDe: '00000000-0000-4000-8000-000000000000' }],
      ['structure invalide', { composantDe: 'pas-un-uuid' }],
      ['champ inconnu ignoré mais type erroné', { eligibiliteDegressifConfirmee: 'oui' }],
    ];
    for (const [nom, surcharge] of refus) expect((await saisir({ ...machine, ...surcharge })).statut, nom).toBe(400);
    expect((await saisir(machine, 'client')).statut).toBeGreaterThanOrEqual(403);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json).toHaveLength(0); // aucun refus n'a laissé de trace

    // Dégressif accepté : proposition équilibrée, plan année par année, point dérogatoire signalé, aucune écriture dérogatoire.
    const creee = await saisir(machine);
    expect(creee.statut).toBe(201);
    expect(creee.json).toMatchObject({ modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true, valeurResiduelle: null, dateSortie: null, composantDe: null });
    const liste = await propositions();
    const deg = liste.propositions.find((p: any) => p.type === 'dotation_amortissement_degressif');
    expect(deg, JSON.stringify(liste.abstentions).slice(0, 600)).toMatchObject({ equilibree: true, totalDebit: '375.00', origine: { regle: 'INV-AMORT-DEG', versionRegle: '1.1.0' }, reprise: null });
    expect(deg.planAmortissement).toHaveLength(10);
    expect(deg.planAmortissement.reduce((t: number, l: any) => t + Number(l.dotation), 0).toFixed(2)).toBe('10000.00');
    expect(deg.sourcesComplementaires.map((x: any) => x.verification)).toEqual(['verifiee', 'non_verifiee', 'verifiee', 'verifiee', 'verifiee', 'verifiee']);
    expect(deg.hypotheses.join(' ')).toMatch(/faculté de l’entreprise/);
    expect(liste.degressif.active).toBe(true);
    expect(deg.lignes.some((l: any) => /^(145|6872|7872)/.test(l.compteNum))).toBe(false);
    expect(liste.signalements).toEqual([expect.objectContaining({ code: 'amortissement_derogatoire', immobilisation: creee.json.id })]);
    expect(liste.rapprochement).toMatchObject({ dotations: expect.any(Array), comptes: expect.any(Array), comptesSansImmobilisation: expect.any(Array) });
    expect(liste.rapprochement.comptes.find((c: any) => c.compte === '2154')).toMatchObject({ etat: 'absent_de_la_balance' });
    // La reprise recalcule côté serveur et conserve l'origine de la règle.
    const reprise = await apiDegressifActif('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(deg.id)}/reprise`);
    expect(reprise.statut).toBe(201);
    expect(reprise.json.origineDetail).toMatchObject({ regle: 'INV-AMORT-DEG', type: 'dotation_amortissement_degressif' });
    expect(reprise.json.calcul).toMatch(/Taux dégressif : 22\.5 %/);
    expect(JSON.parse(JSON.stringify(reprise.json.lignes)).map((l: any) => l.compteNum)).not.toContain('145');

    // Valeur résiduelle, composants, sortie d'actif.
    const structure = await saisir({ libelle: 'Entrepôt — structure', compteImmobilisation: '213500', baseAmortissable: '150000.00', dateMiseEnService: '2025-01-01', dureeMois: 480 });
    expect(structure.statut).toBe(201);
    const toiture = await saisir({ libelle: 'Entrepôt — toiture', compteImmobilisation: '213500', baseAmortissable: '30000.00', valeurResiduelle: '3000.00', dateMiseEnService: '2025-01-01', dureeMois: 240, composantDe: structure.json.id });
    expect(toiture.statut).toBe(201);
    expect((await saisir({ libelle: 'Sous-composant', compteImmobilisation: '213500', baseAmortissable: '1000.00', dateMiseEnService: '2025-01-01', dureeMois: 60, composantDe: toiture.json.id })).statut).toBe(400); // un seul niveau
    const vendue = await saisir({ libelle: 'Camion cédé', compteImmobilisation: '218200', baseAmortissable: '20000.00', dateMiseEnService: '2022-03-01', dureeMois: 60, dateSortie: '2025-09-30' });
    expect(vendue.statut).toBe(201);
    const apres = await propositions();
    expect(apres.propositions.find((p: any) => p.id === `INV-AMORT|${structure.json.id}`)).toMatchObject({ totalDebit: '3750.00' }); // 150 000 ÷ 40 ans × 1 an
    expect(apres.propositions.find((p: any) => p.id === `INV-AMORT|${toiture.json.id}`)).toMatchObject({ totalDebit: '1350.00' }); // (30 000 − 3 000) ÷ 20 ans
    expect(apres.abstentions.find((a: any) => a.sources.immobilisation === vendue.json.id)).toMatchObject({ code: 'sortie_d_actif' });
    expect(apres.propositions.some((p: any) => p.sources.immobilisation === vendue.json.id)).toBe(false);
    // La structure ne se retire pas tant qu'un composant en dépend ; ensuite oui.
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${structure.json.id}`)).statut).toBe(409);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${toiture.json.id}`)).statut).toBe(200);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${structure.json.id}`)).statut).toBe(200);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${vendue.json.id}`)).statut).toBe(200);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${creee.json.id}`)).statut).toBe(200);

    // Rapprochement : une dotation déjà comptabilisée dans la comptabilité importée n'est jamais reproposée, l'écart est affiché.
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 60, graine: 4242 });
    const base = Buffer.from(fec.contenu);
    const sep = base.subarray(0, 400).toString('latin1').includes('\t') ? '\t' : '|';
    const ajout = (num: string, date: string, compte: string, lib: string, debit: string, credit: string) =>
      ['OD', 'Operations diverses', num, date, compte, lib, '', '', `P-${num}`, date, `Ecriture ${num}`, debit, credit, '', '', date, '', ''].join(sep);
    const fin = base[base.length - 1] === 0x0a ? '' : '\n';
    const lignes = [
      ajout('ACQ0001', '20250701', '218300', 'Materiel informatique', '12000,00', '0,00'),
      ajout('ACQ0001', '20250701', '404000', 'Fournisseurs immobilisations', '0,00', '12000,00'),
      ajout('DOT0001', '20251231', '681120', 'Dotations amortissements corporels', '1000,00', '0,00'),
      ajout('DOT0001', '20251231', '281830', 'Amortissements materiel informatique', '0,00', '1000,00'),
    ].join('\n');
    const depot = await deposer('remi', dossier, Buffer.concat([base, Buffer.from(`${fin}${lignes}\n`, 'ascii')]), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', depot.fin.json.lotImportId);
    const serveur = await saisir({ libelle: 'Serveur de fichiers', compteImmobilisation: '218300', baseAmortissable: '12000.00', dateMiseEnService: '2025-07-01', dureeMois: 60 });
    expect(serveur.statut).toBe(201);
    const rapp = await propositions();
    expect(rapp.propositions.some((p: any) => p.sources.immobilisation === serveur.json.id)).toBe(false); // pas de doublon
    expect(rapp.abstentions.find((a: any) => a.sources.immobilisation === serveur.json.id)).toMatchObject({ code: 'dotation_deja_comptabilisee' });
    expect(rapp.rapprochement.dotations.find((d: any) => d.compteDotation === '68112')).toMatchObject({ dotationComptabilisee: '1000.00', dotationCalculee: '1200.00', ecart: '-200.00', etat: 'differente', propositionsEcartees: true });
    expect(rapp.rapprochement.comptes.find((c: any) => c.compte === '2183')).toMatchObject({ valeurBruteSaisie: '12000.00', etat: expect.stringMatching(/^(concordant|ecart)$/) });
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${serveur.json.id}`)).statut).toBe(200);
    // Sans immobilisation saisie, le compte 2183 de la balance est signalé « à saisir ».
    const sansSaisie = await propositions();
    expect(sansSaisie.rapprochement.comptesSansImmobilisation.some((c: any) => c.compte.startsWith('2183'))).toBe(true);
    expect(sansSaisie.rapprochement.dotations).toEqual([]);
  }, 180_000);
});
