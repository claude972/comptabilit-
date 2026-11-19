/**
 * Tâche `classerPiece` : propose un type de pièce (liste fermée fournie) et un dossier de rattachement parmi des
 * candidats fournis. Toute incertitude donne « à qualifier ». La proposition n'est jamais appliquée par ce code :
 * elle est présentée à un humain avec ses preuves (extraits du texte).
 */
import { z } from 'zod';
import type { ContexteAppel } from '../audit.js';
import type { MessageIa } from '../fournisseur.js';
import { delimiterDonnees } from '../garde-fous/contenu.js';
import { extraitPresent, normaliserPourCitation } from '../garde-fous/citations.js';
import type { PasserelleIa, ReferencePrompt } from '../passerelle.js';
import { executerTache, REGLES_SYSTEME, schemaContexteAppel, schemaIndice, type ResultatTache } from './commun.js';

export const PROMPT_CLASSER_PIECE: ReferencePrompt = { id: 'classer-piece', version: '1.0.0' };
export const A_QUALIFIER = 'a_qualifier';
/** Minimisation : seul le début du texte extrait est transmis. */
export const TAILLE_MAX_TEXTE_PIECE = 6000;

export const schemaEntreeClasserPiece = z.strictObject({
  /** Texte extrait de la pièce (NON FIABLE). */
  texte: z.string().min(1),
  nomFichier: z.string().max(300).nullable(),
  /** Liste FERMÉE des types possibles. */
  types: z.array(z.strictObject({ code: z.string().regex(/^[a-z0-9_]{1,60}$/), libelle: z.string().min(1).max(200) })).min(1).max(60),
  /** Dossiers candidats, choisis par l'appelant dans le cabinet courant. `indices` : chaînes propres au dossier (SIREN, raison sociale). */
  dossiers: z.array(z.strictObject({ id: z.string().min(1).max(100), libelle: z.string().min(1).max(200), indices: z.array(z.string().min(3).max(200)).max(10).default([]) })).max(50),
  nomsPersonnes: z.array(z.string()).max(500).optional(),
});
export type EntreeClasserPiece = z.input<typeof schemaEntreeClasserPiece>;

export const schemaSortieClasserPiece = z.strictObject({
  /** Code d'un type fourni, ou « a_qualifier ». */
  type: z.string().max(60),
  /** Identifiant d'un dossier candidat, ou null (à qualifier). */
  dossierId: z.string().max(100).nullable(),
  /** Extraits EXACTS du texte de la pièce qui fondent la proposition. */
  preuves: z.array(z.string().max(400)).max(6),
  justification: z.string().max(600),
  indice: schemaIndice,
});
export type SortieClasserPiece = z.infer<typeof schemaSortieClasserPiece>;

export interface PropositionClassement {
  /** Code du type proposé, ou `a_qualifier`. */
  type: string;
  /** Dossier proposé, ou `null` : à qualifier. */
  dossierId: string | null;
  /** Extraits vérifiés mot pour mot dans le texte de la pièce. */
  preuves: string[];
  justification: string;
}

export function construirePromptClasserPiece(entree: z.output<typeof schemaEntreeClasserPiece>): MessageIa[] {
  return [
    {
      role: 'system',
      contenu: [
        REGLES_SYSTEME,
        '',
        'Tâche : proposer le type d’une pièce et son dossier de rattachement.',
        `- « type » : un code de la liste des types, ou « ${A_QUALIFIER} » si tu n’es pas sûr.`,
        '- « dossierId » : l’identifiant d’un dossier candidat, ou null si aucun ne correspond clairement.',
        '- « preuves » : de 1 à 6 extraits recopiés mot pour mot du texte de la pièce, qui fondent ta proposition.',
        '- « justification » : une phrase, sans chiffre.',
        '- « indice » : ton auto-évaluation entre 0 et 1, ou null.',
      ].join('\n'),
    },
    {
      role: 'user',
      contenu: [
        `Types possibles (code : libellé) :\n${entree.types.map((t) => `- ${t.code} : ${t.libelle}`).join('\n')}`,
        `Dossiers candidats (identifiant : libellé) :\n${entree.dossiers.length === 0 ? '(aucun)' : entree.dossiers.map((d) => `- ${d.id} : ${d.libelle}${d.indices.length > 0 ? ` [${d.indices.join(' ; ')}]` : ''}`).join('\n')}`,
        delimiterDonnees('nom_fichier', entree.nomFichier ?? '(inconnu)', { tailleMax: 300 }),
        delimiterDonnees('texte_piece', entree.texte, { tailleMax: TAILLE_MAX_TEXTE_PIECE }),
      ].join('\n\n'),
    },
  ];
}

/** Repli sans IA : rattache au dossier dont un indice figure dans le texte, s'il est le SEUL dans ce cas. Ne propose aucun type. */
export function classerPieceSansIa(entree: EntreeClasserPiece): PropositionClassement {
  const e = schemaEntreeClasserPiece.parse(entree);
  const texte = normaliserPourCitation(e.texte).toLocaleLowerCase('fr');
  const trouves = e.dossiers
    .map((d) => ({ id: d.id, indices: d.indices.filter((i) => texte.includes(normaliserPourCitation(i).toLocaleLowerCase('fr'))) }))
    .filter((d) => d.indices.length > 0);
  const unique = trouves.length === 1 ? trouves[0] : undefined;
  return {
    type: A_QUALIFIER,
    dossierId: unique?.id ?? null,
    preuves: unique?.indices ?? [],
    justification: unique ? 'Un indice propre à ce dossier figure dans le texte de la pièce, et à aucun autre dossier candidat.' : 'Aucun rattachement certain : à qualifier.',
  };
}

export async function classerPiece(
  passerelle: PasserelleIa,
  entree: EntreeClasserPiece,
  contexte: ContexteAppel,
): Promise<ResultatTache<PropositionClassement, PropositionClassement>> {
  const e = schemaEntreeClasserPiece.parse(entree);
  const ctx = schemaContexteAppel.parse(contexte);
  const types = new Set(e.types.map((t) => t.code));
  const dossiers = new Set(e.dossiers.map((d) => d.id));
  const texteTransmis = e.texte.slice(0, TAILLE_MAX_TEXTE_PIECE);
  return executerTache<SortieClasserPiece, PropositionClassement, PropositionClassement>(passerelle, {
    tache: 'classer_piece',
    prompt: PROMPT_CLASSER_PIECE,
    contexte: ctx,
    messages: construirePromptClasserPiece(e),
    schemaSortie: schemaSortieClasserPiece,
    nomsPersonnes: e.nomsPersonnes,
    verifier: (s) => {
      const codes: string[] = [];
      if (s.type !== A_QUALIFIER && !types.has(s.type)) codes.push('type_hors_liste');
      if (s.dossierId !== null && !dossiers.has(s.dossierId)) codes.push('dossier_hors_candidats');
      if (codes.length > 0) return { resultat: 'rejet', codes };
      const preuves = s.preuves.filter((p) => extraitPresent(texteTransmis, p));
      const avertissements: string[] = [];
      if (preuves.length < s.preuves.length) avertissements.push(`${s.preuves.length - preuves.length} extrait(s) cité(s) par le modèle ne figurent pas dans la pièce et ont été écartés.`);
      // Chaque proposition présente ses preuves : sans extrait vérifié, la proposition est ramenée à « à qualifier ».
      if (preuves.length === 0 && (s.type !== A_QUALIFIER || s.dossierId !== null)) {
        return { resultat: 'abstention', code: 'proposition_sans_preuve', motif: 'Proposition sans extrait vérifiable dans la pièce : à qualifier.' };
      }
      if (s.type === A_QUALIFIER && s.dossierId === null) return { resultat: 'abstention', code: 'a_qualifier', motif: 'Le modèle ne se prononce pas : à qualifier.' };
      return { resultat: 'ok', proposition: { type: s.type, dossierId: s.dossierId, preuves, justification: s.justification }, indice: s.indice, avertissements };
    },
    repli: () => ({ origine: 'repli_deterministe', etiquette: 'Sans IA : rattachement par indice exact uniquement, type à qualifier.', resultat: classerPieceSansIa(e) }),
  });
}
