/**
 * Jeu de définitions types des fonctions métier de l'assistant. L'intégrateur fournit les ports (accès aux
 * données, déjà filtrés par cabinet / dossier / période à partir du `ContexteFonction`) ; ce module fournit les
 * déclarations, les schémas d'arguments et le déclenchement du mode sans IA.
 * Toutes ces fonctions sont en LECTURE SEULE : aucune ne modifie de donnée.
 */
import { z } from 'zod';
import type { ContexteFonction, FonctionMetier, ResultatFonction } from './types.js';

export interface PortsFonctionsMetier {
  /** Recherche dans les pièces du dossier (texte + vecteurs). Éléments de nature `piece`. */
  rechercherDocuments(contexte: ContexteFonction, args: { requete: string; limite: number }): Promise<ResultatFonction>;
  /** Recherche d'écritures. Éléments de nature `ecriture`, avec `valeurs` (date, compte, débit, crédit, pièce). */
  rechercherEcritures(contexte: ContexteFonction, args: { requete: string; comptePrefixe?: string | undefined; limite: number }): Promise<ResultatFonction>;
  /** Soldes de la balance calculés par le moteur. Éléments de nature `resultat_moteur`. */
  lireBalance(contexte: ContexteFonction, args: { comptePrefixe?: string | undefined }): Promise<ResultatFonction>;
  /** Indicateur calculé par le moteur (valeur, formule, période). Élément de nature `resultat_moteur`. */
  calculerIndicateur(contexte: ContexteFonction, args: { indicateurId: string }): Promise<ResultatFonction>;
  /** Constats de contrôle du moteur. Éléments de nature `constat`. */
  listerConstats(contexte: ContexteFonction, args: { gravite?: string | undefined }): Promise<ResultatFonction>;
  /** Recherche dans le fonds de textes officiels qualifiés. Éléments de nature `source_officielle`, avec `reference`. */
  rechercherSourcesReglementaires(contexte: ContexteFonction, args: { requete: string; limite: number }): Promise<ResultatFonction>;
}

export interface OptionsFonctionsTypes {
  /** Indicateurs proposés au modèle et mots-clés (sans accents, minuscules) qui les déclenchent en mode sans IA. */
  indicateurs: Array<{ id: string; libelle: string; motsCles: string[] }>;
}

/** Minuscules, sans accents : pour la comparaison par mots-clés du mode sans IA. */
export function normaliserMotsCles(texte: string): string {
  return texte.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const requete = z.string().min(2).max(300);

export function creerFonctionsMetierTypes(ports: PortsFonctionsMetier, options: OptionsFonctionsTypes): FonctionMetier[] {
  const idsIndicateurs = options.indicateurs.map((i) => i.id);
  const fonctions: FonctionMetier[] = [
    {
      nom: 'rechercherDocuments',
      description: 'Recherche des pièces du dossier (factures, relevés, contrats, courriers) par mots-clés.',
      habilitation: 'pieces.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ requete, limite: z.number().int().min(1).max(20).default(8) }),
      executer: (args, ctx) => ports.rechercherDocuments(ctx, args),
      sansIa: { motsCles: [], toujours: true, arguments: (q) => ({ requete: q.trim().slice(0, 300), limite: 8 }) },
    } satisfies FonctionMetier<{ requete: string; limite: number }> as FonctionMetier,
    {
      nom: 'rechercherEcritures',
      description: 'Recherche des écritures comptables du dossier par mots-clés, éventuellement limitées à un préfixe de compte.',
      habilitation: 'ecritures.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ requete, comptePrefixe: z.string().regex(/^\d{1,8}$/).optional(), limite: z.number().int().min(1).max(50).default(20) }),
      executer: (args, ctx) => ports.rechercherEcritures(ctx, args),
      sansIa: {
        motsCles: ['ecriture', 'ecritures', 'compte', 'journal', 'facture', 'factures', 'paiement', 'reglement', 'montant'],
        arguments: (q) => ({ requete: q.trim().slice(0, 300), limite: 20 }),
      },
    } satisfies FonctionMetier<{ requete: string; comptePrefixe?: string | undefined; limite: number }> as FonctionMetier,
    {
      nom: 'lireBalance',
      description: 'Lit les soldes de la balance calculés par le moteur, éventuellement pour un préfixe de compte.',
      habilitation: 'ecritures.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ comptePrefixe: z.string().regex(/^\d{1,8}$/).optional() }),
      executer: (args, ctx) => ports.lireBalance(ctx, args),
      sansIa: {
        motsCles: ['balance', 'solde', 'soldes'],
        arguments: (q) => {
          const compte = /\bcomptes?\s+(\d{1,8})\b/i.exec(q)?.[1];
          return compte ? { comptePrefixe: compte } : {};
        },
      },
    } satisfies FonctionMetier<{ comptePrefixe?: string | undefined }> as FonctionMetier,
    {
      nom: 'listerConstats',
      description: 'Liste les constats de contrôle établis par le moteur sur le dossier.',
      habilitation: 'controles.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ gravite: z.string().max(40).optional() }),
      executer: (args, ctx) => ports.listerConstats(ctx, args),
      sansIa: { motsCles: ['constat', 'constats', 'anomalie', 'anomalies', 'controle', 'controles', 'alerte', 'alertes'], arguments: () => ({}) },
    } satisfies FonctionMetier<{ gravite?: string | undefined }> as FonctionMetier,
    {
      nom: 'rechercherSourcesReglementaires',
      description: 'Recherche dans le fonds de textes officiels (lois, codes, doctrine administrative publiée). Obligatoire avant toute affirmation réglementaire.',
      habilitation: 'veille.lire',
      porteeDossier: false,
      schemaArguments: z.strictObject({ requete, limite: z.number().int().min(1).max(10).default(5) }),
      executer: (args, ctx) => ports.rechercherSourcesReglementaires(ctx, args),
      sansIa: {
        motsCles: ['tva', 'impot', 'impots', 'fiscal', 'fiscale', 'legal', 'legale', 'loi', 'obligation', 'obligatoire', 'delai', 'declaration', 'reglementation', 'seuil', 'taux'],
        arguments: (q) => ({ requete: q.trim().slice(0, 300), limite: 5 }),
      },
    } satisfies FonctionMetier<{ requete: string; limite: number }> as FonctionMetier,
  ];
  if (idsIndicateurs.length > 0) {
    fonctions.push({
      nom: 'calculerIndicateur',
      description: `Fait calculer un indicateur par le moteur. Indicateurs : ${options.indicateurs.map((i) => `${i.id} (${i.libelle})`).join(' ; ')}.`,
      habilitation: 'indicateurs.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ indicateurId: z.enum(idsIndicateurs as [string, ...string[]]) }),
      executer: (args, ctx) => ports.calculerIndicateur(ctx, args),
      sansIa: {
        motsCles: options.indicateurs.flatMap((i) => i.motsCles),
        arguments: (q) => {
          const question = normaliserMotsCles(q);
          const trouve = options.indicateurs.find((i) => i.motsCles.some((m) => question.includes(normaliserMotsCles(m))));
          return trouve ? { indicateurId: trouve.id } : null;
        },
      },
    } satisfies FonctionMetier<{ indicateurId: string }> as FonctionMetier);
  }
  return fonctions;
}
