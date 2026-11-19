/**
 * Analyse isolée des pièces — processus enfant RÉEL (fichier compilé `dist/analyse-enfant.js` : `pnpm run build`
 * d'abord) et PostgreSQL réel pour la chaîne complète. Autonome : cabinet, dossier et pièces PROPRES À CE TEST ; ni
 * stockage objet, ni antivirus, ni service OCR réels (stockage en mémoire, antivirus non obligatoire dans le contexte du
 * test, service OCR remplacé par un serveur local du test).
 *
 * Les comportements hostiles (boucle, débordement, sortie invalide, tentative d'évasion) sont joués par
 * `essais/enfant-hostile.mjs`, lancé avec exactement les mêmes options que l'enfant réel.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as creerServeurHttp, type Server as ServeurHttp } from 'node:http';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { extraireChampsFacture, genererTexteFactureSynthetique, verifierCoherenceFacture } from '@comtaple/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Files, lireConfig, type Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analyserPiece } from './analyse-contenu.js';
import { analyserDocument } from './analyse-document.js';
import { analyserPieceIsolee, argumentsEnfant, ENTREE_ENFANT, executerEnfant, extraireTexteIsole, LIMITES_PAR_DEFAUT, motifEchecAnalyse, schemaResultatPiece } from './analyse-isolee.js';
import type { Contexte } from './contexte.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '../../..');
const HOSTILE = resolve(ICI, '../essais/enfant-hostile.mjs');
const hostile = { entree: HOSTILE, lecturesSupplementaires: [dirname(HOSTILE)] };
const SEL = randomBytes(4).toString('hex');
/** Variables que le worker détient et que l'enfant ne doit jamais voir. */
const SENSIBLES = ['DATABASE_URL', 'DATABASE_URL_WORKER', 'REDIS_URL', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_ENDPOINT', 'JETONS_CLE_CHIFFREMENT', 'IA_OVH_JETON', 'GOOGLE_CLIENT_SECRET', 'NODE_OPTIONS', 'HOME', 'PATH'];

const latin1 = (t: string) =>
  Buffer.from([...t].map((ch) => (ch === '€' ? 0x80 : ch === ' ' || ch === ' ' ? 0x20 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f)))
    .toString('latin1')
    .replace(/[\\()]/g, (m) => `\\${m}`);

/** Assemble un PDF à partir de ses objets (table des références comprise). Un objet peut être binaire. */
function assemblerPdf(objets: Array<string | Buffer>, racine = '/Root 1 0 R'): Buffer {
  const parties: Buffer[] = [Buffer.from(`%PDF-1.7\n%${SEL}\n`, 'latin1')];
  const decalages: number[] = [];
  let position = parties[0]!.length;
  objets.forEach((o, i) => {
    decalages.push(position);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
    parties.push(b);
    position += b.length;
  });
  parties.push(Buffer.from(`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objets.length + 1} ${racine} >>\nstartxref\n${position}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parties);
}
const flux = (dictionnaire: string, donnees: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionnaire} /Length ${donnees.length} >>\nstream\n`, 'latin1'), donnees, Buffer.from('\nendstream', 'latin1')]);
const POLICE = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** PDF à couche texte, une page par tableau de lignes ; `jointe` ajoute un fichier embarqué (Factur-X). */
function pdfTexte(pages: string[][], jointe?: { nom: string; contenu: string }): Buffer {
  const n = pages.length;
  const objets: Array<string | Buffer> = ['', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`, POLICE];
  for (const [i, lignes] of pages.entries()) {
    objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objets.push(flux('', Buffer.from(`BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${latin1(l)}) Tj T*`).join('\n')}\nET`, 'latin1')));
  }
  let noms = '';
  if (jointe) {
    const base = objets.length;
    objets.push(flux('/Type /EmbeddedFile /Subtype /text#2Fxml', Buffer.from(jointe.contenu, 'utf8')));
    objets.push(`<< /Type /Filespec /F (${jointe.nom}) /UF (${jointe.nom}) /AFRelationship /Data /EF << /F ${base + 1} 0 R /UF ${base + 1} 0 R >> >>`);
    noms = ` /Names << /EmbeddedFiles << /Names [(${jointe.nom}) ${base + 2} 0 R] >> >>`;
  }
  objets[0] = `<< /Type /Catalog /Pages 2 0 R${noms} >>`;
  return assemblerPdf(objets);
}

/** Bombe de décompression : un flux de page d'environ 1 Mo qui se déploie en `mo` Mo d'opérateurs de texte. */
function pdfBombe(mo: number): Buffer {
  const motif = Buffer.from('BT /F1 10 Tf 50 800 Td (AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) Tj ET\n', 'latin1');
  const clair = Buffer.alloc(mo * 1024 * 1024);
  for (let i = 0; i < clair.length; i += motif.length) motif.copy(clair, i);
  return assemblerPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    POLICE,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>',
    flux('/Filter /FlateDecode', deflateSync(clair, { level: 9 })),
  ]);
}

const facture = genererTexteFactureSynthetique({ graine: 4217 });
const lignesFacture = facture.pages[0]!.texte.split('\n');
const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument><ram:ID>FX-${SEL}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261105</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Papeterie d’essai (fictive)</ram:Name></ram:SellerTradeParty></ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax><ram:CalculatedAmount>20.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>100.00</ram:BasisAmount><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount><ram:GrandTotalAmount>120.00</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
const UBL = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>UBL-${SEL}</ID><IssueDate>2026-11-05</IssueDate><DocumentCurrencyCode>EUR</DocumentCurrencyCode><LegalMonetaryTotal><TaxExclusiveAmount currencyID="EUR">50.00</TaxExclusiveAmount><TaxInclusiveAmount currencyID="EUR">60.00</TaxInclusiveAmount></LegalMonetaryTotal></Invoice>`;
const SECRET_FICHIER = `contenu-secret-${SEL}`;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let dossierTemporaire = '';
let fichierInterdit = '';
let serveur: Server;
let port = 0;
let connexionsRecues = 0;

beforeAll(async () => {
  expect(existsSync(ENTREE_ENFANT), 'le point d’entrée compilé de l’enfant doit exister : lancer « pnpm run build »').toBe(true);
  // Un enfant compilé plus ancien que ses sources testerait un autre code que celui du dépôt.
  for (const source of ['analyse-enfant.ts', 'analyse-contenu.ts', 'analyse-verrou.ts', 'pdf.ts']) {
    expect(statSync(join(ICI, '../dist', source.replace(/\.ts$/, '.js'))).mtimeMs, `dist périmé pour ${source} : relancer « pnpm run build »`).toBeGreaterThanOrEqual(statSync(join(ICI, source)).mtimeMs);
  }
  dossierTemporaire = mkdtempSync(join(tmpdir(), 'comtaple-isolement-'));
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

describe('enfant réel — pièces saines : même extraction que la lecture directe', () => {
  it('PDF à couche texte (2 pages) : pages, lignes et champs identiques, valeurs attendues du jeu synthétique', async () => {
    const pdf = pdfTexte([lignesFacture, ['Conditions générales de vente', `Référence ${SEL}`]]);
    const direct = json(await analyserPiece('application/pdf', pdf));
    const isole = await analyserPieceIsolee('application/pdf', pdf);
    expect(isole.ok && isole.valeur).toEqual(direct);
    expect(direct).toMatchObject({ nbPages: 2, methode: 'couche_texte', moteur: 'pdfjs-dist', lectureImpossible: false });
    expect(direct.pages).toHaveLength(2);
    expect(direct.champs?.numero?.valeur).toBe(facture.attendu.numero);
    expect(direct.champs?.totalHt?.valeur).toBe(facture.attendu.totalHt);
    expect(direct.champs?.totalTtc?.valeur).toBe(facture.attendu.totalTtc);
  });

  it('XML CII et UBL : champs identiques', async () => {
    for (const xml of [CII, UBL]) {
      const direct = json(await analyserPiece('application/xml', Buffer.from(xml)));
      const isole = await analyserPieceIsolee('application/xml', Buffer.from(xml));
      expect(isole.ok && isole.valeur).toEqual(direct);
      expect(direct).toMatchObject({ methode: 'structure', lectureImpossible: false });
    }
    const cii = await analyserPieceIsolee('application/xml', Buffer.from(CII));
    expect(cii.ok && cii.valeur.champs).toMatchObject({ numero: { valeur: `FX-${SEL}` }, dateEmission: { valeur: '2026-11-05' }, totalHt: { valeur: '100.00' }, totalTva: { valeur: '20.00' }, totalTtc: { valeur: '120.00' }, ventilationTva: [{ taux: '20', base: '100.00', montant: '20.00' }] });
  });

  it('PDF Factur-X (XML embarqué) : la donnée structurée l’emporte sur la couche texte, à l’identique', async () => {
    const pdf = pdfTexte([lignesFacture], { nom: 'factur-x.xml', contenu: CII });
    const direct = json(await analyserPiece('application/pdf', pdf));
    const isole = await analyserPieceIsolee('application/pdf', pdf);
    expect(isole.ok && isole.valeur).toEqual(direct);
    expect(direct).toMatchObject({ methode: 'structure', moteur: 'Factur-X (XML embarqué)', nbPages: 1, champs: { numero: { valeur: `FX-${SEL}` }, totalTtc: { valeur: '120.00' } } });
  });

  it('texte reconnu (sortie OCR) : champs identiques à l’extraction directe', async () => {
    const isole = await extraireTexteIsole(facture.pages);
    expect(isole.ok && isole.valeur.champs).toEqual(json(extraireChampsFacture(facture.pages)));
  });
});

describe('enfant réel — fichiers malformés ou hostiles', () => {
  it('PDF invalide ou tronqué : lecture refusée proprement, sans plantage', async () => {
    const sain = pdfTexte([lignesFacture]);
    for (const pdf of [Buffer.from('%PDF-1.7\nn’importe quoi'), sain.subarray(0, 180), Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(4096)])]) {
      const r = await analyserPieceIsolee('application/pdf', pdf);
      expect(r).toMatchObject({ ok: true, valeur: { lectureImpossible: true, champs: null, pages: [] } });
    }
  });

  it('XML : entité externe (XXE), bombe d’entités, DOCTYPE en UTF-16 — refusés sans rien résoudre', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY e SYSTEM "file://${fichierInterdit}">]><Invoice><ID>&e;</ID></Invoice>`;
    const xxeReseau = `<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY % d SYSTEM "http://127.0.0.1:${port}/x.dtd"> %d;]><Invoice><ID>1</ID></Invoice>`;
    const bombe = `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa">${Array.from({ length: 9 }, (_, i) => `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`).join('')}]><Invoice><ID>&j;</ID></Invoice>`;
    const avant = connexionsRecues;
    for (const contenu of [Buffer.from(xxe), Buffer.from(xxeReseau), Buffer.from(bombe), Buffer.from(`﻿${xxe}`, 'utf16le')]) {
      const r = await analyserPieceIsolee('application/xml', contenu, { dureeMaxMs: 10_000 });
      expect(r).toMatchObject({ ok: true, valeur: { lectureImpossible: true, champs: null } });
      expect(JSON.stringify(r)).not.toContain(SECRET_FICHIER);
      expect(r.dureeMs).toBeLessThan(5000);
    }
    expect(connexionsRecues).toBe(avant);
  });

  it('XML : entité inconnue sans DOCTYPE et imbrication très profonde — aucune valeur inventée, enfant borné', async () => {
    const inconnue = await analyserPieceIsolee('application/xml', Buffer.from('<Invoice><ID>&xxe;</ID></Invoice>'));
    expect(inconnue.ok && inconnue.valeur.champs?.numero?.valeur).not.toContain(SECRET_FICHIER);
    const profond = Buffer.from(`${'<a>'.repeat(200_000)}x${'</a>'.repeat(200_000)}`);
    const r = await analyserPieceIsolee('application/xml', profond, { dureeMaxMs: 10_000 });
    // Refus par le lecteur, ou enfant arrêté : dans les deux cas le parent reste debout et la pièce n'a aucun champ.
    if (r.ok) expect(r.valeur).toMatchObject({ lectureImpossible: true, champs: null });
    else expect(['plantage', 'memoire', 'delai']).toContain(r.cause);
  });

  it('PDF Factur-X dont le XML embarqué porte une entité externe : refusé, pages conservées', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file://${fichierInterdit}">]><CrossIndustryInvoice><ExchangedDocument><ID>&e;</ID></ExchangedDocument></CrossIndustryInvoice>`;
    const r = await analyserPieceIsolee('application/pdf', pdfTexte([lignesFacture], { nom: 'factur-x.xml', contenu: xxe }));
    expect(r).toMatchObject({ ok: true, valeur: { lectureImpossible: true, champs: null, nbPages: 1 } });
    expect(r.ok && r.valeur.pages).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(SECRET_FICHIER);
  });

  it('bombe de décompression PDF (environ 1 Mo → 300 Mo) : l’enfant est arrêté par ses bornes, pas le parent', async () => {
    const bombe = pdfBombe(300);
    expect(bombe.length).toBeLessThan(2 * 1024 * 1024);
    const r = await analyserPieceIsolee('application/pdf', bombe, { dureeMaxMs: 8000, tasMaxMo: 96, memoireMaxMo: 400 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['memoire', 'delai', 'sortie_trop_grande']).toContain(r.cause);
    expect(r.dureeMs).toBeLessThan(12_000);
  });
});

describe('bornes imposées par le parent (enfant hostile)', () => {
  const lancer = (mode: string, limites = {}) => executerEnfant({ entete: { mode }, corps: Buffer.alloc(0), schema: schemaResultatPiece }, { ...hostile, ...limites });

  it('enfant qui boucle : arrêté de force au délai', async () => {
    const r = await lancer('boucle', { dureeMaxMs: 1200 });
    expect(r).toMatchObject({ ok: false, cause: 'delai' });
    expect(r.dureeMs).toBeGreaterThanOrEqual(1150);
    expect(r.dureeMs).toBeLessThan(3000);
  });

  it('enfant qui remplit son tas : arrêté par son plafond de tas', async () => {
    const r = await lancer('tas', { tasMaxMo: 64, dureeMaxMs: 20_000 });
    expect(r).toMatchObject({ ok: false, cause: 'memoire' });
  });

  it('enfant qui alloue hors du tas (tampons) : arrêté par la surveillance de sa mémoire résidente', async () => {
    const r = await lancer('hors-tas', { tasMaxMo: 64, memoireMaxMo: 300, dureeMaxMs: 20_000 });
    expect(r).toMatchObject({ ok: false, cause: 'memoire' });
    expect(r.dureeMs).toBeLessThan(10_000);
  });

  it('sortie surdimensionnée : coupée et rejetée', async () => {
    const r = await lancer('sortie-enorme', { sortieMaxOctets: 2 * 1024 * 1024, dureeMaxMs: 20_000 });
    expect(r).toMatchObject({ ok: false, cause: 'sortie_trop_grande' });
  });

  it('sortie qui n’est pas du JSON, hors schéma, ou au-delà du nombre de pages : rejetée', async () => {
    for (const mode of ['sortie-invalide', 'sortie-hors-schema', 'trop-de-pages']) expect(await lancer(mode), mode).toMatchObject({ ok: false, cause: 'sortie_invalide' });
  });

  it('clés inattendues dans une sortie par ailleurs valide : retirées, jamais transmises', async () => {
    const r = await lancer('cles-en-trop');
    expect(r.ok && r.valeur).toEqual({ pages: [], nbPages: null, champs: null, methode: 'aucune', moteur: 'essai', lectureImpossible: false });
  });

  it('enfant qui plante ou lève : issue « plantage », le message technique ne remonte pas', async () => {
    for (const mode of ['plantage', 'exception']) {
      const r = await lancer(mode);
      expect(r).toMatchObject({ ok: false, cause: 'plantage' });
      expect(JSON.stringify(r)).not.toMatch(/Unexpected|token|offset/);
    }
    for (const cause of ['delai', 'memoire', 'sortie_trop_grande', 'sortie_invalide', 'plantage'] as const) {
      expect(motifEchecAnalyse(cause)).toMatch(/^Analyse interrompue : .* La pièce est conservée telle quelle/);
      expect(motifEchecAnalyse(cause)).not.toMatch(/SIGKILL|heap|JSON|schema|Error|process/i);
    }
  });

  it('le processus de test (le « worker ») est toujours vivant et sait encore analyser une pièce saine', async () => {
    const r = await analyserPieceIsolee('application/xml', Buffer.from(UBL));
    expect(r.ok && r.valeur.champs?.numero?.valeur).toBe(`UBL-${SEL}`);
  });
});

describe('cloisonnement de l’enfant : environnement, fichiers, réseau', () => {
  const rapport = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
  let r: Record<string, string | string[]> = {};
  const aEcrire = () => join(dossierTemporaire, 'ecrit-par-l-enfant.txt');

  beforeAll(async () => {
    // Le parent détient des secrets (ceux du fichier .env chargé, plus des témoins) : aucun ne doit passer.
    chargerEnvLocal();
    process.env.S3_SECRET_KEY ??= `temoin-${SEL}`;
    process.env.IA_OVH_JETON = `temoin-jeton-${SEL}`;
    const issue = await executerEnfant(
      { entete: { mode: 'evasion', port, ecriture: aEcrire(), lectures: { temporaire: fichierInterdit, env: join(RACINE, '.env'), passwd: '/etc/passwd', sourcesWorker: join(ICI, 'main.ts'), basePaquet: join(RACINE, 'packages/db/package.json') } }, corps: Buffer.alloc(0), schema: rapport },
      hostile,
    );
    expect(issue.ok).toBe(true);
    if (issue.ok) r = issue.valeur;
  });

  it('environnement vide : aucune variable du worker, aucun secret, aucun argument', () => {
    // macOS peut ajouter __CF_USER_TEXT_ENCODING à tout processus ; rien d'autre n'est toléré.
    expect((r.environnement as string[]).filter((v) => v !== '__CF_USER_TEXT_ENCODING')).toEqual([]);
    for (const v of SENSIBLES) expect(r.environnement).not.toContain(v);
    expect(r.arguments).toEqual([]);
    const args = argumentsEnfant(LIMITES_PAR_DEFAUT, ENTREE_ENFANT).join(' ');
    expect(args).toContain('--permission');
    expect(args).toContain('--max-old-space-size=512');
    expect(args).not.toMatch(/allow-(fs-write|child-process|worker|addons|wasi|inspector)/);
    // Aucun chemin autorisé en lecture ne contient le fichier .env ni la racine du dépôt entière.
    for (const a of argumentsEnfant(LIMITES_PAR_DEFAUT, ENTREE_ENFANT).filter((x) => x.startsWith('--allow-fs-read='))) {
      const chemin = a.slice('--allow-fs-read='.length);
      expect(chemin).not.toBe(RACINE);
      expect(join(RACINE, '.env').startsWith(`${chemin}/`)).toBe(false);
    }
  });

  it('système de fichiers : lecture hors périmètre et toute écriture refusées par le modèle de permissions de Node', () => {
    for (const nom of ['temporaire', 'env', 'passwd', 'sourcesWorker', 'basePaquet']) expect(r[`lecture:${nom}`], nom).toBe('refuse:ERR_ACCESS_DENIED');
    expect(r.lectureCodeAutorise).toBe('REUSSI'); // témoin : l'enfant lit bien son propre code, le refus n'est pas général
    expect(r.ecriture).toBe('refuse:ERR_ACCESS_DENIED');
    expect(existsSync(aEcrire())).toBe(false);
    expect(readFileSync(fichierInterdit, 'utf8')).toBe(SECRET_FICHIER); // témoin : le fichier existe et le parent le lit
  });

  it('processus fils, fils d’exécution, génération de code : refusés', () => {
    expect(r.processusFils).toBe('refuse:ERR_ACCESS_DENIED');
    expect(r.filExecution).toBe('refuse:ERR_ACCESS_DENIED');
    expect(r.eval).toMatch(/^refuse:/);
    expect(r.liaisonInterne).toMatch(/^refuse:/);
  });

  it('réseau : connexion sortante, écoute, UDP et DNS refusés par le verrou de l’enfant ; rien n’arrive au serveur témoin', async () => {
    for (const nom of ['tcp', 'tcpSocket', 'tls', 'fetch', 'ecoute', 'udp', 'dns', 'dnsRappel', 'dnsResolveur']) expect(r[nom], nom).toMatch(/^refuse:Accès réseau interdit/);
    expect(connexionsRecues).toBe(0);
    // Témoin : le serveur est joignable depuis le parent — le zéro ci-dessus n'est pas un serveur muet.
    const { connect } = await import('node:net');
    await new Promise<void>((ok, ko) => connect(port, '127.0.0.1').once('error', ko).once('close', () => ok()));
    expect(connexionsRecues).toBe(1);
  });

  it('le processus du worker ne charge aucun lecteur de fichier : ni pdf.js ni le module de décodage', () => {
    for (const fichier of ['analyse-document.ts', 'analyse-isolee.ts', 'analyse-types.ts', 'main.ts', 'contexte.ts']) {
      const source = readFileSync(join(ICI, fichier), 'utf8');
      expect(source, fichier).not.toMatch(/from '\.\/(pdf|analyse-contenu|analyse-enfant|analyse-verrou)\.js'|pdfjs-dist|extraireChampsFactur|extraireChampsUbl|extraireChampsFacture\b/);
    }
  });
});

describe('chaîne complète analyserDocument — PostgreSQL réel', () => {
  chargerEnvLocal();
  const cfg = lireConfig();
  let admin: pg.Client;
  let c: Contexte;
  let ocrFaux: ServeurHttp;
  let cabinet = '';
  let entite = '';
  const contenus = new Map<string, Buffer>();
  const lectures: string[] = [];
  const appelsStockage: string[] = [];

  async function deposer(nom: string, contenu: Buffer): Promise<string> {
    const cle = `essai-isolement/${SEL}/${nom}`;
    contenus.set(cle, contenu);
    const fichier = (await admin.query(`insert into fichiers (cabinet_id, sha256, taille, cle_stockage) values ($1, $2, $3, $4) returning id`, [cabinet, randomBytes(32).toString('hex'), contenu.length, cle])).rows[0].id;
    return (await admin.query(`insert into documents (cabinet_id, entite_id, fichier_id, nom_origine) values ($1, $2, $3, $4) returning id`, [cabinet, entite, fichier, nom])).rows[0].id;
  }
  const etat = async (id: string) => {
    const doc = (await admin.query('select d.statut, d.motif_statut, d.nb_pages, f.type_mime_detecte, f.cle_stockage from documents d join fichiers f on f.id = d.fichier_id where d.id = $1', [id])).rows[0];
    const extraction = (await admin.query('select methode, moteur, champs, verifications, statut from extractions where document_id = $1 and actuelle', [id])).rows[0] ?? null;
    const pages = (await admin.query('select numero, texte, lignes, methode from pages_document where document_id = $1 order by numero', [id])).rows;
    return { doc, extraction, pages };
  };
  const analyser = (id: string, analyse?: Contexte['analyse']) => analyserDocument({ ...c, analyse }, { cabinetId: cabinet, documentId: id });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: urlBd('admin') });
    await admin.connect();
    cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai isolement ${SEL} (fictif)`])).rows[0].id;
    entite = (await admin.query(`insert into entites (cabinet_id, raison_sociale) values ($1, $2) returning id`, [cabinet, `Essai isolement ${SEL} (fictif)`])).rows[0].id;
    // Service OCR du test : rend le texte de la facture synthétique, quel que soit le fichier reçu.
    ocrFaux = creerServeurHttp((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ moteur: 'ocr-essai', version_moteur: '0', pages: facture.pages.map((p) => ({ page: p.page, texte: p.texte, lignes: p.texte.split('\n').map((t) => ({ texte: t, boite: [0, 0, 1, 1] })) })) }));
      });
    });
    await new Promise<void>((ok) => ocrFaux.listen(0, '127.0.0.1', ok));
    // Stockage en mémoire, en lecture seule : toute autre opération (suppression, écriture) serait enregistrée.
    const stockage = new Proxy(
      {},
      {
        get: (_, nom: string) => async (cle: string) => {
          appelsStockage.push(nom);
          if (nom !== 'lire') throw new Error(`opération de stockage inattendue : ${nom}`);
          lectures.push(cle);
          return contenus.get(cle)!;
        },
      },
    ) as unknown as Stockage;
    // Antivirus : port fermé et verdict non obligatoire DANS CE CONTEXTE (le test ne dépend pas de ClamAV).
    c = {
      cfg: { ...cfg, ANTIVIRUS_OBLIGATOIRE: false, CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: 1, OCR_URL: `http://127.0.0.1:${(ocrFaux.address() as { port: number }).port}` },
      bd: creerAccesBd(urlBd('worker'), { max: 2 }),
      stockage,
      taches: {} as Files,
    };
  });
  afterAll(async () => {
    // Données propres à ce test (aucune autre n'est touchée).
    await admin.query('delete from passages_recherche where cabinet_id = $1', [cabinet]);
    await admin.query('delete from extractions where cabinet_id = $1', [cabinet]);
    await admin.query('delete from pages_document where cabinet_id = $1', [cabinet]);
    await c.bd.fermer();
    await admin.end();
    await new Promise((ok) => ocrFaux.close(ok));
  });

  it('pièce saine (PDF à couche texte) : même extraction, mêmes pages et mêmes vérifications que la lecture directe', async () => {
    const pdf = pdfTexte([lignesFacture]);
    const direct = json(await analyserPiece('application/pdf', pdf));
    const id = await deposer('saine.pdf', pdf);
    await analyser(id);
    const e = await etat(id);
    expect(e.doc).toMatchObject({ statut: 'a_controler', motif_statut: null, nb_pages: 1, type_mime_detecte: 'application/pdf' });
    expect(e.extraction).toMatchObject({ methode: 'couche_texte', statut: 'projet' });
    expect(e.extraction.moteur).toMatch(/^pdfjs-dist ; IA : /);
    expect(e.extraction.champs).toEqual(direct.champs);
    expect(e.extraction.verifications).toEqual(json(verifierCoherenceFacture(direct.champs!)));
    expect(e.pages.map((p) => ({ page: p.numero, texte: p.texte, lignes: p.lignes }))).toEqual(direct.pages);
    expect(e.extraction.champs.totalTtc.valeur).toBe(facture.attendu.totalTtc);
  });

  it('pièce saine (XML CII) : extraction structurée', async () => {
    const id = await deposer('facture.xml', Buffer.from(CII));
    await analyser(id);
    const e = await etat(id);
    expect(e.doc).toMatchObject({ statut: 'a_controler', motif_statut: null, type_mime_detecte: 'application/xml' });
    expect(e.extraction).toMatchObject({ methode: 'structure', champs: { numero: { valeur: `FX-${SEL}` }, totalTtc: { valeur: '120.00' } } });
  });

  it('image : texte rendu par le service OCR, champs extraits dans un enfant, identiques à l’extraction directe', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
    const id = await deposer('photo.png', png);
    await analyser(id);
    const e = await etat(id);
    expect(e.doc).toMatchObject({ statut: 'a_controler', motif_statut: null, type_mime_detecte: 'image/png' });
    expect(e.extraction.methode).toBe('ocr');
    const pagesOcr = facture.pages.map((p) => ({ page: p.page, texte: p.texte, lignes: p.texte.split('\n').map((t) => ({ texte: t, boite: [0, 0, 1, 1] as [number, number, number, number] })) }));
    expect(e.extraction.champs).toEqual(json(extraireChampsFacture(pagesOcr)));
  });

  it('PDF et XML illisibles ou hostiles : « à contrôler » avec le motif de lecture impossible, sans message de bibliothèque', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY e SYSTEM "file://${fichierInterdit}">]><Invoice><ID>&e;</ID></Invoice>`;
    for (const [nom, contenu] of [['casse.pdf', Buffer.from('%PDF-1.7\nn’importe quoi')], ['xxe.xml', Buffer.from(xxe)]] as const) {
      const id = await deposer(nom, contenu);
      await analyser(id);
      const e = await etat(id);
      expect(e.doc.statut).toBe('a_controler');
      expect(e.doc.motif_statut).toMatch(/^Lecture impossible : le fichier est endommagé/);
      expect(e.doc.motif_statut).not.toMatch(/Exception|Error|DOCTYPE|Invalid|pdf\.js/i);
      expect(e.extraction).toBeNull();
      expect(JSON.stringify(e)).not.toContain(SECRET_FICHIER);
    }
  });

  it('enfant qui boucle, déborde, plante ou ment : statut explicite, fichier conservé, et la pièce suivante est traitée', async () => {
    const attendus = { boucle: /durée autorisée/, tas: /mémoire autorisée/, 'sortie-enorme': /de façon sûre/, 'sortie-hors-schema': /de façon sûre/, exception: /de façon sûre/ } as const;
    const ids: Record<string, string> = {};
    for (const mode of Object.keys(attendus)) ids[mode] = await deposer(`hostile-${mode}.pdf`, Buffer.from(`%PDF-1.7\n%%HOSTILE:${mode}\n`));
    const saine = await deposer('apres.pdf', pdfTexte([lignesFacture]));
    const limites = { ...hostile, dureeMaxMs: 1500, tasMaxMo: 64, sortieMaxOctets: 1024 * 1024 };
    // Comme la file du worker (deux tâches à la fois) : les pièces hostiles ne retardent ni n'empêchent les autres.
    const debut = Date.now();
    const issues = await Promise.allSettled([...Object.values(ids).map((id) => analyser(id, limites)), analyser(saine)]);
    expect(issues.map((i) => i.status)).toEqual(issues.map(() => 'fulfilled')); // aucune tâche en échec : rien à retenter
    expect(Date.now() - debut).toBeLessThan(20_000);
    for (const [mode, motif] of Object.entries(attendus)) {
      const e = await etat(ids[mode]!);
      expect(e.doc.statut, mode).toBe('a_controler');
      expect(e.doc.motif_statut, mode).toMatch(/^Analyse interrompue : /);
      expect(e.doc.motif_statut, mode).toMatch(motif);
      expect(e.doc.motif_statut, mode).toMatch(/La pièce est conservée telle quelle/);
      expect(e.doc.motif_statut, mode).not.toMatch(/SIGKILL|heap|JSON|Error|Unexpected|offset|process|delai|plantage/);
      expect(e.extraction, mode).toBeNull();
      expect(e.pages, mode).toEqual([]);
      expect(contenus.has(e.doc.cle_stockage), mode).toBe(true);
    }
    const e = await etat(saine);
    expect(e.doc).toMatchObject({ statut: 'a_controler', motif_statut: null });
    expect(e.extraction.champs.numero.valeur).toBe(facture.attendu.numero);
    // Le fichier original n'a été que LU : aucune écriture ni suppression dans le stockage, pour aucune pièce.
    expect(new Set(appelsStockage)).toEqual(new Set(['lire']));
    // Une pièce interrompue peut être relancée : avec l'enfant réel, la même pièce est simplement illisible.
    await analyser(ids.boucle!);
    expect((await etat(ids.boucle!)).doc.motif_statut).toMatch(/^Lecture impossible/);
  });
});
