/**
 * Restitution d'un CABINET entier — pile réelle locale.
 *
 * Le parcours crée un cabinet NEUF et petit (opération d'éditeur) pour ne pas produire, à chaque exécution, une archive
 * de plusieurs centaines de Mo du cabinet de démonstration. Les comptes de démonstration y sont rattachés pour la durée
 * du test seulement (appartenances à expiration courte, désactivées à la fin) : tant qu'elles sont actives, ces comptes
 * sont membres de deux cabinets et chaque appel précise le cabinet par l'en-tête X-Cabinet-Id.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { genererFecSynthetique, genererTexteFactureSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import { Stockage, lireConfig } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

function ouvrirZip(contenu: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((ok, ko) => {
    yauzl.fromBuffer(contenu, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return ko(err);
      const fichiers = new Map<string, Buffer>();
      zip.on('entry', (entree) => {
        zip.openReadStream(entree, (e, flux) => {
          if (e || !flux) return ko(e);
          const morceaux: Buffer[] = [];
          flux.on('data', (m) => morceaux.push(m));
          flux.on('end', () => {
            fichiers.set(entree.fileName, Buffer.concat(morceaux));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => ok(fichiers));
      zip.on('error', ko);
      zip.readEntry();
    });
  });
}
const lignes = (fichiers: Map<string, Buffer>, table: string): any[] =>
  (fichiers.get(`donnees/${table}.jsonl`)?.toString('utf8') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const SEL = randomBytes(4).toString('hex');
const MARQUE_PORTEFEUILLE = `jamaisrestitue${SEL}`;
const COMPTES = ['alice', 'remi', 'chloe'] as const;
const VERIFICATEUR = join(import.meta.dirname, '../../../scripts/verifier-restitution.mjs');
let editeur: pg.Client;
let cabinet = '';
let dossierA = '';
let dossierB = '';
let pieceA: Buffer;
let pieceB: Buffer;
let nbLignesFec = 0;
const dossierTravail = mkdtempSync(join(tmpdir(), 'restitution-cabinet-'));

async function restituer(): Promise<{ r: any; archive: Buffer; fichiers: Map<string, Buffer>; manifeste: any }> {
  const demande = await api('alice', 'POST', '/v1/cabinet/restitutions');
  expect(demande.statut).toBe(202);
  expect((await api('alice', 'POST', '/v1/cabinet/restitutions')).statut).toBe(409); // une seule à la fois
  const liste = await attendre(() => api('alice', 'GET', '/v1/cabinet/restitutions'), (x) => ['termine', 'echec'].includes(x.json?.find((y: any) => y.id === demande.json.id)?.statut), 180_000);
  const r = liste.json.find((y: any) => y.id === demande.json.id);
  expect(r.statut, r.erreur).toBe('termine');
  const t = await api('alice', 'GET', `/v1/cabinet/restitutions/${r.id}/archive`);
  expect(t.statut).toBe(200);
  const fichiers = await ouvrirZip(t.brut);
  return { r, archive: t.brut, fichiers, manifeste: JSON.parse(fichiers.get('manifeste.json')!.toString('utf8')) };
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai restitution ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'associe'], [DEMO.chloe, 'collaborateur']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);

  dossierA = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Dossier A ${SEL} (fictif)`, territoireFiscal: 'metropole' })).json.id;
  dossierB = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Dossier B ${SEL} (fictif)`, territoireFiscal: 'metropole' })).json.id;
  for (const d of [dossierA, dossierB]) {
    await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${DEMO.chloe}`, { niveau: 'collaboration' });
  }
  const exerciceId = (await api('chloe', 'POST', `/v1/dossiers/${dossierA}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  pieceA = pdfTexte(genererTexteFactureSynthetique({ graine: 7 }).pages[0]!.texte.split('\n'), `A-${SEL}`);
  pieceB = pdfTexte(genererTexteFactureSynthetique({ graine: 8 }).pages[0]!.texte.split('\n'), `B-${SEL}`);
  const a = await deposer('chloe', dossierA, pieceA, {}, 'facture-a.pdf');
  const b = await deposer('chloe', dossierB, pieceB, {}, 'facture-b.pdf');
  for (const id of [a.fin.json.documentId, b.fin.json.documentId]) {
    await attendre(() => api('chloe', 'GET', `/v1/documents/${id}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
  }
  const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 80, graine: Number.parseInt(SEL.slice(0, 6), 16) });
  nbLignesFec = fec.nbLignes;
  const lot = await deposer('chloe', dossierA, Buffer.from(fec.contenu), { usage: 'fec', exerciceId, statutDonnees: 'fec' }, fec.nomFichier);
  await attendreLot('chloe', lot.fin.json.lotImportId);
  // L'administratrice n'a plus qu'un accès de lecture au dossier B : il ne doit pas entrer dans SA restitution.
  await api('alice', 'PUT', `/v1/dossiers/${dossierB}/habilitations/${DEMO.alice}`, { niveau: 'lecture' });
  // Amélioration contrôlée et assistant de portefeuille (lignes fictives posées par le rôle d'administration) : une
  // suggestion écartée par dossier (restituée dans le périmètre), et un échange de portefeuille (JAMAIS restitué : il
  // porte sur plusieurs dossiers à la fois).
  for (const d of [dossierA, dossierB]) {
    await editeur.query(
      `insert into suggestions_ecartees (cabinet_id, empreinte, categorie, controle_id, entite_id_cible, version_criteres, decomptes, motif, ecartee_par) values ($1, $2, 'exception_dossier', 'TIE-001', $3, '1.0.0', '{}'::jsonb, 'Cas particuliers', $4)`,
      [cabinet, `exception_dossier|TIE-001|${d}`, d, DEMO.alice],
    );
  }
  await editeur.query(`insert into echanges_portefeuille (cabinet_id, utilisateur_id, question, mode, statut, dossiers, contenu) values ($1, $2, $3, 'sans_ia', 'repondu', $4::jsonb, '{}'::jsonb)`, [cabinet, DEMO.chloe, `Question ${MARQUE_PORTEFEUILLE}`, JSON.stringify([dossierA, dossierB])]);
}, 240_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
  rmSync(dossierTravail, { recursive: true, force: true });
});

describe('restitution d’un cabinet entier', () => {
  it('est réservée aux gestionnaires du cabinet, et le périmètre annoncé suit les habilitations du demandeur', async () => {
    expect((await api('chloe', 'POST', '/v1/cabinet/restitutions')).statut).toBe(403); // collaboratrice
    expect((await api('chloe', 'GET', '/v1/cabinet/restitutions')).statut).toBe(403);
    expect((await api('chloe', 'GET', '/v1/cabinet/restitutions/perimetre')).statut).toBe(403);
    expect((await api('bruno', 'POST', '/v1/cabinet/restitutions')).json?.cabinetId).not.toBe(cabinet); // un autre cabinet ne demande que la sienne…
    choisirCabinet('bruno', cabinet);
    expect((await api('bruno', 'POST', '/v1/cabinet/restitutions')).statut).toBe(403); // …et ne peut pas viser celui-ci
    expect((await api('bruno', 'GET', '/v1/cabinet/restitutions')).statut).toBe(403);
    choisirCabinet('bruno', null);

    const p = (await api('alice', 'GET', '/v1/cabinet/restitutions/perimetre')).json;
    expect(p.complet).toBe(false);
    expect(p.inclus).toEqual([{ id: dossierA, raisonSociale: `Dossier A ${SEL} (fictif)` }]);
    expect(p.ecartes).toHaveLength(1);
    expect(p.ecartes[0]).toMatchObject({ id: dossierB });
    expect(p.ecartes[0].motif).toMatch(/lecture.*inférieure au niveau « validation »/);
    // Rémi, associé sans aucune habilitation de dossier : sa restitution serait vide de dossiers, et l'API le dit.
    const r = (await api('remi', 'GET', '/v1/cabinet/restitutions/perimetre')).json;
    expect(r.inclus).toEqual([]);
    expect(r.ecartes.map((e: any) => e.motif)).toEqual(['Vous n’êtes pas habilité sur ce dossier', 'Vous n’êtes pas habilité sur ce dossier']);
  });

  let premiere: Awaited<ReturnType<typeof restituer>>;

  it('produit une archive incomplète et le dit : le dossier hors habilitation n’y figure nulle part', async () => {
    premiere = await restituer();
    const { r, archive, fichiers, manifeste } = premiere;
    expect(archive.length).toBe(r.taille);
    expect(sha(archive)).toBe(r.sha256);
    expect(r.cleArchive).toBeUndefined(); // l'emplacement de stockage n'est pas exposé
    expect(r).toMatchObject({ demandeParNom: 'Alice Admin', telechargeable: true });
    expect(manifeste).toMatchObject({ format: 'comtaple.restitution-cabinet/1', complet: false, dossiersInclus: 1, dossiersEcartes: 1 });
    expect(manifeste.perimetre.inclus).toEqual([dossierA]);
    expect(manifeste.perimetre.ecartes[0]).toMatchObject({ id: dossierB });
    // Cabinet neuf : son journal est intègre selon la vérification stricte, et il est restitué partiellement.
    expect(manifeste.journalAudit).toMatchObject({ verificationStricte: 'intègre', partiel: true });

    // Manifeste : tout fichier y est, à la bonne taille et à la bonne empreinte ; rien ne s'y ajoute.
    expect([...fichiers.keys()].filter((n) => n !== 'manifeste.json').sort()).toEqual(manifeste.fichiers.map((f: any) => f.chemin).sort());
    for (const f of manifeste.fichiers) {
      expect(fichiers.get(f.chemin)!.length, f.chemin).toBe(f.taille);
      expect(sha(fichiers.get(f.chemin)!), f.chemin).toBe(f.sha256);
    }
    for (const nom of fichiers.keys()) expect(nom).toMatch(/^(LISEZMOI\.txt|manifeste\.json|donnees\/[a-z_]+\.(jsonl|json)|ecritures\/[0-9a-f-]{36}\/lot-v\d+-[0-9a-f-]{36}\.csv|originaux\/[0-9a-f]{64})$/);

    // Habilitations : aucune ligne d'aucune table ne porte le dossier B, ni un autre cabinet.
    const tables = [...fichiers.keys()].filter((n) => n.endsWith('.jsonl')).map((n) => n.slice('donnees/'.length, -'.jsonl'.length));
    expect(tables).toEqual(expect.arrayContaining(['entites', 'documents', 'fichiers', 'lots_import', 'habilitations_dossier', 'journal_audit', 'appartenances', 'abonnements', 'exercices']));
    // Suggestions écartées : restituées, dans le périmètre seulement. Échanges de portefeuille : absents de l'archive.
    expect(lignes(fichiers, 'suggestions_ecartees').map((l) => l.entiteId)).toEqual([dossierA]);
    expect(tables).not.toContain('echanges_portefeuille');
    expect(manifeste.tables.echanges_portefeuille).toBeUndefined();
    for (const [nom, contenu] of fichiers) expect(contenu.includes(MARQUE_PORTEFEUILLE), nom).toBe(false);
    for (const table of tables) {
      for (const l of lignes(fichiers, table)) {
        expect(l.cabinetId, table).toBe(cabinet);
        if ('entiteId' in l && l.entiteId !== null) expect(l.entiteId, table).toBe(dossierA);
      }
    }
    expect(lignes(fichiers, 'entites').map((e) => e.id)).toEqual([dossierA]);
    const horsPerimetre = [...fichiers.entries()].filter(([n, c]) => !['manifeste.json', 'donnees/cabinet.json'].includes(n) && c.includes(Buffer.from(dossierB)));
    expect(horsPerimetre.map(([n]) => n)).toEqual([]);

    // Originaux : celui du dossier A, identique à l'octet près ; celui du dossier B absent.
    expect(fichiers.get(`originaux/${sha(pieceA)}`)?.equals(pieceA)).toBe(true);
    expect(fichiers.has(`originaux/${sha(pieceB)}`)).toBe(false);
    expect(lignes(fichiers, 'fichiers').some((f) => f.sha256 === sha(pieceB))).toBe(false);
    for (const [nom, contenu] of fichiers) if (nom.startsWith('originaux/')) expect(nom.slice('originaux/'.length)).toBe(createHash('sha256').update(contenu).digest('hex'));
    expect(manifeste.originauxNonConformes).toEqual([]);

    // Écritures : toutes les lignes de l'import, en CSV, sous le dossier A.
    const csvs = [...fichiers.entries()].filter(([n]) => n.startsWith('ecritures/'));
    expect(csvs).toHaveLength(1);
    expect(csvs[0]![0].startsWith(`ecritures/${dossierA}/`)).toBe(true);
    expect(csvs[0]![1].toString('utf8').trim().split('\n').length - 1).toBe(nbLignesFec);
    expect(manifeste.lignesEcriture).toBe(nbLignesFec);

    // Aucun secret : les colonnes exclues sont nommées, et absentes des données.
    expect(manifeste.colonnesExclues).toEqual(expect.arrayContaining(['connexions_mail.jetons_chiffres']));
    for (const [nom, contenu] of fichiers) if (nom.startsWith('donnees/')) expect(contenu.includes(Buffer.from('jetonsChiffres')), nom).toBe(false);
    // Personnes : uniquement les membres de ce cabinet.
    expect(JSON.parse(fichiers.get('donnees/personnes.json')!.toString('utf8')).map((p: any) => p.id).sort()).toEqual([DEMO.alice, DEMO.remi, DEMO.chloe].sort());
  });

  it('n’est téléchargeable que par la personne qui l’a demandée, et tout est journalisé', async () => {
    const { r } = premiere;
    // Rémi est gestionnaire (associé) : il voit la restitution, mais ne peut pas se servir du périmètre d'Alice.
    const vueRemi = (await api('remi', 'GET', '/v1/cabinet/restitutions')).json.find((x: any) => x.id === r.id);
    expect(vueRemi).toMatchObject({ statut: 'termine', telechargeable: false, demandeParNom: 'Alice Admin' });
    expect((await api('remi', 'GET', `/v1/cabinet/restitutions/${r.id}/archive`)).statut).toBe(403);
    expect((await api('chloe', 'GET', `/v1/cabinet/restitutions/${r.id}/archive`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/cabinet/restitutions/${r.id}/archive`)).statut).toBe(404); // autre cabinet : inexistante
    const actions = (await api('alice', 'GET', '/v1/audit?limite=60')).json.lignes.filter((l: any) => l.cibleId === r.id).map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['restitution_cabinet.demandee', 'restitution_cabinet.generee', 'restitution_cabinet.telechargee']));
    expect(actions.filter((a: string) => a === 'restitution_cabinet.telechargee')).toHaveLength(1); // les refus n'ont rien servi
  });

  it('se vérifie hors de l’application ; une archive altérée ou tronquée est rejetée', async () => {
    const { r, archive } = premiere;
    const chemin = join(dossierTravail, 'archive.zip');
    writeFileSync(chemin, archive);
    const sortie = execFileSync('node', [VERIFICATEUR, chemin, r.sha256], { encoding: 'utf8' });
    expect(sortie).toMatch(/restitution INCOMPLÈTE/);
    expect(sortie).toMatch(/CONFORME : chaque fichier correspond au manifeste/);
    const echec = (args: string[]) => {
      try {
        execFileSync('node', [VERIFICATEUR, ...args], { encoding: 'utf8', stdio: 'pipe' });
        return null;
      } catch (e: any) {
        return `${e.status} ${e.stdout}`;
      }
    };
    // Un octet modifié au milieu de l'archive : empreinte de l'archive différente, et contenu non conforme.
    const alteree = Buffer.from(archive);
    alteree[Math.floor(alteree.length / 2)]! ^= 0xff;
    writeFileSync(join(dossierTravail, 'alteree.zip'), alteree);
    expect(echec([join(dossierTravail, 'alteree.zip'), r.sha256])).toMatch(/^1 [^]*NON CONFORME/);
    expect(echec([join(dossierTravail, 'alteree.zip')])).toMatch(/^1 [^]*NON CONFORME/);
    writeFileSync(join(dossierTravail, 'tronquee.zip'), archive.subarray(0, archive.length - 2000));
    expect(echec([join(dossierTravail, 'tronquee.zip')])).toMatch(/^1 [^]*NON CONFORME/);
    expect(echec([chemin, 'a'.repeat(64)])).toMatch(/^1 [^]*empreinte de l'archive différente/);
  });

  it('devient complète quand la demandeuse est habilitée (validation) sur tous les dossiers — habilitation journalisée', async () => {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossierB}/habilitations/${DEMO.alice}`, { niveau: 'validation' })).statut).toBeLessThan(300);
    expect((await api('alice', 'GET', '/v1/cabinet/restitutions/perimetre')).json).toMatchObject({ complet: true, ecartes: [] });
    const { fichiers, manifeste } = await restituer();
    expect(manifeste).toMatchObject({ complet: true, dossiersInclus: 2, dossiersEcartes: 0 });
    expect(manifeste.journalAudit).toMatchObject({ verificationStricte: 'intègre', partiel: false });
    expect(lignes(fichiers, 'entites').map((e) => e.id).sort()).toEqual([dossierA, dossierB].sort());
    expect(fichiers.get(`originaux/${sha(pieceB)}`)?.equals(pieceB)).toBe(true);
    // Journal complet du cabinet : les lignes restituées s'enchaînent, de la première à la dernière.
    const journal = lignes(fichiers, 'journal_audit');
    expect(journal.length).toBe(manifeste.journalAudit.lignesRestituees);
    expect(journal[0].empreintePrecedente).toBeNull();
    for (let i = 1; i < journal.length; i++) expect(journal[i].empreintePrecedente, `ligne ${journal[i].id}`).toBe(journal[i - 1].empreinte);
    expect(journal.some((l) => l.action === 'habilitation.accordee' && l.entiteId === dossierB)).toBe(true);
    // La première archive, incomplète, reste disponible telle quelle : une restitution n'en remplace pas une autre.
    expect((await api('alice', 'GET', `/v1/cabinet/restitutions/${premiere.r.id}/archive`)).brut.equals(premiere.archive)).toBe(true);
  });

  it('original dont le contenu ne correspond plus à son empreinte : non restitué et signalé, de la même façon par les deux restitutions', async () => {
    // Une pièce de plus, puis son objet est remplacé dans le stockage (altération simulée d'un fichier d'essai).
    const pieceC = pdfTexte(['Pièce destinée à être altérée', `Référence ${SEL}`], `C-${SEL}`);
    const depot = await deposer('chloe', dossierA, pieceC, {}, 'facture-c.pdf');
    await attendre(() => api('chloe', 'GET', `/v1/documents/${depot.fin.json.documentId}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut));
    const cle = (await editeur.query('select cle_stockage from fichiers where cabinet_id = $1 and sha256 = $2', [cabinet, sha(pieceC)])).rows[0].cle_stockage as string;
    const stockage = new Stockage(lireConfig());
    const altere = Buffer.from(`contenu altéré ${SEL} — ceci n'est pas l'original reçu`);
    await stockage.deposer(cle, altere, 'application/pdf');
    try {
      const attendu = { sha256: sha(pieceC), motif: 'empreinte différente de celle enregistrée : fichier non restitué, à examiner' };
      const sansAltere = (fichiers: Map<string, Buffer>) => {
        expect([...fichiers.keys()].some((n) => n.includes(sha(pieceC)))).toBe(false);
        expect([...fichiers.values()].some((c) => c.includes(altere))).toBe(false);
      };

      // Restitution du CABINET.
      const cab = await restituer();
      expect(cab.manifeste.originauxExclus).toContainEqual(attendu);
      expect(cab.manifeste.originauxNonConformes).toEqual([{ sha256: sha(pieceC) }]);
      sansAltere(cab.fichiers);
      expect(cab.fichiers.get(`originaux/${sha(pieceA)}`)?.equals(pieceA)).toBe(true); // les autres originaux sont restitués
      expect(cab.r.resume.originauxNonConformes).toHaveLength(1);
      writeFileSync(join(dossierTravail, 'altere-cabinet.zip'), cab.archive);
      expect(execFileSync('node', [VERIFICATEUR, join(dossierTravail, 'altere-cabinet.zip'), cab.r.sha256], { encoding: 'utf8' })).toMatch(/1 original\(aux\) NON RESTITUÉ\(S\)[^]*CONFORME : chaque fichier/);

      // Restitution du DOSSIER : même décision, même motif.
      const demande = await api('alice', 'POST', `/v1/dossiers/${dossierA}/restitutions`);
      expect(demande.statut).toBe(202);
      const liste = await attendre(() => api('alice', 'GET', `/v1/dossiers/${dossierA}/restitutions`), (x) => ['termine', 'echec'].includes(x.json?.find((y: any) => y.id === demande.json.id)?.statut), 120_000);
      const r = liste.json.find((y: any) => y.id === demande.json.id);
      expect(r.statut, r.erreur).toBe('termine');
      const fichiers = await ouvrirZip((await api('alice', 'GET', `/v1/restitutions/${r.id}/archive`)).brut);
      const manifeste = JSON.parse(fichiers.get('manifeste.json')!.toString('utf8'));
      expect(manifeste.originauxExclus).toContainEqual(attendu);
      sansAltere(fichiers);
      expect([...fichiers.keys()].some((n) => n.startsWith(`originaux/${sha(pieceA)}-`))).toBe(true);
      // Les deux manifestes disent la même chose de ce fichier.
      expect(manifeste.originauxExclus.filter((x: any) => x.sha256 === sha(pieceC))).toEqual(cab.manifeste.originauxExclus.filter((x: any) => x.sha256 === sha(pieceC)));
    } finally {
      // Le fichier d'essai retrouve son contenu d'origine : le stockage reste cohérent avec la base.
      await stockage.deposer(cle, pieceC, 'application/pdf');
    }
  }, 300_000);
});
