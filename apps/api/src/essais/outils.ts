/** Outils communs aux parcours de bout en bout sur la pile réelle locale (jetons Keycloak réels, API réelle). */
import { createHash } from 'node:crypto';
import { chargerEnvLocal } from '@comtaple/db/env';
import { expect } from 'vitest';

chargerEnvLocal();
export const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
export const jetons: Record<string, string> = {};
export const COMPTES = {
  alice: 'alice.admin@cabinet-a.test',
  remi: 'remi.reviseur@cabinet-a.test',
  chloe: 'chloe.collab@cabinet-a.test',
  client: 'client.depot@client-a.test',
  bruno: 'bruno.admin@cabinet-b.test',
} as const;

export async function ouvrirSessions(): Promise<void> {
  for (const [cle, email] of Object.entries(COMPTES)) {
    const r = await fetch(`${process.env.OIDC_ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: 'comtaple-tests', username: email, password: process.env.DEV_MDP_UTILISATEURS!, scope: 'openid' }),
    });
    const d = (await r.json()) as { access_token?: string };
    if (!d.access_token) throw new Error(`Jeton non obtenu pour ${email}`);
    jetons[cle] = d.access_token;
  }
}

/** Cabinet à préciser pour un compte membre de plusieurs cabinets (en-tête X-Cabinet-Id) ; null pour revenir au cas général. */
const cabinets: Record<string, string> = {};
export function choisirCabinet(qui: string, cabinetId: string | null): void {
  if (cabinetId) cabinets[qui] = cabinetId;
  else delete cabinets[qui];
}

export async function api(qui: string, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: any; brut: Buffer }> {
  const binaire = Buffer.isBuffer(corps);
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      ...(qui ? { authorization: `Bearer ${jetons[qui]}` } : {}),
      ...(cabinets[qui] ? { 'x-cabinet-id': cabinets[qui] } : {}),
      ...(corps !== undefined ? { 'content-type': binaire ? 'application/octet-stream' : 'application/json' } : {}),
    },
    body: corps === undefined ? undefined : binaire ? new Uint8Array(corps as Buffer) : JSON.stringify(corps),
  });
  const brut = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(brut.toString('utf8'));
  } catch {
    /* réponse binaire */
  }
  return { statut: r.status, json, brut };
}

export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export async function deposer(qui: string, entiteId: string, contenu: Buffer, extra: Record<string, unknown> = {}, nomFichier = 'piece.pdf') {
  const o = await api(qui, 'POST', '/v1/televersements', { entiteId, nomFichier, taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur', ...extra });
  if (o.statut !== 201) return { ouverture: o, fin: null as any };
  let decalage: number = o.json.octetsRecus;
  while (decalage < contenu.length) {
    const m = await api(qui, 'PUT', `/v1/televersements/${o.json.id}/morceaux?decalage=${decalage}`, contenu.subarray(decalage, decalage + o.json.tailleMorceau));
    expect(m.statut).toBe(200);
    decalage = m.json.octetsRecus;
  }
  return { ouverture: o, fin: await api(qui, 'POST', `/v1/televersements/${o.json.id}/terminer`) };
}

export async function attendre<T>(lire: () => Promise<T>, pret: (v: T) => boolean, delaiMs = 90_000): Promise<T> {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const v = await lire();
    if (pret(v)) return v;
    if (Date.now() > fin) throw new Error(`Délai dépassé ; dernier état : ${JSON.stringify(v).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

export const attendreLot = (qui: string, id: string) =>
  attendre(
    () => api(qui, 'GET', `/v1/imports/${id}`),
    (r) => ['termine', 'termine_avec_erreurs', 'echec'].includes(r.json?.statut),
  );

/** PDF minimal à couche texte (Helvetica, WinAnsi), suffisant pour exercer la lecture PDF réelle du worker. */
export function pdfTexte(lignes: string[], sel = ''): Buffer {
  const enc = (t: string) =>
    Buffer.from(
      [...t].map((ch) => (ch === '€' ? 0x80 : ch === ' ' || ch === ' ' ? 0x20 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f)),
    )
      .toString('latin1')
      .replace(/[\\()]/g, (m) => `\\${m}`);
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${enc(l)}) Tj T*`).join('\n')}\nET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let corps = `%PDF-1.4\n%${sel}\n`;
  const decalages: number[] = [];
  objets.forEach((o, i) => {
    decalages.push(Buffer.byteLength(corps, 'latin1'));
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corps, 'latin1');
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}

