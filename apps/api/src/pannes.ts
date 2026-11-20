import { FileIndisponible } from '@comtaple/plateforme';

/** Nature d'une panne de dépendance reconnue dans une erreur (sans jamais en exposer le détail technique). */
export function panneDeDependance(e: unknown): 'files' | 'stockage' | 'base' | null {
  if (e instanceof FileIndisponible) return 'files';
  if (!e || typeof e !== 'object') return null;
  const x = e as { $metadata?: { httpStatusCode?: number }; code?: unknown; message?: unknown; errors?: unknown[] };
  // Client S3 : erreur de réseau (aucun code HTTP) ou erreur du service (5xx). Une erreur 4xx (objet absent) n'est pas une panne.
  if (x.$metadata !== undefined && (x.$metadata.httpStatusCode === undefined || x.$metadata.httpStatusCode >= 500)) return 'stockage';
  const code = typeof x.code === 'string' ? x.code : '';
  const message = typeof x.message === 'string' ? x.message : '';
  // Base : connexion refusée ou coupée, délai d'obtention d'une connexion, arrêt ou démarrage du serveur, trop de connexions.
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300', '08000', '08003', '08006', '08001'].includes(code)) return 'base';
  if (/Connection terminated|timeout exceeded when trying to connect|the database system is (starting up|shutting down)/i.test(message)) return 'base';
  return null;
}

/** Code SQLSTATE d'une erreur de base, y compris quand le pilote l'enveloppe (propriété `cause`). */
export function codeSql(e: unknown): string {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && typeof x === 'object' && i < 4; x = x.cause as typeof x, i++) {
    if (typeof x.code === 'string') return x.code;
  }
  return '';
}

export const MESSAGES_PANNE = {
  files: 'Service de files de travaux indisponible. Votre demande est enregistrée si elle l’a été avant la panne ; elle sera reprise automatiquement ou peut être relancée dans quelques minutes.',
  stockage: 'Stockage des documents indisponible. Aucun octet n’a été compté reçu ou perdu : réessayez dans quelques instants (un dépôt interrompu reprend là où il s’est arrêté).',
  base: 'Base de données indisponible. Rien n’a été enregistré par cette demande : réessayez dans quelques instants.',
} as const;

