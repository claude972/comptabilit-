/**
 * Rapporteur Playwright (D-159) : reprend à la FIN de la sortie le diagnostic de navigation écrit par `base.ts` pour les tests échoués, afin qu'il figure dans la fin de
 * sortie publiée en annotation par `scripts/ci-etape.sh`. Lecture seule ; rien n'est écrit hors sortie standard ; le fichier est supprimé après lecture.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { Reporter } from '@playwright/test/reporter';

const FICHIER = 'test-results/diagnostic-navigation.jsonl';

export default class DiagnosticNavigation implements Reporter {
  onBegin(): void {
    if (existsSync(FICHIER)) rmSync(FICHIER);
  }
  onEnd(): void {
    if (!existsSync(FICHIER)) return;
    const lignes = readFileSync(FICHIER, 'utf8').split('\n').filter(Boolean);
    rmSync(FICHIER);
    const sortie = ['', `DIAGNOSTIC NAVIGATION (${lignes.length} test(s) échoué(s) ; chemins sans requête, aucun en-tête ni corps)`];
    for (const l of lignes.slice(0, 4)) {
      try {
        const d = JSON.parse(l) as { test: string; projet: string; pages: Array<{ url?: string; etat?: string; hydrate?: string; clics?: unknown[]; evenements?: unknown[]; fermee?: boolean }> };
        sortie.push(`# ${d.projet} ${d.test}`);
        for (const p of d.pages) sortie.push(JSON.stringify({ url: p.url, etat: p.etat, hydrate: p.hydrate, clics: (p.clics ?? []).slice(-3), evenements: (p.evenements ?? []).slice(-8) }));
      } catch {
        sortie.push(l.slice(0, 300));
      }
    }
    process.stdout.write(`${sortie.join('\n')}\n`);
  }
}
