/**
 * AMÉLIORATION CONTRÔLÉE — suggestions tirées des corrections et décisions de revue d'UN cabinet.
 *
 * Moteur pur et déterministe : mêmes décisions en entrée, mêmes suggestions en sortie. Il ne lit aucune base, n'appelle
 * aucun modèle, n'apprend rien et n'écrit rien. Il DÉTECTE des récurrences selon des critères explicites et versionnés
 * (`CRITERES_AMELIORATION`) et les range dans l'une des cinq catégories du cahier des charges :
 *  - `correction_donnee` : corrections ponctuelles — rien à proposer comme règle, et c'est dit ;
 *  - `exception_dossier` : un contrôle interne régulièrement rejeté, avec motif, dans UN dossier ;
 *  - `preference_cabinet` : la même récurrence sur plusieurs dossiers du cabinet ;
 *  - `nouvelle_regle_metier` : récurrence qu'aucun paramètre de cabinet ne peut traiter (extraction, rapprochement) —
 *    simple signalement, à instruire par l'éditeur ; aucune règle n'est créée ;
 *  - `modification_regle_reglementaire` : récurrence sur un contrôle à fondement réglementaire ou fiscal — JAMAIS
 *    proposée comme règle de cabinet ; renvoi vers la veille réglementaire, avec le motif.
 *
 * Une suggestion n'est jamais une règle : seules `exception_dossier` et `preference_cabinet` sont « proposables », et
 * seulement par l'action d'une personne, dans le circuit existant (proposition, mesure d'impact, approbation par une
 * AUTRE personne, retrait). Les seuils sont des CONVENTIONS INTERNES, à valider par un professionnel.
 */
import type { DefinitionControle } from './controles/types.js';
import { dec, estChaineDecimale } from './montant.js';

export const CRITERES_AMELIORATION = {
  version: '1.0.0',
  statut: 'conventions internes, non validées par un expert-comptable',
  /** Fenêtre d'observation appliquée par l'appelant quand il lit les décisions (mois glissants). */
  fenetreMois: 24,
  /** Un rejet ne compte que s'il est MOTIVÉ : motif d'au moins ce nombre de caractères (espaces de bord exclus). */
  motifMin: 10,
  /** Même contrôle, même dossier : anomalies distinctes rejetées avec motif, sans aucune décision contraire. */
  exceptionDossier: { rejetsMotivesMin: 3 },
  /** Même contrôle, plusieurs dossiers : chacun au moins un rejet motivé, sans aucune décision contraire dans le cabinet. */
  preferenceCabinet: { dossiersMin: 3, rejetsMotivesMin: 6 },
  /** Même émetteur, même champ extrait : pièces distinctes dont ce champ a été corrigé à la main. */
  extraction: { piecesCorrigeesMin: 3 },
  /** Même règle de rapprochement, même dossier : propositions rejetées avec motif, sans aucune validation. */
  rapprochement: { rejetsMotivesMin: 5 },
} as const;
export type CriteresAmelioration = typeof CRITERES_AMELIORATION;

export type CategorieAmelioration = 'correction_donnee' | 'exception_dossier' | 'preference_cabinet' | 'nouvelle_regle_metier' | 'modification_regle_reglementaire';
export const CATEGORIES_AMELIORATION: readonly CategorieAmelioration[] = ['correction_donnee', 'exception_dossier', 'preference_cabinet', 'nouvelle_regle_metier', 'modification_regle_reglementaire'];

/** Fondement d'un contrôle au regard de l'amélioration : seul « interne » peut recevoir une règle de cabinet suggérée. */
export type FondementControle = 'interne' | 'reglementaire' | 'fiscal';

export interface ControleAmelioration {
  id: string;
  titre: string;
  fondement: FondementControle;
  /** Référence de la source du contrôle (affichée dans le renvoi vers la veille). */
  reference: string;
  /** Paramètre « seuil de montant » du contrôle quand sa sémantique est établie (constat si montant > seuil). */
  parametreSeuil: string | null;
  seuilParDefaut: string | null;
}

/**
 * Contrôles dont le paramètre `seuil` a une sémantique vérifiée dans leur code : un constat n'est produit que si son
 * montant est STRICTEMENT supérieur au seuil, et le montant du constat est la grandeur comparée. Pour les autres
 * contrôles, le moteur ne désigne aucun paramètre : il appartient à la personne qui propose de le choisir.
 */
export const PARAMETRES_SEUIL_MONTANT: Readonly<Record<string, string>> = { 'TIE-001': 'seuil', 'TIE-002': 'seuil' };

/** Un contrôle du cycle TVA est traité comme « à fondement fiscal », même quand sa source déclarée est interne. */
export function fondementControle(c: Pick<DefinitionControle, 'cycle' | 'source'>): FondementControle {
  if (c.source.type === 'reglementaire') return 'reglementaire';
  return c.cycle === 'tva' ? 'fiscal' : 'interne';
}

export function controlesPourAmelioration(catalogue: readonly DefinitionControle[]): ControleAmelioration[] {
  return catalogue.map((c) => {
    const cle = PARAMETRES_SEUIL_MONTANT[c.id] ?? null;
    const defaut = cle ? c.parametresParDefaut[cle] : undefined;
    const exploitable = fondementControle(c) === 'interne' && cle !== null && estChaineDecimale(defaut);
    return { id: c.id, titre: c.titre, fondement: fondementControle(c), reference: c.source.reference, parametreSeuil: exploitable ? cle : null, seuilParDefaut: exploitable ? (defaut as string) : null };
  });
}

/** Décision de revue portant sur un constat. `cle` identifie l'anomalie d'une exécution à l'autre (dans un exercice). */
export interface DecisionConstatRevue {
  decisionId: string;
  constatId: string;
  controleId: string;
  dossierId: string;
  exerciceId: string;
  executionId: string;
  cle: string;
  /** accepter | rejeter | confirmer_anomalie | corriger | rouvrir | … (les autres actions sont ignorées). */
  action: string;
  motif: string | null;
  /** Chaîne décimale, jamais un flottant. */
  montant: string | null;
  /** Horodatage ISO. */
  date: string;
}

/** Pièce dont l'extraction en vigueur porte des champs corrigés à la main. */
export interface CorrectionExtraction {
  documentId: string;
  dossierId: string;
  /** Clé stable de l'émetteur (SIREN, à défaut nom normalisé) ; null si l'émetteur n'est pas identifié. */
  emetteur: string | null;
  emetteurLibelle: string | null;
  champs: string[];
  date: string;
}

export interface DecisionRapprochementRevue {
  decisionId: string;
  rapprochementId: string;
  dossierId: string;
  regle: string;
  /** valider | rejeter | remettre_en_proposition */
  action: string;
  motif: string | null;
  date: string;
}

/** Suggestion déjà écartée par une personne, ou règle déjà tranchée (refusée, retirée) pour la même cible. */
export interface DecisionAnterieure {
  empreinte: string;
  le: string;
  motif: string;
}

export interface EntreeAmelioration {
  constats: readonly DecisionConstatRevue[];
  corrections: readonly CorrectionExtraction[];
  rapprochements: readonly DecisionRapprochementRevue[];
  controles: readonly ControleAmelioration[];
  /** Suggestions écartées : elles ne reviennent que si des décisions POSTÉRIEURES atteignent seules les seuils. */
  ecartees?: readonly DecisionAnterieure[];
  /** Cibles (empreintes) pour lesquelles une règle est déjà proposée ou approuvée : aucune suggestion redondante. */
  reglesEnCours?: readonly string[];
}

export interface PreuveDecision {
  decisionId: string;
  cibleId: string;
  dossierId: string;
  date: string;
  motif: string | null;
}

export interface SuggestionAmelioration {
  /** Identité stable : catégorie, objet, cible. Sert à écarter une suggestion et à ne pas la reproposer à l'identique. */
  empreinte: string;
  categorie: CategorieAmelioration;
  titre: string;
  /** Ce qui a été observé, en clair. */
  constat: string;
  /** Critère appliqué, en clair, avec ses seuils. */
  critere: string;
  controleId: string | null;
  dossierIds: string[];
  portee: 'dossier' | 'cabinet' | null;
  /** Vrai seulement pour une exception de dossier ou une préférence de cabinet sur un contrôle interne. */
  proposable: boolean;
  renvoi: 'veille' | 'editeur' | null;
  /** Paramètre du contrôle concerné, quand sa sémantique est établie ; la valeur est INDICATIVE. */
  parametre: { cle: string; valeurParDefaut: string; valeurIndicative: string; explication: string } | null;
  /** Pré-remplissage de la proposition de règle (aucune règle n'est créée par le moteur). */
  proposition: { controleId: string; entiteId: string | null; parametres: Record<string, string>; motif: string } | null;
  preuves: {
    decomptes: Record<string, number>;
    periode: { du: string; au: string } | null;
    decisions: PreuveDecision[];
    decisionsNonListees: number;
  };
  neFaitPas: string[];
  /** Renseigné quand la suggestion revient après avoir été écartée (décisions postérieures suffisantes). */
  dejaEcartee: { le: string; motif: string } | null;
}

export interface ResultatAmelioration {
  criteres: CriteresAmelioration;
  suggestions: SuggestionAmelioration[];
  /** Suggestions écartées qui restent écartées (aucune récurrence nouvelle depuis). */
  ecarteesMaintenues: DecisionAnterieure[];
  /** Cibles non suggérées parce qu'une règle y est déjà proposée ou approuvée. */
  dejaEnCours: string[];
  /** Vrai si aucune décision de revue n'a été fournie. */
  sansDecision: boolean;
}

const PREUVES_MAX = 20;
const CONTRAIRES = new Set(['accepter', 'confirmer_anomalie', 'corriger']);
const DECISIVES = new Set(['rejeter', 'rouvrir', ...CONTRAIRES]);

const NE_FAIT_PAS_COMMUN = [
  'N’active rien : aucune règle n’est créée ni appliquée par cette suggestion.',
  'Ne modifie aucune décision passée, aucun constat, aucune écriture.',
  'Ne repose que sur les décisions de ce cabinet : aucune donnée d’un autre cabinet n’a servi.',
];

const parDate = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const estMotive = (motif: string | null, min: number): boolean => (motif ?? '').trim().length >= min;

function periodeDe(dates: readonly string[]): { du: string; au: string } | null {
  if (dates.length === 0) return null;
  const tri = [...dates].sort();
  return { du: tri[0] as string, au: tri[tri.length - 1] as string };
}

function preuves(decisions: readonly PreuveDecision[], decomptes: Record<string, number>): SuggestionAmelioration['preuves'] {
  const tri = [...decisions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.decisionId < b.decisionId ? -1 : 1));
  return { decomptes, periode: periodeDe(decisions.map((d) => d.date)), decisions: tri.slice(0, PREUVES_MAX), decisionsNonListees: Math.max(0, tri.length - PREUVES_MAX) };
}

interface Anomalie {
  finale: DecisionConstatRevue;
  dossierId: string;
  controleId: string;
}

/** Dernière décision décisive par anomalie (dossier, exercice, contrôle, clé) ; « rouvrir » en dernier = non tranchée. */
function anomaliesTranchees(decisions: readonly DecisionConstatRevue[]): Anomalie[] {
  const dernieres = new Map<string, DecisionConstatRevue>();
  for (const d of [...decisions].filter((x) => DECISIVES.has(x.action)).sort((a, b) => parDate(a, b) || (a.decisionId < b.decisionId ? -1 : 1))) {
    dernieres.set(`${d.dossierId}\u0001${d.exerciceId}\u0001${d.controleId}\u0001${d.cle}`, d);
  }
  return [...dernieres.values()].filter((d) => d.action !== 'rouvrir').map((d) => ({ finale: d, dossierId: d.dossierId, controleId: d.controleId }));
}

/**
 * Suggestions d'amélioration pour un cabinet. `entree` ne doit contenir que les décisions de CE cabinet, dans le
 * périmètre autorisé de la personne qui consulte (l'appelant les lit sous ses habilitations).
 */
export function suggererAmeliorations(entree: EntreeAmelioration, criteres: CriteresAmelioration = CRITERES_AMELIORATION): ResultatAmelioration {
  const controles = new Map(entree.controles.map((c) => [c.id, c]));
  const derniereEcartee = new Map<string, DecisionAnterieure>();
  for (const e of [...(entree.ecartees ?? [])].sort((a, b) => (a.le < b.le ? -1 : 1))) derniereEcartee.set(e.empreinte, e);
  const enCours = new Set(entree.reglesEnCours ?? []);
  const suggestions: SuggestionAmelioration[] = [];
  const ecarteesMaintenues: DecisionAnterieure[] = [];
  const dejaEnCours: string[] = [];

  /**
   * Applique la règle « écartée » : si la suggestion a été écartée, `atteint(depuis)` doit rester vrai en ne comptant
   * que les décisions postérieures à l'écart. Renvoie null si la suggestion ne doit pas être émise.
   */
  const filtrer = (empreinte: string, atteint: (depuis: string | null) => boolean): { dejaEcartee: SuggestionAmelioration['dejaEcartee'] } | null => {
    if (!atteint(null)) return null;
    if (enCours.has(empreinte)) {
      dejaEnCours.push(empreinte);
      return null;
    }
    const e = derniereEcartee.get(empreinte);
    if (!e) return { dejaEcartee: null };
    if (!atteint(e.le)) {
      ecarteesMaintenues.push(e);
      return null;
    }
    return { dejaEcartee: { le: e.le, motif: e.motif } };
  };

  // ── 1. Constats : par contrôle, puis par dossier ──
  const anomalies = anomaliesTranchees(entree.constats);
  const parControle = new Map<string, Anomalie[]>();
  for (const a of anomalies) parControle.set(a.controleId, [...(parControle.get(a.controleId) ?? []), a]);
  let correctionsConstats = 0;
  let rejetsIsoles = 0;

  for (const controleId of [...parControle.keys()].sort()) {
    const liste = parControle.get(controleId) ?? [];
    const def = controles.get(controleId);
    const rejets = liste.filter((a) => a.finale.action === 'rejeter' && estMotive(a.finale.motif, criteres.motifMin));
    const nonMotives = liste.filter((a) => a.finale.action === 'rejeter' && !estMotive(a.finale.motif, criteres.motifMin)).length;
    const contraires = liste.filter((a) => CONTRAIRES.has(a.finale.action));
    correctionsConstats += liste.filter((a) => a.finale.action === 'corriger').length;
    if (!def) {
      rejetsIsoles += rejets.length;
      continue;
    }
    const dossiers = [...new Set(liste.map((a) => a.dossierId))].sort();
    const rejetsDe = (dossierId: string, depuis: string | null) => rejets.filter((a) => a.dossierId === dossierId && (depuis === null || a.finale.date > depuis));
    const contrairesDe = (dossierId: string) => contraires.filter((a) => a.dossierId === dossierId);
    const versPreuve = (a: Anomalie): PreuveDecision => ({ decisionId: a.finale.decisionId, cibleId: a.finale.constatId, dossierId: a.dossierId, date: a.finale.date, motif: a.finale.motif });
    const decomptes = (r: Anomalie[], c: number, nbDossiers: number) => ({
      rejetsMotives: r.length,
      rejetsNonMotives: nonMotives,
      decisionsContraires: c,
      executions: new Set(r.map((a) => a.finale.executionId)).size,
      dossiers: nbDossiers,
    });
    const atteintDossier = (dossierId: string, depuis: string | null) => rejetsDe(dossierId, depuis).length >= criteres.exceptionDossier.rejetsMotivesMin && contrairesDe(dossierId).length === 0;

    // Contrôle à fondement réglementaire ou fiscal : jamais de règle de cabinet ; renvoi vers la veille.
    if (def.fondement !== 'interne') {
      const concernes = dossiers.filter((d) => atteintDossier(d, null));
      const empreinte = `modification_regle_reglementaire|${controleId}`;
      const issue = concernes.length > 0 ? filtrer(empreinte, (depuis) => concernes.some((d) => atteintDossier(d, depuis))) : null;
      if (issue) {
        const r = rejets.filter((a) => concernes.includes(a.dossierId));
        suggestions.push({
          empreinte,
          categorie: 'modification_regle_reglementaire',
          titre: `${controleId} — ${def.titre} : contrôle à fondement ${def.fondement === 'fiscal' ? 'fiscal' : 'réglementaire'}, aucune règle de cabinet`,
          constat: `${r.length} constat(s) de ce contrôle ont été rejetés avec motif dans ${concernes.length} dossier(s), sans décision contraire. Ce contrôle repose sur : ${def.reference}. Son application ne s’assouplit pas par une préférence ou une exception de cabinet.`,
          critere: `Même contrôle, même dossier : au moins ${criteres.exceptionDossier.rejetsMotivesMin} anomalies distinctes rejetées avec un motif d’au moins ${criteres.motifMin} caractères, sans acceptation, confirmation ni correction (critères v${criteres.version}).`,
          controleId,
          dossierIds: concernes,
          portee: null,
          proposable: false,
          renvoi: 'veille',
          parametre: null,
          proposition: null,
          preuves: preuves(r.map(versPreuve), decomptes(r, 0, concernes.length)),
          neFaitPas: [
            'Ne propose AUCUNE règle de cabinet : un contrôle à fondement réglementaire ou fiscal ne se paramètre pas ainsi.',
            'Ne modifie pas la règle : si le texte applicable a changé, cela se traite dans la veille réglementaire, par une personne, sur une source officielle.',
            ...NE_FAIT_PAS_COMMUN,
          ],
          dejaEcartee: issue.dejaEcartee,
        });
      } else rejetsIsoles += rejets.filter((a) => !concernes.includes(a.dossierId)).length;
      continue;
    }

    const proposer = (portee: 'dossier' | 'cabinet', dossierId: string | null, r: Anomalie[]): Pick<SuggestionAmelioration, 'parametre' | 'proposition'> => {
      let parametre: SuggestionAmelioration['parametre'] = null;
      const montants = r.map((a) => a.finale.montant);
      if (def.parametreSeuil && def.seuilParDefaut !== null && montants.every((m): m is string => estChaineDecimale(m))) {
        const max = montants.map((m) => dec(m)).reduce((a, b) => (b.greaterThan(a) ? b : a));
        if (max.greaterThan(dec(def.seuilParDefaut))) {
          parametre = {
            cle: def.parametreSeuil,
            valeurParDefaut: def.seuilParDefaut,
            valeurIndicative: max.toFixed(2),
            explication: `Plus grand montant parmi les ${r.length} constats rejetés : avec ce seuil, ces constats ne seraient plus produits. Valeur indicative, à ajuster ; son effet réel se mesure avant toute approbation.`,
          };
        }
      }
      const motif = `Suggestion tirée de ${r.length} rejets motivés du contrôle ${controleId}${portee === 'cabinet' ? ` sur ${new Set(r.map((a) => a.dossierId)).size} dossiers` : ''} (critères v${criteres.version}). À compléter par la personne qui propose.`;
      return { parametre, proposition: { controleId, entiteId: dossierId, parametres: parametre ? { [parametre.cle]: parametre.valeurIndicative } : {}, motif } };
    };
    const neFaitPas = [
      'Ne vaut pas règle : elle ne devient une règle PROPOSÉE que si une personne le décide, puis son impact est mesuré et une AUTRE personne habilitée l’approuve.',
      'La valeur indicative n’est pas une recommandation professionnelle.',
      ...NE_FAIT_PAS_COMMUN,
    ];

    // Préférence du cabinet : récurrence sur plusieurs dossiers, sans aucune décision contraire dans le cabinet.
    const atteintCabinet = (depuis: string | null) => {
      const r = rejets.filter((a) => depuis === null || a.finale.date > depuis);
      return contraires.length === 0 && r.length >= criteres.preferenceCabinet.rejetsMotivesMin && new Set(r.map((a) => a.dossierId)).size >= criteres.preferenceCabinet.dossiersMin;
    };
    const empreinteCabinet = `preference_cabinet|${controleId}`;
    const cabinetAtteint = atteintCabinet(null);
    const issueCabinet = cabinetAtteint ? filtrer(empreinteCabinet, atteintCabinet) : null;
    if (issueCabinet) {
      const concernes = [...new Set(rejets.map((a) => a.dossierId))].sort();
      suggestions.push({
        empreinte: empreinteCabinet,
        categorie: 'preference_cabinet',
        titre: `${controleId} — ${def.titre} : préférence possible pour tout le cabinet`,
        constat: `${rejets.length} constats de ce contrôle ont été rejetés avec motif dans ${concernes.length} dossiers, sans aucune décision contraire dans le cabinet.`,
        critere: `Même contrôle : au moins ${criteres.preferenceCabinet.rejetsMotivesMin} anomalies distinctes rejetées avec motif (${criteres.motifMin} caractères au moins), dans au moins ${criteres.preferenceCabinet.dossiersMin} dossiers, sans acceptation, confirmation ni correction d’un constat de ce contrôle dans le cabinet (critères v${criteres.version}).`,
        controleId,
        dossierIds: concernes,
        portee: 'cabinet',
        proposable: true,
        renvoi: null,
        ...proposer('cabinet', null, rejets),
        preuves: preuves(rejets.map(versPreuve), decomptes(rejets, 0, concernes.length)),
        neFaitPas,
        dejaEcartee: issueCabinet.dejaEcartee,
      });
    }
    // Dès que le critère « cabinet » est atteint, les exceptions de dossier du même contrôle ne sont plus émises
    // (que la préférence soit suggérée, déjà en cours, ou écartée) : une seule suggestion par contrôle.
    if (cabinetAtteint) continue;

    // Exception propre à un dossier.
    for (const dossierId of dossiers) {
      const r = rejetsDe(dossierId, null);
      const empreinte = `exception_dossier|${controleId}|${dossierId}`;
      const issue = filtrer(empreinte, (depuis) => atteintDossier(dossierId, depuis));
      if (!issue) {
        if (!atteintDossier(dossierId, null)) rejetsIsoles += r.length;
        continue;
      }
      suggestions.push({
        empreinte,
        categorie: 'exception_dossier',
        titre: `${controleId} — ${def.titre} : exception possible pour ce dossier`,
        constat: `${r.length} constats de ce contrôle ont été rejetés avec motif dans ce dossier, sans aucune décision contraire.`,
        critere: `Même contrôle, même dossier : au moins ${criteres.exceptionDossier.rejetsMotivesMin} anomalies distinctes rejetées avec un motif d’au moins ${criteres.motifMin} caractères, sans acceptation, confirmation ni correction (critères v${criteres.version}).`,
        controleId,
        dossierIds: [dossierId],
        portee: 'dossier',
        proposable: true,
        renvoi: null,
        ...proposer('dossier', dossierId, r),
        preuves: preuves(r.map(versPreuve), decomptes(r, 0, 1)),
        neFaitPas,
        dejaEcartee: issue.dejaEcartee,
      });
    }
  }

  // ── 2. Corrections de champs extraits : même émetteur, même champ ──
  const parEmetteurChamp = new Map<string, CorrectionExtraction[]>();
  let champsCorrigesIsoles = 0;
  for (const c of entree.corrections) {
    for (const champ of [...new Set(c.champs)]) {
      if (c.emetteur === null) {
        champsCorrigesIsoles += 1;
        continue;
      }
      const cle = `${c.emetteur}\u0001${champ}`;
      parEmetteurChamp.set(cle, [...(parEmetteurChamp.get(cle) ?? []), c]);
    }
  }
  for (const cle of [...parEmetteurChamp.keys()].sort()) {
    const [emetteur, champ] = cle.split('\u0001') as [string, string];
    const pieces = [...new Map((parEmetteurChamp.get(cle) ?? []).map((c) => [c.documentId, c])).values()];
    const empreinte = `nouvelle_regle_metier|extraction|${emetteur}|${champ}`;
    const issue = filtrer(empreinte, (depuis) => pieces.filter((p) => depuis === null || p.date > depuis).length >= criteres.extraction.piecesCorrigeesMin);
    if (!issue) {
      if (pieces.length < criteres.extraction.piecesCorrigeesMin) champsCorrigesIsoles += pieces.length;
      continue;
    }
    const libelle = pieces.find((p) => p.emetteurLibelle)?.emetteurLibelle ?? emetteur;
    suggestions.push({
      empreinte,
      categorie: 'nouvelle_regle_metier',
      titre: `Extraction : champ « ${champ} » régulièrement corrigé pour l’émetteur ${libelle}`,
      constat: `Le champ « ${champ} » a été corrigé à la main sur ${pieces.length} pièces distinctes de cet émetteur. Aucun paramètre de cabinet ne règle l’extraction : c’est un signalement, à instruire par l’éditeur du logiciel.`,
      critere: `Même émetteur, même champ : au moins ${criteres.extraction.piecesCorrigeesMin} pièces distinctes dont l’extraction en vigueur porte ce champ corrigé à la main (critères v${criteres.version}).`,
      controleId: null,
      dossierIds: [...new Set(pieces.map((p) => p.dossierId))].sort(),
      portee: null,
      proposable: false,
      renvoi: 'editeur',
      parametre: null,
      proposition: null,
      preuves: preuves(pieces.map((p) => ({ decisionId: p.documentId, cibleId: p.documentId, dossierId: p.dossierId, date: p.date, motif: null })), { piecesCorrigees: pieces.length, dossiers: new Set(pieces.map((p) => p.dossierId)).size }),
      neFaitPas: ['Ne crée aucune règle d’extraction et ne modifie aucune pièce.', 'Ne transmet rien à l’éditeur : le signalement reste dans le cabinet tant qu’une personne ne décide pas de le communiquer.', ...NE_FAIT_PAS_COMMUN],
      dejaEcartee: issue.dejaEcartee,
    });
  }

  // ── 3. Rapprochements rejetés : même règle de rapprochement, même dossier ──
  const dernieresRappro = new Map<string, DecisionRapprochementRevue>();
  for (const d of [...entree.rapprochements].sort((a, b) => parDate(a, b) || (a.decisionId < b.decisionId ? -1 : 1))) dernieresRappro.set(d.rapprochementId, d);
  const parRegle = new Map<string, DecisionRapprochementRevue[]>();
  for (const d of dernieresRappro.values()) {
    if (d.action !== 'rejeter' && d.action !== 'valider') continue;
    const cle = `${d.regle}\u0001${d.dossierId}`;
    parRegle.set(cle, [...(parRegle.get(cle) ?? []), d]);
  }
  let rapprochementsIsoles = 0;
  for (const cle of [...parRegle.keys()].sort()) {
    const [regle, dossierId] = cle.split('\u0001') as [string, string];
    const liste = parRegle.get(cle) ?? [];
    const rejets = liste.filter((d) => d.action === 'rejeter' && estMotive(d.motif, criteres.motifMin));
    const valides = liste.filter((d) => d.action === 'valider').length;
    const empreinte = `nouvelle_regle_metier|rapprochement|${regle}|${dossierId}`;
    const issue = filtrer(empreinte, (depuis) => valides === 0 && rejets.filter((d) => depuis === null || d.date > depuis).length >= criteres.rapprochement.rejetsMotivesMin);
    if (!issue) {
      if (valides > 0 || rejets.length < criteres.rapprochement.rejetsMotivesMin) rapprochementsIsoles += rejets.length;
      continue;
    }
    suggestions.push({
      empreinte,
      categorie: 'nouvelle_regle_metier',
      titre: `Rapprochement : propositions de la règle « ${regle} » régulièrement rejetées dans ce dossier`,
      constat: `${rejets.length} rapprochements proposés par la règle « ${regle} » ont été rejetés avec motif dans ce dossier, et aucun n’a été validé. Les règles de rapprochement ne se règlent pas par une règle de cabinet : c’est un signalement, à instruire par l’éditeur du logiciel.`,
      critere: `Même règle de rapprochement, même dossier : au moins ${criteres.rapprochement.rejetsMotivesMin} propositions rejetées avec motif (${criteres.motifMin} caractères au moins), aucune validée (critères v${criteres.version}).`,
      controleId: null,
      dossierIds: [dossierId],
      portee: null,
      proposable: false,
      renvoi: 'editeur',
      parametre: null,
      proposition: null,
      preuves: preuves(rejets.map((d) => ({ decisionId: d.decisionId, cibleId: d.rapprochementId, dossierId: d.dossierId, date: d.date, motif: d.motif })), { rejetsMotives: rejets.length, validations: valides, dossiers: 1 }),
      neFaitPas: ['Ne modifie ni la règle de rapprochement ni aucun rapprochement existant.', 'Ne transmet rien à l’éditeur : le signalement reste dans le cabinet tant qu’une personne ne décide pas de le communiquer.', ...NE_FAIT_PAS_COMMUN],
      dejaEcartee: issue.dejaEcartee,
    });
  }

  // ── 4. Corrections ponctuelles : corrections de données, rien à proposer comme règle ──
  const ponctuelles = correctionsConstats + champsCorrigesIsoles + rejetsIsoles + rapprochementsIsoles;
  if (ponctuelles > 0) {
    suggestions.push({
      empreinte: 'correction_donnee',
      categorie: 'correction_donnee',
      titre: 'Corrections ponctuelles : rien à proposer comme règle',
      constat: `${correctionsConstats} constat(s) corrigé(s), ${champsCorrigesIsoles} champ(s) extrait(s) corrigé(s), ${rejetsIsoles} rejet(s) de constat et ${rapprochementsIsoles} rejet(s) de rapprochement n’atteignent aucun seuil de récurrence. Ce sont des corrections de données : elles restent des décisions au cas par cas.`,
      critere: `En dessous des seuils de récurrence des critères v${criteres.version}.`,
      controleId: null,
      dossierIds: [],
      portee: null,
      proposable: false,
      renvoi: null,
      parametre: null,
      proposition: null,
      preuves: { decomptes: { constatsCorriges: correctionsConstats, champsCorriges: champsCorrigesIsoles, rejetsIsoles, rapprochementsRejetesIsoles: rapprochementsIsoles }, periode: null, decisions: [], decisionsNonListees: 0 },
      neFaitPas: ['Ne propose aucune règle : une correction ponctuelle ne fonde pas une règle.', ...NE_FAIT_PAS_COMMUN],
      dejaEcartee: null,
    });
  }

  const rang = (s: SuggestionAmelioration) => ['exception_dossier', 'preference_cabinet', 'modification_regle_reglementaire', 'nouvelle_regle_metier', 'correction_donnee'].indexOf(s.categorie);
  suggestions.sort((a, b) => rang(a) - rang(b) || (a.empreinte < b.empreinte ? -1 : a.empreinte > b.empreinte ? 1 : 0));
  return {
    criteres,
    suggestions,
    ecarteesMaintenues: ecarteesMaintenues.sort((a, b) => (a.empreinte < b.empreinte ? -1 : 1)),
    dejaEnCours: [...new Set(dejaEnCours)].sort(),
    sansDecision: entree.constats.length === 0 && entree.corrections.length === 0 && entree.rapprochements.length === 0,
  };
}
