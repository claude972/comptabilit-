/** Administration du cabinet, pagination et téléversements abandonnés — pile réelle locale. */
import { randomBytes } from 'node:crypto';
import { DEMO } from '@comtaple/db/amorcer';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, jetons, ouvrirSessions, sha } from './essais/outils.js';

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
