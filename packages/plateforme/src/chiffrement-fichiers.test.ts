import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chiffrerFichier, dechiffrerFichier, empreinteClePublique, genererPaireDeCles } from './chiffrement-fichiers.js';

const dossier = mkdtempSync(join(tmpdir(), 'chiffrement-'));
afterAll(() => rmSync(dossier, { recursive: true, force: true }));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const cles = genererPaireDeCles();
let n = 0;
const chemin = (suffixe: string) => join(dossier, `${++n}-${suffixe}`);
const MIO = 1 << 20;

async function allerRetour(clair: Buffer) {
  const [source, chiffre, sortie] = [chemin('clair'), chemin('chiffre'), chemin('sortie')];
  writeFileSync(source, clair);
  const c = await chiffrerFichier(source, chiffre, cles.clePubliquePem);
  const d = await dechiffrerFichier(chiffre, sortie, cles.clePriveePem);
  return { source, chiffre, sortie, c, d };
}

describe('chiffrement des fichiers de sauvegarde', () => {
  it('aller-retour exact pour un fichier vide, petit, d’exactement un bloc, de plusieurs blocs', async () => {
    for (const taille of [0, 1, 1000, MIO - 1, MIO, MIO + 1, 3 * MIO, 3 * MIO + 12345]) {
      const clair = randomBytes(taille);
      const { source, chiffre, sortie, c, d } = await allerRetour(clair);
      expect(readFileSync(sortie).equals(clair), `taille ${taille}`).toBe(true);
      expect(c).toEqual({ octetsClairs: taille, sha256Clair: sha(clair), destinataire: cles.empreinte });
      expect(d).toEqual(c);
      expect(readFileSync(source).equals(clair)).toBe(true); // la source n'est ni modifiée ni supprimée
      expect(statSync(chiffre).size).toBeGreaterThan(taille);
      expect(statSync(chiffre).mode & 0o077).toBe(0); // lisible par son seul propriétaire
    }
  });

  it('le chiffré ne contient pas le clair, et deux chiffrements du même fichier diffèrent', async () => {
    const clair = Buffer.from('IBAN FR7630006000011234567890189 — contenu reconnaissable '.repeat(2000), 'utf8');
    const a = await allerRetour(clair);
    const b = await allerRetour(clair);
    expect(readFileSync(a.chiffre).includes(Buffer.from('FR7630006000011234567890189'))).toBe(false);
    expect(readFileSync(a.chiffre).equals(readFileSync(b.chiffre))).toBe(false);
  });

  it('chiffrer ne demande que la clé publique ; déchiffrer avec une autre clé est refusé', async () => {
    const { chiffre } = await allerRetour(randomBytes(5000));
    const autre = genererPaireDeCles();
    await expect(dechiffrerFichier(chiffre, null, autre.clePriveePem)).rejects.toThrow(/pour une autre clé/);
    expect(cles.clePubliquePem).not.toContain('PRIVATE');
    expect(empreinteClePublique(cles.clePubliquePem)).toBe(cles.empreinte);
    expect(cles.empreinte).toMatch(/^[0-9a-f]{32}$/);
  });

  it('vérification sans rien écrire : même empreinte du clair', async () => {
    const clair = randomBytes(2 * MIO + 7);
    const { chiffre } = await allerRetour(clair);
    expect(await dechiffrerFichier(chiffre, null, cles.clePriveePem)).toMatchObject({ sha256Clair: sha(clair), octetsClairs: clair.length });
  });

  it('un octet modifié n’importe où (en-tête, clé éphémère, bloc, étiquette) fait échouer le déchiffrement', async () => {
    const clair = randomBytes(2 * MIO + 500);
    const { chiffre } = await allerRetour(clair);
    const original = readFileSync(chiffre);
    const positions = [3, 20, 60, 150, 400, MIO, MIO + 300 + 21, 2 * MIO + 200, original.length - 600, original.length - 20, original.length - 1];
    for (const p of positions) {
      const altere = Buffer.from(original);
      altere[p]! ^= 0x01;
      const fichier = chemin('altere');
      writeFileSync(fichier, altere);
      await expect(dechiffrerFichier(fichier, null, cles.clePriveePem), `octet ${p}`).rejects.toThrow();
    }
  });

  it('fin tronquée, dernier bloc retiré, blocs intervertis, données ajoutées : refusés', async () => {
    const clair = randomBytes(3 * MIO);
    const { chiffre } = await allerRetour(clair);
    const original = readFileSync(chiffre);
    const tailleEnTete = original.readUInt32BE(8);
    const debutBlocs = 12 + tailleEnTete;
    const tailleBloc = 5 + MIO + 16;
    const essai = async (contenu: Buffer) => {
      const fichier = chemin('manipule');
      writeFileSync(fichier, contenu);
      return dechiffrerFichier(fichier, null, cles.clePriveePem);
    };
    await expect(essai(original.subarray(0, original.length - 1))).rejects.toThrow(/tronqué/);
    // Fichier coupé proprement à la frontière d'un bloc : le dernier bloc restant n'est pas marqué « dernier ».
    await expect(essai(original.subarray(0, debutBlocs + 2 * tailleBloc))).rejects.toThrow(/tronqué/);
    // Même coupe en maquillant l'indicateur de fin : l'authentification du bloc échoue.
    const maquille = Buffer.from(original.subarray(0, debutBlocs + 2 * tailleBloc));
    maquille[debutBlocs + tailleBloc + 4] = 1;
    await expect(essai(maquille)).rejects.toThrow(/altérée \(bloc 1\)/);
    // Deux premiers blocs intervertis.
    const inverse = Buffer.concat([original.subarray(0, debutBlocs), original.subarray(debutBlocs + tailleBloc, debutBlocs + 2 * tailleBloc), original.subarray(debutBlocs, debutBlocs + tailleBloc), original.subarray(debutBlocs + 2 * tailleBloc)]);
    await expect(essai(inverse)).rejects.toThrow(/altérée \(bloc 0\)/);
    await expect(essai(Buffer.concat([original, Buffer.from([0])]))).rejects.toThrow(/après le dernier bloc/);
    await expect(essai(Buffer.from('pas une sauvegarde chiffrée, juste du texte'))).rejects.toThrow(/n’est pas une sauvegarde chiffrée/);
    expect((await essai(original)).sha256Clair).toBe(sha(clair)); // l'original, lui, reste valide
  });

  it('n’écrase jamais un fichier existant, ni en chiffrant ni en déchiffrant', async () => {
    const { source, chiffre, sortie } = await allerRetour(randomBytes(100));
    await expect(chiffrerFichier(source, chiffre, cles.clePubliquePem)).rejects.toThrow(/EEXIST/);
    await expect(dechiffrerFichier(chiffre, sortie, cles.clePriveePem)).rejects.toThrow(/EEXIST/);
    expect(existsSync(source)).toBe(true);
  });

  it('une clé d’un autre type est refusée', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const source = chemin('clair');
    writeFileSync(source, 'x');
    await expect(chiffrerFichier(source, chemin('chiffre'), rsa)).rejects.toThrow(/X25519/);
  });
});
