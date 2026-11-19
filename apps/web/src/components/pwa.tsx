'use client';

import { Share, SquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alerte } from './ui/base';
import { Bouton } from './ui/bouton';

/** Enregistre le service worker (production uniquement : en développement il gênerait le rechargement à chaud). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}

interface EvenementInstallation extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'inconnu' | 'installee' | 'invite' | 'ios' | 'indisponible';

/**
 * Invite d'installation. Trois cas explicites : le navigateur propose l'installation (`beforeinstallprompt`),
 * iOS Safari (ajout manuel à l'écran d'accueil), ou aucune installation possible depuis ce navigateur.
 */
export function InviteInstallation() {
  const [mode, setMode] = useState<Mode>('inconnu');
  const [evenement, setEvenement] = useState<EvenementInstallation | null>(null);
  const [masquee, setMasquee] = useState(false);

  useEffect(() => {
    const autonome = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (autonome) {
      setMode('installee');
      return;
    }
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    setMode(ios ? 'ios' : 'indisponible');
    const surInvite = (e: Event) => {
      e.preventDefault();
      setEvenement(e as EvenementInstallation);
      setMode('invite');
    };
    const surInstallation = () => setMode('installee');
    window.addEventListener('beforeinstallprompt', surInvite);
    window.addEventListener('appinstalled', surInstallation);
    return () => {
      window.removeEventListener('beforeinstallprompt', surInvite);
      window.removeEventListener('appinstalled', surInstallation);
    };
  }, []);

  if (masquee || mode === 'inconnu' || mode === 'installee') return null;

  return (
    <Alerte ton="neutre" titre="Installer Comtaple sur cet appareil" data-testid="invite-installation">
      {mode === 'invite' && evenement ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="grow">L’application s’ouvre alors comme une application du téléphone, depuis l’écran d’accueil.</p>
          <Bouton
            onClick={async () => {
              await evenement.prompt();
              const choix = await evenement.userChoice;
              if (choix.outcome === 'accepted') setMode('installee');
              else setMasquee(true);
            }}
          >
            <SquarePlus aria-hidden="true" className="size-5" /> Installer
          </Bouton>
        </div>
      ) : mode === 'ios' ? (
        <p className="mt-1">
          Dans Safari, touchez <Share aria-hidden="true" className="inline size-5 align-text-bottom" /> <strong>Partager</strong>, puis{' '}
          <strong>Sur l’écran d’accueil</strong>. Depuis un autre navigateur sur iPhone ou iPad, ouvrez d’abord cette page dans Safari.
        </p>
      ) : (
        <p className="mt-1">
          Ce navigateur ne propose pas l’installation pour le moment. Vous pouvez utiliser Comtaple dans cet onglet ; sur Android, Chrome
          propose l’installation depuis son menu (« Installer l’application » ou « Ajouter à l’écran d’accueil »).
        </p>
      )}
      <div className="mt-2">
        <Bouton variante="discret" onClick={() => setMasquee(true)}>
          Plus tard
        </Bouton>
      </div>
    </Alerte>
  );
}
