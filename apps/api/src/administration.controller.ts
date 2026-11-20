import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { validerSiren } from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
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
/** Modification : les champs facultatifs peuvent être EFFACÉS (null) ; le référentiel comptable est modifiable. */
const modificationDossier = z
  .object({
    raisonSociale: z.string().min(1).max(200),
    siren: z.string().regex(/^\d{9}$/, 'SIREN à 9 chiffres').nullable(),
    formeJuridique: z.string().max(50).nullable(),
    regimeFiscal: z.string().max(50).nullable(),
    territoireFiscal: z.enum(s.territoireFiscal.enumValues),
    codeNaf: z.string().max(10).nullable(),
    /** Effectif moyen saisi par le cabinet ; null = non renseigné (la veille dit alors « à confirmer »). */
    effectifMoyen: z.number().int().min(0).max(1_000_000).nullable(),
    referentielComptable: z.string().min(1).max(50),
  })
  .partial();
const exercice = z.object({ debut: dateIso, fin: dateIso }).refine((e) => e.debut < e.fin, 'la fin doit suivre le début');
const habilitation = z.object({ niveau: z.enum(s.niveauHabilitation.enumValues) });
const membre = z.object({ role: z.enum(s.roleCabinet.enumValues).optional(), actif: z.boolean().optional() }).refine((m) => m.role !== undefined || m.actif !== undefined, 'aucune modification');

/** Invitation : le rôle « support » ne s'obtient jamais ainsi ; durée de validité bornée. */
const invitation = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  nom: z.string().trim().min(1).max(120),
  role: z.enum(s.roleCabinet.enumValues).refine((r) => r !== 'support', 'le rôle support ne s’obtient pas par invitation'),
  validiteJours: z.number().int().min(1).max(30).optional(),
});

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

  @Patch('cabinet/membres/:utilisateurId')
  @ApiOperation({
    summary: 'Changer le rôle d’un membre ou le désactiver (gestionnaires)',
    description:
      'Garde-fous : on ne modifie pas sa propre appartenance ; le cabinet garde toujours au moins un administrateur actif ; un changement de rôle retire les habilitations de dossier qui dépassent le plafond du nouveau rôle ; une désactivation ferme immédiatement tous les accès et retire, dans la même transaction, les abonnements de la personne aux notifications poussées pour ce cabinet (retrait journalisé ; une réactivation ne les recrée pas : la personne réactive elle-même ses appareils). Pour faire entrer une personne : voir les invitations.',
  })
  @ApiBody({ schema: schemaOpenApi(membre) })
  async modifierMembre(@AccesCourant() acces: Acces, @Param('utilisateurId') utilisateurId: string, @Body() corps: unknown) {
    exigerUuid(utilisateurId);
    const d = valider(membre, corps);
    if (utilisateurId === acces.utilisateurId) throw new ForbiddenException('On ne modifie pas sa propre appartenance');
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [a] = await tx.select().from(s.appartenances).where(and(eq(s.appartenances.cabinetId, acces.cabinetId), eq(s.appartenances.utilisateurId, utilisateurId))).for('update');
      if (!a) throw new NotFoundException('Membre introuvable dans ce cabinet');
      const role = d.role ?? a.role;
      const actif = d.actif ?? a.actif;
      // Le cabinet ne doit jamais se retrouver sans administrateur actif.
      if (a.role === 'administrateur' && a.actif && (role !== 'administrateur' || !actif)) {
        const [{ n } = { n: 0 }] = (
          await tx.execute(sql`select count(*)::int as n from appartenances where cabinet_id = ${acces.cabinetId}::uuid and role = 'administrateur' and actif and utilisateur_id <> ${utilisateurId}::uuid`)
        ).rows as Array<{ n: number }>;
        if (n === 0) throw new ConflictException('Le cabinet doit conserver au moins un administrateur actif');
      }
      const [maj] = await tx.update(s.appartenances).set({ role, actif }).where(eq(s.appartenances.id, a.id)).returning();
      // Habilitations de dossier au-dessus du plafond du nouveau rôle : retirées (et non rabaissées en silence).
      let retirees = 0;
      if (role !== a.role) {
        const admises = PLAFOND[role] ?? [];
        const siennes = await tx.select().from(s.habilitationsDossier).where(eq(s.habilitationsDossier.utilisateurId, utilisateurId));
        for (const h of siennes.filter((x) => !admises.includes(x.niveau))) {
          await tx.delete(s.habilitationsDossier).where(eq(s.habilitationsDossier.id, h.id));
          retirees++;
        }
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'membre.modifie', cibleType: 'utilisateur', cibleId: utilisateurId, details: { roleAvant: a.role, roleApres: role, actifAvant: a.actif, actifApres: actif, habilitationsRetirees: retirees } });
      return { ...maj, habilitationsRetirees: retirees };
    });
  }

  @Get('cabinet/invitations')
  @ApiOperation({ summary: 'Invitations du cabinet (gestionnaires)', description: 'Une invitation dont la date de validité est passée est renvoyée avec « expiree: true » ; elle ne peut plus être acceptée.' })
  async invitations(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const lignes = await tx.select().from(s.invitations).where(eq(s.invitations.cabinetId, acces.cabinetId)).orderBy(desc(s.invitations.creeLe)).limit(200);
      return lignes.map((i) => ({ id: i.id, email: i.email, nom: i.nom, role: i.role, statut: i.statut, expireLe: i.expireLe, expiree: i.statut === 'en_attente' && new Date(i.expireLe).getTime() <= Date.now(), accepteeLe: i.accepteeLe, creeLe: i.creeLe }));
    });
  }

  @Post('cabinet/invitations')
  @ApiOperation({
    summary: 'Inviter une personne à rejoindre le cabinet (gestionnaires)',
    description:
      'L’application n’envoie AUCUN courriel : l’invitation autorise l’entrée du compte dont le fournisseur d’identité atteste cette adresse, à sa première connexion. Le compte lui-même est créé dans le fournisseur d’identité (Keycloak ou SSO du cabinet). Aucune habilitation de dossier n’est accordée par l’invitation. Seul un administrateur peut inviter un administrateur.',
  })
  @ApiBody({ schema: schemaOpenApi(invitation) })
  async inviter(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(invitation, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      if (d.role === 'administrateur' && acces.role !== 'administrateur') throw new ForbiddenException('Seul un administrateur peut inviter un administrateur');
      const [dejaMembre] = await tx
        .select({ id: s.utilisateurs.id })
        .from(s.appartenances)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.appartenances.utilisateurId))
        .where(and(eq(s.appartenances.cabinetId, acces.cabinetId), sql`lower(${s.utilisateurs.email}) = ${d.email}`));
      if (dejaMembre) throw new ConflictException('Cette adresse est déjà celle d’un membre du cabinet');
      // Une invitation en attente mais périmée est annulée pour laisser place à la nouvelle.
      await tx.update(s.invitations).set({ statut: 'annulee' }).where(and(eq(s.invitations.cabinetId, acces.cabinetId), eq(s.invitations.email, d.email), eq(s.invitations.statut, 'en_attente'), sql`${s.invitations.expireLe} <= now()`));
      const [enAttente] = await tx.select({ id: s.invitations.id }).from(s.invitations).where(and(eq(s.invitations.cabinetId, acces.cabinetId), eq(s.invitations.email, d.email), eq(s.invitations.statut, 'en_attente')));
      if (enAttente) throw new ConflictException('Une invitation est déjà en attente pour cette adresse');
      const [cree] = await tx
        .insert(s.invitations)
        .values({ cabinetId: acces.cabinetId, email: d.email, nom: d.nom, role: d.role, inviteePar: acces.utilisateurId, expireLe: sql`now() + make_interval(days => ${d.validiteJours ?? 14})` })
        .returning();
      if (!cree) throw new ConflictException('Invitation non créée');
      // Le journal ne reçoit pas l'adresse : l'identifiant de l'invitation suffit à la retrouver.
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'invitation.creee', cibleType: 'invitation', cibleId: cree.id, details: { role: d.role } });
      return { id: cree.id, email: cree.email, nom: cree.nom, role: cree.role, statut: cree.statut, expireLe: cree.expireLe, courrielEnvoye: false };
    });
  }

  @Delete('cabinet/invitations/:id')
  @ApiOperation({ summary: 'Annuler une invitation en attente (gestionnaires)', description: 'L’invitation est conservée avec le statut « annulee ».' })
  async annulerInvitation(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [maj] = await tx.update(s.invitations).set({ statut: 'annulee' }).where(and(eq(s.invitations.id, id), eq(s.invitations.cabinetId, acces.cabinetId), eq(s.invitations.statut, 'en_attente'))).returning({ id: s.invitations.id });
      if (!maj) throw new NotFoundException('Invitation en attente introuvable');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'invitation.annulee', cibleType: 'invitation', cibleId: id });
      return { id, statut: 'annulee' };
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
  @ApiBody({ schema: schemaOpenApi(modificationDossier) })
  async modifierDossier(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(modificationDossier.refine((x) => Object.keys(x).length > 0, 'aucune modification'), corps);
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
      // Deux créations simultanées sur le même dossier se suivent (sinon les deux passent le contrôle de chevauchement).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exercice:${id}`}, 0))`);
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
