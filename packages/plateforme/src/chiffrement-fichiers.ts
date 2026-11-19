/**
 * Chiffrement de fichiers de SAUVEGARDE, en flux, pour un destinataire désigné par sa clé publique.
 *
 * PRÉPARATION, non validée pour l'exploitation : le format ci-dessous assemble des primitives standard de Node.js, mais
 * n'a été ni audité ni comparé à un outil reconnu. En production, préférer le chiffrement géré par l'hébergeur ou un
 * outil éprouvé ; ce module sert à ne plus laisser de sauvegardes locales en clair et à fixer les propriétés attendues.
 *
 * Propriétés :
 *  - chiffrer ne demande que la clé PUBLIQUE : le poste qui sauvegarde ne peut pas relire ses propres sauvegardes ;
 *  - X25519 éphémère + HKDF-SHA-256 pour dériver la clé du fichier, AES-256-GCM par blocs de 1 Mio ;
 *  - chaque bloc est authentifié avec son rang et un indicateur « dernier bloc » : un bloc modifié, déplacé, retiré,
 *    ou une fin tronquée font échouer le déchiffrement ;
 *  - l'en-tête (format, empreinte de la clé du destinataire, clé éphémère, sel) est authentifié avec chaque bloc ;
 *  - l'empreinte SHA-256 du fichier en clair est calculée des deux côtés et renvoyée, pour comparaison.
 *
 * Format : « CTPSAUV1 » | longueur de l'en-tête (4 octets, grand-boutiste) | en-tête JSON |
 *          puis, par bloc : longueur du chiffré (4 octets) | indicateur de fin (1 octet) | chiffré | étiquette (16 octets).
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';

export const FORMAT_SAUVEGARDE_CHIFFREE = 'comtaple.sauvegarde-chiffree/1';
const MAGIE = Buffer.from('CTPSAUV1', 'ascii');
const TAILLE_BLOC = 1 << 20;
const TAILLE_ETIQUETTE = 16;

export interface PaireDeCles {
  /** Clé privée au format PEM (PKCS#8). À conserver HORS du poste qui sauvegarde ; jamais journalisée ni affichée. */
  clePriveePem: string;
  /** Clé publique au format PEM (SPKI) : c'est la seule nécessaire pour chiffrer. */
  clePubliquePem: string;
  /** Empreinte de la clé publique, pour désigner le destinataire sans rien révéler. */
  empreinte: string;
}

const brute = (cle: KeyObject) => cle.export({ type: 'spki', format: 'der' });
export const empreinteClePublique = (clePubliquePem: string): string => createHash('sha256').update(brute(createPublicKey(clePubliquePem))).digest('hex').slice(0, 32);

export function genererPaireDeCles(): PaireDeCles {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const clePubliquePem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { clePriveePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), clePubliquePem, empreinte: empreinteClePublique(clePubliquePem) };
}

interface EnTete {
  format: typeof FORMAT_SAUVEGARDE_CHIFFREE;
  destinataire: string;
  cleEphemere: string;
  sel: string;
  tailleBloc: number;
}

function cleDuFichier(secret: Buffer, enTete: EnTete): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from(enTete.sel, 'base64'), Buffer.from(`${FORMAT_SAUVEGARDE_CHIFFREE}|${enTete.destinataire}|${enTete.cleEphemere}`, 'utf8'), 32));
}
/** Nonce d'un bloc : son rang sur 12 octets (une clé par fichier, donc aucun nonce n'est réutilisé). */
function nonce(rang: number): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(BigInt(rang), 4);
  return n;
}
const donneesAssociees = (enTeteBrut: Buffer, rang: number, dernier: boolean) => Buffer.concat([enTeteBrut, nonce(rang), Buffer.from([dernier ? 1 : 0])]);

export interface ResultatChiffrement {
  octetsClairs: number;
  /** SHA-256 du fichier en clair. */
  sha256Clair: string;
  destinataire: string;
}

/** Chiffre `source` vers `destination` pour le détenteur de la clé privée correspondante. `source` n'est jamais modifié ni supprimé. */
export async function chiffrerFichier(source: string, destination: string, clePubliquePem: string): Promise<ResultatChiffrement> {
  const destinataire = createPublicKey(clePubliquePem);
  if (destinataire.asymmetricKeyType !== 'x25519') throw new Error('Clé publique inattendue : une clé X25519 est requise');
  const ephemere = generateKeyPairSync('x25519');
  const enTete: EnTete = {
    format: FORMAT_SAUVEGARDE_CHIFFREE,
    destinataire: empreinteClePublique(clePubliquePem),
    cleEphemere: brute(ephemere.publicKey).toString('base64'),
    sel: randomBytes(32).toString('base64'),
    tailleBloc: TAILLE_BLOC,
  };
  const enTeteBrut = Buffer.from(JSON.stringify(enTete), 'utf8');
  const cle = cleDuFichier(diffieHellman({ privateKey: ephemere.privateKey, publicKey: destinataire }), enTete);
  // Écriture ATOMIQUE : le contenu va dans « destination.partiel », renommé seulement une fois complet. Une exécution
  // interrompue ne laisse donc jamais un fichier chiffré tronqué sous son nom définitif ; un « .partiel » resté d'une
  // exécution précédente est remplacé. Le fichier définitif, lui, n'est jamais écrasé.
  await refuserSiExiste(destination);
  const partiel = `${destination}.partiel`;
  await rm(partiel, { force: true });
  const sortie = await open(partiel, 'wx', 0o600);
  let termine = false;
  const ecrire = async (b: Buffer) => {
    await sortie.write(b);
  };
  try {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(enTeteBrut.length);
  await ecrire(Buffer.concat([MAGIE, longueur, enTeteBrut]));

  const hache = createHash('sha256');
  let octets = 0;
  let rang = 0;
  const bloc = async (clair: Buffer, dernier: boolean) => {
    const chiffreur = createCipheriv('aes-256-gcm', cle, nonce(rang));
    chiffreur.setAAD(donneesAssociees(enTeteBrut, rang, dernier));
    const chiffre = Buffer.concat([chiffreur.update(clair), chiffreur.final()]);
    const entete = Buffer.alloc(5);
    entete.writeUInt32BE(chiffre.length);
    entete[4] = dernier ? 1 : 0;
    await ecrire(Buffer.concat([entete, chiffre, chiffreur.getAuthTag()]));
    rang++;
  };
  // Lecture avec un bloc d'avance, pour savoir lequel est le dernier (un fichier vide produit un seul bloc vide).
  let attente: Buffer | null = null;
  let tampon = Buffer.alloc(0);
  for await (const morceau of createReadStream(source, { highWaterMark: TAILLE_BLOC })) {
    hache.update(morceau as Buffer);
    octets += (morceau as Buffer).length;
    tampon = Buffer.concat([tampon, morceau as Buffer]);
    while (tampon.length >= TAILLE_BLOC) {
      if (attente) await bloc(attente, false);
      attente = tampon.subarray(0, TAILLE_BLOC);
      tampon = tampon.subarray(TAILLE_BLOC);
    }
  }
  if (tampon.length > 0) {
    if (attente) await bloc(attente, false);
    attente = tampon;
  }
  await bloc(attente ?? Buffer.alloc(0), true);
  await sortie.sync();
  termine = true;
  return { octetsClairs: octets, sha256Clair: hache.digest('hex'), destinataire: enTete.destinataire };
  } finally {
    await sortie.close();
    if (termine) await rename(partiel, destination);
    else await rm(partiel, { force: true });
  }
}

/**
 * Déchiffre `source`. Avec `destination` nul, rien n'est écrit : le fichier est seulement vérifié de bout en bout.
 * Toute altération lève une erreur ; en cas d'erreur, le fichier de sortie partiel ne doit pas être utilisé.
 */
export async function dechiffrerFichier(source: string, destination: string | null, clePriveePem: string): Promise<ResultatChiffrement> {
  const privee = createPrivateKey(clePriveePem);
  const fichier = await open(source, 'r');
  let sortie: Awaited<ReturnType<typeof open>> | null = null;
  const partiel = destination ? `${destination}.partiel` : null;
  let termine = false;
  try {
    // Même écriture atomique qu'au chiffrement : un déchiffrement refusé ou interrompu ne laisse aucun fichier de sortie.
    if (destination && partiel) {
      await refuserSiExiste(destination);
      await rm(partiel, { force: true });
      sortie = await open(partiel, 'wx', 0o600);
    }
    let position = 0;
    const lire = async (n: number): Promise<Buffer> => {
      const b = Buffer.alloc(n);
      const { bytesRead } = await fichier.read(b, 0, n, position);
      position += bytesRead;
      if (bytesRead !== n) throw new Error('Fichier chiffré tronqué');
      return b;
    };
    const debut = await lire(MAGIE.length + 4);
    if (!debut.subarray(0, MAGIE.length).equals(MAGIE)) throw new Error('Ce fichier n’est pas une sauvegarde chiffrée de ce format');
    const tailleEnTete = debut.readUInt32BE(MAGIE.length);
    if (tailleEnTete > 4096) throw new Error('En-tête invalide');
    const enTeteBrut = await lire(tailleEnTete);
    let enTete: EnTete;
    try {
      enTete = JSON.parse(enTeteBrut.toString('utf8')) as EnTete;
    } catch {
      throw new Error('En-tête illisible');
    }
    if (enTete.format !== FORMAT_SAUVEGARDE_CHIFFREE) throw new Error('Format de sauvegarde chiffrée inconnu');
    const publique = createPublicKey(privee).export({ type: 'spki', format: 'pem' }).toString();
    if (enTete.destinataire !== empreinteClePublique(publique)) throw new Error('Cette sauvegarde est chiffrée pour une autre clé');
    const ephemere = createPublicKey({ key: Buffer.from(enTete.cleEphemere, 'base64'), type: 'spki', format: 'der' });
    const cle = cleDuFichier(diffieHellman({ privateKey: privee, publicKey: ephemere }), enTete);

    const hache = createHash('sha256');
    let octets = 0;
    for (let rang = 0; ; rang++) {
      const entete = await lire(5);
      const taille = entete.readUInt32BE(0);
      const dernier = entete[4] === 1;
      if (taille > enTete.tailleBloc || entete[4]! > 1) throw new Error('Bloc invalide');
      const corps = await lire(taille + TAILLE_ETIQUETTE);
      const dechiffreur = createDecipheriv('aes-256-gcm', cle, nonce(rang));
      dechiffreur.setAAD(donneesAssociees(enTeteBrut, rang, dernier));
      dechiffreur.setAuthTag(corps.subarray(taille));
      let clair: Buffer;
      try {
        clair = Buffer.concat([dechiffreur.update(corps.subarray(0, taille)), dechiffreur.final()]);
      } catch {
        throw new Error(`Sauvegarde chiffrée altérée (bloc ${rang}) : déchiffrement refusé`);
      }
      hache.update(clair);
      octets += clair.length;
      if (sortie && clair.length) await sortie.write(clair);
      if (dernier) break;
    }
    // Rien ne doit suivre le dernier bloc.
    const reste = Buffer.alloc(1);
    if ((await fichier.read(reste, 0, 1, position)).bytesRead !== 0) throw new Error('Données inattendues après le dernier bloc');
    if (sortie) await sortie.sync();
    termine = true;
    return { octetsClairs: octets, sha256Clair: hache.digest('hex'), destinataire: enTete.destinataire };
  } finally {
    await sortie?.close();
    await fichier.close();
    if (destination && partiel) {
      if (termine) await rename(partiel, destination);
      else await rm(partiel, { force: true });
    }
  }
}

async function refuserSiExiste(chemin: string): Promise<void> {
  try {
    const f = await open(chemin, 'r');
    await f.close();
  } catch {
    return;
  }
  throw Object.assign(new Error(`EEXIST: le fichier existe déjà, il n'est jamais écrasé : ${chemin}`), { code: 'EEXIST' });
}
