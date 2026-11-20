/**
 * Table `factures` (créée au lot initial, migration 0000) : OBSOLÈTE, jamais alimentée (D-096). Elle n'est PAS supprimée
 * (aucune suppression d'objet de la base) mais aucun code ne doit l'alimenter ni la lire : les factures, leur lien avec les
 * écritures, les règlements et les restes dus sont RECALCULÉS à la lecture (D-077) ; seules les décisions humaines sont
 * stockées (`liens_factures`). Ce garde-fou échoue si du code écrit dans cette table ou la lit.
 *
 * Il parcourt le code source (applications, paquets, scripts d'exploitation), hors tests, migrations et documentation.
 * Pour la rendre un jour utile, il faudra une décision explicite (D-xxx) qui retire ce garde-fou : un test qui échoue ici
 * n'est pas à contourner, il signale qu'un second mécanisme de stockage des factures est en train de naître.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXTENSIONS = /\.(?:ts|tsx|mjs|js|sh|sql)$/;
const IGNORES = new Set(['node_modules', 'dist', '.next', 'var', 'test-results', 'migrations', '.git']);

function parcourir(dossier: string, sortie: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    const s = statSync(chemin);
    if (s.isDirectory()) parcourir(chemin, sortie);
    else if (EXTENSIONS.test(nom) && !/\.(?:test|itest|spec)\.(?:ts|tsx)$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}
const sources = (): string[] => ['apps', 'packages', 'scripts', 'infra'].flatMap((d) => {
  try {
    return parcourir(join(racine, d));
  } catch {
    return [];
  }
});

/** Façons d'écrire dans la table ou de la lire : objet Drizzle, import nommé de la table, SQL. */
const MOTIFS: Array<{ nom: string; re: RegExp }> = [
  { nom: 'objet Drizzle s.factures / schema.factures', re: /\b(?:s|schema)\.factures\b/ },
  { nom: 'import nommé de la table « factures » depuis le schéma', re: /import\s*(?:type\s*)?{[^}]*\bfactures\b[^}]*}\s*from\s*['"][^'"]*schema[^'"]*['"]/ },
  { nom: 'SQL sur la table factures', re: /\b(?:insert\s+into|update|delete\s+from|from|join|truncate(?:\s+table)?|copy)\s+(?:public\.)?"?factures"?(?![\w-])/i },
];

describe('table « factures » obsolète : aucun code ne l’alimente ni ne la lit (D-096)', () => {
  it('le parcours voit bien le code de l’application (le garde-fou n’est pas vide)', () => {
    const fichiers = sources().map((f) => relative(racine, f));
    expect(fichiers.length).toBeGreaterThan(200);
    expect(fichiers).toContain('packages/db/src/schema.ts');
    expect(fichiers).toContain('apps/api/src/tiers.controller.ts');
  });

  it('aucun fichier ne contient d’écriture ni de lecture de la table', () => {
    const trouves: string[] = [];
    for (const f of sources()) {
      const rel = relative(racine, f);
      const texte = readFileSync(f, 'utf8');
      for (const m of MOTIFS) if (m.re.test(texte)) trouves.push(`${rel} : ${m.nom}`);
    }
    expect(trouves, 'du code utilise la table obsolète « factures » : voir docs/decisions.md, D-096').toEqual([]);
  });

  it('la table n’est DÉFINIE qu’une fois, dans le schéma, et ne figure à la politique de fin de contrat que pour mémoire', () => {
    const schema = readFileSync(join(racine, 'packages/db/src/schema.ts'), 'utf8');
    expect(schema.match(/pgTable\(\s*'factures'/g)).toHaveLength(1);
    // Le motif de détection reconnaît bien ce qu'il doit refuser (sinon le garde-fou ne garderait rien).
    for (const interdit of ['await tx.insert(s.factures).values({})', 'insert into factures (id) values (1)', 'select * from public.factures', 'delete from "factures"', "import { factures } from '@comtaple/db/schema'"]) {
      expect(MOTIFS.some((m) => m.re.test(interdit)), interdit).toBe(true);
    }
    for (const permis of ['liens_factures', 'select * from liens_factures', 's.liensFactures', 'const factures = c.resultat.factures', "from 'factures-extraites'", 'des factures extraites']) {
      expect(MOTIFS.some((m) => m.re.test(permis)), permis).toBe(false);
    }
  });
});
