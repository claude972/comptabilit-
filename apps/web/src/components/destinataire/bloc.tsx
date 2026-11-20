import Link from 'next/link';
import { Alerte, Carte, Etiquette, SousTitre, Tableau } from '@/components/ui/base';
import { CHAMPS_DESTINATAIRE, LIBELLE_CHAMP_DESTINATAIRE, LIBELLE_ETAT_DECISION, LIBELLE_SENS, LIBELLE_SOURCE, type ReponseDestinataire } from '@/lib/destinataire';
import { formaterHorodatage } from '@/lib/montants';
import { FormulaireDestinataire } from './formulaire';

const vide = <span className="text-texte-doux">—</span>;
const valeur = (v: string | null) => (v === null || v === '' ? vide : <span className="font-mono break-all">{v}</span>);

/**
 * Destinataire (acheteur) de la pièce : valeur automatique et valeur humaine côte à côte, valeur retenue, sens relu d'après
 * les identifiants, décisions d'appariement concernées et historique des versions. Le formulaire de correction n'est
 * proposé qu'à partir du niveau « collaboration », sur la version courante.
 */
export function BlocDestinataire({ d, documentId, peutCorriger, lienReanalyse }: { d: ReponseDestinataire; documentId: string; peutCorriger: boolean; lienReanalyse: string | null }) {
  const effets = d.effets;
  const nonLu = !d.lectureAutomatiqueFaite;
  return (
    <Carte className="space-y-4" data-testid="bloc-destinataire">
      <section className="space-y-2" aria-labelledby="titre-destinataire">
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre id="titre-destinataire">Destinataire de la pièce (acheteur)</SousTitre>
          {d.extractionCourante ? <span className="text-sm text-texte-doux">Version {d.extractionCourante.version} de l’extraction</span> : null}
        </div>
        {nonLu ? (
          <Alerte ton="attention" data-testid="destinataire-non-lu">
            La lecture automatique du destinataire n’a pas été faite pour cette pièce (extraction antérieure à cette fonction). Un réviseur peut{' '}
            {lienReanalyse ? (
              <Link href={lienReanalyse} prefetch={false}>
                demander une réanalyse explicite
              </Link>
            ) : (
              'demander une réanalyse explicite'
            )}
            , ou vous pouvez saisir le destinataire à la main ci-dessous.
          </Alerte>
        ) : d.abstention ? (
          <Alerte ton="neutre" data-testid="destinataire-abstention">
            <strong>Aucun destinataire retenu.</strong> {d.abstention}
          </Alerte>
        ) : null}
        <Tableau legende="Destinataire : valeur automatique, valeur humaine et valeur retenue">
          <thead>
            <tr>
              <th scope="col">Champ</th>
              <th scope="col">Valeur automatique</th>
              <th scope="col">Valeur humaine</th>
              <th scope="col">Valeur retenue</th>
              <th scope="col">Origine</th>
            </tr>
          </thead>
          <tbody>
            {CHAMPS_DESTINATAIRE.map((c) => {
              const l = d.lignes.find((x) => x.champ === c);
              return (
                <tr key={c} data-champ={c}>
                  <th scope="row">{LIBELLE_CHAMP_DESTINATAIRE[c]}</th>
                  <td data-colonne="automatique">{l?.source === 'non_lu' ? <span className="text-texte-doux">non lu</span> : valeur(l?.automatique ?? null)}</td>
                  <td data-colonne="humaine">{valeur(l?.humain ?? null)}</td>
                  <td data-colonne="retenue" className="font-semibold">
                    {valeur(l?.effective ?? null)}
                  </td>
                  <td>
                    {l ? <Etiquette ton={l.source === 'humain' ? 'info' : 'neutre'}>{LIBELLE_SOURCE[l.source]}</Etiquette> : null}
                    {l?.desaccord ? (
                      <p className="mt-1 text-sm" data-testid={`desaccord-${c}`}>
                        <Etiquette ton="attention">Désaccord</Etiquette> la lecture automatique diffère de la saisie humaine (qui prime).
                      </p>
                    ) : null}
                    {l?.source === 'humain' ? (
                      <p className="mt-1 text-sm text-texte-doux">
                        Par {l.corrigeParNom ?? 'une personne du cabinet'}
                        {l.corrigeLe ? `, le ${formaterHorodatage(l.corrigeLe)}` : ''}. Motif : {l.motif ?? '—'}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Tableau>
      </section>

      {effets ? (
        <section className="space-y-2" aria-labelledby="titre-sens" data-testid="sens-destinataire">
          <SousTitre id="titre-sens" className="text-base">
            Sens de la pièce relu d’après les identifiants : {LIBELLE_SENS[effets.sensLu.sens]}
          </SousTitre>
          <p className="text-sm">{effets.sensLu.motif}</p>
          <p className="text-sm text-texte-doux">{effets.appariement}</p>
          {effets.signalements.map((s) => (
            <Alerte key={s} ton="attention" role="note" data-testid="signalement-destinataire">
              {s}
            </Alerte>
          ))}
          {effets.decisions.length ? (
            <div>
              <p className="text-sm font-medium">Décisions humaines d’appariement sur cette pièce</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {effets.decisions.map((x) => (
                  <li key={`${x.type}-${x.cible}`} data-etat-decision={x.etat}>
                    {x.type === 'comptabilisation' ? 'Comptabilisation' : 'Imputation'} {x.decision === 'confirme' ? 'confirmée' : 'infirmée'} (écriture <span className="font-mono break-all">{x.cible}</span>, version {x.versionExtraction ?? '—'}) —{' '}
                    {LIBELLE_ETAT_DECISION[x.etat]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {d.original ? (
        <p className="text-sm text-texte-doux" data-testid="original-inchange">
          {d.original.inchange} Empreinte SHA-256 de l’original : <span className="font-mono break-all">{d.original.sha256}</span>
        </p>
      ) : null}

      {peutCorriger ? <FormulaireDestinataire documentId={documentId} version={d.extractionCourante?.version ?? 0} lignes={d.lignes} /> : null}

      <details className="text-sm" data-testid="historique-destinataire">
        <summary className="cursor-pointer font-medium">Historique du destinataire ({d.historique.length} version{d.historique.length > 1 ? 's' : ''} de l’extraction)</summary>
        <ol className="mt-2 space-y-3">
          {[...d.historique].reverse().map((v) => (
            <li key={v.id} className="rounded-lg border border-bordure p-3">
              <p className="font-medium">
                Version {v.version} {v.actuelle ? <Etiquette ton="info">en vigueur</Etiquette> : null} — {formaterHorodatage(v.creeLe)}
              </p>
              <p className="text-texte-doux">
                {v.methode === 'saisie_humaine' ? 'Saisie humaine' : `Lecture ${v.methode}`}
                {v.versionAnalyseur ? ` · analyseur ${v.versionAnalyseur}` : ''} · {v.statut === 'valide' ? 'validée' : 'projet'}
                {v.lectureAutomatiqueFaite ? '' : ' · lecture automatique du destinataire non faite'}
              </p>
              <ul className="mt-1 space-y-0.5">
                {v.lignes
                  .filter((l) => l.effective !== null || l.source === 'humain')
                  .map((l) => (
                    <li key={l.champ}>
                      {LIBELLE_CHAMP_DESTINATAIRE[l.champ]} : <span className="font-mono break-all">{l.effective ?? '(sans valeur)'}</span> — {LIBELLE_SOURCE[l.source].toLowerCase()}
                      {l.source === 'humain' ? ` par ${l.corrigeParNom ?? 'une personne du cabinet'}, motif : ${l.motif ?? '—'}${l.automatique !== null ? ` (automatique : ${l.automatique})` : ''}` : ''}
                    </li>
                  ))}
                {v.abstention ? <li>Abstention : {v.abstention}</li> : null}
              </ul>
            </li>
          ))}
        </ol>
        {d.reanalyses.length ? (
          <p className="mt-2 text-texte-doux">
            Réanalyses de cette pièce :{' '}
            {d.reanalyses.map((r) => `${r.execution ? 'exécution' : 'simulation'} (${r.resultat ?? 'en attente'})`).join(', ')}.
          </p>
        ) : null}
      </details>
    </Carte>
  );
}
