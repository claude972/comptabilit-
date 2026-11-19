/**
 * Équivalence PROUVÉE entre le calcul en mémoire (référence) et le calcul en flux des contrôles : mêmes statuts, mêmes
 * motifs, mêmes constats (clés, montants, textes, lignes concernées, ordre), mêmes mesures — égalité stricte.
 * Un contrôle n'a de calcul en flux que s'il passe ici sur tous les jeux.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ecriture } from '../aides-tests.js';
import { elementsBanqueDepuisEcritures } from '../rapprochement/conversion.js';
import { CATALOGUE_CONTROLES, CONTROLES_EN_FLUX, executerControles, executerControlesFlux } from './catalogue.js';
import { parGroupes, reduireAuxEcrituresDeBanque, sourceEnMemoire } from './flux.js';
import { ANOMALIES, EXERCICE, grandLivreAleatoire, jeuxFlux, PARAMETRAGES, releveFidele, renumeroter } from './jeux-flux-tests.js';
import type { JeuFlux } from './jeux-flux-tests.js';
import { CollecteurConstats, DepassementBudget, plafonner } from './outils.js';
import type { BudgetFlux, Constat, LigneEcriture, ResultatControle, SourceLignes } from './types.js';

const BUDGET: BudgetFlux = { lignes: 100_000, elements: 1_000_000 };
type OptionsSource = Parameters<typeof sourceEnMemoire>[1];

function enMemoire(jeu: JeuFlux, parametres: Record<string, Record<string, unknown>> = {}, ids?: string[]): ResultatControle[] {
  return executerControles({ lignes: jeu.lignes, exercice: jeu.exercice, exercicePrecedent: jeu.precedent ? { lignes: jeu.precedent } : null, releves: jeu.releves ?? null }, { parametres, ...(ids ? { ids } : {}) });
}
function enFlux(jeu: JeuFlux, parametres: Record<string, Record<string, unknown>> = {}, options: { source?: OptionsSource; budget?: BudgetFlux; ids?: string[] } = {}): Promise<ResultatControle[]> {
  return executerControlesFlux(
    {
      source: sourceEnMemoire(jeu.lignes, options.source),
      exercice: jeu.exercice,
      exercicePrecedent: jeu.precedent ? { source: sourceEnMemoire(jeu.precedent, options.source) } : null,
      releves: jeu.releves ?? null,
      budget: options.budget ?? BUDGET,
    },
    { parametres, ...(options.ids ? { ids: options.ids } : {}) },
  );
}

let jeux: JeuFlux[];
beforeAll(async () => {
  jeux = await jeuxFlux();
});

describe('contrôles en flux — périmètre', () => {
  it('les 19 contrôles du catalogue ont un calcul en flux', () => {
    expect(CATALOGUE_CONTROLES).toHaveLength(19);
    expect(CONTROLES_EN_FLUX).toEqual(CATALOGUE_CONTROLES.map((d) => d.id));
  });

  it('une source dont les numéros de ligne ne croissent pas strictement est refusée', () => {
    const lignes = grandLivreAleatoire({ graine: 1, nbEcritures: 3 });
    expect(() => sourceEnMemoire([...lignes].reverse())).toThrow(/strictement croissant/);
  });
});

describe('contrôles en flux — égalité stricte avec le calcul en mémoire', () => {
  // Trois lectures différentes de la même source : l'ordre des groupes n'est pas garanti par le contrat, et une source
  // peut rendre plus de lignes que la restriction demandée. Le résultat ne doit dépendre d'aucun des deux.
  const SOURCES: Array<{ nom: string; options: OptionsSource }> = [
    { nom: 'groupes croissants', options: { ordreGroupes: 'croissant' } },
    { nom: 'groupes décroissants', options: { ordreGroupes: 'decroissant' } },
    { nom: 'sans restriction de comptes', options: { ordreGroupes: 'decroissant', restreindre: false } },
  ];

  it('tous les jeux, tous les paramétrages, toutes les lectures', async () => {
    const statuts = new Map<string, Set<string>>();
    const natures = new Set<string>();
    let comparaisons = 0;
    for (const jeu of jeux) {
      for (const { nom, parametres } of PARAMETRAGES) {
        const reference = enMemoire(jeu, parametres);
        expect(reference).toHaveLength(19);
        for (const r of reference) {
          (statuts.get(r.controleId) ?? statuts.set(r.controleId, new Set()).get(r.controleId)!).add(r.statut);
          for (const c of r.constats) natures.add(c.cle.split('|').slice(0, 2).join('|'));
        }
        for (const source of SOURCES) {
          const flux = await enFlux(jeu, parametres, { source: source.options });
          for (const [i, r] of reference.entries()) {
            expect(flux[i], `${r.controleId} — ${jeu.nom} — ${nom} — ${source.nom}`).toStrictEqual(r);
            comparaisons++;
          }
        }
      }
    }
    expect(comparaisons).toBeGreaterThan(10_000);
    // Les jeux font réellement travailler chaque contrôle : chaque statut possible est atteint…
    expect(Object.fromEntries([...statuts].map(([k, v]) => [k, [...v].sort().join(',')]))).toEqual({
      'GEN-001': 'constat,sans_anomalie', 'GEN-002': 'constat,non_applicable,sans_anomalie', 'GEN-003': 'constat,non_realise,sans_anomalie', 'GEN-004': 'constat,sans_anomalie',
      'GEN-005': 'constat,non_applicable,sans_anomalie', 'TRE-001': 'constat,non_applicable,sans_anomalie', 'TRE-002': 'constat,non_applicable,sans_anomalie',
      'TIE-001': 'constat,non_applicable,sans_anomalie', 'TIE-002': 'constat,non_applicable,sans_anomalie', 'TIE-003': 'constat,non_applicable,non_realise,sans_anomalie',
      'CAP-001': 'constat,non_applicable,sans_anomalie', 'TVA-001': 'constat,non_realise,sans_anomalie', 'TRE-003': 'constat,non_applicable,non_realise,sans_anomalie',
      'IMM-001': 'constat,non_applicable,sans_anomalie', 'IMM-002': 'constat,non_applicable,sans_anomalie', 'SOC-001': 'constat,non_applicable,sans_anomalie',
      'CLO-001': 'constat,non_applicable,non_realise,sans_anomalie', 'CLO-002': 'constat,non_realise,sans_anomalie', 'TVA-002': 'constat,non_realise,sans_anomalie',
    });
    // … et chaque nature de constat que le catalogue sait produire apparaît au moins une fois.
    for (const nature of [
      'GEN-001|ecriture', 'GEN-001|journal', 'GEN-001|global', 'GEN-002|journal', 'GEN-002|globale', 'CAP-001|cloture', 'CAP-001|periode', 'IMM-001|sens', 'IMM-001|orphelin', 'IMM-001|excedent',
      'SOC-001|salaires_sans_charges', 'SOC-001|charges_sans_salaires', 'SOC-001|debiteur', 'CLO-002|hors_bilan', 'TVA-001|global', 'TVA-002|global',
    ]) {
      expect([...natures], nature).toContain(nature);
    }
    for (const id of ['GEN-003', 'GEN-004', 'GEN-005', 'TRE-001', 'TRE-002', 'TRE-003', 'TIE-001', 'TIE-002', 'TIE-003', 'IMM-002', 'CLO-001', 'CLO-002']) {
      expect([...natures].some((n) => n.startsWith(`${id}|`)), id).toBe(true);
    }
  });

  it('chaque anomalie connue du générateur est détectée de la même façon par les deux chemins', async () => {
    const avecAnomalie = jeux.filter((j) => j.nom === 'synthétique + toutes les anomalies' || ANOMALIES.some((a) => j.nom === `synthétique + ${a}`));
    expect(avecAnomalie.length).toBe(13);
    for (const jeu of avecAnomalie) {
      const reference = enMemoire(jeu);
      expect(reference.some((r) => r.statut === 'constat'), jeu.nom).toBe(true);
      expect(await enFlux(jeu), jeu.nom).toStrictEqual(reference);
    }
  });

  it('le plafonnement des constats donne les mêmes constats restitués et le même décompte', async () => {
    const jeu = jeux.find((j) => j.nom.startsWith('aléatoire 6 '))!;
    const parametres = { 'IMM-002': { seuil: '1.00', maxConstats: 3 }, 'CLO-001': { maxConstats: 1 }, 'GEN-002': { maxConstats: 1, minEcritures: 2, tauxLacunesMax: 1 } };
    const reference = enMemoire(jeu, parametres, ['IMM-002', 'CLO-001', 'GEN-002']);
    expect(reference.map((r) => [r.constats.length, Number(r.mesures['nbConstatsOmis'] ?? 0) > 0])).toEqual([[3, true], [1, true], [1, true]]);
    expect(reference[0]!.motif).toMatch(/constat\(s\) non détaillé\(s\) au-delà du plafond de 3/);
    expect(await enFlux(jeu, parametres, { ids: ['IMM-002', 'CLO-001', 'GEN-002'] })).toStrictEqual(reference);
  });

  it('paramètre invalide ou contrôle inconnu : même issue (`erreur`) sur les deux chemins', async () => {
    const jeu = jeux[0]!;
    const parametres = { 'GEN-001': { tolerance: 'beaucoup' } };
    const reference = enMemoire(jeu, parametres, ['GEN-001', 'XXX-999']);
    expect(reference.map((r) => r.statut)).toEqual(['erreur', 'erreur']);
    expect(await enFlux(jeu, parametres, { ids: ['GEN-001', 'XXX-999'] })).toStrictEqual(reference);
  });

  it('source vide : « non réalisé », comme en mémoire — jamais un résultat favorable', async () => {
    const vide: JeuFlux = { nom: 'vide', lignes: [], exercice: EXERCICE };
    const flux = await enFlux(vide);
    expect(flux).toStrictEqual(enMemoire(vide));
    expect(flux.every((r) => r.statut === 'non_realise')).toBe(true);
  });
});

describe('contrôles en flux — budget d’état : jamais de résultat partiel', () => {
  it('budget insuffisant : le contrôle concerné est « non réalisé » avec son motif, les autres restent identiques', async () => {
    const jeu = jeux.find((j) => j.nom === 'synthétique + toutes les anomalies')!;
    const reference = enMemoire(jeu);
    const flux = await enFlux(jeu, {}, { budget: { lignes: 3, elements: 5 } });
    const empeches = flux.filter((r, i) => JSON.stringify(r) !== JSON.stringify(reference[i]));
    // GEN-002 et GEN-004 gardent un élément par écriture ; les autres contrôles tiennent dans un état indépendant du volume.
    expect(empeches.map((r) => r.controleId).sort()).toEqual(['GEN-002', 'GEN-004']);
    for (const r of empeches) {
      expect(r.statut).toBe('non_realise');
      expect(r.constats).toEqual([]);
      expect(r.mesures).toEqual({});
      expect(r.motif).toContain(`Contrôle ${r.controleId} non réalisé sur ce volume`);
      expect(r.motif).toMatch(/Aucun résultat partiel n’est rendu ; ce n’est pas une absence d’anomalie\./);
    }
    expect(flux.find((r) => r.controleId === 'GEN-004')!.motif).toMatch(/écritures distinctes à comparer pour la recherche de doublons/);
    expect(reference.find((r) => r.controleId === 'GEN-004')!.statut).toBe('constat');
  });

  it('doublons : trop de lignes candidates ou une écriture trop longue dépassent le budget de lignes', async () => {
    const jeu = jeux.find((j) => j.nom === 'synthétique + doublon')!;
    expect(enMemoire(jeu, {}, ['GEN-004'])[0]!.statut).toBe('constat');
    const [r] = await enFlux(jeu, {}, { budget: { lignes: 3, elements: 1_000_000 }, ids: ['GEN-004'] });
    expect(r).toMatchObject({ statut: 'non_realise', constats: [] });
    expect(r!.motif).toMatch(/lignes d’écritures candidates au doublon|écriture de plus de 3 lignes/);
  });

  it('rapprochement bancaire : trop de lignes de banque pour le budget → « non réalisé », sans relevé rien n’est chargé', async () => {
    const jeu = jeux.find((j) => j.nom === 'synthétique + relevé avec suspens')!;
    expect(enMemoire(jeu, {}, ['TRE-003'])[0]!.statut).toBe('constat');
    const [r] = await enFlux(jeu, {}, { budget: { lignes: 10, elements: 1_000_000 }, ids: ['TRE-003'] });
    expect(r).toMatchObject({ statut: 'non_realise', constats: [] });
    expect(r!.motif).toMatch(/lignes à garder pour le rapprochement des comptes de banque/);
    const sansReleve = { ...jeu, releves: undefined };
    expect(await enFlux(sansReleve, {}, { budget: { lignes: 10, elements: 1_000_000 }, ids: ['TRE-003'] })).toStrictEqual(enMemoire(sansReleve, {}, ['TRE-003']));
  });

  it('IMM-002 : un journal contenant « | » n’est traité que par le calcul en mémoire, et le contrôle le dit', async () => {
    const lignes = renumeroter([...ecriture('X1', '2025-03-01', '60600000', '40100000', '900.00', { journal: 'A|B' }), ...ecriture('X2', '2025-03-02', '60600000', '40100000', '10.00')]);
    const jeu: JeuFlux = { nom: 'journal avec barre', lignes, exercice: EXERCICE };
    const reference = enMemoire(jeu);
    const flux = await enFlux(jeu);
    expect(reference.find((r) => r.controleId === 'IMM-002')!.statut).toBe('constat');
    const imm = flux.find((r) => r.controleId === 'IMM-002')!;
    expect(imm.statut).toBe('non_realise');
    expect(imm.motif).toMatch(/caractère « \| »/);
    expect(flux.filter((r) => r.controleId !== 'IMM-002')).toStrictEqual(reference.filter((r) => r.controleId !== 'IMM-002'));
  });

  it('une erreur de lecture de la source est propagée quand l’appelant la désigne, sinon elle donne le statut `erreur`', async () => {
    class Panne extends Error {}
    const source: SourceLignes = { nbLignes: 5, parcourir: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Panne('lecture interrompue')) }) }) };
    const ctx = { source, exercice: EXERCICE, budget: BUDGET };
    await expect(executerControlesFlux(ctx, { ids: ['GEN-001'], erreurDeLecture: (e) => e instanceof Panne })).rejects.toThrow('lecture interrompue');
    expect((await executerControlesFlux(ctx, { ids: ['GEN-001'] }))[0]).toMatchObject({ statut: 'erreur', constats: [] });
  });
});

describe('outils du flux', () => {
  it('réduction aux écritures de banque : mêmes éléments de rapprochement que sur l’exercice entier', async () => {
    for (const jeu of jeux) {
      for (const prefixes of [['512'], ['512', '53'], ['51200000']]) {
        const reduites = await reduireAuxEcrituresDeBanque(sourceEnMemoire(jeu.lignes, { ordreGroupes: 'decroissant' }), prefixes, 1_000_000);
        expect(elementsBanqueDepuisEcritures(reduites, { prefixesBanque: prefixes }), `${jeu.nom} ${prefixes.join(',')}`).toStrictEqual(elementsBanqueDepuisEcritures(jeu.lignes, { prefixesBanque: prefixes }));
        expect(reduites.length).toBeLessThanOrEqual(jeu.lignes.length);
        expect(reduites.map((l) => l.numeroLigne)).toEqual([...reduites.map((l) => l.numeroLigne)].sort((a, b) => a - b));
      }
    }
    const jeu = jeux.find((j) => j.nom === 'synthétique + relevé fidèle')!;
    await expect(reduireAuxEcrituresDeBanque(sourceEnMemoire(jeu.lignes), ['512'], 5)).rejects.toBeInstanceOf(DepassementBudget);
    expect(releveFidele(jeu.lignes, '51200000', EXERCICE).comptes[0]?.cadrage).toBe('ok');
  });

  it('collecteur de constats : mêmes constats retenus que le tri complet, quel que soit le nombre de constats', () => {
    const constat = (i: number): Constat => ({ gravite: 'faible', titre: `c${i}`, explication: '', actionProposee: '', montant: i % 7 === 0 ? null : `${(i * 37) % 23}.00`, lignesConcernees: [], preuves: [], cle: `K|${String((i * 7919) % 1000).padStart(4, '0')}` });
    for (const [n, max] of [[0, 3], [5, 3], [200, 3], [2000, 7], [2000, 200]] as const) {
      const tous = Array.from({ length: n }, (_, i) => constat(i));
      const collecteur = new CollecteurConstats({ maxConstats: max });
      for (const c of tous) collecteur.ajouter(c);
      const r = collecteur.conclure();
      expect(r.constats).toStrictEqual(plafonner(tous, max).retenus);
      expect(r.nbConstatsTotal).toBe(n);
      expect(r.statut).toBe(n > 0 ? 'constat' : 'sans_anomalie');
    }
  });

  it('parcours par groupes : un groupe à la fois, les lignes non retenues ne coupent pas un groupe', async () => {
    const lignes = renumeroter([...ecriture('A', '2025-01-01', '60600000', '40100000', '1.00'), ...ecriture('B', '2025-01-02', '60600000', '40100000', '2.00'), ...ecriture('A', '2025-01-03', '61300000', '40100000', '3.00')]);
    const groupes: string[][] = [];
    for await (const g of parGroupes<LigneEcriture[]>(sourceEnMemoire(lignes).parcourir({ ordre: 'ecriture' }), (l) => l.ecritureNum, () => [], (g, l) => g.push(l), (l) => l.compteNum !== '61300000')) groupes.push(g.map((l) => l.id));
    expect(groupes).toEqual([['L1', 'L2', 'L6'], ['L3', 'L4']]);
  });
});
