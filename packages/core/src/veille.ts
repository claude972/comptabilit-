/**
 * Veille réglementaire : applicabilité d'une évolution à un dossier, à partir de critères explicites.
 * Pur et déterministe. Le moteur n'interprète aucun texte : les critères sont saisis par la personne qui qualifie
 * l'évolution. Si une caractéristique du dossier manque, l'applicabilité est « à confirmer », jamais « non concerné ».
 */
import { z } from 'zod';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const montantPositif = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/);

/**
 * Opérations reconnaissables de façon déterministe à la présence de mouvements sur certaines racines de comptes du PCG.
 * C'est un INDICE tiré des comptes utilisés, pas une qualification juridique de l'opération : la raison affichée le dit.
 */
export const OPERATIONS_IDENTIFIABLES = ['immobilisations', 'emprunts', 'stocks', 'salaries', 'credit_bail', 'subventions', 'comptes_courants_associes', 'tva_collectee'] as const;
export type OperationIdentifiable = (typeof OPERATIONS_IDENTIFIABLES)[number];
export const RACINES_OPERATIONS: Record<OperationIdentifiable, { racines: string[]; libelle: string }> = {
  immobilisations: { racines: ['20', '21', '23'], libelle: 'immobilisations (comptes 20, 21, 23)' },
  emprunts: { racines: ['164', '168'], libelle: 'emprunts (comptes 164, 168)' },
  stocks: { racines: ['3'], libelle: 'stocks (classe 3)' },
  salaries: { racines: ['641'], libelle: 'rémunérations du personnel (compte 641)' },
  credit_bail: { racines: ['612'], libelle: 'redevances de crédit-bail (compte 612)' },
  subventions: { racines: ['74', '131'], libelle: 'subventions (comptes 74, 131)' },
  comptes_courants_associes: { racines: ['455'], libelle: 'comptes courants d’associés (compte 455)' },
  tva_collectee: { racines: ['4457'], libelle: 'TVA collectée (compte 4457)' },
};

/** Opérations identifiées à partir de la liste des comptes MOUVEMENTÉS d'un exercice. */
export function identifierOperations(comptesMouvementes: readonly string[]): OperationIdentifiable[] {
  return OPERATIONS_IDENTIFIABLES.filter((o) => RACINES_OPERATIONS[o].racines.some((r) => comptesMouvementes.some((c) => c.startsWith(r))));
}

/** Critères d'une évolution. Un critère absent ne restreint pas. */
export const schemaCriteresEvolution = z.object({
  territoires: z.array(z.string().min(1)).optional(),
  regimesFiscaux: z.array(z.string().min(1)).optional(),
  formesJuridiques: z.array(z.string().min(1)).optional(),
  /** Préfixes de codes NAF (ex. « 10.71 », « 47 »). */
  prefixesNaf: z.array(z.string().min(1)).optional(),
  referentiels: z.array(z.string().min(1)).optional(),
  /** Exercices ouverts à compter de cette date. */
  exercicesOuvertsAPartirDu: dateIso.optional(),
  /** Exercices clos à compter de cette date. */
  exercicesClosAPartirDu: dateIso.optional(),
  /**
   * Taille : bornes INCLUSES, en euros (chaînes décimales) pour le chiffre d'affaires et le total du bilan, en nombre
   * de salariés pour l'effectif. Appréciées sur le dernier exercice du dossier qui a des données comptables actives.
   */
  taille: z
    .object({
      chiffreAffairesMin: montantPositif.optional(),
      chiffreAffairesMax: montantPositif.optional(),
      totalBilanMin: montantPositif.optional(),
      totalBilanMax: montantPositif.optional(),
      effectifMin: z.number().int().min(0).optional(),
      effectifMax: z.number().int().min(0).optional(),
    })
    .optional(),
  /** Opérations identifiées dans la comptabilité du dossier : l'évolution vise les dossiers qui en ont AU MOINS UNE. */
  operations: z.array(z.enum(OPERATIONS_IDENTIFIABLES)).optional(),
});
export type CriteresEvolution = z.infer<typeof schemaCriteresEvolution>;

export interface ProfilDossier {
  territoireFiscal: string | null;
  regimeFiscal: string | null;
  formeJuridique: string | null;
  codeNaf: string | null;
  referentielComptable: string | null;
  exercices: ReadonlyArray<{ debut: string; fin: string }>;
  /**
   * Taille connue du dossier ; chaque valeur est `null` si elle n'est pas connue (pas de données comptables actives,
   * effectif non renseigné). Facultatif : absent = rien n'est connu.
   */
  taille?: { chiffreAffaires: string | null; totalBilan: string | null; effectif: number | null; exercice: { debut: string; fin: string } | null };
  /** Opérations identifiées dans la comptabilité ; `null` ou absent = aucune donnée comptable active pour en juger. */
  operations?: OperationIdentifiable[] | null;
}

export interface Applicabilite {
  statut: 'concerne' | 'a_confirmer' | 'non_concerne';
  /** Pourquoi le dossier paraît concerné, ne l'est pas, ou ce qui manque pour conclure. */
  raisons: string[];
  /** Caractéristiques du dossier à renseigner pour lever l'incertitude. */
  manquants: string[];
  exercicesConcernes: Array<{ debut: string; fin: string }>;
}

const norme = (v: string) => v.trim().toLowerCase();

/** Compare un dossier aux critères d'une évolution. « a_confirmer » dès qu'une caractéristique nécessaire manque. */
export function evaluerApplicabilite(profil: ProfilDossier, criteres: CriteresEvolution): Applicabilite {
  const raisons: string[] = [];
  const manquants: string[] = [];
  let exclu = false;

  const tester = (libelle: string, valeur: string | null, admis: string[] | undefined, compare: (v: string, a: string) => boolean, indetermine?: (v: string) => boolean) => {
    if (!admis?.length) return;
    if (valeur === null || valeur.trim() === '' || indetermine?.(valeur)) {
      manquants.push(libelle);
      raisons.push(`${libelle} du dossier non renseigné : l'évolution vise ${admis.join(', ')}.`);
      return;
    }
    if (admis.some((a) => compare(norme(valeur), norme(a)))) raisons.push(`${libelle} du dossier (${valeur}) visé par l'évolution.`);
    else {
      exclu = true;
      raisons.push(`${libelle} du dossier (${valeur}) non visé : l'évolution concerne ${admis.join(', ')}.`);
    }
  };
  const egal = (v: string, a: string) => v === a;
  tester('Territoire fiscal', profil.territoireFiscal, criteres.territoires, egal, (v) => norme(v) === 'a_confirmer');
  tester('Régime fiscal', profil.regimeFiscal, criteres.regimesFiscaux, egal);
  tester('Forme juridique', profil.formeJuridique, criteres.formesJuridiques, egal);
  tester('Code NAF', profil.codeNaf, criteres.prefixesNaf, (v, a) => v.replace(/\./g, '').startsWith(a.replace(/\./g, '')));
  tester('Référentiel comptable', profil.referentielComptable, criteres.referentiels, egal);

  let exercicesConcernes = [...profil.exercices];
  if (criteres.exercicesOuvertsAPartirDu || criteres.exercicesClosAPartirDu) {
    if (profil.exercices.length === 0) {
      manquants.push('Exercices');
      raisons.push('Aucun exercice ouvert dans le dossier : la période d’application ne peut pas être appréciée.');
    } else {
      exercicesConcernes = profil.exercices.filter(
        (e) => (!criteres.exercicesOuvertsAPartirDu || e.debut >= criteres.exercicesOuvertsAPartirDu) && (!criteres.exercicesClosAPartirDu || e.fin >= criteres.exercicesClosAPartirDu),
      );
      const borne = criteres.exercicesOuvertsAPartirDu ? `ouverts à compter du ${criteres.exercicesOuvertsAPartirDu}` : `clos à compter du ${criteres.exercicesClosAPartirDu}`;
      if (exercicesConcernes.length) raisons.push(`${exercicesConcernes.length} exercice(s) du dossier ${borne}.`);
      else {
        exclu = true;
        raisons.push(`Aucun exercice du dossier n'est ${borne.replace('ouverts', 'ouvert').replace('clos à', 'clos à')}.`);
      }
    }
  }

  // ── Taille : chaque borne se compare à une valeur connue ; valeur inconnue = « à confirmer », jamais « non concerné ».
  const t = criteres.taille;
  if (t) {
    const borne = (libelle: string, valeur: string | number | null | undefined, min: string | number | undefined, max: string | number | undefined, unite: string) => {
      if (min === undefined && max === undefined) return;
      const viser = `${min !== undefined ? `à partir de ${min}${unite}` : ''}${min !== undefined && max !== undefined ? ' et ' : ''}${max !== undefined ? `jusqu’à ${max}${unite}` : ''}`;
      if (valeur === null || valeur === undefined) {
        manquants.push(libelle);
        raisons.push(`${libelle} du dossier inconnu : l'évolution vise les dossiers ${viser}.`);
        return;
      }
      // Comparaison décimale exacte sur des chaînes « entier[.décimales] » : centimes entiers, aucun flottant.
      const centimes = (x: string | number): bigint => {
        const texte = String(x);
        const [entier = '0', decimales = ''] = texte.replace('-', '').split('.');
        const n = BigInt(entier) * 100n + BigInt(`${decimales}00`.slice(0, 2));
        return texte.startsWith('-') ? -n : n;
      };
      const v = centimes(valeur);
      const dedans = (min === undefined || v >= centimes(min)) && (max === undefined || v <= centimes(max));
      if (dedans) raisons.push(`${libelle} du dossier (${valeur}${unite}) dans la tranche visée (${viser}).`);
      else {
        exclu = true;
        raisons.push(`${libelle} du dossier (${valeur}${unite}) hors de la tranche visée (${viser}).`);
      }
    };
    const connue = profil.taille ?? null;
    borne('Chiffre d’affaires', connue?.chiffreAffaires, t.chiffreAffairesMin, t.chiffreAffairesMax, ' €');
    borne('Total du bilan', connue?.totalBilan, t.totalBilanMin, t.totalBilanMax, ' €');
    borne('Effectif', connue?.effectif, t.effectifMin, t.effectifMax, ' salarié(s)');
    if (connue?.exercice && (connue.chiffreAffaires !== null || connue.totalBilan !== null)) {
      raisons.push(`Chiffre d’affaires et total du bilan tirés des écritures importées de l’exercice du ${connue.exercice.debut} au ${connue.exercice.fin}, avant écritures d’inventaire : à confirmer sur les comptes arrêtés.`);
    }
  }

  // ── Opérations identifiées : indice tiré des comptes mouvementés.
  if (criteres.operations?.length) {
    const visees = criteres.operations.map((o) => RACINES_OPERATIONS[o].libelle).join(' ; ');
    if (profil.operations === null || profil.operations === undefined) {
      manquants.push('Données comptables');
      raisons.push(`Aucune donnée comptable active dans le dossier : impossible de savoir s'il a les opérations visées (${visees}).`);
    } else {
      const trouvees = criteres.operations.filter((o) => profil.operations!.includes(o));
      if (trouvees.length) raisons.push(`Opérations visées repérées dans les comptes mouvementés : ${trouvees.map((o) => RACINES_OPERATIONS[o].libelle).join(' ; ')}. Indice comptable, pas une qualification de l'opération.`);
      else {
        exclu = true;
        raisons.push(`Aucune des opérations visées (${visees}) n'apparaît dans les comptes mouvementés du dossier. Une opération enregistrée sur d'autres comptes ne serait pas repérée.`);
      }
    }
  }

  if (exclu) return { statut: 'non_concerne', raisons, manquants, exercicesConcernes: [] };
  if (manquants.length) return { statut: 'a_confirmer', raisons, manquants, exercicesConcernes };
  if (raisons.length === 0) raisons.push('Évolution sans critère restrictif : tous les dossiers sont potentiellement concernés.');
  return { statut: 'concerne', raisons, manquants, exercicesConcernes };
}

/** Texte comparable d'une page : balises, scripts et espaces retirés. Sert à détecter un changement, pas à l'interpréter. */
export function texteComparable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
