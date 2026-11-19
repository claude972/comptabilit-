/** Aides réservées aux tests (exclues du build). */
import { analyserFec, enBlocs } from './fec/analyser.js';
import type { OptionsAnalyseFec, RapportFec } from './fec/types.js';
import type { LigneEcriture } from './controles/types.js';

export function octets(texte: string): Uint8Array {
  return new TextEncoder().encode(texte);
}

export async function lireFec(
  contenu: Uint8Array | string,
  options: Omit<OptionsAnalyseFec, 'surLigne'> = {},
  tailleBloc = 65_536,
): Promise<{ rapport: RapportFec; lignes: LigneEcriture[] }> {
  const lignes: LigneEcriture[] = [];
  const rapport = await analyserFec(enBlocs(typeof contenu === 'string' ? octets(contenu) : contenu, tailleBloc), {
    ...options,
    surLigne: (l) => {
      lignes.push({ ...l, id: `L${l.numeroLigne}` });
    },
  });
  return { rapport, lignes };
}

let compteur = 0;
/** Fabrique une ligne d'écriture minimale pour les tests unitaires des contrôles. */
export function ligne(p: Partial<LigneEcriture> & { compteNum: string }): LigneEcriture {
  compteur++;
  return {
    id: p.id ?? `T${compteur}`,
    numeroLigne: compteur + 1,
    journalCode: 'OD',
    journalLib: 'Opérations diverses',
    ecritureNum: 'OD000001',
    ecritureDate: '2025-06-15',
    compteLib: `Compte ${p.compteNum}`,
    compAuxNum: null,
    compAuxLib: null,
    pieceRef: 'P1',
    pieceDate: p.ecritureDate ?? '2025-06-15',
    ecritureLib: 'Libellé',
    debit: '0.00',
    credit: '0.00',
    ecritureLet: null,
    dateLet: null,
    validDate: p.ecritureDate ?? '2025-06-15',
    montantDevise: null,
    idevise: null,
    ...p,
  };
}

/** Écriture équilibrée à deux lignes. */
export function ecriture(
  num: string,
  date: string,
  compteDebit: string,
  compteCredit: string,
  montant: string,
  extra: { journal?: string; piece?: string; auxDebit?: string; auxCredit?: string; lettreDebit?: string; lettreCredit?: string } = {},
): LigneEcriture[] {
  const commun = { ecritureNum: num, ecritureDate: date, journalCode: extra.journal ?? 'OD', pieceRef: extra.piece ?? `P-${num}` };
  return [
    ligne({ ...commun, compteNum: compteDebit, debit: montant, compAuxNum: extra.auxDebit ?? null, ecritureLet: extra.lettreDebit ?? null }),
    ligne({ ...commun, compteNum: compteCredit, credit: montant, compAuxNum: extra.auxCredit ?? null, ecritureLet: extra.lettreCredit ?? null }),
  ];
}

export const EXERCICE_2025 = { debut: '2025-01-01', fin: '2025-12-31' } as const;
