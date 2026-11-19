/**
 * Lecture en flux des lignes d'écriture pour les contrôles sur gros volumes. Le moteur reste pur : il ne connaît que
 * l'interface `SourceLignes` ; `sourceEnMemoire` en est l'implémentation de référence (tests, petits volumes).
 */
import { cleEcriture, cleTiers, DepassementBudget } from './outils.js';
import type { DemandePassage, LigneEcriture, OrdrePassage, SourceLignes } from './types.js';

export const cleCompteTiers = (l: LigneEcriture): string => `${l.compteNum}\u0001${cleTiers(l)}`;

/** Clé de groupe de chaque ordre de passage (la même que celle des contrôles en mémoire). */
export const CLES_DE_GROUPE: Record<Exclude<OrdrePassage, 'fichier'>, (l: LigneEcriture) => string> = {
  ecriture: cleEcriture,
  tiers: cleCompteTiers,
  compte: (l) => l.compteNum,
};

/**
 * Source en mémoire. `ordreGroupes` et `restreindre` n'existent que pour éprouver les contrôles : l'ordre des groupes
 * n'étant pas garanti par le contrat, les tests le font varier ; `restreindre: false` rend toutes les lignes malgré une
 * restriction demandée (le contrat l'autorise).
 */
export function sourceEnMemoire(lignes: readonly LigneEcriture[], options: { ordreGroupes?: 'croissant' | 'decroissant'; restreindre?: boolean } = {}): SourceLignes {
  for (let i = 1; i < lignes.length; i++) {
    if (!((lignes[i] as LigneEcriture).numeroLigne > (lignes[i - 1] as LigneEcriture).numeroLigne)) {
      throw new Error('Source de lignes invalide : numeroLigne doit être strictement croissant dans l’ordre du fichier.');
    }
  }
  const sens = options.ordreGroupes === 'decroissant' ? -1 : 1;
  return {
    nbLignes: lignes.length,
    async *parcourir(demande: DemandePassage): AsyncGenerator<LigneEcriture> {
      let retenues: readonly LigneEcriture[] = lignes;
      if (options.restreindre !== false) {
        const { prefixesComptes, journaux } = demande;
        if (prefixesComptes !== undefined) retenues = retenues.filter((l) => prefixesComptes.some((p) => l.compteNum.startsWith(p)));
        if (journaux !== undefined) retenues = retenues.filter((l) => journaux.includes(l.journalCode));
      }
      if (demande.ordre !== 'fichier') {
        const cle = CLES_DE_GROUPE[demande.ordre];
        const avecCle = retenues.map((l) => ({ l, k: cle(l) }));
        // Tri stable : dans un groupe, l'ordre du fichier est conservé.
        avecCle.sort((a, b) => (a.k < b.k ? -sens : a.k > b.k ? sens : 0));
        retenues = avecCle.map((x) => x.l);
      }
      for (const l of retenues) yield l;
    },
  };
}

/**
 * Parcourt un passage dont les groupes sont contigus et rend chaque groupe une fois terminé. Seules les lignes
 * `retenues` comptent ; un groupe sans ligne retenue n'est pas rendu. Mémoire : un seul groupe à la fois.
 */
export async function* parGroupes<G>(
  lignes: AsyncIterable<LigneEcriture>,
  cle: (l: LigneEcriture) => string,
  creer: () => G,
  ajouter: (groupe: G, l: LigneEcriture) => void,
  retenue: (l: LigneEcriture) => boolean = () => true,
): AsyncGenerator<G> {
  let courante: string | null = null;
  let groupe: G | null = null;
  for await (const l of lignes) {
    if (!retenue(l)) continue;
    const k = cle(l);
    if (groupe === null || k !== courante) {
      if (groupe !== null) yield groupe;
      groupe = creer();
      courante = k;
    }
    ajouter(groupe, l);
  }
  if (groupe !== null) yield groupe;
}

/** Groupes contigus rendus avec leurs lignes ; un groupe plus grand que `max` lignes dépasse le budget. */
export function groupesDeLignes(lignes: AsyncIterable<LigneEcriture>, cle: (l: LigneEcriture) => string, max: number, quoi: string): AsyncGenerator<LigneEcriture[]> {
  return parGroupes<LigneEcriture[]>(
    lignes,
    cle,
    () => [],
    (g, l) => {
      if (g.length >= max) throw new DepassementBudget(`${quoi} de plus de ${max.toLocaleString('fr-FR')} lignes`);
      g.push(l);
    },
  );
}

/** Empreinte non cryptographique (53 bits) d'une chaîne : sert à présélectionner des candidats, jamais à conclure. */
export function empreinte53(texte: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Réduit un exercice aux seules lignes dont dépend le rapprochement bancaire : les lignes des comptes de banque et, dans
 * les écritures qui en contiennent, les lignes portant un compte auxiliaire (tiers de la contrepartie). Le rapprochement
 * calculé sur cette réduction est identique à celui calculé sur l'exercice entier (voir `elementsBanqueDepuisEcritures`).
 * Rend les lignes dans l'ordre du fichier ; lève `DepassementBudget` au-delà de `maxLignes`.
 */
export async function reduireAuxEcrituresDeBanque(source: SourceLignes, prefixesBanque: readonly string[], maxLignes: number): Promise<LigneEcriture[]> {
  const estBanque = (l: LigneEcriture): boolean => prefixesBanque.some((p) => l.compteNum.startsWith(p));
  const gardees: LigneEcriture[] = [];
  const garder = (l: LigneEcriture): void => {
    if (gardees.length >= maxLignes) throw new DepassementBudget(`plus de ${maxLignes.toLocaleString('fr-FR')} lignes à garder pour le rapprochement des comptes de banque`);
    gardees.push(l);
  };
  const ecritures = new Set<string>();
  for await (const l of source.parcourir({ ordre: 'fichier', prefixesComptes: prefixesBanque })) {
    if (!estBanque(l)) continue;
    garder(l);
    ecritures.add(cleEcriture(l));
  }
  if (ecritures.size > 0) {
    for await (const l of source.parcourir({ ordre: 'fichier' })) {
      if (estBanque(l) || l.compAuxNum === null || l.compAuxNum === '' || !ecritures.has(cleEcriture(l))) continue;
      garder(l);
    }
  }
  return gardees.sort((a, b) => a.numeroLigne - b.numeroLigne);
}
