#!/usr/bin/env node
/**
 * Génère une paire de clés VAPID (RFC 8292, courbe P-256) pour les notifications poussées — outil de l'ÉDITEUR.
 *
 *   node scripts/cles-vapid.mjs "mailto:exploitation@votre-domaine.example"
 *
 * N'ÉCRIT RIEN : ni fichier, ni base, ni journal. La paire est affichée UNE fois sur la sortie standard, sous la forme
 * des trois variables d'environnement attendues ; à l'opérateur de les porter dans le coffre de secrets de la production
 * (jamais dans le dépôt, jamais dans un `.env` versionné). Aucune dépendance : `node:crypto` seulement.
 *
 * À savoir avant de s'en servir (docs/exploitation.md, « Notifications poussées ») :
 *  - tant que ces variables sont vides, la fonction est DÉSACTIVÉE (statut « non_configure ») ;
 *  - la clé privée permet d'émettre des notifications au nom du service vers tous les appareils abonnés : elle se garde
 *    comme un secret de production ;
 *  - changer de paire INVALIDE tous les abonnements existants (chaque personne devra réactiver ses appareils).
 */
import { createECDH } from 'node:crypto';

const sujet = process.argv[2] ?? '';
if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/.test(sujet)) {
  console.error('Usage : node scripts/cles-vapid.mjs "mailto:contact@domaine" (ou une adresse https://…)');
  console.error('Le contact est transmis aux services de notification des navigateurs avec chaque envoi : une adresse de l’éditeur, pas celle d’une personne.');
  process.exit(2);
}
const paire = createECDH('prime256v1');
paire.generateKeys();
const publique = paire.getPublicKey().toString('base64url');
// La clé privée est ramenée à 32 octets : `getPrivateKey()` omet les octets nuls de tête (une clé sur 256 environ), et le
// service refuse au démarrage une clé privée qui ne fait pas 32 octets.
const brute = paire.getPrivateKey();
const privee = Buffer.concat([Buffer.alloc(32 - brute.length), brute]).toString('base64url');
// Contrôle : la clé publique se recalcule à partir de la clé privée (point non compressé de 65 octets).
const controle = createECDH('prime256v1');
controle.setPrivateKey(Buffer.from(privee, 'base64url'));
if (controle.getPublicKey().toString('base64url') !== publique || Buffer.from(publique, 'base64url').length !== 65) throw new Error('Paire de clés incohérente : rien n’est affiché.');

console.error('Paire de clés VAPID générée. Elle n’est écrite NULLE PART : copiez ces trois lignes dans le coffre de secrets, puis effacez l’écran.');
console.error('Ne les placez ni dans le dépôt ni dans un fichier versionné. Voir docs/exploitation.md, « Notifications poussées ».');
console.log(`PUSH_VAPID_CLE_PUBLIQUE=${publique}`);
console.log(`PUSH_VAPID_CLE_PRIVEE=${privee}`);
console.log(`PUSH_VAPID_SUJET=${sujet}`);
