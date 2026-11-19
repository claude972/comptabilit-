import type { DemandePassage, LigneEcriture, OrdrePassage, SourceLignes } from '@comtaple/core';
import { sql, type Tx } from '@comtaple/db';

/** Une lecture de la base a échoué pendant un passage : le traitement ne peut rien conclure et doit être repris. */
export class ErreurLectureSource extends Error {
  constructor(cause: unknown) {
    super(`Lecture en flux des lignes d'écriture interrompue : ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 500), { cause });
    this.name = 'ErreurLectureSource';
  }
}

/**
 * Ordres de passage. Les clés de groupe sont EXACTEMENT celles du moteur (mêmes champs, même séparateur U+0001) et
 * sont comparées octet par octet (collation « C ») : deux lignes ont la même clé en base si et seulement si elles
 * l'ont dans le moteur. Dans un groupe, l'ordre du fichier.
 */
const ORDRES: Record<OrdrePassage, ReturnType<typeof sql>> = {
  fichier: sql`numero_ligne`,
  ecriture: sql`(journal_code || E'\\x01' || ecriture_num) collate "C", numero_ligne`,
  tiers: sql`(compte_num || E'\\x01' || coalesce(comp_aux_num, compte_num)) collate "C", numero_ligne`,
  compte: sql`compte_num collate "C", numero_ligne`,
};

const PREFIXE_NUMERIQUE = /^\d{1,12}$/;
let compteurCurseurs = 0;

/**
 * Lignes d'un lot comptable lues par passages successifs, au moyen d'un curseur PostgreSQL : la mémoire du worker ne
 * porte qu'une page à la fois. À n'utiliser que dans la transaction `tx` (un curseur ne lui survit pas).
 * Les colonnes sont rendues sous la même forme que `lignesDuLot` (dates en AAAA-MM-JJ, montants en chaînes décimales).
 */
export function sourceDuLot(tx: Tx, lotImportId: string, nbLignes: number, options: { taillePage?: number } = {}): SourceLignes {
  const taillePage = options.taillePage ?? 5000;
  return {
    nbLignes,
    async *parcourir(demande: DemandePassage): AsyncGenerator<LigneEcriture> {
      const filtres = [sql`lot_import_id = ${lotImportId}::uuid`];
      // Restrictions : des optimisations de lecture seulement (le moteur refiltre). Un préfixe inattendu les désactive.
      const prefixes = demande.prefixesComptes;
      if (prefixes !== undefined && prefixes.every((p) => PREFIXE_NUMERIQUE.test(p))) {
        filtres.push(prefixes.length === 0 ? sql`false` : sql`(${sql.join(prefixes.map((p) => sql`compte_num like ${`${p}%`}`), sql` or `)})`);
      }
      const journaux = demande.journaux;
      if (journaux !== undefined) filtres.push(journaux.length === 0 ? sql`false` : sql`journal_code in (${sql.join(journaux.map((j) => sql`${j}`), sql`, `)})`);
      const curseur = sql.identifier(`flux_lignes_${++compteurCurseurs}`);
      const executer = async (requete: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> => {
        try {
          return (await tx.execute(requete)).rows as Record<string, unknown>[];
        } catch (e) {
          throw new ErreurLectureSource(e);
        }
      };
      await executer(sql`
        declare ${curseur} no scroll cursor for
        select id, numero_ligne as "numeroLigne", journal_code as "journalCode", journal_lib as "journalLib", ecriture_num as "ecritureNum",
               to_char(ecriture_date, 'YYYY-MM-DD') as "ecritureDate", compte_num as "compteNum", compte_lib as "compteLib",
               comp_aux_num as "compAuxNum", comp_aux_lib as "compAuxLib", piece_ref as "pieceRef", to_char(piece_date, 'YYYY-MM-DD') as "pieceDate",
               ecriture_lib as "ecritureLib", debit::text as debit, credit::text as credit, ecriture_let as "ecritureLet",
               to_char(date_let, 'YYYY-MM-DD') as "dateLet", to_char(valid_date, 'YYYY-MM-DD') as "validDate", montant_devise::text as "montantDevise", idevise
          from lignes_ecriture
         where ${sql.join(filtres, sql` and `)}
         order by ${ORDRES[demande.ordre]}`);
      try {
        for (;;) {
          const page = await executer(sql`fetch forward ${sql.raw(String(taillePage))} from ${curseur}`);
          for (const l of page) yield l as unknown as LigneEcriture;
          if (page.length < taillePage) break;
        }
      } finally {
        // Fermeture même si le contrôle s'arrête avant la fin ; sans effet si la transaction est déjà en échec.
        await tx.execute(sql`close ${curseur}`).catch(() => undefined);
      }
    },
  };
}

/**
 * Prépare la source d'un lot : nombre de lignes, et vérification du contrat de la source (numéros de ligne distincts,
 * donc ordre du fichier déterminé). `ordreDetermine` faux : le traitement en flux ne doit pas être tenté.
 */
export async function preparerSourceDuLot(tx: Tx, lotImportId: string): Promise<{ source: SourceLignes; ordreDetermine: boolean }> {
  const r = (await tx.execute(sql`select count(*)::int as n, count(distinct numero_ligne)::int as distincts from lignes_ecriture where lot_import_id = ${lotImportId}::uuid`)).rows[0] as { n: number; distincts: number } | undefined;
  const n = Number(r?.n ?? 0);
  return { source: sourceDuLot(tx, lotImportId, n), ordreDetermine: n === Number(r?.distincts ?? 0) };
}
