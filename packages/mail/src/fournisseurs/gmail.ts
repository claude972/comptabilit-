/**
 * Adaptateur Gmail / Google Workspace (Gmail API REST v1, `fetch` natif, lecture seule).
 * Points vérifiés dans la documentation officielle : voir docs/sources.md.
 */
import { ErreurCurseurExpire, ErreurOAuth, ErreurProtocole } from '../erreurs.js';
import { extraireAdresses } from '../extrait.js';
import {
  appelerPointJeton,
  normaliserScopes,
  preparerAutorisation,
  scopesManquants,
  type ClientOAuth,
  type ResultatRevocation,
} from '../oauth.js';
import { ENTETE_SIMULATEUR } from '../statut.js';
import type { EtatSurveillance, MessageBrut, PieceJointeBrute } from '../types.js';
import { chaine, exigerSucces, lireJson, tableau, type ContexteAppel, type FournisseurMail, type PageChangements } from './commun.js';

export interface UrlsGmail {
  autorisation: string;
  jeton: string;
  revocation: string;
  /** Base de l'API, sans chemin (`/gmail/v1/...` est ajouté). */
  api: string;
}

export const URLS_GMAIL_OFFICIELLES: UrlsGmail = {
  autorisation: 'https://accounts.google.com/o/oauth2/v2/auth',
  jeton: 'https://oauth2.googleapis.com/token',
  revocation: 'https://oauth2.googleapis.com/revoke',
  api: 'https://gmail.googleapis.com',
};

export interface ConfigurationGmail {
  client: ClientOAuth;
  /** À ne changer que pour les tests (simulateur). */
  urls?: UrlsGmail;
  /** Sujet Pub/Sub complet (`projects/<projet>/topics/<sujet>`). Absent = pas de surveillance, synchronisation périodique seule. */
  sujetPubSub?: string;
}

/** `watch` expire au plus tard après 7 jours ; Google recommande de le rappeler une fois par jour. */
const RENOUVELLEMENT_WATCH_MS = 24 * 3600 * 1000;
const TAILLE_PAGE_MESSAGES = 100;
const TAILLE_PAGE_HISTORIQUE = 500;
const CORPS_MAX_OCTETS = 256 * 1024;

function decoderCorps(donnees: unknown): string | null {
  const brut = chaine(donnees);
  if (brut === null) return null;
  return Buffer.from(brut, 'base64url').subarray(0, CORPS_MAX_OCTETS).toString('utf8');
}

function enTete(partie: Record<string, unknown>, nom: string): string | null {
  for (const h of tableau(partie['headers'])) {
    if (chaine(h['name'])?.toLowerCase() === nom) return chaine(h['value']);
  }
  return null;
}

interface Collecte {
  texte: string | null;
  html: string | null;
  pieces: PieceJointeBrute[];
}

/** Parcourt l'arbre MIME : premier text/plain, premier text/html, et toutes les parties portant un nom de fichier. */
function parcourir(partie: Record<string, unknown>, collecte: Collecte, profondeur = 0): void {
  if (profondeur > 20) return;
  const type = (chaine(partie['mimeType']) ?? '').toLowerCase();
  const nom = chaine(partie['filename']) ?? '';
  const corps = (typeof partie['body'] === 'object' && partie['body'] !== null ? partie['body'] : {}) as Record<string, unknown>;
  if (nom.length > 0) {
    const idPartie = chaine(partie['partId']);
    const idTelechargement = chaine(corps['attachmentId']);
    const donnees = chaine(corps['data']);
    if (idPartie !== null && (idTelechargement !== null || donnees !== null)) {
      collecte.pieces.push({
        // `partId` est stable pour un message donné ; `attachmentId` peut changer d'un appel à l'autre.
        id: idPartie,
        reference: idTelechargement !== null ? `id:${idTelechargement}` : `donnees:${donnees ?? ''}`,
        nom,
        typeMime: type,
        taille: typeof corps['size'] === 'number' ? corps['size'] : 0,
        enLigne: /^\s*inline\b/i.test(enTete(partie, 'content-disposition') ?? ''),
        contentId: enTete(partie, 'content-id'),
      });
    }
  } else if (type === 'text/plain' && collecte.texte === null) {
    collecte.texte = decoderCorps(corps['data']);
  } else if (type === 'text/html' && collecte.html === null) {
    collecte.html = decoderCorps(corps['data']);
  }
  for (const sousPartie of tableau(partie['parts'])) parcourir(sousPartie, collecte, profondeur + 1);
}

async function* enBlocs(octets: Uint8Array, taille = 64 * 1024): AsyncIterable<Uint8Array> {
  for (let i = 0; i < octets.length; i += taille) yield octets.subarray(i, Math.min(i + taille, octets.length));
}

export function creerFournisseurGmail(configuration: ConfigurationGmail): FournisseurMail {
  const urls = configuration.urls ?? URLS_GMAIL_OFFICIELLES;
  const api = `${urls.api}/gmail/v1/users/me`;

  return {
    id: 'gmail',
    urlApi: urls.api,
    urlJeton: urls.jeton,
    urlsAutorisees: () => [urls.jeton, urls.revocation, urls.api],

    preparerAutorisation: (p) =>
      preparerAutorisation({ ...p, fournisseur: 'gmail', urlAutorisation: urls.autorisation, client: configuration.client }),

    async echangerCode(http, { code, attendu, maintenant }) {
      const reponse = await appelerPointJeton(
        http,
        urls.jeton,
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: attendu.codeVerifier,
          client_id: configuration.client.clientId,
          client_secret: configuration.client.clientSecret,
          redirect_uri: configuration.client.uriRedirection,
        },
        'echange',
      );
      const scopes = normaliserScopes('gmail', reponse.scope ?? '');
      // Consentement granulaire : l'utilisateur peut n'accorder qu'une partie des scopes.
      if (scopesManquants('gmail', attendu.boite, scopes).length > 0) {
        throw new ErreurOAuth('scope_refuse', 'L’autorisation de lecture de la messagerie n’a pas été accordée.');
      }
      if (reponse.refresh_token === undefined) {
        throw new ErreurOAuth('rafraichissement_absent', 'Google n’a pas renvoyé de jeton de rafraîchissement.');
      }
      return {
        jetons: {
          jetonAcces: reponse.access_token,
          expireLe: new Date(maintenant.getTime() + reponse.expires_in * 1000).toISOString(),
          jetonRafraichissement: reponse.refresh_token,
          scopes,
        },
        adresse: null, // obtenue ensuite par users.getProfile (aucun scope d'identité n'est demandé)
      };
    },

    async rafraichir(http, jetons, maintenant) {
      const reponse = await appelerPointJeton(
        http,
        urls.jeton,
        {
          grant_type: 'refresh_token',
          refresh_token: jetons.jetonRafraichissement ?? '',
          client_id: configuration.client.clientId,
          client_secret: configuration.client.clientSecret,
        },
        'rafraichissement',
      );
      return {
        ...jetons,
        jetonAcces: reponse.access_token,
        expireLe: new Date(maintenant.getTime() + reponse.expires_in * 1000).toISOString(),
        jetonRafraichissement: reponse.refresh_token ?? jetons.jetonRafraichissement,
        scopes: reponse.scope !== undefined ? normaliserScopes('gmail', reponse.scope) : jetons.scopes,
      };
    },

    async revoquer(http, jetons): Promise<ResultatRevocation> {
      // Révoquer le jeton de rafraîchissement retire l'accès accordé à l'application pour cet utilisateur.
      const jeton = jetons.jetonRafraichissement ?? jetons.jetonAcces;
      const reponse = await http(urls.revocation, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: jeton }).toString(),
      });
      return reponse.status === 200
        ? { revoqueChezFournisseur: true, actionsRestantes: [] }
        : {
            revoqueChezFournisseur: false,
            actionsRestantes: [
              'Google n’a pas confirmé la révocation : l’utilisateur peut retirer l’accès depuis son compte Google (Sécurité → Connexions à des applications et services tiers).',
            ],
          };
    },

    async sonder(ctx) {
      const reponse = await ctx.requete(`${api}/profile`);
      exigerSucces(reponse, 'users.getProfile');
      const corps = await lireJson(reponse);
      return { adresse: chaine(corps['emailAddress'])?.toLowerCase() ?? null, reponseSimulateur: reponse.headers.has(ENTETE_SIMULATEUR) };
    },

    async pageSuivante(ctx, cle, etat): Promise<PageChangements> {
      const reprise = etat.reprise !== null ? (JSON.parse(etat.reprise) as { h?: string; p?: string }) : null;

      if (etat.curseur === null) {
        // Synchronisation complète BORNÉE : libellé surveillé + date de début.
        // L'historyId est relevé AVANT la liste : rien de ce qui arrive pendant le parcours n'est perdu.
        let idHistorique = reprise?.h;
        if (idHistorique === undefined) {
          const profil = await ctx.requete(`${api}/profile`);
          exigerSucces(profil, 'users.getProfile');
          idHistorique = chaine((await lireJson(profil))['historyId']) ?? undefined;
          if (idHistorique === undefined) throw new ErreurProtocole('historyId absent du profil Gmail.');
        }
        const q = new URLSearchParams({ maxResults: String(TAILLE_PAGE_MESSAGES), labelIds: cle });
        // `after:` en secondes Unix : les dates au format AAAA/MM/JJ sont interprétées à minuit, heure du Pacifique.
        q.set('q', `after:${Math.floor(ctx.dateDebut.getTime() / 1000)}`);
        if (reprise?.p !== undefined) q.set('pageToken', reprise.p);
        const reponse = await ctx.requete(`${api}/messages?${q.toString()}`);
        exigerSucces(reponse, 'users.messages.list');
        const corps = await lireJson(reponse);
        const suite = chaine(corps['nextPageToken']);
        return {
          idsMessages: tableau(corps['messages']).flatMap((m) => chaine(m['id']) ?? []),
          reprise: suite !== null ? JSON.stringify({ h: idHistorique, p: suite }) : null,
          curseur: suite !== null ? null : idHistorique,
          termine: suite === null,
        };
      }

      // Synchronisation incrémentale à partir de l'historyId mémorisé.
      const q = new URLSearchParams({ startHistoryId: etat.curseur, labelId: cle, maxResults: String(TAILLE_PAGE_HISTORIQUE) });
      q.append('historyTypes', 'messageAdded');
      q.append('historyTypes', 'labelAdded'); // message classé après coup dans un libellé surveillé
      if (reprise?.p !== undefined) q.set('pageToken', reprise.p);
      const reponse = await ctx.requete(`${api}/history?${q.toString()}`);
      // 404 : startHistoryId hors de la plage disponible → resynchronisation complète.
      if (reponse.status === 404) throw new ErreurCurseurExpire();
      exigerSucces(reponse, 'users.history.list');
      const corps = await lireJson(reponse);
      const ids = new Set<string>();
      for (const enregistrement of tableau(corps['history'])) {
        for (const champ of ['messagesAdded', 'labelsAdded'] as const) {
          for (const element of tableau(enregistrement[champ])) {
            const id = chaine((element['message'] as Record<string, unknown> | undefined)?.['id']);
            if (id !== null) ids.add(id);
          }
        }
      }
      const suite = chaine(corps['nextPageToken']);
      const nouveau = chaine(corps['historyId']);
      return {
        idsMessages: [...ids],
        reprise: suite !== null ? JSON.stringify({ p: suite }) : null,
        curseur: suite !== null ? null : (nouveau ?? etat.curseur),
        termine: suite === null,
      };
    },

    async lireMessage(ctx, idMessage): Promise<MessageBrut | null> {
      const reponse = await ctx.requete(`${api}/messages/${encodeURIComponent(idMessage)}?format=full`);
      if (reponse.status === 404) return null;
      exigerSucces(reponse, 'users.messages.get');
      const corps = await lireJson(reponse);
      const charge = (typeof corps['payload'] === 'object' && corps['payload'] !== null ? corps['payload'] : {}) as Record<string, unknown>;
      const collecte: Collecte = { texte: null, html: null, pieces: [] };
      parcourir(charge, collecte);
      const dateInterne = Number(chaine(corps['internalDate']) ?? Number.NaN);
      if (Number.isNaN(dateInterne)) throw new ErreurProtocole('internalDate absent du message Gmail.');
      return {
        id: chaine(corps['id']) ?? idMessage,
        dateReception: new Date(dateInterne),
        expediteur: extraireAdresses(enTete(charge, 'from') ?? '')[0] ?? '',
        destinataires: [
          ...new Set([
            ...extraireAdresses(enTete(charge, 'to') ?? ''),
            ...extraireAdresses(enTete(charge, 'cc') ?? ''),
            ...extraireAdresses(enTete(charge, 'delivered-to') ?? ''),
          ]),
        ],
        objet: enTete(charge, 'subject') ?? '',
        corpsTexte: collecte.texte,
        corpsHtml: collecte.html,
        piecesJointes: collecte.pieces,
      };
    },

    async ouvrirPieceJointe(ctx, idMessage, piece) {
      if (piece.reference.startsWith('donnees:')) {
        return enBlocs(Buffer.from(piece.reference.slice('donnees:'.length), 'base64url'));
      }
      const idTelechargement = piece.reference.slice('id:'.length);
      const reponse = await ctx.requete(
        `${api}/messages/${encodeURIComponent(idMessage)}/attachments/${encodeURIComponent(idTelechargement)}`,
      );
      exigerSucces(reponse, 'users.messages.attachments.get');
      // L'API renvoie le contenu en base64url dans un corps JSON : il est décodé puis restitué par blocs.
      const donnees = chaine((await lireJson(reponse))['data']);
      if (donnees === null) throw new ErreurProtocole('Contenu de pièce jointe absent.');
      return enBlocs(Buffer.from(donnees, 'base64url'));
    },

    async assurerSurveillance(ctx, p): Promise<EtatSurveillance> {
      if (configuration.sujetPubSub === undefined) {
        return { mode: 'periodique', raison: 'Aucun sujet Pub/Sub configuré : seule la synchronisation périodique est active.' };
      }
      const a = p.actuelle;
      if (!p.forcer && a?.mode === 'gmail_watch') {
        const recente = p.maintenant.getTime() - new Date(a.renouveleeLe).getTime() < RENOUVELLEMENT_WATCH_MS;
        const loinDeLEcheance = new Date(a.echeance).getTime() - p.maintenant.getTime() > 2 * RENOUVELLEMENT_WATCH_MS;
        if (recente && loinDeLEcheance) return a;
      }
      const reponse = await ctx.requete(`${api}/watch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicName: configuration.sujetPubSub, labelIds: p.cles, labelFilterBehavior: 'include' }),
      });
      exigerSucces(reponse, 'users.watch');
      const expiration = Number(chaine((await lireJson(reponse))['expiration']) ?? Number.NaN); // millisecondes Unix
      if (Number.isNaN(expiration)) throw new ErreurProtocole('Échéance absente de la réponse users.watch.');
      return { mode: 'gmail_watch', echeance: new Date(expiration).toISOString(), renouveleeLe: p.maintenant.toISOString() };
    },

    async arreterSurveillance(ctx, actuelle) {
      if (actuelle?.mode !== 'gmail_watch') return;
      await ctx.requete(`${api}/stop`, { method: 'POST' });
    },
  };
}
