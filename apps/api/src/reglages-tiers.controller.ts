import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { dec, TOLERANCE_MONTANT_MAX } from '@comtaple/core';
import { type AccesBd, and, desc, eq, isNull, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { toleranceEnVigueur } from './reglages-tiers.js';
import { schemaOpenApi, valider } from './validation.js';

/** Montant exact : au plus 4 chiffres entiers et 2 décimales (la base garde 2 décimales : rien n'est arrondi en silence). */
const FORME_MONTANT = /^\d{1,4}(\.\d{1,2})?$/;
const montantTolerance = z
  .string()
  .regex(FORME_MONTANT, 'Montant invalide : « 5 » ou « 5.00 » (positif ou nul, deux décimales au plus, point décimal).')
  // Zod poursuit les contrôles après un échec de forme : le décimal n'est lu que si la forme est bonne.
  .refine((v) => !FORME_MONTANT.test(v) || dec(v).lessThanOrEqualTo(TOLERANCE_MONTANT_MAX), `La tolérance ne peut pas dépasser ${TOLERANCE_MONTANT_MAX}.`);
const reglage = z.object({ toleranceMontant: montantTolerance, motif: z.string().trim().min(1).max(2000) });

const NOTE =
  'La tolérance ne sert qu’à PROPOSER, avec son écart toujours affiché, un règlement non lettré dont le montant diffère du reste dû d’au plus cette valeur : la proposition reste « à confirmer » par une personne habilitée. Elle ne lettre rien, n’impute rien et ne change aucun reste dû d’elle-même. Valeur par défaut : 0.00, c’est-à-dire AUCUNE tolérance ; jamais appliquée sans réglage explicite. Chaque réglage est une ligne ajoutée (auteur, date, motif) : aucun n’est modifié ni supprimé.';

async function exigerGestionnaire(tx: Tx): Promise<void> {
  if (!(await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
}

@ApiTags('Tiers, factures et règlements (aide à la révision)')
@ApiBearerAuth()
@Controller('v1')
export class ReglagesTiersController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  private async historique(tx: Tx, cabinetId: string, dossierId: string | null) {
    const portee = dossierId === null ? isNull(s.reglagesTiersFactures.dossierId) : eq(s.reglagesTiersFactures.dossierId, dossierId);
    return tx
      .select({ id: s.reglagesTiersFactures.id, toleranceMontant: s.reglagesTiersFactures.toleranceMontant, motif: s.reglagesTiersFactures.motif, creeLe: s.reglagesTiersFactures.creeLe, auteur: s.utilisateurs.nom })
      .from(s.reglagesTiersFactures)
      .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.reglagesTiersFactures.reglePar))
      .where(and(eq(s.reglagesTiersFactures.cabinetId, cabinetId), portee))
      .orderBy(desc(s.reglagesTiersFactures.creeLe), desc(s.reglagesTiersFactures.id))
      .limit(20);
  }

  @Get('dossiers/:id/tiers-factures/reglages')
  @ApiOperation({
    summary: 'Tolérance de montant de l’appariement facture ↔ règlement en vigueur pour le dossier (et son historique)',
    description: `${NOTE} Lecture : niveau « lecture » sur le dossier. Le réglage du dossier l’emporte sur celui du cabinet.`,
  })
  async lire(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const [e] = await tx.select({ id: s.entites.id }).from(s.entites).where(eq(s.entites.id, id));
      if (!e) throw new NotFoundException('Dossier introuvable');
      const vigueur = await toleranceEnVigueur(tx, acces.cabinetId, id);
      return { dossierId: id, enVigueur: vigueur, maximum: TOLERANCE_MONTANT_MAX, historiqueDossier: await this.historique(tx, acces.cabinetId, id), historiqueCabinet: await this.historique(tx, acces.cabinetId, null), note: NOTE };
    });
  }

  @Put('dossiers/:id/tiers-factures/reglages')
  @ApiBody({ schema: schemaOpenApi(reglage) })
  @ApiOperation({
    summary: 'Régler la tolérance de montant pour un dossier (niveau « révision », motif obligatoire)',
    description: `${NOTE} Pour revenir à « aucune tolérance », régler 0.00 : c’est une nouvelle ligne, l’historique est conservé.`,
  })
  async regler(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(reglage, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'revision');
      const avant = await toleranceEnVigueur(tx, acces.cabinetId, id);
      const [l] = await tx.insert(s.reglagesTiersFactures).values({ cabinetId: acces.cabinetId, dossierId: id, toleranceMontant: d.toleranceMontant, motif: d.motif, reglePar: acces.utilisateurId }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'tiers_factures.tolerance_reglee', cibleType: 'entite', cibleId: id, entiteId: id, details: { portee: 'dossier', avant: avant.montant, origineAvant: avant.origine, apres: l!.toleranceMontant, motif: d.motif } });
      return { dossierId: id, enVigueur: await toleranceEnVigueur(tx, acces.cabinetId, id) };
    });
  }

  @Get('cabinet/tiers-factures/reglages')
  @ApiOperation({ summary: 'Tolérance de montant par défaut du cabinet (administrateurs et associés)', description: NOTE })
  async lireCabinet(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const historique = await this.historique(tx, acces.cabinetId, null);
      return { enVigueur: historique[0] ? { montant: historique[0].toleranceMontant, origine: 'cabinet' as const, reglage: { id: historique[0].id, creeLe: historique[0].creeLe, auteur: historique[0].auteur, motif: historique[0].motif } } : { montant: '0.00', origine: 'defaut' as const, reglage: null }, maximum: TOLERANCE_MONTANT_MAX, historique, note: NOTE };
    });
  }

  @Put('cabinet/tiers-factures/reglages')
  @ApiBody({ schema: schemaOpenApi(reglage) })
  @ApiOperation({
    summary: 'Régler la tolérance de montant par défaut du cabinet (administrateurs et associés, motif obligatoire)',
    description: `${NOTE} Elle vaut pour tous les dossiers du cabinet qui n’ont pas leur propre réglage.`,
  })
  async reglerCabinet(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(reglage, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerGestionnaire(tx);
      const [avant] = await this.historique(tx, acces.cabinetId, null);
      const [l] = await tx.insert(s.reglagesTiersFactures).values({ cabinetId: acces.cabinetId, dossierId: null, toleranceMontant: d.toleranceMontant, motif: d.motif, reglePar: acces.utilisateurId }).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'tiers_factures.tolerance_reglee', cibleType: 'cabinet', cibleId: acces.cabinetId, details: { portee: 'cabinet', avant: avant?.toleranceMontant ?? '0.00', apres: l!.toleranceMontant, motif: d.motif } });
      return { enVigueur: { montant: l!.toleranceMontant, origine: 'cabinet' as const } };
    });
  }
}
