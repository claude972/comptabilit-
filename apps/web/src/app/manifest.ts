import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Comtaple',
    short_name: 'Comtaple',
    description: 'Dépôt de pièces comptables et suivi de la révision avec votre cabinet d’expertise comptable.',
    lang: 'fr',
    dir: 'ltr',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f9',
    theme_color: '#1e3a5f',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Déposer une pièce', url: '/deposer' },
      { name: 'Mes dépôts', url: '/depots' },
    ],
  };
}
