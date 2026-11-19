/**
 * Lecture d'un relevé ISO 20022 camt.053 (BankToCustomerStatement), versions .001.02 à .001.08.
 * Le XML est un contenu NON FIABLE : DOCTYPE/ENTITY refusés, taille et profondeur bornées
 * (même configuration que `facture/xml.ts`). Ne lève jamais sur le contenu : un fichier
 * illisible donne un rapport `lisible: false` avec une anomalie bloquante.
 */
import { Decimal } from 'decimal.js';
import { estDateIso } from '../dates.js';
import { ErreurDocumentXml, analyserXmlSecurise, attribut, liste, noeud, texte } from '../facture/xml.js';
import { validerIban } from '../identifiants.js';
import {
  CollecteurAnomalies, TAILLE_MAX_RELEVE, chaineMontant, finaliserReleve, nettoyerTexteBancaire, referenceOuNull, releveIllisible,
} from './commun.js';
import type { BrouillonCompte, BrouillonMouvement } from './commun.js';
import { SOURCE_CAMT053_CFONB, SOURCE_CAMT053_ISO } from './sources.js';
import type { RapportReleve } from './types.js';

const MOTIF_MONTANT = /^\d{1,13}(\.\d{1,6})?$/;

function montantXml(v: unknown): Decimal | null {
  const t = texte(v);
  return t !== null && MOTIF_MONTANT.test(t) ? new Decimal(t) : null;
}

/** Date d'un élément DateAndDateTimeChoice (Dt ou DtTm) : la date civile telle qu'écrite. */
function dateXml(v: unknown): string | null {
  const t = texte(noeud(v, 'Dt')) ?? texte(noeud(v, 'DtTm'));
  if (t === null) return null;
  const iso = t.slice(0, 10);
  return estDateIso(iso) ? iso : null;
}

function sens(v: unknown): 1 | -1 | null {
  const t = texte(v);
  return t === 'CRDT' ? 1 : t === 'DBIT' ? -1 : null;
}

function ibanOuNull(v: unknown): string | null {
  const t = texte(v)?.replace(/\s/g, '').toUpperCase() ?? null;
  return t !== null && validerIban(t).valide ? t : null;
}

/** Nom d'une partie : `Nm` direct (versions .02 à .07) ou sous `Pty` (version .08). */
function nomPartie(v: unknown): string | null {
  return referenceOuNull(texte(noeud(v, 'Nm')) ?? texte(noeud(v, 'Pty', 'Nm')));
}

function codeOperation(bkTxCd: unknown): string | null {
  const domaine = texte(noeud(bkTxCd, 'Domn', 'Cd'));
  if (domaine !== null) {
    const famille = texte(noeud(bkTxCd, 'Domn', 'Fmly', 'Cd'));
    const sousFamille = texte(noeud(bkTxCd, 'Domn', 'Fmly', 'SubFmlyCd'));
    return referenceOuNull([domaine, famille, sousFamille].filter((x) => x !== null).join('-'));
  }
  return referenceOuNull(texte(noeud(bkTxCd, 'Prtry', 'Cd')));
}

interface DetailTransaction {
  montant: Decimal | null;
  devise: string | null;
  sens: 1 | -1 | null;
  referenceBanque: string | null;
  referenceBoutEnBout: string | null;
  libelles: string[];
  debiteur: { nom: string | null; iban: string | null };
  crediteur: { nom: string | null; iban: string | null };
  code: string | null;
}

function lireDetail(tx: unknown): DetailTransaction {
  // Montant de la transaction : `Amt` direct (versions .04 et suivantes) ou `AmtDtls/TxAmt/Amt`.
  const direct = noeud(tx, 'Amt');
  const viaDetails = noeud(tx, 'AmtDtls', 'TxAmt', 'Amt');
  const element = montantXml(direct) !== null ? direct : viaDetails;
  const boutEnBout = texte(noeud(tx, 'Refs', 'EndToEndId'));
  const structuree = liste(noeud(tx, 'RmtInf', 'Strd')).map((s) => texte(noeud(s, 'CdtrRefInf', 'Ref'))).find((r) => r !== null) ?? null;
  const parties = noeud(tx, 'RltdPties');
  return {
    montant: montantXml(element),
    devise: attribut(element, 'Ccy'),
    sens: sens(noeud(tx, 'CdtDbtInd')),
    referenceBanque: referenceOuNull(texte(noeud(tx, 'Refs', 'AcctSvcrRef'))),
    referenceBoutEnBout: referenceOuNull(boutEnBout !== null && boutEnBout.toUpperCase() !== 'NOTPROVIDED' ? boutEnBout : structuree),
    libelles: [...liste(noeud(tx, 'RmtInf', 'Ustrd')).map((u) => texte(u)), texte(noeud(tx, 'AddtlTxInf'))].filter((x): x is string => x !== null),
    debiteur: { nom: nomPartie(noeud(parties, 'Dbtr')), iban: ibanOuNull(noeud(parties, 'DbtrAcct', 'Id', 'IBAN')) },
    crediteur: { nom: nomPartie(noeud(parties, 'Cdtr')), iban: ibanOuNull(noeud(parties, 'CdtrAcct', 'Id', 'IBAN')) },
    code: codeOperation(noeud(tx, 'BkTxCd')),
  };
}

function composerLibelle(morceaux: Array<string | null>): string {
  const vus = new Set<string>();
  const retenus: string[] = [];
  for (const m of morceaux) {
    const t = nettoyerTexteBancaire(m);
    if (t !== '' && !vus.has(t)) {
      vus.add(t);
      retenus.push(t);
    }
  }
  return nettoyerTexteBancaire(retenus.join(' / '));
}

function contrepartieDe(d: DetailTransaction, signe: 1 | -1): BrouillonMouvement['contrepartie'] {
  // Encaissement : la contrepartie est le débiteur (donneur d'ordre) ; décaissement : le créancier.
  const p = signe === 1 ? d.debiteur : d.crediteur;
  return p.nom === null && p.iban === null ? null : p;
}

export function lireCamt053(xml: string): RapportReleve {
  const anomalies = new CollecteurAnomalies();
  let version: string | null = null;
  let source = SOURCE_CAMT053_ISO;
  let doc: Record<string, unknown>;
  try {
    doc = analyserXmlSecurise(xml, TAILLE_MAX_RELEVE);
  } catch (e) {
    if (!(e instanceof ErreurDocumentXml)) throw e;
    anomalies.signaler(e.code, 'bloquante', e.message);
    return releveIllisible('camt.053', null, anomalies, source);
  }
  const document = doc['Document'];
  // L'espace de noms est lu dans le texte : l'analyseur retire les déclarations xmlns.
  const espaces = [...xml.slice(0, 20_000).matchAll(/xmlns(?::[A-Za-z0-9_.-]+)?\s*=\s*["'][^"']*?camt\.(\d{3})\.(\d{3})\.(\d{2})["']/g)];
  const camt053 = espaces.find((e) => e[1] === '053');
  if (camt053) {
    version = `camt.053.${camt053[2]}.${camt053[3]}`;
    const n = Number(camt053[3]);
    if (camt053[2] === '001' && n === 2) source = SOURCE_CAMT053_CFONB;
    if (camt053[2] !== '001' || n < 2 || n > 8) anomalies.signaler('VERSION_NON_TESTEE', 'mineure', `Version ${version} hors de la plage testée (.001.02 à .001.08) : lue avec les mêmes règles.`);
  } else if (espaces.length > 0) {
    anomalies.signaler('FORMAT_INATTENDU', 'bloquante', 'Le document n’est pas un camt.053 (autre message camt déclaré dans l’espace de noms).');
    return releveIllisible('camt.053', null, anomalies, source);
  } else {
    anomalies.signaler('VERSION_INCONNUE', 'mineure', 'Espace de noms camt.053 absent ou non reconnu : version indéterminée.');
  }
  const racine = noeud(document, 'BkToCstmrStmt');
  if (racine === undefined || racine === null || typeof racine !== 'object' || Array.isArray(racine)) {
    anomalies.signaler('RACINE_INATTENDUE', 'bloquante', 'Élément Document/BkToCstmrStmt attendu.');
    return releveIllisible('camt.053', version, anomalies, source);
  }
  const releves = liste(noeud(racine, 'Stmt'));
  if (releves.length === 0) anomalies.signaler('AUCUN_RELEVE', 'bloquante', 'Aucun élément Stmt dans le message.');

  const comptes: BrouillonCompte[] = [];
  const mouvements: BrouillonMouvement[] = [];
  const rang = (): number => mouvements.length + 1;

  for (const [indexCompte, stmt] of releves.entries()) {
    const acct = noeud(stmt, 'Acct');
    const ibanBrut = texte(noeud(acct, 'Id', 'IBAN'));
    const iban = ibanOuNull(noeud(acct, 'Id', 'IBAN'));
    const identifiant = referenceOuNull(texte(noeud(acct, 'Id', 'Othr', 'Id')) ?? (iban === null ? ibanBrut : null));
    if (ibanBrut !== null && iban === null) anomalies.signaler('IBAN_INVALIDE', 'majeure', 'IBAN du compte invalide (clé de contrôle) : conservé comme simple identifiant.');
    if (iban === null && identifiant === null) anomalies.signaler('COMPTE_NON_IDENTIFIE', 'majeure', `Relevé n° ${indexCompte + 1} : aucun identifiant de compte (IBAN ou Othr/Id).`);
    const institution = noeud(acct, 'Svcr', 'FinInstnId');
    const bic = referenceOuNull(texte(noeud(institution, 'BIC')) ?? texte(noeud(institution, 'BICFI')));
    const devise = referenceOuNull(texte(noeud(acct, 'Ccy')));
    const compte = { iban, bic, identifiant, devise };

    // Soldes : OPBD (ancien solde) sinon PRCD (clôture précédente) ; CLBD (nouveau solde).
    const soldes = new Map<string, Array<{ montant: Decimal; date: string | null }>>();
    for (const bal of liste(noeud(stmt, 'Bal'))) {
      const code = texte(noeud(bal, 'Tp', 'CdOrPrtry', 'Cd'));
      if (code === null) continue;
      const brut = montantXml(noeud(bal, 'Amt'));
      const s = sens(noeud(bal, 'CdtDbtInd'));
      if (brut === null || s === null) {
        anomalies.signaler('SOLDE_ILLISIBLE', 'majeure', `Solde ${nettoyerTexteBancaire(code, 10)} illisible (montant ou sens) : ignoré.`);
        continue;
      }
      const deviseSolde = attribut(noeud(bal, 'Amt'), 'Ccy');
      if (devise !== null && deviseSolde !== null && deviseSolde !== devise) {
        anomalies.signaler('DEVISE_INCOHERENTE', 'majeure', `Solde ${nettoyerTexteBancaire(code, 10)} exprimé dans une autre devise que le compte : ignoré.`);
        continue;
      }
      const l = soldes.get(code) ?? [];
      l.push({ montant: s === 1 ? brut : brut.negated(), date: dateXml(noeud(bal, 'Dt')) });
      soldes.set(code, l);
    }
    const unique = (code: string): { montant: Decimal; date: string | null } | null => {
      const l = soldes.get(code) ?? [];
      if (l.length > 1) anomalies.signaler('SOLDE_MULTIPLE', 'majeure', `Plusieurs soldes ${code} dans le même relevé : aucun n'est retenu.`);
      return l.length === 1 ? (l[0] ?? null) : null;
    };
    const ouverture = soldes.has('OPBD') ? unique('OPBD') : unique('PRCD');
    const cloture = unique('CLBD');
    comptes.push({
      iban, identifiant, devise,
      soldeOuverture: ouverture?.montant ?? null, dateOuverture: ouverture?.date ?? null,
      soldeCloture: cloture?.montant ?? null, dateCloture: cloture?.date ?? null,
    });

    for (const [indexEcriture, ntry] of liste(noeud(stmt, 'Ntry')).entries()) {
      const r = rang();
      const ou = `Relevé n° ${indexCompte + 1}, écriture n° ${indexEcriture + 1}`;
      const brut = montantXml(noeud(ntry, 'Amt'));
      const s = sens(noeud(ntry, 'CdtDbtInd'));
      if (brut === null || s === null) {
        anomalies.signaler('ECRITURE_ILLISIBLE', 'majeure', `${ou} : montant ou sens (CdtDbtInd) illisible, écriture écartée (le cadrage en tiendra compte).`);
        continue;
      }
      const statut = texte(noeud(ntry, 'Sts')) ?? texte(noeud(ntry, 'Sts', 'Cd'));
      if (statut !== null && statut !== 'BOOK') {
        anomalies.signaler('ECRITURE_NON_COMPTABILISEE', 'mineure', `${ou} : statut « ${nettoyerTexteBancaire(statut, 10)} » (non comptabilisée), écriture écartée.`);
        continue;
      }
      const dateOperation = dateXml(noeud(ntry, 'BookgDt'));
      const dateValeur = dateXml(noeud(ntry, 'ValDt'));
      const date = dateOperation ?? dateValeur;
      if (date === null) {
        anomalies.signaler('ECRITURE_ILLISIBLE', 'majeure', `${ou} : ni date de comptabilisation ni date de valeur lisible, écriture écartée.`);
        continue;
      }
      if (dateOperation === null) anomalies.signaler('DATE_OPERATION_ABSENTE', 'mineure', 'Date de comptabilisation absente : date de valeur utilisée.', r);
      const deviseEcriture = attribut(noeud(ntry, 'Amt'), 'Ccy');
      if (devise !== null && deviseEcriture !== null && deviseEcriture !== devise) {
        anomalies.signaler('DEVISE_INCOHERENTE', 'majeure', 'Écriture exprimée dans une autre devise que le compte : conservée telle quelle, cadrage à examiner.', r);
      }
      const indicateur = texte(noeud(ntry, 'RvslInd'));
      const contrePassation = indicateur === 'true' || indicateur === '1';
      if (contrePassation) {
        anomalies.signaler('ECRITURE_CONTRE_PASSEE', 'information', 'Écriture de contre-passation (RvslInd) : le sens retenu est celui de CdtDbtInd, qui porte déjà l’annulation.', r);
      }
      const referenceEcriture = referenceOuNull(texte(noeud(ntry, 'AcctSvcrRef')));
      const codeEcriture = codeOperation(noeud(ntry, 'BkTxCd'));
      const infoEcriture = texte(noeud(ntry, 'AddtlNtryInf'));
      const blocs = liste(noeud(ntry, 'NtryDtls'));
      const details = blocs.flatMap((b) => liste(noeud(b, 'TxDtls'))).map(lireDetail);
      const remise = referenceOuNull(blocs.map((b) => texte(noeud(b, 'Btch', 'PmtInfId'))).find((x) => x !== null) ?? null);
      const signe: 1 | -1 = s;
      const montantEcriture = signe === 1 ? brut : brut.negated();

      // Écriture groupée : un mouvement par transaction seulement si tous les montants sont détaillés,
      // dans la devise de l'écriture, et que leur somme signée égale exactement le montant de l'écriture.
      let ventilee = false;
      if (details.length >= 2) {
        const complets = details.every((d) => d.montant !== null && (d.devise === null || deviseEcriture === null || d.devise === deviseEcriture));
        if (complets) {
          let total = new Decimal(0);
          for (const d of details) total = total.plus((d.sens ?? signe) === 1 ? (d.montant as Decimal) : (d.montant as Decimal).negated());
          ventilee = total.equals(montantEcriture);
        }
        if (!ventilee) {
          anomalies.signaler('ECRITURE_GROUPEE_NON_VENTILEE', 'information', `Écriture groupée de ${details.length} transactions dont les montants ne sont pas détaillés ou ne totalisent pas l'écriture : un seul mouvement retenu.`, r);
        }
      }
      if (ventilee) {
        for (const d of details) {
          const signeTx = d.sens ?? signe;
          mouvements.push({
            indexCompte, compte, dateOperation: date, dateValeur,
            montant: chaineMontant(signeTx === 1 ? (d.montant as Decimal) : (d.montant as Decimal).negated()),
            libelle: composerLibelle([...d.libelles, infoEcriture]),
            referenceBanque: d.referenceBanque ?? referenceEcriture,
            referenceBoutEnBout: d.referenceBoutEnBout,
            contrepartie: contrepartieDe(d, signeTx),
            codeOperation: d.code ?? codeEcriture,
          });
        }
        continue;
      }
      const seul = details.length === 1 ? (details[0] as DetailTransaction) : null;
      mouvements.push({
        indexCompte, compte, dateOperation: date, dateValeur,
        montant: chaineMontant(montantEcriture),
        libelle: composerLibelle([infoEcriture, ...(seul?.libelles ?? [])]),
        referenceBanque: referenceEcriture ?? seul?.referenceBanque ?? null,
        referenceBoutEnBout: seul?.referenceBoutEnBout ?? remise,
        contrepartie: seul === null ? null : contrepartieDe(seul, signe),
        codeOperation: codeEcriture ?? seul?.code ?? null,
      });
    }
  }
  return finaliserReleve('camt.053', version, comptes, mouvements, anomalies, source);
}
