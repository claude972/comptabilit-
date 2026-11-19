/**
 * Générateur de FEC SYNTHÉTIQUE pour la recette : entreprise fictive, écritures plausibles
 * et équilibrées (ventes, achats, banque, caisse, paie), déterministe pour une graine donnée.
 * Sans anomalie demandée, le fichier ne doit déclencher aucun constat des contrôles du catalogue.
 */
import { Buffer } from 'node:buffer';
import { Decimal } from 'decimal.js';
import iconv from 'iconv-lite';
import { compactDepuisIso, ecartEnJours, estDateIso, isoDepuisJours, joursDepuisEpoque } from '../dates.js';
import { validerSiren } from '../identifiants.js';
import { creerAlea } from './alea.js';

export type AnomalieSynthetique =
  | 'desequilibre' | 'rupture_sequence' | 'hors_exercice' | 'doublon' | 'caisse_crediteur' | 'attente_non_solde' | 'client_crediteur' | 'cca_debiteur';

export interface OptionsFecSynthetique {
  siren?: string;
  exercice: { debut: string; fin: string };
  nbEcritures: number;
  graine: number;
  anomalies?: AnomalieSynthetique[];
  format?: { separateur?: 'tabulation' | 'pipe'; encodage?: 'utf8' | 'latin9'; variante?: 'debit_credit' | 'montant_sens'; decimale?: ',' | '.' };
}

export interface AnomalieInjectee {
  type: string;
  description: string;
  ecritureNum: string;
  /** Journal de l'écriture concernée. */
  journalCode: string;
  /** Contrôle du catalogue censé la détecter. */
  controleAttendu: string;
  /** Montant attendu du constat (null si le contrôle ne chiffre pas). */
  montantAttendu: string | null;
}

export interface FecSynthetique {
  contenu: Uint8Array;
  nomFichier: string;
  anomaliesInjectees: AnomalieInjectee[];
  nbLignes: number;
}

/** SIREN fictif par défaut (clé de Luhn valide ; toute ressemblance avec une entité réelle serait fortuite). */
export const SIREN_SYNTHETIQUE = '123456782';

const JOURNAUX = { AN: 'À-nouveaux', VT: 'Ventes', AC: 'Achats', BQ: 'Banque', CA: 'Caisse', OD: 'Opérations diverses' } as const;
type Journal = keyof typeof JOURNAUX;

const COMPTES = {
  '10100000': 'Capital',
  '40100000': 'Fournisseurs',
  '41100000': 'Clients',
  '42100000': 'Personnel - Rémunérations dues',
  '43100000': 'Sécurité sociale',
  '44566000': 'TVA déductible sur autres biens et services',
  '44571000': 'TVA collectée',
  '45500000': 'Associés - Comptes courants',
  '47100000': 'Compte d\u0027attente',
  '51200000': 'Banque',
  '53100000': 'Caisse',
  '60600000': 'Achats non stockés de matières et fournitures',
  '60700000': 'Achats de marchandises',
  '61300000': 'Locations',
  '62700000': 'Services bancaires et assimilés',
  '64110000': 'Salaires et appointements',
  '64510000': 'Cotisations à l\u0027URSSAF',
  '70600000': 'Prestations de services',
  '70700000': 'Ventes de marchandises',
} as const;
type Compte = keyof typeof COMPTES;

interface LigneSynth {
  compte: Compte; aux: string | null; auxLib: string | null; lib: string; debit: Decimal; credit: Decimal; lettre: string | null; dateLet: string | null;
}
interface EcritureSynth { journal: Journal; date: string; piece: string; lignes: LigneSynth[]; nature: string; num: string }

const ZERO = new Decimal(0);
const euros = (centimes: number): Decimal => new Decimal(centimes).div(100);
const tvaSur = (ht: Decimal, taux: number): Decimal => ht.times(taux).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

function codeLettrage(n: number): string {
  let s = '';
  let reste = n;
  for (let i = 0; i < 4; i++) {
    s = String.fromCharCode(65 + (reste % 26)) + s;
    reste = Math.floor(reste / 26);
  }
  return s;
}

export function genererFecSynthetique(options: OptionsFecSynthetique): FecSynthetique {
  const { exercice, nbEcritures, graine } = options;
  if (!estDateIso(exercice.debut) || !estDateIso(exercice.fin) || exercice.fin <= exercice.debut) throw new Error('Exercice invalide.');
  if (!Number.isInteger(nbEcritures) || nbEcritures < 10) throw new Error('nbEcritures invalide : entier ≥ 10 attendu.');
  const siren = options.siren ?? SIREN_SYNTHETIQUE;
  if (!validerSiren(siren).valide) throw new Error('SIREN invalide.');
  const nbJours = ecartEnJours(exercice.debut, exercice.fin) + 1;
  if (nbJours < 120) throw new Error('Exercice trop court pour le générateur (120 jours minimum).');
  const alea = creerAlea(graine);
  const jour0 = joursDepuisEpoque(exercice.debut);
  const dateDuJour = (indice: number): string => isoDepuisJours(jour0 + indice);

  const ecritures: EcritureSynth[] = [];
  const compteurPiece: Record<string, number> = {};
  const piece = (prefixe: string): string => {
    compteurPiece[prefixe] = (compteurPiece[prefixe] ?? 0) + 1;
    return `${prefixe}-${String(compteurPiece[prefixe]).padStart(6, '0')}`;
  };
  const ligne = (compte: Compte, lib: string, debit: Decimal, credit: Decimal, aux: string | null = null, auxLib: string | null = null): LigneSynth =>
    ({ compte, aux, auxLib, lib, debit, credit, lettre: null, dateLet: null });
  const ajouter = (journal: Journal, date: string, pieceRef: string, nature: string, lignes: LigneSynth[]): EcritureSynth => {
    const e: EcritureSynth = { journal, date, piece: pieceRef, lignes, nature, num: '' };
    ecritures.push(e);
    return e;
  };

  let banque = ZERO;
  let caisse = ZERO;
  let cca = ZERO; // solde créditeur du compte courant d'associé
  let nbLettrages = 0;

  interface Reglement { type: 'client' | 'fournisseur' | 'paie'; montant: Decimal; aux: string | null; auxLib: string | null; origine: LigneSynth[]; piece: string; cotisations?: Decimal }
  const echeancier: Reglement[][] = [];
  const planifier = (jour: number, r: Reglement): void => {
    (echeancier[jour] ??= []).push(r);
  };
  let curseur = 0;
  const prochainRegelementDu = (jour: number): Reglement | null => {
    while (curseur <= jour) {
      const liste = echeancier[curseur];
      if (liste !== undefined && liste.length > 0) return liste[0] as Reglement;
      curseur++;
    }
    return null;
  };

  // Écriture d'ouverture (à-nouveaux).
  const capital = euros(4_000_000);
  const banqueInitiale = euros(5_000_000);
  const caisseInitiale = euros(200_000);
  cca = banqueInitiale.plus(caisseInitiale).minus(capital);
  banque = banqueInitiale;
  caisse = caisseInitiale;
  ajouter('AN', exercice.debut, piece('AN'), 'ouverture', [
    ligne('51200000', 'À-nouveaux banque', banqueInitiale, ZERO),
    ligne('53100000', 'À-nouveaux caisse', caisseInitiale, ZERO),
    ligne('10100000', 'À-nouveaux capital', ZERO, capital),
    ligne('45500000', 'À-nouveaux compte courant d\u0027associé', ZERO, cca),
  ]);

  const RESERVE_BANQUE = euros(100_000);
  for (let i = 1; i < nbEcritures; i++) {
    const jour = Math.floor((i * (nbJours - 1)) / (nbEcritures - 1));
    const date = dateDuJour(jour);
    const du = prochainRegelementDu(jour);
    if (du !== null) {
      const sortie = du.type !== 'client';
      const decaissement = du.montant.plus(du.cotisations ?? ZERO);
      if (sortie && banque.minus(decaissement).lessThan(RESERVE_BANQUE)) {
        const apport = decaissement.plus(euros(500_000)).toDecimalPlaces(0, Decimal.ROUND_UP);
        banque = banque.plus(apport);
        cca = cca.plus(apport);
        ajouter('BQ', date, piece('AP'), 'apport', [
          ligne('51200000', 'Apport en compte courant d\u0027associé', apport, ZERO),
          ligne('45500000', 'Apport en compte courant d\u0027associé', ZERO, apport),
        ]);
        continue;
      }
      (echeancier[curseur] as Reglement[]).shift();
      if (du.type === 'client') {
        banque = banque.plus(du.montant);
        const contrepartie = ligne('41100000', `Règlement reçu ${du.piece}`, ZERO, du.montant, du.aux, du.auxLib);
        const lettre = codeLettrage(nbLettrages++);
        for (const l of [...du.origine, contrepartie]) {
          l.lettre = lettre;
          l.dateLet = date;
        }
        ajouter('BQ', date, piece('RC'), 'encaissement', [ligne('51200000', `Règlement reçu ${du.piece}`, du.montant, ZERO), contrepartie]);
      } else if (du.type === 'fournisseur') {
        banque = banque.minus(du.montant);
        const contrepartie = ligne('40100000', `Règlement émis ${du.piece}`, du.montant, ZERO, du.aux, du.auxLib);
        const lettre = codeLettrage(nbLettrages++);
        for (const l of [...du.origine, contrepartie]) {
          l.lettre = lettre;
          l.dateLet = date;
        }
        ajouter('BQ', date, piece('RF'), 'decaissement', [contrepartie, ligne('51200000', `Règlement émis ${du.piece}`, ZERO, du.montant)]);
      } else {
        const cotisations = du.cotisations ?? ZERO;
        banque = banque.minus(decaissement);
        ajouter('BQ', date, piece('RP'), 'reglement_paie', [
          ligne('42100000', `Virement des salaires ${du.piece}`, du.montant, ZERO),
          ligne('43100000', `Règlement des cotisations ${du.piece}`, cotisations, ZERO),
          ligne('51200000', `Salaires et cotisations ${du.piece}`, ZERO, decaissement),
        ]);
      }
      continue;
    }

    let choix = alea.pondere([40, 30, 12, 6, 4, 8]);
    const depenseCaisse = euros(alea.entier(500, 12_000));
    if (choix === 3 && caisse.minus(depenseCaisse.times('1.2')).lessThan(euros(10_000))) choix = 2;
    if (choix === 4 && caisse.lessThan(euros(100_000))) choix = 2;
    if (choix === 0) {
      const taux = alea.entier(1, 5) === 1 ? 10 : 20;
      const ht = euros(alea.entier(20_000, 300_000));
      const tva = tvaSur(ht, taux);
      const client = alea.entier(1, 40);
      const aux = `C${String(client).padStart(4, '0')}`;
      const auxLib = `Client fictif ${client}`;
      const ref = piece('FA');
      const creance = ligne('41100000', `Facture ${ref}`, ht.plus(tva), ZERO, aux, auxLib);
      ajouter('VT', date, ref, 'vente', [
        creance,
        ligne(taux === 20 ? '70700000' : '70600000', `Facture ${ref}`, ZERO, ht),
        ligne('44571000', `TVA ${taux} % facture ${ref}`, ZERO, tva),
      ]);
      planifier(jour + alea.entier(5, 40), { type: 'client', montant: ht.plus(tva), aux, auxLib, origine: [creance], piece: ref });
    } else if (choix === 1) {
      const charge: Compte = (['60700000', '60600000', '61300000'] as const)[alea.entier(0, 2)] as Compte;
      const ht = euros(alea.entier(5_000, 120_000));
      const tva = tvaSur(ht, 20);
      const fournisseur = alea.entier(1, 25);
      const aux = `F${String(fournisseur).padStart(4, '0')}`;
      const auxLib = `Fournisseur fictif ${fournisseur}`;
      const ref = piece('FF');
      const dette = ligne('40100000', `Facture fournisseur ${ref}`, ZERO, ht.plus(tva), aux, auxLib);
      ajouter('AC', date, ref, 'achat', [
        ligne(charge, `Facture fournisseur ${ref}`, ht, ZERO),
        ligne('44566000', `TVA déductible ${ref}`, tva, ZERO),
        dette,
      ]);
      planifier(jour + alea.entier(5, 40), { type: 'fournisseur', montant: ht.plus(tva), aux, auxLib, origine: [dette], piece: ref });
    } else if (choix === 2) {
      const ht = euros(alea.entier(1_000, 40_000));
      const tva = tvaSur(ht, 20);
      const ref = piece('TC');
      caisse = caisse.plus(ht).plus(tva);
      ajouter('CA', date, ref, 'vente_comptoir', [
        ligne('53100000', `Recette de caisse ${ref}`, ht.plus(tva), ZERO),
        ligne('70700000', `Recette de caisse ${ref}`, ZERO, ht),
        ligne('44571000', `TVA 20 % recette ${ref}`, ZERO, tva),
      ]);
    } else if (choix === 3) {
      const tva = tvaSur(depenseCaisse, 20);
      const ref = piece('DC');
      caisse = caisse.minus(depenseCaisse).minus(tva);
      ajouter('CA', date, ref, 'depense_caisse', [
        ligne('60600000', `Petite dépense réglée en espèces ${ref}`, depenseCaisse, ZERO),
        ligne('44566000', `TVA déductible ${ref}`, tva, ZERO),
        ligne('53100000', `Petite dépense réglée en espèces ${ref}`, ZERO, depenseCaisse.plus(tva)),
      ]);
    } else if (choix === 4) {
      const remise = caisse.div(2).toDecimalPlaces(0, Decimal.ROUND_DOWN);
      const ref = piece('RE');
      caisse = caisse.minus(remise);
      banque = banque.plus(remise);
      ajouter('CA', date, ref, 'remise_especes', [
        ligne('51200000', `Remise d\u0027espèces en banque ${ref}`, remise, ZERO),
        ligne('53100000', `Remise d\u0027espèces en banque ${ref}`, ZERO, remise),
      ]);
    } else {
      const brut = euros(alea.entier(150_000, 250_000));
      const salariales = tvaSur(brut, 22);
      const patronales = tvaSur(brut, 42);
      const net = brut.minus(salariales);
      const ref = piece('PA');
      ajouter('OD', date, ref, 'paie', [
        ligne('64110000', `Salaires bruts ${ref}`, brut, ZERO),
        ligne('64510000', `Cotisations patronales ${ref}`, patronales, ZERO),
        ligne('42100000', `Salaires nets à payer ${ref}`, ZERO, net),
        ligne('43100000', `Cotisations sociales ${ref}`, ZERO, salariales.plus(patronales)),
      ]);
      planifier(jour + 1, { type: 'paie', montant: net, cotisations: salariales.plus(patronales), aux: null, auxLib: null, origine: [], piece: ref });
    }
  }

  // --- Injection d'anomalies --------------------------------------------------
  const demandees = [...new Set(options.anomalies ?? [])];
  const injectees: Array<Omit<AnomalieInjectee, 'ecritureNum' | 'journalCode'> & { ecriture: EcritureSynth }> = [];
  const milieu = dateDuJour(Math.floor(nbJours / 2));
  const total = (e: EcritureSynth): Decimal => e.lignes.reduce((s, l) => s.plus(l.debit), ZERO);
  let ruptureDemandee = false;
  for (const type of demandees) {
    if (type === 'desequilibre') {
      const ventes = ecritures.filter((e) => e.nature === 'vente');
      const cible = ventes[Math.floor(ventes.length / 2)];
      if (cible === undefined) throw new Error('Aucune vente à déséquilibrer : augmenter nbEcritures.');
      const produit = cible.lignes[1] as LigneSynth;
      produit.credit = produit.credit.plus('12.34');
      injectees.push({ type, description: 'Crédit du compte de produits majoré de 12,34 sans contrepartie.', ecriture: cible, controleAttendu: 'GEN-001', montantAttendu: '12.34' });
    } else if (type === 'rupture_sequence') {
      ruptureDemandee = true;
    } else if (type === 'hors_exercice') {
      const date = isoDepuisJours(joursDepuisEpoque(exercice.fin) + 5);
      const e = ajouter('BQ', date, piece('FB'), 'anomalie', [
        ligne('62700000', 'Frais bancaires', euros(4_500), ZERO),
        ligne('51200000', 'Frais bancaires', ZERO, euros(4_500)),
      ]);
      injectees.push({ type, description: `Écriture datée du ${date}, cinq jours après la clôture.`, ecriture: e, controleAttendu: 'GEN-003', montantAttendu: '45.00' });
    } else if (type === 'doublon') {
      const achats = ecritures.filter((e) => e.nature === 'achat');
      const modele = achats[achats.length - 1];
      if (modele === undefined) throw new Error('Aucun achat à dupliquer : augmenter nbEcritures.');
      const e = ajouter('AC', modele.date, modele.piece, 'anomalie', modele.lignes.map((l) => ({ ...l, lettre: null, dateLet: null })));
      injectees.push({ type, description: `Facture fournisseur ${modele.piece} saisie deux fois.`, ecriture: e, controleAttendu: 'GEN-004', montantAttendu: total(e).toFixed(2) });
    } else if (type === 'attente_non_solde') {
      const e = ajouter('OD', milieu, piece('OD'), 'anomalie', [
        ligne('47100000', 'Prélèvement non identifié', euros(25_000), ZERO),
        ligne('51200000', 'Prélèvement non identifié', ZERO, euros(25_000)),
      ]);
      injectees.push({ type, description: 'Prélèvement de 250,00 laissé en compte d\u0027attente 471.', ecriture: e, controleAttendu: 'GEN-005', montantAttendu: '250.00' });
    } else if (type === 'client_crediteur') {
      const date = isoDepuisJours(joursDepuisEpoque(exercice.fin) - 10);
      const e = ajouter('BQ', date, piece('RC'), 'anomalie', [
        ligne('51200000', 'Virement reçu sans facture', euros(48_000), ZERO),
        ligne('41100000', 'Virement reçu sans facture', ZERO, euros(48_000), 'C9001', 'Client fictif créditeur'),
      ]);
      injectees.push({ type, description: 'Encaissement de 480,00 sur un client sans facture : client créditeur.', ecriture: e, controleAttendu: 'TIE-001', montantAttendu: '480.00' });
    } else if (type === 'caisse_crediteur') {
      const retrait = caisse.plus(euros(32_100));
      const e = ajouter('CA', exercice.fin, piece('RE'), 'anomalie', [
        ligne('51200000', 'Remise d\u0027espèces en banque', retrait, ZERO),
        ligne('53100000', 'Remise d\u0027espèces en banque', ZERO, retrait),
      ]);
      caisse = caisse.minus(retrait);
      injectees.push({ type, description: 'Remise d\u0027espèces supérieure de 321,00 au solde de caisse.', ecriture: e, controleAttendu: 'TRE-001', montantAttendu: '321.00' });
    } else if (type === 'cca_debiteur') {
      const prelevement = cca.plus(euros(150_000));
      const e = ajouter('OD', exercice.fin, piece('OD'), 'anomalie', [
        ligne('45500000', 'Prélèvement de l\u0027associé', prelevement, ZERO),
        ligne('51200000', 'Prélèvement de l\u0027associé', ZERO, prelevement),
      ]);
      cca = cca.minus(prelevement);
      injectees.push({ type, description: 'Prélèvement de l\u0027associé rendant son compte courant débiteur de 1 500,00.', ecriture: e, controleAttendu: 'CAP-001', montantAttendu: '1500.00' });
    } else {
      throw new Error(`Anomalie inconnue : ${String(type)}`);
    }
  }

  // --- Numérotation par journal ------------------------------------------------
  const compteurs: Record<string, number> = {};
  const parJournal: Record<string, EcritureSynth[]> = {};
  for (const e of ecritures) (parJournal[e.journal] ??= []).push(e);
  let rupture: { journal: Journal; premiere: EcritureSynth } | null = null;
  if (ruptureDemandee) {
    const liste = parJournal['VT'] ?? [];
    const cible = liste[Math.floor(liste.length / 2)];
    if (cible === undefined || liste.length < 4) throw new Error('Trop peu de ventes pour créer une rupture de séquence : augmenter nbEcritures.');
    rupture = { journal: 'VT', premiere: cible };
  }
  for (const e of ecritures) {
    if (rupture !== null && rupture.premiere === e) compteurs[e.journal] = (compteurs[e.journal] ?? 0) + 1;
    compteurs[e.journal] = (compteurs[e.journal] ?? 0) + 1;
    e.num = `${e.journal}${String(compteurs[e.journal]).padStart(6, '0')}`;
  }
  const anomaliesInjectees: AnomalieInjectee[] = injectees.map(({ ecriture, ...reste }) => ({ ...reste, ecritureNum: ecriture.num, journalCode: ecriture.journal }));
  if (rupture !== null) {
    anomaliesInjectees.push({
      type: 'rupture_sequence',
      description: `Numéro manquant dans le journal ${rupture.journal} juste avant ${rupture.premiere.num}.`,
      ecritureNum: rupture.premiere.num,
      journalCode: rupture.journal,
      controleAttendu: 'GEN-002',
      montantAttendu: null,
    });
  }

  // --- Sérialisation -------------------------------------------------------------
  const format = options.format ?? {};
  const sep = format.separateur === 'pipe' ? '|' : '\t';
  const decimale = format.decimale ?? ',';
  const variante = format.variante ?? 'debit_credit';
  const montant = (d: Decimal): string => (decimale === ',' ? d.toFixed(2).replace('.', ',') : d.toFixed(2));
  const entetes = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib',
    ...(variante === 'debit_credit' ? ['Debit', 'Credit'] : ['Montant', 'Sens']), 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
  const sorties: string[] = [entetes.join(sep)];
  let nbLignes = 0;
  for (const e of ecritures) {
    const date = compactDepuisIso(e.date);
    for (const l of e.lignes) {
      const montants = variante === 'debit_credit'
        ? [montant(l.debit), montant(l.credit)]
        : l.debit.isZero() ? [montant(l.credit), 'C'] : [montant(l.debit), 'D'];
      sorties.push([
        e.journal, JOURNAUX[e.journal], e.num, date, l.compte, COMPTES[l.compte], l.aux ?? '', l.auxLib ?? '', e.piece, date, l.lib,
        ...montants, l.lettre ?? '', l.dateLet !== null ? compactDepuisIso(l.dateLet) : '', date, '', '',
      ].join(sep));
      nbLignes++;
    }
  }
  const texte = `${sorties.join('\r\n')}\r\n`;
  const contenu: Uint8Array = format.encodage === 'latin9' ? iconv.encode(texte, 'ISO-8859-15') : Buffer.from(texte, 'utf8');
  return { contenu, nomFichier: `${siren}FEC${compactDepuisIso(exercice.fin)}.txt`, anomaliesInjectees, nbLignes };
}
