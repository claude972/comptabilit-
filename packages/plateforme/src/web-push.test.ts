import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chiffrerMessagePousse, clesAbonnementValides, clesVapidCoherentes, dechiffrerMessagePousse, enteteVapid, ErreurWebPush, genererClesVapid, TAILLE_MAX_CLAIR_POUSSE, verifierEnteteVapid } from './web-push.js';

const b = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');

/** RFC 8291, section 5 et annexe A : valeurs recopiées du texte publié (https://www.rfc-editor.org/rfc/rfc8291.txt). */
const RFC8291 = {
  clair: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  navigateurPrivee: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  navigateurPublique: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  serveurPrivee: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  serveurPublique: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  sel: 'DGv6ra1nlYgDCS1FRnbzlw',
  corps: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
          mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
          pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
};

/** RFC 8292, section 2.4 : en-tête d'exemple et clé publique (https://www.rfc-editor.org/rfc/rfc8292.txt). */
const RFC8292 = {
  entete: `vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA, k=BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs`,
  audience: 'https://push.example.net',
  exp: 1453523768,
  sub: 'mailto:push@example.com',
  x: 'DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc',
  y: 'F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs',
};

function navigateur() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  const auth = randomBytes(16);
  return { clePrivee: e.getPrivateKey(), auth, cles: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

describe('chiffrement d’un message poussé (RFC 8291)', () => {
  it('exemple de la RFC : avec le sel et la clé éphémère de l’exemple, le corps produit est celui publié, octet pour octet', () => {
    const corps = chiffrerMessagePousse(Buffer.from(RFC8291.clair, 'ascii'), { p256dh: RFC8291.navigateurPublique, auth: RFC8291.auth }, { sel: b(RFC8291.sel), clePriveeEphemere: b(RFC8291.serveurPrivee) });
    expect(corps.toString('base64url')).toBe(RFC8291.corps.replace(/\s+/g, ''));
    // 192 caractères base64url = 144 octets (86 d'en-tête, 41 de clair, 1 délimiteur, 16 d'étiquette). L'exemple de la RFC
    // annonce « Content-Length: 145 », ce qui ne correspond pas au corps qu'elle publie : c'est le corps qui fait foi ici.
    expect(corps.length).toBe(144);
    expect(corps.subarray(21, 86).toString('base64url')).toBe(RFC8291.serveurPublique);
  });

  it('exemple de la RFC : le corps publié se déchiffre avec la clé privée du navigateur de l’exemple', () => {
    expect(dechiffrerMessagePousse(b(RFC8291.corps), { clePrivee: b(RFC8291.navigateurPrivee), auth: b(RFC8291.auth) }).toString('ascii')).toBe(RFC8291.clair);
  });

  it('aller-retour avec des clés tirées au hasard ; sel et clé éphémère changent à chaque message', () => {
    const n = navigateur();
    const clair = Buffer.from('{"v":1,"t":"notification","i":"3f2b8c1e-7a4d-4e9b-8c2a-1d5e6f7a8b9c"}');
    const un = chiffrerMessagePousse(clair, n.cles);
    const deux = chiffrerMessagePousse(clair, n.cles);
    expect(un.equals(deux)).toBe(false);
    expect(un.subarray(0, 16).equals(deux.subarray(0, 16))).toBe(false);
    expect(un.subarray(21, 86).equals(deux.subarray(21, 86))).toBe(false);
    expect(un.includes(Buffer.from('notification'))).toBe(false); // le clair n'apparaît pas dans le corps
    expect(dechiffrerMessagePousse(un, n).equals(clair)).toBe(true);
    expect(dechiffrerMessagePousse(deux, n).equals(clair)).toBe(true);
    expect(dechiffrerMessagePousse(chiffrerMessagePousse(Buffer.alloc(0), n.cles), n).length).toBe(0);
  });

  it('un message altéré, une autre clé privée ou un autre secret d’authentification sont refusés', () => {
    const n = navigateur();
    const corps = chiffrerMessagePousse(Buffer.from('message'), n.cles);
    const altere = Buffer.from(corps);
    altere[altere.length - 20]! ^= 1;
    expect(() => dechiffrerMessagePousse(altere, n)).toThrow(ErreurWebPush);
    expect(() => dechiffrerMessagePousse(corps, { clePrivee: navigateur().clePrivee, auth: n.auth })).toThrow(ErreurWebPush);
    expect(() => dechiffrerMessagePousse(corps, { clePrivee: n.clePrivee, auth: randomBytes(16) })).toThrow(ErreurWebPush);
    expect(() => dechiffrerMessagePousse(corps.subarray(0, 50), n)).toThrow(ErreurWebPush);
  });

  it('clés d’abonnement mal formées ou hors courbe : refusées avant tout envoi ; message trop long refusé', () => {
    const n = navigateur();
    expect(clesAbonnementValides(n.cles)).toBe(true);
    const horsCourbe = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
    for (const cles of [{ p256dh: 'abc', auth: n.cles.auth }, { p256dh: n.cles.p256dh, auth: 'abc' }, { p256dh: horsCourbe, auth: n.cles.auth }, { p256dh: `${n.cles.p256dh}=`, auth: n.cles.auth }, { p256dh: n.cles.p256dh.replace(/^B/, 'A'), auth: n.cles.auth }]) {
      expect(clesAbonnementValides(cles), JSON.stringify(cles)).toBe(false);
      expect(() => chiffrerMessagePousse(Buffer.from('x'), cles)).toThrow(ErreurWebPush);
    }
    expect(() => chiffrerMessagePousse(Buffer.alloc(TAILLE_MAX_CLAIR_POUSSE + 1), n.cles)).toThrow(/trop long/);
    expect(chiffrerMessagePousse(Buffer.alloc(TAILLE_MAX_CLAIR_POUSSE), n.cles).length).toBe(4096);
  });
});

describe('identification du serveur d’application (VAPID, RFC 8292)', () => {
  it('exemple de la RFC : le jeton publié est vérifié par la clé publique publiée (signature ES256, audience, sujet)', () => {
    const r = verifierEnteteVapid(RFC8292.entete, { audience: RFC8292.audience, maintenant: RFC8292.exp - 3600 });
    expect(r).toEqual({ clePublique: RFC8292.entete.split('k=')[1], aud: RFC8292.audience, exp: RFC8292.exp, sub: RFC8292.sub });
    // La clé « k » de l'en-tête est bien le point (x, y) du JWK publié.
    const k = Buffer.from(r.clePublique, 'base64url');
    expect(k.subarray(1, 33).toString('base64url')).toBe(RFC8292.x);
    expect(k.subarray(33).toString('base64url')).toBe(RFC8292.y);
  });

  it('exemple de la RFC : un seul caractère du jeton modifié, une autre audience ou le jeton expiré sont refusés', () => {
    const quand = { audience: RFC8292.audience, maintenant: RFC8292.exp - 3600 };
    expect(() => verifierEnteteVapid(RFC8292.entete.replace('.i3CYb7', '.i3CYb8'), quand)).toThrow(/Signature/);
    expect(() => verifierEnteteVapid(RFC8292.entete.replace('eyJhdWQiOiJodHRwczovL3B1', 'eyJhdWQiOiJodHRwczovL3B2'), quand)).toThrow(/Signature|illisible/);
    expect(() => verifierEnteteVapid(RFC8292.entete, { ...quand, audience: 'https://autre.example.net' })).toThrow(/Audience/);
    expect(() => verifierEnteteVapid(RFC8292.entete, { ...quand, maintenant: RFC8292.exp + 1 })).toThrow(/expiré/);
    expect(() => verifierEnteteVapid(RFC8292.entete, { ...quand, maintenant: RFC8292.exp - 25 * 3600 })).toThrow(/24 heures/);
  });

  it('jeton produit ici : forme de la RFC, vérifié par la clé publique ; refusé avec une autre clé', () => {
    const cles = genererClesVapid();
    expect(clesVapidCoherentes(cles)).toBe(true);
    const maintenant = 1_800_000_000;
    const entete = enteteVapid({ audience: 'https://fcm.googleapis.com', sujet: 'mailto:exploitation@editeur.example', cles, expiration: maintenant + 12 * 3600 });
    expect(entete).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}, k=[A-Za-z0-9_-]{87}$/);
    const [enteteJwt, corps] = entete.slice('vapid t='.length).split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8')));
    expect(enteteJwt).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(corps).toEqual({ aud: 'https://fcm.googleapis.com', exp: maintenant + 12 * 3600, sub: 'mailto:exploitation@editeur.example' });
    expect(verifierEnteteVapid(entete, { audience: 'https://fcm.googleapis.com', maintenant }).clePublique).toBe(cles.publique);
    // Clé publique d'un autre : la signature ne correspond plus.
    const autre = genererClesVapid();
    expect(() => verifierEnteteVapid(entete.replace(`k=${cles.publique}`, `k=${autre.publique}`), { audience: 'https://fcm.googleapis.com', maintenant })).toThrow(/Signature/);
    expect(entete).not.toContain(cles.privee);
  });

  it('paire de clés : cohérence vérifiée ; en-têtes mal formés refusés', () => {
    const a = genererClesVapid();
    const c = genererClesVapid();
    expect(Buffer.from(a.publique, 'base64url').length).toBe(65);
    expect(Buffer.from(a.privee, 'base64url').length).toBe(32);
    expect(clesVapidCoherentes({ publique: a.publique, privee: c.privee })).toBe(false);
    expect(clesVapidCoherentes({ publique: a.publique, privee: 'abc' })).toBe(false);
    expect(clesVapidCoherentes({ publique: '', privee: '' })).toBe(false);
    for (const e of [undefined, '', 'Bearer abc', 'vapid t=abc', 'vapid k=abc', 'vapid t=a.b.c, k=abc']) expect(() => verifierEnteteVapid(e, { audience: 'https://x.example', maintenant: 0 })).toThrow(ErreurWebPush);
  });
});
