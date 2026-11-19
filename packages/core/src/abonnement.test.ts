import { describe, expect, it } from 'vitest';
import { calculerEcheance, etatQuota, type Offre, serviceOuvert, situationAbonnement, verifierOffre } from './abonnement.js';

const offre: Offre = {
  code: 'essentiel',
  libelle: 'Essentiel',
  forfaitMensuel: '100.00',
  dossiersInclus: 10,
  tranches: [
    { jusqua: 50, prixParDossier: '4.00' },
    { jusqua: 200, prixParDossier: '3.10' },
    { jusqua: null, prixParDossier: '2.25' },
  ],
  quotas: { piecesParMois: 1000, stockageGo: 20 },
  joursEssai: 30,
  fictif: true,
};

describe('calculerEcheance', () => {
  it('ne facture que le forfait jusqu’aux dossiers inclus', () => {
    for (const n of [0, 1, 10]) {
      const r = calculerEcheance(offre, n);
      expect(r).toMatchObject({ statut: 'calcule', totalHt: '100.00', dossiersFactures: 0, fictif: true });
      expect(r.lignes).toHaveLength(1);
    }
  });

  it('applique un barème progressif, exactement, aux bornes des tranches', () => {
    expect(calculerEcheance(offre, 11).totalHt).toBe('104.00');
    expect(calculerEcheance(offre, 50).totalHt).toBe('260.00'); // 100 + 40 × 4
    expect(calculerEcheance(offre, 51).totalHt).toBe('263.10'); // + 1 × 3,10
    expect(calculerEcheance(offre, 200).totalHt).toBe('725.00'); // 100 + 160 + 150 × 3,10
    const r = calculerEcheance(offre, 203);
    expect(r.totalHt).toBe('731.75'); // + 3 × 2,25
    expect(r.lignes.map((l) => [l.nature, l.quantite, l.montant])).toEqual([
      ['forfait', 1, '100.00'],
      ['tranche', 40, '160.00'],
      ['tranche', 150, '465.00'],
      ['tranche', 3, '6.75'],
    ]);
    expect(r.dossiersFactures).toBe(193);
  });

  it('la somme des lignes égale toujours le total, sans erreur d’arrondi flottant', () => {
    const o: Offre = { ...offre, forfaitMensuel: '0.10', tranches: [{ jusqua: null, prixParDossier: '0.20' }], dossiersInclus: 0 };
    expect(calculerEcheance(o, 1).totalHt).toBe('0.30'); // 0,1 + 0,2
    for (let n = 0; n < 400; n += 7) {
      const r = calculerEcheance(offre, n);
      const somme = r.lignes.reduce((t, l) => t + BigInt(l.montant.replace('.', '')), 0n);
      expect(somme).toBe(BigInt(r.totalHt!.replace('.', '')));
    }
  });

  it('s’abstient quand aucune tranche ne couvre le volume, ou quand la grille est incohérente', () => {
    const plafonnee: Offre = { ...offre, tranches: [{ jusqua: 50, prixParDossier: '4.00' }] };
    expect(calculerEcheance(plafonnee, 50).statut).toBe('calcule');
    const r = calculerEcheance(plafonnee, 51);
    expect(r).toMatchObject({ statut: 'non_calculable', totalHt: null });
    expect(r.motif).toMatch(/Aucune tranche/);
    const desordre: Offre = { ...offre, tranches: [{ jusqua: null, prixParDossier: '1.00' }, { jusqua: 50, prixParDossier: '4.00' }] };
    expect(verifierOffre(desordre).length).toBeGreaterThan(0);
    expect(calculerEcheance(desordre, 60).statut).toBe('non_calculable');
    expect(calculerEcheance(offre, -1).statut).toBe('non_calculable');
    expect(calculerEcheance(offre, 1.5).statut).toBe('non_calculable');
  });
});

describe('situationAbonnement', () => {
  const essai = { statut: 'essai' as const, debut: '2026-01-01', finEssai: '2026-01-31', fin: null };
  it('distingue essai en cours et essai expiré d’après la date, sans dépendre d’une mise à jour manuelle', () => {
    expect(situationAbonnement(essai, '2026-01-31')).toBe('essai');
    expect(situationAbonnement(essai, '2026-02-01')).toBe('essai_expire');
    expect(situationAbonnement(null, '2026-02-01')).toBe('aucun');
  });
  it('laisse le service ouvert jusqu’à l’échéance d’une résiliation, puis le ferme', () => {
    const resilie = { statut: 'resilie' as const, debut: '2026-01-01', finEssai: null, fin: '2026-06-30' };
    expect(situationAbonnement(resilie, '2026-06-30')).toBe('resiliation_programmee');
    expect(situationAbonnement(resilie, '2026-07-01')).toBe('resilie');
    expect(serviceOuvert('resiliation_programmee')).toBe(true);
    for (const s of ['resilie', 'suspendu', 'essai_expire', 'aucun'] as const) expect(serviceOuvert(s)).toBe(false);
    for (const s of ['essai', 'actif'] as const) expect(serviceOuvert(s)).toBe(true);
  });
});

describe('etatQuota', () => {
  it('signale le dépassement sans jamais supposer une limite', () => {
    expect(etatQuota(10, null)).toEqual({ consomme: 10, limite: null, restant: null, depasse: false, tauxPourcent: null });
    expect(etatQuota(250, 1000)).toMatchObject({ restant: 750, depasse: false, tauxPourcent: 25 });
    expect(etatQuota(1000, 1000).depasse).toBe(false);
    expect(etatQuota(1001, 1000)).toMatchObject({ restant: 0, depasse: true });
  });
});
