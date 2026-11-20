/**
 * ASSISTANT SUR UN PORTEFEUILLE DE DOSSIERS — service appelable sans HTTP (le contrôleur et les tests appellent la
 * même fonction). Il réutilise les ports, les habilitations et la liste blanche de `assistant.service.ts` : aucune
 * logique de recherche n'est dupliquée ici.
 *
 * Règles tenues ici :
 * - le PÉRIMÈTRE est calculé par la base sous l'identité de l'utilisateur : les dossiers actifs du cabinet où il a au
 *   moins le niveau « lecture ». Une liste `dossierIds` fournie par l'appelant est INTERSECTÉE avec ce périmètre : un
 *   identifiant qui n'en fait pas partie (dossier non habilité, d'un autre cabinet, inexistant) est écarté et listé
 *   « hors de votre périmètre », de la même façon dans les trois cas (son existence n'est pas révélée) ;
 * - au plus `BORNE_DOSSIERS_PORTEFEUILLE` dossiers par question ; au-delà le périmètre est découpé en TRANCHES de cette
 *   taille, classées par pertinence déterministe (voir `classerParPertinence`) puis par ordre alphabétique. Une question
 *   porte sur UNE tranche (`tranche`, 1 par défaut) ; les dossiers des autres tranches sont nommés dans la réponse,
 *   jamais tronqués en silence ; chaque tranche est une question distincte, dont la réponse n'est jamais fusionnée
 *   avec celle d'une autre, et dont les habilitations sont relues en base ;
 * - chaque fonction métier s'exécute dossier par dossier, par les ports du dossier, sous RLS avec l'identité de
 *   l'utilisateur, après relecture en base de son niveau sur CE dossier ;
 * - la période est celle du dernier exercice de chaque dossier (ou sa part dans une période commune fournie), et elle
 *   est annoncée dossier par dossier ; les données manquantes aussi ;
 * - chaque source citée porte l'identifiant de son dossier ;
 * - à la RELECTURE, un échange est filtré selon les habilitations du moment (`filtrerSelonHabilitations`).
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import { type Citation, type ContexteFonction, type PortsFonctionsMetier, type ReponseAssistant, repondreQuestion, type ResultatFonction, type StatutIa } from '@comtaple/ia';
import type { Acces, Niveau } from './acces.js';
import {
  creerHabilitationsAssistant,
  creerPortsAssistant,
  type DependancesAssistant,
  estRefusDeLaBase,
  type ExerciceAnalyse,
  fonctionsAssistant,
  modeEchange,
  type ReponseQuestion,
} from './assistant.service.js';

/**
 * Nombre maximal de dossiers interrogés par question. Valeur = limite dure du périmètre accepté par le paquet
 * `@comtaple/ia` (`schemaPerimetreImpose.dossierIds.max(20)`) ; les fonctions s'exécutent en séquence, dossier par
 * dossier (jusqu'à six fonctions chacun), ce qui borne aussi la durée d'une question.
 */
export const BORNE_DOSSIERS_PORTEFEUILLE = 20;
/** Nombre maximal d'identifiants acceptés dans `dossierIds` (borne d'entrée, avant intersection). */
export const DOSSIERS_DEMANDES_MAX = 200;
/** Le mode sans IA restitue au plus 40 éléments par réponse (paquet IA) ; 5 sont réservés aux sources officielles. */
const ELEMENTS_PAR_REPONSE = 40;
const ELEMENTS_RESERVES_SOURCES = 5;
/** Au-delà, un indicateur n'est pas calculé à la volée dans une question de portefeuille (le dossier seul l'accepte jusqu'à 400 000). */
const PLAFOND_LIGNES_PORTEFEUILLE = 100_000;
/** Priorité des fonctions quand le nombre d'éléments par dossier est compté : calculs du moteur d'abord, pièces en dernier. */
const ORDRE_FONCTIONS = ['calculerIndicateur', 'lireBalance', 'listerConstats', 'rechercherEcritures', 'rechercherDocuments', 'rechercherSourcesReglementaires'];
const TAILLE_PAGE = 20;

/** Nombre d'éléments restitués au plus par dossier, selon le nombre de dossiers interrogés (annoncé dans la réponse). */
export function elementsParDossier(nbDossiers: number): number {
  return Math.max(1, Math.floor((ELEMENTS_PAR_REPONSE - ELEMENTS_RESERVES_SOURCES) / Math.max(1, nbDossiers)));
}

export interface DossierAutorise {
  id: string;
  nom: string;
  niveau: Niveau;
}

export interface DossierInterroge {
  id: string;
  nom: string;
  exercice: ExerciceAnalyse | null;
  /** Période effectivement analysée dans ce dossier ; null si aucun exercice ne s'y prête. */
  periode: { debut: string; fin: string } | null;
  donneesManquantes: string[];
  /** Nombre de sources de ce dossier consultées pendant la réponse. */
  sources: number;
  /** Éléments trouvés mais non restitués (limite par dossier d'une question de portefeuille). */
  nonRestitues: number;
}

export type CitationPortefeuille = Citation & { dossierId: string | null };
export type ReponsePortefeuilleAssistant = Omit<ReponseAssistant, 'perimetre' | 'segments' | 'sources'> & {
  segments: Array<Omit<ReponseAssistant['segments'][number], 'citations'> & { citations: CitationPortefeuille[] }>;
  sources: CitationPortefeuille[];
};

/** Tranche de dossiers interrogée : numéro (à partir de 1), nombre de tranches du périmètre retenu, rang du premier et du dernier dossier. */
export interface TranchePortefeuille {
  numero: number;
  total: number;
  premier: number;
  dernier: number;
  /** Nombre de dossiers retenus (périmètre autorisé, restreint par la sélection), toutes tranches confondues. */
  retenus: number;
}

export interface PerimetrePortefeuille {
  borne: number;
  /** Absent des échanges conservés avant l'introduction des tranches : une seule tranche. */
  tranche?: TranchePortefeuille;
  /** Critère de classement des dossiers entre les tranches, dit tel quel à l'écran. */
  ordre?: string;
  elementsParDossier: number;
  /** Nombre de dossiers du périmètre autorisé de l'utilisateur au moment de la question. */
  autorises: number;
  dossiers: DossierInterroge[];
  /** Dossiers autorisés et retenus mais NON interrogés par CETTE question (autres tranches), nommés. */
  nonInterroges: Array<{ id: string; nom: string }>;
  /** Identifiants demandés et écartés : « hors de votre périmètre », sans dire s'ils existent. */
  horsPerimetre: string[];
  periodeCommune: { debut: string; fin: string } | null;
}

export interface ContenuPortefeuille {
  perimetre: PerimetrePortefeuille;
  reponse: ReponsePortefeuilleAssistant;
}

export interface ReponsePortefeuille extends ContenuPortefeuille {
  echangeId: string | null;
  echangeEnregistre: boolean;
  mode: ReponseQuestion['mode'];
  ia: { statut: StatutIa; raisons: string[] };
}

/** Ce qui a été retiré d'un échange relu parce que l'habilitation a changé depuis. */
export interface MasqueRelecture {
  /** Nombre de dossiers de l'échange qui ne sont plus dans le périmètre de l'utilisateur. */
  dossiers: number;
  /** Vrai si la rédaction d'un modèle a été retirée en bloc (elle avait été établie avec un dossier désormais masqué). */
  redactionRetiree: boolean;
}

export const estDeposant = (acces: Acces): boolean => acces.role === 'client_deposant';

/** Périmètre autorisé : dossiers actifs où l'utilisateur courant a au moins « lecture », calculé par la base (RLS + `app_niveau_entite`). */
export async function perimetreAutorise(tx: Tx): Promise<DossierAutorise[]> {
  const r = await tx.execute(sql`
    select e.id, e.raison_sociale as nom, app_niveau_entite(e.id)::text as niveau
    from entites e
    where e.actif and app_niveau_entite(e.id) >= 'lecture'
    order by e.raison_sociale, e.id`);
  return r.rows as unknown as DossierAutorise[];
}

export const ORDRE_PERTINENCE = 'Dossiers ayant des données comptables importées d’abord, puis dossiers ayant un exercice, puis les autres ; à égalité, ordre alphabétique.';

/**
 * Rang de pertinence de chaque dossier, calculé par la base sous l'identité de la personne (déterministe, sans IA) :
 * 0 = données comptables importées (lot FEC actif et terminé) sur un exercice qui recoupe la période (le dernier exercice
 * ou la période commune), 1 = un exercice sans donnée, 2 = aucun exercice. Les dossiers sans donnée n'ont rien à répondre
 * aux questions comptables : ils passent après ceux qui en ont, sans jamais être écartés.
 */
export async function classerParPertinence(tx: Tx, ids: readonly string[], commune: { debut: string; fin: string } | null): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const recoupe = commune ? sql`x.debut <= ${commune.fin}::date and x.fin >= ${commune.debut}::date` : sql`true`;
  const liste = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const r = await tx.execute(sql`
    select e.id,
      case
        when exists (select 1 from lots_import l join exercices x on x.id = l.exercice_id
                     where l.entite_id = e.id and l.actif and l.type = 'fec' and l.statut in ('termine', 'termine_avec_erreurs') and ${recoupe}) then 0
        when exists (select 1 from exercices x where x.entite_id = e.id and ${recoupe}) then 1
        else 2
      end as rang
    from entites e where e.id in (${liste})`);
  return new Map((r.rows as Array<{ id: string; rang: number }>).map((l) => [l.id, Number(l.rang)]));
}

/** Refuse (403) un déposant ; renvoie le périmètre autorisé, vide si aucun dossier n'est ouvert en lecture. */
export async function lirePerimetre(dep: DependancesAssistant, acces: Acces): Promise<DossierAutorise[]> {
  if (estDeposant(acces)) throw new ForbiddenException('L’assistant n’est pas ouvert aux déposants');
  return dep.bd.avecContexte(acces, (tx) => perimetreAutorise(tx));
}

interface Suivi {
  manquantes: Set<string>;
  restitues: number;
  nonRestitues: number;
}

/**
 * Ports d'un portefeuille : chaque appel est aiguillé vers les ports du dossier désigné par le contexte (fourni par
 * l'orchestrateur à partir du périmètre imposé, jamais par le modèle), sur la période analysée de CE dossier.
 * Les éléments rendus sont comptés par dossier ; les données manquantes sont retenues par dossier.
 */
function creerPortsPortefeuille(
  dep: DependancesAssistant,
  acces: Acces,
  dossiers: readonly DossierInterroge[],
  budget: number,
  suivi: Map<string, Suivi>,
  dossierDe: Map<string, string>,
): PortsFonctionsMetier {
  const ports = new Map(dossiers.map((d) => [d.id, creerPortsAssistant(dep, acces, d.id, d.exercice, { plafondLignes: PLAFOND_LIGNES_PORTEFEUILLE })]));
  const parId = new Map(dossiers.map((d) => [d.id, d]));
  const etiquette = (dossierId: string, texte: string): string => `Dossier ${dossierId} : ${texte}`.slice(0, 300);

  const aiguiller = async (c: ContexteFonction, executer: (p: PortsFonctionsMetier, contexte: ContexteFonction) => Promise<ResultatFonction>): Promise<ResultatFonction> => {
    const d = c.dossierId !== null ? parId.get(c.dossierId) : undefined;
    const p = c.dossierId !== null ? ports.get(c.dossierId) : undefined;
    const etat = c.dossierId !== null ? suivi.get(c.dossierId) : undefined;
    if (!d || !p || !etat) throw new Error('contexte_inattendu');
    // Période du contexte ramenée à la période analysée de ce dossier (l'enveloppe du portefeuille est plus large).
    let periode = c.periode;
    if (d.periode) {
      const debut = c.periode.debut > d.periode.debut ? c.periode.debut : d.periode.debut;
      const fin = c.periode.fin < d.periode.fin ? c.periode.fin : d.periode.fin;
      if (debut > fin) {
        const m = 'La période demandée est hors de l’exercice analysé de ce dossier.';
        etat.manquantes.add(m);
        return { elements: [], donneesManquantes: [etiquette(d.id, m)] };
      }
      periode = { debut, fin };
    }
    const r = await executer(p, { ...c, periode });
    // Sans exercice retenu, le motif exact est déjà noté pour ce dossier (aucun exercice, ou aucun dans la période commune).
    const manquantes = d.exercice ? [...(r.donneesManquantes ?? [])] : r.donneesManquantes?.length ? [...d.donneesManquantes] : [];
    for (const m of manquantes) etat.manquantes.add(m);
    const place = Math.max(0, budget - etat.restitues);
    const elements = r.elements.slice(0, place);
    etat.restitues += elements.length;
    for (const e of elements) dossierDe.set(e.id, d.id);
    const exclus = r.elements.length - elements.length;
    if (exclus > 0) {
      etat.nonRestitues += exclus;
      manquantes.push('Des éléments trouvés n’ont pas été restitués (limite par dossier d’une question de portefeuille).');
    }
    return { elements, ...(manquantes.length ? { donneesManquantes: manquantes.map((m) => etiquette(d.id, m)) } : {}) };
  };

  const premier = ports.values().next().value as PortsFonctionsMetier;
  return {
    rechercherDocuments: (c, a) => aiguiller(c, (p, x) => p.rechercherDocuments(x, a)),
    rechercherEcritures: (c, a) => aiguiller(c, (p, x) => p.rechercherEcritures(x, a)),
    lireBalance: (c, a) => aiguiller(c, (p, x) => p.lireBalance(x, a)),
    calculerIndicateur: (c, a) => aiguiller(c, (p, x) => p.calculerIndicateur(x, a)),
    listerConstats: (c, a) => aiguiller(c, (p, x) => p.listerConstats(x, a)),
    // Sans portée de dossier : fonds de textes officiels, identique quel que soit le dossier.
    rechercherSourcesReglementaires: (c, a) => premier.rechercherSourcesReglementaires(c, a),
  };
}

export interface DemandePortefeuille {
  question: string;
  dossierIds?: readonly string[] | undefined;
  periode?: { debut: string; fin: string } | undefined;
  /** Numéro de la tranche de dossiers à interroger, à partir de 1 (défaut 1). */
  tranche?: number | undefined;
}

/**
 * Pose une question à l'assistant sur le portefeuille autorisé de `acces`. Lève 403 pour un déposant ou si aucun
 * dossier ne lui est ouvert en lecture, 404 si AUCUN des dossiers demandés n'est dans son périmètre. Ne lève pas pour
 * une IA absente : la réponse est alors « sans IA », étiquetée.
 */
export async function poserQuestionPortefeuille(dep: DependancesAssistant, acces: Acces, demande: DemandePortefeuille): Promise<ReponsePortefeuille> {
  // 1) Habilitations AVANT toute recherche : périmètre autorisé, intersection, borne, exercice de chaque dossier.
  if (estDeposant(acces)) throw new ForbiddenException('L’assistant n’est pas ouvert aux déposants');
  const commune = demande.periode ?? null;
  const prepare = await dep.bd.avecContexte(acces, async (tx) => {
    const autorises = await perimetreAutorise(tx);
    if (autorises.length === 0) throw new ForbiddenException('Aucun dossier ne vous est ouvert en lecture : l’assistant n’a rien à interroger');
    const parId = new Map(autorises.map((d) => [d.id, d]));
    const demandes = demande.dossierIds ? [...new Set(demande.dossierIds.map((x) => x.toLowerCase()))] : null;
    const horsPerimetre = demandes ? demandes.filter((id) => !parId.has(id)) : [];
    const retenus = demandes ? autorises.filter((d) => demandes.includes(d.id)) : autorises;
    if (retenus.length === 0) throw new NotFoundException('Aucun des dossiers demandés n’est dans votre périmètre');
    // Classement par pertinence PUIS ordre alphabétique (déjà celui de `autorises`) : le tri est stable.
    const rangs = await classerParPertinence(tx, retenus.map((d) => d.id), commune);
    const classes = [...retenus].sort((x, y) => (rangs.get(x.id) ?? 2) - (rangs.get(y.id) ?? 2));
    const total = Math.ceil(classes.length / BORNE_DOSSIERS_PORTEFEUILLE);
    const numero = demande.tranche ?? 1;
    if (numero > total) throw new ConflictException(`La tranche ${numero} n’existe plus : votre périmètre compte ${total} tranche${total > 1 ? 's' : ''}. Reposez la question depuis la première tranche.`);
    const debutTranche = (numero - 1) * BORNE_DOSSIERS_PORTEFEUILLE;
    const interroges = classes.slice(debutTranche, debutTranche + BORNE_DOSSIERS_PORTEFEUILLE);
    const tranche: TranchePortefeuille = { numero, total, premier: debutTranche + 1, dernier: debutTranche + interroges.length, retenus: classes.length };
    const dossiers: DossierInterroge[] = [];
    for (const d of interroges) {
      const [ex] = commune
        ? ((await tx.execute(sql`select id, debut::text as debut, fin::text as fin from exercices where entite_id = ${d.id}::uuid and debut <= ${commune.fin}::date and fin >= ${commune.debut}::date order by fin desc limit 1`)).rows as unknown as ExerciceAnalyse[])
        : ((await tx.execute(sql`select id, debut::text as debut, fin::text as fin from exercices where entite_id = ${d.id}::uuid order by fin desc limit 1`)).rows as unknown as ExerciceAnalyse[]);
      const exercice = ex ? { id: ex.id, debut: ex.debut, fin: ex.fin } : null;
      const periode = exercice
        ? commune
          ? { debut: commune.debut > exercice.debut ? commune.debut : exercice.debut, fin: commune.fin < exercice.fin ? commune.fin : exercice.fin }
          : { debut: exercice.debut, fin: exercice.fin }
        : null;
      const manquantes = exercice ? [] : [commune ? 'Aucun exercice de ce dossier ne recoupe la période demandée : la comptabilité n’a pas été interrogée.' : 'Aucun exercice n’est ouvert dans ce dossier : la comptabilité n’a pas été interrogée.'];
      dossiers.push({ id: d.id, nom: d.nom, exercice, periode, donneesManquantes: manquantes, sources: 0, nonRestitues: 0 });
    }
    return { autorises: autorises.length, dossiers, tranche, nonInterroges: classes.filter((d) => !interroges.includes(d)).map((d) => ({ id: d.id, nom: d.nom })), horsPerimetre };
  });

  // 2) Périmètre IMPOSÉ au paquet : ce cabinet, ces dossiers, l'enveloppe des périodes analysées (chaque port la
  //    ramène à la période de son dossier). Sans aucun exercice : la période commune, à défaut l'année civile en cours.
  const { dossiers } = prepare;
  const periodes = dossiers.flatMap((d) => (d.periode ? [d.periode] : []));
  const annee = new Date().getUTCFullYear();
  const enveloppe = periodes.length
    ? { debut: periodes.map((p) => p.debut).sort()[0] as string, fin: periodes.map((p) => p.fin).sort().reverse()[0] as string }
    : (commune ?? { debut: `${annee}-01-01`, fin: `${annee}-12-31` });
  const ids = dossiers.map((d) => d.id);
  const budget = elementsParDossier(dossiers.length);
  const suivi = new Map<string, Suivi>(dossiers.map((d) => [d.id, { manquantes: new Set(d.donneesManquantes), restitues: 0, nonRestitues: 0 }]));
  const dossierDe = new Map<string, string>();
  const rang = (nom: string) => (ORDRE_FONCTIONS.includes(nom) ? ORDRE_FONCTIONS.indexOf(nom) : ORDRE_FONCTIONS.length);
  const fonctions = fonctionsAssistant(creerPortsPortefeuille(dep, acces, dossiers, budget, suivi, dossierDe)).sort((a, b) => rang(a.nom) - rang(b.nom));

  // 3) Réponse : même orchestrateur que pour un dossier ; il bascule seul en « sans IA » si aucun modèle n'est utilisable.
  const brute = await repondreQuestion(
    { passerelle: dep.ia.active(), fonctions, habilitations: creerHabilitationsAssistant(dep, acces, ids), journal: dep.ia.journal },
    { question: demande.question, perimetre: { cabinetId: acces.cabinetId, utilisateurId: acces.utilisateurId, dossierIds: ids, periode: enveloppe } },
  );
  const mode = modeEchange(dep, brute);

  // 4) Mise en forme : chaque source porte son dossier ; données manquantes rangées par dossier.
  const avecDossier = (c: Citation): CitationPortefeuille => ({ ...c, dossierId: dossierDe.get(c.id) ?? null });
  for (const d of dossiers) {
    const etat = suivi.get(d.id) as Suivi;
    d.donneesManquantes = [...etat.manquantes];
    d.nonRestitues = etat.nonRestitues;
    d.sources = brute.sources.filter((x) => dossierDe.get(x.id) === d.id).length;
  }
  const { perimetre: _perimetrePaquet, ...reste } = brute;
  const reponse: ReponsePortefeuilleAssistant = {
    ...reste,
    segments: brute.segments.map((x) => ({ ...x, citations: x.citations.map(avecDossier) })),
    sources: brute.sources.map(avecDossier),
    // Les données manquantes propres à un dossier sont dans `perimetre.dossiers` ; il ne reste ici que les autres.
    donneesManquantes: brute.donneesManquantes.filter((m) => !/^Dossier [0-9a-f-]{36} : /.test(m)),
  };
  const perimetre: PerimetrePortefeuille = {
    borne: BORNE_DOSSIERS_PORTEFEUILLE,
    tranche: prepare.tranche,
    ordre: ORDRE_PERTINENCE,
    elementsParDossier: budget,
    autorises: prepare.autorises,
    dossiers,
    nonInterroges: prepare.nonInterroges,
    horsPerimetre: prepare.horsPerimetre,
    periodeCommune: commune,
  };
  const contenu: ContenuPortefeuille = { perimetre, reponse };

  // 5) Enregistrement (chacun les siens), puis journal d'audit — sans le texte de la question ni nom de dossier.
  let echangeId: string | null = null;
  try {
    echangeId = await dep.bd.avecContexte(acces, async (tx) => {
      const [e] = await tx
        .insert(s.echangesPortefeuille)
        .values({ cabinetId: acces.cabinetId, utilisateurId: acces.utilisateurId, question: demande.question, mode, statut: reponse.statut, dossiers: ids, contenu })
        .returning({ id: s.echangesPortefeuille.id });
      return e?.id ?? null;
    });
  } catch (e) {
    if (!estRefusDeLaBase(e)) throw e;
  }
  await dep.bd.avecContexte(acces, (tx) =>
    journaliser(tx, {
      cabinetId: acces.cabinetId,
      acteurId: acces.utilisateurId,
      action: 'assistant.question_portefeuille',
      cibleType: 'echange_portefeuille',
      cibleId: echangeId,
      entiteId: null,
      details: {
        mode,
        statut: reponse.statut,
        dossiersInterroges: ids.length,
        dossiersNonInterroges: prepare.nonInterroges.length,
        horsPerimetre: prepare.horsPerimetre.length,
        segments: reponse.segments.length,
        sources: reponse.sources.length,
        refus: reponse.refus.length,
        longueurQuestion: demande.question.length,
        periodeCommune: commune !== null,
        tranche: prepare.tranche.numero,
        tranches: prepare.tranche.total,
        enregistre: echangeId !== null,
      },
    }),
  );
  await dep.ia.journal.vider();
  return { echangeId, echangeEnregistre: echangeId !== null, mode, ...contenu, ia: dep.ia.statut() };
}

const MOTIF_MASQUE = 'Les éléments de cette réponse provenaient de dossiers auxquels vous n’avez plus accès.';

/**
 * Filtre un échange conservé selon les habilitations DU MOMENT. Fonction pure : `autorises` est l'ensemble des
 * dossiers du périmètre actuel de la personne qui relit.
 *
 * - un dossier qui n'est plus autorisé disparaît du périmètre affiché, avec ses données manquantes ;
 * - une source, et tout segment citant une source, d'un dossier non autorisé sont retirés ;
 * - si au moins un dossier de l'échange est masqué et que la réponse avait été RÉDIGÉE par un modèle, toute la
 *   rédaction est retirée (segments, motif d'abstention et données manquantes libres) : un texte libre établi avec ce
 *   dossier peut le mentionner sans le citer. Restent les sources encore autorisées ;
 * - en mode « sans IA », chaque segment restitue UN élément : le filtrage par citation suffit.
 */
export function filtrerSelonHabilitations(contenu: ContenuPortefeuille, autorises: ReadonlySet<string>): { contenu: ContenuPortefeuille; masque: MasqueRelecture | null } {
  const { perimetre, reponse } = contenu;
  const visibles = perimetre.dossiers.filter((d) => autorises.has(d.id));
  const masques = perimetre.dossiers.length - visibles.length;
  const nonInterroges = perimetre.nonInterroges.filter((d) => autorises.has(d.id));
  if (masques === 0 && nonInterroges.length === perimetre.nonInterroges.length) return { contenu, masque: null };
  const permise = (c: CitationPortefeuille): boolean => c.dossierId === null || autorises.has(c.dossierId);
  const redactionRetiree = masques > 0 && reponse.mode === 'ia';
  const segments = redactionRetiree ? [] : reponse.segments.filter((x) => x.citations.every(permise));
  const vide = segments.length === 0 && reponse.statut === 'repondu';
  return {
    contenu: {
      perimetre: { ...perimetre, dossiers: visibles, nonInterroges },
      reponse: {
        ...reponse,
        statut: vide ? 'abstention' : reponse.statut,
        motifAbstention: vide ? MOTIF_MASQUE : redactionRetiree && reponse.statut === 'abstention' ? 'L’assistant s’était abstenu.' : reponse.motifAbstention,
        segments,
        sources: reponse.sources.filter(permise),
        donneesManquantes: redactionRetiree ? [] : reponse.donneesManquantes,
        // Les index des points écartés renvoient à une rédaction qui n'est plus affichée.
        pointsEcartes: redactionRetiree ? [] : reponse.pointsEcartes,
        abstentionsPartielles: redactionRetiree ? [] : reponse.abstentionsPartielles,
      },
    },
    masque: masques > 0 ? { dossiers: masques, redactionRetiree } : null,
  };
}

export interface EchangePortefeuille extends ContenuPortefeuille {
  id: string;
  question: string;
  mode: ReponseQuestion['mode'];
  statut: string;
  creeLe: string;
  masque: MasqueRelecture | null;
}

/** Ses propres échanges de portefeuille, les plus récents d'abord, FILTRÉS selon ses habilitations du moment. */
export async function relireEchangesPortefeuille(dep: DependancesAssistant, acces: Acces, page: number): Promise<{ page: number; taillePage: number; total: number; echanges: EchangePortefeuille[] }> {
  if (estDeposant(acces)) throw new ForbiddenException('L’assistant n’est pas ouvert aux déposants');
  return dep.bd.avecContexte(acces, async (tx) => {
    const autorises = new Set((await perimetreAutorise(tx)).map((d) => d.id));
    const filtre = sql`utilisateur_id = ${acces.utilisateurId}::uuid`;
    const [{ n } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from echanges_portefeuille where ${filtre}`)).rows as Array<{ n: number }>;
    const lignes = (
      await tx.execute(sql`
        select id, question, mode, statut, contenu, cree_le as "creeLe"
        from echanges_portefeuille where ${filtre}
        order by cree_le desc, id desc limit ${TAILLE_PAGE} offset ${(page - 1) * TAILLE_PAGE}`)
    ).rows as unknown as Array<{ id: string; question: string; mode: ReponseQuestion['mode']; statut: string; contenu: ContenuPortefeuille; creeLe: string }>;
    const echanges = lignes.map((l) => {
      const { contenu, masque } = filtrerSelonHabilitations(l.contenu, autorises);
      return { id: l.id, question: l.question, mode: l.mode, statut: contenu.reponse.statut, creeLe: l.creeLe, ...contenu, masque };
    });
    return { page, taillePage: TAILLE_PAGE, total: n, echanges };
  });
}
