/**
 * Tableau 2033-F-SD « Composition du capital social » (D-116), régime simplifié.
 *
 * Servi par SAISIE LIGNE PAR LIGNE (associés personnes morales : 4 lignes ; personnes physiques : 2 lignes ; effectifs d'associés et de parts :
 * cases 901 à 904), justifiée, tracée, historisée, avec NÉANT explicite et abstention sans saisie (mêmes garanties que D-112 à D-115). Aucune
 * information du tableau ne se déduit de la balance : le registre des associés est tenu par la société.
 *
 * Seul le calcul que le formulaire énonce est fait : case 905 « total des lignes 901 + 903 » (nombre d'associés) et case 906 « total des
 * lignes 902 + 904 » (nombre de parts ou d'actions), quand 901 à 904 sont saisies (néant compris). Contrôles INDICATIFS, jamais bloquants ni
 * corrigés : somme des pourcentages de détention listés au plus égale à 100 ; nombre de lignes saisies au plus égal à 901 (resp. 903) ; somme
 * des parts listées au plus égale à 902 (resp. 904).
 *
 * Données personnelles : les lignes de personnes physiques portent identité, date et lieu de naissance, adresse ; elles restent dans les
 * tables protégées du cabinet (isolation par cabinet, catégorie de conservation « décisions et validations ») et dans l'historique en ajout seul.
 *
 * Cases 901 à 906 lues sur `2033-sd_5394.pdf` (SHA-256 ce4c5190…b6cb), page 6, par extraction positionnée puis vérifiées sur le rendu image (2026-11-22).
 */
import { Decimal } from 'decimal.js';
import { type ChaineDecimale, versChaine } from '../montant.js';
import type { ControleDetail, EtatCodeCase } from './detail-resultat.js';
import { CAPACITES_LIGNES, lignesNumerotees, type SaisieTableau, type TraceSaisie } from './saisies-tableaux.js';
import { MENTION_PROJET } from './sources-fiscales.js';

const ZERO = new Decimal(0);
export type StatutLigne = 'a_saisir' | 'saisi' | 'a_revoir';

export interface LigneAssocie {
  ligne: string;
  statut: StatutLigne;
  trace: TraceSaisie | null;
  valeurs: Record<string, string> | null;
}

export interface CaseNombre {
  code: string;
  libelle: string;
  etatCodeCase: EtatCodeCase;
  statut: StatutLigne;
  montant: ChaineDecimale | null;
  neant: boolean;
}

export type CelluleCalculee = { statut: 'etabli'; montant: ChaineDecimale; codeCase: string; etatCodeCase: EtatCodeCase; calcul: string } | { statut: 'abstention'; motifs: string[]; codeCase: string; etatCodeCase: EtatCodeCase };

export interface Formulaire2033FProjet {
  statut: 'projet';
  etat: 'a_saisir' | 'neant' | 'saisi';
  nombres: { cases: CaseNombre[]; trace: TraceSaisie | null; statut: StatutLigne; total905: CelluleCalculee; total906: CelluleCalculee };
  personnesMorales: LigneAssocie[];
  personnesPhysiques: LigneAssocie[];
  neant: TraceSaisie | null;
  controles: ControleDetail[];
  nonPrepare: string[];
  limites: string[];
  mention: string;
}

export interface DemandeFormulaire2033F {
  versionDonnees: number;
  saisiesTableaux: readonly SaisieTableau[];
}

export const LIBELLES_NOMBRES: ReadonlyArray<{ code: 'c901' | 'c902' | 'c903' | 'c904'; case: string; libelle: string }> = [
  { code: 'c901', case: '901', libelle: 'Personnes morales : nombre total d’associés ou actionnaires' },
  { code: 'c902', case: '902', libelle: 'Personnes morales : nombre total de parts ou d’actions correspondantes' },
  { code: 'c903', case: '903', libelle: 'Personnes physiques : nombre total d’associés ou actionnaires' },
  { code: 'c904', case: '904', libelle: 'Personnes physiques : nombre total de parts ou d’actions correspondantes' },
];

const trace = (s: SaisieTableau): TraceSaisie => ({ note: s.note, qualifieePar: s.qualifieePar, le: s.le, versionDonnees: s.versionDonnees });
const statutDe = (s: SaisieTableau | undefined, v: number): StatutLigne => (s === undefined ? 'a_saisir' : s.versionDonnees !== v ? 'a_revoir' : 'saisi');
const etabli = (m: Decimal, codeCase: string, calcul: string): CelluleCalculee => ({ statut: 'etabli', montant: versChaine(m), codeCase, etatCodeCase: 'lu_verifie', calcul });
const abstention = (motifs: string[], codeCase: string): CelluleCalculee => ({ statut: 'abstention', motifs, codeCase, etatCodeCase: 'lu_verifie' });

export function preparerFormulaire2033F(demande: DemandeFormulaire2033F): Formulaire2033FProjet {
  const v = demande.versionDonnees;
  const nb = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2033F_NB').map((s) => [s.ligne, s]));
  const pmM = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2033F_PM').map((s) => [s.ligne, s]));
  const ppM = new Map(demande.saisiesTableaux.filter((s) => s.tableau === '2033F_PP').map((s) => [s.ligne, s]));
  const ligne = (m: Map<string, SaisieTableau>, l: string): LigneAssocie => {
    const s = m.get(l);
    const statut = statutDe(s, v);
    return { ligne: l, statut, trace: s ? trace(s) : null, valeurs: statut === 'saisi' ? s!.valeurs : null };
  };
  const personnesMorales = lignesNumerotees(CAPACITES_LIGNES.associesPM.max).map((l) => ligne(pmM, l));
  const personnesPhysiques = lignesNumerotees(CAPACITES_LIGNES.associesPP.max).map((l) => ligne(ppM, l));
  const sNb = nb.get('NB');
  const statutNb = statutDe(sNb, v);
  const cases: CaseNombre[] = LIBELLES_NOMBRES.map((x) => {
    const m = statutNb === 'saisi' ? sNb!.valeurs[x.code] ?? null : null;
    return { code: x.case, libelle: x.libelle, etatCodeCase: 'lu_verifie', statut: statutNb, montant: m, neant: m !== null && new Decimal(m).isZero() };
  });
  const neantS = nb.get('NEANT');
  const neantStatut = statutDe(neantS, v);
  const lignesSaisies = [...personnesMorales, ...personnesPhysiques].filter((l) => l.statut === 'saisi').length;
  const etat: Formulaire2033FProjet['etat'] = lignesSaisies > 0 || statutNb === 'saisi' ? 'saisi' : neantStatut === 'saisi' ? 'neant' : 'a_saisir';
  const controles: ControleDetail[] = [];
  const val = (code: string): Decimal | null => {
    const c = cases.find((k) => k.code === code)!;
    return c.montant === null ? null : new Decimal(c.montant);
  };
  const motifsNb = statutNb === 'saisi' ? [] : [statutNb === 'a_revoir' ? 'Les nombres d’associés et de parts (901 à 904) ont été saisis sur une autre version des données (« à revoir »).' : 'Nombres d’associés et de parts (901 à 904) sans saisie : saisir les montants ou déclarer le tableau « néant » ; rien n’est présumé nul.'];
  const total905 = neantStatut === 'saisi' && statutNb !== 'saisi' ? etabli(ZERO, '905', 'Tableau déclaré « néant »') : motifsNb.length > 0 ? abstention(motifsNb, '905') : etabli(val('901')!.plus(val('903')!), '905', 'Total des lignes 901 + 903 (formulaire)');
  const total906 = neantStatut === 'saisi' && statutNb !== 'saisi' ? etabli(ZERO, '906', 'Tableau déclaré « néant »') : motifsNb.length > 0 ? abstention(motifsNb, '906') : etabli(val('902')!.plus(val('904')!), '906', 'Total des lignes 902 + 904 (formulaire)');
  if (neantStatut === 'saisi' && (lignesSaisies > 0 || statutNb === 'saisi')) controles.push({ code: 'F_NEANT_ET_LIGNES', statut: 'ecart', message: 'Le tableau est déclaré « néant » ET porte des saisies : retirer l’une des deux ; les saisies sont retenues.' });
  const retenues = (l: LigneAssocie[]) => l.filter((x) => x.statut === 'saisi');
  const somme = (l: LigneAssocie[], k: string) => retenues(l).reduce((a, x) => a.plus(x.valeurs![k] ?? '0'), ZERO);
  const pct = somme(personnesMorales, 'pourcentage').plus(somme(personnesPhysiques, 'pourcentage'));
  if (lignesSaisies > 0) {
    controles.push(pct.greaterThan(100)
      ? { code: 'F_POURCENTAGES', statut: 'ecart', message: `La somme des pourcentages de détention listés (${versChaine(pct)}) dépasse 100. Contrôle indicatif.`, ecart: versChaine(pct.minus(100)) }
      : { code: 'F_POURCENTAGES', statut: 'coherent', message: `Somme des pourcentages de détention listés : ${versChaine(pct)} (au plus 100). Contrôle indicatif ; les associés au-delà des lignes du formulaire figurent sur des tableaux supplémentaires.` });
  }
  const compare = (code: string, nombre: Decimal, libelle: string, codeNombre: string) => {
    const n = val(codeNombre);
    if (n !== null && nombre.greaterThan(n)) controles.push({ code: `F_${code}`, statut: 'ecart', message: `${libelle} listés (${versChaine(nombre)}) supérieurs à la case ${codeNombre} (${versChaine(n)}). Contrôle indicatif.`, ecart: versChaine(nombre.minus(n)) });
  };
  compare('PM_ASSOCIES', new Decimal(retenues(personnesMorales).length), 'Associés personnes morales', '901');
  compare('PM_PARTS', somme(personnesMorales, 'parts'), 'Parts ou actions de personnes morales', '902');
  compare('PP_ASSOCIES', new Decimal(retenues(personnesPhysiques).length), 'Associés personnes physiques', '903');
  compare('PP_PARTS', somme(personnesPhysiques, 'parts'), 'Parts ou actions de personnes physiques', '904');
  controles.push({ code: 'F_SANS_SAISIE', statut: 'non_verifie', message: `${6 - lignesSaisies} ligne(s) d’associé sur 6 sans saisie retenue : aucune n’est présumée vide ; les nombres 901 à 904 sont à saisir ou à déclarer.` });
  return {
    statut: 'projet',
    etat,
    nombres: { cases, trace: sNb ? trace(sNb) : null, statut: statutNb, total905, total906 },
    personnesMorales,
    personnesPhysiques,
    neant: neantS ? trace(neantS) : null,
    controles,
    nonPrepare: [
      'Identification de l’entreprise (SIREN, dénomination, adresse), numéro de dépôt et exercice : repris du dossier, non ressaisis ici.',
      'L’état joint papier (tableau supplémentaire exigé au-delà de 4 personnes morales et 2 personnes physiques, formulaire renvoi 1) : non produit ; les lignes 5 à 20 (personnes morales) et 3 à 20 (personnes physiques) sont saisies comme lignes d’état joint.',
      'Le registre des associés est tenu par la société : aucune donnée n’est tirée de la balance.',
    ],
    limites: [
      'Chaque ligne est une saisie justifiée du cabinet ; « néant » est une déclaration explicite du tableau ; une ligne non saisie n’est jamais présumée vide.',
      'Les cases 905 et 906 sont calculées comme le formulaire l’énonce, uniquement quand 901 à 904 sont saisies. Tous les autres rapprochements sont indicatifs.',
      'Statut « projet » : aucune transmission, aucune validation professionnelle.',
    ],
    mention: MENTION_PROJET,
  };
}
