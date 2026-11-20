/**
 * Destinataire des pièces (D-091) — correction manuelle tracée et réanalyse explicite, sur la pile réelle locale
 * (Keycloak, API, worker avec processus enfant isolé, PostgreSQL, S3). Cabinets NEUFS à chaque exécution.
 *
 * Les pièces sont déposées et analysées par le worker réel ; les extractions « antérieures à D-084 » sont ensuite
 * fabriquées en retirant les clés du destinataire de l'extraction en vigueur (forme exacte de l'ancien analyseur).
 * Toutes les décisions passent par les routes de l'API, jamais par des écritures à la main.
 */
import { createHash, randomBytes } from 'node:crypto';
import { genererTexteFactureSynthetique, VERSION_ANALYSEUR_FACTURE } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const graine = 3000 + (Number.parseInt(SEL.slice(0, 4), 16) % 5000);
const AVEC = genererTexteFactureSynthetique({ graine, client: 'facture_a' });
const SANS = genererTexteFactureSynthetique({ graine, client: 'absent' });
const SIREN_DOSSIER = AVEC.attendu.emetteurSiren!;
const SIREN_CLIENT = AVEC.attendu.destinataireSiren!;
const SIREN_HUMAIN = '732829320';
const SIREN_HUMAIN_2 = '552100554';
const ANNEE = AVEC.attendu.dateEmission!.slice(0, 4);
const CLES_DESTINATAIRE = ['destinataireNom', 'destinataireSiren', 'destinataireSiret', 'destinataireTva', 'destinatairePays', 'destinataireAbstention', 'destinataireNonLuAuto', 'inchangeDepuis'];

let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let dossier2 = '';
let exercice = '';
const contenus = new Map<string, Buffer>();

/** Numéro de facture lisible par l'extraction, propre à chaque pièce. */
const numeroDe = (nom: string) => `FA-${ANNEE}-${String((Number.parseInt(sha(Buffer.from(`${SEL}${nom}`)).slice(0, 6), 16) % 9000) + 1000)}`;
function facture(client: boolean, nom: string) {
  const f = client ? AVEC : SANS;
  const lignes = f.pages[0]!.texte.split('\n').map((l) => (f.attendu.numero ? l.replaceAll(f.attendu.numero, numeroDe(nom)) : l));
  return pdfTexte(lignes, `${SEL}-${nom}`);
}
const attendreDocument = (id: string) => attendre(() => api('remi', 'GET', `/v1/documents/${id}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));
async function deposerVente(nom: string, client = true, entite = dossier, nature = 'facture_vente'): Promise<string> {
  const pdf = facture(client, nom);
  const d = await deposer('chloe', entite, pdf, { nature }, `${nom}.pdf`);
  expect(d.fin.statut).toBe(200);
  const id = d.fin.json.documentId as string;
  contenus.set(id, pdf);
  const doc = await attendreDocument(id);
  expect(doc.json.document.statut).toBe('a_controler');
  return id;
}
/** Rend l'extraction en vigueur semblable à celle de l'ancien analyseur (antérieure à D-084) : plus aucune clé du destinataire. */
async function vieillir(documentId: string): Promise<void> {
  const r = await editeur.query(`update extractions set champs = champs - 'destinataireNom' - 'destinataireSiren' - 'destinataireSiret' - 'destinataireTva' - 'destinatairePays' - 'destinataireAbstention' where document_id = $1 and actuelle`, [documentId]);
  expect(r.rowCount).toBe(1);
}
const lireDest = (id: string, qui = 'remi') => api(qui, 'GET', `/v1/documents/${id}/destinataire`);
const corriger = (id: string, champs: Record<string, unknown>, motif: string | null = 'Client lu sur le bon de commande', qui = 'remi') => api(qui, 'PUT', `/v1/documents/${id}/destinataire`, { champs, ...(motif === null ? {} : { motif }) });
const versionsBase = async (id: string) => (await editeur.query('select id, version, actuelle, statut, methode, moteur, champs from extractions where document_id = $1 order by version', [id])).rows;
const octets = async (id: string, qui = 'remi') => (await api(qui, 'GET', `/v1/documents/${id}/contenu`)).brut;
const sansDestinataire = (champs: Record<string, unknown>) => Object.fromEntries(Object.entries(champs).filter(([k]) => !CLES_DESTINATAIRE.includes(k)));
const attendreLotReanalyse = (id: string, qui = 'remi') => attendre(() => api(qui, 'GET', `/v1/reanalyses-destinataire/${id}`), (r) => r.statut === 200 && r.json.demande.statut === 'termine', 120_000);
const journalAudit = async (action: string, cible?: string) =>
  (await editeur.query(`select details, acteur_id, acteur_type from journal_audit where cabinet_id = $1 and action = $2 ${cible ? 'and cible_id = $3' : ''} order by id`, cible ? [cabinet, action, cible] : [cabinet, action])).rows;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai destinataire ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '60 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  const creer = async (nom: string, siren: string) => {
    const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, siren, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' });
    expect(d.statut).toBeLessThan(300);
    for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
      expect((await api('alice', 'PUT', `/v1/dossiers/${d.json.id}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
    }
    return d.json.id as string;
  };
  dossier = await creer(`Société d’essai destinataire ${SEL} SAS (fictive)`, SIREN_DOSSIER);
  dossier2 = await creer(`Seconde société d’essai destinataire ${SEL} SAS (fictive)`, SIREN_DOSSIER);
  exercice = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: `${ANNEE}-01-01`, fin: `${ANNEE}-12-31` })).json.id;
}, 180_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('correction manuelle du destinataire d’une pièce', () => {
  let H = '';
  let originalAvant: Buffer;
  let v1Avant: any;
  const ECRITURE = { cle: '' };

  it('la pièce sans client lisible : valeur automatique absente, abstention dite, sens relu d’après les identifiants ; l’original est servi', async () => {
    H = await deposerVente('hum', false);
    originalAvant = await octets(H);
    expect(sha(originalAvant)).toBe(sha(contenus.get(H)!));
    v1Avant = (await versionsBase(H))[0];
    const r = await lireDest(H);
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ extractionCourante: { version: 1, statut: 'projet' }, lectureAutomatiqueFaite: true, versionAnalyseurCourante: VERSION_ANALYSEUR_FACTURE, original: { sha256: sha(originalAvant) } });
    expect(r.json.abstention).toMatch(/\S/);
    expect(r.json.lignes.map((l: any) => l.source)).toEqual(['automatique', 'automatique', 'automatique', 'automatique', 'automatique']);
    expect(r.json.lignes.every((l: any) => l.effective === null && l.humain === null)).toBe(true);
    expect(r.json.effets).toMatchObject({ sensLu: { sens: 'vente', incoherence: false }, natureQualifiee: 'facture_vente', conflitNature: false, decisions: [] });
  });

  it('habilitations : déposant refusé, lecture seule refusée (correction), autre cabinet refusé, utilisateur sans habilitation refusé', async () => {
    expect((await lireDest(H, 'client')).statut).toBe(403);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, 'essai', 'client')).statut).toBe(403);
    expect((await lireDest(H, 'bruno')).statut).toBe(404);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, 'essai', 'bruno')).statut).toBe(404);
    // Niveau « lecture » : peut lire, ne peut pas corriger (mêmes gardes que la correction des champs : « collaboration »).
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.chloe}`, { niveau: 'lecture' })).statut).toBeLessThan(300);
    expect((await lireDest(H, 'chloe')).statut).toBe(200);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, 'essai', 'chloe')).statut).toBe(403);
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' })).statut).toBeLessThan(300);
    // Une personne habilitée sur un AUTRE dossier du même cabinet n'a pas accès à celui-ci.
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' })).statut).toBeLessThan(300);
    expect((await versionsBase(H))).toHaveLength(1);
  });

  it('entrées invalides refusées par le schéma et le moteur, sans aucune écriture : motif absent ou trop court, champ inconnu, SIREN à la clé fausse, aucun champ', async () => {
    const avant = await versionsBase(H);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, null)).statut).toBe(400);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, 'x')).statut).toBe(400);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN }, '   ')).statut).toBe(400);
    expect((await corriger(H, {})).statut).toBe(400);
    expect((await corriger(H, { emetteurSiren: SIREN_HUMAIN })).statut).toBe(400);
    expect((await corriger(H, { destinataireSiren: 42 })).statut).toBe(400);
    const faux = await corriger(H, { destinataireSiren: '732829321' });
    expect(faux.statut).toBe(400);
    expect(JSON.stringify(faux.json)).toMatch(/SIREN du destinataire/);
    expect((await corriger(H, { destinataireSiret: '73282932000075' })).statut).toBe(400);
    expect((await corriger(H, { destinataireTva: 'FR00732829320' })).statut).toBe(400);
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN, destinataireSiret: '55210055400013' })).statut).toBe(400); // SIRET qui ne commence pas par le SIREN
    expect((await api('remi', 'PUT', `/v1/documents/not-a-uuid/destinataire`, { champs: { destinataireSiren: SIREN_HUMAIN }, motif: 'essai' })).statut).toBe(400);
    expect(await versionsBase(H)).toEqual(avant);
  });

  it('une décision humaine d’appariement est prise AVANT la correction (client non lu : ligne confirmée à la main)', async () => {
    // Écriture de vente correspondant à la pièce, importée par le FEC du dossier.
    const a = AVEC.attendu;
    const d = a.dateEmission!.replaceAll('-', '');
    const ligne = (compte: string, lib: string, debit: string, credit: string, aux = ['', '']) =>
      ['VTE', 'Ventes', 'VTE0001', d, compte, lib, aux[0], aux[1], numeroDe('hum'), d, 'Facture client', debit.replace('.', ','), credit.replace('.', ','), '', '', d, '', ''].join('\t');
    const fec = [
      ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'].join('\t'),
      ligne('411000', 'Clients', a.totalTtc!, '0.00', ['C001', 'Client de démonstration (fictif)']),
      ligne('706000', 'Prestations', '0.00', a.totalHt!),
      ligne('445710', 'TVA collectée', '0.00', a.totalTva!),
    ].join('\r\n');
    const dep = await deposer('remi', dossier, Buffer.from(`${fec}\r\n`, 'utf8'), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, `${SIREN_DOSSIER}FEC${ANNEE}1231.txt`);
    expect(dep.fin.statut).toBe(200);
    const lotFec = await attendreLot('remi', dep.fin.json.lotImportId);
    expect(lotFec.json.statut, JSON.stringify(lotFec.json.rapport ?? lotFec.json).slice(0, 1500)).toBe('termine');
    ECRITURE.cle = 'VTE|VTE0001';
    const fiche = await api('remi', 'GET', `/v1/exercices/${exercice}/factures/${H}`);
    expect(fiche.statut).toBe(200);
    expect(fiche.json.facture).toMatchObject({ sens: 'vente', tiersPiece: null, comptabilisation: { statut: 'a_confirmer' } });
    const ok = await api('chloe', 'PUT', `/v1/exercices/${exercice}/factures/${H}/liens`, { type: 'comptabilisation', cible: ECRITURE.cle, decision: 'confirme' });
    expect(ok.statut).toBe(200);
    expect(ok.json.facture.comptabilisation).toBe('confirme');
  }, 120_000);

  it('correction par un collaborateur habilité : nouvelle version humaine, ancienne version et original intacts, décision d’appariement conservée et signalée, sens et tiers recalculés', async () => {
    const r = await corriger(H, { destinataireSiren: ` ${SIREN_HUMAIN.slice(0, 3)} ${SIREN_HUMAIN.slice(3)} `, destinataireNom: '  Client   Humain SAS ' }, 'Le client est écrit à la main sur la pièce', 'chloe');
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ extraction: { version: 2, statut: 'projet', methode: 'saisie_humaine' }, versionPrecedente: { version: 1, statut: 'projet' }, modifies: ['destinataireNom', 'destinataireSiren'] });
    expect(r.json.avant).toMatchObject({ destinataireSiren: null, destinataireNom: null });
    expect(r.json.apres).toMatchObject({ destinataireSiren: SIREN_HUMAIN, destinataireNom: 'Client Humain SAS' });
    expect(r.json.effets.sensLu).toMatchObject({ sens: 'vente', sirenDestinataire: SIREN_HUMAIN });
    expect(r.json.effets.decisions).toEqual([expect.objectContaining({ type: 'comptabilisation', decision: 'confirme', versionExtraction: 1, etat: 'conservee' })]);
    expect(r.json.effets.signalements.join(' ')).toMatch(/conservées telles quelles/);

    // Conservation : ancienne version strictement identique (hors bascule « actuelle »), original octet pour octet.
    const v = await versionsBase(H);
    expect(v.map((x) => [x.version, x.actuelle, x.methode])).toEqual([[1, false, v1Avant.methode], [2, true, 'saisie_humaine']]);
    expect(v[0].champs).toEqual(v1Avant.champs);
    expect(v[0]).toMatchObject({ id: v1Avant.id, statut: v1Avant.statut, moteur: v1Avant.moteur });
    expect(sansDestinataire(v[1].champs)).toEqual(sansDestinataire(v1Avant.champs));
    expect(Buffer.compare(await octets(H), originalAvant)).toBe(0);
    // Provenance champ par champ : qui, quand, pourquoi, valeur automatique remplacée.
    const g = (await lireDest(H)).json;
    const siren = g.lignes.find((l: any) => l.champ === 'destinataireSiren');
    expect(siren).toMatchObject({ effective: SIREN_HUMAIN, source: 'humain', humain: SIREN_HUMAIN, automatique: null, desaccord: true, corrigePar: DEMO.chloe, corrigeParNom: expect.stringMatching(/Chlo/), motif: 'Le client est écrit à la main sur la pièce' });
    expect(Date.parse(siren.corrigeLe)).toBeGreaterThan(Date.now() - 120_000);
    expect(g.historique.map((h: any) => [h.version, h.lectureAutomatiqueFaite])).toEqual([[1, true], [2, true]]);
    expect(g.historique[0].lignes.every((l: any) => l.source === 'automatique')).toBe(true);
    expect(g.historique[1].lignes.find((l: any) => l.champ === 'destinataireSiren').source).toBe('humain');
    // Décision humaine : conservée, pas « à revoir » ; le client est maintenant identifié par la pièce.
    const fiche = (await api('remi', 'GET', `/v1/exercices/${exercice}/factures/${H}`)).json.facture;
    expect(fiche).toMatchObject({ sens: 'vente', roleTiersPiece: 'destinataire', tiersPiece: { cle: `siren:${SIREN_HUMAIN}` }, comptabilisation: { statut: 'confirme' }, versionExtraction: 2 });
    expect(JSON.stringify(fiche.reserves)).toMatch(/avant la lecture ou la correction du destinataire : elle est conservée/);
    const aTraiter = (await api('remi', 'GET', `/v1/exercices/${exercice}/tiers-factures/a-traiter`)).json;
    expect(aTraiter.decisionsARevoir.filter((x: any) => x.objet === H)).toEqual([]);
    // Trace : décision humaine rattachée à la version, journal d'audit avec valeurs avant/après et motif.
    const decision = (await editeur.query(`select action, motif, version_cible, auteur_id from decisions where cible_id = $1`, [v[1].id])).rows;
    expect(decision).toEqual([{ action: 'corriger_destinataire', motif: 'Le client est écrit à la main sur la pièce', version_cible: 2, auteur_id: DEMO.chloe }]);
    const audit = await journalAudit('extraction.destinataire_corrige', H);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ acteur_id: DEMO.chloe, acteur_type: 'utilisateur', details: { versionAvant: 1, versionApres: 2, champsModifies: ['destinataireNom', 'destinataireSiren'], motif: 'Le client est écrit à la main sur la pièce' } });
    expect(audit[0].details.avant).toMatchObject({ destinataireSiren: null });
    expect(audit[0].details.apres).toMatchObject({ destinataireSiren: SIREN_HUMAIN });
    const chaine = (await api('alice', 'GET', '/v1/audit')).json;
    expect(chaine.integrite.rupture).toBeNull();
    expect(chaine.lignes.some((l: any) => l.action === 'extraction.destinataire_corrige')).toBe(true);
  });

  it('une seconde correction empile une version de plus et garde la valeur AUTOMATIQUE d’origine ; une saisie sans effet est refusée', async () => {
    expect((await corriger(H, { destinataireSiren: SIREN_HUMAIN })).statut).toBe(409);
    const r = await corriger(H, { destinataireSiren: SIREN_HUMAIN_2 }, 'Erreur de saisie : c’est la maison mère');
    expect(r.statut).toBe(200);
    expect(r.json.extraction.version).toBe(3);
    const l = (await lireDest(H)).json.lignes.find((x: any) => x.champ === 'destinataireSiren');
    expect(l).toMatchObject({ effective: SIREN_HUMAIN_2, humain: SIREN_HUMAIN_2, automatique: null, motif: 'Erreur de saisie : c’est la maison mère' });
    const v = await versionsBase(H);
    expect(v.map((x) => [x.version, x.actuelle])).toEqual([[1, false], [2, false], [3, true]]);
    expect(v[1].champs.destinataireSiren.valeur).toBe(SIREN_HUMAIN); // l'historique garde la première correction
    expect(v[0].champs).toEqual(v1Avant.champs);
    // Effacer une valeur est une décision humaine tracée, pas une suppression de l'historique.
    const efface = await corriger(H, { destinataireNom: null }, 'Nom illisible, à ne pas conserver');
    expect(efface.statut).toBe(200);
    expect(efface.json.apres.destinataireNom).toBeNull();
    expect((await versionsBase(H))[2].champs.destinataireNom.valeur).toBe('Client Humain SAS');
  });

  it('une correction d’un AUTRE champ rend l’ancienne décision d’appariement « à revoir » comme avant (non-régression)', async () => {
    const r = await api('remi', 'PUT', `/v1/documents/${H}/extraction`, { champs: { dateEcheance: `${ANNEE}-12-31` } });
    expect(r.statut).toBe(200);
    const aTraiter = (await api('remi', 'GET', `/v1/exercices/${exercice}/tiers-factures/a-traiter`)).json;
    expect(aTraiter.decisionsARevoir.filter((x: any) => x.objet === H)).toEqual([expect.objectContaining({ type: 'comptabilisation', motif: expect.stringMatching(/champs extraits/) })]);
    const effets = (await lireDest(H)).json.effets;
    expect(effets.decisions).toEqual([expect.objectContaining({ etat: 'a_revoir' })]);
    // La correction humaine du destinataire a survécu à la correction d'un autre champ.
    expect((await lireDest(H)).json.lignes.find((l: any) => l.champ === 'destinataireSiren')).toMatchObject({ source: 'humain', effective: SIREN_HUMAIN_2 });
  });

  it('conflit entre la qualification de la pièce et le sens relu, ou identifiants incohérents : signalés, rien n’est écrasé ni refusé', async () => {
    // Pièce émise par le dossier mais qualifiée « facture d'achat » : le sens relu (vente) contredit la qualification.
    const P = await deposerVente('conflit', false, dossier, 'facture_achat');
    const r = await corriger(P, { destinataireSiren: SIREN_HUMAIN }, 'Le client est une autre société');
    expect(r.statut).toBe(200);
    expect(r.json.effets).toMatchObject({ natureQualifiee: 'facture_achat', conflitNature: true, sensLu: { sens: 'vente' } });
    expect(r.json.effets.signalements.join(' ')).toMatch(/qualifiée « facture d’achat » mais ses identifiants indiquent une vente/);
    // Le dossier à la fois émetteur et destinataire : la saisie est enregistrée (décision humaine) mais l'incohérence est dite.
    const incoherent = await corriger(P, { destinataireSiren: SIREN_DOSSIER }, 'Essai : le dossier comme destinataire');
    expect(incoherent.statut).toBe(200);
    expect(incoherent.json.effets.sensLu).toMatchObject({ sens: 'indetermine', incoherence: true });
    expect(incoherent.json.effets.signalements.join(' ')).toMatch(/Incohérence/);
  });
});

// ─────────────────────────────── réanalyse explicite ───────────────────────────────

describe('réanalyse explicite du destinataire (extractions antérieures à D-084)', () => {
  const pieces: Record<string, string> = {};
  const avant = new Map<string, any[]>();
  let simulationId = '';
  let executionId = '';
  const toutes = () => Object.values(pieces);

  it('préparation : pièces déposées, analysées par le worker, puis ramenées à la forme antérieure à D-084 (dont une validée et une corrigée à la main)', async () => {
    for (const [cle, client] of [['a', true], ['b', true], ['c', false], ['valide', true], ['humaine', true]] as const) pieces[cle] = await deposerVente(`rea-${cle}`, client, dossier2);
    for (const id of toutes()) await vieillir(id);
    // Validée par un réviseur, sur l'extraction ancienne.
    expect((await api('remi', 'POST', `/v1/documents/${pieces.valide}/validation`, { decision: 'valider' })).statut).toBe(200);
    // Corrigée à la main AVANT toute lecture automatique du destinataire.
    const h = await corriger(pieces.humaine!, { destinataireSiren: SIREN_HUMAIN }, 'Client lu sur le bon de commande');
    expect(h.statut).toBe(200);
    expect(h.json.lignes.find((l: any) => l.champ === 'destinataireSiren')).toMatchObject({ source: 'humain', automatique: null });
    expect((await lireDest(pieces.humaine!)).json.lectureAutomatiqueFaite).toBe(false);
    for (const id of toutes()) avant.set(id, await versionsBase(id));
  }, 180_000);

  it('aperçu : combien de pièces concernées, validées, corrigées à la main, taille du lot ; lecture dès « collaboration », demande réservée à la révision', async () => {
    const r = await api('chloe', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`);
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ versionAnalyseur: VERSION_ANALYSEUR_FACTURE, tailleMaxLot: 50, peutDemander: false, concernees: 5, dansLeProchainLot: 5, lotsNecessaires: 1, extractionsValidees: 1, corrigeesALaMain: 1, dejaRelues: 0, demandes: [] });
    expect(r.json.garanties.join(' ')).toMatch(/jamais automatiquement|explicite/);
    expect((await api('remi', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`)).json.peutDemander).toBe(true);
    // Le premier dossier (pièces récentes, déjà lues par l'analyseur actuel) n'est pas concerné.
    expect((await api('remi', 'GET', `/v1/dossiers/${dossier}/reanalyse-destinataire`)).json).toMatchObject({ concernees: 0, dansLeProchainLot: 0 });
  });

  it('habilitations de la réanalyse : déposant refusé, collaborateur refusé pour demander, autre cabinet refusé, identifiants invalides refusés', async () => {
    expect((await api('client', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`)).statut).toBe(404);
    const corps = { mode: 'simulation', motif: 'Essai' };
    expect((await api('client', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, corps)).statut).toBe(403);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, corps)).statut).toBe(403);
    expect((await api('bruno', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, corps)).statut).toBe(404);
    expect((await api('remi', 'GET', '/v1/dossiers/pas-un-uuid/reanalyse-destinataire')).statut).toBe(400);
    expect((await api('remi', 'GET', '/v1/reanalyses-destinataire/pas-un-uuid')).statut).toBe(400);
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'simulation' })).statut).toBe(400); // motif obligatoire
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'tout', motif: 'Essai' })).statut).toBe(400);
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Essai', taille: 500 })).statut).toBeLessThan(300); // champ inconnu ignoré : la borne est fixée par le serveur
  });

  it('rien ne se lance sans demande : aucune demande n’existe avant la simulation ; une exécution sans simulation est refusée', async () => {
    // La demande d'essai précédente est une simulation : elle n'écrit rien (vérifié plus bas) ; on la laisse se terminer.
    const dem = (await api('remi', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`)).json.demandes;
    expect(dem).toHaveLength(1);
    expect(dem[0]).toMatchObject({ mode: 'simulation' });
    await attendreLotReanalyse(dem[0].id);
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'execution', motif: 'Sans simulation' })).statut).toBe(400);
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'execution', motif: 'Simulation inconnue', simulationId: '11111111-2222-4333-8444-555555555555' })).statut).toBe(404);
    // Une simulation d'un AUTRE dossier ne vaut pas pour celui-ci.
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'execution', motif: 'Mauvais dossier', simulationId: dem[0].id })).statut).toBe(404);
    // Rien à réanalyser dans le premier dossier.
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Rien à faire' })).statut).toBe(409);
  });

  it('simulation : rapport par pièce, SANS aucune écriture dans les extractions ni les originaux', async () => {
    const s = await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Aperçu avant relecture des anciennes extractions' });
    expect(s.statut).toBe(202);
    expect(s.json).toMatchObject({ mode: 'simulation', nbPieces: 5, tailleLot: 50, versionAnalyseur: VERSION_ANALYSEUR_FACTURE, simulationId: null });
    simulationId = s.json.id;
    const r = (await attendreLotReanalyse(simulationId)).json;
    expect(r.decomptes).toEqual({ en_attente: 0, inchangee: 0, destinataire_trouve: 4, abstention: 1, erreur: 0 });
    expect(r.changeraient).toBe(5);
    expect(r.executable).toBe(true);
    const parNom = Object.fromEntries(r.pieces.map((p: any) => [p.nomFichier, p]));
    expect(parNom['rea-a.pdf']).toMatchObject({ resultat: 'destinataire_trouve', versionExtractionAvant: 1, versionExtractionApres: null });
    expect(parNom['rea-a.pdf'].detail.apres).toMatchObject({ destinataireSiren: SIREN_CLIENT });
    expect(parNom['rea-c.pdf']).toMatchObject({ resultat: 'abstention' });
    expect(parNom['rea-c.pdf'].motif).toMatch(/\S/);
    expect(parNom['rea-humaine.pdf'].detail.desaccords).toEqual([{ champ: 'destinataireSiren', humain: SIREN_HUMAIN, automatique: SIREN_CLIENT }]);
    // Rien n'a bougé.
    for (const id of toutes()) expect(await versionsBase(id)).toEqual(avant.get(id));
    expect(await journalAudit('extraction.destinataire_reanalyse')).toEqual([]);
    expect((await journalAudit('reanalyse_destinataire.simulation_demandee')).length).toBeGreaterThanOrEqual(1);
    expect((await journalAudit('reanalyse_destinataire.simulee')).length).toBeGreaterThanOrEqual(1);
    for (const id of toutes()) expect(sha(await octets(id))).toBe(sha(contenus.get(id)!));
  });

  it('exécution après aperçu : nouvelles versions, anciennes versions et décisions intactes, correction humaine non écrasée, audit écrit', async () => {
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'execution', motif: 'Confirmation', simulationId })).statut).toBe(403);
    const e = await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'execution', motif: 'Confirmé après lecture de l’aperçu', simulationId });
    expect(e.statut).toBe(202);
    expect(e.json).toMatchObject({ mode: 'execution', simulationId, nbPieces: 5 });
    executionId = e.json.id;
    const r = (await attendreLotReanalyse(executionId)).json;
    expect(r.decomptes).toMatchObject({ destinataire_trouve: 4, abstention: 1, erreur: 0, en_attente: 0 });
    expect(r.demande.resume).toMatchObject({ destinataire_trouve: 4, abstention: 1 });
    for (const id of toutes()) {
      const v = await versionsBase(id);
      const a = avant.get(id)!;
      expect(v).toHaveLength(a.length + 1);
      // Toutes les versions antérieures sont strictement conservées (hors bascule « actuelle »).
      for (const [i, ancienne] of a.entries()) expect({ ...v[i], actuelle: null }).toEqual({ ...ancienne, actuelle: null });
      expect(v.slice(0, -1).every((x) => x.actuelle === false)).toBe(true);
      expect(v.at(-1)).toMatchObject({ version: a.length + 1, actuelle: true, statut: 'projet' });
      expect(sha(await octets(id))).toBe(sha(contenus.get(id)!));
    }
    // Lecture trouvée : le destinataire de la pièce est celui de l'analyseur ; abstention : motif conservé.
    expect((await lireDest(pieces.a!)).json.lignes.find((l: any) => l.champ === 'destinataireSiren')).toMatchObject({ source: 'automatique', effective: SIREN_CLIENT });
    expect((await lireDest(pieces.c!)).json.abstention).toMatch(/\S/);
    // Validée : la validation reste sur la version validée, la nouvelle version est un projet à revalider.
    const v = await versionsBase(pieces.valide!);
    expect(v.map((x) => [x.version, x.statut])).toEqual([[1, 'valide'], [2, 'projet']]);
    expect((await editeur.query(`select action from decisions where cible_id = $1`, [v[0].id])).rows).toEqual([{ action: 'valider' }]);
    // Correction humaine NON écrasée : valeur humaine, auteur, motif conservés ; valeur automatique à côté ; désaccord signalé.
    const h = (await lireDest(pieces.humaine!)).json;
    expect(h.lignes.find((l: any) => l.champ === 'destinataireSiren')).toMatchObject({ source: 'humain', effective: SIREN_HUMAIN, humain: SIREN_HUMAIN, automatique: SIREN_CLIENT, desaccord: true, corrigePar: DEMO.remi, motif: 'Client lu sur le bon de commande' });
    expect(h.lectureAutomatiqueFaite).toBe(true);
    expect(h.historique.map((x: any) => x.version)).toEqual([1, 2, 3]);
    expect(h.reanalyses.filter((x: any) => x.execution)).toEqual([expect.objectContaining({ resultat: 'destinataire_trouve', execution: true, versionAnalyseur: VERSION_ANALYSEUR_FACTURE })]);
    expect(h.reanalyses.filter((x: any) => !x.execution).length).toBeGreaterThanOrEqual(1); // les simulations figurent aussi, marquées comme telles
    // Audit : une ligne par pièce relue (valeurs avant/après, version de l'analyseur) + la fin de l'exécution.
    const lignes = await journalAudit('extraction.destinataire_reanalyse');
    expect(lignes).toHaveLength(5);
    expect(lignes.every((l) => l.acteur_type === 'systeme' && l.details.demandePar === DEMO.remi && l.details.versionAnalyseur === VERSION_ANALYSEUR_FACTURE && l.details.avant && l.details.apres)).toBe(true);
    expect((await journalAudit('reanalyse_destinataire.demandee')).length).toBe(1);
    expect((await journalAudit('reanalyse_destinataire.executee')).length).toBe(1);
    expect((await api('alice', 'GET', '/v1/audit')).json.integrite.rupture).toBeNull();
    // Le sens et les tiers se recalculent : la facture de vente identifie maintenant son client par la pièce.
    expect((await api('remi', 'GET', `/v1/dossiers/${dossier2}/reanalyse-destinataire`)).json).toMatchObject({ concernees: 0, dejaRelues: 5 });
  });

  it('idempotence : aucune pièce n’est refaite — nouvelle simulation refusée, même simulation non rejouable, reprise d’une demande terminée sans effet', async () => {
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Encore' })).statut).toBe(409);
    expect((await api('remi', 'POST', `/v1/dossiers/${dossier2}/reanalyses-destinataire`, { mode: 'execution', motif: 'Encore', simulationId })).statut).toBe(409);
    const reprise = await api('remi', 'POST', `/v1/reanalyses-destinataire/${executionId}/reprendre`);
    expect(reprise.statut).toBe(202);
    expect(reprise.json).toEqual({ accepte: false, statut: 'termine' });
    expect((await api('chloe', 'POST', `/v1/reanalyses-destinataire/${executionId}/reprendre`)).statut).toBe(403);
    expect((await api('bruno', 'POST', `/v1/reanalyses-destinataire/${executionId}/reprendre`)).statut).toBe(404);
    await new Promise((ok) => setTimeout(ok, 1500));
    for (const id of toutes()) expect(await versionsBase(id)).toHaveLength(avant.get(id)!.length + 1);
    expect(await journalAudit('extraction.destinataire_reanalyse')).toHaveLength(5);
  });

  it('isolation : un autre cabinet ne voit ni la demande ni son rapport', async () => {
    expect((await api('bruno', 'GET', `/v1/reanalyses-destinataire/${executionId}`)).statut).toBe(404);
    expect((await api('client', 'GET', `/v1/reanalyses-destinataire/${executionId}`)).statut).toBe(404); // niveau « dépôt » : la demande n'est pas visible
    expect((await api('bruno', 'GET', `/v1/documents/${pieces.a}/destinataire`)).statut).toBe(404);
  });
});

describe('réanalyse : borne de lot de 50 pièces', () => {
  it('au-delà de 50 pièces concernées, la demande ne retient que 50 pièces ; le reste attend une demande suivante', async () => {
    const modele = await deposerVente('borne-modele', true, dossier);
    const doc = (await editeur.query('select fichier_id, cabinet_id, entite_id from documents where id = $1', [modele])).rows[0];
    const champs = (await editeur.query('select champs from extractions where document_id = $1 and actuelle', [modele])).rows[0].champs as Record<string, unknown>;
    for (const k of CLES_DESTINATAIRE) delete champs[k];
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) {
      const d = (await editeur.query(`insert into documents (cabinet_id, entite_id, fichier_id, nom_origine, nature, statut) values ($1, $2, $3, $4, 'facture_vente', 'a_controler') returning id`, [doc.cabinet_id, doc.entite_id, doc.fichier_id, `borne-${i}.pdf`])).rows[0].id;
      await editeur.query(`insert into extractions (cabinet_id, entite_id, document_id, version, methode, moteur, champs, verifications, statut) values ($1, $2, $3, 1, 'couche_texte', 'pdfjs-dist', $4, '[]', 'projet')`, [doc.cabinet_id, doc.entite_id, d, JSON.stringify(champs)]);
      ids.push(d);
    }
    await vieillir(modele);
    const apercu = (await api('remi', 'GET', `/v1/dossiers/${dossier}/reanalyse-destinataire`)).json;
    expect(apercu).toMatchObject({ concernees: 53, dansLeProchainLot: 50, lotsNecessaires: 2, tailleMaxLot: 50 });
    const sim = await api('remi', 'POST', `/v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'simulation', motif: 'Premier lot de la borne' });
    expect(sim.statut).toBe(202);
    expect(sim.json.nbPieces).toBe(50);
    const r = (await attendreLotReanalyse(sim.json.id)).json;
    expect(r.pieces).toHaveLength(50);
    expect(r.decomptes.destinataire_trouve).toBe(50);
    const exec = await api('remi', 'POST', `/v1/dossiers/${dossier}/reanalyses-destinataire`, { mode: 'execution', motif: 'Premier lot de la borne, confirmé', simulationId: sim.json.id });
    expect(exec.statut).toBe(202);
    expect(exec.json.nbPieces).toBe(50);
    const fin = (await attendreLotReanalyse(exec.json.id)).json;
    expect(fin.decomptes).toMatchObject({ destinataire_trouve: 50, erreur: 0 });
    const reste = (await api('remi', 'GET', `/v1/dossiers/${dossier}/reanalyse-destinataire`)).json;
    expect(reste).toMatchObject({ concernees: 3, dejaRelues: 50 });
    const nbVersions = Number((await editeur.query(`select count(*)::int as n from extractions where document_id = any($1) and version = 2`, [[...ids, modele]])).rows[0].n);
    expect(nbVersions).toBe(50);
  }, 240_000);
});
