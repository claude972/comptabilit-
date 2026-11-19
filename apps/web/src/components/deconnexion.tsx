'use client';

import { LogOut } from 'lucide-react';
import { type FormEvent, useEffect, useRef } from 'react';
import { purgerTout } from '@/lib/depots-locaux';
import { Bouton } from './ui/bouton';

/** Déconnexion : les dépôts en attente sont effacés de l'appareil AVANT l'envoi du formulaire. */
export function BoutonDeconnexion() {
  const purge = useRef(false);
  async function surEnvoi(e: FormEvent<HTMLFormElement>) {
    if (purge.current) return;
    e.preventDefault();
    const formulaire = e.currentTarget;
    await purgerTout().catch(() => undefined);
    purge.current = true;
    formulaire.submit();
  }
  return (
    <form method="post" action="/api/auth/deconnexion" onSubmit={surEnvoi}>
      <Bouton type="submit" variante="discret" aria-label="Se déconnecter">
        <LogOut aria-hidden="true" className="size-5" />
        <span className="hidden sm:inline">Se déconnecter</span>
      </Bouton>
    </form>
  );
}

/** Filet de sécurité : purge à l'arrivée sur l'écran de connexion après déconnexion (cas d'une déconnexion sans JavaScript). */
export function PurgeApresDeconnexion() {
  useEffect(() => {
    void purgerTout();
  }, []);
  return null;
}
