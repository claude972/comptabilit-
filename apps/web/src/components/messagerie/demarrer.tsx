'use client';

import { useId, useState } from 'react';
import { messageErreur } from '@/components/appel';
import { Alerte, Carte, Libelle, Saisie, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { cn } from '@/lib/cn';
import { type EtatConnecteur, type Fournisseur, LIBELLE_FOURNISSEUR } from '@/lib/messagerie';
import { ErreurHttp } from '@/lib/televersement/moteur';
import { appelBff } from '@/lib/televersement/transport-bff';
import { ConnecteurNonConfigure } from './commun';

const FOURNISSEURS: Fournisseur[] = ['gmail', 'microsoft'];

/** Démarrage d'une connexion : choix du fournisseur, puis écran d'explication AVANT de partir chez le fournisseur. */
export function DemarrerConnexion({ connecteurs, dateParDefaut }: { connecteurs: Record<Fournisseur, EtatConnecteur>; dateParDefaut: string }) {
  const [fournisseur, setFournisseur] = useState<Fournisseur | ''>('');
  const [partagee, setPartagee] = useState(false);
  const [adresse, setAdresse] = useState('');
  const [dateDebut, setDateDebut] = useState(dateParDefaut);
  const [etape, setEtape] = useState<1 | 2>(1);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nonConfigure, setNonConfigure] = useState<string | null>(null);
  const id = useId();
  const boitePartagee = fournisseur === 'microsoft' && partagee;
  const adresseValide = /^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(adresse.trim());
  const configure = fournisseur !== '' && connecteurs[fournisseur].configure && !nonConfigure;

  async function partir() {
    if (fournisseur === '') return;
    setOccupe(true);
    setErreur(null);
    try {
      const r = await appelBff<{ urlAutorisation: string }>('v1/mail/connexions', {
        method: 'POST',
        json: {
          fournisseur,
          ...(boitePartagee ? { boitePartagee: adresse.trim().toLowerCase() } : {}),
          // La date n'est transmise que si elle a été modifiée : sinon l'API applique ses 30 jours par défaut.
          ...(dateDebut && dateDebut !== dateParDefaut ? { configuration: { dateDebut: `${dateDebut}T00:00:00Z` } } : {}),
        },
      });
      const url = new URL(r.urlAutorisation);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('adresse inattendue');
      window.location.assign(url.href);
    } catch (e) {
      const code = e instanceof ErreurHttp ? (e.corps as { code?: unknown } | null)?.code : undefined;
      if (e instanceof ErreurHttp && e.statut === 503 && code === 'connecteur_non_configure') {
        setNonConfigure(e.message);
        setEtape(1);
      } else setErreur(e instanceof ErreurHttp ? messageErreur(e) : 'La demande de connexion n’a pas pu être préparée. Réessayez.');
      setOccupe(false);
    }
  }

  if (etape === 2 && fournisseur !== '') {
    const nom = LIBELLE_FOURNISSEUR[fournisseur];
    return (
      <Carte className="space-y-3" data-testid="explication-consentement">
        <SousTitre>Avant de continuer vers {nom}</SousTitre>
        <p>
          Vous allez quitter Comtaple pour la page d’autorisation de {nom}. Voici ce qui vous y sera demandé, et ce que cela signifie.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Lecture seule</strong> de la messagerie {boitePartagee ? <>— y compris les boîtes partagées auxquelles vous avez accès, dont <span className="break-all">{adresse.trim()}</span></> : null}.
          </li>
          <li>
            <strong>Aucun envoi, aucune modification, aucune suppression</strong> de message : Comtaple ne demande pas ces permissions.
          </li>
          <li>
            Techniquement, l’autorisation porte sur <strong>toute la boîte en lecture</strong> : le fournisseur ne propose pas de permission limitée à
            un dossier ou aux seules pièces jointes.
          </li>
          <li>
            Comtaple ne lit ensuite que ce que vous configurez (dossiers ou libellés, expéditeurs, date de début). Ces filtres sont appliqués par le
            logiciel : ils ne réduisent pas l’autorisation accordée.
          </li>
          <li>Vous pourrez déconnecter la boîte à tout moment : les jetons sont alors supprimés.</li>
        </ul>
        {boitePartagee ? (
          <Alerte ton="attention">
            Boîte partagée : {nom} vous demandera un <strong>consentement supplémentaire</strong> (lecture des boîtes partagées). Il n’y a pas de
            notifications pour une boîte partagée : la synchronisation est périodique.
          </Alerte>
        ) : null}
        {erreur ? (
          <Alerte ton="danger" role="alert">
            {erreur}
          </Alerte>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Bouton variante="contour" onClick={() => setEtape(1)} disabled={occupe}>
            Retour
          </Bouton>
          <Bouton onClick={() => void partir()} disabled={occupe}>
            Continuer vers {nom}
          </Bouton>
        </div>
      </Carte>
    );
  }

  return (
    <Carte className="space-y-4">
      <fieldset>
        <legend className="mb-1 font-medium">Fournisseur de messagerie</legend>
        <div className="flex flex-wrap gap-2">
          {FOURNISSEURS.map((f) => (
            <label key={f} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-bordure px-3', fournisseur === f && 'border-primaire bg-surface-2')}>
              <input
                type="radio"
                name={`${id}-fournisseur`}
                value={f}
                checked={fournisseur === f}
                onChange={() => {
                  setFournisseur(f);
                  setNonConfigure(null);
                }}
                className="size-5"
              />
              {LIBELLE_FOURNISSEUR[f]}
            </label>
          ))}
        </div>
      </fieldset>

      {fournisseur === 'microsoft' ? (
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={partagee} onChange={(e) => setPartagee(e.target.checked)} className="size-5" /> Il s’agit d’une boîte partagée
          </label>
          {partagee ? (
            <>
              <div className="max-w-md">
                <Libelle htmlFor={`${id}-adresse`}>Adresse de la boîte partagée</Libelle>
                <Saisie id={`${id}-adresse`} type="email" value={adresse} maxLength={320} onChange={(e) => setAdresse(e.target.value)} autoComplete="off" />
              </div>
              <Alerte ton="attention" data-testid="avertissement-partagee">
                Une boîte partagée demande un <strong>consentement supplémentaire</strong> chez Microsoft (lecture des boîtes partagées). Il n’y a
                <strong> pas de notifications</strong> pour ces boîtes : la synchronisation est périodique.
              </Alerte>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="max-w-xs">
        <Libelle htmlFor={`${id}-date`}>Récupérer les messages reçus à partir du</Libelle>
        <Saisie id={`${id}-date`} type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
        <p className="mt-1 text-sm text-texte-doux">Par défaut : 30 jours avant la connexion.</p>
      </div>

      {fournisseur !== '' && !configure ? (
        <ConnecteurNonConfigure fournisseur={LIBELLE_FOURNISSEUR[fournisseur]} detail={nonConfigure ?? connecteurs[fournisseur].detail} />
      ) : (
        <Bouton onClick={() => setEtape(2)} disabled={fournisseur === '' || (boitePartagee && !adresseValide)}>
          Continuer
        </Bouton>
      )}
      <p className="text-sm text-texte-doux">Rien n’est demandé au fournisseur à cette étape : l’écran suivant détaille l’autorisation qui sera sollicitée.</p>
    </Carte>
  );
}
