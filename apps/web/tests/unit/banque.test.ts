import { describe, expect, it } from 'vitest';
import { detailsSimples, niveauxPermis, sirenPlausible } from '@/lib/administration';
import { type ParametresRapprochement, estNul, masquerCompte, parametresDepuis, parametresInitiaux, profilDepuis, profilInitial, sensMouvement, synthesePropositions } from '@/lib/banque';

const DEFAUTS: ParametresRapprochement = { toleranceMontant: '0.00', fenetreJours: 5, fenetreJoursRegles: 45, tailleMaxGroupe: 6, autoriserPartiels: true, autoriserCompensations: true, budgetCombinaisons: 20000, fraisBancairesMax: '0.00' };

describe('banque : affichage', () => {
  it('masque un IBAN sauf ses quatre derniers caractères', () => {
    expect(masquerCompte('FR76 3000 6000 0112 3456 7890 189')).toBe('•••• 0189');
    expect(masquerCompte(null, '30006-00001-12345678901')).toBe('•••• 8901');
    expect(masquerCompte('1234')).toBe('••••');
    expect(masquerCompte(null)).toBe('Compte non identifié');
    expect(masquerCompte('FR7630006000011234567890189')).not.toContain('3000');
  });
  it('lit le sens d’un mouvement sur le signe de la chaîne, sans conversion', () => {
    expect(sensMouvement('12.50')).toBe('encaissement');
    expect(sensMouvement('-0.01')).toBe('decaissement');
    expect(sensMouvement('0.00')).toBe('nul');
    expect(sensMouvement('-0.00')).toBe('nul');
    expect(sensMouvement('9007199254740993.01')).toBe('encaissement');
    expect(estNul('0.00')).toBe(true);
    expect(estNul('-0.000001')).toBe(false);
    expect(estNul(null)).toBe(true);
  });
  it('compte les propositions par règle dans l’ordre de la référence', () => {
    const regles = [{ id: 'EXACT-REFERENCE', niveau: 'exact' as const, description: '' }, { id: 'REGLE-PAIEMENT-GROUPE', niveau: 'regle' as const, description: '' }];
    const s = synthesePropositions([{ regle: 'REGLE-PAIEMENT-GROUPE', statut: 'propose' }, { regle: 'EXACT-REFERENCE', statut: 'valide' }, { regle: 'EXACT-REFERENCE', statut: 'rejete' }, { regle: 'INCONNUE', statut: 'propose' }], regles);
    expect(s.parRegle).toEqual([{ id: 'EXACT-REFERENCE', niveau: 'exact', nombre: 2 }, { id: 'REGLE-PAIEMENT-GROUPE', niveau: 'regle', nombre: 1 }, { id: 'INCONNUE', niveau: null, nombre: 1 }]);
    expect(s.statuts).toEqual({ propose: 2, valide: 1, rejete: 1 });
    expect(s.total).toBe(4);
  });
});

describe('profil CSV confirmé par l’utilisateur', () => {
  it('reprend le séparateur nommé par l’API, jamais en cas d’ambiguïté', () => {
    expect(profilInitial(['Séparateur « , » (3 ligne(s) sur 3 examinée(s)).', 'Ligne d’en-tête non reconnue']).separateur).toBe(',');
    expect(profilInitial(['Séparateur « tabulation » (3 ligne(s) sur 3 examinée(s)).']).separateur).toBe('tab');
    expect(profilInitial(['Séparateur ambigu : plusieurs séparateurs possibles donnent le même nombre de lignes.']).separateur).toBe(';');
    expect(profilInitial().date).toBe(''); // aucune colonne n'est devinée
  });
  it('produit le profil attendu par l’API (en-têtes ou positions, montant ou débit/crédit)', () => {
    const base = { ...profilInitial(), date: 'Quand', libelle: 'Quoi' };
    expect(profilDepuis({ ...base, montant: 'Combien' })).toEqual({ ok: true, profilCsv: { separateur: ';', lignesEntete: 1, colonnes: { date: 'Quand', libelle: 'Quoi', montant: 'Combien' }, formatDate: 'JJ/MM/AAAA', decimale: ',' } });
    const r = profilDepuis({ ...base, separateur: 'tab', lignesEntete: '0', date: '1', libelle: '3', mode: 'debit_credit', debit: '4', credit: '5', reference: '2', decimale: '.', formatDate: 'AAAA-MM-JJ', iban: 'fr76 3000 6000 0112 3456 7890 189' });
    expect(r).toEqual({ ok: true, profilCsv: { separateur: '\t', lignesEntete: 0, colonnes: { date: 0, libelle: 2, debit: 3, credit: 4, reference: 1 }, formatDate: 'AAAA-MM-JJ', decimale: '.', iban: 'FR7630006000011234567890189' } });
  });
  it('refuse un profil incomplet ou incohérent', () => {
    const erreurs = (m: object) => {
      const r = profilDepuis({ ...profilInitial(), date: 'Date', libelle: 'Libellé', montant: 'Montant', ...m });
      return r.ok ? [] : r.erreurs;
    };
    expect(erreurs({})).toEqual([]);
    expect(erreurs({ date: '' })[0]).toContain('« date »');
    expect(erreurs({ mode: 'debit_credit' })).toHaveLength(2);
    expect(erreurs({ montant: 'date' })[0]).toContain('deux rôles');
    expect(erreurs({ lignesEntete: '0' })[0]).toContain('position');
    expect(erreurs({ lignesEntete: 'x' })[0]).toContain('Lignes d’en-tête');
    expect(erreurs({ date: '0' })[0]).toContain('numéro 1');
    expect(erreurs({ iban: 'pas un iban' })[0]).toContain('IBAN');
  });
});

describe('paramètres du rapprochement', () => {
  it('ne transmet rien quand rien n’est changé', () => {
    expect(parametresDepuis(parametresInitiaux(DEFAUTS), DEFAUTS)).toEqual({ ok: true, parametres: {} });
    expect(parametresInitiaux(DEFAUTS).toleranceMontant).toBe('0,00');
  });
  it('garde la tolérance en chaîne décimale et ne transmet que les écarts aux valeurs par défaut', () => {
    const f = { ...parametresInitiaux(DEFAUTS), toleranceMontant: '0,05', fenetreJours: '7', autoriserPartiels: false };
    expect(parametresDepuis(f, DEFAUTS)).toEqual({ ok: true, parametres: { toleranceMontant: '0.05', fenetreJours: 7, autoriserPartiels: false } });
    expect(parametresDepuis({ ...parametresInitiaux(DEFAUTS), toleranceMontant: '0' }, DEFAUTS)).toEqual({ ok: true, parametres: {} });
    const grand = parametresDepuis({ ...parametresInitiaux(DEFAUTS), toleranceMontant: '1234567890123,01' }, DEFAUTS);
    expect(grand.ok && grand.parametres.toleranceMontant).toBe('1234567890123.01'); // chaîne conservée telle quelle
  });
  it('refuse les valeurs invalides', () => {
    for (const t of ['-1', '1e3', 'abc', '', '1,2,3']) expect(parametresDepuis({ ...parametresInitiaux(DEFAUTS), toleranceMontant: t }, DEFAUTS).ok).toBe(false);
    expect(parametresDepuis({ ...parametresInitiaux(DEFAUTS), fenetreJours: '400' }, DEFAUTS).ok).toBe(false);
    expect(parametresDepuis({ ...parametresInitiaux(DEFAUTS), fenetreJoursRegles: '-3' }, DEFAUTS).ok).toBe(false);
  });
});

describe('administration', () => {
  it('plafonne les niveaux par rôle, dans l’ordre des niveaux', () => {
    expect(niveauxPermis('client_deposant')).toEqual(['depot']);
    expect(niveauxPermis('support')).toEqual(['lecture']);
    expect(niveauxPermis('collaborateur')).toEqual(['depot', 'lecture', 'collaboration']);
    expect(niveauxPermis('reviseur')).not.toContain('validation');
    expect(niveauxPermis('administrateur')).toHaveLength(5);
    expect(niveauxPermis('inconnu')).toEqual([]);
  });
  it('vérifie la clé d’un SIREN', () => {
    expect(sirenPlausible('123456782')).toBe(true);
    expect(sirenPlausible('123456789')).toBe(false);
    expect(sirenPlausible('12345678')).toBe(false);
  });
  it('ne retient des détails d’audit que les clés simples', () => {
    expect(detailsSimples({ niveau: 'revision', pourSoiMeme: true, n: 3, objet: { a: 1 }, liste: [1], long: 'x'.repeat(61) })).toEqual([{ cle: 'niveau', valeur: 'revision' }, { cle: 'pourSoiMeme', valeur: 'true' }, { cle: 'n', valeur: '3' }]);
    expect(detailsSimples(null)).toEqual([]);
    expect(detailsSimples(['a'])).toEqual([]);
  });
});
