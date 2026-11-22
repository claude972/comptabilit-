/** Recette des tableaux 2054, 2055 et 2033-C (D-104) : calcul, abstentions, N-1, rapprochement avec le fichier, aucun chiffre inventé. */
import { describe, expect, it } from 'vitest';
import type { LigneEcriture } from '../controles/types.js';
import { piece } from '../jeux-etats-tests.js';
import { validerSaisieTableau } from './saisies-tableaux.js';
import type { ImmobilisationAAmortir } from './inventaire.js';
import { type DemandeTableauxImmobilisations, type ResultatTableauxImmobilisations, type TableauImmobilisations, type TableauxImmobilisationsProjet, lignesSaisieImmobilisations, preparerTableauxImmobilisations } from './tableaux-immobilisations.js';

const EX_N1 = { debut: '2025-01-01', fin: '2025-12-31' };
const EX_N = { debut: '2026-01-01', fin: '2026-12-30' };

/** Exercice 2025 : à-nouveaux (matériel de bureau 10 000, amortissements 2 000), acquisition de 30 000 en installations techniques, dotations 4 000. */
function lignes2025(): LigneEcriture[] {
  return [
    ...piece('2025-01-01', [['218300', '10000.00', '0.00'], ['281830', '0.00', '2000.00'], ['101000', '0.00', '8000.00']], 'AN'),
    ...piece('2025-03-10', [['215000', '30000.00', '0.00'], ['512000', '0.00', '30000.00']], 'AC'),
    ...piece('2025-12-31', [['681120', '4000.00', '0.00'], ['281830', '0.00', '1500.00'], ['281500', '0.00', '2500.00']]),
  ];
}
/** Exercice 2026 : à-nouveaux = clôture 2025 avant inventaire ; acquisition de 5 000 ; cession d'une machine de 10 000 (amortie de 2 500) ; dotations 5 000. */
function lignes2026(sansANouveaux = false): LigneEcriture[] {
  const an = piece('2026-01-01', [['218300', '10000.00', '0.00'], ['215000', '30000.00', '0.00'], ['129000', '4000.00', '0.00'], ['281830', '0.00', '3500.00'], ['281500', '0.00', '2500.00'], ['101000', '0.00', '8000.00'], ['512000', '0.00', '30000.00']], sansANouveaux ? 'OD' : 'AN');
  return [
    ...an,
    ...piece('2026-02-15', [['218400', '5000.00', '0.00'], ['512000', '0.00', '5000.00']], 'AC'),
    ...piece('2026-04-30', [['281500', '2500.00', '0.00'], ['462000', '8000.00', '0.00'], ['215000', '0.00', '10000.00'], ['775000', '0.00', '500.00']], 'OD'),
    ...piece('2026-12-30', [['681120', '5000.00', '0.00'], ['281830', '0.00', '2000.00'], ['281500', '0.00', '3000.00']]),
  ];
}

const PERIMETRE = { territoire: 'metropole', impotSurLeResultat: 'is', referentielComptable: 'PCG', devise: 'EUR', societeCommerciale: true } as const;
const demande = (surcharge: Partial<DemandeTableauxImmobilisations> = {}): DemandeTableauxImmobilisations => ({ lignes: lignes2026(), exercice: EX_N, regime: 'reel_normal', ...PERIMETRE, ...surcharge });
function projet(r: ResultatTableauxImmobilisations): TableauxImmobilisationsProjet {
  if (r.statut !== 'projet') throw new Error(`Projet attendu, abstention reçue : ${r.motifs.map((m) => m.code).join(', ')}`);
  return r;
}
const tableau = (p: TableauxImmobilisationsProjet, code: string): TableauImmobilisations => {
  const t = p.tableaux.find((x) => x.code === code);
  if (t === undefined) throw new Error(`Tableau absent : ${code}`);
  return t;
};
const ligne = (p: TableauxImmobilisationsProjet, code: string, cadre: string, id: string) => {
  const l = tableau(p, code).cadres.find((c) => c.id === cadre)?.lignes.find((x) => x.id === id);
  if (l === undefined) throw new Error(`Ligne absente : ${code} ${cadre} ${id}`);
  return l;
};
const valeur = (p: TableauxImmobilisationsProjet, code: string, cadre: string, id: string, cle: string) => {
  const c = ligne(p, code, cadre, id).cellules[cle];
  if (c === undefined) throw new Error(`Cellule absente : ${code} ${cadre} ${id} ${cle}`);
  return c;
};
const controle = (p: TableauxImmobilisationsProjet, code: string) => p.controles.find((c) => c.code === code);

describe('2054 et 2055 : régime réel normal, déduits de la balance', () => {
  const p = projet(preparerTableauxImmobilisations(demande()));

  it('est un projet, jamais complet, avec les deux tableaux et leurs cadres couverts et non couverts', () => {
    expect(p.statut).toBe('projet');
    expect(p.complet).toBe(false);
    expect(p.mention).toMatch(/en attente de validation professionnelle/);
    expect(p.tableaux.map((t) => t.code)).toEqual(['2054', '2055']);
    expect(tableau(p, '2054').cadres.map((c) => c.id)).toEqual(['A', 'B']);
    expect(tableau(p, '2054').cadresNonCouverts.map((c) => c.cadre)).toEqual(['2054 bis']);
    expect(tableau(p, '2055').cadresNonCouverts.map((c) => c.cadre)).toEqual(['B', 'C']);
    expect(p.aNouveauxIdentifies).toBe(true);
    expect(p.table.etat).toBe('en_attente_de_validation_professionnelle');
    expect(p.manques.join(' ')).toMatch(/lus sur le formulaire du millésime 2026 par extraction de texte/);
  });

  it('calcule les valeurs brutes : ouverture, augmentations, clôture, par ligne et en total', () => {
    // Matériel de bureau (2183) : 10 000 à l'ouverture, +5 000 (218400), aucune diminution.
    expect(valeur(p, '2054', 'A', 'BUREAU', 'ouverture')).toMatchObject({ montant: '10000.00', statut: 'etabli', codeCase: 'LB', etatCodeCase: 'lu_a_confirmer' });
    expect(valeur(p, '2054', 'A', 'BUREAU', 'augmentation_acquisitions')).toMatchObject({ montant: '5000.00', codeCase: 'LD' });
    expect(valeur(p, '2054', 'B', 'BUREAU', 'cloture')).toMatchObject({ montant: '15000.00', codeCase: 'MT' });
    // Installations techniques (215) : 30 000 à l'ouverture, 10 000 de crédit (cession).
    expect(valeur(p, '2054', 'A', 'INST_TECH', 'ouverture').montant).toBe('30000.00');
    expect(valeur(p, '2054', 'A', 'INST_TECH', 'augmentation_acquisitions').montant).toBe('0.00');
    expect(valeur(p, '2054', 'B', 'INST_TECH', 'cloture').montant).toBe('20000.00');
    expect(valeur(p, '2054', 'B', 'INST_TECH', 'diminutions_totales')).toMatchObject({ montant: '10000.00', codeCase: null });
    // Totaux : corporelles (III) et général.
    expect(valeur(p, '2054', 'A', 'TOTAL_III', 'ouverture')).toMatchObject({ montant: '40000.00', codeCase: 'LN' });
    expect(valeur(p, '2054', 'B', 'TOTAL_GENERAL', 'cloture')).toMatchObject({ montant: '35000.00', codeCase: 'ØL' });
  });

  it('ne ventile jamais les diminutions que la balance ne distingue pas : néant certain si aucun crédit, sinon cellule à saisir avec motif', () => {
    expect(valeur(p, '2054', 'B', 'BUREAU', 'diminution_virement')).toMatchObject({ montant: '0.00', statut: 'etabli' });
    expect(valeur(p, '2054', 'B', 'BUREAU', 'diminution_cession')).toMatchObject({ montant: '0.00', statut: 'etabli' });
    const cession = valeur(p, '2054', 'B', 'INST_TECH', 'diminution_cession');
    expect(cession).toMatchObject({ montant: null, statut: 'a_saisir', codeCase: 'MJ' });
    expect(cession.motif).toMatch(/virements de poste à poste, cessions et mises hors service/);
    expect(valeur(p, '2054', 'B', 'INST_TECH', 'diminution_virement').montant).toBeNull();
    // Total général des diminutions ventilées : non établi (une ligne ne l'est pas), jamais une somme partielle.
    const total = valeur(p, '2054', 'B', 'TOTAL_GENERAL', 'diminution_cession');
    expect(total.montant).toBeNull();
    expect(total.motif).toMatch(/Total non établi/);
  });

  it('laisse à saisir les réévaluations et la valeur d’origine, sans valeur par défaut', () => {
    for (const [cadre, cle] of [['A', 'augmentation_reevaluation'], ['B', 'reevaluation_valeur_origine']] as const) {
      const c = valeur(p, '2054', cadre, 'TERRAINS', cle);
      expect(c.montant).toBeNull();
      expect(c.statut).toBe('a_saisir');
      expect(c.motif).not.toBeNull();
    }
    expect(ligne(p, '2054', 'A', 'CONSTR_PROPRE').dontComposants).toMatchObject({ codeCase: 'L9', montant: null, statut: 'a_saisir' });
    expect(ligne(p, '2054', 'A', 'INST_TECH').dontComposants?.codeCase).toBe('M3');
    expect(ligne(p, '2054', 'A', 'BUREAU').dontComposants).toBeNull();
  });

  it('calcule les amortissements : ouverture, dotations, diminutions, clôture', () => {
    expect(valeur(p, '2055', 'A', 'BUREAU', 'ouverture')).toMatchObject({ montant: '3500.00', codeCase: 'QL' });
    expect(valeur(p, '2055', 'A', 'BUREAU', 'dotations')).toMatchObject({ montant: '2000.00', codeCase: 'QM' });
    expect(valeur(p, '2055', 'A', 'BUREAU', 'diminutions')).toMatchObject({ montant: '0.00', codeCase: 'QN' });
    expect(valeur(p, '2055', 'A', 'BUREAU', 'cloture')).toMatchObject({ montant: '5500.00', codeCase: 'QO' });
    expect(valeur(p, '2055', 'A', 'INST_TECH', 'ouverture').montant).toBe('2500.00');
    expect(valeur(p, '2055', 'A', 'INST_TECH', 'dotations').montant).toBe('3000.00');
    expect(valeur(p, '2055', 'A', 'INST_TECH', 'diminutions').montant).toBe('2500.00');
    expect(valeur(p, '2055', 'A', 'INST_TECH', 'cloture').montant).toBe('3000.00');
    expect(valeur(p, '2055', 'A', 'TOTAL_GENERAL', 'cloture')).toMatchObject({ montant: '8500.00', codeCase: 'ØR' });
    expect(p.totaux).toEqual({ valeur_brute_cloture: '35000.00', amortissements_cloture: '8500.00', valeur_nette_cloture: '26500.00' });
  });

  it('les contrôles reprennent le projet de bilan et la dotation du compte 6811, sans rien ajuster', () => {
    expect(controle(p, 'valeur_brute_egale_projet_de_bilan')).toMatchObject({ statut: 'ok', ecart: '0.00' });
    expect(controle(p, 'dotations_egales_compte_6811')).toMatchObject({ statut: 'ok', ecart: '0.00' });
  });

  it('expose les mouvements de chaque compte (traçabilité) en chaînes décimales', () => {
    const l = ligne(p, '2054', 'A', 'BUREAU');
    expect(l.comptes.map((c) => c.compteNum)).toEqual(['218300', '218400']);
    expect(l.comptes[1]).toMatchObject({ ouverture: '0.00', augmentations: '5000.00', diminutions: '0.00', cloture: '5000.00' });
    for (const t of p.tableaux) for (const c of t.cadres) for (const x of c.lignes) for (const v of Object.values(x.cellules)) if (v.montant !== null) expect(v.montant).toMatch(/^-?\d+\.\d{2}$/);
  });
});

describe('colonne N-1', () => {
  it('reprend les mêmes cellules calculées sur l’exercice précédent contigu', () => {
    const p = projet(preparerTableauxImmobilisations(demande({ precedent: { lignes: lignes2025(), exercice: EX_N1 } })));
    expect(p.comparatif).toMatchObject({ statut: 'fourni', exercice: EX_N1 });
    expect(valeur(p, '2054', 'B', 'INST_TECH', 'cloture').n1).toBe('30000.00');
    expect(valeur(p, '2054', 'A', 'INST_TECH', 'augmentation_acquisitions').n1).toBe('30000.00');
    expect(valeur(p, '2055', 'A', 'BUREAU', 'cloture').n1).toBe('3500.00');
    expect(valeur(p, '2055', 'A', 'TOTAL_GENERAL', 'dotations').n1).toBe('4000.00');
    // Une cellule à saisir n'a pas de N-1 inventé.
    expect(valeur(p, '2054', 'A', 'TERRAINS', 'augmentation_reevaluation').n1).toBeNull();
    // Reprise : ouverture N = clôture N-1 (avant inventaire).
    expect(controle(p, 'ouverture_brute_egale_cloture_n1')).toMatchObject({ statut: 'ok', ecart: '0.00' });
    expect(controle(p, 'ouverture_amortissements_egale_cloture_n1')).toMatchObject({ statut: 'ok', ecart: '0.00' });
    expect(p.comparatif.statut === 'fourni' && p.comparatif.reserves.join(' ')).toMatch(/AVANT écritures d’inventaire/);
  });

  it('affiche l’écart de reprise sans le corriger', () => {
    const modifie = lignes2025().map((l) => (l.compteNum === '215000' ? { ...l, debit: '29000.00' } : l.compteNum === '512000' ? { ...l, credit: '29000.00' } : l));
    const p = projet(preparerTableauxImmobilisations(demande({ precedent: { lignes: modifie, exercice: EX_N1 } })));
    expect(controle(p, 'ouverture_brute_egale_cloture_n1')).toMatchObject({ statut: 'ecart', ecart: '1000.00' });
    expect(valeur(p, '2054', 'A', 'INST_TECH', 'ouverture').montant).toBe('30000.00');
  });

  it('est indisponible, avec son motif, sans exercice précédent, non contigu ou hors périmètre', () => {
    const sans = projet(preparerTableauxImmobilisations(demande()));
    expect(sans.comparatif.statut).toBe('indisponible');
    expect(valeur(sans, '2054', 'B', 'INST_TECH', 'cloture').n1).toBeNull();
    const nonContigu = projet(preparerTableauxImmobilisations(demande({ precedent: { lignes: lignes2025(), exercice: { debut: '2024-01-01', fin: '2024-12-31' } } })));
    expect(nonContigu.comparatif).toMatchObject({ statut: 'indisponible' });
    expect(nonContigu.comparatif.statut === 'indisponible' && nonContigu.comparatif.motifs[0]).toMatch(/n’est pas contigu/);
    const horsPeriode = projet(preparerTableauxImmobilisations({ ...demande({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, lignes: lignes2025() }), precedent: { lignes: [], exercice: { debut: '2024-01-01', fin: '2024-12-31' } } }));
    expect(horsPeriode.comparatif.statut === 'indisponible' && horsPeriode.comparatif.motifs[0]).toMatch(/sort du périmètre couvert|hors de la période/);
    expect(demande().precedent).toBeUndefined();
  });
});

describe('abstentions motivées', () => {
  it('sans journal d’à-nouveaux : ouverture et mouvements non établis, clôture établie, jamais zéro par défaut', () => {
    const p = projet(preparerTableauxImmobilisations(demande({ lignes: lignes2026(true) })));
    expect(p.aNouveauxIdentifies).toBe(false);
    const ouverture = valeur(p, '2054', 'A', 'BUREAU', 'ouverture');
    expect(ouverture).toMatchObject({ montant: null, statut: 'abstention' });
    expect(ouverture.motif).toMatch(/à-nouveaux non identifié/);
    expect(valeur(p, '2054', 'B', 'BUREAU', 'diminution_virement').montant).toBeNull();
    expect(valeur(p, '2054', 'B', 'BUREAU', 'cloture').montant).toBe('15000.00');
    expect(valeur(p, '2054', 'A', 'TOTAL_GENERAL', 'ouverture').montant).toBeNull();
    expect(valeur(p, '2055', 'A', 'BUREAU', 'dotations').montant).toBeNull();
    expect(valeur(p, '2055', 'A', 'BUREAU', 'cloture').montant).toBe('5500.00');
    expect(controle(p, 'dotations_egales_compte_6811')?.statut).toBe('non_verifiable');
    expect(p.manques.join(' ')).toMatch(/à-nouveaux non identifié/);
  });

  it('s’abstient sans aucun chiffre hors périmètre, comme la liasse', () => {
    const r = preparerTableauxImmobilisations(demande({ territoire: 'martinique', impotSurLeResultat: 'ir', societeCommerciale: null, referentielComptable: 'IFRS', devise: 'USD' }));
    expect(r.statut).toBe('abstention');
    if (r.statut === 'abstention') {
      expect(r.motifs.map((m) => m.code)).toEqual(['territoire_hors_perimetre', 'impot_hors_perimetre', 'forme_a_confirmer', 'referentiel_hors_perimetre', 'devise_hors_perimetre']);
      expect(JSON.stringify(r)).not.toMatch(/\d+\.\d{2}/);
    }
    expect(preparerTableauxImmobilisations(demande({ exercice: { debut: '2024-01-01', fin: '2024-12-31' } })).statut).toBe('abstention');
    expect(preparerTableauxImmobilisations(demande({ territoire: 'a_confirmer' })).statut).toBe('abstention');
  });

  it('présente à part, hors totaux, un compte qu’aucune ligne ne reprend', () => {
    const avecIntrus = [...lignes2026(), ...piece('2026-05-05', [['219000', '100.00', '0.00'], ['512000', '0.00', '100.00']])];
    const p = projet(preparerTableauxImmobilisations(demande({ lignes: avecIntrus })));
    const nv = ligne(p, '2054', 'B', 'NON_VENTILE');
    expect(nv.nature).toBe('non_ventile');
    expect(nv.comptes.map((c) => c.compteNum)).toEqual(['219000']);
    expect(nv.cellules['cloture']?.montant).toBe('100.00');
    expect(valeur(p, '2054', 'B', 'TOTAL_GENERAL', 'cloture').montant).toBe('35000.00');
    expect(controle(p, 'valeur_brute_egale_projet_de_bilan')).toMatchObject({ statut: 'ecart', ecart: '100.00' });
    expect(p.manques.join(' ')).toMatch(/1 compte\(s\) non ventilé\(s\) \(219000\)/);
  });
});

describe('fichier des immobilisations : rapprochement affiché, jamais corrigé', () => {
  const base: ImmobilisationAAmortir = { id: 'I-BUREAU', libelle: 'Ordinateurs', compteImmobilisation: '218300', baseAmortissable: '10000.00', dateMiseEnService: '2024-06-01', dureeMois: 60, amortissementsAnterieurs: '3500.00' };
  const technique: ImmobilisationAAmortir = { id: 'I-MACHINE', libelle: 'Machine A', compteImmobilisation: '215000', baseAmortissable: '30000.00', dateMiseEnService: '2025-03-10', dureeMois: 120, amortissementsAnterieurs: '2500.00' };
  const nouveau: ImmobilisationAAmortir = { id: 'I-NEUF', libelle: 'Poste neuf', compteImmobilisation: '218400', baseAmortissable: '5000.00', dateMiseEnService: '2026-02-15', dureeMois: 60 };

  it('sans fichier : aucune ligne « selon fichier », contrôles non vérifiables', () => {
    const p = projet(preparerTableauxImmobilisations(demande()));
    expect(p.fichier).toMatchObject({ fourni: false, nbImmobilisations: 0, rapprochementMoteur: null, abstentions: [] });
    expect(ligne(p, '2054', 'A', 'BUREAU').fichierBrut).toBeNull();
    expect(controle(p, 'fichier_valeurs_brutes')?.statut).toBe('non_verifiable');
    expect(p.manques.join(' ')).toMatch(/Aucune immobilisation saisie/);
  });

  it('rapproche valeurs brutes et dotations avec le moteur d’amortissements, avec écarts affichés', () => {
    const p = projet(preparerTableauxImmobilisations(demande({ immobilisations: [base, technique, nouveau] })));
    const bureau = ligne(p, '2054', 'A', 'BUREAU').fichierBrut;
    expect(bureau).toMatchObject({ nbImmobilisations: 2, valeurBruteOuverture: '10000.00', valeurBruteCloture: '15000.00', ecartOuverture: '0.00', ecartCloture: '0.00', nbDonneesManquantes: 0 });
    // La machine a été cédée en partie : le fichier garde 30 000, la balance 20 000 (écart affiché, rien de corrigé).
    const machine = ligne(p, '2054', 'A', 'INST_TECH').fichierBrut;
    expect(machine).toMatchObject({ valeurBruteCloture: '30000.00', ecartCloture: '-10000.00', ecartOuverture: '0.00' });
    expect(valeur(p, '2054', 'B', 'INST_TECH', 'cloture').montant).toBe('20000.00');
    expect(controle(p, 'fichier_valeurs_brutes')).toMatchObject({ statut: 'ecart', ecart: '-10000.00' });
    // Amortissements : ouverture selon fichier, dotation du moteur et dotation comptabilisée.
    const amort = ligne(p, '2055', 'A', 'BUREAU').fichierAmortissements;
    expect(amort).toMatchObject({ amortissementsOuverture: '3500.00', ecartOuverture: '0.00', dotationComptabilisee: '2000.00', calculComplet: true });
    // 10 000 sur 60 mois (360/1800 du plan) = 2 000,00 ; 5 000 mis en service le 15/02 : 316 jours de 30/360 sur 1 800 = 877,78.
    expect(amort?.dotationCalculee).toBe('2877.78');
    expect(amort?.ecartDotation).toBe('-877.78');
    expect(p.fichier.rapprochementMoteur?.comptes.length).toBeGreaterThan(0);
    expect(controle(p, 'fichier_dotations')?.statut).toBe('ecart');
  });

  it('s’abstient sur une immobilisation sans date de mise en service, sans la deviner', () => {
    const sansDate: ImmobilisationAAmortir = { ...base, id: 'I-SANS-DATE', libelle: 'Sans date', dateMiseEnService: null };
    const p = projet(preparerTableauxImmobilisations(demande({ immobilisations: [sansDate] })));
    const f = ligne(p, '2054', 'A', 'BUREAU').fichierBrut;
    expect(f).toMatchObject({ nbDonneesManquantes: 1, valeurBruteOuverture: null, valeurBruteCloture: null, ecartCloture: null });
    expect(f?.motifs.join(' ')).toMatch(/date de mise en service absente/);
    expect(p.fichier.abstentions.find((a) => a.immobilisation === 'I-SANS-DATE')?.code).toBe('donnee_manquante');
    expect(controle(p, 'fichier_valeurs_brutes')?.statut).toBe('ecart');
    expect(controle(p, 'fichier_valeurs_brutes')?.message).toMatch(/Installations techniques/);
  });

  it('signale sortie d’actif et composants sans les traiter, et garde le dégressif non activé', () => {
    const sortie: ImmobilisationAAmortir = { ...technique, id: 'I-SORTIE', libelle: 'Machine B', baseAmortissable: '10000.00', dateSortie: '2026-04-30' };
    const composant: ImmobilisationAAmortir = { ...base, id: 'I-COMP', libelle: 'Composant', compteImmobilisation: '213500', baseAmortissable: '1000.00', composantDe: 'I-STRUCTURE' };
    const degressif: ImmobilisationAAmortir = { ...base, id: 'I-DEG', libelle: 'Matériel dégressif', compteImmobilisation: '215000', baseAmortissable: '9000.00', dateAcquisition: '2026-01-10', modeAmortissement: 'degressif', coefficientDegressif: '1.75', eligibiliteDegressifConfirmee: true, justificationDegressif: 'Matériel neuf de 5 ans, fiche fictive du cabinet.', dureeMois: 60, dateMiseEnService: '2026-01-10' };
    const p = projet(preparerTableauxImmobilisations(demande({ immobilisations: [technique, sortie, composant, degressif] })));
    const t = ligne(p, '2054', 'A', 'INST_TECH').fichierBrut;
    expect(t?.sortiesDansExercice).toEqual({ nombre: 1, valeurBrute: '10000.00' });
    expect(t?.motifs.join(' ')).toMatch(/1 sortie\(s\) d’actif saisie\(s\) dans l’exercice/);
    expect(ligne(p, '2054', 'A', 'CONSTR_INST').fichierBrut).toMatchObject({ composants: { nombre: 1, valeurBrute: '1000.00' }, ecartCloture: '-1000.00' });
    const codes = p.fichier.abstentions.map((a) => `${a.immobilisation}:${a.code}`);
    expect(codes).toContain('I-SORTIE:sortie_d_actif');
    expect(codes).toContain('I-DEG:degressif_non_active');
    expect(p.fichier.degressif.active).toBe(false);
    expect(p.fichier.degressif.motif).toMatch(/non activé/);
    // Aucune dotation dégressive n'est calculée tant que le calcul n'est pas activé.
    expect(ligne(p, '2055', 'A', 'INST_TECH').fichierAmortissements?.calculComplet).toBe(false);
  });
});

describe('2033-C : régime simplifié', () => {
  const p = projet(preparerTableauxImmobilisations(demande({ regime: 'reel_simplifie', precedent: { lignes: lignes2025(), exercice: EX_N1 } })));

  it('prépare les cadres I et II avec les codes numériques du formulaire, et laisse le cadre III non préparé', () => {
    expect(p.tableaux.map((t) => t.code)).toEqual(['2033-C']);
    expect(tableau(p, '2033-C').cadres.map((c) => c.id)).toEqual(['I', 'II']);
    expect(tableau(p, '2033-C').cadresNonCouverts).toEqual([expect.objectContaining({ cadre: 'III' })]);
    expect(valeur(p, '2033-C', 'I', 'INST_TECH', 'ouverture')).toMatchObject({ montant: '30000.00', codeCase: '440' });
    expect(valeur(p, '2033-C', 'I', 'INST_TECH', 'diminutions')).toMatchObject({ montant: '10000.00', codeCase: '444' });
    expect(valeur(p, '2033-C', 'I', 'INST_TECH', 'cloture')).toMatchObject({ montant: '20000.00', codeCase: '446' });
    expect(valeur(p, '2033-C', 'I', 'AUTRES_CORPO', 'cloture').montant).toBe('15000.00');
    expect(valeur(p, '2033-C', 'I', 'TOTAL', 'cloture')).toMatchObject({ montant: '35000.00', codeCase: '496' });
    expect(valeur(p, '2033-C', 'I', 'TOTAL', 'reevaluation_valeur_origine')).toMatchObject({ montant: null, codeCase: null, etatCodeCase: 'a_confirmer', statut: 'a_saisir' });
    expect(valeur(p, '2033-C', 'II', 'TOTAL', 'cloture')).toMatchObject({ montant: '8500.00', codeCase: '576' });
    expect(valeur(p, '2033-C', 'II', 'AUTRES_CORPO', 'dotations')).toMatchObject({ montant: '2000.00', codeCase: '562' });
    expect(p.totaux).toEqual({ valeur_brute_cloture: '35000.00', amortissements_cloture: '8500.00', valeur_nette_cloture: '26500.00' });
  });

  it('porte N-1 et ses contrôles comme le régime normal', () => {
    expect(valeur(p, '2033-C', 'I', 'INST_TECH', 'cloture').n1).toBe('30000.00');
    expect(controle(p, 'ouverture_brute_egale_cloture_n1')).toMatchObject({ statut: 'ok' });
    expect(controle(p, 'ouverture_amortissements_egale_cloture_n1')).toMatchObject({ statut: 'ok' });
    expect(controle(p, 'valeur_brute_egale_projet_de_bilan')).toMatchObject({ statut: 'ok' });
  });

  it('range les frais d’établissement avec les autres immobilisations incorporelles, en le disant', () => {
    const avecFrais = [...lignes2026(), ...piece('2026-03-03', [['201000', '700.00', '0.00'], ['512000', '0.00', '700.00']])];
    const r = projet(preparerTableauxImmobilisations(demande({ regime: 'reel_simplifie', lignes: avecFrais })));
    expect(valeur(r, '2033-C', 'I', 'AUTRES_INCORP', 'cloture').montant).toBe('700.00');
    expect(ligne(r, '2033-C', 'I', 'AUTRES_INCORP').note).toMatch(/frais d’établissement/);
  });
});

describe('codes de cases et sources', () => {
  it('chaque case lue est unique par tableau et marquée « lue, à confirmer »', () => {
    for (const regime of ['reel_normal', 'reel_simplifie'] as const) {
      const p = projet(preparerTableauxImmobilisations(demande({ regime })));
      const codes: string[] = [];
      for (const t of p.tableaux) {
        for (const c of t.cadres) for (const l of c.lignes) for (const v of Object.values(l.cellules)) {
          if (v.codeCase !== null) { expect(v.etatCodeCase).toBe('lu_a_confirmer'); codes.push(`${t.code}/${c.id}/${v.codeCase}`); } else expect(v.etatCodeCase).toBe('a_confirmer');
        }
      }
      expect(new Set(codes).size).toBe(codes.length);
      expect(p.sources.some((s) => /SHA-256/.test(s.reference))).toBe(true);
      expect(p.sources.some((s) => /Convention interne/.test(s.reference))).toBe(true);
    }
  });

  it('un code de case n’est jamais avancé pour une cellule qui n’en a pas lu', () => {
    const p = projet(preparerTableauxImmobilisations(demande()));
    for (const t of p.tableaux) for (const c of t.cadres) for (const l of c.lignes) for (const [cle, v] of Object.entries(l.cellules)) if (v.codeCase === null) expect(['diminutions_totales', 'reevaluation_valeur_origine'].includes(cle) || l.nature === 'non_ventile', `${t.code} ${c.id} ${l.id} ${cle}`).toBe(true);
  });
});

describe('cellules saisies : réévaluation, ventilation des diminutions, « dont composants » (D-134)', () => {
  const TRACE = { note: 'Registre des immobilisations (essai)', qualifieePar: 'u-1', le: '2026-12-31T10:00:00Z', versionDonnees: 7 };
  const rang = (cadre: 'A' | 'B', id: string) => lignesSaisieImmobilisations('reel_normal').find((l) => l.cadre === cadre && l.ligneId === id)!.ligne;
  const saisie = (ligne: string, valeurs: Record<string, string>, v = 7) => ({ ligne, valeurs, ...TRACE, versionDonnees: v });
  const avec = (saisies: ReturnType<typeof saisie>[]) => projet(preparerTableauxImmobilisations(demande({ saisiesCellules: saisies, versionDonnees: 7 })));

  it('lignes saisissables : postes seulement, colonnes de la balance exclues, « dont composants » aux lignes qui en portent', () => {
    const l = lignesSaisieImmobilisations('reel_normal');
    expect(l.filter((x) => x.cadre === 'A')).toHaveLength(17);
    expect(l.every((x) => !x.ligneId.startsWith('TOTAL'))).toBe(true);
    expect(l.find((x) => x.ligne === rang('A', 'CONSTR_PROPRE'))!.colonnes.map((c) => c.cle)).toEqual(['augmentation_reevaluation', 'dont_composants']);
    expect(l.find((x) => x.ligne === rang('B', 'TERRAINS'))!.colonnes.map((c) => c.cle)).toEqual(['diminution_virement', 'diminution_cession', 'reevaluation_valeur_origine']);
    expect(lignesSaisieImmobilisations('reel_simplifie').map((x) => x.ligne)[0]).toBe('I01');
  });
  it('sans saisie : cellules à saisir ; la ventilation saisie établit les cellules et le contrôle indicatif la rapproche de la balance, sans correction', () => {
    const sans = projet(preparerTableauxImmobilisations(demande()));
    expect(valeur(sans, '2054', 'B', 'INST_TECH', 'diminution_cession').statut).toBe('a_saisir');
    expect(p2(sans)).toBe(true);
    const ok = avec([saisie(rang('B', 'INST_TECH'), { diminution_virement: '0.00', diminution_cession: '10000.00' })]);
    expect(valeur(ok, '2054', 'B', 'INST_TECH', 'diminution_cession')).toMatchObject({ statut: 'etabli', montant: '10000.00' });
    expect(controle(ok, 'ventilation_diminutions_INST_TECH')?.statut).toBe('ok');
    const ko = avec([saisie(rang('B', 'INST_TECH'), { diminution_virement: '0.00', diminution_cession: '9000.00' })]);
    expect(controle(ko, 'ventilation_diminutions_INST_TECH')).toMatchObject({ statut: 'ecart', ecart: '-1000.00' });
    expect(valeur(ko, '2054', 'B', 'INST_TECH', 'diminutions_totales').montant).toBe('10000.00');
  });
  it('réévaluation et « dont composants » saisis ; saisie sur une autre version des données : à revoir, non retenue', () => {
    const p = avec([saisie(rang('A', 'CONSTR_PROPRE'), { augmentation_reevaluation: '1200.00', dont_composants: '300.00' })]);
    expect(valeur(p, '2054', 'A', 'CONSTR_PROPRE', 'augmentation_reevaluation')).toMatchObject({ statut: 'etabli', montant: '1200.00' });
    expect(ligne(p, '2054', 'A', 'CONSTR_PROPRE').dontComposants).toMatchObject({ statut: 'etabli', montant: '300.00', motif: null });
    expect(ligne(p, '2054', 'A', 'CONSTR_AUTRUI').dontComposants?.statut).toBe('a_saisir');
    const vieux = avec([saisie(rang('A', 'CONSTR_PROPRE'), { augmentation_reevaluation: '1200.00' }, 3)]);
    expect(valeur(vieux, '2054', 'A', 'CONSTR_PROPRE', 'augmentation_reevaluation').statut).toBe('a_saisir');
    expect(vieux.saisiesCellules.find((x) => x.ligne === rang('A', 'CONSTR_PROPRE'))?.statut).toBe('a_revoir');
  });
  it('le total de la colonne saisie n’est établi que lorsque toutes les lignes sont saisies', () => {
    const lignes = lignesSaisieImmobilisations('reel_normal').filter((l) => l.cadre === 'A');
    const toutes = lignes.map((l) => saisie(l.ligne, { augmentation_reevaluation: '0.00' }));
    expect(valeur(avec(toutes.slice(1)), '2054', 'A', 'TOTAL_GENERAL', 'augmentation_reevaluation').statut).toBe('a_saisir');
    expect(valeur(avec(toutes), '2054', 'A', 'TOTAL_GENERAL', 'augmentation_reevaluation')).toMatchObject({ statut: 'etabli', montant: '0.00' });
  });
  it('2033-C cadre I : valeur d’origine réévaluée saisie par ligne', () => {
    const p = projet(preparerTableauxImmobilisations({ ...demande({ regime: 'reel_simplifie', saisiesCellules: [saisie('I03', { reevaluation_valeur_origine: '500.00' })], versionDonnees: 7 }) }));
    expect(p.saisiesCellules.find((x) => x.ligne === 'I03')?.statut).toBe('saisi');
    expect(valeur(p, '2033-C', 'I', 'TERRAINS', 'reevaluation_valeur_origine')).toMatchObject({ statut: 'etabli', montant: '500.00' });
  });
  it('forme des saisies', () => {
    expect(validerSaisieTableau('IMMO_CELL', rang('B', 'TERRAINS'), { diminution_cession: '5.00' })).toEqual([]);
    expect(validerSaisieTableau('IMMO_CELL', rang('B', 'TERRAINS'), {}).join(' ')).toMatch(/Au moins une cellule/);
    expect(validerSaisieTableau('IMMO_CELL', rang('B', 'TERRAINS'), { dont_composants: '1.00' }).join(' ')).toMatch(/non saisissable/);
    expect(validerSaisieTableau('IMMO_CELL', rang('B', 'TERRAINS'), { diminution_cession: '-1.00' }).join(' ')).toMatch(/positif/);
    expect(validerSaisieTableau('IMMO_CELL', 'B99', { diminution_cession: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
    expect(validerSaisieTableau('IMMO_CELL', 'A21', { augmentation_reevaluation: '1.00' }).join(' ')).toMatch(/Ligne inconnue/);
  });
});
const p2 = (p: TableauxImmobilisationsProjet) => p.saisiesCellules.every((x) => x.statut === 'a_saisir');

