/**
 * Notifications poussées — mise en file par la base, distribution et livraison par le worker. PostgreSQL réel, file réelle
 * sous un préfixe d'essai, et SIMULATEUR de service de notification (aucun service réel n'est contacté : la destination
 * admise est la seule origine du simulateur). Cabinet NEUF à chaque exécution.
 */
import { randomBytes } from 'node:crypto';
import { type AccesBd, creerAccesBd, sql, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { chargerEnvLocal } from '@comtaple/db/env';
import { fermerAccesSupport, ouvrirAccesSupport, ouvrirEssai } from '@comtaple/db/provisionnement';
import {
  type AbonnementSimule, associeAbonnement, chiffrerAbonnement, connexionRedis, demarrerSimulateurPoussees, empreintePointAcces, type EtatPoussees, Files, genererClesVapid, lireConfig, notificationsPoussees,
  type SimulateurPoussees, TENTATIVES_POUSSEE,
} from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contexte } from './contexte.js';
import { distribuerEnvoi, entretenirAbonnementsPousses, livrerPoussee, LivraisonARejouer, REFUS_MAX_ABONNEMENT, releverEnvoisPousses } from './poussees.js';

chargerEnvLocal();
const SEL = randomBytes(4).toString('hex');
const SECRET = `secret-d-essai-des-abonnements-pousses-${SEL}`;
const vapid = genererClesVapid(); // paire éphémère : jamais écrite, perdue à la fin du test
const cfg = { ...lireConfig(), PUSH_FENETRE_REGROUPEMENT_S: 0, PUSH_DELAI_REPRISE_S: 1 };
let admin: pg.Client;
let app: AccesBd;
let c: Pick<Contexte, 'bd' | 'taches' | 'cfg'>;
let sim: SimulateurPoussees;
let etat: EtatPoussees;
let cabinet = '';
const ctx = (utilisateurId: string) => ({ cabinetId: cabinet, utilisateurId, sujet: utilisateurId });

/** Abonne un appareil simulé pour une personne, par la fonction de la base (comme le fait l'API). */
async function abonner(utilisateurId: string, etatChiffrement: EtatPoussees = etat): Promise<{ id: string; appareil: AbonnementSimule }> {
  const appareil = sim.abonner(vapid.publique);
  const empreinte = empreintePointAcces(appareil.endpoint);
  const secrets = chiffrerAbonnement(etatChiffrement, { endpoint: appareil.endpoint, p256dh: appareil.keys.p256dh, auth: appareil.keys.auth }, associeAbonnement(cabinet, utilisateurId, empreinte));
  const id = await app.avecContexte(ctx(utilisateurId), async (tx) => ((await tx.execute(sql`select abonnement_pousse_enregistrer(${empreinte}, 'simulateur', ${secrets}, 'Chrome sur Android') as id`)).rows[0] as { id: string }).id);
  return { id, appareil };
}
/** Notification interne RÉELLE (fonction notifier de la base), émise par `auteur` pour `destinataire`. */
const notifier = (auteur: string, destinataire: string, type: string) =>
  app.avecContexte(ctx(auteur), (tx) => tx.execute(sql`select notifier(${`{${destinataire}}`}::uuid[], ${type}, null::uuid, 'document', ${`piece-${SEL}`}, ${JSON.stringify({ nomFichier: `facture-${SEL}.pdf`, montant: '1234.56' })}::jsonb)`));
const envois = async (destinataire: string) => (await admin.query('select id, type, nombre, traite_le, issue, appareils from envois_pousses where cabinet_id = $1 and destinataire_id = $2 order by cree_le, id', [cabinet, destinataire])).rows;
const abonnements = async (utilisateur: string) => (await admin.query('select id, echecs, dernier_succes_le, dernier_echec_le from abonnements_pousses where cabinet_id = $1 and utilisateur_id = $2 order by cree_le, id', [cabinet, utilisateur])).rows;
const audit = async () => (await admin.query(`select action, acteur_type, cible_id, details from journal_audit where cabinet_id = $1 and action like 'notification_poussee.%' order by id`, [cabinet])).rows;
const enFile = async () => (await c.taches.pousses.getJobs(['waiting', 'delayed', 'prioritized', 'active'])).filter((j) => j.data.cabinetId === cabinet);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  app = creerAccesBd(urlBd('app'), { max: 2 });
  sim = await demarrerSimulateurPoussees();
  etat = notificationsPoussees({ PUSH_VAPID_CLE_PUBLIQUE: vapid.publique, PUSH_VAPID_CLE_PRIVEE: vapid.privee, PUSH_VAPID_SUJET: 'mailto:essai@editeur.example', PUSH_SIMULATEUR_URL: sim.origine, JETONS_CLE_CHIFFREMENT: SECRET, NODE_ENV: 'test' });
  c = { cfg, bd: creerAccesBd(urlBd('worker'), { max: 4 }), taches: new Files(connexionRedis(cfg.REDIS_URL), `essai-poussees-${SEL}`) };
  cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai notifications poussées ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(admin, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await admin.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
});

beforeEach(async () => {
  await admin.query('delete from envois_pousses where cabinet_id = $1', [cabinet]);
  await admin.query('delete from abonnements_pousses where cabinet_id = $1', [cabinet]);
  await admin.query(`delete from preferences_notification where cabinet_id = $1`, [cabinet]);
  await c.taches.pousses.obliterate({ force: true }).catch(() => undefined);
  sim.messages.length = 0;
  sim.refus.length = 0;
});

afterAll(async () => {
  await admin.query('delete from envois_pousses where cabinet_id = $1', [cabinet]);
  await admin.query('delete from abonnements_pousses where cabinet_id = $1', [cabinet]);
  await admin.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await c.taches.pousses.obliterate({ force: true }).catch(() => undefined);
  await c.taches.fermer();
  await c.bd.fermer();
  await app.fermer();
  await sim.arreter();
  await admin.end();
});

describe('droits en base : chacun les siens, écritures minimales', () => {
  it('l’application ne lit que les abonnements de l’appelant, ne les écrit que par la fonction, et n’a aucun accès à la file des envois', async () => {
    const a = await abonner(DEMO.client);
    const lus = (qui: string) => app.avecContexte(ctx(qui), async (tx) => (await tx.execute(sql`select id from abonnements_pousses`)).rows.map((r) => r.id));
    expect(await lus(DEMO.client)).toEqual([a.id]);
    expect(await lus(DEMO.alice)).toEqual([]); // l'administratrice du cabinet ne voit pas l'appareil d'un autre
    expect(await app.avecContexte({ cabinetId: DEMO.cabinetB, utilisateurId: DEMO.bruno, sujet: DEMO.bruno }, async (tx) => (await tx.execute(sql`select id from abonnements_pousses where id = ${a.id}::uuid`)).rowCount)).toBe(0);
    // Une autre personne ne peut pas retirer cet appareil ; la sienne, oui.
    expect(await app.avecContexte(ctx(DEMO.alice), async (tx) => (await tx.execute(sql`delete from abonnements_pousses where id = ${a.id}::uuid`)).rowCount)).toBe(0);
    await expect(app.avecContexte(ctx(DEMO.client), (tx) => tx.execute(sql`insert into abonnements_pousses (cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent) values (${cabinet}::uuid, ${DEMO.client}::uuid, ${'a'.repeat(64)}, 'fcm', 'a1.k.a.b.c', 'x')`))).rejects.toThrow();
    await expect(app.avecContexte(ctx(DEMO.client), (tx) => tx.execute(sql`update abonnements_pousses set secrets_chiffres = 'a1.k.a.b.c'`))).rejects.toThrow();
    for (const requete of [sql`select 1 from envois_pousses`, sql`insert into envois_pousses (cabinet_id, destinataire_id, type) values (${cabinet}::uuid, ${DEMO.client}::uuid, 'x.y')`, sql`delete from envois_pousses`]) {
      await expect(app.avecContexte(ctx(DEMO.client), (tx) => tx.execute(requete))).rejects.toThrow();
    }
    expect(await app.avecContexte(ctx(DEMO.client), async (tx) => (await tx.execute(sql`delete from abonnements_pousses where id = ${a.id}::uuid`)).rowCount)).toBe(1);
  });

  it('le worker lit dans le cabinet de la tâche, ne crée rien, ne modifie ni les secrets d’un abonnement ni le contenu d’un envoi', async () => {
    const a = await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const dans = { cabinetId: cabinet };
    expect(await c.bd.avecContexte(dans, async (tx) => (await tx.execute(sql`select id from abonnements_pousses`)).rowCount)).toBe(1);
    expect(await c.bd.avecContexte({ cabinetId: DEMO.cabinetB }, async (tx) => (await tx.execute(sql`select id from abonnements_pousses where id = ${a.id}::uuid`)).rowCount)).toBe(0);
    expect(await c.bd.avecContexte({}, async (tx) => (await tx.execute(sql`select id from envois_pousses`)).rowCount)).toBe(0);
    for (const requete of [
      sql`insert into abonnements_pousses (cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent) values (${cabinet}::uuid, ${DEMO.client}::uuid, ${'b'.repeat(64)}, 'fcm', 'a1.k.a.b.c', 'x')`,
      sql`update abonnements_pousses set secrets_chiffres = 'a1.k.a.b.c'`,
      sql`update abonnements_pousses set utilisateur_id = ${DEMO.alice}::uuid`,
      sql`insert into envois_pousses (cabinet_id, destinataire_id, type) values (${cabinet}::uuid, ${DEMO.client}::uuid, 'x.y')`,
      sql`update envois_pousses set type = 'autre.type'`,
      sql`update envois_pousses set destinataire_id = ${DEMO.alice}::uuid`,
      sql`delete from envois_pousses`,
      sql`select abonnement_pousse_enregistrer(${'c'.repeat(64)}, 'fcm', 'a1.k.a.b.c', 'x')`,
    ]) {
      await expect(c.bd.avecContexte(dans, (tx) => tx.execute(requete))).rejects.toThrow();
    }
  });

  it('un appareil n’est abonné que pour un compte à la fois ; dix appareils au plus par personne ; formes contrôlées', async () => {
    const a = await abonner(DEMO.client);
    const empreinte = empreintePointAcces(a.appareil.endpoint);
    // Le même appareil est abonné par une autre personne (changement de compte sur le même navigateur).
    await app.avecContexte(ctx(DEMO.chloe), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${empreinte}, 'simulateur', 'a1.k.a.b.c', 'Chrome sur Android')`));
    expect(await abonnements(DEMO.client)).toEqual([]);
    expect(await abonnements(DEMO.chloe)).toHaveLength(1);
    // Rejouer pour le même appareil met à jour la même ligne.
    await app.avecContexte(ctx(DEMO.chloe), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${empreinte}, 'simulateur', 'a1.k.a.b.d', 'Firefox sur Windows')`));
    expect(await abonnements(DEMO.chloe)).toHaveLength(1);
    for (let i = 0; i < 9; i++) await app.avecContexte(ctx(DEMO.chloe), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${randomBytes(32).toString('hex')}, 'simulateur', 'a1.k.a.b.c', 'x')`));
    expect(await abonnements(DEMO.chloe)).toHaveLength(10);
    await expect(app.avecContexte(ctx(DEMO.chloe), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${randomBytes(32).toString('hex')}, 'simulateur', 'a1.k.a.b.c', 'x')`))).rejects.toThrow();
    for (const [e, service, secrets] of [['pas-une-empreinte', 'simulateur', 'a1.k.a.b.c'], [randomBytes(32).toString('hex'), 'service-inconnu', 'a1.k.a.b.c'], [randomBytes(32).toString('hex'), 'simulateur', 'https://fcm.googleapis.com/fcm/send/en-clair']] as const) {
      await expect(app.avecContexte(ctx(DEMO.alice), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${e}, ${service}, ${secrets}, 'x')`)), e).rejects.toThrow();
    }
    // Hors d'un cabinet dont on est membre actif : refusé.
    await expect(app.avecContexte({ cabinetId: cabinet, utilisateurId: DEMO.bruno, sujet: DEMO.bruno }, (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${randomBytes(32).toString('hex')}, 'simulateur', 'a1.k.a.b.c', 'x')`))).rejects.toThrow();
  });
});

describe('mise en file par la base à la création d’une notification interne', () => {
  it('sans appareil abonné : rien ; avec : UN envoi en attente par destinataire, regroupé, sans aucune donnée de la notification', async () => {
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    expect(await envois(DEMO.client)).toEqual([]);
    await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    let lignes = await envois(DEMO.client);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ type: 'document.complement_demande', nombre: 2, traite_le: null, issue: null });
    await notifier(DEMO.chloe, DEMO.client, 'import.termine');
    lignes = await envois(DEMO.client);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ type: 'mixte', nombre: 3 });
    // La ligne ne porte ni la cible, ni les données de la notification interne.
    const brut = JSON.stringify((await admin.query('select * from envois_pousses where cabinet_id = $1', [cabinet])).rows);
    for (const interdit of [`piece-${SEL}`, `facture-${SEL}`, '1234.56']) expect(brut).not.toContain(interdit);
    // Les autres membres, non abonnés ou non concernés, n'ont rien.
    expect(await envois(DEMO.alice)).toEqual([]);
    expect(await envois(DEMO.chloe)).toEqual([]);
  });

  it('préférence globale coupée : la notification interne est créée, aucun envoi n’est mis en file ; famille désactivée : ni l’une ni l’autre', async () => {
    await abonner(DEMO.client);
    const internes = async () => Number((await admin.query('select count(*)::int as n from notifications where cabinet_id = $1 and destinataire_id = $2', [cabinet, DEMO.client])).rows[0].n);
    const avant = await internes();
    await admin.query(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'poussees', false)`, [cabinet, DEMO.client]);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    expect(await internes()).toBe(avant + 1);
    expect(await envois(DEMO.client)).toEqual([]);
    await admin.query(`update preferences_notification set active = true where cabinet_id = $1 and utilisateur_id = $2 and famille = 'poussees'`, [cabinet, DEMO.client]);
    await admin.query(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'document', false)`, [cabinet, DEMO.client]);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    expect(await internes()).toBe(avant + 1);
    expect(await envois(DEMO.client)).toEqual([]);
    await notifier(DEMO.chloe, DEMO.client, 'import.termine'); // une autre famille reste notifiée et poussée
    expect(await envois(DEMO.client)).toHaveLength(1);
  });
});

describe('relevé et distribution', () => {
  it('fenêtre de regroupement respectée ; une tâche par appareil, identifiants seuls ; rejouer ne duplique rien', async () => {
    const un = await abonner(DEMO.client);
    const deux = await abonner(DEMO.client);
    await abonner(DEMO.alice); // non concernée
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const [envoi] = await envois(DEMO.client);
    const aDistribuer = async (fenetre: number) => (await c.bd.pool.query('select * from worker_envois_pousses_a_distribuer($1, 1000)', [fenetre])).rows.map((r) => r.envoi_id);
    expect(await aDistribuer(60)).not.toContain(envoi.id); // encore dans la fenêtre : il attend d'éventuelles autres notifications
    expect(await aDistribuer(0)).toContain(envoi.id);
    // Le relevé ne distribue pas quand la fonction n'est pas configurée.
    expect(await releverEnvoisPousses(c, notificationsPoussees({ PUSH_VAPID_CLE_PUBLIQUE: '', PUSH_VAPID_CLE_PRIVEE: '', PUSH_VAPID_SUJET: '', PUSH_SIMULATEUR_URL: '', JETONS_CLE_CHIFFREMENT: '' }))).toEqual({ envois: 0, livraisons: 0, ignores: 0 });
    expect((await envois(DEMO.client))[0].traite_le).toBeNull();

    expect(await distribuerEnvoi(c, cabinet, envoi.id)).toBe(2);
    expect((await envois(DEMO.client))[0]).toMatchObject({ issue: 'distribue', appareils: 2 });
    const taches = await enFile();
    expect(taches.map((j) => j.data.abonnementId).sort()).toEqual([un.id, deux.id].sort());
    for (const j of taches) {
      expect(j.name).toBe('livrer');
      expect(Object.keys(j.data).sort()).toEqual(['abonnementId', 'cabinetId', 'envoiId']); // ni point d'accès, ni clé, ni texte
      expect(j.opts).toMatchObject({ attempts: TENTATIVES_POUSSEE, backoff: { type: 'exponential', delay: 1000 } });
    }
    // Déjà traité : une seconde distribution ne fait rien ; un envoi inconnu non plus.
    expect(await distribuerEnvoi(c, cabinet, envoi.id)).toBe(0);
    expect(await enFile()).toHaveLength(2);
    expect(await aDistribuer(0)).not.toContain(envoi.id);
  });

  it('préférence coupée pendant la fenêtre, appareil retiré entre-temps, envoi trop ancien : aucun envoi, issue consignée', async () => {
    const a = await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    await admin.query(`insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values ($1, $2, 'poussees', false)`, [cabinet, DEMO.client]);
    expect(await distribuerEnvoi(c, cabinet, (await envois(DEMO.client))[0].id)).toBe(0);
    expect((await envois(DEMO.client))[0]).toMatchObject({ issue: 'preference_desactivee', appareils: 0 });

    await admin.query(`delete from preferences_notification where cabinet_id = $1`, [cabinet]);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    await admin.query('delete from abonnements_pousses where id = $1', [a.id]);
    expect(await distribuerEnvoi(c, cabinet, (await envois(DEMO.client))[1].id)).toBe(0);
    expect((await envois(DEMO.client))[1]).toMatchObject({ issue: 'sans_abonnement', appareils: 0 });

    await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const ancien = (await envois(DEMO.client))[2];
    await admin.query(`update envois_pousses set cree_le = now() - interval '25 hours' where id = $1`, [ancien.id]);
    expect(await distribuerEnvoi(c, cabinet, ancien.id)).toBe(0);
    expect((await envois(DEMO.client)).find((e) => e.id === ancien.id)).toMatchObject({ issue: 'perime', appareils: 0 }); // l'ordre par date a changé : recherche par identifiant
    expect(await enFile()).toEqual([]);
    expect(sim.messages).toEqual([]);
  });
});

describe('livraison à un appareil, contre le simulateur', () => {
  /** Notification interne réelle → envoi distribué ; renvoie la tâche de livraison de l'appareil. */
  async function preparer(type = 'document.complement_demande', etatChiffrement: EtatPoussees = etat) {
    const a = await abonner(DEMO.client, etatChiffrement);
    await notifier(DEMO.chloe, DEMO.client, type);
    const envoi = (await envois(DEMO.client)).at(-1)!;
    expect(await distribuerEnvoi(c, cabinet, envoi.id)).toBe(1);
    return { a, envoi, tache: { cabinetId: cabinet, envoiId: envoi.id as string, abonnementId: a.id } };
  }

  it('accepté : le simulateur déchiffre une charge qui ne dit rien de la notification interne ; la date est notée', async () => {
    const { a, envoi, tache } = await preparer();
    expect(await livrerPoussee(c, etat, tache)).toBe('accepte');
    expect(sim.refus).toEqual([]);
    expect(sim.messages).toHaveLength(1);
    const m = sim.messages[0]!;
    expect(m.endpoint).toBe(a.appareil.endpoint);
    expect(m.clair).toBe(`{"v":1,"t":"complement","i":"${envoi.id}"}`);
    for (const interdit of [`piece-${SEL}`, `facture-${SEL}`, '1234.56', cabinet, DEMO.client, DEMO.chloe, 'document']) expect(m.clair).not.toContain(interdit);
    expect(m.enTetes).toMatchObject({ ttl: '86400', topic: 'comtaple-complement', contentEncoding: 'aes128gcm' });
    const [ligne] = await abonnements(DEMO.client);
    expect(ligne.dernier_succes_le).not.toBeNull();
    expect(ligne.echecs).toBe(0);
    // Envois regroupés de types différents : type générique « plusieurs ».
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    await notifier(DEMO.chloe, DEMO.client, 'import.termine');
    const mixte = (await envois(DEMO.client)).at(-1)!;
    await distribuerEnvoi(c, cabinet, mixte.id);
    expect(await livrerPoussee(c, etat, { ...tache, envoiId: mixte.id })).toBe('accepte');
    expect(sim.messages[1]!.clair).toBe(`{"v":1,"t":"plusieurs","i":"${mixte.id}"}`);
  });

  it('404 ou 410 du service : l’abonnement est retiré et le retrait journalisé, sans point d’accès ni clé', async () => {
    for (const statut of [410, 404]) {
      const { a, tache } = await preparer();
      if (statut === 410) sim.revoquer(a.appareil.endpoint);
      else sim.forcer(a.appareil.endpoint, 404);
      expect(await livrerPoussee(c, etat, tache)).toBe('abonnement_retire');
      expect(await abonnements(DEMO.client)).toEqual([]);
      const trace = (await audit()).at(-1)!;
      expect(trace).toMatchObject({ action: 'notification_poussee.appareil_retire', acteur_type: 'systeme', cible_id: a.id, details: { service: 'simulateur', par: 'service', motif: 'perime', statut } });
      expect(JSON.stringify(trace)).not.toContain(a.appareil.endpoint.split('/').pop()!);
      expect(JSON.stringify(trace)).not.toContain(a.appareil.keys.auth);
      // Rejouée (abonnement disparu) : sans effet.
      expect(await livrerPoussee(c, etat, tache)).toBe('abonnement_absent');
      // Plus d'appareil : la notification interne suivante ne met rien en file.
      const n = (await envois(DEMO.client)).length;
      await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
      expect(await envois(DEMO.client)).toHaveLength(n);
    }
    expect(sim.messages).toEqual([]);
  });

  it('erreur temporaire (429, 503) : à rejouer, avec bornes — abandon à la dernière tentative, l’abonnement est conservé', async () => {
    const { a, tache } = await preparer();
    sim.forcer(a.appareil.endpoint, 503, 429, 500, 502);
    for (let numero = 1; numero < TENTATIVES_POUSSEE; numero++) {
      const erreur = await livrerPoussee(c, etat, tache, { numero }).catch((e) => e);
      expect(erreur).toBeInstanceOf(LivraisonARejouer);
      expect(erreur.message).toMatch(/HTTP (503|429|500|502)/);
      expect(erreur.message).not.toContain(sim.origine); // le message d'erreur (journalisé par le worker) ne porte pas l'adresse
    }
    sim.forcer(a.appareil.endpoint, 503);
    expect(await livrerPoussee(c, etat, tache, { numero: TENTATIVES_POUSSEE })).toBe('abandonne');
    const [ligne] = await abonnements(DEMO.client);
    expect(ligne).toMatchObject({ id: a.id, echecs: 0 });
    expect(ligne.dernier_echec_le).not.toBeNull();
    expect(sim.messages).toEqual([]);
    // Le service répond de nouveau : la livraison suivante aboutit.
    expect(await livrerPoussee(c, etat, tache)).toBe('accepte');
    expect(sim.messages).toHaveLength(1);
  });

  it('refus répétés du service : comptés, puis l’abonnement est retiré ; un succès remet le compteur à zéro', async () => {
    const { a, tache } = await preparer();
    sim.forcer(a.appareil.endpoint, 400, 403);
    expect(await livrerPoussee(c, etat, tache)).toBe('refuse');
    expect(await livrerPoussee(c, etat, tache)).toBe('refuse');
    expect((await abonnements(DEMO.client))[0].echecs).toBe(2);
    expect(await livrerPoussee(c, etat, tache)).toBe('accepte');
    expect((await abonnements(DEMO.client))[0].echecs).toBe(0);
    sim.forcer(a.appareil.endpoint, ...Array.from({ length: REFUS_MAX_ABONNEMENT }, () => 403));
    for (let i = 1; i < REFUS_MAX_ABONNEMENT; i++) expect(await livrerPoussee(c, etat, tache)).toBe('refuse');
    expect(await livrerPoussee(c, etat, tache)).toBe('abonnement_retire');
    expect(await abonnements(DEMO.client)).toEqual([]);
    expect((await audit()).at(-1)).toMatchObject({ details: { motif: 'refus_repetes', statut: 403 } });
  });

  it('abonnement indéchiffrable (autre secret) ou destination non admise : rien n’est émis', async () => {
    const autreSecret = notificationsPoussees({ PUSH_VAPID_CLE_PUBLIQUE: vapid.publique, PUSH_VAPID_CLE_PRIVEE: vapid.privee, PUSH_VAPID_SUJET: 'mailto:essai@editeur.example', PUSH_SIMULATEUR_URL: sim.origine, JETONS_CLE_CHIFFREMENT: `${SECRET}-autre`, NODE_ENV: 'test' });
    const illisible = await preparer('document.complement_demande', autreSecret);
    expect(await livrerPoussee(c, etat, illisible.tache)).toBe('abonnement_illisible');
    expect(await abonnements(DEMO.client)).toEqual([]);
    expect((await audit()).at(-1)).toMatchObject({ details: { motif: 'illisible' } });

    // Pile « réelle » (sans simulateur) : l'adresse locale de l'appareil simulé n'est PAS une destination admise.
    const { tache } = await preparer();
    const reel = notificationsPoussees({ PUSH_VAPID_CLE_PUBLIQUE: vapid.publique, PUSH_VAPID_CLE_PRIVEE: vapid.privee, PUSH_VAPID_SUJET: 'mailto:essai@editeur.example', PUSH_SIMULATEUR_URL: '', JETONS_CLE_CHIFFREMENT: SECRET, NODE_ENV: 'test' });
    expect(reel.statut).toBe('configure_non_verifie');
    expect(await livrerPoussee(c, reel, tache)).toBe('refuse');
    expect(sim.messages).toEqual([]);
    expect(sim.refus).toEqual([]);
  });
});

describe('cycle de vie : membre désactivé, accès arrivé à son terme, abonnement inactif', () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const retablir = () => admin.query(`update appartenances set actif = true, expire_le = now() + interval '20 minutes' where cabinet_id = $1 and role <> 'support'`, [cabinet]);
  beforeEach(retablir);
  afterAll(retablir);
  /** Désactivation par une gestionnaire, avec le rôle de l'APPLICATION et son contexte (comme `PATCH v1/cabinet/membres/:id`). */
  const desactiver = (utilisateurId: string) => app.avecContexte(ctx(DEMO.alice), (tx) => tx.execute(sql`update appartenances set actif = false where cabinet_id = ${cabinet}::uuid and utilisateur_id = ${utilisateurId}::uuid`));

  it('désactivation d’un membre : ses abonnements pour CE cabinet sont retirés dans la même transaction et journalisés ; réactivé, rien n’est recréé', async () => {
    const a = await abonner(DEMO.client);
    const b = await abonner(DEMO.client);
    const dAlice = await abonner(DEMO.alice);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande'); // un envoi en attente pour la personne
    // Même transaction : si la désactivation est annulée, les abonnements restent.
    await expect(
      app.avecContexte(ctx(DEMO.alice), async (tx) => {
        await tx.execute(sql`update appartenances set actif = false where cabinet_id = ${cabinet}::uuid and utilisateur_id = ${DEMO.client}::uuid`);
        throw new Error('annulation volontaire');
      }),
    ).rejects.toThrow('annulation volontaire');
    expect(await abonnements(DEMO.client)).toHaveLength(2);

    await desactiver(DEMO.client);
    expect(await abonnements(DEMO.client)).toEqual([]);
    expect((await abonnements(DEMO.alice)).map((x) => x.id)).toEqual([dAlice.id]); // les autres membres ne sont pas touchés
    expect((await envois(DEMO.client))[0]).toMatchObject({ issue: 'destinataire_inactif', appareils: 0 });
    const lignes = (await audit()).filter((l) => l.details.motif === 'membre_desactive');
    expect(lignes.map((l) => l.cible_id).sort()).toEqual([a.id, b.id].sort());
    for (const l of lignes) expect(l).toMatchObject({ action: 'notification_poussee.appareil_retire', acteur_type: 'utilisateur', details: { service: 'simulateur', par: 'systeme', membre: DEMO.client } });
    const brut = JSON.stringify(lignes);
    for (const secret of [a.appareil.endpoint, a.appareil.keys.auth, a.appareil.keys.p256dh, '127.0.0.1']) expect(brut).not.toContain(secret);

    // Désactivée, la personne ne peut pas se réabonner ; réactivée, aucun abonnement ne réapparaît de lui-même.
    await expect(abonner(DEMO.client)).rejects.toThrow();
    await retablir();
    expect(await abonnements(DEMO.client)).toEqual([]);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    expect(await envois(DEMO.client)).toHaveLength(1); // sans appareil abonné, aucun nouvel envoi n'est mis en file
    // Une seconde désactivation (rien à retirer) ne journalise rien de plus.
    await desactiver(DEMO.client);
    expect((await audit()).filter((l) => l.details.motif === 'membre_desactive')).toHaveLength(lignes.length);
  });

  it('course désactivation / livraison déjà en file : rien n’est émis', async () => {
    const a = await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const envoi = (await envois(DEMO.client)).at(-1)!;
    expect(await distribuerEnvoi(c, cabinet, envoi.id)).toBe(1); // la tâche de livraison est en file
    await desactiver(DEMO.client);
    expect(await livrerPoussee(c, etat, { cabinetId: cabinet, envoiId: envoi.id, abonnementId: a.id })).toBe('abonnement_absent');
    expect(sim.messages).toEqual([]);
  });

  it('accès arrivé à son terme sans autre écriture : le worker ne distribue pas, ne livre pas une tâche déjà en file, et retire l’abonnement', async () => {
    const a = await abonner(DEMO.client);
    const autre = await abonner(DEMO.client);
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const premier = (await envois(DEMO.client)).at(-1)!;
    expect(await distribuerEnvoi(c, cabinet, premier.id)).toBe(2); // deux tâches en file, appartenance encore active
    await notifier(DEMO.chloe, DEMO.client, 'document.complement_demande');
    const second = (await envois(DEMO.client)).at(-1)!;
    // L'appartenance expire d'elle-même (aucun déclencheur ne s'exécute : l'échéance posée est encore dans le futur).
    await admin.query(`update appartenances set expire_le = now() + interval '1 second' where cabinet_id = $1 and utilisateur_id = $2`, [cabinet, DEMO.client]);
    expect(await abonnements(DEMO.client)).toHaveLength(2);
    await pause(1300);

    // Garde-fou à la distribution : l'envoi en attente est clos sans tâche.
    const avant = (await enFile()).length;
    expect(await distribuerEnvoi(c, cabinet, second.id)).toBe(0);
    expect((await envois(DEMO.client)).find((e) => e.id === second.id)).toMatchObject({ issue: 'destinataire_inactif', appareils: 0 });
    expect(await enFile()).toHaveLength(avant);
    // Garde-fou à la livraison : la tâche déjà en file n'émet rien, et l'abonnement est retiré, retrait journalisé.
    expect(await livrerPoussee(c, etat, { cabinetId: cabinet, envoiId: premier.id, abonnementId: a.id })).toBe('destinataire_inactif');
    expect(sim.messages).toEqual([]);
    expect((await abonnements(DEMO.client)).map((x) => x.id)).toEqual([autre.id]);
    expect((await audit()).at(-1)).toMatchObject({ acteur_type: 'systeme', cible_id: a.id, details: { par: 'systeme', motif: 'appartenance_inactive', statut: null } });
    // L'entretien périodique retire ce qui reste.
    const bilan = await entretenirAbonnementsPousses(c);
    expect(bilan.appartenanceInactive).toBeGreaterThanOrEqual(1);
    expect(await abonnements(DEMO.client)).toEqual([]);
    expect((await audit()).at(-1)).toMatchObject({ acteur_type: 'systeme', cible_id: autre.id, details: { service: 'simulateur', par: 'systeme', motif: 'appartenance_inactive', membre: DEMO.client } });
  });

  it('fin d’un accès support temporaire (outil de l’éditeur) : abonnements retirés avec la fermeture', async () => {
    const sujet = `support-poussees-${SEL}`;
    const { utilisateurId } = await ouvrirAccesSupport(admin, { cabinetId: cabinet, sujetOidc: sujet, email: `support-${SEL}@editeur.example`, nom: 'Support (fictif)', heures: 1, motif: 'Essai du retrait des abonnements' });
    const a = await abonner(utilisateurId);
    expect(await abonnements(utilisateurId)).toHaveLength(1);
    await fermerAccesSupport(admin, cabinet, utilisateurId);
    expect(await abonnements(utilisateurId)).toEqual([]);
    expect((await audit()).find((l) => l.cible_id === a.id && l.action === 'notification_poussee.appareil_retire')).toMatchObject({ acteur_type: 'systeme', details: { par: 'systeme', motif: 'membre_desactive', membre: utilisateurId } });
    await admin.query('delete from appartenances where cabinet_id = $1 and utilisateur_id = $2', [cabinet, utilisateurId]);
  });

  it('abonnement inactif plus longtemps que PUSH_INACTIVITE_MAX_JOURS : retiré par le worker et journalisé ; une confirmation ou un envoi accepté le garde', async () => {
    expect(cfg.PUSH_INACTIVITE_MAX_JOURS).toBe(180);
    const vieux = await abonner(DEMO.client);
    const confirme = await abonner(DEMO.client);
    const servi = await abonner(DEMO.client);
    const recent = await abonner(DEMO.alice);
    const ancien = `now() - interval '181 days'`;
    await admin.query(`update abonnements_pousses set cree_le = ${ancien}, confirme_le = ${ancien} where id = any($1)`, [[vieux.id, confirme.id, servi.id]]);
    await admin.query(`update abonnements_pousses set dernier_succes_le = now() - interval '10 days' where id = $1`, [servi.id]);
    // L'appareil « confirme » se réabonne (même point d'accès) : la date de confirmation est rafraîchie par la fonction.
    const empreinte = empreintePointAcces(confirme.appareil.endpoint);
    const secrets = chiffrerAbonnement(etat, { endpoint: confirme.appareil.endpoint, p256dh: confirme.appareil.keys.p256dh, auth: confirme.appareil.keys.auth }, associeAbonnement(cabinet, DEMO.client, empreinte));
    await app.avecContexte(ctx(DEMO.client), (tx) => tx.execute(sql`select abonnement_pousse_enregistrer(${empreinte}, 'simulateur', ${secrets}, 'Chrome sur Android')`));

    const bilan = await entretenirAbonnementsPousses(c);
    expect(bilan.inactivite).toBeGreaterThanOrEqual(1);
    expect((await abonnements(DEMO.client)).map((x) => x.id).sort()).toEqual([confirme.id, servi.id].sort());
    expect((await abonnements(DEMO.alice)).map((x) => x.id)).toEqual([recent.id]);
    expect((await audit()).filter((l) => l.details.motif === 'inactivite')).toMatchObject([{ action: 'notification_poussee.appareil_retire', acteur_type: 'systeme', cible_id: vieux.id, details: { service: 'simulateur', par: 'systeme', jours: 180, membre: DEMO.client } }]);
    // Rejouable : un second passage ne retire rien de plus dans ce cabinet.
    await entretenirAbonnementsPousses(c);
    expect(await abonnements(DEMO.client)).toHaveLength(2);
    // Plancher de la fonction : une valeur absurde (1 jour) ne vide pas la table — 30 jours au moins.
    await admin.query(`update abonnements_pousses set cree_le = now() - interval '20 days', confirme_le = now() - interval '20 days', dernier_succes_le = null where id = $1`, [servi.id]);
    await c.bd.pool.query('select * from worker_abonnements_pousses_entretenir(1)');
    expect(await abonnements(DEMO.client)).toHaveLength(2);
    // Le rôle de l'application ne peut pas lancer l'entretien.
    await expect(app.avecContexte(ctx(DEMO.alice), (tx) => tx.execute(sql`select * from worker_abonnements_pousses_entretenir(180)`))).rejects.toThrow();
  });
});
