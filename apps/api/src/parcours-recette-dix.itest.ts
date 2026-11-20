/**
 * Parcours 1 du cahier des charges, ENCHAÎNÉ de bout en bout (P3, D-101) — pile réelle locale, cabinet NEUF :
 * photo d'une facture (image sans couche texte) → dépôt par le déposant → « reçue » après vérification serveur → OCR réel →
 * extraction → correction humaine tracée → validation de la version par le réviseur → import de données comptables →
 * contrôles → dossier de révision (export) qui inventorie la pièce avec son empreinte et son statut.
 * Les morceaux de ce parcours sont couverts séparément ailleurs ; ce test prouve la CHAÎNE, avec les mêmes acteurs.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique, genererTexteFactureSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import { chromium } from 'playwright';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCabinet, attendre, deposerCabinet, ouvrirSessions, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const EX = { debut: '2025-01-01', fin: '2025-12-31' };
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai parcours 1 ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '60 minutes')`, [cabinet, u, role]);
  }
  dossier = (await apiCabinet('alice', cabinet, 'POST', '/v1/dossiers', { raisonSociale: `Société parcours 1 ${SEL} (fictive)`, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, n] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await apiCabinet('alice', cabinet, 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau: n })).statut).toBe(200);
  }
  exercice = (await apiCabinet('alice', cabinet, 'POST', `/v1/dossiers/${dossier}/exercices`, EX)).json.id;
}, 120_000);
afterAll(async () => {
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('parcours 1 enchaîné : photo → réception → OCR → revue humaine → export', () => {
  it('chaque maillon est tenu par le suivant, avec les mêmes personnes, jusqu’à l’inventaire du dossier de révision', async () => {
    const f = genererTexteFactureSynthetique({ graine: 77, type: 'facture', qualite: 'nette' });
    const navigateur = await chromium.launch();
    let image: Buffer;
    try {
      const page = await navigateur.newPage({ viewport: { width: 1240, height: 1500 } });
      const echappe = f.pages[0]!.texte.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      await page.setContent(`<body style="margin:60px;background:#fff"><pre style="font:22px/1.7 Helvetica,Arial,sans-serif;color:#111">${echappe}\n\nRéf. essai ${SEL}</pre></body>`);
      image = await page.screenshot({ type: 'png' });
    } finally {
      await navigateur.close();
    }
    // 1. Dépôt par le déposant : « reçue » seulement après la clôture vérifiée par le serveur.
    const d = await deposerCabinet('client', cabinet, dossier, image, { nature: 'facture_achat', canal: 'telephone' }, 'photo-facture.png');
    expect(d.ouverture.statut).toBe(201);
    expect(d.fin?.statut).toBe(200);
    expect(d.fin!.json.recu).toBe(true);
    const doc = d.fin!.json.documentId as string;
    // 2. OCR réel puis extraction : champs en « projet », jamais validés d'office.
    const lu = await attendre(() => apiCabinet('client', cabinet, 'GET', `/v1/documents/${doc}`), (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut), 180_000);
    expect(lu.json.document.statut).toBe('a_controler');
    expect(lu.json.extraction).toMatchObject({ methode: 'ocr', statut: 'projet' });
    expect(lu.json.extraction.champs.totalTtc.valeur).toBe(f.attendu.totalTtc);
    // 3. Le déposant ne valide pas ; la collaboratrice corrige (nouvelle version tracée) ; le réviseur valide LA version corrigée.
    expect((await apiCabinet('client', cabinet, 'POST', `/v1/documents/${doc}/validation`, { decision: 'valider' })).statut).toBe(403);
    const corr = await apiCabinet('chloe', cabinet, 'PUT', `/v1/documents/${doc}/extraction`, { champs: { numero: `PH-${SEL}` } });
    expect(corr.statut).toBe(200);
    const valide = await apiCabinet('remi', cabinet, 'POST', `/v1/documents/${doc}/validation`, { decision: 'valider' });
    expect(valide.statut).toBe(200);
    const apres = await apiCabinet('remi', cabinet, 'GET', `/v1/documents/${doc}`);
    expect(apres.json.extraction).toMatchObject({ statut: 'valide' });
    expect(apres.json.extraction.champs.numero.valeur).toBe(`PH-${SEL}`);
    // 4. Données comptables, contrôles.
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 150, graine: 321, anomalies: ['caisse_crediteur'] });
    const dep = await deposerCabinet('remi', cabinet, dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    expect(dep.fin?.statut).toBe(200);
    await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/imports/${dep.fin!.json.lotImportId}`), (r) => r.json?.statut === 'termine', 120_000);
    await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/exercices/${exercice}/revue`), (r) => r.json?.execution?.statut === 'termine', 120_000);
    // 5. Export : le dossier de révision inventorie la pièce, avec l'empreinte de l'ORIGINAL (l'image déposée) et son statut.
    const demande = await apiCabinet('chloe', cabinet, 'POST', `/v1/exercices/${exercice}/dossier-revision`);
    expect(demande.statut).toBe(202);
    const liste = await attendre(() => apiCabinet('remi', cabinet, 'GET', `/v1/exercices/${exercice}/dossiers-revision`), (r) => ['termine', 'echec'].includes(r.json?.find((e: any) => e.id === demande.json.id)?.statut), 120_000);
    const exp = liste.json.find((e: any) => e.id === demande.json.id);
    expect(exp.statut).toBe('termine');
    expect(exp.mention).toBe('projet');
    const donnees = (await apiCabinet('remi', cabinet, 'GET', `/v1/dossiers-revision/${exp.id}/donnees`)).json;
    const ligne = donnees.inventairePieces.find((p: any) => p.sha256 === sha(image));
    expect(ligne, JSON.stringify(donnees.inventairePieces).slice(0, 300)).toBeTruthy();
    expect(ligne.nom_origine).toBe('photo-facture.png');
    // Le déposant ne lit pas l'export ; l'original est resté intact et servi sous contrôle d'accès.
    expect((await apiCabinet('client', cabinet, 'GET', `/v1/dossiers-revision/${exp.id}/pdf`)).statut).toBe(404);
    const original = await apiCabinet('remi', cabinet, 'GET', `/v1/documents/${doc}/contenu`);
    expect(sha(original.brut)).toBe(sha(image));
  }, 600_000);
});
