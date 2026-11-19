import { describe, expect, it } from 'vitest';
import { contientJeton, creerPseudonymiseur } from './pseudonymisation.js';

describe('pseudonymisation', () => {
  const texte = [
    'Virement de Jean DUPONT (jean.dupont@exemple.fr, 06 12 34 56 78) depuis FR76 3000 6000 0112 3456 7890 189.',
    'Société SIREN 732 829 320, SIRET 73282932000074, TVA FR44732829320. Contact : Mme Martin au +33 1 23 45 67 89.',
  ].join('\n');

  it('masque IBAN, e-mail, téléphones, SIREN, SIRET, TVA et noms fournis', () => {
    const p = creerPseudonymiseur(['Jean Dupont', 'Martin']);
    const masque = p.pseudonymiser(texte);
    for (const secret of ['FR76', '3456 7890', 'jean.dupont', 'exemple.fr', '06 12 34', '732 829 320', '73282932000074', 'FR44732829320', 'DUPONT', 'Martin', '+33 1 23']) {
      expect(masque).not.toContain(secret);
    }
    expect(masque).toContain('⟦IBAN_1⟧');
    expect(masque).toContain('⟦EMAIL_1⟧');
    expect(masque).toContain('⟦TEL_1⟧');
    expect(masque).toContain('⟦TEL_2⟧');
    expect(masque).toContain('⟦SIREN_1⟧');
    expect(masque).toContain('⟦SIRET_1⟧');
    expect(masque).toContain('⟦TVA_1⟧');
    expect(masque).toContain('⟦PERSONNE_1⟧');
    expect(p.decompte()).toEqual({ IBAN: 1, EMAIL: 1, TEL: 2, SIRET: 1, SIREN: 1, TVA: 1, PERSONNE: 2 });
  });

  it('est réversible localement (aller-retour exact)', () => {
    const p = creerPseudonymiseur(['Jean Dupont', 'Martin']);
    expect(p.restaurer(p.pseudonymiser(texte))).toBe(texte);
  });

  it('donne des jetons stables : même valeur, même jeton, quelle que soit la présentation', () => {
    const p = creerPseudonymiseur();
    const a = p.pseudonymiser('IBAN FR76 3000 6000 0112 3456 7890 189');
    const b = p.pseudonymiser('iban compact FR7630006000011234567890189 puis contact@exemple.fr et CONTACT@EXEMPLE.FR');
    expect(a).toContain('⟦IBAN_1⟧');
    expect(b).toContain('⟦IBAN_1⟧');
    expect(b.match(/⟦EMAIL_1⟧/g)).toHaveLength(2);
    expect(p.decompte().IBAN).toBe(1);
  });

  it('est idempotente et laisse intacts montants, dates et identifiants', () => {
    const p = creerPseudonymiseur();
    const neutre = 'Facture F-2025-014 du 12/03/2025, total 1 248,00 EUR, pièce 3f2b8c1e-1234-4abc-9def-123456789012, compte 401000, montant 123456789.';
    expect(p.pseudonymiser(neutre)).toBe(neutre);
    const une = p.pseudonymiser(texte);
    expect(p.pseudonymiser(une)).toBe(une);
  });

  it('restaure en profondeur une valeur JSON et laisse tel quel un jeton inventé', () => {
    const p = creerPseudonymiseur();
    p.pseudonymiser('a@b.fr');
    expect(p.restaurerProfond({ x: ['écrire à ⟦EMAIL_1⟧'], y: { z: '⟦IBAN_9⟧' }, n: 3 })).toEqual({ x: ['écrire à a@b.fr'], y: { z: '⟦IBAN_9⟧' }, n: 3 });
    expect(contientJeton('⟦IBAN_9⟧')).toBe(true);
    expect(contientJeton('texte simple')).toBe(false);
  });

  it('ne masque un nom que sur mot entier, sans tenir compte de la casse', () => {
    const p = creerPseudonymiseur(['Martin']);
    expect(p.pseudonymiser('MARTIN et Martinez')).toBe('⟦PERSONNE_1⟧ et Martinez');
  });
});
