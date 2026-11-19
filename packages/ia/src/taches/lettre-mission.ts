/**
 * Tâche `analyserLettreMission` : extrait d'une lettre de mission ou d'un avenant les éléments utiles au suivi
 * de la mission. Chaque élément porte l'extrait EXACT du texte qui le fonde ; un élément dont l'extrait ne se
 * retrouve pas mot pour mot dans le texte fourni est rejeté. Le résultat est un PROJET à valider : rien n'est
 * enregistré comme périmètre de mission sans validation humaine.
 */
import { z } from 'zod';
import type { ContexteAppel } from '../audit.js';
import type { MessageIa } from '../fournisseur.js';
import { extraitPresent } from '../garde-fous/citations.js';
import { delimiterDonnees } from '../garde-fous/contenu.js';
import { nombresAutorises, verifierNombres } from '../garde-fous/nombres.js';
import type { PasserelleIa, ReferencePrompt } from '../passerelle.js';
import { executerTache, REGLES_SYSTEME, schemaContexteAppel, schemaIndice, type ResultatTache } from './commun.js';

export const PROMPT_LETTRE_MISSION: ReferencePrompt = { id: 'analyser-lettre-mission', version: '1.0.0' };
export const TAILLE_MAX_LETTRE = 40_000;

export const RUBRIQUES_LETTRE = [
  'perimetre',
  'duree',
  'honoraires',
  'obligations_cabinet',
  'obligations_client',
  'livrables',
  'mandats',
  'limites',
  'conditions_revision',
] as const;
export type RubriqueLettre = (typeof RUBRIQUES_LETTRE)[number];

export const schemaEntreeLettreMission = z.strictObject({
  /** Texte de la lettre ou de l'avenant (NON FIABLE). Refusé au-delà de 40 000 caractères : pas de troncature silencieuse d'un contrat. */
  texte: z.string().min(1).max(TAILLE_MAX_LETTRE),
  nature: z.enum(['lettre_mission', 'avenant']),
  nomsPersonnes: z.array(z.string()).max(500).optional(),
});
export type EntreeLettreMission = z.input<typeof schemaEntreeLettreMission>;

export const schemaSortieLettreMission = z.strictObject({
  elements: z
    .array(
      z.strictObject({
        rubrique: z.enum(RUBRIQUES_LETTRE),
        /** Reformulation courte de ce que prévoit le texte. */
        contenu: z.string().min(1).max(800),
        /** Extrait recopié mot pour mot du texte. */
        extrait: z.string().min(1).max(1200),
      }),
    )
    .max(80),
  indice: schemaIndice,
});
export type SortieLettreMission = z.infer<typeof schemaSortieLettreMission>;

export interface ElementLettre {
  rubrique: RubriqueLettre;
  contenu: string;
  /** Extrait vérifié mot pour mot dans le texte fourni. */
  extrait: string;
}

export interface ProjetAnalyseLettre {
  /** Toujours un projet : à relire et valider par le cabinet. */
  statut: 'projet_a_valider';
  nature: 'lettre_mission' | 'avenant';
  elements: ElementLettre[];
  /** Éléments écartés par les garde-fous (le contenu écarté n'est pas repris). */
  rejetes: Array<{ rubrique: RubriqueLettre; motif: 'extrait_introuvable' | 'chiffre_absent_de_l_extrait' }>;
  /** Rubriques pour lesquelles aucun élément vérifié n'a été trouvé : à compléter à la main. */
  rubriquesNonTrouvees: RubriqueLettre[];
}

export function construirePromptLettreMission(entree: z.output<typeof schemaEntreeLettreMission>): MessageIa[] {
  return [
    {
      role: 'system',
      contenu: [
        REGLES_SYSTEME,
        '',
        `Tâche : extraire les éléments d’${entree.nature === 'avenant' ? 'un avenant à une lettre de mission' : 'une lettre de mission'} d’expertise comptable.`,
        `Rubriques : ${RUBRIQUES_LETTRE.join(', ')}.`,
        '(perimetre : prestations confiées ; duree : date d’effet, durée, reconduction ; honoraires : mode et montants ; obligations_cabinet ; obligations_client ; livrables ; mandats : mandats donnés au cabinet ; limites : ce qui est exclu ou limité ; conditions_revision : révision des honoraires ou de la mission.)',
        '- Pour chaque élément : « rubrique », « contenu » (reformulation courte et fidèle), « extrait » (passage recopié MOT POUR MOT du texte, sans coupure ni correction).',
        '- Tout chiffre du « contenu » doit figurer dans son « extrait ».',
        '- Ne renseigne pas une rubrique absente du texte. N’interprète pas, ne complète pas.',
      ].join('\n'),
    },
    { role: 'user', contenu: delimiterDonnees('texte_lettre', entree.texte, { tailleMax: TAILLE_MAX_LETTRE }) },
  ];
}

export async function analyserLettreMission(
  passerelle: PasserelleIa,
  entree: EntreeLettreMission,
  contexte: ContexteAppel,
): Promise<ResultatTache<ProjetAnalyseLettre>> {
  const e = schemaEntreeLettreMission.parse(entree);
  const ctx = schemaContexteAppel.parse(contexte);
  return executerTache<SortieLettreMission, ProjetAnalyseLettre>(passerelle, {
    tache: 'analyser_lettre_mission',
    prompt: PROMPT_LETTRE_MISSION,
    contexte: ctx,
    messages: construirePromptLettreMission(e),
    schemaSortie: schemaSortieLettreMission,
    nomsPersonnes: e.nomsPersonnes,
    verifier: (s) => {
      if (s.elements.length === 0) return { resultat: 'abstention', code: 'aucun_element', motif: 'Le modèle n’a extrait aucun élément du texte.' };
      const projet: ProjetAnalyseLettre = { statut: 'projet_a_valider', nature: e.nature, elements: [], rejetes: [], rubriquesNonTrouvees: [] };
      for (const el of s.elements) {
        if (!extraitPresent(e.texte, el.extrait)) projet.rejetes.push({ rubrique: el.rubrique, motif: 'extrait_introuvable' });
        else if (!verifierNombres(el.contenu, nombresAutorises(el.extrait)).conforme) projet.rejetes.push({ rubrique: el.rubrique, motif: 'chiffre_absent_de_l_extrait' });
        else projet.elements.push({ rubrique: el.rubrique, contenu: el.contenu, extrait: el.extrait });
      }
      if (projet.elements.length === 0) return { resultat: 'rejet', codes: [...new Set(projet.rejetes.map((r) => r.motif))] };
      const trouvees = new Set(projet.elements.map((x) => x.rubrique));
      projet.rubriquesNonTrouvees = RUBRIQUES_LETTRE.filter((r) => !trouvees.has(r));
      const avertissements = ['Projet à valider : aucun élément n’est enregistré sans relecture.'];
      if (projet.rejetes.length > 0) avertissements.push(`${projet.rejetes.length} élément(s) écarté(s) : extrait introuvable dans le texte ou chiffre non fondé.`);
      return { resultat: 'ok', proposition: projet, indice: s.indice, avertissements };
    },
    // Aucune extraction déterministe d'un contrat en texte libre : saisie manuelle.
    repli: () => null,
  });
}
