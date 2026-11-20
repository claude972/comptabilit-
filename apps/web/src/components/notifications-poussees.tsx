'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { messageErreur, useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Etiquette } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { formaterHorodatage } from '@/lib/montants';
import { type CapacitesNavigateur, cleServeur, creeAvecUneAutreCle, effacerMarqueRenouvellement, empreintePointAcces, type EtatAppareil, etatAppareil, type EtatServicePoussees, lireMarqueRenouvellement } from '@/lib/notifications-poussees';

/** Relève ce que le navigateur sait faire. Ne demande JAMAIS l'autorisation : la demande n'a lieu que sur un geste (bouton). */
async function releverCapacites(serviceActif: boolean, clePublique: string | null): Promise<CapacitesNavigateur> {
  const ua = navigator.userAgent;
  const c: CapacitesNavigateur = {
    serviceWorker: 'serviceWorker' in navigator,
    serviceWorkerEnregistre: false,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'default',
    ios: /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1),
    autonome: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    empreinteLocale: null,
    renouvellement: null,
  };
  if (!c.serviceWorker || !c.pushManager) return c;
  // Tant que le service n'a pas activé les notifications poussées (état réel par défaut), le navigateur n'est PAS
  // interrogé sur son service worker ni sur un abonnement : c'est inutile, et sous le moteur WebKit piloté par les tests
  // cette interrogation figeait la page des notifications (constaté en CI, run 44646499061).
  if (!serviceActif) return c;
  // L'enregistrement du service worker est lancé au chargement de l'application : on lui laisse quelques secondes avant
  // de conclure qu'il n'y en a pas (mode développement, navigation privée, réglage du navigateur).
  const enregistrement =
    (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ??
    (await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000))]).catch(() => undefined));
  c.serviceWorkerEnregistre = Boolean(enregistrement);
  // Lecture de l'abonnement bornée dans le temps et protégée : un navigateur qui ne répond pas, ou qui lève, ne doit ni
  // figer ni casser l'écran — l'appareil est alors simplement considéré comme non abonné.
  const lire = async () => {
    try {
      return (await enregistrement?.pushManager.getSubscription()) ?? null;
    } catch {
      return null;
    }
  };
  const abonnement = await Promise.race([lire(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  if (abonnement) c.empreinteLocale = await empreintePointAcces(abonnement.endpoint);
  // Rotation des clés du service : un abonnement créé avec l'ancienne clé publique ne reçoit plus rien.
  if (abonnement) c.cleServiceDifferente = creeAvecUneAutreCle(abonnement.options?.applicationServerKey, clePublique);
  // Marque laissée par le service worker si le navigateur a renouvelé ou perdu l'abonnement sans que le service l'ait su.
  // Lue APRÈS la garde ci-dessus (rien n'est interrogé tant que la fonction n'est pas activée), et bornée dans le temps.
  c.renouvellement = await lireMarqueRenouvellement().catch(() => null);
  return c;
}

/**
 * Bloc « Sur cet appareil » des préférences de notification. Amélioration progressive : chaque cas où la fonction n'est
 * pas disponible est dit explicitement. L'explication de ce qui s'affichera précède toujours la demande d'autorisation.
 */
export function NotificationsPoussees({ etat }: { etat: EtatServicePoussees }) {
  const appel = useAppel();
  const [capacites, setCapacites] = useState<CapacitesNavigateur | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const serviceActif = etat.activees;
  const clePublique = etat.clePublique;
  const relever = useCallback(() => releverCapacites(serviceActif, clePublique).then(setCapacites, () => setCapacites(null)), [serviceActif, clePublique]);
  useEffect(() => {
    void relever();
  }, [relever]);

  const appareil: EtatAppareil | null = capacites ? etatAppareil(etat, capacites) : null;

  // Renouvellement signalé par le service worker : l'ANCIEN abonnement de cet appareil, s'il est encore connu du service,
  // est retiré ici (il est devenu inutilisable) ; la réactivation, elle, reste un geste explicite. Une fois l'appareil de
  // nouveau reconnu par le service, la marque est effacée.
  const ancienRetire = useRef<string | null>(null);
  useEffect(() => {
    const marque = capacites?.renouvellement;
    if (!marque || !etat.activees) return;
    if (capacites.empreinteLocale && etat.appareils.some((a) => a.empreinte === capacites.empreinteLocale)) {
      void effacerMarqueRenouvellement().then(relever);
      return;
    }
    const ancien = marque.ancienneEmpreinte && marque.ancienneEmpreinte !== capacites.empreinteLocale ? etat.appareils.find((a) => a.empreinte === marque.ancienneEmpreinte) : undefined;
    if (ancien && ancienRetire.current !== ancien.id) {
      ancienRetire.current = ancien.id;
      void appel.executer(`v1/notifications/poussees/abonnements/${ancien.id}`, { method: 'DELETE' }, 'L’ancien abonnement de cet appareil, renouvelé par le navigateur, a été retiré.');
    }
  }, [capacites, etat.activees, etat.appareils, appel, relever]);

  /** Geste explicite : demande d'autorisation au navigateur, puis abonnement de l'appareil et enregistrement auprès du service. */
  async function activer() {
    if (!etat.clePublique) return;
    setOccupe(true);
    setErreur(null);
    setSucces(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setErreur(permission === 'denied' ? 'Autorisation refusée : aucune notification ne sera affichée sur cet appareil.' : 'Autorisation non accordée : rien n’a été activé.');
        return;
      }
      const enregistrement = await navigator.serviceWorker.ready;
      // « userVisibleOnly » : chaque message reçu affiche une notification — il n'existe pas de message silencieux.
      let existant = await enregistrement.pushManager.getSubscription();
      let remplacee: string | null = null;
      // Abonnement créé avec une ancienne clé du service (rotation) : inutilisable, et le navigateur refuserait d'en créer
      // un second avec une autre clé. Il est retiré du navigateur, puis remplacé côté service.
      if (existant && creeAvecUneAutreCle(existant.options?.applicationServerKey, etat.clePublique)) {
        remplacee = await empreintePointAcces(existant.endpoint);
        await existant.unsubscribe();
        existant = null;
      }
      const abonnement = existant ?? (await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleServeur(etat.clePublique) }));
      const json = abonnement.toJSON();
      const corps = { endpoint: abonnement.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth }, agentUtilisateur: navigator.userAgent };
      // Après un renouvellement par le navigateur : remplacement ATOMIQUE de l'ancien abonnement de cet appareil.
      const marque = capacites?.renouvellement ?? null;
      const fait = marque || remplacee
        ? await appel.executer('v1/notifications/poussees/abonnements/remplacement', { method: 'POST', json: { ...corps, ancienneEmpreinte: remplacee ?? marque?.ancienneEmpreinte ?? null } }, 'Cet appareil est de nouveau abonné aux notifications poussées.')
        : await appel.executer('v1/notifications/poussees/abonnements', { method: 'POST', json: corps }, 'Cet appareil est abonné aux notifications poussées.');
      if (fait && marque) await effacerMarqueRenouvellement();
    } catch (e) {
      setErreur(e instanceof DOMException ? 'Le navigateur n’a pas pu abonner cet appareil. Rien n’a été activé.' : messageErreur(e));
    } finally {
      setOccupe(false);
      await relever();
    }
  }

  /** Retire l'abonnement du navigateur ET celui du service pour cet appareil. */
  async function desactiver() {
    setOccupe(true);
    setErreur(null);
    setSucces(null);
    try {
      const enregistrement = await navigator.serviceWorker.getRegistration();
      const abonnement = await enregistrement?.pushManager.getSubscription();
      const empreinte = abonnement ? await empreintePointAcces(abonnement.endpoint) : null;
      await abonnement?.unsubscribe();
      await effacerMarqueRenouvellement();
      const connu = etat.appareils.find((a) => a.empreinte === empreinte);
      if (connu) await appel.executer(`v1/notifications/poussees/abonnements/${connu.id}`, { method: 'DELETE' }, 'Cet appareil n’est plus abonné.');
      else setSucces('Cet appareil n’est plus abonné.');
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setOccupe(false);
      await relever();
    }
  }

  async function retirer(id: string) {
    setErreur(null);
    setSucces(null);
    // Si c'est l'appareil courant, son abonnement dans le navigateur est retiré aussi.
    const cible = etat.appareils.find((a) => a.id === id);
    if (cible && capacites?.empreinteLocale === cible.empreinte) return desactiver();
    await appel.executer(`v1/notifications/poussees/abonnements/${id}`, { method: 'DELETE' }, 'Appareil retiré.');
  }

  const explication = (
    <div className="space-y-2" data-testid="explication-poussees">
      <p>
        Si vous l’activez, cet appareil affichera une notification quand quelque chose vous attend dans Comtaple. <strong>Ce qui s’affiche, y compris sur l’écran verrouillé</strong> : le nom « Comtaple » et l’une de ces phrases, rien d’autre.
      </p>
      <ul className="list-disc space-y-1 pl-6" data-testid="phrases-poussees">
        {etat.phrases.map((p) => (
          <li key={p}>« {p} »</li>
        ))}
      </ul>
      <p>
        <strong>Jamais de montant, de nom de dossier, de client ni de fichier.</strong> Le détail ne se lit que dans l’application, une fois connecté. Le message passe par le service de notification de votre navigateur ({etat.services.join(' ; ')}) : ce service sait qu’un message vous est adressé et quand, mais il ne peut pas le lire.
      </p>
    </div>
  );

  return (
    <section aria-labelledby="titre-poussees" className="space-y-3" data-testid="notifications-poussees" data-statut={etat.statut} data-etat-appareil={appareil ?? 'inconnu'}>
      <h2 id="titre-poussees" className="font-medium">
        Sur cet appareil
      </h2>
      {!etat.activees ? (
        <Alerte ton="neutre" data-testid="poussees-non-activees">
          {etat.detail} Aucune notification n’est affichée sur vos appareils ; celles de l’application ne changent pas.
        </Alerte>
      ) : (
        <>
          <Alerte ton="attention" data-testid="poussees-etat-reel">
            {etat.statut === 'simule' ? 'Service de test (simulateur) : aucun appareil réel ne reçoit de notification.' : 'Fonction préparée et vérifiée contre un simulateur de service de notification seulement.'}{' '}
            <strong>La réception sur un téléphone réel et l’affichage sur un écran verrouillé n’ont pas été essayés.</strong>
          </Alerte>
          {appareil === null ? <p className="text-texte-doux">Vérification de ce que ce navigateur sait faire…</p> : null}
          {appareil === 'ios_a_installer' ? (
            <Alerte ton="neutre" data-testid="poussees-ios">
              Sur iPhone et iPad, les notifications poussées n’existent que pour une application <strong>ajoutée à l’écran d’accueil</strong> (iOS ou iPadOS 16.4 ou plus récent) : dans Safari, touchez <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>, ouvrez Comtaple depuis son icône et revenez sur cet écran. Dans cet onglet, la fonction n’est pas disponible. Ces conditions sont celles que documente Apple ; elles n’ont pas été essayées sur un appareil réel avec Comtaple.
            </Alerte>
          ) : null}
          {appareil === 'non_pris_en_charge' ? (
            <Alerte ton="neutre" data-testid="poussees-non-prises-en-charge">
              Ce navigateur ne prend pas en charge les notifications poussées{capacites?.ios ? ' (sur iPhone et iPad, elles exigent iOS ou iPadOS 16.4 ou plus récent)' : ''}. Vos notifications restent disponibles dans l’application.
            </Alerte>
          ) : null}
          {appareil === 'service_worker_absent' ? (
            <Alerte ton="neutre" data-testid="poussees-sans-service-worker">
              Ce navigateur sait afficher des notifications poussées, mais le composant d’arrière-plan de Comtaple n’y est pas actif (navigation privée, réglage du navigateur ou version de développement). La fonction n’est pas disponible ici.
            </Alerte>
          ) : null}
          {appareil === 'refusees' ? (
            <Alerte ton="attention" data-testid="poussees-refusees">
              Les notifications sont <strong>refusées</strong> pour Comtaple dans ce navigateur. Comtaple ne peut pas redemander l’autorisation : elle se rétablit dans les réglages du navigateur ou de l’appareil (autorisations du site), puis en revenant sur cet écran.
            </Alerte>
          ) : null}
          {appareil === 'a_activer' || appareil === 'a_reactiver' ? (
            <div className="space-y-3">
              {appareil === 'a_reactiver' ? (
                <Alerte ton="attention" data-testid="poussees-a-reactiver">
                  {capacites?.cleServiceDifferente
                    ? 'Les clés du service de notifications ont été renouvelées : l’abonnement de cet appareil ne reçoit plus rien tant qu’il n’est pas réactivé.'
                    : capacites?.renouvellement
                    ? 'Le navigateur a renouvelé ou perdu l’abonnement de cet appareil, et Comtaple n’a pas pu enregistrer le nouveau (session fermée, appareil hors connexion ou réabonnement impossible) : aucune notification ne lui est adressée tant qu’il n’est pas réactivé.'
                    : 'Ce navigateur détient un abonnement que Comtaple ne connaît pas pour ce compte (abonnement renouvelé par le navigateur, retiré après une longue inactivité ou une désactivation du compte, ou autre compte utilisé ici) : aucune notification ne lui est adressée tant qu’il n’est pas réactivé.'}
                </Alerte>
              ) : null}
              {explication}
              <div className="flex flex-wrap gap-3">
                <Bouton onClick={() => void activer()} disabled={occupe || appel.occupe} data-testid="activer-poussees">
                  {appareil === 'a_reactiver' ? 'Réactiver sur cet appareil' : 'Activer sur cet appareil'}
                </Bouton>
                {appareil === 'a_reactiver' ? (
                  <Bouton variante="contour" onClick={() => void desactiver()} disabled={occupe || appel.occupe}>
                    Désactiver sur cet appareil
                  </Bouton>
                ) : null}
              </div>
              <p className="text-sm text-texte-doux">Votre navigateur vous demandera alors son autorisation. Rien n’est demandé ni activé avant ce geste.</p>
            </div>
          ) : null}
          {appareil === 'abonne' ? (
            <div className="space-y-3">
              <p data-testid="poussees-abonne">
                <Etiquette ton="succes">Activées sur cet appareil</Etiquette>
              </p>
              {explication}
              <Bouton variante="contour" onClick={() => void desactiver()} disabled={occupe || appel.occupe} data-testid="desactiver-poussees">
                Désactiver sur cet appareil
              </Bouton>
            </div>
          ) : null}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              autoComplete="off"
              checked={etat.preference.active}
              disabled={appel.occupe}
              data-testid="preference-poussees"
              onChange={(e) => void appel.executer('v1/notifications/poussees/preference', { method: 'PUT', json: { active: e.target.checked } }, e.target.checked ? 'Notifications poussées rétablies pour vos appareils abonnés.' : 'Notifications poussées coupées : vos appareils restent abonnés, plus rien ne leur est adressé.')}
            />
            <span>Adresser des notifications poussées à mes appareils abonnés</span>
          </label>
        </>
      )}
      {etat.appareils.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-medium">Mes appareils abonnés</h3>
          <ul className="space-y-2" data-testid="appareils-poussees">
            {etat.appareils.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3" data-appareil={a.id}>
                <span>
                  {a.agent}
                  {capacites?.empreinteLocale === a.empreinte ? ' (cet appareil)' : ''} — {a.libelleService}, abonné le {formaterHorodatage(a.creeLe)}
                  {a.dernierEnvoiAccepteLe ? `, dernier envoi accepté par le service le ${formaterHorodatage(a.dernierEnvoiAccepteLe)}` : ', aucun envoi à ce jour'}
                </span>
                <Bouton variante="contour" onClick={() => void retirer(a.id)} disabled={occupe || appel.occupe}>
                  Retirer
                </Bouton>
              </li>
            ))}
          </ul>
          <p className="text-sm text-texte-doux">« Envoi accepté par le service » ne prouve pas l’affichage sur l’appareil.</p>
        </div>
      ) : etat.activees ? (
        <p className="text-texte-doux" data-testid="aucun-appareil-poussees">
          Aucun appareil abonné.
        </p>
      ) : null}
      <Retours erreur={erreur ?? appel.erreur} succes={succes ?? appel.succes} />
    </section>
  );
}
