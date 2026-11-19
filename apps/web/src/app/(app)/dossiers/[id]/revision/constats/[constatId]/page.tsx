import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { ActionsConstat } from '@/components/revision-actions';
import { EtiquetteGravite, EtiquetteStatutControle, EtiquetteStatutRevue, SourceDeRegle } from '@/components/revision-affichage';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau } from '@/components/ui/base';
import { LIBELLE_ACTION } from '@/lib/libelles';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { estUuid } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import type { DetailConstat } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Constat de révision' };

export default async function PageConstat({ params }: { params: Promise<{ id: string; constatId: string }> }) {
  const { id, constatId } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const base = `/dossiers/${id}/revision`;
  if (!estUuid(constatId)) return <ErreurAcces statut={404} retour={base} />;
  const r = await tenter<DetailConstat>(`v1/constats/${constatId}`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour={base} />;
  const { constat: c, lignes, nbLignesTotal, decisions, controle } = r.donnees;
  if (c.entiteId !== id) return <ErreurAcces statut={404} retour={base} />;
  const retour = `${base}?exercice=${c.exerciceId}`;

  return (
    <div className="space-y-4">
      <p>
        <Link href={retour} prefetch={false}>
          ← Retour à la révision
        </Link>
      </p>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold break-words">{c.titre}</h2>
        <p className="flex flex-wrap items-center gap-2">
          <EtiquetteGravite gravite={c.gravite} />
          <EtiquetteStatutRevue statut={c.statutRevue} />
          {c.aRevoir ? <Etiquette ton="attention">À revoir : données modifiées depuis la décision</Etiquette> : null}
          <MentionProjet />
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Carte className="space-y-3">
            <SousTitre>Explication</SousTitre>
            <p className="break-words whitespace-pre-wrap">{c.explication}</p>
            {c.montant !== null ? (
              <p>
                <span className="font-medium">Montant concerné :</span> <span className="tabular-nums">{formaterMontant(c.montant)}</span>
              </p>
            ) : null}
            <div>
              <p className="font-medium">Action proposée</p>
              <p className="break-words whitespace-pre-wrap">{c.actionProposee}</p>
            </div>
          </Carte>

          <Carte className="space-y-2">
            <SousTitre>Preuves</SousTitre>
            {c.preuves?.length ? (
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]" data-testid="preuves">
                {c.preuves.map((p, i) => (
                  <div key={i} className="contents">
                    <dt className="text-texte-doux">{p.libelle}</dt>
                    <dd className="break-words">{p.valeur}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-texte-doux">Aucune preuve jointe à ce constat.</p>
            )}
          </Carte>

          <Carte className="space-y-2">
            <SousTitre>
              Écritures concernées ({lignes.length}
              {nbLignesTotal > lignes.length ? ` affichées sur ${nbLignesTotal}` : ''})
            </SousTitre>
            {lignes.length ? (
              <Tableau legende="Écritures concernées par le constat">
                <thead>
                  <tr>
                    <th scope="col">Ligne</th>
                    <th scope="col">Date</th>
                    <th scope="col">Journal</th>
                    <th scope="col">N° écriture</th>
                    <th scope="col">Compte</th>
                    <th scope="col">Pièce</th>
                    <th scope="col">Libellé</th>
                    <th scope="col" className="text-right">Débit</th>
                    <th scope="col" className="text-right">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.id}>
                      <td className="tabular-nums">{l.numeroLigne}</td>
                      <td className="whitespace-nowrap">{formaterDate(l.ecritureDate)}</td>
                      <td>{l.journalCode}</td>
                      <td>{l.ecritureNum}</td>
                      <td>
                        {l.compteNum}
                        {l.compAuxNum ? ` / ${l.compAuxNum}` : ''}
                        <span className="block text-sm text-texte-doux">{l.compteLib}</span>
                      </td>
                      <td className="break-all">{l.pieceRef}</td>
                      <td className="break-words">{l.ecritureLib}</td>
                      <td className="text-right tabular-nums">{formaterMontant(l.debit)}</td>
                      <td className="text-right tabular-nums">{formaterMontant(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            ) : (
              <p className="text-texte-doux">Aucune écriture n’est rattachée à ce constat.</p>
            )}
          </Carte>
        </div>

        <div className="space-y-4">
          <Carte className="space-y-3">
            <SousTitre>Contrôle à l’origine du constat</SousTitre>
            <p>
              <span className="font-mono">{c.controleId}</span>
              {controle ? ` · version ${controle.versionControle}` : ''}
              {controle?.source?.titre ? <span className="block">{controle.source.titre}</span> : null}
            </p>
            {controle ? <EtiquetteStatutControle statut={controle.statut} /> : null}
            <SousTitre className="text-base">Source de la règle</SousTitre>
            <SourceDeRegle source={controle?.source} />
          </Carte>

          <Carte>
            <ActionsConstat constatId={c.id} niveau={ctx.niveau} />
          </Carte>

          <Carte className="space-y-2">
            <SousTitre>Historique des décisions</SousTitre>
            {decisions.length ? (
              <ol className="space-y-2" data-testid="historique-decisions">
                {decisions.map((d, i) => (
                  <li key={i} className="rounded-lg border border-bordure p-2">
                    <p className="font-medium">{LIBELLE_ACTION[d.action] ?? d.action}</p>
                    <p className="text-sm text-texte-doux">
                      {d.auteur} · {formaterHorodatage(d.creeLe)} · version des données {d.versionCible}
                    </p>
                    {d.motif ? <p className="mt-1 break-words whitespace-pre-wrap">{d.motif}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-texte-doux">Aucune décision enregistrée.</p>
            )}
          </Carte>
          <Alerte ton="neutre" className="text-sm">
            Chaque action est historisée avec son auteur et la version des données. Un constat accepté ou clôturé reste une décision du professionnel.
          </Alerte>
        </div>
      </div>
    </div>
  );
}
