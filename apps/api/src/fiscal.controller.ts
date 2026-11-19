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
  proposerEcrituresInventaire,
  type RegimeLiasse,
  versChaine,
} from '@comtaple/core';
import { type AccesBd, and, desc, eq, journaliser, schema as s, type Tx } from '@comtaple/db';
import { lignesDuLot, tailleEtOperationsDuDossier } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

/** Au-delà, le calcul immédiat n'est pas proposé (même plafond que les états de travail). */
const PLAFOND_LIGNES = 400_000;
const CATEGORIES = ['micro_entreprise', 'petite_entreprise', 'personne_morale_regime_simplifie', 'moyenne_ou_grande_entreprise'] as const;
const categorie = z.object({ categorie: z.enum(CATEGORIES).nullable() });
const confirmation = z.object({ etat: z.enum(['complete', 'non_applicable']), note: z.string().max(8000).optional() });
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
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  private async donnees(tx: Tx, exerciceId: string, minimum: Parameters<typeof exigerNiveau>[2] = 'lecture') {
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, exerciceId));
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, exercice.entiteId, minimum);
    const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, exercice.entiteId));
    if (!entite) throw new NotFoundException('Dossier introuvable');
    const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, exerciceId), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : rien ne peut être préparé');
    if (lot.progression > PLAFOND_LIGNES) throw new ConflictException('Volume trop important pour un calcul immédiat');
    return { exercice, entite, lot, lignes: (await lignesDuLot(tx, lot.id)) as LigneEcriture[] };
  }

  @Get('exercices/:id/liasse')
  @ApiQuery({ name: 'regime', required: false, enum: ['reel_normal', 'reel_simplifie'] })
  @ApiOperation({
    summary: 'PROJET de préparation de la liasse fiscale : tableaux déduits de la balance (2050 à 2053, ou 2033-A et 2033-B)',
    description:
      'Périmètre : société commerciale à l’IS, PCG, euros, France métropolitaine. Hors périmètre, ou tant qu’une caractéristique du dossier est « à confirmer », la réponse est une ABSTENTION motivée, sans aucun chiffre. Dans le périmètre : toujours « projet », jamais « complet » (les autres tableaux, listés avec les informations qu’ils exigent, ne sont pas couverts ; les codes de cases des formulaires ne sont pas vérifiés et restent « à confirmer »). Calcul sur les écritures importées, AVANT écritures d’inventaire. Aucune télétransmission n’existe.',
  })
  async liasse(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('regime') regimeBrut?: string) {
    exigerUuid(id);
    const regime = (regimeBrut ?? 'reel_normal') as RegimeLiasse;
    if (regime !== 'reel_normal' && regime !== 'reel_simplifie') throw new BadRequestException('regime : reel_normal ou reel_simplifie');
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, entite, lot, lignes } = await this.donnees(tx, id);
      const resultat = preparerLiasse({
        balance: calculerBalance(lignes, { auxiliaire: true }),
        exercice: { debut: exercice.debut, fin: exercice.fin },
        regime,
        territoire: entite.territoireFiscal,
        impotSurLeResultat: impot(entite.regimeFiscal),
        referentielComptable: entite.referentielComptable,
        devise: 'EUR',
        societeCommerciale: societeCommerciale(entite.formeJuridique),
      });
      return {
        exercice: { id: exercice.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees, avantInventaire: true },
        regimeDemande: regime,
        // Le régime d'imposition (réel normal ou simplifié) est un choix du cabinet : il n'est déduit d'aucun seuil.
        regimeDeduit: false,
        teletransmission: 'non_disponible',
        resultat,
      };
    });
  }

  @Get('exercices/:id/annexe')
  @ApiOperation({
    summary: 'PROJET d’annexe : rubriques du PCG, pré-remplissage tiré des écritures, informations à saisir, confirmations du cabinet',
    description:
      'Une rubrique requise n’est « complète » que si une personne habilitée l’a confirmée ; l’annexe n’est « complète » que si toutes le sont. Une confirmation donnée sur une version antérieure des données est signalée « à revoir » et ne compte plus. La catégorie de taille (allègements) est déclarée par le cabinet ; une catégorie indicative, calculée sur des seuils « à confirmer », est fournie à titre d’aide et n’est jamais appliquée d’office.',
  })
  async annexe(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, entite, lot, lignes } = await this.donnees(tx, id);
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
  @ApiOperation({
    summary: 'Confirmer une rubrique du projet d’annexe : « complète » ou « non applicable » (niveau révision)',
    description: 'La confirmation engage la personne qui la donne ; elle est journalisée et rattachée à la version courante des données. Elle ne vaut pas validation des comptes annuels.',
  })
  @ApiBody({ schema: schemaOpenApi(confirmation) })
  async confirmer(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('rubrique') rubrique: string, @Body() corps: unknown) {
    exigerUuid(id);
    if (!RUBRIQUE.test(rubrique)) throw new BadRequestException('rubrique invalide');
    const d = valider(confirmation, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, entite, lignes } = await this.donnees(tx, id, 'revision');
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

  /** Propositions déterministes du moteur pour un exercice (rien n'est enregistré). */
  private async propositions(tx: Tx, exerciceId: string, minimum: Parameters<typeof exigerNiveau>[2]) {
    const { exercice, lot, lignes } = await this.donnees(tx, exerciceId, minimum);
    // Constats de césure de la DERNIÈRE exécution terminée et non obsolète des contrôles (sinon : aucun signal de césure).
    const [execution] = await tx
      .select()
      .from(s.executionsControles)
      .where(and(eq(s.executionsControles.exerciceId, exerciceId), eq(s.executionsControles.statut, 'termine'), eq(s.executionsControles.lotImportId, lot.id)))
      .orderBy(desc(s.executionsControles.creeLe))
      .limit(1);
    const cesure = execution && !execution.obsolete ? await tx.select().from(s.constats).where(and(eq(s.constats.executionId, execution.id), eq(s.constats.controleId, 'CLO-001'))) : [];
    const constatsCesure: Constat[] = cesure.map((c) => ({ gravite: c.gravite, titre: c.titre, explication: c.explication, actionProposee: c.actionProposee, montant: c.montant, lignesConcernees: c.lignesConcernees as string[], preuves: c.preuves as Constat['preuves'], cle: c.cle }));
    const resultat = proposerEcrituresInventaire({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, lireLibelles: true, constatsCesure });
    return { exercice, lot, lignes, resultat, signalCesure: execution ? (execution.obsolete ? 'controles_obsoletes' : 'disponible') : 'controles_non_executes' };
  }

  @Get('exercices/:id/inventaire/propositions')
  @ApiOperation({
    summary: 'Propositions DÉTERMINISTES d’écritures d’inventaire (charges et produits constatés d’avance, factures non parvenues, factures à établir)',
    description:
      'Calculées par le moteur à partir de règles explicites et versionnées ; chaque proposition porte son origine, sa justification, son calcul, ses écritures sources, ses impacts et ses hypothèses. Rien n’est comptabilisé ni même enregistré : une proposition ne devient une écriture d’inventaire (elle-même un projet à approuver par une autre personne) que si quelqu’un la reprend. Quand une donnée manque, le moteur s’abstient et le dit. Les dotations aux amortissements ne sont pas proposées : le logiciel n’a pas de fichier des immobilisations.',
  })
  async listerPropositions(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, lot, resultat, signalCesure } = await this.propositions(tx, id, 'lecture');
      const reprises = await tx.select({ id: s.ecrituresInventaire.id, statut: s.ecrituresInventaire.statut, detail: s.ecrituresInventaire.origineDetail }).from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), eq(s.ecrituresInventaire.origine, 'proposition_moteur')));
      const parProposition = new Map(reprises.map((r) => [(r.detail as { propositionId?: string } | null)?.propositionId ?? '', r]));
      return {
        ...resultat,
        exercice: { id: exercice.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees },
        signalCesure,
        amortissements: { proposes: false, motif: 'Aucun fichier des immobilisations (base, date de mise en service, durée) n’existe dans le logiciel : aucune dotation n’est proposée.' },
        propositions: resultat.propositions.map((p) => {
          const reprise = parProposition.get(p.id);
          return { ...p, reprise: reprise ? { ecritureInventaireId: reprise.id, statut: reprise.statut } : null };
        }),
      };
    });
  }

  @Post('exercices/:id/inventaire/propositions/:propositionId/reprise')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Reprendre une proposition du moteur comme écriture d’inventaire PROPOSÉE (niveau collaboration)',
    description:
      'La proposition est recalculée par le serveur (rien de ce qu’envoie le client n’est repris) puis enregistrée comme écriture d’inventaire d’origine « proposition_moteur », au statut « proposée » : elle suit ensuite le circuit normal (approbation par une AUTRE personne, export). Une même proposition ne se reprend qu’une fois.',
  })
  async reprendre(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('propositionId') propositionId: string) {
    exigerUuid(id);
    if (!PROPOSITION.test(propositionId)) throw new BadRequestException('identifiant de proposition invalide');
    return this.bd.avecContexte(acces, async (tx) => {
      const { exercice, lignes, resultat } = await this.propositions(tx, id, 'collaboration');
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
