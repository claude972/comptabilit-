/**
 * Rotation de `JETONS_CLE_CHIFFREMENT` : rechiffrement des jetons de la collecte par mail et des abonnements aux
 * notifications poussées par l'outil de l'éditeur (`rechiffrerSecrets`). PostgreSQL réel, rôle d'administration, cabinet
 * NEUF à chaque exécution et passage RESTREINT à ce cabinet : aucune autre ligne de la base n'est lue ni modifiée. Les
 * secrets, jetons et points d'accès sont fictifs, créés ici et perdus à la fin.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { chargerEnvLocal } from '@comtaple/db/env';
import { chiffrerJetons, dechiffrerJetons } from '@comtaple/mail';
import { associeAbonnement, chiffrerAbonnement, clesMail, clesReposAbonnements, dechiffrerAbonnement, empreintePointAcces, rechiffrerSecrets } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

chargerEnvLocal();
const SEL = randomBytes(4).toString('hex');
const ANCIEN = `ancien-secret-de-chiffrement-d-essai-${SEL}-0001`;
const NOUVEAU = `nouveau-secret-de-chiffrement-d-essai-${SEL}-0002`;
const ETRANGER = `secret-jamais-configure-d-essai-${SEL}-0003`;
const AVANT = { JETONS_CLE_CHIFFREMENT: ANCIEN };
const BASCULE = { JETONS_CLE_CHIFFREMENT: NOUVEAU, JETONS_CLES_ANCIENNES: ANCIEN };
const RETOUR = { JETONS_CLE_CHIFFREMENT: ANCIEN, JETONS_CLES_ANCIENNES: NOUVEAU };
const APRES = { JETONS_CLE_CHIFFREMENT: NOUVEAU };
let admin: pg.Client;
let cabinet = '';
let autreCabinet = '';

interface Connexion {
  id: string;
  jetons: { jetonAcces: string; expireLe: string; jetonRafraichissement: string | null; scopes: string[]; etatClient: string };
}
interface Abonnement {
  id: string;
  empreinte: string;
  secrets: { endpoint: string; p256dh: string; auth: string };
}
let connexions: Connexion[] = [];
let abonnes: Abonnement[] = [];

const etatDe = (cfg: { JETONS_CLE_CHIFFREMENT: string; JETONS_CLES_ANCIENNES?: string }) => ({ clesRepos: clesReposAbonnements(cfg) });
const lignes = async (c = cabinet) => ({
  mail: (await admin.query<{ id: string; jetons_chiffres: string }>('select id::text, jetons_chiffres from connexions_mail where cabinet_id = $1 order by id', [c])).rows,
  pousses: (await admin.query<{ id: string; secrets_chiffres: string }>('select id::text, secrets_chiffres from abonnements_pousses where cabinet_id = $1 order by id', [c])).rows,
});
const idCle = (enveloppe: string) => enveloppe.split('.')[1]!;
const idsCles = (cfg: { JETONS_CLE_CHIFFREMENT: string }) => ({ mail: clesMail(cfg)!.trousseau.courante.id, pousses: clesReposAbonnements(cfg)[0]!.id });
/** Tous les clairs relus avec la configuration donnée ; `null` pour une ligne que cette configuration ne déchiffre pas. */
async function clairs(cfg: { JETONS_CLE_CHIFFREMENT: string; JETONS_CLES_ANCIENNES?: string }) {
  const l = await lignes();
  const mail = l.mail.map((x) => {
    try {
      return dechiffrerJetons(x.jetons_chiffres, x.id, clesMail(cfg)!.trousseau);
    } catch {
      return null;
    }
  });
  const pousses = l.pousses.map((x) => {
    const a = abonnes.find((y) => y.id === x.id)!;
    return dechiffrerAbonnement(etatDe(cfg), x.secrets_chiffres, associeAbonnement(cabinet, DEMO.client, a.empreinte));
  });
  return { mail, pousses };
}
const attendus = () => ({ mail: [...connexions].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.jetons), pousses: [...abonnes].sort((a, b) => a.id.localeCompare(b.id)).map((a) => a.secrets) });

async function creerConnexion(c: string, secret: string): Promise<Connexion> {
  const id = randomUUID();
  const jetons = { jetonAcces: `jeton-fictif-${randomBytes(6).toString('hex')}`, expireLe: '2030-01-01T00:00:00.000Z', jetonRafraichissement: `rafraichissement-fictif-${randomBytes(6).toString('hex')}`, scopes: ['lecture'], etatClient: 'etat-fictif' };
  await admin.query(`insert into connexions_mail (id, cabinet_id, fournisseur, adresse, jetons_chiffres) values ($1, $2, 'gmail', $3, $4)`, [id, c, `boite-${id.slice(0, 8)}@exemple.test`, chiffrerJetons(jetons, id, clesMail({ JETONS_CLE_CHIFFREMENT: secret })!.trousseau.courante)]);
  return { id, jetons };
}
async function creerAbonnement(c: string, secret: string): Promise<Abonnement> {
  const id = randomUUID();
  const secrets = { endpoint: `https://fcm.googleapis.com/fcm/send/fictif-${randomBytes(8).toString('hex')}`, p256dh: `B${randomBytes(64).toString('base64url')}`, auth: randomBytes(16).toString('base64url') };
  const empreinte = empreintePointAcces(secrets.endpoint);
  await admin.query(`insert into abonnements_pousses (id, cabinet_id, utilisateur_id, empreinte_point_acces, service, secrets_chiffres, agent) values ($1, $2, $3, $4, 'fcm', $5, 'Chrome sur Android')`, [
    id, c, DEMO.client, empreinte, chiffrerAbonnement(etatDe({ JETONS_CLE_CHIFFREMENT: secret }), secrets, associeAbonnement(c, DEMO.client, empreinte)),
  ]);
  return { id, empreinte, secrets };
}
const vider = async (c: string) => {
  await admin.query('delete from abonnements_pousses where cabinet_id = $1', [c]);
  await admin.query('delete from connexions_mail where cabinet_id = $1', [c]);
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai rotation des secrets ${SEL} (fictif)`])).rows[0].id;
  autreCabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet témoin rotation des secrets ${SEL} (fictif)`])).rows[0].id;
});

beforeEach(async () => {
  await vider(cabinet);
  await vider(autreCabinet);
  connexions = [];
  abonnes = [];
  for (let i = 0; i < 3; i++) connexions.push(await creerConnexion(cabinet, ANCIEN));
  for (let i = 0; i < 4; i++) abonnes.push(await creerAbonnement(cabinet, ANCIEN));
});

afterAll(async () => {
  await vider(cabinet);
  await vider(autreCabinet);
  await admin.end();
});

describe('rotation du secret de chiffrement : rechiffrement par l’outil de l’éditeur', () => {
  it('avant tout rechiffrement, la bascule seule garde tout lisible (anciens secrets en déchiffrement) ; sans l’ancien secret, tout serait perdu', async () => {
    expect(await clairs(BASCULE)).toEqual(attendus());
    const perdu = await clairs(APRES);
    expect([...perdu.mail, ...perdu.pousses].every((x) => x === null)).toBe(true);
  });

  it('SIMULATION (défaut) : compte ce qui serait rechiffré, n’écrit rien', async () => {
    const avant = await lignes();
    const bilan = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet });
    expect(bilan).toMatchObject({ simulation: true, anciensSecretsConfigures: 1, interrompu: false, ancienSecretRetirable: false, clesCourantes: { jetonsMail: idsCles(APRES).mail, abonnementsPousses: idsCles(APRES).pousses } });
    expect(bilan.tables).toEqual([
      { table: 'connexions_mail', lignes: 3, dejaSousCleCourante: 0, rechiffrees: 0, restantes: 3, illisibles: [], echecsVerification: [] },
      { table: 'abonnements_pousses', lignes: 4, dejaSousCleCourante: 0, rechiffrees: 0, restantes: 4, illisibles: [], echecsVerification: [] },
    ]);
    expect(await lignes()).toEqual(avant);
  });

  it('rotation nominale : tout est rechiffré sous le nouveau secret, vérifié, lisible SANS l’ancien ; rejouer ne change rien', async () => {
    const temoin = await creerAbonnement(autreCabinet, ANCIEN);
    const temoinAvant = await lignes(autreCabinet);
    const bilan = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true });
    expect(bilan).toMatchObject({ simulation: false, interrompu: false, ancienSecretRetirable: true });
    expect(bilan.tables.map((t) => [t.table, t.rechiffrees, t.restantes, t.illisibles.length, t.echecsVerification.length])).toEqual([['connexions_mail', 3, 0, 0, 0], ['abonnements_pousses', 4, 0, 0, 0]]);
    const apres = await lignes();
    expect(apres.mail.every((l) => idCle(l.jetons_chiffres) === idsCles(APRES).mail)).toBe(true);
    expect(apres.pousses.every((l) => idCle(l.secrets_chiffres) === idsCles(APRES).pousses)).toBe(true);
    // L'ancien secret peut être retiré de la configuration : tout se lit avec le nouveau seul, à l'identique.
    expect(await clairs(APRES)).toEqual(attendus());
    // L'outil ne touche que le périmètre demandé (ici : ce cabinet).
    expect(await lignes(autreCabinet)).toEqual(temoinAvant);
    expect(temoin.id).toBe(temoinAvant.pousses[0]!.id);

    // Idempotent : un second passage ne réécrit aucune ligne (les chiffrés sont identiques octet pour octet).
    const second = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true });
    expect(second.tables.map((t) => [t.dejaSousCleCourante, t.rechiffrees, t.restantes])).toEqual([[3, 0, 0], [4, 0, 0]]);
    expect(await lignes()).toEqual(apres);
    // Le compte rendu ne porte aucun secret.
    const brut = JSON.stringify([bilan, second]);
    for (const secret of [ANCIEN, NOUVEAU, ...connexions.flatMap((c) => [c.jetons.jetonAcces, c.jetons.jetonRafraichissement!]), ...abonnes.flatMap((a) => [a.secrets.endpoint, a.secrets.auth, a.secrets.p256dh])]) expect(brut).not.toContain(secret);
  });

  it('interruption à mi-chemin puis reprise : l’état mixte reste entièrement lisible, la reprise termine sans rien refaire', async () => {
    const partiel = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true, limite: 4 });
    expect(partiel).toMatchObject({ interrompu: true, ancienSecretRetirable: false });
    expect(partiel.tables.map((t) => [t.rechiffrees, t.restantes])).toEqual([[3, 0], [1, 3]]);
    // Entre les deux passages : des lignes sous chaque secret, toutes lisibles tant que l'ancien est encore configuré…
    const mixte = await lignes();
    expect(new Set(mixte.pousses.map((l) => idCle(l.secrets_chiffres))).size).toBe(2);
    expect(await clairs(BASCULE)).toEqual(attendus());
    // … et l'ancien secret n'est PAS retirable : sans lui, les lignes restantes seraient perdues.
    expect((await clairs(APRES)).pousses.filter((x) => x === null)).toHaveLength(3);

    const reprise = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true });
    expect(reprise).toMatchObject({ interrompu: false, ancienSecretRetirable: true });
    expect(reprise.tables.map((t) => [t.dejaSousCleCourante, t.rechiffrees, t.restantes])).toEqual([[3, 0, 0], [1, 3, 0]]);
    // Les lignes déjà rechiffrées au premier passage n'ont pas été réécrites.
    const fin = await lignes();
    for (const l of mixte.mail) expect(fin.mail.find((x) => x.id === l.id)!.jetons_chiffres).toBe(l.jetons_chiffres);
    expect(await clairs(APRES)).toEqual(attendus());
  });

  it('retour arrière : tant que l’ancien secret est configuré, relancer avec les secrets inversés ramène tout sous l’ancien', async () => {
    await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true, limite: 5 }); // retour arrière depuis un état partiel
    const retour = await rechiffrerSecrets(admin, RETOUR, { cabinetId: cabinet, appliquer: true });
    expect(retour).toMatchObject({ interrompu: false, ancienSecretRetirable: true });
    expect(retour.tables.map((t) => [t.dejaSousCleCourante, t.rechiffrees, t.restantes])).toEqual([[0, 3, 0], [2, 2, 0]]);
    const l = await lignes();
    expect(l.mail.every((x) => idCle(x.jetons_chiffres) === idsCles(AVANT).mail)).toBe(true);
    expect(l.pousses.every((x) => idCle(x.secrets_chiffres) === idsCles(AVANT).pousses)).toBe(true);
    // Lisible avec l'ancien secret SEUL, à l'identique : la configuration d'avant la rotation fonctionne de nouveau.
    expect(await clairs(AVANT)).toEqual(attendus());
    // Et l'aller reste possible ensuite.
    expect((await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true })).ancienSecretRetirable).toBe(true);
    expect(await clairs(APRES)).toEqual(attendus());
  });

  it('ligne illisible (secret jamais configuré, enveloppe altérée) : signalée, JAMAIS écrasée ; le reste est rechiffré ; l’ancien secret n’est pas déclaré retirable', async () => {
    const etrangere = await creerConnexion(cabinet, ETRANGER);
    const etranger = await creerAbonnement(cabinet, ETRANGER);
    // Enveloppe altérée : un abonnement chiffré avec l'ancien secret, dont le chiffré est modifié en base.
    const altere = abonnes[0]!;
    const [version, cle, iv, chiffre, etiquette] = (await lignes()).pousses.find((l) => l.id === altere.id)!.secrets_chiffres.split('.');
    await admin.query('update abonnements_pousses set secrets_chiffres = $2 where id = $1', [altere.id, [version, cle, iv, `${chiffre!.slice(0, -2)}${chiffre!.endsWith('AA') ? 'BB' : 'AA'}`, etiquette].join('.')]);
    const avant = await lignes();
    const brutDe = (l: Awaited<ReturnType<typeof lignes>>, id: string) => l.mail.find((x) => x.id === id)?.jetons_chiffres ?? l.pousses.find((x) => x.id === id)?.secrets_chiffres;

    const simulation = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet });
    expect(simulation.tables.map((t) => [t.restantes, t.illisibles.map((i) => i.id).sort()])).toEqual([[3, [etrangere.id]], [3, [altere.id, etranger.id].sort()]]);
    const bilan = await rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, appliquer: true });
    expect(bilan.ancienSecretRetirable).toBe(false);
    expect(bilan.tables.map((t) => [t.rechiffrees, t.restantes, t.illisibles.map((i) => i.id).sort()])).toEqual([[3, 0, [etrangere.id]], [3, 0, [altere.id, etranger.id].sort()]]);
    // Identifiant de la clé inconnue donné, pour retrouver le secret manquant ; jamais le contenu.
    expect(bilan.tables[0]!.illisibles[0]!.idCle).toBe(idsCles({ JETONS_CLE_CHIFFREMENT: ETRANGER }).mail);
    // Les trois lignes illisibles sont intactes, octet pour octet : rien n'a été écrasé.
    const apres = await lignes();
    for (const id of [etrangere.id, etranger.id, altere.id]) expect(brutDe(apres, id)).toBe(brutDe(avant, id));
    // Si le secret manquant est retrouvé et déclaré, un nouveau passage récupère la ligne ; l'enveloppe altérée reste signalée.
    const recupere = await rechiffrerSecrets(admin, { JETONS_CLE_CHIFFREMENT: NOUVEAU, JETONS_CLES_ANCIENNES: `${ANCIEN},${ETRANGER}` }, { cabinetId: cabinet, appliquer: true });
    expect(recupere.tables.map((t) => [t.rechiffrees, t.illisibles.map((i) => i.id)])).toEqual([[1, []], [1, [altere.id]]]);
    connexions.push(etrangere);
    abonnes.push(etranger);
    const fin = await clairs(APRES);
    expect(fin.mail).toEqual(attendus().mail);
    expect(fin.pousses.filter((x) => x === null)).toHaveLength(1);
  });

  it('secret courant absent ou trop court, périmètre ou limite invalides : refus avant toute lecture', async () => {
    await expect(rechiffrerSecrets(admin, { JETONS_CLE_CHIFFREMENT: '' }, { cabinetId: cabinet, appliquer: true })).rejects.toThrow(/JETONS_CLE_CHIFFREMENT/);
    await expect(rechiffrerSecrets(admin, { JETONS_CLE_CHIFFREMENT: 'trop-court' }, { cabinetId: cabinet })).rejects.toThrow(/JETONS_CLE_CHIFFREMENT/);
    await expect(rechiffrerSecrets(admin, BASCULE, { cabinetId: `x' or '1'='1` })).rejects.toThrow(/cabinet/);
    await expect(rechiffrerSecrets(admin, BASCULE, { cabinetId: cabinet, limite: -1 })).rejects.toThrow(/Limite/);
  });
});
