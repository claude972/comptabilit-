/**
 * Extraction DÉTERMINISTE de champs de facture à partir de texte (OCR ou couche texte PDF).
 * Règles et expressions régulières uniquement, sans IA. Principe : s'abstenir (null)
 * plutôt que deviner — un libellé présent suivi d'une valeur douteuse (erreur d'OCR,
 * candidats contradictoires) donne null.
 *
 * Le texte d'une pièce est un CONTENU NON FIABLE : il est seulement parcouru par des
 * expressions régulières fixes ; aucune phrase qu'il contient ne modifie le comportement.
 */
import { Decimal } from 'decimal.js';
import { dateCivileValide, versIso } from '../dates.js';
import { sirenDeTvaFr } from '../identifiants.js';
import { analyserMontantFr, versChaine } from '../montant.js';
import { champsFactureVides } from './types.js';
import type { ChampExtrait, ChampsFacture, PageTexte } from './types.js';

/** Bornes de traitement (contenu non fiable) : au-delà, le reste est ignoré. */
const MAX_LIGNES = 20_000;
const MAX_LONGUEUR_LIGNE = 2_000;

interface Ligne { page: number; texte: string; boite: [number, number, number, number] | null; zoneClient: boolean; index: number }

const MOIS: Readonly<Record<string, number>> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const D_NUM = String.raw`\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}`;
const D_ISO = String.raw`\d{4}-\d{2}-\d{2}`;
const D_TXT = String.raw`(?:\d{1,2}|1er)\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4}`;
const DATE = `(${D_ISO}|${D_NUM}|${D_TXT})(?![\\d/.\\-])`;
const MONTANT = String.raw`-?(?:\d{1,3}(?:[   ]\d{3})+|\d+)[.,]\d{2}`;
const TAUX = String.raw`\d{1,2}(?:[.,]\d{1,2})?`;
const APO = String.raw`['’]`;

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function lireDate(jeton: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jeton);
  if (m) return dateCivileValide(Number(m[1]), Number(m[2]), Number(m[3])) ? versIso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(jeton);
  if (m) return dateCivileValide(Number(m[3]), Number(m[2]), Number(m[1])) ? versIso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
  m = /^(\d{1,2}|1er)\s+(\S+)\s+(\d{4})$/i.exec(jeton);
  if (m) {
    const jour = m[1]?.toLowerCase() === '1er' ? 1 : Number(m[1]);
    const mois = MOIS[sansAccents((m[2] ?? '').toLowerCase())];
    if (mois !== undefined && dateCivileValide(Number(m[3]), mois, jour)) return versIso(Number(m[3]), mois, jour);
  }
  return null;
}

function preparer(pages: PageTexte[]): Ligne[] {
  const lignes: Ligne[] = [];
  // Fin de repère : « \b » ne reconnaît pas de frontière après une lettre accentuée (« à ») ; d'où l'alternative explicite.
  const MARQUE_CLIENT = new RegExp(String.raw`^\s*(?:client|destinataire|acheteur|factur[ée]e?\s+[àa]|adress[ée]e?\s+[àa]|livr[ée]e?\s+[àa]|adresse\s+de\s+(?:facturation|livraison))(?:\b|(?=[\s:]|$))`, 'i');
  const MARQUE_EMETTEUR = /^\s*(?:[ée]metteur|vendeur|fournisseur|exp[ée]diteur)\b/i;
  let resteZoneClient = 0;
  for (const p of pages) {
    if (p === null || typeof p !== 'object') continue;
    const brutes: Array<{ texte: string; boite: [number, number, number, number] | null }> =
      Array.isArray(p.lignes) && p.lignes.length > 0
        ? p.lignes.map((l) => ({ texte: String(l?.texte ?? ''), boite: l?.boite ?? null }))
        : String(p.texte ?? '').split(/\r\n|\r|\n/).map((t) => ({ texte: t, boite: null }));
    resteZoneClient = 0;
    for (const b of brutes) {
      if (lignes.length >= MAX_LIGNES) return lignes;
      const texte = b.texte.replace(/[    ]/g, ' ').slice(0, MAX_LONGUEUR_LIGNE);
      if (texte.trim() === '') continue;
      if (MARQUE_EMETTEUR.test(texte)) resteZoneClient = 0;
      else if (MARQUE_CLIENT.test(texte)) resteZoneClient = 5;
      // Un identifiant explicitement attribué au client (« SIRET client : … ») n'est jamais un candidat pour l'émetteur.
      lignes.push({ page: Number.isInteger(p.page) ? p.page : 0, texte, boite: b.boite, zoneClient: resteZoneClient > 0 || IDENTIFIANT_CLIENT.test(texte), index: lignes.length });
      if (resteZoneClient > 0) resteZoneClient--;
    }
  }
  return lignes;
}

/** Étiquette d'identifiant attribuée EXPLICITEMENT au client : « SIRET client », « N° TVA du destinataire », « SIREN de l'acheteur ». */
const IDENTIFIANT_CLIENT = new RegExp(
  String.raw`\b(?:SIRE[NT]|T\.?V\.?A\.?(?:\s+intra(?:communautaire|com)?\.?)?|VAT(?:\s+number)?)\s+(?:du\s+|de\s+l${APO}\s*)?(?:client|destinataire|acheteur)\b`,
  'i',
);

function champ<T>(valeur: T, ligne: Ligne): ChampExtrait<T> {
  return { valeur, page: ligne.page, extrait: ligne.texte.trim().slice(0, 300), boite: ligne.boite, methode: 'regle', confiance: 'non_evaluee' };
}

interface Candidat<T> { valeur: T; cle: string; ligne: Ligne }

/** Retient la valeur s'il n'y a qu'UNE valeur distincte parmi les candidats ; sinon s'abstient. */
function unique<T>(candidats: Array<Candidat<T>>): ChampExtrait<T> | null {
  const premier = candidats[0];
  if (premier === undefined) return null;
  if (candidats.some((c) => c.cle !== premier.cle)) return null;
  return champ(premier.valeur, premier.ligne);
}

function chercher(lignes: Ligne[], motif: RegExp): Array<{ m: RegExpExecArray; ligne: Ligne }> {
  const trouves: Array<{ m: RegExpExecArray; ligne: Ligne }> = [];
  const global = new RegExp(motif.source, motif.flags.includes('g') ? motif.flags : `${motif.flags}g`);
  for (const ligne of lignes) {
    global.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = global.exec(ligne.texte)) !== null) {
      trouves.push({ m, ligne });
      if (m[0] === '') global.lastIndex++;
    }
  }
  return trouves;
}

const compact = (s: string): string => s.replace(/[ .]/g, '');

/** null = illisible ; 'vide' = rien après l'étiquette (titre de colonne) ; sinon le montant. */
function montantStrict(reste: string): Decimal | null | 'vide' {
  let r = reste.replace(/^\s*\(?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%\s*\)?/, '');
  r = r.replace(/^[\s:=.]+/, '').replace(/\(?\s*en\s+euros?\s*\)?/i, '');
  const coupe = /\b(?:total|montant|sous[- ]total|net\s+[àa]\s+payer|t\.?v\.?a\.?)\b/i.exec(r);
  if (coupe) r = r.slice(0, coupe.index);
  r = r.replace(/[\s:=|]+$/, '').trim();
  if (r === '') return 'vide';
  return analyserMontantFr(r);
}

function candidatsMontant(lignes: Ligne[], etiquette: RegExp): Array<Candidat<string>> {
  const resultat: Array<Candidat<string>> = [];
  for (const { m, ligne } of chercher(lignes, etiquette)) {
    const d = montantStrict(ligne.texte.slice(m.index + m[0].length));
    if (d === 'vide') continue;
    // Étiquette présente mais valeur illisible : candidat « vide » qui force l'abstention.
    resultat.push(d === null ? { valeur: '', cle: `illisible:${ligne.index}`, ligne } : { valeur: versChaine(d, Math.max(2, d.decimalPlaces())), cle: d.toString(), ligne });
  }
  return resultat;
}

function montantUnique(candidats: Array<Candidat<string>>): ChampExtrait<string> | null {
  const c = unique(candidats);
  return c === null || c.valeur === '' ? null : c;
}

export function extraireChampsFacture(pages: PageTexte[]): ChampsFacture {
  const champs = champsFactureVides();
  if (!Array.isArray(pages)) return champs;
  const lignes = preparer(pages);
  if (lignes.length === 0) return champs;

  // --- Type de document ------------------------------------------------------
  const ligneAvoir = lignes.find((l) => new RegExp(String.raw`^\s*(?:facture\s+d${APO}avoir|avoir|note\s+de\s+cr[ée]dit)\b|\bavoir\s+n[°ºo]`, 'i').test(l.texte));
  const ligneFacture = lignes.find((l) => /\bfacture\b/i.test(l.texte));
  if (ligneAvoir) champs.typeDocument = champ('avoir', ligneAvoir);
  else if (ligneFacture) champs.typeDocument = champ('facture', ligneFacture);
  else champs.typeDocument = { valeur: 'inconnu', page: null, extrait: null, boite: null, methode: 'regle', confiance: 'non_evaluee' };
  const estAvoir = champs.typeDocument.valeur === 'avoir';

  // --- Numéro ----------------------------------------------------------------
  const NUM = String.raw`([A-Z0-9][A-Z0-9\-_/.]{0,39})`;
  const motifsNumero = [
    new RegExp(String.raw`\b(facture\s+d${APO}avoir|facture|avoir)\s+(?:n[°ºo]\.?|num[ée]ro|#)\s*:?\s*${NUM}`, 'i'),
    new RegExp(String.raw`(?:\bn[°ºo]\.?|\bnum[ée]ro)\s*(?:de\s+(?:la\s+)?|d${APO})?(facture|avoir)\s*:?\s*${NUM}`, 'i'),
  ];
  const candidatsNumero: Array<Candidat<string> & { nature: string }> = [];
  for (const motif of motifsNumero) {
    for (const { m, ligne } of chercher(lignes, motif)) {
      const valeur = (m[2] ?? '').replace(/[.\-_/]+$/, '');
      if (valeur.length < 2 || !/\d/.test(valeur)) continue;
      candidatsNumero.push({ valeur, cle: valeur.toUpperCase(), ligne, nature: /avoir/i.test(m[1] ?? '') ? 'avoir' : 'facture' });
    }
  }
  const natureVoulue = estAvoir ? 'avoir' : 'facture';
  const duBonType = candidatsNumero.filter((c) => c.nature === natureVoulue);
  champs.numero = unique(duBonType.length > 0 ? duBonType : candidatsNumero);

  // --- Dates -----------------------------------------------------------------
  const dateDepuis = (motifs: RegExp[]): ChampExtrait | null => {
    const candidats: Array<Candidat<string>> = [];
    for (const motif of motifs) {
      for (const { m, ligne } of chercher(lignes, motif)) {
        const iso = lireDate(m[1] ?? '');
        candidats.push(iso === null ? { valeur: '', cle: `illisible:${ligne.index}`, ligne } : { valeur: iso, cle: iso, ligne });
      }
    }
    const c = unique(candidats);
    return c === null || c.valeur === '' ? null : c;
  };
  champs.dateEmission = dateDepuis([
    new RegExp(String.raw`\bdate\s+(?:de\s+(?:la\s+)?(?:facture|facturation)|de\s+l${APO}avoir|d${APO}[ée]mission)\s*:?\s*${DATE}`, 'i'),
    new RegExp(String.raw`\b[ée]mise?\s+le\s*:?\s*${DATE}`, 'i'),
    new RegExp(String.raw`\b(?:facture|avoir)\s+(?:n[°ºo]\.?\s*\S+\s+)?du\s+${DATE}`, 'i'),
    new RegExp(String.raw`^\s*date\s*:?\s*${DATE}`, 'i'),
  ]);
  champs.dateEcheance = dateDepuis([
    new RegExp(String.raw`[ée]ch[ée]ance\s*(?:le|au)?\s*:?\s*${DATE}`, 'i'),
    new RegExp(String.raw`\bdate\s+limite\s+de\s+(?:paiement|r[èe]glement)\s*:?\s*${DATE}`, 'i'),
    new RegExp(String.raw`\b[àa]\s+(?:payer|r[ée]gler)\s+avant\s+le\s*:?\s*${DATE}`, 'i'),
    new RegExp(String.raw`\bpayable\s+le\s*:?\s*${DATE}`, 'i'),
  ]);

  // --- Identifiants de l'émetteur -------------------------------------------
  const horsClient = lignes.filter((l) => !l.zoneClient);
  const identifiant = (motif: RegExp, transformer: (m: RegExpExecArray) => string): ChampExtrait | null =>
    unique(chercher(horsClient, motif).map(({ m, ligne }) => {
      const valeur = transformer(m);
      return { valeur, cle: valeur, ligne };
    }));
  champs.emetteurSiret = identifiant(/\bSIRET\b\s*(?:n[°ºo]\.?\s*)?:?\s*((?:\d[ .]?){13}\d)(?![ .]?[\dA-Za-z])/i, (m) => compact(m[1] ?? ''));
  const candidatsSiren = [
    ...chercher(horsClient, /\bSIREN\b\s*(?:n[°ºo]\.?\s*)?:?\s*((?:\d[ .]?){8}\d)(?![ .]?[\dA-Za-z])/i),
    ...chercher(horsClient, /\bR\.?C\.?S\.?\s+[A-Za-zÀ-ÿ' \-]{2,40}?\s+(?:[AB]\s+)?((?:\d[ ]?){8}\d)(?![ ]?\d)/),
  ].map(({ m, ligne }) => ({ valeur: compact(m[1] ?? ''), cle: compact(m[1] ?? ''), ligne }));
  champs.emetteurSiren = unique(candidatsSiren);
  const lignesTva = horsClient.filter((l) => /T\.?V\.?A|VAT|intracom/i.test(l.texte) && !/\bIBAN\b/i.test(l.texte));
  champs.emetteurTva = unique(
    chercher(lignesTva, /\bFR[ ]?([0-9A-Z]{2})[ ]?((?:\d[ ]?){8}\d)(?![ ]?[\dA-Za-z])/).map(({ m, ligne }) => {
      const valeur = `FR${m[1] ?? ''}${compact(m[2] ?? '')}`;
      return { valeur, cle: valeur, ligne };
    }),
  );

  // --- Nom de l'émetteur -----------------------------------------------------
  const etiquetteNom = chercher(horsClient, /^\s*(?:[ée]metteur|vendeur|fournisseur|raison\s+sociale|soci[ée]t[ée])\s*:\s*(\S.{1,118})$/i).map(({ m, ligne }) => {
    const valeur = (m[1] ?? '').trim();
    return { valeur, cle: valeur.toUpperCase(), ligne };
  });
  if (etiquetteNom.length > 0) {
    champs.emetteurNom = unique(etiquetteNom);
  } else {
    const premierePage = lignes[0]?.page;
    const enTete = lignes.filter((l) => l.page === premierePage).slice(0, 8).filter((l) => !l.zoneClient);
    const formes = enTete
      .filter((l) => /(?:^|\s)(?:SARL|SAS|SASU|EURL|SA|SCI|SNC|SELARL|SCOP)(?:\s|$|,)/.test(l.texte) && l.texte.trim().length <= 120)
      .map((ligne) => {
        const valeur = ligne.texte.replace(/\s+au\s+capital\b.*$/i, '').replace(/\s{2,}/g, ' ').trim();
        return { valeur, cle: valeur.toUpperCase(), ligne };
      });
    champs.emetteurNom = formes.length === 1 ? unique(formes) : null;
  }

  // --- Destinataire ----------------------------------------------------------
  extraireDestinataire(lignes, champs);

  // --- Totaux ----------------------------------------------------------------
  champs.totalHt = montantUnique(candidatsMontant(lignes, /\b(?:total|montant|sous[- ]total)\s+(?:net\s+)?(?:H\.?T\.?(?![A-Za-z])|hors\s+taxes?)/i));
  const candidatsTtc = candidatsMontant(lignes, /\b(?:total|montant)\s+(?:net\s+)?T\.?T\.?C\.?(?![A-Za-z])/i);
  champs.totalTtc = candidatsTtc.length > 0 ? montantUnique(candidatsTtc) : montantUnique(candidatsMontant(lignes, /\bnet\s+[àa]\s+payer(?:\s+T\.?T\.?C\.?)?/i));

  // --- TVA : ventilation et total -------------------------------------------
  const ETIQUETTE_TOTAL_TVA = /\b(?:total|montant)\s+(?:de\s+(?:la\s+)?)?T\.?V\.?A\.?(?![A-Za-z])/i;
  const lignesHorsTotalTva = lignes.filter((l) => !ETIQUETTE_TOTAL_TVA.test(l.texte));
  const V1 = new RegExp(String.raw`T\.?V\.?A\.?\s*(?:[àa]|au\s+taux\s+de)?\s*(${TAUX})\s*%\s*(?:sur|base(?:\s+H\.?T\.?)?)?\s*:?\s*(${MONTANT})\s*(?:€|EUR)?\s*[:=]?\s*(${MONTANT})\s*(?:€|EUR)?\s*$`, 'i');
  const V2 = new RegExp(String.raw`T\.?V\.?A\.?\s*(?:[àa]|au\s+taux\s+de)?\s*\(?\s*(${TAUX})\s*%\s*\)?\s*:?\s*(${MONTANT})\s*(?:€|EUR)?\s*$`, 'i');
  const lignesTauxSeul: Array<Candidat<string>> = [];
  let nbLignesTaux = 0;
  for (const ligne of lignesHorsTotalTva) {
    const v1 = V1.exec(ligne.texte);
    if (v1) {
      const taux = analyserMontantFr(v1[1] ?? '');
      const base = analyserMontantFr(v1[2] ?? '');
      const montant = analyserMontantFr(v1[3] ?? '');
      nbLignesTaux++;
      if (taux !== null && base !== null && montant !== null) {
        champs.ventilationTva.push({ taux: taux.toString(), base: versChaine(base), montant: versChaine(montant) });
        lignesTauxSeul.push({ valeur: versChaine(montant), cle: montant.toString(), ligne });
      }
      continue;
    }
    const v2 = V2.exec(ligne.texte);
    if (v2) {
      nbLignesTaux++;
      const montant = analyserMontantFr(v2[2] ?? '');
      if (montant !== null) lignesTauxSeul.push({ valeur: versChaine(montant), cle: montant.toString(), ligne });
    }
  }
  const candidatsTotalTva = candidatsMontant(lignes, ETIQUETTE_TOTAL_TVA);
  if (candidatsTotalTva.length > 0) champs.totalTva = montantUnique(candidatsTotalTva);
  else if (nbLignesTaux === 1 && lignesTauxSeul.length === 1) champs.totalTva = unique(lignesTauxSeul);

  // --- Devise ----------------------------------------------------------------
  const ligneEuro = lignes.find((l) => /€|\bEUR(?:OS?)?\b/i.test(l.texte));
  const autres = chercher(lignes, /\b(USD|GBP|CHF|CAD|JPY)\b|(\$|£)/);
  if (ligneEuro && autres.length === 0) champs.devise = champ('EUR', ligneEuro);
  else if (!ligneEuro && autres.length > 0) {
    const codes = autres.map(({ m, ligne }) => {
      const code = m[1] ?? (m[2] === '$' ? 'USD' : 'GBP');
      return { valeur: code, cle: code, ligne };
    });
    // « $ » peut désigner plusieurs monnaies : on ne retient qu'un code ISO explicite.
    champs.devise = codes.every((c) => /^[A-Z]{3}$/.test(c.valeur)) && autres.every(({ m }) => m[1] !== undefined) ? unique(codes) : null;
  }

  return champs;
}

// ── Destinataire (client facturé) ────────────────────────────────────────────────────────────────────────────────────
// Règles INTERNES, prudentes : le destinataire n'est retenu que dans une zone ouverte par un repère explicite de
// FACTURATION, ou sur une ligne dont l'étiquette l'attribue expressément au client. La seule position d'un identifiant
// sur la page ne suffit jamais. Au moindre doute : abstention, avec son motif.

/** Repère de facturation seul sur sa ligne ou suivi de « : » (« Client », « Destinataire », « Acheteur »). */
const REPERE_NOM = /^\s*(?:client(?:\s+factur[ée]e?)?|destinataire|acheteur)\s*(?::\s*(.*))?$/i;
/** Repère de facturation pouvant être suivi directement du nom (« Facturé à DUPONT SAS »). */
const REPERE_A = /^\s*(?:factur[ée]e?\s+(?:et\s+livr[ée]e?\s+)?[àa]|adress[ée]e?\s+[àa]|adresse\s+de\s+facturation)\s*:?\s*(.*)$/i;
/** Repère de LIVRAISON : le lieu ou le destinataire de la livraison n'est pas nécessairement le client facturé. */
const REPERE_LIVRAISON = /^\s*(?:livr[ée]e?\s+[àa]|(?:adresse|lieu)\s+de\s+livraison|destinataire\s+de\s+la\s+livraison)(?=[\s:]|$)/i;
const REPERE_EMETTEUR = /^\s*(?:[ée]metteur|vendeur|fournisseur|exp[ée]diteur)\b/i;
/** Lignes qui ferment une zone de destinataire : le corps de la pièce commence. */
const FIN_ZONE = new RegExp(String.raw`^\s*(?:facture|avoir|note\s+de\s+cr[ée]dit|date|d[ée]signation|total|montant|r[èe]glement|[ée]ch[ée]ance|conditions|objet|r[ée]f[ée]rence)\b`, 'i');
const LIGNES_ZONE_MAX = 5;
const PAS_UN_NOM = /SIRE[NT]|T\.?V\.?A\b|\bVAT\b|\bR\.?C\.?S\b|\bIBAN\b|\bBIC\b|\bt[ée]l\b|\bfax\b|e-?mail|@|www\.|https?:|\bcedex\b|\b\d{5}\b/i;
const PAYS_UE = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

const MOTIFS_DESTINATAIRE = {
  aucunRepere: 'Aucun repère de destinataire sur la pièce (« Client », « Facturé à », « Destinataire », « Adresse de facturation ») : destinataire non lu.',
  livraisonSeule: 'Seul un repère de livraison (« Livré à », « Adresse de livraison ») figure sur la pièce : le destinataire d’une livraison n’est pas nécessairement le client facturé.',
  aucunIdentifiant: 'Aucun SIREN, SIRET ni numéro de TVA lisible dans la zone du destinataire.',
  plusieurs: 'Plusieurs identifiants différents sont attribuables au destinataire : aucun n’est retenu.',
  emetteurInconnu: 'L’identifiant lu dans la zone du destinataire est le seul de la pièce attribuable avec certitude : faute d’identifiant de l’émetteur distinct, il n’est pas retenu.',
  identiqueEmetteur: 'L’identifiant lu dans la zone du destinataire est celui de l’émetteur : il n’est pas retenu.',
} as const;

function nomPlausible(brut: string): string | null {
  const t = brut.replace(/\s{2,}/g, ' ').replace(/^[\s:;,.\-–—]+|[\s:;,\-–—]+$/g, '');
  if (t.length < 3 || t.length > 120 || /^\d/.test(t) || PAS_UN_NOM.test(t)) return null;
  return (t.match(/\p{L}/gu) ?? []).length >= 3 ? t : null;
}

const cleNom = (v: string): string => sansAccents(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function identifiantsDe(lignes: Ligne[]): { siret: Array<Candidat<string>>; siren: Array<Candidat<string>>; tva: Array<Candidat<string>> } {
  const versCandidat = (valeur: string, ligne: Ligne): Candidat<string> => ({ valeur, cle: valeur, ligne });
  const siret = chercher(lignes, /\bSIRET\b[^:\d]{0,30}:?\s*((?:\d[ .]?){13}\d)(?![ .]?[\dA-Za-z])/i).map(({ m, ligne }) => versCandidat(compact(m[1] ?? ''), ligne));
  const siren = [
    ...chercher(lignes, /\bSIREN\b[^:\d]{0,30}:?\s*((?:\d[ .]?){8}\d)(?![ .]?[\dA-Za-z])/i),
    ...chercher(lignes, /\bR\.?C\.?S\.?\s+[A-Za-zÀ-ÿ' \-]{2,40}?\s+(?:[AB]\s+)?((?:\d[ ]?){8}\d)(?![ ]?\d)/),
  ].map(({ m, ligne }) => versCandidat(compact(m[1] ?? ''), ligne));
  const lignesTva = lignes.filter((l) => /T\.?V\.?A|VAT|intracom/i.test(l.texte) && !/\bIBAN\b/i.test(l.texte));
  const tva = [
    ...chercher(lignesTva, /\bFR[ ]?([0-9A-Z]{2})[ ]?((?:\d[ ]?){8}\d)(?![ ]?[\dA-Za-z])/).map(({ m, ligne }) => versCandidat(`FR${m[1] ?? ''}${compact(m[2] ?? '')}`, ligne)),
    // Numéro de TVA d'un autre État membre : uniquement après une étiquette de TVA, code pays connu, 8 à 12 caractères.
    ...chercher(lignesTva, /(?:T\.?V\.?A|VAT)[^:]{0,40}:\s*([A-Z]{2})[ ]?([0-9A-Z]{8,12})(?![0-9A-Za-z])/)
      .filter(({ m }) => PAYS_UE.has(m[1] ?? '') && /\d/.test(m[2] ?? ''))
      .map(({ m, ligne }) => versCandidat(`${m[1] ?? ''}${m[2] ?? ''}`, ligne)),
  ];
  return { siret, siren, tva };
}

/** SIREN désigné par un identifiant (SIREN, SIRET, TVA française) ; pour une TVA étrangère, le numéro lui-même. */
function entiteDe(nature: 'siret' | 'siren' | 'tva', valeur: string): string {
  if (nature === 'siren') return valeur;
  if (nature === 'siret') return valeur.slice(0, 9);
  return valeur.startsWith('FR') ? (sirenDeTvaFr(valeur) ?? valeur.slice(4)) : valeur;
}

function extraireDestinataire(lignes: Ligne[], champs: ChampsFacture): void {
  // 1) Zones ouvertes par un repère explicite, bornées à quelques lignes de la même page.
  interface Zone { type: 'facturation' | 'livraison'; lignes: Ligne[]; nom: Candidat<string> | null }
  const zones: Zone[] = [];
  let courante: Zone | null = null;
  for (const ligne of lignes) {
    const livraison = REPERE_LIVRAISON.test(ligne.texte);
    const repere = livraison ? null : (REPERE_NOM.exec(ligne.texte) ?? REPERE_A.exec(ligne.texte));
    if (livraison || repere) {
      courante = { type: livraison ? 'livraison' : 'facturation', lignes: [ligne], nom: null };
      zones.push(courante);
      const suite = repere ? nomPlausible(repere[1] ?? '') : null;
      if (suite !== null) courante.nom = { valeur: suite, cle: cleNom(suite), ligne };
      continue;
    }
    if (courante === null) continue;
    const premiere = courante.lignes[0]!;
    if (ligne.page !== premiere.page || courante.lignes.length > LIGNES_ZONE_MAX || REPERE_EMETTEUR.test(ligne.texte) || FIN_ZONE.test(ligne.texte)) {
      courante = null;
      continue;
    }
    // Le nom est la ligne qui suit immédiatement le repère, si le repère ne le portait pas lui-même.
    if (courante.nom === null && courante.lignes.length === 1 && (REPERE_NOM.exec(premiere.texte)?.[1] ?? REPERE_A.exec(premiere.texte)?.[1] ?? '').trim() === '') {
      const nom = nomPlausible(ligne.texte);
      if (nom !== null) courante.nom = { valeur: nom, cle: cleNom(nom), ligne };
    }
    courante.lignes.push(ligne);
  }
  const facturation = zones.filter((z) => z.type === 'facturation');
  const explicites = lignes.filter((l) => IDENTIFIANT_CLIENT.test(l.texte));
  if (facturation.length === 0 && explicites.length === 0) {
    champs.destinataireAbstention = zones.length > 0 ? MOTIFS_DESTINATAIRE.livraisonSeule : MOTIFS_DESTINATAIRE.aucunRepere;
    return;
  }

  // 2) Identifiants attribuables au destinataire.
  const vus = new Set<number>();
  const perimetre = [...facturation.flatMap((z) => z.lignes), ...explicites].filter((l) => !vus.has(l.index) && vus.add(l.index));
  const ids = identifiantsDe(perimetre);
  const entites = new Set([
    ...ids.siren.map((c) => entiteDe('siren', c.valeur)),
    ...ids.siret.map((c) => entiteDe('siret', c.valeur)),
    ...ids.tva.map((c) => entiteDe('tva', c.valeur)),
  ]);
  const emetteur = new Set<string>();
  if (champs.emetteurSiren) emetteur.add(entiteDe('siren', champs.emetteurSiren.valeur));
  if (champs.emetteurSiret) emetteur.add(entiteDe('siret', champs.emetteurSiret.valeur));
  if (champs.emetteurTva) emetteur.add(entiteDe('tva', champs.emetteurTva.valeur));

  // 3) Nom : un seul nom distinct parmi les zones de facturation, différent de celui de l'émetteur.
  const noms = facturation.flatMap((z) => (z.nom ? [z.nom] : []));
  const nom = unique(noms);
  const nomEmetteur = champs.emetteurNom ? cleNom(champs.emetteurNom.valeur.replace(/\s+au\s+capital\b.*$/i, '')) : null;
  if (nom !== null && (nomEmetteur === null || cleNom(nom.valeur) !== nomEmetteur)) champs.destinataireNom = nom;

  if (entites.size === 0) champs.destinataireAbstention = MOTIFS_DESTINATAIRE.aucunIdentifiant;
  else if (entites.size > 1) champs.destinataireAbstention = MOTIFS_DESTINATAIRE.plusieurs;
  else if (emetteur.size === 0) champs.destinataireAbstention = MOTIFS_DESTINATAIRE.emetteurInconnu;
  else if ([...entites].some((e) => emetteur.has(e))) champs.destinataireAbstention = MOTIFS_DESTINATAIRE.identiqueEmetteur;
  else {
    champs.destinataireSiren = unique(ids.siren);
    champs.destinataireSiret = unique(ids.siret);
    champs.destinataireTva = unique(ids.tva);
    if (champs.destinataireSiren === null && champs.destinataireSiret === null && champs.destinataireTva === null) champs.destinataireAbstention = MOTIFS_DESTINATAIRE.plusieurs;
  }
  // Un nom contredit par des identifiants multiples ne vaut pas mieux qu'eux.
  if (champs.destinataireAbstention === MOTIFS_DESTINATAIRE.plusieurs || champs.destinataireAbstention === MOTIFS_DESTINATAIRE.identiqueEmetteur) champs.destinataireNom = null;
}
