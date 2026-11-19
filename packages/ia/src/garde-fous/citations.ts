/**
 * Garde-fou « citation mot pour mot » : un extrait cité par le modèle doit figurer tel quel dans le texte fourni.
 * Seules tolérances : forme Unicode (NFC), suites d'espaces et de retours à la ligne ramenées à un espace,
 * variantes typographiques de l'apostrophe. Aucune tolérance sur les mots, la casse, les chiffres ou les accents.
 */

export function normaliserPourCitation(texte: string): string {
  return texte
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[\s  ]+/g, ' ')
    .trim();
}

/** Longueur minimale d'un extrait : un mot isolé (« de ») ne prouve rien. */
export const LONGUEUR_MIN_EXTRAIT = 12;

export function extraitPresent(texte: string, extrait: string, longueurMin = LONGUEUR_MIN_EXTRAIT): boolean {
  const e = normaliserPourCitation(extrait);
  if (e.length < longueurMin) return false;
  return normaliserPourCitation(texte).includes(e);
}
