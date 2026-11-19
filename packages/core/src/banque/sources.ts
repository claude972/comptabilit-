/** Sources des formats de relevés. Ce qui n'a pas pu être consulté est marqué `non_verifiee`. */
import type { SourceRegle } from '../controles/types.js';
import { sourceInterne } from '../sources.js';

/** Guide CFONB (profil français du camt.053.001.02), consulté intégralement le 2026-11-19. */
export const SOURCE_CAMT053_CFONB: SourceRegle = {
  type: 'reglementaire',
  reference:
    'CFONB, « Guide d’utilisation du standard ISO 20022 pour les relevés de compte – message camt.053.001.02 BankToCustomerStatement », version 1.3, novembre 2022 (statut : validé) : ' +
    '§ 2.5 structure (GroupHeader [1..1], Statement [1..n], Entry [0..n], EntryDetails, Batch, TransactionDetails) ; soldes OPBD (ancien solde) et CLBD (nouveau solde) avec sens CRDT/DBIT ; ' +
    'index 2.78 Amount, 2.79 CreditDebitIndicator, 2.80 ReversalIndicator, 2.81 Status « BOOK », 2.82 BookingDate, 2.83 ValueDate, 2.84 AccountServicerReference, 2.91 BankTransactionCode ; § 3.2.6.1 montants.',
  url: 'https://www.cfonb.org/sites/default/files/documents/Guide%20d%27utilisation%20ISO20022%20-%20Relev%C3%A9%20de%20compte%20-%20camt%20053%20-%20V%201.3%20-%2011%202022%20-%20Valid%C3%A9_0.pdf',
  dateVerification: '2026-11-19',
  verification: 'verifiee',
  periodeApplication: 'Version 1.3 de novembre 2022, fondée sur la version 02 (2009) du message ISO 20022 ; seule publication CFONB relative au camt.053 listée sur cfonb.org le 2026-11-19.',
};

/** Définitions ISO 20022 elles-mêmes : site inaccessible aux clients automatisés le 2026-11-19 (HTTP 403). */
export const SOURCE_CAMT053_ISO: SourceRegle = {
  type: 'reglementaire',
  reference:
    'ISO 20022, BankToCustomerStatement camt.053.001.03 à .08 (catalogue des définitions de messages, iso20022.org). NON CONSULTÉ : le site a répondu HTTP 403 le 2026-11-19. ' +
    'Les écarts connus entre versions pris en charge (BICFI au lieu de BIC, Sts/Cd au lieu de Sts, Amt et CdtDbtInd au niveau TxDtls, parties sous Pty) et la sémantique de RvslInd ' +
    '(le sens reste celui de CdtDbtInd) reposent sur la connaissance du format et sur le guide CFONB du camt.053.001.02, sans vérification sur les schémas officiels.',
  url: 'https://www.iso20022.org/iso-20022-message-definitions',
  dateVerification: null,
  verification: 'non_verifiee',
  periodeApplication: 'Versions .03 à .08 lues sans vérification sur la source officielle ; versions ultérieures lues et signalées comme non testées.',
};

/** Spécification OFX 2.3 (FDX), consultée le 2026-11-19. */
export const SOURCE_OFX: SourceRegle = {
  type: 'reglementaire',
  reference:
    'Financial Data Exchange (FDX), « OFX Banking Specification », version 2.3, octobre 2020 : § 2.2 et 2.8.2 (en-têtes OFXHEADER 100 et 200), § 3.2.3 (FITID unique dans le compte), ' +
    '§ 3.2.8.1 (dates AAAAMMJJHHMMSS.XXX [décalage:fuseau], champs omissibles par la droite), § 3.2.8 (montants : point ou virgule décimale, sans séparateur de milliers), ' +
    '§ 11.4.4.1 (STMTTRN : TRNTYPE, DTPOSTED, DTAVAIL, TRNAMT signé du point de vue du client, FITID, CHECKNUM, REFNUM, NAME, PAYEE, MEMO), LEDGERBAL (BALAMT, DTASOF).',
  url: 'https://financialdataexchange.org/wp-content/uploads/2025/12/OFX-Banking-Specification-v2.3.pdf',
  dateVerification: '2026-11-19',
  verification: 'verifiee',
  periodeApplication: 'OFX 2.3 (octobre 2020), version courante listée sur financialdataexchange.org/about-fdx/ofx-work-group/ le 2026-11-19.',
};

/** Syntaxe SGML des versions 1.x : archives listées par FDX mais non ouvertes. */
export const SOURCE_OFX_SGML: SourceRegle = {
  type: 'reglementaire',
  reference:
    'OFX 1.0.2 à 1.6 (syntaxe SGML, balises d’éléments non fermées). Les archives « OFX1.6.zip » et « ofx1.0.2spec.zip » sont listées sur la page du groupe de travail OFX de FDX mais n’ont PAS été ouvertes ; ' +
    'seul l’en-tête 1.x (OFXHEADER:100, DATA:OFXSGML, VERSION…) est décrit au § 2.8.2 de la spécification 2.3, qui a été consultée. Les éléments STMTTRN et LEDGERBAL sont lus comme en 2.x.',
  url: 'https://financialdataexchange.org/about-fdx/ofx-work-group/',
  dateVerification: null,
  verification: 'non_verifiee',
  periodeApplication: 'OFX 1.x (SGML) : lecture tolérante non vérifiée sur la spécification 1.6.',
};

export const SOURCE_CSV_BANQUE: SourceRegle = sourceInterne(
  'Aucun standard : export CSV propre à chaque banque, lu selon un profil de colonnes confirmé par un humain. Analyse des champs entre guillemets à la manière de la RFC 4180 (non consultée, convention interne).',
);
