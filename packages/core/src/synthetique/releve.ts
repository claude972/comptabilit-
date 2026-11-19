/**
 * Générateur de relevés bancaires SYNTHÉTIQUES (camt.053.001.02, OFX 1.x SGML, CSV) pour la recette.
 * Déterministe pour une graine donnée. Avec `coherentAvec`, le relevé reprend les lignes du compte 512
 * d'un FEC (décalages de dates plausibles) et y introduit un paiement groupé, un paiement en deux fois,
 * un mouvement bancaire absent de la comptabilité et une écriture absente du relevé ; les résultats
 * attendus du rapprochement sont décrits dans `attendu.coherence`.
 */
import { Decimal } from 'decimal.js';
import type { ProfilCsvBanque } from '../banque/csv.js';
import { compactDepuisIso, ecartEnJours, estDateIso, isoDepuisJours, joursDepuisEpoque } from '../dates.js';
import type { LigneFec } from '../fec/types.js';
import { validerIban } from '../identifiants.js';
import { dec } from '../montant.js';
import type { ChaineDecimale } from '../montant.js';
import { creerAlea } from './alea.js';

export interface OptionsReleveSynthetique {
  graine: number;
  format: 'camt.053' | 'ofx' | 'csv';
  debut: string;
  fin: string;
  /** Nombre de mouvements ; avec `coherentAvec`, plafond du nombre de lignes 512 reprises (ordre chronologique). */
  nbMouvements: number;
  iban?: string;
  coherentAvec?: readonly LigneFec[];
}

export interface MouvementAttendu {
  rang: number;
  dateOperation: string;
  montant: ChaineDecimale;
  libelle: string;
  referenceBanque: string;
  /** Référence de bout en bout portée par le fichier (camt.053 et OFX ; jamais en CSV). */
  referenceBoutEnBout: string | null;
}

export interface AttenduReleveSynthetique {
  iban: string;
  /** Identifiant du compte tel que le lecteur le restitue (OFX : banque-guichet-compte-clé ; sinon null, l'IBAN faisant foi). */
  identifiantCompte: string | null;
  soldeOuverture: ChaineDecimale;
  dateOuverture: string;
  soldeCloture: ChaineDecimale;
  dateCloture: string;
  nbMouvements: number;
  totalMouvements: ChaineDecimale;
  mouvements: MouvementAttendu[];
  /** Profil à passer à `lireCsvBanque` (format csv uniquement). */
  profilCsv: ProfilCsvBanque | null;
  /** Résultats attendus du rapprochement avec le FEC (null sans `coherentAvec`). */
  coherence: null | {
    compteNum: string;
    /** Solde du compte 512 à la date `fin` (débit − crédit). */
    soldeComptable: ChaineDecimale;
    /** Solde comptable − solde de clôture du relevé. */
    ecart: ChaineDecimale;
    /** `parReference` : l'appariement n'est retrouvable que si le format porte la référence de bout en bout (pas le CSV). */
    appariements: Array<{ nature: 'exact' | 'paiement_groupe' | 'paiement_partiel'; numerosLignesFec: number[]; rangsMouvements: number[]; parReference: boolean }>;
    mouvementsAbsentsDeLaComptabilite: Array<{ rang: number; montant: ChaineDecimale }>;
    ecrituresAbsentesDuReleve: Array<{ numeroLigne: number; montant: ChaineDecimale; motif: 'omise' | 'plafond_nbMouvements' }>;
  };
}

export interface ReleveSynthetique { contenu: string; nomFichier: string; attendu: AttenduReleveSynthetique }

/** IBAN fictif par défaut (clé valide ; exemple de documentation, toute ressemblance avec un compte réel serait fortuite). */
export const IBAN_SYNTHETIQUE = 'FR7630006000011234567890189';

const JOURNAUX_A_NOUVEAUX = new Set(['AN', 'ANO', 'RAN']);
const ZERO = new Decimal(0);
const m2 = (d: Decimal): string => d.toFixed(2);

interface Brouillon { date: string; montant: Decimal; libelle: string; boutEnBout: string | null; ordre: number; lignes: number[]; nature: 'exact' | 'paiement_groupe' | 'paiement_partiel' | 'absent_comptabilite' | 'libre'; groupe: number }

const xml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const dateFr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const montantFr = (d: Decimal): string => d.toFixed(2).replace('.', ',');
const csv = (s: string): string => (/[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function genererReleveSynthetique(options: OptionsReleveSynthetique): ReleveSynthetique {
  const { graine, format, debut, fin, nbMouvements } = options;
  if (!estDateIso(debut) || !estDateIso(fin) || fin < debut) throw new Error('Période invalide.');
  if (!Number.isInteger(nbMouvements) || nbMouvements < 1 || nbMouvements > 100_000) throw new Error('nbMouvements invalide : entier de 1 à 100 000 attendu.');
  if (format !== 'camt.053' && format !== 'ofx' && format !== 'csv') throw new Error('Format invalide.');
  const iban = (options.iban ?? IBAN_SYNTHETIQUE).replace(/\s/g, '').toUpperCase();
  if (!validerIban(iban).valide) throw new Error('IBAN invalide.');
  const alea = creerAlea(graine);
  const jourDebut = joursDepuisEpoque(debut);
  const nbJours = ecartEnJours(debut, fin);
  const plusJours = (iso: string, n: number): string => {
    const d = isoDepuisJours(joursDepuisEpoque(iso) + n);
    return d > fin ? fin : d;
  };

  const brouillons: Brouillon[] = [];
  let ordre = 0;
  const ajouter = (b: Omit<Brouillon, 'ordre'>): void => {
    brouillons.push({ ...b, ordre: ordre++ });
  };
  let soldeOuverture: Decimal;
  let coherence: { compteNum: string; soldeComptable: Decimal; absentes: Array<{ numeroLigne: number; montant: Decimal; motif: 'omise' | 'plafond_nbMouvements' }> } | null = null;

  if (options.coherentAvec !== undefined) {
    const toutes = options.coherentAvec;
    const comptes = [...new Set(toutes.filter((l) => l.compteNum.startsWith('512')).map((l) => l.compteNum))].sort();
    const compteNum = comptes[0];
    if (compteNum === undefined) throw new Error('Aucune ligne de compte 512 dans le FEC fourni.');
    const mouvement = (l: LigneFec): Decimal => dec(l.debit).minus(dec(l.credit));
    const lignes512 = toutes.filter((l) => l.compteNum === compteNum && l.ecritureDate <= fin);
    const estOuverture = (l: LigneFec): boolean => JOURNAUX_A_NOUVEAUX.has(l.journalCode) || l.ecritureDate < debut;
    soldeOuverture = lignes512.filter(estOuverture).reduce((s, l) => s.plus(mouvement(l)), ZERO);
    const periode = lignes512.filter((l) => !estOuverture(l) && !mouvement(l).isZero())
      .sort((x, y) => (x.ecritureDate < y.ecritureDate ? -1 : x.ecritureDate > y.ecritureDate ? 1 : x.numeroLigne - y.numeroLigne));
    const retenues = periode.slice(0, nbMouvements);
    const absentes: Array<{ numeroLigne: number; montant: Decimal; motif: 'omise' | 'plafond_nbMouvements' }> =
      periode.slice(nbMouvements).map((l) => ({ numeroLigne: l.numeroLigne, montant: mouvement(l), motif: 'plafond_nbMouvements' as const }));

    // Tiers d'une ligne de banque : l'unique compte auxiliaire de son écriture.
    const tiersParEcriture = new Map<string, Set<string>>();
    for (const l of toutes) {
      if (l.compAuxNum === null) continue;
      const k = `${l.journalCode}|${l.ecritureNum}`;
      tiersParEcriture.set(k, (tiersParEcriture.get(k) ?? new Set<string>()).add(l.compAuxNum));
    }
    const tiersDe = (l: LigneFec): string | null => {
      const t = tiersParEcriture.get(`${l.journalCode}|${l.ecritureNum}`);
      return t !== undefined && t.size === 1 ? ([...t][0] as string) : null;
    };
    const montants = new Map<string, number>();
    for (const l of retenues) montants.set(mouvement(l).toFixed(2), (montants.get(mouvement(l).toFixed(2)) ?? 0) + 1);
    const montantLibre = (d: Decimal): boolean => !montants.has(d.toFixed(2));
    const utilisees = new Set<number>();

    // 1. Paiement groupé : deux encaissements d'un même tiers, à dix jours au plus, remis en une fois.
    let groupe = 0;
    recherche: for (let i = 0; i < retenues.length; i++) {
      const x = retenues[i] as LigneFec;
      const tx = tiersDe(x);
      if (tx === null || !mouvement(x).isPositive() || mouvement(x).isZero()) continue;
      for (let j = i + 1; j < retenues.length; j++) {
        const y = retenues[j] as LigneFec;
        if (ecartEnJours(x.ecritureDate, y.ecritureDate) > 10) break;
        if (tiersDe(y) !== tx || !mouvement(y).greaterThan(0) || mouvement(y).equals(mouvement(x))) continue;
        const total = mouvement(x).plus(mouvement(y));
        // Le groupe doit être l'unique combinaison possible pour ce tiers dans la fenêtre des règles.
        const voisins = retenues.filter((l) => l !== x && l !== y && tiersDe(l) === tx && Math.abs(ecartEnJours(l.ecritureDate, y.ecritureDate)) <= 60);
        if (!montantLibre(total) || voisins.length > 0) continue;
        ajouter({ date: plusJours(y.ecritureDate, 1), montant: total, libelle: 'REMISE DE CHEQUES', boutEnBout: null, lignes: [x.numeroLigne, y.numeroLigne], nature: 'paiement_groupe', groupe: ++groupe });
        utilisees.add(x.numeroLigne).add(y.numeroLigne);
        break recherche;
      }
    }
    // 2. Paiement en deux fois d'un encaissement (même référence de bout en bout sur les deux parts).
    const candidatsPartiel = retenues.filter((l) => !utilisees.has(l.numeroLigne) && mouvement(l).greaterThan(200) && l.pieceRef !== '');
    const partiel = candidatsPartiel.length > 0 ? candidatsPartiel[alea.entier(0, candidatsPartiel.length - 1)] : undefined;
    if (partiel !== undefined) {
      const total = mouvement(partiel);
      const part1 = total.times('0.6').toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const part2 = total.minus(part1);
      if (montantLibre(part1) && montantLibre(part2)) {
        groupe++;
        ajouter({ date: plusJours(partiel.ecritureDate, 0), montant: part1, libelle: `VIR SEPA RECU ACOMPTE ${partiel.pieceRef}`, boutEnBout: partiel.pieceRef, lignes: [partiel.numeroLigne], nature: 'paiement_partiel', groupe });
        ajouter({ date: plusJours(partiel.ecritureDate, 3), montant: part2, libelle: `VIR SEPA RECU SOLDE ${partiel.pieceRef}`, boutEnBout: partiel.pieceRef, lignes: [partiel.numeroLigne], nature: 'paiement_partiel', groupe });
        utilisees.add(partiel.numeroLigne);
      }
    }
    // 3. Écriture absente du relevé : un décaissement de fin de période (chèque émis non encore débité).
    const candidatsOmis = retenues.filter((l, i) => !utilisees.has(l.numeroLigne) && mouvement(l).isNegative() && i >= Math.floor(retenues.length * 0.8));
    const omise = candidatsOmis.length > 0 ? candidatsOmis[alea.entier(0, candidatsOmis.length - 1)] : undefined;
    if (omise !== undefined) {
      absentes.push({ numeroLigne: omise.numeroLigne, montant: mouvement(omise), motif: 'omise' });
      utilisees.add(omise.numeroLigne);
    }
    // 4. Les autres lignes : un mouvement chacune, décalé de 0 à 2 jours. Une référence de bout en bout est
    //    posée d'office quand un autre montant identique existe à moins de quinze jours (sinon ambiguïté).
    for (const l of retenues) {
      if (utilisees.has(l.numeroLigne)) continue;
      const montant = mouvement(l);
      const homonyme = (montants.get(montant.toFixed(2)) ?? 0) > 1
        && retenues.some((o) => o !== l && mouvement(o).equals(montant) && Math.abs(ecartEnJours(o.ecritureDate, l.ecritureDate)) <= 15);
      const avecReference = l.pieceRef !== '' && (homonyme || alea.entier(0, 1) === 1);
      const decalage = alea.entier(0, 2);
      ajouter({
        date: plusJours(l.ecritureDate, decalage), montant,
        libelle: `${montant.isPositive() ? 'VIR SEPA RECU' : 'PRLV SEPA EMIS'} ${l.pieceRef}`.trim(),
        boutEnBout: avecReference ? l.pieceRef : null, lignes: [l.numeroLigne], nature: 'exact', groupe: 0,
      });
    }
    // 5. Mouvement bancaire absent de la comptabilité : des frais prélevés par la banque.
    let frais = new Decimal('-23.40');
    while (!montantLibre(frais)) frais = frais.minus('0.01');
    ajouter({ date: plusJours(debut, Math.floor(nbJours / 2)), montant: frais, libelle: 'COMMISSION DE TENUE DE COMPTE', boutEnBout: null, lignes: [], nature: 'absent_comptabilite', groupe: 0 });
    coherence = { compteNum, soldeComptable: lignes512.reduce((s, l) => s.plus(mouvement(l)), ZERO), absentes };
  } else {
    soldeOuverture = new Decimal(alea.entier(100_000, 5_000_000)).div(100);
    for (let i = 0; i < nbMouvements; i++) {
      const jour = nbMouvements === 1 ? 0 : Math.floor((i * nbJours) / (nbMouvements - 1));
      const encaissement = alea.entier(0, 2) === 0;
      const centimes = alea.entier(500, 250_000);
      const type = alea.entier(0, 3);
      const libelle = encaissement
        ? ['VIR SEPA RECU CLIENT FICTIF', 'REMISE DE CHEQUES', 'VERSEMENT ESPECES', 'VIR SEPA RECU ; "REGLEMENT" FACTURE'][type] as string
        : ['PRLV SEPA FOURNISSEUR FICTIF', 'CARTE X1234 ACHAT', 'CHEQUE EMIS', 'COMMISSION INTERVENTION'][type] as string;
      ajouter({
        date: isoDepuisJours(jourDebut + jour), montant: new Decimal(encaissement ? centimes : -centimes).div(100), libelle: `${libelle} ${i + 1}`,
        boutEnBout: alea.entier(0, 1) === 1 ? `E2E-${graine}-${String(i + 1).padStart(5, '0')}` : null, lignes: [], nature: 'libre', groupe: 0,
      });
    }
  }

  brouillons.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.ordre - y.ordre));
  const total = brouillons.reduce((s, b) => s.plus(b.montant), ZERO);
  const soldeCloture = soldeOuverture.plus(total);
  const estCsv = format === 'csv';
  const mouvements: MouvementAttendu[] = brouillons.map((b, i) => ({
    rang: i + 1, dateOperation: b.date, montant: m2(b.montant), libelle: b.libelle,
    referenceBanque: `SYN${graine}-${String(i + 1).padStart(6, '0')}`,
    referenceBoutEnBout: estCsv ? null : b.boutEnBout,
  }));

  // --- Sérialisation ----------------------------------------------------------------------
  let contenu: string;
  let identifiantCompte: string | null = null;
  let profilCsv: ProfilCsvBanque | null = null;
  const base = `releve-synthetique-${compactDepuisIso(debut)}-${compactDepuisIso(fin)}`;
  let nomFichier: string;
  if (format === 'camt.053') {
    const solde = (code: string, d: Decimal, date: string): string =>
      `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${d.abs().toFixed(2)}</Amt><CdtDbtInd>${d.isNegative() ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
    const ecritures = mouvements.map((m, i) => {
      const b = brouillons[i] as Brouillon;
      return `<Ntry><Amt Ccy="EUR">${b.montant.abs().toFixed(2)}</Amt><CdtDbtInd>${b.montant.isNegative() ? 'DBIT' : 'CRDT'}</CdtDbtInd><Sts>BOOK</Sts>` +
        `<BookgDt><Dt>${m.dateOperation}</Dt></BookgDt><ValDt><Dt>${m.dateOperation}</Dt></ValDt><AcctSvcrRef>${xml(m.referenceBanque)}</AcctSvcrRef>` +
        `<BkTxCd><Prtry><Cd>${b.montant.isNegative() ? '08' : '05'}</Cd><Issr>CFONB</Issr></Prtry></BkTxCd>` +
        (m.referenceBoutEnBout !== null ? `<NtryDtls><TxDtls><Refs><EndToEndId>${xml(m.referenceBoutEnBout)}</EndToEndId></Refs></TxDtls></NtryDtls>` : '') +
        `<AddtlNtryInf>${xml(m.libelle)}</AddtlNtryInf></Ntry>`;
    });
    contenu = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">',
      '<BkToCstmrStmt>',
      `<GrpHdr><MsgId>SYN-${graine}</MsgId><CreDtTm>${fin}T23:00:00</CreDtTm></GrpHdr>`,
      `<Stmt><Id>SYN-${graine}-1</Id><CreDtTm>${fin}T23:00:00</CreDtTm>`,
      `<Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy><Svcr><FinInstnId><BIC>BANKFRPPXXX</BIC></FinInstnId></Svcr></Acct>`,
      solde('OPBD', soldeOuverture, debut),
      solde('CLBD', soldeCloture, fin),
      ...ecritures,
      '</Stmt>',
      '</BkToCstmrStmt>',
      '</Document>',
      '',
    ].join('\n');
    nomFichier = `${base}.camt053.xml`;
  } else if (format === 'ofx') {
    const estFr = /^FR\d{25}$/.test(iban);
    const [banque, guichet, compte, cle] = estFr ? [iban.slice(4, 9), iban.slice(9, 14), iban.slice(14, 25), iban.slice(25, 27)] : ['00000', '00000', iban.slice(-11), ''];
    identifiantCompte = [banque, guichet, compte, cle].filter((x) => x !== '').join('-');
    const sgml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const operations = mouvements.map((m, i) => {
      const b = brouillons[i] as Brouillon;
      return `<STMTTRN>\n<TRNTYPE>${b.montant.isNegative() ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${compactDepuisIso(m.dateOperation)}\n<TRNAMT>${b.montant.toFixed(2)}\n<FITID>${sgml(m.referenceBanque)}\n` +
        (m.referenceBoutEnBout !== null ? `<REFNUM>${sgml(m.referenceBoutEnBout)}\n` : '') + `<MEMO>${sgml(m.libelle)}\n</STMTTRN>`;
    });
    contenu = [
      'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
      '<OFX>',
      `<SIGNONMSGSRSV1>\n<SONRS>\n<STATUS>\n<CODE>0\n<SEVERITY>INFO\n</STATUS>\n<DTSERVER>${compactDepuisIso(fin)}230000\n<LANGUAGE>FRA\n</SONRS>\n</SIGNONMSGSRSV1>`,
      '<BANKMSGSRSV1>\n<STMTTRNRS>\n<TRNUID>1\n<STATUS>\n<CODE>0\n<SEVERITY>INFO\n</STATUS>',
      '<STMTRS>\n<CURDEF>EUR',
      `<BANKACCTFROM>\n<BANKID>${banque}\n<BRANCHID>${guichet}\n<ACCTID>${compte}\n<ACCTTYPE>CHECKING\n${cle !== '' ? `<ACCTKEY>${cle}\n` : ''}</BANKACCTFROM>`,
      `<BANKTRANLIST>\n<DTSTART>${compactDepuisIso(debut)}\n<DTEND>${compactDepuisIso(fin)}`,
      ...operations,
      '</BANKTRANLIST>',
      `<LEDGERBAL>\n<BALAMT>${soldeCloture.toFixed(2)}\n<DTASOF>${compactDepuisIso(fin)}\n</LEDGERBAL>`,
      '</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>',
      '',
    ].join('\n');
    nomFichier = `${base}.ofx`;
  } else {
    const ligneSolde = (intitule: string, d: Decimal): string => `${intitule};;;${d.isNegative() ? montantFr(d.abs()) : ''};${d.isNegative() ? '' : montantFr(d)};`;
    const totalDebit = brouillons.reduce((s, b) => (b.montant.isNegative() ? s.plus(b.montant.abs()) : s), ZERO);
    const totalCredit = brouillons.reduce((s, b) => (b.montant.isNegative() ? s : s.plus(b.montant)), ZERO);
    contenu = [
      ligneSolde(`Solde initial au ${dateFr(debut)}`, soldeOuverture),
      'Date;Date de valeur;Libellé;Débit;Crédit;Référence',
      ...mouvements.map((m, i) => {
        const b = brouillons[i] as Brouillon;
        return [dateFr(m.dateOperation), dateFr(m.dateOperation), csv(m.libelle), b.montant.isNegative() ? montantFr(b.montant.abs()) : '', b.montant.isNegative() ? '' : montantFr(b.montant), csv(m.referenceBanque)].join(';');
      }),
      '',
      `Total des mouvements;;;${montantFr(totalDebit)};${montantFr(totalCredit)};`,
      ligneSolde(`Nouveau solde au ${dateFr(fin)}`, soldeCloture),
      '',
    ].join('\r\n');
    profilCsv = {
      separateur: ';', lignesEntete: 2, formatDate: 'JJ/MM/AAAA', decimale: ',', iban,
      colonnes: { date: 'Date', dateValeur: 'Date de valeur', libelle: 'Libellé', debit: 'Débit', credit: 'Crédit', reference: 'Référence' },
    };
    nomFichier = `${base}.csv`;
  }

  let attenduCoherence: AttenduReleveSynthetique['coherence'] = null;
  if (coherence !== null) {
    const groupes = new Map<string, { nature: 'exact' | 'paiement_groupe' | 'paiement_partiel'; lignes: Set<number>; rangs: number[]; parReference: boolean }>();
    brouillons.forEach((b, i) => {
      if (b.nature === 'absent_comptabilite' || b.nature === 'libre') return;
      const k = b.groupe > 0 ? `g${b.groupe}` : `l${b.lignes[0] ?? i}`;
      const g = groupes.get(k) ?? { nature: b.nature, lignes: new Set<number>(), rangs: [], parReference: false };
      for (const n of b.lignes) g.lignes.add(n);
      g.rangs.push(i + 1);
      g.parReference = g.parReference || b.boutEnBout !== null;
      groupes.set(k, g);
    });
    attenduCoherence = {
      compteNum: coherence.compteNum,
      soldeComptable: m2(coherence.soldeComptable),
      ecart: m2(coherence.soldeComptable.minus(soldeCloture)),
      appariements: [...groupes.values()].map((g) => ({ nature: g.nature, numerosLignesFec: [...g.lignes].sort((x, y) => x - y), rangsMouvements: g.rangs, parReference: g.parReference }))
        .sort((x, y) => (x.rangsMouvements[0] as number) - (y.rangsMouvements[0] as number)),
      mouvementsAbsentsDeLaComptabilite: brouillons.flatMap((b, i) => (b.nature === 'absent_comptabilite' ? [{ rang: i + 1, montant: m2(b.montant) }] : [])),
      ecrituresAbsentesDuReleve: coherence.absentes.map((x) => ({ numeroLigne: x.numeroLigne, montant: m2(x.montant), motif: x.motif })).sort((x, y) => x.numeroLigne - y.numeroLigne),
    };
  }
  return {
    contenu,
    nomFichier,
    attendu: {
      iban, identifiantCompte,
      soldeOuverture: m2(soldeOuverture), dateOuverture: debut, soldeCloture: m2(soldeCloture), dateCloture: fin,
      nbMouvements: mouvements.length, totalMouvements: m2(total), mouvements, profilCsv, coherence: attenduCoherence,
    },
  };
}
