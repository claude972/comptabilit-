import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type ChampsFacture, schemaChaineDecimale, verifierCoherenceFacture } from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Files, Stockage } from '@comtaple/plateforme';
import type { Response } from 'express';
import { z } from 'zod';
import { type Acces, AccesCourant, auMoins, exigerNiveau, exigerUuid, type Niveau } from './acces.js';
import { BD, STOCKAGE, TACHES } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const correction = z.object({
  champs: z
    .object({
      typeDocument: z.enum(['facture', 'avoir', 'inconnu']),
      numero: z.string().max(100),
      dateEmission: dateIso,
      dateEcheance: dateIso,
      emetteurNom: z.string().max(200),
      emetteurSiren: z.string().max(20),
      emetteurSiret: z.string().max(20),
      emetteurTva: z.string().max(20),
      totalHt: schemaChaineDecimale,
      totalTva: schemaChaineDecimale,
      totalTtc: schemaChaineDecimale,
      devise: z.string().length(3),
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, 'au moins un champ à corriger'),
});
const echange = z.object({
  type: z.enum(['signalement_erreur', 'demande_complement', 'reponse']),
  message: z.string().min(1).max(4000),
});
const qualification = z
  .object({ nature: z.enum(s.natureDocument.enumValues), exerciceId: uuid.nullable() })
  .partial()
  .refine((c) => Object.keys(c).length > 0, 'aucune modification');
const decision = z.object({ decision: z.enum(['valider', 'rejeter']), motif: z.string().max(2000).optional() });

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('v1/documents')
export class DocumentsController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(TACHES) private readonly taches: Files,
  ) {}

  /** Charge un document en appliquant la règle « un déposant ne voit que ses propres dépôts ». */
  private async charger(tx: Tx, acces: Acces, id: string): Promise<{ doc: typeof s.documents.$inferSelect; niveau: Niveau }> {
    const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, id));
    if (!doc) throw new NotFoundException('Document introuvable');
    const niveau = await exigerNiveau(tx, doc.entiteId, 'depot');
    if (niveau === 'depot') {
      const [mienne] = await tx
        .select({ id: s.receptions.id })
        .from(s.receptions)
        .where(and(eq(s.receptions.documentId, id), eq(s.receptions.deposantId, acces.utilisateurId)));
      if (!mienne) throw new NotFoundException('Document introuvable');
    }
    return { doc, niveau };
  }

  @Get()
  @ApiOperation({ summary: 'Liste des documents d’un dossier (un déposant ne voit que ses propres dépôts)' })
  @ApiQuery({ name: 'entiteId', required: true })
  @ApiQuery({ name: 'statut', required: false })
  async lister(@AccesCourant() acces: Acces, @Query('entiteId') entiteId: string, @Query('statut') statut?: string) {
    exigerUuid(entiteId, 'entiteId');
    if (statut && !(s.statutDocument.enumValues as readonly string[]).includes(statut)) throw new BadRequestException('statut inconnu');
    return this.bd.avecContexte(acces, async (tx) => {
      const niveau = await exigerNiveau(tx, entiteId, 'depot');
      const conditions = [eq(s.documents.entiteId, entiteId)];
      if (statut) conditions.push(eq(s.documents.statut, statut as (typeof s.statutDocument.enumValues)[number]));
      if (niveau === 'depot') {
        conditions.push(
          sql`exists (select 1 from receptions r where r.document_id = ${s.documents.id} and r.deposant_id = ${acces.utilisateurId}::uuid)`,
        );
      }
      const lignes = await tx
        .select({
          id: s.documents.id,
          nomOrigine: s.documents.nomOrigine,
          nature: s.documents.nature,
          statut: s.documents.statut,
          motifStatut: s.documents.motifStatut,
          creeLe: s.documents.creeLe,
          majLe: s.documents.majLe,
          nbReceptions: sql<number>`(select count(*)::int from receptions r where r.document_id = ${s.documents.id})`,
          demandesOuvertes: sql<number>`(select count(*)::int from echanges_document e where e.document_id = ${s.documents.id} and e.type = 'demande_complement' and not e.resolu)`,
        })
        .from(s.documents)
        .where(and(...conditions))
        .orderBy(desc(s.documents.creeLe))
        .limit(500);
      return { niveau, documents: lignes };
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’un document : réceptions, extraction en vigueur (projet ou validée), vérifications, échanges' })
  async detail(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc, niveau } = await this.charger(tx, acces, id);
      const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, doc.fichierId));
      const receptions = await tx.select().from(s.receptions).where(eq(s.receptions.documentId, id)).orderBy(asc(s.receptions.recuLe));
      const [extraction] = await tx
        .select()
        .from(s.extractions)
        .where(and(eq(s.extractions.documentId, id), eq(s.extractions.actuelle, true)));
      const echanges = await tx
        .select({
          id: s.echangesDocument.id,
          type: s.echangesDocument.type,
          message: s.echangesDocument.message,
          resolu: s.echangesDocument.resolu,
          creeLe: s.echangesDocument.creeLe,
          auteur: s.utilisateurs.nom,
        })
        .from(s.echangesDocument)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.echangesDocument.auteurId))
        .where(eq(s.echangesDocument.documentId, id))
        .orderBy(asc(s.echangesDocument.creeLe));
      return {
        niveau,
        document: doc,
        fichier: fichier && {
          sha256: fichier.sha256,
          taille: fichier.taille,
          typeMimeDetecte: fichier.typeMimeDetecte,
          analyseAntivirus: fichier.analyseAntivirus,
        },
        receptions: receptions.map((r) => ({ id: r.id, canal: r.canal, recuLe: r.recuLe, doublonBinaire: r.doublonBinaire, parMoi: r.deposantId === acces.utilisateurId })),
        extraction: extraction ?? null,
        echanges,
      };
    });
  }

  @Get(':id/contenu')
  @ApiOperation({
    summary: 'Contenu de l’original, servi sous contrôle d’accès (jamais avant le verdict antivirus)',
    description: 'Pas de lien public : chaque lecture passe par les habilitations et est journalisée.',
  })
  async contenu(@AccesCourant() acces: Acces, @Param('id') id: string, @Res() res: Response) {
    exigerUuid(id);
    const fichier = await this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.charger(tx, acces, id);
      const [f] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, doc.fichierId));
      if (!f) throw new NotFoundException('Fichier introuvable');
      if (f.analyseAntivirus !== 'sain') throw new ConflictException('Fichier indisponible : analyse antivirus non concluante ou en attente');
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'document.consulte',
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
      });
      return f;
    });
    const sur = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
    const type = fichier.typeMimeDetecte && sur.includes(fichier.typeMimeDetecte) ? fichier.typeMimeDetecte : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(fichier.taille));
    res.setHeader('Content-Disposition', type === 'application/octet-stream' ? 'attachment' : 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    (await this.stockage.lireFlux(fichier.cleStockage)).pipe(res);
  }

  @Post(':id/echanges')
  @ApiOperation({ summary: 'Signaler une erreur, demander un complément (collaborateur) ou y répondre' })
  @ApiBody({ schema: schemaOpenApi(echange) })
  async echanger(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(echange, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc, niveau } = await this.charger(tx, acces, id);
      if (d.type === 'demande_complement' && !auMoins(niveau, 'collaboration')) {
        throw new ForbiddenException('Seul un collaborateur habilité peut demander un complément');
      }
      const [e] = await tx
        .insert(s.echangesDocument)
        .values({ cabinetId: acces.cabinetId, entiteId: doc.entiteId, documentId: id, type: d.type, message: d.message, auteurId: acces.utilisateurId })
        .returning();
      if (d.type === 'demande_complement') {
        await tx.update(s.documents).set({ statut: 'a_completer', majLe: sql`now()` }).where(eq(s.documents.id, id));
      }
      if (d.type === 'reponse') {
        await tx
          .update(s.echangesDocument)
          .set({ resolu: true })
          .where(and(eq(s.echangesDocument.documentId, id), eq(s.echangesDocument.type, 'demande_complement')));
        if (doc.statut === 'a_completer') await tx.update(s.documents).set({ statut: 'a_controler', majLe: sql`now()` }).where(eq(s.documents.id, id));
      }
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: `document.${d.type}`,
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
      });
      return e;
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Qualifier la nature du document ou le rattacher à un exercice' })
  @ApiBody({ schema: schemaOpenApi(qualification) })
  async qualifier(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(qualification, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.charger(tx, acces, id);
      await exigerNiveau(tx, doc.entiteId, 'collaboration');
      if (d.exerciceId) {
        const [ex] = await tx.select().from(s.exercices).where(and(eq(s.exercices.id, d.exerciceId), eq(s.exercices.entiteId, doc.entiteId)));
        if (!ex) throw new NotFoundException('Exercice introuvable pour ce dossier');
      }
      const [maj] = await tx
        .update(s.documents)
        .set({ ...(d.nature ? { nature: d.nature } : {}), ...(d.exerciceId !== undefined ? { exerciceId: d.exerciceId } : {}), majLe: sql`now()` })
        .where(eq(s.documents.id, id))
        .returning();
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'document.qualifie',
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
        details: { nature: d.nature ?? null, exerciceId: d.exerciceId ?? null },
      });
      return maj;
    });
  }

  @Put(':id/extraction')
  @ApiOperation({
    summary: 'Corriger des champs extraits : crée une nouvelle version de l’extraction (les versions précédentes sont conservées)',
    description: 'Les vérifications arithmétiques sont recalculées par le moteur déterministe. Le résultat reste un projet jusqu’à validation.',
  })
  @ApiBody({ schema: schemaOpenApi(correction) })
  async corriger(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(correction, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.charger(tx, acces, id);
      await exigerNiveau(tx, doc.entiteId, 'collaboration');
      const [actuelle] = await tx
        .select()
        .from(s.extractions)
        .where(and(eq(s.extractions.documentId, id), eq(s.extractions.actuelle, true)))
        .for('update');
      const base = (actuelle?.champs ?? { ventilationTva: [] }) as Record<string, unknown>;
      const champs: Record<string, unknown> = { ...base };
      for (const [nom, valeur] of Object.entries(d.champs)) {
        champs[nom] = { valeur, page: null, extrait: null, boite: null, methode: 'saisie_humaine', confiance: 'non_evaluee', corrigePar: acces.utilisateurId };
      }
      const verifications = verifierCoherenceFacture(champs as unknown as ChampsFacture);
      if (actuelle) await tx.update(s.extractions).set({ actuelle: false }).where(eq(s.extractions.id, actuelle.id));
      const [nouvelle] = await tx
        .insert(s.extractions)
        .values({
          cabinetId: acces.cabinetId,
          entiteId: doc.entiteId,
          documentId: id,
          version: (actuelle?.version ?? 0) + 1,
          methode: 'saisie_humaine',
          moteur: null,
          champs,
          verifications,
          statut: 'projet',
        })
        .returning();
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'extraction.corrigee',
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
        details: { version: nouvelle!.version, champs: Object.keys(d.champs) },
      });
      return nouvelle;
    });
  }

  @Post(':id/validation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Valider ou rejeter l’extraction en vigueur (réviseur habilité)',
    description: 'La validation porte sur une version déterminée de l’extraction ; toute correction ultérieure crée une nouvelle version non validée.',
  })
  @ApiBody({ schema: schemaOpenApi(decision) })
  async validerExtraction(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(decision, corps);
    if (d.decision === 'rejeter' && !d.motif) throw new BadRequestException('Un motif est requis pour rejeter');
    return this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.charger(tx, acces, id);
      await exigerNiveau(tx, doc.entiteId, 'revision');
      const [actuelle] = await tx
        .select()
        .from(s.extractions)
        .where(and(eq(s.extractions.documentId, id), eq(s.extractions.actuelle, true)))
        .for('update');
      if (!actuelle) throw new ConflictException('Aucune extraction à valider : le document est encore en analyse');
      await tx
        .update(s.extractions)
        .set({ statut: d.decision === 'valider' ? 'valide' : 'rejete' })
        .where(eq(s.extractions.id, actuelle.id));
      await tx
        .update(s.documents)
        .set({ statut: d.decision === 'valider' ? 'traite' : 'rejete', motifStatut: d.motif ?? null, majLe: sql`now()` })
        .where(eq(s.documents.id, id));
      await tx.insert(s.decisions).values({
        cabinetId: acces.cabinetId,
        entiteId: doc.entiteId,
        cibleType: 'extraction',
        cibleId: actuelle.id,
        versionCible: actuelle.version,
        action: d.decision,
        motif: d.motif ?? null,
        auteurId: acces.utilisateurId,
      });
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: `extraction.${d.decision === 'valider' ? 'validee' : 'rejetee'}`,
        cibleType: 'document',
        cibleId: id,
        entiteId: doc.entiteId,
        details: { versionExtraction: actuelle.version },
      });
      return { documentId: id, statut: d.decision === 'valider' ? 'traite' : 'rejete', versionExtraction: actuelle.version };
    });
  }

  @Post(':id/reanalyse')
  @HttpCode(202)
  @ApiOperation({ summary: 'Relancer l’analyse d’un document (collaborateur habilité)' })
  async reanalyser(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    await this.bd.avecContexte(acces, async (tx) => {
      const { doc } = await this.charger(tx, acces, id);
      await exigerNiveau(tx, doc.entiteId, 'collaboration');
      if (doc.statut === 'traite') throw new ConflictException('Document déjà validé');
    });
    await this.taches.analyserDocument({ cabinetId: acces.cabinetId, documentId: id });
    return { accepte: true };
  }
}
