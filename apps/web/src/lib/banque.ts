/**
 * Banque et rapprochements : formes des réponses de `apps/api/src/banque.controller.ts` et logique pure de l'interface.
 * Les montants sont des chaînes décimales signées (positif = encaissement) : jamais convertis en nombre.
 * Les libellés bancaires et d'écritures sont des contenus non fiables, rendus en texte brut.
 */
import type { Exercice, StatutLot } from './types-api';

export type Cadrage = 'ok' | 'ecart' | 'non_verifiable';
export interface AnomalieReleve {
  rang: number | null;
  code: string;
  gravite: string;
  message: string;
}
export interface RapportReleve {
  nomFichier?: string;
  format?: string;
  lisible?: boolean;
  motif?: string;
  nbMouvements?: number;
  nbNouveaux?: number;
  nbDejaConnus?: number;
  profilAConfirmer?: boolean;
  raisons?: string[];
  profilCsv?: (Record<string, unknown> & { origine?: string }) | null;
  anomalies?: AnomalieReleve[];
}
export interface LotReleve {
  id: string;
  statut: StatutLot;
  progression: number;
  rapport: RapportReleve | null;
  creeLe: string;
  termineLe: string | null;
}
export interface Releve {
  id: string;
  lotImportId: string;
  format: string;
  iban: string | null;
  identifiant: string | null;
  devise: string | null;
  soldeOuverture: string | null;
  dateOuverture: string | null;
  soldeCloture: string | null;
  dateCloture: string | null;
  totalMouvements: string;
  nbMouvements: number;
  cadrage: Cadrage;
  ecart: string | null;
}
export interface EtatBanque {
  imports: LotReleve[];
  releves: Releve[];
  nbMouvements: number;
}
export interface Mouvement {
  id: string;
  rang: number;
  iban: string | null;
  dateOperation: string;
  dateValeur: string | null;
  montant: string;
  libelle: string;
  referenceBanque: string | null;
  referenceBoutEnBout: string | null;
  contrepartieNom: string | null;
}
export interface PageMouvements {
  page: number;
  taillePage: number;
  suite: boolean;
  mouvements: Mouvement[];
}
export interface ParametresRapprochement {
  toleranceMontant: string;
  fenetreJours: number;
  fenetreJoursRegles: number;
  tailleMaxGroupe: number;
  autoriserPartiels: boolean;
  autoriserCompensations: boolean;
  budgetCombinaisons: number;
  fraisBancairesMax: string;
}
export interface ReferenceRapprochement {
  regles: Array<{ id: string; niveau: 'exact' | 'regle'; description: string }>;
  parametresParDefaut: ParametresRapprochement;
}
export interface Critere {
  critere: string;
  valeurA: string;
  valeurB: string;
  satisfait: boolean;
}
export interface Proposition {
  id: string;
  niveau: 'exact' | 'regle';
  regle: string;
  cotesEcritures: string[];
  cotesMouvements: string[];
  criteres: Critere[];
  explication: string;
  ecart: string;
  statut: 'propose' | 'valide' | 'rejete';
  motif: string | null;
  decideLe: string | null;
}
export interface EcritureRapprochee {
  id: string;
  date: string;
  journal: string;
  numero: string;
  compte: string;
  piece: string;
  libelle: string;
  debit: string;
  credit: string;
}
export interface MouvementRapproche {
  id: string;
  date: string;
  montant: string;
  libelle: string;
  reference: string | null;
  contrepartie: string | null;
  iban: string | null;
}
export interface ExecutionRapprochement {
  id: string;
  statut: StatutLot;
  obsolete: boolean;
  versionDonnees: number;
  parametres: Partial<ParametresRapprochement>;
  mesures: Record<string, string> | null;
  ambiguites: Array<{ ids: string[]; candidats: string[][]; raison: string }> | null;
  abandons: Array<{ raison: string; ids: string[] }> | null;
  erreur: string | null;
  creeLe: string;
  termineLe: string | null;
}
export interface DernierRapprochement {
  exercice: Exercice;
  execution: ExecutionRapprochement | null;
  rapprochements: Proposition[];
  ecritures: Record<string, EcritureRapprochee>;
  mouvements: Record<string, MouvementRapproche>;
  nonRapproches: { ecritures: string[]; mouvements: string[]; nbEcritures: number; nbMouvements: number };
}

export const LIBELLE_FORMAT_RELEVE: Record<string, string> = { 'camt.053': 'camt.053 (XML ISO 20022)', ofx: 'OFX', csv: 'CSV' };
/** Trois états de cadrage. « Non vérifiable » n'est ni un succès ni un écart : il lui faut son propre rendu. */
export const LIBELLE_CADRAGE: Record<Cadrage, string> = { ok: 'Cadré', ecart: 'Écart', non_verifiable: 'Non vérifiable (solde manquant)' };
export const LIBELLE_STATUT_PROPOSITION: Record<string, string> = { propose: 'Proposé', valide: 'Validé', rejete: 'Rejeté' };

/** IBAN masqué sauf les quatre derniers caractères ; à défaut, identifiant de compte masqué de la même façon. */
export function masquerCompte(iban: string | null | undefined, identifiant?: string | null): string {
  const v = (iban ?? identifiant ?? '').replace(/\s/g, '');
  if (!v) return 'Compte non identifié';
  return v.length <= 4 ? '••••' : `•••• ${v.slice(-4)}`;
}

/** Sens d'un mouvement, lu sur le signe de la chaîne (aucune conversion numérique). */
export function sensMouvement(montant: string): 'encaissement' | 'decaissement' | 'nul' {
  if (/^-?0*(\.0*)?$/.test(montant)) return 'nul';
  return montant.startsWith('-') ? 'decaissement' : 'encaissement';
}

/** Vrai si la chaîne décimale vaut zéro (pour ne pas afficher un écart nul comme un écart). */
export function estNul(montant: string | null | undefined): boolean {
  return !montant || /^-?0*(\.0*)?$/.test(montant);
}

// ───────────── Profil CSV confirmé par l'utilisateur ─────────────
export interface FormulaireProfil {
  separateur: ';' | ',' | 'tab';
  lignesEntete: string;
  date: string;
  libelle: string;
  mode: 'montant' | 'debit_credit';
  montant: string;
  debit: string;
  credit: string;
  reference: string;
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ' | 'JJ-MM-AAAA' | 'JJ/MM/AA';
  decimale: ',' | '.';
  iban: string;
}
export const FORMATS_DATE: FormulaireProfil['formatDate'][] = ['JJ/MM/AAAA', 'AAAA-MM-JJ', 'JJ-MM-AAAA', 'JJ/MM/AA'];

/** Valeurs de départ du formulaire ; le séparateur est repris des raisons de l'API quand elles le nomment sans ambiguïté. */
export function profilInitial(raisons: readonly string[] = []): FormulaireProfil {
  const texte = raisons.join(' ');
  const ambigu = /Séparateur ambigu|Aucun séparateur/.test(texte);
  const m = /Séparateur « (;|,|tabulation) »/.exec(texte);
  const separateur = !ambigu && m ? (m[1] === 'tabulation' ? 'tab' : (m[1] as ';' | ',')) : ';';
  return { separateur, lignesEntete: '1', date: '', libelle: '', mode: 'montant', montant: '', debit: '', credit: '', reference: '', formatDate: 'JJ/MM/AAAA', decimale: ',', iban: '' };
}

/** Colonne désignée par son en-tête, ou par sa position (1 = première colonne) transmise à l'API en indice à partir de 0. */
function colonne(v: string): string | number {
  const t = v.trim();
  return /^\d{1,3}$/.test(t) && Number(t) >= 1 ? Number(t) - 1 : t;
}

export function profilDepuis(f: FormulaireProfil): { ok: true; profilCsv: Record<string, unknown> } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  const lignesEntete = /^\d{1,3}$/.test(f.lignesEntete.trim()) ? Number(f.lignesEntete.trim()) : -1;
  if (lignesEntete < 0 || lignesEntete > 100) erreurs.push('Lignes d’en-tête : un nombre entier de 0 à 100.');
  const exige = (v: string, nom: string) => {
    if (!v.trim()) erreurs.push(`Indiquez la colonne « ${nom} ».`);
    else if (v.trim() === '0') erreurs.push(`Colonne « ${nom} » : la première colonne porte le numéro 1.`);
    else if (v.trim().length > 100) erreurs.push(`Colonne « ${nom} » : 100 caractères au plus.`);
  };
  exige(f.date, 'date');
  exige(f.libelle, 'libellé');
  if (f.mode === 'montant') exige(f.montant, 'montant');
  else {
    exige(f.debit, 'débit');
    exige(f.credit, 'crédit');
  }
  const noms = [f.date, f.libelle, ...(f.mode === 'montant' ? [f.montant] : [f.debit, f.credit])].map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (new Set(noms).size !== noms.length) erreurs.push('Une même colonne ne peut pas tenir deux rôles.');
  if (lignesEntete === 0 && [f.date, f.libelle, f.montant, f.debit, f.credit, f.reference].some((v) => v.trim() && typeof colonne(v) === 'string')) {
    erreurs.push('Sans ligne d’en-tête, désignez les colonnes par leur position (1, 2, 3…).');
  }
  const iban = f.iban.replace(/\s/g, '').toUpperCase();
  if (iban && !/^[A-Z]{2}[0-9A-Z]{12,40}$/.test(iban)) erreurs.push('IBAN invalide.');
  if (erreurs.length) return { ok: false, erreurs };
  return {
    ok: true,
    profilCsv: {
      separateur: f.separateur === 'tab' ? '\t' : f.separateur,
      lignesEntete,
      colonnes: {
        date: colonne(f.date),
        libelle: colonne(f.libelle),
        ...(f.mode === 'montant' ? { montant: colonne(f.montant) } : { debit: colonne(f.debit), credit: colonne(f.credit) }),
        ...(f.reference.trim() ? { reference: colonne(f.reference) } : {}),
      },
      formatDate: f.formatDate,
      decimale: f.decimale,
      ...(iban ? { iban } : {}),
    },
  };
}

// ───────────── Paramètres du rapprochement ─────────────
export interface FormulaireParametres {
  toleranceMontant: string;
  fenetreJours: string;
  fenetreJoursRegles: string;
  autoriserPartiels: boolean;
  autoriserCompensations: boolean;
}
export function parametresInitiaux(d: ParametresRapprochement): FormulaireParametres {
  return { toleranceMontant: d.toleranceMontant.replace('.', ','), fenetreJours: String(d.fenetreJours), fenetreJoursRegles: String(d.fenetreJoursRegles), autoriserPartiels: d.autoriserPartiels, autoriserCompensations: d.autoriserCompensations };
}
/** Ne transmet que les paramètres qui diffèrent des valeurs par défaut de l'API ; la tolérance reste une chaîne décimale. */
export function parametresDepuis(f: FormulaireParametres, d: ParametresRapprochement): { ok: true; parametres: Partial<ParametresRapprochement> } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  const tolerance = f.toleranceMontant.trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d{1,13}(\.\d{1,6})?$/.test(tolerance)) erreurs.push('Tolérance de montant : un montant positif ou nul, par exemple 0,05.');
  const entier = (v: string, nom: string, max: number) => {
    if (!/^\d{1,4}$/.test(v.trim()) || Number(v.trim()) > max) {
      erreurs.push(`${nom} : un nombre entier de jours de 0 à ${max}.`);
      return 0;
    }
    return Number(v.trim());
  };
  const fenetreJours = entier(f.fenetreJours, 'Fenêtre des correspondances exactes', 366);
  const fenetreJoursRegles = entier(f.fenetreJoursRegles, 'Fenêtre des règles', 1830);
  if (erreurs.length) return { ok: false, erreurs };
  const meme = (a: string, b: string) => a.replace(/\.?0+$/, '') === b.replace(/\.?0+$/, '');
  const p: Partial<ParametresRapprochement> = {};
  if (!meme(tolerance.includes('.') ? tolerance : `${tolerance}.0`, d.toleranceMontant.includes('.') ? d.toleranceMontant : `${d.toleranceMontant}.0`)) p.toleranceMontant = tolerance;
  if (fenetreJours !== d.fenetreJours) p.fenetreJours = fenetreJours;
  if (fenetreJoursRegles !== d.fenetreJoursRegles) p.fenetreJoursRegles = fenetreJoursRegles;
  if (f.autoriserPartiels !== d.autoriserPartiels) p.autoriserPartiels = f.autoriserPartiels;
  if (f.autoriserCompensations !== d.autoriserCompensations) p.autoriserCompensations = f.autoriserCompensations;
  return { ok: true, parametres: p };
}

/** Nombre de propositions par règle, dans l'ordre des règles de la référence (les règles inconnues à la fin). */
export function synthesePropositions(propositions: readonly Pick<Proposition, 'regle' | 'statut'>[], regles: ReferenceRapprochement['regles']) {
  const parRegle = new Map<string, number>();
  for (const p of propositions) parRegle.set(p.regle, (parRegle.get(p.regle) ?? 0) + 1);
  const ordre = [...regles.map((r) => r.id).filter((id) => parRegle.has(id)), ...[...parRegle.keys()].filter((id) => !regles.some((r) => r.id === id))];
  const statuts = { propose: 0, valide: 0, rejete: 0 };
  for (const p of propositions) if (p.statut in statuts) statuts[p.statut]++;
  return { parRegle: ordre.map((id) => ({ id, niveau: regles.find((r) => r.id === id)?.niveau ?? null, nombre: parRegle.get(id)! })), statuts, total: propositions.length };
}
