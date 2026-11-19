import type { Metadata } from 'next';
import Link from 'next/link';
import { BandeauEtatIa } from '@/components/assistant/affichage';
import { ErreurAcces } from '@/components/erreurs';
import { Alerte, Carte, Etiquette, SousTitre, Tableau, Titre } from '@/components/ui/base';
import { LIBELLE_NATURE_MESURE, type VueIa } from '@/lib/assistant';
import { formaterDate } from '@/lib/montants';
import { tenter } from '@/lib/serveur/api';
import { accesMessagerie } from '@/lib/serveur/messagerie';

export const metadata: Metadata = { title: 'Intelligence artificielle — état et mesures' };

const LIBELLE_STATUT: Record<string, string> = { non_connecte: 'Non connectée', configure_non_verifie: 'Configurée, non vérifiée', connecte: 'Connectée', simule: 'Simulateur de test' };
const NATURES = ['reel', 'simulateur', 'sans_ia'] as const;

export default async function PageAdministrationIa() {
  // Même règle que le reste de l'administration : gestionnaires du cabinet (administrateur, associé) uniquement.
  const acces = await accesMessagerie();
  if (!acces.ok) return <ErreurAcces statut={acces.statut} message={acces.statut === 403 ? 'L’administration du cabinet est réservée aux administrateurs et associés.' : acces.message} />;
  const r = await tenter<VueIa>('v1/ia');
  if (!r.ok) return <ErreurAcces statut={r.statut} message={r.message} retour="/administration" />;
  const ia = r.donnees;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/administration" prefetch={false}>
          ← Administration du cabinet
        </Link>
      </p>
      <Titre>Intelligence artificielle : état et mesures</Titre>
      <BandeauEtatIa etat={ia} />

      <section aria-labelledby="titre-passerelle" className="space-y-2">
        <SousTitre id="titre-passerelle">Passerelle</SousTitre>
        <Carte className="space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">État :</span>
            <Etiquette ton={ia.statut === 'connecte' ? 'succes' : 'attention'} data-testid="statut-passerelle">
              {LIBELLE_STATUT[ia.statut] ?? ia.statut}
            </Etiquette>
            <span className="text-sm text-texte-doux">Fournisseur prévu : {ia.fournisseur}</span>
          </p>
          {ia.raisons.length ? (
            <ul className="list-disc pl-5 text-sm" data-testid="raisons-statut">
              {ia.raisons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-texte-doux">« Connectée » signifie seulement que le service répond : cela ne dit rien de la qualité du modèle sur les tâches du cabinet.</p>
        </Carte>
      </section>

      <section aria-labelledby="titre-modeles" className="space-y-2">
        <SousTitre id="titre-modeles">Modèles figés et consignes versionnées</SousTitre>
        <Carte className="space-y-3">
          <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]" data-testid="modeles-ia">
            <dt className="text-texte-doux">Modèle de langage</dt>
            <dd className="font-mono text-sm break-all">{ia.modeles.langage.id}</dd>
            <dt className="text-texte-doux">Modèle de vecteurs</dt>
            <dd className="font-mono text-sm break-all">
              {ia.modeles.embeddings.id} ({ia.modeles.embeddings.dimensions} dimensions)
            </dd>
            <dt className="text-texte-doux">Tarifs configurés</dt>
            <dd>{ia.tarifs ? `Relevés le ${formaterDate(ia.tarifs.relevesLe)} (${ia.tarifs.devise}) — ${ia.tarifs.source}` : 'Aucun : le coût n’est pas estimé.'}</dd>
          </dl>
          <Tableau legende="Consignes (prompts) et leur version">
            <thead>
              <tr>
                <th scope="col">Tâche</th>
                <th scope="col">Consigne</th>
                <th scope="col">Version</th>
              </tr>
            </thead>
            <tbody>
              {ia.prompts.map((p) => (
                <tr key={p.tache}>
                  <td className="font-mono">{p.tache}</td>
                  <td className="font-mono">{p.id}</td>
                  <td>{p.version}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </Carte>
      </section>

      <section aria-labelledby="titre-mesures" className="space-y-2">
        <SousTitre id="titre-mesures">Mesures</SousTitre>
        {ia.mesures ? (
          <>
            <p className="text-sm text-texte-doux">{ia.mesures.mention}</p>
            <Tableau legende="Totaux par nature d’appel">
              <thead>
                <tr>
                  <th scope="col">Nature</th>
                  <th scope="col" className="text-right">Appels de modèle</th>
                  <th scope="col" className="text-right">Réussis</th>
                  <th scope="col" className="text-right">Abstentions</th>
                  <th scope="col" className="text-right">Rejets</th>
                  <th scope="col" className="text-right">Erreurs</th>
                  <th scope="col" className="text-right">IA indisponible</th>
                  <th scope="col" className="text-right">Fonctions exécutées</th>
                  <th scope="col" className="text-right">Fonctions refusées</th>
                </tr>
              </thead>
              <tbody>
                {NATURES.map((n) => {
                  const t = ia.mesures?.totaux[n];
                  return t ? (
                    <tr key={n} data-nature-mesure={n}>
                      <th scope="row">{LIBELLE_NATURE_MESURE[n]}</th>
                      <td className="text-right tabular-nums">{t.appelsModele}</td>
                      <td className="text-right tabular-nums">{t.reussis}</td>
                      <td className="text-right tabular-nums">{t.abstentions}</td>
                      <td className="text-right tabular-nums">{t.rejets}</td>
                      <td className="text-right tabular-nums">{t.erreurs}</td>
                      <td className="text-right tabular-nums">{t.indisponibles}</td>
                      <td className="text-right tabular-nums">{t.fonctionsExecutees}</td>
                      <td className="text-right tabular-nums">{t.fonctionsRefusees}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </Tableau>
            {ia.mesures.parTache.length ? (
              <Tableau legende="Détail par tâche et par résultat">
                <thead>
                  <tr>
                    <th scope="col">Nature</th>
                    <th scope="col">Type</th>
                    <th scope="col">Tâche</th>
                    <th scope="col">Résultat</th>
                    <th scope="col" className="text-right">Nombre</th>
                    <th scope="col" className="text-right">Durée moyenne</th>
                    <th scope="col" className="text-right">Coût estimé</th>
                  </tr>
                </thead>
                <tbody>
                  {ia.mesures.parTache.map((l, i) => (
                    <tr key={i}>
                      <td>{LIBELLE_NATURE_MESURE[l.nature] ?? l.nature}</td>
                      <td>{l.type === 'appel_ia' ? 'Appel de modèle' : 'Fonction métier'}</td>
                      <td className="font-mono">{l.tache}</td>
                      <td>{l.resultat}</td>
                      <td className="text-right tabular-nums">{l.nombre}</td>
                      <td className="text-right tabular-nums">{l.dureeMoyenneMs === null ? '—' : `${l.dureeMoyenneMs} ms`}</td>
                      <td className="text-right tabular-nums">{l.coutEstime === null ? 'non estimé' : `${l.coutEstime} ${l.devise ?? ''}`}</td>
                    </tr>
                  ))}
                </tbody>
              </Tableau>
            ) : (
              <p className="text-texte-doux" data-testid="aucune-mesure">
                Aucun appel enregistré pour ce cabinet.
              </p>
            )}
          </>
        ) : (
          <Alerte ton="neutre">{ia.mesuresReservees ?? 'Mesures indisponibles.'}</Alerte>
        )}
      </section>
    </div>
  );
}
