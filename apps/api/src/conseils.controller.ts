import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, asc, desc, eq, inArray, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const conseil = z.object({
  dateConseil: dateIso,
  objet: z.string().min(1).max(300),
  contenu: z.string().min(1).max(20_000),
  destinataire: z.string().min(1).max(300),
  missionId: uuid.optional(),
  pieces: z.array(uuid).max(50).default([]),
});
const evenement = z.object({
  type: z.enum(['envoi', 'remise', 'reception', 'lecture']),
  dateEvenement: z.string().datetime({ offset: true }),
  canal: z.string().min(1).max(100),
  /** Ce qui établit le fait (ex. « accusé de réception n° … », « remis en main propre contre signature »). */
  justificatif: z.string().min(5).max(1000),
  justificatifDocumentId: uuid.optional(),
});

@ApiTags('Registre des conseils')
@ApiBearerAuth()
@Controller('v1')
export class ConseilsController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  private async verifierPieces(tx: Tx, entiteId: string, pieces: string[]): Promise<void> {
    if (!pieces.length) return;
    const trouvees = await tx.select({ id: s.documents.id, entiteId: s.documents.entiteId }).from(s.documents).where(inArray(s.documents.id, pieces));
    if (trouvees.length !== new Set(pieces).size || trouvees.some((p) => p.entiteId !== entiteId)) throw new BadRequestException('Une pièce jointe n’appartient pas à ce dossier');
  }

  @Post('dossiers/:id/conseils')
  @ApiOperation({ summary: 'Rédiger un conseil (projet)', description: 'Le logiciel n’envoie rien : il trace la rédaction, la validation, l’autorisation d’envoi et les faits constatés ensuite.' })
  @ApiBody({ schema: schemaOpenApi(conseil) })
  async creer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(conseil, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'collaboration');
      await this.verifierPieces(tx, id, d.pieces);
      const [c] = await tx
        .insert(s.conseils)
        .values({ cabinetId: acces.cabinetId, entiteId: id, missionId: d.missionId ?? null, dateConseil: d.dateConseil, auteurId: acces.utilisateurId, objet: d.objet, contenu: d.contenu, destinataire: d.destinataire, pieces: d.pieces })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'conseil.redige', cibleType: 'conseil', cibleId: c!.id, entiteId: id });
      return c;
    });
  }

  @Get('dossiers/:id/conseils')
  @ApiOperation({ summary: 'Registre des conseils d’un dossier : date, auteur, objet, destinataire, statut, événements constatés' })
  async registre(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const liste = await tx
        .select({ conseil: s.conseils, auteur: s.utilisateurs.nom })
        .from(s.conseils)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.conseils.auteurId))
        .where(eq(s.conseils.entiteId, id))
        .orderBy(desc(s.conseils.dateConseil), desc(s.conseils.creeLe));
      const evenements = await tx.select().from(s.evenementsConseil).where(eq(s.evenementsConseil.entiteId, id)).orderBy(asc(s.evenementsConseil.dateEvenement));
      const idsPieces = [...new Set([...liste.flatMap(({ conseil: c }) => c.pieces as string[]), ...evenements.map((e) => e.justificatifDocumentId).filter((x): x is string => Boolean(x))])];
      const docs = idsPieces.length ? await tx.select({ id: s.documents.id, nomOrigine: s.documents.nomOrigine, statut: s.documents.statut, version: s.documents.version }).from(s.documents).where(inArray(s.documents.id, idsPieces)) : [];
      const parId = new Map(docs.map((d) => [d.id, d]));
      return liste.map(({ conseil: c, auteur }) => {
        const siens = evenements.filter((e) => e.conseilId === c.id);
        const fait = (type: string) => siens.find((e) => e.type === type)?.dateEvenement ?? null;
        // Quatre faits distincts : l'absence d'un événement signifie « non établi », jamais « n'a pas eu lieu ».
        return { ...c, auteur, piecesJointes: (c.pieces as string[]).map((p) => parId.get(p) ?? { id: p, nomOrigine: null, statut: null, version: null }), faits: { envoi: fait('envoi'), remise: fait('remise'), reception: fait('reception'), lecture: fait('lecture') }, evenements: siens.map((e) => ({ ...e, justificatifDocument: e.justificatifDocumentId ? (parId.get(e.justificatifDocumentId) ?? null) : null })) };
      });
    });
  }

  private async charger(tx: Tx, id: string) {
    const [c] = await tx.select().from(s.conseils).where(eq(s.conseils.id, id)).for('update');
    if (!c) throw new NotFoundException('Conseil introuvable');
    return c;
  }

  @Put('conseils/:id')
  @ApiOperation({ summary: 'Modifier un conseil tant qu’il est un projet ; un conseil validé ne se modifie plus (nouvelle version)' })
  @ApiBody({ schema: schemaOpenApi(conseil) })
  async modifier(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(conseil, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.charger(tx, id);
      await exigerNiveau(tx, c.entiteId, 'collaboration');
      if (c.statut !== 'projet') throw new ConflictException('Un conseil validé ne se modifie plus : créez une nouvelle version');
      await this.verifierPieces(tx, c.entiteId, d.pieces);
      const [maj] = await tx.update(s.conseils).set({ dateConseil: d.dateConseil, objet: d.objet, contenu: d.contenu, destinataire: d.destinataire, missionId: d.missionId ?? null, pieces: d.pieces }).where(eq(s.conseils.id, id)).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'conseil.modifie', cibleType: 'conseil', cibleId: id, entiteId: c.entiteId });
      return maj;
    });
  }

  @Post('conseils/:id/nouvelle-version')
  @ApiOperation({ summary: 'Créer une nouvelle version (projet) d’un conseil validé ; l’ancienne reste au registre' })
  async nouvelleVersion(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.charger(tx, id);
      await exigerNiveau(tx, c.entiteId, 'collaboration');
      if (c.statut === 'projet') throw new ConflictException('Ce conseil est encore un projet : modifiez-le directement');
      const [n] = await tx
        .insert(s.conseils)
        .values({ cabinetId: c.cabinetId, entiteId: c.entiteId, missionId: c.missionId, dateConseil: c.dateConseil, auteurId: acces.utilisateurId, objet: c.objet, contenu: c.contenu, destinataire: c.destinataire, pieces: c.pieces, version: c.version + 1, remplaceConseilId: c.id })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'conseil.nouvelle_version', cibleType: 'conseil', cibleId: n!.id, entiteId: c.entiteId, details: { remplace: c.id, version: n!.version } });
      return n;
    });
  }

  @Post('conseils/:id/validation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valider un conseil (habilitation de validation). La validation n’autorise pas encore l’envoi.' })
  async validerConseil(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.charger(tx, id);
      await exigerNiveau(tx, c.entiteId, 'validation');
      if (c.statut !== 'projet') throw new ConflictException(`Conseil au statut « ${c.statut} »`);
      const [maj] = await tx.update(s.conseils).set({ statut: 'valide', validePar: acces.utilisateurId, valideLe: sql`now()` }).where(eq(s.conseils.id, id)).returning();
      if (c.remplaceConseilId) await tx.update(s.conseils).set({ statut: 'remplace' }).where(eq(s.conseils.id, c.remplaceConseilId));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'conseil.valide', cibleType: 'conseil', cibleId: id, entiteId: c.entiteId, details: { version: c.version } });
      return maj;
    });
  }

  @Post('conseils/:id/autorisation-envoi')
  @HttpCode(200)
  @ApiOperation({ summary: 'Autoriser l’envoi d’un conseil validé (habilitation de validation) — étape distincte de la validation' })
  async autoriser(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.charger(tx, id);
      await exigerNiveau(tx, c.entiteId, 'validation');
      if (c.statut !== 'valide') throw new ConflictException(c.statut === 'projet' ? 'Un projet ne peut pas être envoyé : il doit d’abord être validé' : `Conseil au statut « ${c.statut} »`);
      const [maj] = await tx.update(s.conseils).set({ statut: 'envoi_autorise', envoiAutorisePar: acces.utilisateurId, envoiAutoriseLe: sql`now()` }).where(eq(s.conseils.id, id)).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'conseil.envoi_autorise', cibleType: 'conseil', cibleId: id, entiteId: c.entiteId });
      return maj;
    });
  }

  @Post('conseils/:id/evenements')
  @ApiOperation({
    summary: 'Consigner un fait établi : envoi, remise, réception ou lecture, avec son justificatif',
    description: 'Un envoi n’est consignable qu’après autorisation. Remise, réception et lecture supposent un envoi consigné et ne se déduisent jamais l’une de l’autre. Les événements ne se modifient pas.',
  })
  @ApiBody({ schema: schemaOpenApi(evenement) })
  async consigner(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(evenement, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.charger(tx, id);
      await exigerNiveau(tx, c.entiteId, 'collaboration');
      if (c.statut !== 'envoi_autorise') throw new ConflictException('Aucun événement d’envoi ne peut être consigné sans autorisation d’envoi');
      if (new Date(d.dateEvenement).getTime() > Date.now() + 60_000) throw new BadRequestException('Un fait constaté ne peut pas être daté dans le futur');
      const existants = await tx.select().from(s.evenementsConseil).where(eq(s.evenementsConseil.conseilId, id));
      const envoi = existants.find((e) => e.type === 'envoi');
      if (d.type !== 'envoi') {
        if (!envoi) throw new ConflictException('Consignez d’abord l’envoi');
        if (new Date(d.dateEvenement) < new Date(envoi.dateEvenement)) throw new BadRequestException('Cet événement ne peut pas précéder l’envoi');
      }
      if (d.justificatifDocumentId) await this.verifierPieces(tx, c.entiteId, [d.justificatifDocumentId]);
      const [e] = await tx
        .insert(s.evenementsConseil)
        .values({ cabinetId: acces.cabinetId, entiteId: c.entiteId, conseilId: id, type: d.type, dateEvenement: d.dateEvenement, canal: d.canal, justificatif: d.justificatif, justificatifDocumentId: d.justificatifDocumentId ?? null, saisiPar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `conseil.${d.type}_consigne`, cibleType: 'conseil', cibleId: id, entiteId: c.entiteId, details: { canal: d.canal } });
      return e;
    });
  }
}
