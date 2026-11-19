import { estGestionnaire } from '../messagerie';
import type { Moi } from '../types-api';
import { lireMoi } from './donnees';

export const REFUS_MESSAGERIE = 'La gestion des connexions de messagerie est réservée aux gestionnaires du cabinet (administrateur, associé).';

/** Accès aux écrans de messagerie : gestionnaires uniquement. Les autres rôles reçoivent un refus sans appel inutile de l'API. */
export async function accesMessagerie(): Promise<{ ok: true; moi: Moi } | { ok: false; statut: number; message: string }> {
  const moi = await lireMoi();
  if (!moi.ok) return moi;
  if (!estGestionnaire(moi.donnees.role)) return { ok: false, statut: 403, message: REFUS_MESSAGERIE };
  return { ok: true, moi: moi.donnees };
}
