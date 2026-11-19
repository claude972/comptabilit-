/**
 * ANCRES du journal d'audit : FORMAT et VÉRIFICATION HORS BASE.
 *
 * Ce module ne fournit PAS un ancrage externe. Il prépare ce qu'un tel ancrage exigerait :
 *  - un export du journal d'un cabinet, vérifiable sans PostgreSQL (chaque ligne porte les octets exacts qui ont servi
 *    à calculer son empreinte) ;
 *  - une « ancre » : un petit document qui fige l'état du journal à un instant (dernière ligne, son empreinte, nombre
 *    de lignes), chaîné à l'ancre précédente ;
 *  - une vérification, sans base ni réseau, d'un export contre une suite d'ancres.
 *
 * Une ancre n'a de valeur de preuve que si elle est conservée HORS de portée de qui administre la base : dépôt chez un
 * tiers, horodatage qualifié, publication. Aucune destination indépendante n'est configurée dans ce projet : une ancre
 * écrite sur le même poste ou dans la même base ne prouve rien contre un administrateur, et le code le dit.
 *
 * La vérification STRICTE de la chaîne reste la référence (D-038) ; l'ancre y ajoute ce que la chaîne seule ne peut pas
 * montrer : la réécriture complète de la fin du journal, ou la suppression de ses dernières lignes.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';

export const FORMAT_EXPORT = 'comtaple.journal-export/1';
export const FORMAT_ANCRE = 'comtaple.ancre-journal/1';

/** Une ligne exportée. `detailsTexte` et `horodatage` sont les chaînes EXACTES entrées dans le calcul de l'empreinte. */
export interface LigneJournalExportee {
  id: string;
  cabinetId: string;
  acteurId: string | null;
  acteurType: string;
  action: string;
  cibleType: string | null;
  cibleId: string | null;
  entiteId: string | null;
  detailsTexte: string;
  horodatage: string;
  empreintePrecedente: string | null;
  empreinte: string;
}

export interface AncreJournal {
  format: typeof FORMAT_ANCRE;
  cabinetId: string;
  /** Rang de l'ancre pour ce cabinet, à partir de 1. */
  rang: number;
  /** Numéro et empreinte de la dernière ligne du journal au moment de l'ancre ; null pour un journal vide. */
  derniereLigne: string | null;
  empreinteTete: string | null;
  nombreLignes: number;
  /** Résultat de la vérification stricte de la base au moment de l'ancre : null si intègre, sinon première ligne incohérente. */
  verificationStricte: string | null;
  etablieLe: string;
  /** Empreinte de l'ancre précédente du même cabinet ; null pour la première. */
  ancrePrecedente: string | null;
}

const sha256 = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');

/** Même calcul que la fonction SQL `journal_audit_empreinte` (migration 0001), sur les chaînes exportées. */
export function empreinteLigne(l: Omit<LigneJournalExportee, 'empreinte' | 'id'>): string {
  return sha256(
    [l.empreintePrecedente ?? '', l.cabinetId, l.acteurId ?? '', l.acteurType, l.action, l.cibleType ?? '', l.cibleId ?? '', l.entiteId ?? '', l.detailsTexte, l.horodatage].join('|'),
  );
}

/** Sérialisation canonique d'une ancre : clés dans un ordre fixe, sans espace. C'est ce texte qui est haché et déposé. */
export function serialiserAncre(a: AncreJournal): string {
  return JSON.stringify({
    format: a.format,
    cabinetId: a.cabinetId,
    rang: a.rang,
    derniereLigne: a.derniereLigne,
    empreinteTete: a.empreinteTete,
    nombreLignes: a.nombreLignes,
    verificationStricte: a.verificationStricte,
    etablieLe: a.etablieLe,
    ancrePrecedente: a.ancrePrecedente,
  });
}
export const empreinteAncre = (a: AncreJournal) => sha256(serialiserAncre(a));

/** Construit l'ancre suivante à partir de l'état lu en base (ou dans un export) et de l'ancre précédente. */
export function etablirAncre(etat: { cabinetId: string; derniereLigne: string | null; empreinteTete: string | null; nombreLignes: number; verificationStricte: string | null }, precedente: AncreJournal | null, etablieLe = new Date().toISOString()): AncreJournal {
  if (precedente && precedente.cabinetId !== etat.cabinetId) throw new Error('L’ancre précédente appartient à un autre cabinet');
  if (precedente && etat.nombreLignes < precedente.nombreLignes) throw new Error('Le journal compte moins de lignes qu’à l’ancre précédente : il a été amputé. Aucune ancre n’est établie.');
  return { format: FORMAT_ANCRE, ...etat, rang: (precedente?.rang ?? 0) + 1, etablieLe, ancrePrecedente: precedente ? empreinteAncre(precedente) : null };
}

/** État du journal d'un cabinet, lu avec le rôle d'administration (lecture seule). */
export async function lireEtatJournal(client: pg.ClientBase, cabinetId: string) {
  // Tri sur la colonne numérique `j.id` (un tri sur le texte choisirait 999 plutôt que 1000 comme dernière ligne).
  const r = await client.query<{ derniere: string | null; tete: string | null; n: string; stricte: string | null }>(
    `select (select j.id::text from journal_audit j where j.cabinet_id = $1 order by j.id desc limit 1) as derniere,
            (select j.empreinte from journal_audit j where j.cabinet_id = $1 order by j.id desc limit 1) as tete,
            (select count(*) from journal_audit where cabinet_id = $1) as n,
            journal_audit_verifier($1)::text as stricte`,
    [cabinetId],
  );
  const l = r.rows[0]!;
  return { cabinetId, derniereLigne: l.derniere, empreinteTete: l.tete, nombreLignes: Number(l.n), verificationStricte: l.stricte };
}

/** Lit le journal d'un cabinet par tranches, dans la forme exportable (lecture seule). */
export async function* exporterJournal(client: pg.ClientBase, cabinetId: string, tranche = 5000): AsyncGenerator<LigneJournalExportee> {
  let dernier = '0';
  for (;;) {
    // Le tri porte sur la colonne numérique `j.id` : trier sur l'alias texte « id » rangerait 100 avant 99.
    const r = await client.query<LigneJournalExportee>(
      `select j.id::text as "id", cabinet_id::text as "cabinetId", acteur_id::text as "acteurId", acteur_type as "acteurType", action,
              cible_type as "cibleType", cible_id as "cibleId", entite_id_cible::text as "entiteId", details::text as "detailsTexte",
              to_char(horodatage at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "horodatage",
              empreinte_precedente as "empreintePrecedente", empreinte
         from journal_audit j where j.cabinet_id = $1 and j.id > $2::bigint order by j.id limit $3`,
      [cabinetId, dernier, tranche],
    );
    if (!r.rowCount) return;
    yield* r.rows;
    dernier = r.rows[r.rows.length - 1]!.id;
  }
}

export interface ResultatVerification {
  lignes: number;
  /** Première ligne incohérente de la chaîne, ou null. Équivalent hors base de la vérification stricte. */
  rupture: { ligne: string; motif: string } | null;
  ancres: Array<{ rang: number; conforme: boolean; motif: string | null }>;
  conforme: boolean;
}

/**
 * Vérifie, sans base ni réseau, un export de journal contre une suite d'ancres du même cabinet (dans l'ordre).
 * Les lignes sont consommées en flux : seul l'état nécessaire aux ancres est gardé en mémoire.
 */
export async function verifierExport(lignes: AsyncIterable<LigneJournalExportee> | Iterable<LigneJournalExportee>, ancres: readonly AncreJournal[]): Promise<ResultatVerification> {
  const resultat: ResultatVerification = { lignes: 0, rupture: null, ancres: [], conforme: false };
  const attendues = new Map<string, AncreJournal[]>();
  for (const a of ancres) if (a.derniereLigne !== null) attendues.set(a.derniereLigne, [...(attendues.get(a.derniereLigne) ?? []), a]);
  const vues = new Map<number, { empreinte: string; rangLigne: number }>();
  let precedente: string | null = null;
  let dernierId = 0n;
  let cabinet: string | null = null;
  for await (const l of lignes) {
    resultat.lignes++;
    if (!resultat.rupture) {
      const motif =
        cabinet !== null && l.cabinetId !== cabinet ? 'ligne d’un autre cabinet'
        : BigInt(l.id) <= dernierId ? 'numéros non croissants'
        : l.empreinte !== empreinteLigne(l) ? 'empreinte ne correspondant pas au contenu'
        : l.empreintePrecedente !== precedente ? 'ne s’enchaîne pas à la ligne précédente'
        : !contenuCoherent(l.detailsTexte) ? 'détails illisibles'
        : null;
      if (motif) resultat.rupture = { ligne: l.id, motif };
    }
    cabinet ??= l.cabinetId;
    dernierId = BigInt(l.id);
    precedente = l.empreinte;
    for (const a of attendues.get(l.id) ?? []) vues.set(a.rang, { empreinte: l.empreinte, rangLigne: resultat.lignes });
  }

  let ancrePrecedente: AncreJournal | null = null;
  for (const a of ancres) {
    const vue = vues.get(a.rang);
    const motif =
      a.format !== FORMAT_ANCRE ? 'format inconnu'
      : cabinet !== null && a.cabinetId !== cabinet ? 'ancre d’un autre cabinet'
      : a.rang !== (ancrePrecedente?.rang ?? 0) + 1 ? 'rang inattendu : une ancre manque ou l’ordre est faux'
      : a.ancrePrecedente !== (ancrePrecedente ? empreinteAncre(ancrePrecedente) : null) ? 'ne s’enchaîne pas à l’ancre précédente'
      : ancrePrecedente && a.nombreLignes < ancrePrecedente.nombreLignes ? 'moins de lignes qu’à l’ancre précédente'
      : a.derniereLigne === null ? (a.nombreLignes === 0 ? null : 'ancre incohérente')
      : !vue ? 'la dernière ligne figée par l’ancre est absente du journal'
      : vue.empreinte !== a.empreinteTete ? 'la ligne figée par l’ancre n’a plus la même empreinte : le journal a été réécrit'
      : vue.rangLigne !== a.nombreLignes ? 'le nombre de lignes jusqu’à l’ancre a changé : des lignes ont été retirées ou insérées'
      : null;
    resultat.ancres.push({ rang: a.rang, conforme: motif === null, motif });
    ancrePrecedente = a;
  }
  resultat.conforme = resultat.rupture === null && resultat.ancres.every((a) => a.conforme);
  return resultat;
}

function contenuCoherent(detailsTexte: string): boolean {
  try {
    return typeof JSON.parse(detailsTexte) === 'object';
  } catch {
    return false;
  }
}
