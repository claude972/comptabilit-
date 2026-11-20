/**
 * Amélioration contrôlée : couverture RÉELLE des branches « extraction » et « rapprochement » du moteur de suggestions
 * (`packages/core/src/amelioration.ts`), sur la pile réelle locale (Keycloak, API, worker, PostgreSQL, S3).
 * Cabinet NEUF à chaque exécution. Les décisions sont produites par les routes existantes, jamais insérées à la main :
 *  - extraction : des factures synthétiques d'un même émetteur sont analysées par le worker, puis un réviseur corrige un
 *    même champ (`PUT v1/documents/:id/extraction`) ;
 *  - rapprochement : un FEC et un relevé cohérents sont importés, le rapprochement est lancé, puis un réviseur rejette
 *    avec motif des propositions d'une même règle (`PATCH v1/rapprochements/:id`).
 * La suggestion est une « nouvelle règle métier » : simple signalement à l'éditeur, rien n'est créé ni transmis.
 */
import { randomBytes } from 'node:crypto';
import { analyserFec, CRITERES_AMELIORATION, enBlocs, genererFecSynthetique, genererReleveSynthetique, genererTexteFactureSynthetique, type LigneFec } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const NOM = `Branches ${SEL} SARL (fictif)`;
const graine = Number.parseInt(SEL.slice(0, 6), 16);
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const MOTIF_RAPPRO = `Libellé bancaire sans rapport avec cette écriture (${SEL})`;
const seuilExtraction = CRITERES_AMELIORATION.extraction.piecesCorrigeesMin;
const seuilRapprochement = CRITERES_AMELIORATION.rapprochement.rejetsMotivesMin;
let editeur: pg.Client;
let cabinet = '';
let cabinet2 = '';
let dossier = '';
let dossier2 = '';
let exercice = '';
/** Empreinte de la suggestion « rapprochement », fixée par la seconde branche et relue par le test d'isolation. */
let empreinteRapprochement = '';

const suggestions = (qui = 'remi') => api(qui, 'GET', '/v1/regles/suggestions');
const trouver = (r: any, empreinte: string) => r.json.suggestions.find((x: any) => x.empreinte === empreinte);
const ponctuelles = (r: any) => r.json.suggestions.find((x: any) => x.categorie === 'correction_donnee');
const attendreDocument = (qui: string, id: string) => attendre(() => api(qui, 'GET', `/v1/documents/${id}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));

/** Facture synthétique d'un émetteur donné (graine) : même émetteur, numéro distinct par pièce. */
function facture(graineEmetteur: number, numero: number) {
  const f = genererTexteFactureSynthetique({ graine: graineEmetteur, type: 'facture', qualite: 'nette' });
  const nouveau = `FA-2026-${numero}`;
  const lignes = f.pages[0]!.texte.split('\n').map((l) => (f.attendu.numero ? l.replaceAll(f.attendu.numero, nouveau) : l));
  return { attendu: f.attendu, pdf: pdfTexte(lignes, `${SEL}-${numero}`), numero: nouveau };
}
const E1 = 11 + (graine % 50);
const E2 = E1 + 101;

async function deposerFacture(qui: string, entite: string, f: ReturnType<typeof facture>) {
  const d = await deposer(qui, entite, f.pdf, { nature: 'facture_achat' }, `facture-${f.numero}.pdf`);
  expect(d.fin.statut).toBe(200);
  const id = d.fin.json.documentId as string;
  const doc = await attendreDocument(qui, id);
  expect(doc.json.document.statut).toBe('a_controler');
  return { id, siren: doc.json.extraction.champs.emetteurSiren?.valeur as string | undefined, nom: doc.json.extraction.champs.emetteurNom?.valeur as string | undefined };
}
const corriger = async (documentId: string, champs: Record<string, string>) => expect((await api('remi', 'PUT', `/v1/documents/${documentId}/extraction`, { champs })).statut).toBe(200);

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  const ouvrir = async (nom: string) => {
    const id = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [nom])).rows[0].id as string;
    await ouvrirEssai(editeur, id, 'demo-essentiel', new Date().toISOString().slice(0, 10));
    for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
      await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '40 minutes')`, [id, u, role]);
    }
    return id;
  };
  cabinet = await ouvrir(`Cabinet d’essai branches ${SEL} (fictif)`);
  cabinet2 = await ouvrir(`Second cabinet d’essai branches ${SEL} (fictif)`);
  const creerDossier = async (nom: string) => {
    const id = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole', regimeFiscal: 'IS' })).json.id as string;
    for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
      expect((await api('alice', 'PUT', `/v1/dossiers/${id}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
    }
    return id;
  };
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = await creerDossier(NOM);
  // Comptabilité et relevé cohérents, pour le rapprochement.
  exercice = (await api('remi', 'POST', `/v1/dossiers/${dossier}/exercices`, EXERCICE)).json.id as string;
  const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 200, graine });
  const d = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  await attendreLot('remi', d.fin.json.lotImportId);
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
  const releve = genererReleveSynthetique({ graine, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 200, coherentAvec: lignes });
  const r = await deposer('remi', dossier, Buffer.from(releve.contenu, 'utf8'), { usage: 'banque' }, releve.nomFichier);
  expect((await attendreLot('remi', r.fin.json.lotImportId)).json.statut).toBe('termine');
  // Second cabinet : un dossier, pour l'isolation.
  for (const qui of COMPTES) choisirCabinet(qui, cabinet2);
  dossier2 = await creerDossier(`Branches ${SEL} second cabinet SARL (fictif)`);
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
}, 420_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = any($1::uuid[])', [[cabinet, cabinet2]]);
  await editeur.end();
});

describe('branche « extraction » : même champ corrigé pour un même émetteur', () => {
  const pieces: Array<{ id: string; siren?: string | undefined; nom?: string | undefined; numero: string }> = [];
  let autreEmetteur = { id: '' };
  let empreinte = '';

  it('cabinet sans décision ; factures d’un même émetteur analysées par le worker, un autre émetteur à part', async () => {
    const avant = (await suggestions()).json;
    expect(avant).toMatchObject({ suggestions: [], sansDecision: true });
    const attendu = facture(E1, 9001).attendu;
    expect(attendu.emetteurSiren).toMatch(/^\d{9}$/);
    for (let i = 1; i <= 4; i++) {
      const f = facture(E1, 9000 + i);
      const p = await deposerFacture('chloe', dossier, f);
      expect(p.siren, 'le worker identifie l’émetteur').toBe(attendu.emetteurSiren);
      pieces.push({ ...p, numero: f.numero });
    }
    const f2 = facture(E2, 9100);
    const p2 = await deposerFacture('chloe', dossier, f2);
    expect(p2.siren).toBe(f2.attendu.emetteurSiren);
    expect(p2.siren).not.toBe(attendu.emetteurSiren);
    autreEmetteur = p2;
    empreinte = `nouvelle_regle_metier|extraction|siren:${attendu.emetteurSiren}|totalTtc`;
    // L'extraction reste celle du worker tant que personne n'a corrigé : aucune décision, aucune suggestion.
    expect((await suggestions()).json).toMatchObject({ suggestions: [], sansDecision: true });
  });

  it(`sous le seuil (${seuilExtraction} pièces) : deux pièces corrigées sur un même champ, ou une pièce d’un autre émetteur, ne suggèrent rien — elles sont comptées comme des corrections de données`, async () => {
    await corriger(pieces[0]!.id, { totalTtc: '1234.56', dateEcheance: '2026-12-31' });
    await corriger(pieces[1]!.id, { totalTtc: '2345.67', dateEcheance: '2026-12-31' });
    await corriger(autreEmetteur.id, { totalTtc: '99.00' });
    const r = await suggestions();
    expect(r.json.sansDecision).toBe(false);
    expect(r.json.suggestions.map((x: any) => x.categorie)).toEqual(['correction_donnee']);
    expect(trouver(r, empreinte)).toBeUndefined();
    // E1/totalTtc : 2 pièces, E1/dateEcheance : 2 pièces, E2/totalTtc : 1 pièce → 5 champs corrigés, aucun seuil atteint.
    expect(ponctuelles(r)).toMatchObject({ proposable: false, proposition: null, renvoi: null, preuves: { decomptes: { champsCorriges: 5, constatsCorriges: 0, rejetsIsoles: 0, rapprochementsRejetesIsoles: 0 } } });
  });

  it('seuil atteint : « nouvelle règle métier », signalement à l’éditeur ; preuves = les pièces corrigées de la base ; rien n’est créé ni transmis', async () => {
    await corriger(pieces[2]!.id, { totalTtc: '3456.78' });
    const r = await suggestions();
    const s = trouver(r, empreinte);
    expect(s).toBeDefined();
    expect(s).toMatchObject({ categorie: 'nouvelle_regle_metier', controleId: null, portee: null, proposable: false, renvoi: 'editeur', parametre: null, proposition: null, dossierIds: [dossier], dossiers: [{ id: dossier, nom: NOM }], dejaEcartee: null });
    expect(s.titre).toContain('totalTtc');
    expect(s.titre).toContain(pieces[0]!.nom);
    expect(s.critere).toContain(`au moins ${seuilExtraction} pièces distinctes`);
    expect(s.critere).toContain(`v${CRITERES_AMELIORATION.version}`);
    expect(s.preuves.decomptes).toEqual({ piecesCorrigees: 3, dossiers: 1 });
    // Preuves comparées à la base : exactement les extractions en vigueur, corrigées à la main, de cet émetteur et de ce champ.
    const enBase = (
      await editeur.query(
        `select e.document_id, e.entite_id, to_char(e.cree_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as date
         from extractions e where e.cabinet_id = $1 and e.actuelle and e.methode = 'saisie_humaine'
           and e.champs->'totalTtc'->>'methode' = 'saisie_humaine' and e.champs->'emetteurSiren'->>'valeur' = $2`,
        [cabinet, pieces[0]!.siren],
      )
    ).rows;
    expect(enBase.map((l) => l.document_id).sort()).toEqual(pieces.slice(0, 3).map((p) => p.id).sort());
    expect(s.preuves.decisions.map((d: any) => d.decisionId).sort()).toEqual(enBase.map((l) => l.document_id).sort());
    for (const d of s.preuves.decisions) {
      expect(d).toMatchObject({ dossierId: dossier, motif: null });
      expect(d.cibleId).toBe(d.decisionId);
      expect(enBase.find((l) => l.document_id === d.decisionId).date).toBe(d.date);
    }
    expect(s.preuves.periode.du <= s.preuves.periode.au).toBe(true);
    // Ce que la suggestion ne fait pas, dit en clair ; l'autre champ (2 pièces) et l'autre émetteur (1 pièce) n'ont pas de suggestion.
    expect(s.neFaitPas.join(' ')).toContain('Ne crée aucune règle d’extraction');
    expect(s.neFaitPas.join(' ')).toContain('Ne transmet rien à l’éditeur');
    expect(r.json.suggestions.filter((x: any) => x.categorie === 'nouvelle_regle_metier')).toHaveLength(1);
    expect(trouver(r, `nouvelle_regle_metier|extraction|siren:${pieces[0]!.siren}|dateEcheance`)).toBeUndefined();
    // Rien n'est créé : aucune règle, aucune suggestion écartée ; aucune pièce n'a changé de statut du fait de la suggestion.
    for (const table of ['regles_cabinet', 'suggestions_ecartees']) expect((await editeur.query(`select count(*)::int as n from ${table} where cabinet_id = $1`, [cabinet])).rows[0].n).toBe(0);
    expect((await editeur.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action like 'regle.%'`, [cabinet])).rows[0].n).toBe(0);
    // Aucune proposition de règle n'est possible depuis cette suggestion : aucune proposition pré-remplie, et l'écart ne passe que par « écarter ».
    expect((await api('remi', 'POST', '/v1/regles', { controleId: 'EXTRACTION', entiteId: dossier, parametres: {}, motif: 'Essai' })).statut).toBeGreaterThanOrEqual(400);
  });

  it('une même pièce corrigée plusieurs fois ne compte qu’une fois ; une quatrième pièce porte le décompte à quatre', async () => {
    await corriger(pieces[0]!.id, { totalTtc: '1111.11' });
    expect(trouver(await suggestions(), empreinte).preuves.decomptes).toEqual({ piecesCorrigees: 3, dossiers: 1 });
    await corriger(pieces[3]!.id, { totalTtc: '4567.89' });
    const s = trouver(await suggestions(), empreinte);
    expect(s.preuves.decomptes).toEqual({ piecesCorrigees: 4, dossiers: 1 });
    expect(s.preuves.decisions.map((d: any) => d.decisionId).sort()).toEqual(pieces.map((p) => p.id).sort());
  });

  it('valider une pièce corrigée ne retire pas la correction du décompte (la validation porte sur la version corrigée)', async () => {
    const v = await api('remi', 'POST', `/v1/documents/${pieces[2]!.id}/validation`, { decision: 'valider' });
    expect(v.statut).toBe(200);
    expect(v.json).toMatchObject({ statut: 'traite' });
    expect(trouver(await suggestions(), empreinte).preuves.decomptes).toEqual({ piecesCorrigees: 4, dossiers: 1 });
  });

  it('écartée avec motif, elle ne revient pas tant que des corrections postérieures n’atteignent pas seules le seuil', async () => {
    const ok = await api('remi', 'POST', '/v1/regles/suggestions/ecarter', { empreinte, motif: 'Format propre à ce fournisseur, déjà connu de l’éditeur' });
    expect(ok.statut).toBe(201);
    expect(ok.json).toMatchObject({ empreinte, categorie: 'nouvelle_regle_metier', controleId: null, versionCriteres: CRITERES_AMELIORATION.version });
    const r = await suggestions();
    expect(trouver(r, empreinte)).toBeUndefined();
    expect(r.json.ecarteesMaintenues).toEqual([expect.objectContaining({ empreinte, motif: 'Format propre à ce fournisseur, déjà connu de l’éditeur' })]);
    // Une seule correction de plus après l'écart : insuffisante à elle seule.
    await corriger(pieces[1]!.id, { totalTtc: '2222.22' });
    expect(trouver(await suggestions(), empreinte)).toBeUndefined();
  });
});

describe('branche « rapprochement » : propositions d’une même règle rejetées avec motif', () => {
  let executionId = '';
  let regle = '';
  let propositions: any[] = [];
  let empreinte = '';
  const decider = async (id: string, decision: string, motif?: string) => expect((await api('remi', 'PATCH', `/v1/rapprochements/${id}`, { decision, ...(motif ? { motif } : {}) })).statut).toBe(200);

  it('le rapprochement est lancé sur les données importées ; la règle la plus productive fournit les propositions', async () => {
    const lance = await api('remi', 'POST', `/v1/exercices/${exercice}/rapprochements`, {});
    expect(lance.statut).toBe(202);
    executionId = lance.json.id;
    const r = await attendre(() => api('remi', 'GET', `/v1/exercices/${exercice}/rapprochements`), (x) => x.json?.execution?.id === executionId && x.json.execution.statut === 'termine');
    const parRegle = new Map<string, any[]>();
    for (const p of r.json.rapprochements as any[]) parRegle.set(p.regle, [...(parRegle.get(p.regle) ?? []), p]);
    const [meilleure, liste] = [...parRegle.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
    expect(liste.length, `la règle « ${meilleure} » doit fournir assez de propositions`).toBeGreaterThanOrEqual(seuilRapprochement + 2);
    regle = meilleure;
    propositions = liste.filter((p: any) => p.statut === 'propose');
    empreinte = `nouvelle_regle_metier|rapprochement|${regle}|${dossier}`;
    empreinteRapprochement = empreinte;
    expect((await suggestions()).json.suggestions.some((x: any) => x.categorie === 'nouvelle_regle_metier' && x.empreinte === empreinte)).toBe(false);
  });

  it(`sous le seuil (${seuilRapprochement}) : quatre rejets motivés et un rejet peu motivé ne suggèrent rien`, async () => {
    for (const p of propositions.slice(0, seuilRapprochement - 1)) await decider(p.id, 'rejeter', MOTIF_RAPPRO);
    await decider(propositions[seuilRapprochement - 1].id, 'rejeter', 'non');
    const r = await suggestions();
    expect(trouver(r, empreinte)).toBeUndefined();
    expect(ponctuelles(r).preuves.decomptes.rapprochementsRejetesIsoles).toBe(seuilRapprochement - 1);
    // Le rejet peu motivé est une décision ; il faut le « remettre en proposition », puis le rejeter avec un vrai motif.
    await decider(propositions[seuilRapprochement - 1].id, 'rejeter', MOTIF_RAPPRO);
  });

  it('seuil atteint : « nouvelle règle métier », signalement à l’éditeur ; preuves = les décisions de la base ; rien n’est créé ni transmis', async () => {
    const r = await suggestions();
    const s = trouver(r, empreinte);
    expect(s).toBeDefined();
    expect(s).toMatchObject({ categorie: 'nouvelle_regle_metier', controleId: null, portee: null, proposable: false, renvoi: 'editeur', parametre: null, proposition: null, dossierIds: [dossier], dejaEcartee: null });
    expect(s.titre).toContain(regle);
    expect(s.critere).toContain(`au moins ${seuilRapprochement} propositions rejetées avec motif`);
    expect(s.preuves.decomptes).toEqual({ rejetsMotives: seuilRapprochement, validations: 0, dossiers: 1 });
    // Preuves comparées à la base : les décisions de rejet motivées, sur des rapprochements de CETTE règle et de CE dossier.
    const enBase = (
      await editeur.query(
        `select d.id, d.cible_id, d.motif, to_char(d.cree_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as date, r.regle, r.entite_id
         from decisions d join rapprochements r on r.id = d.cible_id
         where d.cabinet_id = $1 and d.cible_type = 'rapprochement' and d.action = 'rejeter' and d.motif = $2 order by d.cree_le`,
        [cabinet, MOTIF_RAPPRO],
      )
    ).rows;
    expect(enBase).toHaveLength(seuilRapprochement);
    for (const l of enBase) expect([l.regle, l.entite_id]).toEqual([regle, dossier]);
    expect(s.preuves.decisions.map((d: any) => d.decisionId).sort()).toEqual(enBase.map((l) => l.id).sort());
    expect(s.preuves.decisions.map((d: any) => d.cibleId).sort()).toEqual(enBase.map((l) => l.cible_id).sort());
    for (const d of s.preuves.decisions) {
      expect(d).toMatchObject({ dossierId: dossier, motif: MOTIF_RAPPRO });
      expect(enBase.find((l) => l.id === d.decisionId).date).toBe(d.date);
    }
    // La décision « peu motivée » d'avant a été remplacée par la dernière : seule la dernière décision de chaque rapprochement compte.
    expect(s.neFaitPas.join(' ')).toContain('Ne modifie ni la règle de rapprochement ni aucun rapprochement existant');
    expect(s.neFaitPas.join(' ')).toContain('Ne transmet rien à l’éditeur');
    // Rien n'est créé ni transmis.
    expect((await editeur.query(`select count(*)::int as n from regles_cabinet where cabinet_id = $1`, [cabinet])).rows[0].n).toBe(0);
    // Seule la suggestion d'extraction a été écartée (par une personne, plus haut) : celle-ci ne l'est pas.
    expect((await editeur.query(`select count(*)::int as n from suggestions_ecartees where cabinet_id = $1 and empreinte = $2`, [cabinet, empreinte])).rows[0].n).toBe(0);
    expect((await editeur.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action like 'regle.%'`, [cabinet])).rows[0].n).toBe(0);
    // Les rapprochements eux-mêmes n'ont pas été touchés par la suggestion : seuls ceux décidés ont changé de statut.
    const statuts = (await editeur.query(`select statut, count(*)::int as n from rapprochements where execution_id = $1 group by statut`, [executionId])).rows;
    expect(statuts.find((l) => l.statut === 'rejete')?.n).toBe(seuilRapprochement);
    expect(statuts.find((l) => l.statut === 'valide')).toBeUndefined();
  });

  it('une validation d’une autre proposition de la même règle retire la suggestion ; la remise en proposition la fait revenir', async () => {
    const autre = propositions[seuilRapprochement];
    expect(autre, 'une proposition de plus à valider').toBeDefined();
    await decider(autre.id, 'valider');
    expect(trouver(await suggestions(), empreinte)).toBeUndefined();
    await decider(autre.id, 'remettre_en_proposition');
    const s = trouver(await suggestions(), empreinte);
    expect(s?.preuves.decomptes).toEqual({ rejetsMotives: seuilRapprochement, validations: 0, dossiers: 1 });
  });

  it('un déposant, une collaboratrice : pas de suggestions ; le motif est exigé pour rejeter', async () => {
    expect((await suggestions('chloe')).statut).toBe(403);
    expect((await suggestions('client')).statut).toBe(403);
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${propositions[seuilRapprochement].id}`, { decision: 'rejeter' })).statut).toBe(400);
  });
});

describe('isolation entre cabinets', () => {
  it('les corrections d’un autre cabinet ne s’additionnent jamais : même émetteur, deux pièces corrigées dans le second cabinet → aucune suggestion, et le premier cabinet ne change pas', async () => {
    const avant = trouver(await suggestions(), empreinteRapprochement);
    expect(avant).toBeDefined();
    const sirenE1 = facture(E1, 9201).attendu.emetteurSiren;
    const idsPremier = (await editeur.query(`select document_id from extractions where cabinet_id = $1 and actuelle and methode = 'saisie_humaine'`, [cabinet])).rows.map((l) => l.document_id as string);
    expect(idsPremier.length).toBeGreaterThanOrEqual(4);

    for (const qui of COMPTES) choisirCabinet(qui, cabinet2);
    try {
      const docs: string[] = [];
      for (const n of [9201, 9202]) {
        const p = await deposerFacture('chloe', dossier2, facture(E1, n));
        expect(p.siren).toBe(sirenE1);
        docs.push(p.id);
      }
      for (const id of docs) await corriger(id, { totalTtc: '555.55' });
      // 3 pièces corrigées dans le cabinet 1 + 2 dans le cabinet 2 : si les cabinets se mélangeaient, le décompte serait de 5.
      const r2 = await suggestions();
      expect(r2.statut).toBe(200);
      expect(r2.json.suggestions.filter((x: any) => x.categorie === 'nouvelle_regle_metier')).toEqual([]);
      expect(ponctuelles(r2).preuves.decomptes.champsCorriges).toBe(2);
      const brut2 = JSON.stringify(r2.json);
      for (const interdit of [dossier, cabinet, ...idsPremier, exercice]) expect(brut2).not.toContain(interdit);
      // Les deux suggestions du cabinet 1 ne peuvent pas être écartées depuis le cabinet 2.
      expect((await api('remi', 'POST', '/v1/regles/suggestions/ecarter', { empreinte: `nouvelle_regle_metier|extraction|siren:${sirenE1}|totalTtc`, motif: 'Depuis un autre cabinet' })).statut).toBe(404);
    } finally {
      for (const qui of COMPTES) choisirCabinet(qui, cabinet);
    }
    // Le premier cabinet n'a pas bougé : mêmes preuves, aucune pièce du second.
    const apres = await suggestions();
    const rappro = apres.json.suggestions.find((x: any) => x.empreinte === avant.empreinte);
    expect(rappro.preuves.decisions.map((d: any) => d.decisionId).sort()).toEqual(avant.preuves.decisions.map((d: any) => d.decisionId).sort());
    expect(JSON.stringify(apres.json)).not.toContain(dossier2);
    // Un autre cabinet de démonstration (Bruno) et Alice dans son cabinet de démonstration ne voient rien de ceci.
    const bruno = JSON.stringify((await suggestions('bruno')).json);
    for (const interdit of [dossier, dossier2, SEL, cabinet, cabinet2]) expect(bruno).not.toContain(interdit);
    choisirCabinet('alice', DEMO.cabinetA);
    try {
      const alice = JSON.stringify((await suggestions('alice')).json);
      for (const interdit of [dossier, dossier2, SEL, cabinet, cabinet2]) expect(alice).not.toContain(interdit);
    } finally {
      choisirCabinet('alice', cabinet);
    }
  });
});
