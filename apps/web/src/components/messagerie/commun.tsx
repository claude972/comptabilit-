import { Alerte, Etiquette, type Ton } from '@/components/ui/base';
import { LIBELLE_STATUT_CONNEXION } from '@/lib/messagerie';

/** Emplacement du guide dans le dépôt (document d'installation, non servi par l'application). */
export const GUIDE = 'packages/mail/docs/guide-connexion.md';

const TON: Record<string, Ton> = { active: 'succes', expire: 'attention', revoque: 'attention', erreur: 'danger', supprimee: 'neutre', non_connecte: 'vide', connecte: 'succes' };

export function EtiquetteStatutConnexion({ statut }: { statut: string }) {
  return (
    <Etiquette ton={TON[statut] ?? 'neutre'} data-statut-connexion={statut}>
      {LIBELLE_STATUT_CONNEXION[statut] ?? statut}
    </Etiquette>
  );
}

/** Rappel constant : la collecte des factures n'ouvre pas les échanges de conseil. */
export function RappelPerimetreMetier() {
  return (
    <Alerte ton="neutre" className="text-sm" data-testid="rappel-conseil">
      La collecte par mail sert uniquement à récupérer des <strong>pièces comptables</strong> (factures, avoirs) en pièce jointe. Elle ne donne pas
      accès, dans Comtaple, aux échanges de conseil entre le cabinet et ses clients : aucun message n’est affiché ni conservé au-delà d’un court
      extrait servant à qualifier une pièce.
    </Alerte>
  );
}

/** Explication affichée À LA PLACE du bouton de connexion quand le connecteur n'est pas configuré. */
export function ConnecteurNonConfigure({ fournisseur, detail }: { fournisseur: string; detail: string }) {
  return (
    <Alerte ton="attention" titre={`${fournisseur} : connecteur non configuré`} data-testid="connecteur-non-configure">
      <p className="break-words">{detail}</p>
      <p className="mt-1">
        Tant que l’application OAuth n’est pas déclarée chez le fournisseur et renseignée sur cette installation, aucune boîte ne peut être connectée.
        Démarche à suivre par l’administrateur de l’installation : guide <code className="break-all">{GUIDE}</code>.
      </p>
    </Alerte>
  );
}
