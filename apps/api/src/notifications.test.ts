import { describe, expect, it } from 'vitest';
import { FAMILLES_NOTIFICATION, presenterNotification } from './notifications.controller.js';

describe('notification « preuve de connexion IA bientôt périmée » (D-096)', () => {
  const n = { id: 'n1', type: 'ia.preuve_expire_bientot', entiteId: null, cibleType: 'verification_ia', cibleId: 'v1', donnees: { joursRestants: 5, expireLe: '2026-12-10', seuilJours: 7 }, creeLe: '2026-12-05T08:00:00.000Z', lueLe: null, raisonSociale: null, accessible: true };
  it('dit le délai et la date, renvoie à l’écran IA, ne demande aucune action au cabinet', () => {
    const p = presenterNotification(n);
    expect(p.titre).toBe('La preuve de connexion de la passerelle IA expire bientôt');
    expect(p.message).toContain('5 jour(s)');
    expect(p.message).toContain('2026-12-10');
    expect(p.message).toContain('Aucune action n’est demandée au cabinet');
    expect(p.lien).toBe('/administration/ia');
  });
  it('ne compose rien d’autre que les valeurs reçues (données hostiles tronquées, jamais interprétées)', () => {
    const p = presenterNotification({ ...n, donnees: { joursRestants: '<script>alert(1)</script>'.repeat(5), expireLe: '2026-12-10<b>' } });
    expect(p.message.length).toBeLessThan(400);
  });
  it('famille réglable « ia » : préfixe « ia », distincte des autres', () => {
    expect(FAMILLES_NOTIFICATION.find((f) => f.famille === 'ia')).toMatchObject({ prefixes: ['ia'] });
    expect(new Set(FAMILLES_NOTIFICATION.map((f) => f.famille)).size).toBe(FAMILLES_NOTIFICATION.length);
  });
});
