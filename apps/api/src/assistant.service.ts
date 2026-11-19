/**
 * ASSISTANT DOCUMENTÉ — service appelable sans HTTP (le contrôleur et les tests d'intégration appellent la même fonction).
 *
 * Règles tenues ici :
 * - le cabinet et l'utilisateur viennent de l'identité authentifiée (`Acces`), le dossier de l'URL validée ; rien ne
 *   vient du modèle ni du corps de la requête ;
 * - l'habilitation (niveau « lecture » au moins) est vérifiée AVANT toute recherche ;
 * - chaque lecture de données passe par `bd.avecContexte(acces, …)` : les politiques RLS s'appliquent avec l'identité
 *   de l'utilisateur, en mode IA comme sans IA ;
 * - aucune requête SQL n'est construite à partir d'un texte (question ou argument du modèle) : paramètres liés seulement ;
 * - les contenus de pièces, libellés d'écritures et noms de fichiers sont des DONNÉES non fiables : jamais interprétés.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { calculerIndicateurs, CATALOGUE_INDICATEURS, type LigneEcriture, SOURCES } from '@comtaple/core';
import { type AccesBd, and, desc, eq, journaliser, lt, schema as s, sql, type Tx } from '@comtaple/db';
import {
  type ContexteFonction,
  creerFonctionsMetierTypes,
  type ElementSource,
  type FonctionMetier,
  fusionnerClassements,
  type Habilitations,
  normaliserMotsCles,
  type PortsFonctionsMetier,
  type ReponseAssistant,
  repondreQuestion,
  type ResultatFonction,
  type StatutIa,
  vectoriserRequete,
} from '@comtaple/ia';
import { lignesDuLot, type ServicesIa } from '@comtaple/plateforme';
import { type Acces, auMoins, exigerNiveau, type Niveau, niveauSur } from './acces.js';

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 1000;
/** Au-delà, l'indicateur n'est pas calculé à la volée (même borne que les états de travail). */
const PLAFOND_LIGNES = 400_000;

/** Niveau d'habilitation exigé sur le dossier pour chaque habilitation déclarée par une fonction métier. */
const NIVEAU_REQUIS: Record<string, Niveau> = {
  'pieces.lire': 'lecture',
  'ecritures.lire': 'lecture',
  'controles.lire': 'lecture',
  'indicateurs.lire': 'lecture',
  'veille.lire': 'lecture',
};

/** Indicateurs proposés à l'assistant et mots-clés (sans accents) qui les déclenchent en mode sans IA. Les plus précis d'abord. */
const INDICATEURS_ASSISTANT: Array<{ id: string; motsCles: string[] }> = [
  { id: 'TAUX-MARGE-COMMERCIALE', motsCles: ['taux de marge'] },
  { id: 'SIG-MARGE-COMMERCIALE', motsCles: ['marge commerciale'] },
  { id: 'SIG-CA', motsCles: ['chiffre d’affaires', 'chiffre d\'affaires', 'chiffre d affaires'] },
  { id: 'SIG-VALEUR-AJOUTEE', motsCles: ['valeur ajoutee'] },
  { id: 'SIG-EBE', motsCles: ['excedent brut', 'ebe'] },
  { id: 'SIG-RESULTAT-EXPLOITATION', motsCles: ['resultat d’exploitation', 'resultat d\'exploitation', 'resultat d exploitation'] },
  { id: 'SIG-RESULTAT-COURANT', motsCles: ['resultat courant'] },
  { id: 'SIG-RESULTAT-EXERCICE', motsCles: ['resultat de l’exercice', 'resultat de l\'exercice', 'resultat net', 'benefice'] },
  { id: 'BFR-JOURS', motsCles: ['bfr en jours'] },
  { id: 'BFR', motsCles: ['besoin en fonds de roulement', 'bfr'] },
  { id: 'DELAI-CLIENTS', motsCles: ['delai clients', 'delai client', 'delai de reglement des clients'] },
  { id: 'DELAI-FOURNISSEURS', motsCles: ['delai fournisseurs', 'delai fournisseur', 'delai de reglement des fournisseurs'] },
  { id: 'TRESORERIE-NETTE', motsCles: ['tresorerie nette', 'tresorerie'] },
  { id: 'CAPITAUX-PROPRES', motsCles: ['capitaux propres'] },
  { id: 'RATIO-ENDETTEMENT', motsCles: ['ratio d’endettement', 'ratio d\'endettement', 'taux d’endettement', 'taux d\'endettement'] },
  { id: 'ENDETTEMENT-FINANCIER', motsCles: ['endettement'] },
  { id: 'FONDS-DE-ROULEMENT', motsCles: ['fonds de roulement'] },
];

export interface DependancesAssistant {
  bd: AccesBd;
  ia: ServicesIa;
}

export interface ExerciceAnalyse {
  id: string;
  debut: string;
  fin: string;
}

export interface ReponseQuestion {
  /** Identifiant de l'échange enregistré ; `null` si l'enregistrement n'a pas été possible (voir `echangeEnregistre`). */
  echangeId: string | null;
  echangeEnregistre: boolean;
  /** `sans_ia` : recherche et calculs du moteur ; `simulateur` : SIMULATEUR de test ; `ia` : modèle réel. */
  mode: 'sans_ia' | 'simulateur' | 'ia';
  exercice: ExerciceAnalyse | null;
  /** Réponse du paquet `@comtaple/ia`, telle quelle. */
  reponse: ReponseAssistant;
  ia: { statut: StatutIa; raisons: string[] };
}

// ───────────────────────────── Limite de débit (par utilisateur, fenêtre glissante) ─────────────────────────────

const FENETRE_MS = 60_000;
export const QUESTIONS_PAR_MINUTE = 20;
const horodatages = new Map<string, number[]>();

/** Refuse (429) au-delà de `limite` appels par minute pour une même clé. En mémoire du processus : borne simple, pas un quota. */
export function limiterDebitIa(cle: string, limite = QUESTIONS_PAR_MINUTE, maintenant = Date.now()): void {
  const recents = (horodatages.get(cle) ?? []).filter((t) => t > maintenant - FENETRE_MS);
  if (recents.length >= limite) {
    horodatages.set(cle, recents);
    throw new HttpException('Trop de demandes en peu de temps : patientez une minute avant de réessayer.', 429);
  }
  recents.push(maintenant);
  horodatages.set(cle, recents);
  if (horodatages.size > 5000) for (const [k, v] of horodatages) if (v.every((t) => t <= maintenant - FENETRE_MS)) horodatages.delete(k);
}

// ───────────────────────────── Recherche plein texte : mots → requête, sans SQL construit ─────────────────────────────

/**
 * Mots d'un texte libre, bornés. Découpage sur les espaces seulement (« FF-000123 » reste entier : la base le découpe
 * comme elle a découpé le texte indexé). Le texte ne sert jamais qu'en paramètre lié.
 */
export function motsDeRecherche(texte: string): string[] {
  return texte
    .normalize('NFC')
    .split(/\s+/)
    .map((m) => m.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((m) => m.length >= 2 && m.length <= 60)
    .slice(0, 24);
}

/**
 * Requête plein texte « l'un des mots » (les mots vides du français sont écartés par la base). Une question entière
 * exigerait sinon tous ses mots dans le même passage. Renvoie '' si aucun mot utile.
 */
async function requetePleinTexte(tx: Tx, texte: string): Promise<string> {
  const mots = motsDeRecherche(texte).join(' ');
  if (mots === '') return '';
  const r = await tx.execute(sql`
    select coalesce(string_agg(distinct x.q::text, ' | '), '') as t
    from (select plainto_tsquery('french', m) as q from regexp_split_to_table(${mots}, ' ') as m) x
    where numnode(x.q) > 0`);
  return String(r.rows[0]?.t ?? '');
}

const couper = (texte: string, max: number): string => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);
const propre = (texte: string): string => texte.replace(/[]/g, '').replace(/\s+/g, ' ').trim();

interface PassageTrouve {
  cle: string;
  documentId: string;
  page: number;
  nomOrigine: string;
  extrait: string;
  texte: string;
}

// ───────────────────────────── Ports des fonctions métier, sur les données réelles ─────────────────────────────

/**
 * Ports des fonctions métier pour UN utilisateur et UN dossier déjà contrôlés. Chaque port relit ses données dans
 * une transaction posée avec l'identité de l'utilisateur (RLS) et filtre sur le dossier et la période du contexte
 * fourni par l'orchestrateur (jamais par le modèle).
 */
export function creerPortsAssistant(dep: DependancesAssistant, acces: Acces, dossierId: string, exercice: ExerciceAnalyse | null, options: { plafondLignes?: number } = {}): PortsFonctionsMetier {
  const { bd, ia } = dep;
  const plafondLignes = options.plafondLignes ?? PLAFOND_LIGNES;
  const lire = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => bd.avecContexte(acces, fn);
  // Défense en profondeur : l'orchestrateur ne transmet que le périmètre imposé, on le revérifie quand même.
  const exigerContexte = (c: ContexteFonction, avecDossier: boolean): void => {
    if (c.cabinetId !== acces.cabinetId || c.utilisateurId !== acces.utilisateurId || (avecDossier ? c.dossierId !== dossierId : c.dossierId !== null)) throw new Error('contexte_inattendu');
  };
  const SANS_EXERCICE = 'Aucun exercice n’est ouvert dans ce dossier : la comptabilité n’a pas été interrogée.';

  const lotActif = async (tx: Tx): Promise<typeof s.lotsImport.$inferSelect | null> => {
    if (!exercice) return null;
    const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, exercice.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
    return lot ?? null;
  };

  return {
    async rechercherDocuments(c, args): Promise<ResultatFonction> {
      exigerContexte(c, true);
      const colonnes = (texte: ReturnType<typeof sql>, q: ReturnType<typeof sql>) => sql`ts_headline('french', translate(${texte}, U&'\\E000\\E001', ''), ${q}, 'StartSel=, StopSel=, MaxWords=40, MinWords=12, MaxFragments=1') as extrait, left(${texte}, 4000) as texte`;
      const exclus = sql`d.statut not in ('remplace', 'quarantaine')`;
      const texte = await lire(async (tx) => {
        const t = await requetePleinTexte(tx, args.requete);
        if (t === '') return { passages: [] as PassageTrouve[], vecteurs: false };
        const q = sql`${t}::tsquery`;
        // Passages indexés par le worker ; pour une pièce analysée avant l'indexation, le texte de ses pages.
        const r = await tx.execute(sql`
          select p.document_id as "documentId", p.page, p.rang, 'passage' as origine, d.nom_origine as "nomOrigine", ${colonnes(sql`p.texte`, q)},
                 ts_rank(to_tsvector('french', p.texte), ${q}) as score
          from passages_recherche p join documents d on d.id = p.document_id
          where p.entite_id = ${dossierId}::uuid and ${exclus} and to_tsvector('french', p.texte) @@ ${q}
          union all
          select g.document_id, g.numero, 0, 'page', d.nom_origine, ${colonnes(sql`coalesce(g.texte, '')`, q)},
                 ts_rank(to_tsvector('french', coalesce(g.texte, '')), ${q}) as score
          from pages_document g join documents d on d.id = g.document_id
          where g.entite_id = ${dossierId}::uuid and ${exclus} and to_tsvector('french', coalesce(g.texte, '')) @@ ${q}
            and not exists (select 1 from passages_recherche x where x.document_id = g.document_id)
          order by score desc, "documentId", page, rang limit 60`);
        const nature = ia.natureFournisseur;
        const vecteurs = ia.modeleUtilisable() && nature !== null
          ? Boolean((await tx.execute(sql`select 1 from passages_recherche where entite_id = ${dossierId}::uuid and nature_vecteur = ${nature} limit 1`)).rows[0])
          : false;
        return { passages: (r.rows as Array<Record<string, unknown>>).map(versPassage), vecteurs };
      });

      let classes = texte.passages;
      // Fusion avec le classement vectoriel UNIQUEMENT si des vecteurs de la nature du fournisseur en service existent.
      if (texte.vecteurs) {
        const v = await vectoriserRequete(ia.active(), args.requete, { cabinetId: acces.cabinetId, dossierId, utilisateurId: acces.utilisateurId });
        if (v.etat === 'ok') {
          const litteral = `[${v.vecteur.join(',')}]`;
          const proches = await lire(async (tx) =>
            (
              await tx.execute(sql`
                select p.document_id as "documentId", p.page, p.rang, 'passage' as origine, d.nom_origine as "nomOrigine", left(p.texte, 300) as extrait, left(p.texte, 4000) as texte
                from passages_recherche p join documents d on d.id = p.document_id
                where p.entite_id = ${dossierId}::uuid and ${exclus} and p.nature_vecteur = ${ia.natureFournisseur} and p.modele = ${v.modele}
                order by p.vecteur <=> ${litteral}::vector limit 30`)
            ).rows as Array<Record<string, unknown>>,
          );
          const parCle = new Map<string, PassageTrouve>();
          for (const p of [...texte.passages, ...proches.map(versPassage)]) if (!parCle.has(p.cle)) parCle.set(p.cle, p);
          classes = fusionnerClassements([texte.passages.map((p) => p.cle), proches.map((p) => versPassage(p).cle)]).flatMap((f) => parCle.get(f.id) ?? []);
        }
      }

      const elements: ElementSource[] = [];
      for (const p of classes) {
        const id = `piece:${p.documentId}:p${p.page}`;
        if (elements.length >= args.limite || elements.some((e) => e.id === id)) continue;
        elements.push({
          id,
          nature: 'piece',
          libelle: couper(`${propre(p.nomOrigine)} — page ${p.page}`, 300),
          contenu: p.texte,
          dossierId,
          valeurs: { page: String(p.page), extrait: couper(propre(p.extrait), 400) },
        });
      }
      return { elements };
    },

    async rechercherEcritures(c, args): Promise<ResultatFonction> {
      exigerContexte(c, true);
      if (!exercice) return { elements: [], donneesManquantes: [SANS_EXERCICE] };
      return lire(async (tx) => {
        if (!(await lotActif(tx))) return { elements: [], donneesManquantes: ['Aucune donnée comptable importée pour cet exercice.'] };
        const t = await requetePleinTexte(tx, args.requete);
        if (t === '' && !args.comptePrefixe) return { elements: [] };
        const vecteur = sql`to_tsvector('french', l.ecriture_lib || ' ' || l.piece_ref || ' ' || l.compte_lib || ' ' || coalesce(l.comp_aux_lib, ''))`;
        const q = sql`${t}::tsquery`;
        const r = await tx.execute(sql`
          select l.id, l.ecriture_date::text as date, l.journal_code as journal, l.ecriture_num as numero, l.compte_num as compte, l.compte_lib as "compteLib",
                 l.piece_ref as piece, l.ecriture_lib as libelle, l.debit::text as debit, l.credit::text as credit
          from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif
          where l.entite_id = ${dossierId}::uuid and l.exercice_id = ${exercice.id}::uuid
            and l.ecriture_date between ${c.periode.debut}::date and ${c.periode.fin}::date
            ${args.comptePrefixe ? sql`and l.compte_num like ${`${args.comptePrefixe}%`}` : sql``}
            ${t !== '' ? sql`and ${vecteur} @@ ${q}` : sql``}
          order by ${t !== '' ? sql`ts_rank(${vecteur}, ${q}) desc,` : sql``} l.ecriture_date desc, l.id limit ${args.limite}`);
        const elements = (r.rows as Array<Record<string, string>>).map(
          (l): ElementSource => ({
            id: `ecriture:${l.id}`,
            nature: 'ecriture',
            libelle: couper(`Écriture ${propre(l.journal ?? '')} n° ${propre(l.numero ?? '')} du ${l.date}`, 300),
            contenu: l.libelle ?? '',
            dossierId,
            valeurs: { date: l.date ?? '', journal: couper(l.journal ?? '', 100), compte: couper(l.compte ?? '', 100), pièce: couper(l.piece ?? '', 200), libellé: couper(propre(l.libelle ?? ''), 300), débit: l.debit ?? '', crédit: l.credit ?? '' },
          }),
        );
        return { elements };
      });
    },

    async lireBalance(c, args): Promise<ResultatFonction> {
      exigerContexte(c, true);
      if (!exercice) return { elements: [], donneesManquantes: [SANS_EXERCICE] };
      const LIMITE = 40;
      return lire(async (tx) => {
        if (!(await lotActif(tx))) return { elements: [], donneesManquantes: ['Aucune donnée comptable importée pour cet exercice : balance non calculable.'] };
        // Agrégation en base (aucun calcul en flottant) : totaux et soldes par compte sur la période demandée.
        const r = await tx.execute(sql`
          select l.compte_num as compte, max(l.compte_lib) as libelle, sum(l.debit)::numeric(20, 2)::text as "totalDebit", sum(l.credit)::numeric(20, 2)::text as "totalCredit",
                 greatest(sum(l.debit) - sum(l.credit), 0)::numeric(20, 2)::text as "soldeDebiteur", greatest(sum(l.credit) - sum(l.debit), 0)::numeric(20, 2)::text as "soldeCrediteur"
          from lignes_ecriture l join lots_import i on i.id = l.lot_import_id and i.actif and i.type = 'fec'
          where l.entite_id = ${dossierId}::uuid and l.exercice_id = ${exercice.id}::uuid
            and l.ecriture_date between ${c.periode.debut}::date and ${c.periode.fin}::date
            ${args.comptePrefixe ? sql`and l.compte_num like ${`${args.comptePrefixe}%`}` : sql``}
          group by l.compte_num order by l.compte_num limit ${LIMITE + 1}`);
        const lignes = r.rows as Array<Record<string, string>>;
        const elements = lignes.slice(0, LIMITE).map(
          (l): ElementSource => ({
            id: `balance:${exercice.id}:${l.compte}:${c.periode.debut}:${c.periode.fin}`,
            nature: 'resultat_moteur',
            libelle: couper(`Balance — compte ${l.compte} ${propre(l.libelle ?? '')}`, 300),
            contenu: '',
            dossierId,
            valeurs: { compte: l.compte ?? '', 'total débit': l.totalDebit ?? '', 'total crédit': l.totalCredit ?? '', 'solde débiteur': l.soldeDebiteur ?? '', 'solde créditeur': l.soldeCrediteur ?? '', période: `du ${c.periode.debut} au ${c.periode.fin}` },
          }),
        );
        return { elements, ...(lignes.length > LIMITE ? { donneesManquantes: [`Balance limitée aux ${LIMITE} premiers comptes : précisez un numéro de compte.`] } : {}) };
      });
    },

    async calculerIndicateur(c, args): Promise<ResultatFonction> {
      exigerContexte(c, true);
      if (!exercice) return { elements: [], donneesManquantes: [SANS_EXERCICE] };
      const definition = CATALOGUE_INDICATEURS.find((d) => d.id === args.indicateurId);
      if (!definition) return { elements: [] };
      return lire(async (tx) => {
        const lot = await lotActif(tx);
        if (!lot) return { elements: [], donneesManquantes: ['Aucune donnée comptable importée pour cet exercice : indicateur non calculable.'] };
        if (lot.progression > plafondLignes) return { elements: [], donneesManquantes: ['Volume trop important pour un calcul immédiat de l’indicateur.'] };
        const lignes = await lignesDuLot(tx, lot.id);
        const [precedent] = await tx.select().from(s.exercices).where(and(eq(s.exercices.entiteId, dossierId), lt(s.exercices.fin, exercice.debut))).orderBy(desc(s.exercices.fin)).limit(1);
        let exercicePrecedent: { lignes: LigneEcriture[]; exercice: { debut: string; fin: string } } | null = null;
        if (precedent) {
          const [lotP] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, precedent.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
          if (lotP && lotP.progression <= plafondLignes) exercicePrecedent = { lignes: await lignesDuLot(tx, lotP.id), exercice: { debut: precedent.debut, fin: precedent.fin } };
        }
        // Le moteur calcule sur l'exercice entier : une sous-période demandée ne change pas la valeur, et la période est dite.
        const [v] = calculerIndicateurs({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, exercicePrecedent }, { ids: [definition.id] });
        if (!v) return { elements: [] };
        const valeurs: Record<string, string> = { période: `du ${v.periode.debut} au ${v.periode.fin}`, unité: v.unite, formule: couper(definition.formule, 500) };
        if (v.statut === 'calcule' && v.valeur !== null) valeurs.valeur = v.valeur;
        else valeurs.statut = couper(`non calculable${v.motif ? ` — ${v.motif}` : ''}`, 500);
        if (v.precedent?.valeur != null) valeurs['exercice précédent'] = v.precedent.valeur;
        return {
          elements: [{ id: `indicateur:${exercice.id}:${definition.id}`, nature: 'resultat_moteur', libelle: couper(`Indicateur — ${definition.libelle}`, 300), contenu: v.mentions.join(' '), dossierId, valeurs }],
          ...(v.statut !== 'calcule' ? { donneesManquantes: [couper(`${definition.libelle} : non calculable${v.motif ? ` (${v.motif})` : ''}.`, 300)] } : {}),
        };
      });
    },

    async listerConstats(c, args): Promise<ResultatFonction> {
      exigerContexte(c, true);
      if (!exercice) return { elements: [], donneesManquantes: [SANS_EXERCICE] };
      return lire(async (tx) => {
        const [execution] = (
          await tx.execute(sql`
            select id, obsolete from executions_controles
            where entite_id = ${dossierId}::uuid and exercice_id = ${exercice.id}::uuid and statut in ('termine', 'termine_avec_erreurs')
            order by cree_le desc limit 1`)
        ).rows as Array<{ id: string; obsolete: boolean }>;
        if (!execution) return { elements: [], donneesManquantes: ['Aucun contrôle n’a été exécuté sur cet exercice.'] };
        const r = await tx.execute(sql`
          select c.id, c.controle_id as controle, c.gravite::text as gravite, c.titre, c.explication, c.statut_revue::text as "statutRevue", c.montant::text as montant
          from constats c
          where c.entite_id = ${dossierId}::uuid and c.execution_id = ${execution.id}::uuid
            ${args.gravite ? sql`and c.gravite::text = ${args.gravite}` : sql``}
          order by c.gravite, c.cree_le desc, c.id limit 20`);
        const elements = (r.rows as Array<Record<string, string | null>>).map(
          (k): ElementSource => ({
            id: `constat:${k.id}`,
            nature: 'constat',
            libelle: couper(`Constat ${k.controle} — ${propre(k.titre ?? '')}`, 300),
            contenu: k.explication ?? '',
            dossierId,
            valeurs: { contrôle: k.controle ?? '', gravité: k.gravite ?? '', revue: k.statutRevue ?? '', ...(k.montant !== null ? { montant: k.montant ?? '' } : {}) },
          }),
        );
        return { elements, ...(execution.obsolete ? { donneesManquantes: ['Les données ont changé depuis la dernière exécution des contrôles : constats à relancer.'] } : {}) };
      });
    },

    async rechercherSourcesReglementaires(c, args): Promise<ResultatFonction> {
      exigerContexte(c, false);
      // 1) Évolutions de la veille QUALIFIÉES par une personne (état « verifiee ») ; 2) sources vérifiées du catalogue du moteur.
      const evolutions = await lire(async (tx) => {
        const t = await requetePleinTexte(tx, args.requete);
        if (t === '') return [];
        const q = sql`${t}::tsquery`;
        const vecteur = sql`to_tsvector('french', e.reference || ' ' || coalesce(e.resume, '') || ' ' || coalesce(e.passage, '') || ' ' || coalesce(e.conditions, ''))`;
        return (
          await tx.execute(sql`
            select e.id, e.emetteur, e.reference, e.url, e.resume, e.passage, e.date_effet::text as "dateEffet", e.verifiee_le::text as "verifieeLe"
            from evolutions_reglementaires e
            where e.etat_verification = 'verifiee' and ${vecteur} @@ ${q}
            order by ts_rank(${vecteur}, ${q}) desc, e.id limit ${args.limite}`)
        ).rows as Array<Record<string, string | null>>;
      });
      const elements: ElementSource[] = evolutions.map((e) => ({
        id: `evolution:${e.id}`,
        nature: 'source_officielle',
        libelle: couper(`${e.emetteur} — ${propre(e.reference ?? '')}`, 300),
        contenu: [e.resume, e.passage].filter(Boolean).join('\n'),
        dossierId: null,
        reference: { titre: couper(propre(e.reference ?? ''), 500), url: e.url && e.url.length <= 1000 ? e.url : null, dateVersion: e.verifieeLe ?? e.dateEffet ?? null },
      }));
      const mots = motsDeRecherche(normaliserMotsCles(args.requete)).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
      const catalogue = Object.entries(SOURCES)
        .filter(([, src]) => src.type === 'reglementaire' && src.verification === 'verifiee' && src.url !== null)
        .map(([cle, src]) => ({ cle, src, score: mots.filter((m) => normaliserMotsCles(src.reference).includes(m)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.cle < b.cle ? -1 : 1));
      for (const { cle, src } of catalogue) {
        if (elements.length >= args.limite) break;
        elements.push({
          id: `source:${cle}`,
          nature: 'source_officielle',
          libelle: couper(src.reference, 300),
          contenu: src.periodeApplication ?? '',
          dossierId: null,
          reference: { titre: couper(src.reference, 500), url: src.url, dateVersion: src.dateVerification },
        });
      }
      return { elements };
    },
  };
}

const MOTS_VIDES = new Set(['quel', 'quelle', 'quels', 'quelles', 'pour', 'dans', 'avec', 'sans', 'cette', 'sont', 'article', 'articles', 'code', 'faut', 'doit', 'comment', 'combien']);

function versPassage(l: Record<string, unknown>): PassageTrouve {
  const documentId = String(l.documentId);
  const page = Number(l.page);
  return { cle: `${documentId}:${page}:${String(l.origine)}:${Number(l.rang)}`, documentId, page, nomOrigine: String(l.nomOrigine ?? ''), extrait: String(l.extrait ?? ''), texte: String(l.texte ?? '') };
}

/**
 * Habilitations de l'assistant : le niveau RÉEL de l'utilisateur sur le dossier visé, relu en base à chaque appel de
 * fonction. `dossiers` est le périmètre imposé (un dossier, ou plusieurs pour une question de portefeuille) : un dossier
 * qui n'en fait pas partie est refusé sans lecture. Une fonction sans portée de dossier (sources réglementaires) exige
 * qu'au moins un dossier du périmètre soit encore ouvert au niveau requis.
 */
export function creerHabilitationsAssistant(dep: DependancesAssistant, acces: Acces, dossiers: string | readonly string[]): Habilitations {
  const perimetre = typeof dossiers === 'string' ? [dossiers] : [...dossiers];
  return {
    async autoriser(d) {
      if (d.cabinetId !== acces.cabinetId || d.utilisateurId !== acces.utilisateurId) return false;
      if (d.dossierId !== null && !perimetre.includes(d.dossierId)) return false;
      const requis = NIVEAU_REQUIS[d.habilitation];
      if (!requis) return false;
      return dep.bd.avecContexte(acces, async (tx) => {
        for (const id of d.dossierId !== null ? [d.dossierId] : perimetre) {
          const niveau = await niveauSur(tx, id);
          if (niveau !== null && auMoins(niveau, requis)) return true;
        }
        return false;
      });
    },
  };
}

/** Liste blanche des fonctions métier de l'assistant (dossier ou portefeuille), avec les indicateurs proposés. */
export function fonctionsAssistant(ports: PortsFonctionsMetier): FonctionMetier[] {
  const catalogue = new Map(CATALOGUE_INDICATEURS.map((d) => [d.id, d]));
  return creerFonctionsMetierTypes(ports, {
    indicateurs: INDICATEURS_ASSISTANT.flatMap((i) => (catalogue.has(i.id) ? [{ id: i.id, libelle: catalogue.get(i.id)?.libelle ?? i.id, motsCles: i.motsCles }] : [])),
  });
}

/** Une réponse du SIMULATEUR n'est jamais enregistrée ni présentée comme celle d'un modèle réel. */
export function modeEchange(dep: DependancesAssistant, reponse: ReponseAssistant): ReponseQuestion['mode'] {
  return reponse.mode === 'sans_ia' ? 'sans_ia' : dep.ia.natureFournisseur === 'reel' ? 'ia' : 'simulateur';
}

export function estRefusDeLaBase(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  return code === '42501';
}

/**
 * Pose une question à l'assistant pour `acces` sur `dossierId`. Lève 404 si le dossier n'est pas visible, 403 sous le
 * niveau « lecture », 404 si l'exercice demandé n'appartient pas au dossier. Ne lève pas pour une IA absente ou en panne :
 * la réponse est alors rendue en mode « sans IA », étiquetée.
 */
export async function poserQuestion(dep: DependancesAssistant, acces: Acces, dossierId: string, demande: { question: string; exerciceId?: string | undefined }): Promise<ReponseQuestion> {
  // 1) Habilitation et exercice, AVANT toute recherche.
  const exercice = await dep.bd.avecContexte(acces, async (tx): Promise<ExerciceAnalyse | null> => {
    await exigerNiveau(tx, dossierId, 'lecture');
    if (demande.exerciceId) {
      const [ex] = await tx.select().from(s.exercices).where(and(eq(s.exercices.id, demande.exerciceId), eq(s.exercices.entiteId, dossierId)));
      if (!ex) throw new NotFoundException('Exercice introuvable dans ce dossier');
      return { id: ex.id, debut: ex.debut, fin: ex.fin };
    }
    const [dernier] = await tx.select().from(s.exercices).where(eq(s.exercices.entiteId, dossierId)).orderBy(desc(s.exercices.fin)).limit(1);
    return dernier ? { id: dernier.id, debut: dernier.debut, fin: dernier.fin } : null;
  });

  // 2) Périmètre IMPOSÉ : ce cabinet, ce dossier, la période de l'exercice (à défaut, l'année civile en cours).
  const annee = new Date().getUTCFullYear();
  const periode = exercice ? { debut: exercice.debut, fin: exercice.fin } : { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  const perimetre = { cabinetId: acces.cabinetId, utilisateurId: acces.utilisateurId, dossierIds: [dossierId], periode };
  const fonctions = fonctionsAssistant(creerPortsAssistant(dep, acces, dossierId, exercice));

  // 3) Réponse : le paquet bascule seul en « sans IA » si aucun modèle n'est utilisable.
  const reponse = await repondreQuestion(
    { passerelle: dep.ia.active(), fonctions, habilitations: creerHabilitationsAssistant(dep, acces, dossierId), journal: dep.ia.journal },
    { question: demande.question, perimetre },
  );
  const mode = modeEchange(dep, reponse);

  // 4) Enregistrement de l'échange (chacun les siens), puis journal d'audit de l'action — sans le texte de la question.
  let echangeId: string | null = null;
  try {
    echangeId = await dep.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx
        .insert(s.echangesAssistant)
        .values({ cabinetId: acces.cabinetId, entiteId: dossierId, utilisateurId: acces.utilisateurId, exerciceId: exercice?.id ?? null, question: demande.question, mode, statut: reponse.statut, reponse })
        .returning({ id: s.echangesAssistant.id });
      return e?.id ?? null;
    });
  } catch (e) {
    // La politique de la table n'admet l'écriture qu'à partir du niveau « collaboration » : au niveau « lecture », la
    // réponse est rendue mais l'échange n'est pas conservé, et la réponse le dit.
    if (!estRefusDeLaBase(e)) throw e;
  }
  await dep.bd.avecContexte(acces, (tx) =>
    journaliser(tx, {
      cabinetId: acces.cabinetId,
      acteurId: acces.utilisateurId,
      action: 'assistant.question',
      cibleType: 'echange_assistant',
      cibleId: echangeId,
      entiteId: dossierId,
      details: { mode, statut: reponse.statut, segments: reponse.segments.length, sources: reponse.sources.length, refus: reponse.refus.length, longueurQuestion: demande.question.length, exerciceId: exercice?.id ?? null, enregistre: echangeId !== null },
    }),
  );
  await dep.ia.journal.vider();
  return { echangeId, echangeEnregistre: echangeId !== null, mode, exercice, reponse, ia: dep.ia.statut() };
}
