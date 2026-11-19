import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { SourceDeRegle } from '@/components/revision-affichage';
import { Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { LIBELLE_CYCLE } from '@/lib/libelles';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireMoi } from '@/lib/serveur/donnees';
import type { ControleCatalogue } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Catalogue des contrôles' };

/** Valeur de paramètre affichée en texte (les montants éventuels restent des chaînes, sans calcul). */
function texte(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export default async function PageCatalogue() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} retour="/deposer" />;
  const r = await tenter<ControleCatalogue[]>('v1/reference/controles');
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} />;
  return (
    <div className="space-y-4">
      <Titre>Catalogue des contrôles</Titre>
      <p className="text-texte-doux">
        {r.donnees.length} contrôles déterministes. Chacun décrit son objectif, son périmètre, les données nécessaires, sa logique et sa source. Un
        contrôle sans anomalie détectée ne vaut pas validation des comptes.
      </p>
      <ul className="space-y-4">
        {r.donnees.map((c) => {
          const parametres = Object.entries(c.parametresParDefaut ?? {});
          return (
            <li key={c.id}>
              <Carte className="space-y-3" data-controle={c.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <SousTitre>
                    <span className="font-mono">{c.id}</span> — {c.titre}
                  </SousTitre>
                  <Etiquette>Version {c.version}</Etiquette>
                  <Etiquette ton="info">Cycle : {LIBELLE_CYCLE[c.cycle] ?? c.cycle}</Etiquette>
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-[12rem_1fr]">
                  <dt className="font-medium">Objectif</dt>
                  <dd className="break-words">{c.objectif}</dd>
                  <dt className="font-medium">Périmètre</dt>
                  <dd className="break-words">{c.perimetre}</dd>
                  <dt className="font-medium">Données obligatoires</dt>
                  <dd>{c.donneesObligatoires?.length ? c.donneesObligatoires.join(', ') : '—'}</dd>
                  <dt className="font-medium">Logique</dt>
                  <dd className="break-words whitespace-pre-wrap">{c.logique}</dd>
                  <dt className="font-medium">Paramètres par défaut</dt>
                  <dd>
                    {parametres.length ? (
                      <ul>
                        {parametres.map(([nom, valeur]) => (
                          <li key={nom}>
                            <code>{nom}</code> : <span className="break-all">{texte(valeur)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      'Aucun'
                    )}
                  </dd>
                  <dt className="font-medium">Exceptions</dt>
                  <dd className="break-words">{c.exceptions || '—'}</dd>
                  <dt className="font-medium">Résultats attendus</dt>
                  <dd className="break-words">{c.resultatsAttendus}</dd>
                  <dt className="font-medium">Source</dt>
                  <dd>
                    <SourceDeRegle source={c.source} />
                  </dd>
                </dl>
              </Carte>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
