/**
 * Amélioration contrôlée : SUGGESTIONS de règles tirées des corrections — pile réelle locale.
 * Cabinet NEUF à chaque exécution, un dossier, trois exercices (une anomalie « client créditeur » et une « caisse
 * créditrice » injectées dans chacun) : les rejets motivés répétés d'un même contrôle dans le même dossier fondent
 * une suggestion ; rien n'est activé sans une personne, une mesure d'impact, et l'approbation d'une AUTRE personne.
 */
import { randomBytes } from 'node:crypto';
import { CRITERES_AMELIORATION, genererFecSynthetique } from '@comtaple/core';
import { creerAccesBd, sql, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const NOM = `Suggestions ${SEL} SARL (fictif)`;
const ANNEES = [2023, 2024, 2025];
const MOTIF = `Avance client prévue au contrat, sans enjeu (${SEL})`;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
const exercices: string[] = [];
let tie: any[] = [];
let tre: any[] = [];
let regleId = '';
const EMPREINTE = () => `exception_dossier|TIE-001|${dossier}`;

const suggestions = (qui: string) => api(qui, 'GET', '/v1/regles/suggestions');
const rejeter = async (constat: any, motif = MOTIF) => expect((await api('remi', 'PATCH', `/v1/constats/${constat.id}`, { action: 'rejeter', motif })).statut).toBe(200);
const centimes = (v: string) => BigInt(v.replace('.', ''));
async function relancer(exerciceId: string) {
  const lance = await api('remi', 'POST', `/v1/exercices/${exerciceId}/controles`);
  const r = await attendre(() => api('remi', 'GET', `/v1/exercices/${exerciceId}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 120_000);
  return r.json.resultats.find((x: any) => x.controleId === 'TIE-001');
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai suggestions ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '30 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: NOM, territoireFiscal: 'metropole', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const graine = Number.parseInt(SEL.slice(0, 6), 16);
  for (const [i, annee] of ANNEES.entries()) {
    const ex = { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
    const id = (await api('remi', 'POST', `/v1/dossiers/${dossier}/exercices`, ex)).json.id as string;
    exercices.push(id);
    const fec = genererFecSynthetique({ exercice: ex, nbEcritures: 120, graine: graine + i * 17, anomalies: ['client_crediteur', 'caisse_crediteur'] });
    const d = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: id, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', d.fin.json.lotImportId);
    const revue = await attendre(() => api('remi', 'GET', `/v1/exercices/${id}/revue`), (x) => x.json?.execution?.statut === 'termine' || x.json?.execution === null, 120_000);
    if (revue.json.execution === null) await relancer(id);
    const constats = (await api('remi', 'GET', `/v1/exercices/${id}/revue`)).json.constats as any[];
    tie.push(...constats.filter((k) => k.controleId === 'TIE-001'));
    tre.push(...constats.filter((k) => k.controleId === 'TRE-001'));
  }
}, 420_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('suggestions tirées des décisions de revue', () => {
  it('cabinet sans décision : aucune suggestion, critères versionnés déclarés non validés ; accès réservé aux réviseurs, associés, administrateurs', async () => {
    expect(tie.length, 'un constat « client créditeur » par exercice au moins').toBeGreaterThanOrEqual(3);
    expect(tre.length, 'un constat « caisse créditrice » par exercice au moins').toBeGreaterThanOrEqual(3);
    const r = await suggestions('remi');
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ suggestions: [], sansDecision: true, ecarteesMaintenues: [], dejaEnCours: [], criteres: { version: CRITERES_AMELIORATION.version } });
    expect(r.json.criteres.statut).toContain('non validées');
    expect(r.json.perimetre).toMatchObject({ dossiers: 1, fenetreMois: 24, plafondsAtteints: [] });
    expect((await suggestions('alice')).statut).toBe(200);
    expect((await suggestions('chloe')).statut).toBe(403);
    expect((await suggestions('client')).statut).toBe(403);
    expect((await suggestions('')).statut).toBe(401);
  });

  it('récurrence non atteinte : deux rejets motivés (et un rejet trop peu motivé) restent des corrections ponctuelles', async () => {
    await rejeter(tie[0]);
    await rejeter(tie[1]);
    await rejeter(tie[2], 'non');
    const r = (await suggestions('remi')).json;
    expect(r.sansDecision).toBe(false);
    expect(r.suggestions.map((x: any) => x.categorie)).toEqual(['correction_donnee']);
    expect(r.suggestions[0]).toMatchObject({ proposable: false, proposition: null, parametre: null, preuves: { decomptes: { rejetsIsoles: 2 } } });
  });

  it('récurrence atteinte : exception de dossier suggérée, avec ses preuves, le paramètre concerné et ce qu’elle ne fait pas — rien n’est créé', async () => {
    // La même anomalie, de nouveau rejetée avec un vrai motif : seule la dernière décision compte.
    for (const k of tie.slice(2)) await rejeter(k);
    const r = (await suggestions('remi')).json;
    const s = r.suggestions.find((x: any) => x.empreinte === EMPREINTE());
    expect(s).toMatchObject({ categorie: 'exception_dossier', controleId: 'TIE-001', portee: 'dossier', proposable: true, renvoi: null, dossierIds: [dossier], dossiers: [{ id: dossier, nom: NOM }], dejaEcartee: null });
    expect(s.preuves.decomptes).toEqual({ rejetsMotives: tie.length, rejetsNonMotives: 0, decisionsContraires: 0, executions: exercices.length, dossiers: 1 });
    // Preuves : ce sont les vraies décisions de la base, sur les vrais constats, avec leur motif.
    const enBase = (await editeur.query(`select id, cible_id, motif from decisions where cabinet_id = $1 and cible_type = 'constat' and action = 'rejeter' and motif = $2`, [cabinet, MOTIF])).rows;
    expect(enBase).toHaveLength(tie.length);
    expect(s.preuves.decisions.map((d: any) => d.decisionId).sort()).toEqual(enBase.map((d) => d.id).sort());
    expect(s.preuves.decisions.map((d: any) => d.cibleId).sort()).toEqual(tie.map((k) => k.id).sort());
    for (const d of s.preuves.decisions) expect(d).toMatchObject({ dossierId: dossier, motif: MOTIF });
    expect(s.preuves.periode.du <= s.preuves.periode.au).toBe(true);
    // Paramètre : le plus grand montant rejeté, en chaîne décimale.
    const max = tie.map((k) => centimes(k.montant)).reduce((a, b) => (b > a ? b : a));
    expect(s.parametre).toMatchObject({ cle: 'seuil', valeurParDefaut: '0.00' });
    expect(typeof s.parametre.valeurIndicative).toBe('string');
    expect(centimes(s.parametre.valeurIndicative)).toBe(max);
    expect(s.proposition).toMatchObject({ controleId: 'TIE-001', entiteId: dossier, parametres: { seuil: s.parametre.valeurIndicative } });
    expect(s.critere).toContain(`v${CRITERES_AMELIORATION.version}`);
    expect(s.neFaitPas.join(' ')).toMatch(/N’active rien/);
    // Lire une suggestion ne crée ni règle ni décision, et ne change aucun résultat de contrôle.
    expect((await editeur.query('select count(*)::int as n from regles_cabinet where cabinet_id = $1', [cabinet])).rows[0].n).toBe(0);
    expect((await editeur.query('select count(*)::int as n from suggestions_ecartees where cabinet_id = $1', [cabinet])).rows[0].n).toBe(0);
    expect((await api('remi', 'GET', `/v1/exercices/${exercices[2]}/revue`)).json.resultats.find((x: any) => x.controleId === 'TIE-001')).toMatchObject({ statut: 'constat', parametres: { seuil: '0.00' } });
  });

  it('une décision contraire dans le dossier retire la suggestion ; la réouverture la fait revenir', async () => {
    expect((await api('remi', 'PATCH', `/v1/constats/${tie[0].id}`, { action: 'confirmer_anomalie', motif: 'Finalement une vraie anomalie à régulariser' })).statut).toBe(200);
    expect((await suggestions('remi')).json.suggestions.some((x: any) => x.empreinte === EMPREINTE())).toBe(false);
    await rejeter(tie[0]);
    expect((await suggestions('remi')).json.suggestions.some((x: any) => x.empreinte === EMPREINTE())).toBe(true);
  });

  it('contrôle à fondement réglementaire (caisse créditrice) : jamais de règle de cabinet, renvoi vers la veille', async () => {
    for (const k of tre) await rejeter(k, `Erreur de saisie de date en caisse, corrigée depuis (${SEL})`);
    const r = (await suggestions('remi')).json;
    const s = r.suggestions.find((x: any) => x.controleId === 'TRE-001');
    expect(s).toMatchObject({ empreinte: 'modification_regle_reglementaire|TRE-001', categorie: 'modification_regle_reglementaire', proposable: false, renvoi: 'veille', proposition: null, parametre: null });
    expect(s.neFaitPas[0]).toContain('Ne propose AUCUNE règle de cabinet');
    // Et l'API des règles la refuserait de toute façon.
    expect((await api('remi', 'POST', '/v1/regles', { controleId: 'TRE-001', entiteId: dossier, parametres: { seuil: '50.00' }, motif: 'Essai de contournement' })).statut).toBe(409);
    expect(r.suggestions.filter((x: any) => x.proposable).map((x: any) => x.controleId)).toEqual(['TIE-001']);
  });
});

describe('écarter une suggestion', () => {
  it('motif exigé, rôle habilité, suggestion en cours seulement ; la décision est conservée et la suggestion n’est plus reproposée à l’identique', async () => {
    const url = '/v1/regles/suggestions/ecarter';
    const empreinte = 'modification_regle_reglementaire|TRE-001';
    expect((await api('chloe', 'POST', url, { empreinte, motif: 'Sans objet pour nous' })).statut).toBe(403);
    expect((await api('client', 'POST', url, { empreinte, motif: 'Sans objet pour nous' })).statut).toBe(403);
    expect((await api('remi', 'POST', url, { empreinte, motif: 'non' })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { empreinte })).statut).toBe(400);
    expect((await api('remi', 'POST', url, { empreinte: `exception_dossier|TIE-001|${DEMO.dupain}`, motif: 'Empreinte forgée' })).statut).toBe(404);
    expect((await api('remi', 'POST', url, { empreinte: 'correction_donnee', motif: 'Ne s’écarte pas' })).statut).toBe(404);
    const ok = await api('remi', 'POST', url, { empreinte, motif: 'Erreurs de saisie isolées, pas un sujet de règle' });
    expect(ok.statut).toBe(201);
    expect(ok.json).toMatchObject({ empreinte, categorie: 'modification_regle_reglementaire', controleId: 'TRE-001', entiteId: null, ecarteePar: DEMO.remi, versionCriteres: CRITERES_AMELIORATION.version, decomptes: { rejetsMotives: tre.length } });
    const r = (await suggestions('alice')).json;
    expect(r.suggestions.some((x: any) => x.empreinte === empreinte)).toBe(false);
    expect(r.ecarteesMaintenues).toEqual([expect.objectContaining({ empreinte, motif: 'Erreurs de saisie isolées, pas un sujet de règle' })]);
    expect((await api('remi', 'POST', url, { empreinte, motif: 'Une seconde fois' })).statut).toBe(404);
    const journal = (await editeur.query(`select details from journal_audit where cabinet_id = $1 and action = 'suggestion.ecartee'`, [cabinet])).rows;
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toMatchObject({ categorie: 'modification_regle_reglementaire', controleId: 'TRE-001' });
    // Ajout seul, et réservé aux rôles habilités dans la base elle-même.
    const app = creerAccesBd(urlBd('app'), { max: 1 });
    try {
      await expect(app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.remi }, (tx) => tx.execute(sql`delete from suggestions_ecartees`))).rejects.toThrow();
      await expect(app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.remi }, (tx) => tx.execute(sql`update suggestions_ecartees set motif = 'réécrit'`))).rejects.toThrow();
      const inserer = (utilisateurId: string, auteur: string) =>
        app.avecContexte({ cabinetId: cabinet, utilisateurId }, (tx) =>
          tx.execute(sql`insert into suggestions_ecartees (cabinet_id, empreinte, categorie, version_criteres, decomptes, motif, ecartee_par) values (${cabinet}::uuid, 'x', 'exception_dossier', '1.0.0', '{}'::jsonb, 'Insertion directe', ${auteur}::uuid)`),
        );
      await expect(inserer(DEMO.chloe, DEMO.chloe)).rejects.toThrow(); // collaboratrice : rôle non habilité
      await expect(inserer(DEMO.remi, DEMO.alice)).rejects.toThrow(); // au nom de quelqu'un d'autre
    } finally {
      await app.fermer();
    }
  });
});

describe('de la suggestion à la règle : une personne propose, l’impact est mesuré, une AUTRE personne approuve, et c’est réversible', () => {
  it('« proposer cette règle » : la proposition pré-remplie passe par le circuit existant et n’a aucun effet tant qu’elle n’est pas approuvée', async () => {
    const s = (await suggestions('remi')).json.suggestions.find((x: any) => x.empreinte === EMPREINTE());
    const p = await api('remi', 'POST', '/v1/regles', s.proposition);
    expect(p.statut).toBe(201);
    expect(p.json).toMatchObject({ statut: 'proposee', version: 1, entiteId: dossier, controleId: 'TIE-001', proposeePar: DEMO.remi, impact: null, parametres: { seuil: s.parametre.valeurIndicative } });
    regleId = p.json.id;
    // La suggestion n'est plus proposée (règle en cours pour la même cible), et le contrôle n'a pas changé.
    const apres = (await suggestions('remi')).json;
    expect(apres.suggestions.some((x: any) => x.empreinte === EMPREINTE())).toBe(false);
    expect(apres.dejaEnCours).toEqual([EMPREINTE()]);
    expect(await relancer(exercices[2]!)).toMatchObject({ statut: 'constat', parametres: { seuil: '0.00' } });
  });

  it('impact mesuré avant activation ; approbation refusée à l’auteur et à un non-gestionnaire, accordée par une autre personne', async () => {
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(409); // impact non mesuré
    const impact = await api('remi', 'POST', `/v1/regles/${regleId}/impact`, { exerciceId: exercices[2] });
    expect(impact.statut).toBe(200);
    expect(impact.json.avant).toMatchObject({ statut: 'constat' });
    expect(impact.json.avant.constats).toBeGreaterThanOrEqual(1);
    expect(impact.json.apres).toMatchObject({ statut: 'sans_anomalie', constats: 0 });
    expect(impact.json.constatsQuiDisparaissent).toBe(impact.json.avant.constats);
    expect((await api('remi', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403); // l'auteur, et non gestionnaire
    expect((await api('chloe', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403);
    const ok = await api('alice', 'POST', `/v1/regles/${regleId}/approuver`);
    expect(ok.json).toMatchObject({ statut: 'approuvee', approuveePar: DEMO.alice, proposeePar: DEMO.remi });
  });

  it('effet vérifié, puis retrait : retour aux paramètres par défaut ; la suggestion ne revient pas d’elle-même', async () => {
    const avec = await relancer(exercices[2]!);
    expect(avec.statut).toBe('sans_anomalie');
    expect(avec.source.regleCabinet).toMatchObject({ regleId, version: 1, portee: 'dossier' });
    expect((await suggestions('remi')).json.dejaEnCours).toEqual([EMPREINTE()]);
    expect((await api('remi', 'POST', `/v1/regles/${regleId}/retirer`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/retirer`)).json.statut).toBe('retiree');
    const sans = await relancer(exercices[2]!);
    expect(sans).toMatchObject({ statut: 'constat', parametres: { seuil: '0.00' } });
    expect(sans.source.regleCabinet).toBeNull();
    // Le cabinet a déjà tranché (règle retirée) : la suggestion reste écartée tant que de nouveaux rejets ne s'accumulent pas.
    const r = (await suggestions('remi')).json;
    expect(r.suggestions.some((x: any) => x.empreinte === EMPREINTE())).toBe(false);
    expect(r.dejaEnCours).toEqual([]);
    expect(r.ecarteesMaintenues.find((x: any) => x.empreinte === EMPREINTE())).toMatchObject({ motif: 'Règle retirée' });
    const actions = (await editeur.query(`select action from journal_audit where cabinet_id = $1 and cible_id = $2`, [cabinet, regleId])).rows.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['regle.proposee', 'regle.impact_mesure', 'regle.approuvee', 'regle.retiree']));
  });
});

describe('cloisonnement entre cabinets', () => {
  it('un autre cabinet ne voit ni les suggestions, ni les décisions écartées, ni les preuves de celui-ci', async () => {
    const bruno = await suggestions('bruno');
    expect(bruno.statut).toBe(200);
    const brut = JSON.stringify(bruno.json);
    for (const interdit of [dossier, SEL, cabinet, ...tie.map((k) => k.id)]) expect(brut).not.toContain(interdit);
    // Alice, dans son AUTRE cabinet (cabinet A de démonstration), ne voit rien de ce cabinet-ci non plus.
    choisirCabinet('alice', DEMO.cabinetA);
    try {
      const ailleurs = JSON.stringify((await suggestions('alice')).json);
      for (const interdit of [dossier, SEL, cabinet]) expect(ailleurs).not.toContain(interdit);
      expect((await api('alice', 'POST', '/v1/regles/suggestions/ecarter', { empreinte: EMPREINTE(), motif: 'Depuis un autre cabinet' })).statut).toBe(404);
    } finally {
      choisirCabinet('alice', cabinet);
    }
    // Dans la base elle-même, sous l'identité d'un membre d'un autre cabinet : aucune ligne de ce cabinet.
    const app = creerAccesBd(urlBd('app'), { max: 1 });
    try {
      const vues = await app.avecContexte({ cabinetId: DEMO.cabinetB, utilisateurId: DEMO.bruno }, async (tx) => (await tx.execute(sql`select id from suggestions_ecartees where cabinet_id = ${cabinet}::uuid`)).rows);
      expect(vues).toEqual([]);
      const decisions = await app.avecContexte({ cabinetId: DEMO.cabinetB, utilisateurId: DEMO.bruno }, async (tx) => (await tx.execute(sql`select id from decisions where cabinet_id = ${cabinet}::uuid`)).rows);
      expect(decisions).toEqual([]);
    } finally {
      await app.fermer();
    }
  });
});
