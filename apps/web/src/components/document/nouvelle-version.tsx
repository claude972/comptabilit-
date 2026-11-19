'use client';

import { Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { ListeEnvois, useEnvois } from '@/components/envoi-ordinateur';
import { Alerte, Libelle, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import type { VueTerminee } from '@/lib/types-api';
import { type DroitNouvelleVersion, compteRenduVersion } from '@/lib/versions';

/**
 * Dépôt d'une nouvelle version d'une pièce, par le téléversement reprenable habituel (`remplaceDocumentId`).
 * L'explication précède l'envoi ; le compte rendu vient uniquement de la réponse du serveur.
 * Le composant reste monté après l'envoi (la page est alors celle d'une version remplacée) pour que le compte rendu demeure lisible.
 */
export function NouvelleVersion({ documentId, entiteId, canal, lienVersion, droit }: { documentId: string; entiteId: string; canal: 'ordinateur' | 'telephone'; lienVersion: string; droit: DroitNouvelleVersion }) {
  const routeur = useRouter();
  const [resultat, setResultat] = useState<VueTerminee | null>(null);
  const { envois, ajouter, reprendre } = useEnvois((v) => {
    setResultat(v);
    routeur.refresh();
  });
  const [fichier, setFichier] = useState<File | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const id = useId();
  const compteRendu = resultat ? compteRenduVersion(resultat) : null;
  const enCours = envois.some((e) => e.etat === 'en_file' || e.etat === 'envoi');
  if (!droit.possible && !envois.length) {
    return droit.raison ? (
      <p className="text-sm text-texte-doux" data-testid="nouvelle-version-indisponible">
        {droit.raison}
      </p>
    ) : null;
  }
  return (
    <section aria-labelledby={`${id}-titre`} className="space-y-3" data-testid="nouvelle-version">
      <SousTitre id={`${id}-titre`} className="text-base">
        Déposer une nouvelle version
      </SousTitre>
      {droit.possible ? (
        <>
      <Alerte ton="neutre" className="text-sm" id={`${id}-explication`}>
        L’ancienne version et son fichier sont conservés et restent consultables. Si elle avait été validée, cette validation ne vaut pas pour la
        nouvelle version, qui devra être contrôlée à nouveau.
      </Alerte>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!fichier) return;
          setResultat(null);
          ajouter([fichier], (f) => ({ entiteId, nomFichier: f.name.slice(0, 255), ...(f.type ? { typeMime: f.type.slice(0, 100) } : {}), canal, usage: 'piece', remplaceDocumentId: documentId }));
          setFichier(null);
          if (entree.current) entree.current.value = '';
        }}
      >
        <div>
          <Libelle htmlFor={`${id}-fichier`}>Fichier de la nouvelle version</Libelle>
          <input
            ref={entree}
            id={`${id}-fichier`}
            type="file"
            required
            aria-describedby={`${id}-explication`}
            data-testid="entree-nouvelle-version"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            className="block min-h-11 w-full max-w-lg rounded-lg border border-bordure bg-surface p-2"
          />
        </div>
        <Bouton type="submit" variante="secondaire" disabled={!fichier || enCours}>
          <Upload aria-hidden="true" className="size-5" /> Envoyer la nouvelle version
        </Bouton>
      </form>
        </>
      ) : null}
      <div aria-live="polite" className="space-y-2">
        <ListeEnvois envois={envois} surReprise={reprendre} recu={() => 'Fichier reçu par le serveur.'} />
        {compteRendu ? (
          <Alerte ton={compteRendu.ton} titre={compteRendu.titre} data-testid="compte-rendu-version">
            <p>{compteRendu.detail}</p>
            {compteRendu.nouvelle && resultat?.documentId ? (
              <p>
                <Link href={`${lienVersion}${resultat.documentId}`} prefetch={false} className="font-semibold">
                  Ouvrir la version {resultat.nouvelleVersion?.version}
                </Link>
              </p>
            ) : null}
          </Alerte>
        ) : null}
      </div>
    </section>
  );
}
