/**
 * SIMULATEUR DE TEST — ce n'est ni Gmail ni Microsoft Graph.
 *
 * Serveur HTTP local qui imite le sous-ensemble des API Google (OAuth, Gmail) et Microsoft (identité, Graph)
 * utilisé par les adaptateurs réels, afin de les tester en ne changeant que l'URL de base.
 * - toutes ses réponses portent l'en-tête `X-Simulateur: comtaple-mail` ;
 * - il refuse de démarrer si `NODE_ENV=production` ;
 * - il n'écoute que sur 127.0.0.1 ;
 * - il ne permet jamais d'obtenir le statut d'intégration `connecte`.
 */
import { createHash, createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const NOM_SIMULATEUR = 'comtaple-mail';
export const COMPTE_SERVICE_PUBSUB_SIMULE = 'push-simule@projet-simule.iam.gserviceaccount.com';
export const LOCATAIRE_SIMULE = '11111111-2222-3333-4444-555555555555';

export interface PieceSimulee {
  nom: string;
  typeMime: string;
  contenu: Uint8Array;
  contentId?: string;
  enLigne?: boolean;
}

export interface MessageSimule {
  id?: string;
  /** Valeur brute de l'en-tête From. */
  de: string;
  a: string[];
  cc?: string[];
  objet: string;
  texte?: string;
  html?: string;
  date: Date;
  pieces?: PieceSimulee[];
}

type MessageStocke = Required<Pick<MessageSimule, 'id'>> & MessageSimule & { cles: string[]; ordre: number };

export interface RequeteObservee {
  methode: string;
  chemin: string;
  recherche: string;
}

export interface Injection {
  methode?: string;
  /** Motif appliqué au chemin de la requête. */
  chemin: RegExp;
  statut: number;
  entetes?: Record<string, string>;
  corps?: unknown;
  /** Nombre de requêtes concernées (par défaut : 1). */
  fois?: number;
}

interface JetonAcces {
  fournisseur: 'google' | 'microsoft';
  scopes: string[];
  valide: boolean;
}

interface CodeAutorisation {
  fournisseur: 'google' | 'microsoft';
  defi: string;
  nonce: string | null;
  scopes: string[];
  clientId: string;
}

function lireCorps(requete: IncomingMessage): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const blocs: Buffer[] = [];
    requete.on('data', (bloc: Buffer) => blocs.push(bloc));
    requete.on('end', () => resoudre(Buffer.concat(blocs).toString('utf8')));
    requete.on('error', rejeter);
  });
}

function ecouter(serveur: Server): Promise<string> {
  return new Promise((resoudre) => {
    serveur.listen(0, '127.0.0.1', () => resoudre(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`));
  });
}

const fermer = (serveur: Server): Promise<void> =>
  new Promise((resoudre) => {
    serveur.closeAllConnections();
    serveur.close(() => resoudre());
  });

export class SimulateurMail {
  /** Origine du simulateur (`http://127.0.0.1:<port>`). */
  origine = '';
  /** Origine du serveur piège : cible des liens placés dans les messages de test. Aucune requête ne doit y arriver. */
  originePiege = '';
  readonly requetes: RequeteObservee[] = [];
  readonly requetesPiege: RequeteObservee[] = [];
  /** Plafond de taille de page, pour forcer la pagination avec peu de messages. */
  taillePageMax = 100;
  readonly compteurs = { echanges: 0, rafraichissements: 0, revocations: 0 };
  /** Horloge du simulateur, remplaçable par l'horloge simulée des tests. */
  maintenant: () => Date = () => new Date();

  private serveur: Server | null = null;
  private piege: Server | null = null;
  private injections: Injection[] = [];
  private readonly jetons = new Map<string, JetonAcces>();
  private readonly rafraichissements = new Map<string, { fournisseur: 'google' | 'microsoft'; scopes: string[] }>();
  private readonly codes = new Map<string, CodeAutorisation>();
  private readonly revoques = new Set<'google' | 'microsoft'>();
  private sequence = 0;
  private readonly cle: { privee: KeyObject; publique: KeyObject };
  private readonly kid = 'cle-simulateur-1';

  readonly gmail = {
    adresse: 'compta@cabinet-simule.test',
    messages: new Map<string, MessageStocke>(),
    historique: [] as { id: number; idMessage: string; libelles: string[] }[],
    idHistorique: 1000,
    /** Tout `startHistoryId` inférieur est considéré comme expiré (404). */
    historiqueMin: 0,
    surveillance: null as { sujet: string; libelles: string[] } | null,
    appelsWatch: 0,
  };

  readonly microsoft = {
    adresse: 'compta@cabinet-simule.test',
    /** Boîtes par adresse ; `moi` désigne la boîte de l'utilisateur connecté. */
    boites: new Map<string, { messages: Map<string, MessageStocke>; journal: { seq: number; idMessage: string; dossier: string }[] }>(),
    seq: 0,
    /** Tout `$deltatoken` inférieur est considéré comme expiré (410). */
    deltaMin: 0,
    abonnements: new Map<string, { ressource: string; etatClient: string; echeance: string; reautorisations: number }>(),
  };

  constructor() {
    const paire = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.cle = { privee: paire.privateKey, publique: paire.publicKey };
    this.microsoft.boites.set('moi', { messages: new Map(), journal: [] });
  }

  // -------------------------------------------------------------------------------------------
  // Cycle de vie

  async demarrer(): Promise<this> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Le simulateur @comtaple/mail est un outil de test : il refuse de démarrer quand NODE_ENV=production.');
    }
    this.serveur = createServer((req, res) => {
      void this.traiter(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'x-simulateur': NOM_SIMULATEUR });
        res.end();
      });
    });
    this.piege = createServer((req, res) => {
      this.requetesPiege.push({ methode: req.method ?? '', chemin: req.url ?? '', recherche: '' });
      res.writeHead(200, { 'x-simulateur': NOM_SIMULATEUR, 'content-type': 'text/plain' });
      res.end('piège du simulateur');
    });
    this.origine = await ecouter(this.serveur);
    this.originePiege = await ecouter(this.piege);
    return this;
  }

  async arreter(): Promise<void> {
    if (this.serveur) await fermer(this.serveur);
    if (this.piege) await fermer(this.piege);
    this.serveur = null;
    this.piege = null;
  }

  /** URL à fournir aux adaptateurs réels à la place des URL officielles. */
  get urlsGmail() {
    return {
      autorisation: `${this.origine}/google/auth`,
      jeton: `${this.origine}/google/token`,
      revocation: `${this.origine}/google/revoke`,
      api: this.origine,
    };
  }

  get urlsMicrosoft() {
    return { connexion: `${this.origine}/ms`, api: `${this.origine}/graph/v1.0` };
  }

  get urlClesGoogle(): string {
    return `${this.origine}/google/certs`;
  }

  // -------------------------------------------------------------------------------------------
  // Pilotage par les tests

  injecterErreur(injection: Injection): void {
    this.injections.push({ ...injection, fois: injection.fois ?? 1 });
  }

  /** Les jetons de rafraîchissement du fournisseur sont refusés (`invalid_grant`). */
  revoquerAutorisation(fournisseur: 'google' | 'microsoft'): void {
    this.revoques.add(fournisseur);
  }

  /** Les jetons d'accès déjà émis sont refusés (401), comme s'ils avaient expiré. */
  expirerJetonsAcces(): void {
    for (const jeton of this.jetons.values()) jeton.valide = false;
  }

  /** Nombre de requêtes reçues dont le chemin correspond au motif. */
  compter(motif: RegExp, methode?: string): number {
    return this.requetes.filter((r) => motif.test(r.chemin) && (methode === undefined || r.methode === methode)).length;
  }

  ajouterMessageGmail(message: MessageSimule, libelles: string[] = ['INBOX']): string {
    const id = message.id ?? `gm-${++this.sequence}`;
    this.gmail.messages.set(id, { ...message, id, cles: libelles, ordre: ++this.sequence });
    this.gmail.historique.push({ id: ++this.gmail.idHistorique, idMessage: id, libelles });
    return id;
  }

  /** Rend inutilisables tous les historyId déjà distribués. */
  expirerHistoriqueGmail(): void {
    this.gmail.idHistorique += 1000;
    this.gmail.historiqueMin = this.gmail.idHistorique;
  }

  ajouterMessageMicrosoft(message: MessageSimule, options: { dossier?: string; boite?: string } = {}): string {
    const cleBoite = options.boite?.toLowerCase() ?? 'moi';
    let boite = this.microsoft.boites.get(cleBoite);
    if (!boite) {
      boite = { messages: new Map(), journal: [] };
      this.microsoft.boites.set(cleBoite, boite);
    }
    const dossier = options.dossier ?? 'inbox';
    const id = message.id ?? `ms-${++this.sequence}`;
    boite.messages.set(id, { ...message, id, cles: [dossier], ordre: ++this.sequence });
    boite.journal.push({ seq: ++this.microsoft.seq, idMessage: id, dossier });
    return id;
  }

  expirerDeltaMicrosoft(): void {
    this.microsoft.seq += 1000;
    this.microsoft.deltaMin = this.microsoft.seq;
  }

  /** Corps d'un push Pub/Sub tel que Gmail le publie (adresse + historyId, rien d'autre). */
  corpsPushGmail(idHistorique: number = this.gmail.idHistorique): unknown {
    const donnees = JSON.stringify({ emailAddress: this.gmail.adresse, historyId: idHistorique });
    return {
      message: { data: Buffer.from(donnees).toString('base64url'), messageId: String(++this.sequence), publishTime: new Date().toISOString() },
      subscription: 'projects/projet-simule/subscriptions/gmail-push',
    };
  }

  /** Jeton OIDC tel que Pub/Sub le joint à un push authentifié (signé par la clé du simulateur). */
  jetonPushPubSub(revendications: Record<string, unknown>): string {
    return this.signer({
      iss: 'https://accounts.google.com',
      email: COMPTE_SERVICE_PUBSUB_SIMULE,
      email_verified: true,
      sub: '1234567890',
      ...revendications,
    });
  }

  /** Corps d'une notification Graph (changement, ou cycle de vie si `evenement` est fourni). */
  corpsNotificationGraph(idAbonnement: string, evenement?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed'): unknown {
    const abonnement = this.microsoft.abonnements.get(idAbonnement);
    return {
      value: [
        {
          subscriptionId: idAbonnement,
          clientState: abonnement?.etatClient,
          tenantId: LOCATAIRE_SIMULE,
          ...(evenement !== undefined
            ? { lifecycleEvent: evenement }
            : { changeType: 'created', resource: 'Users/x/Messages/y', resourceData: { id: 'y' } }),
        },
      ],
    };
  }

  // -------------------------------------------------------------------------------------------
  // Serveur

  private signer(charge: Record<string, unknown>): string {
    const entete = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid })).toString('base64url');
    const corps = Buffer.from(JSON.stringify(charge)).toString('base64url');
    const signature = createSign('RSA-SHA256').update(`${entete}.${corps}`).sign(this.cle.privee).toString('base64url');
    return `${entete}.${corps}.${signature}`;
  }

  private async traiter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origine);
    const methode = req.method ?? 'GET';
    const corps = await lireCorps(req);
    this.requetes.push({ methode, chemin: decodeURIComponent(url.pathname), recherche: url.search });
    res.setHeader('x-simulateur', NOM_SIMULATEUR);

    const repondre = (statut: number, charge?: unknown, entetes: Record<string, string> = {}): void => {
      if (charge === undefined) {
        res.writeHead(statut, entetes);
        res.end();
      } else if (charge instanceof Uint8Array) {
        res.writeHead(statut, { 'content-type': 'application/octet-stream', ...entetes });
        res.end(charge);
      } else if (typeof charge === 'string') {
        res.writeHead(statut, { 'content-type': 'text/plain', ...entetes });
        res.end(charge);
      } else {
        res.writeHead(statut, { 'content-type': 'application/json', ...entetes });
        res.end(JSON.stringify(charge));
      }
    };

    const chemin = decodeURIComponent(url.pathname);
    const injection = this.injections.find((i) => i.chemin.test(chemin) && (i.methode === undefined || i.methode === methode));
    if (injection) {
      injection.fois = (injection.fois ?? 1) - 1;
      if (injection.fois <= 0) this.injections = this.injections.filter((i) => i !== injection);
      repondre(injection.statut, injection.corps ?? { error: { code: injection.statut, message: 'erreur injectée par le simulateur' } }, injection.entetes);
      return;
    }

    if (chemin.startsWith('/google/')) return this.traiterOAuth('google', chemin.slice('/google'.length), methode, url, corps, repondre);
    if (chemin.startsWith('/ms/')) return this.traiterOAuth('microsoft', chemin.slice('/ms'.length), methode, url, corps, repondre);

    const jeton = this.jetons.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
    if (chemin.startsWith('/gmail/v1/users/me/')) {
      if (!jeton?.valide || jeton.fournisseur !== 'google') {
        return repondre(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
      }
      return this.traiterGmail(chemin.slice('/gmail/v1/users/me'.length), methode, url, corps, repondre);
    }
    if (chemin.startsWith('/graph/v1.0/')) {
      if (!jeton?.valide || jeton.fournisseur !== 'microsoft') {
        return repondre(401, { error: { code: 'InvalidAuthenticationToken', message: 'jeton refusé' } });
      }
      return this.traiterGraph(chemin.slice('/graph/v1.0'.length), methode, url, corps, repondre, jeton, req.headers.prefer ?? '');
    }
    repondre(404, { error: 'route inconnue du simulateur' });
  }

  private traiterOAuth(
    fournisseur: 'google' | 'microsoft',
    chemin: string,
    methode: string,
    url: URL,
    corps: string,
    repondre: (statut: number, charge?: unknown, entetes?: Record<string, string>) => void,
  ): void {
    const q = url.searchParams;
    if (methode === 'GET' && (chemin === '/auth' || chemin.endsWith('/oauth2/v2.0/authorize'))) {
      // Consentement simulé : accordé d'office, redirection immédiate avec le code et le state.
      const code = `simulateur-code-${randomUUID()}`;
      this.codes.set(code, {
        fournisseur,
        defi: q.get('code_challenge') ?? '',
        nonce: q.get('nonce'),
        scopes: (q.get('scope') ?? '').split(' ').filter(Boolean),
        clientId: q.get('client_id') ?? '',
      });
      const retour = new URL(q.get('redirect_uri') ?? 'http://localhost/');
      retour.searchParams.set('code', code);
      retour.searchParams.set('state', q.get('state') ?? '');
      return repondre(302, undefined, { location: retour.toString() });
    }
    if (methode === 'GET' && (chemin === '/certs' || chemin === '/common/discovery/v2.0/keys')) {
      return repondre(200, { keys: [{ ...this.cle.publique.export({ format: 'jwk' }), kid: this.kid, alg: 'RS256', use: 'sig' }] });
    }
    if (methode === 'POST' && chemin === '/revoke') {
      this.compteurs.revocations++;
      this.revoques.add('google');
      return repondre(200, {});
    }
    if (methode === 'POST' && (chemin === '/token' || chemin.endsWith('/oauth2/v2.0/token'))) {
      const p = new URLSearchParams(corps);
      let scopes: string[];
      let nonce: string | null = null;
      let clientId = p.get('client_id') ?? '';
      if (p.get('grant_type') === 'authorization_code') {
        this.compteurs.echanges++;
        const code = this.codes.get(p.get('code') ?? '');
        const defi = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
        if (!code || code.fournisseur !== fournisseur || code.defi !== defi) {
          return repondre(400, { error: 'invalid_grant', error_description: 'code ou vérifieur PKCE refusé (simulateur)' });
        }
        this.codes.delete(p.get('code') ?? '');
        scopes = code.scopes;
        nonce = code.nonce;
        clientId = code.clientId;
      } else if (p.get('grant_type') === 'refresh_token') {
        this.compteurs.rafraichissements++;
        const connu = this.rafraichissements.get(p.get('refresh_token') ?? '');
        if (!connu || connu.fournisseur !== fournisseur || this.revoques.has(fournisseur)) {
          return repondre(400, { error: 'invalid_grant', error_description: 'jeton révoqué (simulateur)' });
        }
        scopes = connu.scopes;
        if (fournisseur === 'microsoft') this.rafraichissements.delete(p.get('refresh_token') ?? ''); // rotation
      } else {
        return repondre(400, { error: 'unsupported_grant_type' });
      }
      const acces = `simulateur-acces-${randomUUID()}`;
      this.jetons.set(acces, { fournisseur, scopes, valide: true });
      const reponse: Record<string, unknown> = { access_token: acces, token_type: 'Bearer', expires_in: 3599, scope: scopes.join(' ') };
      if (p.get('grant_type') === 'authorization_code' || fournisseur === 'microsoft') {
        const rafraichissement = `simulateur-rafraichissement-${randomUUID()}`;
        this.rafraichissements.set(rafraichissement, { fournisseur, scopes });
        reponse['refresh_token'] = rafraichissement;
      }
      if (fournisseur === 'microsoft' && scopes.includes('openid') && p.get('grant_type') === 'authorization_code') {
        const maintenant = Math.floor(this.maintenant().getTime() / 1000);
        reponse['id_token'] = this.signer({
          iss: `${this.origine}/ms/${LOCATAIRE_SIMULE}/v2.0`,
          aud: clientId,
          tid: LOCATAIRE_SIMULE,
          oid: '00000000-0000-0000-0000-00000000abcd',
          sub: 'sujet-simule',
          preferred_username: this.microsoft.adresse,
          nonce,
          iat: maintenant,
          exp: maintenant + 3600,
        });
      }
      return repondre(200, reponse);
    }
    repondre(404, { error: 'route OAuth inconnue du simulateur' });
  }

  // -------------------------------------------------------------------------------------------
  // Gmail

  private partiesGmail(message: MessageStocke): Record<string, unknown> {
    const parties: Record<string, unknown>[] = [];
    if (message.texte !== undefined) {
      parties.push({ partId: String(parties.length), mimeType: 'text/plain', filename: '', headers: [], body: { size: message.texte.length, data: Buffer.from(message.texte).toString('base64url') } });
    }
    if (message.html !== undefined) {
      parties.push({ partId: String(parties.length), mimeType: 'text/html', filename: '', headers: [], body: { size: message.html.length, data: Buffer.from(message.html).toString('base64url') } });
    }
    (message.pieces ?? []).forEach((piece, indice) => {
      const entetes = [{ name: 'Content-Disposition', value: `${piece.enLigne ? 'inline' : 'attachment'}; filename="${piece.nom}"` }];
      if (piece.contentId !== undefined) entetes.push({ name: 'Content-ID', value: `<${piece.contentId}>` });
      parties.push({
        partId: String(parties.length),
        mimeType: piece.typeMime,
        filename: piece.nom,
        headers: entetes,
        // Comme le vrai service, l'identifiant de téléchargement change à chaque lecture du message.
        body: { attachmentId: `tel-${indice}-${randomUUID()}`, size: piece.contenu.byteLength },
      });
    });
    return {
      partId: '',
      mimeType: 'multipart/mixed',
      filename: '',
      headers: [
        { name: 'From', value: message.de },
        { name: 'To', value: message.a.join(', ') },
        ...(message.cc?.length ? [{ name: 'Cc', value: message.cc.join(', ') }] : []),
        { name: 'Subject', value: message.objet },
      ],
      body: { size: 0 },
      parts: parties,
    };
  }

  private traiterGmail(
    chemin: string,
    methode: string,
    url: URL,
    corps: string,
    repondre: (statut: number, charge?: unknown, entetes?: Record<string, string>) => void,
  ): void {
    const g = this.gmail;
    const q = url.searchParams;
    const taillePage = Math.max(1, Math.min(Number(q.get('maxResults') ?? 100), this.taillePageMax));
    const debut = Number(q.get('pageToken') ?? 0);

    if (methode === 'GET' && chemin === '/profile') {
      return repondre(200, { emailAddress: g.adresse, messagesTotal: g.messages.size, threadsTotal: g.messages.size, historyId: String(g.idHistorique) });
    }
    if (methode === 'GET' && chemin === '/messages') {
      const apres = Number(/after:(\d+)/.exec(q.get('q') ?? '')?.[1] ?? 0);
      const libelles = q.getAll('labelIds');
      const tous = [...g.messages.values()]
        .filter((m) => libelles.every((l) => m.cles.includes(l)) && m.date.getTime() / 1000 >= apres)
        .sort((a, b) => b.date.getTime() - a.date.getTime() || b.ordre - a.ordre);
      const page = tous.slice(debut, debut + taillePage);
      return repondre(200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.id })),
        ...(debut + taillePage < tous.length ? { nextPageToken: String(debut + taillePage) } : {}),
        resultSizeEstimate: tous.length,
      });
    }
    if (methode === 'GET' && chemin === '/history') {
      const depart = Number(q.get('startHistoryId'));
      if (!Number.isFinite(depart) || depart < g.historiqueMin) {
        return repondre(404, { error: { code: 404, message: 'Requested entity was not found.', errors: [{ reason: 'notFound' }] } });
      }
      const libelle = q.get('labelId');
      const tous = g.historique.filter((h) => h.id > depart && (libelle === null || h.libelles.includes(libelle)));
      const page = tous.slice(debut, debut + taillePage);
      return repondre(200, {
        history: page.map((h) => ({
          id: String(h.id),
          messages: [{ id: h.idMessage, threadId: h.idMessage }],
          messagesAdded: [{ message: { id: h.idMessage, threadId: h.idMessage, labelIds: h.libelles } }],
        })),
        ...(debut + taillePage < tous.length ? { nextPageToken: String(debut + taillePage) } : {}),
        historyId: String(g.idHistorique),
      });
    }
    const piece = /^\/messages\/([^/]+)\/attachments\/tel-(\d+)-/.exec(chemin);
    if (methode === 'GET' && piece) {
      const contenu = g.messages.get(piece[1] ?? '')?.pieces?.[Number(piece[2])]?.contenu;
      if (!contenu) return repondre(404, { error: { code: 404, message: 'Not Found' } });
      return repondre(200, { size: contenu.byteLength, data: Buffer.from(contenu).toString('base64url') });
    }
    const message = /^\/messages\/([^/]+)$/.exec(chemin);
    if (methode === 'GET' && message) {
      const m = g.messages.get(message[1] ?? '');
      if (!m) return repondre(404, { error: { code: 404, message: 'Not Found' } });
      return repondre(200, {
        id: m.id,
        threadId: m.id,
        labelIds: m.cles,
        snippet: '',
        historyId: String(g.idHistorique),
        internalDate: String(m.date.getTime()),
        sizeEstimate: 0,
        payload: this.partiesGmail(m),
      });
    }
    if (methode === 'POST' && chemin === '/watch') {
      const demande = JSON.parse(corps || '{}') as { topicName?: string; labelIds?: string[] };
      g.appelsWatch++;
      g.surveillance = { sujet: demande.topicName ?? '', libelles: demande.labelIds ?? [] };
      return repondre(200, { historyId: String(g.idHistorique), expiration: String(this.maintenant().getTime() + 7 * 24 * 3600 * 1000) });
    }
    if (methode === 'POST' && chemin === '/stop') {
      g.surveillance = null;
      return repondre(200, {});
    }
    repondre(404, { error: { code: 404, message: 'route Gmail inconnue du simulateur' } });
  }

  // -------------------------------------------------------------------------------------------
  // Microsoft Graph

  private traiterGraph(
    chemin: string,
    methode: string,
    url: URL,
    corps: string,
    repondre: (statut: number, charge?: unknown, entetes?: Record<string, string>) => void,
    jeton: JetonAcces,
    preference: string | string[],
  ): void {
    const ms = this.microsoft;
    const q = url.searchParams;
    const scopes = jeton.scopes.map((s) => s.toLowerCase().replace('https://graph.microsoft.com/', ''));

    // Abonnements
    const abonnement = /^\/subscriptions(?:\/([^/]+))?(\/reauthorize)?$/.exec(chemin);
    if (abonnement) {
      const id = abonnement[1];
      if (methode === 'POST' && id === undefined) {
        const demande = JSON.parse(corps) as { resource: string; clientState: string; expirationDateTime: string };
        // Les permissions déléguées ne permettent de s'abonner qu'à la boîte de l'utilisateur connecté.
        if (!/^\/?me\//i.test(demande.resource)) return repondre(403, { error: { code: 'ExtensionError', message: 'abonnement refusé (simulateur)' } });
        const nouvelId = randomUUID();
        ms.abonnements.set(nouvelId, { ressource: demande.resource, etatClient: demande.clientState, echeance: demande.expirationDateTime, reautorisations: 0 });
        return repondre(201, { id: nouvelId, resource: demande.resource, expirationDateTime: demande.expirationDateTime });
      }
      const existant = id !== undefined ? ms.abonnements.get(id) : undefined;
      if (!existant || id === undefined) return repondre(404, { error: { code: 'ResourceNotFound', message: 'abonnement inconnu' } });
      if (methode === 'POST' && abonnement[2]) {
        existant.reautorisations++;
        return repondre(204);
      }
      if (methode === 'PATCH') {
        existant.echeance = (JSON.parse(corps) as { expirationDateTime: string }).expirationDateTime;
        existant.reautorisations++;
        return repondre(200, { id, resource: existant.ressource, expirationDateTime: existant.echeance });
      }
      if (methode === 'DELETE') {
        ms.abonnements.delete(id);
        return repondre(204);
      }
    }

    const cible = /^\/(me|users\/[^/]+)(\/.*)$/.exec(chemin);
    if (!cible || methode !== 'GET') return repondre(404, { error: { code: 'BadRequest', message: 'route Graph inconnue du simulateur' } });
    const utilisateur = cible[1] === 'me' ? 'moi' : (cible[1] ?? '').slice('users/'.length).toLowerCase();
    const racine = `${this.origine}/graph/v1.0/${cible[1] === 'me' ? 'me' : `users/${encodeURIComponent(utilisateur)}`}`;
    const reste = cible[2] ?? '';
    if (utilisateur === 'moi' ? !scopes.includes('mail.read') : !scopes.includes('mail.read.shared')) {
      return repondre(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } });
    }
    const boite = ms.boites.get(utilisateur);
    if (!boite) return repondre(404, { error: { code: 'ErrorItemNotFound', message: 'boîte inconnue' } });

    const delta = /^\/mailFolders\/([^/]+)\/messages\/delta$/.exec(reste);
    if (delta) {
      const dossier = (delta[1] ?? '').toLowerCase();
      let depuis = 0;
      let decalage = 0;
      let cibleSeq = ms.seq;
      const jetonDelta = q.get('$deltatoken');
      const jetonSuite = q.get('$skiptoken');
      if (jetonDelta !== null) depuis = Number(jetonDelta);
      if (jetonSuite !== null) [depuis, decalage, cibleSeq] = jetonSuite.split(':').map(Number) as [number, number, number];
      // Expirés : un jeton delta antérieur à la purge, ou une page d'un tour commencé avant la purge.
      if ((jetonDelta !== null && depuis < ms.deltaMin) || (jetonSuite !== null && cibleSeq < ms.deltaMin)) {
        return repondre(410, { error: { code: 'SyncStateNotFound', message: 'état de synchronisation introuvable (simulateur)' } });
      }
      const demande = Number(/odata\.maxpagesize=(\d+)/.exec(String(preference))?.[1] ?? 10);
      const taille = Math.max(1, Math.min(demande, this.taillePageMax));
      const tous = boite.journal.filter((e) => e.dossier.toLowerCase() === dossier && e.seq > depuis && e.seq <= cibleSeq);
      const page = tous.slice(decalage, decalage + taille);
      const base = `${racine}/mailFolders/${encodeURIComponent(delta[1] ?? '')}/messages/delta`;
      const suite = decalage + taille < tous.length;
      return repondre(200, {
        value: page.map((e) => ({ id: e.idMessage, receivedDateTime: boite.messages.get(e.idMessage)?.date.toISOString() })),
        ...(suite
          ? { '@odata.nextLink': `${base}?$skiptoken=${depuis}:${decalage + taille}:${cibleSeq}` }
          : { '@odata.deltaLink': `${base}?$deltatoken=${cibleSeq}` }),
      });
    }

    if (/^\/mailFolders\/[^/]+$/.test(reste)) return repondre(200, { id: 'dossier-simule' });

    const contenu = /^\/messages\/([^/]+)\/attachments\/pj-(\d+)\/\$value$/.exec(reste);
    if (contenu) {
      const octets = boite.messages.get(contenu[1] ?? '')?.pieces?.[Number(contenu[2])]?.contenu;
      return octets ? repondre(200, octets) : repondre(404, { error: { code: 'ErrorItemNotFound', message: 'pièce inconnue' } });
    }
    const pieces = /^\/messages\/([^/]+)\/attachments$/.exec(reste);
    if (pieces) {
      const m = boite.messages.get(pieces[1] ?? '');
      if (!m) return repondre(404, { error: { code: 'ErrorItemNotFound', message: 'message inconnu' } });
      return repondre(200, {
        value: (m.pieces ?? []).map((p, i) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: `pj-${i}`,
          name: p.nom,
          contentType: p.typeMime,
          size: p.contenu.byteLength,
          isInline: p.enLigne === true,
        })),
      });
    }
    const message = /^\/messages\/([^/]+)$/.exec(reste);
    if (message) {
      const m = boite.messages.get(message[1] ?? '');
      if (!m) return repondre(404, { error: { code: 'ErrorItemNotFound', message: 'message inconnu' } });
      const adresse = (brut: string) => ({ emailAddress: { address: /<([^>]+)>/.exec(brut)?.[1] ?? brut, name: brut } });
      return repondre(200, {
        id: m.id,
        subject: m.objet,
        from: adresse(m.de),
        toRecipients: m.a.map(adresse),
        ccRecipients: (m.cc ?? []).map(adresse),
        receivedDateTime: m.date.toISOString(),
        // Comme le vrai service : les pièces en ligne ne comptent pas.
        hasAttachments: (m.pieces ?? []).some((p) => p.enLigne !== true),
        body: m.html !== undefined ? { contentType: 'html', content: m.html } : { contentType: 'text', content: m.texte ?? '' },
      });
    }
    repondre(404, { error: { code: 'BadRequest', message: 'route Graph inconnue du simulateur' } });
  }
}

/** Démarre le simulateur de test. Refuse de démarrer si `NODE_ENV=production`. */
export function demarrerSimulateur(): Promise<SimulateurMail> {
  return new SimulateurMail().demarrer();
}
