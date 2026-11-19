// Visite de recette (outil temporaire, non versionné) : parcourt l'application sur la pile réelle comme chaque profil et
// consigne le texte de chaque écran, les liens, les erreurs console et les réponses HTTP en échec.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('../../.env', 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
const sortie = process.argv[2];
const profils = { alice: 'alice.admin@cabinet-a.test', remi: 'remi.reviseur@cabinet-a.test', chloe: 'chloe.collab@cabinet-a.test', client: 'client.depot@client-a.test' };
const qui = process.argv[3] ?? 'alice';
const mobile = process.argv[4] === 'mobile';
const nav = await chromium.launch();
const ctx = await nav.newContext(mobile ? { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const journal = [];
page.on('console', (m) => { if (m.type() === 'error') journal.push(`CONSOLE ${page.url()} :: ${m.text().slice(0, 300)}`); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) journal.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:3100', '')} (sur ${page.url().replace('http://localhost:3100', '')})`); });
await page.goto('http://localhost:3100/api/auth/connexion');
await page.fill('#username', profils[qui]);
await page.fill('#password', env.DEV_MDP_UTILISATEURS);
await page.click('#kc-login');
await page.waitForURL('http://localhost:3100/**');
const vus = new Set();
const file = process.env.DEPART ? process.env.DEPART.split(',') : ['/'];
const suivre = !process.env.DEPART;
const rapport = [];
const limite = Number(process.argv[5] ?? 60);
while (file.length && vus.size < limite) {
  const chemin = file.shift();
  // Une seule visite par « forme » d'URL (les identifiants sont ramenés à un gabarit) pour ne pas visiter 200 dossiers.
  const forme = suivre ? chemin.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\?.*$/, '') : chemin;
  if (vus.has(forme)) continue;
  vus.add(forme);
  try {
    const r = await page.goto(`http://localhost:3100${chemin}`, { waitUntil: 'networkidle', timeout: 30000 });
    const texte = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, Number(process.env.LONGUEUR ?? 6000));
    const liens = await page.locator('a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    const debordement = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    rapport.push(`\n════════ ${chemin}  [HTTP ${r?.status()}]${debordement ? '  ⚠ DÉBORDEMENT HORIZONTAL' : ''}\n${texte}\n── liens : ${liens.join(' ')}`);
    if (suivre) for (const l of liens) if (!l.startsWith('/api/') && !l.startsWith('/_next')) file.push(l);
  } catch (e) { rapport.push(`\n════════ ${chemin}  ERREUR ${String(e).slice(0, 200)}`); }
}
writeFileSync(sortie, `Profil ${qui}${mobile ? ' (mobile)' : ''} — ${vus.size} écrans\n\n── Journal\n${journal.join('\n')}\n${rapport.join('\n')}`);
console.log(`${vus.size} écrans ; ${journal.length} entrées de journal ; ${file.length} en attente`);
await nav.close();
