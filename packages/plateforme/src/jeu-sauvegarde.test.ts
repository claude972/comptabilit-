import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chiffrerFichier, dechiffrerFichier, genererPaireDeCles } from './chiffrement-fichiers.js';
import { FORMAT_JEU, type JeuDeSauvegarde, listerJeux, verifierJeu } from './jeu-sauvegarde.js';

const racine = mkdtempSync(join(tmpdir(), 'jeu-'));
afterAll(() => rmSync(racine, { recursive: true, force: true }));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let n = 0;

/** Fabrique un jeu complet et cohérent dans un dossier neuf (copies isolées : aucune sauvegarde réelle n'est touchée). */
function fabriquer(identifiant = 'comtaple-20260101-000000') {
  const dossier = join(racine, `jeu-${++n}`);
  mkdirSync(dossier);
  const fichiers = (['base', 'objets', 'keycloak'] as const).map((role) => {
    const nom = `${identifiant}.${{ base: 'dump', objets: 'objets.json', keycloak: 'keycloak.json' }[role]}`;
    const contenu = randomBytes(2000 + n);
    writeFileSync(join(dossier, nom), contenu);
    return { role, nom, taille: contenu.length, sha256: sha(contenu) };
  });
  const jeu: JeuDeSauvegarde = {
    format: FORMAT_JEU,
    identifiant,
    cree: '2026-01-01T00:00:10.000Z',
    fichiers,
    coherence: { instantaneBase: '2026-01-01T00:00:00.500Z', keycloakFigeDe: '2026-01-01T00:00:00.000Z', keycloakFigeA: '2026-01-01T00:00:01.000Z', comptesBase: 5, comptesBaseDansKeycloak: 5, garanties: [], limites: [] },
  };
  const descripteur = join(dossier, `${identifiant}.jeu.json`);
  writeFileSync(descripteur, JSON.stringify(jeu));
  return { dossier, descripteur, jeu };
}

describe('jeu de sauvegarde : refus', () => {
  it('un jeu complet et intact est conforme', async () => {
    const { descripteur } = fabriquer();
    expect(await verifierJeu(descripteur)).toEqual({ conforme: true, identifiant: 'comtaple-20260101-000000', ecarts: [] });
  });

  it('sauvegarde interrompue (pas de descripteur) : refusée, et listée comme telle', async () => {
    const { dossier, descripteur } = fabriquer('comtaple-20260102-000000');
    rmSync(descripteur);
    expect(await verifierJeu(descripteur)).toMatchObject({ conforme: false, ecarts: [expect.stringMatching(/interrompue ou incomplète/)] });
    expect(listerJeux(dossier)).toEqual([{ identifiant: 'comtaple-20260102-000000', etat: 'interrompu' }]);
    // Une ancienne sauvegarde (base et objets seulement, sans Keycloak ni descripteur) n'est pas une interruption.
    rmSync(join(dossier, 'comtaple-20260102-000000.keycloak.json'));
    expect(listerJeux(dossier)).toEqual([{ identifiant: 'comtaple-20260102-000000', etat: 'ancien_format' }]);
  });

  it('fichier manquant, tronqué ou altéré : refusé, en nommant le fichier', async () => {
    for (const [nom, action, attendu] of [
      ['comtaple-20260101-000000.keycloak.json', (c: string) => rmSync(c), /fichier manquant : .*keycloak/],
      ['comtaple-20260101-000000.dump', (c: string) => writeFileSync(c, readFileSync(c).subarray(0, 100)), /taille différente : .*dump/],
      ['comtaple-20260101-000000.objets.json', (c: string) => { const b = readFileSync(c); b[10]! ^= 1; writeFileSync(c, b); }, /empreinte différente : .*objets/],
    ] as const) {
      const { dossier, descripteur } = fabriquer();
      action(join(dossier, nom));
      const r = await verifierJeu(descripteur);
      expect(r.conforme).toBe(false);
      expect(r.ecarts).toEqual([expect.stringMatching(attendu)]);
    }
  });

  it('on ne complète pas un jeu avec l’export Keycloak d’un autre jeu', async () => {
    const a = fabriquer('comtaple-20260103-000000');
    const b = fabriquer('comtaple-20260104-000000');
    // L'export de B est copié à la place de celui de A, sous le nom attendu par A : l'empreinte ne correspond pas.
    copyFileSync(join(b.dossier, 'comtaple-20260104-000000.keycloak.json'), join(a.dossier, 'comtaple-20260103-000000.keycloak.json'));
    expect((await verifierJeu(a.descripteur)).ecarts).toEqual([expect.stringMatching(/différente : comtaple-20260103-000000\.keycloak\.json/)]);
    // Descripteur réécrit pour désigner le fichier de B : refusé comme étranger au jeu.
    const jeu = { ...a.jeu, fichiers: a.jeu.fichiers.map((f) => (f.role === 'keycloak' ? { ...b.jeu.fichiers[2]! } : f)) };
    writeFileSync(a.descripteur, JSON.stringify(jeu));
    expect((await verifierJeu(a.descripteur)).ecarts).toEqual([expect.stringMatching(/fichier étranger au jeu : comtaple-20260104-000000\.keycloak\.json/)]);
    // Un jeu sans export Keycloak, ou avec un chemin qui sort du dossier, n'est pas un jeu.
    writeFileSync(a.descripteur, JSON.stringify({ ...a.jeu, fichiers: a.jeu.fichiers.filter((f) => f.role !== 'keycloak') }));
    expect((await verifierJeu(a.descripteur)).ecarts).toEqual([expect.stringMatching(/exactement un fichier « keycloak »/)]);
    writeFileSync(a.descripteur, JSON.stringify({ ...a.jeu, fichiers: a.jeu.fichiers.map((f) => (f.role === 'base' ? { ...f, nom: '../ailleurs.dump' } : f)) }));
    expect((await verifierJeu(a.descripteur)).conforme).toBe(false);
    writeFileSync(a.descripteur, JSON.stringify({ ...a.jeu, format: 'autre' }));
    expect((await verifierJeu(a.descripteur)).ecarts).toEqual(['format de jeu inconnu : autre']);
  });
});

describe('chiffrement : interruption et reprise', () => {
  const cles = genererPaireDeCles();

  it('une écriture interrompue ne laisse aucun fichier chiffré sous son nom définitif ; la reprise aboutit', async () => {
    const dossier = join(racine, `reprise-${++n}`);
    mkdirSync(dossier);
    const clair = randomBytes(3 * (1 << 20) + 17);
    writeFileSync(join(dossier, 'base.dump'), clair);
    // Reste d'une exécution interrompue : un fichier partiel, tronqué.
    writeFileSync(join(dossier, 'base.dump.chiffre.partiel'), randomBytes(5000));
    // Chiffrement qui échoue (source illisible) : rien sous le nom définitif, pas de partiel laissé.
    await expect(chiffrerFichier(join(dossier, 'absent.dump'), join(dossier, 'absent.dump.chiffre'), cles.clePubliquePem)).rejects.toThrow();
    expect(readdirSync(dossier).sort()).toEqual(['base.dump', 'base.dump.chiffre.partiel']);
    // Reprise : le partiel périmé est remplacé, le fichier définitif est complet et se déchiffre à l'identique.
    await chiffrerFichier(join(dossier, 'base.dump'), join(dossier, 'base.dump.chiffre'), cles.clePubliquePem);
    expect(readdirSync(dossier).sort()).toEqual(['base.dump', 'base.dump.chiffre']);
    expect((await dechiffrerFichier(join(dossier, 'base.dump.chiffre'), null, cles.clePriveePem)).sha256Clair).toBe(sha(clair));
    // Un fichier définitif existant n'est jamais écrasé par une nouvelle exécution.
    await expect(chiffrerFichier(join(dossier, 'base.dump'), join(dossier, 'base.dump.chiffre'), cles.clePubliquePem)).rejects.toThrow(/EEXIST/);
  });

  it('un déchiffrement refusé (fichier altéré, mauvaise clé) ne laisse aucun fichier de sortie, même partiel', async () => {
    const dossier = join(racine, `refus-${++n}`);
    mkdirSync(dossier);
    writeFileSync(join(dossier, 'k.json'), randomBytes(2 * (1 << 20) + 5));
    await chiffrerFichier(join(dossier, 'k.json'), join(dossier, 'k.json.chiffre'), cles.clePubliquePem);
    const altere = readFileSync(join(dossier, 'k.json.chiffre'));
    altere[altere.length - 100]! ^= 1; // dans le DERNIER bloc : les premiers blocs se déchiffrent avant l'échec
    writeFileSync(join(dossier, 'altere.chiffre'), altere);
    await expect(dechiffrerFichier(join(dossier, 'altere.chiffre'), join(dossier, 'sortie.json'), cles.clePriveePem)).rejects.toThrow(/altérée/);
    await expect(dechiffrerFichier(join(dossier, 'k.json.chiffre'), join(dossier, 'sortie.json'), genererPaireDeCles().clePriveePem)).rejects.toThrow(/autre clé/);
    expect(existsSync(join(dossier, 'sortie.json'))).toBe(false);
    expect(readdirSync(dossier).some((f) => f.includes('partiel'))).toBe(false);
    // Reprise avec le bon fichier et la bonne clé : la sortie est produite.
    await dechiffrerFichier(join(dossier, 'k.json.chiffre'), join(dossier, 'sortie.json'), cles.clePriveePem);
    expect(readFileSync(join(dossier, 'sortie.json')).equals(readFileSync(join(dossier, 'k.json')))).toBe(true);
  });
});
