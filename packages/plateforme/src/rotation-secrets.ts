/**
 * Rotation de `JETONS_CLE_CHIFFREMENT` : RECHIFFREMENT de tout ce que ce secret protège au repos, sous le secret
 * courant. Outil de l'ÉDITEUR (`node scripts/editeur.mjs secrets-rechiffrer`), exécuté avec le rôle d'administration.
 *
 * Ce que le secret protège (recensé dans le code le 2026-11-19) :
 *  - `connexions_mail.jetons_chiffres` : jetons OAuth de la collecte par mail (enveloppe `v1.<idCle>…`) — RECHIFFRÉ ici ;
 *  - `abonnements_pousses.secrets_chiffres` : point d'accès et clés des appareils (enveloppe `a1.<idCle>…`) — RECHIFFRÉ ici ;
 *  - `demandes_connexion_mail.donnees_chiffrees` : demandes d'autorisation OAuth en cours (quelques minutes de vie),
 *    chiffrées avec le secret courant seulement et sans identifiant de clé — NON rechiffrées : celles en cours au moment
 *    de la bascule échouent et se relancent ; elles sont seulement COMPTÉES ;
 *  - la liaison du paramètre `state` OAuth (HMAC, rien au repos) : même effet, rien à rechiffrer.
 *
 * Garanties :
 *  - SIMULATION par défaut : sans `appliquer`, aucune écriture ;
 *  - une ligne = une transaction ; la ligne est verrouillée, relue, rechiffrée, RELUE APRÈS ÉCRITURE et déchiffrée avec
 *    la SEULE clé courante : si le clair diffère du clair d'origine, la transaction est annulée ;
 *  - idempotent : une ligne déjà sous la clé courante n'est pas touchée — l'outil se rejoue après une interruption ;
 *  - une ligne ILLISIBLE (aucun secret configuré ne la déchiffre, enveloppe altérée) est SIGNALÉE et jamais écrasée ;
 *  - l'outil ne lit ni ne modifie la configuration : l'ancien secret est retiré de `JETONS_CLES_ANCIENNES` par
 *    l'exploitant, une fois le compte rendu à zéro ligne restante ;
 *  - réversible tant que l'ancien secret est configuré : relancer avec les deux secrets inversés.
 * Le compte rendu ne porte que des identifiants de ligne et de clé : jamais un jeton, un point d'accès ou une clé.
 */
import { isDeepStrictEqual } from 'node:util';
import { chiffrerJetons, dechiffrerJetons, type Trousseau } from '@comtaple/mail';
import type { Config } from './config.js';
import { clesMail } from './mail.js';
import { associeAbonnement, chiffrerAbonnement, type CleRepos, clesReposAbonnements, dechiffrerAbonnement } from './notifications-poussees.js';

/** Ce dont l'outil a besoin d'un client PostgreSQL (`pg.Client`), sans dépendre du paquet. */
export interface ClientRotation {
  query(texte: string, valeurs?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface BilanRotationTable {
  table: 'connexions_mail' | 'abonnements_pousses';
  /** Lignes portant un chiffré. */
  lignes: number;
  /** Déjà sous la clé courante avant ce passage. */
  dejaSousCleCourante: number;
  /** Rechiffrées et vérifiées pendant ce passage (toujours 0 en simulation). */
  rechiffrees: number;
  /** Encore sous une ancienne clé à la fin du passage, et lisibles (en simulation : tout ce qui serait rechiffré). */
  restantes: number;
  /** Lignes qu'aucun secret configuré ne déchiffre : jamais modifiées. Identifiant de ligne et de clé seulement. */
  illisibles: Array<{ id: string; idCle: string }>;
  /** Lignes dont la vérification après écriture a échoué : la transaction a été annulée, l'ancien chiffré est intact. */
  echecsVerification: string[];
}

export interface BilanRotation {
  simulation: boolean;
  /** Identifiants (non secrets) des clés courantes, par usage. */
  clesCourantes: { jetonsMail: string; abonnementsPousses: string };
  anciensSecretsConfigures: number;
  tables: BilanRotationTable[];
  /** Demandes d'autorisation OAuth non expirées : non rechiffrées, à relancer par leurs auteurs après la bascule. */
  demandesOauthEnCours: number;
  /** Le passage s'est arrêté avant la fin (option `limite`). */
  interrompu: boolean;
  /** Vrai seulement si plus AUCUNE ligne ne dépend d'un ancien secret (ni restante, ni illisible, ni en échec). */
  ancienSecretRetirable: boolean;
}

export interface OptionsRotation {
  /** Sans `true` : simulation, aucune écriture. */
  appliquer?: boolean;
  /** Restreint le passage à un cabinet (essais sur un cabinet neuf, reprise ciblée). */
  cabinetId?: string;
  /** Nombre maximal de lignes rechiffrées pendant ce passage ; au-delà, le passage s'arrête (il se reprend en relançant). */
  limite?: number;
}

type ConfigRotation = Pick<Config, 'JETONS_CLE_CHIFFREMENT'> & Partial<Pick<Config, 'JETONS_CLES_ANCIENNES'>>;

interface Usage<T> {
  table: BilanRotationTable['table'];
  colonne: string;
  /** Colonnes supplémentaires nécessaires aux données associées. */
  colonnesAssociees: string[];
  idCleCourante: string;
  dechiffrer(ligne: Record<string, string>, enveloppe: string, courantSeul: boolean): T | null;
  chiffrer(ligne: Record<string, string>, clair: T): string;
}

function usages(cfg: ConfigRotation): { mail: Usage<unknown>; pousses: Usage<unknown>; anciens: number } {
  const mail = clesMail(cfg);
  const repos: CleRepos[] = clesReposAbonnements(cfg);
  if (!mail || repos.length === 0) throw new Error('JETONS_CLE_CHIFFREMENT est absent ou trop court (32 caractères au moins) : rien ne peut être rechiffré.');
  const trousseauCourant: Trousseau = { courante: mail.trousseau.courante };
  const essayer = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  return {
    anciens: repos.length - 1,
    mail: {
      table: 'connexions_mail',
      colonne: 'jetons_chiffres',
      colonnesAssociees: [],
      idCleCourante: mail.trousseau.courante.id,
      dechiffrer: (l, enveloppe, courantSeul) => essayer(() => dechiffrerJetons(enveloppe, l.id!, courantSeul ? trousseauCourant : mail.trousseau)),
      chiffrer: (l, clair) => chiffrerJetons(clair as Parameters<typeof chiffrerJetons>[0], l.id!, mail.trousseau.courante),
    },
    pousses: {
      table: 'abonnements_pousses',
      colonne: 'secrets_chiffres',
      colonnesAssociees: ['cabinet_id', 'utilisateur_id', 'empreinte_point_acces'],
      idCleCourante: repos[0]!.id,
      dechiffrer: (l, enveloppe, courantSeul) => dechiffrerAbonnement({ clesRepos: courantSeul ? [repos[0]!] : repos }, enveloppe, associeAbonnement(l.cabinet_id!, l.utilisateur_id!, l.empreinte_point_acces!)),
      chiffrer: (l, clair) => chiffrerAbonnement({ clesRepos: [repos[0]!] }, clair as Parameters<typeof chiffrerAbonnement>[1], associeAbonnement(l.cabinet_id!, l.utilisateur_id!, l.empreinte_point_acces!)),
    },
  };
}

const idCleDe = (enveloppe: string): string => enveloppe.split('.')[1] ?? '';

async function traiterTable(client: ClientRotation, u: Usage<unknown>, o: OptionsRotation, budget: { reste: number }): Promise<BilanRotationTable & { interrompu: boolean }> {
  const bilan = { table: u.table, lignes: 0, dejaSousCleCourante: 0, rechiffrees: 0, restantes: 0, illisibles: [] as Array<{ id: string; idCle: string }>, echecsVerification: [] as string[], interrompu: false };
  const colonnes = ['id', ...u.colonnesAssociees].map((c) => `${c}::text as ${c}`).join(', ');
  const filtre = o.cabinetId ? 'and cabinet_id = $1' : '';
  const { rows } = await client.query(`select ${colonnes}, ${u.colonne} as enveloppe from ${u.table} where ${u.colonne} is not null ${filtre} order by id`, o.cabinetId ? [o.cabinetId] : []);
  for (const ligne of rows as Array<Record<string, string>>) {
    bilan.lignes++;
    // Une enveloppe qui se dit sous la clé courante est vérifiée elle aussi : altérée, elle est signalée illisible.
    if (idCleDe(ligne.enveloppe!) === u.idCleCourante && u.dechiffrer(ligne, ligne.enveloppe!, true) !== null) {
      bilan.dejaSousCleCourante++;
      continue;
    }
    if (idCleDe(ligne.enveloppe!) === u.idCleCourante || u.dechiffrer(ligne, ligne.enveloppe!, false) === null) {
      bilan.illisibles.push({ id: ligne.id!, idCle: idCleDe(ligne.enveloppe!).slice(0, 64) });
      continue;
    }
    if (!o.appliquer) {
      bilan.restantes++;
      continue;
    }
    if (budget.reste <= 0) {
      bilan.restantes++;
      bilan.interrompu = true;
      continue;
    }
    // Une transaction par ligne : verrou, relecture (la ligne a pu changer ou disparaître depuis l'inventaire),
    // écriture, relecture APRÈS écriture et déchiffrement avec la seule clé courante.
    await client.query('begin');
    try {
      const [actuelle] = (await client.query(`select ${u.colonne} as enveloppe from ${u.table} where id = $1 for update`, [ligne.id])).rows as Array<{ enveloppe: string | null }>;
      if (!actuelle?.enveloppe) {
        await client.query('rollback');
        bilan.lignes--;
        continue;
      }
      if (idCleDe(actuelle.enveloppe) === u.idCleCourante) {
        await client.query('rollback');
        bilan.dejaSousCleCourante++;
        continue;
      }
      const clair = u.dechiffrer(ligne, actuelle.enveloppe, false);
      if (clair === null) {
        await client.query('rollback');
        bilan.illisibles.push({ id: ligne.id!, idCle: idCleDe(actuelle.enveloppe).slice(0, 64) });
        continue;
      }
      await client.query(`update ${u.table} set ${u.colonne} = $2 where id = $1`, [ligne.id, u.chiffrer(ligne, clair)]);
      const [ecrite] = (await client.query(`select ${u.colonne} as enveloppe from ${u.table} where id = $1`, [ligne.id])).rows as Array<{ enveloppe: string }>;
      const relu = ecrite ? u.dechiffrer(ligne, ecrite.enveloppe, true) : null;
      if (relu === null || !isDeepStrictEqual(relu, clair)) {
        await client.query('rollback');
        bilan.echecsVerification.push(ligne.id!);
        continue;
      }
      await client.query('commit');
      bilan.rechiffrees++;
      budget.reste--;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    }
  }
  return bilan;
}

/**
 * Rechiffre sous le secret courant ce qui est encore chiffré avec un ancien secret. Voir l'en-tête du fichier pour les
 * garanties. Retour arrière : appeler de nouveau avec `JETONS_CLE_CHIFFREMENT` et `JETONS_CLES_ANCIENNES` inversés.
 */
export async function rechiffrerSecrets(client: ClientRotation, cfg: ConfigRotation, options: OptionsRotation = {}): Promise<BilanRotation> {
  const u = usages(cfg);
  if (options.cabinetId !== undefined && !/^[0-9a-f-]{36}$/i.test(options.cabinetId)) throw new Error('Identifiant de cabinet invalide.');
  if (options.limite !== undefined && !(Number.isSafeInteger(options.limite) && options.limite >= 0)) throw new Error('Limite invalide.');
  const budget = { reste: options.limite ?? Number.MAX_SAFE_INTEGER };
  const tables: BilanRotationTable[] = [];
  let interrompu = false;
  for (const usage of [u.mail, u.pousses]) {
    const { interrompu: i, ...bilan } = await traiterTable(client, usage, options, budget);
    interrompu ||= i;
    tables.push(bilan);
  }
  const demandes = await client.query(`select count(*)::int as n from demandes_connexion_mail where expire_le > now() ${options.cabinetId ? 'and cabinet_id = $1' : ''}`, options.cabinetId ? [options.cabinetId] : []);
  return {
    simulation: !options.appliquer,
    clesCourantes: { jetonsMail: u.mail.idCleCourante, abonnementsPousses: u.pousses.idCleCourante },
    anciensSecretsConfigures: u.anciens,
    tables,
    demandesOauthEnCours: (demandes.rows[0] as { n: number }).n,
    interrompu,
    ancienSecretRetirable: tables.every((t) => t.restantes === 0 && t.illisibles.length === 0 && t.echecsVerification.length === 0),
  };
}
