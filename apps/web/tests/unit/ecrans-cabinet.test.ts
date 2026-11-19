import { describe, expect, it } from 'vitest';
import { decouperCleImport, formaterDelaiHeures } from '@/lib/indicateurs-cabinet';
import { LIBELLE_RATTACHEMENT, LIBELLE_STATUT_CONSEIL, NON_ETABLI, etatFait, faitsConsignables, formaterMinutes, lettreDepuis, lettreInitiale, phraseEstimation } from '@/lib/missions';
import { decouperExtrait, requeteValide } from '@/lib/recherche';
import { afficherParametre, champsParametres, libelleOrigineParametres, parametresDepuis, saisiesInitiales } from '@/lib/regles';
import { LIBELLE_APPLICABILITE, lectureSource } from '@/lib/veille';

describe('découpe d’un extrait avec marqueurs « »', () => {
  it('sépare le texte et les termes trouvés, sans jamais produire de HTML', () => {
    expect(decouperExtrait('«FACTURE» N° FA-2026-4363\nDate de «facture» : 17/03/2026')).toEqual([
      { texte: 'FACTURE', surligne: true },
      { texte: ' N° FA-2026-4363\nDate de ', surligne: false },
      { texte: 'facture', surligne: true },
      { texte: ' : 17/03/2026', surligne: false },
    ]);
    expect(decouperExtrait('aucun terme')).toEqual([{ texte: 'aucun terme', surligne: false }]);
    expect(decouperExtrait('')).toEqual([]);
  });
  it('rend tel quel un contenu hostile ou un marqueur orphelin', () => {
    const hostile = decouperExtrait('<script>alert(1)</script> «<b>gras</b>»');
    expect(hostile).toEqual([{ texte: '<script>alert(1)</script> ', surligne: false }, { texte: '<b>gras</b>', surligne: true }]);
    expect(hostile.map((f) => f.texte).join('')).toBe('<script>alert(1)</script> <b>gras</b>'); // rien d'autre que les marqueurs n'est retiré
    expect(decouperExtrait('fin « ouverte')).toEqual([{ texte: 'fin « ouverte', surligne: false }]);
    expect(decouperExtrait('orphelin » puis «terme»')).toEqual([{ texte: 'orphelin » puis ', surligne: false }, { texte: 'terme', surligne: true }]);
    expect(decouperExtrait('«a»«b»')).toEqual([{ texte: 'ab', surligne: true }]); // fragments contigus fusionnés
  });
  it('valide la requête comme l’API (2 à 200 caractères)', () => {
    expect(requeteValide(' a ')).toBeNull();
    expect(requeteValide(' facture ')).toBe('facture');
    expect(requeteValide('x'.repeat(201))).toBeNull();
    expect(requeteValide(undefined)).toBeNull();
  });
});

describe('libellés d’états', () => {
  it('rattachement d’un travail : trois états, le hors-périmètre reste un signalement', () => {
    expect(LIBELLE_RATTACHEMENT).toEqual({ dans_le_perimetre: 'Dans le périmètre', potentiellement_hors_perimetre: 'Potentiellement hors périmètre — à examiner', aucune_lettre_applicable: 'Aucune lettre applicable à cette date' });
  });
  it('faits d’un conseil : l’absence se lit « Non établi », jamais « Non »', () => {
    expect(NON_ETABLI).toBe('Non établi');
    expect(etatFait(null)).toEqual({ etabli: false, date: null });
    expect(etatFait(undefined).etabli).toBe(false);
    expect(etatFait('2025-05-13T07:00:00.000Z')).toEqual({ etabli: true, date: '2025-05-13T07:00:00.000Z' });
    const faits = { envoi: null, remise: null, reception: null, lecture: null };
    expect(faitsConsignables({ statut: 'valide', faits })).toEqual([]); // envoi non autorisé
    expect(faitsConsignables({ statut: 'envoi_autorise', faits })).toEqual(['envoi']); // l'envoi d'abord
    expect(faitsConsignables({ statut: 'envoi_autorise', faits: { ...faits, envoi: 'x', remise: 'y' } })).toEqual(['reception', 'lecture']);
    expect(LIBELLE_STATUT_CONSEIL.valide).toContain('envoi non autorisé'); // valider n'est pas autoriser l'envoi
  });
  it('estimation : base toujours nommée, sinon abstention', () => {
    expect(phraseEstimation({ statut: 'estime', minutes: 60, base: 'bareme_cabinet', nbObservations: 0, hypotheses: [] })).toBe('Temps estimé : 1 h — base : barème du cabinet');
    expect(phraseEstimation({ statut: 'estime', minutes: 135, base: 'temps_observes', nbObservations: 4, hypotheses: [] })).toBe('Temps estimé : 2 h 15 — base : temps observés dans le cabinet');
    expect(phraseEstimation({ statut: 'non_estimable', minutes: null, base: null, nbObservations: 1, hypotheses: [] })).toBe('Estimation impossible : aucune base');
    expect(formaterMinutes(45)).toBe('45 min');
    expect(formaterMinutes(null)).toBe('—');
  });
  it('veille : trois états d’applicabilité ; une source non assurée ne se lit jamais comme « aucune nouveauté »', () => {
    expect(LIBELLE_APPLICABILITE).toEqual({ concerne: 'Concerné', a_confirmer: 'À confirmer', non_concerne: 'Non concerné' });
    expect(lectureSource({ veilleAssuree: true, dernierStatut: 'inchangee', dernierSuccesLe: 'x' }).titre).toBe('Veille assurée');
    const indisponible = lectureSource({ veilleAssuree: false, dernierStatut: 'indisponible', dernierSuccesLe: null });
    expect(indisponible.titre).toBe('Veille NON assurée');
    expect(indisponible.explication).toContain('Cela ne signifie pas qu’il n’y a aucune nouveauté');
    expect(lectureSource({ veilleAssuree: false, dernierStatut: 'inchangee', dernierSuccesLe: '2020-01-01' }).explication).toContain('trop ancienne');
  });
  it('règles : origine des paramètres et indicateurs', () => {
    expect(libelleOrigineParametres({ version: 3, portee: 'dossier' })).toBe('Paramètres propres au dossier — règle v3');
    expect(libelleOrigineParametres({ version: 1, portee: 'cabinet' })).toBe('Paramètres propres au cabinet — règle v1');
    expect(decouperCleImport('releve_bancaire:termine_avec_erreurs')).toEqual({ type: 'releve_bancaire', statut: 'termine_avec_erreurs' });
    expect(formaterDelaiHeures(null)).toContain('Non calculable');
    expect(formaterDelaiHeures(0)).toBe('0 h');
    expect(formaterDelaiHeures(12.5)).toBe('12,5 h');
  });
});

describe('paramètres d’une règle saisis d’après parametresParDefaut', () => {
  const defauts = { prefixesComptes: ['411'], seuil: '0.00', maxConstats: 200, tauxLacunesMax: 0.5, ventesSansTvaAdmises: false, portee: 'auto', correspondances: [] };
  const champs = champsParametres(defauts);
  it('déduit le genre de champ de la valeur par défaut', () => {
    expect(Object.fromEntries(champs.map((c) => [c.cle, c.genre]))).toEqual({ prefixesComptes: 'liste', seuil: 'decimal', maxConstats: 'entier', tauxLacunesMax: 'nombre', ventesSansTvaAdmises: 'booleen', portee: 'texte', correspondances: 'fige' });
    expect(saisiesInitiales(champs)).toEqual({ prefixesComptes: '411', seuil: '0.00', maxConstats: '200', tauxLacunesMax: '0.5', ventesSansTvaAdmises: false, portee: 'auto' });
    expect(afficherParametre(['411', '416'])).toBe('411, 416');
    expect(afficherParametre(true)).toBe('oui');
  });
  it('n’envoie que les paramètres modifiés, les montants restant des chaînes décimales', () => {
    const r = parametresDepuis(champs, { ...saisiesInitiales(champs), seuil: '100 000,00', prefixesComptes: '411, 416', ventesSansTvaAdmises: true });
    expect(r).toEqual({ ok: true, parametres: { seuil: '100000.00', prefixesComptes: ['411', '416'], ventesSansTvaAdmises: true } });
    if (r.ok) expect(typeof r.parametres.seuil).toBe('string');
    expect(parametresDepuis(champs, { ...saisiesInitiales(champs), maxConstats: '50' })).toEqual({ ok: true, parametres: { maxConstats: 50 } });
  });
  it('refuse une saisie invalide ou identique aux valeurs par défaut', () => {
    const invalide = parametresDepuis(champs, { ...saisiesInitiales(champs), seuil: 'cent', maxConstats: '1,5' });
    expect(invalide.ok).toBe(false);
    if (!invalide.ok) expect(invalide.erreurs).toHaveLength(2);
    const identique = parametresDepuis(champs, saisiesInitiales(champs));
    expect(identique.ok).toBe(false);
    if (!identique.ok) expect(identique.erreurs[0]).toContain('Modifiez au moins un paramètre');
  });
});

describe('contenu structuré d’une lettre de mission', () => {
  const prestations = [{ code: 'tenue', libelle: 'Tenue de comptabilité' }, { code: 'fiscal_tva', libelle: 'Déclarations de TVA' }];
  it('construit le contenu attendu par l’API, honoraires en chaînes décimales ou null', () => {
    const f = { ...lettreInitiale(prestations), dateEffet: '2025-01-01', debut: '2025-01-01', taciteReconduction: true, montantAnnuelHt: '3 600', livrables: 'Comptes annuels\n\n Liasse ', limites: ' Hors social ' };
    f.prestations.tenue = { cochee: true, precision: ' mensuelle ' };
    expect(lettreDepuis(f)).toEqual({
      ok: true,
      corps: {
        dateEffet: '2025-01-01',
        contenu: {
          perimetre: [{ prestation: 'tenue', precision: 'mensuelle' }],
          duree: { debut: '2025-01-01', fin: null, taciteReconduction: true },
          honoraires: { mode: 'forfait', montantAnnuelHt: '3600.00', tauxHoraireHt: null, conditionsRevision: '' },
          obligationsCabinet: '', obligationsClient: '', livrables: ['Comptes annuels', 'Liasse'], mandats: [], limites: 'Hors social',
        },
      },
    });
  });
  it('exige un périmètre, des dates et des montants lisibles', () => {
    const r = lettreDepuis({ ...lettreInitiale(prestations), montantAnnuelHt: 'beaucoup', debut: '2025-06-01', fin: '2025-01-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs).toEqual(['Indiquez la date d’effet.', 'Le périmètre comporte au moins une prestation.', 'La fin de la mission ne peut pas précéder son début.', 'Honoraires annuels HT : montant invalide (ex. 3600,00).']);
  });
});
