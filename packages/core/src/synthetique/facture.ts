/**
 * Textes de factures SYNTHÉTIQUES (émetteur et client fictifs) pour tester l'extraction :
 * factures, avoirs, pièce insuffisante, pièce illisible, erreurs d'OCR (O/0, l/1).
 */
import { Decimal } from 'decimal.js';
import { isoDepuisJours, joursDepuisEpoque } from '../dates.js';
import type { PageTexte } from '../facture/types.js';
import { avecCleLuhn, creerAlea } from './alea.js';

export interface OptionsTexteFactureSynthetique {
  graine: number;
  type?: 'facture' | 'avoir';
  /** nette : texte propre ; ocr_degrade : SIRET et total TTC altérés (O/0, l/1) ; insuffisante : mentions essentielles absentes ; illisible : bruit. */
  qualite?: 'nette' | 'ocr_degrade' | 'insuffisante' | 'illisible';
  /** Texte libre ajouté en pied de page (ex. tentative d'injection d'instructions). */
  texteParasite?: string;
  /**
   * Présentation du client sur la pièce (défaut : `client`) :
   *  - client : bloc « Client : » avec nom, SIRET et adresse ;
   *  - facture_a : « Facturé à NOM », SIREN et numéro de TVA du client ;
   *  - livraison_seule : seul un bloc « Livré à : » (l'extraction doit s'abstenir) ;
   *  - absent : aucun bloc client.
   */
  client?: 'client' | 'facture_a' | 'livraison_seule' | 'absent';
}

export interface AttenduFactureSynthetique {
  typeDocument: 'facture' | 'avoir' | 'inconnu';
  numero: string | null;
  dateEmission: string | null;
  dateEcheance: string | null;
  emetteurNom: string | null;
  emetteurSiren: string | null;
  emetteurSiret: string | null;
  emetteurTva: string | null;
  destinataireNom: string | null;
  destinataireSiren: string | null;
  destinataireSiret: string | null;
  destinataireTva: string | null;
  destinatairePays: string | null;
  totalHt: string | null;
  totalTva: string | null;
  totalTtc: string | null;
  devise: string | null;
  ventilationTva: Array<{ taux: string; base: string; montant: string }>;
}

export interface TexteFactureSynthetique {
  pages: PageTexte[];
  /** Valeurs que l'extraction doit trouver ; null = l'extraction doit s'abstenir. */
  attendu: AttenduFactureSynthetique;
  description: string;
}

function montantFr(d: Decimal): string {
  const [entier = '0', decimales = '00'] = d.abs().toFixed(2).split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${d.isNegative() ? '-' : ''}${groupe},${decimales}`;
}

function dateFr(iso: string): string {
  const [a = '', m = '', j = ''] = iso.split('-');
  return `${j}/${m}/${a}`;
}

export function genererTexteFactureSynthetique(options: OptionsTexteFactureSynthetique): TexteFactureSynthetique {
  const alea = creerAlea(options.graine);
  const type = options.type ?? 'facture';
  const qualite = options.qualite ?? 'nette';
  const pied = options.texteParasite !== undefined ? [options.texteParasite] : [];

  const siren = avecCleLuhn(String(alea.entier(10_000_000, 99_999_999)));
  const siret = avecCleLuhn(`${siren}${String(alea.entier(1, 999)).padStart(4, '0')}`);
  const cle = (12 + 3 * (Number(siren) % 97)) % 97;
  const tva = `FR${String(cle).padStart(2, '0')}${siren}`;
  const sirenClient = avecCleLuhn(String(alea.entier(10_000_000, 99_999_999)));
  const siretClient = avecCleLuhn(`${sirenClient}0001`);
  const cleClient = (12 + 3 * (Number(sirenClient) % 97)) % 97;
  const tvaClient = `FR${String(cleClient).padStart(2, '0')}${sirenClient}`;
  const nomClient = 'SOCIETE CLIENTE FICTIVE SAS';
  const client = options.client ?? 'client';
  const nom = `ATELIER FICTIF ${String(alea.entier(1, 9999)).padStart(4, '0')} SARL`;
  const numero = `${type === 'avoir' ? 'AV' : 'FA'}-2026-${String(alea.entier(1, 9999)).padStart(4, '0')}`;
  const emission = isoDepuisJours(joursDepuisEpoque('2026-01-01') + alea.entier(0, 300));
  const echeance = isoDepuisJours(joursDepuisEpoque(emission) + 30);
  const signe = type === 'avoir' ? -1 : 1;
  const base20 = new Decimal(alea.entier(10_000, 500_000)).div(100).times(signe);
  const base10 = new Decimal(alea.entier(5_000, 90_000)).div(100).times(signe);
  const tva20 = base20.times(20).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const tva10 = base10.times(10).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const ht = base20.plus(base10);
  const totalTva = tva20.plus(tva10);
  const ttc = ht.plus(totalTva);
  const espace = (s: string): string => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}${s.length > 9 ? ` ${s.slice(9)}` : ''}`;

  if (qualite === 'illisible') {
    const bruit = ['~~ #@ l1l1 O0O0 ¤¤ %%', 'FACTVRE ??? n. ---', 'T0TAL ,,,, ;;;; ##', '|||| //// \\\\ ====', ...pied].join('\n');
    return {
      pages: [{ page: 1, texte: bruit }],
      attendu: { typeDocument: 'inconnu', numero: null, dateEmission: null, dateEcheance: null, emetteurNom: null, emetteurSiren: null, emetteurSiret: null, emetteurTva: null, destinataireNom: null, destinataireSiren: null, destinataireSiret: null, destinataireTva: null, destinatairePays: null, totalHt: null, totalTva: null, totalTtc: null, devise: null, ventilationTva: [] },
      description: 'Pièce illisible : bruit d’OCR, aucun champ exploitable.',
    };
  }
  if (qualite === 'insuffisante') {
    const texte = ['FACTURE', 'Merci de votre confiance.', `Total TTC : ${montantFr(ttc)} €`, ...pied].join('\n');
    return {
      pages: [{ page: 1, texte }],
      attendu: { typeDocument: 'facture', numero: null, dateEmission: null, dateEcheance: null, emetteurNom: null, emetteurSiren: null, emetteurSiret: null, emetteurTva: null, destinataireNom: null, destinataireSiren: null, destinataireSiret: null, destinataireTva: null, destinatairePays: null, totalHt: null, totalTva: null, totalTtc: ttc.toFixed(2), devise: 'EUR', ventilationTva: [] },
      description: 'Pièce insuffisante : ni numéro, ni date, ni émetteur identifiable, ni total HT.',
    };
  }

  const degrade = qualite === 'ocr_degrade';
  const ocr = (s: string): string => s.replaceAll('0', 'O').replaceAll('1', 'l');
  const titre = type === 'avoir' ? `AVOIR N° ${numero}` : `FACTURE N° ${numero}`;
  const lignes = [
    `${nom} au capital de 10 000 €`,
    "12 rue de l'Exemple - 75000 Paris",
    `SIRET : ${degrade ? ocr(espace(siret)) : espace(siret)} - RCS Paris ${espace(siren)}`,
    `N° TVA intracommunautaire : ${tva.slice(0, 2)} ${tva.slice(2, 4)} ${tva.slice(4)}`,
    '',
    ...(client === 'client'
      ? ['Client :', nomClient, `SIRET : ${espace(siretClient)}`, '3 avenue du Test - 69000 Lyon', '']
      : client === 'facture_a'
        ? [`Facturé à ${nomClient}`, '3 avenue du Test - 69000 Lyon', `SIREN : ${espace(sirenClient)}`, `N° TVA : ${tvaClient}`, '']
        : client === 'livraison_seule'
          ? ['Livré à :', nomClient, `SIRET : ${espace(siretClient)}`, '3 avenue du Test - 69000 Lyon', '']
          : []),
    titre,
    type === 'avoir' ? `Date de l'avoir : ${dateFr(emission)}` : `Date de facture : ${dateFr(emission)}`,
    ...(type === 'avoir' ? [] : [`Date d'échéance : ${dateFr(echeance)}`]),
    '',
    'Désignation                 Montant HT',
    `Prestation de service       ${montantFr(base20)}`,
    `Fourniture                  ${montantFr(base10)}`,
    '',
    `Total HT : ${montantFr(ht)} €`,
    `TVA 20 % sur ${montantFr(base20)} : ${montantFr(tva20)}`,
    `TVA 10 % sur ${montantFr(base10)} : ${montantFr(tva10)}`,
    `Total TVA : ${montantFr(totalTva)} €`,
    `Total TTC : ${degrade ? ocr(montantFr(ttc)) : montantFr(ttc)} €`,
    ...pied,
  ];
  const ttcAltere = degrade && /[01]/.test(montantFr(ttc));
  return {
    pages: [{ page: 1, texte: lignes.join('\n') }],
    attendu: {
      typeDocument: type,
      numero,
      dateEmission: emission,
      dateEcheance: type === 'avoir' ? null : echeance,
      emetteurNom: nom,
      emetteurSiren: siren,
      emetteurSiret: degrade && /[01]/.test(siret) ? null : siret,
      emetteurTva: tva,
      destinataireNom: client === 'client' || client === 'facture_a' ? nomClient : null,
      destinataireSiren: client === 'facture_a' ? sirenClient : null,
      destinataireSiret: client === 'client' ? siretClient : null,
      destinataireTva: client === 'facture_a' ? tvaClient : null,
      destinatairePays: null,
      totalHt: ht.toFixed(2),
      totalTva: totalTva.toFixed(2),
      totalTtc: ttcAltere ? null : ttc.toFixed(2),
      devise: 'EUR',
      ventilationTva: [
        { taux: '20', base: base20.toFixed(2), montant: tva20.toFixed(2) },
        { taux: '10', base: base10.toFixed(2), montant: tva10.toFixed(2) },
      ],
    },
    description: degrade ? 'Facture avec erreurs d’OCR (O pour 0, l pour 1) sur le SIRET et le total TTC.' : `${type === 'avoir' ? 'Avoir' : 'Facture'} synthétique nette.`,
  };
}
