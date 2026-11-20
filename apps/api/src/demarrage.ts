import 'reflect-metadata';
import { type ArgumentsHost, Catch, type INestApplication, Logger } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { type Config, intergicielTraces, Metriques } from '@comtaple/plateforme';
import express from 'express';
import { AppModule } from './app.module.js';
import { codeSql, MESSAGES_PANNE, panneDeDependance } from './pannes.js';
import { CONFIG } from './jetons.js';

/**
 * Panne d'une dépendance (file des travaux, stockage objet, base) : réponse 503 explicite et bornée dans le temps, jamais un
 * 500 muet ni un détail technique. Les autres erreurs inattendues suivent le comportement par défaut (500 générique, consigné).
 */
@Catch()
export class FiltreDependances extends BaseExceptionFilter {
  private readonly journal = new Logger('Dependances');
  override catch(e: unknown, hote: ArgumentsHost) {
    const reponse = hote.switchToHttp().getResponse();
    // Actions simultanées : une contrainte d'unicité ou d'exclusion qui saute est un CONFLIT (409), pas une panne ; un
    // interblocage ou une sérialisation refusée se réessaie (503).
    const sqlstate = codeSql(e);
    if (sqlstate === '23505' || sqlstate === '23P01') {
      return void reponse.status(409).json({ statusCode: 409, error: 'Conflict', message: 'Conflit : un enregistrement identique ou incompatible vient d’être créé par une action simultanée. Rechargez la page puis recommencez si nécessaire.' });
    }
    if (sqlstate === '40001' || sqlstate === '40P01') {
      return void reponse.status(503).set('Retry-After', '2').json({ statusCode: 503, error: 'Service Unavailable', message: 'Accès simultané : l’opération a été refusée sans effet. Réessayez dans un instant.' });
    }
    const panne = panneDeDependance(e);
    if (!panne) return super.catch(e, hote);
    this.journal.warn(`dépendance indisponible (${panne}) : ${e instanceof Error ? e.message.slice(0, 160) : 'erreur'}`);
    reponse.status(503).set('Retry-After', '30').json({ statusCode: 503, error: 'Service Unavailable', message: MESSAGES_PANNE[panne] });
  }
}

export function documentOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Comtaple — API métier')
    .setDescription(
      'API REST de collecte, de contrôle et de révision. Les montants sont transportés sous forme de chaînes décimales. ' +
        'Toute production non validée par un professionnel habilité est un projet.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export async function creerApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
  const cfg = app.get<Config>(CONFIG);
  app.useGlobalFilters(new FiltreDependances(app.get(HttpAdapterHost).httpAdapter));
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  // Métriques techniques : étiquetées par GABARIT de route (jamais par identifiant), servies sur un port local séparé.
  const metriques = new Metriques('api');
  metriques.servir(cfg.METRIQUES_PORT_API, cfg.METRIQUES_HOTE);
  // Trace : un span par requête, nommé par le gabarit de route (sans effet si les traces ne sont pas actives).
  http.use(intergicielTraces());
  http.use((req, res, suite) => {
    const debut = process.hrtime.bigint();
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? (res.statusCode === 404 ? 'inconnue' : 'autre');
      metriques.requetes.inc({ methode: req.method, route, code: String(res.statusCode) });
      metriques.dureeRequetes.observe({ methode: req.method, route }, Number(process.hrtime.bigint() - debut) / 1e9);
    });
    suite();
  });
  // Les morceaux de fichiers arrivent en binaire brut, bornés par la taille de morceau ; le reste de l'API est en JSON borné.
  http.use('/v1/televersements', express.raw({ type: 'application/octet-stream', limit: cfg.TAILLE_MORCEAU }));
  // Reprise des immobilisations (D-092) : le fichier (5 Mio au plus) arrive en Base64 dans un corps JSON ; borne propre à ces deux routes.
  http.use(/^\/v1\/dossiers\/[^/]+\/reprises-immobilisations(\/apercu)?\/?$/, express.json({ limit: '9mb' }));
  http.use(express.json({ limit: '256kb' }));
  app.enableCors({ origin: [cfg.WEB_URL], allowedHeaders: ['authorization', 'content-type', 'x-cabinet-id'], maxAge: 600 });
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, documentOpenApi(app));
  return app;
}
