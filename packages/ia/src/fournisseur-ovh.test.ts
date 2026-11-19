import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ErreurIaAuthentification, ErreurIaConfiguration, ErreurIaDelai, ErreurIaProtocole, ErreurIaRequete, ErreurIaTemporaire } from './erreurs.js';
import { HorlogeSimulee, JournalMemoire } from './essais/outils.js';
import { creerFournisseurOvhDepuisEnv, FournisseurOvh } from './fournisseur-ovh.js';
import { MODELES_IA, URL_BASE_OVH } from './modeles.js';
import { PasserelleIa } from './passerelle.js';
import type { Http, InitHttp } from './ports.js';
import { SimulateurIa } from './simulateur/index.js';

const JETON = 'jeton-ultra-secret-123';
const URL_TEST = 'https://ia.test.invalid/v1';

function monter(http: Http, reprise = {}) {
  const horloge = new HorlogeSimulee();
  const evenements: Array<{ type: string; donnees?: Record<string, unknown> }> = [];
  const fournisseur = new FournisseurOvh({ urlBase: URL_TEST, jeton: JETON, reprise }, { http, horloge, hasard: () => 0, journal: { consigner: (e) => void evenements.push(e) } });
  return { fournisseur, horloge, evenements };
}

const demande = { modele: MODELES_IA.langage.id, messages: [{ role: 'user' as const, contenu: 'Bonjour' }], temperature: 0, maxJetonsSortie: 50 };

describe('FournisseurOvh — format des requêtes', () => {
  it('appelle /chat/completions au format compatible OpenAI (sortie structurée, fonctions, messages d’outil)', async () => {
    const vues: Array<{ url: string; init: InitHttp }> = [];
    const simulateur = new SimulateurIa().programmer({ appels: [{ nom: 'lireBalance', arguments: { comptePrefixe: '512' } }] }, { json: { ok: true } });
    const http: Http = async (url, init) => {
      vues.push({ url, init });
      return simulateur.http()(url, init);
    };
    const { fournisseur } = monter(http);
    const outils = [{ nom: 'lireBalance', description: 'Lit la balance', parametres: { type: 'object', properties: {}, additionalProperties: false } }];
    const r1 = await fournisseur.completer({ ...demande, outils, choixOutil: 'required' });
    expect(r1.appels).toEqual([{ id: 'appel_sim_1', nom: 'lireBalance', argumentsJson: '{"comptePrefixe":"512"}' }]);
    expect(r1.raisonFin).toBe('tool_calls');
    const r2 = await fournisseur.completer({
      ...demande,
      messages: [...demande.messages, { role: 'assistant', contenu: null, appels: r1.appels }, { role: 'tool', idAppel: 'appel_sim_1', nom: 'lireBalance', contenu: '{}' }],
      schemaSortie: { nom: 'reponse', schema: { type: 'object' } },
    });
    expect(r2.contenu).toBe('{"ok":true}');
    expect(r2.usage.jetonsEntree).toBeGreaterThan(0);
    expect(r2.origine).toEqual({ url: `${URL_TEST}/chat/completions`, simulateur: true });

    const [premiere, seconde] = vues;
    expect(premiere?.url).toBe(`${URL_TEST}/chat/completions`);
    expect(premiere?.init.headers.authorization).toBe(`Bearer ${JETON}`);
    expect(premiere?.init.redirect).toBe('manual');
    const corps1 = JSON.parse(premiere?.init.body ?? '{}');
    expect(corps1).toMatchObject({ model: 'Mistral-Small-3.2-24B-Instruct-2506', temperature: 0, max_tokens: 50, stream: false, tool_choice: 'required' });
    expect(corps1.tools[0]).toEqual({ type: 'function', function: { name: 'lireBalance', description: 'Lit la balance', parameters: outils[0]?.parametres } });
    const corps2 = JSON.parse(seconde?.init.body ?? '{}');
    expect(corps2.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'reponse', schema: { type: 'object' }, strict: true } });
    expect(corps2.messages[1]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'appel_sim_1', type: 'function', function: { name: 'lireBalance', arguments: '{"comptePrefixe":"512"}' } }] });
    expect(corps2.messages[2]).toEqual({ role: 'tool', tool_call_id: 'appel_sim_1', name: 'lireBalance', content: '{}' });
  });

  it('appelle /embeddings et remet les vecteurs dans l’ordre des textes', async () => {
    const http: Http = async () =>
      new Response(JSON.stringify({ model: 'bge-m3', data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 7 } }), { status: 200 });
    const r = await monter(http).fournisseur.vectoriser({ modele: 'bge-m3', textes: ['a', 'b'] });
    expect(r.vecteurs).toEqual([[1, 0], [0, 1]]);
    expect(r.usage.jetonsEntree).toBe(7);
    expect(r.origine.simulateur).toBe(false);
  });

  it('refuse une configuration sans https, avec identifiants dans l’URL ou sans jeton', () => {
    expect(() => new FournisseurOvh({ urlBase: 'http://ia.test.invalid/v1', jeton: JETON })).toThrow(ErreurIaConfiguration);
    expect(() => new FournisseurOvh({ urlBase: 'https://u:p@ia.test.invalid/v1', jeton: JETON })).toThrow(ErreurIaConfiguration);
    expect(() => new FournisseurOvh({ urlBase: URL_TEST, jeton: '  ' })).toThrow(ErreurIaConfiguration);
    expect(creerFournisseurOvhDepuisEnv({ IA_OVH_ENDPOINT: '', IA_OVH_JETON: '' })).toBeNull();
    expect(creerFournisseurOvhDepuisEnv({ IA_OVH_ENDPOINT: URL_BASE_OVH, IA_OVH_JETON: JETON })?.urlBase).toBe(URL_BASE_OVH);
  });
});

describe('FournisseurOvh — reprises et erreurs', () => {
  it('reprend sur 429 puis 503 et réussit à la troisième tentative, en respectant Retry-After', async () => {
    const simulateur = new SimulateurIa().programmer({ json: { ok: 1 } }).injecterPanneHttp({ statut: 429, entetes: { 'retry-after': '2' } }, { statut: 503 });
    const { fournisseur, horloge, evenements } = monter(simulateur.http());
    const r = await fournisseur.completer(demande);
    expect(r.contenu).toBe('{"ok":1}');
    expect(horloge.attentes).toEqual([2000, 1000]);
    expect(evenements.map((e) => e.donnees?.statut)).toEqual([429, 503]);
  });

  it('abandonne après le nombre maximal de tentatives avec une erreur typée', async () => {
    const simulateur = new SimulateurIa().injecterPanneHttp({ statut: 500, fois: 10 });
    const { fournisseur, horloge } = monter(simulateur.http());
    const erreur = await fournisseur.completer(demande).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurIaTemporaire);
    expect(erreur).toMatchObject({ code: 'temporaire', statutHttp: 500, tentatives: 3 });
    expect(horloge.attentes).toHaveLength(2);
  });

  it('n’attend pas un Retry-After excessif', async () => {
    const simulateur = new SimulateurIa().injecterPanneHttp({ statut: 429, entetes: { 'retry-after': '3600' } });
    const { fournisseur, horloge } = monter(simulateur.http());
    await expect(fournisseur.completer(demande)).rejects.toMatchObject({ code: 'temporaire', reprendreApresMs: 3_600_000, tentatives: 1 });
    expect(horloge.attentes).toEqual([]);
  });

  it('ne réessaie ni un 401, ni un 400, ni une redirection', async () => {
    for (const [statut, classe] of [[401, ErreurIaAuthentification], [403, ErreurIaAuthentification], [400, ErreurIaRequete], [302, ErreurIaRequete]] as const) {
      let appels = 0;
      const http: Http = async () => {
        appels += 1;
        return new Response(statut === 302 ? null : '{"error":{"message":"refus"}}', { status: statut, headers: statut === 302 ? { location: 'https://ailleurs.invalid/' } : {} });
      };
      await expect(monter(http).fournisseur.completer(demande)).rejects.toBeInstanceOf(classe);
      expect(appels).toBe(1);
    }
  });

  it('reprend sur délai dépassé et erreur réseau, puis lève une erreur de délai', async () => {
    let appels = 0;
    const http: Http = async () => {
      appels += 1;
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    };
    await expect(monter(http).fournisseur.completer(demande)).rejects.toBeInstanceOf(ErreurIaDelai);
    expect(appels).toBe(3);
    const reseau: Http = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(monter(reseau).fournisseur.vectoriser({ modele: 'bge-m3', textes: ['a'] })).rejects.toMatchObject({ code: 'temporaire', statutHttp: null });
  });

  it('signale une réponse de forme inattendue', async () => {
    const http: Http = async () => new Response('{"choices":[]}', { status: 200 });
    await expect(monter(http).fournisseur.completer(demande)).rejects.toBeInstanceOf(ErreurIaProtocole);
    const html: Http = async () => new Response('<html>', { status: 200 });
    await expect(monter(html).fournisseur.completer(demande)).rejects.toBeInstanceOf(ErreurIaProtocole);
    const manque: Http = async () => new Response('{"data":[{"index":0,"embedding":[1]}]}', { status: 200 });
    await expect(monter(manque).fournisseur.vectoriser({ modele: 'bge-m3', textes: ['a', 'b'] })).rejects.toBeInstanceOf(ErreurIaProtocole);
  });

  it('ne laisse fuir le jeton ni dans les erreurs, ni dans le journal, ni à la sérialisation', async () => {
    const simulateur = new SimulateurIa().injecterPanneHttp({ statut: 500, fois: 10 });
    const { fournisseur, evenements } = monter(simulateur.http());
    const erreur = (await fournisseur.completer({ ...demande, messages: [{ role: 'user', contenu: 'CONTENU-CONFIDENTIEL' }] }).catch((e: unknown) => e)) as Error;
    const tout = [erreur.message, erreur.stack ?? '', JSON.stringify(erreur), JSON.stringify(evenements), JSON.stringify(fournisseur), inspect(fournisseur, { depth: 5, showHidden: true })].join('\n');
    expect(tout).not.toContain(JETON);
    expect(tout).not.toContain('CONFIDENTIEL');
  });
});

describe('statut de connexion avec l’adaptateur réel', () => {
  it('reste « configure_non_verifie » quand les réponses viennent du simulateur HTTP', async () => {
    const simulateur = new SimulateurIa().programmer({ texte: 'OK' });
    const fournisseur = new FournisseurOvh({ urlBase: URL_BASE_OVH, jeton: JETON }, { http: simulateur.http() });
    const passerelle = new PasserelleIa({ fournisseur, journal: new JournalMemoire() });
    expect(passerelle.statut().statut).toBe('configure_non_verifie');
    const verification = await passerelle.verifierConnexion({ cabinetId: 'CAB-1' });
    expect(verification.statut).toBe('configure_non_verifie');
    expect(verification.raisons).toContain('La réponse provient du simulateur de test.');
    expect(verification.preuve?.reponseSimulateur).toBe(true);
  });

  it('devient « connecte » seulement après un appel réussi sur l’hôte officiel, sans marque de simulateur', async () => {
    const repondre = (corps: unknown): Response => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
    // HTTP factice SANS en-tête de simulateur : imite ce que renverrait l'hôte officiel (aucun appel réseau réel).
    const http: Http = async (url) =>
      url.endsWith('/embeddings')
        ? repondre({ model: 'bge-m3', data: [{ index: 0, embedding: new Array(1024).fill(0.5) }], usage: { prompt_tokens: 3 } })
        : repondre({ model: 'Mistral-Small-3.2-24B-Instruct-2506', choices: [{ finish_reason: 'stop', message: { content: 'OK' } }], usage: { prompt_tokens: 9, completion_tokens: 1 } });
    const journal = new JournalMemoire();
    const passerelle = new PasserelleIa({ fournisseur: new FournisseurOvh({ urlBase: URL_BASE_OVH, jeton: JETON }, { http }), journal });
    expect(passerelle.statut().statut).toBe('configure_non_verifie');
    const v = await passerelle.verifierConnexion({ cabinetId: 'CAB-1' });
    expect(v).toMatchObject({ statut: 'connecte', raisons: [] });
    expect(passerelle.statut().statut).toBe('connecte');
    expect(journal.appels.map((t) => [t.tache, t.operation, t.resultat])).toEqual([['verification_connexion', 'completion', 'ok'], ['verification_connexion', 'embeddings', 'ok']]);
    // La même preuve sur un autre hôte ne vaut rien.
    const ailleurs = new PasserelleIa({ fournisseur: new FournisseurOvh({ urlBase: URL_TEST, jeton: JETON }, { http }), journal, preuveConnexion: v.preuve });
    expect(ailleurs.statut().statut).toBe('configure_non_verifie');
    expect((await ailleurs.verifierConnexion({ cabinetId: 'CAB-1' })).raisons).toContain('L’hôte appelé n’est pas l’hôte officiel du fournisseur.');
  });
});
