/**
 * États fiscaux (lot 5) — pile réelle locale, cabinet NEUF : liasse (projet ou abstention), projet d'annexe et ses
 * confirmations, propositions d'écritures d'inventaire du moteur et leur reprise. Rien n'est jamais « validé » ici.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';
let outreMer = '';
let exOutreMer = '';

async function creerDossier(nom: string, extra: Record<string, unknown>): Promise<{ dossier: string; exercice: string }> {
  const d = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, ...extra })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const ex = (await api('alice', 'POST', `/v1/dossiers/${d}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  return { dossier: d, exercice: ex };
}
async function importer(d: string, ex: string, graine: number) {
  const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 160, graine });
  const depot = await deposer('remi', d, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: ex, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  await attendreLot('remi', depot.fin.json.lotImportId);
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai fiscal ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  ({ dossier, exercice } = await creerDossier(`Société d’essai fiscal ${SEL} SAS (fictive)`, { territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' }));
  ({ dossier: outreMer, exercice: exOutreMer } = await creerDossier(`Société d’essai outre-mer ${SEL} SAS (fictive)`, { territoireFiscal: 'martinique', formeJuridique: 'SAS', regimeFiscal: 'IS' }));
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('états fiscaux — projets, jamais validés', () => {
  it('sans données comptables : rien n’est préparé (409), ni liasse, ni annexe, ni proposition', async () => {
    for (const chemin of ['liasse', 'annexe', 'inventaire/propositions']) {
      const r = await api('remi', 'GET', `/v1/exercices/${exercice}/${chemin}`);
      expect(r.statut, chemin).toBe(409);
      expect(r.json.message).toMatch(/Aucune donnée comptable/);
    }
  });

  it('liasse dans le périmètre : projet incomplet, tableaux 2050 à 2053, contrôles affichés, codes de cases « à confirmer », tableaux non couverts listés', async () => {
    await importer(dossier, exercice, Number.parseInt(SEL.slice(0, 6), 16));
    const r = await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`);
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ regimeDemande: 'reel_normal', regimeDeduit: false, teletransmission: 'non_disponible', donnees: { avantInventaire: true } });
    const l = r.json.resultat;
    expect(l).toMatchObject({ statut: 'projet', complet: false, table: { etat: 'en_attente_de_validation_professionnelle' } });
    expect(l.tableaux.map((t: any) => t.code)).toEqual(['2050', '2051', '2052', '2053']);
    expect(l.manques.length).toBeGreaterThan(0);
    expect(l.tableauxNonCouverts.length).toBeGreaterThan(5);
    const lignes = l.tableaux.flatMap((t: any) => t.lignes);
    expect(lignes.every((x: any) => x.etatCodeCase === 'a_confirmer' && x.codeCase === null)).toBe(true);
    expect(lignes.every((x: any) => typeof x.montant === 'string' && /^-?\d+\.\d{2}$/.test(x.montant))).toBe(true);
    expect(l.controles.length).toBeGreaterThan(0);
    // Cohérence avec le projet de bilan existant : même total de l'actif.
    const etats = (await api('remi', 'GET', `/v1/exercices/${exercice}/etats`)).json;
    expect(l.totaux.total_actif).toBe(etats.bilan.totaux.total_actif);
    // Régime simplifié : autres tableaux, toujours un projet.
    const s2 = (await api('remi', 'GET', `/v1/exercices/${exercice}/liasse?regime=reel_simplifie`)).json.resultat;
    expect(s2.tableaux.map((t: any) => t.code)).toEqual(['2033-A', '2033-B']);
    expect((await api('remi', 'GET', `/v1/exercices/${exercice}/liasse?regime=micro`)).statut).toBe(400);
  }, 120_000);

  it('hors périmètre (outre-mer) : ABSTENTION motivée, aucun chiffre', async () => {
    await importer(outreMer, exOutreMer, 4242);
    const r = (await api('remi', 'GET', `/v1/exercices/${exOutreMer}/liasse`)).json.resultat;
    expect(r.statut).toBe('abstention');
    expect(r.motifs.map((m: any) => m.code)).toContain('territoire_hors_perimetre');
    expect(r.tableaux).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/"montant"/);
  }, 120_000);

  it('caractéristique « à confirmer » (régime fiscal effacé) : abstention, puis de nouveau un projet une fois renseignée', async () => {
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { regimeFiscal: null })).statut).toBe(200);
    const r = (await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`)).json.resultat;
    expect(r.statut).toBe('abstention');
    expect(r.motifs.map((m: any) => m.code)).toContain('impot_a_confirmer');
    expect((await api('alice', 'PATCH', `/v1/dossiers/${dossier}`, { regimeFiscal: 'IS' })).statut).toBe(200);
    expect((await api('remi', 'GET', `/v1/exercices/${exercice}/liasse`)).json.resultat.statut).toBe('projet');
  });

  it('droits : le déposant et un autre cabinet n’y accèdent pas ; la collaboratrice lit mais ne confirme pas l’annexe', async () => {
    // Niveau « dépôt » : l'exercice lui-même n'est pas visible (politique de la base) — 404, son existence n'est pas révélée.
    expect((await api('client', 'GET', `/v1/exercices/${exercice}/liasse`)).statut).toBe(404);
    choisirCabinet('alice', null);
    expect((await api('bruno', 'GET', `/v1/exercices/${exercice}/annexe`)).statut).toBe(404);
    choisirCabinet('alice', cabinet);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/annexe`)).statut).toBe(200);
    expect((await api('chloe', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/ANX-831-1`, { etat: 'complete' })).statut).toBe(403);
    expect((await api('chloe', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'petite_entreprise' })).statut).toBe(403);
  });

  it('annexe : projet incomplet tant que les rubriques requises ne sont pas confirmées ; confirmation, retrait, catégorie déclarée', async () => {
    const lire = async () => (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json;
    const a = await lire();
    expect(a.resultat).toMatchObject({ statut: 'projet', complet: false, categorie: 'a_confirmer' });
    expect(a.categorieDeclaree).toBeNull();
    expect(a.categorieIndicative.mention).toMatch(/jamais appliquée d’office/);
    const requises = a.resultat.rubriques.filter((r: any) => r.requise);
    expect(requises.length).toBeGreaterThan(10);
    expect(a.resultat.rubriques.some((r: any) => r.statut === 'pre_rempli' && r.preRemplissage.length > 0)).toBe(true);
    expect(a.resultat.rubriques.some((r: any) => r.statut === 'a_completer' && r.aSaisir.length > 0)).toBe(true);
    const cible = requises[0].id;
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/ANX-inconnue`, { etat: 'complete' })).statut).toBe(404);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'validee' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'complete', note: 'Méthodes inchangées par rapport à l’exercice précédent.' })).statut).toBe(200);
    const b = await lire();
    expect(b.resultat.rubriques.find((r: any) => r.id === cible).confirmation).toBe('complete');
    expect(b.resultat.complet).toBe(false); // une seule rubrique confirmée ne rend pas l'annexe complète
    expect(b.confirmations).toEqual([expect.objectContaining({ rubrique: cible, etat: 'complete', aRevoir: false })]);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`)).statut).toBe(200);
    expect((await api('remi', 'DELETE', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`)).statut).toBe(404);
    // Catégorie déclarée : change les rubriques requises ; valeur inconnue refusée.
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'geante' })).statut).toBe(400);
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/categorie`, { categorie: 'micro_entreprise' })).statut).toBe(200);
    const c = await lire();
    expect(c.categorieDeclaree).toBe('micro_entreprise');
    expect(c.resultat.rubriques.filter((r: any) => r.requise).length).toBeLessThan(requises.length);
  });

  it('une confirmation d’annexe devient « à revoir » quand les données changent, et ne compte plus', async () => {
    const cible = (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json.resultat.rubriques.find((r: any) => r.requise).id;
    expect((await api('remi', 'PUT', `/v1/exercices/${exercice}/annexe/rubriques/${cible}`, { etat: 'non_applicable' })).statut).toBe(200);
    await importer(dossier, exercice, 777);
    const a = (await api('remi', 'GET', `/v1/exercices/${exercice}/annexe`)).json;
    expect(a.confirmations.find((c: any) => c.rubrique === cible)).toMatchObject({ aRevoir: true });
    expect(a.resultat.rubriques.find((r: any) => r.id === cible).confirmation).toBeNull();
  }, 120_000);

  it('propositions du moteur : jamais enregistrées d’office ; reprise par la collaboratrice → écriture « proposée » d’origine moteur ; une seule reprise', async () => {
    // Une charge couvrant une période qui dépasse la clôture, reconnaissable dans son libellé, est ajoutée par un import de travail.
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 120, graine: 99 });
    // Lignes ajoutées en ASCII pur : elles se lisent de la même façon quel que soit l'encodage du fichier généré.
    const base = Buffer.from(fec.contenu);
    const sep = base.subarray(0, 400).toString('latin1').includes('\t') ? '\t' : '|';
    const ajout = (compte: string, lib: string, debit: string, credit: string) =>
      ['AC', 'Achats', 'ASS0001', '20251001', compte, lib, '', '', 'ASS-2025', '20251001', 'Assurance du 01/10/2025 au 30/09/2026', debit, credit, '', '', '20251001', '', ''].join(sep);
    const fin = base[base.length - 1] === 0x0a ? '' : '\n';
    const contenu = Buffer.concat([base, Buffer.from(`${fin}${ajout('616000', 'Primes d assurance', '1200,00', '0,00')}\n${ajout('401000', 'Fournisseurs', '0,00', '1200,00')}\n`, 'ascii')]);
    const depot = await deposer('remi', dossier, contenu, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', depot.fin.json.lotImportId);
    const liste = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    expect(liste.statut).toBe('projet');
    expect(liste.amortissements).toMatchObject({ proposes: false });
    const cca = liste.propositions.find((p: any) => p.type === 'charge_constatee_avance' && p.libelle.length > 0 && p.justification.includes('30/09/2026')) ?? liste.propositions.find((p: any) => p.type === 'charge_constatee_avance');
    expect(cca, JSON.stringify(liste.abstentions).slice(0, 400)).toBeTruthy();
    expect(cca).toMatchObject({ statut: 'proposee', equilibree: true, reprise: null });
    expect(cca.totalDebit).toBe(cca.totalCredit);
    expect(cca.calcul.length).toBeGreaterThan(0);
    expect((await api('chloe', 'GET', `/v1/exercices/${exercice}/ecritures-inventaire`)).json).toEqual([]); // rien n'est enregistré d'office
    // Le client déposant ne voit ni ne reprend ; un identifiant fantaisiste est refusé.
    expect((await api('client', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).statut).toBe(404);
    expect((await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/inconnue/reprise`)).statut).toBe(404);
    const reprise = await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(cca.id)}/reprise`);
    expect(reprise.statut).toBe(201);
    expect(reprise.json).toMatchObject({ origine: 'proposition_moteur', statut: 'proposee', totalDebit: cca.totalDebit });
    expect(reprise.json.origineDetail).toMatchObject({ regle: 'INV-CCA', propositionId: cca.id });
    expect((await api('chloe', 'POST', `/v1/exercices/${exercice}/inventaire/propositions/${encodeURIComponent(cca.id)}/reprise`)).statut).toBe(409);
    const apres = (await api('chloe', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json.propositions.find((p: any) => p.id === cca.id);
    expect(apres.reprise).toMatchObject({ ecritureInventaireId: reprise.json.id, statut: 'proposee' });
    // Circuit normal ensuite : l'auteure ne s'approuve pas elle-même ; le réviseur approuve.
    expect((await api('chloe', 'POST', `/v1/ecritures-inventaire/${reprise.json.id}/decision`, { decision: 'approuver' })).statut).toBeGreaterThanOrEqual(403);
    expect((await api('remi', 'POST', `/v1/ecritures-inventaire/${reprise.json.id}/decision`, { decision: 'approuver' })).statut).toBe(200);
  }, 180_000);
});
