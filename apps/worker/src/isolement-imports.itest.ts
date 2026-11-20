/**
 * Isolement des imports — relevés bancaires (camt.053, OFX, CSV, document d'agrégation) et FEC lus dans le processus
 * enfant RÉEL (fichier compilé `dist/analyse-enfant.js` : `pnpm run build` d'abord), puis chaînes complètes
 * `importerReleve` et `importerFec` sur PostgreSQL réel.
 * Autonome : cabinet, dossier, exercices, fichiers et lots PROPRES À CE TEST (retirés à la fin pour les tables
 * volumineuses) ; stockage en mémoire, file de tâches remplacée par un témoin. Aucun service n'est redémarré.
 *
 * Les comportements hostiles de l'enfant (boucle, débordement, trames invalides) sont joués par
 * `essais/enfant-hostile.mjs`, lancé avec exactement les mêmes options que l'enfant réel.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  analyserFec, decoderTexteReleve, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec, lireCamt053, lireCsvBanque, lireOfx, lireReleveAgregation, proposerProfilCsv, TAILLE_MAX_LIGNE_FEC,
} from '@comtaple/core';
import { creerAccesBd, schema as s, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Files, lireConfig, type Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyserFecIsole, analyserPieceIsolee, ENTREE_ENFANT, lireReleveIsole, motifEchecFec, motifEchecReleve, type OptionsAnalyse } from './analyse-isolee.js';
import { MOUVEMENTS_MAX_RELEVE } from './analyse-types.js';
import { importerReleve } from './banque.js';
import type { Contexte } from './contexte.js';
import { importerFec } from './import-fec.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const HOSTILE = resolve(ICI, '../essais/enfant-hostile.mjs');
const hostile: OptionsAnalyse = { entree: HOSTILE, lecturesSupplementaires: [dirname(HOSTILE)] };
const SEL = randomBytes(4).toString('hex');
const SECRET_FICHIER = `contenu-secret-${SEL}`;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const SANS_PROFIL = { profilCsv: null, profilInvalide: false };
/** Borne de sortie des relevés (valeur par défaut de la configuration). */
const RELEVE: OptionsAnalyse = { sortieMaxOctets: 192 * 1024 * 1024 };
/** Messages techniques qui ne doivent jamais atteindre l'utilisateur. */
const TECHNIQUE = /SIGKILL|heap|JSON|Unexpected|offset|fast-xml|iconv|zod|schema|stack|\bat \w+ \(|node:|delai\b|plantage|sortie_/i;

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const releve = (format: 'camt.053' | 'ofx' | 'csv', nbMouvements: number, graine = 7) => genererReleveSynthetique({ graine, format, debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements });
const fec = (nbEcritures: number, graine = 11) => genererFecSynthetique({ exercice: EXERCICE, nbEcritures, graine });

let dossierTemporaire = '';
let fichierInterdit = '';
let serveur: Server;
let port = 0;
let connexionsRecues = 0;

beforeAll(async () => {
  expect(existsSync(ENTREE_ENFANT), 'le point d’entrée compilé de l’enfant doit exister : lancer « pnpm run build »').toBe(true);
  for (const source of ['analyse-enfant.ts', 'analyse-types.ts', 'releve-contenu.ts', 'fec-contenu.ts']) {
    expect(statSync(join(ICI, '../dist', source.replace(/\.ts$/, '.js'))).mtimeMs, `dist périmé pour ${source} : relancer « pnpm run build »`).toBeGreaterThanOrEqual(statSync(join(ICI, source)).mtimeMs);
  }
  dossierTemporaire = mkdtempSync(join(tmpdir(), 'comtaple-isolement-imports-'));
  fichierInterdit = join(dossierTemporaire, 'secret.txt');
  writeFileSync(fichierInterdit, SECRET_FICHIER);
  serveur = createServer((s) => {
    connexionsRecues++;
    s.destroy();
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  port = (serveur.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise((ok) => serveur.close(ok));
  rmSync(dossierTemporaire, { recursive: true, force: true });
});

// ── Fichiers hostiles ────────────────────────────────────────────────────────────────────────────────────────────────
const camtSain = () => releve('camt.053', 12).contenu;
const camtXxe = () =>
  camtSain()
    .replace(/\?>/, `?>\n<!DOCTYPE Document [<!ENTITY xxe SYSTEM "file://${fichierInterdit}"><!ENTITY reseau SYSTEM "http://127.0.0.1:${port}/dtd">]>`)
    .replace(/<Ustrd>/, '<Ustrd>&xxe;&reseau;');
const camtBombe = () =>
  camtSain()
    .replace(/\?>/, `?>\n<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaaaaaaaaaaaa">${Array.from({ length: 12 }, (_, i) => `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`).join('')}]>`)
    .replace(/<Ustrd>/, '<Ustrd>&m;');
const camtProfond = () => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>${'<a>'.repeat(50_000)}x${'</a>'.repeat(50_000)}</BkToCstmrStmt></Document>`;
const ofxMalforme = () => `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>${'<BANKTRANLIST>'.repeat(20_000)}<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2025ABCD<TRNAMT>1e999<FITID>${'9'.repeat(5000)}<NAME>\u0000‮${'A'.repeat(100_000)}`;
const csvLignesGeantes = () => `Date;Libellé;Montant\n01/02/2025;${'A'.repeat(6_000_000)};-12,50\n02/02/2025;"${'B'.repeat(6_000_000)};1,00\n03/02/2025;Virement normal;100,00\n`;
const csvUneSeuleLigne = () => `Date;Libellé;Montant;${'x;'.repeat(5_000_000)}`;

describe('relevés bancaires — enfant réel, jeux sains : résultat identique à la lecture directe', () => {
  it.each(['camt.053', 'ofx', 'csv'] as const)('%s : mêmes comptes, mêmes mouvements (clés d’idempotence comprises), mêmes anomalies', async (format) => {
    const r = releve(format, 60);
    const { texte, encodage } = decoderTexteReleve(new Uint8Array(Buffer.from(r.contenu, 'utf8')));
    const direct = format === 'camt.053' ? lireCamt053(texte) : format === 'ofx' ? lireOfx(texte) : lireCsvBanque(texte, proposerProfilCsv(texte).profil!);
    const isole = await lireReleveIsole(Buffer.from(r.contenu, 'utf8'), SANS_PROFIL, RELEVE);
    expect(isole.ok).toBe(true);
    if (!isole.ok || isole.valeur.etat !== 'lu') throw new Error('lecture attendue');
    expect(isole.valeur.rapport).toEqual(json(direct));
    expect(isole.valeur.encodage).toBe(encodage);
    expect(isole.valeur.rapport.mouvements).toHaveLength(60);
    expect(isole.valeur.rapport.mouvements.map((m) => m.montant)).toEqual(r.attendu.mouvements.map((m) => m.montant));
    expect(isole.valeur.origineProfil).toBe(format === 'csv' ? 'propose_automatiquement' : null);
  });

  it('CSV : profil confirmé transmis à l’enfant ; profil invalide et colonnes ambiguës rendus comme des refus de format, pas des échecs', async () => {
    const r = releve('csv', 20);
    const profil = proposerProfilCsv(r.contenu).profil!;
    const confirme = await lireReleveIsole(Buffer.from(r.contenu), { profilCsv: profil, profilInvalide: false }, RELEVE);
    expect(confirme.ok && confirme.valeur).toMatchObject({ etat: 'lu', origineProfil: 'confirme', profil });
    expect(confirme.ok && confirme.valeur.etat === 'lu' && confirme.valeur.rapport).toEqual(json(lireCsvBanque(r.contenu, profil)));
    expect((await lireReleveIsole(Buffer.from(r.contenu), { profilCsv: null, profilInvalide: true }, RELEVE)).ok).toBe(true);
    expect(await lireReleveIsole(Buffer.from(r.contenu), { profilCsv: null, profilInvalide: true }, RELEVE)).toMatchObject({ ok: true, valeur: { etat: 'profil_invalide', format: 'csv' } });
    const ambigu = await lireReleveIsole(Buffer.from('a;b;c\n1;2;3\n4;5;6\n'), SANS_PROFIL, RELEVE);
    expect(ambigu).toMatchObject({ ok: true, valeur: { etat: 'profil_a_confirmer', format: 'csv' } });
  });

  it('document d’agrégation et format inconnu', async () => {
    const doc = JSON.stringify({ format: 'comtaple.releve-agregation/1', comptes: [] });
    const isole = await lireReleveIsole(Buffer.from(doc), SANS_PROFIL, RELEVE);
    expect(isole.ok && isole.valeur.etat === 'lu' && isole.valeur.rapport).toEqual(json(lireReleveAgregation(doc)));
    expect(await lireReleveIsole(randomBytes(4096), SANS_PROFIL, RELEVE)).toMatchObject({ ok: true, valeur: { etat: 'format_inconnu' } });
    expect(await lireReleveIsole(Buffer.alloc(0), SANS_PROFIL, RELEVE)).toMatchObject({ ok: true, valeur: { etat: 'format_inconnu' } });
  });

  it('gros relevé (100 000 mouvements, environ 36 Mo de résultat) : lu sous la borne des relevés, refusé sous la borne des pièces', async () => {
    const r = releve('csv', 100_000);
    const octets = Buffer.from(r.contenu, 'utf8');
    const isole = await lireReleveIsole(octets, SANS_PROFIL, RELEVE);
    expect(isole.ok).toBe(true);
    if (!isole.ok || isole.valeur.etat !== 'lu') throw new Error('lecture attendue');
    expect(isole.valeur.rapport.mouvements).toHaveLength(100_000);
    expect(new Set(isole.valeur.rapport.mouvements.map((m) => m.cleIdempotence)).size).toBe(100_000);
    expect(isole.valeur.rapport.comptes[0]).toMatchObject({ nbMouvements: 100_000 });
    const taille = Buffer.byteLength(JSON.stringify(isole.valeur));
    console.info(`[mesure] relevé CSV de 100 000 mouvements : entrée ${(octets.length / 1048576).toFixed(1)} Mo, résultat ${(taille / 1048576).toFixed(1)} Mo (${Math.round(taille / 100_000)} octets par mouvement), ${isole.dureeMs} ms`);
    expect(taille).toBeGreaterThan(8 * 1024 * 1024);
    // Avec la borne de sortie des PIÈCES (8 Mo), ce relevé légitime serait refusé : d'où une borne propre aux relevés.
    const borne = await lireReleveIsole(octets, SANS_PROFIL, { sortieMaxOctets: 8 * 1024 * 1024 });
    expect(borne).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
    expect(MOUVEMENTS_MAX_RELEVE * (taille / 100_000)).toBeLessThan(192 * 1024 * 1024);
  }, 120_000);
});

describe('relevés bancaires — fichiers hostiles (enfant réel)', () => {
  it('camt.053 avec entité externe (XXE) et bombe d’entités : refusés sans rien résoudre, ni fichier ni réseau', async () => {
    const avant = connexionsRecues;
    for (const [nom, contenu] of [['xxe', camtXxe()], ['bombe', camtBombe()]] as const) {
      const debut = Date.now();
      const isole = await lireReleveIsole(Buffer.from(contenu, 'utf8'), SANS_PROFIL, RELEVE);
      expect(isole.ok, nom).toBe(true);
      if (!isole.ok || isole.valeur.etat !== 'lu') throw new Error(`rapport attendu (${nom})`);
      expect(isole.valeur.rapport, nom).toMatchObject({ lisible: false, mouvements: [] });
      expect(isole.valeur.rapport.anomalies.some((a) => a.gravite === 'bloquante'), nom).toBe(true);
      expect(JSON.stringify(isole.valeur), nom).not.toContain(SECRET_FICHIER);
      expect(JSON.stringify(isole.valeur).length, nom).toBeLessThan(20_000);
      expect(Date.now() - debut, nom).toBeLessThan(10_000);
    }
    expect(connexionsRecues).toBe(avant);
  });

  it('camt.053 imbriqué sur 50 000 niveaux, OFX malformé, CSV aux lignes géantes : issue bornée, jamais de plantage du parent', async () => {
    const cas: Array<[string, string]> = [['camt profond', camtProfond()], ['ofx malformé', ofxMalforme()], ['csv lignes géantes', csvLignesGeantes()], ['csv une seule ligne', csvUneSeuleLigne()]];
    for (const [nom, contenu] of cas) {
      const isole = await lireReleveIsole(Buffer.from(contenu, 'utf8'), SANS_PROFIL, { ...RELEVE, dureeMaxMs: 30_000 });
      // Deux issues acceptables : un résultat validé par schéma (relevé illisible, colonnes à confirmer, libellés bornés) ou un arrêt borné.
      if (isole.ok) {
        const v = isole.valeur;
        if (v.etat === 'lu') {
          for (const m of v.rapport.mouvements) expect(m.libelle.length, nom).toBeLessThanOrEqual(500);
          expect(JSON.stringify(v).length, nom).toBeLessThan(5_000_000);
        } else expect(['format_inconnu', 'profil_a_confirmer'], nom).toContain(v.etat);
      } else {
        expect(['delai', 'memoire', 'plantage', 'sortie_trop_grande'], nom).toContain(isole.cause);
        expect(motifEchecReleve(isole.cause), nom).not.toMatch(TECHNIQUE);
      }
      expect(isole.dureeMs, nom).toBeLessThan(31_000);
    }
    // Le processus de test (le « worker ») est vivant et lit encore un relevé sain.
    expect(await lireReleveIsole(Buffer.from(camtSain()), SANS_PROFIL, RELEVE)).toMatchObject({ ok: true, valeur: { etat: 'lu', rapport: { lisible: true } } });
  }, 150_000);

  it('enfant hostile : boucle, mémoire, sortie hors schéma, plantage → cause typée ; motifs en français sans terme technique', async () => {
    const lancer = (mode: string, limites: OptionsAnalyse = {}) => lireReleveIsole(Buffer.from(`%%HOSTILE:${mode}\n`), SANS_PROFIL, { ...hostile, ...limites });
    expect(await lancer('boucle', { dureeMaxMs: 1200 })).toMatchObject({ ok: false, cause: 'delai' });
    expect(await lancer('tas', { tasMaxMo: 64, dureeMaxMs: 20_000 })).toMatchObject({ ok: false, cause: 'memoire' });
    expect(await lancer('sortie-enorme', { sortieMaxOctets: 1024 * 1024, dureeMaxMs: 20_000 })).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
    // Un résultat de PIÈCE (ou n'importe quoi d'autre) n'est pas un résultat de relevé.
    for (const mode of ['sain', 'sortie-invalide', 'sortie-hors-schema', 'cles-en-trop']) expect(await lancer(mode), mode).toMatchObject({ ok: false, cause: 'sortie_invalide' });
    expect(await lancer('exception')).toMatchObject({ ok: false, cause: 'plantage' });
    for (const cause of ['delai', 'memoire', 'sortie_trop_grande', 'sortie_invalide', 'plantage'] as const) {
      expect(motifEchecReleve(cause)).toMatch(/^Lecture du relevé interrompue : .* Le fichier est conservé tel quel ; aucun mouvement n’a été importé\.$/);
      expect(motifEchecReleve(cause)).not.toMatch(TECHNIQUE);
      expect(motifEchecFec(cause)).toMatch(/^Import interrompu : .* Le fichier est conservé tel quel/);
      expect(motifEchecFec(cause)).not.toMatch(TECHNIQUE);
    }
  });
});

describe('FEC — enfant réel, analyse en flux', () => {
  const directe = async (contenu: Uint8Array, nomFichier?: string) => {
    const lignes: LigneFec[] = [];
    const rapport = await analyserFec(enBlocs(contenu), { exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin, ...(nomFichier ? { nomFichier } : {}), surLigne: (l) => void lignes.push(l) });
    return { lignes, rapport };
  };
  const isolee = async (source: AsyncIterable<Uint8Array>, nomFichier: string | null = null, options: OptionsAnalyse = {}, surLot?: (l: LigneFec[]) => Promise<void>) => {
    const lignes: LigneFec[] = [];
    const lots: number[] = [];
    const issue = await analyserFecIsole(
      source,
      {
        exerciceDebut: EXERCICE.debut,
        exerciceFin: EXERCICE.fin,
        nomFichier,
        surLot: async (l) => {
          lots.push(l.length);
          lignes.push(...l);
          if (surLot) await surLot(l);
        },
      },
      options,
    );
    return { issue, lignes, lots };
  };

  it('jeu sain (formats débit/crédit et montant/sens, UTF-8 et Latin-9, avec anomalies) : mêmes lignes dans le même ordre, même rapport', async () => {
    const jeux = [
      genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 3 }),
      genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 4, format: { separateur: 'pipe', encodage: 'latin9', variante: 'montant_sens', decimale: '.' } }),
      genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 5, anomalies: ['desequilibre', 'hors_exercice', 'doublon', 'rupture_sequence'] }),
    ];
    for (const jeu of jeux) {
      const d = await directe(jeu.contenu, jeu.nomFichier);
      const i = await isolee(enBlocs(jeu.contenu, 7919), jeu.nomFichier);
      expect(i.issue.ok).toBe(true);
      expect(i.lignes).toEqual(json(d.lignes));
      expect(i.issue.ok && json(i.issue.valeur)).toEqual(json(d.rapport));
      expect(Math.max(...i.lots)).toBeLessThanOrEqual(500);
    }
  });

  it('fichiers malformés : vide, binaire, UTF-16, ligne de trois mégaoctets — même rapport que la lecture directe, sans plantage', async () => {
    const entete = 'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise\n';
    const cas: Array<[string, Buffer]> = [
      ['vide', Buffer.alloc(0)],
      ['binaire', randomBytes(200_000)],
      ['utf-16', Buffer.from(`﻿${entete}`, 'utf16le')],
      ['ligne géante', Buffer.from(`${entete}VT\tVentes\t1\t20250105\t411000\tClients\t\t\tF1\t20250105\t${'A'.repeat(3 * TAILLE_MAX_LIGNE_FEC)}\t10,00\t0,00\t\t\t20250105\t\t\n`)],
      ['cellules innombrables', Buffer.from(`${entete}${'x\t'.repeat(400_000)}\n`)],
    ];
    for (const [nom, contenu] of cas) {
      const d = await directe(contenu);
      const i = await isolee(enBlocs(contenu));
      expect(i.issue.ok, nom).toBe(true);
      expect(i.lignes, nom).toEqual(json(d.lignes));
      expect(i.issue.ok && json(i.issue.valeur), nom).toEqual(json(d.rapport));
    }
    const geante = await isolee(enBlocs(cas[3]![1]));
    expect(geante.issue.ok && geante.issue.valeur.nbAnomaliesParCode).toMatchObject({ LIGNE_TROP_LONGUE: 1 });
  });

  it('contre-pression : tant que le parent n’a pas traité un lot, la source n’est presque plus lue', async () => {
    const jeu = fec(40_000);
    let lus = 0;
    async function* source() {
      for await (const bloc of enBlocs(jeu.contenu, 65_536)) {
        lus += bloc.length;
        yield bloc;
      }
    }
    let luPendantLaPause = -1;
    const i = await isolee(source(), null, {}, async () => {
      if (luPendantLaPause >= 0) return;
      await new Promise((ok) => setTimeout(ok, 1500)); // le parent « insère en base » : rien ne doit s'accumuler pendant ce temps
      luPendantLaPause = lus;
    });
    expect(i.issue.ok).toBe(true);
    expect(i.lignes.length).toBeGreaterThan(100_000);
    expect(jeu.contenu.length).toBeGreaterThan(12 * 1024 * 1024);
    // Seuls les tampons des tubes et du flux (quelques centaines de Ko) ont pu être remplis pendant la pause.
    expect(luPendantLaPause).toBeLessThan(3 * 1024 * 1024);
    expect(lus).toBe(jeu.contenu.length);
  }, 120_000);

  it('erreur du parent pendant un lot (annulation, base indisponible) ou de la source : relancée telle quelle, enfant arrêté', async () => {
    const jeu = fec(2000);
    class Annule extends Error {}
    let lots = 0;
    await expect(
      isolee(enBlocs(jeu.contenu), null, {}, async () => {
        if (++lots === 2) throw new Annule('annulé');
      }),
    ).rejects.toBeInstanceOf(Annule);
    expect(lots).toBe(2);
    async function* sourceRompue() {
      yield jeu.contenu.subarray(0, 100_000);
      throw new Error('stockage indisponible');
    }
    await expect(isolee(sourceRompue())).rejects.toThrow('stockage indisponible');
  });

  it('enfant hostile : trames hors schéma, géantes, sans rapport, après le rapport, compte de lignes faux, boucle, mémoire', async () => {
    const lancer = (mode: string, limites: OptionsAnalyse = {}) => isolee(enBlocs(Buffer.from(`%%HOSTILE:${mode}\n`)), null, { ...hostile, dureeMaxMs: 20_000, ...limites });
    for (const mode of ['fec-lot-hors-schema', 'fec-sans-rapport', 'fec-compte-faux', 'fec-apres-rapport', 'fec-trame-inconnue', 'sortie-invalide', 'sain']) {
      const r = await lancer(mode);
      expect(r.issue, mode).toMatchObject({ ok: false });
      expect(['sortie_invalide', 'sortie_trop_grande'], mode).toContain(!r.issue.ok && r.issue.cause);
    }
    expect((await lancer('fec-lot-hors-schema')).lignes).toEqual([]); // un lot invalide n'est jamais remis, même en partie
    expect((await lancer('fec-trame-enorme')).issue).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
    expect((await lancer('sortie-enorme', { sortieMaxOctets: 1024 * 1024 })).issue).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
    expect((await lancer('boucle', { dureeMaxMs: 1200 })).issue).toMatchObject({ ok: false, cause: 'delai' });
    expect((await lancer('fec-lignes-puis-boucle', { dureeMaxMs: 1500 })).issue).toMatchObject({ ok: false, cause: 'delai' });
    expect((await lancer('tas', { tasMaxMo: 64 })).issue).toMatchObject({ ok: false, cause: 'memoire' });
    expect((await lancer('exception')).issue).toMatchObject({ ok: false, cause: 'plantage' });
    // Le « worker » est vivant : une pièce puis un FEC sains sont encore traités.
    expect((await analyserPieceIsolee('application/xml', Buffer.from('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>X-1</ID></Invoice>'))).ok).toBe(true);
    expect((await isolee(enBlocs(fec(50).contenu))).issue.ok).toBe(true);
  }, 120_000);

  it('le processus du worker ne charge aucun lecteur de relevé ni l’analyseur FEC', () => {
    for (const fichier of ['banque.ts', 'import-fec.ts', 'analyse-isolee.ts', 'analyse-types.ts', 'main.ts', 'contexte.ts']) {
      const source = readFileSync(join(ICI, fichier), 'utf8');
      expect(source, fichier).not.toMatch(/from '\.\/(releve-contenu|fec-contenu|analyse-contenu|analyse-enfant|analyse-verrou|pdf)\.js'|\b(lireCamt053|lireOfx|lireCsvBanque|lireReleveAgregation|decoderTexteReleve|detecterFormatReleve|proposerProfilCsv|analyserFec|analyserXmlSecurise)\b/);
    }
  });
});

describe('chaînes complètes importerReleve et importerFec — PostgreSQL réel', () => {
  chargerEnvLocal();
  const cfg = lireConfig();
  let admin: pg.Client;
  let c: Contexte;
  let cabinet = '';
  let entite = '';
  let exercice = '';
  const contenus = new Map<string, Buffer>();
  const appelsStockage: string[] = [];
  const controlesLances: unknown[] = [];
  /** Appelé pendant la lecture en flux d'un fichier, une fois la moitié des octets remise (essai d'annulation). */
  let aMiParcours: ((cle: string) => Promise<void>) | null = null;

  async function creerLot(type: 'fec' | 'releve_bancaire', nom: string, contenu: Buffer, rapport: Record<string, unknown> = {}): Promise<string> {
    const cle = `essai-isolement-imports/${SEL}/${randomBytes(4).toString('hex')}-${nom}`;
    contenus.set(cle, contenu);
    const fichier = (await admin.query(`insert into fichiers (cabinet_id, sha256, taille, cle_stockage) values ($1, $2, $3, $4) returning id`, [cabinet, randomBytes(32).toString('hex'), contenu.length, cle])).rows[0].id;
    return (
      await admin.query(`insert into lots_import (cabinet_id, entite_id, exercice_id, type, fichier_id, cle_idempotence, actif, statut, rapport) values ($1, $2, $3, $4, $5, $6, false, 'en_attente', $7) returning id`, [
        cabinet, entite, type === 'fec' ? exercice : null, type, fichier, `${SEL}-${randomBytes(6).toString('hex')}`, JSON.stringify({ nomFichier: nom, ...rapport }),
      ])
    ).rows[0].id as string;
  }
  const lot = async (id: string) => (await admin.query('select statut, actif, progression, rapport from lots_import where id = $1', [id])).rows[0] as { statut: string; actif: boolean; progression: number; rapport: Record<string, unknown> };
  const nbLignes = async (id: string) => Number((await admin.query('select count(*)::int as n from lignes_ecriture where lot_import_id = $1', [id])).rows[0].n);
  const nbMouvements = async () => Number((await admin.query('select count(*)::int as n from mouvements_bancaires where entite_id = $1', [entite])).rows[0].n);
  const avecReleve = (analyse: OptionsAnalyse, sortie?: number): Contexte => ({ ...c, analyse, ...(sortie ? { cfg: { ...c.cfg, ANALYSE_RELEVE_SORTIE_MAX_OCTETS: sortie } } : {}) });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: urlBd('admin') });
    await admin.connect();
    cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai isolement imports ${SEL} (fictif)`])).rows[0].id;
    entite = (await admin.query(`insert into entites (cabinet_id, raison_sociale) values ($1, $2) returning id`, [cabinet, `Essai isolement imports ${SEL} (fictif)`])).rows[0].id;
    exercice = (await admin.query('insert into exercices (cabinet_id, entite_id, debut, fin) values ($1, $2, $3, $4) returning id', [cabinet, entite, EXERCICE.debut, EXERCICE.fin])).rows[0].id;
    // Stockage en mémoire, en LECTURE SEULE : toute autre opération (écriture, suppression) lèverait et serait enregistrée.
    const stockage = {
      async lire(cle: string) {
        appelsStockage.push('lire');
        return contenus.get(cle)!;
      },
      async lireFlux(cle: string) {
        appelsStockage.push('lireFlux');
        const octets = contenus.get(cle)!;
        const rappel = aMiParcours;
        return Readable.from(
          (async function* () {
            let prevenu = false;
            for (let i = 0; i < octets.length; i += 65_536) {
              if (!prevenu && rappel && i >= octets.length / 2) {
                prevenu = true;
                await rappel(cle);
              }
              yield octets.subarray(i, i + 65_536);
            }
          })(),
        );
      },
    };
    const lectureSeule = new Proxy(stockage, {
      get: (cible, nom: string) => {
        if (nom in cible) return (cible as Record<string, unknown>)[nom];
        return async () => {
          appelsStockage.push(nom);
          throw new Error(`opération de stockage inattendue : ${nom}`);
        };
      },
    }) as unknown as Stockage;
    const taches = { executerControles: async (t: unknown) => void controlesLances.push(t) } as unknown as Files;
    c = { cfg, bd: creerAccesBd(urlBd('worker'), { max: 3 }), stockage: lectureSeule, taches };
  });
  afterAll(async () => {
    // Données volumineuses propres à ce test (aucune autre n'est touchée) ; le cabinet d'essai reste, comme pour les autres essais.
    for (const requete of [
      'delete from lignes_ecriture where cabinet_id = $1',
      'delete from mouvements_lots where cabinet_id = $1',
      'delete from mouvements_bancaires where cabinet_id = $1',
      'delete from releves_bancaires where cabinet_id = $1',
    ]) await admin.query(requete, [cabinet]).catch(() => undefined);
    await c.bd.fermer();
    await admin.end();
  });

  it('relevé sain (camt.053, 2 000 mouvements) : mêmes données en base que la lecture directe ; réimport sans doublon', async () => {
    const r = releve('camt.053', 2000, 21);
    const direct = lireCamt053(r.contenu);
    const id = await creerLot('releve_bancaire', r.nomFichier, Buffer.from(r.contenu, 'utf8'));
    await importerReleve(c, { cabinetId: cabinet, lotImportId: id });
    const l = await lot(id);
    expect(l).toMatchObject({ statut: 'termine', actif: true, progression: 2000 });
    expect(l.rapport).toMatchObject({ format: 'camt.053', nbMouvements: 2000, nbNouveaux: 2000, nbDejaConnus: 0, lisible: true, nomFichier: r.nomFichier });
    const enBase = (await admin.query('select rang, cle_idempotence, montant::text as montant, libelle, to_char(date_operation, \'YYYY-MM-DD\') as date, brut from mouvements_bancaires where lot_import_id = $1 order by rang', [id])).rows;
    expect(enBase.map((m) => m.cle_idempotence)).toEqual(direct.mouvements.map((m) => m.cleIdempotence));
    expect(enBase.map((m) => m.brut)).toEqual(json(direct.mouvements));
    expect(enBase.map((m) => m.date)).toEqual(direct.mouvements.map((m) => m.dateOperation));
    const comptes = (await admin.query('select iban, cadrage, nb_mouvements, brut from releves_bancaires where lot_import_id = $1', [id])).rows;
    expect(comptes.map((k) => k.brut)).toEqual(json(direct.comptes));
    // Même fichier importé une seconde fois : aucun mouvement dupliqué.
    const bis = await creerLot('releve_bancaire', r.nomFichier, Buffer.from(r.contenu, 'utf8'));
    await importerReleve(c, { cabinetId: cabinet, lotImportId: bis });
    expect((await lot(bis)).rapport).toMatchObject({ nbMouvements: 2000, nbNouveaux: 0, nbDejaConnus: 2000 });
    expect(await nbMouvements()).toBe(2000);
    // Tâche rejouée sur un lot terminé : sans effet.
    await importerReleve(c, { cabinetId: cabinet, lotImportId: id });
    expect(await lot(id)).toMatchObject({ statut: 'termine', progression: 2000 });
  });

  it('relevés hostiles et bornes dépassées : échec explicite en français, fichier conservé, import suivant non affecté', async () => {
    const avant = await nbMouvements();
    const cas: Array<{ nom: string; contenu: Buffer; contexte?: Contexte; motif: RegExp }> = [
      { nom: 'xxe.xml', contenu: Buffer.from(camtXxe()), motif: /^Relevé illisible$/ },
      { nom: 'bombe.xml', contenu: Buffer.from(camtBombe()), motif: /^Relevé illisible$/ },
      { nom: 'binaire.dat', contenu: randomBytes(5000), motif: /^Format de relevé non reconnu/ },
      { nom: 'boucle.csv', contenu: Buffer.from('%%HOSTILE:boucle\n'), contexte: avecReleve({ ...hostile, dureeMaxMs: 1500 }), motif: /dépassé la durée autorisée/ },
      { nom: 'memoire.csv', contenu: Buffer.from('%%HOSTILE:tas\n'), contexte: avecReleve({ ...hostile, tasMaxMo: 64, dureeMaxMs: 20_000 }), motif: /dépassé la mémoire autorisée/ },
      { nom: 'exception.csv', contenu: Buffer.from('%%HOSTILE:exception\n'), contexte: avecReleve(hostile), motif: /de façon sûre/ },
      { nom: 'mensonge.csv', contenu: Buffer.from('%%HOSTILE:sortie-hors-schema\n'), contexte: avecReleve(hostile), motif: /de façon sûre/ },
      { nom: 'trop-gros.csv', contenu: Buffer.from(releve('csv', 3000).contenu), contexte: avecReleve({}, 200_000), motif: /trop de mouvements .* Scindez-le/ },
    ];
    const sain = releve('ofx', 40, 33);
    const ids: string[] = [];
    for (const k of cas) ids.push(await creerLot('releve_bancaire', k.nom, k.contenu));
    const idSain = await creerLot('releve_bancaire', sain.nomFichier, Buffer.from(sain.contenu));
    // Comme la file du worker : les imports hostiles et l'import sain en même temps ; aucune tâche ne lève (rien à retenter).
    const issues = await Promise.allSettled([...cas.map((k, i) => importerReleve(k.contexte ?? c, { cabinetId: cabinet, lotImportId: ids[i]! })), importerReleve(c, { cabinetId: cabinet, lotImportId: idSain })]);
    expect(issues.map((i) => i.status)).toEqual(issues.map(() => 'fulfilled'));
    for (const [i, k] of cas.entries()) {
      const l = await lot(ids[i]!);
      expect(l, k.nom).toMatchObject({ statut: 'echec', actif: false });
      expect(String(l.rapport.motif), k.nom).toMatch(k.motif);
      expect(JSON.stringify(l.rapport), k.nom).not.toMatch(TECHNIQUE);
      expect(JSON.stringify(l.rapport), k.nom).not.toContain(SECRET_FICHIER);
      expect(l.rapport.nomFichier, k.nom).toBe(k.nom);
    }
    expect((await lot(ids[0]!)).rapport.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ gravite: 'bloquante' })]));
    expect(await lot(idSain)).toMatchObject({ actif: true, progression: 40 });
    expect((await lot(idSain)).statut).toMatch(/^termine/);
    expect(await nbMouvements()).toBe(avant + 40);
    expect(contenus.size).toBeGreaterThanOrEqual(cas.length + 1);
    expect(new Set(appelsStockage)).toEqual(new Set(['lire']));
    const journal = (await admin.query(`select details->>'motif' as motif from journal_audit where cabinet_id = $1 and action = 'import.releve.echec'`, [cabinet])).rows;
    expect(journal.length).toBeGreaterThanOrEqual(cas.length);
    // Un import en échec peut être relancé (statut « echec » repris) : avec l'enfant réel, le même fichier hostile est simplement non reconnu.
    await importerReleve(c, { cabinetId: cabinet, lotImportId: ids[3]! });
    expect(String((await lot(ids[3]!)).rapport.motif)).toMatch(/Colonnes du fichier CSV non reconnues|Format de relevé non reconnu/);
  }, 120_000);

  let lotActif = '';
  let lignesActives = 0;
  it('FEC synthétique de plus de 100 000 lignes : import complet, progression, rapport et lignes identiques à la lecture directe', async () => {
    const jeu = fec(40_000);
    const contenu = Buffer.from(jeu.contenu);
    const attendu: LigneFec[] = [];
    const rapportDirect = await analyserFec(enBlocs(jeu.contenu), { exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin, nomFichier: jeu.nomFichier, surLigne: (l) => void attendu.push(l) });
    expect(attendu.length).toBeGreaterThan(100_000);
    const id = await creerLot('fec', jeu.nomFichier, contenu);
    const progressions = new Set<number>();
    let sondeOccupee = false;
    const sonde = setInterval(() => {
      if (sondeOccupee) return;
      sondeOccupee = true;
      void lot(id)
        .then((l) => progressions.add(l.progression))
        .catch(() => undefined)
        .finally(() => (sondeOccupee = false));
    }, 150);
    const memoireAvant = process.memoryUsage().rss;
    const debut = performance.now();
    await importerFec(c, { cabinetId: cabinet, lotImportId: id });
    const duree = Math.round(performance.now() - debut);
    clearInterval(sonde);
    while (sondeOccupee) await new Promise((ok) => setTimeout(ok, 20));
    const memoireApres = process.memoryUsage().rss;
    // RÉFÉRENCE « avant » : la même analyse DANS le processus (comme avant l'isolement), avec les mêmes insertions par lots
    // de 1 000 dans une transaction, sur un lot à part (jamais actif). Sert uniquement à mesurer le surcoût de l'enfant.
    const temoin = (await admin.query(`insert into lots_import (cabinet_id, entite_id, exercice_id, type, cle_idempotence, actif, statut) values ($1, $2, $3, 'fec', $4, false, 'annule') returning id`, [cabinet, entite, exercice, `${SEL}-reference-mesure`])).rows[0].id as string;
    const debutReference = performance.now();
    await c.bd.avecContexte({ cabinetId: cabinet }, async (tx) => {
      let tampon: LigneFec[] = [];
      const vider = async () => {
        if (!tampon.length) return;
        await tx.insert(s.lignesEcriture).values(tampon.map((x) => ({ ...x, cabinetId: cabinet, entiteId: entite, exerciceId: exercice, lotImportId: temoin })));
        tampon = [];
      };
      await analyserFec(Readable.from(enBlocs(jeu.contenu)) as AsyncIterable<Uint8Array>, {
        exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin, nomFichier: jeu.nomFichier,
        surLigne: async (x) => {
          tampon.push(x);
          if (tampon.length >= 1000) await vider();
        },
      });
      await vider();
    });
    const dureeReference = Math.round(performance.now() - debutReference);
    expect(await nbLignes(temoin)).toBe(attendu.length);
    console.info(
      `[mesure] FEC de ${attendu.length} lignes (${(contenu.length / 1048576).toFixed(1)} Mo), insertions en base comprises — analyse dans le processus (avant) : ${dureeReference} ms ; analyse dans l'enfant (après) : ${duree} ms ; ` +
        `mémoire résidente du parent pendant l'import isolé : ${Math.round(memoireAvant / 1048576)} → ${Math.round(memoireApres / 1048576)} Mo`,
    );
    const l = await lot(id);
    expect(l).toMatchObject({ statut: rapportDirect.anomalies.length > 0 ? 'termine_avec_erreurs' : 'termine', actif: true, progression: attendu.length });
    expect(await nbLignes(id)).toBe(attendu.length);
    const { nomFichier, ...rapport } = l.rapport;
    expect(nomFichier).toBe(jeu.nomFichier);
    expect(rapport).toEqual(json(rapportDirect));
    const sommes = (await admin.query('select sum(debit)::text as debit, sum(credit)::text as credit, min(numero_ligne) as premiere, max(numero_ligne) as derniere, count(distinct numero_ligne)::int as distinctes from lignes_ecriture where lot_import_id = $1', [id])).rows[0];
    expect(sommes).toMatchObject({ debit: rapportDirect.totalDebit, credit: rapportDirect.totalCredit, premiere: attendu[0]!.numeroLigne, derniere: attendu.at(-1)!.numeroLigne, distinctes: attendu.length });
    const echantillon = (await admin.query(`select numero_ligne as "numeroLigne", journal_code as "journalCode", ecriture_num as "ecritureNum", to_char(ecriture_date, 'YYYY-MM-DD') as "ecritureDate", compte_num as "compteNum", comp_aux_num as "compAuxNum", piece_ref as "pieceRef", ecriture_lib as "ecritureLib", debit::text as debit, credit::text as credit from lignes_ecriture where lot_import_id = $1 and numero_ligne % 9973 = 0 order by numero_ligne`, [id])).rows;
    const parNumero = new Map(attendu.map((x) => [x.numeroLigne, x]));
    expect(echantillon.length).toBeGreaterThan(5);
    for (const e of echantillon) expect(parNumero.get(e.numeroLigne)).toMatchObject(e);
    // Progression visible pendant l'import (points de contrôle toutes les 5 000 lignes).
    expect([...progressions].some((p) => p > 0 && p < attendu.length && p % 5000 === 0)).toBe(true);
    expect(controlesLances).toHaveLength(rapportDirect.suffisantPourTravaux ? 1 : 0);
    // Idempotence : la tâche rejouée sur un lot terminé ne fait rien.
    await importerFec(c, { cabinetId: cabinet, lotImportId: id });
    expect(await nbLignes(id)).toBe(attendu.length);
    lotActif = id;
    lignesActives = attendu.length;
  }, 300_000);

  it('FEC hostiles et bornes dépassées : lot en échec avec motif en français, aucune ligne gardée, données actives intactes, reprise possible', async () => {
    const versionAvant = (await admin.query('select version_donnees from exercices where id = $1', [exercice])).rows[0].version_donnees;
    const hostileFec = (extra: OptionsAnalyse = {}): Contexte => ({ ...c, analyseFec: { ...hostile, dureeMaxMs: 20_000, ...extra } });
    const cas: Array<{ nom: string; contenu: Buffer; contexte: Contexte; motif: RegExp }> = [
      { nom: 'boucle.txt', contenu: Buffer.from('%%HOSTILE:boucle\n'), contexte: hostileFec({ dureeMaxMs: 1500 }), motif: /dépassé la durée autorisée/ },
      { nom: 'lignes-puis-boucle.txt', contenu: Buffer.from('%%HOSTILE:fec-lignes-puis-boucle\n'), contexte: hostileFec({ dureeMaxMs: 2000 }), motif: /dépassé la durée autorisée/ },
      { nom: 'memoire.txt', contenu: Buffer.from('%%HOSTILE:tas\n'), contexte: hostileFec({ tasMaxMo: 64 }), motif: /dépassé la mémoire autorisée/ },
      { nom: 'mensonge.txt', contenu: Buffer.from('%%HOSTILE:fec-compte-faux\n'), contexte: hostileFec(), motif: /de façon sûre/ },
      { nom: 'lot-invalide.txt', contenu: Buffer.from('%%HOSTILE:fec-lot-hors-schema\n'), contexte: hostileFec(), motif: /de façon sûre/ },
      { nom: 'exception.txt', contenu: Buffer.from('%%HOSTILE:exception\n'), contexte: hostileFec(), motif: /de façon sûre/ },
    ];
    const ids: string[] = [];
    for (const k of cas) ids.push(await creerLot('fec', k.nom, k.contenu));
    const issues = await Promise.allSettled(cas.map((k, i) => importerFec(k.contexte, { cabinetId: cabinet, lotImportId: ids[i]! })));
    expect(issues.map((i) => i.status)).toEqual(issues.map(() => 'fulfilled')); // aucune tâche en échec : pas de nouvel essai automatique
    for (const [i, k] of cas.entries()) {
      const l = await lot(ids[i]!);
      expect(l, k.nom).toMatchObject({ statut: 'echec', progression: 0 });
      expect(l.rapport, k.nom).toMatchObject({ nomFichier: k.nom, lisible: false });
      expect(String(l.rapport.motif), k.nom).toMatch(/^Import interrompu : /);
      expect(String(l.rapport.motif), k.nom).toMatch(k.motif);
      expect(JSON.stringify(l.rapport), k.nom).not.toMatch(TECHNIQUE);
      expect(await nbLignes(ids[i]!), k.nom).toBe(0);
    }
    // Les données actives du dossier n'ont pas bougé.
    expect(await lot(lotActif)).toMatchObject({ actif: true });
    expect(await nbLignes(lotActif)).toBe(lignesActives);
    expect((await admin.query('select version_donnees from exercices where id = $1', [exercice])).rows[0].version_donnees).toBe(versionAvant);
    // Fichiers malformés lus par l'enfant RÉEL : rapport du moteur, sans plantage.
    const binaire = await creerLot('fec', 'binaire.txt', randomBytes(300_000));
    await importerFec(c, { cabinetId: cabinet, lotImportId: binaire });
    expect(await lot(binaire)).toMatchObject({ statut: 'echec', rapport: { lisible: false } });
    expect(JSON.stringify((await lot(binaire)).rapport)).not.toMatch(/SIGKILL|heap|Unexpected|stack/);
    // Reprise : le même lot, relancé avec l'enfant réel, est retraité (ici, un fichier qui n'est pas un FEC : échec du moteur, proprement).
    await importerFec(c, { cabinetId: cabinet, lotImportId: ids[0]! });
    const repris = await lot(ids[0]!);
    expect(repris.statut).toBe('echec');
    expect(repris.rapport).toHaveProperty('nbAnomaliesParCode');
    expect(new Set(appelsStockage)).toEqual(new Set(['lire', 'lireFlux']));
  }, 120_000);

  it('annulation demandée pendant l’import d’un FEC : aucune ligne conservée, statut « annule » préservé, données actives intactes', async () => {
    const jeu = fec(8000, 12);
    const id = await creerLot('fec', jeu.nomFichier, Buffer.from(jeu.contenu));
    aMiParcours = async () => {
      await admin.query(`update lots_import set statut = 'annule' where id = $1`, [id]);
    };
    try {
      await importerFec(c, { cabinetId: cabinet, lotImportId: id });
    } finally {
      aMiParcours = null;
    }
    expect(await lot(id)).toMatchObject({ statut: 'annule', actif: false });
    expect(await nbLignes(id)).toBe(0);
    expect(await lot(lotActif)).toMatchObject({ actif: true });
    expect(await nbLignes(lotActif)).toBe(lignesActives);
    // Nouvel import après l'annulation : il aboutit et devient la version active.
    const suivant = await creerLot('fec', jeu.nomFichier, Buffer.from(jeu.contenu));
    await importerFec(c, { cabinetId: cabinet, lotImportId: suivant });
    expect((await lot(suivant)).actif).toBe(true);
    expect(await nbLignes(suivant)).toBeGreaterThan(15_000);
    expect(await lot(lotActif)).toMatchObject({ actif: false });
  }, 120_000);
});
