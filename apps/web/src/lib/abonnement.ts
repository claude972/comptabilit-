/**
 * Abonnement du cabinet : formes de `apps/api/src/abonnement.controller.ts` et libellés.
 * Les montants sont des chaînes décimales calculées par le moteur ; l'interface ne calcule rien.
 */
export type Situation = 'essai' | 'essai_expire' | 'actif' | 'resiliation_programmee' | 'suspendu' | 'resilie' | 'aucun';
export interface SituationAbonnement {
  situation: Situation;
  serviceOuvert: boolean;
  finEssai: string | null;
  fin: string | null;
}
export interface Offre {
  code: string;
  libelle: string;
  forfaitMensuel: string;
  dossiersInclus: number;
  tranches: Array<{ jusqua: number | null; prixParDossier: string }>;
  quotas: { piecesParMois: number | null; stockageGo: number | null };
  joursEssai: number;
  fictif: boolean;
}
export interface Quota {
  consomme: number;
  limite: number | null;
  restant: number | null;
  depasse: boolean;
  tauxPourcent: number | null;
}
export interface LigneEcheance {
  nature: 'forfait' | 'tranche';
  libelle: string;
  quantite: number;
  prixUnitaire: string;
  montant: string;
}
export interface Estimation {
  statut: 'calcule' | 'non_calculable';
  motif: string | null;
  lignes: LigneEcheance[];
  totalHt: string | null;
  dossiersActifs: number;
  dossiersFactures: number;
  fictif: boolean;
}
export interface DetailAbonnement {
  situation: Situation;
  serviceOuvert: boolean;
  abonnement: { id: string; offre: string; statut: string; debut: string; finEssai: string | null; fin: string | null; offreDemandee: string | null; motifResiliation: string | null } | null;
  offre: Offre | null;
  usage: { dossiersActifs: number; dossiersInclus: number; piecesCeMois: Quota; stockageGo: Quota } | null;
  estimation: Estimation | null;
}
export interface Echeance {
  id: string;
  periodeDebut: string;
  periodeFin: string;
  offre: string;
  dossiersActifs: number;
  lignes: LigneEcheance[];
  totalHt: string;
  fictif: boolean;
  statutPaiement: string;
  referenceVirement: string;
  payeLe: string | null;
}
export interface EvenementFacturation {
  id: string;
  type: string;
  montant: string | null;
  detail: unknown;
  creeLe: string;
}

export const LIBELLE_SITUATION: Record<Situation, string> = {
  essai: 'Période d’essai',
  essai_expire: 'Essai terminé',
  actif: 'Abonnement actif',
  resiliation_programmee: 'Résiliation programmée',
  suspendu: 'Abonnement suspendu',
  resilie: 'Abonnement résilié',
  aucun: 'Aucun abonnement',
};
/** Ce qui ferme le service, dit simplement. Null quand le service est ouvert. */
const CAUSE_FERMETURE: Partial<Record<Situation, string>> = {
  essai_expire: 'La période d’essai du cabinet est terminée.',
  suspendu: 'L’abonnement du cabinet est suspendu.',
  resilie: 'L’abonnement du cabinet est résilié.',
  aucun: 'Aucun abonnement n’est ouvert pour ce cabinet.',
};
export function estSituation(v: unknown): v is Situation {
  return typeof v === 'string' && Object.hasOwn(LIBELLE_SITUATION, v);
}
/** Message « service fermé » : ce n'est pas une panne, et la consultation comme la restitution restent possibles. */
export function messageServiceFerme(situation: unknown): { titre: string; cause: string; suite: string } {
  const cause = (estSituation(situation) ? CAUSE_FERMETURE[situation] : undefined) ?? 'Le service est fermé pour ce cabinet.';
  return {
    titre: 'Dépôts et imports suspendus',
    cause,
    suite: 'Ce n’est pas une panne : les nouveaux dépôts et imports sont suspendus tant que l’abonnement n’est pas rouvert. La consultation des dossiers et la restitution des données restent possibles. Rapprochez-vous de l’administrateur de votre cabinet.',
  };
}

export const LIBELLE_PAIEMENT: Record<string, string> = {
  en_attente_virement: 'En attente du virement',
  paye: 'Payée',
  en_retard: 'En retard',
  annulee: 'Annulée',
};
export const LIBELLE_EVENEMENT: Record<string, string> = {
  essai_ouvert: 'Ouverture de la période d’essai',
  changement_offre_demande: 'Changement d’offre demandé',
  changement_offre_applique: 'Changement d’offre appliqué',
  resiliation: 'Résiliation',
  echeance_emise: 'Échéance émise',
  paiement_rapproche: 'Paiement rapproché par l’éditeur',
  suspension: 'Suspension',
  reactivation: 'Réactivation',
};
/** Tranche d'une offre en clair (« du 11e au 30e dossier »), sans calcul de montant. */
export function decrireTranches(offre: Pick<Offre, 'dossiersInclus' | 'tranches'>): Array<{ portee: string; prix: string }> {
  let debut = offre.dossiersInclus + 1;
  return offre.tranches.map((t) => {
    const portee = t.jusqua === null ? `À partir du ${debut}ᵉ dossier` : `Du ${debut}ᵉ au ${t.jusqua}ᵉ dossier`;
    if (t.jusqua !== null) debut = t.jusqua + 1;
    return { portee, prix: t.prixParDossier };
  });
}
/** Détail d'un événement réduit à des paires simples. */
export function detailEvenement(detail: unknown): string {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return '';
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => (typeof v === 'string' && v.length <= 60) || typeof v === 'number')
    .slice(0, 4)
    .map(([k, v]) => `${k} : ${String(v)}`)
    .join(' · ');
}
