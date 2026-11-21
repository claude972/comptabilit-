#!/usr/bin/env node
/**
 * Essai de CONNEXION AVEC SECOND FACTEUR (TOTP) contre le royaume de production, sur l'instance JETABLE de
 * scripts/essai-royaume-production.sh (D-102). Parcours complet, sans navigateur : formulaires HTML lus et soumis, code TOTP calculé
 * (RFC 6238) à partir du secret affiché à l'enrôlement.
 *
 *   node scripts/essai-mfa.mjs <base Keycloak> <URL web du client> <identifiant> <mot de passe> <secret du client>
 *
 * Contrôles : (1) mot de passe seul : AUCUN code d'autorisation, renvoi vers l'enrôlement TOTP ; (2) un mauvais code d'enrôlement
 * est refusé ; (3) le bon code termine l'enrôlement et délivre un code d'autorisation, échangé contre un jeton ; (4) nouvelle
 * session : le mot de passe seul ne suffit plus, un mauvais code OTP est refusé, le bon est accepté. Codes de sortie : 0 conforme,
 * 1 écart. N'écrit rien hors de l'instance d'essai.
 */
import { createHmac } from 'node:crypto';

const [BASE, WEB, UTILISATEUR, MDP, SECRET_CLIENT] = process.argv.slice(2);
const HOTE_PUBLIC = 'https://auth.essai.test';
const VERIFICATEUR = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'; // exemple de la RFC 7636 ; défi S256 ci-dessous
const DEFI = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
let echec = 0;
const verifier = (nom, ok, detail = '') => {
  if (!ok) echec = 1;
  console.log(`  ${ok ? 'conforme    ' : 'NON CONFORME'} : ${nom}${!ok && detail ? ` (${detail})` : ''}`);
};

function totp(secret, decalage = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = secret.replace(/[ =]/g, '').toUpperCase().split('').map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const cle = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + decalage));
  const h = createHmac('sha1', cle).update(m).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

class Session {
  cookies = new Map();
  async requete(url, options = {}) {
    const adresse = url.replace(HOTE_PUBLIC, BASE);
    const r = await fetch(adresse, {
      redirect: 'manual',
      ...options,
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'auth.essai.test', cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    for (const c of r.headers.getSetCookie()) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      const nom = paire.slice(0, i);
      const valeur = paire.slice(i + 1);
      if (valeur === '' || /max-age=0/i.test(c)) this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }
    return { statut: r.status, location: r.headers.get('location') ?? '', corps: r.status < 300 || r.status >= 400 ? await r.text() : '' };
  }
  /** Suit les redirections internes à Keycloak ; s'arrête dès qu'une redirection sort vers le client web ou rend une page. */
  async suivre(r) {
    for (let i = 0; i < 10 && r.statut >= 300 && r.statut < 400; i++) {
      if (r.location.startsWith(WEB)) return r;
      r = await this.requete(r.location);
    }
    return r;
  }
  async ouvrir() {
    const url = `${BASE}/realms/comtaple/protocol/openid-connect/auth?client_id=comtaple-web&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${WEB}/api/auth/retour`)}&code_challenge=${DEFI}&code_challenge_method=S256`;
    return this.suivre(await this.requete(url));
  }
  async envoyer(page, champs) {
    const dec = (t) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const action = dec(/<form[^>]*action="([^"]*)"/.exec(page.corps)?.[1] ?? '');
    if (!action) throw new Error('aucun formulaire dans la page');
    const corps = new URLSearchParams();
    for (const t of page.corps.match(/<input[^>]*>/g) ?? []) {
      if (!/type="hidden"/.test(t)) continue;
      const n = /name="([^"]*)"/.exec(t)?.[1];
      if (n) corps.set(n, dec(/value="([^"]*)"/.exec(t)?.[1] ?? ''));
    }
    for (const [k, v] of Object.entries(champs)) corps.set(k, v);
    return this.suivre(await this.requete(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps }));
  }
}
const aCode = (r) => r.statut >= 300 && r.statut < 400 && r.location.startsWith(WEB) && /[?&]code=/.test(r.location);

// 1. Mot de passe seul : enrôlement exigé
const s1 = new Session();
const login = await s1.ouvrir();
let r = await s1.envoyer(login, { username: UTILISATEUR, password: MDP });
// Le thème n'affiche le secret saisissable qu'en mode « impossible de scanner » (lien `mode=manual`) : on suit ce lien.
const lien = /href="([^"]*mode=manual[^"]*)"/.exec(r.corps)?.[1]?.replace(/&amp;/g, '&');
if (lien) {
  const manuel = await s1.suivre(await s1.requete(lien));
  if (/kc-totp-secret-key/.test(manuel.corps)) r = manuel;
}
verifier('mot de passe seul : aucun code d’autorisation délivré', !aCode(r));
verifier('mot de passe seul : page d’enrôlement du second facteur', /totpSecret/.test(r.corps) && /name="totp"/.test(r.corps), `statut ${r.statut}`);
// Le champ caché `totpSecret` porte le secret BRUT ; la page affiche le même secret ENCODÉ en base32 (celui de l'application
// d'authentification) dans <span id="kc-totp-secret-key">. Le code se calcule sur le secret encodé ; le formulaire renvoie le brut.
const brut = /name="totpSecret"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="totpSecret"/.exec(r.corps);
const secretBrut = brut?.[1] ?? brut?.[2] ?? '';
const affiche = /id="kc-totp-secret-key"[^>]*>\s*([A-Z2-7 ]+?)\s*</.exec(r.corps)?.[1] ?? '';
const secretTotp = affiche.replace(/ /g, '');
if (secretTotp.length < 16) console.log(`  (diagnostic : extrait de la page d'enrôlement) ${r.corps.replace(/\s+/g, ' ').match(/.{0,200}(totpSecret|secret-key|Secret).{0,300}/i)?.[0] ?? r.corps.slice(0, 300)}`);
verifier('secret TOTP fourni à l’enrôlement (brut et encodé)', secretBrut.length >= 16 && secretTotp.length >= 16);

// 2. Mauvais code d'enrôlement
const mauvais = totp(secretTotp, 7) === '000000' ? '000001' : '000000';
let r2 = await s1.envoyer(r, { totp: mauvais, userLabel: 'essai', totpSecret: secretBrut });
verifier('enrôlement : un mauvais code est refusé (pas de code d’autorisation, page redemandée)', !aCode(r2) && /name="totp"/.test(r2.corps), `statut ${r2.statut}`);

// 3. Bon code : enrôlement terminé, connexion, échange contre un jeton
r2 = await s1.envoyer(r2, { totp: totp(secretTotp), userLabel: 'essai', totpSecret: secretBrut });
verifier('enrôlement : le bon code termine la connexion (code d’autorisation délivré)', aCode(r2), `statut ${r2.statut} ${r2.location.slice(0, 60)}`);
if (aCode(r2)) {
  const code = new URL(r2.location).searchParams.get('code');
  const t = await new Session().requete(`${BASE}/realms/comtaple/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${WEB}/api/auth/retour`, code_verifier: VERIFICATEUR, client_id: 'comtaple-web', client_secret: SECRET_CLIENT }),
  });
  let jeton = {};
  try { jeton = JSON.parse(t.corps); } catch { /* signalé ci-dessous */ }
  verifier('jeton délivré après second facteur (échange du code, PKCE S256)', Boolean(jeton.access_token), `statut ${t.statut}`);
}

// 4. Nouvelle session : le second facteur est demandé à chaque connexion
const attente = 30_000 - (Date.now() % 30_000) + 500; // code du pas suivant : les codes ne sont pas réutilisables dans le même pas
console.log(`  (attente de ${Math.round(attente / 1000)} s : un code TOTP n'est pas réutilisable dans son pas de 30 s)`);
await new Promise((res) => setTimeout(res, attente));
const s2 = new Session();
const login2 = await s2.ouvrir();
let q = await s2.envoyer(login2, { username: UTILISATEUR, password: MDP });
verifier('nouvelle session : le mot de passe seul ne suffit plus (code OTP demandé)', !aCode(q) && /name="otp"/.test(q.corps), `statut ${q.statut}`);
let q2 = await s2.envoyer(q, { otp: mauvais });
verifier('nouvelle session : un mauvais code OTP est refusé', !aCode(q2) && /name="otp"/.test(q2.corps), `statut ${q2.statut}`);
q2 = await s2.envoyer(q2, { otp: totp(secretTotp) });
verifier('nouvelle session : le bon code OTP est accepté', aCode(q2), `statut ${q2.statut} ${q2.location.slice(0, 60)}`);
process.exit(echec);
