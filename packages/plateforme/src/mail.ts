/**
 * Branchement de @comtaple/mail sur la plateforme : configuration des connecteurs, implémentation des ports
 * (état des connexions dans PostgreSQL, réception des pièces, journal), verrou par connexion.
 * Utilisé par l'API (connexion, déconnexion, notifications) et par le worker (synchronisation, surveillance).
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { type AccesBd, and, type ContexteAcces, eq, journaliser, schema as s } from '@comtaple/db';
import {
  creerFournisseurGmail,
  creerFournisseurMicrosoft,
  creerMoteurMail,
  resoudreDateDebut,
  URL_CLES_GOOGLE,
  type EtatConnexion,
  type EvenementJournal,
  type ExtraitQualification,
  type FournisseurMail,
  type IdFournisseur,
  type Journal,
  type MagasinConnexions,
  type MoteurMail,
  type ProvenanceDepot,
  type Rattachement,
  type RecepteurPieces,
  type Signalement,
  type Trousseau,
} from '@comtaple/mail';
import type { Config } from './config.js';
import type { Files } from './files.js';
import { assurerFichierOriginal, enregistrerReception } from './reception.js';
import { cles, type Stockage } from './stockage.js';

export type FournisseurBd = (typeof s.fournisseurMail.enumValues)[number];
export const fournisseurVersBd = (f: IdFournisseur): FournisseurBd => (f === 'microsoft' ? 'microsoft365' : 'gmail');
export const fournisseurDepuisBd = (f: FournisseurBd): IdFournisseur => (f === 'microsoft365' ? 'microsoft' : 'gmail');

// ───────────────────────────── Clés ─────────────────────────────

export interface ClesMail {
  /** Clé AES-256 des jetons OAuth (dérivée, avec son identifiant pour la rotation). */
  trousseau: Trousseau;
  /** Secret de liaison du `state` OAuth à l'utilisateur et au cabinet. */
  secretEtat: Buffer;
  /** Clé AES-256 des demandes d'autorisation en attente (vérifieur PKCE). */
  cleDemandes: Buffer;
}

/**
 * Dérive les clés de la collecte par mail (HKDF-SHA256) ; `null` si le secret est absent ou trop court.
 * Rotation du secret : le nouveau secret chiffre ; les anciens (`JETONS_CLES_ANCIENNES`) ne servent qu'à déchiffrer
 * les jetons pas encore rechiffrés, reconnus par l'identifiant de clé porté par chaque enveloppe.
 */
export function clesMail(cfg: Pick<Config, 'JETONS_CLE_CHIFFREMENT'> & Partial<Pick<Config, 'JETONS_CLES_ANCIENNES'>>): ClesMail | null {
  if (cfg.JETONS_CLE_CHIFFREMENT.length < 32) return null;
  const deriverDe = (secret: string, usage: string): Buffer => Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('comtaple-mail', 'utf8'), usage, 32));
  const deriver = (usage: string): Buffer => deriverDe(cfg.JETONS_CLE_CHIFFREMENT, usage);
  const cleDe = (secret: string) => {
    const cle = deriverDe(secret, 'jetons-oauth-v1');
    return { id: `k-${createHash('sha256').update(cle).digest('hex').slice(0, 12)}`, cle };
  };
  const anciennes = (cfg.JETONS_CLES_ANCIENNES ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length >= 32 && x !== cfg.JETONS_CLE_CHIFFREMENT)
    .map(cleDe);
  return {
    trousseau: { courante: cleDe(cfg.JETONS_CLE_CHIFFREMENT), ...(anciennes.length ? { anciennes } : {}) },
    secretEtat: deriver('state-oauth-v1'),
    cleDemandes: deriver('demandes-oauth-v1'),
  };
}

/** Chiffre une petite valeur JSON (AES-256-GCM, données associées obligatoires). */
export function chiffrerJson(cle: Buffer, associe: string, valeur: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(Buffer.from(associe, 'utf8'));
  const chiffre = Buffer.concat([c.update(JSON.stringify(valeur), 'utf8'), c.final()]);
  return ['d1', iv.toString('base64url'), chiffre.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function dechiffrerJson<T>(cle: Buffer, associe: string, enveloppe: string): T {
  const [version, iv, chiffre, etiquette] = enveloppe.split('.');
  if (version !== 'd1' || !iv || !chiffre || !etiquette) throw new Error('Enveloppe chiffrée de format inconnu.');
  const d = createDecipheriv('aes-256-gcm', cle, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(associe, 'utf8'));
  d.setAuthTag(Buffer.from(etiquette, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(chiffre, 'base64url')), d.final()]).toString('utf8')) as T;
}

// ───────────────────────────── Connecteurs ─────────────────────────────

export interface EtatConnecteur {
  configure: boolean;
  /** Raison affichable quand le connecteur n'est pas utilisable. */
  detail: string;
}

export interface ConnecteursMail {
  fournisseurs: Partial<Record<IdFournisseur, FournisseurMail>>;
  etat: Record<IdFournisseur, EtatConnecteur>;
  /** Les URL des fournisseurs sont remplacées par celles du simulateur de test. */
  simulateur: boolean;
  urlClesGoogle: string;
  cles: ClesMail | null;
}

export const CHEMIN_NOTIFICATIONS_GMAIL = '/v1/mail/notifications/gmail';
export const CHEMIN_NOTIFICATIONS_MICROSOFT = '/v1/mail/notifications/microsoft';

/**
 * Construit les connecteurs à partir de la configuration. Sans identifiants de client OAuth, un connecteur n'existe pas :
 * il est « non connecté » et aucune connexion ne peut être démarrée. Les URL officielles sont celles par défaut de
 * @comtaple/mail ; elles ne sont remplacées que par `MAIL_SIMULATEUR_URL` (tests, refusé en production).
 */
export function connecteursMail(cfg: Config): ConnecteursMail {
  const clesDerivees = clesMail(cfg);
  const sim = cfg.MAIL_SIMULATEUR_URL.replace(/\/$/, '');
  const simulateur = sim !== '';
  const uriRedirection = cfg.MAIL_URI_REDIRECTION !== '' ? cfg.MAIL_URI_REDIRECTION : `${cfg.WEB_URL}/connexions-mail/retour`;
  const urlPublique = cfg.MAIL_URL_PUBLIQUE_API.replace(/\/$/, '');
  const fournisseurs: Partial<Record<IdFournisseur, FournisseurMail>> = {};
  const sansCle = 'Clé de chiffrement des jetons absente ou trop courte (JETONS_CLE_CHIFFREMENT).';
  const etat: Record<IdFournisseur, EtatConnecteur> = {
    gmail: { configure: false, detail: 'Connecteur non configuré : aucune application OAuth Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).' },
    microsoft: { configure: false, detail: 'Connecteur non configuré : aucune application OAuth Microsoft (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).' },
  };

  if (cfg.GOOGLE_CLIENT_ID !== '' && cfg.GOOGLE_CLIENT_SECRET !== '') {
    if (!clesDerivees) etat.gmail = { configure: false, detail: sansCle };
    else {
      fournisseurs.gmail = creerFournisseurGmail({
        client: { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET, uriRedirection },
        ...(cfg.GOOGLE_SUJET_PUBSUB !== '' ? { sujetPubSub: cfg.GOOGLE_SUJET_PUBSUB } : {}),
        // Disposition des chemins du simulateur de test (voir packages/mail/src/simulateur).
        ...(simulateur ? { urls: { autorisation: `${sim}/google/auth`, jeton: `${sim}/google/token`, revocation: `${sim}/google/revoke`, api: sim } } : {}),
      });
      etat.gmail = { configure: true, detail: simulateur ? 'Simulateur de test : aucune connexion réelle.' : 'Application OAuth configurée.' };
    }
  }
  if (cfg.MICROSOFT_CLIENT_ID !== '' && cfg.MICROSOFT_CLIENT_SECRET !== '') {
    if (!clesDerivees) etat.microsoft = { configure: false, detail: sansCle };
    else {
      const notifications = urlPublique !== '' && (simulateur || urlPublique.startsWith('https://'));
      fournisseurs.microsoft = creerFournisseurMicrosoft({
        client: { clientId: cfg.MICROSOFT_CLIENT_ID, clientSecret: cfg.MICROSOFT_CLIENT_SECRET, uriRedirection },
        locataire: cfg.MICROSOFT_LOCATAIRE,
        ...(notifications
          ? { urlNotification: `${urlPublique}${CHEMIN_NOTIFICATIONS_MICROSOFT}`, urlCycleDeVie: `${urlPublique}${CHEMIN_NOTIFICATIONS_MICROSOFT}` }
          : {}),
        ...(simulateur ? { urls: { connexion: `${sim}/ms`, api: `${sim}/graph/v1.0` } } : {}),
      });
      etat.microsoft = { configure: true, detail: simulateur ? 'Simulateur de test : aucune connexion réelle.' : 'Application OAuth configurée.' };
    }
  }
  return { fournisseurs, etat, simulateur, urlClesGoogle: simulateur ? `${sim}/google/certs` : URL_CLES_GOOGLE, cles: clesDerivees };
}

// ───────────────────────────── Ports ─────────────────────────────

/** État des connexions dans `connexions_mail` : `etat` (jsonb, sans jeton) + enveloppe chiffrée dans sa colonne. */
export class MagasinConnexionsPg implements MagasinConnexions {
  constructor(
    private readonly bd: AccesBd,
    /** Contexte de sécurité : cabinet de la tâche (worker) ou identité vérifiée (API). */
    private readonly ctx: ContexteAcces & { cabinetId: string },
  ) {}

  async lire(connexionId: string): Promise<EtatConnexion | null> {
    const [ligne] = await this.bd.avecContexte(this.ctx, (tx) => tx.select().from(s.connexionsMail).where(eq(s.connexionsMail.id, connexionId)));
    if (!ligne?.etat) return null;
    return { ...(ligne.etat as Omit<EtatConnexion, 'jetonsChiffres'>), jetonsChiffres: ligne.jetonsChiffres };
  }

  async enregistrer(etat: EtatConnexion): Promise<void> {
    const { jetonsChiffres, ...sansJetons } = etat;
    const echeances =
      etat.surveillance?.mode === 'gmail_watch'
        ? [etat.surveillance.echeance]
        : etat.surveillance?.mode === 'graph_abonnements'
          ? etat.surveillance.abonnements.map((a) => a.echeance)
          : [];
    const valeurs = {
      fournisseur: fournisseurVersBd(etat.fournisseur),
      adresse: etat.adresse ?? '',
      statut: etat.statut,
      scopesAccordes: etat.scopesAccordes,
      jetonsChiffres,
      filtres: etat.configuration.filtres,
      dateDebutRecuperation: resoudreDateDebut(etat.configuration, new Date(etat.connecteeLe)).toISOString().slice(0, 10),
      derniereSynchro: etat.derniereSynchronisation,
      derniereErreur: etat.motifStatut,
      etat: sansJetons,
      surveillanceEcheance: echeances.length > 0 ? echeances.sort()[0]! : null,
    };
    await this.bd.avecContexte(this.ctx, (tx) =>
      tx
        .insert(s.connexionsMail)
        .values({ id: etat.id, cabinetId: this.ctx.cabinetId, creePar: this.ctx.utilisateurId ?? null, ...valeurs })
        .onConflictDoUpdate({ target: s.connexionsMail.id, set: valeurs }),
    );
  }
}

const EVENEMENTS_AUDITES = new Set([
  'connexion.creee',
  'connexion.arretee',
  'connexion.supprimee',
  'connexion.revocation_echouee',
  'synchronisation.curseur_expire',
  'synchronisation.erreur',
  'signalement',
  'surveillance.cycle_de_vie',
]);

/**
 * Journal du moteur : les événements notables vont au journal d'audit (sans jeton, sans contenu, sans adresse complète —
 * garanti par @comtaple/mail) ; les autres restent des traces techniques.
 */
export class JournalMail implements Journal {
  private tampon: EvenementJournal[] = [];

  consigner(e: EvenementJournal): void {
    const fin = e.type === 'synchronisation.fin' && (e.donnees?.['issue'] !== 'terminee' || Number(e.donnees?.['piecesDeposees'] ?? 0) > 0);
    if (EVENEMENTS_AUDITES.has(e.type) || fin) this.tampon.push(e);
    else if (e.type === 'http.reprise') console.log(`[mail] reprise HTTP (statut ${String(e.donnees?.['statut'])}) connexion ${e.connexionId ?? '-'}`);
  }

  /** Écrit les événements retenus dans `journal_audit`. */
  async vider(bd: AccesBd, ctx: ContexteAcces & { cabinetId: string }): Promise<void> {
    const evenements = this.tampon;
    this.tampon = [];
    if (evenements.length === 0) return;
    await bd.avecContexte(ctx, async (tx) => {
      for (const e of evenements) {
        await journaliser(tx, {
          cabinetId: ctx.cabinetId,
          acteurId: ctx.utilisateurId ?? null,
          acteurType: ctx.utilisateurId ? 'utilisateur' : 'systeme',
          action: `mail.${e.type}`,
          cibleType: 'connexion_mail',
          cibleId: e.connexionId ?? null,
          details: e.donnees ?? {},
        });
      }
    });
  }
}

const TYPES_PAR_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  xml: 'application/xml',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Réception des pièces venues du mail. Même logique que le téléversement : original adressé par empreinte,
 * doublon binaire dans le dossier = nouvelle occurrence de réception. Une pièce au rattachement ambigu n'est
 * rattachée à aucun dossier : elle va dans `pieces_a_qualifier`.
 */
export class RecepteurPiecesPg implements RecepteurPieces {
  constructor(
    private readonly c: { bd: AccesBd; stockage: Stockage; taches: Files },
    private readonly cabinetId: string,
  ) {}

  async pieceDejaVue(connexionId: string, idMessage: string, idPieceJointe: string): Promise<boolean> {
    const lignes = await this.c.bd.avecContexte({ cabinetId: this.cabinetId }, (tx) =>
      tx
        .select({ id: s.piecesMailVues.id })
        .from(s.piecesMailVues)
        .where(and(eq(s.piecesMailVues.connexionId, connexionId), eq(s.piecesMailVues.idMessage, idMessage), eq(s.piecesMailVues.idPieceJointe, idPieceJointe))),
    );
    return lignes.length > 0;
  }

  async deposer(flux: AsyncIterable<Uint8Array>, provenance: ProvenanceDepot, rattachement: Rattachement, extrait: ExtraitQualification): Promise<void> {
    const cabinetId = this.cabinetId;
    const typeMime = TYPES_PAR_EXTENSION[/\.([a-z0-9]+)$/i.exec(provenance.nomFichier)?.[1]?.toLowerCase() ?? ''] ?? null;
    const cleTemp = `tmp/${cabinetId}/mail/${randomUUID()}`;
    let taille = 0;
    async function* compter(): AsyncIterable<Uint8Array> {
      for await (const bloc of flux) {
        taille += bloc.byteLength;
        yield bloc;
      }
    }
    let sha256: string;
    let cleFinale: string;
    try {
      await this.c.stockage.deposerFlux(cleTemp, Readable.from(compter()), typeMime ?? undefined);
      sha256 = await provenance.empreinteSha256; // calculée en flux par le moteur
      cleFinale = cles.original(cabinetId, sha256);
      if (!(await this.c.stockage.existe(cleFinale))) {
        await this.c.stockage.deposerFlux(cleFinale, await this.c.stockage.lireFlux(cleTemp), typeMime ?? undefined);
      }
    } finally {
      await this.c.stockage.supprimer([cleTemp]).catch(() => undefined);
    }

    const origine = {
      connexionId: provenance.connexionId,
      fournisseur: provenance.fournisseur,
      idMessage: provenance.idMessage,
      idPieceJointe: provenance.idPieceJointe,
      dateReception: provenance.dateReception,
      expediteur: provenance.expediteur,
      nomFichier: provenance.nomFichier,
      taille,
      sha256,
    };
    const aAnalyser = await this.c.bd.avecContexte({ cabinetId }, async (tx) => {
      // Le triplet (connexion, message, pièce) est enregistré dans la MÊME transaction que le dépôt.
      const reserve = await tx
        .insert(s.piecesMailVues)
        .values({ cabinetId, connexionId: provenance.connexionId, idMessage: provenance.idMessage, idPieceJointe: provenance.idPieceJointe, issue: 'en_cours', nomFichier: provenance.nomFichier })
        .onConflictDoNothing()
        .returning({ id: s.piecesMailVues.id });
      if (reserve.length === 0) return null; // déjà reçue par une exécution concurrente
      const fichier = await assurerFichierOriginal(tx, { cabinetId, sha256, taille, typeMimeDeclare: typeMime, cleStockage: cleFinale });

      let raisons = rattachement.statut === 'a_qualifier' ? rattachement.raisons : [];
      if (rattachement.statut === 'rattache') {
        // Le dossier désigné par la règle doit exister dans ce cabinet (RLS) ; sinon la pièce reste à qualifier.
        const dossier = UUID.test(rattachement.dossierComptable)
          ? (await tx.select({ id: s.entites.id }).from(s.entites).where(eq(s.entites.id, rattachement.dossierComptable)))[0]
          : undefined;
        if (dossier) {
          const r = await enregistrerReception(tx, {
            cabinetId,
            entiteId: dossier.id,
            fichier,
            nomFichier: provenance.nomFichier,
            canal: 'mail',
            deposantId: null,
            provenance: { ...origine, regles: rattachement.regles },
          });
          await tx
            .update(s.piecesMailVues)
            .set({ issue: r.doublonBinaire ? 'doublon_binaire' : 'document', documentId: r.documentId })
            .where(eq(s.piecesMailVues.id, reserve[0]!.id));
          return r.nouveau ? r.documentId : null;
        }
        raisons = ['dossier_introuvable'];
      }
      const [piece] = await tx
        .insert(s.piecesAQualifier)
        .values({
          cabinetId,
          connexionId: provenance.connexionId,
          fichierId: fichier.id,
          nomFichier: provenance.nomFichier,
          provenance: origine,
          raisons,
          candidats: rattachement.statut === 'a_qualifier' ? rattachement.candidats : [],
          extrait,
        })
        .returning({ id: s.piecesAQualifier.id });
      await tx.update(s.piecesMailVues).set({ issue: 'a_qualifier' }).where(eq(s.piecesMailVues.id, reserve[0]!.id));
      await journaliser(tx, {
        cabinetId,
        acteurType: 'systeme',
        action: 'mail.piece_a_qualifier',
        cibleType: 'piece_a_qualifier',
        cibleId: piece!.id,
        details: { sha256, taille, raisons },
      });
      return null;
    });
    // Mise en file après validation de la transaction ; le balayage périodique du worker rattrape une mise en file manquée.
    if (aAnalyser) await this.c.taches.analyserDocument({ cabinetId, documentId: aAnalyser }).catch(() => undefined);
  }

  async signaler(signalement: Signalement): Promise<void> {
    const detail =
      signalement.type === 'facture_derriere_lien'
        ? { domaines: signalement.domaines }
        : { nomFichier: signalement.nomFichier, motif: signalement.motif };
    await this.c.bd.avecContexte({ cabinetId: this.cabinetId }, (tx) =>
      tx
        .insert(s.signalementsMail)
        .values({
          cabinetId: this.cabinetId,
          connexionId: signalement.connexionId,
          idMessage: signalement.idMessage,
          type: signalement.type,
          idPieceJointe: signalement.type === 'piece_ignoree' ? signalement.idPieceJointe : '',
          detail,
        })
        .onConflictDoNothing(), // un signalement rejoué n'est enregistré qu'une fois
    );
  }
}

// ───────────────────────────── Verrou et moteur ─────────────────────────────

export class VerrouConnexionOccupe extends Error {
  constructor() {
    super('Une opération est déjà en cours sur cette connexion de messagerie.');
  }
}

/**
 * Verrou par connexion ENTRE processus (verrou consultatif PostgreSQL tenu par une session dédiée) : une seule
 * opération à la fois lit et réécrit l'état d'une connexion (synchronisation, entretien, configuration, suppression).
 */
export async function avecVerrouConnexion<T>(bd: AccesBd, connexionId: string, attenteMaxMs: number, fn: () => Promise<T>): Promise<T> {
  const client = await bd.pool.connect();
  const cle = `mail:${connexionId}`;
  try {
    const limite = Date.now() + attenteMaxMs;
    for (;;) {
      const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [cle]);
      if (rows[0]?.ok) break;
      if (Date.now() >= limite) throw new VerrouConnexionOccupe();
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [cle]);
    }
  } finally {
    client.release();
  }
}

export interface MoteurBranche {
  moteur: MoteurMail;
  journal: JournalMail;
  /** Écrit dans le journal d'audit les événements notables produits par le moteur. */
  auditer(): Promise<void>;
}

/** Moteur @comtaple/mail branché sur PostgreSQL, S3 et les files, pour un cabinet donné. */
export function moteurMail(
  c: { bd: AccesBd; stockage: Stockage; taches: Files },
  connecteurs: ConnecteursMail,
  ctx: ContexteAcces & { cabinetId: string },
): MoteurBranche {
  if (!connecteurs.cles) throw new Error('Clé de chiffrement des jetons absente (JETONS_CLE_CHIFFREMENT).');
  const journal = new JournalMail();
  const moteur = creerMoteurMail({
    fournisseurs: connecteurs.fournisseurs,
    magasin: new MagasinConnexionsPg(c.bd, ctx),
    recepteur: new RecepteurPiecesPg(c, ctx.cabinetId),
    journal,
    trousseau: connecteurs.cles.trousseau,
  });
  return { moteur, journal, auditer: () => journal.vider(c.bd, ctx) };
}
