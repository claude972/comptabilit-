import { describe, expect, it } from 'vitest';
import { schemaContenuLettre } from './missions.js';
import { calculerRentabiliteMission } from './rentabilite.js';

const lettre = (id: string, dateEffet: string, prestations: string[], honoraires: Record<string, unknown>, statut = 'validee', version = 1) => ({
  id,
  dateEffet,
  statut,
  version,
  contenu: schemaContenuLettre.parse({
    perimetre: prestations.map((prestation) => ({ prestation })),
    duree: { debut: dateEffet, fin: null, taciteReconduction: true },
    honoraires: { mode: 'forfait', montantAnnuelHt: null, tauxHoraireHt: null, conditionsRevision: '', ...honoraires },
    obligationsCabinet: '', obligationsClient: '', livrables: [], mandats: [], limites: '',
  }),
});
const annee = { debut: '2025-01-01', fin: '2025-12-31' };

describe('calculerRentabiliteMission', () => {
  it('forfait annuel sur une année pleine, temps observés, taux horaire réalisé', () => {
    const r = calculerRentabiliteMission({
      periode: annee,
      lettres: [lettre('L1', '2025-01-01', ['tenue'], { montantAnnuelHt: '3650.00' })],
      travaux: [{ date: '2025-02-01', prestation: 'tenue', minutes: 600 }, { date: '2025-03-01', prestation: 'tenue', minutes: 1200 }],
    });
    expect(r.honoraires).toMatchObject({ statut: 'calcule', forfait: '3650.00', tempsPasse: '0.00', total: '3650.00' });
    expect(r.temps).toMatchObject({ minutesDansPerimetre: 1800, travauxSansTemps: 0, nbTravaux: 2 });
    expect(r.tauxHoraireRealise).toMatchObject({ statut: 'calcule', valeur: '121.67' }); // 3650 / 30 h
    expect(r.marge).toMatchObject({ statut: 'non_calculable', valeur: null }); // aucun coût fourni : aucune marge inventée
    expect(r.marge.motif).toMatch(/non renseigné/);
  });

  it('prorata exact quand un avenant change le forfait en cours de période', () => {
    const r = calculerRentabiliteMission({
      periode: annee,
      lettres: [lettre('L1', '2025-01-01', ['tenue'], { montantAnnuelHt: '3650.00' }), lettre('A1', '2025-07-01', ['tenue', 'fiscal_tva'], { montantAnnuelHt: '7300.00' }, 'validee', 2)],
      travaux: [],
    });
    // 181 jours à 10 €/jour + 184 jours à 20 €/jour
    expect(r.honoraires.detail.map((d) => [d.lettreId, d.jours, d.montant])).toEqual([['L1', 181, '1810.00'], ['A1', 184, '3680.00']]);
    expect(r.honoraires.total).toBe('5490.00');
    expect(r.tauxHoraireRealise).toMatchObject({ statut: 'non_calculable', valeur: null });
  });

  it('un avenant en projet ne compte pas ; les jours sans lettre ne rapportent rien', () => {
    const r = calculerRentabiliteMission({
      periode: annee,
      lettres: [lettre('L1', '2025-03-01', ['tenue'], { montantAnnuelHt: '3650.00' }), lettre('P', '2025-06-01', ['tenue'], { montantAnnuelHt: '99999.00' }, 'projet', 2)],
      travaux: [{ date: '2025-01-15', prestation: 'tenue', minutes: 90 }],
    });
    expect(r.honoraires.total).toBe('3060.00'); // 306 jours × 10
    expect(r.temps).toMatchObject({ minutesSansLettre: 90, minutesDansPerimetre: 0 });
    expect(r.mentions.join(' ')).toMatch(/59 jour\(s\) de la période ne sont couverts/);
  });

  it('temps passé : heures dans le périmètre × taux horaire saisi ; hors périmètre non compté en honoraires', () => {
    const r = calculerRentabiliteMission({
      periode: annee,
      lettres: [lettre('L1', '2025-01-01', ['conseil_ponctuel'], { mode: 'temps_passe', tauxHoraireHt: '120.00' })],
      travaux: [{ date: '2025-04-01', prestation: 'conseil_ponctuel', minutes: 90 }, { date: '2025-04-02', prestation: 'social_paie', minutes: 60 }],
      coutHoraire: '50.00',
    });
    expect(r.honoraires).toMatchObject({ forfait: '0.00', tempsPasse: '180.00', total: '180.00' });
    expect(r.temps).toMatchObject({ minutesDansPerimetre: 90, minutesHorsPerimetre: 60 });
    // Coût sur TOUT le temps passé (2,5 h × 50) ; marge = 180 − 125.
    expect(r.marge).toMatchObject({ statut: 'calcule', cout: '125.00', valeur: '55.00', tauxPourcent: '30.56' });
  });

  it('s’abstient quand un prix manque, et signale un résultat partiel quand des temps manquent', () => {
    const sansMontant = calculerRentabiliteMission({ periode: annee, lettres: [lettre('L1', '2025-01-01', ['tenue'], {})], travaux: [{ date: '2025-02-01', prestation: 'tenue', minutes: 60 }], coutHoraire: '50.00' });
    expect(sansMontant.honoraires).toMatchObject({ statut: 'non_calculable', total: null });
    expect(sansMontant.tauxHoraireRealise.valeur).toBeNull();
    expect(sansMontant.marge.valeur).toBeNull();
    const sansLettre = calculerRentabiliteMission({ periode: annee, lettres: [], travaux: [] });
    expect(sansLettre.honoraires.motif).toMatch(/Aucune lettre/);
    const partiel = calculerRentabiliteMission({
      periode: annee,
      lettres: [lettre('L1', '2025-01-01', ['tenue'], { montantAnnuelHt: '3650.00' })],
      travaux: [{ date: '2025-02-01', prestation: 'tenue', minutes: 600 }, { date: '2025-03-01', prestation: 'tenue', minutes: null }],
      coutHoraire: '40.00',
    });
    expect(partiel.temps.travauxSansTemps).toBe(1);
    expect(partiel.tauxHoraireRealise.statut).toBe('partiel');
    expect(partiel.marge).toMatchObject({ statut: 'partiel', cout: '400.00', valeur: '3250.00' });
  });

  it('perte : une marge négative est restituée telle quelle', () => {
    const r = calculerRentabiliteMission({ periode: annee, lettres: [lettre('L1', '2025-01-01', ['tenue'], { montantAnnuelHt: '365.00' })], travaux: [{ date: '2025-02-01', prestation: 'tenue', minutes: 600 }], coutHoraire: '60.00' });
    expect(r.marge).toMatchObject({ valeur: '-235.00', tauxPourcent: '-64.38' });
  });
});
