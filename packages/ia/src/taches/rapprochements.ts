/**
 * Tâche `suggererRapprochements` : le modèle propose des appariements entre mouvements bancaires et écritures
 * NON rapprochés ; le MOTEUR vérifie chaque suggestion (fonction injectée, ex. `verifierSuggestion` de
 * `@comtaple/core`). Une suggestion qui ne tombe pas juste est écartée et comptée. Le modèle ne calcule rien
 * et rien n'est rapproché par ce code : les suggestions retenues restent à valider par un humain.
 */
import { z } from 'zod';
import type { ContexteAppel } from '../audit.js';
import type { MessageIa } from '../fournisseur.js';
import { delimiterDonnees } from '../garde-fous/contenu.js';
import { nombresAutorises, verifierNombres } from '../garde-fous/nombres.js';
import type { PasserelleIa, ReferencePrompt } from '../passerelle.js';
import { executerTache, REGLES_SYSTEME, schemaContexteAppel, schemaIndice, type ResultatTache } from './commun.js';

export const PROMPT_RAPPROCHEMENTS: ReferencePrompt = { id: 'suggerer-rapprochements', version: '1.0.0' };

const schemaElement = z.strictObject({
  id: z.string().min(1).max(100),
  /** AAAA-MM-JJ. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Chaîne décimale signée (convention du moteur de rapprochement). */
  montant: z.string().regex(/^-?\d{1,13}(\.\d{1,6})?$/),
  /** NON FIABLE. */
  libelle: z.string().max(500),
  reference: z.string().max(200).nullable(),
  tiers: z.string().max(200).nullable(),
});
export type ElementARapprocher = z.infer<typeof schemaElement>;

export const schemaEntreeRapprochements = z.strictObject({
  mouvements: z.array(schemaElement).min(1).max(150),
  ecritures: z.array(schemaElement).min(1).max(150),
  nomsPersonnes: z.array(z.string()).max(500).optional(),
});
export type EntreeRapprochements = z.input<typeof schemaEntreeRapprochements>;

export const schemaSortieRapprochements = z.strictObject({
  suggestions: z
    .array(
      z.strictObject({
        mouvementIds: z.array(z.string().max(100)).max(12),
        ecritureIds: z.array(z.string().max(100)).max(12),
        explication: z.string().max(600),
        indice: schemaIndice,
      }),
    )
    .max(60),
});
export type SortieRapprochements = z.infer<typeof schemaSortieRapprochements>;

/** Constat du moteur sur une suggestion. Compatible avec le retour de `verifierSuggestion` de `@comtaple/core`. */
export interface VerificationMoteur {
  arithmetiqueOk: boolean;
  ecart: string;
  conflits: string[];
}

/** Port : vérification arithmétique par le moteur déterministe. `cotesA` = mouvements, `cotesB` = écritures. */
export type VerifierSuggestion = (suggestion: { cotesA: string[]; cotesB: string[] }) => VerificationMoteur;

export interface SuggestionRetenue {
  mouvementIds: string[];
  ecritureIds: string[];
  /** `null` si l'explication du modèle contenait un chiffre absent des éléments cités (passage retiré et signalé). */
  explication: string | null;
  verification: VerificationMoteur;
  indiceModele: number | null;
}

export type MotifEcart = 'identifiant_inconnu' | 'suggestion_vide' | 'arithmetique_fausse' | 'conflit_moteur' | 'element_deja_propose';

export interface PropositionRapprochements {
  /** Suggestions vérifiées par le moteur, À VALIDER par un humain. */
  retenues: SuggestionRetenue[];
  ecartees: Array<{ mouvementIds: string[]; ecritureIds: string[]; motif: MotifEcart; ecart: string | null }>;
  decompte: { proposees: number; retenues: number; ecartees: number; explicationsRetirees: number };
}

function ligne(e: ElementARapprocher): string {
  return JSON.stringify({ id: e.id, date: e.date, montant: e.montant, reference: e.reference, tiers: e.tiers, libelle: e.libelle });
}

export function construirePromptRapprochements(entree: z.output<typeof schemaEntreeRapprochements>): MessageIa[] {
  return [
    {
      role: 'system',
      contenu: [
        REGLES_SYSTEME,
        '',
        'Tâche : suggérer des appariements entre mouvements bancaires et écritures comptables non rapprochés.',
        '- Chaque suggestion associe un ou plusieurs « mouvementIds » à une ou plusieurs « ecritureIds », pris dans les listes fournies.',
        '- Ne propose une suggestion que si les montants te semblent correspondre ; tu ne fais aucun calcul dans l’explication : le moteur vérifiera l’égalité.',
        '- « explication » : pourquoi ces éléments vont ensemble (référence, tiers, date), sans autre chiffre que ceux des éléments cités.',
        '- Un élément ne figure que dans une suggestion. Si rien ne correspond, renvoie une liste vide.',
      ].join('\n'),
    },
    {
      role: 'user',
      contenu: [
        delimiterDonnees('mouvements_bancaires', entree.mouvements.map(ligne).join('\n'), { tailleMax: 60_000 }),
        delimiterDonnees('ecritures', entree.ecritures.map(ligne).join('\n'), { tailleMax: 60_000 }),
      ].join('\n\n'),
    },
  ];
}

export async function suggererRapprochements(
  passerelle: PasserelleIa,
  entree: EntreeRapprochements,
  verifier: VerifierSuggestion,
  contexte: ContexteAppel,
): Promise<ResultatTache<PropositionRapprochements>> {
  const e = schemaEntreeRapprochements.parse(entree);
  const ctx = schemaContexteAppel.parse(contexte);
  const mouvements = new Map(e.mouvements.map((m) => [m.id, m]));
  const ecritures = new Map(e.ecritures.map((m) => [m.id, m]));
  return executerTache<SortieRapprochements, PropositionRapprochements>(passerelle, {
    tache: 'suggerer_rapprochements',
    prompt: PROMPT_RAPPROCHEMENTS,
    contexte: ctx,
    messages: construirePromptRapprochements(e),
    schemaSortie: schemaSortieRapprochements,
    nomsPersonnes: e.nomsPersonnes,
    verifier: (s) => {
      if (s.suggestions.length === 0) return { resultat: 'abstention', code: 'aucune_suggestion', motif: 'Le modèle ne propose aucun appariement.' };
      const proposition: PropositionRapprochements = { retenues: [], ecartees: [], decompte: { proposees: s.suggestions.length, retenues: 0, ecartees: 0, explicationsRetirees: 0 } };
      const pris = new Set<string>();
      for (const sug of s.suggestions) {
        const ids = { mouvementIds: sug.mouvementIds, ecritureIds: sug.ecritureIds };
        const ecarter = (motif: MotifEcart, ecart: string | null = null): void => void proposition.ecartees.push({ ...ids, motif, ecart });
        if (sug.mouvementIds.length + sug.ecritureIds.length === 0) {
          ecarter('suggestion_vide');
          continue;
        }
        if (sug.mouvementIds.some((id) => !mouvements.has(id)) || sug.ecritureIds.some((id) => !ecritures.has(id))) {
          ecarter('identifiant_inconnu');
          continue;
        }
        const cles = [...sug.mouvementIds.map((id) => `M\u0000${id}`), ...sug.ecritureIds.map((id) => `E\u0000${id}`)];
        if (new Set(cles).size !== cles.length || cles.some((c) => pris.has(c))) {
          ecarter('element_deja_propose');
          continue;
        }
        // Le moteur déterministe calcule ; le modèle ne fait que proposer.
        const verification = verifier({ cotesA: [...sug.mouvementIds], cotesB: [...sug.ecritureIds] });
        if (verification.conflits.length > 0) {
          ecarter('conflit_moteur', verification.ecart);
          continue;
        }
        if (!verification.arithmetiqueOk) {
          ecarter('arithmetique_fausse', verification.ecart);
          continue;
        }
        for (const c of cles) pris.add(c);
        const cites = [...sug.mouvementIds.map((id) => mouvements.get(id)), ...sug.ecritureIds.map((id) => ecritures.get(id))];
        const faits = nombresAutorises(...cites.flatMap((c) => (c ? [c.id, c.date, c.montant, c.reference, c.tiers, c.libelle] : [])));
        const explicationSure = verifierNombres(sug.explication, faits).conforme;
        if (!explicationSure) proposition.decompte.explicationsRetirees += 1;
        proposition.retenues.push({ ...ids, explication: explicationSure ? sug.explication : null, verification, indiceModele: sug.indice });
      }
      proposition.decompte.retenues = proposition.retenues.length;
      proposition.decompte.ecartees = proposition.ecartees.length;
      if (proposition.retenues.length === 0) return { resultat: 'rejet', codes: [...new Set(proposition.ecartees.map((x) => x.motif))] };
      const avertissements: string[] = [];
      if (proposition.ecartees.length > 0) avertissements.push(`${proposition.ecartees.length} suggestion(s) écartée(s) après vérification par le moteur.`);
      if (proposition.decompte.explicationsRetirees > 0) avertissements.push(`${proposition.decompte.explicationsRetirees} explication(s) retirée(s) : chiffre absent des éléments cités.`);
      return { resultat: 'ok', proposition, avertissements };
    },
    // Le rapprochement déterministe (niveaux exact et règles) est fait par le moteur, en amont et sans IA.
    repli: () => null,
  });
}
