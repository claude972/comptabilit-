import type { AccesBd } from '@comtaple/db';
import type { EvenementAuditIa, FournisseurIa } from '@comtaple/ia';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { assemblerIa, creerIa, JournalIaBd, lireTarifsIa } from './ia.js';

/** Base factice : enregistre les lignes qu'on lui demande d'insérer (aucune base réelle dans ce test unitaire). */
function fausseBd() {
  const lots: Array<{ contexte: unknown; lignes: unknown[] }> = [];
  const bd = {
    avecContexte: async (contexte: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ insert: () => ({ values: async (lignes: unknown[]) => void lots.push({ contexte, lignes }) }) }),
  } as unknown as AccesBd;
  return { bd, lots };
}
const contexte = { cabinetId: 'c1', dossierId: 'd1', utilisateurId: 'u1' };
const appel = (nature: 'reel' | 'simulateur' | null): EvenementAuditIa => ({
  type: 'appel_ia', id: 't1', horodatage: '2026-11-19T10:00:00.000Z', tache: 'assistant', operation: 'completion', prompt: { id: 'p', version: '1.0.0' }, fournisseur: nature ? 'f' : null, nature, modele: 'm',
  contexte, empreintePrompt: 'abc', tailles: { messages: 2, caracteresEntree: 10, caracteresSortie: 0, fonctionsDeclarees: 1, appelsFonctions: 0, textes: 0 },
  pseudonymes: {} as never, dureeMs: 12, jetons: { entree: nature ? 5 : null, sortie: null }, coutEstime: nature === 'reel' ? { montant: '0.000012', devise: 'EUR', tarifsRelevesLe: '2026-11-19' } : null,
  resultat: nature ? 'ok' : 'erreur', codes: nature ? [] : ['non_connecte'],
});
const fonction = (mode: 'ia' | 'sans_ia'): EvenementAuditIa => ({ type: 'fonction_metier', id: 't2', horodatage: '2026-11-19T10:00:00.000Z', tache: 'assistant', fonction: 'lireBalance', mode, issue: 'refusee', code: 'dossier_hors_perimetre', contexte, tailles: { arguments: 3, elements: 0, elementsEcartes: 0 } });

describe('tarifs IA', () => {
  it('vide : aucun tarif, donc aucun coût estimé', () => {
    expect(lireTarifsIa({ IA_TARIFS: '' })).toBeNull();
    expect(lireTarifsIa({ IA_TARIFS: '   ' })).toBeNull();
  });
  it('lit des tarifs datés, et refuse une valeur illisible sans la reproduire', () => {
    const tarifs = { relevesLe: '2026-11-19', devise: 'EUR', source: 'catalogue', parMillionDeJetons: { m: { entree: '0.09', sortie: '0.28' } } };
    expect(lireTarifsIa({ IA_TARIFS: JSON.stringify(tarifs) })).toEqual(tarifs);
    expect(() => lireTarifsIa({ IA_TARIFS: '{secret' })).toThrow(/^Configuration invalide : IA_TARIFS n’est pas un objet JSON\.$/);
    expect(() => lireTarifsIa({ IA_TARIFS: JSON.stringify({ ...tarifs, relevesLe: 'hier', cle: 'secret-xyz' }) })).toThrow(/IA_TARIFS/);
    try {
      lireTarifsIa({ IA_TARIFS: JSON.stringify({ ...tarifs, devise: 'secret-xyz' }) });
    } catch (e) {
      expect(String(e)).not.toContain('secret-xyz');
    }
  });
});

describe('journal d’audit IA', () => {
  it('sans fournisseur, un appel est compté « sans_ia » et « indisponible », jamais comme un appel réel', () => {
    const j = new JournalIaBd(fausseBd().bd, null);
    expect(j.ligne(appel(null))).toMatchObject({ cabinetId: 'c1', entiteIdCible: 'd1', utilisateurId: 'u1', type: 'appel_ia', nature: 'sans_ia', resultat: 'indisponible', codes: ['non_connecte'], coutEstime: null });
    expect(j.ligne(fonction('sans_ia'))).toMatchObject({ type: 'fonction_metier', nature: 'sans_ia', resultat: 'refusee', codes: ['dossier_hors_perimetre'], modele: null });
  });
  it('un appel au simulateur est étiqueté « simulateur » ; un appel réel porte son coût estimé', () => {
    const sim = new JournalIaBd(fausseBd().bd, 'simulateur');
    expect(sim.ligne(appel('simulateur'))).toMatchObject({ nature: 'simulateur', resultat: 'ok', jetonsEntree: 5 });
    expect(sim.ligne(fonction('ia'))).toMatchObject({ nature: 'simulateur' });
    expect(sim.ligne(fonction('sans_ia'))).toMatchObject({ nature: 'sans_ia' });
    const reel = new JournalIaBd(fausseBd().bd, 'reel');
    expect(reel.ligne(appel('reel'))).toMatchObject({ nature: 'reel', coutEstime: '0.000012', devise: 'EUR' });
  });
  it('écrit les événements par contexte et attend la fin des écritures', async () => {
    const { bd, lots } = fausseBd();
    const j = new JournalIaBd(bd, null);
    j.consigner(appel(null));
    j.consigner(fonction('sans_ia'));
    j.consigner({ ...fonction('sans_ia'), contexte: { ...contexte, cabinetId: 'c2' } });
    await j.vider();
    expect(lots.map((l) => [l.contexte, l.lignes.length])).toEqual([[{ cabinetId: 'c1', utilisateurId: 'u1' }, 2], [{ cabinetId: 'c2', utilisateurId: 'u1' }, 1]]);
    await j.vider();
    expect(lots).toHaveLength(2);
  });
  it('une écriture en échec ne lève pas', async () => {
    const bd = { avecContexte: async () => Promise.reject(Object.assign(new Error('refus'), { code: '42501' })) } as unknown as AccesBd;
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const j = new JournalIaBd(bd, null);
    j.consigner(appel(null));
    await expect(j.vider()).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledWith('[ia] trace d’audit non enregistrée : 42501');
    erreur.mockRestore();
  });
});

describe('assemblage de la passerelle', () => {
  it('sans jeton : « non_connecte », aucun modèle utilisable', () => {
    const ia = creerIa({ IA_OVH_ENDPOINT: '', IA_OVH_JETON: '', IA_TARIFS: '' }, fausseBd().bd);
    expect(ia.statut().statut).toBe('non_connecte');
    expect(ia.natureFournisseur).toBeNull();
    expect(ia.modeleUtilisable()).toBe(false);
    expect(ia.active()).toBe(ia.passerelle);
  });
  it('fournisseur configuré mais NON vérifié : jamais sollicité par une tâche', async () => {
    const completer = vi.fn();
    const fournisseur = { nature: 'reel', nom: 'essai', urlBase: 'https://exemple.invalid/v1', completer, vectoriser: vi.fn() } as unknown as FournisseurIa;
    const ia = assemblerIa(fausseBd().bd, fournisseur, null);
    expect(ia.statut().statut).toBe('configure_non_verifie');
    expect(ia.modeleUtilisable()).toBe(false);
    expect(ia.active()).not.toBe(ia.passerelle);
    const issue = await ia.active().completerJson({ tache: 'essai', prompt: null, contexte: { cabinetId: 'c1' }, messages: [{ role: 'user', contenu: 'x' }], schema: z.strictObject({ a: z.string() }), nomSchema: 'essai' });
    expect(issue).toMatchObject({ etat: 'indisponible', code: 'non_connecte' });
    expect(completer).not.toHaveBeenCalled();
    await ia.journal.vider();
  });
});
