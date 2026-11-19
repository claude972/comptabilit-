import { CAP_001 } from './capitaux.js';
import { GEN_001, GEN_002, GEN_003, GEN_004, GEN_005 } from './general.js';
import { TIE_001, TIE_002, TIE_003 } from './tiers.js';
import { TRE_001, TRE_002 } from './tresorerie.js';
import { TVA_001 } from './tva.js';
import type { ContexteControle, DefinitionControle, ResultatControle } from './types.js';

export const CATALOGUE_CONTROLES: readonly DefinitionControle[] = Object.freeze([
  GEN_001, GEN_002, GEN_003, GEN_004, GEN_005, TRE_001, TRE_002, TIE_001, TIE_002, TIE_003, CAP_001, TVA_001,
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
