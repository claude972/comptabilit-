/**
 * Correspondance comptes 512 / comptes bancaires — pile réelle locale.
 * Cabinet NEUF à chaque exécution (opération d'éditeur) : un dossier à DEUX comptes de banque et DEUX comptes bancaires,
 * pour lequel le rapprochement bancaire (TRE-003) ne peut pas être réalisé sans correspondance approuvée.
 */
import { randomBytes } from 'node:crypto';
import { analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client'] as const;
const IBAN_A = 'FR7630006000011234567890189';
const IBAN_B = 'FR1420041010050500013M02606';
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';
const chemin = () => `/v1/exercices/${exercice}/correspondance-banque`;

async function tre003(): Promise<any> {
  const lance = await api('remi', 'POST', `/v1/exercices/${exercice}/controles`);
  const r = await attendre(() => api('remi', 'GET', `/v1/exercices/${exercice}/revue`), (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine');
  return r.json.resultats.find((x: any) => x.controleId === 'TRE-003');
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai correspondance ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '20 minutes')`, [cabinet, u, role]);
  }
  for (const qui of COMPTES) choisirCabinet(qui, cabinet);
  dossier = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Dossier deux banques ${SEL} (fictif)`, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${dossier}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  exercice = (await api('chloe', 'POST', `/v1/dossiers/${dossier}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;

  // FEC synthétique (un seul compte 512) auquel on ajoute un virement interne vers un SECOND compte de banque.
  const graine = Number.parseInt(SEL.slice(0, 6), 16);
  const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 120, graine });
  const virement = (compte: string, libelle: string, debit: string, credit: string) => ['BQ', 'Banque', 'BQVIR001', '20250615', compte, libelle, '', '', 'VIR-INT-1', '20250615', 'Virement interne entre comptes', debit, credit, '', '', '20250615', '', ''].join('\t');
  const contenu = Buffer.from(Buffer.from(fec.contenu).toString('utf8') + `${virement('51210000', 'Banque – second compte', '500,00', '0,00')}\r\n${virement('51200000', 'Banque', '0,00', '500,00')}\r\n`, 'utf8');
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(contenu), { surLigne: (l) => void lignes.push(l) });
  const d = await deposer('remi', dossier, contenu, { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  expect((await attendreLot('remi', d.fin.json.lotImportId)).json.rapport.lisible).toBe(true);
  // Deux relevés, sur deux comptes bancaires différents.
  const releveA = genererReleveSynthetique({ graine, format: 'camt.053', debut: '2025-01-01', fin: '2025-12-31', nbMouvements: 5000, iban: IBAN_A, coherentAvec: lignes.filter((l) => l.compteNum === '51200000') });
  const releveB = genererReleveSynthetique({ graine: graine + 1, format: 'camt.053', debut: '2025-06-01', fin: '2025-06-30', nbMouvements: 5, iban: IBAN_B });
  for (const r of [releveA, releveB]) {
    const depot = await deposer('remi', dossier, Buffer.from(r.contenu, 'utf8'), { usage: 'banque' }, `${r.nomFichier.replace(/\.xml$/, '')}-${r === releveA ? 'a' : 'b'}.xml`);
    expect((await attendreLot('remi', depot.fin.json.lotImportId)).json.statut).toBe('termine');
  }
}, 240_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('correspondance comptes 512 / comptes bancaires', () => {
  let refA = '';
  let refB = '';
  let regleId = '';

  it('deux comptes de chaque côté : association indéterminée, rapprochement bancaire non réalisé, IBAN jamais renvoyé en clair', async () => {
    const r = await api('remi', 'GET', chemin());
    expect(r.statut).toBe(200);
    expect(r.json).toMatchObject({ donneesComptables: true, etat: 'indeterminee', enVigueur: { origine: null, correspondances: [] }, propositions: [] });
    expect(r.json.motif).toMatch(/Association indéterminée entre 2 compte\(s\) 512 et 2 compte\(s\) bancaire\(s\)/);
    expect(r.json.comptes.map((c: any) => [c.compteNum, c.etat, c.compteBancaire])).toEqual([['51200000', 'non_associe', null], ['51210000', 'non_associe', null]]);
    expect(r.json.comptes[1]).toMatchObject({ compteLib: 'Banque – second compte', nbLignes: 1 });
    expect(r.json.comptesBancaires.map((c: any) => c.libelle).sort()).toEqual(['••••••••0189', '••••••••2606']);
    expect(r.json.comptesBancaires.every((c: any) => c.libre === true && c.nbReleves === 1 && /^[0-9a-f]{24}$/.test(c.ref))).toBe(true);
    for (const iban of [IBAN_A, IBAN_B]) expect(r.brut.toString('utf8')).not.toContain(iban);
    refA = r.json.comptesBancaires.find((c: any) => c.libelle.endsWith('0189')).ref;
    refB = r.json.comptesBancaires.find((c: any) => c.libelle.endsWith('2606')).ref;
    // Le contrôle lui-même le dit : non réalisé, jamais « sans anomalie ».
    const controle = await tre003();
    expect(controle.statut).toBe('non_realise');
    expect(controle.motif).toMatch(/Association indéterminée/);
  });

  it('habilitations : lecture pour consulter, collaboration pour proposer ; déposant, autre cabinet et saisies invalides refusés', async () => {
    const corps = { motif: 'Deux comptes de banque distincts', correspondances: [{ compteNum: '51200000', compteBancaireRef: refA }, { compteNum: '51210000', compteBancaireRef: refB }] };
    expect((await api('client', 'GET', chemin())).statut).toBe(404); // déposant (niveau « dépôt ») : l'exercice ne lui est pas visible
    expect((await api('client', 'POST', chemin(), corps)).statut).toBe(403); // et son rôle ne propose rien
    expect((await api('bruno', 'GET', chemin())).statut).toBe(404); // autre cabinet : l'exercice n'existe pas pour lui
    expect((await api('bruno', 'POST', chemin(), corps)).statut).toBe(404);
    // Référence d'un autre dossier ou inventée, compte qui n'est pas un compte de banque, doublons, saisie vide.
    expect((await api('chloe', 'POST', chemin(), { ...corps, correspondances: [{ compteNum: '51200000', compteBancaireRef: 'a'.repeat(24) }] })).statut).toBe(400);
    expect((await api('chloe', 'POST', chemin(), { ...corps, correspondances: [{ compteNum: '51200000', compteBancaireRef: IBAN_A }] })).statut).toBe(400); // un IBAN n'est pas une référence
    const pasBanque = await api('chloe', 'POST', chemin(), { ...corps, correspondances: [{ compteNum: '40100000', compteBancaireRef: refA }] });
    expect(pasBanque.statut).toBe(400);
    expect(JSON.stringify(pasBanque.json)).toMatch(/n’est pas un compte de banque/);
    const double = await api('chloe', 'POST', chemin(), { ...corps, correspondances: [{ compteNum: '51200000', compteBancaireRef: refA }, { compteNum: '51210000', compteBancaireRef: refA }] });
    expect(double.statut).toBe(400);
    expect(JSON.stringify(double.json)).toMatch(/associé à plusieurs comptes comptables/);
    expect(JSON.stringify(double.json)).not.toContain(IBAN_A);
    expect((await api('chloe', 'POST', chemin(), { ...corps, correspondances: [] })).statut).toBe(400);
    expect((await api('chloe', 'POST', chemin(), { ...corps, motif: 'x' })).statut).toBe(400);
    expect((await api('remi', 'GET', chemin())).json.propositions).toEqual([]); // aucun refus n'a rien créé
  });

  it('une proposition n’a aucun effet tant qu’elle n’est pas approuvée par une autre personne, après mesure d’impact', async () => {
    const corps = { motif: 'Deux comptes de banque distincts', correspondances: [{ compteNum: '51210000', compteBancaireRef: refB }, { compteNum: '51200000', compteBancaireRef: refA }] };
    const p = await api('chloe', 'POST', chemin(), corps);
    expect(p.statut).toBe(201);
    expect(p.json).toMatchObject({ version: 1, statut: 'proposee' });
    regleId = p.json.id;
    expect((await api('chloe', 'POST', chemin(), corps)).statut).toBe(409); // déjà proposée
    const etat = (await api('remi', 'GET', chemin())).json;
    expect(etat).toMatchObject({ etat: 'indeterminee', enVigueur: { origine: null, correspondances: [] } });
    expect(etat.propositions).toHaveLength(1);
    expect(etat.propositions[0]).toMatchObject({ id: regleId, proposeeParNom: 'Chloé Collab', impactMesure: false });
    expect(etat.propositions[0].correspondances).toEqual([{ compteNum: '51200000', compteBancaireRef: refA, compteBancaire: '••••••••0189' }, { compteNum: '51210000', compteBancaireRef: refB, compteBancaire: '••••••••2606' }]);
    expect((await tre003()).statut).toBe('non_realise'); // toujours pas réalisé

    // C'est une règle du cabinet comme une autre : visible dans la liste, approuvable seulement par un gestionnaire tiers.
    const regle = (await api('remi', 'GET', '/v1/regles?page=1&controleId=TRE-003')).json.regles.find((x: any) => x.id === regleId);
    expect(regle).toMatchObject({ statut: 'proposee', entiteId: dossier, controleId: 'TRE-003' });
    expect((await api('chloe', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403);
    expect((await api('remi', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(403); // réviseur : pas gestionnaire
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(409); // impact non mesuré
    const impact = await api('chloe', 'POST', `/v1/regles/${regleId}/impact`, { exerciceId: exercice });
    expect(impact.statut).toBe(200);
    // La mesure porte sur les mêmes relevés que le contrôle réel : avant, non réalisé ; après, réalisé.
    expect(impact.json.avant.statut).toBe('non_realise');
    expect(['constat', 'sans_anomalie']).toContain(impact.json.apres.statut);
  });

  it('approuvée : la correspondance est en vigueur, le rapprochement bancaire est réalisé compte par compte, et tout est tracé', async () => {
    expect((await api('alice', 'POST', `/v1/regles/${regleId}/approuver`)).statut).toBe(200);
    const etat = (await api('remi', 'GET', chemin())).json;
    expect(etat).toMatchObject({ etat: 'determinee', motif: null, propositions: [] });
    expect(etat.enVigueur.origine).toMatchObject({ regleId, portee: 'dossier', version: 1 });
    expect(etat.comptes.map((c: any) => [c.compteNum, c.etat, c.compteBancaireRef, c.compteBancaire])).toEqual([
      ['51200000', 'associe', refA, '••••••••0189'],
      ['51210000', 'associe', refB, '••••••••2606'],
    ]);
    expect(etat.comptesBancaires.every((c: any) => c.libre === false)).toBe(true);
    const corps = { motif: 'Même correspondance', correspondances: [{ compteNum: '51200000', compteBancaireRef: refA }, { compteNum: '51210000', compteBancaireRef: refB }] };
    expect((await api('chloe', 'POST', chemin(), corps)).statut).toBe(409); // déjà en vigueur
    const controle = await tre003();
    expect(['constat', 'sans_anomalie']).toContain(controle.statut);
    expect(controle.source.regleCabinet).toMatchObject({ regleId });
    const actions = (await api('alice', 'GET', '/v1/audit?limite=80')).json.lignes.filter((l: any) => l.cibleId === regleId);
    expect(actions.map((l: any) => l.action)).toEqual(expect.arrayContaining(['regle.proposee', 'regle.impact_mesure', 'regle.approuvee']));
    expect(actions.find((l: any) => l.action === 'regle.proposee').details).toMatchObject({ origine: 'correspondance_banque', comptes: ['51200000', '51210000'] });
    expect(JSON.stringify(actions)).not.toContain(IBAN_A); // l'audit ne recopie pas les comptes bancaires
  });

  it('modifier la correspondance repasse par une nouvelle proposition ; l’ancienne reste en vigueur jusqu’à la décision', async () => {
    const inverse = { motif: 'Inversion des deux comptes', correspondances: [{ compteNum: '51200000', compteBancaireRef: refB }, { compteNum: '51210000', compteBancaireRef: refA }] };
    const p = await api('remi', 'POST', chemin(), inverse);
    expect(p.statut).toBe(201);
    expect(p.json.version).toBe(2);
    const etat = (await api('remi', 'GET', chemin())).json;
    expect(etat.enVigueur.origine).toMatchObject({ regleId, version: 1 });
    expect(etat.comptes[0]).toMatchObject({ compteNum: '51200000', compteBancaireRef: refA });
    expect(etat.propositions.map((x: any) => x.version)).toEqual([2]);
    expect((await api('alice', 'POST', `/v1/regles/${p.json.id}/refuser`, { motif: 'Inversion injustifiée' })).statut).toBe(200);
    expect((await api('remi', 'GET', chemin())).json).toMatchObject({ etat: 'determinee', propositions: [] });
  });
});
