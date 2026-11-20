import { describe, expect, it } from 'vitest';
import {
  appliquerCorrectionDestinataire, destinataireEffectif, destinataireNonLu, fusionnerReanalyseDestinataire, inchangeDepuis, lignesDestinataire, normaliserSaisieDestinataire,
  VERSION_ANALYSEUR_FACTURE,
} from './destinataire-humain.js';
import { champsFactureVides, type ChampExtrait, type ChampsFacture } from './types.js';

const SIREN = '552100554';
const SIRET = '55210055400013';
const TVA = 'FR96552100554';
const champ = <T extends string>(valeur: T): ChampExtrait<T> => ({ valeur, page: 1, extrait: valeur, boite: null, methode: 'regle', confiance: 'non_evaluee' });
const CTX = { auteurId: 'u-1', le: '2026-11-20T10:00:00.000Z', motif: 'Le client est écrit à la main sur la pièce', versionBase: 1, versionNouvelle: 2, versionAnalyseurBase: null };

/** Extraction antérieure à D-084 : aucune clé de destinataire. */
const ancienne = (): Record<string, unknown> => {
  const { destinataireNom, destinataireSiren, destinataireSiret, destinataireTva, destinatairePays, destinataireAbstention, ...reste } = champsFactureVides() as unknown as Record<string, unknown>;
  void [destinataireNom, destinataireSiren, destinataireSiret, destinataireTva, destinatairePays, destinataireAbstention];
  return { ...reste, numero: champ('FA-1'), totalTtc: champ('120.00') };
};
const lue = (surcharge: Partial<ChampsFacture> = {}): ChampsFacture => ({ ...champsFactureVides(), numero: champ('FA-1'), totalTtc: champ('120.00'), ...surcharge });

describe('saisie du destinataire : validation', () => {
  it('normalise les espaces, la casse et vérifie les clés de contrôle', () => {
    const r = normaliserSaisieDestinataire({ destinataireNom: '  Client   Fictif  SAS ', destinataireSiren: '552 100 554', destinataireSiret: '552 100 554 00013', destinataireTva: 'fr96 552 100 554', destinatairePays: 'fr' });
    expect(r.erreurs).toEqual([]);
    expect(r.valeurs).toEqual({ destinataireNom: 'Client Fictif SAS', destinataireSiren: SIREN, destinataireSiret: SIRET, destinataireTva: TVA, destinatairePays: 'FR' });
  });
  it('refuse un SIREN, un SIRET, une TVA française ou un pays invalides, avec un motif en français', () => {
    const r = normaliserSaisieDestinataire({ destinataireSiren: '552100555', destinataireSiret: '12345', destinataireTva: 'FR00552100554', destinatairePays: 'FRA' });
    expect(r.erreurs).toHaveLength(4);
    expect(r.erreurs.join(' ')).toMatch(/SIREN du destinataire/);
    expect(r.erreurs.join(' ')).toMatch(/SIRET du destinataire/);
    expect(r.erreurs.join(' ')).toMatch(/TVA du destinataire/);
    expect(r.erreurs.join(' ')).toMatch(/Pays du destinataire/);
  });
  it('refuse une saisie vide ; accepte l’effacement explicite d’un champ (null)', () => {
    expect(normaliserSaisieDestinataire({}).erreurs).toEqual(['Au moins un champ du destinataire doit être renseigné.']);
    expect(normaliserSaisieDestinataire({ destinataireSiren: null }).valeurs).toEqual({ destinataireSiren: null });
  });
  it('accepte une TVA étrangère de format plausible et une clé française alphanumérique (non vérifiable)', () => {
    expect(normaliserSaisieDestinataire({ destinataireTva: 'BE0123456789' }).erreurs).toEqual([]);
    expect(normaliserSaisieDestinataire({ destinataireTva: 'FRAB552100554' }).erreurs).toEqual([]);
  });
});

describe('correction humaine du destinataire', () => {
  it('pose des champs humains avec provenance, valeur automatique remplacée et abstention levée ; ne modifie pas l’entrée', () => {
    const base = ancienne();
    const copie = JSON.stringify(base);
    const r = appliquerCorrectionDestinataire(base, { destinataireSiren: SIREN, destinataireNom: 'Client Fictif SAS' }, CTX);
    expect(r.erreurs).toEqual([]);
    expect(JSON.stringify(base)).toBe(copie);
    expect(r.modifies).toEqual(['destinataireNom', 'destinataireSiren']);
    expect(r.avant.destinataireSiren).toBeNull();
    expect(r.apres.destinataireSiren).toBe(SIREN);
    expect(r.champs.destinataireSiren).toMatchObject({ valeur: SIREN, methode: 'saisie_humaine', corrigePar: 'u-1', corrigeLe: CTX.le, motif: CTX.motif, automatique: { valeur: null, versionExtraction: null }, desaccord: true });
    expect(r.champs.destinataireAbstention).toBeNull();
    // Les champs non saisis restent, la lecture automatique n'a pas eu lieu : la pièce reste concernée par une réanalyse.
    expect(r.champs.numero).toEqual(base.numero);
    expect(destinataireNonLu(r.champs)).toBe(true);
    expect(inchangeDepuis(r.champs, 2)).toBe(1);
  });
  it('mémorise la valeur automatique qu’elle remplace (version et analyseur), et la conserve à la correction suivante', () => {
    const base = { ...lue({ destinataireSiren: champ('123456782'), destinataireNom: champ('Autre SA') }), inchangeDepuis: 1 } as unknown as Record<string, unknown>;
    const un = appliquerCorrectionDestinataire(base, { destinataireSiren: SIREN }, { ...CTX, versionBase: 3, versionNouvelle: 4, versionAnalyseurBase: '2026-11-20.1' });
    expect(un.champs.destinataireSiren).toMatchObject({ valeur: SIREN, automatique: { valeur: '123456782', versionExtraction: 3, versionAnalyseur: '2026-11-20.1' }, desaccord: true });
    expect(un.champs.destinataireNom).toEqual(base.destinataireNom);
    const deux = appliquerCorrectionDestinataire(un.champs, { destinataireSiren: '732829320' }, { ...CTX, versionBase: 4, versionNouvelle: 5 });
    expect(deux.champs.destinataireSiren).toMatchObject({ valeur: '732829320', automatique: { valeur: '123456782', versionExtraction: 3 } });
  });
  it('effacer toutes les valeurs pose une abstention dite ; incohérence entre identifiants refusée', () => {
    const base = lue({ destinataireSiren: champ(SIREN) }) as unknown as Record<string, unknown>;
    const efface = appliquerCorrectionDestinataire(base, { destinataireSiren: null }, CTX);
    expect(efface.apres.destinataireSiren).toBeNull();
    expect(efface.champs.destinataireAbstention).toMatch(/effacées par une personne/);
    const incoherent = appliquerCorrectionDestinataire(base, { destinataireSiret: '73282932000074' }, CTX);
    expect(incoherent.erreurs.join(' ')).toMatch(/SIRET du destinataire ne commence pas par son SIREN/);
    expect(incoherent.champs).toEqual(base);
  });
  it('une saisie invalide n’applique rien', () => {
    const base = ancienne();
    const r = appliquerCorrectionDestinataire(base, { destinataireSiren: '1' }, CTX);
    expect(r.erreurs.length).toBeGreaterThan(0);
    expect(r.champs).toEqual(base);
    expect(r.modifies).toEqual([]);
  });
  it('lignes côte à côte : valeur automatique et valeur humaine, source et désaccord', () => {
    const base = lue({ destinataireSiren: champ('123456782') }) as unknown as Record<string, unknown>;
    const r = appliquerCorrectionDestinataire(base, { destinataireSiren: SIREN }, CTX);
    const l = lignesDestinataire(r.champs).find((x) => x.champ === 'destinataireSiren')!;
    expect(l).toMatchObject({ effective: SIREN, source: 'humain', automatique: '123456782', humain: SIREN, desaccord: true, corrigePar: 'u-1', motif: CTX.motif });
    expect(lignesDestinataire(base).find((x) => x.champ === 'destinataireSiren')).toMatchObject({ source: 'automatique', automatique: '123456782', humain: null });
    expect(lignesDestinataire(ancienne()).every((x) => x.source === 'non_lu')).toBe(true);
  });
});

describe('réanalyse : fusion de la lecture automatique', () => {
  const CIBLE = { versionNouvelle: 2, versionAnalyseur: VERSION_ANALYSEUR_FACTURE };
  it('destinataire trouvé : repris sur la pièce sans toucher aux autres champs ; divergences des autres champs signalées, non appliquées', () => {
    const anciens = { ...ancienne(), totalTtc: champ('100.00') };
    const r = fusionnerReanalyseDestinataire(anciens, lue({ destinataireSiren: champ(SIREN), destinataireNom: champ('Client'), destinataireAbstention: null, totalTtc: champ('120.00') }), CIBLE);
    expect(r.resultat).toBe('destinataire_trouve');
    expect(r.apres.destinataireSiren).toBe(SIREN);
    expect(r.champs.totalTtc).toEqual(champ('100.00'));
    expect(r.autresDivergences).toEqual(['totalTtc']);
    expect(r.champs.destinataireAbstention).toBeNull();
    expect(destinataireNonLu(r.champs)).toBe(false);
    expect(r.motif).toBeNull();
    expect(inchangeDepuis(r.champs, 2)).toBe(1);
  });
  it('abstention motivée : le motif de l’analyseur est repris', () => {
    const r = fusionnerReanalyseDestinataire(ancienne(), lue({ destinataireAbstention: 'Plusieurs entités nommées : aucun client retenu.' }), CIBLE);
    expect(r.resultat).toBe('abstention');
    expect(r.motif).toBe('Plusieurs entités nommées : aucun client retenu.');
    expect(r.champs.destinataireAbstention).toBe('Plusieurs entités nommées : aucun client retenu.');
  });
  it('déjà lue : rien n’est changé', () => {
    const deja = lue({ destinataireAbstention: 'x' }) as unknown as Record<string, unknown>;
    const r = fusionnerReanalyseDestinataire(deja, lue({ destinataireSiren: champ(SIREN), destinataireAbstention: null }), CIBLE);
    expect(r.resultat).toBe('inchangee');
    expect(r.champs).toEqual(deja);
  });
  it('la correction humaine n’est JAMAIS écrasée : la valeur automatique est mémorisée à côté et le désaccord signalé', () => {
    const corrigee = appliquerCorrectionDestinataire(ancienne(), { destinataireSiren: SIREN, destinataireNom: 'Client Fictif SAS' }, CTX).champs;
    const r = fusionnerReanalyseDestinataire(corrigee, lue({ destinataireSiren: champ('732829320'), destinataireNom: champ('Client Fictif SAS'), destinataireAbstention: null }), CIBLE);
    expect(r.apres.destinataireSiren).toBe(SIREN);
    expect(r.champs.destinataireSiren).toMatchObject({ valeur: SIREN, methode: 'saisie_humaine', corrigePar: 'u-1', automatique: { valeur: '732829320', versionExtraction: 2, versionAnalyseur: VERSION_ANALYSEUR_FACTURE }, desaccord: true });
    expect(r.champs.destinataireNom).toMatchObject({ valeur: 'Client Fictif SAS', desaccord: false });
    expect(r.desaccords).toEqual([{ champ: 'destinataireSiren', humain: SIREN, automatique: '732829320' }]);
    expect(r.champs.destinataireAbstention).toBeNull();
    // Les champs non corrigés suivent la lecture automatique.
    expect(destinataireEffectif(r.champs).destinataireTva).toBeNull();
    expect(destinataireNonLu(r.champs)).toBe(false);
  });
  it('lecture automatique sans destinataire face à une correction humaine : abstention, valeur humaine conservée', () => {
    const corrigee = appliquerCorrectionDestinataire(ancienne(), { destinataireSiren: SIREN }, CTX).champs;
    const r = fusionnerReanalyseDestinataire(corrigee, lue({ destinataireAbstention: 'Aucun repère de client.' }), CIBLE);
    expect(r.resultat).toBe('abstention');
    expect(r.apres.destinataireSiren).toBe(SIREN);
    expect(r.desaccords).toEqual([{ champ: 'destinataireSiren', humain: SIREN, automatique: null }]);
    expect(r.champs.destinataireAbstention).toBeNull();
  });
});
