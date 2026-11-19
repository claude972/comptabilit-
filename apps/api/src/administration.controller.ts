import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { validerSiren } from '@comtaple/core';
import { type AccesBd, and, asc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid, niveauSur, SansCabinet } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const dossier = z.object({
  raisonSociale: z.string().min(1).max(200),
  siren: z.string().regex(/^\d{9}$/, 'SIREN à 9 chiffres').optional(),
  formeJuridique: z.string().max(50).optional(),
  regimeFiscal: z.string().max(50).optional(),
  /** Explicite et obligatoire : aucune valeur par défaut « métropole ». */
  territoireFiscal: z.enum(s.territoireFiscal.enumValues),
  codeNaf: z.string().max(10).optional(),
});
const exercice = z.object({ debut: dateIso, fin: dateIso }).refine((e) => e.debut < e.fin, 'la fin doit suivre le début');
const habilitation = z.object({ niveau: z.enum(s.niveauHabilitation.enumValues) });

async function exigerGestionnaire(tx: Tx): Promise<void> {
  const ok = (await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok;
  if (!ok) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
}

/** Niveau maximal qu'un rôle de cabinet peut recevoir sur un dossier : un client ne révise ni ne valide jamais. */
const PLAFOND: Record<string, readonly string[]> = {
  client_deposant: ['depot'],
  client_lecture: ['depot', 'lecture'],
  collaborateur: ['depot', 'lecture', 'collaboration'],
  support: ['lecture'],
  reviseur: ['depot', 'lecture', 'collaboration', 'revision'],
  associe: ['depot', 'lecture', 'collaboration', 'revision', 'validation'],
  administrateur: ['depot', 'lecture', 'collaboration', 'revision', 'validation'],
};

@ApiTags('Administration du cabinet')
@ApiBearerAuth()
@Controller('v1')
export class AdministrationController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @SansCabinet()
  @Get('cabinets')
  @ApiOperation({ summary: 'Cabinets dont le compte est membre (utilisable avant le choix du cabinet, pour un compte multi-cabinets)' })
  async cabinets(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte({ utilisateurId: acces.utilisateurId, sujet: acces.sujet }, (tx) =>
      tx
        .select({ id: s.cabinets.id, nom: s.cabinets.nom, role: s.appartenances.role })
        .from(s.appartenances)
        .innerJoin(s.cabinets, eq(s.cabinets.id, s.appartenances.cabinetId))
        .where(and(eq(s.appartenances.utilisateurId, acces.utilisateurId), eq(s.appartenances.actif, true)))
        .orderBy(asc(s.cabinets.nom)),
    );
  }

  @Get('cabinet/membres')
  @ApiOperation({ summary: 'Membres du cabinet et leur rôle (gestionnaires)' })
  async membresCabinet(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      return tx
        .select({ utilisateurId: s.utilisateurs.id, nom: s.utilisateurs.nom, email: s.utilisateurs.email, role: s.appartenances.role, actif: s.appartenances.actif, expireLe: s.appartenances.expireLe })
        .from(s.appartenances)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.appartenances.utilisateurId))
        .where(eq(s.appartenances.cabinetId, acces.cabinetId))
        .orderBy(asc(s.utilisateurs.nom));
    });
  }

  @Get('cabinet/indicateurs')
  @ApiOperation({
    summary: 'Indicateurs d’activité du cabinet et du logiciel sur une période (gestionnaires)',
    description:
      'Décomptes et durées agrégés par cabinet et par dossier : volumes de pièces, délai de traitement, devenir des extractions automatiques (acceptées, corrigées, rejetées, non examinées), imports, constats, rapprochements, temps observés. Aucun indicateur par personne. Ces chiffres mesurent l’activité enregistrée, pas la qualité des extractions (aucun corpus de référence).',
  })
  async indicateurs(@AccesCourant() acces: Acces, @Query('du') du?: string, @Query('au') au?: string) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const fin = au ?? new Date().toISOString().slice(0, 10);
    const debut = du ?? `${fin.slice(0, 8)}01`;
    if (!iso.test(debut) || !iso.test(fin) || debut > fin) throw new BadRequestException('Période invalide (du, au : AAAA-MM-JJ)');
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const r = await tx.execute(sql`select cabinet_indicateurs(${debut}::date, ${fin}::date) as indicateurs`);
      return { periode: { du: debut, au: fin }, ...(r.rows[0]!.indicateurs as Record<string, unknown>) };
    });
  }

  @Post('dossiers')
  @ApiOperation({
    summary: 'Créer un dossier client (gestionnaires)',
    description: 'Le territoire fiscal est obligatoire et explicite (« a_confirmer » est admis : les contrôles fiscaux ne seront alors pas réalisés). Le créateur n’est PAS habilité automatiquement sur le dossier.',
  })
  @ApiBody({ schema: schemaOpenApi(dossier) })
  async creerDossier(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(dossier, corps);
    if (d.siren && !validerSiren(d.siren).valide) throw new BadRequestException('SIREN invalide (clé de contrôle)');
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [e] = await tx
        .insert(s.entites)
        .values({ cabinetId: acces.cabinetId, raisonSociale: d.raisonSociale, siren: d.siren ?? null, formeJuridique: d.formeJuridique ?? null, regimeFiscal: d.regimeFiscal ?? null, territoireFiscal: d.territoireFiscal, codeNaf: d.codeNaf ?? null })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'dossier.cree', cibleType: 'entite', cibleId: e!.id, entiteId: e!.id, details: { territoireFiscal: d.territoireFiscal } });
      return e;
    });
  }

  @Get('dossiers/:id')
  @ApiOperation({ summary: 'Un dossier et le niveau d’habilitation de l’appelant (null pour un gestionnaire non habilité)' })
  async dossier(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx.select().from(s.entites).where(eq(s.entites.id, id));
      if (!e) throw new NotFoundException('Dossier introuvable');
      return { ...e, niveau: await niveauSur(tx, id) };
    });
  }

  @Patch('dossiers/:id')
  @ApiOperation({ summary: 'Modifier les caractéristiques d’un dossier, dont le territoire fiscal (gestionnaires)' })
  @ApiBody({ schema: schemaOpenApi(dossier.partial()) })
  async modifierDossier(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(dossier.partial().refine((x) => Object.keys(x).length > 0, 'aucune modification'), corps);
    if (d.siren && !validerSiren(d.siren).valide) throw new BadRequestException('SIREN invalide (clé de contrôle)');
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [avant] = await tx.select().from(s.entites).where(eq(s.entites.id, id));
      if (!avant) throw new NotFoundException('Dossier introuvable');
      const [e] = await tx.update(s.entites).set(d).where(eq(s.entites.id, id)).returning();
      // Changer de territoire change les règles applicables : les contrôles déjà exécutés sont à relancer.
      if (d.territoireFiscal && d.territoireFiscal !== avant.territoireFiscal) {
        await tx.execute(sql`update executions_controles set obsolete = true where entite_id = ${id}::uuid`);
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'dossier.modifie', cibleType: 'entite', cibleId: id, entiteId: id, details: { champs: Object.keys(d), territoireAvant: avant.territoireFiscal, territoireApres: e!.territoireFiscal } });
      return e;
    });
  }

  @Post('dossiers/:id/exercices')
  @ApiOperation({ summary: 'Ouvrir un exercice sur un dossier (collaborateur habilité)' })
  @ApiBody({ schema: schemaOpenApi(exercice) })
  async creerExercice(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(exercice, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'collaboration');
      const chevauche = await tx.execute(sql`select 1 from exercices where entite_id = ${id}::uuid and debut <= ${d.fin}::date and fin >= ${d.debut}::date limit 1`);
      if (chevauche.rows.length) throw new ConflictException('Cet exercice chevauche un exercice existant du dossier');
      const [ex] = await tx.insert(s.exercices).values({ cabinetId: acces.cabinetId, entiteId: id, debut: d.debut, fin: d.fin }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'exercice.cree', cibleType: 'exercice', cibleId: ex!.id, entiteId: id, details: d });
      return ex;
    });
  }

  @Get('dossiers/:id/membres')
  @ApiOperation({ summary: 'Personnes habilitées sur un dossier (visible dès l’habilitation de lecture, et par les gestionnaires)' })
  async membres(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx.select({ id: s.entites.id }).from(s.entites).where(eq(s.entites.id, id));
      if (!e) throw new NotFoundException('Dossier introuvable');
      const niveau = await niveauSur(tx, id);
      const gestionnaire = (await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok;
      if (!gestionnaire && (!niveau || niveau === 'depot')) throw new ForbiddenException('Habilitation insuffisante sur ce dossier');
      const r = await tx.execute(sql`select utilisateur_id as "utilisateurId", nom, email, niveau, role from dossier_membres(${id}::uuid)`);
      return r.rows;
    });
  }

  @Put('dossiers/:id/habilitations/:utilisateurId')
  @ApiOperation({
    summary: 'Accorder ou modifier l’habilitation d’un membre du cabinet sur un dossier (gestionnaires)',
    description: 'Le niveau est plafonné par le rôle : un client ne peut recevoir ni révision ni validation. Toute attribution est journalisée, y compris celle qu’un gestionnaire s’accorde.',
  })
  @ApiBody({ schema: schemaOpenApi(habilitation) })
  async habiliter(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('utilisateurId') utilisateurId: string, @Body() corps: unknown) {
    exigerUuid(id);
    exigerUuid(utilisateurId);
    const d = valider(habilitation, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [e] = await tx.select({ id: s.entites.id }).from(s.entites).where(eq(s.entites.id, id));
      if (!e) throw new NotFoundException('Dossier introuvable');
      const [membre] = await tx.select().from(s.appartenances).where(and(eq(s.appartenances.cabinetId, acces.cabinetId), eq(s.appartenances.utilisateurId, utilisateurId), eq(s.appartenances.actif, true)));
      if (!membre) throw new NotFoundException('Cette personne n’est pas membre actif du cabinet');
      if (!PLAFOND[membre.role]?.includes(d.niveau)) throw new BadRequestException(`Le rôle « ${membre.role} » ne peut pas recevoir le niveau « ${d.niveau} »`);
      const [h] = await tx
        .insert(s.habilitationsDossier)
        .values({ cabinetId: acces.cabinetId, entiteId: id, utilisateurId, niveau: d.niveau, accordeePar: acces.utilisateurId })
        .onConflictDoUpdate({ target: [s.habilitationsDossier.entiteId, s.habilitationsDossier.utilisateurId], set: { niveau: d.niveau, accordeePar: acces.utilisateurId } })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'habilitation.accordee', cibleType: 'utilisateur', cibleId: utilisateurId, entiteId: id, details: { niveau: d.niveau, pourSoiMeme: utilisateurId === acces.utilisateurId } });
      return h;
    });
  }

  @Delete('dossiers/:id/habilitations/:utilisateurId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer une habilitation sur un dossier (gestionnaires)' })
  async retirer(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('utilisateurId') utilisateurId: string) {
    exigerUuid(id);
    exigerUuid(utilisateurId);
    await this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const supprimees = await tx.delete(s.habilitationsDossier).where(and(eq(s.habilitationsDossier.entiteId, id), eq(s.habilitationsDossier.utilisateurId, utilisateurId))).returning();
      if (!supprimees.length) throw new NotFoundException('Habilitation introuvable');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'habilitation.retiree', cibleType: 'utilisateur', cibleId: utilisateurId, entiteId: id });
    });
  }
}
