import { describe, expect, it } from 'vitest';
import { csvEtatJoint, etatJointDe } from '../../src/lib/etat-joint';
import type { ReponseLiasse, Reprise2050StocksProjet } from '../../src/lib/fiscal';

const reprise: Reprise2050StocksProjet = {
  statut: 'projet',
  etat: 'decidee',
  decision: { note: 'Ventilation justifiée par le dossier de production', qualifieePar: 'u', le: '2026-12-31T10:00:00Z', versionDonnees: 7 },
  cases: [
    { code: 'BN', libelle: 'En cours de production de biens — brut', montant: '700.00', statut: 'repris', motif: null },
    { code: 'BO', libelle: 'En cours de production de biens — amortissements et provisions', montant: '100.00', statut: 'repris', motif: null },
    { code: 'BP', libelle: 'En cours de production de services — brut', montant: '300.00', statut: 'repris', motif: null },
    { code: 'BQ', libelle: 'En cours de production de services — amortissements et provisions', montant: '0.00', statut: 'repris', motif: null },
    { code: 'BR', libelle: 'Produits intermédiaires et finis — brut', montant: null, statut: 'abstention', motif: 'le montant ventilé diffère (écart -50.00)' },
    { code: 'BS', libelle: 'Produits intermédiaires et finis — amortissements et provisions', montant: null, statut: 'abstention', motif: 'le montant ventilé diffère' },
  ],
  totalEnCours: { brut: '1000.00', amortissements: '100.00' },
  sources: { enCoursBrut: '1000.00', enCoursAmortissements: '100.00', produitsBrut: '500.00', produitsAmortissements: '0.00' },
  notes: ['Jamais ajoutées aux totaux.'],
};

describe('état joint : cases BN à BS retenues du 2050 (D-170)', () => {
  it('le tableau de l’état joint et le CSV portent les mêmes montants retenus que la réponse de l’API, et les abstentions avec leur motif', () => {
    const t = etatJointDe({ regimeDemande: 'reel_normal', reprise2050Stocks: reprise } as unknown as ReponseLiasse).find((x) => x.id === 'liasse-2050-STOCKS-REPRISE')!;
    expect(t.lignes.map((l) => [l.cellules[0], l.cellules[1]])).toEqual([['BN', '700.00'], ['BO', '100.00'], ['BP', '300.00'], ['BQ', '0.00'], ['BR', 'abstention : le montant ventilé diffère (écart -50.00)'], ['BS', 'abstention : le montant ventilé diffère']]);
    const csv = csvEtatJoint([t], ['Dossier fictif']);
    for (const c of reprise.cases) expect(csv).toContain(c.montant !== null ? `;${c.code};${c.montant}` : `;${c.code};abstention`);
    expect(csv).toContain('brut 1000.00');
  });
});
