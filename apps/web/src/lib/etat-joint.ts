/**
 * État joint imprimable et exportable (D-138) : reprend, SANS rien recalculer ni déduire, les saisies déjà présentes dans la réponse de la liasse
 * (grilles, 2059-A, filiales du 2033-G / 2059-G, associés du 2033-F / 2059-F). Chaque tableau garde son statut, ses totaux tels que calculés par
 * l'API (ou leur abstention motivée) et ses limites. Aucune signature, aucune transmission, aucune validation.
 */
import type { CelluleGrille, Formulaire2033FProjet, Formulaire2033GProjet, Formulaire2059AProjet, GrilleProjet, ReponseLiasse } from './fiscal';
import { LIBELLES_COLONNES_2059_A } from './fiscal';

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

/** Tous les tableaux saisis par lignes de la réponse de la liasse, dans l'ordre des numéros de tableau. */
export function etatJointDe(l: ReponseLiasse): TableauEtatJoint[] {
  const nom = l.regimeDemande === 'reel_normal' ? '2059' : '2033';
  return [
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
