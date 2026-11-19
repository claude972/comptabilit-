import { chargerEnvLocal } from '@comtaple/db/env';
import { demarrerTraces, lireConfig, type Config } from '@comtaple/plateforme';
import { creerApplication } from './demarrage.js';
import { CONFIG } from './jetons.js';

chargerEnvLocal();
// Traces OpenTelemetry : sans OTEL_EXPORTER_OTLP_ENDPOINT, cet appel ne fait rien. Aucun module n'est modifié au
// chargement (spans posés à la main) : l'ordre des imports est donc sans effet sur l'instrumentation.
if (demarrerTraces('api', lireConfig())) console.log('Traces OpenTelemetry actives (export OTLP/HTTP).');
const app = await creerApplication();
const cfg = app.get<Config>(CONFIG);
await app.listen(cfg.API_PORT, cfg.API_HOTE);
console.log(`API Comtaple à l'écoute sur http://${cfg.API_HOTE}:${cfg.API_PORT} (documentation : /docs)`);
