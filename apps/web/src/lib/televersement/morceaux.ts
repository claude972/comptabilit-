/** Découpage d'un fichier en morceaux pour le téléversement reprenable. */
export interface Morceau {
  /** Décalage du premier octet (inclus). */
  decalage: number;
  /** Décalage de fin (exclu). */
  fin: number;
}

/** Morceau à envoyer à partir d'un décalage confirmé par le serveur ; null si tout est déjà envoyé. */
export function prochainMorceau(taille: number, tailleMorceau: number, decalage: number): Morceau | null {
  if (!Number.isSafeInteger(taille) || taille <= 0) throw new Error('taille invalide');
  if (!Number.isSafeInteger(tailleMorceau) || tailleMorceau <= 0) throw new Error('taille de morceau invalide');
  if (!Number.isSafeInteger(decalage) || decalage < 0 || decalage > taille) throw new Error('décalage invalide');
  if (decalage === taille) return null;
  return { decalage, fin: Math.min(taille, decalage + tailleMorceau) };
}

/** Plan complet des morceaux restants à partir de `depuis`. */
export function planMorceaux(taille: number, tailleMorceau: number, depuis = 0): Morceau[] {
  const plan: Morceau[] = [];
  for (let m = prochainMorceau(taille, tailleMorceau, depuis); m; m = prochainMorceau(taille, tailleMorceau, m.fin)) plan.push(m);
  return plan;
}
