/**
 * Rentabilité d'une mission sur une période, à partir de données EXPLICITEMENT saisies :
 *  - honoraires des lettres de mission validées (forfait annuel, ou taux horaire pour le temps passé) ;
 *  - temps OBSERVÉS saisis sur les travaux ;
 *  - coût horaire interne du cabinet, s'il a été renseigné.
 * Pur et déterministe. Aucun prix, aucun temps, aucun coût n'est supposé : ce qui manque rend le résultat partiel ou
 * non calculable, et c'est dit. Conventions internes documentées ci-dessous (prorata sur 365 jours).
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, dec, versChaine } from './montant.js';
import { type LettreDatee, lettreApplicable } from './missions.js';

export interface TravailObserve {
  date: string;
  prestation: string;
  /** Temps observé en minutes ; null si non saisi. */
  minutes: number | null;
}

export interface RentabiliteMission {
  periode: { debut: string; fin: string };
  honoraires: {
    statut: 'calcule' | 'non_calculable';
    motif: string | null;
    /** Part forfaitaire, au prorata des jours couverts par chaque lettre validée. */
    forfait: ChaineDecimale;
    /** Part au temps passé : temps observés dans le périmètre × taux horaire de la lettre applicable. */
    tempsPasse: ChaineDecimale;
    total: ChaineDecimale | null;
    detail: Array<{ lettreId: string; du: string; au: string; jours: number; mode: string; montant: ChaineDecimale }>;
  };
  temps: {
    /** Minutes observées sur des travaux dans le périmètre de la lettre applicable à leur date. */
    minutesDansPerimetre: number;
    /** Minutes observées sur des travaux potentiellement hors périmètre : non couvertes par les honoraires calculés. */
    minutesHorsPerimetre: number;
    /** Minutes observées à une date sans lettre applicable. */
    minutesSansLettre: number;
    /** Travaux sans temps saisi : ils rendent tout ratio horaire PARTIEL. */
    travauxSansTemps: number;
    nbTravaux: number;
  };
  /** Honoraires par heure observée dans le périmètre (ce que la mission rapporte par heure réellement passée). */
  tauxHoraireRealise: { statut: 'calcule' | 'partiel' | 'non_calculable'; valeur: ChaineDecimale | null; motif: string | null };
  /** Renseigné seulement si un coût horaire interne a été fourni. */
  marge: { statut: 'calcule' | 'partiel' | 'non_calculable'; coutHoraire: ChaineDecimale | null; cout: ChaineDecimale | null; valeur: ChaineDecimale | null; tauxPourcent: ChaineDecimale | null; motif: string | null };
  mentions: string[];
}

const JOUR = 86_400_000;
const versDate = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const versIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const joursEntre = (du: string, au: string) => Math.round((versDate(au) - versDate(du)) / JOUR) + 1;

export function calculerRentabiliteMission(entree: {
  periode: { debut: string; fin: string };
  /** Lettres et avenants de LA mission (tous statuts : seules les validées comptent). */
  lettres: readonly LettreDatee[];
  travaux: readonly TravailObserve[];
  coutHoraire?: ChaineDecimale | null;
}): RentabiliteMission {
  const { periode, lettres } = entree;
  if (!(periode.debut <= periode.fin)) throw new Error('Période invalide');
  const mentions: string[] = ['Prorata des forfaits annuels sur 365 jours (convention interne).'];

  // Découpe la période en segments homogènes : une seule lettre applicable par segment.
  const bornes = new Set<number>([versDate(periode.debut)]);
  for (const l of lettres.filter((x) => x.statut === 'validee')) {
    const effet = versDate(l.dateEffet);
    if (effet > versDate(periode.debut) && effet <= versDate(periode.fin)) bornes.add(effet);
    if (l.contenu.duree.fin && !l.contenu.duree.taciteReconduction) {
      const lendemain = versDate(l.contenu.duree.fin) + JOUR;
      if (lendemain > versDate(periode.debut) && lendemain <= versDate(periode.fin)) bornes.add(lendemain);
    }
  }
  const debuts = [...bornes].sort((a, b) => a - b);
  let forfait = new Decimal(0);
  let joursSansLettre = 0;
  let forfaitNonRenseigne = false;
  const detail: RentabiliteMission['honoraires']['detail'] = [];
  debuts.forEach((debut, i) => {
    const fin = (i + 1 < debuts.length ? debuts[i + 1]! - JOUR : versDate(periode.fin));
    const du = versIso(debut);
    const au = versIso(fin);
    const jours = joursEntre(du, au);
    const lettre = lettreApplicable(lettres, du);
    if (!lettre) {
      joursSansLettre += jours;
      return;
    }
    const h = lettre.contenu.honoraires;
    let montant = new Decimal(0);
    if (h.mode === 'forfait' || h.mode === 'mixte') {
      if (h.montantAnnuelHt === null) forfaitNonRenseigne = true;
      else montant = dec(h.montantAnnuelHt).times(jours).div(365);
    }
    forfait = forfait.plus(montant);
    detail.push({ lettreId: lettre.id, du, au, jours, mode: h.mode, montant: versChaine(montant) });
  });

  // Temps observés, classés selon la lettre applicable à la date de chaque travail.
  const temps = { minutesDansPerimetre: 0, minutesHorsPerimetre: 0, minutesSansLettre: 0, travauxSansTemps: 0, nbTravaux: 0 };
  let tempsPasse = new Decimal(0);
  let tauxHoraireManquant = false;
  for (const t of entree.travaux) {
    if (t.date < periode.debut || t.date > periode.fin) continue;
    temps.nbTravaux++;
    if (t.minutes === null) {
      temps.travauxSansTemps++;
      continue;
    }
    const lettre = lettreApplicable(lettres, t.date);
    if (!lettre) {
      temps.minutesSansLettre += t.minutes;
      continue;
    }
    if (!lettre.contenu.perimetre.some((p) => p.prestation === t.prestation)) {
      temps.minutesHorsPerimetre += t.minutes;
      continue;
    }
    temps.minutesDansPerimetre += t.minutes;
    const h = lettre.contenu.honoraires;
    if (h.mode === 'temps_passe' || h.mode === 'mixte') {
      if (h.tauxHoraireHt === null) tauxHoraireManquant = true;
      else tempsPasse = tempsPasse.plus(dec(h.tauxHoraireHt).times(t.minutes).div(60));
    }
  }

  let motifHonoraires: string | null = null;
  if (detail.length === 0) motifHonoraires = 'Aucune lettre de mission validée n’est applicable sur la période.';
  else if (forfaitNonRenseigne) motifHonoraires = 'Une lettre au forfait ne porte pas de montant annuel : les honoraires ne sont pas calculables.';
  else if (tauxHoraireManquant) motifHonoraires = 'Une lettre au temps passé ne porte pas de taux horaire : les honoraires ne sont pas calculables.';
  const total = motifHonoraires ? null : forfait.plus(tempsPasse);
  if (joursSansLettre > 0 && detail.length > 0) mentions.push(`${joursSansLettre} jour(s) de la période ne sont couverts par aucune lettre validée : aucun honoraire n’y est compté.`);
  if (temps.minutesHorsPerimetre > 0) mentions.push(`${temps.minutesHorsPerimetre} minute(s) observées sur des travaux potentiellement hors périmètre : non couvertes par les honoraires calculés.`);
  if (temps.minutesSansLettre > 0) mentions.push(`${temps.minutesSansLettre} minute(s) observées à des dates sans lettre applicable.`);
  if (temps.travauxSansTemps > 0) mentions.push(`${temps.travauxSansTemps} travail(aux) sans temps saisi : les ratios horaires sont partiels.`);

  const heures = new Decimal(temps.minutesDansPerimetre).div(60);
  const partiel = temps.travauxSansTemps > 0;
  let taux: RentabiliteMission['tauxHoraireRealise'];
  if (total === null) taux = { statut: 'non_calculable', valeur: null, motif: motifHonoraires };
  else if (heures.isZero()) taux = { statut: 'non_calculable', valeur: null, motif: 'Aucun temps observé dans le périmètre sur la période.' };
  else taux = { statut: partiel ? 'partiel' : 'calcule', valeur: versChaine(total.div(heures)), motif: partiel ? 'Des travaux n’ont pas de temps saisi : le temps réel est supérieur, le taux réel inférieur.' : null };

  const coutHoraire = entree.coutHoraire ?? null;
  let marge: RentabiliteMission['marge'];
  if (coutHoraire === null) marge = { statut: 'non_calculable', coutHoraire: null, cout: null, valeur: null, tauxPourcent: null, motif: 'Coût horaire interne du cabinet non renseigné : aucune marge n’est calculée.' };
  else if (total === null) marge = { statut: 'non_calculable', coutHoraire, cout: null, valeur: null, tauxPourcent: null, motif: motifHonoraires };
  else {
    // Le coût porte sur TOUT le temps observé pour la mission, y compris hors périmètre et sans lettre : c'est du temps passé.
    const minutesTotales = temps.minutesDansPerimetre + temps.minutesHorsPerimetre + temps.minutesSansLettre;
    const cout = dec(coutHoraire).times(minutesTotales).div(60);
    const valeur = total.minus(cout);
    marge = {
      statut: partiel ? 'partiel' : 'calcule',
      coutHoraire,
      cout: versChaine(cout),
      valeur: versChaine(valeur),
      tauxPourcent: total.isZero() ? null : versChaine(valeur.div(total).times(100)),
      motif: partiel ? 'Des travaux n’ont pas de temps saisi : le coût réel est supérieur, la marge réelle inférieure.' : null,
    };
  }

  return {
    periode,
    honoraires: { statut: total === null ? 'non_calculable' : 'calcule', motif: motifHonoraires, forfait: versChaine(forfait), tempsPasse: versChaine(tempsPasse), total: total === null ? null : versChaine(total), detail },
    temps,
    tauxHoraireRealise: taux,
    marge,
    mentions,
  };
}
