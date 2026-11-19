import { describe, expect, it } from 'vitest';
import { NB_MAX_MORCEAUX, TAILLE_MAX_MORCEAU, chiffrer, dechiffrer, decouper, deriverCle, nomsMorceaux, recomposer } from '@/lib/session-chiffrement';

const SECRET = 'secret-de-test-uniquement-0123456789-abcdefghij';
const lecteur = (m: Array<{ nom: string; valeur: string }>) => (n: string) => m.find((c) => c.nom === n)?.valeur;
/** Faux jeton peu compressible, de la taille d'un JWT réel. */
const fauxJeton = (taille: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(taille))).toString('base64url');

describe('chiffrement de session', () => {
  it('chiffre puis déchiffre le contenu', async () => {
    const cle = await deriverCle(SECRET);
    const session = { acces: fauxJeton(900), rafraichissement: fauxJeton(500), expireA: 123, sujet: 'abc' };
    const jeton = await chiffrer(session, cle, 2_000_000_000);
    expect(jeton.split('.')).toHaveLength(5); // JWE compact
    expect(jeton).not.toContain(session.acces.slice(0, 40));
    expect(await dechiffrer(jeton, cle, 1_000_000_000)).toEqual(session);
  });
  it('refuse un jeton expiré, altéré ou chiffré avec un autre secret', async () => {
    const cle = await deriverCle(SECRET);
    const jeton = await chiffrer({ a: 1 }, cle, 1000);
    expect(await dechiffrer(jeton, cle, 999)).toEqual({ a: 1 });
    expect(await dechiffrer(jeton, cle, 1000)).toBeNull();
    const altere = jeton.slice(0, -4) + (jeton.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await dechiffrer(altere, cle, 1)).toBeNull();
    expect(await dechiffrer(jeton, await deriverCle(`${SECRET}-autre`), 1)).toBeNull();
    expect(await dechiffrer('nimporte.quoi', cle, 1)).toBeNull();
  });
  it('l’expiration scellée ne peut pas être prolongée (en-tête protégé)', async () => {
    const cle = await deriverCle(SECRET);
    const jeton = await chiffrer({ a: 1 }, cle, 1000);
    const parties = jeton.split('.');
    const entete = JSON.parse(Buffer.from(parties[0]!, 'base64url').toString());
    parties[0] = Buffer.from(JSON.stringify({ ...entete, exp: 9_999_999_999 })).toString('base64url');
    expect(await dechiffrer(parties.join('.'), cle, 2000)).toBeNull();
  });
  it('sépare les clés par usage et refuse un secret trop court', async () => {
    const a = await deriverCle(SECRET);
    const b = await deriverCle(SECRET, 'comtaple-oidc-v1');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(a).toHaveLength(32);
    await expect(deriverCle('court')).rejects.toThrow();
  });
});

describe('découpage des cookies', () => {
  it('garde un seul cookie pour une petite valeur', () => {
    const m = decouper('s', 'abc');
    expect(m).toEqual([{ nom: 's.0', valeur: '1:abc' }]);
    expect(recomposer('s', lecteur(m))).toBe('abc');
  });
  it('découpe une session volumineuse en morceaux sous la limite et la recompose à l’identique', async () => {
    const cle = await deriverCle(SECRET);
    const session = { acces: fauxJeton(1400), rafraichissement: fauxJeton(900), identite: fauxJeton(1100), expireA: 1, debut: 1, sujet: 'x' };
    const jeton = await chiffrer(session, cle, 2_000_000_000);
    expect(jeton.length).toBeGreaterThan(4096); // ne tiendrait pas dans un seul cookie
    const m = decouper('comtaple_session', jeton);
    expect(m.length).toBeGreaterThan(1);
    for (const c of m) expect(c.nom.length + c.valeur.length).toBeLessThan(3800);
    const recompose = recomposer('comtaple_session', lecteur(m));
    expect(recompose).toBe(jeton);
    expect(await dechiffrer(recompose!, cle, 1)).toEqual(session);
  });
  it('respecte exactement les frontières de taille', () => {
    for (const longueur of [TAILLE_MAX_MORCEAU - 3, TAILLE_MAX_MORCEAU - 2, TAILLE_MAX_MORCEAU - 1, TAILLE_MAX_MORCEAU, 2 * TAILLE_MAX_MORCEAU - 2, 2 * TAILLE_MAX_MORCEAU - 1]) {
      const valeur = 'x'.repeat(longueur);
      const m = decouper('s', valeur);
      for (const c of m) expect(c.valeur.length).toBeLessThanOrEqual(TAILLE_MAX_MORCEAU);
      expect(recomposer('s', lecteur(m))).toBe(valeur);
    }
  });
  it('ignore les morceaux résiduels d’une session antérieure plus grande', () => {
    const ancien = decouper('s', 'a'.repeat(50), 20);
    const nouveau = decouper('s', 'b'.repeat(10), 20);
    expect(ancien.length).toBeGreaterThan(nouveau.length);
    const melange = [...nouveau, ...ancien.slice(nouveau.length)];
    expect(recomposer('s', lecteur(melange))).toBe('b'.repeat(10));
  });
  it('renvoie null si un morceau manque ou si le format est inattendu', () => {
    const m = decouper('s', 'a'.repeat(50), 20);
    expect(recomposer('s', lecteur(m.slice(0, -1)))).toBeNull();
    expect(recomposer('s', lecteur([]))).toBeNull();
    expect(recomposer('s', lecteur([{ nom: 's.0', valeur: 'sans-prefixe' }]))).toBeNull();
    expect(recomposer('s', lecteur([{ nom: 's.0', valeur: '9:abc' }]))).toBeNull();
  });
  it('refuse une session qui dépasserait le nombre maximal de cookies', () => {
    expect(() => decouper('s', 'x'.repeat(NB_MAX_MORCEAUX * 20 + 1), 20)).toThrow();
    expect(nomsMorceaux('s')).toHaveLength(NB_MAX_MORCEAUX);
  });
});
