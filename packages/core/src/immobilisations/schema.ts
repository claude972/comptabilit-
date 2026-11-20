/**
 * Schéma de validation d'une immobilisation du fichier saisi par le cabinet (D-071, D-089).
 *
 * Source UNIQUE des contrôles : la saisie manuelle (`POST v1/dossiers/:id/immobilisations`) et la reprise par import
 * (D-092) appliquent exactement ce schéma, de sorte qu'un fichier repris ne puisse jamais contourner une règle de la saisie.
 */
import { z } from 'zod';
import { estDateIso } from '../dates.js';
import { dec, schemaChaineDecimale } from '../montant.js';

export const MODES_AMORTISSEMENT = ['lineaire', 'degressif'] as const;
export const COEFFICIENTS_DEGRESSIFS = ['1.25', '1.75', '2.25'] as const;

/** Coefficient du dégressif selon la durée en années (CGI art. 39 A, BOFiP BOI-BIC-AMT-20-20-30 § 120) : 3-4 ans 1,25 ; 5-6 ans 1,75 ; au-delà 2,25. */
export const coefficientDegressifAttendu = (annees: number): string => (annees <= 4 ? '1.25' : annees <= 6 ? '1.75' : '2.25');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date AAAA-MM-JJ attendue');

export const schemaImmobilisationBase = z.object({
  libelle: z.string().trim().min(1).max(200),
  compteImmobilisation: z.string().regex(/^2\d{2,11}$/, 'compte d’immobilisation du PCG attendu (classe 2)'),
  baseAmortissable: schemaChaineDecimale,
  /** Date d'acquisition (ou de construction) : obligatoire en dégressif (point de départ : premier jour du mois), facultative sinon. */
  dateAcquisition: DATE.nullable().optional(),
  dateMiseEnService: DATE,
  dureeMois: z.number().int().min(1).max(1200),
  amortissementsAnterieurs: schemaChaineDecimale.nullable().optional(),
  modeAmortissement: z.enum(MODES_AMORTISSEMENT).default('lineaire'),
  coefficientDegressif: schemaChaineDecimale.nullable().optional(),
  eligibiliteDegressifConfirmee: z.boolean().nullable().optional(),
  valeurResiduelle: schemaChaineDecimale.nullable().optional(),
  dateSortie: DATE.nullable().optional(),
  composantDe: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'identifiant invalide').nullable().optional(),
});

/** Règles croisées de la saisie : chacune protège un choix du cabinet que le moteur ne doit jamais deviner. */
export const schemaImmobilisation = schemaImmobilisationBase.superRefine((d, ctx) => {
  const erreur = (champ: string, message: string) => ctx.addIssue({ code: 'custom', path: [champ], message });
  const base = dec(d.baseAmortissable);
  if (!base.isPositive() || base.isZero()) erreur('baseAmortissable', 'La base amortissable (valeur brute) doit être strictement positive');
  if (!estDateIso(d.dateMiseEnService)) erreur('dateMiseEnService', 'date inexistante');
  if (d.dateAcquisition != null) {
    if (!estDateIso(d.dateAcquisition)) erreur('dateAcquisition', 'date inexistante');
    else if (d.dateAcquisition > d.dateMiseEnService) erreur('dateAcquisition', 'La date d’acquisition ne peut pas être postérieure à la mise en service');
  }
  if (d.dateSortie != null) {
    if (!estDateIso(d.dateSortie)) erreur('dateSortie', 'date inexistante');
    else if (d.dateSortie < d.dateMiseEnService) erreur('dateSortie', 'La date de sortie ne peut pas précéder la mise en service');
  }
  if (d.valeurResiduelle != null) {
    const v = dec(d.valeurResiduelle);
    if (v.isNegative()) erreur('valeurResiduelle', 'La valeur résiduelle ne peut pas être négative');
    else if (v.greaterThanOrEqualTo(base)) erreur('valeurResiduelle', 'La valeur résiduelle doit être strictement inférieure à la valeur brute (sinon il n’y a rien à amortir)');
  }
  const net = base.minus(d.valeurResiduelle != null ? dec(d.valeurResiduelle) : dec('0'));
  if (d.amortissementsAnterieurs != null && (dec(d.amortissementsAnterieurs).isNegative() || dec(d.amortissementsAnterieurs).greaterThan(net))) {
    erreur('amortissementsAnterieurs', 'Les amortissements antérieurs sont compris entre zéro et le montant amortissable (valeur brute − valeur résiduelle)');
  }
  if (d.modeAmortissement === 'degressif') {
    if (d.dateAcquisition == null) erreur('dateAcquisition', 'Dégressif : la date d’acquisition (ou de construction) est obligatoire, le point de départ du dégressif étant le premier jour du mois d’acquisition');
    if (!d.compteImmobilisation.startsWith('21')) erreur('compteImmobilisation', 'Le dégressif ne vise que des immobilisations corporelles (compte de la classe 21)');
    if (d.dureeMois % 12 !== 0 || d.dureeMois < 36 || d.dureeMois > 600) erreur('dureeMois', 'Dégressif : durée en années entières, de 3 à 50 ans (36 à 600 mois)');
    if (d.eligibiliteDegressifConfirmee === undefined || d.eligibiliteDegressifConfirmee === null) erreur('eligibiliteDegressifConfirmee', 'Dégressif : le cabinet doit confirmer (true) ou infirmer (false) l’éligibilité du bien ; elle n’est jamais devinée');
    if (d.coefficientDegressif === undefined || d.coefficientDegressif === null) erreur('coefficientDegressif', 'Dégressif : le coefficient est à déclarer');
    else if (!(COEFFICIENTS_DEGRESSIFS as readonly string[]).includes(d.coefficientDegressif)) erreur('coefficientDegressif', 'Coefficient attendu : 1.25, 1.75 ou 2.25');
    else if (d.dureeMois % 12 === 0 && d.dureeMois >= 36 && d.dureeMois <= 600 && d.coefficientDegressif !== coefficientDegressifAttendu(d.dureeMois / 12)) {
      erreur('coefficientDegressif', `Coefficient incohérent avec la durée de ${d.dureeMois / 12} ans : ${coefficientDegressifAttendu(d.dureeMois / 12)} attendu (1.25 pour 3 ou 4 ans, 1.75 pour 5 ou 6 ans, 2.25 au-delà de 6 ans)`);
    }
  } else {
    if (d.coefficientDegressif != null) erreur('coefficientDegressif', 'Le coefficient n’a de sens qu’en mode dégressif');
    if (d.eligibiliteDegressifConfirmee != null) erreur('eligibiliteDegressifConfirmee', 'L’éligibilité au dégressif n’a de sens qu’en mode dégressif');
  }
});

export type ImmobilisationSaisie = z.infer<typeof schemaImmobilisation>;
