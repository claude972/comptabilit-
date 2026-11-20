import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireAtomique, expressionEcheance } from './destruction-terme.js';
import type { RegleCategorie } from './durees-conservation.js';
import { rendreEcheancierLisible } from './rapport-lisible.js';

const r = (duree: RegleCategorie['duree'], pointDeDepart: RegleCategorie['pointDeDepart']): RegleCategorie => ({ duree, pointDeDepart, apresEcheance: 'supprimer' });

describe('expressionEcheance : l’échéance SQL d’une règle', () => {
  it('construit chaque point de départ, sans jamais insérer de valeur non validée', () => {
    expect(expressionEcheance('restitutions_cabinet', r({ jours: 10 }, 'fin_de_contrat'), '2026-05-04')).toBe("'2026-05-14'::date");
    expect(expressionEcheance('restitutions_cabinet', r({ jours: 10 }, 'fin_de_contrat'), null)).toBe('null::date');
    expect(expressionEcheance('restitutions_cabinet', r({ jusqu_au: '2040-12-31' }, 'fin_de_contrat'), null)).toBe("'2040-12-31'::date");
    expect(expressionEcheance('evenements_ia', r({ jours: 183 }, 'evenement'), null)).toBe('(("cree_le")::date + 183)');
    expect(expressionEcheance('evenements_facturation', r({ jours: 3652 }, 'cloture_exercice_editeur'), null)).toBe('(make_date(extract(year from "cree_le")::int, 12, 31) + 3652)');
  });
  it('refuse une durée, une date, un départ ou une table inattendus (injection comprise)', () => {
    expect(() => expressionEcheance('evenements_ia', r({ jours: -1 }, 'evenement'), null)).toThrow(/Durée invalide/);
    expect(() => expressionEcheance('evenements_ia', r({ jours: 1.5 }, 'evenement'), null)).toThrow(/Durée invalide/);
    expect(() => expressionEcheance('x', r({ jusqu_au: "2040-01-01'; drop table x; --" }, 'fin_de_contrat'), null)).toThrow(/invalide/);
    expect(() => expressionEcheance('x', r({ jours: 1 }, 'fin_de_contrat'), "2026-01-01' or '1'='1")).toThrow(/Point de départ invalide/);
    expect(() => expressionEcheance('table_inconnue', r({ jours: 1 }, 'evenement'), null)).toThrow(/Aucune colonne de date/);
  });
});

describe('écriture atomique', () => {
  it('écrit le fichier entier, sans fichier temporaire résiduel', () => {
    const d = mkdtempSync(join(tmpdir(), 'comtaple-atomique-'));
    try {
      ecrireAtomique(join(d, 'sous', 'a.json'), '{"a":1}\n');
      expect(readFileSync(join(d, 'sous', 'a.json'), 'utf8')).toBe('{"a":1}\n');
      expect(readdirSync(join(d, 'sous'))).toEqual(['a.json']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('échéancier lisible', () => {
  it('rend chaque phase en français, avec le bandeau des durées non validées', () => {
    const t = rendreEcheancierLisible({
      format: 'comtaple.echeancier-conservation/1',
      aujourdhui: '2026-11-20',
      parametres: { version: 'v', statut: 'PROPOSITION NON VALIDÉE', nonValide: true },
      avertissements: [],
      cabinets: [
        { cabinetId: 'a', nom: 'Cabinet Actif', phase: 'actif', abonnement: { statut: 'actif', fin: null }, executionAuPlusTot: null, elementsConserves: null, aFaire: 'Rien : l’abonnement n’est pas résilié.' },
        { cabinetId: 'b', nom: 'Cabinet Résilié', phase: 'resilie_en_delai_de_grace', abonnement: { statut: 'resilie', fin: '2026-10-01' }, executionAuPlusTot: '2026-12-30', elementsConserves: null, aFaire: 'Attendre le 2026-12-30.' },
        { cabinetId: 'c', nom: 'Cabinet Exécuté', phase: 'fin_de_contrat_executee', abonnement: { statut: 'resilie', fin: '2025-01-01' }, executionAuPlusTot: '2025-04-01', elementsConserves: { lignes: 7, prochaineEcheance: '2030-01-01', categoriesEchues: [] }, aFaire: 'Attendre le 2030-01-01.' },
      ],
    });
    expect(t).toContain('ATTENTION : durées de conservation = PROPOSITION NON VALIDÉE');
    expect(t).toContain('• Cabinet Résilié — résilié, en délai de grâce');
    expect(t).toContain('exécution au plus tôt 30/12/2026');
    expect(t).toContain('éléments conservés : 7 lignes, prochaine échéance 01/01/2030');
  });
});
