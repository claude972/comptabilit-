/**
 * Invitations et ouverture de cabinet — pile réelle locale (Keycloak réel, API réelle, PostgreSQL réel).
 * Un cabinet NEUF est ouvert par l'outil de l'éditeur ; des comptes Keycloak d'essai sont créés pour l'occasion
 * (adresse vérifiée ou non) puis supprimés. Aucun courriel n'est envoyé par l'application.
 */
import { randomBytes } from 'node:crypto';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { creerCabinet, exporterElementsFacturation, genererEcheance, ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, api, choisirCabinet, jetons, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const KC = process.env.OIDC_ISSUER!.replace(/\/realms\/.*$/, '');
const ROYAUME = process.env.OIDC_ISSUER!.replace(/^.*\/realms\//, '');
const MDP = `Essai-${randomBytes(9).toString('hex')}`;
const ADMIN = `admin.${SEL}@cabinet-invite.test`;
const RECRUE = `recrue.${SEL}@cabinet-invite.test`;
const NON_VERIFIE = `douteux.${SEL}@cabinet-invite.test`;
let editeur: pg.Client;
let jetonKc = '';
let cabinet = '';
const comptesKc: string[] = [];

async function creerCompteKeycloak(email: string, nom: string, emailVerifie: boolean): Promise<void> {
  const r = await fetch(`${KC}/admin/realms/${ROYAUME}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jetonKc}`, 'content-type': 'application/json' },
    body: JSON.stringify({ username: email, email, emailVerified: emailVerifie, enabled: true, firstName: nom.split(' ')[0], lastName: nom.split(' ').slice(1).join(' ') || 'Essai', credentials: [{ type: 'password', value: MDP, temporary: false }] }),
  });
  expect(r.status, `création du compte ${email}`).toBe(201);
  comptesKc.push(r.headers.get('location')!.split('/').pop()!);
}
async function connecter(cle: string, email: string): Promise<void> {
  const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: MDP, scope: 'openid' }) });
  const d = (await r.json()) as { access_token?: string };
  expect(d.access_token, `jeton de ${email}`).toBeTruthy();
  jetons[cle] = d.access_token!;
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  const t = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KC_ADMIN_USER ?? 'admin', password: process.env.KC_ADMIN_PASSWORD! }) });
  jetonKc = ((await t.json()) as { access_token: string }).access_token;
  expect(jetonKc).toBeTruthy();
}, 60_000);

afterAll(async () => {
  for (const id of comptesKc) await fetch(`${KC}/admin/realms/${ROYAUME}/users/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${jetonKc}` } });
  choisirCabinet('alice', null);
  if (cabinet) await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('ouverture d’un cabinet et invitations', () => {
  it('l’éditeur ouvre un cabinet : seule une invitation d’administrateur existe, aucun membre, aucun courriel', async () => {
    await expect(creerCabinet(editeur, { nom: 'X', emailAdministrateur: ADMIN, nomAdministrateur: 'A' })).rejects.toThrow(/trop court/);
    await expect(creerCabinet(editeur, { nom: 'Cabinet', emailAdministrateur: 'pas-une-adresse', nomAdministrateur: 'A' })).rejects.toThrow(/invalide/);
    const r = await creerCabinet(editeur, { nom: `Cabinet invité ${SEL} (fictif)`, emailAdministrateur: ADMIN.toUpperCase(), nomAdministrateur: 'Ada Ministre' });
    cabinet = r.cabinetId;
    expect((await editeur.query('select count(*)::int as n from appartenances where cabinet_id = $1', [cabinet])).rows[0].n).toBe(0);
    expect((await editeur.query('select email, role, statut, invitee_par from invitations where cabinet_id = $1', [cabinet])).rows).toEqual([{ email: ADMIN, role: 'administrateur', statut: 'en_attente', invitee_par: null }]);
    await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  });

  it('un compte inconnu sans invitation est refusé ; une adresse NON vérifiée n’accepte pas l’invitation', async () => {
    await creerCompteKeycloak(NON_VERIFIE, 'Dou Teux', false);
    await editeur.query(`insert into invitations (cabinet_id, email, nom, role, expire_le) values ($1, $2, 'Dou Teux', 'collaborateur', now() + interval '1 day')`, [cabinet, NON_VERIFIE]);
    await connecter('douteux', NON_VERIFIE);
    const r = await api('douteux', 'GET', '/v1/moi');
    expect(r.statut).toBe(403);
    expect((await editeur.query(`select statut from invitations where email = $1`, [NON_VERIFIE])).rows[0].statut).toBe('en_attente');
    expect((await editeur.query(`select count(*)::int as n from utilisateurs where email = $1`, [NON_VERIFIE])).rows[0].n).toBe(0);
  });

  it('première connexion de l’administrateur invité : fiche et appartenance créées, invitation acceptée et journalisée, aucun dossier ouvert', async () => {
    await creerCompteKeycloak(ADMIN, 'Ada Ministre', true);
    await connecter('ada', ADMIN);
    const moi = await api('ada', 'GET', '/v1/moi');
    expect(moi.statut).toBe(200);
    expect(JSON.stringify(moi.json)).toContain('administrateur');
    expect((await editeur.query(`select statut, acceptee_par is not null as acceptee from invitations where cabinet_id = $1 and email = $2`, [cabinet, ADMIN])).rows[0]).toEqual({ statut: 'acceptee', acceptee: true });
    expect((await editeur.query(`select a.role, a.actif from appartenances a join utilisateurs u on u.id = a.utilisateur_id where a.cabinet_id = $1 and u.email = $2`, [cabinet, ADMIN])).rows).toEqual([{ role: 'administrateur', actif: true }]);
    expect((await editeur.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action = 'invitation.acceptee'`, [cabinet])).rows[0].n).toBe(1);
    expect((await editeur.query(`select journal_audit_verifier($1) as rupture`, [cabinet])).rows[0].rupture).toBeNull();
    expect((await api('ada', 'GET', '/v1/dossiers')).json).toEqual([]);
    // Rejouer la connexion ne recrée rien.
    expect((await api('ada', 'GET', '/v1/moi')).statut).toBe(200);
    expect((await editeur.query(`select count(*)::int as n from appartenances where cabinet_id = $1`, [cabinet])).rows[0].n).toBe(1);
  });

  it('l’administratrice invite une recrue : validations, doublons, rôle support refusé, annulation, liste', async () => {
    const inviter = (corps: unknown) => api('ada', 'POST', '/v1/cabinet/invitations', corps);
    expect((await inviter({ email: 'pas-une-adresse', nom: 'X', role: 'collaborateur' })).statut).toBe(400);
    expect((await inviter({ email: RECRUE, nom: 'Re Crue', role: 'support' })).statut).toBe(400);
    expect((await inviter({ email: ADMIN, nom: 'Ada', role: 'collaborateur' })).statut).toBe(409); // déjà membre
    const r = await inviter({ email: `  ${RECRUE.toUpperCase()} `, nom: 'Re Crue', role: 'collaborateur' });
    expect(r.statut).toBe(201);
    expect(r.json).toMatchObject({ email: RECRUE, role: 'collaborateur', statut: 'en_attente', courrielEnvoye: false });
    expect((await inviter({ email: RECRUE, nom: 'Re Crue', role: 'reviseur' })).statut).toBe(409); // déjà en attente
    expect((await api('ada', 'DELETE', `/v1/cabinet/invitations/${r.json.id}`)).statut).toBe(200);
    expect((await api('ada', 'DELETE', `/v1/cabinet/invitations/${r.json.id}`)).statut).toBe(404);
    const r2 = await inviter({ email: RECRUE, nom: 'Re Crue', role: 'collaborateur', validiteJours: 3 });
    expect(r2.statut).toBe(201);
    const liste = (await api('ada', 'GET', '/v1/cabinet/invitations')).json;
    expect(liste.filter((i: any) => i.email === RECRUE).map((i: any) => i.statut).sort()).toEqual(['annulee', 'en_attente']);
    // Le journal ne contient pas l'adresse invitée.
    expect(JSON.stringify((await editeur.query(`select details from journal_audit where cabinet_id = $1`, [cabinet])).rows)).not.toContain(RECRUE);
  });

  it('la recrue se connecte : collaboratrice du cabinet, sans aucun dossier, et sans droit sur les invitations', async () => {
    const dossier = (await api('ada', 'POST', '/v1/dossiers', { raisonSociale: `Dossier invité ${SEL} (fictif)`, territoireFiscal: 'metropole' })).json.id;
    await creerCompteKeycloak(RECRUE, 'Re Crue', true);
    await connecter('recrue', RECRUE);
    expect((await api('recrue', 'GET', '/v1/moi')).statut).toBe(200);
    expect((await api('recrue', 'GET', '/v1/dossiers')).json).toEqual([]);
    expect((await api('recrue', 'GET', `/v1/dossiers/${dossier}`)).statut).toBe(404);
    expect((await api('recrue', 'GET', '/v1/cabinet/invitations')).statut).toBe(403);
    expect((await api('recrue', 'POST', '/v1/cabinet/invitations', { email: `x.${SEL}@cabinet-invite.test`, nom: 'X', role: 'collaborateur' })).statut).toBe(403);
  });

  it('une invitation périmée ou annulée n’ouvre rien ; un autre cabinet ne voit ni n’annule ces invitations', async () => {
    const perimee = `perimee.${SEL}@cabinet-invite.test`;
    await editeur.query(`insert into invitations (cabinet_id, email, nom, role, expire_le) values ($1, $2, 'Pé Rimée', 'collaborateur', now() - interval '1 minute')`, [cabinet, perimee]);
    await creerCompteKeycloak(perimee, 'Pé Rimée', true);
    await connecter('perimee', perimee);
    expect((await api('perimee', 'GET', '/v1/moi')).statut).toBe(403);
    const liste = (await api('ada', 'GET', '/v1/cabinet/invitations')).json;
    expect(liste.find((i: any) => i.email === perimee)).toMatchObject({ statut: 'en_attente', expiree: true });
    expect(JSON.stringify((await api('bruno', 'GET', '/v1/cabinet/invitations')).json)).not.toContain(SEL);
    const id = liste.find((i: any) => i.email === perimee).id;
    expect((await api('bruno', 'DELETE', `/v1/cabinet/invitations/${id}`)).statut).toBe(404);
  });

  it('un compte déjà membre d’un cabinet, invité dans un second, y entre à la consultation de ses cabinets', async () => {
    const r = await api('ada', 'POST', '/v1/cabinet/invitations', { email: 'alice.admin@cabinet-a.test', nom: 'Alice Admin', role: 'reviseur' });
    expect(r.statut).toBe(201);
    const avant = (await editeur.query(`select count(*)::int as n from appartenances where cabinet_id = $1 and utilisateur_id = $2`, [cabinet, DEMO.alice])).rows[0].n;
    expect(avant).toBe(0);
    const cabinets = await fetch(`${API}/v1/cabinets`, { headers: { authorization: `Bearer ${jetons.alice}` } });
    expect(cabinets.status).toBe(200);
    expect(JSON.stringify(await cabinets.json())).toContain(cabinet);
    choisirCabinet('alice', cabinet);
    expect(JSON.stringify((await api('alice', 'GET', '/v1/moi')).json)).toContain('reviseur');
  });

  it('export des éléments de facturation de l’éditeur : une ligne par échéance, montants en chaînes, marqué fictif', async () => {
    const mois = `${new Date().toISOString().slice(0, 7)}-01`;
    const e = await genererEcheance(editeur, cabinet, mois);
    expect(e).toBeTruthy();
    const { csv, lignes } = await exporterElementsFacturation(editeur, mois, mois);
    expect(lignes).toBeGreaterThanOrEqual(1);
    const [entete, ...corps] = csv.trim().split('\r\n');
    expect(entete).toBe('echeance_id;reference;cabinet_id;cabinet;periode_debut;offre;dossiers_actifs;total_ht;fictif;statut_paiement;paye_le');
    const ligne = corps.find((l) => l.includes(cabinet))!;
    expect(ligne).toContain(`;${e!.totalHt};true;en_attente_virement;`);
    await expect(exporterElementsFacturation(editeur, '2026-13', mois)).rejects.toThrow(/AAAA-MM-JJ/);
  });
});
