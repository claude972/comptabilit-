#!/usr/bin/env node
/**
 * Outil d'exploitation de l'ÉDITEUR (hors application) : grille tarifaire, abonnements, veille réglementaire.
 * S'exécute avec le rôle d'administration de la base (variables PG_ADMIN_* du fichier .env local) : à réserver aux
 * personnes habilitées de l'éditeur. Aucune de ces opérations n'est accessible à un cabinet.
 *
 *   node scripts/editeur.mjs cabinets
 *   node scripts/editeur.mjs cabinet-creer "<nom du cabinet>" <adresse de l'administrateur> "<nom de l'administrateur>" [jours de validité=14]
 *       Ouvre le cabinet et INVITE son administrateur (aucun courriel envoyé ; le compte se crée dans le fournisseur d'identité).
 *   node scripts/editeur.mjs facturation-export <AAAA-MM-JJ début> <AAAA-MM-JJ fin> [fichier.csv]
 *       Éléments de facturation des échéances de la période, pour l'outil de facturation de l'éditeur (ce n'est pas une facture).
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
 *   node scripts/editeur.mjs fin-de-contrat <cabinetId> [--grace=<jours, 90 par défaut>] [--nom="<nom exact du cabinet>"] [--pv=<fichier.json>] [--appliquer]
 *       SIMULATION sans « --appliquer » : inventaire par catégorie, pré-conditions, plan ordonné ; RIEN n'est modifié.
 *       Avec « --appliquer » ET « --nom » (nom exact) : SUPPRIME les données du cabinet (IRRÉVERSIBLE), en une transaction,
 *       si toutes les pré-conditions sont réunies ; conserve le journal d'audit et la facturation ; écrit le procès-verbal.
 *       Durées PROPOSÉES, non arrêtées (docs/conservation.md). Les sauvegardes ne sont pas purgées.
 *   node scripts/editeur.mjs fin-de-contrat-objets <cabinetId>
 *       SIMULATION uniquement : liste les objets du stockage sous les préfixes du cabinet. La suppression réelle des objets
 *       n'est pas branchée dans cet outil (fonction objetsFinDeContrat, jamais exercée contre un stockage réel).
 *   node scripts/editeur.mjs sources
 *   node scripts/editeur.mjs surveiller "<émetteur>" "<libellé>" <url https d'un domaine officiel>
 *   node scripts/editeur.mjs evolutions [a_qualifier|verifiee|ecartee]
 *   node scripts/editeur.mjs qualifier <evolutionId> <fichier.json>   (reference, resume, criteres, dateEffet?, conditions?, passage?, datePublication?)
 *       criteres : territoires, regimesFiscaux, formesJuridiques, prefixesNaf, referentiels, exercicesOuvertsAPartirDu, exercicesClosAPartirDu,
 *                  taille { chiffreAffairesMin/Max, totalBilanMin/Max (chaînes décimales), effectifMin/Max }, operations [immobilisations, emprunts,
 *                  stocks, salaries, credit_bail, subventions, comptes_courants_associes, tva_collectee]
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
    case 'cabinet-creer': {
      exiger(3, 'cabinet-creer "<nom>" <adresse administrateur> "<nom administrateur>" [jours]');
      const r = await p.creerCabinet(client, { nom: args[0], emailAdministrateur: args[1], nomAdministrateur: args[2], validiteJours: args[3] ? Number(args[3]) : undefined });
      console.log(`Cabinet ouvert : ${r.cabinetId}`);
      console.log(`Invitation de l'administrateur : ${r.invitationId}, valable jusqu'au ${r.expireLe}.`);
      console.log('Aucun courriel envoyé. Créer le compte dans le fournisseur d’identité (adresse vérifiée), puis ouvrir un essai : editeur.mjs essai <cabinetId> <codeOffre>.');
      break;
    }
    case 'facturation-export': {
      exiger(2, 'facturation-export <AAAA-MM-JJ début> <AAAA-MM-JJ fin> [fichier.csv]');
      const r = await p.exporterElementsFacturation(client, args[0], args[1]);
      if (args[2]) {
        (await import('node:fs')).writeFileSync(args[2], r.csv, { mode: 0o600 });
        console.log(`${r.lignes} échéance(s) exportée(s) dans ${args[2]}. Ce fichier n'est pas une facture.`);
      } else process.stdout.write(r.csv);
      break;
    }
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
    case 'fin-de-contrat': {
      exiger(1, 'fin-de-contrat <cabinetId> [--grace=<jours>] [--nom="<nom exact>"] [--pv=<fichier.json>] [--appliquer]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const appliquer = args.includes('--appliquer');
      const nom = option('nom');
      const afficher = (plan) => {
        console.log(`Cabinet : ${plan.inventaire.cabinet.nom} (${plan.inventaire.cabinet.id}) — politique ${plan.inventaire.politique.version} (${plan.inventaire.politique.statut})`);
        console.table(plan.inventaire.categories.map((c) => ({ catégorie: c.code, devenir: c.devenir, lignes: c.lignes, 'durée proposée (non arrêtée)': c.conservation?.duree ?? '' })));
        if (plan.inventaire.tablesSansCategorie.length) console.log(`TABLES SANS CATÉGORIE : ${plan.inventaire.tablesSansCategorie.join(', ')}`);
        console.table(plan.preconditions.map((x) => ({ 'pré-condition': x.libelle, satisfaite: x.satisfaite ? 'oui' : 'NON', détail: x.detail })));
        console.table(plan.etapes.map((e) => ({ rang: e.rang, opération: e.operation, table: e.table ?? '', lignes: e.lignes, détail: e.detail })));
        const o = plan.inventaire.objets;
        console.log(`Objets du stockage (étape séparée) : ${o.referencesEnBase} clé(s) référencée(s) en base, ${o.volumeOctetsConnu} octets connus, préfixes ${o.prefixes.join(' et ')}${o.clesHorsPrefixes ? ` — ${o.clesHorsPrefixes} clé(s) référencée(s) HORS de ces préfixes, jamais supprimées par la procédure` : ''}.`);
        console.log(`Hors tables : ${plan.inventaire.horsTables.utilisateursSansAutreCabinet.nombre} compte(s) sans autre cabinet, non traités. ${plan.inventaire.horsTables.fournisseurIdentite}`);
        console.log(plan.sauvegardes);
      };
      try {
        const r = await p.finDeContrat(client, { cabinetId: args[0], delaiGraceJours: option('grace') === undefined ? undefined : Number(option('grace')), confirmation: nom === undefined ? undefined : { cabinetId: args[0], nom }, appliquer });
        afficher(r.plan);
        if (r.simulation) console.log(`SIMULATION : rien n’a été modifié. ${r.plan.executable ? 'Toutes les pré-conditions sont réunies.' : 'Exécution IMPOSSIBLE en l’état (voir les pré-conditions).'} Pour exécuter : --nom="<nom exact>" --appliquer (IRRÉVERSIBLE).`);
        else {
          const fichier = option('pv') ?? `proces-verbal-fin-de-contrat-${args[0]}.json`;
          (await import('node:fs')).writeFileSync(fichier, `${p.jsonCanonique(r.procesVerbal)}\n`, { mode: 0o600 });
          console.log(`Fin de contrat EXÉCUTÉE (irréversible). Procès-verbal : ${fichier}, empreinte ${r.procesVerbal.empreinte} (également au registre fins_de_contrat).`);
          console.log('Restent à faire, hors de cet outil : la suppression des objets du stockage, la désactivation des comptes du fournisseur d’identité. Les sauvegardes ne sont pas purgées.');
        }
      } catch (e) {
        if (e.name !== 'RefusFinDeContrat') throw e;
        afficher(e.plan);
        throw e;
      }
      break;
    }
    case 'fin-de-contrat-objets': {
      exiger(1, 'fin-de-contrat-objets <cabinetId>');
      if (args.includes('--appliquer')) throw new Error('La suppression réelle des objets n’est pas branchée dans cet outil : elle n’a jamais été exercée contre un stockage réel.');
      const { Stockage } = await import('../packages/plateforme/dist/stockage.js');
      const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
      const r = await p.objetsFinDeContrat(client, new Stockage({ S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY }), { cabinetId: args[0] });
      console.log(`SIMULATION : ${r.cles.length} objet(s) sous ${r.prefixes.join(' et ')} (empreinte de la liste : ${r.empreinteListeCles}). Rien n’a été supprimé.`);
      for (const k of r.cles.slice(0, 20)) console.log(`  ${k}`);
      if (r.cles.length > 20) console.log(`  … et ${r.cles.length - 20} autre(s)`);
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
