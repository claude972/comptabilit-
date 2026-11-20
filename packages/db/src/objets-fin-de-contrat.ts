/**
 * Suppression des objets d'un cabinet sur un STOCKAGE D'ESSAI versionné (D-099), étape séparée de la base.
 *
 * Cette fonction n'agit JAMAIS sur le stockage des données existantes : elle exige un stockage qui se déclare d'essai
 * (`verifierEssai`, contrôlé AVANT toute lecture ou suppression) et refuse tout autre. L'implémentation S3 est dans
 * `@comtaple/plateforme` (`StockageEssaiS3`) ; elle refuse un bucket qui n'est pas explicitement déclaré « essai » par
 * une variable dédiée, ou qui est celui des données réelles.
 *
 * Garanties :
 *  - seules les VERSIONS (et marqueurs de suppression) sous les préfixes du cabinet sont visées ; toute clé hors préfixe
 *    renvoyée par le stockage fait tout refuser ;
 *  - un objet verrouillé (Object Lock : rétention ou mise en suspens légale) n'est PAS supprimé : son refus est consigné
 *    (échec propre), jamais contourné — aucun contournement de la gouvernance n'est demandé au stockage ;
 *  - REPRISE : l'état est dans le stockage lui-même (ce qui est supprimé disparaît de la liste) et le rapport par objet est
 *    ajouté à un fichier (JSON par ligne) ; relancer reprend et complète le même rapport ;
 *  - IDEMPOTENCE : rejouée après réussite, la fonction ne trouve plus rien et ne supprime rien.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type pg from 'pg';
import { exigerReferenceValidation } from './durees-conservation.js';
import { exigerAdministration, prefixesObjetsCabinet } from './provisionnement.js';
import { COLONNES_CLES_OBJETS } from './provisionnement.js';

export interface VersionObjet {
  cle: string;
  /** null si le stockage n'est pas versionné pour cet objet. */
  versionId: string | null;
  /** Vrai pour un marqueur de suppression. */
  marqueurSuppression: boolean;
  taille: number;
}
export type ResultatSuppressionObjet = 'supprimee' | 'deja_absente' | 'verrouillee' | 'erreur';

export interface StockageEssaiVersionne {
  /** Nom du bucket (ou préfixe racine) visé : consigné dans le journal et le rapport. */
  readonly bucket: string;
  /** Lève si ce stockage n'est pas explicitement un stockage d'essai, distinct du stockage réel. Appelé avant toute opération. */
  verifierEssai(): Promise<void>;
  listerVersions(prefixe: string): Promise<VersionObjet[]>;
  /** Supprime UNE version. Ne contourne jamais un verrouillage : il est rapporté `verrouillee` avec ce que le stockage en dit. */
  supprimerVersion(cle: string, versionId: string | null): Promise<{ resultat: ResultatSuppressionObjet; detail?: string }>;
}

export interface LigneRapportObjet {
  cle: string;
  versionId: string | null;
  marqueurSuppression: boolean;
  taille: number;
  resultat: ResultatSuppressionObjet;
  detail: string | null;
  le: string;
  /** Numéro de passage (1 pour la première exécution, 2 pour une reprise, etc.). */
  passage: number;
}

export interface RapportObjetsFinDeContrat {
  bucket: string;
  prefixes: string[];
  passage: number;
  /** Versions trouvées à ce passage, avant suppression. */
  trouvees: number;
  supprimees: number;
  dejaAbsentes: number;
  verrouillees: number;
  erreurs: number;
  /** Versions encore présentes sous les préfixes à la fin du passage. */
  restantes: number;
  complet: boolean;
  empreinteListe: string;
  /** Rapport CUMULÉ sur tous les passages (lu dans le fichier de rapport), un enregistrement par version traitée. */
  lignes: LigneRapportObjet[];
}

export class SuppressionObjetsIncomplete extends Error {
  constructor(public readonly rapport: RapportObjetsFinDeContrat) {
    super(`Suppression des objets incomplète : ${rapport.verrouillees} version(s) verrouillée(s) (Object Lock, non contournées), ${rapport.erreurs} erreur(s), ${rapport.restantes} version(s) restante(s). Consigné au journal ; le reste a été supprimé.`);
    this.name = 'SuppressionObjetsIncomplete';
  }
}

export interface ParametresSuppressionObjets {
  cabinetId: string;
  confirmation?: { cabinetId: string; nom: string };
  /** Référence de validation des durées (voir durees-conservation.ts) : exigée, comme pour la base. */
  dureesValidees?: string;
  /** Fichier de rapport (une ligne JSON par version traitée), ajouté à chaque passage. */
  fichierRapport?: string;
  /** Appelé après chaque version traitée et consignée ; une exception ici interrompt le passage (essai de reprise). */
  surObjet?: (ligne: LigneRapportObjet) => void | Promise<void>;
}

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const ident = (n: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`Identifiant SQL inattendu : ${n}`);
  return `"${n}"`;
};

/** Lit un rapport (JSON par ligne) ; un fichier absent est un rapport vide. */
export function lireRapportObjets(chemin: string): LigneRapportObjet[] {
  if (!existsSync(chemin)) return [];
  return readFileSync(chemin, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LigneRapportObjet);
}

/**
 * Supprime, sur un stockage d'ESSAI versionné, les versions d'objets d'un cabinet dont la fin de contrat est exécutée
 * en base. Exige : stockage déclaré d'essai, rôle d'administration, procès-verbal au registre, confirmation (identifiant
 * et nom), référence de validation des durées, aucune référence d'un autre cabinet vers ces préfixes.
 */
export async function supprimerObjetsFinDeContratEssai(client: pg.ClientBase, stockage: StockageEssaiVersionne, p: ParametresSuppressionObjets): Promise<RapportObjetsFinDeContrat> {
  await stockage.verifierEssai();
  const reference = exigerReferenceValidation(p.dureesValidees);
  const prefixes = prefixesObjetsCabinet(p.cabinetId);
  await exigerAdministration(client);
  const cabinet = (await client.query<{ nom: string }>('select nom from cabinets where id = $1', [p.cabinetId])).rows[0];
  if (!cabinet) throw new Error(`Cabinet introuvable : ${p.cabinetId}`);
  if (!p.confirmation || p.confirmation.cabinetId !== p.cabinetId || p.confirmation.nom !== cabinet.nom) throw new Error('Suppression des objets refusée : confirmation absente ou ne nommant pas exactement le cabinet (identifiant et nom).');
  if (!(await client.query('select 1 from fins_de_contrat where cabinet_id = $1', [p.cabinetId])).rowCount) throw new Error('Suppression des objets refusée : la fin de contrat n’a pas été exécutée en base pour ce cabinet (aucun procès-verbal au registre).');
  for (const k of COLONNES_CLES_OBJETS) {
    const r = await client.query<{ n: string }>(`select count(*) as n from ${ident(k.table)} where cabinet_id <> $1 and (${prefixes.map((_, i) => `starts_with(${ident(k.colonne)}, $${i + 2})`).join(' or ')})`, [p.cabinetId, ...prefixes]);
    if (Number(r.rows[0]!.n)) throw new Error(`Suppression des objets refusée : ${r.rows[0]!.n} ligne(s) de ${k.table} d’un autre cabinet référencent un objet de ce cabinet.`);
  }

  const versions = (await Promise.all(prefixes.map((x) => stockage.listerVersions(x)))).flat().sort((a, b) => (a.cle === b.cle ? (a.versionId ?? '').localeCompare(b.versionId ?? '') : a.cle.localeCompare(b.cle)));
  const etrangeres = versions.filter((v) => !prefixes.some((x) => v.cle.startsWith(x)));
  if (etrangeres.length) throw new Error(`Le stockage a renvoyé ${etrangeres.length} clé(s) hors des préfixes du cabinet : rien n’est supprimé.`);
  const empreinteListe = sha256(versions.map((v) => `${v.cle}\t${v.versionId ?? ''}\t${v.marqueurSuppression ? 'M' : 'V'}`).join('\n'));

  if (p.fichierRapport) mkdirSync(dirname(p.fichierRapport), { recursive: true });
  const anterieures = p.fichierRapport ? lireRapportObjets(p.fichierRapport) : [];
  const passage = (anterieures.reduce((m, l) => Math.max(m, l.passage), 0)) + 1;
  const comptes = { supprimees: 0, dejaAbsentes: 0, verrouillees: 0, erreurs: 0 };
  const nouvelles: LigneRapportObjet[] = [];
  for (const v of versions) {
    const r = await stockage.supprimerVersion(v.cle, v.versionId);
    const ligne: LigneRapportObjet = { cle: v.cle, versionId: v.versionId, marqueurSuppression: v.marqueurSuppression, taille: v.taille, resultat: r.resultat, detail: r.detail ?? null, le: new Date().toISOString(), passage };
    nouvelles.push(ligne);
    if (p.fichierRapport) appendFileSync(p.fichierRapport, `${JSON.stringify(ligne)}\n`, { mode: 0o600 });
    if (r.resultat === 'supprimee') comptes.supprimees++;
    else if (r.resultat === 'deja_absente') comptes.dejaAbsentes++;
    else if (r.resultat === 'verrouillee') comptes.verrouillees++;
    else comptes.erreurs++;
    await p.surObjet?.(ligne);
  }
  const restantes = (await Promise.all(prefixes.map((x) => stockage.listerVersions(x)))).flat().length;
  const rapport: RapportObjetsFinDeContrat = {
    bucket: stockage.bucket,
    prefixes,
    passage,
    trouvees: versions.length,
    ...comptes,
    restantes,
    complet: restantes === 0,
    empreinteListe,
    lignes: [...anterieures, ...nouvelles],
  };
  await client.query(
    `insert into journal_audit (cabinet_id, acteur_type, action, cible_type, cible_id, details) values ($1, 'systeme', 'fin_de_contrat.objets_supprimes', 'cabinet', $2, $3)`,
    [p.cabinetId, p.cabinetId, JSON.stringify({ stockage: 'essai', bucket: stockage.bucket, prefixes, passage, trouvees: versions.length, ...comptes, restantes, empreinteListe, dureesValidees: reference })],
  );
  if (!rapport.complet) throw new SuppressionObjetsIncomplete(rapport);
  return rapport;
}
