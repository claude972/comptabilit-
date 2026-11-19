import { BadRequestException, ConflictException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { calculerBalance, calculerIndicateurs, CATALOGUE_INDICATEURS, correspondancePour, type LigneEcriture, projeterBilan, projeterCompteDeResultat, schemaChaineDecimale } from '@comtaple/core';
import { type AccesBd, and, desc, eq, inArray, lt, schema as s, type Tx } from '@comtaple/db';
import { lignesDuLot } from '@comtaple/plateforme';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';

/** Au-delà, le calcul immédiat n'est pas proposé (à faire en traitement différé : non implémenté). */
const PLAFOND_LIGNES = 400_000;
const MENTION = 'PROJET — état de travail calculé à partir des écritures importées, avant écritures d’inventaire. Il ne constitue ni des comptes annuels ni une validation.';

@ApiTags('États de travail et indicateurs')
@ApiBearerAuth()
@Controller('v1')
export class EtatsController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  private async donnees(tx: Tx, exerciceId: string): Promise<{ exercice: typeof s.exercices.$inferSelect; lot: typeof s.lotsImport.$inferSelect; lignes: LigneEcriture[] }> {
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, exerciceId));
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, exercice.entiteId, 'lecture');
    const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, exerciceId), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : état non calculable');
    if (lot.progression > PLAFOND_LIGNES) throw new ConflictException('Volume trop important pour un calcul immédiat');
    return { exercice, lot, lignes: await lignesDuLot(tx, lot.id) };
  }

  @Get('exercices/:id/etats')
  @ApiOperation({
    summary: 'Balance et PROJETS de compte de résultat et de bilan d’un exercice',
    description:
      'Calcul déterministe sur le lot comptable actif. La table de correspondance comptes → rubriques est versionnée et en attente de validation professionnelle. Un compte non affecté rend l’état incomplet et le dit ; aucun ajustement ne force l’égalité actif/passif. Annexe et liasse fiscale : hors périmètre.',
  })
  @ApiQuery({ name: 'ajuste', required: false, description: '« 1 » : états projetés sur la balance AJUSTÉE (écritures importées + écritures d’inventaire approuvées et à jour)' })
  async etats(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('ajuste') ajuste?: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, lot, lignes: importees } = await this.donnees(tx, id);
      let lignes = importees;
      let inventaire: { ecritures: number; ecartees: number } | null = null;
      if (ajuste === '1') {
        const approuvees = await tx.select().from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), inArray(s.ecrituresInventaire.statut, ['approuvee', 'exportee'])));
        const aJour = approuvees.filter((e) => e.versionDonnees === exercice.versionDonnees);
        let n = 0;
        // Les écritures d'inventaire s'ajoutent aux importées dans un journal « INV » ; les importées ne sont pas modifiées.
        lignes = [
          ...importees,
          ...aJour.flatMap((e) =>
            (e.lignes as Array<{ compteNum: string; compteLib: string; debit: string; credit: string }>).map((l) => ({
              id: `${e.id}:${n}`, numeroLigne: 1_000_000_000 + n++, journalCode: 'INV', journalLib: 'Écritures d’inventaire proposées', ecritureNum: `INV-${e.id.slice(0, 8)}`,
              ecritureDate: e.dateEcriture, compteNum: l.compteNum, compteLib: l.compteLib, compAuxNum: null, compAuxLib: null, pieceRef: `INV-${e.id.slice(0, 8)}`, pieceDate: e.dateEcriture,
              ecritureLib: e.libelle, debit: l.debit, credit: l.credit, ecritureLet: null, dateLet: null, validDate: null, montantDevise: null, idevise: null,
            })),
          ),
        ];
        inventaire = { ecritures: aJour.length, ecartees: approuvees.length - aJour.length };
      }
      const balance = calculerBalance(lignes);
      const base = { mention: inventaire ? `${MENTION} Version AJUSTÉE : elle intègre ${inventaire.ecritures} écriture(s) d’inventaire approuvée(s) en interne, non intégrées dans le logiciel comptable.` : MENTION, ajuste: Boolean(inventaire), inventaire, exercice, donnees: { lotImportId: lot.id, version: lot.version, versionDonnees: exercice.versionDonnees, statutDonnees: lot.statutDonnees }, balance };
      const correspondance = correspondancePour(exercice.debut);
      if (!correspondance) {
        return { ...base, correspondance: null, compteDeResultat: null, bilan: null, motif: 'Aucune table de correspondance vérifiée pour un exercice ouvert avant le 1er janvier 2025 : seuls la balance et certains indicateurs sont disponibles.' };
      }
      // Chaque rubrique projetée est complétée par sa nature, son parent et son ordre (issus de la table de
      // correspondance), pour que l'interface n'ait rien à déduire.
      const definitions = new Map(correspondance.rubriques.map((r) => [r.code, r]));
      const enrichir = <T extends { rubriques: Array<{ code: string }> }>(etat: T) => ({
        ...etat,
        rubriques: etat.rubriques.map((r) => {
          const def = definitions.get(r.code);
          return { ...r, nature: def?.etat ?? null, parent: def?.parent ?? null, ordre: def?.ordre ?? null };
        }),
      });
      return {
        ...base,
        correspondance: { id: correspondance.id, version: correspondance.version, periodeApplication: correspondance.periodeApplication, etat: correspondance.etat, source: correspondance.source },
        compteDeResultat: enrichir(projeterCompteDeResultat(balance, correspondance)),
        bilan: enrichir(projeterBilan(balance, correspondance)),
        motif: null,
      };
    });
  }

  @Get('exercices/:id/indicateurs')
  @ApiOperation({
    summary: 'Indicateurs de performance du dossier pour un exercice, avec formule, composantes et évolution N / N-1',
    description:
      'Chaque valeur vient du moteur, avec les comptes qui la composent. Un indicateur non calculable renvoie valeur null et son motif. Les délais clients et fournisseurs exigent un taux de TVA moyen (en pourcentage). Les « signaux » sont des points à examiner, jamais un diagnostic.',
  })
  @ApiQuery({ name: 'tauxTvaVentes', required: false, description: 'Taux moyen en pourcentage, ex. 20' })
  @ApiQuery({ name: 'tauxTvaAchats', required: false })
  async indicateurs(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('tauxTvaVentes') tv?: string, @Query('tauxTvaAchats') ta?: string) {
    exigerUuid(id);
    for (const t of [tv, ta]) if (t !== undefined && !schemaChaineDecimale.safeParse(t).success) throw new BadRequestException('Taux de TVA : chaîne décimale attendue (ex. 20 ou 5.5)');
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, lot, lignes } = await this.donnees(tx, id);
      // Exercice précédent : celui qui se termine juste avant, s'il a un lot comptable actif.
      const [precedent] = await tx.select().from(s.exercices).where(and(eq(s.exercices.entiteId, exercice.entiteId), lt(s.exercices.fin, exercice.debut))).orderBy(desc(s.exercices.fin)).limit(1);
      let exercicePrecedent: { lignes: LigneEcriture[]; exercice: { debut: string; fin: string } } | null = null;
      if (precedent) {
        const [lotP] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, precedent.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
        if (lotP && lotP.progression <= PLAFOND_LIGNES) exercicePrecedent = { lignes: await lignesDuLot(tx, lotP.id), exercice: { debut: precedent.debut, fin: precedent.fin } };
      }
      const tauxTvaMoyen = tv || ta ? { ...(tv ? { ventes: tv } : {}), ...(ta ? { achats: ta } : {}) } : null;
      return {
        mention: 'Indicateurs calculés par le moteur à partir des écritures importées, avant écritures d’inventaire : aide à la revue, pas un diagnostic.',
        exercice,
        donnees: { lotImportId: lot.id, versionDonnees: exercice.versionDonnees, exercicePrecedentFourni: Boolean(exercicePrecedent) },
        indicateurs: calculerIndicateurs({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, exercicePrecedent, tauxTvaMoyen }),
      };
    });
  }

  @Get('reference/indicateurs')
  @ApiOperation({ summary: 'Catalogue des indicateurs : formule, convention, unité, entrées, règle en cas de donnée manquante, source' })
  catalogue() {
    return CATALOGUE_INDICATEURS;
  }
}
