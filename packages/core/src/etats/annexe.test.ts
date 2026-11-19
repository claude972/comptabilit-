/** Recette du projet d'annexe : rubriques du PCG, pré-remplissage, statuts, allègements, complétude. */
import { describe, expect, it } from 'vitest';
import { jeuPrincipal, piece } from '../jeux-etats-tests.js';
import {
  ARTICLES_ANNEXE, type AnnexeProjet, type DemandeAnnexe, type ResultatAnnexe, type RubriqueAnnexe, SEUILS_TAILLE_PAR_DEFAUT, articlesRequisPourCategorie, evaluerCategorieTaille, preparerAnnexe,
} from './annexe.js';

const EXERCICE = { debut: '2025-01-01', fin: '2025-12-31' };
const demande = (surcharge: Partial<DemandeAnnexe> = {}): DemandeAnnexe => ({ lignes: jeuPrincipal(2025), exercice: EXERCICE, referentielComptable: 'PCG', categorie: 'petite_entreprise', ...surcharge });
function projet(r: ResultatAnnexe): AnnexeProjet {
  if (r.statut !== 'projet') throw new Error(`Projet attendu, abstention reçue : ${r.motifs.map((m) => m.code).join(', ')}`);
  return r;
}
const rubrique = (p: AnnexeProjet, id: string): RubriqueAnnexe => {
  const r = p.rubriques.find((x) => x.id === id);
  if (r === undefined) throw new Error(`Rubrique absente : ${id}`);
  return r;
};
const ligneDe = (r: RubriqueAnnexe, tableau: number, rubriquePcg: string | null) => r.preRemplissage[tableau]?.lignes.find((l) => l.rubriquePcg === rubriquePcg);

describe('modèle de l’annexe', () => {
  it('couvre les articles 831-1 à 838-19 du PCG, une rubrique par article', () => {
    expect(ARTICLES_ANNEXE).toHaveLength(59);
    expect(new Set(ARTICLES_ANNEXE).size).toBe(59);
    expect(ARTICLES_ANNEXE[0]).toBe('831-1');
    expect(ARTICLES_ANNEXE.at(-1)).toBe('838-19');
    expect(ARTICLES_ANNEXE.filter((a) => a.startsWith('832-'))).toHaveLength(21);
    expect(ARTICLES_ANNEXE.filter((a) => a.startsWith('838-'))).toHaveLength(19);
  });

  it('applique les listes des articles 811-8 et 811-9', () => {
    const simplifie = articlesRequisPourCategorie('personne_morale_regime_simplifie', ARTICLES_ANNEXE).articles;
    expect(simplifie.filter((a) => !a.startsWith('838-'))).toEqual(['831-1', '831-2', '832-1', '832-3', '832-8', '832-9', '832-12', '832-13', '832-15', '834-2', '836-1', '836-3', '836-5']);
    expect(simplifie.filter((a) => a.startsWith('838-'))).toHaveLength(19);
    const petite = articlesRequisPourCategorie('petite_entreprise', ARTICLES_ANNEXE).articles;
    expect(petite).toContain('837-1');
    expect(petite).toContain('832-21');
    for (const absent of ['831-3', '831-4', '832-16', '832-18', '832-20', '833-3', '833-4', '834-1', '835-2', '836-4', '837-2']) expect(petite, absent).not.toContain(absent);
    const grande = articlesRequisPourCategorie('moyenne_ou_grande_entreprise', ARTICLES_ANNEXE).articles;
    expect(grande).toHaveLength(58);
    expect(grande).not.toContain('834-2');
    expect(articlesRequisPourCategorie('a_confirmer', ARTICLES_ANNEXE).articles).toHaveLength(59);
  });
});

describe('projet d’annexe d’une petite entreprise', () => {
  const p = projet(preparerAnnexe(demande()));

  it('est un projet jamais complet tant qu’une rubrique requise n’est pas confirmée', () => {
    expect(p.statut).toBe('projet');
    expect(p.complet).toBe(false);
    expect(p.forme).toBe('annexe');
    expect(p.seuilsAConfirmer).toBe(true);
    expect(p.aNouveauxIdentifies).toBe(true);
    expect(p.mention).toMatch(/en attente de validation professionnelle/);
    expect(p.rubriques).toHaveLength(59);
    expect(p.rubriques.every((r) => /^PCG \(règlement ANC n° 2014-03\), art\. 83\d-\d+$/.test(r.reference))).toBe(true);
    expect(p.rubriques.filter((r) => r.requise)).toHaveLength(29 + 19);
    expect(p.manques).toHaveLength(48);
    expect(p.manques[0]).toMatch(/^ANX-831-1 « Règles et méthodes comptables » \(PCG \(règlement ANC n° 2014-03\), art\. 831-1\) : à compléter\.$/);
    expect(p.sources.map((s) => s.verification)).toEqual(['verifiee', 'verifiee', 'verifiee', 'non_verifiee', 'verifiee']);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('pré-remplit les tableaux des immobilisations et des amortissements à partir des écritures', () => {
    const r = rubrique(p, 'ANX-832-1');
    expect(r.statut).toBe('pre_rempli');
    expect(r.requise).toBe(true);
    expect(r.preRemplissage.map((t) => t.titre)).toEqual(['Tableau des immobilisations - Cadre général', 'Tableau des amortissements - Cadre général']);
    expect(ligneDe(r, 0, 'A_AUTRES_CORPORELLES')).toMatchObject({
      libelle: 'Autres immobilisations corporelles', valeurs: { ouverture: '10000.00', augmentations: '0.00', diminutions: '0.00', cloture: '10000.00' },
      comptes: [{ compteNum: '218300', compteLib: 'Compte 218300', solde: '10000.00' }], estTotal: false,
    });
    expect(ligneDe(r, 1, 'A_AUTRES_CORPORELLES')?.valeurs).toEqual({ ouverture: '2000.00', augmentations: '2000.00', diminutions: '0.00', cloture: '4000.00' });
    expect(r.preRemplissage[1]?.lignes.at(-1)).toMatchObject({ libelle: 'Total', estTotal: true, valeurs: { cloture: '4000.00' } });
    expect(r.aSaisir.join(' ')).toMatch(/modes d’amortissement/);
    expect(r.preRemplissage[0]?.reserves[0]).toMatch(/virements de poste à poste/);
  });

  it('pré-remplit stocks, créances, dettes et capitaux propres, en laissant à saisir ce qui ne se déduit pas', () => {
    const stocks = rubrique(p, 'ANX-832-7');
    expect(stocks.statut).toBe('pre_rempli');
    expect(ligneDe(stocks, 0, 'A_STOCKS_MARCHANDISES')?.valeurs).toEqual({ cloture: '7000.00', ouverture: '5000.00' });

    const creances = rubrique(p, 'ANX-832-9');
    expect(creances.statut).toBe('pre_rempli');
    expect(creances.preRemplissage[0]?.colonnes).toEqual([
      { cle: 'montant', libelle: 'Montant brut', aSaisir: false }, { cle: 'aUnAnAuPlus', libelle: 'Échéance à un an au plus', aSaisir: true }, { cle: 'aPlusDunAn', libelle: 'Échéance à plus d’un an', aSaisir: true },
    ]);
    expect(ligneDe(creances, 0, 'A_CLIENTS')?.valeurs).toEqual({ montant: '18000.00', aUnAnAuPlus: null, aPlusDunAn: null });
    expect(ligneDe(creances, 0, 'A_AUTRES_CREANCES')?.valeurs['montant']).toBe('7200.00');
    expect(ligneDe(creances, 0, null)).toMatchObject({ libelle: 'Total', valeurs: { montant: '25200.00', aUnAnAuPlus: null } });

    const dettes = rubrique(p, 'ANX-832-15');
    expect(dettes.preRemplissage[0]?.lignes.map((l) => [l.rubriquePcg, l.valeurs['montant']])).toEqual([
      ['P_EMPRUNTS_ETABLISSEMENTS_CREDIT', '12000.00'], ['P_FOURNISSEURS', '9000.00'], ['P_DETTES_FISCALES_SOCIALES', '16500.00'], [null, '37500.00'],
    ]);
    expect(ligneDe(dettes, 0, 'P_FOURNISSEURS')?.valeurs).toEqual({ montant: '9000.00', aUnAnAuPlus: null, dePlusDunAnACinqAns: null, aPlusDeCinqAns: null });

    const capitaux = rubrique(p, 'ANX-832-11');
    expect(ligneDe(capitaux, 0, 'P_CAPITAL')?.valeurs).toEqual({ ouverture: '20000.00', augmentations: '0.00', diminutions: '0.00', cloture: '20000.00' });
    expect(ligneDe(capitaux, 0, 'P_RESERVE_LEGALE')?.valeurs['cloture']).toBe('1000.00');
    expect(capitaux.aSaisir[0]).toMatch(/Nombre et valeur nominale/);

    const ca = rubrique(p, 'ANX-832-18');
    expect(ca.requise).toBe(false);
    expect(ca.statut).toBe('non_applicable_a_confirmer');
    expect(ca.preRemplissage).toEqual([]);
  });

  it('distingue « à compléter » et « non applicable, à confirmer »', () => {
    for (const id of ['ANX-831-1', 'ANX-831-2', 'ANX-833-1', 'ANX-833-2', 'ANX-834-2', 'ANX-835-1', 'ANX-836-1', 'ANX-836-2', 'ANX-836-5', 'ANX-837-1', 'ANX-832-13']) {
      expect(rubrique(p, id), id).toMatchObject({ requise: true, statut: 'a_completer', preRemplissage: [], confirmation: null });
    }
    // Objet absent de la balance : présumé sans objet, jamais « non applicable » tout court.
    for (const id of ['ANX-832-3', 'ANX-832-4', 'ANX-832-5', 'ANX-832-6', 'ANX-832-8', 'ANX-832-10', 'ANX-832-12', 'ANX-832-14', 'ANX-832-17', 'ANX-832-21', 'ANX-836-3', 'ANX-838-1', 'ANX-838-18', 'ANX-838-19']) {
      expect(rubrique(p, id), id).toMatchObject({ requise: true, statut: 'non_applicable_a_confirmer' });
    }
    expect(rubrique(p, 'ANX-832-3').motifStatut).toMatch(/Aucun écart de réévaluation/);
    expect(rubrique(p, 'ANX-837-1').aSaisir).toEqual(['Effectif moyen employé pendant l’exercice.']);
    expect(rubrique(p, 'ANX-831-1').aSaisir.join(' ')).toMatch(/Événements postérieurs à la clôture/);
    // Non requis pour une petite entreprise.
    for (const id of ['ANX-831-4', 'ANX-832-16', 'ANX-832-20', 'ANX-835-2', 'ANX-837-2']) expect(rubrique(p, id), id).toMatchObject({ requise: false, statut: 'non_applicable_a_confirmer' });
  });

  it('repère les objets présents dans les écritures', () => {
    const lignes = [
      ...jeuPrincipal(2025),
      ...piece('2025-03-01', [['612200', '900.00', '0.00'], ['512000', '0.00', '900.00']]),
      ...piece('2025-12-31', [['681500', '1500.00', '0.00'], ['151100', '0.00', '1500.00']]),
      ...piece('2025-12-31', [['486000', '300.00', '0.00'], ['613000', '0.00', '300.00']]),
      ...piece('2025-12-31', [['606000', '250.00', '0.00'], ['408100', '0.00', '250.00']]),
      ...piece('2025-12-31', [['671000', '80.00', '0.00'], ['512000', '0.00', '80.00']]),
      ...piece('2025-12-31', [['512000', '4000.00', '0.00'], ['167400', '0.00', '4000.00']]),
    ];
    const q = projet(preparerAnnexe(demande({ lignes })));
    expect(rubrique(q, 'ANX-836-3')).toMatchObject({ statut: 'pre_rempli' });
    expect(rubrique(q, 'ANX-836-3').motifStatut).toMatch(/crédit-bail \(compte 612\)/);
    const provisions = rubrique(q, 'ANX-832-13');
    expect(provisions.statut).toBe('pre_rempli');
    expect(ligneDe(provisions, 0, 'P_PROVISIONS_RISQUES')?.valeurs).toEqual({ ouverture: '0.00', augmentations: '1500.00', diminutions: '0.00', cloture: '1500.00', reprisesUtilisees: null, reprisesNonUtilisees: null });
    expect(rubrique(q, 'ANX-832-14').statut).toBe('pre_rempli');
    expect(ligneDe(rubrique(q, 'ANX-832-10'), 0, 'A_CHARGES_CONSTATEES_AVANCE')?.valeurs).toEqual({ montant: '300.00' });
    const rattachement = rubrique(q, 'ANX-832-19');
    expect(rattachement.preRemplissage[0]?.lignes.map((l) => [l.libelle, l.valeurs['montant']])).toEqual([
      ['Charges à payer : fournisseurs - factures non parvenues (408)', '250.00'], ['Charges constatées d’avance (486)', '300.00'],
    ]);
    expect(ligneDe(rubrique(q, 'ANX-832-21'), 0, 'CX')?.valeurs).toEqual({ montant: '80.00' });
    expect(ligneDe(rubrique(q, 'ANX-838-18'), 0, 'P_AVANCES_CONDITIONNEES')?.valeurs).toEqual({ montant: '4000.00' });
  });

  it('n’est complet que si chaque rubrique requise est confirmée par le cabinet', () => {
    const requises = p.rubriques.filter((r) => r.requise).map((r) => r.id);
    const toutes = Object.fromEntries(requises.map((id): [string, 'complete' | 'non_applicable'] => [id, id.startsWith('ANX-838') ? 'non_applicable' : 'complete']));
    const complet = projet(preparerAnnexe(demande({ confirmations: toutes })));
    expect(complet.complet).toBe(true);
    expect(complet.manques).toEqual([]);
    expect(complet.statut).toBe('projet');
    expect(rubrique(complet, 'ANX-838-4').confirmation).toBe('non_applicable');
    expect(rubrique(complet, 'ANX-832-1')).toMatchObject({ statut: 'pre_rempli', confirmation: 'complete' });

    const { 'ANX-837-1': _retiree, ...presqueToutes } = toutes;
    const incomplet = projet(preparerAnnexe(demande({ confirmations: presqueToutes })));
    expect(incomplet.complet).toBe(false);
    expect(incomplet.manques).toEqual(['ANX-837-1 « Effectif employé pendant l’exercice » (PCG (règlement ANC n° 2014-03), art. 837-1) : à compléter.']);

    const inconnue = projet(preparerAnnexe(demande({ confirmations: { ...toutes, 'ANX-999-9': 'complete' } })));
    expect(inconnue.complet).toBe(false);
    expect(inconnue.manques).toEqual(['Confirmation ignorée : ANX-999-9 ne désigne aucune rubrique de ce projet.']);
  });
});

describe('allègements et cas limites', () => {
  it('applique la liste réduite du régime simplifié', () => {
    const p = projet(preparerAnnexe(demande({ categorie: 'personne_morale_regime_simplifie' })));
    expect(p.rubriques.filter((r) => r.requise && !r.article.startsWith('838-')).map((r) => r.article)).toEqual(['831-1', '831-2', '832-1', '832-3', '832-8', '832-9', '832-12', '832-13', '832-15', '834-2', '836-1', '836-3', '836-5']);
    expect(rubrique(p, 'ANX-832-7')).toMatchObject({ requise: false, statut: 'non_applicable_a_confirmer', preRemplissage: [] });
    expect(rubrique(p, 'ANX-832-7').motifApplicabilite).toMatch(/art\. 811-8/);
  });

  it('exige tout pour une moyenne ou grande entreprise, et par prudence quand la catégorie est à confirmer', () => {
    const grande = projet(preparerAnnexe(demande({ categorie: 'moyenne_ou_grande_entreprise' })));
    expect(grande.rubriques.filter((r) => !r.requise).map((r) => r.id)).toEqual(['ANX-834-2']);
    expect(rubrique(grande, 'ANX-832-18')).toMatchObject({ requise: true, statut: 'pre_rempli' });
    expect(ligneDe(rubrique(grande, 'ANX-832-18'), 0, null)?.valeurs).toEqual({ montant: '60000.00' });
    const inconnue = projet(preparerAnnexe(demande({ categorie: 'a_confirmer' })));
    expect(inconnue.rubriques.every((r) => r.requise)).toBe(true);
    expect(inconnue.manques.at(-1)).toMatch(/Catégorie de taille à confirmer/);
  });

  it('remplace l’annexe par les six mentions de l’article 811-7 pour une micro-entreprise dispensée', () => {
    const p = projet(preparerAnnexe(demande({ categorie: 'micro_entreprise', dispenseAnnexeMicro: true })));
    expect(p.forme).toBe('mentions_a_la_suite_du_bilan');
    expect(p.rubriques.map((r) => r.id)).toEqual(['ANX-811-7-1', 'ANX-811-7-2', 'ANX-811-7-3', 'ANX-811-7-4', 'ANX-811-7-5', 'ANX-811-7-6']);
    expect(p.rubriques.slice(0, 5).every((r) => r.requise && r.statut === 'a_completer')).toBe(true);
    expect(rubrique(p, 'ANX-811-7-6').statut).toBe('non_applicable_a_confirmer');
    expect(p.complet).toBe(false);
    expect(p.reserves.join(' ')).toMatch(/L\. 123-16-1, non relu/);
    // Sans dispense, la micro-entreprise établit l'annexe de la petite entreprise ; la dispense est ignorée pour une autre catégorie.
    expect(projet(preparerAnnexe(demande({ categorie: 'micro_entreprise' }))).rubriques).toHaveLength(59);
    const ignoree = projet(preparerAnnexe(demande({ categorie: 'petite_entreprise', dispenseAnnexeMicro: true })));
    expect(ignoree.forme).toBe('annexe');
    expect(ignoree.reserves.at(-1)).toMatch(/elle est ignorée/);
  });

  it('ne calcule ni ouverture ni mouvements sans journal d’à-nouveaux identifié', () => {
    const p = projet(preparerAnnexe(demande({ journauxANouveaux: ['XX'] })));
    expect(p.aNouveauxIdentifies).toBe(false);
    const r = rubrique(p, 'ANX-832-1');
    expect(ligneDe(r, 0, 'A_AUTRES_CORPORELLES')?.valeurs).toEqual({ ouverture: null, augmentations: null, diminutions: null, cloture: '10000.00' });
    expect(r.preRemplissage[0]?.reserves[0]).toMatch(/à-nouveaux non identifié/);
  });

  it('traite un jeu vide et s’abstient hors périmètre', () => {
    const vide = projet(preparerAnnexe(demande({ lignes: [] })));
    expect(vide.complet).toBe(false);
    expect(vide.rubriques.every((r) => r.preRemplissage.length === 0 && r.statut !== 'pre_rempli')).toBe(true);
    expect(rubrique(vide, 'ANX-832-1').statut).toBe('non_applicable_a_confirmer');
    expect(rubrique(vide, 'ANX-831-1').statut).toBe('a_completer');

    expect(preparerAnnexe(demande({ referentielComptable: 'IFRS' }))).toMatchObject({ statut: 'abstention', motifs: [{ code: 'referentiel_hors_perimetre' }] });
    expect(preparerAnnexe(demande({ exercice: { debut: '2024-01-01', fin: '2024-12-31' } }))).toMatchObject({ statut: 'abstention', motifs: [{ code: 'exercice_hors_periode' }] });
    expect(preparerAnnexe(demande({ exercice: { debut: '2025-13-01', fin: '2025-12-31' } }))).toMatchObject({ statut: 'abstention', motifs: [{ code: 'exercice_invalide' }] });
    expect(preparerAnnexe(demande({ referentielComptable: 'IFRS' }))).not.toHaveProperty('rubriques');
  });

  it('ne retient que les écritures jusqu’à la clôture', () => {
    const lignes = [...jeuPrincipal(2025), ...piece('2026-01-15', [['218300', '5000.00', '0.00'], ['404000', '0.00', '5000.00']])];
    const p = projet(preparerAnnexe(demande({ lignes })));
    expect(ligneDe(rubrique(p, 'ANX-832-1'), 0, 'A_AUTRES_CORPORELLES')?.valeurs['cloture']).toBe('10000.00');
  });
});

describe('aide au classement par taille (seuils à confirmer)', () => {
  it('marque les seuils par défaut comme à confirmer et cite sa source', () => {
    expect(SEUILS_TAILLE_PAR_DEFAUT.etat).toBe('seuil_a_confirmer');
    expect(SEUILS_TAILLE_PAR_DEFAUT.micro).toEqual({ totalBilan: '450000.00', chiffreAffairesNet: '900000.00', effectifMoyen: 10 });
    expect(SEUILS_TAILLE_PAR_DEFAUT.source.url).toMatch(/service-public\.gouv\.fr/);
  });

  it('classe selon la règle « ne pas dépasser deux des trois seuils »', () => {
    const e = (totalBilan: string | null, chiffreAffairesNet: string | null, effectifMoyen: number | null) => evaluerCategorieTaille({ totalBilan, chiffreAffairesNet, effectifMoyen });
    expect(e('400000.00', '800000.00', 5)).toMatchObject({ categorie: 'micro_entreprise', seuilsAConfirmer: true, depassements: { micro: 0, petite: 0, moyenne: 0 }, mesuresManquantes: [] });
    expect(e('500000.00', '800000.00', 5).categorie).toBe('micro_entreprise');
    expect(e('450000.00', '900000.00', 10).categorie).toBe('micro_entreprise');
    expect(e('500000.00', '1000000.00', 5).categorie).toBe('petite_entreprise');
    expect(e('8000000.00', '16000000.00', 40).categorie).toBe('moyenne_entreprise');
    expect(e('30000000.00', '60000000.00', 10).categorie).toBe('grande_entreprise');
  });

  it('ne conclut pas quand une mesure manquante peut changer le classement', () => {
    const e = (totalBilan: string | null, chiffreAffairesNet: string | null, effectifMoyen: number | null) => evaluerCategorieTaille({ totalBilan, chiffreAffairesNet, effectifMoyen });
    expect(e('500000.00', null, 5)).toMatchObject({ categorie: 'a_confirmer', mesuresManquantes: ['chiffre d’affaires net'] });
    expect(e('100.00', '100.00', null).categorie).toBe('micro_entreprise');
    expect(e(null, null, null).categorie).toBe('a_confirmer');
    expect(e('500000.00', '1000000.00', null).categorie).toBe('petite_entreprise');
    expect(() => e('1.00', '1.00', -1)).toThrow(/Effectif/);
    expect(() => e('abc', '1.00', 1)).toThrow(/Montant invalide/);
  });

  it('accepte des seuils confirmés par le cabinet', () => {
    const seuils = { ...SEUILS_TAILLE_PAR_DEFAUT, etat: 'confirme_par_le_cabinet' as const, micro: { totalBilan: '100.00', chiffreAffairesNet: '100.00', effectifMoyen: 1 } };
    const r = evaluerCategorieTaille({ totalBilan: '200.00', chiffreAffairesNet: '200.00', effectifMoyen: 0 }, seuils);
    expect(r).toMatchObject({ categorie: 'petite_entreprise', seuilsAConfirmer: false });
    expect(r.reserves).toHaveLength(2);
  });
});
