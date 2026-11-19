import { describe, expect, it } from 'vitest';
import { evaluerApplicabilite, type ProfilDossier, schemaCriteresEvolution, texteComparable } from './veille.js';

const profil: ProfilDossier = {
  territoireFiscal: 'metropole',
  regimeFiscal: 'IS',
  formeJuridique: 'SAS',
  codeNaf: '10.71C',
  referentielComptable: 'PCG',
  exercices: [
    { debut: '2024-01-01', fin: '2024-12-31' },
    { debut: '2025-01-01', fin: '2025-12-31' },
  ],
};

describe('evaluerApplicabilite', () => {
  it('explique pourquoi un dossier est concerné, exercice par exercice', () => {
    const r = evaluerApplicabilite(profil, { territoires: ['metropole'], regimesFiscaux: ['IS'], exercicesOuvertsAPartirDu: '2025-01-01' });
    expect(r.statut).toBe('concerne');
    expect(r.exercicesConcernes).toEqual([{ debut: '2025-01-01', fin: '2025-12-31' }]);
    expect(r.raisons.join(' ')).toMatch(/Territoire fiscal du dossier \(metropole\) visé/);
  });
  it('« à confirmer » quand une caractéristique manque — jamais « non concerné » par défaut', () => {
    const r = evaluerApplicabilite({ ...profil, regimeFiscal: null, territoireFiscal: 'a_confirmer' }, { territoires: ['metropole'], regimesFiscaux: ['IS'] });
    expect(r.statut).toBe('a_confirmer');
    expect(r.manquants).toEqual(['Territoire fiscal', 'Régime fiscal']);
    expect(evaluerApplicabilite({ ...profil, exercices: [] }, { exercicesClosAPartirDu: '2025-06-30' }).statut).toBe('a_confirmer');
  });
  it('« non concerné » seulement sur un critère renseigné et non satisfait, même si autre chose manque', () => {
    const r = evaluerApplicabilite({ ...profil, territoireFiscal: 'martinique', regimeFiscal: null }, { territoires: ['metropole'], regimesFiscaux: ['IS'] });
    expect(r.statut).toBe('non_concerne');
    expect(evaluerApplicabilite(profil, { exercicesOuvertsAPartirDu: '2026-01-01' }).statut).toBe('non_concerne');
    expect(evaluerApplicabilite(profil, { formesJuridiques: ['SARL'] }).statut).toBe('non_concerne');
  });
  it('compare les codes NAF par préfixe, sans tenir compte des points ni de la casse', () => {
    expect(evaluerApplicabilite(profil, { prefixesNaf: ['10.7'] }).statut).toBe('concerne');
    expect(evaluerApplicabilite(profil, { prefixesNaf: ['1071c'] }).statut).toBe('concerne');
    expect(evaluerApplicabilite(profil, { prefixesNaf: ['47'] }).statut).toBe('non_concerne');
  });
  it('sans critère, tous les dossiers sont potentiellement concernés, et le dit', () => {
    const r = evaluerApplicabilite(profil, schemaCriteresEvolution.parse({}));
    expect(r.statut).toBe('concerne');
    expect(r.raisons[0]).toMatch(/sans critère restrictif/);
  });
});

describe('texteComparable', () => {
  it('ignore la mise en forme, les scripts et les espaces, mais pas le texte', () => {
    const a = texteComparable('<html><head><style>p{}</style><script>var t=1;</script></head><body><p>Article  1er</p>\n<!-- c --><p>Le taux est de 20&nbsp;%.</p></body></html>');
    expect(a).toBe('Article 1er Le taux est de 20 %.');
    expect(texteComparable('<div><p>Article 1er</p><span>Le taux est de 20 %.</span></div><script>autre()</script>')).toBe(a);
    expect(texteComparable('<p>Article 1er</p><p>Le taux est de 10 %.</p>')).not.toBe(a);
  });
});
