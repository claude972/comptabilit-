import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { SourceDeRegle } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, SousTitre, Titre } from '@/components/ui/base';
import { type DefinitionIndicateur, LIBELLE_FAMILLE, ORDRE_FAMILLES, PHRASE_SIGNAUX } from '@/lib/analyse';
import { tenter } from '@/lib/serveur/api';
import { estDeposant, lireMoi } from '@/lib/serveur/donnees';

export const metadata: Metadata = { title: 'Catalogue des indicateurs' };
const UNITE: Record<string, string> = { euros: 'euros', jours: 'jours', pourcentage: 'pourcentage', ratio: 'ratio' };

export default async function PageCatalogueIndicateurs() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} retour="/deposer" />;
  const r = await tenter<DefinitionIndicateur[]>('v1/reference/indicateurs');
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} />;
  return (
    <div className="space-y-4">
      <Titre>Catalogue des indicateurs</Titre>
      <p className="text-texte-doux">{r.donnees.length} indicateurs calculés par le moteur. Aide à la revue : ni diagnostic, ni validation des comptes.</p>
      {ORDRE_FAMILLES.map((famille) => {
        const liste = r.donnees.filter((d) => d.famille === famille);
        if (!liste.length) return null;
        return (
          <section key={famille} className="space-y-3" aria-labelledby={`cat-${famille}`}>
            <SousTitre id={`cat-${famille}`}>{LIBELLE_FAMILLE[famille]}</SousTitre>
            {famille === 'signal' ? <Alerte ton="attention">{PHRASE_SIGNAUX}</Alerte> : null}
            <ul className="space-y-3">
              {liste.map((d) => (
                <li key={d.id}>
                  <Carte className="space-y-2" data-definition={d.id}>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words">{d.libelle}</span>
                      <Etiquette>
                        <span className="font-mono">{d.id}</span> · v{d.version}
                      </Etiquette>
                      <Etiquette ton="info">Unité : {UNITE[d.unite] ?? d.unite}</Etiquette>
                    </p>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-[14rem_1fr]">
                      <dt className="font-medium">Formule</dt>
                      <dd className="break-words">{d.formule}</dd>
                      <dt className="font-medium">Convention</dt>
                      <dd className="break-words">{d.convention}</dd>
                      <dt className="font-medium">Données utilisées</dt>
                      <dd>{d.entrees?.join(', ') || '—'}</dd>
                      <dt className="font-medium">Si une donnée manque</dt>
                      <dd className="break-words">{d.regleDonneeManquante}</dd>
                      <dt className="font-medium">Source</dt>
                      <dd>
                        <SourceDeRegle source={d.source} />
                      </dd>
                    </dl>
                  </Carte>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
