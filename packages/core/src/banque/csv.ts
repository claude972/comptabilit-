/**
 * Lecture d'un export CSV de banque selon un PROFIL explicite (colonnes, format de date, décimale).
 * Il n'existe aucun standard : le profil est toujours confirmé par un humain ; `proposerProfilCsv`
 * ne fait qu'une proposition prudente à partir des en-têtes et s'abstient (null) au moindre doute.
 *
 * Analyse des champs : guillemets doubles, guillemet doublé = guillemet littéral, séparateur et
 * saut de ligne admis dans un champ entre guillemets. Les lignes vides sont ignorées. Les lignes
 * de solde ou de total (pied ou tête de fichier) sont ignorées et signalées.
 */
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dateCivileValide, estDateIso, versIso } from '../dates.js';
import { validerIban } from '../identifiants.js';
import {
  CollecteurAnomalies, TAILLE_MAX_RELEVE, appliquerOptionsSoldes, chaineMontant, finaliserReleve, nettoyerTexteBancaire, referenceOuNull, releveIllisible,
} from './commun.js';
import type { BrouillonCompte, BrouillonMouvement } from './commun.js';
import { SOURCE_CSV_BANQUE } from './sources.js';
import type { OptionsLectureReleve, RapportReleve } from './types.js';

export interface ProfilCsvBanque {
  /** Défaut « ; ». */
  separateur?: ';' | ',' | '\t';
  /** Nombre de lignes avant les données (défaut 1). Si des colonnes sont désignées par leur nom, la dernière de ces lignes porte les en-têtes. */
  lignesEntete?: number;
  /** Colonne désignée par son en-tête (comparaison sans casse ni accents) ou par son indice à partir de 0. */
  colonnes: {
    date: string | number;
    dateValeur?: string | number;
    libelle: string | number;
    montant?: string | number;
    debit?: string | number;
    credit?: string | number;
    reference?: string | number;
  };
  /** « JJ/MM/AA » : siècle 2000. */
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ' | 'JJ-MM-AAAA' | 'JJ/MM/AA';
  /** Défaut « , ». */
  decimale?: ',' | '.';
  iban?: string;
}

const schemaColonne = z.union([z.string().min(1).max(100), z.number().int().min(0).max(500)]);

export const schemaProfilCsvBanque = z.strictObject({
  separateur: z.enum([';', ',', '\t']).optional(),
  lignesEntete: z.number().int().min(0).max(100).optional(),
  colonnes: z.strictObject({
    date: schemaColonne,
    dateValeur: schemaColonne.optional(),
    libelle: schemaColonne,
    montant: schemaColonne.optional(),
    debit: schemaColonne.optional(),
    credit: schemaColonne.optional(),
    reference: schemaColonne.optional(),
  }),
  formatDate: z.enum(['JJ/MM/AAAA', 'AAAA-MM-JJ', 'JJ-MM-AAAA', 'JJ/MM/AA']),
  decimale: z.enum([',', '.']).optional(),
  iban: z.string().max(42).optional(),
});

/** Découpe un CSV en lignes de champs. Retourne aussi le n° de ligne physique de chaque enregistrement. */
export function decouperCsv(contenu: string, separateur: string): Array<{ ligne: number; champs: string[]; vide: boolean }> {
  const enregistrements: Array<{ ligne: number; champs: string[]; vide: boolean }> = [];
  let champs: string[] = [];
  let champ = '';
  let entreGuillemets = false;
  let champGuillemete = false;
  let ligne = 1;
  let ligneDebut = 1;
  const texte = contenu.charCodeAt(0) === 0xfeff ? contenu.slice(1) : contenu;
  const terminer = (): void => {
    champs.push(champ);
    const vide = champs.every((c) => c.trim() === '') && !champGuillemete;
    enregistrements.push({ ligne: ligneDebut, champs, vide });
    champs = [];
    champ = '';
    champGuillemete = false;
  };
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charAt(i);
    if (entreGuillemets) {
      if (c === '"') {
        if (texte.charAt(i + 1) === '"') {
          champ += '"';
          i++;
        } else {
          entreGuillemets = false;
        }
      } else {
        if (c === '\n') ligne++;
        champ += c;
      }
      continue;
    }
    if (c === '"' && champ.trim() === '') {
      entreGuillemets = true;
      champGuillemete = true;
      champ = '';
    } else if (c === separateur) {
      champs.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte.charAt(i + 1) === '\n') i++;
      terminer();
      ligne++;
      ligneDebut = ligne;
    } else {
      champ += c;
    }
  }
  if (champ !== '' || champs.length > 0) terminer();
  return enregistrements;
}

export function normaliserEntete(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

type FormatDate = ProfilCsvBanque['formatDate'];

export function lireDateCsv(v: string, format: FormatDate): string | null {
  const t = v.trim();
  if (format === 'AAAA-MM-JJ') return estDateIso(t) ? t : null;
  const m = format === 'JJ/MM/AAAA' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t) : format === 'JJ-MM-AAAA' ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(t) : /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(t);
  if (!m) return null;
  const j = Number(m[1]);
  const mo = Number(m[2]);
  const a = format === 'JJ/MM/AA' ? 2000 + Number(m[3]) : Number(m[3]);
  return dateCivileValide(a, mo, j) ? versIso(a, mo, j) : null;
}

/** Montant d'une cellule selon la décimale du profil. null si illisible : on ne devine jamais. */
export function lireMontantCsv(v: string, decimale: ',' | '.'): Decimal | null {
  let t = v.replace(/[\u00a0\u202f\u2009\s]/g, ' ').trim();
  if (t === '' || t.length > 40) return null;
  t = t.replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '').trim();
  let negatif = false;
  const parentheses = /^\((.*)\)$/.exec(t);
  if (parentheses) {
    negatif = true;
    t = (parentheses[1] ?? '').trim();
  }
  const gauche = /^([+\-−])\s*(.*)$/.exec(t);
  if (gauche) {
    if (negatif) return null;
    negatif = gauche[1] !== '+';
    t = gauche[2] ?? '';
  } else {
    const droite = /^(.*\d)\s*([+\-−])$/.exec(t);
    if (droite) {
      if (negatif) return null;
      negatif = droite[2] !== '+';
      t = droite[1] ?? '';
    }
  }
  const milliers = decimale === ',' ? '[. ]' : '[, ]';
  const dec = decimale === ',' ? ',' : '\\.';
  const motif = new RegExp(`^(?:(\\d{1,3}(?:${milliers}\\d{3})+)|(\\d{1,13}))(?:${dec}(\\d{1,6}))?$`);
  const m = motif.exec(t);
  if (!m) return null;
  const entier = (m[1] ?? m[2] ?? '').replace(/[., ]/g, '');
  if (entier.length > 13) return null;
  const d = new Decimal(m[3] === undefined ? entier : `${entier}.${m[3]}`);
  return negatif ? d.negated() : d;
}

const MOTIF_SOLDE_OUVERTURE = /^(ancien solde|solde initial|solde precedent|solde d ouverture|solde de debut|solde au debut|solde debut)\b/;
const MOTIF_SOLDE_CLOTURE = /^(nouveau solde|solde final|solde de cloture|solde de fin|solde fin|solde en fin)\b/;
const MOTIF_PIED = /\b(total|totaux|solde|sous total|cumul)\b/;

export function lireCsvBanque(contenu: string, profil: ProfilCsvBanque, options?: OptionsLectureReleve): RapportReleve {
  const anomalies = new CollecteurAnomalies();
  const illisible = (): RapportReleve => releveIllisible('csv', null, anomalies, SOURCE_CSV_BANQUE);
  const validation = schemaProfilCsvBanque.safeParse(profil);
  if (!validation.success) {
    anomalies.signaler('PROFIL_INVALIDE', 'bloquante', `Profil CSV invalide : ${validation.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
    return illisible();
  }
  const p = validation.data;
  const aMontant = p.colonnes.montant !== undefined;
  const aDebit = p.colonnes.debit !== undefined;
  const aCredit = p.colonnes.credit !== undefined;
  if (!((aMontant && !aDebit && !aCredit) || (!aMontant && aDebit && aCredit))) {
    anomalies.signaler('PROFIL_INVALIDE', 'bloquante', 'Profil CSV invalide : indiquer soit la colonne « montant », soit les deux colonnes « debit » et « credit ».');
    return illisible();
  }
  if (typeof contenu !== 'string' || contenu.trim() === '') {
    anomalies.signaler('FICHIER_VIDE', 'bloquante', 'Contenu CSV absent ou vide.');
    return illisible();
  }
  if (contenu.length > TAILLE_MAX_RELEVE) {
    anomalies.signaler('TROP_VOLUMINEUX', 'bloquante', `Relevé de plus de ${TAILLE_MAX_RELEVE} caractères : refusé.`);
    return illisible();
  }
  const separateur = p.separateur ?? ';';
  const decimale = p.decimale ?? ',';
  const nbEntete = p.lignesEntete ?? 1;
  const enregistrements = decouperCsv(contenu, separateur).filter((e) => !e.vide);
  if (enregistrements.length <= nbEntete) {
    anomalies.signaler('FICHIER_VIDE', 'bloquante', 'Aucune ligne de données après les lignes d’en-tête.');
    return illisible();
  }

  // --- Résolution des colonnes ---
  const entetes = nbEntete > 0 ? (enregistrements[nbEntete - 1]?.champs ?? []).map(normaliserEntete) : [];
  const index: Partial<Record<keyof ProfilCsvBanque['colonnes'], number>> = {};
  for (const [role, designation] of Object.entries(p.colonnes) as Array<[keyof ProfilCsvBanque['colonnes'], string | number | undefined]>) {
    if (designation === undefined) continue;
    if (typeof designation === 'number') {
      index[role] = designation;
      continue;
    }
    if (nbEntete === 0) {
      anomalies.signaler('PROFIL_INVALIDE', 'bloquante', `Colonne « ${role} » désignée par son nom alors que le profil n'annonce aucune ligne d'en-tête.`);
      continue;
    }
    const cible = normaliserEntete(designation);
    const trouvees = entetes.map((e, i) => (e === cible ? i : -1)).filter((i) => i >= 0);
    if (trouvees.length === 1) index[role] = trouvees[0] as number;
    else {
      anomalies.signaler('COLONNE_INTROUVABLE', 'bloquante', trouvees.length === 0
        ? `Colonne « ${nettoyerTexteBancaire(designation, 60)} » (${role}) introuvable dans la ligne d'en-tête.`
        : `Colonne « ${nettoyerTexteBancaire(designation, 60)} » (${role}) présente ${trouvees.length} fois dans la ligne d'en-tête : désignation ambiguë.`);
    }
  }
  if (anomalies.bloquant) return illisible();

  let iban: string | null = null;
  if (p.iban !== undefined) {
    const compact = p.iban.replace(/\s/g, '').toUpperCase();
    if (validerIban(compact).valide) iban = compact;
    else anomalies.signaler('IBAN_INVALIDE', 'majeure', 'IBAN du profil invalide (clé de contrôle) : ignoré.');
  }
  const compte = { iban, bic: null, identifiant: null, devise: null };
  const brouillonCompte: BrouillonCompte = { iban, identifiant: null, devise: null, soldeOuverture: null, dateOuverture: null, soldeCloture: null, dateCloture: null };
  const mouvements: BrouillonMouvement[] = [];
  const cellule = (champs: string[], role: keyof ProfilCsvBanque['colonnes']): string => {
    const i = index[role];
    return i === undefined ? '' : (champs[i] ?? '').trim();
  };

  /** Ligne de solde ou de total : capte les soldes d'ouverture et de clôture explicites, signale et ignore. */
  const traiterLigneHorsDonnees = (e: { ligne: number; champs: string[] }): boolean => {
    const textes = e.champs.map(normaliserEntete).filter((t) => t !== '');
    const intitule = textes.find((t) => MOTIF_PIED.test(t));
    if (intitule === undefined) return false;
    const estOuverture = MOTIF_SOLDE_OUVERTURE.test(intitule);
    const estCloture = MOTIF_SOLDE_CLOTURE.test(intitule);
    if (estOuverture || estCloture) {
      const lus: Decimal[] = [];
      e.champs.forEach((c, i) => {
        if (normaliserEntete(c) === intitule) return;
        const d = lireMontantCsv(c, decimale);
        if (d === null) return;
        // Dans une colonne « débit », un solde s'entend négatif.
        lus.push(i === index.debit ? d.abs().negated() : i === index.credit ? d.abs() : d);
      });
      const cle = estOuverture ? 'soldeOuverture' : 'soldeCloture';
      if (lus.length === 1 && brouillonCompte[cle] === null) {
        brouillonCompte[cle] = lus[0] as Decimal;
        const date = /(\d{2}\/\d{2}\/\d{4})/.exec(e.champs.join(' '));
        const iso = date ? lireDateCsv(date[1] as string, 'JJ/MM/AAAA') : null;
        if (estOuverture) brouillonCompte.dateOuverture = iso;
        else brouillonCompte.dateCloture = iso;
        anomalies.signaler(estOuverture ? 'SOLDE_OUVERTURE_LU' : 'SOLDE_CLOTURE_LU', 'information', `Ligne ${e.ligne} : ligne de solde ${estOuverture ? "d'ouverture" : 'de clôture'} lue et exclue des mouvements.`);
      } else {
        anomalies.signaler('LIGNE_SOLDE_AMBIGUE', 'mineure', `Ligne ${e.ligne} : ligne de solde ignorée (montant absent, multiple, ou solde déjà lu).`);
      }
      return true;
    }
    anomalies.signaler('LIGNE_TOTAUX_IGNOREE', 'information', `Ligne ${e.ligne} : ligne de totaux ou de solde ignorée (non reprise dans les mouvements).`);
    return true;
  };

  for (const e of enregistrements.slice(0, Math.max(0, nbEntete - 1))) traiterLigneHorsDonnees(e);

  for (const e of enregistrements.slice(nbEntete)) {
    const dateBrute = cellule(e.champs, 'date');
    const date = lireDateCsv(dateBrute, p.formatDate);
    if (date === null) {
      if (traiterLigneHorsDonnees(e)) continue;
      anomalies.signaler('LIGNE_ILLISIBLE', 'majeure', `Ligne ${e.ligne} : date illisible au format ${p.formatDate}, ligne écartée.`);
      continue;
    }
    let montant: Decimal | null;
    if (aMontant) {
      montant = lireMontantCsv(cellule(e.champs, 'montant'), decimale);
    } else {
      const brutDebit = cellule(e.champs, 'debit');
      const brutCredit = cellule(e.champs, 'credit');
      const debit = brutDebit === '' ? null : lireMontantCsv(brutDebit, decimale);
      const credit = brutCredit === '' ? null : lireMontantCsv(brutCredit, decimale);
      if ((brutDebit !== '' && debit === null) || (brutCredit !== '' && credit === null)) montant = null;
      else if (debit !== null && !debit.isZero() && credit !== null && !credit.isZero()) {
        anomalies.signaler('DEBIT_ET_CREDIT', 'majeure', `Ligne ${e.ligne} : débit et crédit tous deux renseignés, ligne écartée.`);
        continue;
      } else if (debit !== null && !debit.isZero()) montant = debit.abs().negated();
      else if (credit !== null) montant = credit.abs();
      else if (debit !== null) montant = debit.abs().negated();
      else montant = null;
    }
    if (montant === null) {
      anomalies.signaler('LIGNE_ILLISIBLE', 'majeure', `Ligne ${e.ligne} : montant absent ou illisible (décimale « ${decimale} »), ligne écartée.`);
      continue;
    }
    let dateValeur: string | null = null;
    if (index.dateValeur !== undefined) {
      const brute = cellule(e.champs, 'dateValeur');
      dateValeur = brute === '' ? null : lireDateCsv(brute, p.formatDate);
      if (brute !== '' && dateValeur === null) anomalies.signaler('DATE_VALEUR_ILLISIBLE', 'mineure', `Ligne ${e.ligne} : date de valeur illisible, ignorée.`, mouvements.length + 1);
    }
    mouvements.push({
      indexCompte: 0, compte, dateOperation: date, dateValeur,
      montant: chaineMontant(montant),
      libelle: nettoyerTexteBancaire(cellule(e.champs, 'libelle')),
      referenceBanque: index.reference === undefined ? null : referenceOuNull(cellule(e.champs, 'reference')),
      referenceBoutEnBout: null,
      contrepartie: null,
      codeOperation: null,
    });
  }
  const comptes = [brouillonCompte];
  appliquerOptionsSoldes(comptes, options, anomalies);
  return finaliserReleve('csv', null, comptes, mouvements, anomalies, SOURCE_CSV_BANQUE);
}

// --- Proposition de profil ------------------------------------------------------------------

const SYNONYMES: Record<'date' | 'dateValeur' | 'libelle' | 'montant' | 'debit' | 'credit' | 'reference', readonly string[]> = {
  date: ['date', 'date operation', 'date d operation', 'date de l operation', 'date comptable', 'date de comptabilisation', 'date ope'],
  dateValeur: ['date valeur', 'date de valeur', 'valeur'],
  libelle: ['libelle', 'libelle operation', 'libelle de l operation', 'libelle d operation', 'description', 'intitule', 'designation', 'nature de l operation'],
  montant: ['montant', 'montant eur', 'montant en euros', 'montant en eur', 'montant de l operation'],
  debit: ['debit', 'debit eur', 'montant debit', 'debit euros'],
  credit: ['credit', 'credit eur', 'montant credit', 'credit euros'],
  reference: ['reference', 'ref', 'reference operation', 'numero operation', 'numero d operation', 'n operation'],
};

function compterHorsGuillemets(ligne: string, c: string): number {
  let n = 0;
  let dedans = false;
  for (const x of ligne) {
    if (x === '"') dedans = !dedans;
    else if (x === c && !dedans) n++;
  }
  return n;
}

/**
 * Proposition PRUDENTE d'un profil d'après les en-têtes. Retourne `profil: null` dès qu'un choix serait
 * arbitraire. Même non nul, le profil n'est qu'une proposition : un humain le confirme toujours.
 */
export function proposerProfilCsv(contenu: string): { profil: ProfilCsvBanque | null; raisons: string[] } {
  const raisons: string[] = [];
  const echec = (raison: string): { profil: null; raisons: string[] } => ({ profil: null, raisons: [...raisons, raison] });
  if (typeof contenu !== 'string' || contenu.trim() === '') return echec('Contenu vide.');
  const extrait = contenu.slice(0, 200_000);
  const lignes = extrait.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 60);

  // Séparateur : celui qui apparaît sur le plus de lignes ; égalité → abstention.
  const candidats = ([';', ',', '\t'] as const).map((s) => ({ s, nb: lignes.filter((l) => compterHorsGuillemets(l, s) >= 2).length }));
  candidats.sort((x, y) => y.nb - x.nb);
  const premier = candidats[0];
  const second = candidats[1];
  if (premier === undefined || premier.nb === 0) return echec('Aucun séparateur (« ; », « , » ou tabulation) ne donne au moins trois colonnes.');
  if (second !== undefined && second.nb === premier.nb) return echec('Séparateur ambigu : plusieurs séparateurs possibles donnent le même nombre de lignes.');
  const separateur = premier.s;
  raisons.push(`Séparateur « ${separateur === '\t' ? 'tabulation' : separateur} » (${premier.nb} ligne(s) sur ${lignes.length} examinée(s)).`);

  const enregistrements = decouperCsv(extrait, separateur).filter((e) => !e.vide).slice(0, 60);
  let indiceEntete = -1;
  let roles: Partial<Record<keyof typeof SYNONYMES, number>> = {};
  for (const [i, e] of enregistrements.slice(0, 15).entries()) {
    const normalises = e.champs.map(normaliserEntete);
    const trouves: Partial<Record<keyof typeof SYNONYMES, number[]>> = {};
    for (const role of Object.keys(SYNONYMES) as Array<keyof typeof SYNONYMES>) {
      trouves[role] = normalises.map((n, j) => (SYNONYMES[role].includes(n) ? j : -1)).filter((j) => j >= 0);
    }
    if ((trouves.date?.length ?? 0) === 0 || (trouves.libelle?.length ?? 0) === 0) continue;
    for (const role of Object.keys(SYNONYMES) as Array<keyof typeof SYNONYMES>) {
      const l = trouves[role] ?? [];
      if (l.length > 1) return echec(`En-tête ambigu : ${l.length} colonnes peuvent tenir le rôle « ${role} ».`);
    }
    indiceEntete = i;
    roles = Object.fromEntries(Object.entries(trouves).filter(([, l]) => (l as number[]).length === 1).map(([r, l]) => [r, (l as number[])[0]])) as typeof roles;
    break;
  }
  if (indiceEntete < 0) return echec('Ligne d’en-tête non reconnue : aucune ligne ne contient à la fois une colonne de date et une colonne de libellé connues.');
  const entetes = enregistrements[indiceEntete]?.champs ?? [];
  const nom = (role: keyof typeof SYNONYMES): string | undefined => (roles[role] === undefined ? undefined : (entetes[roles[role] as number] ?? '').trim());
  const aMontant = roles.montant !== undefined;
  const aDebitCredit = roles.debit !== undefined && roles.credit !== undefined;
  if (aMontant && (roles.debit !== undefined || roles.credit !== undefined)) return echec('Colonnes de montant ambiguës : « montant » et « débit/crédit » sont toutes présentes.');
  if (!aMontant && !aDebitCredit) return echec('Colonnes de montant non reconnues : ni « montant », ni le couple « débit » et « crédit ».');
  raisons.push(`Ligne d'en-tête n° ${indiceEntete + 1} : ${(Object.keys(roles) as Array<keyof typeof SYNONYMES>).map((r) => `${r} = « ${nettoyerTexteBancaire(nom(r), 40)} »`).join(', ')}.`);

  // Format de date et décimale : déduits des données, à l'unanimité seulement.
  const donnees = enregistrements.slice(indiceEntete + 1);
  const formats: FormatDate[] = ['JJ/MM/AAAA', 'AAAA-MM-JJ', 'JJ-MM-AAAA', 'JJ/MM/AA'];
  const valeursDate = donnees.map((e) => (e.champs[roles.date as number] ?? '').trim()).filter((v) => /^\d/.test(v));
  if (valeursDate.length === 0) return echec('Aucune date dans les lignes de données : format de date indéterminable.');
  const compatibles = formats.filter((f) => valeursDate.every((v) => lireDateCsv(v, f) !== null));
  if (compatibles.length !== 1) return echec('Format de date indéterminé : les dates ne suivent pas toutes un même format reconnu.');
  const formatDate = compatibles[0] as FormatDate;
  raisons.push(`Format de date ${formatDate} (${valeursDate.length} date(s) concordante(s)).`);

  const colonnesMontant = (aMontant ? [roles.montant] : [roles.debit, roles.credit]) as number[];
  const valeursMontant = donnees.filter((e) => lireDateCsv((e.champs[roles.date as number] ?? '').trim(), formatDate) !== null)
    .flatMap((e) => colonnesMontant.map((c) => (e.champs[c] ?? '').trim())).filter((v) => v !== '');
  if (valeursMontant.length === 0) return echec('Aucun montant dans les lignes de données : décimale indéterminable.');
  const virgule = valeursMontant.some((v) => /,\d{1,2}\D*$/.test(v));
  const point = valeursMontant.some((v) => /\.\d{1,2}\D*$/.test(v));
  if (virgule === point) return echec(virgule ? 'Décimale ambiguë : des montants à virgule et à point décimal coexistent.' : 'Décimale indéterminée : aucun montant ne porte de partie décimale à un ou deux chiffres.');
  const decimale: ',' | '.' = virgule ? ',' : '.';
  const illisibles = valeursMontant.filter((v) => lireMontantCsv(v, decimale) === null).length;
  if (illisibles > 0) return echec(`${illisibles} montant(s) illisible(s) avec la décimale « ${decimale} ».`);
  raisons.push(`Décimale « ${decimale} » (${valeursMontant.length} montant(s) lisible(s)).`);

  const colonnes: ProfilCsvBanque['colonnes'] = { date: nom('date') as string, libelle: nom('libelle') as string };
  if (roles.dateValeur !== undefined) colonnes.dateValeur = nom('dateValeur') as string;
  if (aMontant) colonnes.montant = nom('montant') as string;
  else {
    colonnes.debit = nom('debit') as string;
    colonnes.credit = nom('credit') as string;
  }
  if (roles.reference !== undefined) colonnes.reference = nom('reference') as string;
  raisons.push('Proposition à confirmer par un humain avant tout import.');
  return { profil: { separateur, lignesEntete: indiceEntete + 1, colonnes, formatDate, decimale }, raisons };
}
