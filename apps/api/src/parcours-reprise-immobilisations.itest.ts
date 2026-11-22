/**
 * Reprise du fichier des immobilisations par import CSV (D-092) — pile réelle locale, cabinet NEUF.
 * Habilitations, isolation, aperçu SANS écriture (vérifié en base et dans le journal), validation explicite, doublons jamais
 * écrasants, idempotence (empreinte du fichier + ligne), concurrence, rapport ligne par ligne et son CSV neutralisé, limites,
 * dégressif enregistré mais non calculé, aucune immobilisation existante modifiée, journal historique intact.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { genererFecSynthetique, TAILLE_MAX_REPRISE } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { ouvrirEssai } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, attendreLot, choisirCabinet, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
const COMPTES = ['alice', 'remi', 'chloe', 'client', 'bruno'] as const;
let editeur: pg.Client;
let cabinet = '';
let dossier = '';
let exercice = '';
let autreDossier = '';

const ENTETE = 'Désignation;Compte;Valeur brute;Date d’acquisition;Date de mise en service;Durée (mois);Mode d’amortissement;Coefficient dégressif;Éligibilité dégressif;Valeur résiduelle';
/** Encodage ISO-8859-15 minimal pour les essais : Latin-1 sauf « œ » (0xBD) et « € » (0xA4). */
const iso885915 = (t: string) => Buffer.from([...t].map((c) => (c === 'œ' ? 0xbd : c === '€' ? 0xa4 : c.charCodeAt(0))));
const b64 = (t: string | Buffer) => Buffer.from(t).toString('base64');
const corps = (texte: string | Buffer, extra: Record<string, unknown> = {}) => ({ nomFichier: 'immobilisations.csv', contenuBase64: b64(texte), ...extra });
const apercu = (qui: string, d: string, texte: string | Buffer, extra: Record<string, unknown> = {}) => api(qui, 'POST', `/v1/dossiers/${d}/reprises-immobilisations/apercu`, corps(texte, extra));
const valider = (qui: string, d: string, texte: string | Buffer, ap: any, extra: Record<string, unknown> = {}) =>
  api(qui, 'POST', `/v1/dossiers/${d}/reprises-immobilisations`, corps(texte, { correspondance: ap.json.correspondance, empreinteApercu: ap.json.empreinteApercu, confirmation: true, ...extra }));
const compter = async (table: string, d = dossier) => Number((await editeur.query(`select count(*)::int as n from ${table} where entite_id = $1`, [d])).rows[0].n);
const instantane = async (d = dossier) => (await editeur.query(`select to_jsonb(i) as v from immobilisations i where entite_id = $1 order by id`, [d])).rows.map((r) => r.v);
const journalDe = async () => (await editeur.query(`select id, action, empreinte, empreinte_precedente from journal_audit where cabinet_id = $1 order by id`, [cabinet])).rows;

async function creerDossier(nom: string): Promise<{ dossier: string; exercice: string }> {
  const d = (await api('alice', 'POST', '/v1/dossiers', { raisonSociale: nom, territoireFiscal: 'metropole', formeJuridique: 'SAS', regimeFiscal: 'IS' })).json.id;
  for (const [u, niveau] of [[DEMO.alice, 'validation'], [DEMO.remi, 'revision'], [DEMO.chloe, 'collaboration'], [DEMO.client, 'depot']] as const) {
    expect((await api('alice', 'PUT', `/v1/dossiers/${d}/habilitations/${u}`, { niveau })).statut).toBeLessThan(300);
  }
  const ex = (await api('alice', 'POST', `/v1/dossiers/${d}/exercices`, { debut: '2025-01-01', fin: '2025-12-31' })).json.id;
  return { dossier: d, exercice: ex };
}

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  cabinet = (await editeur.query(`insert into cabinets (nom) values ($1) returning id`, [`Cabinet d’essai reprise ${SEL} (fictif)`])).rows[0].id;
  await ouvrirEssai(editeur, cabinet, 'demo-essentiel', new Date().toISOString().slice(0, 10));
  for (const [u, role] of [[DEMO.alice, 'administrateur'], [DEMO.remi, 'reviseur'], [DEMO.chloe, 'collaborateur'], [DEMO.client, 'client_deposant']] as const) {
    await editeur.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, $3, now() + interval '25 minutes')`, [cabinet, u, role]);
  }
  for (const qui of ['alice', 'remi', 'chloe', 'client'] as const) choisirCabinet(qui, cabinet);
  ({ dossier, exercice } = await creerDossier(`Société d’essai reprise ${SEL} SAS (fictive)`));
  ({ dossier: autreDossier } = await creerDossier(`Société d’essai reprise bis ${SEL} SAS (fictive)`));
}, 120_000);

afterAll(async () => {
  for (const qui of COMPTES) choisirCabinet(qui, null);
  await editeur.query('update appartenances set actif = false where cabinet_id = $1', [cabinet]);
  await editeur.end();
});

describe('habilitations et isolation', () => {
  const FICHIER = `${ENTETE}\nServeur;218300;1000,00;;15/03/2024;60;;;;`;

  it('un déposant est refusé (403) ; un lecteur ne peut pas importer (403) ; un autre cabinet reçoit 404', async () => {
    expect((await apercu('client', dossier, FICHIER)).statut).toBe(403);
    expect((await api('client', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(FICHIER, { correspondance: {}, empreinteApercu: 'a'.repeat(64), confirmation: true }))).statut).toBe(403);
    expect((await api('client', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations`)).statut).toBe(403);
    // Chloé devient simple lectrice du second dossier.
    expect((await api('alice', 'PUT', `/v1/dossiers/${autreDossier}/habilitations/${DEMO.chloe}`, { niveau: 'lecture' })).statut).toBeLessThan(300);
    expect((await apercu('chloe', autreDossier, FICHIER)).statut).toBe(403);
    const ap = await apercu('chloe', dossier, FICHIER);
    expect(ap.statut).toBe(200);
    expect((await api('chloe', 'POST', `/v1/dossiers/${autreDossier}/reprises-immobilisations`, corps(FICHIER, { correspondance: ap.json.correspondance, empreinteApercu: ap.json.empreinteApercu, confirmation: true }))).statut).toBe(403);
    expect((await api('chloe', 'GET', `/v1/dossiers/${autreDossier}/reprises-immobilisations`)).statut).toBe(200);
    // Un autre cabinet ne voit pas le dossier.
    expect((await apercu('bruno', dossier, FICHIER)).statut).toBe(404);
    expect((await api('bruno', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations`)).statut).toBe(404);
    expect((await api('chloe', 'GET', '/v1/dossiers/00000000-0000-4000-8000-000000000000/reprises-immobilisations')).statut).toBe(404);
    expect(await compter('immobilisations', autreDossier)).toBe(0);
  });

  it('entrées validées par schéma : champ inconnu, Base64 invalide, confirmation absente, empreinte mal formée, identifiant invalide', async () => {
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations/apercu`, { ...corps(FICHIER), inconnu: 1 })).statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations/apercu`, { nomFichier: 'a.csv', contenuBase64: 'pas du base64 !' })).statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations/apercu`, { ...corps(FICHIER), nomFichier: 'a\u0007.csv' })).statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations/apercu`, { ...corps(FICHIER), correspondance: { libelle: -1 } })).statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations/apercu`, { ...corps(FICHIER), correspondance: { pirate: 1 } })).statut).toBe(400);
    const ap = await apercu('chloe', dossier, FICHIER);
    const sans = await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(FICHIER, { correspondance: ap.json.correspondance, empreinteApercu: ap.json.empreinteApercu }));
    expect(sans.statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(FICHIER, { correspondance: ap.json.correspondance, empreinteApercu: ap.json.empreinteApercu, confirmation: false }))).statut).toBe(400);
    expect((await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(FICHIER, { correspondance: ap.json.correspondance, empreinteApercu: 'xyz', confirmation: true }))).statut).toBe(400);
    expect((await apercu('chloe', 'pas-un-uuid', FICHIER)).statut).toBe(400);
    expect(await compter('immobilisations')).toBe(0);
  });
});

describe('aperçu, validation, rapport', () => {
  let ap: any;
  let texte = '';
  let rapportId = '';
  let avant: any[] = [];
  let journalAvant: any[] = [];

  it('prépare une immobilisation existante saisie à la main (elle ne devra jamais changer)', async () => {
    const r = await api('chloe', 'POST', `/v1/dossiers/${dossier}/immobilisations`, { libelle: 'Camion benne', compteImmobilisation: '218200', baseAmortissable: '45000.00', dateMiseEnService: '2023-06-01', dureeMois: 60 });
    expect(r.statut).toBe(201);
    avant = await instantane();
    expect(avant).toHaveLength(1);
  });

  it('APERÇU : mapping proposé, statuts par ligne (valide, invalide avec motif, doublon du dossier, doublon du fichier) et AUCUNE écriture', async () => {
    texte = [
      `${ENTETE};Justification dégressif`,
      'Serveur de fichiers;218300;12 345,60;;15/03/2024;60;;;;;',
      'Four mixte;215400;10000,00;05/11/2025;15/11/2025;120;dégressif;2,25;oui;;Matériel neuf, durée normale de 10 ans (fiche fictive)',
      'Machine sans date;215400;10000,00;;15/11/2025;120;dégressif;2,25;oui;;Matériel neuf, durée normale de 10 ans (fiche fictive)',
      '  CAMION  benne ;218200;45000,00;;01/06/2023;60;;;;;',
      'Serveur de fichiers;218300;12345,60;;15/03/2024;36;;;;;',
      '=HYPERLINK("http://exemple.test","x");218400;100,00;;01/01/2024;12;;;;;',
      'Compte hors classe;231000;100,00;;01/01/2024;12;;;;;',
      'Montant ambigu;218400;1.234;;01/01/2024;12;;;;;',
      'Date impossible;218400;100,00;;30/02/2024;12;;;;;',
      'Logiciel métier;205000;2 000,00;;01/02/2024;36;;;;50,00;',
      'Colonnes manquantes;218400;100,00',
    ].join('\r\n');
    const [nbImmo, nbReprises, nbLignes, nbFichiers, nbJournal] = [await compter('immobilisations'), await compter('reprises_immobilisations'), await compter('lignes_reprise_immobilisations'), Number((await editeur.query('select count(*)::int as n from fichiers where cabinet_id = $1', [cabinet])).rows[0].n), (await journalDe()).length];
    journalAvant = await journalDe();
    ap = await apercu('chloe', dossier, texte);
    expect(ap.statut).toBe(200);
    expect(ap.json.fichier).toMatchObject({ nom: 'immobilisations.csv', encodage: 'utf-8', separateur: ';', nbLignes: 11 });
    expect(ap.json.fichier.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ap.json.correspondance).toMatchObject({ libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateAcquisition: 3, dateMiseEnService: 4, dureeMois: 5, modeAmortissement: 6, coefficientDegressif: 7, eligibiliteDegressifConfirmee: 8, valeurResiduelle: 9, dureeAnnees: null, dateSortie: null });
    expect(ap.json.problemes).toEqual([]);
    expect(ap.json.peutValider).toBe(true);
    const parLigne = new Map<number, any>(ap.json.lignes.map((l: any) => [l.ligne, l]));
    expect(parLigne.get(2)).toMatchObject({ statut: 'valide' });
    expect(parLigne.get(3)).toMatchObject({ statut: 'valide' });
    expect(parLigne.get(4)).toMatchObject({ statut: 'invalide' });
    expect(parLigne.get(4).motifs.join(' ')).toMatch(/Dégressif : la date d’acquisition/);
    expect(parLigne.get(5)).toMatchObject({ statut: 'doublon', cause: 'doublon_dossier' });
    expect(parLigne.get(6)).toMatchObject({ statut: 'doublon', cause: 'doublon_fichier' });
    expect(parLigne.get(7)).toMatchObject({ statut: 'valide' });
    expect(parLigne.get(7).lues.libelle).toBe('=HYPERLINK("http://exemple.test","x")');
    expect(parLigne.get(8).motifs.join(' ')).toMatch(/classe 20/);
    expect(parLigne.get(9).motifs.join(' ')).toMatch(/ambigu/);
    expect(parLigne.get(10).motifs.join(' ')).toMatch(/date/);
    expect(parLigne.get(11)).toMatchObject({ statut: 'valide' });
    expect(parLigne.get(12).motifs[0]).toMatch(/Nombre de colonnes inattendu/);
    expect(ap.json.comptes).toEqual({ total: 11, valides: 4, invalides: 5, doublons: 2 });
    // RIEN n'a été écrit : ni immobilisation, ni reprise, ni ligne de rapport, ni fichier original, ni journal.
    expect(await compter('immobilisations')).toBe(nbImmo);
    expect(await compter('reprises_immobilisations')).toBe(nbReprises);
    expect(await compter('lignes_reprise_immobilisations')).toBe(nbLignes);
    expect(Number((await editeur.query('select count(*)::int as n from fichiers where cabinet_id = $1', [cabinet])).rows[0].n)).toBe(nbFichiers);
    expect((await journalDe()).length).toBe(nbJournal);
    expect(await instantane()).toEqual(avant);
  });

  it('VALIDATION refusée sans l’aperçu confirmé : empreinte obsolète (409), correspondance incomplète (409), rien d’écrit', async () => {
    const faux = await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(texte, { correspondance: ap.json.correspondance, empreinteApercu: 'f'.repeat(64), confirmation: true }));
    expect(faux.statut).toBe(409);
    expect(faux.json.code).toBe('apercu_obsolete');
    // Même empreinte, autre correspondance : le résultat n'est plus celui de l'aperçu.
    const autre = await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(texte, { correspondance: { ...ap.json.correspondance, valeurResiduelle: null }, empreinteApercu: ap.json.empreinteApercu, confirmation: true }));
    expect(autre.statut).toBe(409);
    const incomplete = { ...ap.json.correspondance, dateMiseEnService: null };
    const ap2 = await apercu('chloe', dossier, texte, { correspondance: incomplete });
    expect(ap2.json.peutValider).toBe(false);
    expect(ap2.json.problemes.join(' ')).toMatch(/Colonne obligatoire absente : « Date de mise en service »/);
    expect(ap2.json.lignes.every((l: any) => l.statut === 'invalide' || l.statut === 'doublon')).toBe(true);
    const refus = await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(texte, { correspondance: incomplete, empreinteApercu: ap2.json.empreinteApercu, confirmation: true }));
    expect(refus.statut).toBe(409);
    expect(refus.json.code).toBe('correspondance_invalide');
    expect(await compter('reprises_immobilisations')).toBe(0);
    expect(await compter('immobilisations')).toBe(1);
  });

  it('VALIDATION : crée seulement les lignes valides, en une transaction ; rejets et doublons rapportés ; l’existant est intact ; journal enrichi sans toucher à l’historique', async () => {
    const r = await valider('chloe', dossier, texte, ap);
    expect(r.statut).toBe(201);
    expect(r.json).toMatchObject({ nbLignes: 11, nbCreees: 4, nbIgnorees: 2, nbRejetees: 5, dejaImporte: false, nomFichier: 'immobilisations.csv', encodage: 'utf-8', separateur: ';' });
    rapportId = r.json.id;
    expect(r.json.sha256).toBe(ap.json.fichier.sha256);
    const liste = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json as any[];
    expect(liste).toHaveLength(5);
    const serveur = liste.find((i) => i.libelle === 'Serveur de fichiers');
    expect(serveur).toMatchObject({ compteImmobilisation: '218300', baseAmortissable: '12345.60', dateMiseEnService: '2024-03-15', dureeMois: 60, modeAmortissement: 'lineaire', coefficientDegressif: null, eligibiliteDegressifConfirmee: null });
    const four = liste.find((i) => i.libelle === 'Four mixte');
    expect(four).toMatchObject({ modeAmortissement: 'degressif', coefficientDegressif: '2.25', eligibiliteDegressifConfirmee: true, dateAcquisition: '2025-11-05', dureeMois: 120 });
    expect(liste.find((i) => i.libelle === 'Logiciel métier')).toMatchObject({ compteImmobilisation: '205000', baseAmortissable: '2000.00', dureeMois: 36 });
    // Provenance, en base.
    const prov = (await editeur.query(`select libelle, reprise_id, reprise_ligne, saisie_par from immobilisations where entite_id = $1 and reprise_id is not null order by reprise_ligne`, [dossier])).rows;
    expect(prov.map((p) => p.reprise_ligne)).toEqual([2, 3, 7, 11]);
    expect(prov.every((p) => p.reprise_id === rapportId)).toBe(true);
    // Aucune immobilisation existante modifiée : l'instantané d'avant est inclus à l'identique.
    const maintenant = await instantane();
    for (const ancienne of avant) expect(maintenant).toContainEqual(ancienne);
    // Reprise conservée : fichier original (objet + ligne fichiers), provenance, empreintes.
    const [rep] = (await editeur.query(`select r.*, f.cle_stockage, f.taille as taille_fichier, u.email from reprises_immobilisations r join fichiers f on f.id = r.fichier_id join utilisateurs u on u.id = r.importe_par where r.id = $1`, [rapportId])).rows;
    expect(rep).toMatchObject({ nom_fichier: 'immobilisations.csv', sha256: ap.json.fichier.sha256, empreinte_apercu: ap.json.empreinteApercu, nb_creees: 4, nb_ignorees: 2, nb_rejetees: 5, email: 'chloe.collab@cabinet-a.test' });
    expect(rep.cle_stockage).toContain(ap.json.fichier.sha256);
    expect(Number(rep.taille_fichier)).toBe(Buffer.byteLength(texte));
    // Journal : une entrée de reprise, quatre entrées de saisie (origine reprise), l'historique antérieur inchangé et chaîné.
    const journal = await journalDe();
    for (const ancien of journalAvant) expect(journal.find((j) => j.id === ancien.id)).toEqual(ancien);
    const nouveaux = journal.filter((j) => !journalAvant.some((a) => a.id === j.id));
    expect(nouveaux.filter((j) => j.action === 'immobilisation.reprise')).toHaveLength(1);
    expect(nouveaux.filter((j) => j.action === 'immobilisation.saisie')).toHaveLength(4);
    expect(nouveaux.every((j) => /^[0-9a-f]{64}$/.test(j.empreinte ?? ''))).toBe(true);
    for (let i = 1; i < journal.length; i++) expect(journal[i].empreinte_precedente).toBe(journal[i - 1].empreinte);
    const detailJournal = (await editeur.query(`select details from journal_audit where cabinet_id = $1 and action = 'immobilisation.reprise'`, [cabinet])).rows[0].details;
    expect(detailJournal).toMatchObject({ sha256: ap.json.fichier.sha256, nbCreees: 4, nbRejetees: 5, nbIgnorees: 2 });
  });

  it('RAPPORT ligne par ligne : statut, motif en français, valeur lue ; filtre par statut ; pagination ; lisible dès le niveau lecture', async () => {
    const d = await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}`);
    expect(d.statut).toBe(200);
    expect(d.json.total).toBe(11);
    const l = new Map<number, any>(d.json.lignes.map((x: any) => [x.ligne, x]));
    expect(l.get(2)).toMatchObject({ statut: 'creee', motif: null, lues: { libelle: 'Serveur de fichiers', baseAmortissable: '12 345,60' } });
    expect(l.get(2).immobilisationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(l.get(4)).toMatchObject({ statut: 'rejetee', immobilisationId: null });
    expect(l.get(4).motif).toMatch(/Dégressif : la date d’acquisition/);
    expect(l.get(5)).toMatchObject({ statut: 'ignoree_doublon', cause: 'doublon_dossier' });
    expect(l.get(9).lues.baseAmortissable).toBe('1.234');
    expect(l.get(12).motif).toMatch(/Nombre de colonnes inattendu/);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?statut=rejetee`)).json.total).toBe(5);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?statut=creee`)).json.lignes.map((x: any) => x.ligne)).toEqual([2, 3, 7, 11]);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?statut=autre`)).statut).toBe(400);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?page=2`)).json.lignes).toEqual([]);
    expect((await api('client', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}`)).statut).toBe(404);
    // Un rapport n'est lisible que dans son dossier.
    expect((await api('alice', 'GET', `/v1/dossiers/${autreDossier}/reprises-immobilisations/${rapportId}`)).statut).toBe(404);
    const liste = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations`)).json;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ id: rapportId, nbCreees: 4, importeurNom: expect.any(String) });
  });

  it('RAPPORT téléchargeable (CSV UTF-8, « ; ») : préfixes = + - @ neutralisés, motifs et valeurs lues présents, téléchargement tracé', async () => {
    const r = await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}/rapport.csv`);
    expect(r.statut).toBe(200);
    const csv = r.brut.toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lignes = csv.slice(1).trimEnd().split('\r\n');
    expect(lignes).toHaveLength(12);
    expect(lignes[0]).toContain('Ligne du fichier;Statut;Motif;Désignation (valeur lue)');
    expect(lignes[1]).toMatch(/^2;Créée;;Serveur de fichiers;218300;12 345,60;/);
    // La désignation « formule » est neutralisée (apostrophe) et jamais évaluée.
    const formule = lignes.find((x) => x.startsWith('7;'))!;
    expect(formule).toContain(`"'=HYPERLINK(""http://exemple.test"",""x"")"`);
    expect(csv).toMatch(/Rejetée;Date d’acquisition : Dégressif : la date d’acquisition/);
    expect(csv).toMatch(/Ignorée \(doublon\);Ignorée : une immobilisation identique existe déjà/);
    for (const x of lignes) for (const cellule of x.split(';')) expect(cellule.replace(/^"/, '')).not.toMatch(/^[=+@]/);
    expect((await editeur.query(`select count(*)::int as n from journal_audit where cabinet_id = $1 and action = 'immobilisation.reprise_rapport_telecharge'`, [cabinet])).rows[0].n).toBe(1);
  });

  it('IDEMPOTENCE : rejouer le même fichier avec la même correspondance renvoie le rapport (200), rien n’est écrit de plus', async () => {
    const [i, r, l, j] = [await compter('immobilisations'), await compter('reprises_immobilisations'), await compter('lignes_reprise_immobilisations'), (await journalDe()).length];
    const rejeu = await valider('chloe', dossier, texte, ap);
    expect(rejeu.statut).toBe(200);
    expect(rejeu.json).toMatchObject({ id: rapportId, dejaImporte: true, nbCreees: 4 });
    expect([await compter('immobilisations'), await compter('reprises_immobilisations'), await compter('lignes_reprise_immobilisations'), (await journalDe()).length]).toEqual([i, r, l, j]);
    // Même fichier, autre correspondance (colonne de valeur résiduelle retirée) : chaque ligne déjà reprise est ignorée, plus rien à importer.
    const autre = { ...ap.json.correspondance, valeurResiduelle: null };
    const ap3 = await apercu('chloe', dossier, texte, { correspondance: autre });
    expect(ap3.json.lignes.filter((x: any) => x.cause === 'deja_repris').map((x: any) => x.ligne)).toEqual([2, 3, 7, 11]);
    expect(ap3.json.peutValider).toBe(false);
    const refus = await valider('chloe', dossier, texte, ap3, { correspondance: autre });
    expect(refus.statut).toBe(409);
    expect(refus.json.code).toBe('rien_a_importer');
    expect(await compter('immobilisations')).toBe(i);
  });

  it('DOUBLONS jamais écrasants : un fichier enrichi d’une ligne nouvelle ignore les lignes déjà présentes et ne modifie rien', async () => {
    const enrichi = `${texte}\r\nImprimante;218400;350,00;;01/09/2025;36;;;;;`;
    const ap4 = await apercu('chloe', dossier, enrichi);
    expect(ap4.json.comptes).toMatchObject({ total: 12, valides: 1, doublons: 6 });
    const avantImport = await instantane();
    const r = await valider('chloe', dossier, enrichi, ap4);
    expect(r.statut).toBe(201);
    expect(r.json).toMatchObject({ nbCreees: 1, nbIgnorees: 6, nbRejetees: 5 });
    const apres = await instantane();
    for (const x of avantImport) expect(apres).toContainEqual(x);
    expect(apres).toHaveLength(avantImport.length + 1);
    const rapport = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${r.json.id}?statut=ignoree_doublon`)).json;
    expect(rapport.lignes.map((x: any) => [x.ligne, x.cause])).toEqual([[2, 'doublon_dossier'], [3, 'doublon_dossier'], [5, 'doublon_dossier'], [6, 'doublon_dossier'], [7, 'doublon_dossier'], [11, 'doublon_dossier']]);
  });

  it('retirer une immobilisation reprise reste possible (saisie manuelle inchangée) ; le rapport garde sa trace et le rejeu ne la recrée pas', async () => {
    const ligne = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?statut=creee`)).json.lignes.find((x: any) => x.ligne === 11);
    expect((await api('chloe', 'DELETE', `/v1/dossiers/${dossier}/immobilisations/${ligne.immobilisationId}`)).statut).toBe(200);
    const apres = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/reprises-immobilisations/${rapportId}?statut=creee`)).json;
    expect(apres.lignes.map((x: any) => x.ligne)).toContain(11);
    const rejeu = await valider('chloe', dossier, texte, ap);
    expect(rejeu.statut).toBe(200);
    expect((await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json.some((i: any) => i.libelle === 'Logiciel métier')).toBe(false);
  });

  it('dégressif : enregistré comme déclaration, calcul NON ACTIVÉ par défaut → abstention motivée, aucune proposition dégressive', async () => {
    const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 120, graine: Number.parseInt(SEL.slice(0, 6), 16) });
    const depot = await deposer('remi', dossier, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
    await attendreLot('remi', depot.fin.json.lotImportId);
    const p = (await api('remi', 'GET', `/v1/exercices/${exercice}/inventaire/propositions`)).json;
    expect(p.degressif.active).toBe(false);
    expect(p.degressif.motif).toMatch(/non activé/);
    expect(JSON.stringify(p)).not.toMatch(/INV-AMORT-DEG\|/);
    expect(p.propositions.some((x: any) => String(x.id).startsWith('INV-AMORT-DEG'))).toBe(false);
  }, 120_000);
});

describe('encodages, séparateurs, décimales, dates', () => {
  it('ISO-8859-15 + virgule + AAAA-MM-JJ + durée en années : détectés, accents et € corrects, montants exacts', async () => {
    const texte = ['Libellé,Compte,Montant,Date de mise en service,Durée (ans)', '"Écran 4K œuvre, 2 pièces",218300,"1 234,50",2024-02-29,5', 'Étagère,218400,89.90,2024-03-01,3'].join('\n');
    const brut = iso885915(texte);
    const ap = await apercu('chloe', dossier, brut);
    expect(ap.statut).toBe(200);
    expect(ap.json.fichier).toMatchObject({ encodage: 'iso-8859-15', separateur: ',' });
    expect(ap.json.correspondance).toMatchObject({ libelle: 0, baseAmortissable: 2, dureeAnnees: 4, dureeMois: null });
    expect(ap.json.comptes).toMatchObject({ valides: 2, invalides: 0 });
    const r = await valider('chloe', dossier, brut, ap);
    expect(r.statut).toBe(201);
    const liste = (await api('chloe', 'GET', `/v1/dossiers/${dossier}/immobilisations`)).json as any[];
    expect(liste.find((i) => i.libelle === 'Écran 4K œuvre, 2 pièces')).toMatchObject({ baseAmortissable: '1234.50', dateMiseEnService: '2024-02-29', dureeMois: 60 });
    expect(liste.find((i) => i.libelle === 'Étagère')).toMatchObject({ baseAmortissable: '89.90', dureeMois: 36 });
  });

  it('une durée sans unité n’est pas proposée : la validation exige que la personne choisisse', async () => {
    const texte = 'Libellé;Compte;Montant;Date de mise en service;Durée\nBureau;218400;500,00;01/01/2024;60\n';
    const ap = await apercu('chloe', autreDossier, texte).then(async (r) => (r.statut === 403 ? apercu('remi', autreDossier, texte) : r));
    expect(ap.json.correspondance).toMatchObject({ dureeMois: null, dureeAnnees: null });
    expect(ap.json.remarques.join(' ')).toMatch(/mois ou en années/);
    expect(ap.json.peutValider).toBe(false);
    const choisi = await apercu('remi', autreDossier, texte, { correspondance: { ...ap.json.correspondance, dureeMois: 4 } });
    expect(choisi.json.peutValider).toBe(true);
  });
});

describe('limites et fichiers refusés', () => {
  const ligne = (i: number) => `Bien ${i};218300;${100 + i},00;;01/01/2024;12;;;;`;

  it('5 001 lignes : refus net 413 ; 5 Mio dépassés : 413 ; classeur XLSX, fichier binaire, vide, en-têtes seuls : 422 motivés', async () => {
    const avantRefus = await compter('reprises_immobilisations');
    const trop = [ENTETE, ...Array.from({ length: 5001 }, (_, i) => ligne(i))].join('\n');
    const r = await apercu('chloe', dossier, trop);
    expect(r.statut).toBe(413);
    expect(r.json).toMatchObject({ code: 'trop_de_lignes' });
    expect(r.json.message).toMatch(/5000/);
    const gros = await apercu('chloe', dossier, Buffer.alloc(TAILLE_MAX_REPRISE + 1, 65));
    expect(gros.statut).toBe(413);
    expect(gros.json.code).toBe('trop_gros');
    const valideGros = await api('chloe', 'POST', `/v1/dossiers/${dossier}/reprises-immobilisations`, corps(Buffer.alloc(TAILLE_MAX_REPRISE + 1, 65), { correspondance: {}, empreinteApercu: 'a'.repeat(64), confirmation: true }));
    expect(valideGros.statut).toBe(413);
    const xlsx = await apercu('chloe', dossier, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]));
    expect(xlsx.statut).toBe(422);
    expect(xlsx.json).toMatchObject({ code: 'format' });
    expect(xlsx.json.message).toMatch(/archive ZIP illisible|seuls les formats CSV et XLSX/);
    expect((await apercu('chloe', dossier, Buffer.from([65, 59, 0, 66]))).json.code).toBe('binaire');
    expect((await apercu('chloe', dossier, '   \n ')).json.code).toBe('vide');
    expect((await apercu('chloe', dossier, `${ENTETE}\n`)).json.code).toBe('sans_donnees');
    expect((await apercu('chloe', dossier, `${ENTETE}\nA;"ouvert;1`)).json.code).toBe('guillemet');
    expect(await compter('reprises_immobilisations')).toBe(avantRefus);
  });

  it('5 000 lignes (limite) importées en UNE transaction : toutes créées, rapport complet, pagination par 200', async () => {
    const texte = [ENTETE, ...Array.from({ length: 5000 }, (_, i) => ligne(i))].join('\n');
    const debut = Date.now();
    const ap = await apercu('remi', autreDossier, texte);
    expect(ap.statut).toBe(200);
    expect(ap.json.comptes).toEqual({ total: 5000, valides: 5000, invalides: 0, doublons: 0 });
    const r = await valider('remi', autreDossier, texte, ap);
    expect(r.statut).toBe(201);
    const duree = Date.now() - debut;
    console.info(`reprise de 5000 lignes (aperçu + validation) : ${duree} ms`);
    expect(r.json.nbCreees).toBe(5000);
    expect(await compter('immobilisations', autreDossier)).toBe(5000);
    expect(await compter('lignes_reprise_immobilisations', autreDossier)).toBe(5000);
    const p = (await api('remi', 'GET', `/v1/dossiers/${autreDossier}/reprises-immobilisations/${r.json.id}?page=25`)).json;
    expect(p.lignes).toHaveLength(200);
    expect(p.lignes[0].ligne).toBe(4802);
    expect(duree).toBeLessThan(110_000);
  }, 120_000);

  it('deux validations SIMULTANÉES du même fichier : une seule création, l’autre reçoit le rapport existant', async () => {
    const texte = [ENTETE, ...Array.from({ length: 50 }, (_, i) => `Simultané ${i};218300;${300 + i},00;;01/01/2024;12;;;;`)].join('\n');
    const ap = await apercu('chloe', dossier, texte);
    const [a, b] = await Promise.all([valider('chloe', dossier, texte, ap), valider('remi', dossier, texte, ap)]);
    expect([a.statut, b.statut].sort()).toEqual([200, 201]);
    expect(a.json.id).toBe(b.json.id);
    const n = Number((await editeur.query(`select count(*)::int as n from immobilisations where entite_id = $1 and libelle like 'Simultané %'`, [dossier])).rows[0].n);
    expect(n).toBe(50);
  });

  it('deux fichiers DIFFÉRENTS validés en même temps avec les mêmes lignes : aucun doublon créé (verrou par dossier)', async () => {
    const fichier = (marque: string) => [ENTETE, ...Array.from({ length: 20 }, (_, i) => `Concurrent ${i};218300;${700 + i},00;;01/01/2024;12;;;;`), `Marque ${marque};218300;1,00;;01/01/2024;12;;;;`].join('\n');
    const [f1, f2] = [fichier('un'), fichier('deux')];
    const [ap1, ap2] = [await apercu('chloe', dossier, f1), await apercu('remi', dossier, f2)];
    const [a, b] = await Promise.all([valider('chloe', dossier, f1, ap1), valider('remi', dossier, f2, ap2)]);
    // L'un des deux aperçus est périmé dès que l'autre a écrit (409) ; jamais de doublon dans tous les cas.
    expect([a.statut, b.statut].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    for (const x of [a, b]) expect([201, 409]).toContain(x.statut);
    const n = Number((await editeur.query(`select count(*)::int as n from immobilisations where entite_id = $1 and libelle like 'Concurrent %'`, [dossier])).rows[0].n);
    expect(n).toBe(20);
  });
});

describe('garanties de la base', () => {
  it('RLS forcée, ajout seul pour l’application, aucune écriture du worker', async () => {
    for (const t of ['reprises_immobilisations', 'lignes_reprise_immobilisations']) {
      const r = (await editeur.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = $1`, [t])).rows[0];
      expect(r, t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) expect((await editeur.query(`select has_table_privilege('comtaple_app', $1, $2) as ok`, [t, p])).rows[0].ok, `${t} ${p} app`).toBe(false);
      for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect((await editeur.query(`select has_table_privilege('comtaple_worker', $1, $2) as ok`, [t, p])).rows[0].ok, `${t} ${p} worker`).toBe(false);
      expect((await editeur.query(`select has_table_privilege('comtaple_app', $1, 'INSERT') as ok`, [t])).rows[0].ok).toBe(true);
    }
  });

  it('contraintes : décomptes incohérents, ligne « créée » sans immobilisation, ligne « rejetée » sans motif refusés', async () => {
    const [{ id: rep, fichier_id: fid }] = (await editeur.query(`select id, fichier_id from reprises_immobilisations where entite_id = $1 limit 1`, [dossier])).rows;
    await expect(
      editeur.query(`insert into reprises_immobilisations (cabinet_id, entite_id, fichier_id, nom_fichier, sha256, taille, encodage, separateur, correspondance, empreinte_correspondance, empreinte_apercu, version_analyseur, nb_lignes, nb_creees, nb_ignorees, nb_rejetees, importe_par)
        select cabinet_id, entite_id, fichier_id, nom_fichier, repeat('a', 64), taille, encodage, separateur, correspondance, repeat('b', 64), repeat('c', 64), version_analyseur, 10, 1, 1, 1, importe_par from reprises_immobilisations where id = $1`, [rep]),
    ).rejects.toThrow(/reprises_immobilisations_valeurs/);
    await expect(editeur.query(`insert into lignes_reprise_immobilisations (cabinet_id, entite_id, reprise_id, sha256, numero_ligne, statut, valeurs_lues) values ($1, $2, $3, repeat('d', 64), 99, 'creee', '{}')`, [cabinet, dossier, rep])).rejects.toThrow(/lignes_reprise_valeurs/);
    await expect(editeur.query(`insert into lignes_reprise_immobilisations (cabinet_id, entite_id, reprise_id, sha256, numero_ligne, statut, valeurs_lues) values ($1, $2, $3, repeat('d', 64), 99, 'rejetee', '{}')`, [cabinet, dossier, rep])).rejects.toThrow(/lignes_reprise_valeurs/);
    void fid;
  });
});

/** Archive ZIP minimale (deflate) pour fabriquer des classeurs XLSX synthétiques. */
function zipXlsx(parties: Record<string, string>): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, contenu] of Object.entries(parties)) {
    const brut = Buffer.from(contenu, 'utf8');
    const donnees = deflateRawSync(brut);
    const nomB = Buffer.from(nom, 'utf8');
    const crc = crc32(brut);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(donnees.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nomB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(donnees.length, 20); central.writeUInt32LE(brut.length, 24); central.writeUInt16LE(nomB.length, 28); central.writeUInt32LE(decalage, 42);
    locaux.push(local, nomB, donnees);
    centraux.push(central, nomB);
    decalage += 30 + nomB.length + donnees.length;
  }
  const rep = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  const n = Object.keys(parties).length;
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(n, 8); fin.writeUInt16LE(n, 10); fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, rep, fin]);
}

describe('classeur XLSX (D-124) : même aperçu, même validation, mêmes garde-fous que le CSV', () => {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const chaines = ['Désignation', 'Compte', 'Valeur brute', 'Date de mise en service', 'Durée (mois)', 'Fourgon XLSX (fictif)', '=HYPERLINK("http://exemple.test","x")'];
  const classeur = Buffer.from(
    zipXlsx({
      'xl/workbook.xml': `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Immo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': `<sst ${NS}>${chaines.map((c) => `<si><t>${c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</t></si>`).join('')}</sst>`,
      'xl/styles.xml': `<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1">${[0, 1, 2, 3, 4].map((i) => `<c r="${'ABCDE'[i]}1" t="s"><v>${i}</v></c>`).join('')}</row><row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2"><v>218200</v></c><c r="C2"><v>23500.75</v></c><c r="D2" s="1"><v>45366</v></c><c r="E2"><v>60</v></c></row><row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3"><v>218300</v></c><c r="C3"><v>100</v></c><c r="D3" s="1"><v>45366</v></c><c r="E3"><v>12</v></c></row></sheetData></worksheet>`,
    }),
  );
  let d = '';
  const xlsxCorps = (extra: Record<string, unknown> = {}) => ({ nomFichier: 'immobilisations.xlsx', contenuBase64: classeur.toString('base64'), ...extra });

  it('aperçu sans écriture : colonnes proposées, dates lues JJ/MM/AAAA, formule neutralisée, rien en base', async () => {
    ({ dossier: d } = await creerDossier(`Société d’essai XLSX ${SEL} SAS (fictive)`));
    const ap = await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations/apercu`, xlsxCorps());
    expect(ap.statut).toBe(200);
    expect(ap.json.fichier).toMatchObject({ encodage: 'xlsx', nbLignes: 2 });
    expect(ap.json.fichier.avertissements.join(' ')).toMatch(/formules ne sont pas évaluées/);
    expect(ap.json.correspondance).toMatchObject({ libelle: 0, compteImmobilisation: 1, baseAmortissable: 2, dateMiseEnService: 3, dureeMois: 4 });
    expect(ap.json.lignes[0]).toMatchObject({ ligne: 2, statut: 'valide', lues: { dateMiseEnService: '15/03/2024', baseAmortissable: '23500,75' } });
    expect(ap.json.lignes[1].lues.libelle).toBe('=HYPERLINK("http://exemple.test","x")'); // valeur conservée telle quelle, neutralisée à l'affichage
    expect(await compter('immobilisations', d)).toBe(0);
    expect(await compter('reprises_immobilisations', d)).toBe(0);
  });

  it('validation : immobilisations créées avec les dates et montants exacts ; rejeu idempotent ; un déposant est refusé', async () => {
    const ap = await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations/apercu`, xlsxCorps());
    const corpsValidation = xlsxCorps({ correspondance: ap.json.correspondance, empreinteApercu: ap.json.empreinteApercu, confirmation: true });
    expect((await api('client', 'POST', `/v1/dossiers/${d}/reprises-immobilisations`, corpsValidation)).statut).toBe(403);
    const r = await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations`, corpsValidation);
    expect(r.statut).toBeLessThan(300);
    const lignes = (await editeur.query(`select libelle, base_amortissable::text as base, date_mise_en_service::text as date, duree_mois from immobilisations where entite_id = $1 order by base_amortissable desc`, [d])).rows;
    expect(lignes[0]).toMatchObject({ libelle: 'Fourgon XLSX (fictif)', base: '23500.75', date: '2024-03-15', duree_mois: 60 });
    expect(await compter('immobilisations', d)).toBe(2);
    const rejeu = await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations`, corpsValidation);
    expect(rejeu.statut).toBeLessThan(300);
    expect(await compter('immobilisations', d)).toBe(2);
  });

  it('classeur hostile : archive tronquée, partie corrompue, XML à DOCTYPE : 422 motivés, rien d’écrit', async () => {
    const avant = await compter('reprises_immobilisations', d);
    expect((await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations/apercu`, xlsxCorps({ contenuBase64: classeur.subarray(0, 120).toString('base64') }))).statut).toBe(422);
    const xxe = zipXlsx({ 'xl/workbook.xml': '<!DOCTYPE x [<!ENTITY a "b">]><workbook/>' });
    const r = await api('chloe', 'POST', `/v1/dossiers/${d}/reprises-immobilisations/apercu`, { nomFichier: 'x.xlsx', contenuBase64: xxe.toString('base64') });
    expect(r.statut).toBe(422);
    expect(r.json).toMatchObject({ code: 'format' });
    expect(await compter('reprises_immobilisations', d)).toBe(avant);
  });
});

describe('composants par import (D-125) : rattachement au bien principal, jamais deviné', () => {
  const E = 'Désignation;Compte;Valeur brute;Date de mise en service;Durée (mois);Composant de';
  let d = '';

  it('composant d’un bien du même fichier et d’un bien déjà au dossier ; ambigu, introuvable et composant de composant rejetés', async () => {
    ({ dossier: d } = await creerDossier(`Société d’essai composants ${SEL} SAS (fictive)`));
    expect((await api('chloe', 'POST', `/v1/dossiers/${d}/immobilisations`, { libelle: 'Entrepôt existant', compteImmobilisation: '213100', baseAmortissable: '90000.00', dateMiseEnService: '2020-01-01', dureeMois: 300 })).statut).toBeLessThan(300);
    const texte = [
      E,
      'Bâtiment neuf;213100;50000,00;01/02/2024;300;',
      'Toiture du bâtiment;213500;8000,00;01/02/2024;180;batiment NEUF',
      'Quai de chargement;213500;3000,00;01/03/2024;120;Entrepôt existant',
      'Cloison;213500;1000,00;01/03/2024;120;Toiture du bâtiment',
      'Absent;213500;900,00;01/03/2024;120;Bien inconnu',
    ].join('\n');
    const ap = await apercu('chloe', d, texte);
    expect(ap.statut).toBe(200);
    expect(ap.json.correspondance.composantDe).toBe(5);
    const parLigne = new Map<number, any>(ap.json.lignes.map((l: any) => [l.ligne, l]));
    expect(parLigne.get(2)).toMatchObject({ statut: 'valide', composant: null });
    expect(parLigne.get(3)).toMatchObject({ statut: 'valide', composant: { vers: { type: 'fichier', ligne: 2 } } });
    expect(parLigne.get(4)).toMatchObject({ statut: 'valide', composant: { vers: { type: 'dossier' } } });
    expect(parLigne.get(5).statut).toBe('invalide');
    expect(parLigne.get(5).motifs.join(' ')).toMatch(/lui-même un composant/);
    expect(parLigne.get(6).motifs.join(' ')).toMatch(/aucun bien principal/);
    const r = await valider('chloe', d, texte, ap);
    expect(r.statut).toBeLessThan(300);
    const lignes = (await editeur.query(`select i.libelle, p.libelle as principal from immobilisations i left join immobilisations p on p.id = i.composant_de where i.entite_id = $1 order by i.libelle`, [d])).rows;
    const dict = Object.fromEntries(lignes.map((l: any) => [l.libelle, l.principal]));
    expect(dict).toMatchObject({ 'Toiture du bâtiment': 'Bâtiment neuf', 'Quai de chargement': 'Entrepôt existant', 'Bâtiment neuf': null, 'Entrepôt existant': null });
    expect(Object.keys(dict)).toHaveLength(4); // Cloison et Absent rejetés, rien d'autre créé
  });
});
