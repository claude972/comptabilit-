/**
 * SIMULATEUR de service de notification (tests uniquement, jamais en production).
 *
 * Serveur HTTP local qui tient le rôle du service de notification d'un navigateur (RFC 8030) ET du navigateur lui-même :
 * il crée des abonnements de test (paire de clés P-256 et secret d'authentification, comme le ferait un navigateur),
 * reçoit les envois, vérifie l'en-tête VAPID comme un service réel (signature ES256, audience, expiration, clé égale à
 * celle déclarée à l'abonnement), exige les en-têtes du protocole, puis DÉCHIFFRE le corps avec la clé privée de
 * l'abonnement. Ce qu'il prouve : la requête est conforme et son contenu est bien ce qui est attendu. Ce qu'il ne
 * prouve pas : le comportement d'un service réel (quotas, délais, particularités), ni l'affichage sur un appareil.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dechiffrerMessagePousse, verifierEnteteVapid } from './web-push.js';

export interface AbonnementSimule {
  /** Ce que `PushSubscription.toJSON()` rendrait dans un navigateur. */
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface MessageSimule {
  /** Point d'accès visé. */
  endpoint: string;
  /** Corps déchiffré (texte). */
  clair: string;
  /** En-têtes du protocole reçus (sans l'en-tête d'autorisation). */
  enTetes: { ttl: string | null; urgency: string | null; topic: string | null; contentEncoding: string | null };
  /** Contact annoncé par le jeton VAPID. */
  sujet: string;
  /** Octets du corps chiffré, tels que reçus (pour vérifier que le clair n'y figure pas). */
  chiffre: Buffer;
  recuLe: number;
}

export interface SimulateurPoussees {
  origine: string;
  /** Crée un abonnement de test lié à la clé publique VAPID du serveur d'application (comme `pushManager.subscribe`). */
  abonner(clePubliqueVapid: string): AbonnementSimule;
  /** Messages acceptés (201), dans l'ordre de réception. */
  messages: MessageSimule[];
  /** Requêtes refusées par le simulateur, avec le motif (jeton invalide, en-tête manquant, déchiffrement impossible…). */
  refus: Array<{ statut: number; motif: string }>;
  /** Réponses forcées pour un point d'accès : chaque code est consommé par une requête, puis le comportement normal reprend. */
  forcer(endpoint: string, ...statuts: number[]): void;
  /** Le point d'accès n'existe plus (désabonnement côté navigateur) : toute requête reçoit 410. */
  revoquer(endpoint: string): void;
  arreter(): Promise<void>;
}

export async function demarrerSimulateurPoussees(): Promise<SimulateurPoussees> {
  const abonnements = new Map<string, { clePrivee: Buffer; auth: Buffer; clePubliqueVapid: string; revoque: boolean; forces: number[] }>();
  const messages: MessageSimule[] = [];
  const refus: SimulateurPoussees['refus'] = [];
  let origine = '';
  const serveur: Server = createServer((req, res) => {
    const blocs: Buffer[] = [];
    req.on('data', (b: Buffer) => blocs.push(b));
    req.on('end', () => {
      const repondre = (statut: number, motif?: string) => {
        if (motif) refus.push({ statut, motif });
        res.writeHead(statut, statut === 201 ? { location: `${origine}/message/${randomBytes(8).toString('hex')}` } : { 'content-type': 'text/plain; charset=utf-8' });
        res.end(motif ?? '');
      };
      const m = /^\/push\/([A-Za-z0-9_-]{16,})$/.exec(req.url ?? '');
      const a = m ? abonnements.get(m[1]!) : undefined;
      if (req.method !== 'POST' || !m) return repondre(404, 'chemin inconnu');
      if (!a) return repondre(404, 'abonnement inconnu');
      if (a.revoque) return repondre(410);
      const force = a.forces.shift();
      if (force !== undefined) return repondre(force);
      const entete = (nom: string) => (typeof req.headers[nom] === 'string' ? (req.headers[nom] as string) : null);
      let jeton;
      try {
        jeton = verifierEnteteVapid(entete('authorization') ?? undefined, { audience: origine, maintenant: Math.floor(Date.now() / 1000) });
      } catch (e) {
        return repondre(401, `VAPID : ${(e as Error).message}`);
      }
      if (jeton.clePublique !== a.clePubliqueVapid) return repondre(403, 'clé VAPID différente de celle de l’abonnement');
      if (!/^\d+$/.test(entete('ttl') ?? '')) return repondre(400, 'en-tête TTL absent');
      if (entete('content-encoding') !== 'aes128gcm') return repondre(400, 'Content-Encoding aes128gcm attendu');
      if (entete('topic') !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(entete('topic')!)) return repondre(400, 'en-tête Topic mal formé');
      const corps = Buffer.concat(blocs);
      if (corps.length > 4096) return repondre(413, 'message trop long');
      let clair: Buffer;
      try {
        clair = dechiffrerMessagePousse(corps, a);
      } catch (e) {
        return repondre(400, `déchiffrement : ${(e as Error).message}`);
      }
      messages.push({
        endpoint: `${origine}/push/${m[1]}`,
        clair: clair.toString('utf8'),
        enTetes: { ttl: entete('ttl'), urgency: entete('urgency'), topic: entete('topic'), contentEncoding: entete('content-encoding') },
        sujet: jeton.sub,
        chiffre: corps,
        recuLe: Date.now(),
      });
      repondre(201);
    });
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
  origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const jetonDe = (endpoint: string) => {
    const a = abonnements.get(endpoint.slice(`${origine}/push/`.length));
    if (!a) throw new Error('Abonnement inconnu du simulateur');
    return a;
  };
  return {
    origine,
    messages,
    refus,
    abonner(clePubliqueVapid) {
      const e = createECDH('prime256v1');
      e.generateKeys();
      const auth = randomBytes(16);
      const jeton = randomBytes(24).toString('base64url');
      abonnements.set(jeton, { clePrivee: e.getPrivateKey(), auth, clePubliqueVapid, revoque: false, forces: [] });
      return { endpoint: `${origine}/push/${jeton}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
    },
    forcer(endpoint, ...statuts) {
      jetonDe(endpoint).forces.push(...statuts);
    },
    revoquer(endpoint) {
      jetonDe(endpoint).revoque = true;
    },
    arreter: () =>
      new Promise<void>((r) => {
        serveur.closeAllConnections();
        serveur.close(() => r());
      }),
  };
}
