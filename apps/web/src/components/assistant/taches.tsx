'use client';

import { useState } from 'react';
import { messageErreur } from '@/components/appel';
import { Alerte, Etiquette, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_ORIGINE, type ReponseClassement, type ReponseExplication, type ReponseTacheIa } from '@/lib/assistant';
import { appelBff } from '@/lib/televersement/transport-bff';

/** Appel d'une tâche IA : la page n'est PAS rechargée, car une proposition ne modifie rien. */
function useTache<T>() {
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<T | null>(null);
  const demander = async (chemin: string) => {
    setOccupe(true);
    setErreur(null);
    try {
      setResultat(await appelBff<T>(chemin, { method: 'POST' }));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  };
  return { occupe, erreur, resultat, demander };
}

function Origine({ r }: { r: ReponseTacheIa<unknown> }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-2">
        <Etiquette ton={r.origine === 'ia' ? 'info' : 'attention'} className="whitespace-normal" data-testid="origine-proposition">
          {LIBELLE_ORIGINE[r.origine]}
        </Etiquette>
        <Etiquette ton="vide" className="whitespace-normal">
          Confiance non évaluée
        </Etiquette>
      </p>
      <p className="text-sm break-words" data-testid="etiquette-proposition">
        {r.etiquette}
      </p>
      <p className="text-sm text-texte-doux" data-testid="etat-ia-tache">
        {r.ia.message}
      </p>
    </>
  );
}

/** « Proposer un classement » : affiche la proposition, ses preuves et son origine. La pièce n'est pas modifiée. */
export function PropositionClassement({ documentId }: { documentId: string }) {
  const t = useTache<ReponseClassement>();
  const r = t.resultat;
  return (
    <div className="space-y-3" data-bloc="proposition-classement">
      <SousTitre>Proposition de classement</SousTitre>
      <p className="text-sm text-texte-doux">Une proposition ne change rien à la pièce : la nature et l’exercice se choisissent dans le formulaire de qualification.</p>
      <Bouton variante="secondaire" disabled={t.occupe} onClick={() => t.demander(`v1/documents/${documentId}/proposition-classement`)}>
        {t.occupe ? 'Analyse en cours…' : 'Proposer un classement'}
      </Bouton>
      {t.erreur ? (
        <Alerte ton="danger" role="alert">
          {t.erreur}
        </Alerte>
      ) : null}
      <div aria-live="polite" className="space-y-2" data-testid="resultat-classement">
        {r ? (
          <>
            <Origine r={r} />
            {r.proposition ? (
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className="text-texte-doux">Type proposé</dt>
                <dd data-testid="type-propose">{r.libelles.type ?? r.proposition.type}</dd>
                <dt className="text-texte-doux">Dossier proposé</dt>
                <dd className="break-words" data-testid="dossier-propose">
                  {r.proposition.dossierId === null ? 'À qualifier (aucun rattachement certain)' : `${r.libelles.dossier ?? r.proposition.dossierId}${r.proposition.dossierId === r.pieceActuelle.entiteId ? ' (dossier actuel de la pièce)' : ''}`}
                </dd>
                <dt className="text-texte-doux">Justification</dt>
                <dd className="break-words">{r.proposition.justification}</dd>
                <dt className="text-texte-doux">Preuves (extraits de la pièce)</dt>
                <dd data-testid="preuves-classement">
                  {r.proposition.preuves.length ? (
                    <ul className="list-disc pl-5">
                      {r.proposition.preuves.map((p, i) => (
                        <li key={i} className="break-words">
                          « {p} »
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'Aucun extrait probant.'
                  )}
                </dd>
              </dl>
            ) : (
              <Alerte ton="neutre">{r.motif ?? 'Aucune proposition.'}</Alerte>
            )}
            <p className="text-sm font-medium" data-testid="rien-applique">
              Rien n’a été modifié sur la pièce.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** « Expliquer ce constat » : projet d'explication ; sans IA, le message du moteur, étiqueté comme tel. */
export function ExplicationConstat({ constatId }: { constatId: string }) {
  const t = useTache<ReponseExplication>();
  const r = t.resultat;
  return (
    <div className="space-y-3" data-bloc="explication-constat">
      <SousTitre>En langage courant</SousTitre>
      <Bouton variante="secondaire" disabled={t.occupe} onClick={() => t.demander(`v1/constats/${constatId}/explication`)}>
        {t.occupe ? 'Préparation…' : 'Expliquer ce constat'}
      </Bouton>
      {t.erreur ? (
        <Alerte ton="danger" role="alert">
          {t.erreur}
        </Alerte>
      ) : null}
      <div aria-live="polite" className="space-y-2" data-testid="resultat-explication">
        {r ? (
          <>
            <Origine r={r} />
            {r.proposition ? <p className="break-words whitespace-pre-wrap" data-testid="texte-explication">{r.proposition.explication}</p> : <Alerte ton="neutre">{r.motif ?? 'Aucune explication proposée.'}</Alerte>}
            <p className="text-sm font-medium">Le constat n’a pas été modifié.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── Tâches sans écran dédié : affichage générique, toujours un PROJET ─────────────────────────────

interface ElementLettre {
  rubrique: string;
  contenu: string;
  extrait: string;
}
interface PropositionGenerique {
  commentaire?: string;
  elements?: ElementLettre[];
  rubriquesNonTrouvees?: string[];
  retenues?: Array<{ mouvementIds: string[]; ecritureIds: string[]; explication: string | null }>;
  ecartees?: Array<{ motif: string }>;
}

const LIBELLE_RUBRIQUE_LETTRE: Record<string, string> = {
  perimetre: 'Périmètre',
  duree: 'Durée',
  honoraires: 'Honoraires',
  obligations: 'Obligations des parties',
  livrables: 'Livrables',
  mandats: 'Mandats et limites',
  revision: 'Conditions de révision',
};

/**
 * Bouton d'une tâche IA qui n'a pas d'écran propre (commentaire d'indicateurs, analyse de lettre de mission, suggestions
 * de rapprochement). Affiche l'origine réelle du résultat ; sans IA connectée, dit que la tâche est indisponible (ou
 * montre le repli déterministe quand il existe). Rien n'est jamais appliqué.
 */
export function TacheIa({ chemin, titre, libelleBouton, explication, bloc }: { chemin: string; titre: string; libelleBouton: string; explication: string; bloc: string }) {
  const t = useTache<ReponseTacheIa<PropositionGenerique>>();
  const r = t.resultat;
  const p = r?.proposition ?? null;
  return (
    <div className="space-y-3" data-bloc={bloc}>
      <SousTitre className="text-base">{titre}</SousTitre>
      <p className="text-sm text-texte-doux">{explication}</p>
      <Bouton variante="secondaire" disabled={t.occupe} onClick={() => t.demander(chemin)}>
        {t.occupe ? 'Préparation…' : libelleBouton}
      </Bouton>
      {t.erreur ? (
        <Alerte ton="danger" role="alert">
          {t.erreur}
        </Alerte>
      ) : null}
      <div aria-live="polite" className="space-y-2" data-testid={`resultat-${bloc}`}>
        {r ? (
          <>
            <Origine r={r} />
            {!p ? <Alerte ton="neutre">{r.motif ?? 'Aucune proposition : aucune IA n’est connectée et cette tâche n’a pas de repli sans IA.'}</Alerte> : null}
            {p?.commentaire ? <p className="break-words whitespace-pre-wrap">{p.commentaire}</p> : null}
            {p?.elements ? (
              <dl className="space-y-2">
                {p.elements.map((e, i) => (
                  <div key={i}>
                    <dt className="font-medium">{LIBELLE_RUBRIQUE_LETTRE[e.rubrique] ?? e.rubrique}</dt>
                    <dd className="break-words">
                      {e.contenu}
                      <span className="block text-sm text-texte-doux">Extrait de la lettre : « {e.extrait} »</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {p?.rubriquesNonTrouvees?.length ? <p className="text-sm">Non trouvé dans le texte : {p.rubriquesNonTrouvees.map((x) => LIBELLE_RUBRIQUE_LETTRE[x] ?? x).join(', ')}.</p> : null}
            {p?.retenues ? (
              <p>
                {p.retenues.length} suggestion{p.retenues.length > 1 ? 's' : ''} vérifiée{p.retenues.length > 1 ? 's' : ''} arithmétiquement par le moteur
                {p.ecartees?.length ? `, ${p.ecartees.length} écartée${p.ecartees.length > 1 ? 's' : ''} (ne tombent pas juste)` : ''}.
              </p>
            ) : null}
            {p?.retenues?.length ? (
              <ul className="list-disc pl-5 text-sm">
                {p.retenues.map((x, i) => (
                  <li key={i} className="break-words">
                    {x.mouvementIds.length} mouvement(s) ↔ {x.ecritureIds.length} écriture(s){x.explication ? ` — ${x.explication}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm font-medium">Projet à vérifier : rien n’a été appliqué ni enregistré dans le dossier.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
