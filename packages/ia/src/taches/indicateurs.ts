/**
 * Tâche `commenterIndicateurs` : rédige un commentaire à partir d'indicateurs CALCULÉS PAR LE MOTEUR.
 * Le modèle ne calcule rien : tout chiffre du commentaire doit figurer dans les entrées (valeur, formule,
 * période, exercice précédent), sinon le commentaire est rejeté.
 */
import { z } from 'zod';
import type { ContexteAppel } from '../audit.js';
import type { MessageIa } from '../fournisseur.js';
import { extraireUrls } from '../garde-fous/contenu.js';
import { nombresAutorises, verifierNombres } from '../garde-fous/nombres.js';
import { detecterReferencesReglementaires } from '../garde-fous/reglementaire.js';
import type { PasserelleIa, ReferencePrompt } from '../passerelle.js';
import { executerTache, REGLES_SYSTEME, schemaContexteAppel, schemaIndice, type ResultatTache } from './commun.js';

export const PROMPT_INDICATEURS: ReferencePrompt = { id: 'commenter-indicateurs', version: '1.0.0' };

const decimale = z.string().regex(/^-?\d{1,13}(\.\d{1,6})?$/);

/** Sous-ensemble de `ValeurIndicateur` / `DefinitionIndicateur` de `@comtaple/core`. */
const schemaIndicateur = z.strictObject({
  id: z.string().min(1).max(100),
  libelle: z.string().min(1).max(300),
  statut: z.enum(['calcule', 'non_calculable']),
  /** `null` quand l'indicateur n'est pas calculable (jamais zéro par défaut). */
  valeur: decimale.nullable(),
  unite: z.enum(['euros', 'jours', 'pourcentage', 'ratio']),
  formule: z.string().max(1000),
  periode: z.strictObject({ debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  motif: z.string().max(500).nullable(),
  precedent: z.strictObject({ valeur: decimale.nullable(), variation: decimale.nullable(), variationPourcent: decimale.nullable() }).nullable(),
  mentions: z.array(z.string().max(500)).max(20),
});
export type IndicateurACommenter = z.infer<typeof schemaIndicateur>;

export const schemaEntreeIndicateurs = z.strictObject({
  indicateurs: z.array(schemaIndicateur).min(1).max(40),
  nomsPersonnes: z.array(z.string()).max(500).optional(),
});
export type EntreeIndicateurs = z.input<typeof schemaEntreeIndicateurs>;

export const schemaSortieIndicateurs = z.strictObject({
  /** Vide si le modèle s'abstient. */
  commentaire: z.string().max(3000),
  /** Identifiants des indicateurs sur lesquels s'appuie le commentaire. */
  indicateursCites: z.array(z.string().max(100)).max(40),
  abstention: z.boolean(),
  indice: schemaIndice,
});
export type SortieIndicateurs = z.infer<typeof schemaSortieIndicateurs>;

export interface CommentaireIndicateurs {
  /** PROJET de commentaire, à relire. */
  commentaire: string;
  /** Preuves : indicateurs du moteur sur lesquels s'appuie le texte. */
  indicateursCites: string[];
}

const UNITES: Record<IndicateurACommenter['unite'], string> = { euros: '€', jours: 'jours', pourcentage: '%', ratio: '' };

function faitsIndicateur(i: IndicateurACommenter): string[] {
  return [i.id, i.libelle, i.valeur ?? '', i.formule, i.periode.debut, i.periode.fin, i.motif ?? '', i.precedent?.valeur ?? '', i.precedent?.variation ?? '', i.precedent?.variationPourcent ?? '', ...i.mentions];
}

export function construirePromptIndicateurs(entree: z.output<typeof schemaEntreeIndicateurs>): MessageIa[] {
  return [
    {
      role: 'system',
      contenu: [
        REGLES_SYSTEME,
        '',
        'Tâche : rédiger un commentaire de gestion à partir d’indicateurs déjà calculés.',
        '- N’utilise que les valeurs fournies, recopiées à l’identique (mêmes décimales). Aucun arrondi, aucune somme, aucun écart recalculé, aucun pourcentage déduit.',
        '- Un indicateur « non_calculable » se commente par son motif, jamais par une valeur.',
        '- Aucune affirmation juridique ou fiscale, aucun conseil, aucun diagnostic : décris ce que montrent les indicateurs.',
        '- « indicateursCites » : identifiants des indicateurs utilisés. « abstention » : true si les données ne permettent aucun commentaire.',
      ].join('\n'),
    },
    {
      role: 'user',
      contenu: `Indicateurs calculés par le moteur (un par ligne, JSON) :\n${entree.indicateurs
        .map((i) => JSON.stringify({ id: i.id, libelle: i.libelle, statut: i.statut, valeur: i.valeur, unite: i.unite, formule: i.formule, periode: i.periode, motif: i.motif, precedent: i.precedent, mentions: i.mentions }))
        .join('\n')}`,
    },
  ];
}

/** Repli sans IA : restitution par gabarit, sans aucune rédaction. */
export function restituerIndicateursSansIa(entree: EntreeIndicateurs): string {
  const e = schemaEntreeIndicateurs.parse(entree);
  return e.indicateurs
    .map((i) => {
      const periode = `du ${i.periode.debut} au ${i.periode.fin}`;
      if (i.statut === 'non_calculable' || i.valeur === null) return `${i.libelle} (${periode}) : non calculable${i.motif ? ` — ${i.motif.replace(/\.$/, '')}` : ''}.`;
      const precedent = i.precedent?.valeur != null ? ` ; exercice précédent : ${i.precedent.valeur} ${UNITES[i.unite]}`.trimEnd() : '';
      return `${i.libelle} (${periode}) : ${`${i.valeur} ${UNITES[i.unite]}`.trimEnd()}${precedent}. Formule : ${i.formule}`;
    })
    .join('\n');
}

export async function commenterIndicateurs(
  passerelle: PasserelleIa,
  entree: EntreeIndicateurs,
  contexte: ContexteAppel,
): Promise<ResultatTache<CommentaireIndicateurs, string>> {
  const e = schemaEntreeIndicateurs.parse(entree);
  const ctx = schemaContexteAppel.parse(contexte);
  const parId = new Map(e.indicateurs.map((i) => [i.id, i]));
  return executerTache<SortieIndicateurs, CommentaireIndicateurs, string>(passerelle, {
    tache: 'commenter_indicateurs',
    prompt: PROMPT_INDICATEURS,
    contexte: ctx,
    messages: construirePromptIndicateurs(e),
    schemaSortie: schemaSortieIndicateurs,
    nomsPersonnes: e.nomsPersonnes,
    verifier: (s) => {
      if (s.abstention || s.commentaire.trim() === '') return { resultat: 'abstention', code: 'abstention_modele', motif: 'Le modèle s’abstient de commenter ces indicateurs.' };
      const codes: string[] = [];
      if (s.indicateursCites.length === 0) codes.push('aucun_indicateur_cite');
      if (s.indicateursCites.some((id) => !parId.has(id))) codes.push('indicateur_inconnu');
      // Les chiffres doivent venir des indicateurs CITÉS, pas d'un autre indicateur de la liste.
      const cites = s.indicateursCites.flatMap((id) => parId.get(id) ?? []);
      if (!verifierNombres(s.commentaire, nombresAutorises(...cites.flatMap(faitsIndicateur))).conforme) codes.push('chiffre_absent_des_indicateurs');
      if (detecterReferencesReglementaires(s.commentaire).length > 0) codes.push('affirmation_reglementaire');
      if (extraireUrls(s.commentaire).length > 0) codes.push('url_non_sourcee');
      if (codes.length > 0) return { resultat: 'rejet', codes };
      return { resultat: 'ok', proposition: { commentaire: s.commentaire.trim(), indicateursCites: [...new Set(s.indicateursCites)] }, indice: s.indice, avertissements: ['Projet de commentaire à relire.'] };
    },
    repli: () => ({ origine: 'repli_deterministe', etiquette: 'Sans IA : restitution des indicateurs du moteur par gabarit, sans rédaction.', resultat: restituerIndicateursSansIa(e) }),
  });
}
