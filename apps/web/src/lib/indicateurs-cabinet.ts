/** Indicateurs d'activité du cabinet : forme de `GET v1/cabinet/indicateurs` (fonction SQL `cabinet_indicateurs`). Décomptes entiers uniquement. */
type Decomptes = Record<string, number>;
export interface IndicateursCabinet {
  periode: { du: string; au: string };
  pieces: { recues: number; parStatut: Decomptes; receptionsParCanal: Decomptes; doublonsBinaires: number; delaiTraitementMedianHeures: number | string | null };
  extractions: { parMethode: Decomptes; accepteesSansCorrection: number; corrigeesPuisValidees: number; rejetees: number; nonExaminees: number };
  imports: { parTypeEtStatut: Decomptes; lignesEcritureImportees: number };
  constats: { parStatutDeRevue: Decomptes; parGravite: Decomptes; parControle: Decomptes; aRevoir: number };
  controles: { parStatut: Decomptes };
  rapprochements: { parStatut: Decomptes };
  temps: { observeMinutesParPrestation: Decomptes; travauxSansTempsSaisi: number };
  parDossier: Array<{ entiteId: string; raisonSociale: string; pieces: number; piecesAControler: number; constatsOuverts: number; tempsObserveMinutes: number }>;
}

export const MENTIONS_INDICATEURS = ['Aucun indicateur par personne.', 'Ces chiffres mesurent l’activité enregistrée, pas la qualité des extractions.'] as const;
export const MENTION_DELAI = 'Approximation : délai entre la réception d’une pièce et sa dernière mise à jour, pour les pièces traitées reçues sur la période.';
/** Les quatre devenirs d'une extraction automatique, dans l'ordre d'affichage. */
export const DEVENIR_EXTRACTIONS = [
  { cle: 'accepteesSansCorrection', libelle: 'Acceptées sans correction' },
  { cle: 'corrigeesPuisValidees', libelle: 'Corrigées puis validées' },
  { cle: 'rejetees', libelle: 'Rejetées' },
  { cle: 'nonExaminees', libelle: 'Non examinées' },
] as const;
export const LIBELLE_METHODE_EXTRACTION: Record<string, string> = { couche_texte: 'Couche texte du PDF', ocr: 'Reconnaissance de caractères (OCR)', saisie_humaine: 'Saisie humaine', structure: 'Donnée structurée' };
export const LIBELLE_TYPE_IMPORT: Record<string, string> = { fec: 'Écritures comptables', releve_bancaire: 'Relevés bancaires' };
export const LIBELLE_STATUT_RAPPROCHEMENT: Record<string, string> = { propose: 'Proposés', valide: 'Validés', rejete: 'Rejetés' };

/** « fec:termine » → { type, statut }. */
export function decouperCleImport(cle: string): { type: string; statut: string } {
  const i = cle.indexOf(':');
  return i < 0 ? { type: cle, statut: '' } : { type: cle.slice(0, i), statut: cle.slice(i + 1) };
}
/** Médiane en heures renvoyée par la base (nombre ou chaîne décimale) → texte ; null → « Non calculable ». */
export function formaterDelaiHeures(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return 'Non calculable (aucune pièce traitée sur la période)';
  const texte = String(v);
  return /^\d+(\.\d+)?$/.test(texte) ? `${texte.replace('.', ',')} h` : texte;
}
/** Période par défaut de l'API : du premier jour du mois courant à aujourd'hui. Une date mal formée est ignorée. */
export function dateValide(v: string | undefined): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}
export const entrees = (d: Decomptes | undefined) => Object.entries(d ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
