import { describe, expect, it } from 'vitest';
import { argumentsDockerRun, ETIQUETTE, type ParametresConteneur } from './analyse-conteneur.js';
import { argumentsEnfant, ENTREE_ENFANT_IMAGE, isolementDepuisConfig, LIMITES_PAR_DEFAUT } from './analyse-isolee.js';

const P: ParametresConteneur = { image: 'comtaple-analyse:dev', docker: 'docker', hote: '', cpus: 1, pidsMax: 64, tmpfsMo: 64 };
const UUID = '11111111-2222-4333-8444-555555555555';
const ligne = (p = P) => argumentsDockerRun(p, { dureeMaxMs: 60_000, memoireMaxMo: 1024 }, UUID, argumentsEnfant(LIMITES_PAR_DEFAUT, ENTREE_ENFANT_IMAGE, [], true));

describe('conteneur d’analyse : options de sécurité imposées (D-098)', () => {
  const a = ligne();
  const apres = (option: string) => a[a.indexOf(option) + 1];

  it('impose réseau coupé, aucune capacité, pas d’élévation, non root, racine en lecture seule, tmpfs et ressources bornés', () => {
    expect(apres('--network')).toBe('none');
    expect(apres('--cap-drop')).toBe('ALL');
    expect(a).toContain('no-new-privileges');
    expect(apres('--user')).toBe('65532:65532');
    expect(a).toContain('--read-only');
    expect(apres('--tmpfs')).toMatch(/^\/tmp:rw,noexec,nosuid,nodev,size=64m/);
    expect(apres('--pids-limit')).toBe('64');
    expect(apres('--memory')).toBe('1024m');
    expect(apres('--memory-swap')).toBe('1024m');
    expect(apres('--cpus')).toBe('1');
    expect(apres('--pull')).toBe('never');
    expect(apres('--ipc')).toBe('none');
    expect(apres('--entrypoint')).toBe('node');
  });

  it('nomme et étiquette le conteneur par l’uuid de l’analyse', () => {
    expect(apres('--name')).toBe(`comtaple-analyse-${UUID}`);
    expect(a).toContain(`${ETIQUETTE}=${UUID}`);
    expect(a.some((x) => x.startsWith('comtaple.analyse.expire='))).toBe(true);
  });

  it('n’ouvre jamais ce qui ferait sortir le conteneur de son cadre : ni privilèges, ni socket, ni montage, ni variable, ni réseau, ni profil relâché', () => {
    // Comparaison par ARGUMENT entier (« --pid » n'est pas « --pids-limit »), puis par sous-chaîne pour les valeurs.
    for (const interdit of ['--privileged', '--volume', '--mount', '--env', '--env-file', '--device', '--pid', '--userns', '--cap-add', '--net', '--publish', '--add-host', '--dns', '--group-add', '--security-opt=seccomp=unconfined']) {
      expect(a, interdit).not.toContain(interdit);
    }
    for (const motif of ['docker.sock', 'unconfined', 'host', 'privileged']) expect(a.join(' '), motif).not.toContain(motif);
    expect(a).not.toContain('-v');
    expect(a).not.toContain('-e');
    expect(a).not.toContain('-p');
    expect(a).not.toContain('-d');
  });

  it('les paramètres variables sont des nombres bornés : une valeur extrême est ramenée dans la plage', () => {
    const extreme = argumentsDockerRun({ ...P, cpus: 9999, pidsMax: 10 ** 9, tmpfsMo: 10 ** 9 }, { dureeMaxMs: 1, memoireMaxMo: 10 ** 9 }, UUID, []);
    expect(extreme[extreme.indexOf('--cpus') + 1]).toBe('8');
    expect(extreme[extreme.indexOf('--pids-limit') + 1]).toBe('1024');
    expect(extreme[extreme.indexOf('--memory') + 1]).toBe('16384m');
    expect(() => argumentsDockerRun({ ...P, cpus: Number.NaN }, { dureeMaxMs: 1, memoireMaxMo: 100 }, UUID, [])).toThrow();
  });

  it('l’enfant dans l’image lit uniquement /app (code et dépendances) ; aucune écriture ni autre chemin', () => {
    const args = argumentsEnfant(LIMITES_PAR_DEFAUT, ENTREE_ENFANT_IMAGE, [], true);
    const lectures = args.filter((x) => x.startsWith('--allow-fs-read='));
    expect(lectures.length).toBeGreaterThan(0);
    for (const l of lectures) expect(l.startsWith('--allow-fs-read=/app/')).toBe(true);
    expect(args.some((x) => x.startsWith('--allow-fs-write'))).toBe(false);
    expect(args).toContain('--permission');
    expect(args).toContain('--disallow-code-generation-from-strings');
  });

  it('mode par défaut : processus (aucune option de conteneur dans la configuration par défaut)', () => {
    const base = { ANALYSE_ISOLATION: 'processus' as const, ANALYSE_CONTENEUR_IMAGE: 'x', ANALYSE_CONTENEUR_DOCKER: 'docker', ANALYSE_CONTENEUR_HOTE: '', ANALYSE_CONTENEUR_CPUS: 1, ANALYSE_CONTENEUR_PIDS: 64, ANALYSE_CONTENEUR_TMPFS_MO: 64 };
    expect(isolementDepuisConfig(base)).toEqual({});
    expect(isolementDepuisConfig({ ...base, ANALYSE_ISOLATION: 'conteneur' })).toMatchObject({ isolation: 'conteneur', conteneur: { image: 'x' } });
  });
});
