import { describe, expect, it } from 'vitest';
import { FournisseurIdentiteEssai, decisionCompte, exigerRoyaumeEssai, planifierComptesIdentite, royaumeDeIssuer } from './fournisseur-identite-essai.js';
import { StockageEssaiS3, exigerBucketEssai } from './stockage-essai.js';

const cfgS3 = (bucket: string) => ({ endpoint: 'http://127.0.0.1:1', region: 'local', accessKey: 'a', secretKey: 'b', bucket });

describe('stockage d’essai : refus avant tout appel', () => {
  const reel = 'comtaple-dev';
  it('refuse un bucket non déclaré, mal nommé, différemment déclaré, ou identique au bucket réel', () => {
    expect(() => exigerBucketEssai('comtaple-essai-abcd', { S3_BUCKET: reel })).toThrow(/aucun stockage d’essai n’est déclaré/);
    expect(() => exigerBucketEssai(reel, { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: reel })).toThrow(/n’est pas un bucket d’essai/);
    expect(() => exigerBucketEssai('donnees', { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: 'donnees' })).toThrow(/n’est pas un bucket d’essai/);
    expect(() => exigerBucketEssai('comtaple-essai-abcd', { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: 'comtaple-essai-autre' })).toThrow(/n’est pas celui déclaré d’essai/);
    expect(() => exigerBucketEssai('comtaple-essai-abcd', { STOCKAGE_ESSAI_BUCKET_DECLARE: 'comtaple-essai-abcd' })).toThrow(/bucket réel \(S3_BUCKET\) n’est pas connu/);
    // Le bucket réel porterait-il un nom d'essai (configuration absurde) : refusé, la distinction l'emporte.
    expect(() => exigerBucketEssai('comtaple-essai-abcd', { S3_BUCKET: 'COMTAPLE-ESSAI-ABCD', STOCKAGE_ESSAI_BUCKET_DECLARE: 'comtaple-essai-abcd' })).toThrow(/bucket des données réelles/);
    expect(() => exigerBucketEssai('comtaple-essai-abcd', { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: 'comtaple-essai-abcd' })).not.toThrow();
  });
  it('aucune instance ne peut être construite vers un autre bucket, et chaque méthode revérifie', async () => {
    expect(() => new StockageEssaiS3(cfgS3(reel), { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: reel })).toThrow(/n’est pas un bucket d’essai/);
    const env = { S3_BUCKET: reel, STOCKAGE_ESSAI_BUCKET_DECLARE: 'comtaple-essai-abcd' };
    const s = new StockageEssaiS3(cfgS3('comtaple-essai-abcd'), env);
    env.STOCKAGE_ESSAI_BUCKET_DECLARE = 'autre'; // la déclaration change après coup : plus aucune opération
    await expect(s.listerVersions('x/')).rejects.toThrow(/n’est pas celui déclaré/);
    await expect(s.supprimerVersion('x', 'v')).rejects.toThrow(/n’est pas celui déclaré/);
    await expect(s.creerBucket()).rejects.toThrow(/n’est pas celui déclaré/);
    await expect(s.detruireBucketEssai()).rejects.toThrow(/n’est pas celui déclaré/);
  });
});

describe('fournisseur d’identité d’essai : refus avant tout appel', () => {
  const issuer = 'http://localhost:8080/realms/comtaple';
  it('lit le royaume de l’application dans l’émetteur OIDC', () => {
    expect(royaumeDeIssuer(issuer)).toBe('comtaple');
    expect(royaumeDeIssuer('http://x/realms/a%20b/')).toBe('a b');
    expect(royaumeDeIssuer(undefined)).toBeNull();
  });
  it('refuse un royaume non déclaré, mal nommé, différemment déclaré, « master » ou celui de l’application', () => {
    const ok = 'essai-fin-contrat-abcd';
    expect(() => exigerRoyaumeEssai(ok, { OIDC_ISSUER: issuer })).toThrow(/aucun royaume d’essai n’est déclaré/);
    expect(() => exigerRoyaumeEssai('comtaple', { OIDC_ISSUER: issuer, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'comtaple' })).toThrow(/n’est pas un royaume d’essai/);
    expect(() => exigerRoyaumeEssai('master', { OIDC_ISSUER: issuer, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'master' })).toThrow(/n’est pas un royaume d’essai/);
    expect(() => exigerRoyaumeEssai(ok, { OIDC_ISSUER: issuer, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'essai-fin-contrat-autre' })).toThrow(/n’est pas celui déclaré/);
    expect(() => exigerRoyaumeEssai(ok, { KEYCLOAK_ROYAUME_ESSAI_DECLARE: ok })).toThrow(/OIDC_ISSUER/);
    expect(() => exigerRoyaumeEssai(ok, { OIDC_ISSUER: `http://x/realms/${ok}`, KEYCLOAK_ROYAUME_ESSAI_DECLARE: ok })).toThrow(/royaume de l’application/);
    expect(() => exigerRoyaumeEssai(ok, { OIDC_ISSUER: issuer, KEYCLOAK_ROYAUME_ESSAI_DECLARE: ok })).not.toThrow();
  });
  it('aucune instance vers le royaume de développement ; aucun appel réseau n’est émis par le refus', () => {
    const cfg = { url: 'http://127.0.0.1:1', adminUtilisateur: 'a', adminMotDePasse: 'b' };
    expect(() => new FournisseurIdentiteEssai({ ...cfg, royaume: 'comtaple' }, { OIDC_ISSUER: issuer, KEYCLOAK_ROYAUME_ESSAI_DECLARE: 'comtaple' })).toThrow(/n’est pas un royaume d’essai/);
  });
});

describe('plan des comptes : décisions pures, selon les dates', () => {
  const c = { sujetOidc: 's1', email: 'a@exemple.test', desactiverLe: '2027-01-10', supprimerLe: '2027-02-09' };
  it('avant la désactivation : attente ; entre les deux : désactivation ; après : suppression ; absent : rien ; sans dates : non planifié', () => {
    expect(decisionCompte(c, 'actif', '2027-01-09').action).toBe('attente');
    expect(decisionCompte(c, 'actif', '2027-01-10').action).toBe('desactiver');
    expect(decisionCompte(c, 'desactive', '2027-01-20').action).toBe('attente');
    expect(decisionCompte(c, 'actif', '2027-02-09').action).toBe('supprimer');
    expect(decisionCompte(c, 'desactive', '2027-03-01').action).toBe('supprimer');
    expect(decisionCompte(c, 'absent', '2027-03-01').action).toBe('aucune');
    expect(decisionCompte({ ...c, desactiverLe: null, supprimerLe: null }, 'actif', '2027-03-01').action).toBe('non_planifie');
  });
  it('la simulation ne produit aucune modification : l’état « après » est l’état « avant »', () => {
    const l = planifierComptesIdentite([c, { ...c, sujetOidc: 's2' }], new Map([['s1', 'actif' as const]]), '2027-03-01');
    expect(l.map((x) => [x.action, x.avant, x.apres])).toEqual([['supprimer', 'actif', 'actif'], ['aucune', 'absent', 'absent']]);
  });
});
