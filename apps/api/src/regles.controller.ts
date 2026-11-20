import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CATALOGUE_CONTROLES, executerControles } from '@comtaple/core';
import { type AccesBd, and, count, desc, eq, inArray, isNull, journaliser, notifier, notifierGestionnaires, schema as s, sql, type Tx } from '@comtaple/db';
import { type Config, parametresApprouves, relevesDuDossier } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { ecarterSuggestion, lireSuggestions } from './amelioration.service.js';
import { BD, CONFIG } from './jetons.js';
import { avecCalcul, chargerLignes, refusVolume, ApiRefusVolume } from './plafonds.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const proposition = z.object({
  controleId: z.string().min(1).max(20),
  /** Absent : préférence de tout le cabinet. Présent : exception propre à ce dossier. */
  entiteId: uuid.optional(),
  parametres: z.record(z.string(), z.unknown()),
  motif: z.string().min(5).max(2000),
});
const mesure = z.object({ exerciceId: uuid });
const refus = z.object({ motif: z.string().min(1).max(2000) });
const ecart = z.strictObject({ empreinte: z.string().min(1).max(300), motif: z.string().trim().min(5, 'motif de 5 caractères au moins').max(2000) });

@ApiTags('Règles du cabinet')
@ApiBearerAuth()
@Controller('v1/regles')
export class ReglesController {
  constructor(@Inject(BD) private readonly bd: AccesBd, @Inject(CONFIG) private readonly cfg: Config) {}

  private async gestionnaire(tx: Tx): Promise<boolean> {
    return Boolean((await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok);
  }

  @Get()
  @ApiOperation({
    summary: 'Règles et paramètres propres au cabinet : propositions, règles approuvées, règles retirées (versions conservées)',
    description:
      'Avec `page` : réponse paginée `{ page, taillePage, total, suite, parStatut, regles }` (50 par page, ordre stable, filtres `statut` et `controleId`). Sans `page` : ancienne forme, un tableau limité aux 500 règles les plus récentes — conservée pour compatibilité, à ne plus utiliser.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'statut', required: false, description: 'proposee | approuvee | retiree | refusee' })
  @ApiQuery({ name: 'controleId', required: false })
  async lister(@AccesCourant() acces: Acces, @Query('page') pageBrute?: string, @Query('statut') statut?: string, @Query('controleId') controleId?: string) {
    if (acces.role === 'client_deposant' || acces.role === 'client_lecture') throw new ForbiddenException('Réservé aux membres du cabinet');
    if (pageBrute !== undefined && !/^[1-9]\d{0,5}$/.test(pageBrute)) throw new BadRequestException('Page invalide');
    if (statut !== undefined && !['proposee', 'approuvee', 'retiree', 'refusee'].includes(statut)) throw new BadRequestException('Statut inconnu');
    if (controleId !== undefined && !/^[A-Z]{2,5}-\d{3}$/.test(controleId)) throw new BadRequestException('Contrôle invalide');
    const TAILLE_PAGE = 50;
    return this.bd.avecContexte(acces, async (tx) => {
      const filtre = and(statut ? eq(s.reglesCabinet.statut, statut) : undefined, controleId ? eq(s.reglesCabinet.controleId, controleId) : undefined);
      const ordre = [desc(s.reglesCabinet.creeLe), desc(s.reglesCabinet.id)] as const;
      const lues = pageBrute === undefined
        ? await tx.select().from(s.reglesCabinet).where(filtre).orderBy(...ordre).limit(500)
        : await tx.select().from(s.reglesCabinet).where(filtre).orderBy(...ordre).limit(TAILLE_PAGE + 1).offset((Number(pageBrute) - 1) * TAILLE_PAGE);
      const regles = pageBrute === undefined ? lues : lues.slice(0, TAILLE_PAGE);
      // Noms des auteurs (membres du cabinet), pour qu'un réviseur sache qui a proposé et qui a décidé.
      const ids = [...new Set(regles.flatMap((r) => [r.proposeePar, r.approuveePar]).filter((x): x is string => Boolean(x)))];
      const noms = ids.length ? await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, ids)) : [];
      const nomDe = new Map(noms.map((n) => [n.id, n.nom]));
      const enrichies = regles.map((r) => ({ ...r, proposeeParNom: r.proposeePar ? (nomDe.get(r.proposeePar) ?? null) : null, decideeParNom: r.approuveePar ? (nomDe.get(r.approuveePar) ?? null) : null }));
      if (pageBrute === undefined) return enrichies;
      // Décomptes par statut sur toutes les règles visibles (hors filtre de statut), et total de la sélection courante.
      const decomptes = await tx.select({ statut: s.reglesCabinet.statut, n: count() }).from(s.reglesCabinet).where(controleId ? eq(s.reglesCabinet.controleId, controleId) : undefined).groupBy(s.reglesCabinet.statut);
      const parStatut = Object.fromEntries(decomptes.map((d) => [d.statut, d.n]));
      const total = statut ? (parStatut[statut] ?? 0) : decomptes.reduce((t, d) => t + d.n, 0);
      return { page: Number(pageBrute), taillePage: TAILLE_PAGE, total, suite: lues.length > TAILLE_PAGE, parStatut, regles: enrichies };
    });
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Suggestions d’amélioration tirées des décisions de revue du cabinet (réviseurs, associés, administrateurs)',
    description:
      'Calcul déterministe, à la demande, par le moteur du cœur (critères explicites et versionnés, renvoyés dans « criteres ») sur les seules décisions de CE cabinet lisibles par la personne (dossiers où elle est habilitée) : constats rejetés avec motif, champs extraits corrigés, rapprochements rejetés. Cinq catégories : correction_donnee (rien à proposer), exception_dossier et preference_cabinet (seules « proposables », par une personne, via POST v1/regles : mesure d’impact puis approbation par une AUTRE personne), nouvelle_regle_metier (signalement à instruire par l’éditeur, rien n’est créé ni transmis), modification_regle_reglementaire (jamais de règle de cabinet : renvoi vers la veille). Chaque suggestion porte ses preuves (décisions sources, décomptes, période), le paramètre concerné quand sa sémantique est établie (valeur indicative en chaîne décimale) et ce qu’elle ne fait pas. Rien n’est activé ni enregistré par cette lecture.',
  })
  async suggestions(@AccesCourant() acces: Acces) {
    return lireSuggestions(this.bd, acces);
  }

  @Post('suggestions/ecarter')
  @ApiOperation({
    summary: 'Écarter une suggestion d’amélioration, avec un motif (réviseurs, associés, administrateurs)',
    description: 'La suggestion doit être en cours (404 sinon). La décision est conservée en ajout seul ; la suggestion ne sera reproposée que si des décisions postérieures atteignent à elles seules les seuils. Une « correction de donnée » ne s’écarte pas.',
  })
  @ApiBody({ schema: schemaOpenApi(ecart) })
  async ecarter(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    return ecarterSuggestion(this.bd, acces, valider(ecart, corps));
  }

  @Post()
  @ApiOperation({
    summary: 'Proposer un paramétrage de contrôle (préférence du cabinet ou exception d’un dossier)',
    description:
      'Une proposition n’a AUCUN effet tant qu’elle n’est pas approuvée par un administrateur ou un associé. Les paramètres sont validés par le schéma du contrôle. Les contrôles à fondement réglementaire ne sont pas paramétrables par ce parcours.',
  })
  @ApiBody({ schema: schemaOpenApi(proposition) })
  async proposer(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(proposition, corps);
    if (acces.role === 'client_deposant' || acces.role === 'client_lecture' || acces.role === 'support') throw new ForbiddenException('Réservé aux collaborateurs du cabinet');
    const def = CATALOGUE_CONTROLES.find((c) => c.id === d.controleId);
    if (!def) throw new BadRequestException('Contrôle inconnu');
    if (def.source.type === 'reglementaire') {
      throw new ConflictException('Ce contrôle repose sur une règle réglementaire : ses paramètres ne se modifient pas par une préférence de cabinet.');
    }
    const inconnus = Object.keys(d.parametres).filter((k) => !(k in def.parametresParDefaut));
    if (inconnus.length) throw new BadRequestException(`Paramètre(s) inconnu(s) pour ${def.id} : ${inconnus.join(', ')}`);
    const fusion = def.schemaParametres.safeParse({ ...def.parametresParDefaut, ...d.parametres });
    if (!fusion.success) {
      throw new BadRequestException({ message: 'Paramètres invalides pour ce contrôle', erreurs: fusion.error.issues.map((i) => ({ champ: i.path.join('.'), probleme: i.message })) });
    }
    return this.bd.avecContexte(acces, async (tx) => {
      if (d.entiteId) await exigerNiveau(tx, d.entiteId, 'collaboration');
      else if (acces.role === 'collaborateur') throw new ForbiddenException('Une préférence de tout le cabinet se propose à partir du rôle de réviseur');
      const [{ max } = { max: 0 }] = (
        await tx.execute(sql`select coalesce(max(version), 0)::int as max from regles_cabinet where controle_id = ${d.controleId} and entite_id_cible is not distinct from ${d.entiteId ?? null}::uuid`)
      ).rows as Array<{ max: number }>;
      const [r] = await tx
        .insert(s.reglesCabinet)
        .values({ cabinetId: acces.cabinetId, controleId: d.controleId, entiteId: d.entiteId ?? null, parametres: d.parametres, version: max + 1, motif: d.motif, proposeePar: acces.utilisateurId })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'regle.proposee', cibleType: 'regle_cabinet', cibleId: r!.id, entiteId: d.entiteId ?? null, details: { controleId: d.controleId, version: r!.version, parametres: d.parametres } });
      await notifierGestionnaires(tx, { type: 'regle.a_decider', entiteId: d.entiteId ?? null, cibleType: 'regle_cabinet', cibleId: r!.id, donnees: { controleId: d.controleId, version: r!.version } });
      return r;
    });
  }

  private async charger(tx: Tx, id: string) {
    const [r] = await tx.select().from(s.reglesCabinet).where(eq(s.reglesCabinet.id, id)).for('update');
    if (!r) throw new NotFoundException('Règle introuvable');
    return r;
  }

  @Post(':id/impact')
  @ApiRefusVolume()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mesurer l’impact d’une règle proposée sur un exercice, AVANT toute activation',
    description: 'Exécute le contrôle concerné deux fois sur les données actives de l’exercice (paramètres en vigueur, puis paramètres proposés) et compare. Rien n’est enregistré dans la révision.',
  })
  @ApiBody({ schema: schemaOpenApi(mesure) })
  async impact(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(mesure, corps);
    return avecCalcul(this.bd, acces, async (tx, budget) => {
      const r = await this.charger(tx, id);
      const [ex] = await tx.select().from(s.exercices).where(eq(s.exercices.id, d.exerciceId));
      if (!ex) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, ex.entiteId, 'collaboration');
      if (r.entiteId && r.entiteId !== ex.entiteId) throw new BadRequestException('Cette règle est une exception d’un autre dossier');
      const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, ex.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      if (!lot) throw new ConflictException('Aucune donnée comptable active pour cet exercice : impact non mesurable');
      // Plafonds de l'API (D-093) : lignes de l'exercice, puis mouvements bancaires du dossier (relus en entier pour TRE-003).
      const [{ n: nbMouvements } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from mouvements_bancaires where entite_id = ${ex.entiteId}::uuid`)).rows as Array<{ n: number }>;
      if (nbMouvements > this.cfg.API_MOUVEMENTS_MAX_CALCUL) {
        throw refusVolume({ ecran: 'Mesure d’impact d’une règle', objet: 'mouvements bancaires dans le dossier', volume: nbMouvements, plafond: this.cfg.API_MOUVEMENTS_MAX_CALCUL, variable: 'API_MOUVEMENTS_MAX_CALCUL' });
      }
      const { lignes } = await chargerLignes(tx, budget, this.cfg, { ecran: 'Mesure d’impact d’une règle', plafond: 'impact', lot });
      const enVigueur = await parametresApprouves(tx, ex.entiteId);
      // Mêmes relevés actifs que l'exécution réelle des contrôles : sans eux, un contrôle qui en dépend (TRE-003) serait
      // « non réalisé » avant comme après, et la mesure ne dirait rien.
      const releves = await relevesDuDossier(tx, ex.entiteId);
      const contexte = { lignes, exercice: { debut: ex.debut, fin: ex.fin }, exercicePrecedent: null, releves: releves.length ? releves : null };
      const [avant] = executerControles(contexte, { ids: [r.controleId], parametres: enVigueur.parametres });
      const [apres] = executerControles(contexte, { ids: [r.controleId], parametres: { ...enVigueur.parametres, [r.controleId]: r.parametres as Record<string, unknown> } });
      const cles = (x: typeof avant) => new Set(x!.constats.map((k) => k.cle));
      const a = cles(avant);
      const b = cles(apres);
      const impact = {
        exerciceId: ex.id,
        versionDonnees: ex.versionDonnees,
        mesureLe: new Date().toISOString(),
        avant: { statut: avant!.statut, constats: a.size, parametres: avant!.parametresAppliques },
        apres: { statut: apres!.statut, constats: b.size, parametres: apres!.parametresAppliques },
        constatsQuiDisparaissent: [...a].filter((k) => !b.has(k)).length,
        constatsQuiApparaissent: [...b].filter((k) => !a.has(k)).length,
      };
      await tx.update(s.reglesCabinet).set({ impact }).where(eq(s.reglesCabinet.id, id));
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'regle.impact_mesure', cibleType: 'regle_cabinet', cibleId: id, entiteId: ex.entiteId, details: { avant: impact.avant.constats, apres: impact.apres.constats } });
      return impact;
    });
  }

  @Post(':id/approuver')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approuver une règle proposée (administrateur ou associé, autre que la personne qui l’a proposée)',
    description: 'Exige une mesure d’impact préalable. La règle précédemment en vigueur pour la même cible est retirée (conservée dans l’historique). Les contrôles déjà exécutés deviennent obsolètes.',
  })
  async approuver(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      if (!(await this.gestionnaire(tx))) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const r = await this.charger(tx, id);
      if (r.statut !== 'proposee') throw new ConflictException(`Règle au statut « ${r.statut} »`);
      if (r.proposeePar === acces.utilisateurId) throw new ForbiddenException('Une règle ne peut pas être approuvée par la personne qui l’a proposée');
      if (!r.impact) throw new ConflictException('Mesurez l’impact de la règle avant de l’approuver');
      const memeCible = and(eq(s.reglesCabinet.controleId, r.controleId), eq(s.reglesCabinet.statut, 'approuvee'), r.entiteId ? eq(s.reglesCabinet.entiteId, r.entiteId) : isNull(s.reglesCabinet.entiteId));
      await tx.update(s.reglesCabinet).set({ statut: 'retiree', decideeLe: sql`now()` }).where(memeCible);
      const [maj] = await tx.update(s.reglesCabinet).set({ statut: 'approuvee', approuveePar: acces.utilisateurId, decideeLe: sql`now()` }).where(eq(s.reglesCabinet.id, id)).returning();
      await this.rendreObsolete(tx, r.entiteId);
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'regle.approuvee', cibleType: 'regle_cabinet', cibleId: id, entiteId: r.entiteId, details: { controleId: r.controleId, version: r.version } });
      await notifier(tx, [r.proposeePar], { type: 'regle.decidee', entiteId: r.entiteId, cibleType: 'regle_cabinet', cibleId: id, donnees: { controleId: r.controleId, version: r.version, decision: 'approuvee' } });
      return maj;
    });
  }

  @Post(':id/refuser')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une règle proposée (administrateur ou associé)' })
  @ApiBody({ schema: schemaOpenApi(refus) })
  async refuser(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(refus, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      if (!(await this.gestionnaire(tx))) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const r = await this.charger(tx, id);
      if (r.statut !== 'proposee') throw new ConflictException(`Règle au statut « ${r.statut} »`);
      const [maj] = await tx.update(s.reglesCabinet).set({ statut: 'refusee', approuveePar: acces.utilisateurId, decideeLe: sql`now()`, motifDecision: d.motif }).where(eq(s.reglesCabinet.id, id)).returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'regle.refusee', cibleType: 'regle_cabinet', cibleId: id, entiteId: r.entiteId, details: { motif: d.motif } });
      await notifier(tx, [r.proposeePar], { type: 'regle.decidee', entiteId: r.entiteId, cibleType: 'regle_cabinet', cibleId: id, donnees: { controleId: r.controleId, version: r.version, decision: 'refusee' } });
      return maj;
    });
  }

  @Post(':id/retirer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retirer une règle approuvée : retour aux paramètres par défaut du contrôle (réversible, historisé)' })
  async retirer(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      if (!(await this.gestionnaire(tx))) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const r = await this.charger(tx, id);
      if (r.statut !== 'approuvee') throw new ConflictException(`Règle au statut « ${r.statut} »`);
      const [maj] = await tx.update(s.reglesCabinet).set({ statut: 'retiree', decideeLe: sql`now()` }).where(eq(s.reglesCabinet.id, id)).returning();
      await this.rendreObsolete(tx, r.entiteId);
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'regle.retiree', cibleType: 'regle_cabinet', cibleId: id, entiteId: r.entiteId, details: { controleId: r.controleId, version: r.version } });
      return maj;
    });
  }

  /** Une règle qui change rend les exécutions de contrôles antérieures obsolètes (fonction SQL étroite : tout le cabinet ou un dossier). */
  private async rendreObsolete(tx: Tx, entiteId: string | null): Promise<void> {
    await tx.execute(sql`select regles_rendre_obsolete(${entiteId}::uuid)`);
  }
}
