import { formaterHorodatage } from '@/lib/montants';

/** Trace d'une annulation : motif (texte brut), auteur s'il est connu, date. */
export function TraceAnnulation({ lot, nomAuteur }: { lot: { annuleLe?: string | null; motifAnnulation?: string | null; statutAvantAnnulation?: string | null }; nomAuteur: string | null }) {
  return (
    <span className="block text-sm" data-testid="trace-annulation">
      Annulé{lot.annuleLe ? ` le ${formaterHorodatage(lot.annuleLe)}` : ''}
      {nomAuteur ? ` par ${nomAuteur}` : ''}
      {lot.motifAnnulation ? (
        <>
          {' '}
          — motif : <span className="break-words whitespace-pre-wrap">{lot.motifAnnulation}</span>
        </>
      ) : null}
      <span className="block text-texte-doux">{lot.statutAvantAnnulation ? 'Rien n’a été supprimé : cet import peut être rétabli.' : 'Annulé avant d’aboutir : il peut être repris, pas rétabli.'}</span>
    </span>
  );
}
