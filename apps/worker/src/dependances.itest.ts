/**
 * Dépendances du worker indisponibles (P3, D-101) — PostgreSQL, ClamAV et stockage objet RÉELS ; la panne est obtenue en
 * pointant le contexte d'UN essai vers un port fermé, un serveur muet ou un serveur qui répond mal (la pile normale n'est
 * jamais arrêtée). Exigence : une pièce n'est jamais perdue ni « bloquée sans explication » ; la panne est dite en français ;
 * le traitement reprend dès que la dépendance revient.
 */
import { randomBytes } from 'node:crypto';
import { createServer as serveurHttp, type Server as ServeurHttp } from 'node:http';
import { createServer, type Server } from 'node:net';
import { genererTexteFactureSynthetique } from '@comtaple/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Files, lireConfig, type Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyserDocument } from './analyse-document.js';
import { analyserAntivirus } from './antivirus.js';
import type { Contexte } from './contexte.js';

chargerEnvLocal();
const cfg = lireConfig();
const SEL = randomBytes(4).toString('hex');
const facture = genererTexteFactureSynthetique({ graine: 7 });

function pdfTexte(lignes: string[], sel: string): Buffer {
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${l.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?')}) Tj T*`).join('\n')}\nET`;
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

let admin: pg.Client;
let cabinet = '';
let entite = '';
const objets = new Map<string, Buffer>();
let stockageEnPanne = false;
const stockage = {
  lire: async (cle: string) => {
    if (stockageEnPanne) throw new Error('stockage objet injoignable (panne simulée)');
    return objets.get(cle)!;
  },
} as unknown as Stockage;
const serveurs: Array<Server | ServeurHttp> = [];
const bd = creerAccesBd(urlBd('worker'), { max: 2 });
const contexte = (surcharge: Partial<typeof cfg>): Contexte => ({ cfg: { ...cfg, ...surcharge }, bd, stockage, taches: {} as Files });

async function portFerme(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function demarrer<T extends Server | ServeurHttp>(s: T): Promise<{ s: T; port: number }> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  serveurs.push(s);
  return { s, port: (s.address() as { port: number }).port };
}

async function deposer(nom: string, contenu: Buffer): Promise<string> {
  const cle = `essai-dependances/${SEL}/${nom}`;
  objets.set(cle, contenu);
  const fichier = (await admin.query(`insert into fichiers (cabinet_id, sha256, taille, cle_stockage) values ($1, $2, $3, $4) returning id`, [cabinet, randomBytes(32).toString('hex'), contenu.length, cle])).rows[0].id;
  return (await admin.query(`insert into documents (cabinet_id, entite_id, fichier_id, nom_origine) values ($1, $2, $3, $4) returning id`, [cabinet, entite, fichier, nom])).rows[0].id;
}
const etat = async (id: string) =>
  (await admin.query('select d.statut, d.motif_statut, f.analyse_antivirus, (select count(*)::int from extractions e where e.document_id = d.id) as extractions, (select methode from pages_document p where p.document_id = d.id limit 1) as methode_pages from documents d join fichiers f on f.id = d.fichier_id where d.id = $1', [id])).rows[0];
const analyser = (c: Contexte, id: string) => analyserDocument(c, { cabinetId: cabinet, documentId: id });
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai dépendances worker ${SEL} (fictif)`])).rows[0].id;
  entite = (await admin.query(`insert into entites (cabinet_id, raison_sociale) values ($1, $2) returning id`, [cabinet, `Essai dépendances worker ${SEL} (fictif)`])).rows[0].id;
});
afterAll(async () => {
  await admin.query('delete from passages_recherche where cabinet_id = $1', [cabinet]);
  await admin.query('delete from extractions where cabinet_id = $1', [cabinet]);
  await admin.query('delete from pages_document where cabinet_id = $1', [cabinet]);
  await bd.fermer();
  await admin.end();
  // Fermeture sans attente : un relais muet garde sa connexion ouverte, et l'arrêt du processus d'essai suffit à tout libérer.
  for (const s of serveurs) { (s as ServeurHttp).closeAllConnections?.(); s.close(); }
});

describe('antivirus (clamd) indisponible', () => {
  it('obligatoire : la pièce reste « reçue » avec un motif explicite, rien n’est extrait, la tâche échoue pour être retentée ; ClamAV revenu, l’analyse aboutit', async () => {
    const id = await deposer('av-obligatoire.pdf', pdfTexte(facture.pages[0]!.texte.split('\n'), `${SEL}-av1`));
    const panne = contexte({ ANTIVIRUS_OBLIGATOIRE: true, CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: await portFerme() });
    await expect(analyser(panne, id)).rejects.toThrow(/Antivirus indisponible/);
    expect(await etat(id)).toMatchObject({ statut: 'recu', motif_statut: 'Analyse antivirus en attente (service indisponible)', extractions: 0, analyse_antivirus: 'non_analyse' }); // valeur initiale : rien n'a été conclu
    // Retour du service (le vrai ClamAV de la pile) : même pièce, même tâche rejouée.
    await analyser(contexte({ ANTIVIRUS_OBLIGATOIRE: true }), id);
    expect(await etat(id)).toMatchObject({ statut: 'a_controler', motif_statut: null, analyse_antivirus: 'sain', extractions: 1 });
  });

  it('non obligatoire : la pièce est traitée mais l’absence d’analyse est CONSIGNÉE (« non_analyse »), jamais présentée comme saine', async () => {
    const id = await deposer('av-facultatif.pdf', pdfTexte(facture.pages[0]!.texte.split('\n'), `${SEL}-av2`));
    await analyser(contexte({ ANTIVIRUS_OBLIGATOIRE: false, CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: await portFerme() }), id);
    expect(await etat(id)).toMatchObject({ statut: 'a_controler', analyse_antivirus: 'non_analyse' });
  });

  it('un service qui accepte la connexion mais ne répond jamais : verdict « indisponible » au délai prévu, jamais « sain »', async () => {
    const muet = await demarrer(createServer((socket) => socket.on('error', () => undefined)));
    const t = Date.now();
    const v = await analyserAntivirus(Buffer.from('contenu quelconque'), '127.0.0.1', muet.port, 600);
    expect(v).toMatchObject({ verdict: 'indisponible', motif: 'délai dépassé' });
    expect(Date.now() - t).toBeLessThan(5_000);
  });

  it('une réponse incompréhensible du service n’est jamais prise pour « sain »', async () => {
    const bavard = await demarrer(createServer((socket) => { socket.on('error', () => undefined); socket.on('data', () => socket.end('stream: ERREUR INATTENDUE\0')); }));
    const v = await analyserAntivirus(Buffer.from('x'), '127.0.0.1', bavard.port, 2_000);
    expect(v.verdict).toBe('indisponible');
  });
});

describe('service OCR indisponible ou défaillant', () => {
  const lire = async (ocrUrl: string, nom: string) => {
    const id = await deposer(nom, png());
    await analyser(contexte({ ANTIVIRUS_OBLIGATOIRE: false, CLAMAV_PORT: await portFerme(), OCR_URL: ocrUrl }), id);
    return { id, e: await etat(id) };
  };

  it('injoignable : la pièce est conservée, motif explicite « OCR indisponible … saisie manuelle », aucune donnée inventée', async () => {
    const { e } = await lire(`http://127.0.0.1:${await portFerme()}`, 'ocr-mort.png');
    expect(e.statut).toBe('a_controler');
    expect(e.motif_statut).toMatch(/^OCR indisponible .* : saisie manuelle nécessaire$/);
    expect(e.extractions).toBe(0);
    expect(e.methode_pages).toBeNull();
  });

  it('répond en erreur HTTP 500, ou répond du JSON invalide : même traitement explicite', async () => {
    const f500 = await demarrer(serveurHttp((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 500; res.end('boum'); }); }));
    const { e: e1 } = await lire(`http://127.0.0.1:${f500.port}`, 'ocr-500.png');
    expect(e1.motif_statut).toMatch(/OCR indisponible \(service OCR : HTTP 500\)/);
    const fjson = await demarrer(serveurHttp((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{pas du json'); }); }));
    const { e: e2 } = await lire(`http://127.0.0.1:${fjson.port}`, 'ocr-json.png');
    expect(e2.motif_statut).toMatch(/OCR indisponible/);
    expect(e2.extractions).toBe(0);
  });

  it('service revenu : la MÊME pièce, reprise, est lue et extraite (méthode « ocr »)', async () => {
    const mort = `http://127.0.0.1:${await portFerme()}`;
    const { id } = await lire(mort, 'ocr-reprise.png');
    const bon = await demarrer(
      serveurHttp((req, res) => {
        req.resume();
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ moteur: 'ocr-essai', version_moteur: '0', pages: facture.pages.map((p) => ({ page: p.page, texte: p.texte, lignes: p.texte.split('\n').map((t) => ({ texte: t, boite: [0, 0, 1, 1] })) })) }));
        });
      }),
    );
    await analyser(contexte({ ANTIVIRUS_OBLIGATOIRE: false, CLAMAV_PORT: await portFerme(), OCR_URL: `http://127.0.0.1:${bon.port}` }), id);
    expect(await etat(id)).toMatchObject({ statut: 'a_controler', motif_statut: null, methode_pages: 'ocr', extractions: 1 });
  });
});

describe('stockage objet indisponible pendant l’analyse', () => {
  it('la pièce n’est pas laissée « en analyse » : elle repasse « reçue » avec un motif lisible ; la tâche échoue (retentée) ; reprise réussie au retour', async () => {
    const id = await deposer('stockage.pdf', pdfTexte(facture.pages[0]!.texte.split('\n'), `${SEL}-st`));
    const c = contexte({ ANTIVIRUS_OBLIGATOIRE: false });
    stockageEnPanne = true;
    await expect(analyser(c, id)).rejects.toThrow(/stockage objet injoignable/);
    stockageEnPanne = false;
    expect(await etat(id)).toMatchObject({ statut: 'recu', motif_statut: 'Analyse interrompue (service momentanément indisponible) : nouvelle tentative automatique', extractions: 0 });
    await analyser(contexte({ ANTIVIRUS_OBLIGATOIRE: false }), id);
    expect(await etat(id)).toMatchObject({ statut: 'a_controler', motif_statut: null, extractions: 1 });
  });

  it('une pièce validée ou remplacée n’est jamais retouchée, même par une tâche rejouée pendant une panne', async () => {
    const id = await deposer('validee.pdf', pdfTexte(facture.pages[0]!.texte.split('\n'), `${SEL}-val`));
    await admin.query(`update documents set statut = 'traite' where id = $1`, [id]);
    stockageEnPanne = true;
    await expect(analyser(contexte({}), id)).resolves.toBeUndefined();
    stockageEnPanne = false;
    expect((await etat(id)).statut).toBe('traite');
  });
});
