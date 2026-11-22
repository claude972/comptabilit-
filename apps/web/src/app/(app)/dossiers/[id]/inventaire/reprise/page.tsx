import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { ReprendreFichier } from '@/components/fiscal/reprise-immobilisations';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { formaterHorodatage } from '@/lib/montants';
import { LIBELLE_ENCODAGE, LIBELLE_SEPARATEUR, LIBELLE_STATUT_RAPPORT, type RapportReprise, type RepriseVue, type StatutRapport, formaterTaille, valeursLuesAffichables } from '@/lib/reprise-immobilisations';
import { tenter } from '@/lib/serveur/api';
import { estUuid, parametre } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Reprise des immobilisations' };

const TON: Record<StatutRapport, Ton> = { creee: 'succes', ignoree_doublon: 'attention', rejetee: 'danger' };
const STATUTS: StatutRapport[] = ['creee', 'ignoree_doublon', 'rejetee'];

function Rapport({ r, entiteId, statut }: { r: RapportReprise; entiteId: string; statut: StatutRapport | undefined }) {
  const p = r.reprise;
  const pages = Math.max(1, Math.ceil(r.total / r.parPage));
  const lien = (s: StatutRapport | undefined, page = 1) => `?rapport=${p.id}${s ? `&statut=${s}` : ''}${page > 1 ? `&page=${page}` : ''}`;
  return (
    <section aria-labelledby="titre-rapport" className="space-y-3" data-testid="rapport-reprise" data-reprise={p.id}>
      <SousTitre id="titre-rapport">Rapport de la reprise</SousTitre>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-texte-doux">Fichier</dt>
        <dd className="break-all">
          {p.nomFichier} ({formaterTaille(p.taille)}, {LIBELLE_ENCODAGE[p.encodage] ?? p.encodage}, séparateur {LIBELLE_SEPARATEUR[p.separateur] ?? p.separateur})
        </dd>
        <dt className="text-texte-doux">Importé par</dt>
        <dd>
          {p.importeurNom ?? 'une personne du cabinet'} le {formaterHorodatage(p.creeLe)}
        </dd>
        <dt className="text-texte-doux">Empreinte SHA-256</dt>
        <dd className="break-all font-mono text-xs">{p.sha256}</dd>
      </dl>
      <ul className="flex flex-wrap gap-2" aria-label="Décomptes de la reprise" data-testid="decomptes-reprise">
        <li>
          <Etiquette ton="succes" data-statut="creee">
            Créées : {p.nbCreees}
          </Etiquette>
        </li>
        <li>
          <Etiquette ton="attention" data-statut="ignoree_doublon">
            Ignorées (doublons) : {p.nbIgnorees}
          </Etiquette>
        </li>
        <li>
          <Etiquette ton="danger" data-statut="rejetee">
            Rejetées : {p.nbRejetees}
          </Etiquette>
        </li>
      </ul>
      <p>
        <a href={`/api/bff/v1/dossiers/${entiteId}/reprises-immobilisations/${p.id}/rapport.csv`} download className="font-medium" data-testid="telecharger-rapport">
          Télécharger le rapport (CSV)
        </a>
      </p>
      <nav aria-label="Filtrer le rapport par statut" className="flex flex-wrap gap-3 text-sm">
        <Link href={lien(undefined)} prefetch={false} aria-current={statut ? undefined : 'true'}>
          Toutes ({p.nbLignes})
        </Link>
        {STATUTS.map((s) => (
          <Link key={s} href={lien(s)} prefetch={false} aria-current={statut === s ? 'true' : undefined}>
            {LIBELLE_STATUT_RAPPORT[s]} ({s === 'creee' ? p.nbCreees : s === 'rejetee' ? p.nbRejetees : p.nbIgnorees})
          </Link>
        ))}
      </nav>
      <Tableau legende="Rapport ligne par ligne de la reprise des immobilisations">
        <thead>
          <tr>
            <th scope="col">Ligne du fichier</th>
            <th scope="col">Statut</th>
            <th scope="col">Motif</th>
            <th scope="col">Valeurs lues</th>
          </tr>
        </thead>
        <tbody>
          {r.lignes.map((l) => (
            <tr key={l.ligne} data-ligne={l.ligne} data-statut={l.statut}>
              <th scope="row" className="!bg-transparent font-normal">
                {l.ligne}
              </th>
              <td>
                <Etiquette ton={TON[l.statut]}>{LIBELLE_STATUT_RAPPORT[l.statut]}</Etiquette>
              </td>
              <td className="break-words">{l.motif ?? '—'}</td>
              <td className="break-words">
                {valeursLuesAffichables(r.champs, l.lues)
                  .map((v) => `${v.libelle} : ${v.valeur}`)
                  .join(' ; ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </Tableau>
      {pages > 1 ? (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          {r.page > 1 ? (
            <Link href={lien(statut, r.page - 1)} prefetch={false}>
              Page précédente
            </Link>
          ) : null}
          <span>
            Page {r.page} sur {pages}
          </span>
          {r.page < pages ? (
            <Link href={lien(statut, r.page + 1)} prefetch={false}>
              Page suivante
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

export default async function PageReprise({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const base = `/dossiers/${id}`;
  const sp = await searchParams;
  const demande = parametre(sp.rapport);
  const statutBrut = parametre(sp.statut);
  const statut = STATUTS.find((s) => s === statutBrut);
  const page = Math.max(1, Number.parseInt(parametre(sp.page) ?? '1', 10) || 1);
  const peutImporter = auMoins(ctx.niveau, 'collaboration');
  const [liste, rapport] = await Promise.all([
    tenter<RepriseVue[]>(`v1/dossiers/${id}/reprises-immobilisations`),
    demande && estUuid(demande) ? tenter<RapportReprise>(`v1/dossiers/${id}/reprises-immobilisations/${demande}?${statut ? `statut=${statut}&` : ''}page=${page}`) : Promise.resolve(null),
  ]);
  if (!liste.ok) return <ErreurAcces statut={liste.statut} message={liste.message} retour={base} />;
  return (
    <div className="space-y-6">
      <p>
        <Link href={`${base}/inventaire`} prefetch={false}>
          ← Retour aux écritures d’inventaire
        </Link>
      </p>
      <div>
        <h2 className="text-xl font-semibold">Reprise du fichier des immobilisations (import CSV ou XLSX)</h2>
        <p className="mt-1 text-texte-doux">
          Importez le fichier des immobilisations d’un dossier en trois temps : un aperçu qui n’écrit rien, votre confirmation explicite, puis un rapport ligne par ligne conservé. Les mêmes contrôles que la saisie manuelle s’appliquent à chaque ligne ; rien n’est deviné, et un import ne modifie ni ne supprime jamais une immobilisation existante.
        </p>
      </div>
      <Alerte ton="neutre" className="text-sm">
        Le dégressif reste <strong>non activé</strong> : un bien déclaré en dégressif dans le fichier est enregistré (avec sa date d’acquisition, son coefficient et l’éligibilité confirmée), mais aucun calcul ni aucune proposition n’en découle tant que l’éditeur n’a pas activé la fonction. Ce fichier n’est pas celui du logiciel comptable, qui reste la référence.
      </Alerte>
      {peutImporter ? (
        <ReprendreFichier entiteId={id} />
      ) : (
        <Alerte ton="neutre" data-testid="import-reserve">
          Importer un fichier est réservé au niveau « collaboration » ou plus. Vous pouvez consulter les rapports des reprises déjà faites.
        </Alerte>
      )}

      {rapport ? rapport.ok ? <Rapport r={rapport.donnees} entiteId={id} statut={statut} /> : <Alerte ton="danger">Rapport indisponible : {rapport.message}</Alerte> : null}

      <section aria-labelledby="titre-reprises" className="space-y-2">
        <SousTitre id="titre-reprises">Reprises précédentes</SousTitre>
        {liste.donnees.length ? (
          <Tableau legende="Reprises du fichier des immobilisations de ce dossier">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Fichier</th>
                <th scope="col">Importé par</th>
                <th scope="col">Créées</th>
                <th scope="col">Ignorées</th>
                <th scope="col">Rejetées</th>
              </tr>
            </thead>
            <tbody>
              {liste.donnees.map((x) => (
                <tr key={x.id} data-reprise={x.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`?rapport=${x.id}`} prefetch={false}>
                      {formaterHorodatage(x.creeLe)}
                    </Link>
                  </td>
                  <td className="break-all">{x.nomFichier}</td>
                  <td>{x.importeurNom ?? '—'}</td>
                  <td>{x.nbCreees}</td>
                  <td>{x.nbIgnorees}</td>
                  <td>{x.nbRejetees}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <Carte>
            <p className="text-texte-doux">Aucune reprise pour ce dossier.</p>
          </Carte>
        )}
      </section>
    </div>
  );
}
