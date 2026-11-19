/**
 * Chiffrement des jetons au repos : AES-256-GCM, IV aléatoire de 12 octets,
 * données associées = identifiant de connexion (un chiffré ne peut pas être rejoué sur une autre connexion).
 *
 * Format versionné : `v1.<idCle>.<iv>.<chiffré>.<étiquette>` (base64url).
 * `idCle` désigne la clé utilisée, ce qui permet la rotation : on chiffre avec la clé courante,
 * on déchiffre avec la clé nommée dans l'enveloppe.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ErreurChiffrement } from './erreurs.js';
import type { JeuDeJetons } from './types.js';

const VERSION = 'v1';

export interface CleChiffrement {
  /** Identifiant non secret de la clé (lettres, chiffres, tirets). */
  id: string;
  /** Clé de 32 octets fournie par l'appelant. */
  cle: Uint8Array;
}

export interface Trousseau {
  courante: CleChiffrement;
  /** Anciennes clés encore acceptées au déchiffrement. */
  anciennes?: CleChiffrement[];
}

const schemaJetons = z.object({
  jetonAcces: z.string(),
  expireLe: z.string(),
  jetonRafraichissement: z.string().nullable(),
  scopes: z.array(z.string()),
  etatClient: z.string(),
});

function verifierCle(cle: CleChiffrement): void {
  if (cle.cle.byteLength !== 32) throw new ErreurChiffrement('cle_invalide', 'La clé doit faire exactement 32 octets.');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(cle.id)) throw new ErreurChiffrement('cle_invalide', 'Identifiant de clé invalide.');
}

function donneesAssociees(connexionId: string, idCle: string): Buffer {
  return Buffer.from(`comtaple-mail|${VERSION}|${idCle}|${connexionId}`, 'utf8');
}

export function chiffrerJetons(jetons: JeuDeJetons, connexionId: string, cle: CleChiffrement): string {
  verifierCle(cle);
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cle.cle, iv);
  chiffreur.setAAD(donneesAssociees(connexionId, cle.id));
  const chiffre = Buffer.concat([chiffreur.update(JSON.stringify(jetons), 'utf8'), chiffreur.final()]);
  const etiquette = chiffreur.getAuthTag();
  return [VERSION, cle.id, iv.toString('base64url'), chiffre.toString('base64url'), etiquette.toString('base64url')].join('.');
}

export function dechiffrerJetons(enveloppe: string, connexionId: string, trousseau: Trousseau): JeuDeJetons {
  const parties = enveloppe.split('.');
  if (parties.length !== 5 || parties[0] !== VERSION) {
    throw new ErreurChiffrement('format_inconnu', 'Enveloppe de jetons de format inconnu.');
  }
  const [, idCle, ivB64, chiffreB64, etiquetteB64] = parties as [string, string, string, string, string];
  const cle = [trousseau.courante, ...(trousseau.anciennes ?? [])].find((c) => c.id === idCle);
  if (!cle) throw new ErreurChiffrement('cle_inconnue', 'Aucune clé du trousseau ne correspond à cette enveloppe.');
  verifierCle(cle);
  try {
    const dechiffreur = createDecipheriv('aes-256-gcm', cle.cle, Buffer.from(ivB64, 'base64url'));
    dechiffreur.setAAD(donneesAssociees(connexionId, idCle));
    dechiffreur.setAuthTag(Buffer.from(etiquetteB64, 'base64url'));
    const clair = Buffer.concat([dechiffreur.update(Buffer.from(chiffreB64, 'base64url')), dechiffreur.final()]);
    return schemaJetons.parse(JSON.parse(clair.toString('utf8')));
  } catch {
    throw new ErreurChiffrement(
      'dechiffrement_refuse',
      'Déchiffrement refusé : enveloppe altérée, mauvaise clé ou mauvais identifiant de connexion.',
    );
  }
}

/** Indique si l'enveloppe doit être rechiffrée avec la clé courante (rotation). */
export function doitEtreRechiffre(enveloppe: string, trousseau: Trousseau): boolean {
  return enveloppe.split('.')[1] !== trousseau.courante.id;
}
