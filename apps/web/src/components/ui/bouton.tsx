import { type VariantProps, cva } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Bouton (style shadcn/ui). Hauteur minimale de 44 px : cible tactile confortable. */
export const styleBouton = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
  {
    variants: {
      variante: {
        primaire: 'bg-primaire text-sur-primaire hover:bg-primaire-survol',
        secondaire: 'bg-surface-2 text-texte border border-bordure hover:bg-neutre-fond',
        contour: 'bg-transparent text-texte border border-bordure hover:bg-surface-2',
        discret: 'bg-transparent text-texte hover:bg-surface-2',
        danger: 'bg-transparent text-danger border border-danger hover:bg-danger-fond',
      },
      taille: {
        normale: 'min-h-11 px-4 text-base',
        grande: 'min-h-16 px-6 text-lg w-full',
        icone: 'min-h-11 min-w-11 px-2',
      },
    },
    defaultVariants: { variante: 'primaire', taille: 'normale' },
  },
);

export interface ProprietesBouton extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof styleBouton> {}

export function Bouton({ className, variante, taille, type = 'button', ...reste }: ProprietesBouton) {
  return <button type={type} className={cn(styleBouton({ variante, taille }), className)} {...reste} />;
}
