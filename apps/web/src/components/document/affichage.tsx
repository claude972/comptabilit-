import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';
import { Alerte, Etiquette, MentionProjet, SousTitre, Tableau, type Ton } from '@/components/ui/base';
import { CHAMPS_DATE, CHAMPS_MONTANT, LIBELLE_CANAL, LIBELLE_CHAMP, LIBELLE_METHODE, LIBELLE_STATUT_DOCUMENT } from '@/lib/libelles';
import { formaterDate, formaterHorodatage, formaterMontant } from '@/lib/montants';
import { CHAMPS_FACTURE, type DetailDocument, type Echange, type Extraction, type NomChamp, type StatutDocument, type Verification } from '@/lib/types-api';

const TON_STATUT: Record<StatutDocument, Ton> = {
  recu: 'info',
  en_analyse: 'info',
  a_completer: 'attention',
  a_controler: 'neutre',
  traite: 'succes',
  quarantaine: 'danger',
  rejete: 'danger',
};

export function EtiquetteStatutDocument({ statut }: { statut: StatutDocument }) {
  return <Etiquette ton={TON_STATUT[statut] ?? 'neutre'}>{LIBELLE_STATUT_DOCUMENT[statut] ?? statut}</Etiquette>;
}

/** Une extraction n'est « validée » que si un professionnel habilité l'a validée ; sinon c'est un projet. */
export function estValidee(e: Extraction | null): boolean {
  return e?.statut === 'valide';
}

function valeurAffichee(nom: NomChamp, valeur: string): string {
  if (CHAMPS_MONTANT.includes(nom)) return formaterMontant(valeur);
  if (CHAMPS_DATE.includes(nom)) return formaterDate(valeur);
  if (nom === 'typeDocument') return { facture: 'Facture', avoir: 'Avoir', inconnu: 'Indéterminé' }[valeur] ?? valeur;
  return valeur;
}

/** Champs extraits, avec pour chacun la méthode, la confiance et (si demandé) la preuve : page et extrait de texte. */
export function ChampsExtraits({ extraction, avecPreuves }: { extraction: Extraction; avecPreuves: boolean }) {
  const valide = estValidee(extraction);
  const tva = extraction.champs.ventilationTva ?? [];
  return (
    <section className="space-y-2" aria-labelledby="titre-champs">
      <div className="flex flex-wrap items-center gap-2">
        <SousTitre id="titre-champs">Champs extraits</SousTitre>
        {valide ? <Etiquette ton="succes">Validé par un réviseur (version {extraction.version})</Etiquette> : <MentionProjet>Extraction automatique — projet</MentionProjet>}
        <span className="text-sm text-texte-doux">Version {extraction.version}</span>
      </div>
      {!valide ? (
        <p className="text-sm text-texte-doux">
          Ces valeurs sont une proposition {extraction.methode === 'saisie_humaine' ? 'issue d’une saisie' : 'issue d’une lecture automatique'} de la pièce. Elles ne sont pas validées.
        </p>
      ) : null}
      <Tableau legende="Champs extraits de la pièce">
        <thead>
          <tr>
            <th scope="col">Champ</th>
            <th scope="col">Valeur</th>
            <th scope="col">Méthode</th>
            <th scope="col">Confiance</th>
            {avecPreuves ? <th scope="col">Preuve</th> : null}
          </tr>
        </thead>
        <tbody>
          {CHAMPS_FACTURE.map((nom) => {
            const c = extraction.champs[nom];
            return (
              <tr key={nom} data-champ={nom}>
                <th scope="row" className="!bg-transparent font-medium">{LIBELLE_CHAMP[nom]}</th>
                <td className={CHAMPS_MONTANT.includes(nom) ? 'text-right tabular-nums' : undefined}>{c ? valeurAffichee(nom, String(c.valeur)) : <span className="text-texte-doux">Non extrait</span>}</td>
                <td>{c ? (LIBELLE_METHODE[c.methode] ?? c.methode) : '—'}</td>
                <td>{c ? 'Non évaluée' : '—'}</td>
                {avecPreuves ? (
                  <td>
                    {c?.page ? <span className="block">Page {c.page}</span> : null}
                    {c?.extrait ? <q className="block break-words text-texte-doux">{c.extrait}</q> : null}
                    {c && !c.page && !c.extrait ? <span className="text-texte-doux">{c.methode === 'saisie_humaine' ? 'Saisie, sans extrait' : 'Aucune'}</span> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Tableau>
      {tva.length ? (
        <Tableau legende="Ventilation de TVA extraite">
          <thead>
            <tr>
              <th scope="col">Taux (%)</th>
              <th scope="col" className="text-right">Base HT</th>
              <th scope="col" className="text-right">TVA</th>
            </tr>
          </thead>
          <tbody>
            {tva.map((l, i) => (
              <tr key={i}>
                <td>{String(l.taux).replace('.', ',')}</td>
                <td className="text-right tabular-nums">{formaterMontant(l.base)}</td>
                <td className="text-right tabular-nums">{formaterMontant(l.montant)}</td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      ) : null}
      <p className="text-sm text-texte-doux">
        Méthode d’extraction : {extraction.methode}
        {extraction.moteur ? ` (${extraction.moteur})` : ''}.
      </p>
    </section>
  );
}

const VERIFICATION: Record<Verification['statut'], { ton: Ton; libelle: string }> = {
  ok: { ton: 'succes', libelle: 'Cohérent' },
  ecart: { ton: 'danger', libelle: 'Écart' },
  non_verifiable: { ton: 'vide', libelle: 'Non vérifiable' },
};

/** Vérifications arithmétiques calculées par le serveur ; l'interface n'effectue aucun calcul. */
export function Verifications({ verifications }: { verifications: Verification[] }) {
  return (
    <section className="space-y-2" aria-labelledby="titre-verifications">
      <SousTitre id="titre-verifications">Vérifications arithmétiques</SousTitre>
      {verifications.length === 0 ? (
        <p className="text-texte-doux">Aucune vérification disponible.</p>
      ) : (
        <ul className="space-y-2">
          {verifications.map((v) => {
            const s = VERIFICATION[v.statut] ?? VERIFICATION.non_verifiable;
            const Icone = v.statut === 'ok' ? CircleCheck : v.statut === 'ecart' ? CircleAlert : CircleHelp;
            return (
              <li key={v.code} className="flex items-start gap-2 rounded-lg border border-bordure p-2" data-verification={v.statut}>
                <Etiquette ton={s.ton} className="shrink-0">
                  <Icone aria-hidden="true" className="size-4" /> {s.libelle}
                </Etiquette>
                <span>
                  {v.message}
                  {v.statut === 'ecart' && v.ecart ? <span className="block text-sm text-texte-doux">Écart : {formaterMontant(v.ecart)}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-texte-doux">Contrôles de cohérence formels : ils ne prouvent ni l’authenticité de la pièce ni l’existence de l’émetteur.</p>
    </section>
  );
}

const TYPE_ECHANGE: Record<Echange['type'], string> = {
  signalement_erreur: 'Signalement d’erreur',
  demande_complement: 'Demande de complément',
  reponse: 'Réponse',
};

export function Echanges({ echanges }: { echanges: Echange[] }) {
  if (!echanges.length) return null;
  return (
    <section className="space-y-2" aria-labelledby="titre-echanges">
      <SousTitre id="titre-echanges">Échanges</SousTitre>
      <ul className="space-y-2">
        {echanges.map((e) => (
          <li key={e.id} className="rounded-lg border border-bordure p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Etiquette ton={e.type === 'demande_complement' && !e.resolu ? 'attention' : 'neutre'}>{TYPE_ECHANGE[e.type] ?? e.type}</Etiquette>
              {e.type === 'demande_complement' ? <span>{e.resolu ? 'Répondue' : 'En attente de réponse'}</span> : null}
              <span className="text-texte-doux">
                {e.auteur} · {formaterHorodatage(e.creeLe)}
              </span>
            </p>
            <p className="mt-1 break-words whitespace-pre-wrap">{e.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Receptions({ receptions }: { receptions: DetailDocument['receptions'] }) {
  return (
    <section className="space-y-1" aria-labelledby="titre-receptions">
      <SousTitre id="titre-receptions" className="text-base">Réceptions</SousTitre>
      <ul className="text-sm">
        {receptions.map((r) => (
          <li key={r.id}>
            {formaterHorodatage(r.recuLe)} · {LIBELLE_CANAL[r.canal] ?? r.canal}
            {r.parMoi ? ' · par vous' : ''}
            {r.doublonBinaire ? ' · fichier identique déjà reçu' : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MotifStatut({ statut, motif }: { statut: StatutDocument; motif: string | null }) {
  if (!motif) return null;
  return (
    <Alerte ton={statut === 'quarantaine' || statut === 'rejete' ? 'danger' : statut === 'a_completer' ? 'attention' : 'neutre'} titre="Motif">
      <p className="break-words whitespace-pre-wrap">{motif}</p>
    </Alerte>
  );
}
