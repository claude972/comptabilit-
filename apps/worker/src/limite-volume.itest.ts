/**
 * Limite de volume des traitements qui chargent des lignes d'écriture en mémoire — PostgreSQL réel.
 * L'import comptable et les exécutions sont créés par ce test puis retirés à la fin (ils n'appartiennent qu'à lui). La limite est abaissée dans le contexte du test, pas dans la configuration.
 */
import { CATALOGUE_CONTROLES } from '@comtaple/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { connexionRedis, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executerRapprochement } from './banque.js';
import type { Contexte } from './contexte.js';
import { executerControlesExecution } from './controles.js';

chargerEnvLocal();
const cfg = lireConfig();
let admin: pg.Client;
let c: Contexte;
let lot: { id: string; cabinet_id: string; entite_id: string; exercice_id: string; n: number };
const creees: string[] = [];
const rapprochements: string[] = [];

async function nouvelleExecution(): Promise<string> {
  const id = (await admin.query(`insert into executions_controles (cabinet_id, entite_id, exercice_id, lot_import_id, version_donnees) values ($1, $2, $3, $4, 0) returning id`, [lot.cabinet_id, lot.entite_id, lot.exercice_id, lot.id])).rows[0].id;
  creees.push(id);
  return id;
}
const resultats = async (execution: string) => (await admin.query('select controle_id, statut, motif from resultats_controles where execution_id = $1 order by controle_id', [execution])).rows;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  c = { cfg, bd: creerAccesBd(urlBd('worker')), stockage: new Stockage(cfg), taches: new Files(connexionRedis(cfg.REDIS_URL), `essai-volume-${Date.now()}`) };
  // Un import comptable PROPRE À CE TEST (aucune dépendance aux données déjà présentes : la base de la CI n'a que le
  // jeu d'amorçage). Il est rattaché à un exercice existant mais INACTIF et « en attente » : l'application ne le
  // présente nulle part, il ne déclenche aucune notification, et il est retiré à la fin.
  const exercice = (await admin.query('select id, cabinet_id, entite_id, debut from exercices order by cree_le limit 1')).rows[0];
  expect(exercice, 'le jeu d’amorçage doit fournir au moins un exercice').toBeTruthy();
  const N = 300;
  const id = (
    await admin.query(`insert into lots_import (cabinet_id, entite_id, exercice_id, type, cle_idempotence, actif, statut, progression) values ($1, $2, $3, 'fec', $4, false, 'en_attente', $5) returning id`, [
      exercice.cabinet_id,
      exercice.entite_id,
      exercice.id,
      `essai-volume-${Date.now()}-${process.pid}`,
      N,
    ])
  ).rows[0].id;
  // 150 écritures équilibrées de deux lignes (achat : 606 au débit, 401 au crédit).
  await admin.query(
    `insert into lignes_ecriture (cabinet_id, entite_id, exercice_id, lot_import_id, numero_ligne, journal_code, journal_lib, ecriture_num, ecriture_date, compte_num, compte_lib, piece_ref, ecriture_lib, debit, credit)
     select $1, $2, $3, $4, g, 'AC', 'Achats', 'AC' || ((g + 1) / 2), $5::date + ((g + 1) / 2), case when g % 2 = 1 then '606000' else '401000' end,
            case when g % 2 = 1 then 'Achats non stockés' else 'Fournisseurs' end, 'P' || ((g + 1) / 2), 'Achat d’essai ' || ((g + 1) / 2),
            case when g % 2 = 1 then 100 + (g + 1) / 2 else 0 end, case when g % 2 = 1 then 0 else 100 + (g + 1) / 2 end
       from generate_series(1, $6::int) g`,
    [exercice.cabinet_id, exercice.entite_id, exercice.id, id, exercice.debut, N],
  );
  lot = { id, cabinet_id: exercice.cabinet_id, entite_id: exercice.entite_id, exercice_id: exercice.id, n: N };
});
afterAll(async () => {
  if (creees.length) {
    await admin.query('delete from constats where execution_id = any($1)', [creees]);
    await admin.query('delete from resultats_controles where execution_id = any($1)', [creees]);
    await admin.query('delete from executions_controles where id = any($1)', [creees]);
  }
  if (rapprochements.length) await admin.query('delete from executions_rapprochement where id = any($1)', [rapprochements]);
  if (lot) {
    await admin.query('delete from lignes_ecriture where lot_import_id = $1', [lot.id]);
    await admin.query('delete from lots_import where id = $1', [lot.id]);
  }
  await c.taches.fermer();
  await c.bd.fermer();
  await admin.end();
});

describe('limite de volume par traitement', () => {
  it('au-delà de la limite, aucun contrôle n’est réalisé : chacun le dit avec son motif, sans constat ni plantage', async () => {
    const execution = await nouvelleExecution();
    await executerControlesExecution({ ...c, cfg: { ...cfg, LIGNES_MAX_PAR_TRAITEMENT: lot.n - 1 } }, { cabinetId: lot.cabinet_id, executionId: execution });
    const r = await resultats(execution);
    expect(r).toHaveLength(CATALOGUE_CONTROLES.length);
    expect(r.every((x) => x.statut === 'non_realise')).toBe(true);
    expect(r.every((x) => /Volume non pris en charge/.test(x.motif) && /ce n’est pas une absence d’anomalie/.test(x.motif))).toBe(true);
    expect(r[0].motif).toContain(lot.n.toLocaleString('fr-FR'));
    expect((await admin.query('select count(*)::int as n from constats where execution_id = $1', [execution])).rows[0].n).toBe(0);
    expect((await admin.query('select statut from executions_controles where id = $1', [execution])).rows[0].statut).toBe('termine');
  });

  it('exactement à la limite, et avec la limite par défaut, les contrôles sont réalisés', async () => {
    for (const limite of [lot.n, cfg.LIGNES_MAX_PAR_TRAITEMENT]) {
      const execution = await nouvelleExecution();
      await executerControlesExecution({ ...c, cfg: { ...cfg, LIGNES_MAX_PAR_TRAITEMENT: limite } }, { cabinetId: lot.cabinet_id, executionId: execution });
      const r = await resultats(execution);
      expect(r).toHaveLength(CATALOGUE_CONTROLES.length);
      expect(r.some((x) => x.statut === 'sans_anomalie' || x.statut === 'constat'), `limite ${limite}`).toBe(true);
      expect(r.some((x) => /Volume non pris en charge/.test(x.motif ?? ''))).toBe(false);
    }
    expect(cfg.LIGNES_MAX_PAR_TRAITEMENT).toBe(500_000);
  });

  it('rapprochement au-delà de la limite : échec propre, avec son motif, sans proposition', async () => {
    const id = (await admin.query(`insert into executions_rapprochement (cabinet_id, entite_id, exercice_id, lot_import_id, version_donnees) values ($1, $2, $3, $4, 0) returning id`, [lot.cabinet_id, lot.entite_id, lot.exercice_id, lot.id])).rows[0].id;
    rapprochements.push(id);
    await executerRapprochement({ ...c, cfg: { ...cfg, LIGNES_MAX_PAR_TRAITEMENT: lot.n - 1 } }, { cabinetId: lot.cabinet_id, executionId: id });
    const e = (await admin.query('select statut, erreur from executions_rapprochement where id = $1', [id])).rows[0];
    expect(e.statut).toBe('echec');
    expect(e.erreur).toMatch(/Volume non pris en charge.*Aucun rapprochement n’a été calculé/);
    expect((await admin.query('select count(*)::int as n from rapprochements where execution_id = $1', [id])).rows[0].n).toBe(0);
  });
});
