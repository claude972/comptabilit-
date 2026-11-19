import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Variables lues dans le `.env` de la racine du dépôt, côté serveur uniquement.
 * Liste fermée : les secrets des autres services (base, stockage…) ne sont pas chargés dans le processus web.
 * Aucune n'est préfixée `NEXT_PUBLIC_` : rien n'est exposé au navigateur.
 */
const VARIABLES = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'SESSION_SECRET', 'API_URL', 'WEB_URL'] as const;

function chargerEnvRacine(): void {
  const fichier = path.resolve(process.cwd(), '../../.env');
  if (!existsSync(fichier)) return;
  for (const ligne of readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne.trim());
    if (!m) continue;
    const [, nom, brut = ''] = m;
    if (!nom || !(VARIABLES as readonly string[]).includes(nom)) continue;
    // Une variable déjà définie dans l'environnement (tests, production) l'emporte sur le fichier.
    if (process.env[nom] === undefined) process.env[nom] = brut.replace(/^(['"])(.*)\1$/, '$2');
  }
}
chargerEnvRacine();

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pas de fichier AGENTS.md généré automatiquement dans le dépôt.
  agentRules: false,
  // Les morceaux de téléversement (4 Mio) traversent le proxy Next : la limite reste proche de cette taille.
  experimental: { proxyClientMaxBodySize: '6mb' },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;
