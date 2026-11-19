import { describe, expect, it } from 'vitest';
import { construirePromptAssistant, PROMPT_ASSISTANT } from '../assistant/repondre.js';
import { empreinteSha256 } from '../audit.js';
import { fauxFournisseurReel } from '../essais/outils.js';
import { SimulateurIa } from '../simulateur/index.js';
import { construirePromptClasserPiece, PROMPT_CLASSER_PIECE, schemaEntreeClasserPiece } from '../taches/classer-piece.js';
import { construirePromptConstat, PROMPT_CONSTAT, schemaEntreeConstat } from '../taches/constat.js';
import { construirePromptIndicateurs, PROMPT_INDICATEURS, schemaEntreeIndicateurs } from '../taches/indicateurs.js';
import { construirePromptLettreMission, PROMPT_LETTRE_MISSION, schemaEntreeLettreMission } from '../taches/lettre-mission.js';
import { construirePromptRapprochements, PROMPT_RAPPROCHEMENTS, schemaEntreeRapprochements } from '../taches/rapprochements.js';
import { CORPUS_ASSISTANT, CORPUS_CLASSER_PIECE, CORPUS_CONSTAT, CORPUS_INDICATEURS, CORPUS_LETTRE_MISSION, CORPUS_RAPPROCHEMENTS } from './corpus/index.js';
import { EMPREINTES_PROMPTS } from './corpus/empreintes.js';
import { AVERTISSEMENT_SIMULATEUR, evaluer, formaterRapport, type JeuEvaluation, type TacheEvaluable } from './harnais.js';
import { evaluationAssistant, evaluationClasserPiece, evaluationConstat, evaluationIndicateurs, evaluationLettreMission, evaluationRapprochements } from './taches.js';

const JEUX = [
  [evaluationClasserPiece, CORPUS_CLASSER_PIECE, { rejets: 2, abstentions: 2 }],
  [evaluationRapprochements, CORPUS_RAPPROCHEMENTS, { rejets: 1, abstentions: 1 }],
  [evaluationLettreMission, CORPUS_LETTRE_MISSION, { rejets: 2, abstentions: 0 }],
  [evaluationIndicateurs, CORPUS_INDICATEURS, { rejets: 2, abstentions: 1 }],
  [evaluationConstat, CORPUS_CONSTAT, { rejets: 3, abstentions: 0 }],
  [evaluationAssistant, CORPUS_ASSISTANT, { rejets: 1, abstentions: 1 }],
] as unknown as Array<[TacheEvaluable<unknown>, JeuEvaluation<unknown>, { rejets: number; abstentions: number }]>;

describe('harnais d’évaluation contre le SIMULATEUR (non-régression des prompts et garde-fous)', () => {
  it.each(JEUX)('$nom : tous les cas du corpus synthétique donnent l’issue attendue', async (tache, jeu, attendu) => {
    const rapport = await evaluer(tache, jeu, new SimulateurIa());
    expect(formaterRapport(rapport), formaterRapport(rapport)).not.toContain('ÉCART');
    expect(rapport).toMatchObject({ tache: jeu.tache, versionCorpus: jeu.version, nature: 'simulateur', total: jeu.cas.length, exacts: jeu.cas.length, erreurs: 0, exactitude: 1, indisponibles: 0, ...attendu });
    expect(rapport.appelsTraces).toBeGreaterThanOrEqual(jeu.cas.length);
  });

  it('le rapport dit en toutes lettres qu’il est mesuré contre un simulateur', async () => {
    const rapport = await evaluer(evaluationConstat, CORPUS_CONSTAT, new SimulateurIa());
    expect(rapport.avertissement).toBe('mesuré contre un SIMULATEUR : ne dit rien de la qualité du modèle réel');
    expect(AVERTISSEMENT_SIMULATEUR).toBe(rapport.avertissement);
    const texte = formaterRapport(rapport);
    expect(texte).toContain('ATTENTION : mesuré contre un SIMULATEUR : ne dit rien de la qualité du modèle réel.');
    expect(texte).toContain('rejets par garde-fou : 3');
  });

  it('compte les erreurs quand le résultat diffère de l’attendu, et les éléments écartés', async () => {
    const faux: JeuEvaluation<(typeof CORPUS_RAPPROCHEMENTS.cas)[number]['entree']> = {
      ...CORPUS_RAPPROCHEMENTS,
      cas: [{ ...CORPUS_RAPPROCHEMENTS.cas[1]!, attendu: { issue: 'propose', cle: { retenues: [], ecartees: 0 } } }, { ...CORPUS_RAPPROCHEMENTS.cas[3]!, attendu: { issue: 'propose' } }],
    };
    const rapport = await evaluer(evaluationRapprochements, faux, new SimulateurIa());
    expect(rapport).toMatchObject({ total: 2, exacts: 0, erreurs: 2, exactitude: 0, abstentions: 1, elementsEcartes: 1 });
    expect(formaterRapport(rapport)).toContain('ÉCART RA-04 : attendu propose, obtenu abstention');
  });

  it('avec un fournisseur non programmable, ignore les réponses simulées et compte les indisponibilités', async () => {
    const reel = fauxFournisseurReel('https://ia.test.invalid/v1', new SimulateurIa());
    const rapport = await evaluer(evaluationConstat, CORPUS_CONSTAT, reel);
    expect(rapport).toMatchObject({ nature: 'reel', indisponibles: 4, exacts: 0 });
    expect(rapport.avertissement).toContain('corpus SYNTHÉTIQUE');
    await expect(evaluer(evaluationConstat, CORPUS_INDICATEURS as never, new SimulateurIa())).rejects.toThrow(/ne correspond pas/);
  });
});

describe('prompts versionnés', () => {
  it('toute modification d’un prompt impose de changer sa version (empreinte de référence par version)', () => {
    const actuelles = {
      [`${PROMPT_CLASSER_PIECE.id}@${PROMPT_CLASSER_PIECE.version}`]: construirePromptClasserPiece(schemaEntreeClasserPiece.parse(CORPUS_CLASSER_PIECE.cas[0]!.entree)),
      [`${PROMPT_RAPPROCHEMENTS.id}@${PROMPT_RAPPROCHEMENTS.version}`]: construirePromptRapprochements(schemaEntreeRapprochements.parse(CORPUS_RAPPROCHEMENTS.cas[0]!.entree)),
      [`${PROMPT_LETTRE_MISSION.id}@${PROMPT_LETTRE_MISSION.version}`]: construirePromptLettreMission(schemaEntreeLettreMission.parse(CORPUS_LETTRE_MISSION.cas[0]!.entree)),
      [`${PROMPT_INDICATEURS.id}@${PROMPT_INDICATEURS.version}`]: construirePromptIndicateurs(schemaEntreeIndicateurs.parse(CORPUS_INDICATEURS.cas[0]!.entree)),
      [`${PROMPT_CONSTAT.id}@${PROMPT_CONSTAT.version}`]: construirePromptConstat(schemaEntreeConstat.parse(CORPUS_CONSTAT.cas[0]!.entree)),
      [`${PROMPT_ASSISTANT.id}@${PROMPT_ASSISTANT.version}`]: construirePromptAssistant({ question: CORPUS_ASSISTANT.cas[0]!.entree.question, perimetre: CORPUS_ASSISTANT.cas[0]!.entree.perimetre }),
    };
    const empreintes = Object.fromEntries(Object.entries(actuelles).map(([cle, messages]) => [cle, empreinteSha256(JSON.stringify(messages))]));
    expect(empreintes).toEqual(EMPREINTES_PROMPTS);
  });
});
