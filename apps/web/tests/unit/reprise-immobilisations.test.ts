import { neutraliserCellule as neutraliserMoteur } from '@comtaple/core';
import { describe, expect, it } from 'vitest';
import { LIGNES_MAX, TAILLE_MAX_FICHIER, formaterTaille, neutraliserCellule, valeursLuesAffichables, versBase64 } from '../../src/lib/reprise-immobilisations';

describe('reprise des immobilisations — utilitaires de l’écran', () => {
  it('la neutralisation à l’affichage est celle du moteur (= + - @, tabulation, retour chariot, pleine chasse)', () => {
    for (const v of ['=SOMME(A1)', '+33612345678', '-1+2', '@cmd', '\tx', '\rx', '＝1', ' =1', 'Serveur', '12,50', '', 'a=b']) expect(neutraliserCellule(v), JSON.stringify(v)).toBe(neutraliserMoteur(v));
  });

  it('Base64 : aller-retour exact, y compris octets non ASCII et fichier de 5 Mio (sans dépassement de pile)', async () => {
    const octets = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Buffer.from(await versBase64(new Blob([octets])), 'base64')).toEqual(Buffer.from(octets));
    const gros = new Uint8Array(TAILLE_MAX_FICHIER).fill(0xe9);
    const b64 = await versBase64(new Blob([gros]));
    expect(b64.length).toBe(Math.ceil(TAILLE_MAX_FICHIER / 3) * 4);
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(gros))).toBe(true);
    expect(await versBase64(new Blob([]))).toBe('');
  });

  it('limites annoncées et taille lisible', () => {
    expect(TAILLE_MAX_FICHIER).toBe(5 * 1024 * 1024);
    expect(LIGNES_MAX).toBe(5000);
    expect(formaterTaille(900)).toBe('900 octets');
    expect(formaterTaille(2048)).toBe('2,0 Kio');
    expect(formaterTaille(5 * 1024 * 1024)).toBe('5,0 Mio');
  });

  it('valeurs lues : champs dans l’ordre, cellules vides omises, valeurs neutralisées', () => {
    const champs = [
      { code: 'libelle', libelle: 'Désignation', obligatoire: true, aide: '' },
      { code: 'compteImmobilisation', libelle: 'Compte', obligatoire: true, aide: '' },
      { code: 'dateSortie', libelle: 'Sortie', obligatoire: false, aide: '' },
    ];
    expect(valeursLuesAffichables(champs, { compteImmobilisation: '218300', libelle: '=1+1', dateSortie: '' })).toEqual([
      { code: 'libelle', libelle: 'Désignation', valeur: "'=1+1" },
      { code: 'compteImmobilisation', libelle: 'Compte', valeur: '218300' },
    ]);
  });
});
