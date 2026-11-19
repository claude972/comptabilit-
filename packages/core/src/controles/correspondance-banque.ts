/**
 * Correspondance entre comptes comptables de banque (512…) et comptes bancaires des relevés.
 * Même logique d'association que le contrôle TRE-003, exposée pour l'écran de saisie : l'écran ne décide rien, il
 * prépare une PROPOSITION de règle (paramètre `correspondances` de TRE-003) soumise au circuit d'approbation.
 */
export interface Correspondance {
  compteNum: string;
  compteBancaire: string;
}

/** Clé d'un compte bancaire : IBAN, à défaut identifiant, sans espaces et en majuscules (même règle que TRE-003). */
export const cleCompteBancaire = (c: { iban: string | null; identifiant: string | null }): string => (c.iban ?? c.identifiant ?? '').replace(/\s/g, '').toUpperCase();

export type EtatAssociation = 'associe' | 'associe_d_office' | 'non_associe' | 'associe_sans_releve' | 'associe_plusieurs_fois';

export interface EtatCorrespondance {
  /** `determinee` : le rapprochement bancaire peut être réalisé pour chaque compte 512. */
  etat: 'determinee' | 'indeterminee' | 'aucun_compte_512' | 'aucun_releve';
  motif: string | null;
  comptes: Array<{ compteNum: string; etat: EtatAssociation; compteBancaire: string | null }>;
  /** Comptes bancaires des relevés qui ne sont associés à aucun compte 512. */
  comptesBancairesLibres: string[];
}

export function etatCorrespondanceBanque(comptes512: readonly string[], clesBancaires: readonly string[], correspondances: readonly Correspondance[]): EtatCorrespondance {
  const comptes = [...new Set(comptes512)].sort();
  const cles = [...new Set(clesBancaires)].sort();
  const normaliser = (x: string) => x.replace(/\s/g, '').toUpperCase();
  if (comptes.length === 0) return { etat: 'aucun_compte_512', motif: 'Aucun compte de banque mouvementé dans les écritures de l’exercice.', comptes: [], comptesBancairesLibres: cles };
  if (cles.length === 0) {
    return { etat: 'aucun_releve', motif: 'Aucun relevé bancaire actif pour ce dossier.', comptes: comptes.map((c) => ({ compteNum: c, etat: 'non_associe', compteBancaire: null })), comptesBancairesLibres: [] };
  }
  // Sans correspondance saisie : association d'office seulement s'il n'y a qu'un compte de chaque côté.
  if (correspondances.length === 0) {
    if (comptes.length === 1 && cles.length === 1) return { etat: 'determinee', motif: null, comptes: [{ compteNum: comptes[0]!, etat: 'associe_d_office', compteBancaire: cles[0]! }], comptesBancairesLibres: [] };
    return {
      etat: 'indeterminee',
      motif: `Association indéterminée entre ${comptes.length} compte(s) 512 et ${cles.length} compte(s) bancaire(s) : une correspondance doit être proposée puis approuvée.`,
      comptes: comptes.map((c) => ({ compteNum: c, etat: 'non_associe', compteBancaire: null })),
      comptesBancairesLibres: cles,
    };
  }
  const lignes = comptes.map((c) => {
    const corr = correspondances.filter((x) => x.compteNum === c);
    if (corr.length === 0) return { compteNum: c, etat: 'non_associe' as const, compteBancaire: null };
    if (corr.length > 1) return { compteNum: c, etat: 'associe_plusieurs_fois' as const, compteBancaire: null };
    const cle = normaliser(corr[0]!.compteBancaire);
    return { compteNum: c, etat: cles.includes(cle) ? ('associe' as const) : ('associe_sans_releve' as const), compteBancaire: cle };
  });
  const utilisees = new Set(lignes.filter((l) => l.etat === 'associe').map((l) => l.compteBancaire));
  const incomplets = lignes.filter((l) => l.etat !== 'associe');
  return {
    etat: incomplets.length === 0 ? 'determinee' : 'indeterminee',
    motif: incomplets.length === 0 ? null : `${incomplets.length} compte(s) 512 sans compte bancaire exploitable : ${incomplets.map((l) => l.compteNum).join(', ')}.`,
    comptes: lignes,
    comptesBancairesLibres: cles.filter((k) => !utilisees.has(k)),
  };
}

/**
 * Vérifie une correspondance proposée : chaque compte 512 et chaque compte bancaire doivent exister dans le dossier,
 * et l'association doit être un pour un. Renvoie la liste des refus (vide si la proposition est recevable) et la
 * proposition normalisée.
 */
export function verifierCorrespondances(comptes512: readonly string[], clesBancaires: readonly string[], proposees: readonly Correspondance[]): { erreurs: string[]; correspondances: Correspondance[] } {
  const erreurs: string[] = [];
  const normalisees = proposees.map((p) => ({ compteNum: p.compteNum.trim(), compteBancaire: p.compteBancaire.replace(/\s/g, '').toUpperCase() }));
  if (normalisees.length === 0) erreurs.push('Aucune correspondance proposée.');
  for (const p of normalisees) {
    if (!comptes512.includes(p.compteNum)) erreurs.push(`Le compte ${p.compteNum} n’est pas un compte de banque mouvementé dans les écritures de l’exercice.`);
    if (!clesBancaires.includes(p.compteBancaire)) erreurs.push(`Le compte bancaire ${masquerCompteBancaire(p.compteBancaire)} ne figure dans aucun relevé actif du dossier.`);
  }
  const double = (valeurs: string[]) => [...new Set(valeurs.filter((v, i) => valeurs.indexOf(v) !== i))];
  for (const c of double(normalisees.map((p) => p.compteNum))) erreurs.push(`Le compte ${c} est associé plusieurs fois.`);
  for (const k of double(normalisees.map((p) => p.compteBancaire))) erreurs.push(`Le compte bancaire ${masquerCompteBancaire(k)} est associé à plusieurs comptes comptables.`);
  return { erreurs: [...new Set(erreurs)], correspondances: normalisees.sort((a, b) => a.compteNum.localeCompare(b.compteNum)) };
}

/** Compte bancaire masqué sauf ses quatre derniers caractères (affichage et messages). */
export const masquerCompteBancaire = (cle: string): string => (cle.length <= 4 ? cle : `${'•'.repeat(Math.min(cle.length - 4, 8))}${cle.slice(-4)}`);
