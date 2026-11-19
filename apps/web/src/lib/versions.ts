/**
 * Versions d'une pièce (logique pure). Règle de l'API (`remplacerDocument`) : l'ancienne version et son fichier sont
 * CONSERVÉS ; elle passe au statut « remplace » ; si elle avait été validée, cette validation est explicitement
 * invalidée et ne vaut pas pour la nouvelle version, qui repart en contrôle.
 */
import type { Niveau, StatutDocument, VersionDocument, VueTerminee } from './types-api';
import { auMoins } from './types-api';

/** Une version est « remplacée » dès qu'une version plus récente existe (statut dédié ou lien vers la suivante). */
export function estRemplacee(d: { statut: StatutDocument | null; remplacePar?: string | null }): boolean {
  return d.statut === 'remplace' || Boolean(d.remplacePar);
}

/** Filtre « masquer les versions remplacées » des listes de pièces. */
export function sansRemplacees<T extends { statut: StatutDocument | null; remplacePar?: string | null }>(pieces: readonly T[], masquer: boolean): T[] {
  return masquer ? pieces.filter((p) => !estRemplacee(p)) : [...pieces];
}

/** Version qui remplace directement la pièce affichée ; à défaut d'être dans la chaîne, la plus récente connue. */
export function versionRemplacante(versions: readonly VersionDocument[], remplacePar: string | null): VersionDocument | null {
  if (!remplacePar) return null;
  return versions.find((v) => v.id === remplacePar) ?? null;
}

/** Version courante de la chaîne (la seule sur laquelle le travail se poursuit). */
export function versionCourante(versions: readonly VersionDocument[]): VersionDocument | null {
  return versions.filter((v) => v.statut !== 'remplace').sort((a, b) => b.version - a.version)[0] ?? null;
}

export type StatutValidation = 'validee' | 'validation_invalidee' | 'projet';

/**
 * Lecture du statut d'une extraction. « validation_invalidee » n'est JAMAIS une validation : c'est une validation
 * qui a existé et que l'arrivée d'une nouvelle version a rendue sans objet.
 */
export function statutValidation(statutExtraction: string | null | undefined): StatutValidation {
  if (statutExtraction === 'valide') return 'validee';
  if (statutExtraction === 'validation_invalidee') return 'validation_invalidee';
  return 'projet';
}
export const LIBELLE_VALIDATION_INVALIDEE = 'Validation invalidée par l’arrivée d’une nouvelle version';

export interface DroitNouvelleVersion {
  possible: boolean;
  /** Explication à afficher quand l'action n'est pas proposée ; null si rien n'est à dire. */
  raison: string | null;
}

/**
 * Qui peut déposer une nouvelle version (l'API reste seule juge) :
 *  - un collaborateur habilité, sur toute pièce courante (hors quarantaine) ;
 *  - un déposant, sur SA pièce, tant qu'elle n'a pas été validée par le cabinet.
 */
export function droitNouvelleVersion(p: { niveau: Niveau; estVersionCourante: boolean; statut: StatutDocument; deposeeParMoi: boolean }): DroitNouvelleVersion {
  if (!p.estVersionCourante) return { possible: false, raison: 'Cette version a été remplacée : une nouvelle version se dépose sur la version la plus récente.' };
  if (p.statut === 'quarantaine') return { possible: false, raison: 'Une pièce en quarantaine ne se remplace pas.' };
  if (auMoins(p.niveau, 'collaboration')) return { possible: true, raison: null };
  if (!p.deposeeParMoi) return { possible: false, raison: null };
  if (p.statut === 'traite') return { possible: false, raison: 'Cette pièce a été validée par le cabinet : seul un collaborateur habilité peut en déposer une nouvelle version.' };
  return { possible: true, raison: null };
}

export interface CompteRenduVersion {
  ton: 'succes' | 'attention' | 'info';
  titre: string;
  detail: string;
  /** Une nouvelle version existe réellement (à ouvrir). */
  nouvelle: boolean;
}

/** Ce qu'il faut dire après l'envoi, d'après la réponse de `terminer` (et elle seule). */
export function compteRenduVersion(vue: Pick<VueTerminee, 'doublonBinaire' | 'nouvelleVersion'>): CompteRenduVersion {
  if (vue.nouvelleVersion) {
    const n = vue.nouvelleVersion.version;
    return vue.nouvelleVersion.validationInvalidee
      ? {
          ton: 'attention',
          titre: `Version ${n} reçue`,
          detail: `La version précédente avait été validée : cette validation ne vaut pas pour la version ${n}, qui doit être contrôlée à nouveau. L’ancienne version et son fichier sont conservés.`,
          nouvelle: true,
        }
      : { ton: 'succes', titre: `Version ${n} reçue`, detail: 'L’ancienne version et son fichier sont conservés. La nouvelle version reste à contrôler.', nouvelle: true };
  }
  if (vue.doublonBinaire) {
    return { ton: 'info', titre: 'Fichier identique à l’existant', detail: 'Ce fichier est identique à celui déjà reçu : rien n’a été remplacé, aucune nouvelle version n’a été créée.', nouvelle: false };
  }
  return { ton: 'info', titre: 'Fichier reçu', detail: 'Le serveur a reçu le fichier mais n’a pas signalé de nouvelle version : rien n’a été remplacé.', nouvelle: false };
}
