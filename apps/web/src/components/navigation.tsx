'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface LienNavigation {
  href: string;
  libelle: string;
}

function actif(chemin: string, href: string): boolean {
  return href === '/' ? chemin === '/' : chemin === href || chemin.startsWith(`${href}/`);
}

export function Navigation({ liens }: { liens: LienNavigation[] }) {
  const chemin = usePathname();
  return (
    <nav aria-label="Navigation principale" className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1 px-1">
        {liens.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              prefetch={false}
              aria-current={actif(chemin, l.href) ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-lg px-3 font-medium whitespace-nowrap text-texte no-underline hover:bg-surface-2',
                actif(chemin, l.href) && 'bg-surface-2 underline decoration-2 underline-offset-8',
              )}
            >
              {l.libelle}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Onglets d'un dossier : ce sont des liens (une URL par onglet), l'onglet courant est annoncé par `aria-current`. */
export function Onglets({ liens, libelle }: { liens: LienNavigation[]; libelle: string }) {
  const chemin = usePathname();
  // L'onglet actif est le lien le plus long qui préfixe le chemin courant.
  const courant = liens.filter((l) => chemin === l.href || chemin.startsWith(`${l.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label={libelle} className="border-b border-bordure">
      <ul className="flex gap-1 overflow-x-auto">
        {liens.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              prefetch={false}
              aria-current={courant?.href === l.href ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 border-transparent px-4 font-medium text-texte-doux no-underline hover:text-texte',
                courant?.href === l.href && 'border-primaire text-texte',
              )}
            >
              {l.libelle}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
