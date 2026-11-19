/** Recherche dans un dossier : formes de `apps/api/src/recherche.controller.ts` et découpe des extraits. */
import type { StatutDocument, StatutRevue } from './types-api';

export interface ResultatPiece {
  documentId: string;
  nomOrigine: string;
  page: number;
  statut: StatutDocument;
  extrait: string;
}
export interface ResultatEcriture {
  id: string;
  exerciceId: string;
  lotImportId: string;
  date: string;
  journal: string;
  numero: string;
  compte: string;
  piece: string;
  libelle: string;
  debit: string;
  credit: string;
}
export interface ResultatConstat {
  id: string;
  exerciceId: string;
  controleId: string;
  titre: string;
  statutRevue: StatutRevue;
  montant: string | null;
}
export interface ResultatsRecherche {
  requete: string;
  perimetre: string;
  pieces: ResultatPiece[];
  ecritures: ResultatEcriture[];
  constats: ResultatConstat[];
}

export const LONGUEUR_MIN_RECHERCHE = 2;
export const LONGUEUR_MAX_RECHERCHE = 200;
/** Requête telle que l'API l'accepte (2 à 200 caractères une fois les espaces de bord retirés), sinon null. */
export function requeteValide(q: string | undefined): string | null {
  const r = (q ?? '').trim();
  return r.length >= LONGUEUR_MIN_RECHERCHE && r.length <= LONGUEUR_MAX_RECHERCHE ? r : null;
}

export interface FragmentExtrait {
  texte: string;
  surligne: boolean;
}
/**
 * Découpe un extrait renvoyé par l'API autour de ses marqueurs « … » : chaque fragment est rendu comme un nœud texte
 * (jamais de HTML). Les marqueurs appariés sont retirés ; un marqueur orphelin reste affiché tel quel.
 */
export function decouperExtrait(extrait: string): FragmentExtrait[] {
  const fragments: FragmentExtrait[] = [];
  const pousser = (texte: string, surligne: boolean) => {
    if (!texte) return;
    const dernier = fragments.at(-1);
    if (dernier && dernier.surligne === surligne) dernier.texte += texte;
    else fragments.push({ texte, surligne });
  };
  let position = 0;
  for (const m of extrait.matchAll(/«([^«»]*)»/g)) {
    pousser(extrait.slice(position, m.index), false);
    pousser(m[1] ?? '', true);
    position = m.index + m[0].length;
  }
  pousser(extrait.slice(position), false);
  return fragments;
}
