import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Charge le fichier .env de la racine du dépôt (outillage local uniquement ; n'écrase pas l'environnement existant). */
export function chargerEnvLocal(): void {
  let dossier = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const chemin = join(dossier, '.env');
    if (existsSync(chemin) && existsSync(join(dossier, 'pnpm-workspace.yaml'))) {
      for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(ligne.trim());
        if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
      }
      return;
    }
    dossier = dirname(dossier);
  }
}
