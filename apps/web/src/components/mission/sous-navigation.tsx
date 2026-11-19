import Link from 'next/link';

/** Sous-navigation de l'onglet « Mission » : une URL par page. « Rentabilité » n'est proposée qu'au niveau révision (l'API vérifie). */
export function SousNavigationMission({ dossierId, courant, avecRentabilite }: { dossierId: string; courant: 'missions' | 'conseils' | 'rentabilite'; avecRentabilite: boolean }) {
  const liens = [
    { cle: 'missions', href: `/dossiers/${dossierId}/mission`, libelle: 'Missions, lettres et travaux' },
    { cle: 'conseils', href: `/dossiers/${dossierId}/mission/conseils`, libelle: 'Registre des conseils' },
    ...(avecRentabilite ? [{ cle: 'rentabilite', href: `/dossiers/${dossierId}/mission/rentabilite`, libelle: 'Rentabilité' }] : []),
  ];
  return (
    <nav aria-label="Pages de l’onglet Mission">
      <ul className="flex flex-wrap gap-2">
        {liens.map((l) => (
          <li key={l.cle}>
            <Link
              href={l.href}
              prefetch={false}
              aria-current={l.cle === courant ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg border border-bordure px-3 text-texte no-underline hover:bg-surface-2 ${l.cle === courant ? 'border-primaire bg-surface-2 font-semibold' : ''}`}
            >
              {l.libelle}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
