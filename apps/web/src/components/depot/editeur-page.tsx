'use client';

import { RotateCw, Trash2 } from 'lucide-react';
import { type PointerEvent as EvenementPointeur, useRef } from 'react';
import { Alerte, Libelle, SousTitre } from '@/components/ui/base';
import { Bouton } from '@/components/ui/bouton';
import { CADRE_COMPLET, type Cadre, ajusterCadre, normaliserCadre } from '@/lib/image/geometrie';
import type { Lisibilite } from '@/lib/image/lisibilite';

type Poignee = 'hg' | 'hd' | 'bg' | 'bd' | 'centre';

export interface PageEditee {
  id: string;
  apercu: string;
  cadre: Cadre;
  lisibilite: Lisibilite | null;
}

const pourcent = (v: number) => Math.round(v * 100);

/** Indicateur de lisibilité : avertit sans bloquer, et se présente comme une indication, pas une garantie. */
export function IndicateurLisibilite({ lisibilite }: { lisibilite: Lisibilite | null }) {
  if (!lisibilite) return null;
  const avertissements = lisibilite.avertissements;
  return (
    <Alerte ton={avertissements.length ? 'attention' : 'neutre'} titre="Lisibilité (indication)" data-testid="lisibilite">
      {avertissements.length ? (
        <ul className="mt-1 list-disc pl-5">
          {avertissements.map((a) => (
            <li key={a.code}>{a.message}</li>
          ))}
        </ul>
      ) : (
        <p>Aucun défaut évident détecté.</p>
      )}
      <p className="mt-1 text-sm">
        Contrôle automatique indicatif, calculé sur cet appareil : il ne garantit pas que la pièce sera lisible et ne vous empêche pas de
        l’envoyer.
      </p>
    </Alerte>
  );
}

/** Aperçu d'une page avec rotation par quarts de tour et recadrage par rectangle ajustable (poignées ou curseurs). */
export function EditeurPage({
  page,
  numero,
  occupe,
  surRotation,
  surCadre,
  surSuppression,
  surFermeture,
}: {
  page: PageEditee;
  numero: number;
  occupe: boolean;
  surRotation: () => void;
  surCadre: (c: Cadre) => void;
  surSuppression: () => void;
  surFermeture: () => void;
}) {
  const zone = useRef<SVGSVGElement>(null);
  const glisse = useRef<{ poignee: Poignee; x: number; y: number; cadre: Cadre } | null>(null);
  const c = page.cadre;

  function debut(e: EvenementPointeur<SVGElement>, poignee: Poignee) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    glisse.current = { poignee, x: e.clientX, y: e.clientY, cadre: c };
  }
  function mouvement(e: EvenementPointeur<SVGElement>) {
    const g = glisse.current;
    const rect = zone.current?.getBoundingClientRect();
    if (!g || !rect || rect.width === 0 || rect.height === 0) return;
    surCadre(ajusterCadre(g.cadre, g.poignee, (e.clientX - g.x) / rect.width, (e.clientY - g.y) / rect.height));
  }
  function fin() {
    glisse.current = null;
  }

  const x = c.x * 100;
  const y = c.y * 100;
  const l = c.l * 100;
  const h = c.h * 100;
  const poignees: Array<{ nom: Poignee; cx: number; cy: number }> = [
    { nom: 'hg', cx: x, cy: y },
    { nom: 'hd', cx: x + l, cy: y },
    { nom: 'bg', cx: x, cy: y + h },
    { nom: 'bd', cx: x + l, cy: y + h },
  ];
  const marge = (nom: 'gauche' | 'haut' | 'droite' | 'bas', valeur: number) => {
    const g = nom === 'gauche' ? valeur : c.x;
    const t = nom === 'haut' ? valeur : c.y;
    const d = nom === 'droite' ? valeur : 1 - c.x - c.l;
    const b = nom === 'bas' ? valeur : 1 - c.y - c.h;
    surCadre(normaliserCadre({ x: g, y: t, l: 1 - g - d, h: 1 - t - b }));
  };
  const curseurs = [
    { nom: 'gauche', libelle: 'Rogner à gauche', valeur: c.x },
    { nom: 'haut', libelle: 'Rogner en haut', valeur: c.y },
    { nom: 'droite', libelle: 'Rogner à droite', valeur: 1 - c.x - c.l },
    { nom: 'bas', libelle: 'Rogner en bas', valeur: 1 - c.y - c.h },
  ] as const;

  return (
    <section aria-labelledby="titre-editeur" className="space-y-3 rounded-xl border-2 border-primaire bg-surface p-3" data-testid="editeur-page">
      <SousTitre id="titre-editeur">Page {numero} — ajuster</SousTitre>
      <div className="flex justify-center rounded-lg bg-surface-2 p-6">
        <div className="relative inline-block max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.apercu} alt={`Aperçu de la page ${numero}`} className="block max-h-[55dvh] w-auto max-w-full select-none" draggable={false} />
          <svg
            ref={zone}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full touch-none overflow-visible"
            onPointerMove={mouvement}
            onPointerUp={fin}
            onPointerCancel={fin}
            aria-hidden="true"
          >
            <path d={`M0 0H100V100H0Z M${x} ${y}V${y + h}H${x + l}V${y}Z`} fill="#000" fillOpacity="0.55" fillRule="evenodd" />
            <rect x={x} y={y} width={l} height={h} fill="transparent" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" className="cursor-move" onPointerDown={(e) => debut(e, 'centre')} />
            {poignees.map((p) => (
              <g key={p.nom}>
                {/* Zone de prise large (≥ 44 px sur un écran de téléphone), repère visible plus petit. */}
                <rect x={p.cx - 11} y={p.cy - 11} width="22" height="22" fill="transparent" className="cursor-grab" onPointerDown={(e) => debut(e, p.nom)} data-poignee={p.nom} />
                <rect x={p.cx - 2.5} y={p.cy - 2.5} width="5" height="5" fill="#fff" stroke="#1e3a5f" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Bouton variante="secondaire" onClick={surRotation} disabled={occupe}>
          <RotateCw aria-hidden="true" className="size-5" /> Pivoter d’un quart de tour
        </Bouton>
        <Bouton variante="secondaire" onClick={() => surCadre(CADRE_COMPLET)}>
          Annuler le recadrage
        </Bouton>
      </div>

      <fieldset className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <legend className="mb-1 font-medium">Recadrage (faites glisser les coins de l’image, ou utilisez ces réglages)</legend>
        {curseurs.map((k) => (
          <div key={k.nom}>
            <Libelle htmlFor={`rogner-${k.nom}`}>
              {k.libelle} : {pourcent(k.valeur)} %
            </Libelle>
            <input autoComplete="off"
              id={`rogner-${k.nom}`}
              type="range"
              min={0}
              max={90}
              step={1}
              value={pourcent(k.valeur)}
              onChange={(e) => marge(k.nom, Number(e.target.value) / 100)}
              className="h-11 w-full"
            />
          </div>
        ))}
      </fieldset>

      <IndicateurLisibilite lisibilite={page.lisibilite} />

      <div className="grid grid-cols-2 gap-2">
        <Bouton variante="danger" onClick={surSuppression}>
          <Trash2 aria-hidden="true" className="size-5" /> Supprimer la page
        </Bouton>
        <Bouton onClick={surFermeture}>Terminer</Bouton>
      </div>
    </section>
  );
}
