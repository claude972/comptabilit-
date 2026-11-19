import type { Decimal } from 'decimal.js';
import { z } from 'zod';
import { dec } from '../montant.js';
import { SOURCES } from '../sources.js';
import {
  Agregat, CollecteurConstats, DepassementBudget, ZERO, aPrefixe, agreger, cleEcriture, debitDe, definir, jusquaCloture, lignesJusquaCloture, mentionCloture, montant2,
  schemaMaxConstats, schemaMontantPositif, schemaPrefixes,
} from './outils.js';
import type { Calcul } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const schemaPrefixesFacultatifs = z.array(z.string().regex(/^\d{1,12}$/, 'Préfixe de compte numérique attendu.'));

/** Racine d'un compte d'amortissement (zéros de droite retirés, 3 chiffres au moins) et racine du compte amorti (le « 8 » en moins). */
function racineBrute(compteAmortissement: string): string {
  const racine = compteAmortissement.replace(/0+$/, '').padEnd(3, '0');
  return `${racine.charAt(0)}${racine.slice(2)}`;
}

/** Conclusion commune aux deux chemins, à partir d'un agrégat par compte d'amortissement et par compte d'immobilisation. */
function conclureImm001(
  amortissements: Map<string, Agregat>,
  immobilisations: Map<string, Agregat>,
  ctx: { exercice: { fin: string } | null },
  p: { prefixesAmortissements: string[]; prefixesImmobilisations: string[]; tolerance: string },
): Calcul {
  const tolerance = dec(p.tolerance);
  if (amortissements.size === 0 && immobilisations.size === 0) {
    return { statut: 'non_applicable', motif: `Aucun compte d'immobilisation (${p.prefixesImmobilisations.join(', ')}) ni d'amortissement (${p.prefixesAmortissements.join(', ')}) dans les écritures fournies.` };
  }
  const constats: Constat[] = [];
  const niveaux = new Set<string>();
  const comptesAmortissement = [...amortissements.keys()].sort();
  for (const compte of comptesAmortissement) {
    const a = amortissements.get(compte) as Agregat;
    const solde = a.solde;
    if (solde.isZero()) continue;
    const libelle = `${compte} ${a.tete.compteLib}`.trim();
    if (solde.greaterThan(tolerance)) {
      constats.push({
        gravite: 'moyenne',
        titre: `Compte d'amortissement ${compte} débiteur ${mentionCloture(ctx)}`,
        explication: `Le compte ${compte} présente un solde débiteur de ${montant2(solde)} alors qu'un compte d'amortissement fonctionne en sens contraire des comptes d'immobilisations (PCG art. 1131-3) : son solde est créditeur ou nul.`,
        actionProposee: 'Vérifier les sorties d’immobilisations et les reprises d’amortissements ; corriger le sens ou l’imputation.',
        montant: montant2(solde),
        lignesConcernees: a.ids,
        preuves: [{ libelle: 'Compte', valeur: libelle }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
        cle: `IMM-001|sens|${compte}`,
      });
    }
    const racine = racineBrute(compte);
    let niveau: string | null = null;
    for (let n = racine.length; n >= Math.min(3, racine.length) && niveau === null; n--) {
      const prefixe = racine.slice(0, n);
      if ([...immobilisations.keys()].some((c) => c.startsWith(prefixe))) niveau = prefixe;
    }
    if (niveau === null) {
      constats.push({
        gravite: 'elevee',
        titre: `Amortissements ${compte} sans immobilisation correspondante`,
        explication: `Le compte ${compte} est soldé de ${montant2(solde)} ${mentionCloture(ctx)} mais aucun compte d'immobilisation de racine ${racine} (ni de ses regroupements jusqu'à ${racine.slice(0, 3)}) n'est mouvementé dans les écritures fournies.`,
        actionProposee: 'Vérifier la reprise des à-nouveaux et l’imputation ; si l’immobilisation est sortie, solder ses amortissements.',
        montant: montant2(solde.abs()),
        lignesConcernees: a.ids,
        preuves: [{ libelle: 'Compte d’amortissement', valeur: libelle }, { libelle: 'Racine d’immobilisation attendue', valeur: racine }, { libelle: 'Solde (débit − crédit)', valeur: montant2(solde) }],
        cle: `IMM-001|orphelin|${compte}`,
      });
    } else {
      niveaux.add(niveau);
    }
  }
  for (const niveau of [...niveaux].sort()) {
    const comptes28 = comptesAmortissement.filter((c) => racineBrute(c).startsWith(niveau));
    const agregats28 = comptes28.map((c) => amortissements.get(c) as Agregat);
    const comptes2 = [...immobilisations.keys()].filter((c) => c.startsWith(niveau)).sort();
    const cumul = agregats28.reduce((s, a) => s.plus(a.solde), ZERO).negated();
    const brut = comptes2.reduce((s, c) => s.plus((immobilisations.get(c) as Agregat).solde), ZERO);
    const excedent = cumul.minus(brut);
    if (!excedent.greaterThan(tolerance)) continue;
    constats.push({
      gravite: 'elevee',
      titre: `Amortissements cumulés supérieurs à la valeur brute (immobilisations ${niveau})`,
      explication: `${mentionCloture(ctx).replace(/^./, (c) => c.toUpperCase())}, les amortissements cumulés des comptes ${comptes28.join(', ')} s'élèvent à ${montant2(cumul)} pour une valeur brute de ${montant2(brut)} sur les comptes ${comptes2.join(', ')} : excédent de ${montant2(excedent)}. Un bien ne peut pas être amorti au-delà de sa valeur brute.`,
      actionProposee: 'Rapprocher du tableau des immobilisations ; rechercher une sortie d’actif sans reprise des amortissements, une dotation en double ou une erreur de compte.',
      montant: montant2(excedent),
      lignesConcernees: agregats28.flatMap((a) => a.ids).slice(0, 200),
      preuves: [
        { libelle: 'Niveau de correspondance', valeur: niveau },
        { libelle: 'Valeur brute', valeur: montant2(brut) },
        { libelle: 'Amortissements cumulés', valeur: montant2(cumul) },
        { libelle: 'Excédent', valeur: montant2(excedent) },
      ],
      cle: `IMM-001|excedent|${niveau}`,
    });
  }
  return {
    statut: constats.length > 0 ? 'constat' : 'sans_anomalie',
    constats,
    mesures: { nbComptesAmortissement: String(amortissements.size), nbComptesImmobilisation: String(immobilisations.size) },
  };
}

export const IMM_001 = definir({
  id: 'IMM-001',
  version: '1.0.0',
  cycle: 'immobilisations',
  titre: 'Cohérence immobilisations / amortissements',
  objectif: 'Repérer les amortissements sans immobilisation correspondante, les amortissements cumulés supérieurs à la valeur brute et les comptes d’amortissement de sens anormal.',
  perimetre: 'Comptes d’amortissement (28x) et comptes d’immobilisations amortissables correspondants (20x, 21x, 22x), soldes à la clôture, à-nouveaux compris.',
  donneesObligatoires: ['compteNum', 'debit', 'credit', 'ecritureDate'],
  logique:
    'Soldes par compte à la clôture (débit − crédit). Correspondance du PCG : le compte 28xyz amortit le compte 2xyz (280 ↔ 20, 281 ↔ 21, 2815 ↔ 215, 28183 ↔ 2183…). ' +
    'Pour chaque compte 28 soldé non nul, on cherche les comptes d’immobilisations commençant par la racine correspondante ; à défaut on remonte d’un chiffre à la fois jusqu’au compte à trois chiffres, niveau auquel le PCG établit la correspondance (28183 → 2183, puis 218). ' +
    '(1) Aucun compte d’immobilisation trouvé : constat « amortissement sans immobilisation ». (2) Au niveau de correspondance trouvé, si le cumul des amortissements (tous les comptes 28 relevant de ce niveau) ' +
    'dépasse la valeur brute (tous les comptes 2 de ce niveau) de plus de la tolérance : constat, montant = excédent. (3) Compte 28 à solde débiteur : constat de sens anormal.',
  schemaParametres: z.strictObject({
    prefixesAmortissements: schemaPrefixes,
    prefixesImmobilisations: schemaPrefixes,
    tolerance: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesAmortissements: ['28'], prefixesImmobilisations: ['20', '21', '22'], tolerance: '0.00', maxConstats: 200 },
  exceptions:
    'Les soldes ne sont justes que si les à-nouveaux figurent dans les écritures fournies : sans eux, un amortissement de l’exercice peut dépasser à tort une valeur brute incomplète. ' +
    'Une subdivision propre à l’entreprise qui ne suit pas la ventilation du PCG (amortissements et immobilisations numérotés différemment) donne des faux positifs. ' +
    'Les dépréciations (29x) et les immobilisations financières ou en cours (23x, 26x, 27x) ne sont pas examinées. Le contrôle ne vérifie ni les durées ni les dotations.',
  source: SOURCES.pcgAmortissements,
  resultatsAttendus: 'Chaque compte d’amortissement correspond à un compte d’immobilisation, pour un cumul créditeur inférieur ou égal à la valeur brute.',
  calculGrosVolume:
    'Flux, état borné au plan de comptes. Un passage restreint aux comptes d’immobilisations et d’amortissements : un agrégat par compte (budget d’éléments).',
  calcul(ctx, p) {
    const lignes = lignesJusquaCloture(ctx);
    const amortissements = agreger(lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesAmortissements)), (l) => l.compteNum);
    const immobilisations = agreger(lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesImmobilisations, p.prefixesAmortissements)), (l) => l.compteNum);
    return conclureImm001(amortissements, immobilisations, ctx, p);
  },
  async calculFlux(ctx, p) {
    const avantCloture = jusquaCloture(ctx);
    const amortissements = new Map<string, Agregat>();
    const immobilisations = new Map<string, Agregat>();
    const ajouter = (comptes: Map<string, Agregat>, l: LigneEcriture): void => {
      let a = comptes.get(l.compteNum);
      if (a === undefined) {
        if (amortissements.size + immobilisations.size >= ctx.budget.elements) throw new DepassementBudget(`plus de ${ctx.budget.elements.toLocaleString('fr-FR')} comptes d’immobilisation et d’amortissement`);
        a = new Agregat();
        comptes.set(l.compteNum, a);
      }
      a.ajouter(l);
    };
    for await (const l of ctx.source.parcourir({ ordre: 'fichier', prefixesComptes: [...p.prefixesAmortissements, ...p.prefixesImmobilisations] })) {
      if (!avantCloture(l)) continue;
      if (aPrefixe(l.compteNum, p.prefixesAmortissements)) ajouter(amortissements, l);
      if (aPrefixe(l.compteNum, p.prefixesImmobilisations, p.prefixesAmortissements)) ajouter(immobilisations, l);
    }
    return conclureImm001(amortissements, immobilisations, ctx, p);
  },
});

interface ParametresImm002 { prefixesComptes: string[]; prefixesExclus: string[]; seuil: string; journauxANouveaux: string[] }

/** Examen ligne par ligne des charges susceptibles d'être des immobilisations (commun aux deux chemins). */
class ExamenChargesImmobilisables {
  nbLignes = 0;
  private total: Decimal = ZERO;
  private readonly occurrences = new Map<string, number>();
  private readonly seuil: Decimal;
  private readonly avantCloture: (l: LigneEcriture) => boolean;
  constructor(
    ctx: { exercice: { fin: string } | null },
    private readonly p: ParametresImm002,
  ) {
    this.seuil = dec(p.seuil);
    this.avantCloture = jusquaCloture(ctx);
  }
  get motifSansObjet(): string {
    return `Aucune ligne de charge du périmètre (${this.p.prefixesComptes.join(', ')}, hors exclusions) dans les écritures fournies.`;
  }
  get mesures(): Record<string, string> {
    return { nbLignesExaminees: String(this.nbLignes), totalAuDessusDuSeuil: montant2(this.total) };
  }
  dansLePerimetre(l: LigneEcriture): boolean {
    return this.avantCloture(l) && aPrefixe(l.compteNum, this.p.prefixesComptes, this.p.prefixesExclus) && !this.p.journauxANouveaux.includes(l.journalCode);
  }
  /** Chemin en flux : les lignes arrivent écriture par écriture, le rang des lignes répétées repart de zéro. */
  nouvelleEcriture(): void {
    this.occurrences.clear();
  }
  examiner(l: LigneEcriture): Constat | null {
    if (!this.dansLePerimetre(l)) return null;
    this.nbLignes++;
    const { seuil } = this;
    const debit = debitDe(l);
    if (!debit.greaterThan(seuil)) return null;
    const base = `IMM-002|${cleEcriture(l).replace('\u0001', '|')}|${l.compteNum}|${montant2(debit)}`;
    const n = (this.occurrences.get(base) ?? 0) + 1;
    this.occurrences.set(base, n);
    this.total = this.total.plus(debit);
    return {
      gravite: 'faible',
      titre: `Charge de ${montant2(debit)} au compte ${l.compteNum} : immobilisation à examiner`,
      explication: `La ligne débite le compte ${l.compteNum} de ${montant2(debit)}, au-delà du seuil de ${montant2(seuil)} hors taxes par bien en deçà duquel l'administration admet la déduction immédiate des biens de faible valeur. Si la dépense porte sur un bien durable, elle est à inscrire à l'actif.`,
      actionProposee: 'Consulter la pièce : nature du bien, prix unitaire hors taxes, durée d’utilisation ; reclasser en immobilisation le cas échéant.',
      montant: montant2(debit),
      lignesConcernees: [l.id],
      preuves: [
        { libelle: 'Écriture', valeur: `${l.journalCode} ${l.ecritureNum} du ${l.ecritureDate}` },
        { libelle: 'Compte', valeur: `${l.compteNum} ${l.compteLib}`.trim() },
        { libelle: 'Pièce', valeur: l.pieceRef },
        { libelle: 'Seuil appliqué (HT)', valeur: montant2(seuil) },
      ],
      cle: n === 1 ? base : `${base}|${n}`,
    };
  }
}

export const IMM_002 = definir({
  id: 'IMM-002',
  version: '1.0.0',
  cycle: 'immobilisations',
  titre: 'Charges potentiellement immobilisables (à examiner)',
  objectif: 'Signaler les achats passés en charges dont le montant unitaire dépasse le seuil de tolérance des biens de faible valeur, pour examen de leur inscription à l’actif.',
  perimetre: 'Lignes débitrices des comptes 60x et 61x (paramétrable), hors comptes exclus par défaut car sans rapport avec une immobilisation (achats stockés et de marchandises, énergie, sous-traitance, loyers, assurances…). Restent par défaut 605, 606 (hors 6061), 608 et 615.',
  donneesObligatoires: ['compteNum', 'debit', 'ecritureDate', 'journalCode', 'ecritureNum'],
  logique:
    'Chaque ligne débitrice d’un compte du périmètre dont le débit est STRICTEMENT supérieur au seuil (défaut 500,00, montant hors taxes : une charge est comptabilisée hors TVA récupérable) produit un constat « à examiner », montant = débit de la ligne. ' +
    'Le seuil par défaut est celui de la tolérance administrative des biens de faible valeur (500 € HT par bien, BOI-BIC-CHG-20-30-10). Les lignes des journaux d’à-nouveaux sont ignorées.',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    prefixesExclus: schemaPrefixesFacultatifs,
    seuil: schemaMontantPositif,
    journauxANouveaux: z.array(z.string().min(1).max(20)),
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: {
    prefixesComptes: ['60', '61'],
    prefixesExclus: ['601', '602', '603', '604', '6061', '607', '609', '611', '612', '613', '614', '616', '617', '618', '619'],
    seuil: '500.00',
    journauxANouveaux: ['AN', 'ANO', 'RAN'],
    maxConstats: 200,
  },
  exceptions:
    'Le FEC ne donne pas le prix unitaire : une ligne peut regrouper plusieurs biens dont chacun est sous le seuil, ou concerner une dépense non immobilisable (consommables, entretien courant). ' +
    'La tolérance fiscale ne vise que les matériels et outillages, les matériels et mobiliers de bureau et les logiciels ; elle ne s’applique pas aux biens qui sont l’objet même de l’activité. ' +
    'Si la TVA n’est pas récupérable, la charge est comptabilisée TTC alors que le seuil s’entend hors taxes. Constat d’examen, non d’anomalie.',
  source: SOURCES.bofipBiensFaibleValeur,
  resultatsAttendus: 'Aucune ligne de charge du périmètre au-delà du seuil, ou des lignes justifiées (dépense non immobilisable, lot de biens de faible valeur).',
  calculGrosVolume:
    'Flux, état borné. Un passage groupé par écriture, restreint aux comptes de charges du périmètre : chaque ligne est examinée une fois, le rang des lignes répétées se compte dans son écriture. Limite : si un code de journal, un numéro d’écriture ou un numéro de compte contient « | », le contrôle n’est pas réalisé en flux (motivé).',
  calcul(ctx, p) {
    const examen = new ExamenChargesImmobilisables(ctx, p);
    const constats: Constat[] = [];
    for (const l of ctx.lignes) {
      const c = examen.examiner(l);
      if (c !== null) constats.push(c);
    }
    if (examen.nbLignes === 0) return { statut: 'non_applicable', motif: examen.motifSansObjet };
    return { statut: constats.length > 0 ? 'constat' : 'sans_anomalie', constats, mesures: examen.mesures };
  },
  async calculFlux(ctx, p) {
    const examen = new ExamenChargesImmobilisables(ctx, p);
    const constats = new CollecteurConstats(p);
    let ecriture: string | null = null;
    // Par écriture : le rang d'une ligne répétée (même écriture, même compte, même montant) ne se compte qu'à
    // l'intérieur de son écriture ; le compteur est donc remis à zéro à chaque écriture.
    for await (const l of ctx.source.parcourir({ ordre: 'ecriture', prefixesComptes: p.prefixesComptes })) {
      if (!examen.dansLePerimetre(l)) continue;
      // La clé des constats sépare ses champs par « | » : un journal ou un numéro qui en contient pourrait faire
      // coïncider les clés de deux écritures distinctes, cas que seul le calcul en mémoire départage.
      if (l.journalCode.includes('|') || l.ecritureNum.includes('|') || l.compteNum.includes('|')) {
        throw new DepassementBudget('un code de journal, un numéro d’écriture ou un numéro de compte contient le caractère « | », cas traité seulement par le calcul en mémoire');
      }
      const k = cleEcriture(l);
      if (k !== ecriture) {
        examen.nouvelleEcriture();
        ecriture = k;
      }
      constats.ajouter(examen.examiner(l));
    }
    if (examen.nbLignes === 0) return { statut: 'non_applicable', motif: examen.motifSansObjet };
    return { ...constats.conclure(), mesures: examen.mesures };
  },
});
