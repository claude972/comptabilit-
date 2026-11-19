/** Détection du type RÉEL d'un fichier par ses premiers octets (le type déclaré par le client n'est jamais cru). */
export type TypeDetecte =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/tiff'
  | 'application/xml'
  | 'inconnu';

export function detecterType(b: Uint8Array): TypeDetecte {
  const debut = (octets: number[], decalage = 0) => octets.every((o, i) => b[decalage + i] === o);
  // Un PDF peut être précédé de quelques octets ; la norme tolère l'en-tête dans les 1 024 premiers.
  const tete = Buffer.from(b.subarray(0, 1024)).toString('latin1');
  if (tete.includes('%PDF-')) return 'application/pdf';
  if (debut([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (debut([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (debut([0x52, 0x49, 0x46, 0x46]) && debut([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (debut([0x49, 0x49, 0x2a, 0x00]) || debut([0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
  const texte = tete.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (texte.startsWith('<?xml') || /^<([A-Za-z_][\w.-]*:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(texte)) return 'application/xml';
  return 'inconnu';
}
