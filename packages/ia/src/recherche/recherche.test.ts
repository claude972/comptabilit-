import { describe, expect, it } from 'vitest';
import { ErreurIaTemporaire } from '../erreurs.js';
import { CONTEXTE, fauxFournisseurReel, JournalMemoire, monter } from '../essais/outils.js';
import { PasserelleIa } from '../passerelle.js';
import { SimulateurIa } from '../simulateur/index.js';
import { decouperEnPassages, fusionnerClassements, similariteCosinus, vectoriserPassages, vectoriserRequete } from './index.js';

const TEXTE = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i + 1}. La société règle ses fournisseurs à trente jours fin de mois. Les pièces sont transmises chaque mois.`).join('\n\n');

describe('découpage en passages', () => {
  it('est déterministe, respecte la taille et couvre tout le texte avec recouvrement', () => {
    const a = decouperEnPassages('DOC-1', TEXTE, { taille: 300, recouvrement: 60 });
    expect(decouperEnPassages('DOC-1', TEXTE, { taille: 300, recouvrement: 60 })).toEqual(a);
    expect(a.length).toBeGreaterThan(5);
    for (const [i, p] of a.entries()) {
      expect(p.id).toBe(`DOC-1#${i}`);
      expect(p.texte.length).toBeLessThanOrEqual(300);
      expect(TEXTE.slice(p.debut, p.fin)).toBe(p.texte);
      expect(p.empreinte).toMatch(/^[0-9a-f]{64}$/);
      if (i > 0) expect(p.debut).toBeLessThanOrEqual(a[i - 1]!.fin);
    }
    expect(a[0]?.debut).toBe(0);
    expect(a.at(-1)?.fin).toBe(TEXTE.length);
  });
  it('gère texte vide, texte court et paramètres invalides', () => {
    expect(decouperEnPassages('D', '   ')).toEqual([]);
    expect(decouperEnPassages('D', 'Texte court.')).toMatchObject([{ id: 'D#0', debut: 0, fin: 12, texte: 'Texte court.' }]);
    expect(() => decouperEnPassages('D', 'x', { taille: 10 })).toThrow();
    expect(() => decouperEnPassages('D', 'x', { taille: 100, recouvrement: 80 })).toThrow();
  });
});

describe('embeddings par lots', () => {
  it('vectorise par lots via la passerelle et dit quoi stocker', async () => {
    const { passerelle, simulateur, journal } = monter();
    const passages = decouperEnPassages('DOC-1', TEXTE, { taille: 300, recouvrement: 60 });
    const r = await vectoriserPassages(passerelle, passages, CONTEXTE, { tailleLot: 4, decoupage: { taille: 300, recouvrement: 60 } });
    expect(r.etat).toBe('ok');
    if (r.etat !== 'ok') return;
    expect(r.lots).toBe(Math.ceil(passages.length / 4));
    expect(simulateur.demandesEmbeddings.every((d) => d.textes.length <= 4 && d.modele === 'bge-m3')).toBe(true);
    expect(r.passages).toHaveLength(passages.length);
    expect(r.passages[0]).toMatchObject({ id: 'DOC-1#0', modele: 'bge-m3', dimensions: 1024, decoupage: { taille: 300, recouvrement: 60 } });
    expect(r.passages.every((p) => p.vecteur.length === 1024)).toBe(true);
    expect(journal.appels.every((t) => t.tache === 'embeddings_passages' && t.operation === 'embeddings')).toBe(true);
  });
  it('plafonne la taille de lot à 25 et rend les passages déjà faits en cas de panne', async () => {
    const simulateur = new SimulateurIa();
    let appels = 0;
    const fournisseur = { ...fauxFournisseurReel('https://ia.test.invalid/v1', simulateur), vectoriser: async (d: { modele: string; textes: string[] }) => {
      if (++appels === 2) throw new ErreurIaTemporaire(503, null, 3);
      return simulateur.vectoriser(d);
    } };
    const passerelle = new PasserelleIa({ fournisseur, journal: new JournalMemoire() });
    const passages = Array.from({ length: 30 }, (_, i) => decouperEnPassages(`D${i}`, `passage numéro ${i}`)[0]!);
    const r = await vectoriserPassages(passerelle, passages, CONTEXTE, { tailleLot: 500 });
    expect(r).toMatchObject({ etat: 'indisponible', code: 'temporaire' });
    if (r.etat === 'indisponible') expect(r.partiels).toHaveLength(25);
    expect((await vectoriserRequete(new PasserelleIa({ fournisseur: null, journal: new JournalMemoire() }), 'q', CONTEXTE)).etat).toBe('indisponible');
  });
});

describe('fusion de classements (RRF)', () => {
  it('fusionne texte et vecteur, départage de façon déterministe, ignore les doublons', () => {
    const r = fusionnerClassements([['a', 'b', 'c', 'a'], ['c', 'a', 'd']], { k: 60 });
    expect(r.map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(r[0]).toMatchObject({ id: 'a', rangs: [1, 2] });
    expect(r[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(r[3]).toMatchObject({ id: 'd', rangs: [null, 3] });
    expect(fusionnerClassements([['x', 'y'], ['y', 'x']]).map((x) => x.id)).toEqual(['x', 'y']);
    expect(fusionnerClassements([['a', 'b', 'c']], { limite: 2 })).toHaveLength(2);
    expect(fusionnerClassements([])).toEqual([]);
  });
  it('fonctionne de bout en bout avec les vecteurs du simulateur', async () => {
    const { passerelle } = monter();
    const passages = [decouperEnPassages('A', 'Relevé bancaire du mois de mars')[0]!, decouperEnPassages('B', 'Contrat de bail commercial des locaux')[0]!];
    const index = await vectoriserPassages(passerelle, passages, CONTEXTE);
    const requete = await vectoriserRequete(passerelle, 'bail commercial', CONTEXTE);
    if (index.etat !== 'ok' || requete.etat !== 'ok') throw new Error('indisponible');
    const parVecteur = [...index.passages].sort((x, y) => similariteCosinus(requete.vecteur, y.vecteur) - similariteCosinus(requete.vecteur, x.vecteur)).map((p) => p.id);
    expect(fusionnerClassements([['B#0'], parVecteur])[0]?.id).toBe('B#0');
  });
});
