import { Alerte, Etiquette } from '@/components/ui/base';
import { LIBELLE_MODE, type MasqueRelecture, type ModeEchange, type PerimetrePortefeuille, type ReponsePortefeuilleAssistant, lienCitationPortefeuille } from '@/lib/assistant';
import { formaterDate } from '@/lib/montants';
import { ListeSegments, VerificationsReponse } from './affichage';

/**
 * Réponse de l'assistant sur un PORTEFEUILLE : mêmes garanties d'affichage que pour un dossier (mode, segments typés,
 * citations, points écartés, confiance), plus le périmètre et la période DOSSIER PAR DOSSIER, les données manquantes de
 * chacun, les dossiers écartés et — à la relecture — ce qui a été masqué depuis. Tout texte est rendu en texte brut.
 */
export function ReponsePortefeuilleStructuree({ mode, perimetre, reponse, masque }: { mode: ModeEchange; perimetre: PerimetrePortefeuille; reponse: ReponsePortefeuilleAssistant; masque?: MasqueRelecture | null }) {
  const nomDe = new Map(perimetre.dossiers.map((d) => [d.id, d.nom]));
  return (
    <div className="space-y-3" data-testid="reponse-portefeuille" data-mode={mode} data-statut={reponse.statut}>
      <p className="flex flex-wrap items-center gap-2">
        <Etiquette ton={mode === 'ia' ? 'info' : 'attention'} className="whitespace-normal" data-testid="mode-reponse">
          {LIBELLE_MODE[mode]}
        </Etiquette>
        <span className="text-sm break-words" data-testid="etiquette-reponse">
          {mode === 'simulateur' ? 'Réponse programmée du simulateur de test : ce n’est pas la réponse d’un modèle réel.' : reponse.etiquette}
        </span>
      </p>

      {masque ? (
        <Alerte ton="attention" data-testid="echange-masque">
          {masque.dossiers} dossier{masque.dossiers > 1 ? 's' : ''} de cet échange {masque.dossiers > 1 ? 'ne sont' : 'n’est'} plus dans votre périmètre : {masque.dossiers > 1 ? 'leurs' : 'ses'} éléments ne sont plus affichés.
          {masque.redactionRetiree ? ' La rédaction du modèle, établie avec ce périmètre, a été retirée ; restent les sources encore autorisées.' : ''}
        </Alerte>
      ) : null}

      <section aria-label="Périmètre et période analysés" className="space-y-1" data-testid="perimetre-portefeuille">
        <p className="font-medium">
          Périmètre analysé : {perimetre.dossiers.length} dossier{perimetre.dossiers.length > 1 ? 's' : ''}
          {perimetre.periodeCommune ? ` — période commune demandée : du ${formaterDate(perimetre.periodeCommune.debut)} au ${formaterDate(perimetre.periodeCommune.fin)}` : ''}
        </p>
        <ul className="space-y-1 text-sm">
          {perimetre.dossiers.map((d) => (
            <li key={d.id} className="rounded-lg border border-bordure p-2 break-words" data-dossier-interroge={d.id}>
              <span className="font-medium">{d.nom}</span> —{' '}
              {d.periode ? (
                <span data-testid="periode-dossier">
                  période analysée : du {formaterDate(d.periode.debut)} au {formaterDate(d.periode.fin)}
                </span>
              ) : (
                <span data-testid="periode-dossier">aucune période comptable analysée</span>
              )}{' '}
              · {d.sources} source{d.sources > 1 ? 's' : ''} consultée{d.sources > 1 ? 's' : ''}
              {d.donneesManquantes.length || d.nonRestitues > 0 ? (
                <ul className="mt-1 list-disc pl-5" data-testid="manquantes-dossier">
                  {d.donneesManquantes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                  {d.nonRestitues > 0 ? (
                    <li>
                      {d.nonRestitues} élément{d.nonRestitues > 1 ? 's' : ''} trouvé{d.nonRestitues > 1 ? 's' : ''} non affiché{d.nonRestitues > 1 ? 's' : ''} : une question de portefeuille restitue au plus {perimetre.elementsParDossier} élément
                      {perimetre.elementsParDossier > 1 ? 's' : ''} par dossier ici. Interrogez ce dossier seul pour tout voir.
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {perimetre.dossiers.length === 0 ? <p className="text-sm text-texte-doux">Plus aucun dossier de cet échange n’est dans votre périmètre.</p> : null}
        {perimetre.nonInterroges.length ? (
          <Alerte ton="attention" data-testid="dossiers-non-interroges">
            <p>
              Périmètre réduit : une question porte sur {perimetre.borne} dossiers au plus. {perimetre.nonInterroges.length} dossier{perimetre.nonInterroges.length > 1 ? 's' : ''} autorisé{perimetre.nonInterroges.length > 1 ? 's' : ''} n’
              {perimetre.nonInterroges.length > 1 ? 'ont' : 'a'} pas été interrogé{perimetre.nonInterroges.length > 1 ? 's' : ''} : sélectionnez-{perimetre.nonInterroges.length > 1 ? 'les' : 'le'} pour une autre question.
            </p>
            <p className="break-words text-sm">{perimetre.nonInterroges.map((d) => d.nom).join(' ; ')}</p>
          </Alerte>
        ) : null}
        {perimetre.horsPerimetre.length ? (
          <Alerte ton="neutre" data-testid="dossiers-ecartes">
            {perimetre.horsPerimetre.length} dossier{perimetre.horsPerimetre.length > 1 ? 's' : ''} demandé{perimetre.horsPerimetre.length > 1 ? 's' : ''} hors de votre périmètre : non interrogé{perimetre.horsPerimetre.length > 1 ? 's' : ''}.
          </Alerte>
        ) : null}
      </section>

      {reponse.statut === 'abstention' ? (
        <Alerte ton="neutre" titre="L’assistant s’abstient" data-testid="abstention">
          <p className="break-words">{reponse.motifAbstention ?? 'Aucune réponse fondée sur les sources.'}</p>
        </Alerte>
      ) : null}

      <ListeSegments segments={reponse.segments} lienDe={lienCitationPortefeuille} dossierDe={(c) => (c.dossierId ? (nomDe.get(c.dossierId) ?? null) : null)} />

      {reponse.donneesManquantes.length ? (
        <div data-testid="donnees-manquantes">
          <p className="font-medium">Autres données manquantes</p>
          <ul className="list-disc pl-5 text-sm">
            {reponse.donneesManquantes.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <VerificationsReponse reponse={reponse} />
    </div>
  );
}
