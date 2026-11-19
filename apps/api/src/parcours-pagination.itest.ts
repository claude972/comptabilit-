/**
 * Pagination des rapprochements et des règles du cabinet — pile réelle locale, tests de non-régression.
 * Cabinet NEUF à chaque exécution (opération d'éditeur) : les volumes y sont connus, et rien n'est ajouté aux règles
 * ni aux dossiers du cabinet de démonstration. Les comptes de démonstration y sont rattachés pour la durée du test.
 */
import { randomBytes } from 'node:crypto';
import { analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe'] as const;
const NB_REGLES = 57;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';

/** Parcourt toutes les pages d'une liste paginée et renvoie les éléments dans l'ordre reçu. */
async function toutesLesPages(chemin: (page: number) => string, cle: string, lire: (json: any) => any = (j) => j): Promise<{ elements: any[]; pages: any[] }> {
  const elements: any[] = [];
  const pages: any[] = [];
  for (let page = 1; ; page++) {
    const r = await api('remi', 'GET', chemin(page));
    expect(r.statut).toBe(200);
    const p = lire(r.json);
    pages.push(p);
    elements.push(...r.json[cle]);
    expect(p.page).toBe(page);
    expect(r.json[cle].length).toBeLessThanOrEqual(p.taillePage);
    if (!p.suite) break;
    expect(r.json[cle].length).toBe(p.taillePage); // une page suivie d'une autre est pleine
    expect(page).toBeLessThan(200);
  }
  return { elements, pages };
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai pagination ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Dossier pagination ${SEL} (fictif)`, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration']] as const) {
    await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau });
  }
  exercice = (await api('chloe', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('pagination des règles du cabinet', () => {
  it(`les ${NB_REGLES} règles se parcourent page par page, sans doublon ni oubli, dans un ordre stable`, async () => {
    for (let i = 0; i < NB_REGLES; i++) {
      const r = await api('chloe', 'POST', '/v1/regles', { controleId: 'TIE-001', entiteId: dossier, motif: `Proposition d’essai n° ${i + 1}`, parametres: { seuil: `${i + 1}.00` } });
      expect(r.statut).toBe(201);
    }
    // Deux règles refusées, pour des décomptes par statut non triviaux (une approbation exigerait une mesure d'impact).
    const premieres = (await api('remi', 'GET', '/v1/regles?page=1')).json;
    expect(premieres).toMatchObject({ page: 1, taillePage: 50, total: NB_REGLES, suite: true });
    expect((await api('alice', 'POST', `/v1/regles/${premieres.regles[0].id}/refuser`, { motif: 'Refus d’essai' })).statut).toBeLessThan(300);
    expect((await api('alice', 'POST', `/v1/regles/${premieres.regles[1].id}/refuser`, { motif: 'Refus d’essai' })).statut).toBeLessThan(300);

    const { elements, pages } = await toutesLesPages((p) => `/v1/regles?page=${p}`, 'regles');
    expect(pages).toHaveLength(2);
    expect(elements).toHaveLength(NB_REGLES);
    expect(new Set(elements.map((r) => r.id)).size).toBe(NB_REGLES);
    // Ordre : de la plus récente à la plus ancienne ; les versions décroissent donc strictement.
    expect(elements.map((r) => r.version)).toEqual(Array.from({ length: NB_REGLES }, (_, i) => NB_REGLES - i));
    for (const p of pages) {
      expect(p.total).toBe(NB_REGLES);
      expect(Object.values(p.parStatut as Record<string, number>).reduce((t, n) => t + n, 0)).toBe(NB_REGLES);
      expect(p.parStatut).toEqual({ refusee: 2, proposee: NB_REGLES - 2 });
    }
    expect(elements.every((r) => r.proposeeParNom === 'Chloé Collab')).toBe(true);
    // Rejouer la même page donne la même page.
    expect((await api('remi', 'GET', '/v1/regles?page=2')).json.regles.map((r: any) => r.id)).toEqual(elements.slice(50).map((r) => r.id));
  });

  it('filtres, page au-delà de la fin, paramètres invalides, et ancienne forme conservée', async () => {
    const proposees = await toutesLesPages((p) => `/v1/regles?page=${p}&statut=proposee`, 'regles');
    expect(proposees.elements).toHaveLength(NB_REGLES - 2);
    expect(proposees.elements.every((r) => r.statut === 'proposee')).toBe(true);
    expect(proposees.pages[0].total).toBe(NB_REGLES - 2);
    expect((await api('remi', 'GET', '/v1/regles?page=1&statut=refusee')).json).toMatchObject({ total: 2, suite: false });
    expect((await api('remi', 'GET', '/v1/regles?page=1&statut=approuvee')).json).toMatchObject({ total: 0, regles: [], suite: false });
    expect((await api('remi', 'GET', '/v1/regles?page=1&controleId=TIE-002')).json).toMatchObject({ total: 0, regles: [], suite: false });
    expect((await api('remi', 'GET', '/v1/regles?page=9')).json).toMatchObject({ page: 9, total: NB_REGLES, regles: [], suite: false });
    for (const q of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'page=1&statut=inconnu', 'page=1&controleId=%27%20or%201=1']) {
      expect((await api('remi', 'GET', `/v1/regles?${q}`)).statut, q).toBe(400);
    }
    // Sans « page » : tableau, comme avant (compatibilité).
    const ancienne = await api('remi', 'GET', '/v1/regles');
    expect(Array.isArray(ancienne.json)).toBe(true);
    expect(ancienne.json).toHaveLength(NB_REGLES);
    // Cloisonnement inchangé : un autre cabinet ne voit aucune de ces règles ; un déposant n'y accède pas.
    const autres = (await api('bruno', 'GET', '/v1/regles?page=1')).json;
    expect(autres.regles.some((r: any) => r.cabinetId === cabinet)).toBe(false);
    expect((await api('client', 'GET', '/v1/regles?page=1')).statut).toBe(403);
  });
});

describe('pagination des rapprochements', () => {
  let total = 0;

  it('plus de 200 propositions : toutes les pages se suivent sans doublon ni oubli, et les décomptes portent sur l’ensemble', async () => {
    const graine = Number.parseInt(SEL.slice(0, 6), 16);
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 1500, graine });
    const lignes: LigneFec[] = [];
    await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
    const releve = genererReleveSynthetique({ graine, format: 'camt.053', debut: '2025-01-01', fin: '2025-12-31', nbMouvements: 5000, coherentAvec: lignes });
    const d = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', d.fin.json.lotImportId);
    const r = await deposer('remi', dossier, Buffer.from(releve.contenu), { usage: 'banque' }, releve.nomFichier);
    await attendreLot('remi', r.fin.json.lotImportId);
    const lance = await api('remi', 'POST', `/v1/exercices/${exercice}/rapprochements`, {});
    expect(lance.statut).toBe(202);
    const chemin = (p: number, filtre = '') => `/v1/exercices/${exercice}/rapprochements?page=${p}${filtre}`;
    await attendre(() => api('remi', 'GET', chemin(1)), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 180_000);

    const { elements, pages } = await toutesLesPages((p) => chemin(p), 'rapprochements', (j) => j.pagination);
    total = pages[0].total;
    expect(total, 'le jeu doit dépasser une page').toBeGreaterThan(200);
    expect(pages[0].taillePage).toBe(200);
    expect(pages.length).toBe(Math.ceil(total / 200));
    expect(elements).toHaveLength(total);
    expect(new Set(elements.map((x) => x.id)).size).toBe(total);
    // Ordre stable : niveau, règle, date de création, identifiant.
    const cle = (x: any) => [x.niveau, x.regle, x.creeLe, x.id];
    for (let i = 1; i < elements.length; i++) expect(JSON.stringify(cle(elements[i - 1])) <= JSON.stringify(cle(elements[i])), `rang ${i}`).toBe(true);
    // Décomptes identiques sur chaque page, calculés sur TOUTES les propositions.
    const parRegle = new Map<string, number>();
    for (const x of elements) parRegle.set(x.regle, (parRegle.get(x.regle) ?? 0) + 1);
    for (const p of pages) {
      expect(p.total).toBe(total);
      expect(p.parStatut).toEqual({ propose: total });
      expect(Object.fromEntries(p.parRegle.map((x: any) => [x.regle, x.n]))).toEqual(Object.fromEntries(parRegle));
    }
    // Chaque page porte les écritures et mouvements dont elle a besoin pour être lue seule.
    const page2 = (await api('remi', 'GET', chemin(2))).json;
    for (const x of page2.rapprochements) {
      for (const id of x.cotesEcritures) expect(page2.ecritures[id], 'écriture d’une proposition de la page 2').toBeTruthy();
      for (const id of x.cotesMouvements) expect(page2.mouvements[id], 'mouvement d’une proposition de la page 2').toBeTruthy();
    }
    // Sans « page » : première page, comme avant pour les petits volumes.
    const defaut = (await api('remi', 'GET', `/v1/exercices/${exercice}/rapprochements`)).json;
    expect(defaut.rapprochements.map((x: any) => x.id)).toEqual(elements.slice(0, 200).map((x) => x.id));
    expect(defaut.pagination).toMatchObject({ page: 1, suite: true, total });
  }, 300_000);

  it('une décision ne déplace aucune proposition d’une page à l’autre ; filtre par statut ; paramètres invalides', async () => {
    const chemin = (p: number, filtre = '') => `/v1/exercices/${exercice}/rapprochements?page=${p}${filtre}`;
    const avant = await toutesLesPages((p) => chemin(p), 'rapprochements', (j) => j.pagination);
    const [a, b] = [avant.elements[3], avant.elements[205]];
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${a.id}`, { decision: 'valider' })).statut).toBeLessThan(300);
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${b.id}`, { decision: 'rejeter', motif: 'Rejet d’essai' })).statut).toBeLessThan(300);
    const apres = await toutesLesPages((p) => chemin(p), 'rapprochements', (j) => j.pagination);
    expect(apres.elements.map((x) => x.id)).toEqual(avant.elements.map((x) => x.id));
    expect(apres.pages[0].parStatut).toEqual({ propose: total - 2, valide: 1, rejete: 1 });
    const valides = (await api('remi', 'GET', chemin(1, '&statut=valide'))).json;
    expect(valides.rapprochements.map((x: any) => x.id)).toEqual([a.id]);
    expect(valides.pagination).toMatchObject({ total: 1, suite: false, parStatut: { propose: total - 2, valide: 1, rejete: 1 } });
    const proposes = await toutesLesPages((p) => chemin(p, '&statut=propose'), 'rapprochements', (j) => j.pagination);
    expect(proposes.elements).toHaveLength(total - 2);
    expect(proposes.elements.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
    expect((await api('remi', 'GET', chemin(99))).json).toMatchObject({ rapprochements: [], pagination: { page: 99, total, suite: false } });
    for (const q of ['page=0', 'page=abc', 'page=1&statut=inconnu']) expect((await api('remi', 'GET', `/v1/exercices/${exercice}/rapprochements?${q}`)).statut, q).toBe(400);
    expect((await api('bruno', 'GET', chemin(1))).statut).toBe(404);
  }, 120_000);
});
