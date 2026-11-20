/**
 * Rapports de conservation LISIBLES PAR UNE PERSONNE (D-100) : le même contenu que les simulations (JSON), en phrases
 * françaises, pour une revue par l'éditeur, le DPO ou l'avocat avant toute validation des durées. Fonctions PURES (aucune
 * base, aucun fichier) : elles ne décident rien et ne peuvent rien exécuter.
 */
import type { PlanDestructionTerme } from './destruction-terme.js';
import type { Echeancier, PhaseCabinet } from './echeancier-conservation.js';
import type { SimulationConservation, SimulationFinDeVieJournal } from './simulation-conservation.js';

const date = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'non calculable');
const pluriel = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const titre = (t: string) => `${t}\n${'='.repeat(t.length)}`;
const BANDEAU = (nonValide: boolean) => (nonValide ? ['ATTENTION : durées de conservation = PROPOSITION NON VALIDÉE. Aucune de ces dates n’a de valeur juridique ;', 'aucune exécution réelle n’est possible sans la référence de validation des durées.', ''] : []);

const PHASES: Record<PhaseCabinet, string> = {
  actif: 'abonnement actif ou en essai',
  resilie_en_delai_de_grace: 'résilié, en délai de grâce',
  fin_de_contrat_executable: 'résilié, fin de contrat exécutable',
  fin_de_contrat_executee: 'fin de contrat exécutée, éléments conservés en cours',
  destruction_terminee: 'cycle terminé, plus rien n’est conservé',
};

/** Ce qui arrive au cabinet, table par table, du plus sûr (« tout est supprimé à l'exécution ») au plus long (« conservé jusqu'à… »). */
export function rendreSimulationLisible(s: SimulationConservation): string {
  const o: string[] = [titre(`Conservation et fin de contrat — ${s.cabinet.nom}`), ...BANDEAU(s.parametres.nonValide)];
  o.push(`Situation au ${date(s.aujourdhui)} : ${s.abonnement ? `abonnement « ${s.abonnement.statut} »${s.abonnement.fin ? `, fin ${date(s.abonnement.fin)}` : ''}` : 'aucun abonnement'}.`);
  o.push(s.executionAuPlusTot ? `La fin de contrat pourra être exécutée à partir du ${date(s.executionAuPlusTot)} (délai de ${pluriel(s.delaiExecutionJours, 'jour')} après la fin de l’abonnement), si toutes les pré-conditions sont réunies.` : 'Aucune date d’exécution : la résiliation n’est pas constatée.', '');
  const parCat = new Map<string, typeof s.lignes>();
  for (const l of s.lignes) parCat.set(l.categorie, [...(parCat.get(l.categorie) ?? []), l]);
  const aSupprimer = s.lignes.filter((l) => /^SUPPRIMER|restituer/.test(l.action) && l.lignes > 0);
  const conservees = s.lignes.filter((l) => !/^SUPPRIMER|restituer/.test(l.action) && l.lignes > 0);
  o.push(titre('À l’exécution de la fin de contrat : tout est supprimé, après restitution'));
  o.push(aSupprimer.length ? aSupprimer.map((l) => `- ${l.table} : ${pluriel(l.lignes, 'ligne')} — ${l.action}`).join('\n') : '(rien)', '');
  o.push(titre('Éléments conservés au-delà, puis détruits ou scellés à leur terme'));
  o.push(conservees.length ? conservees.map((l) => `- ${l.table} : ${pluriel(l.lignes, 'ligne')} — ${l.action}. Point de départ : ${l.pointDeDepart}. ${l.premiereEcheance ? `Échéance du ${date(l.premiereEcheance)}${l.derniereEcheance && l.derniereEcheance !== l.premiereEcheance ? ` au ${date(l.derniereEcheance)}` : ''} (${l.etat === 'echue' ? 'échue' : l.etat === 'a_echoir' ? 'à venir' : 'non calculable'}).` : 'Échéance non calculable.'}`).join('\n') : '(rien)', '');
  if (s.avertissements.length) o.push(titre('Avertissements'), ...s.avertissements.map((a) => `- ${a}`), '');
  o.push('Cette simulation ne modifie aucune donnée.');
  return `${o.join('\n')}\n`;
}

export function rendreFinDeVieJournalLisible(s: SimulationFinDeVieJournal): string {
  const o: string[] = [titre('Fin de vie du journal d’audit'), ''];
  o.push(`Le journal compte ${pluriel(s.journal.lignes, 'ligne')} (du ${date(s.journal.premiere)} au ${date(s.journal.derniere)}). ${s.journal.echeancesPassees ? `${pluriel(s.journal.echeancesPassees, 'ligne')} ont atteint leur échéance.` : 'Aucune ligne n’a encore atteint son échéance.'}`);
  o.push(`Première échéance : ${date(s.journal.premiereEcheance)} ; dernière : ${date(s.journal.derniereEcheance)}.`);
  o.push(s.etat.verificationStricte === null ? 'La chaîne d’empreintes se vérifie : le journal est intègre.' : `ANOMALIE : la chaîne se rompt à la ligne ${s.etat.verificationStricte}.`);
  if (s.donneesPersonnellesDansLeJournal.lignesAvecCourriel) o.push(`${pluriel(s.donneesPersonnellesDansLeJournal.lignesAvecCourriel, 'ligne')} contiennent une adresse de courriel (${s.donneesPersonnellesDansLeJournal.actions.map((a) => a.action).join(', ')}) : le journal ne se réécrit pas, ces lignes ne disparaîtront qu’à la destruction du journal entier.`);
  o.push('', 'Ce qui se passerait, dans l’ordre :', ...s.plan.map((p) => `  ${p}`), '', s.ancre);
  if (s.avertissements.length) o.push('', ...s.avertissements.map((a) => `- ${a}`));
  return `${o.join('\n')}\n`;
}

export function rendrePlanDestructionLisible(p: PlanDestructionTerme): string {
  const o: string[] = [titre(`Destruction à terme des éléments conservés — ${p.cabinet.nom}`), ...BANDEAU(p.parametres.nonValide)];
  o.push(`Situation au ${date(p.aujourdhui)}. ${p.finDeContratExecutee ? `Fin de contrat exécutée ; les durées courent depuis le ${date(p.pointDeDepart)}.` : 'La fin de contrat n’est PAS exécutée : rien ne peut être détruit.'}`, '');
  const ETAT = { vide: 'rien n’est conservé', a_echoir: 'rien n’est encore échu', partielle: 'échu en partie', echue: 'tout est échu' } as const;
  const PROC = { destruction_a_terme: 'destruction à terme', journal_scelle_puis_decision_humaine: 'scellement du journal puis décision humaine', cloture_du_cabinet: 'clôture du cabinet (dernière étape, avec certificat)' } as const;
  for (const c of p.categories) {
    o.push(`• ${c.libelle} — ${ETAT[c.etat]} (${PROC[c.procedure]})`);
    for (const t of c.tables.filter((x) => x.total > 0)) o.push(`    ${t.table} : ${pluriel(t.total, 'ligne')}, dont ${t.echues} échue(s)${t.prochaineEcheance ? `, prochaine échéance le ${date(t.prochaineEcheance)}` : ''}`);
  }
  o.push('', p.termine ? 'Plus rien n’est conservé pour ce cabinet.' : p.prochaineEcheance ? `Prochaine échéance : ${date(p.prochaineEcheance)}.` : 'Tout ce qui reste est échu.');
  if (p.avertissements.length) o.push('', ...p.avertissements.map((a) => `- ${a}`));
  return `${o.join('\n')}\n`;
}

export function rendreEcheancierLisible(e: Echeancier): string {
  const o: string[] = [titre(`Échéancier de conservation au ${date(e.aujourdhui)}`), ...BANDEAU(e.parametres.nonValide)];
  if (!e.cabinets.length) o.push('Aucun cabinet.');
  for (const c of e.cabinets) {
    o.push(`• ${c.nom} — ${PHASES[c.phase]}`);
    if (c.abonnement) o.push(`    abonnement « ${c.abonnement.statut} »${c.abonnement.fin ? `, fin ${date(c.abonnement.fin)}` : ''}${c.executionAuPlusTot ? `, exécution au plus tôt ${date(c.executionAuPlusTot)}` : ''}`);
    if (c.elementsConserves) o.push(`    éléments conservés : ${pluriel(c.elementsConserves.lignes, 'ligne')}${c.elementsConserves.prochaineEcheance ? `, prochaine échéance ${date(c.elementsConserves.prochaineEcheance)}` : ''}`);
    o.push(`    à faire : ${c.aFaire}`);
  }
  return `${o.join('\n')}\n`;
}
