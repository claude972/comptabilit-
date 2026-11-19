/**
 * Parcours 4 (pièces) — nouvelle version d'un document : conservation de l'original, invalidation explicite de la
 * validation, distinction avec le doublon binaire. Pile réelle locale, dossier neuf par exécution.
 */
import { randomBytes } from 'node:crypto';
import { genererTexteFactureSynthetique } from '@comtaple/core';
import { DEMO } from '@comtaple/db/amorcer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, deposer, ouvrirSessions, pdfTexte, sha } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
let entiteId = '';
const f1 = genererTexteFactureSynthetique({ graine: 101 });
const f2 = genererTexteFactureSynthetique({ graine: 202 });
const v1 = pdfTexte(f1.pages[0]!.texte.split('\n'), `${SEL}-v1`);
const v2 = pdfTexte(f2.pages[0]!.texte.split('\n'), `${SEL}-v2`);
const v3 = pdfTexte(['Version corrigée par le cabinet'], `${SEL}-v3`);
let id1 = '';
let id2 = '';
let extractionV1 = '';

const analyse = (qui: string, id: string) =>
  attendre(
    () => api(qui, 'GET', `/v1/documents/${id}`),
    (r) => r.statut === 200 && !['recu', 'en_analyse'].includes(r.json.document.statut),
  );

beforeAll(async () => {
  await ouvrirSessions();
  entiteId = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai versions ${SEL} SAS (fictif)`, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${entiteId}/habilitations/${u}`, { niveau })).statut).toBe(200);
  }
});
afterAll(async () => {
  await api('alice', 'DELETE', `/v1/dossiers/${entiteId}/habilitations/${DEMO.client}`);
});

describe('nouvelle version d’une pièce', () => {
  it('une pièce déposée par le client est analysée puis validée par le réviseur (version 1)', async () => {
    const d = await deposer('client', entiteId, v1, { canal: 'telephone', nature: 'facture_achat' }, 'facture.pdf');
    expect(d.fin.json).toMatchObject({ recu: true, nouvelleVersion: null });
    id1 = d.fin.json.documentId;
    const doc = await analyse('client', id1);
    expect(doc.json.document).toMatchObject({ version: 1, statut: 'a_controler' });
    expect(doc.json.versions).toHaveLength(1);
    extractionV1 = doc.json.extraction.id;
    expect((await api('remi', 'POST', `/v1/documents/${id1}/validation`, { decision: 'valider' })).json.statut).toBe('traite');
  });

  it('un déposant ne remplace pas une pièce validée ; ni la pièce d’un autre, ni depuis un autre dossier ou cabinet', async () => {
    const ouvrir = (qui: string, corps: Record<string, unknown>) =>
      api(qui, 'POST', '/v1/televersements', { entiteId, nomFichier: 'facture-v2.pdf', taille: v2.length, sha256: sha(v2), canal: 'telephone', remplaceDocumentId: id1, ...corps });
    expect((await ouvrir('client', {})).statut).toBe(403); // validée par le cabinet
    expect((await ouvrir('bruno', {})).statut).toBe(404); // autre cabinet
    expect((await ouvrir('chloe', { entiteId: DEMO.dupain })).statut).toBe(404); // le document n'est pas dans ce dossier
    expect((await ouvrir('chloe', { usage: 'fec', exerciceId: DEMO.exDupain2025, statutDonnees: 'fec' })).statut).toBe(400);
    expect((await ouvrir('chloe', { remplaceDocumentId: 'aaaaaaaa-0000-4000-8000-00000000dead' })).statut).toBe(404);
  });

  it('redéposer le MÊME fichier comme « nouvelle version » est un doublon binaire : rien n’est remplacé, la validation tient', async () => {
    const d = await deposer('chloe', entiteId, v1, { remplaceDocumentId: id1 }, 'facture.pdf');
    expect(d.fin.json).toMatchObject({ recu: true, doublonBinaire: true, documentId: id1, nouvelleVersion: null });
    const doc = (await api('remi', 'GET', `/v1/documents/${id1}`)).json;
    expect(doc.document).toMatchObject({ statut: 'traite', version: 1, remplacePar: null });
    expect(doc.extraction.statut).toBe('valide');
    expect(doc.receptions).toHaveLength(2);
  });

  it('une vraie nouvelle version conserve l’original, invalide explicitement la validation et repart en revue', async () => {
    const d = await deposer('chloe', entiteId, v2, { remplaceDocumentId: id1 }, 'facture-v2.pdf');
    expect(d.fin.json.recu).toBe(true);
    expect(d.fin.json.doublonBinaire).toBe(false);
    expect(d.fin.json.nouvelleVersion).toEqual({ version: 2, validationInvalidee: true });
    id2 = d.fin.json.documentId;
    expect(id2).not.toBe(id1);

    // Ancienne version : conservée, marquée remplacée, sa validation invalidée — et son original toujours servi à l'identique.
    const ancien = (await api('remi', 'GET', `/v1/documents/${id1}`)).json;
    expect(ancien.document).toMatchObject({ statut: 'remplace', version: 1, remplacePar: id2 });
    expect(ancien.document.motifStatut).toMatch(/version 2/);
    expect(ancien.estVersionCourante).toBe(false);
    expect(ancien.extraction).toMatchObject({ id: extractionV1, statut: 'validation_invalidee' });
    const contenu = await api('remi', 'GET', `/v1/documents/${id1}/contenu`);
    expect(contenu.statut).toBe(200);
    expect(sha(contenu.brut)).toBe(sha(v1));
    // On ne travaille plus sur une version remplacée.
    expect((await api('remi', 'POST', `/v1/documents/${id1}/validation`, { decision: 'valider' })).statut).toBe(409);
    expect((await api('chloe', 'PUT', `/v1/documents/${id1}/extraction`, { champs: { numero: 'X' } })).statut).toBe(409);

    // Nouvelle version : analysée, à contrôler, jamais validée d'office.
    const neuf = await analyse('remi', id2);
    expect(neuf.json.document).toMatchObject({ version: 2, statut: 'a_controler', remplaceDocumentId: id1, nature: 'facture_achat' });
    expect(neuf.json.extraction.statut).toBe('projet');
    expect(neuf.json.extraction.champs.numero?.valeur).toBe(f2.attendu.numero);
    expect(neuf.json.versions.map((x: any) => [x.id, x.version, x.statut])).toEqual([[id1, 1, 'remplace'], [id2, 2, 'a_controler']]);
    expect(neuf.json.estVersionCourante).toBe(true);

    // Trace : décision d'invalidation avec son auteur, et ligne d'audit.
    const audit = (await api('alice', 'GET', '/v1/audit?limite=60')).json.lignes.find((l: any) => l.action === 'document.nouvelle_version' && l.cibleId === id2);
    expect(audit.details).toMatchObject({ remplace: id1, version: 2, statutAncien: 'traite', validationInvalidee: true });
    expect(audit.acteurNom).toBe('Chloé Collab');
    // Le déposant d'origine voit les deux versions de SA pièce, pas davantage.
    const liste = (await api('client', 'GET', `/v1/documents?entiteId=${entiteId}`)).json.documents;
    expect(liste.find((x: any) => x.id === id1)).toMatchObject({ statut: 'remplace', version: 1 });
  });

  it('la nouvelle version se dépose toujours sur la version la plus récente', async () => {
    const tard = await api('chloe', 'POST', '/v1/televersements', { entiteId, nomFichier: 'x.pdf', taille: v3.length, sha256: sha(v3), canal: 'ordinateur', remplaceDocumentId: id1 });
    expect(tard.statut).toBe(409);
    const d = await deposer('chloe', entiteId, v3, { remplaceDocumentId: id2 }, 'facture-v3.pdf');
    // La version 2 n'avait pas été validée : rien à invalider, et c'est dit.
    expect(d.fin.json.nouvelleVersion).toEqual({ version: 3, validationInvalidee: false });
    const v = (await api('remi', 'GET', `/v1/documents/${d.fin.json.documentId}`)).json.versions;
    expect(v.map((x: any) => x.version)).toEqual([1, 2, 3]);
    expect(v.filter((x: any) => x.statut === 'remplace')).toHaveLength(2);
  });

  it('la liste des pièces se filtre sur les versions courantes et se cherche par nom, sur tout le dossier', async () => {
    const toutes = (await api('remi', 'GET', `/v1/documents?entiteId=${entiteId}`)).json;
    const courantes = (await api('remi', 'GET', `/v1/documents?entiteId=${entiteId}&versions=courantes`)).json;
    expect(toutes.documents.filter((x: any) => x.remplacePar).length).toBe(2);
    expect(courantes.documents.every((x: any) => x.remplacePar === null)).toBe(true);
    expect(courantes.total).toBe(toutes.total - 2);
    const v3seule = (await api('remi', 'GET', `/v1/documents?entiteId=${entiteId}&q=${encodeURIComponent('FACTURE-V3')}`)).json;
    expect(v3seule.documents.map((x: any) => x.nomOrigine)).toEqual(['facture-v3.pdf']);
    // Les caractères jokers d'une recherche sont pris littéralement.
    expect((await api('remi', 'GET', `/v1/documents?entiteId=${entiteId}&q=${encodeURIComponent('%')}`)).json.total).toBe(0);
  });

  it('un déposant peut remplacer sa propre pièce tant qu’elle n’est pas validée', async () => {
    const a = pdfTexte(['Photo floue'], `${SEL}-a`);
    const b = pdfTexte(['Photo nette'], `${SEL}-b`);
    const premier = await deposer('client', entiteId, a, { canal: 'telephone' }, 'photo.pdf');
    await analyse('client', premier.fin.json.documentId);
    const second = await deposer('client', entiteId, b, { canal: 'telephone', remplaceDocumentId: premier.fin.json.documentId }, 'photo-2.pdf');
    expect(second.fin.json.nouvelleVersion).toEqual({ version: 2, validationInvalidee: false });
    // Mais pas la pièce déposée par quelqu'un d'autre.
    const duCabinet = await deposer('chloe', entiteId, pdfTexte(['Pièce du cabinet'], `${SEL}-c`), {}, 'cabinet.pdf');
    const refus = await api('client', 'POST', '/v1/televersements', { entiteId, nomFichier: 'y.pdf', taille: a.length, sha256: sha(Buffer.concat([a, b])), canal: 'telephone', remplaceDocumentId: duCabinet.fin.json.documentId });
    expect(refus.statut).toBe(404);
  });
});
