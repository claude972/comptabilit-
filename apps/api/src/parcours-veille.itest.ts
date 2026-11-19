/** Veille réglementaire par dossier — pile réelle locale. Les évolutions d'essai sont créées et qualifiées par l'éditeur (provisionnement). */
import { randomBytes } from 'node:crypto';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { qualifierEvolution } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { genererFecSynthetique } from '@comtaple/core';
import { api, attendreLot, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
let editeur: pg.Client;
let evMetropole = '';
let evBrute = '';
let evTaille = '';

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  const creer = async (ref: string) => (await editeur.query<{ id: string }>(`insert into evolutions_reglementaires (emetteur, reference, url) values ('Légifrance', $1, $2) returning id`, [ref, `https://www.legifrance.gouv.fr/essai/${SEL}`])).rows[0]!.id;
  evMetropole = await creer(`Essai ${SEL} — à qualifier`);
  evBrute = await creer(`Essai ${SEL} — détection non qualifiée`);
  await qualifierEvolution(editeur, evMetropole, {
    reference: `Texte d'essai ${SEL} (fictif)`,
    resume: 'Évolution fictive servant au test : modification d’un seuil pour les sociétés à l’IS en métropole.',
    dateEffet: '2025-01-01',
    conditions: 'Exercices ouverts à compter du 1er janvier 2025.',
    criteres: { territoires: ['metropole'], regimesFiscaux: ['IS'], exercicesOuvertsAPartirDu: '2025-01-01' },
    dateVerification: new Date().toISOString().slice(0, 10),
  });
  evTaille = await creer(`Essai ${SEL} — taille et opérations`);
  await qualifierEvolution(editeur, evTaille, {
    reference: `Texte d'essai ${SEL} sur les seuils (fictif)`,
    resume: 'Évolution fictive servant au test : obligation visant les sociétés employant au moins onze salariés et réalisant un chiffre d’affaires.',
    criteres: { taille: { effectifMin: 11, chiffreAffairesMin: '1.00' }, operations: ['salaries', 'credit_bail'] },
    dateVerification: new Date().toISOString().slice(0, 10),
  });
});
afterAll(async () => {
  await editeur.query('delete from suivis_evolution where evolution_id = any($1)', [[evMetropole, evBrute, evTaille]]);
  await editeur.query('delete from evolutions_reglementaires where id = any($1)', [[evMetropole, evBrute, evTaille]]);
  await editeur.end();
});

describe('veille par dossier', () => {
  it('seules les évolutions qualifiées par une personne sont présentées, avec l’explication de leur applicabilité', async () => {
    const dupain = (await api('remi', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).json;
    expect(dupain.find((e: any) => e.id === evBrute)).toBeUndefined(); // détection brute : jamais montrée comme une évolution
    const e = dupain.find((x: any) => x.id === evMetropole);
    expect(e.applicabilite.statut).toBe('concerne');
    expect(e.applicabilite.exercicesConcernes).toEqual([{ debut: '2025-01-01', fin: '2025-12-31' }]);
    expect(e.applicabilite.raisons.join(' ')).toMatch(/Territoire fiscal du dossier \(metropole\) visé/);
    expect(e.resume).toMatch(/fictive/);
    expect(e.suivi).toBeNull();
    // Dossier d'outre-mer : non concerné, avec la raison.
    const bellevue = (await api('remi', 'GET', `/v1/dossiers/${DEMO.bellevue}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(bellevue.applicabilite.statut).toBe('non_concerne');
    expect(bellevue.applicabilite.raisons.join(' ')).toMatch(/martinique/);
  });

  it('une caractéristique manquante donne « applicabilité à confirmer »', async () => {
    const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai veille ${SEL} (fictif)`, territoireFiscal: 'a_confirmer' });
    await api('alice', 'PUT', `/v1/dossiers/${d.json.id}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    const e = (await api('alice', 'GET', `/v1/dossiers/${d.json.id}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(e.applicabilite.statut).toBe('a_confirmer');
    expect(e.applicabilite.manquants).toEqual(expect.arrayContaining(['Territoire fiscal', 'Régime fiscal', 'Exercices']));
  });

  it('taille et opérations : « à confirmer » sans données ni effectif, puis tranché d’après la comptabilité importée et l’effectif saisi', async () => {
    const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai veille taille ${SEL} (fictif)`, territoireFiscal: 'metropole' });
    const dossier = d.json.id;
    await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    const lire = async () => (await api('alice', 'GET', `/v1/dossiers/${dossier}/veille`)).json.find((x: any) => x.id === evTaille).applicabilite;
    // 1) Rien n'est connu : ni effectif, ni comptabilité.
    const vide = await lire();
    expect(vide.statut).toBe('a_confirmer');
    expect(vide.manquants).toEqual(expect.arrayContaining(['Chiffre d’affaires', 'Effectif', 'Données comptables']));
    // 2) Comptabilité importée (le jeu synthétique a des ventes et des salaires) : seul l'effectif manque encore.
    const exercice = (await api('alice', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 150, graine: Number.parseInt(SEL.slice(0, 6), 16) });
    const depot = await deposer('alice', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('alice', depot.fin.json.lotImportId);
    const avecCompta = await lire();
    expect(avecCompta.statut).toBe('a_confirmer');
    expect(avecCompta.manquants).toEqual(['Effectif']);
    expect(avecCompta.raisons.join(' ')).toMatch(/Chiffre d’affaires du dossier \(\d+\.\d{2} €\) dans la tranche visée/);
    expect(avecCompta.raisons.join(' ')).toMatch(/rémunérations du personnel \(compte 641\)/);
    expect(avecCompta.raisons.join(' ')).toContain('avant écritures d’inventaire');
    // 3) Effectif saisi sur la fiche : sous le seuil → non concerné ; au seuil → concerné ; effacé → de nouveau à confirmer.
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { effectifMoyen: -1 })).statut).toBe(400);
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { effectifMoyen: 10 })).statut).toBe(200);
    expect((await lire()).statut).toBe('non_concerne');
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { effectifMoyen: 11 })).statut).toBe(200);
    expect((await lire()).statut).toBe('concerne');
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { effectifMoyen: null })).statut).toBe(200);
    expect((await lire()).statut).toBe('a_confirmer');
    // Un collaborateur non gestionnaire ne modifie pas la fiche.
    expect((await api('chloe', 'PATCH', `/v1/dossiers/${dossier}`, { effectifMoyen: 500 })).statut).toBeGreaterThanOrEqual(403);
  }, 120_000);

  it('le suivi est propre au dossier et au cabinet ; il ne modifie aucune règle', async () => {
    expect((await api('client', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).statut).toBe(404);
    expect((await api('chloe', 'PUT', `/v1/dossiers/${DEMO.dupain}/veille/${evBrute}`, { statut: 'pris_en_compte' })).statut).toBe(404);
    const s = await api('chloe', 'PUT', `/v1/dossiers/${DEMO.dupain}/veille/${evMetropole}`, { statut: 'pris_en_compte', note: 'Vu avec le réviseur' });
    expect(s.json).toMatchObject({ statut: 'pris_en_compte', entiteId: DEMO.dupain });
    expect((await api('remi', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).json.find((x: any) => x.id === evMetropole).suivi.statut).toBe('pris_en_compte');
    // Le cabinet Bêta voit la même évolution (référentiel partagé) mais pas le suivi du cabinet Alpha.
    const leroy = (await api('bruno', 'GET', `/v1/dossiers/${DEMO.leroy}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(leroy.suivi).toBeNull();
    // Le catalogue des contrôles est inchangé par l'existence d'une évolution.
    const tva = (await api('remi', 'GET', '/v1/reference/controles')).json.find((c: any) => c.id === 'IMM-002');
    expect(tva.parametresParDefaut.seuil).toBe('500.00');
  });

  it('l’état des sources est visible, et une source jamais vérifiée n’est pas présentée comme assurée', async () => {
    const r = await api('remi', 'GET', '/v1/veille/sources');
    expect(r.json.sources.length).toBeGreaterThanOrEqual(4);
    expect(r.json.evolutionsDetecteesNonQualifiees).toBeGreaterThanOrEqual(1);
    for (const src of r.json.sources) {
      if (src.dernierSuccesLe === null) expect(src.veilleAssuree).toBe(false);
      expect(src).not.toHaveProperty('empreinteContenu');
    }
    expect((await api('client', 'GET', '/v1/veille/sources')).statut).toBe(403);
    // L'application ne peut pas écrire le référentiel partagé.
    const app = new pg.Client({ connectionString: urlBd('app') });
    await app.connect();
    await expect(app.query(`update evolutions_reglementaires set resume = 'x'`)).rejects.toThrow(/permission|droit/i);
    await app.end();
  });
});

describe('recherche documentaire autorisée', () => {
  it('cherche dans les pièces, les écritures et les constats du dossier, en citant la source, sans rien renvoyer hors habilitation', async () => {
    const r = await api('remi', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=${encodeURIComponent('facture')}`);
    expect(r.statut).toBe(200);
    expect(r.json.pieces.length).toBeGreaterThan(0);
    expect(r.json.pieces[0]).toMatchObject({ documentId: expect.any(String), page: expect.any(Number) });
    expect(r.json.pieces[0].extrait).toMatch(/«[^»]+»/); // terme surligné par des guillemets, jamais par du HTML
    // Forme structurée, sans ambiguïté avec les guillemets d'une pièce : segments de texte, le terme trouvé marqué.
    const segments = r.json.pieces[0].segments;
    expect(segments.some((x: any) => x.trouve && /factur/i.test(x.texte))).toBe(true);
    expect(segments.map((x: any) => x.texte).join('')).toBe(r.json.pieces[0].extrait.replace(/[«»]/g, ''));
    expect(JSON.stringify(r.json)).not.toMatch(/[\uE000\uE001]/);
    expect(JSON.stringify(r.json)).not.toMatch(/<b>|<\/b>/);
    const ecr = await api('remi', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=${encodeURIComponent('banque OR vente OR achat')}`);
    expect(ecr.json.ecritures.length).toBeGreaterThan(0);
    expect(ecr.json.ecritures.every((e: any) => typeof e.debit === 'string')).toBe(true);
    // Le déposant ne cherche que dans ses propres dépôts, et jamais dans la comptabilité.
    const client = await api('client', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=${encodeURIComponent('banque OR vente OR achat OR facture')}`);
    expect(client.json.ecritures).toEqual([]);
    expect(client.json.constats).toEqual([]);
    expect(client.json.pieces.length).toBeLessThanOrEqual(r.json.pieces.length + 30);
    // Hors habilitation : rien, pas même l'existence du dossier.
    expect((await api('alice', 'GET', `/v1/recherche?entiteId=${DEMO.martin}&q=facture`)).statut).toBe(404);
    expect((await api('bruno', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=facture`)).statut).toBe(404);
    expect((await api('remi', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=a`)).statut).toBe(400);
    // Une requête hostile est une donnée : pas d'injection SQL, pas d'erreur serveur.
    const hostile = await api('remi', 'GET', `/v1/recherche?entiteId=${DEMO.dupain}&q=${encodeURIComponent("'); drop table documents; --")}`);
    expect(hostile.statut).toBe(200);
    expect((await api('remi', 'GET', `/v1/documents?entiteId=${DEMO.dupain}`)).statut).toBe(200);
  });
});
