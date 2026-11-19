/**
 * Veille réglementaire : applicabilité d'une évolution à un dossier, à partir de critères explicites.
 * Pur et déterministe. Le moteur n'interprète aucun texte : les critères sont saisis par la personne qui qualifie
 * l'évolution. Si une caractéristique du dossier manque, l'applicabilité est « à confirmer », jamais « non concerné ».
 */
import { z } from 'zod';

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
});
export type CriteresEvolution = z.infer<typeof schemaCriteresEvolution>;

export interface ProfilDossier {
  territoireFiscal: string | null;
  regimeFiscal: string | null;
  formeJuridique: string | null;
  codeNaf: string | null;
  referentielComptable: string | null;
  exercices: ReadonlyArray<{ debut: string; fin: string }>;
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
