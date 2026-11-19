'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ErreurHttp, ErreurReseau } from '@/lib/televersement/moteur';
import { appelBff } from '@/lib/televersement/transport-bff';

export function messageErreur(e: unknown): string {
  if (e instanceof ErreurReseau) return 'Connexion interrompue : l’action n’a pas été confirmée. Vérifiez votre connexion puis réessayez.';
  if (e instanceof ErreurHttp) {
    if (e.statut === 401) return 'Votre session a expiré. Rechargez la page pour vous reconnecter.';
    const details = (e.corps as { erreurs?: Array<{ champ?: string; probleme?: string }> } | null)?.erreurs;
    const suffixe = Array.isArray(details) && details.length ? ` (${details.map((d) => [d.champ, d.probleme].filter(Boolean).join(' : ')).join(' ; ')})` : '';
    if (e.statut === 403) return `Action refusée : ${e.message}${suffixe}`;
    return `${e.message}${suffixe}`;
  }
  return 'Une erreur inattendue est survenue.';
}

/** Exécute une action via le BFF, expose l'état (en cours, erreur, succès) et rafraîchit les données serveur de la page. */
export function useAppel() {
  const routeur = useRouter();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const executer = useCallback(
    async <T,>(chemin: string, init: { method: string; json?: unknown }, messageSucces?: string): Promise<T | null> => {
      setOccupe(true);
      setErreur(null);
      setSucces(null);
      try {
        const r = await appelBff<T>(chemin, init);
        setSucces(messageSucces ?? null);
        routeur.refresh();
        return r;
      } catch (e) {
        setErreur(messageErreur(e));
        return null;
      } finally {
        setOccupe(false);
      }
    },
    [routeur],
  );
  return { occupe, erreur, succes, executer, setErreur };
}
