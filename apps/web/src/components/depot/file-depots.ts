'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { messageServiceFerme } from '@/lib/abonnement';
import { type DepotLocal, enregistrerDepot, listerDepots, modifierDepot, purgerDepots, stockageDisponible, supprimerDepot } from '@/lib/depots-locaux';
import { type EtatDepot, repriseAutomatique, transition } from '@/lib/televersement/etats';
import { type IssueEnvoi, televerser } from '@/lib/televersement/moteur';
import { appelBff, transportBff } from '@/lib/televersement/transport-bff';

export interface DepotSuivi extends DepotLocal {
  /** Faux si le dépôt n'a pas pu être écrit sur l'appareil : il ne survivra pas à la fermeture de la page. */
  persistant: boolean;
}
export interface DepotRecu {
  cle: string;
  nomFichier: string;
  dossier: string;
  documentId: string | null;
  doublonBinaire: boolean;
  assemblage: boolean;
}
export type NouveauDepot = Omit<DepotLocal, 'id' | 'utilisateurId' | 'televersementId' | 'octetsConfirmes' | 'etat' | 'message' | 'creeLe' | 'majLe'>;

function messageIssue(issue: IssueEnvoi): string | null {
  switch (issue.issue) {
    case 'session_expiree':
      return 'Votre session a expiré. Reconnectez-vous, puis reprenez l’envoi.';
    case 'service_ferme': {
      const m = messageServiceFerme(issue.situation);
      return `${m.cause} ${m.suite} Ce dépôt reste en attente sur cet appareil : il n’est pas supprimé.`;
    }
    case 'interrompu':
    case 'refuse':
      return issue.message;
    default:
      return null;
  }
}

/**
 * File des dépôts de l'appareil. Les envois se font un par un, uniquement tant que la page est ouverte :
 * aucune exécution en arrière-plan n'est supposée. La reprise est déclenchée à l'ouverture, au retour dans
 * l'application (`visibilitychange`) et au retour du réseau (`online`).
 */
export function useDepots(utilisateurId: string) {
  const [depots, setDepots] = useState<DepotSuivi[]>([]);
  const [recus, setRecus] = useState<DepotRecu[]>([]);
  const [pret, setPret] = useState(false);
  const [persistance, setPersistance] = useState<'appareil' | 'memoire'>('appareil');
  const [enLigne, setEnLigne] = useState(true);
  const liste = useRef<DepotSuivi[]>([]);
  const actif = useRef<{ id: string; controleur: AbortController } | null>(null);
  const boucle = useRef(false);
  /** Dépôts interrompus par une coupure réseau : relancés automatiquement au retour du réseau ou dans l'application. */
  const coupures = useRef(new Set<string>());

  const publier = useCallback((suivante: DepotSuivi[]) => {
    liste.current = suivante;
    setDepots(suivante);
  }, []);

  const appliquer = useCallback(
    (id: string, modification: Partial<Pick<DepotLocal, 'etat' | 'message' | 'televersementId' | 'octetsConfirmes'>>) => {
      const cible = liste.current.find((d) => d.id === id);
      if (!cible) return;
      publier(liste.current.map((d) => (d.id === id ? { ...d, ...modification, majLe: Date.now() } : d)));
      if (cible.persistant) void modifierDepot(id, modification).catch(() => undefined);
    },
    [publier],
  );

  const envoyer = useCallback(
    async (d: DepotSuivi) => {
      const controleur = new AbortController();
      actif.current = { id: d.id, controleur };
      coupures.current.delete(d.id);
      appliquer(d.id, { etat: 'envoi', message: null });
      const issue = await televerser({
        fichier: d.fichier,
        ouverture: {
          entiteId: d.entiteId,
          nomFichier: d.nomFichier,
          taille: d.taille,
          sha256: d.sha256,
          typeMime: d.typeMime,
          canal: 'telephone',
          usage: 'piece',
          nature: d.nature,
          ...(d.commentaire ? { commentaire: d.commentaire } : {}),
        },
        transport: transportBff,
        televersementId: d.televersementId,
        signal: controleur.signal,
        surProgression: (p) => appliquer(d.id, { televersementId: p.televersementId, octetsConfirmes: p.octetsConfirmes }),
      }).catch((e: unknown): IssueEnvoi => ({ issue: 'interrompu', televersementId: d.televersementId, octetsConfirmes: 0, message: e instanceof Error ? e.message : 'Erreur inattendue' }));
      actif.current = null;
      if (!liste.current.some((x) => x.id === d.id)) return; // supprimé pendant l'envoi

      if (issue.issue === 'recu') {
        // Confirmation du serveur : l'entrée locale (fichier compris) est supprimée immédiatement.
        if (d.persistant) await supprimerDepot(d.id).catch(() => undefined);
        publier(liste.current.filter((x) => x.id !== d.id));
        setRecus((r) => [
          { cle: d.id, nomFichier: d.nomFichier, dossier: d.dossier, documentId: issue.vue.documentId, doublonBinaire: issue.vue.doublonBinaire, assemblage: d.assemblage },
          ...r,
        ]);
        return;
      }
      if (issue.issue === 'coupure') coupures.current.add(d.id);
      appliquer(d.id, { etat: transition('envoi', { type: 'issue', issue, enLigne: navigator.onLine }), message: messageIssue(issue) });
    },
    [appliquer, publier],
  );

  const traiter = useCallback(async () => {
    if (boucle.current) return;
    boucle.current = true;
    try {
      for (;;) {
        const suivant = liste.current.find((d) => d.etat === 'en_file');
        if (!suivant) break;
        if (!navigator.onLine) {
          for (const d of liste.current) if (d.etat === 'en_file') appliquer(d.id, { etat: transition(d.etat, { type: 'hors_ligne' }) });
          break;
        }
        await envoyer(suivant);
      }
    } finally {
      boucle.current = false;
    }
  }, [appliquer, envoyer]);

  /** Remet en file les dépôts qui attendaient le réseau (et ceux interrompus par une coupure). */
  const relancerAttentes = useCallback(() => {
    if (!navigator.onLine) return;
    for (const d of liste.current) {
      if (repriseAutomatique(d.etat) || (d.etat === 'interrompu' && coupures.current.has(d.id))) appliquer(d.id, { etat: 'en_file', message: null });
    }
    void traiter();
  }, [appliquer, traiter]);

  useEffect(() => {
    let annule = false;
    (async () => {
      setEnLigne(navigator.onLine);
      if (!stockageDisponible()) {
        setPersistance('memoire');
        setPret(true);
        return;
      }
      try {
        await purgerDepots(utilisateurId);
        const connus = await listerDepots(utilisateurId);
        if (annule) return;
        // Retour dans l'application : tout dépôt non terminé repart de l'état confirmé par le serveur.
        publier(connus.map((d) => ({ ...d, persistant: true, etat: d.etat === 'refuse' ? 'refuse' : ('en_file' satisfies EtatDepot), message: d.etat === 'refuse' ? d.message : null })));
      } catch {
        setPersistance('memoire');
      }
      setPret(true);
      void traiter();
    })();
    const surLigne = () => {
      setEnLigne(true);
      relancerAttentes();
    };
    const surHorsLigne = () => {
      setEnLigne(false);
      for (const d of liste.current) if (d.etat === 'en_file') appliquer(d.id, { etat: 'attente_connexion' });
    };
    const surVisibilite = () => {
      if (document.visibilityState === 'visible') relancerAttentes();
    };
    window.addEventListener('online', surLigne);
    window.addEventListener('offline', surHorsLigne);
    document.addEventListener('visibilitychange', surVisibilite);
    return () => {
      annule = true;
      window.removeEventListener('online', surLigne);
      window.removeEventListener('offline', surHorsLigne);
      document.removeEventListener('visibilitychange', surVisibilite);
      actif.current?.controleur.abort();
    };
  }, [utilisateurId, appliquer, publier, relancerAttentes, traiter]);

  const ajouter = useCallback(
    async (n: NouveauDepot): Promise<{ persistant: boolean }> => {
      const maintenant = Date.now();
      const depot: DepotLocal = { ...n, id: crypto.randomUUID(), utilisateurId, televersementId: null, octetsConfirmes: 0, etat: 'en_file', message: null, creeLe: maintenant, majLe: maintenant };
      let persistant = false;
      if (stockageDisponible()) {
        try {
          // Demande (sans garantie) que le navigateur n'évince pas ces données en cas de manque de place.
          void navigator.storage?.persist?.().catch(() => undefined);
          await enregistrerDepot(depot);
          persistant = true;
        } catch {
          persistant = false;
        }
      }
      if (!persistant) setPersistance('memoire');
      publier([...liste.current, { ...depot, persistant }]);
      void traiter();
      return { persistant };
    },
    [publier, traiter, utilisateurId],
  );

  const reprendre = useCallback(
    (id: string) => {
      const d = liste.current.find((x) => x.id === id);
      if (!d || d.etat === 'envoi') return;
      appliquer(id, { etat: 'en_file', message: null });
      void traiter();
    },
    [appliquer, traiter],
  );

  const supprimer = useCallback(
    async (id: string) => {
      if (actif.current?.id === id) actif.current.controleur.abort();
      coupures.current.delete(id);
      // Abandon côté serveur (libère les morceaux déjà reçus) : au mieux, sans jamais bloquer la suppression locale.
      const televersementId = liste.current.find((d) => d.id === id)?.televersementId;
      if (televersementId && navigator.onLine) void appelBff(`v1/televersements/${televersementId}`, { method: 'DELETE' }).catch(() => undefined);
      publier(liste.current.filter((d) => d.id !== id));
      await supprimerDepot(id).catch(() => undefined);
    },
    [publier],
  );

  return { depots, recus, pret, persistance, enLigne, ajouter, reprendre, supprimer };
}
