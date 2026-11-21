import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lireConfig } from './config.js';
import {
  controlerCertificat,
  controlerConfiguration,
  controlerMemoire,
  lireMeminfo,
  controlerSauvegardes,
  controlerVolume,
  lireDfPk,
  messageRefusProduction,
  rendre,
  secretFaible,
  synthese,
  violationsProduction,
} from './preparation.js';

const alea = (n: number, graine = 7) => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += createHash('sha256').update(`${graine}-${i}`).digest('base64url');
  return s.slice(0, n);
};

const prod = (): Record<string, string> => ({
  NODE_ENV: 'production',
  PG_HOST: 'pg.interne.exploitation.fr',
  PG_PORT: '20184',
  PG_APP_PASSWORD: alea(32, 1),
  PG_WORKER_PASSWORD: alea(32, 2),
  REDIS_URL: `redis://:${alea(32, 3)}@redis:6379`,
  REDIS_PASSWORD: alea(32, 3),
  S3_ENDPOINT: 'https://s3.gra.io.cloud.ovh.net',
  S3_BUCKET: 'comtaple-production-documents',
  S3_ACCESS_KEY: alea(20, 4),
  S3_SECRET_KEY: alea(40, 5),
  OIDC_ISSUER: 'https://auth.cabinet.fr/realms/comtaple',
  OIDC_CLIENT_SECRET: alea(40, 6),
  WEB_URL: 'https://app.cabinet.fr',
  SESSION_SECRET: alea(48, 8),
  JETONS_CLE_CHIFFREMENT: alea(43, 9),
  REDIS_URL_PLACEHOLDER: '',
});

describe('configuration de production', () => {
  it('une configuration de production saine ne déclenche aucune violation', () => {
    expect(violationsProduction(prod())).toEqual([]);
    expect(messageRefusProduction(prod())).toBeNull();
    expect(controlerConfiguration(prod(), 'production').every((c) => c.etat === 'PRET')).toBe(true);
  });

  it('refuse chaque valeur de développement, en nommant la variable et jamais sa valeur', () => {
    const cas: Array<[string, Record<string, string>]> = [
      ['OIDC_ISSUER', { OIDC_ISSUER: 'http://localhost:8080/realms/comtaple' }],
      ['S3_ENDPOINT', { S3_ENDPOINT: 'http://127.0.0.1:8333' }],
      ['WEB_URL', { WEB_URL: 'http://localhost:3100' }],
      ['PG_HOST', { PG_HOST: '127.0.0.1' }],
      ['S3_BUCKET', { S3_BUCKET: 'comtaple-dev' }],
      ['DEV_MDP_UTILISATEURS', { DEV_MDP_UTILISATEURS: 'x' }],
      ['MAIL_SIMULATEUR_URL', { MAIL_SIMULATEUR_URL: 'http://127.0.0.1:9' }],
      ['ANTIVIRUS_OBLIGATOIRE', { ANTIVIRUS_OBLIGATOIRE: 'false' }],
      ['SESSION_SECRET', { SESSION_SECRET: 'Zq8Wk2' }],
      ['JETONS_CLE_CHIFFREMENT', { JETONS_CLE_CHIFFREMENT: 'factice-secret-des-jetons-de-quarante-trois-caracteres' }],
      ['PG_APP_PASSWORD', { PG_APP_PASSWORD: 'a'.repeat(40) }],
      ['NODE_ENV', { NODE_ENV: 'development' }],
    ];
    for (const [variable, surcharge] of cas) {
      const env = { ...prod(), ...surcharge };
      const vs = violationsProduction(env);
      expect(vs.some((x) => x.variables.includes(variable)), variable).toBe(true);
      const valeur = Object.values(surcharge)[0]!;
      expect(JSON.stringify(controlerConfiguration(env, 'production'))).not.toContain(valeur);
      expect(controlerConfiguration(env, 'production').some((c) => c.etat === 'MANQUANT'), variable).toBe(true);
    }
  });

  it('une variable requise absente est MANQUANTE avec son action ; la forme « production.env » est reconnue', () => {
    const env = prod();
    delete env.SESSION_SECRET;
    const c = controlerConfiguration(env, 'production').find((x) => x.nom.includes('session'))!;
    expect(c.etat).toBe('MANQUANT');
    expect(c.action).toContain('SESSION_SECRET');
    const composition = { ...prod(), OIDC_ISSUER: undefined, WEB_URL: undefined, REDIS_URL: undefined, DOMAINE_AUTH: 'auth.cabinet.fr', DOMAINE_WEB: 'app.cabinet.fr' };
    expect(controlerConfiguration(composition, 'production').filter((x) => x.etat === 'MANQUANT')).toEqual([]);
  });

  it('en cible locale, les valeurs de développement sont NON VÉRIFIÉES (jamais MANQUANTES)', () => {
    const local = { ...prod(), NODE_ENV: '', OIDC_ISSUER: 'http://localhost:8080/realms/comtaple', S3_ENDPOINT: 'http://127.0.0.1:8333' };
    const cs = controlerConfiguration(local, 'local');
    expect(cs.filter((c) => c.etat === 'MANQUANT')).toEqual([]);
    expect(cs.some((c) => c.etat === 'NON_VERIFIE' && c.motif.includes('REFUSÉ au démarrage en production'))).toBe(true);
  });

  it('secretFaible : longueur, répétition, marqueur factice', () => {
    expect(secretFaible('abc', 10)).toMatch(/moins de/);
    expect(secretFaible('ab'.repeat(30), 10)).toMatch(/distincts/);
    expect(secretFaible(`${alea(30)}factice${alea(10)}`, 10)).toMatch(/factice/);
    expect(secretFaible(alea(40), 32)).toBeNull();
  });
});

describe('démarrage : lireConfig en production', () => {
  const base = (): Record<string, string> => ({ ...prod(), OIDC_AUDIENCE: 'comtaple-api' });
  it('démarre avec une configuration saine', () => {
    expect(() => lireConfig(base())).not.toThrow();
  });
  it('refuse une valeur de développement sans l’afficher, mais l’accepte hors production', () => {
    const env = { ...base(), OIDC_ISSUER: 'http://localhost:8080/realms/secretvisible' };
    expect(() => lireConfig(env)).toThrow(/OIDC_ISSUER/);
    try {
      lireConfig(env);
    } catch (e) {
      expect(String(e)).not.toContain('secretvisible');
    }
    expect(() => lireConfig({ ...env, NODE_ENV: 'test' })).not.toThrow();
    expect(() => lireConfig({ ...base(), SESSION_SECRET: undefined as unknown as string, JETONS_CLE_CHIFFREMENT: 'court' })).toThrow(/JETONS_CLE_CHIFFREMENT/);
  });
});

describe('disque', () => {
  const Go = 2 ** 30;
  it('seuils en octets et en pourcentage', () => {
    const s = { libreMinOctets: 8 * Go, libreMinPourcent: 10 };
    expect(controlerVolume('v', 'D', 30 * Go, 80 * Go, s, 'a').etat).toBe('PRET');
    expect(controlerVolume('v', 'D', 5 * Go, 80 * Go, s, 'a').etat).toBe('MANQUANT');
    expect(controlerVolume('v', 'D', 9 * Go, 200 * Go, s, 'a').etat).toBe('MANQUANT');
  });
  it('lit df -Pk', () => {
    const r = lireDfPk('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vdb1 82000000 48000000 30000000 62% /mnt\n');
    expect(r).toEqual({ totalOctets: 82000000 * 1024, libreOctets: 30000000 * 1024 });
    expect(lireDfPk('rien')).toBeNull();
  });
});

describe('sauvegardes', () => {
  const maintenant = Date.parse('2026-11-20T12:00:00Z');
  const p = { maintenantMs: maintenant, ageMaxHeures: 26, clePubliqueConfiguree: false, integrite: { conforme: true, ecarts: [] } };
  const jeu = (id: string, h: number, extra = {}) => ({ id, crealeMs: maintenant - h * 3_600_000, complet: true, interrompu: false, chiffre: false, ...extra });
  const etat = (cs: ReturnType<typeof controlerSauvegardes>, nom: string) => cs.find((c) => c.nom === nom)?.etat;

  it('aucun jeu complet : MANQUANT', () => {
    expect(controlerSauvegardes([], p)[0]!.etat).toBe('MANQUANT');
  });
  it('jeu récent, intègre, chiffré : tout PRÊT', () => {
    const cs = controlerSauvegardes([jeu('a', 3, { chiffre: true })], p);
    expect(cs.every((c) => c.etat === 'PRET')).toBe(true);
  });
  it('âge dépassé, clair, empreintes en écart, interruption plus récente : MANQUANT', () => {
    const cs = controlerSauvegardes(
      [jeu('vieux', 40), { id: 'casse', crealeMs: maintenant - 3_600_000, complet: false, interrompu: true, chiffre: false }],
      { ...p, integrite: { conforme: false, ecarts: ['empreinte de la base différente'] } },
    );
    expect(etat(cs, 'Âge de la dernière sauvegarde')).toBe('MANQUANT');
    expect(etat(cs, 'Intégrité du dernier jeu')).toBe('MANQUANT');
    expect(etat(cs, 'Chiffrement')).toBe('MANQUANT');
    expect(etat(cs, 'Sauvegarde interrompue')).toBe('MANQUANT');
  });
  it('interruption ancienne : PRÊT avec mention ; intégrité non faite : NON VÉRIFIÉ', () => {
    const cs = controlerSauvegardes([jeu('a', 2), { id: 'ancien', crealeMs: maintenant - 90 * 3_600_000, complet: false, interrompu: true, chiffre: false }], { ...p, integrite: null, clePubliqueConfiguree: true });
    expect(etat(cs, 'Sauvegarde interrompue')).toBe('PRET');
    expect(etat(cs, 'Intégrité du dernier jeu')).toBe('NON_VERIFIE');
    expect(etat(cs, 'Chiffrement')).toBe('NON_VERIFIE');
  });
});

describe('rendu et code de sortie', () => {
  it('code 1 dès qu’un contrôle manque ; l’action n’est rendue que pour les contrôles non prêts', () => {
    const cs = [
      { groupe: 'G', nom: 'a', etat: 'PRET' as const, motif: 'ok', action: 'ne pas afficher' },
      { groupe: 'G', nom: 'b', etat: 'MANQUANT' as const, motif: 'absent', action: 'faire ceci' },
      { groupe: 'G', nom: 'c', etat: 'NON_VERIFIE' as const, motif: '?', action: 'vérifier' },
    ];
    expect(synthese(cs)).toEqual({ pret: 1, manquant: 1, nonVerifie: 1, codeSortie: 1 });
    const t = rendre(cs);
    expect(t).toContain('→ faire ceci');
    expect(t).not.toContain('ne pas afficher');
    expect(t).toContain('NON PRÊT');
    expect(synthese(cs.slice(0, 1)).codeSortie).toBe(0);
  });
});

describe('mémoire et certificats', () => {
  it('lit /proc/meminfo et applique des planchers', () => {
    const r = lireMeminfo('MemTotal:        6054000 kB\nMemFree:  100 kB\nMemAvailable:    1740000 kB\n');
    expect(r).toEqual({ totalOctets: 6054000 * 1024, disponibleOctets: 1740000 * 1024 });
    expect(lireMeminfo('rien')).toBeNull();
    const Mo = 2 ** 20;
    expect(controlerMemoire('m', 'G', 1700 * Mo, 5900 * Mo, 512 * Mo, 5, 'a').etat).toBe('PRET');
    expect(controlerMemoire('m', 'G', 300 * Mo, 5900 * Mo, 512 * Mo, 5, 'a').etat).toBe('MANQUANT');
    expect(controlerMemoire('m', 'G', 600 * Mo, 32000 * Mo, 512 * Mo, 5, 'a').etat).toBe('MANQUANT');
  });
  it('certificat : valable, bientôt expiré, expiré, illisible', () => {
    const maintenant = Date.parse('2026-11-20T00:00:00Z');
    expect(controlerCertificat('c', '2027-06-01T00:00:00Z', maintenant, 30, 'a').etat).toBe('PRET');
    const bientot = controlerCertificat('c', '2026-12-05T00:00:00Z', maintenant, 30, 'renouveler');
    expect(bientot.etat).toBe('MANQUANT');
    expect(bientot.motif).toMatch(/dans 15 jour/);
    expect(controlerCertificat('c', '2026-11-01T00:00:00Z', maintenant, 30, 'a').motif).toMatch(/EXPIRÉ/);
    expect(controlerCertificat('c', 'pas une date', maintenant, 30, 'a').etat).toBe('NON_VERIFIE');
  });
});
