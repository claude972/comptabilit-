/**
 * CYCLE COMPLET de fin de contrat et de conservation, de bout en bout, sur des RESSOURCES JETABLES (D-100).
 *
 * Tout ce que ce test écrit ou détruit, il l'a créé lui-même et le supprime à la fin :
 *  - une base PostgreSQL neuve `comtaple_essai_cycle_…` (migrations rejouées) ;
 *  - un bucket S3 d'essai versionné avec Object Lock `comtaple-essai-…` dans le SeaweedFS local ;
 *  - un royaume Keycloak d'essai `essai-fin-contrat-…` ;
 *  - un répertoire de sauvegardes d'essai (jeux factices, dépôt d'objets adressés par empreinte), distinct de `var/sauvegardes`.
 * Rien n'est lu ni écrit dans la base « comtaple », le bucket des données, le royaume de développement ni `var/sauvegardes` :
 * leurs décomptes sont relevés avant et après. Le temps est avancé par le paramètre `aujourdhui`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { type BaseJetable, creerBaseJetable } from '@comtaple/db/base-jetable';
import { type CertificatDestruction, verifierCertificat } from '@comtaple/db/destruction-terme';
import { PARAMETRES_PROPOSES, type ParametresDurees, chargerParametres } from '@comtaple/db/durees-conservation';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Cabinet, creerPeuplement } from '@comtaple/db/peuplement-essai';
import { OFFRES_DEMO, POLITIQUE_FIN_DE_CONTRAT, definirOffre } from '@comtaple/db/provisionnement';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArretBrutal, ETAPES_CYCLE, type OptionsCycle, avancerCycle, cheminsCycle, lireEtatCycle, rendreCycleLisible } from './cycle-fin-de-vie.js';
import { FournisseurIdentiteEssai } from './fournisseur-identite-essai.js';
import { preparerRepertoireEssai } from './rotation-sauvegardes.js';
import { StockageEssaiS3 } from './stockage-essai.js';

chargerEnvLocal();
const REF = 'AVIS-ESSAI-CYCLE-1';
const BUCKET = `comtaple-essai-${Date.now()}`;
const ROYAUME = `essai-fin-contrat-${Date.now()}`;
const URL_KC = new URL(process.env.OIDC_ISSUER!).origin;
const envEssai = { ...process.env, S3_BUCKET: process.env.S3_BUCKET, STOCKAGE_ESSAI_BUCKET_DECLARE: BUCKET, KEYCLOAK_ROYAUME_ESSAI_DECLARE: ROYAUME };

let base: BaseJetable;
let admin: BaseJetable['admin'];
let P: ReturnType<typeof creerPeuplement>;
let s3: StockageEssaiS3;
let kc: FournisseurIdentiteEssai;
let dossier: string;
let royaumeCree = false;
let chargees: ReturnType<typeof chargerParametres>;
const reel = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'local', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });

async function compterBucketReel(): Promise<number> {
  let n = 0;
  let suite: string | undefined;
  do {
    const r = await reel.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, ContinuationToken: suite }));
    n += r.KeyCount ?? 0;
    suite = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (suite);
  return n;
}
async function comptesDuRoyaumeDeDev(): Promise<number> {
  const t = await fetch(`${URL_KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KC_ADMIN_USER!, password: process.env.KC_ADMIN_PASSWORD! }) });
  const jeton = ((await t.json()) as { access_token: string }).access_token;
  return Number(await (await fetch(`${URL_KC}/admin/realms/comtaple/users/count`, { headers: { authorization: `Bearer ${jeton}` } })).text());
}
const jour = async (n: number) => (await admin.query<{ d: string }>('select (current_date + $1::int)::text as d', [n])).rows[0]!.d;
const nb = async (table: string, id: string) => Number((await admin.query<{ n: string }>(`select count(*)::text as n from "${table}" where cabinet_id = $1`, [id])).rows[0]!.n);
async function empreinteCabinet(id: string): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const t of P.tablesCabinet) r[t] = (await admin.query<{ e: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(h, '' order by h)), '') as e from (select md5(x::text) as h from "${t}" x where cabinet_id = $1) s`, [id])).rows[0]!.e;
  return r;
}
const versionsDe = async (prefixe: string) => (await s3.listerVersions(prefixe)).map((v) => `${v.cle}|${v.versionId}|${v.marqueurSuppression}`).sort();
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const confirmer = (c: Cabinet) => ({ cabinetId: c.id, nom: c.nom });

/** Un jeu de sauvegarde factice : base, manifeste d'objets, export Keycloak, descripteur. */
function ecrireJeu(d: string, id: string, objets: Array<{ cle: string; sha256: string }>): void {
  for (const [s, c] of [['dump', `base ${id}`], ['dump.sha256', 'x'], ['objets.json', JSON.stringify({ objets })], ['objets.json.sha256', 'x'], ['keycloak.json', '{}'], ['keycloak.json.sha256', 'x'], ['jeu.json', '{}']] as const) writeFileSync(join(d, `${id}.${s}`), c);
}
function ecrireBlob(d: string, contenu: string): string {
  const h = sha(contenu);
  mkdirSync(join(d, 'objets', h.slice(0, 2)), { recursive: true });
  writeFileSync(join(d, 'objets', h.slice(0, 2), h), contenu);
  return h;
}
const blobsPresents = (d: string): string[] => (existsSync(join(d, 'objets')) ? readdirSync(join(d, 'objets'), { withFileTypes: true }).filter((x) => x.isDirectory()).flatMap((x) => readdirSync(join(d, 'objets', x.name))) : []).sort();

beforeAll(async () => {
  base = await creerBaseJetable('cycle');
  admin = base.admin;
  for (const o of OFFRES_DEMO) await definirOffre(admin, o);
  P = creerPeuplement(admin);
  await P.lireCatalogue();
  dossier = mkdtempSync(join(tmpdir(), 'comtaple-cycle-'));
  s3 = new StockageEssaiS3({ endpoint: process.env.S3_ENDPOINT!, region: process.env.S3_REGION ?? 'local', accessKey: process.env.S3_ACCESS_KEY!, secretKey: process.env.S3_SECRET_KEY!, bucket: BUCKET }, envEssai);
  await s3.creerBucket();
  kc = new FournisseurIdentiteEssai({ url: URL_KC, royaume: ROYAUME, adminUtilisateur: process.env.KC_ADMIN_USER!, adminMotDePasse: process.env.KC_ADMIN_PASSWORD! }, envEssai);
  await kc.creerRoyaume();
  royaumeCree = true;
  const p = JSON.parse(JSON.stringify(PARAMETRES_PROPOSES)) as ParametresDurees;
  p.version = 'essai-cycle';
  p.statut = 'VALIDÉE';
  p.validation = { reference: REF, date: '2026-11-20', par: 'essai' };
  p.categories.traces_ia!.duree = { jours: 5 };
  p.categories.abonnement_facturation!.duree = { jours: 30 };
  p.categories.restitutions_cabinet!.duree = { jours: 400 };
  p.categories.politiques_conservation!.duree = { jours: 600 };
  p.categories.fin_de_contrat!.duree = { jours: 700 };
  p.categories.journal_audit!.duree = { jours: 30 };
  p.sauvegardes = { retentionJours: 365, jeuxMinimumConserves: 1 };
  p.comptes = { delaiDesactivationJours: 0, delaiSuppressionApresDesactivationJours: 200 };
  const chemin = join(dossier, 'jeu.json');
  writeFileSync(chemin, JSON.stringify(p));
  chargees = chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories, chemin);
}, 240_000);

afterAll(async () => {
  const r = await s3?.detruireBucketEssai(60_000).catch((e: Error) => ({ restantes: -1, erreur: e.message }));
  if (royaumeCree) await kc.supprimerRoyaume();
  await base?.detruire();
  rmSync(dossier, { recursive: true, force: true });
  if (r && r.restantes !== 0) throw new Error(`Bucket d’essai non détruit : ${JSON.stringify(r)}`);
  if (royaumeCree && (await kc.royaumeExiste())) throw new Error('Royaume d’essai non supprimé');
});

describe('garde-fous du cycle et attente du délai de grâce', () => {
  it('refuse une confirmation inexacte ; attend la fin du délai de grâce sans rien supprimer ; refuse un répertoire de sauvegardes non déclaré d’essai', async () => {
    const c = await P.pret('Grace');
    await admin.query(`update abonnements set fin = current_date - 10 where cabinet_id = $1`, [c.id]);
    await P.restituer(c);
    const avant = await empreinteCabinet(c.id);
    const options = (extra: Partial<OptionsCycle> = {}): OptionsCycle => ({ cabinetId: c.id, confirmation: confirmer(c), parametres: chargees, dureesValidees: REF, aujourdhui: '2026-12-01', repertoire: join(dossier, `grace-${c.id}`), ports: {}, env: process.env, ...extra });
    await expect(avancerCycle(admin, options({ confirmation: { cabinetId: c.id, nom: 'Autre' } }))).rejects.toThrow(/ne nomme pas exactement/);
    const r = await avancerCycle(admin, options());
    expect(r.arret).toMatchObject({ etape: 'base', statut: 'attente', prochaine: await jour(80) });
    expect(r.arret!.raison).toMatch(/délai de grâce/);
    expect(r.etat.etapes.comptes_plan.statut).toBe('fait');
    expect(await empreinteCabinet(c.id)).toEqual(avant);
    expect(rendreCycleLisible(r.etat, '2026-12-01')).toMatch(/\[…\] Fin de contrat en base.*en attente\n\s+délai de grâce en cours.*rappeler à partir du \d{2}\/\d{2}\/\d{4}/);
    // Rappelé sans changement : même attente, aucun effet.
    expect((await avancerCycle(admin, options())).arret).toMatchObject({ etape: 'base', statut: 'attente' });
    expect(await empreinteCabinet(c.id)).toEqual(avant);
    // Référence de validation absente : la fin de contrat est refusée (huitième pré-condition), l'étape est en ÉCHEC, rien n'est modifié.
    const sansRef = await avancerCycle(admin, options({ dureesValidees: '', repertoire: join(dossier, 'sans-ref') }));
    expect(sansRef.arret).toMatchObject({ etape: 'base', statut: 'echec' });
    expect(sansRef.arret!.raison).toMatch(/fin de contrat refusée/);
    expect(await empreinteCabinet(c.id)).toEqual(avant);
  });
});

describe('cycle complet, interrompu, repris, avec attente de chaque échéance', () => {
  let A: Cabinet;
  let B: Cabinet;
  let reelAvant = 0;
  let devAvant = 0;
  let empB: Record<string, string> = {};
  let hors: string[] = [];
  let objetsB: string[] = [];
  let sauv: string;
  let blobA = '';
  let blobB = '';
  let blobOrphelin = '';
  let T: Record<string, string> = {};
  let comptesKc: { seul: { id: string; sujet: string }; partage: { id: string; sujet: string }; passant: string } | undefined;
  let kcAvantB: string[] = [];
  let blocage = 0;
  let injecter = false;
  const rep = () => join(dossier, 'cycle');
  const opt = (aujourdhui: string, extra: Partial<OptionsCycle> = {}): OptionsCycle => ({
    cabinetId: A.id,
    confirmation: confirmer(A),
    parametres: chargees,
    dureesValidees: REF,
    aujourdhui,
    repertoire: rep(),
    ports: { objets: s3, identite: kc, sauvegardes: { repertoire: sauv, repertoireReel: join(process.cwd(), '..', '..', 'var', 'sauvegardes') } },
    env: process.env,
    ...extra,
  });
  const etape = (n: (typeof ETAPES_CYCLE)[number]) => lireEtatCycle(rep(), A.id)!.etapes[n];

  it('prépare : deux cabinets, comptes Keycloak, objets (dont un sous verrou), sauvegardes factices', async () => {
    reelAvant = await compterBucketReel();
    devAvant = await comptesDuRoyaumeDeDev();
    A = await P.pret('Cabinet visé');
    B = await P.pret('Cabinet voisin');
    const creer = async (nom: string, membres: string[]) => {
      const email = `${nom}-${randomUUID().slice(0, 6)}@exemple.test`;
      const sujet = await kc.creerUtilisateur(`${nom}-${randomUUID().slice(0, 6)}`, email);
      const id = (await admin.query<{ id: string }>('insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) returning id', [sujet, email, nom])).rows[0]!.id;
      for (const m of membres) await admin.query(`insert into appartenances (cabinet_id, utilisateur_id, role) values ($1, $2, 'collaborateur')`, [m, id]);
      return { id, sujet };
    };
    comptesKc = { seul: await creer('seul', [A.id]), partage: await creer('partage', [A.id, B.id]), passant: await kc.creerUtilisateur(`passant-${randomUUID().slice(0, 6)}`, `passant-${randomUUID().slice(0, 6)}@exemple.test`) };
    kcAvantB = (await kc.lister()).filter((u) => u.id === comptesKc!.partage.sujet || u.id === comptesKc!.passant).map((u) => `${u.id}:${u.enabled}`).sort();
    await P.restituer(A);
    await P.restituer(B);
    // Objets : plusieurs versions, un marqueur, un objet sous rétention GOUVERNANCE de 12 s, cabinet voisin, hors cabinets.
    await s3.deposer(`cabinets/${A.id}/pieces/doc1`, 'v1');
    await s3.deposer(`cabinets/${A.id}/pieces/doc1`, 'v2');
    await s3.deposer(`cabinets/${A.id}/pieces/doc2`, 'deux');
    await s3.deposer(`tmp/${A.id}/t`, 'tmp');
    await s3.deposer(`cabinets/${A.id}/pieces/doc3`, 'trois');
    await s3.supprimerSansVersion(`cabinets/${A.id}/pieces/doc3`);
    await s3.deposer(`cabinets/${A.id}/verrou`, 'sous rétention', { mode: 'GOVERNANCE', jusquau: new Date(Date.now() + 12_000) });
    await s3.deposer(`cabinets/${B.id}/pieces/doc1`, 'B');
    await s3.deposer('autre/racine', 'hors cabinets');
    hors = await versionsDe('autre/');
    objetsB = await versionsDe(`cabinets/${B.id}/`);
    // Sauvegardes factices : J1 ancien, J2 d'hier (contient le cabinet), J3 postérieur (propre) ; un fichier étranger dans objets/.
    sauv = join(dossier, 'sauvegardes-essai');
    preparerRepertoireEssai(sauv);
    blobA = ecrireBlob(sauv, `pièce du cabinet ${A.id}`);
    blobB = ecrireBlob(sauv, `pièce du cabinet voisin ${B.id}`);
    blobOrphelin = ecrireBlob(sauv, 'objet déjà orphelin');
    writeFileSync(join(sauv, 'objets', 'LISEZMOI.txt'), 'à ne pas toucher');
    const jours = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));
    ecrireJeu(sauv, 'comtaple-20260101-010101', [{ cle: `cabinets/${A.id}/pieces/doc1`, sha256: blobA }]);
    ecrireJeu(sauv, `comtaple-${jours(-1)}-010101`, [{ cle: `cabinets/${A.id}/pieces/doc1`, sha256: blobA }, { cle: `cabinets/${B.id}/pieces/doc1`, sha256: blobB }]);
    ecrireJeu(sauv, `comtaple-${jours(3)}-010101`, [{ cle: `cabinets/${B.id}/pieces/doc1`, sha256: blobB }]);
    empB = await empreinteCabinet(B.id);
    T = { t0: await jour(0), t2: await jour(95), t5: await jour(370), t6: await jour(410), t7: await jour(710) };
    expect(blobsPresents(sauv)).toHaveLength(3);
  });

  it('passage 1 : arrêt brutal PENDANT la suppression des objets ; l’état garde l’étape « en cours », le plan des comptes est conservé', async () => {
    const aveugle = Object.create(s3) as StockageEssaiS3;
    aveugle.supprimerVersion = async (cle, v) => {
      if (++blocage === 3) throw new ArretBrutal('processus tué pendant la suppression');
      return s3.supprimerVersion(cle, v);
    };
    await expect(avancerCycle(admin, opt(T.t0!, { ports: { ...opt(T.t0!).ports, objets: aveugle } }))).rejects.toBeInstanceOf(ArretBrutal);
    const e = lireEtatCycle(rep(), A.id)!;
    expect(e.etapes.comptes_plan.statut).toBe('fait');
    expect(e.etapes.base.statut).toBe('fait');
    expect(e.etapes.objets).toMatchObject({ statut: 'en_cours', tentatives: 1 });
    expect(e.plan!.comptes.map((c) => c.sujetOidc)).toContain(comptesKc!.seul.sujet);
    expect(await nb('lignes_ecriture', A.id)).toBe(0); // la fin de contrat en base est faite
    expect((await versionsDe(`cabinets/${A.id}/`)).length).toBeGreaterThan(0); // la suppression des objets est commencée, pas finie
  });

  it('passage 2 (reprise) : le plan n’est pas refait ; les objets sont supprimés sauf la version sous verrou : attente jusqu’à son échéance', async () => {
    const planAvant = JSON.stringify(lireEtatCycle(rep(), A.id)!.plan);
    const r = await avancerCycle(admin, opt(T.t0!));
    expect(r.arret).toMatchObject({ etape: 'objets', statut: 'attente' });
    expect(r.arret!.raison).toMatch(/Object Lock/);
    expect(r.arret!.prochaine).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(r.etat.plan)).toBe(planAvant);
    expect(r.etat.etapes.objets.tentatives).toBe(2);
    const restantes = await versionsDe(`cabinets/${A.id}/`);
    expect(restantes).toHaveLength(1); // seule la version verrouillée
    expect(restantes[0]).toContain('/verrou|');
    expect(await versionsDe(`cabinets/${B.id}/`)).toEqual(objetsB);
    expect(await versionsDe('autre/')).toEqual(hors);
  });

  it('passage 3 : après l’échéance du verrou, les objets sont terminés ; les comptes sont désactivés (jamais supprimés avant leur date) : attente', async () => {
    await new Promise((ok) => setTimeout(ok, 13_000));
    const r = await avancerCycle(admin, opt(T.t0!));
    expect(r.faites).toEqual(['objets']);
    expect(r.arret).toMatchObject({ etape: 'identite', statut: 'attente', prochaine: await jour(90) });
    expect(await versionsDe(`cabinets/${A.id}/`)).toEqual([]);
    expect(await kc.etat(comptesKc!.seul.sujet)).toBe('desactive');
    expect(await kc.etat(comptesKc!.partage.sujet)).toBe('actif'); // autre appartenance : jamais touché
    expect(await kc.etat(comptesKc!.passant)).toBe('actif');
  });

  it('passage 4 (+95 j) : comptes supprimés, fiches traitées ; les sauvegardes contiennent encore le cabinet : attente de la rétention', async () => {
    const r = await avancerCycle(admin, opt(T.t2!));
    expect(r.faites).toEqual(['identite', 'fiches']);
    expect(r.arret).toMatchObject({ etape: 'sauvegardes', statut: 'attente' });
    expect(r.arret!.raison).toMatch(/1 jeu\(x\) de sauvegarde contiennent encore des données du cabinet/);
    expect(await kc.etat(comptesKc!.seul.sujet)).toBe('absent');
    expect(await kc.etat(comptesKc!.partage.sujet)).toBe('actif');
    expect((await admin.query('select 1 from utilisateurs where id = $1', [comptesKc!.seul.id])).rowCount).toBe(0);
    expect((await admin.query('select 1 from utilisateurs where id = $1', [comptesKc!.partage.id])).rowCount).toBe(1); // fiche du compte partagé intacte
    // J1 (ancien) retiré ; J2 (d'hier) conservé car dans la rétention ; l'objet d'A est encore référencé par J2 ; l'orphelin d'avant est nettoyé.
    expect(existsSync(join(sauv, 'comtaple-20260101-010101.dump'))).toBe(false);
    expect(blobsPresents(sauv)).toEqual([blobA, blobB].sort());
    expect(existsSync(join(sauv, 'objets', 'LISEZMOI.txt'))).toBe(true);
    expect(blobOrphelin).not.toBe('');
  });

  it('passage 5 (+370 j) : le jeu contenant le cabinet est retiré, l’objet du cabinet disparaît du dépôt ; seuls les éléments échus sont détruits ; les politiques attendent', async () => {
    const r = await avancerCycle(admin, opt(T.t5!));
    expect(r.faites).toEqual(['sauvegardes']);
    expect(r.arret).toMatchObject({ etape: 'elements_conserves', statut: 'attente', prochaine: await jour(400) });
    expect(blobsPresents(sauv)).toEqual([blobB]); // l'objet du cabinet n'est plus référencé par aucun jeu
    expect(readdirSync(sauv).filter((n) => n.endsWith('.jeu.json'))).toHaveLength(1);
    expect(await nb('restitutions_cabinet', A.id)).toBe(0);
    expect(await nb('abonnements', A.id)).toBe(0);
    expect(await nb('evenements_ia', A.id)).toBe(0);
    expect(await nb('politiques_conservation', A.id)).toBeGreaterThan(0);
    expect(await nb('journal_audit', A.id)).toBeGreaterThan(0);
  });

  it('passage 6 (+410 j) : politiques détruites, journal scellé ; sans décision humaine, la destruction du journal attend', async () => {
    const r = await avancerCycle(admin, opt(T.t6!));
    expect(r.faites).toEqual(['elements_conserves', 'scellement_journal']);
    expect(r.arret).toMatchObject({ etape: 'destruction_journal', statut: 'attente' });
    expect(r.arret!.raison).toMatch(/décision humaine documentée requise/);
    expect(await nb('politiques_conservation', A.id)).toBe(0);
    expect(await nb('journal_audit', A.id)).toBeGreaterThan(0);
    expect(etape('scellement_journal').resume).toMatchObject({ rang: 1 });
    expect(readdirSync(cheminsCycle(rep(), A.id).scellements).sort()).toEqual([`ancre-${A.id}-1.json`, `journal-${A.id}-1.jsonl`, `scellement-${A.id}-1.json`]);
  });

  it('passage 7 : une ligne ajoutée au journal après le scellement le périme ; rien n’est détruit ; le scellement est refait au passage suivant', async () => {
    const decision = { reference: 'DECISION-ESSAI-CYCLE', par: 'Responsable d’essai', date: T.t6!, motif: 'Essai du cycle de fin de vie' };
    const avant = await nb('journal_audit', A.id);
    const r = await avancerCycle(admin, opt(T.t6!, {
      decision,
      avantEtape: async (n) => {
        if (n === 'destruction_journal' && !injecter) {
          injecter = true;
          await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'essai.apres_scellement', 'cabinet', 'x')`, [A.id]);
        }
      },
    }));
    expect(r.arret).toMatchObject({ etape: 'destruction_journal', statut: 'attente' });
    expect(r.arret!.raison).toMatch(/a changé depuis le scellement/);
    expect(await nb('journal_audit', A.id)).toBe(avant + 1);
    expect(etape('scellement_journal').statut).toBe('a_faire');
  });

  it('passage 8 : nouveau scellement (chaîné au précédent), journal détruit après décision humaine ; la clôture attend la fin de conservation du procès-verbal', async () => {
    const decision = { reference: 'DECISION-ESSAI-CYCLE', par: 'Responsable d’essai', date: T.t6!, motif: 'Essai du cycle de fin de vie' };
    const r = await avancerCycle(admin, opt(T.t6!, { decision }));
    expect(r.faites).toEqual(['scellement_journal', 'destruction_journal']);
    expect(etape('scellement_journal').resume).toMatchObject({ rang: 2 });
    expect(r.arret).toMatchObject({ etape: 'cloture', statut: 'attente', prochaine: await jour(500) });
    expect(await nb('journal_audit', A.id)).toBe(0);
    expect(await nb('fins_de_contrat', A.id)).toBe(1);
    expect(r.etat.journalDetruit).toMatchObject({ decision: { reference: 'DECISION-ESSAI-CYCLE' } });
  });

  it('passage 9 : arrêt brutal juste avant la clôture ; passage 10 : clôture, certificat, cabinet clos ; le cycle est terminé', async () => {
    const decision = { reference: 'DECISION-ESSAI-CYCLE', par: 'Responsable d’essai', date: T.t6!, motif: 'Essai du cycle de fin de vie' };
    await expect(avancerCycle(admin, opt(T.t7!, { decision, avantEtape: (n) => { if (n === 'cloture') throw new ArretBrutal(); } }))).rejects.toBeInstanceOf(ArretBrutal);
    expect(await nb('fins_de_contrat', A.id)).toBe(1);
    const r = await avancerCycle(admin, opt(T.t7!, { decision }));
    expect(r.termine).toBe(true);
    expect(r.arret).toBeNull();
    expect(r.faites).toEqual(['cloture']);
    const cert = JSON.parse(readFileSync(r.fichierCertificat, 'utf8')) as CertificatDestruction;
    expect(verifierCertificat(cert)).toBe(true);
    expect(cert.cabinet).toMatchObject({ id: A.id, nom: A.nom });
    expect(cert.journal).toMatchObject({ decision: { reference: 'DECISION-ESSAI-CYCLE' } });
    expect(cert.elementsDetruits.map((x) => x.table)).toEqual(['abonnements', 'echeances_abonnement', 'evenements_facturation', 'evenements_ia', 'politiques_conservation', 'restitutions_cabinet']);
    expect((await admin.query('select 1 from cabinets where id = $1', [A.id])).rowCount).toBe(0);
    for (const t of P.tablesCabinet) expect(await nb(t, A.id), t).toBe(0);
    for (const n of ETAPES_CYCLE) expect(r.etat.etapes[n].statut, n).toBe('fait');
    expect(r.etat.etapes.cloture.tentatives).toBe(2); // un passage en attente (échéance du procès-verbal), un passage terminé
    const texte = rendreCycleLisible(r.etat, T.t7);
    expect(texte).toMatch(/Cycle terminé : plus rien n’est conservé/);
    expect(texte).not.toMatch(/\[ \]|\[…\]|\[!\]|undefined/);
    // Rejoué : rien à faire.
    expect((await avancerCycle(admin, opt(T.t7!, { decision }))).faites).toEqual([]);
  });

  it('l’autre cabinet, ses objets, ses comptes et toutes les ressources réelles sont restés intacts', async () => {
    expect(await empreinteCabinet(B.id)).toEqual(empB);
    expect(await versionsDe(`cabinets/${B.id}/`)).toEqual(objetsB);
    expect(await versionsDe('autre/')).toEqual(hors);
    expect((await kc.lister()).filter((u) => u.id === comptesKc!.partage.sujet || u.id === comptesKc!.passant).map((u) => `${u.id}:${u.enabled}`).sort()).toEqual(kcAvantB);
    expect(await comptesDuRoyaumeDeDev()).toBe(devAvant);
    expect(await compterBucketReel()).toBe(reelAvant);
    expect(blobsPresents(sauv)).toEqual([blobB]);
  });
});
