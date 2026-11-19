import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { calculerEcheance, etatQuota, type Offre, schemaOffre, serviceOuvert, situationAbonnement } from '@comtaple/core';
import { type AccesBd, desc, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const changement = z.object({ offre: z.string().min(1).max(40) });
const resiliation = z.object({ motif: z.string().min(1).max(2000) });
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const finDeMois = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Situation de l'abonnement du cabinet courant (fonction SQL étroite, lisible par tout membre). */
export async function situationCabinet(tx: Tx) {
  const r = (await tx.execute(sql`select statut, debut::text as debut, fin_essai::text as "finEssai", fin::text as fin from abonnement_situation()`)).rows[0] as
    | { statut: 'essai' | 'actif' | 'suspendu' | 'resilie'; debut: string; finEssai: string | null; fin: string | null }
    | undefined;
  return { etat: r ?? null, situation: situationAbonnement(r ?? null, aujourdhui()) };
}

const MESSAGES: Record<string, string> = {
  aucun: 'Aucun abonnement n’est ouvert pour ce cabinet.',
  essai_expire: 'La période d’essai est terminée.',
  suspendu: 'L’abonnement est suspendu.',
  resilie: 'L’abonnement est résilié.',
};

/** Refuse les nouveaux dépôts et imports quand le service n'est pas ouvert ; la consultation et l'export restent possibles. */
export async function exigerServiceOuvert(tx: Tx): Promise<void> {
  const { situation } = await situationCabinet(tx);
  if (!serviceOuvert(situation)) {
    throw new ForbiddenException({ code: 'abonnement_inactif', situation, message: `${MESSAGES[situation] ?? 'Service fermé.'} Les nouveaux dépôts et imports sont suspendus ; la consultation et la restitution des données restent accessibles.` });
  }
}

@ApiTags('Abonnement')
@ApiBearerAuth()
@Controller('v1/abonnement')
export class AbonnementController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  private async gestionnaire(tx: Tx): Promise<void> {
    if (!(await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
  }

  @Get('situation')
  @ApiOperation({ summary: 'Le service est-il ouvert pour ce cabinet ? (tout membre ; ni offre ni montant)' })
  async situation(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const { etat, situation } = await situationCabinet(tx);
      return { situation, serviceOuvert: serviceOuvert(situation), finEssai: etat?.finEssai ?? null, fin: etat?.fin ?? null };
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Abonnement du cabinet : offre, situation, quotas consommés, estimation de la prochaine échéance (gestionnaires)',
    description: 'Les montants sont calculés par le moteur à partir de la grille de l’éditeur. Une grille marquée « fictif » est une démonstration sans valeur commerciale.',
  })
  async detail(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      const [abonnement] = await tx.select().from(s.abonnements).where(eq(s.abonnements.cabinetId, acces.cabinetId));
      const { situation } = await situationCabinet(tx);
      if (!abonnement) return { situation, serviceOuvert: false, abonnement: null, offre: null, usage: null, estimation: null };
      const [o] = await tx.select().from(s.offresAbonnement).where(eq(s.offresAbonnement.code, abonnement.offre));
      const offre = schemaOffre.parse(o!.definition);
      const u = (await tx.execute(sql`select dossiers_actifs, pieces_mois, octets_stockes::text as octets from abonnement_usage()`)).rows[0] as { dossiers_actifs: number; pieces_mois: number; octets: string };
      const go = Number(BigInt(u.octets) / 1_048_576n) / 1024; // affichage d'un volume, pas un montant
      return {
        situation,
        serviceOuvert: serviceOuvert(situation),
        abonnement,
        offre,
        usage: {
          dossiersActifs: u.dossiers_actifs,
          dossiersInclus: offre.dossiersInclus,
          piecesCeMois: etatQuota(u.pieces_mois, offre.quotas.piecesParMois),
          stockageGo: etatQuota(Math.round(go * 100) / 100, offre.quotas.stockageGo),
        },
        estimation: calculerEcheance(offre, u.dossiers_actifs),
      };
    });
  }

  @Get('offres')
  @ApiOperation({ summary: 'Offres proposées par l’éditeur (gestionnaires)' })
  async offres(@AccesCourant() acces: Acces): Promise<Offre[]> {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      const lignes = await tx.select().from(s.offresAbonnement).where(eq(s.offresAbonnement.proposee, true));
      return lignes.map((l) => schemaOffre.parse(l.definition));
    });
  }

  @Post('changement')
  @HttpCode(200)
  @ApiOperation({ summary: 'Demander un changement d’offre, appliqué à la prochaine échéance (gestionnaires)' })
  @ApiBody({ schema: schemaOpenApi(changement) })
  async changer(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(changement, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      const [abonnement] = await tx.select().from(s.abonnements).where(eq(s.abonnements.cabinetId, acces.cabinetId)).for('update');
      if (!abonnement) throw new ConflictException('Aucun abonnement à modifier');
      if (abonnement.statut === 'resilie') throw new ConflictException('Abonnement résilié');
      const [o] = await tx.select().from(s.offresAbonnement).where(eq(s.offresAbonnement.code, d.offre));
      if (!o || !o.proposee) throw new BadRequestException('Offre inconnue');
      const [maj] = await tx.update(s.abonnements).set({ offreDemandee: d.offre === abonnement.offre ? null : d.offre }).where(eq(s.abonnements.id, abonnement.id)).returning();
      await tx.insert(s.evenementsFacturation).values({ cabinetId: acces.cabinetId, abonnementId: abonnement.id, type: 'changement_offre_demande', detail: { de: abonnement.offre, vers: d.offre } });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'abonnement.changement_demande', cibleType: 'abonnement', cibleId: abonnement.id, details: { de: abonnement.offre, vers: d.offre } });
      return maj;
    });
  }

  @Post('resiliation')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Résilier l’abonnement (gestionnaires)',
    description: 'Le service reste ouvert jusqu’à la fin du mois en cours. Les données ne sont pas supprimées par la résiliation : leur devenir relève de la politique de restitution.',
  })
  @ApiBody({ schema: schemaOpenApi(resiliation) })
  async resilier(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(resiliation, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      const [abonnement] = await tx.select().from(s.abonnements).where(eq(s.abonnements.cabinetId, acces.cabinetId)).for('update');
      if (!abonnement) throw new ConflictException('Aucun abonnement à résilier');
      if (abonnement.statut === 'resilie') throw new ConflictException('Abonnement déjà résilié');
      const fin = finDeMois(aujourdhui());
      const [maj] = await tx.update(s.abonnements).set({ statut: 'resilie', fin, motifResiliation: d.motif, offreDemandee: null }).where(eq(s.abonnements.id, abonnement.id)).returning();
      await tx.insert(s.evenementsFacturation).values({ cabinetId: acces.cabinetId, abonnementId: abonnement.id, type: 'resiliation', detail: { fin } });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'abonnement.resilie', cibleType: 'abonnement', cibleId: abonnement.id, details: { fin } });
      return maj;
    });
  }

  @Get('echeances')
  @ApiOperation({ summary: 'Échéances émises et statut de paiement par virement (gestionnaires)' })
  async echeances(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      return tx.select().from(s.echeancesAbonnement).orderBy(desc(s.echeancesAbonnement.periodeDebut)).limit(60);
    });
  }

  @Get('historique')
  @ApiOperation({ summary: 'Historique des éléments de facturation (gestionnaires)' })
  async historique(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      await this.gestionnaire(tx);
      return tx.select().from(s.evenementsFacturation).orderBy(desc(s.evenementsFacturation.creeLe)).limit(200);
    });
  }
}
