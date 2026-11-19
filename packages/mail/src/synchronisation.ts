/**
 * Moteur commun de synchronisation : reprise, idempotence, quotas, statuts.
 *
 * Principes :
 * - une notification ne fait que DÉCLENCHER `synchroniser` ; le moteur repart toujours de son curseur mémorisé,
 *   si bien que des notifications répétées, désordonnées ou manquées donnent le même résultat ;
 * - le curseur n'avance qu'après traitement complet d'une page ; une page rejouée ne crée aucun doublon
 *   grâce à `pieceDejaVue(connexion, message, pièce)` ;
 * - une connexion expirée ou révoquée change de statut et n'est plus jamais réessayée automatiquement ;
 * - aucune requête n'est émise vers un hôte autre que ceux du fournisseur (aucun lien n'est suivi).
 */
import { createHash, randomBytes } from 'node:crypto';
import { chiffrerJetons, dechiffrerJetons, doitEtreRechiffre, type Trousseau } from './chiffrement.js';
import {
  clesSurveillees,
  resoudreDateDebut,
  schemaConfigurationConnexion,
  type ConfigurationConnexionEntree,
} from './configuration.js';
import {
  ErreurConnexionExpiree,
  ErreurCurseurExpire,
  ErreurJetonRevoque,
  ErreurMail,
  ErreurOAuth,
  ErreurProtocole,
  ErreurTemporaire,
} from './erreurs.js';
import { detecterFactureDerriereLien, extraitPourQualification, masquerAdresse } from './extrait.js';
import type { ContexteAppel, FournisseurMail } from './fournisseurs/commun.js';
import { creerHttpGarde, requeteAvecReprise, type OptionsReprise } from './http.js';
import { validerNotificationsGraph, type NotificationGraph } from './notifications.js';
import { scopesManquants, validerRetourAutorisation, type DemandeEnAttente, type ResultatRevocation } from './oauth.js';
import { dimensionsDecoratives, evaluerPiece, REGLES_INTERNES_PIECES } from './pieces.js';
import {
  horlogeSysteme,
  httpNatif,
  type Horloge,
  type Http,
  type InitHttp,
  type Journal,
  type MagasinConnexions,
  type MemoireEmpreintes,
  type RecepteurPieces,
} from './ports.js';
import { filtrerMessage, rattacher } from './rattachement.js';
import type { PreuveConnexion } from './statut.js';
import type {
  EtatConnexion,
  ExtraitQualification,
  IdFournisseur,
  JeuDeJetons,
  MessageBrut,
  PieceJointeBrute,
  Provenance,
  Rattachement,
  ResultatSynchronisation,
  Signalement,
  StatutConnexion,
} from './types.js';

export interface DependancesMoteur {
  fournisseurs: Partial<Record<IdFournisseur, FournisseurMail>>;
  magasin: MagasinConnexions;
  recepteur: RecepteurPieces;
  journal: Journal;
  /** Clés de chiffrement des jetons (32 octets), fournies par l'appelant. */
  trousseau: Trousseau;
  horloge?: Horloge;
  http?: Http;
  memoireEmpreintes?: MemoireEmpreintes;
  /** Nombre dans [0, 1[ pour la gigue des reprises. */
  hasard?: () => number;
  reprise?: Partial<OptionsReprise>;
}

/** Marge avant expiration du jeton d'accès en dessous de laquelle il est renouvelé d'avance. */
const MARGE_JETON_MS = 60 * 1000;
/** Garde-fou contre une pagination qui ne se terminerait pas. */
const PAGES_MAX_PAR_PORTEE = 20_000;

class PieceTropVolumineuse extends ErreurMail {
  constructor() {
    super('piece_trop_volumineuse', 'La pièce dépasse la taille maximale configurée.');
  }
}

interface Session {
  etat: EtatConnexion;
  jetons: JeuDeJetons;
  fournisseur: FournisseurMail;
  /** Accès réseau limité aux hôtes du fournisseur, avec reprise, sans authentification. */
  http: Http;
  ctx: ContexteAppel;
  renouveleSur401: boolean;
}

function resultatVide(statut: StatutConnexion): ResultatSynchronisation {
  return {
    issue: 'terminee',
    statut,
    pieces: [],
    signalements: [],
    scopesManquants: [],
    reprendreApresMs: null,
    compteurs: {
      messagesExamines: 0,
      messagesHorsPeriode: 0,
      messagesFiltres: 0,
      piecesDeposees: 0,
      piecesDejaVues: 0,
      piecesIgnorees: 0,
      resynchronisationsCompletes: 0,
    },
  };
}

async function lireEnMemoire(source: AsyncIterable<Uint8Array>, limite: number): Promise<Uint8Array> {
  const blocs: Uint8Array[] = [];
  let total = 0;
  for await (const bloc of source) {
    total += bloc.byteLength;
    if (total > limite) throw new PieceTropVolumineuse();
    blocs.push(bloc);
  }
  return Buffer.concat(blocs);
}

async function* unBloc(octets: Uint8Array): AsyncIterable<Uint8Array> {
  yield octets;
}

/** Enveloppe un flux : calcule l'empreinte SHA-256 au fil de l'eau et refuse tout dépassement de taille. */
function fluxAvecEmpreinte(source: AsyncIterable<Uint8Array>, tailleMax: number) {
  const hachage = createHash('sha256');
  const etat = { taille: 0, termine: false };
  let resoudre!: (empreinte: string) => void;
  let rejeter!: (erreur: unknown) => void;
  const empreinte = new Promise<string>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  empreinte.catch(() => undefined); // l'erreur est remontée par le flux lui-même
  async function* flux(): AsyncIterable<Uint8Array> {
    try {
      for await (const bloc of source) {
        etat.taille += bloc.byteLength;
        if (etat.taille > tailleMax) throw new PieceTropVolumineuse();
        hachage.update(bloc);
        yield bloc;
      }
      etat.termine = true;
      resoudre(hachage.digest('hex'));
    } catch (erreur) {
      rejeter(erreur);
      throw erreur;
    }
  }
  return { flux: flux(), empreinte, etat };
}

export class MoteurMail {
  private readonly horloge: Horloge;
  private readonly httpBrut: Http;
  private readonly hasard: () => number;
  /** Sérialise, dans ce processus, les opérations d'une même connexion. */
  private readonly files = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: DependancesMoteur) {
    this.horloge = deps.horloge ?? horlogeSysteme;
    this.httpBrut = deps.http ?? httpNatif;
    this.hasard = deps.hasard ?? Math.random;
  }

  // ---------------------------------------------------------------------------------------------
  // Connexion

  /** Valide le retour OAuth, échange le code, chiffre les jetons et enregistre la connexion. */
  async creerConnexion(p: {
    connexionId: string;
    retour: URLSearchParams | Record<string, string | undefined>;
    attendu: DemandeEnAttente | null;
    sessionId: string;
    secretEtat: Uint8Array;
    configuration: ConfigurationConnexionEntree;
  }): Promise<EtatConnexion> {
    const maintenant = this.horloge.maintenant();
    // Le retour (state, session, expiration) est validé AVANT tout appel réseau.
    const { code } = validerRetourAutorisation({ ...p, maintenant });
    const attendu = p.attendu as DemandeEnAttente;
    const configuration = schemaConfigurationConnexion.parse(p.configuration);
    if (configuration.fournisseur !== attendu.fournisseur || JSON.stringify(configuration.boite) !== JSON.stringify(attendu.boite)) {
      throw new ErreurOAuth('configuration_incoherente', 'La configuration ne correspond pas à l’autorisation demandée.');
    }
    const fournisseur = this.fournisseur(configuration.fournisseur);
    const http = this.httpAvecReprise(fournisseur, p.connexionId);
    const echange = await fournisseur.echangerCode(http, { code, attendu, maintenant });
    const jetons: JeuDeJetons = { ...echange.jetons, etatClient: randomBytes(32).toString('base64url') };
    const etat: EtatConnexion = {
      id: p.connexionId,
      fournisseur: fournisseur.id,
      statut: 'active',
      motifStatut: null,
      adresse: echange.adresse,
      configuration,
      scopesAccordes: jetons.scopes,
      jetonsChiffres: chiffrerJetons(jetons, p.connexionId, this.deps.trousseau.courante),
      curseurs: {},
      surveillance: null,
      connecteeLe: maintenant.toISOString(),
      derniereSynchronisation: null,
    };
    const session = this.ouvrirSession(etat, jetons, fournisseur);
    const sonde = await fournisseur.sonder(session.ctx);
    etat.adresse = etat.adresse ?? sonde.adresse;
    await this.deps.magasin.enregistrer(etat);
    this.journal('connexion.creee', etat.id, { fournisseur: fournisseur.id, boite: etat.adresse ? masquerAdresse(etat.adresse) : null });
    return etat;
  }

  /**
   * Supprime la connexion : arrêt de la surveillance et révocation chez le fournisseur quand c'est possible,
   * puis effacement des jetons dans tous les cas. Le résultat dit ce qui reste à la main de l'utilisateur.
   */
  async supprimerConnexion(connexionId: string): Promise<ResultatRevocation> {
    return this.enFile(connexionId, async () => {
      const etat = await this.lire(connexionId);
      let resultat: ResultatRevocation = { revoqueChezFournisseur: false, actionsRestantes: [] };
      if (etat.jetonsChiffres !== null) {
        const fournisseur = this.fournisseur(etat.fournisseur);
        try {
          const session = this.ouvrirSession(etat, dechiffrerJetons(etat.jetonsChiffres, etat.id, this.deps.trousseau), fournisseur);
          if (etat.statut === 'active') {
            await fournisseur.arreterSurveillance(session.ctx, etat.surveillance).catch(() => undefined);
          }
          resultat = await fournisseur.revoquer(session.http, session.jetons);
        } catch (erreur) {
          this.journal('connexion.revocation_echouee', connexionId, { code: erreur instanceof ErreurMail ? erreur.code : 'inconnue' });
          resultat = {
            revoqueChezFournisseur: false,
            actionsRestantes: ['La révocation chez le fournisseur n’a pas pu être confirmée : retirer l’accès depuis le compte de l’utilisateur.'],
          };
        }
      }
      // Les jetons sont effacés quoi qu'il arrive.
      await this.deps.magasin.enregistrer({
        ...etat,
        statut: 'supprimee',
        motifStatut: 'supprimee_par_utilisateur',
        jetonsChiffres: null,
        curseurs: {},
        surveillance: null,
      });
      this.journal('connexion.supprimee', connexionId, { revoqueChezFournisseur: resultat.revoqueChezFournisseur });
      return resultat;
    });
  }

  /** Effectue un appel de lecture réel et renvoie la preuve à passer à `evaluerStatutIntegration`. */
  async verifierConnexionReelle(connexionId: string): Promise<PreuveConnexion> {
    return this.enFile(connexionId, async () => {
      const session = await this.sessionActive(connexionId);
      const sonde = await session.fournisseur.sonder(session.ctx);
      return {
        fournisseur: session.fournisseur.id,
        verifieeLe: this.horloge.maintenant().toISOString(),
        urlApi: session.fournisseur.urlApi,
        urlJeton: session.fournisseur.urlJeton,
        reponseSimulateur: sonde.reponseSimulateur,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Synchronisation

  /**
   * Synchronise une connexion. À appeler sur notification ET périodiquement (les notifications peuvent
   * être perdues ; pour une boîte partagée Microsoft, la synchronisation périodique est le seul mécanisme).
   */
  async synchroniser(connexionId: string, options: { declencheur?: 'notification' | 'periodique' | 'manuel' } = {}): Promise<ResultatSynchronisation> {
    return this.enFile(connexionId, async () => {
      const etat = await this.lire(connexionId);
      const resultat = resultatVide(etat.statut);
      if (etat.statut !== 'active' || etat.jetonsChiffres === null) {
        // Connexion arrêtée : aucun appel au fournisseur, aucune boucle.
        resultat.issue = 'ignoree';
        return resultat;
      }
      const config = etat.configuration;
      const manquants = scopesManquants(etat.fournisseur, config.boite, etat.scopesAccordes);
      if (manquants.length > 0) {
        // Jamais d'élargissement silencieux : l'interface doit lancer une nouvelle demande de consentement.
        resultat.issue = 'consentement_requis';
        resultat.scopesManquants = manquants;
        return resultat;
      }
      this.journal('synchronisation.debut', connexionId, { declencheur: options.declencheur ?? 'manuel' });
      try {
        const session = await this.sessionActive(connexionId, etat);
        for (const cle of clesSurveillees(config)) await this.synchroniserPortee(session, cle, resultat);
        etat.derniereSynchronisation = this.horloge.maintenant().toISOString();
        await this.deps.magasin.enregistrer(etat);
      } catch (erreur) {
        await this.traiterErreur(etat, erreur, resultat);
      }
      resultat.statut = etat.statut;
      this.journal('synchronisation.fin', connexionId, { issue: resultat.issue, ...resultat.compteurs });
      return resultat;
    });
  }

  private async synchroniserPortee(session: Session, cle: string, resultat: ResultatSynchronisation): Promise<void> {
    const { etat, fournisseur, ctx } = session;
    let dejaReinitialise = false;
    for (let page = 0; page < PAGES_MAX_PAR_PORTEE; page++) {
      const curseur = etat.curseurs[cle] ?? { curseur: null, reprise: null };
      let changements;
      try {
        changements = await fournisseur.pageSuivante(ctx, cle, curseur);
      } catch (erreur) {
        if (!(erreur instanceof ErreurCurseurExpire) || dejaReinitialise) throw erreur;
        // Curseur trop ancien : resynchronisation complète, bornée par la date de début et la portée. Une seule fois.
        dejaReinitialise = true;
        resultat.compteurs.resynchronisationsCompletes++;
        etat.curseurs = { ...etat.curseurs, [cle]: { curseur: null, reprise: null } };
        await this.deps.magasin.enregistrer(etat);
        this.journal('synchronisation.curseur_expire', etat.id, {});
        continue;
      }
      for (const idMessage of changements.idsMessages) await this.traiterMessage(session, idMessage, resultat);
      if (!changements.termine && changements.reprise === curseur.reprise && changements.reprise !== null) {
        throw new ErreurProtocole('Pagination sans progression.');
      }
      // La page est entièrement traitée : alors seulement le curseur avance.
      etat.curseurs = {
        ...etat.curseurs,
        [cle]: { curseur: changements.curseur ?? curseur.curseur, reprise: changements.reprise },
      };
      await this.deps.magasin.enregistrer(etat);
      if (changements.termine) return;
    }
    throw new ErreurProtocole('Nombre maximal de pages dépassé.');
  }

  private async traiterMessage(session: Session, idMessage: string, resultat: ResultatSynchronisation): Promise<void> {
    const { etat, fournisseur, ctx } = session;
    const config = etat.configuration;
    const message = await fournisseur.lireMessage(ctx, idMessage);
    if (message === null) return;
    resultat.compteurs.messagesExamines++;
    if (message.dateReception.getTime() < ctx.dateDebut.getTime()) {
      resultat.compteurs.messagesHorsPeriode++;
      return;
    }
    const motifFiltre = filtrerMessage(message, config);
    if (motifFiltre !== null) {
      resultat.compteurs.messagesFiltres++;
      return;
    }
    // Rattachement par règles explicites sur les adresses. L'objet et le corps n'y participent pas.
    const rattachement = rattacher(message, config);
    const extrait = extraitPourQualification(message);

    let pertinentes = 0;
    for (const piece of message.piecesJointes) {
      const decision = evaluerPiece(piece, { html: message.corpsHtml, tailleMaxOctets: config.tailleMaxPieceJointeOctets });
      if (decision.decision === 'ignoree') {
        resultat.compteurs.piecesIgnorees++;
        if (decision.signaler && (decision.motif === 'archive' || decision.motif === 'executable' || decision.motif === 'trop_volumineuse')) {
          await this.signaler(resultat, {
            type: 'piece_ignoree',
            connexionId: etat.id,
            idMessage: message.id,
            idPieceJointe: piece.id,
            nomFichier: piece.nom.slice(0, 255),
            motif: decision.motif,
          });
        }
        continue;
      }
      if (await this.deps.recepteur.pieceDejaVue(etat.id, message.id, piece.id)) {
        resultat.compteurs.piecesDejaVues++;
        pertinentes++;
        continue;
      }
      const issue = await this.deposerPiece(session, message, piece, decision.examinerContenu, rattachement, extrait, resultat);
      if (issue === 'deposee') pertinentes++;
    }

    if (pertinentes === 0) {
      // Aucune pièce pertinente : le message renvoie-t-il vers une facture en ligne ? Le lien n'est JAMAIS suivi.
      const lien = detecterFactureDerriereLien(message);
      if (lien !== null) {
        await this.signaler(resultat, { type: 'facture_derriere_lien', connexionId: etat.id, idMessage: message.id, domaines: lien.domaines });
      }
    }
  }

  private async deposerPiece(
    session: Session,
    message: MessageBrut,
    piece: PieceJointeBrute,
    examinerContenu: boolean,
    rattachement: Rattachement,
    extrait: ExtraitQualification,
    resultat: ResultatSynchronisation,
  ): Promise<'deposee' | 'ignoree'> {
    const { etat, fournisseur, ctx } = session;
    const tailleMax = etat.configuration.tailleMaxPieceJointeOctets;
    let source = await fournisseur.ouvrirPieceJointe(ctx, message.id, piece);
    try {
      if (examinerContenu) {
        // Petite image : lue en mémoire pour examiner dimensions et empreinte (heuristiques de signature/logo).
        const octets = await lireEnMemoire(source, REGLES_INTERNES_PIECES.tailleImageExamineeMaxOctets * 2);
        let decorative = dimensionsDecoratives(octets);
        if (!decorative && this.deps.memoireEmpreintes) {
          const empreinte = createHash('sha256').update(octets).digest('hex');
          const occurrences = await this.deps.memoireEmpreintes.noterImage(etat.id, empreinte, message.id);
          decorative = occurrences >= REGLES_INTERNES_PIECES.occurrencesLogoRepete;
        }
        if (decorative) {
          resultat.compteurs.piecesIgnorees++;
          return 'ignoree';
        }
        source = unBloc(octets);
      }
      const suivi = fluxAvecEmpreinte(source, tailleMax);
      const base = {
        connexionId: etat.id,
        fournisseur: fournisseur.id,
        idMessage: message.id,
        idPieceJointe: piece.id,
        dateReception: message.dateReception.toISOString(),
        expediteur: message.expediteur,
        nomFichier: piece.nom.slice(0, 255),
        taille: piece.taille,
      };
      await this.deps.recepteur.deposer(suivi.flux, { ...base, empreinteSha256: suivi.empreinte }, rattachement, extrait);
      if (!suivi.etat.termine) throw new ErreurProtocole('Le récepteur n’a pas consommé le flux de la pièce jusqu’au bout.');
      const provenance: Provenance = { ...base, taille: suivi.etat.taille, empreinteSha256: await suivi.empreinte };
      resultat.pieces.push(provenance);
      resultat.compteurs.piecesDeposees++;
      return 'deposee';
    } catch (erreur) {
      if (!(erreur instanceof PieceTropVolumineuse)) throw erreur;
      resultat.compteurs.piecesIgnorees++;
      await this.signaler(resultat, {
        type: 'piece_ignoree',
        connexionId: etat.id,
        idMessage: message.id,
        idPieceJointe: piece.id,
        nomFichier: piece.nom.slice(0, 255),
        motif: 'trop_volumineuse',
      });
      return 'ignoree';
    }
  }

  private async signaler(resultat: ResultatSynchronisation, signalement: Signalement): Promise<void> {
    resultat.signalements.push(signalement);
    await this.deps.recepteur.signaler(signalement);
    this.journal('signalement', signalement.connexionId, { type: signalement.type });
  }

  // ---------------------------------------------------------------------------------------------
  // Surveillance (notifications)

  /**
   * Crée ou renouvelle la surveillance (Gmail `watch`, abonnements Graph) avant son expiration.
   * À appeler à la connexion puis régulièrement (une fois par jour suffit).
   * Renvoie `null` si la connexion n'est pas active ou vient d'être arrêtée.
   */
  async entretenirSurveillance(connexionId: string, options: { forcer?: boolean } = {}): Promise<EtatConnexion['surveillance']> {
    return this.enFile(connexionId, async () => {
      const etat = await this.lire(connexionId);
      if (etat.statut !== 'active' || etat.jetonsChiffres === null) return null;
      if (scopesManquants(etat.fournisseur, etat.configuration.boite, etat.scopesAccordes).length > 0) return null;
      try {
        const session = await this.sessionActive(connexionId, etat);
        etat.surveillance = await session.fournisseur.assurerSurveillance(session.ctx, {
          cles: clesSurveillees(etat.configuration),
          actuelle: etat.surveillance,
          maintenant: this.horloge.maintenant(),
          etatClient: session.jetons.etatClient,
          forcer: options.forcer ?? false,
        });
        await this.deps.magasin.enregistrer(etat);
        this.journal('surveillance.entretenue', connexionId, { mode: etat.surveillance.mode });
        return etat.surveillance;
      } catch (erreur) {
        const resultat = resultatVide(etat.statut);
        await this.traiterErreur(etat, erreur, resultat);
        return null;
      }
    });
  }

  /** Valide un lot de notifications Graph destiné à cette connexion (`clientState` de ses abonnements). */
  async validerNotificationsGraph(connexionId: string, corps: unknown): Promise<{ acceptees: NotificationGraph[]; rejetees: number }> {
    const etat = await this.lire(connexionId);
    if (etat.jetonsChiffres === null) return { acceptees: [], rejetees: 0 };
    const { etatClient } = dechiffrerJetons(etat.jetonsChiffres, etat.id, this.deps.trousseau);
    const connus = new Set(etat.surveillance?.mode === 'graph_abonnements' ? etat.surveillance.abonnements.map((a) => a.id) : []);
    return validerNotificationsGraph(corps, (id) => (connus.has(id) ? etatClient : null));
  }

  /** Réagit à une notification de cycle de vie Graph déjà validée. */
  async traiterCycleDeVie(connexionId: string, notification: NotificationGraph): Promise<ResultatSynchronisation | null> {
    if (notification.nature !== 'cycle_de_vie') return null;
    this.journal('surveillance.cycle_de_vie', connexionId, { evenement: notification.evenement });
    if (notification.evenement === 'reauthorizationRequired') {
      await this.entretenirSurveillance(connexionId, { forcer: true });
      return null;
    }
    if (notification.evenement === 'subscriptionRemoved') {
      await this.enFile(connexionId, async () => {
        const etat = await this.lire(connexionId);
        if (etat.surveillance?.mode !== 'graph_abonnements') return;
        etat.surveillance = { mode: 'graph_abonnements', abonnements: etat.surveillance.abonnements.filter((a) => a.id !== notification.idAbonnement) };
        await this.deps.magasin.enregistrer(etat);
      });
      await this.entretenirSurveillance(connexionId);
    }
    // `subscriptionRemoved` et `missed` : des changements ont pu être perdus → rattrapage par l'API.
    return this.synchroniser(connexionId, { declencheur: 'notification' });
  }

  // ---------------------------------------------------------------------------------------------
  // Interne

  private fournisseur(id: IdFournisseur): FournisseurMail {
    const fournisseur = this.deps.fournisseurs[id];
    if (!fournisseur) throw new ErreurMail('fournisseur_non_configure', `Le fournisseur « ${id} » n’est pas configuré.`);
    return fournisseur;
  }

  private async lire(connexionId: string): Promise<EtatConnexion> {
    const etat = await this.deps.magasin.lire(connexionId);
    if (!etat) throw new ErreurMail('connexion_inconnue', 'Connexion inconnue.');
    return etat;
  }

  private journal(type: string, connexionId: string, donnees: Record<string, string | number | boolean | null>): void {
    this.deps.journal.consigner({ type, connexionId, donnees });
  }

  private enFile<T>(connexionId: string, tache: () => Promise<T>): Promise<T> {
    const precedente = this.files.get(connexionId) ?? Promise.resolve();
    const suivante = precedente.then(tache, tache);
    const garde = suivante.catch(() => undefined);
    this.files.set(connexionId, garde);
    void garde.then(() => {
      if (this.files.get(connexionId) === garde) this.files.delete(connexionId);
    });
    return suivante;
  }

  private httpAvecReprise(fournisseur: FournisseurMail, connexionId: string): Http {
    const garde = creerHttpGarde(this.httpBrut, fournisseur.urlsAutorisees());
    return (url, init) =>
      requeteAvecReprise(
        {
          http: garde,
          horloge: this.horloge,
          journal: this.deps.journal,
          hasard: this.hasard,
          connexionId,
          ...(this.deps.reprise ? { options: this.deps.reprise } : {}),
        },
        url,
        init,
      );
  }

  private ouvrirSession(etat: EtatConnexion, jetons: JeuDeJetons, fournisseur: FournisseurMail): Session {
    const session: Session = {
      etat,
      jetons,
      fournisseur,
      http: this.httpAvecReprise(fournisseur, etat.id),
      renouveleSur401: false,
      ctx: {
        boite: etat.configuration.boite,
        dateDebut: resoudreDateDebut(etat.configuration, new Date(etat.connecteeLe)),
        requete: (url, init) => this.requeteAuthentifiee(session, url, init),
      },
    };
    return session;
  }

  private async sessionActive(connexionId: string, etatConnu?: EtatConnexion): Promise<Session> {
    const etat = etatConnu ?? (await this.lire(connexionId));
    if (etat.statut !== 'active' || etat.jetonsChiffres === null) {
      throw new ErreurMail('connexion_inactive', 'La connexion n’est pas active.');
    }
    const jetons = dechiffrerJetons(etat.jetonsChiffres, etat.id, this.deps.trousseau);
    if (doitEtreRechiffre(etat.jetonsChiffres, this.deps.trousseau)) {
      // Rotation de clé : l'enveloppe est réécrite avec la clé courante.
      etat.jetonsChiffres = chiffrerJetons(jetons, etat.id, this.deps.trousseau.courante);
      await this.deps.magasin.enregistrer(etat);
    }
    return this.ouvrirSession(etat, jetons, this.fournisseur(etat.fournisseur));
  }

  private async rafraichir(session: Session): Promise<void> {
    if (session.jetons.jetonRafraichissement === null) throw new ErreurConnexionExpiree('Aucun jeton de rafraîchissement disponible.');
    session.jetons = await session.fournisseur.rafraichir(session.http, session.jetons, this.horloge.maintenant());
    // Persisté immédiatement : Microsoft remplace le jeton de rafraîchissement à chaque renouvellement.
    session.etat.jetonsChiffres = chiffrerJetons(session.jetons, session.etat.id, this.deps.trousseau.courante);
    session.etat.scopesAccordes = session.jetons.scopes;
    await this.deps.magasin.enregistrer(session.etat);
    this.journal('jeton.rafraichi', session.etat.id, {});
  }

  private async requeteAuthentifiee(session: Session, url: string, init?: InitHttp): Promise<Response> {
    if (new Date(session.jetons.expireLe).getTime() - this.horloge.maintenant().getTime() < MARGE_JETON_MS) {
      await this.rafraichir(session);
    }
    const envoyer = (): Promise<Response> =>
      session.http(url, { ...init, headers: { ...init?.headers, authorization: `Bearer ${session.jetons.jetonAcces}` } });
    let reponse = await envoyer();
    if (reponse.status !== 401) return reponse;
    // 401 : un seul renouvellement par exécution, puis un seul nouvel essai. Au-delà, la connexion est expirée.
    await reponse.body?.cancel().catch(() => undefined);
    if (session.renouveleSur401) throw new ErreurConnexionExpiree('Le fournisseur refuse le jeton d’accès malgré son renouvellement.');
    session.renouveleSur401 = true;
    await this.rafraichir(session);
    reponse = await envoyer();
    if (reponse.status === 401) {
      await reponse.body?.cancel().catch(() => undefined);
      throw new ErreurConnexionExpiree('Le fournisseur refuse le jeton d’accès malgré son renouvellement.');
    }
    return reponse;
  }

  /** Traduit une erreur en issue et, le cas échéant, en changement de statut définitif. */
  private async traiterErreur(etat: EtatConnexion, erreur: unknown, resultat: ResultatSynchronisation): Promise<void> {
    if (erreur instanceof ErreurJetonRevoque || erreur instanceof ErreurConnexionExpiree) {
      etat.statut = erreur instanceof ErreurJetonRevoque ? 'revoque' : 'expire';
      etat.motifStatut = erreur.code;
      // La surveillance ne peut plus être entretenue : l'état est remis à zéro, les curseurs sont conservés
      // pour reprendre sans perte si l'utilisateur reconnecte la boîte.
      etat.surveillance = null;
      await this.deps.magasin.enregistrer(etat);
      resultat.issue = 'arretee';
      resultat.statut = etat.statut;
      this.journal('connexion.arretee', etat.id, { statut: etat.statut });
      return;
    }
    if (erreur instanceof ErreurTemporaire) {
      resultat.issue = 'interrompue';
      resultat.reprendreApresMs = erreur.reprendreApresMs;
      this.journal('synchronisation.interrompue', etat.id, { statut: erreur.statutHttp });
      return;
    }
    this.journal('synchronisation.erreur', etat.id, { code: erreur instanceof ErreurMail ? erreur.code : 'inconnue' });
    throw erreur;
  }
}

export function creerMoteurMail(deps: DependancesMoteur): MoteurMail {
  return new MoteurMail(deps);
}
