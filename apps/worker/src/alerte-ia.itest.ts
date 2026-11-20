/**
 * Alerte d'expiration de la preuve de connexion de la passerelle IA (D-096) : `signalerExpirationPreuveIa`.
 *
 * AUCUN APPEL À L'IA : le « fournisseur » est un faux écrit ici dont les méthodes d'appel (`completer`, `vectoriser`) sont des
 * espions qui ne doivent JAMAIS être appelés. Aucun jeton réel, aucune dépense. PostgreSQL réel, mais TOUT se passe dans UNE
 * transaction d'administration toujours annulée : la preuve d'essai et les notifications créées pour les gestionnaires des
 * cabinets n'existent que le temps du test (aucune notification ne reste dans la base locale).
 */
import { randomBytes } from 'node:crypto';
import { type AccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type FournisseurIa, HOTE_OFFICIEL_OVH, MODELES_IA, URL_BASE_OVH } from '@comtaple/ia';
import { assemblerIa, empreinteConfigurationIa } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signalerExpirationPreuveIa } from './alerte-ia.js';
import type { Contexte } from './contexte.js';

chargerEnvLocal();
const SEL = randomBytes(4).toString('hex');
const JETON = `jeton-fictif-${SEL}`; // fictif : il ne sort jamais de cette machine
const EMPREINTE = empreinteConfigurationIa({ urlBase: URL_BASE_OVH, jeton: JETON });
const UUID_PREUVE = '0048a1e7-0000-4000-8000-000000000001';
let admin: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
});

function fournisseurReel() {
  const completer = vi.fn();
  const vectoriser = vi.fn();
  return { fournisseur: { nature: 'reel', nom: 'faux fournisseur de test', urlBase: URL_BASE_OVH, completer, vectoriser } as unknown as FournisseurIa, completer, vectoriser };
}

/** Contexte du worker dont la base EST la transaction d'administration d'essai (la preuve et les notifications y restent). */
function contexte(fournisseur: FournisseurIa | null, maintenant: Date, options: { alerteJours?: number; empreinte?: string | null } = {}): Contexte {
  const bd = { pool: { query: (t: string, p?: unknown[]) => admin.query(t, p) } } as unknown as AccesBd;
  const ia = assemblerIa(bd, fournisseur, null, {
    empreinteConfiguration: options.empreinte === undefined ? EMPREINTE : options.empreinte, fraicheurMs: 0, maintenant: () => maintenant, ...(options.alerteJours ? { alerteJours: options.alerteJours } : {}),
  });
  return { bd, ia } as unknown as Contexte;
}

async function dansTransactionAnnulee(fn: () => Promise<void>): Promise<void> {
  await admin.query('begin');
  try {
    await fn();
  } finally {
    await admin.query('rollback');
  }
}
const injecter = (p: { verifieeJoursAvant?: number; validiteJours?: number; resultat?: string; empreinte?: string } = {}) =>
  admin.query(
    `insert into verifications_connexion_ia (id, verifiee_le, resultat, raisons, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, reponse_simulateur, empreinte_configuration, valide_jusqu_au)
     values ($1, now() - make_interval(days => $2), $3, '[]'::jsonb, $4, $5, $6::jsonb, $7, $8, $9, false, $10, now() - make_interval(days => $2) + make_interval(days => $11))`,
    [UUID_PREUVE, p.verifieeJoursAvant ?? 25, p.resultat ?? 'connecte', URL_BASE_OVH, HOTE_OFFICIEL_OVH, JSON.stringify([`${URL_BASE_OVH}/chat/completions`, `${URL_BASE_OVH}/embeddings`]), MODELES_IA.langage.id, MODELES_IA.embeddings.id, MODELES_IA.embeddings.dimensions, p.empreinte ?? EMPREINTE, p.validiteJours ?? 30],
  );
/** Heure de la base (début de la transaction d'essai) : la machine hôte et la base peuvent ne pas avoir exactement la même horloge. */
const heureBd = async () => (await admin.query('select now() as t')).rows[0].t as Date;
const notifications = async () => Number((await admin.query(`select count(*) as n from notifications where type = 'ia.preuve_expire_bientot' and cible_id = $1`, [UUID_PREUVE])).rows[0].n);
const gestionnaires = async () => Number((await admin.query(`select count(*) as n from appartenances where actif and role in ('administrateur', 'associe') and (expire_le is null or expire_le > now())`)).rows[0].n);

describe('alerte d’expiration de la preuve IA : rien à signaler sans preuve, une seule notification par preuve, aucun appel', () => {
  it('sans fournisseur, avec le simulateur, sans preuve, preuve d’une autre configuration, échec, périmée : RIEN n’est signalé ni écrit', async () => {
    await dansTransactionAnnulee(async () => {
      const { fournisseur, completer, vectoriser } = fournisseurReel();
      const maintenant = new Date();
      expect(await signalerExpirationPreuveIa(contexte(null, maintenant))).toMatchObject({ issue: 'sans_fournisseur_reel', notifications: 0 });
      const simulateur = { ...fournisseur, nature: 'simulateur' } as unknown as FournisseurIa;
      expect(await signalerExpirationPreuveIa(contexte(simulateur, maintenant))).toMatchObject({ issue: 'sans_fournisseur_reel', notifications: 0 });
      // Aucune preuve en base.
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant))).toMatchObject({ issue: 'aucune_preuve', notifications: 0 });
      // Une preuve existe, mais pour une AUTRE configuration (jeton changé) : elle ne vaut pas, rien à signaler.
      await injecter({ verifieeJoursAvant: 25, empreinte: 'f'.repeat(64) });
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant))).toMatchObject({ issue: 'aucune_preuve', notifications: 0 });
      await admin.query('delete from verifications_connexion_ia where id = $1', [UUID_PREUVE]);
      // Dernière vérification en échec : pas de preuve valide, pas d'alerte.
      await injecter({ verifieeJoursAvant: 25, resultat: 'echec' });
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant))).toMatchObject({ issue: 'preuve_non_valide', notifications: 0 });
      await admin.query('delete from verifications_connexion_ia where id = $1', [UUID_PREUVE]);
      // Périmée : c'est un autre état (« périmée »), pas « expire bientôt » : aucune notification d'expiration prochaine.
      await injecter({ verifieeJoursAvant: 40, validiteJours: 30 });
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant))).toMatchObject({ issue: 'preuve_non_valide', notifications: 0 });
      expect(await notifications()).toBe(0);
      expect(completer).not.toHaveBeenCalled();
      expect(vectoriser).not.toHaveBeenCalled();
    });
  });

  it('preuve valide encore loin de sa fin : « pas encore » ; seuil paramétrable ; à moins de 7 jours : une notification par gestionnaire actif ; rejouée : aucune de plus', async () => {
    await dansTransactionAnnulee(async () => {
      const { fournisseur, completer, vectoriser } = fournisseurReel();
      const maintenant = await heureBd();
      await injecter({ verifieeJoursAvant: 5, validiteJours: 30 }); // 25 jours restants
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant))).toMatchObject({ issue: 'pas_encore', notifications: 0, joursRestants: 25 });
      expect(await notifications()).toBe(0);
      // Seuil de 30 jours : la même preuve « expire bientôt ».
      const g = await gestionnaires();
      const large = await signalerExpirationPreuveIa(contexte(fournisseur, maintenant, { alerteJours: 30 }));
      expect(large).toMatchObject({ issue: 'signalee', joursRestants: 25 });
      expect(large.notifications).toBe(g);
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, maintenant, { alerteJours: 30 }))).toMatchObject({ issue: 'signalee', notifications: 0 }); // une seule fois par preuve
      expect(await notifications()).toBe(g);
      expect(completer).not.toHaveBeenCalled();
      expect(vectoriser).not.toHaveBeenCalled();
    });
  });

  it('seuil par défaut (7 jours) : 6 jours restants → signalée aux seuls administrateurs et associés ; le contenu ne porte que la date et le décompte', async () => {
    await dansTransactionAnnulee(async () => {
      const { fournisseur } = fournisseurReel();
      await injecter({ verifieeJoursAvant: 24, validiteJours: 30 }); // 6 jours restants
      const r = await signalerExpirationPreuveIa(contexte(fournisseur, await heureBd()));
      expect(r).toMatchObject({ issue: 'signalee', joursRestants: 6 });
      expect(r.notifications).toBeGreaterThan(0);
      const l = (await admin.query(`select n.destinataire_id::text, n.donnees, n.cible_type, n.entite_id_cible, a.role from notifications n join appartenances a on a.cabinet_id = n.cabinet_id and a.utilisateur_id = n.destinataire_id where n.cible_id = $1`, [UUID_PREUVE])).rows;
      expect(l.length).toBe(r.notifications);
      expect(l.every((x) => ['administrateur', 'associe'].includes(x.role) && x.cible_type === 'verification_ia' && x.entite_id_cible === null)).toBe(true);
      expect(Object.keys(l[0]!.donnees).sort()).toEqual(['expireLe', 'joursRestants', 'seuilJours']);
      expect(l[0]!.donnees).toMatchObject({ joursRestants: 6, seuilJours: 7 });
      expect(JSON.stringify(l)).not.toContain(JETON);
    });
  });

  it('à une heure de la fin : encore « expire bientôt » (1 jour), jamais 0 ; à la fin exacte : plus de preuve, plus d’alerte', async () => {
    await dansTransactionAnnulee(async () => {
      const { fournisseur } = fournisseurReel();
      await injecter({ verifieeJoursAvant: 20, validiteJours: 20 });
      const fin = ((await admin.query(`select valide_jusqu_au from verifications_connexion_ia where id = $1`, [UUID_PREUVE])).rows[0].valide_jusqu_au as Date).getTime();
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, new Date(fin - 3_600_000)))).toMatchObject({ issue: 'signalee', joursRestants: 1 });
      expect(await signalerExpirationPreuveIa(contexte(fournisseur, new Date(fin)))).toMatchObject({ issue: 'preuve_non_valide', notifications: 0 });
    });
  });
});
