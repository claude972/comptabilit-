import { ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, desc, eq, journaliser, schema as s } from '@comtaple/db';
import type { Files, Stockage } from '@comtaple/plateforme';
import type { Response } from 'express';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD, STOCKAGE, TACHES } from './jetons.js';

@ApiTags('Restitution')
@ApiBearerAuth()
@Controller('v1')
export class RestitutionController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(TACHES) private readonly taches: Files,
  ) {}

  @Post('dossiers/:id/restitutions')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demander l’export de restitution complet d’un dossier (habilitation de validation)',
    description:
      'Archive ZIP : originaux non modifiés, données structurées, écritures normalisées, constats, décisions, rapprochements, règles du cabinet applicables, journal d’audit du dossier, et un manifeste d’empreintes SHA-256. Reste possible quand l’abonnement est suspendu ou résilié.',
  })
  async demander(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const r = await this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'validation');
      const [cree] = await tx.insert(s.restitutions).values({ cabinetId: acces.cabinetId, entiteId: id, demandePar: acces.utilisateurId }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'restitution.demandee', cibleType: 'restitution', cibleId: cree!.id, entiteId: id });
      return cree!;
    });
    await this.taches.genererRestitution({ cabinetId: acces.cabinetId, restitutionId: r.id });
    return r;
  }

  @Get('dossiers/:id/restitutions')
  @ApiOperation({ summary: 'Exports de restitution d’un dossier' })
  async lister(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'validation');
      return tx.select().from(s.restitutions).where(eq(s.restitutions.entiteId, id)).orderBy(desc(s.restitutions.creeLe)).limit(50);
    });
  }

  @Get('restitutions/:id/archive')
  @ApiOperation({ summary: 'Télécharger l’archive de restitution (journalisé)' })
  async telecharger(@AccesCourant() acces: Acces, @Param('id') id: string, @Res() res: Response) {
    exigerUuid(id);
    const r = await this.bd.avecContexte(acces, async (tx) => {
      const [x] = await tx.select().from(s.restitutions).where(eq(s.restitutions.id, id));
      if (!x) throw new NotFoundException('Restitution introuvable');
      await exigerNiveau(tx, x.entiteId, 'validation');
      if (x.statut !== 'termine' || !x.cleArchive) throw new ConflictException(`Archive non disponible (statut : ${x.statut})`);
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'restitution.telechargee', cibleType: 'restitution', cibleId: id, entiteId: x.entiteId });
      return x;
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(r.taille));
    res.setHeader('Content-Disposition', `attachment; filename="restitution-${id}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    (await this.stockage.lireFlux(r.cleArchive!)).pipe(res);
  }
}
