/**
 * Comptes du fournisseur d'identité en fin de contrat, EXERCÉS RÉELLEMENT contre un royaume Keycloak d'ESSAI (D-099).
 *
 * Le test crée son propre royaume `essai-fin-contrat-<horodatage>` dans le Keycloak local, le déclare « essai » et le
 * supprime à la fin ; la base est une base NEUVE jetable. Le royaume de développement (`comtaple`) n'est jamais visé par
 * une écriture : son nombre de comptes est relevé (lecture) avant et après.
 */
import { randomUUID } from 'node:crypto';
import { appliquerFichesOrphelinesEssai, planComptesFinDeContrat, planFichesOrphelines } from '@comtaple/db/comptes-fin-de-contrat';
import { type BaseJetable, creerBaseJetable } from '@comtaple/db/base-jetable';
import { chargerParametres } from '@comtaple/db/durees-conservation';
import { chargerEnvLocal } from '@comtaple/db/env';
import { OFFRES_DEMO, POLITIQUE_FIN_DE_CONTRAT, definirOffre, ouvrirEssai } from '@comtaple/db/provisionnement';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CompteAFermer, FournisseurIdentiteEssai } from './fournisseur-identite-essai.js';

chargerEnvLocal();
const ROYAUME = `essai-fin-contrat-${Date.now()}`;
const URL_KC = new URL(process.env.OIDC_ISSUER!).origin;
const env = { OIDC_ISSUER: process.env.OIDC_ISSUER, KEYCLOAK_ROYAUME_ESSAI_DECLARE: ROYAUME };

let base: BaseJetable;
let kc: FournisseurIdentiteEssai;
let royaumeCree = false;

/** Lecture seule du royaume de développement (aucune écriture : ce n'est pas la classe d'essai qui l'interroge). */
async function comptesDuRoyaumeDeDev(): Promise<number> {
  const t = await fetch(`${URL_KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KC_ADMIN_USER!, password: process.env.KC_ADMIN_PASSWORD! }) });
  const jeton = ((await t.json()) as { access_token: string }).access_token;
  const r = await fetch(`${URL_KC}/admin/realms/comtaple/users/count`, { headers: { authorization: `Bearer ${jeton}` } });
  return Number(await r.text());
}
const jour = async (decalage: number) => (await base.admin.query<{ d: string }>('select (current_date + $1::int)::text as d', [decalage])).rows[0]!.d;

beforeAll(async () => {
  base = await creerBaseJetable('comptes');
  kc = new FournisseurIdentiteEssai({ url: URL_KC, royaume: ROYAUME, adminUtilisateur: process.env.KC_ADMIN_USER!, adminMotDePasse: process.env.KC_ADMIN_PASSWORD! }, env);
  await kc.creerRoyaume();
  royaumeCree = true;
}, 180_000);

afterAll(async () => {
  if (royaumeCree) await kc.supprimerRoyaume();
  await base?.detruire();
  if (royaumeCree && (await kc.royaumeExiste())) throw new Error('Royaume d’essai non supprimé');
});

describe('comptes du fournisseur d’identité : plan puis exécution dans un royaume d’essai', () => {
  it('désactive puis supprime les seuls comptes sans autre appartenance, aux dates paramétrées ; épargne tout le reste ; idempotent', async () => {
    const devAvant = await comptesDuRoyaumeDeDev();
    const { admin } = base;
    for (const o of OFFRES_DEMO) await definirOffre(admin, o);
    const cab = async (nom: string) => (await admin.query<{ id: string }>('insert into cabinets (nom) values ($1) returning id', [`${nom} ${randomUUID().slice(0, 6)}`])).rows[0]!.id;
    const A = await cab('Cabinet résilié');
    const B = await cab('Autre cabinet');
    await ouvrirEssai(admin, A, OFFRES_DEMO[0]!.code, await jour(0));
    await admin.query(`update abonnements set statut = 'resilie', debut = current_date - 400, fin = current_date - 100 where cabinet_id = $1`, [A]);

    // Comptes : à la fois dans Keycloak (royaume d'essai) et dans la table « utilisateurs » (sujet = identifiant Keycloak).
    const creer = async (nom: string, membres: string[], emailKc?: string) => {
      const email = `${nom}-${randomUUID().slice(0, 6)}@exemple.test`;
      const sujet = await kc.creerUtilisateur(`${nom}-${randomUUID().slice(0, 6)}`, emailKc ?? email);
      const id = (await admin.query<{ id: string }>('insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) returning id', [sujet, email, nom])).rows[0]!.id;
      for (const m of membres) await admin.query(`insert into appartenances (cabinet_id, utilisateur_id, role) values ($1, $2, 'collaborateur')`, [m, id]);
      return { id, sujet, email };
    };
    const seul = await creer('seul', [A]);
    const seul2 = await creer('seul-deux', [A]);
    const partage = await creer('partage', [A, B]);
    const douteux = await creer('douteux', [A], `autre-${randomUUID().slice(0, 6)}@exemple.test`); // e-mail différent dans Keycloak
    const passant = await kc.creerUtilisateur(`passant-${randomUUID().slice(0, 6)}`, `passant-${randomUUID().slice(0, 6)}@exemple.test`); // ni dans la base, ni dans le plan
    const kcAvant = (await kc.lister()).map((u) => `${u.id}:${u.enabled}`).sort();
    expect(kcAvant).toHaveLength(5);

    const chargees = chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories);
    const plan = await planComptesFinDeContrat(admin, A, chargees);
    expect(plan.comptes.map((c) => c.utilisateurId).sort()).toEqual([seul.id, seul2.id, douteux.id].sort());
    expect(plan.comptesConserves.map((c) => c.utilisateurId)).toEqual([partage.id]);
    const aFermer: CompteAFermer[] = plan.comptes.map((c) => ({ sujetOidc: c.sujetOidc, email: c.email, desactiverLe: c.desactiverLe, supprimerLe: c.supprimerLe }));
    // fin = il y a 100 jours, grâce 90 → désactivation il y a 10 jours ; suppression 30 jours après la désactivation → dans 20 jours.
    expect(aFermer[0]).toMatchObject({ desactiverLe: await jour(-10), supprimerLe: await jour(20) });

    // 1. SIMULATION : aucun changement dans Keycloak, même « aujourd'hui » après la suppression.
    const sim = await kc.appliquerPlan(aFermer, { appliquer: false, aujourdhui: await jour(30) });
    expect(sim.filter((l) => l.action === 'supprimer')).toHaveLength(2);
    expect((await kc.lister()).map((u) => `${u.id}:${u.enabled}`).sort()).toEqual(kcAvant);

    // 2. Aujourd'hui (-10 j passés) : désactivation due, suppression pas encore.
    const j1 = await kc.appliquerPlan(aFermer, { appliquer: true, aujourdhui: await jour(0) });
    const parSujet = new Map(j1.map((l) => [l.sujetOidc, l]));
    expect(parSujet.get(seul.sujet)).toMatchObject({ avant: 'actif', action: 'desactiver', apres: 'desactive' });
    expect(parSujet.get(seul2.sujet)).toMatchObject({ action: 'desactiver', apres: 'desactive' });
    expect(parSujet.get(douteux.sujet)).toMatchObject({ action: 'ignore_identite_differente', apres: 'actif' });
    expect(await kc.etat(seul.sujet)).toBe('desactive');
    expect(await kc.etat(partage.sujet)).toBe('actif');
    expect(await kc.etat(passant)).toBe('actif');
    expect(await kc.etat(douteux.sujet)).toBe('actif');
    // Idempotence de la désactivation : rejouée, plus rien à faire.
    expect((await kc.appliquerPlan(aFermer, { appliquer: true, aujourdhui: await jour(0) })).filter((l) => l.action === 'desactiver')).toHaveLength(0);

    // 3. Après la date de suppression : suppression ; le compte douteux, le partagé et le passant subsistent.
    const j2 = await kc.appliquerPlan(aFermer, { appliquer: true, aujourdhui: await jour(21) });
    expect(j2.filter((l) => l.action === 'supprimer' && l.apres === 'absent').map((l) => l.sujetOidc).sort()).toEqual([seul.sujet, seul2.sujet].sort());
    expect(await kc.etat(seul.sujet)).toBe('absent');
    expect(await kc.etat(partage.sujet)).toBe('actif');
    expect(await kc.etat(passant)).toBe('actif');
    expect(await kc.etat(douteux.sujet)).toBe('actif');
    expect((await kc.lister()).length).toBe(3);
    const encore = await kc.appliquerPlan(aFermer, { appliquer: true, aujourdhui: await jour(21) });
    expect(encore.filter((l) => l.action === 'supprimer')).toHaveLength(0);
    expect(encore.find((l) => l.sujetOidc === seul.sujet)).toMatchObject({ avant: 'absent', action: 'aucune' });

    // 4. Fiches : les appartenances du cabinet disparaissent (fin de contrat) ; les fiches sans appartenance sont traitées sur base d'essai.
    await admin.query('delete from appartenances where cabinet_id = $1', [A]);
    const orph = await planFichesOrphelines(admin);
    expect(orph.fiches.map((f) => f.utilisateurId).sort()).toEqual([seul.id, seul2.id, douteux.id].sort());
    const r = await appliquerFichesOrphelinesEssai(admin, { appliquer: true, env: process.env });
    expect(r.supprimees).toBe(3);
    const restants = (await admin.query<{ id: string }>('select id from utilisateurs')).rows.map((x) => x.id);
    expect(restants).toContain(partage.id);
    for (const u of [seul, seul2, douteux]) expect(restants).not.toContain(u.id);
    expect(restants.length).toBeGreaterThanOrEqual(6); // comptes du jeu d'essai de la base (membres d'autres cabinets), intacts

    // 5. Le royaume de développement n'a pas bougé.
    expect(await comptesDuRoyaumeDeDev()).toBe(devAvant);
  });

  it('refuse toute instance visant un autre royaume (développement, master, non déclaré)', () => {
    const cfg = { url: URL_KC, adminUtilisateur: 'x', adminMotDePasse: 'y' };
    expect(() => new FournisseurIdentiteEssai({ ...cfg, royaume: 'comtaple' }, { ...env, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'comtaple' })).toThrow(/n’est pas un royaume d’essai/);
    expect(() => new FournisseurIdentiteEssai({ ...cfg, royaume: 'master' }, { ...env, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'master' })).toThrow(/n’est pas un royaume d’essai/);
    expect(() => new FournisseurIdentiteEssai({ ...cfg, royaume: ROYAUME }, { OIDC_ISSUER: env.OIDC_ISSUER })).toThrow(/aucun royaume d’essai n’est déclaré/);
  });
});
