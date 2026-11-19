import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { nettoyerTexteBancaire } from '../banque/commun.js';
import type { CompteReleve, MouvementBancaire } from '../banque/types.js';
import { dec } from '../montant.js';
import { elementDepuisMouvement, elementsBanqueDepuisEcritures } from '../rapprochement/conversion.js';
import { rapprocher } from '../rapprochement/rapprocher.js';
import { sourceInterne } from '../sources.js';
import { ZERO, aPrefixe, definir, montant2, schemaMaxConstats, schemaMontantPositif, schemaPrefixes, soldeDe } from './outils.js';
import type { Constat, LigneEcriture } from './types.js';

const cleCompteBancaire = (c: { iban: string | null; identifiant: string | null }): string => (c.iban ?? c.identifiant ?? '').replace(/\s/g, '').toUpperCase();

export const TRE_003 = definir({
  id: 'TRE-003',
  version: '1.0.0',
  cycle: 'tresorerie',
  titre: 'Rapprochement bancaire : écart entre solde comptable et solde du relevé',
  objectif: 'Mesurer, à la date de clôture du relevé, l’écart entre le solde comptable du compte de banque et le solde du relevé, et l’expliquer par les écritures et mouvements non rapprochés.',
  perimetre: 'Comptes 512 (paramétrable) pour lesquels un relevé bancaire lu et cadré est fourni dans le contexte (`releves`). Un compte comptable par compte bancaire.',
  donneesObligatoires: ['compteNum', 'ecritureDate', 'debit', 'credit', 'pieceRef', 'releves (soldes d’ouverture et de clôture, mouvements)'],
  logique:
    'Association compte 512 ↔ compte bancaire : paramètre `correspondances`, ou d’office s’il n’y a qu’un compte 512 et qu’un compte bancaire. Les relevés du compte doivent être lisibles, cadrés (ouverture + mouvements = clôture) et contigus. ' +
    'Date d’arrêté D = dernière date de clôture des relevés. Solde comptable = Σ (débit − crédit) du 512 jusqu’à D ; solde du relevé = solde de clôture (positif = créditeur chez la banque = avoir de l’entreprise). ' +
    'Écart = solde comptable − solde du relevé. Les lignes du 512 datées du début de la période des relevés jusqu’à D (hors journaux d’à-nouveaux) sont rapprochées des mouvements par le module de rapprochement déterministe (niveaux exact et règles). ' +
    'L’écart se décompose exactement en : écart à l’ouverture (solde comptable avant la période − solde d’ouverture du relevé) + écritures comptables non rapprochées − mouvements bancaires non rapprochés + écarts des rapprochements. ' +
    'Sans écart supérieur au seuil, sans suspens et sans écart d’ouverture : sans anomalie. Sinon un constat par compte, montant = valeur absolue de l’écart, avec l’état de rapprochement en preuves.',
  schemaParametres: z.strictObject({
    prefixesComptes: schemaPrefixes,
    correspondances: z.array(z.strictObject({ compteNum: z.string().regex(/^\d{3,12}$/), compteBancaire: z.string().min(1).max(64) })),
    journauxANouveaux: z.array(z.string().min(1).max(20)),
    toleranceMontant: schemaMontantPositif,
    fenetreJours: z.number().int().min(0).max(366),
    seuilEcart: schemaMontantPositif,
    maxConstats: schemaMaxConstats,
  }),
  parametresParDefaut: { prefixesComptes: ['512'], correspondances: [], journauxANouveaux: ['AN', 'ANO', 'RAN'], toleranceMontant: '0.00', fenetreJours: 5, seuilEcart: '0.00', maxConstats: 200 },
  exceptions:
    'Un écart expliqué par des suspens (chèques émis non débités, remises en cours) est normal : le constat est un état de rapprochement à examiner, pas une anomalie en soi. ' +
    'Les mouvements de même montant à des dates proches sont laissés non rapprochés (ambiguïté non tranchée) et gonflent les suspens. ' +
    'Le contrôle n’est pas réalisé si un relevé est illisible, non cadré, non contigu, si le solde d’ouverture manque (OFX, CSV sans solde) ou si l’association compte comptable / compte bancaire est indéterminée. ' +
    'La date d’arrêté est celle du relevé, qui peut différer de la clôture de l’exercice.',
  source: sourceInterne('Convention de cabinet (état de rapprochement bancaire). Contexte : PCG art. 1215-51, une subdivision du compte 512 par compte bancaire.'),
  resultatsAttendus: 'Solde comptable égal au solde du relevé, ou écart intégralement expliqué par des suspens identifiés.',
  calcul(ctx, p) {
    const releves = ctx.releves ?? [];
    if (releves.length === 0) return { statut: 'non_realise', motif: 'Aucun relevé bancaire fourni : rapprochement bancaire non réalisé.' };
    const lisibles = releves.filter((r) => r.lisible);
    if (lisibles.length === 0) return { statut: 'non_realise', motif: 'Aucun des relevés bancaires fournis n’est lisible : rapprochement bancaire non réalisé.' };
    const lignesBanque = ctx.lignes.filter((l) => aPrefixe(l.compteNum, p.prefixesComptes));
    const comptes512 = [...new Set(lignesBanque.map((l) => l.compteNum))].sort();
    if (comptes512.length === 0) return { statut: 'non_applicable', motif: `Aucun compte de banque (${p.prefixesComptes.join(', ')}) mouvementé dans les écritures fournies.` };

    const comptesBancaires = new Map<string, { releves: CompteReleve[]; mouvements: MouvementBancaire[] }>();
    for (const r of lisibles) {
      for (const c of r.comptes) {
        const k = cleCompteBancaire(c);
        const e = comptesBancaires.get(k) ?? { releves: [], mouvements: [] };
        e.releves.push(c);
        comptesBancaires.set(k, e);
      }
      for (const m of r.mouvements) {
        const k = cleCompteBancaire(m.compte);
        const e = comptesBancaires.get(k) ?? { releves: [], mouvements: [] };
        e.mouvements.push(m);
        comptesBancaires.set(k, e);
      }
    }
    const paires: Array<{ compteNum: string; cle: string }> = [];
    const nonRealises: string[] = [];
    if (p.correspondances.length > 0) {
      for (const c of comptes512) {
        const corr = p.correspondances.filter((x) => x.compteNum === c);
        const cle = corr.length === 1 ? (corr[0] as { compteBancaire: string }).compteBancaire.replace(/\s/g, '').toUpperCase() : null;
        if (cle !== null && comptesBancaires.has(cle)) paires.push({ compteNum: c, cle });
        else nonRealises.push(`compte ${c} : aucun relevé pour le compte bancaire associé (correspondance absente, multiple ou sans relevé)`);
      }
    } else if (comptes512.length === 1 && comptesBancaires.size === 1) {
      paires.push({ compteNum: comptes512[0] as string, cle: [...comptesBancaires.keys()][0] as string });
    } else {
      return {
        statut: 'non_realise',
        motif: `Association indéterminée entre ${comptes512.length} compte(s) 512 et ${comptesBancaires.size} compte(s) bancaire(s) : renseigner le paramètre « correspondances ».`,
      };
    }

    const seuil = dec(p.seuilEcart);
    const constats: Constat[] = [];
    const mesures: Record<string, string> = {};
    let nbRealises = 0;
    for (const { compteNum, cle } of paires) {
      const donnees = comptesBancaires.get(cle) as { releves: CompteReleve[]; mouvements: MouvementBancaire[] };
      const designation = cle === '' ? '(compte bancaire non identifié)' : nettoyerTexteBancaire(cle, 40);
      const etats = [...donnees.releves].sort((x, y) => ((x.dateCloture ?? '') < (y.dateCloture ?? '') ? -1 : (x.dateCloture ?? '') > (y.dateCloture ?? '') ? 1 : 0));
      const premier = etats[0];
      const dernier = etats[etats.length - 1];
      if (premier === undefined || dernier === undefined) {
        nonRealises.push(`compte ${compteNum} : aucun solde de relevé pour ${designation}`);
        continue;
      }
      if (etats.some((e) => e.cadrage !== 'ok')) {
        nonRealises.push(`compte ${compteNum} : relevé de ${designation} non cadré ou non vérifiable (solde d'ouverture ou de clôture absent, ou écart entre soldes et mouvements)`);
        continue;
      }
      if (etats.some((e, i) => i > 0 && !dec(e.soldeOuverture as string).equals(dec((etats[i - 1] as CompteReleve).soldeCloture as string)))) {
        nonRealises.push(`compte ${compteNum} : relevés de ${designation} non contigus (un solde d'ouverture diffère du solde de clôture précédent)`);
        continue;
      }
      const dateArrete = dernier.dateCloture;
      if (dateArrete === null) {
        nonRealises.push(`compte ${compteNum} : date de clôture du relevé de ${designation} absente`);
        continue;
      }
      const mouvements = donnees.mouvements;
      if (new Set(mouvements.map((m) => m.cleIdempotence)).size !== mouvements.length) {
        nonRealises.push(`compte ${compteNum} : mouvements en double entre les relevés fournis pour ${designation}`);
        continue;
      }
      const datesMouvements = mouvements.map((m) => m.dateOperation).sort();
      const debutPeriode = premier.dateOuverture ?? datesMouvements[0] ?? dateArrete;
      const lignes = lignesBanque.filter((l) => l.compteNum === compteNum && l.ecritureDate <= dateArrete);
      const estOuverture = (l: LigneEcriture): boolean => p.journauxANouveaux.includes(l.journalCode) || l.ecritureDate < debutPeriode;
      const lignesOuverture = lignes.filter(estOuverture);
      const lignesPeriode = lignes.filter((l) => !estOuverture(l));
      const soldeComptable = soldeDe(lignes);
      const soldeReleve = dec(dernier.soldeCloture as string);
      const ecart = soldeComptable.minus(soldeReleve);
      const ecartOuverture = soldeDe(lignesOuverture).minus(dec(premier.soldeOuverture as string));

      // Le tiers d'une ligne de banque se lit sur les autres lignes de son écriture : conversion sur toutes les écritures.
      const idsPeriode = new Set(lignesPeriode.map((l) => l.id));
      const resultat = rapprocher(
        elementsBanqueDepuisEcritures(ctx.lignes, { compteNum }).filter((e) => idsPeriode.has(e.id)),
        mouvements.map((m) => elementDepuisMouvement(m)),
        { toleranceMontant: p.toleranceMontant, fenetreJours: p.fenetreJours },
      );
      nbRealises++;
      const parId = new Map(lignesPeriode.map((l) => [l.id, l]));
      const parCle = new Map(mouvements.map((m) => [m.cleIdempotence, m]));
      const suspensCompta = resultat.nonRapprochesA.map((id) => parId.get(id)).filter((l): l is LigneEcriture => l !== undefined);
      const suspensBanque = resultat.nonRapprochesB.map((id) => parCle.get(id)).filter((m): m is MouvementBancaire => m !== undefined);
      const totalSuspensCompta = soldeDe(suspensCompta);
      let totalSuspensBanque: Decimal = ZERO;
      for (const m of suspensBanque) totalSuspensBanque = totalSuspensBanque.plus(dec(m.montant));
      let ecartsRapprochements: Decimal = ZERO;
      for (const r of resultat.rapprochements) ecartsRapprochements = ecartsRapprochements.plus(dec(r.ecart));
      const explique = ecartOuverture.plus(totalSuspensCompta).minus(totalSuspensBanque).plus(ecartsRapprochements);
      const nonExplique = ecart.minus(explique);
      Object.assign(mesures, {
        [`${compteNum}.dateArrete`]: dateArrete,
        [`${compteNum}.soldeComptable`]: montant2(soldeComptable),
        [`${compteNum}.soldeReleve`]: montant2(soldeReleve),
        [`${compteNum}.ecart`]: montant2(ecart),
        [`${compteNum}.nbRapprochements`]: String(resultat.rapprochements.length),
        [`${compteNum}.nbEcrituresNonRapprochees`]: String(suspensCompta.length),
        [`${compteNum}.nbMouvementsNonRapproches`]: String(suspensBanque.length),
        [`${compteNum}.nbAmbiguites`]: String(resultat.ambiguites.length),
        [`${compteNum}.nbAbandons`]: String(resultat.abandons.length),
      });
      const aSuspens = suspensCompta.length > 0 || suspensBanque.length > 0;
      if (!ecart.abs().greaterThan(seuil) && !aSuspens && ecartOuverture.isZero() && nonExplique.isZero()) continue;
      const exemples = suspensBanque.slice(0, 10).map((m) => ({
        libelle: `Mouvement bancaire non rapproché du ${m.dateOperation} (rang ${m.rang})`,
        valeur: `${m.montant} — ${m.libelle.slice(0, 80)}`,
      }));
      constats.push({
        gravite: !ecartOuverture.isZero() || !nonExplique.isZero() || resultat.ambiguites.length > 0 || resultat.abandons.length > 0 ? 'moyenne' : 'faible',
        titre: ecart.isZero()
          ? `Banque ${compteNum} : soldes concordants au ${dateArrete} mais suspens à examiner`
          : `Banque ${compteNum} : écart de ${montant2(ecart)} avec le relevé au ${dateArrete} (à examiner)`,
        explication:
          `Solde comptable ${montant2(soldeComptable)}, solde du relevé ${montant2(soldeReleve)} : écart de ${montant2(ecart)}. Décomposition : écart à l'ouverture ${montant2(ecartOuverture)} ; ` +
          `${suspensCompta.length} écriture(s) comptable(s) non rapprochée(s) pour ${montant2(totalSuspensCompta)} ; ${suspensBanque.length} mouvement(s) bancaire(s) non rapproché(s) pour ${montant2(totalSuspensBanque)} ; ` +
          `écarts des rapprochements ${montant2(ecartsRapprochements)} ; non expliqué ${montant2(nonExplique)}. ` +
          `${resultat.ambiguites.length} ambiguïté(s) non tranchée(s), ${resultat.abandons.length} recherche(s) abandonnée(s).`,
        actionProposee: 'Établir l’état de rapprochement : justifier chaque suspens (chèque non débité, remise en cours), comptabiliser les mouvements bancaires absents de la comptabilité, corriger les écritures sans contrepartie bancaire.',
        montant: montant2(ecart.abs()),
        lignesConcernees: suspensCompta.slice(0, 200).map((l) => l.id),
        preuves: [
          { libelle: 'Compte bancaire', valeur: designation },
          { libelle: 'Date d’arrêté (clôture du relevé)', valeur: dateArrete },
          { libelle: 'Solde comptable (débit − crédit)', valeur: montant2(soldeComptable) },
          { libelle: 'Solde du relevé', valeur: montant2(soldeReleve) },
          { libelle: 'Écart (comptabilité − relevé)', valeur: montant2(ecart) },
          { libelle: 'Écart à l’ouverture', valeur: montant2(ecartOuverture) },
          { libelle: 'Écritures comptables non rapprochées', valeur: `${suspensCompta.length} pour ${montant2(totalSuspensCompta)}` },
          { libelle: 'Mouvements bancaires non rapprochés', valeur: `${suspensBanque.length} pour ${montant2(totalSuspensBanque)}` },
          { libelle: 'Rapprochements établis', valeur: String(resultat.rapprochements.length) },
          ...exemples,
        ],
        cle: `TRE-003|${compteNum}|${dateArrete}`,
      });
    }
    mesures['nbComptesRapproches'] = String(nbRealises);
    mesures['nbComptesNonRealises'] = String(nonRealises.length);
    const motif = nonRealises.length > 0 ? `Non réalisé pour : ${nonRealises.join(' ; ')}.` : null;
    if (constats.length > 0) return { statut: 'constat', motif, constats, mesures };
    if (nonRealises.length > 0) return { statut: 'non_realise', motif, mesures };
    return { statut: 'sans_anomalie', mesures };
  },
});
