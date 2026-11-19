/**
 * Génère les icônes de la PWA (monogramme « C » : anneau ouvert blanc sur fond bleu), sans dépendance :
 * encodage PNG minimal avec zlib. Aucune marque ni logo tiers.
 * Usage : node scripts/generer-icones.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const FOND = [0x1e, 0x3a, 0x5f];
const TRAIT = [0xff, 0xff, 0xff];

const tableCrc = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = tableCrc[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type, donnees) {
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const tete = Buffer.alloc(4);
  tete.writeUInt32BE(donnees.length);
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc32(corps));
  return Buffer.concat([tete, corps, fin]);
}

/** Part du pixel couverte par le monogramme (suréchantillonnage 4×4). `rayon` est relatif à la demi-largeur. */
function couverture(x, y, taille, rayon) {
  let dedans = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = ((x + (sx + 0.5) / 4) / taille) * 2 - 1;
      const py = ((y + (sy + 0.5) / 4) / taille) * 2 - 1;
      const d = Math.hypot(px, py);
      const angle = Math.abs(Math.atan2(py, px)); // 0 = vers la droite
      if (d <= rayon && d >= rayon * 0.62 && angle > 0.72) dedans++;
    }
  }
  return dedans / 16;
}

function icone(taille, rayon, arrondi) {
  const lignes = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    const debut = y * (taille * 4 + 1);
    lignes[debut] = 0; // filtre « aucun »
    for (let x = 0; x < taille; x++) {
      const c = couverture(x, y, taille, rayon);
      // Coins arrondis (transparents) pour l'icône standard ; l'icône « maskable » est pleine.
      let alpha = 255;
      if (arrondi > 0) {
        const r = arrondi * taille;
        const dx = Math.max(r - x - 0.5, x + 0.5 - (taille - r), 0);
        const dy = Math.max(r - y - 0.5, y + 0.5 - (taille - r), 0);
        const d = Math.hypot(dx, dy);
        alpha = Math.round(255 * Math.min(1, Math.max(0, r - d + 0.5)));
      }
      const i = debut + 1 + x * 4;
      for (let k = 0; k < 3; k++) lignes[i + k] = Math.round(FOND[k] * (1 - c) + TRAIT[k] * c);
      lignes[i + 3] = alpha;
    }
  }
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete.set([8, 6, 0, 0, 0], 8); // 8 bits, RVBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(lignes, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

const dossier = path.resolve(import.meta.dirname, '../public/icones');
mkdirSync(dossier, { recursive: true });
const sorties = [
  ['icone-192.png', 192, 0.62, 0.18],
  ['icone-512.png', 512, 0.62, 0.18],
  // Zone de sécurité « maskable » : le motif tient dans le disque central de 80 %.
  ['icone-maskable-192.png', 192, 0.46, 0],
  ['icone-maskable-512.png', 512, 0.46, 0],
  ['icone-apple-180.png', 180, 0.56, 0],
];
for (const [nom, taille, rayon, arrondi] of sorties) {
  writeFileSync(path.join(dossier, nom), icone(taille, rayon, arrondi));
  console.log(`${nom} (${taille}×${taille})`);
}
