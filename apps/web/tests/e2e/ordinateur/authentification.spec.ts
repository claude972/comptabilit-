import { expect, test } from '@playwright/test';
import { COMPTES, journal, seConnecter, simulateur, surveiller } from '../outils';

/** Parcours OIDC vérifié contre le VRAI Keycloak de développement ; l'API derrière le BFF est le simulateur. */
test.describe('authentification et BFF', () => {
  test('sans session : redirection vers la connexion, en-têtes de sécurité stricts, aucune violation CSP', async ({ page }) => {
    const erreurs = surveiller(page);
    const reponse = await page.goto('/connexion');
    const entetes = reponse!.headers();
    const csp = entetes['content-security-policy']!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(entetes['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(entetes['x-content-type-options']).toBe('nosniff');
    expect(entetes['permissions-policy']).toContain('camera=(self)');
    expect(entetes['cache-control']).toContain('no-store');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();

    await page.goto('/dossiers');
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fdossiers$/);
    // Le nonce change à chaque réponse.
    const autre = (await page.reload())!.headers()['content-security-policy']!;
    expect(autre).not.toBe(csp);
    expect(erreurs).toEqual([]);
  });

  test('connexion code + PKCE S256 + state + nonce, session en cookies HttpOnly, aucun jeton côté navigateur', async ({ page, context }) => {
    const erreurs = surveiller(page);
    const versKeycloak = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'));
    await page.goto('/deposer');
    await page.getByRole('link', { name: 'Se connecter' }).click();
    const url = new URL((await versKeycloak).url());
    expect(url.origin).toBe('http://localhost:8080');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/retour');
    expect(url.searchParams.get('client_id')).toBe('comtaple-web');
    expect(url.search).not.toContain('client_secret');

    await page.locator('#username').fill(COMPTES.chloe);
    await page.locator('#password').fill(process.env.DEV_MDP_UTILISATEURS!);
    await page.locator('#kc-login').click();
    // Retour sur la page demandée avant la connexion.
    await page.waitForURL('http://localhost:3000/deposer');
    await expect(page.getByTestId('utilisateur')).toHaveText('Chloé Collab');

    const cookies = (await context.cookies('http://localhost:3000')).filter((c) => c.name.startsWith('comtaple_'));
    const session = cookies.filter((c) => c.name.startsWith('comtaple_session.'));
    expect(session.length).toBeGreaterThanOrEqual(1);
    for (const c of session) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('Lax');
      expect(c.value.length).toBeLessThanOrEqual(3500);
      expect(c.expires).toBeGreaterThan(Date.now() / 1000);
      expect(c.expires).toBeLessThan(Date.now() / 1000 + 10 * 3600 + 60); // durée bornée
    }
    // Valeur chiffrée (JWE compact, 5 segments) : aucun JWT lisible.
    const valeur = session.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join('').replace(/^\d:/, '');
    expect(valeur.split('.')).toHaveLength(5);
    expect(valeur).not.toMatch(/eyJhbGciOiJSUzI1NiIs/); // en-tête d'un jeton RS256 en clair
    expect(cookies.some((c) => c.name === 'comtaple_oidc')).toBe(false); // transaction OIDC effacée

    // Rien d'accessible au JavaScript de la page.
    const visible = await page.evaluate(() => ({ cookie: document.cookie, local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
    expect(visible.cookie).not.toContain('comtaple_session');
    expect(`${visible.local}${visible.session}`).not.toMatch(/eyJ|token|jeton/i);
    expect(await page.content()).not.toMatch(/eyJhbGciOi/);
    expect(erreurs).toEqual([]);
  });

  test('retour OIDC forgé ou rejoué : refusé, aucune session ouverte', async ({ page, context }) => {
    await page.goto('/api/auth/retour?code=faux&state=faux');
    await expect(page).toHaveURL(/\/connexion\?erreur=expire/);
    // Transaction ouverte mais « state » différent.
    const attente = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'));
    await page.goto('/api/auth/connexion');
    await attente;
    await page.goto('/api/auth/retour?code=faux&state=mauvais-etat');
    await expect(page).toHaveURL(/\/connexion\?erreur=echec/);
    await expect(page.getByText('La connexion n’a pas abouti.')).toBeVisible();
    expect((await context.cookies()).some((c) => c.name.startsWith('comtaple_session'))).toBe(false);
    // Destination après connexion : jamais une adresse externe.
    await page.goto('/connexion?retour=https://exemple.invalid/');
    await expect(page.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/api/auth/connexion');
  });

  test('BFF : 401 sans session, chemins limités à v1/, CSRF strict sur les méthodes non-GET, jeton ajouté côté serveur', async ({ page, request }) => {
    expect((await request.get('http://127.0.0.1:' + (process.env.E2E_PORT_WEB ?? '3100') + '/api/bff/v1/moi')).status()).toBe(401);
    await seConnecter(page, 'chloe', '/depots');
    await simulateur('reinitialiser');
    const appeler = (chemin: string, init: RequestInit = {}) =>
      page.evaluate(async ([c, i]) => {
        const r = await fetch(c as string, i as RequestInit);
        return { statut: r.status, corps: await r.text(), cache: r.headers.get('cache-control') };
      }, [chemin, init] as const);

    const moi = await appeler('/api/bff/v1/moi');
    expect(moi.statut).toBe(200);
    expect(JSON.parse(moi.corps).utilisateur.nom).toBe('Chloé Collab');
    expect(moi.cache).toContain('no-store');
    expect((await journal()).some((e) => e.chemin === '/v1/moi' && e.statut === 200 && e.utilisateur === 'Chloé Collab')).toBe(true);

    expect((await appeler('/api/bff/__test/etat')).statut).toBe(404);
    expect((await appeler('/api/bff/v2/moi')).statut).toBe(404);
    expect((await appeler('/api/bff/v1/%2e%2e/__test/etat')).statut).toBe(404);
    expect((await appeler('/api/bff/v1/dossiers/pas-un-uuid/exercices')).statut).toBe(400); // statut d'erreur de l'API relayé

    const corps = JSON.stringify({ type: 'signalement_erreur', message: 'x' });
    const cible = '/api/bff/v1/documents/00000000-0000-4000-8000-000000000000/echanges';
    // Sans l'en-tête personnalisé : refusé avant tout appel de l'API.
    const sansEntete = await appeler(cible, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
    expect(sansEntete.statut).toBe(403);
    // Avec l'en-tête : la requête atteint l'API (qui répond 404 pour ce document inexistant).
    const avecEntete = await appeler(cible, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: corps });
    expect(avecEntete.statut).toBe(404);
    const recus = (await journal()).filter((e) => e.chemin.endsWith('/echanges'));
    expect(recus).toHaveLength(1);

    // Origine étrangère (requête forgée hors navigateur avec les cookies de la session) : refusée.
    const cookies = (await page.context().cookies('http://localhost:3000')).map((c) => `${c.name}=${c.value}`).join('; ');
    const base = `http://127.0.0.1:${process.env.E2E_PORT_WEB ?? '3100'}`;
    const forge = (entetes: Record<string, string>) => fetch(`${base}${cible}`, { method: 'POST', headers: { cookie: cookies, 'content-type': 'application/json', 'x-comtaple-csrf': '1', ...entetes }, body: corps });
    expect((await forge({ origin: 'https://attaquant.invalid' })).status).toBe(403);
    expect((await forge({})).status).toBe(403); // Origin absent
    expect((await forge({ origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await forge({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' })).status).toBe(404); // contrôle : passe
    expect((await fetch(`${base}/api/bff/v1/moi`, { headers: { cookie: cookies, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await journal()).filter((e) => e.chemin.endsWith('/echanges'))).toHaveLength(2);
  });

  test('renouvellement transparent du jeton, puis déconnexion ; un renouvellement refusé ramène à la connexion', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await seConnecter(page, 'bruno', '/depots');
    const lire = async () => (await page.context().cookies('http://localhost:3000')).filter((c) => c.name.startsWith('comtaple_session.')).map((c) => c.value).join('');
    const avant = await lire();
    // Seconde fenêtre avec une copie de la même session (même session Keycloak).
    const copie = await browser.newContext({ storageState: await page.context().storageState() });
    const page2 = await copie.newPage();

    // Jeton de 300 s, marge de 290 s : passé 10 s, la requête suivante déclenche un renouvellement auprès de Keycloak.
    await page.waitForTimeout(11_500);
    await simulateur('reinitialiser');
    await page.goto('/depots');
    await expect(page.getByTestId('utilisateur')).toHaveText('Bruno Admin');
    const apres = await lire();
    expect(apres).not.toBe(avant);
    // Le nouveau jeton est accepté par l'API (vérification de signature, d'émetteur et d'audience côté simulateur).
    expect((await journal()).some((e) => e.chemin === '/v1/moi' && e.statut === 200)).toBe(true);

    // Déconnexion : session locale effacée, session Keycloak close, retour à l'écran de connexion.
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.waitForURL(/\/connexion\?deconnecte=1/);
    await expect(page.getByRole('status')).toContainText('Vous êtes déconnecté');
    expect(await lire()).toBe('');
    await page.goto('/depots');
    await expect(page).toHaveURL(/\/connexion/);
    // Keycloak ne reconnaît plus la session : il redemande les identifiants.
    await page.getByRole('link', { name: 'Se connecter' }).click();
    await expect(page.locator('#username')).toBeVisible();

    // La copie détient encore des cookies : son jeton de renouvellement est désormais refusé par Keycloak.
    await page2.waitForTimeout(11_500);
    await page2.goto('http://localhost:3000/depots');
    await expect(page2).toHaveURL(/\/connexion/);
    expect((await copie.cookies('http://localhost:3000')).filter((c) => c.name.startsWith('comtaple_session.') && c.value)).toHaveLength(0);
    const refus = await page2.evaluate(async () => (await fetch('/api/bff/v1/moi')).status);
    expect(refus).toBe(401);
    await copie.close();
  });
});
