/**
 * Moteur d'abonnement : forfait par cabinet, tranches de dossiers actifs, période d'essai, quotas.
 * Pur et déterministe : aucun tarif n'est codé ici. La grille est une donnée configurable fournie par l'appelant ;
 * les grilles de démonstration sont marquées « fictif ». Montants hors taxes, en chaînes décimales.
 */
import { z } from 'zod';
import { type ChaineDecimale, dec, schemaChaineDecimale, versChaine } from './montant.js';

export const schemaOffre = z.object({
  code: z.string().min(1).max(40),
  libelle: z.string().min(1).max(120),
  /** Forfait mensuel du cabinet, hors taxes. */
  forfaitMensuel: schemaChaineDecimale,
  /** Dossiers actifs compris dans le forfait. */
  dossiersInclus: z.number().int().min(0),
  /**
   * Tranches au-delà des dossiers inclus, par ordre croissant : chaque dossier supplémentaire est facturé au prix de
   * SA tranche (barème progressif). `jusqua: null` = sans plafond. Sans tranche couvrant un dossier, le calcul s'abstient.
   */
  tranches: z.array(z.object({ jusqua: z.number().int().positive().nullable(), prixParDossier: schemaChaineDecimale })),
  quotas: z.object({ piecesParMois: z.number().int().positive().nullable(), stockageGo: z.number().positive().nullable() }),
  joursEssai: z.number().int().min(0).max(365),
  /** Vrai pour une grille de démonstration : les montants ne sont pas des tarifs commerciaux. */
  fictif: z.boolean(),
});
export type Offre = z.infer<typeof schemaOffre>;

export interface LigneEcheance {
  nature: 'forfait' | 'tranche';
  libelle: string;
  quantite: number;
  prixUnitaire: ChaineDecimale;
  montant: ChaineDecimale;
}
export interface CalculEcheance {
  statut: 'calcule' | 'non_calculable';
  motif: string | null;
  lignes: LigneEcheance[];
  totalHt: ChaineDecimale | null;
  dossiersActifs: number;
  dossiersFactures: number;
  fictif: boolean;
}

/** Vérifie la cohérence d'une grille : tranches strictement croissantes, la tranche sans plafond en dernier. */
export function verifierOffre(offre: Offre): string[] {
  const erreurs: string[] = [];
  let precedent = offre.dossiersInclus;
  offre.tranches.forEach((t, i) => {
    if (t.jusqua === null) {
      if (i !== offre.tranches.length - 1) erreurs.push('La tranche sans plafond doit être la dernière.');
    } else {
      if (t.jusqua <= precedent) erreurs.push(`La tranche ${i + 1} (jusqu'à ${t.jusqua}) ne dépasse pas la borne précédente (${precedent}).`);
      precedent = t.jusqua;
    }
    if (dec(t.prixParDossier).isNegative()) erreurs.push(`Prix négatif en tranche ${i + 1}.`);
  });
  if (dec(offre.forfaitMensuel).isNegative()) erreurs.push('Forfait négatif.');
  return erreurs;
}

/** Calcule l'échéance mensuelle d'un cabinet pour un nombre de dossiers actifs constaté. */
export function calculerEcheance(offre: Offre, dossiersActifs: number): CalculEcheance {
  const base = { lignes: [] as LigneEcheance[], totalHt: null, dossiersActifs, dossiersFactures: 0, fictif: offre.fictif };
  if (!Number.isInteger(dossiersActifs) || dossiersActifs < 0) return { ...base, statut: 'non_calculable', motif: 'Nombre de dossiers actifs invalide.' };
  const erreurs = verifierOffre(offre);
  if (erreurs.length) return { ...base, statut: 'non_calculable', motif: `Grille incohérente : ${erreurs.join(' ')}` };

  const lignes: LigneEcheance[] = [
    { nature: 'forfait', libelle: `Forfait ${offre.libelle} (${offre.dossiersInclus} dossiers actifs inclus)`, quantite: 1, prixUnitaire: versChaine(dec(offre.forfaitMensuel)), montant: versChaine(dec(offre.forfaitMensuel)) },
  ];
  let total = dec(offre.forfaitMensuel);
  let borne = offre.dossiersInclus;
  let restants = Math.max(0, dossiersActifs - offre.dossiersInclus);
  const supplementaires = restants;
  for (const t of offre.tranches) {
    if (restants === 0) break;
    const capacite = t.jusqua === null ? restants : Math.max(0, t.jusqua - borne);
    const quantite = Math.min(restants, capacite);
    if (quantite > 0) {
      const montant = dec(t.prixParDossier).times(quantite);
      lignes.push({
        nature: 'tranche',
        libelle: t.jusqua === null ? `Dossiers actifs au-delà de ${borne}` : `Dossiers actifs de ${borne + 1} à ${t.jusqua}`,
        quantite,
        prixUnitaire: versChaine(dec(t.prixParDossier)),
        montant: versChaine(montant),
      });
      total = total.plus(montant);
      restants -= quantite;
    }
    if (t.jusqua !== null) borne = t.jusqua;
  }
  if (restants > 0) {
    return { ...base, statut: 'non_calculable', motif: `Aucune tranche ne couvre ${restants} dossier(s) au-delà de ${borne} : l'offre ne permet pas ce volume.` };
  }
  return { statut: 'calcule', motif: null, lignes, totalHt: versChaine(total), dossiersActifs, dossiersFactures: supplementaires, fictif: offre.fictif };
}

export type StatutAbonnement = 'essai' | 'actif' | 'suspendu' | 'resilie';
export interface EtatAbonnement {
  statut: StatutAbonnement;
  /** Dates ISO AAAA-MM-JJ. */
  debut: string;
  finEssai: string | null;
  fin: string | null;
}
export type SituationAbonnement = 'essai' | 'essai_expire' | 'actif' | 'resiliation_programmee' | 'suspendu' | 'resilie' | 'aucun';

/**
 * Situation effective à une date donnée. Un essai dont la date de fin est passée est « expiré » même si personne
 * n'a encore mis le statut à jour ; une résiliation dont l'échéance n'est pas atteinte laisse le service ouvert.
 */
export function situationAbonnement(etat: EtatAbonnement | null, aujourdhui: string): SituationAbonnement {
  if (!etat) return 'aucun';
  if (etat.statut === 'suspendu') return 'suspendu';
  if (etat.statut === 'resilie') return etat.fin !== null && aujourdhui <= etat.fin ? 'resiliation_programmee' : 'resilie';
  if (etat.statut === 'essai') return etat.finEssai !== null && aujourdhui > etat.finEssai ? 'essai_expire' : 'essai';
  return 'actif';
}

/** La collecte et les imports sont ouverts pendant l'essai, l'abonnement actif et jusqu'à l'échéance d'une résiliation. */
export function serviceOuvert(situation: SituationAbonnement): boolean {
  return situation === 'essai' || situation === 'actif' || situation === 'resiliation_programmee';
}

export interface EtatQuota {
  consomme: number;
  limite: number | null;
  /** null quand il n'y a pas de limite. */
  restant: number | null;
  depasse: boolean;
  tauxPourcent: number | null;
}
export function etatQuota(consomme: number, limite: number | null): EtatQuota {
  if (limite === null) return { consomme, limite: null, restant: null, depasse: false, tauxPourcent: null };
  return { consomme, limite, restant: Math.max(0, limite - consomme), depasse: consomme > limite, tauxPourcent: Math.round((consomme / limite) * 1000) / 10 };
}
