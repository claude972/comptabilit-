import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { estimerCout, type TarifsIa } from './audit.js';
import { ErreurIaTemporaire } from './erreurs.js';
import { CONTEXTE, fauxFournisseurReel, JournalMemoire, monter } from './essais/outils.js';
import { MODELES_IA, URL_BASE_OVH } from './modeles.js';
import { PasserelleIa } from './passerelle.js';
import { creerPseudonymiseur } from './pseudonymisation.js';
import { SimulateurIa } from './simulateur/index.js';
import { evaluerStatutIa } from './statut.js';

const schema = z.strictObject({ reponse: z.string(), n: z.number().int().optional() });
const base = { tache: 'essai', prompt: { id: 'essai', version: '1.0.0' }, contexte: CONTEXTE, schema, nomSchema: 'essai' };
const TARIFS: TarifsIa = { relevesLe: '2026-11-19', devise: 'EUR', source: 'tarifs de test', parMillionDeJetons: { [MODELES_IA.langage.id]: { entree: '0.09', sortie: '0.28' } } };

describe('PasserelleIa — statuts', () => {
  it('non_connecte sans fournisseur : résultat « indisponible » explicite, tracé, sans exception', async () => {
    const journal = new JournalMemoire();
    const passerelle = new PasserelleIa({ fournisseur: null, journal });
    expect(passerelle.statut().statut).toBe('non_connecte');
    const r = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }] });
    expect(r).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
    expect((await passerelle.vectoriser({ tache: 'e', prompt: null, contexte: CONTEXTE, textes: ['a'] })).etat).toBe('indisponible');
    expect(journal.appels.map((t) => [t.resultat, t.codes])).toEqual([['erreur', ['non_connecte']], ['erreur', ['non_connecte']]]);
    expect((await passerelle.verifierConnexion(CONTEXTE)).statut).toBe('non_connecte');
  });

  it('le simulateur donne « simule » et jamais « connecte », même après vérification ou avec une preuve forgée', async () => {
    const { passerelle, simulateur } = monter();
    expect(passerelle.statut().statut).toBe('simule');
    simulateur.programmer({ texte: 'OK' });
    const v = await passerelle.verifierConnexion(CONTEXTE);
    expect(v.statut).toBe('simule');
    const forgee = { verifieeLe: '2026-11-19T00:00:00Z', urlBase: URL_BASE_OVH, urlsAppelees: [`${URL_BASE_OVH}/chat/completions`], reponseSimulateur: false, modeles: { langage: MODELES_IA.langage.id, embeddings: 'bge-m3' }, dimensionsEmbeddings: 1024 };
    expect(evaluerStatutIa(simulateur, forgee).statut).toBe('simule');
    expect(new PasserelleIa({ fournisseur: simulateur, journal: new JournalMemoire(), preuveConnexion: forgee }).statut().statut).toBe('simule');
  });

  it('distingue configure_non_verifie et connecte selon la preuve (hôte, modèles, dimensions, simulateur)', () => {
    const reel = { nature: 'reel' as const, urlBase: URL_BASE_OVH };
    const preuve = { verifieeLe: '2026-11-19T00:00:00Z', urlBase: URL_BASE_OVH, urlsAppelees: [`${URL_BASE_OVH}/chat/completions`, `${URL_BASE_OVH}/embeddings`], reponseSimulateur: false, modeles: { langage: MODELES_IA.langage.id, embeddings: 'bge-m3' }, dimensionsEmbeddings: 1024 };
    expect(evaluerStatutIa(null, preuve).statut).toBe('non_connecte');
    expect(evaluerStatutIa(reel, null).statut).toBe('configure_non_verifie');
    expect(evaluerStatutIa(reel, preuve)).toEqual({ statut: 'connecte', raisons: [] });
    expect(evaluerStatutIa(reel, { ...preuve, reponseSimulateur: true }).statut).toBe('configure_non_verifie');
    expect(evaluerStatutIa(reel, { ...preuve, urlsAppelees: ['https://mandataire.invalid/v1/chat/completions'] }).statut).toBe('configure_non_verifie');
    expect(evaluerStatutIa(reel, { ...preuve, modeles: { langage: 'mistral-small-latest', embeddings: 'bge-m3' } }).statut).toBe('configure_non_verifie');
    expect(evaluerStatutIa(reel, { ...preuve, dimensionsEmbeddings: 768 }).statut).toBe('configure_non_verifie');
    expect(evaluerStatutIa({ nature: 'reel', urlBase: 'http://oai.endpoints.kepler.ai.cloud.ovh.net/v1' }, { ...preuve, urlBase: 'http://oai.endpoints.kepler.ai.cloud.ovh.net/v1' }).statut).toBe('configure_non_verifie');
  });

  it('un échec de vérification laisse « configure_non_verifie » et efface la preuve', async () => {
    const simulateur = new SimulateurIa().programmer({ erreur: new ErreurIaTemporaire(503, null, 3) });
    const passerelle = new PasserelleIa({ fournisseur: fauxFournisseurReel(URL_BASE_OVH, simulateur), journal: new JournalMemoire() });
    const v = await passerelle.verifierConnexion(CONTEXTE);
    expect(v.statut).toBe('configure_non_verifie');
    expect(v.preuve).toBeNull();
    expect(v.raisons.at(-1)).toContain('temporaire');
  });
});

describe('PasserelleIa — complétion JSON', () => {
  it('impose le modèle figé, la température et le schéma de sortie', async () => {
    const { passerelle, simulateur } = monter();
    simulateur.programmer({ json: { reponse: 'ok' } });
    const r = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }], maxJetonsSortie: 999_999 });
    expect(r).toMatchObject({ etat: 'ok', valeur: { reponse: 'ok' }, modele: 'Mistral-Small-3.2-24B-Instruct-2506' });
    const demande = simulateur.demandes[0];
    expect(demande).toMatchObject({ modele: 'Mistral-Small-3.2-24B-Instruct-2506', temperature: 0, maxJetonsSortie: 2048 });
    expect(demande?.schemaSortie).toMatchObject({ nom: 'essai', schema: { type: 'object', additionalProperties: false, required: ['reponse'] } });
  });

  it('pseudonymise avant l’appel et restaure localement dans la réponse', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmer((d) => {
      const vu = d.messages.map((m) => m.contenu).join(' ');
      return { json: { reponse: `Écrire à ${/⟦EMAIL_\d+⟧/.exec(vu)?.[0]} (${/⟦PERSONNE_\d+⟧/.exec(vu)?.[0]})` } };
    });
    const r = await passerelle.completerJson({
      ...base,
      nomsPersonnes: ['Claire Petit'],
      messages: [{ role: 'user', contenu: 'Claire Petit <claire.petit@exemple.fr>, IBAN FR76 3000 6000 0112 3456 7890 189' }],
    });
    const envoye = JSON.stringify(simulateur.demandes);
    for (const secret of ['Claire', 'Petit', 'claire.petit', 'FR76', '7890']) expect(envoye).not.toContain(secret);
    expect(r).toMatchObject({ etat: 'ok', valeur: { reponse: 'Écrire à claire.petit@exemple.fr (Claire Petit)' } });
    expect(journal.appels[0]?.pseudonymes).toMatchObject({ IBAN: 1, EMAIL: 1, PERSONNE: 1 });
  });

  it('produit une trace d’audit sans aucun contenu, avec empreinte, tailles, durée, jetons et coût estimé daté', async () => {
    const { passerelle, simulateur, journal, horloge } = monter({ tarifs: TARIFS });
    simulateur.programmer(() => {
      horloge.avancer(1234);
      return { json: { reponse: 'REPONSE-SECRETE' } };
    });
    await passerelle.completerJson({ ...base, messages: [{ role: 'system', contenu: 'CONSIGNE-SECRETE' }, { role: 'user', contenu: 'QUESTION-SECRETE' }] });
    const trace = journal.appels[0];
    expect(trace).toMatchObject({
      type: 'appel_ia',
      tache: 'essai',
      operation: 'completion',
      prompt: { id: 'essai', version: '1.0.0' },
      nature: 'simulateur',
      modele: 'Mistral-Small-3.2-24B-Instruct-2506',
      contexte: { cabinetId: 'CAB-1', dossierId: 'D-ALPHA', utilisateurId: 'U-1' },
      dureeMs: 1234,
      resultat: 'ok',
      codes: [],
      coutEstime: { devise: 'EUR', tarifsRelevesLe: '2026-11-19' },
    });
    expect(trace?.empreintePrompt).toMatch(/^[0-9a-f]{64}$/);
    expect(trace?.tailles).toMatchObject({ messages: 2, caracteresEntree: 32, caracteresSortie: 29 });
    expect(trace?.jetons.entree).toBeGreaterThan(0);
    expect(JSON.stringify(journal.evenements)).not.toMatch(/SECRETE/);
  });

  it('donne la même empreinte pour le même prompt et une autre si le prompt change', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmerParDefaut({ json: { reponse: 'ok' } });
    await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'a' }] });
    await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'a' }] });
    await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'b' }] });
    const [e1, e2, e3] = journal.appels.map((t) => t.empreintePrompt);
    expect(e1).toBe(e2);
    expect(e3).not.toBe(e1);
  });

  it('estime le coût en arithmétique exacte et ne l’invente pas sans tarif ni décompte', () => {
    expect(estimerCout(TARIFS, MODELES_IA.langage.id, { entree: 1_000_000, sortie: 500_000 })).toEqual({ montant: '0.230000', devise: 'EUR', tarifsRelevesLe: '2026-11-19' });
    expect(estimerCout(TARIFS, MODELES_IA.langage.id, { entree: 1234, sortie: 56 })?.montant).toBe('0.000127');
    expect(estimerCout(TARIFS, MODELES_IA.langage.id, { entree: null, sortie: null })).toBeNull();
    expect(estimerCout(TARIFS, 'bge-m3', { entree: 10, sortie: null })).toBeNull();
    expect(estimerCout(null, MODELES_IA.langage.id, { entree: 10, sortie: 1 })).toBeNull();
  });

  it('rejette JSON invalide, schéma non respecté, réponse vide et sortie tronquée', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmer({ texte: 'pas du json' }, { json: { reponse: 'ok', intrus: true } }, { texte: '' }, { texte: '{"reponse":"ok"', raisonFin: 'length' }, { texte: '```json\n{"reponse":"ok"}\n```' });
    const issues = [];
    for (let i = 0; i < 5; i++) issues.push(await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }] }));
    expect(issues.map((i) => (i.etat === 'rejet' ? i.codes[0] : i.etat))).toEqual(['json_invalide', 'schema_non_respecte', 'reponse_vide', 'sortie_tronquee', 'ok']);
    expect(journal.appels.map((t) => t.resultat)).toEqual(['rejet', 'rejet', 'rejet', 'rejet', 'ok']);
  });

  it('applique le garde-fou de la tâche : abstention et rejet sont tracés comme tels', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmerParDefaut({ json: { reponse: 'x' } });
    const a = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }], verifier: () => ({ resultat: 'abstention', code: 'doute' }) });
    const r = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }], verifier: () => ({ resultat: 'rejet', codes: ['chiffre_non_source'] }) });
    expect(a).toMatchObject({ etat: 'abstention', code: 'doute' });
    expect(r).toMatchObject({ etat: 'rejet', codes: ['chiffre_non_source'] });
    expect(journal.appels.map((t) => [t.resultat, t.codes])).toEqual([['abstention', ['doute']], ['rejet', ['chiffre_non_source']]]);
  });

  it('une panne du fournisseur donne « indisponible » sans exception ni fuite de message non typé', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmer({ erreur: new ErreurIaTemporaire(503, null, 3) }, { erreur: new Error('détail interne avec CONTENU') });
    const r1 = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }] });
    const r2 = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }] });
    expect(r1).toMatchObject({ etat: 'indisponible', code: 'temporaire' });
    expect(r2).toMatchObject({ etat: 'indisponible', code: 'erreur_inattendue', message: 'Erreur inattendue du fournisseur IA.' });
    expect(journal.appels.map((t) => t.resultat)).toEqual(['erreur', 'erreur']);
  });

  it('refuse une réponse produite par un autre modèle que le modèle figé', async () => {
    const { passerelle, simulateur, journal } = monter();
    simulateur.programmer({ json: { reponse: 'ok' }, modeleRenvoye: 'mistral-small-latest' });
    const r = await passerelle.completerJson({ ...base, messages: [{ role: 'user', contenu: 'x' }] });
    expect(r).toMatchObject({ etat: 'indisponible', code: 'modele_inattendu' });
    expect(journal.appels[0]?.codes).toEqual(['modele_inattendu']);
  });
});

describe('PasserelleIa — conversation et embeddings', () => {
  it('renvoie les appels de fonctions sans rien exécuter, arguments restaurés', async () => {
    const { passerelle, simulateur } = monter();
    const pseudonymiseur = creerPseudonymiseur();
    simulateur.programmer((d) => ({ appels: [{ nom: 'chercher', arguments: { requete: /⟦EMAIL_1⟧/.exec(d.messages[0]?.contenu ?? '')?.[0] } }] }));
    const outils = [{ nom: 'chercher', description: 'd', parametres: { type: 'object' } }];
    const tour = await passerelle.converser({ tache: 'assistant', prompt: null, contexte: CONTEXTE, pseudonymiseur, messages: [{ role: 'user', contenu: 'trouve a@b.fr' }], outils, choixOutil: 'required' });
    expect(tour).toMatchObject({ etat: 'ok', contenu: null, appels: [{ nom: 'chercher', arguments: { requete: 'a@b.fr' }, jsonValide: true }] });
    expect(simulateur.demandes[0]).toMatchObject({ choixOutil: 'required', outils });
    if (tour.etat === 'ok') expect(JSON.stringify(tour.messageAssistant)).not.toContain('a@b.fr');
  });

  it('vérifie le nombre et la dimension des vecteurs et pseudonymise les textes', async () => {
    const { passerelle, simulateur, journal } = monter();
    const r = await passerelle.vectoriser({ tache: 'embeddings', prompt: null, contexte: CONTEXTE, textes: ['contact a@b.fr', 'autre'] });
    expect(r).toMatchObject({ etat: 'ok', modele: 'bge-m3', dimensions: 1024 });
    if (r.etat === 'ok') expect(r.vecteurs.map((v) => v.length)).toEqual([1024, 1024]);
    expect(simulateur.demandesEmbeddings[0]?.textes[0]).toBe('contact ⟦EMAIL_1⟧');
    expect(journal.appels[0]).toMatchObject({ operation: 'embeddings', modele: 'bge-m3', resultat: 'ok', tailles: { textes: 2 } });

    const court = new PasserelleIa({ fournisseur: { ...fauxFournisseurReel(URL_BASE_OVH, simulateur), vectoriser: async () => ({ vecteurs: [[1, 2, 3]], usage: { jetonsEntree: 1 }, modeleRenvoye: 'bge-m3', origine: { url: 'x', simulateur: false } }) }, journal });
    expect(await court.vectoriser({ tache: 'e', prompt: null, contexte: CONTEXTE, textes: ['a'] })).toMatchObject({ etat: 'indisponible', code: 'vecteurs_invalides' });
  });
});

describe('SimulateurIa', () => {
  it('s’annonce comme simulateur, échoue sans réponse programmée et refuse la production', async () => {
    const s = new SimulateurIa();
    expect(s.nature).toBe('simulateur');
    expect(s.nom).toContain('SIMULATEUR');
    await expect(s.completer({ modele: 'm', messages: [], temperature: 0, maxJetonsSortie: 1 })).rejects.toMatchObject({ code: 'simulateur_non_programme' });
    const avant = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new SimulateurIa()).toThrow(/interdit en production/);
    } finally {
      process.env.NODE_ENV = avant;
    }
  });
});
