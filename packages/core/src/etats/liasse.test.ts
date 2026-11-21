/** Recette de la préparation de la liasse fiscale (projet) : tables, cohérence avec le projet de bilan, abstentions. */
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ligne } from '../aides-tests.js';
import type { LigneEcriture } from '../controles/types.js';
import { jeuDeficitaire, jeuPrincipal, piece } from '../jeux-etats-tests.js';
import { calculerBalance } from './balance.js';
import { CORRESPONDANCE_PCG } from './correspondance.js';
import {
  type CaseLiasse, type DemandeLiasse, type LiasseProjet, type ResultatLiasse, TABLES_LIASSE, TABLE_LIASSE_REEL_NORMAL_2026, TABLE_LIASSE_REEL_SIMPLIFIE_2026, preparerLiasse, tableLiassePour, verifierTableLiasse,
} from './liasse.js';
import { projeterBilan, projeterCompteDeResultat } from './projection.js';

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };

function demande(lignes: readonly LigneEcriture[], surcharge: Partial<DemandeLiasse> = {}): DemandeLiasse {
  return { balance: calculerBalance(lignes, { auxiliaire: true }), exercice: EXERCICE, regime: 'reel_normal', territoire: 'metropole', impotSurLeResultat: 'is', referentielComptable: 'PCG', devise: 'EUR', societeCommerciale: true, ...surcharge };
}
function projet(r: ResultatLiasse): LiasseProjet {
  if (r.statut !== 'projet') throw new Error(`Projet attendu, abstention reçue : ${r.motifs.map((m) => m.code).join(', ')}`);
  return r;
}
const cases = (p: LiasseProjet): CaseLiasse[] => p.tableaux.flatMap((t) => t.lignes);
const caseDe = (p: LiasseProjet, id: string): CaseLiasse => {
  const c = cases(p).find((x) => x.ligne === id);
  if (c === undefined) throw new Error(`Ligne absente : ${id}`);
  return c;
};
const controle = (p: LiasseProjet, code: string) => p.controles.find((c) => c.code === code);

describe('tables de liasse', () => {
  it('sont cohérentes avec la table des comptes et versionnées', () => {
    for (const t of TABLES_LIASSE) {
      expect(verifierTableLiasse(t, CORRESPONDANCE_PCG)).toEqual([]);
      expect(t.version).toBe('2026.1');
      expect(t.millesimeFormulaire).toBe('2026');
      expect(t.etat).toBe('en_attente_de_validation_professionnelle');
      expect(t.correspondanceComptes).toEqual({ id: 'PCG-SYSTEME-DE-BASE', version: '2025.1' });
      expect(t.periodeApplication.exercicesOuvertsAPartirDu).toBe('2025-01-01');
      // Le formulaire n'a pas pu être lu : la source le dit, et aucun code de case n'est avancé.
      expect(t.source.verification).toBe('non_verifiee');
      expect(t.source.dateVerification).toBe('2026-11-19');
      expect(t.lignes.every((l) => l.codeCase === null && l.etatCodeCase === 'a_confirmer')).toBe(true);
      expect(new Set(t.lignes.map((l) => l.id)).size).toBe(t.lignes.length);
    }
    expect(TABLE_LIASSE_REEL_NORMAL_2026.tableaux.map((t) => t.code)).toEqual(['2050', '2051', '2052', '2053']);
    expect(TABLE_LIASSE_REEL_SIMPLIFIE_2026.tableaux.map((t) => t.code)).toEqual(['2033-A', '2033-B']);
    expect(TABLE_LIASSE_REEL_NORMAL_2026.rubriquesSansLigne).toEqual([]);
    expect(TABLE_LIASSE_REEL_NORMAL_2026.lignes.every((l) => l.origineLibelle === 'modele_pcg')).toBe(true);
    expect(TABLE_LIASSE_REEL_SIMPLIFIE_2026.lignes.every((l) => l.origineLibelle === 'trace_usuel_non_relu')).toBe(true);
  });

  it('détecte une table incohérente', () => {
    const lignes = TABLE_LIASSE_REEL_SIMPLIFIE_2026.lignes;
    const sansUnPoste = { ...TABLE_LIASSE_REEL_SIMPLIFIE_2026, lignes: lignes.filter((l) => l.id !== 'RSI_2033A_ACTIF_DISPONIBILITES') };
    const erreurs = verifierTableLiasse(sansUnPoste);
    expect(erreurs.some((e) => /A_DISPONIBILITES ni reprise/.test(e))).toBe(true);
    expect(erreurs.some((e) => /ligne inconnue RSI_2033A_ACTIF_DISPONIBILITES/.test(e))).toBe(true);
    const enDouble = { ...TABLE_LIASSE_REEL_SIMPLIFIE_2026, rubriquesSansLigne: [...TABLE_LIASSE_REEL_SIMPLIFIE_2026.rubriquesSansLigne, { code: 'A_CLIENTS', motif: 'test' }] };
    expect(verifierTableLiasse(enDouble).some((e) => /A_CLIENTS à la fois reprise/.test(e))).toBe(true);
    const autreVersion = { ...TABLE_LIASSE_REEL_NORMAL_2026, correspondanceComptes: { id: 'PCG-SYSTEME-DE-BASE', version: '1999.1' } };
    expect(verifierTableLiasse(autreVersion)[0]).toMatch(/vise la correspondance/);
  });

  it('choisit la table selon le régime et l’exercice', () => {
    expect(tableLiassePour('reel_normal', EXERCICE)?.id).toBe('LIASSE-BIC-IS-RN');
    expect(tableLiassePour('reel_simplifie', { debut: '2025-07-01', fin: '2026-06-30' })?.id).toBe('LIASSE-BIC-IS-RSI');
    expect(tableLiassePour('reel_normal', { debut: '2024-01-01', fin: '2024-12-31' })).toBeNull();
    expect(tableLiassePour('reel_normal', { debut: '2026-01-01', fin: '2026-12-31' })).toBeNull();
    expect(() => tableLiassePour('reel_normal', { debut: '01/01/2025', fin: '2025-12-31' })).toThrow(/Exercice invalide/);
  });

  it('liste les tableaux non couverts avec les informations nécessaires, sans les présenter comme préparés', () => {
    const rn = TABLE_LIASSE_REEL_NORMAL_2026.tableauxNonCouverts;
    expect(rn.filter((t) => t.couverture === 'non_couvert').map((t) => t.code)).toEqual(['2054 bis', '2056', '2057', '2058-A', '2058-B', '2058-C', '2059-A', '2059-B', '2059-C', '2059-D', '2059-E', '2059-F', '2059-G', '2065']);
    expect(rn.filter((t) => t.couverture === 'partiel').map((t) => t.code)).toEqual(['2050', '2051', '2052', '2053', '2054', '2055']);
    expect(rn.find((t) => t.code === '2054')?.motif).toMatch(/tableauxImmobilisations/);
    expect(rn.every((t) => t.informationsComplementairesNecessaires.length > 0)).toBe(true);
    expect(rn.find((t) => t.code === '2058-A')?.informationsComplementairesNecessaires.join(' ')).toMatch(/Réintégrations extra-comptables/);
    expect(rn.find((t) => t.code === '2057')?.informationsComplementairesNecessaires.join(' ')).toMatch(/échéance/);
    expect(rn.find((t) => t.code === '2059-F')?.informationsComplementairesNecessaires.join(' ')).toMatch(/Composition du capital/);
    const rsi = TABLE_LIASSE_REEL_SIMPLIFIE_2026.tableauxNonCouverts;
    expect(rsi.map((t) => t.code)).toEqual(['2033-A', '2033-B', '2033-C', '2033-D', '2033-E', '2033-F', '2033-G', '2065']);
    expect(rsi.find((t) => t.code === '2033-B')?.couverture).toBe('partiel');
    expect(rsi.find((t) => t.code === '2033-C')).toMatchObject({ couverture: 'partiel' });
    expect(rsi.find((t) => t.code === '2033-C')?.motif).toMatch(/cadre III/);
    expect(rsi.find((t) => t.code === '2033-B')?.motif).toMatch(/résultat fiscal/);
  });
});

describe('liasse du régime réel normal (2050 à 2053)', () => {
  const lignes = jeuPrincipal(2025);
  const p = projet(preparerLiasse(demande(lignes)));
  const balance = calculerBalance(lignes, { auxiliaire: true });
  const resultat = projeterCompteDeResultat(balance, CORRESPONDANCE_PCG);
  const bilan = projeterBilan(balance, CORRESPONDANCE_PCG, { resultatExercice: resultat.totaux['resultat'] as string });

  it('est un projet incomplet qui dit ce qui manque', () => {
    expect(p.statut).toBe('projet');
    expect(p.complet).toBe(false);
    expect(p.mention).toMatch(/Projet, en attente de validation professionnelle/);
    expect(p.table).toEqual({ id: 'LIASSE-BIC-IS-RN', version: '2026.1', millesimeFormulaire: '2026', etat: 'en_attente_de_validation_professionnelle' });
    expect(p.manques.some((m) => /Tableau 2058-A .* non couvert/.test(m))).toBe(true);
    expect(p.manques.some((m) => /Tableau 2050 .* partiellement couvert/.test(m))).toBe(true);
    expect(p.manques.some((m) => /Codes de cases non fournis/.test(m))).toBe(true);
    expect(p.tableauxNonCouverts).toHaveLength(20);
    expect(p.sources.some((s) => s.verification === 'non_verifiee')).toBe(true);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('reprend exactement le projet de bilan et le projet de compte de résultat', () => {
    expect(p.totaux).toEqual({
      total_actif_brut: '75600.00', total_actif_amortissements_depreciations: '4000.00', total_actif: '71600.00', total_passif: '71600.00', resultat_bilan: '13100.00', resultat_compte_de_resultat: '13100.00',
    });
    expect(p.totaux['total_actif']).toBe(bilan.totaux['total_actif']);
    expect(p.totaux['total_passif']).toBe(bilan.totaux['total_passif']);
    expect(p.totaux['resultat_compte_de_resultat']).toBe(resultat.totaux['resultat']);
    // Ligne à ligne : chaque poste et chaque regroupement égale la rubrique du projet correspondant.
    for (const r of [...bilan.rubriques, ...resultat.rubriques]) {
      const c = cases(p).find((x) => x.ligne.endsWith(`_${r.code}`) && /^RN_20\d\d_/.test(x.ligne) && x.ligne.replace(/^RN_20\d\d_/, '') === r.code);
      expect(c, r.code).toBeDefined();
      expect(c?.montant, r.code).toBe(r.montant);
      if (r.brut !== undefined) { expect(c?.brut).toBe(r.brut); expect(c?.amortissementsDepreciations).toBe(r.amortissementsDepreciations); }
    }
    expect(caseDe(p, 'RN_2052_RESULTAT_EXPLOITATION').montant).toBe(resultat.totaux['resultat_exploitation']);
    expect(caseDe(p, 'RN_2052_RESULTAT_FINANCIER').montant).toBe(resultat.totaux['resultat_financier']);
    expect(caseDe(p, 'RN_2052_RESULTAT_COURANT').montant).toBe(resultat.totaux['resultat_courant_avant_impots']);
    expect(caseDe(p, 'RN_2053_RESULTAT_EXCEPTIONNEL').montant).toBe(resultat.totaux['resultat_exceptionnel']);
    expect(caseDe(p, 'RN_2053_TOTAL_PRODUITS').montant).toBe(resultat.totaux['total_produits']);
    expect(caseDe(p, 'RN_2053_TOTAL_CHARGES').montant).toBe(resultat.totaux['total_charges']);
    expect(caseDe(p, 'RN_2053_RESULTAT').montant).toBe('13100.00');
  });

  it('donne pour chaque case le montant, les comptes contributeurs et la traçabilité', () => {
    const c = caseDe(p, 'RN_2050_A_AUTRES_CORPORELLES');
    expect(c).toMatchObject({ tableau: '2050', nature: 'poste', brut: '10000.00', amortissementsDepreciations: '4000.00', montant: '6000.00', codeCase: null, etatCodeCase: 'a_confirmer' });
    expect(c.comptes).toEqual([
      { compteNum: '218300', compteLib: 'Compte 218300', montant: '10000.00', rubriquePcg: 'A_AUTRES_CORPORELLES', colonne: 'brut' },
      { compteNum: '281830', compteLib: 'Compte 281830', montant: '-4000.00', rubriquePcg: 'A_AUTRES_CORPORELLES', colonne: 'amortissements_depreciations' },
    ]);
    expect(c.tracabilite).toEqual({ table: { id: 'LIASSE-BIC-IS-RN', version: '2026.1' }, correspondanceComptes: { id: 'PCG-SYSTEME-DE-BASE', version: '2025.1' }, rubriquesPcg: ['A_AUTRES_CORPORELLES'], formule: null });
    const total = caseDe(p, 'RN_2050_TOTAL_GENERAL');
    expect(total.nature).toBe('total');
    expect(total.comptes).toEqual([]);
    expect(total.tracabilite.formule).toMatch(/^RN_2050_A_CAPITAL_SOUSCRIT_NON_APPELE \+ RN_2050_A_FRAIS_ETABLISSEMENT \+ RN_2050_A_ACTIF_IMMOBILISE/);
    expect(caseDe(p, 'RN_2052_RESULTAT_EXPLOITATION').tracabilite.formule).toBe('RN_2052_PE - RN_2052_CE');
    // Chaque compte de la balance contribue à une case et une seule, hors comptes non affectés.
    const contributions = cases(p).flatMap((x) => x.comptes.map((k) => k.compteNum)).filter((n) => n !== '6-7');
    expect(new Set(contributions).size).toBe(contributions.length);
    expect(contributions.length).toBe(balance.lignes.length);
    // Somme des montants des comptes d'un poste = montant du poste.
    for (const x of cases(p).filter((k) => k.nature === 'poste')) {
      expect(x.comptes.reduce((s, k) => s.plus(new Decimal(k.montant)), new Decimal(0)).toFixed(2), x.ligne).toBe(x.montant);
    }
    expect(cases(p).every((x) => /^-?\d+\.\d{2}$/.test(x.montant))).toBe(true);
  });

  it('contrôle la cohérence interne sans rien forcer', () => {
    expect(p.controles.map((c) => [c.code, c.statut])).toEqual([
      ['balance_equilibree', 'ok'], ['total_actif_egal_total_passif', 'ok'], ['resultat_compte_de_resultat_egal_resultat_bilan', 'ok'], ['report_total_actif_projet_de_bilan', 'ok'],
      ['report_total_passif_projet_de_bilan', 'ok'], ['report_resultat_projet_de_compte_de_resultat', 'ok'], ['resultat_egal_solde_des_classes_6_et_7', 'ok'], ['tiers_soldes_inverses_non_reclasses', 'ok'],
    ]);
    expect(p.comptesNonAffectes).toEqual([]);
    expect(p.rubriquesNonAffectees).toEqual([]);
  });

  it('laisse non affectés les comptes inconnus ou ambigus et affiche l’écart', () => {
    const avecInconnus = [...lignes, ...piece('2025-09-01', [['471000', '300.00', '0.00'], ['512000', '0.00', '300.00']]), ...piece('2025-09-02', [['608000', '50.00', '0.00'], ['512000', '0.00', '50.00']])];
    const q = projet(preparerLiasse(demande(avecInconnus)));
    expect(q.comptesNonAffectes).toEqual([{ compteNum: '471000', compteLib: 'Compte 471000', solde: '300.00' }, { compteNum: '608000', compteLib: 'Compte 608000', solde: '50.00' }]);
    expect(q.totaux['total_actif']).toBe('71250.00');
    expect(q.totaux['total_passif']).toBe('71550.00');
    expect(controle(q, 'total_actif_egal_total_passif')).toMatchObject({ statut: 'ecart', ecart: '-300.00' });
    // Le résultat du bilan vient de la balance (13 050) ; celui du 2053 ignore le compte 608 non affecté (13 100).
    expect(controle(q, 'resultat_compte_de_resultat_egal_resultat_bilan')).toMatchObject({ statut: 'ecart', ecart: '50.00' });
    expect(q.manques.some((m) => /compte\(s\) non affecté/.test(m))).toBe(true);
    expect(q.manques.some((m) => /Écart au contrôle total_actif_egal_total_passif/.test(m))).toBe(true);
  });

  it('affiche le déséquilibre d’une balance sans le corriger', () => {
    const desequilibre = [...lignes, ligne({ compteNum: '512000', debit: '100.00', ecritureDate: '2025-10-01' })];
    const q = projet(preparerLiasse(demande(desequilibre)));
    expect(controle(q, 'balance_equilibree')).toMatchObject({ statut: 'ecart', ecart: '100.00' });
    expect(controle(q, 'total_actif_egal_total_passif')).toMatchObject({ statut: 'ecart', ecart: '100.00' });
    expect(q.totaux['total_actif']).toBe('71700.00');
    expect(q.totaux['total_passif']).toBe('71600.00');
  });

  it('traite une balance vide sans inventer de chiffre', () => {
    const q = projet(preparerLiasse(demande([])));
    expect(q.complet).toBe(false);
    expect(cases(q).every((c) => c.montant === '0.00' && c.comptes.length === 0)).toBe(true);
    expect(q.controles.filter((c) => c.code !== 'tiers_soldes_inverses_non_reclasses').every((c) => c.statut === 'non_verifiable' && c.ecart === null)).toBe(true);
    expect(q.manques.some((m) => /Balance vide/.test(m))).toBe(true);
  });

  it('porte une perte et des capitaux propres négatifs sans retraitement', () => {
    const q = projet(preparerLiasse(demande(jeuDeficitaire(2025))));
    expect(q.totaux['resultat_compte_de_resultat']).toBe('-8000.00');
    expect(caseDe(q, 'RN_2051_P_RESULTAT').montant).toBe('-8000.00');
    expect(caseDe(q, 'RN_2051_P_CAPITAUX_PROPRES').montant).toBe('-3000.00');
    expect(controle(q, 'total_actif_egal_total_passif')?.statut).toBe('ok');
  });
});

describe('liasse du régime simplifié (2033-A et 2033-B)', () => {
  const lignes = jeuPrincipal(2025);

  it('agrège les postes et retrouve le total du bilan et le résultat', () => {
    const p = projet(preparerLiasse(demande(lignes, { regime: 'reel_simplifie' })));
    expect(p.table.id).toBe('LIASSE-BIC-IS-RSI');
    expect(p.tableaux.map((t) => t.code)).toEqual(['2033-A', '2033-B']);
    expect(p.totaux).toMatchObject({ total_actif: '71600.00', total_passif: '71600.00', resultat_bilan: '13100.00', resultat_compte_de_resultat: '13100.00' });
    expect(caseDe(p, 'RSI_2033A_ACTIF_CORPORELLES')).toMatchObject({ brut: '10000.00', amortissementsDepreciations: '4000.00', montant: '6000.00' });
    expect(caseDe(p, 'RSI_2033A_ACTIF_STOCKS_MARCHANDISES').montant).toBe('7000.00');
    expect(caseDe(p, 'RSI_2033A_ACTIF_CLIENTS').montant).toBe('18000.00');
    expect(caseDe(p, 'RSI_2033A_ACTIF_AUTRES_CREANCES').montant).toBe('7200.00');
    expect(caseDe(p, 'RSI_2033A_ACTIF_DISPONIBILITES').montant).toBe('33400.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_TOTAL_I').montant).toBe('34100.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_EMPRUNTS').montant).toBe('12000.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_FOURNISSEURS').montant).toBe('9000.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_AUTRES_DETTES').montant).toBe('16500.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_AUTRES_DETTES').comptes.map((c) => c.compteNum)).toEqual(['431000', '445710']);
    expect(caseDe(p, 'RSI_2033B_TOTAL_PRODUITS_EXPLOITATION').montant).toBe('61000.00');
    expect(caseDe(p, 'RSI_2033B_RESULTAT_EXPLOITATION').montant).toBe('13500.00');
    expect(caseDe(p, 'RSI_2033B_CHARGES_FINANCIERES').montant).toBe('400.00');
    expect(caseDe(p, 'RSI_2033A_PASSIF_CAPITAL').brut).toBeUndefined();
    expect(p.controles.filter((c) => c.statut !== 'ok')).toEqual([]);
    expect(p.rubriquesNonAffectees).toEqual([]);
    expect(p.complet).toBe(false);
    expect(p.manques.some((m) => /Tableau 2033-B .* partiellement couvert .* Réintégrations/.test(m))).toBe(true);
  });

  it('laisse non affecté un poste sans ligne certaine et affiche l’écart qui en résulte', () => {
    const avecFrais = [...lignes, ...piece('2025-02-01', [['201000', '3000.00', '0.00'], ['512000', '0.00', '3000.00']]), ...piece('2025-12-31', [['691000', '500.00', '0.00'], ['424000', '0.00', '500.00']])];
    const p = projet(preparerLiasse(demande(avecFrais, { regime: 'reel_simplifie' })));
    expect(p.rubriquesNonAffectees.map((r) => [r.code, r.montant])).toEqual([['A_FRAIS_ETABLISSEMENT', '3000.00'], ['PART', '500.00']]);
    expect(p.rubriquesNonAffectees[0]?.comptes).toEqual([{ compteNum: '201000', compteLib: 'Compte 201000', montant: '3000.00', rubriquePcg: 'A_FRAIS_ETABLISSEMENT', colonne: 'brut' }]);
    expect(p.totaux['total_actif']).toBe('68600.00');
    expect(p.totaux['total_passif']).toBe('71600.00');
    expect(controle(p, 'total_actif_egal_total_passif')).toMatchObject({ statut: 'ecart', ecart: '-3000.00' });
    expect(controle(p, 'report_total_actif_projet_de_bilan')).toMatchObject({ statut: 'ecart', ecart: '-3000.00' });
    expect(controle(p, 'resultat_compte_de_resultat_egal_resultat_bilan')).toMatchObject({ statut: 'ecart', ecart: '500.00' });
    expect(p.manques.some((m) => /Frais d’établissement.*sans ligne certaine/.test(m))).toBe(true);
    // Le même jeu au régime réel normal ne laisse rien de côté.
    const rn = projet(preparerLiasse(demande(avecFrais)));
    expect(rn.rubriquesNonAffectees).toEqual([]);
    expect(rn.totaux['total_actif']).toBe(rn.totaux['total_passif']);
  });
});

describe('abstentions hors périmètre', () => {
  const lignes = jeuPrincipal(2025);
  const codes = (surcharge: Partial<DemandeLiasse>): string[] => {
    const r = preparerLiasse(demande(lignes, surcharge));
    expect(r.statut).toBe('abstention');
    // Aucun chiffre : ni tableaux, ni totaux.
    expect(r).not.toHaveProperty('tableaux');
    expect(r).not.toHaveProperty('totaux');
    return r.statut === 'abstention' ? r.motifs.map((m) => m.code) : [];
  };

  it('s’abstient hors métropole ou tant que le territoire est à confirmer', () => {
    expect(codes({ territoire: 'guadeloupe' })).toEqual(['territoire_hors_perimetre']);
    expect(codes({ territoire: 'mayotte' })).toEqual(['territoire_hors_perimetre']);
    expect(codes({ territoire: 'autre' })).toEqual(['territoire_hors_perimetre']);
    expect(codes({ territoire: 'a_confirmer' })).toEqual(['territoire_a_confirmer']);
  });

  it('s’abstient pour un régime autre que l’impôt sur les sociétés ou une entité hors périmètre', () => {
    expect(codes({ impotSurLeResultat: 'ir' })).toEqual(['impot_hors_perimetre']);
    expect(codes({ impotSurLeResultat: 'a_confirmer' })).toEqual(['impot_a_confirmer']);
    expect(codes({ societeCommerciale: false })).toEqual(['forme_hors_perimetre']);
    expect(codes({ societeCommerciale: null })).toEqual(['forme_a_confirmer']);
    expect(codes({ referentielComptable: 'IFRS' })).toEqual(['referentiel_hors_perimetre']);
    expect(codes({ devise: 'USD' })).toEqual(['devise_hors_perimetre']);
  });

  it('s’abstient pour un exercice hors de la période couverte par la table', () => {
    expect(codes({ exercice: { debut: '2024-01-01', fin: '2024-12-31' } })).toEqual(['exercice_hors_periode']);
    expect(codes({ exercice: { debut: '2024-07-01', fin: '2025-06-30' } })).toEqual(['exercice_hors_periode']);
    expect(codes({ exercice: { debut: '2026-01-01', fin: '2026-12-31' } })).toEqual(['exercice_hors_periode']);
    expect(codes({ exercice: { debut: '2025-12-31', fin: '2025-01-01' } })).toEqual(['exercice_invalide']);
    expect(codes({ exercice: { debut: '2025-02-30', fin: '2025-12-31' } })).toEqual(['exercice_invalide']);
    expect(preparerLiasse(demande(lignes, { exercice: { debut: '2025-07-01', fin: '2026-06-30' } })).statut).toBe('projet');
  });

  it('cumule les motifs et rappelle le périmètre', () => {
    const r = preparerLiasse(demande(lignes, { territoire: 'reunion', impotSurLeResultat: 'ir', exercice: { debut: '2023-01-01', fin: '2023-12-31' } }));
    expect(r).toMatchObject({ statut: 'abstention' });
    if (r.statut !== 'abstention') return;
    expect(r.motifs.map((m) => m.code)).toEqual(['territoire_hors_perimetre', 'impot_hors_perimetre', 'exercice_hors_periode']);
    expect(r.perimetreCouvert).toMatch(/impôt sur les sociétés.*France métropolitaine/);
    expect(r.motifs[0]?.message).toMatch(/La Réunion/);
  });
});
