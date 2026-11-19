import Link from 'next/link';
import { Alerte, Etiquette } from '@/components/ui/base';
import {
  type Citation,
  type EtatIa,
  LIBELLE_MODE,
  LIBELLE_NATURE_SOURCE,
  LIBELLE_SEGMENT,
  type ModeEchange,
  type ReponseAssistant,
  libelleMotifEcart,
  libelleRefus,
  lienCitation,
} from '@/lib/assistant';
import { formaterDate } from '@/lib/montants';

/** Bandeau d'état PERMANENT : le texte vient du statut réel de la passerelle (API), jamais d'un réglage d'affichage. */
export function BandeauEtatIa({ etat }: { etat: EtatIa | null }) {
  if (!etat) {
    return (
      <Alerte ton="attention" data-testid="etat-ia" data-statut-ia="inconnu">
        L’état de l’IA n’a pas pu être lu : considérez qu’aucune IA n’est connectée. Les réponses sont des résultats de recherche et des calculs du moteur.
      </Alerte>
    );
  }
  return (
    <Alerte ton={etat.statut === 'connecte' ? 'info' : 'attention'} data-testid="etat-ia" data-statut-ia={etat.statut}>
      {etat.message}
    </Alerte>
  );
}

const TON_SEGMENT = { fait: 'neutre', calcul: 'info', hypothese: 'attention', interpretation: 'attention' } as const;

function LienCitation({ base, citation }: { base: string; citation: Citation }) {
  const lien = lienCitation(base, citation);
  const nature = <span className="text-texte-doux">{LIBELLE_NATURE_SOURCE[citation.nature]} : </span>;
  const texte = citation.nature === 'source_officielle' ? (citation.reference?.titre ?? citation.libelle) : citation.libelle;
  return (
    <li className="break-words" data-citation={citation.id} data-nature={citation.nature}>
      {nature}
      {lien?.externe ? (
        <a href={lien.href} target="_blank" rel="noopener noreferrer">
          {texte} <span className="sr-only">(source officielle, nouvel onglet)</span>
        </a>
      ) : lien ? (
        <Link href={lien.href} prefetch={false}>
          {texte}
        </Link>
      ) : (
        <span>{texte}</span>
      )}
      {citation.reference?.dateVersion ? <span className="text-texte-doux"> — version du {formaterDate(citation.reference.dateVersion)}</span> : null}
    </li>
  );
}

/**
 * Réponse structurée de l'assistant. Chaque segment porte son type lisible et ses citations ; les textes (extraits de
 * pièces, libellés d'écritures, rédaction d'un modèle) sont rendus en texte brut, jamais interprétés.
 */
export function ReponseStructuree({ base, mode, reponse, nomDossier }: { base: string; mode: ModeEchange; reponse: ReponseAssistant; nomDossier: string }) {
  const p = reponse.perimetre.periode;
  return (
    <div className="space-y-3" data-testid="reponse-assistant" data-mode={mode} data-statut={reponse.statut}>
      <p className="flex flex-wrap items-center gap-2">
        <Etiquette ton={mode === 'ia' ? 'info' : 'attention'} className="whitespace-normal" data-testid="mode-reponse">
          {LIBELLE_MODE[mode]}
        </Etiquette>
        <span className="text-sm break-words" data-testid="etiquette-reponse">
          {mode === 'simulateur' ? 'Réponse programmée du simulateur de test : ce n’est pas la réponse d’un modèle réel.' : reponse.etiquette}
        </span>
      </p>
      <p className="text-sm" data-testid="perimetre-reponse">
        <span className="font-medium">Période analysée :</span> du {formaterDate(p.debut)} au {formaterDate(p.fin)} — <span className="font-medium">périmètre :</span> le dossier « {nomDossier} » seulement.
      </p>

      {reponse.statut === 'abstention' ? (
        <Alerte ton="neutre" titre="L’assistant s’abstient" data-testid="abstention">
          <p className="break-words">{reponse.motifAbstention ?? 'Aucune réponse fondée sur les sources.'}</p>
        </Alerte>
      ) : null}

      {reponse.segments.length ? (
        <ol className="space-y-2" aria-label="Éléments de réponse">
          {reponse.segments.map((s, i) => (
            <li key={i} className="space-y-1 rounded-lg border border-bordure bg-surface p-3" data-segment={s.type}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={TON_SEGMENT[s.type]}>{LIBELLE_SEGMENT[s.type]}</Etiquette>
                {s.reglementaire ? <Etiquette ton="info">Référence réglementaire</Etiquette> : null}
              </p>
              <p className="break-words whitespace-pre-wrap">{s.texte}</p>
              {s.citations.length ? (
                <ul className="space-y-0.5 text-sm" aria-label="Sources citées">
                  {s.citations.map((c) => (
                    <LienCitation key={c.id} base={base} citation={c} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-texte-doux">Sans source citée : texte proposé, à vérifier.</p>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {reponse.donneesManquantes.length ? (
        <div data-testid="donnees-manquantes">
          <p className="font-medium">Données manquantes</p>
          <ul className="list-disc pl-5 text-sm">
            {reponse.donneesManquantes.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reponse.pointsEcartes.length ? (
        <div data-testid="points-ecartes">
          <p className="font-medium">Points écartés par les vérifications ({reponse.pointsEcartes.length})</p>
          <ul className="list-disc pl-5 text-sm">
            {reponse.pointsEcartes.map((x, i) => (
              <li key={i}>
                {LIBELLE_SEGMENT[x.type]} n° {x.index + 1} : {libelleMotifEcart(x.motif)} — le texte écarté n’est pas affiché.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reponse.refus.length ? (
        <div data-testid="refus-fonctions">
          <p className="font-medium">Demandes du modèle refusées ({reponse.refus.length})</p>
          <ul className="list-disc pl-5 text-sm">
            {reponse.refus.map((x, i) => (
              <li key={i} className="break-words">
                <span className="font-mono">{x.fonction}</span> : {libelleRefus(x.code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-sm text-texte-doux" data-testid="confiance">
        Confiance non évaluée — {reponse.confiance.mention}
      </p>
    </div>
  );
}
