/**
 * Parcours banque et rapprochements sur la pile RÉELLE locale (Keycloak, API, worker, PostgreSQL, Redis, S3).
 * Jeux synthétiques : un FEC, et un relevé construit pour être cohérent avec son compte 512 (avec des écarts connus).
 * Chaque exécution provisionne un dossier NEUF (rôle d'administration, comme le ferait le provisionnement) : les
 * mouvements bancaires s'accumulent par dossier, et le parcours doit rester rejouable.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneFec } from '@comtaple/core';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, attendre, attendreLot, deposer, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
/** Dossier et exercice créés pour cette exécution. */
const D = { entite: randomUUID(), exercice: randomUUID(), entiteCsv: randomUUID() };
const graine = Number.parseInt(SEL.slice(0, 6), 16);
const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine });
let releve: ReturnType<typeof genererReleveSynthetique>;
let lotReleve = '';
let executionId = '';
let rangVersId = new Map<number, string>();

const banque = (extra: Record<string, unknown> = {}) => ({ usage: 'banque', ...extra });
const etatBanque = (qui = 'remi') => api(qui, 'GET', `/v1/dossiers/${D.entite}/banque`);
const dernier = (qui = 'remi') => api(qui, 'GET', `/v1/exercices/${D.exercice}/rapprochements`);

async function tousLesMouvements(): Promise<any[]> {
  const tous: any[] = [];
  for (let page = 1; ; page++) {
    const r = await api('remi', 'GET', `/v1/dossiers/${D.entite}/banque/mouvements?du=${EXERCICE.debut}&au=${EXERCICE.fin}&page=${page}`);
    tous.push(...r.json.mouvements);
    if (!r.json.suite) return tous;
  }
}

beforeAll(async () => {
  await ouvrirSessions();
  const admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  try {
    for (const [id, nom] of [[D.entite, `Essai banque ${SEL} SARL (fictif)`], [D.entiteCsv, `Essai banque CSV ${SEL} SARL (fictif)`]] as const) {
      await admin.query(`insert into entites (id, cabinet_id, raison_sociale, forme_juridique, regime_fiscal, territoire_fiscal) values ($1, $2, $3, 'SARL', 'IS', 'metropole')`, [id, DEMO.cabinetA, nom]);
      await admin.query(`insert into habilitations_dossier (cabinet_id, entite_id, utilisateur_id, niveau) values ($1, $2, $3, 'revision')`, [DEMO.cabinetA, id, DEMO.remi]);
    }
    await admin.query(`insert into exercices (id, cabinet_id, entite_id, debut, fin) values ($1, $2, $3, '2025-01-01', '2025-12-31')`, [D.exercice, DEMO.cabinetA, D.entite]);
  } finally {
    await admin.end();
  }
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
  releve = genererReleveSynthetique({ graine, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 5000, coherentAvec: lignes });
  // Données comptables de l'exercice.
  const d = await deposer('remi', D.entite, Buffer.from(fec.contenu), { usage: 'fec', exerciceId: D.exercice, statutDonnees: 'travail_avant_cloture' }, fec.nomFichier);
  expect((await attendreLot('remi', d.fin.json.lotImportId)).json.rapport.lisible).toBe(true);
});

describe('import de relevés bancaires', () => {
  it('est refusé sans habilitation suffisante sur le dossier', async () => {
    const contenu = Buffer.from(releve.contenu, 'utf8');
    expect((await deposer('alice', D.entite, contenu, banque(), releve.nomFichier)).ouverture.statut).toBe(404); // administratrice non habilitée
    expect((await deposer('bruno', D.entite, contenu, banque(), releve.nomFichier)).ouverture.statut).toBe(404); // autre cabinet
    expect((await deposer('client', DEMO.dupain, contenu, banque(), releve.nomFichier)).ouverture.statut).toBe(403); // déposant
    expect((await etatBanque('alice')).statut).toBe(404);
  });

  it('lit un relevé camt.053, enregistre les mouvements et vérifie le cadrage des soldes', async () => {
    const d = await deposer('remi', D.entite, Buffer.from(releve.contenu, 'utf8'), banque(), releve.nomFichier);
    expect(d.fin.json).toMatchObject({ recu: true, dejaImporte: false });
    lotReleve = d.fin.json.lotImportId;
    const lot = await attendreLot('remi', lotReleve);
    expect(lot.json.statut).toBe('termine');
    expect(lot.json.rapport).toMatchObject({ format: 'camt.053', lisible: true, nbMouvements: releve.attendu.nbMouvements, nbNouveaux: releve.attendu.nbMouvements, nbDejaConnus: 0 });
    const etat = await etatBanque();
    const r = etat.json.releves.find((x: any) => x.lotImportId === lotReleve);
    expect(r).toMatchObject({ iban: releve.attendu.iban, cadrage: 'ok', soldeOuverture: releve.attendu.soldeOuverture, soldeCloture: releve.attendu.soldeCloture, nbMouvements: releve.attendu.nbMouvements });
    expect(r.ecart).toBe('0.00');
    const mouvements = await tousLesMouvements();
    expect(mouvements).toHaveLength(releve.attendu.nbMouvements);
    rangVersId = new Map(mouvements.map((m) => [m.rang as number, m.id as string]));
    // Les montants sont des chaînes décimales signées, jamais des nombres.
    expect(mouvements.every((m) => typeof m.montant === 'string' && /^-?\d+\.\d{2}$/.test(m.montant))).toBe(true);
  });

  it('l’aperçu d’un relevé non CSV dit qu’aucun profil n’est nécessaire, et ne lit que le début du fichier', async () => {
    const r = await api('remi', 'GET', `/v1/imports/${lotReleve}/apercu`);
    expect(r.json.format).toBe('camt.053');
    expect(r.json.profilPropose).toBeNull();
    expect(r.json.lignes.length).toBeLessThanOrEqual(15);
    expect(JSON.stringify(r.json).length).toBeLessThan(20_000);
  });

  it('réimporter le même relevé ne duplique aucun mouvement', async () => {
    const d = await deposer('remi', D.entite, Buffer.from(releve.contenu, 'utf8'), banque(), releve.nomFichier);
    expect(d.fin.json).toMatchObject({ recu: true, dejaImporte: true, lotImportId: lotReleve });
    expect((await etatBanque()).json.nbMouvements).toBe(releve.attendu.nbMouvements);
  });

  it('un fichier qui n’est pas un relevé échoue proprement, sans rien enregistrer', async () => {
    const d = await deposer('remi', D.entite, Buffer.from(`%PDF-1.4 ceci n'est pas un relevé ${SEL}`), banque(), 'releve.pdf');
    const lot = await attendreLot('remi', d.fin.json.lotImportId);
    expect(lot.json.statut).toBe('echec');
    expect(lot.json.rapport.lisible).toBe(false);
    expect((await etatBanque()).json.nbMouvements).toBe(releve.attendu.nbMouvements);
  });

  // Dossier distinct : un relevé sans identité de compte rendrait indéterminée l'association avec le compte 512 du dossier Martin.
  it('un CSV aux colonnes non reconnues s’abstient, puis s’importe avec un profil confirmé par un humain', async () => {
    const csv = Buffer.from(`Quand;Quoi;Combien\n05/02/2024;Abonnement ${SEL};-12,50\n06/02/2024;Remise ${SEL};100,00\n`, 'utf8');
    const d = await deposer('remi', D.entiteCsv, csv, banque(), 'export-banque.csv');
    const id = d.fin.json.lotImportId;
    const echec = await attendreLot('remi', id);
    expect(echec.json.statut).toBe('echec');
    expect(echec.json.rapport.profilAConfirmer).toBe(true);
    // Aperçu pour confirmer le profil : début du fichier seulement, texte brut, séparateur plausible, aucune proposition forcée.
    const apercu = await api('remi', 'GET', `/v1/imports/${id}/apercu`);
    expect(apercu.statut).toBe(200);
    expect(apercu.json.format).toBe('csv');
    expect(apercu.json.lignes[0]).toBe('Quand;Quoi;Combien');
    expect(apercu.json.lignes).toHaveLength(3);
    expect(apercu.json.separateurs).toHaveLength(1);
    expect(apercu.json.separateurs[0]).toMatchObject({ separateur: ';', nbColonnes: 3 });
    expect(apercu.json.separateurs[0].cellules[1][2]).toBe('-12,50');
    expect(apercu.json.profilPropose).toBeNull();
    expect(apercu.json.raisons.length).toBeGreaterThan(0);
    expect((await api('client', 'GET', `/v1/imports/${id}/apercu`)).statut).toBe(404);
    expect((await api('bruno', 'GET', `/v1/imports/${id}/apercu`)).statut).toBe(404);
    const profilCsv = { separateur: ';', lignesEntete: 1, colonnes: { date: 'Quand', libelle: 'Quoi', montant: 'Combien' }, formatDate: 'JJ/MM/AAAA', decimale: ',' };
    expect((await api('client', 'POST', `/v1/imports/${id}/relancer`, { profilCsv })).statut).toBe(404);
    expect((await api('remi', 'POST', `/v1/imports/${id}/relancer`, { profilCsv })).statut).toBe(202);
    const ok = await attendre(
      () => api('remi', 'GET', `/v1/imports/${id}`),
      (r) => ['termine', 'termine_avec_erreurs'].includes(r.json?.statut) || (r.json?.statut === 'echec' && !r.json.rapport.profilAConfirmer),
    );
    expect(ok.json.statut).toMatch(/^termine/);
    expect(ok.json.rapport).toMatchObject({ format: 'csv', nbMouvements: 2, nbNouveaux: 2 });
    expect(ok.json.rapport.profilCsv.origine).toBe('confirme');
    // Sans solde dans le fichier, le cadrage est « non vérifiable » — jamais « ok ».
    const r = (await api('remi', 'GET', `/v1/dossiers/${D.entiteCsv}/banque`)).json.releves.find((x: any) => x.lotImportId === id);
    expect(r.cadrage).toBe('non_verifiable');
  });
});

describe('rapprochement banque ↔ comptabilité', () => {
  it('propose des rapprochements expliqués, sans jamais apparier ce qui n’a pas de contrepartie', async () => {
    expect((await api('client', 'POST', `/v1/exercices/${D.exercice}/rapprochements`, {})).statut).toBe(404);
    const lance = await api('remi', 'POST', `/v1/exercices/${D.exercice}/rapprochements`, {});
    expect(lance.statut).toBe(202);
    executionId = lance.json.id;
    const r = await attendre(dernier, (x) => x.json?.execution?.id === executionId && x.json.execution.statut === 'termine');
    const { rapprochements, ecritures, mouvements, nonRapproches, execution } = r.json;
    expect(execution.obsolete).toBe(false);
    expect(rapprochements.length).toBeGreaterThan(0);

    const coherence = releve.attendu.coherence!;
    const attendusExacts = coherence.appariements.filter((a) => a.nature === 'exact' && a.parReference).length;
    const exacts = rapprochements.filter((x: any) => x.niveau === 'exact').length;
    // Les appariements exacts portés par une référence doivent être retrouvés en quasi-totalité.
    expect(exacts).toBeGreaterThanOrEqual(Math.floor(attendusExacts * 0.9));

    for (const x of rapprochements) {
      expect(x.statut).toBe('propose'); // une proposition n'est jamais une validation
      expect(x.ecart).toBe('0.00'); // tolérance par défaut nulle
      expect(x.explication.length).toBeGreaterThan(10);
      expect(x.criteres.length).toBeGreaterThan(0);
      for (const id of x.cotesEcritures) expect(ecritures[id], 'écriture résolue').toBeTruthy();
      for (const id of x.cotesMouvements) expect(mouvements[id], 'mouvement résolu').toBeTruthy();
      // Vérification arithmétique indépendante du moteur : Σ(débit − crédit) = Σ mouvements, en centimes entiers.
      const centimes = (v: string) => BigInt(v.replace('.', ''));
      const a = x.cotesEcritures.reduce((t: bigint, id: string) => t + centimes(ecritures[id].debit) - centimes(ecritures[id].credit), 0n);
      const b = x.cotesMouvements.reduce((t: bigint, id: string) => t + centimes(mouvements[id].montant), 0n);
      expect(a).toBe(b);
    }
    // Un élément n'appartient qu'à un seul rapprochement.
    const vusM = rapprochements.flatMap((x: any) => x.cotesMouvements);
    const vusE = rapprochements.flatMap((x: any) => x.cotesEcritures);
    expect(new Set(vusM).size).toBe(vusM.length);
    expect(new Set(vusE).size).toBe(vusE.length);
    // Les mouvements bancaires volontairement absents de la comptabilité ne sont dans aucun rapprochement.
    expect(coherence.mouvementsAbsentsDeLaComptabilite.length).toBeGreaterThan(0);
    for (const absent of coherence.mouvementsAbsentsDeLaComptabilite) expect(vusM).not.toContain(rangVersId.get(absent.rang));
    expect(nonRapproches.nbMouvements).toBeGreaterThanOrEqual(coherence.mouvementsAbsentsDeLaComptabilite.length);
    expect(nonRapproches.nbEcritures).toBeGreaterThanOrEqual(coherence.ecrituresAbsentesDuReleve.filter((e) => e.motif === 'omise').length);
    // Bilan cohérent : tout mouvement de l'exercice est soit rapproché, soit non rapproché, soit gelé par une ambiguïté.
    expect(Number(execution.mesures.mouvementsBancaires)).toBe(releve.attendu.nbMouvements);
  });

  it('le contrôle de rapprochement bancaire (TRE-003) est désormais réalisé avec les relevés importés', async () => {
    const lance = await api('remi', 'POST', `/v1/exercices/${D.exercice}/controles`);
    const revue = await attendre(
      () => api('remi', 'GET', `/v1/exercices/${D.exercice}/revue`),
      (x) => x.json?.execution?.id === lance.json.id && x.json.execution.statut === 'termine',
    );
    const tre003 = revue.json.resultats.find((x: any) => x.controleId === 'TRE-003');
    expect(tre003.statut, `motif : ${tre003.motif}`).not.toBe('non_realise');
    expect(['sans_anomalie', 'constat']).toContain(tre003.statut);
    // Aucun exercice antérieur importé pour ce dossier : la cohérence entre exercices reste non réalisée, et le dit.
    const clo002 = revue.json.resultats.find((x: any) => x.controleId === 'CLO-002');
    expect(clo002.statut).toBe('non_realise');
    expect(clo002.motif).toBeTruthy();
  });

  it('seul un réviseur habilité valide ou rejette, avec motif pour un rejet ; rien n’est écrit en comptabilité', async () => {
    const r = (await dernier()).json;
    const [premier, second] = r.rapprochements;
    expect((await api('alice', 'PATCH', `/v1/rapprochements/${premier.id}`, { decision: 'valider' })).statut).toBe(404);
    expect((await api('bruno', 'PATCH', `/v1/rapprochements/${premier.id}`, { decision: 'valider' })).statut).toBe(404);
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${second.id}`, { decision: 'rejeter' })).statut).toBe(400);
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${premier.id}`, { decision: 'valider' })).json.statut).toBe('valide');
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${second.id}`, { decision: 'rejeter', motif: 'Tiers différent' })).json).toMatchObject({ statut: 'rejete', motif: 'Tiers différent' });
    const apres = (await dernier()).json;
    expect(apres.rapprochements.find((x: any) => x.id === premier.id).decidePar).toBeTruthy();
    // Les écritures importées ne sont pas modifiées par une validation (pas de lettrage écrit).
    const lignes = (await api('remi', 'GET', `/v1/exercices/${D.exercice}/imports`)).json;
    expect(lignes.filter((l: any) => l.type === 'fec' && l.actif)).toHaveLength(1);
  });

  it('un nouveau relevé rend le rapprochement obsolète : la validation est bloquée jusqu’à la relance', async () => {
    const autre = genererReleveSynthetique({ graine: graine + 5, format: 'ofx', debut: '2025-03-01', fin: '2025-03-31', nbMouvements: 6, iban: 'FR7630006000011234567890189' });
    const d = await deposer('remi', D.entite, Buffer.from(autre.contenu, 'utf8'), banque(), autre.nomFichier);
    const lot = await attendreLot('remi', d.fin.json.lotImportId);
    expect(lot.json.statut).toMatch(/^termine/);
    expect(lot.json.rapport.nbNouveaux).toBeGreaterThan(0);
    const r = (await dernier()).json;
    expect(r.execution.obsolete).toBe(true);
    const propose = r.rapprochements.find((x: any) => x.statut === 'propose');
    expect((await api('remi', 'PATCH', `/v1/rapprochements/${propose.id}`, { decision: 'valider' })).statut).toBe(409);
    const relance = await api('remi', 'POST', `/v1/exercices/${D.exercice}/rapprochements`, { parametres: { toleranceMontant: '0.05' } });
    const neuf = await attendre(dernier, (x) => x.json?.execution?.id === relance.json.id && x.json.execution.statut === 'termine');
    expect(neuf.json.execution.obsolete).toBe(false);
    expect(neuf.json.execution.parametres).toEqual({ toleranceMontant: '0.05' });
  });

  it('refuse des paramètres invalides et expose les règles appliquées', async () => {
    expect((await api('remi', 'POST', `/v1/exercices/${D.exercice}/rapprochements`, { parametres: { toleranceMontant: 0.05 } })).statut).toBe(400); // un nombre flottant n'est pas un montant
    const ref = await api('remi', 'GET', '/v1/reference/rapprochement');
    expect(ref.json.regles.length).toBeGreaterThanOrEqual(5);
    expect(ref.json.parametresParDefaut.toleranceMontant).toBe('0.00');
  });
});
