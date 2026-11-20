/**
 * Suppression d'objets en fin de contrat, EXERCÉE RÉELLEMENT contre un stockage S3 d'ESSAI (D-099).
 *
 * Le test crée son propre bucket `comtaple-essai-<horodatage>` (versionné, Object Lock) dans le SeaweedFS local, le déclare
 * « essai » et le détruit à la fin. Il n'écrit, ne liste et ne supprime RIEN dans le bucket des données (`S3_BUCKET`) :
 * le nombre d'objets de ce dernier est relevé avant et après. La base est une base NEUVE jetable.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { type BaseJetable, creerBaseJetable } from '@comtaple/db/base-jetable';
import { chargerEnvLocal } from '@comtaple/db/env';
import { SuppressionObjetsIncomplete, lireRapportObjets, supprimerObjetsFinDeContratEssai } from '@comtaple/db/objets-fin-de-contrat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StockageEssaiS3 } from './stockage-essai.js';

chargerEnvLocal();
const BUCKET = `comtaple-essai-${Date.now()}`;
const REF = 'AVIS-ESSAI-OBJETS-1';
const envS3 = { S3_BUCKET: process.env.S3_BUCKET, STOCKAGE_ESSAI_BUCKET_DECLARE: BUCKET };

let base: BaseJetable;
let admin: BaseJetable['admin'];
let s3: StockageEssaiS3;
let dossier: string;
const reel = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'local', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });

async function compterReel(): Promise<number> {
  let n = 0;
  let suite: string | undefined;
  do {
    const r = await reel.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, ContinuationToken: suite }));
    n += r.KeyCount ?? 0;
    suite = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (suite);
  return n;
}
const strict = async (id: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [id])).rows[0]!.r;
interface Cab { id: string; nom: string }
async function cabinet(nom: string, finDeContratExecutee: boolean): Promise<Cab> {
  const c = (await admin.query<Cab>('insert into cabinets (nom) values ($1) returning id, nom', [`${nom} ${randomUUID().slice(0, 6)}`])).rows[0]!;
  if (finDeContratExecutee) {
    // Procès-verbal de FIXTURE : ce test n'exerce pas la fin de contrat de la base (fin-de-contrat.itest.ts), seulement l'étape des objets.
    await admin.query(`insert into fins_de_contrat (cabinet_id, nom_cabinet, executee_le, politique_version, empreinte_restitution, empreinte_proces_verbal, proces_verbal) values ($1, $2, now(), 'essai', $3, $3, '{}')`, [c.id, c.nom, 'a'.repeat(64)]);
  }
  return c;
}
const confirmer = (c: Cab) => ({ cabinetId: c.id, nom: c.nom });
const versionsDe = async (prefixe: string) => (await s3.listerVersions(prefixe)).map((v) => `${v.cle}|${v.versionId}|${v.marqueurSuppression}`).sort();

beforeAll(async () => {
  base = await creerBaseJetable('objets');
  admin = base.admin;
  s3 = new StockageEssaiS3({ endpoint: process.env.S3_ENDPOINT!, region: process.env.S3_REGION ?? 'local', accessKey: process.env.S3_ACCESS_KEY!, secretKey: process.env.S3_SECRET_KEY!, bucket: BUCKET }, envS3);
  await s3.creerBucket();
  dossier = mkdtempSync(join(tmpdir(), 'comtaple-objets-'));
}, 180_000);

afterAll(async () => {
  const r = await s3?.detruireBucketEssai(60_000).catch((e: Error) => ({ restantes: -1, erreur: e.message }));
  await base?.detruire();
  rmSync(dossier, { recursive: true, force: true });
  if (r && r.restantes !== 0) throw new Error(`Bucket d’essai non détruit : ${JSON.stringify(r)}`);
});

describe('fin de contrat : objets sur un stockage d’essai versionné', () => {
  let A: Cab;
  let B: Cab;
  let sansPv: Cab;
  const rapport = () => join(dossier, 'rapport.jsonl');
  let reelAvant: number;
  let hors: string[];
  let cabinetB: string[];

  it('prépare : versions multiples, marqueur de suppression, objet verrouillé, autre cabinet, objets voisins', async () => {
    reelAvant = await compterReel();
    A = await cabinet('Cabinet visé', true);
    B = await cabinet('Autre cabinet', true);
    sansPv = await cabinet('Sans procès-verbal', false);
    for (let i = 1; i <= 3; i++) await s3.deposer(`cabinets/${A.id}/pieces/doc1`, `version ${i}`);
    await s3.deposer(`cabinets/${A.id}/pieces/doc2`, 'deux');
    await s3.deposer(`tmp/${A.id}/televersement/1`, 'tmp');
    await s3.deposer(`cabinets/${A.id}/pieces/doc3`, 'trois');
    await s3.supprimerSansVersion(`cabinets/${A.id}/pieces/doc3`); // marqueur de suppression au-dessus d'une version
    await s3.deposer(`cabinets/${A.id}/verrou`, 'sous rétention', { mode: 'GOVERNANCE', jusquau: new Date(Date.now() + 12_000) });
    for (let i = 1; i <= 2; i++) await s3.deposer(`cabinets/${B.id}/pieces/doc1`, `B ${i}`);
    await s3.deposer(`tmp/${B.id}/x`, 'tmp B');
    await s3.deposer(`cabinets/${A.id}x/voisin`, 'préfixe voisin (même début, autre cabinet)');
    await s3.deposer('autre/racine', 'hors cabinets');
    hors = await versionsDe('autre/');
    cabinetB = [...(await versionsDe(`cabinets/${B.id}/`)), ...(await versionsDe(`tmp/${B.id}/`))];
    expect((await versionsDe(`cabinets/${A.id}/`)).length).toBe(3 + 1 + 2 + 1); // doc1×3, doc2, doc3 + marqueur, verrou (le téléversement est sous tmp/)
    expect(cabinetB).toHaveLength(3);
  });

  it('refuse sans déclaration d’essai, sans confirmation, sans procès-verbal, sans référence de validation : rien n’est supprimé', async () => {
    const avant = await versionsDe('');
    const base = { cabinetId: A.id, confirmation: confirmer(A), dureesValidees: REF };
    // Stockage non déclaré : l'instance elle-même ne peut pas exister.
    expect(() => new StockageEssaiS3({ endpoint: process.env.S3_ENDPOINT!, region: 'local', accessKey: 'x', secretKey: 'y', bucket: BUCKET }, { S3_BUCKET: process.env.S3_BUCKET })).toThrow(/aucun stockage d’essai n’est déclaré/);
    // Le bucket des données réelles est refusé même s'il est « déclaré ».
    expect(() => new StockageEssaiS3({ endpoint: process.env.S3_ENDPOINT!, region: 'local', accessKey: 'x', secretKey: 'y', bucket: process.env.S3_BUCKET! }, { S3_BUCKET: process.env.S3_BUCKET, STOCKAGE_ESSAI_BUCKET_DECLARE: process.env.S3_BUCKET })).toThrow(/n’est pas un bucket d’essai/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { ...base, confirmation: undefined })).rejects.toThrow(/confirmation absente/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { ...base, confirmation: { cabinetId: A.id, nom: 'autre' } })).rejects.toThrow(/confirmation absente ou ne nommant pas/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { ...base, dureesValidees: undefined })).rejects.toThrow(/ne sont pas déclarées validées/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { ...base, dureesValidees: 'oui' })).rejects.toThrow(/référence de validation exploitable/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: sansPv.id, confirmation: confirmer(sansPv), dureesValidees: REF })).rejects.toThrow(/n’a pas été exécutée en base/);
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { ...base, cabinetId: 'pas-un-uuid' })).rejects.toThrow(/invalide/);
    expect(await versionsDe('')).toEqual(avant);
  });

  it('interruption après 3 versions : les autres sont intactes ; le rapport garde les 3 premières', async () => {
    let n = 0;
    await expect(
      supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: A.id, confirmation: confirmer(A), dureesValidees: REF, fichierRapport: rapport(), surObjet: () => { if (++n === 3) throw new Error('interruption simulée'); } }),
    ).rejects.toThrow(/interruption simulée/);
    const l = lireRapportObjets(rapport());
    expect(l).toHaveLength(3);
    expect(l.every((x) => x.resultat === 'supprimee' && x.passage === 1 && x.cle.startsWith(`cabinets/${A.id}/`))).toBe(true);
    const restantes = [...(await versionsDe(`cabinets/${A.id}/`)), ...(await versionsDe(`tmp/${A.id}/`))];
    expect(restantes.length).toBe(8 - 3);
    expect([...(await versionsDe(`cabinets/${B.id}/`)), ...(await versionsDe(`tmp/${B.id}/`))]).toEqual(cabinetB);
  });

  it('reprise : tout est supprimé SAUF la version verrouillée (échec propre, jamais de contournement) ; autres cabinets intacts', async () => {
    const e = await supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: A.id, confirmation: confirmer(A), dureesValidees: REF, fichierRapport: rapport() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SuppressionObjetsIncomplete);
    const r = (e as SuppressionObjetsIncomplete).rapport;
    expect(r).toMatchObject({ bucket: BUCKET, passage: 2, trouvees: 5, supprimees: 4, verrouillees: 1, erreurs: 0, restantes: 1, complet: false });
    expect(r.lignes).toHaveLength(3 + 5); // rapport CUMULÉ : passage 1 puis passage 2
    const verrou = r.lignes.find((x) => x.resultat === 'verrouillee')!;
    expect(verrou).toMatchObject({ cle: `cabinets/${A.id}/verrou`, passage: 2 });
    expect(verrou.detail).toMatch(/GOVERNANCE jusqu’au/);
    // La version verrouillée existe toujours et se relit ; rien d'autre ne subsiste pour A.
    expect(await versionsDe(`cabinets/${A.id}/`)).toHaveLength(1);
    expect(await versionsDe(`tmp/${A.id}/`)).toEqual([]);
    // Autres cabinets, voisin de préfixe et objets hors cabinets : INTACTS.
    expect([...(await versionsDe(`cabinets/${B.id}/`)), ...(await versionsDe(`tmp/${B.id}/`))]).toEqual(cabinetB);
    expect(await versionsDe(`cabinets/${A.id}x/`)).toHaveLength(1);
    expect(await versionsDe('autre/')).toEqual(hors);
    // Journal : une ligne par passage, chaîne intacte.
    const lignes = (await admin.query<{ details: Record<string, unknown> }>(`select details from journal_audit where cabinet_id = $1 and action = 'fin_de_contrat.objets_supprimes' order by id`, [A.id])).rows;
    expect(lignes).toHaveLength(1); // le passage 1 interrompu n'a pas atteint le journal
    expect(lignes[0]!.details).toMatchObject({ stockage: 'essai', bucket: BUCKET, passage: 2, verrouillees: 1, restantes: 1, dureesValidees: REF });
    expect(await strict(A.id)).toBeNull();
  });

  it('après l’échéance du verrou : la reprise termine ; rapport complet ; rejouée, elle est idempotente', async () => {
    await new Promise((ok) => setTimeout(ok, 13_000)); // rétention de 12 s
    const r = await supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: A.id, confirmation: confirmer(A), dureesValidees: REF, fichierRapport: rapport() });
    expect(r).toMatchObject({ passage: 3, trouvees: 1, supprimees: 1, verrouillees: 0, restantes: 0, complet: true });
    expect(r.lignes).toHaveLength(3 + 5 + 1);
    // Rapport par objet : chaque version traitée (clé, version, taille, résultat, date) ; aucune ligne d'un autre cabinet.
    const toutes = lireRapportObjets(rapport());
    expect(toutes.every((x) => x.cle.startsWith(`cabinets/${A.id}/`) || x.cle.startsWith(`tmp/${A.id}/`))).toBe(true);
    expect(toutes.filter((x) => x.resultat === 'supprimee')).toHaveLength(8);
    expect(toutes.some((x) => x.marqueurSuppression)).toBe(true);
    expect(toutes.filter((x) => x.cle.endsWith('/pieces/doc1'))).toHaveLength(3);
    // 8 versions distinctes ; la version verrouillée figure deux fois (refusée au passage 2, supprimée au passage 3).
    expect(new Set(toutes.map((x) => `${x.cle}|${x.versionId}`)).size).toBe(toutes.length - 1);
    expect(existsSync(rapport())).toBe(true);
    // Idempotence.
    const encore = await supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: A.id, confirmation: confirmer(A), dureesValidees: REF, fichierRapport: rapport() });
    expect(encore).toMatchObject({ passage: 4, trouvees: 0, supprimees: 0, restantes: 0, complet: true });
    expect(await versionsDe(`cabinets/${A.id}/`)).toEqual([]);
    expect([...(await versionsDe(`cabinets/${B.id}/`)), ...(await versionsDe(`tmp/${B.id}/`))]).toEqual(cabinetB);
    expect(await strict(A.id)).toBeNull();
  });

  it('le cabinet témoin sans procès-verbal reste refusé ; le bucket des données n’a pas bougé d’un seul objet', async () => {
    await expect(supprimerObjetsFinDeContratEssai(admin, s3, { cabinetId: sansPv.id, confirmation: confirmer(sansPv), dureesValidees: REF })).rejects.toThrow(/n’a pas été exécutée en base/);
    expect(await compterReel()).toBe(reelAvant);
    expect(readFileSync(rapport(), 'utf8').split('\n').filter(Boolean).length).toBe(3 + 5 + 1);
  });
});
