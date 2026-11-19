/**
 * SIMULATEUR DE TEST — ce n'est PAS une IA et ce n'est PAS OVHcloud AI Endpoints.
 *
 * Fournisseur en mémoire, déterministe et scriptable : il rejoue les réponses qu'on lui programme. Il ne
 * « comprend » rien et ne dit rien de la qualité d'un modèle réel.
 * - `nature = 'simulateur'` : la passerelle affiche le statut `simule`, jamais `connecte` ;
 * - sans réponse programmée, il échoue explicitement (aucune réponse inventée) ;
 * - `http()` l'expose au format de l'API compatible OpenAI pour tester l'adaptateur réel ; toutes ces réponses
 *   portent l'en-tête `X-Simulateur: comtaple-ia` ;
 * - il refuse de s'instancier si `NODE_ENV=production` ;
 * - ses « embeddings » sont un hachage de mots : déterministes, sans valeur sémantique.
 */
import { createHash } from 'node:crypto';
import { ErreurIa } from '../erreurs.js';
import type { DemandeCompletion, DemandeEmbeddings, FournisseurIa, ReponseCompletion, ReponseEmbeddings } from '../fournisseur.js';
import { ENTETE_SIMULATEUR, MODELES_IA, NOM_SIMULATEUR } from '../modeles.js';
import type { Http } from '../ports.js';

export type ReponseSimuleeFixe =
  /** Contenu JSON (sérialisé tel quel). */
  | { json: unknown }
  /** Contenu textuel brut (permet de simuler un JSON invalide). */
  | { texte: string; raisonFin?: string }
  /** Appels de fonctions demandés par le « modèle ». */
  | { appels: Array<{ nom: string; arguments: unknown }> }
  /** Panne du fournisseur. */
  | { erreur: Error }
  /** Réponse annonçant un autre modèle que celui demandé. */
  | { json: unknown; modeleRenvoye: string };

/** Réponse fixe, ou fonction de la demande reçue (pour simuler un modèle qui réagit aux données). */
export type ReponseSimulee = ReponseSimuleeFixe | ((demande: DemandeCompletion) => ReponseSimuleeFixe);

export interface PanneHttp {
  statut: number;
  entetes?: Record<string, string>;
  /** Nombre de requêtes concernées (défaut : 1). */
  fois?: number;
}

export class ErreurSimulateurNonProgramme extends ErreurIa {
  constructor() {
    super('simulateur_non_programme', 'SIMULATEUR : aucune réponse programmée pour cette demande.');
  }
}

const estimerJetons = (caracteres: number): number => Math.ceil(caracteres / 4);

export class SimulateurIa implements FournisseurIa {
  readonly nature = 'simulateur' as const;
  readonly nom = `SIMULATEUR (${NOM_SIMULATEUR})`;
  readonly urlBase = null;
  /** Demandes reçues, pour les assertions des tests (contenu déjà pseudonymisé par la passerelle). */
  readonly demandes: DemandeCompletion[] = [];
  readonly demandesEmbeddings: DemandeEmbeddings[] = [];
  #file: ReponseSimulee[] = [];
  #parDefaut: ReponseSimulee | null = null;
  #pannesHttp: PanneHttp[] = [];
  #compteurAppels = 0;

  constructor() {
    if (process.env.NODE_ENV === 'production') throw new Error('SIMULATEUR IA interdit en production.');
  }

  /** Ajoute des réponses à la file : une par appel de complétion, dans l'ordre. */
  programmer(...reponses: ReponseSimulee[]): this {
    this.#file.push(...reponses);
    return this;
  }

  /** Réponse utilisée quand la file est vide. */
  programmerParDefaut(reponse: ReponseSimulee | null): this {
    this.#parDefaut = reponse;
    return this;
  }

  reinitialiser(): this {
    this.#file = [];
    this.#parDefaut = null;
    this.#pannesHttp = [];
    this.demandes.length = 0;
    this.demandesEmbeddings.length = 0;
    return this;
  }

  /** Nombre de réponses programmées non consommées. */
  get restantes(): number {
    return this.#file.length;
  }

  async completer(demande: DemandeCompletion): Promise<ReponseCompletion> {
    this.demandes.push(structuredClone(demande));
    const suivante = this.#file.shift() ?? this.#parDefaut;
    if (suivante === null || suivante === undefined) throw new ErreurSimulateurNonProgramme();
    const r = typeof suivante === 'function' ? suivante(demande) : suivante;
    if ('erreur' in r) throw r.erreur;
    const entree = estimerJetons(JSON.stringify(demande.messages).length);
    const origine = { url: `simulateur://${NOM_SIMULATEUR}/chat/completions`, simulateur: true };
    if ('appels' in r) {
      const appels = r.appels.map((a) => ({ id: `appel_sim_${++this.#compteurAppels}`, nom: a.nom, argumentsJson: JSON.stringify(a.arguments) }));
      const sortie = estimerJetons(appels.reduce((n, a) => n + a.argumentsJson.length, 0));
      return { contenu: null, appels, raisonFin: 'tool_calls', usage: { jetonsEntree: entree, jetonsSortie: sortie }, modeleRenvoye: demande.modele, origine };
    }
    const contenu = 'json' in r ? JSON.stringify(r.json) : r.texte;
    return {
      contenu,
      appels: [],
      raisonFin: 'raisonFin' in r && r.raisonFin !== undefined ? r.raisonFin : 'stop',
      usage: { jetonsEntree: entree, jetonsSortie: estimerJetons(contenu.length) },
      modeleRenvoye: 'modeleRenvoye' in r ? r.modeleRenvoye : demande.modele,
      origine,
    };
  }

  async vectoriser(demande: DemandeEmbeddings): Promise<ReponseEmbeddings> {
    this.demandesEmbeddings.push(structuredClone(demande));
    return {
      vecteurs: demande.textes.map((t) => vecteurSimule(t)),
      usage: { jetonsEntree: estimerJetons(demande.textes.reduce((n, t) => n + t.length, 0)) },
      modeleRenvoye: demande.modele,
      origine: { url: `simulateur://${NOM_SIMULATEUR}/embeddings`, simulateur: true },
    };
  }

  /** Les prochaines requêtes HTTP (voir `http()`) échouent avec ce statut. */
  injecterPanneHttp(...pannes: PanneHttp[]): this {
    this.#pannesHttp.push(...pannes.map((p) => ({ ...p })));
    return this;
  }

  /**
   * Expose le simulateur au format HTTP de l'API compatible OpenAI, pour exercer `FournisseurOvh` sans réseau.
   * Chaque réponse porte l'en-tête `X-Simulateur`.
   */
  http(): Http {
    const entetes = { 'content-type': 'application/json', [ENTETE_SIMULATEUR]: NOM_SIMULATEUR };
    const repondre = (statut: number, corps: unknown, plus: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(corps), { status: statut, headers: { ...entetes, ...plus } });
    return async (url, init) => {
      const panne = this.#pannesHttp[0];
      if (panne) {
        panne.fois = (panne.fois ?? 1) - 1;
        if (panne.fois <= 0) this.#pannesHttp.shift();
        return repondre(panne.statut, { error: { message: 'SIMULATEUR : panne injectée' } }, panne.entetes);
      }
      if (!/^Bearer \S+$/.test(init.headers.authorization ?? '')) return repondre(401, { error: { message: 'SIMULATEUR : jeton absent' } });
      const corps = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      const chemin = new URL(url).pathname;
      try {
        if (chemin.endsWith('/embeddings')) {
          const r = await this.vectoriser({ modele: String(corps.model), textes: corps.input as string[] });
          return repondre(200, { object: 'list', model: r.modeleRenvoye, data: r.vecteurs.map((embedding, index) => ({ object: 'embedding', index, embedding })), usage: { prompt_tokens: r.usage.jetonsEntree } });
        }
        if (chemin.endsWith('/chat/completions')) {
          const r = await this.completer(demandeDepuisOpenAi(corps));
          return repondre(200, {
            object: 'chat.completion',
            model: r.modeleRenvoye,
            choices: [
              {
                index: 0,
                finish_reason: r.raisonFin,
                message: {
                  role: 'assistant',
                  content: r.contenu,
                  ...(r.appels.length > 0 ? { tool_calls: r.appels.map((a) => ({ id: a.id, type: 'function', function: { name: a.nom, arguments: a.argumentsJson } })) } : {}),
                },
              },
            ],
            usage: { prompt_tokens: r.usage.jetonsEntree, completion_tokens: r.usage.jetonsSortie },
          });
        }
      } catch (erreur) {
        if (erreur instanceof ErreurSimulateurNonProgramme) return repondre(400, { error: { message: erreur.message } });
        throw erreur;
      }
      return repondre(404, { error: { message: 'SIMULATEUR : route inconnue' } });
    };
  }
}

function demandeDepuisOpenAi(corps: Record<string, unknown>): DemandeCompletion {
  const messages = (corps.messages as Array<Record<string, unknown>>).map((m): DemandeCompletion['messages'][number] => {
    if (m.role === 'tool') return { role: 'tool', idAppel: String(m.tool_call_id), nom: String(m.name), contenu: String(m.content) };
    if (m.role === 'assistant') {
      const appels = (m.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined)?.map((a) => ({ id: a.id, nom: a.function.name, argumentsJson: a.function.arguments }));
      return { role: 'assistant', contenu: (m.content as string | null) ?? null, ...(appels ? { appels } : {}) };
    }
    return { role: m.role === 'system' ? 'system' : 'user', contenu: String(m.content) };
  });
  const format = corps.response_format as { json_schema?: { name: string; schema: Record<string, unknown> } } | undefined;
  const outils = corps.tools as Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }> | undefined;
  return {
    modele: String(corps.model),
    messages,
    temperature: Number(corps.temperature),
    maxJetonsSortie: Number(corps.max_tokens),
    ...(format?.json_schema ? { schemaSortie: { nom: format.json_schema.name, schema: format.json_schema.schema } } : {}),
    ...(outils ? { outils: outils.map((o) => ({ nom: o.function.name, description: o.function.description, parametres: o.function.parameters })) } : {}),
    ...(typeof corps.tool_choice === 'string' ? { choixOutil: corps.tool_choice as 'auto' | 'required' | 'none' } : {}),
  };
}

/**
 * « Embedding » SIMULÉ : sac de mots haché sur 1024 dimensions, normalisé. Deux textes partageant des mots ont
 * une similarité non nulle ; cela ne reproduit en rien bge-m3.
 */
export function vecteurSimule(texte: string): number[] {
  const dimensions = MODELES_IA.embeddings.dimensions;
  const v = new Array<number>(dimensions).fill(0);
  const mots = texte.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9⟦⟧_]+/g) ?? [];
  for (const mot of mots) {
    const h = createHash('sha256').update(mot).digest();
    const i = h.readUInt32BE(0) % dimensions;
    v[i] = (v[i] ?? 0) + 1;
  }
  const norme = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norme === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norme);
}
