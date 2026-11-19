/**
 * Dépôts en attente conservés sur l'appareil, dans IndexedDB (jamais dans le cache du service worker).
 * Une entrée contient le fichier assemblé et ses métadonnées ; elle est supprimée dès la confirmation du serveur,
 * à la demande de l'utilisateur, après 7 jours d'abandon, ou à la déconnexion.
 */
import type { NatureDocument } from './types-api';
import { type EtatDepot, estPerime } from './televersement/etats';

export interface DepotLocal {
  /** Identifiant local (UUID). */
  id: string;
  /** Propriétaire : un dépôt n'est jamais repris ni montré sous un autre compte. */
  utilisateurId: string;
  entiteId: string;
  dossier: string;
  nomFichier: string;
  typeMime: string;
  taille: number;
  sha256: string;
  nature: NatureDocument;
  commentaire: string;
  /** Vrai si le fichier est un PDF assemblé localement à partir de photos. */
  assemblage: boolean;
  nbPages: number;
  fichier: Blob;
  televersementId: string | null;
  octetsConfirmes: number;
  etat: EtatDepot;
  message: string | null;
  creeLe: number;
  majLe: number;
}

const BASE = 'comtaple-depots';
const MAGASIN = 'depots';

export function stockageDisponible(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(BASE, 1);
    demande.onupgradeneeded = () => {
      const magasin = demande.result.createObjectStore(MAGASIN, { keyPath: 'id' });
      magasin.createIndex('utilisateurId', 'utilisateurId');
    };
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error ?? new Error('IndexedDB indisponible'));
    demande.onblocked = () => rejeter(new Error('IndexedDB bloquée'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (magasin: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const bd = await ouvrir();
  try {
    return await new Promise<T | undefined>((resoudre, rejeter) => {
      const tx = bd.transaction(MAGASIN, mode);
      const demande = action(tx.objectStore(MAGASIN));
      tx.oncomplete = () => resoudre(demande ? demande.result : undefined);
      tx.onerror = () => rejeter(tx.error ?? new Error('Écriture locale impossible'));
      tx.onabort = () => rejeter(tx.error ?? new Error('Écriture locale interrompue (espace insuffisant ?)'));
    });
  } finally {
    bd.close();
  }
}

export async function enregistrerDepot(d: DepotLocal): Promise<void> {
  await transaction('readwrite', (m) => m.put(d));
}

export async function listerDepots(utilisateurId: string): Promise<DepotLocal[]> {
  const tous = (await transaction<DepotLocal[]>('readonly', (m) => m.index('utilisateurId').getAll(utilisateurId))) ?? [];
  return tous.sort((a, b) => a.creeLe - b.creeLe);
}

export async function modifierDepot(id: string, modification: Partial<Omit<DepotLocal, 'id' | 'fichier'>>): Promise<DepotLocal | null> {
  const bd = await ouvrir();
  try {
    return await new Promise<DepotLocal | null>((resoudre, rejeter) => {
      const tx = bd.transaction(MAGASIN, 'readwrite');
      const magasin = tx.objectStore(MAGASIN);
      let resultat: DepotLocal | null = null;
      const lecture = magasin.get(id);
      lecture.onsuccess = () => {
        const actuel = lecture.result as DepotLocal | undefined;
        if (!actuel) return; // supprimé entre-temps : on ne le recrée pas
        resultat = { ...actuel, ...modification, majLe: Date.now() };
        magasin.put(resultat);
      };
      tx.oncomplete = () => resoudre(resultat);
      tx.onerror = () => rejeter(tx.error ?? new Error('Écriture locale impossible'));
      tx.onabort = () => rejeter(tx.error ?? new Error('Écriture locale interrompue'));
    });
  } finally {
    bd.close();
  }
}

export async function supprimerDepot(id: string): Promise<void> {
  await transaction('readwrite', (m) => m.delete(id));
}

/** Purge les dépôts abandonnés depuis plus de 7 jours et ceux d'un autre compte ; renvoie le nombre d'entrées supprimées. */
export async function purgerDepots(utilisateurId: string, maintenant: number = Date.now()): Promise<number> {
  const tous = (await transaction<DepotLocal[]>('readonly', (m) => m.getAll())) ?? [];
  const aSupprimer = tous.filter((d) => d.utilisateurId !== utilisateurId || estPerime(d.creeLe, maintenant));
  for (const d of aSupprimer) await supprimerDepot(d.id);
  return aSupprimer.length;
}

/** Purge complète (déconnexion) : la base locale est supprimée. */
export function purgerTout(): Promise<void> {
  if (!stockageDisponible()) return Promise.resolve();
  return new Promise((resoudre) => {
    const demande = indexedDB.deleteDatabase(BASE);
    demande.onsuccess = demande.onerror = demande.onblocked = () => resoudre();
  });
}
