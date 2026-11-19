/**
 * Lecture d'un relevé OFX : versions 1.x (SGML, balises d'éléments non fermées) et 2.x (XML).
 * Un seul analyseur lexical tolérant pour les deux syntaxes : aucune entité n'est résolue hormis
 * les cinq entités prédéfinies et les références numériques ; DOCTYPE et ENTITY sont refusés.
 * Seuls les relevés de compte bancaire (STMTRS) sont lus ; les relevés de carte (CCSTMTRS) sont signalés.
 *
 * Dates : la date civile retenue est celle ÉCRITE dans le fichier (AAAAMMJJ), sans conversion de fuseau.
 * OFX ne porte pas de solde d'ouverture : le cadrage n'est vérifiable que si l'appelant le fournit.
 */
import { Decimal } from 'decimal.js';
import { dateCivileValide, versIso } from '../dates.js';
import { validerIban } from '../identifiants.js';
import {
  CollecteurAnomalies, TAILLE_MAX_RELEVE, appliquerOptionsSoldes, chaineMontant, finaliserReleve, nettoyerTexteBancaire, referenceOuNull, releveIllisible,
} from './commun.js';
import type { BrouillonCompte, BrouillonMouvement } from './commun.js';
import { SOURCE_OFX, SOURCE_OFX_SGML } from './sources.js';
import type { OptionsLectureReleve, RapportReleve } from './types.js';

const CONTENEURS = new Set(['STMTRS', 'CCSTMTRS', 'BANKACCTFROM', 'BANKTRANLIST', 'STMTTRN', 'LEDGERBAL', 'AVAILBAL', 'PAYEE', 'BANKACCTTO', 'CCACCTTO', 'CURRENCY', 'ORIGCURRENCY', 'BANKTRANLISTP', 'STMTTRNP']);

const ENTITES: Readonly<Record<string, string>> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

function decoderEntites(v: string): string {
  return v.replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|quot|apos|amp));/g, (tout, decimal: string | undefined, hexa: string | undefined, nom: string | undefined) => {
    if (nom !== undefined) return ENTITES[nom] ?? tout;
    const code = decimal !== undefined ? Number(decimal) : parseInt(hexa ?? '', 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
  });
}

/** AAAAMMJJ[HHMMSS[.XXX]][ [décalage[:fuseau]] ] → date civile écrite, ou null. */
export function dateOfx(v: string | undefined): string | null {
  if (v === undefined) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d{1,3})?)?\s*(?:\[[+-]?\d{1,2}(?:\.\d{1,2})?(?::[^\]]{0,20})?\])?$/.exec(v.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const mo = Number(m[2]);
  const j = Number(m[3]);
  if (!dateCivileValide(a, mo, j)) return null;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60)) return null;
  return versIso(a, mo, j);
}

/** Montant OFX : signe facultatif, point ou virgule décimale, aucun séparateur de milliers. */
function montantOfx(v: string | undefined): Decimal | null {
  if (v === undefined) return null;
  const m = /^([+-]?)(\d{0,13})(?:[.,](\d{0,6}))?$/.exec(v.trim());
  if (!m) return null;
  const entier = m[2] ?? '';
  const decimales = m[3] ?? '';
  if (entier === '' && decimales === '') return null;
  const d = new Decimal(`${entier === '' ? '0' : entier}${decimales === '' ? '' : `.${decimales}`}`);
  return m[1] === '-' ? d.negated() : d;
}

interface Bloc { nom: string; champs: Map<string, string>; enfants: Bloc[] }

const champ = (b: Bloc | undefined, nom: string): string | undefined => b?.champs.get(nom);
const enfant = (b: Bloc | undefined, nom: string): Bloc | undefined => b?.enfants.find((e) => e.nom === nom);

export function lireOfx(contenu: string, options?: OptionsLectureReleve): RapportReleve {
  const anomalies = new CollecteurAnomalies();
  if (typeof contenu !== 'string' || contenu.trim() === '') {
    anomalies.signaler('FICHIER_VIDE', 'bloquante', 'Contenu OFX absent ou vide.');
    return releveIllisible('ofx', null, anomalies, SOURCE_OFX);
  }
  if (contenu.length > TAILLE_MAX_RELEVE) {
    anomalies.signaler('TROP_VOLUMINEUX', 'bloquante', `Relevé de plus de ${TAILLE_MAX_RELEVE} caractères : refusé.`);
    return releveIllisible('ofx', null, anomalies, SOURCE_OFX);
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(contenu)) {
    anomalies.signaler('DOCTYPE_INTERDIT', 'bloquante', 'Déclaration DOCTYPE ou ENTITY interdite.');
    return releveIllisible('ofx', null, anomalies, SOURCE_OFX);
  }
  const debutCorps = contenu.search(/<OFX>/i);
  if (debutCorps < 0) {
    anomalies.signaler('RACINE_INATTENDUE', 'bloquante', 'Élément <OFX> introuvable.');
    return releveIllisible('ofx', null, anomalies, SOURCE_OFX);
  }
  const entete = contenu.slice(0, debutCorps);
  const xml = /<\?OFX\b[^>]*\bVERSION\s*=\s*["'](\d{3})["']/i.exec(entete);
  const sgml = /^\s*VERSION\s*:\s*(\d{3})\s*$/im.exec(entete);
  const version = xml?.[1] ?? sgml?.[1] ?? null;
  const estSgml = xml === null && (sgml !== null || /OFXHEADER\s*:\s*100/i.test(entete));
  const source = estSgml || version === null ? SOURCE_OFX_SGML : SOURCE_OFX;
  if (version === null) anomalies.signaler('VERSION_INCONNUE', 'mineure', 'En-tête OFX absent ou sans version : lecture tolérante.');

  // --- Analyse lexicale : conteneurs connus empilés, tout le reste est un élément feuille. ---
  const racine: Bloc = { nom: 'OFX', champs: new Map(), enfants: [] };
  const pile: Bloc[] = [racine];
  const jeton = /<(\/?)([A-Za-z0-9_.]{1,40})>([^<]*)/g;
  jeton.lastIndex = debutCorps;
  let correspondance: RegExpExecArray | null;
  while ((correspondance = jeton.exec(contenu)) !== null) {
    const fermant = correspondance[1] === '/';
    const nom = (correspondance[2] ?? '').toUpperCase();
    if (fermant) {
      const i = pile.findLastIndex((b) => b.nom === nom);
      if (i > 0) pile.length = i;
      continue;
    }
    const courant = pile[pile.length - 1] as Bloc;
    if (CONTENEURS.has(nom)) {
      // Une transaction ouverte alors que la précédente n'est pas fermée : on ferme la précédente.
      const i = pile.findLastIndex((b) => b.nom === nom);
      if (i > 0 && (nom === 'STMTTRN' || nom === 'STMTRS' || nom === 'CCSTMTRS')) pile.length = i;
      const parent = pile[pile.length - 1] as Bloc;
      const bloc: Bloc = { nom, champs: new Map(), enfants: [] };
      parent.enfants.push(bloc);
      pile.push(bloc);
      continue;
    }
    const valeur = decoderEntites(correspondance[3] ?? '').trim();
    if (valeur !== '' && !courant.champs.has(nom)) courant.champs.set(nom, valeur);
  }

  const tous = (b: Bloc, nom: string, acc: Bloc[] = []): Bloc[] => {
    for (const e of b.enfants) {
      if (e.nom === nom) acc.push(e);
      else tous(e, nom, acc);
    }
    return acc;
  };
  if (tous(racine, 'CCSTMTRS').length > 0) {
    anomalies.signaler('RELEVE_CARTE_NON_LU', 'majeure', 'Relevé de carte (CCSTMTRS) présent : non lu, seuls les relevés de compte bancaire (STMTRS) sont pris en charge.');
  }
  const releves = tous(racine, 'STMTRS');
  if (releves.length === 0) anomalies.signaler('AUCUN_RELEVE', 'bloquante', 'Aucun relevé de compte (STMTRS) dans le fichier.');

  const comptes: BrouillonCompte[] = [];
  const mouvements: BrouillonMouvement[] = [];
  for (const [indexCompte, stmt] of releves.entries()) {
    const de = enfant(stmt, 'BANKACCTFROM');
    const numero = champ(de, 'ACCTID')?.replace(/\s/g, '') ?? null;
    const iban = numero !== null && validerIban(numero.toUpperCase()).valide ? numero.toUpperCase() : null;
    const identifiant = iban !== null ? null : referenceOuNull([champ(de, 'BANKID'), champ(de, 'BRANCHID'), numero ?? undefined, champ(de, 'ACCTKEY')].filter((x) => x !== undefined && x !== '').join('-'));
    if (iban === null && identifiant === null) anomalies.signaler('COMPTE_NON_IDENTIFIE', 'majeure', `Relevé n° ${indexCompte + 1} : compte non identifié (BANKACCTFROM absent ou vide).`);
    const devise = referenceOuNull(champ(stmt, 'CURDEF'));
    const compte = { iban, bic: null, identifiant, devise };
    const solde = enfant(stmt, 'LEDGERBAL');
    const soldeCloture = montantOfx(champ(solde, 'BALAMT'));
    if (solde !== undefined && soldeCloture === null) anomalies.signaler('SOLDE_ILLISIBLE', 'majeure', 'Solde LEDGERBAL/BALAMT illisible : ignoré.');
    comptes.push({ iban, identifiant, devise, soldeOuverture: null, dateOuverture: null, soldeCloture, dateCloture: dateOfx(champ(solde, 'DTASOF')) });

    const liste = enfant(stmt, 'BANKTRANLIST');
    if (enfant(stmt, 'BANKTRANLISTP') !== undefined) {
      anomalies.signaler('OPERATIONS_EN_ATTENTE_IGNOREES', 'information', 'Opérations en attente (BANKTRANLISTP) présentes : ignorées, elles ne sont pas comptabilisées.');
    }
    const fitidVus = new Set<string>();
    for (const [indexTrn, trn] of (liste?.enfants ?? []).filter((e) => e.nom === 'STMTTRN').entries()) {
      const ou = `Relevé n° ${indexCompte + 1}, opération n° ${indexTrn + 1}`;
      const rang = mouvements.length + 1;
      const montant = montantOfx(champ(trn, 'TRNAMT'));
      const date = dateOfx(champ(trn, 'DTPOSTED'));
      if (montant === null || date === null) {
        anomalies.signaler('ECRITURE_ILLISIBLE', 'majeure', `${ou} : montant (TRNAMT) ou date (DTPOSTED) illisible, opération écartée (le cadrage en tiendra compte).`);
        continue;
      }
      if (enfant(trn, 'CURRENCY') !== undefined) {
        anomalies.signaler('DEVISE_INCOHERENTE', 'majeure', 'Opération exprimée dans une autre devise que le compte (CURRENCY) : conservée telle quelle, cadrage à examiner.', rang);
      }
      const type = referenceOuNull(champ(trn, 'TRNTYPE'));
      if ((type === 'DEBIT' && montant.isPositive() && !montant.isZero()) || (type === 'CREDIT' && montant.isNegative())) {
        anomalies.signaler('SENS_INCOHERENT', 'mineure', `Type ${type} en contradiction avec le signe du montant : le signe du montant prévaut (OFX § 11.4.4.1).`, rang);
      }
      const fitid = referenceOuNull(champ(trn, 'FITID'));
      if (fitid === null) anomalies.signaler('FITID_ABSENT', 'mineure', 'Identifiant FITID absent : clé d’idempotence calculée sur les autres champs.', rang);
      else if (fitidVus.has(fitid)) anomalies.signaler('FITID_EN_DOUBLE', 'majeure', 'Identifiant FITID déjà rencontré dans ce compte (il doit y être unique) : opération conservée, doublon possible.', rang);
      if (fitid !== null) fitidVus.add(fitid);
      const beneficiaire = enfant(trn, 'PAYEE');
      const compteVers = champ(enfant(trn, 'BANKACCTTO'), 'ACCTID')?.replace(/\s/g, '').toUpperCase();
      const ibanVers = compteVers !== undefined && validerIban(compteVers).valide ? compteVers : null;
      const nomBeneficiaire = referenceOuNull(champ(beneficiaire, 'NAME'));
      const libelle = nettoyerTexteBancaire([champ(trn, 'NAME') ?? champ(beneficiaire, 'NAME'), champ(trn, 'MEMO')].map((x) => nettoyerTexteBancaire(x)).filter((x) => x !== '').join(' / '));
      mouvements.push({
        indexCompte, compte, dateOperation: date, dateValeur: dateOfx(champ(trn, 'DTAVAIL')),
        montant: chaineMontant(montant), libelle,
        referenceBanque: fitid,
        referenceBoutEnBout: referenceOuNull(champ(trn, 'REFNUM') ?? champ(trn, 'CHECKNUM')),
        contrepartie: nomBeneficiaire === null && ibanVers === null ? null : { nom: nomBeneficiaire, iban: ibanVers },
        codeOperation: type,
      });
    }
  }
  appliquerOptionsSoldes(comptes, options, anomalies);
  return finaliserReleve('ofx', version, comptes, mouvements, anomalies, source);
}
