import { decouperExtrait } from '@/lib/recherche';

/** Extrait de pièce (contenu non fiable) : texte brut, le terme trouvé est rendu dans des éléments `<mark>`, sans HTML injecté. */
export function ExtraitSurligne({ extrait }: { extrait: string }) {
  return (
    <span className="break-words whitespace-pre-wrap" data-testid="extrait">
      {decouperExtrait(extrait).map((f, i) =>
        f.surligne ? (
          <mark key={i} className="rounded-sm bg-attention-fond px-0.5 font-semibold text-attention-texte">
            {f.texte}
          </mark>
        ) : (
          <span key={i}>{f.texte}</span>
        ),
      )}
    </span>
  );
}
