/** Recette : corpus synthétique propre, anomalies injectées, volume. */
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireFec } from './aides-tests.js';
import { executerControles } from './controles/catalogue.js';
import { analyserFec, enBlocs } from './fec/analyser.js';
import { genererFecSynthetique } from './synthetique/fec.js';
import type { AnomalieSynthetique, OptionsFecSynthetique } from './synthetique/fec.js';

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const FORMATS: Array<NonNullable<OptionsFecSynthetique['format']>> = [
  { separateur: 'tabulation', encodage: 'utf8', variante: 'debit_credit', decimale: ',' },
  { separateur: 'pipe', encodage: 'latin9', variante: 'debit_credit', decimale: ',' },
  { separateur: 'tabulation', encodage: 'latin9', variante: 'montant_sens', decimale: ',' },
  { separateur: 'pipe', encodage: 'utf8', variante: 'montant_sens', decimale: ',' },
];

describe('recette — corpus propre', () => {
  for (const graine of [1, 7, 42, 2025, 987654]) {
    for (const [i, format] of FORMATS.entries()) {
      it(`graine ${graine}, format ${i + 1} (${format.separateur}/${format.encodage}/${format.variante}) : FEC conforme, aucun constat`, async () => {
        const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 600, graine, format });
        const { rapport, lignes } = await lireFec(fec.contenu, { nomFichier: fec.nomFichier, siren: '123456782', exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin });
        expect(rapport.anomalies).toEqual([]);
        expect(rapport.conforme).toBe(true);
        expect(rapport.lisible).toBe(true);
        expect(rapport.suffisantPourTravaux).toBe(true);
        expect(rapport.nbLignesNormalisees).toBe(fec.nbLignes);
        expect(rapport.totalDebit).toBe(rapport.totalCredit);
        expect(rapport.variante).toBe(format.variante);
        expect(rapport.separateur).toBe(format.separateur);
        expect(rapport.encodage).toBe(format.encodage === 'latin9' ? 'iso-8859-15' : 'utf-8');
        const resultats = executerControles({ lignes, exercice: EXERCICE });
        expect(resultats).toHaveLength(12);
        for (const r of resultats) {
          expect(r.constats, `${r.controleId} : ${JSON.stringify(r.constats[0] ?? null)}`).toEqual([]);
          expect(['sans_anomalie', 'non_applicable'], `${r.controleId} : ${r.statut} (${r.motif ?? ''})`).toContain(r.statut);
        }
        // Les contrôles portant sur des comptes présents dans le corpus sont réellement exécutés.
        const statuts = Object.fromEntries(resultats.map((r) => [r.controleId, r.statut]));
        expect(statuts).toMatchObject({
          'GEN-001': 'sans_anomalie', 'GEN-002': 'sans_anomalie', 'GEN-003': 'sans_anomalie', 'GEN-004': 'sans_anomalie',
          'GEN-005': 'non_applicable', 'TRE-001': 'sans_anomalie', 'TRE-002': 'sans_anomalie', 'TIE-001': 'sans_anomalie',
          'TIE-002': 'sans_anomalie', 'TIE-003': 'sans_anomalie', 'CAP-001': 'sans_anomalie', 'TVA-001': 'sans_anomalie',
        });
      });
    }
  }

  it('format à point décimal : lu sans perte, mais signalé non conforme (virgule requise par A47 A-1)', async () => {
    const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 200, graine: 3, format: { decimale: '.' } });
    const { rapport, lignes } = await lireFec(fec.contenu, { nomFichier: fec.nomFichier });
    expect(Object.keys(rapport.nbAnomaliesParCode)).toEqual(['MONTANT_SEPARATEUR_POINT']);
    expect(rapport.conforme).toBe(false);
    expect(rapport.lisible).toBe(true);
    expect(rapport.suffisantPourTravaux).toBe(true);
    for (const r of executerControles({ lignes, exercice: EXERCICE })) expect(r.constats).toEqual([]);
  });

  it('le corpus propre n’est pas « propre » par vacuité : des paramètres plus stricts font apparaître des constats', async () => {
    const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 600, graine: 42 });
    const { lignes } = await lireFec(fec.contenu);
    const r = executerControles({ lignes, exercice: EXERCICE }, { ids: ['TIE-003', 'TVA-001', 'TRE-001'], parametres: { 'TIE-003': { seuilJours: 5 }, 'TVA-001': { tauxAttendus: ['5.5'] }, 'TRE-001': { prefixesComptes: ['512'], seuil: '0.00' } } });
    expect(r.map((x) => x.statut)).toEqual(['constat', 'constat', 'sans_anomalie']);
    expect(lignes.some((l) => l.ecritureLet !== null)).toBe(true);
    expect(new Set(lignes.map((l) => l.journalCode))).toEqual(new Set(['AN', 'VT', 'AC', 'BQ', 'CA', 'OD']));
  });

  it('le générateur est déterministe pour une graine donnée et varie avec la graine', () => {
    const a = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 5 });
    const b = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 5 });
    const c = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 300, graine: 6 });
    expect(Buffer.from(a.contenu).equals(Buffer.from(b.contenu))).toBe(true);
    expect(Buffer.from(a.contenu).equals(Buffer.from(c.contenu))).toBe(false);
    expect(a.nomFichier).toBe('123456782FEC20251231.txt');
  });
});

describe('recette — anomalies injectées', () => {
  const TOUTES: AnomalieSynthetique[] = ['desequilibre', 'rupture_sequence', 'hors_exercice', 'doublon', 'caisse_crediteur', 'attente_non_solde', 'client_crediteur', 'cca_debiteur'];

  for (const type of TOUTES) {
    for (const graine of [11, 314]) {
      it(`« ${type} » (graine ${graine}) est détectée par le contrôle attendu, avec le bon montant`, async () => {
        const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 500, graine, anomalies: [type] });
        expect(fec.anomaliesInjectees).toHaveLength(1);
        const injectee = fec.anomaliesInjectees[0]!;
        const { lignes } = await lireFec(fec.contenu);
        const resultat = executerControles({ lignes, exercice: EXERCICE }, { ids: [injectee.controleAttendu] })[0]!;
        expect(resultat.statut).toBe('constat');
        const idsEcriture = new Set(lignes.filter((l) => l.ecritureNum === injectee.ecritureNum && l.journalCode === injectee.journalCode).map((l) => l.id));
        expect(idsEcriture.size).toBeGreaterThan(0);
        const constat = resultat.constats.find((c) => c.lignesConcernees.some((id) => idsEcriture.has(id)));
        expect(constat, `aucun constat de ${injectee.controleAttendu} ne vise l'écriture ${injectee.ecritureNum}`).toBeDefined();
        expect(constat!.montant).toBe(injectee.montantAttendu);
      });
    }
  }

  it('toutes les anomalies injectées ensemble sont chacune détectées', async () => {
    const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 800, graine: 99, anomalies: TOUTES });
    expect(fec.anomaliesInjectees.map((a) => a.type).sort()).toEqual([...TOUTES].sort());
    const { rapport, lignes } = await lireFec(fec.contenu, { exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin });
    expect(rapport.nbAnomaliesParCode['ECRITURE_DESEQUILIBREE']).toBe(1);
    expect(rapport.nbAnomaliesParCode['DESEQUILIBRE_GLOBAL']).toBe(1);
    expect(rapport.nbAnomaliesParCode['DATE_HORS_EXERCICE']).toBe(2);
    // Ces anomalies sont comptables, pas des écarts de format : le fichier reste conforme au référentiel A47 A-1.
    expect(rapport.conforme).toBe(true);
    const resultats = executerControles({ lignes, exercice: EXERCICE });
    for (const a of fec.anomaliesInjectees) {
      const r = resultats.find((x) => x.controleId === a.controleAttendu)!;
      expect(r.statut, a.type).toBe('constat');
      if (a.montantAttendu !== null) expect(r.constats.map((c) => c.montant), a.type).toContain(a.montantAttendu);
    }
  });
});

describe('recette — volume', () => {
  it('analyse en flux un FEC de plus de 100 000 lignes avec une mémoire bornée', async () => {
    const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 40_000, graine: 2026 });
    expect(fec.nbLignes).toBeGreaterThanOrEqual(100_000);
    const tailleMo = fec.contenu.length / 1_048_576;
    const options = { nomFichier: fec.nomFichier, exerciceDebut: EXERCICE.debut, exerciceFin: EXERCICE.fin };

    // Passe 1 : durée, sans instrumentation.
    let nb = 0;
    const debut = performance.now();
    const rapport = await analyserFec(enBlocs(fec.contenu, 64 * 1024), { ...options, surLigne: () => { nb++; } });
    const dureeMs = performance.now() - debut;
    expect(nb).toBe(fec.nbLignes);
    expect(rapport.nbLignesNormalisees).toBe(fec.nbLignes);
    expect(rapport.conforme).toBe(true);
    expect(rapport.anomalies).toEqual([]);
    expect(rapport.totalDebit).toBe(rapport.totalCredit);

    // Passe 2 : mémoire RETENUE, mesurée après ramasse-miettes forcé toutes les 10 000 lignes.
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    gc();
    const tasAvant = process.memoryUsage().heapUsed;
    let tasMax = tasAvant;
    let nb2 = 0;
    await analyserFec(enBlocs(fec.contenu, 64 * 1024), {
      ...options,
      surLigne: () => {
        nb2++;
        if (nb2 % 10_000 === 0) {
          gc();
          tasMax = Math.max(tasMax, process.memoryUsage().heapUsed);
        }
      },
    });
    const croissanceMo = (tasMax - tasAvant) / 1_048_576;
    // Mesures observées, affichées pour le rapport de recette (ce ne sont pas des objectifs contractuels).
    console.info(
      `[volume] ${fec.nbLignes} lignes, ${tailleMo.toFixed(1)} Mo, analyse en ${dureeMs.toFixed(0)} ms ; ` +
        `croissance maximale du tas retenu pendant l'analyse : ${croissanceMo.toFixed(2)} Mo (échantillonnée après gc toutes les 10 000 lignes) ; RSS du processus de test ${(process.memoryUsage().rss / 1_048_576).toFixed(0)} Mo`,
    );
    // Garde-fou : très inférieur à ce que coûterait l'accumulation des 100 000 lignes normalisées.
    expect(croissanceMo).toBeLessThan(10);
  });
});
