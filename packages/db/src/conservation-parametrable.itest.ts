/**
 * Durées de conservation paramétrables, simulations, comptes et fiches (D-099) — base NEUVE et ISOLÉE.
 *
 * Chaque exécution crée sa propre base, y rejoue toutes les migrations, puis la supprime. Rien n'est lu ni écrit dans la
 * base « comtaple ». Les seules exécutions réelles (`appliquer: true`) visent des cabinets d'essai créés ici.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amorcer } from './amorcer.js';
import { appliquerFichesOrphelinesEssai, exigerBaseEssai, planComptesFinDeContrat, planFichesOrphelines } from './comptes-fin-de-contrat.js';
import { PARAMETRES_PROPOSES, type ParametresDurees, chargerParametres } from './durees-conservation.js';
import { chargerEnvLocal } from './env.js';
import { urlBd } from './index.js';
import { migrer } from './migrer.js';
import { type Cabinet, creerPeuplement } from './peuplement-essai.js';
import { OFFRES_DEMO, POLITIQUE_FIN_DE_CONTRAT, RefusFinDeContrat, definirOffre, finDeContrat } from './provisionnement.js';
import { simulerConservationCabinet, simulerFinDeVieJournal } from './simulation-conservation.js';

chargerEnvLocal();
const BASE = `comtaple_essai_conservation_${Date.now()}`;
const env = { ...process.env, PG_DATABASE: BASE };
const REF = 'AVIS-ESSAI-0002';
const politique = POLITIQUE_FIN_DE_CONTRAT.categories;
let admin: pg.Client;
let P: ReturnType<typeof creerPeuplement>;
let dossier: string;

const strict = async (cabinet: string) => (await admin.query<{ r: string | null }>('select journal_audit_verifier($1)::text as r', [cabinet])).rows[0]!.r;
/** Empreinte de TOUTES les lignes de TOUTES les tables : prouve qu'une simulation ne change rien. */
async function empreinteBase(): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const t of [...new Set(P.colonnes.map((c) => c.t))].sort()) r[t] = (await admin.query<{ e: string }>(`select count(*)::text || ':' || coalesce(md5(string_agg(h, '' order by h)), '') as e from (select md5(x::text) as h from "${t}" x) s`)).rows[0]!.e;
  return r;
}
const dateRelative = async (jours: number) => (await admin.query<{ d: string }>('select (current_date + $1::int)::text as d', [jours])).rows[0]!.d;
function ecrireJeu(nom: string, modifie: (p: ParametresDurees) => void): string {
  const p = JSON.parse(JSON.stringify(PARAMETRES_PROPOSES)) as ParametresDurees;
  p.version = `essai-${nom}`;
  modifie(p);
  const chemin = join(dossier, `${nom}.json`);
  writeFileSync(chemin, JSON.stringify(p));
  return chemin;
}

beforeAll(async () => {
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`create database ${BASE}`);
  await racine.end();
  await migrer(env);
  await amorcer(env);
  admin = new pg.Client({ connectionString: urlBd('admin', env) });
  await admin.connect();
  for (const o of OFFRES_DEMO) await definirOffre(admin, o);
  P = creerPeuplement(admin);
  await P.lireCatalogue();
  dossier = mkdtempSync(join(tmpdir(), 'comtaple-conservation-'));
}, 180_000);

afterAll(async () => {
  await admin?.end();
  rmSync(dossier, { recursive: true, force: true });
  const racine = new pg.Client({ connectionString: urlBd('admin', { ...process.env, PG_DATABASE: 'postgres' }) });
  await racine.connect();
  await racine.query(`drop database if exists ${BASE} with (force)`);
  await racine.end();
});

describe('base d’essai', () => {
  it('s’exécute sur une base neuve, jamais sur la base locale', async () => {
    const b = (await admin.query<{ b: string }>('select current_database() as b')).rows[0]!.b;
    expect(b).toBe(BASE);
    expect(b).not.toBe('comtaple');
  });
});

describe('simulation par cabinet, table par table', () => {
  let c: Cabinet;
  it('liste TOUTES les tables du cabinet avec devenir, décompte, action et échéance ; ne modifie rien', async () => {
    c = await P.pret('Simulation');
    const avant = await empreinteBase();
    const s = await simulerConservationCabinet(admin, c.id, chargerParametres(politique));
    expect(await empreinteBase()).toEqual(avant);
    expect(s.parametres).toMatchObject({ statut: 'PROPOSITION NON VALIDÉE', nonValide: true, source: 'defaut' });
    expect(s.avertissements.join(' ')).toMatch(/PROPOSITION NON VALIDÉE/);
    expect(s.lignes.map((l) => l.table).sort()).toEqual(P.tablesCabinet);
    const fin = await dateRelative(-200);
    const exec = await dateRelative(-110); // fin de l'abonnement (il y a 200 jours) + 90 jours de grâce
    expect(s.delaiExecutionJours).toBe(90);
    expect(s.executionAuPlusTot).toBe(exec);
    for (const l of s.lignes) {
      const cat = politique.find((x) => x.code === l.categorie)!;
      expect(l.devenir).toBe(cat.devenir);
      expect(l.action.length).toBeGreaterThan(10);
      if (cat.devenir === 'supprimer' || cat.devenir === 'restituer_puis_supprimer') {
        expect(l.action).toMatch(/SUPPRIMER/);
        expect(l.premiereEcheance).toBe(exec);
        expect(l.etat).toBe('echue');
      }
    }
    // Conservées : échéance = point de départ + durée ; point de départ « fin de contrat » → fin de l'abonnement.
    const ligne = (t: string) => s.lignes.find((l) => l.table === t)!;
    expect(ligne('restitutions_cabinet')).toMatchObject({ devenir: 'conserver_jusqu_a', pointDeDepart: 'fin de contrat', premiereEcheance: (await admin.query<{ d: string }>(`select ($1::date + 1826)::text as d`, [fin])).rows[0]!.d, etat: 'a_echoir' });
    expect(ligne('restitutions_cabinet').action).toMatch(/CONSERVER jusqu’à l’échéance, puis SUPPRIMER/);
    expect(ligne('journal_audit').action).toMatch(/SCELLER/);
    expect(ligne('journal_audit').premiereEcheance).not.toBeNull();
    // Traces d'IA : anonymisées à l'exécution, puis supprimées 183 jours après chaque événement (une heure dans le passé ici).
    expect(ligne('evenements_ia').action).toMatch(/ANONYMISER à l’exécution/);
    expect(ligne('evenements_ia').etat).toBe('a_echoir');
    // Facturation : clôture d'exercice approchée (31 décembre) + 3652 jours.
    expect(ligne('abonnements').pointDeDepart).toMatch(/clôture de l’exercice de l’éditeur/);
    expect(ligne('abonnements').derniereEcheance).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('un jeu de paramètres différent change les échéances et le délai effectif ; un abonnement non résilié les rend non calculables', async () => {
    const fichier = ecrireJeu('long', (p) => {
      p.delaiGraceJours = 60;
      p.categories.banque!.duree = { jours: 400 };
      p.categories.restitutions_cabinet!.duree = { jusqu_au: '2040-12-31' };
      p.statut = 'VALIDÉE';
      p.validation = { reference: 'AVIS-ESSAI-LONG', date: '2026-11-20', par: 'essai' };
    });
    const s = await simulerConservationCabinet(admin, c.id, chargerParametres(politique, fichier));
    expect(s.parametres).toMatchObject({ nonValide: false, source: 'fichier', statut: 'VALIDÉE' });
    expect(s.avertissements).toEqual([]);
    expect(s.delaiExecutionJours).toBe(400);
    expect(s.executionAuPlusTot).toBe(await dateRelative(-200 + 400));
    expect(s.lignes.find((l) => l.table === 'mouvements_bancaires')).toMatchObject({ etat: 'a_echoir' });
    expect(s.lignes.find((l) => l.table === 'restitutions_cabinet')).toMatchObject({ premiereEcheance: '2040-12-31' });

    const vierge = await P.peupler('Abonnement actif');
    await admin.query(`update abonnements set statut = 'actif', fin = null where cabinet_id = $1`, [vierge.id]);
    const n = await simulerConservationCabinet(admin, vierge.id, chargerParametres(politique));
    expect(n.executionAuPlusTot).toBeNull();
    expect(n.avertissements.join(' ')).toMatch(/non résilié/);
    expect(n.lignes.filter((l) => l.lignes > 0).every((l) => l.etat === 'non_calculable' || l.premiereEcheance !== null)).toBe(true);
    expect(n.lignes.find((l) => l.table === 'mouvements_bancaires')!.premiereEcheance).toBeNull();
    // La simulation est refusée à un rôle applicatif (réservée à l'administration).
    await expect(simulerConservationCabinet(admin, randomUUID(), chargerParametres(politique))).rejects.toThrow(/introuvable/);
  });
});

describe('exécution réelle : durées déclarées validées, référence consignée', () => {
  const sans = async (c: Cabinet) => (await admin.query<{ n: string }>('select count(*) as n from fins_de_contrat where cabinet_id = $1', [c.id])).rows[0]!.n;

  it('sans --durees-validees (ou avec une référence vide), l’exécution est REFUSÉE et rien n’est modifié', async () => {
    const c = await P.pret('Refus durées');
    const avant = await empreinteBase();
    for (const ref of [undefined, '', 'oui', 'ok']) {
      const e = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, dureesValidees: ref }).catch((x: unknown) => x);
      expect(e, String(ref)).toBeInstanceOf(RefusFinDeContrat);
      expect((e as RefusFinDeContrat).plan.preconditions.filter((x) => !x.satisfaite).map((x) => x.code)).toEqual(['durees_validees']);
      expect((e as RefusFinDeContrat).motifs.join(' ')).toMatch(/PROPOSITION NON VALIDÉE|référence de validation exploitable|déclarées validées/);
    }
    expect(await empreinteBase()).toEqual(avant);
    expect(await sans(c)).toBe('0');
    // Simulation : elle dit que les durées ne sont pas déclarées validées, donc que le plan n'est pas exécutable.
    const sim = (await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom } })).plan;
    expect(sim.executable).toBe(false);
    expect(sim.parametres).toMatchObject({ statut: 'PROPOSITION NON VALIDÉE', source: 'defaut' });
  });

  it('avec une référence : exécutée ; référence, version, statut et empreinte du jeu sont au procès-verbal ET au journal', async () => {
    const c = await P.pret('Exécution déclarée');
    const r = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, dureesValidees: REF });
    expect(r.simulation).toBe(false);
    const pv = (r as Extract<typeof r, { simulation: false }>).procesVerbal;
    const defaut = chargerParametres(politique);
    expect(pv.dureesConservation).toEqual({ reference: REF, version: defaut.parametres.version, statut: 'PROPOSITION NON VALIDÉE', empreinte: defaut.empreinte, source: 'defaut' });
    const ligne = (await admin.query<{ details: { dureesConservation: { reference: string; empreinte: string } } }>(`select details from journal_audit where cabinet_id = $1 and action = 'fin_de_contrat.executee'`, [c.id])).rows[0]!;
    expect(ligne.details.dureesConservation).toMatchObject({ reference: REF, empreinte: defaut.empreinte });
    expect(await strict(c.id)).toBeNull();
  });

  it('un jeu validé porte sa référence : une autre est refusée, la sienne acceptée', async () => {
    const fichier = ecrireJeu('valide', (p) => {
      p.statut = 'VALIDÉE';
      p.validation = { reference: 'AVIS-DPO-ESSAI-7', date: '2026-11-20', par: 'essai' };
    });
    const chargees = chargerParametres(politique, fichier);
    const c = await P.pret('Jeu validé');
    const e = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, parametres: chargees, dureesValidees: 'AVIS-AUTRE-9999' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RefusFinDeContrat);
    expect((e as RefusFinDeContrat).motifs.join(' ')).toMatch(/diffère de celle inscrite/);
    expect(await sans(c)).toBe('0');
    const r = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, parametres: chargees, dureesValidees: 'AVIS-DPO-ESSAI-7' });
    expect((r as Extract<typeof r, { simulation: false }>).procesVerbal.dureesConservation).toMatchObject({ reference: 'AVIS-DPO-ESSAI-7', statut: 'VALIDÉE', source: 'fichier' });
  });

  it('le délai de grâce et les durées des catégories supprimées sont lus des paramètres', async () => {
    const c = await P.pret('Délais paramétrés');
    await admin.query(`update abonnements set fin = current_date - 100 where cabinet_id = $1`, [c.id]);
    const demande = (parametres?: ReturnType<typeof chargerParametres>) => finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, dureesValidees: REF, parametres });
    expect((await demande()).plan.executable).toBe(true); // 90 jours : échu
    expect((await demande(chargerParametres(politique, ecrireJeu('grace120', (p) => { p.delaiGraceJours = 120; })))).plan.preconditions.find((x) => x.code === 'abonnement_resilie')).toMatchObject({ satisfaite: false });
    const longue = await demande(chargerParametres(politique, ecrireJeu('banque200', (p) => { p.categories.banque!.duree = { jours: 200 }; })));
    expect(longue.plan.delaiGraceJours).toBe(200);
    expect(longue.plan.executable).toBe(false);
  });
});

describe('écriture concurrente pendant la transaction', () => {
  it('une ligne ajoutée au journal du cabinet par une AUTRE session pendant l’exécution fait tout annuler (rien n’est perdu, rien n’est à moitié fait)', async () => {
    const c = await P.pret('Concurrence journal');
    const avant = await empreinteBase();
    const autre = new pg.Client({ connectionString: urlBd('admin', env) });
    await autre.connect();
    let injectee = false;
    try {
      const e = await finDeContrat(admin, {
        cabinetId: c.id,
        confirmation: { cabinetId: c.id, nom: c.nom },
        appliquer: true,
        dureesValidees: REF,
        // Première étape : la session concurrente écrit au journal du même cabinet (la transaction n'a pas verrouillé le journal).
        surEtape: async () => {
          if (injectee) return;
          injectee = true;
          await autre.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'essai.concurrent', 'cabinet', 'x')`, [c.id]);
        },
      }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/journal_audit compte \d+ ligne\(s\) après exécution, \d+ attendue\(s\). Tout est annulé/);
    } finally {
      await autre.end();
    }
    // Seule la ligne de la session concurrente subsiste : tout le reste est comme avant.
    const apres = await empreinteBase();
    const differences = Object.keys(avant).filter((t) => avant[t] !== apres[t]);
    expect(differences).toEqual(['journal_audit']);
    expect((await admin.query('select 1 from fins_de_contrat where cabinet_id = $1', [c.id])).rowCount).toBe(0);
    expect(await strict(c.id)).toBeNull();
    // Une nouvelle tentative est refusée tant que la restitution ne couvre pas cette écriture (action du journal qui modifie des données)…
    await expect(finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, dureesValidees: REF })).rejects.toThrow(/données modifiées après la demande de restitution.*essai\.concurrent/);
    // … et aboutit après une nouvelle restitution.
    await P.restituer(c);
    const r = await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, dureesValidees: REF });
    expect(r.simulation).toBe(false);
  });
});

describe('fin de vie du journal : simulation seulement', () => {
  it('chiffre les échéances, repère les données personnelles du journal et les fiches désignées ; ne modifie AUCUNE ligne', async () => {
    const c = await P.pret('Journal fin de vie');
    await admin.query(`insert into journal_audit (cabinet_id, acteur_id, acteur_type, action, cible_type, cible_id, details) values ($1, $2, 'utilisateur', 'invitation.creee', 'invitation', 'x', $3)`, [c.id, c.utilisateur, JSON.stringify({ email: 'personne@exemple.test' })]);
    await admin.query(`insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id) values ($1, 'systeme', 'document.consulte', 'document', 'y')`, [c.id]);
    const lignesAvant = (await admin.query('select id, empreinte, empreinte_precedente, details::text as d, horodatage::text as h from journal_audit where cabinet_id = $1 order by id', [c.id])).rows;
    const base = await empreinteBase();
    const s = await simulerFinDeVieJournal(admin, c.id, chargerParametres(politique));
    expect(await empreinteBase()).toEqual(base);
    expect((await admin.query('select id, empreinte, empreinte_precedente, details::text as d, horodatage::text as h from journal_audit where cabinet_id = $1 order by id', [c.id])).rows).toEqual(lignesAvant);
    expect(await strict(c.id)).toBeNull();
    expect(s.journal.lignes).toBe(lignesAvant.length);
    expect(s.journal.echeancesPassees).toBe(0); // 3652 jours : rien n'est échu
    expect(s.regle).toMatchObject({ apresEcheance: 'sceller' });
    expect(s.etat).toMatchObject({ verificationStricte: null, derniereLigne: String(lignesAvant.at(-1)!.id) });
    expect(s.donneesPersonnellesDansLeJournal.lignesAvecCourriel).toBeGreaterThanOrEqual(1);
    expect(s.donneesPersonnellesDansLeJournal.actions.map((a) => a.action)).toContain('invitation.creee');
    expect(s.avertissements.join(' ')).toMatch(/adresse de courriel/);
    expect(s.acteurs.fichesExistantes).toBeGreaterThanOrEqual(1);
    expect(s.familles.length).toBeGreaterThan(1);
    expect(s.plan.join(' ')).toMatch(/jamais automatique/);
    expect(s.ancre).toMatch(/hors de portée/);
    // Une durée courte rend des lignes échues dans la simulation, toujours sans rien toucher.
    const courte = ecrireJeu('journal-court', (p) => { p.categories.journal_audit!.duree = { jours: 1 }; });
    const t = await simulerFinDeVieJournal(admin, c.id, chargerParametres(politique, courte), { aujourdhui: await dateRelative(5) });
    expect(t.journal.echeancesPassees).toBe(lignesAvant.length);
    expect(await strict(c.id)).toBeNull();
  });
});

describe('comptes et fiches orphelines après la fin de contrat', () => {
  it('liste les comptes sans autre appartenance, épargne les autres, planifie les dates ; exécute les fiches sur base d’essai seulement', async () => {
    const c = await P.pret('Comptes');
    const autre = await P.pret('Autre cabinet');
    const nouveau = async (nom: string) => (await admin.query<{ id: string; sujet_oidc: string }>('insert into utilisateurs (sujet_oidc, email, nom) values ($1, $2, $3) returning id, sujet_oidc', [`essai-${randomUUID()}`, `${nom}-${randomUUID().slice(0, 6)}@exemple.test`, nom])).rows[0]!;
    const membre = async (cab: string, u: string, support = false) => admin.query(`insert into appartenances (cabinet_id, utilisateur_id, role, expire_le) values ($1, $2, 'collaborateur', $3)`, [cab, u, support ? new Date(Date.now() + 86_400_000) : null]);
    const seul = await nouveau('Seul');
    const partage = await nouveau('Partage');
    const support = await nouveau('Support');
    await membre(c.id, seul.id);
    await membre(c.id, partage.id);
    await membre(autre.id, partage.id);
    await membre(c.id, support.id, true);

    const avant = await empreinteBase();
    const chargees = chargerParametres(politique);
    const plan = await planComptesFinDeContrat(admin, c.id, chargees);
    expect(await empreinteBase()).toEqual(avant);
    expect(plan.comptesConserves.map((x) => x.utilisateurId)).toEqual([partage.id]);
    const ids = plan.comptes.map((x) => x.utilisateurId);
    expect(ids).toEqual(expect.arrayContaining([c.utilisateur, seul.id, support.id]));
    expect(ids).not.toContain(partage.id);
    expect(plan.comptes.find((x) => x.utilisateurId === support.id)!.support).toBe(true);
    // Le demandeur de la restitution reste référencé par le registre conservé : sa fiche sera pseudonymisée ; celle de « Seul » supprimée.
    expect(plan.comptes.find((x) => x.utilisateurId === c.utilisateur)).toMatchObject({ devenirFiche: 'pseudonymiser' });
    expect(plan.comptes.find((x) => x.utilisateurId === c.utilisateur)!.referencesRestantes).toBeGreaterThan(0);
    expect(plan.comptes.find((x) => x.utilisateurId === seul.id)).toMatchObject({ devenirFiche: 'supprimer', referencesRestantes: 0 });
    const desactiver = await dateRelative(-200 + 90);
    expect(plan.comptes[0]).toMatchObject({ desactiverLe: desactiver });
    expect(plan.comptes[0]!.supprimerLe).toBe((await admin.query<{ d: string }>(`select ($1::date + 30)::text as d`, [desactiver])).rows[0]!.d);
    expect(plan.avertissements.join(' ')).toMatch(/PROPOSITION NON VALIDÉE/);

    // Avant la fin de contrat, les fiches ont des appartenances : aucune fiche orpheline à ce stade pour ce cabinet.
    expect((await planFichesOrphelines(admin)).fiches.map((f) => f.utilisateurId)).not.toContain(seul.id);
    // Fin de contrat réelle (base d'essai), puis fiches.
    await finDeContrat(admin, { cabinetId: c.id, confirmation: { cabinetId: c.id, nom: c.nom }, appliquer: true, dureesValidees: REF });
    const orphelines = await planFichesOrphelines(admin);
    const par = new Map(orphelines.fiches.map((f) => [f.utilisateurId, f]));
    expect([...par.keys()]).toEqual(expect.arrayContaining([c.utilisateur, seul.id, support.id]));
    expect(par.has(partage.id)).toBe(false); // toujours membre de l'autre cabinet
    expect(par.get(seul.id)).toMatchObject({ devenir: 'supprimer', dejaPseudonymisee: false });
    expect(par.get(c.utilisateur)).toMatchObject({ devenir: 'pseudonymiser' });

    // Simulation de l'exécution : rien ne change ; refus hors base d'essai.
    const apresFin = await empreinteBase();
    expect(await appliquerFichesOrphelinesEssai(admin, { appliquer: false, env: process.env })).toMatchObject({ traitees: [] });
    expect(await empreinteBase()).toEqual(apresFin);
    await expect(appliquerFichesOrphelinesEssai(admin, { appliquer: true, env: { ...env, PG_DATABASE: BASE } })).rejects.toThrow(/n’est pas une base d’essai isolée/);
    const faux = { query: async () => ({ rows: [{ b: 'comtaple' }] }) } as unknown as pg.Client;
    await expect(exigerBaseEssai(faux, env)).rejects.toThrow(/n’est pas une base d’essai isolée/);
    const autreNom = { query: async () => ({ rows: [{ b: 'ma_base_de_dev' }] }) } as unknown as pg.Client;
    await expect(exigerBaseEssai(autreNom, env)).rejects.toThrow(/n’est pas une base d’essai isolée/);

    // Exécution réelle sur la base d'essai (la base configurée est « comtaple », celle-ci est jetable).
    const r = await appliquerFichesOrphelinesEssai(admin, { appliquer: true, env: process.env });
    const action = (id: string) => r.traitees.find((x) => x.utilisateurId === id)?.action;
    expect(action(seul.id)).toBe('supprimee');
    expect(action(support.id)).toBe('supprimee');
    expect(action(c.utilisateur)).toBe('pseudonymisee');
    expect(action(partage.id)).toBeUndefined();
    expect((await admin.query('select 1 from utilisateurs where id = $1', [seul.id])).rowCount).toBe(0);
    expect((await admin.query('select 1 from utilisateurs where id = $1', [partage.id])).rowCount).toBe(1);
    const pseudo = (await admin.query<{ sujet_oidc: string; email: string; nom: string }>('select sujet_oidc, email, nom from utilisateurs where id = $1', [c.utilisateur])).rows[0]!;
    expect(pseudo).toMatchObject({ sujet_oidc: `supprime:${c.utilisateur}`, nom: 'Compte supprimé' });
    expect(pseudo.email).toMatch(/@invalide\.test$/);
    // Le registre conservé référence toujours la fiche (l'identifiant demeure, la personne n'y figure plus).
    expect((await admin.query('select 1 from restitutions_cabinet where cabinet_id = $1 and demande_par = $2', [c.id, c.utilisateur])).rowCount).toBeGreaterThan(0);
    // Idempotence : rejouée, elle ne supprime plus rien et ne refait pas la pseudonymisation.
    const encore = await appliquerFichesOrphelinesEssai(admin, { appliquer: true, env: process.env });
    expect(encore).toMatchObject({ supprimees: 0, pseudonymisees: 0 });
    expect(encore.dejaPseudonymisees).toBeGreaterThanOrEqual(1);
    expect(await strict(c.id)).toBeNull();
  });
});
