/**
 * `test` des parcours réels, avec DIAGNOSTIC DE NAVIGATION automatique (D-159). Pour chaque page ouverte, on garde un court journal : navigations (chemin sans requête),
 * erreurs de console et de page, requêtes échouées, réponses 4xx / 5xx, et l'état de chaque CLIC réel (cible, lien visé, marqueur d'hydratation, événement annulé ou non,
 * navigation observée ensuite). Il n'est écrit QUE si le test échoue, dans `test-results/diagnostic-navigation.jsonl`, que le rapporteur `diagnostic-reporter.ts` reprend
 * à la fin de la sortie (donc dans l'annotation publique de la CI). Aucun secret : ni en-tête, ni corps, ni requête d'URL (les jetons éventuels sont masqués), texte tronqué.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { type BrowserContext, type Page, expect, test as base } from '@playwright/test';

const MAX = 80;
const masque = (t: string): string => t.replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '***').replace(/[?&](code|state|token|session_state)=[^&\s]+/gi, '').slice(0, 220);
const chemin = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.pathname}`.slice(0, 160);
  } catch {
    return masque(u);
  }
};

const SCRIPT_CLICS = `(() => {
  if (window.__diagClics) return;
  try { window.__diagClics = JSON.parse(sessionStorage.getItem('__diagClics') || '[]'); } catch (e) { window.__diagClics = []; }
  const cible = (e) => { const el = e.target && e.target.closest ? e.target.closest('a,button,[role=button],input,select,summary,label') || e.target : e.target; return el; };
  window.addEventListener('click', (e) => {
    const el = cible(e);
    const href = el && el.getAttribute ? el.getAttribute('href') : null;
    const entree = { t: Math.round(performance.now()), balise: el && el.tagName ? el.tagName.toLowerCase() : '?', texte: ((el && el.textContent) || '').trim().replace(/\\s+/g, ' ').slice(0, 40), href: href ? String(href).split('?')[0].slice(0, 120) : null, hydrate: document.documentElement.dataset.hydrate || 'non', disabled: !!(el && el.disabled), annule: null, url: location.pathname };
    window.__diagClics.push(entree); if (window.__diagClics.length > 20) window.__diagClics.shift();
    const garder = () => { try { sessionStorage.setItem('__diagClics', JSON.stringify(window.__diagClics)); } catch (e) {} };
    setTimeout(() => { entree.annule = e.defaultPrevented; entree.urlApres = location.pathname; garder(); }, 0);
    garder();
    window.addEventListener('pagehide', garder, { once: true });
  }, true);
})();`;

type Evenement = Record<string, unknown>;

export const test = base.extend<{ diagnosticNavigation: void }>({
  diagnosticNavigation: [
    async ({ browser, context }, use, testInfo) => {
      const journal = new Map<Page, Evenement[]>();
      const hydratation: string[] = [];
      const t0 = Date.now();
      const noter = (p: Page, e: Evenement) => {
        const l = journal.get(p) ?? [];
        l.push({ ms: Date.now() - t0, ...e });
        if (l.length > MAX) l.shift();
        journal.set(p, l);
      };
      const suivre = async (c: BrowserContext) => {
        await c.addInitScript(SCRIPT_CLICS);
        const poser = (p: Page) => {
          journal.set(p, journal.get(p) ?? []);
          p.on('framenavigated', (f) => { if (f === p.mainFrame()) noter(p, { nav: chemin(f.url()) }); });
          p.on('console', (m) => { if (m.type() === 'error') noter(p, { console: masque(m.text()) }); });
          p.on('pageerror', (e) => {
            noter(p, { erreurPage: masque(e.message) });
            if (/Hydration failed|Minified React error #(418|423|425)|hydrat(ion|ed) (error|mismatch)/i.test(e.message)) hydratation.push(`${chemin(p.url())} : ${masque(e.message).slice(0, 120)}`);
          });
          p.on('requestfailed', (r) => noter(p, { requeteEchouee: `${r.method()} ${chemin(r.url())}`, cause: masque(r.failure()?.errorText ?? '') }));
          p.on('response', (r) => { if (r.status() >= 400) noter(p, { reponse: r.status(), requete: `${r.request().method()} ${chemin(r.url())}` }); });
        };
        for (const p of c.pages()) poser(p);
        c.on('page', poser);
      };
      // Les parcours ouvrent presque tous leurs contextes eux-mêmes (`browser.newContext`) : on les suit aussi.
      await suivre(context);
      const ouvrir = browser.newContext.bind(browser);
      (browser as { newContext: typeof browser.newContext }).newContext = async (options) => {
        const c = await ouvrir(options);
        await suivre(c);
        return c;
      };
      await use();
      (browser as { newContext: typeof browser.newContext }).newContext = ouvrir;
      // Garde-fou produit (D-159) : une erreur d'hydratation (HTML invalide, rendu serveur différent du client) fait recréer l'arbre côté client et perdre les clics en cours.
      // Elle fait échouer le test, qui qu'en soit la cause apparente.
      if (hydratation.length > 0 && testInfo.status === testInfo.expectedStatus) {
        testInfo.status = 'failed';
        testInfo.error = { message: `Erreur d'hydratation détectée (${hydratation.length}) : ${[...new Set(hydratation)].slice(0, 3).join(' | ')}` };
      }
      if (testInfo.status === testInfo.expectedStatus) return;
      const pages = [];
      for (const [p, evenements] of journal) {
        let etat: Evenement = { fermee: true };
        if (!p.isClosed()) {
          etat = await p
            .evaluate(() => ({ url: location.pathname, etat: document.readyState, hydrate: document.documentElement.dataset.hydrate ?? 'non', clics: (window as unknown as { __diagClics?: unknown[] }).__diagClics ?? [] }))
            .catch((e: Error) => ({ erreur: masque(e.message) }));
        }
        pages.push({ ...etat, evenements: evenements.slice(-25) });
      }
      mkdirSync('test-results', { recursive: true });
      appendFileSync('test-results/diagnostic-navigation.jsonl', `${JSON.stringify({ test: `${testInfo.file.split('/').pop()}:${testInfo.line} ${testInfo.title.slice(0, 80)}`, projet: testInfo.project.name, pages })}\n`);
    },
    { auto: true },
  ],
});
export { expect };
