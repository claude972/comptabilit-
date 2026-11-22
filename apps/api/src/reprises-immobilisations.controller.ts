/**
 * Reprise du fichier des immobilisations par import CSV (D-092) : APERÇU sans aucune écriture, VALIDATION explicite par une
 * personne de niveau « collaboration » (celui de la saisie manuelle), RAPPORT ligne par ligne conservé et téléchargeable.
 *
 * Principes :
 *  - l'aperçu ne modifie rien en base ni dans le stockage (vérifié par les essais) ; la validation renvoie le fichier, la
 *    correspondance et l'empreinte de l'aperçu confirmé, et le serveur RECALCULE : si le résultat diffère (immobilisations
 *    ajoutées entre-temps), la validation est refusée (409) plutôt que d'écrire autre chose que ce qui a été vu ;
 *  - mêmes contrôles que la saisie manuelle (schéma du moteur) ; ne jamais deviner ; aucun flottant ;
 *  - un import n'écrase, ne modifie et ne supprime JAMAIS une immobilisation existante ;
 *  - une seule transaction par lot validé, verrou par dossier (deux validations simultanées ne créent pas de doublon) ;
 *  - idempotence : (dossier, empreinte du fichier, correspondance) renvoie le rapport existant, et (dossier, empreinte, ligne)
 *    ne crée jamais deux immobilisations ;
 *  - le fichier original est conservé dans le stockage objet (comme les autres imports) avec sa provenance ; le journal
 *    d'audit reçoit une entrée de reprise et une entrée par immobilisation créée (jamais de modification du journal existant).
 */
import { createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, PayloadTooLargeException, Post, Query, Res, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CHAMPS_REPRISE,
  CODES_CHAMPS_REPRISE,
  estZipReprise,
  type CodeChampReprise,
  type CorrespondanceColonnes,
  ErreurReprise,
  LIGNES_MAX_REPRISE,
  TAILLE_MAX_REPRISE,
  VERSION_REPRISE_IMMOBILISATIONS,
  analyserReprise,
  lireFichierReprise,
  neutraliserCellule,
  proposerCorrespondance,
} from '@comtaple/core';
import { type AccesBd, and, asc, desc, eq, inArray, schema as s, sql, type Tx } from '@comtaple/db';
import { assurerFichierOriginal, cles, type Stockage } from '@comtaple/plateforme';
import type { Response } from 'express';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { exigerServiceOuvert } from './abonnement.controller.js';
import { BD, STOCKAGE } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

const PAGE = 200;
const LOT_INSERTION = 500;
/** Une valeur Base64 de 5 Mio fait 6 990 508 caractères ; marge pour les retours à la ligne éventuels. */
const BASE64_MAX = 7_200_000;
const STATUTS = ['creee', 'ignoree_doublon', 'rejetee'] as const;
const LIBELLE_STATUT: Record<(typeof STATUTS)[number], string> = { creee: 'Créée', ignoree_doublon: 'Ignorée (doublon)', rejetee: 'Rejetée' };

const correspondance = z.partialRecord(z.enum(CODES_CHAMPS_REPRISE), z.number().int().min(0).max(1000).nullable());
const fichier = {
  nomFichier: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, 'caractères de contrôle interdits'),
  contenuBase64: z.string().min(4).max(BASE64_MAX),
  encodage: z.enum(['utf-8', 'iso-8859-15', 'windows-1252']).optional(),
  separateur: z.enum([';', ',', '\t']).optional(),
};
const apercu = z.strictObject({ ...fichier, correspondance: correspondance.optional() });
const validation = z.strictObject({
  ...fichier,
  correspondance,
  /** Empreinte de l'aperçu confirmé par la personne (renvoyée par l'aperçu). */
  empreinteApercu: z.string().regex(/^[0-9a-f]{64}$/, 'empreinte SHA-256 hexadécimale attendue'),
  /** Confirmation explicite : sans elle, rien n'est écrit. */
  confirmation: z.literal(true),
});

type Reprise = typeof s.reprisesImmobilisations.$inferSelect;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Décode le Base64 strictement : alphabet, remplissage, taille décodée bornée AVANT de décoder. */
function decoder(base64: string): Buffer {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new BadRequestException('contenuBase64 : Base64 strict attendu (sans retour à la ligne)');
  const taille = (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (taille > TAILLE_MAX_REPRISE) throw new PayloadTooLargeException({ message: `Fichier trop volumineux : ${taille} octets, maximum ${TAILLE_MAX_REPRISE} octets (5 Mio).`, code: 'trop_gros' });
  return Buffer.from(base64, 'base64');
}

function lire(octets: Buffer, d: { encodage?: 'utf-8' | 'iso-8859-15' | 'windows-1252' | undefined; separateur?: ';' | ',' | '\t' | undefined }) {
  try {
    return lireFichierReprise(new Uint8Array(octets.buffer, octets.byteOffset, octets.byteLength), { ...(d.encodage ? { encodage: d.encodage } : {}), ...(d.separateur ? { separateur: d.separateur } : {}) });
  } catch (e) {
    if (e instanceof ErreurReprise) {
      const corps = { message: e.message, code: e.code, ...(e.ligne ? { ligne: e.ligne } : {}) };
      if (e.code === 'trop_gros' || e.code === 'trop_de_lignes') throw new PayloadTooLargeException(corps);
      throw new UnprocessableEntityException(corps);
    }
    throw e;
  }
}

/** Correspondance complète (un indice ou null pour CHAQUE champ), dans l'ordre canonique : empreinte stable. */
const complete = (c: CorrespondanceColonnes): Record<CodeChampReprise, number | null> => Object.fromEntries(CODES_CHAMPS_REPRISE.map((k) => [k, c[k] ?? null])) as Record<CodeChampReprise, number | null>;

function vueReprise(r: Reprise, importeur?: string | null) {
  return {
    id: r.id,
    entiteId: r.entiteId,
    nomFichier: r.nomFichier,
    sha256: r.sha256,
    taille: r.taille,
    encodage: r.encodage,
    separateur: r.separateur,
    correspondance: r.correspondance as Record<CodeChampReprise, number | null>,
    versionAnalyseur: r.versionAnalyseur,
    nbLignes: r.nbLignes,
    nbCreees: r.nbCreees,
    nbIgnorees: r.nbIgnorees,
    nbRejetees: r.nbRejetees,
    importePar: r.importePar,
    importeurNom: importeur ?? null,
    creeLe: r.creeLe,
  };
}

const csvChamp = (v: string): string => {
  const t = neutraliserCellule(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

@ApiTags('Immobilisations : reprise par import')
@ApiBearerAuth()
@Controller('v1')
export class ReprisesImmobilisationsController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
  ) {}

  /** Analyse commune à l'aperçu et à la validation : lit le fichier, calcule le statut de chaque ligne. AUCUNE écriture. */
  private async analyser(tx: Tx, entiteId: string, octets: Buffer, d: { encodage?: 'utf-8' | 'iso-8859-15' | 'windows-1252' | undefined; separateur?: ';' | ',' | '\t' | undefined; correspondance?: CorrespondanceColonnes | undefined }) {
    const empreinteFichier = sha256(octets);
    const f = lire(octets, d);
    const proposition = proposerCorrespondance(f.entetes);
    const utilisee = complete(d.correspondance ?? proposition.correspondance);
    const existantes = await tx
      .select({ libelle: s.immobilisations.libelle, dateMiseEnService: s.immobilisations.dateMiseEnService, baseAmortissable: s.immobilisations.baseAmortissable })
      .from(s.immobilisations)
      .where(eq(s.immobilisations.entiteId, entiteId));
    const deja = await tx
      .select({ ligne: s.lignesRepriseImmobilisations.numeroLigne })
      .from(s.lignesRepriseImmobilisations)
      .where(and(eq(s.lignesRepriseImmobilisations.entiteId, entiteId), eq(s.lignesRepriseImmobilisations.sha256, empreinteFichier), eq(s.lignesRepriseImmobilisations.statut, 'creee')));
    const resultat = analyserReprise(f, utilisee, { existantes, dejaRepris: new Set(deja.map((l) => l.ligne)) });
    const empreinteCorrespondance = sha256(JSON.stringify(utilisee));
    const empreinteApercu = sha256(JSON.stringify({ v: VERSION_REPRISE_IMMOBILISATIONS, fichier: empreinteFichier, encodage: f.encodage, separateur: f.separateur, correspondance: utilisee, lignes: resultat.lignes }));
    return { empreinteFichier, f, proposition, utilisee, resultat, empreinteCorrespondance, empreinteApercu };
  }

  @Post('dossiers/:entiteId/reprises-immobilisations/apercu')
  @HttpCode(200)
  @ApiOperation({
    summary: 'APERÇU d’une reprise du fichier des immobilisations (CSV) : aucune écriture (niveau collaboration)',
    description:
      'Lit le fichier (CSV, séparateur « ; » « , » ou tabulation détecté, UTF-8 ou ISO-8859-15 détecté, virgule ou point décimal, dates JJ/MM/AAAA ou AAAA-MM-JJ ; les classeurs XLSX sont lus directement, première feuille visible non vide, valeurs enregistrées sans évaluer de formule ; les anciens classeurs XLS ne sont pas pris en charge), propose la correspondance des colonnes d’après les en-têtes usuels (sans jamais deviner : une durée sans unité, une colonne ambiguë ne sont pas proposées) et renvoie, pour chaque ligne, son statut (valide, invalide avec motif, doublon). ' +
      'Rien n’est écrit : ni immobilisation, ni fichier, ni journal. Le contenu est du texte inerte : aucune formule n’est évaluée. `empreinteApercu` est à renvoyer à la validation. Limites : 5 Mio, 5 000 lignes de données (refus 413 au-delà). `correspondance` (indice de colonne par champ) est facultative : sans elle, la proposition est utilisée.',
  })
  @ApiBody({ schema: schemaOpenApi(apercu) })
  async apercu(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Body() corps: unknown) {
    exigerUuid(entiteId);
    const d = valider(apercu, corps);
    const octets = decoder(d.contenuBase64);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'collaboration');
      const a = await this.analyser(tx, entiteId, octets, d);
      return {
        fichier: {
          nom: d.nomFichier,
          taille: octets.length,
          sha256: a.empreinteFichier,
          encodage: a.f.encodage,
          encodageImpose: a.f.encodageImpose,
          separateur: a.f.separateur,
          separateurImpose: a.f.separateurImpose,
          nbLignes: a.f.lignes.length,
          lignesVidesIgnorees: a.f.lignesVidesIgnorees,
          avertissements: a.f.avertissements,
        },
        limites: { tailleMaxOctets: TAILLE_MAX_REPRISE, lignesMax: LIGNES_MAX_REPRISE },
        champs: CHAMPS_REPRISE,
        entetes: a.f.entetes,
        correspondance: a.utilisee,
        correspondanceProposee: complete(a.proposition.correspondance),
        remarques: a.proposition.remarques,
        problemes: a.resultat.problemes,
        comptes: a.resultat.comptes,
        lignes: a.resultat.lignes.map((l) => ({ ligne: l.ligne, statut: l.statut, cause: l.cause, motifs: l.motifs, lues: l.lues })),
        empreinteApercu: a.empreinteApercu,
        peutValider: a.resultat.problemes.length === 0 && a.resultat.comptes.valides > 0,
      };
    });
  }

  @Post('dossiers/:entiteId/reprises-immobilisations')
  @ApiOperation({
    summary: 'VALIDER la reprise après aperçu : crée les immobilisations valides en une transaction (niveau collaboration)',
    description:
      'Exige la confirmation explicite (`confirmation: true`) et l’empreinte de l’aperçu confirmé : le serveur relit le fichier, recalcule et refuse (409) si le résultat n’est plus celui de l’aperçu. ' +
      'Les lignes valides créent des immobilisations (mêmes contrôles que la saisie manuelle) ; les lignes invalides sont REJETÉES avec leur motif ; les doublons (même dossier, désignation normalisée, date de mise en service et valeur brute) sont IGNORÉS. Une immobilisation existante n’est jamais modifiée, remplacée ni supprimée. ' +
      'Le fichier original est conservé dans le stockage objet, avec la provenance (auteur, date, empreinte). Rejeu du même fichier avec la même correspondance : le rapport existant est renvoyé (200), rien n’est écrit. Le mode dégressif d’un fichier est enregistré comme déclaration du cabinet ; le calcul reste en abstention tant que l’éditeur ne l’a pas activé.',
  })
  @ApiBody({ schema: schemaOpenApi(validation) })
  async valider(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Body() corps: unknown, @Res({ passthrough: true }) res: Response) {
    exigerUuid(entiteId);
    const d = valider(validation, corps);
    const octets = decoder(d.contenuBase64);
    const r = await this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'collaboration');
      await exigerServiceOuvert(tx);
      // Un seul import à la fois par dossier : deux validations simultanées ne peuvent pas créer de doublon.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reprise-immobilisations:${entiteId}`}, 0))`);
      const a = await this.analyser(tx, entiteId, octets, d);
      const [existante] = await tx
        .select()
        .from(s.reprisesImmobilisations)
        .where(and(eq(s.reprisesImmobilisations.entiteId, entiteId), eq(s.reprisesImmobilisations.sha256, a.empreinteFichier), eq(s.reprisesImmobilisations.empreinteCorrespondance, a.empreinteCorrespondance)));
      if (existante) return { reprise: existante, dejaImporte: true };
      if (a.resultat.problemes.length) throw new ConflictException({ message: 'Correspondance des colonnes incomplète ou incohérente : rien n’est importé', code: 'correspondance_invalide', problemes: a.resultat.problemes });
      if (a.empreinteApercu !== d.empreinteApercu) {
        throw new ConflictException({ message: 'L’aperçu n’est plus à jour (le fichier, la correspondance ou les immobilisations du dossier ont changé) : relancez l’aperçu, relisez-le puis validez de nouveau. Rien n’a été importé.', code: 'apercu_obsolete' });
      }
      if (a.resultat.comptes.valides === 0) throw new ConflictException({ message: 'Aucune ligne valide : rien à importer. Corrigez le fichier ou la correspondance des colonnes.', code: 'rien_a_importer' });

      const typeMime = estZipReprise(octets) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
      // Fichier original : stockage objet adressé par empreinte (comme les autres imports), puis ligne `fichiers`.
      const cle = cles.original(acces.cabinetId, a.empreinteFichier);
      if (!(await this.stockage.existe(cle))) await this.stockage.deposer(cle, octets, typeMime);
      const fich = await assurerFichierOriginal(tx, { cabinetId: acces.cabinetId, sha256: a.empreinteFichier, taille: octets.length, typeMimeDeclare: typeMime, cleStockage: cle });

      const lignes = a.resultat.lignes;
      const [reprise] = await tx
        .insert(s.reprisesImmobilisations)
        .values({
          cabinetId: acces.cabinetId,
          entiteId,
          fichierId: fich.id,
          nomFichier: d.nomFichier,
          sha256: a.empreinteFichier,
          taille: octets.length,
          encodage: a.f.encodage,
          separateur: a.f.separateur,
          correspondance: a.utilisee,
          empreinteCorrespondance: a.empreinteCorrespondance,
          empreinteApercu: a.empreinteApercu,
          versionAnalyseur: VERSION_REPRISE_IMMOBILISATIONS,
          nbLignes: lignes.length,
          nbCreees: a.resultat.comptes.valides,
          nbIgnorees: a.resultat.comptes.doublons,
          nbRejetees: a.resultat.comptes.invalides,
          importePar: acces.utilisateurId,
        })
        .returning();

      // Immobilisations : INSERTION SEULE (aucun UPDATE ni DELETE sur le fichier existant).
      const valides = lignes.filter((l) => l.immobilisation);
      const idParLigne = new Map<number, string>();
      for (let i = 0; i < valides.length; i += LOT_INSERTION) {
        const creees = await tx
          .insert(s.immobilisations)
          .values(
            valides.slice(i, i + LOT_INSERTION).map((l) => {
              const im = l.immobilisation!;
              return { cabinetId: acces.cabinetId, entiteId, ...im, saisiePar: acces.utilisateurId, repriseId: reprise!.id, repriseLigne: l.ligne, composantDe: null };
            }),
          )
          .returning({ id: s.immobilisations.id, ligne: s.immobilisations.repriseLigne });
        for (const c of creees) idParLigne.set(c.ligne!, c.id);
      }
      for (let i = 0; i < lignes.length; i += LOT_INSERTION) {
        await tx.insert(s.lignesRepriseImmobilisations).values(
          lignes.slice(i, i + LOT_INSERTION).map((l) => ({
            cabinetId: acces.cabinetId,
            entiteId,
            repriseId: reprise!.id,
            sha256: a.empreinteFichier,
            numeroLigne: l.ligne,
            statut: l.statut === 'valide' ? 'creee' : l.statut === 'invalide' ? 'rejetee' : 'ignoree_doublon',
            cause: l.cause,
            motif: l.statut === 'valide' ? null : l.motifs.join(' ; '),
            valeursLues: l.lues,
            immobilisationId: l.statut === 'valide' ? (idParLigne.get(l.ligne) ?? null) : null,
          })),
        );
      }
      // Audit : une entrée pour la reprise, une par immobilisation créée (même action que la saisie manuelle, origine « reprise »).
      await tx.insert(s.journalAudit).values({
        cabinetId: acces.cabinetId,
        acteurId: acces.utilisateurId,
        action: 'immobilisation.reprise',
        cibleType: 'reprise_immobilisations',
        cibleId: reprise!.id,
        entiteId,
        details: {
          nomFichier: d.nomFichier,
          sha256: a.empreinteFichier,
          taille: octets.length,
          encodage: a.f.encodage,
          separateur: a.f.separateur,
          correspondance: a.utilisee,
          empreinteApercu: a.empreinteApercu,
          versionAnalyseur: VERSION_REPRISE_IMMOBILISATIONS,
          nbLignes: lignes.length,
          nbCreees: a.resultat.comptes.valides,
          nbIgnorees: a.resultat.comptes.doublons,
          nbRejetees: a.resultat.comptes.invalides,
        },
      });
      for (let i = 0; i < valides.length; i += LOT_INSERTION) {
        await tx.insert(s.journalAudit).values(
          valides.slice(i, i + LOT_INSERTION).map((l) => ({
            cabinetId: acces.cabinetId,
            acteurId: acces.utilisateurId,
            action: 'immobilisation.saisie',
            cibleType: 'immobilisation',
            cibleId: idParLigne.get(l.ligne)!,
            entiteId,
            details: { origine: 'reprise', repriseId: reprise!.id, ligne: l.ligne, compte: l.immobilisation!.compteImmobilisation, acquisition: l.immobilisation!.dateAcquisition, dureeMois: l.immobilisation!.dureeMois, mode: l.immobilisation!.modeAmortissement, coefficient: l.immobilisation!.coefficientDegressif, eligibiliteConfirmee: l.immobilisation!.eligibiliteDegressifConfirmee, valeurResiduelle: l.immobilisation!.valeurResiduelle != null, sortie: l.immobilisation!.dateSortie, composant: null },
          })),
        );
      }
      return { reprise: reprise!, dejaImporte: false };
    });
    res.status(r.dejaImporte ? 200 : 201);
    return { ...vueReprise(r.reprise), dejaImporte: r.dejaImporte };
  }

  @Get('dossiers/:entiteId/reprises-immobilisations')
  @ApiOperation({ summary: 'Reprises d’immobilisations déjà validées pour un dossier (niveau lecture)' })
  async lister(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string) {
    exigerUuid(entiteId);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'lecture');
      const liste = await tx.select().from(s.reprisesImmobilisations).where(eq(s.reprisesImmobilisations.entiteId, entiteId)).orderBy(desc(s.reprisesImmobilisations.creeLe)).limit(100);
      const noms = await this.noms(tx, liste.map((r) => r.importePar));
      return liste.map((r) => vueReprise(r, noms.get(r.importePar)));
    });
  }

  private async noms(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const uniques = [...new Set(ids)];
    if (!uniques.length) return new Map();
    return new Map((await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, uniques))).map((u) => [u.id, u.nom]));
  }

  private async charger(tx: Tx, entiteId: string, repriseId: string): Promise<Reprise> {
    await exigerNiveau(tx, entiteId, 'lecture');
    const [r] = await tx.select().from(s.reprisesImmobilisations).where(and(eq(s.reprisesImmobilisations.id, repriseId), eq(s.reprisesImmobilisations.entiteId, entiteId)));
    if (!r) throw new NotFoundException('Reprise introuvable dans ce dossier');
    return r;
  }

  @Get('dossiers/:entiteId/reprises-immobilisations/:repriseId')
  @ApiQuery({ name: 'statut', required: false, enum: STATUTS })
  @ApiQuery({ name: 'page', required: false, description: 'À partir de 1 ; 200 lignes par page' })
  @ApiOperation({
    summary: 'Rapport d’une reprise, ligne par ligne (niveau lecture)',
    description: 'Pour chaque ligne du fichier : numéro, statut (créée, ignorée comme doublon, rejetée), motif en français et valeurs lues telles qu’elles figuraient dans le fichier (non neutralisées : le client doit neutraliser les préfixes = + - @ à l’affichage ; le CSV téléchargeable le fait).',
  })
  async detail(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Param('repriseId') repriseId: string, @Query('statut') statut?: string, @Query('page') pageBrute?: string) {
    exigerUuid(entiteId);
    exigerUuid(repriseId);
    if (statut !== undefined && !(STATUTS as readonly string[]).includes(statut)) throw new BadRequestException(`statut : ${STATUTS.join(', ')}`);
    const page = pageBrute === undefined ? 1 : Number(pageBrute);
    if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('page : entier à partir de 1');
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await this.charger(tx, entiteId, repriseId);
      const filtre = and(eq(s.lignesRepriseImmobilisations.repriseId, repriseId), statut ? eq(s.lignesRepriseImmobilisations.statut, statut) : undefined);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.lignesRepriseImmobilisations).where(filtre);
      const lignes = await tx
        .select({
          ligne: s.lignesRepriseImmobilisations.numeroLigne,
          statut: s.lignesRepriseImmobilisations.statut,
          cause: s.lignesRepriseImmobilisations.cause,
          motif: s.lignesRepriseImmobilisations.motif,
          lues: s.lignesRepriseImmobilisations.valeursLues,
          immobilisationId: s.lignesRepriseImmobilisations.immobilisationId,
        })
        .from(s.lignesRepriseImmobilisations)
        .where(filtre)
        .orderBy(asc(s.lignesRepriseImmobilisations.numeroLigne))
        .limit(PAGE)
        .offset((page - 1) * PAGE);
      const noms = await this.noms(tx, [r.importePar]);
      return { reprise: vueReprise(r, noms.get(r.importePar)), champs: CHAMPS_REPRISE, lignes, total: n, page, parPage: PAGE };
    });
  }

  @Get('dossiers/:entiteId/reprises-immobilisations/:repriseId/rapport.csv')
  @ApiOperation({
    summary: 'Télécharger le rapport d’une reprise (CSV UTF-8, séparateur « ; », niveau lecture)',
    description: 'Une ligne par ligne du fichier : numéro, statut, motif et valeurs lues. Les valeurs commençant par = + - @ sont neutralisées par une apostrophe : le fichier ne peut déclencher aucune formule dans un tableur. Le téléchargement est tracé au journal.',
  })
  async rapportCsv(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string, @Param('repriseId') repriseId: string, @Res() res: Response) {
    exigerUuid(entiteId);
    exigerUuid(repriseId);
    const csv = await this.bd.avecContexte(acces, async (tx) => {
      const r = await this.charger(tx, entiteId, repriseId);
      const colonnes = CHAMPS_REPRISE.filter((c) => (r.correspondance as Record<string, number | null>)[c.code] != null);
      const lignes = await tx.select().from(s.lignesRepriseImmobilisations).where(eq(s.lignesRepriseImmobilisations.repriseId, repriseId)).orderBy(asc(s.lignesRepriseImmobilisations.numeroLigne));
      const sortie = [['Ligne du fichier', 'Statut', 'Motif', ...colonnes.map((c) => `${c.libelle} (valeur lue)`), 'Immobilisation créée'].map(csvChamp).join(';')];
      for (const l of lignes) {
        const lues = l.valeursLues as Record<string, string>;
        sortie.push([String(l.numeroLigne), LIBELLE_STATUT[l.statut as (typeof STATUTS)[number]] ?? l.statut, l.motif ?? '', ...colonnes.map((c) => lues[c.code] ?? ''), l.immobilisationId ?? ''].map(csvChamp).join(';'));
      }
      await tx.insert(s.journalAudit).values({ cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'immobilisation.reprise_rapport_telecharge', cibleType: 'reprise_immobilisations', cibleId: repriseId, entiteId, details: { lignes: lignes.length } });
      return `﻿${sortie.join('\r\n')}\r\n`;
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rapport-reprise-immobilisations-${repriseId.slice(0, 8)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(csv);
  }
}
