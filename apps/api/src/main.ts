import { chargerEnvLocal } from '@comtaple/db/env';
import type { Config } from '@comtaple/plateforme';
import { creerApplication } from './demarrage.js';
import { CONFIG } from './jetons.js';

chargerEnvLocal();
const app = await creerApplication();
const cfg = app.get<Config>(CONFIG);
await app.listen(cfg.API_PORT, '127.0.0.1');
console.log(`API Comtaple à l'écoute sur http://127.0.0.1:${cfg.API_PORT} (documentation : /docs)`);
