'use client';

import { useEffect } from 'react';

/**
 * Marqueur d'hydratation (D-159) : pose `data-hydrate="oui"` sur <html> quand React a pris la page en charge. Aucun effet fonctionnel ; il sert au diagnostic des parcours
 * automatisés (état du clic : page hydratée ou non) et à toute attente déterministe, plutôt qu'à des délais empiriques.
 */
export function MarqueHydratation() {
  useEffect(() => {
    document.documentElement.dataset.hydrate = 'oui';
  }, []);
  return null;
}
