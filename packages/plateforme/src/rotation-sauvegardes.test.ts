import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARQUEUR_ESSAI, appliquerNettoyageObjets, appliquerRotation, exigerRepertoireEssai, jeuxContenantCabinet, planifierNettoyageObjets, planifierRotation, preparerRepertoireEssai } from './rotation-sauvegardes.js';

const MAINTENANT = new Date('2026-12-01T12:00:00Z');
let racine: string;
const empreinteDossier = (d: string): string =>
  createHash('sha256')
    .update(
      readdirSync(d, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => (e.isDirectory() ? `${e.name}/{${empreinteDossier(join(d, e.name))}}` : `${e.name}:${readFileSync(join(d, e.name), 'utf8')}`))
        .join('|'),
    )
    .digest('hex');

/** Un « jeu » : dump, somme, manifeste d'objets, export Keycloak, descripteur. */
function jeu(d: string, id: string): void {
  for (const s of ['dump', 'dump.sha256', 'objets.json', 'objets.json.sha256', 'keycloak.json', 'keycloak.json.sha256', 'jeu.json']) writeFileSync(join(d, `${id}.${s}`), `${id}:${s}`);
}
function ancien(d: string, id: string): void {
  for (const s of ['dump', 'dump.sha256']) writeFileSync(join(d, `${id}.${s}`), `${id}:${s}`);
}
/** Répertoire de sauvegardes factice : 4 anciens formats, 5 jeux, 1 jeu interrompu, 2 exports Keycloak seuls, objets/, fichier étranger. */
function fabriquer(d: string): void {
  mkdirSync(d, { recursive: true });
  for (const id of ['comtaple-20260101-010101', 'comtaple-20260201-010101', 'comtaple-20260301-010101', 'comtaple-20260401-010101']) ancien(d, id);
  for (const id of ['comtaple-20261001-010101', 'comtaple-20261101-010101', 'comtaple-20261120-010101', 'comtaple-20261125-010101', 'comtaple-20261130-010101']) jeu(d, id);
  writeFileSync(join(d, 'comtaple-20260501-010101.dump'), 'partiel');
  writeFileSync(join(d, 'comtaple-20260501-010101.en-cours'), '');
  for (const id of ['keycloak-20260105-010101', 'keycloak-20261129-010101']) for (const s of ['json', 'json.sha256']) writeFileSync(join(d, `${id}.${s}`), id);
  mkdirSync(join(d, 'objets', 'ab'), { recursive: true });
  writeFileSync(join(d, 'objets', 'ab', 'abcdef'), 'blob');
  writeFileSync(join(d, 'LISEZMOI.txt'), 'à ne pas toucher');
}

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'comtaple-rotation-'));
});
afterAll(() => rmSync(racine, { recursive: true, force: true }));

describe('plan de rotation (simulation, lecture seule)', () => {
  it('classe chaque groupe, garde les plus récents, ne touche ni l’interrompu, ni objets/, ni les fichiers étrangers', () => {
    const d = join(racine, 'plan');
    fabriquer(d);
    const avant = empreinteDossier(d);
    const plan = planifierRotation(d, { retentionJours: 90, jeuxMinimumConserves: 3, maintenant: MAINTENANT });
    expect(empreinteDossier(d)).toBe(avant);
    const decision = (id: string) => plan.groupes.find((g) => g.id === id)!;
    // Complets (jeux + anciens formats) : 9, les 3 plus récents conservés ; au-delà de 90 jours : retirés.
    expect(plan.groupes.filter((g) => g.type === 'jeu' || g.type === 'ancien_format')).toHaveLength(9);
    for (const id of ['comtaple-20260101-010101', 'comtaple-20260201-010101', 'comtaple-20260301-010101', 'comtaple-20260401-010101']) expect(decision(id), id).toMatchObject({ type: 'ancien_format', decision: 'retirer' });
    // Le jeu du 1er octobre a 61 jours : dans la rétention de 90 jours, conservé.
    for (const id of ['comtaple-20261001-010101', 'comtaple-20261101-010101', 'comtaple-20261120-010101', 'comtaple-20261125-010101', 'comtaple-20261130-010101']) expect(decision(id).decision, id).toBe('conserver');
    expect(decision('comtaple-20261120-010101').motif).toMatch(/parmi les 3 plus récents|dans la rétention/);
    expect(decision('comtaple-20260501-010101')).toMatchObject({ type: 'interrompu', decision: 'a_examiner' });
    expect(decision('keycloak-20260105-010101')).toMatchObject({ type: 'keycloak_seul' });
    expect(plan.nonReconnus).toEqual(['LISEZMOI.txt']);
    expect(plan.aRetirer.groupes).toBe(plan.groupes.filter((g) => g.decision === 'retirer').length);
    expect(plan.aRetirer.fichiers).toBeGreaterThan(0);
  });

  it('plus la rétention est longue, moins on retire ; le minimum protège même ce qui est très ancien', () => {
    const d = join(racine, 'plan2');
    fabriquer(d);
    const nb = (retentionJours: number, jeuxMinimumConserves: number) => planifierRotation(d, { retentionJours, jeuxMinimumConserves, maintenant: MAINTENANT }).aRetirer.groupes;
    expect(nb(400, 1)).toBe(0);
    expect(nb(30, 1)).toBeGreaterThan(nb(90, 1));
    // minimum à 100 : rien ne peut être retiré, quel que soit l'âge (l'interrompu reste « à examiner »).
    expect(nb(1, 100)).toBe(0);
    expect(() => planifierRotation(d, { retentionJours: 0, jeuxMinimumConserves: 1 })).toThrow(/Rétention/);
    expect(() => planifierRotation(d, { retentionJours: 5, jeuxMinimumConserves: 0 })).toThrow(/minimum/);
  });
});

describe('exécution : répertoire d’essai marqué, jamais le répertoire réel', () => {
  it('refuse sans marqueur, avec un marqueur falsifié, et pour le répertoire réel, un de ses sous-dossiers ou son parent', () => {
    const reel = join(racine, 'reel');
    fabriquer(reel);
    const avant = empreinteDossier(reel);
    const p = { retentionJours: 1, jeuxMinimumConserves: 1, maintenant: MAINTENANT };
    // 1. répertoire réel, sans marqueur
    expect(() => appliquerRotation(reel, reel, p)).toThrow(/répertoire des sauvegardes réelles/);
    // 2. même avec un marqueur valide posé dans le répertoire réel : refusé (c'est le répertoire réel)
    preparerRepertoireEssai(reel);
    expect(() => appliquerRotation(reel, reel, p)).toThrow(/répertoire des sauvegardes réelles/);
    // 3. sous-dossier du réel, et parent du réel, marqués
    const sous = join(reel, 'sous');
    preparerRepertoireEssai(sous);
    expect(() => appliquerRotation(sous, reel, p)).toThrow(/répertoire des sauvegardes réelles/);
    expect(() => appliquerRotation(racine, reel, p)).toThrow(/répertoire des sauvegardes réelles|marqueur/);
    // 4. lien symbolique vers le réel, présenté comme répertoire d'essai
    const lien = join(racine, 'lien');
    symlinkSync(reel, lien);
    expect(() => appliquerRotation(lien, reel, p)).toThrow(/répertoire des sauvegardes réelles/);
    // 5. répertoire distinct sans marqueur, ou marqueur falsifié
    const autre = join(racine, 'sans-marqueur');
    fabriquer(autre);
    expect(() => appliquerRotation(autre, reel, p)).toThrow(/n’est pas déclaré répertoire d’essai/);
    writeFileSync(join(autre, MARQUEUR_ESSAI), 'oui');
    expect(() => exigerRepertoireEssai(autre, reel)).toThrow(/n’est pas déclaré répertoire d’essai/);
    // Rien n'a été retiré nulle part.
    rmSync(join(reel, MARQUEUR_ESSAI));
    rmSync(sous, { recursive: true });
    expect(empreinteDossier(reel)).toBe(avant);
    expect(readdirSync(autre).filter((n) => n.endsWith('.dump'))).toHaveLength(10);
  });

  it('retire les jeux échus, épargne les plus récents, l’interrompu, objets/ et les fichiers étrangers ; rapport ; idempotente', () => {
    const reel = join(racine, 'reel2');
    fabriquer(reel);
    const avantReel = empreinteDossier(reel);
    const d = join(racine, 'essai');
    fabriquer(d);
    preparerRepertoireEssai(d);
    const p = { retentionJours: 45, jeuxMinimumConserves: 3, maintenant: MAINTENANT };
    const prevu = planifierRotation(d, p);
    const r = appliquerRotation(d, reel, p);
    expect(r.retires.map((x) => x.id).sort()).toEqual(prevu.groupes.filter((g) => g.decision === 'retirer').map((g) => g.id).sort());
    expect(r.fichiersSupprimes).toBe(prevu.aRetirer.fichiers);
    expect(r.octetsLiberes).toBe(prevu.aRetirer.octets);
    const reste = readdirSync(d);
    expect(reste).toEqual(expect.arrayContaining(['LISEZMOI.txt', 'objets', MARQUEUR_ESSAI, 'comtaple-20260501-010101.dump', 'comtaple-20260501-010101.en-cours', 'comtaple-20261130-010101.jeu.json', 'comtaple-20261125-010101.jeu.json', 'comtaple-20261120-010101.jeu.json']));
    expect(reste.some((n) => n.startsWith('comtaple-2026010'))).toBe(false);
    // Un VRAI jeu (avec descripteur) échu est retiré en entier, descripteur compris ; celui de 30 jours reste.
    expect(reste.some((n) => n.startsWith('comtaple-20261001'))).toBe(false);
    expect(reste.filter((n) => n.startsWith('comtaple-20261101'))).toHaveLength(7);
    expect(r.retires.find((x) => x.id === 'comtaple-20261001-010101')).toMatchObject({ fichiers: 7 });
    expect(existsSync(join(d, 'objets', 'ab', 'abcdef'))).toBe(true);
    expect(r.aExaminer).toEqual(['comtaple-20260501-010101']);
    // Idempotence : rejouée, plus rien à retirer.
    expect(appliquerRotation(d, reel, p)).toMatchObject({ retires: [], fichiersSupprimes: 0 });
    expect(planifierRotation(d, p).aRetirer.groupes).toBe(0);
    // Le répertoire réel factice n'a pas bougé.
    expect(empreinteDossier(reel)).toBe(avantReel);
  });

  it('reprise après interruption : le retrait commencé est terminé au passage suivant', () => {
    const reel = join(racine, 'reel3');
    fabriquer(reel);
    const d = join(racine, 'reprise');
    fabriquer(d);
    preparerRepertoireEssai(d);
    const p = { retentionJours: 90, jeuxMinimumConserves: 3, maintenant: MAINTENANT };
    const total = planifierRotation(d, p).aRetirer.fichiers;
    let n = 0;
    expect(() => appliquerRotation(d, reel, { ...p, apresFichier: () => { if (++n === 4) throw new Error('interruption simulée'); } })).toThrow(/interruption simulée/);
    const restants = planifierRotation(d, p);
    expect(restants.aRetirer.fichiers).toBe(total - 4);
    const r = appliquerRotation(d, reel, p);
    expect(r.fichiersSupprimes).toBe(total - 4);
    expect(planifierRotation(d, p).aRetirer.groupes).toBe(0);
    // Le groupe interrompu en cours de retrait (anciens formats sans descripteur) n'est jamais classé « interrompu » à tort.
    expect(readdirSync(d).filter((x) => x.startsWith('comtaple-2026010'))).toEqual([]);
    expect(readFileSync(join(d, '.rotation.jsonl'), 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

// ───────────────────────────── Dépôt d'objets adressés par empreinte (D-100) ─────────────────────────────

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
function blob(d: string, contenu: string): string {
  const h = sha(contenu);
  mkdirSync(join(d, 'objets', h.slice(0, 2)), { recursive: true });
  writeFileSync(join(d, 'objets', h.slice(0, 2), h), contenu);
  return h;
}
function jeuAvecManifeste(d: string, id: string, objets: Array<{ cle: string; sha256: string }>): void {
  for (const [s, c] of [['dump', 'd'], ['dump.sha256', 'x'], ['objets.json', JSON.stringify({ objets })], ['objets.json.sha256', 'x'], ['keycloak.json', '{}'], ['keycloak.json.sha256', 'x'], ['jeu.json', '{}']] as const) writeFileSync(join(d, `${id}.${s}`), c);
}
const CAB = '3d895835-a5cf-475c-b5e3-a2e0d16a5c3e';

describe('nettoyage du dépôt d’objets : seuls les objets que plus aucun jeu conservé ne référence', () => {
  it('le plan est en lecture seule ; il liste les orphelins, ignore ce qui n’a pas la forme d’un objet adressé', () => {
    const d = join(racine, 'nettoyage-plan');
    mkdirSync(d, { recursive: true });
    const garde = blob(d, 'référencé');
    const orph = blob(d, 'orphelin');
    jeuAvecManifeste(d, 'comtaple-20261101-010101', [{ cle: `cabinets/${CAB}/a`, sha256: garde }]);
    writeFileSync(join(d, 'objets', 'LISEZMOI.txt'), 'x');
    writeFileSync(join(d, 'objets', garde.slice(0, 2), 'pas-un-objet'), 'x');
    mkdirSync(join(d, 'objets', 'zz'), { recursive: true }); // dossier au nom étranger
    const avant = empreinteDossier(d);
    const plan = planifierNettoyageObjets(d);
    expect(empreinteDossier(d)).toBe(avant);
    expect(plan).toMatchObject({ manifestes: 1, references: 1, blobs: 2, bloque: null });
    expect(plan.orphelins.fichiers.map((f) => f.chemin)).toEqual([`objets/${orph.slice(0, 2)}/${orph}`]);
    expect(plan.nonReconnus.sort()).toEqual(['objets/LISEZMOI.txt', `objets/${garde.slice(0, 2)}/pas-un-objet`, 'objets/zz'].sort());
  });

  it('refuse de déclarer un orphelin si un manifeste est illisible ou si une sauvegarde est en cours ou interrompue', () => {
    const d = join(racine, 'nettoyage-bloque');
    mkdirSync(d, { recursive: true });
    blob(d, 'x');
    jeuAvecManifeste(d, 'comtaple-20261101-010101', []);
    writeFileSync(join(d, 'comtaple-20261101-010101.objets.json'), '{ pas du json');
    expect(planifierNettoyageObjets(d).bloque).toMatch(/manifeste illisible/);
    writeFileSync(join(d, 'comtaple-20261101-010101.objets.json'), JSON.stringify({ objets: [] }));
    expect(planifierNettoyageObjets(d).bloque).toBeNull();
    writeFileSync(join(d, 'comtaple-20261102-010101.en-cours'), '');
    expect(planifierNettoyageObjets(d).bloque).toMatch(/sauvegarde en cours ou interrompue/);
    preparerRepertoireEssai(d);
    expect(() => appliquerNettoyageObjets(d, join(racine, 'reel-inexistant'))).toThrow(/Nettoyage des objets refusé/);
    expect(blobsDe(d)).toHaveLength(1);
  });

  it('l’exécution est refusée hors répertoire d’essai marqué ; dans un répertoire d’essai, elle est reprenable et idempotente', () => {
    const d = join(racine, 'nettoyage-exec');
    mkdirSync(d, { recursive: true });
    const garde = blob(d, 'référencé');
    const o1 = blob(d, 'orphelin 1');
    const o2 = blob(d, 'orphelin 2');
    jeuAvecManifeste(d, 'comtaple-20261101-010101', [{ cle: 'x', sha256: garde }]);
    expect(() => appliquerNettoyageObjets(d, join(racine, 'reel-inexistant'))).toThrow(/n’est pas déclaré répertoire d’essai/);
    expect(blobsDe(d)).toHaveLength(3);
    preparerRepertoireEssai(d);
    expect(() => appliquerNettoyageObjets(d, d)).toThrow(/répertoire des sauvegardes réelles/);
    let n = 0;
    expect(() => appliquerNettoyageObjets(d, join(racine, 'reel-inexistant'), { apresFichier: () => { if (++n === 1) throw new Error('interruption simulée'); } })).toThrow(/interruption simulée/);
    expect(blobsDe(d)).toHaveLength(2); // un orphelin supprimé, l'autre pas encore
    const r = appliquerNettoyageObjets(d, join(racine, 'reel-inexistant'));
    expect(r.supprimes).toBe(1);
    expect(blobsDe(d)).toEqual([garde]);
    expect(appliquerNettoyageObjets(d, join(racine, 'reel-inexistant'))).toMatchObject({ supprimes: 0, octetsLiberes: 0 });
    expect(existsSync(join(d, 'objets', o1.slice(0, 2), o1)) || existsSync(join(d, 'objets', o2.slice(0, 2), o2))).toBe(false);
  });

  it('un sous-dossier qui est un lien symbolique n’est jamais suivi', () => {
    const d = join(racine, 'nettoyage-lien');
    const dehors = join(racine, 'dehors');
    mkdirSync(join(d, 'objets'), { recursive: true });
    mkdirSync(dehors, { recursive: true });
    const h = sha('hors dépôt');
    writeFileSync(join(dehors, h), 'ne pas supprimer');
    symlinkSync(dehors, join(d, 'objets', h.slice(0, 2)));
    jeuAvecManifeste(d, 'comtaple-20261101-010101', []);
    preparerRepertoireEssai(d);
    const plan = planifierNettoyageObjets(d);
    expect(plan.orphelins.fichiers).toEqual([]);
    expect(plan.nonReconnus).toEqual([`objets/${h.slice(0, 2)}`]);
    expect(appliquerNettoyageObjets(d, join(racine, 'reel-inexistant')).supprimes).toBe(0);
    expect(existsSync(join(dehors, h))).toBe(true);
  });
});

function blobsDe(d: string): string[] {
  return readdirSync(join(d, 'objets'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.length === 2).flatMap((e) => readdirSync(join(d, 'objets', e.name)).filter((n) => /^[0-9a-f]{64}$/.test(n))).sort();
}

describe('jeux contenant encore des données d’un cabinet dont le contrat est terminé', () => {
  it('compte les jeux antérieurs au pivot, ceux dont le manifeste cite le cabinet et les jeux interrompus ; pas les jeux propres', () => {
    const d = join(racine, 'contenant');
    mkdirSync(d, { recursive: true });
    const pivot = new Date('2026-11-20T12:00:00Z');
    jeuAvecManifeste(d, 'comtaple-20261101-010101', [{ cle: `cabinets/${CAB}/a`, sha256: sha('a') }]); // avant le pivot
    jeuAvecManifeste(d, 'comtaple-20261125-010101', [{ cle: `cabinets/${CAB}/a`, sha256: sha('a') }]); // après, mais le manifeste cite encore le cabinet
    jeuAvecManifeste(d, 'comtaple-20261126-010101', [{ cle: 'cabinets/autre/a', sha256: sha('b') }]); // propre
    jeuAvecManifeste(d, 'comtaple-20261121-010101', []); // dans la marge d'un jour : compté par prudence
    writeFileSync(join(d, 'comtaple-20261127-010101.dump'), 'partiel');
    writeFileSync(join(d, 'comtaple-20261127-010101.en-cours'), '');
    const c = jeuxContenantCabinet(d, CAB, pivot);
    expect(c.map((x) => x.id).sort()).toEqual(['comtaple-20261101-010101', 'comtaple-20261121-010101', 'comtaple-20261125-010101', 'comtaple-20261127-010101']);
    expect(c.find((x) => x.id === 'comtaple-20261125-010101')!.raison).toMatch(/manifeste d’objets cite encore/);
    expect(c.find((x) => x.id === 'comtaple-20261127-010101')!.raison).toMatch(/interrompue/);
    expect(jeuxContenantCabinet(d, 'autre-cabinet', pivot).map((x) => x.id).sort()).toEqual(['comtaple-20261101-010101', 'comtaple-20261121-010101', 'comtaple-20261127-010101']);
  });
});
