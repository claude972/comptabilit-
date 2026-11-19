/** Administration du cabinet, pagination et téléversements abandonnés — pile réelle locale. */
import { randomBytes } from 'node:crypto';
import { DEMO } from '@comtaple/db/amorcer';
import { beforeAll, describe, expect, it } from 'vitest';
import { urlBd } from '@comtaple/db';
import { fermerAccesSupport, ouvrirAccesSupport } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { API, api, jetons, ouvrirSessions, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
let dossierId = '';

beforeAll(ouvrirSessions);

describe('dossiers et habilitations', () => {
  it('seul un gestionnaire crée un dossier, et le territoire fiscal doit être explicite', async () => {
    const corps = { raisonSociale: `Atelier d'essai ${SEL} SAS (fictif)`, formeJuridique: 'SAS', regimeFiscal: 'IS' };
    expect((await api('remi', 'POST', '/v1/dossiers', { ...corps, territoireFiscal: 'metropole' })).statut).toBe(403);
    expect((await api('client', 'POST', '/v1/dossiers', { ...corps, territoireFiscal: 'metropole' })).statut).toBe(403);
    expect((await api('alice', 'POST', '/v1/dossiers', corps)).statut).toBe(400); // pas de territoire par défaut
    expect((await api('alice', 'POST', '/v1/dossiers', { ...corps, territoireFiscal: 'metropole', siren: '123456789' })).statut).toBe(400); // clé SIREN fausse
    const r = await api('alice', 'POST', '/v1/dossiers', { ...corps, territoireFiscal: 'a_confirmer' });
    expect(r.statut).toBe(201);
    expect(r.json.territoireFiscal).toBe('a_confirmer');
    dossierId = r.json.id;
  });

  it('créer un dossier ne donne pas accès à son contenu : il faut une habilitation, plafonnée par le rôle et journalisée', async () => {
    expect((await api('alice', 'GET', `/v1/dossiers/${dossierId}`)).json.niveau).toBeNull();
    expect((await api('alice', 'POST', `/v1/dossiers/${dossierId}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' })).statut).toBe(404);
    expect((await api('remi', 'GET', `/v1/dossiers/${dossierId}`)).statut).toBe(404); // non habilité, non gestionnaire

    const h = (qui: string, utilisateur: string, niveau: string) => api(qui, 'PUT', `/v1/dossiers/${dossierId}/habilitations/${utilisateur}`, { niveau });
    expect((await h('remi', DEMO.remi, 'validation')).statut).toBe(403); // on ne s'habilite pas soi-même sans être gestionnaire
    expect((await h('bruno', DEMO.bruno, 'validation')).statut).toBe(404); // autre cabinet
    expect((await h('alice', DEMO.client, 'revision')).statut).toBe(400); // un client ne révise pas
    expect((await h('alice', DEMO.bruno, 'lecture')).statut).toBe(404); // pas membre de ce cabinet
    expect((await h('alice', DEMO.client, 'depot')).statut).toBe(200);
    expect((await h('alice', DEMO.remi, 'revision')).statut).toBe(200);
    expect((await h('alice', DEMO.alice, 'validation')).statut).toBe(200);

    expect((await api('client', 'GET', '/v1/dossiers')).json.map((d: any) => d.id)).toContain(dossierId);
    const ex = await api('alice', 'POST', `/v1/dossiers/${dossierId}/exercices`, { debut: '2026-01-01', fin: '2026-12-31' });
    expect(ex.statut).toBe(201);
    expect((await api('alice', 'POST', `/v1/dossiers/${dossierId}/exercices`, { debut: '2026-07-01', fin: '2027-06-30' })).statut).toBe(409); // chevauchement
    expect((await api('client', 'POST', `/v1/dossiers/${dossierId}/exercices`, { debut: '2027-01-01', fin: '2027-12-31' })).statut).toBe(403);

    const audit = await api('alice', 'GET', '/v1/audit?limite=20');
    const propre = audit.json.lignes.find((l: any) => l.action === 'habilitation.accordee' && l.cibleId === DEMO.alice && l.entiteId === dossierId);
    expect(propre.details).toMatchObject({ niveau: 'validation', pourSoiMeme: true });
  });

  it('les membres d’un dossier sont visibles des personnes habilitées en lecture, pas d’un simple déposant', async () => {
    const m = await api('remi', 'GET', `/v1/dossiers/${dossierId}/membres`);
    expect(m.json.map((x: any) => x.utilisateurId).sort()).toEqual([DEMO.alice, DEMO.remi, DEMO.client].sort());
    expect((await api('client', 'GET', `/v1/dossiers/${dossierId}/membres`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${dossierId}/membres`)).statut).toBe(404);
    expect((await api('alice', 'GET', '/v1/cabinet/membres')).json.length).toBeGreaterThanOrEqual(4);
    expect((await api('remi', 'GET', '/v1/cabinet/membres')).statut).toBe(403);
  });

  it('retirer une habilitation retire l’accès', async () => {
    expect((await api('alice', 'DELETE', `/v1/dossiers/${dossierId}/habilitations/${DEMO.remi}`)).statut).toBe(204);
    expect((await api('remi', 'GET', `/v1/dossiers/${dossierId}`)).statut).toBe(404);
    expect((await api('remi', 'GET', `/v1/dossiers/${dossierId}/membres`)).statut).toBe(404);
  });

  it('un gestionnaire peut corriger le territoire fiscal ; le changement est tracé', async () => {
    expect((await api('remi', 'PATCH', `/v1/dossiers/${dossierId}`, { territoireFiscal: 'metropole' })).statut).toBe(403);
    const r = await api('alice', 'PATCH', `/v1/dossiers/${dossierId}`, { territoireFiscal: 'reunion' });
    expect(r.json.territoireFiscal).toBe('reunion');
    const audit = await api('alice', 'GET', '/v1/audit?limite=5');
    expect(audit.json.lignes.find((l: any) => l.action === 'dossier.modifie').details).toMatchObject({ territoireAvant: 'a_confirmer', territoireApres: 'reunion' });
  });

  it('remet les comptes de démonstration dans leur état initial', async () => {
    expect((await api('alice', 'DELETE', `/v1/dossiers/${dossierId}/habilitations/${DEMO.client}`)).statut).toBe(204);
    expect((await api('client', 'GET', '/v1/dossiers')).json.map((d: any) => d.id)).not.toContain(dossierId);
  });

  it('les champs facultatifs d’un dossier se modifient et s’effacent ; le référentiel comptable est modifiable', async () => {
    const m = await api('alice', 'PATCH', `/v1/dossiers/${dossierId}`, { formeJuridique: 'SARL', codeNaf: '10.71C', referentielComptable: 'PCG' });
    expect(m.json).toMatchObject({ formeJuridique: 'SARL', codeNaf: '10.71C', referentielComptable: 'PCG' });
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossierId}`, { formeJuridique: null, codeNaf: null })).json).toMatchObject({ formeJuridique: null, codeNaf: null });
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossierId}`, { raisonSociale: null })).statut).toBe(400); // obligatoire
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossierId}`, { referentielComptable: '' })).statut).toBe(400);
  });

  it('liste les cabinets du compte, sans exiger le choix préalable d’un cabinet', async () => {
    const r = await api('alice', 'GET', '/v1/cabinets');
    expect(r.json).toEqual([{ id: DEMO.cabinetA, nom: expect.any(String), role: 'administrateur' }]);
    expect((await api('', 'GET', '/v1/cabinets')).statut).toBe(401);
  });
});

describe('listes paginées et téléversements abandonnés', () => {
  it('les documents sont paginés, et « mes dépôts » filtre aussi pour un collaborateur', async () => {
    const tout = await api('chloe', 'GET', `/v1/documents?entiteId=${DEMO.dupain}`);
    expect(tout.json).toMatchObject({ page: 1, taillePage: 100 });
    // Total et décomptes par statut sur tout le dossier, pas seulement sur la page.
    expect(tout.json.total).toBeGreaterThanOrEqual(tout.json.documents.length);
    expect(Object.values(tout.json.parStatut).reduce((t: number, n: any) => t + n, 0)).toBe(tout.json.total);
    const filtre = await api('chloe', 'GET', `/v1/documents?entiteId=${DEMO.dupain}&statut=traite`);
    expect(filtre.json.total).toBe(tout.json.parStatut.traite ?? 0);
    expect(filtre.json.parStatut).toEqual(tout.json.parStatut);
    expect(typeof tout.json.suite).toBe('boolean');
    const miens = await api('chloe', 'GET', `/v1/documents?entiteId=${DEMO.dupain}&deposant=moi`);
    expect(miens.json.documents.length).toBeLessThanOrEqual(tout.json.documents.length);
  });

  it('un téléversement abandonné supprime ses morceaux et ne peut plus être repris ; un autre utilisateur ne peut pas l’abandonner', async () => {
    const contenu = Buffer.from(`%PDF-1.4 abandon ${SEL} ${'x'.repeat(2000)}`);
    const o = await api('client', 'POST', '/v1/televersements', { entiteId: DEMO.dupain, nomFichier: 'a.pdf', taille: contenu.length, sha256: sha(contenu), canal: 'telephone' });
    await api('client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=0`, contenu.subarray(0, 1000));
    expect((await api('chloe', 'DELETE', `/v1/televersements/${o.json.id}`)).statut).toBe(403);
    expect((await api('client', 'DELETE', `/v1/televersements/${o.json.id}`)).statut).toBe(204);
    expect((await api('client', 'GET', `/v1/televersements/${o.json.id}`)).json.statut).toBe('abandonne');
    expect((await api('client', 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=1000`, contenu.subarray(1000))).statut).toBe(409);
    // Rouvrir le même fichier démarre un téléversement neuf, à zéro.
    const neuf = await api('client', 'POST', '/v1/televersements', { entiteId: DEMO.dupain, nomFichier: 'a.pdf', taille: contenu.length, sha256: sha(contenu), canal: 'telephone' });
    expect(neuf.json.id).not.toBe(o.json.id);
    expect(neuf.json.octetsRecus).toBe(0);
    await api('client', 'DELETE', `/v1/televersements/${neuf.json.id}`);
  });

  it('une clôture rejouée restitue l’information de doublon binaire', async () => {
    const contenu = Buffer.from(`%PDF-1.4 rejeu ${SEL}`);
    const corps = { entiteId: DEMO.dupain, nomFichier: 'r.pdf', taille: contenu.length, sha256: sha(contenu) };
    const a = await api('chloe', 'POST', '/v1/televersements', { ...corps, canal: 'ordinateur' });
    await api('chloe', 'PUT', `/v1/televersements/${a.json.id}/morceaux?decalage=0`, contenu);
    expect((await api('chloe', 'POST', `/v1/televersements/${a.json.id}/terminer`)).json.doublonBinaire).toBe(false);
    const b = await api('client', 'POST', '/v1/televersements', { ...corps, canal: 'telephone' });
    await api('client', 'PUT', `/v1/televersements/${b.json.id}/morceaux?decalage=0`, contenu);
    expect((await api('client', 'POST', `/v1/televersements/${b.json.id}/terminer`)).json.doublonBinaire).toBe(true);
    expect((await api('client', 'POST', `/v1/televersements/${b.json.id}/terminer`)).json.doublonBinaire).toBe(true); // réponse « perdue » puis rejouée
    expect(jetons.client).toBeTruthy();
  });
});

describe('indicateurs du cabinet', () => {
  it('donne des décomptes agrégés au gestionnaire, par dossier et jamais par personne ; refusé aux autres rôles', async () => {
    const r = await api('alice', 'GET', '/v1/cabinet/indicateurs?du=2020-01-01');
    expect(r.statut).toBe(200);
    expect(r.json.pieces.recues).toBeGreaterThan(0);
    expect(Object.keys(r.json.pieces.parStatut).length).toBeGreaterThan(0);
    const e = r.json.extractions;
    for (const k of ['accepteesSansCorrection', 'corrigeesPuisValidees', 'rejetees', 'nonExaminees']) expect(typeof e[k]).toBe('number');
    expect(Object.keys(r.json.controles.parStatut)).toEqual(expect.arrayContaining(['sans_anomalie']));
    // Un gestionnaire voit le décompte d'un dossier où il n'est pas habilité, mais toujours pas son contenu.
    const martin = r.json.parDossier.find((d: any) => d.entiteId === DEMO.martin);
    expect(martin).toMatchObject({ raisonSociale: expect.any(String), pieces: expect.any(Number) });
    expect((await api('alice', 'GET', `/v1/documents?entiteId=${DEMO.martin}`)).statut).toBe(404);
    // Aucun identifiant ni nom de personne dans la réponse.
    const texte = JSON.stringify(r.json);
    for (const personne of [DEMO.alice, DEMO.remi, DEMO.chloe, DEMO.client, 'Rémi', 'Chloé', 'Camille']) expect(texte).not.toContain(personne);
    // Cloisonnement : rien du cabinet Bêta.
    expect(r.json.parDossier.some((d: any) => d.entiteId === DEMO.leroy)).toBe(false);
    expect((await api('remi', 'GET', '/v1/cabinet/indicateurs')).statut).toBe(403);
    expect((await api('client', 'GET', '/v1/cabinet/indicateurs')).statut).toBe(403);
    expect((await api('alice', 'GET', '/v1/cabinet/indicateurs?du=2026-13-45')).statut).toBe(400);
  });
});

describe('membres du cabinet', () => {
  const membre = (qui: string, id: string, corps: unknown) => api(qui, 'PATCH', `/v1/cabinet/membres/${id}`, corps);

  it('garde-fous : gestionnaires seulement, pas sa propre appartenance, toujours un administrateur actif', async () => {
    expect((await membre('remi', DEMO.chloe, { role: 'reviseur' })).statut).toBe(403);
    expect((await membre('alice', DEMO.alice, { actif: false })).statut).toBe(403);
    expect((await membre('alice', DEMO.bruno, { role: 'collaborateur' })).statut).toBe(404); // autre cabinet
    expect((await membre('alice', DEMO.chloe, {})).statut).toBe(400);
    // Bruno est le seul administrateur du cabinet Bêta : personne d'autre que lui ne peut l'y modifier, et lui-même non plus.
    expect((await membre('bruno', DEMO.bruno, { role: 'collaborateur' })).statut).toBe(403);
  });

  it('une désactivation ferme immédiatement tous les accès ; la réactivation les rétablit', async () => {
    expect((await api('chloe', 'GET', '/v1/dossiers')).statut).toBe(200);
    expect((await membre('alice', DEMO.chloe, { actif: false })).json.actif).toBe(false);
    expect((await api('chloe', 'GET', '/v1/dossiers')).statut).toBe(403); // jeton encore valide, accès fermé
    expect((await api('chloe', 'GET', `/v1/documents?entiteId=${DEMO.dupain}`)).statut).toBe(403);
    expect((await membre('alice', DEMO.chloe, { actif: true })).json.actif).toBe(true);
    expect((await api('chloe', 'GET', `/v1/documents?entiteId=${DEMO.dupain}`)).statut).toBe(200);
  });

  it('un changement de rôle retire les habilitations au-dessus du nouveau plafond, sans les rabaisser en silence', async () => {
    const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai rôles ${SEL} (fictif)`, territoireFiscal: 'metropole' });
    expect((await api('alice', 'PUT', `/v1/dossiers/${d.json.id}/habilitations/${DEMO.remi}`, { niveau: 'revision' })).statut).toBe(200);
    const r = await membre('alice', DEMO.remi, { role: 'collaborateur' });
    expect(r.json.role).toBe('collaborateur');
    expect(r.json.habilitationsRetirees).toBeGreaterThanOrEqual(1); // « révision » dépasse le plafond d'un collaborateur
    expect((await api('remi', 'GET', `/v1/dossiers/${d.json.id}`)).statut).toBe(404);
    // Remise en état des comptes de démonstration : rôle et habilitations de révision d'origine.
    expect((await membre('alice', DEMO.remi, { role: 'reviseur' })).json.role).toBe('reviseur');
    for (const dossier of [DEMO.dupain, DEMO.martin, DEMO.bellevue]) {
      expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${DEMO.remi}`, { niveau: 'revision' })).statut).toBe(200);
    }
    expect((await api('remi', 'GET', `/v1/dossiers/${DEMO.martin}/exercices`)).statut).toBe(200);
    const audit = (await api('alice', 'GET', '/v1/audit?limite=40')).json.lignes.filter((l: any) => l.action === 'membre.modifie' && l.cibleId === DEMO.remi);
    expect(audit[audit.length - 1].details).toMatchObject({ roleAvant: 'reviseur', roleApres: 'collaborateur' });
  });
});

describe('accès temporaire du support', () => {
  // Bruno (administrateur du cabinet Bêta) joue ici la personne du support pour le cabinet Alpha.
  const enA = (chemin: string, methode = 'GET', corps?: unknown) =>
    fetch(`${API}${chemin}`, { method: methode, headers: { authorization: `Bearer ${jetons.bruno}`, 'x-cabinet-id': DEMO.cabinetA, ...(corps ? { 'content-type': 'application/json' } : {}) }, body: corps ? JSON.stringify(corps) : undefined });

  it('borné dans le temps, sans dossier par défaut, en lecture seule, tracé — puis fermé', async () => {
    const editeur = new pg.Client({ connectionString: urlBd('admin') });
    await editeur.connect();
    try {
      expect((await enA('/v1/dossiers')).status).toBe(403); // aucun accès avant ouverture
      await expect(ouvrirAccesSupport(editeur, { cabinetId: DEMO.cabinetA, sujetOidc: DEMO.bruno, email: 'bruno.admin@cabinet-b.test', nom: 'Bruno Admin', heures: 500, motif: 'Assistance' })).rejects.toThrow(/72 heures/);
      await expect(ouvrirAccesSupport(editeur, { cabinetId: DEMO.cabinetA, sujetOidc: DEMO.bruno, email: 'bruno.admin@cabinet-b.test', nom: 'Bruno Admin', heures: 2, motif: '' })).rejects.toThrow(/motif/);
      // Un membre du cabinet ne peut pas recevoir en plus un accès support (pas de changement de rôle détourné).
      await expect(ouvrirAccesSupport(editeur, { cabinetId: DEMO.cabinetA, sujetOidc: DEMO.remi, email: 'remi.reviseur@cabinet-a.test', nom: 'Rémi', heures: 2, motif: 'Assistance' })).rejects.toThrow(/déjà membre/);
      await ouvrirAccesSupport(editeur, { cabinetId: DEMO.cabinetA, sujetOidc: DEMO.bruno, email: 'bruno.admin@cabinet-b.test', nom: 'Bruno Admin', heures: 2, motif: 'Diagnostic d’un import à la demande du cabinet' });

      // Accès ouvert, mais aucun dossier tant que le cabinet ne l'a pas habilité.
      const dossiers = await enA('/v1/dossiers');
      expect(dossiers.status).toBe(200);
      expect(await dossiers.json()).toEqual([]);
      expect((await enA(`/v1/documents?entiteId=${DEMO.dupain}`)).status).toBe(404);
      // Le cabinet l'habilite : en lecture au plus.
      expect((await api('alice', 'PUT', `/v1/dossiers/${DEMO.dupain}/habilitations/${DEMO.bruno}`, { niveau: 'collaboration' })).statut).toBe(400);
      expect((await api('alice', 'PUT', `/v1/dossiers/${DEMO.dupain}/habilitations/${DEMO.bruno}`, { niveau: 'lecture' })).statut).toBe(200);
      expect((await enA(`/v1/documents?entiteId=${DEMO.dupain}`)).status).toBe(200);
      // Lecture seule : aucune écriture, même celles que le niveau « lecture » permettrait à un autre rôle.
      const contenu = Buffer.from('%PDF-1.4 support');
      expect((await enA('/v1/televersements', 'POST', { entiteId: DEMO.dupain, nomFichier: 's.pdf', taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' })).status).toBe(403);
      expect((await enA(`/v1/dossiers/${DEMO.dupain}/conseils`, 'POST', {})).status).toBe(403);
      // Toujours cloisonné : rien d'un dossier où il n'est pas habilité, et son propre cabinet reste séparé.
      expect((await enA(`/v1/documents?entiteId=${DEMO.martin}`)).status).toBe(404);
      // Chaque accès est tracé dans le journal du cabinet, visible de ses gestionnaires.
      const actions = (await api('alice', 'GET', '/v1/audit?limite=40')).json.lignes.filter((l: any) => l.acteurId === DEMO.bruno || l.cibleId === DEMO.bruno).map((l: any) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['support.acces_ouvert', 'support.consultation']));

      // Expiration : l'accès tombe de lui-même, sans intervention.
      await editeur.query(`update appartenances set expire_le = now() - interval '1 minute' where cabinet_id = $1 and utilisateur_id = $2`, [DEMO.cabinetA, DEMO.bruno]);
      expect((await enA(`/v1/documents?entiteId=${DEMO.dupain}`)).status).toBe(403);
      expect((await api('bruno', 'GET', '/v1/dossiers')).statut).toBe(200); // son cabinet d'origine n'est pas affecté
    } finally {
      await fermerAccesSupport(editeur, DEMO.cabinetA, DEMO.bruno);
      await editeur.query(`delete from appartenances where cabinet_id = $1 and utilisateur_id = $2 and role = 'support'`, [DEMO.cabinetA, DEMO.bruno]);
      await editeur.end();
    }
    expect((await enA('/v1/dossiers')).status).toBe(403);
    expect((await api('bruno', 'GET', '/v1/moi')).json.cabinet.id).toBe(DEMO.cabinetB);
  });
});
