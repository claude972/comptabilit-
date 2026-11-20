/**
 * PASSERELLE IA INTERNE UNIQUE. Tout appel à un modèle passe par cette classe, qui :
 * - impose les modèles figés (l'appelant ne choisit jamais le modèle) et refuse une réponse d'un autre modèle ;
 * - pseudonymise tous les contenus avant l'appel et restaure localement les valeurs dans la réponse ;
 * - valide strictement la sortie (JSON, schéma Zod) puis applique le garde-fou déterministe fourni par la tâche ;
 * - mesure (durée, jetons si fournis, coût ESTIMÉ à partir de tarifs configurés et datés) ;
 * - consigne pour chaque appel une trace d'audit SANS CONTENU ;
 * - ne lève jamais pour une panne du fournisseur : elle renvoie `indisponible`, et la tâche se replie.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { empreinteSha256, estimerCout, type ContexteAppel, type JournalAuditIa, type ResultatAppel, type TarifsIa, type TraceAppelIa } from './audit.js';
import { ErreurIa } from './erreurs.js';
import type { AppelFonctionBrut, DefinitionOutil, FournisseurIa, MessageIa, OrigineReponse } from './fournisseur.js';
import { MODELES_IA } from './modeles.js';
import { horlogeSysteme, type Horloge } from './ports.js';
import { creerPseudonymiseur, type Pseudonymiseur } from './pseudonymisation.js';
import { evaluerStatutIa, type PreuveConnexionIa, type StatutIa } from './statut.js';

export interface ReferencePrompt {
  id: string;
  version: string;
}

export interface ConfigurationPasserelle {
  /** `null` : aucune IA configurée (statut `non_connecte`). */
  fournisseur: FournisseurIa | null;
  journal: JournalAuditIa;
  /** Tarifs datés pour l'estimation de coût ; `null` : aucun coût estimé. */
  tarifs?: TarifsIa | null;
  horloge?: Horloge;
  /** Preuve conservée d'une vérification antérieure (voir `verifierConnexion`). */
  preuveConnexion?: PreuveConnexionIa | null;
}

interface DemandeBase {
  /** Nom de la tâche, pour l'audit et les mesures par tâche. */
  tache: string;
  prompt: ReferencePrompt | null;
  /** Contexte imposé par l'appelant. */
  contexte: ContexteAppel;
  /** À fournir pour garder des jetons stables sur plusieurs appels (assistant). Sinon créé pour l'appel. */
  pseudonymiseur?: Pseudonymiseur;
  /** Noms de personnes à masquer (ignoré si `pseudonymiseur` est fourni). */
  nomsPersonnes?: readonly string[];
}

/** Décision du garde-fou déterministe de la tâche. Les codes ne contiennent jamais de contenu. */
export type Verdict = { resultat: 'ok' } | { resultat: 'abstention'; code: string } | { resultat: 'rejet'; codes: string[] };

export interface DemandeJson<T> extends DemandeBase {
  messages: MessageIa[];
  /** Schéma de sortie : sert à contraindre le modèle (schéma JSON) ET à valider sa réponse. */
  schema: z.ZodType<T>;
  nomSchema: string;
  maxJetonsSortie?: number;
  /** Vérifications déterministes sur la valeur validée et restaurée. */
  verifier?: (valeur: T) => Verdict;
}

export type IssueIndisponible = { etat: 'indisponible'; code: string; message: string; traceId: string };

export type IssueJson<T> =
  | { etat: 'ok'; valeur: T; modele: string; traceId: string }
  | { etat: 'abstention'; valeur: T; code: string; modele: string; traceId: string }
  | { etat: 'rejet'; codes: string[]; modele: string; traceId: string }
  | IssueIndisponible;

/** Appel de fonction demandé par le modèle, arguments restaurés. À VALIDER par l'appelant avant toute exécution. */
export interface AppelFonction {
  id: string;
  nom: string;
  /** `undefined` si les arguments ne sont pas du JSON valide. */
  arguments: unknown;
  jsonValide: boolean;
}

export interface TourConversation {
  contenu: string | null;
  appels: AppelFonction[];
  /** Message à ajouter tel quel à l'historique (forme pseudonymisée, comme produite par le modèle). */
  messageAssistant: MessageIa;
}

export interface DemandeConversation extends DemandeBase {
  messages: MessageIa[];
  outils: DefinitionOutil[];
  choixOutil?: 'auto' | 'required' | 'none';
  maxJetonsSortie?: number;
  verifier?: (tour: TourConversation) => Verdict;
}

export type IssueConversation =
  | ({ etat: 'ok'; modele: string; traceId: string } & TourConversation)
  | { etat: 'abstention'; code: string; modele: string; traceId: string }
  | { etat: 'rejet'; codes: string[]; modele: string; traceId: string }
  | IssueIndisponible;

export interface DemandeVecteurs extends DemandeBase {
  textes: string[];
}

export type IssueVecteurs = { etat: 'ok'; vecteurs: number[][]; modele: string; dimensions: number; traceId: string } | IssueIndisponible;

/** Convertit un schéma Zod en schéma JSON pour la sortie contrainte ou la déclaration d'une fonction. */
export function versSchemaJson(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignore, ...reste } = z.toJSONSchema(schema) as Record<string, unknown>;
  return reste;
}

function lireJson(texte: string): { ok: true; valeur: unknown } | { ok: false } {
  // Certains modèles encadrent le JSON d'une clôture Markdown malgré la consigne.
  const nettoye = texte.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { ok: true, valeur: JSON.parse(nettoye) };
  } catch {
    return { ok: false };
  }
}

function tailleMessages(messages: MessageIa[]): number {
  let n = 0;
  for (const m of messages) {
    n += m.contenu?.length ?? 0;
    if (m.role === 'assistant') for (const a of m.appels ?? []) n += a.argumentsJson.length;
  }
  return n;
}

interface Mesure {
  debut: number;
  id: string;
  demande: DemandeBase;
  operation: 'completion' | 'embeddings';
  modele: string;
  empreinte: string;
  pseudonymiseur: Pseudonymiseur;
  tailles: TraceAppelIa['tailles'];
}

export class PasserelleIa {
  readonly #fournisseur: FournisseurIa | null;
  readonly #journal: JournalAuditIa;
  readonly #tarifs: TarifsIa | null;
  readonly #horloge: Horloge;
  #preuve: PreuveConnexionIa | null;

  constructor(configuration: ConfigurationPasserelle) {
    this.#fournisseur = configuration.fournisseur;
    this.#journal = configuration.journal;
    this.#tarifs = configuration.tarifs ?? null;
    this.#horloge = configuration.horloge ?? horlogeSysteme;
    this.#preuve = configuration.preuveConnexion ?? null;
  }

  /** Modèles imposés par la passerelle. */
  get modeles(): typeof MODELES_IA {
    return MODELES_IA;
  }

  /** `simulateur` quand le fournisseur est le simulateur de test ; `null` sans fournisseur. */
  get natureFournisseur(): 'reel' | 'simulateur' | null {
    return this.#fournisseur?.nature ?? null;
  }

  statut(): { statut: StatutIa; raisons: string[] } {
    return evaluerStatutIa(this.#fournisseur, this.#preuve);
  }

  /**
   * Remplace la preuve retenue par celle que l'intégrateur a relue de son stockage (ou `null` : aucune preuve valable).
   * La preuve est RÉÉVALUÉE à chaque lecture du statut (hôte officiel, modèles figés, dimension) : en retenir une ne
   * suffit jamais à obtenir `connecte`, et un simulateur reste `simule` quoi qu'on lui présente.
   */
  retenirPreuve(preuve: PreuveConnexionIa | null): void {
    this.#preuve = preuve;
  }

  /**
   * Fait un appel minimal de complétion et un d'embeddings, puis réévalue le statut. `connecte` n'est obtenu
   * que si les deux réussissent sur l'hôte officiel avec les modèles figés. La preuve renvoyée est à conserver
   * par l'intégrateur et à repasser au constructeur (`preuveConnexion`).
   */
  async verifierConnexion(contexte: ContexteAppel): Promise<{ statut: StatutIa; raisons: string[]; preuve: PreuveConnexionIa | null }> {
    const fournisseur = this.#fournisseur;
    if (fournisseur === null) return { ...this.statut(), preuve: null };
    const base = { tache: 'verification_connexion', prompt: { id: 'verification-connexion', version: '1.0.0' }, contexte };
    const origines: OrigineReponse[] = [];
    const modeles: PreuveConnexionIa['modeles'] = { langage: null, embeddings: null };
    const texte = await this.#completer({ ...base, messages: [{ role: 'user', contenu: 'Réponds par le seul mot : OK' }], outils: [], maxJetonsSortie: 8 }, undefined, (r) => {
      origines.push(r.origine);
      modeles.langage = r.modeleRenvoye;
      return { resultat: 'ok' };
    });
    const vecteurs = await this.#vectoriser({ ...base, textes: ['vérification de connexion'] }, (origine, modele) => {
      origines.push(origine);
      modeles.embeddings = modele;
    });
    if (texte.etat !== 'ok' || vecteurs.etat !== 'ok') {
      this.#preuve = null;
      const echec = texte.etat !== 'ok' ? texte : vecteurs;
      const code = echec.etat === 'indisponible' ? echec.code : 'reponse_rejetee';
      const s = this.statut();
      return { statut: s.statut, raisons: [...s.raisons, `L’appel de vérification a échoué (${code}).`], preuve: null };
    }
    this.#preuve = {
      verifieeLe: this.#horloge.maintenant().toISOString(),
      urlBase: fournisseur.urlBase ?? '',
      urlsAppelees: origines.map((o) => o.url),
      reponseSimulateur: fournisseur.nature === 'simulateur' || origines.some((o) => o.simulateur),
      modeles,
      dimensionsEmbeddings: vecteurs.dimensions,
    };
    return { ...this.statut(), preuve: this.#preuve };
  }

  /** Complétion à sortie JSON contrainte par schéma, validée puis soumise au garde-fou de la tâche. */
  async completerJson<T>(demande: DemandeJson<T>): Promise<IssueJson<T>> {
    let valeur: T | undefined;
    const pseudonymiseur = demande.pseudonymiseur ?? creerPseudonymiseur(demande.nomsPersonnes);
    const issue = await this.#completer(
      { ...demande, pseudonymiseur, outils: [] },
      { nom: demande.nomSchema, schema: versSchemaJson(demande.schema) },
      (reponse) => {
        if (reponse.contenu === null || reponse.contenu.trim() === '') return { resultat: 'rejet', codes: ['reponse_vide'] };
        const json = lireJson(reponse.contenu);
        if (!json.ok) return { resultat: 'rejet', codes: ['json_invalide'] };
        const lu = demande.schema.safeParse(pseudonymiseur.restaurerProfond(json.valeur));
        if (!lu.success) return { resultat: 'rejet', codes: ['schema_non_respecte'] };
        valeur = lu.data;
        return demande.verifier ? demande.verifier(lu.data) : { resultat: 'ok' };
      },
    );
    if (issue.etat === 'ok') return { etat: 'ok', valeur: valeur as T, modele: issue.modele, traceId: issue.traceId };
    if (issue.etat === 'abstention') return { etat: 'abstention', valeur: valeur as T, code: issue.code, modele: issue.modele, traceId: issue.traceId };
    return issue;
  }

  /**
   * Un tour de conversation avec fonctions déclarées. La passerelle n'exécute RIEN : elle renvoie les appels
   * demandés, que l'appelant valide (liste blanche, schéma, périmètre, habilitations) avant toute exécution.
   */
  async converser(demande: DemandeConversation): Promise<IssueConversation> {
    let tour: TourConversation | undefined;
    const pseudonymiseur = demande.pseudonymiseur ?? creerPseudonymiseur(demande.nomsPersonnes);
    const issue = await this.#completer({ ...demande, pseudonymiseur }, undefined, (reponse) => {
      const appels: AppelFonction[] = reponse.appels.map((a) => {
        const json = lireJson(a.argumentsJson === '' ? '{}' : a.argumentsJson);
        return { id: a.id, nom: a.nom, arguments: json.ok ? pseudonymiseur.restaurerProfond(json.valeur) : undefined, jsonValide: json.ok };
      });
      tour = {
        contenu: reponse.contenu === null ? null : pseudonymiseur.restaurer(reponse.contenu),
        appels,
        messageAssistant: { role: 'assistant', contenu: reponse.contenu, ...(reponse.appels.length > 0 ? { appels: reponse.appels } : {}) },
      };
      return demande.verifier ? demande.verifier(tour) : { resultat: 'ok' };
    });
    if (issue.etat === 'ok') return { etat: 'ok', modele: issue.modele, traceId: issue.traceId, ...(tour as TourConversation) };
    return issue;
  }

  /** Embeddings d'un lot de textes (pseudonymisés avant l'appel). Vérifie nombre et dimension des vecteurs. */
  async vectoriser(demande: DemandeVecteurs): Promise<IssueVecteurs> {
    return this.#vectoriser(demande);
  }

  #demarrer(demande: DemandeBase, operation: Mesure['operation'], modele: string, pseudonymiseur: Pseudonymiseur, aEmpreinter: unknown, tailles: TraceAppelIa['tailles']): Mesure {
    return { debut: this.#horloge.maintenant().getTime(), id: randomUUID(), demande, operation, modele, pseudonymiseur, empreinte: empreinteSha256(JSON.stringify(aEmpreinter)), tailles };
  }

  #tracer(m: Mesure, resultat: ResultatAppel, codes: string[], jetons: { entree: number | null; sortie: number | null }, caracteresSortie: number, appelsFonctions: number): string {
    const maintenant = this.#horloge.maintenant();
    this.#journal.consigner({
      type: 'appel_ia',
      id: m.id,
      horodatage: maintenant.toISOString(),
      tache: m.demande.tache,
      operation: m.operation,
      prompt: m.demande.prompt ? { id: m.demande.prompt.id, version: m.demande.prompt.version } : null,
      fournisseur: this.#fournisseur?.nom ?? null,
      nature: this.#fournisseur?.nature ?? null,
      modele: m.modele,
      contexte: {
        cabinetId: m.demande.contexte.cabinetId,
        dossierId: m.demande.contexte.dossierId ?? null,
        utilisateurId: m.demande.contexte.utilisateurId ?? null,
      },
      empreintePrompt: m.empreinte,
      tailles: { ...m.tailles, caracteresSortie, appelsFonctions },
      pseudonymes: m.pseudonymiseur.decompte(),
      dureeMs: Math.max(0, maintenant.getTime() - m.debut),
      jetons,
      coutEstime: estimerCout(this.#tarifs, m.modele, jetons),
      resultat,
      codes,
    });
    return m.id;
  }

  #echec(m: Mesure, erreur: unknown): IssueIndisponible {
    // Une erreur non typée (bogue d'un fournisseur) n'expose pas son message : il pourrait contenir du contenu.
    const code = erreur instanceof ErreurIa ? erreur.code : 'erreur_inattendue';
    const message = erreur instanceof ErreurIa ? erreur.message : 'Erreur inattendue du fournisseur IA.';
    return { etat: 'indisponible', code, message, traceId: this.#tracer(m, 'erreur', [code], { entree: null, sortie: null }, 0, 0) };
  }

  async #completer(
    demande: DemandeBase & { messages: MessageIa[]; outils: DefinitionOutil[]; choixOutil?: 'auto' | 'required' | 'none'; maxJetonsSortie?: number },
    schemaSortie: { nom: string; schema: Record<string, unknown> } | undefined,
    juger: (reponse: { contenu: string | null; appels: AppelFonctionBrut[]; origine: OrigineReponse; modeleRenvoye: string | null }) => Verdict,
  ): Promise<{ etat: 'ok'; modele: string; traceId: string } | { etat: 'abstention'; code: string; modele: string; traceId: string } | { etat: 'rejet'; codes: string[]; modele: string; traceId: string } | IssueIndisponible> {
    const modele = MODELES_IA.langage.id;
    const pseudonymiseur = demande.pseudonymiseur ?? creerPseudonymiseur(demande.nomsPersonnes);
    const messages: MessageIa[] = demande.messages.map((m) => {
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          contenu: m.contenu === null ? null : pseudonymiseur.pseudonymiser(m.contenu),
          ...(m.appels ? { appels: m.appels.map((a) => ({ ...a, argumentsJson: pseudonymiseur.pseudonymiser(a.argumentsJson) })) } : {}),
        };
      }
      return { ...m, contenu: pseudonymiseur.pseudonymiser(m.contenu) };
    });
    const mesure = this.#demarrer(demande, 'completion', modele, pseudonymiseur, { messages, outils: demande.outils, schemaSortie: schemaSortie ?? null }, {
      messages: messages.length,
      caracteresEntree: tailleMessages(messages),
      caracteresSortie: 0,
      fonctionsDeclarees: demande.outils.length,
      appelsFonctions: 0,
      textes: 0,
    });
    if (this.#fournisseur === null) {
      return { etat: 'indisponible', code: 'non_connecte', message: 'Aucune IA n’est configurée.', traceId: this.#tracer(mesure, 'erreur', ['non_connecte'], { entree: null, sortie: null }, 0, 0) };
    }
    let reponse;
    try {
      reponse = await this.#fournisseur.completer({
        modele,
        messages,
        temperature: MODELES_IA.langage.temperature,
        maxJetonsSortie: Math.min(demande.maxJetonsSortie ?? MODELES_IA.langage.maxJetonsSortie, MODELES_IA.langage.maxJetonsSortie),
        ...(schemaSortie ? { schemaSortie } : {}),
        ...(demande.outils.length > 0 ? { outils: demande.outils, choixOutil: demande.choixOutil ?? 'auto' } : {}),
      });
    } catch (erreur) {
      return this.#echec(mesure, erreur);
    }
    const jetons = { entree: reponse.usage.jetonsEntree, sortie: reponse.usage.jetonsSortie };
    const caracteresSortie = (reponse.contenu?.length ?? 0) + reponse.appels.reduce((n, a) => n + a.argumentsJson.length, 0);
    const clore = (resultat: ResultatAppel, codes: string[]): string => this.#tracer(mesure, resultat, codes, jetons, caracteresSortie, reponse.appels.length);
    if (reponse.modeleRenvoye !== null && reponse.modeleRenvoye.toLowerCase() !== modele.toLowerCase()) {
      return { etat: 'indisponible', code: 'modele_inattendu', message: 'Le fournisseur a répondu avec un autre modèle que le modèle figé.', traceId: clore('erreur', ['modele_inattendu']) };
    }
    let verdict: Verdict;
    if (reponse.raisonFin === 'length') verdict = { resultat: 'rejet', codes: ['sortie_tronquee'] };
    else verdict = juger(reponse);
    if (verdict.resultat === 'ok') return { etat: 'ok', modele, traceId: clore('ok', []) };
    if (verdict.resultat === 'abstention') return { etat: 'abstention', code: verdict.code, modele, traceId: clore('abstention', [verdict.code]) };
    return { etat: 'rejet', codes: verdict.codes, modele, traceId: clore('rejet', verdict.codes) };
  }

  async #vectoriser(demande: DemandeVecteurs, observer?: (origine: OrigineReponse, modele: string | null) => void): Promise<IssueVecteurs> {
    const modele = MODELES_IA.embeddings.id;
    const dimensions = MODELES_IA.embeddings.dimensions;
    const pseudonymiseur = demande.pseudonymiseur ?? creerPseudonymiseur(demande.nomsPersonnes);
    const textes = demande.textes.map((t) => pseudonymiseur.pseudonymiser(t));
    const mesure = this.#demarrer(demande, 'embeddings', modele, pseudonymiseur, { textes }, {
      messages: 0,
      caracteresEntree: textes.reduce((n, t) => n + t.length, 0),
      caracteresSortie: 0,
      fonctionsDeclarees: 0,
      appelsFonctions: 0,
      textes: textes.length,
    });
    if (this.#fournisseur === null) {
      return { etat: 'indisponible', code: 'non_connecte', message: 'Aucune IA n’est configurée.', traceId: this.#tracer(mesure, 'erreur', ['non_connecte'], { entree: null, sortie: null }, 0, 0) };
    }
    if (textes.length === 0) return { etat: 'ok', vecteurs: [], modele, dimensions, traceId: this.#tracer(mesure, 'ok', [], { entree: 0, sortie: null }, 0, 0) };
    let reponse;
    try {
      reponse = await this.#fournisseur.vectoriser({ modele, textes });
    } catch (erreur) {
      return this.#echec(mesure, erreur);
    }
    const jetons = { entree: reponse.usage.jetonsEntree, sortie: null };
    const refuser = (code: string, message: string): IssueIndisponible => ({ etat: 'indisponible', code, message, traceId: this.#tracer(mesure, 'erreur', [code], jetons, 0, 0) });
    if (reponse.modeleRenvoye !== null && reponse.modeleRenvoye.toLowerCase() !== modele.toLowerCase()) {
      return refuser('modele_inattendu', 'Le fournisseur a répondu avec un autre modèle que le modèle figé.');
    }
    if (reponse.vecteurs.length !== textes.length || reponse.vecteurs.some((v) => v.length !== dimensions || v.some((x) => !Number.isFinite(x)))) {
      return refuser('vecteurs_invalides', `Vecteurs inattendus : ${dimensions} dimensions finies attendues, un vecteur par texte.`);
    }
    observer?.(reponse.origine, reponse.modeleRenvoye);
    return { etat: 'ok', vecteurs: reponse.vecteurs, modele, dimensions, traceId: this.#tracer(mesure, 'ok', [], jetons, 0, 0) };
  }
}
