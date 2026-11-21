import { describe, expect, it } from 'vitest';
import { SondeSante } from './sante.js';

const bonne = () => Promise.resolve('ok');
const mauvaise = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:6379 mot-de-passe-secret'));
const muette = () => new Promise<never>(() => undefined);

describe('sonde de santé élargie', () => {
  it('tout répond : « ok »', async () => {
    const s = new SondeSante({ files: bonne, stockage: bonne, identite: bonne });
    expect(await s.evaluer()).toEqual({ statut: 'ok', dependances: { base: 'ok', files: 'ok', stockage: 'ok', identite: 'ok' } });
  });

  it('une dépendance en panne ou muette rend « degrade », nommée, sans jamais divulguer l’erreur', async () => {
    const s = new SondeSante({ files: mauvaise, stockage: muette, identite: bonne }, 50);
    const r = await s.evaluer();
    expect(r.statut).toBe('degrade');
    expect(r.dependances).toEqual({ base: 'ok', files: 'indisponible', stockage: 'indisponible', identite: 'ok' });
    const texte = JSON.stringify(r);
    expect(texte).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret|délai/);
  });

  it('une sonde muette est bornée par le délai (pas de requête pendue)', async () => {
    const s = new SondeSante({ files: muette, stockage: muette, identite: muette }, 60);
    const debut = Date.now();
    await s.evaluer();
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it('le résultat est gardé pendant la fenêtre : pas d’appel supplémentaire aux dépendances, puis renouvelé', async () => {
    let appels = 0;
    let horloge = 1000;
    const compte = () => {
      appels += 1;
      return Promise.resolve();
    };
    const s = new SondeSante({ files: compte, stockage: compte, identite: compte }, 100, 5000, () => horloge);
    await Promise.all([s.evaluer(), s.evaluer(), s.evaluer()]);
    expect(appels).toBe(3); // une évaluation partagée : une fois par dépendance
    horloge += 4000;
    await s.evaluer();
    expect(appels).toBe(3);
    horloge += 1500;
    await s.evaluer();
    expect(appels).toBe(6);
  });

  it('une dépendance rétablie est vue « ok » à l’évaluation suivante', async () => {
    let panne = true;
    let horloge = 0;
    const s = new SondeSante({ files: () => (panne ? Promise.reject(new Error('x')) : Promise.resolve()), stockage: bonne, identite: bonne }, 50, 1000, () => horloge);
    expect((await s.evaluer()).statut).toBe('degrade');
    panne = false;
    horloge += 1001;
    expect((await s.evaluer()).statut).toBe('ok');
  });
});
