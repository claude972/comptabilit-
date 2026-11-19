import type { Dossier, Exercice, Niveau } from '../types-api';
import { estUuid, lireDossiers, lireExercices, parametre } from './donnees';

export type ContexteDossier = { ok: true; dossier: Dossier; niveau: Niveau } | { ok: false; statut: number; message?: string };

/**
 * Dossier et niveau d'habilitation de l'utilisateur, d'après `GET v1/dossiers` (l'API n'expose pas de lecture unitaire).
 * Dossier inconnu → 404 ; dossier visible mais sans habilitation, ou simple dépôt → 403.
 */
export async function contexteDossier(id: string): Promise<ContexteDossier> {
  if (!estUuid(id)) return { ok: false, statut: 404 };
  const dossiers = await lireDossiers();
  if (!dossiers.ok) return { ok: false, statut: dossiers.statut, message: dossiers.message };
  const dossier = dossiers.donnees.find((d) => d.id === id);
  if (!dossier) return { ok: false, statut: 404 };
  if (!dossier.niveau || dossier.niveau === 'depot') return { ok: false, statut: 403, message: 'Vous n’êtes pas habilité à consulter ce dossier.' };
  return { ok: true, dossier, niveau: dossier.niveau };
}

export type ContexteExercice = { ok: true; exercices: Exercice[]; exercice: Exercice | null } | { ok: false; statut: number; message: string };

/** Exercices du dossier et exercice choisi dans l'URL (à défaut, le plus récent). */
export async function contexteExercice(entiteId: string, demande: string | string[] | undefined): Promise<ContexteExercice> {
  const r = await lireExercices(entiteId);
  if (!r.ok) return r;
  const voulu = parametre(demande);
  return { ok: true, exercices: r.donnees, exercice: r.donnees.find((x) => x.id === voulu) ?? r.donnees[0] ?? null };
}
