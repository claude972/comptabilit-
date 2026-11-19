/**
 * Profils de navigateur des parcours réels, choisis d'après le moteur réellement lancé (Chromium, Firefox ou WebKit) :
 * l'agent utilisateur annoncé est toujours celui du moteur, jamais un autre.
 * « telephone » reste une ÉMULATION (taille d'écran, tactile) : Pixel 7 sous Chromium, iPhone 15 sous WebKit ; Firefox
 * n'émule pas un navigateur mobile, il reçoit seulement un écran étroit. Aucun appareil réel.
 */
import { type Browser, devices } from '@playwright/test';

const moteur = (navigateur: Browser) => navigateur.browserType().name() as 'chromium' | 'firefox' | 'webkit';

export const ordinateur = (navigateur: Browser) => devices[{ chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[moteur(navigateur)]]!;

export function telephone(navigateur: Browser) {
  const m = moteur(navigateur);
  if (m === 'chromium') return devices['Pixel 7']!;
  if (m === 'webkit') return devices['iPhone 15']!;
  return { ...devices['Desktop Firefox']!, viewport: { width: 412, height: 839 } };
}
