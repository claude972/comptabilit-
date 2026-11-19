import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { connecteursMail, Metriques, connexionRedis, FILES, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import { Worker } from 'bullmq';
import { analyserDocument } from './analyse-document.js';
import { executerRapprochement, importerReleve } from './banque.js';
import type { Contexte } from './contexte.js';
import { executerControlesExecution } from './controles.js';
import { genererDossierRevision } from './dossier-revision.js';
import { importerFec } from './import-fec.js';
import { planifierMail, traiterTacheMail } from './mail.js';
import { rattraper } from './rattrapage.js';
import { genererRestitution } from './restitution.js';
import { verifierSources } from './veille.js';

chargerEnvLocal();
const cfg = lireConfig();
// Les traitements différés utilisent le rôle comtaple_worker : borné au cabinet de l'enregistrement traité, sans BYPASSRLS.
const c: Contexte = { cfg, bd: creerAccesBd(urlBd('worker'), { max: 8 }), stockage: new Stockage(cfg), taches: new Files(connexionRedis(cfg.REDIS_URL), cfg.FILES_PREFIXE) };
const mail = connecteursMail(cfg);
const prefix = cfg.FILES_PREFIXE;
await c.stockage.assurerBucket();

// Concurrence volontairement limitée : les traitements lourds ne doivent pas affamer le serveur interactif.
const workers = [
  new Worker(FILES.documents, (job) => analyserDocument(c, job.data), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 2, prefix }),
  new Worker(
    FILES.comptabilite,
    (job) =>
      job.name === 'importer-fec'
        ? importerFec(c, job.data)
        : job.name === 'importer-releve'
          ? importerReleve(c, job.data)
          : job.name === 'rapprochement'
            ? executerRapprochement(c, job.data)
            : job.name === 'veille'
              ? verifierSources(c.bd).then((b) => console.log(`veille : ${b.verifiees} source(s), ${b.changements} changement(s), ${b.indisponibles} indisponible(s)`))
              : executerControlesExecution(c, job.data),
    { connection: connexionRedis(cfg.REDIS_URL), concurrency: 2, prefix },
  ),
  new Worker(FILES.exports, (job) => (job.name === 'restitution' ? genererRestitution(c, job.data) : genererDossierRevision(c, job.data)), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 1, prefix }),
  // Collecte par mail : synchronisations sérialisées par connexion (verrou), tâches planifiées de rattrapage et d'entretien.
  new Worker(FILES.mail, (job) => (job.name.startsWith('planifier-') ? planifierMail(c, job.name) : traiterTacheMail(c, mail, job.name, job.data)), {
    connection: connexionRedis(cfg.REDIS_URL),
    concurrency: 2,
    prefix,
  }),
];

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

// Veille réglementaire : une passe par jour sur les sources officielles surveillées.
await c.taches.comptabilite.upsertJobScheduler('veille-quotidienne', { every: 24 * 3600 * 1000 }, { name: 'veille', data: {} });

console.log('Worker Comtaple démarré (files : documents, comptabilite, exports, mail).');

async function arreter() {
  clearInterval(minuterie);
  await Promise.all(workers.map((w) => w.close()));
  await c.taches.fermer();
  await c.bd.fermer();
  process.exit(0);
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
