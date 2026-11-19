import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { connecteursMail, connexionRedis, FILES, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import { Worker } from 'bullmq';
import { analyserDocument } from './analyse-document.js';
import { executerRapprochement, importerReleve } from './banque.js';
import type { Contexte } from './contexte.js';
import { executerControlesExecution } from './controles.js';
import { genererDossierRevision } from './dossier-revision.js';
import { importerFec } from './import-fec.js';
import { planifierMail, traiterTacheMail } from './mail.js';

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
            : executerControlesExecution(c, job.data),
    { connection: connexionRedis(cfg.REDIS_URL), concurrency: 2, prefix },
  ),
  new Worker(FILES.exports, (job) => genererDossierRevision(c, job.data), { connection: connexionRedis(cfg.REDIS_URL), concurrency: 1, prefix }),
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
for (const w of workers) {
  // Les journaux ne contiennent que des identifiants techniques : ni contenu de pièce, ni donnée personnelle.
  w.on('completed', (job) => console.log(`[${w.name}] tâche ${job.name} ${job.id} terminée`));
  w.on('failed', (job, err) => console.error(`[${w.name}] tâche ${job?.name} ${job?.id} en échec (tentative ${job?.attemptsMade}) : ${err.message}`));
}

/**
 * Rattrapage : une pièce confirmée « reçue » dont la mise en file aurait été manquée (panne de Redis entre la
 * validation de la transaction et l'ajout de la tâche) est remise en file (fonction SQL étroite : identifiants seuls).
 */
async function rattraper(): Promise<void> {
  const { rows } = await c.bd.pool.query<{ cabinet_id: string; document_id: string }>('select * from worker_documents_en_retard(10, 500)');
  for (const r of rows) await c.taches.analyserDocument({ cabinetId: r.cabinet_id, documentId: r.document_id });
}
const minuterie = setInterval(() => void rattraper().catch((e) => console.error(`rattrapage : ${e.message}`)), 5 * 60_000);

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
