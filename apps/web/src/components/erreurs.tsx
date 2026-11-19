import Link from 'next/link';
import { Alerte, Carte, Titre } from './ui/base';

const TEXTES: Record<number, { titre: string; detail: string }> = {
  400: { titre: 'Demande incorrecte', detail: 'Cette adresse ne correspond à aucun élément valide.' },
  403: { titre: 'Accès refusé', detail: 'Votre habilitation ne permet pas d’accéder à cet élément. Rapprochez-vous de l’administrateur de votre cabinet si besoin.' },
  404: { titre: 'Introuvable', detail: 'Cet élément n’existe pas ou ne vous est pas accessible.' },
  409: { titre: 'Indisponible pour le moment', detail: 'Cet élément n’est pas disponible dans son état actuel.' },
  503: { titre: 'Service momentanément indisponible', detail: 'Les données ne peuvent pas être chargées pour l’instant. Merci de réessayer dans quelques instants.' },
};

/** Affichage propre d'un refus ou d'une indisponibilité de l'API (403, 404, 409, 5xx). */
export function ErreurAcces({ statut, message, retour = '/' }: { statut: number; message?: string; retour?: string }) {
  const t = TEXTES[statut] ?? TEXTES[statut >= 500 ? 503 : 404]!;
  return (
    <Carte className="mx-auto max-w-xl space-y-3" data-testid={`erreur-${statut}`}>
      <Titre>{t.titre}</Titre>
      <p>{t.detail}</p>
      {message && statut !== 404 ? <Alerte ton="neutre">{message}</Alerte> : null}
      <p>
        <Link href={retour}>Revenir à l’accueil</Link>
      </p>
    </Carte>
  );
}
