/**
 * Recherche textuelle sur le PORTEFEUILLE de dossiers autorisés (`GET v1/recherche?q=…`, sans `entiteId`) — pile réelle
 * locale (Keycloak, API, worker, PostgreSQL, S3). Cabinet NEUF à chaque exécution :
 *   A — comptabilité, constats et une pièce ; B — comptabilité et une pièce ; C — mêmes données, AUCUNE habilitation pour
 *   Rémi ni Chloé ; D — habilité, sans donnée ; E — habilité, une pièce qui ne contient pas le mot cherché ;
 *   huit dossiers de plus (Alice seule) pour dépasser la taille d'une page.
 * Les mêmes mots sont présents dans plusieurs dossiers : chaque résultat doit être rattaché au BON dossier (vérifié dans
 * la base), et le dossier non habilité ne doit être ni interrogé ni nommé.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { type AccesBd, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import { ServiceUnavailableException } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Acces } from './acces.js';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';
import { DELAI_MAX_RECHERCHE_MS, DOSSIERS_PAR_PAGE, MAX_CONSTATS_PAR_DOSSIER, MAX_ECRITURES_PAR_DOSSIER, MAX_PIECES_PAR_DOSSIER, rechercherPortefeuille } from './recherche-portefeuille.service.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const MOT = `brimborion${SEL}`;
const SECRET = `confidentiel${SEL}`;
const AUTRE = `ailleurs${SEL}`;
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
const NOMS = { a: `Recherche ${SEL} Alpha SARL`, b: `Recherche ${SEL} Bravo SAS`, c: `Recherche ${SEL} Charlie SA`, d: `Recherche ${SEL} Delta EURL`, e: `Recherche ${SEL} Echo SCI` };
let editeur: pg.Client;
let cabinet = '';
const dossier = { a: '', b: '', c: '', d: '', e: '' };
const exercice = { a: '', b: '', c: '' };
const piece = { a: '', b: '', c: '', e: '' };
let plus: Array<{ id: string; nom: string }> = [];

const chercher = (qui: string, q: string, extra = '') => api(qui, 'GET', `/v1/recherche?q=${encodeURIComponent(q)}${extra}`);
const habiliter = async (cle: keyof typeof dossier, utilisateur: string, niveau: string) => expect((await api('alice', 'PUT', `/v1/dossiers/${dossier[cle]}/habilitations/${utilisateur}`, { niveau })).statut).toBeLessThan(300);
const idsDossiers = (r: any): string[] => r.json.dossiers.map((d: any) => d.id);

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai recherche ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '30 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  for (const cle of ['a', 'b', 'c', 'd', 'e'] as const) {
    dossier[cle] = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: NOMS[cle], territoireFiscal: 'metropole' })).json.id;
    await habiliter(cle, DEMO.alice, 'validation');
    await habiliter(cle, DEMO.client, 'depot');
  }
  for (const u of [DEMO.remi, DEMO.chloe]) {
    await habiliter('a', u, 'collaboration');
    await habiliter('b', u, 'lecture');
    await habiliter('d', u, 'collaboration');
    await habiliter('e', u, 'collaboration');
  }
  const graine = Number.parseInt(SEL.slice(0, 6), 16);
  const importer = async (id: string, g: number, anomalies: string[], nb = 120) => {
    const ex = (await api('alice', 'POST', `/v1/dossiers/${id}/exercices`, EX)).json.id as string;
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: nb, graine: g, anomalies: anomalies as never });
    const d = await deposer('alice', id, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('alice', d.fin.json.lotImportId);
    return ex;
  };
  exercice.a = await importer(dossier.a, graine, ['client_crediteur']);
  exercice.b = await importer(dossier.b, graine + 1, []);
  exercice.c = await importer(dossier.c, graine + 2, ['client_crediteur']);
  for (const cle of ['a', 'c'] as const) {
    const revue = await attendre(() => api('alice', 'GET', `/v1/exercices/${exercice[cle]}/revue`), (x) => x.json?.execution?.statut === 'termine' || x.json?.execution === null, 120_000);
    if (revue.json.execution === null) {
      const lance = await api('alice', 'POST', `/v1/exercices/${exercice[cle]}/controles`);
      await attendre(() => api('alice', 'GET', `/v1/exercices/${exercice[cle]}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine', 120_000);
    }
  }
  const depot = async (cle: 'a' | 'b' | 'c' | 'e', lignes: string[]) => {
    const r = await deposer('alice', dossier[cle], pdfTexte(lignes, `${SEL}-${cle}`), {}, `note-${cle}-${SEL}.pdf`);
    const id = r.fin.json.documentId as string;
    await attendre(() => api('alice', 'GET', `/v1/documents/${id}`), (x) => x.statut === 200 && !['recu', 'en_analyse'].includes(x.json.document.statut));
    piece[cle] = id;
  };
  await depot('a', ['Note du dossier Alpha', `Mot repere ${MOT}`, '<script>alert(1)</script> contrat « annuel »']);
  await depot('b', ['Note du dossier Bravo', `Mot repere ${MOT}`, 'Bail commercial']);
  await depot('c', ['Note du dossier Charlie', `Mot repere ${MOT}`, `Element ${SECRET}`]);
  await depot('e', ['Note du dossier Echo', `Un autre mot ${AUTRE}`]);
  // Huit dossiers de plus, ouverts à Alice seule, avec une petite comptabilité chacun : de quoi dépasser une page de dix dossiers.
  plus = [];
  for (let i = 1; i <= 8; i++) {
    const nom = `Recherche ${SEL} Zoulou ${String(i).padStart(2, '0')} SARL`;
    const id = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole' })).json.id as string;
    await api('alice', 'PUT', `/v1/dossiers/${id}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    await importer(id, graine + 10 + i, [], 20 + i * 7);
    plus.push({ id, nom });
  }
}, 600_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('périmètre : ce que la base autorise, et rien d’autre', () => {
  it('mêmes mots dans plusieurs dossiers : résultats groupés par dossier, rattachés au bon dossier, dossier non habilité ni interrogé ni nommé', async () => {
    const r = await chercher('remi', MOT);
    expect(r.statut).toBe(200);
    // Rémi : A (collaboration), B (lecture), D, E (sans résultat) — jamais C. Ordre : total égal, puis nom.
    expect(r.json).toMatchObject({ requete: MOT, page: 1, dossiersParPage: DOSSIERS_PAR_PAGE, dossiersAutorises: 4, dossiersAvecResultats: 2, dossiersSansResultat: 2 });
    expect(idsDossiers(r)).toEqual([dossier.a, dossier.b]);
    expect(r.json.dossiers.map((d: any) => [d.nom, d.niveau, d.totaux])).toEqual([[NOMS.a, 'collaboration', { pieces: 1, ecritures: 0, constats: 0 }], [NOMS.b, 'lecture', { pieces: 1, ecritures: 0, constats: 0 }]]);
    expect(r.json.limites).toEqual({ delaiMaxMs: DELAI_MAX_RECHERCHE_MS, piecesParDossier: MAX_PIECES_PAR_DOSSIER, ecrituresParDossier: MAX_ECRITURES_PAR_DOSSIER, constatsParDossier: MAX_CONSTATS_PAR_DOSSIER });
    // Chaque pièce citée appartient, EN BASE, au dossier sous lequel elle est rangée.
    for (const d of r.json.dossiers) {
      expect(d.pieces).toHaveLength(1);
      expect(d.pieces[0].documentId).toBe(d.id === dossier.a ? piece.a : piece.b);
      const enBase = (await editeur.query('select entite_id from documents where id = $1', [d.pieces[0].documentId])).rows[0];
      expect(enBase.entite_id).toBe(d.id);
      expect(d.pieces[0].segments.some((s: any) => s.trouve && s.texte.toLowerCase().includes('brimborion'))).toBe(true);
    }
    // Le dossier C (non habilité), ses pièces, son nom, son contenu secret : nulle part. Les dossiers sans résultat non plus.
    const brut = JSON.stringify(r.json);
    for (const interdit of [dossier.c, piece.c, NOMS.c, SECRET, 'Charlie', dossier.d, NOMS.d, dossier.e, NOMS.e, piece.e]) expect(brut).not.toContain(interdit);
    // Alice, habilitée partout, voit C : le même mot dans trois dossiers.
    const alice = await chercher('alice', MOT);
    expect(idsDossiers(alice)).toEqual([dossier.a, dossier.b, dossier.c]);
    expect(alice.json).toMatchObject({ dossiersAutorises: 13, dossiersAvecResultats: 3, dossiersSansResultat: 10 });
    // Chloé a les mêmes droits que Rémi ici ; un mot propre à un seul dossier ne ramène que ce dossier.
    expect(idsDossiers(await chercher('chloe', MOT))).toEqual([dossier.a, dossier.b]);
    const seul = await chercher('remi', AUTRE);
    expect(idsDossiers(seul)).toEqual([dossier.e]);
    expect(seul.json.dossiers[0].pieces[0]).toMatchObject({ documentId: piece.e, page: 1 });
    // Mot réservé à C : Rémi n'obtient rien — et la réponse ne dit pas que ce dossier existe.
    const secret = await chercher('remi', SECRET);
    expect(secret.json).toMatchObject({ dossiers: [], dossiersAvecResultats: 0, dossiersSansResultat: 4 });
    expect(JSON.stringify(secret.json)).not.toContain(NOMS.c);
    expect(idsDossiers(await chercher('alice', SECRET))).toEqual([dossier.c]);
  });

  it('écritures du lot actif et constats : totaux exacts comparés à la base, extraits bornés, du bon dossier', async () => {
    const r = await chercher('alice', 'marchandises');
    expect(r.statut).toBe(200);
    // Totaux attendus calculés par la base elle-même, pour chaque dossier du cabinet.
    const attendu = await editeur.query(
      `select l.entite_id, count(*)::int as n from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
       where l.cabinet_id = $1 and to_tsvector('french', l.ecriture_lib || ' ' || l.piece_ref || ' ' || l.compte_lib || ' ' || coalesce(l.comp_aux_lib, '')) @@ websearch_to_tsquery('french', $2) group by l.entite_id`,
      [cabinet, 'marchandises'],
    );
    const parDossier = new Map<string, number>(attendu.rows.map((l) => [l.entite_id, l.n]));
    expect(parDossier.size).toBe(3 + plus.length);
    expect(r.json.dossiersAvecResultats).toBe(parDossier.size);
    // Classement : total décroissant, puis nom ; une page de dix dossiers.
    const totaux = r.json.dossiers.map((d: any) => d.totaux.pieces + d.totaux.ecritures + d.totaux.constats);
    expect(r.json.dossiers).toHaveLength(DOSSIERS_PAR_PAGE);
    for (let i = 1; i < totaux.length; i++) {
      expect(totaux[i - 1]).toBeGreaterThanOrEqual(totaux[i]);
      if (totaux[i - 1] === totaux[i]) expect(r.json.dossiers[i - 1].nom.localeCompare(r.json.dossiers[i].nom, 'fr')).toBeLessThan(0);
    }
    for (const d of r.json.dossiers) {
      expect(d.totaux.ecritures).toBe(parDossier.get(d.id));
      expect(d.ecritures.length).toBe(Math.min(MAX_ECRITURES_PAR_DOSSIER, d.totaux.ecritures));
      const lignes = (await editeur.query('select id, entite_id, lot_import_id from lignes_ecriture where id = any($1::uuid[])', [d.ecritures.map((e: any) => e.id)])).rows;
      for (const l of lignes) expect(l.entite_id).toBe(d.id);
      expect(lignes).toHaveLength(d.ecritures.length);
      // Les plus récentes d'abord.
      const dates = d.ecritures.map((e: any) => e.date);
      expect([...dates].sort().reverse()).toEqual(dates);
      for (const e of d.ecritures) expect(typeof e.debit).toBe('string');
    }
    // Constats : seuls A et C ont des contrôles exécutés avec l'anomalie « client créditeur ».
    const c = await chercher('alice', 'créditeur');
    const constatsEnBase = (await editeur.query(
      `select c.entite_id, count(*)::int as n from constats c join executions_controles e on e.id = c.execution_id and not e.obsolete
       where c.cabinet_id = $1 and to_tsvector('french', c.titre || ' ' || c.explication) @@ websearch_to_tsquery('french', $2) group by c.entite_id`,
      [cabinet, 'créditeur'],
    )).rows;
    expect(constatsEnBase.length).toBeGreaterThan(0);
    for (const l of constatsEnBase) expect(l.n).toBe(c.json.dossiers.find((d: any) => d.id === l.entite_id).totaux.constats);
    expect(idsDossiers(c).sort()).toEqual(constatsEnBase.map((l) => l.entite_id).sort());
    for (const d of c.json.dossiers) {
      expect(d.constats.length).toBe(Math.min(MAX_CONSTATS_PAR_DOSSIER, d.totaux.constats));
      const lignes = (await editeur.query('select entite_id from constats where id = any($1::uuid[])', [d.constats.map((x: any) => x.id)])).rows;
      for (const l of lignes) expect(l.entite_id).toBe(d.id);
    }
    // Rémi : les constats de A seulement (C lui est fermé).
    const remi = await chercher('remi', 'créditeur');
    expect(idsDossiers(remi)).toEqual([dossier.a]);
    expect(remi.json.dossiers[0].totaux.constats).toBe(c.json.dossiers.find((d: any) => d.id === dossier.a).totaux.constats);
  });

  it('pagination par dossier : pages disjointes, complètes, sans doublon ; page vide au-delà', async () => {
    const p1 = await chercher('alice', 'marchandises', '&page=1');
    const p2 = await chercher('alice', 'marchandises', '&page=2');
    expect(p1.json.dossiers).toHaveLength(DOSSIERS_PAR_PAGE);
    expect(p2.json).toMatchObject({ page: 2, dossiersAvecResultats: 3 + plus.length });
    expect(p2.json.dossiers).toHaveLength(3 + plus.length - DOSSIERS_PAR_PAGE);
    const tous = [...idsDossiers(p1), ...idsDossiers(p2)];
    expect(new Set(tous).size).toBe(tous.length);
    expect(new Set(tous)).toEqual(new Set([dossier.a, dossier.b, dossier.c, ...plus.map((d) => d.id)]));
    // Le classement se poursuit d'une page à l'autre.
    const t = (d: any) => d.totaux.pieces + d.totaux.ecritures + d.totaux.constats;
    expect(t(p1.json.dossiers.at(-1))).toBeGreaterThanOrEqual(t(p2.json.dossiers[0]));
    const p3 = await chercher('alice', 'marchandises', '&page=3');
    expect(p3.statut).toBe(200);
    expect(p3.json).toMatchObject({ dossiers: [], dossiersAvecResultats: 3 + plus.length });
    for (const page of ['0', '-1', '1.5', 'x', '1001']) expect((await chercher('alice', 'marchandises', `&page=${page}`)).statut, page).toBe(400);
  });
});

describe('contenu non fiable, validation et refus', () => {
  it('un extrait de pièce reste une DONNÉE : texte brut, jamais interprété, surlignage par segments', async () => {
    const r = await chercher('alice', 'annuel');
    const extrait = r.json.dossiers.find((d: any) => d.id === dossier.a).pieces[0];
    // Le surlignage PostgreSQL écarte les balises du texte (jamais de balise dans l'extrait) ; le reste est restitué tel quel.
    expect(extrait.extrait).not.toContain('<script');
    expect(extrait.extrait).toContain('alert(1)');
    expect(extrait.segments.map((s: any) => s.texte).join('')).not.toMatch(/<[a-z/]/i);
    expect(extrait.segments.filter((s: any) => s.trouve).map((s: any) => s.texte.toLowerCase())).toContain('annuel');
    expect(r.brut.toString('utf8')).not.toContain('');
    expect(r.brut.toString('utf8')).not.toContain('');
  });

  it('validation : requête de 2 à 200 caractères ; un dossier précis passe toujours par entiteId (comportement inchangé)', async () => {
    expect((await chercher('remi', 'a')).statut).toBe(400);
    expect((await chercher('remi', ' ')).statut).toBe(400);
    expect((await chercher('remi', 'x'.repeat(201))).statut).toBe(400);
    expect((await api('remi', 'GET', '/v1/recherche')).statut).toBe(400);
    expect((await chercher('remi', MOT, '&entiteId=pas-un-uuid')).statut).toBe(400);
    const unDossier = await api('remi', 'GET', `/v1/recherche?entiteId=${dossier.a}&q=${encodeURIComponent(MOT)}`);
    expect(unDossier.statut).toBe(200);
    expect(unDossier.json.pieces).toHaveLength(1);
    expect(unDossier.json.dossiers).toBeUndefined();
    // Un dossier non habilité, demandé par identifiant : 404 comme avant ; pas de contournement par le portefeuille.
    expect((await api('remi', 'GET', `/v1/recherche?entiteId=${dossier.c}&q=${encodeURIComponent(MOT)}`)).statut).toBe(404);
    // Un paramètre de dossiers supplémentaire n'élargit jamais le périmètre.
    const force = await chercher('remi', MOT, `&dossierIds=${dossier.c}&dossiers=${dossier.c}`);
    expect(idsDossiers(force)).toEqual([dossier.a, dossier.b]);
  });

  it('un déposant est refusé, sans jeton 401 ; un autre cabinet ne voit rien d’ici', async () => {
    expect((await chercher('client', MOT)).statut).toBe(403);
    expect((await chercher('', MOT)).statut).toBe(401);
    const bruno = await chercher('bruno', MOT);
    expect(bruno.statut).toBe(200);
    expect(bruno.json.dossiers).toEqual([]);
    const brut = JSON.stringify(bruno.json);
    for (const id of [...Object.values(dossier), ...Object.values(piece), ...plus.map((d) => d.id)]) expect(brut).not.toContain(id);
    expect((await chercher('bruno', 'marchandises')).json.dossiers.every((d: any) => !Object.values(dossier).includes(d.id) && !plus.some((p) => p.id === d.id))).toBe(true);
  });

  it('délai dépassé : refus explicite 503, jamais un résultat partiel', async () => {
    const annulee = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const bd = { avecContexte: async () => { throw annulee; } } as unknown as AccesBd;
    const acces = { cabinetId: cabinet, utilisateurId: DEMO.remi, role: 'reviseur' } as unknown as Acces;
    await expect(rechercherPortefeuille(bd, acces, 'facture')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rechercherPortefeuille(bd, acces, 'facture')).rejects.toThrow(/dépassé le délai de 8 s/);
    // Toute autre erreur de la base reste une erreur, pas un délai.
    const autre = { avecContexte: async () => { throw new Error('autre'); } } as unknown as AccesBd;
    await expect(rechercherPortefeuille(autre, acces, 'facture')).rejects.toThrow('autre');
  });
});

describe('habilitations relues à chaque recherche', () => {
  it('retrait d’habilitation entre deux recherches : le dossier disparaît aussitôt, sans être nommé ni décompté en trop', async () => {
    const avant = await chercher('remi', MOT);
    expect(idsDossiers(avant)).toEqual([dossier.a, dossier.b]);
    await editeur.query('delete from habilitations_dossier where entite_id = $1 and utilisateur_id = $2', [dossier.a, DEMO.remi]);
    const apres = await chercher('remi', MOT);
    expect(idsDossiers(apres)).toEqual([dossier.b]);
    expect(apres.json).toMatchObject({ dossiersAutorises: 3, dossiersAvecResultats: 1, dossiersSansResultat: 2 });
    for (const interdit of [dossier.a, NOMS.a, piece.a, 'Alpha']) expect(JSON.stringify(apres.json)).not.toContain(interdit);
    // Ramené au niveau « dépôt » : sous « lecture », le dossier sort aussi du périmètre.
    await habiliter('b', DEMO.remi, 'depot');
    const depot = await chercher('remi', MOT);
    expect(depot.json).toMatchObject({ dossiers: [], dossiersAutorises: 2 });
    expect(JSON.stringify(depot.json)).not.toContain(NOMS.b);
    // Les autres membres ne sont pas touchés ; rétabli, le dossier réapparaît.
    expect(idsDossiers(await chercher('chloe', MOT))).toEqual([dossier.a, dossier.b]);
    await habiliter('a', DEMO.remi, 'lecture');
    expect(idsDossiers(await chercher('remi', MOT))).toEqual([dossier.a]);
  });
});
