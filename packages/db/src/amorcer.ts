/**
 * Jeu de données de DÉMONSTRATION entièrement fictif (cabinets, dossiers, utilisateurs de test du royaume Keycloak local).
 * Idempotent. Exécuté avec le rôle d'administration (provisionnement), jamais par l'application.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { chargerEnvLocal } from './env.js';
import { urlBd } from './index.js';
import { definirOffre, OFFRES_DEMO, ouvrirEssai } from './provisionnement.js';
import * as s from './schema.js';

export const DEMO = {
  cabinetA: 'aaaaaaaa-0000-4000-8000-000000000001',
  cabinetB: 'bbbbbbbb-0000-4000-8000-000000000001',
  // Les identifiants des utilisateurs sont ceux du royaume Keycloak de développement (claim « sub »).
  alice: '11111111-1111-4111-8111-111111111101',
  remi: '11111111-1111-4111-8111-111111111102',
  chloe: '11111111-1111-4111-8111-111111111103',
  client: '11111111-1111-4111-8111-111111111104',
  bruno: '22222222-2222-4222-8222-222222222201',
  dupain: 'aaaaaaaa-0000-4000-8000-0000000000e1',
  martin: 'aaaaaaaa-0000-4000-8000-0000000000e2',
  leroy: 'bbbbbbbb-0000-4000-8000-0000000000e1',
  bellevue: 'aaaaaaaa-0000-4000-8000-0000000000e3',
  exDupain2025: 'aaaaaaaa-0000-4000-8000-0000000000f1',
  exMartin2025: 'aaaaaaaa-0000-4000-8000-0000000000f2',
  exLeroy2025: 'bbbbbbbb-0000-4000-8000-0000000000f1',
  exBellevue2025: 'aaaaaaaa-0000-4000-8000-0000000000f3',
} as const;

export async function amorcer(): Promise<void> {
  const client = new pg.Client({ connectionString: urlBd('admin') });
  await client.connect();
  const db = drizzle(client);
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(s.cabinets)
        .values([
          { id: DEMO.cabinetA, nom: 'Cabinet Alpha Expertise (fictif)' },
          { id: DEMO.cabinetB, nom: 'Cabinet Bêta Conseil (fictif)' },
        ])
        .onConflictDoNothing();
      const u = (id: string, email: string, nom: string) => ({ id, sujetOidc: id, email, nom });
      await tx
        .insert(s.utilisateurs)
        .values([
          u(DEMO.alice, 'alice.admin@cabinet-a.test', 'Alice Admin'),
          u(DEMO.remi, 'remi.reviseur@cabinet-a.test', 'Rémi Réviseur'),
          u(DEMO.chloe, 'chloe.collab@cabinet-a.test', 'Chloé Collab'),
          u(DEMO.client, 'client.depot@client-a.test', 'Camille Client'),
          u(DEMO.bruno, 'bruno.admin@cabinet-b.test', 'Bruno Admin'),
        ])
        .onConflictDoNothing();
      await tx
        .insert(s.appartenances)
        .values([
          { cabinetId: DEMO.cabinetA, utilisateurId: DEMO.alice, role: 'administrateur' },
          { cabinetId: DEMO.cabinetA, utilisateurId: DEMO.remi, role: 'reviseur' },
          { cabinetId: DEMO.cabinetA, utilisateurId: DEMO.chloe, role: 'collaborateur' },
          { cabinetId: DEMO.cabinetA, utilisateurId: DEMO.client, role: 'client_deposant' },
          { cabinetId: DEMO.cabinetB, utilisateurId: DEMO.bruno, role: 'administrateur' },
        ])
        .onConflictDoNothing();
      const e = (id: string, cabinetId: string, raisonSociale: string, formeJuridique: string) => ({
        id,
        cabinetId,
        raisonSociale,
        formeJuridique,
        regimeFiscal: 'IS',
        territoireFiscal: 'metropole' as const,
      });
      await tx
        .insert(s.entites)
        .values([
          e(DEMO.dupain, DEMO.cabinetA, 'Boulangerie Dupain SAS (fictive)', 'SAS'),
          e(DEMO.martin, DEMO.cabinetA, 'Garage Martin SARL (fictif)', 'SARL'),
          e(DEMO.leroy, DEMO.cabinetB, 'Menuiserie Leroy SAS (fictive)', 'SAS'),
          // Dossier d'outre-mer : sert à vérifier qu'aucune règle fiscale métropolitaine n'y est appliquée en silence.
          { ...e(DEMO.bellevue, DEMO.cabinetA, 'Distillerie Bellevue SAS (fictive)', 'SAS'), territoireFiscal: 'martinique' as const },
        ])
        .onConflictDoNothing();
      const x = (id: string, cabinetId: string, entiteId: string) => ({ id, cabinetId, entiteId, debut: '2025-01-01', fin: '2025-12-31' });
      await tx
        .insert(s.exercices)
        .values([
          x(DEMO.exDupain2025, DEMO.cabinetA, DEMO.dupain),
          x(DEMO.exMartin2025, DEMO.cabinetA, DEMO.martin),
          x(DEMO.exLeroy2025, DEMO.cabinetB, DEMO.leroy),
          x(DEMO.exBellevue2025, DEMO.cabinetA, DEMO.bellevue),
        ])
        .onConflictDoNothing();
      // Alice est administratrice mais n'est PAS habilitée sur le dossier Martin : le rôle ne suffit pas.
      const h = (cabinetId: string, entiteId: string, utilisateurId: string, niveau: (typeof s.niveauHabilitation.enumValues)[number]) => ({
        cabinetId,
        entiteId,
        utilisateurId,
        niveau,
      });
      await tx
        .insert(s.habilitationsDossier)
        .values([
          h(DEMO.cabinetA, DEMO.dupain, DEMO.alice, 'validation'),
          h(DEMO.cabinetA, DEMO.dupain, DEMO.remi, 'revision'),
          h(DEMO.cabinetA, DEMO.martin, DEMO.remi, 'revision'),
          h(DEMO.cabinetA, DEMO.dupain, DEMO.chloe, 'collaboration'),
          h(DEMO.cabinetA, DEMO.dupain, DEMO.client, 'depot'),
          h(DEMO.cabinetB, DEMO.leroy, DEMO.bruno, 'validation'),
          h(DEMO.cabinetA, DEMO.bellevue, DEMO.remi, 'revision'),
        ])
        .onConflictDoNothing();
    });
    // Grille tarifaire FICTIVE et période d'essai des cabinets de démonstration (prolongée à chaque amorçage, sans
    // toucher à un abonnement qui aurait évolué : seuls les cabinets sans abonnement ou encore en essai sont concernés).
    for (const offre of OFFRES_DEMO) await definirOffre(client, offre);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    for (const cabinet of [DEMO.cabinetA, DEMO.cabinetB]) {
      const existant = await client.query<{ statut: string }>('select statut from abonnements where cabinet_id = $1', [cabinet]);
      if (!existant.rowCount || existant.rows[0]!.statut === 'essai') await ouvrirEssai(client, cabinet, 'demo-essentiel', aujourdhui);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  chargerEnvLocal();
  amorcer().then(
    () => console.log('Données de démonstration (fictives) en place.'),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
