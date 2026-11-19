import { CAP_001 } from './capitaux.js';
import { CLO_001, CLO_002 } from './cloture.js';
import { IMM_001, IMM_002 } from './immobilisations.js';
import { TRE_003 } from './rapprochement-bancaire.js';
import { SOC_001 } from './social.js';
import { GEN_001, GEN_002, GEN_003, GEN_004, GEN_005 } from './general.js';
import { TIE_001, TIE_002, TIE_003 } from './tiers.js';
import { TRE_001, TRE_002 } from './tresorerie.js';
import { TVA_001, TVA_002 } from './tva.js';
import type { ContexteControle, ContexteControleFlux, DefinitionControle, ResultatControle } from './types.js';

export const CATALOGUE_CONTROLES: readonly DefinitionControle[] = Object.freeze([
  GEN_001, GEN_002, GEN_003, GEN_004, GEN_005, TRE_001, TRE_002, TIE_001, TIE_002, TIE_003, CAP_001, TVA_001,
  // Lot 2.
  TRE_003, IMM_001, IMM_002, SOC_001, CLO_001, CLO_002, TVA_002,
]);

function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 2000);
  return String(e).slice(0, 2000);
}

/**
 * Exécute les contrôles du catalogue (ou la sélection `ids`). Ne lève jamais :
 * une exception dans un contrôle, un paramètre invalide ou un identifiant inconnu
 * donnent un résultat de statut `erreur`.
 */
export function executerControles(
  ctx: Omit<ContexteControle, 'parametres'>,
  options?: { ids?: string[]; parametres?: Record<string, Record<string, unknown>> },
): ResultatControle[] {
  const resultats: ResultatControle[] = [];
  let definitions: Array<DefinitionControle | string>;
  try {
    const ids = options?.ids;
    definitions = ids === undefined ? [...CATALOGUE_CONTROLES] : ids.map((id) => CATALOGUE_CONTROLES.find((d) => d.id === id) ?? String(id));
  } catch (e) {
    return [{ controleId: '?', version: '?', statut: 'erreur', motif: `Options invalides : ${messageErreur(e)}`, constats: [], parametresAppliques: {}, mesures: {} }];
  }
  for (const def of definitions) {
    if (typeof def === 'string') {
      resultats.push({ controleId: def, version: '?', statut: 'erreur', motif: `Contrôle inconnu : ${def}.`, constats: [], parametresAppliques: {}, mesures: {} });
      continue;
    }
    let parametres: Record<string, unknown> = {};
    try {
      const surcharge = options?.parametres?.[def.id];
      parametres = surcharge !== undefined && surcharge !== null ? { ...surcharge } : {};
      resultats.push(def.executer({ ...ctx, parametres }));
    } catch (e) {
      resultats.push({
        controleId: def.id,
        version: def.version,
        statut: 'erreur',
        motif: `Erreur pendant l'exécution du contrôle : ${messageErreur(e)}`,
        constats: [],
        parametresAppliques: parametres,
        mesures: {},
      });
    }
  }
  return resultats;
}

/** Contrôles du catalogue calculables par passages en flux (égalité avec le calcul en mémoire prouvée par les tests d'équivalence). */
export const CONTROLES_EN_FLUX: readonly string[] = Object.freeze(CATALOGUE_CONTROLES.filter((d) => d.executerFlux !== undefined).map((d) => d.id));

/**
 * Exécute les contrôles par passages en flux sur une source de lignes, en mémoire bornée : même résultat que
 * `executerControles` pour les contrôles qui le permettent. Un contrôle sans calcul en flux, ou dont l'état dépasserait
 * le budget, est `non_realise` avec son motif — jamais un résultat partiel, jamais un résultat favorable par défaut.
 * Ne lève pas pour une erreur de calcul (statut `erreur`) ; une erreur de lecture de la source est propagée, l'appelant
 * ne pouvant alors rien conclure.
 */
export async function executerControlesFlux(
  ctx: Omit<ContexteControleFlux, 'parametres'>,
  options?: { ids?: string[]; parametres?: Record<string, Record<string, unknown>>; erreurDeLecture?: (e: unknown) => boolean },
): Promise<ResultatControle[]> {
  const resultats: ResultatControle[] = [];
  const ids = options?.ids;
  const definitions: Array<DefinitionControle | string> = ids === undefined ? [...CATALOGUE_CONTROLES] : ids.map((id) => CATALOGUE_CONTROLES.find((d) => d.id === id) ?? String(id));
  for (const def of definitions) {
    if (typeof def === 'string') {
      resultats.push({ controleId: def, version: '?', statut: 'erreur', motif: `Contrôle inconnu : ${def}.`, constats: [], parametresAppliques: {}, mesures: {} });
      continue;
    }
    if (def.executerFlux === undefined) {
      resultats.push({
        controleId: def.id,
        version: def.version,
        statut: 'non_realise',
        motif:
          `Contrôle ${def.id} non réalisé sur ce volume (${ctx.source.nbLignes.toLocaleString('fr-FR')} lignes d’écriture) : il ne dispose pas d’un calcul en flux dont l’égalité avec le calcul en mémoire soit prouvée. ` +
          'Ce n’est pas une absence d’anomalie.',
        constats: [],
        parametresAppliques: {},
        mesures: {},
      });
      continue;
    }
    let parametres: Record<string, unknown> = {};
    try {
      const surcharge = options?.parametres?.[def.id];
      parametres = surcharge !== undefined && surcharge !== null ? { ...surcharge } : {};
      resultats.push(await def.executerFlux({ ...ctx, parametres }));
    } catch (e) {
      if (options?.erreurDeLecture?.(e) === true) throw e;
      resultats.push({
        controleId: def.id,
        version: def.version,
        statut: 'erreur',
        motif: `Erreur pendant l'exécution du contrôle : ${messageErreur(e)}`,
        constats: [],
        parametresAppliques: parametres,
        mesures: {},
      });
    }
  }
  return resultats;
}

function cellule(v: unknown): string {
  return (typeof v === 'string' ? v : JSON.stringify(v)).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Catalogue documenté des contrôles, au format Markdown. */
export function genererCatalogueMarkdown(): string {
  const lignes: string[] = [
    '# Catalogue des contrôles de révision',
    '',
    `${CATALOGUE_CONTROLES.length} contrôles déterministes. Un contrôle sans données suffisantes rend le statut \`non_realise\` avec son motif ; jamais un résultat favorable par défaut.`,
    '',
    'Deux chemins de calcul rendent le même résultat. Jusqu’au seuil de lignes du traitement en mémoire, les lignes de l’exercice sont chargées (chemin de référence). ' +
      'Au-delà, chaque contrôle est calculé par passages successifs en flux, en mémoire bornée : « un passage groupé par écriture » lit les lignes écriture par écriture, sans jamais garder plus d’une écriture. ' +
      'L’égalité stricte des deux chemins (statut, motif, mesures, constats) est vérifiée par les tests d’équivalence du moteur ; un contrôle qui dépasserait son budget d’état est `non_realise` avec son motif, jamais partiel. ' +
      'La rubrique « Calcul sur gros volume » de chaque fiche décrit ses passages et son état.',
    '',
    '| Identifiant | Version | Cycle | Titre | Type de source |',
    '|---|---|---|---|---|',
    ...CATALOGUE_CONTROLES.map((d) => `| ${d.id} | ${d.version} | ${d.cycle} | ${cellule(d.titre)} | ${d.source.type} |`),
    '',
  ];
  for (const d of CATALOGUE_CONTROLES) {
    lignes.push(
      `## ${d.id} — ${d.titre}`,
      '',
      `- **Version** : ${d.version}`,
      `- **Cycle** : ${d.cycle}`,
      `- **Objectif** : ${d.objectif}`,
      `- **Périmètre** : ${d.perimetre}`,
      `- **Données obligatoires** : ${d.donneesObligatoires.join(', ')}`,
      `- **Logique** : ${d.logique}`,
      `- **Exceptions et limites** : ${d.exceptions}`,
      `- **Résultats attendus** : ${d.resultatsAttendus}`,
      `- **Calcul sur gros volume** : ${d.executerFlux ? d.calculGrosVolume : 'Aucun calcul en flux : au-delà du seuil du traitement en mémoire, le contrôle est non réalisé, avec son motif.'}`,
      '',
      '**Paramètres (valeurs par défaut)**',
      '',
      '| Paramètre | Défaut |',
      '|---|---|',
      ...Object.entries(d.parametresParDefaut).map(([k, v]) => `| ${k} | ${cellule(JSON.stringify(v))} |`),
      '',
      '**Source**',
      '',
      `- Type : ${d.source.type}`,
      `- Référence : ${d.source.reference}`,
      `- URL : ${d.source.url ?? '—'}`,
      `- Vérification : ${d.source.verification}${d.source.dateVerification ? ` (le ${d.source.dateVerification})` : ''}`,
      `- Période d’application : ${d.source.periodeApplication ?? '—'}`,
      '',
    );
  }
  return lignes.join('\n');
}
