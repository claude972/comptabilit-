/**
 * Tableau 2033-G-SD « Filiales et participations » (D-117), régime simplifié : liste des personnes ou groupements de personnes de droit ou de
 * fait dont la société détient directement au moins 10 % du capital (formulaire) : nombre total de filiales (case 905 du 2033-G) et sept lignes
 * (forme juridique, dénomination, SIREN, % de détention, adresse).
 *
 * Saisie ligne par ligne, justifiée, tracée, historisée ; NÉANT explicite du tableau ; abstention sans saisie ; aucune décision fiscale. Rien ne se
 * déduit de la balance (le portefeuille de titres de participation relève du registre de la société). Aucun calcul n'est énoncé par le formulaire :
 * tous les rapprochements sont des CONTRÔLES INDICATIFS, jamais bloquants ni corrigés : nombre de lignes saisies au plus égal à la case 905 ;
 * pourcentage de détention d'au moins 10 % (champ du tableau, formulaire).
 *
 * Case 905 « nombre total de filiales » lue sur `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), page 7, par extraction positionnée puis vérifiée sur le
 * rendu image (2026-11-22). Les lignes n'ont pas de code de case.
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail, EtatCodeCase } from './detail-resultat.js';
import type { SaisieTableau, TraceSaisie } from './saisies-tableaux.js';
import { MENTION_PROJET } from './sources-fiscales.js';

export type StatutLigneG = 'a_saisir' | 'saisi' | 'a_revoir';
export interface LigneFiliale {
  ligne: string;
  statut: StatutLigneG;
  trace: TraceSaisie | null;
  valeurs: Record<string, string> | null;
}
export interface Formulaire2033GProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  nombre: { codeCase: string; etatCodeCase: EtatCodeCase; statut: StatutLigneG; montant: ChaineDecimale | null; neant: boolean; trace: TraceSaisie | null };
  filiales: LigneFiliale[];
  neant: TraceSaisie | null;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}
export interface DemandeFormulaire2033G {
  versionDonnees: number;
  saisiesTableaux: readonly SaisieTableau[];
}

const trace = (s: SaisieTableau): TraceSaisie => ({ note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees });
const statutDe = (s: SaisieTableau | undefined, v: number): StatutLigneG => (s === undefined ? 'a_saisir' : s.versionDonnees !== v ? 'a_revoir' : 'saisi');

export function preparerFormulaire2033G(demande: DemandeFormulaire2033G): Formulaire2033GProjet {
  const v = demande.versionDonnees;
  const nb = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2033G_NB').map((s) => [s.ligne, s]));
  const fil = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2033G_FIL').map((s) => [s.ligne, s]));
  const filiales: LigneFiliale[] = ['01', '02', '03', '04', '05', '06', '07'].map((l) => {
    const s = fil.get(l);
    const statut = statutDe(s, v);
    return { ligne: l, statut, trace: s ? trace(s) : null, valeurs: statut === 'saisi' ? s!.valeurs : null };
  });
  const sNb = nb.get('NB');
  const statutNb = statutDe(sNb, v);
  const montant = statutNb === 'saisi' ? sNb!.valeurs.c905 ?? null : null;
  const neantS = nb.get('NEANT');
  const neantStatut = statutDe(neantS, v);
  const retenues = filiales.filter((l) => l.statut === 'saisi');
  const etat: Formulaire2033GProjet['etat'] = retenues.length > 0 || statutNb === 'saisi' ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  if (neantStatut === 'saisi' && etat === 'saisi') controles.push({ code: 'G_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le tableau est déclaré « néant » ET porte des saisies : retirer l’une des deux ; les saisies sont retenues.' });
  if (montant !== null && retenues.length > Number(montant)) controles.push({ code: 'G_LIGNES_NOMBRE', statut: 'ecart', message: `${retenues.length} filiale(s) listée(s) pour un nombre total de ${versChaine(new Decimal(montant))} (case 905). Contrôle indicatif.`, ecart: versChaine(new Decimal(retenues.length).minus(montant)) });
  const sous10 = retenues.filter((l) => new Decimal(l.valeurs!.pourcentage ?? '0').lessThan(10));
  if (sous10.length > 0) controles.push({ code: 'G_SEUIL_10', statut: 'ecart', message: `Ligne(s) ${sous10.map((l) => Number(l.ligne)).join(', ')} : pourcentage de détention inférieur à 10 % : le tableau ne liste que les détentions directes d’au moins 10 % du capital (formulaire). Contrôle indicatif.` });
  if (montant !== null && retenues.length < Number(montant) && Number(montant) <= 7) controles.push({ code: 'G_LIGNES_MANQUANTES', statut: 'non_verifie', message: `Le nombre total de filiales (${versChaine(new Decimal(montant))}) excède le nombre de lignes saisies (${retenues.length}) : lignes à saisir.` });
  controles.push({ code: 'G_SANS_SAISIE', statut: 'non_verifie', message: `${7 - retenues.length} ligne(s) sur 7 sans saisie retenue : aucune n’est présumée vide ; le nombre total est à saisir ou le tableau à déclarer « néant ».` });
  return {
    statut: 'projet',
    etat,
    nombre: { codeCase: '905', etatCodeCase: 'lu_verifie', statut: statutNb, montant, neant: montant !== null && new Decimal(montant).isZero(), trace: sNb ? trace(sNb) : null },
    filiales,
    neant: neantS ? trace(neantS) : null,
    controles,
    nonPrepare: [
      'Identification de l’entreprise (SIREN, dénomination, adresse), numéro de dépôt et exercice : repris du dossier, non ressaisis ici.',
      'Tableaux supplémentaires au-delà de sept filiales (formulaire, renvoi 1) : non préparés.',
      'Le portefeuille de titres de participation relève du registre de la société : aucune donnée n’est tirée de la balance.',
    ],
    limites: [
      'Chaque ligne est une saisie justifiée du cabinet ; « néant » est une déclaration explicite du tableau ; une ligne non saisie n’est jamais présumée vide.',
      'Le formulaire n’énonce aucun calcul pour ce tableau : tous les rapprochements sont indicatifs.',
      'Les entreprises individuelles n’ont pas à servir les tableaux 2033-F et 2033-G (notice) ; la préparation ne couvre que la société commerciale.',
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
