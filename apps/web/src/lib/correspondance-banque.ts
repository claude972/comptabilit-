/** Correspondance comptes 512 / comptes bancaires : formes de `GET|POST v1/exercices/:id/correspondance-banque`. */
export type EtatAssociation = 'associe' | 'associe_d_office' | 'non_associe' | 'associe_sans_releve' | 'associe_plusieurs_fois';
export type EtatGlobal = 'determinee' | 'indeterminee' | 'aucun_compte_512' | 'aucun_releve';

export interface CorrespondanceMasquee {
  compteNum: string;
  /** Référence opaque du compte bancaire : l'IBAN complet n'est jamais transmis au navigateur. */
  compteBancaireRef: string | null;
  compteBancaire: string;
}
export interface CorrespondanceBanque {
  exercice: { id: string; entiteId: string; debut: string; fin: string };
  donneesComptables: boolean;
  etat: EtatGlobal;
  motif: string | null;
  comptes: Array<{ compteNum: string; compteLib: string | null; nbLignes: number; etat: EtatAssociation; compteBancaireRef: string | null; compteBancaire: string | null }>;
  comptesBancaires: Array<{ ref: string; libelle: string; nbReleves: number; formats: string[]; du: string | null; au: string | null; cadrages: string[]; libre: boolean }>;
  enVigueur: { origine: { regleId: string; version: number; portee: 'cabinet' | 'dossier' } | null; correspondances: CorrespondanceMasquee[] };
  propositions: Array<{ id: string; version: number; motif: string; proposeeParNom: string | null; creeLe: string; impactMesure: boolean; correspondances: CorrespondanceMasquee[] }>;
  mention: string;
}

export const LIBELLE_ETAT_GLOBAL: Record<EtatGlobal, string> = {
  determinee: 'Correspondance déterminée',
  indeterminee: 'Correspondance indéterminée',
  aucun_compte_512: 'Aucun compte de banque dans les écritures',
  aucun_releve: 'Aucun relevé bancaire actif',
};
export const LIBELLE_ETAT_ASSOCIATION: Record<EtatAssociation, string> = {
  associe: 'Associé (règle approuvée)',
  associe_d_office: 'Associé d’office (un seul compte de chaque côté)',
  non_associe: 'Non associé',
  associe_sans_releve: 'Associé à un compte sans relevé actif',
  associe_plusieurs_fois: 'Associé plusieurs fois',
};

/**
 * Contrôle de la saisie avant envoi (le serveur revérifie tout) : au moins une association, jamais deux comptes
 * comptables sur le même compte bancaire, motif renseigné. Renvoie les messages à afficher, ou la charge utile.
 */
export function preparerProposition(choix: Readonly<Record<string, string>>, motif: string): { erreurs: string[]; corps: { correspondances: Array<{ compteNum: string; compteBancaireRef: string }>; motif: string } | null } {
  const correspondances = Object.entries(choix)
    .filter(([, ref]) => ref)
    .map(([compteNum, compteBancaireRef]) => ({ compteNum, compteBancaireRef }))
    .sort((a, b) => a.compteNum.localeCompare(b.compteNum));
  const erreurs: string[] = [];
  if (correspondances.length === 0) erreurs.push('Associez au moins un compte de banque à un compte bancaire.');
  const refs = correspondances.map((c) => c.compteBancaireRef);
  if (new Set(refs).size !== refs.length) erreurs.push('Un même compte bancaire ne peut pas être associé à deux comptes comptables.');
  if (motif.trim().length < 5) erreurs.push('Indiquez le motif de cette correspondance (5 caractères au moins).');
  return erreurs.length ? { erreurs, corps: null } : { erreurs: [], corps: { correspondances, motif: motif.trim() } };
}
