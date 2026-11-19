/** Détection du format d'un relevé et décodage octets → texte. */
import { Buffer } from 'node:buffer';
import iconv from 'iconv-lite';

/**
 * Reconnaît le format d'après le DÉBUT du fichier (quelques milliers de caractères suffisent).
 * `inconnu` au moindre doute : l'appelant demande alors à l'utilisateur.
 */
export function detecterFormatReleve(debut: string): 'camt.053' | 'ofx' | 'csv' | 'agregation' | 'inconnu' {
  if (typeof debut !== 'string') return 'inconnu';
  const t = (debut.charCodeAt(0) === 0xfeff ? debut.slice(1) : debut).slice(0, 20_000).trimStart();
  if (t === '') return 'inconnu';
  if (t.startsWith('{')) return /^\{\s*"format"\s*:\s*"comtaple\.releve-agregation\/1"/.test(t) ? 'agregation' : 'inconnu';
  if (/^OFXHEADER\s*:/i.test(t) || /<\?OFX\b/i.test(t) || /<OFX>/i.test(t)) return 'ofx';
  if (t.startsWith('<')) {
    if (/xmlns(?::[A-Za-z0-9_.-]+)?\s*=\s*["'][^"']*camt\.053\./.test(t)) return 'camt.053';
    if (/<(?:[A-Za-z0-9_.-]+:)?BkToCstmrStmt[\s>]/.test(t) && !/camt\.0(?:52|54)\./.test(t)) return 'camt.053';
    return 'inconnu';
  }
  const lignes = t.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lignes.length < 2) return 'inconnu';
  for (const sep of [';', '\t', ',']) {
    const avec = lignes.filter((l) => l.split(sep).length >= 3).length;
    if (avec >= 2 && avec >= Math.ceil(lignes.length / 2)) return 'csv';
  }
  return 'inconnu';
}

/**
 * Décode les octets d'un relevé. Même stratégie que l'analyseur FEC (qui décode ligne à ligne, en flux,
 * et n'est donc pas réutilisable tel quel) : BOM UTF-8 ou UTF-16, sinon UTF-8 strict, sinon
 * Windows-1252 si des octets 0x80–0x9F sont présents, sinon ISO-8859-15.
 * La déclaration d'encodage d'un prologue XML n'est pas interprétée.
 */
export function decoderTexteReleve(octets: Uint8Array): { texte: string; encodage: string } {
  if (!(octets instanceof Uint8Array)) throw new Error('Octets attendus (Uint8Array).');
  const tampon = Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
  if (tampon.length >= 3 && tampon[0] === 0xef && tampon[1] === 0xbb && tampon[2] === 0xbf) {
    return { texte: new TextDecoder('utf-8', { fatal: false }).decode(tampon.subarray(3)), encodage: 'utf-8-bom' };
  }
  if (tampon.length >= 2 && tampon[0] === 0xff && tampon[1] === 0xfe) return { texte: iconv.decode(tampon.subarray(2), 'utf-16le'), encodage: 'utf-16le' };
  if (tampon.length >= 2 && tampon[0] === 0xfe && tampon[1] === 0xff) return { texte: iconv.decode(tampon.subarray(2), 'utf-16be'), encodage: 'utf-16be' };
  let nonAscii = false;
  let c1 = false;
  for (const o of tampon) {
    if (o >= 0x80) {
      nonAscii = true;
      if (o <= 0x9f) c1 = true;
    }
  }
  if (!nonAscii) return { texte: tampon.toString('latin1'), encodage: 'ascii' };
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(tampon), encodage: 'utf-8' };
  } catch {
    return c1 ? { texte: iconv.decode(tampon, 'windows-1252'), encodage: 'windows-1252' } : { texte: iconv.decode(tampon, 'ISO-8859-15'), encodage: 'iso-8859-15' };
  }
}
