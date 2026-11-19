/** Fonctions communes aux lecteurs de relevés : nettoyage, clé d'idempotence, cadrage. */
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { estDateIso } from '../dates.js';
import { dec, estChaineDecimale } from '../montant.js';
import type { SourceRegle } from '../controles/types.js';
import type { AnomalieReleve, CompteReleve, GraviteAnomalieReleve, MouvementBancaire, OptionsLectureReleve, RapportReleve } from './types.js';

export const LONGUEUR_MAX_LIBELLE_BANCAIRE = 500;
export const LONGUEUR_MAX_REFERENCE_BANCAIRE = 140;
/** Taille maximale (en caractères) d'un relevé accepté par les lecteurs. */
export const TAILLE_MAX_RELEVE = 20_000_000;
export const PLAFOND_ANOMALIES_RELEVE = 2000;

/** Caractères de contrôle (C0, DEL, C1), séparateurs de ligne Unicode et marques directionnelles. */
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Nettoie un texte bancaire NON FIABLE : aucun caractère de contrôle, espaces réduits, longueur bornée. */
export function nettoyerTexteBancaire(v: string | null | undefined, max = LONGUEUR_MAX_LIBELLE_BANCAIRE): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROLES, ' ').replace(/[\s\u00a0\u202f]+/g, ' ').trim().slice(0, max);
}

export function referenceOuNull(v: string | null | undefined): string | null {
  const t = nettoyerTexteBancaire(v, LONGUEUR_MAX_REFERENCE_BANCAIRE);
  return t === '' ? null : t;
}

/** Chaîne décimale à 2 décimales au moins, sans perte (jusqu'à 6 décimales), sans zéro négatif. */
export function chaineMontant(d: Decimal): string {
  const s = d.toFixed(Math.min(6, Math.max(2, d.decimalPlaces())));
  return d.isZero() && s.startsWith('-') ? s.slice(1) : s;
}

export type BrouillonMouvement = Omit<MouvementBancaire, 'rang' | 'cleIdempotence'> & { indexCompte: number };

export interface BrouillonCompte {
  iban: string | null;
  identifiant: string | null;
  devise: string | null;
  soldeOuverture: Decimal | null;
  dateOuverture: string | null;
  soldeCloture: Decimal | null;
  dateCloture: string | null;
}

export class CollecteurAnomalies {
  readonly anomalies: AnomalieReleve[] = [];
  bloquant = false;
  private omises = 0;
  signaler(code: string, gravite: GraviteAnomalieReleve, message: string, rang: number | null = null): void {
    if (gravite === 'bloquante') this.bloquant = true;
    if (this.anomalies.length < PLAFOND_ANOMALIES_RELEVE || gravite === 'bloquante') {
      this.anomalies.push({ rang, code, gravite, message: message.slice(0, 600) });
    } else {
      this.omises++;
    }
  }
  terminer(): AnomalieReleve[] {
    if (this.omises > 0) {
      this.anomalies.push({ rang: null, code: 'ANOMALIES_PLAFONNEES', gravite: 'information', message: `${this.omises} anomalie(s) supplémentaire(s) non détaillée(s) au-delà du plafond de ${PLAFOND_ANOMALIES_RELEVE}.` });
      this.omises = 0;
    }
    return this.anomalies;
  }
}

function empreinte(champs: ReadonlyArray<string | null>): string {
  const h = createHash('sha256');
  // Longueur préfixée : aucune collision par concaténation de champs.
  for (const c of champs) h.update(c === null ? '\u0000N;' : `${c.length}:${c};`, 'utf8');
  return h.digest('hex');
}

/** Clé d'idempotence d'un mouvement, hors rang parmi les homonymes. */
function empreinteDeBase(m: BrouillonMouvement): string {
  const compte = m.compte.iban ?? m.compte.identifiant ?? '';
  const montant = chaineMontant(dec(m.montant));
  if (m.referenceBanque !== null) return empreinte(['R', compte, m.dateOperation, montant, m.referenceBanque]);
  return empreinte([
    'E', compte, m.dateOperation, montant, m.libelle, m.dateValeur, m.referenceBoutEnBout,
    m.contrepartie?.nom ?? null, m.contrepartie?.iban ?? null, m.codeOperation,
  ]);
}

/** Applique les compléments fournis par l'appelant aux comptes dépourvus de solde ; signale toute incohérence. */
export function appliquerOptionsSoldes(comptes: BrouillonCompte[], options: OptionsLectureReleve | undefined, anomalies: CollecteurAnomalies): void {
  if (options === undefined) return;
  const fournis = [options.soldeOuverture, options.soldeCloture].filter((v) => v !== undefined);
  if (fournis.length === 0 && options.dateOuverture === undefined && options.dateCloture === undefined) return;
  for (const [nom, v] of [['soldeOuverture', options.soldeOuverture], ['soldeCloture', options.soldeCloture]] as const) {
    if (v !== undefined && !estChaineDecimale(v)) throw new Error(`Option ${nom} invalide : chaîne décimale du type "1234.56" attendue.`);
  }
  for (const [nom, v] of [['dateOuverture', options.dateOuverture], ['dateCloture', options.dateCloture]] as const) {
    if (v !== undefined && !estDateIso(v)) throw new Error(`Option ${nom} invalide : date ISO AAAA-MM-JJ attendue.`);
  }
  if (comptes.length !== 1) {
    anomalies.signaler('OPTIONS_SOLDES_IGNOREES', 'mineure', `Soldes fournis par l'appelant ignorés : le fichier contient ${comptes.length} relevé(s) de compte, l'affectation serait arbitraire.`);
    return;
  }
  const c = comptes[0] as BrouillonCompte;
  if (options.soldeOuverture !== undefined) {
    const d = dec(options.soldeOuverture);
    if (c.soldeOuverture === null) {
      c.soldeOuverture = d;
      anomalies.signaler('SOLDE_OUVERTURE_FOURNI', 'information', "Solde d'ouverture fourni par l'appelant (absent du fichier).");
    } else if (!c.soldeOuverture.equals(d)) {
      anomalies.signaler('SOLDE_OUVERTURE_DIVERGENT', 'majeure', "Le solde d'ouverture fourni par l'appelant diffère de celui du fichier : celui du fichier est conservé.");
    }
  }
  if (options.soldeCloture !== undefined) {
    const d = dec(options.soldeCloture);
    if (c.soldeCloture === null) {
      c.soldeCloture = d;
      anomalies.signaler('SOLDE_CLOTURE_FOURNI', 'information', "Solde de clôture fourni par l'appelant (absent du fichier).");
    } else if (!c.soldeCloture.equals(d)) {
      anomalies.signaler('SOLDE_CLOTURE_DIVERGENT', 'majeure', "Le solde de clôture fourni par l'appelant diffère de celui du fichier : celui du fichier est conservé.");
    }
  }
  if (options.dateOuverture !== undefined && c.dateOuverture === null) c.dateOuverture = options.dateOuverture;
  if (options.dateCloture !== undefined && c.dateCloture === null) c.dateCloture = options.dateCloture;
}

/** Numérote les mouvements, calcule les clés d'idempotence et le cadrage de chaque relevé de compte. */
export function finaliserReleve(
  format: RapportReleve['format'],
  version: string | null,
  comptes: readonly BrouillonCompte[],
  brouillons: readonly BrouillonMouvement[],
  anomalies: CollecteurAnomalies,
  source: SourceRegle,
): RapportReleve {
  const occurrences = new Map<string, number>();
  const totaux = comptes.map(() => ({ total: new Decimal(0), nb: 0 }));
  const mouvements: MouvementBancaire[] = brouillons.map((b, i) => {
    const base = empreinteDeBase(b);
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    const t = totaux[b.indexCompte];
    if (t !== undefined) {
      t.total = t.total.plus(dec(b.montant));
      t.nb++;
    }
    const { indexCompte: _indexCompte, ...reste } = b;
    return { rang: i + 1, ...reste, cleIdempotence: empreinte([base, String(n)]) };
  });
  const comptesFinaux: CompteReleve[] = comptes.map((c, i) => {
    const t = totaux[i] ?? { total: new Decimal(0), nb: 0 };
    const verifiable = c.soldeOuverture !== null && c.soldeCloture !== null;
    const ecart = verifiable ? (c.soldeOuverture as Decimal).plus(t.total).minus(c.soldeCloture as Decimal) : null;
    const cadrage: CompteReleve['cadrage'] = ecart === null ? 'non_verifiable' : ecart.isZero() ? 'ok' : 'ecart';
    const designation = c.iban ?? c.identifiant ?? `n° ${i + 1}`;
    if (cadrage === 'ecart') {
      anomalies.signaler('CADRAGE_ECART', 'majeure', `Compte ${designation} : solde d'ouverture + mouvements ≠ solde de clôture (écart de ${chaineMontant(ecart as Decimal)}).`);
    } else if (cadrage === 'non_verifiable') {
      anomalies.signaler('CADRAGE_NON_VERIFIABLE', 'mineure', `Compte ${designation} : solde d'ouverture ou de clôture absent, cadrage non vérifiable.`);
    }
    return {
      iban: c.iban,
      identifiant: c.identifiant,
      devise: c.devise,
      soldeOuverture: c.soldeOuverture === null ? null : chaineMontant(c.soldeOuverture),
      dateOuverture: c.dateOuverture,
      soldeCloture: c.soldeCloture === null ? null : chaineMontant(c.soldeCloture),
      dateCloture: c.dateCloture,
      totalMouvements: chaineMontant(t.total),
      nbMouvements: t.nb,
      cadrage,
      ecart: ecart === null ? null : chaineMontant(ecart),
    };
  });
  const bloquant = anomalies.bloquant;
  return { format, version, comptes: comptesFinaux, mouvements, anomalies: anomalies.terminer(), lisible: !bloquant, source };
}

export function releveIllisible(format: RapportReleve['format'], version: string | null, anomalies: CollecteurAnomalies, source: SourceRegle): RapportReleve {
  return { format, version, comptes: [], mouvements: [], anomalies: anomalies.terminer(), lisible: false, source };
}
