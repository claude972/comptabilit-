/**
 * Notifications internes — pile réelle locale. Cabinet NEUF à chaque exécution : les notifications observées sont
 * exactement celles que le parcours provoque. Aucune notification n'est envoyée hors de l'application.
 */
import { randomBytes } from 'node:crypto';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const NOM = `Dossier notifications ${SEL} (fictif)`;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
const notifs = async (qui: string, requete = '') => (await api(qui, 'GET', `/v1/notifications${requete}`)).json;

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai notifications ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: NOM, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('notifications internes', () => {
  let regleId = '';

  it('au départ, personne n’a de notification ; l’API annonce qu’aucun envoi extérieur n’existe', async () => {
    for (const qui of COMPTES) expect(await notifs(qui)).toMatchObject({ total: 0, nonLues: 0, notifications: [], envoiExterne: false });
    expect((await api('', 'GET', '/v1/notifications')).statut).toBe(401);
  });

  it('règle proposée : les gestionnaires sont prévenus, pas l’auteure, ni le réviseur, ni le client, ni un autre cabinet', async () => {
    const p = await api('chloe', 'POST', '/v1/regles', { controleId: 'TIE-001', entiteId: dossier, motif: 'Petits avoirs sans enjeu', parametres: { seuil: '50.00' } });
    expect(p.statut).toBe(201);
    regleId = p.json.id;
    const alice = await notifs('alice');
    expect(alice).toMatchObject({ total: 1, nonLues: 1 });
    expect(alice.notifications[0]).toMatchObject({ type: 'regle.a_decider', titre: 'Une règle proposée attend une décision', lien: '/regles', lueLe: null });
    expect(alice.notifications[0].message).toContain('contrôle TIE-001, version 1');
    expect(alice.notifications[0].message).toContain(NOM);
    for (const qui of ['chloe', 'remi', 'client']) expect((await notifs(qui)).total, qui).toBe(0);
    expect(JSON.stringify(await notifs('bruno'))).not.toContain(NOM);
  });

  it('décision rendue : l’auteure de la proposition est prévenue, et elle seule', async () => {
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/refuser`, { motif: 'Seuil trop élevé' })).statut).toBe(200);
    const chloe = await notifs('chloe');
    expect(chloe.notifications.map((n: any) => [n.type, n.titre])).toEqual([['regle.decidee', 'Votre proposition de règle a été refusée']]);
    expect((await notifs('alice')).total).toBe(1); // la décideuse ne se notifie pas elle-même
    expect((await notifs('remi')).total).toBe(0);
  });

  it('demande de complément : le déposant est prévenu ; sa réponse prévient la demandeuse', async () => {
    const depot = await deposer('client', dossier, pdfTexte(['Facture d’essai', `Référence ${SEL}`], SEL), {}, 'facture.pdf');
    const documentId = depot.fin.json.documentId;
    await attendre(() => api('chloe', 'GET', `/v1/documents/${documentId}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
    expect((await api('chloe', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'demande_complement', message: 'Merci de préciser la nature de cette dépense.' })).statut).toBeLessThan(300);
    const client = await notifs('client');
    expect(client.notifications).toHaveLength(1);
    expect(client.notifications[0]).toMatchObject({ type: 'document.complement_demande', titre: 'Un complément vous est demandé sur une pièce', lien: `/depots/${documentId}` });
    // Le message de la collaboratrice n'est pas recopié dans la notification : il se lit sur la pièce.
    expect(JSON.stringify(client)).not.toContain('nature de cette dépense');
    expect((await api('client', 'POST', `/v1/documents/${documentId}/echanges`, { type: 'reponse', message: 'Fournitures de bureau.' })).statut).toBeLessThan(300);
    const chloe = await notifs('chloe', '?nonLues=1');
    expect(chloe.notifications.map((n: any) => n.type)).toEqual(['document.reponse', 'regle.decidee']);
    expect((await notifs('client')).total).toBe(1); // l'auteur de la réponse ne se notifie pas
  });

  it('archive de restitution prête : le demandeur est prévenu par le traitement en arrière-plan', async () => {
    const demande = await api('alice', 'POST', `/v1/dossiers/${dossier}/restitutions`);
    expect(demande.statut).toBe(202);
    const liste = await attendre(() => notifs('alice'), (n) => n.notifications.some((x: any) => x.type.startsWith('restitution.')), 120_000);
    expect(liste.notifications[0]).toMatchObject({ type: 'restitution.prete', titre: 'L’archive de restitution du dossier est prête', lien: `/dossiers/${dossier}/restitution` });
    expect((await notifs('chloe')).notifications.some((x: any) => x.type.startsWith('restitution.'))).toBe(false);
  });

  it('chacun ne marque que les siennes ; décompte, filtre et pagination', async () => {
    const chloe = await notifs('chloe');
    const [premiere, seconde] = chloe.notifications;
    expect((await api('chloe', 'GET', '/v1/notifications/decompte')).json).toEqual({ nonLues: 2 });
    expect((await api('alice', 'POST', `/v1/notifications/${premiere.id}/lue`)).statut).toBe(404); // celle d'une autre personne
    expect((await api('client', 'POST', `/v1/notifications/${premiere.id}/lue`)).statut).toBe(404);
    expect((await api('bruno', 'POST', `/v1/notifications/${premiere.id}/lue`)).statut).toBe(404);
    expect((await api('chloe', 'POST', '/v1/notifications/pas-un-identifiant/lue')).statut).toBe(400);
    expect((await api('chloe', 'GET', '/v1/notifications/decompte')).json).toEqual({ nonLues: 2 }); // rien n'a bougé
    const lue = await api('chloe', 'POST', `/v1/notifications/${premiere.id}/lue`);
    expect(lue.statut).toBe(200);
    expect(lue.json.lueLe).toBeTruthy();
    expect((await api('chloe', 'POST', `/v1/notifications/${premiere.id}/lue`)).json.lueLe).toBe(lue.json.lueLe); // rejouable, date conservée
    expect((await notifs('chloe', '?nonLues=1')).notifications.map((n: any) => n.id)).toEqual([seconde.id]);
    expect((await api('chloe', 'POST', '/v1/notifications/lues')).json).toEqual({ marquees: 1 });
    expect(await notifs('chloe')).toMatchObject({ total: 2, nonLues: 0 });
    expect((await notifs('alice')).nonLues).toBe(2); // celles d'Alice n'ont pas été touchées
    expect((await api('chloe', 'GET', '/v1/notifications?page=0')).statut).toBe(400);
    expect((await notifs('chloe', '?page=2')).notifications).toEqual([]);
  });

  it('habilitation retirée : la notification ne dit plus rien du dossier et ne propose plus de lien', async () => {
    expect(JSON.stringify(await notifs('chloe'))).toContain(NOM);
    await editeur.query('delete from habilitations_dossier where entite_id = $1 and utilisateur_id = $2', [dossier, DEMO.chloe]);
    const apres = await notifs('chloe');
    expect(apres.total).toBe(2);
    expect(JSON.stringify(apres)).not.toContain(NOM);
    expect(JSON.stringify(apres)).not.toContain('TIE-001');
    for (const n of apres.notifications) expect(n).toMatchObject({ titre: 'Notification d’un dossier auquel vous n’avez plus accès', lien: null });
  });
});
