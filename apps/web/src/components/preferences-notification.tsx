'use client';

import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';

export interface FamilleNotification {
  famille: string;
  libelle: string;
  active: boolean;
}

/** Préférences de notification internes (`PUT v1/notifications/preferences`) : une case par famille, enregistrée aussitôt. */
export function PreferencesNotification({ familles }: { familles: FamilleNotification[] }) {
  const appel = useAppel();
  return (
    <fieldset className="space-y-2" data-testid="preferences-notification" disabled={appel.occupe}>
      <legend className="font-medium">Ce dont je veux être prévenu dans l’application</legend>
      <ul className="space-y-1">
        {familles.map((f) => (
          <li key={f.famille}>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={f.active}
                data-famille={f.famille}
                onChange={(e) => void appel.executer('v1/notifications/preferences', { method: 'PUT', json: { famille: f.famille, active: e.target.checked } }, e.target.checked ? 'Notifications réactivées.' : 'Notifications désactivées pour cette famille.')}
              />
              <span>{f.libelle}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-sm text-texte-doux">Désactiver une famille n’efface pas les notifications déjà reçues. Ces réglages ne concernent que l’application : rien n’est envoyé à l’extérieur.</p>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </fieldset>
  );
}
