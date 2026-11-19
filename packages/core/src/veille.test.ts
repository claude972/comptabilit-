import { describe, expect, it } from 'vitest';
import { evaluerApplicabilite, identifierOperations, type ProfilDossier, schemaCriteresEvolution, texteComparable } from './veille.js';

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

describe('veille — taille et opérations identifiées', () => {
  const base = { territoireFiscal: 'metropole', regimeFiscal: 'IS', formeJuridique: 'SAS', codeNaf: '10.71C', referentielComptable: 'PCG', exercices: [{ debut: '2025-01-01', fin: '2025-12-31' }] };
  const ex = { debut: '2025-01-01', fin: '2025-12-31' };

  it('taille connue : dans la tranche → concerné ; hors tranche → non concerné ; bornes incluses, comparaison décimale exacte', () => {
    const dedans = evaluerApplicabilite({ ...base, taille: { chiffreAffaires: '1000000.00', totalBilan: '450000.10', effectif: 12, exercice: ex } }, { taille: { chiffreAffairesMin: '1000000', totalBilanMax: '450000.10', effectifMax: 50 } });
    expect(dedans.statut).toBe('concerne');
    expect(dedans.raisons.join(' ')).toContain('avant écritures d’inventaire');
    const dehors = evaluerApplicabilite({ ...base, taille: { chiffreAffaires: '999999.99', totalBilan: '1', effectif: 12, exercice: ex } }, { taille: { chiffreAffairesMin: '1000000' } });
    expect(dehors.statut).toBe('non_concerne');
    expect(dehors.raisons.join(' ')).toContain('hors de la tranche visée');
    expect(evaluerApplicabilite({ ...base, taille: { chiffreAffaires: '0.10', totalBilan: null, effectif: null, exercice: ex } }, { taille: { chiffreAffairesMax: '0.09' } }).statut).toBe('non_concerne');
  });

  it('taille inconnue (pas de données, effectif non renseigné, profil sans taille) : « à confirmer », jamais « non concerné »', () => {
    const r = evaluerApplicabilite({ ...base, taille: { chiffreAffaires: null, totalBilan: null, effectif: null, exercice: null } }, { taille: { chiffreAffairesMin: '50000', effectifMin: 11 } });
    expect(r.statut).toBe('a_confirmer');
    expect(r.manquants).toEqual(['Chiffre d’affaires', 'Effectif']);
    expect(evaluerApplicabilite(base, { taille: { totalBilanMin: '1' } })).toMatchObject({ statut: 'a_confirmer', manquants: ['Total du bilan'] });
  });

  it('une valeur connue hors tranche exclut même si une autre est inconnue', () => {
    const r = evaluerApplicabilite({ ...base, taille: { chiffreAffaires: '10.00', totalBilan: null, effectif: null, exercice: ex } }, { taille: { chiffreAffairesMin: '1000', effectifMin: 11 } });
    expect(r.statut).toBe('non_concerne');
  });

  it('opérations : identifiées par les racines de comptes ; au moins une visée suffit ; aucune → non concerné, avec sa limite dite', () => {
    const ops = identifierOperations(['21830000', '64110000', '44571000', '51200000']);
    expect(ops).toEqual(['immobilisations', 'salaries', 'tva_collectee']);
    const oui = evaluerApplicabilite({ ...base, operations: ops }, { operations: ['emprunts', 'immobilisations'] });
    expect(oui.statut).toBe('concerne');
    expect(oui.raisons.join(' ')).toContain('Indice comptable');
    const non = evaluerApplicabilite({ ...base, operations: ops }, { operations: ['credit_bail'] });
    expect(non.statut).toBe('non_concerne');
    expect(non.raisons.join(' ')).toContain('autres comptes ne serait pas repérée');
  });

  it('opérations sans donnée comptable : « à confirmer » ; critère d’opération inconnu refusé par le schéma', () => {
    expect(evaluerApplicabilite({ ...base, operations: null }, { operations: ['stocks'] })).toMatchObject({ statut: 'a_confirmer', manquants: ['Données comptables'] });
    expect(evaluerApplicabilite(base, { operations: ['stocks'] }).statut).toBe('a_confirmer');
    expect(schemaCriteresEvolution.safeParse({ operations: ['fusion'] }).success).toBe(false);
    expect(schemaCriteresEvolution.safeParse({ taille: { chiffreAffairesMin: 1000 } }).success).toBe(false); // nombre refusé : chaîne décimale exigée
  });
});
