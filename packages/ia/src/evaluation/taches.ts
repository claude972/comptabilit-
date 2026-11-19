/** Adaptation des tâches et de l'assistant au harnais d'évaluation : exécution et résumé comparable du résultat. */
import { repondreQuestion } from '../assistant/repondre.js';
import { creerFonctionsMetierTypes } from '../assistant/fonctions-types.js';
import type { ElementSource, PerimetreImpose, ResultatFonction } from '../assistant/types.js';
import { classerPiece, type EntreeClasserPiece } from '../taches/classer-piece.js';
import type { ResultatTache } from '../taches/commun.js';
import { expliquerConstat, type EntreeConstat } from '../taches/constat.js';
import { commenterIndicateurs, type EntreeIndicateurs } from '../taches/indicateurs.js';
import { analyserLettreMission, type EntreeLettreMission } from '../taches/lettre-mission.js';
import { suggererRapprochements, type EntreeRapprochements, type VerifierSuggestion } from '../taches/rapprochements.js';
import type { IssueEvaluee, ObservationCas, TacheEvaluable } from './harnais.js';

const CONTEXTE = { cabinetId: 'cabinet-evaluation', dossierId: 'dossier-evaluation', utilisateurId: 'utilisateur-evaluation' };

function issueDe(r: ResultatTache<unknown, unknown>): IssueEvaluee {
  return r.statut === 'propose' ? 'propose' : r.statut === 'abstention' ? 'abstention' : r.statut === 'rejete' ? 'rejet' : 'indisponible';
}

function observer<P>(r: ResultatTache<P, unknown>, resumer: (p: P) => { cle: unknown; ecartes: number }): ObservationCas {
  if (r.statut !== 'propose') return { issue: issueDe(r), cle: r.statut === 'rejete' ? { motifs: [...r.motifs].sort() } : null, elementsEcartes: 0 };
  const { cle, ecartes } = resumer(r.proposition);
  return { issue: 'propose', cle, elementsEcartes: ecartes };
}

export const evaluationClasserPiece: TacheEvaluable<EntreeClasserPiece> = {
  nom: 'classer_piece',
  executer: async (passerelle, entree) => observer(await classerPiece(passerelle, entree, CONTEXTE), (p) => ({ cle: { type: p.type, dossierId: p.dossierId }, ecartes: 0 })),
};

/**
 * Vérificateur arithmétique DE TEST (somme des mouvements = somme des écritures, en millionièmes entiers).
 * En production, injecter `verifierSuggestion` de `@comtaple/core`.
 */
export function creerVerificateurDeTest(entree: EntreeRapprochements): VerifierSuggestion {
  const micro = (montant: string): bigint => {
    const [entier = '0', fraction = ''] = montant.replace('-', '').split('.');
    const v = BigInt(entier) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    return montant.startsWith('-') ? -v : v;
  };
  const a = new Map(entree.mouvements.map((m) => [m.id, micro(m.montant)]));
  const b = new Map(entree.ecritures.map((m) => [m.id, micro(m.montant)]));
  return ({ cotesA, cotesB }) => {
    const conflits = [...cotesA.filter((id) => !a.has(id)), ...cotesB.filter((id) => !b.has(id))].map((id) => `identifiant inconnu (${id})`);
    const ecart = cotesA.reduce((s, id) => s + (a.get(id) ?? 0n), 0n) - cotesB.reduce((s, id) => s + (b.get(id) ?? 0n), 0n);
    const abs = (ecart < 0n ? -ecart : ecart).toString().padStart(7, '0');
    return { arithmetiqueOk: conflits.length === 0 && ecart === 0n, ecart: `${ecart < 0n ? '-' : ''}${abs.slice(0, -6)}.${abs.slice(-6, -4)}`, conflits };
  };
}

export const evaluationRapprochements: TacheEvaluable<EntreeRapprochements> = {
  nom: 'suggerer_rapprochements',
  executer: async (passerelle, entree) =>
    observer(await suggererRapprochements(passerelle, entree, creerVerificateurDeTest(entree), CONTEXTE), (p) => ({
      cle: { retenues: p.retenues.map((r) => [[...r.mouvementIds].sort(), [...r.ecritureIds].sort()]), ecartees: p.ecartees.length },
      ecartes: p.ecartees.length + p.decompte.explicationsRetirees,
    })),
};

export const evaluationLettreMission: TacheEvaluable<EntreeLettreMission> = {
  nom: 'analyser_lettre_mission',
  executer: async (passerelle, entree) =>
    observer(await analyserLettreMission(passerelle, entree, CONTEXTE), (p) => ({ cle: { rubriques: [...new Set(p.elements.map((e) => e.rubrique))].sort(), rejetes: p.rejetes.length }, ecartes: p.rejetes.length })),
};

export const evaluationIndicateurs: TacheEvaluable<EntreeIndicateurs> = {
  nom: 'commenter_indicateurs',
  executer: async (passerelle, entree) => observer(await commenterIndicateurs(passerelle, entree, CONTEXTE), (p) => ({ cle: { cites: [...p.indicateursCites].sort() }, ecartes: 0 })),
};

export const evaluationConstat: TacheEvaluable<EntreeConstat> = {
  nom: 'expliquer_constat',
  executer: async (passerelle, entree) => observer(await expliquerConstat(passerelle, entree, CONTEXTE), (p) => ({ cle: { constatId: p.constatId }, ecartes: 0 })),
};

/** Entrée d'un cas d'assistant : la question, le périmètre et les données SYNTHÉTIQUES que renvoient les fonctions métier. */
export interface EntreeAssistantEvaluation {
  question: string;
  perimetre: PerimetreImpose;
  donnees: {
    documents: ElementSource[];
    ecritures: ElementSource[];
    balance: ElementSource[];
    indicateurs: ElementSource[];
    constats: ElementSource[];
    sourcesOfficielles: ElementSource[];
  };
  /** Habilitations refusées (noms de fonctions), pour simuler un utilisateur sans droit. */
  fonctionsInterdites?: string[];
}

/** Ports de fonctions métier adossés à des données synthétiques en mémoire (recherche = filtre par dossier). */
export function creerFonctionsSurDonnees(d: EntreeAssistantEvaluation['donnees']) {
  const duDossier = (elements: ElementSource[], dossierId: string | null): ResultatFonction => ({ elements: elements.filter((e) => e.dossierId === dossierId) });
  return creerFonctionsMetierTypes(
    {
      rechercherDocuments: async (ctx) => duDossier(d.documents, ctx.dossierId),
      rechercherEcritures: async (ctx) => duDossier(d.ecritures, ctx.dossierId),
      lireBalance: async (ctx) => duDossier(d.balance, ctx.dossierId),
      calculerIndicateur: async (ctx, args) => ({ elements: d.indicateurs.filter((e) => e.dossierId === ctx.dossierId && e.id.includes(args.indicateurId)) }),
      listerConstats: async (ctx) => duDossier(d.constats, ctx.dossierId),
      rechercherSourcesReglementaires: async () => ({ elements: d.sourcesOfficielles }),
    },
    { indicateurs: [{ id: 'marge_brute', libelle: 'Taux de marge brute', motsCles: ['marge'] }] },
  );
}

export const evaluationAssistant: TacheEvaluable<EntreeAssistantEvaluation> = {
  nom: 'assistant',
  executer: async (passerelle, entree, journal) => {
    const interdites = new Set(entree.fonctionsInterdites ?? []);
    const r = await repondreQuestion(
      { passerelle, journal, fonctions: creerFonctionsSurDonnees(entree.donnees), habilitations: { autoriser: async ({ fonction }) => !interdites.has(fonction) } },
      { question: entree.question, perimetre: entree.perimetre },
    );
    const issue: IssueEvaluee = r.mode === 'sans_ia' ? 'indisponible' : r.statut === 'repondu' ? 'propose' : r.pointsEcartes.length > 0 && r.abstentionsPartielles.length < r.pointsEcartes.length ? 'rejet' : 'abstention';
    return {
      issue,
      cle: { segments: r.segments.map((s) => s.type), ecartes: r.pointsEcartes.map((p) => p.motif), refus: r.refus.map((x) => x.code) },
      elementsEcartes: r.pointsEcartes.length + r.refus.length,
    };
  },
};
