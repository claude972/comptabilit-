/**
 * Règle de volume des traitements sur les lignes d'écriture — PostgreSQL réel.
 * Jusqu'au seuil, chemin en mémoire ; au-delà, chemin en flux (curseur PostgreSQL) : mêmes résultats, et « non réalisé »
 * motivé pour ce qui ne tient pas dans le budget d'état.
 * Autonome : le test crée son propre cabinet d'essai (invisible des autres cabinets), son dossier, deux exercices, leurs
 * écritures (générateur synthétique du moteur) et un relevé bancaire, puis retire tout à la fin. Le seuil est abaissé
 * dans le contexte du test, pas dans la configuration ; les fonctions du worker sont appelées directement.
 */
import {
  analyserFec, CATALOGUE_CONTROLES, enBlocs, genererFecSynthetique, genererReleveSynthetique, type LigneEcriture, type LigneFec, lireCamt053, type OrdrePassage, type RapportReleve,
} from '@comtaple/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { connexionRedis, Files, lignesDuLot, lireConfig, Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executerRapprochement } from './banque.js';
import type { Contexte } from './contexte.js';
import { executerControlesExecution } from './controles.js';
import { preparerSourceDuLot, sourceDuLot } from './source-lignes.js';

chargerEnvLocal();
const cfg = lireConfig();
const MARQUE = `essai-volume-${Date.now()}-${process.pid}`;
const ANOMALIES = [
  'desequilibre', 'rupture_sequence', 'hors_exercice', 'doublon', 'caisse_crediteur', 'attente_non_solde', 'client_crediteur', 'cca_debiteur',
  'amortissement_superieur_brut', 'charge_immobilisable', 'salaires_sans_charges', 'piece_hors_exercice',
] as const;

let admin: pg.Client;
let c: Contexte;
let cabinetId: string;
let entiteId: string;
/** Exercice contrôlé (N), exercice précédent (N-1) et petit lot dont les numéros de ligne ne sont pas distincts. */
let lotN: { id: string; exerciceId: string; n: number };
let lotDoublons: { id: string; n: number };

async function lignesSynthetiques(debut: string, fin: string, graine: number, nbEcritures: number, anomalies: readonly (typeof ANOMALIES)[number][] = []): Promise<LigneFec[]> {
  const fec = genererFecSynthetique({ exercice: { debut, fin }, nbEcritures, graine, anomalies: [...anomalies] });
  const lignes: LigneFec[] = [];
  await analyserFec(enBlocs(fec.contenu, 65_536), { nomFichier: fec.nomFichier, siren: '123456782', exerciceDebut: debut, exerciceFin: fin, surLigne: (l) => void lignes.push(l) });
  return lignes;
}

async function creerLot(exerciceId: string, lignes: readonly LigneFec[], actif: boolean, suffixe: string): Promise<{ id: string; exerciceId: string; n: number }> {
  const id = (
    await admin.query(`insert into lots_import (cabinet_id, entite_id, exercice_id, type, cle_idempotence, actif, statut, progression) values ($1, $2, $3, 'fec', $4, $5, 'termine', $6) returning id`, [
      cabinetId, entiteId, exerciceId, `${MARQUE}-${suffixe}`, actif, lignes.length,
    ])
  ).rows[0].id as string;
  for (let i = 0; i < lignes.length; i += 2000) {
    await admin.query(
      `insert into lignes_ecriture (cabinet_id, entite_id, exercice_id, lot_import_id, numero_ligne, journal_code, journal_lib, ecriture_num, ecriture_date, compte_num, compte_lib, comp_aux_num, comp_aux_lib,
                                    piece_ref, piece_date, ecriture_lib, debit, credit, ecriture_let, date_let, valid_date, montant_devise, idevise)
       select $1, $2, $3, $4, x."numeroLigne", x."journalCode", x."journalLib", x."ecritureNum", x."ecritureDate", x."compteNum", x."compteLib", x."compAuxNum", x."compAuxLib",
              x."pieceRef", x."pieceDate", x."ecritureLib", x.debit, x.credit, x."ecritureLet", x."dateLet", x."validDate", x."montantDevise", x.idevise
         from jsonb_to_recordset($5::jsonb) as x("numeroLigne" int, "journalCode" text, "journalLib" text, "ecritureNum" text, "ecritureDate" date, "compteNum" text, "compteLib" text, "compAuxNum" text,
              "compAuxLib" text, "pieceRef" text, "pieceDate" date, "ecritureLib" text, debit numeric, credit numeric, "ecritureLet" text, "dateLet" date, "validDate" date, "montantDevise" numeric, idevise text)`,
      [cabinetId, entiteId, exerciceId, id, JSON.stringify(lignes.slice(i, i + 2000))],
    );
  }
  return { id, exerciceId, n: lignes.length };
}

/** Relevé rendu par le moteur, enregistré comme le fait l'import d'un relevé (lot actif, relevé, mouvements, liens). */
async function enregistrerReleve(rapport: RapportReleve): Promise<void> {
  const lot = (await admin.query(`insert into lots_import (cabinet_id, entite_id, type, cle_idempotence, actif, statut) values ($1, $2, 'releve_bancaire', $3, true, 'termine') returning id`, [cabinetId, entiteId, `${MARQUE}-releve`])).rows[0].id;
  for (const compte of rapport.comptes) {
    await admin.query(
      `insert into releves_bancaires (cabinet_id, entite_id, lot_import_id, format, iban, identifiant, devise, solde_ouverture, date_ouverture, solde_cloture, date_cloture, total_mouvements, nb_mouvements, cadrage, ecart, brut)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [cabinetId, entiteId, lot, rapport.format, compte.iban, compte.identifiant, compte.devise, compte.soldeOuverture, compte.dateOuverture, compte.soldeCloture, compte.dateCloture, compte.totalMouvements, compte.nbMouvements, compte.cadrage, compte.ecart, JSON.stringify(compte)],
    );
  }
  for (const m of rapport.mouvements) {
    const id = (
      await admin.query(
        `insert into mouvements_bancaires (cabinet_id, entite_id, lot_import_id, rang, cle_idempotence, iban, identifiant_compte, devise, date_operation, date_valeur, montant, libelle, reference_banque, reference_bout_en_bout, brut)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [cabinetId, entiteId, lot, m.rang, m.cleIdempotence, m.compte.iban, m.compte.identifiant, m.compte.devise, m.dateOperation, m.dateValeur, m.montant, m.libelle, m.referenceBanque, m.referenceBoutEnBout, JSON.stringify(m)],
      )
    ).rows[0].id;
    await admin.query('insert into mouvements_lots (cabinet_id, entite_id, mouvement_id, lot_import_id) values ($1, $2, $3, $4)', [cabinetId, entiteId, id, lot]);
  }
}

async function nouvelleExecution(lot: { id: string; exerciceId: string } = lotN): Promise<string> {
  return (await admin.query(`insert into executions_controles (cabinet_id, entite_id, exercice_id, lot_import_id, version_donnees) values ($1, $2, $3, $4, 0) returning id`, [cabinetId, entiteId, lot.exerciceId, lot.id])).rows[0].id;
}
type Resultat = { controle_id: string; version_controle: string; statut: string; motif: string | null; parametres: unknown; mesures: unknown };
const resultats = async (execution: string): Promise<Resultat[]> =>
  (await admin.query('select controle_id, version_controle, statut, motif, parametres, mesures from resultats_controles where execution_id = $1 order by controle_id', [execution])).rows;
const constats = async (execution: string) =>
  (await admin.query('select controle_id, cle, gravite, titre, explication, action_proposee, montant, lignes_concernees, preuves, statut_revue, a_revoir from constats where execution_id = $1 order by controle_id, cle', [execution])).rows;
const statutExecution = async (execution: string) => (await admin.query('select statut from executions_controles where id = $1', [execution])).rows[0].statut;
/** Contexte du worker avec un seuil du chemin en mémoire (et, au besoin, un budget d'état) propres à l'essai. */
const avec = (seuil: number, budget = cfg.LIGNES_MAX_ETAT_FLUX): Contexte => ({ ...c, cfg: { ...cfg, LIGNES_MAX_PAR_TRAITEMENT: seuil, LIGNES_MAX_ETAT_FLUX: budget } });
const executer = async (contexte: Contexte, lot: { id: string; exerciceId: string } = lotN): Promise<string> => {
  const execution = await nouvelleExecution(lot);
  await executerControlesExecution(contexte, { cabinetId, executionId: execution });
  return execution;
};
const cheminJournalise = async (execution: string) =>
  (await admin.query(`select details->>'chemin' as chemin, (details->>'lignes')::int as lignes from journal_audit where cabinet_id = $1 and action = 'controles.termines' and cible_id = $2`, [cabinetId, execution])).rows;

/** Exécution de référence : chemin en mémoire, seuil par défaut. */
let reference: { execution: string; resultats: Resultat[]; constats: unknown[] };

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  c = { cfg, bd: creerAccesBd(urlBd('worker')), stockage: new Stockage(cfg), taches: new Files(connexionRedis(cfg.REDIS_URL), MARQUE.slice(0, 40)) };
  cabinetId = (await admin.query('insert into cabinets (nom) values ($1) returning id', [`Cabinet d’essai ${MARQUE}`])).rows[0].id;
  entiteId = (await admin.query(`insert into entites (cabinet_id, raison_sociale, territoire_fiscal) values ($1, $2, 'metropole') returning id`, [cabinetId, `Dossier d’essai ${MARQUE}`])).rows[0].id;
  const exercice = async (debut: string, fin: string): Promise<string> => (await admin.query('insert into exercices (cabinet_id, entite_id, debut, fin) values ($1, $2, $3, $4) returning id', [cabinetId, entiteId, debut, fin])).rows[0].id;
  const [exN1, exN] = [await exercice('2024-01-01', '2024-12-31'), await exercice('2025-01-01', '2025-12-31')];

  await creerLot(exN1, await lignesSynthetiques('2024-01-01', '2024-12-31', 11, 150), true, 'n1');
  // Exercice contrôlé : toutes les anomalies connues du générateur ; relevé bancaire tiré des lignes de banque (avec suspens).
  const lignes = await lignesSynthetiques('2025-01-01', '2025-12-31', 7, 400, ANOMALIES);
  const releve = lireCamt053(genererReleveSynthetique({ graine: 7, format: 'camt.053', debut: '2025-01-01', fin: '2025-12-31', nbMouvements: 10_000, coherentAvec: lignes }).contenu);
  expect(releve.comptes[0]?.cadrage).toBe('ok');
  // Les lignes sont DISPERSÉES dans le fichier (numéros de ligne permutés) : une écriture n'y est plus contiguë, ce que
  // seul un vrai regroupement par la base peut rattraper.
  const n = lignes.length;
  const pas = [7919, 7907, 7901].find((p) => n % p !== 0)!;
  lotN = await creerLot(exN, lignes.map((l, i) => ({ ...l, numeroLigne: ((i * pas) % n) + 1 })), true, 'n');
  await enregistrerReleve(releve);
  lotDoublons = await creerLot(exN, lignes.slice(0, 40).map((l, i) => ({ ...l, numeroLigne: Math.floor(i / 2) + 1 })), false, 'doublons');

  const execution = await executer(c);
  reference = { execution, resultats: await resultats(execution), constats: await constats(execution) };
}, 120_000);

afterAll(async () => {
  if (cabinetId) {
    // Uniquement les lignes de CE cabinet d'essai, créé par ce test.
    for (const table of ['rapprochements', 'executions_rapprochement', 'constats', 'resultats_controles', 'executions_controles', 'mouvements_lots', 'mouvements_bancaires', 'releves_bancaires', 'lignes_ecriture', 'lots_import', 'exercices', 'entites']) {
      await admin.query(`delete from ${table} where cabinet_id = $1`, [cabinetId]);
    }
    await admin.query('delete from cabinets where id = $1', [cabinetId]);
  }
  await c.taches.fermer();
  await c.bd.fermer();
  await admin.end();
});

describe('source de lignes en flux (curseur PostgreSQL)', () => {
  it('ordre du fichier : exactement les lignes de `lignesDuLot`, quelle que soit la taille de page', async () => {
    await c.bd.avecContexte({ cabinetId }, async (tx) => {
      const attendu = await lignesDuLot(tx, lotN.id);
      expect(attendu).toHaveLength(lotN.n);
      for (const taillePage of [7, 5000]) {
        const lues: LigneEcriture[] = [];
        for await (const l of sourceDuLot(tx, lotN.id, lotN.n, { taillePage }).parcourir({ ordre: 'fichier' })) lues.push(l);
        expect(lues).toStrictEqual(attendu);
      }
      expect(await preparerSourceDuLot(tx, lotN.id)).toMatchObject({ ordreDetermine: true, source: { nbLignes: lotN.n } });
      expect((await preparerSourceDuLot(tx, lotDoublons.id)).ordreDetermine).toBe(false);
    });
  });

  it('ordres groupés : toutes les lignes, chaque groupe d’un seul tenant et dans l’ordre du fichier ; restrictions respectées', async () => {
    const cles: Record<Exclude<OrdrePassage, 'fichier'>, (l: LigneEcriture) => string> = {
      ecriture: (l) => `${l.journalCode}\u0001${l.ecritureNum}`,
      tiers: (l) => `${l.compteNum}\u0001${l.compAuxNum ?? l.compteNum}`,
      compte: (l) => l.compteNum,
    };
    await c.bd.avecContexte({ cabinetId }, async (tx) => {
      const toutes = await lignesDuLot(tx, lotN.id);
      const source = sourceDuLot(tx, lotN.id, lotN.n, { taillePage: 113 });
      for (const ordre of ['ecriture', 'tiers', 'compte'] as const) {
        const lues: LigneEcriture[] = [];
        for await (const l of source.parcourir({ ordre })) lues.push(l);
        expect([...lues].sort((a, b) => a.numeroLigne - b.numeroLigne), ordre).toStrictEqual(toutes);
        const vus = new Set<string>();
        let courante: string | null = null;
        let rang = 0;
        for (const l of lues) {
          const k = cles[ordre](l);
          if (k !== courante) {
            expect(vus.has(k), `${ordre} : groupe en plusieurs morceaux`).toBe(false);
            vus.add(k);
            courante = k;
            rang = 0;
          }
          expect(l.numeroLigne, `${ordre} : ordre du fichier dans le groupe`).toBeGreaterThan(rang);
          rang = l.numeroLigne;
        }
        expect(vus.size).toBeGreaterThan(5);
      }
      const restreintes: LigneEcriture[] = [];
      for await (const l of source.parcourir({ ordre: 'compte', prefixesComptes: ['512', '6'] })) restreintes.push(l);
      expect(restreintes.map((l) => l.id).sort()).toEqual(toutes.filter((l) => l.compteNum.startsWith('512') || l.compteNum.startsWith('6')).map((l) => l.id).sort());
      const journal: LigneEcriture[] = [];
      for await (const l of source.parcourir({ ordre: 'fichier', journaux: ['BQ', 'AN'] })) journal.push(l);
      expect(journal).toStrictEqual(toutes.filter((l) => l.journalCode === 'BQ' || l.journalCode === 'AN'));
      // Deux passages ouverts en même temps, et un passage abandonné avant la fin : le curseur est fermé, la transaction reste saine.
      let n = 0;
      for await (const a of source.parcourir({ ordre: 'fichier' })) {
        for await (const b of source.parcourir({ ordre: 'ecriture', prefixesComptes: ['512'] })) {
          expect(b.compteNum.startsWith('512')).toBe(true);
          break;
        }
        if (++n >= 300 || a.numeroLigne < 0) break;
      }
      expect(await lignesDuLot(tx, lotN.id)).toHaveLength(lotN.n);
    });
  });
});

describe('règle de volume des contrôles', () => {
  it('référence (chemin en mémoire) : les 19 contrôles, des constats, la reprise des à-nouveaux et le rapprochement bancaire réalisés', async () => {
    expect(reference.resultats).toHaveLength(CATALOGUE_CONTROLES.length);
    const statuts = Object.fromEntries(reference.resultats.map((r) => [r.controle_id, r.statut]));
    expect(Object.values(statuts).filter((s) => s === 'constat').length).toBeGreaterThanOrEqual(10);
    expect(statuts['CLO-002']).toBe('constat');
    expect(statuts['TRE-003']).toBe('constat');
    expect(Object.values(statuts)).not.toContain('erreur');
    expect(reference.constats.length).toBeGreaterThan(20);
    expect(await cheminJournalise(reference.execution)).toEqual([{ chemin: 'memoire', lignes: lotN.n }]);
    expect(cfg.LIGNES_MAX_PAR_TRAITEMENT).toBe(500_000);
    expect(cfg.LIGNES_MAX_ETAT_FLUX).toBe(100_000);
  });

  it('au-delà du seuil : contrôles réalisés en flux, mêmes résultats et mêmes constats qu’en mémoire', async () => {
    const execution = await executer(avec(lotN.n - 1));
    expect(await statutExecution(execution)).toBe('termine');
    expect(await cheminJournalise(execution)).toEqual([{ chemin: 'flux', lignes: lotN.n }]);
    expect(await resultats(execution)).toStrictEqual(reference.resultats);
    expect(await constats(execution)).toStrictEqual(reference.constats);
  });

  it('exactement au seuil : chemin en mémoire ; l’exercice précédent, qui ferait dépasser le seuil, est lu en flux pour la reprise des à-nouveaux', async () => {
    const execution = await executer(avec(lotN.n));
    expect(await cheminJournalise(execution)).toEqual([{ chemin: 'memoire', lignes: lotN.n }]);
    expect(await resultats(execution)).toStrictEqual(reference.resultats);
    expect(await constats(execution)).toStrictEqual(reference.constats);
  });

  it('budget d’état insuffisant : les contrôles concernés sont « non réalisés », nommés et motivés ; les autres sont inchangés ; aucun résultat partiel', async () => {
    const execution = await executer(avec(lotN.n - 1, 5));
    expect(await statutExecution(execution)).toBe('termine');
    const r = await resultats(execution);
    expect(r).toHaveLength(CATALOGUE_CONTROLES.length);
    const empeches = r.filter((x, i) => JSON.stringify(x) !== JSON.stringify(reference.resultats[i]));
    expect(empeches.map((x) => x.controle_id)).toEqual(['GEN-002', 'GEN-004', 'TRE-003']);
    for (const x of empeches) {
      expect(x.statut).toBe('non_realise');
      expect(x.motif).toContain(`Contrôle ${x.controle_id} non réalisé sur ce volume (${lotN.n.toLocaleString('fr-FR')} lignes d’écriture, traitement en flux)`);
      expect(x.motif).toMatch(/Aucun résultat partiel n’est rendu ; ce n’est pas une absence d’anomalie\./);
      expect(x.mesures).toEqual({});
    }
    const c2 = (await constats(execution)) as Array<{ controle_id: string }>;
    expect(c2.some((k) => ['GEN-002', 'GEN-004', 'TRE-003'].includes(k.controle_id))).toBe(false);
    expect(c2).toStrictEqual((reference.constats as Array<{ controle_id: string }>).filter((k) => !['GEN-002', 'GEN-004', 'TRE-003'].includes(k.controle_id)));
  });

  it('numéros de ligne non distincts au-delà du seuil : aucun contrôle réalisé, chacun le dit ; sous le seuil, chemin en mémoire inchangé', async () => {
    const lot = { id: lotDoublons.id, exerciceId: lotN.exerciceId };
    const execution = await executer(avec(lotDoublons.n - 1), lot);
    const r = await resultats(execution);
    expect(r).toHaveLength(CATALOGUE_CONTROLES.length);
    expect(r.every((x) => x.statut === 'non_realise' && /Volume non pris en charge.*numéros de ligne du lot ne sont pas distincts.*ce n’est pas une absence d’anomalie/.test(x.motif ?? ''))).toBe(true);
    expect(await constats(execution)).toEqual([]);
    expect(await statutExecution(execution)).toBe('termine');
    const enMemoire = await resultats(await executer(c, lot));
    expect(enMemoire.some((x) => x.statut === 'sans_anomalie' || x.statut === 'constat')).toBe(true);
    expect(enMemoire.some((x) => /Volume non pris en charge/.test(x.motif ?? ''))).toBe(false);
  });

  it('reprise après arrêt : une exécution en flux interrompue reste « en attente », sans résultat ; relancée, elle rend le résultat complet', async () => {
    const execution = await nouvelleExecution();
    // Arrêt simulé : le traitement va au bout mais sa transaction n'est jamais validée (ce que laisse un worker tué).
    const interrompu: Contexte = {
      ...avec(lotN.n - 1),
      bd: {
        ...c.bd,
        avecContexte: (ctx, fn) =>
          c.bd.avecContexte(ctx, async (tx) => {
            await fn(tx);
            throw new Error('arrêt simulé');
          }),
      },
    };
    await expect(executerControlesExecution(interrompu, { cabinetId, executionId: execution })).rejects.toThrow('arrêt simulé');
    expect(await statutExecution(execution)).toBe('en_attente');
    expect(await resultats(execution)).toEqual([]);
    expect(await constats(execution)).toEqual([]);
    await executerControlesExecution(avec(lotN.n - 1), { cabinetId, executionId: execution });
    expect(await statutExecution(execution)).toBe('termine');
    expect(await resultats(execution)).toStrictEqual(reference.resultats);
    expect(await constats(execution)).toStrictEqual(reference.constats);
    // Une tâche rejouée sur une exécution terminée ne refait rien.
    await executerControlesExecution(avec(lotN.n - 1), { cabinetId, executionId: execution });
    expect(await cheminJournalise(execution)).toHaveLength(1);
  });
});

describe('règle de volume du rapprochement bancaire', () => {
  const lancer = async (contexte: Contexte) => {
    const id = (await admin.query(`insert into executions_rapprochement (cabinet_id, entite_id, exercice_id, lot_import_id, version_donnees) values ($1, $2, $3, $4, 0) returning id`, [cabinetId, entiteId, lotN.exerciceId, lotN.id])).rows[0].id;
    await executerRapprochement(contexte, { cabinetId, executionId: id });
    const e = (await admin.query('select statut, erreur, mesures, non_rapproches_ecritures, non_rapproches_mouvements, ambiguites, abandons from executions_rapprochement where id = $1', [id])).rows[0];
    const r = (await admin.query('select niveau, regle, cotes_ecritures, cotes_mouvements, criteres, explication, ecart from rapprochements where execution_id = $1 order by explication, cotes_ecritures::text', [id])).rows;
    return { e, r };
  };

  it('au-delà du seuil : seules les lignes utiles sont lues en flux, même proposition qu’en mémoire', async () => {
    const enMemoire = await lancer(c);
    expect(enMemoire.e.statut).toBe('termine');
    expect(enMemoire.r.length).toBeGreaterThan(10);
    const enFlux = await lancer(avec(lotN.n - 1));
    expect(enFlux.e).toStrictEqual(enMemoire.e);
    expect(enFlux.r).toStrictEqual(enMemoire.r);
  });

  it('au-delà du seuil et du budget d’état : échec propre, avec son motif, sans proposition', async () => {
    const { e, r } = await lancer(avec(lotN.n - 1, 5));
    expect(e.statut).toBe('echec');
    expect(e.erreur).toMatch(/Volume non pris en charge.*traitement en flux impossible : plus de 5 lignes à garder pour le rapprochement des comptes de banque\. Aucun rapprochement n’a été calculé\./);
    expect(r).toEqual([]);
  });
});
