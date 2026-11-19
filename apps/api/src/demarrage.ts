import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { type Config, Metriques } from '@comtaple/plateforme';
import express from 'express';
import { AppModule } from './app.module.js';
import { CONFIG } from './jetons.js';

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
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  // Métriques techniques : étiquetées par GABARIT de route (jamais par identifiant), servies sur un port local séparé.
  const metriques = new Metriques('api');
  metriques.servir(cfg.METRIQUES_PORT_API, cfg.METRIQUES_HOTE);
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
  http.use(express.json({ limit: '256kb' }));
  app.enableCors({ origin: [cfg.WEB_URL], allowedHeaders: ['authorization', 'content-type', 'x-cabinet-id'], maxAge: 600 });
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, documentOpenApi(app));
  return app;
}
