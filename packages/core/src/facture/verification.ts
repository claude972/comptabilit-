/**
 * Contrôles de cohérence d'une facture extraite. Purement arithmétiques et formels :
 * ils ne prouvent ni l'authenticité de la pièce ni l'existence de l'émetteur.
 * Aucune horloge n'est consultée (moteur pur) : la plausibilité des dates est bornée
 * par des constantes, pas par la date du jour.
 */
import { Decimal } from 'decimal.js';
import { ecartEnJours, estDateIso } from '../dates.js';
import { sirenDeTvaFr, validerSiren, validerSiret, validerTvaIntracomFr } from '../identifiants.js';
import { estChaineDecimale, versChaine } from '../montant.js';
import type { ChampExtrait, ChampsFacture, VerificationFacture } from './types.js';

/** Taux de TVA reconnus (France métropolitaine hors Corse), en pourcentage. */
export const TAUX_TVA_CONNUS: readonly string[] = ['0', '2.1', '5.5', '10', '20'];
const TOLERANCE_ARRONDI = new Decimal('0.01');
const DATE_MIN_PLAUSIBLE = '1990-01-01';
const DATE_MAX_PLAUSIBLE = '2100-12-31';
const DELAI_ECHEANCE_MAX_JOURS = 366;

function decimal(c: ChampExtrait<string> | null): Decimal | null {
  return c !== null && estChaineDecimale(c.valeur) ? new Decimal(c.valeur) : null;
}

function comparer(code: string, libelle: string, attendu: Decimal, constate: Decimal, tolerance = new Decimal(0)): VerificationFacture {
  const ecart = constate.minus(attendu);
  return ecart.abs().lessThanOrEqualTo(tolerance)
    ? { code, statut: 'ok', message: `${libelle} : cohérent.`, ecart: versChaine(ecart) }
    : { code, statut: 'ecart', message: `${libelle} : écart de ${versChaine(ecart)} (attendu ${versChaine(attendu)}, constaté ${versChaine(constate)}).`, ecart: versChaine(ecart) };
}

const nonVerifiable = (code: string, message: string): VerificationFacture => ({ code, statut: 'non_verifiable', message, ecart: null });

export function verifierCoherenceFacture(c: ChampsFacture): VerificationFacture[] {
  const r: VerificationFacture[] = [];
  const ht = decimal(c.totalHt);
  const tva = decimal(c.totalTva);
  const ttc = decimal(c.totalTtc);

  r.push(
    ht !== null && tva !== null && ttc !== null
      ? comparer('TOTAUX_HT_TVA_TTC', 'Total HT + total TVA = total TTC', ht.plus(tva), ttc)
      : nonVerifiable('TOTAUX_HT_TVA_TTC', 'Total HT, total TVA ou total TTC non extrait : égalité HT + TVA = TTC non vérifiable.'),
  );

  const lignesValides = c.ventilationTva.every((l) => estChaineDecimale(l.taux) && estChaineDecimale(l.base) && estChaineDecimale(l.montant));
  if (c.ventilationTva.length === 0 || !lignesValides) {
    const motif = c.ventilationTva.length === 0 ? 'Ventilation de TVA non extraite' : 'Ventilation de TVA illisible';
    r.push(nonVerifiable('VENTILATION_TOTAL_HT', `${motif} : rapprochement avec le total HT non vérifiable.`));
    r.push(nonVerifiable('VENTILATION_TOTAL_TVA', `${motif} : rapprochement avec le total TVA non vérifiable.`));
    r.push(nonVerifiable('VENTILATION_CALCUL', `${motif} : calcul base × taux non vérifiable.`));
    r.push(nonVerifiable('TAUX_CONNUS', `${motif} : taux non vérifiables.`));
  } else {
    let sommeBases = new Decimal(0);
    let sommeTva = new Decimal(0);
    let pireEcart = new Decimal(0);
    const tauxInconnus: string[] = [];
    for (const l of c.ventilationTva) {
      const base = new Decimal(l.base);
      const montant = new Decimal(l.montant);
      const taux = new Decimal(l.taux);
      sommeBases = sommeBases.plus(base);
      sommeTva = sommeTva.plus(montant);
      const ecart = montant.minus(base.times(taux).div(100));
      if (ecart.abs().greaterThan(pireEcart.abs())) pireEcart = ecart;
      if (!TAUX_TVA_CONNUS.some((t) => new Decimal(t).equals(taux))) tauxInconnus.push(taux.toString());
    }
    r.push(ht !== null ? comparer('VENTILATION_TOTAL_HT', 'Somme des bases de la ventilation = total HT', ht, sommeBases) : nonVerifiable('VENTILATION_TOTAL_HT', 'Total HT non extrait.'));
    r.push(tva !== null ? comparer('VENTILATION_TOTAL_TVA', 'Somme des TVA de la ventilation = total TVA', tva, sommeTva) : nonVerifiable('VENTILATION_TOTAL_TVA', 'Total TVA non extrait.'));
    r.push(
      pireEcart.abs().lessThanOrEqualTo(TOLERANCE_ARRONDI)
        ? { code: 'VENTILATION_CALCUL', statut: 'ok', message: 'TVA de chaque ligne de ventilation = base × taux (à 0,01 près).', ecart: versChaine(pireEcart) }
        : { code: 'VENTILATION_CALCUL', statut: 'ecart', message: `TVA d'une ligne de ventilation différente de base × taux : écart maximal ${versChaine(pireEcart)}.`, ecart: versChaine(pireEcart) },
    );
    r.push(
      tauxInconnus.length === 0
        ? { code: 'TAUX_CONNUS', statut: 'ok', message: 'Taux de TVA reconnus.', ecart: null }
        : { code: 'TAUX_CONNUS', statut: 'ecart', message: `Taux de TVA non reconnu(s) : ${tauxInconnus.join(', ')} % (taux reconnus : ${TAUX_TVA_CONNUS.join(', ')}).`, ecart: null },
    );
  }

  const siren = c.emetteurSiren?.valeur ?? null;
  const siret = c.emetteurSiret?.valeur ?? null;
  const numTva = c.emetteurTva?.valeur ?? null;
  const formel = (code: string, libelle: string, valeur: string | null, valider: (v: string) => { valide: boolean; motif?: string }): void => {
    if (valeur === null) {
      r.push(nonVerifiable(code, `${libelle} de l'émetteur non extrait.`));
      return;
    }
    const v = valider(valeur);
    r.push({ code, statut: v.valide ? 'ok' : 'ecart', message: v.valide ? `${libelle} de l'émetteur : clé de contrôle correcte.` : `${libelle} de l'émetteur invalide : ${v.motif ?? 'motif inconnu'}`, ecart: null });
  };
  formel('SIREN_VALIDE', 'SIREN', siren, validerSiren);
  formel('SIRET_VALIDE', 'SIRET', siret, validerSiret);
  if (numTva !== null && !/^FR/i.test(numTva)) {
    r.push(nonVerifiable('TVA_VALIDE', 'Numéro de TVA non français : contrôle de clé non implémenté.'));
  } else {
    formel('TVA_VALIDE', 'Numéro de TVA', numTva, validerTvaIntracomFr);
  }

  const sirens = new Map<string, string>();
  if (siren !== null) sirens.set('SIREN', siren.replace(/\s/g, ''));
  if (siret !== null && /^\d{14}$/.test(siret.replace(/\s/g, ''))) sirens.set('SIRET', siret.replace(/\s/g, '').slice(0, 9));
  const sirenTva = numTva !== null ? sirenDeTvaFr(numTva) : null;
  if (sirenTva !== null) sirens.set('TVA', sirenTva);
  if (sirens.size < 2) {
    r.push(nonVerifiable('IDENTIFIANTS_COHERENTS', 'Moins de deux identifiants de l’émetteur extraits : cohérence SIREN / SIRET / TVA non vérifiable.'));
  } else {
    const distincts = new Set(sirens.values());
    r.push(
      distincts.size === 1
        ? { code: 'IDENTIFIANTS_COHERENTS', statut: 'ok', message: `${[...sirens.keys()].join(', ')} de l'émetteur : même SIREN.`, ecart: null }
        : { code: 'IDENTIFIANTS_COHERENTS', statut: 'ecart', message: `Identifiants de l'émetteur incohérents : ${[...sirens].map(([k, v]) => `${k} → ${v}`).join(' ; ')}.`, ecart: null },
    );
  }

  const emission = c.dateEmission?.valeur ?? null;
  const echeance = c.dateEcheance?.valeur ?? null;
  if (emission === null) {
    r.push(nonVerifiable('DATE_EMISSION_PLAUSIBLE', 'Date d’émission non extraite.'));
  } else if (!estDateIso(emission) || emission < DATE_MIN_PLAUSIBLE || emission > DATE_MAX_PLAUSIBLE) {
    r.push({ code: 'DATE_EMISSION_PLAUSIBLE', statut: 'ecart', message: `Date d'émission ${emission} invalide ou hors de l'intervalle plausible (${DATE_MIN_PLAUSIBLE} – ${DATE_MAX_PLAUSIBLE}).`, ecart: null });
  } else {
    r.push({ code: 'DATE_EMISSION_PLAUSIBLE', statut: 'ok', message: 'Date d’émission valide (plausibilité bornée, sans référence à la date du jour).', ecart: null });
  }
  if (emission === null || echeance === null) {
    r.push(nonVerifiable('DATE_ECHEANCE_COHERENTE', 'Date d’émission ou d’échéance non extraite.'));
  } else if (!estDateIso(emission) || !estDateIso(echeance)) {
    r.push({ code: 'DATE_ECHEANCE_COHERENTE', statut: 'ecart', message: 'Date d’émission ou d’échéance invalide.', ecart: null });
  } else {
    const delai = ecartEnJours(emission, echeance);
    r.push(
      delai >= 0 && delai <= DELAI_ECHEANCE_MAX_JOURS
        ? { code: 'DATE_ECHEANCE_COHERENTE', statut: 'ok', message: `Échéance à ${delai} jour(s) de l'émission.`, ecart: null }
        : { code: 'DATE_ECHEANCE_COHERENTE', statut: 'ecart', message: delai < 0 ? 'Échéance antérieure à la date d’émission.' : `Échéance à ${delai} jours de l'émission (plus de ${DELAI_ECHEANCE_MAX_JOURS}).`, ecart: null },
    );
  }

  const devise = c.devise?.valeur ?? null;
  r.push(
    devise === null
      ? nonVerifiable('DEVISE_EURO', 'Devise non extraite.')
      : devise === 'EUR'
        ? { code: 'DEVISE_EURO', statut: 'ok', message: 'Facture en euros.', ecart: null }
        : { code: 'DEVISE_EURO', statut: 'ecart', message: `Facture en ${devise} : hors périmètre (euros uniquement).`, ecart: null },
  );
  return r;
}
