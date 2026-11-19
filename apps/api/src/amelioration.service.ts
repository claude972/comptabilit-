/**
 * AMÉLIORATION CONTRÔLÉE — lecture des décisions de revue du cabinet et appel du moteur déterministe
 * (`suggererAmeliorations` de `@comtaple/core`). Appelable sans HTTP.
 *
 * Règles tenues ici :
 * - toutes les lectures passent par `bd.avecContexte(acces, …)` : le cabinet vient de la session, et les politiques
 *   RLS limitent les décisions lues aux dossiers où la personne est habilitée (« périmètre autorisé ») ;
 * - aucune donnée d'un autre cabinet ne peut entrer dans le calcul : il n'existe aucune lecture hors contexte ;
 * - rien n'est écrit, sauf la décision d'ÉCARTER une suggestion (ajout seul, au nom de son auteur) ;
 * - aucune règle n'est créée ici : « proposer » passe par `POST v1/regles`, à l'initiative d'une personne.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CATALOGUE_CONTROLES,
  type CorrectionExtraction,
  CRITERES_AMELIORATION,
  controlesPourAmelioration,
  type DecisionAnterieure,
  type DecisionConstatRevue,
  type DecisionRapprochementRevue,
  normaliserNomTiers,
  type ResultatAmelioration,
  suggererAmeliorations,
  type SuggestionAmelioration,
} from '@comtaple/core';
import { type AccesBd, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Acces } from './acces.js';

/** Plafonds de lecture par nature de décision ; atteints, ils sont ANNONCÉS (les plus récentes sont gardées). */
const PLAFOND_DECISIONS = 20_000;
const PLAFOND_CORRECTIONS = 5_000;
const ROLES_AUTORISES = ['administrateur', 'associe', 'reviseur'];
const iso = (colonne: ReturnType<typeof sql>) => sql`to_char(${colonne} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface VueSuggestions extends Omit<ResultatAmelioration, 'suggestions'> {
  suggestions: Array<SuggestionAmelioration & { dossiers: Array<{ id: string; nom: string }> }>;
  perimetre: {
    /** Nombre de dossiers dont la personne peut lire les décisions. */
    dossiers: number;
    fenetreMois: number;
    mention: string;
    /** Natures de décisions dont le plafond de lecture a été atteint (les plus anciennes ne sont pas comptées). */
    plafondsAtteints: string[];
  };
}

export function exigerRoleAmelioration(acces: Acces): void {
  if (!ROLES_AUTORISES.includes(acces.role)) throw new ForbiddenException('Les suggestions d’amélioration sont réservées aux réviseurs, associés et administrateurs du cabinet');
}

function emetteurDe(champs: Record<string, unknown>): { cle: string | null; libelle: string | null } {
  const valeur = (nom: string): string | null => {
    const v = (champs[nom] as { valeur?: unknown } | null | undefined)?.valeur;
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const siren = valeur('emetteurSiren');
  const nom = valeur('emetteurNom');
  if (siren && /^\d{9}$/.test(siren)) return { cle: `siren:${siren}`, libelle: nom ?? `SIREN ${siren}` };
  const normalise = nom ? normaliserNomTiers(nom) : '';
  return normalise ? { cle: `nom:${normalise}`.slice(0, 120), libelle: nom } : { cle: null, libelle: null };
}

async function calculer(tx: Tx): Promise<VueSuggestions> {
  const depuis = sql`now() - make_interval(months => ${CRITERES_AMELIORATION.fenetreMois})`;
  const plafondsAtteints: string[] = [];
  const borner = <T>(lignes: T[], plafond: number, nature: string): T[] => {
    if (lignes.length > plafond) plafondsAtteints.push(nature);
    return lignes.slice(0, plafond);
  };

  const constats = borner(
    (
      await tx.execute(sql`
        select d.id as "decisionId", d.cible_id as "constatId", c.controle_id as "controleId", c.entite_id as "dossierId", c.exercice_id as "exerciceId",
               c.execution_id as "executionId", c.cle, d.action, d.motif, c.montant::text as montant, ${iso(sql`d.cree_le`)} as date
        from decisions d join constats c on c.id = d.cible_id
        where d.cible_type = 'constat' and d.action in ('accepter', 'rejeter', 'confirmer_anomalie', 'corriger', 'rouvrir') and d.cree_le >= ${depuis}
        order by d.cree_le desc, d.id limit ${PLAFOND_DECISIONS + 1}`)
    ).rows as unknown as DecisionConstatRevue[],
    PLAFOND_DECISIONS,
    'constats',
  );
  const rapprochements = borner(
    (
      await tx.execute(sql`
        select d.id as "decisionId", d.cible_id as "rapprochementId", r.entite_id as "dossierId", r.regle, d.action, d.motif, ${iso(sql`d.cree_le`)} as date
        from decisions d join rapprochements r on r.id = d.cible_id
        where d.cible_type = 'rapprochement' and d.cree_le >= ${depuis}
        order by d.cree_le desc, d.id limit ${PLAFOND_DECISIONS + 1}`)
    ).rows as unknown as DecisionRapprochementRevue[],
    PLAFOND_DECISIONS,
    'rapprochements',
  );
  // Extraction en vigueur de chaque pièce, quand elle porte au moins un champ corrigé à la main.
  const extractions = borner(
    (
      await tx.execute(sql`
        select e.document_id as "documentId", e.entite_id as "dossierId", e.champs, ${iso(sql`e.cree_le`)} as date
        from extractions e join documents d on d.id = e.document_id
        where e.actuelle and e.methode = 'saisie_humaine' and d.statut not in ('remplace', 'quarantaine') and e.cree_le >= ${depuis}
        order by e.cree_le desc, e.id limit ${PLAFOND_CORRECTIONS + 1}`)
    ).rows as unknown as Array<{ documentId: string; dossierId: string; champs: Record<string, unknown>; date: string }>,
    PLAFOND_CORRECTIONS,
    'corrections d’extraction',
  );
  const corrections: CorrectionExtraction[] = extractions.map((e) => {
    const champs = Object.entries(e.champs ?? {})
      .filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v) && (v as { methode?: unknown }).methode === 'saisie_humaine')
      .map(([nom]) => nom);
    const emetteur = emetteurDe(e.champs ?? {});
    return { documentId: e.documentId, dossierId: e.dossierId, emetteur: emetteur.cle, emetteurLibelle: emetteur.libelle, champs, date: e.date };
  });

  // Règles du cabinet : une cible déjà proposée ou approuvée ne reçoit pas de suggestion ; une règle refusée ou
  // retirée vaut décision antérieure (la suggestion ne revient que sur des décisions postérieures).
  const regles = (
    await tx.execute(sql`
      select controle_id as "controleId", entite_id_cible as "entiteId", statut, coalesce(motif_decision, '') as motif, ${iso(sql`coalesce(decidee_le, cree_le)`)} as le
      from regles_cabinet`)
  ).rows as unknown as Array<{ controleId: string; entiteId: string | null; statut: string; motif: string; le: string }>;
  const empreinteRegle = (r: { controleId: string; entiteId: string | null }) => (r.entiteId ? `exception_dossier|${r.controleId}|${r.entiteId}` : `preference_cabinet|${r.controleId}`);
  const ecarteesBase = (
    await tx.execute(sql`select empreinte, motif, ${iso(sql`cree_le`)} as le from suggestions_ecartees`)
  ).rows as unknown as DecisionAnterieure[];
  const ecartees: DecisionAnterieure[] = [
    ...ecarteesBase,
    ...regles
      .filter((r) => r.statut === 'refusee' || r.statut === 'retiree')
      .map((r) => ({ empreinte: empreinteRegle(r), le: r.le, motif: r.statut === 'refusee' ? `Règle refusée${r.motif ? ` : ${r.motif}` : ''}` : 'Règle retirée' })),
  ];

  const resultat = suggererAmeliorations({
    constats,
    corrections,
    rapprochements,
    controles: controlesPourAmelioration(CATALOGUE_CONTROLES),
    ecartees,
    reglesEnCours: regles.filter((r) => r.statut === 'proposee' || r.statut === 'approuvee').map(empreinteRegle),
  });

  const visibles = (await tx.execute(sql`select e.id, e.raison_sociale as nom from entites e where app_niveau_entite(e.id) >= 'lecture'`)).rows as unknown as Array<{ id: string; nom: string }>;
  const nomDe = new Map(visibles.map((d) => [d.id, d.nom]));
  return {
    ...resultat,
    suggestions: resultat.suggestions.map((x) => ({ ...x, dossiers: x.dossierIds.map((id) => ({ id, nom: nomDe.get(id) ?? 'Dossier' })) })),
    perimetre: {
      dossiers: visibles.length,
      fenetreMois: CRITERES_AMELIORATION.fenetreMois,
      mention: 'Calculé sur les seules décisions de ce cabinet, dans les dossiers où vous êtes habilité. Une récurrence portée par des dossiers que vous ne voyez pas n’apparaît pas ici.',
      plafondsAtteints,
    },
  };
}

/** Suggestions d'amélioration du cabinet, dans le périmètre autorisé de la personne (réviseur, associé, administrateur). */
export async function lireSuggestions(bd: AccesBd, acces: Acces): Promise<VueSuggestions> {
  exigerRoleAmelioration(acces);
  return bd.avecContexte(acces, (tx) => calculer(tx));
}

/**
 * Écarte une suggestion EN COURS (recalculée ici : une empreinte forgée ou périmée est refusée, 404). La décision est
 * conservée avec son motif ; la suggestion ne reviendra que si des décisions postérieures atteignent seules les seuils.
 */
export async function ecarterSuggestion(bd: AccesBd, acces: Acces, demande: { empreinte: string; motif: string }) {
  exigerRoleAmelioration(acces);
  return bd.avecContexte(acces, async (tx) => {
    const vue = await calculer(tx);
    const cible = vue.suggestions.find((x) => x.empreinte === demande.empreinte && x.categorie !== 'correction_donnee');
    if (!cible) throw new NotFoundException('Suggestion introuvable : elle n’est plus d’actualité ou a déjà été écartée');
    const [ligne] = await tx
      .insert(s.suggestionsEcartees)
      .values({
        cabinetId: acces.cabinetId,
        empreinte: cible.empreinte,
        categorie: cible.categorie,
        controleId: cible.controleId,
        entiteId: cible.portee === 'dossier' ? (cible.dossierIds[0] ?? null) : null,
        versionCriteres: vue.criteres.version,
        decomptes: cible.preuves.decomptes,
        motif: demande.motif,
        ecarteePar: acces.utilisateurId,
      })
      .returning();
    await journaliser(tx, {
      cabinetId: acces.cabinetId,
      acteurId: acces.utilisateurId,
      action: 'suggestion.ecartee',
      cibleType: 'suggestion_amelioration',
      cibleId: ligne!.id,
      entiteId: cible.portee === 'dossier' ? (cible.dossierIds[0] ?? null) : null,
      details: { categorie: cible.categorie, controleId: cible.controleId, versionCriteres: vue.criteres.version, decomptes: cible.preuves.decomptes },
    });
    return ligne;
  });
}
