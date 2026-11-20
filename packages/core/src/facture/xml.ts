/**
 * Extraction structurée de factures électroniques XML :
 *  - UN/CEFACT CrossIndustryInvoice (Factur-X / ZUGFeRD / CII D16B–D22B) ;
 *  - OASIS UBL 2.1 Invoice / CreditNote.
 *
 * Sécurité : le XML est un contenu NON FIABLE. Toute déclaration DOCTYPE ou ENTITY est
 * refusée avant analyse (aucune entité interne ou externe n'est donc résolue : pas de XXE,
 * pas d'expansion exponentielle), la taille et la profondeur sont bornées, et aucun accès
 * réseau ou fichier n'est effectué.
 *
 * Correspondances d'éléments : établies sur les exemples officiels du dépôt de validation
 * EN 16931 (CEN/TC 434, ConnectingEurope/eInvoicing-EN16931) consultés le 2026-11-19 ;
 * la spécification Factur-X elle-même (téléchargement sur formulaire, fnfe-mpe.org) n'a pas
 * été consultée : voir SOURCE_FACTURE_XML.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SourceRegle } from '../controles/types.js';
import { dateCivileValide, estDateIso, isoDepuisCompact, versIso } from '../dates.js';
import { Decimal } from 'decimal.js';
import { champsFactureVides } from './types.js';
import type { ChampExtrait, ChampsFacture } from './types.js';

export const TAILLE_MAX_XML_FACTURE = 5_000_000;

export const SOURCE_FACTURE_XML: SourceRegle = {
  type: 'reglementaire',
  reference:
    'EN 16931-1 (modèle sémantique de la facture électronique) ; syntaxes UN/CEFACT CII et UBL 2.1 ; Factur-X 1.09.2 / ZUGFeRD 2.5.2 (FNFE-MPE, publiée le 4 août 2026, syntaxe CII D22B). ' +
    'Page fnfe-mpe.org consultée le 2026-11-19 ; le dossier de spécification (accès sur formulaire) et la norme EN 16931 (payante) n’ont PAS été consultés : ' +
    'les chemins d’éléments ont été recoupés avec les exemples officiels CEN/TC 434 (https://github.com/ConnectingEurope/eInvoicing-EN16931).',
  url: 'https://fnfe-mpe.org/factur-x/',
  dateVerification: null,
  verification: 'non_verifiee',
  periodeApplication: 'Factur-X 1.09.2 (août 2026) ; compatibilité avec les versions antérieures non testée.',
};

/**
 * Emplacement de l'ACHETEUR (BG-7 « Buyer » de la norme EN 16931) dans les deux syntaxes. Chemins vérifiés en ligne le
 * 2026-11-19 sur les règles Schematron et les exemples officiels du dépôt de validation CEN/TC 434, et recoupés avec
 * l'arbre UBL de Peppol BIS Billing 3.0 :
 *
 * | Terme | CII (sous rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty) | UBL 2.1 (sous cac:AccountingCustomerParty/cac:Party) |
 * | BT-44 nom | ram:Name (règle BR-07) | cac:PartyLegalEntity/cbc:RegistrationName (BR-07) |
 * | BT-45 nom commercial | ram:SpecifiedLegalOrganization/ram:TradingBusinessName | cac:PartyName/cbc:Name (UBL-SR-40) |
 * | BT-46 identifiant | ram:ID, ou ram:GlobalID avec @schemeID (CII-SR-450 : l'un ou l'autre) | cac:PartyIdentification/cbc:ID, @schemeID facultatif (UBL-SR-16) |
 * | BT-47 identifiant légal | ram:SpecifiedLegalOrganization/ram:ID, @schemeID facultatif (BR-AE-02) | cac:PartyLegalEntity/cbc:CompanyID, @schemeID facultatif (UBL-SR-17) |
 * | BT-48 n° de TVA | ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA'] (BR-IC-02) | cac:PartyTaxScheme[cac:TaxScheme/cbc:ID = 'VAT', casse indifférente]/cbc:CompanyID (UBL-SR-18) |
 * | BT-55 pays | ram:PostalTradeAddress/ram:CountryID (BR-11) | cac:PostalAddress/cac:Country/cbc:IdentificationCode (BR-11) |
 *
 * Codes ISO/IEC 6523 des schémas d'identifiant : 0002 = SIRENE (SIREN), 0009 = SIRET (liste de codes EN 16931 de la
 * Commission européenne, version 18). Un identifiant SANS @schemeID n'est jamais pris pour un SIREN ou un SIRET.
 */
export const SOURCE_FACTURE_ACHETEUR: SourceRegle = {
  type: 'reglementaire',
  reference:
    'EN 16931-1, groupe BG-7 « Buyer » (BT-44, BT-45, BT-46, BT-47, BT-48, BT-55), dans les syntaxes UN/CEFACT CII (ram:BuyerTradeParty) et UBL 2.1 (cac:AccountingCustomerParty). ' +
    'Lus le 2026-11-19 : règles Schematron et exemples du dépôt de validation CEN/TC 434 (https://github.com/ConnectingEurope/eInvoicing-EN16931, version validation-1.3.17 du 12 octobre 2026 : ' +
    'cii/schematron/CII/EN16931-CII-model.sch, ubl/schematron/UBL/EN16931-UBL-model.sch, cii/examples, ubl/examples) ; arbre UBL de Peppol BIS Billing 3.0, édition de mai 2026 ' +
    '(https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/) ; listes de codes EN 16931 de la Commission européenne, version 18 publiée le 12 octobre 2026 (ICD 0002 = SIRENE, 0009 = SIRET). ' +
    'NON consultés : le texte de la norme EN 16931 et les CEN/TS 16931-3-2 et 3-3 (payants) ; le dossier de spécification Factur-X 1.09.2 (FNFE-MPE, téléchargement sur formulaire) ; ' +
    'les spécifications externes de la facturation électronique de la DGFiP (impots.gouv.fr en maintenance le 2026-11-19, non vérifiées en ligne).',
  url: 'https://github.com/ConnectingEurope/eInvoicing-EN16931',
  dateVerification: '2026-11-19',
  verification: 'verifiee',
  periodeApplication: 'Artefacts de validation EN 16931 version 1.3.17 (octobre 2026) ; les chemins de l’acheteur sont stables depuis la version 1.0 des syntaxes CII D16B et UBL 2.1.',
};

export class ErreurDocumentXml extends Error {
  readonly code: 'TROP_VOLUMINEUX' | 'DOCTYPE_INTERDIT' | 'XML_INVALIDE' | 'RACINE_INATTENDUE';
  constructor(code: ErreurDocumentXml['code'], message: string) {
    super(message);
    this.name = 'ErreurDocumentXml';
    this.code = code;
  }
}

export type NoeudXml = Record<string, unknown>;
type Noeud = NoeudXml;

/**
 * Analyse XML sécurisée, commune aux factures et aux relevés bancaires : taille bornée,
 * DOCTYPE/ENTITY refusés avant analyse, profondeur bornée, aucune résolution d'entité externe.
 * Lève `ErreurDocumentXml`.
 */
export function analyserXmlSecurise(xml: string, tailleMax: number = TAILLE_MAX_XML_FACTURE): NoeudXml {
  if (typeof xml !== 'string') throw new ErreurDocumentXml('XML_INVALIDE', 'Document XML absent.');
  if (xml.length > tailleMax) {
    throw new ErreurDocumentXml('TROP_VOLUMINEUX', `Document XML de plus de ${tailleMax} caractères : refusé.`);
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) {
    throw new ErreurDocumentXml('DOCTYPE_INTERDIT', 'Déclaration DOCTYPE ou ENTITY interdite (protection contre les entités externes).');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new ErreurDocumentXml('XML_INVALIDE', 'Document XML mal formé.');
  const parseur = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Seules les entités prédéfinies (&amp; &lt; …) subsistent : tout DOCTYPE a été refusé plus haut.
    processEntities: true,
    htmlEntities: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    maxNestedTags: 64,
  });
  try {
    return parseur.parse(xml) as NoeudXml;
  } catch {
    throw new ErreurDocumentXml('XML_INVALIDE', 'Document XML illisible.');
  }
}

function analyser(xml: string): Noeud {
  return analyserXmlSecurise(xml);
}

export function liste(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Descend le long d'un chemin ; s'arrête (undefined) dès qu'un élément est répété ou absent. */
export function noeud(racine: unknown, ...chemin: string[]): unknown {
  let courant: unknown = racine;
  for (const nom of chemin) {
    if (courant === null || typeof courant !== 'object' || Array.isArray(courant)) return undefined;
    courant = (courant as Noeud)[nom];
  }
  return courant;
}

export function texte(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const t = (v as Noeud)['#text'];
    if (typeof t === 'string' && t.trim() !== '') return t.trim();
  }
  return null;
}

export function attribut(v: unknown, nom: string): string | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const a = (v as Noeud)[`@_${nom}`];
    if (typeof a === 'string') return a.trim();
  }
  return null;
}

function structure<T>(valeur: T, extrait: string): ChampExtrait<T> {
  return { valeur, page: null, extrait: extrait.slice(0, 300), boite: null, methode: 'structure', confiance: 'non_evaluee' };
}

function champTexte(v: unknown): ChampExtrait | null {
  const t = texte(v);
  return t === null ? null : structure(t.slice(0, 500), t);
}

/** Montant XML (xs:decimal) → chaîne décimale validée, ou null. */
function montant(v: unknown): string | null {
  const t = texte(v);
  if (t === null || !/^[+-]?\d{1,13}(\.\d{1,6})?$/.test(t)) return null;
  const d = new Decimal(t);
  const s = d.toFixed(Math.max(2, d.decimalPlaces()));
  return d.isZero() && s.startsWith('-') ? s.slice(1) : s;
}

function champMontant(v: unknown): ChampExtrait<string> | null {
  const m = montant(v);
  return m === null ? null : structure(m, texte(v) ?? m);
}

function taux(v: unknown): string | null {
  const t = texte(v);
  if (t === null || !/^\d{1,3}(\.\d{1,4})?$/.test(t)) return null;
  return new Decimal(t).toString();
}

const TYPES_AVOIR = new Set(['381', '261', '262', '296', '308', '396', '420', '458', '532']);
const TYPES_FACTURE = new Set(['380', '384', '386', '389', '326', '393', '751', '875', '876', '877']);

function typeDocument(code: string | null): ChampsFacture['typeDocument'] {
  if (code === null) return null;
  const valeur = TYPES_AVOIR.has(code) ? 'avoir' : TYPES_FACTURE.has(code) ? 'facture' : 'inconnu';
  return structure(valeur, code);
}

type Role = 'emetteur' | 'destinataire';

function identifiantsLegaux(champs: ChampsFacture, elements: unknown[], role: Role = 'emetteur'): void {
  for (const e of elements) {
    const valeur = texte(e)?.replace(/\s/g, '') ?? null;
    const schema = attribut(e, 'schemeID');
    if (valeur === null) continue;
    // ISO/IEC 6523 : 0002 = SIRENE (SIREN), 0009 = SIRET. Sans schéma déclaré, l'identifiant n'est pas interprété.
    if (schema === '0002' && /^\d{9}$/.test(valeur) && champs[`${role}Siren`] === null) champs[`${role}Siren`] = structure(valeur, valeur);
    else if ((schema === '0009' || schema === '0002') && /^\d{14}$/.test(valeur) && champs[`${role}Siret`] === null) champs[`${role}Siret`] = structure(valeur, valeur);
  }
}

function champPays(v: unknown): ChampExtrait | null {
  const t = texte(v)?.toUpperCase() ?? null;
  return t !== null && /^[A-Z]{2}$/.test(t) ? structure(t, t) : null;
}

/** Motif d'abstention quand le bloc acheteur ne donne aucun identifiant exploitable (jamais de déduction par le nom). */
function conclureDestinataire(champs: ChampsFacture, blocPresent: boolean): void {
  if (champs.destinataireSiren !== null || champs.destinataireSiret !== null || champs.destinataireTva !== null) return;
  champs.destinataireAbstention = !blocPresent
    ? 'Bloc acheteur absent du document structuré : destinataire non lu.'
    : 'Le bloc acheteur du document structuré ne porte ni SIREN ou SIRET déclaré comme tel (schéma 0002 ou 0009), ni numéro de TVA : destinataire non identifié.';
}

function dateCii(v: unknown): ChampExtrait | null {
  const chaine = noeud(v, 'DateTimeString');
  const t = texte(chaine);
  if (t === null) return null;
  const format = attribut(chaine, 'format');
  const iso = format === null || format === '102' ? isoDepuisCompact(t) : null;
  return iso === null ? null : structure(iso, t);
}

export function extraireChampsFacturX(xmlCii: string): ChampsFacture {
  const doc = analyser(xmlCii);
  const racine = doc['CrossIndustryInvoice'];
  if (racine === undefined || racine === null || typeof racine !== 'object' || Array.isArray(racine)) {
    throw new ErreurDocumentXml('RACINE_INATTENDUE', 'Élément racine CrossIndustryInvoice attendu.');
  }
  const champs = champsFactureVides();
  const entete = noeud(racine, 'ExchangedDocument');
  champs.typeDocument = typeDocument(texte(noeud(entete, 'TypeCode')));
  champs.numero = champTexte(noeud(entete, 'ID'));
  champs.dateEmission = dateCii(noeud(entete, 'IssueDateTime'));

  const transaction = noeud(racine, 'SupplyChainTradeTransaction');
  const vendeur = noeud(transaction, 'ApplicableHeaderTradeAgreement', 'SellerTradeParty');
  champs.emetteurNom = champTexte(noeud(vendeur, 'Name'));
  identifiantsLegaux(champs, liste(noeud(vendeur, 'SpecifiedLegalOrganization', 'ID')));
  for (const enr of liste(noeud(vendeur, 'SpecifiedTaxRegistration'))) {
    const id = noeud(enr, 'ID');
    if (attribut(id, 'schemeID') === 'VA' && champs.emetteurTva === null) {
      const v = texte(id)?.replace(/\s/g, '').toUpperCase() ?? null;
      if (v !== null) champs.emetteurTva = structure(v, texte(id) ?? v);
    }
  }

  // Acheteur (BG-7) : voir SOURCE_FACTURE_ACHETEUR pour les chemins et leur vérification.
  const acheteur = noeud(transaction, 'ApplicableHeaderTradeAgreement', 'BuyerTradeParty');
  champs.destinataireNom = champTexte(noeud(acheteur, 'Name'));
  identifiantsLegaux(champs, liste(noeud(acheteur, 'SpecifiedLegalOrganization', 'ID')), 'destinataire');
  identifiantsLegaux(champs, liste(noeud(acheteur, 'GlobalID')), 'destinataire');
  for (const enr of liste(noeud(acheteur, 'SpecifiedTaxRegistration'))) {
    const id = noeud(enr, 'ID');
    if (attribut(id, 'schemeID') === 'VA' && champs.destinataireTva === null) {
      const v = texte(id)?.replace(/\s/g, '').toUpperCase() ?? null;
      if (v !== null) champs.destinataireTva = structure(v, texte(id) ?? v);
    }
  }
  champs.destinatairePays = champPays(noeud(acheteur, 'PostalTradeAddress', 'CountryID'));
  conclureDestinataire(champs, acheteur !== undefined && acheteur !== null && typeof acheteur === 'object' && !Array.isArray(acheteur));

  const reglement = noeud(transaction, 'ApplicableHeaderTradeSettlement');
  const devise = texte(noeud(reglement, 'InvoiceCurrencyCode'));
  if (devise !== null && /^[A-Z]{3}$/.test(devise)) champs.devise = structure(devise, devise);
  for (const taxe of liste(noeud(reglement, 'ApplicableTradeTax'))) {
    const type = texte(noeud(taxe, 'TypeCode'));
    if (type !== null && type !== 'VAT') continue;
    const t = taux(noeud(taxe, 'RateApplicablePercent'));
    const base = montant(noeud(taxe, 'BasisAmount'));
    const m = montant(noeud(taxe, 'CalculatedAmount'));
    if (t !== null && base !== null && m !== null) champs.ventilationTva.push({ taux: t, base, montant: m });
  }
  for (const conditions of liste(noeud(reglement, 'SpecifiedTradePaymentTerms'))) {
    const d = dateCii(noeud(conditions, 'DueDateDateTime'));
    if (d !== null && champs.dateEcheance === null) champs.dateEcheance = d;
  }
  const totaux = noeud(reglement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  champs.totalHt = champMontant(noeud(totaux, 'TaxBasisTotalAmount'));
  champs.totalTtc = champMontant(noeud(totaux, 'GrandTotalAmount'));
  const totauxTva = liste(noeud(totaux, 'TaxTotalAmount'));
  const tvaDevise = totauxTva.filter((t) => attribut(t, 'currencyID') === null || attribut(t, 'currencyID') === devise);
  if (tvaDevise.length === 1) champs.totalTva = champMontant(tvaDevise[0]);
  return champs;
}

function dateUbl(v: unknown): ChampExtrait | null {
  const t = texte(v);
  if (t === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m || !dateCivileValide(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  const iso = versIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return estDateIso(iso) ? structure(iso, t) : null;
}

export function extraireChampsUbl(xmlUbl: string): ChampsFacture {
  const doc = analyser(xmlUbl);
  const estAvoir = doc['CreditNote'] !== undefined;
  const racine = estAvoir ? doc['CreditNote'] : doc['Invoice'];
  if (racine === undefined || racine === null || typeof racine !== 'object' || Array.isArray(racine)) {
    throw new ErreurDocumentXml('RACINE_INATTENDUE', 'Élément racine Invoice ou CreditNote (UBL 2.1) attendu.');
  }
  const champs = champsFactureVides();
  const code = texte(noeud(racine, estAvoir ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'));
  champs.typeDocument = code !== null ? typeDocument(code) : structure(estAvoir ? 'avoir' : 'facture', estAvoir ? 'CreditNote' : 'Invoice');
  champs.numero = champTexte(noeud(racine, 'ID'));
  champs.dateEmission = dateUbl(noeud(racine, 'IssueDate'));
  champs.dateEcheance = dateUbl(noeud(racine, 'DueDate'));
  if (champs.dateEcheance === null) {
    for (const moyen of liste(noeud(racine, 'PaymentMeans'))) {
      const d = dateUbl(noeud(moyen, 'PaymentDueDate'));
      if (d !== null && champs.dateEcheance === null) champs.dateEcheance = d;
    }
  }
  const devise = texte(noeud(racine, 'DocumentCurrencyCode'));
  if (devise !== null && /^[A-Z]{3}$/.test(devise)) champs.devise = structure(devise, devise);

  const partie = noeud(racine, 'AccountingSupplierParty', 'Party');
  const entitesLegales = liste(noeud(partie, 'PartyLegalEntity'));
  for (const entite of entitesLegales) {
    if (champs.emetteurNom === null) champs.emetteurNom = champTexte(noeud(entite, 'RegistrationName'));
    identifiantsLegaux(champs, liste(noeud(entite, 'CompanyID')));
  }
  if (champs.emetteurNom === null) {
    for (const nom of liste(noeud(partie, 'PartyName'))) {
      if (champs.emetteurNom === null) champs.emetteurNom = champTexte(noeud(nom, 'Name'));
    }
  }
  for (const ident of liste(noeud(partie, 'PartyIdentification'))) identifiantsLegaux(champs, liste(noeud(ident, 'ID')));
  for (const regime of liste(noeud(partie, 'PartyTaxScheme'))) {
    const schema = texte(noeud(regime, 'TaxScheme', 'ID'));
    const id = texte(noeud(regime, 'CompanyID'));
    if ((schema === null || schema.toUpperCase() === 'VAT') && id !== null && champs.emetteurTva === null) {
      champs.emetteurTva = structure(id.replace(/\s/g, '').toUpperCase(), id);
    }
  }

  // Acheteur (BG-7) : voir SOURCE_FACTURE_ACHETEUR pour les chemins et leur vérification.
  const client = noeud(racine, 'AccountingCustomerParty', 'Party');
  for (const entite of liste(noeud(client, 'PartyLegalEntity'))) {
    if (champs.destinataireNom === null) champs.destinataireNom = champTexte(noeud(entite, 'RegistrationName'));
    identifiantsLegaux(champs, liste(noeud(entite, 'CompanyID')), 'destinataire');
  }
  if (champs.destinataireNom === null) {
    for (const nom of liste(noeud(client, 'PartyName'))) {
      if (champs.destinataireNom === null) champs.destinataireNom = champTexte(noeud(nom, 'Name'));
    }
  }
  for (const ident of liste(noeud(client, 'PartyIdentification'))) identifiantsLegaux(champs, liste(noeud(ident, 'ID')), 'destinataire');
  for (const regime of liste(noeud(client, 'PartyTaxScheme'))) {
    const schema = texte(noeud(regime, 'TaxScheme', 'ID'));
    const id = texte(noeud(regime, 'CompanyID'));
    // BT-48 : seul le régime « VAT » (casse indifférente) désigne le numéro de TVA de l'acheteur.
    if (schema !== null && schema.toUpperCase() === 'VAT' && id !== null && champs.destinataireTva === null) {
      champs.destinataireTva = structure(id.replace(/\s/g, '').toUpperCase(), id);
    }
  }
  champs.destinatairePays = champPays(noeud(client, 'PostalAddress', 'Country', 'IdentificationCode'));
  conclureDestinataire(champs, client !== undefined && client !== null && typeof client === 'object' && !Array.isArray(client));

  const totauxTva = liste(noeud(racine, 'TaxTotal')).filter((t) => {
    const d = attribut(noeud(t, 'TaxAmount'), 'currencyID');
    return d === null || d === devise;
  });
  if (totauxTva.length === 1) {
    const total = totauxTva[0];
    champs.totalTva = champMontant(noeud(total, 'TaxAmount'));
    for (const sous of liste(noeud(total, 'TaxSubtotal'))) {
      const schema = texte(noeud(sous, 'TaxCategory', 'TaxScheme', 'ID'));
      if (schema !== null && schema.toUpperCase() !== 'VAT') continue;
      const t = taux(noeud(sous, 'TaxCategory', 'Percent'));
      const base = montant(noeud(sous, 'TaxableAmount'));
      const m = montant(noeud(sous, 'TaxAmount'));
      if (t !== null && base !== null && m !== null) champs.ventilationTva.push({ taux: t, base, montant: m });
    }
  }
  const totaux = noeud(racine, 'LegalMonetaryTotal');
  champs.totalHt = champMontant(noeud(totaux, 'TaxExclusiveAmount'));
  champs.totalTtc = champMontant(noeud(totaux, 'TaxInclusiveAmount'));
  return champs;
}
