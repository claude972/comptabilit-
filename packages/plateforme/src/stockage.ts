import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Config } from './config.js';
import { avecSpan } from './traces.js';

/** Span d'une opération de stockage : opération, taille, décompte. JAMAIS la clé de l'objet. */
const suivre = <T>(operation: string, attributs: Record<string, unknown>, fn: (noter: (a: Record<string, unknown>) => void) => Promise<T>): Promise<T> =>
  avecSpan(`stockage ${operation}`, { genre: 'client', attributs: { 'comtaple.stockage.operation': operation, ...attributs } }, fn);

/** Stockage documentaire compatible S3. Les originaux sont adressés par empreinte et ne sont jamais réécrits. */
export class Stockage {
  private readonly s3: S3Client;
  constructor(private readonly cfg: Pick<Config, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY'>) {
    this.s3 = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
    });
  }

  async assurerBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    }
  }

  async deposer(cle: string, corps: Buffer | Uint8Array, typeMime?: string): Promise<void> {
    await suivre('deposer', { 'comtaple.taille_octets': corps.length }, () => this.s3.send(new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: cle, Body: corps, ContentType: typeMime })));
  }

  async deposerFlux(cle: string, flux: Readable, typeMime?: string): Promise<void> {
    await suivre('deposer-flux', {}, () => new Upload({ client: this.s3, params: { Bucket: this.cfg.S3_BUCKET, Key: cle, Body: flux, ContentType: typeMime } }).done());
  }

  async lireFlux(cle: string): Promise<Readable> {
    // Le span couvre l'ouverture de la lecture (réponse du stockage), pas la consommation du flux par l'appelant.
    const r = await suivre('lire', {}, () => this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: cle })));
    if (!r.Body) throw new Error(`Objet vide : ${cle}`);
    return r.Body as Readable;
  }

  async lire(cle: string, tailleMax: number): Promise<Buffer> {
    const flux = await this.lireFlux(cle);
    const morceaux: Buffer[] = [];
    let total = 0;
    for await (const m of flux) {
      const b = Buffer.from(m as Uint8Array);
      total += b.length;
      if (total > tailleMax) {
        flux.destroy();
        throw new Error(`Objet plus volumineux que la limite autorisée (${tailleMax} octets)`);
      }
      morceaux.push(b);
    }
    return Buffer.concat(morceaux);
  }

  /** Lit seulement le DÉBUT d'un objet (requête par plage) : pour un aperçu, sans charger le fichier. */
  async lireDebut(cle: string, octets: number): Promise<Buffer> {
    const r = await suivre('lire-debut', {}, () => this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: cle, Range: `bytes=0-${Math.max(0, octets - 1)}` })));
    if (!r.Body) return Buffer.alloc(0);
    const morceaux: Buffer[] = [];
    let total = 0;
    for await (const m of r.Body as Readable) {
      const b = Buffer.from(m as Uint8Array);
      morceaux.push(b);
      total += b.length;
      // Garde-fou si le stockage ignore la plage demandée.
      if (total >= octets) {
        (r.Body as Readable).destroy();
        break;
      }
    }
    return Buffer.concat(morceaux).subarray(0, octets);
  }

  async existe(cle: string): Promise<boolean> {
    try {
      // L'absence de l'objet est une réponse, pas une erreur : elle est absorbée dans le span.
      return await suivre('existe', {}, () =>
        this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: cle })).then(
          () => true,
          () => false,
        ),
      );
    } catch {
      return false;
    }
  }

  async lister(prefixe: string): Promise<string[]> {
    const cles: string[] = [];
    let suite: string | undefined;
    do {
      const page = suite;
      const r = await suivre('lister', {}, async (noter) => {
        const p = await this.s3.send(new ListObjectsV2Command({ Bucket: this.cfg.S3_BUCKET, Prefix: prefixe, ContinuationToken: page }));
        noter({ 'comtaple.decompte': p.Contents?.length ?? 0 });
        return p;
      });
      for (const o of r.Contents ?? []) if (o.Key) cles.push(o.Key);
      suite = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (suite);
    return cles.sort();
  }

  async supprimer(cles: string[]): Promise<void> {
    for (let i = 0; i < cles.length; i += 500) {
      const lot = cles.slice(i, i + 500);
      if (lot.length) {
        await suivre('supprimer', { 'comtaple.decompte': lot.length }, () => this.s3.send(new DeleteObjectsCommand({ Bucket: this.cfg.S3_BUCKET, Delete: { Objects: lot.map((Key) => ({ Key })) } })));
      }
    }
  }

  /**
   * Assemble des morceaux (dans l'ordre des clés) en un objet final, en calculant taille et SHA-256 au passage.
   * L'appelant compare l'empreinte à celle annoncée avant de considérer le fichier comme reçu.
   */
  async assembler(clesMorceaux: string[], cleFinale: string, typeMime?: string): Promise<{ taille: number; sha256: string }> {
    const hache = createHash('sha256');
    let taille = 0;
    const self = this;
    async function* generer(): AsyncGenerator<Buffer> {
      for (const cle of clesMorceaux) {
        const flux = await self.lireFlux(cle);
        for await (const m of flux) {
          const b = Buffer.from(m as Uint8Array);
          hache.update(b);
          taille += b.length;
          yield b;
        }
      }
    }
    return suivre('assembler', { 'comtaple.decompte': clesMorceaux.length }, async (noter) => {
      await this.deposerFlux(cleFinale, Readable.from(generer()), typeMime);
      noter({ 'comtaple.taille_octets': taille });
      return { taille, sha256: hache.digest('hex') };
    });
  }
}

export const cles = {
  morceau: (cabinetId: string, televersementId: string, decalage: number) =>
    `tmp/${cabinetId}/${televersementId}/${String(decalage).padStart(14, '0')}`,
  prefixeMorceaux: (cabinetId: string, televersementId: string) => `tmp/${cabinetId}/${televersementId}/`,
  assemblage: (cabinetId: string, televersementId: string) => `tmp/${cabinetId}/${televersementId}.assemble`,
  original: (cabinetId: string, sha256: string) => `cabinets/${cabinetId}/originaux/${sha256.slice(0, 2)}/${sha256}`,
  derive: (cabinetId: string, fichierId: string, nom: string) => `cabinets/${cabinetId}/derives/${fichierId}/${nom}`,
  export: (cabinetId: string, nom: string) => `cabinets/${cabinetId}/exports/${nom}`,
  restitution: (cabinetId: string, id: string) => `cabinets/${cabinetId}/restitutions/${id}.zip`,
  restitutionCabinet: (cabinetId: string, id: string) => `cabinets/${cabinetId}/restitutions/cabinet-${id}.zip`,
};
