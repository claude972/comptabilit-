'use client';

import Link from 'next/link';
import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { type FicheDossier, TERRITOIRES, controlesFiscauxRealises, niveauxPermis, sirenPlausible } from '@/lib/administration';
import { LIBELLE_NIVEAU } from '@/lib/libelles';
import type { Niveau } from '@/lib/types-api';

interface ChampsDossier {
  raisonSociale: string;
  siren: string;
  formeJuridique: string;
  regimeFiscal: string;
  codeNaf: string;
  territoireFiscal: string;
}

/** Création (`POST v1/dossiers`) ou modification (`PATCH v1/dossiers/:id`) d'un dossier. Le territoire fiscal n'est jamais présélectionné. */
export function FormulaireDossier({ dossier }: { dossier?: FicheDossier }) {
  const initial: ChampsDossier = {
    raisonSociale: dossier?.raisonSociale ?? '',
    siren: dossier?.siren ?? '',
    formeJuridique: dossier?.formeJuridique ?? '',
    regimeFiscal: dossier?.regimeFiscal ?? '',
    codeNaf: dossier?.codeNaf ?? '',
    territoireFiscal: dossier?.territoireFiscal ?? '',
  };
  const [f, setF] = useState(initial);
  const [cree, setCree] = useState<{ id: string; raisonSociale: string } | null>(null);
  const appel = useAppel();
  const id = useId();
  const maj = (m: Partial<ChampsDossier>) => setF((v) => ({ ...v, ...m }));
  const territoireChange = !!dossier && f.territoireFiscal !== dossier.territoireFiscal;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const siren = f.siren.replace(/\s/g, '');
    if (!f.raisonSociale.trim()) return appel.setErreur('La raison sociale est obligatoire.');
    if (!f.territoireFiscal) return appel.setErreur('Choisissez le territoire fiscal (« À confirmer » si vous ne le connaissez pas encore).');
    if (siren && !sirenPlausible(siren)) return appel.setErreur('SIREN invalide : 9 chiffres avec une clé de contrôle correcte.');
    if (dossier) {
      const corps: Record<string, string> = {};
      if (f.raisonSociale.trim() !== dossier.raisonSociale) corps.raisonSociale = f.raisonSociale.trim();
      if (siren && siren !== (dossier.siren ?? '')) corps.siren = siren;
      if (f.formeJuridique.trim() !== (dossier.formeJuridique ?? '')) corps.formeJuridique = f.formeJuridique.trim();
      if (f.regimeFiscal.trim() !== (dossier.regimeFiscal ?? '')) corps.regimeFiscal = f.regimeFiscal.trim();
      if (f.codeNaf.trim() !== (dossier.codeNaf ?? '')) corps.codeNaf = f.codeNaf.trim();
      if (territoireChange) corps.territoireFiscal = f.territoireFiscal;
      if (!Object.keys(corps).length) return appel.setErreur('Aucune modification à enregistrer.');
      await appel.executer(`v1/dossiers/${dossier.id}`, { method: 'PATCH', json: corps }, 'Dossier modifié.');
      return;
    }
    const r = await appel.executer<{ id: string; raisonSociale: string }>('v1/dossiers', {
      method: 'POST',
      json: {
        raisonSociale: f.raisonSociale.trim(),
        ...(siren ? { siren } : {}),
        ...(f.formeJuridique.trim() ? { formeJuridique: f.formeJuridique.trim() } : {}),
        ...(f.regimeFiscal.trim() ? { regimeFiscal: f.regimeFiscal.trim() } : {}),
        ...(f.codeNaf.trim() ? { codeNaf: f.codeNaf.trim() } : {}),
        territoireFiscal: f.territoireFiscal,
      },
    });
    if (r) {
      setCree({ id: r.id, raisonSociale: r.raisonSociale });
      setF({ raisonSociale: '', siren: '', formeJuridique: '', regimeFiscal: '', codeNaf: '', territoireFiscal: '' });
    }
  }

  return (
    <form onSubmit={envoyer} className="space-y-3" data-formulaire={dossier ? 'modifier-dossier' : 'creer-dossier'} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Libelle htmlFor={`${id}-rs`}>Raison sociale</Libelle>
          <Saisie id={`${id}-rs`} value={f.raisonSociale} maxLength={200} onChange={(e) => maj({ raisonSociale: e.target.value })} required autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-siren`}>SIREN (facultatif)</Libelle>
          <Saisie id={`${id}-siren`} inputMode="numeric" value={f.siren} maxLength={11} onChange={(e) => maj({ siren: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-forme`}>Forme juridique</Libelle>
          <Saisie id={`${id}-forme`} value={f.formeJuridique} maxLength={50} onChange={(e) => maj({ formeJuridique: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-regime`}>Régime fiscal</Libelle>
          <Saisie id={`${id}-regime`} value={f.regimeFiscal} maxLength={50} onChange={(e) => maj({ regimeFiscal: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-naf`}>Code NAF (facultatif)</Libelle>
          <Saisie id={`${id}-naf`} value={f.codeNaf} maxLength={10} onChange={(e) => maj({ codeNaf: e.target.value })} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-territoire`}>Territoire fiscal (obligatoire)</Libelle>
          <Liste id={`${id}-territoire`} value={f.territoireFiscal} onChange={(e) => maj({ territoireFiscal: e.target.value })} required>
            <option value="">Choisir…</option>
            {TERRITOIRES.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.libelle}
              </option>
            ))}
          </Liste>
        </div>
      </div>
      {f.territoireFiscal && !controlesFiscauxRealises(f.territoireFiscal) ? (
        <Alerte ton="attention" data-testid="avertissement-territoire">
          Hors métropole ou territoire « à confirmer », les contrôles fiscaux ne sont pas réalisés : ils sont signalés comme non réalisés, jamais comme
          conformes.
        </Alerte>
      ) : !f.territoireFiscal ? (
        <p className="text-sm text-texte-doux">Aucun territoire n’est présélectionné. Hors métropole ou « à confirmer », les contrôles fiscaux ne sont pas réalisés.</p>
      ) : null}
      {territoireChange ? (
        <Alerte ton="attention" data-testid="avertissement-changement-territoire">
          Changer de territoire fiscal change les règles applicables : les contrôles déjà exécutés sur ce dossier deviennent obsolètes et devront être
          relancés.
        </Alerte>
      ) : null}
      <Bouton type="submit" disabled={appel.occupe}>
        {dossier ? 'Enregistrer les modifications' : 'Créer le dossier'}
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
      {cree ? (
        <Alerte ton="succes" role="status" titre={`Dossier « ${cree.raisonSociale} » créé`} data-testid="dossier-cree">
          <p>Vous n’êtes pas habilité sur ce dossier tant que vous ne vous êtes pas accordé une habilitation ; cette attribution est journalisée.</p>
          <p className="mt-1">
            <Link href={`/administration/dossiers/${cree.id}`} prefetch={false}>
              Ouvrir la fiche d’administration du dossier
            </Link>
          </p>
        </Alerte>
      ) : null}
    </form>
  );
}

export function OuvrirExercice({ dossierId }: { dossierId: string }) {
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const appel = useAppel();
  const id = useId();
  return (
    <form
      className="space-y-2"
      data-formulaire="ouvrir-exercice"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!debut || !fin) return appel.setErreur('Indiquez les dates de début et de fin.');
        if (debut >= fin) return appel.setErreur('La date de fin doit suivre la date de début.');
        if (await appel.executer(`v1/dossiers/${dossierId}/exercices`, { method: 'POST', json: { debut, fin } }, 'Exercice ouvert.')) {
          setDebut('');
          setFin('');
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Libelle htmlFor={`${id}-debut`}>Début de l’exercice</Libelle>
          <Saisie id={`${id}-debut`} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-fin`}>Fin de l’exercice</Libelle>
          <Saisie id={`${id}-fin`} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
          Ouvrir l’exercice
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Habilitation d'un membre du cabinet sur un dossier : niveaux proposés plafonnés par le rôle (l'API vérifie de son côté). */
export function Habilitation({ dossierId, utilisateurId, nom, role, niveauActuel, soiMeme }: { dossierId: string; utilisateurId: string; nom: string; role: string; niveauActuel: Niveau | null; soiMeme: boolean }) {
  const permis = niveauxPermis(role);
  const [niveau, setNiveau] = useState<string>(niveauActuel ?? '');
  const appel = useAppel();
  const id = useId();
  const chemin = `v1/dossiers/${dossierId}/habilitations/${utilisateurId}`;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Libelle htmlFor={id} className="sr-only">
            Niveau d’habilitation de {nom}
          </Libelle>
          <Liste id={id} value={niveau} onChange={(e) => setNiveau(e.target.value)} className="min-w-44">
            <option value="">Aucune habilitation</option>
            {/* Un niveau en place mais hors plafond reste visible pour pouvoir être corrigé. */}
            {niveauActuel && !permis.includes(niveauActuel) ? <option value={niveauActuel}>{LIBELLE_NIVEAU[niveauActuel]} (hors plafond du rôle)</option> : null}
            {permis.map((n) => (
              <option key={n} value={n}>
                {LIBELLE_NIVEAU[n]}
              </option>
            ))}
          </Liste>
        </div>
        <Bouton
          variante="secondaire"
          disabled={appel.occupe || niveau === (niveauActuel ?? '')}
          aria-label={`Enregistrer l’habilitation de ${nom}`}
          onClick={() =>
            void (niveau
              ? appel.executer(chemin, { method: 'PUT', json: { niveau } }, soiMeme ? 'Habilitation accordée à vous-même : cette attribution est journalisée.' : 'Habilitation enregistrée.')
              : appel.executer(chemin, { method: 'DELETE' }, 'Habilitation retirée.'))
          }
        >
          {niveau ? (niveauActuel ? 'Modifier' : 'Accorder') : 'Retirer'}
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </div>
  );
}

export function TitreSection({ children, id }: { children: string; id: string }) {
  return <SousTitre id={id}>{children}</SousTitre>;
}
