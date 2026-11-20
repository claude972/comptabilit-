/**
 * Sens d'une pièce (achat, vente, indéterminé) pour un DOSSIER donné — fonction pure.
 *
 * Seuls des identifiants FORTS sont comparés : le SIREN de l'entité du dossier d'un côté ; de l'autre le SIREN de
 * l'émetteur et celui du destinataire, lus tels quels ou tirés d'un SIRET ou d'un numéro de TVA français, et retenus
 * seulement si leur clé de contrôle est correcte. Le nom n'est JAMAIS utilisé : deux sociétés peuvent porter le même.
 */
import { sirenDeTvaFr, validerSiren, validerSiret, validerTvaIntracomFr } from '../identifiants.js';

export interface IdentifiantsPartie {
  siren?: string | null;
  siret?: string | null;
  tva?: string | null;
}

export interface DemandeSensPiece {
  emetteur: IdentifiantsPartie;
  destinataire: IdentifiantsPartie;
  /** SIREN de l'entité du dossier. */
  sirenDossier: string | null;
}

export interface SensPiece {
  sens: 'achat' | 'vente' | 'indetermine';
  /** Vrai si les identifiants se contredisent (le dossier serait à la fois émetteur et destinataire, ou une partie porte deux SIREN). */
  incoherence: boolean;
  /** Explication en français, toujours renseignée. */
  motif: string;
  /** SIREN valides retenus pour la comparaison (null : non lu ou clé de contrôle incorrecte). */
  sirenEmetteur: string | null;
  sirenDestinataire: string | null;
}

const compact = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.replace(/[\s.]/g, '').toUpperCase() : null);

/** SIREN valides désignés par les identifiants d'une partie (un seul, sauf identifiants contradictoires). */
function sirensDe(p: IdentifiantsPartie): string[] {
  const trouves = new Set<string>();
  const siren = compact(p.siren);
  if (siren && validerSiren(siren).valide) trouves.add(siren);
  const siret = compact(p.siret);
  if (siret && validerSiret(siret).valide) trouves.add(siret.slice(0, 9));
  const tva = compact(p.tva);
  if (tva && validerTvaIntracomFr(tva).valide) {
    const s = sirenDeTvaFr(tva);
    if (s) trouves.add(s);
  }
  return [...trouves];
}

/**
 * SIREN valide d'une partie, par ordre : SIREN lu, sinon tiré du SIRET, sinon tiré du numéro de TVA français.
 * Null si rien n'est lu ou si aucune clé de contrôle n'est correcte.
 */
export function sirenDePartie(p: IdentifiantsPartie): string | null {
  return sirensDe(p)[0] ?? null;
}

export function determinerSensPiece(d: DemandeSensPiece): SensPiece {
  const emetteurs = sirensDe(d.emetteur);
  const destinataires = sirensDe(d.destinataire);
  const sirenEmetteur = emetteurs[0] ?? null;
  const sirenDestinataire = destinataires[0] ?? null;
  const base = { sirenEmetteur, sirenDestinataire };
  const dossier = compact(d.sirenDossier);
  if (!dossier || !validerSiren(dossier).valide) {
    return { ...base, sens: 'indetermine', incoherence: false, motif: 'SIREN du dossier inconnu ou invalide : le sens de la pièce ne peut pas être déduit de ses identifiants.' };
  }
  if (emetteurs.length > 1 || destinataires.length > 1) {
    const qui = emetteurs.length > 1 ? 'de l’émetteur' : 'du destinataire';
    return { ...base, sens: 'indetermine', incoherence: true, motif: `Les identifiants ${qui} lus sur la pièce désignent plusieurs SIREN différents : sens non déterminable.` };
  }
  const emetteurEstDossier = sirenEmetteur === dossier;
  const destinataireEstDossier = sirenDestinataire === dossier;
  if (emetteurEstDossier && destinataireEstDossier) {
    return { ...base, sens: 'indetermine', incoherence: true, motif: 'Incohérence : le SIREN du dossier est lu à la fois comme émetteur et comme destinataire de la pièce.' };
  }
  if (emetteurEstDossier) return { ...base, sens: 'vente', incoherence: false, motif: 'L’émetteur lu sur la pièce est le dossier (même SIREN) : pièce de vente.' };
  if (destinataireEstDossier) return { ...base, sens: 'achat', incoherence: false, motif: 'Le destinataire lu sur la pièce est le dossier (même SIREN) : pièce d’achat.' };
  if (sirenEmetteur === null && sirenDestinataire === null) {
    return { ...base, sens: 'indetermine', incoherence: false, motif: 'Ni l’émetteur ni le destinataire ne portent de SIREN valide lu sur la pièce : sens non déterminable.' };
  }
  const lus = [sirenEmetteur ? 'émetteur' : null, sirenDestinataire ? 'destinataire' : null].filter(Boolean).join(' et ');
  return { ...base, sens: 'indetermine', incoherence: false, motif: `Le SIREN du dossier n’est ni celui de l’émetteur ni celui du destinataire (lu : ${lus}) : sens non déterminable, la pièce ne concerne peut-être pas ce dossier.` };
}
