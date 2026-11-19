import type { Metadata } from 'next';
import Link from 'next/link';
import { ChangerOffre, Resilier } from '@/components/abonnement-actions';
import { ErreurAcces } from '@/components/erreurs';
import { ServiceFerme } from '@/components/service-ferme';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { type DetailAbonnement, type Echeance, type EvenementFacturation, LIBELLE_EVENEMENT, LIBELLE_PAIEMENT, LIBELLE_SITUATION, type LigneEcheance, type Offre, type Quota, decrireTranches, detailEvenement } from '@/lib/abonnement';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Abonnement du cabinet' };

function Fictif() {
  return (
    <Etiquette ton="attention" data-testid="montants-fictifs">
      Montants de démonstration fictifs
    </Etiquette>
  );
}

function LigneQuota({ libelle, q, unite }: { libelle: string; q: Quota; unite: string }) {
  return (
    <li className="rounded-lg border border-bordure p-3" data-quota={libelle} data-depasse={q.depasse}>
      <p className="font-medium">{libelle}</p>
      <p>
        {q.consomme.toLocaleString('fr-FR')} {unite}
        {q.limite !== null ? ` sur ${q.limite.toLocaleString('fr-FR')} inclus` : ' (sans limite)'}
        {q.tauxPourcent !== null ? ` — ${q.tauxPourcent.toLocaleString('fr-FR')} %` : ''}
      </p>
      {q.limite !== null ? <progress value={Math.min(q.consomme, q.limite)} max={q.limite} aria-label={`${libelle} consommé`} /> : null}
      {q.depasse ? <Etiquette ton="attention">Quota dépassé</Etiquette> : null}
    </li>
  );
}

function Lignes({ lignes }: { lignes: LigneEcheance[] }) {
  return (
    <Tableau legende="Lignes de l’échéance">
      <thead>
        <tr>
          <th scope="col">Ligne</th>
          <th scope="col" className="text-right">Quantité</th>
          <th scope="col" className="text-right">Prix unitaire HT</th>
          <th scope="col" className="text-right">Montant HT</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i}>
            <td>{l.libelle}</td>
            <td className="text-right tabular-nums">{l.quantite}</td>
            <td className="text-right tabular-nums">{formaterMontant(l.prixUnitaire)}</td>
            <td className="text-right tabular-nums">{formaterMontant(l.montant)}</td>
          </tr>
        ))}
      </tbody>
    </Tableau>
  );
}

export default async function PageAbonnement() {
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.statut === 403 ? 'L’abonnement du cabinet est réservé aux administrateurs et associés.' : acces.message} />;
  const [detail, offres, echeances, historique] = await Promise.all([
    tenter<DetailAbonnement>('v1/abonnement'),
    tenter<Offre[]>('v1/abonnement/offres'),
    tenter<Echeance[]>('v1/abonnement/echeances'),
    tenter<EvenementFacturation[]>('v1/abonnement/historique'),
  ]);
  if (!detail.ok) return <ErreurAcces statut={detail.statut} message={detail.message} retour="/administration" />;
  const { situation, serviceOuvert, abonnement, offre, usage, estimation } = detail.donnees;
  const libelleOffre = (code: string) => (offres.ok ? offres.donnees.find((o) => o.code === code)?.libelle : undefined) ?? code;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/administration" prefetch={false}>
          ← Retour à l’administration
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Titre>Abonnement du cabinet</Titre>
        <Etiquette ton={serviceOuvert ? (situation === 'actif' ? 'succes' : 'info') : 'danger'} data-testid="situation-abonnement" data-situation={situation}>
          {LIBELLE_SITUATION[situation] ?? situation}
        </Etiquette>
        {offre?.fictif ? <Fictif /> : null}
      </div>
      {!serviceOuvert ? <ServiceFerme situation={situation} /> : null}
      {situation === 'essai' && abonnement?.finEssai ? <Alerte ton="info">Période d’essai jusqu’au {formaterDate(abonnement.finEssai)} inclus.</Alerte> : null}
      {situation === 'resiliation_programmee' && abonnement?.fin ? (
        <Alerte ton="attention" data-testid="resiliation-programmee">
          Résiliation enregistrée : le service reste ouvert jusqu’au {formaterDate(abonnement.fin)}. Les données ne sont pas supprimées.
        </Alerte>
      ) : null}
      {!abonnement || !offre ? (
        <Alerte ton="attention">Aucun abonnement n’est ouvert pour ce cabinet. L’ouverture se fait auprès de l’éditeur.</Alerte>
      ) : (
        <>
          <Carte className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SousTitre>Offre : {offre.libelle}</SousTitre>
              {offre.fictif ? <Fictif /> : null}
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-texte-doux">Forfait mensuel HT</dt>
              <dd className="tabular-nums">{formaterMontant(offre.forfaitMensuel)}</dd>
              <dt className="text-texte-doux">Dossiers actifs inclus</dt>
              <dd>{offre.dossiersInclus}</dd>
              <dt className="text-texte-doux">Depuis le</dt>
              <dd>{formaterDate(abonnement.debut)}</dd>
            </dl>
            {offre.tranches.length ? (
              <Tableau legende="Tranches au-delà des dossiers inclus">
                <thead>
                  <tr>
                    <th scope="col">Dossiers supplémentaires</th>
                    <th scope="col" className="text-right">Prix par dossier et par mois, HT</th>
                  </tr>
                </thead>
                <tbody>
                  {decrireTranches(offre).map((t) => (
                    <tr key={t.portee}>
                      <td>{t.portee}</td>
                      <td className="text-right tabular-nums">{formaterMontant(t.prix)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            ) : null}
            {abonnement.offreDemandee ? (
              <Alerte ton="info" data-testid="changement-demande">
                Changement demandé vers « {libelleOffre(abonnement.offreDemandee)} » : il sera appliqué à la prochaine échéance.
              </Alerte>
            ) : null}
          </Carte>

          {usage ? (
            <section aria-labelledby="titre-usage" className="space-y-2">
              <SousTitre id="titre-usage">Consommation</SousTitre>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <li className="rounded-lg border border-bordure p-3" data-quota="Dossiers actifs" data-depasse={usage.dossiersActifs > usage.dossiersInclus}>
                  <p className="font-medium">Dossiers actifs</p>
                  <p>
                    {usage.dossiersActifs} pour {usage.dossiersInclus} inclus dans le forfait
                  </p>
                  {usage.dossiersActifs > usage.dossiersInclus ? <Etiquette ton="info">{usage.dossiersActifs - usage.dossiersInclus} au-delà du forfait (facturés selon les tranches)</Etiquette> : null}
                </li>
                <LigneQuota libelle="Pièces reçues ce mois" q={usage.piecesCeMois} unite="pièces" />
                <LigneQuota libelle="Stockage" q={usage.stockageGo} unite="Go" />
              </ul>
              <p className="text-sm text-texte-doux" data-testid="quota-non-bloquant">Un dépassement de quota est signalé ici, mais il n’empêche pas la collecte : les dépôts et imports continuent.</p>
            </section>
          ) : null}

          {estimation ? (
            <Carte className="space-y-2" data-testid="estimation">
              <div className="flex flex-wrap items-center gap-2">
                <SousTitre>Estimation de la prochaine échéance</SousTitre>
                {estimation.fictif ? <Fictif /> : null}
              </div>
              {estimation.statut === 'calcule' ? (
                <>
                  <Lignes lignes={estimation.lignes} />
                  <p className="font-semibold tabular-nums">Total HT estimé : {formaterMontant(estimation.totalHt)}</p>
                  <p className="text-sm text-texte-doux">
                    Calculée par le serveur pour {estimation.dossiersActifs} dossier{estimation.dossiersActifs > 1 ? 's' : ''} actif{estimation.dossiersActifs > 1 ? 's' : ''}, dont {estimation.dossiersFactures} au-delà du forfait. C’est une estimation, pas une facture.
                  </p>
                </>
              ) : (
                <Alerte ton="attention">Estimation non calculable : {estimation.motif ?? 'motif non précisé'}.</Alerte>
              )}
            </Carte>
          ) : null}
        </>
      )}

      <section aria-labelledby="titre-echeances" className="space-y-2">
        <SousTitre id="titre-echeances">Échéances</SousTitre>
        <Alerte ton="neutre" className="text-sm" data-testid="paiement-editeur">
          Le paiement se fait par virement, en rappelant la référence indiquée. Les paiements sont rapprochés par l’éditeur : le statut d’une échéance ne
          se modifie pas depuis cet écran.
        </Alerte>
        {!echeances.ok ? (
          <Alerte ton="attention">Les échéances n’ont pas pu être chargées.</Alerte>
        ) : echeances.donnees.length ? (
          <Tableau legende="Échéances émises et paiement">
            <thead>
              <tr>
                <th scope="col">Période</th>
                <th scope="col">Offre</th>
                <th scope="col" className="text-right">Total HT</th>
                <th scope="col">Paiement</th>
                <th scope="col">Référence du virement</th>
              </tr>
            </thead>
            <tbody>
              {echeances.donnees.map((e) => (
                <tr key={e.id} data-echeance={e.id}>
                  <td className="whitespace-nowrap">
                    {formaterDate(e.periodeDebut)} → {formaterDate(e.periodeFin)}
                  </td>
                  <td>{libelleOffre(e.offre)}</td>
                  <td className="text-right tabular-nums">
                    {formaterMontant(e.totalHt)}
                    {e.fictif ? <span className="block text-xs">Montants de démonstration fictifs</span> : null}
                  </td>
                  <td>
                    <Etiquette ton={e.statutPaiement === 'paye' ? 'succes' : e.statutPaiement === 'en_retard' ? 'danger' : e.statutPaiement === 'annulee' ? 'neutre' : 'attention'}>{LIBELLE_PAIEMENT[e.statutPaiement] ?? e.statutPaiement}</Etiquette>
                    {e.payeLe ? <span className="block text-sm">le {formaterDate(e.payeLe)}</span> : null}
                  </td>
                  <td className="font-mono break-all">{e.referenceVirement}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        ) : (
          <p className="text-texte-doux">Aucune échéance émise pour le moment.</p>
        )}
      </section>

      {abonnement && situation !== 'resilie' && situation !== 'resiliation_programmee' ? (
        <Carte className="space-y-4">
          {offres.ok && offres.donnees.length ? <ChangerOffre offres={offres.donnees.map((o) => ({ code: o.code, libelle: o.libelle }))} actuelle={abonnement.offre} demandee={abonnement.offreDemandee} /> : null}
          <Resilier />
        </Carte>
      ) : null}

      <section aria-labelledby="titre-historique" className="space-y-2">
        <SousTitre id="titre-historique">Historique</SousTitre>
        {historique.ok && historique.donnees.length ? (
          <ul className="space-y-1" data-testid="historique-abonnement">
            {historique.donnees.map((h) => (
              <li key={h.id} className="rounded-lg border border-bordure p-2 text-sm">
                <span className="font-medium">{LIBELLE_EVENEMENT[h.type] ?? h.type}</span> · {formaterHorodatage(h.creeLe)}
                {h.montant ? <span className="tabular-nums"> · {formaterMontant(h.montant)}</span> : null}
                {detailEvenement(h.detail) ? <span className="block text-texte-doux break-words">{detailEvenement(h.detail)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-texte-doux">Aucun élément.</p>
        )}
      </section>
    </div>
  );
}
