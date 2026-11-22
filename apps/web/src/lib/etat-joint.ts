/**
 * État joint imprimable et exportable (D-138) : reprend, SANS rien recalculer ni déduire, les saisies déjà présentes dans la réponse de la liasse
 * (grilles, 2059-A, filiales du 2033-G / 2059-G, associés du 2033-F / 2059-F). Chaque tableau garde son statut, ses totaux tels que calculés par
 * l'API (ou leur abstention motivée) et ses limites. Aucune signature, aucune transmission, aucune validation.
 */
import type { AmortissementsDerogatoiresProjet, CadreIIIProjet, CelluleMontantSaisie, ChargesRepartiesProjet, EcartsReevaluationProjet, CelluleGrille, Formulaire2033DProjet, Formulaire2033EProjet, FormulaireCasesProjet, Formulaire2033FProjet, Formulaire2033GProjet, Formulaire2059AProjet, GrilleProjet, ReponseLiasse } from './fiscal';
import { LIBELLES_COLONNES_2055_B, LIBELLES_COLONNES_2059_A } from './fiscal';

export interface TableauEtatJoint {
  id: string;
  titre: string;
  etat: string;
  colonnes: string[];
  lignes: Array<{ libelle: string; cellules: string[]; statut: string }>;
  totaux: Array<{ libelle: string; cellules: string[] }>;
  limites: string[];
}

const ETAT: Record<string, string> = { a_saisir: 'à saisir (aucune saisie, rien n’est présumé nul)', neant: 'néant déclaré', saisi: 'saisies présentes' };
const STATUT_LIGNE: Record<string, string> = { a_saisir: 'à saisir', saisi: 'saisi', a_revoir: 'à revoir (données modifiées)' };

const cellule = (c: CelluleGrille | undefined): string => (c === undefined ? '—' : c.statut === 'etabli' ? c.montant : `abstention : ${c.motifs.join(' ')}`);

function depuisGrille(g: GrilleProjet): TableauEtatJoint[] {
  return g.cadres.map((c) => {
    const cles = c.colonnes.map((x) => x.cle);
    const colonnes = [c.libelleOrigine ?? 'Ligne', ...c.colonnes.map((x) => x.libelle), ...(c.colonneCalculee ? [c.colonneCalculee.libelle] : [])];
    return {
      id: `${g.id}/${c.tableau}`,
      titre: `${g.id} — ${c.titre}`,
      etat: ETAT[g.etat] ?? g.etat,
      colonnes,
      lignes: c.lignes.map((l) => ({
        libelle: c.libelleOrigine ? `${Number(l.ligne)}${l.origine ? ` — ${l.origine}` : ''}` : l.libelle,
        statut: STATUT_LIGNE[l.statut] ?? l.statut,
        cellules: [...cles.map((k) => (l.valeurs && k in l.valeurs ? l.valeurs[k]! : l.valeurs ? '' : '')), ...(c.colonneCalculee ? [l.calculee ? cellule(l.calculee) : ''] : [])],
      })),
      totaux: c.calculs.map((k) => ({ libelle: k.libelle, cellules: [...cles.map((x) => (x in k.cellules ? cellule(k.cellules[x]) : '—')), ...(c.colonneCalculee ? [''] : [])] })),
      limites: [...g.limites, ...g.nonPrepare],
    };
  });
}

function depuis2059A(f: Formulaire2059AProjet): TableauEtatJoint[] {
  const cles = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10a', 'c10b', 'c10c', 'c11'];
  return [
    {
      id: '2059-A',
      titre: '2059-A — Détermination des plus ou moins-values',
      etat: ETAT[f.etat] ?? f.etat,
      colonnes: ['Ligne', ...cles.map((k) => LIBELLES_COLONNES_2059_A[k] ?? k)],
      lignes: [
        ...f.immobilisations.map((l) => ({ libelle: `${Number(l.ligne)}${l.nature ? ` — ${l.nature}` : ''}`, statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: cles.map((k) => l.valeurs?.[k] ?? '') })),
        ...f.autres.map((l) => ({ libelle: `${Number(l.ligne)} — ${l.libelle}`, statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: cles.map((k) => l.valeurs?.[k] ?? '') })),
      ],
      totaux: [
        { libelle: 'Cadre A — court terme (colonne 9)', cellules: [f.cadres.A.statut === 'etabli' ? f.cadres.A.montant : `abstention : ${f.cadres.A.motifs.join(' ')}`] },
        { libelle: 'Cadre B — long terme (colonne 10)', cellules: [f.cadres.B.statut === 'etabli' ? f.cadres.B.montant : `abstention : ${f.cadres.B.motifs.join(' ')}`] },
        { libelle: 'Cadre C — plus-values taxables à 19 % (colonne 11)', cellules: [f.cadres.C.statut === 'etabli' ? f.cadres.C.montant : `abstention : ${f.cadres.C.motifs.join(' ')}`] },
      ],
      limites: [...f.limites, ...f.nonPrepare],
    },
  ];
}

const FIL = ['formeJuridique', 'denomination', 'siren', 'pourcentage', 'adresseNumero', 'adresseVoie', 'codePostal', 'commune', 'pays'];
function depuis2033G(f: Formulaire2033GProjet, nom: string): TableauEtatJoint[] {
  return [
    {
      id: `${nom}-G`,
      titre: `${nom} — Filiales et participations (détention directe d’au moins 10 %) ; nombre total (case ${f.nombre.codeCase}) : ${f.nombre.montant ?? 'à saisir'}`,
      etat: ETAT[f.etat] ?? f.etat,
      colonnes: ['Ligne', 'Forme juridique', 'Dénomination', 'SIREN', '% détention', 'N°', 'Voie', 'Code postal', 'Commune', 'Pays'],
      lignes: f.filiales.filter((l, i) => i < 7 || l.statut !== 'a_saisir').map((l) => ({ libelle: String(Number(l.ligne)), statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: FIL.map((k) => l.valeurs?.[k] ?? '') })),
      totaux: [],
      limites: [...f.limites, ...f.nonPrepare],
    },
  ];
}

function depuis2033F(f: Formulaire2033FProjet, nom: string): TableauEtatJoint[] {
  const pm = ['denomination', 'siren', 'pourcentage', 'parts'];
  const pp = ['nomFamille', 'prenoms', 'pourcentage', 'parts'];
  const lim = [...f.limites, ...f.nonPrepare];
  return [
    { id: `${nom}-F-PM`, titre: `${nom} — Composition du capital : personnes morales`, etat: ETAT[f.etat] ?? f.etat, colonnes: ['Ligne', 'Dénomination', 'SIREN', '% détention', 'Parts'], lignes: f.personnesMorales.filter((l, i) => i < 4 || l.statut !== 'a_saisir').map((l) => ({ libelle: String(Number(l.ligne)), statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: pm.map((k) => l.valeurs?.[k] ?? '') })), totaux: [], limites: lim },
    { id: `${nom}-F-PP`, titre: `${nom} — Composition du capital : personnes physiques`, etat: ETAT[f.etat] ?? f.etat, colonnes: ['Ligne', 'Nom', 'Prénoms', '% détention', 'Parts'], lignes: f.personnesPhysiques.filter((l, i) => i < 2 || l.statut !== 'a_saisir').map((l) => ({ libelle: String(Number(l.ligne)), statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: pp.map((k) => l.valeurs?.[k] ?? '') })), totaux: [], limites: lim },
  ];
}

/** Formulaires saisis case par case (2056, 2058, 2059-E, renvois des bilans) : une ligne par case, avec son code, son statut et son montant ; les calculs du formulaire en totaux. */
function depuisCases(f: FormulaireCasesProjet): TableauEtatJoint[] {
  const saisies = f.cases.filter((c) => c.statut !== 'a_saisir').length;
  return [
    {
      id: f.id,
      titre: `${f.titre}`,
      etat: saisies === 0 ? ETAT.a_saisir! : `${saisies} case(s) sur ${f.cases.length} saisie(s)`,
      colonnes: ['Case', 'Libellé', 'Montant'],
      lignes: f.cases.map((c) => ({ libelle: `${c.code}`, statut: STATUT_LIGNE[c.statut] ?? c.statut, cellules: [c.libelle, c.statut === 'saisi' && c.montant !== null ? c.montant : ''] })),
      totaux: f.calculs.map((k) => ({ libelle: `${k.code} — ${k.libelle}`, cellules: ['', k.statut === 'etabli' ? k.montant : `abstention : ${k.motifs.join(' ')}`] })),
      limites: [...f.limites, ...f.nonPrepare],
    },
  ];
}

function depuis2033D(f: Formulaire2033DProjet): TableauEtatJoint[] {
  const saisies = f.cases.filter((c) => c.statut !== 'a_saisir').length;
  return [
    {
      id: '2033-D',
      titre: '2033-D — Provisions, amortissements dérogatoires, déficits, divers, travailleurs indépendants (cases)',
      etat: saisies === 0 ? ETAT.a_saisir! : `${saisies} case(s) sur ${f.cases.length} saisie(s)`,
      colonnes: ['Case', 'Libellé', 'Montant'],
      lignes: f.cases.map((c) => ({ libelle: c.codeCase, statut: STATUT_LIGNE[c.statut] ?? c.statut, cellules: [c.libelle, c.statut === 'saisi' && c.montant !== null ? c.montant : ''] })),
      totaux: [{ libelle: 'Total 870 (984 + 860)', cellules: ['', f.total870.statut === 'etabli' ? f.total870.montant : `abstention : ${f.total870.motifs.join(' ')}`] }, ...(f.revenuBrutSocial ? [{ libelle: 'Revenu brut social (notice, § 692/693)', cellules: ['', f.revenuBrutSocial.statut === 'etabli' ? f.revenuBrutSocial.montant : `abstention : ${f.revenuBrutSocial.motifs.join(' ')}`] }] : [])],
      limites: [...f.limites, ...f.nonPrepare],
    },
    {
      id: '2033-D-C',
      titre: '2033-D, cadre C — Dotations aux provisions et charges à payer non déductibles',
      etat: ETAT[f.cadreC.etat] ?? f.cadreC.etat,
      colonnes: ['Ligne', 'Nature', 'Montant'],
      lignes: f.cadreC.lignes.filter((l, i) => i < 7 || l.statut !== 'a_saisir').map((l) => ({ libelle: String(Number(l.ligne)), statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: [l.nature ?? '', l.montant ?? ''] })),
      totaux: [{ libelle: 'Total 780 (à reporter ligne 322 du 2033-B)', cellules: ['', f.cadreC.total780.statut === 'etabli' ? f.cadreC.total780.montant : `abstention : ${f.cadreC.total780.motifs.join(' ')}`] }],
      limites: [],
    },
  ];
}

function depuis2033E(f: Formulaire2033EProjet): TableauEtatJoint[] {
  const saisies = f.cases.filter((c) => c.statut !== 'a_saisir').length;
  return [
    {
      id: '2033-E',
      titre: '2033-E — Effectifs et valeur ajoutée (CVAE)',
      etat: saisies === 0 ? ETAT.a_saisir! : `${saisies} case(s) sur ${f.cases.length} saisie(s)`,
      colonnes: ['Case', 'Libellé', 'Montant'],
      lignes: f.cases.map((c) => ({ libelle: c.codeCase, statut: STATUT_LIGNE[c.statut] ?? c.statut, cellules: [c.libelle, c.statut === 'saisi' && c.montant !== null ? c.montant : ''] })),
      totaux: ([['Total 1', f.total1], ['Total 2', f.total2], ['Total 3', f.total3], ['Valeur ajoutée (case 137)', f.valeurAjoutee137], ['Valeur ajoutée assujettie à la CVAE (case 117)', f.valeurAjoutee117]] as const).map(([libelle, k]) => ({ libelle, cellules: ['', k.statut === 'etabli' ? k.montant : `abstention : ${k.motifs.join(' ')}`] })),
      limites: [...f.limites, ...f.nonPrepare],
    },
  ];
}

function depuisCadreIII(c: CadreIIIProjet): TableauEtatJoint[] {
  return [
    {
      id: '2033-C-III',
      titre: '2033-C, cadre III — Plus-values et moins-values (cessions d’immobilisations)',
      etat: ETAT[c.etat] ?? c.etat,
      colonnes: ['Ligne', 'Nature', 'Valeur d’actif', 'Amortissements', 'Valeur résiduelle', 'Prix de cession', 'Plus ou moins-value', 'Régime choisi par le cabinet'],
      lignes: c.lignes.filter((l, i) => i < 10 || l.statut !== 'a_saisir').map((l) => ({ libelle: String(Number(l.ligne)), statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: [l.nature ?? '', l.valeurActif ?? '', l.amortissements ?? '', l.valeurResiduelle ?? '', l.prixCession ?? '', l.plusOuMoinsValue ?? '', l.classement ?? ''] })),
      totaux: [
        { libelle: 'Total des lignes saisies', cellules: ['', ...(['valeurActif', 'amortissements', 'valeurResiduelle', 'prixCession'] as const).map((k) => (c.totaux[k].statut === 'etabli' ? c.totaux[k].montant : `abstention : ${c.totaux[k].motifs.join(' ')}`)), '', ''] },
      ],
      limites: c.limites,
    },
  ];
}

const cm = (c: CelluleMontantSaisie | null | undefined): string => (c === null || c === undefined ? '—' : c.statut === 'etabli' ? c.montant : `abstention : ${c.motifs.join(' ')}`);

function depuis2054bis(e: EcartsReevaluationProjet): TableauEtatJoint[] {
  const cols = ['c1', 'c2', 'c3', 'c4', 'c5', 'ecart', 'c6'] as const;
  return [
    {
      id: '2054-bis',
      titre: '2054 bis — Écarts de réévaluation sur immobilisations amortissables (cadre A ; colonnes ① à ⑥ du formulaire)',
      etat: ETAT[e.etat] ?? e.etat,
      colonnes: ['Ligne', '① Valeur réévaluée', '② Valeur d’origine', '③ Amortissements', '④ Amortissements pratiqués', '⑤', 'Écart (① − ②)', '⑥'],
      lignes: e.lignes.map((l) => ({ libelle: l.libelle, statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: cols.map((k) => l[k] ?? '') })),
      totaux: [
        { libelle: 'Totaux des colonnes (ligne 10)', cellules: [cm(e.totaux.c1), cm(e.totaux.c2), cm(e.totaux.c3), cm(e.totaux.c4), cm(e.totaux.c5), '', cm(e.totaux.c6)] },
        { libelle: 'Cadre B : ligne 3 = ligne 1 − ligne 2', cellules: [cm(e.cadreB.b3)] },
      ],
      limites: [...e.limites, `Cadre B : ligne 1 ${e.cadreB.b1.montant ?? 'à saisir'} ; ligne 2 ${e.cadreB.b2.montant ?? 'à saisir'}.`],
    },
  ];
}

function depuis2055B(a: AmortissementsDerogatoiresProjet): TableauEtatJoint[] {
  return [
    {
      id: '2055-B',
      titre: '2055, cadre B — Amortissements dérogatoires (mouvements de l’exercice)',
      etat: ETAT[a.etat] ?? a.etat,
      colonnes: ['Ligne', ...LIBELLES_COLONNES_2055_B],
      lignes: a.lignes.map((l) => ({ libelle: `${l.groupe} — ${l.libelle}`, statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: LIBELLES_COLONNES_2055_B.map((_, i) => l.colonnes[i]?.montant ?? '') })),
      totaux: [
        ...(['I', 'II', 'III', 'general'] as const).map((g) => ({ libelle: g === 'general' ? 'Total général (I + II + III)' : `Total ${g}`, cellules: a.totaux[g].map((c) => cm(c)) })),
        { libelle: 'Non ventilé : NW (dotations), NY (reprises), NZ (NW − NY)', cellules: [cm(a.nonVentile.NW), cm(a.nonVentile.NY), cm(a.nonVentile.NZ)] },
      ],
      limites: a.limites,
    },
  ];
}

function depuis2055C(c: ChargesRepartiesProjet): TableauEtatJoint[] {
  return [
    {
      id: '2055-C',
      titre: '2055, cadre C — Charges réparties sur plusieurs exercices',
      etat: ETAT[c.etat] ?? c.etat,
      colonnes: ['Ligne', 'Montant net au début', 'Augmentations', 'Dotations de l’exercice', 'Montant net à la fin'],
      lignes: c.lignes.map((l) => ({ libelle: l.libelle, statut: STATUT_LIGNE[l.statut] ?? l.statut, cellules: [l.debut ?? '', l.augmentations ?? '', l.dotations ?? '', l.fin ?? ''] })),
      totaux: [],
      limites: c.limites,
    },
  ];
}

/** Tous les tableaux saisis par lignes de la réponse de la liasse, dans l'ordre des numéros de tableau. */
export function etatJointDe(l: ReponseLiasse): TableauEtatJoint[] {
  const nom = l.regimeDemande === 'reel_normal' ? '2059' : '2033';
  return [
    ...(l.formulairesCases ?? []).flatMap(depuisCases),
    ...(l.formulaire2033D ? depuis2033D(l.formulaire2033D) : []),
    ...(l.formulaire2033E ? depuis2033E(l.formulaire2033E) : []),
    ...(l.tableauxSaisis && l.tableauxSaisis.statut === 'projet' && l.tableauxSaisis.cadreIII ? depuisCadreIII(l.tableauxSaisis.cadreIII) : []),
    ...(l.tableauxSaisis && l.tableauxSaisis.statut === 'projet' ? [...(l.tableauxSaisis.ecartsReevaluation ? depuis2054bis(l.tableauxSaisis.ecartsReevaluation) : []), ...(l.tableauxSaisis.amortissementsDerogatoires ? depuis2055B(l.tableauxSaisis.amortissementsDerogatoires) : []), ...(l.tableauxSaisis.chargesRepartiesPlusieursExercices ? depuis2055C(l.tableauxSaisis.chargesRepartiesPlusieursExercices) : [])] : []),
    ...(l.formulaire2059A ? depuis2059A(l.formulaire2059A) : []),
    ...(l.grilles2059 ?? []).flatMap(depuisGrille),
    ...(l.formulaire2057 ? depuisGrille(l.formulaire2057) : []),
    ...(l.detail2053 ? depuisGrille(l.detail2053) : []),
    ...(l.feuilles2058 ?? []).flatMap(depuisGrille),
    ...(l.feuilletDeficits ? depuisGrille(l.feuilletDeficits) : []),
    ...(l.formulaire2033F ? depuis2033F(l.formulaire2033F, nom) : []),
    ...(l.formulaire2033G ? depuis2033G(l.formulaire2033G, nom) : []),
    ...(l.datesCvae ? depuisGrille(l.datesCvae) : []),
    ...(l.formulaire2065 ? depuisGrille(l.formulaire2065) : []),
    ...(l.formulaire2065Bis ? depuisGrille(l.formulaire2065Bis) : []),
  ];
}

/** Valeur de cellule CSV : neutralise une valeur lue comme formule par un tableur (= + - @ tabulation retour chariot), puis protège « ; » « " » et sauts de ligne. */
export function champCsv(v: string): string {
  const t = /^[=+@\t\r]/.test(v) || /^-(?!\d)/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function csvEtatJoint(tableaux: readonly TableauEtatJoint[], identification: string[]): string {
  const lignes: string[] = [...identification.map((x) => champCsv(x)), ''];
  for (const t of tableaux) {
    lignes.push(champCsv(t.titre), champCsv(`État : ${t.etat}`), ['Ligne', 'Statut', ...t.colonnes.slice(1)].map(champCsv).join(';'));
    for (const l of t.lignes) lignes.push([l.libelle, l.statut, ...l.cellules].map(champCsv).join(';'));
    for (const x of t.totaux) lignes.push([`TOTAL — ${x.libelle}`, '', ...x.cellules].map(champCsv).join(';'));
    lignes.push('');
  }
  return `﻿${lignes.join('\r\n')}\r\n`;
}
