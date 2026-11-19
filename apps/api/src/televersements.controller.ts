import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, and, desc, eq, journaliser, schema as s, sql } from '@comtaple/db';
import { assurerFichierOriginal, cles, type Config, enregistrerReception, type Files, type Stockage } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { exigerServiceOuvert } from './abonnement.controller.js';
import { BD, CONFIG, STOCKAGE, TACHES } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const ouverture = z.object({
  entiteId: uuid,
  nomFichier: z.string().min(1).max(255),
  taille: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'empreinte SHA-256 hexadécimale attendue'),
  typeMime: z.string().max(100).optional(),
  canal: z.enum(['telephone', 'ordinateur']),
  usage: z.enum(['piece', 'fec', 'banque']).default('piece'),
  /** Relevé CSV : profil de colonnes confirmé par l'utilisateur (facultatif ; sinon proposition prudente du moteur). */
  profilCsv: z.record(z.string(), z.unknown()).optional(),
  nature: z.enum(s.natureDocument.enumValues).default('a_qualifier'),
  commentaire: z.string().max(2000).optional(),
  exerciceId: uuid.optional(),
  statutDonnees: z.enum(s.statutDonnees.enumValues).optional(),
});

function vue(t: typeof s.televersements.$inferSelect, tailleMorceau: number) {
  return {
    id: t.id,
    statut: t.statut,
    octetsRecus: t.octetsRecus,
    tailleAttendue: t.tailleAttendue,
    tailleMorceau,
    documentId: t.documentId,
    lotImportId: t.lotImportId,
    expireLe: t.expireLe,
  };
}

@ApiTags('Téléversements')
@ApiBearerAuth()
@Controller('v1/televersements')
export class TeleversementsController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    @Inject(TACHES) private readonly taches: Files,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Ouvre (ou reprend) un téléversement reprenable',
    description:
      'Le client annonce la taille et l’empreinte SHA-256 du fichier. Si un téléversement identique est déjà ouvert pour ce déposant, il est renvoyé avec le nombre d’octets déjà reçus : le client reprend à cet endroit.',
  })
  @ApiBody({ schema: schemaOpenApi(ouverture) })
  async ouvrir(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(ouverture, corps);
    const max = d.usage === 'fec' ? this.cfg.TAILLE_MAX_FEC : this.cfg.TAILLE_MAX_PIECE;
    if (d.taille > max) throw new PayloadTooLargeException(`Fichier trop volumineux (maximum ${max} octets)`);
    if (d.usage === 'fec' && (!d.exerciceId || !d.statutDonnees)) {
      throw new BadRequestException('exerciceId et statutDonnees sont requis pour un import comptable');
    }
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, d.entiteId, d.usage === 'piece' ? 'depot' : 'collaboration');
      await exigerServiceOuvert(tx);
      if (d.exerciceId) {
        const [ex] = await tx.select().from(s.exercices).where(and(eq(s.exercices.id, d.exerciceId), eq(s.exercices.entiteId, d.entiteId)));
        if (!ex) throw new NotFoundException('Exercice introuvable pour ce dossier');
      }
      const [existant] = await tx
        .select()
        .from(s.televersements)
        .where(
          and(
            eq(s.televersements.entiteId, d.entiteId),
            eq(s.televersements.utilisateurId, acces.utilisateurId),
            eq(s.televersements.sha256Attendu, d.sha256),
            eq(s.televersements.usage, d.usage),
            eq(s.televersements.statut, 'ouvert'),
            sql`${s.televersements.expireLe} > now()`,
          ),
        )
        .orderBy(desc(s.televersements.creeLe));
      if (existant && existant.tailleAttendue === d.taille) return vue(existant, this.cfg.TAILLE_MORCEAU);

      const [cree] = await tx
        .insert(s.televersements)
        .values({
          cabinetId: acces.cabinetId,
          entiteId: d.entiteId,
          utilisateurId: acces.utilisateurId,
          canal: d.canal,
          nomFichier: d.nomFichier,
          typeMimeDeclare: d.typeMime ?? null,
          tailleAttendue: d.taille,
          sha256Attendu: d.sha256,
          nature: d.nature,
          commentaire: d.commentaire ?? null,
          usage: d.usage,
          parametres: d.profilCsv ? { profilCsv: d.profilCsv } : null,
          exerciceId: d.exerciceId ?? null,
          statutDonnees: d.statutDonnees ?? null,
          expireLe: sql`now() + interval '7 days'`,
        })
        .returning();
      return vue(cree!, this.cfg.TAILLE_MORCEAU);
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'État d’un téléversement (octets confirmés par le serveur)' })
  async etat(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const t = await this.bd.avecContexte(acces, (tx) => this.charger(tx, acces, id));
    return vue(t, this.cfg.TAILLE_MORCEAU);
  }

  @Put(':id/morceaux')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Envoie un morceau (application/octet-stream) à partir du décalage indiqué',
    description:
      'Le décalage doit être égal au nombre d’octets déjà confirmés. Un morceau déjà reçu est accepté sans effet (rejeu sûr). En cas de désaccord, 409 avec le décalage attendu.',
  })
  async morceau(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('decalage') decalageBrut: string, @Req() req: { body: unknown }) {
    exigerUuid(id);
    const decalage = Number(decalageBrut);
    if (!Number.isSafeInteger(decalage) || decalage < 0) throw new BadRequestException('decalage invalide');
    const corps = req.body;
    if (!Buffer.isBuffer(corps) || corps.length === 0) throw new BadRequestException('Corps binaire attendu (application/octet-stream)');
    if (corps.length > this.cfg.TAILLE_MORCEAU) throw new PayloadTooLargeException('Morceau trop volumineux');

    return this.bd.avecContexte(acces, async (tx) => {
      const t = await this.charger(tx, acces, id, true);
      if (t.statut !== 'ouvert') throw new ConflictException({ message: 'Téléversement clos', statut: t.statut });
      if (decalage + corps.length <= t.octetsRecus) return vue(t, this.cfg.TAILLE_MORCEAU); // rejeu d'un morceau déjà confirmé
      if (decalage !== t.octetsRecus) {
        throw new ConflictException({ message: 'Décalage inattendu', octetsRecus: t.octetsRecus });
      }
      if (decalage + corps.length > t.tailleAttendue) throw new BadRequestException('Dépassement de la taille annoncée');
      await this.stockage.deposer(cles.morceau(acces.cabinetId, t.id, decalage), corps);
      const [maj] = await tx
        .update(s.televersements)
        .set({ octetsRecus: decalage + corps.length })
        .where(eq(s.televersements.id, t.id))
        .returning();
      return vue(maj!, this.cfg.TAILLE_MORCEAU);
    });
  }

  @Post(':id/terminer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Clôt le téléversement : le serveur vérifie taille et empreinte avant de confirmer la réception',
    description:
      'Le statut « reçu » n’existe qu’après cette vérification. Un binaire déjà présent dans le dossier donne une nouvelle occurrence de réception (doublon binaire) sans nouveau document.',
  })
  async terminer(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const resultat = await this.bd.avecContexte(acces, async (tx) => {
      const t = await this.charger(tx, acces, id, true);
      if (t.statut === 'complet') {
        // Clôture rejouée (réponse perdue) : on restitue l'information de doublon de la réception d'origine.
        const [reception] = t.documentId
          ? await tx
              .select({ doublon: s.receptions.doublonBinaire })
              .from(s.receptions)
              .where(and(eq(s.receptions.documentId, t.documentId), sql`${s.receptions.provenance}->>'televersementId' = ${t.id}`))
          : [];
        return { t, nouveau: false as const, doublonBinaire: reception?.doublon ?? false };
      }
      if (t.statut !== 'ouvert') throw new ConflictException({ message: 'Téléversement clos', statut: t.statut });
      if (t.octetsRecus !== t.tailleAttendue) {
        throw new ConflictException({ message: 'Téléversement incomplet', octetsRecus: t.octetsRecus, tailleAttendue: t.tailleAttendue });
      }
      const prefixe = cles.prefixeMorceaux(acces.cabinetId, t.id);
      const morceaux = await this.stockage.lister(prefixe);
      const cleTemp = cles.assemblage(acces.cabinetId, t.id);
      const { taille, sha256 } = await this.stockage.assembler(morceaux, cleTemp, t.typeMimeDeclare ?? undefined);
      if (taille !== t.tailleAttendue || sha256 !== t.sha256Attendu) {
        await this.stockage.supprimer([...morceaux, cleTemp]);
        await tx.update(s.televersements).set({ statut: 'refuse' }).where(eq(s.televersements.id, t.id));
        await journaliser(tx, {
          cabinetId: acces.cabinetId,
          acteurId: acces.utilisateurId,
          action: 'televersement.refuse',
          cibleType: 'televersement',
          cibleId: t.id,
          entiteId: t.entiteId,
          details: { motif: 'empreinte_ou_taille_differente' },
        });
        return { t, refuse: true as const };
      }
      const cleFinale = cles.original(acces.cabinetId, sha256);
      if (!(await this.stockage.existe(cleFinale))) {
        await this.stockage.deposerFlux(cleFinale, await this.stockage.lireFlux(cleTemp), t.typeMimeDeclare ?? undefined);
      }
      await this.stockage.supprimer([...morceaux, cleTemp]);

      const fichier = await assurerFichierOriginal(tx, { cabinetId: acces.cabinetId, sha256, taille, typeMimeDeclare: t.typeMimeDeclare, cleStockage: cleFinale });

      if (t.usage === 'fec') {
        const cle = `fec:${t.exerciceId}:${sha256}`;
        let [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.cleIdempotence, cle));
        let cree = false;
        if (!lot) {
          const [{ max } = { max: 0 }] = (
            await tx.execute(sql`select coalesce(max(version), 0)::int as max from lots_import where exercice_id = ${t.exerciceId}::uuid and type = 'fec'`)
          ).rows as Array<{ max: number }>;
          [lot] = await tx
            .insert(s.lotsImport)
            .values({
              cabinetId: acces.cabinetId,
              entiteId: t.entiteId,
              exerciceId: t.exerciceId,
              type: 'fec',
              statutDonnees: t.statutDonnees,
              fichierId: fichier.id,
              cleIdempotence: cle,
              version: max + 1,
              actif: false,
              lancePar: acces.utilisateurId,
              rapport: { nomFichier: t.nomFichier },
            })
            .returning();
          cree = true;
        }
        const [maj] = await tx.update(s.televersements).set({ statut: 'complet', lotImportId: lot!.id }).where(eq(s.televersements.id, t.id)).returning();
        await journaliser(tx, {
          cabinetId: acces.cabinetId,
          acteurId: acces.utilisateurId,
          action: cree ? 'import.fec.recu' : 'import.fec.deja_importe',
          cibleType: 'lot_import',
          cibleId: lot!.id,
          entiteId: t.entiteId,
          details: { sha256, taille, version: lot!.version },
        });
        return { t: maj!, nouveau: cree, lotImportId: lot!.id };
      }

      if (t.usage === 'banque') {
        // Relevé bancaire : un même fichier réimporté dans le même dossier renvoie le lot existant (idempotence).
        const cle = `banque:${t.entiteId}:${sha256}`;
        let [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.cleIdempotence, cle));
        let cree = false;
        if (!lot) {
          [lot] = await tx
            .insert(s.lotsImport)
            .values({
              cabinetId: acces.cabinetId,
              entiteId: t.entiteId,
              type: 'releve_bancaire',
              fichierId: fichier.id,
              cleIdempotence: cle,
              actif: false,
              lancePar: acces.utilisateurId,
              rapport: { nomFichier: t.nomFichier, ...((t.parametres as Record<string, unknown> | null) ?? {}) },
            })
            .returning();
          cree = true;
        }
        const [maj] = await tx.update(s.televersements).set({ statut: 'complet', lotImportId: lot!.id }).where(eq(s.televersements.id, t.id)).returning();
        await journaliser(tx, {
          cabinetId: acces.cabinetId,
          acteurId: acces.utilisateurId,
          action: cree ? 'import.releve.recu' : 'import.releve.deja_importe',
          cibleType: 'lot_import',
          cibleId: lot!.id,
          entiteId: t.entiteId,
          details: { sha256, taille },
        });
        return { t: maj!, nouveau: cree, lotImportId: lot!.id, banque: true as const };
      }

      // Pièce : doublon binaire dans le même dossier → nouvelle occurrence de réception, pas de nouveau document
      // (logique commune à tous les canaux, voir `enregistrerReception`).
      const r = await enregistrerReception(tx, {
        cabinetId: acces.cabinetId,
        entiteId: t.entiteId,
        fichier,
        nomFichier: t.nomFichier,
        nature: t.nature,
        commentaire: t.commentaire,
        canal: t.canal,
        deposantId: acces.utilisateurId,
        provenance: { televersementId: t.id, nomFichier: t.nomFichier, sha256 },
      });
      const [maj] = await tx.update(s.televersements).set({ statut: 'complet', documentId: r.documentId }).where(eq(s.televersements.id, t.id)).returning();
      return { t: maj!, nouveau: r.nouveau, documentId: r.documentId, doublonBinaire: r.doublonBinaire, statutDocument: r.statutDocument };
    });

    if ('refuse' in resultat) {
      throw new UnprocessableEntityException('Le fichier reçu ne correspond pas à l’empreinte annoncée : dépôt refusé, à recommencer.');
    }
    // Mise en file après validation de la transaction ; un balayage périodique du worker rattrape une mise en file manquée.
    if (resultat.nouveau && 'documentId' in resultat && resultat.documentId) {
      await this.taches.analyserDocument({ cabinetId: acces.cabinetId, documentId: resultat.documentId }).catch(() => undefined);
    }
    if (resultat.nouveau && 'lotImportId' in resultat && resultat.lotImportId) {
      if ('banque' in resultat) await this.taches.importerReleve({ cabinetId: acces.cabinetId, lotImportId: resultat.lotImportId }).catch(() => undefined);
      else await this.taches.importerFec({ cabinetId: acces.cabinetId, lotImportId: resultat.lotImportId }).catch(() => undefined);
    }
    return {
      ...vue(resultat.t, this.cfg.TAILLE_MORCEAU),
      recu: true,
      doublonBinaire: 'doublonBinaire' in resultat ? resultat.doublonBinaire : false,
      dejaImporte: 'lotImportId' in resultat ? !resultat.nouveau : false,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Abandonner un téléversement non terminé : les morceaux déjà reçus sont supprimés' })
  async abandonner(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    await this.bd.avecContexte(acces, async (tx) => {
      const t = await this.charger(tx, acces, id, true);
      if (t.statut === 'complet') throw new ConflictException('Ce téléversement est terminé : la pièce a été reçue et ne peut pas être retirée ici');
      if (t.statut === 'ouvert') {
        await this.stockage.supprimer(await this.stockage.lister(cles.prefixeMorceaux(acces.cabinetId, t.id)));
        await tx.update(s.televersements).set({ statut: 'abandonne' }).where(eq(s.televersements.id, t.id));
      }
    });
  }

  private async charger(tx: Parameters<Parameters<AccesBd['avecContexte']>[1]>[0], acces: Acces, id: string, verrou = false) {
    const requete = tx.select().from(s.televersements).where(eq(s.televersements.id, id));
    const [t] = verrou ? await requete.for('update') : await requete;
    if (!t) throw new NotFoundException('Téléversement introuvable');
    if (t.utilisateurId !== acces.utilisateurId) throw new ForbiddenException('Ce téléversement appartient à un autre utilisateur');
    return t;
  }
}
