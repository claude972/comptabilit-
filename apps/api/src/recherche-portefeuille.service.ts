/**
 * RECHERCHE TEXTUELLE SUR LE PORTEFEUILLE DE DOSSIERS AUTORISÉS — service appelable sans HTTP.
 *
 * Même périmètre que l'assistant de portefeuille (`perimetreAutorise`) : les dossiers actifs où la personne a au moins le
 * niveau « lecture », calculés par la base sous son identité (RLS + `app_niveau_entite`) ; aucun identifiant n'est
 * fourni par l'appelant, donc aucun dossier non autorisé n'est jamais interrogé ni nommé. Un déposant est refusé.
 *
 * Sources et plein texte identiques à la recherche d'un dossier (`recherche.controller.ts`) : pages de pièces (texte
 * extrait), écritures du lot ACTIF, constats de la dernière exécution non obsolète ; `websearch_to_tsquery('french')`,
 * sans IA. Les pièces en quarantaine sont exclues. Les extraits sont des contenus de pièces : NON FIABLES, rendus en
 * texte brut, jamais interprétés.
 *
 * Bornes, justifiées par le coût d'une recherche qui traverse tous les dossiers d'un cabinet :
 * - DÉLAI : 8 s (`statement_timeout` de la transaction). Les index GIN existants (pages, écritures) rendent la recherche
 *   rapide ; au-delà, la réponse est un refus explicite (503), jamais un résultat partiel présenté comme complet ;
 * - VOLUME : résultats groupés par dossier, 10 dossiers par page ; dans chaque dossier, 3 pièces, 5 écritures et 5
 *   constats au plus (les meilleurs), avec le TOTAL exact trouvé dans le dossier pour chaque catégorie. Rien n'est
 *   tronqué en silence : l'écart est affiché ;
 * - les dossiers sans résultat ne sont pas listés (ni nommés) mais décomptés.
 * Les dossiers sont classés par nombre total de résultats décroissant, puis nom, puis identifiant : l'ordre est déterministe.
 */
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { sql, type Tx, type AccesBd } from '@comtaple/db';
import type { Acces, Niveau } from './acces.js';
import { estDeposant, perimetreAutorise } from './assistant-portefeuille.service.js';

export const DELAI_MAX_RECHERCHE_MS = 8_000;
export const DOSSIERS_PAR_PAGE = 10;
export const MAX_PIECES_PAR_DOSSIER = 3;
export const MAX_ECRITURES_PAR_DOSSIER = 5;
export const MAX_CONSTATS_PAR_DOSSIER = 5;
export const REQUETE_MIN = 2;
export const REQUETE_MAX = 200;
export const PAGE_MAX = 1_000;

export interface ExtraitPiece {
  documentId: string;
  nomOrigine: string;
  page: number;
  statut: string;
  extrait: string;
  segments: Array<{ texte: string; trouve: boolean }>;
}
export interface DossierResultats {
  id: string;
  nom: string;
  niveau: Niveau;
  /** Nombre TOTAL de résultats trouvés dans ce dossier, par catégorie (les listes ci-dessous n'en montrent que les meilleurs). */
  totaux: { pieces: number; ecritures: number; constats: number };
  pieces: ExtraitPiece[];
  ecritures: Array<Record<string, unknown>>;
  constats: Array<Record<string, unknown>>;
}
export interface ResultatsPortefeuille {
  requete: string;
  perimetre: string;
  page: number;
  dossiersParPage: number;
  /** Dossiers du périmètre autorisé de la personne au moment de la recherche. */
  dossiersAutorises: number;
  dossiersAvecResultats: number;
  /** Dossiers autorisés où rien n'a été trouvé : décomptés, ni listés ni nommés. */
  dossiersSansResultat: number;
  limites: { delaiMaxMs: number; piecesParDossier: number; ecrituresParDossier: number; constatsParDossier: number };
  dossiers: DossierResultats[];
}

/** Requête de 2 à 200 caractères une fois les espaces de bord retirés, sinon 400. */
export function validerRequete(q: string | undefined): string {
  const requete = (q ?? '').trim();
  if (requete.length < REQUETE_MIN || requete.length > REQUETE_MAX) throw new BadRequestException(`Recherche de ${REQUETE_MIN} à ${REQUETE_MAX} caractères`);
  return requete;
}
export function validerPage(brut: string | undefined): number {
  const page = Number(brut ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) throw new BadRequestException('page : entier positif attendu');
  return page;
}

const codeErreur = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
};

/**
 * Les marqueurs de surlignage (U+E000 / U+E001, hors texte courant) délimitent le terme trouvé ; ils sont convertis en
 * segments, puis en guillemets français pour l'extrait brut. Aucun HTML n'est produit à partir d'un contenu de pièce.
 */
function segmenter(brut: string): { extrait: string; segments: Array<{ texte: string; trouve: boolean }> } {
  const segments = brut
    .split(/([^]*)/)
    .filter((x) => x !== '')
    .map((x) => (x.startsWith('') ? { texte: x.slice(1, -1), trouve: true } : { texte: x, trouve: false }));
  return { extrait: brut.replace(//g, '«').replace(//g, '»'), segments };
}

export async function rechercherPortefeuille(bd: AccesBd, acces: Acces, brute: string | undefined, pageBrute?: string): Promise<ResultatsPortefeuille> {
  if (estDeposant(acces)) throw new ForbiddenException('La recherche sur plusieurs dossiers n’est pas ouverte aux déposants');
  const requete = validerRequete(brute);
  const page = validerPage(pageBrute);
  try {
    return await bd.avecContexte(acces, (tx) => chercher(tx, requete, page));
  } catch (e) {
    // 57014 : requête annulée par le délai. Jamais de résultat partiel présenté comme complet.
    if (codeErreur(e) === '57014') throw new ServiceUnavailableException(`La recherche a dépassé le délai de ${DELAI_MAX_RECHERCHE_MS / 1000} s : précisez les termes ou cherchez dans un dossier.`);
    throw e;
  }
}

async function chercher(tx: Tx, requete: string, page: number): Promise<ResultatsPortefeuille> {
  await tx.execute(sql.raw(`set local statement_timeout = ${DELAI_MAX_RECHERCHE_MS}`));
  // Périmètre calculé par la base sous l'identité de la personne : jamais fourni par la requête.
  const autorises = await perimetreAutorise(tx);
  const base = {
    requete,
    perimetre: 'Pièces, écritures du lot actif et constats de la dernière exécution, dans les dossiers où vous avez au moins le niveau « lecture »',
    page,
    dossiersParPage: DOSSIERS_PAR_PAGE,
    dossiersAutorises: autorises.length,
    limites: { delaiMaxMs: DELAI_MAX_RECHERCHE_MS, piecesParDossier: MAX_PIECES_PAR_DOSSIER, ecrituresParDossier: MAX_ECRITURES_PAR_DOSSIER, constatsParDossier: MAX_CONSTATS_PAR_DOSSIER },
  };
  if (autorises.length === 0) return { ...base, dossiersAvecResultats: 0, dossiersSansResultat: 0, dossiers: [] };

  const liste = sql.join(autorises.map((d) => sql`${d.id}::uuid`), sql`, `);
  const ts = sql`websearch_to_tsquery('french', ${requete})`;
  const options = sql`'StartSel=, StopSel=, MaxWords=24, MinWords=8, MaxFragments=1'`;
  const vecteurPage = sql`to_tsvector('french', coalesce(p.texte, ''))`;
  const vecteurEcriture = sql`to_tsvector('french', l.ecriture_lib || ' ' || l.piece_ref || ' ' || l.compte_lib || ' ' || coalesce(l.comp_aux_lib, ''))`;
  const vecteurConstat = sql`to_tsvector('french', c.titre || ' ' || c.explication)`;

  // 1) Totaux par dossier et par catégorie (comptage seul : aucun contenu n'est lu pour les dossiers hors de la page).
  const compter = async (requeteSql: ReturnType<typeof sql>): Promise<Map<string, number>> => new Map(((await tx.execute(requeteSql)).rows as Array<{ id: string; n: number }>).map((l) => [l.id, Number(l.n)]));
  const [nPieces, nEcritures, nConstats] = await Promise.all([
    compter(sql`select p.entite_id as id, count(*)::int as n from pages_document p join documents d on d.id = p.document_id
                where p.entite_id in (${liste}) and d.statut <> 'quarantaine' and ${vecteurPage} @@ ${ts} group by p.entite_id`),
    compter(sql`select l.entite_id as id, count(*)::int as n from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
                where l.entite_id in (${liste}) and ${vecteurEcriture} @@ ${ts} group by l.entite_id`),
    compter(sql`select c.entite_id as id, count(*)::int as n from constats c join executions_controles e on e.id = c.execution_id and not e.obsolete
                where c.entite_id in (${liste}) and ${vecteurConstat} @@ ${ts} group by c.entite_id`),
  ]);

  // 2) Dossiers avec résultat, classés (total décroissant, nom, identifiant) ; page demandée.
  const avec = autorises
    .map((d) => ({ d, totaux: { pieces: nPieces.get(d.id) ?? 0, ecritures: nEcritures.get(d.id) ?? 0, constats: nConstats.get(d.id) ?? 0 } }))
    .filter((x) => x.totaux.pieces + x.totaux.ecritures + x.totaux.constats > 0)
    .sort((x, y) => y.totaux.pieces + y.totaux.ecritures + y.totaux.constats - (x.totaux.pieces + x.totaux.ecritures + x.totaux.constats) || x.d.nom.localeCompare(y.d.nom, 'fr') || x.d.id.localeCompare(y.d.id));
  const choisis = avec.slice((page - 1) * DOSSIERS_PAR_PAGE, page * DOSSIERS_PAR_PAGE);
  const sortie = { ...base, dossiersAvecResultats: avec.length, dossiersSansResultat: autorises.length - avec.length };
  if (choisis.length === 0) return { ...sortie, dossiers: [] };

  // 2 bis) Extraits des seuls dossiers de la page : les meilleurs par dossier (fenêtre), puis surlignage.
  const page_ = sql.join(choisis.map((x) => sql`${x.d.id}::uuid`), sql`, `);
  const pieces = (
    await tx.execute(sql`
      select x."entiteId", x."documentId", x."nomOrigine", x.page, x.statut,
             ts_headline('french', translate(x.texte, U&'\\E000\\E001', ''), ${ts}, ${options}) as extrait
      from (
        select p.entite_id as "entiteId", p.document_id as "documentId", d.nom_origine as "nomOrigine", p.numero as page, d.statut, coalesce(p.texte, '') as texte,
               row_number() over (partition by p.entite_id order by ts_rank(${vecteurPage}, ${ts}) desc, d.cree_le desc, p.document_id, p.numero) as rang
        from pages_document p join documents d on d.id = p.document_id
        where p.entite_id in (${page_}) and d.statut <> 'quarantaine' and ${vecteurPage} @@ ${ts}
      ) x where x.rang <= ${MAX_PIECES_PAR_DOSSIER} order by x."entiteId", x.rang`)
  ).rows as Array<{ entiteId: string; documentId: string; nomOrigine: string; page: number; statut: string; extrait: string }>;
  const ecritures = (
    await tx.execute(sql`
      select x.* from (
        select l.entite_id as "entiteId", l.id, l.exercice_id as "exerciceId", l.lot_import_id as "lotImportId", l.ecriture_date::text as date, l.journal_code as journal, l.ecriture_num as numero,
               l.compte_num as compte, l.piece_ref as piece, l.ecriture_lib as libelle, l.debit::text as debit, l.credit::text as credit,
               row_number() over (partition by l.entite_id order by l.ecriture_date desc, l.id) as rang
        from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
        where l.entite_id in (${page_}) and ${vecteurEcriture} @@ ${ts}
      ) x where x.rang <= ${MAX_ECRITURES_PAR_DOSSIER} order by x."entiteId", x.rang`)
  ).rows as Array<Record<string, unknown> & { entiteId: string }>;
  const constats = (
    await tx.execute(sql`
      select x.* from (
        select c.entite_id as "entiteId", c.id, c.exercice_id as "exerciceId", c.controle_id as "controleId", c.titre, c.statut_revue as "statutRevue", c.montant::text as montant,
               row_number() over (partition by c.entite_id order by c.cree_le desc, c.id) as rang
        from constats c join executions_controles e on e.id = c.execution_id and not e.obsolete
        where c.entite_id in (${page_}) and ${vecteurConstat} @@ ${ts}
      ) x where x.rang <= ${MAX_CONSTATS_PAR_DOSSIER} order by x."entiteId", x.rang`)
  ).rows as Array<Record<string, unknown> & { entiteId: string }>;

  const sansCle = <T extends { entiteId: string; rang?: unknown }>({ entiteId: _e, rang: _r, ...reste }: T) => reste;
  return {
    ...sortie,
    dossiers: choisis.map(({ d, totaux }) => ({
      id: d.id,
      nom: d.nom,
      niveau: d.niveau,
      totaux,
      pieces: pieces.filter((p) => p.entiteId === d.id).map((p) => ({ documentId: p.documentId, nomOrigine: p.nomOrigine, page: Number(p.page), statut: p.statut, ...segmenter(String(p.extrait ?? '')) })),
      ecritures: ecritures.filter((e) => e.entiteId === d.id).map(sansCle),
      constats: constats.filter((c) => c.entiteId === d.id).map(sansCle),
    })),
  };
}
