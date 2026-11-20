import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { arreterTraces, connecteursMail, creerIa, demarrerTraces, Metriques, connexionRedis, FILES, Files, lireConfig, notificationsPoussees, Stockage, tracerTravail } from '@comtaple/plateforme';
import { Worker, type Job } from 'bullmq';
import { analyserDocument } from './analyse-document.js';
import { executerRapprochement, importerReleve } from './banque.js';
import type { Contexte } from './contexte.js';
import { executerControlesExecution } from './controles.js';
import { genererDossierRevision } from './dossier-revision.js';
import { importerFec } from './import-fec.js';
import { planifierMail, traiterTacheMail } from './mail.js';
import { entretenirAbonnementsPousses, livrerPoussee, releverEnvoisPousses } from './poussees.js';
import { rattraper } from './rattrapage.js';
import { genererRestitution } from './restitution.js';
import { genererRestitutionCabinet } from './restitution-cabinet.js';
import { verifierSources } from './veille.js';

chargerEnvLocal();
const cfg = lireConfig();
// Traces OpenTelemetry : sans OTEL_EXPORTER_OTLP_ENDPOINT, cet appel ne fait rien (voir packages/plateforme/src/traces.ts).
if (demarrerTraces('worker', cfg)) console.log('Traces OpenTelemetry actives (export OTLP/HTTP).');
/** Span du traitement, enfant du contexte de trace transporté avec le travail ; trace neuve s'il n'y en a pas. */
const suivi =
  <T>(file: string, traiter: (job: Job) => Promise<T>) =>
  (job: Job) =>
    tracerTravail(file, job, () => traiter(job));
// Les traitements différés utilisent le rôle comtaple_worker : borné au cabinet de l'enregistrement traité, sans BYPASSRLS.
const c: Contexte = { cfg, bd: creerAccesBd(urlBd('worker'), { max: 8 }), stockage: new Stockage(cfg), taches: new Files(connexionRedis(cfg.REDIS_URL), cfg.FILES_PREFIXE) };
// Passerelle IA : sans jeton configuré, « non_connecte » ; les passages des pièces sont alors indexés sans vecteur.
c.ia = creerIa(cfg, c.bd);
const mail = connecteursMail(cfg);
// Notifications poussées : sans clés VAPID (défaut), « non_configure » — ni file, ni relevé, ni envoi.
const poussees = notificationsPoussees(cfg);
const prefix = cfg.FILES_PREFIXE;
await c.stockage.assurerBucket();

// Concurrence volontairement limitée : les traitements lourds ne doivent pas affamer le serveur interactif.
const workers = [
  new Worker(FILES.documents, suivi(FILES.documents, (job) => analyserDocument(c, job.data)), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 2, prefix }),
  new Worker(
    FILES.comptabilite,
    suivi(FILES.comptabilite, (job): Promise<unknown> =>
      job.name === 'importer-fec'
        ? importerFec(c, job.data)
        : job.name === 'importer-releve'
          ? importerReleve(c, job.data)
          : job.name === 'rapprochement'
            ? executerRapprochement(c, job.data)
            : job.name === 'veille'
              ? verifierSources(c.bd).then((b) => console.log(`veille : ${b.verifiees} source(s), ${b.changements} changement(s), ${b.indisponibles} indisponible(s)`))
              : executerControlesExecution(c, job.data)),
    { connection: connexionRedis(cfg.REDIS_URL), concurrency: 2, prefix },
  ),
  new Worker(FILES.exports, suivi(FILES.exports, (job): Promise<unknown> => (job.name === 'restitution-cabinet' ? genererRestitutionCabinet(c, job.data) : job.name === 'restitution' ? genererRestitution(c, job.data) : genererDossierRevision(c, job.data))), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 1, prefix }),
  // Collecte par mail : synchronisations sérialisées par connexion (verrou), tâches planifiées de rattrapage et d'entretien.
  new Worker(FILES.mail, suivi(FILES.mail, (job): Promise<unknown> => (job.name.startsWith('planifier-') ? planifierMail(c, job.name) : traiterTacheMail(c, mail, job.name, job.data))), {
    connection: connexionRedis(cfg.REDIS_URL),
    concurrency: 2,
    prefix,
  }),
];
// Livraison des notifications poussées : la file n'est consommée que si la fonction est activée.
if (poussees.statut !== 'non_configure') {
  workers.push(
    new Worker(FILES.pousses, suivi(FILES.pousses, (job): Promise<unknown> => livrerPoussee(c, poussees, job.data, { numero: job.attemptsMade + 1 })), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 4, prefix }),
  );
}

// Répétitions BullMQ : rattrapage périodique (les notifications peuvent être perdues ; seul mécanisme pour les boîtes
// partagées) et entretien quotidien des surveillances. Sans connecteur configuré, rien n'est planifié.
if (Object.keys(mail.fournisseurs).length > 0) {
  await c.taches.mail.upsertJobScheduler('mail-rattrapage', { every: cfg.MAIL_PERIODE_RATTRAPAGE_S * 1000 }, { name: 'planifier-synchronisations' });
  await c.taches.mail.upsertJobScheduler('mail-surveillances', { every: 24 * 3600 * 1000 }, { name: 'planifier-surveillances' });
} else {
  await c.taches.mail.removeJobScheduler('mail-rattrapage');
  await c.taches.mail.removeJobScheduler('mail-surveillances');
}
const metriques = new Metriques('worker');
metriques.servir(cfg.METRIQUES_PORT_WORKER, cfg.METRIQUES_HOTE);
for (const w of workers) {
  w.on('completed', (job) => {
    metriques.taches.inc({ file: w.name, tache: job.name, issue: 'terminee' });
    if (job.processedOn && job.finishedOn) metriques.dureeTaches.observe({ file: w.name, tache: job.name }, (job.finishedOn - job.processedOn) / 1000);
  });
  w.on('failed', (job) => metriques.taches.inc({ file: w.name, tache: job?.name ?? 'inconnue', issue: 'echec' }));
}
for (const w of workers) {
  // Les journaux ne contiennent que des identifiants techniques : ni contenu de pièce, ni donnée personnelle.
  w.on('completed', (job) => console.log(`[${w.name}] tâche ${job.name} ${job.id} terminée`));
  w.on('failed', (job, err) => console.error(`[${w.name}] tâche ${job?.name} ${job?.id} en échec (tentative ${job?.attemptsMade}) : ${err.message}`));
}

/**
 * Rattrapage : une pièce confirmée « reçue » dont la mise en file aurait été manquée (panne de Redis entre la
 * validation de la transaction et l'ajout de la tâche) est remise en file (fonction SQL étroite : identifiants seuls).
 */
const minuterie = setInterval(
  () =>
    void rattraper(c)
      .then((b) => {
        const n = b.documents + b.televersementsPurges + Object.values(b.traitements).reduce((t, x) => t + x, 0);
        if (n) console.log(`rattrapage : ${JSON.stringify(b)}`);
      })
      .catch((e) => console.error(`rattrapage : ${e.message}`)),
  5 * 60_000,
);

// Notifications poussées : relevé périodique des envois mis en attente par la base, et purge horaire de la file traitée.
// Désactivées (défaut) : aucune minuterie.
let dernierePurgePoussees = 0;
const minuteriePoussees =
  poussees.statut === 'non_configure'
    ? null
    : setInterval(
        () =>
          void releverEnvoisPousses(c, poussees)
            .then(async (b) => {
              if (b.envois) console.log(`notifications poussées : ${b.envois} envoi(s) relevé(s), ${b.livraisons} livraison(s) mise(s) en file, ${b.ignores} sans suite`);
              if (Date.now() - dernierePurgePoussees > 3600_000) {
                dernierePurgePoussees = Date.now();
                await c.bd.pool.query('select worker_envois_pousses_purger(7)');
              }
            })
            .catch((e) => console.error(`notifications poussées : relevé en échec : ${e.message}`)),
        cfg.PUSH_PERIODE_RELEVE_S * 1000,
      );
// Entretien des abonnements (membres dont l'accès est arrivé à son terme, abonnements inactifs trop longtemps) : une
// fois peu après le démarrage, puis toutes les heures. Écritures en base seulement, aucun appel sortant.
const entretienPoussees = () =>
  void entretenirAbonnementsPousses(c)
    .then((b) => {
      if (b.appartenanceInactive || b.inactivite) console.log(`notifications poussées : entretien — ${b.appartenanceInactive} abonnement(s) retiré(s) (appartenance inactive), ${b.inactivite} (inactivité de plus de ${cfg.PUSH_INACTIVITE_MAX_JOURS} jours)`);
    })
    .catch((e) => console.error(`notifications poussées : entretien en échec : ${e.message}`));
setTimeout(entretienPoussees, 30_000).unref();
const minuterieEntretienPoussees = setInterval(entretienPoussees, 3600_000);
console.log(`Notifications poussées : ${poussees.statut === 'non_configure' ? 'non configurées (aucun abonnement accepté, aucun envoi)' : poussees.statut === 'simule' ? 'SIMULATEUR de test (aucun service réel contacté)' : 'configurées, non vérifiées sur un appareil réel'}.`);

// Veille réglementaire : une passe par jour sur les sources officielles surveillées.
await c.taches.comptabilite.upsertJobScheduler('veille-quotidienne', { every: 24 * 3600 * 1000 }, { name: 'veille', data: {} });

// Relevé de la mémoire du processus : un nouveau pic (tas JavaScript ou mémoire résidente) est journalisé par paliers de
// 32 Mo. Sert à dimensionner le plafond de tas (--max-old-space-size) d'après des mesures, et à voir venir sa limite.
const picMemoire = { tas: 0, residente: 0 };
const v8 = await import('node:v8');
const plafondTasMo = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
setInterval(() => {
  const m = process.memoryUsage();
  const [tas, residente] = [Math.round(m.heapUsed / 1048576), Math.round(m.rss / 1048576)];
  if (tas >= picMemoire.tas + 32 || residente >= picMemoire.residente + 64) {
    picMemoire.tas = Math.max(picMemoire.tas, tas);
    picMemoire.residente = Math.max(picMemoire.residente, residente);
    console.log(`mémoire : pic tas ${picMemoire.tas} Mo (plafond ${plafondTasMo} Mo), résidente ${picMemoire.residente} Mo`);
  }
}, 500).unref();

console.log(`Worker Comtaple démarré (files : documents, comptabilite, exports, mail${poussees.statut === 'non_configure' ? '' : ', pousses'}) ; plafond de tas : ${plafondTasMo} Mo.`);

async function arreter() {
  clearInterval(minuterie);
  if (minuteriePoussees) clearInterval(minuteriePoussees);
  clearInterval(minuterieEntretienPoussees);
  await Promise.all(workers.map((w) => w.close()));
  await c.taches.fermer();
  await c.bd.fermer();
  // Envoi des spans en attente, dans un délai borné (sans effet si les traces ne sont pas actives).
  await arreterTraces();
  process.exit(0);
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
