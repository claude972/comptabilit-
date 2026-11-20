import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { calculerBalance, dec, type LigneEcriture, schemaChaineDecimale, somme, versChaine } from '@comtaple/core';
import { type AccesBd, and, asc, eq, inArray, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Config } from '@comtaple/plateforme';
import type { Response } from 'express';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD, CONFIG } from './jetons.js';
import { avecCalcul, chargerLignes, ApiRefusVolume } from './plafonds.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');
const ligne = z.object({
  compteNum: z.string().regex(/^[1-7]\d{2,11}$/, 'numéro de compte du PCG attendu (classes 1 à 7, 3 chiffres au moins)'),
  compteLib: z.string().min(1).max(200),
  debit: schemaChaineDecimale,
  credit: schemaChaineDecimale,
});
const proposition = z.object({
  dateEcriture: dateIso,
  libelle: z.string().min(1).max(200),
  justification: z.string().min(10).max(4000),
  calcul: z.string().min(3).max(4000),
  pieces: z.array(uuid).max(50).default([]),
  lignes: z.array(ligne).min(2).max(200),
});
const decision = z.object({ decision: z.enum(['approuver', 'rejeter']), motif: z.string().min(1).max(2000).optional() });
type LigneProposee = z.infer<typeof ligne>;

/** Convertit des écritures d'inventaire approuvées en lignes au format du moteur (journal « INV »), sans toucher aux importées. */
function versLignes(ecritures: Array<typeof s.ecrituresInventaire.$inferSelect>): LigneEcriture[] {
  let n = 0;
  return ecritures.flatMap((e) =>
    (e.lignes as LigneProposee[]).map((l) => ({
      id: `${e.id}:${n}`,
      numeroLigne: 1_000_000_000 + n++,
      journalCode: 'INV',
      journalLib: 'Écritures d’inventaire proposées',
      ecritureNum: `INV-${e.id.slice(0, 8)}`,
      ecritureDate: e.dateEcriture,
      compteNum: l.compteNum,
      compteLib: l.compteLib,
      compAuxNum: null,
      compAuxLib: null,
      pieceRef: `INV-${e.id.slice(0, 8)}`,
      pieceDate: e.dateEcriture,
      ecritureLib: e.libelle,
      debit: l.debit,
      credit: l.credit,
      ecritureLet: null,
      dateLet: null,
      validDate: null,
      montantDevise: null,
      idevise: null,
    })),
  );
}

@ApiTags('Écritures d’inventaire')
@ApiBearerAuth()
@Controller('v1')
export class InventaireController {
  constructor(@Inject(BD) private readonly bd: AccesBd, @Inject(CONFIG) private readonly cfg: Config) {}

  private async exercice(tx: Tx, id: string, minimum: Parameters<typeof exigerNiveau>[2]) {
    const [ex] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
    if (!ex) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, ex.entiteId, minimum);
    return ex;
  }

  @Post('exercices/:id/ecritures-inventaire')
  @ApiOperation({
    summary: 'Proposer une écriture d’inventaire (projet)',
    description:
      'L’écriture doit être équilibrée (vérifié par le moteur, en décimal exact), datée dans l’exercice, justifiée, avec le détail de son calcul. Elle reste séparée des écritures importées et n’a aucun effet tant qu’elle n’est pas approuvée.',
  })
  @ApiBody({ schema: schemaOpenApi(proposition) })
  async proposer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(proposition, corps);
    for (const l of d.lignes) {
      const debit = dec(l.debit);
      const credit = dec(l.credit);
      if (debit.isNegative() || credit.isNegative()) throw new BadRequestException('Montants négatifs interdits : inversez le sens');
      if (debit.isZero() === credit.isZero()) throw new BadRequestException('Chaque ligne porte un montant au débit OU au crédit');
    }
    const totalDebit = somme(d.lignes.map((l) => l.debit));
    const totalCredit = somme(d.lignes.map((l) => l.credit));
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException({ message: 'Écriture déséquilibrée', totalDebit: versChaine(totalDebit), totalCredit: versChaine(totalCredit), ecart: versChaine(totalDebit.minus(totalCredit)) });
    }
    return this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'collaboration');
      if (d.dateEcriture < ex.debut || d.dateEcriture > ex.fin) throw new BadRequestException('La date de l’écriture doit être dans l’exercice');
      if (d.pieces.length) {
        const trouvees = await tx.select({ id: s.documents.id, entiteId: s.documents.entiteId }).from(s.documents).where(inArray(s.documents.id, d.pieces));
        if (trouvees.length !== new Set(d.pieces).size || trouvees.some((p) => p.entiteId !== ex.entiteId)) throw new BadRequestException('Une pièce jointe n’appartient pas à ce dossier');
      }
      const [e] = await tx
        .insert(s.ecrituresInventaire)
        .values({ cabinetId: acces.cabinetId, entiteId: ex.entiteId, exerciceId: id, dateEcriture: d.dateEcriture, libelle: d.libelle, justification: d.justification, calcul: d.calcul, pieces: d.pieces, lignes: d.lignes.map((l) => ({ ...l, debit: versChaine(dec(l.debit)), credit: versChaine(dec(l.credit)) })), totalDebit: versChaine(totalDebit), versionDonnees: ex.versionDonnees, proposeePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'ecriture_inventaire.proposee', cibleType: 'ecriture_inventaire', cibleId: e!.id, entiteId: ex.entiteId, details: { total: versChaine(totalDebit) } });
      return e;
    });
  }

  @Get('exercices/:id/ecritures-inventaire')
  @ApiOperation({ summary: 'Écritures d’inventaire proposées pour un exercice, avec leur statut (proposée, approuvée, rejetée, exportée)' })
  async lister(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'lecture');
      const liste = await tx.select().from(s.ecrituresInventaire).where(eq(s.ecrituresInventaire.exerciceId, id)).orderBy(asc(s.ecrituresInventaire.creeLe));
      // Une proposition faite sur une version antérieure des données importées est signalée « à revoir ».
      const idsPieces = [...new Set(liste.flatMap((e) => e.pieces as string[]))];
      const docs = idsPieces.length ? await tx.select({ id: s.documents.id, nomOrigine: s.documents.nomOrigine, statut: s.documents.statut, version: s.documents.version }).from(s.documents).where(inArray(s.documents.id, idsPieces)) : [];
      const parId = new Map(docs.map((d) => [d.id, d]));
      const personnes = [...new Set(liste.flatMap((e) => [e.proposeePar, e.decideePar]).filter((x): x is string => Boolean(x)))];
      const noms = personnes.length ? await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, personnes)) : [];
      const nomDe = new Map(noms.map((n) => [n.id, n.nom]));
      return liste.map((e) => ({
        ...e,
        aRevoir: e.versionDonnees !== ex.versionDonnees,
        proposeeParNom: nomDe.get(e.proposeePar) ?? null,
        decideeParNom: e.decideePar ? (nomDe.get(e.decideePar) ?? null) : null,
        piecesJointes: (e.pieces as string[]).map((p) => parId.get(p) ?? { id: p, nomOrigine: null, statut: null, version: null }),
      }));
    });
  }

  @Post('ecritures-inventaire/:id/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuver ou rejeter une écriture proposée (réviseur habilité, autre que son auteur ; motif requis pour un rejet)' })
  @ApiBody({ schema: schemaOpenApi(decision) })
  async decider(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(decision, corps);
    if (d.decision === 'rejeter' && !d.motif) throw new BadRequestException('Un motif est requis pour rejeter');
    return this.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx.select().from(s.ecrituresInventaire).where(eq(s.ecrituresInventaire.id, id)).for('update');
      if (!e) throw new NotFoundException('Écriture introuvable');
      await exigerNiveau(tx, e.entiteId, 'revision');
      if (e.statut !== 'proposee') throw new ConflictException(`Écriture au statut « ${e.statut} »`);
      if (e.proposeePar === acces.utilisateurId) throw new ForbiddenException('Une écriture ne peut pas être approuvée ou rejetée par la personne qui l’a proposée');
      const [ex] = await tx.select().from(s.exercices).where(eq(s.exercices.id, e.exerciceId));
      if (d.decision === 'approuver' && ex && ex.versionDonnees !== e.versionDonnees) throw new ConflictException('Les données importées ont changé depuis cette proposition : elle doit être revue et proposée à nouveau');
      const [maj] = await tx
        .update(s.ecrituresInventaire)
        .set({ statut: d.decision === 'approuver' ? 'approuvee' : 'rejetee', decideePar: acces.utilisateurId, decideeLe: sql`now()`, motifDecision: d.motif ?? null })
        .where(eq(s.ecrituresInventaire.id, id))
        .returning();
      await tx.insert(s.decisions).values({ cabinetId: acces.cabinetId, entiteId: e.entiteId, cibleType: 'ecriture_inventaire', cibleId: id, versionCible: e.versionDonnees, action: d.decision, motif: d.motif ?? null, auteurId: acces.utilisateurId });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `ecriture_inventaire.${d.decision === 'approuver' ? 'approuvee' : 'rejetee'}`, cibleType: 'ecriture_inventaire', cibleId: id, entiteId: e.entiteId });
      return maj;
    });
  }

  @Get('exercices/:id/balance-ajustee')
  @ApiRefusVolume()
  @ApiOperation({
    summary: 'Balance ajustée de TRAVAIL : écritures importées + écritures d’inventaire approuvées',
    description: 'Les deux balances sont restituées côte à côte, avec la liste des écritures prises en compte et l’impact sur le résultat. Les écritures seulement proposées ou rejetées ne comptent pas. Document de travail, non validé.',
  })
  async balanceAjustee(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const ex = await this.exercice(tx, id, 'lecture');
      const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice');
      // Plafond de l'API (D-093) : cette route n'en avait aucun avant.
      const { lignes: importees } = await chargerLignes(tx, budget, this.cfg, { ecran: 'Balance ajustée', plafond: 'calcul', lot });
      const approuvees = await tx.select().from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), inArray(s.ecrituresInventaire.statut, ['approuvee', 'exportee'])));
      const aJour = approuvees.filter((e) => e.versionDonnees === ex.versionDonnees);
      const balanceImportee = calculerBalance(importees);
      const balanceAjustee = calculerBalance([...importees, ...versLignes(aJour)]);
      // Résultat = produits (classe 7) − charges (classe 6), lu sur chaque balance.
      const resultat = (b: typeof balanceImportee) =>
        versChaine(
          b.lignes.reduce((t, l) => (l.compteNum.startsWith('7') ? t.plus(dec(l.soldeCrediteur)).minus(dec(l.soldeDebiteur)) : l.compteNum.startsWith('6') ? t.minus(dec(l.soldeDebiteur)).plus(dec(l.soldeCrediteur)) : t), dec('0')),
        );
      return {
        mention: 'PROJET — balance de travail. Les écritures d’inventaire sont des propositions approuvées en interne ; elles ne sont pas intégrées dans le logiciel comptable.',
        exercice: ex,
        ecrituresPrisesEnCompte: aJour.map((e) => ({ id: e.id, libelle: e.libelle, dateEcriture: e.dateEcriture, total: e.totalDebit, statut: e.statut })),
        ecrituresEcarteesCarDonneesModifiees: approuvees.length - aJour.length,
        balanceImportee,
        balanceAjustee,
        impact: { resultatAvant: resultat(balanceImportee), resultatApres: resultat(balanceAjustee), variation: versChaine(dec(resultat(balanceAjustee)).minus(dec(resultat(balanceImportee)))) },
      };
    });
  }

  @Post('exercices/:id/ecritures-inventaire/export')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exporter les écritures approuvées (CSV) et les marquer « exportées »',
    description: 'Exporter n’est pas intégrer : le fichier est remis à l’utilisateur, qui l’importe lui-même dans son logiciel comptable. Aucune transmission automatique.',
  })
  async exporter(@AccesCourant() acces: Acces, @Param('id') id: string, @Res() res: Response) {
    exigerUuid(id);
    const { csv, n } = await this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'revision');
      const liste = await tx.select().from(s.ecrituresInventaire).where(and(eq(s.ecrituresInventaire.exerciceId, id), inArray(s.ecrituresInventaire.statut, ['approuvee', 'exportee']))).orderBy(asc(s.ecrituresInventaire.dateEcriture), asc(s.ecrituresInventaire.creeLe));
      const aJour = liste.filter((e) => e.versionDonnees === ex.versionDonnees);
      if (!aJour.length) throw new ConflictException('Aucune écriture approuvée à exporter');
      const champ = (v: string) => (/[";\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);
      const lignes = ['JournalCode;EcritureNum;EcritureDate;CompteNum;CompteLib;EcritureLib;Debit;Credit'];
      for (const l of versLignes(aJour)) {
        lignes.push(['INV', l.ecritureNum, l.ecritureDate.replace(/-/g, ''), l.compteNum, champ(l.compteLib), champ(l.ecritureLib), l.debit.replace('.', ','), l.credit.replace('.', ',')].join(';'));
      }
      await tx.update(s.ecrituresInventaire).set({ statut: 'exportee', exporteeLe: sql`now()` }).where(inArray(s.ecrituresInventaire.id, aJour.map((e) => e.id)));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'ecritures_inventaire.exportees', cibleType: 'exercice', cibleId: id, entiteId: ex.entiteId, details: { ecritures: aJour.length } });
      return { csv: `${lignes.join('\r\n')}\r\n`, n: aJour.length };
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ecritures-inventaire-${id}.csv"`);
    res.setHeader('X-Ecritures-Exportees', String(n));
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(csv);
  }
}
