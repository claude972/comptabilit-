import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { MarqueHydratation } from '@/components/hydratation';
import { ServiceWorker } from '@/components/pwa';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Comtaple', template: '%s — Comtaple' },
  description: 'Collecte de pièces et révision comptable pour cabinets d’expertise comptable.',
  applicationName: 'Comtaple',
  appleWebApp: { capable: true, title: 'Comtaple', statusBarStyle: 'default' },
  icons: { icon: '/icones/icone-192.png', apple: '/icones/icone-apple-180.png' },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1e3a5f' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1620' },
  ],
};

export default function Racine({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh antialiased">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3">
          Aller au contenu
        </a>
        {children}
        <ServiceWorker />
        <MarqueHydratation />
      </body>
    </html>
  );
}
