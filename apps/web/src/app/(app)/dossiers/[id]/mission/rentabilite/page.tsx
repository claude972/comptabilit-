import type { Metadata } from 'next';
import { ErreurAcces } from '@/components/erreurs';
import { SousNavigationMission } from '@/components/mission/sous-navigation';
import { Alerte, Carte, Etiquette, Libelle, Liste, Saisie, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_MODE_HONORAIRES, type Mission, formaterMinutes } from '@/lib/missions';
import { formaterDate, formaterMontant } from '@/lib/montants';
import { LIBELLE_ORIGINE_PERIODE, LIBELLE_STATUT_CALCUL, type Rentabilite, type StatutCalcul, margeAffichable, periodeDemandeeInvalide, periodeRentabilite } from '@/lib/rentabilite';
import { tenter } from '@/lib/serveur/api';
import { lireExercices, parametre } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Rentabilité d’une mission' };

/** « Partiel » et « Non calculable » ne sont jamais rendus comme un résultat acquis. */
const TON: Record<StatutCalcul, Ton> = { calcule: 'neutre', partiel: 'attention', non_calculable: 'vide' };
function Statut({ statut }: { statut: StatutCalcul }) {
  return (
    <Etiquette ton={TON[statut] ?? 'vide'} data-statut-calcul={statut}>
      {LIBELLE_STATUT_CALCUL[statut] ?? statut}
    </Etiquette>
  );
}
function NonCalculable({ motif }: { motif: string | null }) {
  return (
    <p data-testid="non-calculable">
      <strong>Non calculable</strong>
      {motif ? <span className="break-words"> — {motif}</span> : null}
    </p>
  );
}

export default async function PageRentabilite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  if (!auMoins(ctx.niveau, 'revision')) {
    return (
      <div className="space-y-4">
        <SousNavigationMission dossierId={id} courant="rentabilite" avecRentabilite={false} />
        <Alerte ton="neutre" data-testid="rentabilite-reservee">
          La rentabilité d’une mission est réservée au niveau « Révision » sur ce dossier.
        </Alerte>
      </div>
    );
  }
  const [missions, exercices] = await Promise.all([tenter<Mission[]>(`v1/dossiers/${id}/missions`), lireExercices(id)]);
  if (!missions.ok) return <ErreurAcces statut={missions.statut} message={missions.message} retour={`/dossiers/${id}`} />;
  const mission = missions.donnees.find((m) => m.id === parametre(sp.mission)) ?? missions.donnees[0];
  const demande = { du: parametre(sp.du), au: parametre(sp.au) };
  const aujourdHui = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const periode = periodeRentabilite(demande, exercices.ok ? exercices.donnees : [], aujourdHui);
  const r = mission ? await tenter<Rentabilite>(`v1/missions/${mission.id}/rentabilite?du=${periode.du}&au=${periode.au}`) : null;
  const versionDe = new Map((mission?.lettres ?? []).map((l) => [l.id, l]));

  return (
    <div className="space-y-4">
      <SousNavigationMission dossierId={id} courant="rentabilite" avecRentabilite />
      {!mission ? (
        <Alerte ton="neutre">Aucune mission n’est définie pour ce dossier : la rentabilité se calcule mission par mission.</Alerte>
      ) : (
        <>
          <form key={`${mission.id}|${periode.du}|${periode.au}`} method="get" className="flex flex-wrap items-end gap-2" aria-label="Mission et période">
            <div>
              <Libelle htmlFor="mission">Mission</Libelle>
              <Liste id="mission" name="mission" defaultValue={mission.id} className="min-w-64">
                {missions.donnees.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.libelle}
                  </option>
                ))}
              </Liste>
            </div>
            <div>
              <Libelle htmlFor="du">Du</Libelle>
              <Saisie id="du" name="du" type="date" defaultValue={periode.du} required />
            </div>
            <div>
              <Libelle htmlFor="au">Au</Libelle>
              <Saisie id="au" name="au" type="date" defaultValue={periode.au} required />
            </div>
            <Bouton type="submit" variante="secondaire">
              Afficher
            </Bouton>
          </form>
          <p className="text-sm text-texte-doux" data-testid="periode">
            Du {formaterDate(periode.du)} au {formaterDate(periode.au)}. {LIBELLE_ORIGINE_PERIODE[periode.origine]}
          </p>
          {periodeDemandeeInvalide(demande) ? (
            <Alerte ton="attention" role="alert">
              La période demandée n’est pas valide (deux dates, la première ne suivant pas la seconde) : la période par défaut est affichée.
            </Alerte>
          ) : null}
          {r && !r.ok ? (
            <Alerte ton={r.statut === 403 ? 'neutre' : 'attention'} role="alert" data-testid="rentabilite-indisponible">
              {r.statut === 403 ? 'La rentabilité de cette mission est réservée au niveau « Révision ». ' : r.statut === 404 ? 'Mission introuvable. ' : 'La rentabilité n’a pas pu être calculée. '}
              {r.message}
            </Alerte>
          ) : null}
          {r?.ok ? <Resultat r={r.donnees} versionDe={versionDe} /> : null}
        </>
      )}
    </div>
  );
}

function Resultat({ r, versionDe }: { r: Rentabilite; versionDe: Map<string, { version: number; avenantDe: string | null }> }) {
  const h = r.honoraires;
  const t = r.temps;
  return (
    <div className="space-y-4" data-testid="rentabilite">
      <Alerte ton="neutre" data-testid="mention-generale">
        {r.mention}
      </Alerte>

      <Carte className="space-y-3" data-testid="honoraires" data-statut={h.statut}>
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre>Honoraires de la période</SousTitre>
          <Statut statut={h.statut} />
        </div>
        {h.statut === 'calcule' && h.total !== null ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-texte-doux">Forfait (au prorata des jours couverts)</dt>
              <dd className="tabular-nums" data-valeur="forfait">{formaterMontant(h.forfait, '€')}</dd>
              <dt className="text-texte-doux">Temps passé (temps observés × taux de la lettre)</dt>
              <dd className="tabular-nums" data-valeur="temps-passe">{formaterMontant(h.tempsPasse, '€')}</dd>
              <dt className="font-semibold">Total des honoraires HT</dt>
              <dd className="font-semibold tabular-nums" data-valeur="total">{formaterMontant(h.total, '€')}</dd>
            </dl>
            <Tableau legende="Détail des honoraires par lettre de mission">
              <thead>
                <tr>
                  <th scope="col">Lettre appliquée</th>
                  <th scope="col">Du</th>
                  <th scope="col">Au</th>
                  <th scope="col" className="text-right">Jours</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="text-right">Forfait au prorata</th>
                </tr>
              </thead>
              <tbody>
                {h.detail.map((d) => {
                  const l = versionDe.get(d.lettreId);
                  return (
                    <tr key={`${d.lettreId}|${d.du}`} data-detail={d.lettreId}>
                      <th scope="row" className="!bg-transparent font-medium">{l ? `${l.avenantDe ? 'Avenant' : 'Lettre de mission'} — version ${l.version}` : 'Lettre de la mission'}</th>
                      <td>{formaterDate(d.du)}</td>
                      <td>{formaterDate(d.au)}</td>
                      <td className="text-right tabular-nums">{d.jours}</td>
                      <td>{LIBELLE_MODE_HONORAIRES[d.mode as keyof typeof LIBELLE_MODE_HONORAIRES] ?? d.mode}</td>
                      <td className="text-right tabular-nums">{formaterMontant(d.montant, '€')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Tableau>
          </>
        ) : (
          <NonCalculable motif={h.motif} />
        )}
      </Carte>

      <Carte className="space-y-3" data-testid="temps-observes">
        <SousTitre>Temps observés ({t.nbTravaux} travail{t.nbTravaux > 1 ? 'aux' : ''} sur la période)</SousTitre>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-texte-doux">Dans le périmètre de la lettre applicable</dt>
          <dd data-valeur="dans-perimetre">{formaterMinutes(t.minutesDansPerimetre)}</dd>
          <dt className="text-texte-doux">Potentiellement hors périmètre</dt>
          <dd data-valeur="hors-perimetre">{formaterMinutes(t.minutesHorsPerimetre)}</dd>
          <dt className="text-texte-doux">À des dates sans lettre applicable</dt>
          <dd data-valeur="sans-lettre">{formaterMinutes(t.minutesSansLettre)}</dd>
          <dt className="text-texte-doux">Travaux sans temps saisi</dt>
          <dd data-valeur="sans-temps">
            {t.travauxSansTemps}
            {t.travauxSansTemps > 0 ? <span className="text-sm"> — leur durée est inconnue : elle n’est pas comptée comme nulle.</span> : null}
          </dd>
        </dl>
        <p className="text-sm text-texte-doux">Seuls les temps réellement saisis sur les travaux sont comptés ; aucun temps n’est estimé ici.</p>
      </Carte>

      <Carte className="space-y-2" data-testid="taux-horaire" data-statut={r.tauxHoraireRealise.statut}>
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre>Taux horaire réalisé</SousTitre>
          <Statut statut={r.tauxHoraireRealise.statut} />
        </div>
        {r.tauxHoraireRealise.valeur !== null && r.tauxHoraireRealise.statut !== 'non_calculable' ? (
          <>
            <p className="text-xl font-semibold tabular-nums" data-valeur="taux">{formaterMontant(r.tauxHoraireRealise.valeur, '€')} HT par heure observée dans le périmètre</p>
            {r.tauxHoraireRealise.motif ? <p className="break-words">{r.tauxHoraireRealise.motif}</p> : null}
          </>
        ) : (
          <NonCalculable motif={r.tauxHoraireRealise.motif} />
        )}
      </Carte>

      <Carte className="space-y-2" data-testid="marge" data-statut={r.marge.statut}>
        <div className="flex flex-wrap items-center gap-2">
          <SousTitre>Coût et marge</SousTitre>
          <Statut statut={r.marge.statut} />
        </div>
        {margeAffichable(r.marge) ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-texte-doux">Coût horaire interne saisi par le cabinet</dt>
              <dd className="tabular-nums">{formaterMontant(r.marge.coutHoraire, '€')} HT par heure</dd>
              <dt className="text-texte-doux">Coût du temps observé (tout le temps, y compris hors périmètre)</dt>
              <dd className="tabular-nums" data-valeur="cout">{formaterMontant(r.marge.cout, '€')}</dd>
              <dt className="font-semibold">Marge</dt>
              <dd className="font-semibold tabular-nums" data-valeur="marge">{formaterMontant(r.marge.valeur, '€')}</dd>
              <dt className="text-texte-doux">Marge en proportion des honoraires</dt>
              <dd className="tabular-nums">{r.marge.tauxPourcent !== null ? `${formaterMontant(r.marge.tauxPourcent)} %` : 'Non calculable'}</dd>
            </dl>
            {r.marge.motif ? <p className="break-words">{r.marge.motif}</p> : null}
          </>
        ) : (
          <NonCalculable motif={r.marge.motif} />
        )}
      </Carte>

      <section aria-labelledby="titre-mentions" className="space-y-1" data-testid="mentions">
        <SousTitre id="titre-mentions" className="text-base">Mentions et limites du calcul ({r.mentions.length})</SousTitre>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {r.mentions.map((m) => (
            <li key={m} className="break-words">
              {m}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
