import { describe, expect, it } from 'vitest';
import { type CitationPortefeuille, lienCitationPortefeuille } from '../../src/lib/assistant';
import { type SuggestionAmelioration, type VueSuggestions, suggestionAPreremplir } from '../../src/lib/regles';

const DOSSIER = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const PIECE = '11111111-2222-4333-8444-555555555555';
const citation = (c: Partial<CitationPortefeuille>): CitationPortefeuille => ({ id: `piece:${PIECE}:p1`, nature: 'piece', libelle: 'facture.pdf — page 1', reference: null, dossierId: DOSSIER, ...c });

describe('lienCitationPortefeuille', () => {
  it('mène à la pièce ou au constat DU dossier de la source', () => {
    expect(lienCitationPortefeuille(citation({}))).toEqual({ href: `/dossiers/${DOSSIER}/pieces/${PIECE}`, externe: false });
    expect(lienCitationPortefeuille(citation({ id: `constat:${PIECE}`, nature: 'constat' }))).toEqual({ href: `/dossiers/${DOSSIER}/revision/constats/${PIECE}`, externe: false });
  });

  it('sans dossier, ou avec un dossier qui n’est pas un identifiant : aucun lien (jamais d’adresse fabriquée)', () => {
    expect(lienCitationPortefeuille(citation({ dossierId: null }))).toBeNull();
    expect(lienCitationPortefeuille(citation({ dossierId: '../administration' }))).toBeNull();
    expect(lienCitationPortefeuille(citation({ dossierId: `${DOSSIER}/../x` }))).toBeNull();
  });

  it('écriture et calcul du moteur : référence seule ; source officielle : lien externe https uniquement', () => {
    expect(lienCitationPortefeuille(citation({ id: 'ecriture:x', nature: 'ecriture' }))).toBeNull();
    expect(lienCitationPortefeuille(citation({ id: 'indicateur:x:SIG-CA', nature: 'resultat_moteur' }))).toBeNull();
    const officielle = { id: 'source:x', nature: 'source_officielle' as const, dossierId: null };
    expect(lienCitationPortefeuille(citation({ ...officielle, reference: { titre: 'BOFiP', url: 'https://bofip.impots.gouv.fr/x', dateVersion: null } }))).toEqual({ href: 'https://bofip.impots.gouv.fr/x', externe: true });
    expect(lienCitationPortefeuille(citation({ ...officielle, reference: { titre: 'x', url: 'javascript:alert(1)', dateVersion: null } }))).toBeNull();
  });
});

describe('suggestionAPreremplir', () => {
  const suggestion = (s: Partial<SuggestionAmelioration>): SuggestionAmelioration => ({
    empreinte: `exception_dossier|TIE-002|${DOSSIER}`, categorie: 'exception_dossier', titre: 't', constat: 'c', critere: 'k', controleId: 'TIE-002', dossierIds: [DOSSIER], dossiers: [{ id: DOSSIER, nom: 'D' }], portee: 'dossier',
    proposable: true, renvoi: null, parametre: null, proposition: { controleId: 'TIE-002', entiteId: DOSSIER, parametres: { seuil: '120.00' }, motif: 'm' },
    preuves: { decomptes: {}, periode: null, decisions: [], decisionsNonListees: 0 }, neFaitPas: [], dejaEcartee: null, ...s,
  });
  const vue = (suggestions: SuggestionAmelioration[]): VueSuggestions => ({ criteres: { version: '1.0.0', statut: 's', fenetreMois: 24 }, suggestions, ecarteesMaintenues: [], dejaEnCours: [], sansDecision: false, perimetre: { dossiers: 1, fenetreMois: 24, mention: '', plafondsAtteints: [] } });

  it('seule une suggestion EN COURS et proposable pré-remplit le formulaire', () => {
    const s = suggestion({});
    expect(suggestionAPreremplir(vue([s]), s.empreinte)).toBe(s);
    expect(suggestionAPreremplir(vue([s]), 'exception_dossier|TIE-002|autre')).toBeNull();
    expect(suggestionAPreremplir(vue([s]), undefined)).toBeNull();
    expect(suggestionAPreremplir(null, s.empreinte)).toBeNull();
  });

  it('une suggestion non proposable (réglementaire, signalement) ne pré-remplit rien, même désignée par l’adresse', () => {
    const reglementaire = suggestion({ empreinte: 'modification_regle_reglementaire|TRE-001', categorie: 'modification_regle_reglementaire', proposable: false, proposition: null, renvoi: 'veille' });
    expect(suggestionAPreremplir(vue([reglementaire]), reglementaire.empreinte)).toBeNull();
    const incoherente = suggestion({ proposable: false });
    expect(suggestionAPreremplir(vue([incoherente]), incoherente.empreinte)).toBeNull();
  });
});
