/** Missions, lettres, travaux et registre des conseils : formes de `missions.controller.ts` et `conseils.controller.ts`, logique pure. */
import { normaliserMontantSaisi } from './centimes';
import type { PieceJointe } from './types-api';

export interface Prestation {
  code: string;
  libelle: string;
}
export type ModeHonoraires = 'forfait' | 'temps_passe' | 'mixte';
export interface ContenuLettre {
  perimetre: Array<{ prestation: string; precision?: string }>;
  duree: { debut: string; fin: string | null; taciteReconduction: boolean };
  honoraires: { mode: ModeHonoraires; montantAnnuelHt: string | null; tauxHoraireHt: string | null; conditionsRevision: string };
  obligationsCabinet: string;
  obligationsClient: string;
  livrables: string[];
  mandats: string[];
  limites: string;
}
export interface Lettre {
  id: string;
  missionId: string;
  avenantDe: string | null;
  documentId: string | null;
  dateEffet: string;
  contenu: ContenuLettre;
  origine: 'saisie_humaine' | 'proposition_avenant' | string;
  version: number;
  statut: 'projet' | 'validee' | 'remplacee' | string;
  redigeePar: string | null;
  valideePar: string | null;
  valideeLe: string | null;
  creeLe: string;
  /** Lettre signée jointe (pièce du dossier) ; null si aucune, ou si la pièce n'est plus lisible. */
  document?: PieceJointe | null;
}
export interface Mission {
  id: string;
  entiteId: string;
  libelle: string;
  debut: string | null;
  fin: string | null;
  creeLe: string;
  lettres: Lettre[];
}
export type Rattachement =
  | { situation: 'dans_le_perimetre'; lettreId: string }
  | { situation: 'potentiellement_hors_perimetre'; lettreId: string; motif: string }
  | { situation: 'aucune_lettre_applicable'; motif: string };
export interface Travail {
  id: string;
  /** Affectation explicite à une mission du dossier ; null = non affecté. */
  missionId: string | null;
  dateTravail: string;
  prestation: string;
  description: string;
  tempsObserveMinutes: number | null;
  auteurId: string;
  creeLe: string;
  rattachement: Rattachement;
}
export interface Estimation {
  statut: 'estime' | 'non_estimable';
  minutes: number | null;
  base: 'bareme_cabinet' | 'temps_observes' | null;
  nbObservations: number;
  hypotheses: string[];
}
export interface PropositionAvenant {
  avenant: Lettre;
  motif: string;
  estimation: Estimation;
  mention: string;
}
export interface Bareme {
  id: string;
  prestation: string;
  minutesReference: number;
}

export const LIBELLE_MODE_HONORAIRES: Record<ModeHonoraires, string> = { forfait: 'Forfait', temps_passe: 'Au temps passé', mixte: 'Mixte (forfait et temps passé)' };

/** Les trois états du rattachement d'un travail. « Potentiellement hors périmètre » est un signalement, pas une conclusion. */
export const LIBELLE_RATTACHEMENT: Record<Rattachement['situation'], string> = {
  dans_le_perimetre: 'Dans le périmètre',
  potentiellement_hors_perimetre: 'Potentiellement hors périmètre — à examiner',
  aucune_lettre_applicable: 'Aucune lettre applicable à cette date',
};
export const LIBELLE_BASE_ESTIMATION: Record<'bareme_cabinet' | 'temps_observes', string> = {
  bareme_cabinet: 'barème du cabinet',
  temps_observes: 'temps observés dans le cabinet',
};
/** Phrase restituant une estimation : toujours avec sa base nommée, ou l'abstention dite telle quelle. */
export function phraseEstimation(e: Estimation): string {
  if (e.statut !== 'estime' || e.minutes === null || e.base === null) return 'Estimation impossible : aucune base';
  return `Temps estimé : ${formaterMinutes(e.minutes)} — base : ${LIBELLE_BASE_ESTIMATION[e.base] ?? e.base}`;
}
/** 135 → « 2 h 15 » ; 45 → « 45 min ». Entiers uniquement. */
export function formaterMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isInteger(minutes) || minutes < 0) return '—';
  const h = Math.trunc(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export interface SaisieLettre {
  dateEffet: string;
  avenantDe: string;
  prestations: Record<string, { cochee: boolean; precision: string }>;
  debut: string;
  fin: string;
  taciteReconduction: boolean;
  mode: ModeHonoraires;
  montantAnnuelHt: string;
  tauxHoraireHt: string;
  conditionsRevision: string;
  obligationsCabinet: string;
  obligationsClient: string;
  livrables: string;
  mandats: string;
  limites: string;
}
export function lettreInitiale(prestations: readonly Prestation[], modele?: Lettre): SaisieLettre {
  const c = modele?.contenu;
  return {
    dateEffet: '',
    avenantDe: modele?.id ?? '',
    prestations: Object.fromEntries(prestations.map((p) => {
      const x = c?.perimetre.find((e) => e.prestation === p.code);
      return [p.code, { cochee: !!x, precision: x?.precision ?? '' }];
    })),
    debut: c?.duree.debut ?? '',
    fin: c?.duree.fin ?? '',
    taciteReconduction: c?.duree.taciteReconduction ?? false,
    mode: c?.honoraires.mode ?? 'forfait',
    montantAnnuelHt: c?.honoraires.montantAnnuelHt ?? '',
    tauxHoraireHt: c?.honoraires.tauxHoraireHt ?? '',
    conditionsRevision: c?.honoraires.conditionsRevision ?? '',
    obligationsCabinet: c?.obligationsCabinet ?? '',
    obligationsClient: c?.obligationsClient ?? '',
    livrables: (c?.livrables ?? []).join('\n'),
    mandats: (c?.mandats ?? []).join('\n'),
    limites: c?.limites ?? '',
  };
}
const lignes = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Corps de `POST v1/missions/:id/lettres`. Les honoraires restent des chaînes décimales ; un montant vide vaut « non renseigné » (null). */
export function lettreDepuis(f: SaisieLettre): { ok: true; corps: { dateEffet: string; contenu: ContenuLettre; avenantDe?: string; documentId?: string } } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  if (!DATE.test(f.dateEffet)) erreurs.push('Indiquez la date d’effet.');
  const perimetre = Object.entries(f.prestations).filter(([, v]) => v.cochee).map(([prestation, v]) => ({ prestation, ...(v.precision.trim() ? { precision: v.precision.trim() } : {}) }));
  if (!perimetre.length) erreurs.push('Le périmètre comporte au moins une prestation.');
  if (!DATE.test(f.debut)) erreurs.push('Indiquez le début de la mission.');
  if (f.fin && !DATE.test(f.fin)) erreurs.push('Date de fin invalide.');
  if (f.fin && f.debut && f.fin < f.debut) erreurs.push('La fin de la mission ne peut pas précéder son début.');
  const montant = (v: string, nom: string): string | null => {
    if (!v.trim()) return null;
    const n = normaliserMontantSaisi(v);
    if (n === null) erreurs.push(`${nom} : montant invalide (ex. 3600,00).`);
    return n;
  };
  const montantAnnuelHt = montant(f.montantAnnuelHt, 'Honoraires annuels HT');
  const tauxHoraireHt = montant(f.tauxHoraireHt, 'Taux horaire HT');
  if (erreurs.length) return { ok: false, erreurs };
  return {
    ok: true,
    corps: {
      dateEffet: f.dateEffet,
      ...(f.avenantDe ? { avenantDe: f.avenantDe } : {}),
      contenu: {
        perimetre,
        duree: { debut: f.debut, fin: f.fin || null, taciteReconduction: f.taciteReconduction },
        honoraires: { mode: f.mode, montantAnnuelHt, tauxHoraireHt, conditionsRevision: f.conditionsRevision.trim() },
        obligationsCabinet: f.obligationsCabinet.trim(),
        obligationsClient: f.obligationsClient.trim(),
        livrables: lignes(f.livrables),
        mandats: lignes(f.mandats),
        limites: f.limites.trim(),
      },
    },
  };
}

// ───────────── Registre des conseils ─────────────
export type StatutConseil = 'projet' | 'valide' | 'envoi_autorise' | 'remplace';
export type TypeFait = 'envoi' | 'remise' | 'reception' | 'lecture';
export interface EvenementConseil {
  id: string;
  conseilId: string;
  type: TypeFait;
  dateEvenement: string;
  canal: string;
  justificatif: string;
  justificatifDocumentId: string | null;
  /** Pièce du dossier qui établit le fait, le cas échéant. */
  justificatifDocument?: PieceJointe | null;
  creeLe: string;
}
export interface Conseil {
  id: string;
  entiteId: string;
  missionId: string | null;
  dateConseil: string;
  auteurId: string;
  auteur: string;
  objet: string;
  contenu: string;
  destinataire: string;
  pieces: string[];
  piecesJointes?: PieceJointe[];
  version: number;
  remplaceConseilId: string | null;
  statut: StatutConseil;
  valideLe: string | null;
  envoiAutoriseLe: string | null;
  creeLe: string;
  faits: Record<TypeFait, string | null>;
  evenements: EvenementConseil[];
}
export const FAITS: readonly TypeFait[] = ['envoi', 'remise', 'reception', 'lecture'];
export const LIBELLE_FAIT: Record<TypeFait, string> = { envoi: 'Envoi', remise: 'Remise', reception: 'Réception', lecture: 'Lecture' };
export const LIBELLE_STATUT_CONSEIL: Record<StatutConseil, string> = {
  projet: 'Projet — non validé',
  valide: 'Validé — envoi non autorisé',
  envoi_autorise: 'Validé — envoi autorisé',
  remplace: 'Remplacé par une nouvelle version',
};
export const NON_ETABLI = 'Non établi';
export const MENTION_REGISTRE = 'Le logiciel n’envoie rien : il trace.';
/**
 * État d'un fait au registre. L'absence d'événement consigné se lit « Non établi » : elle ne dit pas que le fait
 * n'a pas eu lieu, et un fait ne se déduit jamais d'un autre.
 */
export function etatFait(date: string | null | undefined): { etabli: boolean; date: string | null } {
  return date ? { etabli: true, date } : { etabli: false, date: null };
}
/** Faits consignables selon ce qui l'est déjà : l'envoi d'abord, puis remise, réception et lecture indépendamment. */
export function faitsConsignables(c: Pick<Conseil, 'statut' | 'faits'>): TypeFait[] {
  if (c.statut !== 'envoi_autorise') return [];
  return c.faits.envoi ? FAITS.filter((f) => !c.faits[f]) : ['envoi'];
}
