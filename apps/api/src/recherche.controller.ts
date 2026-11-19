import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AccesBd, sql } from '@comtaple/db';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';

@ApiTags('Recherche')
@ApiBearerAuth()
@Controller('v1/recherche')
export class RechercheController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get()
  @ApiOperation({
    summary: 'Recherche textuelle dans un dossier : pièces (texte extrait), écritures importées, constats',
    description:
      'Recherche déterministe (plein texte français), sans IA. Les habilitations sont appliquées par la base avant toute recherche. Chaque résultat cite sa source (pièce et page, écriture et lot, constat) ; les extraits sont des contenus de pièces, donc non fiables, renvoyés en texte brut.',
  })
  @ApiQuery({ name: 'entiteId', required: true })
  @ApiQuery({ name: 'q', required: true })
  async chercher(@AccesCourant() acces: Acces, @Query('entiteId') entiteId: string, @Query('q') q: string) {
    exigerUuid(entiteId, 'entiteId');
    const requete = (q ?? '').trim();
    if (requete.length < 2 || requete.length > 200) throw new BadRequestException('Recherche de 2 à 200 caractères');
    return this.bd.avecContexte(acces, async (tx) => {
      const niveau = await exigerNiveau(tx, entiteId, 'depot');
      const ts = sql`websearch_to_tsquery('french', ${requete})`;
      // Balises de surlignage neutres (« et ») : aucun HTML n'est produit à partir d'un contenu de pièce.
      const options = sql`'StartSel=«, StopSel=», MaxWords=24, MinWords=8, MaxFragments=1'`;
      const pieces = (
        await tx.execute(sql`
          select p.document_id as "documentId", d.nom_origine as "nomOrigine", p.numero as page, d.statut,
                 ts_headline('french', coalesce(p.texte, ''), ${ts}, ${options}) as extrait
          from pages_document p join documents d on d.id = p.document_id
          where p.entite_id = ${entiteId}::uuid and to_tsvector('french', coalesce(p.texte, '')) @@ ${ts}
            ${niveau === 'depot' ? sql`and exists (select 1 from receptions r where r.document_id = d.id and r.deposant_id = ${acces.utilisateurId}::uuid)` : sql``}
          order by ts_rank(to_tsvector('french', coalesce(p.texte, '')), ${ts}) desc, d.cree_le desc limit 30`)
      ).rows;
      // Un déposant n'a accès ni aux écritures ni aux constats : la base ne lui renverrait rien, on ne l'interroge pas.
      if (niveau === 'depot') return { requete, perimetre: 'Vos propres dépôts dans ce dossier', pieces, ecritures: [], constats: [] };
      const ecritures = (
        await tx.execute(sql`
          select l.id, l.exercice_id as "exerciceId", l.lot_import_id as "lotImportId", l.ecriture_date::text as date, l.journal_code as journal, l.ecriture_num as numero,
                 l.compte_num as compte, l.piece_ref as piece, l.ecriture_lib as libelle, l.debit::text as debit, l.credit::text as credit
          from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
          where l.entite_id = ${entiteId}::uuid
            and to_tsvector('french', l.ecriture_lib || ' ' || l.piece_ref || ' ' || l.compte_lib || ' ' || coalesce(l.comp_aux_lib, '')) @@ ${ts}
          order by l.ecriture_date desc limit 50`)
      ).rows;
      const constats = (
        await tx.execute(sql`
          select c.id, c.exercice_id as "exerciceId", c.controle_id as "controleId", c.titre, c.statut_revue as "statutRevue", c.montant::text as montant
          from constats c join executions_controles e on e.id = c.execution_id and not e.obsolete
          where c.entite_id = ${entiteId}::uuid and to_tsvector('french', c.titre || ' ' || c.explication) @@ ${ts}
          order by c.cree_le desc limit 30`)
      ).rows;
      return { requete, perimetre: 'Pièces, écritures du lot actif et constats de la dernière exécution, dans ce dossier', pieces, ecritures, constats };
    });
  }
}
