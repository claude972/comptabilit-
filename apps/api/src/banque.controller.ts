import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { decoderTexteReleve, detecterFormatReleve, PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT, proposerProfilCsv, REGLES_RAPPROCHEMENT, schemaParametresRapprochement } from '@comtaple/core';
import { type AccesBd, and, asc, count, desc, eq, gte, inArray, journaliser, lte, schema as s, sql, type Tx } from '@comtaple/db';
import type { Files, Stockage } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { avecNomsAnnulation } from './comptabilite.controller.js';
import { BD, STOCKAGE, TACHES } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const lancement = z.object({ parametres: schemaParametresRapprochement.partial().optional() });
const decision = z.object({ decision: z.enum(['valider', 'rejeter', 'remettre_en_proposition']), motif: z.string().min(1).max(2000).optional() });
const relance = z.object({ profilCsv: z.record(z.string(), z.unknown()) });
const dateIso = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@ApiTags('Banque et rapprochements')
@ApiBearerAuth()
@Controller('v1')
export class BanqueController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(TACHES) private readonly taches: Files,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
  ) {}

  @Get('dossiers/:entiteId/banque')
  @ApiOperation({
    summary: 'Imports de relevés bancaires d’un dossier et relevés lus (soldes, cadrage)',
    description: 'Le cadrage (« ok », « ecart », « non_verifiable ») compare solde d’ouverture + mouvements au solde de clôture ; « non vérifiable » n’est jamais un succès.',
  })
  async banque(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string) {
    exigerUuid(entiteId);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'lecture');
      const imports = await tx
        .select()
        .from(s.lotsImport)
        .where(and(eq(s.lotsImport.entiteId, entiteId), eq(s.lotsImport.type, 'releve_bancaire')))
        .orderBy(desc(s.lotsImport.creeLe));
      // Relevés et mouvements PRIS EN COMPTE : ceux des imports actifs. Un import annulé reste listé, ses données sont écartées.
      const releves = await tx
        .select({ r: s.relevesBancaires })
        .from(s.relevesBancaires)
        .innerJoin(s.lotsImport, and(eq(s.lotsImport.id, s.relevesBancaires.lotImportId), eq(s.lotsImport.actif, true)))
        .where(eq(s.relevesBancaires.entiteId, entiteId))
        .orderBy(desc(s.relevesBancaires.dateCloture))
        .then((l) => l.map((x) => x.r));
      const [{ n } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from mouvements_bancaires m where m.entite_id = ${entiteId}::uuid and mouvement_pris_en_compte(m.id)`)).rows as Array<{ n: number }>;
      return { imports: await avecNomsAnnulation(tx, imports), releves: releves.map(({ brut: _b, ...r }) => r), nbMouvements: n };
    });
  }

  @Get('dossiers/:entiteId/banque/mouvements')
  @ApiOperation({ summary: 'Mouvements bancaires importés (paginés), filtrables par période' })
  @ApiQuery({ name: 'du', required: false })
  @ApiQuery({ name: 'au', required: false })
  @ApiQuery({ name: 'page', required: false })
  async mouvements(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Query('du') du?: string, @Query('au') au?: string, @Query('page') pageBrute?: string) {
    exigerUuid(entiteId);
    if ((du && !dateIso.test(du)) || (au && !dateIso.test(au))) throw new BadRequestException('dates AAAA-MM-JJ attendues');
    const page = Math.max(Number(pageBrute) || 1, 1);
    const TAILLE = 100;
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'lecture');
      const conditions = [eq(s.mouvementsBancaires.entiteId, entiteId), sql`mouvement_pris_en_compte(${s.mouvementsBancaires.id})`];
      if (du) conditions.push(gte(s.mouvementsBancaires.dateOperation, du));
      if (au) conditions.push(lte(s.mouvementsBancaires.dateOperation, au));
      const lignes = await tx
        .select()
        .from(s.mouvementsBancaires)
        .where(and(...conditions))
        .orderBy(asc(s.mouvementsBancaires.dateOperation), asc(s.mouvementsBancaires.rang))
        .limit(TAILLE + 1)
        .offset((page - 1) * TAILLE);
      return { page, taillePage: TAILLE, suite: lignes.length > TAILLE, mouvements: lignes.slice(0, TAILLE).map(({ brut: _b, ...m }) => m) };
    });
  }

  @Get('imports/:id/apercu')
  @ApiOperation({
    summary: 'Aperçu des premières lignes d’un relevé importé et profil de colonnes proposé (pour confirmer un CSV)',
    description:
      'Lit seulement le début du fichier original. Les cellules sont un contenu non fiable, renvoyé en texte brut et tronqué. Le profil proposé est une aide : c’est l’utilisateur qui le confirme.',
  })
  async apercu(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    const fichier = await this.bd.avecContexte(acces, async (tx) => {
      const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, id));
      if (!lot || lot.type !== 'releve_bancaire' || !lot.fichierId) throw new NotFoundException('Import de relevé introuvable');
      await exigerNiveau(tx, lot.entiteId, 'collaboration');
      const [f] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, lot.fichierId));
      if (!f) throw new NotFoundException('Fichier introuvable');
      return f;
    });
    const TAILLE = 32 * 1024;
    const { texte, encodage } = decoderTexteReleve(new Uint8Array(await this.stockage.lireDebut(fichier.cleStockage, TAILLE)));
    const format = detecterFormatReleve(texte.slice(0, 8192));
    const tronque = fichier.taille > TAILLE;
    // La dernière ligne peut être coupée par la lecture partielle : on l'écarte.
    const brutes = texte.split(/\r\n|\n|\r/);
    if (tronque) brutes.pop();
    const lignes = brutes.filter((l) => l.trim() !== '').slice(0, 15).map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l));
    if (format !== 'csv') return { format, encodage, tronque, lignes, separateurs: [], profilPropose: null, raisons: ['Ce fichier n’est pas un CSV : aucun profil de colonnes n’est nécessaire.'] };
    const separateurs = [';', ',', '\t']
      .map((sep) => ({ separateur: sep, colonnes: lignes.slice(0, 5).map((l) => l.split(sep).length) }))
      .filter((x) => x.colonnes.length > 0 && x.colonnes[0]! > 1 && x.colonnes.every((n) => n === x.colonnes[0]));
    const proposition = proposerProfilCsv(texte);
    return {
      format,
      encodage,
      tronque,
      lignes,
      // Séparateurs donnant le même nombre de colonnes sur les premières lignes, avec ce découpage (aide à la saisie).
      separateurs: separateurs.map((x) => ({ separateur: x.separateur, nbColonnes: x.colonnes[0], cellules: lignes.slice(0, 6).map((l) => l.split(x.separateur).map((c) => c.slice(0, 80))) })),
      profilPropose: proposition.profil,
      raisons: proposition.raisons,
    };
  }

  @Post('imports/:id/relancer')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Relancer un import de relevé CSV en échec avec un profil de colonnes confirmé',
    description: 'Quand les colonnes d’un CSV ne sont pas reconnues avec certitude, l’import s’abstient : un humain confirme le profil.',
  })
  @ApiBody({ schema: schemaOpenApi(relance) })
  async relancer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(relance, corps);
    await this.bd.avecContexte(acces, async (tx) => {
      const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, id)).for('update');
      if (!lot || lot.type !== 'releve_bancaire') throw new NotFoundException('Import de relevé introuvable');
      await exigerNiveau(tx, lot.entiteId, 'collaboration');
      if (lot.statut !== 'echec') throw new ConflictException('Seul un import en échec peut être relancé');
      const nomFichier = (lot.rapport as { nomFichier?: string } | null)?.nomFichier;
      await tx.update(s.lotsImport).set({ statut: 'en_attente', rapport: { nomFichier, profilCsv: d.profilCsv }, termineLe: null }).where(eq(s.lotsImport.id, id));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'import.releve.relance', cibleType: 'lot_import', cibleId: id, entiteId: lot.entiteId });
    });
    await this.taches.importerReleve({ cabinetId: acces.cabinetId, lotImportId: id });
    return { accepte: true };
  }

  private async exercice(tx: Tx, id: string, minimum: Parameters<typeof exigerNiveau>[2]) {
    const [ex] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
    if (!ex) throw new NotFoundException('Exercice introuvable');
    await exigerNiveau(tx, ex.entiteId, minimum);
    return ex;
  }

  @Get('reference/rapprochement')
  @ApiOperation({ summary: 'Règles de rapprochement du moteur et paramètres par défaut (tolérances, fenêtres, bornes)' })
  reference() {
    return { regles: REGLES_RAPPROCHEMENT, parametresParDefaut: PARAMETRES_RAPPROCHEMENT_PAR_DEFAUT };
  }

  @Post('exercices/:id/rapprochements')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Lancer le rapprochement banque ↔ comptabilité de l’exercice',
    description: 'Moteur déterministe : correspondances exactes puis règles explicites (paiements groupés, partiels, compensations, tolérance). Le résultat est une proposition à valider.',
  })
  @ApiBody({ schema: schemaOpenApi(lancement) })
  async lancer(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(lancement, corps ?? {});
    const execution = await this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'collaboration');
      const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : le rapprochement ne peut pas être réalisé');
      const [{ n } = { n: 0 }] = (
        await tx.execute(sql`select count(*)::int as n from mouvements_bancaires m where m.entite_id = ${ex.entiteId}::uuid and m.date_operation between ${ex.debut}::date and ${ex.fin}::date and mouvement_pris_en_compte(m.id)`)
      ).rows as Array<{ n: number }>;
      if (n === 0) throw new ConflictException('Aucun mouvement bancaire importé sur la période de l’exercice : le rapprochement ne peut pas être réalisé');
      const [e] = await tx
        .insert(s.executionsRapprochement)
        .values({ cabinetId: acces.cabinetId, entiteId: ex.entiteId, exerciceId: id, lotImportId: lot.id, versionDonnees: ex.versionDonnees, parametres: d.parametres ?? {}, lancePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'rapprochement.lance', cibleType: 'execution_rapprochement', cibleId: e!.id, entiteId: ex.entiteId, details: { parametres: d.parametres ?? {} } });
      return e!;
    });
    await this.taches.executerRapprochement({ cabinetId: acces.cabinetId, executionId: execution.id });
    return execution;
  }

  @Get('exercices/:id/rapprochements')
  @ApiOperation({
    summary: 'Dernier rapprochement : propositions avec critères et explication, éléments non rapprochés, ambiguïtés, abandons',
    description:
      'Une ambiguïté (plusieurs solutions équivalentes) n’est jamais tranchée par le moteur. Un abandon signale une recherche interrompue par la borne de combinaisons. « obsolete » indique que les données ont changé depuis le calcul. Les propositions sont renvoyées par pages de 200, dans un ordre stable ; `pagination` donne le total et les décomptes par statut et par règle, calculés sur TOUTES les propositions (et non sur la page).',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page de propositions (1 par défaut)' })
  @ApiQuery({ name: 'statut', required: false, description: 'propose | valide | rejete' })
  async dernier(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('page') pageBrute?: string, @Query('statut') statut?: string) {
    exigerUuid(id);
    if (pageBrute !== undefined && !/^[1-9]\d{0,5}$/.test(pageBrute)) throw new BadRequestException('Page invalide');
    if (statut !== undefined && !['propose', 'valide', 'rejete'].includes(statut)) throw new BadRequestException('Statut inconnu');
    const page = Number(pageBrute ?? 1);
    const TAILLE_PAGE = 200;
    return this.bd.avecContexte(acces, async (tx) => {
      const ex = await this.exercice(tx, id, 'lecture');
      const [execution] = await tx.select().from(s.executionsRapprochement).where(eq(s.executionsRapprochement.exerciceId, id)).orderBy(desc(s.executionsRapprochement.creeLe)).limit(1);
      const vide = { page, taillePage: TAILLE_PAGE, total: 0, suite: false, parStatut: {}, parRegle: [] };
      if (!execution) return { exercice: ex, execution: null, rapprochements: [], pagination: vide, ecritures: {}, mouvements: {}, nonRapproches: { ecritures: [], mouvements: [], nbEcritures: 0, nbMouvements: 0 } };
      // Décomptes sur TOUTES les propositions de l'exécution ; l'identifiant départage les égalités pour un ordre stable.
      const decomptes = await tx
        .select({ regle: s.rapprochements.regle, statut: s.rapprochements.statut, n: count() })
        .from(s.rapprochements)
        .where(eq(s.rapprochements.executionId, execution.id))
        .groupBy(s.rapprochements.regle, s.rapprochements.statut);
      const parStatut: Record<string, number> = {};
      const parRegleMap = new Map<string, number>();
      for (const d of decomptes) {
        parStatut[d.statut] = (parStatut[d.statut] ?? 0) + d.n;
        parRegleMap.set(d.regle, (parRegleMap.get(d.regle) ?? 0) + d.n);
      }
      const total = statut ? (parStatut[statut] ?? 0) : decomptes.reduce((t, d) => t + d.n, 0);
      const lus = await tx
        .select()
        .from(s.rapprochements)
        .where(and(eq(s.rapprochements.executionId, execution.id), statut ? eq(s.rapprochements.statut, statut) : undefined))
        .orderBy(asc(s.rapprochements.niveau), asc(s.rapprochements.regle), asc(s.rapprochements.creeLe), asc(s.rapprochements.id))
        .limit(TAILLE_PAGE + 1)
        .offset((page - 1) * TAILLE_PAGE);
      const rapprochements = lus.slice(0, TAILLE_PAGE);
      const pagination = { page, taillePage: TAILLE_PAGE, total, suite: lus.length > TAILLE_PAGE, parStatut, parRegle: [...parRegleMap].map(([regle, n]) => ({ regle, n })).sort((a, b) => a.regle.localeCompare(b.regle)) };
      const PLAFOND = 300;
      const nonE = ((execution.nonRapprochesEcritures as string[] | null) ?? []).filter((x) => UUID.test(x));
      const nonM = ((execution.nonRapprochesMouvements as string[] | null) ?? []).filter((x) => UUID.test(x));
      const idsE = new Set<string>(nonE.slice(0, PLAFOND));
      const idsM = new Set<string>(nonM.slice(0, PLAFOND));
      for (const r of rapprochements) {
        for (const x of r.cotesEcritures as string[]) if (UUID.test(x)) idsE.add(x);
        for (const x of r.cotesMouvements as string[]) if (UUID.test(x)) idsM.add(x);
      }
      for (const a of ((execution.ambiguites as Array<{ ids: string[] }> | null) ?? []).slice(0, 100)) for (const x of a.ids) if (UUID.test(x)) idsE.add(x);
      // Les identifiants d'ambiguïtés peuvent désigner une écriture ou un mouvement : on cherche dans les deux tables.
      const tous = [...new Set([...idsE, ...idsM])];
      const ecritures = tous.length
        ? await tx
            .select({ id: s.lignesEcriture.id, date: s.lignesEcriture.ecritureDate, journal: s.lignesEcriture.journalCode, numero: s.lignesEcriture.ecritureNum, compte: s.lignesEcriture.compteNum, piece: s.lignesEcriture.pieceRef, libelle: s.lignesEcriture.ecritureLib, debit: s.lignesEcriture.debit, credit: s.lignesEcriture.credit })
            .from(s.lignesEcriture)
            .where(inArray(s.lignesEcriture.id, tous))
        : [];
      const mouvements = tous.length
        ? await tx
            .select({ id: s.mouvementsBancaires.id, date: s.mouvementsBancaires.dateOperation, montant: s.mouvementsBancaires.montant, libelle: s.mouvementsBancaires.libelle, reference: s.mouvementsBancaires.referenceBoutEnBout, contrepartie: s.mouvementsBancaires.contrepartieNom, iban: s.mouvementsBancaires.iban })
            .from(s.mouvementsBancaires)
            .where(inArray(s.mouvementsBancaires.id, tous))
        : [];
      return {
        exercice: ex,
        execution,
        rapprochements,
        pagination,
        ecritures: Object.fromEntries(ecritures.map((e) => [e.id, e])),
        mouvements: Object.fromEntries(mouvements.map((m) => [m.id, m])),
        nonRapproches: { ecritures: nonE.slice(0, PLAFOND), mouvements: nonM.slice(0, PLAFOND), nbEcritures: nonE.length, nbMouvements: nonM.length },
      };
    });
  }

  @Patch('rapprochements/:id')
  @ApiOperation({
    summary: 'Valider ou rejeter un rapprochement proposé (réviseur habilité)',
    description: 'Un rejet exige un motif. La décision est historisée avec la version des données ; elle ne modifie aucune écriture.',
  })
  @ApiBody({ schema: schemaOpenApi(decision) })
  async decider(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(decision, corps);
    if (d.decision === 'rejeter' && !d.motif) throw new BadRequestException('Un motif est requis pour rejeter');
    return this.bd.avecContexte(acces, async (tx) => {
      const [r] = await tx.select().from(s.rapprochements).where(eq(s.rapprochements.id, id)).for('update');
      if (!r) throw new NotFoundException('Rapprochement introuvable');
      await exigerNiveau(tx, r.entiteId, 'revision');
      const [execution] = await tx.select().from(s.executionsRapprochement).where(eq(s.executionsRapprochement.id, r.executionId));
      if (execution?.obsolete && d.decision === 'valider') throw new ConflictException('Les données ont changé depuis ce rapprochement : relancez-le avant de valider');
      const statut = d.decision === 'valider' ? 'valide' : d.decision === 'rejeter' ? 'rejete' : 'propose';
      const [maj] = await tx
        .update(s.rapprochements)
        .set({ statut, motif: d.motif ?? null, decidePar: statut === 'propose' ? null : acces.utilisateurId, decideLe: statut === 'propose' ? null : sql`now()` })
        .where(eq(s.rapprochements.id, id))
        .returning();
      await tx.insert(s.decisions).values({ cabinetId: acces.cabinetId, entiteId: r.entiteId, cibleType: 'rapprochement', cibleId: id, versionCible: execution?.versionDonnees ?? 0, action: d.decision, motif: d.motif ?? null, auteurId: acces.utilisateurId });
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: `rapprochement.${d.decision}`, cibleType: 'rapprochement', cibleId: id, entiteId: r.entiteId, details: { regle: r.regle, ecart: r.ecart } });
      return maj;
    });
  }
}
