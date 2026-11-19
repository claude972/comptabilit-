'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Alerte, Libelle, Liste } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_ROLE } from '@/lib/libelles';
import type { Role } from '@/lib/types-api';

const ROLES = Object.keys(LIBELLE_ROLE) as Role[];
interface ReponseMembre {
  role: Role;
  actif: boolean;
  habilitationsRetirees: number;
}

/**
 * Changement de rôle ou (dés)activation d'un membre (`PATCH v1/cabinet/membres/:id`), toujours après confirmation.
 * Les garde-fous sont ceux de l'API ; son refus est affiché tel quel.
 */
export function GestionMembre({ utilisateurId, nom, role, actif, soiMeme }: { utilisateurId: string; nom: string; role: Role; actif: boolean; soiMeme: boolean }) {
  const [choix, setChoix] = useState<Role>(role);
  const [aConfirmer, setAConfirmer] = useState<{ corps: { role?: Role; actif?: boolean }; texte: string; bouton: string } | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);
  const appel = useAppel();
  const id = useId();
  if (soiMeme) return <p className="text-sm text-texte-doux" data-testid="membre-soi-meme">Vous ne pouvez pas modifier votre propre appartenance : un autre gestionnaire doit le faire.</p>;

  async function confirmer() {
    if (!aConfirmer) return;
    setResultat(null);
    const r = await appel.executer<ReponseMembre>(`v1/cabinet/membres/${utilisateurId}`, { method: 'PATCH', json: aConfirmer.corps });
    if (!r) return;
    setAConfirmer(null);
    const retirees = r.habilitationsRetirees > 0 ? ` ${r.habilitationsRetirees} habilitation(s) de dossier au-dessus du plafond du nouveau rôle ont été retirées (elles ne sont pas rabaissées en silence).` : aConfirmer.corps.role ? ' Aucune habilitation de dossier n’a été retirée.' : '';
    setResultat(aConfirmer.corps.role ? `Rôle modifié : ${LIBELLE_ROLE[r.role] ?? r.role}.${retirees}` : r.actif ? 'Membre réactivé : ses accès sont rétablis.' : 'Membre désactivé : tous ses accès sont fermés immédiatement.');
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Libelle htmlFor={id} className="sr-only">
            Rôle de {nom}
          </Libelle>
          <Liste id={id} value={choix} onChange={(e) => setChoix(e.target.value as Role)} className="min-w-52">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {LIBELLE_ROLE[r]}
              </option>
            ))}
          </Liste>
        </div>
        <Bouton
          variante="secondaire"
          disabled={appel.occupe || choix === role}
          aria-label={`Changer le rôle de ${nom}`}
          onClick={() =>
            setAConfirmer({
              corps: { role: choix },
              texte: `Changer le rôle de ${nom} : « ${LIBELLE_ROLE[role] ?? role} » → « ${LIBELLE_ROLE[choix]} ». Ses habilitations de dossier qui dépassent le plafond du nouveau rôle seront retirées (et non rabaissées).`,
              bouton: 'Confirmer le changement de rôle',
            })
          }
        >
          Changer le rôle
        </Bouton>
        <Bouton
          variante={actif ? 'danger' : 'contour'}
          disabled={appel.occupe}
          aria-label={`${actif ? 'Désactiver' : 'Réactiver'} ${nom}`}
          onClick={() =>
            setAConfirmer(
              actif
                ? { corps: { actif: false }, texte: `Désactiver ${nom} : tous ses accès au cabinet seront fermés immédiatement, même avec une session ouverte. Ses habilitations sont conservées et reviennent à la réactivation.`, bouton: 'Confirmer la désactivation' }
                : { corps: { actif: true }, texte: `Réactiver ${nom} : ses accès au cabinet et ses habilitations de dossier sont rétablis.`, bouton: 'Confirmer la réactivation' },
            )
          }
        >
          {actif ? 'Désactiver' : 'Réactiver'}
        </Bouton>
      </div>
      {aConfirmer ? (
        <div className="space-y-2 rounded-lg border-2 border-attention-texte p-3" role="group" aria-label={`Confirmation pour ${nom}`} data-testid="confirmation-membre">
          <p>{aConfirmer.texte}</p>
          <div className="flex flex-wrap gap-2">
            <Bouton variante="danger" disabled={appel.occupe} onClick={() => void confirmer()}>
              {aConfirmer.bouton}
            </Bouton>
            <Bouton variante="contour" disabled={appel.occupe} onClick={() => setAConfirmer(null)}>
              Annuler
            </Bouton>
          </div>
        </div>
      ) : null}
      {appel.erreur ? (
        <Alerte ton="danger" role="alert" data-testid="refus-membre">
          {appel.erreur}
        </Alerte>
      ) : null}
      <div role="status" aria-live="polite">
        {resultat ? (
          <Alerte ton="succes" data-testid="resultat-membre">
            {resultat}
          </Alerte>
        ) : null}
      </div>
    </div>
  );
}
