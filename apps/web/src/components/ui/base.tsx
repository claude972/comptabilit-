import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Carte({ className, ...reste }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-bordure bg-surface p-4 sm:p-5', className)} {...reste} />;
}

const styleEtiquette = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap', {
  variants: {
    ton: {
      neutre: 'bg-neutre-fond text-neutre-texte border-transparent',
      succes: 'bg-succes-fond text-succes-texte border-transparent',
      attention: 'bg-attention-fond text-attention-texte border-transparent',
      danger: 'bg-danger-fond text-danger-texte border-transparent',
      info: 'bg-info-fond text-info-texte border-transparent',
      /** Contour pointillé : absence de résultat (ni succès ni échec). */
      vide: 'bg-transparent text-texte border-dashed border-texte-doux',
    },
  },
  defaultVariants: { ton: 'neutre' },
});
export type Ton = NonNullable<VariantProps<typeof styleEtiquette>['ton']>;

export function Etiquette({ className, ton, ...reste }: HTMLAttributes<HTMLSpanElement> & { ton?: Ton }) {
  return <span className={cn(styleEtiquette({ ton }), className)} {...reste} />;
}

const styleAlerte = cva('rounded-lg border px-4 py-3 text-base', {
  variants: {
    ton: {
      info: 'bg-info-fond text-info-texte border-transparent',
      succes: 'bg-succes-fond text-succes-texte border-transparent',
      attention: 'bg-attention-fond text-attention-texte border-transparent',
      danger: 'bg-danger-fond text-danger-texte border-transparent',
      neutre: 'bg-surface-2 text-texte border-bordure',
    },
  },
  defaultVariants: { ton: 'info' },
});

export function Alerte({ className, ton, titre, children, ...reste }: HTMLAttributes<HTMLDivElement> & { ton?: 'info' | 'succes' | 'attention' | 'danger' | 'neutre'; titre?: string }) {
  return (
    <div className={cn(styleAlerte({ ton }), className)} {...reste}>
      {titre ? <p className="font-semibold">{titre}</p> : null}
      {children}
    </div>
  );
}

/** Mention obligatoire sur tout contenu non validé par un professionnel habilité. */
export function MentionProjet({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <Etiquette ton="attention" className={className}>
      {children ?? 'Projet — non validé'}
    </Etiquette>
  );
}

const styleChamp =
  'block w-full min-h-11 rounded-lg border border-bordure bg-surface px-3 py-2 text-base text-texte placeholder:text-texte-doux disabled:opacity-60';

export function Saisie({ className, ...reste }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(styleChamp, className)} {...reste} />;
}
export function ZoneTexte({ className, ...reste }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(styleChamp, 'min-h-24', className)} {...reste} />;
}
export function Liste({ className, ...reste }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(styleChamp, className)} {...reste} />;
}
export function Libelle({ className, ...reste }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-sm font-medium text-texte', className)} {...reste} />;
}

export function Titre({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn('text-2xl font-semibold tracking-tight', className)}>{children}</h1>;
}
export function SousTitre({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={cn('text-lg font-semibold', className)}>
      {children}
    </h2>
  );
}

/** Tableau de données sobre, défilable horizontalement sur petit écran. */
export function Tableau({ className, children, legende }: { className?: string; children: ReactNode; legende: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-bordure" tabIndex={0} role="region" aria-label={legende}>
      <table className={cn('w-full border-collapse text-left text-sm [&_td]:border-t [&_td]:border-bordure [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold', className)}>
        <caption className="sr-only">{legende}</caption>
        {children}
      </table>
    </div>
  );
}
