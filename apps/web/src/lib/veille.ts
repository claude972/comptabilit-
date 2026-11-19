/** Veille réglementaire : formes de `apps/api/src/veille.controller.ts` et libellés. */
export type StatutApplicabilite = 'concerne' | 'a_confirmer' | 'non_concerne';
export type StatutSuivi = 'a_examiner' | 'pris_en_compte' | 'sans_objet';
export interface EvolutionDossier {
  id: string;
  emetteur: string;
  reference: string;
  url: string;
  passage: string | null;
  datePublication: string | null;
  dateEffet: string | null;
  conditions: string | null;
  resume: string | null;
  verifieeLe: string | null;
  applicabilite: { statut: StatutApplicabilite; raisons: string[]; manquants: string[]; exercicesConcernes: Array<{ debut: string; fin: string }> };
  suivi: { statut: StatutSuivi; note: string | null; majLe: string } | null;
}
export type StatutSource = 'jamais_verifiee' | 'inchangee' | 'changement_detecte' | 'indisponible';
export interface SourceSurveillee {
  id: string;
  emetteur: string;
  libelle: string;
  url: string;
  dernierEssaiLe: string | null;
  dernierSuccesLe: string | null;
  dernierStatut: StatutSource | string;
  dernierDetail: string | null;
  veilleAssuree: boolean;
}
export interface EtatSources {
  evolutionsDetecteesNonQualifiees: number;
  sources: SourceSurveillee[];
}

export const LIBELLE_APPLICABILITE: Record<StatutApplicabilite, string> = { concerne: 'Concerné', a_confirmer: 'À confirmer', non_concerne: 'Non concerné' };
export const LIBELLE_SUIVI: Record<StatutSuivi, string> = { a_examiner: 'À examiner', pris_en_compte: 'Pris en compte', sans_objet: 'Sans objet' };
export const PHRASE_VEILLE = 'Aucune évolution ne modifie les contrôles automatiquement.';
export const LIBELLE_VEILLE = { assuree: 'Veille assurée', nonAssuree: 'Veille NON assurée' } as const;
const DERNIER_STATUT: Record<string, string> = {
  jamais_verifiee: 'Jamais vérifiée',
  inchangee: 'Contenu inchangé à la dernière lecture',
  changement_detecte: 'Changement détecté à la dernière lecture (à qualifier par l’éditeur)',
  indisponible: 'Source indisponible au dernier essai',
};
export const libelleDernierStatut = (s: string) => DERNIER_STATUT[s] ?? s;
/**
 * Lecture d'une source. Une source dont la veille n'est pas assurée ne dit RIEN sur l'existence de nouveautés :
 * elle n'est jamais présentée comme « sans nouveauté ».
 */
export function lectureSource(s: Pick<SourceSurveillee, 'veilleAssuree' | 'dernierStatut' | 'dernierSuccesLe'>): { titre: string; explication: string } {
  if (s.veilleAssuree) return { titre: LIBELLE_VEILLE.assuree, explication: libelleDernierStatut(s.dernierStatut) };
  const cause = s.dernierSuccesLe === null ? 'Aucune lecture de cette source n’a encore réussi.' : 'La dernière lecture réussie est trop ancienne.';
  return { titre: LIBELLE_VEILLE.nonAssuree, explication: `${cause} Cela ne signifie pas qu’il n’y a aucune nouveauté : consultez la source vous-même.` };
}
