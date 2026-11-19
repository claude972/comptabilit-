import type { Metadata } from 'next';
import Link from 'next/link';
import { ErreurAcces } from '@/components/erreurs';
import { type FamilleNotification, PreferencesNotification } from '@/components/preferences-notification';
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
  archivees?: number;
  suite: boolean;
  envoiExterne: boolean;
  notifications: Array<{ id: string; type: string; creeLe: string; lueLe: string | null; archiveeLe?: string | null; titre: string; message: string; lien: string | null }>;
}

interface Groupe {
  type: string;
  nombre: number;
  nonLues: number;
  derniere: string;
  ids: string[];
  titre: string;
  message: string;
  lien: string | null;
}

export default async function PageNotificationsInternes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brute = (await searchParams).page;
  const page = Math.max(1, Number.parseInt((Array.isArray(brute) ? brute[0] : brute) ?? '1', 10) || 1);
  const vueArchives = (await searchParams).archivees === '1';
  const [r, preferences] = await Promise.all([tenter<PageNotifications>(`v1/notifications?page=${page}${vueArchives ? '&archivees=1' : ''}`), tenter<{ familles: FamilleNotification[] }>('v1/notifications/preferences')]);
  const groupes = vueArchives ? null : await tenter<{ groupes: Groupe[] }>('v1/notifications/groupes');
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} />;
  const d = r.donnees;
  return (
    <div className="space-y-4">
      <Titre>Notifications</Titre>
      <Alerte ton="neutre" data-testid="mention-notifications">
        Ces notifications n’existent que dans l’application : <strong>rien n’est envoyé par courriel, SMS ou notification sur votre appareil</strong>. Vous ne voyez que les vôtres.
      </Alerte>
      <p data-testid="decompte-notifications">
        {vueArchives ? `${d.total} notification(s) archivée(s).` : `${d.total} notification(s) courante(s), dont ${d.nonLues} non lue(s) ; ${d.archivees ?? 0} archivée(s).`}{' '}
        {vueArchives ? (
          <Link href="/notifications" prefetch={false}>Revenir aux notifications courantes</Link>
        ) : (
          <Link href="/notifications?archivees=1" prefetch={false} data-testid="lien-archivees">Voir les notifications archivées</Link>
        )}
      </p>
      {vueArchives ? (
        <Alerte ton="neutre">Une notification archivée n’est pas supprimée : elle peut être désarchivée à tout moment.</Alerte>
      ) : (
        <div className="flex flex-wrap gap-3">
          {d.nonLues > 0 ? <BoutonAction chemin="v1/notifications/lues" libelle="Tout marquer comme lu" succes="Notifications marquées comme lues." /> : null}
          {d.total - d.nonLues > 0 ? <BoutonAction chemin="v1/notifications/archiver-lues" libelle="Archiver les notifications lues" succes="Notifications lues archivées (réversible)." variante="contour" /> : null}
        </div>
      )}
      {groupes?.ok && groupes.donnees.groupes.some((g) => g.nombre > 1) ? (
        <section aria-labelledby="titre-groupes" className="space-y-2" data-testid="groupes-notifications">
          <h2 id="titre-groupes" className="font-medium">Regroupées par nature et par dossier</h2>
          <ul className="space-y-2">
            {groupes.donnees.groupes.map((g) => (
              <li key={g.ids[0]} data-groupe={g.type} data-nombre={g.nombre}>
                <Carte className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Etiquette ton={g.nonLues > 0 ? 'info' : 'neutre'}>
                      {g.nombre} notification(s){g.nonLues > 0 ? `, dont ${g.nonLues} non lue(s)` : ''}
                    </Etiquette>
                    <span className="font-medium">{g.titre}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {g.lien ? <Link href={g.lien} prefetch={false}>Ouvrir</Link> : null}
                    {g.nonLues > 0 ? <BoutonAction chemin="v1/notifications/lot" corps={{ ids: g.ids, action: 'lire' }} libelle="Marquer le groupe comme lu" succes="Groupe marqué comme lu." variante="contour" /> : null}
                    <BoutonAction chemin="v1/notifications/lot" corps={{ ids: g.ids, action: 'archiver' }} libelle="Archiver le groupe" succes="Groupe archivé (réversible)." variante="contour" />
                  </div>
                </Carte>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
                {n.lueLe === null && !vueArchives ? <BoutonAction chemin={`v1/notifications/${n.id}/lue`} libelle="Marquer comme lue" succes="Marquée comme lue." variante="contour" /> : null}
                {vueArchives ? (
                  <BoutonAction chemin="v1/notifications/lot" corps={{ ids: [n.id], action: 'desarchiver' }} libelle="Désarchiver" succes="Notification désarchivée." variante="contour" />
                ) : (
                  <BoutonAction chemin="v1/notifications/lot" corps={{ ids: [n.id], action: 'archiver' }} libelle="Archiver" succes="Notification archivée (réversible)." variante="contour" />
                )}
              </div>
            </Carte>
          </li>
        ))}
      </ul>
      {preferences.ok ? (
        <Carte>
          <PreferencesNotification familles={preferences.donnees.familles} />
        </Carte>
      ) : null}
      {d.total > d.taillePage || page > 1 ? (
        <nav aria-label="Pages de notifications" className="flex flex-wrap items-center gap-3">
          {page > 1 ? <Link href={`/notifications?page=${page - 1}${vueArchives ? '&archivees=1' : ''}`} prefetch={false} rel="prev">← Plus récentes</Link> : <span className="text-texte-doux">← Plus récentes</span>}
          <span>Page {page}</span>
          {d.suite ? <Link href={`/notifications?page=${page + 1}${vueArchives ? '&archivees=1' : ''}`} prefetch={false} rel="next">Plus anciennes →</Link> : <span className="text-texte-doux">Plus anciennes →</span>}
        </nav>
      ) : null}
    </div>
  );
}
