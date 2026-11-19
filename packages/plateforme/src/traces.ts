import diagnostics_channel from 'node:diagnostics_channel';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type AttributeValue,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { ExportResultCode, W3CTraceContextPropagator, type ExportResult } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import type { Config } from './config.js';

/**
 * Traces OpenTelemetry (traces seulement : les métriques restent sur Prometheus, voir metriques.ts).
 *
 * - ACTIVES seulement si `OTEL_EXPORTER_OTLP_ENDPOINT` est renseigné. Vide : rien n'est enregistré, aucun appel réseau,
 *   toutes les fonctions de ce module rendent la main immédiatement.
 * - AUCUNE auto-instrumentation : les instrumentations officielles s'accrochent en modifiant les modules au chargement,
 *   ce qui, avec des modules ES, exige un crochet de chargement (`--import` et `--experimental-loader`). Les spans sont donc
 *   posés à la main aux points clés (requête HTTP, transaction PostgreSQL, stockage S3, mise en file, traitement du
 *   worker) et, pour les appels HTTP sortants, par les canaux de diagnostic de Node (`undici:request:*`), qui ne
 *   dépendent pas de l'ordre de chargement des modules.
 * - AUCUNE donnée comptable ou personnelle, aucun secret : tout span exporté passe par `ExportateurFiltrant`, qui ne
 *   laisse sortir que les attributs de la liste blanche (`attributAdmis`), retire les événements, le message de statut
 *   et les attributs des liens, et remplace un nom de span inattendu.
 * - NON BLOQUANT : export par lots en arrière-plan, file bornée (au-delà, les spans sont abandonnés), délais bornés,
 *   une seule ligne de journal par période de panne du collecteur.
 */

export type ServiceTrace = 'api' | 'worker';
export type ConfigTraces = Pick<Config, 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'TRACES_TAUX_ECHANTILLONNAGE' | 'TRACES_ENVIRONNEMENT' | 'COMTAPLE_VERSION' | 'NODE_ENV'>;

export interface OptionsTraces {
  /** TESTS : exportateur de remplacement (en mémoire) ; les traces sont alors actives même sans point d'accès. */
  exportateur?: SpanExporter;
  /** Journal des incidents d'export (par défaut `console.warn`). */
  journal?: (message: string) => void;
  /** Délai entre deux envois de lots, en millisecondes (2 000 par défaut). */
  delaiLotMs?: number;
}

/** Exportateur en mémoire, pour les tests. */
export { InMemorySpanExporter as ExportateurMemoire };
export type { ReadableSpan as SpanLu };

const NOM_TRACEUR = 'comtaple';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Valeur textuelle admise : identifiant, nom technique, gabarit de route, nom d'hôte. Ni « @ », ni « ? », ni « = », ni accent. */
const TEXTE_SUR = /^[A-Za-z0-9 _.:/*()-]{0,160}$/;
const NOM_DE_SPAN_SUR = /^[A-Za-z0-9 _.:/*()-]{1,200}$/;

/** Attributs dont la valeur DOIT être un UUID (identifiants techniques). */
const ATTRIBUTS_UUID = new Set([
  'comtaple.cabinet.id',
  'comtaple.dossier.id',
  'comtaple.document.id',
  'comtaple.lot.id',
  'comtaple.execution.id',
  'comtaple.restitution.id',
  'comtaple.export.id',
  'comtaple.connexion.id',
]);
/** Paramètres de route (`:id`, `:dossierId`…) : admis seulement si leur valeur est un UUID. */
const ATTRIBUT_PARAMETRE_DE_ROUTE = /^comtaple\.route\.[A-Za-z]{1,40}$/;
/** Routes et paramètres qui désignent une personne : leurs identifiants ne sont jamais portés par un span. */
const ROUTE_DE_PERSONNE = /\/(membres|utilisateurs|invitations)(\/|$)/;
const PARAMETRE_DE_PERSONNE = /utilisateur|membre|invitation|personne/i;
/** Attributs textuels : noms techniques, codes, gabarits. */
const ATTRIBUTS_TEXTE = new Set([
  'http.request.method',
  'http.route',
  'server.address',
  'error.type',
  'db.system.name',
  'db.operation.name',
  'messaging.system',
  'messaging.destination.name',
  'messaging.operation.type',
  'messaging.message.id',
  'comtaple.travail.nom',
  'comtaple.travail.declencheur',
  'comtaple.stockage.operation',
]);
/** Attributs numériques ou booléens : codes, tailles, décomptes, durées. */
const ATTRIBUTS_NOMBRE = new Set([
  'http.response.status_code',
  'http.request.body.size',
  'server.port',
  'comtaple.travail.tentative',
  'comtaple.travail.attente_ms',
  'comtaple.travail.contexte_recu',
  'comtaple.taille_octets',
  'comtaple.decompte',
  'comtaple.http.interrompue',
]);

/** Liste blanche des clés d'attribut (hors paramètres de route, admis par gabarit). */
export const ATTRIBUTS_ADMIS: ReadonlySet<string> = new Set([...ATTRIBUTS_UUID, ...ATTRIBUTS_TEXTE, ...ATTRIBUTS_NOMBRE]);

/** Vrai si l'attribut peut sortir du processus : clé de la liste blanche ET valeur de la forme attendue pour cette clé. */
export function attributAdmis(cle: string, valeur: unknown): valeur is AttributeValue {
  if (ATTRIBUTS_UUID.has(cle) || ATTRIBUT_PARAMETRE_DE_ROUTE.test(cle)) return typeof valeur === 'string' && UUID.test(valeur);
  if (ATTRIBUTS_TEXTE.has(cle)) return typeof valeur === 'string' && TEXTE_SUR.test(valeur);
  if (ATTRIBUTS_NOMBRE.has(cle)) return typeof valeur === 'boolean' || (typeof valeur === 'number' && Number.isFinite(valeur));
  return false;
}

/** Ne garde que les attributs admis. */
export function filtrerAttributs(attributs: Readonly<Record<string, unknown>> | undefined): Attributes {
  const admis: Attributes = {};
  for (const [cle, valeur] of Object.entries(attributs ?? {})) if (attributAdmis(cle, valeur)) admis[cle] = valeur;
  return admis;
}

/** Copie d'un span terminé, débarrassée de tout ce qui n'est pas explicitement admis. */
export function assainirSpan(span: ReadableSpan): ReadableSpan {
  const visible = <V>(value: V) => ({ value, enumerable: true });
  return Object.create(span, {
    name: visible(NOM_DE_SPAN_SUR.test(span.name) ? span.name : 'autre'),
    attributes: visible(filtrerAttributs(span.attributes)),
    // Les événements (dont les exceptions : message, pile d'appels) et le message de statut peuvent citer une donnée.
    events: visible([]),
    status: visible({ code: span.status.code }),
    links: visible(span.links.map((l) => ({ context: l.context }))),
  }) as ReadableSpan;
}

/**
 * Dernier point de passage avant l'export : assainit chaque span, et journalise une panne du collecteur UNE fois
 * (puis son rétablissement), jamais à chaque lot.
 */
export class ExportateurFiltrant implements SpanExporter {
  private enPanne = false;
  constructor(
    private readonly aval: SpanExporter,
    private readonly journal: (message: string) => void = (m) => console.warn(m),
  ) {}

  export(spans: ReadableSpan[], rappel: (resultat: ExportResult) => void): void {
    let lot: ReadableSpan[];
    try {
      lot = spans.map(assainirSpan);
    } catch {
      rappel({ code: ExportResultCode.FAILED });
      return;
    }
    this.aval.export(lot, (resultat) => {
      this.noter(resultat.code === ExportResultCode.SUCCESS);
      rappel(resultat);
    });
  }

  private noter(reussi: boolean): void {
    if (!reussi && !this.enPanne) {
      this.enPanne = true;
      // Ni l'adresse du collecteur (elle peut porter un identifiant), ni le détail de l'erreur : seulement le fait.
      this.journal('traces : export impossible (collecteur absent, injoignable ou lent) ; les spans sont abandonnés, le service continue. Ce message ne sera pas répété avant le rétablissement.');
    } else if (reussi && this.enPanne) {
      this.enPanne = false;
      this.journal('traces : export rétabli.');
    }
  }

  shutdown(): Promise<void> {
    return this.aval.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.aval.forceFlush?.() ?? Promise.resolve();
  }
}

interface Etat {
  fournisseur: TracerProvider;
  desabonner: () => void;
}
let etat: Etat | undefined;
const propagateur = new W3CTraceContextPropagator();
const traceur = () => trace.getTracer(NOM_TRACEUR);

/** Vrai si les traces sont enregistrées dans ce processus. */
export function tracesActives(): boolean {
  return etat !== undefined;
}

const borne = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>((r) => {
      setTimeout(() => r(undefined), ms).unref();
    }),
  ]);

/**
 * Démarre les traces du processus. À appeler une fois, tôt dans le point d'entrée (après le chargement de
 * l'environnement). Sans point d'accès configuré (et sans exportateur de test) : ne fait RIEN et renvoie `false`.
 */
export function demarrerTraces(service: ServiceTrace, cfg: ConfigTraces, options: OptionsTraces = {}): boolean {
  if (etat) return true;
  const pointAcces = cfg.OTEL_EXPORTER_OTLP_ENDPOINT.trim();
  if (!options.exportateur && pointAcces === '') return false;

  const aval =
    options.exportateur ??
    new OTLPTraceExporter({
      url: `${pointAcces.replace(/\/+$/, '')}/v1/traces`,
      // Délai total d'un envoi, réessais compris : un collecteur lent ne retient jamais un lot plus longtemps.
      timeoutMillis: 3_000,
    });
  const exportateur = new ExportateurFiltrant(aval, options.journal);
  const fournisseur = new TracerProvider({
    // Ressource construite à la main : pas de détection automatique (nom d'hôte, ligne de commande, utilisateur système).
    resource: resourceFromAttributes({
      'service.name': `comtaple-${service}`,
      'service.namespace': 'comtaple',
      'service.version': cfg.COMTAPLE_VERSION || '0.1.0',
      'deployment.environment.name': cfg.TRACES_ENVIRONNEMENT || cfg.NODE_ENV || 'local',
    }),
    // La décision d'échantillonnage est prise à la racine (requête ou travail planifié) et suivie par les enfants,
    // worker compris : une trace est entière ou absente.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(cfg.TRACES_TAUX_ECHANTILLONNAGE) }),
    spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 200, eventCountLimit: 0, linkCountLimit: 4 },
    spanProcessors: [
      options.exportateur
        ? new SimpleSpanProcessor({ exporter: exportateur })
        : new BatchSpanProcessor({
            exporter: exportateur,
            maxQueueSize: 2_048,
            maxExportBatchSize: 512,
            scheduledDelayMillis: options.delaiLotMs ?? 2_000,
            exportTimeoutMillis: 5_000,
          }),
    ],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(fournisseur);
  etat = { fournisseur, desabonner: suivreHttpSortant() };
  return true;
}

/** Vide les spans en attente (délai borné) et désactive les traces. Sans effet si elles ne sont pas actives. */
export async function arreterTraces(delaiMs = 6_000): Promise<void> {
  if (!etat) return;
  const { fournisseur, desabonner } = etat;
  etat = undefined;
  desabonner();
  await borne(fournisseur.shutdown(), delaiMs);
  trace.disable();
  context.disable();
  propagation.disable();
}

/** Envoie sans attendre les spans terminés (tests, fin d'un essai). */
export async function viderTraces(delaiMs = 6_000): Promise<void> {
  if (etat) await borne(etat.fournisseur.forceFlush({ timeoutMillis: delaiMs }), delaiMs);
}

/** Identifiant de la trace courante (32 caractères hexadécimaux), s'il y en a une. */
export function idTraceCourante(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

function marquerEchec(span: Span, e: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  // Seulement la CLASSE de l'erreur : son message peut citer un nom de fichier, un libellé, une adresse.
  span.setAttribute('error.type', e instanceof Error ? e.name : 'Erreur');
}

export interface OptionsSpan {
  genre?: 'interne' | 'client';
  /** Attributs : seuls ceux de la liste blanche sont conservés. */
  attributs?: Record<string, unknown>;
}

/**
 * Exécute `fn` dans un span enfant du contexte courant. Sans traces actives : appelle `fn` directement.
 * `fn` reçoit une fonction pour ajouter des attributs (filtrés par la liste blanche).
 */
export async function avecSpan<T>(nom: string, options: OptionsSpan, fn: (noter: (attributs: Record<string, unknown>) => void) => Promise<T> | T): Promise<T> {
  if (!etat) return fn(() => undefined);
  const span = traceur().startSpan(nom, { kind: options.genre === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL, attributes: filtrerAttributs(options.attributs) });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn((a) => span.setAttributes(filtrerAttributs(a))));
  } catch (e) {
    marquerEchec(span, e);
    throw e;
  } finally {
    span.end();
  }
}

// ── Propagation requête → travail → worker (en-têtes W3C `traceparent` / `tracestate`) ──

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** Contexte de trace courant, sérialisé pour accompagner un travail ; `undefined` s'il n'y a pas de trace en cours. */
export function contexteTracePourTravail(): string | undefined {
  if (!etat) return undefined;
  const porteur: Record<string, string> = {};
  propagateur.inject(context.active(), porteur, { set: (p, cle, valeur) => void (p[cle] = valeur) });
  return porteur.traceparent ? JSON.stringify(porteur) : undefined;
}

/** Contexte parent d'un travail. Métadonnées absentes ou illisibles (travail planifié, travail antérieur) : contexte racine. */
export function contexteTraceDuTravail(metadonnees: unknown): Context {
  if (typeof metadonnees !== 'string' || metadonnees.length > 1_024) return ROOT_CONTEXT;
  try {
    const lu = JSON.parse(metadonnees) as { traceparent?: unknown; tracestate?: unknown };
    if (typeof lu?.traceparent !== 'string' || !TRACEPARENT.test(lu.traceparent)) return ROOT_CONTEXT;
    const porteur: Record<string, string> = { traceparent: lu.traceparent };
    if (typeof lu.tracestate === 'string') porteur.tracestate = lu.tracestate;
    return propagateur.extract(ROOT_CONTEXT, porteur, { get: (p, cle) => p[cle], keys: (p) => Object.keys(p) });
  } catch {
    return ROOT_CONTEXT;
  }
}

/** Identifiants techniques portés par les données d'un travail (jamais autre chose : voir files.ts). */
const IDENTIFIANTS_DE_TRAVAIL: Record<string, string> = {
  cabinetId: 'comtaple.cabinet.id',
  documentId: 'comtaple.document.id',
  lotImportId: 'comtaple.lot.id',
  executionId: 'comtaple.execution.id',
  restitutionId: 'comtaple.restitution.id',
  restitutionCabinetId: 'comtaple.restitution.id',
  exportId: 'comtaple.export.id',
  connexionId: 'comtaple.connexion.id',
  declencheur: 'comtaple.travail.declencheur',
};

function attributsDeTravail(file: string, nom: string, donnees: unknown): Attributes {
  const a: Record<string, unknown> = { 'messaging.system': 'bullmq', 'messaging.destination.name': file, 'comtaple.travail.nom': nom };
  if (donnees && typeof donnees === 'object') {
    for (const [cle, attribut] of Object.entries(IDENTIFIANTS_DE_TRAVAIL)) a[attribut] ??= (donnees as Record<string, unknown>)[cle];
  }
  return filtrerAttributs(a);
}

/**
 * Entoure une mise en file d'un span « producteur » et fournit à `ajouter` le contexte de trace à joindre au travail
 * (option BullMQ `telemetry.metadata`, conservée avec le travail dans Redis, hors de ses données). Sans trace active :
 * `ajouter(undefined)`, le travail est mis en file exactement comme avant.
 */
export async function tracerMiseEnFile<T extends { id?: string }>(file: string, nom: string, donnees: unknown, ajouter: (metadonnees: string | undefined) => Promise<T>): Promise<T> {
  if (!etat) return ajouter(undefined);
  const span = traceur().startSpan(`mettre en file ${file} ${nom}`, { kind: SpanKind.PRODUCER, attributes: { ...attributsDeTravail(file, nom, donnees), 'messaging.operation.type': 'send' } });
  try {
    return await context.with(trace.setSpan(context.active(), span), async () => {
      const travail = await ajouter(contexteTracePourTravail());
      if (travail?.id) span.setAttributes(filtrerAttributs({ 'messaging.message.id': String(travail.id) }));
      return travail;
    });
  } catch (e) {
    marquerEchec(span, e);
    throw e;
  } finally {
    span.end();
  }
}

/** Ce que le suivi lit d'un travail BullMQ. */
export interface TravailSuivi {
  name: string;
  id?: string;
  data?: unknown;
  attemptsMade?: number;
  timestamp?: number;
  opts?: { telemetry?: { metadata?: string } };
}

/**
 * Exécute le traitement d'un travail dans un span « consommateur », ENFANT du contexte transporté avec le travail :
 * la trace de la requête d'origine se poursuit dans le worker. Sans contexte (travail planifié, rattrapage, travail
 * mis en file avant l'instrumentation) : trace neuve. Sans traces actives : appelle `fn` directement.
 */
export async function tracerTravail<T>(file: string, travail: TravailSuivi, fn: () => Promise<T> | T): Promise<T> {
  if (!etat) return fn();
  const parent = contexteTraceDuTravail(travail.opts?.telemetry?.metadata);
  const span = traceur().startSpan(
    `traiter ${file} ${travail.name}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        ...attributsDeTravail(file, travail.name, travail.data),
        ...filtrerAttributs({
          'messaging.operation.type': 'process',
          'messaging.message.id': travail.id === undefined ? undefined : String(travail.id),
          'comtaple.travail.tentative': (travail.attemptsMade ?? 0) + 1,
          'comtaple.travail.attente_ms': travail.timestamp ? Math.max(0, Date.now() - travail.timestamp) : undefined,
          'comtaple.travail.contexte_recu': parent !== ROOT_CONTEXT,
        }),
      },
    },
    parent,
  );
  try {
    return await context.with(trace.setSpan(parent, span), fn);
  } catch (e) {
    marquerEchec(span, e);
    throw e;
  } finally {
    span.end();
  }
}

// ── Requêtes HTTP entrantes ──

interface RequeteHttp {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  route?: { path?: unknown };
  params?: Record<string, unknown>;
}
interface ReponseHttp {
  statusCode: number;
  writableFinished?: boolean;
  on(evenement: 'finish' | 'close', ecouteur: () => void): unknown;
}

/**
 * Intergiciel Express : un span « serveur » par requête, nommé par le GABARIT de route (jamais l'URL reçue, ses
 * paramètres de requête, ses en-têtes ou son corps). Chaque requête ouvre une trace neuve : un `traceparent` envoyé
 * par un client n'est pas repris (un appelant ne décide ni de l'identifiant ni de l'échantillonnage).
 */
export function intergicielTraces(): (req: RequeteHttp, res: ReponseHttp, suite: () => void) => void {
  return (req, res, suite) => {
    if (!etat) return suite();
    const span = traceur().startSpan(`HTTP ${req.method}`, { kind: SpanKind.SERVER, attributes: filtrerAttributs({ 'http.request.method': req.method }) }, ROOT_CONTEXT);
    const ctx = trace.setSpan(ROOT_CONTEXT, span);
    // Les écouteurs posés sur la requête et la réponse (lecture du corps, fin d'envoi) s'exécutent dans le contexte de la requête.
    context.bind(ctx, req);
    context.bind(ctx, res);
    let fini = false;
    const finir = () => {
      if (fini) return;
      fini = true;
      const gabarit = typeof req.route?.path === 'string' ? req.route.path : res.statusCode === 404 ? 'inconnue' : 'autre';
      const attributs: Record<string, unknown> = { 'http.route': gabarit, 'http.response.status_code': res.statusCode };
      const taille = Number(req.headers['content-length']);
      if (Number.isFinite(taille) && taille > 0) attributs['http.request.body.size'] = taille;
      // Paramètres de route : seuls les UUID passent le filtre (identifiants techniques de dossier, de document, de lot…).
      // Les identifiants de PERSONNES (membre, utilisateur, invitation) ne sont pas repris.
      if (!ROUTE_DE_PERSONNE.test(gabarit)) {
        for (const [cle, valeur] of Object.entries(req.params ?? {})) if (!PARAMETRE_DE_PERSONNE.test(cle)) attributs[`comtaple.route.${cle}`] = valeur;
      }
      if (res.writableFinished === false) attributs['comtaple.http.interrompue'] = true;
      span.updateName(TEXTE_SUR.test(gabarit) ? `${req.method} ${gabarit}` : `HTTP ${req.method}`);
      span.setAttributes(filtrerAttributs(attributs));
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    };
    res.on('finish', finir);
    res.on('close', finir);
    context.with(ctx, suite);
  };
}

// ── Appels HTTP sortants (fetch de Node : OCR, IA, fournisseurs de messagerie, agrégation, veille) ──

interface RequeteUndici {
  origin?: unknown;
  method?: unknown;
}

/**
 * Un span « client » par appel `fetch` sortant, par les canaux de diagnostic de Node (aucun module modifié). Attributs :
 * méthode, hôte, port, code de réponse — jamais le chemin, les paramètres, les en-têtes ni le corps. Aucun en-tête de
 * trace n'est ajouté aux requêtes sortantes : les tiers ne reçoivent pas nos identifiants de trace.
 */
function suivreHttpSortant(): () => void {
  const enCours = new WeakMap<object, Span>();
  const debut = (m: unknown) => {
    const requete = (m as { request?: RequeteUndici }).request;
    if (!requete || !etat) return;
    let hote = '';
    let port: number | undefined;
    try {
      const u = new URL(String(requete.origin));
      hote = u.hostname;
      port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    } catch {
      /* origine illisible : span sans hôte */
    }
    const methode = typeof requete.method === 'string' ? requete.method : 'AUTRE';
    enCours.set(
      requete,
      traceur().startSpan(`HTTP ${TEXTE_SUR.test(methode) ? methode : 'AUTRE'}`, { kind: SpanKind.CLIENT, attributes: filtrerAttributs({ 'http.request.method': methode, 'server.address': hote, 'server.port': port }) }),
    );
  };
  const enTetes = (m: unknown) => {
    const { request, response } = m as { request?: object; response?: { statusCode?: number } };
    const span = request && enCours.get(request);
    if (!span || typeof response?.statusCode !== 'number') return;
    span.setAttribute('http.response.status_code', response.statusCode);
    if (response.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  };
  const fin = (m: unknown) => {
    const { request, error } = m as { request?: object; error?: unknown };
    const span = request && enCours.get(request);
    if (!span) return;
    if (error !== undefined) marquerEchec(span, error);
    span.end();
    enCours.delete(request);
  };
  const abonnements: Array<[string, (m: unknown) => void]> = [
    ['undici:request:create', debut],
    ['undici:request:headers', enTetes],
    ['undici:request:trailers', fin],
    ['undici:request:error', fin],
  ];
  for (const [canal, f] of abonnements) diagnostics_channel.subscribe(canal, f);
  return () => {
    for (const [canal, f] of abonnements) diagnostics_channel.unsubscribe(canal, f);
  };
}
