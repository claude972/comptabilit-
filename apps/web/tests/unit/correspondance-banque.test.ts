import { describe, expect, it } from 'vitest';
import { preparerProposition } from '@/lib/correspondance-banque';

describe('saisie d’une correspondance comptes 512 / comptes bancaires', () => {
  it('ne retient que les comptes associés, triés, avec le motif nettoyé', () => {
    expect(preparerProposition({ '51210000': 'bbb', '51200000': 'aaa', '51220000': '' }, '  Deux comptes distincts ')).toEqual({
      erreurs: [],
      corps: { correspondances: [{ compteNum: '51200000', compteBancaireRef: 'aaa' }, { compteNum: '51210000', compteBancaireRef: 'bbb' }], motif: 'Deux comptes distincts' },
    });
  });
  it('refuse une saisie vide, un compte bancaire utilisé deux fois, un motif absent', () => {
    expect(preparerProposition({ '51200000': '' }, 'Motif valable').erreurs).toEqual(['Associez au moins un compte de banque à un compte bancaire.']);
    expect(preparerProposition({ '51200000': 'aaa', '51210000': 'aaa' }, 'Motif valable').erreurs).toEqual(['Un même compte bancaire ne peut pas être associé à deux comptes comptables.']);
    expect(preparerProposition({ '51200000': 'aaa' }, ' abc ')).toEqual({ erreurs: ['Indiquez le motif de cette correspondance (5 caractères au moins).'], corps: null });
  });
});
