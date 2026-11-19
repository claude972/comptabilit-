/**
 * Exécution contrôlée des fonctions métier. C'est ICI que se trouvent les garde-fous qui ne dépendent pas de la
 * bonne volonté du modèle : liste blanche, validation des arguments, périmètre imposé, habilitation, filtrage
 * des éléments renvoyés, trace d'audit de chaque appel et de chaque refus.
 */
import { randomUUID } from 'node:crypto';
import type { JournalAuditIa } from '../audit.js';
import type { DefinitionOutil } from '../fournisseur.js';
import { versSchemaJson } from '../passerelle.js';
import type { Horloge } from '../ports.js';
import {
  schemaElementSource,
  schemaPeriode,
  type CodeRefus,
  type ElementSource,
  type FonctionMetier,
  type Habilitations,
  type PerimetreImpose,
  type Periode,
  type RefusFonction,
} from './types.js';

/** Clés qu'un modèle ne peut jamais fournir : le contexte est imposé par l'appelant. */
const CLES_CONTEXTE = new Set(['cabinetid', 'cabinet_id', 'cabinet', 'tenantid', 'tenant_id', 'tenant', 'utilisateurid', 'utilisateur_id', 'userid', 'user_id']);
const CLES_RESERVEES = ['dossierId', 'periode', 'cabinetId', 'utilisateurId'];

export interface Session {
  tache: string;
  mode: 'ia' | 'sans_ia';
  perimetre: PerimetreImpose;
  fonctions: Map<string, FonctionMetier>;
  habilitations: Habilitations;
  journal: JournalAuditIa;
  horloge: Horloge;
  /** Registre des sources citables : uniquement ce que les fonctions ont renvoyé pendant cette réponse. */
  registre: Map<string, ElementSource>;
  refus: RefusFonction[];
  donneesManquantes: string[];
  etape: number;
}

export type IssueFonction =
  | { issue: 'executee'; elements: ElementSource[]; donneesManquantes: string[] }
  | { issue: 'refusee'; code: CodeRefus }
  | { issue: 'erreur'; code: CodeRefus };

export function assainirNom(nom: unknown): string {
  return String(nom).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

function proprietesDeclarees(f: FonctionMetier): string[] {
  return Object.keys((versSchemaJson(f.schemaArguments).properties as Record<string, unknown> | undefined) ?? {});
}

/** Vérifie les déclarations (erreur de programmation sinon) et renvoie la liste blanche indexée par nom. */
export function indexerFonctions(fonctions: readonly FonctionMetier[]): Map<string, FonctionMetier> {
  const index = new Map<string, FonctionMetier>();
  for (const f of fonctions) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.nom)) throw new Error(`Fonction métier « ${f.nom} » : nom invalide.`);
    if (index.has(f.nom)) throw new Error(`Fonction métier « ${f.nom} » déclarée deux fois.`);
    const schema = versSchemaJson(f.schemaArguments);
    if (schema.type !== 'object') throw new Error(`Fonction métier « ${f.nom} » : schemaArguments doit décrire un objet (z.strictObject).`);
    const proprietes = proprietesDeclarees(f);
    if (proprietes.some((p) => CLES_RESERVEES.includes(p) || CLES_CONTEXTE.has(p.toLowerCase()))) throw new Error(`Fonction métier « ${f.nom} » : clé réservée dans schemaArguments.`);
    index.set(f.nom, f);
  }
  return index;
}

/** Déclaration d'une fonction pour le modèle : ses arguments, plus `dossierId` (limité au périmètre) et `periode`. */
export function declarerOutil(f: FonctionMetier, perimetre: PerimetreImpose): DefinitionOutil {
  const schema = versSchemaJson(f.schemaArguments);
  const proprietes: Record<string, unknown> = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  const requis = [...((schema.required as string[] | undefined) ?? [])];
  if (f.porteeDossier) {
    proprietes.dossierId = { type: 'string', enum: perimetre.dossierIds, description: 'Dossier à interroger, parmi ceux autorisés.' };
    if (perimetre.dossierIds.length > 1) requis.push('dossierId');
  }
  proprietes.periode = {
    type: 'object',
    description: `Sous-période facultative, comprise entre ${perimetre.periode.debut} et ${perimetre.periode.fin} (AAAA-MM-JJ).`,
    properties: { debut: { type: 'string' }, fin: { type: 'string' } },
    required: ['debut', 'fin'],
    additionalProperties: false,
  };
  return { nom: f.nom, description: f.description, parametres: { type: 'object', properties: proprietes, required: requis, additionalProperties: false } };
}

function tracer(session: Session, fonction: string, issue: 'executee' | 'refusee' | 'erreur', code: CodeRefus | null, dossierId: string | null, tailles: { arguments: number; elements: number; elementsEcartes: number }): void {
  session.journal.consigner({
    type: 'fonction_metier',
    id: randomUUID(),
    horodatage: session.horloge.maintenant().toISOString(),
    tache: session.tache,
    fonction,
    mode: session.mode,
    issue,
    code,
    contexte: { cabinetId: session.perimetre.cabinetId, dossierId, utilisateurId: session.perimetre.utilisateurId },
    tailles,
  });
}

/**
 * Exécute (ou refuse) un appel demandé. `argumentsBruts` vient du modèle (ou du mode sans IA) : NON FIABLE.
 * Tout refus est enregistré dans la session et tracé.
 */
export async function executerFonctionMetier(session: Session, nomDemande: unknown, argumentsBruts: unknown): Promise<IssueFonction> {
  const nom = assainirNom(nomDemande);
  const tailleArguments = JSON.stringify(argumentsBruts ?? null).length;
  let dossierTrace: string | null = null;
  const refuser = (code: CodeRefus, issue: 'refusee' | 'erreur' = 'refusee'): IssueFonction => {
    session.refus.push({ fonction: nom, code, etape: session.etape });
    tracer(session, nom, issue, code, dossierTrace, { arguments: tailleArguments, elements: 0, elementsEcartes: 0 });
    return { issue, code };
  };

  const fonction = typeof nomDemande === 'string' ? session.fonctions.get(nomDemande) : undefined;
  if (!fonction) return refuser('fonction_non_autorisee');
  if (argumentsBruts === null || typeof argumentsBruts !== 'object' || Array.isArray(argumentsBruts)) return refuser('arguments_invalides');
  const { dossierId: dossierDemande, periode: periodeDemandee, ...reste } = argumentsBruts as Record<string, unknown>;
  // Le cabinet et l'utilisateur ne sont jamais des arguments : toute tentative est refusée, pas ignorée.
  if (Object.keys(reste).some((k) => CLES_CONTEXTE.has(k.toLowerCase()))) return refuser('changement_de_contexte_refuse');

  let dossierId: string | null = null;
  if (dossierDemande !== undefined && (typeof dossierDemande !== 'string' || !session.perimetre.dossierIds.includes(dossierDemande))) return refuser('dossier_hors_perimetre');
  if (fonction.porteeDossier) {
    const seul = session.perimetre.dossierIds.length === 1 ? session.perimetre.dossierIds[0] : undefined;
    const choisi = (dossierDemande as string | undefined) ?? seul;
    if (choisi === undefined) return refuser('dossier_a_preciser');
    dossierId = choisi;
    dossierTrace = choisi;
  }

  let periode: Periode = session.perimetre.periode;
  if (periodeDemandee !== undefined) {
    const lue = schemaPeriode.safeParse(periodeDemandee);
    if (!lue.success || lue.data.debut < session.perimetre.periode.debut || lue.data.fin > session.perimetre.periode.fin) return refuser('periode_hors_perimetre');
    periode = lue.data;
  }

  // Strict quel que soit le schéma déclaré : aucune clé hors de celles déclarées (pas de « sql », pas de « code »).
  const declarees = new Set(proprietesDeclarees(fonction));
  if (Object.keys(reste).some((k) => !declarees.has(k))) return refuser('arguments_invalides');
  const args = fonction.schemaArguments.safeParse(reste);
  if (!args.success) return refuser('arguments_invalides');

  const { cabinetId, utilisateurId } = session.perimetre;
  try {
    if (!(await session.habilitations.autoriser({ fonction: fonction.nom, habilitation: fonction.habilitation, cabinetId, utilisateurId, dossierId }))) return refuser('habilitation_refusee');
  } catch {
    return refuser('habilitations_indisponibles', 'erreur');
  }

  let resultat;
  try {
    resultat = await fonction.executer(args.data, { cabinetId, utilisateurId, dossierId, periode });
  } catch {
    return refuser('fonction_en_echec', 'erreur');
  }

  // Défense en profondeur : un élément mal formé ou d'un dossier hors périmètre n'entre jamais dans le registre.
  const elements: ElementSource[] = [];
  let ecartes = 0;
  for (const brut of resultat.elements) {
    const lu = schemaElementSource.safeParse(brut);
    const horsPerimetre = lu.success && (lu.data.nature === 'source_officielle' ? lu.data.dossierId !== null : lu.data.dossierId === null || !session.perimetre.dossierIds.includes(lu.data.dossierId));
    if (!lu.success || horsPerimetre) {
      ecartes += 1;
      continue;
    }
    elements.push(lu.data);
    session.registre.set(lu.data.id, lu.data);
  }
  const manquantes = (resultat.donneesManquantes ?? []).map((d) => String(d).slice(0, 300));
  for (const d of manquantes) if (!session.donneesManquantes.includes(d)) session.donneesManquantes.push(d);
  tracer(session, nom, 'executee', null, dossierId, { arguments: tailleArguments, elements: elements.length, elementsEcartes: ecartes });
  return { issue: 'executee', elements, donneesManquantes: manquantes };
}
