'use client';

import { useId, useState } from 'react';
import { useAppel } from '@/components/appel';
import { Retours } from '@/components/retours';
import { Alerte, Libelle, Liste, Saisie, Tableau } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { LIBELLE_ROLE } from '@/lib/libelles';
import { formaterHorodatage } from '@/lib/montants';
import type { Role } from '@/lib/types-api';

export interface Invitation {
  id: string;
  email: string;
  nom: string;
  role: Role;
  statut: 'en_attente' | 'acceptee' | 'annulee';
  expireLe: string;
  expiree: boolean;
  accepteeLe: string | null;
  creeLe: string;
}

const ROLES_INVITABLES = (Object.keys(LIBELLE_ROLE) as Role[]).filter((r) => r !== 'support');
const LIBELLE_STATUT: Record<Invitation['statut'], string> = { en_attente: 'En attente', acceptee: 'Acceptée', annulee: 'Annulée' };

/**
 * Invitations du cabinet (`v1/cabinet/invitations`). L'application n'envoie aucun courriel : l'écran le dit, et rappelle
 * que l'invitation ne donne accès à aucun dossier.
 */
export function Invitations({ invitations, peutInviterAdministrateur }: { invitations: Invitation[]; peutInviterAdministrateur: boolean }) {
  const appel = useAppel();
  const [email, setEmail] = useState('');
  const [nom, setNom] = useState('');
  const [role, setRole] = useState<Role>('collaborateur');
  const idEmail = useId();
  const idNom = useId();
  const idRole = useId();
  const roles = ROLES_INVITABLES.filter((r) => peutInviterAdministrateur || r !== 'administrateur');

  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    const r = await appel.executer<Invitation>('v1/cabinet/invitations', { method: 'POST', json: { email, nom, role } }, `Invitation enregistrée pour ${email}. Aucun courriel n’a été envoyé : prévenez la personne vous-même.`);
    if (r) {
      setEmail('');
      setNom('');
    }
  }

  return (
    <div className="space-y-3" data-testid="invitations">
      <form onSubmit={inviter} className="flex flex-wrap items-end gap-3" aria-label="Inviter une personne">
        <div>
          <Libelle htmlFor={idEmail}>Adresse de la personne</Libelle>
          <Saisie id={idEmail} type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-64" />
        </div>
        <div>
          <Libelle htmlFor={idNom}>Nom</Libelle>
          <Saisie id={idNom} required maxLength={120} autoComplete="off" value={nom} onChange={(e) => setNom(e.target.value)} />
        </div>
        <div>
          <Libelle htmlFor={idRole}>Rôle dans le cabinet</Libelle>
          <Liste id={idRole} value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-w-52">
            {roles.map((r) => (
              <option key={r} value={r}>
                {LIBELLE_ROLE[r]}
              </option>
            ))}
          </Liste>
        </div>
        <Bouton type="submit" disabled={appel.occupe}>
          Inviter
        </Bouton>
      </form>
      <Retours erreur={appel.erreur} succes={appel.succes} />
      <Alerte ton="neutre" className="text-sm" data-testid="invitation-explication">
        Comtaple n’envoie aucun courriel d’invitation. L’invitation autorise l’entrée dans le cabinet du compte dont le fournisseur d’identité atteste cette adresse, à sa
        première connexion, pendant 14 jours. Le compte lui-même est créé dans le fournisseur d’identité (par l’éditeur, ou par le SSO du cabinet). Une invitation ne donne
        accès à aucun dossier : les habilitations se règlent ensuite, dossier par dossier.
      </Alerte>
      {invitations.length === 0 ? (
        <p className="text-sm text-texte-doux">Aucune invitation.</p>
      ) : (
        <Tableau legende="Invitations du cabinet">
          <thead>
            <tr>
              <th scope="col">Adresse</th>
              <th scope="col">Nom</th>
              <th scope="col">Rôle prévu</th>
              <th scope="col">État</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((i) => (
              <tr key={i.id} data-invitation={i.id}>
                <th scope="row" className="!bg-transparent break-all font-medium">{i.email}</th>
                <td>{i.nom}</td>
                <td>{LIBELLE_ROLE[i.role] ?? i.role}</td>
                <td>
                  {i.statut === 'en_attente' && i.expiree ? 'Périmée' : LIBELLE_STATUT[i.statut]}
                  {i.statut === 'en_attente' && !i.expiree ? ` · valable jusqu’au ${formaterHorodatage(i.expireLe)}` : ''}
                  {i.accepteeLe ? ` le ${formaterHorodatage(i.accepteeLe)}` : ''}
                </td>
                <td>
                  {i.statut === 'en_attente' ? (
                    <Bouton variante="contour" disabled={appel.occupe} aria-label={`Annuler l’invitation de ${i.email}`} onClick={() => void appel.executer(`v1/cabinet/invitations/${i.id}`, { method: 'DELETE' }, 'Invitation annulée.')}>
                      Annuler
                    </Bouton>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      )}
    </div>
  );
}
