import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { AffecterPiece } from '@/components/messagerie/actions';
import { RappelPerimetreMetier } from '@/components/messagerie/commun';
import { Carte, Etiquette, Titre } from '@/components/ui/base';
import { type PieceAQualifier, libelleRaison } from '@/lib/messagerie';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireDossiers } from '@/lib/serveur/donnees';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Pièces à qualifier' };

export default async function PageAQualifier() {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.message} />;
  const [pieces, dossiers] = await Promise.all([tenter<PieceAQualifier[]>('v1/mail/pieces-a-qualifier'), lireDossiers()]);
  if (!pieces.ok) return <ErreurAcces statut={pieces.statut} message={pieces.message} retour="/messagerie" />;
  const tous = dossiers.ok ? dossiers.donnees : [];
  // L'affectation exige d'être soi-même habilité sur le dossier visé.
  const affectables = tous.filter((d) => d.niveau !== null).map((d) => ({ id: d.id, raisonSociale: d.raisonSociale }));
  const nom = (id: string) => tous.find((d) => d.id === id)?.raisonSociale ?? 'Dossier inconnu';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p>
        <Link href="/messagerie" prefetch={false}>
          ← Retour à la messagerie
        </Link>
      </p>
      <Titre>Pièces à qualifier ({pieces.donnees.length})</Titre>
      <p className="text-texte-doux">Pièces jointes reçues par mail que les règles n’ont pas permis de rattacher à un seul dossier. Elles ne sont dans aucun dossier tant qu’elles ne sont pas affectées.</p>
      <RappelPerimetreMetier />
      {pieces.donnees.length === 0 ? <p>Aucune pièce en attente.</p> : null}
      <ul className="space-y-3" data-testid="pieces-a-qualifier">
        {pieces.donnees.map((p) => {
          const x = p.extraitNonFiable;
          return (
            <li key={p.id}>
              <Carte className="space-y-3" data-piece={p.id}>
                <p className="font-semibold break-all">{p.nomFichier}</p>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-texte-doux">Expéditeur</dt>
                  <dd className="break-all">{p.provenance?.expediteur ?? x?.expediteur ?? 'Inconnu'}</dd>
                  <dt className="text-texte-doux">Reçue le</dt>
                  <dd>{formaterHorodatage(p.provenance?.dateReception ?? x?.dateReception ?? p.recueLe)}</dd>
                  <dt className="text-texte-doux">Fichier</dt>
                  <dd className="break-all">{p.provenance?.nomFichier ?? p.nomFichier}</dd>
                </dl>
                <div>
                  <p className="font-medium">Pourquoi cette pièce est à qualifier</p>
                  <ul className="list-disc pl-5" data-testid="raisons">
                    {(p.raisons ?? []).map((r) => (
                      <li key={r} className="break-words">
                        {libelleRaison(r)}
                      </li>
                    ))}
                  </ul>
                  {p.candidats?.length ? <p className="mt-1 text-sm">Dossiers désignés par les règles : {p.candidats.map(nom).join(', ')}.</p> : null}
                </div>
                {x && (x.objet || x.extrait) ? (
                  <div className="rounded-lg border border-dashed border-texte-doux p-3 text-sm" data-testid="extrait-non-fiable">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      Extrait du message <Etiquette ton="vide">Contenu non fiable, fourni par l’expéditeur</Etiquette>
                    </p>
                    {x.objet ? <p className="mt-1 break-words">Objet : {x.objet}</p> : null}
                    {x.extrait ? <p className="mt-1 break-words whitespace-pre-wrap">{x.extrait}</p> : null}
                    <p className="mt-1 text-texte-doux">Extrait limité, affiché pour aider à choisir le dossier. Le reste du message n’est ni affiché ni conservé.</p>
                  </div>
                ) : null}
                {affectables.length ? <AffecterPiece pieceId={p.id} dossiers={affectables} candidats={p.candidats ?? []} /> : <p className="text-sm">Vous n’êtes habilité sur aucun dossier : vous ne pouvez pas affecter cette pièce.</p>}
              </Carte>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
