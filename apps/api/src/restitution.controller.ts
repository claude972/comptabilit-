import { ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, type Tx, desc, eq, journaliser, schema as s, sql } from '@comtaple/db';
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

  // ── Restitution d'un cabinet entier ──

  private async exigerGestionnaire(tx: Tx): Promise<void> {
    if ((await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok !== true) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
  }

  /** Dossiers du cabinet, avec le niveau d'habilitation de l'appelant : seuls ceux au niveau « validation » sont restituables par lui. */
  private async perimetre(tx: Tx) {
    const dossiers = (await tx.execute(sql`select e.id, e.raison_sociale as "raisonSociale", app_niveau_entite(e.id)::text as niveau from entites e order by e.raison_sociale, e.id`)).rows as Array<{ id: string; raisonSociale: string; niveau: string | null }>;
    const inclus = dossiers.filter((d) => d.niveau === 'validation');
    const ecartes = dossiers
      .filter((d) => d.niveau !== 'validation')
      .map((d) => ({ id: d.id, raisonSociale: d.raisonSociale, motif: d.niveau === null ? 'Vous n’êtes pas habilité sur ce dossier' : `Votre habilitation sur ce dossier (${d.niveau}) est inférieure au niveau « validation »` }));
    return { inclus, ecartes };
  }

  @Get('cabinet/restitutions/perimetre')
  @ApiOperation({
    summary: 'Périmètre qu’aurait une restitution du cabinet demandée maintenant par l’appelant (gestionnaires)',
    description: 'Un dossier n’entre dans la restitution que si l’appelant y a le niveau « validation ». Les autres sont listés avec le motif : rien n’est restitué en contournant une habilitation.',
  })
  async apercuPerimetre(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.exigerGestionnaire(tx);
      const p = await this.perimetre(tx);
      return { complet: p.ecartes.length === 0, inclus: p.inclus.map(({ id, raisonSociale }) => ({ id, raisonSociale })), ecartes: p.ecartes };
    });
  }

  @Post('cabinet/restitutions')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Demander la restitution du cabinet entier (gestionnaires)',
    description:
      'Archive ZIP construite en flux : données du cabinet et des dossiers du périmètre (une table par fichier, JSON Lines), écritures normalisées, originaux non modifiés, et un manifeste d’empreintes SHA-256 vérifiable sans le logiciel. Le périmètre est figé à la demande d’après les habilitations du demandeur ; les dossiers écartés sont listés avec leur motif et l’archive est alors marquée incomplète. Reste possible quand l’abonnement est suspendu ou résilié.',
  })
  async demanderCabinet(@AccesCourant() acces: Acces) {
    const r = await this.bd.avecContexte(acces, async (tx) => {
      await this.exigerGestionnaire(tx);
      const enCours = await tx.select({ id: s.restitutionsCabinet.id }).from(s.restitutionsCabinet).where(sql`${s.restitutionsCabinet.statut} in ('en_attente', 'en_cours')`).limit(1);
      if (enCours.length) throw new ConflictException('Une restitution du cabinet est déjà en cours');
      const p = await this.perimetre(tx);
      const perimetre = { inclus: p.inclus.map((d) => d.id), ecartes: p.ecartes };
      const [cree] = await tx.insert(s.restitutionsCabinet).values({ cabinetId: acces.cabinetId, perimetre, demandePar: acces.utilisateurId }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'restitution_cabinet.demandee', cibleType: 'restitution_cabinet', cibleId: cree!.id, details: { dossiersInclus: perimetre.inclus.length, dossiersEcartes: perimetre.ecartes.length } });
      return cree!;
    });
    await this.taches.genererRestitutionCabinet({ cabinetId: acces.cabinetId, restitutionCabinetId: r.id });
    return r;
  }

  @Get('cabinet/restitutions')
  @ApiOperation({ summary: 'Restitutions du cabinet (gestionnaires), avec le nom du demandeur' })
  async listerCabinet(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.exigerGestionnaire(tx);
      const liste = await tx.select().from(s.restitutionsCabinet).orderBy(desc(s.restitutionsCabinet.creeLe)).limit(50);
      const noms = new Map(((await tx.execute(sql`select u.id, u.nom from utilisateurs u where exists (select 1 from appartenances a where a.utilisateur_id = u.id and a.cabinet_id = ${acces.cabinetId}::uuid)`)).rows as Array<{ id: string; nom: string }>).map((u) => [u.id, u.nom]));
      return liste.map(({ cleArchive: _c, ...r }) => ({ ...r, demandeParNom: noms.get(r.demandePar) ?? null, telechargeable: r.statut === 'termine' && r.demandePar === acces.utilisateurId }));
    });
  }

  @Get('cabinet/restitutions/:id/archive')
  @ApiOperation({
    summary: 'Télécharger l’archive de restitution du cabinet (journalisé)',
    description: 'Réservé à la personne qui a demandé la restitution : le périmètre de l’archive est celui de SES habilitations, un autre gestionnaire ne peut pas s’en servir pour lire des dossiers où il n’est pas habilité.',
  })
  async telechargerCabinet(@AccesCourant() acces: Acces, @Param('id') id: string, @Res() res: Response) {
    exigerUuid(id);
    const r = await this.bd.avecContexte(acces, async (tx) => {
      await this.exigerGestionnaire(tx);
      const [x] = await tx.select().from(s.restitutionsCabinet).where(eq(s.restitutionsCabinet.id, id));
      if (!x) throw new NotFoundException('Restitution introuvable');
      if (x.demandePar !== acces.utilisateurId) throw new ForbiddenException('Seule la personne qui a demandé cette restitution peut la télécharger');
      if (x.statut !== 'termine' || !x.cleArchive) throw new ConflictException(`Archive non disponible (statut : ${x.statut})`);
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'restitution_cabinet.telechargee', cibleType: 'restitution_cabinet', cibleId: id });
      return x;
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(r.taille));
    res.setHeader('Content-Disposition', `attachment; filename="restitution-cabinet-${id}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Empreinte-Sha256', r.sha256 ?? '');
    (await this.stockage.lireFlux(r.cleArchive!)).pipe(res);
  }
}
