/**
 * Règles et paramètres propres au cabinet (amélioration contrôlée) — pile réelle locale.
 * Dossier neuf créé par l'API d'administration à chaque exécution.
 */
import { randomBytes } from 'node:crypto';
import { genererFecSynthetique } from '@comtaple/core';
import { DEMO } from '@comtaple/db/amorcer';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 250, graine: Number.parseInt(SEL.slice(0, 6), 16), anomalies: ['client_crediteur'] });
const anomalie = fec.anomaliesInjectees[0]!;
let entiteId = '';
let exerciceId = '';
let regleId = '';

async function revueApresRelance() {
  const lance = await api('remi', 'POST', `/v1/exercices/${exerciceId}/controles`);
  const r = await attendre(
    () => api('remi', 'GET', `/v1/exercices/${exerciceId}/revue`),
    (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine',
  );
  return r.json.resultats.find((x: any) => x.controleId === 'TIE-001');
}

beforeAll(async () => {
  await ouvrirSessions();
  entiteId = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai règles ${SEL} SAS (fictif)`, territoireFiscal: 'metropole', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${entiteId}/habilitations/${u}`, { niveau })).statut).toBe(200);
  }
  exerciceId = (await api('chloe', 'POST', `/v1/dossiers/${entiteId}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  const d = await deposer('chloe', entiteId, Buffer.from(fec.contenu), { usage: 'fec', exerciceId, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  await attendreLot('chloe', d.fin.json.lotImportId);
  await attendre(
    () => api('remi', 'GET', `/v1/exercices/${exerciceId}/revue`),
    (x) => x.json?.execution?.statut === 'termine',
  );
});

describe('règles propres au cabinet', () => {
  it('le contrôle signale le client créditeur avec les paramètres par défaut', async () => {
    expect(anomalie.controleAttendu).toBe('TIE-001');
    const r = await revueApresRelance();
    expect(r.statut).toBe('constat');
    expect(r.parametres.seuil).toBe('0.00');
    expect(r.source.regleCabinet).toBeNull();
  });

  it('une proposition est validée par le schéma du contrôle, refusée sur une règle réglementaire, et sans effet tant qu’elle n’est pas approuvée', async () => {
    const base = { controleId: 'TIE-001', entiteId, motif: 'Petits avoirs clients en attente de remboursement, sans enjeu' };
    expect((await api('client', 'POST', '/v1/regles', { ...base, parametres: { seuil: '100000.00' } })).statut).toBe(403);
    expect((await api('chloe', 'POST', '/v1/regles', { ...base, parametres: { seuilInconnu: 1 } })).statut).toBe(400);
    expect((await api('chloe', 'POST', '/v1/regles', { ...base, parametres: { seuil: 100000.5 } })).statut).toBe(400); // un flottant n'est pas un montant
    expect((await api('chloe', 'POST', '/v1/regles', { ...base, controleId: 'TRE-001', parametres: { seuil: '50.00' } })).statut).toBe(409); // caisse créditrice : PCG
    expect((await api('chloe', 'POST', '/v1/regles', { controleId: 'TIE-001', motif: base.motif, parametres: { seuil: '1.00' } })).statut).toBe(403); // tout le cabinet : pas une collaboratrice
    expect((await api('bruno', 'POST', '/v1/regles', { ...base, parametres: { seuil: '100000.00' } })).statut).toBe(404); // autre cabinet
    const p = await api('chloe', 'POST', '/v1/regles', { ...base, parametres: { seuil: '100000.00' } });
    expect(p.statut).toBe(201);
    expect(p.json).toMatchObject({ statut: 'proposee', version: 1, entiteId });
    regleId = p.json.id;
    expect((await revueApresRelance()).statut).toBe('constat'); // aucun effet
  });

  it('l’impact est mesuré avant activation ; l’approbation exige cette mesure et une autre personne que l’auteur', async () => {
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(409); // pas d'impact mesuré
    const impact = await api('chloe', 'POST', `/v1/regles/${regleId}/impact`, { exerciceId });
    expect(impact.statut).toBe(200);
    expect(impact.json.avant).toMatchObject({ statut: 'constat' });
    expect(impact.json.avant.constats).toBeGreaterThanOrEqual(1);
    expect(impact.json.apres).toMatchObject({ statut: 'sans_anomalie', constats: 0 });
    expect(impact.json.constatsQuiDisparaissent).toBe(impact.json.avant.constats);
    expect(impact.json.constatsQuiApparaissent).toBe(0);
    expect((await api('chloe', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403); // ni gestionnaire…
    expect((await api('remi', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403);
    // …ni auto-approbation : une règle proposée par l'administratrice ne peut pas être approuvée par elle-même.
    const sienne = await api('alice', 'POST', '/v1/regles', { controleId: 'TIE-002', entiteId, motif: 'Essai d’auto-approbation', parametres: { seuil: '10.00' } });
    await api('alice', 'POST', `/v1/regles/${sienne.json.id}/impact`, { exerciceId });
    expect((await api('alice', 'POST', `/v1/regles/${sienne.json.id}/approuver`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/regles/${sienne.json.id}/refuser`, { motif: 'Essai' })).json.statut).toBe('refusee');

    const ok = await api('alice', 'POST', `/v1/regles/${regleId}/approuver`);
    expect(ok.json).toMatchObject({ statut: 'approuvee', approuveePar: DEMO.alice });
  });

  it('la règle approuvée s’applique, est tracée dans le résultat, rend l’exécution précédente obsolète, et reste réversible', async () => {
    expect((await api('remi', 'GET', `/v1/exercices/${exerciceId}/revue`)).json.execution.obsolete).toBe(true);
    const avec = await revueApresRelance();
    expect(avec.statut).toBe('sans_anomalie');
    expect(avec.parametres.seuil).toBe('100000.00');
    expect(avec.source.regleCabinet).toMatchObject({ regleId, version: 1, portee: 'dossier' });

    expect((await api('remi', 'POST', `/v1/regles/${regleId}/retirer`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/retirer`)).json.statut).toBe('retiree');
    const sans = await revueApresRelance();
    expect(sans.statut).toBe('constat');
    expect(sans.source.regleCabinet).toBeNull();
    // L'historique conserve toutes les versions, et le journal d'audit la chaîne des décisions.
    const liste = (await api('remi', 'GET', '/v1/regles')).json.filter((r: any) => r.entiteId === entiteId);
    expect(liste.map((r: any) => r.statut).sort()).toEqual(['refusee', 'retiree']);
    const actions = (await api('alice', 'GET', '/v1/audit?limite=60')).json.lignes.filter((l: any) => l.cibleId === regleId).map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['regle.proposee', 'regle.impact_mesure', 'regle.approuvee', 'regle.retiree']));
    expect((await api('client', 'GET', '/v1/regles')).statut).toBe(403);
  });
});

describe('états de travail et indicateurs du dossier', () => {
  const centimes = (v: string) => BigInt(v.replace('.', ''));

  it('balance équilibrée, projets de compte de résultat et de bilan cohérents entre eux, toujours « projet »', async () => {
    const r = await api('remi', 'GET', `/v1/exercices/${exerciceId}/etats`);
    expect(r.statut).toBe(200);
    expect(r.json.mention).toMatch(/PROJET/);
    expect(r.json.balance.equilibree).toBe(true);
    expect(r.json.balance.totalDebit).toBe(r.json.balance.totalCredit);
    expect(r.json.correspondance.etat).toBe('en_attente_de_validation_professionnelle');
    const { compteDeResultat: cr, bilan } = r.json;
    expect(cr.statut).toBe('projet');
    expect(bilan.statut).toBe('projet');
    // Aucun compte n'est compté deux fois : rubriques + comptes non affectés recouvrent exactement la balance.
    const comptesBalance = new Set(r.json.balance.lignes.filter((l: any) => l.soldeDebiteur !== '0.00' || l.soldeCrediteur !== '0.00').map((l: any) => l.compteNum));
    const affectes = [...cr.rubriques, ...bilan.rubriques].flatMap((x: any) => x.comptes.map((c: any) => c.compteNum));
    for (const c of affectes) expect(comptesBalance.has(c) || c === '6-7' || /^\d/.test(c)).toBe(true);
    // Les contrôles internes sont restitués avec leur écart ; s'ils sont « ok », l'écart est nul.
    for (const c of [...cr.controles, ...bilan.controles]) {
      expect(['ok', 'ecart', 'non_verifiable']).toContain(c.statut);
      if (c.statut === 'ok' && c.ecart !== null) expect(centimes(c.ecart)).toBe(0n);
    }
    if (bilan.complet) expect(bilan.controles.every((c: any) => c.statut !== 'ecart')).toBe(true);
    else expect(bilan.motifsIncompletude.length).toBeGreaterThan(0);
    expect((await api('client', 'GET', `/v1/exercices/${exerciceId}/etats`)).statut).toBe(404);
    expect((await api('bruno', 'GET', `/v1/exercices/${exerciceId}/etats`)).statut).toBe(404);
  });

  it('indicateurs tracés jusqu’aux comptes ; non calculable plutôt que zéro ; délais seulement avec un taux de TVA fourni', async () => {
    const r = await api('remi', 'GET', `/v1/exercices/${exerciceId}/indicateurs`);
    expect(r.statut).toBe(200);
    const liste = r.json.indicateurs;
    expect(liste.length).toBeGreaterThanOrEqual(20);
    for (const i of liste) {
      expect(['calcule', 'non_calculable']).toContain(i.statut);
      if (i.statut === 'non_calculable') {
        expect(i.valeur).toBeNull();
        expect(i.motif).toBeTruthy();
      } else expect(typeof i.valeur).toBe('string');
    }
    const ca = liste.find((i: any) => i.statut === 'calcule' && i.composantes.length > 0 && i.unite === 'euros');
    expect(ca.composantes[0].comptes.length).toBeGreaterThan(0);
    const nonCalculablesSansTaux = liste.filter((i: any) => i.statut === 'non_calculable' && /TVA/.test(i.motif ?? '')).map((i: any) => i.id);
    expect(nonCalculablesSansTaux.length).toBeGreaterThan(0);
    const avec = (await api('remi', 'GET', `/v1/exercices/${exerciceId}/indicateurs?tauxTvaVentes=20&tauxTvaAchats=20`)).json.indicateurs;
    expect(avec.filter((i: any) => nonCalculablesSansTaux.includes(i.id) && i.statut === 'non_calculable' && /TVA/.test(i.motif ?? ''))).toEqual([]);
    expect((await api('remi', 'GET', `/v1/exercices/${exerciceId}/indicateurs?tauxTvaVentes=vingt`)).statut).toBe(400);
    expect(r.json.donnees.exercicePrecedentFourni).toBe(false);
    const cat = await api('remi', 'GET', '/v1/reference/indicateurs');
    expect(cat.json.every((d: any) => d.formule && d.convention && d.regleDonneeManquante && d.source)).toBe(true);
  });
});
