/**
 * Analyse EN FLUX d'un fichier des écritures comptables (FEC) « à plat ».
 * Tolérant en lecture, strict dans le rapport : une ligne illisible est signalée et
 * comptée, le traitement continue. Mémoire bornée : les lignes normalisées sont
 * remises une à une à `surLigne`, jamais accumulées.
 *
 * Référentiel : LPF art. A47 A-1 (voir SOURCES.fecA47A1) et BOI-CF-IOR-60-40-20.
 */
import { Buffer } from 'node:buffer';
import { Decimal } from 'decimal.js';
import iconv from 'iconv-lite';
import { dateCivileValide, estDateIso, isoDepuisCompact, versIso } from '../dates.js';
import { validerSiren } from '../identifiants.js';
import { analyserMontantFr } from '../montant.js';
import { SOURCES } from '../sources.js';
import type { AnomalieFec, LigneFec, OptionsAnalyseFec, RapportFec, ReferentielFec } from './types.js';

export const PLAFOND_ANOMALIES_FEC = 5000;
/** Garde-fou mémoire : au-delà, la ligne (ou le fichier sans fin de ligne) est refusée. */
export const TAILLE_MAX_LIGNE_FEC = 1_048_576;
/** Garde-fou mémoire du suivi d'équilibre des écritures (écritures déséquilibrées simultanément ouvertes). */
const PLAFOND_ECRITURES_OUVERTES = 200_000;

export const CHAMPS_FEC = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
] as const;

const ALIAS_ENTETES: Readonly<Record<string, string>> = {
  compteauxnum: 'compauxnum',
  compteauxlib: 'compauxlib',
};

type Gravite = AnomalieFec['gravite'];
interface DefCode { gravite: Gravite; referentiel: boolean; description: string }

/** Contrôles implémentés. `referentiel: true` = écart au référentiel A47 A-1 / BOFiP (rend le fichier non conforme). */
export const CODES_ANOMALIES_FEC = {
  FICHIER_VIDE: { gravite: 'bloquante', referentiel: true, description: 'Fichier vide ou sans ligne d’en-tête (A47 A-1, I : la première ligne contient le nom des champs).' },
  ENCODAGE_ILLISIBLE: { gravite: 'bloquante', referentiel: true, description: 'Fichier UTF-16 ou binaire : jeu de caractères non admis (A47 A-1, XII, 1°) et non lu.' },
  ENCODAGE_NON_CONFORME: { gravite: 'majeure', referentiel: true, description: 'Jeu de caractères Windows-1252 détecté : lu, mais hors liste admise (ASCII, ISO 8859-15, UTF-8 ; A47 A-1, XII, 1°).' },
  ENCODAGE_INCONNU: { gravite: 'majeure', referentiel: true, description: 'Jeu de caractères indéterminé (mélange de lignes UTF-8 et non UTF-8).' },
  ENCODAGE_BOM: { gravite: 'information', referentiel: false, description: 'Marque d’ordre d’octets (BOM) UTF-8 en tête de fichier : ignorée à la lecture.' },
  SEPARATEUR_INCONNU: { gravite: 'bloquante', referentiel: true, description: 'Aucun séparateur de zone reconnu dans l’en-tête.' },
  SEPARATEUR_NON_CONFORME: { gravite: 'majeure', referentiel: true, description: 'Séparateur point-virgule : lu, mais seuls la tabulation et « | » sont admis (A47 A-1, VI, 1°, c).' },
  ENTETE_CHAMP_ESSENTIEL_MANQUANT: { gravite: 'bloquante', referentiel: true, description: 'Champ indispensable à la lecture absent de l’en-tête (JournalCode, EcritureNum, EcritureDate, CompteNum, Debit/Credit ou Montant/Sens).' },
  ENTETE_CHAMP_MANQUANT: { gravite: 'majeure', referentiel: true, description: 'Un des 18 champs obligatoires est absent de l’en-tête (A47 A-1, VII).' },
  ENTETE_ORDRE: { gravite: 'majeure', referentiel: true, description: 'Les 18 premiers champs ne sont pas dans l’ordre prévu (A47 A-1, VII).' },
  ENTETE_CHAMP_DUPLIQUE: { gravite: 'majeure', referentiel: true, description: 'Nom de champ présent plusieurs fois dans l’en-tête.' },
  ENTETE_ALIAS: { gravite: 'information', referentiel: false, description: 'Nom de champ accepté sous une variante d’écriture (ex. CompteAuxNum pour CompAuxNum).' },
  ENTETE_CHAMP_SUPPLEMENTAIRE: { gravite: 'information', referentiel: false, description: 'Champ supplémentaire au-delà des 18 champs (non interprété).' },
  LIGNE_TROP_LONGUE: { gravite: 'bloquante', referentiel: true, description: 'Ligne dépassant la taille maximale admise par le lecteur : lecture interrompue.' },
  LIGNE_VIDE: { gravite: 'information', referentiel: false, description: 'Ligne vide au milieu du fichier : ignorée.' },
  NB_CHAMPS: { gravite: 'majeure', referentiel: true, description: 'Nombre de zones différent de celui de l’en-tête.' },
  LIGNE_ILLISIBLE: { gravite: 'majeure', referentiel: true, description: 'Ligne non normalisable (date d’écriture, montant ou sens illisible, zones en trop) : comptée et écartée.' },
  CHAMP_OBLIGATOIRE_VIDE: { gravite: 'mineure', referentiel: true, description: 'Champ obligatoire non renseigné (seuls les champs 7, 8, 14, 15, 17 et 18 peuvent être à blanc ; A47 A-1, VII).' },
  DATE_FORMAT: { gravite: 'majeure', referentiel: true, description: 'Date lue dans un format autre que AAAAMMJJ (A47 A-1, XII, 2°).' },
  DATE_INVALIDE: { gravite: 'majeure', referentiel: true, description: 'Date facultative illisible : valeur ignorée (null).' },
  MONTANT_SEPARATEUR_POINT: { gravite: 'mineure', referentiel: true, description: 'Montant à point décimal : lu, mais la virgule est requise (A47 A-1, XII, 2°).' },
  MONTANT_VIDE: { gravite: 'mineure', referentiel: true, description: 'Débit ou crédit vide : lu comme zéro, mais la zone doit contenir zéro (BOI-CF-IOR-60-40-20).' },
  MONTANT_FORMAT: { gravite: 'majeure', referentiel: true, description: 'Montant avec séparateur de milliers ou espaces : lu, mais non conforme (A47 A-1, XII, 2°).' },
  MONTANT_DEVISE_ILLISIBLE: { gravite: 'mineure', referentiel: true, description: 'Montant en devise illisible : valeur ignorée (null).' },
  MONTANT_NEGATIF_NORMALISE: { gravite: 'information', referentiel: false, description: 'Montant négatif (admis par le texte) reporté dans le sens opposé pour obtenir débit et crédit ≥ 0.' },
  DEBIT_ET_CREDIT: { gravite: 'mineure', referentiel: false, description: 'Débit et crédit tous deux non nuls sur la même ligne.' },
  ECRITURE_DESEQUILIBREE: { gravite: 'majeure', referentiel: false, description: 'Écriture (journal + numéro) dont le total débit diffère du total crédit.' },
  DESEQUILIBRE_GLOBAL: { gravite: 'majeure', referentiel: false, description: 'Total des débits différent du total des crédits.' },
  DATE_HORS_EXERCICE: { gravite: 'majeure', referentiel: false, description: 'Date d’écriture hors de l’exercice indiqué par l’appelant.' },
  NOM_FICHIER_FORMAT: { gravite: 'majeure', referentiel: true, description: 'Nom de fichier ne respectant pas la nomenclature SirenFECAAAAMMJJ (A47 A-1, IX).' },
  NOM_FICHIER_SIREN: { gravite: 'majeure', referentiel: true, description: 'SIREN du nom de fichier invalide ou différent du SIREN attendu.' },
  NOM_FICHIER_DATE: { gravite: 'majeure', referentiel: true, description: 'Date du nom de fichier invalide ou différente de la date de clôture attendue.' },
  NOM_FICHIER_SUFFIXE: { gravite: 'information', referentiel: false, description: 'Suffixe après la date dans le nom de fichier (découpage en plusieurs fichiers, cf. BOFiP).' },
} as const satisfies Record<string, DefCode>;

export type CodeAnomalieFec = keyof typeof CODES_ANOMALIES_FEC;

export const CONTROLES_FEC_NON_IMPLEMENTES: readonly string[] = [
  'Format XML (XSD publié par l’administration) : non lu.',
  'Fichiers à zones de longueur fixe et jeu de caractères EBCDIC : non lus.',
  'Classement des écritures par ordre chronologique de validation et écritures de reprise des à-nouveaux en tête : non contrôlés.',
  'Champs 19 à 22 des régimes BA/BNC en comptabilité de trésorerie (DateRglt, ModeRglt, NatOp, IdClient) et champ CodeEtbt : acceptés mais non interprétés.',
  'Présence du descriptif accompagnant le fichier (codifications propres à l’entreprise) : hors fichier, non contrôlable.',
  'Découpage en plusieurs fichiers et cohérence d’ensemble d’un jeu de fichiers : non contrôlés.',
  'Cadrage à gauche des zones alphanumériques et absence du caractère séparateur dans les zones : non contrôlés (un séparateur en trop se traduit par une ligne illisible).',
  'Continuité de la numérotation EcritureNum, caractère intangible des écritures validées, concordance avec la liasse : non contrôlés ici (voir contrôles de révision).',
  'Conformité des numéros de compte au plan comptable (PCG) : non contrôlée.',
  'Distinction Windows-1252 / ISO 8859-15 lorsque le fichier ne contient aucun octet 0x80–0x9F : impossible, le fichier est alors déclaré ISO 8859-15.',
];

export function referentielFec(): ReferentielFec {
  return {
    ...SOURCES.fecA47A1,
    sourcesComplementaires: [SOURCES.fecBofip],
    controlesImplementes: Object.entries(CODES_ANOMALIES_FEC).map(([code, d]) => ({
      code,
      description: d.description,
      ecartAuReferentiel: d.referentiel,
    })),
    controlesNonImplementes: [...CONTROLES_FEC_NON_IMPLEMENTES],
  };
}

const MOTIF_MONTANT = /^([+-]?)(\d+)(?:([.,])(\d*))?([+-]?)$/;

interface MontantLu { valeur: Decimal; point: boolean; tolere: boolean }

function lireMontant(brut: string): MontantLu | null {
  const m = MOTIF_MONTANT.exec(brut);
  if (m) {
    const signeG = m[1] ?? '';
    const entier = (m[2] ?? '').replace(/^0+(?=\d)/, '');
    const decimales = m[4] ?? '';
    const signeD = m[5] ?? '';
    if (signeG !== '' && signeD !== '') return null;
    if (entier.length > 13 || decimales.length > 6) return null;
    const negatif = signeG === '-' || signeD === '-';
    const d = new Decimal(decimales === '' ? entier : `${entier}.${decimales}`);
    return { valeur: negatif ? d.negated() : d, point: m[3] === '.', tolere: false };
  }
  const d = analyserMontantFr(brut);
  return d === null ? null : { valeur: d, point: false, tolere: true };
}

function chaineMontant(d: Decimal): string {
  const s = d.toFixed(Math.max(2, d.decimalPlaces()));
  return s.startsWith('-') && d.isZero() ? s.slice(1) : s;
}

interface DateLue { iso: string; conforme: boolean }

function lireDate(brut: string): DateLue | null {
  const compact = isoDepuisCompact(brut);
  if (compact !== null) return { iso: compact, conforme: true };
  if (estDateIso(brut)) return { iso: brut, conforme: false };
  const fr = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(brut);
  if (fr) {
    const j = Number(fr[1]);
    const mo = Number(fr[2]);
    const a = Number(fr[3]);
    if (dateCivileValide(a, mo, j)) return { iso: versIso(a, mo, j), conforme: false };
  }
  return null;
}

function exigerIso(valeur: string | undefined, nom: string): string | null {
  if (valeur === undefined) return null;
  if (!estDateIso(valeur)) throw new Error(`Option ${nom} invalide : date ISO AAAA-MM-JJ attendue.`);
  return valeur;
}

export async function analyserFec(
  source: AsyncIterable<Uint8Array>,
  options: OptionsAnalyseFec = {},
): Promise<RapportFec> {
  const exerciceDebut = exigerIso(options.exerciceDebut, 'exerciceDebut');
  const exerciceFin = exigerIso(options.exerciceFin, 'exerciceFin');
  const surLigne = options.surLigne;

  const anomalies: AnomalieFec[] = [];
  const nbAnomaliesParCode: Record<string, number> = {};
  let ecartReferentiel = false;
  let bloquant = false;

  const signaler = (code: CodeAnomalieFec, ligne: number | null, colonne: string | null, message: string): void => {
    const def = CODES_ANOMALIES_FEC[code];
    nbAnomaliesParCode[code] = (nbAnomaliesParCode[code] ?? 0) + 1;
    if (def.referentiel) ecartReferentiel = true;
    if (def.gravite === 'bloquante') bloquant = true;
    if (anomalies.length < PLAFOND_ANOMALIES_FEC) anomalies.push({ ligne, colonne, code, gravite: def.gravite, message });
  };

  // --- Nom de fichier -------------------------------------------------------
  if (options.siren !== undefined && !validerSiren(options.siren).valide) {
    throw new Error('Option siren invalide : 9 chiffres avec clé de Luhn attendus.');
  }
  if (options.nomFichier !== undefined) {
    const base = options.nomFichier.replace(/^.*[\\/]/, '');
    const m = /^(\d{9})FEC(\d{8})([_-][A-Za-z0-9]+)?(\.[A-Za-z0-9]{1,5})?$/i.exec(base);
    if (!m) {
      signaler('NOM_FICHIER_FORMAT', null, null, `Nom de fichier « ${base} » : nomenclature SirenFECAAAAMMJJ non respectée.`);
    } else {
      const sirenNom = m[1] ?? '';
      const dateNom = isoDepuisCompact(m[2] ?? '');
      if (!/^\d{9}FEC/.test(base)) signaler('NOM_FICHIER_FORMAT', null, null, 'Nom de fichier : « FEC » doit être en majuscules.');
      if (!validerSiren(sirenNom).valide) {
        signaler('NOM_FICHIER_SIREN', null, null, `Nom de fichier : le SIREN ${sirenNom} a une clé de contrôle incorrecte.`);
      } else if (options.siren !== undefined && options.siren.replace(/\s/g, '') !== sirenNom) {
        signaler('NOM_FICHIER_SIREN', null, null, `Nom de fichier : SIREN ${sirenNom} différent du SIREN attendu.`);
      }
      if (dateNom === null) {
        signaler('NOM_FICHIER_DATE', null, null, `Nom de fichier : « ${m[2] ?? ''} » n'est pas une date AAAAMMJJ valide.`);
      } else if (exerciceFin !== null && dateNom !== exerciceFin) {
        signaler('NOM_FICHIER_DATE', null, null, `Nom de fichier : date ${dateNom} différente de la clôture attendue ${exerciceFin}.`);
      }
      if (m[3] !== undefined) signaler('NOM_FICHIER_SUFFIXE', null, null, `Nom de fichier : suffixe « ${m[3]} » après la date.`);
    }
  }

  // --- État de lecture ------------------------------------------------------
  let numeroLigne = 0;
  let enteteLue = false;
  let entetes: string[] = [];
  let separateur: RapportFec['separateur'] = 'inconnu';
  let caractereSep = '\t';
  let variante: RapportFec['variante'] = 'debit_credit';
  let normalisable = false;
  let nbLignesLues = 0;
  let nbLignesNormalisees = 0;
  let nbLignesRejetees = 0;
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  let bom = false;
  let nbLignesUtf8 = 0;
  let nbLignesAutres = 0;
  let octetsC1 = false;
  let lignesVidesEnAttente: number[] = [];
  const idx: Record<string, number> = {};
  const decodeurUtf8 = new TextDecoder('utf-8', { fatal: true });
  const ecrituresOuvertes = new Map<string, { solde: Decimal; premiereLigne: number }>();
  let suiviEquilibreSature = false;

  const decoder = (octets: Uint8Array, nonAscii: boolean, c1: boolean): string => {
    const tampon = Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
    if (!nonAscii) return tampon.toString('latin1');
    try {
      const texte = decodeurUtf8.decode(octets);
      nbLignesUtf8++;
      return texte;
    } catch {
      nbLignesAutres++;
      if (c1) octetsC1 = true;
      return iconv.decode(tampon, c1 ? 'windows-1252' : 'ISO-8859-15');
    }
  };

  const champ = (zones: string[], nom: string): string => {
    const i = idx[nom];
    if (i === undefined) return '';
    return (zones[i] ?? '').trim();
  };

  const traiterEntete = (texte: string): void => {
    const nbTab = texte.split('\t').length - 1;
    const nbPipe = texte.split('|').length - 1;
    const nbPv = texte.split(';').length - 1;
    if (nbTab === 0 && nbPipe === 0 && nbPv === 0) {
      signaler('SEPARATEUR_INCONNU', 1, null, 'En-tête sans tabulation ni « | » : séparateur de zone non reconnu.');
      entetes = [texte.trim()];
      return;
    }
    if (nbTab >= nbPipe && nbTab >= nbPv) {
      separateur = 'tabulation';
      caractereSep = '\t';
    } else if (nbPipe >= nbPv) {
      separateur = 'pipe';
      caractereSep = '|';
    } else {
      separateur = 'point_virgule';
      caractereSep = ';';
      signaler('SEPARATEUR_NON_CONFORME', 1, null, 'Séparateur point-virgule détecté : seuls la tabulation et « | » sont admis.');
    }
    entetes = texte.split(caractereSep).map((e) => e.trim());
    const canoniques = entetes.map((e) => {
      const bas = e.toLowerCase();
      const alias = ALIAS_ENTETES[bas];
      if (alias !== undefined) signaler('ENTETE_ALIAS', 1, e, `Champ « ${e} » accepté comme variante de « ${alias} ».`);
      return alias ?? bas;
    });
    canoniques.forEach((c, i) => {
      if (c === '') return;
      if (idx[c] !== undefined) signaler('ENTETE_CHAMP_DUPLIQUE', 1, entetes[i] ?? c, `Champ « ${entetes[i] ?? c} » présent plusieurs fois.`);
      else idx[c] = i;
    });
    const aDebitCredit = idx['debit'] !== undefined && idx['credit'] !== undefined;
    const aMontantSens = idx['montant'] !== undefined && idx['sens'] !== undefined;
    variante = !aDebitCredit && aMontantSens ? 'montant_sens' : 'debit_credit';
    const attendus: string[] = CHAMPS_FEC.map((c) => c.toLowerCase());
    if (variante === 'montant_sens') {
      attendus[11] = 'montant';
      attendus[12] = 'sens';
    }
    const essentiels = new Set(['journalcode', 'ecriturenum', 'ecrituredate', 'comptenum', attendus[11] ?? '', attendus[12] ?? '']);
    let essentielManquant = false;
    for (const [i, nom] of attendus.entries()) {
      if (idx[nom] !== undefined) continue;
      const lisibleNom = variante === 'montant_sens' && (i === 11 || i === 12) ? nom : (CHAMPS_FEC[i] ?? nom);
      if (essentiels.has(nom)) {
        essentielManquant = true;
        signaler('ENTETE_CHAMP_ESSENTIEL_MANQUANT', 1, lisibleNom, `Champ indispensable « ${lisibleNom} » absent de l'en-tête.`);
      } else {
        signaler('ENTETE_CHAMP_MANQUANT', 1, lisibleNom, `Champ obligatoire « ${lisibleNom} » absent de l'en-tête.`);
      }
    }
    if (attendus.every((nom) => idx[nom] !== undefined) && !attendus.every((nom, i) => canoniques[i] === nom)) {
      signaler('ENTETE_ORDRE', 1, null, 'Les 18 premiers champs ne sont pas dans l’ordre prévu par l’article A47 A-1.');
    }
    const connus = new Set(attendus);
    canoniques.forEach((c, i) => {
      if (c !== '' && !connus.has(c)) {
        signaler('ENTETE_CHAMP_SUPPLEMENTAIRE', 1, entetes[i] ?? c, `Champ supplémentaire « ${entetes[i] ?? c} » non interprété.`);
      }
    });
    normalisable = !essentielManquant;
  };

  const dateFacultative = (zones: string[], nom: string, libelle: string, obligatoire: boolean): string | null => {
    const brut = champ(zones, nom);
    if (brut === '') {
      if (obligatoire && idx[nom] !== undefined) signaler('CHAMP_OBLIGATOIRE_VIDE', numeroLigne, libelle, `${libelle} non renseigné.`);
      return null;
    }
    const d = lireDate(brut);
    if (d === null) {
      signaler('DATE_INVALIDE', numeroLigne, libelle, `${libelle} illisible (« ${brut.slice(0, 20)} ») : valeur ignorée.`);
      return null;
    }
    if (!d.conforme) signaler('DATE_FORMAT', numeroLigne, libelle, `${libelle} lu au format « ${brut} » au lieu de AAAAMMJJ.`);
    return d.iso;
  };

  const rejeter = (colonne: string | null, message: string): void => {
    nbLignesRejetees++;
    signaler('LIGNE_ILLISIBLE', numeroLigne, colonne, message);
  };

  const montantObligatoire = (zones: string[], nom: string, libelle: string): Decimal | null => {
    const brut = champ(zones, nom);
    if (brut === '') {
      signaler('MONTANT_VIDE', numeroLigne, libelle, `${libelle} vide : lu comme zéro.`);
      return new Decimal(0);
    }
    const m = lireMontant(brut);
    if (m === null) {
      rejeter(libelle, `${libelle} illisible (« ${brut.slice(0, 30)} ») : ligne écartée.`);
      return null;
    }
    if (m.tolere) signaler('MONTANT_FORMAT', numeroLigne, libelle, `${libelle} « ${brut} » lu malgré un format non conforme.`);
    else if (m.point) signaler('MONTANT_SEPARATEUR_POINT', numeroLigne, libelle, `${libelle} à point décimal (« ${brut} »).`);
    return m.valeur;
  };

  const traiterDonnee = (texte: string): void | Promise<void> => {
    nbLignesLues++;
    if (!normalisable) return;
    const zones = texte.split(caractereSep);
    if (zones.length !== entetes.length) {
      signaler('NB_CHAMPS', numeroLigne, null, `${zones.length} zones lues pour ${entetes.length} champs d'en-tête.`);
      if (zones.length > entetes.length) {
        rejeter(null, 'Zones en trop (séparateur présent dans une zone ?) : ligne écartée.');
        return;
      }
    }
    const brutDate = champ(zones, 'ecrituredate');
    const dateEcriture = lireDate(brutDate);
    if (dateEcriture === null) {
      rejeter('EcritureDate', `EcritureDate illisible (« ${brutDate.slice(0, 20)} ») : ligne écartée.`);
      return;
    }
    let debit: Decimal;
    let credit: Decimal;
    if (variante === 'debit_credit') {
      const d = montantObligatoire(zones, 'debit', 'Debit');
      if (d === null) return;
      const c = montantObligatoire(zones, 'credit', 'Credit');
      if (c === null) return;
      if (d.isNegative() || c.isNegative()) {
        signaler('MONTANT_NEGATIF_NORMALISE', numeroLigne, null, 'Montant négatif reporté dans le sens opposé.');
      }
      const zero = new Decimal(0);
      debit = Decimal.max(d, zero).plus(Decimal.max(c.negated(), zero));
      credit = Decimal.max(c, zero).plus(Decimal.max(d.negated(), zero));
      if (!d.isZero() && !c.isZero()) signaler('DEBIT_ET_CREDIT', numeroLigne, null, 'Débit et crédit tous deux non nuls.');
    } else {
      const montant = montantObligatoire(zones, 'montant', 'Montant');
      if (montant === null) return;
      const sens = champ(zones, 'sens').toUpperCase();
      // Interprétation retenue : « D » ou « +1 » = débit ; « C » ou « -1 » = crédit.
      let auDebit: boolean;
      if (sens === 'D' || sens === '+1') auDebit = true;
      else if (sens === 'C' || sens === '-1') auDebit = false;
      else {
        rejeter('Sens', `Sens « ${sens.slice(0, 10)} » non admis (D, C, +1 ou -1) : ligne écartée.`);
        return;
      }
      if (montant.isNegative()) {
        signaler('MONTANT_NEGATIF_NORMALISE', numeroLigne, 'Montant', 'Montant négatif reporté dans le sens opposé.');
        auDebit = !auDebit;
      }
      const abs = montant.abs();
      debit = auDebit ? abs : new Decimal(0);
      credit = auDebit ? new Decimal(0) : abs;
    }
    if (!dateEcriture.conforme) signaler('DATE_FORMAT', numeroLigne, 'EcritureDate', `EcritureDate lue au format « ${brutDate} » au lieu de AAAAMMJJ.`);

    const texteObligatoire = (nom: string, libelle: string): string => {
      const v = champ(zones, nom);
      if (v === '' && idx[nom] !== undefined) signaler('CHAMP_OBLIGATOIRE_VIDE', numeroLigne, libelle, `${libelle} non renseigné.`);
      return v;
    };
    const texteFacultatif = (nom: string): string | null => {
      const v = champ(zones, nom);
      return v === '' ? null : v;
    };
    let montantDevise: string | null = null;
    const brutDevise = champ(zones, 'montantdevise');
    if (brutDevise !== '') {
      const m = lireMontant(brutDevise);
      if (m === null) signaler('MONTANT_DEVISE_ILLISIBLE', numeroLigne, 'Montantdevise', `Montantdevise illisible (« ${brutDevise.slice(0, 30)} »).`);
      else montantDevise = chaineMontant(m.valeur);
    }

    const ligne: LigneFec = {
      numeroLigne,
      journalCode: texteObligatoire('journalcode', 'JournalCode'),
      journalLib: texteObligatoire('journallib', 'JournalLib'),
      ecritureNum: texteObligatoire('ecriturenum', 'EcritureNum'),
      ecritureDate: dateEcriture.iso,
      compteNum: texteObligatoire('comptenum', 'CompteNum'),
      compteLib: texteObligatoire('comptelib', 'CompteLib'),
      compAuxNum: texteFacultatif('compauxnum'),
      compAuxLib: texteFacultatif('compauxlib'),
      pieceRef: texteObligatoire('pieceref', 'PieceRef'),
      pieceDate: dateFacultative(zones, 'piecedate', 'PieceDate', true),
      ecritureLib: texteObligatoire('ecriturelib', 'EcritureLib'),
      debit: chaineMontant(debit),
      credit: chaineMontant(credit),
      ecritureLet: texteFacultatif('ecriturelet'),
      dateLet: dateFacultative(zones, 'datelet', 'DateLet', false),
      validDate: dateFacultative(zones, 'validdate', 'ValidDate', true),
      montantDevise,
      idevise: texteFacultatif('idevise'),
    };

    nbLignesNormalisees++;
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    if (dateMin === null || ligne.ecritureDate < dateMin) dateMin = ligne.ecritureDate;
    if (dateMax === null || ligne.ecritureDate > dateMax) dateMax = ligne.ecritureDate;
    if ((exerciceDebut !== null && ligne.ecritureDate < exerciceDebut) || (exerciceFin !== null && ligne.ecritureDate > exerciceFin)) {
      signaler('DATE_HORS_EXERCICE', numeroLigne, 'EcritureDate', `Date d'écriture ${ligne.ecritureDate} hors de l'exercice.`);
    }
    const mouvement = debit.minus(credit);
    if (!mouvement.isZero() && !suiviEquilibreSature) {
      const cle = `${ligne.journalCode}\u0000${ligne.ecritureNum}`;
      const ouverte = ecrituresOuvertes.get(cle);
      if (ouverte === undefined) {
        if (ecrituresOuvertes.size >= PLAFOND_ECRITURES_OUVERTES) suiviEquilibreSature = true;
        else ecrituresOuvertes.set(cle, { solde: mouvement, premiereLigne: numeroLigne });
      } else {
        const solde = ouverte.solde.plus(mouvement);
        if (solde.isZero()) ecrituresOuvertes.delete(cle);
        else ouverte.solde = solde;
      }
    }
    if (surLigne) return surLigne(ligne);
  };

  /** Traite une ligne physique. Retourne false pour interrompre la lecture. */
  const traiterLigne = (octets: Uint8Array, nonAscii: boolean, c1: boolean): void | Promise<void> => {
    numeroLigne++;
    if (octets.length === 0) {
      if (enteteLue && lignesVidesEnAttente.length < 1000) lignesVidesEnAttente.push(numeroLigne);
      return;
    }
    const texte = decoder(octets, nonAscii, c1);
    if (texte.trim() === '') {
      if (enteteLue && lignesVidesEnAttente.length < 1000) lignesVidesEnAttente.push(numeroLigne);
      return;
    }
    if (!enteteLue) {
      enteteLue = true;
      // L'en-tête porte le numéro de ligne 1 même si des lignes vides le précèdent.
      numeroLigne = 1;
      traiterEntete(texte);
      return;
    }
    // Les lignes vides ne sont signalées que si des données les suivent (pas en fin de fichier).
    if (lignesVidesEnAttente.length > 0) {
      for (const n of lignesVidesEnAttente) signaler('LIGNE_VIDE', n, null, 'Ligne vide ignorée.');
      lignesVidesEnAttente = [];
    }
    return traiterDonnee(texte);
  };

  // --- Lecture en flux, découpage en lignes au niveau des octets -------------
  let morceaux: Uint8Array[] = [];
  let tailleEnAttente = 0;
  let nonAsciiEnAttente = false;
  let c1EnAttente = false;
  let apresCR = false;
  let debutFichier = true;
  let interrompu = false;
  let prefixe: Uint8Array | null = null;

  const assembler = (fin: Uint8Array): Uint8Array => {
    if (morceaux.length === 0) return fin;
    const total = new Uint8Array(tailleEnAttente + fin.length);
    let pos = 0;
    for (const m of morceaux) {
      total.set(m, pos);
      pos += m.length;
    }
    total.set(fin, pos);
    morceaux = [];
    tailleEnAttente = 0;
    return total;
  };

  for await (const bloc of source) {
    if (interrompu) break;
    let chunk: Uint8Array = bloc;
    if (debutFichier) {
      // On attend au moins 3 octets pour reconnaître une marque d'ordre d'octets.
      if (prefixe !== null) {
        const fusion = new Uint8Array(prefixe.length + chunk.length);
        fusion.set(prefixe, 0);
        fusion.set(chunk, prefixe.length);
        chunk = fusion;
        prefixe = null;
      }
      if (chunk.length < 3) {
        prefixe = chunk.slice();
        continue;
      }
      debutFichier = false;
      if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
        bom = true;
        chunk = chunk.subarray(3);
      } else if ((chunk[0] === 0xff && chunk[1] === 0xfe) || (chunk[0] === 0xfe && chunk[1] === 0xff)) {
        signaler('ENCODAGE_ILLISIBLE', null, null, 'Marque UTF-16 détectée : fichier non lu.');
        interrompu = true;
        break;
      }
    }
    let debut = 0;
    const n = chunk.length;
    for (let i = 0; i < n; i++) {
      const b = chunk[i] as number;
      if (b === 10 || b === 13) {
        if (b === 10 && apresCR) {
          apresCR = false;
          debut = i + 1;
          continue;
        }
        apresCR = b === 13;
        const ligne = assembler(chunk.subarray(debut, i));
        const p = traiterLigne(ligne, nonAsciiEnAttente, c1EnAttente);
        if (p !== undefined) await p;
        nonAsciiEnAttente = false;
        c1EnAttente = false;
        debut = i + 1;
        if (bloquant) {
          interrompu = true;
          break;
        }
      } else {
        apresCR = false;
        if (b >= 0x80) {
          nonAsciiEnAttente = true;
          if (b <= 0x9f) c1EnAttente = true;
        } else if (b === 0 && !enteteLue) {
          signaler('ENCODAGE_ILLISIBLE', null, null, 'Octet nul dans l’en-tête : fichier binaire ou UTF-16, non lu.');
          interrompu = true;
          break;
        }
      }
    }
    if (interrompu) break;
    if (debut < n) {
      // Copie : le bloc d'origine peut être réutilisé par l'appelant.
      const reste = chunk.slice(debut);
      morceaux.push(reste);
      tailleEnAttente += reste.length;
      if (tailleEnAttente > TAILLE_MAX_LIGNE_FEC) {
        signaler('LIGNE_TROP_LONGUE', numeroLigne + 1, null, `Ligne de plus de ${TAILLE_MAX_LIGNE_FEC} octets : lecture interrompue.`);
        morceaux = [];
        tailleEnAttente = 0;
        interrompu = true;
      }
    }
  }
  if (!interrompu) {
    if (prefixe !== null) {
      morceaux.push(prefixe);
      tailleEnAttente += prefixe.length;
      for (const b of prefixe) if (b >= 0x80) nonAsciiEnAttente = true;
    }
    if (tailleEnAttente > 0) {
      const p = traiterLigne(assembler(new Uint8Array(0)), nonAsciiEnAttente, c1EnAttente);
      if (p !== undefined) await p;
    }
  }

  // --- Synthèse --------------------------------------------------------------
  if (!enteteLue && !bloquant) signaler('FICHIER_VIDE', null, null, 'Fichier vide : aucune ligne d’en-tête.');

  let encodage: string;
  if (nbLignesUtf8 > 0 && nbLignesAutres > 0) encodage = 'inconnu';
  else if (nbLignesAutres > 0) encodage = octetsC1 ? 'windows-1252' : 'iso-8859-15';
  else if (bom) encodage = 'utf-8-bom';
  else if (nbLignesUtf8 > 0) encodage = 'utf-8';
  else encodage = enteteLue ? 'ascii' : 'inconnu';
  if (bom) signaler('ENCODAGE_BOM', null, null, 'Marque d’ordre d’octets UTF-8 présente en tête de fichier.');
  if (encodage === 'windows-1252') {
    signaler('ENCODAGE_NON_CONFORME', null, null, 'Octets 0x80–0x9F détectés : fichier lu en Windows-1252, jeu de caractères non admis.');
  } else if (encodage === 'inconnu' && enteteLue) {
    signaler('ENCODAGE_INCONNU', null, null, 'Mélange de lignes UTF-8 valides et de lignes non UTF-8 : jeu de caractères indéterminé.');
  }

  for (const [cle, ouverte] of ecrituresOuvertes) {
    const [journal, num] = cle.split('\u0000');
    signaler(
      'ECRITURE_DESEQUILIBREE',
      ouverte.premiereLigne,
      null,
      `Écriture ${journal ?? ''}/${num ?? ''} déséquilibrée : débit − crédit = ${chaineMontant(ouverte.solde)}.`,
    );
  }
  if (!totalDebit.equals(totalCredit)) {
    signaler('DESEQUILIBRE_GLOBAL', null, null, `Total débit ${chaineMontant(totalDebit)} ≠ total crédit ${chaineMontant(totalCredit)}.`);
  }

  const lisible = nbLignesNormalisees > 0;
  return {
    encodage,
    separateur,
    variante,
    entetes,
    nbLignesLues,
    nbLignesNormalisees,
    anomalies,
    nbAnomaliesParCode,
    lisible,
    conforme: enteteLue && !ecartReferentiel,
    suffisantPourTravaux: lisible && !bloquant && nbLignesRejetees === 0 && !suiviEquilibreSature,
    totalDebit: chaineMontant(totalDebit),
    totalCredit: chaineMontant(totalCredit),
    dateMin,
    dateMax,
    referentiel: referentielFec(),
  };
}

/** Utilitaire : présente un tampon en mémoire comme un flux de blocs (tests, petits fichiers). */
export async function* enBlocs(contenu: Uint8Array, tailleBloc = 65_536): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < contenu.length; i += tailleBloc) {
    yield contenu.subarray(i, Math.min(contenu.length, i + tailleBloc));
  }
}
