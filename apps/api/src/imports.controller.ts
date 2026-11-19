import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, and, asc, desc, eq, inArray, journaliser, ne, schema as s, sql, type Tx } from '@comtaple/db';
import type { Files } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, auMoins, exigerNiveau, exigerUuid, niveauSur } from './acces.js';
import { BD, TACHES } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const motif = z.object({ motif: z.string().min(5).max(2000) });
const campagne = z.object({ libelle: z.string().min(1).max(200), type: z.enum(['fec', 'releve_bancaire']) });
type Lot = typeof s.lotsImport.$inferSelect;
const TERMINES = ['termine', 'termine_avec_erreurs'] as const;

interface Effet {
  lot: Lot;
  /** Exécution de contrôles à lancer après validation de la transaction, le cas échéant. */
  executionId: string | null;
}

@ApiTags('Imports : annulation, reprise, campagnes')
@ApiBearerAuth()
@Controller('v1')
export class ImportsController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(TACHES) private readonly taches: Files,
  ) {}

  /** Les données comptables actives de l'exercice changent : tout ce qui en dépendait est marqué, rien n'est supprimé. */
  private async donneesComptablesChangees(tx: Tx, acces: Acces, lotActif: Lot | null, exerciceId: string, entiteId: string): Promise<string | null> {
    const [ex] = await tx.update(s.exercices).set({ versionDonnees: sql`${s.exercices.versionDonnees} + 1` }).where(eq(s.exercices.id, exerciceId)).returning();
    await tx.update(s.executionsControles).set({ obsolete: true }).where(eq(s.executionsControles.exerciceId, exerciceId));
    await tx.update(s.executionsRapprochement).set({ obsolete: true }).where(eq(s.executionsRapprochement.exerciceId, exerciceId));
    await tx.update(s.constats).set({ aRevoir: true }).where(and(eq(s.constats.exerciceId, exerciceId), ne(s.constats.statutRevue, 'a_examiner')));
    if (!lotActif || !(lotActif.rapport as { suffisantPourTravaux?: boolean } | null)?.suffisantPourTravaux) return null;
    const [e] = await tx
      .insert(s.executionsControles)
      .values({ cabinetId: acces.cabinetId, entiteId, exerciceId, lotImportId: lotActif.id, versionDonnees: ex!.versionDonnees, lancePar: acces.utilisateurId })
      .returning();
    return e!.id;
  }

  private async annulerLot(tx: Tx, acces: Acces, lot: Lot, motifAnnulation: string): Promise<Effet> {
    if (lot.statut === 'annule') throw new ConflictException('Cet import est déjà annulé');
    const termine = (TERMINES as readonly string[]).includes(lot.statut);
    let executionId: string | null = null;
    const [maj] = await tx
      .update(s.lotsImport)
      .set({ statut: 'annule', actif: false, statutAvantAnnulation: termine ? lot.statut : null, annulePar: acces.utilisateurId, annuleLe: sql`now()`, motifAnnulation })
      .where(eq(s.lotsImport.id, lot.id))
      .returning();
    if (lot.type === 'fec' && termine && lot.actif && lot.exerciceId) {
      // Le lot précédent encore valable redevient la donnée active ; s'il n'y en a pas, l'exercice n'a plus de données actives.
      const [precedent] = await tx
        .select()
        .from(s.lotsImport)
        .where(and(eq(s.lotsImport.exerciceId, lot.exerciceId), eq(s.lotsImport.type, 'fec'), inArray(s.lotsImport.statut, [...TERMINES]), ne(s.lotsImport.id, lot.id)))
        .orderBy(desc(s.lotsImport.version))
        .limit(1);
      if (precedent) await tx.update(s.lotsImport).set({ actif: true }).where(eq(s.lotsImport.id, precedent.id));
      executionId = await this.donneesComptablesChangees(tx, acces, precedent ?? null, lot.exerciceId, lot.entiteId);
    }
    if (lot.type === 'releve_bancaire' && termine) {
      await tx.update(s.executionsRapprochement).set({ obsolete: true }).where(eq(s.executionsRapprochement.entiteId, lot.entiteId));
      await tx.update(s.executionsControles).set({ obsolete: true }).where(eq(s.executionsControles.entiteId, lot.entiteId));
    }
    await tx.insert(s.decisions).values({ cabinetId: acces.cabinetId, entiteId: lot.entiteId, cibleType: 'lot_import', cibleId: lot.id, versionCible: lot.version, action: 'annuler', motif: motifAnnulation, auteurId: acces.utilisateurId });
    await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'import.annule', cibleType: 'lot_import', cibleId: lot.id, entiteId: lot.entiteId, details: { type: lot.type, statutAvant: lot.statut, etaitActif: lot.actif } });
    return { lot: maj!, executionId };
  }

  private async charger(tx: Tx, id: string, minimum: Parameters<typeof exigerNiveau>[2]): Promise<Lot> {
    const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, id)).for('update');
    if (!lot) throw new NotFoundException('Import introuvable');
    await exigerNiveau(tx, lot.entiteId, minimum);
    return lot;
  }

  @Post('imports/:id/annulation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Annuler un import (réviseur habilité, motif requis) — réversible',
    description:
      'Rien n’est supprimé : le fichier original et les données lues sont conservés, seulement écartés. Import comptable actif : le lot précédent redevient actif et les travaux qui dépendaient des données sont marqués obsolètes ou « à revoir ». Relevé bancaire : ses mouvements ne sont plus pris en compte, sauf ceux présents dans un autre relevé actif. Import en attente ou en cours : il est interrompu sans laisser de données partielles.',
  })
  @ApiBody({ schema: schemaOpenApi(motif) })
  async annuler(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(motif, corps);
    const effet = await this.bd.avecContexte(acces, async (tx) => this.annulerLot(tx, acces, await this.charger(tx, id, 'revision'), d.motif));
    if (effet.executionId) await this.taches.executerControles({ cabinetId: acces.cabinetId, executionId: effet.executionId }).catch(() => undefined);
    return effet.lot;
  }

  @Post('imports/:id/retablissement')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rétablir un import annulé (réviseur habilité, motif requis)',
    description: 'Seul un import qui avait abouti peut être rétabli tel quel ; un import annulé avant la fin se relance par « reprise ». Import comptable : il redevient le lot actif de son exercice, à la place de l’actuel.',
  })
  @ApiBody({ schema: schemaOpenApi(motif) })
  async retablir(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(motif, corps);
    const effet = await this.bd.avecContexte(acces, async (tx): Promise<Effet> => {
      const lot = await this.charger(tx, id, 'revision');
      if (lot.statut !== 'annule') throw new ConflictException('Cet import n’est pas annulé');
      if (!lot.statutAvantAnnulation) throw new ConflictException('Cet import avait été annulé avant d’aboutir : utilisez la reprise pour le relancer');
      let executionId: string | null = null;
      if (lot.type === 'fec' && lot.exerciceId) {
        await tx.update(s.lotsImport).set({ actif: false }).where(and(eq(s.lotsImport.exerciceId, lot.exerciceId), eq(s.lotsImport.type, 'fec'), ne(s.lotsImport.id, lot.id)));
      }
      const [maj] = await tx
        .update(s.lotsImport)
        .set({ statut: lot.statutAvantAnnulation as Lot['statut'], actif: true, statutAvantAnnulation: null, annulePar: null, annuleLe: null, motifAnnulation: null })
        .where(eq(s.lotsImport.id, lot.id))
        .returning();
      if (lot.type === 'fec' && lot.exerciceId) executionId = await this.donneesComptablesChangees(tx, acces, maj!, lot.exerciceId, lot.entiteId);
      if (lot.type === 'releve_bancaire') {
        await tx.update(s.executionsRapprochement).set({ obsolete: true }).where(eq(s.executionsRapprochement.entiteId, lot.entiteId));
        await tx.update(s.executionsControles).set({ obsolete: true }).where(eq(s.executionsControles.entiteId, lot.entiteId));
      }
      await tx.insert(s.decisions).values({ cabinetId: acces.cabinetId, entiteId: lot.entiteId, cibleType: 'lot_import', cibleId: lot.id, versionCible: lot.version, action: 'retablir', motif: d.motif, auteurId: acces.utilisateurId });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'import.retabli', cibleType: 'lot_import', cibleId: lot.id, entiteId: lot.entiteId, details: { type: lot.type } });
      return { lot: maj!, executionId };
    });
    if (effet.executionId) await this.taches.executerControles({ cabinetId: acces.cabinetId, executionId: effet.executionId }).catch(() => undefined);
    return effet.lot;
  }

  private async reprendre(tx: Tx, acces: Acces, lot: Lot): Promise<void> {
    const reprenable = lot.statut === 'echec' || (lot.statut === 'annule' && !lot.statutAvantAnnulation);
    if (!reprenable) throw new ConflictException('Seul un import en échec, ou annulé avant d’aboutir, peut être repris');
    await tx.update(s.lotsImport).set({ statut: 'en_attente', progression: 0, termineLe: null, annulePar: null, annuleLe: null, motifAnnulation: null }).where(eq(s.lotsImport.id, lot.id));
    await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'import.repris', cibleType: 'lot_import', cibleId: lot.id, entiteId: lot.entiteId });
  }

  private mettreEnFile(acces: Acces, lot: Pick<Lot, 'id' | 'type'>) {
    return lot.type === 'fec' ? this.taches.importerFec({ cabinetId: acces.cabinetId, lotImportId: lot.id }) : this.taches.importerReleve({ cabinetId: acces.cabinetId, lotImportId: lot.id });
  }

  @Post('imports/:id/reprise')
  @HttpCode(202)
  @ApiOperation({ summary: 'Reprendre un import en échec ou annulé avant d’aboutir (collaborateur habilité)', description: 'Le même fichier original est retraité ; la reprise ne duplique rien.' })
  async reprise(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const lot = await this.bd.avecContexte(acces, async (tx) => {
      const l = await this.charger(tx, id, 'collaboration');
      await this.reprendre(tx, acces, l);
      return l;
    });
    await this.mettreEnFile(acces, lot);
    return { accepte: true };
  }

  // ───────────── Campagnes : un import pour de nombreux dossiers ─────────────

  @Post('campagnes')
  @ApiOperation({
    summary: 'Ouvrir une campagne d’import (plusieurs dossiers)',
    description: 'Chaque fichier est ensuite déposé pour son dossier par le téléversement habituel, avec l’identifiant de la campagne. Chaque dossier est traité isolément.',
  })
  @ApiBody({ schema: schemaOpenApi(campagne) })
  async creerCampagne(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(campagne, corps);
    if (['client_deposant', 'client_lecture', 'support'].includes(acces.role)) throw new ForbiddenException('Réservé aux collaborateurs du cabinet');
    return this.bd.avecContexte(acces, async (tx) => {
      const [c] = await tx.insert(s.campagnesImport).values({ cabinetId: acces.cabinetId, libelle: d.libelle, type: d.type, creePar: acces.utilisateurId }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'campagne.ouverte', cibleType: 'campagne_import', cibleId: c!.id, details: { type: d.type } });
      return c;
    });
  }

  @Get('campagnes')
  @ApiOperation({ summary: 'Campagnes d’import du cabinet' })
  async campagnes(@AccesCourant() acces: Acces) {
    if (['client_deposant', 'client_lecture'].includes(acces.role)) throw new ForbiddenException('Réservé aux membres du cabinet');
    return this.bd.avecContexte(acces, (tx) => tx.select().from(s.campagnesImport).orderBy(desc(s.campagnesImport.creeLe)).limit(200));
  }

  private async campagneVisible(tx: Tx, acces: Acces, id: string) {
    if (['client_deposant', 'client_lecture'].includes(acces.role)) throw new ForbiddenException('Réservé aux membres du cabinet');
    const [c] = await tx.select().from(s.campagnesImport).where(eq(s.campagnesImport.id, id)).for('update');
    if (!c) throw new NotFoundException('Campagne introuvable');
    return c;
  }

  @Get('campagnes/:id')
  @ApiOperation({
    summary: 'Suivi d’une campagne : progression et rapport par dossier',
    description: 'Seuls les dossiers où l’appelant est habilité sont détaillés ; « dossiersHorsHabilitation » compte les autres, sans rien en révéler.',
  })
  async campagneDetail(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.campagneVisible(tx, acces, id);
      const lots = await tx
        .select({ lot: s.lotsImport, raisonSociale: s.entites.raisonSociale })
        .from(s.lotsImport)
        .innerJoin(s.entites, eq(s.entites.id, s.lotsImport.entiteId))
        .where(eq(s.lotsImport.campagneId, id))
        .orderBy(asc(s.entites.raisonSociale), asc(s.lotsImport.creeLe));
      const totalDossiers = Number((await tx.execute(sql`select campagne_nb_dossiers(${id}::uuid) as n`)).rows[0]?.n ?? 0);
      const dossiersVisibles = new Set(lots.map(({ lot }) => lot.entiteId)).size;
      const parStatut: Record<string, number> = {};
      for (const { lot } of lots) parStatut[lot.statut] = (parStatut[lot.statut] ?? 0) + 1;
      return {
        campagne: c,
        dossiersHorsHabilitation: Math.max(0, totalDossiers - dossiersVisibles),
        synthese: { lots: lots.length, parStatut, enCours: (parStatut.en_attente ?? 0) + (parStatut.en_cours ?? 0) },
        elements: lots.map(({ lot, raisonSociale }) => {
          const r = (lot.rapport ?? {}) as Record<string, unknown>;
          return {
            lotImportId: lot.id,
            entiteId: lot.entiteId,
            raisonSociale,
            exerciceId: lot.exerciceId,
            statut: lot.statut,
            actif: lot.actif,
            progression: lot.progression,
            // Rapport par dossier, sans le détail ligne par ligne (disponible sur l'import lui-même).
            rapport: { nomFichier: r.nomFichier ?? null, lisible: r.lisible ?? null, conforme: r.conforme ?? null, suffisantPourTravaux: r.suffisantPourTravaux ?? null, motif: r.motif ?? r.erreurTechnique ?? null, nbAnomaliesParCode: r.nbAnomaliesParCode ?? null, nbMouvements: r.nbMouvements ?? null },
          };
        }),
      };
    });
  }

  @Post('campagnes/:id/cloture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clore une campagne : elle n’accepte plus de fichiers (ses imports restent en place)' })
  async clore(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const c = await this.campagneVisible(tx, acces, id);
      if (c.statut !== 'ouverte') throw new ConflictException(`Campagne au statut « ${c.statut} »`);
      const [maj] = await tx.update(s.campagnesImport).set({ statut: 'close' }).where(eq(s.campagnesImport.id, id)).returning();
      return maj;
    });
  }

  @Post('campagnes/:id/reprise-echecs')
  @HttpCode(202)
  @ApiOperation({ summary: 'Reprendre tous les imports en échec de la campagne (dossiers où l’appelant est habilité en collaboration)' })
  async reprendreEchecs(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const repris = await this.bd.avecContexte(acces, async (tx) => {
      await this.campagneVisible(tx, acces, id);
      const lots = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.campagneId, id), eq(s.lotsImport.statut, 'echec'))).for('update');
      const faits: Lot[] = [];
      for (const lot of lots) {
        const n = await niveauSur(tx, lot.entiteId);
        if (!n || !auMoins(n, 'collaboration')) continue;
        await this.reprendre(tx, acces, lot);
        faits.push(lot);
      }
      return faits;
    });
    // Une tâche par dossier : chaque import est traité, réussit ou échoue indépendamment des autres.
    for (const lot of repris) await this.mettreEnFile(acces, lot);
    return { repris: repris.length };
  }

  @Post('campagnes/:id/annulation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Annuler une campagne : chacun de ses imports est annulé (réversible, dossier par dossier)',
    description: 'N’annule que les imports des dossiers où l’appelant est habilité en révision ; les autres sont laissés en place et comptés. Chaque import reste rétablissable individuellement.',
  })
  @ApiBody({ schema: schemaOpenApi(motif) })
  async annulerCampagne(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(motif, corps);
    const { annules, laisses, horsHabilitation, executions } = await this.bd.avecContexte(acces, async (tx) => {
      const c = await this.campagneVisible(tx, acces, id);
      if (c.statut === 'annulee') throw new ConflictException('Campagne déjà annulée');
      const lots = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.campagneId, id), ne(s.lotsImport.statut, 'annule'))).for('update');
      const dejaAnnules = Number((await tx.execute(sql`select count(*)::int as n from lots_import where campagne_id = ${id}::uuid and statut = 'annule'`)).rows[0]?.n ?? 0);
      const executions: string[] = [];
      let annules = 0;
      let laisses = 0;
      for (const lot of lots) {
        const n = await niveauSur(tx, lot.entiteId);
        if (!n || !auMoins(n, 'revision')) {
          laisses++;
          continue;
        }
        const effet = await this.annulerLot(tx, acces, lot, d.motif);
        if (effet.executionId) executions.push(effet.executionId);
        annules++;
      }
      const total = Number((await tx.execute(sql`select campagne_nb_lots(${id}::uuid) as n`)).rows[0]?.n ?? lots.length);
      // Rien n'a pu être annulé : la campagne garde son statut (la transaction est abandonnée), et l'appelant le sait.
      if (annules === 0) throw new BadRequestException({ message: 'Aucun import annulé : habilitation de révision requise sur les dossiers concernés', laisses });
      await tx.update(s.campagnesImport).set({ statut: 'annulee' }).where(eq(s.campagnesImport.id, id));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'campagne.annulee', cibleType: 'campagne_import', cibleId: id, details: { annules, laisses } });
      return { annules, laisses, horsHabilitation: Math.max(0, total - lots.length - dejaAnnules), executions };
    });
    for (const executionId of executions) await this.taches.executerControles({ cabinetId: acces.cabinetId, executionId }).catch(() => undefined);
    return { annules, laissesFauteHabilitation: laisses + horsHabilitation };
  }
}
