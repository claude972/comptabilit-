import type { Metadata } from 'next';
import { PieceJointeAffichee } from '@/components/document/pieces-jointes';
import { ErreurAcces } from '@/components/erreurs';
import { ActionConfirmee, AffecterTravail, CreerMission, DefinirBareme, EnregistrerTravail, PreparerAvenant, RedigerLettre } from '@/components/mission/actions';
import { SousNavigationMission } from '@/components/mission/sous-navigation';
import { Alerte, Carte, Etiquette, MentionProjet, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { estGestionnaire } from '@/lib/messagerie';
import { type Bareme, LIBELLE_MODE_HONORAIRES, LIBELLE_RATTACHEMENT, type Lettre, type Mission, type Prestation, type Rattachement, type Travail, formaterMinutes } from '@/lib/missions';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { lireMoi } from '@/lib/serveur/donnees';
import { contexteDossier } from '@/lib/serveur/dossier';
import { auMoins } from '@/lib/types-api';

export const metadata: Metadata = { title: 'Mission du dossier' };

const TON_RATTACHEMENT: Record<Rattachement['situation'], Ton> = { dans_le_perimetre: 'succes', potentiellement_hors_perimetre: 'attention', aucune_lettre_applicable: 'vide' };

function ContenuDeLettre({ l, libelle }: { l: Lettre; libelle: (code: string) => string }) {
  const c = l.contenu;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="contenu-lettre">
      <dt className="text-texte-doux">Périmètre</dt>
      <dd>
        <ul className="list-disc pl-5" data-testid="perimetre">
          {(c.perimetre ?? []).map((p, i) => (
            <li key={`${p.prestation}-${i}`} className="break-words">
              {libelle(p.prestation)}
              {p.precision ? ` — ${p.precision}` : ''}
            </li>
          ))}
        </ul>
      </dd>
      <dt className="text-texte-doux">Durée</dt>
      <dd>
        À compter du {formaterDate(c.duree?.debut)}
        {c.duree?.fin ? ` jusqu’au ${formaterDate(c.duree.fin)}` : ', sans terme'}
        {c.duree?.taciteReconduction ? ' · tacite reconduction' : ''}
      </dd>
      <dt className="text-texte-doux">Honoraires</dt>
      <dd className="break-words">
        {LIBELLE_MODE_HONORAIRES[c.honoraires?.mode] ?? c.honoraires?.mode}
        {' · '}annuels HT : <span className="tabular-nums">{c.honoraires?.montantAnnuelHt ? formaterMontant(c.honoraires.montantAnnuelHt) : 'non renseignés'}</span>
        {' · '}taux horaire HT : <span className="tabular-nums">{c.honoraires?.tauxHoraireHt ? formaterMontant(c.honoraires.tauxHoraireHt) : 'non renseigné'}</span>
        {c.honoraires?.conditionsRevision ? <span className="block whitespace-pre-wrap">Révision : {c.honoraires.conditionsRevision}</span> : null}
      </dd>
      <dt className="text-texte-doux">Obligations du cabinet</dt>
      <dd className="break-words whitespace-pre-wrap">{c.obligationsCabinet || '—'}</dd>
      <dt className="text-texte-doux">Obligations du client</dt>
      <dd className="break-words whitespace-pre-wrap">{c.obligationsClient || '—'}</dd>
      <dt className="text-texte-doux">Livrables</dt>
      <dd className="break-words">{c.livrables?.length ? c.livrables.join(' · ') : '—'}</dd>
      <dt className="text-texte-doux">Mandats</dt>
      <dd className="break-words">{c.mandats?.length ? c.mandats.join(' · ') : '—'}</dd>
      <dt className="text-texte-doux">Limites</dt>
      <dd className="break-words whitespace-pre-wrap">{c.limites || '—'}</dd>
    </dl>
  );
}

export default async function PageMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteDossier(id);
  if (!ctx.ok) return null;
  const [missions, travaux, prestations, baremes, moi] = await Promise.all([
    tenter<Mission[]>(`v1/dossiers/${id}/missions`),
    tenter<Travail[]>(`v1/dossiers/${id}/travaux`),
    tenter<Prestation[]>('v1/reference/prestations'),
    tenter<Bareme[]>('v1/cabinet/baremes'),
    lireMoi(),
  ]);
  if (!missions.ok) return <ErreurAcces statut={missions.statut} message={missions.message} retour={`/dossiers/${id}`} />;
  const collaboration = auMoins(ctx.niveau, 'collaboration');
  const validation = auMoins(ctx.niveau, 'validation');
  const gestionnaire = moi.ok && estGestionnaire(moi.donnees.role);
  const refPrestations = prestations.ok ? prestations.donnees : [];
  const libelle = (code: string) => refPrestations.find((p) => p.code === code)?.libelle ?? code;
  const toutesLettres = missions.donnees.flatMap((m) => m.lettres);
  const versionDe = new Map(toutesLettres.map((l) => [l.id, l]));
  const baremeDe = new Map((baremes.ok ? baremes.donnees : []).map((b) => [b.prestation, b.minutesReference]));

  return (
    <div className="space-y-6">
      <SousNavigationMission dossierId={id} courant="missions" avecRentabilite={auMoins(ctx.niveau, 'revision')} />

      <section aria-labelledby="titre-missions" className="space-y-3">
        <SousTitre id="titre-missions">Missions ({missions.donnees.length})</SousTitre>
        <p className="text-sm text-texte-doux">Une lettre ou un avenant non validé est un projet : il ne s’applique à aucun travail. La validation est réservée au niveau « Validation ».</p>
        {missions.donnees.length === 0 ? <p className="text-texte-doux">Aucune mission enregistrée sur ce dossier.</p> : null}
        {missions.donnees.map((m) => (
          <Carte key={m.id} className="space-y-3" data-mission={m.id}>
            <h3 className="font-semibold break-words">
              {m.libelle}
              <span className="ml-2 text-sm font-normal text-texte-doux">
                {m.debut ? `du ${formaterDate(m.debut)}` : ''}
                {m.fin ? ` au ${formaterDate(m.fin)}` : ''}
              </span>
            </h3>
            {m.lettres.length === 0 ? <p className="text-texte-doux">Aucune lettre de mission pour l’instant.</p> : null}
            <ul className="space-y-3">
              {m.lettres.map((l) => (
                <li key={l.id} className="space-y-2 rounded-lg border border-bordure p-3" data-lettre={l.id} data-statut={l.statut}>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {l.avenantDe ? `Avenant${versionDe.has(l.avenantDe) ? ` à la version ${versionDe.get(l.avenantDe)!.version}` : ''}` : 'Lettre de mission'} — version {l.version}
                    </span>
                    {l.statut === 'projet' ? <MentionProjet /> : l.statut === 'validee' ? <Etiquette ton="succes">Validée</Etiquette> : <Etiquette>{l.statut === 'remplacee' ? 'Remplacée' : l.statut}</Etiquette>}
                    {l.origine === 'proposition_avenant' ? <Etiquette ton="info" className="whitespace-normal">Préparé par le logiciel à partir d’un travail : à relire et compléter</Etiquette> : null}
                    <span className="text-sm text-texte-doux">effet au {formaterDate(l.dateEffet)}</span>
                  </p>
                  <ContenuDeLettre l={l} libelle={libelle} />
                  {l.document ? (
                    <p className="text-sm" data-testid="lettre-signee">
                      Lettre signée jointe : <PieceJointeAffichee piece={l.document} dossierId={id} />
                    </p>
                  ) : l.documentId ? (
                    <p className="text-sm text-texte-doux">Lettre signée jointe, non consultable.</p>
                  ) : null}
                  {l.valideeLe ? <p className="text-sm text-texte-doux">Validée le {formaterHorodatage(l.valideeLe)}.</p> : null}
                  {l.statut === 'projet' ? (
                    validation ? (
                      <ActionConfirmee
                        chemin={`v1/lettres/${l.id}/validation`}
                        libelle="Valider"
                        confirmation="Confirmer la validation"
                        explication={`En validant, vous rendez ce document applicable aux travaux à compter du ${formaterDate(l.dateEffet)}. Relisez le périmètre et les honoraires : une lettre validée ne se modifie plus (avenant).`}
                        succes="Lettre validée."
                      />
                    ) : (
                      <p className="text-sm text-texte-doux">La validation est réservée au niveau « Validation » sur ce dossier.</p>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
            {collaboration ? prestations.ok ? <RedigerLettre missionId={m.id} dossierId={id} prestations={refPrestations} lettres={m.lettres} /> : <Alerte ton="attention">Le référentiel des prestations est indisponible.</Alerte> : null}
          </Carte>
        ))}
        {collaboration ? (
          <Carte className="space-y-2">
            <SousTitre className="text-base">Créer une mission</SousTitre>
            <CreerMission dossierId={id} />
          </Carte>
        ) : null}
      </section>

      <section aria-labelledby="titre-travaux" className="space-y-3">
        <SousTitre id="titre-travaux">Travaux et demandes ({travaux.ok ? travaux.donnees.length : '—'})</SousTitre>
        <Alerte ton="neutre" className="text-sm">
          Chaque travail est rattaché à la lettre validée applicable à sa date. L’affectation à une mission est un choix explicite, jamais déduit : un travail affecté est situé par rapport aux seules lettres de sa mission, et n’est compté que dans la rentabilité de celle-ci. « {LIBELLE_RATTACHEMENT.potentiellement_hors_perimetre} » est un signalement, pas une conclusion contractuelle.
        </Alerte>
        {!travaux.ok ? (
          <Alerte ton="attention">Les travaux n’ont pas pu être chargés. {travaux.message}</Alerte>
        ) : travaux.donnees.length === 0 ? (
          <p className="text-texte-doux">Aucun travail enregistré.</p>
        ) : (
          <Tableau legende="Travaux du dossier et rattachement à la lettre applicable">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Prestation et description</th>
                <th scope="col" className="text-right">Temps observé</th>
                <th scope="col">Mission</th>
                <th scope="col">Rattachement</th>
              </tr>
            </thead>
            <tbody>
              {travaux.donnees.map((t) => {
                const r = t.rattachement;
                const lettre = 'lettreId' in r ? versionDe.get(r.lettreId) : undefined;
                // Un projet d'avenant déjà préparé pour ce travail (même date d'effet, prestation ajoutée) : on ne le prépare pas deux fois.
                const projet = toutesLettres.find((l) => l.statut === 'projet' && l.origine === 'proposition_avenant' && l.dateEffet === t.dateTravail && l.contenu.perimetre?.some((p) => p.prestation === t.prestation));
                return (
                  <tr key={t.id} data-travail={t.id} data-situation={r.situation}>
                    <td className="whitespace-nowrap">{formaterDate(t.dateTravail)}</td>
                    <td className="break-words">
                      <span className="font-medium">{libelle(t.prestation)}</span>
                      <span className="block whitespace-pre-wrap">{t.description}</span>
                    </td>
                    <td className="text-right tabular-nums">{t.tempsObserveMinutes === null ? 'Non saisi' : formaterMinutes(t.tempsObserveMinutes)}</td>
                    <td>
                      {collaboration ? (
                        <AffecterTravail travailId={t.id} missionId={t.missionId ?? null} missions={missions.donnees.map((m) => ({ id: m.id, libelle: m.libelle }))} />
                      ) : (
                        <span data-testid="affectation">{missions.donnees.find((m) => m.id === t.missionId)?.libelle ?? 'Non affecté'}</span>
                      )}
                    </td>
                    <td className="space-y-1">
                      <Etiquette ton={TON_RATTACHEMENT[r.situation] ?? 'neutre'} className="whitespace-normal" data-testid="rattachement">
                        {LIBELLE_RATTACHEMENT[r.situation] ?? r.situation}
                      </Etiquette>
                      {lettre ? <span className="block text-sm text-texte-doux">Lettre applicable : version {lettre.version}, effet au {formaterDate(lettre.dateEffet)}</span> : null}
                      {'motif' in r ? <span className="block text-sm break-words">{r.motif}</span> : null}
                      {r.situation === 'potentiellement_hors_perimetre' && collaboration ? <PreparerAvenant travailId={t.id} projetExistant={projet?.version ?? null} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Tableau>
        )}
        {collaboration && prestations.ok ? (
          <Carte className="space-y-2">
            <SousTitre className="text-base">Enregistrer un travail</SousTitre>
            <EnregistrerTravail dossierId={id} prestations={refPrestations} />
          </Carte>
        ) : null}
      </section>

      <section aria-labelledby="titre-bareme" className="space-y-2">
        <SousTitre id="titre-bareme">Barème de temps du cabinet</SousTitre>
        <p className="text-sm text-texte-doux">
          Temps de référence par prestation, commun à tout le cabinet : c’est la base nommée des estimations. Sans barème ni temps observés suffisants, aucune estimation n’est produite.
          {gestionnaire ? '' : ' Sa définition est réservée aux administrateurs et associés.'}
        </p>
        {!baremes.ok ? (
          <Alerte ton="attention">Le barème n’a pas pu être chargé. {baremes.message}</Alerte>
        ) : (
          <Tableau legende="Barème de temps du cabinet par prestation">
            <thead>
              <tr>
                <th scope="col">Prestation</th>
                <th scope="col">Temps de référence</th>
                {gestionnaire ? <th scope="col">Définir (minutes)</th> : null}
              </tr>
            </thead>
            <tbody>
              {refPrestations.map((p) => (
                <tr key={p.code} data-bareme={p.code}>
                  <th scope="row" className="!bg-transparent font-medium">{p.libelle}</th>
                  <td>{baremeDe.has(p.code) ? formaterMinutes(baremeDe.get(p.code)) : <Etiquette ton="vide">Non défini</Etiquette>}</td>
                  {gestionnaire ? (
                    <td>
                      <DefinirBareme prestation={p.code} libelle={p.libelle} actuel={baremeDe.get(p.code) ?? null} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Tableau>
        )}
      </section>
    </div>
  );
}
