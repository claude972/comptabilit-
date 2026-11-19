/**
 * Jeux d'essai de l'équivalence entre le calcul en mémoire et le calcul en flux des contrôles (exclus du build).
 * Deux familles : les FEC du générateur synthétique (propres, puis avec chaque anomalie connue), et des grands-livres
 * tirés au hasard (graine fixe) qui cherchent les cas limites : écritures déséquilibrées, doublons, numéros manquants,
 * dates hors exercice, lignes d'une même écriture dispersées dans le fichier, lettrage partiel, montants à plus de
 * deux décimales, à-nouveaux, exercice précédent, relevés bancaires.
 */
import { ecriture, lireFec } from '../aides-tests.js';
import { lireCamt053 } from '../banque/camt053.js';
import type { RapportReleve } from '../banque/types.js';
import { creerAlea } from '../synthetique/alea.js';
import { genererFecSynthetique } from '../synthetique/fec.js';
import type { AnomalieSynthetique } from '../synthetique/fec.js';
import { genererReleveSynthetique } from '../synthetique/releve.js';
import type { LigneEcriture } from './types.js';

export interface JeuFlux {
  nom: string;
  lignes: LigneEcriture[];
  exercice: { debut: string; fin: string } | null;
  precedent?: LigneEcriture[];
  releves?: RapportReleve[];
}

export const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };

export const ANOMALIES: AnomalieSynthetique[] = [
  'desequilibre', 'rupture_sequence', 'hors_exercice', 'doublon', 'caisse_crediteur', 'attente_non_solde', 'client_crediteur', 'cca_debiteur',
  'amortissement_superieur_brut', 'charge_immobilisable', 'salaires_sans_charges', 'piece_hors_exercice',
];

/** Renumérote : le contrat d'une source exige un `numeroLigne` strictement croissant dans l'ordre du fichier. */
export function renumeroter(lignes: readonly LigneEcriture[], prefixe = 'L'): LigneEcriture[] {
  return lignes.map((l, i) => ({ ...l, numeroLigne: i + 1, id: `${prefixe}${i + 1}` }));
}

async function synthetique(graine: number, nbEcritures: number, anomalies: AnomalieSynthetique[] = [], exercice = EXERCICE): Promise<LigneEcriture[]> {
  const fec = genererFecSynthetique({ exercice, nbEcritures, graine, anomalies });
  const { lignes } = await lireFec(fec.contenu, { nomFichier: fec.nomFichier, siren: '123456782', exerciceDebut: exercice.debut, exerciceFin: exercice.fin });
  return lignes;
}

const COMPTES: Array<[string, string, number]> = [
  // [compte, libellé, poids]
  ['10100000', 'Capital', 1], ['12000000', 'Résultat de l’exercice', 1], ['21830000', 'Matériel de bureau', 2], ['21540000', 'Matériel industriel', 1],
  ['28183000', 'Amortissements du matériel de bureau', 2], ['28154000', 'Amortissements du matériel industriel', 1], ['28120000', 'Amortissements des agencements', 1],
  ['40100000', 'Fournisseurs', 8], ['41100000', 'Clients', 8], ['42100000', 'Personnel - Rémunérations dues', 2], ['43100000', 'Sécurité sociale', 2],
  ['44571000', 'TVA collectée', 4], ['44566000', 'TVA déductible', 4], ['44551000', 'TVA à décaisser', 1], ['45500000', 'Associés - Comptes courants', 3],
  ['47100000', 'Compte d’attente', 1], ['47800000', 'Autres comptes transitoires', 1], ['47810000', 'Mali de fusion', 1],
  ['51200000', 'Banque', 8], ['51210000', 'Banque 2', 1], ['53000000', 'Caisse', 3], ['53100000', 'Caisse annexe', 1],
  ['60600000', 'Achats non stockés', 5], ['61300000', 'Locations', 2], ['62200000', 'Honoraires', 2], ['64100000', 'Rémunérations du personnel', 2],
  ['64500000', 'Charges de sécurité sociale', 2], ['70600000', 'Prestations de services', 5], ['70700000', 'Ventes de marchandises', 3],
];
const AUXILIAIRES: Record<string, string[]> = { '40100000': ['F001', 'F002', 'F003', 'F004'], '41100000': ['C001', 'C002', 'C003', 'C004', 'C005'], '45500000': ['A01', 'A02'] };
const JOURNAUX = ['VT', 'AC', 'BQ', 'CA', 'OD'];

interface OptionsAleatoire {
  graine: number;
  nbEcritures: number;
  annee?: number;
  /** Mélange les lignes : les écritures ne sont plus contiguës dans le fichier. */
  disperser?: boolean;
  sansLettrage?: boolean;
  sansAuxiliaire?: boolean;
  /** Une seule banque (TRE-003 peut alors associer le relevé sans paramètre). */
  uneBanque?: boolean;
  numerotationGlobale?: boolean;
  aNouveaux?: boolean;
  decimales?: boolean;
}

/** Grand-livre tiré au hasard, déterministe pour une graine. Aucune vraisemblance comptable n'est recherchée. */
export function grandLivreAleatoire(o: OptionsAleatoire): LigneEcriture[] {
  const alea = creerAlea(o.graine);
  const annee = o.annee ?? 2025;
  const comptes = COMPTES.filter(([c]) => !(o.uneBanque && c === '51210000'));
  const poids = comptes.map(([, , p]) => p);
  const chance = (pourCent: number): boolean => alea.entier(1, 100) <= pourCent;
  const date = (): string => {
    if (chance(3)) return `${annee - 1}-12-${String(alea.entier(20, 31)).padStart(2, '0')}`;
    if (chance(3)) return `${annee + 1}-01-${String(alea.entier(1, 20)).padStart(2, '0')}`;
    return `${annee}-${String(alea.entier(1, 12)).padStart(2, '0')}-${String(alea.entier(1, 28)).padStart(2, '0')}`;
  };
  const montant = (): string => {
    const centimes = chance(10) ? alea.entier(50_000, 900_000) : alea.entier(100, 60_000);
    const base = `${Math.floor(centimes / 100)}.${String(centimes % 100).padStart(2, '0')}`;
    return o.decimales && chance(15) ? `${base}5` : base;
  };
  const lignes: LigneEcriture[] = [];
  const ligne = (journal: string, num: string, d: string, piece: string, pieceDate: string | null, compte: [string, string, number], debit: string, credit: string): LigneEcriture => {
    const aux = !o.sansAuxiliaire && AUXILIAIRES[compte[0]] !== undefined && chance(85) ? (AUXILIAIRES[compte[0]] as string[])[alea.entier(0, (AUXILIAIRES[compte[0]] as string[]).length - 1)] ?? null : null;
    const lettrable = ['401', '411', '421', '431'].some((p) => compte[0].startsWith(p));
    return {
      id: '', numeroLigne: 0, journalCode: journal, journalLib: `Journal ${journal}`, ecritureNum: num, ecritureDate: d, compteNum: compte[0], compteLib: compte[1],
      compAuxNum: aux, compAuxLib: aux === null ? null : `Tiers ${aux}`, pieceRef: piece, pieceDate, ecritureLib: `Écriture ${num}`, debit, credit,
      ecritureLet: !o.sansLettrage && lettrable && chance(50) ? 'AA' : null, dateLet: null, validDate: d, montantDevise: null, idevise: null,
    };
  };
  if (o.aNouveaux) {
    const d = `${annee}-01-01`;
    for (const c of comptes) {
      if (!chance(60)) continue;
      const m = montant();
      const horsBilan = /^[67]/.test(c[0]);
      if (horsBilan && !chance(15)) continue;
      lignes.push(ligne('AN', 'AN000001', d, 'AN', d, c, chance(50) ? m : '0.00', '0.00'));
      if (lignes[lignes.length - 1]!.debit === '0.00') lignes[lignes.length - 1]!.credit = m;
    }
  }
  const compteurs = new Map<string, number>();
  let global = 0;
  let precedente: LigneEcriture[] = [];
  for (let e = 0; e < o.nbEcritures; e++) {
    const journal = JOURNAUX[alea.entier(0, JOURNAUX.length - 1)] as string;
    let n: number;
    if (o.numerotationGlobale) {
      global += chance(6) ? alea.entier(2, 4) : 1;
      n = global;
    } else {
      n = (compteurs.get(journal) ?? 0) + (chance(6) ? alea.entier(2, 4) : 1);
      compteurs.set(journal, n);
    }
    let num = o.numerotationGlobale ? String(n).padStart(chance(10) ? 3 : 6, '0') : `${journal}${String(n).padStart(6, '0')}`;
    if (chance(2)) num = `OUV-${journal}`;
    // Doublon : même journal, même date, mêmes lignes, autre numéro.
    if (precedente.length > 0 && chance(4)) {
      const source = precedente;
      precedente = source.map((l) => ({ ...l, journalCode: source[0]!.journalCode, ecritureNum: `${num}D` }));
      lignes.push(...precedente);
      continue;
    }
    const d = date();
    const piece = chance(12) ? '' : `P${alea.entier(1, 400)}`;
    const pieceDate = chance(10) ? null : chance(6) ? `${annee + (chance(50) ? 1 : -1)}-${String(alea.entier(1, 12)).padStart(2, '0')}-15` : d;
    const nbDebits = alea.entier(1, 3);
    const courante: LigneEcriture[] = [];
    let total = 0;
    const centimes = (m: string): number => Math.round(Number(m) * 1000);
    for (let i = 0; i < nbDebits; i++) {
      const m = chance(4) ? '0.00' : montant();
      total += centimes(m);
      // Parfois le même compte et le même montant deux fois dans l'écriture (rang des lignes répétées).
      const compte = i > 0 && chance(20) ? COMPTES.find(([c]) => c === courante[0]!.compteNum)! : (comptes[alea.pondere(poids)] as [string, string, number]);
      courante.push(ligne(journal, num, d, piece, pieceDate, compte, i > 0 && compte[0] === courante[0]!.compteNum && chance(60) ? courante[0]!.debit : m, '0.00'));
      if (courante[courante.length - 1]!.debit !== m) total += centimes(courante[courante.length - 1]!.debit) - centimes(m);
    }
    // Contrepartie : équilibrée, sauf exception voulue.
    const desequilibre = chance(3) ? 1000 : 0;
    const reste = total + desequilibre;
    const enDeux = chance(30) && reste > 2000;
    const part = enDeux ? Math.floor(reste / 3) : reste;
    const chaine = (milliemes: number): string => {
      const s = `${Math.floor(milliemes / 1000)}.${String(milliemes % 1000).padStart(3, '0')}`;
      return s.endsWith('0') ? s.slice(0, -1) : s;
    };
    courante.push(ligne(journal, num, chance(2) ? date() : d, piece, pieceDate, comptes[alea.pondere(poids)] as [string, string, number], '0.00', chaine(part)));
    if (enDeux) courante.push(ligne(journal, num, d, piece, pieceDate, comptes[alea.pondere(poids)] as [string, string, number], '0.00', chaine(reste - part)));
    lignes.push(...courante);
    precedente = courante;
  }
  if (o.disperser) {
    for (let i = 0; i < lignes.length; i++) {
      const j = alea.entier(0, lignes.length - 1);
      const t = lignes[i] as LigneEcriture;
      lignes[i] = lignes[j] as LigneEcriture;
      lignes[j] = t;
    }
  }
  return renumeroter(lignes);
}

/** Relevé camt.053 strictement fidèle aux lignes d'un compte de banque (à-nouveaux = solde d'ouverture), moins `omises` mouvements. */
export function releveFidele(lignes: readonly LigneEcriture[], compteNum: string, exercice: { debut: string; fin: string }, omises = 0): RapportReleve {
  const banque = lignes.filter((l) => l.compteNum === compteNum && l.ecritureDate >= exercice.debut && l.ecritureDate <= exercice.fin);
  const centimes = (l: LigneEcriture): number => Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100);
  const euros = (c: number): string => `${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
  const ouverture = banque.filter((l) => l.journalCode === 'AN').reduce((s, l) => s + centimes(l), 0);
  const mouvements = banque.filter((l) => l.journalCode !== 'AN' && centimes(l) !== 0).slice(omises);
  const cloture = ouverture + mouvements.reduce((s, l) => s + centimes(l), 0);
  const solde = (code: string, c: number, date: string): string =>
    `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${euros(c)}</Amt><CdtDbtInd>${c < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
  return lireCamt053(
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>FR7630006000011234567890189</IBAN></Id><Ccy>EUR</Ccy></Acct>' +
      `${solde('OPBD', ouverture, exercice.debut)}${solde('CLBD', cloture, exercice.fin)}` +
      mouvements
        .map(
          (l, i) =>
            `<Ntry><Amt Ccy="EUR">${euros(centimes(l))}</Amt><CdtDbtInd>${centimes(l) < 0 ? 'DBIT' : 'CRDT'}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${l.ecritureDate}</Dt></BookgDt><AcctSvcrRef>F${i}</AcctSvcrRef>` +
            `${l.pieceRef ? `<NtryDtls><TxDtls><Refs><EndToEndId>${l.pieceRef}</EndToEndId></Refs></TxDtls></NtryDtls>` : ''}</Ntry>`,
        )
        .join('') +
      '</Stmt></BkToCstmrStmt></Document>',
  );
}

/** Tous les jeux de l'équivalence. */
export async function jeuxFlux(): Promise<JeuFlux[]> {
  const jeux: JeuFlux[] = [];
  // 1. Générateur synthétique : propre, chaque anomalie connue, toutes ensemble.
  for (const graine of [1, 42]) jeux.push({ nom: `synthétique propre (graine ${graine})`, lignes: await synthetique(graine, 400), exercice: EXERCICE });
  for (const [i, anomalie] of ANOMALIES.entries()) jeux.push({ nom: `synthétique + ${anomalie}`, lignes: await synthetique(100 + i, 300, [anomalie]), exercice: EXERCICE });
  const toutes = await synthetique(7, 600, ANOMALIES);
  jeux.push({ nom: 'synthétique + toutes les anomalies', lignes: toutes, exercice: EXERCICE });
  // 2. Exercice précédent et relevés sur le corpus synthétique.
  const n1 = await synthetique(11, 300, [], { debut: '2024-01-01', fin: '2024-12-31' });
  const propre = await synthetique(42, 400);
  jeux.push({ nom: 'synthétique + exercice précédent', lignes: propre, exercice: EXERCICE, precedent: renumeroter(n1, 'P') });
  const coherent = genererReleveSynthetique({ graine: 42, format: 'camt.053', debut: EXERCICE.debut, fin: EXERCICE.fin, nbMouvements: 10_000, coherentAvec: propre });
  jeux.push({ nom: 'synthétique + relevé avec suspens', lignes: propre, exercice: EXERCICE, releves: [lireCamt053(coherent.contenu as string)] });
  jeux.push({ nom: 'synthétique + relevé fidèle', lignes: propre, exercice: EXERCICE, releves: [releveFidele(propre, '51200000', EXERCICE)] });
  jeux.push({ nom: 'synthétique + relevé en double (non réalisé)', lignes: propre, exercice: EXERCICE, releves: [releveFidele(propre, '51200000', EXERCICE), releveFidele(propre, '51200000', EXERCICE)] });
  jeux.push({ nom: 'synthétique + relevé illisible', lignes: propre, exercice: EXERCICE, releves: [lireCamt053('<!DOCTYPE x><Document/>')] });
  // 3. Grands-livres tirés au hasard.
  for (let graine = 1; graine <= 24; graine++) {
    const o: OptionsAleatoire = {
      graine,
      nbEcritures: graine % 6 === 0 ? 900 : 150 + graine * 10,
      disperser: graine % 2 === 0,
      sansLettrage: graine % 7 === 0,
      sansAuxiliaire: graine % 5 === 0,
      uneBanque: graine % 3 !== 0,
      numerotationGlobale: graine % 4 === 0,
      aNouveaux: graine % 3 !== 1,
      decimales: graine % 8 === 3,
    };
    const lignes = grandLivreAleatoire(o);
    const jeu: JeuFlux = { nom: `aléatoire ${graine} ${JSON.stringify({ ...o, graine: undefined })}`, lignes, exercice: EXERCICE };
    if (graine % 2 === 1) jeu.precedent = renumeroter(grandLivreAleatoire({ ...o, graine: graine + 1000, annee: 2024, nbEcritures: 120 }), 'P');
    if (o.uneBanque && graine % 4 !== 3) jeu.releves = [releveFidele(lignes, '51200000', EXERCICE, graine % 5)];
    if (!o.uneBanque) jeu.releves = [releveFidele(lignes, '51200000', EXERCICE)];
    jeux.push(jeu);
  }
  // 4. Cas limites.
  jeux.push({ nom: 'une seule ligne', lignes: renumeroter(grandLivreAleatoire({ graine: 3, nbEcritures: 1 }).slice(0, 1)), exercice: EXERCICE });
  jeux.push({ nom: 'une seule écriture', lignes: grandLivreAleatoire({ graine: 5, nbEcritures: 1 }), exercice: EXERCICE });
  jeux.push({ nom: 'exercice inconnu', lignes: grandLivreAleatoire({ graine: 31, nbEcritures: 200, aNouveaux: true }), exercice: null });
  jeux.push({ nom: 'tout hors exercice', lignes: grandLivreAleatoire({ graine: 32, nbEcritures: 150, annee: 2023 }), exercice: EXERCICE });
  jeux.push({ nom: 'exercice précédent vide', lignes: grandLivreAleatoire({ graine: 33, nbEcritures: 100, aNouveaux: true }), exercice: EXERCICE, precedent: [] });
  const sansNumero = grandLivreAleatoire({ graine: 34, nbEcritures: 120 }).map((l, i) => (i % 3 === 0 ? { ...l, ecritureNum: '' } : l));
  jeux.push({ nom: 'numéros d’écriture vides', lignes: sansNumero, exercice: EXERCICE });
  // 5. Situations régulières construites à la main (statuts favorables ou « sans objet » de chaque contrôle).
  const cloture2024 = renumeroter([...ecriture('OD1', '2024-03-01', '51200000', '10100000', '1000.00'), ...ecriture('OD2', '2024-06-01', '21830000', '51200000', '400.00')], 'P');
  const ouverture2025 = [
    ...ecriture('AN1', '2025-01-01', '51200000', '10100000', '600.00', { journal: 'AN' }),
    ...ecriture('AN1', '2025-01-01', '21830000', '10100000', '400.00', { journal: 'AN' }),
    ...ecriture('OD1', '2025-02-01', '47100000', '51200000', '50.00'),
    ...ecriture('OD2', '2025-02-10', '51200000', '47100000', '50.00'),
  ];
  jeux.push({ nom: 'bilan seul, à-nouveaux fidèles, attente soldée', lignes: renumeroter(ouverture2025), exercice: EXERCICE, precedent: cloture2024 });
  const sansBanque = renumeroter([...ecriture('OD1', '2025-02-01', '60600000', '40100000', '80.00'), ...ecriture('OD2', '2025-02-02', '41100000', '70600000', '120.00')]);
  jeux.push({ nom: 'relevé sans compte de banque en comptabilité', lignes: sansBanque, exercice: EXERCICE, releves: [releveFidele(propre, '51200000', EXERCICE)] });
  // 6. Cas où l'ordre du fichier décide du résultat.
  // Numéros de même valeur (« 002 » et « 2 », « 007 » et « 7 ») : la rupture cite celui qui apparaît en dernier dans le fichier.
  const memesNumeros = renumeroter([
    ...ecriture('001', '2025-01-05', '60600000', '40100000', '10.00', { journal: 'VT' }),
    ...ecriture('002', '2025-01-06', '60600000', '40100000', '11.00', { journal: 'VT' }),
    ...ecriture('2', '2025-01-07', '60600000', '40100000', '12.00', { journal: 'AC' }),
    ...ecriture('004', '2025-01-08', '60600000', '40100000', '13.00', { journal: 'VT' }),
    ...ecriture('4', '2025-01-08', '60600000', '40100000', '13.50', { journal: 'AC' }),
    ...ecriture('007', '2025-01-09', '60600000', '40100000', '14.00', { journal: 'VT' }),
    ...ecriture('7', '2025-01-10', '60600000', '40100000', '15.00', { journal: 'VT' }),
    ...ecriture('9', '2025-01-11', '60600000', '40100000', '16.00', { journal: 'VT' }),
    ...ecriture('09', '2025-01-12', '60600000', '40100000', '17.00', { journal: 'VT' }),
    ...ecriture('12', '2025-01-13', '60600000', '40100000', '18.00', { journal: 'AC' }),
  ]);
  jeux.push({ nom: 'numéros de même valeur dans plusieurs journaux', lignes: memesNumeros, exercice: EXERCICE });
  // Écriture de liquidation de TVA dont la ligne de liquidation est datée après la clôture : elle n'est pas retenue, donc
  // l'écriture n'est pas une liquidation et sa TVA compte.
  const liquidationTardive = renumeroter([
    ...ecriture('VT1', '2025-03-01', '41100000', '70600000', '1000.00', { journal: 'VT' }),
    ...ecriture('VT1', '2025-03-01', '41100000', '44571000', '200.00', { journal: 'VT' }),
    ...ecriture('AC1', '2025-03-02', '60600000', '40100000', '500.00', { journal: 'AC' }),
    ...ecriture('AC1', '2025-03-02', '44566000', '40100000', '100.00', { journal: 'AC' }),
    ...ecriture('OD1', '2025-12-31', '44571000', '44566000', '100.00'),
    ...ecriture('OD1', '2026-01-15', '44571000', '44551000', '100.00'),
    ...ecriture('OD2', '2025-06-30', '44571000', '44551000', '50.00'),
    ...ecriture('OD2', '2025-06-30', '44551000', '44566000', '20.00'),
  ]);
  jeux.push({ nom: 'liquidation de TVA datée après la clôture', lignes: liquidationTardive, exercice: EXERCICE });
  // Lignes de banque portant elles-mêmes un compte auxiliaire, contreparties à un, deux ou aucun tiers.
  const banqueAvecTiers = renumeroter([
    ...ecriture('AN1', '2025-01-01', '51200000', '10100000', '5000.00', { journal: 'AN' }),
    ...ecriture('BQ1', '2025-01-10', '51200000', '41100000', '300.00', { journal: 'BQ', piece: 'RC-1', auxDebit: 'BANQ1', auxCredit: 'C001' }),
    ...ecriture('BQ2', '2025-01-12', '40100000', '51200000', '120.00', { journal: 'BQ', piece: 'RF-1', auxDebit: 'F001' }),
    ...ecriture('BQ3', '2025-01-15', '51200000', '41100000', '80.00', { journal: 'BQ', piece: 'RC-2', auxCredit: 'C001' }),
    ...ecriture('BQ3', '2025-01-15', '51200000', '41100000', '90.00', { journal: 'BQ', piece: 'RC-2', auxCredit: 'C002' }),
    ...ecriture('BQ4', '2025-01-20', '62200000', '51200000', '45.00', { journal: 'BQ', piece: 'FR-1' }),
  ]);
  jeux.push({ nom: 'banque avec comptes auxiliaires', lignes: banqueAvecTiers, exercice: EXERCICE, releves: [releveFidele(banqueAvecTiers, '51200000', { debut: '2025-01-01', fin: '2025-01-31' }, 1)] });
  return jeux;
}

/** Jeux de paramètres appliqués à chaque jeu de lignes (défauts, plafond bas, variantes de chaque contrôle). */
export const PARAMETRAGES: Array<{ nom: string; parametres: Record<string, Record<string, unknown>> }> = [
  { nom: 'défauts', parametres: {} },
  {
    nom: 'plafond de 2 constats',
    parametres: Object.fromEntries(
      ['GEN-001', 'GEN-002', 'GEN-003', 'GEN-004', 'GEN-005', 'TRE-001', 'TRE-002', 'TIE-001', 'TIE-002', 'TIE-003', 'CAP-001', 'TVA-001', 'TRE-003', 'IMM-001', 'IMM-002', 'SOC-001', 'CLO-001', 'CLO-002', 'TVA-002'].map((id) => [id, { maxConstats: 2 }]),
    ),
  },
  {
    nom: 'variantes',
    parametres: {
      'GEN-001': { tolerance: '1.00' },
      'GEN-002': { portee: 'globale', minEcritures: 2, tauxLacunesMax: 0.9, maxConstats: 5 },
      'GEN-004': { inclureSansPiece: false, montantMinimum: '50.00' },
      'GEN-005': { seuil: '100.00', prefixesExclus: [] },
      'TRE-001': { seuil: '500.00' },
      'TRE-002': { prefixesComptes: ['512', '53'] },
      'TIE-001': { seuil: '1000.00', maxConstats: 1 },
      'TIE-002': { prefixesComptes: ['401', '455'] },
      'TIE-003': { seuilJours: 30, seuilMontant: '10.00' },
      'CAP-001': { controleInfraAnnuel: false },
      'TVA-001': { ventesSansTvaAdmises: false, prefixesLiquidation: [] },
      'TVA-002': { tauxPlancher: '5', journauxANouveaux: ['VT'] },
      'IMM-001': { tolerance: '500.00' },
      'IMM-002': { seuil: '100.00', maxConstats: 3 },
      'SOC-001': { seuil: '2000.00' },
      'CLO-001': { toleranceJours: 20, seuil: '200.00' },
      'CLO-002': { journauxANouveaux: ['AN', 'OD'], tolerance: '100.00' },
      'TRE-003': { correspondances: [{ compteNum: '51200000', compteBancaire: 'FR7630006000011234567890189' }] },
    },
  },
  { nom: 'GEN-002 par journal', parametres: { 'GEN-002': { portee: 'journal', minEcritures: 2, tauxLacunesMax: 1 }, 'TIE-003': { seuilJours: 0 }, 'CLO-001': { prefixesComptes: ['6'] }, 'TVA-001': { prefixesLiquidation: ['4457'] } } },
];
