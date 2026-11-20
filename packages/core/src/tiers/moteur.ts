/**
 * Tiers, factures et avoirs suivis, échéances et règlements — moteur déterministe et pur.
 *
 * Rien n'est stocké ici : le référentiel des tiers, les fiches de factures, les règlements identifiés et les restes dus
 * sont RECALCULÉS à chaque lecture à partir des écritures du lot actif, des extractions en vigueur des pièces, des
 * rapprochements bancaires validés et des décisions humaines enregistrées. Ils ne peuvent donc pas diverger des écritures.
 * Les montants sont des décimaux exacts ; un appariement exige l'égalité stricte des montants (aucune tolérance).
 */
import type { Decimal } from 'decimal.js';
import type { LigneEcriture } from '../controles/types.js';
import { ecartEnJours, estDateIso } from '../dates.js';
import { determinerSensPiece, sirenDePartie } from '../facture/sens.js';
import { sirenDeTvaFr, validerSiren, validerSiret, validerTvaIntracomFr } from '../identifiants.js';
import { ZERO, dec, estChaineDecimale, versChaine } from '../montant.js';
import { normaliserReference } from '../rapprochement/rapprocher.js';
import {
  type BanqueImputation, type CandidatEcriture, type CriteresAppariement, type DecisionARevoir, type DemandeTiersFactures, type FicheFacture, type FicheTiers,
  type IdentifiantTiers, type Imputation, PARAMETRES_TIERS_FACTURES_PAR_DEFAUT, type ParametresTiersFactures, type PieceFacture, type PropositionTiers, type RefEcriture,
  type ResultatTiersFactures, type SuspicionDoubleComptabilisation, type TypeTiers,
} from './types.js';

const FORMES_JURIDIQUES = new Set([
  'SARL', 'SAS', 'SASU', 'SA', 'EURL', 'SCI', 'SNC', 'SCP', 'SCM', 'SELARL', 'SELAS', 'EI', 'EIRL', 'SCOP', 'GIE', 'STE', 'SOCIETE', 'ETS', 'ETABLISSEMENTS', 'ETABLISSEMENT',
]);

/**
 * Nom de tiers normalisé pour comparaison : sans accents, en majuscules, sans ponctuation, sans forme juridique.
 * Deux noms normalisés identiques ne prouvent PAS qu'il s'agit du même tiers : ils ne fondent qu'une proposition.
 */
export function normaliserNomTiers(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const mots = v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((m) => m !== '' && !FORMES_JURIDIQUES.has(m));
  const t = mots.join(' ');
  return t === '' ? null : t.slice(0, 140);
}

const CRITERES_EN_CLAIR = {
  montant: { exact: 'montant identique', ecart: 'montant différent' },
  reference: { identique: 'référence identique', mentionnee: 'référence citée dans le libellé', absente: 'référence absente' },
  date: { concordante: 'dates concordantes', ecart: 'dates éloignées', non_determinable: 'date de la pièce inconnue' },
  tiers: { identifie: 'tiers identifié', propose: 'tiers proposé par son nom', homonymes: 'tiers homonymes', non_determinable: 'tiers non lu sur la pièce', sans_lien: 'tiers sans lien établi', different: 'tiers différent' },
} as const;
const criteresEnClair = (c: CriteresAppariement): string => [CRITERES_EN_CLAIR.montant[c.montant], CRITERES_EN_CLAIR.reference[c.reference], CRITERES_EN_CLAIR.date[c.date], CRITERES_EN_CLAIR.tiers[c.tiers]].join(', ');

export const cleEcriture = (l: { journalCode: string; ecritureNum: string }): string => `${l.journalCode}|${l.ecritureNum}`;

const aPrefixe = (compte: string, prefixes: readonly string[]): boolean => prefixes.some((p) => compte.startsWith(p));
const chiffre = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** Vrai si la référence normalisée `n` figure dans `h` sans être le fragment d'un nombre plus long. */
function contient(h: string | null, n: string): boolean {
  if (!h) return false;
  let i = h.indexOf(n);
  while (i >= 0) {
    const colleAvant = chiffre(n[0]) && chiffre(h[i - 1]);
    const colleApres = chiffre(n[n.length - 1]) && chiffre(h[i + n.length]);
    if (!colleAvant && !colleApres) return true;
    i = h.indexOf(n, i + 1);
  }
  return false;
}

function critereReference(l: LigneEcriture, n: string | null, p: ParametresTiersFactures): CriteresAppariement['reference'] {
  if (!n) return 'absente';
  const piece = normaliserReference(l.pieceRef);
  if (piece === n) return 'identique';
  if (n.length >= p.longueurMinReference && (contient(piece, n) || contient(normaliserReference(l.ecritureLib), n))) return 'mentionnee';
  return 'absente';
}

type Nature = 'facture' | 'avoir' | 'reglement' | 'autre';
interface LigneTiers {
  l: LigneEcriture;
  cote: 'fournisseur' | 'client';
  cleTiers: string;
  poste: string;
  /** Sens « facture » : positif pour une facture (crédit fournisseur, débit client), négatif pour un règlement ou un avoir. */
  signe: Decimal;
  abs: Decimal;
  cleE: string;
  nature: Nature;
}
interface Ecriture { lignes: LigneEcriture[]; tresorerie: string[]; contrepartie: boolean }

function refEcriture(t: LigneTiers): RefEcriture {
  const debit = dec(t.l.debit).minus(dec(t.l.credit));
  return {
    cle: t.cleE,
    journalCode: t.l.journalCode,
    ecritureNum: t.l.ecritureNum,
    ecritureDate: t.l.ecritureDate,
    pieceRef: t.l.pieceRef,
    pieceDate: t.l.pieceDate,
    libelle: t.l.ecritureLib,
    ligneId: t.l.id,
    compteNum: t.l.compteNum,
    compAuxNum: t.l.compAuxNum,
    montant: versChaine(t.abs),
    sens: debit.lessThan(0) ? 'credit' : 'debit',
    lettrage: t.l.ecritureLet,
  };
}

interface IdentitePiece {
  cle: string; nom: string | null; nomNormalise: string | null; siren: string | null; tva: string | null; identifiants: IdentifiantTiers[]; documentIds: string[];
  /** Côtés sous lesquels ce tiers apparaît sur les pièces : fournisseur (émetteur d'un achat), client (destinataire d'une vente). */
  cotes: Set<'fournisseur' | 'client'>;
}

const compact = (v: string | null): string | null => (typeof v === 'string' && v.trim() !== '' ? v.replace(/[\s.]/g, '').toUpperCase() : null);

function sirenDePiece(p: PieceFacture): string | null {
  const siren = compact(p.emetteurSiren);
  if (siren && validerSiren(siren).valide) return siren;
  const siret = compact(p.emetteurSiret);
  if (siret && validerSiret(siret).valide) return siret.slice(0, 9);
  const tva = compact(p.emetteurTva);
  if (tva && validerTvaIntracomFr(tva).valide) return sirenDeTvaFr(tva);
  return null;
}

function montantAbsolu(v: string | null): Decimal | null {
  return v !== null && estChaineDecimale(v) ? dec(v).abs() : null;
}

/** Calcule le référentiel des tiers, les fiches de factures et d'avoirs, leurs règlements et les suspicions de double comptabilisation. */
export function suivreTiersEtFactures(demande: DemandeTiersFactures): ResultatTiersFactures {
  const p: ParametresTiersFactures = { ...PARAMETRES_TIERS_FACTURES_PAR_DEFAUT, ...(demande.parametres ?? {}) };
  if (!estDateIso(demande.dateAppreciation)) throw new Error('Date d’appréciation invalide : AAAA-MM-JJ attendue.');
  const DA = demande.dateAppreciation;
  const reserves: string[] = [
    'Aide à la révision : rien n’est comptabilisé ni lettré ici ; le logiciel de production comptable reste la référence.',
    'Le client d’une pièce de vente n’est identifié par la pièce que si son destinataire y a été lu de façon sûre ; à défaut, le lien avec l’écriture reste à confirmer par une personne.',
  ];
  const aRevoir: DecisionARevoir[] = [];
  const euro = demande.deviseDossier === 'EUR';
  if (!euro) reserves.push(`Devise du dossier ${demande.deviseDossier} : seul l’euro est traité ; aucune facture n’est suivie.`);

  // ── 1. Écritures et lignes de tiers ──
  // Ordre du fichier d'origine : le résultat ne dépend pas de l'ordre dans lequel les lignes sont fournies.
  const lignesTriees = [...demande.lignes].sort((a, b) => a.numeroLigne - b.numeroLigne || a.id.localeCompare(b.id));
  const ecritures = new Map<string, Ecriture>();
  for (const l of lignesTriees) {
    const k = cleEcriture(l);
    let e = ecritures.get(k);
    if (!e) ecritures.set(k, (e = { lignes: [], tresorerie: [], contrepartie: false }));
    e.lignes.push(l);
    if (aPrefixe(l.compteNum, p.prefixesTresorerie)) e.tresorerie.push(l.id);
    if (aPrefixe(l.compteNum, p.prefixesContrepartie)) e.contrepartie = true;
  }
  const lignesTiers: LigneTiers[] = [];
  const parId = new Map<string, LigneTiers>();
  for (const l of lignesTriees) {
    const fournisseur = aPrefixe(l.compteNum, p.prefixesFournisseurs);
    if (!fournisseur && !aPrefixe(l.compteNum, p.prefixesClients)) continue;
    const solde = dec(l.debit).minus(dec(l.credit));
    const signe = fournisseur ? solde.negated() : solde;
    const cleE = cleEcriture(l);
    const e = ecritures.get(cleE)!;
    const treso = e.tresorerie.length > 0;
    const nature: Nature = signe.isZero()
      ? 'autre'
      : signe.greaterThan(0)
        ? !treso && e.contrepartie ? 'facture' : 'autre'
        : treso ? 'reglement' : e.contrepartie ? 'avoir' : 'autre';
    const aux = l.compAuxNum !== null && l.compAuxNum.trim() !== '' ? l.compAuxNum.trim() : null;
    const t: LigneTiers = {
      l, cote: fournisseur ? 'fournisseur' : 'client', cleTiers: aux !== null ? `aux:${aux}` : `general:${l.compteNum}`, poste: `${l.compteNum}\u0001${aux ?? ''}`, signe, abs: signe.abs(), cleE, nature,
    };
    lignesTiers.push(t);
    parId.set(l.id, t);
  }

  // ── 2. Tiers comptables ──
  interface Brouillon { fiche: FicheTiers; nomNormalise: string | null; sirens: Set<string>; debit: Decimal; credit: Decimal; ecritures: Set<string>; cotes: Set<string> }
  const comptables = new Map<string, Brouillon>();
  for (const t of lignesTiers) {
    let b = comptables.get(t.cleTiers);
    const sansAux = t.cleTiers.startsWith('general:');
    const lib = sansAux ? t.l.compteLib : (t.l.compAuxLib ?? '').trim() || t.l.compteLib;
    if (!b) {
      b = {
        fiche: {
          cle: t.cleTiers, origine: 'comptable', type: 'indetermine', nom: lib, compteAuxiliaire: sansAux ? null : t.cleTiers.slice(4), comptesGeneraux: [], sansAuxiliaire: sansAux, libelles: [], identifiants: [],
          tiersPieces: [], homonymes: [], totalDebit: '0.00', totalCredit: '0.00', solde: '0.00', nbLignes: 0, nbEcritures: 0, pieces: [],
        },
        nomNormalise: null, sirens: new Set(), debit: ZERO, credit: ZERO, ecritures: new Set(), cotes: new Set(),
      };
      comptables.set(t.cleTiers, b);
    }
    if (!b.fiche.libelles.includes(lib) && b.fiche.libelles.length < 10) b.fiche.libelles.push(lib);
    if (!b.fiche.comptesGeneraux.includes(t.l.compteNum)) b.fiche.comptesGeneraux.push(t.l.compteNum);
    b.debit = b.debit.plus(dec(t.l.debit));
    b.credit = b.credit.plus(dec(t.l.credit));
    b.fiche.nbLignes++;
    b.ecritures.add(t.cleE);
    b.cotes.add(t.cote);
    if (!sansAux) {
      // Identifiant fort porté par la comptabilité elle-même : un SIREN valide dans le numéro ou le libellé du compte auxiliaire.
      for (const m of `${t.l.compAuxNum ?? ''} ${t.l.compAuxLib ?? ''}`.matchAll(/(?<!\d)\d{9}(?!\d)/g)) if (validerSiren(m[0]).valide) b.sirens.add(m[0]);
    }
  }
  const parNom = new Map<string, string[]>();
  for (const b of comptables.values()) {
    const f = b.fiche;
    f.type = b.cotes.size === 2 ? 'mixte' : b.cotes.has('client') ? 'client' : 'fournisseur';
    f.comptesGeneraux.sort();
    f.totalDebit = versChaine(b.debit);
    f.totalCredit = versChaine(b.credit);
    f.solde = versChaine(b.debit.minus(b.credit));
    f.nbEcritures = b.ecritures.size;
    for (const s of [...b.sirens].sort()) f.identifiants.push({ nature: 'siren', valeur: s, origine: 'compte_auxiliaire', documentIds: [] });
    if (!f.sansAuxiliaire) {
      b.nomNormalise = normaliserNomTiers(f.nom);
      if (b.nomNormalise) parNom.set(b.nomNormalise, [...(parNom.get(b.nomNormalise) ?? []), f.cle]);
    }
  }
  for (const cles of parNom.values()) if (cles.length > 1) for (const c of cles) comptables.get(c)!.fiche.homonymes = cles.filter((x) => x !== c).sort();

  // ── 3. Pièces : type, sens, tiers de pièce ──
  interface Travail { piece: PieceFacture; fiche: FicheFacture; identite: IdentitePiece | null; montant: Decimal | null; numero: string | null; ligne: LigneTiers | null; forts: CandidatEcriture[] }
  const identites = new Map<string, IdentitePiece>();
  const travaux: Travail[] = [];
  const sirenDossier = compact(demande.sirenDossier);
  for (const piece of [...demande.pieces].sort((a, b) => a.documentId.localeCompare(b.documentId))) {
    const type: 'facture' | 'avoir' = piece.typeDocument === 'avoir' || piece.nature === 'avoir' ? 'avoir' : 'facture';
    const siren = sirenDePiece(piece);
    let sens: FicheFacture['sens'] = piece.nature === 'facture_achat' ? 'achat' : piece.nature === 'facture_vente' ? 'vente' : 'indetermine';
    if (piece.nature === 'avoir' && siren && sirenDossier) sens = siren === sirenDossier ? 'vente' : 'achat';
    const destinataire = { nom: piece.destinataireNom ?? null, siren: piece.destinataireSiren ?? null, siret: piece.destinataireSiret ?? null, tva: piece.destinataireTva ?? null };
    const lu = determinerSensPiece({ emetteur: { siren: piece.emetteurSiren, siret: piece.emetteurSiret, tva: piece.emetteurTva }, destinataire, sirenDossier: demande.sirenDossier });
    // Avoir : à défaut de déduction par l'émetteur, le destinataire peut désigner le dossier ; une contradiction laisse le sens indéterminé.
    if (piece.nature === 'avoir') {
      if (lu.incoherence) sens = 'indetermine';
      else if (sens === 'indetermine' && lu.sens !== 'indetermine') sens = lu.sens;
    }
    let identite: IdentitePiece | null = null;
    let motifTiers: string | null = null;
    /** Enregistre le tiers lu sur la pièce (émetteur d'un achat, destinataire d'une vente) ; null si rien ne l'identifie. */
    const identifier = (partie: { nom: string | null; siren: string | null; siret: string | null; tva: string | null }, sirenValide: string | null, cote: 'fournisseur' | 'client'): IdentitePiece | null => {
      const tva = compact(partie.tva);
      const nomNormalise = normaliserNomTiers(partie.nom);
      const cle = sirenValide ? `siren:${sirenValide}` : tva && /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(tva) && !tva.startsWith('FR') ? `tva:${tva}` : nomNormalise ? `nom:${nomNormalise}` : null;
      if (cle === null) return null;
      const id = identites.get(cle) ?? { cle, nom: partie.nom, nomNormalise, siren: sirenValide, tva: null, identifiants: [], documentIds: [], cotes: new Set<'fournisseur' | 'client'>() };
      identites.set(cle, id);
      id.nom ??= partie.nom;
      id.nomNormalise ??= nomNormalise;
      id.documentIds.push(piece.documentId);
      id.cotes.add(cote);
      const ajouter = (nature: IdentifiantTiers['nature'], valeur: string | null) => {
        if (!valeur) return;
        const existant = id.identifiants.find((i) => i.nature === nature && i.valeur === valeur);
        if (existant) existant.documentIds.push(piece.documentId);
        else id.identifiants.push({ nature, valeur, origine: 'piece', documentIds: [piece.documentId] });
      };
      ajouter('siren', sirenValide);
      const siret = compact(partie.siret);
      ajouter('siret', siret && validerSiret(siret).valide ? siret : null);
      ajouter('tva', tva);
      ajouter('nom', partie.nom?.trim() || null);
      if (tva) id.tva ??= tva;
      return id;
    };
    let tvaTiers: string | null = null;
    if (sens === 'vente') {
      // Vente : le tiers est le DESTINATAIRE. Il n'est retenu que si rien, sur la pièce, ne contredit le sens.
      const sirenDestinataire = sirenDePartie(destinataire);
      if (lu.incoherence) motifTiers = `${lu.motif} Le client n’est pas identifié par la pièce.`;
      else if (siren && sirenDossier && siren !== sirenDossier) motifTiers = 'L’émetteur lu sur la pièce n’est pas le dossier : la pièce est peut-être une facture d’achat mal qualifiée. Le client n’est pas identifié par la pièce.';
      else if (sirenDestinataire && sirenDossier && sirenDestinataire === sirenDossier) motifTiers = 'Le destinataire lu sur la pièce est le dossier lui-même : la pièce est peut-être une facture d’achat mal qualifiée. Le client n’est pas identifié par la pièce.';
      else {
        identite = identifier(destinataire, sirenDestinataire, 'client');
        tvaTiers = compact(destinataire.tva);
        if (identite === null) motifTiers = 'Le destinataire n’a pas été lu de façon sûre sur la pièce (ni SIREN, ni numéro de TVA, ni nom) : le client ne peut pas être identifié par la pièce.';
      }
    } else if (sens === 'indetermine') motifTiers = lu.incoherence ? `Sens de l’avoir (achat ou vente) non déterminable. ${lu.motif}` : 'Sens de l’avoir (achat ou vente) non déterminable : émetteur ou SIREN du dossier inconnu.';
    else if (siren && sirenDossier && siren === sirenDossier) motifTiers = 'L’émetteur lu sur la pièce est le dossier lui-même : la pièce est peut-être une facture de vente mal qualifiée.';
    else {
      identite = identifier({ nom: piece.emetteurNom, siren: piece.emetteurSiren, siret: piece.emetteurSiret, tva: piece.emetteurTva }, siren, 'fournisseur');
      tvaTiers = compact(piece.emetteurTva);
      if (identite === null) motifTiers = 'Émetteur non lu sur la pièce (ni SIREN, ni numéro de TVA, ni nom).';
    }
    const montant = montantAbsolu(piece.totalTtc);
    const fiche: FicheFacture = {
      id: piece.documentId, nomFichier: piece.nomFichier, versionPiece: piece.versionPiece, versionExtraction: piece.versionExtraction, statutExtraction: piece.statutExtraction, type, sens,
      numero: piece.numero, dateEmission: piece.dateEmission, dateEcheance: piece.dateEcheance, totalHt: piece.totalHt, totalTva: piece.totalTva, totalTtc: piece.totalTtc,
      montant: montant ? versChaine(montant) : null, devise: piece.devise,
      tiersPiece: identite ? { cle: identite.cle, nom: identite.nom, siren: identite.siren, tva: tvaTiers } : null,
      roleTiersPiece: identite ? (sens === 'vente' ? 'destinataire' : 'emetteur') : null, sensLu: lu.sens, motifSensLu: lu.motif, motifTiers, tiersCle: null,
      comptabilisation: { statut: 'non_recherche', motif: null, ecriture: null, criteres: null, propositions: [] },
      imputations: [], propositionsImputation: [], imputeSur: [], montantRegle: null, resteDu: null, etat: 'non_determinable', motifEtat: null, echue: null, joursDeRetard: null, suspicions: [], reserves: [], preuves: [],
    };
    if (piece.statutExtraction === 'projet') fiche.reserves.push('Extraction non validée par un réviseur : les champs lus sur la pièce sont un projet.');
    if (piece.nature !== 'avoir' && lu.sens !== 'indetermine' && lu.sens !== sens) {
      fiche.reserves.push(`La pièce est qualifiée « ${sens === 'vente' ? 'facture de vente' : 'facture d’achat'} » mais ses identifiants indiquent ${lu.sens === 'vente' ? 'une vente' : 'un achat'} : ${lu.motif}`);
    }
    if (piece.devise === null) fiche.reserves.push('Devise non lue sur la pièce : la pièce est traitée dans la devise du dossier.');
    travaux.push({ piece, fiche, identite, montant, numero: normaliserReference(piece.numero), ligne: null, forts: [] });
  }

  // ── 4. Liens tiers comptable ↔ tiers de pièce ──
  const effectifs = new Map<string, Map<string, 'identifiant_fort' | 'confirme'>>();
  const infirmesTiers = new Set<string>();
  const lier = (clePiece: string, cleComptable: string, lien: 'identifiant_fort' | 'confirme') => {
    let m = effectifs.get(clePiece);
    if (!m) effectifs.set(clePiece, (m = new Map()));
    if (!m.has(cleComptable) || lien === 'confirme') m.set(cleComptable, lien);
  };
  for (const d of demande.decisionsTiers) {
    if (!comptables.has(d.cleComptable) || !identites.has(d.clePiece)) {
      aRevoir.push({ type: 'tiers', objet: d.cleComptable, cible: d.clePiece, motif: 'Le tiers comptable ou le tiers de pièce n’existe plus dans les données actuelles : la décision n’est pas appliquée.' });
      continue;
    }
    if (d.decision === 'infirme') infirmesTiers.add(`${d.cleComptable}\u0001${d.clePiece}`);
  }
  for (const id of identites.values()) {
    if (id.siren) for (const b of comptables.values()) if (b.sirens.has(id.siren) && !infirmesTiers.has(`${b.fiche.cle}\u0001${id.cle}`)) lier(id.cle, b.fiche.cle, 'identifiant_fort');
  }
  for (const d of demande.decisionsTiers) if (d.decision === 'confirme' && comptables.has(d.cleComptable) && identites.has(d.clePiece)) lier(d.clePiece, d.cleComptable, 'confirme');
  const propositionsTiers: PropositionTiers[] = [];
  const proposes = new Map<string, string[]>();
  for (const id of [...identites.values()].sort((a, b) => a.cle.localeCompare(b.cle))) {
    if (effectifs.has(id.cle) || !id.nomNormalise) continue;
    const candidats = (parNom.get(id.nomNormalise) ?? [])
      .map((c) => comptables.get(c)!.fiche)
      // Un émetteur d'achat ne se propose pas sur un compte purement client, ni un destinataire de vente sur un compte purement fournisseur.
      .filter((f) => (f.type === 'mixte' || f.type === 'indetermine' || id.cotes.has(f.type)) && !infirmesTiers.has(`${f.cle}\u0001${id.cle}`))
      .sort((a, b) => a.cle.localeCompare(b.cle));
    if (candidats.length === 0) continue;
    proposes.set(id.cle, candidats.map((c) => c.cle));
    propositionsTiers.push({
      clePiece: id.cle, nomPiece: id.nom, identifiantsPiece: id.identifiants, documentIds: [...id.documentIds].sort(),
      candidats: candidats.map((c) => ({ cle: c.cle, nom: c.nom, type: c.type, compteAuxiliaire: c.compteAuxiliaire })),
      critere: 'nom_normalise_identique', nomNormalise: id.nomNormalise, statut: candidats.length > 1 ? 'homonymes' : 'a_confirmer',
    });
  }
  for (const [clePiece, m] of effectifs) {
    const id = identites.get(clePiece)!;
    for (const [cleComptable, lien] of m) {
      const f = comptables.get(cleComptable)!.fiche;
      f.tiersPieces.push({ cle: clePiece, nom: id.nom, lien });
      for (const i of id.identifiants) if (!f.identifiants.some((x) => x.nature === i.nature && x.valeur === i.valeur && x.origine === 'piece')) f.identifiants.push(i);
    }
  }
  const critereTiers = (identite: IdentitePiece | null, cleTiers: string): CriteresAppariement['tiers'] => {
    if (!identite) return 'non_determinable';
    if (infirmesTiers.has(`${cleTiers}\u0001${identite.cle}`)) return 'different';
    const e = effectifs.get(identite.cle);
    if (e) return e.has(cleTiers) ? 'identifie' : 'different';
    const c = proposes.get(identite.cle);
    if (c?.includes(cleTiers)) return c.length === 1 ? 'propose' : 'homonymes';
    return 'sans_lien';
  };

  // ── 5. Appariement facture ↔ écriture ──
  const decisionsParObjet = new Map<string, typeof demande.decisionsFactures[number][]>();
  const parDocument = new Map(travaux.map((t) => [t.piece.documentId, t]));
  for (const d of demande.decisionsFactures) {
    if (d.type === 'suspicion') continue;
    const t = parDocument.get(d.objet);
    if (!t) {
      aRevoir.push({ type: d.type, objet: d.objet, cible: d.cible, motif: 'La pièce a été remplacée par une nouvelle version, retirée ou requalifiée : la décision ne s’applique plus.' });
      continue;
    }
    if (d.versionExtraction !== undefined && d.versionExtraction !== null && d.versionExtraction !== t.piece.versionExtraction) {
      aRevoir.push({ type: d.type, objet: d.objet, cible: d.cible, motif: 'Les champs extraits de la pièce ont changé depuis la décision : elle n’est plus appliquée.' });
      continue;
    }
    if (!ecritures.has(d.cible)) {
      aRevoir.push({ type: d.type, objet: d.objet, cible: d.cible, motif: 'L’écriture visée est absente des données comptables actuelles : la décision n’est pas appliquée.' });
      continue;
    }
    decisionsParObjet.set(d.objet, [...(decisionsParObjet.get(d.objet) ?? []), d]);
  }
  const decisionsDe = (id: string, type: 'comptabilisation' | 'imputation') => (decisionsParObjet.get(id) ?? []).filter((d) => d.type === type);

  const lignesParEcriture = new Map<string, LigneTiers[]>();
  for (const t of lignesTiers) lignesParEcriture.set(t.cleE, [...(lignesParEcriture.get(t.cleE) ?? []), t]);
  const prises = new Set<string>();
  const candidatsDe = new Map<string, Array<{ t: LigneTiers; c: CandidatEcriture }>>();

  for (const w of travaux) {
    const f = w.fiche;
    const c = f.comptabilisation;
    if (!euro) { c.motif = 'Devise du dossier autre que l’euro : non traité.'; continue; }
    if (w.piece.devise !== null && w.piece.devise.toUpperCase() !== 'EUR') { c.motif = `Pièce en ${w.piece.devise.toUpperCase()} : les devises autres que l’euro ne sont pas traitées.`; continue; }
    if (!w.montant) { c.motif = 'Total TTC non lu sur la pièce : aucun appariement possible.'; continue; }
    if (w.montant.isZero()) { c.motif = 'Total TTC nul : aucun appariement possible.'; continue; }
    if (demande.lignes.length === 0) { c.motif = 'Aucune écriture comptable : aucun appariement possible.'; continue; }
    c.statut = 'non_trouve';
    // Décision humaine : lien confirmé.
    const confirme = decisionsDe(f.id, 'comptabilisation').find((d) => d.decision === 'confirme');
    if (confirme) {
      const lignes = (lignesParEcriture.get(confirme.cible) ?? []).filter((t) => !t.signe.isZero());
      const attendu = f.type === 'facture' ? 1 : -1;
      const choisie = lignes.find((t) => t.abs.equals(w.montant!) && t.signe.s === attendu) ?? lignes.find((t) => t.signe.s === attendu) ?? lignes[0];
      if (!choisie) {
        aRevoir.push({ type: 'comptabilisation', objet: f.id, cible: confirme.cible, motif: 'L’écriture confirmée ne comporte aucune ligne de compte de tiers : la décision n’est pas appliquée.' });
      } else {
        w.ligne = choisie;
        prises.add(choisie.l.id);
        c.statut = 'confirme';
        c.ecriture = refEcriture(choisie);
        c.criteres = { montant: choisie.abs.equals(w.montant) ? 'exact' : 'ecart', reference: critereReference(choisie.l, w.numero, p), date: 'non_determinable', tiers: critereTiers(w.identite, choisie.cleTiers) };
        if (!choisie.abs.equals(w.montant)) f.reserves.push(`Le montant de la ligne confirmée (${versChaine(choisie.abs)}) diffère du TTC de la pièce (${versChaine(w.montant)}).`);
      }
    }
  }
  for (const w of travaux) {
    const f = w.fiche;
    const c = f.comptabilisation;
    if (c.statut !== 'non_trouve') continue;
    const infirmes = new Set(decisionsDe(f.id, 'comptabilisation').filter((d) => d.decision === 'infirme').map((d) => d.cible));
    const natureAttendue: Nature = f.type === 'facture' ? 'facture' : 'avoir';
    const liste: Array<{ t: LigneTiers; c: CandidatEcriture }> = [];
    for (const t of lignesTiers) {
      if (t.nature !== natureAttendue || !t.abs.equals(w.montant!) || prises.has(t.l.id) || infirmes.has(t.cleE)) continue;
      if (f.sens === 'achat' && t.cote !== 'fournisseur') continue;
      if (f.sens === 'vente' && t.cote !== 'client') continue;
      const reference = critereReference(t.l, w.numero, p);
      const D = f.dateEmission;
      const date: CriteresAppariement['date'] = !D || !estDateIso(D)
        ? 'non_determinable'
        : t.l.pieceDate === D || Math.abs(ecartEnJours(D, t.l.ecritureDate)) <= p.toleranceDateJours ? 'concordante' : 'ecart';
      const tiers = critereTiers(w.identite, t.cleTiers);
      const ref = reference !== 'absente';
      const fort = ref && date === 'concordante' && (tiers === 'identifie' || tiers === 'propose');
      const proposable = !fort && (ref || tiers === 'identifie' || tiers === 'propose' || tiers === 'homonymes');
      if (!fort && !proposable) continue;
      liste.push({ t, c: { ecriture: refEcriture(t), criteres: { montant: 'exact', reference, date, tiers }, niveau: fort ? 'fort' : 'proposable' } });
    }
    liste.sort((a, b) => a.t.cleE.localeCompare(b.t.cleE) || a.t.l.numeroLigne - b.t.l.numeroLigne);
    candidatsDe.set(f.id, liste);
    w.forts = liste.filter((x) => x.c.niveau === 'fort').map((x) => x.c);
  }
  // Une même ligne revendiquée comme seul candidat fort par plusieurs pièces n'est attribuée à aucune.
  const revendications = new Map<string, number>();
  for (const w of travaux) {
    const cles = new Set(w.forts.map((x) => x.ecriture.cle));
    if (cles.size === 1) revendications.set(w.forts[0]!.ecriture.ligneId, (revendications.get(w.forts[0]!.ecriture.ligneId) ?? 0) + 1);
  }
  for (const w of travaux) {
    const c = w.fiche.comptabilisation;
    if (c.statut !== 'non_trouve') continue;
    const liste = candidatsDe.get(w.fiche.id) ?? [];
    const clesFortes = new Set(w.forts.map((x) => x.ecriture.cle));
    if (clesFortes.size === 1 && w.forts.length === 1 && revendications.get(w.forts[0]!.ecriture.ligneId) === 1) {
      const retenu = liste.find((x) => x.c.niveau === 'fort')!;
      w.ligne = retenu.t;
      c.statut = 'apparie';
      c.ecriture = retenu.c.ecriture;
      c.criteres = retenu.c.criteres;
      c.propositions = liste.filter((x) => x !== retenu).map((x) => x.c);
    } else if (w.forts.length > 0) {
      c.statut = 'ambigu';
      c.motif = clesFortes.size > 1 || w.forts.length > 1
        ? 'Plusieurs écritures correspondent à cette pièce avec les mêmes critères : aucune n’est retenue.'
        : 'Plusieurs pièces correspondent à la même écriture : aucune n’est retenue.';
      c.propositions = liste.map((x) => x.c);
    } else if (liste.length > 0) {
      c.statut = 'a_confirmer';
      c.motif = 'Aucune écriture ne réunit tous les critères (tiers, référence, montant, date) : proposition à confirmer.';
      c.propositions = liste.map((x) => x.c);
    } else {
      c.motif = 'Aucune écriture de même montant ne correspond à cette pièce par sa référence ou par son tiers.';
    }
  }

  // ── 6. Règlements, avoirs imputés, restes dus ──
  const banqueParLigne = new Map<string, DemandeTiersFactures['rapprochementsValides'][number]>();
  for (const r of demande.rapprochementsValides) for (const id of r.lignesEcriture) banqueParLigne.set(id, r);
  const banqueDe = (t: LigneTiers): BanqueImputation => {
    for (const id of ecritures.get(t.cleE)!.tresorerie) {
      const r = banqueParLigne.get(id);
      if (r) return { statut: 'valide', rapprochementId: r.id, mouvements: r.mouvements };
    }
    return { statut: 'non_rapproche', rapprochementId: null, mouvements: [] };
  };
  const natureImputation = (t: LigneTiers): Imputation['nature'] => (t.nature === 'reglement' ? 'reglement' : t.nature === 'avoir' ? 'avoir' : 'autre');
  const imputer = (t: LigneTiers, montant: Decimal | null, mode: Imputation['mode'], partage: boolean, convention: Imputation['convention'] = null): Imputation => ({
    ecriture: refEcriture(t), nature: natureImputation(t), montant: montant ? versChaine(montant) : null, mode, partage, comptee: t.l.ecritureDate <= DA, convention, avoirDocumentId: null, banque: banqueDe(t),
  });
  const parPoste = new Map<string, LigneTiers[]>();
  for (const t of lignesTiers) parPoste.set(t.poste, [...(parPoste.get(t.poste) ?? []), t]);
  const facturesApp = travaux.filter((w) => w.ligne !== null && w.fiche.type === 'facture' && w.ligne.signe.greaterThan(0));
  const motifsNonDeterminable = new Map<string, string>();
  const groupesSoldes = new Set<string>();

  // 6a. Factures lettrées : le lettrage du logiciel de production fait foi.
  for (const w of facturesApp) {
    const L = w.ligne!;
    if (L.l.ecritureLet === null) continue;
    const groupe = (parPoste.get(L.poste) ?? []).filter((t) => t.l.ecritureLet === L.l.ecritureLet);
    const positifs = groupe.filter((t) => t.signe.greaterThan(0));
    const negatifs = groupe.filter((t) => t.signe.lessThan(0));
    const total = groupe.reduce((s, t) => s.plus(t.signe), ZERO);
    if (positifs.length === 1) {
      for (const t of negatifs) w.fiche.imputations.push(imputer(t, t.abs, 'lettrage', false));
    } else if (total.isZero()) {
      const tousComptes = negatifs.every((t) => t.l.ecritureDate <= DA);
      for (const t of negatifs) w.fiche.imputations.push(imputer(t, null, 'lettrage', true));
      if (tousComptes) groupesSoldes.add(w.fiche.id);
      else motifsNonDeterminable.set(w.fiche.id, 'Lettrage groupé dont une partie des règlements est postérieure à la date d’appréciation : la part réglée de cette facture à cette date n’est pas déterminable.');
    } else {
      for (const t of negatifs) w.fiche.imputations.push(imputer(t, null, 'lettrage', true));
      motifsNonDeterminable.set(w.fiche.id, `Lettrage ${L.l.ecritureLet} non soldé (reste ${versChaine(total)}) regroupant ${positifs.length} factures : la répartition entre elles n’est pas déterminable.`);
    }
  }
  // 6b. Factures non lettrées : écritures de règlement ou d'avoir qui citent le numéro de la facture, ou confirmées par une personne.
  const libres = new Map<string, LigneTiers[]>();
  for (const [poste, lignes] of parPoste) {
    const factures = facturesApp.filter((w) => w.ligne!.poste === poste && w.ligne!.l.ecritureLet === null).sort((a, b) => (a.fiche.dateEmission ?? '').localeCompare(b.fiche.dateEmission ?? '') || a.fiche.id.localeCompare(b.fiche.id));
    if (factures.length === 0) continue;
    const propres = new Set(factures.map((w) => w.ligne!.l.id));
    for (const R of lignes) {
      if (!R.signe.lessThan(0) || R.l.ecritureLet !== null || propres.has(R.l.id)) continue;
      const membres: Array<{ w: Travail; source: 'reference' | 'confirmation'; explicite: Decimal | null }> = [];
      for (const w of factures) {
        const ds = decisionsDe(w.fiche.id, 'imputation').filter((d) => d.cible === R.cleE);
        if (ds.some((d) => d.decision === 'infirme')) continue;
        const conf = ds.find((d) => d.decision === 'confirme');
        if (conf) membres.push({ w, source: 'confirmation', explicite: conf.montant && estChaineDecimale(conf.montant) ? dec(conf.montant).abs() : null });
        else if (w.numero && critereReference(R.l, w.numero, p) !== 'absente') membres.push({ w, source: 'reference', explicite: null });
      }
      if (membres.length === 0) { libres.set(poste, [...(libres.get(poste) ?? []), R]); continue; }
      const partage = membres.length > 1;
      let dispo = R.abs;
      for (const m of membres) if (m.explicite) { m.w.fiche.imputations.push(imputer(R, m.explicite, 'confirmation', partage)); dispo = dispo.minus(m.explicite); }
      const reste = membres.filter((m) => !m.explicite);
      if (reste.length === 1 && dispo.greaterThan(0)) reste[0]!.w.fiche.imputations.push(imputer(R, dispo, reste[0]!.source, partage));
      else if (reste.length > 1 && dispo.equals(reste.reduce((s, m) => s.plus(m.w.montant!), ZERO))) for (const m of reste) m.w.fiche.imputations.push(imputer(R, m.w.montant!, m.source, true));
      else {
        for (const m of reste) {
          if (m.source === 'confirmation' && dispo.greaterThan(0)) {
            const part = dispo.lessThan(m.w.montant!) ? dispo : m.w.montant!;
            m.w.fiche.imputations.push(imputer(R, part, 'confirmation', true, 'ordre_chronologique'));
            dispo = dispo.minus(part);
          } else if (m.source === 'reference') {
            m.w.fiche.propositionsImputation.push({ ecriture: refEcriture(R), nature: natureImputation(R), critere: 'reference_multiple', ambigue: true, avoirDocumentId: null });
          }
        }
      }
    }
  }
  // Soldes par facture.
  const regle = (w: Travail): Decimal => w.fiche.imputations.reduce((s, i) => (i.comptee && i.montant !== null ? s.plus(dec(i.montant)) : s), ZERO);
  // 6c. Propositions d'imputation (jamais comptées) : règlement de même montant que le reste dû, avoir du même tiers.
  for (const [poste, lignes] of libres) {
    const factures = facturesApp.filter((w) => w.ligne!.poste === poste && w.ligne!.l.ecritureLet === null);
    const usage = new Map<string, number>();
    const parFacture = new Map<string, LigneTiers[]>();
    for (const w of factures) {
      const reste = w.montant!.minus(regle(w));
      if (!reste.greaterThan(0)) continue;
      const infirmes = new Set(decisionsDe(w.fiche.id, 'imputation').filter((d) => d.decision === 'infirme').map((d) => d.cible));
      const retenus = lignes.filter((R) => !infirmes.has(R.cleE) && (R.nature === 'avoir' ? R.abs.lessThanOrEqualTo(reste) : R.abs.equals(reste)));
      parFacture.set(w.fiche.id, retenus);
      for (const R of retenus) usage.set(R.l.id, (usage.get(R.l.id) ?? 0) + 1);
    }
    for (const w of factures) {
      const retenus = parFacture.get(w.fiche.id) ?? [];
      for (const R of retenus) {
        w.fiche.propositionsImputation.push({
          ecriture: refEcriture(R), nature: natureImputation(R), critere: R.nature === 'avoir' ? 'avoir_meme_tiers' : 'montant_exact', ambigue: retenus.length > 1 || (usage.get(R.l.id) ?? 0) > 1, avoirDocumentId: null,
        });
      }
    }
  }
  // Avoirs suivis : rattachement des imputations à leur pièce.
  const avoirParLigne = new Map<string, Travail>();
  for (const w of travaux) if (w.ligne && w.fiche.type === 'avoir') avoirParLigne.set(w.ligne.l.id, w);
  for (const w of travaux) {
    for (const i of w.fiche.imputations) {
      const a = avoirParLigne.get(i.ecriture.ligneId);
      if (a) { i.avoirDocumentId = a.fiche.id; a.fiche.imputeSur.push({ factureId: w.fiche.id, montant: i.montant }); }
    }
    for (const i of w.fiche.propositionsImputation) i.avoirDocumentId = avoirParLigne.get(i.ecriture.ligneId)?.fiche.id ?? null;
  }

  // ── 7. États ──
  for (const w of travaux) {
    const f = w.fiche;
    const c = f.comptabilisation;
    if (f.dateEcheance !== null && estDateIso(f.dateEcheance)) {
      f.echue = f.dateEcheance < DA;
      f.joursDeRetard = f.echue ? ecartEnJours(f.dateEcheance, DA) : null;
    }
    if (w.ligne) f.tiersCle = w.ligne.cleTiers;
    else if (w.identite) {
      const e = effectifs.get(w.identite.cle);
      f.tiersCle = e && e.size === 1 ? [...e.keys()][0]! : e ? null : `piece:${w.identite.cle}`;
    }
    f.preuves.push({ libelle: 'Pièce', valeur: `${f.nomFichier} (version ${f.versionPiece})` });
    f.preuves.push({ libelle: 'Extraction', valeur: `version ${f.versionExtraction}, ${f.statutExtraction === 'valide' ? 'validée par un réviseur' : 'projet non validé'}` });
    f.preuves.push({ libelle: 'Date d’appréciation', valeur: `${DA} (${demande.origineDateAppreciation === 'cloture_exercice' ? 'clôture de l’exercice' : 'date fournie'})` });
    if (c.ecriture) {
      f.preuves.push({ libelle: 'Écriture', valeur: `${c.ecriture.journalCode} ${c.ecriture.ecritureNum} du ${c.ecriture.ecritureDate}, pièce ${c.ecriture.pieceRef}, ${c.ecriture.montant} au ${c.ecriture.sens === 'debit' ? 'débit' : 'crédit'} du ${c.ecriture.compteNum}${c.ecriture.compAuxNum ? ` / ${c.ecriture.compAuxNum}` : ''}` });
      f.preuves.push({ libelle: 'Lien pièce ↔ écriture', valeur: c.statut === 'confirme' ? 'confirmé par une personne habilitée' : `déduit par le moteur (${criteresEnClair(c.criteres!)})` });
    }
    if (!w.ligne) {
      f.motifEtat = c.statut === 'non_recherche' ? c.motif : `Écriture de comptabilisation non identifiée (${c.statut === 'non_trouve' ? 'aucune correspondance' : c.statut === 'ambigu' ? 'ambiguïté à lever' : 'proposition à confirmer'}) : les règlements ne peuvent pas être recherchés.`;
      continue;
    }
    if (f.type === 'avoir') {
      const L = w.ligne;
      const inconnu = f.imputeSur.some((x) => x.montant === null);
      const total = f.imputeSur.reduce((s, x) => (x.montant ? s.plus(dec(x.montant)) : s), ZERO);
      const groupe = L.l.ecritureLet === null ? [] : (parPoste.get(L.poste) ?? []).filter((t) => t.l.ecritureLet === L.l.ecritureLet);
      const solde = groupe.length > 0 && groupe.reduce((s, t) => s.plus(t.signe), ZERO).isZero();
      if (solde) { f.etat = 'avoir_impute'; f.montantRegle = f.montant; f.resteDu = '0.00'; if (f.imputeSur.length === 0) f.motifEtat = 'Avoir lettré et soldé dans la comptabilité ; la facture d’origine n’est pas une pièce suivie ici.'; }
      else if (inconnu || groupe.length > 0) { f.etat = 'non_determinable'; f.motifEtat = 'Avoir lettré dans un groupe non soldé : le montant imputé n’est pas déterminable.'; }
      else {
        f.montantRegle = versChaine(total);
        f.resteDu = versChaine(w.montant!.minus(total));
        f.etat = total.isZero() ? 'avoir_non_impute' : total.greaterThanOrEqualTo(w.montant!) ? 'avoir_impute' : 'avoir_partiellement_impute';
      }
      continue;
    }
    if (!w.ligne.signe.greaterThan(0)) { f.motifEtat = 'La ligne confirmée n’a pas le sens d’une facture : les règlements ne sont pas recherchés.'; continue; }
    const motif = motifsNonDeterminable.get(f.id);
    if (motif) { f.motifEtat = motif; continue; }
    const paye = groupesSoldes.has(f.id) ? w.montant! : regle(w);
    const reste = (groupesSoldes.has(f.id) ? ZERO : w.ligne.abs.minus(paye));
    f.montantRegle = versChaine(paye);
    f.resteDu = versChaine(reste);
    if (reste.isZero()) f.etat = 'reglee';
    else if (reste.lessThan(0)) { f.etat = 'trop_percu'; f.motifEtat = `Les règlements identifiés dépassent le montant de la facture de ${versChaine(reste.negated())}.`; }
    else if (paye.greaterThan(0)) f.etat = 'partiellement_reglee';
    else if (f.echue === null) { f.etat = 'non_determinable'; f.motifEtat = 'Aucun règlement identifié et échéance non lue sur la pièce : impossible de dire si la facture est échue.'; }
    else f.etat = f.echue ? 'echue_non_reglee' : 'non_echue';
    if (f.etat === 'partiellement_reglee' && f.echue === null) f.motifEtat = 'Échéance non lue sur la pièce : impossible de dire si le reste dû est échu.';
  }

  // ── 8. Suspicions de double comptabilisation ──
  const suspicions = new Map<string, SuspicionDoubleComptabilisation>();
  const decisionSuspicion = new Map(demande.decisionsFactures.filter((d) => d.type === 'suspicion').map((d) => [d.objet, d.decision]));
  const statutSuspicion = (cle: string): SuspicionDoubleComptabilisation['statut'] => (decisionSuspicion.get(cle) === 'confirme' ? 'confirmee' : decisionSuspicion.get(cle) === 'infirme' ? 'ecartee' : 'a_examiner');
  const groupes = new Map<string, LigneTiers[]>();
  for (const t of lignesTiers) {
    if (t.nature !== 'facture' && t.nature !== 'avoir') continue;
    const ref = normaliserReference(t.l.pieceRef);
    if (!ref || ref.length < 3) continue;
    const k = `${t.poste}\u0001${t.nature}\u0001${ref}\u0001${versChaine(t.abs)}`;
    groupes.set(k, [...(groupes.get(k) ?? []), t]);
  }
  const ajouterSuspicionEcritures = (lignes: LigneTiers[], documentIds: string[], reference: string | null) => {
    const uniques = [...new Map(lignes.map((t) => [t.cleE, t])).values()].sort((a, b) => a.cleE.localeCompare(b.cleE));
    if (uniques.length < 2) return;
    const cle = `E:${uniques.map((t) => t.cleE).join('+')}`;
    const existante = suspicions.get(cle);
    if (existante) { existante.documentIds = [...new Set([...existante.documentIds, ...documentIds])].sort(); return; }
    const premiere = uniques[0]!;
    suspicions.set(cle, {
      cle, type: 'ecritures_multiples', tiers: premiere.cleTiers, reference, montant: versChaine(premiere.abs), ecritures: uniques.map(refEcriture), documentIds: [...new Set(documentIds)].sort(),
      explication: `${uniques.length} écritures distinctes portent la même facture (même tiers, même référence, même montant ${versChaine(premiere.abs)}). À vérifier dans le logiciel de production : ce peut être une double comptabilisation ou des opérations répétées légitimes.`,
      statut: statutSuspicion(cle),
    });
  };
  for (const lignes of groupes.values()) {
    const ids = new Set(lignes.map((t) => t.l.id));
    const docs = travaux.filter((w) => (w.ligne && ids.has(w.ligne.l.id)) || (candidatsDe.get(w.fiche.id) ?? []).some((x) => ids.has(x.t.l.id))).map((w) => w.fiche.id);
    ajouterSuspicionEcritures(lignes, docs, lignes[0]!.l.pieceRef);
  }
  for (const w of travaux) {
    if (new Set(w.forts.map((x) => x.ecriture.cle)).size > 1) ajouterSuspicionEcritures(w.forts.map((x) => parId.get(x.ecriture.ligneId)!), [w.fiche.id], w.fiche.numero);
  }
  const piecesParFacture = new Map<string, Travail[]>();
  for (const w of travaux) {
    if (!w.numero || !w.montant) continue;
    const k = `${w.fiche.type}\u0001${w.fiche.sens}\u0001${w.identite?.cle ?? '?'}\u0001${w.numero}\u0001${versChaine(w.montant)}`;
    piecesParFacture.set(k, [...(piecesParFacture.get(k) ?? []), w]);
  }
  for (const ws of piecesParFacture.values()) {
    if (ws.length < 2) continue;
    const ids = ws.map((w) => w.fiche.id).sort();
    const cle = `P:${ids.join('+')}`;
    const premier = ws[0]!;
    const lignes = [...new Map(ws.flatMap((w) => (w.ligne ? [w.ligne] : (candidatsDe.get(w.fiche.id) ?? []).map((x) => x.t))).map((t) => [t.l.id, t])).values()];
    suspicions.set(cle, {
      cle, type: 'pieces_multiples', tiers: premier.identite?.cle ?? null, reference: premier.fiche.numero, montant: versChaine(premier.montant!), ecritures: lignes.map(refEcriture), documentIds: ids,
      explication: `${ws.length} pièces distinctes portent la même facture (même ${premier.identite ? (premier.fiche.roleTiersPiece === 'destinataire' ? 'destinataire' : 'émetteur') : 'sens, émetteur non déterminable'}, même numéro, même montant). Ce ne sont ni un doublon binaire (fichiers différents) ni des versions d’une même pièce : si chacune est comptabilisée, la facture l’est deux fois.`,
      statut: statutSuspicion(cle),
    });
  }
  for (const [objet] of decisionSuspicion) if (!suspicions.has(objet)) aRevoir.push({ type: 'suspicion', objet, cible: 'suspicion', motif: 'Cette suspicion n’existe plus dans les données actuelles.' });
  const listeSuspicions = [...suspicions.values()].sort((a, b) => a.cle.localeCompare(b.cle));
  for (const s of listeSuspicions) for (const id of s.documentIds) parDocument.get(id)?.fiche.suspicions.push(s.cle);

  // ── 9. Fiches de tiers ──
  const fiches = [...comptables.values()].map((b) => b.fiche);
  for (const id of identites.values()) {
    if (effectifs.has(id.cle)) continue;
    fiches.push({
      cle: `piece:${id.cle}`, origine: 'piece', type: id.cotes.size === 2 ? 'mixte' : id.cotes.has('client') ? 'client' : 'fournisseur', nom: id.nom ?? id.cle, compteAuxiliaire: null, comptesGeneraux: [], sansAuxiliaire: false, libelles: [], identifiants: id.identifiants, tiersPieces: [],
      homonymes: [], totalDebit: null, totalCredit: null, solde: null, nbLignes: 0, nbEcritures: 0, pieces: [],
    });
  }
  const ficheParCle = new Map(fiches.map((f) => [f.cle, f]));
  for (const w of travaux) if (w.fiche.tiersCle) ficheParCle.get(w.fiche.tiersCle)?.pieces.push(w.fiche.id);
  fiches.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.cle.localeCompare(b.cle));

  return {
    dateAppreciation: DA,
    origineDateAppreciation: demande.origineDateAppreciation,
    devise: demande.deviseDossier,
    parametres: p,
    tiers: fiches,
    propositionsTiers,
    factures: travaux.map((w) => w.fiche),
    suspicions: listeSuspicions,
    decisionsARevoir: aRevoir,
    reserves,
    mesures: { nbLignes: demande.lignes.length, nbLignesTiers: lignesTiers.length, nbPieces: demande.pieces.length, nbTiers: fiches.length, nbFactures: travaux.length },
  };
}
