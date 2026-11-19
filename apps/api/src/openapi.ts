/** Écrit docs/openapi.json à partir de l'application réelle (aucune documentation rédigée à la main). */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerEnvLocal } from '@comtaple/db/env';
import { creerApplication, documentOpenApi } from './demarrage.js';

chargerEnvLocal();
const app = await creerApplication();
const cible = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'openapi.json');
writeFileSync(cible, JSON.stringify(documentOpenApi(app), null, 2));
console.log(`OpenAPI écrit : ${cible}`);
await app.close();
process.exit(0);
