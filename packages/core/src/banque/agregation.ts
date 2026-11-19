/**
 * Relevé issu d'un PRESTATAIRE D'AGRÉGATION bancaire, au format pivot interne `comtaple.releve-agregation/1`.
 *
 * L'adaptateur du prestataire (paquet plateforme) convertit ce qu'il reçoit en ce document JSON, qui est conservé comme
 * ORIGINAL de l'import (provenance : prestataire, identifiants de compte et d'opération fournis par lui). Le document
 * passe ensuite par la même chaîne que les fichiers camt.053, OFX et CSV : idempotence, cadrage, versions.
 * Aucun prestataire n'est choisi ni contracté à ce jour : ce format n'a été exercé que contre un simulateur.
 *
 * Un agrégateur fournit en général un solde courant, pas un solde d'ouverture : le cadrage est alors « non vérifiable »,
 * jamais « ok » par défaut.
 */
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dateCivileValide } from '../dates.js';
import { validerIban } from '../identifiants.js';
import { sourceInterne } from '../sources.js';
import { type BrouillonCompte, type BrouillonMouvement, chaineMontant, CollecteurAnomalies, finaliserReleve, nettoyerTexteBancaire, referenceOuNull, releveIllisible, TAILLE_MAX_RELEVE } from './commun.js';
import type { RapportReleve } from './types.js';

export const FORMAT_RELEVE_AGREGATION = 'comtaple.releve-agregation/1';

export const SOURCE_RELEVE_AGREGATION = sourceInterne(
  'Format pivot interne des relevés obtenus d’un prestataire d’agrégation (aucun standard commun aux prestataires). Aucun prestataire choisi : exercé contre un simulateur uniquement.',
);

const montantDecimal = z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/);
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const schemaReleveAgregation = z.object({
  format: z.literal(FORMAT_RELEVE_AGREGATION),
  /** Identifiant technique de l'adaptateur (ex. « simulateur »). */
  prestataire: z.string().min(1).max(60),
  extraitLe: z.string().min(10).max(40),
  comptes: z
    .array(
      z.object({
        /** Identifiant du compte chez le prestataire. */
        identifiant: z.string().min(1).max(140),
        iban: z.string().max(42).nullable().optional(),
        devise: z.string().length(3).nullable().optional(),
        /** Solde communiqué par le prestataire à une date donnée (solde « de clôture » du relevé). */
        solde: z.object({ montant: montantDecimal, date: dateIso }).nullable().optional(),
        mouvements: z.array(
          z.object({
            /** Identifiant de l'opération chez le prestataire : sert de référence bancaire (idempotence). */
            identifiant: z.string().min(1).max(140),
            dateOperation: dateIso,
            dateValeur: dateIso.nullable().optional(),
            /** Signé : positif = encaissement, négatif = décaissement. */
            montant: montantDecimal,
            libelle: z.string().max(2000),
            contrepartie: z.string().max(200).nullable().optional(),
          }),
        ),
      }),
    )
    .max(200),
});
export type ReleveAgregation = z.infer<typeof schemaReleveAgregation>;

const dateValide = (v: string): boolean => {
  const [a, m, j] = v.split('-').map(Number) as [number, number, number];
  return dateCivileValide(a, m, j);
};

export function lireReleveAgregation(contenu: string): RapportReleve {
  const anomalies = new CollecteurAnomalies();
  const illisible = (code: string, message: string) => {
    anomalies.signaler(code, 'bloquante', message);
    return releveIllisible('agregation', null, anomalies, SOURCE_RELEVE_AGREGATION);
  };
  if (typeof contenu !== 'string' || contenu.trim() === '') return illisible('FICHIER_VIDE', 'Document d’agrégation absent ou vide.');
  if (contenu.length > TAILLE_MAX_RELEVE) return illisible('TROP_VOLUMINEUX', `Relevé de plus de ${TAILLE_MAX_RELEVE} caractères : refusé.`);
  let brut: unknown;
  try {
    brut = JSON.parse(contenu);
  } catch {
    return illisible('JSON_INVALIDE', 'Document d’agrégation illisible (JSON invalide).');
  }
  const lu = schemaReleveAgregation.safeParse(brut);
  if (!lu.success) {
    const premier = lu.error.issues[0];
    return illisible('STRUCTURE_INVALIDE', `Document d’agrégation non conforme au format ${FORMAT_RELEVE_AGREGATION} (${premier ? `${premier.path.join('.')} : ${premier.message}` : 'structure'}).`);
  }
  if (lu.data.comptes.length === 0) anomalies.signaler('AUCUN_RELEVE', 'bloquante', 'Aucun compte dans le document d’agrégation.');

  const comptes: BrouillonCompte[] = [];
  const mouvements: BrouillonMouvement[] = [];
  for (const [indexCompte, c] of lu.data.comptes.entries()) {
    const ibanBrut = c.iban?.replace(/\s/g, '').toUpperCase() ?? null;
    const iban = ibanBrut !== null && validerIban(ibanBrut).valide ? ibanBrut : null;
    if (ibanBrut !== null && iban === null) anomalies.signaler('IBAN_INVALIDE', 'mineure', `Compte n° ${indexCompte + 1} : IBAN fourni invalide, ignoré (le compte reste identifié par l’identifiant du prestataire).`);
    const identifiant = iban !== null ? null : referenceOuNull(`${lu.data.prestataire}:${c.identifiant}`);
    const compte = { iban, bic: null, identifiant, devise: c.devise ?? null };
    const soldeValide = c.solde != null && dateValide(c.solde.date);
    if (c.solde != null && !soldeValide) anomalies.signaler('SOLDE_ILLISIBLE', 'majeure', `Compte n° ${indexCompte + 1} : date du solde invalide, solde ignoré.`);
    comptes.push({ iban, identifiant, devise: c.devise ?? null, soldeOuverture: null, dateOuverture: null, soldeCloture: soldeValide ? new Decimal(c.solde!.montant) : null, dateCloture: soldeValide ? c.solde!.date : null });
    const vus = new Set<string>();
    for (const [i, m] of c.mouvements.entries()) {
      const rang = mouvements.length + 1;
      if (!dateValide(m.dateOperation)) {
        anomalies.signaler('ECRITURE_ILLISIBLE', 'majeure', `Compte n° ${indexCompte + 1}, opération n° ${i + 1} : date d’opération invalide, opération écartée.`);
        continue;
      }
      if (vus.has(m.identifiant)) anomalies.signaler('IDENTIFIANT_EN_DOUBLE', 'majeure', 'Identifiant d’opération déjà rencontré dans ce compte : opération conservée, doublon possible.', rang);
      vus.add(m.identifiant);
      const contrepartie = referenceOuNull(m.contrepartie ?? null);
      mouvements.push({
        indexCompte,
        compte,
        dateOperation: m.dateOperation,
        dateValeur: m.dateValeur != null && dateValide(m.dateValeur) ? m.dateValeur : null,
        montant: chaineMontant(new Decimal(m.montant)),
        libelle: nettoyerTexteBancaire(m.libelle),
        referenceBanque: referenceOuNull(m.identifiant),
        referenceBoutEnBout: null,
        contrepartie: contrepartie === null ? null : { nom: contrepartie, iban: null },
        codeOperation: null,
      });
    }
  }
  return finaliserReleve('agregation', lu.data.prestataire, comptes, mouvements, anomalies, SOURCE_RELEVE_AGREGATION);
}
