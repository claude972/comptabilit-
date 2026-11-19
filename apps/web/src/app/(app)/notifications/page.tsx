import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { BoutonAction } from '@/components/revision-actions';
import { Alerte, Carte, Etiquette, Titre } from '@/components/ui/base';
import { formaterHorodatage } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';

export const metadata: Metadata = { title: 'Notifications' };

interface PageNotifications {
  page: number;
  taillePage: number;
  total: number;
  nonLues: number;
  suite: boolean;
  envoiExterne: boolean;
  notifications: Array<{ id: string; type: string; creeLe: string; lueLe: string | null; titre: string; message: string; lien: string | null }>;
}

export default async function PageNotificationsInternes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brute = (await searchParams).page;
  const page = Math.max(1, Number.parseInt((Array.isArray(brute) ? brute[0] : brute) ?? '1', 10) || 1);
  const r = await tenter<PageNotifications>(`v1/notifications?page=${page}`);
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} />;
  const d = r.donnees;
  return (
    <div className="space-y-4">
      <Titre>Notifications</Titre>
      <Alerte ton="neutre" data-testid="mention-notifications">
        Ces notifications n’existent que dans l’application : <strong>rien n’est envoyé par courriel, SMS ou notification sur votre appareil</strong>. Vous ne voyez que les vôtres.
      </Alerte>
      <p data-testid="decompte-notifications">
        {d.total} notification(s), dont {d.nonLues} non lue(s).
      </p>
      {d.nonLues > 0 ? <BoutonAction chemin="v1/notifications/lues" libelle="Tout marquer comme lu" succes="Notifications marquées comme lues." /> : null}
      {d.notifications.length === 0 ? <p className="text-texte-doux">Aucune notification.</p> : null}
      <ul className="space-y-3">
        {d.notifications.map((n) => (
          <li key={n.id} data-notification={n.id} data-type={n.type} data-lue={String(n.lueLe !== null)}>
            <Carte className="space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                {n.lueLe === null ? <Etiquette ton="info">Non lue</Etiquette> : <Etiquette>Lue</Etiquette>}
                <span className="font-medium">{n.titre}</span>
                <span className="text-sm text-texte-doux">{formaterHorodatage(n.creeLe)}</span>
              </p>
              {n.message ? <p className="break-words">{n.message}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                {n.lien ? (
                  <Link href={n.lien} prefetch={false}>
                    Ouvrir
                  </Link>
                ) : null}
                {n.lueLe === null ? <BoutonAction chemin={`v1/notifications/${n.id}/lue`} libelle="Marquer comme lue" succes="Marquée comme lue." variante="contour" /> : null}
              </div>
            </Carte>
          </li>
        ))}
      </ul>
      {d.total > d.taillePage || page > 1 ? (
        <nav aria-label="Pages de notifications" className="flex flex-wrap items-center gap-3">
          {page > 1 ? <Link href={`/notifications?page=${page - 1}`} prefetch={false} rel="prev">← Plus récentes</Link> : <span className="text-texte-doux">← Plus récentes</span>}
          <span>Page {page}</span>
          {d.suite ? <Link href={`/notifications?page=${page + 1}`} prefetch={false} rel="next">Plus anciennes →</Link> : <span className="text-texte-doux">Plus anciennes →</span>}
        </nav>
      ) : null}
    </div>
  );
}
