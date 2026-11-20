import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  appliquerCorrectionDestinataire,
  type ChampsFacture,
  destinataireNonLu,
  determinerSensPiece,
  inchangeDepuis,
  lignesDestinataire,
  type SaisieDestinataire,
  VERSION_ANALYSEUR_FACTURE,
  verifierCoherenceFacture,
} from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, inArray, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Files } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD, TACHES } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

/** Taille maximale d'un lot de réanalyse : au-delà, plusieurs demandes successives. */
export const TAILLE_MAX_LOT_REANALYSE = 50;

const champDestinataire = (max: number) => z.string().max(max).nullable();
const correctionDestinataire = z.object({
  champs: z
    .object({
      destinataireNom: champDestinataire(200),
      destinataireSiren: champDestinataire(20),
      destinataireSiret: champDestinataire(24),
      destinataireTva: champDestinataire(24),
      destinatairePays: champDestinataire(2),
    })
    .partial()
    .strict()
    .refine((c) => Object.keys(c).length > 0, 'au moins un champ du destinataire'),
  motif: z.string().trim().min(3, 'un motif d’au moins 3 caractères est requis').max(2000),
});
const demandeReanalyse = z.object({
  mode: z.enum(['simulation', 'execution']),
  motif: z.string().trim().min(3, 'un motif d’au moins 3 caractères est requis').max(2000),
  /** Obligatoire pour une exécution : la simulation terminée qui l'a précédée (aperçu avant confirmation). */
  simulationId: uuid.optional(),
});

const RESULTATS = ['inchangee', 'destinataire_trouve', 'abstention', 'erreur'] as const;
const versionAnalyseurDe = (moteur: string | null): string | null => /analyseur (\S+)/.exec(moteur ?? '')?.[1] ?? null;

@ApiTags('Destinataire des pièces')
@ApiBearerAuth()
@Controller('v1')
export class DestinataireController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(TACHES) private readonly taches: Files,
  ) {}

  /** Charge une pièce et exige au moins le niveau « lecture » : un déposant (niveau « dépôt ») est refusé. */
  private async chargerPiece(tx: Tx, id: string, minimum: 'lecture' | 'collaboration') {
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, id));
    if (!doc) throw new NotFoundException('Document introuvable');
    const niveau = await exigerNiveau(tx, doc.entiteId, minimum);
    return { doc, niveau };
  }

  /** Sens relu d'après les identifiants, qualification du document, décisions humaines d'appariement concernées. */
  private async analyserEffets(tx: Tx, doc: typeof s.documents.$inferSelect, extraction: typeof s.extractions.$inferSelect) {
    const champs = extraction.champs as Record<string, unknown>;
    const [entite] = await tx.select({ siren: s.entites.siren }).from(s.entites).where(eq(s.entites.id, doc.entiteId));
    const valeur = (k: string): string | null => {
      const v = (champs[k] as { valeur?: unknown } | null | undefined)?.valeur;
      return typeof v === 'string' && v.trim() !== '' ? v : null;
    };
    const sens = determinerSensPiece({
      emetteur: { siren: valeur('emetteurSiren'), siret: valeur('emetteurSiret'), tva: valeur('emetteurTva') },
      destinataire: { siren: valeur('destinataireSiren'), siret: valeur('destinataireSiret'), tva: valeur('destinataireTva') },
      sirenDossier: entite?.siren ?? null,
    });
    const attendu = doc.nature === 'facture_achat' ? 'achat' : doc.nature === 'facture_vente' ? 'vente' : null;
    const conflitNature = attendu !== null && sens.sens !== 'indetermine' && sens.sens !== attendu;
    const valableDepuis = inchangeDepuis(champs, extraction.version);
    const liens = await tx
      .select({ type: s.liensFactures.type, cible: s.liensFactures.cible, decision: s.liensFactures.decision, versionExtraction: s.liensFactures.versionExtraction, motif: s.liensFactures.motif })
      .from(s.liensFactures)
      .where(eq(s.liensFactures.documentId, doc.id));
    const decisions = liens.map((l) => ({
      ...l,
      etat: l.versionExtraction === extraction.version ? ('appliquee' as const) : l.versionExtraction !== null && l.versionExtraction >= valableDepuis && l.versionExtraction < extraction.version ? ('conservee' as const) : ('a_revoir' as const),
    }));
    const signalements: string[] = [];
    if (conflitNature) signalements.push(`La pièce est qualifiée « ${doc.nature === 'facture_vente' ? 'facture de vente' : 'facture d’achat'} » mais ses identifiants indiquent ${sens.sens === 'vente' ? 'une vente' : 'un achat'} : ${sens.motif}`);
    if (sens.incoherence) signalements.push(sens.motif);
    if (decisions.some((d) => d.etat === 'conservee')) signalements.push('Des décisions humaines d’appariement, prises avant cette lecture du destinataire, sont conservées telles quelles : vérifiez qu’elles restent cohérentes.');
    if (decisions.some((d) => d.etat === 'a_revoir')) signalements.push('Des décisions humaines d’appariement portent sur une version antérieure dont les champs (hors destinataire) ont changé : elles sont à revoir et ne sont plus appliquées.');
    return {
      sensLu: { sens: sens.sens, incoherence: sens.incoherence, motif: sens.motif, sirenEmetteur: sens.sirenEmetteur, sirenDestinataire: sens.sirenDestinataire },
      natureQualifiee: doc.nature,
      conflitNature,
      decisions,
      signalements,
      appariement: 'Le sens de la pièce et l’appariement des tiers et des ventes sont recalculés à chaque lecture par le moteur déterministe (Tiers et factures) ; aucune décision humaine n’est écrasée.',
    };
  }

  @Get('documents/:id/destinataire')
  @ApiOperation({
    summary: 'Destinataire (acheteur) d’une pièce : valeur automatique et valeur humaine côte à côte, historique des versions, sens relu',
    description: 'Niveau « lecture » au moins (un déposant est refusé). Le sens et l’appariement sont recalculés par le moteur déterministe ; rien n’est stocké en dehors des versions d’extraction.',
  })
  async lireDestinataire(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc, niveau } = await this.chargerPiece(tx, id, 'lecture');
      const [fichier] = await tx.select({ sha256: s.fichiers.sha256, taille: s.fichiers.taille }).from(s.fichiers).where(eq(s.fichiers.id, doc.fichierId));
      const versions = await tx.select().from(s.extractions).where(eq(s.extractions.documentId, id)).orderBy(asc(s.extractions.version));
      const courante = versions.find((v) => v.actuelle) ?? null;
      const auteurs = new Set<string>();
      const historique = versions.map((v) => {
        const lignes = lignesDestinataire(v.champs as Record<string, unknown>);
        for (const l of lignes) if (l.corrigePar) auteurs.add(l.corrigePar);
        return {
          id: v.id,
          version: v.version,
          actuelle: v.actuelle,
          methode: v.methode,
          moteur: v.moteur,
          versionAnalyseur: versionAnalyseurDe(v.moteur),
          statut: v.statut,
          creeLe: v.creeLe,
          lectureAutomatiqueFaite: !destinataireNonLu(v.champs as Record<string, unknown>),
          lignes,
          abstention: (v.champs as Record<string, unknown>).destinataireAbstention ?? null,
        };
      });
      const noms = auteurs.size
        ? new Map((await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, [...auteurs]))).map((u) => [u.id, u.nom]))
        : new Map<string, string>();
      const reanalyses = await tx
        .select({ lotId: s.reanalysesDestinatairePieces.lotId, resultat: s.reanalysesDestinatairePieces.resultat, motif: s.reanalysesDestinatairePieces.motif, execution: s.reanalysesDestinatairePieces.execution, versionAnalyseur: s.reanalysesDestinatairePieces.versionAnalyseur, traiteLe: s.reanalysesDestinatairePieces.traiteLe })
        .from(s.reanalysesDestinatairePieces)
        .where(eq(s.reanalysesDestinatairePieces.documentId, id))
        .orderBy(desc(s.reanalysesDestinatairePieces.traiteLe));
      const effets = courante ? await this.analyserEffets(tx, doc, courante) : null;
      return {
        niveau,
        documentId: id,
        nomFichier: doc.nomOrigine,
        remplace: doc.remplacePar !== null,
        original: fichier ? { sha256: fichier.sha256, taille: fichier.taille, inchange: 'L’original n’est jamais modifié par une correction ni par une réanalyse.' } : null,
        extractionCourante: courante && { id: courante.id, version: courante.version, statut: courante.statut, methode: courante.methode },
        lignes: courante ? lignesDestinataire(courante.champs as Record<string, unknown>).map((l) => ({ ...l, corrigeParNom: l.corrigePar ? (noms.get(l.corrigePar) ?? null) : null })) : [],
        abstention: courante ? ((courante.champs as Record<string, unknown>).destinataireAbstention ?? null) : null,
        lectureAutomatiqueFaite: courante ? !destinataireNonLu(courante.champs as Record<string, unknown>) : false,
        historique: historique.map((h) => ({ ...h, lignes: h.lignes.map((l) => ({ ...l, corrigeParNom: l.corrigePar ? (noms.get(l.corrigePar) ?? null) : null })) })),
        effets,
        reanalyses,
        versionAnalyseurCourante: VERSION_ANALYSEUR_FACTURE,
      };
    });
  }

  @Put('documents/:id/destinataire')
  @ApiOperation({
    summary: 'Corriger à la main le destinataire d’une pièce (motif obligatoire) : couche humaine tracée, nouvelle version d’extraction',
    description:
      'Mêmes gardes que la correction des champs d’une pièce (niveau « collaboration »). Crée une NOUVELLE version d’extraction (projet) : la précédente, l’original et toutes les décisions antérieures sont conservés. La valeur humaine prime sur la valeur automatique, qui reste visible à côté ; une réanalyse ne l’écrase jamais. Le sens de la pièce et l’appariement sont recalculés à la lecture par le moteur déterministe.',
  })
  @ApiBody({ schema: schemaOpenApi(correctionDestinataire) })
  async corrigerDestinataire(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(correctionDestinataire, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.chargerPiece(tx, id, 'collaboration');
      if (doc.remplacePar) throw new ConflictException('Cette version a été remplacée : le travail se poursuit sur la version la plus récente');
      const [actuelle] = await tx
        .select()
        .from(s.extractions)
        .where(and(eq(s.extractions.documentId, id), eq(s.extractions.actuelle, true)))
        .for('update');
      if (!actuelle) throw new ConflictException('Aucune extraction à corriger : le document est encore en analyse');
      const saisie = d.champs as SaisieDestinataire;
      const r = appliquerCorrectionDestinataire(actuelle.champs as Record<string, unknown>, saisie, {
        auteurId: acces.utilisateurId,
        le: new Date().toISOString(),
        motif: d.motif,
        versionBase: actuelle.version,
        versionNouvelle: actuelle.version + 1,
        versionAnalyseurBase: versionAnalyseurDe(actuelle.moteur),
      });
      if (r.erreurs.length > 0) throw new BadRequestException({ message: 'Destinataire invalide', erreurs: r.erreurs.map((probleme) => ({ champ: 'champs', probleme })) });
      if (r.modifies.length === 0) throw new ConflictException('Aucun changement : les valeurs saisies sont déjà celles retenues pour ce destinataire');
      const verifications = verifierCoherenceFacture(r.champs as unknown as ChampsFacture);
      await tx.update(s.extractions).set({ actuelle: false }).where(eq(s.extractions.id, actuelle.id));
      const [nouvelle] = await tx
        .insert(s.extractions)
        .values({
          cabinetId: acces.cabinetId,
          entiteId: doc.entiteId,
          documentId: id,
          version: actuelle.version + 1,
          methode: 'saisie_humaine',
          moteur: `${actuelle.moteur ?? actuelle.methode} ; correction humaine du destinataire`,
          champs: r.champs,
          verifications,
          // Une version nouvelle n'est jamais validée d'office ; la validation antérieure reste attachée à sa version.
          statut: 'projet',
        })
        .returning();
      await tx.insert(s.decisions).values({
        cabinetId: acces.cabinetId,
        entiteId: doc.entiteId,
        cibleType: 'extraction',
        cibleId: nouvelle!.id,
        versionCible: nouvelle!.version,
        action: 'corriger_destinataire',
        motif: d.motif,
        auteurId: acces.utilisateurId,
      });
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'extraction.destinataire_corrige',
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
        details: {
          versionAvant: actuelle.version,
          versionApres: nouvelle!.version,
          champsModifies: r.modifies,
          avant: r.avant,
          apres: r.apres,
          motif: d.motif,
          statutAvant: actuelle.statut,
          versionAnalyseurBase: versionAnalyseurDe(actuelle.moteur),
        },
      });
      const effets = await this.analyserEffets(tx, doc, nouvelle!);
      return {
        extraction: { id: nouvelle!.id, version: nouvelle!.version, statut: nouvelle!.statut, methode: nouvelle!.methode },
        versionPrecedente: { id: actuelle.id, version: actuelle.version, statut: actuelle.statut },
        modifies: r.modifies,
        avant: r.avant,
        apres: r.apres,
        lignes: lignesDestinataire(nouvelle!.champs as Record<string, unknown>),
        effets,
      };
    });
  }

  // ───────────────────────────── Réanalyse explicite ─────────────────────────────

  /** Pièces concernées : version courante, extraction en vigueur exploitable sans lecture automatique du destinataire. */
  private requeteConcernees(entiteId: string, versionAnalyseur: string) {
    return sql`
      select d.id as "documentId", e.id as "extractionId", e.version as "version", e.statut as "statutExtraction", e.methode as "methode", d.nom_origine as "nomFichier",
             exists (select 1 from reanalyses_destinataire_pieces p where p.document_id = d.id and p.version_analyseur = ${versionAnalyseur} and p.execution and p.resultat in ('destinataire_trouve', 'abstention')) as "dejaReanalysee"
        from documents d
        join extractions e on e.document_id = d.id and e.actuelle
        join fichiers f on f.id = d.fichier_id
       where d.entite_id = ${entiteId}::uuid and d.remplace_par is null
         and d.statut in ('a_controler', 'traite', 'a_completer')
         and e.statut <> 'rejete'
         and f.analyse_antivirus in ('sain', 'non_analyse')
         and (e.champs ->> 'destinataireNonLuAuto' = 'true' or (not (e.champs ? 'destinataireAbstention') and not (e.champs ? 'destinataireNom')))
       order by d.cree_le, d.id`;
  }

  @Get('dossiers/:entiteId/reanalyse-destinataire')
  @ApiOperation({
    summary: 'Aperçu de la réanalyse du destinataire : pièces concernées, déjà réanalysées, lot suivant, demandes récentes',
    description: 'Niveau « collaboration » au moins. Lecture seule : rien n’est lancé. Une réanalyse ne se déclenche jamais automatiquement.',
  })
  async apercu(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string) {
    exigerUuid(entiteId, 'entiteId');
    return this.bd.avecContexte(acces, async (tx) => {
      const niveau = await exigerNiveau(tx, entiteId, 'collaboration');
      const lignes = (await tx.execute(this.requeteConcernees(entiteId, VERSION_ANALYSEUR_FACTURE))).rows as unknown as Array<{ documentId: string; statutExtraction: string; methode: string; dejaReanalysee: boolean }>;
      const aFaire = lignes.filter((l) => !l.dejaReanalysee);
      const lots = await tx
        .select()
        .from(s.reanalysesDestinataire)
        .where(eq(s.reanalysesDestinataire.entiteId, entiteId))
        .orderBy(desc(s.reanalysesDestinataire.creeLe))
        .limit(20);
      const [relues] = (await tx.execute(sql`select count(distinct document_id)::int as n from reanalyses_destinataire_pieces where entite_id = ${entiteId}::uuid and execution and version_analyseur = ${VERSION_ANALYSEUR_FACTURE} and resultat in ('destinataire_trouve', 'abstention')`)).rows as Array<{ n: number }>;
      return {
        niveau,
        versionAnalyseur: VERSION_ANALYSEUR_FACTURE,
        tailleMaxLot: TAILLE_MAX_LOT_REANALYSE,
        peutDemander: niveau === 'revision' || niveau === 'validation',
        concernees: aFaire.length,
        dejaReanalysees: lignes.length - aFaire.length,
        /** Pièces déjà relues (nouvelle version créée, ou abstention rapportée) avec la version courante de l’analyseur : jamais refaites. */
        dejaRelues: relues?.n ?? 0,
        dansLeProchainLot: Math.min(aFaire.length, TAILLE_MAX_LOT_REANALYSE),
        lotsNecessaires: Math.ceil(aFaire.length / TAILLE_MAX_LOT_REANALYSE),
        extractionsValidees: aFaire.filter((l) => l.statutExtraction === 'valide').length,
        corrigeesALaMain: aFaire.filter((l) => l.methode === 'saisie_humaine').length,
        demandes: lots,
        garanties: [
          'Aucune réanalyse ne démarre sans une demande explicite d’une personne habilitée.',
          'Une simulation précède toute exécution : elle relit les pièces sans rien écrire.',
          'L’original, les versions d’extraction, les corrections humaines et les décisions sont conservés ; une réanalyse crée une nouvelle version, jamais un remplacement.',
          'Une correction humaine du destinataire n’est jamais écrasée : un désaccord éventuel est seulement signalé.',
        ],
      };
    });
  }

  @Post('dossiers/:entiteId/reanalyses-destinataire')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demander une simulation, puis l’exécution, de la réanalyse du destinataire d’un lot de pièces (révision, 50 pièces au plus)',
    description:
      'Niveau « révision » au moins. mode « simulation » : le worker relit les pièces sans rien écrire. mode « execution » : exige simulationId (simulation terminée du même dossier et de la même version de l’analyseur) ; crée une nouvelle version d’extraction par pièce changée. Le traitement est asynchrone (processus enfant isolé du worker) ; reprise sans doublon.',
  })
  @ApiBody({ schema: schemaOpenApi(demandeReanalyse) })
  async demander(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Body() corps: unknown) {
    exigerUuid(entiteId, 'entiteId');
    const d = valider(demandeReanalyse, corps);
    const lot = await this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'revision');
      let identifiants: Array<{ documentId: string; extractionId: string; version: number }>;
      if (d.mode === 'execution') {
        if (!d.simulationId) throw new BadRequestException({ message: 'Requête invalide', erreurs: [{ champ: 'simulationId', probleme: 'une simulation terminée est requise avant toute exécution' }] });
        const [sim] = await tx.select().from(s.reanalysesDestinataire).where(and(eq(s.reanalysesDestinataire.id, d.simulationId), eq(s.reanalysesDestinataire.entiteId, entiteId)));
        if (!sim || sim.mode !== 'simulation') throw new NotFoundException('Simulation introuvable pour ce dossier');
        if (sim.statut !== 'termine') throw new ConflictException('La simulation n’est pas terminée : attendez son rapport avant de confirmer');
        if (sim.versionAnalyseur !== VERSION_ANALYSEUR_FACTURE) throw new ConflictException('La version de l’analyseur a changé depuis la simulation : relancez une simulation');
        const [deja] = await tx.select({ id: s.reanalysesDestinataire.id }).from(s.reanalysesDestinataire).where(and(eq(s.reanalysesDestinataire.simulationId, sim.id), eq(s.reanalysesDestinataire.mode, 'execution')));
        if (deja) throw new ConflictException('Cette simulation a déjà été exécutée : lancez une nouvelle simulation pour le lot suivant');
        const simulees = await tx.select({ documentId: s.reanalysesDestinatairePieces.documentId }).from(s.reanalysesDestinatairePieces).where(eq(s.reanalysesDestinatairePieces.lotId, sim.id));
        const ids = new Set(simulees.map((p) => p.documentId));
        const encore = ((await tx.execute(this.requeteConcernees(entiteId, VERSION_ANALYSEUR_FACTURE))).rows as unknown as Array<{ documentId: string; extractionId: string; version: number; dejaReanalysee: boolean }>).filter((l) => ids.has(l.documentId) && !l.dejaReanalysee);
        identifiants = encore.slice(0, TAILLE_MAX_LOT_REANALYSE);
      } else {
        const toutes = ((await tx.execute(this.requeteConcernees(entiteId, VERSION_ANALYSEUR_FACTURE))).rows as unknown as Array<{ documentId: string; extractionId: string; version: number; dejaReanalysee: boolean }>).filter((l) => !l.dejaReanalysee);
        identifiants = toutes.slice(0, TAILLE_MAX_LOT_REANALYSE);
      }
      if (identifiants.length === 0) throw new ConflictException('Aucune pièce concernée : rien à réanalyser');
      const [creee] = await tx
        .insert(s.reanalysesDestinataire)
        .values({
          cabinetId: acces.cabinetId,
          entiteId,
          mode: d.mode,
          simulationId: d.mode === 'execution' ? d.simulationId! : null,
          versionAnalyseur: VERSION_ANALYSEUR_FACTURE,
          tailleLot: TAILLE_MAX_LOT_REANALYSE,
          motif: d.motif,
          nbPieces: identifiants.length,
          demandePar: acces.utilisateurId,
        })
        .returning();
      await tx.insert(s.reanalysesDestinatairePieces).values(
        identifiants.map((p) => ({
          cabinetId: acces.cabinetId,
          entiteId,
          lotId: creee!.id,
          documentId: p.documentId,
          extractionAvantId: p.extractionId,
          versionExtractionAvant: p.version,
          versionAnalyseur: VERSION_ANALYSEUR_FACTURE,
          execution: d.mode === 'execution',
        })),
      );
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: d.mode === 'execution' ? 'reanalyse_destinataire.demandee' : 'reanalyse_destinataire.simulation_demandee',
        cibleType: 'reanalyse_destinataire',
        cibleId: creee!.id,
        entiteId,
        details: { mode: d.mode, motif: d.motif, nbPieces: identifiants.length, versionAnalyseur: VERSION_ANALYSEUR_FACTURE, simulationId: d.simulationId ?? null },
      });
      return creee!;
    });
    await this.taches.reanalyserDestinataire({ cabinetId: acces.cabinetId, lotId: lot.id });
    return lot;
  }

  @Get('reanalyses-destinataire/:id')
  @ApiOperation({
    summary: 'Rapport d’une demande de réanalyse : décomptes et résultat pour chaque pièce (inchangée, destinataire trouvé, abstention motivée, erreur)',
    description: 'Niveau « collaboration » au moins sur le dossier.',
  })
  async rapport(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [lot] = await tx.select().from(s.reanalysesDestinataire).where(eq(s.reanalysesDestinataire.id, id));
      if (!lot) throw new NotFoundException('Demande introuvable');
      const niveau = await exigerNiveau(tx, lot.entiteId, 'collaboration');
      const pieces = await tx
        .select({
          id: s.reanalysesDestinatairePieces.id,
          documentId: s.reanalysesDestinatairePieces.documentId,
          nomFichier: s.documents.nomOrigine,
          statut: s.reanalysesDestinatairePieces.statut,
          resultat: s.reanalysesDestinatairePieces.resultat,
          motif: s.reanalysesDestinatairePieces.motif,
          versionExtractionAvant: s.reanalysesDestinatairePieces.versionExtractionAvant,
          versionExtractionApres: s.reanalysesDestinatairePieces.versionExtractionApres,
          detail: s.reanalysesDestinatairePieces.detail,
          traiteLe: s.reanalysesDestinatairePieces.traiteLe,
        })
        .from(s.reanalysesDestinatairePieces)
        .innerJoin(s.documents, eq(s.documents.id, s.reanalysesDestinatairePieces.documentId))
        .where(eq(s.reanalysesDestinatairePieces.lotId, id))
        .orderBy(asc(s.documents.nomOrigine), asc(s.reanalysesDestinatairePieces.id));
      const decomptes: Record<string, number> = { en_attente: 0, inchangee: 0, destinataire_trouve: 0, abstention: 0, erreur: 0 };
      for (const p of pieces) decomptes[p.resultat ?? 'en_attente'] = (decomptes[p.resultat ?? 'en_attente'] ?? 0) + 1;
      const [demandeur] = await tx.select({ nom: s.utilisateurs.nom }).from(s.utilisateurs).where(eq(s.utilisateurs.id, lot.demandePar));
      const [suite] = lot.mode === 'simulation' ? await tx.select({ id: s.reanalysesDestinataire.id }).from(s.reanalysesDestinataire).where(eq(s.reanalysesDestinataire.simulationId, lot.id)) : [];
      return {
        niveau,
        demande: { ...lot, demandeur: demandeur?.nom ?? null },
        resultatsPossibles: RESULTATS,
        decomptes,
        // Simulation : combien de pièces changeraient (une nouvelle version serait créée).
        changeraient: pieces.filter((p) => p.resultat === 'destinataire_trouve' || p.resultat === 'abstention').length,
        executable: lot.mode === 'simulation' && lot.statut === 'termine' && !suite && lot.versionAnalyseur === VERSION_ANALYSEUR_FACTURE,
        executionId: suite?.id ?? null,
        pieces,
      };
    });
  }

  @Post('reanalyses-destinataire/:id/reprendre')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Reprendre une demande de réanalyse interrompue (révision) : seules les pièces non terminées sont traitées, sans doublon',
    description: 'Sans effet sur une demande terminée. Les pièces déjà conclues ne sont jamais refaites.',
  })
  async reprendre(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const lot = await this.bd.avecContexte(acces, async (tx) => {
      const [l] = await tx.select().from(s.reanalysesDestinataire).where(eq(s.reanalysesDestinataire.id, id));
      if (!l) throw new NotFoundException('Demande introuvable');
      await exigerNiveau(tx, l.entiteId, 'revision');
      if (l.statut !== 'termine') {
        await journaliser(tx, {
          cabinetId: acces.cabinetId,
          acteurId: acces.utilisateurId,
          action: 'reanalyse_destinataire.reprise_demandee',
          cibleType: 'reanalyse_destinataire',
          cibleId: id,
          entiteId: l.entiteId,
          details: { statut: l.statut },
        });
      }
      return l;
    });
    if (lot.statut !== 'termine') await this.taches.reanalyserDestinataire({ cabinetId: acces.cabinetId, lotId: id });
    return { accepte: lot.statut !== 'termine', statut: lot.statut };
  }
}
