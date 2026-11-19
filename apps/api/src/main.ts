import { chargerEnvLocal } from '@comtaple/db/env';
import type { Config } from '@comtaple/plateforme';
import { creerApplication } from './demarrage.js';
import { CONFIG } from './jetons.js';

chargerEnvLocal();
const app = await creerApplication();
const cfg = app.get<Config>(CONFIG);
await app.listen(cfg.API_PORT, cfg.API_HOTE);
console.log(`API Comtaple à l'écoute sur http://${cfg.API_HOTE}:${cfg.API_PORT} (documentation : /docs)`);
