/** Colonne N-1 : contiguïté, mêmes règles que N, abstention motivée, aucun flottant. */
import { describe, expect, it } from 'vitest';
import { jeuPrincipal } from '../jeux-etats-tests.js';
import { calculerBalance } from './balance.js';
import { MOTIF_SANS_PRECEDENT, projeterEtatsPrecedent, verifierExercicePrecedent } from './comparatif.js';
import { type DemandeLiasse, type LiasseProjet, preparerLiasse } from './liasse.js';

const N = { debut: '2026-01-01', fin: '2026-12-30' };
const N1 = { debut: '2025-01-01', fin: '2025-12-31' };
const balanceN = calculerBalance(jeuPrincipal(2026, '2026-12-30'), { auxiliaire: true });
const balanceN1 = calculerBalance(jeuPrincipal(2025), { auxiliaire: true });

function demande(surcharge: Partial<DemandeLiasse> = {}): DemandeLiasse {
  return { balance: balanceN, exercice: N, regime: 'reel_normal', territoire: 'metropole', impotSurLeResultat: 'is', referentielComptable: 'PCG', devise: 'EUR', societeCommerciale: true, ...surcharge };
}
function projet(d: DemandeLiasse): LiasseProjet {
  const r = preparerLiasse(d);
  if (r.statut !== 'projet') throw new Error('projet attendu');
  return r;
}

describe('exercice précédent', () => {
  it('exige la contiguïté', () => {
    expect(verifierExercicePrecedent(N, N1).motif).toBeNull();
    expect(verifierExercicePrecedent(N, { debut: '2024-01-01', fin: '2024-12-31' }).motif).toMatch(/pas contigu/);
    expect(verifierExercicePrecedent(N, { debut: '2025-01-01', fin: '2025-12-30' }).motif).toMatch(/pas contigu/);
  });
  it('signale un exercice qui n’a pas douze mois', () => {
    const court = verifierExercicePrecedent({ debut: '2025-07-01', fin: '2026-06-30' }, { debut: '2025-01-01', fin: '2025-06-30' });
    expect(court.motif).toBeNull();
    expect(court.reserves.join(' ')).toMatch(/6 mois/);
    expect(verifierExercicePrecedent(N, N1).reserves).toHaveLength(1);
  });
});

describe('liasse avec colonne N-1', () => {
  it('sans exercice précédent : indisponible, motif, n1 nul sur chaque ligne, aucun chiffre inventé', () => {
    const p = projet(demande());
    expect(p.comparatif).toEqual({ statut: 'indisponible', motifs: [MOTIF_SANS_PRECEDENT] });
    expect(p.tableaux.flatMap((t) => t.lignes).every((l) => l.n1 === null)).toBe(true);
    expect(p.manques.some((m) => /Colonne N-1 indisponible/.test(m))).toBe(true);
  });

  it('avec un exercice précédent contigu : mêmes lignes, montants N-1 = ceux de la liasse N-1 seule', () => {
    const seul = projet(demande({ balance: balanceN1, exercice: N1 }));
    const p = projet(demande({ precedent: { balance: balanceN1, exercice: N1 } }));
    expect(p.comparatif.statut).toBe('fourni');
    if (p.comparatif.statut !== 'fourni') return;
    expect(p.comparatif.exercice).toEqual(N1);
    expect(p.comparatif.totaux).toEqual(seul.totaux);
    const lignesSeules = new Map(seul.tableaux.flatMap((t) => t.lignes).map((l) => [l.ligne, l]));
    for (const l of p.tableaux.flatMap((t) => t.lignes)) {
      const ref = lignesSeules.get(l.ligne)!;
      expect(l.n1).toEqual({ montant: ref.montant, ...(ref.brut !== undefined ? { brut: ref.brut, amortissementsDepreciations: ref.amortissementsDepreciations } : {}) });
      expect(typeof l.n1!.montant).toBe('string');
    }
    // Le calcul de l'exercice N n'est pas modifié par la présence de N-1.
    const sansN1 = projet(demande());
    expect(p.totaux).toEqual(sansN1.totaux);
    expect(p.tableaux.flatMap((t) => t.lignes).map((l) => l.montant)).toEqual(sansN1.tableaux.flatMap((t) => t.lignes).map((l) => l.montant));
    expect(p.statut).toBe('projet');
    expect(p.complet).toBe(false);
  });

  it('exercice précédent non contigu ou hors périmètre : colonne indisponible avec motif', () => {
    const trou = projet(demande({ precedent: { balance: balanceN1, exercice: { debut: '2024-01-01', fin: '2024-12-31' } } }));
    expect(trou.comparatif.statut).toBe('indisponible');
    const avant2025 = projet(demande({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, balance: balanceN1, precedent: { balance: balanceN1, exercice: { debut: '2024-01-01', fin: '2024-12-31' } } }));
    expect(avant2025.comparatif.statut).toBe('indisponible');
    if (avant2025.comparatif.statut === 'indisponible') expect(avant2025.comparatif.motifs.join(' ')).toMatch(/périmètre/);
    // Motif précis transmis par l'appelant (plafond de volume).
    const plafond = projet(demande({ motifPrecedentAbsent: 'Plafond dépassé.' }));
    expect(plafond.comparatif).toEqual({ statut: 'indisponible', motifs: ['Plafond dépassé.'] });
  });

  it('abstention de N : aucune colonne, aucun chiffre', () => {
    const r = preparerLiasse(demande({ territoire: 'a_confirmer', precedent: { balance: balanceN1, exercice: N1 } }));
    expect(r.statut).toBe('abstention');
    expect(JSON.stringify(r)).not.toMatch(/n1|comparatif/);
  });

  it('régime simplifié : la colonne suit la même table', () => {
    const p = projet(demande({ regime: 'reel_simplifie', precedent: { balance: balanceN1, exercice: N1 } }));
    expect(p.comparatif.statut).toBe('fourni');
    expect(p.tableaux.flatMap((t) => t.lignes).every((l) => l.n1 !== null)).toBe(true);
  });
});

describe('états projetés N-1', () => {
  it('fournit bilan et compte de résultat de l’exercice précédent', () => {
    const e = projeterEtatsPrecedent(N, { balance: balanceN1, exercice: N1 });
    expect(e.statut).toBe('fourni');
    if (e.statut !== 'fourni') return;
    expect(e.bilan.totaux['total_actif']).toBe(e.bilan.totaux['total_passif']);
    expect(e.compteDeResultat.rubriques.length).toBeGreaterThan(0);
  });
  it('abstient sans table ou sans contiguïté', () => {
    expect(projeterEtatsPrecedent(N, null).statut).toBe('indisponible');
    expect(projeterEtatsPrecedent(N, { balance: balanceN1, exercice: { debut: '2023-01-01', fin: '2023-12-31' } }).statut).toBe('indisponible');
    const avant = projeterEtatsPrecedent({ debut: '2025-01-01', fin: '2025-12-31' }, { balance: balanceN1, exercice: { debut: '2024-01-01', fin: '2024-12-31' } });
    expect(avant.statut).toBe('indisponible');
  });
});
