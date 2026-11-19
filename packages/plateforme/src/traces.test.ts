import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';
import {
  arreterTraces,
  ATTRIBUTS_ADMIS,
  attributAdmis,
  avecSpan,
  contexteTraceDuTravail,
  contexteTracePourTravail,
  demarrerTraces,
  ExportateurFiltrant,
  ExportateurMemoire,
  filtrerAttributs,
  idTraceCourante,
  intergicielTraces,
  tracerMiseEnFile,
  tracerTravail,
  tracesActives,
  viderTraces,
  type ConfigTraces,
} from './traces.js';

const CFG: ConfigTraces = { OTEL_EXPORTER_OTLP_ENDPOINT: '', TRACES_TAUX_ECHANTILLONNAGE: 1, TRACES_ENVIRONNEMENT: '', COMTAPLE_VERSION: '', NODE_ENV: '' };
const CABINET = '11111111-2222-4333-8444-555555555555';
const DOCUMENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** Données interdites, glissées partout où un appelant maladroit pourrait les mettre. */
const INTERDITS = {
  fichier: 'facture-dupont-2026.pdf',
  libelle: 'Achat fournitures Martin SARL',
  adresse: 'alice.admin@cabinet-a.test',
  jeton: 'eyJhbGciOiJSUzI1NiJ9.charge.signature',
  requete: "select * from ecritures where libelle = 'Loyer mars'",
};

afterEach(async () => {
  await arreterTraces();
});

const ecouter = (serveur: Server) => new Promise<number>((r) => serveur.listen(0, '127.0.0.1', () => r((serveur.address() as AddressInfo).port)));
const fermer = (serveur: Server) =>
  new Promise<void>((r) => {
    serveur.closeAllConnections();
    serveur.close(() => r());
  });
async function portFerme(): Promise<number> {
  const s = createServer();
  const port = await ecouter(s);
  await fermer(s);
  return port;
}

describe('traces : activation', () => {
  it('sans point d’accès : rien n’est démarré, tout le module est transparent', async () => {
    expect(demarrerTraces('api', CFG)).toBe(false);
    expect(tracesActives()).toBe(false);
    expect(await avecSpan('essai', {}, () => 42)).toBe(42);
    expect(contexteTracePourTravail()).toBeUndefined();
    expect(idTraceCourante()).toBeUndefined();
    let recu: string | undefined = 'jamais appelé';
    await tracerMiseEnFile('documents', 'analyser', { cabinetId: CABINET }, async (m) => {
      recu = m;
      return { id: '1' };
    });
    expect(recu).toBeUndefined();
    expect(await tracerTravail('documents', { name: 'analyser' }, () => 'fait')).toBe('fait');
    let suite = 0;
    intergicielTraces()({ method: 'GET', headers: {} }, { statusCode: 200, on: () => undefined }, () => suite++);
    expect(suite).toBe(1);
    // Le traceur global reste inerte : un span n'enregistre rien.
    expect(trace.getTracer('comtaple').startSpan('x').isRecording()).toBe(false);
  });

  it('un point d’accès vide ou fait d’espaces ne déclenche rien', () => {
    expect(demarrerTraces('worker', { ...CFG, OTEL_EXPORTER_OTLP_ENDPOINT: '   ' })).toBe(false);
  });

  it('actif : nom de service distinct, version, environnement ; arrêt puis redémarrage possibles', async () => {
    const memoire = new ExportateurMemoire();
    expect(demarrerTraces('api', { ...CFG, COMTAPLE_VERSION: 'abc123def456', TRACES_ENVIRONNEMENT: 'recette' }, { exportateur: memoire })).toBe(true);
    expect(tracesActives()).toBe(true);
    await avecSpan('essai', {}, () => undefined);
    const [span] = memoire.getFinishedSpans();
    expect(span!.resource.attributes).toMatchObject({ 'service.name': 'comtaple-api', 'service.version': 'abc123def456', 'deployment.environment.name': 'recette' });
    // Aucune détection automatique : ni hôte, ni processus, ni utilisateur système dans la ressource.
    expect(Object.keys(span!.resource.attributes).filter((c) => /^(host|process|os)\./.test(c))).toEqual([]);
    await arreterTraces();
    expect(tracesActives()).toBe(false);

    const memoire2 = new ExportateurMemoire();
    demarrerTraces('worker', CFG, { exportateur: memoire2 });
    await avecSpan('essai', {}, () => undefined);
    expect(memoire2.getFinishedSpans()[0]!.resource.attributes).toMatchObject({ 'service.name': 'comtaple-worker', 'service.version': '0.1.0', 'deployment.environment.name': 'local' });
  });

  it('échantillonnage à 0 : aucun span exporté, y compris côté worker pour un travail issu d’une trace non retenue', async () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('api', { ...CFG, TRACES_TAUX_ECHANTILLONNAGE: 0 }, { exportateur: memoire });
    let metadonnees: string | undefined;
    await avecSpan('racine', {}, () => tracerMiseEnFile('documents', 'analyser', {}, async (m) => ((metadonnees = m), { id: '1' })));
    expect(JSON.parse(metadonnees!).traceparent).toMatch(/-00$/);
    await tracerTravail('documents', { name: 'analyser', opts: { telemetry: { metadata: metadonnees } } }, () => undefined);
    expect(memoire.getFinishedSpans()).toHaveLength(0);
  });
});

describe('traces : liste blanche des attributs', () => {
  it('n’admet que des clés connues, avec une valeur de la forme attendue', () => {
    expect(attributAdmis('comtaple.cabinet.id', CABINET)).toBe(true);
    expect(attributAdmis('comtaple.cabinet.id', 'Cabinet Dupont')).toBe(false);
    expect(attributAdmis('comtaple.route.dossierId', DOCUMENT)).toBe(true);
    expect(attributAdmis('comtaple.route.nom', INTERDITS.fichier)).toBe(false);
    expect(attributAdmis('http.route', '/v1/dossiers/:dossierId/documents')).toBe(true);
    expect(attributAdmis('http.route', '/v1/recherche?q=dupont')).toBe(false);
    expect(attributAdmis('server.address', 'oauth2.googleapis.com')).toBe(true);
    expect(attributAdmis('server.address', INTERDITS.adresse)).toBe(false);
    expect(attributAdmis('http.response.status_code', 201)).toBe(true);
    expect(attributAdmis('http.response.status_code', '201 ; libellé')).toBe(false);
    for (const cle of ['http.request.header.authorization', 'http.request.header.cookie', 'url.full', 'url.query', 'url.path', 'db.query.text', 'db.statement', 'db.query.parameter.0', 'enduser.id', 'user.email', 'exception.message', 'fichier', 'libelle']) {
      expect(ATTRIBUTS_ADMIS.has(cle), cle).toBe(false);
      expect(attributAdmis(cle, 'x'), cle).toBe(false);
    }
    expect(filtrerAttributs({ 'comtaple.decompte': 3, 'comtaple.taille_octets': Number.NaN, libelle: INTERDITS.libelle, 'comtaple.travail.nom': ['a', 'b'] })).toEqual({ 'comtaple.decompte': 3 });
  });

  it('un span chargé de données interdites sort nettoyé : attributs, événements, exception, message de statut, nom', async () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('api', CFG, { exportateur: memoire });
    // 1. Par les fonctions du module.
    await avecSpan('depot', { attributs: { 'comtaple.cabinet.id': CABINET, nomFichier: INTERDITS.fichier, 'http.request.header.authorization': `Bearer ${INTERDITS.jeton}` } }, (noter) =>
      noter({ 'comtaple.taille_octets': 1234, libelle: INTERDITS.libelle, 'user.email': INTERDITS.adresse, 'db.query.text': INTERDITS.requete }),
    );
    // 2. Une erreur dont le MESSAGE cite une donnée : seule sa classe est conservée.
    await expect(
      avecSpan('import', {}, () => {
        throw new TypeError(`Ligne illisible dans ${INTERDITS.fichier} : ${INTERDITS.libelle}`);
      }),
    ).rejects.toThrow();
    // 3. Un span posé directement sur le traceur global par du code qui ignorerait la liste blanche.
    const brut = trace.getTracer('autre-bibliotheque').startSpan(`GET /v1/recherche?q=${INTERDITS.adresse}`, {
      attributes: { 'url.full': `https://api.test/v1/x?jeton=${INTERDITS.jeton}`, 'db.query.text': INTERDITS.requete, 'comtaple.document.id': DOCUMENT, 'comtaple.cabinet.id': INTERDITS.libelle },
    });
    brut.addEvent('lecture', { fichier: INTERDITS.fichier });
    brut.recordException(new Error(INTERDITS.libelle));
    brut.setStatus({ code: SpanStatusCode.ERROR, message: INTERDITS.adresse });
    brut.end();

    const spans = memoire.getFinishedSpans();
    expect(spans).toHaveLength(3);
    expect(spans[0]!.attributes).toEqual({ 'comtaple.cabinet.id': CABINET, 'comtaple.taille_octets': 1234 });
    expect(spans[1]!.attributes).toEqual({ 'error.type': 'TypeError' });
    expect(spans[1]!.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(spans[2]!.name).toBe('autre');
    expect(spans[2]!.attributes).toEqual({ 'comtaple.document.id': DOCUMENT });
    expect(spans[2]!.events).toEqual([]);
    expect(spans[2]!.status).toEqual({ code: SpanStatusCode.ERROR });
    // Ce qui serait transmis au collecteur, pris en bloc, ne contient aucune des données interdites.
    const transmis = JSON.stringify(spans.map((s) => ({ nom: s.name, attributs: s.attributes, evenements: s.events, statut: s.status, liens: s.links, ressource: s.resource.attributes })));
    for (const [nature, valeur] of Object.entries(INTERDITS)) expect(transmis.includes(valeur), nature).toBe(false);
    expect(transmis).not.toMatch(/Bearer|@/);
  });
});

describe('traces : propagation requête → travail → worker', () => {
  it('le contexte accompagne le travail et le traitement en devient l’enfant, dans la même trace', async () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('api', CFG, { exportateur: memoire });
    const donnees = { cabinetId: CABINET, documentId: DOCUMENT };
    let metadonnees: string | undefined;
    let idTraceRequete: string | undefined;
    await avecSpan('requete', {}, async () => {
      idTraceRequete = idTraceCourante();
      await tracerMiseEnFile('documents', 'analyser', donnees, async (m) => ((metadonnees = m), { id: `doc-${DOCUMENT}-1` }));
    });
    // Ce qui voyage : les deux en-têtes W3C, rien d'autre ; les données du travail ne sont pas modifiées.
    expect(Object.keys(JSON.parse(metadonnees!))).toEqual(['traceparent']);
    expect(JSON.parse(metadonnees!).traceparent).toMatch(new RegExp(`^00-${idTraceRequete}-[0-9a-f]{16}-01$`));
    expect(donnees).toEqual({ cabinetId: CABINET, documentId: DOCUMENT });

    // Aller-retour par la sérialisation de la file (JSON), puis traitement « côté worker ».
    const travail = JSON.parse(JSON.stringify({ name: 'analyser', id: `doc-${DOCUMENT}-1`, data: donnees, attemptsMade: 0, timestamp: Date.now() - 50, opts: { telemetry: { metadata: metadonnees } } }));
    let idTraceTraitement: string | undefined;
    await tracerTravail('documents', travail, async () => {
      idTraceTraitement = idTraceCourante();
      await avecSpan('etape', {}, () => undefined);
    });
    expect(idTraceTraitement).toBe(idTraceRequete);

    const parNom = Object.fromEntries(memoire.getFinishedSpans().map((s) => [s.name, s]));
    const producteur = parNom['mettre en file documents analyser']!;
    const consommateur = parNom['traiter documents analyser']!;
    expect(producteur.kind).toBe(SpanKind.PRODUCER);
    expect(consommateur.kind).toBe(SpanKind.CONSUMER);
    expect(consommateur.spanContext().traceId).toBe(idTraceRequete);
    expect(consommateur.parentSpanContext?.spanId).toBe(producteur.spanContext().spanId);
    expect(producteur.parentSpanContext?.spanId).toBe(parNom.requete!.spanContext().spanId);
    expect(parNom.etape!.parentSpanContext?.spanId).toBe(consommateur.spanContext().spanId);
    expect(consommateur.attributes).toMatchObject({
      'messaging.system': 'bullmq',
      'messaging.destination.name': 'documents',
      'messaging.operation.type': 'process',
      'comtaple.travail.nom': 'analyser',
      'comtaple.travail.tentative': 1,
      'comtaple.travail.contexte_recu': true,
      'comtaple.cabinet.id': CABINET,
      'comtaple.document.id': DOCUMENT,
    });
  });

  it('un travail sans contexte (planifié, ou mis en file avant l’instrumentation) ou au contexte illisible ouvre une trace neuve et est traité', async () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('worker', CFG, { exportateur: memoire });
    const cas: unknown[] = [undefined, '', 'pas du json', '{"traceparent":42}', '{"traceparent":"00-xyz"}', JSON.stringify({ traceparent: `00-${'0'.repeat(32)}-${'0'.repeat(16)}-01` }), 'x'.repeat(5_000)];
    const traces = new Set<string>();
    for (const metadata of cas) {
      const rendu = await tracerTravail('comptabilite', { name: 'veille', data: {}, opts: { telemetry: { metadata: metadata as string } } }, () => {
        traces.add(idTraceCourante()!);
        return 'traité';
      });
      expect(rendu).toBe('traité');
    }
    // Travail sans aucune option (forme la plus ancienne).
    expect(await tracerTravail('mail', { name: 'planifier-synchronisations' }, () => 'traité')).toBe('traité');
    expect(traces.size).toBe(cas.length);
    const spans = memoire.getFinishedSpans();
    expect(spans.every((s) => s.parentSpanContext === undefined && s.attributes['comtaple.travail.contexte_recu'] === false)).toBe(true);
    expect(contexteTraceDuTravail(undefined)).toBe(contexteTraceDuTravail('illisible'));
  });

  it('un traitement en échec marque le span en erreur et relaie l’erreur telle quelle (les reprises de la file restent intactes)', async () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('worker', CFG, { exportateur: memoire });
    const erreur = new RangeError(`échec sur ${INTERDITS.fichier}`);
    await expect(tracerTravail('documents', { name: 'analyser', attemptsMade: 2 }, () => Promise.reject(erreur))).rejects.toBe(erreur);
    const [span] = memoire.getFinishedSpans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.attributes).toMatchObject({ 'error.type': 'RangeError', 'comtaple.travail.tentative': 3 });
    expect(JSON.stringify(span!.attributes)).not.toContain(INTERDITS.fichier);
  });
});

describe('traces : requêtes HTTP', () => {
  function requete(route: string | undefined, statut: number, params: Record<string, unknown> = {}) {
    const req = Object.assign(new EventEmitter(), { method: 'POST', headers: { authorization: `Bearer ${INTERDITS.jeton}`, cookie: 'session=secret', 'content-length': '321' }, url: `/v1/x?q=${INTERDITS.adresse}`, route: undefined as { path: string } | undefined, params });
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
    let idTrace: string | undefined;
    intergicielTraces()(req, res, () => {
      idTrace = idTraceCourante();
      // Express ne renseigne la route qu'au moment où le gestionnaire est choisi.
      if (route) req.route = { path: route };
      res.statusCode = statut;
      res.emit('finish');
      res.emit('close');
    });
    return idTrace;
  }

  it('un span serveur par requête : méthode, gabarit de route, code ; ni URL, ni paramètres de requête, ni en-têtes', () => {
    const memoire = new ExportateurMemoire();
    demarrerTraces('api', CFG, { exportateur: memoire });
    const t1 = requete('/v1/dossiers/:dossierId/documents/:id', 201, { dossierId: CABINET, id: DOCUMENT, nom: INTERDITS.fichier });
    const t2 = requete(undefined, 404);
    const t3 = requete('/v1/imports', 500);
    // Identifiants de personnes : jamais repris, que le paramètre ou la route les désigne.
    requete('/v1/dossiers/:id/habilitations/:utilisateurId', 200, { id: DOCUMENT, utilisateurId: CABINET });
    requete('/v1/cabinet/membres/:id', 200, { id: CABINET });
    const spans = memoire.getFinishedSpans().slice(0, 3);
    const personnes = memoire.getFinishedSpans().slice(3);
    expect(personnes.map((s) => Object.keys(s.attributes).filter((c) => c.startsWith('comtaple.route.')))).toEqual([['comtaple.route.id'], []]);
    expect(JSON.stringify(personnes.map((s) => s.attributes))).not.toContain(CABINET);
    expect(spans.map((s) => s.name)).toEqual(['POST /v1/dossiers/:dossierId/documents/:id', 'POST inconnue', 'POST /v1/imports']);
    expect(spans.map((s) => s.spanContext().traceId)).toEqual([t1, t2, t3]);
    expect(new Set([t1, t2, t3]).size).toBe(3);
    expect(spans[0]!.kind).toBe(SpanKind.SERVER);
    expect(spans[0]!.attributes).toEqual({
      'http.request.method': 'POST',
      'http.route': '/v1/dossiers/:dossierId/documents/:id',
      'http.response.status_code': 201,
      'http.request.body.size': 321,
      'comtaple.route.dossierId': CABINET,
      'comtaple.route.id': DOCUMENT,
    });
    expect(spans[1]!.attributes['http.route']).toBe('inconnue');
    expect(spans[2]!.status.code).toBe(SpanStatusCode.ERROR);
    const transmis = JSON.stringify(spans.map((s) => [s.name, s.attributes]));
    for (const valeur of [INTERDITS.jeton, INTERDITS.adresse, INTERDITS.fichier, 'session=secret', '?q=']) expect(transmis).not.toContain(valeur);
  });

  it('un appel fetch sortant devient un span client enfant : hôte, port, code — jamais le chemin, les paramètres ni les en-têtes', async () => {
    const serveur = createServer((_req, res) => res.writeHead(204).end());
    const port = await ecouter(serveur);
    const memoire = new ExportateurMemoire();
    demarrerTraces('worker', CFG, { exportateur: memoire });
    try {
      await avecSpan('analyse', {}, async () => {
        const r = await fetch(`http://127.0.0.1:${port}/ocr/${INTERDITS.fichier}?jeton=${INTERDITS.jeton}`, { method: 'POST', headers: { authorization: `Bearer ${INTERDITS.jeton}` }, body: INTERDITS.libelle });
        await r.arrayBuffer();
      });
      // Le span client se termine à la fin de la réponse, signalée de façon asynchrone.
      await expect.poll(() => memoire.getFinishedSpans().length).toBe(2);
    } finally {
      await fermer(serveur);
    }
    const sortant = memoire.getFinishedSpans().find((s) => s.kind === SpanKind.CLIENT)!;
    const parent = memoire.getFinishedSpans().find((s) => s.name === 'analyse')!;
    expect(sortant.name).toBe('HTTP POST');
    expect(sortant.attributes).toEqual({ 'http.request.method': 'POST', 'server.address': '127.0.0.1', 'server.port': port, 'http.response.status_code': 204 });
    expect(sortant.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });
});

describe('traces : collecteur absent, lent ou en panne', () => {
  it('les pannes d’export sont journalisées une fois par période de panne, pas à chaque lot', () => {
    const issues = [ExportResultCode.FAILED, ExportResultCode.FAILED, ExportResultCode.FAILED, ExportResultCode.SUCCESS, ExportResultCode.SUCCESS, ExportResultCode.FAILED];
    const aval: SpanExporter = { export: (_s, rappel) => rappel({ code: issues.shift()! }), shutdown: async () => undefined };
    const journal: string[] = [];
    const filtrant = new ExportateurFiltrant(aval, (m) => journal.push(m));
    for (let i = 0; i < 6; i++) filtrant.export([], () => undefined);
    expect(journal).toHaveLength(3);
    expect(journal[0]).toMatch(/export impossible/);
    expect(journal[1]).toMatch(/rétabli/);
    expect(journal[2]).toMatch(/export impossible/);
  });

  it('point d’accès vers un port fermé : le travail aboutit sans ralentissement, un seul message, arrêt borné', async () => {
    const port = await portFerme();
    const journal: string[] = [];
    // Référence : le même travail, traces désactivées.
    const travail = async () => {
      for (let i = 0; i < 3_000; i++) await avecSpan('etape', { attributs: { 'comtaple.decompte': i } }, () => i);
    };
    let t = performance.now();
    await travail();
    const sansTraces = performance.now() - t;

    expect(demarrerTraces('api', { ...CFG, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` }, { journal: (m) => journal.push(m), delaiLotMs: 50 })).toBe(true);
    t = performance.now();
    await travail(); // 3 000 spans : au-delà de la file d'export (2 048), le surplus est abandonné sans attendre
    const avecTraces = performance.now() - t;
    // L'émission ne dépend pas du collecteur : quelques dizaines de millisecondes pour 3 000 spans, jamais un délai réseau.
    expect(avecTraces - sansTraces).toBeLessThan(1_000);

    await viderTraces();
    await avecSpan('encore', {}, () => undefined);
    await viderTraces();
    expect(journal.filter((m) => /export impossible/.test(m))).toHaveLength(1);
    expect(journal.join(' ')).not.toContain(String(port));

    t = performance.now();
    await avecSpan('dernier', {}, () => undefined);
    await arreterTraces();
    expect(performance.now() - t).toBeLessThan(7_000);
    expect(tracesActives()).toBe(false);
  }, 40_000);

  it('collecteur qui accepte la connexion mais ne répond jamais : l’arrêt reste borné et le travail n’attend pas', async () => {
    const muet = createServer(() => undefined); // ne répond jamais
    const port = await ecouter(muet);
    const journal: string[] = [];
    try {
      demarrerTraces('worker', { ...CFG, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}/` }, { journal: (m) => journal.push(m), delaiLotMs: 50 });
      let t = performance.now();
      for (let i = 0; i < 200; i++) await tracerTravail('documents', { name: 'analyser' }, () => i);
      expect(performance.now() - t).toBeLessThan(1_000);
      t = performance.now();
      await arreterTraces();
      expect(performance.now() - t).toBeLessThan(7_000);
      expect(journal.filter((m) => /export impossible/.test(m)).length).toBeLessThanOrEqual(1);
    } finally {
      await fermer(muet);
    }
  }, 40_000);

  it('collecteur présent : les spans arrivent en OTLP/HTTP sur /v1/traces, déjà filtrés', async () => {
    const recus: Array<{ chemin: string; type: string; corps: string }> = [];
    const collecteur = createServer((req, res) => {
      const morceaux: Buffer[] = [];
      req.on('data', (m: Buffer) => morceaux.push(m));
      req.on('end', () => {
        recus.push({ chemin: req.url ?? '', type: String(req.headers['content-type']), corps: Buffer.concat(morceaux).toString('utf8') });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    const port = await ecouter(collecteur);
    try {
      demarrerTraces('api', { ...CFG, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` }, { delaiLotMs: 50 });
      await avecSpan('depot', { attributs: { 'comtaple.cabinet.id': CABINET, nomFichier: INTERDITS.fichier, libelle: INTERDITS.libelle } }, () => undefined);
      await arreterTraces(); // l'arrêt vide les spans en attente
    } finally {
      await fermer(collecteur);
    }
    expect(recus).toHaveLength(1);
    expect(recus[0]!.chemin).toBe('/v1/traces');
    expect(recus[0]!.type).toBe('application/json');
    expect(recus[0]!.corps).toContain('comtaple-api');
    expect(recus[0]!.corps).toContain(CABINET);
    expect(recus[0]!.corps).not.toContain(INTERDITS.fichier);
    expect(recus[0]!.corps).not.toContain(INTERDITS.libelle);
  }, 20_000);
});
