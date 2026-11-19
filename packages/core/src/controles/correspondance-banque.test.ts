import { describe, expect, it } from 'vitest';
import { cleCompteBancaire, etatCorrespondanceBanque, masquerCompteBancaire, verifierCorrespondances } from './correspondance-banque.js';

const A = 'FR7630006000011234567890189';
const B = 'FR7610278060610001020480101';

describe('correspondance comptes 512 / comptes bancaires', () => {
  it('clé d’un compte bancaire : IBAN sans espaces en majuscules, à défaut identifiant', () => {
    expect(cleCompteBancaire({ iban: 'fr76 3000 6000 0112 3456 7890 189', identifiant: 'x' })).toBe(A);
    expect(cleCompteBancaire({ iban: null, identifiant: ' cpt 42 ' })).toBe('CPT42');
    expect(cleCompteBancaire({ iban: null, identifiant: null })).toBe('');
  });

  it('un seul compte de chaque côté : association d’office, sans rien saisir', () => {
    expect(etatCorrespondanceBanque(['51200000'], [A], [])).toEqual({ etat: 'determinee', motif: null, comptes: [{ compteNum: '51200000', etat: 'associe_d_office', compteBancaire: A }], comptesBancairesLibres: [] });
  });

  it('plusieurs comptes sans correspondance : indéterminée, rien n’est deviné', () => {
    const e = etatCorrespondanceBanque(['51200000', '51210000'], [A, B], []);
    expect(e.etat).toBe('indeterminee');
    expect(e.comptes.every((c) => c.etat === 'non_associe' && c.compteBancaire === null)).toBe(true);
    expect(e.comptesBancairesLibres).toEqual([B, A].sort());
    // Deux comptes 512 pour un seul compte bancaire : pas d'association d'office non plus.
    expect(etatCorrespondanceBanque(['51200000', '51210000'], [A], []).etat).toBe('indeterminee');
  });

  it('correspondance complète : déterminée ; partielle, sans relevé ou en double : indéterminée, compte par compte', () => {
    const complete = etatCorrespondanceBanque(['51200000', '51210000'], [A, B], [{ compteNum: '51200000', compteBancaire: A }, { compteNum: '51210000', compteBancaire: 'fr76 1027 8060 6100 0102 0480 101' }]);
    expect(complete).toMatchObject({ etat: 'determinee', motif: null, comptesBancairesLibres: [] });
    expect(complete.comptes).toEqual([{ compteNum: '51200000', etat: 'associe', compteBancaire: A }, { compteNum: '51210000', etat: 'associe', compteBancaire: B }]);
    const partielle = etatCorrespondanceBanque(['51200000', '51210000'], [A, B], [{ compteNum: '51200000', compteBancaire: A }]);
    expect(partielle.etat).toBe('indeterminee');
    expect(partielle.comptes[1]).toEqual({ compteNum: '51210000', etat: 'non_associe', compteBancaire: null });
    expect(partielle.comptesBancairesLibres).toEqual([B]);
    expect(partielle.motif).toMatch(/51210000/);
    expect(etatCorrespondanceBanque(['51200000'], [A], [{ compteNum: '51200000', compteBancaire: 'FR00INCONNU' }]).comptes[0]!.etat).toBe('associe_sans_releve');
    expect(etatCorrespondanceBanque(['51200000'], [A, B], [{ compteNum: '51200000', compteBancaire: A }, { compteNum: '51200000', compteBancaire: B }]).comptes[0]!.etat).toBe('associe_plusieurs_fois');
  });

  it('absence de données : dite, jamais présentée comme favorable', () => {
    expect(etatCorrespondanceBanque([], [A], [])).toMatchObject({ etat: 'aucun_compte_512', comptesBancairesLibres: [A] });
    expect(etatCorrespondanceBanque(['51200000'], [], [])).toMatchObject({ etat: 'aucun_releve', comptes: [{ compteNum: '51200000', etat: 'non_associe', compteBancaire: null }] });
  });

  it('une proposition n’est recevable que sur des comptes existants, un pour un', () => {
    expect(verifierCorrespondances(['51200000', '51210000'], [A, B], [{ compteNum: '51210000', compteBancaire: B }, { compteNum: ' 51200000 ', compteBancaire: 'fr76 3000 6000 0112 3456 7890 189' }])).toEqual({
      erreurs: [],
      correspondances: [{ compteNum: '51200000', compteBancaire: A }, { compteNum: '51210000', compteBancaire: B }],
    });
    expect(verifierCorrespondances(['51200000'], [A], []).erreurs).toEqual(['Aucune correspondance proposée.']);
    expect(verifierCorrespondances(['51200000'], [A], [{ compteNum: '40100000', compteBancaire: A }]).erreurs[0]).toMatch(/40100000 n’est pas un compte de banque/);
    const inconnu = verifierCorrespondances(['51200000'], [A], [{ compteNum: '51200000', compteBancaire: B }]).erreurs[0]!;
    expect(inconnu).toMatch(/ne figure dans aucun relevé actif/);
    expect(inconnu).not.toContain(B); // le compte bancaire n'est jamais écrit en clair dans un message
    expect(inconnu).toContain('0101');
    const doubles = verifierCorrespondances(['51200000', '51210000'], [A, B], [{ compteNum: '51200000', compteBancaire: A }, { compteNum: '51210000', compteBancaire: A }, { compteNum: '51200000', compteBancaire: B }]).erreurs;
    expect(doubles.some((e) => /51200000 est associé plusieurs fois/.test(e))).toBe(true);
    expect(doubles.some((e) => /associé à plusieurs comptes comptables/.test(e))).toBe(true);
  });

  it('masquage : quatre derniers caractères seulement', () => {
    expect(masquerCompteBancaire(A)).toBe('••••••••0189');
    expect(masquerCompteBancaire('1234')).toBe('1234');
  });
});
