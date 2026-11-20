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
 *   node scripts/editeur.mjs fin-de-contrat <cabinetId> [--grace=<jours>] [--durees=<fichier.json>] [--durees-validees=<référence>] [--nom="<nom exact du cabinet>"] [--pv=<fichier.json>] [--appliquer]
 *       SIMULATION sans « --appliquer » : inventaire par catégorie, pré-conditions, plan ordonné ; RIEN n'est modifié.
 *       Avec « --appliquer », « --nom » (nom exact) ET « --durees-validees=<référence de la validation des durées> » : SUPPRIME les
 *       données du cabinet (IRRÉVERSIBLE), en une transaction, si toutes les pré-conditions sont réunies ; conserve le journal
 *       d'audit et la facturation ; écrit le procès-verbal. Les durées viennent du fichier « --durees » ou, à défaut, de la
 *       PROPOSITION NON VALIDÉE du code : sans « --durees-validees », l'exécution réelle est REFUSÉE ; la référence, la version
 *       et l'empreinte du jeu de durées sont inscrites au journal du cabinet et au procès-verbal. Les sauvegardes ne sont pas purgées.
 *   node scripts/editeur.mjs durees-defauts
 *       Affiche (JSON) la PROPOSITION NON VALIDÉE de durées de conservation : modèle à copier, adapter et faire valider.
 *   node scripts/editeur.mjs durees-verifier <fichier.json>
 *       Valide un jeu de durées contre la politique de fin de contrat (structure, catégories, bornes) ; affiche son empreinte.
 *       Ne dit rien de la validité JURIDIQUE des durées.
 *   node scripts/editeur.mjs conservation-simuler <cabinetId> [--durees=<fichier.json>] [--grace=<jours>]
 *       SIMULATION (lecture seule) : pour le cabinet, table par table, ce qui serait supprimé, anonymisé ou conservé, et à quelle échéance.
 *   node scripts/editeur.mjs journal-fin-de-vie <cabinetId> [--durees=<fichier.json>]
 *       SIMULATION (lecture seule) de la fin de vie du journal du cabinet : échéances, données personnelles présentes dans les lignes,
 *       fiches désignées, plan de scellement. Le journal n'est jamais réécrit ni purgé.
 *   node scripts/editeur.mjs comptes-fin-de-contrat <cabinetId> [--durees=<fichier.json>] [--plan=<fichier.json>]
 *       SIMULATION (lecture seule), À LANCER AVANT l'exécution de la fin de contrat : comptes qui ne devraient plus exister (aucune autre
 *       appartenance), avec dates de désactivation et de suppression, devenir de la fiche. « --plan » enregistre le plan.
 *       L'exécution contre un fournisseur d'identité n'existe que pour un royaume d'ESSAI créé par un test.
 *   node scripts/editeur.mjs fiches-orphelines
 *       SIMULATION (lecture seule) : fiches « utilisateurs » sans aucune appartenance et ce qu'on en ferait. Aucune exécution ici.
 *   node scripts/editeur.mjs fin-de-contrat-objets <cabinetId> [--nom="<nom exact>"] [--durees-validees=<référence>] [--rapport=<fichier.jsonl>] [--appliquer]
 *       SIMULATION sans « --appliquer » : liste les objets du stockage sous les préfixes du cabinet. Avec « --appliquer » : refusé sauf
 *       sur un stockage d'ESSAI versionné, déclaré par STOCKAGE_ESSAI_BUCKET_DECLARE (comtaple-essai-…, distinct de S3_BUCKET) ;
 *       jamais sur le bucket des données. Aucun code ne supprime d'objet dans le bucket des données.
 *   node scripts/editeur.mjs secrets-rechiffrer [--cabinet=<cabinetId>] [--limite=<nombre de lignes>] [--appliquer]
 *       Rotation de JETONS_CLE_CHIFFREMENT : rechiffre sous le secret COURANT les jetons de la collecte par mail et les
 *       abonnements aux notifications poussées encore chiffrés avec un secret de JETONS_CLES_ANCIENNES (lus dans
 *       l'environnement). SIMULATION sans « --appliquer ». Une ligne par transaction, vérifiée après écriture ; rejouable ;
 *       une ligne illisible est signalée, jamais écrasée. Ne modifie AUCUNE configuration : l'ancien secret se retire à la
 *       main, quand le compte rendu annonce zéro ligne restante. Retour arrière : relancer avec les deux secrets inversés.
 *   node scripts/editeur.mjs vapid-retirer-abonnements [--cabinet=<cabinetId>] [--limite=<nombre>] [--appliquer]
 *       Après une rotation des clés VAPID (PUSH_VAPID_CLE_PUBLIQUE de l'environnement = clé COURANTE) : retire les abonnements aux
 *       notifications poussées dont l'empreinte de clé VAPID enregistrée est connue et DIFFÉRENTE de la courante (ils ne peuvent plus
 *       rien recevoir ; chaque appareil se réactive). Ne retire JAMAIS un abonnement qui correspond ni un abonnement d'empreinte
 *       inconnue (antérieur à la migration 0048), et AUCUN autre objet. SIMULATION sans « --appliquer » ; une transaction par
 *       abonnement, journalisée ; idempotente. Refusée sans clé publique courante. Aucun appel sortant.
 *   node scripts/editeur.mjs ia-etat
 *       Lecture seule : dernières vérifications de connexion de la passerelle IA (aucun appel sortant).
 *   node scripts/editeur.mjs ia-verifier --appel-reel
 *       ÉMET DEUX APPELS RÉELS au fournisseur d'IA (IA_OVH_ENDPOINT, IA_OVH_JETON de l'environnement) : un coût et un flux
 *       sortant. Enregistre le résultat ; « connecté » seulement sur l'hôte officiel avec les modèles figés. Sans
 *       « --appel-reel » : rien n'est appelé. Valable IA_PREUVE_VALIDITE_JOURS jours (30 par défaut), jamais relancée seule.
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
const { chargerParametres, PARAMETRES_PROPOSES, validerParametres, empreinteParametres } = await import('../packages/db/dist/durees-conservation.js');

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
      exiger(1, 'fin-de-contrat <cabinetId> [--grace=<jours>] [--durees=<fichier>] [--durees-validees=<référence>] [--nom="<nom exact>"] [--pv=<fichier.json>] [--appliquer]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const appliquer = args.includes('--appliquer');
      const nom = option('nom');
      const chargees = chargerParametres(p.POLITIQUE_FIN_DE_CONTRAT.categories, option('durees'));
      const afficher = (plan) => {
        console.log(`Cabinet : ${plan.inventaire.cabinet.nom} (${plan.inventaire.cabinet.id}) — politique ${plan.inventaire.politique.version} (${plan.inventaire.politique.statut})`);
        console.log(`Durées de conservation : jeu ${plan.parametres.version}, statut « ${plan.parametres.statut} », source ${plan.parametres.source}, empreinte ${plan.parametres.empreinte.slice(0, 16)}…`);
        if (plan.parametres.statut === 'PROPOSITION NON VALIDÉE') console.log('  PROPOSITION NON VALIDÉE : aucune valeur juridique ; l’exécution réelle exige --durees-validees=<référence de la validation>.');
        console.table(plan.inventaire.categories.map((c) => ({ catégorie: c.code, devenir: c.devenir, lignes: c.lignes, 'durée (proposée, non arrêtée)': c.conservation?.duree ?? '' })));
        if (plan.inventaire.tablesSansCategorie.length) console.log(`TABLES SANS CATÉGORIE : ${plan.inventaire.tablesSansCategorie.join(', ')}`);
        console.table(plan.preconditions.map((x) => ({ 'pré-condition': x.libelle, satisfaite: x.satisfaite ? 'oui' : 'NON', détail: x.detail })));
        console.table(plan.etapes.map((e) => ({ rang: e.rang, opération: e.operation, table: e.table ?? '', lignes: e.lignes, détail: e.detail })));
        const o = plan.inventaire.objets;
        console.log(`Objets du stockage (étape séparée) : ${o.referencesEnBase} clé(s) référencée(s) en base, ${o.volumeOctetsConnu} octets connus, préfixes ${o.prefixes.join(' et ')}${o.clesHorsPrefixes ? ` — ${o.clesHorsPrefixes} clé(s) référencée(s) HORS de ces préfixes, jamais supprimées par la procédure` : ''}.`);
        console.log(`Hors tables : ${plan.inventaire.horsTables.utilisateursSansAutreCabinet.nombre} compte(s) sans autre cabinet, non traités. ${plan.inventaire.horsTables.fournisseurIdentite}`);
        console.log(plan.sauvegardes);
      };
      try {
        const r = await p.finDeContrat(client, { cabinetId: args[0], delaiGraceJours: option('grace') === undefined ? undefined : Number(option('grace')), confirmation: nom === undefined ? undefined : { cabinetId: args[0], nom }, appliquer, parametres: chargees, dureesValidees: option('durees-validees') });
        afficher(r.plan);
        if (r.simulation) console.log(`SIMULATION : rien n’a été modifié. ${r.plan.executable ? 'Toutes les pré-conditions sont réunies.' : 'Exécution IMPOSSIBLE en l’état (voir les pré-conditions).'} Pour exécuter : --nom="<nom exact>" --durees-validees="<référence>" --appliquer (IRRÉVERSIBLE).`);
        else {
          const fichier = option('pv') ?? `proces-verbal-fin-de-contrat-${args[0]}.json`;
          (await import('node:fs')).writeFileSync(fichier, `${p.jsonCanonique(r.procesVerbal)}\n`, { mode: 0o600 });
          console.log(`Fin de contrat EXÉCUTÉE (irréversible). Procès-verbal : ${fichier}, empreinte ${r.procesVerbal.empreinte} (également au registre fins_de_contrat).`);
          console.log('Restent à faire, hors de cet outil : la suppression des objets du stockage, la désactivation des comptes du fournisseur d’identité (plan à établir AVANT : comptes-fin-de-contrat), les fiches orphelines. Les sauvegardes ne sont pas purgées.');
        }
      } catch (e) {
        if (e.name !== 'RefusFinDeContrat') throw e;
        afficher(e.plan);
        throw e;
      }
      break;
    }
    case 'durees-defauts':
      console.error('PROPOSITION NON VALIDÉE : modèle à adapter et à faire valider (avocat, DPO) ; aucune valeur n’a de portée juridique.');
      console.log(JSON.stringify(PARAMETRES_PROPOSES, null, 2));
      break;
    case 'durees-verifier': {
      exiger(1, 'durees-verifier <fichier.json>');
      const c = chargerParametres(p.POLITIQUE_FIN_DE_CONTRAT.categories, args[0]);
      console.log(`Jeu de durées conforme à la structure : version ${c.parametres.version}, statut « ${c.parametres.statut} », empreinte ${c.empreinte}.`);
      console.log(c.nonValide ? 'PROPOSITION NON VALIDÉE : l’exécution réelle exigera --durees-validees=<référence>.' : `Validation déclarée : ${c.parametres.validation.reference} (${c.parametres.validation.date}, ${c.parametres.validation.par}). Ce contrôle ne vérifie pas la réalité de cette validation.`);
      break;
    }
    case 'conservation-simuler': {
      exiger(1, 'conservation-simuler <cabinetId> [--durees=<fichier>] [--grace=<jours>]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const { simulerConservationCabinet } = await import('../packages/db/dist/simulation-conservation.js');
      const s = await simulerConservationCabinet(client, args[0], chargerParametres(p.POLITIQUE_FIN_DE_CONTRAT.categories, option('durees')), { graceJours: option('grace') === undefined ? undefined : Number(option('grace')) });
      console.log(`Cabinet : ${s.cabinet.nom} (${s.cabinet.id}) — durées : jeu ${s.parametres.version}, « ${s.parametres.statut} », source ${s.parametres.source}`);
      console.log(`Abonnement : ${s.abonnement ? `${s.abonnement.statut}, fin ${s.abonnement.fin ?? 'non datée'}` : 'aucun'} ; exécution possible au plus tôt le ${s.executionAuPlusTot ?? 'non calculable'} (+${s.delaiExecutionJours} jour(s)) ; aujourd’hui ${s.aujourdhui}.`);
      console.table(s.lignes.map((l) => ({ catégorie: l.categorie, table: l.table, devenir: l.devenir, lignes: l.lignes, action: l.action, 'point de départ': l.pointDeDepart, 'première échéance': l.premiereEcheance ?? '', 'dernière échéance': l.derniereEcheance ?? '', état: l.etat })));
      for (const a of s.avertissements) console.log(`AVERTISSEMENT : ${a}`);
      console.log('SIMULATION : rien n’a été modifié.');
      break;
    }
    case 'journal-fin-de-vie': {
      exiger(1, 'journal-fin-de-vie <cabinetId> [--durees=<fichier>]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const { simulerFinDeVieJournal } = await import('../packages/db/dist/simulation-conservation.js');
      const s = await simulerFinDeVieJournal(client, args[0], chargerParametres(p.POLITIQUE_FIN_DE_CONTRAT.categories, option('durees')));
      console.log(`Journal du cabinet ${s.cabinetId} : ${s.journal.lignes} ligne(s) du ${s.journal.premiere ?? '—'} au ${s.journal.derniere ?? '—'} ; règle : ${JSON.stringify(s.regle.duree)} à partir de « ${s.regle.pointDeDepart} », puis « ${s.regle.apresEcheance} ».`);
      console.log(`Échéances : première ${s.journal.premiereEcheance ?? '—'}, dernière ${s.journal.derniereEcheance ?? '—'} ; ${s.journal.echeancesPassees} ligne(s) échue(s) au ${s.aujourdhui}.`);
      console.log(`État : dernière ligne ${s.etat.derniereLigne ?? '—'}, vérification stricte ${s.etat.verificationStricte === null ? 'intègre' : `RUPTURE à la ligne ${s.etat.verificationStricte}`}.`);
      console.table(s.familles);
      console.log(`Données personnelles dans les lignes : ${s.donneesPersonnellesDansLeJournal.lignesAvecCourriel} ligne(s) avec une adresse de courriel. Fiches désignées : ${s.acteurs.distincts} acteur(s), ${s.acteurs.fichesExistantes} fiche(s) existante(s), ${s.acteurs.fichesSansAppartenance} sans appartenance.`);
      for (const l of s.plan) console.log(`  ${l}`);
      for (const a of s.avertissements) console.log(`AVERTISSEMENT : ${a}`);
      console.log(`${s.ancre} SIMULATION : aucune ligne du journal n’a été touchée.`);
      break;
    }
    case 'comptes-fin-de-contrat': {
      exiger(1, 'comptes-fin-de-contrat <cabinetId> [--durees=<fichier>] [--plan=<fichier.json>]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const c = await import('../packages/db/dist/comptes-fin-de-contrat.js');
      const plan = await c.planComptesFinDeContrat(client, args[0], chargerParametres(p.POLITIQUE_FIN_DE_CONTRAT.categories, option('durees')));
      console.log(`Comptes dont la SEULE appartenance est ce cabinet (${plan.comptes.length}) ; comptes ayant une autre appartenance, JAMAIS touchés (${plan.comptesConserves.length}).`);
      console.table(plan.comptes.map((x) => ({ compte: x.email, rôle: x.role, support: x.support ? 'oui' : '', 'références restantes': x.referencesRestantes, fiche: x.devenirFiche, 'désactiver le': x.desactiverLe ?? '', 'supprimer le': x.supprimerLe ?? '' })));
      for (const a of plan.avertissements) console.log(`AVERTISSEMENT : ${a}`);
      if (option('plan')) {
        (await import('node:fs')).writeFileSync(option('plan'), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
        console.log(`Plan enregistré : ${option('plan')} (à conserver : après la fin de contrat, les appartenances n'existent plus).`);
      }
      console.log('SIMULATION : rien n’a été modifié, ni dans la base ni dans le fournisseur d’identité. L’exécution contre un fournisseur d’identité n’existe que pour un royaume d’essai créé par un test.');
      break;
    }
    case 'fiches-orphelines': {
      if (args.includes('--appliquer')) throw new Error('Refusé : l’exécution sur les fiches n’est possible que sur une base d’essai créée par un test (aucune purge réelle dans cet outil).');
      const c = await import('../packages/db/dist/comptes-fin-de-contrat.js');
      const plan = await c.planFichesOrphelines(client);
      console.table(plan.fiches.map((f) => ({ compte: f.email, 'références restantes': f.referencesRestantes, devenir: f.devenir, 'déjà pseudonymisée': f.dejaPseudonymisee ? 'oui' : '' })));
      console.log(`${plan.fiches.length} fiche(s) sans aucune appartenance. SIMULATION : rien n’a été modifié.`);
      break;
    }
    case 'fin-de-contrat-objets': {
      exiger(1, 'fin-de-contrat-objets <cabinetId> [--nom="<nom exact>"] [--durees-validees=<référence>] [--rapport=<fichier.jsonl>] [--appliquer]');
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
      if (args.includes('--appliquer')) {
        // Aucune suppression dans le bucket des données : seul un stockage d'ESSAI explicitement déclaré est admis.
        const { StockageEssaiS3 } = await import('../packages/plateforme/dist/stockage-essai.js');
        const { supprimerObjetsFinDeContratEssai } = await import('../packages/db/dist/objets-fin-de-contrat.js');
        const declare = process.env.STOCKAGE_ESSAI_BUCKET_DECLARE;
        if (!declare) throw new Error('Refusé : aucun stockage d’essai n’est déclaré (STOCKAGE_ESSAI_BUCKET_DECLARE). Cet outil ne supprime aucun objet du bucket des données.');
        const essai = new StockageEssaiS3({ endpoint: S3_ENDPOINT, region: S3_REGION, accessKey: S3_ACCESS_KEY, secretKey: S3_SECRET_KEY, bucket: declare }, { S3_BUCKET, STOCKAGE_ESSAI_BUCKET_DECLARE: declare });
        const nom = option('nom');
        const r = await supprimerObjetsFinDeContratEssai(client, essai, { cabinetId: args[0], confirmation: nom === undefined ? undefined : { cabinetId: args[0], nom }, dureesValidees: option('durees-validees'), fichierRapport: option('rapport') });
        console.log(`STOCKAGE D'ESSAI ${r.bucket} — passage ${r.passage} : ${r.trouvees} version(s) trouvée(s), ${r.supprimees} supprimée(s), ${r.verrouillees} verrouillée(s), ${r.erreurs} erreur(s), ${r.restantes} restante(s).`);
        break;
      }
      const { Stockage } = await import('../packages/plateforme/dist/stockage.js');
      const r = await p.objetsFinDeContrat(client, new Stockage({ S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY }), { cabinetId: args[0] });
      console.log(`SIMULATION : ${r.cles.length} objet(s) sous ${r.prefixes.join(' et ')} (empreinte de la liste : ${r.empreinteListeCles}). Rien n’a été supprimé.`);
      for (const k of r.cles.slice(0, 20)) console.log(`  ${k}`);
      if (r.cles.length > 20) console.log(`  … et ${r.cles.length - 20} autre(s)`);
      break;
    }
    case 'secrets-rechiffrer': {
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const inconnus = args.filter((x) => x !== '--appliquer' && !x.startsWith('--cabinet=') && !x.startsWith('--limite='));
      if (inconnus.length) exiger(99, 'secrets-rechiffrer [--cabinet=<cabinetId>] [--limite=<nombre>] [--appliquer]');
      const { rechiffrerSecrets } = await import('../packages/plateforme/dist/rotation-secrets.js');
      const appliquer = args.includes('--appliquer');
      // Les secrets viennent de l'environnement et ne sont jamais affichés : seuls des identifiants de clé le sont.
      const r = await rechiffrerSecrets(client, { JETONS_CLE_CHIFFREMENT: process.env.JETONS_CLE_CHIFFREMENT ?? '', JETONS_CLES_ANCIENNES: process.env.JETONS_CLES_ANCIENNES ?? '' }, {
        appliquer, cabinetId: option('cabinet'), limite: option('limite') === undefined ? undefined : Number(option('limite')),
      });
      console.log(`Clés courantes : jetons mail ${r.clesCourantes.jetonsMail}, abonnements poussés ${r.clesCourantes.abonnementsPousses} ; ${r.anciensSecretsConfigures} ancien(s) secret(s) configuré(s) en déchiffrement.`);
      console.table(r.tables.map((t) => ({ table: t.table, lignes: t.lignes, 'déjà sous la clé courante': t.dejaSousCleCourante, [appliquer ? 'rechiffrées' : 'à rechiffrer']: appliquer ? t.rechiffrees : t.restantes, restantes: t.restantes, illisibles: t.illisibles.length, 'échecs de vérification': t.echecsVerification.length })));
      for (const t of r.tables) {
        for (const i of t.illisibles) console.log(`ILLISIBLE (non modifiée) : ${t.table} ${i.id}, clé ${i.idCle || 'inconnue'} — aucun secret configuré ne la déchiffre.`);
        for (const id of t.echecsVerification) console.log(`VÉRIFICATION EN ÉCHEC (écriture annulée, ancien chiffré intact) : ${t.table} ${id}`);
      }
      if (r.demandesOauthEnCours) console.log(`${r.demandesOauthEnCours} demande(s) de connexion mail en cours : non rechiffrées (quelques minutes de vie), à relancer par leurs auteurs après la bascule.`);
      if (!appliquer) console.log('SIMULATION : rien n’a été modifié. Ajouter « --appliquer » pour rechiffrer.');
      else if (r.interrompu) console.log('Passage INTERROMPU par « --limite » : relancer la commande pour reprendre (les lignes déjà rechiffrées ne sont pas refaites).');
      console.log(
        r.ancienSecretRetirable
          ? `Plus aucune ligne${option('cabinet') ? ' de ce cabinet' : ''} ne dépend d’un ancien secret${appliquer ? '' : ' (constat de la simulation)'}. L’outil ne retire rien : c’est à l’exploitant de vider JETONS_CLES_ANCIENNES puis de relancer API et worker${option('cabinet') ? ' — après un passage SANS « --cabinet »' : ''}.`
          : 'NE PAS retirer l’ancien secret de JETONS_CLES_ANCIENNES : des lignes en dépendent encore (restantes, illisibles ou en échec).',
      );
      break;
    }
    case 'vapid-retirer-abonnements': {
      const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
      const inconnus = args.filter((x) => x !== '--appliquer' && !x.startsWith('--cabinet=') && !x.startsWith('--limite='));
      if (inconnus.length) exiger(99, 'vapid-retirer-abonnements [--cabinet=<cabinetId>] [--limite=<nombre>] [--appliquer]');
      const { retirerAbonnementsVapidObsoletes } = await import('../packages/plateforme/dist/rotation-vapid.js');
      const appliquer = args.includes('--appliquer');
      const r = await retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: process.env.PUSH_VAPID_CLE_PUBLIQUE ?? '' }, {
        appliquer, cabinetId: option('cabinet'), limite: option('limite') === undefined ? undefined : Number(option('limite')),
      });
      console.log(`Empreinte de la clé VAPID courante : ${r.empreinteCourante}… (SHA-256 de la clé publique).`);
      console.table([{ 'abonnements examinés': r.abonnements, 'correspondent (conservés)': r.correspondants, 'empreinte inconnue (conservés)': r.empreinteInconnue, [appliquer ? 'retirés' : 'à retirer']: appliquer ? r.retires : r.obsoletes, 'restants obsolètes': r.restantsObsoletes }]);
      if (r.parCabinet.length) console.table(r.parCabinet.map((c) => ({ cabinet: c.cabinetId, 'abonnements obsolètes': c.obsoletes })));
      for (const c of r.concernes) console.log(`${appliquer ? 'RETIRÉ' : 'À RETIRER'} : abonnement ${c.id} (cabinet ${c.cabinetId}, service ${c.service})`);
      if (r.empreinteInconnue) console.log(`${r.empreinteInconnue} abonnement(s) d'empreinte inconnue (antérieurs à la migration 0048) : non touchés ; leurs appareils se réactiveront au premier refus du service de notification ou par « Réactiver ».`);
      if (!appliquer) console.log('SIMULATION : rien n’a été modifié. Ajouter « --appliquer » pour retirer.');
      else if (r.interrompu) console.log('Passage INTERROMPU par « --limite » : relancer la commande pour reprendre.');
      console.log('Aucun autre objet n’est supprimé (notifications, préférences, file d’envoi, cabinets, personnes) ; chaque retrait est inscrit au journal d’audit du cabinet.');
      break;
    }
    case 'ia-etat': {
      const { dernieresVerificationsIa } = await import('../packages/plateforme/dist/ia.js');
      const lignes = await dernieresVerificationsIa(client, 10);
      if (!lignes.length) console.log('Aucune vérification de connexion enregistrée : le statut ne peut pas être « connecté ».');
      else console.table(lignes.map((v) => ({ 'vérifiée le': v.verifieeLe, résultat: v.resultat, hôte: v.hote, langage: v.modeleLangage ?? '', vecteurs: v.modeleEmbeddings ?? '', dimensions: v.dimensionsEmbeddings ?? '', 'valide jusqu’au': v.valideJusquAu, configuration: v.empreinteConfiguration.slice(0, 12) })));
      console.log('Lecture seule, aucun appel sortant. La preuve retenue par l’API et le worker est la plus récente pour LEUR configuration, si elle est « connecte » et non périmée.');
      break;
    }
    case 'ia-verifier': {
      if (!args.includes('--appel-reel') || args.length !== 1) {
        console.error('Cette commande ÉMET DEUX APPELS RÉELS au fournisseur d’IA (un coût, un flux sortant). Pour la lancer : node scripts/editeur.mjs ia-verifier --appel-reel');
        process.exitCode = 2;
        break;
      }
      const { verifierConnexionIaConfiguree } = await import('../packages/plateforme/dist/ia.js');
      const jours = process.env.IA_PREUVE_VALIDITE_JOURS ? Number(process.env.IA_PREUVE_VALIDITE_JOURS) : undefined;
      const r = await verifierConnexionIaConfiguree(client, { IA_OVH_ENDPOINT: process.env.IA_OVH_ENDPOINT, IA_OVH_JETON: process.env.IA_OVH_JETON, IA_PREUVE_VALIDITE_JOURS: jours });
      console.log(`Statut : ${r.statut}${r.raisons.length ? ` — ${r.raisons.join(' ')}` : ''}`);
      if (!r.enregistree) console.log('Rien n’a été enregistré (aucun fournisseur configuré : IA_OVH_ENDPOINT et IA_OVH_JETON sont requis ; aucun appel n’a été émis).');
      else if (r.resultat === 'connecte') console.log(`Preuve enregistrée : hôte ${r.verification.hote}, valable jusqu’au ${r.verification.valideJusquAu}. L’API et le worker la prennent en compte en moins d’une minute s’ils ont la MÊME configuration. « Connecté » atteste que le service répond, pas la qualité du modèle.`);
      else console.log(`Vérification ${r.resultat === 'echec' ? 'en ÉCHEC' : 'REFUSÉE'} : enregistrée comme telle. Toute preuve antérieure de cette configuration est désormais sans effet ; le statut reste « configuré, non vérifié ».`);
      if (r.resultat !== 'connecte') process.exitCode = 1;
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
