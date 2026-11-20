/**
 * Intégration de la passerelle IA interne (`@comtaple/ia`) à la plateforme : fabrique à partir de la configuration,
 * journal d'audit écrit dans `evenements_ia`, et règle d'emploi du modèle.
 *
 * - Sans `IA_OVH_ENDPOINT` ou sans `IA_OVH_JETON`, aucun fournisseur n'existe : statut `non_connecte`, aucun appel sortant.
 * - Le SIMULATEUR de test n'est jamais instancié ici et n'est activable par AUCUNE variable de configuration : seul
 *   le code de test peut en passer un à `assemblerIa`.
 * - `active()` ne rend la passerelle reliée au fournisseur que si le statut est `connecte` (ou `simule` dans un test).
 *   Un fournisseur configuré mais non vérifié n'est donc jamais sollicité par une tâche métier.
 * - `connecte` exige une PREUVE persistée (`verifications_connexion_ia`, migration 0041) : dernière vérification faite
 *   par l'éditeur pour la configuration COURANTE (même empreinte), réussie, non périmée, sur l'hôte officiel avec les
 *   modèles figés. La preuve est relue de la base et réévaluée ; l'API et le worker ne peuvent pas l'écrire.
 *   La vérification elle-même (`verifierEtEnregistrerPreuveIa`) émet un appel réel : c'est une opération de l'éditeur
 *   (`node scripts/editeur.mjs ia-verifier`), jamais une route ouverte aux cabinets, jamais un appel automatique.
 */
import { createHash } from 'node:crypto';
import { type AccesBd, schema as s } from '@comtaple/db';
import { creerFournisseurOvhDepuisEnv, type EvenementAuditIa, evaluerStatutIa, type FournisseurIa, type JournalAuditIa, MODELES_IA, PasserelleIa, type PreuveConnexionIa, type StatutIa, type TarifsIa } from '@comtaple/ia';
import { z } from 'zod';
import type { Config } from './config.js';

const prix = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/);
const schemaTarifs = z.strictObject({
  relevesLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  devise: z.string().regex(/^[A-Z]{3}$/),
  source: z.string().min(1).max(500),
  parMillionDeJetons: z.record(z.string().min(1).max(200), z.strictObject({ entree: prix, sortie: prix })),
});

/**
 * Tarifs datés pour l'estimation de coût (`IA_TARIFS`, objet JSON). Vide : `null`, aucun coût n'est estimé.
 * Le code n'embarque aucun tarif. Une valeur illisible est refusée au démarrage, sans être affichée.
 */
export function lireTarifsIa(cfg: Pick<Config, 'IA_TARIFS'>): TarifsIa | null {
  const brut = cfg.IA_TARIFS.trim();
  if (brut === '') return null;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    throw new Error('Configuration invalide : IA_TARIFS n’est pas un objet JSON.');
  }
  const r = schemaTarifs.safeParse(lu);
  if (!r.success) throw new Error(`Configuration invalide : IA_TARIFS (${r.error.issues.map((i) => i.path.join('.')).join(', ')}).`);
  return r.data;
}

export type NatureEvenementIa = 'reel' | 'simulateur' | 'sans_ia';

/**
 * Journal d'audit de la passerelle : une ligne de `evenements_ia` par événement, SANS CONTENU (identifiants, tailles,
 * empreinte, durées, codes). La table est en ajout seul. `consigner` est synchrone (port du paquet) : les écritures
 * sont regroupées et faites en arrière-plan ; `vider()` attend qu'elles soient terminées.
 * Une écriture en échec est signalée au journal technique (code seulement) et ne bloque jamais la réponse.
 */
export class JournalIaBd implements JournalAuditIa {
  readonly #bd: AccesBd;
  readonly #natureFournisseur: 'reel' | 'simulateur' | null;
  #tampon: EvenementAuditIa[] = [];
  #minuteur: NodeJS.Timeout | null = null;
  readonly #enCours = new Set<Promise<void>>();

  constructor(bd: AccesBd, natureFournisseur: 'reel' | 'simulateur' | null) {
    this.#bd = bd;
    this.#natureFournisseur = natureFournisseur;
  }

  consigner(evenement: EvenementAuditIa): void {
    this.#tampon.push(evenement);
    if (this.#minuteur === null) {
      this.#minuteur = setTimeout(() => void this.vider(), 100);
      this.#minuteur.unref();
    }
  }

  /** Écrit les événements en attente et attend la fin de toutes les écritures en cours. */
  async vider(): Promise<void> {
    if (this.#minuteur !== null) {
      clearTimeout(this.#minuteur);
      this.#minuteur = null;
    }
    const lot = this.#tampon;
    this.#tampon = [];
    if (lot.length > 0) {
      const ecriture = this.#ecrire(lot).catch((e: unknown) => {
        console.error(`[ia] trace d’audit non enregistrée : ${(e as { code?: string } | null)?.code ?? 'erreur'}`);
      });
      this.#enCours.add(ecriture);
      void ecriture.finally(() => this.#enCours.delete(ecriture));
    }
    await Promise.all([...this.#enCours]);
  }

  /** Ligne de `evenements_ia` correspondant à un événement du paquet. Aucun contenu n'existe dans l'événement lui-même. */
  ligne(e: EvenementAuditIa): typeof s.evenementsIa.$inferInsert {
    const commun = { cabinetId: e.contexte.cabinetId, entiteIdCible: e.contexte.dossierId, utilisateurId: e.contexte.utilisateurId, type: e.type, tache: e.tache };
    if (e.type === 'appel_ia') {
      return {
        ...commun,
        // Sans fournisseur, aucun modèle n'a été appelé : l'événement est compté « sans IA », jamais comme un appel réel.
        nature: e.nature ?? 'sans_ia',
        modele: e.modele,
        resultat: e.nature === null ? 'indisponible' : e.resultat,
        codes: e.codes,
        dureeMs: e.dureeMs,
        jetonsEntree: e.jetons.entree,
        jetonsSortie: e.jetons.sortie,
        coutEstime: e.coutEstime?.montant ?? null,
        devise: e.coutEstime?.devise ?? null,
        empreintePrompt: e.empreintePrompt,
        mesures: { trace: e.id, operation: e.operation, prompt: e.prompt, fournisseur: e.fournisseur, tailles: e.tailles, pseudonymes: e.pseudonymes, tarifsRelevesLe: e.coutEstime?.tarifsRelevesLe ?? null },
      };
    }
    return {
      ...commun,
      nature: e.mode === 'sans_ia' ? 'sans_ia' : (this.#natureFournisseur ?? 'sans_ia'),
      modele: null,
      resultat: e.issue,
      codes: e.code === null ? [] : [e.code],
      mesures: { trace: e.id, fonction: e.fonction, mode: e.mode, tailles: e.tailles },
    };
  }

  async #ecrire(lot: EvenementAuditIa[]): Promise<void> {
    // Une transaction par contexte (cabinet, utilisateur) : la politique d'isolation du cabinet s'applique à l'ajout.
    const groupes = new Map<string, EvenementAuditIa[]>();
    for (const e of lot) {
      const cle = `${e.contexte.cabinetId}\u0001${e.contexte.utilisateurId ?? ''}`;
      groupes.set(cle, [...(groupes.get(cle) ?? []), e]);
    }
    for (const evenements of groupes.values()) {
      const { cabinetId, utilisateurId } = (evenements[0] as EvenementAuditIa).contexte;
      await this.#bd.avecContexte({ cabinetId, utilisateurId }, async (tx) => {
        await tx.insert(s.evenementsIa).values(evenements.map((e) => this.ligne(e)));
      });
    }
  }
}

// ───────────────────────────── Preuve de connexion persistée ─────────────────────────────

/** Durée de validité par défaut d'une vérification, en jours (`IA_PREUVE_VALIDITE_JOURS`). */
export const VALIDITE_PREUVE_IA_JOURS = 30;

/**
 * Empreinte de la configuration vérifiée : URL de base, modèles figés, dimension des vecteurs et empreinte du jeton.
 * Changer l'un d'eux donne une autre empreinte : la preuve antérieure ne vaut plus pour la configuration courante.
 * Le jeton n'y figure que par son SHA-256, lui-même condensé : l'empreinte ne permet pas de le retrouver.
 */
export function empreinteConfigurationIa(cfg: { urlBase: string; jeton: string }): string {
  const jeton = createHash('sha256').update(cfg.jeton, 'utf8').digest('hex');
  return createHash('sha256')
    .update(['comtaple-ia-configuration-v1', cfg.urlBase.trim(), MODELES_IA.langage.id, MODELES_IA.embeddings.id, String(MODELES_IA.embeddings.dimensions), jeton].join('\n'), 'utf8')
    .digest('hex');
}

/** Une ligne de `verifications_connexion_ia`. Ni prompt ni réponse. */
export interface VerificationIa {
  id: string;
  verifieeLe: string;
  resultat: string;
  raisons: string[];
  urlBase: string;
  hote: string;
  urlsAppelees: string[];
  modeleLangage: string | null;
  modeleEmbeddings: string | null;
  dimensionsEmbeddings: number | null;
  reponseSimulateur: boolean;
  empreinteConfiguration: string;
  valideJusquAu: string;
}

export type EtatPreuveIa = 'absente' | 'valide' | 'perimee' | 'autre_configuration' | 'non_concluante' | 'non_conforme';

/** Ce que l'écran d'administration montre de la preuve : jamais d'URL complète ni de secret, seulement l'hôte. */
export interface VuePreuveIa {
  etat: EtatPreuveIa;
  /** Phrase affichable expliquant l'état. */
  detail: string;
  verifieeLe: string | null;
  valideJusquAu: string | null;
  /** Ce que la vérification atteste (hôte, modèles renvoyés, dimension) ; null sans vérification pour cette configuration. */
  atteste: { hote: string; modeleLangage: string | null; modeleEmbeddings: string | null; dimensionsEmbeddings: number | null } | null;
  validiteJours: number;
}

const texteOuNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const listeTextes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function versVerification(l: Record<string, unknown>): VerificationIa {
  return {
    id: String(l.id),
    verifieeLe: iso(l.verifiee_le),
    resultat: String(l.resultat),
    raisons: listeTextes(l.raisons),
    urlBase: String(l.url_base),
    hote: String(l.hote),
    urlsAppelees: listeTextes(l.urls_appelees),
    modeleLangage: texteOuNull(l.modele_langage),
    modeleEmbeddings: texteOuNull(l.modele_embeddings),
    dimensionsEmbeddings: typeof l.dimensions_embeddings === 'number' ? l.dimensions_embeddings : null,
    reponseSimulateur: l.reponse_simulateur === true,
    empreinteConfiguration: String(l.empreinte_configuration),
    valideJusquAu: iso(l.valide_jusqu_au),
  };
}

/** La preuve du paquet, reconstruite d'une ligne : c'est `evaluerStatutIa` qui juge l'hôte, les modèles et la dimension. */
const versPreuve = (v: VerificationIa): PreuveConnexionIa => ({
  verifieeLe: v.verifieeLe,
  urlBase: v.urlBase,
  urlsAppelees: v.urlsAppelees,
  reponseSimulateur: v.reponseSimulateur,
  modeles: { langage: v.modeleLangage, embeddings: v.modeleEmbeddings },
  dimensionsEmbeddings: v.dimensionsEmbeddings,
});

const COLONNES_VERIFICATION = 'id, verifiee_le, resultat, raisons, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, reponse_simulateur, empreinte_configuration, valide_jusqu_au';

/**
 * Juge une ligne relue de la base pour la configuration courante. RIEN de ce que porte la ligne n'est cru sur parole :
 * une ligne « connecte » d'une autre configuration, périmée, datée du futur, marquée simulateur, ou dont l'hôte ou les
 * modèles ne sont pas ceux attendus, ne donne jamais de preuve. Fonction pure (testée seule).
 */
export function jugerVerificationIa(
  fournisseur: Pick<FournisseurIa, 'nature' | 'urlBase'>,
  empreinteCourante: string | null,
  courante: VerificationIa | null,
  derniereAutre: VerificationIa | null,
  maintenant: Date,
  validiteJours: number,
): { preuve: PreuveConnexionIa | null; vue: VuePreuveIa } {
  const sans = (etat: EtatPreuveIa, detail: string, v: VerificationIa | null = null): { preuve: null; vue: VuePreuveIa } => ({
    preuve: null,
    vue: { etat, detail, verifieeLe: v?.verifieeLe ?? null, valideJusquAu: v?.valideJusquAu ?? null, atteste: v ? { hote: v.hote, modeleLangage: v.modeleLangage, modeleEmbeddings: v.modeleEmbeddings, dimensionsEmbeddings: v.dimensionsEmbeddings } : null, validiteJours },
  });
  if (courante === null || empreinteCourante === null || courante.empreinteConfiguration !== empreinteCourante) {
    return derniereAutre
      ? sans('autre_configuration', 'La dernière vérification concernait une autre configuration (URL, modèles ou jeton différents) : elle ne vaut pas pour la configuration courante.')
      : sans('absente', 'Aucune vérification de connexion n’a été faite pour la configuration courante.');
  }
  if (courante.resultat !== 'connecte') {
    return sans('non_concluante', courante.resultat === 'echec' ? 'La dernière vérification a échoué : l’appel au fournisseur n’a pas abouti.' : 'La dernière vérification n’a pas été concluante (hôte, modèle ou dimension non conformes).', courante);
  }
  const t = maintenant.getTime();
  const debut = Date.parse(courante.verifieeLe);
  // Péremption : la plus courte des deux bornes — celle inscrite à la vérification et celle de la configuration courante.
  const fin = Math.min(Date.parse(courante.valideJusquAu), debut + validiteJours * 86_400_000);
  if (!(debut <= t + 300_000)) return sans('non_conforme', 'La vérification enregistrée est datée du futur : elle est ignorée.', courante);
  if (!(t < fin)) return sans('perimee', `La vérification du ${courante.verifieeLe.slice(0, 10)} est périmée (validité : ${validiteJours} jours) : une nouvelle vérification par l’éditeur est nécessaire.`, courante);
  const preuve = versPreuve(courante);
  const jugement = evaluerStatutIa(fournisseur, preuve);
  if (jugement.statut !== 'connecte') return sans('non_conforme', `La vérification enregistrée n’est pas conforme : ${jugement.raisons.join(' ')}`, courante);
  return {
    preuve,
    vue: { etat: 'valide', detail: `Connexion vérifiée le ${courante.verifieeLe.slice(0, 10)}, valable jusqu’au ${new Date(fin).toISOString().slice(0, 10)}.`, verifieeLe: courante.verifieeLe, valideJusquAu: new Date(fin).toISOString(), atteste: { hote: courante.hote, modeleLangage: courante.modeleLangage, modeleEmbeddings: courante.modeleEmbeddings, dimensionsEmbeddings: courante.dimensionsEmbeddings }, validiteJours },
  };
}

/** Ce dont la vérification a besoin d'un client PostgreSQL d'ADMINISTRATION (`pg.Client`). */
export interface ClientVerificationIa {
  query(texte: string, valeurs?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface ResultatVerificationIa {
  statut: StatutIa;
  raisons: string[];
  /** Une ligne a été ajoutée à `verifications_connexion_ia` ; jamais pour un simulateur ni sans fournisseur. */
  enregistree: boolean;
  resultat: 'connecte' | 'refusee' | 'echec' | null;
  verification: VerificationIa | null;
}

const journalMuet: JournalAuditIa = { consigner: () => undefined };

/**
 * VÉRIFICATION de la connexion, opération de l'ÉDITEUR. Émet deux appels RÉELS au fournisseur (une complétion de
 * quelques jetons, un vecteur) : un coût et un flux sortant, donc jamais déclenchée par un cabinet ni par une minuterie.
 *  - sans fournisseur : rien n'est appelé, rien n'est écrit ;
 *  - fournisseur SIMULATEUR (tests) : statut « simule », RIEN n'est écrit — un simulateur ne produit jamais de preuve ;
 *  - sinon : une ligne est ajoutée, « connecte » seulement si `evaluerStatutIa` le dit (hôte officiel en https, modèles
 *    figés, dimension attendue, aucune marque de simulateur) ; « refusee » ou « echec » sinon — ce qui invalide toute
 *    preuve antérieure de cette configuration (la ligne la plus récente fait foi).
 * `client` doit être le rôle d'administration : l'API et le worker n'ont que la lecture de la table.
 * Les appels de vérification ne sont rattachés à aucun cabinet : ils ne sont pas inscrits dans `evenements_ia`.
 */
export async function verifierEtEnregistrerPreuveIa(
  client: ClientVerificationIa,
  p: { fournisseur: FournisseurIa | null; empreinteConfiguration: string | null; validiteJours?: number; maintenant?: () => Date },
): Promise<ResultatVerificationIa> {
  const validiteJours = p.validiteJours ?? VALIDITE_PREUVE_IA_JOURS;
  if (!(Number.isInteger(validiteJours) && validiteJours >= 1 && validiteJours <= 90)) throw new Error('Durée de validité invalide (1 à 90 jours).');
  const passerelle = new PasserelleIa({ fournisseur: p.fournisseur, journal: journalMuet, tarifs: null });
  if (p.fournisseur === null) return { ...passerelle.statut(), enregistree: false, resultat: null, verification: null };
  // Contexte factice : l'opération n'appartient à aucun cabinet, et le journal muet ne l'écrit nulle part.
  const r = await passerelle.verifierConnexion({ cabinetId: '00000000-0000-0000-0000-000000000000' });
  if (p.fournisseur.nature === 'simulateur' || r.statut === 'simule') return { statut: 'simule', raisons: r.raisons, enregistree: false, resultat: null, verification: null };
  if (p.empreinteConfiguration === null || !/^[0-9a-f]{64}$/.test(p.empreinteConfiguration)) throw new Error('Empreinte de configuration absente : la vérification ne peut pas être enregistrée.');
  const urlBase = p.fournisseur.urlBase ?? '';
  let hote = '';
  try {
    hote = new URL(urlBase).hostname;
  } catch {
    hote = '';
  }
  const resultat: 'connecte' | 'refusee' | 'echec' = r.statut === 'connecte' ? 'connecte' : r.preuve === null ? 'echec' : 'refusee';
  const quand = (p.maintenant?.() ?? new Date()).toISOString();
  const { rows } = await client.query(
    `insert into verifications_connexion_ia (verifiee_le, resultat, raisons, url_base, hote, urls_appelees, modele_langage, modele_embeddings, dimensions_embeddings, reponse_simulateur, empreinte_configuration, valide_jusqu_au)
     values ($1::timestamptz, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $1::timestamptz + make_interval(days => $12)) returning ${COLONNES_VERIFICATION}`,
    [
      quand, resultat, JSON.stringify(resultat === 'connecte' ? [] : r.raisons.map((x) => x.slice(0, 300))), urlBase.slice(0, 500), (hote || 'inconnu').slice(0, 255),
      // Adresses appelées : sans chaîne de requête ni fragment (aucun paramètre n'est conservé).
      JSON.stringify((r.preuve?.urlsAppelees ?? []).map((u) => u.split(/[?#]/)[0]!.slice(0, 500))),
      r.preuve?.modeles.langage?.slice(0, 200) ?? null, r.preuve?.modeles.embeddings?.slice(0, 200) ?? null, r.preuve?.dimensionsEmbeddings ?? null, r.preuve?.reponseSimulateur ?? false, p.empreinteConfiguration, validiteJours,
    ],
  );
  return { statut: r.statut, raisons: r.raisons, enregistree: true, resultat, verification: versVerification(rows[0]) };
}

/**
 * La vérification telle que la lance l'outil de l'éditeur : fournisseur et empreinte construits à partir de la
 * configuration de la plateforme (`IA_OVH_ENDPOINT`, `IA_OVH_JETON`). Sans configuration : rien n'est appelé ni écrit.
 */
export function verifierConnexionIaConfiguree(
  client: ClientVerificationIa,
  cfg: { IA_OVH_ENDPOINT?: string | undefined; IA_OVH_JETON?: string | undefined; IA_PREUVE_VALIDITE_JOURS?: number | undefined },
): Promise<ResultatVerificationIa> {
  const fournisseur = creerFournisseurOvhDepuisEnv({ IA_OVH_ENDPOINT: cfg.IA_OVH_ENDPOINT, IA_OVH_JETON: cfg.IA_OVH_JETON });
  return verifierEtEnregistrerPreuveIa(client, {
    fournisseur,
    empreinteConfiguration: fournisseur ? empreinteConfigurationIa({ urlBase: fournisseur.urlBase ?? '', jeton: (cfg.IA_OVH_JETON ?? '').trim() }) : null,
    ...(cfg.IA_PREUVE_VALIDITE_JOURS === undefined ? {} : { validiteJours: cfg.IA_PREUVE_VALIDITE_JOURS }),
  });
}

/** Dernières vérifications enregistrées (lecture seule), pour l'outil de l'éditeur. Ni prompt ni réponse n'y figurent. */
export async function dernieresVerificationsIa(client: ClientVerificationIa, limite = 10): Promise<VerificationIa[]> {
  const { rows } = await client.query(`select ${COLONNES_VERIFICATION} from verifications_connexion_ia order by verifiee_le desc, id desc limit $1`, [Math.min(Math.max(limite, 1), 100)]);
  return rows.map(versVerification);
}

/** Options d'assemblage liées à la preuve persistée. */
export interface OptionsPreuveIa {
  /** Empreinte de la configuration courante ; `null` (tests sans configuration) : aucune preuve ne peut correspondre. */
  empreinteConfiguration?: string | null;
  validiteJours?: number;
  maintenant?: () => Date;
  /** Âge maximal, en millisecondes, de la lecture en cache de la table avant une relecture en arrière-plan. */
  fraicheurMs?: number;
}

export interface ServicesIa {
  /** Passerelle construite sur le fournisseur configuré (ou sans fournisseur). Sert au statut et à la vérification de connexion. */
  passerelle: PasserelleIa;
  journal: JournalIaBd;
  tarifs: TarifsIa | null;
  /** `reel`, `simulateur` (tests uniquement) ou `null` sans fournisseur. */
  natureFournisseur: 'reel' | 'simulateur' | null;
  statut(): { statut: StatutIa; raisons: string[] };
  /** Vrai seulement si un modèle peut être sollicité : statut `connecte`, ou `simule` dans un test. */
  modeleUtilisable(): boolean;
  /**
   * Passerelle à donner aux tâches et à l'assistant : celle du fournisseur si `modeleUtilisable()`, sinon une
   * passerelle sans fournisseur (toute tâche rend alors « IA indisponible » et son repli, sans aucun appel sortant).
   */
  active(): PasserelleIa;
  /** État de la preuve de connexion pour la configuration courante (affichage) ; `null` sans fournisseur réel. */
  preuve(): VuePreuveIa | null;
  /**
   * Relit la preuve dans la base (lecture seule) et réévalue le statut. Appelée au démarrage, avant d'afficher l'état,
   * et en arrière-plan quand la lecture en cache a vieilli. Une lecture en échec vaut « aucune preuve ».
   */
  rafraichirPreuve(): Promise<void>;
}

/** Assemble la passerelle sur un fournisseur donné. Hors des tests, le fournisseur vient toujours de `creerIa`. */
export function assemblerIa(bd: AccesBd, fournisseur: FournisseurIa | null, tarifs: TarifsIa | null = null, options: OptionsPreuveIa = {}): ServicesIa {
  const natureFournisseur = fournisseur?.nature ?? null;
  const journal = new JournalIaBd(bd, natureFournisseur);
  const passerelle = new PasserelleIa({ fournisseur, journal, tarifs });
  const sansFournisseur = fournisseur === null ? passerelle : new PasserelleIa({ fournisseur: null, journal, tarifs: null });
  const empreinte = options.empreinteConfiguration ?? null;
  const validiteJours = options.validiteJours ?? VALIDITE_PREUVE_IA_JOURS;
  const maintenant = options.maintenant ?? (() => new Date());
  const fraicheurMs = options.fraicheurMs ?? 30_000;
  // Une preuve n'a de sens que pour un fournisseur RÉEL : sans fournisseur ou avec le simulateur, la table n'est jamais lue.
  const avecPreuve = fournisseur !== null && fournisseur.nature === 'reel';
  let lues: { courante: VerificationIa | null; derniereAutre: VerificationIa | null } = { courante: null, derniereAutre: null };
  let lueLe = 0;
  let lecture: Promise<void> | null = null;

  /** Réévalue à CHAQUE appel (la péremption dépend de l'heure) et remet à la passerelle la seule preuve encore valable. */
  const juger = (): VuePreuveIa | null => {
    if (!avecPreuve || fournisseur === null) return null;
    const j = jugerVerificationIa(fournisseur, empreinte, lues.courante, lues.derniereAutre, maintenant(), validiteJours);
    passerelle.retenirPreuve(j.preuve);
    return j.vue;
  };
  const rafraichirPreuve = (): Promise<void> => {
    if (!avecPreuve) return Promise.resolve();
    lecture ??= (async () => {
      try {
        const courante = empreinte === null ? { rows: [] } : await bd.pool.query(`select ${COLONNES_VERIFICATION} from verifications_connexion_ia where empreinte_configuration = $1 order by verifiee_le desc, id desc limit 1`, [empreinte]);
        const autre = courante.rows.length ? { rows: [] } : await bd.pool.query(`select ${COLONNES_VERIFICATION} from verifications_connexion_ia order by verifiee_le desc, id desc limit 1`);
        lues = { courante: courante.rows[0] ? versVerification(courante.rows[0]) : null, derniereAutre: autre.rows[0] ? versVerification(autre.rows[0]) : null };
      } catch (e) {
        // Base injoignable ou table illisible : aucune preuve, donc jamais « connecte » par défaut.
        lues = { courante: null, derniereAutre: null };
        console.error(`[ia] preuve de connexion illisible : ${(e as { code?: string } | null)?.code ?? 'erreur'}`);
      } finally {
        lueLe = Date.now();
        lecture = null;
      }
    })();
    return lecture;
  };
  /** Relecture en arrière-plan quand la lecture a vieilli : une preuve écrite ou invalidée par l'éditeur est vue sans redémarrage. */
  const entretenir = (): void => {
    if (avecPreuve && Date.now() - lueLe > fraicheurMs) void rafraichirPreuve();
  };
  const statut = (): { statut: StatutIa; raisons: string[] } => {
    entretenir();
    const vue = juger();
    const st = passerelle.statut();
    // La raison générique du paquet (« aucun appel réel réussi ») est précisée par l'état de la preuve persistée.
    return vue && st.statut === 'configure_non_verifie' && vue.etat !== 'absente' ? { statut: st.statut, raisons: [vue.detail] } : st;
  };
  const modeleUtilisable = (): boolean => ['connecte', 'simule'].includes(statut().statut);
  return { passerelle, journal, tarifs, natureFournisseur, statut, modeleUtilisable, active: () => (modeleUtilisable() ? passerelle : sansFournisseur), preuve: juger, rafraichirPreuve };
}

/** Passerelle IA de l'application, à partir de la configuration. Aujourd'hui : aucun jeton, donc `non_connecte`. */
export function creerIa(cfg: Pick<Config, 'IA_OVH_ENDPOINT' | 'IA_OVH_JETON' | 'IA_TARIFS'> & Partial<Pick<Config, 'IA_PREUVE_VALIDITE_JOURS'>>, bd: AccesBd): ServicesIa {
  const fournisseur = creerFournisseurOvhDepuisEnv({ IA_OVH_ENDPOINT: cfg.IA_OVH_ENDPOINT, IA_OVH_JETON: cfg.IA_OVH_JETON });
  const ia = assemblerIa(bd, fournisseur, lireTarifsIa(cfg), {
    empreinteConfiguration: fournisseur ? empreinteConfigurationIa({ urlBase: fournisseur.urlBase ?? '', jeton: cfg.IA_OVH_JETON.trim() }) : null,
    validiteJours: cfg.IA_PREUVE_VALIDITE_JOURS ?? VALIDITE_PREUVE_IA_JOURS,
  });
  // Première lecture de la preuve dès le démarrage (sans fournisseur : aucune lecture).
  void ia.rafraichirPreuve();
  return ia;
}
