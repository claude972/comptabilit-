import { Ban, CircleAlert, CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react';
import { Etiquette, type Ton } from '@/components/ui/base';
import { LIBELLE_GRAVITE, LIBELLE_STATUT_CONTROLE, LIBELLE_STATUT_REVUE, LIBELLE_VERIFICATION_SOURCE } from '@/lib/libelles';
import { formaterDate } from '@/lib/montants';
import type { Gravite, SourceRegle, StatutControle, StatutRevue } from '@/lib/types-api';

/**
 * Cinq statuts de contrôle visuellement distincts (icône, couleur, contour et libellé différents).
 * « Non réalisé faute de données » est en pointillés, sans vert : il ne peut pas être confondu avec un succès.
 */
const STATUT_CONTROLE: Record<StatutControle, { ton: Ton; Icone: typeof CircleCheck }> = {
  sans_anomalie: { ton: 'succes', Icone: CircleCheck },
  constat: { ton: 'attention', Icone: TriangleAlert },
  non_applicable: { ton: 'neutre', Icone: Ban },
  non_realise: { ton: 'vide', Icone: CircleDashed },
  erreur: { ton: 'danger', Icone: CircleAlert },
};

export function EtiquetteStatutControle({ statut }: { statut: StatutControle }) {
  const s = STATUT_CONTROLE[statut] ?? STATUT_CONTROLE.erreur;
  return (
    <Etiquette ton={s.ton} data-statut-controle={statut} className="whitespace-normal">
      <s.Icone aria-hidden="true" className="size-4 shrink-0" /> {LIBELLE_STATUT_CONTROLE[statut] ?? statut}
    </Etiquette>
  );
}

const TON_GRAVITE: Record<Gravite, Ton> = { critique: 'danger', elevee: 'danger', moyenne: 'attention', faible: 'neutre' };
export function EtiquetteGravite({ gravite }: { gravite: Gravite }) {
  return <Etiquette ton={TON_GRAVITE[gravite] ?? 'neutre'}>Gravité : {(LIBELLE_GRAVITE[gravite] ?? gravite).toLowerCase()}</Etiquette>;
}

export function EtiquetteStatutRevue({ statut }: { statut: StatutRevue }) {
  const ton: Ton = statut === 'a_examiner' ? 'attention' : statut === 'anomalie_confirmee' ? 'danger' : statut === 'en_cours' || statut === 'piece_demandee' ? 'info' : 'neutre';
  return <Etiquette ton={ton}>{LIBELLE_STATUT_REVUE[statut] ?? statut}</Etiquette>;
}

/** N'affiche un lien que vers une adresse https : une URL d'un autre schéma est rendue en texte. */
export function LienSource({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return /^https:\/\//i.test(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all">
      {url}
    </a>
  ) : (
    <span className="break-all">{url}</span>
  );
}

/** Source d'une règle : type, référence, état de vérification et date. */
export function SourceDeRegle({ source }: { source: SourceRegle | undefined }) {
  if (!source || !source.reference) return <p className="text-texte-doux">Source non renseignée.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="source-regle">
      <dt className="text-texte-doux">Type</dt>
      <dd>{source.type === 'reglementaire' ? 'Règle réglementaire' : source.type === 'interne' ? 'Règle interne (méthode de révision)' : 'Non précisé'}</dd>
      <dt className="text-texte-doux">Référence</dt>
      <dd className="break-words">{source.reference}</dd>
      {source.url ? (
        <>
          <dt className="text-texte-doux">Texte officiel</dt>
          <dd>
            <LienSource url={source.url} />
          </dd>
        </>
      ) : null}
      <dt className="text-texte-doux">Vérification</dt>
      <dd>
        <Etiquette ton={source.verification === 'verifiee' ? 'succes' : source.verification === 'non_verifiee' ? 'attention' : 'neutre'}>
          {LIBELLE_VERIFICATION_SOURCE[source.verification ?? ''] ?? 'Non précisée'}
        </Etiquette>
        {source.dateVerification ? ` le ${formaterDate(source.dateVerification)}` : ''}
      </dd>
      {source.periodeApplication ? (
        <>
          <dt className="text-texte-doux">Période d’application</dt>
          <dd className="break-words">{source.periodeApplication}</dd>
        </>
      ) : null}
    </dl>
  );
}
