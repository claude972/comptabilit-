import { ConflictException, Controller, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { calculerIndicateurs, CATALOGUE_INDICATEURS, elementDepuisMouvement, elementsBanqueDepuisEcritures, type LigneEcriture, type MouvementBancaire, schemaParametresRapprochement, verifierSuggestion } from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, inArray, journaliser, lt, schema as s, sql, type Tx } from '@comtaple/db';
import {
  A_QUALIFIER,
  analyserLettreMission,
  classerPiece,
  commenterIndicateurs,
  expliquerConstat,
  MENTION_CONFIANCE,
  type ResultatTache,
  suggererRapprochements,
  TAILLE_MAX_LETTRE,
} from '@comtaple/ia';
import type { Config, ServicesIa } from '@comtaple/plateforme';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { messageEtatIa } from './assistant.controller.js';
import { limiterDebitIa } from './assistant.service.js';
import { BD, CONFIG, IA } from './jetons.js';
import { avecCalcul, chargerLignes, ApiRefusVolume } from './plafonds.js';

const TACHES_PAR_MINUTE = 30;
/** Libellés des natures de documents proposées au classement (liste fermée = natures existantes). */
const LIBELLES_NATURE: Record<string, string> = {
  facture_achat: 'Facture d’achat',
  facture_vente: 'Facture de vente',
  avoir: 'Avoir',
  releve_bancaire: 'Relevé bancaire',
  lettre_mission: 'Lettre de mission',
  contrat: 'Contrat',
  autre: 'Autre document',
};

type Origine = 'ia' | 'simulateur' | 'repli_deterministe' | 'aucune';

/** Réponse commune des tâches IA : toujours une PROPOSITION (ou son absence), jamais une action appliquée. */
export interface ReponseTacheIa<P> {
  tache: string;
  statut: 'propose' | 'abstention' | 'rejete' | 'ia_indisponible';
  /** `ia` : modèle réel ; `simulateur` : SIMULATEUR de test ; `repli_deterministe` : calcul sans IA ; `aucune` : rien n'a été produit. */
  origine: Origine;
  etiquette: string;
  proposition: P | null;
  preuves: unknown[];
  confiance: { statut: 'non_evaluee'; mention: string; indiceModele: number | null };
  avertissements: string[];
  motif: string | null;
  codes: string[];
  /** Ligne de `propositions_ia` (statut « non_examinee ») ; `null` si aucune proposition n'existe. */
  propositionId: string | null;
  /** Toujours faux : rien n'est appliqué à la cible sans action humaine. */
  applique: false;
  ia: { statut: string; message: string };
}

@ApiTags('Assistant et IA')
@ApiBearerAuth()
@Controller('v1')
export class IaTachesController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(IA) private readonly ia: ServicesIa,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private contexte(acces: Acces, entiteId: string) {
    return { cabinetId: acces.cabinetId, dossierId: entiteId, utilisateurId: acces.utilisateurId };
  }

  /**
   * Met en forme le résultat d'une tâche, enregistre la proposition s'il y en a une (jamais appliquée), et trace
   * l'action au journal d'audit (sans contenu).
   */
  private async conclure<P, R>(
    acces: Acces,
    tache: string,
    cible: { type: string; id: string; entiteId: string },
    resultat: ResultatTache<P, R>,
    preuvesDe: (proposition: P | R) => unknown[],
  ): Promise<ReponseTacheIa<P | R>> {
    const etat = this.ia.statut().statut;
    const commun = { tache, applique: false as const, ia: { statut: etat, message: messageEtatIa(etat) } };
    const confiance = { statut: 'non_evaluee' as const, mention: MENTION_CONFIANCE, indiceModele: null as number | null };
    const simulateur = this.ia.natureFournisseur === 'simulateur';
    let reponse: ReponseTacheIa<P | R>;
    let enregistrement: { modele: string; versionPrompt: string } | null = null;
    if (resultat.statut === 'propose') {
      reponse = {
        ...commun,
        statut: 'propose',
        origine: simulateur ? 'simulateur' : 'ia',
        etiquette: simulateur ? 'SIMULATEUR de test : proposition programmée pour les essais, aucune IA réelle.' : 'Proposition rédigée par une IA : à vérifier avant toute décision.',
        proposition: resultat.proposition,
        preuves: preuvesDe(resultat.proposition),
        confiance: { ...confiance, indiceModele: resultat.confiance.indiceModele },
        avertissements: resultat.avertissements,
        motif: null,
        codes: [],
        propositionId: null,
      };
      enregistrement = { modele: simulateur ? `SIMULATEUR (${resultat.modele})` : resultat.modele, versionPrompt: `${resultat.prompt.id}@${resultat.prompt.version}` };
    } else if (resultat.statut === 'ia_indisponible' && resultat.repli) {
      reponse = {
        ...commun,
        statut: 'ia_indisponible',
        origine: 'repli_deterministe',
        etiquette: resultat.repli.etiquette,
        proposition: resultat.repli.resultat,
        preuves: preuvesDe(resultat.repli.resultat),
        confiance,
        avertissements: [],
        motif: 'IA indisponible : résultat produit par un calcul déterministe, sans modèle.',
        codes: [resultat.code],
        propositionId: null,
      };
      enregistrement = { modele: 'aucun (repli déterministe, sans IA)', versionPrompt: 'sans-ia' };
    } else {
      const vide = { ...commun, origine: 'aucune' as const, proposition: null, preuves: [], confiance, avertissements: [], propositionId: null };
      if (resultat.statut === 'ia_indisponible') reponse = { ...vide, statut: 'ia_indisponible', etiquette: 'IA indisponible : aucune proposition. Cette tâche n’a pas de repli sans IA.', motif: 'IA indisponible : cette tâche n’a pas d’équivalent déterministe ; le travail reste à faire à la main.', codes: [resultat.code] };
      else if (resultat.statut === 'abstention') reponse = { ...vide, statut: 'abstention', etiquette: 'Le modèle s’abstient : aucune proposition.', motif: resultat.motif, codes: [] };
      else reponse = { ...vide, statut: 'rejete', etiquette: 'Sortie du modèle rejetée par les vérifications : aucune proposition.', motif: 'La sortie du modèle n’a pas passé les vérifications déterministes.', codes: resultat.motifs };
    }
    reponse.propositionId = await this.bd.avecContexte(acces, async (tx) => {
      let id: string | null = null;
      if (enregistrement && reponse.proposition !== null) {
        const [p] = await tx
          .insert(s.propositionsIa)
          .values({
            cabinetId: acces.cabinetId,
            entiteId: cible.entiteId,
            tache,
            modele: enregistrement.modele,
            versionPrompt: enregistrement.versionPrompt,
            cibleType: cible.type,
            cibleId: cible.id,
            contenu: { origine: reponse.origine, etiquette: reponse.etiquette, proposition: reponse.proposition, avertissements: reponse.avertissements, indiceModele: reponse.confiance.indiceModele },
            preuves: reponse.preuves,
            confiance: 'non_evaluee',
            statut: 'non_examinee',
          })
          .returning({ id: s.propositionsIa.id });
        id = p?.id ?? null;
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'ia.tache', cibleType: cible.type, cibleId: cible.id, entiteId: cible.entiteId, details: { tache, statut: reponse.statut, origine: reponse.origine, codes: reponse.codes, propositionId: id } });
      return id;
    });
    await this.ia.journal.vider();
    return reponse;
  }

  private async textePages(tx: Tx, documentId: string): Promise<string> {
    const pages = await tx.select({ texte: s.pagesDocument.texte }).from(s.pagesDocument).where(eq(s.pagesDocument.documentId, documentId)).orderBy(asc(s.pagesDocument.numero));
    return pages.map((p) => p.texte ?? '').join('\n\n').trim();
  }

  @Post('documents/:id/proposition-classement')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Proposer le type d’une pièce et son dossier de rattachement (proposition, jamais appliquée)',
    description:
      'Types possibles : les natures de documents existantes. Dossiers candidats : ceux où l’utilisateur est habilité. Une incertitude laisse la pièce « à qualifier ». Sans IA connectée — état actuel — le résultat vient d’un repli déterministe étiqueté (rattachement par indice exact, type à qualifier). Rien n’est modifié sur la pièce : la qualification reste une action humaine (PATCH v1/documents/:id).',
  })
  async classement(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    limiterDebitIa(`tache:${acces.utilisateurId}`, TACHES_PAR_MINUTE);
    const d = await this.bd.avecContexte(acces, async (tx) => {
      const [doc] = await tx.select().from(s.documents).where(eq(s.documents.id, id));
      if (!doc) throw new NotFoundException('Document introuvable');
      await exigerNiveau(tx, doc.entiteId, 'collaboration');
      const texte = await this.textePages(tx, id);
      if (texte === '') throw new ConflictException('Aucun texte n’a été extrait de cette pièce : aucun classement ne peut être proposé.');
      // Dossiers candidats : uniquement ceux où l'utilisateur a une habilitation (calculée par la base).
      const dossiers = (
        await tx.execute(sql`
          select id, raison_sociale as "raisonSociale", siren from entites
          where actif and app_niveau_entite(id) >= 'lecture' order by (id = ${doc.entiteId}::uuid) desc, raison_sociale, id limit 50`)
      ).rows as Array<{ id: string; raisonSociale: string; siren: string | null }>;
      return { doc, texte, dossiers };
    });
    const resultat = await classerPiece(
      this.ia.active(),
      {
        texte: d.texte,
        nomFichier: d.doc.nomOrigine.slice(0, 300),
        types: s.natureDocument.enumValues.filter((n) => n !== A_QUALIFIER).map((code) => ({ code, libelle: LIBELLES_NATURE[code] ?? code })),
        dossiers: d.dossiers.map((x) => ({ id: x.id, libelle: x.raisonSociale.slice(0, 200) || x.id, indices: [x.siren ?? '', x.raisonSociale].map((i) => i.trim()).filter((i) => i.length >= 3 && i.length <= 200) })),
      },
      this.contexte(acces, d.doc.entiteId),
    );
    const reponse = await this.conclure(acces, 'classer_piece', { type: 'document', id, entiteId: d.doc.entiteId }, resultat, (p) => p.preuves);
    const dossier = reponse.proposition?.dossierId ? d.dossiers.find((x) => x.id === reponse.proposition?.dossierId) : undefined;
    return {
      ...reponse,
      libelles: { type: reponse.proposition ? (reponse.proposition.type === A_QUALIFIER ? 'À qualifier' : (LIBELLES_NATURE[reponse.proposition.type] ?? reponse.proposition.type)) : null, dossier: dossier?.raisonSociale ?? null },
      pieceActuelle: { nature: d.doc.nature, entiteId: d.doc.entiteId },
    };
  }

  @Post('constats/:id/explication')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Expliquer un constat en langage courant (projet d’explication, sans fait nouveau)',
    description: 'Sans IA connectée — état actuel — le repli étiqueté restitue le message du constat tel que le moteur l’a produit. Le constat n’est pas modifié.',
  })
  async explication(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    limiterDebitIa(`tache:${acces.utilisateurId}`, TACHES_PAR_MINUTE);
    const c = await this.bd.avecContexte(acces, async (tx) => {
      const [constat] = await tx.select().from(s.constats).where(eq(s.constats.id, id));
      if (!constat) throw new NotFoundException('Constat introuvable');
      await exigerNiveau(tx, constat.entiteId, 'collaboration');
      const [resultat] = await tx.select().from(s.resultatsControles).where(eq(s.resultatsControles.id, constat.resultatId));
      return { constat, regle: ((resultat?.source as { reference?: unknown } | null)?.reference as string | undefined) ?? null };
    });
    const k = c.constat;
    const resultat = await expliquerConstat(
      this.ia.active(),
      {
        constat: {
          id: k.id,
          controle: k.controleId.slice(0, 300),
          gravite: k.gravite,
          message: (k.explication || k.titre).slice(0, 2000),
          faits: [
            { libelle: 'Titre du constat', valeur: k.titre.slice(0, 1000) },
            ...(k.montant !== null ? [{ libelle: 'Montant', valeur: String(k.montant) }] : []),
            { libelle: 'Action proposée par le moteur', valeur: k.actionProposee.slice(0, 1000) },
            { libelle: 'Nombre d’écritures concernées', valeur: String((k.lignesConcernees as unknown[]).length) },
            // Preuves établies par le moteur (libellé → valeur), bornées.
            ...(Array.isArray(k.preuves) ? (k.preuves as Array<{ libelle?: unknown; valeur?: unknown }>) : [])
              .filter((p) => typeof p?.libelle === 'string' && (typeof p?.valeur === 'string' || typeof p?.valeur === 'number'))
              .slice(0, 50)
              .map((p) => ({ libelle: String(p.libelle).slice(0, 200), valeur: String(p.valeur).slice(0, 1000) })),
          ],
          regle: typeof c.regle === 'string' ? c.regle.slice(0, 1000) : null,
        },
      },
      this.contexte(acces, k.entiteId),
    );
    return this.conclure(acces, 'expliquer_constat', { type: 'constat', id, entiteId: k.entiteId }, resultat, () => [{ type: 'constat', id: k.id, controle: k.controleId }]);
  }

  @Post('exercices/:id/indicateurs/commentaire')
  @ApiRefusVolume()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Commenter les indicateurs calculés par le moteur (projet de commentaire)',
    description: 'Le modèle ne calcule rien : tout chiffre doit figurer dans les indicateurs du moteur. Sans IA connectée — état actuel — le repli étiqueté restitue les indicateurs par gabarit, sans rédaction.',
  })
  async commentaire(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    limiterDebitIa(`tache:${acces.utilisateurId}`, TACHES_PAR_MINUTE);
    const d = await avecCalcul(this.bd, acces, async (tx, budget) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'collaboration');
      const [lot] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      if (!lot) throw new ConflictException('Aucune donnée comptable importée pour cet exercice : aucun indicateur à commenter');
      const [precedent] = await tx.select().from(s.exercices).where(and(eq(s.exercices.entiteId, exercice.entiteId), lt(s.exercices.fin, exercice.debut))).orderBy(desc(s.exercices.fin)).limit(1);
      let lotP: typeof s.lotsImport.$inferSelect | undefined;
      if (precedent) [lotP] = await tx.select().from(s.lotsImport).where(and(eq(s.lotsImport.exerciceId, precedent.id), eq(s.lotsImport.type, 'fec'), eq(s.lotsImport.actif, true)));
      // Plafond de l'API (D-093) : exercice puis exercice précédent, sous le même total.
      const charge = await chargerLignes(tx, budget, this.cfg, { ecran: 'Commentaire des indicateurs', plafond: 'calcul', lot, lotPrecedent: lotP ?? null });
      const lignes = charge.lignes;
      const exercicePrecedent: { lignes: LigneEcriture[]; exercice: { debut: string; fin: string } } | null = charge.precedent && precedent ? { lignes: charge.precedent, exercice: { debut: precedent.debut, fin: precedent.fin } } : null;
      return { exercice, valeurs: calculerIndicateurs({ lignes, exercice: { debut: exercice.debut, fin: exercice.fin }, exercicePrecedent }) };
    });
    const definitions = new Map(CATALOGUE_INDICATEURS.map((x) => [x.id, x]));
    const indicateurs = d.valeurs.slice(0, 40).map((v) => ({
      id: v.id,
      libelle: (definitions.get(v.id)?.libelle ?? v.id).slice(0, 300),
      statut: v.statut,
      valeur: v.valeur,
      unite: v.unite,
      formule: (definitions.get(v.id)?.formule ?? '').slice(0, 1000),
      periode: v.periode,
      motif: v.motif === null ? null : v.motif.slice(0, 500),
      precedent: v.precedent ?? null,
      mentions: v.mentions.slice(0, 20).map((m) => m.slice(0, 500)),
    }));
    const resultat = await commenterIndicateurs(this.ia.active(), { indicateurs }, this.contexte(acces, d.exercice.entiteId));
    return this.conclure(acces, 'commenter_indicateurs', { type: 'exercice', id, entiteId: d.exercice.entiteId }, resultat, (p) =>
      typeof p === 'string' ? indicateurs.map((i) => ({ type: 'indicateur', id: i.id })) : p.indicateursCites.map((i) => ({ type: 'indicateur', id: i })),
    );
  }

  @Post('lettres/:id/analyse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Analyser le texte de la lettre de mission signée jointe (projet à valider, jamais appliqué à la lettre)',
    description: 'Exige une pièce jointe à la lettre et un texte extrait (409 sinon). Aucun repli sans IA n’existe pour cette tâche : sans IA connectée — état actuel — la réponse est « ia_indisponible » et la lettre se saisit à la main.',
  })
  async lettre(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    limiterDebitIa(`tache:${acces.utilisateurId}`, TACHES_PAR_MINUTE);
    const d = await this.bd.avecContexte(acces, async (tx) => {
      const [l] = await tx.select().from(s.lettresMission).where(eq(s.lettresMission.id, id));
      if (!l) throw new NotFoundException('Lettre introuvable');
      await exigerNiveau(tx, l.entiteId, 'collaboration');
      if (!l.documentId) throw new ConflictException('Aucune lettre signée n’est jointe à cette lettre de mission : rien à analyser.');
      const [doc] = await tx.select({ id: s.documents.id, entiteId: s.documents.entiteId }).from(s.documents).where(eq(s.documents.id, l.documentId));
      if (!doc || doc.entiteId !== l.entiteId) throw new ConflictException('La pièce jointe à cette lettre est introuvable dans ce dossier.');
      const texte = await this.textePages(tx, doc.id);
      if (texte === '') throw new ConflictException('Aucun texte n’a été extrait de la lettre signée jointe : rien à analyser.');
      if (texte.length > TAILLE_MAX_LETTRE) throw new ConflictException(`Le texte de la lettre dépasse ${TAILLE_MAX_LETTRE.toLocaleString('fr-FR')} caractères : il n’est pas analysé (aucune troncature silencieuse d’un contrat).`);
      return { lettre: l, texte };
    });
    const resultat = await analyserLettreMission(this.ia.active(), { texte: d.texte, nature: d.lettre.avenantDe ? 'avenant' : 'lettre_mission' }, this.contexte(acces, d.lettre.entiteId));
    return this.conclure(acces, 'analyser_lettre_mission', { type: 'lettre_mission', id, entiteId: d.lettre.entiteId }, resultat, (p) => p.elements.map((e) => ({ type: 'extrait', rubrique: e.rubrique, extrait: e.extrait })));
  }

  @Post('exercices/:id/rapprochements/suggestions')
  @ApiRefusVolume()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suggérer des rapprochements parmi les éléments restés sans rapprochement (suggestions vérifiées par le moteur, à valider)',
    description:
      'Part du dernier rapprochement à jour de l’exercice. Chaque suggestion du modèle est vérifiée arithmétiquement par le moteur ; une suggestion fausse est écartée. Aucun repli sans IA n’existe (le rapprochement déterministe est celui du moteur) : sans IA connectée — état actuel — la réponse est « ia_indisponible ». Aucun rapprochement n’est créé ni validé.',
  })
  async rapprochements(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    limiterDebitIa(`tache:${acces.utilisateurId}`, TACHES_PAR_MINUTE);
    const MAX = 150;
    const d = await avecCalcul(this.bd, acces, async (tx, budget) => {
      const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, id));
      if (!exercice) throw new NotFoundException('Exercice introuvable');
      await exigerNiveau(tx, exercice.entiteId, 'collaboration');
      const [execution] = await tx.select().from(s.executionsRapprochement).where(eq(s.executionsRapprochement.exerciceId, id)).orderBy(desc(s.executionsRapprochement.creeLe)).limit(1);
      if (!execution || execution.statut !== 'termine') throw new ConflictException('Aucun rapprochement terminé pour cet exercice : lancez d’abord le rapprochement du moteur.');
      if (execution.obsolete) throw new ConflictException('Les données ont changé depuis le dernier rapprochement : relancez-le avant de demander des suggestions.');
      const UUID = /^[0-9a-f-]{36}$/i;
      const idsE = ((execution.nonRapprochesEcritures as string[] | null) ?? []).filter((x) => UUID.test(x));
      const idsM = ((execution.nonRapprochesMouvements as string[] | null) ?? []).filter((x) => UUID.test(x));
      if (idsE.length === 0 || idsM.length === 0) throw new ConflictException('Il ne reste pas d’écriture de banque et de mouvement bancaire sans rapprochement : rien à suggérer.');
      const voulues = new Set(idsE.slice(0, MAX));
      // Le tiers d'une ligne de banque vient des autres lignes de son écriture : le moteur a besoin du lot entier.
      // Plafond de l'API (D-093) sur le LOT entier (l'ancienne garde ne regardait que les lignes de banque et laissait passer un lot trop gros).
      const [lotRapproche] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, execution.lotImportId));
      if (!lotRapproche) throw new ConflictException('Le lot comptable rapproché n’existe plus : relancez le rapprochement.');
      const { lignes: lignesLot } = await chargerLignes(tx, budget, this.cfg, { ecran: 'Suggestions de rapprochement', plafond: 'calcul', lot: lotRapproche });
      const ecritures = elementsBanqueDepuisEcritures(lignesLot).filter((e) => voulues.has(e.id));
      const mouvements = (await tx.select().from(s.mouvementsBancaires).where(inArray(s.mouvementsBancaires.id, idsM.slice(0, MAX))).orderBy(asc(s.mouvementsBancaires.dateOperation), asc(s.mouvementsBancaires.rang))).map((m) => ({
        ...elementDepuisMouvement(m.brut as MouvementBancaire),
        id: m.id,
      }));
      if (ecritures.length === 0 || mouvements.length === 0) throw new ConflictException('Les éléments sans rapprochement ne sont plus disponibles : relancez le rapprochement.');
      return { exercice, execution, ecritures, mouvements, tronque: idsE.length > MAX || idsM.length > MAX };
    });
    const parametres = schemaParametresRapprochement.partial().safeParse(d.execution.parametres ?? {});
    const versEntree = (e: (typeof d.ecritures)[number]) => ({ id: e.id, date: e.date, montant: e.montant, libelle: e.libelle.slice(0, 500), reference: e.reference === null ? null : e.reference.slice(0, 200), tiers: e.tiers === null ? null : e.tiers.slice(0, 200) });
    const resultat = await suggererRapprochements(
      this.ia.active(),
      { mouvements: d.mouvements.map(versEntree), ecritures: d.ecritures.map(versEntree) },
      // Vérification arithmétique par le moteur : côté A = mouvements bancaires, côté B = écritures de banque.
      (sug) => verifierSuggestion(sug, d.mouvements, d.ecritures, parametres.success ? parametres.data : {}, []),
      this.contexte(acces, d.exercice.entiteId),
    );
    const reponse = await this.conclure(acces, 'suggerer_rapprochements', { type: 'exercice', id, entiteId: d.exercice.entiteId }, resultat, (p) =>
      p.retenues.map((r) => ({ type: 'verification_moteur', mouvementIds: r.mouvementIds, ecritureIds: r.ecritureIds, verification: r.verification })),
    );
    return { ...reponse, entree: { mouvements: d.mouvements.length, ecritures: d.ecritures.length, tronque: d.tronque, executionId: d.execution.id } };
  }
}
