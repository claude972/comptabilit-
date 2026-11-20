/**
 * Destinataire (acheteur) d'une pièce : couche HUMAINE distincte de la lecture automatique, et fusion avec une
 * réanalyse — fonctions pures (D-091).
 *
 * Principes :
 *  - une correction manuelle est inscrite DANS l'extraction (même mécanisme que la correction des autres champs : une
 *    nouvelle version, toutes les précédentes conservées), champ par champ, avec sa provenance (`methode: 'saisie_humaine'`,
 *    auteur, date, motif) ET la valeur automatique qu'elle remplace (`automatique`) ;
 *  - la valeur humaine PRIME sur l'automatique ; une réanalyse ne l'écrase jamais : elle met à jour la valeur
 *    automatique mémorisée à côté et signale seulement le désaccord (`desaccord`) ;
 *  - rien n'est deviné : un champ saisi est validé (clés de contrôle SIREN, SIRET, TVA française).
 */
import { validerSiren, validerSiret, validerTvaIntracomFr } from '../identifiants.js';
import type { ChampsFacture } from './types.js';

/** Version de l'analyseur de factures (lecture des champs). À incrémenter à chaque évolution de la lecture des champs. */
export const VERSION_ANALYSEUR_FACTURE = '2026-11-20.1';

export const CHAMPS_DESTINATAIRE = ['destinataireNom', 'destinataireSiren', 'destinataireSiret', 'destinataireTva', 'destinatairePays'] as const;
export type ChampDestinataire = (typeof CHAMPS_DESTINATAIRE)[number];
export type ValeursDestinataire = Record<ChampDestinataire, string | null>;
/** Saisie d'une correction : seuls les champs présents sont modifiés ; `null` = « aucune valeur » (effacement). */
export type SaisieDestinataire = Partial<Record<ChampDestinataire, string | null>>;

/** Valeur automatique mémorisée à côté d'une valeur humaine. */
export interface ValeurAutomatique {
  valeur: string | null;
  /** Version de l'extraction qui portait cette valeur automatique ; null si elle ne figurait pas encore (extraction antérieure à D-084). */
  versionExtraction: number | null;
  versionAnalyseur: string | null;
}

/** Champ du destinataire tel que stocké après une correction humaine. */
export interface ChampDestinataireHumain {
  valeur: string | null;
  page: null;
  extrait: null;
  boite: null;
  methode: 'saisie_humaine';
  confiance: 'non_evaluee';
  corrigePar: string;
  corrigeLe: string;
  motif: string;
  automatique: ValeurAutomatique;
  /** Vrai quand la dernière lecture automatique diffère de la valeur humaine (signalé, jamais appliqué). */
  desaccord: boolean;
}

type Champs = Record<string, unknown>;
const objet = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Valeur textuelle d'un champ stocké (vide ou absent : null). */
function valeurDe(champ: unknown): string | null {
  const v = objet(champ)?.valeur;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
export const estChampHumain = (champ: unknown): boolean => objet(champ)?.methode === 'saisie_humaine';

/**
 * Vrai si la LECTURE AUTOMATIQUE du destinataire n'a pas été faite pour cette extraction (extraction antérieure à D-084).
 * Une correction humaine posée sur une telle extraction le marque (`destinataireNonLuAuto`) : la pièce reste concernée par
 * la réanalyse, qui n'écrase pas la correction mais en signale le désaccord éventuel.
 */
export function destinataireNonLu(champs: Champs): boolean {
  if (champs.destinataireNonLuAuto === true) return true;
  return !('destinataireAbstention' in champs) && !CHAMPS_DESTINATAIRE.some((c) => c in champs);
}

/** Valeurs effectives du destinataire (la valeur humaine, quand il y en a une, prime sur l'automatique). */
export function destinataireEffectif(champs: Champs): ValeursDestinataire {
  return {
    destinataireNom: valeurDe(champs.destinataireNom),
    destinataireSiren: valeurDe(champs.destinataireSiren),
    destinataireSiret: valeurDe(champs.destinataireSiret),
    destinataireTva: valeurDe(champs.destinataireTva),
    destinatairePays: valeurDe(champs.destinatairePays),
  };
}

export interface LigneDestinataire {
  champ: ChampDestinataire;
  /** Valeur retenue (celle qui sert au calcul du sens et des appariements). */
  effective: string | null;
  source: 'humain' | 'automatique' | 'non_lu';
  /** Dernière valeur AUTOMATIQUE connue (côte à côte avec la valeur humaine). */
  automatique: string | null;
  humain: string | null;
  desaccord: boolean;
  corrigePar: string | null;
  corrigeLe: string | null;
  motif: string | null;
}

/** Vue champ par champ, pour l'affichage côte à côte de la valeur automatique et de la valeur humaine. */
export function lignesDestinataire(champs: Champs): LigneDestinataire[] {
  const nonLu = destinataireNonLu(champs);
  return CHAMPS_DESTINATAIRE.map((champ) => {
    const c = objet(champs[champ]);
    const humain = estChampHumain(c);
    const auto = humain ? objet(c?.automatique) : null;
    const automatique = humain ? (typeof auto?.valeur === 'string' ? auto.valeur : null) : valeurDe(c);
    return {
      champ,
      effective: valeurDe(c),
      source: humain ? 'humain' : nonLu ? 'non_lu' : 'automatique',
      automatique,
      humain: humain ? valeurDe(c) : null,
      desaccord: humain && c?.desaccord === true,
      corrigePar: humain && typeof c?.corrigePar === 'string' ? c.corrigePar : null,
      corrigeLe: humain && typeof c?.corrigeLe === 'string' ? c.corrigeLe : null,
      motif: humain && typeof c?.motif === 'string' ? c.motif : null,
    };
  });
}

const compact = (v: string): string => v.replace(/[\s.]/g, '');

/**
 * Valide et normalise une saisie. Retourne les erreurs en français ; aucune valeur n'est devinée ni complétée.
 * Contrôles : SIREN et SIRET (14 chiffres, clé de Luhn), TVA française (clé numérique vérifiée), pays ISO 3166-1 alpha-2.
 */
export function normaliserSaisieDestinataire(saisie: SaisieDestinataire): { valeurs: SaisieDestinataire; erreurs: string[] } {
  const valeurs: SaisieDestinataire = {};
  const erreurs: string[] = [];
  for (const champ of CHAMPS_DESTINATAIRE) {
    if (!(champ in saisie)) continue;
    const brut = saisie[champ];
    if (brut === null || brut === undefined || (typeof brut === 'string' && brut.trim() === '')) {
      valeurs[champ] = null;
      continue;
    }
    if (typeof brut !== 'string') {
      erreurs.push(`${champ} : texte attendu.`);
      continue;
    }
    if (champ === 'destinataireNom') {
      const nom = brut.replace(/\s+/g, ' ').trim();
      if (nom.length > 200) erreurs.push('Nom du destinataire : 200 caractères au plus.');
      else valeurs[champ] = nom;
    } else if (champ === 'destinataireSiren') {
      const s = compact(brut);
      const v = validerSiren(s);
      if (!v.valide) erreurs.push(`SIREN du destinataire : ${v.motif ?? 'invalide'}`);
      else valeurs[champ] = s;
    } else if (champ === 'destinataireSiret') {
      const s = compact(brut);
      const v = validerSiret(s);
      if (!v.valide) erreurs.push(`SIRET du destinataire : ${v.motif ?? 'invalide'}`);
      else valeurs[champ] = s;
    } else if (champ === 'destinataireTva') {
      const t = compact(brut).toUpperCase();
      if (!/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(t)) erreurs.push('Numéro de TVA du destinataire : code pays de deux lettres suivi de 2 à 12 caractères attendus.');
      else if (t.startsWith('FR')) {
        const v = validerTvaIntracomFr(t);
        // Une clé alphanumérique française ne se vérifie pas par calcul : elle est acceptée mais reste non vérifiée.
        if (!v.valide && !(v.motif ?? '').startsWith('Clé alphanumérique')) erreurs.push(`Numéro de TVA du destinataire : ${v.motif ?? 'invalide'}`);
        else valeurs[champ] = t;
      } else valeurs[champ] = t;
    } else {
      const p = brut.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(p)) erreurs.push('Pays du destinataire : code ISO à deux lettres attendu (par exemple FR).');
      else valeurs[champ] = p;
    }
  }
  if (Object.keys(saisie).length === 0) erreurs.push('Au moins un champ du destinataire doit être renseigné.');
  return { valeurs, erreurs };
}

/** Cohérence entre les identifiants du destinataire effectif (le SIRET commence par le SIREN, la TVA française le contient). */
export function incoherencesDestinataire(v: ValeursDestinataire): string[] {
  const r: string[] = [];
  if (v.destinataireSiren && v.destinataireSiret && !v.destinataireSiret.startsWith(v.destinataireSiren)) r.push('Le SIRET du destinataire ne commence pas par son SIREN.');
  if (v.destinataireSiren && v.destinataireTva && /^FR[0-9A-Z]{2}\d{9}$/.test(v.destinataireTva) && v.destinataireTva.slice(4) !== v.destinataireSiren) r.push('Le numéro de TVA français du destinataire ne contient pas son SIREN.');
  if (v.destinataireSiret && v.destinataireTva && /^FR[0-9A-Z]{2}\d{9}$/.test(v.destinataireTva) && v.destinataireTva.slice(4) !== v.destinataireSiret.slice(0, 9)) r.push('Le numéro de TVA français du destinataire ne contient pas le SIREN de son SIRET.');
  return r;
}

export interface ContexteCorrectionDestinataire {
  auteurId: string;
  /** Horodatage ISO de la correction. */
  le: string;
  motif: string;
  /** Version de l'extraction sur laquelle porte la correction. */
  versionBase: number;
  /** Version de l'extraction créée par la correction. */
  versionNouvelle: number;
  /** Version de l'analyseur qui a produit la valeur automatique de la base (null si inconnue). */
  versionAnalyseurBase: string | null;
}

export interface ResultatCorrectionDestinataire {
  champs: Champs;
  avant: ValeursDestinataire;
  apres: ValeursDestinataire;
  /** Champs dont la valeur effective a changé. */
  modifies: ChampDestinataire[];
  erreurs: string[];
}

/** Version depuis laquelle les champs HORS destinataire sont inchangés (les décisions prises depuis restent valables). */
export const inchangeDepuis = (champs: Champs, versionDeRepli: number): number => {
  const n = champs.inchangeDepuis;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= versionDeRepli ? n : versionDeRepli;
};

/**
 * Applique une correction humaine du destinataire à des champs d'extraction. Ne modifie pas l'entrée.
 * Chaque champ saisi devient un champ humain portant la valeur automatique qu'il remplace ; les autres champs sont
 * conservés tels quels. `erreurs` non vide : rien n'est appliqué.
 */
export function appliquerCorrectionDestinataire(base: Champs, saisie: SaisieDestinataire, ctx: ContexteCorrectionDestinataire): ResultatCorrectionDestinataire {
  const { valeurs, erreurs } = normaliserSaisieDestinataire(saisie);
  const avant = destinataireEffectif(base);
  const apresChamps: Champs = { ...base };
  if (erreurs.length === 0) {
    for (const champ of CHAMPS_DESTINATAIRE) {
      if (!(champ in valeurs)) continue;
      const ancien = objet(base[champ]);
      const automatique: ValeurAutomatique = estChampHumain(ancien)
        ? ({ valeur: null, versionExtraction: null, versionAnalyseur: null, ...(objet(ancien?.automatique) ?? {}) } as ValeurAutomatique)
        : { valeur: valeurDe(ancien), versionExtraction: destinataireNonLu(base) ? null : ctx.versionBase, versionAnalyseur: destinataireNonLu(base) ? null : ctx.versionAnalyseurBase };
      const valeur = valeurs[champ] ?? null;
      const humain: ChampDestinataireHumain = {
        valeur, page: null, extrait: null, boite: null, methode: 'saisie_humaine', confiance: 'non_evaluee',
        corrigePar: ctx.auteurId, corrigeLe: ctx.le, motif: ctx.motif, automatique, desaccord: automatique.valeur !== valeur && !(automatique.valeur === null && valeur === null),
      };
      apresChamps[champ] = humain;
    }
    // Les champs non saisis du destinataire absents d'une extraction antérieure sont posés à « non lu » (null) : l'extraction porte désormais la lecture.
    for (const champ of CHAMPS_DESTINATAIRE) if (!(champ in apresChamps)) apresChamps[champ] = null;
  }
  const apres = destinataireEffectif(apresChamps);
  const incoherences = erreurs.length === 0 ? incoherencesDestinataire(apres) : [];
  if (incoherences.length > 0) erreurs.push(...incoherences.map((m) => `${m} Corrigez ou effacez aussi la valeur lue automatiquement si elle est erronée.`));
  if (erreurs.length === 0) {
    const identifie = apres.destinataireSiren || apres.destinataireSiret || apres.destinataireTva || apres.destinataireNom;
    apresChamps.destinataireAbstention = identifie ? null : 'Aucun destinataire retenu : les valeurs ont été effacées par une personne.';
    if (destinataireNonLu(base)) apresChamps.destinataireNonLuAuto = true;
    apresChamps.inchangeDepuis = inchangeDepuis(base, ctx.versionBase);
  }
  const modifies = CHAMPS_DESTINATAIRE.filter((c) => avant[c] !== apres[c]);
  return { champs: erreurs.length === 0 ? apresChamps : { ...base }, avant, apres, modifies, erreurs };
}

export type ResultatReanalyse = 'destinataire_trouve' | 'abstention' | 'inchangee';

export interface DesaccordDestinataire {
  champ: ChampDestinataire;
  humain: string | null;
  automatique: string | null;
}

export interface ResultatFusionReanalyse {
  resultat: ResultatReanalyse;
  /** Champs de la NOUVELLE version : ceux de la précédente, avec la lecture automatique du destinataire. */
  champs: Champs;
  avant: ValeursDestinataire;
  apres: ValeursDestinataire;
  /** Valeurs lues automatiquement par la réanalyse (avant fusion avec la couche humaine). */
  automatique: ValeursDestinataire;
  desaccords: DesaccordDestinataire[];
  /** Motif en français (abstention, ou raison pour laquelle rien n'est changé) ; null quand un destinataire est trouvé. */
  motif: string | null;
  /** Champs hors destinataire que la réanalyse lit autrement : signalés, JAMAIS appliqués. */
  autresDivergences: string[];
}

const NON_DESTINATAIRE_COMPARES = ['typeDocument', 'numero', 'dateEmission', 'dateEcheance', 'emetteurNom', 'emetteurSiren', 'emetteurSiret', 'emetteurTva', 'totalHt', 'totalTva', 'totalTtc', 'devise'] as const;

/**
 * Fusionne la lecture automatique d'une réanalyse dans les champs de l'extraction en vigueur.
 *  - seule la lecture du destinataire est reprise ; les autres champs (y compris corrigés à la main) restent tels quels ;
 *  - un champ du destinataire corrigé à la main est CONSERVÉ : la nouvelle valeur automatique est mémorisée à côté et le
 *    désaccord est signalé ;
 *  - une extraction qui porte déjà la lecture du destinataire n'est pas concernée (`inchangee`).
 */
export function fusionnerReanalyseDestinataire(anterieurs: Champs, nouveaux: ChampsFacture, ctx: { versionNouvelle: number; versionAnalyseur: string }): ResultatFusionReanalyse {
  const avant = destinataireEffectif(anterieurs);
  const automatique: ValeursDestinataire = destinataireEffectif(nouveaux as unknown as Champs);
  if (!destinataireNonLu(anterieurs)) {
    return { resultat: 'inchangee', champs: { ...anterieurs }, avant, apres: avant, automatique, desaccords: [], motif: 'La pièce porte déjà la lecture de son destinataire : rien n’est changé.', autresDivergences: [] };
  }
  const champs: Champs = { ...anterieurs };
  const desaccords: DesaccordDestinataire[] = [];
  const nouveauxChamps = nouveaux as unknown as Champs;
  for (const champ of CHAMPS_DESTINATAIRE) {
    const ancien = objet(anterieurs[champ]);
    if (estChampHumain(ancien)) {
      // Correction humaine posée avant toute lecture automatique : elle est CONSERVÉE, la lecture automatique est mémorisée à côté.
      const auto: ValeurAutomatique = { valeur: automatique[champ], versionExtraction: ctx.versionNouvelle, versionAnalyseur: ctx.versionAnalyseur };
      const desaccord = valeurDe(ancien) !== automatique[champ];
      champs[champ] = { ...ancien, automatique: auto, desaccord };
      if (desaccord) desaccords.push({ champ, humain: valeurDe(ancien), automatique: automatique[champ] });
    } else champs[champ] = nouveauxChamps[champ] ?? null;
  }
  const humainPresent = CHAMPS_DESTINATAIRE.some((c) => estChampHumain(anterieurs[c]));
  delete champs.destinataireNonLuAuto;
  champs.destinataireAbstention = humainPresent ? (anterieurs.destinataireAbstention ?? null) : (nouveaux.destinataireAbstention ?? null);
  champs.inchangeDepuis = inchangeDepuis(anterieurs, ctx.versionNouvelle - 1);
  const apres = destinataireEffectif(champs);
  const autresDivergences = NON_DESTINATAIRE_COMPARES.filter((k) => valeurDe(anterieurs[k]) !== valeurDe(nouveauxChamps[k]) && !estChampHumain(anterieurs[k]));
  const trouve = nouveaux.destinataireAbstention === null && (automatique.destinataireSiren || automatique.destinataireSiret || automatique.destinataireTva || automatique.destinataireNom);
  return {
    resultat: trouve ? 'destinataire_trouve' : 'abstention',
    champs, avant, apres, automatique, desaccords,
    motif: trouve ? null : (nouveaux.destinataireAbstention ?? 'Aucun destinataire n’a été lu de façon sûre sur la pièce.'),
    autresDivergences: [...autresDivergences],
  };
}

/**
 * Réanalyse d'une pièce dont l'extraction porte DÉJÀ une lecture du destinataire (utile après une évolution de l'analyseur) :
 * met à jour seulement la valeur automatique mémorisée à côté des champs humains et signale les désaccords.
 * Non utilisée par la réanalyse en lot (qui ne vise que les pièces sans lecture) ; exposée pour les tests et les futures évolutions.
 */
export function desaccordsAvecLectureAutomatique(champs: Champs, nouveaux: ChampsFacture): DesaccordDestinataire[] {
  const auto = destinataireEffectif(nouveaux as unknown as Champs);
  return CHAMPS_DESTINATAIRE.flatMap((champ) => (estChampHumain(champs[champ]) && valeurDe(champs[champ]) !== auto[champ] ? [{ champ, humain: valeurDe(champs[champ]), automatique: auto[champ] }] : []));
}
