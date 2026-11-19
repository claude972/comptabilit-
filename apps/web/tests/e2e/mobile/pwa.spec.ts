import { expect, test } from '@playwright/test';
import { etatDe, simulateur, surveiller } from '../outils';

test.use({ storageState: etatDe('client') });

const urlsEnCache = () =>
  (async () => {
    const urls: string[] = [];
    for (const nom of await caches.keys()) for (const r of await (await caches.open(nom)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  })();

test.describe('PWA (Chromium en émulation mobile)', () => {
  test('manifeste : nom, affichage autonome, icônes 192/512 et « maskable »', async ({ page, request }) => {
    await page.goto('/connexion');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    const base = `http://127.0.0.1:${process.env.E2E_PORT_WEB ?? '3200'}`;
    const manifeste = await (await request.get(`${base}/manifest.webmanifest`)).json();
    expect(manifeste).toMatchObject({ name: 'Comtaple', display: 'standalone', lang: 'fr', start_url: '/' });
    const icones = manifeste.icons as Array<{ src: string; sizes: string; purpose: string }>;
    expect(icones.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(['192x192 any', '192x192 maskable', '512x512 any', '512x512 maskable']);
    for (const i of icones) {
      const r = await request.get(`${base}${i.src}`);
      expect(r.headers()['content-type']).toBe('image/png');
      const png = await r.body();
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(i.sizes); // dimensions réelles de l'image
    }
  });

  test('service worker : ne met en cache que la coquille statique ; hors connexion, page hors-ligne sans donnée', async ({ page, context }) => {
    await simulateur('reinitialiser');
    const erreurs = surveiller(page);
    await page.goto('/deposer');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }));
    });
    // Navigation et appels d'API sous le contrôle du service worker.
    await page.goto('/depots');
    await expect(page.getByTestId('depots-autres')).toBeVisible();
    await page.getByRole('link', { name: /facture-meunerie/ }).click();
    await expect(page.getByTestId('apercu-piece')).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/bff/v1/moi')).status)).toBe(200);

    const enCache = await page.evaluate(urlsEnCache);
    expect(enCache).toContain('/hors-ligne');
    expect(enCache).toContain('/icones/icone-192.png');
    expect(enCache.some((u) => u.startsWith('/_next/static/'))).toBe(true);
    // Aucune page de données, aucune réponse d'API, aucune pièce.
    const interdits = enCache.filter((u) => !(u === '/hors-ligne' || u === '/manifest.webmanifest' || u.startsWith('/icones/') || u.startsWith('/_next/static/')));
    expect(interdits).toEqual([]);

    await context.setOffline(true);
    await page.goto('/depots', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Vous êtes hors connexion' })).toBeVisible();
    await expect(page.getByText('Rien n’est envoyé tant que l’application est fermée')).toBeVisible();
    await expect(page.getByText('facture-meunerie')).toHaveCount(0);
    // La feuille de style vient du cache : la page hors-ligne est mise en forme (fond du thème appliqué).
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    // L'API n'est jamais servie depuis un cache.
    expect(await page.evaluate(() => fetch('/api/bff/v1/moi').then(() => 'réponse', () => 'échec réseau'))).toBe('échec réseau');
    await context.setOffline(false);
    await page.goto('/depots');
    await expect(page.getByTestId('depots-autres')).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('invite d’installation : événement beforeinstallprompt, aide iOS Safari, repli explicite sinon', async ({ page, browser }) => {
    await page.goto('/deposer');
    const invite = page.getByTestId('invite-installation');
    // Chromium de test sans invite native : le repli dit clairement ce qu'il en est.
    await expect(invite).toContainText('Ce navigateur ne propose pas l’installation pour le moment');
    // Le navigateur propose l'installation : bouton « Installer » qui déclenche l'invite du navigateur.
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => {
        (window as unknown as { inviteAffichee: boolean }).inviteAffichee = true;
      };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    await invite.getByRole('button', { name: 'Installer' }).click();
    expect(await page.evaluate(() => (window as unknown as { inviteAffichee: boolean }).inviteAffichee)).toBe(true);
    await expect(invite).toHaveCount(0);

    // iPhone (agent utilisateur Safari iOS) : aide « Partager → Sur l'écran d'accueil ».
    const iphone = await browser.newContext({
      storageState: etatDe('client'),
      baseURL: 'http://localhost:3000',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const p = await iphone.newPage();
    await p.goto('/deposer');
    await expect(p.getByTestId('invite-installation')).toContainText('Partager');
    await expect(p.getByTestId('invite-installation')).toContainText('Sur l’écran d’accueil');
    await iphone.close();
  });

  test('stockage local indisponible : avertissement explicite, l’envoi reste possible page ouverte', async ({ page }) => {
    await simulateur('reinitialiser');
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
    await page.goto('/deposer');
    await expect(page.getByTestId('sans-persistance')).toContainText('Gardez cette page ouverte');
    await page.getByTestId('entree-fichiers').setInputFiles({ name: 'sans-stockage.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n${'x'.repeat(50_000)}\n%%EOF`) });
    await page.getByRole('radio', { name: 'Avoir' }).check();
    await page.getByTestId('envoyer').click();
    await expect(page.getByTestId('liste-recus').getByRole('listitem')).toHaveCount(1);
  });
});
