/**
 * Stockage objet D'ESSAI versionné pour la fin de contrat (D-099).
 *
 * Implémente `StockageEssaiVersionne` (@comtaple/db/objets-fin-de-contrat) sur S3. Il est conçu pour NE JAMAIS pouvoir
 * viser le stockage des données : chaque opération vérifie d'abord (`verifierEssai`) que le bucket
 *   1. est nommé `comtaple-essai-…` ;
 *   2. est DÉCLARÉ « essai » par la variable dédiée `STOCKAGE_ESSAI_BUCKET_DECLARE` (même nom, exactement) ;
 *   3. est DISTINCT du bucket réel (`S3_BUCKET`), comparé sans tenir compte de la casse.
 * Si l'une des trois conditions manque, l'opération est refusée avant tout appel au stockage. Aucune suppression ne
 * demande à contourner un verrouillage d'objet (`BypassGovernanceRetention` n'est jamais envoyé).
 */
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface ConfigStockageEssai {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}
export interface EnvStockageEssai {
  /** Bucket du stockage des données (S3_BUCKET) : jamais visé. */
  S3_BUCKET?: string;
  /** Déclaration explicite du bucket d'essai. */
  STOCKAGE_ESSAI_BUCKET_DECLARE?: string;
}

const NOM_ESSAI = /^comtaple-essai-[a-z0-9][a-z0-9-]{3,40}$/;

/** Vérifie la déclaration « essai » d'un bucket ; lève sinon. Pure : aucun appel réseau. */
export function exigerBucketEssai(bucket: string, env: EnvStockageEssai = process.env): void {
  if (!NOM_ESSAI.test(bucket)) throw new Error(`Refus : « ${bucket} » n’est pas un bucket d’essai (nom attendu : comtaple-essai-…).`);
  const declare = env.STOCKAGE_ESSAI_BUCKET_DECLARE;
  if (!declare) throw new Error('Refus : aucun stockage d’essai n’est déclaré (variable STOCKAGE_ESSAI_BUCKET_DECLARE absente). La suppression d’objets ne vise qu’un stockage explicitement déclaré « essai ».');
  if (declare !== bucket) throw new Error(`Refus : le bucket « ${bucket} » n’est pas celui déclaré d’essai (« ${declare} »).`);
  const reel = env.S3_BUCKET;
  if (!reel) throw new Error('Refus : le bucket réel (S3_BUCKET) n’est pas connu, la distinction avec le bucket d’essai ne peut pas être établie.');
  if (reel.toLowerCase() === bucket.toLowerCase()) throw new Error(`Refus : le bucket d’essai « ${bucket} » est le bucket des données réelles.`);
}

export class StockageEssaiS3 {
  readonly bucket: string;
  private readonly s3: S3Client;
  constructor(cfg: ConfigStockageEssai, private readonly env: EnvStockageEssai = process.env) {
    this.bucket = cfg.bucket;
    exigerBucketEssai(cfg.bucket, env); // dès la construction : aucune instance ne peut viser un autre bucket
    this.s3 = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } });
  }

  async verifierEssai(): Promise<void> {
    exigerBucketEssai(this.bucket, this.env);
  }

  /** Crée le bucket d'essai, avec Object Lock et versionnement (essais seulement). */
  async creerBucket(): Promise<void> {
    await this.verifierEssai();
    await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket, ObjectLockEnabledForBucket: true }));
    await this.s3.send(new PutBucketVersioningCommand({ Bucket: this.bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  }

  async deposer(cle: string, corps: Buffer | string, verrou?: { mode: 'GOVERNANCE' | 'COMPLIANCE'; jusquau: Date }): Promise<string | null> {
    await this.verifierEssai();
    const r = await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: cle, Body: corps, ...(verrou ? { ObjectLockMode: verrou.mode, ObjectLockRetainUntilDate: verrou.jusquau } : {}) }));
    return r.VersionId ?? null;
  }

  async listerVersions(prefixe: string): Promise<Array<{ cle: string; versionId: string | null; marqueurSuppression: boolean; taille: number }>> {
    await this.verifierEssai();
    const sortie: Array<{ cle: string; versionId: string | null; marqueurSuppression: boolean; taille: number }> = [];
    let cleSuite: string | undefined;
    let versionSuite: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: prefixe, KeyMarker: cleSuite, VersionIdMarker: versionSuite }));
      for (const v of r.Versions ?? []) if (v.Key) sortie.push({ cle: v.Key, versionId: v.VersionId && v.VersionId !== 'null' ? v.VersionId : null, marqueurSuppression: false, taille: Number(v.Size ?? 0) });
      for (const m of r.DeleteMarkers ?? []) if (m.Key) sortie.push({ cle: m.Key, versionId: m.VersionId && m.VersionId !== 'null' ? m.VersionId : null, marqueurSuppression: true, taille: 0 });
      cleSuite = r.IsTruncated ? r.NextKeyMarker : undefined;
      versionSuite = r.IsTruncated ? r.NextVersionIdMarker : undefined;
    } while (cleSuite);
    return sortie;
  }

  /** Dépose un marqueur de suppression (suppression « douce » d'un objet versionné) : sert à l'essai. */
  async supprimerSansVersion(cle: string): Promise<void> {
    await this.verifierEssai();
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: cle }));
  }

  /** Supprime UNE version. Un verrouillage (Object Lock) est rapporté, jamais contourné. */
  async supprimerVersion(cle: string, versionId: string | null): Promise<{ resultat: 'supprimee' | 'deja_absente' | 'verrouillee' | 'erreur'; detail?: string }> {
    await this.verifierEssai();
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: cle, ...(versionId ? { VersionId: versionId } : {}) }));
      return { resultat: 'supprimee' };
    } catch (e) {
      const nom = (e as { name?: string }).name ?? '';
      if (nom === 'NoSuchVersion' || nom === 'NoSuchKey') return { resultat: 'deja_absente' };
      if (nom === 'AccessDenied') {
        // Un refus d'accès n'est rapporté « verrouillée » que si le stockage confirme un verrouillage de cette version.
        try {
          const h = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: cle, ...(versionId ? { VersionId: versionId } : {}) }));
          const jusquau = h.ObjectLockRetainUntilDate?.toISOString();
          const enAttente = h.ObjectLockRetainUntilDate && h.ObjectLockRetainUntilDate.getTime() > Date.now();
          if (enAttente || h.ObjectLockLegalHoldStatus === 'ON') return { resultat: 'verrouillee', detail: `${h.ObjectLockMode ?? 'mise en suspens légale'}${jusquau ? ` jusqu’au ${jusquau}` : ''}${h.ObjectLockLegalHoldStatus === 'ON' ? ' ; suspension légale active' : ''}` };
        } catch {
          // la lecture des métadonnées échoue aussi : refus non expliqué
        }
        return { resultat: 'erreur', detail: 'AccessDenied sans verrouillage constaté' };
      }
      return { resultat: 'erreur', detail: `${nom}: ${(e as Error).message}` };
    }
  }

  /**
   * Détruit le bucket d'ESSAI et tout ce qu'il contient (versions, marqueurs) : nettoyage du test qui l'a créé.
   * Un objet encore sous rétention fait attendre son échéance : aucun contournement.
   */
  async detruireBucketEssai(attenteMaxMs = 30_000): Promise<{ restantes: number }> {
    await this.verifierEssai();
    const fin = Date.now() + attenteMaxMs;
    for (;;) {
      const versions = await this.listerVersions('');
      let restantes = 0;
      for (const v of versions) {
        const r = await this.supprimerVersion(v.cle, v.versionId);
        if (r.resultat === 'verrouillee' || r.resultat === 'erreur') restantes++;
      }
      if (!restantes) break;
      if (Date.now() > fin) return { restantes };
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    await this.s3.send(new DeleteBucketCommand({ Bucket: this.bucket }));
    return { restantes: 0 };
  }
}
