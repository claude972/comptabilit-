'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type DragEvent, useCallback, useId, useRef, useState } from 'react';
import { Alerte, Etiquette, Libelle, Liste, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { cn } from '@/lib/cn';
import { LIBELLE_NATURE, LIBELLE_STATUT_DONNEES } from '@/lib/libelles';
import { formaterTaille } from '@/lib/montants';
import { type EtatDepot, LIBELLE_ETAT_DEPOT, transition } from '@/lib/televersement/etats';
import { type Ouverture, televerser } from '@/lib/televersement/moteur';
import { sha256Hex, transportBff } from '@/lib/televersement/transport-bff';
import type { NatureDocument, StatutDonnees, VueTerminee } from '@/lib/types-api';

interface Envoi {
  id: string;
  fichier: File;
  ouverture: Omit<Ouverture, 'sha256' | 'taille'>;
  etat: EtatDepot;
  octetsConfirmes: number;
  televersementId: string | null;
  message: string | null;
  resultat: VueTerminee | null;
}

/**
 * Envois depuis l'ordinateur, avec le même protocole reprenable que le téléphone. Les fichiers restent en mémoire :
 * un envoi interrompu se reprend tant que la page est ouverte (ou en resélectionnant le même fichier, le serveur
 * renvoyant alors les octets déjà reçus).
 */
function useEnvois(surRecu?: (v: VueTerminee) => void) {
  const [envois, setEnvois] = useState<Envoi[]>([]);
  const liste = useRef<Envoi[]>([]);
  const boucle = useRef(false);
  const publier = (l: Envoi[]) => {
    liste.current = l;
    setEnvois(l);
  };
  const appliquer = (id: string, m: Partial<Envoi>) => publier(liste.current.map((e) => (e.id === id ? { ...e, ...m } : e)));

  const traiter = useCallback(async () => {
    if (boucle.current) return;
    boucle.current = true;
    try {
      for (;;) {
        const e = liste.current.find((x) => x.etat === 'en_file');
        if (!e) break;
        appliquer(e.id, { etat: 'envoi', message: null });
        try {
          const sha256 = await sha256Hex(e.fichier);
          const issue = await televerser({
            fichier: e.fichier,
            ouverture: { ...e.ouverture, sha256, taille: e.fichier.size },
            transport: transportBff,
            televersementId: e.televersementId,
            surProgression: (p) => appliquer(e.id, { octetsConfirmes: p.octetsConfirmes, televersementId: p.televersementId }),
          });
          const etat = transition('envoi', { type: 'issue', issue, enLigne: navigator.onLine });
          const message = issue.issue === 'refuse' || issue.issue === 'interrompu' ? issue.message : issue.issue === 'session_expiree' ? 'Session expirée : rechargez la page pour vous reconnecter.' : null;
          appliquer(e.id, { etat, message, resultat: issue.issue === 'recu' ? issue.vue : null });
          if (issue.issue === 'recu') surRecu?.(issue.vue);
        } catch {
          appliquer(e.id, { etat: 'interrompu', message: 'Lecture du fichier impossible (fichier trop volumineux pour la mémoire de ce navigateur ?).' });
        }
      }
    } finally {
      boucle.current = false;
    }
    // `surRecu` est stable du point de vue de l'appelant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ajouter = (fichiers: File[], ouverture: (f: File) => Omit<Ouverture, 'sha256' | 'taille'>) => {
    publier([
      ...liste.current,
      ...fichiers.filter((f) => f.size > 0).map((f) => ({ id: crypto.randomUUID(), fichier: f, ouverture: ouverture(f), etat: 'en_file' as const, octetsConfirmes: 0, televersementId: null, message: null, resultat: null })),
    ]);
    void traiter();
  };
  const reprendre = (id: string) => {
    appliquer(id, { etat: 'en_file', message: null });
    void traiter();
  };
  return { envois, ajouter, reprendre };
}

function ListeEnvois({ envois, surReprise, recu }: { envois: Envoi[]; surReprise: (id: string) => void; recu: (e: Envoi) => string }) {
  if (!envois.length) return null;
  return (
    <ul className="space-y-2" data-testid="liste-envois">
      {envois.map((e) => (
        <li key={e.id} className="space-y-1 rounded-lg border border-bordure p-3" data-etat={e.etat}>
          <p className="flex flex-wrap items-center gap-2">
            <Etiquette ton={e.etat === 'recu' ? 'succes' : e.etat === 'refuse' ? 'danger' : e.etat === 'envoi' ? 'info' : 'attention'}>{LIBELLE_ETAT_DEPOT[e.etat]}</Etiquette>
            <span className="font-medium break-all">{e.fichier.name}</span>
            <span className="text-sm text-texte-doux">{formaterTaille(e.fichier.size)}</span>
          </p>
          {e.etat !== 'recu' && e.etat !== 'refuse' ? (
            <progress value={e.octetsConfirmes} max={e.fichier.size} aria-label={`Progression de l’envoi de ${e.fichier.name} (octets confirmés par le serveur)`} />
          ) : null}
          {e.etat === 'recu' ? <p className="text-sm">{recu(e)}</p> : null}
          {e.message ? <p className="text-sm">{e.message}</p> : null}
          {e.etat === 'interrompu' || e.etat === 'attente_connexion' ? (
            <Bouton variante="secondaire" onClick={() => surReprise(e.id)}>
              Reprendre l’envoi
            </Bouton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const NATURES: NatureDocument[] = ['a_qualifier', 'facture_achat', 'facture_vente', 'avoir', 'releve_bancaire', 'lettre_mission', 'contrat', 'autre'];

/** Dépôt de pièces depuis l'ordinateur : glisser-déposer ou sélection, canal « ordinateur ». */
export function DepotOrdinateur({ entiteId }: { entiteId: string }) {
  const routeur = useRouter();
  const { envois, ajouter, reprendre } = useEnvois(() => routeur.refresh());
  const [nature, setNature] = useState<NatureDocument>('a_qualifier');
  const [survol, setSurvol] = useState(false);
  const id = useId();
  const deposer = (fichiers: File[]) =>
    ajouter(fichiers, (f) => ({ entiteId, nomFichier: f.name.slice(0, 255), ...(f.type ? { typeMime: f.type.slice(0, 100) } : {}), canal: 'ordinateur', usage: 'piece', nature }));
  const surDepot = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setSurvol(false);
    deposer(Array.from(e.dataTransfer.files));
  };
  return (
    <section aria-labelledby={`${id}-titre`} className="space-y-3">
      <SousTitre id={`${id}-titre`}>Déposer des pièces depuis cet ordinateur</SousTitre>
      <div className="max-w-sm">
        <Libelle htmlFor={`${id}-nature`}>Nature des pièces déposées</Libelle>
        <Liste id={`${id}-nature`} value={nature} onChange={(e) => setNature(e.target.value as NatureDocument)}>
          {NATURES.map((n) => (
            <option key={n} value={n}>
              {LIBELLE_NATURE[n]}
            </option>
          ))}
        </Liste>
      </div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={surDepot}
        className={cn(
          'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-bordure bg-surface p-6 text-center focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-anneau',
          survol && 'border-primaire bg-surface-2',
        )}
        data-testid="zone-depot"
      >
        <Upload aria-hidden="true" className="size-8" />
        <span className="font-medium">Glissez-déposez des fichiers ici, ou cliquez pour les choisir</span>
        <span className="text-sm text-texte-doux">PDF, images ou XML de facture. Chaque fichier est envoyé tel quel et devient une pièce.</span>
        <input
          type="file"
          multiple
          className="sr-only"
          data-testid="entree-pieces"
          onChange={(e) => {
            deposer(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>
      <div aria-live="polite">
        <ListeEnvois envois={envois} surReprise={reprendre} recu={(e) => (e.resultat?.doublonBinaire ? 'Cette pièce avait déjà été reçue.' : 'Pièce reçue : elle apparaît dans la file ci-dessous.')} />
      </div>
    </section>
  );
}

const STATUTS: StatutDonnees[] = ['travail_avant_cloture', 'fec'];

/** Import d'un FEC ou d'une extraction de travail : le statut des données est un choix explicite, jamais présumé. */
export function ImportComptable({ entiteId, exerciceId, cheminRetour }: { entiteId: string; exerciceId: string; cheminRetour: string }) {
  const routeur = useRouter();
  const { envois, ajouter, reprendre } = useEnvois((v) => {
    if (v.lotImportId) routeur.push(`${cheminRetour}&lot=${v.lotImportId}`);
    routeur.refresh();
  });
  const [statut, setStatut] = useState<StatutDonnees | ''>('');
  const [fichier, setFichier] = useState<File | null>(null);
  const id = useId();
  const entree = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby={`${id}-titre`} className="space-y-3">
      <SousTitre id={`${id}-titre`}>Importer des écritures comptables</SousTitre>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!fichier || statut === '') return;
          ajouter([fichier], (f) => ({ entiteId, nomFichier: f.name.slice(0, 255), typeMime: 'text/plain', canal: 'ordinateur', usage: 'fec', exerciceId, statutDonnees: statut }));
          setFichier(null);
          if (entree.current) entree.current.value = '';
        }}
      >
        <fieldset>
          <legend className="mb-1 font-medium">Statut des données importées (obligatoire)</legend>
          <div className="flex flex-wrap gap-2">
            {STATUTS.map((s) => (
              <label key={s} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-bordure px-3', statut === s && 'border-primaire bg-surface-2')}>
                <input type="radio" name={`${id}-statut`} value={s} checked={statut === s} onChange={() => setStatut(s)} required className="size-5" />
                {LIBELLE_STATUT_DONNEES[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Libelle htmlFor={`${id}-fichier`}>Fichier des écritures (texte, séparateur tabulation ou « | »)</Libelle>
          <input
            ref={entree}
            id={`${id}-fichier`}
            type="file"
            accept=".txt,.csv,.fec,text/plain,text/csv"
            required
            data-testid="entree-fec"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            className="block min-h-11 w-full max-w-lg rounded-lg border border-bordure bg-surface p-2"
          />
        </div>
        <Bouton type="submit" disabled={!fichier || statut === ''}>
          <Upload aria-hidden="true" className="size-5" /> Importer
        </Bouton>
        <Alerte ton="neutre" className="text-sm">
          L’empreinte du fichier est calculée sur ce poste avant l’envoi : un fichier très volumineux demande autant de mémoire que sa taille.
          L’import crée une nouvelle version des données de l’exercice ; les versions précédentes sont conservées.
        </Alerte>
      </form>
      <div aria-live="polite">
        <ListeEnvois envois={envois} surReprise={reprendre} recu={(e) => (e.resultat?.dejaImporte ? 'Ce fichier avait déjà été importé pour cet exercice : aucun nouveau lot n’a été créé.' : 'Fichier reçu : l’analyse démarre.')} />
      </div>
    </section>
  );
}
