'use client';

import { useEffect, useState } from 'react';
import { Alerte } from '@/components/ui/base';

type Etat = { phase: 'chargement' } | { phase: 'pret'; url: string; type: string } | { phase: 'erreur'; message: string };

/**
 * Aperçu d'une pièce. Le contenu est lu à travers le BFF (contrôle d'accès à chaque lecture) puis affiché depuis un objet
 * local : aucune URL publique. Un type non prévu n'est jamais interprété : il est seulement proposé à l'enregistrement.
 */
export function ApercuPiece({ documentId, nom }: { documentId: string; nom: string }) {
  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });
  useEffect(() => {
    let url: string | null = null;
    const controleur = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/bff/v1/documents/${documentId}/contenu`, { cache: 'no-store', signal: controleur.signal });
        if (!r.ok) {
          const corps = (await r.json().catch(() => null)) as { message?: string } | null;
          setEtat({ phase: 'erreur', message: r.status === 409 ? (corps?.message ?? 'Aperçu indisponible pour le moment.') : 'L’aperçu de la pièce n’a pas pu être chargé.' });
          return;
        }
        const type = (r.headers.get('content-type') ?? '').split(';')[0]!.trim();
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
        setEtat({ phase: 'pret', url, type });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setEtat({ phase: 'erreur', message: 'L’aperçu de la pièce n’a pas pu être chargé.' });
      }
    })();
    return () => {
      controleur.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId]);

  if (etat.phase === 'chargement') return <p role="status">Chargement de l’aperçu…</p>;
  if (etat.phase === 'erreur') return <Alerte ton="neutre">{etat.message}</Alerte>;
  const image = ['image/jpeg', 'image/png', 'image/webp'].includes(etat.type);
  const pdf = etat.type === 'application/pdf';
  return (
    <div className="space-y-2" data-testid="apercu-piece" data-type={etat.type}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={etat.url} alt={`Aperçu de la pièce ${nom}`} className="max-h-[80dvh] w-full rounded-lg border border-bordure bg-surface-2 object-contain" />
      ) : pdf ? (
        <iframe src={etat.url} title={`Aperçu de la pièce ${nom}`} className="h-[75dvh] w-full rounded-lg border border-bordure bg-surface-2" />
      ) : (
        <Alerte ton="neutre">Ce type de fichier ne peut pas être affiché ici.</Alerte>
      )}
      <p className="text-sm">
        {image || pdf ? (
          <a href={etat.url} target="_blank" rel="noopener noreferrer">
            Ouvrir la pièce dans un nouvel onglet
          </a>
        ) : (
          <a href={etat.url} download={nom}>
            Enregistrer le fichier
          </a>
        )}
      </p>
    </div>
  );
}
