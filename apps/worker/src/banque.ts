import {
  decoderTexteReleve,
  detecterFormatReleve,
  elementDepuisMouvement,
  elementsBanqueDepuisEcritures,
  type LigneEcriture,
  lireCamt053,
  lireCsvBanque,
  lireOfx,
  lireReleveAgregation,
  type MouvementBancaire,
  proposerProfilCsv,
  rapprocher,
  type RapportReleve,
  schemaParametresRapprochement,
  schemaProfilCsvBanque,
  TAILLE_MAX_RELEVE,
} from '@comtaple/core';
import { and, asc, eq, gte, inArray, journaliser, lte, schema as s, sql, type Tx } from '@comtaple/db';
import { lignesDuLot, type TacheImportReleve, type TacheRapprochement } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

/**
 * Import d'un relevé bancaire (camt.053, OFX, CSV). Fonctionne sans aucun prestataire d'agrégation.
 * Idempotent : un mouvement déjà connu du dossier (même clé stable) n'est jamais dupliqué, y compris lorsque deux
 * relevés se chevauchent. Les libellés bancaires sont des données non fiables : stockés, jamais interprétés.
 */
export async function importerReleve(c: Contexte, t: TacheImportReleve): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const init = await c.bd.avecContexte(ctx, async (tx) => {
    const [lot] = await tx.select().from(s.lotsImport).where(eq(s.lotsImport.id, t.lotImportId));
    if (!lot?.fichierId || lot.type !== 'releve_bancaire') return null;
    if (lot.statut === 'annule') return null;
    const [fichier] = await tx.select().from(s.fichiers).where(eq(s.fichiers.id, lot.fichierId));
    if (!fichier) return null;
    // Prise en charge atomique (voir l'import comptable) : une tâche en double ne retraite pas un lot déjà pris ou terminé.
    const [pris] = await tx.update(s.lotsImport).set({ statut: 'en_cours', progression: 0 }).where(and(eq(s.lotsImport.id, lot.id), inArray(s.lotsImport.statut, ['en_attente', 'echec']))).returning({ id: s.lotsImport.id });
    if (!pris) return null;
    return { lot, fichier };
  });
  if (!init) return;
  const { lot, fichier } = init;
  const demande = (lot.rapport ?? {}) as { nomFichier?: string; profilCsv?: unknown };

  const echec = (motif: string, extra: Record<string, unknown> = {}) =>
    c.bd.avecContexte(ctx, async (tx) => {
      await tx
        .update(s.lotsImport)
        .set({ statut: 'echec', actif: false, rapport: { ...demande, lisible: false, motif, ...extra }, termineLe: sql`now()` })
        .where(eq(s.lotsImport.id, lot.id));
      await journaliser(tx, { cabinetId: t.cabinetId, acteurType: 'systeme', action: 'import.releve.echec', cibleType: 'lot_import', cibleId: lot.id, entiteId: lot.entiteId, details: { motif } });
    });

  if (fichier.taille > TAILLE_MAX_RELEVE) return void (await echec('Fichier trop volumineux pour un relevé bancaire'));
  const octets = await c.stockage.lire(fichier.cleStockage, TAILLE_MAX_RELEVE);
  const { texte, encodage } = decoderTexteReleve(new Uint8Array(octets));
  const format = detecterFormatReleve(texte.slice(0, 8192));

  let rapport: RapportReleve;
  let profilUtilise: unknown = null;
  if (format === 'camt.053') rapport = lireCamt053(texte);
  else if (format === 'ofx') rapport = lireOfx(texte);
  else if (format === 'agregation') rapport = lireReleveAgregation(texte);
  else if (format === 'csv') {
    // Un profil de colonnes confirmé par un humain l'emporte ; sinon proposition prudente, abstention si ambiguë.
    let profil = demande.profilCsv ? schemaProfilCsvBanque.safeParse(demande.profilCsv) : null;
    if (profil && !profil.success) return void (await echec('Profil de colonnes CSV invalide', { format }));
    if (!profil) {
      const proposition = proposerProfilCsv(texte);
      if (!proposition.profil) {
        return void (await echec('Colonnes du fichier CSV non reconnues avec certitude : un profil de colonnes doit être confirmé', { format, profilAConfirmer: true, raisons: proposition.raisons }));
      }
      profil = { success: true, data: proposition.profil } as never;
      profilUtilise = { ...proposition.profil, origine: 'propose_automatiquement', raisons: proposition.raisons };
    } else profilUtilise = { ...profil.data, origine: 'confirme' };
    rapport = lireCsvBanque(texte, (profil as { data: Parameters<typeof lireCsvBanque>[1] }).data);
  } else return void (await echec('Format de relevé non reconnu (camt.053, OFX, CSV ou document d’agrégation attendus)', { format }));

  if (!rapport.lisible) {
    return void (await echec('Relevé illisible', { format: rapport.format, version: rapport.version, anomalies: rapport.anomalies.slice(0, 200) }));
  }

  await c.bd.avecContexte(ctx, async (tx) => {
    await tx.delete(s.relevesBancaires).where(eq(s.relevesBancaires.lotImportId, lot.id));
    const relevesParCompte = new Map<string, string>();
    for (const compte of rapport.comptes) {
      const [r] = await tx
        .insert(s.relevesBancaires)
        .values({
          cabinetId: t.cabinetId,
          entiteId: lot.entiteId,
          lotImportId: lot.id,
          format: rapport.format,
          iban: compte.iban,
          identifiant: compte.identifiant,
          devise: compte.devise,
          soldeOuverture: compte.soldeOuverture,
          dateOuverture: compte.dateOuverture,
          soldeCloture: compte.soldeCloture,
          dateCloture: compte.dateCloture,
          totalMouvements: compte.totalMouvements,
          nbMouvements: compte.nbMouvements,
          cadrage: compte.cadrage,
          ecart: compte.ecart,
          brut: compte,
        })
        .returning({ id: s.relevesBancaires.id });
      const cle = `${compte.iban ?? ''}|${compte.identifiant ?? ''}`;
      if (!relevesParCompte.has(cle)) relevesParCompte.set(cle, r!.id);
    }
    let nouveaux = 0;
    for (let i = 0; i < rapport.mouvements.length; i += 500) {
      const lotMouvements = rapport.mouvements.slice(i, i + 500);
      const inseres = await tx
        .insert(s.mouvementsBancaires)
        .values(
          lotMouvements.map((m) => ({
            cabinetId: t.cabinetId,
            entiteId: lot.entiteId,
            lotImportId: lot.id,
            releveId: relevesParCompte.get(`${m.compte.iban ?? ''}|${m.compte.identifiant ?? ''}`) ?? null,
            rang: m.rang,
            cleIdempotence: m.cleIdempotence,
            iban: m.compte.iban,
            identifiantCompte: m.compte.identifiant,
            devise: m.compte.devise,
            dateOperation: m.dateOperation,
            dateValeur: m.dateValeur,
            montant: m.montant,
            libelle: m.libelle,
            referenceBanque: m.referenceBanque,
            referenceBoutEnBout: m.referenceBoutEnBout,
            contrepartieNom: m.contrepartie?.nom ?? null,
            brut: m,
          })),
        )
        .onConflictDoNothing({ target: [s.mouvementsBancaires.entiteId, s.mouvementsBancaires.cleIdempotence] })
        .returning({ id: s.mouvementsBancaires.id });
      nouveaux += inseres.length;
    }
    // Chaque mouvement du fichier est rattaché à CE lot, qu'il soit nouveau ou déjà connu : annuler un autre relevé
    // qui le contenait aussi ne le fera pas disparaître.
    for (let i = 0; i < rapport.mouvements.length; i += 500) {
      const cles = rapport.mouvements.slice(i, i + 500).map((m) => m.cleIdempotence);
      const connus = await tx.select({ id: s.mouvementsBancaires.id }).from(s.mouvementsBancaires).where(and(eq(s.mouvementsBancaires.entiteId, lot.entiteId), inArray(s.mouvementsBancaires.cleIdempotence, cles)));
      if (connus.length) {
        await tx.insert(s.mouvementsLots).values(connus.map((m) => ({ cabinetId: t.cabinetId, entiteId: lot.entiteId, mouvementId: m.id, lotImportId: lot.id }))).onConflictDoNothing();
      }
    }
    // Les rapprochements calculés avant cet import ne reflètent plus les mouvements connus.
    if (nouveaux > 0) await tx.update(s.executionsRapprochement).set({ obsolete: true }).where(eq(s.executionsRapprochement.entiteId, lot.entiteId));
    const { mouvements: _m, ...resume } = rapport;
    await tx
      .update(s.lotsImport)
      .set({
        statut: rapport.anomalies.length > 0 ? 'termine_avec_erreurs' : 'termine',
        actif: true,
        progression: rapport.mouvements.length,
        rapport: { ...demande, ...resume, encodage, profilCsv: profilUtilise ?? demande.profilCsv ?? null, anomalies: rapport.anomalies.slice(0, 500), nbMouvements: rapport.mouvements.length, nbNouveaux: nouveaux, nbDejaConnus: rapport.mouvements.length - nouveaux },
        termineLe: sql`now()`,
      })
      .where(eq(s.lotsImport.id, lot.id));
    await journaliser(tx, {
      cabinetId: t.cabinetId,
      acteurType: 'systeme',
      action: 'import.releve.termine',
      cibleType: 'lot_import',
      cibleId: lot.id,
      entiteId: lot.entiteId,
      details: { format: rapport.format, mouvements: rapport.mouvements.length, nouveaux, cadrages: rapport.comptes.map((k) => k.cadrage) },
    });
  });
}

export { lignesDuLot } from '@comtaple/plateforme';

/** Reconstitue, pour les contrôles, les relevés du dossier tels que lus par le moteur (relevés + leurs mouvements). */
export { relevesDuDossier } from '@comtaple/plateforme';

/**
 * Rapprochement banque ↔ comptabilité d'un exercice par le moteur déterministe (niveaux exact et règles explicites).
 * Le résultat est une PROPOSITION : chaque rapprochement reste à valider ou rejeter par une personne habilitée.
 */
export async function executerRapprochement(c: Contexte, t: TacheRapprochement): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  await c.bd.avecContexte(ctx, async (tx) => {
    const [execution] = await tx.select().from(s.executionsRapprochement).where(eq(s.executionsRapprochement.id, t.executionId)).for('update');
    if (!execution || execution.statut === 'termine') return;
    const [exercice] = await tx.select().from(s.exercices).where(eq(s.exercices.id, execution.exerciceId));
    if (!exercice) return;
    await tx.delete(s.rapprochements).where(eq(s.rapprochements.executionId, execution.id));
    const parametres = schemaParametresRapprochement.partial().parse(execution.parametres ?? {});

    // Même garde de volume que les contrôles : au-delà de la limite, le rapprochement échoue proprement, avec son motif.
    const nbLignes = Number((await tx.execute(sql`select count(*)::int as n from lignes_ecriture where lot_import_id = ${execution.lotImportId}::uuid`)).rows[0]?.n ?? 0);
    if (nbLignes > c.cfg.LIGNES_MAX_PAR_TRAITEMENT) {
      await tx.update(s.executionsRapprochement).set({ statut: 'echec', erreur: `Volume non pris en charge : ${nbLignes.toLocaleString('fr-FR')} lignes d’écriture pour une limite de ${c.cfg.LIGNES_MAX_PAR_TRAITEMENT.toLocaleString('fr-FR')} par traitement. Aucun rapprochement n’a été calculé.`, termineLe: sql`now()` }).where(eq(s.executionsRapprochement.id, execution.id));
      return;
    }
    const lignes = await lignesDuLot(tx, execution.lotImportId);
    const cotesEcritures = elementsBanqueDepuisEcritures(lignes);
    const mouvements = await tx
      .select()
      .from(s.mouvementsBancaires)
      .where(and(eq(s.mouvementsBancaires.entiteId, execution.entiteId), gte(s.mouvementsBancaires.dateOperation, exercice.debut), lte(s.mouvementsBancaires.dateOperation, exercice.fin), sql`mouvement_pris_en_compte(${s.mouvementsBancaires.id})`))
      .orderBy(asc(s.mouvementsBancaires.dateOperation), asc(s.mouvementsBancaires.rang));
    // Le moteur identifie un mouvement par sa clé stable ; on la retraduit en identifiant de ligne à l'enregistrement.
    const idParCle = new Map(mouvements.map((m) => [m.cleIdempotence, m.id]));
    const cotesMouvements = mouvements.map((m) => elementDepuisMouvement(m.brut as MouvementBancaire));
    const versIds = (cles: readonly string[]) => cles.map((k) => idParCle.get(k) ?? k);

    const resultat = rapprocher(cotesEcritures, cotesMouvements, parametres);
    for (let i = 0; i < resultat.rapprochements.length; i += 500) {
      await tx.insert(s.rapprochements).values(
        resultat.rapprochements.slice(i, i + 500).map((r) => ({
          cabinetId: t.cabinetId,
          entiteId: execution.entiteId,
          exerciceId: exercice.id,
          executionId: execution.id,
          niveau: r.niveau,
          regle: r.regle,
          cotesEcritures: r.cotesA,
          cotesMouvements: versIds(r.cotesB),
          criteres: r.criteres,
          explication: r.explication,
          ecart: r.ecart,
        })),
      );
    }
    const idsEcritures = new Set(cotesEcritures.map((e) => e.id));
    const traduire = (ids: readonly string[]) => ids.map((x) => (idsEcritures.has(x) ? x : (idParCle.get(x) ?? x)));
    await tx
      .update(s.executionsRapprochement)
      .set({
        statut: 'termine',
        termineLe: sql`now()`,
        mesures: { ...resultat.mesures, ecrituresBanque: String(cotesEcritures.length), mouvementsBancaires: String(cotesMouvements.length) },
        nonRapprochesEcritures: resultat.nonRapprochesA,
        nonRapprochesMouvements: versIds(resultat.nonRapprochesB),
        ambiguites: resultat.ambiguites.map((a) => ({ ...a, ids: traduire(a.ids), candidats: a.candidats.map(traduire) })),
        abandons: resultat.abandons.map((a) => ({ ...a, ids: traduire(a.ids) })),
      })
      .where(eq(s.executionsRapprochement.id, execution.id));
    await journaliser(tx, {
      cabinetId: t.cabinetId,
      acteurType: 'systeme',
      action: 'rapprochement.termine',
      cibleType: 'execution_rapprochement',
      cibleId: execution.id,
      entiteId: execution.entiteId,
      details: { rapprochements: resultat.rapprochements.length, nonRapprochesEcritures: resultat.nonRapprochesA.length, nonRapprochesMouvements: resultat.nonRapprochesB.length, ambiguites: resultat.ambiguites.length, abandons: resultat.abandons.length },
    });
  });
}
