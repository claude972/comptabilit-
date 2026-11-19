import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ContenuLettre, estimerTemps, type LettreDatee, PRESTATIONS, schemaContenuLettre, situerTravail } from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const prestation = z.enum(Object.keys(PRESTATIONS) as [string, ...string[]]);
const mission = z.object({ libelle: z.string().min(1).max(200), debut: dateIso.optional(), fin: dateIso.optional() });
const lettre = z.object({ dateEffet: dateIso, contenu: schemaContenuLettre, avenantDe: uuid.optional(), documentId: uuid.optional() });
const travail = z.object({ dateTravail: dateIso, prestation, description: z.string().min(1).max(2000), tempsObserveMinutes: z.number().int().positive().max(100_000).optional() });
const bareme = z.object({ minutesReference: z.number().int().positive().max(100_000) });

@ApiTags('Missions')
@ApiBearerAuth()
@Controller('v1')
export class MissionsController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get('reference/prestations')
  @ApiOperation({ summary: 'Référentiel des prestations utilisé pour décrire un périmètre de mission (convention interne)' })
  prestations() {
    return Object.entries(PRESTATIONS).map(([code, libelle]) => ({ code, libelle }));
  }

  @Post('dossiers/:id/missions')
  @ApiOperation({ summary: 'Créer une mission sur un dossier' })
  @ApiBody({ schema: schemaOpenApi(mission) })
  async creerMission(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(mission, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'collaboration');
      const [m] = await tx.insert(s.missions).values({ cabinetId: acces.cabinetId, entiteId: id, libelle: d.libelle, debut: d.debut ?? null, fin: d.fin ?? null }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'mission.creee', cibleType: 'mission', cibleId: m!.id, entiteId: id });
      return m;
    });
  }

  @Get('dossiers/:id/missions')
  @ApiOperation({ summary: 'Missions d’un dossier avec leurs lettres et avenants (projets et validés)' })
  async missions(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const missions = await tx.select().from(s.missions).where(eq(s.missions.entiteId, id)).orderBy(asc(s.missions.creeLe));
      const lettres = await tx.select().from(s.lettresMission).where(eq(s.lettresMission.entiteId, id)).orderBy(asc(s.lettresMission.dateEffet), asc(s.lettresMission.version));
      return missions.map((m) => ({ ...m, lettres: lettres.filter((l) => l.missionId === m.id) }));
    });
  }

  @Post('missions/:id/lettres')
  @ApiOperation({
    summary: 'Enregistrer une lettre de mission ou un avenant (projet)',
    description: 'Le contenu est structuré : périmètre, durée, honoraires, obligations, livrables, mandats, limites. Un projet n’a aucun effet tant qu’il n’est pas validé.',
  })
  @ApiBody({ schema: schemaOpenApi(lettre) })
  async creerLettre(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(lettre, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const [m] = await tx.select().from(s.missions).where(eq(s.missions.id, id));
      if (!m) throw new NotFoundException('Mission introuvable');
      await exigerNiveau(tx, m.entiteId, 'collaboration');
      if (d.avenantDe) {
        const [base] = await tx.select().from(s.lettresMission).where(and(eq(s.lettresMission.id, d.avenantDe), eq(s.lettresMission.missionId, id)));
        if (!base) throw new BadRequestException('La lettre modifiée par cet avenant est introuvable dans cette mission');
      }
      const [{ max } = { max: 0 }] = (await tx.execute(sql`select coalesce(max(version), 0)::int as max from lettres_mission where mission_id = ${id}::uuid`)).rows as Array<{ max: number }>;
      const [l] = await tx
        .insert(s.lettresMission)
        .values({ cabinetId: acces.cabinetId, entiteId: m.entiteId, missionId: id, avenantDe: d.avenantDe ?? null, documentId: d.documentId ?? null, dateEffet: d.dateEffet, contenu: d.contenu, version: max + 1, redigeePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: d.avenantDe ? 'avenant.redige' : 'lettre_mission.redigee', cibleType: 'lettre_mission', cibleId: l!.id, entiteId: m.entiteId, details: { version: l!.version } });
      return l;
    });
  }

  @Post('lettres/:id/validation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valider une lettre ou un avenant (habilitation de validation) : elle devient applicable à compter de sa date d’effet' })
  async validerLettre(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [l] = await tx.select().from(s.lettresMission).where(eq(s.lettresMission.id, id)).for('update');
      if (!l) throw new NotFoundException('Lettre introuvable');
      await exigerNiveau(tx, l.entiteId, 'validation');
      if (l.statut !== 'projet') throw new ConflictException(`Lettre au statut « ${l.statut} »`);
      const [maj] = await tx.update(s.lettresMission).set({ statut: 'validee', valideePar: acces.utilisateurId, valideeLe: sql`now()` }).where(eq(s.lettresMission.id, id)).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'lettre_mission.validee', cibleType: 'lettre_mission', cibleId: id, entiteId: l.entiteId, details: { version: l.version, dateEffet: l.dateEffet } });
      return maj;
    });
  }

  private async lettresValidees(tx: Tx, entiteId: string): Promise<LettreDatee[]> {
    const lettres = await tx.select().from(s.lettresMission).where(eq(s.lettresMission.entiteId, entiteId));
    return lettres.map((l) => ({ id: l.id, dateEffet: l.dateEffet, statut: l.statut, version: l.version, contenu: l.contenu as ContenuLettre }));
  }

  private async estimation(tx: Tx, prestationCode: string) {
    const [b] = await tx.select().from(s.baremesTemps).where(eq(s.baremesTemps.prestation, prestationCode));
    // Temps observés sur les dossiers visibles de l'appelant (cloisonnement par dossier) : la base est nommée dans la réponse.
    const observes = await tx.select({ m: s.travaux.tempsObserveMinutes }).from(s.travaux).where(and(eq(s.travaux.prestation, prestationCode), sql`${s.travaux.tempsObserveMinutes} is not null`)).limit(2000);
    return estimerTemps({ baremeMinutes: b?.minutesReference ?? null, tempsObservesMinutes: observes.map((o) => o.m!) });
  }

  @Post('dossiers/:id/travaux')
  @ApiOperation({ summary: 'Enregistrer un travail ou une demande ; le temps saisi est un temps OBSERVÉ' })
  @ApiBody({ schema: schemaOpenApi(travail) })
  async creerTravail(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(travail, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'collaboration');
      const [t] = await tx
        .insert(s.travaux)
        .values({ cabinetId: acces.cabinetId, entiteId: id, dateTravail: d.dateTravail, prestation: d.prestation, description: d.description, tempsObserveMinutes: d.tempsObserveMinutes ?? null, auteurId: acces.utilisateurId })
        .returning();
      return { ...t, rattachement: situerTravail(await this.lettresValidees(tx, id), { date: d.dateTravail, prestation: d.prestation }) };
    });
  }

  @Get('dossiers/:id/travaux')
  @ApiOperation({
    summary: 'Travaux d’un dossier, rattachés à la lettre applicable à leur date, avec signalement des travaux potentiellement hors périmètre',
    description: '« potentiellement hors périmètre » est un signalement à examiner, pas une conclusion contractuelle.',
  })
  async travaux(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const lettres = await this.lettresValidees(tx, id);
      const liste = await tx.select().from(s.travaux).where(eq(s.travaux.entiteId, id)).orderBy(desc(s.travaux.dateTravail)).limit(500);
      return liste.map((t) => ({ ...t, rattachement: situerTravail(lettres, { date: t.dateTravail, prestation: t.prestation }) }));
    });
  }

  @Post('travaux/:id/proposition-avenant')
  @ApiOperation({
    summary: 'Préparer un projet d’avenant pour un travail potentiellement hors périmètre',
    description:
      'Reprend le contenu de la lettre applicable en y ajoutant la prestation. Le temps est estimé par le moteur à partir d’une base nommée (barème du cabinet ou temps observés) ; sans base, aucune estimation. Le résultat est un PROJET : il ne produit aucun effet sans validation.',
  })
  async proposerAvenant(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [t] = await tx.select().from(s.travaux).where(eq(s.travaux.id, id));
      if (!t) throw new NotFoundException('Travail introuvable');
      await exigerNiveau(tx, t.entiteId, 'collaboration');
      const lettres = await this.lettresValidees(tx, t.entiteId);
      const situation = situerTravail(lettres, { date: t.dateTravail, prestation: t.prestation });
      if (situation.situation !== 'potentiellement_hors_perimetre') throw new ConflictException(situation.situation === 'dans_le_perimetre' ? 'Ce travail est dans le périmètre de la lettre applicable' : situation.motif);
      const [base] = await tx.select().from(s.lettresMission).where(eq(s.lettresMission.id, situation.lettreId));
      const contenu = base!.contenu as ContenuLettre;
      const estimation = await this.estimation(tx, t.prestation);
      const [{ max } = { max: 0 }] = (await tx.execute(sql`select coalesce(max(version), 0)::int as max from lettres_mission where mission_id = ${base!.missionId}::uuid`)).rows as Array<{ max: number }>;
      const [projet] = await tx
        .insert(s.lettresMission)
        .values({
          cabinetId: acces.cabinetId,
          entiteId: t.entiteId,
          missionId: base!.missionId,
          avenantDe: base!.id,
          dateEffet: t.dateTravail,
          contenu: { ...contenu, perimetre: [...contenu.perimetre, { prestation: t.prestation as ContenuLettre['perimetre'][number]['prestation'], precision: `Ajout proposé à la suite du travail du ${t.dateTravail}` }] },
          origine: 'proposition_avenant',
          version: max + 1,
          redigeePar: acces.utilisateurId,
        })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'avenant.propose', cibleType: 'lettre_mission', cibleId: projet!.id, entiteId: t.entiteId, details: { travailId: id, prestation: t.prestation } });
      return { avenant: projet, motif: situation.motif, estimation, mention: 'Projet d’avenant préparé par le logiciel : à relire, compléter (honoraires) et valider par une personne habilitée.' };
    });
  }

  @Get('cabinet/baremes')
  @ApiOperation({ summary: 'Barème de temps du cabinet par prestation' })
  async baremes(@AccesCourant() acces: Acces) {
    if (acces.role === 'client_deposant' || acces.role === 'client_lecture') throw new ForbiddenException('Réservé aux membres du cabinet');
    return this.bd.avecContexte(acces, (tx) => tx.select().from(s.baremesTemps).orderBy(asc(s.baremesTemps.prestation)));
  }

  @Put('cabinet/baremes/:prestation')
  @ApiOperation({ summary: 'Définir le temps de référence d’une prestation (gestionnaires)' })
  @ApiBody({ schema: schemaOpenApi(bareme) })
  async definirBareme(@AccesCourant() acces: Acces, @Param('prestation') code: string, @Body() corps: unknown) {
    if (!(code in PRESTATIONS)) throw new BadRequestException('Prestation inconnue');
    const d = valider(bareme, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      if (!(await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const [b] = await tx
        .insert(s.baremesTemps)
        .values({ cabinetId: acces.cabinetId, prestation: code, minutesReference: d.minutesReference, definiPar: acces.utilisateurId })
        .onConflictDoUpdate({ target: [s.baremesTemps.cabinetId, s.baremesTemps.prestation], set: { minutesReference: d.minutesReference, definiPar: acces.utilisateurId } })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'bareme.defini', cibleType: 'bareme', cibleId: code, details: { minutesReference: d.minutesReference } });
      return b;
    });
  }
}
