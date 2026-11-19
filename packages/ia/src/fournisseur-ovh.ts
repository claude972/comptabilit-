/**
 * Adaptateur RÉEL d'OVHcloud AI Endpoints (API compatible OpenAI : `/chat/completions`, `/embeddings`).
 *
 * État : écrit d'après la documentation officielle (voir docs/passerelle.md), JAMAIS exercé contre le service
 * réel — aucun jeton n'existe. Les tests l'exercent contre un HTTP injecté et contre le simulateur.
 *
 * - n'émet de requêtes que vers l'URL de base configurée (https obligatoire), sans suivre de redirection ;
 * - délai par tentative, reprises bornées sur 429 / 5xx / réseau / délai, `Retry-After` respecté ;
 * - 401 / 403 et autres 4xx : jamais réessayés ;
 * - aucun secret, prompt ou réponse dans les erreurs ni dans le journal technique.
 */
import { z } from 'zod';
import {
  ErreurIa,
  ErreurIaAuthentification,
  ErreurIaConfiguration,
  ErreurIaDelai,
  ErreurIaHoteInterdit,
  ErreurIaProtocole,
  ErreurIaRequete,
  ErreurIaTemporaire,
} from './erreurs.js';
import type {
  DemandeCompletion,
  DemandeEmbeddings,
  FournisseurIa,
  MessageIa,
  OrigineReponse,
  ReponseCompletion,
  ReponseEmbeddings,
} from './fournisseur.js';
import { ENTETE_SIMULATEUR } from './modeles.js';
import { horlogeSysteme, httpNatif, type Horloge, type Http, type JournalTechnique } from './ports.js';

export interface OptionsRepriseIa {
  /** Nombre total de tentatives (première comprise). */
  tentativesMax: number;
  baseMs: number;
  plafondMs: number;
  /** Au-delà de ce `Retry-After`, on n'attend pas : l'appel échoue et la tâche se replie. */
  attenteMaxMs: number;
}

export const REPRISE_IA_PAR_DEFAUT: OptionsRepriseIa = { tentativesMax: 3, baseMs: 500, plafondMs: 8000, attenteMaxMs: 20_000 };

export interface ConfigurationOvh {
  /** Ex. `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1`. */
  urlBase: string;
  /** Jeton d'accès AI Endpoints (`Authorization: Bearer`). Jamais journalisé. */
  jeton: string;
  /** Délai par tentative. Défaut : 60 s. */
  delaiMs?: number;
  reprise?: Partial<OptionsRepriseIa>;
}

export interface DependancesOvh {
  http?: Http;
  horloge?: Horloge;
  /** Nombre dans [0, 1[ pour la gigue. */
  hasard?: () => number;
  journal?: JournalTechnique;
}

const schemaUsage = z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional() }).optional();

const schemaReponseChat = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(z.object({ id: z.string(), type: z.string().optional(), function: z.object({ name: z.string(), arguments: z.string() }) }))
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: schemaUsage.nullable(),
});

const schemaReponseEmbeddings = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) })),
  usage: schemaUsage.nullable(),
});

function versMessageOpenAi(m: MessageIa): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.idAppel, name: m.nom, content: m.contenu };
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.contenu,
      ...(m.appels && m.appels.length > 0
        ? { tool_calls: m.appels.map((a) => ({ id: a.id, type: 'function', function: { name: a.nom, arguments: a.argumentsJson } })) }
        : {}),
    };
  }
  return { role: m.role, content: m.contenu };
}

function lireRetryAfter(reponse: Response, maintenant: Date): number | null {
  const valeur = reponse.headers.get('retry-after')?.trim();
  if (valeur === undefined) return null;
  if (/^\d+$/.test(valeur)) return Number(valeur) * 1000;
  const date = Date.parse(valeur);
  return Number.isNaN(date) ? null : Math.max(0, date - maintenant.getTime());
}

export class FournisseurOvh implements FournisseurIa {
  readonly nature = 'reel' as const;
  readonly nom = 'ovhcloud-ai-endpoints';
  readonly urlBase: string;
  readonly #jeton: string;
  readonly #delaiMs: number;
  readonly #reprise: OptionsRepriseIa;
  readonly #http: Http;
  readonly #horloge: Horloge;
  readonly #hasard: () => number;
  readonly #journal: JournalTechnique | null;

  constructor(configuration: ConfigurationOvh, dependances: DependancesOvh = {}) {
    let url: URL;
    try {
      url = new URL(configuration.urlBase);
    } catch {
      throw new ErreurIaConfiguration('URL de base du fournisseur IA invalide.');
    }
    if (url.protocol !== 'https:') throw new ErreurIaConfiguration('URL de base du fournisseur IA : https obligatoire.');
    if (url.username !== '' || url.password !== '' || url.search !== '') throw new ErreurIaConfiguration('URL de base du fournisseur IA : ni identifiants ni paramètres.');
    if (configuration.jeton.trim() === '') throw new ErreurIaConfiguration('Jeton du fournisseur IA absent.');
    this.urlBase = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    this.#jeton = configuration.jeton.trim();
    this.#delaiMs = configuration.delaiMs ?? 60_000;
    this.#reprise = { ...REPRISE_IA_PAR_DEFAUT, ...configuration.reprise };
    this.#http = dependances.http ?? httpNatif;
    this.#horloge = dependances.horloge ?? horlogeSysteme;
    this.#hasard = dependances.hasard ?? Math.random;
    this.#journal = dependances.journal ?? null;
  }

  /** Le jeton n'apparaît ni dans `JSON.stringify` ni dans `util.inspect`. */
  toJSON(): Record<string, unknown> {
    return { nom: this.nom, nature: this.nature, urlBase: this.urlBase };
  }

  async completer(demande: DemandeCompletion): Promise<ReponseCompletion> {
    const corps: Record<string, unknown> = {
      model: demande.modele,
      messages: demande.messages.map(versMessageOpenAi),
      temperature: demande.temperature,
      max_tokens: demande.maxJetonsSortie,
      stream: false,
    };
    if (demande.schemaSortie) {
      corps.response_format = { type: 'json_schema', json_schema: { name: demande.schemaSortie.nom, schema: demande.schemaSortie.schema, strict: true } };
    }
    if (demande.outils && demande.outils.length > 0) {
      corps.tools = demande.outils.map((o) => ({ type: 'function', function: { name: o.nom, description: o.description, parameters: o.parametres } }));
      corps.tool_choice = demande.choixOutil ?? 'auto';
    }
    const { json, origine } = await this.#poster('/chat/completions', corps);
    const lu = schemaReponseChat.safeParse(json);
    if (!lu.success) throw new ErreurIaProtocole('Réponse de complétion de forme inattendue.');
    const choix = lu.data.choices[0];
    if (choix === undefined) throw new ErreurIaProtocole('Réponse de complétion sans choix.');
    return {
      contenu: choix.message.content ?? null,
      appels: (choix.message.tool_calls ?? []).map((a) => ({ id: a.id, nom: a.function.name, argumentsJson: a.function.arguments })),
      raisonFin: choix.finish_reason ?? null,
      usage: { jetonsEntree: lu.data.usage?.prompt_tokens ?? null, jetonsSortie: lu.data.usage?.completion_tokens ?? null },
      modeleRenvoye: lu.data.model ?? null,
      origine,
    };
  }

  async vectoriser(demande: DemandeEmbeddings): Promise<ReponseEmbeddings> {
    const { json, origine } = await this.#poster('/embeddings', { model: demande.modele, input: demande.textes });
    const lu = schemaReponseEmbeddings.safeParse(json);
    if (!lu.success) throw new ErreurIaProtocole('Réponse d’embeddings de forme inattendue.');
    if (lu.data.data.length !== demande.textes.length) throw new ErreurIaProtocole('Réponse d’embeddings : nombre de vecteurs différent du nombre de textes.');
    const tries = [...lu.data.data].sort((a, b) => a.index - b.index);
    if (tries.some((d, i) => d.index !== i)) throw new ErreurIaProtocole('Réponse d’embeddings : index incohérents.');
    return {
      vecteurs: tries.map((d) => d.embedding),
      usage: { jetonsEntree: lu.data.usage?.prompt_tokens ?? null },
      modeleRenvoye: lu.data.model ?? null,
      origine,
    };
  }

  async #poster(chemin: string, corps: Record<string, unknown>): Promise<{ json: unknown; origine: OrigineReponse }> {
    const url = `${this.urlBase}${chemin}`;
    if (new URL(url).host !== new URL(this.urlBase).host) throw new ErreurIaHoteInterdit();
    const charge = JSON.stringify(corps);
    let dernierDelai = false;
    for (let tentative = 1; ; tentative++) {
      let reponse: Response | null = null;
      dernierDelai = false;
      try {
        reponse = await this.#http(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.#jeton}` },
          body: charge,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.#delaiMs),
        });
      } catch (erreur) {
        if (erreur instanceof ErreurIa) throw erreur;
        dernierDelai = erreur instanceof Error && (erreur.name === 'TimeoutError' || erreur.name === 'AbortError');
      }
      if (reponse !== null) {
        const statut = reponse.status;
        if (statut >= 200 && statut < 300) {
          let json: unknown;
          try {
            json = await reponse.json();
          } catch {
            throw new ErreurIaProtocole('Réponse du fournisseur IA illisible (JSON attendu).');
          }
          return { json, origine: { url, simulateur: reponse.headers.get(ENTETE_SIMULATEUR) !== null } };
        }
        if (statut !== 429 && !(statut >= 500 && statut <= 504)) {
          await reponse.body?.cancel().catch(() => undefined);
          if (statut === 401 || statut === 403) throw new ErreurIaAuthentification(statut);
          // Une redirection (3xx) n'est jamais suivie : le jeton ne part pas vers un autre hôte.
          throw new ErreurIaRequete(statut);
        }
      }
      const statut = reponse?.status ?? null;
      const retryAfter = reponse ? lireRetryAfter(reponse, this.#horloge.maintenant()) : null;
      await reponse?.body?.cancel().catch(() => undefined);
      if (tentative >= this.#reprise.tentativesMax || (retryAfter !== null && retryAfter > this.#reprise.attenteMaxMs)) {
        if (statut === null && dernierDelai) throw new ErreurIaDelai(tentative);
        throw new ErreurIaTemporaire(statut, retryAfter, tentative);
      }
      const exponentielle = Math.min(this.#reprise.plafondMs, this.#reprise.baseMs * 2 ** (tentative - 1) + Math.floor(this.#hasard() * this.#reprise.baseMs));
      const attente = retryAfter ?? exponentielle;
      this.#journal?.consigner({ type: 'ia.http.reprise', donnees: { chemin, statut, tentative, attenteMs: attente, delaiDepasse: dernierDelai } });
      await this.#horloge.attendre(attente);
    }
  }
}

/**
 * Construit l'adaptateur réel à partir des variables d'environnement de la plateforme.
 * Renvoie `null` (statut `non_connecte`) si l'URL ou le jeton manque.
 */
export function creerFournisseurOvhDepuisEnv(
  env: { IA_OVH_ENDPOINT?: string | undefined; IA_OVH_JETON?: string | undefined },
  dependances: DependancesOvh = {},
): FournisseurOvh | null {
  const urlBase = env.IA_OVH_ENDPOINT?.trim() ?? '';
  const jeton = env.IA_OVH_JETON?.trim() ?? '';
  if (urlBase === '' || jeton === '') return null;
  return new FournisseurOvh({ urlBase, jeton }, dependances);
}
