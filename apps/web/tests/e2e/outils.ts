import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { type Page, expect } from '@playwright/test';

export const FAUX_API = process.env.E2E_FAUX_API ?? 'http://127.0.0.1:4100';
export const DOSSIER_AUTH = path.resolve(import.meta.dirname, '../.auth');
export const etatDe = (qui: Compte) => path.join(DOSSIER_AUTH, `${qui}.json`);

/** Comptes de test du royaume Keycloak de développement (mot de passe commun lu dans l'environnement, jamais affiché). */
export const COMPTES = {
  client: 'client.depot@client-a.test',
  chloe: 'chloe.collab@cabinet-a.test',
  remi: 'remi.reviseur@cabinet-a.test',
  alice: 'alice.admin@cabinet-a.test',
  bruno: 'bruno.admin@cabinet-b.test',
} as const;
export type Compte = keyof typeof COMPTES;

export const ID = {
  dupain: 'aaaaaaaa-0000-4000-8000-0000000000e1',
  martin: 'aaaaaaaa-0000-4000-8000-0000000000e2',
  leroy: 'bbbbbbbb-0000-4000-8000-0000000000e1',
  exDupain: 'aaaaaaaa-0000-4000-8000-0000000000f1',
} as const;

function motDePasse(): string {
  const v = process.env.DEV_MDP_UTILISATEURS;
  if (!v) throw new Error('DEV_MDP_UTILISATEURS absent de l’environnement (fichier .env de la racine)');
  return v;
}

/** Connexion réelle : écran de l'application → page de connexion Keycloak → retour sur l'application. */
export async function seConnecter(page: Page, qui: Compte, destination = '/'): Promise<void> {
  await page.goto(destination);
  await expect(page).toHaveURL(/\/connexion/);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.waitForURL(/localhost:8080\/realms\/comtaple\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(COMPTES[qui]);
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3000\//);
}

// ───────────── Pilotage du simulateur d'API ─────────────
export async function simulateur<T = unknown>(chemin: string, corps?: unknown): Promise<T> {
  const r = await fetch(`${FAUX_API}/__test/${chemin}`, corps === undefined && !['reinitialiser'].includes(chemin) ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps ?? {}) });
  if (!r.ok) throw new Error(`simulateur ${chemin} : ${r.status}`);
  return (await r.json()) as T;
}
export interface EntreeJournal {
  methode: string;
  chemin: string;
  statut: number;
  utilisateur: string | null;
}
export const journal = () => simulateur<EntreeJournal[]>('journal');
export interface EtatSimule {
  documents: Array<{ id: string; nomOrigine: string; nature: string; statut: string; commentaire: string | null; sha256: string; taille: number; entete: string; canal: string }>;
  televersements: Array<{ id: string; statut: string; octetsRecus: number; tailleAttendue: number }>;
  echanges: Array<{ type: string; message: string; documentId: string }>;
}
export const etatSimule = () => simulateur<EtatSimule>('etat');

// ───────────── Fichiers de test générés ─────────────
const tableCrc = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(octets: Buffer): number {
  let c = 0xffffffff;
  for (const o of octets) c = tableCrc[(c ^ o) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type: string, donnees: Buffer): Buffer {
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const tete = Buffer.alloc(4);
  tete.writeUInt32BE(donnees.length);
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc32(corps));
  return Buffer.concat([tete, corps, fin]);
}
/** Image PNG en niveaux de gris produite par une fonction (x, y) → 0..255. */
export function png(largeur: number, hauteur: number, gris: (x: number, y: number) => number): Buffer {
  const lignes = Buffer.alloc(hauteur * (largeur + 1));
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) lignes[y * (largeur + 1) + 1 + x] = gris(x, y);
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', entete), bloc('IDAT', deflateSync(lignes)), bloc('IEND', Buffer.alloc(0))]);
}
/** « Facture » nette et contrastée : texte simulé par des traits sombres pseudo-aléatoires sur fond clair. */
export function photoNette(graine = 1, largeur = 1200, hauteur = 1600): Buffer {
  let s = graine * 2654435761;
  const alea = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bruit = Array.from({ length: largeur * hauteur }, () => alea());
  return png(largeur, hauteur, (x, y) => (Math.floor(y / 14) % 2 === 0 && bruit[y * largeur + x]! > 0.45 ? 40 : 225));
}
/** Photo petite, sombre et sans contours : doit déclencher les avertissements de lisibilité. */
export const photoMauvaise = () => png(400, 300, () => 18);

/** PDF minimal (une page vide) avec un contenu variable pour obtenir des empreintes distinctes. */
export function pdf(marque: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marque}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n${'% remplissage\n'.repeat(6000)}`, 'latin1');
}
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Relève les violations de la politique de sécurité du contenu et les erreurs de page. */
export function surveiller(page: Page): string[] {
  const erreurs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) erreurs.push(m.text());
  });
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`));
  return erreurs;
}

// ───────────── Écrans ajoutés : règles, inventaire, missions, conseils, veille, restitution, membres ─────────────
export interface EtatSuite {
  regles: Array<{ id: string; controleId: string; entiteId: string | null; statut: string; version: number; parametres: Record<string, unknown>; impact: unknown; proposeePar: string; approuveePar: string | null }>;
  ecritures: Array<{ id: string; statut: string; libelle: string; totalDebit: string; proposeePar: string; decideePar: string | null; motifDecision: string | null }>;
  lettres: Array<{ id: string; statut: string; version: number; origine: string; avenantDe: string | null; contenu: { perimetre: Array<{ prestation: string }> } }>;
  travaux: Array<{ id: string; prestation: string; tempsObserveMinutes: number | null }>;
  conseils: Array<{ id: string; statut: string; version: number; contenu: string; remplaceConseilId: string | null }>;
  evenements: Array<{ conseilId: string; type: string; canal: string; justificatif: string }>;
  suivis: Array<{ entiteId: string; evolutionId: string; statut: string; note: string | null }>;
  restitutions: Array<{ id: string; statut: string; sha256: string | null }>;
  membres: Array<[string, { role?: string; actif?: boolean }]>;
  habilitations: Array<{ entiteId: string; utilisateurId: string; niveau: string }>;
  echangesAssistant?: Array<{ id: string; entiteId: string; utilisateurId: string; question: string; mode: string; statut: string }>;
}
export const etatSuite = () => simulateur<EtatSuite>('suite');
/** Appel du BFF depuis la page (même origine, en-tête CSRF) : renvoie le statut HTTP, pour vérifier un refus côté serveur. */
export async function statutBff(page: Page, methode: string, chemin: string, corps?: unknown): Promise<number> {
  return page.evaluate(
    async ([m, c, d]) => (await fetch(`/api/bff/${c}`, { method: m, headers: { ...(m === 'GET' ? {} : { 'X-Comtaple-Csrf': '1' }), ...(d !== null ? { 'Content-Type': 'application/json' } : {}) }, body: d })).status,
    [methode, chemin, corps === undefined ? null : JSON.stringify(corps)] as const,
  );
}
