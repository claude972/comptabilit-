'use client';

import { type FormEvent, useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Libelle, Liste, Saisie, ZoneTexte } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_FAIT, type TypeFait } from '@/lib/missions';

interface ConseilModifiable {
  id: string;
  dateConseil: string;
  objet: string;
  contenu: string;
  destinataire: string;
  missionId: string | null;
  pieces: string[];
}

/** Rédaction (`POST v1/dossiers/:id/conseils`) ou modification d'un projet (`PUT v1/conseils/:id`). */
export function RedigerConseil({ dossierId, missions, conseil }: { dossierId: string; missions: Array<{ id: string; libelle: string }>; conseil?: ConseilModifiable }) {
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(conseil?.dateConseil ?? '');
  const [objet, setObjet] = useState(conseil?.objet ?? '');
  const [contenu, setContenu] = useState(conseil?.contenu ?? '');
  const [destinataire, setDestinataire] = useState(conseil?.destinataire ?? '');
  const [missionId, setMissionId] = useState(conseil?.missionId ?? '');
  const appel = useAppel();
  const id = useId();
  if (!ouvert) {
    return (
      <div className="space-y-2">
        <Bouton variante="secondaire" onClick={() => setOuvert(true)}>
          {conseil ? 'Modifier ce projet' : 'Rédiger un conseil'}
        </Bouton>
        <Retours erreur={null} succes={appel.succes} />
      </div>
    );
  }
  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!date) return appel.setErreur('Indiquez la date du conseil.');
    if (!objet.trim() || !contenu.trim() || !destinataire.trim()) return appel.setErreur('L’objet, le contenu et le destinataire sont obligatoires.');
    const corps = { dateConseil: date, objet: objet.trim(), contenu: contenu.trim(), destinataire: destinataire.trim(), ...(missionId ? { missionId } : {}), ...(conseil ? { pieces: conseil.pieces } : {}) };
    const ok = conseil
      ? await appel.executer(`v1/conseils/${conseil.id}`, { method: 'PUT', json: corps }, 'Projet modifié.')
      : await appel.executer(`v1/dossiers/${dossierId}/conseils`, { method: 'POST', json: corps }, 'Conseil enregistré comme projet. Rien n’a été envoyé.');
    if (ok) {
      if (!conseil) {
        setObjet('');
        setContenu('');
        setDestinataire('');
      }
      setOuvert(false);
    }
  }
  return (
    <form onSubmit={envoyer} className="space-y-3 rounded-lg border border-bordure p-3" data-formulaire={conseil ? 'modifier-conseil' : 'rediger-conseil'} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Libelle htmlFor={`${id}-date`}>Date du conseil</Libelle>
          <Saisie id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Libelle htmlFor={`${id}-mission`}>Mission (facultative)</Libelle>
          <Liste id={`${id}-mission`} value={missionId} onChange={(e) => setMissionId(e.target.value)}>
            <option value="">Aucune</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.libelle}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-objet`}>Objet</Libelle>
          <Saisie id={`${id}-objet`} value={objet} maxLength={300} onChange={(e) => setObjet(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <Libelle htmlFor={`${id}-destinataire`}>Destinataire</Libelle>
          <Saisie id={`${id}-destinataire`} value={destinataire} maxLength={300} onChange={(e) => setDestinataire(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div>
        <Libelle htmlFor={`${id}-contenu`}>Contenu</Libelle>
        <ZoneTexte id={`${id}-contenu`} value={contenu} maxLength={20000} onChange={(e) => setContenu(e.target.value)} className="min-h-40" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Bouton type="submit" disabled={appel.occupe}>
          {conseil ? 'Enregistrer les modifications' : 'Enregistrer le projet'}
        </Bouton>
        <Bouton variante="contour" onClick={() => setOuvert(false)}>
          Fermer
        </Bouton>
      </div>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}

/** Consignation d'un fait établi (`POST v1/conseils/:id/evenements`) : le justificatif est obligatoire, rien ne se déduit. */
export function ConsignerFait({ conseilId, possibles }: { conseilId: string; possibles: TypeFait[] }) {
  const [type, setType] = useState<TypeFait>(possibles[0] ?? 'envoi');
  const [date, setDate] = useState('');
  const [canal, setCanal] = useState('');
  const [justificatif, setJustificatif] = useState('');
  const appel = useAppel();
  const id = useId();
  const choisi = possibles.includes(type) ? type : (possibles[0] ?? 'envoi');
  return (
    <form
      className="space-y-3 rounded-lg border border-bordure p-3"
      data-formulaire="consigner-fait"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const instant = date ? new Date(date) : null;
        if (!instant || Number.isNaN(instant.getTime())) return appel.setErreur('Indiquez la date et l’heure du fait constaté.');
        if (instant.getTime() > Date.now()) return appel.setErreur('Un fait constaté ne peut pas être daté dans le futur.');
        if (!canal.trim()) return appel.setErreur('Indiquez le canal (courriel, courrier recommandé, remise en main propre…).');
        if (justificatif.trim().length < 5) return appel.setErreur('Le justificatif est obligatoire : indiquez ce qui établit ce fait (5 caractères au moins).');
        if (await appel.executer(`v1/conseils/${conseilId}/evenements`, { method: 'POST', json: { type: choisi, dateEvenement: instant.toISOString(), canal: canal.trim(), justificatif: justificatif.trim() } }, `Fait consigné : ${LIBELLE_FAIT[choisi].toLowerCase()}.`)) {
          setJustificatif('');
          setDate('');
        }
      }}
    >
      <p className="text-sm">
        Consignez uniquement un fait <strong>établi</strong>, avec ce qui le prouve. Une remise ne prouve ni la réception ni la lecture : chaque fait se consigne séparément et ne se modifie plus.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Libelle htmlFor={`${id}-type`}>Fait constaté</Libelle>
          <Liste id={`${id}-type`} value={choisi} onChange={(e) => setType(e.target.value as TypeFait)}>
            {possibles.map((t) => (
              <option key={t} value={t}>
                {LIBELLE_FAIT[t]}
              </option>
            ))}
          </Liste>
        </div>
        <div>
          <Libelle htmlFor={`${id}-date`}>Date et heure</Libelle>
          <Saisie id={`${id}-date`} type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} aria-describedby={`${id}-fuseau`} />
          <p id={`${id}-fuseau`} className="text-sm text-texte-doux">
            Heure de votre appareil ; le registre l’affiche à l’heure de Paris.
          </p>
        </div>
        <div>
          <Libelle htmlFor={`${id}-canal`}>Canal</Libelle>
          <Saisie id={`${id}-canal`} value={canal} maxLength={100} onChange={(e) => setCanal(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div>
        <Libelle htmlFor={`${id}-justificatif`}>Justificatif (obligatoire : ce qui établit le fait)</Libelle>
        <ZoneTexte id={`${id}-justificatif`} value={justificatif} maxLength={1000} onChange={(e) => setJustificatif(e.target.value)} className="min-h-16" />
      </div>
      <Bouton type="submit" variante="secondaire" disabled={appel.occupe}>
        Consigner ce fait
      </Bouton>
      <Retours erreur={appel.erreur} succes={appel.succes} />
    </form>
  );
}
