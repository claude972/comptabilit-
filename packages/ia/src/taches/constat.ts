/**
 * Tâche `expliquerConstat` : reformule en langage courant un constat de contrôle produit par le moteur, SANS RIEN
 * AJOUTER aux faits : aucun chiffre, aucune référence de texte, aucune URL qui ne figure dans le constat fourni.
 */
import { z } from 'zod';
import type { ContexteAppel } from '../audit.js';
import type { MessageIa } from '../fournisseur.js';
import { normaliserPourCitation } from '../garde-fous/citations.js';
import { delimiterDonnees, extraireUrls } from '../garde-fous/contenu.js';
import { nombresAutorises, verifierNombres } from '../garde-fous/nombres.js';
import { detecterReferencesReglementaires } from '../garde-fous/reglementaire.js';
import type { PasserelleIa, ReferencePrompt } from '../passerelle.js';
import { executerTache, REGLES_SYSTEME, schemaContexteAppel, type ResultatTache } from './commun.js';

export const PROMPT_CONSTAT: ReferencePrompt = { id: 'expliquer-constat', version: '1.0.0' };

export const schemaEntreeConstat = z.strictObject({
  constat: z.strictObject({
    id: z.string().min(1).max(100),
    /** Identifiant et libellé du contrôle du moteur. */
    controle: z.string().min(1).max(300),
    gravite: z.string().max(60),
    /** Message produit par le moteur. */
    message: z.string().min(1).max(2000),
    /** Faits établis par le moteur (libellé → valeur). Les libellés d'écritures qu'ils contiennent sont NON FIABLES. */
    faits: z.array(z.strictObject({ libelle: z.string().max(200), valeur: z.string().max(1000) })).max(60),
    /** Règle appliquée et sa source, telles que le moteur les fournit. */
    regle: z.string().max(1000).nullable(),
  }),
  nomsPersonnes: z.array(z.string()).max(500).optional(),
});
export type EntreeConstat = z.input<typeof schemaEntreeConstat>;

export const schemaSortieConstat = z.strictObject({
  explication: z.string().max(2000),
  abstention: z.boolean(),
});
export type SortieConstat = z.infer<typeof schemaSortieConstat>;

export interface ExplicationConstat {
  constatId: string;
  /** PROJET d'explication : reformulation du constat, sans fait nouveau. */
  explication: string;
}

export function construirePromptConstat(entree: z.output<typeof schemaEntreeConstat>): MessageIa[] {
  const c = entree.constat;
  return [
    {
      role: 'system',
      contenu: [
        REGLES_SYSTEME,
        '',
        'Tâche : expliquer en langage courant, à un collaborateur de cabinet, un constat de contrôle comptable.',
        '- Explique ce que le contrôle a relevé et pourquoi cela mérite examen, uniquement à partir du constat fourni.',
        '- N’ajoute aucun fait, aucune cause supposée, aucun chiffre, aucune référence de texte, aucun lien qui ne figure pas dans le constat.',
        '- Ne conclus pas à une erreur ou à une fraude : le constat est un point à examiner.',
        '- « abstention » : true si le constat ne permet pas d’explication fidèle.',
      ].join('\n'),
    },
    {
      role: 'user',
      contenu: [
        `Constat ${c.id} — contrôle : ${c.controle} — gravité : ${c.gravite}`,
        `Règle appliquée par le moteur : ${c.regle ?? '(non précisée)'}`,
        delimiterDonnees('message_constat', c.message, { tailleMax: 2000 }),
        delimiterDonnees('faits_constat', c.faits.map((f) => `${f.libelle} : ${f.valeur}`).join('\n'), { tailleMax: 20_000 }),
      ].join('\n\n'),
    },
  ];
}

export async function expliquerConstat(
  passerelle: PasserelleIa,
  entree: EntreeConstat,
  contexte: ContexteAppel,
): Promise<ResultatTache<ExplicationConstat, ExplicationConstat>> {
  const e = schemaEntreeConstat.parse(entree);
  const ctx = schemaContexteAppel.parse(contexte);
  const c = e.constat;
  const faits = [c.id, c.controle, c.gravite, c.message, c.regle ?? '', ...c.faits.flatMap((f) => [f.libelle, f.valeur])];
  const texteFaits = normaliserPourCitation(faits.join('\n')).toLocaleLowerCase('fr');
  return executerTache<SortieConstat, ExplicationConstat, ExplicationConstat>(passerelle, {
    tache: 'expliquer_constat',
    prompt: PROMPT_CONSTAT,
    contexte: ctx,
    messages: construirePromptConstat(e),
    schemaSortie: schemaSortieConstat,
    nomsPersonnes: e.nomsPersonnes,
    verifier: (s) => {
      if (s.abstention || s.explication.trim() === '') return { resultat: 'abstention', code: 'abstention_modele', motif: 'Le modèle s’abstient d’expliquer ce constat.' };
      const codes: string[] = [];
      if (!verifierNombres(s.explication, nombresAutorises(...faits)).conforme) codes.push('chiffre_absent_du_constat');
      // Une référence de texte n'est admise que si elle figure telle quelle dans le constat fourni.
      const references = detecterReferencesReglementaires(s.explication);
      if (references.some((r) => !texteFaits.includes(normaliserPourCitation(r).toLocaleLowerCase('fr')))) codes.push('reference_absente_du_constat');
      if (extraireUrls(s.explication).some((u) => !texteFaits.includes(u.toLocaleLowerCase('fr')))) codes.push('url_non_sourcee');
      if (codes.length > 0) return { resultat: 'rejet', codes };
      return { resultat: 'ok', proposition: { constatId: c.id, explication: s.explication.trim() }, avertissements: ['Projet d’explication à relire : reformulation du constat du moteur.'] };
    },
    repli: () => ({ origine: 'repli_deterministe', etiquette: 'Sans IA : message du constat tel que produit par le moteur, sans reformulation.', resultat: { constatId: c.id, explication: c.message } }),
  });
}
