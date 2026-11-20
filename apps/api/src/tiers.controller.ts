import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type ChampsFacture,
  cleEcriture,
  type DecisionFacture,
  type DecisionTiers,
  dec,
  estDateIso,
  inchangeDepuis,
  type EtatFacture,
  type FicheFacture,
  type LigneEcriture,
  type PieceFacture,
  type RapprochementValide,
  type ResultatTiersFactures,
  schemaChaineDecimale,
  suivreTiersEtFactures,
  versChaine,
} from '@comtaple/core';
import { type AccesBd, and, eq, inArray, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Config } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, auMoins, exigerNiveau, exigerUuid, type Niveau } from './acces.js';
import { BD, CONFIG } from './jetons.js';
import { avecCalcul, type Budget, chargerLignes, refusVolume, ApiRefusVolume } from './plafonds.js';
import { schemaOpenApi, valider } from './validation.js';

const TAILLE_PAGE = 50;
const ETATS: readonly EtatFacture[] = [
  'non_echue', 'echue_non_reglee', 'partiellement_reglee', 'reglee', 'trop_percu', 'non_determinable', 'avoir_impute', 'avoir_partiellement_impute', 'avoir_non_impute',
];
const TYPES_TIERS = ['client', 'fournisseur', 'mixte', 'indetermine'] as const;

const decisionTri = z.enum(['confirme', 'infirme', 'retirer']);
const motif = z.string().trim().min(1).max(2000).optional();
const lienTiers = z.object({
  cleComptable: z.string().regex(/^aux:.{1,100}$/, 'clé de tiers comptable attendue (« aux:… »)'),
  clePiece: z.string().regex(/^(siren:\d{9}|tva:[A-Z0-9]{4,15}|nom:.{1,140})$/, 'clé de tiers de pièce attendue'),
  decision: decisionTri,
  motif,
});
const lienFacture = z.object({
  type: z.enum(['comptabilisation', 'imputation']),
  /** Clé de l'écriture : « JOURNAL|NUMÉRO ». */
  cible: z.string().min(3).max(300).regex(/^[^|]+\|.+$/, 'clé d’écriture attendue (« JOURNAL|NUMÉRO »)'),
  decision: decisionTri,
  montant: schemaChaineDecimale.optional(),
  motif,
});
const decisionSuspicion = z.object({ cle: z.string().min(3).max(1000).regex(/^[EP]:/, 'clé de suspicion attendue'), decision: decisionTri, motif });

function page(brute: string | undefined): number {
  if (brute !== undefined && !/^[1-9]\d{0,5}$/.test(brute)) throw new BadRequestException('Page invalide');
  return Number(brute ?? 1);
}
function paginer<T>(liste: T[], p: number, taille = TAILLE_PAGE) {
  return { elements: liste.slice((p - 1) * taille, p * taille), pagination: { page: p, taillePage: taille, total: liste.length, suite: liste.length > p * taille } };
}
const texte = (v: unknown): string | null => {
  const x = (v as { valeur?: unknown } | null | undefined)?.valeur;
  return typeof x === 'string' && x.trim() !== '' ? x.trim() : null;
};
const normaliser = (v: string): string => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Contexte {
  exercice: typeof s.exercices.$inferSelect;
  entite: typeof s.entites.$inferSelect;
  niveau: Niveau;
  lot: typeof s.lotsImport.$inferSelect | null;
  lignes: LigneEcriture[];
  resultat: ResultatTiersFactures;
  piecesEcartees: { horsExercice: number; extractionRejetee: number; sansExtraction: number; auDelaDuPlafond: number };
  entete: Record<string, unknown>;
}

@ApiTags('Tiers, factures et règlements (aide à la révision)')
@ApiBearerAuth()
@Controller('v1')
export class TiersController {
  constructor(@Inject(BD) private readonly bd: AccesBd, @Inject(CONFIG) private readonly cfg: Config) {}

  /**
   * Recalcule tout à partir des écritures du lot actif, des extractions en vigueur, des rapprochements bancaires validés
   * et des décisions enregistrées. Rien n'est mis en cache : le résultat ne peut pas diverger des données.
   */
  private async calculer(tx: Tx, budget: Budget, exerciceId: string, dateBrute: string | undefined, minimum: Niveau = 'lecture'): Promise<Contexte> {
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, exerciceId));
    if (!exercice) throw new NotFoundException('Exercice introuvable');
    const niveau = await exigerNiveau(tx, exercice.entiteId, minimum);
    const [entite] = await tx.select().from(s.entites).where(eq(s.entites.id, exercice.entiteId));
    if (!entite) throw new NotFoundException('Dossier introuvable');
    if (dateBrute !== undefined && !estDateIso(dateBrute)) throw new BadRequestException('date : AAAA-MM-JJ attendue');
    const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, exerciceId), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    // Plafonds de l'API (D-093), vérifiés AVANT toute lecture : lignes de l'exercice, puis pièces candidates (compte en base,
    // avec les mêmes écartements que la boucle ci-dessous : version courante, nature, extraction exploitable, exercice).
    const ecran = 'Suivi des tiers et factures';
    const lignes = lot ? ((await chargerLignes(tx, budget, this.cfg, { ecran, plafond: 'calcul', lot })).lignes as LigneEcriture[]) : [];
    const [{ n: candidates } = { n: 0 }] = (
      await tx.execute(sql`
        select count(*)::int as n
          from documents d join extractions x on x.document_id = d.id and x.actuelle
         where d.entite_id = ${entite.id}::uuid and d.nature in ('facture_achat', 'facture_vente', 'avoir') and d.remplace_par is null and d.statut not in ('quarantaine', 'rejete')
           and x.statut not in ('rejete', 'validation_invalidee')
           and (d.exercice_id = ${exercice.id}::uuid
                or (d.exercice_id is null and (nullif(trim(x.champs -> 'dateEmission' ->> 'valeur'), '') is null
                                                or trim(x.champs -> 'dateEmission' ->> 'valeur') !~ '^\d{4}-\d{2}-\d{2}$'
                                                or trim(x.champs -> 'dateEmission' ->> 'valeur') between ${exercice.debut} and ${exercice.fin})))`)
    ).rows as Array<{ n: number }>;
    if (candidates > this.cfg.API_PIECES_MAX_TIERS) {
      throw refusVolume({ ecran, objet: 'pièces (factures et avoirs) à suivre dans l’exercice', volume: candidates, plafond: this.cfg.API_PIECES_MAX_TIERS, variable: 'API_PIECES_MAX_TIERS', remede: 'Le suivi est recalculé en entier à chaque lecture : l’éditeur peut relever le plafond après avoir vérifié la mémoire de l’API.' });
    }

    // Pièces : version COURANTE seulement (une version remplacée n'est plus jamais la version de travail, D-031).
    const documents = await tx
      .select({ doc: s.documents, extraction: s.extractions })
      .from(s.documents)
      .leftJoin(s.extractions, and(eq(s.extractions.documentId, s.documents.id), eq(s.extractions.actuelle, true)))
      .where(and(eq(s.documents.entiteId, entite.id), inArray(s.documents.nature, ['facture_achat', 'facture_vente', 'avoir']), sql`${s.documents.remplacePar} is null`, sql`${s.documents.statut} not in ('quarantaine', 'rejete')`))
      .orderBy(s.documents.creeLe, s.documents.id);
    const piecesEcartees = { horsExercice: 0, extractionRejetee: 0, sansExtraction: 0, auDelaDuPlafond: 0 };
    const pieces: PieceFacture[] = [];
    for (const { doc, extraction } of documents) {
      if (!extraction) { piecesEcartees.sansExtraction++; continue; }
      if (extraction.statut === 'rejete' || extraction.statut === 'validation_invalidee') { piecesEcartees.extractionRejetee++; continue; }
      const c = extraction.champs as Partial<Record<keyof ChampsFacture, unknown>>;
      const emission = texte(c.dateEmission);
      const dansExercice = doc.exerciceId ? doc.exerciceId === exercice.id : emission === null || !estDateIso(emission) || (emission >= exercice.debut && emission <= exercice.fin);
      if (!dansExercice) { piecesEcartees.horsExercice++; continue; }
      // Garde de sécurité : le décompte en base ci-dessus a déjà refusé un volume au-dessus du plafond (écart possible seulement sur des dates impossibles).
      if (pieces.length >= this.cfg.API_PIECES_MAX_TIERS) throw refusVolume({ ecran, objet: 'pièces (factures et avoirs) à suivre dans l’exercice', volume: pieces.length + 1, plafond: this.cfg.API_PIECES_MAX_TIERS, variable: 'API_PIECES_MAX_TIERS' });
      const type = texte(c.typeDocument);
      const decimal = (v: unknown): string | null => { const t = texte(v); return t !== null && schemaChaineDecimale.safeParse(t).success ? t : null; };
      const date = (v: unknown): string | null => { const t = texte(v); return t !== null && estDateIso(t) ? t : null; };
      pieces.push({
        documentId: doc.id, nomFichier: doc.nomOrigine, versionPiece: doc.version, versionExtraction: extraction.version, nature: doc.nature as PieceFacture['nature'],
        statutExtraction: extraction.statut === 'valide' ? 'valide' : 'projet', typeDocument: type === 'facture' || type === 'avoir' || type === 'inconnu' ? type : null,
        numero: texte(c.numero), dateEmission: date(c.dateEmission), dateEcheance: date(c.dateEcheance), emetteurNom: texte(c.emetteurNom), emetteurSiren: texte(c.emetteurSiren), emetteurSiret: texte(c.emetteurSiret),
        emetteurTva: texte(c.emetteurTva), destinataireNom: texte(c.destinataireNom), destinataireSiren: texte(c.destinataireSiren), destinataireSiret: texte(c.destinataireSiret), destinataireTva: texte(c.destinataireTva),
        decisionsValablesDepuis: inchangeDepuis(c as Record<string, unknown>, extraction.version), totalHt: decimal(c.totalHt), totalTva: decimal(c.totalTva), totalTtc: decimal(c.totalTtc), devise: texte(c.devise),
      });
    }

    // Rapprochements bancaires VALIDÉS par un réviseur, sur le lot actif et non périmés : les propositions ne comptent pas.
    const rapprochementsValides: RapprochementValide[] = [];
    if (lot) {
      const valides = await tx
        .select({ id: s.rapprochements.id, ecritures: s.rapprochements.cotesEcritures, mouvements: s.rapprochements.cotesMouvements })
        .from(s.rapprochements)
        .innerJoin(s.executionsRapprochement, eq(s.executionsRapprochement.id, s.rapprochements.executionId))
        .where(and(eq(s.rapprochements.exerciceId, exerciceId), eq(s.rapprochements.statut, 'valide'), eq(s.executionsRapprochement.lotImportId, lot.id), eq(s.executionsRapprochement.obsolete, false)));
      const ids = [...new Set(valides.flatMap((v) => (v.mouvements as string[]).filter((x) => typeof x === 'string')))];
      const mouvements = new Map<string, { id: string; date: string; montant: string; libelle: string }>();
      for (let i = 0; i < ids.length; i += 5000) {
        for (const m of await tx
          .select({ id: s.mouvementsBancaires.id, date: s.mouvementsBancaires.dateOperation, montant: s.mouvementsBancaires.montant, libelle: s.mouvementsBancaires.libelle })
          .from(s.mouvementsBancaires)
          .where(inArray(s.mouvementsBancaires.id, ids.slice(i, i + 5000)))) mouvements.set(m.id, m);
      }
      for (const v of valides) rapprochementsValides.push({ id: v.id, lignesEcriture: v.ecritures as string[], mouvements: (v.mouvements as string[]).flatMap((id) => (mouvements.has(id) ? [mouvements.get(id)!] : [])) });
    }

    const decisionsTiers: DecisionTiers[] = (await tx.select().from(s.liensTiers).where(eq(s.liensTiers.entiteId, entite.id))).map((d) => ({ cleComptable: d.cleComptable, clePiece: d.clePiece, decision: d.decision as 'confirme' | 'infirme' }));
    const decisionsFactures: DecisionFacture[] = (await tx.select().from(s.liensFactures).where(eq(s.liensFactures.exerciceId, exerciceId))).map((d) => ({
      type: d.type as DecisionFacture['type'], objet: d.objet, cible: d.cible, decision: d.decision as 'confirme' | 'infirme', montant: d.montant, versionExtraction: d.versionExtraction,
    }));

    const dateAppreciation = dateBrute ?? exercice.fin;
    const resultat = suivreTiersEtFactures({
      lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, dateAppreciation, origineDateAppreciation: dateBrute === undefined ? 'cloture_exercice' : 'fournie', deviseDossier: entite.devise, sirenDossier: entite.siren,
      pieces, rapprochementsValides, decisionsTiers, decisionsFactures,
    });
    const reserves = [...resultat.reserves];
    if (!lot) reserves.push('Aucune donnée comptable importée pour cet exercice : aucun tiers comptable, aucun appariement, aucun règlement ne peut être établi.');
    return {
      exercice, entite, niveau, lot: lot ?? null, lignes, resultat, piecesEcartees,
      entete: {
        niveau,
        exercice: { id: exercice.id, entiteId: entite.id, debut: exercice.debut, fin: exercice.fin, versionDonnees: exercice.versionDonnees },
        donnees: lot ? { lotImportId: lot.id, version: lot.version, statutDonnees: lot.statutDonnees } : null,
        dateAppreciation: resultat.dateAppreciation,
        origineDateAppreciation: resultat.origineDateAppreciation,
        devise: resultat.devise,
        nature: 'aide_a_la_revision',
        reserves,
        piecesEcartees,
      },
    };
  }

  private resumeFacture(f: FicheFacture, tiersNom: string | null) {
    return {
      id: f.id, nomFichier: f.nomFichier, type: f.type, sens: f.sens, numero: f.numero, dateEmission: f.dateEmission, dateEcheance: f.dateEcheance, montant: f.montant, devise: f.devise, statutExtraction: f.statutExtraction,
      tiersCle: f.tiersCle, tiersNom: tiersNom ?? f.tiersPiece?.nom ?? null, comptabilisation: f.comptabilisation.statut, montantRegle: f.montantRegle, resteDu: f.resteDu, etat: f.etat, motifEtat: f.motifEtat, echue: f.echue,
      joursDeRetard: f.joursDeRetard, nbSuspicions: f.suspicions.length, nbPropositions: f.comptabilisation.propositions.length + f.propositionsImputation.length,
    };
  }

  @Get('exercices/:id/tiers')
  @ApiRefusVolume()
  @ApiQuery({ name: 'q', required: false, description: 'Recherche dans le nom, le compte auxiliaire et les identifiants' })
  @ApiQuery({ name: 'type', required: false, enum: TYPES_TIERS })
  @ApiQuery({ name: 'date', required: false, description: 'Date d’appréciation AAAA-MM-JJ ; par défaut, la clôture de l’exercice' })
  @ApiQuery({ name: 'page', required: false })
  @ApiOperation({
    summary: 'Référentiel des tiers du dossier, RECALCULÉ à partir des comptes auxiliaires des écritures et des émetteurs lus sur les pièces',
    description:
      'Aide à la révision. Les soldes et mouvements sont tirés des écritures du lot actif à chaque lecture : rien n’est stocké, rien ne peut diverger. Un tiers de pièce n’est rattaché à un tiers comptable que par un identifiant fort (SIREN) ou par la confirmation d’une personne ; le rapprochement par nom n’est qu’une proposition ; les homonymes sont signalés et jamais fusionnés. Pages de 50.',
  })
  async tiers(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('q') q?: string, @Query('type') type?: string, @Query('date') date?: string, @Query('page') pageBrute?: string) {
    exigerUuid(id);
    const p = page(pageBrute);
    if (type !== undefined && !(TYPES_TIERS as readonly string[]).includes(type)) throw new BadRequestException('type inconnu');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, date);
      const recherche = normaliser((q ?? '').trim().slice(0, 100));
      const tous = c.resultat.tiers;
      const parType: Record<string, number> = {};
      for (const t of tous) parType[t.type] = (parType[t.type] ?? 0) + 1;
      const filtres = tous.filter(
        (t) => (type === undefined || t.type === type) && (recherche === '' || normaliser(`${t.nom} ${t.compteAuxiliaire ?? ''} ${t.libelles.join(' ')} ${t.identifiants.map((i) => i.valeur).join(' ')}`).includes(recherche)),
      );
      const { elements, pagination } = paginer(filtres, p);
      return {
        ...c.entete,
        pagination: { ...pagination, parType, totalSansFiltre: tous.length },
        nbPropositions: c.resultat.propositionsTiers.length,
        tiers: elements.map((t) => ({ ...t, nbPieces: t.pieces.length, pieces: undefined })),
      };
    });
  }

  @Get('exercices/:id/tiers/fiche')
  @ApiRefusVolume()
  @ApiQuery({ name: 'cle', required: true, description: 'Clé du tiers (« aux:… », « general:… » ou « piece:… »)' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'page', required: false, description: 'Page des mouvements (100 lignes)' })
  @ApiOperation({ summary: 'Fiche d’un tiers : identifiants et leur origine, solde et mouvements de l’exercice (écritures), factures et pièces rattachées, propositions à confirmer' })
  async fiche(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('cle') cle?: string, @Query('date') date?: string, @Query('page') pageBrute?: string) {
    exigerUuid(id);
    const p = page(pageBrute);
    if (typeof cle !== 'string' || cle.length < 3 || cle.length > 300) throw new BadRequestException('cle attendue');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, date);
      const fiche = c.resultat.tiers.find((t) => t.cle === cle);
      if (!fiche) throw new NotFoundException('Tiers introuvable dans les données actuelles');
      const prefixes = [...c.resultat.parametres.prefixesFournisseurs, ...c.resultat.parametres.prefixesClients];
      const mouvements = fiche.origine === 'comptable'
        ? c.lignes.filter((l) => prefixes.some((x) => l.compteNum.startsWith(x)) && (fiche.sansAuxiliaire ? !l.compAuxNum?.trim() && `general:${l.compteNum}` === cle : `aux:${l.compAuxNum?.trim() ?? ''}` === cle))
        : [];
      const { elements, pagination } = paginer(mouvements, p, 100);
      const factures = c.resultat.factures.filter((f) => f.tiersCle === cle);
      return {
        ...c.entete,
        tiers: fiche,
        mouvements: elements.map((l) => ({ id: l.id, cle: cleEcriture(l), journalCode: l.journalCode, ecritureNum: l.ecritureNum, date: l.ecritureDate, compteNum: l.compteNum, pieceRef: l.pieceRef, libelle: l.ecritureLib, debit: l.debit, credit: l.credit, lettrage: l.ecritureLet })),
        paginationMouvements: pagination,
        factures: factures.map((f) => this.resumeFacture(f, fiche.nom)),
        resteDuTotal: versChaine(factures.reduce((t, f) => (f.type === 'facture' && f.resteDu !== null ? t.plus(dec(f.resteDu)) : t), dec('0.00'))),
        propositions: c.resultat.propositionsTiers.filter((x) => `piece:${x.clePiece}` === cle || x.candidats.some((k) => k.cle === cle)),
      };
    });
  }

  @Get('exercices/:id/factures')
  @ApiRefusVolume()
  @ApiQuery({ name: 'etat', required: false, enum: ETATS })
  @ApiQuery({ name: 'tiers', required: false, description: 'Clé d’un tiers' })
  @ApiQuery({ name: 'q', required: false, description: 'Recherche dans le numéro, le nom du fichier et le nom du tiers' })
  @ApiQuery({ name: 'date', required: false, description: 'Date d’appréciation AAAA-MM-JJ ; par défaut, la clôture de l’exercice (jamais la date du jour en silence)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiOperation({
    summary: 'Échéancier des factures et avoirs suivis : échéance, règlements identifiés, reste dû et état à la date d’appréciation',
    description:
      'États : non échue, échue non réglée, partiellement réglée, réglée, trop-perçu, non déterminable (avec son motif) ; pour un avoir : imputé, partiellement imputé, non imputé. Une échéance absente n’est jamais inventée ; sans écriture identifiée, l’état est « non déterminable ». Triées par échéance (les échéances inconnues en dernier). Décomptes et restes dus calculés sur TOUT le filtre, pas sur la page. Pages de 50.',
  })
  async factures(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('etat') etat?: string, @Query('tiers') tiers?: string, @Query('q') q?: string, @Query('date') date?: string, @Query('page') pageBrute?: string) {
    exigerUuid(id);
    const p = page(pageBrute);
    if (etat !== undefined && !(ETATS as readonly string[]).includes(etat)) throw new BadRequestException('etat inconnu');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, date);
      const noms = new Map(c.resultat.tiers.map((t) => [t.cle, t.nom]));
      const recherche = normaliser((q ?? '').trim().slice(0, 100));
      const horsEtat = c.resultat.factures.filter(
        (f) => (tiers === undefined || f.tiersCle === tiers) && (recherche === '' || normaliser(`${f.numero ?? ''} ${f.nomFichier} ${(f.tiersCle && noms.get(f.tiersCle)) || ''} ${f.tiersPiece?.nom ?? ''}`).includes(recherche)),
      );
      const parEtat: Record<string, { n: number; resteDu: string }> = {};
      for (const f of horsEtat) {
        const e = (parEtat[f.etat] ??= { n: 0, resteDu: '0.00' });
        e.n++;
        if (f.type === 'facture' && f.resteDu !== null) e.resteDu = versChaine(dec(e.resteDu).plus(dec(f.resteDu)));
      }
      const filtrees = horsEtat.filter((f) => etat === undefined || f.etat === etat).sort((a, b) => (a.dateEcheance ?? '9999').localeCompare(b.dateEcheance ?? '9999') || (a.dateEmission ?? '9999').localeCompare(b.dateEmission ?? '9999') || a.id.localeCompare(b.id));
      const { elements, pagination } = paginer(filtrees, p);
      return { ...c.entete, pagination: { ...pagination, parEtat, totalSansFiltre: c.resultat.factures.length }, factures: elements.map((f) => this.resumeFacture(f, (f.tiersCle && noms.get(f.tiersCle)) || null)) };
    });
  }

  @Get('exercices/:id/factures/:documentId')
  @ApiRefusVolume()
  @ApiQuery({ name: 'date', required: false })
  @ApiOperation({ summary: 'Détail d’une facture ou d’un avoir : pièce, écriture de comptabilisation et critères, règlements et avoirs imputés avec leur preuve bancaire, propositions à confirmer, suspicions' })
  async facture(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('documentId') documentId: string, @Query('date') date?: string) {
    exigerUuid(id);
    exigerUuid(documentId, 'documentId');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, date);
      const f = c.resultat.factures.find((x) => x.id === documentId);
      if (!f) throw new NotFoundException('Facture introuvable : la pièce n’est pas suivie sur cet exercice (remplacée, hors exercice, extraction rejetée ou nature autre)');
      const tiers = f.tiersCle ? (c.resultat.tiers.find((t) => t.cle === f.tiersCle) ?? null) : null;
      const cles = new Set([f.comptabilisation.ecriture?.cle, ...f.comptabilisation.propositions.map((x) => x.ecriture.cle)].filter((x): x is string => !!x));
      const lignesEcritures: Record<string, unknown[]> = {};
      for (const l of c.lignes) {
        const k = cleEcriture(l);
        if (cles.has(k)) (lignesEcritures[k] ??= []).push({ id: l.id, compteNum: l.compteNum, compteLib: l.compteLib, compAuxNum: l.compAuxNum, libelle: l.ecritureLib, debit: l.debit, credit: l.credit, lettrage: l.ecritureLet });
      }
      const decisions = await tx
        .select({ type: s.liensFactures.type, cible: s.liensFactures.cible, decision: s.liensFactures.decision, montant: s.liensFactures.montant, motif: s.liensFactures.motif, versionExtraction: s.liensFactures.versionExtraction, creeLe: s.liensFactures.creeLe, auteur: s.utilisateurs.nom })
        .from(s.liensFactures)
        .innerJoin(s.utilisateurs, eq(s.utilisateurs.id, s.liensFactures.decidePar))
        .where(and(eq(s.liensFactures.exerciceId, id), eq(s.liensFactures.objet, documentId)));
      return {
        ...c.entete,
        facture: f,
        tiers: tiers && { cle: tiers.cle, nom: tiers.nom, type: tiers.type, compteAuxiliaire: tiers.compteAuxiliaire },
        lignesEcritures,
        suspicions: c.resultat.suspicions.filter((x) => f.suspicions.includes(x.cle)),
        decisions,
      };
    });
  }

  @Get('exercices/:id/tiers-factures/a-traiter')
  @ApiRefusVolume()
  @ApiQuery({ name: 'date', required: false })
  @ApiOperation({
    summary: 'Ce qui attend une personne : rapprochements de tiers proposés, liens pièce ↔ écriture à confirmer ou ambigus, règlements proposés, suspicions de double comptabilisation, décisions à revoir',
    description:
      'La suspicion de double comptabilisation (une même facture — même tiers, même numéro, même montant — portée par plusieurs écritures, ou deux pièces distinctes portant la même facture) est distincte du doublon binaire (même fichier reçu deux fois) et de la nouvelle version d’une pièce. Chaque liste est plafonnée à 200 éléments ; les totaux portent sur l’ensemble.',
  })
  async aTraiter(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('date') date?: string) {
    exigerUuid(id);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, date);
      const r = c.resultat;
      const noms = new Map(r.tiers.map((t) => [t.cle, t.nom]));
      const liens = r.factures.filter((f) => f.comptabilisation.statut === 'a_confirmer' || f.comptabilisation.statut === 'ambigu');
      const reglements = r.factures.filter((f) => f.propositionsImputation.length > 0);
      const PLAFOND = 200;
      return {
        ...c.entete,
        totaux: {
          propositionsTiers: r.propositionsTiers.length, liensAConfirmer: liens.length, reglementsProposes: reglements.length, suspicions: r.suspicions.length,
          suspicionsAExaminer: r.suspicions.filter((x) => x.statut === 'a_examiner').length, decisionsARevoir: r.decisionsARevoir.length,
        },
        propositionsTiers: r.propositionsTiers.slice(0, PLAFOND),
        liensAConfirmer: liens.slice(0, PLAFOND).map((f) => ({ ...this.resumeFacture(f, (f.tiersCle && noms.get(f.tiersCle)) || null), motif: f.comptabilisation.motif, propositions: f.comptabilisation.propositions })),
        reglementsProposes: reglements.slice(0, PLAFOND).map((f) => ({ ...this.resumeFacture(f, (f.tiersCle && noms.get(f.tiersCle)) || null), propositions: f.propositionsImputation })),
        suspicions: r.suspicions.slice(0, PLAFOND),
        decisionsARevoir: r.decisionsARevoir.slice(0, PLAFOND),
      };
    });
  }

  /** Niveau exigé : collaboration pour confirmer une proposition ; révision pour infirmer ou retirer une décision. */
  private exigerPour(niveau: Niveau, decision: 'confirme' | 'infirme' | 'retirer', motifDonne: string | undefined): void {
    if (decision !== 'confirme' && !auMoins(niveau, 'revision')) throw new ForbiddenException('Infirmer ou retirer une décision est réservé au niveau révision');
    if (decision === 'infirme' && !motifDonne) throw new BadRequestException('Un motif est requis pour infirmer');
  }

  @Put('exercices/:id/tiers/liens')
  @ApiRefusVolume()
  @ApiBody({ schema: schemaOpenApi(lienTiers) })
  @ApiOperation({
    summary: 'Confirmer (collaboration), infirmer ou retirer (révision) le rattachement d’un tiers de pièce à un tiers comptable',
    description: 'La décision vaut pour le dossier (tous exercices). Elle ne modifie aucune écriture et aucune pièce ; elle est journalisée. Un motif est requis pour infirmer.',
  })
  async decider(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(lienTiers, corps);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, undefined, 'collaboration');
      this.exigerPour(c.niveau, d.decision, d.motif);
      const cible = and(eq(s.liensTiers.entiteId, c.entite.id), eq(s.liensTiers.cleComptable, d.cleComptable), eq(s.liensTiers.clePiece, d.clePiece));
      if (d.decision === 'retirer') {
        const retires = await tx.delete(s.liensTiers).where(cible).returning({ id: s.liensTiers.id });
        if (retires.length === 0) throw new NotFoundException('Aucune décision enregistrée pour ce couple');
      } else {
        const comptable = c.resultat.tiers.find((t) => t.cle === d.cleComptable && t.origine === 'comptable');
        if (!comptable) throw new NotFoundException('Tiers comptable introuvable dans les écritures actuelles');
        const connu = c.resultat.tiers.some((t) => t.cle === `piece:${d.clePiece}` || t.tiersPieces.some((x) => x.cle === d.clePiece)) || c.resultat.propositionsTiers.some((x) => x.clePiece === d.clePiece);
        if (!connu) throw new NotFoundException('Tiers de pièce introuvable dans les pièces actuelles');
        await tx
          .insert(s.liensTiers)
          .values({ cabinetId: acces.cabinetId, entiteId: c.entite.id, cleComptable: d.cleComptable, clePiece: d.clePiece, decision: d.decision, motif: d.motif ?? null, decidePar: acces.utilisateurId })
          .onConflictDoUpdate({ target: [s.liensTiers.entiteId, s.liensTiers.cleComptable, s.liensTiers.clePiece], set: { decision: d.decision, motif: d.motif ?? null, decidePar: acces.utilisateurId, creeLe: sql`now()` } });
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `tiers.lien_${d.decision}`, cibleType: 'exercice', cibleId: id, entiteId: c.entite.id, details: { cleComptable: d.cleComptable, clePiece: d.clePiece } });
      return { cleComptable: d.cleComptable, clePiece: d.clePiece, decision: d.decision };
    });
  }

  @Put('exercices/:id/factures/:documentId/liens')
  @ApiRefusVolume()
  @ApiBody({ schema: schemaOpenApi(lienFacture) })
  @ApiOperation({
    summary: 'Confirmer (collaboration), infirmer ou retirer (révision) le lien d’une facture avec l’écriture qui la comptabilise ou avec une écriture de règlement ou d’avoir',
    description:
      'Rien n’est comptabilisé ni lettré : la décision n’existe que dans cet outil d’aide à la révision. Elle porte sur la version courante de la pièce et de son extraction : une nouvelle version de la pièce ou une correction des champs la rend « à revoir » et elle n’est plus appliquée. Un motif est requis pour infirmer.',
  })
  async lier(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('documentId') documentId: string, @Body() corps: unknown) {
    exigerUuid(id);
    exigerUuid(documentId, 'documentId');
    const d = valider(lienFacture, corps);
    if (d.montant !== undefined && (d.type !== 'imputation' || d.decision !== 'confirme' || !dec(d.montant).greaterThan(0))) throw new BadRequestException('montant : seulement pour confirmer une imputation, strictement positif');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, undefined, 'collaboration');
      this.exigerPour(c.niveau, d.decision, d.motif);
      const cible = and(eq(s.liensFactures.exerciceId, id), eq(s.liensFactures.type, d.type), eq(s.liensFactures.objet, documentId), eq(s.liensFactures.cible, d.cible));
      if (d.decision === 'retirer') {
        const retires = await tx.delete(s.liensFactures).where(cible).returning({ id: s.liensFactures.id });
        if (retires.length === 0) throw new NotFoundException('Aucune décision enregistrée pour ce lien');
      } else {
        const f = c.resultat.factures.find((x) => x.id === documentId);
        if (!f) throw new NotFoundException('Facture introuvable : la pièce n’est pas suivie sur cet exercice');
        const p = c.resultat.parametres;
        const lignesTiers = c.lignes.filter((l) => cleEcriture(l) === d.cible && [...p.prefixesFournisseurs, ...p.prefixesClients].some((x) => l.compteNum.startsWith(x)));
        if (lignesTiers.length === 0) throw new NotFoundException('Écriture introuvable dans les données actuelles, ou sans ligne de compte de tiers');
        if (d.type === 'comptabilisation' && d.decision === 'confirme') {
          if (f.montant === null) throw new ConflictException('Le total TTC de la pièce n’est pas lu : corrigez l’extraction avant de confirmer un lien');
          if (f.comptabilisation.statut === 'non_recherche') throw new ConflictException(f.comptabilisation.motif ?? 'Cette pièce n’est pas traitée');
        }
        if (d.type === 'imputation' && d.decision === 'confirme') {
          const e = f.comptabilisation.ecriture;
          if (!e) throw new ConflictException('L’écriture qui comptabilise cette facture n’est pas établie : confirmez-la d’abord');
          if (e.lettrage !== null) throw new ConflictException('Cette facture est lettrée dans la comptabilité : ses règlements sont ceux du lettrage');
          if (e.cle === d.cible) throw new ConflictException('Une écriture ne peut pas régler la facture qu’elle comptabilise');
          if (!lignesTiers.some((l) => l.compteNum === e.compteNum && (l.compAuxNum?.trim() || null) === e.compAuxNum && l.ecritureLet === null)) throw new ConflictException('Cette écriture ne mouvemente pas, sans lettrage, le compte du tiers de la facture');
        }
        const valeurs = { decision: d.decision, montant: d.montant ?? null, motif: d.motif ?? null, versionExtraction: f.versionExtraction, versionDonnees: c.exercice.versionDonnees, decidePar: acces.utilisateurId };
        await tx
          .insert(s.liensFactures)
          .values({ cabinetId: acces.cabinetId, entiteId: c.entite.id, exerciceId: id, type: d.type, objet: documentId, documentId, cible: d.cible, ...valeurs })
          .onConflictDoUpdate({ target: [s.liensFactures.exerciceId, s.liensFactures.type, s.liensFactures.objet, s.liensFactures.cible], set: { ...valeurs, creeLe: sql`now()` } });
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `facture.${d.type}_${d.decision}`, cibleType: 'document', cibleId: documentId, entiteId: c.entite.id, details: { exerciceId: id, cible: d.cible, montant: d.montant ?? null } });
      // État recalculé après la décision, pour que l'appelant voie immédiatement son effet.
      const apres = (await this.calculer(tx, budget, id, undefined, 'collaboration')).resultat.factures.find((x) => x.id === documentId);
      return { documentId, type: d.type, cible: d.cible, decision: d.decision, facture: apres ? this.resumeFacture(apres, null) : null };
    });
  }

  @Put('exercices/:id/suspicions')
  @ApiRefusVolume()
  @ApiBody({ schema: schemaOpenApi(decisionSuspicion) })
  @ApiOperation({
    summary: 'Statuer sur une suspicion de double comptabilisation (niveau révision) : confirmée, écartée (motif requis) ou décision retirée',
    description: 'Confirmer ne corrige rien : la correction se fait dans le logiciel de production comptable. Écarter exige un motif (opérations répétées légitimes, par exemple).',
  })
  async statuer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(decisionSuspicion, corps);
    if (d.decision === 'infirme' && !d.motif) throw new BadRequestException('Un motif est requis pour écarter une suspicion');
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const c = await this.calculer(tx, budget, id, undefined, 'revision');
      const cible = and(eq(s.liensFactures.exerciceId, id), eq(s.liensFactures.type, 'suspicion'), eq(s.liensFactures.objet, d.cle), eq(s.liensFactures.cible, 'suspicion'));
      if (d.decision === 'retirer') {
        const retires = await tx.delete(s.liensFactures).where(cible).returning({ id: s.liensFactures.id });
        if (retires.length === 0) throw new NotFoundException('Aucune décision enregistrée pour cette suspicion');
      } else {
        if (!c.resultat.suspicions.some((x) => x.cle === d.cle)) throw new NotFoundException('Suspicion introuvable dans les données actuelles');
        const valeurs = { decision: d.decision, motif: d.motif ?? null, versionDonnees: c.exercice.versionDonnees, decidePar: acces.utilisateurId };
        await tx
          .insert(s.liensFactures)
          .values({ cabinetId: acces.cabinetId, entiteId: c.entite.id, exerciceId: id, type: 'suspicion', objet: d.cle, documentId: null, cible: 'suspicion', ...valeurs })
          .onConflictDoUpdate({ target: [s.liensFactures.exerciceId, s.liensFactures.type, s.liensFactures.objet, s.liensFactures.cible], set: { ...valeurs, creeLe: sql`now()` } });
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `suspicion.${d.decision}`, cibleType: 'exercice', cibleId: id, entiteId: c.entite.id, details: { cle: d.cle.slice(0, 500) } });
      return { cle: d.cle, statut: d.decision === 'confirme' ? 'confirmee' : d.decision === 'infirme' ? 'ecartee' : 'a_examiner' };
    });
  }
}
