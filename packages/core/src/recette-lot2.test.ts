/** Recette du lot 2 : relevé cohérent avec le FEC synthétique, rapprochement de bout en bout, contrôles sur corpus. */
import { describe, expect, it } from 'vitest';
import { lireFec } from './aides-tests.js';
import { lireCamt053 } from './banque/camt053.js';
import { lireCsvBanque } from './banque/csv.js';
import { lireOfx } from './banque/ofx.js';
import type { RapportReleve } from './banque/types.js';
import { executerControles } from './controles/catalogue.js';
import type { LigneEcriture } from './controles/types.js';
import { elementDepuisMouvement, elementsBanqueDepuisEcritures } from './rapprochement/conversion.js';
import { rapprocher } from './rapprochement/rapprocher.js';
import { genererFecSynthetique } from './synthetique/fec.js';
import { genererReleveSynthetique } from './synthetique/releve.js';
import type { ReleveSynthetique } from './synthetique/releve.js';

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };

async function corpus(graine: number, nbEcritures = 600): Promise<LigneEcriture[]> {
  const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures, graine });
  return (await lireFec(fec.contenu)).lignes;
}

function lire(s: ReleveSynthetique, format: 'camt.053' | 'ofx' | 'csv'): RapportReleve {
  if (format === 'camt.053') return lireCamt053(s.contenu);
  if (format === 'ofx') return lireOfx(s.contenu, { soldeOuverture: s.attendu.soldeOuverture, dateOuverture: s.attendu.dateOuverture });
  return lireCsvBanque(s.contenu, s.attendu.profilCsv!);
}

describe('recette lot 2 — relevé cohérent avec le FEC et rapprochement de bout en bout', () => {
  for (const graine of [42, 2025]) {
    for (const format of ['camt.053', 'ofx'] as const) {
      it(`graine ${graine}, ${format} : exact, paiement groupé, paiement partiel, mouvement et écriture orphelins retrouvés comme attendu`, async () => {
        const lignes = await corpus(graine);
        const s = genererReleveSynthetique({ graine, format, debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 10_000, coherentAvec: lignes });
        const attendu = s.attendu.coherence!;
        expect(attendu.appariements.map((x) => x.nature)).toEqual(expect.arrayContaining(['exact', 'paiement_groupe', 'paiement_partiel']));
        expect(attendu.mouvementsAbsentsDeLaComptabilite).toHaveLength(1);
        expect(attendu.ecrituresAbsentesDuReleve).toEqual([expect.objectContaining({ motif: 'omise' })]);

        const releve = lire(s, format);
        expect(releve.lisible).toBe(true);
        expect(releve.comptes[0]).toMatchObject({ cadrage: 'ok', soldeOuverture: s.attendu.soldeOuverture, soldeCloture: s.attendu.soldeCloture, nbMouvements: s.attendu.nbMouvements });
        const cleParRang = new Map(releve.mouvements.map((m) => [m.rang, m.cleIdempotence]));

        // Toutes les écritures (hors à-nouveaux) sont fournies : le tiers d'une ligne 512 se lit sur sa contrepartie.
        const ecritures = lignes.filter((l) => l.journalCode !== 'AN' && l.ecritureDate <= EXERCICE.fin);
        const resultat = rapprocher(elementsBanqueDepuisEcritures(ecritures, { compteNum: attendu.compteNum }), releve.mouvements.map((m) => elementDepuisMouvement(m)));
        expect(resultat.ambiguites).toEqual([]);
        expect(resultat.abandons).toEqual([]);

        const REGLES = { exact: ['EXACT-REFERENCE', 'EXACT-MONTANT-DATE'], paiement_groupe: ['REGLE-PAIEMENT-GROUPE'], paiement_partiel: ['REGLE-PAIEMENTS-PARTIELS'] } as const;
        const obtenus = new Map(resultat.rapprochements.map((r) => [`${[...r.cotesA].sort().join(',')}|${[...r.cotesB].sort().join(',')}`, r]));
        expect(resultat.rapprochements).toHaveLength(attendu.appariements.length);
        for (const a of attendu.appariements) {
          const cle = `${a.numerosLignesFec.map((n) => `L${n}`).sort().join(',')}|${a.rangsMouvements.map((r) => cleParRang.get(r)!).sort().join(',')}`;
          const r = obtenus.get(cle);
          expect(r, `appariement ${a.nature} ${JSON.stringify(a)} introuvable`).toBeDefined();
          expect(REGLES[a.nature] as readonly string[], `${a.nature} : ${r!.regle}`).toContain(r!.regle);
          expect(r!.ecart).toBe('0.00');
        }
        expect(resultat.nonRapprochesA).toEqual(attendu.ecrituresAbsentesDuReleve.map((x) => `L${x.numeroLigne}`));
        expect(resultat.nonRapprochesB).toEqual(attendu.mouvementsAbsentsDeLaComptabilite.map((x) => cleParRang.get(x.rang)));

        // Contrôle TRE-003 sur le même jeu : l'écart attendu est retrouvé et décomposé.
        const tre = executerControles({ lignes, exercice: EXERCICE, releves: [releve] }, { ids: ['TRE-003'] })[0]!;
        expect(tre.statut).toBe('constat');
        expect(tre.constats).toHaveLength(1);
        expect(tre.constats[0]?.montant).toBe(attendu.ecart.replace('-', ''));
        expect(tre.mesures).toMatchObject({
          [`${attendu.compteNum}.soldeComptable`]: attendu.soldeComptable, [`${attendu.compteNum}.soldeReleve`]: s.attendu.soldeCloture, [`${attendu.compteNum}.ecart`]: attendu.ecart,
          [`${attendu.compteNum}.nbEcrituresNonRapprochees`]: '1', [`${attendu.compteNum}.nbMouvementsNonRapproches`]: '1', [`${attendu.compteNum}.nbAmbiguites`]: '0',
        });
        expect(tre.constats[0]?.lignesConcernees).toEqual(attendu.ecrituresAbsentesDuReleve.map((x) => `L${x.numeroLigne}`));
        expect(tre.constats[0]?.explication).toMatch(/non expliqué 0\.00/);
      });
    }
  }

  it('CSV cohérent : cadré ; sans référence de bout en bout, les appariements par référence ne sont pas devinés', async () => {
    const lignes = await corpus(42);
    const s = genererReleveSynthetique({ graine: 42, format: 'csv', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 10_000, coherentAvec: lignes });
    const releve = lire(s, 'csv');
    expect(releve.comptes[0]).toMatchObject({ cadrage: 'ok', nbMouvements: s.attendu.nbMouvements });
    const attendu = s.attendu.coherence!;
    const ecritures = lignes.filter((l) => l.journalCode !== 'AN');
    const resultat = rapprocher(elementsBanqueDepuisEcritures(ecritures, { compteNum: attendu.compteNum }), releve.mouvements.map((m) => elementDepuisMouvement(m)));
    const sansReference = attendu.appariements.filter((a) => !a.parReference || a.nature === 'exact').length;
    expect(resultat.rapprochements.length).toBeLessThanOrEqual(sansReference);
    expect(resultat.rapprochements.some((r) => r.regle === 'REGLE-PAIEMENTS-PARTIELS')).toBe(false);
    expect(resultat.rapprochements.some((r) => r.regle === 'REGLE-PAIEMENT-GROUPE')).toBe(true);
    // Chaque rapprochement établi reste arithmétiquement exact.
    for (const r of resultat.rapprochements) expect(r.ecart).toBe('0.00');
  });

  it('relevé limité à une partie de l’exercice et plafond nbMouvements : les écritures hors relevé sont déclarées', async () => {
    const lignes = await corpus(7, 300);
    const s = genererReleveSynthetique({ graine: 7, format: 'camt.053', debut: '2025-03-01', fin: '2025-03-31', nbMouvements: 5, coherentAvec: lignes });
    expect(s.attendu.coherence!.ecrituresAbsentesDuReleve.some((x) => x.motif === 'plafond_nbMouvements')).toBe(true);
    const releve = lireCamt053(s.contenu);
    expect(releve.comptes[0]).toMatchObject({ cadrage: 'ok', dateOuverture: '2025-03-01', dateCloture: '2025-03-31' });
    const tre = executerControles({ lignes, exercice: EXERCICE, releves: [releve] }, { ids: ['TRE-003'] })[0]!;
    expect(tre.statut).toBe('constat');
    expect(tre.mesures['51200000.dateArrete']).toBe('2025-03-31');
    expect(tre.mesures['51200000.ecart']).toBe(s.attendu.coherence!.ecart);
    expect(Object.fromEntries(tre.constats[0]!.preuves.map((p) => [p.libelle, p.valeur]))['Écart à l’ouverture']).toBe('0.00');
  });

  it('relevé réimporté deux fois dans le contexte : TRE-003 non réalisé plutôt qu’un résultat faussé', async () => {
    const lignes = await corpus(42);
    const s = genererReleveSynthetique({ graine: 42, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 10_000, coherentAvec: lignes });
    const releve = lireCamt053(s.contenu);
    const tre = executerControles({ lignes, exercice: EXERCICE, releves: [releve, releve] }, { ids: ['TRE-003'] })[0]!;
    expect(tre.statut).toBe('non_realise');
    expect(tre.constats).toEqual([]);
  });
});

describe('recette lot 2 — corpus propre et contrôles nouveaux', () => {
  it('corpus propre + relevé fidèle au compte 512 : les sept contrôles nouveaux ne produisent aucun constat', async () => {
    const lignes = await corpus(42);
    // Relevé strictement fidèle : chaque ligne 512 reprise à sa date avec sa référence de pièce.
    const banque = lignes.filter((l) => l.compteNum === '51200000');
    const ouverture = banque.filter((l) => l.journalCode === 'AN').reduce((s, l) => s + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100), 0);
    const mouvements = banque.filter((l) => l.journalCode !== 'AN');
    const centimes = (l: LigneEcriture): number => Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100);
    const euros = (c: number): string => `${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
    const cloture = ouverture + mouvements.reduce((s, l) => s + centimes(l), 0);
    const solde = (code: string, c: number, date: string): string => `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${euros(c)}</Amt><CdtDbtInd>${c < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
    const xml = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FR7630006000011234567890189</IBAN></Id><Ccy>EUR</Ccy></Acct>' +
      `${solde('OPBD', ouverture, EXERCICE.debut)}${solde('CLBD', cloture, EXERCICE.fin)}` +
      mouvements.map((l, i) => `<Ntry><Amt Ccy="EUR">${euros(centimes(l))}</Amt><CdtDbtInd>${centimes(l) < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${l.ecritureDate}</Dt></BookgDt><AcctSvcrRef>F${i}</AcctSvcrRef>` +
        `<NtryDtls><TxDtls><Refs><EndToEndId>${l.pieceRef}</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>`).join('') +
      '</Stmt></BkToCstmrStmt></Document>';
    const releve = lireCamt053(xml);
    expect(releve.comptes[0]?.cadrage).toBe('ok');
    const resultats = executerControles({ lignes, exercice: EXERCICE, releves: [releve] });
    expect(resultats).toHaveLength(19);
    for (const r of resultats) expect(r.constats, `${r.controleId} : ${JSON.stringify(r.constats[0] ?? null)}`).toEqual([]);
    expect(Object.fromEntries(resultats.filter((r) => ['TRE-003', 'IMM-001', 'IMM-002', 'SOC-001', 'CLO-001', 'CLO-002', 'TVA-002'].includes(r.controleId)).map((r) => [r.controleId, r.statut]))).toEqual({
      'TRE-003': 'sans_anomalie', 'IMM-001': 'non_applicable', 'IMM-002': 'sans_anomalie', 'SOC-001': 'sans_anomalie', 'CLO-001': 'sans_anomalie', 'CLO-002': 'non_realise', 'TVA-002': 'sans_anomalie',
    });
    expect(resultats.find((r) => r.controleId === 'TRE-003')?.mesures['51200000.nbRapprochements']).toBe(String(mouvements.length));
  });

  it('CLO-002 sur deux exercices synthétiques enchaînés : à-nouveaux reconstruits conformes, puis faussés', async () => {
    const n1 = await corpus(11, 300);
    // À-nouveaux N construits à partir des soldes de clôture N-1 (résultat viré en 120).
    const soldes = new Map<string, number>();
    let resultat = 0;
    for (const l of n1) {
      const c = Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100);
      if (/^[67]/.test(l.compteNum)) resultat += c;
      else soldes.set(l.compteNum, (soldes.get(l.compteNum) ?? 0) + c);
    }
    soldes.set('12000000', resultat);
    const euros = (c: number): string => `${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
    const modele = n1[0]!;
    const an: LigneEcriture[] = [...soldes.entries()].filter(([, c]) => c !== 0).map(([compte, c], i) => ({
      ...modele, id: `AN${i}`, numeroLigne: i + 2, journalCode: 'AN', ecritureNum: 'AN000001', ecritureDate: '2026-01-01', pieceDate: '2026-01-01', compteNum: compte, compAuxNum: null, compAuxLib: null,
      debit: c > 0 ? euros(c) : '0.00', credit: c < 0 ? euros(c) : '0.00', ecritureLet: null, dateLet: null,
    }));
    const exerciceN = { debut: '2026-01-01', fin: '2026-12-31' };
    const ok = executerControles({ lignes: an, exercice: exerciceN, exercicePrecedent: { lignes: n1 } }, { ids: ['CLO-002'] })[0]!;
    expect(ok).toMatchObject({ statut: 'sans_anomalie', constats: [] });
    const fausse = an.map((l) => (l.compteNum === '51200000' ? { ...l, debit: euros(Math.round(Number(l.debit) * 100) + 12_345) } : l));
    const ko = executerControles({ lignes: fausse, exercice: exerciceN, exercicePrecedent: { lignes: n1 } }, { ids: ['CLO-002'] })[0]!;
    expect(ko.constats.map((c) => [c.cle, c.montant])).toEqual([['CLO-002|51200000', '123.45']]);
  });

  it('les anomalies du lot 2 n’affectent pas les contrôles voisins du lot 2 (pas de faux positifs croisés)', async () => {
    const attendus: Record<string, string> = { amortissement_superieur_brut: 'IMM-001', charge_immobilisable: 'IMM-002', salaires_sans_charges: 'SOC-001', piece_hors_exercice: 'CLO-001' };
    for (const [type, controle] of Object.entries(attendus)) {
      const fec = genererFecSynthetique({ exercice: EXERCICE, nbEcritures: 400, graine: 5, anomalies: [type as never] });
      const { lignes } = await lireFec(fec.contenu);
      const resultats = executerControles({ lignes, exercice: EXERCICE }, { ids: ['IMM-001', 'IMM-002', 'SOC-001', 'CLO-001', 'TVA-002'] });
      expect(resultats.filter((r) => r.statut === 'constat').map((r) => r.controleId), type).toEqual([controle]);
    }
  });
});
