#!/usr/bin/env node
/**
 * Outil d'exploitation de l'ÉDITEUR (hors application) : grille tarifaire, abonnements, veille réglementaire.
 * S'exécute avec le rôle d'administration de la base (variables PG_ADMIN_* du fichier .env local) : à réserver aux
 * personnes habilitées de l'éditeur. Aucune de ces opérations n'est accessible à un cabinet.
 *
 *   node scripts/editeur.mjs cabinets
 *   node scripts/editeur.mjs abonnement <cabinetId>
 *   node scripts/editeur.mjs essai <cabinetId> <codeOffre>
 *   node scripts/editeur.mjs echeance <cabinetId> <AAAA-MM-01>
 *   node scripts/editeur.mjs virement <echeanceId> [AAAA-MM-JJ]
 *   node scripts/editeur.mjs suspendre <cabinetId> "<motif>"
 *   node scripts/editeur.mjs support-ouvrir <cabinetId> <sujetOidc> <email> "<nom>" <heures (1 à 72)> "<motif>"
 *   node scripts/editeur.mjs support-fermer <cabinetId> <utilisateurId>
 *   node scripts/editeur.mjs journal-ecarts <cabinetId>
 *   node scripts/editeur.mjs journal-anomalie <cabinetId> <premièreLigne> <dernièreLigne> "<cause>"   (irréversible)
 *   node scripts/editeur.mjs notifications-retention [jours avant archivage=30] [jours avant suppression=180] [--appliquer]
 *       SIMULATION sans « --appliquer ». Avec : archive les notifications lues anciennes, SUPPRIME les archivées anciennes (irréversible).
 *   node scripts/editeur.mjs sources
 *   node scripts/editeur.mjs surveiller "<émetteur>" "<libellé>" <url https d'un domaine officiel>
 *   node scripts/editeur.mjs evolutions [a_qualifier|verifiee|ecartee]
 *   node scripts/editeur.mjs qualifier <evolutionId> <fichier.json>   (reference, resume, criteres, dateEffet?, conditions?, passage?, datePublication?)
 *   node scripts/editeur.mjs ecarter <evolutionId>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pg = require('pg');
const { urlBd } = await import('../packages/db/dist/index.js');
const { chargerEnvLocal } = await import('../packages/db/dist/env.js');
const p = await import('../packages/db/dist/provisionnement.js');

chargerEnvLocal();
const [commande, ...args] = process.argv.slice(2);
const aujourdhui = new Date().toISOString().slice(0, 10);
const exiger = (n, usage) => {
  if (args.length < n) {
    console.error(`Usage : node scripts/editeur.mjs ${usage}`);
    process.exit(2);
  }
};
const client = new pg.Client({ connectionString: urlBd('admin') });
await client.connect();
const table = async (sql, params = []) => console.table((await client.query(sql, params)).rows);

try {
  switch (commande) {
    case 'cabinets':
      await table(`select c.id, c.nom, a.offre, a.statut, a.fin_essai::text, (select count(*) from entites e where e.cabinet_id = c.id and e.actif) as dossiers_actifs
                   from cabinets c left join abonnements a on a.cabinet_id = c.id order by c.nom`);
      break;
    case 'abonnement':
      exiger(1, 'abonnement <cabinetId>');
      await table(`select offre, statut, debut::text, fin_essai::text, fin::text, offre_demandee from abonnements where cabinet_id = $1`, [args[0]]);
      await table(`select id, periode_debut::text, offre, dossiers_actifs, total_ht::text, fictif, statut_paiement, reference_virement, paye_le::text from echeances_abonnement where cabinet_id = $1 order by periode_debut`, [args[0]]);
      break;
    case 'essai':
      exiger(2, 'essai <cabinetId> <codeOffre>');
      console.log('Abonnement :', await p.ouvrirEssai(client, args[0], args[1], aujourdhui));
      break;
    case 'echeance': {
      exiger(2, 'echeance <cabinetId> <AAAA-MM-01>');
      const e = await p.genererEcheance(client, args[0], args[1]);
      console.log(e ?? 'Échéance non calculable (voir la grille de l’offre) : rien n’a été créé.');
      break;
    }
    case 'virement':
      exiger(1, 'virement <echeanceId> [AAAA-MM-JJ]');
      await p.enregistrerVirement(client, args[0], args[1] ?? aujourdhui);
      console.log('Virement rapproché (sans effet si l’échéance était déjà payée).');
      break;
    case 'suspendre':
      exiger(2, 'suspendre <cabinetId> "<motif>"');
      await p.suspendre(client, args[0], args[1]);
      console.log('Abonnement suspendu : nouveaux dépôts et imports refusés, consultation conservée.');
      break;
    case 'support-ouvrir':
      exiger(6, 'support-ouvrir <cabinetId> <sujetOidc> <email> "<nom>" <heures> "<motif>"');
      console.log(await p.ouvrirAccesSupport(client, { cabinetId: args[0], sujetOidc: args[1], email: args[2], nom: args[3], heures: Number(args[4]), motif: args[5] }));
      console.log('Accès ouvert en lecture seule, sans aucun dossier : un gestionnaire du cabinet doit habiliter ce compte (lecture) sur les dossiers concernés.');
      break;
    case 'support-fermer':
      exiger(2, 'support-fermer <cabinetId> <utilisateurId>');
      await p.fermerAccesSupport(client, args[0], args[1]);
      console.log('Accès support fermé et habilitations retirées.');
      break;
    case 'journal-ecarts':
      exiger(1, 'journal-ecarts <cabinetId>');
      console.table(await p.ecartsJournal(client, args[0]));
      break;
    case 'journal-anomalie':
      exiger(4, 'journal-anomalie <cabinetId> <premièreLigne> <dernièreLigne> "<cause>"');
      console.log(await p.consignerAnomalieJournal(client, args[0], Number(args[1]), Number(args[2]), args[3]));
      console.log('Anomalie d’enchaînement consignée et inscrite au journal du cabinet. Le contenu de chaque ligne reste vérifié par son empreinte.');
      break;
    case 'notifications-retention': {
      const appliquer = args.includes('--appliquer');
      const [j1, j2] = args.filter((x) => x !== '--appliquer');
      const lignes = await p.retentionNotifications(client, { archiverApresJours: j1 === undefined ? undefined : Number(j1), supprimerApresJours: j2 === undefined ? undefined : Number(j2), appliquer });
      console.table(lignes);
      console.log(appliquer ? 'Rétention APPLIQUÉE : les suppressions ci-dessus sont irréversibles.' : 'SIMULATION : rien n’a été modifié. Ajouter « --appliquer » pour exécuter (la suppression des notifications archivées est irréversible).');
      break;
    }
    case 'sources':
      await table(`select emetteur, libelle, dernier_statut, dernier_succes_le::text, coalesce(dernier_detail, '') as detail from surveillances_sources where actif order by emetteur, libelle`);
      break;
    case 'surveiller':
      exiger(3, 'surveiller "<émetteur>" "<libellé>" <url>');
      console.log('Surveillance :', await p.enregistrerSurveillance(client, { emetteur: args[0], libelle: args[1], url: args[2] }));
      break;
    case 'evolutions': {
      const etat = { a_qualifier: 'detectee_a_qualifier', verifiee: 'verifiee', ecartee: 'ecartee' }[args[0] ?? 'a_qualifier'];
      if (!etat) exiger(99, 'evolutions [a_qualifier|verifiee|ecartee]');
      await table(`select id, emetteur, reference, url, detectee_le::text, date_effet::text from evolutions_reglementaires where etat_verification = $1 order by detectee_le desc limit 100`, [etat]);
      break;
    }
    case 'qualifier': {
      exiger(2, 'qualifier <evolutionId> <fichier.json>');
      const q = JSON.parse(readFileSync(args[1], 'utf8'));
      if (!q.reference || !q.resume || !q.criteres) throw new Error('Le fichier doit contenir au moins : reference, resume, criteres');
      await p.qualifierEvolution(client, args[0], { ...q, dateVerification: aujourdhui });
      console.log('Évolution qualifiée : elle est maintenant visible des cabinets, avec son applicabilité par dossier.');
      break;
    }
    case 'ecarter':
      exiger(1, 'ecarter <evolutionId>');
      await p.ecarterEvolution(client, args[0]);
      console.log('Évolution écartée.');
      break;
    default:
      console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n').replace(/^ ?\*\/?/gm, ''));
      process.exitCode = 2;
  }
} catch (e) {
  console.error(`Échec : ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
