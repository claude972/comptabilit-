/**
 * ÉCHÉANCIER de conservation et de fin de contrat, tous cabinets (D-100) : pour chaque cabinet, où il en est dans le
 * cycle (actif, résilié en délai de grâce, exécutable, fin de contrat exécutée, destruction à terme en cours) et quelle est
 * la prochaine date qui compte. LECTURE SEULE, aucun effet : il s'emploie sans risque sur la base réelle.
 * Les dates dépendent des durées du jeu de paramètres : tant qu'il est « PROPOSITION NON VALIDÉE », elles n'ont aucune
 * valeur juridique (le résultat le porte).
 */
import type pg from 'pg';
import { type ParametresCharges, delaiEffectifSuppression, echeanceDe } from './durees-conservation.js';
import { CATEGORIES_A_TERME, CATEGORIE_JOURNAL, CATEGORIE_PROCES_VERBAL, planDestructionTerme } from './destruction-terme.js';
import { POLITIQUE_FIN_DE_CONTRAT, exigerAdministration } from './provisionnement.js';

export type PhaseCabinet = 'actif' | 'resilie_en_delai_de_grace' | 'fin_de_contrat_executable' | 'fin_de_contrat_executee' | 'destruction_terminee';
export interface LigneEcheancier {
  cabinetId: string;
  nom: string;
  phase: PhaseCabinet;
  abonnement: { statut: string; fin: string | null } | null;
  /** Date au plus tôt de l'exécution de la fin de contrat (fin de l'abonnement + délai effectif). */
  executionAuPlusTot: string | null;
  /** Fin de contrat exécutée : prochaine échéance parmi les éléments conservés, et ce qu'il reste. */
  elementsConserves: { lignes: number; prochaineEcheance: string | null; categoriesEchues: string[] } | null;
  /** Ce que l'éditeur a à faire maintenant, en une phrase. */
  aFaire: string;
}
export interface Echeancier {
  format: 'comtaple.echeancier-conservation/1';
  aujourdhui: string;
  parametres: { version: string; statut: string; nonValide: boolean };
  cabinets: LigneEcheancier[];
  avertissements: string[];
}

export async function echeancierConservation(client: pg.ClientBase, chargees: ParametresCharges, options: { aujourdhui?: string; cabinetId?: string } = {}): Promise<Echeancier> {
  await client.query('begin transaction read only');
  let cabinets: Array<{ id: string; nom: string; statut: string | null; fin: string | null; pv: boolean }>;
  let aujourdhui: string;
  try {
    await exigerAdministration(client);
    aujourdhui = options.aujourdhui ?? (await client.query<{ d: string }>('select current_date::text as d')).rows[0]!.d;
    cabinets = (
      await client.query<{ id: string; nom: string; statut: string | null; fin: string | null; pv: boolean }>(
        `select c.id, c.nom, a.statut, a.fin::text, exists (select 1 from fins_de_contrat f where f.cabinet_id = c.id) as pv
           from cabinets c left join abonnements a on a.cabinet_id = c.id ${options.cabinetId ? 'where c.id = $1' : ''} order by c.nom, c.id`,
        options.cabinetId ? [options.cabinetId] : [],
      )
    ).rows;
  } finally {
    await client.query('rollback');
  }
  const supprimees = POLITIQUE_FIN_DE_CONTRAT.categories.filter((c) => c.devenir === 'supprimer' || c.devenir === 'restituer_puis_supprimer').map((c) => c.code);
  const delai = delaiEffectifSuppression(chargees.parametres, supprimees);
  const lignes: LigneEcheancier[] = [];
  for (const c of cabinets) {
    const ab = c.statut ? { statut: c.statut, fin: c.fin } : null;
    const exec = ab?.statut === 'resilie' && ab.fin ? echeanceDe({ duree: { jours: delai }, pointDeDepart: 'fin_de_contrat', apresEcheance: 'supprimer' }, ab.fin) : null;
    if (!c.pv) {
      const phase: PhaseCabinet = ab?.statut !== 'resilie' ? 'actif' : exec && exec <= aujourdhui ? 'fin_de_contrat_executable' : 'resilie_en_delai_de_grace';
      lignes.push({
        cabinetId: c.id, nom: c.nom, phase, abonnement: ab, executionAuPlusTot: exec, elementsConserves: null,
        aFaire: phase === 'actif' ? 'Rien : l’abonnement n’est pas résilié.' : phase === 'resilie_en_delai_de_grace' ? `Attendre le ${exec ?? 'date inconnue'} (fin de l’abonnement + ${delai} jour(s)).` : 'Exécutable après les pré-conditions : restitution du cabinet complète et postérieure à la dernière modification, journal intègre, référence de validation des durées, confirmation.',
      });
      continue;
    }
    const plan = await planDestructionTerme(client, c.id, chargees, { aujourdhui });
    const conserves = plan.categories.filter((k) => [...CATEGORIES_A_TERME, CATEGORIE_JOURNAL, CATEGORIE_PROCES_VERBAL].includes(k.code as never) && k.etat !== 'vide');
    const reste = conserves.reduce((s, k) => s + k.tables.reduce((n, t) => n + t.total, 0), 0);
    const echues = conserves.filter((k) => k.etat === 'echue' || k.etat === 'partielle').map((k) => k.code);
    lignes.push({
      cabinetId: c.id, nom: c.nom, phase: reste === 0 ? 'destruction_terminee' : 'fin_de_contrat_executee', abonnement: ab, executionAuPlusTot: exec,
      elementsConserves: { lignes: reste, prochaineEcheance: plan.prochaineEcheance, categoriesEchues: echues },
      aFaire: reste === 0 ? 'Rien : tout ce qui devait être conservé a été détruit.' : echues.length ? `À détruire maintenant : ${echues.join(', ')}.` : `Attendre le ${plan.prochaineEcheance ?? 'date inconnue'}.`,
    });
  }
  const avertissements = chargees.nonValide ? ['Durées : PROPOSITION NON VALIDÉE. Ces échéances n’ont aucune valeur juridique.'] : [];
  return { format: 'comtaple.echeancier-conservation/1', aujourdhui, parametres: { version: chargees.parametres.version, statut: chargees.parametres.statut, nonValide: chargees.nonValide }, cabinets: lignes, avertissements };
}
