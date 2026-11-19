import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES, sourceInterne } from '../sources.js';
import {
  ZERO, aPrefixe, cleEcriture, creditDe, debitDe, definir, grouper, idsDe, lignesJusquaCloture, mentionCloture, montant2,
  schemaMaxConstats, schemaMontantPositif, schemaPrefixes, soldeDe,
} from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const libelleEcriture = (l: LigneEcriture): string => `${l.journalCode}/${l.ecritureNum || '(sans numéro)'}`;

export const GEN_001 = definir({
  id: 'GEN-001',
  version: '1.0.0',
  cycle: 'general',
  titre: 'Équilibre débit/crédit des écritures, des journaux et de l’ensemble',
  objectif: 'S’assurer que chaque écriture, chaque journal et l’ensemble des écritures respectent la partie double.',
  perimetre: 'Toutes les lignes fournies.',
  donneesObligatoires: ['journalCode', 'ecritureNum', 'debit', 'credit'],
  logique:
    'Regroupe les lignes par (journal, numéro d’écriture), par journal, puis globalement ; calcule Σ débit − Σ crédit en décimal exact ; ' +
    'un écart en valeur absolue supérieur à la tolérance produit un constat (un par écriture, un par journal, un global).',
  schemaParametres: z.strictObject({ tolerance: schemaMontantPositif, maxConstats: schemaMaxConstats }),
  parametresParDefaut: { tolerance: '0.00', maxConstats: 200 },
  exceptions:
    'Une écriture répartie sous plusieurs numéros apparaît déséquilibrée. Les lignes sans numéro d’écriture sont regroupées par journal sous un numéro vide.',
  source: sourceInterne(
    'Principe de la partie double (égalité des débits et des crédits de chaque écriture) ; contrôle arithmétique interne, texte non revérifié.',
  ),
  resultatsAttendus: 'Aucun écart. Tout écart est une anomalie à corriger avant tout autre contrôle.',
  calcul(ctx, p) {
    const tolerance = dec(p.tolerance);
    const constats: Constat[] = [];
    const parEcriture = grouper(ctx.lignes, cleEcriture);
    for (const lignes of parEcriture.values()) {
      const ecart = soldeDe(lignes);
      if (ecart.abs().lessThanOrEqualTo(tolerance)) continue;
      const premiere = lignes[0] as LigneEcriture;
      constats.push({
        gravite: 'elevee',
        titre: `Écriture ${libelleEcriture(premiere)} déséquilibrée`,
        explication: `Le total des débits diffère du total des crédits de ${montant2(ecart.abs())} (débit − crédit = ${montant2(ecart)}).`,
        actionProposee: 'Retrouver la ligne manquante ou erronée dans le logiciel d’origine et corriger l’écriture.',
        montant: montant2(ecart.abs()),
        lignesConcernees: idsDe(lignes),
        preuves: [
          { libelle: 'Journal', valeur: premiere.journalCode },
          { libelle: 'Numéro d’écriture', valeur: premiere.ecritureNum },
          { libelle: 'Date', valeur: premiere.ecritureDate },
          { libelle: 'Débit − crédit', valeur: montant2(ecart) },
        ],
        cle: `GEN-001|ecriture|${premiere.journalCode}|${premiere.ecritureNum}`,
      });
    }
    const parJournal = grouper(ctx.lignes, (l) => l.journalCode);
    for (const [journal, lignes] of parJournal) {
      const ecart = soldeDe(lignes);
      if (ecart.abs().lessThanOrEqualTo(tolerance)) continue;
      constats.push({
        gravite: 'elevee',
        titre: `Journal ${journal} déséquilibré`,
        explication: `Sur le journal ${journal}, débit − crédit = ${montant2(ecart)}.`,
        actionProposee: 'Corriger les écritures déséquilibrées de ce journal (voir les constats par écriture).',
        montant: montant2(ecart.abs()),
        lignesConcernees: [],
        preuves: [{ libelle: 'Débit − crédit du journal', valeur: montant2(ecart) }],
        cle: `GEN-001|journal|${journal}`,
      });
    }
    const ecartGlobal = soldeDe(ctx.lignes);
    let totalDebit = ZERO;
    for (const l of ctx.lignes) totalDebit = totalDebit.plus(debitDe(l));
    if (ecartGlobal.abs().greaterThan(tolerance)) {
      constats.push({
        gravite: 'critique',
        titre: 'Ensemble des écritures déséquilibré',
        explication: `Sur l'ensemble des écritures, débit − crédit = ${montant2(ecartGlobal)}.`,
        actionProposee: 'Ne pas poursuivre la révision sur cette base : obtenir un export complet et équilibré.',
        montant: montant2(ecartGlobal.abs()),
        lignesConcernees: [],
        preuves: [
          { libelle: 'Total débit', valeur: montant2(totalDebit) },
          { libelle: 'Total crédit', valeur: montant2(totalDebit.minus(ecartGlobal)) },
        ],
        cle: 'GEN-001|global',
      });
    }
    return {
      statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
      constats,
      mesures: {
        nbEcritures: String(parEcriture.size),
        nbJournaux: String(parJournal.size),
        totalDebit: montant2(totalDebit),
        totalCredit: montant2(totalDebit.minus(ecartGlobal)),
        ecartGlobal: montant2(ecartGlobal),
      },
    };
  },
});

interface NumeroAnalyse { prefixe: string; n: number; num: string; journal: string }
interface Lacune { groupe: string; journal: string | null; prefixe: string; avant: NumeroAnalyse; apres: NumeroAnalyse; manquants: number }

function lacunes(numeros: NumeroAnalyse[], parJournal: boolean, minEcritures: number, tauxMax: number): { lacunes: Lacune[]; analyses: number; ecartes: number } {
  const groupes = grouper(numeros, (x) => (parJournal ? `${x.journal}\u0001${x.prefixe}` : x.prefixe));
  const resultat: Lacune[] = [];
  let analyses = 0;
  let ecartes = 0;
  for (const [groupe, membres] of groupes) {
    if (membres.length < minEcritures) {
      ecartes++;
      continue;
    }
    const tries = [...membres].sort((a, b) => a.n - b.n);
    const premier = tries[0] as NumeroAnalyse;
    const dernier = tries[tries.length - 1] as NumeroAnalyse;
    const etendue = dernier.n - premier.n + 1;
    const distincts = new Set(tries.map((x) => x.n)).size;
    if ((etendue - distincts) / etendue > tauxMax) {
      ecartes++;
      continue;
    }
    analyses++;
    for (let i = 1; i < tries.length; i++) {
      const avant = tries[i - 1] as NumeroAnalyse;
      const apres = tries[i] as NumeroAnalyse;
      if (apres.n - avant.n > 1) {
        resultat.push({ groupe, journal: parJournal ? premier.journal : null, prefixe: premier.prefixe, avant, apres, manquants: apres.n - avant.n - 1 });
      }
    }
  }
  return { lacunes: resultat, analyses, ecartes };
}

export const GEN_002 = definir({
  id: 'GEN-002',
  version: '1.0.0',
  cycle: 'general',
  titre: 'Continuité des séquences de numéros d’écriture',
  objectif: 'Repérer les numéros d’écriture manquants, indices possibles d’écritures supprimées ou d’un export incomplet.',
  perimetre: 'Numéros d’écriture se terminant par une partie numérique, par journal ou globalement.',
  donneesObligatoires: ['journalCode', 'ecritureNum'],
  logique:
    'HEURISTIQUE. Chaque numéro d’écriture distinct est découpé en préfixe + suffixe numérique. Les numéros sont regroupés par (journal, préfixe) ' +
    '(portée « journal ») ou par préfixe seul (portée « globale ») ; en portée « auto », on retient le regroupement qui produit le moins de numéros manquants ' +
    '(à égalité : par journal). Un groupe de moins de `minEcritures` numéros, ou dont la part de numéros manquants dépasse `tauxLacunesMax` ' +
    '(numérotation manifestement non séquentielle, par exemple fondée sur la date), n’est pas analysé. Chaque trou entre deux numéros consécutifs présents donne un constat.',
  schemaParametres: z.strictObject({
    portee: z.enum(['auto', 'journal', 'globale']),
    minEcritures: z.number().int().min(2).max(1000),
    tauxLacunesMax: z.number().min(0).max(1),
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { portee: 'auto', minEcritures: 3, tauxLacunesMax: 0.5, maxConstats: 200 },
  exceptions:
    'Numérotations non séquentielles par conception (date, pièce), remises à zéro mensuelles sans préfixe distinctif, numéros réservés puis abandonnés par le logiciel : faux positifs possibles. ' +
    'Une suppression en fin de séquence n’est pas détectable. Les numéros sans suffixe numérique ne sont pas analysés.',
  source: sourceInterne('Heuristique interne de cabinet (aucun texte n’impose un format de numérotation ; la continuité est un indice, pas une preuve).'),
  resultatsAttendus: 'Aucune rupture. Une rupture appelle une explication (journal extra-comptable, écritures de simulation, suppression).',
  calcul(ctx, p) {
    const vus = new Map<string, LigneEcriture[]>();
    for (const l of ctx.lignes) {
      const k = cleEcriture(l);
      const g = vus.get(k);
      if (g === undefined) vus.set(k, [l]);
      else g.push(l);
    }
    const numeros: NumeroAnalyse[] = [];
    let nonNumeriques = 0;
    for (const lignes of vus.values()) {
      const l = lignes[0] as LigneEcriture;
      const m = /^(.*?)(\d{1,15})$/.exec(l.ecritureNum);
      if (!m) {
        nonNumeriques++;
        continue;
      }
      numeros.push({ prefixe: m[1] ?? '', n: Number(m[2]), num: l.ecritureNum, journal: l.journalCode });
    }
    const parJournal = lacunes(numeros, true, p.minEcritures, p.tauxLacunesMax);
    const global = lacunes(numeros, false, p.minEcritures, p.tauxLacunesMax);
    const total = (x: { lacunes: Lacune[] }): number => x.lacunes.reduce((s, y) => s + y.manquants, 0);
    let retenu = parJournal;
    let portee: 'journal' | 'globale' = 'journal';
    if (p.portee === 'globale' || (p.portee === 'auto' && global.analyses > 0 && (parJournal.analyses === 0 || total(global) < total(parJournal)))) {
      retenu = global;
      portee = 'globale';
    }
    const mesures = {
      porteeRetenue: portee,
      nbEcrituresDistinctes: String(vus.size),
      nbNumerosNonNumeriques: String(nonNumeriques),
      nbSequencesAnalysees: String(retenu.analyses),
      nbSequencesNonAnalysees: String(retenu.ecartes),
    };
    if (retenu.analyses === 0) {
      return { statut: 'non_applicable', motif: 'Aucune séquence numérique exploitable (numéros non numériques, trop peu d’écritures ou numérotation non séquentielle).', mesures };
    }
    const constats: Constat[] = retenu.lacunes.map((x) => {
      const ou = x.journal !== null ? `dans le journal ${x.journal}` : 'dans la numérotation globale';
      const voisines = [...(vus.get(`${x.avant.journal}\u0001${x.avant.num}`) ?? []), ...(vus.get(`${x.apres.journal}\u0001${x.apres.num}`) ?? [])];
      return {
        gravite: 'moyenne',
        titre: `Rupture de séquence ${ou} : ${x.manquants} numéro(s) manquant(s)`,
        explication: `Aucun numéro d'écriture entre ${x.avant.num} et ${x.apres.num}. Indice à expliquer, pas une preuve de suppression (contrôle heuristique).`,
        actionProposee: 'Demander au client ou vérifier dans le logiciel l’origine du trou (écritures supprimées, brouillard, journal non exporté).',
        montant: null,
        lignesConcernees: idsDe(voisines, 50),
        preuves: [
          { libelle: 'Dernier numéro avant la rupture', valeur: x.avant.num },
          { libelle: 'Premier numéro après la rupture', valeur: x.apres.num },
          { libelle: 'Numéros manquants', valeur: String(x.manquants) },
        ],
        cle: `GEN-002|${portee}|${x.journal ?? ''}|${x.prefixe}|${x.avant.n}|${x.apres.n}`,
      };
    });
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures };
  },
});

export const GEN_003 = definir({
  id: 'GEN-003',
  version: '1.0.0',
  cycle: 'general',
  titre: 'Dates d’écriture hors exercice',
  objectif: 'Repérer les écritures datées avant l’ouverture ou après la clôture de l’exercice révisé.',
  perimetre: 'Toutes les lignes, comparées aux bornes de l’exercice fournies par l’appelant.',
  donneesObligatoires: ['ecritureDate', 'exercice.debut', 'exercice.fin'],
  logique: 'Une ligne dont la date d’écriture est strictement antérieure au début ou strictement postérieure à la fin de l’exercice est hors exercice ; un constat par écriture (journal + numéro), montant = total des débits des lignes concernées.',
  schemaParametres: z.strictObject({ maxConstats: schemaMaxConstats }),
  parametresParDefaut: { maxConstats: 200 },
  exceptions: 'Si l’exercice n’est pas communiqué, le contrôle n’est pas réalisé (aucune déduction à partir des dates du fichier).',
  source: sourceInterne('Contrôle de cohérence interne : rattachement des écritures à l’exercice révisé (bornes fournies par l’appelant).'),
  resultatsAttendus: 'Aucune écriture hors exercice.',
  calcul(ctx) {
    const exercice = ctx.exercice;
    if (exercice === null) return { statut: 'non_realise', motif: 'Exercice inconnu : bornes de dates non communiquées.' };
    const hors = ctx.lignes.filter((l) => l.ecritureDate < exercice.debut || l.ecritureDate > exercice.fin);
    const constats: Constat[] = [];
    for (const lignes of grouper(hors, cleEcriture).values()) {
      const premiere = lignes[0] as LigneEcriture;
      let debit = ZERO;
      for (const l of lignes) debit = debit.plus(debitDe(l));
      const sens = premiere.ecritureDate < exercice.debut ? 'antérieure à l’ouverture' : 'postérieure à la clôture';
      constats.push({
        gravite: 'moyenne',
        titre: `Écriture ${libelleEcriture(premiere)} datée du ${premiere.ecritureDate}, hors exercice`,
        explication: `Date ${sens} de l'exercice (${exercice.debut} au ${exercice.fin}).`,
        actionProposee: 'Vérifier la date de l’écriture ou son rattachement au bon exercice.',
        montant: montant2(debit),
        lignesConcernees: idsDe(lignes),
        preuves: [
          { libelle: 'Date d’écriture', valeur: premiere.ecritureDate },
          { libelle: 'Exercice', valeur: `${exercice.debut} – ${exercice.fin}` },
        ],
        cle: `GEN-003|${premiere.journalCode}|${premiere.ecritureNum}|${premiere.ecritureDate}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbLignesHorsExercice: String(hors.length) } };
  },
});

export const GEN_004 = definir({
  id: 'GEN-004',
  version: '1.0.0',
  cycle: 'general',
  titre: 'Doublons potentiels d’écritures',
  objectif: 'Repérer les écritures saisies deux fois (suspicion à confirmer, jamais une certitude).',
  perimetre: 'Écritures de numéros différents, comparées au sein d’un même journal.',
  donneesObligatoires: ['journalCode', 'ecritureNum', 'ecritureDate', 'compteNum', 'debit', 'credit', 'pieceRef'],
  logique:
    'Pour chaque écriture, calcule une signature : journal, date, et l’ensemble trié de ses lignes (compte, compte auxiliaire, débit, crédit, référence de pièce). ' +
    'Deux écritures ou plus, de numéros différents, ayant la même signature forment un doublon potentiel. Montant = total débit d’une occurrence.',
  schemaParametres: z.strictObject({ inclureSansPiece: z.boolean(), montantMinimum: schemaMontantPositif, maxConstats: schemaMaxConstats }),
  parametresParDefaut: { inclureSansPiece: true, montantMinimum: '0.00', maxConstats: 200 },
  exceptions:
    'Opérations réellement identiques le même jour sous la même référence (abonnements, écritures récurrentes) : faux positifs. ' +
    'Un doublon saisi avec une autre date, une autre référence de pièce ou dans un autre journal n’est PAS détecté.',
  source: sourceInterne('Heuristique interne de cabinet : similarité exacte d’écritures.'),
  resultatsAttendus: 'Aucun doublon potentiel ; chaque suspicion est à confirmer sur pièce.',
  calcul(ctx, p) {
    const minimum = dec(p.montantMinimum);
    const signatures = new Map<string, LigneEcriture[][]>();
    for (const lignes of grouper(ctx.lignes, cleEcriture).values()) {
      const premiere = lignes[0] as LigneEcriture;
      if (!p.inclureSansPiece && lignes.every((l) => l.pieceRef === '')) continue;
      let debit = ZERO;
      for (const l of lignes) debit = debit.plus(debitDe(l));
      if (debit.isZero() || debit.lessThan(minimum)) continue;
      const detail = lignes
        .map((l) => `${l.compteNum}\u0002${l.compAuxNum ?? ''}\u0002${debitDe(l).toString()}\u0002${creditDe(l).toString()}\u0002${l.pieceRef}\u0002${l.ecritureDate}`)
        .sort()
        .join('\u0003');
      const signature = `${premiere.journalCode}\u0004${detail}`;
      const g = signatures.get(signature);
      if (g === undefined) signatures.set(signature, [lignes]);
      else g.push(lignes);
    }
    const constats: Constat[] = [];
    for (const groupes of signatures.values()) {
      if (groupes.length < 2) continue;
      const premiere = (groupes[0] as LigneEcriture[])[0] as LigneEcriture;
      const nums = groupes.map((g) => (g[0] as LigneEcriture).ecritureNum).sort();
      let debit = ZERO;
      for (const l of groupes[0] as LigneEcriture[]) debit = debit.plus(debitDe(l));
      constats.push({
        gravite: 'moyenne',
        titre: `Doublon potentiel : ${groupes.length} écritures identiques dans le journal ${premiere.journalCode}`,
        explication: `Les écritures ${nums.join(', ')} ont le même journal, la même date (${premiere.ecritureDate}), les mêmes comptes, montants et références de pièce. Suspicion à confirmer.`,
        actionProposee: 'Rapprocher des pièces justificatives ; extourner l’écriture en double le cas échéant.',
        montant: montant2(debit),
        lignesConcernees: idsDe(groupes.flat()),
        preuves: [
          { libelle: 'Numéros d’écriture', valeur: nums.join(', ') },
          { libelle: 'Date', valeur: premiere.ecritureDate },
          { libelle: 'Référence de pièce', valeur: premiere.pieceRef || '(vide)' },
        ],
        cle: `GEN-004|${premiere.journalCode}|${nums.join('+')}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats };
  },
});

export const GEN_005 = definir({
  id: 'GEN-005',
  version: '1.0.0',
  cycle: 'cloture',
  titre: 'Comptes d’attente non soldés à la clôture',
  objectif: 'S’assurer que les comptes d’attente (471 à 473) et transitoires (478) sont soldés ou justifiés à la clôture.',
  perimetre: 'Comptes dont le numéro commence par un des préfixes paramétrés (défaut 471, 472, 473, 478 hors 4781).',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'ecritureDate'],
  logique:
    'Solde = Σ débit − Σ crédit par numéro de compte, sur les lignes datées jusqu’à la clôture (toutes les lignes si l’exercice est inconnu). ' +
    'Un solde dont la valeur absolue dépasse le seuil produit un constat. Les comptes 471 à 473 relèvent de l’obligation de reclassement du PCG ; ' +
    'le compte 478 « Autres comptes transitoires » est ajouté par convention de cabinet (constat de gravité faible).',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    prefixesExclus: z.array(z.string().regex(/^\d{1,12}$/)),
    seuil: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesComptes: ['471', '472', '473', '478'], prefixesExclus: ['4781'], seuil: '0.00', maxConstats: 200 },
  exceptions:
    'Le PCG ne qualifie de « comptes d’attente » que les subdivisions 471 à 473 ; 474 à 477 (différences d’évaluation et de conversion) ne sont pas contrôlés ; ' +
    '4781 « Mali de fusion sur actif circulant » est exclu par défaut car son solde est normal.',
  source: SOURCES.pcgCompte47,
  resultatsAttendus: 'Solde nul pour chaque compte d’attente à la clôture.',
  calcul(ctx, p) {
    const seuil = dec(p.seuil);
    const lignes = lignesJusquaCloture(ctx).filter((l) => aPrefixe(l.compteNum, p.prefixesComptes, p.prefixesExclus));
    if (lignes.length === 0) return { statut: 'non_applicable', motif: 'Aucun compte d’attente mouvementé dans les écritures fournies.' };
    const constats: Constat[] = [];
    const parCompte = grouper(lignes, (l) => l.compteNum);
    for (const [compte, ls] of parCompte) {
      const solde = soldeDe(ls);
      if (solde.abs().lessThanOrEqualTo(seuil)) continue;
      const reglementaire = /^47[123]/.test(compte);
      constats.push({
        gravite: reglementaire ? 'moyenne' : 'faible',
        titre: `Compte ${reglementaire ? 'd’attente' : 'transitoire'} ${compte} non soldé ${mentionCloture(ctx)}`,
        explication: `Solde ${solde.isPositive() ? 'débiteur' : 'créditeur'} de ${montant2(solde.abs())}. ${
          reglementaire
            ? 'Les opérations inscrites en compte d’attente doivent être reclassées en fin d’exercice (PCG art. 1214-47).'
            : 'Compte transitoire à justifier (convention de cabinet).'
        }`,
        actionProposee: 'Analyser les mouvements non apurés et les imputer aux comptes définitifs.',
        montant: montant2(solde.abs()),
        lignesConcernees: idsDe(ls),
        preuves: [
          { libelle: 'Compte', valeur: `${compte} ${(ls[0] as LigneEcriture).compteLib}`.trim() },
          { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) },
          { libelle: 'Nombre de lignes', valeur: String(ls.length) },
        ],
        cle: `GEN-005|${compte}`,
      });
    }
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: { nbComptesExamines: String(parCompte.size) } };
  },
});
