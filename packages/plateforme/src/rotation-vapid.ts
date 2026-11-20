/**
 * Retrait EN MASSE des abonnements aux notifications poussées devenus inutilisables après une rotation des clés VAPID
 * (D-086, D-096). Outil de l'ÉDITEUR (`node scripts/editeur.mjs vapid-retirer-abonnements`), rôle d'administration.
 *
 * Pourquoi : un abonnement est lié par le navigateur à la clé publique VAPID (« applicationServerKey ») avec laquelle il a
 * été créé ; le service de notification refuse toute émission signée avec une autre paire de clés. Après une rotation, ces
 * abonnements ne reçoivent plus rien et chaque appareil doit se réactiver (bouton « Réactiver », détection par l'écran).
 * Les laisser en base ne sert qu'à produire des échecs jusqu'au retrait automatique au premier refus du service.
 *
 * Ce que l'outil fait — et rien d'autre :
 *  - il compare l'empreinte de clé VAPID enregistrée avec chaque abonnement (`empreinte_cle_vapid`) à celle de la
 *    configuration COURANTE (`PUSH_VAPID_CLE_PUBLIQUE`) ;
 *  - il retire UNIQUEMENT les abonnements dont l'empreinte est CONNUE et DIFFÉRENTE ; il ne retire JAMAIS ceux qui
 *    correspondent, ni ceux dont l'empreinte est inconnue (abonnés avant la migration 0048 : signalés, jamais touchés) ;
 *  - il ne supprime aucun autre objet (ni notification, ni préférence, ni file d'envoi, ni cabinet, ni personne) ;
 *  - SIMULATION par défaut : sans `appliquer`, aucune écriture ;
 *  - un abonnement = une transaction : verrouillé, revérifié, supprimé, journalisé dans le journal d'audit du cabinet
 *    (« notification_poussee.appareil_retire », motif « rotation_cles_vapid », sans point d'accès ni clé) ;
 *  - idempotent : rejouer ne trouve plus rien à retirer ; reprenable après interruption ;
 *  - REFUSÉ sans clé publique VAPID courante (jamais de retrait « parce que tout diffère » avec une configuration vide).
 * Le compte rendu ne porte que des identifiants et des décomptes : jamais un point d'accès, une clé ou un secret.
 * Aucun appel sortant : ni service de notification, ni IA, ni dépense.
 */
import { empreinteCleVapid } from './notifications-poussees.js';

/** Ce dont l'outil a besoin d'un client PostgreSQL d'administration (`pg.Client`). */
export interface ClientRetraitVapid {
  query(texte: string, valeurs?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface OptionsRetraitVapid {
  /** Sans `true` : simulation, aucune écriture. */
  appliquer?: boolean;
  /** Restreint le passage à un cabinet. */
  cabinetId?: string;
  /** Nombre maximal d'abonnements retirés pendant ce passage ; au-delà il s'arrête (relancer pour reprendre). */
  limite?: number;
}

export interface BilanRetraitVapid {
  simulation: boolean;
  /** Douze premiers caractères de l'empreinte de la clé publique courante. */
  empreinteCourante: string;
  /** Abonnements examinés (dans le périmètre demandé). */
  abonnements: number;
  /** Empreinte égale à la courante : conservés. */
  correspondants: number;
  /** Empreinte inconnue (abonnés avant la migration 0048) : conservés, à traiter par la réactivation des appareils. */
  empreinteInconnue: number;
  /** Empreinte connue et différente : à retirer (simulation) ou retirés (application). */
  obsoletes: number;
  retires: number;
  /** Abonnements que le passage a laissés (limite atteinte). */
  restantsObsoletes: number;
  interrompu: boolean;
  /** Identifiants seulement. */
  concernes: Array<{ id: string; cabinetId: string; service: string }>;
  parCabinet: Array<{ cabinetId: string; obsoletes: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function retirerAbonnementsVapidObsoletes(client: ClientRetraitVapid, cfg: { PUSH_VAPID_CLE_PUBLIQUE?: string }, options: OptionsRetraitVapid = {}): Promise<BilanRetraitVapid> {
  const cle = (cfg.PUSH_VAPID_CLE_PUBLIQUE ?? '').trim();
  if (cle === '') throw new Error('PUSH_VAPID_CLE_PUBLIQUE est vide : sans clé courante, rien ne peut être déclaré « différent ». Aucun abonnement n’est retiré.');
  if (options.cabinetId !== undefined && !UUID.test(options.cabinetId)) throw new Error('Identifiant de cabinet invalide.');
  if (options.limite !== undefined && !(Number.isInteger(options.limite) && options.limite >= 1)) throw new Error('Limite invalide : un entier supérieur ou égal à 1 est attendu.');
  const courante = empreinteCleVapid(cle);
  const appliquer = options.appliquer === true;
  const filtre = options.cabinetId === undefined ? '' : 'where cabinet_id = $1::uuid';
  const { rows } = await client.query(
    `select id::text, cabinet_id::text, service, empreinte_cle_vapid from abonnements_pousses ${filtre} order by cabinet_id, id`,
    options.cabinetId === undefined ? [] : [options.cabinetId],
  );
  const bilan: BilanRetraitVapid = {
    simulation: !appliquer, empreinteCourante: courante.slice(0, 12), abonnements: rows.length, correspondants: 0, empreinteInconnue: 0, obsoletes: 0, retires: 0, restantsObsoletes: 0, interrompu: false, concernes: [], parCabinet: [],
  };
  const obsoletes: Array<{ id: string; cabinetId: string; service: string }> = [];
  for (const r of rows) {
    if (r.empreinte_cle_vapid === null) bilan.empreinteInconnue++;
    else if (r.empreinte_cle_vapid === courante) bilan.correspondants++;
    else obsoletes.push({ id: r.id, cabinetId: r.cabinet_id, service: r.service });
  }
  bilan.obsoletes = obsoletes.length;
  const parCabinet = new Map<string, number>();
  for (const o of obsoletes) parCabinet.set(o.cabinetId, (parCabinet.get(o.cabinetId) ?? 0) + 1);
  bilan.parCabinet = [...parCabinet].map(([cabinetId, n]) => ({ cabinetId, obsoletes: n }));
  if (!appliquer) {
    bilan.concernes = obsoletes;
    bilan.restantsObsoletes = obsoletes.length;
    return bilan;
  }
  for (const o of obsoletes) {
    if (options.limite !== undefined && bilan.retires >= options.limite) {
      bilan.interrompu = true;
      break;
    }
    await client.query('begin');
    try {
      // Verrouillé et REVÉRIFIÉ dans la transaction : l'appareil a pu se réactiver (nouvelle empreinte) depuis la lecture.
      const v = await client.query(
        `select empreinte_cle_vapid, utilisateur_id::text from abonnements_pousses where id = $1::uuid for update`,
        [o.id],
      );
      const ligne = v.rows[0];
      if (!ligne || ligne.empreinte_cle_vapid === null || ligne.empreinte_cle_vapid === courante) {
        await client.query('rollback');
        continue;
      }
      const d = await client.query(`delete from abonnements_pousses where id = $1::uuid and empreinte_cle_vapid is not null and empreinte_cle_vapid <> $2 returning id`, [o.id, courante]);
      if (!d.rowCount) {
        await client.query('rollback');
        continue;
      }
      await client.query(
        `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1::uuid, 'systeme', 'notification_poussee.appareil_retire', 'abonnement_pousse', $2, $3::jsonb)`,
        [o.cabinetId, o.id, JSON.stringify({ service: o.service, par: 'editeur', motif: 'rotation_cles_vapid', membre: ligne.utilisateur_id })],
      );
      await client.query('commit');
      bilan.retires++;
      bilan.concernes.push(o);
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    }
  }
  bilan.restantsObsoletes = obsoletes.length - bilan.retires;
  return bilan;
}
