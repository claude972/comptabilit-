import type { Metadata } from 'next';
import Link from 'next/link';
import { ProposerCorrespondance } from '@/components/banque/correspondance';
import { ChoixExercice } from '@/components/dossier';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { type CorrespondanceBanque, type EtatAssociation, type EtatGlobal, LIBELLE_ETAT_ASSOCIATION, LIBELLE_ETAT_GLOBAL } from '@/lib/correspondance-banque';
import { formaterDate, formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { contexteDossier, contexteExercice } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Correspondance des comptes de banque' };

const TON_GLOBAL: Record<EtatGlobal, Ton> = { determinee: 'succes', indeterminee: 'attention', aucun_compte_512: 'neutre', aucun_releve: 'neutre' };
const TON_ASSOCIATION: Record<EtatAssociation, Ton> = { associe: 'succes', associe_d_office: 'info', non_associe: 'attention', associe_sans_releve: 'danger', associe_plusieurs_fois: 'danger' };

export default async function PageCorrespondanceBanque({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  if (!auMoins(ctx.niveau, 'lecture')) return <ErreurAcces statut={403} message="La correspondance des comptes de banque demande au moins l’habilitation « Lecture » sur ce dossier." retour={`/dossiers/${id}`} />;
  const ex = await contexteExercice(id, sp.exercice);
  const exercice = ex.ok ? ex.exercice : null;
  const r = exercice ? await tenter<CorrespondanceBanque>(`v1/exercices/${exercice.id}/correspondance-banque`) : null;
  const collaboration = auMoins(ctx.niveau, 'collaboration');

  return (
    <div className="space-y-4">
      <p>
        <Link href={`/dossiers/${id}/banque${exercice ? `?exercice=${exercice.id}` : ''}`} prefetch={false}>
          ← Banque et rapprochements
        </Link>
      </p>
      <SousTitre>Correspondance des comptes de banque</SousTitre>
      <Alerte ton="neutre">
        Le rapprochement bancaire compare chaque compte comptable de banque (512…) au compte bancaire de ses relevés. Avec un seul compte de chaque côté, l’association est faite d’office ;
        sinon elle doit être <strong>proposée ici puis approuvée</strong> par un administrateur ou un associé, comme toute règle du cabinet. Tant qu’elle n’est pas déterminée, le
        rapprochement bancaire n’est pas réalisé — il n’est jamais présenté comme « sans anomalie ». Les comptes bancaires sont affichés masqués.
      </Alerte>
      {!ex.ok ? (
        <Alerte ton="attention">Les exercices du dossier n’ont pas pu être chargés. {ex.message}</Alerte>
      ) : !exercice ? (
        <Alerte ton="attention">Aucun exercice n’est ouvert sur ce dossier.</Alerte>
      ) : !r?.ok ? (
        <Alerte ton="attention">La correspondance n’a pas pu être chargée. {r?.message}</Alerte>
      ) : (
        <>
          <ChoixExercice exercices={ex.exercices} courant={exercice.id} />
          <p className="flex flex-wrap items-center gap-2" data-testid="etat-correspondance" data-etat={r.donnees.etat}>
            <Etiquette ton={TON_GLOBAL[r.donnees.etat]}>{LIBELLE_ETAT_GLOBAL[r.donnees.etat]}</Etiquette>
            {r.donnees.motif ? <span>{r.donnees.motif}</span> : null}
          </p>
          {!r.donnees.donneesComptables ? <Alerte ton="attention">Aucune donnée comptable active pour cet exercice : importez d’abord un fichier d’écritures.</Alerte> : null}

          <section aria-labelledby="titre-comptes-512" className="space-y-2">
            <SousTitre id="titre-comptes-512" className="text-base">Comptes comptables de banque ({r.donnees.comptes.length})</SousTitre>
            {r.donnees.comptes.length === 0 ? (
              <p className="text-texte-doux">Aucun compte de banque mouvementé dans les écritures de cet exercice.</p>
            ) : (
              <Tableau legende="Comptes comptables de banque et compte bancaire associé">
                <thead>
                  <tr>
                    <th scope="col">Compte</th>
                    <th scope="col" className="text-right">Lignes</th>
                    <th scope="col">Compte bancaire associé</th>
                    <th scope="col">État</th>
                  </tr>
                </thead>
                <tbody>
                  {r.donnees.comptes.map((c) => (
                    <tr key={c.compteNum} data-compte={c.compteNum} data-etat={c.etat}>
                      <td>
                        <span className="font-mono">{c.compteNum}</span>
                        {c.compteLib ? <span className="block break-words text-texte-doux">{c.compteLib}</span> : null}
                      </td>
                      <td className="text-right tabular-nums">{c.nbLignes.toLocaleString('fr-FR')}</td>
                      <td className="font-mono" data-testid="compte-bancaire">{c.compteBancaire ?? '—'}</td>
                      <td>
                        <Etiquette ton={TON_ASSOCIATION[c.etat]} className="whitespace-normal">{LIBELLE_ETAT_ASSOCIATION[c.etat]}</Etiquette>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            )}
          </section>

          <section aria-labelledby="titre-comptes-bancaires" className="space-y-2">
            <SousTitre id="titre-comptes-bancaires" className="text-base">Comptes bancaires des relevés actifs ({r.donnees.comptesBancaires.length})</SousTitre>
            {r.donnees.comptesBancaires.length === 0 ? (
              <p className="text-texte-doux">Aucun relevé bancaire actif pour ce dossier.</p>
            ) : (
              <ul className="space-y-1" data-testid="comptes-bancaires">
                {r.donnees.comptesBancaires.map((b) => (
                  <li key={b.ref} data-libre={String(b.libre)}>
                    <span className="font-mono">{b.libelle}</span> — {b.nbReleves} relevé(s){b.du && b.au ? `, du ${formaterDate(b.du)} au ${formaterDate(b.au)}` : ''}
                    {b.libre ? <span className="text-texte-doux"> · associé à aucun compte comptable</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="titre-en-vigueur" className="space-y-2" data-testid="en-vigueur">
            <SousTitre id="titre-en-vigueur" className="text-base">Correspondance en vigueur</SousTitre>
            {r.donnees.enVigueur.origine ? (
              <p>
                Règle approuvée, version {r.donnees.enVigueur.origine.version} ({r.donnees.enVigueur.origine.portee === 'dossier' ? 'propre à ce dossier' : 'préférence de tout le cabinet'}) —{' '}
                <Link href="/regles" prefetch={false}>voir les règles du cabinet</Link>.
              </p>
            ) : (
              <p className="text-texte-doux">Aucune règle approuvée : seule l’association d’office s’applique, quand elle est possible.</p>
            )}
          </section>

          <section aria-labelledby="titre-propositions-corr" className="space-y-2" data-testid="propositions-correspondance">
            <SousTitre id="titre-propositions-corr" className="text-base">Propositions en attente de décision ({r.donnees.propositions.length})</SousTitre>
            {r.donnees.propositions.map((p) => (
              <Carte key={p.id} className="space-y-1" data-proposition={p.id}>
                <p>
                  Version {p.version}, proposée le {formaterHorodatage(p.creeLe)} par {p.proposeeParNom ?? 'un membre du cabinet'} —{' '}
                  {p.impactMesure ? 'impact mesuré, en attente d’approbation' : 'impact à mesurer avant approbation'}.
                </p>
                <ul className="list-disc pl-5">
                  {p.correspondances.map((c) => (
                    <li key={c.compteNum}>
                      <span className="font-mono">{c.compteNum}</span> ↔ <span className="font-mono">{c.compteBancaire}</span>
                    </li>
                  ))}
                </ul>
                <p className="break-words text-sm text-texte-doux">Motif : {p.motif}</p>
                <p className="text-sm">
                  Sans effet tant qu’elle n’est pas approuvée : <Link href="/regles" prefetch={false}>mesurer l’impact et décider dans les règles du cabinet</Link>.
                </p>
              </Carte>
            ))}
          </section>

          {collaboration && r.donnees.comptes.length > 0 && r.donnees.comptesBancaires.length > 0 ? (
            <Carte className="space-y-2">
              <SousTitre className="text-base">Proposer une correspondance</SousTitre>
              <p className="text-sm text-texte-doux">{r.donnees.mention}</p>
              <ProposerCorrespondance key={`${exercice.id}-${r.donnees.enVigueur.origine?.regleId ?? 'aucune'}`} exerciceId={exercice.id} comptes={r.donnees.comptes} comptesBancaires={r.donnees.comptesBancaires} />
            </Carte>
          ) : null}
        </>
      )}
    </div>
  );
}
