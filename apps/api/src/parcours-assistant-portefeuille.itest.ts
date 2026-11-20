/**
 * Assistant sur un PORTEFEUILLE de dossiers — pile réelle locale (Keycloak, API, worker, PostgreSQL, S3).
 * Cabinet NEUF à chaque exécution, quatre dossiers :
 *   A — comptabilité, constats et une pièce ; B — comptabilité et une pièce ;
 *   C — données présentes mais AUCUNE habilitation pour les comptes qui interrogent (Rémi, Chloé) ;
 *   D — habilité, sans aucune donnée (ni exercice, ni import, ni pièce).
 *
 * État réel exercé par la première partie : AUCUNE IA n'est connectée ; les réponses sont « sans IA » et le disent.
 * La seconde partie exerce le chemin « modèle » contre le SIMULATEUR du paquet, avec les ports réels (base réelle sous
 * RLS), en appelant le même service que le contrôleur : ce n'est pas une IA.
 *
 * Les questions passent par Rémi (et Alice) : la limite de débit de l'API est par utilisateur, et le parcours de
 * l'assistant par dossier consomme déjà celle de Chloé.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { type AccesBd, creerAccesBd, sql, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import { SimulateurIa } from '@comtaple/ia/simulateur';
import { assemblerIa, lireConfig } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Acces } from './acces.js';
import { BORNE_DOSSIERS_PORTEFEUILLE, type ContenuPortefeuille, elementsParDossier, filtrerSelonHabilitations, poserQuestionPortefeuille, relireEchangesPortefeuille } from './assistant-portefeuille.service.js';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const MOT = `brimborion${SEL}`;
const SECRET = `confidentiel${SEL}`;
const EX_A = { debut: '2025-01-01', fin: '2025-12-31' };
const EX_B = { debut: '2024-07-01', fin: '2025-06-30' };
const NOMS = { a: `Portefeuille ${SEL} Alpha SARL`, b: `Portefeuille ${SEL} Bravo SAS`, c: `Portefeuille ${SEL} Charlie SA`, d: `Portefeuille ${SEL} Delta EURL` };
let editeur: pg.Client;
let cabinet = '';
const dossier = { a: '', b: '', c: '', d: '' };
const exercice = { a: '', b: '', c: '' };
const piece = { a: '', b: '', c: '' };
const questions: string[] = [];
/** Dix-neuf dossiers vides de plus (Zoulou 01 à 19), créés par le test de la borne et réutilisés par celui des tranches. */
let plus: Array<{ id: string; nom: string }> = [];

/** Requête vers l'assistant ; si la limite de débit (par utilisateur, par minute) est atteinte, attend la fenêtre suivante. */
const demander = async (qui: string, methode: string, corps?: unknown) => {
  for (let essai = 0; ; essai++) {
    const r = await api(qui, methode, '/v1/assistant/questions', corps);
    if (r.statut !== 429 || essai >= 7) return r;
    await new Promise((f) => setTimeout(f, 10_000));
  }
};
const poser = async (qui: string, question: string, extra: Record<string, unknown> = {}) => {
  questions.push(question);
  return demander(qui, 'POST', { question, ...extra });
};
const citations = (rep: any): Array<{ id: string; dossierId: string | null }> => rep.segments.flatMap((x: any) => x.citations);
const evenements = async () => (await editeur.query('select * from evenements_ia where cabinet_id = $1 order by cree_le', [cabinet])).rows;
const maintenant = async (): Promise<string> => (await editeur.query('select clock_timestamp()::text as t')).rows[0].t;
const depuis = async (instant: string) => (await editeur.query('select * from evenements_ia where cabinet_id = $1 and cree_le >= $2::timestamptz order by cree_le', [cabinet, instant])).rows;
const habiliter = async (cle: keyof typeof dossier, utilisateur: string, niveau: string) => expect((await api('alice', 'PUT', `/v1/dossiers/${dossier[cle]}/habilitations/${utilisateur}`, { niveau })).statut).toBeLessThan(300);
const retirer = (cle: keyof typeof dossier, utilisateur: string) => editeur.query('delete from habilitations_dossier where entite_id = $1 and utilisateur_id = $2', [dossier[cle], utilisateur]);

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai portefeuille ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '30 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  for (const cle of ['a', 'b', 'c', 'd'] as const) {
    dossier[cle] = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: NOMS[cle], territoireFiscal: 'metropole' })).json.id;
    await habiliter(cle, DEMO.alice, 'validation');
    await habiliter(cle, DEMO.client, 'depot');
  }
  // Rémi et Chloé : collaboration sur A, lecture sur B, RIEN sur C, collaboration sur D (sans donnée). Alice : tout.
  for (const u of [DEMO.remi, DEMO.chloe]) {
    await habiliter('a', u, 'collaboration');
    await habiliter('b', u, 'lecture');
    await habiliter('d', u, 'collaboration');
  }

  const importer = async (cle: 'a' | 'b' | 'c', ex: { debut: string; fin: string }, graine: number, anomalies: string[]) => {
    exercice[cle] = (await api('alice', 'POST', `/v1/dossiers/${dossier[cle]}/exercices`, ex)).json.id;
    const fec = genererFecSynthetique({ exercice: ex, nbEcritures: 120, graine, anomalies: anomalies as never });
    const d = await deposer('alice', dossier[cle], Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice[cle], statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('alice', d.fin.json.lotImportId);
  };
  const graine = Number.parseInt(SEL.slice(0, 6), 16);
  await importer('a', EX_A, graine, ['client_crediteur']);
  await importer('b', EX_B, graine + 1, []);
  await importer('c', EX_A, graine + 2, ['client_crediteur']);
  // Constats du moteur sur A (les contrôles se lancent après l'import).
  const revue = await attendre(() => api('alice', 'GET', `/v1/exercices/${exercice.a}/revue`), (x) => x.json?.execution?.statut === 'termine' || x.json?.execution === null, 120_000);
  if (revue.json.execution === null) {
    const lance = await api('alice', 'POST', `/v1/exercices/${exercice.a}/controles`);
    await attendre(() => api('alice', 'GET', `/v1/exercices/${exercice.a}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 120_000);
  }
  const depot = async (cle: 'a' | 'b' | 'c', lignes: string[]) => {
    const nom = `note-${cle}-${SEL}.pdf`;
    const r = await deposer('alice', dossier[cle], pdfTexte(lignes, `${SEL}-${cle}`), {}, nom);
    const id = r.fin.json.documentId as string;
    await attendre(() => api('alice', 'GET', `/v1/documents/${id}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));
    piece[cle] = id;
  };
  await depot('a', ['Note du dossier Alpha', `Mot repere ${MOT}`, 'Contrat de maintenance annuel']);
  await depot('b', ['Note du dossier Bravo', `Mot repere ${MOT}`, 'Bail commercial']);
  await depot('c', ['Note du dossier Charlie', `Mot repere ${MOT}`, `Element ${SECRET}`]);
}, 420_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('périmètre autorisé : calculé par la base, sous l’identité de la personne', () => {
  it('chacun ne voit que les dossiers où il a au moins « lecture » ; un déposant est refusé', async () => {
    const chloe = await api('chloe', 'GET', '/v1/assistant/perimetre');
    expect(chloe.statut).toBe(200);
    expect(chloe.json.borne).toBe(BORNE_DOSSIERS_PORTEFEUILLE);
    expect(chloe.json.dossiers.map((d: any) => [d.nom, d.niveau])).toEqual([[NOMS.a, 'collaboration'], [NOMS.b, 'lecture'], [NOMS.d, 'collaboration']]);
    expect(JSON.stringify(chloe.json)).not.toContain(dossier.c);
    expect((await api('alice', 'GET', '/v1/assistant/perimetre')).json.dossiers).toHaveLength(4);
    expect((await api('client', 'GET', '/v1/assistant/perimetre')).statut).toBe(403);
    expect((await api('', 'GET', '/v1/assistant/perimetre')).statut).toBe(401);
    // Bruno appartient à un autre cabinet : son périmètre ne contient aucun de ces dossiers.
    const bruno = await api('bruno', 'GET', '/v1/assistant/perimetre');
    for (const id of Object.values(dossier)) expect(JSON.stringify(bruno.json)).not.toContain(id);
  });

  it('le nombre d’éléments restitués par dossier décroît avec le nombre de dossiers, sans jamais dépasser 40 au total', () => {
    expect([1, 3, 5, 10, 20].map(elementsParDossier)).toEqual([35, 11, 7, 3, 1]);
    for (let n = 1; n <= BORNE_DOSSIERS_PORTEFEUILLE; n++) expect(n * elementsParDossier(n) + 5).toBeLessThanOrEqual(40);
  });
});

describe('question de portefeuille sans IA (état réel)', () => {
  it('interroge tous les dossiers autorisés, cite les sources du BON dossier, annonce période et données manquantes par dossier', async () => {
    const r = await poser('remi', `Que disent les notes ${MOT} ?`);
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ mode: 'sans_ia', echangeEnregistre: true, ia: { statut: 'non_connecte', modeleSollicite: false } });
    expect(r.json.reponse).toMatchObject({ statut: 'repondu', mode: 'sans_ia', etiquette: 'Sans IA : résultats de recherche et calculs du moteur, sans rédaction', iaIndisponible: { code: 'non_connecte' }, refus: [] });
    const p = r.json.perimetre;
    expect(p).toMatchObject({ borne: BORNE_DOSSIERS_PORTEFEUILLE, autorises: 3, elementsParDossier: 11, nonInterroges: [], horsPerimetre: [], periodeCommune: null });
    expect(p.dossiers.map((d: any) => d.id)).toEqual([dossier.a, dossier.b, dossier.d]);
    // Période annoncée dossier par dossier : le dernier exercice de chacun, différent d'un dossier à l'autre.
    expect(p.dossiers[0]).toMatchObject({ nom: NOMS.a, exercice: { id: exercice.a, ...EX_A }, periode: EX_A });
    expect(p.dossiers[1]).toMatchObject({ nom: NOMS.b, exercice: { id: exercice.b, ...EX_B }, periode: EX_B });
    expect(p.dossiers[2]).toMatchObject({ nom: NOMS.d, exercice: null, periode: null, sources: 0 });
    // Citations : la pièce de A porte le dossier A, celle de B le dossier B.
    const cites = citations(r.json.reponse);
    expect(cites).toContainEqual(expect.objectContaining({ id: `piece:${piece.a}:p1`, dossierId: dossier.a }));
    expect(cites).toContainEqual(expect.objectContaining({ id: `piece:${piece.b}:p1`, dossierId: dossier.b }));
    for (const c of cites) expect([dossier.a, dossier.b]).toContain(c.dossierId);
    expect(r.json.reponse.sources.every((x: any) => [dossier.a, dossier.b, null].includes(x.dossierId))).toBe(true);
    // Le dossier C (non habilité) n'est ni dans le périmètre, ni cité, ni mentionné.
    const brut = JSON.stringify(r.json);
    for (const interdit of [dossier.c, piece.c, NOMS.c, SECRET, 'Charlie']) expect(brut).not.toContain(interdit);
    // En base : chaque pièce citée appartient bien au dossier annoncé.
    const enBase = await editeur.query('select id, entite_id from documents where id = any($1::uuid[])', [cites.filter((c) => c.id.startsWith('piece:')).map((c) => c.id.split(':')[1])]);
    for (const c of cites.filter((x) => x.id.startsWith('piece:'))) expect(enBase.rows.find((l) => l.id === c.id.split(':')[1]).entite_id).toBe(c.dossierId);
  });

  it('calculs du moteur dossier par dossier, sur l’exercice de chacun ; données manquantes signalées pour le dossier sans donnée', async () => {
    const r = await poser('remi', 'Quel est le chiffre d’affaires ?');
    const rep = r.json.reponse;
    for (const cle of ['a', 'b'] as const) {
      const attendu = (await api('alice', 'GET', `/v1/exercices/${exercice[cle]}/indicateurs`)).json.indicateurs.find((i: any) => i.id === 'SIG-CA');
      const segment = rep.segments.find((x: any) => x.citations[0].id === `indicateur:${exercice[cle]}:SIG-CA`);
      expect(segment, cle).toMatchObject({ type: 'calcul' });
      expect(segment.citations[0]).toMatchObject({ nature: 'resultat_moteur', dossierId: dossier[cle] });
      expect(segment.texte).toContain(`valeur : ${attendu.valeur}`);
      const periode = cle === 'a' ? EX_A : EX_B;
      expect(segment.texte).toContain(`période : du ${periode.debut} au ${periode.fin}`);
    }
    const d = r.json.perimetre.dossiers.find((x: any) => x.id === dossier.d);
    expect(d.donneesManquantes).toEqual(['Aucun exercice n’est ouvert dans ce dossier : la comptabilité n’a pas été interrogée.']);
    // Les données manquantes propres à un dossier ne sont pas mêlées en vrac à la réponse.
    expect(rep.donneesManquantes).toEqual([]);
    expect(JSON.stringify(r.json)).not.toContain(exercice.c);
  });

  it('contrôles non exécutés, pas d’import : signalés pour le dossier concerné seulement', async () => {
    const r = await poser('remi', 'Quels constats ont été relevés par les contrôles ?');
    const par = new Map<string, any>(r.json.perimetre.dossiers.map((d: any) => [d.id, d]));
    const constatsA = citations(r.json.reponse).filter((c) => c.id.startsWith('constat:'));
    expect(constatsA.length).toBeGreaterThan(0);
    for (const c of constatsA) expect([dossier.a, dossier.b]).toContain(c.dossierId);
    const idsA = constatsA.filter((c) => c.dossierId === dossier.a).map((c) => c.id.slice(8));
    expect((await editeur.query('select count(*)::int as n from constats where id = any($1::uuid[]) and entite_id = $2', [idsA, dossier.a])).rows[0].n).toBe(idsA.length);
    expect(par.get(dossier.d).donneesManquantes).toEqual(['Aucun exercice n’est ouvert dans ce dossier : la comptabilité n’a pas été interrogée.']);
  });

  it('période commune : chaque dossier est analysé sur la part de son exercice qui la recoupe, et le dit', async () => {
    const r = await poser('remi', 'Quel est le solde du compte 512 ?', { periode: { debut: '2025-01-01', fin: '2025-03-31' } });
    expect(r.statut).toBe(200);
    const par = new Map<string, any>(r.json.perimetre.dossiers.map((d: any) => [d.id, d]));
    expect(r.json.perimetre.periodeCommune).toEqual({ debut: '2025-01-01', fin: '2025-03-31' });
    expect(par.get(dossier.a).periode).toEqual({ debut: '2025-01-01', fin: '2025-03-31' });
    expect(par.get(dossier.b)).toMatchObject({ exercice: { id: exercice.b }, periode: { debut: '2025-01-01', fin: '2025-03-31' } });
    expect(par.get(dossier.d).donneesManquantes).toEqual(['Aucun exercice de ce dossier ne recoupe la période demandée : la comptabilité n’a pas été interrogée.']);
    const balances = citations(r.json.reponse).filter((c) => c.id.startsWith('balance:'));
    expect(balances.length).toBeGreaterThan(0);
    for (const c of balances) expect(c.id.endsWith(':2025-01-01:2025-03-31')).toBe(true);
    // Une période qui ne recoupe aucun exercice : rien n'est inventé, tout est dit manquant.
    const hors = await poser('remi', 'Quel est le solde du compte 512 ?', { periode: { debut: '2019-01-01', fin: '2019-12-31' } });
    expect(citations(hors.json.reponse).filter((c) => c.id.startsWith('balance:'))).toEqual([]);
    for (const d of hors.json.perimetre.dossiers) expect(d).toMatchObject({ exercice: null, periode: null });
    expect((await poser('remi', 'Une question', { periode: { debut: '2025-12-31', fin: '2025-01-01' } })).statut).toBe(400);
  });

  it('exercice ouvert sans import ni contrôle : les deux manques sont dits, pour ce dossier seulement', async () => {
    const exD = (await api('alice', 'POST', `/v1/dossiers/${dossier.d}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' })).json.id;
    expect(exD).toMatch(/^[0-9a-f-]{36}$/);
    const r = await poser('remi', 'Quels constats et quel chiffre d’affaires ?');
    const d = r.json.perimetre.dossiers.find((x: any) => x.id === dossier.d);
    expect(d).toMatchObject({ exercice: { id: exD }, periode: { debut: '2026-01-01', fin: '2026-12-31' } });
    expect(d.donneesManquantes).toEqual(expect.arrayContaining(['Aucun contrôle n’a été exécuté sur cet exercice.', 'Aucune donnée comptable importée pour cet exercice : indicateur non calculable.']));
    expect(r.json.perimetre.dossiers.find((x: any) => x.id === dossier.a).donneesManquantes).not.toContain('Aucun contrôle n’a été exécuté sur cet exercice.');
  });

  it('sélection de dossiers : intersectée avec le périmètre ; identifiant non habilité, d’un autre cabinet ou inexistant : écartés de la même façon, sans effet ni fuite', async () => {
    const debut = await maintenant();
    const inexistant = randomUUID();
    const r = await poser('remi', `Que disent les notes ${MOT} ?`, { dossierIds: [dossier.a, dossier.c, DEMO.dupain, inexistant] });
    expect(r.statut).toBe(200);
    expect(r.json.perimetre.dossiers.map((d: any) => d.id)).toEqual([dossier.a]);
    expect(r.json.perimetre.elementsParDossier).toBe(35);
    // Les trois identifiants écartés sont rendus tels que reçus, sans distinction : rien ne dit lequel existe.
    expect([...r.json.perimetre.horsPerimetre].sort()).toEqual([dossier.c, DEMO.dupain, inexistant].sort());
    for (const c of citations(r.json.reponse)) expect(c.dossierId).toBe(dossier.a);
    const brut = JSON.stringify({ ...r.json, perimetre: { ...r.json.perimetre, horsPerimetre: [] } });
    for (const interdit of [dossier.c, piece.c, NOMS.c, SECRET, DEMO.dupain, 'Dupain']) expect(brut).not.toContain(interdit);
    // Aucune fonction n'a été exécutée, ni même refusée, pour un autre dossier que A (traces et base).
    await api('alice', 'GET', '/v1/ia');
    const traces = (await depuis(debut)).filter((l) => l.type === 'fonction_metier');
    expect(traces.length).toBeGreaterThan(0);
    for (const l of traces) expect([dossier.a, null]).toContain(l.entite_id_cible);
    // Uniquement des dossiers hors périmètre : 404, identique que le dossier existe ou non ; aucune recherche.
    const avant = (await evenements()).length;
    for (const ids of [[dossier.c], [DEMO.dupain], [inexistant], [dossier.c, DEMO.dupain]]) {
      const refus = await demander('remi', 'POST', { question: 'Que contient ce dossier ?', dossierIds: ids });
      expect(refus.statut).toBe(404);
      expect(refus.json.message).toBe('Aucun des dossiers demandés n’est dans votre périmètre');
    }
    await api('alice', 'GET', '/v1/ia');
    expect((await evenements()).length).toBe(avant);
  });

  it('le dossier non habilité n’est JAMAIS interrogé : aucune trace ne le vise, depuis le début du parcours', async () => {
    await api('alice', 'GET', '/v1/ia');
    const lignes = await evenements();
    expect(lignes.filter((l) => l.type === 'fonction_metier').length).toBeGreaterThan(10);
    // Alice et Chloé n'ayant encore rien demandé, toutes les traces viennent de Rémi : aucune ne vise C.
    expect(lignes.filter((l) => l.entite_id_cible === dossier.c)).toEqual([]);
    expect(new Set(lignes.filter((l) => l.entite_id_cible !== null).map((l) => l.entite_id_cible))).toEqual(new Set([dossier.a, dossier.b, dossier.d]));
    expect(new Set(lignes.map((l) => l.nature))).toEqual(new Set(['sans_ia']));
    // Sans contenu : ni question, ni nom de dossier, ni texte de pièce.
    const brut = JSON.stringify(lignes);
    for (const q of new Set(questions)) expect(brut).not.toContain(q);
    for (const interdit of [MOT, SECRET, SEL, 'Alpha', 'Bravo', 'Charlie']) expect(brut).not.toContain(interdit);
    // Journal d'audit : l'action est tracée sans la question ni les noms.
    const journal = (await editeur.query(`select details, entite_id_cible from journal_audit where cabinet_id = $1 and action = 'assistant.question_portefeuille' order by horodatage`, [cabinet])).rows;
    expect(journal.length).toBeGreaterThanOrEqual(6);
    expect(journal[0]).toMatchObject({ entite_id_cible: null, details: { mode: 'sans_ia', dossiersInterroges: 3, horsPerimetre: 0 } });
    for (const interdit of [MOT, 'Alpha', ...new Set(questions)]) expect(JSON.stringify(journal)).not.toContain(interdit);
  });

  it('validation et refus : question bornée, aucune clé libre, déposant refusé avant toute recherche, sans jeton 401', async () => {
    const avant = (await evenements()).length;
    const url = '/v1/assistant/questions';
    expect((await api('remi', 'POST', url, { question: 'ab' })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { question: 'a'.repeat(1001) })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { question: 'Une question', cabinetId: cabinet })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { question: 'Une question', dossierIds: [] })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { question: 'Une question', dossierIds: ['pas-un-identifiant'] })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { question: 'Une question', dossierIds: Array.from({ length: 201 }, () => randomUUID()) })).statut).toBe(400);
    expect((await api('', 'POST', url, { question: 'Une question' })).statut).toBe(401);
    // Déposant (rôle client déposant, niveau « dépôt » sur tous les dossiers) : refusé, en lecture comme en écriture.
    expect((await api('client', 'POST', url, { question: `Que disent les notes ${MOT} ?` })).statut).toBe(403);
    expect((await api('client', 'POST', url, { question: 'Une question', dossierIds: [dossier.a] })).statut).toBe(403);
    expect((await api('client', 'GET', url)).statut).toBe(403);
    // Membre non déposant dont TOUTES les habilitations sont au niveau « dépôt » : aucun dossier en lecture, refusé aussi.
    for (const cle of ['a', 'b', 'd'] as const) await habiliter(cle, DEMO.chloe, 'depot');
    expect((await demander('chloe', 'POST', { question: `Que disent les notes ${MOT} ?` })).statut).toBe(403);
    expect((await api('chloe', 'GET', '/v1/assistant/perimetre')).json.dossiers).toEqual([]);
    await habiliter('a', DEMO.chloe, 'collaboration');
    await habiliter('b', DEMO.chloe, 'lecture');
    await habiliter('d', DEMO.chloe, 'collaboration');
    await api('alice', 'GET', '/v1/ia');
    expect((await evenements()).length).toBe(avant);
  });
});

describe('échanges conservés : chacun les siens, et filtrés selon les habilitations DU MOMENT', () => {
  let echangeAlice = '';

  it('chacun ne relit que ses propres échanges, les plus récents d’abord — par l’API et dans la base elle-même', async () => {
    const r = await poser('alice', `Que disent les notes ${MOT} ?`);
    expect(r.json.echangeEnregistre).toBe(true);
    echangeAlice = r.json.echangeId;
    // Alice est habilitée sur les quatre dossiers : sa réponse cite C.
    expect(r.json.perimetre.dossiers.map((d: any) => d.id)).toEqual([dossier.a, dossier.b, dossier.c, dossier.d]);
    expect(citations(r.json.reponse)).toContainEqual(expect.objectContaining({ id: `piece:${piece.c}:p1`, dossierId: dossier.c }));
    const alice = (await api('alice', 'GET', '/v1/assistant/questions')).json;
    expect(alice).toMatchObject({ page: 1, total: 1 });
    expect(alice.echanges[0]).toMatchObject({ id: echangeAlice, mode: 'sans_ia', statut: 'repondu', masque: null });
    const remi = (await api('remi', 'GET', '/v1/assistant/questions')).json;
    expect(remi.total).toBeGreaterThanOrEqual(6);
    expect(remi.echanges.map((e: any) => e.id)).not.toContain(echangeAlice);
    // Seuls SES identifiants demandés et écartés lui sont rendus tels quels ; rien d'autre ne vient du dossier C.
    expect(JSON.stringify(remi.echanges.map((e: any) => ({ ...e, perimetre: { ...e.perimetre, horsPerimetre: [] } })))).not.toContain(dossier.c);
    const dates = remi.echanges.map((e: any) => e.creeLe);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect((await api('chloe', 'GET', '/v1/assistant/questions')).json).toMatchObject({ total: 0, echanges: [] });
    expect((await api('remi', 'GET', '/v1/assistant/questions?page=0')).statut).toBe(400);
    const app = creerAccesBd(urlBd('app'), { max: 1 });
    try {
      const vues = await app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.remi }, async (tx) => (await tx.execute(sql`select distinct utilisateur_id from echanges_portefeuille`)).rows);
      expect(vues).toEqual([{ utilisateur_id: DEMO.remi }]);
      // Un échange ne se modifie ni ne se supprime, même par son auteur.
      await expect(app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.remi }, (tx) => tx.execute(sql`delete from echanges_portefeuille`))).rejects.toThrow();
      await expect(app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.remi }, (tx) => tx.execute(sql`update echanges_portefeuille set question = 'x'`))).rejects.toThrow();
    } finally {
      await app.fermer();
    }
  });

  it('retrait d’habilitation APRÈS coup : l’échange relu ne montre plus ce dossier (périmètre, sources, éléments), sans le nommer', async () => {
    await retirer('c', DEMO.alice);
    const relu = (await api('alice', 'GET', '/v1/assistant/questions')).json.echanges.find((e: any) => e.id === echangeAlice);
    expect(relu.masque).toEqual({ dossiers: 1, redactionRetiree: false });
    expect(relu.perimetre.dossiers.map((d: any) => d.id)).toEqual([dossier.a, dossier.b, dossier.d]);
    const brut = JSON.stringify(relu);
    for (const interdit of [dossier.c, piece.c, NOMS.c, SECRET, 'Charlie']) expect(brut).not.toContain(interdit);
    // Les éléments des dossiers encore autorisés restent, avec leurs citations.
    expect(citations(relu.reponse)).toContainEqual(expect.objectContaining({ id: `piece:${piece.a}:p1`, dossierId: dossier.a }));
    expect(relu.reponse.sources.every((x: any) => [dossier.a, dossier.b, null].includes(x.dossierId))).toBe(true);
    // La ligne conservée, elle, n'a pas été réécrite : c'est la LECTURE qui filtre.
    const stocke = (await editeur.query('select contenu from echanges_portefeuille where id = $1', [echangeAlice])).rows[0].contenu;
    expect(JSON.stringify(stocke)).toContain(dossier.c);
    // Et une nouvelle question n'interroge plus C.
    const debut = await maintenant();
    const r = await poser('alice', `Que disent les notes ${MOT} ?`);
    expect(r.json.perimetre.dossiers.map((d: any) => d.id)).toEqual([dossier.a, dossier.b, dossier.d]);
    expect(JSON.stringify(r.json)).not.toContain(dossier.c);
    await api('alice', 'GET', '/v1/ia');
    expect((await depuis(debut)).filter((l) => l.entite_id_cible === dossier.c)).toEqual([]);
    // Habilitation rendue : l'échange d'origine redevient complet (rien n'avait été détruit).
    await habiliter('c', DEMO.alice, 'validation');
    const rendu = (await api('alice', 'GET', '/v1/assistant/questions')).json.echanges.find((e: any) => e.id === echangeAlice);
    expect(rendu.masque).toBeNull();
    expect(rendu.perimetre.dossiers.map((d: any) => d.id)).toContain(dossier.c);
  });

  it('une habilitation abaissée au niveau « dépôt » masque le dossier de la même façon', async () => {
    await habiliter('c', DEMO.alice, 'depot');
    const relu = (await api('alice', 'GET', '/v1/assistant/questions')).json.echanges.find((e: any) => e.id === echangeAlice);
    expect(relu.masque).toMatchObject({ dossiers: 1 });
    expect(JSON.stringify(relu)).not.toContain(dossier.c);
    await habiliter('c', DEMO.alice, 'validation');
  });

  it('filtrage d’un échange RÉDIGÉ par un modèle : la rédaction est retirée en bloc dès qu’un dossier est masqué (fonction pure)', () => {
    const citation = (id: string, dossierId: string | null) => ({ id, nature: 'piece' as const, libelle: id, reference: null, dossierId });
    const contenu: ContenuPortefeuille = {
      perimetre: { borne: 20, elementsParDossier: 17, autorises: 2, dossiers: [{ id: 'A', nom: 'A', exercice: null, periode: null, donneesManquantes: [], sources: 1, nonRestitues: 0 }, { id: 'C', nom: 'C', exercice: null, periode: null, donneesManquantes: ['x'], sources: 1, nonRestitues: 0 }], nonInterroges: [{ id: 'Z', nom: 'Z' }], horsPerimetre: [], periodeCommune: null },
      reponse: {
        statut: 'repondu', motifAbstention: null, mode: 'ia', etiquette: 'e',
        segments: [{ type: 'fait', texte: 'A va bien.', citations: [citation('pa', 'A')], reglementaire: false }, { type: 'interpretation', texte: 'C est en difficulté.', citations: [], reglementaire: false }],
        sources: [citation('pa', 'A'), citation('pc', 'C')], donneesManquantes: ['Le bilan de C manque.'], pointsEcartes: [], abstentionsPartielles: [], refus: [], etapes: 2,
        confiance: { statut: 'non_evaluee', mention: 'm' }, iaIndisponible: null, prompt: { id: 'assistant-documente', version: '1.0.0' },
      },
    };
    expect(filtrerSelonHabilitations(contenu, new Set(['A', 'C', 'Z']))).toEqual({ contenu, masque: null });
    const f = filtrerSelonHabilitations(contenu, new Set(['A']));
    expect(f.masque).toEqual({ dossiers: 1, redactionRetiree: true });
    expect(f.contenu.reponse).toMatchObject({ statut: 'abstention', segments: [], donneesManquantes: [], sources: [citation('pa', 'A')] });
    expect(f.contenu.perimetre).toMatchObject({ dossiers: [{ id: 'A' }], nonInterroges: [] });
    expect(JSON.stringify(f.contenu)).not.toContain('difficulté');
    // Sans IA : seul le segment citant le dossier masqué disparaît.
    const sansIa: ContenuPortefeuille = { ...contenu, reponse: { ...contenu.reponse, mode: 'sans_ia', segments: [contenu.reponse.segments[0]!, { type: 'fait', texte: 'Pièce de C', citations: [citation('pc', 'C')], reglementaire: false }] } };
    const g = filtrerSelonHabilitations(sansIa, new Set(['A']));
    expect(g.masque).toEqual({ dossiers: 1, redactionRetiree: false });
    expect(g.contenu.reponse.segments.map((x) => x.texte)).toEqual(['A va bien.']);
    expect(g.contenu.reponse.statut).toBe('repondu');
  });
});

describe('chemin « modèle » contre le SIMULATEUR, avec les ports réels (base réelle sous RLS)', () => {
  let bd: AccesBd;
  const cfg = lireConfig();
  let chloe: Acces;
  const sim = new SimulateurIa();
  let ia: ReturnType<typeof assemblerIa>;

  beforeAll(async () => {
    bd = creerAccesBd(urlBd('app'), { max: 4 });
    const u = (await editeur.query('select sujet_oidc, email, nom from utilisateurs where id = $1', [DEMO.chloe])).rows[0];
    chloe = { cabinetId: cabinet, utilisateurId: DEMO.chloe, sujet: u.sujet_oidc, role: 'collaborateur', email: u.email, nom: u.nom };
    // Le simulateur n'est instancié QUE dans ce code de test ; l'application, elle, n'a aucun fournisseur.
    ia = assemblerIa(bd, sim, null);
  });
  afterAll(async () => {
    await ia.journal.vider();
    await bd.fermer();
  });

  it('le « modèle » désigne un dossier PARMI le périmètre : réponse aux citations valides, chaque source avec son dossier, tracée SIMULATEUR', async () => {
    const debut = await maintenant();
    expect(ia.statut().statut).toBe('simule');
    sim.reinitialiser().programmer(
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: MOT, limite: 5, dossierId: dossier.a } }, { nom: 'rechercherDocuments', arguments: { requete: MOT, limite: 5, dossierId: dossier.b } }] },
      {
        appels: [
          {
            nom: 'rendre_reponse',
            arguments: {
              statut: 'repondu',
              motifAbstention: null,
              segments: [
                { type: 'fait', texte: 'Le dossier Alpha contient une note sur un contrat de maintenance.', citations: [`piece:${piece.a}:p1`], reglementaire: false },
                { type: 'fait', texte: 'Le dossier Bravo contient une note sur un bail commercial.', citations: [`piece:${piece.b}:p1`], reglementaire: false },
                { type: 'fait', texte: 'Le dossier Charlie contient aussi une note.', citations: [`piece:${piece.c}:p1`], reglementaire: false },
              ],
              donneesManquantes: [],
            },
          },
        ],
      },
    );
    const r = await poserQuestionPortefeuille({ bd, ia, cfg }, chloe, { question: 'Que contiennent les notes de mes dossiers ?' });
    expect(sim.restantes).toBe(0);
    expect(r).toMatchObject({ mode: 'simulateur', echangeEnregistre: true });
    expect(r.reponse).toMatchObject({ statut: 'repondu', mode: 'ia', etapes: 2, refus: [] });
    expect(r.reponse.segments.map((x) => x.citations.map((c) => [c.id, c.dossierId]))).toEqual([[[`piece:${piece.a}:p1`, dossier.a]], [[`piece:${piece.b}:p1`, dossier.b]]]);
    // La citation d'une pièce du dossier non habilité n'a jamais été renvoyée par une fonction : segment écarté.
    expect(r.reponse.pointsEcartes).toEqual([{ index: 2, type: 'fait', motif: 'citation_inconnue' }]);
    // Le « modèle » ne reçoit que des identifiants de dossiers autorisés ; ni C ni son contenu.
    const transmis = JSON.stringify(sim.demandes);
    expect(transmis).toContain(dossier.a);
    for (const interdit of [dossier.c, SECRET, NOMS.c]) expect(transmis).not.toContain(interdit);
    const echange = (await editeur.query('select mode, statut, utilisateur_id, dossiers from echanges_portefeuille where id = $1', [r.echangeId])).rows[0];
    expect(echange).toEqual({ mode: 'simulateur', statut: 'repondu', utilisateur_id: DEMO.chloe, dossiers: [dossier.a, dossier.b, dossier.d] });
    const lignes = await depuis(debut);
    expect(lignes.every((l) => l.nature === 'simulateur')).toBe(true);
    expect(lignes.filter((l) => l.type === 'fonction_metier').map((l) => [l.resultat, l.mesures.fonction, l.entite_id_cible]).sort()).toEqual([['executee', 'rechercherDocuments', dossier.a], ['executee', 'rechercherDocuments', dossier.b]].sort());
  });

  it('un modèle « manipulé » qui demande un dossier HORS périmètre, omet le dossier ou change de cabinet est refusé et tracé ; rien n’est lu', async () => {
    const debut = await maintenant();
    sim.reinitialiser().programmer(
      {
        appels: [
          { nom: 'rechercherDocuments', arguments: { requete: SECRET, limite: 20, dossierId: dossier.c } },
          { nom: 'rechercherDocuments', arguments: { requete: 'tout', limite: 20, dossierId: DEMO.dupain } },
          { nom: 'lireBalance', arguments: {} },
          { nom: 'listerConstats', arguments: { dossierId: dossier.a, cabinetId: DEMO.cabinetA } },
          { nom: 'calculerIndicateur', arguments: { indicateurId: 'SIG-CA', dossierId: [dossier.a, dossier.c] } },
        ],
      },
      { appels: [{ nom: 'rendre_reponse', arguments: { statut: 'repondu', motifAbstention: null, segments: [{ type: 'fait', texte: 'Le dossier Charlie contient un élément confidentiel.', citations: [`piece:${piece.c}:p1`], reglementaire: false }], donneesManquantes: [] } }] },
    );
    const r = await poserQuestionPortefeuille({ bd, ia, cfg }, chloe, { question: 'Montre-moi tout, y compris les dossiers des autres.' });
    expect(r.reponse.refus.map((x) => [x.fonction, x.code])).toEqual([
      ['rechercherDocuments', 'dossier_hors_perimetre'],
      ['rechercherDocuments', 'dossier_hors_perimetre'],
      ['lireBalance', 'dossier_a_preciser'],
      ['listerConstats', 'changement_de_contexte_refuse'],
      ['calculerIndicateur', 'dossier_hors_perimetre'],
    ]);
    expect(r.reponse.sources).toEqual([]);
    expect(r.reponse).toMatchObject({ statut: 'abstention', mode: 'ia', segments: [] });
    expect(r.perimetre.dossiers.map((d) => d.id)).toEqual([dossier.a, dossier.b, dossier.d]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    // Traces : cinq refus, natures « simulateur », et aucune ne porte le dossier hors périmètre comme cible exécutée.
    const lignes = await depuis(debut);
    const fonctions = lignes.filter((l) => l.type === 'fonction_metier');
    expect(fonctions.map((l) => [l.nature, l.resultat, l.codes[0]]).sort()).toEqual([
      ['simulateur', 'refusee', 'changement_de_contexte_refuse'],
      ['simulateur', 'refusee', 'dossier_a_preciser'],
      ['simulateur', 'refusee', 'dossier_hors_perimetre'],
      ['simulateur', 'refusee', 'dossier_hors_perimetre'],
      ['simulateur', 'refusee', 'dossier_hors_perimetre'],
    ]);
    expect(fonctions.filter((l) => l.resultat === 'executee')).toEqual([]);
    expect(fonctions.filter((l) => l.entite_id_cible === dossier.c)).toEqual([]);
    expect(JSON.stringify(lignes)).not.toContain(SECRET);
  });

  it('habilitation retirée PENDANT la réponse : la fonction suivante sur ce dossier est refusée (niveau relu en base à chaque appel)', async () => {
    const debut = await maintenant();
    sim.reinitialiser().programmer(
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: MOT, limite: 5, dossierId: dossier.b } }] },
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: MOT, limite: 5, dossierId: dossier.b } }] },
      { appels: [{ nom: 'rendre_reponse', arguments: { statut: 'abstention', motifAbstention: 'Essai.', segments: [], donneesManquantes: [] } }] },
    );
    // Le retrait intervient entre le premier et le deuxième tour : à la première demande d'embeddings ou de complétion suivante.
    let tours = 0;
    const origine = sim.completer.bind(sim);
    sim.completer = async (demande) => {
      tours += 1;
      if (tours === 2) await retirer('b', DEMO.chloe);
      return origine(demande);
    };
    try {
      const r = await poserQuestionPortefeuille({ bd, ia, cfg }, chloe, { question: 'Cherche deux fois dans Bravo.' });
      expect(r.reponse.refus.map((x) => [x.fonction, x.code])).toEqual([['rechercherDocuments', 'habilitation_refusee']]);
      const lignes = (await depuis(debut)).filter((l) => l.type === 'fonction_metier');
      expect(lignes.map((l) => [l.resultat, l.codes[0] ?? null])).toEqual([['executee', null], ['refusee', 'habilitation_refusee']]);
    } finally {
      sim.completer = origine;
      await habiliter('b', DEMO.chloe, 'lecture');
    }
  });

  it('un déposant et un membre d’un autre cabinet sont refusés avant tout appel du « modèle »', async () => {
    const u = (await editeur.query('select sujet_oidc, email, nom from utilisateurs where id = $1', [DEMO.client])).rows[0];
    const client: Acces = { cabinetId: cabinet, utilisateurId: DEMO.client, sujet: u.sujet_oidc, role: 'client_deposant', email: u.email, nom: u.nom };
    sim.reinitialiser();
    await expect(poserQuestionPortefeuille({ bd, ia, cfg }, client, { question: 'Que contiennent mes dossiers ?' })).rejects.toMatchObject({ status: 403 });
    await expect(relireEchangesPortefeuille({ bd, ia, cfg }, client, 1)).rejects.toMatchObject({ status: 403 });
    // Chloé « dans » un cabinet où elle n'a aucune habilitation sur ces dossiers : son périmètre n'en contient aucun.
    await expect(poserQuestionPortefeuille({ bd, ia, cfg }, { ...chloe, cabinetId: DEMO.cabinetB }, { question: 'Que contiennent mes dossiers ?', dossierIds: [dossier.a] })).rejects.toMatchObject({ status: expect.toSatisfy((x: number) => x === 403 || x === 404) });
    expect(sim.demandes).toHaveLength(0);
  });

  it('l’API réelle, elle, n’utilise jamais le simulateur', async () => {
    const r = await poser('remi', `Que disent les notes ${MOT} ?`);
    expect(r.json).toMatchObject({ mode: 'sans_ia', ia: { statut: 'non_connecte' } });
  });
});

describe('borne sur le nombre de dossiers par question', () => {
  it('au-delà de la borne, le périmètre est réduit ET annoncé : dossiers non interrogés nommés, rien de tronqué en silence', async () => {
    // Dix-neuf dossiers vides de plus, ouverts en lecture à Alice : son périmètre passe à 23 dossiers.
    plus = [];
    for (let i = 1; i <= 19; i++) {
      const nom = `Portefeuille ${SEL} Zoulou ${String(i).padStart(2, '0')} SARL`;
      const id = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole' })).json.id as string;
      expect((await api('alice', 'PUT', `/v1/dossiers/${id}/habilitations/${DEMO.alice}`, { niveau: 'lecture' })).statut).toBeLessThan(300);
      plus.push({ id, nom });
    }
    const perimetre = (await api('alice', 'GET', '/v1/assistant/perimetre')).json;
    expect(perimetre.dossiers).toHaveLength(23);
    expect(perimetre).toMatchObject({ borne: 20, elementsParDossier: 1 });

    const debut = await maintenant();
    const r = await poser('alice', `Que disent les notes ${MOT} ?`);
    expect(r.statut).toBe(200);
    const p = r.json.perimetre;
    expect(p).toMatchObject({ borne: BORNE_DOSSIERS_PORTEFEUILLE, autorises: 23, elementsParDossier: 1, horsPerimetre: [], tranche: { numero: 1, total: 2, premier: 1, dernier: 20, retenus: 23 } });
    // Les vingt premiers par ordre alphabétique sont interrogés ; les trois autres sont NOMMÉS comme non interrogés.
    expect(p.dossiers.map((d: any) => d.id)).toEqual([dossier.a, dossier.b, dossier.c, dossier.d, ...plus.slice(0, 16).map((d) => d.id)]);
    expect(p.nonInterroges).toEqual(plus.slice(16));
    // Un élément au plus par dossier ; ce qui dépasse est décompté, pas perdu en silence.
    for (const d of p.dossiers) expect(d.sources).toBeLessThanOrEqual(1);
    expect(r.json.reponse.segments.length).toBeLessThanOrEqual(40);
    expect(citations(r.json.reponse).map((c) => c.dossierId).sort()).toEqual([dossier.a, dossier.b, dossier.c].sort());
    // Aucune fonction n'a visé un dossier non interrogé.
    await api('alice', 'GET', '/v1/ia');
    const vises = new Set((await depuis(debut)).filter((l) => l.type === 'fonction_metier').map((l) => l.entite_id_cible));
    for (const d of plus.slice(16)) expect(vises.has(d.id)).toBe(false);
    expect(vises.has(plus[15]!.id)).toBe(true);
    // En sélectionnant les dossiers laissés de côté, on les interroge.
    const cible = await poser('alice', `Que disent les notes ${MOT} ?`, { dossierIds: [...plus.slice(16).map((d) => d.id), dossier.a] });
    expect(cible.json.perimetre.dossiers.map((d: any) => d.id)).toEqual([dossier.a, ...plus.slice(16).map((d) => d.id)]);
    expect(cible.json.perimetre).toMatchObject({ nonInterroges: [], elementsParDossier: 8 });
  });

  it('une question à calculs sur le portefeuille entier : un calcul du moteur par dossier qui en a, avant toute pièce', async () => {
    const r = await poser('alice', `Quel est le chiffre d’affaires ? ${MOT}`);
    const rep = r.json.reponse;
    // Avec un seul élément par dossier, la priorité va au calcul : A, B et C rendent leur indicateur, pas leur note.
    for (const cle of ['a', 'b', 'c'] as const) {
      const duDossier = citations(rep).filter((c) => c.dossierId === dossier[cle]);
      expect(duDossier.map((c) => c.id)).toEqual([`indicateur:${exercice[cle]}:SIG-CA`]);
      const d = r.json.perimetre.dossiers.find((x: any) => x.id === dossier[cle]);
      expect(d.nonRestitues).toBeGreaterThanOrEqual(1); // la note trouvée n'est pas restituée, et c'est décompté
    }
  });
});

describe('tranches de dossiers, période commune et habilitations relues à chaque tranche', () => {
  const ids = (r: any): string[] => r.json.perimetre.dossiers.map((d: any) => d.id);
  const vises = async (instant: string): Promise<Set<string>> => {
    await api('alice', 'GET', '/v1/ia');
    return new Set((await depuis(instant)).filter((l) => l.type === 'fonction_metier').map((l) => l.entite_id_cible));
  };
  let exercicePlus = '';

  it('classement par pertinence : un dossier ayant des données passe avant des dossiers vides, même placé après dans l’ordre alphabétique', async () => {
    const dernier = plus[18]!;
    expect((await api('alice', 'PUT', `/v1/dossiers/${dernier.id}/habilitations/${DEMO.alice}`, { niveau: 'validation' })).statut).toBeLessThan(300);
    exercicePlus = (await api('alice', 'POST', `/v1/dossiers/${dernier.id}/exercices`, EX_A)).json.id;
    const fec = genererFecSynthetique({ exercice: EX_A, nbEcritures: 30, graine: Number.parseInt(SEL.slice(0, 6), 16) + 9, anomalies: [] as never });
    const d = await deposer('alice', dernier.id, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercicePlus, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('alice', d.fin.json.lotImportId);

    const t1 = await poser('alice', `Que disent les notes ${MOT} ?`);
    expect(t1.statut).toBe(200);
    // Rang 0 (données) : A, B, C, Zoulou 19 ; rang 1 (exercice sans donnée) : D ; rang 2 : Zoulou 01 à 18 — alphabétique à égalité.
    expect(ids(t1)).toEqual([dossier.a, dossier.b, dossier.c, dernier.id, dossier.d, ...plus.slice(0, 15).map((x) => x.id)]);
    expect(t1.json.perimetre).toMatchObject({ tranche: { numero: 1, total: 2, premier: 1, dernier: 20, retenus: 23 }, ordre: expect.stringContaining('données comptables importées d’abord') });
    expect(t1.json.perimetre.nonInterroges).toEqual(plus.slice(15, 18));
    // En base : les dossiers de rang 0 ont bien un lot FEC actif et terminé.
    const enBase = await editeur.query(`select entite_id from lots_import where cabinet_id = $1 and actif and type = 'fec' and statut in ('termine', 'termine_avec_erreurs')`, [cabinet]);
    expect(new Set(enBase.rows.map((l) => l.entite_id))).toEqual(new Set([dossier.a, dossier.b, dossier.c, dernier.id]));
  });

  it('chaque tranche est une question distincte : réponses séparées, périmètres disjoints, enregistrées séparément, jamais fusionnées', async () => {
    const debut = await maintenant();
    const t1 = await poser('alice', `Que disent les notes ${MOT} ?`, { tranche: 1 });
    const t2 = await poser('alice', `Que disent les notes ${MOT} ?`, { tranche: 2 });
    expect(t2.statut).toBe(200);
    expect(t2.json.perimetre.tranche).toEqual({ numero: 2, total: 2, premier: 21, dernier: 23, retenus: 23 });
    expect(ids(t2)).toEqual(plus.slice(15, 18).map((x) => x.id));
    expect(ids(t1).filter((x) => ids(t2).includes(x))).toEqual([]);
    // Trois dossiers seulement : le budget par dossier est celui de trois dossiers, pas de vingt.
    expect(t2.json.perimetre.elementsParDossier).toBe(elementsParDossier(3));
    expect(t2.json.perimetre.nonInterroges.map((d: any) => d.id)).toEqual(ids(t1));
    expect(t1.json.echangeId).not.toBe(t2.json.echangeId);
    // Aucune citation de la tranche 2 ne vise un dossier de la tranche 1, et inversement (aucune fusion).
    for (const c of citations(t2.json.reponse)) expect([null, ...ids(t2)]).toContain(c.dossierId);
    for (const c of citations(t1.json.reponse)) expect([null, ...ids(t1)]).toContain(c.dossierId);
    // Deux échanges distincts dans l'historique, chacun avec SA tranche.
    const histo = (await api('alice', 'GET', '/v1/assistant/questions')).json.echanges;
    expect(histo.find((e: any) => e.id === t2.json.echangeId).perimetre.tranche.numero).toBe(2);
    expect(histo.find((e: any) => e.id === t1.json.echangeId).perimetre.tranche.numero).toBe(1);
    // Chaque question n'a visé que les dossiers de SA tranche.
    const v = await vises(debut);
    for (const d of plus.slice(15, 18)) expect(v.has(d.id)).toBe(true);
    // Audit : le numéro de tranche, sans nom de dossier ni texte de question.
    const audit = (await editeur.query(`select details from journal_audit where cabinet_id = $1 and action = 'assistant.question_portefeuille' and cible_id = $2`, [cabinet, t2.json.echangeId])).rows[0].details;
    expect(audit).toMatchObject({ tranche: 2, tranches: 2, dossiersInterroges: 3, dossiersNonInterroges: 20 });
    expect(JSON.stringify(audit)).not.toContain(plus[15]!.nom);
    // Validation : tranche entière positive, bornée ; une tranche qui n'existe pas est un conflit, pas une réponse vide.
    for (const t of [0, -1, 1.5, 501, '2']) expect((await poser('alice', 'Une question', { tranche: t })).statut, String(t)).toBe(400);
    // Au-delà de la dixième tranche : valide tant que le périmètre l'est (régression : la borne était liée à la liste `dossierIds`, et non au périmètre) ; ici le périmètre n'a que deux tranches : 409.
    const onzieme = await poser('alice', 'Une question', { tranche: 11 });
    expect(onzieme.statut).toBe(409);
    expect(onzieme.json.message).toContain('La tranche 11 n’existe plus');
    const absente = await poser('alice', 'Une question', { tranche: 3 });
    expect(absente.statut).toBe(409);
    expect(absente.json.message ?? JSON.stringify(absente.json)).toContain('n’existe plus');
    // Une sélection de moins de vingt dossiers n'a qu'une tranche.
    const une = await poser('alice', 'Une question', { dossierIds: [dossier.a], tranche: 2 });
    expect(une.statut).toBe(409);
    // Un déposant est refusé avant tout, tranche ou non ; un autre cabinet n'obtient rien d'ici.
    expect((await poser('client', 'Une question', { tranche: 2 })).statut).toBe(403);
    expect(JSON.stringify((await poser('bruno', 'Une question', { tranche: 1 })).json)).not.toContain(plus[0]!.id);
  });

  it('période commune : dossiers sans recoupement annoncés (jamais écartés en silence), classement tenant compte de la période', async () => {
    const periode = { debut: '2025-01-01', fin: '2025-03-31' };
    const t1 = await poser('alice', 'Quel est le solde du compte 512 ?', { periode });
    expect(t1.statut).toBe(200);
    const dernier = plus[18]!;
    // Recoupement + données : A, B, C, Zoulou 19 ; ni D (exercice 2026) ni les Zoulou vides ne recoupent : rang 2, alphabétique.
    expect(ids(t1)).toEqual([dossier.a, dossier.b, dossier.c, dernier.id, dossier.d, ...plus.slice(0, 15).map((x) => x.id)]);
    expect(t1.json.perimetre).toMatchObject({ periodeCommune: periode, tranche: { numero: 1, total: 2 } });
    const par = new Map<string, any>(t1.json.perimetre.dossiers.map((d: any) => [d.id, d]));
    for (const id of [dossier.a, dossier.b, dossier.c, dernier.id]) expect(par.get(id).periode).toEqual(periode);
    const message = 'Aucun exercice de ce dossier ne recoupe la période demandée : la comptabilité n’a pas été interrogée.';
    for (const id of [dossier.d, ...plus.slice(0, 15).map((x) => x.id)]) {
      expect(par.get(id)).toMatchObject({ exercice: null, periode: null, donneesManquantes: [message], sources: 0 });
    }
    // Deuxième tranche, même période : les trois derniers dossiers (sans recoupement) sont annoncés eux aussi.
    const t2 = await poser('alice', 'Quel est le solde du compte 512 ?', { periode, tranche: 2 });
    expect(ids(t2)).toEqual(plus.slice(15, 18).map((x) => x.id));
    for (const d of t2.json.perimetre.dossiers) expect(d.donneesManquantes).toEqual([message]);
    expect(t2.json.perimetre.periodeCommune).toEqual(periode);
    // Une période qui ne recoupe rien du tout : tous les dossiers sont annoncés sans recoupement, aucun calcul inventé.
    const nulle = await poser('alice', 'Quel est le solde du compte 512 ?', { periode: { debut: '2015-01-01', fin: '2015-06-30' } });
    expect(nulle.json.perimetre.dossiers.every((d: any) => d.exercice === null && d.donneesManquantes[0] === message)).toBe(true);
    expect(citations(nulle.json.reponse).filter((c) => c.id.startsWith('balance:'))).toEqual([]);
    // Dates réelles : le 30 février est refusé par la validation, pas corrigé.
    for (const p of [{ debut: '2025-02-30', fin: '2025-03-31' }, { debut: '2025-13-01', fin: '2025-12-31' }, { debut: '2025-04-01', fin: '2025-03-31' }, { debut: '2025-01-01' }, { debut: '0000-01-01', fin: '2025-12-31' }]) {
      expect((await poser('alice', 'Une question', { periode: p })).statut, JSON.stringify(p)).toBe(400);
    }
  });

  it('habilitation retirée ENTRE deux tranches : la seconde est recalculée sous les droits du moment ; le dossier retiré n’est ni interrogé ni nommé', async () => {
    const t1 = await poser('alice', `Que disent les notes ${MOT} ?`);
    const [z16, z17, z18] = plus.slice(15, 18) as [typeof plus[number], typeof plus[number], typeof plus[number]];
    expect(t1.json.perimetre.nonInterroges.map((d: any) => d.id)).toEqual([z16.id, z17.id, z18.id]);
    // Entre les deux tranches, Alice perd l'accès à Zoulou 17 (tranche 2) et à Zoulou 02 (tranche 1, déjà interrogé).
    await editeur.query('delete from habilitations_dossier where entite_id = any($1::uuid[]) and utilisateur_id = $2', [[z17.id, plus[1]!.id], DEMO.alice]);
    const debut = await maintenant();
    const t2 = await poser('alice', `Que disent les notes ${MOT} ?`, { tranche: 2 });
    expect(t2.statut).toBe(200);
    expect(t2.json.perimetre).toMatchObject({ autorises: 21, tranche: { numero: 2, total: 2, premier: 21, dernier: 21, retenus: 21 } });
    expect(ids(t2)).toEqual([z18.id]);
    // z16 se retrouve en tranche 1 (le classement est recalculé) : il n'est plus dans la seconde.
    expect(t2.json.perimetre.nonInterroges.map((d: any) => d.id)).not.toContain(z17.id);
    for (const interdit of [z17.id, z17.nom, plus[1]!.id, plus[1]!.nom]) expect(JSON.stringify(t2.json)).not.toContain(interdit);
    expect((await vises(debut)).has(z17.id)).toBe(false);
    // L'échange de la première tranche, relu, ne montre plus Zoulou 02 : masqué sans être nommé.
    const relu = (await api('alice', 'GET', '/v1/assistant/questions')).json.echanges.find((e: any) => e.id === t1.json.echangeId);
    expect(relu.masque).toMatchObject({ dossiers: 1 });
    expect(relu.perimetre.dossiers.map((d: any) => d.id)).not.toContain(plus[1]!.id);
    expect(JSON.stringify(relu)).not.toContain(plus[1]!.nom);
    // Retirer aussi Zoulou 16 et 18 : la seconde tranche n'existe plus, la demander est un conflit (et non une réponse sur d'autres dossiers).
    await editeur.query('delete from habilitations_dossier where entite_id = any($1::uuid[]) and utilisateur_id = $2', [[z16.id, z18.id], DEMO.alice]);
    expect((await poser('alice', `Que disent les notes ${MOT} ?`, { tranche: 2 })).statut).toBe(409);
    const seule = await poser('alice', `Que disent les notes ${MOT} ?`);
    expect(seule.json.perimetre).toMatchObject({ autorises: 19, tranche: { numero: 1, total: 1, premier: 1, dernier: 19, retenus: 19 }, nonInterroges: [] });
  });
});
