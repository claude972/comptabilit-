import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AccesBd, sql } from '@comtaple/db';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { DELAI_MAX_RECHERCHE_MS, DOSSIERS_PAR_PAGE, MAX_CONSTATS_PAR_DOSSIER, MAX_ECRITURES_PAR_DOSSIER, MAX_PIECES_PAR_DOSSIER, rechercherPortefeuille } from './recherche-portefeuille.service.js';

@ApiTags('Recherche')
@ApiBearerAuth()
@Controller('v1/recherche')
export class RechercheController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get()
  @ApiOperation({
    summary: 'Recherche textuelle dans UN dossier (« entiteId ») ou, sans « entiteId », dans tout le portefeuille autorisé : pièces (texte extrait), écritures importées, constats',
    description:
      `Recherche déterministe (plein texte français), sans IA. Les habilitations sont appliquées par la base avant toute recherche. Chaque résultat cite sa source (pièce et page, écriture et lot, constat) ; les extraits sont des contenus de pièces, donc non fiables, renvoyés en texte brut.\n\n` +
      `AVEC « entiteId » : un dossier (niveau « dépôt » au moins ; un déposant ne voit que ses propres dépôts). SANS « entiteId » : le PORTEFEUILLE — les dossiers actifs où la personne a au moins le niveau « lecture », calculés par la base sous son identité (aucun identifiant n’est accepté pour élargir ou choisir le périmètre) ; refusé (403) aux déposants. Résultats groupés PAR DOSSIER (nom, totaux exacts par catégorie, au plus ${MAX_PIECES_PAR_DOSSIER} pièces, ${MAX_ECRITURES_PAR_DOSSIER} écritures et ${MAX_CONSTATS_PAR_DOSSIER} constats par dossier), ${DOSSIERS_PAR_PAGE} dossiers par page (« page »), classés par nombre de résultats décroissant puis nom. Les dossiers sans résultat ne sont ni listés ni nommés, seulement décomptés (« dossiersSansResultat »). Délai maximal ${DELAI_MAX_RECHERCHE_MS / 1000} s : au-delà, 503 explicite, jamais un résultat partiel présenté comme complet. Les pièces en quarantaine sont exclues.`,
  })
  @ApiQuery({ name: 'entiteId', required: false, description: 'Un dossier ; absent : tout le portefeuille autorisé.' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'page', required: false, description: 'Portefeuille seulement : page de dossiers (à partir de 1).' })
  async chercher(@AccesCourant() acces: Acces, @Query('entiteId') entiteId: string | undefined, @Query('q') q: string, @Query('page') page?: string) {
    if (entiteId === undefined) return rechercherPortefeuille(this.bd, acces, q, page);
    exigerUuid(entiteId, 'entiteId');
    const requete = (q ?? '').trim();
    if (requete.length < 2 || requete.length > 200) throw new BadRequestException('Recherche de 2 à 200 caractères');
    return this.bd.avecContexte(acces, async (tx) => {
      const niveau = await exigerNiveau(tx, entiteId, 'depot');
      const ts = sql`websearch_to_tsquery('french', ${requete})`;
      // Balises de surlignage neutres (« et ») : aucun HTML n'est produit à partir d'un contenu de pièce.
      const options = sql`'StartSel=\uE000, StopSel=\uE001, MaxWords=24, MinWords=8, MaxFragments=1'`;
      const pieces = (
        await tx.execute(sql`
          select p.document_id as "documentId", d.nom_origine as "nomOrigine", p.numero as page, d.statut,
                 ts_headline('french', translate(coalesce(p.texte, ''), U&'\\E000\\E001', ''), ${ts}, ${options}) as extrait
          from pages_document p join documents d on d.id = p.document_id
          where p.entite_id = ${entiteId}::uuid and to_tsvector('french', coalesce(p.texte, '')) @@ ${ts}
            ${niveau === 'depot' ? sql`and exists (select 1 from receptions r where r.document_id = d.id and r.deposant_id = ${acces.utilisateurId}::uuid)` : sql``}
          order by ts_rank(to_tsvector('french', coalesce(p.texte, '')), ${ts}) desc, d.cree_le desc limit 30`)
      ).rows;
      // Extrait structuré : les marqueurs « et » peuvent aussi figurer dans une pièce (guillemets français). Des
      // sentinelles hors texte courant délimitent donc le terme trouvé, puis sont converties en segments.
      for (const p of pieces as Array<Record<string, unknown>>) {
        const brut = String(p.extrait ?? '');
        p.segments = brut.split(/(\uE000[^\uE001]*\uE001)/).filter((x) => x !== '').map((x) => (x.startsWith('\uE000') ? { texte: x.slice(1, -1), trouve: true } : { texte: x, trouve: false }));
        p.extrait = brut.replace(/\uE000/g, '«').replace(/\uE001/g, '»');
      }
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
