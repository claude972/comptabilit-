import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, and, asc, desc, eq, inArray, journaliser, notifier, schema as s, type Tx } from '@comtaple/db';
import type { Files, Stockage } from '@comtaple/plateforme';
import type { Response } from 'express';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid, type Niveau } from './acces.js';
import { BD, STOCKAGE, TACHES } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

type StatutRevue = (typeof s.statutRevue.enumValues)[number];

/** Actions de revue : statut résultant, niveau minimal, motif obligatoire ou non. */
const ACTIONS: Record<string, { statut: StatutRevue | null; niveau: Niveau; motifRequis: boolean }> = {
  prendre_en_charge: { statut: 'en_cours', niveau: 'collaboration', motifRequis: false },
  affecter: { statut: null, niveau: 'collaboration', motifRequis: false },
  commenter: { statut: null, niveau: 'collaboration', motifRequis: true },
  demander_piece: { statut: 'piece_demandee', niveau: 'collaboration', motifRequis: true },
  corriger: { statut: 'corrige', niveau: 'collaboration', motifRequis: true },
  accepter: { statut: 'accepte', niveau: 'revision', motifRequis: true },
  rejeter: { statut: 'rejete', niveau: 'revision', motifRequis: true },
  confirmer_anomalie: { statut: 'anomalie_confirmee', niveau: 'revision', motifRequis: true },
  cloturer: { statut: 'cloture', niveau: 'revision', motifRequis: true },
  rouvrir: { statut: 'a_examiner', niveau: 'revision', motifRequis: true },
};

const actionConstat = z.object({
  action: z.enum(Object.keys(ACTIONS) as [string, ...string[]]),
  motif: z.string().min(1).max(4000).optional(),
  affecteA: uuid.optional(),
});

@ApiTags('Révision comptable')
@ApiBearerAuth()
@Controller('v1')
export class ComptabiliteController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(TACHES) private readonly taches: Files,
  ) {}

  private async exercice(tx: Tx, id: string, minimum: Niveau) {
    // Sans habilitation de lecture, la politique RLS masque l'exercice : 404.
    const [ex] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
    if (!ex) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, ex.entiteId, minimum);
    return ex;
  }

  @Get('exercices/:id/imports')
  @ApiOperation({ summary: 'Lots d’import comptable d’un exercice (versions successives, lot actif, rapports)' })
  async imports(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await this.exercice(tx, id, 'lecture');
      const lots = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.exerciceId, id)).orderBy(desc(s.lotsImport.version));
      return avecNomsAnnulation(tx, lots);
    });
  }

  @Get('imports/:id')
  @ApiOperation({ summary: 'État et rapport d’un lot d’import (progression, lisible / conforme / suffisant, anomalies ligne par ligne)' })
  async lot(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, id));
      if (!lot) throw new NotFoundException('Import introuvable');
      return (await avecNomsAnnulation(tx, [lot]))[0];
    });
  }

  @Get('imports/:id/anomalies')
  @ApiOperation({
    summary: 'Anomalies ligne par ligne d’un import, paginées',
    description: 'Le détail est plafonné par le moteur (voir « nbAnomaliesParCode » du rapport pour le décompte complet).',
  })
  async anomalies(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('page') pageBrute?: string, @Query('code') code?: string) {
    exigerUuid(id);
    const page = Math.max(Number(pageBrute) || 1, 1);
    const TAILLE = 100;
    return this.bd.avecContexte(acces, async (tx) => {
      const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, id));
      if (!lot) throw new NotFoundException('Import introuvable');
      const toutes = ((lot.rapport as { anomalies?: Array<{ code: string }> } | null)?.anomalies ?? []).filter((a) => !code || a.code === code);
      return { page, taillePage: TAILLE, total: toutes.length, suite: page * TAILLE < toutes.length, anomalies: toutes.slice((page - 1) * TAILLE, page * TAILLE) };
    });
  }

  @Get('exercices/:id/revue')
  @ApiOperation({
    summary: 'Dernière exécution des contrôles : résultats par contrôle et constats',
    description:
      'Chaque contrôle porte son statut (sans anomalie détectée, constat, non applicable, non réalisé faute de données, erreur technique). « obsolete » signale que les données ont changé depuis l’exécution.',
  })
  async revue(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'lecture');
      const [execution] = await tx
        .select()
        .from(s.executionsControles)
        .where(eq(s.executionsControles.exerciceId, id))
        .orderBy(desc(s.executionsControles.creeLe))
        .limit(1);
      if (!execution) return { exercice: ex, execution: null, resultats: [], constats: [] };
      const resultats = await tx
        .select()
        .from(s.resultatsControles)
        .where(eq(s.resultatsControles.executionId, execution.id))
        .orderBy(asc(s.resultatsControles.controleId));
      const constats = await tx
        .select()
        .from(s.constats)
        .where(eq(s.constats.executionId, execution.id))
        .orderBy(asc(s.constats.controleId), asc(s.constats.cle));
      return { exercice: ex, execution, resultats, constats };
    });
  }

  @Post('exercices/:id/controles')
  @HttpCode(202)
  @ApiOperation({ summary: 'Lancer une nouvelle exécution des contrôles sur le lot actif de l’exercice' })
  async lancer(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const execution = await this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'collaboration');
      const [lot] = await tx
        .select()
        .from(s.lotsImport)
        .where(and(eq(s.lotsImport.exerciceId, id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : les contrôles ne peuvent pas être réalisés');
      const [e] = await tx
        .insert(s.executionsControles)
        .values({ cabinetId: acces.cabinetId, entiteId: ex.entiteId, exerciceId: id, lotImportId: lot.id, versionDonnees: ex.versionDonnees, lancePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'controles.lances',
        cibleType: 'execution_controles',
        cibleId: e!.id,
        entiteId: ex.entiteId,
        details: { lotImportId: lot.id, versionDonnees: ex.versionDonnees },
      });
      return e!;
    });
    await this.taches.executerControles({ cabinetId: acces.cabinetId, executionId: execution.id });
    return execution;
  }

  @Get('constats/:id')
  @ApiOperation({ summary: 'Détail d’un constat : écritures concernées, preuves, historique des décisions et commentaires' })
  async constat(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [c] = await tx.select().from(s.constats).where(eq(s.constats.id, id));
      if (!c) throw new NotFoundException('Constat introuvable');
      const ids = (c.lignesConcernees as string[]).slice(0, 200).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const lignes = ids.length
        ? await tx
            .select()
            .from(s.lignesEcriture)
            .where(inArray(s.lignesEcriture.id, ids))
            .orderBy(asc(s.lignesEcriture.ecritureDate), asc(s.lignesEcriture.ecritureNum), asc(s.lignesEcriture.numeroLigne))
        : [];
      const decisions = await tx
        .select({ action: s.decisions.action, motif: s.decisions.motif, versionCible: s.decisions.versionCible, creeLe: s.decisions.creeLe, auteur: s.utilisateurs.nom })
        .from(s.decisions)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.decisions.auteurId))
        .where(and(eq(s.decisions.cibleType, 'constat'), eq(s.decisions.cibleId, id)))
        .orderBy(asc(s.decisions.creeLe));
      const [resultat] = await tx.select().from(s.resultatsControles).where(eq(s.resultatsControles.id, c.resultatId));
      return { constat: c, lignes, nbLignesTotal: (c.lignesConcernees as string[]).length, decisions, controle: resultat };
    });
  }

  @Patch('constats/:id')
  @ApiOperation({
    summary: 'Traiter un constat : prendre en charge, affecter, commenter, demander une pièce, corriger, accepter, rejeter, confirmer, clôturer',
    description: 'Accepter, rejeter, confirmer, clôturer et rouvrir exigent une habilitation de révision et un motif. Chaque action est historisée avec la version des données.',
  })
  @ApiBody({ schema: schemaOpenApi(actionConstat) })
  async traiter(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(actionConstat, corps);
    const regle = ACTIONS[d.action]!;
    if (regle.motifRequis && !d.motif) throw new BadRequestException('Un motif est requis pour cette action');
    if (d.action === 'affecter' && !d.affecteA) throw new BadRequestException('affecteA requis');
    return this.bd.avecContexte(acces, async (tx) => {
      const [c] = await tx.select().from(s.constats).where(eq(s.constats.id, id)).for('update');
      if (!c) throw new NotFoundException('Constat introuvable');
      await exigerNiveau(tx, c.entiteId, regle.niveau);
      const [execution] = await tx.select().from(s.executionsControles).where(eq(s.executionsControles.id, c.executionId));
      if (d.affecteA) {
        const [membre] = await tx
          .select({ id: s.habilitationsDossier.id })
          .from(s.habilitationsDossier)
          .where(and(eq(s.habilitationsDossier.entiteId, c.entiteId), eq(s.habilitationsDossier.utilisateurId, d.affecteA)));
        if (!membre) throw new BadRequestException('La personne désignée n’est pas habilitée sur ce dossier');
      }
      const [maj] = await tx
        .update(s.constats)
        .set({
          ...(regle.statut ? { statutRevue: regle.statut } : {}),
          ...(d.action === 'affecter' ? { affecteA: d.affecteA! } : {}),
          ...(d.action === 'prendre_en_charge' ? { affecteA: acces.utilisateurId } : {}),
          aRevoir: false,
        })
        .where(eq(s.constats.id, id))
        .returning();
      // La personne à qui le constat est affecté est prévenue dans l'application (jamais l'auteur de l'affectation lui-même).
      if (d.action === 'affecter') await notifier(tx, [d.affecteA], { type: 'constat.affecte', entiteId: c.entiteId, cibleType: 'constat', cibleId: id, donnees: { controleId: c.controleId } });
      await tx.insert(s.decisions).values({
        cabinetId: acces.cabinetId,
        entiteId: c.entiteId,
        cibleType: 'constat',
        cibleId: id,
        versionCible: execution?.versionDonnees ?? 0,
        action: d.action,
        motif: d.motif ?? null,
        auteurId: acces.utilisateurId,
      });
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: `constat.${d.action}`,
        cibleType: 'constat',
        cibleId: id,
        entiteId: c.entiteId,
        details: { controleId: c.controleId, statut: maj!.statutRevue },
      });
      return maj;
    });
  }

  @Post('exercices/:id/dossier-revision')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demander la génération du dossier de révision (PDF + données structurées + inventaire des pièces)',
    description: 'Le dossier est figé sur la dernière exécution des contrôles et porte la mention « projet » tant qu’aucune validation professionnelle n’est enregistrée.',
  })
  async demanderDossier(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const exp = await this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'collaboration');
      const [execution] = await tx
        .select()
        .from(s.executionsControles)
        .where(and(eq(s.executionsControles.exerciceId, id), eq(s.executionsControles.statut, 'termine')))
        .orderBy(desc(s.executionsControles.creeLe))
        .limit(1);
      if (!execution) throw new ConflictException('Aucune exécution de contrôles terminée pour cet exercice');
      const [e] = await tx
        .insert(s.exportsRevision)
        .values({ cabinetId: acces.cabinetId, entiteId: ex.entiteId, exerciceId: id, executionId: execution.id, versionDonnees: execution.versionDonnees, demandePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'dossier_revision.demande',
        cibleType: 'export_revision',
        cibleId: e!.id,
        entiteId: ex.entiteId,
      });
      return e!;
    });
    await this.taches.genererDossier({ cabinetId: acces.cabinetId, exportId: exp.id });
    return exp;
  }

  @Get('exercices/:id/dossiers-revision')
  @ApiOperation({ summary: 'Dossiers de révision générés pour un exercice' })
  async dossiersRevision(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await this.exercice(tx, id, 'lecture');
      return tx.select().from(s.exportsRevision).where(eq(s.exportsRevision.exerciceId, id)).orderBy(desc(s.exportsRevision.creeLe));
    });
  }

  @Get('dossiers-revision/:id/:format')
  @ApiOperation({ summary: 'Télécharger le dossier de révision (format « pdf » ou « donnees »)' })
  async telecharger(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('format') format: string, @Res() res: Response) {
    exigerUuid(id);
    if (format !== 'pdf' && format !== 'donnees') throw new BadRequestException('format inconnu');
    const exp = await this.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx.select().from(s.exportsRevision).where(eq(s.exportsRevision.id, id));
      if (!e) throw new NotFoundException('Dossier de révision introuvable');
      if (e.statut !== 'termine') throw new ConflictException(`Dossier de révision non disponible (statut : ${e.statut})`);
      await journaliser(tx, {
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'dossier_revision.telecharge',
        cibleType: 'export_revision',
        cibleId: id,
        entiteId: e.entiteId,
        details: { format },
      });
      return e;
    });
    const cle = format === 'pdf' ? exp.clePdf : exp.cleDonnees;
    if (!cle) throw new NotFoundException('Fichier absent');
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dossier-revision-${id}.${format === 'pdf' ? 'pdf' : 'json'}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    (await this.stockage.lireFlux(cle)).pipe(res);
  }
}

/** Complète des lots d'import par le nom de l'auteur d'une annulation (membre du cabinet), pour l'affichage. */
export async function avecNomsAnnulation<T extends { annulePar: string | null }>(tx: Tx, lots: T[]): Promise<Array<T & { annuleParNom: string | null }>> {
  const ids = [...new Set(lots.map((l) => l.annulePar).filter((x): x is string => Boolean(x)))];
  const noms = ids.length ? await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, ids)) : [];
  const nomDe = new Map(noms.map((n) => [n.id, n.nom]));
  return lots.map((l) => ({ ...l, annuleParNom: l.annulePar ? (nomDe.get(l.annulePar) ?? null) : null }));
}
