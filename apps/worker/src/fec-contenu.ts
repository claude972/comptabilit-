/**
 * Analyse EN FLUX d'un FEC dans le processus enfant : les octets arrivent par l'entrée standard, les lignes normalisées
 * repartent par lots dans des trames bornées, puis le rapport. Ce module ne s'exécute que dans le processus enfant
 * d'analyse ; le processus du worker ne l'importe jamais (vérifié par test).
 *
 * Contre-pression : chaque trame attend que la sortie standard l'ait acceptée avant que la lecture reprenne. Quand le
 * parent tarde (insertion en base), le tube se remplit, l'enfant s'arrête d'écrire puis de lire, et le parent cesse à
 * son tour d'être lu par l'enfant : la mémoire des deux processus reste bornée quel que soit le volume du fichier.
 */
import { analyserFec, type LigneFec } from '@comtaple/core';
import { LIGNES_PAR_LOT_FEC, OCTETS_PAR_LOT_FEC, type TrameFec } from './analyse-types.js';

const tailleApprochee = (l: LigneFec): number =>
  260 + l.journalLib.length + l.ecritureNum.length + l.compteLib.length + (l.compAuxNum?.length ?? 0) + (l.compAuxLib?.length ?? 0) + l.pieceRef.length + l.ecritureLib.length + l.compteNum.length + l.journalCode.length;

export async function analyserFecEnFlux(
  source: AsyncIterable<Uint8Array>,
  options: { exerciceDebut: string; exerciceFin: string; nomFichier: string | null },
  emettre: (trame: TrameFec) => Promise<void>,
): Promise<void> {
  let lot: LigneFec[] = [];
  let octets = 0;
  const vider = async (): Promise<void> => {
    if (lot.length === 0) return;
    const lignes = lot;
    lot = [];
    octets = 0;
    await emettre({ t: 'lignes', lignes });
  };
  const rapport = await analyserFec(source, {
    exerciceDebut: options.exerciceDebut,
    exerciceFin: options.exerciceFin,
    ...(options.nomFichier ? { nomFichier: options.nomFichier } : {}),
    // Synchrone tant que le lot n'est pas plein : l'analyse n'attend que lorsqu'une trame part.
    surLigne: (ligne) => {
      lot.push(ligne);
      octets += tailleApprochee(ligne);
      if (lot.length >= LIGNES_PAR_LOT_FEC || octets >= OCTETS_PAR_LOT_FEC) return vider();
      return undefined;
    },
  });
  await vider();
  await emettre({ t: 'rapport', rapport });
}
