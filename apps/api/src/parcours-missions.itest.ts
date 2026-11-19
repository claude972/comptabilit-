/** Missions, lettres, travaux hors périmètre, estimation de temps et registre des conseils — pile réelle locale. */
import { randomBytes } from 'node:crypto';
import { DEMO } from '@comtaple/db/amorcer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
let entiteId = '';
let missionId = '';
let lettreId = '';
let conseilId = '';

const contenu = (prestations: string[]) => ({
  perimetre: prestations.map((prestation) => ({ prestation })),
  duree: { debut: '2025-01-01', fin: null, taciteReconduction: true },
  honoraires: { mode: 'forfait', montantAnnuelHt: '3600.00', tauxHoraireHt: null, conditionsRevision: 'Révision annuelle selon l’indice convenu' },
  obligationsCabinet: 'Tenue et établissement des comptes annuels',
  obligationsClient: 'Transmission des pièces chaque mois',
  livrables: ['Comptes annuels'],
  mandats: [],
  limites: 'Hors missions sociales et juridiques',
});

beforeAll(async () => {
  await ouvrirSessions();
  entiteId = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai missions ${SEL} SAS (fictif)`, territoireFiscal: 'metropole' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    await api('alice', 'PUT', `/v1/dossiers/${entiteId}/habilitations/${u}`, { niveau });
  }
});

afterAll(async () => {
  // Le compte déposant de démonstration ne garde pas d'habilitation sur le dossier d'essai.
  await api('alice', 'DELETE', `/v1/dossiers/${entiteId}/habilitations/${DEMO.client}`);
});

describe('missions et lettres', () => {
  it('une lettre est un projet sans effet jusqu’à sa validation par une personne habilitée', async () => {
    missionId = (await api('chloe', 'POST', `/v1/dossiers/${entiteId}/missions`, { libelle: 'Mission comptable 2025' })).json.id;
    expect((await api('client', 'POST', `/v1/dossiers/${entiteId}/missions`, { libelle: 'x' })).statut).toBe(403);
    expect((await api('chloe', 'POST', `/v1/missions/${missionId}/lettres`, { dateEffet: '2025-01-01', contenu: { ...contenu(['tenue']), perimetre: [] } })).statut).toBe(400);
    const l = await api('chloe', 'POST', `/v1/missions/${missionId}/lettres`, { dateEffet: '2025-01-01', contenu: contenu(['tenue', 'comptes_annuels']) });
    expect(l.json).toMatchObject({ statut: 'projet', version: 1, origine: 'saisie_humaine' });
    lettreId = l.json.id;
    const t = await api('chloe', 'POST', `/v1/dossiers/${entiteId}/travaux`, { dateTravail: '2025-02-10', prestation: 'tenue', description: 'Saisie de février', tempsObserveMinutes: 120 });
    expect(t.json.rattachement.situation).toBe('aucune_lettre_applicable'); // la lettre n'est qu'un projet
    expect((await api('chloe', 'POST', `/v1/lettres/${lettreId}/validation`)).statut).toBe(403);
    expect((await api('remi', 'POST', `/v1/lettres/${lettreId}/validation`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/lettres/${lettreId}/validation`)).json).toMatchObject({ statut: 'validee', valideePar: DEMO.alice });
    expect((await api('alice', 'POST', `/v1/lettres/${lettreId}/validation`)).statut).toBe(409);
  });

  it('les travaux sont rattachés à la lettre applicable à leur date ; le hors-périmètre est signalé', async () => {
    await api('chloe', 'POST', `/v1/dossiers/${entiteId}/travaux`, { dateTravail: '2025-03-05', prestation: 'fiscal_tva', description: 'Déclaration de TVA de février', tempsObserveMinutes: 45 });
    const liste = (await api('remi', 'GET', `/v1/dossiers/${entiteId}/travaux`)).json;
    const par = Object.fromEntries(liste.map((t: any) => [t.prestation, t.rattachement]));
    expect(par.tenue).toEqual({ situation: 'dans_le_perimetre', lettreId });
    expect(par.fiscal_tva).toMatchObject({ situation: 'potentiellement_hors_perimetre', lettreId });
    expect((await api('client', 'GET', `/v1/dossiers/${entiteId}/travaux`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${entiteId}/travaux`)).statut).toBe(404);
  });

  it('projet d’avenant préparé avec une estimation fondée sur une base nommée, sinon abstention', async () => {
    const liste = (await api('chloe', 'GET', `/v1/dossiers/${entiteId}/travaux`)).json;
    const tva = liste.find((t: any) => t.prestation === 'fiscal_tva');
    const tenue = liste.find((t: any) => t.prestation === 'tenue');
    expect((await api('chloe', 'POST', `/v1/travaux/${tenue.id}/proposition-avenant`)).statut).toBe(409); // dans le périmètre

    // Base explicite : barème du cabinet, défini par un gestionnaire.
    expect((await api('chloe', 'PUT', '/v1/cabinet/baremes/fiscal_tva', { minutesReference: 60 })).statut).toBe(403);
    expect((await api('alice', 'PUT', '/v1/cabinet/baremes/inconnue', { minutesReference: 60 })).statut).toBe(400);
    expect((await api('alice', 'PUT', '/v1/cabinet/baremes/fiscal_tva', { minutesReference: 60 })).statut).toBe(200);

    const p = await api('chloe', 'POST', `/v1/travaux/${tva.id}/proposition-avenant`);
    expect(p.statut).toBe(201);
    expect(p.json.avenant).toMatchObject({ statut: 'projet', origine: 'proposition_avenant', avenantDe: lettreId, dateEffet: '2025-03-05' });
    expect(p.json.avenant.contenu.perimetre.map((x: any) => x.prestation)).toEqual(['tenue', 'comptes_annuels', 'fiscal_tva']);
    expect(p.json.estimation).toMatchObject({ statut: 'estime', minutes: 60, base: 'bareme_cabinet' });
    expect(p.json.mention).toMatch(/Projet/);
    // Tant que l'avenant est un projet, le travail reste signalé ; une fois validé, il entre dans le périmètre.
    const avant = (await api('chloe', 'GET', `/v1/dossiers/${entiteId}/travaux`)).json.find((t: any) => t.id === tva.id);
    expect(avant.rattachement.situation).toBe('potentiellement_hors_perimetre');
    await api('alice', 'POST', `/v1/lettres/${p.json.avenant.id}/validation`);
    const apres = (await api('chloe', 'GET', `/v1/dossiers/${entiteId}/travaux`)).json.find((t: any) => t.id === tva.id);
    expect(apres.rattachement).toEqual({ situation: 'dans_le_perimetre', lettreId: p.json.avenant.id });

    // Sans barème ni temps observés suffisants : aucune estimation inventée.
    const paie = await api('chloe', 'POST', `/v1/dossiers/${entiteId}/travaux`, { dateTravail: '2025-04-02', prestation: 'juridique_annuel', description: 'Approbation des comptes' });
    const sans = await api('chloe', 'POST', `/v1/travaux/${paie.json.id}/proposition-avenant`);
    expect(['estime', 'non_estimable']).toContain(sans.json.estimation.statut);
    if (sans.json.estimation.statut === 'non_estimable') expect(sans.json.estimation).toMatchObject({ minutes: null, base: null });
    else expect(sans.json.estimation.base).toBeTruthy();
  });
});

describe('registre des conseils', () => {
  const corps = { dateConseil: '2025-05-12', objet: 'Option pour le régime réel de TVA', contenu: 'Projet de note sur les conséquences de l’option.', destinataire: 'Gérant de la société' };

  it('un conseil reste un projet jusqu’à validation ; validation et autorisation d’envoi sont deux étapes distinctes', async () => {
    expect((await api('client', 'POST', `/v1/dossiers/${entiteId}/conseils`, corps)).statut).toBe(403);
    const c = await api('chloe', 'POST', `/v1/dossiers/${entiteId}/conseils`, { ...corps, missionId });
    expect(c.json).toMatchObject({ statut: 'projet', version: 1, auteurId: DEMO.chloe });
    conseilId = c.json.id;
    expect((await api('chloe', 'POST', `/v1/dossiers/${entiteId}/conseils`, { ...corps, pieces: ['aaaaaaaa-0000-4000-8000-00000000dead'] })).statut).toBe(400); // pièce d'un autre dossier ou inexistante
    const evt = { type: 'envoi', dateEvenement: '2025-05-13T09:00:00+02:00', canal: 'courriel', justificatif: 'Message envoyé depuis la messagerie du cabinet' };
    expect((await api('chloe', 'POST', `/v1/conseils/${conseilId}/evenements`, evt)).statut).toBe(409); // projet : pas d'envoi
    expect((await api('alice', 'POST', `/v1/conseils/${conseilId}/autorisation-envoi`)).statut).toBe(409); // pas encore validé
    expect((await api('chloe', 'PUT', `/v1/conseils/${conseilId}`, { ...corps, contenu: 'Note relue.' })).json.contenu).toBe('Note relue.');
    expect((await api('remi', 'POST', `/v1/conseils/${conseilId}/validation`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/conseils/${conseilId}/validation`)).json.statut).toBe('valide');
    expect((await api('chloe', 'PUT', `/v1/conseils/${conseilId}`, corps)).statut).toBe(409); // validé : immuable
    expect((await api('chloe', 'POST', `/v1/conseils/${conseilId}/evenements`, evt)).statut).toBe(409); // validé mais envoi non autorisé
    expect((await api('chloe', 'POST', `/v1/conseils/${conseilId}/autorisation-envoi`)).statut).toBe(403);
    expect((await api('alice', 'POST', `/v1/conseils/${conseilId}/autorisation-envoi`)).json.statut).toBe('envoi_autorise');
  });

  it('envoi, remise, réception et lecture sont des faits distincts, consignés seulement avec justificatif', async () => {
    const e = (type: string, date: string, justificatif = 'Accusé de réception du prestataire de messagerie') =>
      api('chloe', 'POST', `/v1/conseils/${conseilId}/evenements`, { type, dateEvenement: date, canal: 'courriel', justificatif });
    expect((await e('reception', '2025-05-13T10:00:00+02:00')).statut).toBe(409); // pas d'envoi consigné
    expect((await e('envoi', '2025-05-13T09:00:00+02:00', 'ok')).statut).toBe(400); // justificatif trop court
    expect((await e('envoi', '2099-01-01T09:00:00+02:00')).statut).toBe(400); // futur
    expect((await e('envoi', '2025-05-13T09:00:00+02:00')).statut).toBe(201);
    expect((await e('reception', '2025-05-12T09:00:00+02:00')).statut).toBe(400); // avant l'envoi
    expect((await e('remise', '2025-05-13T09:01:00+02:00')).statut).toBe(201);
    const registre = (await api('remi', 'GET', `/v1/dossiers/${entiteId}/conseils`)).json.find((c: any) => c.id === conseilId);
    expect(registre.auteur).toBe('Chloé Collab');
    expect(registre.faits.envoi).toBeTruthy();
    expect(registre.faits.remise).toBeTruthy();
    expect(registre.faits.reception).toBeNull(); // non établi : ni déduit de la remise, ni supposé
    expect(registre.faits.lecture).toBeNull();
    expect((await api('client', 'GET', `/v1/dossiers/${entiteId}/conseils`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${entiteId}/conseils`)).statut).toBe(404);
  });

  it('une nouvelle version conserve l’ancienne au registre', async () => {
    const n = await api('chloe', 'POST', `/v1/conseils/${conseilId}/nouvelle-version`);
    expect(n.json).toMatchObject({ statut: 'projet', version: 2, remplaceConseilId: conseilId });
    await api('alice', 'POST', `/v1/conseils/${n.json.id}/validation`);
    const registre = (await api('remi', 'GET', `/v1/dossiers/${entiteId}/conseils`)).json;
    expect(registre.find((c: any) => c.id === conseilId).statut).toBe('remplace');
    expect(registre.find((c: any) => c.id === conseilId).evenements).toHaveLength(2); // l'historique des faits reste attaché à la version envoyée
    expect(registre.find((c: any) => c.id === n.json.id).statut).toBe('valide');
  });
});
