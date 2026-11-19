import type { Config } from './config.js';

/**
 * Passerelle IA interne unique. Fournisseur prévu : OVHcloud AI Endpoints (API compatible OpenAI).
 * Identifiants de modèles FIGÉS (aucun alias susceptible de changer de modèle en production).
 * Présence et tarifs vérifiés au catalogue public le 2026-11-19 ; région de traitement, conservation des requêtes
 * et conditions contractuelles NON vérifiées : la passerelle ne doit pas être activée avant.
 *
 * État : adaptateur écrit, JAMAIS exercé contre le service réel (aucun jeton fourni). Aucun traitement ne l'appelle.
 */
export const MODELES_IA = {
  langage: { id: 'Mistral-Small-3.2-24B-Instruct-2506', temperature: 0, maxTokensSortie: 1024 },
  embeddings: { id: 'bge-m3', dimensions: 1024 },
} as const;

export type StatutIa = 'non_connecte' | 'configure_non_verifie';

export class PasserelleIa {
  constructor(private readonly cfg: Pick<Config, 'IA_OVH_ENDPOINT' | 'IA_OVH_JETON'>) {}

  /** Jamais « connecté » ici : ce statut exigera un appel réel réussi et une évaluation sur corpus métier. */
  statut(): StatutIa {
    return this.cfg.IA_OVH_ENDPOINT && this.cfg.IA_OVH_JETON ? 'configure_non_verifie' : 'non_connecte';
  }

  /**
   * Complétion de texte. L'appelant fournit des messages déjà minimisés et pseudonymisés ; les contenus de pièces
   * y figurent comme données délimitées, jamais comme instructions. Lève si la passerelle n'est pas configurée.
   */
  async completer(messages: Array<{ role: 'system' | 'user'; content: string }>, options: { schemaJson?: Record<string, unknown> } = {}): Promise<string> {
    if (this.statut() === 'non_connecte') throw new Error('Passerelle IA non connectée');
    const r = await fetch(`${this.cfg.IA_OVH_ENDPOINT.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.IA_OVH_JETON}` },
      body: JSON.stringify({
        model: MODELES_IA.langage.id,
        temperature: MODELES_IA.langage.temperature,
        max_tokens: MODELES_IA.langage.maxTokensSortie,
        messages,
        ...(options.schemaJson ? { response_format: { type: 'json_schema', json_schema: { name: 'reponse', schema: options.schemaJson, strict: true } } } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`Passerelle IA : HTTP ${r.status}`);
    const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const texte = d.choices?.[0]?.message?.content;
    if (typeof texte !== 'string') throw new Error('Passerelle IA : réponse inattendue');
    return texte;
  }
}
