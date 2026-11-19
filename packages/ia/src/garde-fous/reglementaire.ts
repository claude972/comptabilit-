/**
 * Repérage des affirmations réglementaires. Sert deux règles :
 * - assistant : une affirmation réglementaire exige une citation de type « source officielle », sinon abstention sur ce point ;
 * - explication d'un constat : aucune référence de texte qui ne figure pas dans les faits fournis.
 *
 * Repérage par motifs, volontairement LARGE (faux positifs acceptés : ils conduisent à exiger une source).
 * Une affirmation réglementaire formulée sans aucun de ces marqueurs n'est pas détectée (limite documentée) ;
 * le modèle doit en outre la déclarer lui-même (`reglementaire: true`).
 */
const MOTIFS: RegExp[] = [
  /\barticles?\s+(?:[LRDA]\.?\s*)?\d[\w.\-]*(?:\s+(?:bis|ter|quater|[A-Z]))?/giu,
  /\b(?:CGI|LPF|BOFiP|BOI-[A-Z0-9-]+|PCG|URSSAF)\b/gu,
  /\bcode\s+(?:général\s+des\s+impôts|de\s+commerce|civil|du\s+travail|monétaire\s+et\s+financier|de\s+la\s+sécurité\s+sociale)/giu,
  /\b(?:plan\s+comptable\s+général|règlement\s+(?:de\s+l['’])?ANC|livre\s+des\s+procédures\s+fiscales|bulletin\s+officiel)/giu,
  /\b(?:loi|décret|ordonnance|arrêté|directive|règlement)\s+(?:n°|no\b|du\s+\d|de\s+finances|\(UE\)|européen)/giu,
  /\b(?:jurisprudence|Conseil\s+d['’]État|Cour\s+de\s+cassation|doctrine\s+administrative|administration\s+fiscale)/giu,
  /\b(?:la\s+loi|légalement|obligation\s+légale|obligation\s+fiscale|obligation\s+déclarative|la\s+réglementation|réglementairement|délai\s+légal|taux\s+légal|seuil\s+légal)\b/giu,
];

/** Marqueurs réglementaires trouvés dans le texte (dédoublonnés, dans l'ordre d'apparition). */
export function detecterReferencesReglementaires(texte: string): string[] {
  const trouves: Array<{ index: number; valeur: string }> = [];
  for (const motif of MOTIFS) for (const m of texte.matchAll(motif)) trouves.push({ index: m.index, valeur: m[0].replace(/\s+/g, ' ').trim() });
  trouves.sort((a, b) => a.index - b.index);
  return [...new Set(trouves.map((t) => t.valeur))];
}

export function estAffirmationReglementaire(texte: string): boolean {
  return detecterReferencesReglementaires(texte).length > 0;
}
