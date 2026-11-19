import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { evaluerApplicabilite, schemaCriteresEvolution } from '@comtaple/core';
import { type AccesBd, asc, desc, eq, journaliser, schema as s, sql } from '@comtaple/db';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const suivi = z.object({ statut: z.enum(['a_examiner', 'pris_en_compte', 'sans_objet']), note: z.string().max(2000).optional() });
/** Au-delà, la veille sur une source n'est plus considérée comme assurée (règle interne). */
const JOURS_SANS_SUCCES = 7;

@ApiTags('Veille réglementaire')
@ApiBearerAuth()
@Controller('v1')
export class VeilleController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get('veille/sources')
  @ApiOperation({
    summary: 'Sources officielles surveillées et état de leur surveillance',
    description: '« veilleAssuree » est faux quand la dernière vérification réussie est absente ou trop ancienne : une source indisponible n’est jamais présentée comme « sans nouveauté ».',
  })
  async sources(@AccesCourant() acces: Acces) {
    if (acces.role === 'client_deposant' || acces.role === 'client_lecture') throw new ForbiddenException('Réservé aux membres du cabinet');
    return this.bd.avecContexte(acces, async (tx) => {
      const sources = await tx.select().from(s.surveillancesSources).where(eq(s.surveillancesSources.actif, true)).orderBy(asc(s.surveillancesSources.emetteur), asc(s.surveillancesSources.libelle));
      const [{ n } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from evolutions_reglementaires where etat_verification = 'detectee_a_qualifier'`)).rows as Array<{ n: number }>;
      const limite = Date.now() - JOURS_SANS_SUCCES * 86_400_000;
      return {
        evolutionsDetecteesNonQualifiees: n,
        sources: sources.map(({ empreinteContenu: _e, ...x }) => ({ ...x, veilleAssuree: x.dernierSuccesLe !== null && new Date(x.dernierSuccesLe).getTime() >= limite })),
      };
    });
  }

  @Get('dossiers/:id/veille')
  @ApiOperation({
    summary: 'Évolutions réglementaires vérifiées, avec leur applicabilité à ce dossier et son explication',
    description:
      'Seules les évolutions qualifiées par une personne (état « verifiee ») sont présentées. L’applicabilité vaut « a_confirmer » dès qu’une caractéristique du dossier manque. Aucune évolution ne modifie les règles des contrôles.',
  })
  async veille(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const [e] = await tx.select().from(s.entites).where(eq(s.entites.id, id));
      if (!e) throw new NotFoundException('Dossier introuvable');
      const exercices = await tx.select({ debut: s.exercices.debut, fin: s.exercices.fin }).from(s.exercices).where(eq(s.exercices.entiteId, id));
      const profil = { territoireFiscal: e.territoireFiscal, regimeFiscal: e.regimeFiscal, formeJuridique: e.formeJuridique, codeNaf: e.codeNaf, referentielComptable: e.referentielComptable, exercices };
      const evolutions = await tx.select().from(s.evolutionsReglementaires).where(eq(s.evolutionsReglementaires.etatVerification, 'verifiee')).orderBy(desc(s.evolutionsReglementaires.dateEffet)).limit(500);
      const suivis = await tx.select().from(s.suivisEvolution).where(eq(s.suivisEvolution.entiteId, id));
      return evolutions.map((ev) => {
        const criteres = schemaCriteresEvolution.safeParse(ev.criteres);
        const applicabilite = criteres.success
          ? evaluerApplicabilite(profil, criteres.data)
          : { statut: 'a_confirmer' as const, raisons: ['Critères de l’évolution illisibles : applicabilité à apprécier manuellement.'], manquants: [], exercicesConcernes: [] };
        const sv = suivis.find((x) => x.evolutionId === ev.id);
        return {
          id: ev.id,
          emetteur: ev.emetteur,
          reference: ev.reference,
          url: ev.url,
          passage: ev.passage,
          datePublication: ev.datePublication,
          dateEffet: ev.dateEffet,
          conditions: ev.conditions,
          resume: ev.resume,
          verifieeLe: ev.verifieeLe,
          applicabilite,
          suivi: sv ? { statut: sv.statut, note: sv.note, majLe: sv.majLe } : null,
        };
      });
    });
  }

  @Put('dossiers/:id/veille/:evolutionId')
  @ApiOperation({ summary: 'Consigner le suivi d’une évolution pour ce dossier (à examiner, pris en compte, sans objet)' })
  @ApiBody({ schema: schemaOpenApi(suivi) })
  async suivre(@AccesCourant() acces: Acces, @Param('id') id: string, @Param('evolutionId') evolutionId: string, @Body() corps: unknown) {
    exigerUuid(id);
    exigerUuid(evolutionId);
    const d = valider(suivi, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'collaboration');
      const [ev] = await tx.select({ id: s.evolutionsReglementaires.id, etat: s.evolutionsReglementaires.etatVerification }).from(s.evolutionsReglementaires).where(eq(s.evolutionsReglementaires.id, evolutionId));
      if (!ev || ev.etat !== 'verifiee') throw new NotFoundException('Évolution introuvable');
      const [sv] = await tx
        .insert(s.suivisEvolution)
        .values({ cabinetId: acces.cabinetId, entiteId: id, evolutionId, statut: d.statut, note: d.note ?? null, auteurId: acces.utilisateurId })
        .onConflictDoUpdate({ target: [s.suivisEvolution.entiteId, s.suivisEvolution.evolutionId], set: { statut: d.statut, note: d.note ?? null, auteurId: acces.utilisateurId, majLe: sql`now()` } })
        .returning();
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'veille.suivi', cibleType: 'evolution', cibleId: evolutionId, entiteId: id, details: { statut: d.statut } });
      return sv;
    });
  }
}
