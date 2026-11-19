import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { LienSource } from '@/components/revision-affichage';
import { Alerte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireMoi } from '@/lib/serveur/donnees';
import { type EtatSources, PHRASE_VEILLE, lectureSource, libelleDernierStatut } from '@/lib/veille';

export const metadata: Metadata = { title: 'Veille : sources surveillées' };

export default async function PageSourcesVeille() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (moi.donnees.role === 'client_deposant' || moi.donnees.role === 'client_lecture') return <ErreurAcces statut={403} message="L’état de la veille est réservé aux membres du cabinet." />;
  const r = await tenter<EtatSources>('v1/veille/sources');
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} />;
  const { sources, evolutionsDetecteesNonQualifiees: n } = r.donnees;
  const nonAssurees = sources.filter((s) => !s.veilleAssuree).length;

  return (
    <div className="space-y-4">
      <Titre>Veille : sources surveillées</Titre>
      <Alerte ton="neutre" data-testid="phrase-veille">
        <strong>{PHRASE_VEILLE}</strong> Ces pages officielles sont relues périodiquement pour y détecter un changement. Une détection est ensuite lue et qualifiée par une personne,
        chez l’éditeur, avant d’apparaître dans l’onglet « Veille » des dossiers.
      </Alerte>
      {nonAssurees > 0 ? (
        <Alerte ton="danger" role="alert" titre={`Veille non assurée sur ${nonAssurees} source${nonAssurees > 1 ? 's' : ''} sur ${sources.length}`} data-testid="alerte-non-assuree">
          Une source indisponible ne signifie pas « aucune nouveauté » : tant que sa lecture échoue, aucun changement ne peut y être détecté. Consultez ces sources vous-même.
        </Alerte>
      ) : null}
      <p data-testid="non-qualifiees">
        Évolutions détectées non encore qualifiées par l’éditeur : <strong className="tabular-nums">{n}</strong>
        {n > 0 ? ' — elles ne sont pas encore présentées dans les dossiers.' : '.'}
      </p>
      <SousTitre>Sources ({sources.length})</SousTitre>
      {sources.length === 0 ? <p className="text-texte-doux">Aucune source n’est surveillée : la veille n’est pas assurée.</p> : null}
      <ul className="space-y-3">
        {sources.map((s) => {
          const l = lectureSource(s);
          return (
            <li key={s.id} className="space-y-2 rounded-lg border border-bordure bg-surface p-3" data-source={s.id} data-veille-assuree={s.veilleAssuree}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiquette ton={s.veilleAssuree ? 'succes' : 'danger'} data-testid="etat-veille">
                  {l.titre}
                </Etiquette>
                <span className="font-medium break-words">{s.libelle}</span>
                <span className="text-sm text-texte-doux">{s.emetteur}</span>
              </p>
              <p className="break-words">{l.explication}</p>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-texte-doux">Adresse</dt>
                <dd>
                  <LienSource url={s.url} />
                </dd>
                <dt className="text-texte-doux">Dernier essai</dt>
                <dd data-testid="dernier-essai">
                  {s.dernierEssaiLe ? formaterHorodatage(s.dernierEssaiLe) : 'Jamais'} — {libelleDernierStatut(s.dernierStatut)}
                </dd>
                <dt className="text-texte-doux">Dernière vérification réussie</dt>
                <dd data-testid="dernier-succes">{s.dernierSuccesLe ? formaterHorodatage(s.dernierSuccesLe) : 'Aucune'}</dd>
                {s.dernierDetail ? (
                  <>
                    <dt className="text-texte-doux">Détail</dt>
                    <dd className="break-words" data-testid="detail">{s.dernierDetail}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
