/**
 * Construction d'une archive ZIP EN FLUX, avec manifeste d'empreintes : commun aux restitutions (dossier et cabinet).
 * Chaque entrée est lue et écrite au fil de l'eau ; l'archive part dans le stockage pendant sa construction ; les
 * empreintes (de chaque entrée et de l'archive) sont calculées au passage. Rien n'est chargé en entier en mémoire.
 */
import { createHash } from 'node:crypto';
import { PassThrough, Readable, Transform } from 'node:stream';
import { finished } from 'node:stream/promises';
import yazl from 'yazl';
import type { Contexte } from './contexte.js';

export interface EntreeManifeste {
  chemin: string;
  taille: number;
  sha256: string;
}

export function ouvrirArchive(c: Contexte, cle: string) {
  const zip = new yazl.ZipFile();
  const hache = createHash('sha256');
  let taille = 0;
  const sortie = new PassThrough();
  zip.outputStream.on('data', (m: Buffer) => {
    hache.update(m);
    taille += m.length;
  });
  zip.outputStream.pipe(sortie);
  const envoi = c.stockage.deposerFlux(cle, sortie, 'application/zip');
  envoi.catch(() => undefined); // l'erreur est relevée par l'attente explicite de `terminer`
  const manifeste: EntreeManifeste[] = [];

  /** Ajoute une entrée lue en flux. Les entrées se suivent une à une : la suivante n'est lue qu'une fois celle-ci écrite. */
  const ajouterFlux = async (chemin: string, source: Readable): Promise<EntreeManifeste> => {
    const h = createHash('sha256');
    let octets = 0;
    const compteur = new Transform({
      transform(morceau: Buffer, _e, suite) {
        h.update(morceau);
        octets += morceau.length;
        suite(null, morceau);
      },
    });
    source.on('error', (e) => compteur.destroy(e));
    zip.addReadStream(source.pipe(compteur), chemin);
    await finished(compteur, { writable: false });
    const entree = { chemin, taille: octets, sha256: h.digest('hex') };
    manifeste.push(entree);
    return entree;
  };

  return {
    manifeste,
    ajouterFlux,
    ajouterTexte: (chemin: string, texte: string) => ajouterFlux(chemin, Readable.from([Buffer.from(texte, 'utf8')])),
    /** Entrée produite par un générateur de fragments de texte (JSON, CSV…) : jamais assemblée en mémoire. */
    ajouterFragments: (chemin: string, fragments: AsyncIterable<string>) =>
      ajouterFlux(chemin, Readable.from((async function* () {
        for await (const f of fragments) if (f) yield Buffer.from(f, 'utf8');
      })())),
    /** Écrit le manifeste (dernière entrée, non listée dans elle-même), clôt l'archive et attend la fin de l'envoi. */
    async terminer(enTete: Record<string, unknown>): Promise<{ sha256: string; taille: number }> {
      zip.addBuffer(Buffer.from(JSON.stringify({ ...enTete, fichiers: manifeste }, null, 2), 'utf8'), 'manifeste.json');
      zip.end();
      await envoi;
      return { sha256: hache.digest('hex'), taille };
    },
    abandonner(erreur: unknown): void {
      sortie.destroy(erreur instanceof Error ? erreur : new Error('erreur'));
    },
  };
}

/** Fragments d'un tableau JSON dont les éléments arrivent par tranches. */
export async function* tableauJson(tranches: AsyncIterable<readonly unknown[]>): AsyncGenerator<string> {
  let premier = true;
  yield '[';
  for await (const tranche of tranches) {
    if (!tranche.length) continue;
    yield (premier ? '\n' : ',\n') + tranche.map((x) => JSON.stringify(x)).join(',\n');
    premier = false;
  }
  yield premier ? ']' : '\n]';
}

/** Fragments d'un objet JSON dont certaines valeurs sont elles-mêmes produites en flux (générateurs de fragments). */
export async function* objetJson(champs: Record<string, unknown>): AsyncGenerator<string> {
  let premier = true;
  yield '{';
  for (const [cle, valeur] of Object.entries(champs)) {
    yield `${premier ? '\n' : ',\n'}${JSON.stringify(cle)}: `;
    premier = false;
    if (valeur && typeof (valeur as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') yield* valeur as AsyncIterable<string>;
    else yield JSON.stringify(valeur, null, 2);
  }
  yield '\n}\n';
}

/** Cellule CSV : neutralise les formules de tableur et protège le séparateur « ; ». */
export const csv = (v: unknown): string => {
  const t = v === null || v === undefined ? '' : String(v);
  const neutre = /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(neutre) ? `"${neutre.replace(/"/g, '""')}"` : neutre;
};

export const COLONNES_ECRITURES = ['numeroLigne', 'journalCode', 'journalLib', 'ecritureNum', 'ecritureDate', 'compteNum', 'compteLib', 'compAuxNum', 'compAuxLib', 'pieceRef', 'pieceDate', 'ecritureLib', 'debit', 'credit', 'ecritureLet', 'dateLet', 'validDate', 'montantDevise', 'idevise'] as const;

export const MOTIF_ORIGINAL_NON_CONFORME = 'empreinte différente de celle enregistrée : fichier non restitué, à examiner';

/**
 * Règle COMMUNE aux deux restitutions pour un original : il est d'abord relu en flux pour vérifier son empreinte, puis
 * recopié en flux dans l'archive. Si son contenu ne correspond plus à l'empreinte enregistrée, il N'EST PAS restitué
 * (une archive de restitution ne doit pas faire passer un fichier altéré pour l'original reçu) et l'appelant le signale.
 */
export async function ajouterOriginalVerifie(c: Contexte, archive: ReturnType<typeof ouvrirArchive>, chemin: string, cleStockage: string, sha256Attendu: string): Promise<{ restitue: true; taille: number } | { restitue: false }> {
  const h = createHash('sha256');
  for await (const m of await c.stockage.lireFlux(cleStockage)) h.update(m as Uint8Array);
  if (h.digest('hex') !== sha256Attendu) return { restitue: false };
  const entree = await archive.ajouterFlux(chemin, await c.stockage.lireFlux(cleStockage));
  // Le fichier a pu changer entre les deux lectures : l'entrée écrite doit elle aussi correspondre.
  if (entree.sha256 !== sha256Attendu) throw new Error('Un original a changé pendant sa restitution : archive abandonnée');
  return { restitue: true, taille: entree.taille };
}
