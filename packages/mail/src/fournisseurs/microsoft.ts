/**
 * Adaptateur Microsoft 365 / Outlook (Microsoft Graph v1.0, `fetch` natif, lecture seule, permissions déléguées).
 * Points vérifiés dans la documentation officielle : voir docs/sources.md.
 *
 * Boîtes partagées : lues via `users/{adresse}/…` avec `Mail.Read.Shared`. La documentation indique que les
 * permissions de partage ne permettent PAS de s'abonner aux notifications : pour une boîte partagée, seule
 * la synchronisation périodique par delta est utilisée, sans élargir les droits.
 */
import { ErreurCurseurExpire, ErreurOAuth, ErreurProtocole } from '../erreurs.js';
import { verifierJwtRs256, verifierValidite, type Jwk } from '../jwt.js';
import {
  appelerPointJeton,
  normaliserScopes,
  preparerAutorisation,
  scopesDemande,
  scopesDonneesRequis,
  scopesManquants,
  type ClientOAuth,
  type ResultatRevocation,
  type TypeBoite,
} from '../oauth.js';
import { ENTETE_SIMULATEUR } from '../statut.js';
import type { EtatSurveillance, MessageBrut, PieceJointeBrute } from '../types.js';
import { chaine, exigerSucces, lireJson, tableau, type ContexteAppel, type FournisseurMail, type PageChangements } from './commun.js';

export interface UrlsMicrosoft {
  /** Base de la plateforme d'identité, sans locataire. */
  connexion: string;
  /** Base de Graph, version comprise. */
  api: string;
}

export const URLS_MICROSOFT_OFFICIELLES: UrlsMicrosoft = {
  connexion: 'https://login.microsoftonline.com',
  api: 'https://graph.microsoft.com/v1.0',
};

export interface ConfigurationMicrosoft {
  client: ClientOAuth;
  /** `common` (comptes professionnels et personnels), `organizations`, ou un identifiant de locataire. */
  locataire?: string;
  /** À ne changer que pour les tests (simulateur). */
  urls?: UrlsMicrosoft;
  /** URL HTTPS publique recevant les notifications de changement. Absente = synchronisation périodique seule. */
  urlNotification?: string;
  /** URL HTTPS publique recevant les notifications de cycle de vie. */
  urlCycleDeVie?: string;
}

/** Durée demandée : 6 jours (maximum documenté pour les messages Outlook : 10 080 minutes, « moins de sept jours »). */
const DUREE_ABONNEMENT_MS = 6 * 24 * 3600 * 1000;
/** Renouvellement quand il reste moins de 48 h. */
const MARGE_RENOUVELLEMENT_MS = 48 * 3600 * 1000;
const TAILLE_PAGE = 50;
/** Identifiants immuables : l'identifiant d'un message ne change pas quand il est déplacé dans la même boîte. */
const PREFERENCE_ID = 'IdType="ImmutableId"';
const CODES_RESYNCHRONISATION = new Set(['syncstatenotfound', 'resyncrequired', 'syncstateinvalid']);

const racine = (boite: TypeBoite): string => (boite.type === 'partagee' ? `users/${encodeURIComponent(boite.adresse)}` : 'me');

function adresseDe(destinataire: unknown): string | null {
  const a = (destinataire as { emailAddress?: { address?: unknown } } | null)?.emailAddress?.address;
  return typeof a === 'string' && a.includes('@') ? a.toLowerCase() : null;
}

export function creerFournisseurMicrosoft(configuration: ConfigurationMicrosoft): FournisseurMail {
  const urls = configuration.urls ?? URLS_MICROSOFT_OFFICIELLES;
  const locataire = configuration.locataire ?? 'common';
  const urlAutorisation = `${urls.connexion}/${locataire}/oauth2/v2.0/authorize`;
  const urlJeton = `${urls.connexion}/${locataire}/oauth2/v2.0/token`;
  const urlCles = `${urls.connexion}/common/discovery/v2.0/keys`;

  /** Les liens de pagination viennent du serveur : on n'y envoie le jeton que s'ils pointent vers l'API configurée. */
  function exigerLienApi(lien: string): string {
    if (!lien.startsWith(`${urls.api}/`)) throw new ErreurProtocole('Lien de pagination hors de l’API Graph configurée.');
    return lien;
  }

  async function verifierJetonIdentite(
    http: Parameters<FournisseurMail['echangerCode']>[0],
    jeton: string,
    nonce: string | null,
    maintenant: Date,
  ): Promise<string | null> {
    const reponse = await http(urlCles);
    exigerSucces(reponse, 'clés de signature');
    const cles = tableau((await lireJson(reponse))['keys']) as unknown as Jwk[];
    const charge = verifierJwtRs256(jeton, cles);
    verifierValidite(charge, maintenant);
    const locataireJeton = chaine(charge['tid']);
    if (charge['aud'] !== configuration.client.clientId) throw new ErreurOAuth('id_token_invalide', 'Audience du jeton d’identité inattendue.');
    if (locataireJeton === null || charge['iss'] !== `${urls.connexion}/${locataireJeton}/v2.0`) {
      throw new ErreurOAuth('id_token_invalide', 'Émetteur du jeton d’identité inattendu.');
    }
    if (nonce === null || charge['nonce'] !== nonce) throw new ErreurOAuth('nonce_invalide', 'Le nonce du jeton d’identité ne correspond pas.');
    const identifiant = chaine(charge['preferred_username']);
    return identifiant !== null && identifiant.includes('@') ? identifiant.toLowerCase() : null;
  }

  return {
    id: 'microsoft',
    urlApi: urls.api,
    urlJeton,
    urlsAutorisees: () => [urls.connexion, urls.api],

    preparerAutorisation: (p) =>
      preparerAutorisation({ ...p, fournisseur: 'microsoft', urlAutorisation, client: configuration.client }),

    async echangerCode(http, { code, attendu, maintenant }) {
      const reponse = await appelerPointJeton(
        http,
        urlJeton,
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: attendu.codeVerifier,
          client_id: configuration.client.clientId,
          client_secret: configuration.client.clientSecret,
          redirect_uri: configuration.client.uriRedirection,
          scope: scopesDemande('microsoft', attendu.boite).join(' '),
        },
        'echange',
      );
      if (reponse.id_token === undefined) throw new ErreurOAuth('id_token_absent', 'Jeton d’identité absent de la réponse.');
      const identifiant = await verifierJetonIdentite(http, reponse.id_token, attendu.nonce, maintenant);
      // `scope` est facultatif dans la réponse : absent, le jeton vaut pour les scopes demandés.
      const scopes =
        reponse.scope !== undefined ? normaliserScopes('microsoft', reponse.scope) : scopesDonneesRequis('microsoft', attendu.boite);
      if (scopesManquants('microsoft', attendu.boite, scopes).length > 0) {
        throw new ErreurOAuth('scope_refuse', 'L’autorisation de lecture de la messagerie n’a pas été accordée.');
      }
      if (reponse.refresh_token === undefined) {
        throw new ErreurOAuth('rafraichissement_absent', 'Microsoft n’a pas renvoyé de jeton de rafraîchissement (offline_access).');
      }
      return {
        jetons: {
          jetonAcces: reponse.access_token,
          expireLe: new Date(maintenant.getTime() + reponse.expires_in * 1000).toISOString(),
          jetonRafraichissement: reponse.refresh_token,
          scopes,
        },
        adresse: attendu.boite.type === 'partagee' ? attendu.boite.adresse : identifiant,
      };
    },

    async rafraichir(http, jetons, maintenant) {
      const reponse = await appelerPointJeton(
        http,
        urlJeton,
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
        // Microsoft renvoie un NOUVEAU jeton de rafraîchissement à chaque fois : l'ancien doit être remplacé.
        jetonRafraichissement: reponse.refresh_token ?? jetons.jetonRafraichissement,
        scopes: reponse.scope !== undefined ? normaliserScopes('microsoft', reponse.scope) : jetons.scopes,
      };
    },

    async revoquer(): Promise<ResultatRevocation> {
      // La plateforme d'identité Microsoft n'expose pas de point de révocation de jeton utilisable par
      // l'application, et `revokeSignInSessions` exige une permission que ce connecteur ne demande pas.
      return {
        revoqueChezFournisseur: false,
        actionsRestantes: [
          'Comtaple a supprimé ses jetons et ses abonnements : il ne peut plus lire la boîte.',
          'Pour retirer l’autorisation elle-même, l’utilisateur doit supprimer l’application depuis « Mes applications » (compte professionnel) ou la page de confidentialité de son compte Microsoft (compte personnel).',
          'Un administrateur peut retirer le consentement dans le centre d’administration Microsoft Entra (Applications d’entreprise) ou révoquer les sessions de l’utilisateur.',
        ],
      };
    },

    async sonder(ctx) {
      const reponse = await ctx.requete(`${urls.api}/${racine(ctx.boite)}/mailFolders/inbox?$select=id`);
      exigerSucces(reponse, 'lecture du dossier de réception');
      return { adresse: null, reponseSimulateur: reponse.headers.has(ENTETE_SIMULATEUR) };
    },

    async pageSuivante(ctx, cle, etat): Promise<PageChangements> {
      // Requête delta par dossier. La date de début est appliquée ici, côté client : le filtre serveur
      // `receivedDateTime ge …` plafonne le résultat à 5 000 messages et n'est donc pas utilisé.
      const url =
        etat.reprise ?? etat.curseur ?? `${urls.api}/${racine(ctx.boite)}/mailFolders/${encodeURIComponent(cle)}/messages/delta?$select=id,receivedDateTime`;
      const reponse = await ctx.requete(exigerLienApi(url), {
        headers: { prefer: `odata.maxpagesize=${TAILLE_PAGE}, ${PREFERENCE_ID}` },
      });
      if (reponse.status === 410) throw new ErreurCurseurExpire();
      if (!reponse.ok && reponse.status >= 400 && reponse.status < 500) {
        const code = chaine(((await lireJson(reponse))['error'] as Record<string, unknown> | undefined)?.['code']);
        if (code !== null && CODES_RESYNCHRONISATION.has(code.toLowerCase())) throw new ErreurCurseurExpire();
        throw new ErreurProtocole(`Échec de la requête delta (statut ${reponse.status}).`);
      }
      exigerSucces(reponse, 'messages/delta');
      const corps = await lireJson(reponse);
      const ids: string[] = [];
      for (const element of tableau(corps['value'])) {
        if (element['@removed'] !== undefined) continue; // suppressions et déplacements : sans objet en lecture seule
        const id = chaine(element['id']);
        const recu = chaine(element['receivedDateTime']);
        if (id === null) continue;
        if (recu !== null && new Date(recu).getTime() < ctx.dateDebut.getTime()) continue;
        ids.push(id);
      }
      const suite = chaine(corps['@odata.nextLink']);
      const delta = chaine(corps['@odata.deltaLink']);
      if (suite === null && delta === null) throw new ErreurProtocole('Réponse delta sans lien de suite.');
      return {
        idsMessages: ids,
        reprise: suite !== null ? exigerLienApi(suite) : null,
        curseur: suite !== null ? null : exigerLienApi(delta ?? ''),
        termine: suite === null,
      };
    },

    async lireMessage(ctx, idMessage): Promise<MessageBrut | null> {
      const base = `${urls.api}/${racine(ctx.boite)}/messages/${encodeURIComponent(idMessage)}`;
      const reponse = await ctx.requete(
        `${base}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,body`,
        { headers: { prefer: PREFERENCE_ID } },
      );
      if (reponse.status === 404) return null;
      exigerSucces(reponse, 'lecture du message');
      const m = await lireJson(reponse);
      const recu = chaine(m['receivedDateTime']);
      if (recu === null) throw new ErreurProtocole('receivedDateTime absent du message.');
      const corps = (m['body'] ?? {}) as { contentType?: unknown; content?: unknown };
      const contenu = typeof corps.content === 'string' ? corps.content.slice(0, 256 * 1024) : null;
      const estHtml = typeof corps.contentType === 'string' && corps.contentType.toLowerCase() === 'html';

      const pieces: PieceJointeBrute[] = [];
      // `hasAttachments` ne compte pas les pièces en ligne : celles-ci (signatures, logos) ne sont donc pas listées.
      if (m['hasAttachments'] === true) {
        let lien: string | null = `${base}/attachments?$select=id,name,contentType,size,isInline`;
        while (lien !== null) {
          const page: Response = await ctx.requete(exigerLienApi(lien), { headers: { prefer: PREFERENCE_ID } });
          exigerSucces(page, 'liste des pièces jointes');
          const liste = await lireJson(page);
          for (const p of tableau(liste['value'])) {
            const id = chaine(p['id']);
            if (id === null) continue;
            // Seuls les fichiers sont lus. Les éléments joints (itemAttachment) et les références vers un
            // stockage en ligne (referenceAttachment, qui est un lien) ne sont jamais ouverts.
            const type = chaine(p['@odata.type']) ?? '#microsoft.graph.fileAttachment';
            if (!type.toLowerCase().endsWith('fileattachment')) continue;
            pieces.push({
              id,
              reference: 'fichier',
              nom: chaine(p['name']) ?? '',
              typeMime: chaine(p['contentType']) ?? '',
              taille: typeof p['size'] === 'number' ? p['size'] : 0,
              enLigne: p['isInline'] === true,
              contentId: null,
            });
          }
          lien = chaine(liste['@odata.nextLink']);
        }
      }
      return {
        id: chaine(m['id']) ?? idMessage,
        dateReception: new Date(recu),
        expediteur: adresseDe(m['from']) ?? '',
        destinataires: [
          ...new Set([...tableau(m['toRecipients']), ...tableau(m['ccRecipients'])].flatMap((d) => adresseDe(d) ?? [])),
        ],
        objet: chaine(m['subject']) ?? '',
        corpsTexte: estHtml ? null : contenu,
        corpsHtml: estHtml ? contenu : null,
        piecesJointes: pieces,
      };
    },

    async ouvrirPieceJointe(ctx, idMessage, piece) {
      const reponse = await ctx.requete(
        `${urls.api}/${racine(ctx.boite)}/messages/${encodeURIComponent(idMessage)}/attachments/${encodeURIComponent(piece.id)}/$value`,
        { headers: { prefer: PREFERENCE_ID } },
      );
      exigerSucces(reponse, 'contenu de la pièce jointe');
      if (reponse.body === null) throw new ErreurProtocole('Contenu de pièce jointe absent.');
      return reponse.body as unknown as AsyncIterable<Uint8Array>; // lu en flux, sans chargement complet en mémoire
    },

    async assurerSurveillance(ctx, p): Promise<EtatSurveillance> {
      if (ctx.boite.type === 'partagee') {
        return {
          mode: 'periodique',
          raison:
            'Boîte partagée : les permissions déléguées de partage (Mail.Read.Shared) ne permettent pas de s’abonner aux notifications. ' +
            'Les messages sont récupérés par la synchronisation périodique (delta), sans élargir les droits.',
        };
      }
      if (configuration.urlNotification === undefined) {
        return { mode: 'periodique', raison: 'Aucune URL de notification configurée : seule la synchronisation périodique est active.' };
      }
      const existants = p.actuelle?.mode === 'graph_abonnements' ? p.actuelle.abonnements : [];
      const echeance = new Date(p.maintenant.getTime() + DUREE_ABONNEMENT_MS).toISOString();
      const abonnements: { id: string; cle: string; echeance: string }[] = [];
      for (const cle of p.cles) {
        const existant = existants.find((a) => a.cle === cle);
        if (existant) {
          const reste = new Date(existant.echeance).getTime() - p.maintenant.getTime();
          if (!p.forcer && reste > MARGE_RENOUVELLEMENT_MS) {
            abonnements.push(existant);
            continue;
          }
          // Un seul PATCH renouvelle ET réautorise l'abonnement.
          const maj = await ctx.requete(`${urls.api}/subscriptions/${encodeURIComponent(existant.id)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expirationDateTime: echeance }),
          });
          if (maj.ok) {
            abonnements.push({ ...existant, echeance: chaine((await lireJson(maj))['expirationDateTime']) ?? echeance });
            continue;
          }
          if (maj.status !== 404) exigerSucces(maj, 'renouvellement de l’abonnement');
          // 404 : l'abonnement a expiré ou a été retiré → on le recrée.
        }
        const creation = await ctx.requete(`${urls.api}/subscriptions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', prefer: PREFERENCE_ID },
          body: JSON.stringify({
            changeType: 'created',
            notificationUrl: configuration.urlNotification,
            ...(configuration.urlCycleDeVie !== undefined ? { lifecycleNotificationUrl: configuration.urlCycleDeVie } : {}),
            resource: `me/mailFolders('${cle.replace(/'/g, "''")}')/messages`,
            expirationDateTime: echeance,
            clientState: p.etatClient,
          }),
        });
        exigerSucces(creation, 'création de l’abonnement');
        const corps = await lireJson(creation);
        const id = chaine(corps['id']);
        if (id === null) throw new ErreurProtocole('Identifiant d’abonnement absent.');
        abonnements.push({ id, cle, echeance: chaine(corps['expirationDateTime']) ?? echeance });
      }
      // Abonnements devenus inutiles (dossier retiré de la configuration).
      for (const ancien of existants.filter((a) => !p.cles.includes(a.cle))) {
        await ctx.requete(`${urls.api}/subscriptions/${encodeURIComponent(ancien.id)}`, { method: 'DELETE' });
      }
      return { mode: 'graph_abonnements', abonnements };
    },

    async arreterSurveillance(ctx, actuelle) {
      if (actuelle?.mode !== 'graph_abonnements') return;
      for (const abonnement of actuelle.abonnements) {
        await ctx.requete(`${urls.api}/subscriptions/${encodeURIComponent(abonnement.id)}`, { method: 'DELETE' });
      }
    },
  };
}
