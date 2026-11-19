import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, and, count, desc, eq, journaliser, lt, schema as s, sql, type Tx } from '@comtaple/db';
import {
  chargerClesGoogle,
  dechiffrerJetons,
  decrirePerimetre,
  ErreurMail,
  ErreurNotification,
  ErreurOAuth,
  ErreurTemporaire,
  type DemandeEnAttente,
  type EtatConnexion,
  type IdFournisseur,
  type Jwk,
  schemaConfigurationConnexion,
  validerNotificationsGraph,
  validerPushPubSub,
} from '@comtaple/mail';
import {
  avecVerrouConnexion,
  chiffrerJson,
  type Config,
  type ConnecteursMail,
  dechiffrerJson,
  enregistrerReception,
  type Files,
  fournisseurDepuisBd,
  MagasinConnexionsPg,
  moteurMail,
  type Stockage,
  VerrouConnexionOccupe,
} from '@comtaple/plateforme';
import type { Response } from 'express';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid, Public } from './acces.js';
import { BD, CONFIG, MAIL, STOCKAGE, TACHES } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const demarrage = z.object({
  fournisseur: z.enum(['gmail', 'microsoft']),
  /** Boîte partagée Microsoft 365 : déclenche une demande de consentement explicite incluant Mail.Read.Shared. */
  boitePartagee: z.email().max(320).optional(),
  /** Dossiers/libellés, filtres, règles de rattachement, date de début (défaut : 30 jours avant la connexion). */
  configuration: z.record(z.string(), z.unknown()).optional(),
});
const retour = z.object({
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});
const affectation = z.object({ entiteId: uuid });

type Ligne = typeof s.connexionsMail.$inferSelect;
const etatDe = (l: Ligne): EtatConnexion => ({ ...(l.etat as Omit<EtatConnexion, 'jetonsChiffres'>), jetonsChiffres: l.jetonsChiffres });

/** Vue d'une connexion : jamais de jeton ; permissions OAuth et filtres du logiciel présentés séparément. */
function vue(l: Ligne) {
  const etat = etatDe(l);
  const perimetre = decrirePerimetre(etat);
  return {
    id: l.id,
    fournisseur: fournisseurDepuisBd(l.fournisseur),
    adresse: l.adresse,
    statut: l.statut,
    motifStatut: l.derniereErreur,
    creeLe: l.creeLe,
    derniereSynchro: l.derniereSynchro,
    derniereIssue: l.derniereIssue,
    surveillance: etat.surveillance
      ? { mode: etat.surveillance.mode, echeance: l.surveillanceEcheance, raison: etat.surveillance.mode === 'periodique' ? etat.surveillance.raison : null }
      : null,
    configuration: etat.configuration,
    permissionsAccordees: perimetre.permissionsOAuth,
    filtresFonctionnels: perimetre.filtresLogiciel,
    textePerimetre: perimetre.texte,
  };
}

async function exigerGestionnaire(tx: Tx): Promise<void> {
  const r = await tx.execute(sql`select app_est_gestionnaire() as ok`);
  if (r.rows[0]?.ok !== true) throw new ForbiddenException('Réservé aux gestionnaires du cabinet (administrateur, associé)');
}

@ApiTags('Collecte par mail')
@ApiBearerAuth()
@Controller('v1/mail')
export class MailController {
  private clesGoogle: { cles: Jwk[]; expire: number } | null = null;

  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(TACHES) private readonly taches: Files,
    @Inject(MAIL) private readonly mail: ConnecteursMail,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private moteur(acces: Acces) {
    return moteurMail({ bd: this.bd, stockage: this.stockage, taches: this.taches }, this.mail, acces);
  }

  /** Valide la configuration fournie et vérifie que les dossiers comptables visés appartiennent au cabinet. */
  private async configurationValidee(tx: Tx, fournisseur: IdFournisseur, boite: unknown, brute: Record<string, unknown> | undefined) {
    const entree: Record<string, unknown> = { ...brute, fournisseur, boite };
    const dossiers = (await tx.select({ id: s.entites.id }).from(s.entites)).map((e) => e.id);
    if (entree['rattachement'] === undefined) {
      // Par défaut : tous les dossiers du cabinet sont destinataires possibles, sans règle → tout part « à qualifier ».
      if (dossiers.length === 0) throw new BadRequestException('Aucun dossier comptable dans ce cabinet');
      entree['rattachement'] = { dossiersComptables: dossiers };
    }
    const r = schemaConfigurationConnexion.safeParse(entree);
    if (!r.success) {
      throw new BadRequestException({ message: 'Configuration invalide', erreurs: r.error.issues.map((i) => ({ champ: i.path.join('.'), probleme: i.message })) });
    }
    const connus = new Set(dossiers);
    if (r.data.rattachement.dossiersComptables.some((d) => !connus.has(d))) {
      throw new BadRequestException('Un dossier comptable destinataire est inconnu dans ce cabinet');
    }
    return r.data;
  }

  private async charger(tx: Tx, id: string): Promise<Ligne> {
    exigerUuid(id);
    const [l] = await tx.select().from(s.connexionsMail).where(eq(s.connexionsMail.id, id));
    if (!l?.etat) throw new NotFoundException('Connexion de messagerie introuvable');
    return l;
  }

  // ───────────────────────────── Connexion ─────────────────────────────

  @Post('connexions')
  @ApiOperation({
    summary: 'Démarre la connexion d’une boîte (gestionnaires) : renvoie l’URL d’autorisation du fournisseur',
    description:
      'OAuth 2.0 code d’autorisation + PKCE. Le paramètre state est lié à l’utilisateur et au cabinet qui lancent la demande. ' +
      'Répond 503 « connecteur non configuré » tant qu’aucune application OAuth n’est configurée.',
  })
  @ApiBody({ schema: schemaOpenApi(demarrage) })
  async demarrer(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(demarrage, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const fournisseur = this.mail.fournisseurs[d.fournisseur];
      if (!fournisseur || !this.mail.cles) {
        throw new ServiceUnavailableException({ message: this.mail.etat[d.fournisseur].detail, code: 'connecteur_non_configure' });
      }
      const boite = d.boitePartagee ? { type: 'partagee' as const, adresse: d.boitePartagee.toLowerCase() } : { type: 'personnelle' as const };
      const configuration = await this.configurationValidee(tx, d.fournisseur, boite, d.configuration);
      const session = `${acces.cabinetId}:${acces.utilisateurId}`;
      const demande = fournisseur.preparerAutorisation({ boite, sessionId: session, secretEtat: this.mail.cles.secretEtat, maintenant: new Date() });
      await tx.delete(s.demandesConnexionMail).where(lt(s.demandesConnexionMail.expireLe, sql`now()`));
      await tx.insert(s.demandesConnexionMail).values({
        cabinetId: acces.cabinetId,
        utilisateurId: acces.utilisateurId,
        empreinteState: createHash('sha256').update(demande.aConserver.state).digest('hex'),
        // Le vérifieur PKCE est un secret : la demande est conservée chiffrée, liée à la session.
        donneesChiffrees: chiffrerJson(this.mail.cles.cleDemandes, session, { attendu: demande.aConserver, configuration }),
        expireLe: demande.aConserver.expireLe,
      });
      return { urlAutorisation: demande.url, expireLe: demande.aConserver.expireLe };
    });
  }

  @Post('retour')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retour OAuth (gestionnaires) : relayé par l’application web avec la session de l’utilisateur',
    description:
      'Le state doit correspondre à une demande lancée par CE même utilisateur dans CE cabinet ; sinon rien n’est échangé. ' +
      'Les jetons obtenus sont chiffrés au repos et ne sont jamais renvoyés.',
  })
  @ApiBody({ schema: schemaOpenApi(retour) })
  async retourOAuth(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(retour, corps);
    if (!this.mail.cles) throw new ServiceUnavailableException({ message: 'Connecteur non configuré', code: 'connecteur_non_configure' });
    const session = `${acces.cabinetId}:${acces.utilisateurId}`;
    // La demande est à usage unique : elle est retirée dès qu'elle est présentée.
    const demande = await this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [l] = await tx
        .delete(s.demandesConnexionMail)
        .where(
          and(
            eq(s.demandesConnexionMail.empreinteState, createHash('sha256').update(d.state).digest('hex')),
            eq(s.demandesConnexionMail.utilisateurId, acces.utilisateurId),
          ),
        )
        .returning();
      return l;
    });
    if (!demande) throw new BadRequestException({ message: 'Demande d’autorisation inconnue, expirée ou lancée par un autre utilisateur', code: 'state_invalide' });
    const { attendu, configuration } = dechiffrerJson<{ attendu: DemandeEnAttente; configuration: z.input<typeof schemaConfigurationConnexion> }>(
      this.mail.cles.cleDemandes,
      session,
      demande.donneesChiffrees,
    );
    const m = this.moteur(acces);
    const connexionId = randomUUID();
    try {
      await m.moteur.creerConnexion({
        connexionId,
        retour: { state: d.state, code: d.code, error: d.error },
        attendu,
        sessionId: session,
        secretEtat: this.mail.cles.secretEtat,
        configuration,
      });
    } catch (e) {
      if (e instanceof ErreurOAuth) throw new BadRequestException({ message: e.message, code: e.code });
      if (e instanceof ErreurTemporaire) throw new ServiceUnavailableException('Le fournisseur de messagerie est momentanément indisponible');
      if (e instanceof ErreurMail) throw new BadRequestException({ message: e.message, code: e.code });
      throw e;
    }
    // Trace d'un appel de lecture réussi : seule une preuve obtenue sur les hôtes officiels donnera « connecte ».
    const preuve = await m.moteur.verifierConnexionReelle(connexionId).catch(() => null);
    const ligne = await this.bd.avecContexte(acces, async (tx) => {
      if (preuve) await tx.update(s.connexionsMail).set({ preuve }).where(eq(s.connexionsMail.id, connexionId));
      return this.charger(tx, connexionId);
    });
    await m.auditer();
    const tache = { cabinetId: acces.cabinetId, connexionId };
    await this.taches.entretenirMail(tache).catch(() => undefined);
    await this.taches.synchroniserMail({ ...tache, declencheur: 'manuel' }).catch(() => undefined);
    return vue(ligne);
  }

  @Get('connexions')
  @ApiOperation({ summary: 'Connexions de messagerie du cabinet (gestionnaires), avec permissions accordées et filtres fonctionnels distincts' })
  async lister(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const lignes = await tx.select().from(s.connexionsMail).orderBy(desc(s.connexionsMail.creeLe));
      return {
        connecteurs: this.mail.etat,
        connexions: lignes.filter((l) => l.etat && l.statut !== 'supprimee').map(vue),
      };
    });
  }

  @Get('connexions/:id/suivi')
  @ApiOperation({ summary: 'Suivi d’une connexion : dernière synchronisation, imports, erreurs, signalements (facture derrière un lien…)' })
  async suivi(@AccesCourant() acces: Acces, @Param('id') id: string) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const l = await this.charger(tx, id);
      const parIssue = await tx
        .select({ issue: s.piecesMailVues.issue, n: count() })
        .from(s.piecesMailVues)
        .where(eq(s.piecesMailVues.connexionId, id))
        .groupBy(s.piecesMailVues.issue);
      const pieces = await tx
        .select({ nomFichier: s.piecesMailVues.nomFichier, issue: s.piecesMailVues.issue, documentId: s.piecesMailVues.documentId, idMessage: s.piecesMailVues.idMessage, recueLe: s.piecesMailVues.creeLe })
        .from(s.piecesMailVues)
        .where(eq(s.piecesMailVues.connexionId, id))
        .orderBy(desc(s.piecesMailVues.creeLe))
        .limit(100);
      const signalements = await tx
        .select({ id: s.signalementsMail.id, type: s.signalementsMail.type, idMessage: s.signalementsMail.idMessage, detail: s.signalementsMail.detail, creeLe: s.signalementsMail.creeLe })
        .from(s.signalementsMail)
        .where(eq(s.signalementsMail.connexionId, id))
        .orderBy(desc(s.signalementsMail.creeLe))
        .limit(200);
      const evenements = await tx
        .select({ action: s.journalAudit.action, details: s.journalAudit.details, creeLe: s.journalAudit.horodatage })
        .from(s.journalAudit)
        .where(and(eq(s.journalAudit.cibleType, 'connexion_mail'), eq(s.journalAudit.cibleId, id)))
        .orderBy(desc(s.journalAudit.horodatage))
        .limit(30);
      return {
        connexion: vue(l),
        imports: Object.fromEntries(parIssue.map((p) => [p.issue, p.n])),
        pieces,
        signalements,
        erreur: l.statut === 'active' ? null : { statut: l.statut, motif: l.derniereErreur },
        evenements,
      };
    });
  }

  @Put('connexions/:id/configuration')
  @ApiOperation({
    summary: 'Modifie les filtres fonctionnels d’une connexion (gestionnaires)',
    description:
      'Dossiers ou libellés surveillés, filtres d’expéditeur et d’objet, règles de rattachement, date de début. ' +
      'Ces réglages sont des filtres du logiciel : ils ne changent pas ce que l’autorisation accordée permet. La boîte ne peut pas être changée ici.',
  })
  async configurer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    const brute = valider(z.record(z.string(), z.unknown()), corps);
    return this.sousVerrou(id, async () => {
      const ligne = await this.bd.avecContexte(acces, async (tx) => {
        await exigerGestionnaire(tx);
        const l = await this.charger(tx, id);
        if (l.statut !== 'active') throw new ConflictException({ message: 'Connexion inactive', statut: l.statut });
        const etat = etatDe(l);
        const nouvelle = await this.configurationValidee(tx, etat.fournisseur, etat.configuration.boite, brute);
        const avant = etat.configuration;
        const perimetreChange =
          JSON.stringify([avant.dossiers, avant.filtres, avant.dateDebut]) !== JSON.stringify([nouvelle.dossiers, nouvelle.filtres, nouvelle.dateDebut]);
        // Périmètre de collecte modifié : les curseurs repartent de zéro (resynchronisation bornée, sans doublon).
        const suivant: EtatConnexion = { ...etat, configuration: nouvelle, curseurs: perimetreChange ? {} : etat.curseurs };
        await journaliser(tx, {
          cabinetId: acces.cabinetId,
          acteurId: acces.utilisateurId,
          action: 'mail.configuration.modifiee',
          cibleType: 'connexion_mail',
          cibleId: id,
          details: { dossiers: nouvelle.dossiers.length, regles: nouvelle.rattachement.regles.length, perimetreChange },
        });
        return suivant;
      });
      await new MagasinConnexionsPg(this.bd, acces).enregistrer(ligne);
      const tache = { cabinetId: acces.cabinetId, connexionId: id };
      await this.taches.entretenirMail({ ...tache, forcer: true }).catch(() => undefined);
      await this.taches.synchroniserMail({ ...tache, declencheur: 'manuel' }).catch(() => undefined);
      return this.bd.avecContexte(acces, async (tx) => vue(await this.charger(tx, id)));
    });
  }

  @Post('connexions/:id/synchroniser')
  @HttpCode(202)
  @ApiOperation({ summary: 'Demande une synchronisation (gestionnaires) : mise en file, exécutée par le worker' })
  async synchroniser(@AccesCourant() acces: Acces, @Param('id') id: string) {
    const l = await this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      return this.charger(tx, id);
    });
    // Une connexion expirée ou révoquée n'est jamais relancée : il faut la reconnecter.
    if (l.statut !== 'active') throw new ConflictException({ message: 'Connexion inactive : reconnecter la boîte', statut: l.statut });
    await this.taches.synchroniserMail({ cabinetId: acces.cabinetId, connexionId: id, declencheur: 'manuel' });
    return { misEnFile: true };
  }

  @Delete('connexions/:id')
  @ApiOperation({
    summary: 'Déconnecte une boîte (gestionnaires) : arrêt de la surveillance, révocation si le fournisseur le permet, suppression des jetons',
    description: 'La réponse indique ce qui reste à faire par l’utilisateur ou l’administrateur chez le fournisseur.',
  })
  async deconnecter(@AccesCourant() acces: Acces, @Param('id') id: string) {
    await this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      await this.charger(tx, id);
    });
    return this.sousVerrou(id, async () => {
      const m = this.moteur(acces);
      const resultat = await m.moteur.supprimerConnexion(id);
      await this.bd.avecContexte(acces, (tx) => tx.update(s.connexionsMail).set({ preuve: null }).where(eq(s.connexionsMail.id, id)));
      await m.auditer();
      return { statut: 'supprimee', jetonsSupprimes: true, ...resultat };
    });
  }

  private async sousVerrou<T>(connexionId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await avecVerrouConnexion(this.bd, connexionId, 15_000, fn);
    } catch (e) {
      if (e instanceof VerrouConnexionOccupe) throw new ConflictException('Synchronisation en cours sur cette connexion : réessayer dans un instant');
      throw e;
    }
  }

  // ───────────────────────────── Pièces à qualifier ─────────────────────────────

  @Get('pieces-a-qualifier')
  @ApiOperation({ summary: 'Pièces reçues par mail dont le rattachement est ambigu (gestionnaires) : rattachées à aucun dossier' })
  async aQualifier(@AccesCourant() acces: Acces, @Query('statut') statut?: string) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const lignes = await tx
        .select()
        .from(s.piecesAQualifier)
        .where(eq(s.piecesAQualifier.statut, statut === 'affectee' ? 'affectee' : 'en_attente'))
        .orderBy(desc(s.piecesAQualifier.creeLe))
        .limit(500);
      return lignes.map((p) => ({
        id: p.id,
        connexionId: p.connexionId,
        nomFichier: p.nomFichier,
        provenance: p.provenance,
        raisons: p.raisons,
        candidats: p.candidats,
        // Expéditeur, objet et extrait viennent du message : contenu non fiable, à afficher comme tel.
        extraitNonFiable: p.extrait,
        statut: p.statut,
        dossierAffecteId: p.dossierAffecteId,
        documentId: p.documentId,
        recueLe: p.creeLe,
      }));
    });
  }

  @Post('pieces-a-qualifier/:id/affecter')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Affecte une pièce à qualifier à un dossier (gestionnaire habilité sur ce dossier) : crée le document et sa réception',
    description: 'Si le même binaire existe déjà dans le dossier, seule une nouvelle occurrence de réception est créée (doublon binaire).',
  })
  @ApiBody({ schema: schemaOpenApi(affectation) })
  async affecter(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(affectation, corps);
    const r = await this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [piece] = await tx.select().from(s.piecesAQualifier).where(eq(s.piecesAQualifier.id, id)).for('update');
      if (!piece) throw new NotFoundException('Pièce introuvable');
      if (piece.statut !== 'en_attente') throw new ConflictException({ message: 'Pièce déjà affectée', documentId: piece.documentId });
      await exigerNiveau(tx, d.entiteId, 'depot');
      const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, piece.fichierId));
      if (!fichier) throw new NotFoundException('Fichier introuvable');
      const reception = await enregistrerReception(tx, {
        cabinetId: acces.cabinetId,
        entiteId: d.entiteId,
        fichier,
        nomFichier: piece.nomFichier,
        canal: 'mail',
        deposantId: null,
        acteurId: acces.utilisateurId,
        provenance: { ...(piece.provenance as Record<string, unknown>), pieceAQualifierId: piece.id, qualifieePar: acces.utilisateurId },
      });
      await tx
        .update(s.piecesAQualifier)
        .set({ statut: 'affectee', dossierAffecteId: d.entiteId, documentId: reception.documentId, affecteePar: acces.utilisateurId, affecteeLe: sql`now()` })
        .where(eq(s.piecesAQualifier.id, id));
      await tx
        .update(s.piecesMailVues)
        .set({ issue: reception.doublonBinaire ? 'doublon_binaire' : 'document', documentId: reception.documentId })
        .where(
          and(
            eq(s.piecesMailVues.connexionId, piece.connexionId),
            eq(s.piecesMailVues.idMessage, String((piece.provenance as { idMessage?: unknown }).idMessage ?? '')),
            eq(s.piecesMailVues.idPieceJointe, String((piece.provenance as { idPieceJointe?: unknown }).idPieceJointe ?? '')),
          ),
        );
      return reception;
    });
    if (r.nouveau) await this.taches.analyserDocument({ cabinetId: acces.cabinetId, documentId: r.documentId }).catch(() => undefined);
    return { documentId: r.documentId, doublonBinaire: r.doublonBinaire, statutDocument: r.statutDocument };
  }

  // ───────────────────────────── Notifications (points d'entrée publics) ─────────────────────────────
  // Ils ne font QUE valider l'authenticité et mettre en file une synchronisation par identifiant :
  // le contenu de la notification n'est jamais utilisé comme donnée.

  @Public()
  @Post('notifications/gmail')
  @HttpCode(204)
  @ApiOperation({ summary: 'Push Pub/Sub de Gmail (public) : jeton OIDC validé, puis mise en file d’une synchronisation' })
  async pushGmail(@Headers('authorization') autorisation: string | undefined, @Body() corps: unknown) {
    limiterDebit('gmail');
    const push = { audience: this.cfg.GOOGLE_PUSH_AUDIENCE, compteService: this.cfg.GOOGLE_PUSH_COMPTE_SERVICE };
    if (!this.mail.fournisseurs.gmail || push.audience === '' || push.compteService === '') throw new NotFoundException();
    let adresse: string;
    try {
      const maintenant = Date.now();
      if (!this.clesGoogle || this.clesGoogle.expire < maintenant) {
        this.clesGoogle = { cles: await chargerClesGoogle((url, init) => fetch(url, init), this.mail.urlClesGoogle), expire: maintenant + 3600_000 };
      }
      adresse = validerPushPubSub({
        autorisation,
        corps,
        audienceAttendue: push.audience,
        compteServiceAttendu: push.compteService,
        cles: this.clesGoogle.cles,
        maintenant: new Date(maintenant),
      }).adresse;
    } catch (e) {
      if (e instanceof ErreurNotification || e instanceof SyntaxError) throw new UnauthorizedException('Notification refusée');
      throw e;
    }
    const { rows } = await this.bd.pool.query<{ cabinet_id: string; connexion_id: string }>('select * from mail_connexions_par_adresse($1, $2)', ['gmail', adresse]);
    for (const r of rows) await this.taches.synchroniserMail({ cabinetId: r.cabinet_id, connexionId: r.connexion_id, declencheur: 'notification' });
  }

  @Public()
  @Post('notifications/microsoft')
  @ApiOperation({
    summary: 'Notifications Microsoft Graph (public) : validation du point d’entrée, clientState vérifié, puis mise en file',
  })
  async notificationsGraph(@Query('validationToken') jetonValidation: string | undefined, @Body() corps: unknown, @Res() res: Response) {
    limiterDebit('microsoft');
    if (!this.mail.fournisseurs.microsoft || !this.mail.cles) throw new NotFoundException();
    if (typeof jetonValidation === 'string') {
      // Validation du point d'entrée : le jeton est renvoyé tel quel, en texte brut (jamais interprété comme HTML).
      res.status(200).type('text/plain').send(jetonValidation);
      return;
    }
    const elements = z
      .object({ value: z.array(z.object({ subscriptionId: z.string().min(1).max(200) }).loose()).max(1000) })
      .safeParse(corps);
    if (!elements.success) throw new BadRequestException('Notification invalide');
    const parAbonnement = new Map<string, unknown[]>();
    for (const e of elements.data.value) parAbonnement.set(e.subscriptionId, [...(parAbonnement.get(e.subscriptionId) ?? []), e]);
    const synchronisations = new Map<string, string>();
    for (const [idAbonnement, lot] of parAbonnement) {
      const { rows } = await this.bd.pool.query<{ cabinet_id: string; connexion_id: string; jetons_chiffres: string }>(
        'select * from mail_connexions_par_abonnement($1)',
        [idAbonnement],
      );
      for (const r of rows) {
        let etatClient: string;
        try {
          etatClient = dechiffrerJetons(r.jetons_chiffres, r.connexion_id, this.mail.cles.trousseau).etatClient;
        } catch {
          continue;
        }
        // Seules les notifications portant le clientState de l'abonnement sont retenues.
        const { acceptees } = validerNotificationsGraph({ value: lot }, (id) => (id === idAbonnement ? etatClient : null));
        for (const n of acceptees) {
          if (n.nature === 'cycle_de_vie' && n.evenement) {
            await this.taches.cycleDeVieMail({ cabinetId: r.cabinet_id, connexionId: r.connexion_id, cycleDeVie: { idAbonnement, evenement: n.evenement } });
          } else synchronisations.set(r.connexion_id, r.cabinet_id);
        }
      }
    }
    for (const [connexionId, cabinetId] of synchronisations) await this.taches.synchroniserMail({ cabinetId, connexionId, declencheur: 'notification' });
    res.status(202).end();
  }
}

/**
 * Limitation de débit des points d'entrée PUBLICS de notification (par processus, fenêtre glissante d'une minute).
 * Une notification ne fait que déclencher une synchronisation : en refuser sous charge ne perd rien, le rattrapage
 * périodique récupère. Limite globale par fournisseur, volontairement simple (pas de dépendance à l'adresse source,
 * peu fiable derrière un répartiteur).
 */
const FENETRE_MS = 60_000;
const LIMITE_PAR_MINUTE = 300;
const horodatages: Record<string, number[]> = {};
export function limiterDebit(cle: string, maintenant = Date.now()): void {
  const liste = (horodatages[cle] ??= []);
  while (liste.length && liste[0]! <= maintenant - FENETRE_MS) liste.shift();
  if (liste.length >= LIMITE_PAR_MINUTE) throw new HttpException('Trop de notifications : réessayer plus tard', HttpStatus.TOO_MANY_REQUESTS);
  liste.push(maintenant);
}
