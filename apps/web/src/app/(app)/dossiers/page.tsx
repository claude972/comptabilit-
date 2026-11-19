import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { Etiquette, Tableau, Titre } from '@/components/ui/base';
import { LIBELLE_NIVEAU } from '@/lib/libelles';
import { estDeposant, lireDossiers, lireMoi } from '@/lib/serveur/donnees';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Dossiers' };

export default async function PageDossiers() {
  const moi = await lireMoi();
  if (!moi.ok) return <ErreurAcces statut={moi.statut} message={moi.message} />;
  if (estDeposant(moi.donnees.role)) return <ErreurAcces statut={403} retour="/deposer" />;
  const dossiers = await lireDossiers();
  if (!dossiers.ok) return <ErreurAcces statut={dossiers.statut} message={dossiers.message} />;
  return (
    <div className="space-y-4">
      <Titre>Dossiers</Titre>
      <Tableau legende="Dossiers du cabinet et niveau d’habilitation">
        <thead>
          <tr>
            <th scope="col">Dossier</th>
            <th scope="col">Forme</th>
            <th scope="col">Régime fiscal</th>
            <th scope="col">Territoire fiscal</th>
            <th scope="col">Votre habilitation</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.donnees.map((d) => (
            <tr key={d.id} data-dossier={d.id}>
              <th scope="row" className="!bg-transparent font-medium">
                {/* Sans habilitation : le dossier est seulement nommé, sans lien (l'API en refuse le contenu). */}
                {auMoins(d.niveau, 'lecture') ? (
                  <Link href={`/dossiers/${d.id}`} prefetch={false}>
                    {d.raisonSociale}
                  </Link>
                ) : (
                  d.raisonSociale
                )}
              </th>
              <td>{d.formeJuridique ?? '—'}</td>
              <td>{d.regimeFiscal ?? '—'}</td>
              <td>{d.territoireFiscal === 'a_confirmer' ? 'À confirmer' : d.territoireFiscal}</td>
              <td>{d.niveau ? <Etiquette ton="info">{LIBELLE_NIVEAU[d.niveau]}</Etiquette> : <Etiquette ton="vide">Non habilité</Etiquette>}</td>
            </tr>
          ))}
        </tbody>
      </Tableau>
      {dossiers.donnees.length === 0 ? <p className="text-texte-doux">Aucun dossier.</p> : null}
    </div>
  );
}
