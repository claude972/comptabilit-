import type { Metadata } from 'next';
import Link from 'next/link';
import { CreerCampagne } from '@/components/campagnes/actions';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { type Campagne, LIBELLE_STATUT_CAMPAGNE, LIBELLE_TYPE_CAMPAGNE, PHRASE_ISOLEMENT } from '@/lib/imports';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireMoi } from '@/lib/serveur/donnees';

export const metadata: Metadata = { title: 'Campagnes d’import' };

export default async function PageCampagnes() {
  const [moi, campagnes] = await Promise.all([lireMoi(), tenter<Campagne[]>('v1/campagnes')]);
  if (!campagnes.ok) return <ErreurAcces statut={campagnes.statut} message={campagnes.message} />;
  // L'ouverture d'une campagne est réservée aux collaborateurs du cabinet (l'API refuse les clients et le support).
  const peutCreer = moi.ok && !['client_deposant', 'client_lecture', 'support'].includes(moi.donnees.role);
  return (
    <div className="space-y-4">
      <Titre>Campagnes d’import</Titre>
      <Alerte ton="neutre" data-testid="phrase-isolement">
        Une campagne regroupe l’import de fichiers comptables ou de relevés bancaires pour plusieurs dossiers. <strong>{PHRASE_ISOLEMENT}</strong>
      </Alerte>
      {peutCreer ? (
        <Carte>
          <CreerCampagne />
        </Carte>
      ) : null}
      <section aria-labelledby="titre-campagnes" className="space-y-2">
        <SousTitre id="titre-campagnes">Campagnes du cabinet ({campagnes.donnees.length})</SousTitre>
        {campagnes.donnees.length ? (
          <Tableau legende="Campagnes d’import du cabinet">
            <thead>
              <tr>
                <th scope="col">Campagne</th>
                <th scope="col">Type</th>
                <th scope="col">Statut</th>
                <th scope="col">Ouverte le</th>
              </tr>
            </thead>
            <tbody>
              {campagnes.donnees.map((c) => (
                <tr key={c.id} data-campagne={c.id} data-statut={c.statut}>
                  <th scope="row" className="!bg-transparent font-medium">
                    <Link href={`/campagnes/${c.id}`} prefetch={false} className="break-words">
                      {c.libelle}
                    </Link>
                  </th>
                  <td>{LIBELLE_TYPE_CAMPAGNE[c.type] ?? c.type}</td>
                  <td>
                    <Etiquette ton={c.statut === 'ouverte' ? 'info' : c.statut === 'annulee' ? 'vide' : 'neutre'}>{LIBELLE_STATUT_CAMPAGNE[c.statut] ?? c.statut}</Etiquette>
                  </td>
                  <td className="whitespace-nowrap">{formaterHorodatage(c.creeLe)}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune campagne d’import pour ce cabinet.</p>
        )}
      </section>
    </div>
  );
}
