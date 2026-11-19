import { env, estLocal } from './env';
import { origineFournisseur } from './oidc';

/** En-tête exigé sur toute requête non-GET vers le BFF : un formulaire d'un autre site ne peut pas l'ajouter. */
export const ENTETE_CSRF = 'x-comtaple-csrf';

/**
 * Protection CSRF des méthodes non-GET : `Origin` doit être exactement l'origine de l'application,
 * `Sec-Fetch-Site` (quand le navigateur l'envoie) doit valoir `same-origin`, et l'en-tête personnalisé doit être présent
 * (sauf pour les formulaires HTML natifs, où `exigerEntete` vaut false et où `Origin` reste exigé).
 */
export function refusCsrf(entetes: Headers, exigerEntete = true): string | null {
  const origine = entetes.get('origin');
  if (!origine || origine !== new URL(env().WEB_URL).origin) return 'Origine de la requête refusée';
  const site = entetes.get('sec-fetch-site');
  if (site && site !== 'same-origin') return 'Requête intersite refusée';
  if (exigerEntete && entetes.get(ENTETE_CSRF) !== '1') return 'En-tête de protection manquant';
  return null;
}

export function politiqueContenu(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  const directives = [
    "default-src 'self'",
    // Aucun script en ligne sans nonce ; « strict-dynamic » limite les scripts à ceux chargés par un script signé.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    // Aperçu d'une pièce : objet local (blob) produit à partir d'une réponse du BFF, jamais une URL tierce.
    "frame-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // La déconnexion est un formulaire redirigé vers le fournisseur d'identité.
    `form-action 'self' ${origineFournisseur()}`,
    "frame-ancestors 'none'",
  ];
  if (!estLocal(env().WEB_URL)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function entetesSecurite(nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': politiqueContenu(nonce),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // L'appareil photo n'est autorisé que pour l'application elle-même ; les autres capteurs sont coupés.
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(estLocal(env().WEB_URL) ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
  };
}
