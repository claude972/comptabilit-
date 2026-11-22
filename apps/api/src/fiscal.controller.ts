import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type CategorieEntiteAnnexe,
  calculerBalance,
  type Constat,
  dec,
  evaluerCategorieTaille,
  type ImpotSurLeResultat,
  type LigneEcriture,
  preparerAnnexe,
  preparerLiasse,
  preparerDetailResultat,
  preparerTableauxImmobilisations,
  type QualificationRenvoi,
  type QualificationVentilation,
  RENVOIS,
  RENVOIS_RSI,
  LIGNES_RESULTAT_FISCAL,
  LIGNES_CA,
  schemaChaineDecimale,
  MOTIF_DEGRESSIF_NON_ACTIVE,
  proposerEcrituresInventaire,
  schemaImmobilisation,
  schemaImmobilisationBase,
  type RegimeLiasse,
  versChaine,
} from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, journaliser, lt, schema as s, type Tx } from '@comtaple/db';
import { type Config, tailleEtOperationsDuDossier } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD, CONFIG } from './jetons.js';
import { avecCalcul, type Budget, chargerLignes, ApiRefusVolume } from './plafonds.js';
import { schemaOpenApi, valider } from './validation.js';

const CATEGORIES = ['micro_entreprise', 'petite_entreprise', 'personne_morale_regime_simplifie', 'moyenne_ou_grande_entreprise'] as const;
const categorie = z.object({ categorie: z.enum(CATEGORIES).nullable() });
const confirmation = z.object({ etat: z.enum(['complete', 'non_applicable']), note: z.string().max(8000).optional() });
/** Mêmes contrôles que la reprise par import (D-092) : le schéma vit dans le moteur, source unique des deux chemins. */
const immobilisationBase = schemaImmobilisationBase;
const immobilisation = schemaImmobilisation;
const montantSigne = schemaChaineDecimale;
const ventilation = z.object({ montantFrance: montantSigne, montantExport: montantSigne, note: z.string().trim().min(5, 'Note obligatoire (5 caractères au moins) : elle justifie la ventilation').max(2000) });
const renvoiSaisie = z.object({ montant: montantSigne, note: z.string().trim().min(5, 'Note obligatoire (5 caractères au moins) : elle justifie le montant').max(2000) });
const COMPTE_CA = /^70[0-9A-Za-z]{1,13}$/;
const CODE_RENVOI = /^[0-9A-Z_]{2,6}$/;
const RENVOIS_CONNUS = [...RENVOIS, ...RENVOIS_RSI, ...LIGNES_RESULTAT_FISCAL.map((l) => ({ code: l.cle }))];
const CLES_RESULTAT_FISCAL = new Set(LIGNES_RESULTAT_FISCAL.map((l) => l.cle));
const RUBRIQUE = /^ANX-[0-9A-Za-z-]{1,24}$/;
const PROPOSITION = /^[A-Za-z0-9:_|.-]{1,200}$/;

/** Formes de sociétés commerciales reconnues à la saisie libre du dossier ; toute autre valeur renseignée est « non commerciale ». */
const FORMES_COMMERCIALES = new Set(['SA', 'SAS', 'SASU', 'SARL', 'EURL', 'SNC', 'SCA', 'SCS', 'SE']);
function societeCommerciale(forme: string | null): boolean | null {
  if (!forme || !forme.trim()) return null;
  return FORMES_COMMERCIALES.has(forme.trim().toUpperCase().replace(/[.\s]/g, ''));
}
function impot(regime: string | null): ImpotSurLeResultat {
  if (!regime || !regime.trim()) return 'a_confirmer';
  const r = regime.trim().toUpperCase();
  return r === 'IS' ? 'is' : r === 'IR' ? 'ir' : 'autre';
}

@ApiTags('États fiscaux (projets)')
@ApiBearerAuth()
@Controller('v1')
export class FiscalController {
  constructor(@Inject(BD) private readonly bd: AccesBd, @Inject(CONFIG) private readonly cfg: Config) {}

  private async donnees(tx: Tx, budget: Budget, ecran: string, exerciceId: string, minimum: Parameters<typeof exigerNiveau>[2] = 'lecture', avecPrecedent = false) {
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, exerciceId));
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, exercice.entiteId, minimum);
    const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, exercice.entiteId));
    if (!entite) throw new NotFoundException('Dossier introuvable');
    const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, exerciceId), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : rien ne peut être préparé');
    // Plafond de l'API (D-093) : volume vérifié avant toute lecture, refus motivé au-delà.
    // Exercice précédent (colonne N-1) : celui qui se termine juste avant, s'il a un lot comptable actif.
    let precedentExercice: typeof s.exercices.$inferSelect | undefined;
    let lotPrecedent: typeof s.lotsImport.$inferSelect | undefined;
    if (avecPrecedent) {
      [precedentExercice] = await tx.select().from(s.exercices).where(and(eq(s.exercices.entiteId, exercice.entiteId), lt(s.exercices.fin, exercice.debut))).orderBy(desc(s.exercices.fin)).limit(1);
      if (precedentExercice) [lotPrecedent] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, precedentExercice.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    }
    const charge = await chargerLignes(tx, budget, this.cfg, { ecran, plafond: 'calcul', lot, lotPrecedent: lotPrecedent ?? null });
    const precedent = charge.precedent && precedentExercice ? { lignes: charge.precedent as LigneEcriture[], exercice: { debut: precedentExercice.debut, fin: precedentExercice.fin } } : null;
    return { exercice, entite, lot, lignes: charge.lignes as LigneEcriture[], precedent, motifPrecedent: charge.motifPrecedent };
  }

  /** Fichier des immobilisations SAISI ou REPRIS du dossier (D-071, D-092) : seules celles en service au plus tard à la clôture, au format du moteur. */
  private async fichierEnService(tx: Tx, entiteId: string, fin: string) {
    const fichier = await tx.select().from(s.immobilisations).where(eq(s.immobilisations.entiteId, entiteId)).orderBy(asc(s.immobilisations.creeLe));
    const immobilisations = fichier
      .filter((i) => i.dateMiseEnService <= fin)
      .map((i) => ({
        id: i.id, libelle: i.libelle, compteImmobilisation: i.compteImmobilisation, baseAmortissable: i.baseAmortissable, dateAcquisition: i.dateAcquisition, dateMiseEnService: i.dateMiseEnService, dureeMois: i.dureeMois, amortissementsAnterieurs: i.amortissementsAnterieurs,
        modeAmortissement: i.modeAmortissement as 'lineaire' | 'degressif', coefficientDegressif: i.coefficientDegressif, eligibiliteDegressifConfirmee: i.eligibiliteDegressifConfirmee, valeurResiduelle: i.valeurResiduelle, dateSortie: i.dateSortie, composantDe: i.composantDe,
      }));
    return { nbImmobilisations: fichier.length, immobilisations };
  }

  /** Détail du compte de résultat (2052 / 2053 ou 2033-B, D-106 / D-107) : qualifications du cabinet lues pour l'exercice, moteur appliqué à la balance. */
  private async detailResultat(tx: Tx, c: { exercice: typeof s.exercices.$inferSelect; entite: typeof s.entites.$inferSelect; lignes: LigneEcriture[]; regime: RegimeLiasse; resultatComptable: string | null }) {
    const rows = await tx.select().from(s.qualificationsResultat).where(eq(s.qualificationsResultat.exerciceId, c.exercice.id));
    const trace = (r: (typeof rows)[number]) => ({ note: r.note, qualifieePar: r.qualifieePar, le: new Date(r.creeLe).toISOString(), versionDonnees: r.versionDonnees });
    const ventilations: QualificationVentilation[] = rows.filter((r) => r.nature === 'ventilation_ca').map((r) => ({ compte: r.cle, montantFrance: r.montant, montantExport: r.montantExport ?? '0.00', ...trace(r) }));
    const renvois: QualificationRenvoi[] = rows.filter((r) => r.nature === 'renvoi').map((r) => ({ code: r.cle, montant: r.montant, ...trace(r) }));
    return preparerDetailResultat({
      balance: calculerBalance(c.lignes),
      exercice: { debut: c.exercice.debut, fin: c.exercice.fin },
      regime: c.regime,
      territoire: c.entite.territoireFiscal,
      impotSurLeResultat: impot(c.entite.regimeFiscal),
      referentielComptable: c.entite.referentielComptable,
      devise: 'EUR',
      societeCommerciale: societeCommerciale(c.entite.formeJuridique),
      versionDonnees: c.exercice.versionDonnees,
      resultatComptable: c.resultatComptable,
      ventilations,
      renvois,
    });
  }

  /** Ajoute une ligne à l'historique (AJOUT SEUL, D-110) : chaque saisie et chaque retrait, avec son auteur, sa note et la version des données. */
  private async historiser(tx: Tx, acces: Acces, exercice: typeof s.exercices.$inferSelect, nature: 'ventilation_ca' | 'renvoi', cle: string, action: 'saisie' | 'retrait', v?: { montant: string; montantExport?: string | null; note: string }) {
    await tx.insert(s.historiqueQualifications).values({
      cabinetId: acces.cabinetId, entiteId: exercice.entiteId, exerciceId: exercice.id, nature, cle, action,
      montant: v?.montant ?? null, montantExport: v?.montantExport ?? null, note: v?.note ?? null, versionDonnees: exercice.versionDonnees, auteurId: acces.utilisateurId,
    });
  }

  @Get('exercices/:id/qualifications/historique')
  @ApiQuery({ name: 'cle', required: false })
  @ApiOperation({
    summary: 'Historique des qualifications du détail du compte de résultat : chaque saisie et chaque retrait, avec auteur, date, note et version des données',
    description: 'Journal en ajout seul : une ligne n’est jamais modifiée ni supprimée par l’application. Sans « cle », toutes les qualifications de l’exercice (plus récentes d’abord, 500 au plus).',
  })
  async historique(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('cle') cle?: string) {
    exigerUuid(id);
    if (cle !== undefined && !/^[0-9A-Za-z_]{2,20}$/.test(cle)) throw new BadRequestException('cle invalide');
    return this.bd.avecContexte(acces, async (tx) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'lecture');
      const lignes = await tx
        .select({ nature: s.historiqueQualifications.nature, cle: s.historiqueQualifications.cle, action: s.historiqueQualifications.action, montant: s.historiqueQualifications.montant, montantExport: s.historiqueQualifications.montantExport, note: s.historiqueQualifications.note, versionDonnees: s.historiqueQualifications.versionDonnees, auteurId: s.historiqueQualifications.auteurId, le: s.historiqueQualifications.creeLe })
        .from(s.historiqueQualifications)
        .where(cle === undefined ? eq(s.historiqueQualifications.exerciceId, id) : and(eq(s.historiqueQualifications.exerciceId, id), eq(s.historiqueQualifications.cle, cle)))
        .orderBy(desc(s.historiqueQualifications.creeLe))
        .limit(500);
      return { exerciceId: id, evenements: lignes };
    });
  }

  @Put('exercices/:id/qualifications/ventilation/:compte')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'Qualifier un compte du chiffre d’affaires : montant réalisé en France et montant des exportations et livraisons intracommunautaires (niveau révision)',
    description:
      'La balance ne dit pas où se trouve le client : la qualification est une déclaration du cabinet, tracée (auteur, date, version des données, note obligatoire). France + exportations doivent être EXACTEMENT égaux au solde créditeur du compte (un compte de rabais, remises et ristournes se qualifie avec des montants négatifs) ; sinon la saisie est refusée en 409 avec l’écart. Elle devient « à revoir » dès que les données changent. Elle ne vaut pas validation professionnelle.',
  })
  @ApiBody({ schema: schemaOpenApi(ventilation) })
  async qualifierVentilation(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('compte') compte: string, @Body() corps: unknown) {
    exigerUuid(id);
    if (!COMPTE_CA.test(compte)) throw new BadRequestException('compte : numéro de compte de la classe 70');
    const d = valider(ventilation, corps);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, lignes } = await this.donnees(tx, budget, 'Qualification d’un compte du chiffre d’affaires', id, 'revision');
      const ligne = calculerBalance(lignes).lignes.find((l) => l.compteNum === compte);
      if (!ligne || !LIGNES_CA.some((l) => l.prefixes.some((p) => compte.startsWith(p)))) throw new NotFoundException('Ce compte n’existe pas dans la balance de l’exercice ou n’appartient à aucune ligne du chiffre d’affaires (marchandises, biens, services)');
      const solde = dec(ligne.totalCredit).minus(ligne.totalDebit);
      if (solde.isZero()) throw new ConflictException('Ce compte ne porte aucun montant : rien à qualifier');
      const ecart = solde.minus(dec(d.montantFrance)).minus(dec(d.montantExport));
      if (!ecart.isZero()) throw new ConflictException(`France + exportations (${versChaine(dec(d.montantFrance).plus(d.montantExport))}) diffèrent du solde créditeur du compte (${versChaine(solde)}) : écart ${versChaine(ecart)}. Rien n’est enregistré.`);
      await tx.delete(s.qualificationsResultat).where(and(eq(s.qualificationsResultat.exerciceId, id), eq(s.qualificationsResultat.nature, 'ventilation_ca'), eq(s.qualificationsResultat.cle, compte)));
      const [q] = await tx
        .insert(s.qualificationsResultat)
        .values({ cabinetId: acces.cabinetId, entiteId: exercice.entiteId, exerciceId: id, nature: 'ventilation_ca', cle: compte, montant: versChaine(dec(d.montantFrance)), montantExport: versChaine(dec(d.montantExport)), note: d.note, versionDonnees: exercice.versionDonnees, qualifieePar: acces.utilisateurId })
        .returning();
      await this.historiser(tx, acces, exercice, 'ventilation_ca', compte, 'saisie', { montant: q!.montant, montantExport: q!.montantExport, note: d.note });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'resultat.ventilation_qualifiee', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { compte, montantFrance: q!.montant, montantExport: q!.montantExport, versionDonnees: exercice.versionDonnees } });
      return q;
    });
  }

  @Delete('exercices/:id/qualifications/ventilation/:compte')
  @ApiOperation({ summary: 'Retirer la qualification d’un compte du chiffre d’affaires (niveau révision)' })
  async retirerVentilation(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('compte') compte: string) {
    return this.retirerQualification(acces, id, 'ventilation_ca', compte, COMPTE_CA);
  }

  @Put('exercices/:id/qualifications/renvois/:code')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'Saisir un renvoi de bas de tableau (2052 / 2053) que la balance ne porte pas (niveau révision)',
    description: 'Montant et note obligatoires ; tracés (auteur, date, version des données) ; « à revoir » dès que les données changent. Une proposition tirée de la balance n’est jamais retenue tant qu’elle n’est pas saisie ici.',
  })
  @ApiBody({ schema: schemaOpenApi(renvoiSaisie) })
  async saisirRenvoi(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('code') code: string, @Body() corps: unknown) {
    exigerUuid(id);
    if (!CODE_RENVOI.test(code) || !RENVOIS_CONNUS.some((r) => r.code === code)) throw new NotFoundException('Renvoi inconnu : les renvois préparés sont ' + RENVOIS_CONNUS.map((r) => r.code).join(', '));
    const d = valider(renvoiSaisie, corps);
    if (CLES_RESULTAT_FISCAL.has(code) && dec(d.montant).isNegative()) throw new BadRequestException('Les lignes du résultat fiscal se saisissent en positif (le sens est celui du formulaire) ; « néant » = 0.00');
    return this.bd.avecContexte(acces, async (tx) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'revision');
      await tx.delete(s.qualificationsResultat).where(and(eq(s.qualificationsResultat.exerciceId, id), eq(s.qualificationsResultat.nature, 'renvoi'), eq(s.qualificationsResultat.cle, code)));
      const [q] = await tx
        .insert(s.qualificationsResultat)
        .values({ cabinetId: acces.cabinetId, entiteId: exercice.entiteId, exerciceId: id, nature: 'renvoi', cle: code, montant: versChaine(dec(d.montant)), note: d.note, versionDonnees: exercice.versionDonnees, qualifieePar: acces.utilisateurId })
        .returning();
      await this.historiser(tx, acces, exercice, 'renvoi', code, 'saisie', { montant: q!.montant, note: d.note });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'resultat.renvoi_saisi', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { code, montant: q!.montant, versionDonnees: exercice.versionDonnees } });
      return q;
    });
  }

  @Delete('exercices/:id/qualifications/renvois/:code')
  @ApiOperation({ summary: 'Retirer la saisie d’un renvoi (niveau révision)' })
  async retirerRenvoi(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('code') code: string) {
    return this.retirerQualification(acces, id, 'renvoi', code, CODE_RENVOI);
  }

  private async retirerQualification(acces: Acces, id: string, nature: 'ventilation_ca' | 'renvoi', cle: string, motif: RegExp) {
    exigerUuid(id);
    if (!motif.test(cle)) throw new BadRequestException('identifiant de qualification invalide');
    return this.bd.avecContexte(acces, async (tx) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'revision');
      const retirees = await tx.delete(s.qualificationsResultat).where(and(eq(s.qualificationsResultat.exerciceId, id), eq(s.qualificationsResultat.nature, nature), eq(s.qualificationsResultat.cle, cle))).returning({ id: s.qualificationsResultat.id });
      if (!retirees.length) throw new NotFoundException('Aucune qualification pour cet élément');
      await this.historiser(tx, acces, exercice, nature, cle, 'retrait');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: nature === 'renvoi' ? 'resultat.renvoi_retire' : 'resultat.ventilation_retiree', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { cle } });
      return { cle, retiree: true };
    });
  }

  @Get('exercices/:id/liasse')
  @ApiRefusVolume()
  @ApiQuery({ name: 'regime', required: false, enum: ['reel_normal', 'reel_simplifie'] })
  @ApiOperation({
    summary: 'PROJET de préparation de la liasse fiscale : tableaux déduits de la balance (2050 à 2053, ou 2033-A et 2033-B) et tableaux d’immobilisations et d’amortissements (2054 et 2055, ou 2033-C)',
    description:
      'Périmètre : société commerciale à l’IS, PCG, euros, France métropolitaine. Hors périmètre, ou tant qu’une caractéristique du dossier est « à confirmer », la réponse est une ABSTENTION motivée, sans aucun chiffre. Dans le périmètre : toujours « projet », jamais « complet » (les autres tableaux, listés avec les informations qu’ils exigent, ne sont pas couverts ; les codes de cases des formulaires ne sont pas vérifiés et restent « à confirmer »). Calcul sur les écritures importées, AVANT écritures d’inventaire. Colonne N-1 : exercice précédent CONTIGU du dossier, s’il a une comptabilité importée, préparé par la même table et les mêmes règles ; sinon « indisponible » avec son motif (jamais approximée). Aucune télétransmission n’existe. « tableauxImmobilisations » (D-104) : 2054 et 2055 (régime réel normal) ou 2033-C cadres I et II (régime simplifié), déduits de la balance (mouvements des comptes 20 à 28, hors à-nouveaux) et du fichier des immobilisations saisi ou repris : chaque cellule porte son montant, son N-1, son code de case lu sur le formulaire 2026 (« à confirmer »), ou un motif d’abstention (à-nouveaux non identifiés, ventilation des diminutions, réévaluation, composants) ; les écarts entre la balance et le fichier sont AFFICHÉS, jamais corrigés ; le dégressif reste non activé sauf décision de l’éditeur.',
  })
  async liasse(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('regime') regimeBrut?: string) {
    exigerUuid(id);
    const regime = (regimeBrut ?? 'reel_normal') as RegimeLiasse;
    if (regime !== 'reel_normal' && regime !== 'reel_simplifie') throw new BadRequestException('regime : reel_normal ou reel_simplifie');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, entite, lot, lignes, precedent, motifPrecedent } = await this.donnees(tx, budget, 'Liasse fiscale (projet)', id, 'lecture', true);
      const resultat = preparerLiasse({
        balance: calculerBalance(lignes, { auxiliaire: true }),
        exercice: { debut: exercice.debut, fin: exercice.fin },
        regime,
        territoire: entite.territoireFiscal,
        impotSurLeResultat: impot(entite.regimeFiscal),
        referentielComptable: entite.referentielComptable,
        devise: 'EUR',
        societeCommerciale: societeCommerciale(entite.formeJuridique),
        precedent: precedent ? { balance: calculerBalance(precedent.lignes, { auxiliaire: true }), exercice: precedent.exercice } : null,
        motifPrecedentAbsent: motifPrecedent,
      });
      const { immobilisations } = await this.fichierEnService(tx, entite.id, exercice.fin);
      // Résultat comptable de la ligne 310 du 2033-B (produits − charges, signé) : base de la partie B « résultat fiscal » (régime simplifié).
      const resultatComptable = resultat.statut === 'projet' && regime === 'reel_simplifie' ? (resultat.tableaux.flatMap((t) => t.lignes).find((l) => l.ligne === 'RSI_2033B_RESULTAT')?.montant ?? null) : null;
      const detailResultat = await this.detailResultat(tx, { exercice, entite, lignes, regime, resultatComptable });
      const tableauxImmobilisations = preparerTableauxImmobilisations({
        lignes,
        exercice: { debut: exercice.debut, fin: exercice.fin },
        regime,
        territoire: entite.territoireFiscal,
        impotSurLeResultat: impot(entite.regimeFiscal),
        referentielComptable: entite.referentielComptable,
        devise: 'EUR',
        societeCommerciale: societeCommerciale(entite.formeJuridique),
        immobilisations,
        precedent: precedent ? { lignes: precedent.lignes, exercice: precedent.exercice } : null,
        motifPrecedentAbsent: motifPrecedent,
        options: { amortissementDegressifActive: this.cfg.AMORTISSEMENT_DEGRESSIF_ACTIVE },
      });
      return {
        exercice: { id: exercice.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees, avantInventaire: true, exercicePrecedentFourni: Boolean(precedent), ...(motifPrecedent ? { motifExercicePrecedentNonFourni: motifPrecedent } : {}) },
        regimeDemande: regime,
        // Le régime d'imposition (réel normal ou simplifié) est un choix du cabinet : il n'est déduit d'aucun seuil.
        regimeDeduit: false,
        teletransmission: 'non_disponible',
        resultat,
        tableauxImmobilisations,
        /** Détail 2052 / 2053 (régime réel normal, D-106) ou « dont export » et renvois du 2033-B (régime simplifié, D-107) : qualification tracée par le cabinet, abstention sans qualification. */
        detailResultat,
      };
    });
  }

  @Get('exercices/:id/annexe')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'PROJET d’annexe : rubriques du PCG, pré-remplissage tiré des écritures, informations à saisir, confirmations du cabinet',
    description:
      'Une rubrique requise n’est « complète » que si une personne habilitée l’a confirmée ; l’annexe n’est « complète » que si toutes le sont. Une confirmation donnée sur une version antérieure des données est signalée « à revoir » et ne compte plus. La catégorie de taille (allègements) est déclarée par le cabinet ; une catégorie indicative, calculée sur des seuils « à confirmer », est fournie à titre d’aide et n’est jamais appliquée d’office.',
  })
  async annexe(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, entite, lot, lignes } = await this.donnees(tx, budget, 'Annexe (projet)', id);
      const confirmations = await tx.select().from(s.confirmationsAnnexe).where(eq(s.confirmationsAnnexe.exerciceId, id));
      const valides = confirmations.filter((c) => c.versionDonnees === exercice.versionDonnees);
      const resultat = preparerAnnexe({
        lignes,
        exercice: { debut: exercice.debut, fin: exercice.fin },
        referentielComptable: entite.referentielComptable,
        categorie: (exercice.categorieAnnexe as CategorieEntiteAnnexe | null) ?? 'a_confirmer',
        confirmations: Object.fromEntries(valides.map((c) => [c.rubrique, c.etat as 'complete' | 'non_applicable'])),
      });
      const taille = await tailleEtOperationsDuDossier(tx, entite.id, entite.effectifMoyen);
      const indicative = evaluerCategorieTaille({ totalBilan: taille.taille.totalBilan, chiffreAffairesNet: taille.taille.chiffreAffaires, effectifMoyen: taille.taille.effectif });
      return {
        exercice: { id: exercice.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees, avantInventaire: true },
        categorieDeclaree: exercice.categorieAnnexe,
        categorieIndicative: { ...indicative, mesures: taille.taille, mention: 'Indication calculée sur le dernier exercice importé, avant inventaire, avec des seuils à confirmer : elle n’est jamais appliquée d’office.' },
        confirmations: confirmations.map((c) => ({ rubrique: c.rubrique, etat: c.etat, note: c.note, confirmeePar: c.confirmeePar, creeLe: c.creeLe, aRevoir: c.versionDonnees !== exercice.versionDonnees })),
        resultat,
      };
    });
  }

  @Put('exercices/:id/annexe/categorie')
  @ApiOperation({ summary: 'Déclarer (ou effacer) la catégorie de taille retenue pour le projet d’annexe (niveau révision)' })
  @ApiBody({ schema: schemaOpenApi(categorie) })
  async declarerCategorie(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(categorie, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'revision');
      await tx.update(s.exercices).set({ categorieAnnexe: d.categorie }).where(eq(s.exercices.id, id));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'annexe.categorie_declaree', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { avant: exercice.categorieAnnexe, apres: d.categorie } });
      return { categorieDeclaree: d.categorie };
    });
  }

  @Put('exercices/:id/annexe/rubriques/:rubrique')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'Confirmer une rubrique du projet d’annexe : « complète » ou « non applicable » (niveau révision)',
    description: 'La confirmation engage la personne qui la donne ; elle est journalisée et rattachée à la version courante des données. Elle ne vaut pas validation des comptes annuels.',
  })
  @ApiBody({ schema: schemaOpenApi(confirmation) })
  async confirmer(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('rubrique') rubrique: string, @Body() corps: unknown) {
    exigerUuid(id);
    if (!RUBRIQUE.test(rubrique)) throw new BadRequestException('rubrique invalide');
    const d = valider(confirmation, corps);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, entite, lignes } = await this.donnees(tx, budget, 'Confirmation d’une rubrique de l’annexe', id, 'revision');
      const projet = preparerAnnexe({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, referentielComptable: entite.referentielComptable, categorie: (exercice.categorieAnnexe as CategorieEntiteAnnexe | null) ?? 'a_confirmer' });
      if (projet.statut !== 'projet') throw new ConflictException('Le projet d’annexe ne peut pas être préparé pour cet exercice');
      if (!projet.rubriques.some((r) => r.id === rubrique)) throw new NotFoundException('Rubrique inconnue du modèle d’annexe');
      await tx.delete(s.confirmationsAnnexe).where(and(eq(s.confirmationsAnnexe.exerciceId, id), eq(s.confirmationsAnnexe.rubrique, rubrique)));
      const [c] = await tx
        .insert(s.confirmationsAnnexe)
        .values({ cabinetId: acces.cabinetId, entiteId: exercice.entiteId, exerciceId: id, rubrique, etat: d.etat, note: d.note?.trim() || null, versionDonnees: exercice.versionDonnees, confirmeePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'annexe.rubrique_confirmee', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { rubrique, etat: d.etat, versionDonnees: exercice.versionDonnees } });
      return c;
    });
  }

  @Delete('exercices/:id/annexe/rubriques/:rubrique')
  @ApiOperation({ summary: 'Retirer la confirmation d’une rubrique du projet d’annexe (niveau révision)' })
  async retirerConfirmation(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('rubrique') rubrique: string) {
    exigerUuid(id);
    if (!RUBRIQUE.test(rubrique)) throw new BadRequestException('rubrique invalide');
    return this.bd.avecContexte(acces, async (tx) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'revision');
      const retirees = await tx.delete(s.confirmationsAnnexe).where(and(eq(s.confirmationsAnnexe.exerciceId, id), eq(s.confirmationsAnnexe.rubrique, rubrique))).returning({ id: s.confirmationsAnnexe.id });
      if (!retirees.length) throw new NotFoundException('Aucune confirmation pour cette rubrique');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'annexe.confirmation_retiree', cibleType: 'exercice', cibleId: id, entiteId: exercice.entiteId, details: { rubrique } });
      return { rubrique, retiree: true };
    });
  }

  @Get('dossiers/:entiteId/immobilisations')
  @ApiOperation({
    summary: 'Fichier des immobilisations SAISI par le cabinet pour un dossier',
    description: 'Sert uniquement à proposer les dotations aux amortissements (linéaires, ou dégressifs sur déclaration du cabinet). Ce n’est pas le fichier des immobilisations du logiciel de production comptable, qui reste la référence ; rien n’y est importé ni exporté.',
  })
  async listerImmobilisations(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string) {
    exigerUuid(entiteId);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'lecture');
      return tx.select().from(s.immobilisations).where(eq(s.immobilisations.entiteId, entiteId)).orderBy(asc(s.immobilisations.creeLe));
    });
  }

  @Post('dossiers/:entiteId/immobilisations')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Saisir une immobilisation (niveau collaboration)',
    description:
      'baseAmortissable est la VALEUR BRUTE à amortir (chaîne décimale strictement positive) ; valeurResiduelle, si elle est saisie, lui est strictement inférieure et se déduit du montant amortissable. ' +
      'dateAcquisition (ou de construction) : obligatoire en mode dégressif (le point de départ du dégressif est le premier jour du mois d’acquisition, BOFiP BOI-BIC-AMT-20-20-30), facultative sinon, jamais postérieure à la mise en service. ' +
      'modeAmortissement : « lineaire » (défaut) ou « degressif ». La saisie du mode dégressif reste possible (déclaration du cabinet) mais AUCUN calcul n’en découle tant que l’éditeur n’a pas activé la fonction (AMORTISSEMENT_DEGRESSIF_ACTIVE, défaut faux : voir « degressif » dans les propositions). Le mode dégressif n’est jamais deviné : il exige un coefficient cohérent avec la durée (1.25 pour 3 ou 4 ans, 1.75 pour 5 ou 6 ans, 2.25 au-delà), la confirmation de l’éligibilité par le cabinet (bien neuf, durée d’au moins trois ans, bien visé par l’art. 39 A du CGI : le cabinet en répond) et une durée en années entières ; les coefficients majorés ou diminués de certains biens d’équipement ne sont pas pris en charge ; les règles correspondantes ne sont pas validées par un professionnel. ' +
      'dateSortie : si elle tombe dans ou avant l’exercice, le moteur s’abstient (il ne calcule pas la plus ou moins-value). composantDe : identifiant de l’immobilisation « structure » du même dossier (PCG art. 214-9), chaque composant ayant son propre plan. ' +
      'Aucune écriture n’est créée : seules des PROPOSITIONS de dotation en découleront.',
  })
  @ApiBody({ schema: schemaOpenApi(immobilisationBase) })
  async saisirImmobilisation(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Body() corps: unknown) {
    exigerUuid(entiteId);
    const d = valider(immobilisation, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'collaboration');
      if (d.composantDe) {
        const [structure] = await tx.select({ id: s.immobilisations.id, composantDe: s.immobilisations.composantDe }).from(s.immobilisations).where(and(eq(s.immobilisations.id, d.composantDe), eq(s.immobilisations.entiteId, entiteId)));
        if (!structure) throw new BadRequestException('composantDe : structure introuvable dans ce dossier');
        if (structure.composantDe) throw new BadRequestException('composantDe : la structure est elle-même un composant (un seul niveau de rattachement)');
      }
      const [i] = await tx
        .insert(s.immobilisations)
        .values({
          cabinetId: acces.cabinetId,
          entiteId,
          libelle: d.libelle,
          compteImmobilisation: d.compteImmobilisation,
          baseAmortissable: versChaine(dec(d.baseAmortissable)),
          dateAcquisition: d.dateAcquisition ?? null,
          dateMiseEnService: d.dateMiseEnService,
          dureeMois: d.dureeMois,
          amortissementsAnterieurs: d.amortissementsAnterieurs != null ? versChaine(dec(d.amortissementsAnterieurs)) : null,
          modeAmortissement: d.modeAmortissement,
          coefficientDegressif: d.modeAmortissement === 'degressif' ? (d.coefficientDegressif as string) : null,
          eligibiliteDegressifConfirmee: d.modeAmortissement === 'degressif' ? (d.eligibiliteDegressifConfirmee as boolean) : null,
          valeurResiduelle: d.valeurResiduelle != null ? versChaine(dec(d.valeurResiduelle)) : null,
          dateSortie: d.dateSortie ?? null,
          composantDe: d.composantDe ?? null,
          saisiePar: acces.utilisateurId,
        })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'immobilisation.saisie', cibleType: 'immobilisation', cibleId: i!.id, entiteId, details: { compte: d.compteImmobilisation, acquisition: d.dateAcquisition ?? null, dureeMois: d.dureeMois, mode: d.modeAmortissement, coefficient: d.coefficientDegressif ?? null, eligibiliteConfirmee: d.eligibiliteDegressifConfirmee ?? null, valeurResiduelle: d.valeurResiduelle != null, sortie: d.dateSortie ?? null, composant: d.composantDe ?? null } });
      return i;
    });
  }

  @Delete('dossiers/:entiteId/immobilisations/:immobilisationId')
  @ApiOperation({ summary: 'Retirer une immobilisation du fichier saisi (niveau collaboration)', description: 'Ne touche à aucune écriture : seules les propositions de dotation futures en tiennent compte. Le retrait est journalisé.' })
  async retirerImmobilisation(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Param('immobilisationId') immobilisationId: string) {
    exigerUuid(entiteId);
    exigerUuid(immobilisationId);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'collaboration');
      const [composant] = await tx.select({ id: s.immobilisations.id }).from(s.immobilisations).where(and(eq(s.immobilisations.composantDe, immobilisationId), eq(s.immobilisations.entiteId, entiteId))).limit(1);
      if (composant) throw new ConflictException('Cette immobilisation est la structure d’au moins un composant : retirez d’abord ses composants');
      const retirees = await tx.delete(s.immobilisations).where(and(eq(s.immobilisations.id, immobilisationId), eq(s.immobilisations.entiteId, entiteId))).returning({ id: s.immobilisations.id, libelle: s.immobilisations.libelle });
      if (!retirees.length) throw new NotFoundException('Immobilisation introuvable dans ce dossier');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'immobilisation.retiree', cibleType: 'immobilisation', cibleId: immobilisationId, entiteId });
      return { id: immobilisationId, retiree: true };
    });
  }

  /** Propositions déterministes du moteur pour un exercice (rien n'est enregistré). */
  private async propositions(tx: Tx, budget: Budget, ecran: string, exerciceId: string, minimum: Parameters<typeof exigerNiveau>[2]) {
    const { exercice, lot, lignes } = await this.donnees(tx, budget, ecran, exerciceId, minimum);
    // Constats de césure de la DERNIÈRE exécution terminée et non obsolète des contrôles (sinon : aucun signal de césure).
    const [execution] = await tx
      .select()
      .from(s.executionsControles)
      .where(and(eq(s.executionsControles.exerciceId, exerciceId), eq(s.executionsControles.statut, 'termine'), eq(s.executionsControles.lotImportId, lot.id)))
      .orderBy(desc(s.executionsControles.creeLe))
      .limit(1);
    const cesure = execution && !execution.obsolete ? await tx.select().from(s.constats).where(and(eq(s.constats.executionId, execution.id), eq(s.constats.controleId, 'CLO-001'))) : [];
    const constatsCesure: Constat[] = cesure.map((c) => ({ gravite: c.gravite, titre: c.titre, explication: c.explication, actionProposee: c.actionProposee, montant: c.montant, lignesConcernees: c.lignesConcernees as string[], preuves: c.preuves as Constat['preuves'], cle: c.cle }));
    // Fichier des immobilisations SAISI par le cabinet : seules les immobilisations en service au plus tard à la clôture.
    const { immobilisations, nbImmobilisations } = await this.fichierEnService(tx, exercice.entiteId, exercice.fin);
    const resultat = proposerEcrituresInventaire({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, lireLibelles: true, constatsCesure, immobilisations, options: { amortissementDegressifActive: this.cfg.AMORTISSEMENT_DEGRESSIF_ACTIVE } });
    return { exercice, lot, lignes, resultat, nbImmobilisations, signalCesure: execution ? (execution.obsolete ? 'controles_obsoletes' : 'disponible') : 'controles_non_executes' };
  }

  @Get('exercices/:id/inventaire/propositions')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'Propositions DÉTERMINISTES d’écritures d’inventaire (charges et produits constatés d’avance, factures non parvenues, factures à établir)',
    description:
      'Calculées par le moteur à partir de règles explicites et versionnées ; chaque proposition porte son origine, sa justification, son calcul, ses écritures sources, ses impacts et ses hypothèses. Rien n’est comptabilisé ni même enregistré : une proposition ne devient une écriture d’inventaire (elle-même un projet à approuver par une autre personne) que si quelqu’un la reprend. Quand une donnée manque, le moteur s’abstient et le dit. « degressif » : { active, motif } dit si le calcul du dégressif est activé (défaut : non, abstention motivée sans montant). Les dotations aux amortissements (linéaires, ou dégressives si le calcul est activé et sur déclaration explicite du cabinet) ne sont proposées que pour les immobilisations saisies par le cabinet dans le fichier du dossier ; une dotation déjà comptabilisée dans les écritures importées n’est jamais reproposée (l’écart est affiché dans « rapprochement »), et les points à traiter par le professionnel (amortissement dérogatoire éventuel) sont listés dans « signalements ».',
  })
  async listerPropositions(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, lot, resultat, signalCesure, nbImmobilisations } = await this.propositions(tx, budget, 'Propositions d’écritures d’inventaire', id, 'lecture');
      const reprises = await tx.select({ id: s.ecrituresInventaire.id, statut: s.ecrituresInventaire.statut, detail: s.ecrituresInventaire.origineDetail }).from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), eq(s.ecrituresInventaire.origine, 'proposition_moteur')));
      const parProposition = new Map(reprises.map((r) => [(r.detail as { propositionId?: string } | null)?.propositionId ?? '', r]));
      return {
        ...resultat,
        exercice: { id: exercice.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees },
        signalCesure,
        degressif: this.cfg.AMORTISSEMENT_DEGRESSIF_ACTIVE
          ? { active: true, motif: 'Calcul du dégressif activé par l’éditeur. Le texte de loi (CGI art. 39 A) reste non vérifié sur une source officielle et les règles ne sont pas validées par un professionnel : les propositions sont à contrôler.' }
          : { active: false, motif: MOTIF_DEGRESSIF_NON_ACTIVE },
        amortissements:
          nbImmobilisations > 0
            ? { proposes: true, motif: `Dotations (linéaires, ou dégressives si le calcul est activé) proposées à partir des ${nbImmobilisations} immobilisation(s) SAISIE(S) par le cabinet pour ce dossier ; ce fichier n’est pas celui du logiciel comptable, qui reste la référence.` }
            : { proposes: false, motif: 'Aucune immobilisation n’est saisie pour ce dossier (base, date de mise en service, durée) : aucune dotation n’est proposée.' },
        propositions: resultat.propositions.map((p) => {
          const reprise = parProposition.get(p.id);
          return { ...p, reprise: reprise ? { ecritureInventaireId: reprise.id, statut: reprise.statut } : null };
        }),
      };
    });
  }

  @Post('exercices/:id/inventaire/propositions/:propositionId/reprise')
  @ApiRefusVolume()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Reprendre une proposition du moteur comme écriture d’inventaire PROPOSÉE (niveau collaboration)',
    description:
      'La proposition est recalculée par le serveur (rien de ce qu’envoie le client n’est repris) puis enregistrée comme écriture d’inventaire d’origine « proposition_moteur », au statut « proposée » : elle suit ensuite le circuit normal (approbation par une AUTRE personne, export). Une même proposition ne se reprend qu’une fois.',
  })
  async reprendre(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('propositionId') propositionId: string) {
    exigerUuid(id);
    if (!PROPOSITION.test(propositionId)) throw new BadRequestException('identifiant de proposition invalide');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const { exercice, lignes, resultat } = await this.propositions(tx, budget, 'Reprise d’une proposition d’inventaire', id, 'collaboration');
      const p = resultat.propositions.find((x) => x.id === propositionId);
      if (!p) throw new NotFoundException('Proposition introuvable sur les données actuelles (elles ont peut-être changé)');
      const deja = await tx.select({ id: s.ecrituresInventaire.id, detail: s.ecrituresInventaire.origineDetail }).from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), eq(s.ecrituresInventaire.origine, 'proposition_moteur')));
      if (deja.some((e) => (e.detail as { propositionId?: string } | null)?.propositionId === propositionId)) throw new ConflictException('Cette proposition a déjà été reprise');
      const total = p.lignes.reduce((t, l) => t.plus(dec(l.debit)), dec('0'));
      const libelleCompte = new Map(lignes.map((l) => [l.compteNum, l.compteLib]));
      const [e] = await tx
        .insert(s.ecrituresInventaire)
        .values({
          cabinetId: acces.cabinetId,
          entiteId: exercice.entiteId,
          exerciceId: id,
          dateEcriture: p.dateEcriture,
          libelle: p.libelle.slice(0, 200),
          origine: 'proposition_moteur',
          origineDetail: { regle: p.origine.regle, versionRegle: p.origine.versionRegle, propositionId: p.id, type: p.type, signal: p.origine.signal, hypotheses: p.hypotheses, sources: p.sources, extourneLe: p.extourneLe },
          justification: p.justification.slice(0, 4000),
          calcul: p.calcul.map((c) => `${c.libelle} : ${c.valeur}`).join('\n').slice(0, 4000),
          pieces: [],
          lignes: p.lignes.map((l) => ({ compteNum: l.compteNum, compteLib: (libelleCompte.get(l.compteNum) ?? l.libelle).slice(0, 200), debit: versChaine(dec(l.debit)), credit: versChaine(dec(l.credit)) })),
          totalDebit: versChaine(total),
          versionDonnees: exercice.versionDonnees,
          proposeePar: acces.utilisateurId,
        })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'ecriture_inventaire.proposee', cibleType: 'ecriture_inventaire', cibleId: e!.id, entiteId: exercice.entiteId, details: { total: versChaine(total), origine: 'proposition_moteur', regle: p.origine.regle, versionRegle: p.origine.versionRegle } });
      return e;
    });
  }
}
