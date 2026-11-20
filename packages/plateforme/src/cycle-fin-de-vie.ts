/**
 * CYCLE COMPLET de fin de contrat et de conservation d'un cabinet, avec ÉTAT PERSISTANT et REPRISE (D-100).
 *
 * Les opérations existent séparément (fin de contrat en base, objets, comptes, fiches, rotation des sauvegardes,
 * destruction à terme, journal, clôture). Ce module les ENCHAÎNE dans l'ordre imposé par leurs dépendances, et tient un
 * fichier d'état qui permet de reprendre après une interruption ou d'attendre une échéance :
 *
 *   comptes_plan → base → objets → identite → fiches → sauvegardes → elements_conserves → scellement_journal
 *   → destruction_journal → cloture
 *
 * `avancerCycle` fait avancer le cycle aussi loin que possible À LA DATE DONNÉE, puis s'arrête à la première étape qui
 * attend (échéance non atteinte, verrou d'objet non échu, décision humaine absente) ou qui échoue. Rappelé plus tard
 * (« aujourd'hui » plus avancé), il reprend là où il s'est arrêté. Chaque étape est idempotente : une étape restée
 * « en cours » (arrêt brutal) est simplement rejouée.
 *
 * DÉSACTIVÉ PAR CONSTRUCTION : les étapes destructrices (objets, comptes, fiches, rotation, destruction à terme, journal,
 * clôture) refusent toute ressource qui n'est pas déclarée d'ESSAI (base `comtaple_essai_…`, bucket `comtaple-essai-…`,
 * royaume `essai-fin-contrat-…`, répertoire marqué), exigent la référence de validation des durées et la confirmation du
 * cabinet. Aucun lanceur de ce cycle n'est exposé dans l'outil de l'éditeur : il n'existe que pour les essais.
 * Le plan des comptes est établi AVANT la fin de contrat et conservé dans l'état (les appartenances disparaissent ensuite).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appliquerFichesOrphelinesEssai, planComptesFinDeContrat } from '@comtaple/db/comptes-fin-de-contrat';
import { CATEGORIES_A_TERME, type CertificatDestruction, cloturerCabinetEssai, detruireElementsConservesEssai, ecrireAtomique, planDestructionTerme } from '@comtaple/db/destruction-terme';
import type { ParametresCharges } from '@comtaple/db/durees-conservation';
import { type DecisionHumaine, ScellementPerime, detruireJournalEssai, scellerJournal } from '@comtaple/db/journal-fin-de-vie';
import { type StockageEssaiVersionne, SuppressionObjetsIncomplete, supprimerObjetsFinDeContratEssai } from '@comtaple/db/objets-fin-de-contrat';
import { RefusFinDeContrat, finDeContrat, lireProcesVerbalFinDeContrat } from '@comtaple/db/provisionnement';

/** Connexion PostgreSQL d'administration (type de `pg.ClientBase`, repris des fonctions de @comtaple/db). */
type ClientBd = Parameters<typeof finDeContrat>[0];
import type { CompteAFermer, LigneCompteIdentite } from './fournisseur-identite-essai.js';
import { appliquerNettoyageObjets, appliquerRotation, jeuxContenantCabinet } from './rotation-sauvegardes.js';

export const FORMAT_CYCLE = 'comtaple.cycle-fin-de-vie/1';
export const ETAPES_CYCLE = ['comptes_plan', 'base', 'objets', 'identite', 'fiches', 'sauvegardes', 'elements_conserves', 'scellement_journal', 'destruction_journal', 'cloture'] as const;
export type NomEtape = (typeof ETAPES_CYCLE)[number];
export type StatutEtape = 'a_faire' | 'en_cours' | 'fait' | 'attente' | 'echec';

export interface EtatEtape {
  statut: StatutEtape;
  tentatives: number;
  maj: string | null;
  /** Ce que l'étape a produit (décomptes, empreintes) : jamais de secret. */
  resume: Record<string, unknown> | null;
  /** Statut « attente » : date (AAAA-MM-JJ) à partir de laquelle il vaut la peine de rappeler, si on la connaît. */
  prochaine: string | null;
  /** Statut « attente » ou « echec » : pourquoi, en une phrase. */
  raison: string | null;
}
export interface EtatCycle {
  format: typeof FORMAT_CYCLE;
  cabinetId: string;
  nomCabinet: string;
  creeLe: string;
  /** Plan établi une seule fois, avant la fin de contrat : comptes à fermer et fiches à traiter. */
  plan: { comptes: CompteAFermer[]; utilisateurs: string[] } | null;
  /** Instant à partir duquel un jeu de sauvegarde ne contient plus rien du cabinet (fin de contrat, objets, comptes : le plus tardif). */
  pivotSauvegardes: string | null;
  scellement: string | null;
  journalDetruit: CertificatDestruction['journal'];
  etapes: Record<NomEtape, EtatEtape>;
}

/** Arrêt brutal simulé (processus tué) : jamais attrapé par le cycle, l'état reste tel qu'il était (« en cours »). */
export class ArretBrutal extends Error {
  constructor(message = 'arrêt brutal simulé') {
    super(message);
    this.name = 'ArretBrutal';
  }
}

export interface PortsCycle {
  /** Stockage objet d'ESSAI versionné (voir `StockageEssaiS3`). Absent : l'étape « objets » attend. */
  objets?: StockageEssaiVersionne;
  /** Fournisseur d'identité d'ESSAI (voir `FournisseurIdentiteEssai`). Absent : l'étape « identite » attend. */
  identite?: { appliquerPlan(comptes: readonly CompteAFermer[], options: { appliquer: boolean; aujourdhui: string }): Promise<LigneCompteIdentite[]> };
  /** Répertoire de sauvegardes d'ESSAI (marqueur posé) et répertoire réel dont il doit être distinct. Absent : l'étape « sauvegardes » attend. */
  sauvegardes?: { repertoire: string; repertoireReel: string };
}
export interface OptionsCycle {
  cabinetId: string;
  confirmation: { cabinetId: string; nom: string };
  parametres: ParametresCharges;
  dureesValidees: string;
  /** Date du jour (AAAA-MM-JJ), fixable : c'est ainsi que le temps est avancé dans les essais. */
  aujourdhui: string;
  /** Instant correspondant, pour la rotation des sauvegardes (par défaut : aujourd'hui à midi UTC). */
  maintenant?: Date;
  /** Dossier de l'état, des rapports, du scellement du journal et du certificat. */
  repertoire: string;
  /** Décision humaine documentée pour la destruction du journal ; sans elle l'étape attend. */
  decision?: DecisionHumaine;
  ports: PortsCycle;
  env?: NodeJS.ProcessEnv;
  /** Appelés avant et après chaque étape ; une exception ici interrompt le passage (essais de reprise). */
  avantEtape?: (e: NomEtape) => void | Promise<void>;
  apresEtape?: (e: NomEtape) => void | Promise<void>;
}
export interface ResultatCycle {
  etat: EtatCycle;
  /** Première étape qui n'est pas « fait » à la fin du passage, avec son statut ; null si le cycle est terminé. */
  arret: { etape: NomEtape; statut: StatutEtape; raison: string | null; prochaine: string | null } | null;
  termine: boolean;
  /** Étapes menées à terme pendant CE passage. */
  faites: NomEtape[];
  fichierEtat: string;
  fichierCertificat: string;
}

const vide = (): EtatEtape => ({ statut: 'a_faire', tentatives: 0, maj: null, resume: null, prochaine: null, raison: null });
export const cheminsCycle = (repertoire: string, cabinetId: string) => ({
  etat: join(repertoire, `cycle-${cabinetId}.json`),
  certificat: join(repertoire, `certificat-destruction-${cabinetId}.json`),
  rapportObjets: join(repertoire, `objets-${cabinetId}.jsonl`),
  rapportDestruction: join(repertoire, `destruction-${cabinetId}.jsonl`),
  scellements: join(repertoire, 'scellements'),
});

export function lireEtatCycle(repertoire: string, cabinetId: string): EtatCycle | null {
  const f = cheminsCycle(repertoire, cabinetId).etat;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as EtatCycle) : null;
}
const enregistrer = (repertoire: string, e: EtatCycle) => ecrireAtomique(cheminsCycle(repertoire, e.cabinetId).etat, `${JSON.stringify(e, null, 2)}\n`);
const dateIso = (d: string) => new Date(`${d}T12:00:00Z`);
const minDate = (...d: Array<string | null | undefined>) => d.filter((x): x is string => !!x).sort()[0] ?? null;
const maintenantIso = (precedent: string | null) => new Date(Math.max(Date.now(), precedent ? Date.parse(precedent) : 0)).toISOString();

/** Résultat d'une étape : terminée, ou en attente (avec date si connue). Une exception = échec. */
type Issue = { fait: Record<string, unknown> } | { attente: { raison: string; prochaine?: string | null; resume?: Record<string, unknown> } };

/**
 * Fait avancer le cycle d'un cabinet à la date `aujourdhui`, aussi loin que possible. Voir l'en-tête du fichier.
 * Retourne l'état et l'étape d'arrêt ; ne lève que pour un arrêt brutal (`ArretBrutal`) ou une erreur de garde (cabinet
 * introuvable, confirmation inexacte) qui s'applique à tout le cycle et ne peut pas être consignée comme une étape.
 */
export async function avancerCycle(client: ClientBd, o: OptionsCycle): Promise<ResultatCycle> {
  const chemins = cheminsCycle(o.repertoire, o.cabinetId);
  mkdirSync(o.repertoire, { recursive: true });
  let etat = lireEtatCycle(o.repertoire, o.cabinetId);
  if (!etat) {
    const cab = (await client.query<{ nom: string }>('select nom from cabinets where id = $1', [o.cabinetId])).rows[0];
    if (!cab) throw new Error(`Cabinet introuvable : ${o.cabinetId}`);
    etat = { format: FORMAT_CYCLE, cabinetId: o.cabinetId, nomCabinet: cab.nom, creeLe: new Date().toISOString(), plan: null, pivotSauvegardes: null, scellement: null, journalDetruit: null, etapes: Object.fromEntries(ETAPES_CYCLE.map((n) => [n, vide()])) as Record<NomEtape, EtatEtape> };
    enregistrer(o.repertoire, etat);
  }
  if (o.confirmation.cabinetId !== o.cabinetId || o.confirmation.nom !== etat.nomCabinet) throw new Error('Cycle refusé : la confirmation ne nomme pas exactement le cabinet (identifiant et nom).');
  const e = etat;
  const garde = { cabinetId: o.cabinetId, confirmation: o.confirmation, parametres: o.parametres, dureesValidees: o.dureesValidees, env: o.env };
  const faites: NomEtape[] = [];
  const maintenant = o.maintenant ?? dateIso(o.aujourdhui);
  const retour = (arret: ResultatCycle['arret']): ResultatCycle => ({ etat: e, arret, termine: arret === null, faites, fichierEtat: chemins.etat, fichierCertificat: chemins.certificat });

  const etapes: Record<NomEtape, () => Promise<Issue>> = {
    // 1. Plan des comptes, AVANT la fin de contrat : après elle, les appartenances n'existent plus.
    comptes_plan: async () => {
      if (!e.plan) {
        const plan = await planComptesFinDeContrat(client, o.cabinetId, o.parametres);
        e.plan = { comptes: plan.comptes.map((c) => ({ sujetOidc: c.sujetOidc, email: c.email, desactiverLe: c.desactiverLe, supprimerLe: c.supprimerLe })), utilisateurs: plan.comptes.map((c) => c.utilisateurId) };
      }
      return { fait: { comptes: e.plan.comptes.length } };
    },
    // 2. Fin de contrat en base (une transaction, tout ou rien) ; attente si le délai de grâce court encore.
    base: async () => {
      const pv = await lireProcesVerbalFinDeContrat(client, o.cabinetId);
      if (pv) return { fait: { deja: true, empreinteProcesVerbal: pv.empreinte, executeLe: pv.executeLe } };
      const sim = await finDeContrat(client, { cabinetId: o.cabinetId, confirmation: o.confirmation, parametres: o.parametres, dureesValidees: o.dureesValidees });
      const manquantes = sim.plan.preconditions.filter((p) => !p.satisfaite);
      if (manquantes.length === 1 && manquantes[0]!.code === 'abonnement_resilie') {
        const ab = (await client.query<{ statut: string; d: string | null }>('select statut, (fin + $2::int)::text as d from abonnements where cabinet_id = $1', [o.cabinetId, sim.plan.delaiGraceJours])).rows[0];
        if (ab?.statut === 'resilie' && ab.d) return { attente: { raison: `délai de grâce en cours : ${manquantes[0]!.detail}`, prochaine: ab.d } };
      }
      try {
        const r = await finDeContrat(client, { cabinetId: o.cabinetId, confirmation: o.confirmation, parametres: o.parametres, dureesValidees: o.dureesValidees, appliquer: true });
        if (r.simulation) throw new Error('fin de contrat non exécutée');
        return { fait: { empreinteProcesVerbal: r.procesVerbal.empreinte, executeLe: r.procesVerbal.executeLe } };
      } catch (err) {
        if (err instanceof RefusFinDeContrat) throw new Error(`fin de contrat refusée : ${err.motifs.join(' | ')}`);
        throw err;
      }
    },
    // 3. Objets du stockage : verrous d'objets non échus = attente (jamais de contournement).
    objets: async () => {
      if (!o.ports.objets) return { attente: { raison: 'aucun stockage d’essai fourni : la suppression des objets ne s’exécute que sur un stockage déclaré d’essai' } };
      try {
        const r = await supprimerObjetsFinDeContratEssai(client, o.ports.objets, { cabinetId: o.cabinetId, confirmation: o.confirmation, dureesValidees: o.dureesValidees, fichierRapport: chemins.rapportObjets });
        return { fait: { passage: r.passage, trouvees: r.trouvees, supprimees: r.supprimees, restantes: r.restantes } };
      } catch (err) {
        if (!(err instanceof SuppressionObjetsIncomplete)) throw err;
        const quand = err.rapport.lignes
          .filter((l) => l.resultat === 'verrouillee')
          .map((l) => /jusqu’au (\S+)/.exec(l.detail ?? '')?.[1])
          .filter((t): t is string => !!t)
          .map((t) => new Date(t))
          .filter((d) => !Number.isNaN(d.getTime()))
          .map((d) => d.toISOString().slice(0, 10));
        return { attente: { raison: `${err.rapport.verrouillees} version(s) d'objet sous verrou (Object Lock), non contournées ; le reste est supprimé`, prochaine: quand.sort().at(-1) ?? null, resume: { passage: err.rapport.passage, supprimees: err.rapport.supprimees, verrouillees: err.rapport.verrouillees } } };
      }
    },
    // 4. Comptes du fournisseur d'identité, d'après le plan établi avant la fin de contrat.
    identite: async () => {
      if (!o.ports.identite) return { attente: { raison: 'aucun fournisseur d’identité d’essai fourni' } };
      const comptes = e.plan?.comptes ?? [];
      const lignes = await o.ports.identite.appliquerPlan(comptes, { appliquer: true, aujourdhui: o.aujourdhui });
      const enAttente = lignes.filter((l) => l.apres !== 'absent' && l.action !== 'ignore_identite_differente');
      if (enAttente.length) {
        const dates = enAttente.map((l) => {
          const c = comptes.find((x) => x.sujetOidc === l.sujetOidc)!;
          return l.apres === 'actif' ? c.desactiverLe : c.supprimerLe;
        });
        return { attente: { raison: `${enAttente.length} compte(s) à désactiver ou à supprimer à leur date`, prochaine: minDate(...dates), resume: { desactives: lignes.filter((l) => l.apres === 'desactive').length, supprimes: lignes.filter((l) => l.apres === 'absent').length } } };
      }
      return { fait: { supprimes: lignes.filter((l) => l.apres === 'absent').length, ignores: lignes.filter((l) => l.action === 'ignore_identite_differente').length } };
    },
    // 5. Fiches d'utilisateurs : seulement celles du plan (les comptes sont fermés avant : la pseudonymisation change le sujet).
    fiches: async () => {
      const r = await appliquerFichesOrphelinesEssai(client, { appliquer: true, env: o.env ?? process.env, seulement: e.plan?.utilisateurs ?? [] });
      return { fait: { supprimees: r.supprimees, pseudonymisees: r.pseudonymisees, dejaPseudonymisees: r.dejaPseudonymisees } };
    },
    // 6. Sauvegardes : rotation, nettoyage du dépôt d'objets, puis constat qu'aucun jeu conservé ne contient encore le cabinet.
    sauvegardes: async () => {
      const s = o.ports.sauvegardes;
      if (!s) return { attente: { raison: 'aucun répertoire de sauvegardes d’essai fourni' } };
      const p = o.parametres.parametres.sauvegardes;
      const rot = appliquerRotation(s.repertoire, s.repertoireReel, { retentionJours: p.retentionJours, jeuxMinimumConserves: p.jeuxMinimumConserves, maintenant });
      const net = appliquerNettoyageObjets(s.repertoire, s.repertoireReel);
      const contenant = jeuxContenantCabinet(s.repertoire, o.cabinetId, new Date(e.pivotSauvegardes ?? maintenant));
      const resume = { jeuxRetires: rot.retires.length, objetsOrphelinsSupprimes: net.supprimes, octetsLiberes: rot.octetsLiberes + net.octetsLiberes, jeuxContenantEncore: contenant.length };
      if (contenant.length) {
        const dates = contenant
          .filter((c) => c.type !== 'interrompu')
          .map((c) => {
            const d = /(\d{4})(\d{2})(\d{2})/.exec(c.id)!;
            return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + p.retentionJours + 1)).toISOString().slice(0, 10);
          });
        return { attente: { raison: `${contenant.length} jeu(x) de sauvegarde contiennent encore des données du cabinet (${contenant.map((c) => c.id).join(', ')}) ; la rotation les retirera à l'échéance de la rétention (${p.retentionJours} jours, ${p.jeuxMinimumConserves} jeu(x) au minimum toujours conservés)`, prochaine: dates.sort().at(-1) ?? null, resume } };
      }
      return { fait: resume };
    },
    // 7. Éléments conservés, à leurs échéances : attente tant qu'il en reste hors journal et procès-verbal.
    elements_conserves: async () => {
      const r = await detruireElementsConservesEssai(client, { ...garde, aujourdhui: o.aujourdhui, fichierRapport: chemins.rapportDestruction });
      const restant = r.plan.categories.filter((c) => (CATEGORIES_A_TERME as readonly string[]).includes(c.code) && c.etat !== 'vide');
      const resume = { detruites: r.categories.filter((c) => c.action === 'detruite').map((c) => c.code) };
      if (restant.length) return { attente: { raison: `éléments conservés non échus : ${restant.map((c) => c.code).join(', ')}`, prochaine: minDate(...restant.flatMap((c) => c.tables.map((t) => t.prochaineEcheance))), resume } };
      return { fait: resume };
    },
    // 8. Scellement du journal (n'écrit que des fichiers) ; refait si le journal a changé depuis.
    scellement_journal: async () => {
      const lignes = Number((await client.query<{ n: string }>('select count(*)::text as n from journal_audit where cabinet_id = $1', [o.cabinetId])).rows[0]!.n);
      if (lignes === 0) return { fait: { journalVide: true } };
      const plan = await planDestructionTerme(client, o.cabinetId, o.parametres, { aujourdhui: o.aujourdhui });
      const j = plan.categories.find((c) => c.code === 'journal_audit')!;
      if (j.etat !== 'echue') return { attente: { raison: 'le journal n’est pas entièrement échu : il se scelle et se détruit en entier', prochaine: minDate(...j.tables.map((t) => t.prochaineEcheance)) } };
      const s = await scellerJournal(client, o.cabinetId, { repertoire: chemins.scellements });
      e.scellement = s.cheminManifeste;
      return { fait: { rang: s.manifeste.rang, lignes: s.manifeste.lignes, exportSha256: s.manifeste.exportSha256, deja: s.deja } };
    },
    // 9. Destruction du journal : décision humaine documentée, scellement à jour.
    destruction_journal: async () => {
      const n = Number((await client.query<{ n: string }>('select ((select count(*) from journal_audit where cabinet_id = $1) + (select count(*) from anomalies_journal where cabinet_id = $1))::text as n', [o.cabinetId])).rows[0]!.n);
      if (n === 0) return { fait: { rien: 'aucune ligne de journal', deja: e.journalDetruit !== null } };
      if (!o.decision) return { attente: { raison: 'décision humaine documentée requise (référence, auteur, date, motif) : la destruction du journal n’est jamais automatique' } };
      if (!e.scellement) return { attente: { raison: 'journal non scellé' } };
      try {
        const r = await detruireJournalEssai(client, { ...garde, aujourdhui: o.aujourdhui, fichierRapport: chemins.rapportDestruction, cheminManifeste: e.scellement, decision: o.decision });
        e.journalDetruit = { lignes: r.lignes, anomalies: r.anomalies, empreinteTete: r.empreinteTete, exportSha256: r.exportSha256, ancreEmpreinte: r.ancreEmpreinte, decision: r.decision };
        return { fait: { lignes: r.lignes, anomalies: r.anomalies, etat: r.etat } };
      } catch (err) {
        if (!(err instanceof ScellementPerime)) throw err;
        // Le journal a changé depuis le scellement : il faut le sceller de nouveau (étape précédente rejouée au prochain passage).
        e.etapes.scellement_journal = { ...vide(), raison: 'scellement périmé : à refaire' };
        return { attente: { raison: `${err.message} (l’étape de scellement sera rejouée au prochain passage)` } };
      }
    },
    // 10. Clôture : certificat de destruction, puis procès-verbal et ligne du cabinet.
    cloture: async () => {
      if ((await client.query('select 1 from cabinets where id = $1', [o.cabinetId])).rowCount) {
        const pvPlan = (await planDestructionTerme(client, o.cabinetId, o.parametres, { aujourdhui: o.aujourdhui })).categories.find((c) => c.code === 'fin_de_contrat');
        if (pvPlan && pvPlan.etat !== 'vide' && pvPlan.etat !== 'echue') return { attente: { raison: 'la durée de conservation du procès-verbal de fin de contrat n’est pas échue', prochaine: minDate(...pvPlan.tables.map((t) => t.prochaineEcheance)) } };
      }
      const r = await cloturerCabinetEssai(client, { ...garde, aujourdhui: o.aujourdhui, fichierRapport: chemins.rapportDestruction, fichierCertificat: chemins.certificat, journalDetruit: e.journalDetruit });
      return { fait: { etat: r.etat, empreinteCertificat: r.certificat.empreinte } };
    },
  };

  for (const nom of ETAPES_CYCLE) {
    const st = e.etapes[nom];
    if (st.statut === 'fait') continue;
    await o.avantEtape?.(nom);
    st.statut = 'en_cours';
    st.tentatives++;
    st.maj = new Date().toISOString();
    enregistrer(o.repertoire, e);
    let issue: Issue;
    try {
      issue = await etapes[nom]();
    } catch (err) {
      if (err instanceof ArretBrutal) throw err;
      st.statut = 'echec';
      st.raison = (err as Error).message;
      st.maj = new Date().toISOString();
      enregistrer(o.repertoire, e);
      return retour({ etape: nom, statut: 'echec', raison: st.raison, prochaine: null });
    }
    // « base », « objets » et « identite » fixent le point de départ de la rotation des sauvegardes, même en attente (ils ont déjà agi).
    if (nom === 'base' || nom === 'objets' || nom === 'identite') e.pivotSauvegardes = maintenantIso(e.pivotSauvegardes);
    st.maj = new Date().toISOString();
    if ('fait' in issue) {
      st.statut = 'fait';
      st.resume = issue.fait;
      st.raison = null;
      st.prochaine = null;
      faites.push(nom);
      enregistrer(o.repertoire, e);
      await o.apresEtape?.(nom);
      continue;
    }
    st.statut = 'attente';
    st.raison = issue.attente.raison;
    st.prochaine = issue.attente.prochaine ?? null;
    st.resume = issue.attente.resume ?? st.resume;
    enregistrer(o.repertoire, e);
    return retour({ etape: nom, statut: 'attente', raison: st.raison, prochaine: st.prochaine });
  }
  return retour(null);
}

const LIBELLES: Record<NomEtape, string> = {
  comptes_plan: 'Plan des comptes à fermer (avant la fin de contrat)',
  base: 'Fin de contrat en base (suppression, procès-verbal)',
  objets: 'Suppression des objets du stockage',
  identite: 'Fermeture des comptes du fournisseur d’identité',
  fiches: 'Fiches d’utilisateurs (suppression ou pseudonymisation)',
  sauvegardes: 'Sauvegardes : rotation, nettoyage des objets, constat',
  elements_conserves: 'Éléments conservés détruits à leur échéance',
  scellement_journal: 'Scellement du journal d’audit (export et ancre)',
  destruction_journal: 'Destruction du journal d’audit (décision humaine)',
  cloture: 'Clôture : certificat de destruction, procès-verbal, cabinet',
};
const SYMBOLES: Record<StatutEtape, string> = { a_faire: '[ ]', en_cours: '[~]', fait: '[x]', attente: '[…]', echec: '[!]' };
const frDate = (d: string) => d.split('-').reverse().join('/');

/** Rapport du cycle lisible par une personne : où il en est, ce qui attend, quand rappeler. Pure. */
export function rendreCycleLisible(e: EtatCycle, aujourdhui?: string): string {
  const o: string[] = [`Cycle de fin de vie — ${e.nomCabinet}`, '='.repeat(18 + e.nomCabinet.length)];
  if (aujourdhui) o.push(`Au ${frDate(aujourdhui)}.`);
  o.push('');
  for (const n of ETAPES_CYCLE) {
    const s = e.etapes[n];
    o.push(`${SYMBOLES[s.statut]} ${LIBELLES[n]}${s.statut === 'fait' ? '' : s.statut === 'a_faire' ? ' — pas encore commencée' : s.statut === 'echec' ? ' — ÉCHEC' : s.statut === 'attente' ? ' — en attente' : ' — interrompue, sera rejouée'}`);
    if (s.raison && (s.statut === 'attente' || s.statut === 'echec')) o.push(`      ${s.raison}${s.prochaine ? ` (rappeler à partir du ${frDate(s.prochaine)})` : ''}`);
    if (s.tentatives > 1) o.push(`      ${s.tentatives} passages`);
  }
  const reste = ETAPES_CYCLE.find((n) => e.etapes[n].statut !== 'fait');
  o.push('', reste ? `Prochaine étape : ${LIBELLES[reste]}.` : 'Cycle terminé : plus rien n’est conservé pour ce cabinet. Le certificat de destruction fait foi.');
  return `${o.join('\n')}\n`;
}
