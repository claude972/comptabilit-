import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { tracerMiseEnFile } from './traces.js';

/**
 * Files de traitements différés. Les tâches ne transportent que des identifiants :
 * les pièces restent dans le stockage documentaire, les données dans PostgreSQL.
 */
export const FILES = {
  documents: 'documents',
  comptabilite: 'comptabilite',
  exports: 'exports',
  mail: 'mail',
  pousses: 'pousses',
} as const;

export interface TacheAnalyseDocument {
  cabinetId: string;
  documentId: string;
}
/** Réanalyse explicite du destinataire (D-091) : un lot demandé par une personne ; identifiants seulement. */
export interface TacheReanalyseDestinataire {
  cabinetId: string;
  lotId: string;
}
export interface TacheImportFec {
  cabinetId: string;
  lotImportId: string;
}
export interface TacheControles {
  cabinetId: string;
  executionId: string;
}
export interface TacheRestitution {
  cabinetId: string;
  restitutionId: string;
}
export interface TacheRestitutionCabinet {
  cabinetId: string;
  restitutionCabinetId: string;
}
export interface TacheImportReleve {
  cabinetId: string;
  lotImportId: string;
}
export interface TacheRapprochement {
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

/**
 * Livraison d'une notification poussée à UN appareil : identifiants seulement. Ni le point d'accès, ni les clés de
 * l'abonnement, ni aucun texte ne transitent par la file (ils sont relus et déchiffrés au moment de l'envoi).
 */
export interface TachePoussee {
  cabinetId: string;
  envoiId: string;
  abonnementId: string;
}
/** Nombre maximal de tentatives de livraison d'une notification poussée (erreurs temporaires rejouées, délai doublé à chaque fois). */
export const TENTATIVES_POUSSEE = 5;

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
  readonly pousses: Queue;
  constructor(connexion: ConnectionOptions, prefixe = 'bull') {
    const options = { connection: connexion, defaultJobOptions: OPTIONS, prefix: prefixe };
    this.documents = new Queue(FILES.documents, options);
    this.comptabilite = new Queue(FILES.comptabilite, options);
    this.exports = new Queue(FILES.exports, options);
    this.mail = new Queue(FILES.mail, options);
    this.pousses = new Queue(FILES.pousses, options);
  }
  /**
   * Mise en file suivie : si une trace est en cours (requête de l'API, traitement du worker), son contexte W3C
   * (`traceparent`, `tracestate`) accompagne le travail dans l'option BullMQ `telemetry.metadata` — hors des données du
   * travail et sans toucher à son identifiant. Sans trace en cours : mise en file strictement identique à avant.
   */
  private ajouter(file: Queue, nom: string, t: object, options: JobsOptions = {}) {
    return tracerMiseEnFile(file.name, nom, t, (metadonnees) => file.add(nom, t, metadonnees ? { ...options, telemetry: { metadata: metadonnees } } : options));
  }
  // L'identifiant de tâche rend la mise en file idempotente (une relance ne crée pas de doublon en attente).
  analyserDocument(t: TacheAnalyseDocument) {
    return this.ajouter(this.documents, 'analyser', t, { jobId: `doc-${t.documentId}-${Date.now()}` });
  }
  reanalyserDestinataire(t: TacheReanalyseDestinataire) {
    // Identifiant unique par tentative : une REPRISE doit être traitée. L'idempotence est garantie par le rapport par pièce
    // (index unique en base), jamais par l'identifiant de tâche.
    return this.ajouter(this.documents, 'reanalyser-destinataire', t, { jobId: `rea-${t.lotId}-${Date.now()}` });
  }
  importerFec(t: TacheImportFec) {
    // Identifiant unique par tentative : une REPRISE doit être traitée (la file ignore un identifiant déjà vu).
    // L'idempotence est garantie par le statut du lot, vérifié au début du traitement, pas par l'identifiant de tâche.
    return this.ajouter(this.comptabilite, 'importer-fec', t, { jobId: `fec-${t.lotImportId}-${Date.now()}` });
  }
  executerControles(t: TacheControles) {
    return this.ajouter(this.comptabilite, 'controles', t, { jobId: `ctl-${t.executionId}` });
  }
  genererRestitution(t: TacheRestitution) {
    return this.ajouter(this.exports, 'restitution', t, { jobId: `res-${t.restitutionId}` });
  }
  genererRestitutionCabinet(t: TacheRestitutionCabinet) {
    return this.ajouter(this.exports, 'restitution-cabinet', t, { jobId: `resc-${t.restitutionCabinetId}-${Date.now()}` });
  }
  importerReleve(t: TacheImportReleve) {
    return this.ajouter(this.comptabilite, 'importer-releve', t, { jobId: `rel-${t.lotImportId}-${Date.now()}` });
  }
  executerRapprochement(t: TacheRapprochement) {
    return this.ajouter(this.comptabilite, 'rapprochement', t, { jobId: `rap-${t.executionId}` });
  }
  genererDossier(t: TacheDossierRevision) {
    return this.ajouter(this.exports, 'dossier-revision', t, { jobId: `exp-${t.exportId}` });
  }
  // Pas d'identifiant de tâche : chaque notification déclenche une synchronisation (sérialisée par connexion, sans effet si rien n'a changé).
  synchroniserMail(t: TacheMail) {
    return this.ajouter(this.mail, 'synchroniser', t);
  }
  entretenirMail(t: TacheMail) {
    return this.ajouter(this.mail, 'entretenir', t);
  }
  cycleDeVieMail(t: TacheMail) {
    return this.ajouter(this.mail, 'cycle-de-vie', t);
  }
  /**
   * Une tâche par (envoi, appareil) : l'identifiant de tâche rend la mise en file idempotente (un relevé rejoué ne livre
   * pas deux fois). Erreurs temporaires rejouées avec bornes : TENTATIVES_POUSSEE tentatives, délai doublé à chaque fois.
   */
  livrerPoussee(t: TachePoussee, delaiRepriseMs: number) {
    return this.ajouter(this.pousses, 'livrer', t, { jobId: `pousse-${t.envoiId}-${t.abonnementId}`, attempts: TENTATIVES_POUSSEE, backoff: { type: 'exponential', delay: delaiRepriseMs } });
  }
  async fermer() {
    await Promise.all([this.documents.close(), this.comptabilite.close(), this.exports.close(), this.mail.close(), this.pousses.close()]);
  }
}
