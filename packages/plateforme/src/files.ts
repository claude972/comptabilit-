import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

/**
 * Files de traitements différés. Les tâches ne transportent que des identifiants :
 * les pièces restent dans le stockage documentaire, les données dans PostgreSQL.
 */
export const FILES = {
  documents: 'documents',
  comptabilite: 'comptabilite',
  exports: 'exports',
  mail: 'mail',
} as const;

export interface TacheAnalyseDocument {
  cabinetId: string;
  documentId: string;
}
export interface TacheImportFec {
  cabinetId: string;
  lotImportId: string;
}
export interface TacheControles {
  cabinetId: string;
  executionId: string;
}
export interface TacheDossierRevision {
  cabinetId: string;
  exportId: string;
}

/** Tâches de la collecte par mail : identifiants seulement (jamais de contenu de message ni de notification). */
export interface TacheMail {
  cabinetId: string;
  connexionId: string;
  declencheur?: 'notification' | 'periodique' | 'manuel';
  /** Renouveler la surveillance même si son échéance est lointaine (périmètre modifié). */
  forcer?: boolean;
  /** Pour une notification de cycle de vie Graph déjà validée. */
  cycleDeVie?: { idAbonnement: string; evenement: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed' };
}

export function connexionRedis(url: string): ConnectionOptions {
  return new Redis(url, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
}

const OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export class Files {
  readonly documents: Queue;
  readonly comptabilite: Queue;
  readonly exports: Queue;
  readonly mail: Queue;
  constructor(connexion: ConnectionOptions, prefixe = 'bull') {
    const options = { connection: connexion, defaultJobOptions: OPTIONS, prefix: prefixe };
    this.documents = new Queue(FILES.documents, options);
    this.comptabilite = new Queue(FILES.comptabilite, options);
    this.exports = new Queue(FILES.exports, options);
    this.mail = new Queue(FILES.mail, options);
  }
  // L'identifiant de tâche rend la mise en file idempotente (une relance ne crée pas de doublon en attente).
  analyserDocument(t: TacheAnalyseDocument) {
    return this.documents.add('analyser', t, { jobId: `doc-${t.documentId}-${Date.now()}` });
  }
  importerFec(t: TacheImportFec) {
    return this.comptabilite.add('importer-fec', t, { jobId: `fec-${t.lotImportId}` });
  }
  executerControles(t: TacheControles) {
    return this.comptabilite.add('controles', t, { jobId: `ctl-${t.executionId}` });
  }
  genererDossier(t: TacheDossierRevision) {
    return this.exports.add('dossier-revision', t, { jobId: `exp-${t.exportId}` });
  }
  // Pas d'identifiant de tâche : chaque notification déclenche une synchronisation (sérialisée par connexion, sans effet si rien n'a changé).
  synchroniserMail(t: TacheMail) {
    return this.mail.add('synchroniser', t);
  }
  entretenirMail(t: TacheMail) {
    return this.mail.add('entretenir', t);
  }
  cycleDeVieMail(t: TacheMail) {
    return this.mail.add('cycle-de-vie', t);
  }
  async fermer() {
    await Promise.all([this.documents.close(), this.comptabilite.close(), this.exports.close(), this.mail.close()]);
  }
}
