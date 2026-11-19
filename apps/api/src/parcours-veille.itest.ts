/** Veille réglementaire par dossier — pile réelle locale. Les évolutions d'essai sont créées et qualifiées par l'éditeur (provisionnement). */
import { randomBytes } from 'node:crypto';
import { urlBd } from '@comtaple/db';
import { DEMO } from '@comtaple/db/amorcer';
import { qualifierEvolution } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ouvrirSessions } from './essais/outils.js';

const SEL = randomBytes(4).toString('hex');
let editeur: pg.Client;
let evMetropole = '';
let evBrute = '';

beforeAll(async () => {
  await ouvrirSessions();
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  const creer = async (ref: string) => (await editeur.query<{ id: string }>(`insert into evolutions_reglementaires (emetteur, reference, url) values ('Légifrance', $1, $2) returning id`, [ref, `https://www.legifrance.gouv.fr/essai/${SEL}`])).rows[0]!.id;
  evMetropole = await creer(`Essai ${SEL} — à qualifier`);
  evBrute = await creer(`Essai ${SEL} — détection non qualifiée`);
  await qualifierEvolution(editeur, evMetropole, {
    reference: `Texte d'essai ${SEL} (fictif)`,
    resume: 'Évolution fictive servant au test : modification d’un seuil pour les sociétés à l’IS en métropole.',
    dateEffet: '2025-01-01',
    conditions: 'Exercices ouverts à compter du 1er janvier 2025.',
    criteres: { territoires: ['metropole'], regimesFiscaux: ['IS'], exercicesOuvertsAPartirDu: '2025-01-01' },
    dateVerification: new Date().toISOString().slice(0, 10),
  });
});
afterAll(async () => {
  await editeur.query('delete from suivis_evolution where evolution_id = any($1)', [[evMetropole, evBrute]]);
  await editeur.query('delete from evolutions_reglementaires where id = any($1)', [[evMetropole, evBrute]]);
  await editeur.end();
});

describe('veille par dossier', () => {
  it('seules les évolutions qualifiées par une personne sont présentées, avec l’explication de leur applicabilité', async () => {
    const dupain = (await api('remi', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).json;
    expect(dupain.find((e: any) => e.id === evBrute)).toBeUndefined(); // détection brute : jamais montrée comme une évolution
    const e = dupain.find((x: any) => x.id === evMetropole);
    expect(e.applicabilite.statut).toBe('concerne');
    expect(e.applicabilite.exercicesConcernes).toEqual([{ debut: '2025-01-01', fin: '2025-12-31' }]);
    expect(e.applicabilite.raisons.join(' ')).toMatch(/Territoire fiscal du dossier \(metropole\) visé/);
    expect(e.resume).toMatch(/fictive/);
    expect(e.suivi).toBeNull();
    // Dossier d'outre-mer : non concerné, avec la raison.
    const bellevue = (await api('remi', 'GET', `/v1/dossiers/${DEMO.bellevue}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(bellevue.applicabilite.statut).toBe('non_concerne');
    expect(bellevue.applicabilite.raisons.join(' ')).toMatch(/martinique/);
  });

  it('une caractéristique manquante donne « applicabilité à confirmer »', async () => {
    const d = await api('alice', 'POST', '/v1/dossiers', { raisonSociale: `Essai veille ${SEL} (fictif)`, territoireFiscal: 'a_confirmer' });
    await api('alice', 'PUT', `/v1/dossiers/${d.json.id}/habilitations/${DEMO.alice}`, { niveau: 'validation' });
    const e = (await api('alice', 'GET', `/v1/dossiers/${d.json.id}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(e.applicabilite.statut).toBe('a_confirmer');
    expect(e.applicabilite.manquants).toEqual(expect.arrayContaining(['Territoire fiscal', 'Régime fiscal', 'Exercices']));
  });

  it('le suivi est propre au dossier et au cabinet ; il ne modifie aucune règle', async () => {
    expect((await api('client', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).statut).toBe(403);
    expect((await api('bruno', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).statut).toBe(404);
    expect((await api('chloe', 'PUT', `/v1/dossiers/${DEMO.dupain}/veille/${evBrute}`, { statut: 'pris_en_compte' })).statut).toBe(404);
    const s = await api('chloe', 'PUT', `/v1/dossiers/${DEMO.dupain}/veille/${evMetropole}`, { statut: 'pris_en_compte', note: 'Vu avec le réviseur' });
    expect(s.json).toMatchObject({ statut: 'pris_en_compte', entiteId: DEMO.dupain });
    expect((await api('remi', 'GET', `/v1/dossiers/${DEMO.dupain}/veille`)).json.find((x: any) => x.id === evMetropole).suivi.statut).toBe('pris_en_compte');
    // Le cabinet Bêta voit la même évolution (référentiel partagé) mais pas le suivi du cabinet Alpha.
    const leroy = (await api('bruno', 'GET', `/v1/dossiers/${DEMO.leroy}/veille`)).json.find((x: any) => x.id === evMetropole);
    expect(leroy.suivi).toBeNull();
    // Le catalogue des contrôles est inchangé par l'existence d'une évolution.
    const tva = (await api('remi', 'GET', '/v1/reference/controles')).json.find((c: any) => c.id === 'IMM-002');
    expect(tva.parametresParDefaut.seuil).toBe('500.00');
  });

  it('l’état des sources est visible, et une source jamais vérifiée n’est pas présentée comme assurée', async () => {
    const r = await api('remi', 'GET', '/v1/veille/sources');
    expect(r.json.sources.length).toBeGreaterThanOrEqual(4);
    expect(r.json.evolutionsDetecteesNonQualifiees).toBeGreaterThanOrEqual(1);
    for (const src of r.json.sources) {
      if (src.dernierSuccesLe === null) expect(src.veilleAssuree).toBe(false);
      expect(src).not.toHaveProperty('empreinteContenu');
    }
    expect((await api('client', 'GET', '/v1/veille/sources')).statut).toBe(403);
    // L'application ne peut pas écrire le référentiel partagé.
    const app = new pg.Client({ connectionString: urlBd('app') });
    await app.connect();
    await expect(app.query(`update evolutions_reglementaires set resume = 'x'`)).rejects.toThrow(/permission|droit/i);
    await app.end();
  });
});
