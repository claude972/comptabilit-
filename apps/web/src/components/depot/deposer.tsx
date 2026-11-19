'use client';

import { ArrowDown, ArrowUp, Camera, CircleCheck, FileText, FolderOpen, Pencil, Plus, Send, Trash2, TriangleAlert, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { InviteInstallation } from '@/components/pwa';
import { ServiceFerme } from '@/components/service-ferme';
import { Alerte, Carte, Etiquette, Libelle, Liste, SousTitre, Titre, ZoneTexte } from '@/components/ui/base';
import { Bouton, styleBouton } from '@/components/ui/bouton';
import { cn } from '@/lib/cn';
import { CADRE_COMPLET, type Cadre, type QuartsDeTour, tournerCadre, tournerQuart } from '@/lib/image/geometrie';
import type { Lisibilite } from '@/lib/image/lisibilite';
import { ErreurImage, assemblerPdf, decoder, dessiner, mesurerLisibilite, produirePage, versBlob } from '@/lib/image/navigateur';
import { NATURES_DEPOT } from '@/lib/libelles';
import { formaterTaille } from '@/lib/montants';
import { LIBELLE_ETAT_DEPOT } from '@/lib/televersement/etats';
import { sha256Hex } from '@/lib/televersement/transport-bff';
import type { NatureDocument } from '@/lib/types-api';
import { EditeurPage, IndicateurLisibilite } from './editeur-page';
import { type DepotSuivi, useDepots } from './file-depots';

interface PageEnCours {
  id: string;
  fichier: File;
  rotation: QuartsDeTour;
  cadre: Cadre;
  apercu: string;
  lisibilite: Lisibilite | null;
}

const COTE_APERCU = 1000;

async function apercuDe(fichier: Blob, rotation: QuartsDeTour, avecMesure: boolean): Promise<{ apercu: string; lisibilite: Lisibilite | null }> {
  const image = await decoder(fichier);
  try {
    const lisibilite = avecMesure ? mesurerLisibilite(image) : null;
    const blob = await versBlob(dessiner(image, rotation, null, COTE_APERCU), 'image/jpeg', 0.8);
    return { apercu: URL.createObjectURL(blob), lisibilite };
  } finally {
    image.liberer();
  }
}

function nomAssemblage(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `photos-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.pdf`;
}

const estPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

export function Deposer({ utilisateurId, dossiers, serviceFerme = null }: { utilisateurId: string; dossiers: Array<{ id: string; raisonSociale: string }>; serviceFerme?: string | null }) {
  const file = useDepots(utilisateurId);
  const [entiteId, setEntiteId] = useState(dossiers.length === 1 ? dossiers[0]!.id : '');
  const [pages, setPages] = useState<PageEnCours[]>([]);
  const [pdfs, setPdfs] = useState<Array<{ id: string; fichier: File }>>([]);
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [nature, setNature] = useState<NatureDocument | ''>('');
  const [commentaire, setCommentaire] = useState('');
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [capacites, setCapacites] = useState<{ empreinte: boolean; image: boolean } | null>(null);
  const idBase = useId();
  const refPages = useRef<PageEnCours[]>([]);
  refPages.current = pages;

  useEffect(() => {
    setCapacites({
      empreinte: typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.randomUUID === 'function',
      image: typeof document.createElement('canvas').getContext === 'function' && !!document.createElement('canvas').getContext('2d'),
    });
    // Chargée dès l'ouverture : l'assemblage PDF reste possible si la connexion disparaît ensuite.
    void import('pdf-lib').catch(() => undefined);
    return () => {
      for (const p of refPages.current) URL.revokeObjectURL(p.apercu);
    };
  }, []);

  async function ajouterFichiers(e: ChangeEvent<HTMLInputElement>) {
    const fichiers = Array.from(e.target.files ?? []);
    e.target.value = ''; // permet de reprendre la même photo
    if (!fichiers.length) return;
    setErreur(null);
    setOccupe('Préparation des pages…');
    const refus: string[] = [];
    for (const f of fichiers) {
      if (estPdf(f)) {
        setPdfs((l) => [...l, { id: crypto.randomUUID(), fichier: f }]);
        continue;
      }
      if (!f.type.startsWith('image/')) {
        refus.push(`« ${f.name} » : seules les images et les PDF sont acceptés.`);
        continue;
      }
      try {
        const { apercu, lisibilite } = await apercuDe(f, 0, true);
        setPages((l) => [...l, { id: crypto.randomUUID(), fichier: f, rotation: 0, cadre: CADRE_COMPLET, apercu, lisibilite }]);
      } catch (err) {
        refus.push(`« ${f.name} » : ${err instanceof ErreurImage ? err.message : 'image illisible.'}`);
      }
    }
    setOccupe(null);
    if (refus.length) setErreur(refus.join(' '));
  }

  function deplacer(id: string, sens: -1 | 1) {
    setPages((l) => {
      const i = l.findIndex((p) => p.id === id);
      const j = i + sens;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const copie = [...l];
      [copie[i], copie[j]] = [copie[j]!, copie[i]!];
      return copie;
    });
  }

  function retirerPage(id: string) {
    setPages((l) => {
      const p = l.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.apercu);
      return l.filter((x) => x.id !== id);
    });
    setEnEdition((courant) => (courant === id ? null : courant));
  }

  async function pivoter(id: string) {
    const p = refPages.current.find((x) => x.id === id);
    if (!p) return;
    setOccupe('Rotation…');
    try {
      const rotation = tournerQuart(p.rotation);
      const { apercu } = await apercuDe(p.fichier, rotation, false);
      URL.revokeObjectURL(p.apercu);
      setPages((l) => l.map((x) => (x.id === id ? { ...x, rotation, cadre: tournerCadre(x.cadre), apercu } : x)));
    } catch {
      setErreur('La rotation n’a pas pu être appliquée.');
    } finally {
      setOccupe(null);
    }
  }

  const dossier = dossiers.find((d) => d.id === entiteId);
  const rien = pages.length === 0 && pdfs.length === 0;
  const pret = !!dossier && !rien && nature !== '' && !occupe && capacites?.empreinte !== false;

  async function envoyer() {
    if (!dossier || nature === '' || rien) return;
    setErreur(null);
    try {
      const aDeposer: Array<{ fichier: Blob; nomFichier: string; assemblage: boolean; nbPages: number }> = [];
      if (pages.length) {
        const produites = [];
        for (const [i, p] of pages.entries()) {
          setOccupe(`Préparation de la page ${i + 1} sur ${pages.length}…`);
          produites.push(await produirePage(p.fichier, p.rotation, p.cadre));
        }
        setOccupe('Assemblage des pages en un seul PDF…');
        const nom = nomAssemblage();
        aDeposer.push({ fichier: await assemblerPdf(produites, nom), nomFichier: nom, assemblage: true, nbPages: pages.length });
      }
      // Un PDF importé est envoyé tel quel : il n'est ni transformé ni fusionné.
      for (const p of pdfs) aDeposer.push({ fichier: p.fichier, nomFichier: p.fichier.name.slice(0, 255) || 'document.pdf', assemblage: false, nbPages: 0 });

      for (const d of aDeposer) {
        setOccupe('Calcul de l’empreinte du fichier…');
        const sha256 = await sha256Hex(d.fichier);
        await file.ajouter({
          entiteId: dossier.id,
          dossier: dossier.raisonSociale,
          nomFichier: d.nomFichier,
          typeMime: 'application/pdf',
          taille: d.fichier.size,
          sha256,
          nature,
          commentaire: commentaire.trim(),
          assemblage: d.assemblage,
          nbPages: d.nbPages,
          fichier: d.fichier,
        });
      }
      for (const p of pages) URL.revokeObjectURL(p.apercu);
      setPages([]);
      setPdfs([]);
      setEnEdition(null);
      setCommentaire('');
      setNature('');
    } catch (err) {
      setErreur(err instanceof ErreurImage ? err.message : 'La préparation du dépôt a échoué. Vos pages sont conservées à l’écran : vous pouvez réessayer.');
    } finally {
      setOccupe(null);
    }
  }

  const pageEditee = pages.find((p) => p.id === enEdition);
  const styleFichier = (variante: 'primaire' | 'secondaire', grande = true) =>
    cn(styleBouton({ variante, taille: grande ? 'grande' : 'normale' }), 'cursor-pointer focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-anneau', occupe && 'pointer-events-none opacity-60');

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Titre>Déposer une pièce</Titre>

      {!file.enLigne ? (
        <Alerte ton="attention" role="status" titre="Vous êtes hors connexion">
          <p className="flex items-start gap-2">
            <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            Vous pouvez préparer un dépôt : il restera en attente sur cet appareil et partira au retour de la connexion, si l’application est ouverte.
          </p>
        </Alerte>
      ) : null}
      {capacites && !capacites.empreinte ? (
        <Alerte ton="danger" role="alert" titre="Dépôt impossible avec ce navigateur">
          Le calcul de l’empreinte du fichier (Web Crypto) n’est pas disponible ici — navigateur trop ancien ou connexion non sécurisée. Utilisez un
          navigateur récent en HTTPS.
        </Alerte>
      ) : null}
      {capacites && !capacites.image ? (
        <Alerte ton="attention" titre="Photos non prises en charge par ce navigateur">
          Le traitement des photos n’est pas disponible ici. Vous pouvez tout de même envoyer un fichier PDF.
        </Alerte>
      ) : null}
      {file.pret && file.persistance === 'memoire' ? (
        <Alerte ton="attention" titre="Les dépôts en attente ne peuvent pas être conservés sur cet appareil" data-testid="sans-persistance">
          Le stockage local est indisponible (navigation privée ou espace insuffisant). Gardez cette page ouverte jusqu’à l’affichage de « Reçu » :
          si vous la fermez avant, le dépôt sera à refaire.
        </Alerte>
      ) : null}

      {serviceFerme ? <ServiceFerme situation={serviceFerme} complement="Un dépôt déjà en attente sur cet appareil n’est pas supprimé : il partira quand le service sera rouvert." /> : null}
      <Carte className={cn('space-y-4', serviceFerme && 'hidden')} aria-hidden={serviceFerme ? true : undefined}>
        <div>
          <Libelle htmlFor={`${idBase}-dossier`}>Dossier</Libelle>
          {dossiers.length === 1 ? (
            <p id={`${idBase}-dossier`} className="font-medium" data-testid="dossier-unique">
              {dossiers[0]!.raisonSociale}
            </p>
          ) : (
            <Liste id={`${idBase}-dossier`} value={entiteId} onChange={(e) => setEntiteId(e.target.value)} required>
              <option value="">Choisir un dossier…</option>
              {dossiers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.raisonSociale}
                </option>
              ))}
            </Liste>
          )}
        </div>

        <div className="space-y-2">
          <label className={styleFichier('primaire')}>
            <Camera aria-hidden="true" className="size-6" />
            {pages.length ? 'Ajouter une page' : 'Ajouter une facture'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={ajouterFichiers} disabled={!!occupe} data-testid="entree-photo" />
          </label>
          <label className={styleFichier('secondaire', false)}>
            <FolderOpen aria-hidden="true" className="size-5" />
            Depuis mes fichiers / ma photothèque
            <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={ajouterFichiers} disabled={!!occupe} data-testid="entree-fichiers" />
          </label>
          <p className="text-sm text-texte-doux">
            Le premier bouton ouvre l’appareil photo sur un téléphone ; sur un ordinateur, ou si l’appareil photo n’est pas disponible, il ouvre le
            sélecteur de fichiers.
          </p>
        </div>

        {pages.length ? (
          <div className="space-y-2">
            <SousTitre>Pages ({pages.length})</SousTitre>
            <ol className="space-y-2" data-testid="liste-pages">
              {pages.map((p, i) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-bordure p-2">
                  <span className="w-6 text-center font-semibold" aria-hidden="true">
                    {i + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.apercu} alt={`Page ${i + 1}`} className="size-16 shrink-0 rounded-md bg-surface-2 object-contain" />
                  <div className="order-last flex w-full flex-wrap gap-1 empty:hidden">
                    {p.lisibilite?.avertissements.length ? (
                      <Etiquette ton="attention">
                        <TriangleAlert aria-hidden="true" className="size-4" /> Lisibilité à vérifier
                      </Etiquette>
                    ) : null}
                    {p.cadre.l < 1 || p.cadre.h < 1 ? <Etiquette>Recadrée</Etiquette> : null}
                  </div>
                  <div className="ml-auto flex shrink-0 gap-1">
                    <Bouton variante="contour" taille="icone" aria-label={`Monter la page ${i + 1}`} disabled={i === 0} onClick={() => deplacer(p.id, -1)}>
                      <ArrowUp aria-hidden="true" className="size-5" />
                    </Bouton>
                    <Bouton variante="contour" taille="icone" aria-label={`Descendre la page ${i + 1}`} disabled={i === pages.length - 1} onClick={() => deplacer(p.id, 1)}>
                      <ArrowDown aria-hidden="true" className="size-5" />
                    </Bouton>
                    <Bouton variante="contour" taille="icone" aria-label={`Ajuster la page ${i + 1} (rotation, recadrage)`} aria-pressed={enEdition === p.id} onClick={() => setEnEdition(enEdition === p.id ? null : p.id)}>
                      <Pencil aria-hidden="true" className="size-5" />
                    </Bouton>
                    <Bouton variante="danger" taille="icone" aria-label={`Supprimer la page ${i + 1}`} onClick={() => retirerPage(p.id)}>
                      <Trash2 aria-hidden="true" className="size-5" />
                    </Bouton>
                  </div>
                </li>
              ))}
            </ol>
            {pageEditee ? (
              <EditeurPage
                page={pageEditee}
                numero={pages.indexOf(pageEditee) + 1}
                occupe={!!occupe}
                surRotation={() => void pivoter(pageEditee.id)}
                surCadre={(c) => setPages((l) => l.map((x) => (x.id === pageEditee.id ? { ...x, cadre: c } : x)))}
                surSuppression={() => retirerPage(pageEditee.id)}
                surFermeture={() => setEnEdition(null)}
              />
            ) : pages.length === 1 ? (
              <IndicateurLisibilite lisibilite={pages[0]!.lisibilite} />
            ) : null}
            <Alerte ton="info" data-testid="mention-assemblage">
              Le fichier envoyé sera un <strong>assemblage de vos photos</strong> : {pages.length > 1 ? `vos ${pages.length} pages sont réunies` : 'votre page est placée'} dans un seul PDF,
              créé sur cet appareil, après rotation, recadrage et ré-encodage en JPEG. Vos photos d’origine ne sont pas envoyées.
            </Alerte>
          </div>
        ) : null}

        {pdfs.length ? (
          <div className="space-y-2">
            <SousTitre>Fichiers PDF ({pdfs.length})</SousTitre>
            <ul className="space-y-2" data-testid="liste-pdf">
              {pdfs.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-bordure p-2">
                  <FileText aria-hidden="true" className="size-6 shrink-0" />
                  <span className="min-w-0 grow break-all">
                    {p.fichier.name} <span className="text-texte-doux">({formaterTaille(p.fichier.size)})</span>
                  </span>
                  <Bouton variante="danger" taille="icone" aria-label={`Retirer ${p.fichier.name}`} onClick={() => setPdfs((l) => l.filter((x) => x.id !== p.id))}>
                    <Trash2 aria-hidden="true" className="size-5" />
                  </Bouton>
                </li>
              ))}
            </ul>
            <p className="text-sm text-texte-doux">Chaque PDF est envoyé tel quel, sans transformation, comme une pièce distincte.</p>
          </div>
        ) : null}

        {!rien ? (
          <>
            <fieldset>
              <legend className="mb-1 font-medium">De quoi s’agit-il ?</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {NATURES_DEPOT.map((n) => (
                  <label key={n.valeur} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-bordure px-3', nature === n.valeur && 'border-primaire bg-surface-2')}>
                    <input autoComplete="off" type="radio" name={`${idBase}-nature`} value={n.valeur} checked={nature === n.valeur} onChange={() => setNature(n.valeur)} className="size-5" />
                    {n.libelle}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Libelle htmlFor={`${idBase}-commentaire`}>Commentaire pour le cabinet (facultatif)</Libelle>
              <ZoneTexte id={`${idBase}-commentaire`} value={commentaire} maxLength={2000} onChange={(e) => setCommentaire(e.target.value)} />
            </div>
            <Bouton taille="grande" onClick={() => void envoyer()} disabled={!pret} data-testid="envoyer">
              <Send aria-hidden="true" className="size-6" /> Envoyer
            </Bouton>
            {!dossier ? <p className="text-sm text-texte-doux">Choisissez d’abord un dossier.</p> : nature === '' ? <p className="text-sm text-texte-doux">Indiquez de quoi il s’agit pour pouvoir envoyer.</p> : null}
          </>
        ) : null}

        <p role="status" aria-live="polite" className={occupe ? 'font-medium' : 'sr-only'}>
          {occupe ?? ''}
        </p>
        {erreur ? (
          <Alerte ton="danger" role="alert">
            {erreur}
          </Alerte>
        ) : null}
      </Carte>

      <DepotsEnCours depots={file.depots} surReprise={file.reprendre} surSuppression={(id) => void file.supprimer(id)} />

      {file.recus.length ? (
        <Carte className="space-y-2">
          <SousTitre>Reçus pendant cette session</SousTitre>
          <ul className="space-y-2" data-testid="liste-recus">
            {file.recus.map((r) => (
              <li key={r.cle} className="rounded-lg border border-bordure p-3">
                <p className="flex items-center gap-2 font-medium">
                  <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-succes-texte" />
                  <Etiquette ton="succes">Reçu</Etiquette>
                  <span className="break-all">{r.nomFichier}</span>
                </p>
                <p className="text-sm text-texte-doux">
                  {r.dossier}
                  {r.assemblage ? ' · assemblage de vos photos' : ''}
                </p>
                {r.doublonBinaire ? <p className="mt-1">Cette pièce avait déjà été reçue.</p> : null}
                {r.documentId ? (
                  <p className="mt-1">
                    <Link href={`/depots/${r.documentId}`} prefetch={false}>
                      Suivre cette pièce
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      <Carte className="space-y-2 text-sm">
        <SousTitre className="text-base">Si vous fermez l’application</SousTitre>
        <p>
          Un dépôt non terminé <strong>reste en attente sur cet appareil</strong> et reprendra, là où il s’était arrêté, à la prochaine ouverture de
          Comtaple. <strong>Rien n’est envoyé tant que l’application est fermée.</strong>
        </p>
        <p>
          Une pièce n’est « Reçue » qu’après confirmation du serveur. Un dépôt en attente est effacé de l’appareil dès cette confirmation,
          après 7 jours sans envoi, si vous le supprimez, ou à la déconnexion.
        </p>
      </Carte>

      <InviteInstallation />
    </div>
  );
}

function DepotsEnCours({ depots, surReprise, surSuppression }: { depots: DepotSuivi[]; surReprise: (id: string) => void; surSuppression: (id: string) => void }) {
  // Annonce vocale : état et progression par paliers de 25 %, pour ne pas saturer le lecteur d'écran.
  const annonce = depots
    .map((d) => `${d.nomFichier} : ${LIBELLE_ETAT_DEPOT[d.etat]}${d.etat === 'envoi' ? `, ${Math.floor((d.octetsConfirmes / d.taille) * 4) * 25} %` : ''}`)
    .join('. ');
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" data-testid="annonce-envoi">
        {annonce}
      </p>
      {depots.length ? (
        <Carte className="space-y-2">
          <SousTitre>Dépôts en cours et en attente</SousTitre>
          <ul className="space-y-2" data-testid="liste-depots-en-attente">
            {depots.map((d) => {
              const pourcentage = d.taille ? Math.min(100, Math.floor((d.octetsConfirmes / d.taille) * 100)) : 0;
              return (
                <li key={d.id} className="space-y-2 rounded-lg border border-bordure p-3" data-etat={d.etat}>
                  <p className="flex flex-wrap items-center gap-2">
                    <Etiquette ton={d.etat === 'refuse' ? 'danger' : d.etat === 'envoi' ? 'info' : 'attention'}>{LIBELLE_ETAT_DEPOT[d.etat]}</Etiquette>
                    <span className="font-medium break-all">{d.nomFichier}</span>
                  </p>
                  <p className="text-sm text-texte-doux">
                    {d.dossier} · {formaterTaille(d.taille)}
                    {d.assemblage ? ` · assemblage de ${d.nbPages} photo${d.nbPages > 1 ? 's' : ''}` : ''}
                    {!d.persistant ? ' · non conservé sur l’appareil' : ''}
                  </p>
                  {d.etat !== 'refuse' ? (
                    <div>
                      <progress value={d.octetsConfirmes} max={d.taille} aria-label={`Progression de l’envoi de ${d.nomFichier}`} />
                      <p className="text-sm text-texte-doux">
                        {pourcentage} % confirmés par le serveur ({formaterTaille(d.octetsConfirmes)} sur {formaterTaille(d.taille)})
                      </p>
                    </div>
                  ) : null}
                  {d.message ? <p className="text-sm">{d.message}</p> : null}
                  {d.message?.startsWith('Votre session a expiré') ? (
                    <p>
                      <a href="/api/auth/connexion?retour=%2Fdeposer">Se reconnecter</a>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {d.etat === 'interrompu' || d.etat === 'attente_connexion' ? (
                      <Bouton variante="secondaire" onClick={() => surReprise(d.id)}>
                        Reprendre l’envoi
                      </Bouton>
                    ) : null}
                    <Bouton variante="danger" onClick={() => surSuppression(d.id)}>
                      <Trash2 aria-hidden="true" className="size-5" /> Supprimer ce dépôt en attente
                    </Bouton>
                  </div>
                </li>
              );
            })}
          </ul>
        </Carte>
      ) : null}
    </>
  );
}
