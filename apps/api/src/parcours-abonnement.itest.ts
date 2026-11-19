/**
 * Abonnements sur la pile réelle locale. Utilise le cabinet Bêta (fictif) pour ne pas gêner les autres parcours, et
 * remet son abonnement en période d'essai à la fin. Les opérations de l'éditeur (grille, échéances, virements,
 * suspension) passent par le provisionnement, jamais par l'API du cabinet. Montants de démonstration FICTIFS.
 */
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { enregistrerVirement, genererEcheance, ouvrirEssai, suspendre } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ouvrirSessions, sha } from './essais/outils.js';

let editeur: pg.Client;
const aujourdhui = new Date().toISOString().slice(0, 10);
const ouvrirDepot = (qui: string, entiteId: string) => {
  const contenu = Buffer.from(`%PDF-1.4 abonnement ${Math.random()}`);
  return api(qui, 'POST', '/v1/televersements', { entiteId, nomFichier: 'x.pdf', taille: contenu.length, sha256: sha(contenu), canal: 'ordinateur' });
};

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  // Parcours rejouable : l'historique de facturation du cabinet de démonstration est remis à zéro par l'éditeur.
  await editeur.query('delete from echeances_abonnement where cabinet_id = $1', [DEMO.cabinetB]);
  await editeur.query('delete from evenements_facturation where cabinet_id = $1', [DEMO.cabinetB]);
  await ouvrirEssai(editeur, DEMO.cabinetB, 'demo-essentiel', aujourdhui);
});
afterAll(async () => {
  await ouvrirEssai(editeur, DEMO.cabinetB, 'demo-essentiel', aujourdhui); // état initial pour les autres parcours
  await editeur.end();
});

describe('abonnement du cabinet', () => {
  it('le gestionnaire voit offre, quotas et estimation ; les autres membres seulement si le service est ouvert', async () => {
    const r = await api('bruno', 'GET', '/v1/abonnement');
    expect(r.json).toMatchObject({ situation: 'essai', serviceOuvert: true });
    expect(r.json.offre).toMatchObject({ code: 'demo-essentiel', fictif: true });
    expect(r.json.usage.dossiersActifs).toBeGreaterThanOrEqual(1);
    expect(r.json.usage.piecesCeMois).toMatchObject({ limite: 2000, depasse: false });
    expect(r.json.estimation).toMatchObject({ statut: 'calcule', totalHt: '100.00', fictif: true }); // forfait seul : dossiers inclus
    expect((await api('remi', 'GET', '/v1/abonnement')).statut).toBe(403);
    expect((await api('client', 'GET', '/v1/abonnement/echeances')).statut).toBe(403);
    expect((await api('client', 'GET', '/v1/abonnement/situation')).json).toMatchObject({ situation: 'essai', serviceOuvert: true });
    // Cloisonnement : Alice (cabinet Alpha) ne voit que l'abonnement de son cabinet.
    expect((await api('alice', 'GET', '/v1/abonnement')).json.abonnement.cabinetId).toBe(DEMO.cabinetA);
  });

  it('le cabinet ne peut ni modifier un tarif ni se déclarer payé : seul l’éditeur émet et rapproche', async () => {
    const e = await genererEcheance(editeur, DEMO.cabinetB, `${aujourdhui.slice(0, 7)}-01`);
    expect(e).toMatchObject({ totalHt: '100.00' });
    expect(e!.reference).toMatch(/^CTP-BBBBBBBB-\d{6}$/);
    expect((await genererEcheance(editeur, DEMO.cabinetB, `${aujourdhui.slice(0, 7)}-01`))!.id).toBe(e!.id); // idempotent
    const liste = await api('bruno', 'GET', '/v1/abonnement/echeances');
    expect(liste.json).toHaveLength(1);
    expect(liste.json[0]).toMatchObject({ statutPaiement: 'en_attente_virement', totalHt: '100.00', fictif: true });
    expect(liste.json[0].lignes[0]).toMatchObject({ nature: 'forfait', montant: '100.00' });
    // Aucune route d'écriture n'existe côté cabinet, et le rôle applicatif n'a pas le droit d'écrire ces tables.
    for (const [m, c] of [['POST', '/v1/abonnement/echeances'], ['PATCH', `/v1/abonnement/echeances/${e!.id}`], ['PUT', '/v1/abonnement/offres']] as const) {
      expect((await api('bruno', m, c, {})).statut).toBe(404);
    }
    const app = new pg.Client({ connectionString: urlBd('app') });
    await app.connect();
    await expect(app.query(`update echeances_abonnement set statut_paiement = 'paye'`)).rejects.toThrow(/permission|droit/i);
    await expect(app.query(`update offres_abonnement set definition = '{}'`)).rejects.toThrow(/permission|droit/i);
    await app.end();

    await enregistrerVirement(editeur, e!.id, aujourdhui);
    await enregistrerVirement(editeur, e!.id, aujourdhui); // rejeu sans effet
    const apres = await api('bruno', 'GET', '/v1/abonnement');
    expect(apres.json.situation).toBe('actif');
    expect((await api('bruno', 'GET', '/v1/abonnement/echeances')).json[0]).toMatchObject({ statutPaiement: 'paye', payeLe: aujourdhui });
    const types = (await api('bruno', 'GET', '/v1/abonnement/historique')).json.map((x: any) => x.type);
    expect(types.filter((t: string) => t === 'virement_recu')).toHaveLength(1);
    expect(types).toEqual(expect.arrayContaining(['essai_ouvert', 'echeance_emise', 'virement_recu']));
  });

  it('changement d’offre demandé par le cabinet, appliqué par l’éditeur à l’échéance suivante', async () => {
    expect((await api('bruno', 'POST', '/v1/abonnement/changement', { offre: 'inexistante' })).statut).toBe(400);
    expect((await api('bruno', 'POST', '/v1/abonnement/changement', { offre: 'demo-cabinet' })).json.offreDemandee).toBe('demo-cabinet');
    expect((await api('bruno', 'GET', '/v1/abonnement')).json.offre.code).toBe('demo-essentiel'); // pas encore appliqué
    const suivant = new Date(Date.UTC(Number(aujourdhui.slice(0, 4)), Number(aujourdhui.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const e = await genererEcheance(editeur, DEMO.cabinetB, suivant);
    expect(e!.totalHt).toBe('300.00');
    const a = (await api('bruno', 'GET', '/v1/abonnement')).json;
    expect(a.offre.code).toBe('demo-cabinet');
    expect(a.abonnement.offreDemandee).toBeNull();
    expect(a.usage.piecesCeMois.limite).toBe(15000);
  });

  it('suspension : les nouveaux dépôts sont refusés, la consultation reste possible', async () => {
    expect((await ouvrirDepot('bruno', DEMO.leroy)).statut).toBe(201);
    await suspendre(editeur, DEMO.cabinetB, 'impayé (essai)');
    const refus = await ouvrirDepot('bruno', DEMO.leroy);
    expect(refus.statut).toBe(403);
    expect(refus.json).toMatchObject({ code: 'abonnement_inactif', situation: 'suspendu' });
    expect((await api('bruno', 'GET', `/v1/documents?entiteId=${DEMO.leroy}`)).statut).toBe(200);
    expect((await api('bruno', 'GET', '/v1/dossiers')).statut).toBe(200);
    // Un autre cabinet n'est pas affecté.
    expect((await ouvrirDepot('chloe', DEMO.dupain)).statut).toBe(201);
  });

  it('essai expiré d’après la date, sans intervention ; résiliation ouverte jusqu’à l’échéance', async () => {
    await ouvrirEssai(editeur, DEMO.cabinetB, 'demo-essentiel', aujourdhui);
    await editeur.query(`update abonnements set fin_essai = current_date - 1 where cabinet_id = $1`, [DEMO.cabinetB]);
    expect((await api('bruno', 'GET', '/v1/abonnement/situation')).json).toMatchObject({ situation: 'essai_expire', serviceOuvert: false });
    expect((await ouvrirDepot('bruno', DEMO.leroy)).json.situation).toBe('essai_expire');

    await ouvrirEssai(editeur, DEMO.cabinetB, 'demo-essentiel', aujourdhui);
    expect((await api('bruno', 'POST', '/v1/abonnement/resiliation', {})).statut).toBe(400); // motif requis
    const r = await api('bruno', 'POST', '/v1/abonnement/resiliation', { motif: 'Fin de la démonstration' });
    expect(r.json.statut).toBe('resilie');
    expect(r.json.fin >= aujourdhui).toBe(true);
    expect((await api('bruno', 'GET', '/v1/abonnement/situation')).json).toMatchObject({ situation: 'resiliation_programmee', serviceOuvert: true });
    expect((await ouvrirDepot('bruno', DEMO.leroy)).statut).toBe(201);
    await editeur.query(`update abonnements set fin = current_date - 1 where cabinet_id = $1`, [DEMO.cabinetB]);
    expect((await ouvrirDepot('bruno', DEMO.leroy)).json.situation).toBe('resilie');
    expect((await api('bruno', 'POST', '/v1/abonnement/resiliation', { motif: 'encore' })).statut).toBe(409);
    // La résiliation ne supprime rien.
    expect((await api('bruno', 'GET', `/v1/documents?entiteId=${DEMO.leroy}`)).statut).toBe(200);
  });
});
