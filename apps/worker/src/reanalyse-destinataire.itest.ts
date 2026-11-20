/**
 * Réanalyse explicite du destinataire (D-091) — processus enfant d'analyse RÉEL (`pnpm run build` d'abord) et PostgreSQL
 * réel, rôle du worker. Autonome : cabinet, dossier, pièces et demandes PROPRES À CE TEST ; stockage en mémoire.
 *
 * Les extractions « antérieures à D-084 » sont fabriquées comme l'ancien analyseur les écrivait : les champs de l'analyse
 * actuelle, moins les clés du destinataire.
 */
import { randomBytes } from 'node:crypto';
import { genererTexteFactureSynthetique, VERSION_ANALYSEUR_FACTURE } from '@comtaple/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { chargerEnvLocal } from '@comtaple/db/env';
import { type Files, lireConfig, Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyserPiece } from './analyse-contenu.js';
import type { Contexte } from './contexte.js';
import { InterruptionSimulee, reanalyserDestinataire } from './reanalyse-destinataire.js';
import { rattraper } from './rattrapage.js';

chargerEnvLocal();
const cfg = lireConfig();
const SEL = randomBytes(4).toString('hex');
const CLES_DESTINATAIRE = ['destinataireNom', 'destinataireSiren', 'destinataireSiret', 'destinataireTva', 'destinatairePays', 'destinataireAbstention'];

const latin1 = (t: string) =>
  Buffer.from([...t].map((ch) => (ch === '€' ? 0x80 : ch === ' ' || ch === ' ' ? 0x20 : ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f)))
    .toString('latin1')
    .replace(/[\\()]/g, (m) => `\\${m}`);
/** PDF minimal à couche texte (une page). */
function pdfTexte(lignes: string[], sel: string): Buffer {
  const flux = `BT /F1 10 Tf 50 800 Td 14 TL\n${lignes.map((l) => `(${latin1(l)}) Tj T*`).join('\n')}\nET`;
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
let c: Contexte;
let cabinet = '';
let entite = '';
const contenus = new Map<string, Buffer>();
const avecClient = genererTexteFactureSynthetique({ graine: 77, client: 'facture_a' });
const sansClient = genererTexteFactureSynthetique({ graine: 77, client: 'absent' });
const SIREN_HUMAIN = '732829320';
const empreintesOriginaux = new Map<string, string>();

async function piece(nom: string, o: { client?: boolean; valide?: boolean; humain?: boolean; sansFichier?: boolean; quarantaine?: boolean } = {}) {
  const f = o.client === false ? sansClient : avecClient;
  const lignes = f.pages[0]!.texte.split('\n').map((l) => (f.attendu.numero ? l.replaceAll(f.attendu.numero, `FA-${nom}`) : l));
  const pdf = pdfTexte(lignes, `${SEL}-${nom}`);
  const cle = `essai-reanalyse/${SEL}/${nom}.pdf`;
  if (!o.sansFichier) contenus.set(cle, pdf);
  const fichier = (await admin.query(`insert into fichiers (cabinet_id, sha256, taille, cle_stockage, analyse_antivirus) values ($1, $2, $3, $4, $5) returning id`, [cabinet, randomBytes(32).toString('hex'), pdf.length, cle, o.quarantaine ? 'infecte' : 'sain'])).rows[0].id;
  const doc = (await admin.query(`insert into documents (cabinet_id, entite_id, fichier_id, nom_origine, nature, statut) values ($1, $2, $3, $4, 'facture_vente', $5) returning id`, [cabinet, entite, fichier, `${nom}.pdf`, o.valide ? 'traite' : 'a_controler'])).rows[0].id;
  // Extraction « ancienne » : l'analyse actuelle de la pièce, sans les clés du destinataire.
  const lue = await analyserPiece('application/pdf', pdf);
  const champs: Record<string, unknown> = { ...(lue.champs as unknown as Record<string, unknown>) };
  for (const k of CLES_DESTINATAIRE) delete champs[k];
  if (o.humain) {
    champs.destinataireSiren = { valeur: SIREN_HUMAIN, page: null, extrait: null, boite: null, methode: 'saisie_humaine', confiance: 'non_evaluee', corrigePar: DEMO.remi, corrigeLe: '2026-11-20T09:00:00.000Z', motif: 'Client lu sur le bon de commande', automatique: { valeur: null, versionExtraction: null, versionAnalyseur: null }, desaccord: true };
    champs.destinataireAbstention = null;
    champs.destinataireNonLuAuto = true;
  }
  const extraction = (await admin.query(
    `insert into extractions (cabinet_id, entite_id, document_id, version, methode, moteur, champs, verifications, statut) values ($1, $2, $3, 1, $4, 'pdfjs-dist ; ancien analyseur', $5, '[]', $6) returning id`,
    [cabinet, entite, doc, o.humain ? 'saisie_humaine' : 'couche_texte', JSON.stringify(champs), o.valide ? 'valide' : 'projet'],
  )).rows[0].id as string;
  empreintesOriginaux.set(doc, (await admin.query('select sha256 from fichiers where id = $1', [fichier])).rows[0].sha256);
  return { doc: doc as string, extraction, fichier: fichier as string, champsAvant: champs };
}

async function lot(mode: 'simulation' | 'execution', pieces: Array<{ doc: string; extraction: string }>, simulationId: string | null = null, versionAnalyseur = VERSION_ANALYSEUR_FACTURE) {
  const id = (await admin.query(
    `insert into reanalyses_destinataire (cabinet_id, entite_id, mode, simulation_id, version_analyseur, taille_lot, motif, nb_pieces, demande_par) values ($1, $2, $3, $4, $5, 50, $6, $7, $8) returning id`,
    [cabinet, entite, mode, simulationId, versionAnalyseur, `Essai ${SEL}`, pieces.length, DEMO.remi],
  )).rows[0].id as string;
  for (const p of pieces) {
    await admin.query(
      `insert into reanalyses_destinataire_pieces (cabinet_id, entite_id, lot_id, document_id, extraction_avant_id, version_extraction_avant, version_analyseur, execution) values ($1, $2, $3, $4, $5, 1, $6, $7)`,
      [cabinet, entite, id, p.doc, p.extraction, versionAnalyseur, mode === 'execution'],
    );
  }
  return id;
}
const tache = (lotId: string) => ({ cabinetId: cabinet, lotId });
const rapport = async (lotId: string): Promise<Record<string, any>> =>
  Object.fromEntries((await admin.query('select document_id, resultat, motif, statut, extraction_apres_id, version_extraction_apres, detail from reanalyses_destinataire_pieces where lot_id = $1', [lotId])).rows.map((r) => [r.document_id, r]));
const versions = async (doc: string) => (await admin.query('select id, version, actuelle, statut, methode, moteur, champs from extractions where document_id = $1 order by version', [doc])).rows;
const journal = async (action: string) => Number((await admin.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action = $2`, [cabinet, action])).rows[0].n);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  cabinet = (await admin.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai réanalyse ${SEL} (fictif)`])).rows[0].id;
  entite = (await admin.query(`insert into entites (cabinet_id, raison_sociale, siren) values ($1, $2, $3) returning id`, [cabinet, `Essai réanalyse ${SEL} (fictif)`, avecClient.attendu.emetteurSiren])).rows[0].id;
  const stockage = new Proxy(
    {},
    {
      get: (_, nom: string) => async (cle: string) => {
        if (nom !== 'lire') throw new Error(`opération de stockage inattendue : ${nom}`);
        const contenu = contenus.get(cle);
        if (!contenu) throw new Error('objet absent du stockage');
        return contenu;
      },
    },
  ) as unknown as Stockage;
  c = { cfg: { ...cfg, ANTIVIRUS_OBLIGATOIRE: false }, bd: creerAccesBd(urlBd('worker'), { max: 2 }), stockage, taches: {} as Files };
});
afterAll(async () => {
  await c.bd.fermer();
  await admin.end();
});

describe('réanalyse du destinataire : simulation', () => {
  it('relit les pièces et rapporte ce qui changerait, SANS rien écrire dans les extractions ni dans le journal des extractions', async () => {
    const a = await piece('sim-a');
    const b = await piece('sim-b', { client: false });
    const avant = [await versions(a.doc), await versions(b.doc)];
    const journalAvant = await journal('extraction.destinataire_reanalyse');
    const id = await lot('simulation', [a, b]);
    await reanalyserDestinataire(c, tache(id));
    const r = await rapport(id);
    expect(r[a.doc]).toMatchObject({ resultat: 'destinataire_trouve', statut: 'termine', extraction_apres_id: null, version_extraction_apres: null });
    expect(r[a.doc].detail).toMatchObject({ versionAnalyseur: VERSION_ANALYSEUR_FACTURE, apres: { destinataireNom: avecClient.attendu.destinataireNom }, desaccords: [] });
    expect(r[b.doc]).toMatchObject({ resultat: 'abstention', statut: 'termine' });
    expect(r[b.doc].motif).toMatch(/\S/);
    expect([await versions(a.doc), await versions(b.doc)]).toEqual(avant);
    expect(await journal('extraction.destinataire_reanalyse')).toBe(journalAvant);
    const [fini] = (await admin.query('select statut, resume, termine_le from reanalyses_destinataire where id = $1', [id])).rows;
    expect(fini).toMatchObject({ statut: 'termine', resume: { destinataire_trouve: 1, abstention: 1, inchangee: 0, erreur: 0 } });
    expect(await journal('reanalyse_destinataire.simulee')).toBeGreaterThanOrEqual(1);
  });
});

describe('réanalyse du destinataire : exécution', () => {
  it('crée une NOUVELLE version par pièce ; les anciennes, validées ou non, restent intactes ; la correction humaine n’est jamais écrasée', async () => {
    const auto = await piece('ex-auto');
    const abst = await piece('ex-abst', { client: false });
    const validee = await piece('ex-valide', { valide: true });
    const humaine = await piece('ex-humain', { humain: true });
    const toutes = [auto, abst, validee, humaine];
    const avant = new Map<string, any[]>();
    for (const p of toutes) avant.set(p.doc, await versions(p.doc));
    const id = await lot('execution', toutes, (await lot('simulation', [])).toString());
    await reanalyserDestinataire(c, tache(id));
    const r = await rapport(id);
    expect(Object.values(r).map((x) => x.resultat).sort()).toEqual(['abstention', 'destinataire_trouve', 'destinataire_trouve', 'destinataire_trouve']);

    for (const p of toutes) {
      const v = await versions(p.doc);
      expect(v).toHaveLength(2);
      // L'ancienne version est strictement celle d'avant : mêmes champs, même statut, même identifiant ; seule la bascule `actuelle` change.
      expect({ ...v[0], actuelle: undefined }).toEqual({ ...avant.get(p.doc)![0], actuelle: undefined });
      expect(v[0].actuelle).toBe(false);
      expect(v[1]).toMatchObject({ version: 2, actuelle: true, statut: 'projet' });
      expect(v[1].moteur).toMatch(new RegExp(`réanalyse du destinataire, analyseur ${VERSION_ANALYSEUR_FACTURE}`));
      expect(r[p.doc].version_extraction_apres).toBe(2);
      expect(r[p.doc].extraction_apres_id).toBe(v[1].id);
      // Les champs HORS destinataire sont repris tels quels.
      const { destinataireNom, destinataireSiren, destinataireSiret, destinataireTva, destinatairePays, destinataireAbstention, destinataireNonLuAuto, inchangeDepuis, ...autres } = v[1].champs;
      void [destinataireNom, destinataireSiren, destinataireSiret, destinataireTva, destinatairePays, destinataireAbstention, destinataireNonLuAuto];
      const { destinataireSiren: _s, destinataireAbstention: _a, destinataireNonLuAuto: _n, ...avantAutres } = avant.get(p.doc)![0].champs;
      void [_s, _a, _n];
      expect(autres).toEqual(avantAutres);
      expect(inchangeDepuis).toBe(1);
      // L'original n'est pas touché.
      expect((await admin.query('select f.sha256 from documents d join fichiers f on f.id = d.fichier_id where d.id = $1', [p.doc])).rows[0].sha256).toBe(empreintesOriginaux.get(p.doc));
    }
    // Destinataire trouvé / abstention motivée.
    expect((await versions(auto.doc))[1].champs.destinataireNom.valeur).toBe(avecClient.attendu.destinataireNom);
    const abstVersion = (await versions(abst.doc))[1].champs;
    expect(abstVersion).toMatchObject({ destinataireNom: null, destinataireSiren: null });
    expect(abstVersion.destinataireAbstention).toMatch(/\S/);
    expect(r[abst.doc]).toMatchObject({ resultat: 'abstention' });
    // Extraction validée : la validation reste attachée à la version validée ; la nouvelle version est un projet à revalider.
    expect((await versions(validee.doc))[0]).toMatchObject({ statut: 'valide' });
    expect((await admin.query('select statut from documents where id = $1', [validee.doc])).rows[0].statut).toBe('traite');
    // Correction humaine : conservée, valeur automatique mémorisée à côté, désaccord signalé.
    const h = (await versions(humaine.doc))[1].champs;
    expect(h.destinataireSiren).toMatchObject({ valeur: SIREN_HUMAIN, methode: 'saisie_humaine', corrigePar: DEMO.remi, motif: 'Client lu sur le bon de commande', desaccord: true });
    expect(h.destinataireSiren.automatique).toMatchObject({ valeur: avecClient.attendu.destinataireSiren, versionExtraction: 2, versionAnalyseur: VERSION_ANALYSEUR_FACTURE });
    expect(h.destinataireNom.valeur).toBe(avecClient.attendu.destinataireNom);
    expect(h.destinataireNonLuAuto).toBeUndefined();
    expect(r[humaine.doc].detail.desaccords).toEqual([{ champ: 'destinataireSiren', humain: SIREN_HUMAIN, automatique: avecClient.attendu.destinataireSiren }]);
    // Audit : une ligne par pièce, avec valeurs avant/après et version de l'analyseur.
    const lignes = (await admin.query(`select acteur_type, details from journal_audit where cabinet_id = $1 and action = 'extraction.destinataire_reanalyse' and cible_id = any($2)`, [cabinet, toutes.map((p) => p.doc)])).rows;
    expect(lignes).toHaveLength(4);
    expect(lignes[0]).toMatchObject({ acteur_type: 'systeme', details: { versionAnalyseur: VERSION_ANALYSEUR_FACTURE, versionAvant: 1, versionApres: 2, demandePar: DEMO.remi } });
    expect(lignes.every((l) => l.details.avant && l.details.apres)).toBe(true);
    expect(await journal('reanalyse_destinataire.executee')).toBeGreaterThanOrEqual(1);
  });

  it('idempotence : rejouer le lot terminé ne refait rien ; la base interdit une seconde réanalyse de la même pièce avec la même version de l’analyseur', async () => {
    const p = await piece('idem');
    const id = await lot('execution', [p], await lot('simulation', []));
    await reanalyserDestinataire(c, tache(id));
    await reanalyserDestinataire(c, tache(id));
    await reanalyserDestinataire(c, tache(id));
    expect(await versions(p.doc)).toHaveLength(2);
    expect(await journal('extraction.destinataire_reanalyse')).toBeGreaterThanOrEqual(1);
    const doublon = await lot('execution', [], await lot('simulation', []));
    await expect(
      admin.query(
        `insert into reanalyses_destinataire_pieces (cabinet_id, entite_id, lot_id, document_id, extraction_avant_id, version_extraction_avant, version_analyseur, execution) values ($1, $2, $3, $4, $5, 1, $6, true)`,
        [cabinet, entite, doublon, p.doc, p.extraction, VERSION_ANALYSEUR_FACTURE],
      ).then(async () => {
        await admin.query(`update reanalyses_destinataire_pieces set statut = 'termine', resultat = 'destinataire_trouve', traite_le = now() where lot_id = $1`, [doublon]);
      }),
    ).rejects.toThrow(/reanalyses_destinataire_pieces_version/);
    // Une version d'analyseur différente reste possible (évolution de l'analyseur).
    const autreVersion = await lot('execution', [], await lot('simulation', [], null, '2099-01-01.1'), '2099-01-01.1');
    await admin.query(
      `insert into reanalyses_destinataire_pieces (cabinet_id, entite_id, lot_id, document_id, extraction_avant_id, version_extraction_avant, version_analyseur, execution, statut, resultat, traite_le) values ($1, $2, $3, $4, $5, 1, '2099-01-01.1', true, 'termine', 'abstention', now())`,
      [cabinet, entite, autreVersion, p.doc, p.extraction],
    );
  });

  it('reprise après interruption : les pièces déjà conclues ne sont pas refaites, les autres le sont, sans doublon', async () => {
    const pieces = [await piece('rep-1'), await piece('rep-2'), await piece('rep-3'), await piece('rep-4')];
    const id = await lot('execution', pieces, await lot('simulation', []));
    await expect(reanalyserDestinataire(c, tache(id), { arreterApres: 2 })).rejects.toBeInstanceOf(InterruptionSimulee);
    const milieu = await rapport(id);
    expect(Object.values(milieu).filter((x) => x.statut === 'termine')).toHaveLength(2);
    expect(Object.values(milieu).filter((x) => x.statut === 'en_attente')).toHaveLength(2);
    expect((await admin.query('select statut, termine_le from reanalyses_destinataire where id = $1', [id])).rows[0]).toMatchObject({ statut: 'en_cours', termine_le: null });
    const faites = Object.values(milieu).filter((x) => x.statut === 'termine').map((x) => ({ doc: x.document_id as string, extraction: x.extraction_apres_id as string }));
    // Reprise.
    await reanalyserDestinataire(c, tache(id));
    const fin = await rapport(id);
    expect(Object.values(fin).every((x) => x.statut === 'termine' && x.resultat === 'destinataire_trouve')).toBe(true);
    for (const p of pieces) expect(await versions(p.doc)).toHaveLength(2); // une seule nouvelle version par pièce
    // Les deux premières pièces gardent leur version issue de la première passe.
    for (const f of faites) expect((await versions(f.doc))[1].id).toBe(f.extraction);
    expect((await admin.query('select statut, resume from reanalyses_destinataire where id = $1', [id])).rows[0]).toMatchObject({ statut: 'termine', resume: { destinataire_trouve: 4 } });
    const lignes = (await admin.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action = 'extraction.destinataire_reanalyse' and cible_id = any($2)`, [cabinet, pieces.map((p) => p.doc)])).rows[0].n;
    expect(lignes).toBe(4);
  });

  it('une pièce en erreur (original absent, quarantaine) est rapportée avec un motif ; les autres continuent ; rien n’est modifié pour elle', async () => {
    const bonne = await piece('err-ok');
    const absente = await piece('err-absente', { sansFichier: true });
    const infectee = await piece('err-infectee', { quarantaine: true });
    const id = await lot('execution', [bonne, absente, infectee], await lot('simulation', []));
    await reanalyserDestinataire(c, tache(id));
    const r = await rapport(id);
    expect(r[bonne.doc].resultat).toBe('destinataire_trouve');
    expect(r[absente.doc]).toMatchObject({ resultat: 'erreur', statut: 'termine', extraction_apres_id: null });
    expect(r[absente.doc].motif).toMatch(/n’a pas pu être relue/);
    expect(r[infectee.doc]).toMatchObject({ resultat: 'erreur' });
    expect(r[infectee.doc].motif).toMatch(/quarantaine/);
    expect(await versions(absente.doc)).toHaveLength(1);
    expect((await versions(absente.doc))[0].actuelle).toBe(true);
    expect(await versions(infectee.doc)).toHaveLength(1);
    expect((await admin.query('select resume from reanalyses_destinataire where id = $1', [id])).rows[0].resume).toMatchObject({ destinataire_trouve: 1, erreur: 2 });
    // Une erreur n'empêche pas une nouvelle demande ultérieure (pas de verrou d'idempotence sur l'échec).
    const encore = await lot('execution', [absente], await lot('simulation', []));
    contenus.set(`essai-reanalyse/${SEL}/err-absente.pdf`, pdfTexte(avecClient.pages[0]!.texte.split('\n'), `${SEL}-err-absente`));
    await reanalyserDestinataire(c, tache(encore));
    expect((await rapport(encore))[absente.doc].resultat).toBe('destinataire_trouve');
  });

  it('une extraction modifiée depuis la demande (correction d’un autre champ, nouvelle version de la pièce) : « inchangée », rien n’est écrasé', async () => {
    const corrigee = await piece('chg-1');
    const remplacee = await piece('chg-2');
    const id = await lot('execution', [corrigee, remplacee], await lot('simulation', []));
    // Entre la demande et le traitement : une personne corrige un autre champ (nouvelle version) ; l'autre pièce est remplacée.
    await admin.query(`update extractions set actuelle = false where document_id = $1`, [corrigee.doc]);
    await admin.query(`insert into extractions (cabinet_id, entite_id, document_id, version, methode, champs, verifications, statut) values ($1, $2, $3, 2, 'saisie_humaine', $4, '[]', 'projet')`, [cabinet, entite, corrigee.doc, JSON.stringify(corrigee.champsAvant)]);
    await admin.query(`update documents set statut = 'remplace', remplace_par = $2 where id = $1`, [remplacee.doc, corrigee.doc]);
    await reanalyserDestinataire(c, tache(id));
    const r = await rapport(id);
    expect(r[corrigee.doc]).toMatchObject({ resultat: 'inchangee', extraction_apres_id: null });
    expect(r[corrigee.doc].motif).toMatch(/a changé depuis la demande/);
    expect(r[remplacee.doc]).toMatchObject({ resultat: 'inchangee' });
    expect(r[remplacee.doc].motif).toMatch(/remplacée/);
    expect(await versions(corrigee.doc)).toHaveLength(2);
    expect(await versions(remplacee.doc)).toHaveLength(1);
  });
});

describe('réanalyse du destinataire : droits de la base', () => {
  it('rapport figé une fois terminé ; éléments de la demande immuables ; aucune suppression ; le worker ne crée ni lot ni pièce', async () => {
    const p = await piece('droits');
    const id = await lot('simulation', [p]);
    await reanalyserDestinataire(c, tache(id));
    const w = new pg.Client({ connectionString: urlBd('worker') });
    await w.connect();
    try {
      await w.query(`select set_config('app.cabinet_id', $1, false)`, [cabinet]);
      await expect(w.query(`delete from reanalyses_destinataire_pieces where lot_id = $1`, [id])).rejects.toThrow(/permission|droit/i);
      await expect(w.query(`delete from reanalyses_destinataire where id = $1`, [id])).rejects.toThrow(/permission|droit/i);
      await expect(w.query(`insert into reanalyses_destinataire (cabinet_id, entite_id, mode, version_analyseur, taille_lot, motif, demande_par) values ($1, $2, 'simulation', 'x', 50, 'x', $3)`, [cabinet, entite, DEMO.remi])).rejects.toThrow(/permission|droit/i);
      await expect(w.query(`update reanalyses_destinataire_pieces set resultat = 'erreur', motif = 'x' where lot_id = $1`, [id])).rejects.toThrow(/ne se modifie plus/);
      await expect(w.query(`update reanalyses_destinataire set motif = 'autre' where id = $1`, [id])).rejects.toThrow(/ne se modifie plus/);
    } finally {
      await w.end();
    }
    // Isolation entre cabinets : un autre cabinet ne voit rien de ces lignes.
    const autre = new pg.Client({ connectionString: urlBd('worker') });
    await autre.connect();
    try {
      await autre.query(`select set_config('app.cabinet_id', $1, false)`, [DEMO.cabinetB]);
      expect((await autre.query('select count(*)::int as n from reanalyses_destinataire where id = $1', [id])).rows[0].n).toBe(0);
      expect((await autre.query('select count(*)::int as n from reanalyses_destinataire_pieces where lot_id = $1', [id])).rows[0].n).toBe(0);
    } finally {
      await autre.end();
    }
  });

  it('valeurs hors bornes refusées par la base (lot de plus de 50 pièces, exécution sans simulation, motif vide)', async () => {
    const insere = (valeurs: string) => admin.query(`insert into reanalyses_destinataire (cabinet_id, entite_id, mode, simulation_id, version_analyseur, taille_lot, motif, nb_pieces, demande_par) values ($1, $2, ${valeurs})`, [cabinet, entite]);
    await expect(insere(`'simulation', null, 'v', 51, 'm', 0, '${DEMO.remi}'`)).rejects.toThrow(/reanalyses_destinataire_valeurs/);
    await expect(insere(`'simulation', null, 'v', 50, 'm', 51, '${DEMO.remi}'`)).rejects.toThrow(/reanalyses_destinataire_valeurs/);
    await expect(insere(`'execution', null, 'v', 50, 'm', 1, '${DEMO.remi}'`)).rejects.toThrow(/reanalyses_destinataire_valeurs/);
    await expect(insere(`'simulation', null, 'v', 50, '', 1, '${DEMO.remi}'`)).rejects.toThrow(/reanalyses_destinataire_valeurs/);
  });
});

describe('rattrapage d’une réanalyse interrompue', () => {
  it('une demande restée en attente ou en cours sans activité depuis plus de 10 minutes est remise en file ; une demande récente ou terminée, non', async () => {
    const vieille = await lot('simulation', []);
    const enCours = await lot('simulation', []);
    const recente = await lot('simulation', []);
    const terminee = await lot('simulation', []);
    await admin.query(`alter table reanalyses_destinataire disable trigger reanalyses_destinataire_figees`);
    try {
      await admin.query(`update reanalyses_destinataire set maj_le = now() - interval '30 minutes' where id = any($1)`, [[vieille, enCours, terminee]]);
      await admin.query(`update reanalyses_destinataire set statut = 'en_cours' where id = $1`, [enCours]);
      await admin.query(`update reanalyses_destinataire set statut = 'termine', termine_le = now() where id = $1`, [terminee]);
    } finally {
      await admin.query(`alter table reanalyses_destinataire enable trigger reanalyses_destinataire_figees`);
    }
    const mises: string[] = [];
    const cc: Contexte = {
      ...c,
      stockage: new Stockage(cfg),
      taches: {
        analyserDocument: async () => undefined,
        reanalyserDestinataire: async (t: { lotId: string }) => void mises.push(t.lotId),
        importerFec: async () => undefined, importerReleve: async () => undefined, executerControles: async () => undefined, executerRapprochement: async () => undefined,
        genererDossier: async () => undefined, genererRestitution: async () => undefined, genererRestitutionCabinet: async () => undefined,
      } as unknown as Files,
    };
    const bilan = await rattraper(cc);
    expect(bilan.traitements.reanalyse_destinataire).toBeGreaterThanOrEqual(2);
    expect(mises).toEqual(expect.arrayContaining([vieille, enCours]));
    expect(mises).not.toContain(recente);
    expect(mises).not.toContain(terminee);
  });
});
