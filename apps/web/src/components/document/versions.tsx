import Link from 'next/link';
import { EtiquetteStatutDocument } from '@/components/document/affichage';
import { Alerte, Etiquette, SousTitre } from '@/components/ui/base';
import { cn } from '@/lib/cn';
import { formaterHorodatage } from '@/lib/montants';
import type { VersionDocument } from '@/lib/types-api';
import { versionRemplacante } from '@/lib/versions';

/**
 * Chaîne des versions d'une pièce : toutes sont conservées et consultables. La version affichée est mise en évidence
 * (et annoncée par `aria-current`) ; les autres sont des liens.
 */
export function BlocVersions({ versions, courantId, lien }: { versions: VersionDocument[]; courantId: string; lien: (id: string) => string }) {
  return (
    <section className="space-y-2" aria-labelledby="titre-versions" data-testid="versions">
      <SousTitre id="titre-versions" className="text-base">
        Versions ({versions.length})
      </SousTitre>
      <ol className="space-y-1">
        {versions.map((v) => {
          const affichee = v.id === courantId;
          return (
            <li
              key={v.id}
              data-version={v.version}
              data-statut={v.statut}
              aria-current={affichee ? 'true' : undefined}
              className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-bordure px-3 py-2 text-sm', affichee && 'border-2 border-primaire bg-surface-2 font-medium')}
            >
              {affichee ? (
                <span>Version {v.version}</span>
              ) : (
                <Link href={lien(v.id)} prefetch={false} className="inline-flex min-h-11 items-center">
                  Version {v.version}
                </Link>
              )}
              <EtiquetteStatutDocument statut={v.statut} />
              <span className="text-texte-doux">{formaterHorodatage(v.creeLe)}</span>
              {affichee ? <Etiquette ton="info">Version affichée</Etiquette> : null}
            </li>
          );
        })}
      </ol>
      {versions.length > 1 ? <p className="text-sm text-texte-doux">Chaque version et son fichier d’origine sont conservés.</p> : null}
    </section>
  );
}

/** Bandeau d'une version remplacée : très visible, avec le lien vers la version qui la remplace. */
export function BandeauRemplacee({ versions, remplacePar, lien }: { versions: VersionDocument[]; remplacePar: string | null; lien: (id: string) => string }) {
  const suivante = versionRemplacante(versions, remplacePar);
  return (
    <Alerte ton="attention" role="status" className="border-2 border-attention-texte" data-testid="version-remplacee">
      <p className="text-lg font-semibold">
        Cette version a été remplacée{suivante ? ` par la version ${suivante.version}` : ''} — elle est conservée pour mémoire
      </p>
      <p>
        Aucune correction ni validation n’est possible sur cette version : le travail se poursuit sur la version la plus récente.{' '}
        {remplacePar ? (
          <Link href={lien(remplacePar)} prefetch={false} className="font-semibold">
            {suivante ? `Ouvrir la version ${suivante.version}` : 'Ouvrir la version qui la remplace'}
          </Link>
        ) : null}
      </p>
    </Alerte>
  );
}
