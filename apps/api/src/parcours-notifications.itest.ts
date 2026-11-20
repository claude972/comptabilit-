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
import { genererFecSynthetique } from '@comtaple/core';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte } from './essais/outils.js';

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

describe('notifications d’import, de constat affecté, et préférences', () => {
  let exercice = '';
  let constats: any[] = [];
  const types = async (qui: string) => (await notifs(qui)).notifications.map((n: any) => n.type);

  it('import terminé : la personne qui l’a lancé est prévenue par le traitement en arrière-plan, et elle seule', async () => {
    expect((await notifs('remi')).total).toBe(0);
    exercice = (await api('remi', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 120, graine: Number.parseInt(SEL.slice(0, 6), 16), anomalies: ['caisse_crediteur', 'client_crediteur'] });
    const d = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', d.fin.json.lotImportId);
    const liste = await attendre(() => notifs('remi'), (n) => n.total > 0);
    expect(liste.notifications).toHaveLength(1);
    expect(liste.notifications[0]).toMatchObject({ type: 'import.termine', lien: `/dossiers/${dossier}/comptabilite` });
    expect(liste.notifications[0].titre).toMatch(/^L’import des écritures comptables est terminé/);
    expect(liste.notifications[0].message).toMatch(/Terminé ne veut pas dire conforme/);
    expect(await types('alice')).not.toContain('import.termine');
  });

  it('import en échec : prévenu aussi, avec un titre qui le dit', async () => {
    const faux = await deposer('remi', dossier, Buffer.from('ceci n’est pas un fichier des écritures comptables\n'.repeat(20)), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, 'faux-fec.txt');
    const lot = await attendreLot('remi', faux.fin.json.lotImportId);
    expect(lot.json.statut).toBe('echec');
    const liste = await attendre(() => notifs('remi'), (n) => n.notifications.some((x: any) => x.type === 'import.echec'));
    expect(liste.notifications[0]).toMatchObject({ type: 'import.echec', titre: 'L’import des écritures comptables a échoué' });
  });

  it('constat affecté : la personne désignée est prévenue ; se l’affecter soi-même ne notifie personne', async () => {
    const revue = await attendre(() => api('remi', 'GET', `/v1/exercices/${exercice}/revue`), (r) => r.json?.execution?.statut === 'termine' && r.json.constats?.length >= 2, 120_000);
    constats = revue.json.constats;
    const avant = (await notifs('remi')).total;
    expect((await api('alice', 'PATCH', `/v1/constats/${constats[0].id}`, { action: 'affecter', affecteA: DEMO.remi })).statut).toBeLessThan(300);
    const liste = await notifs('remi');
    expect(liste.total).toBe(avant + 1);
    expect(liste.notifications[0]).toMatchObject({ type: 'constat.affecte', titre: 'Un constat de révision vous a été affecté', lien: `/dossiers/${dossier}/revision` });
    expect(liste.notifications[0].message).toContain(constats[0].controleId);
    const alice = (await notifs('alice')).total;
    expect((await api('alice', 'PATCH', `/v1/constats/${constats[1].id}`, { action: 'affecter', affecteA: DEMO.alice })).statut).toBeLessThan(300);
    expect((await api('remi', 'PATCH', `/v1/constats/${constats[0].id}`, { action: 'prendre_en_charge' })).statut).toBeLessThan(300);
    expect((await notifs('alice')).total).toBe(alice);
    expect((await notifs('remi')).total).toBe(avant + 1);
  });

  it('préférences : une famille désactivée n’est plus notifiée à cette personne, et à elle seule ; rien d’extérieur à régler', async () => {
    const p = (await api('remi', 'GET', '/v1/notifications/preferences')).json;
    expect(p.envoiExterne).toBe(false);
    expect(p.familles.map((f: any) => [f.famille, f.active])).toEqual([['regles', true], ['pieces', true], ['imports', true], ['constats', true], ['restitutions', true]]);
    // La famille « ia » (alerte d'expiration de la preuve de la passerelle IA, D-097) n'est proposée qu'aux administrateurs et associés.
    expect(((await api('alice', 'GET', '/v1/notifications/preferences')).json.familles as Array<{ famille: string; active: boolean }>).map((f) => f.famille)).toEqual(['regles', 'pieces', 'imports', 'constats', 'restitutions', 'ia']);
    expect((await api('remi', 'PUT', '/v1/notifications/preferences', { famille: 'inconnue', active: false })).statut).toBe(400);
    expect((await api('remi', 'PUT', '/v1/notifications/preferences', { famille: 'constats', active: 'non' })).statut).toBe(400);
    expect((await api('remi', 'PUT', '/v1/notifications/preferences', { famille: 'constats', active: false })).json).toMatchObject({ famille: 'constats', active: false });
    expect((await api('remi', 'GET', '/v1/notifications/preferences')).json.familles.find((f: any) => f.famille === 'constats').active).toBe(false);
    // Les préférences d'Alice ne sont pas touchées par celles de Rémi.
    expect((await api('alice', 'GET', '/v1/notifications/preferences')).json.familles.every((f: any) => f.active)).toBe(true);

    const avant = (await notifs('remi')).total;
    expect((await api('alice', 'PATCH', `/v1/constats/${constats[1].id}`, { action: 'affecter', affecteA: DEMO.remi })).statut).toBeLessThan(300);
    expect((await notifs('remi')).total).toBe(avant); // famille désactivée : pas de notification, les anciennes restent
    // Les autres familles restent actives pour lui.
    const d = await deposer('remi', dossier, Buffer.from('toujours pas un fichier des écritures comptables\n'.repeat(20)), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, 'faux-fec-2.txt');
    await attendreLot('remi', d.fin.json.lotImportId);
    await attendre(() => notifs('remi'), (n) => n.total === avant + 1);
    // Réactivée : notifié de nouveau.
    expect((await api('remi', 'PUT', '/v1/notifications/preferences', { famille: 'constats', active: true })).json.active).toBe(true);
    expect((await api('alice', 'PATCH', `/v1/constats/${constats[1].id}`, { action: 'affecter', affecteA: DEMO.remi })).statut).toBeLessThan(300);
    expect((await notifs('remi')).notifications[0].type).toBe('constat.affecte');
    expect((await notifs('remi')).total).toBe(avant + 2);
    // Famille à deux préfixes : désactiver « restitutions » coupe les archives de dossier ET de cabinet.
    await api('remi', 'PUT', '/v1/notifications/preferences', { famille: 'restitutions', active: false });
    const lignes = (await editeur.query('select famille, active from preferences_notification where cabinet_id = $1 and utilisateur_id = $2 order by famille', [cabinet, DEMO.remi])).rows;
    expect(lignes).toEqual([{ famille: 'constat', active: true }, { famille: 'restitution', active: false }, { famille: 'restitution_cabinet', active: false }]);
  });
});

describe('regroupement et archivage réversible', () => {
  it('les notifications courantes se regroupent par nature et par dossier ; un groupe se lit, s’archive et se désarchive d’un coup', async () => {
    const liste = await notifs('remi');
    const g = (await api('remi', 'GET', '/v1/notifications/groupes')).json;
    expect(g.envoiExterne).toBe(false);
    // Autant de notifications dans les groupes que dans la liste, chaque notification dans un seul groupe.
    expect(g.groupes.reduce((t: number, x: any) => t + x.nombre, 0)).toBe(liste.total);
    expect(g.groupes.reduce((t: number, x: any) => t + x.nonLues, 0)).toBe(liste.nonLues);
    expect(new Set(g.groupes.flatMap((x: any) => x.ids)).size).toBe(liste.total);
    expect(new Set(g.groupes.map((x: any) => x.type)).size).toBe(g.groupes.length); // un seul dossier ici : un groupe par type
    const echecs = g.groupes.find((x: any) => x.type === 'import.echec');
    expect(echecs).toMatchObject({ nombre: 2, titre: 'L’import des écritures comptables a échoué', lien: `/dossiers/${dossier}/comptabilite` });
    const constats = g.groupes.find((x: any) => x.type === 'constat.affecte');
    expect(constats.nombre).toBe(2);

    // Lire tout un groupe.
    expect((await api('remi', 'POST', '/v1/notifications/lot', { ids: echecs.ids, action: 'lire' })).json).toEqual({ action: 'lire', modifiees: 2 });
    expect((await notifs('remi')).nonLues).toBe(liste.nonLues - 2);
    // Archiver le groupe : il sort de la liste courante et du décompte, sans être supprimé.
    expect((await api('remi', 'POST', '/v1/notifications/lot', { ids: echecs.ids, action: 'archiver' })).json.modifiees).toBe(2);
    const apres = await notifs('remi');
    expect(apres).toMatchObject({ total: liste.total - 2, archivees: 2 });
    expect(apres.notifications.some((n: any) => n.type === 'import.echec')).toBe(false);
    const archivees = await notifs('remi', '?archivees=1');
    expect(archivees.notifications.map((n: any) => n.type)).toEqual(['import.echec', 'import.echec']);
    expect(archivees.notifications.every((n: any) => n.archiveeLe && n.lueLe)).toBe(true);
    expect((await api('remi', 'GET', '/v1/notifications/groupes')).json.groupes.some((x: any) => x.type === 'import.echec')).toBe(false);
    // Réversible : désarchivé, le groupe revient tel quel.
    expect((await api('remi', 'POST', '/v1/notifications/lot', { ids: echecs.ids, action: 'desarchiver' })).json.modifiees).toBe(2);
    expect(await notifs('remi')).toMatchObject({ total: liste.total, archivees: 0 });
    expect((await api('remi', 'GET', '/v1/notifications/groupes')).json.groupes.find((x: any) => x.type === 'import.echec').nombre).toBe(2);
  });

  it('archiver une notification non lue la marque lue ; « archiver les lues » ne touche pas aux non lues ; on n’agit que sur les siennes', async () => {
    const avant = await notifs('remi');
    const nonLue = avant.notifications.find((n: any) => n.lueLe === null);
    expect(nonLue).toBeTruthy();
    // Identifiants d'une autre personne, ou inconnus : ignorés sans erreur ni effet.
    const dAlice = (await notifs('alice')).notifications.map((n: any) => n.id);
    expect((await api('remi', 'POST', '/v1/notifications/lot', { ids: [...dAlice, '00000000-0000-4000-8000-000000000000'], action: 'archiver' })).json.modifiees).toBe(0);
    expect((await notifs('alice', '?archivees=1')).total).toBe(0);
    for (const corps of [{ ids: [], action: 'lire' }, { ids: ['pas-un-uuid'], action: 'lire' }, { ids: [nonLue.id], action: 'supprimer' }]) {
      expect((await api('remi', 'POST', '/v1/notifications/lot', corps)).statut).toBe(400);
    }
    const lues = avant.total - avant.nonLues;
    expect((await api('remi', 'POST', '/v1/notifications/archiver-lues')).json).toEqual({ archivees: lues });
    const milieu = await notifs('remi');
    expect(milieu).toMatchObject({ total: avant.nonLues, nonLues: avant.nonLues, archivees: lues });
    expect((await api('remi', 'GET', '/v1/notifications/decompte')).json).toEqual({ nonLues: avant.nonLues });
    expect((await api('remi', 'POST', '/v1/notifications/lot', { ids: [nonLue.id], action: 'archiver' })).json.modifiees).toBe(1);
    const fin = await notifs('remi', '?archivees=1');
    expect(fin.notifications.find((n: any) => n.id === nonLue.id).lueLe).toBeTruthy();
    expect((await api('remi', 'GET', '/v1/notifications/decompte')).json).toEqual({ nonLues: avant.nonLues - 1 });
    // Aucune route ne supprime une notification.
    for (const [m, c] of [['DELETE', `/v1/notifications/${nonLue.id}`], ['DELETE', '/v1/notifications']] as const) expect((await api('remi', m, c)).statut).toBe(404);
    expect((await notifs('remi')).total + (await notifs('remi', '?archivees=1')).total).toBe(avant.total);
  });
});
