/**
 * Amortissements sur la pile RÉELLE (Chromium, Firefox, WebKit) : saisie d'une immobilisation en dégressif DÉCLARÉ, vérification de
 * l'écran (explication du mode, date d'acquisition, éligibilité à confirmer, coefficient cohérent avec la durée), absence de
 * débordement horizontal à 360 px, puis retrait de l'immobilisation saisie (le parcours ne laisse rien derrière lui).
 * ÉTAT PAR DÉFAUT : le calcul du dégressif n'est PAS activé (AMORTISSEMENT_DEGRESSIF_ACTIVE absente de la pile locale) : l'écran le dit,
 * aucune proposition dégressive n'apparaît, le motif d'abstention est affiché. Selon l'état du dossier de démonstration, des
 * propositions (linéaires) existent (données importées) ou non : les deux états sont corrects et le test dit lequel il constate.
 * Aucune proposition n'est reprise : aucune écriture n'est créée.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ordinateur } from './profils';

const DOSSIER_DEMO = 'aaaaaaaa-0000-4000-8000-0000000000e1';

function motDePasse(): string {
  const fichier = path.resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(fichier)) throw new Error('.env introuvable');
  const m = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(fichier, 'utf8'));
  if (!m) throw new Error('DEV_MDP_UTILISATEURS absent');
  return m[1]!.trim();
}

test('amortissements : dégressif déclaré, explications, rapprochement, sans débordement à 360 px', async ({ browser }) => {
  const contexte = await browser.newContext({ ...ordinateur(browser) });
  const page = await contexte.newPage();
  await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
  await page.locator('#password').fill(motDePasse());
  await page.locator('#kc-login').click();
  await page.waitForURL(/^http:\/\/localhost:3100\//);
  await page.goto(`/dossiers/${DOSSIER_DEMO}/inventaire`);
  const largeur = () => page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, fenetre: document.documentElement.clientWidth }));
  const sansDebordement = async (etape: string) => {
    const m = await largeur();
    expect(m.contenu, `débordement horizontal (${etape}) : ${m.contenu} > ${m.fenetre}`).toBeLessThanOrEqual(m.fenetre + 2);
  };

  const libelle = `Essai amortissement ${Date.now()}`;
  try {
    await page.getByText('Saisir une immobilisation').click();
    const f = page.locator('form[data-formulaire="saisir-immobilisation"]');
    await expect(f.getByTestId('explication-mode')).toContainText('Vous répondez de la durée retenue');
    await f.getByLabel('Mode d’amortissement (plan comptable)').selectOption('degressif');
    await expect(f.getByTestId('explication-mode')).toContainText('Comtaple ne devine ni le mode, ni l’éligibilité, ni le coefficient');
    await expect(f.getByTestId('champs-degressif')).toBeVisible();
    await expect(f.getByTestId('avertissement-degressif')).toContainText('Calcul du dégressif non activé');
    await expect(f.getByTestId('avertissement-degressif')).toContainText('aucun calcul ni aucune proposition d’écriture n’en découle');
    await f.getByLabel('Désignation').fill(libelle);
    await f.getByLabel('Compte d’immobilisation (classe 2)').fill('215400');
    await f.getByLabel('Valeur brute à amortir (€)').fill('10000,00');
    await f.getByLabel('Date d’acquisition ou de construction').fill('2025-11-05');
    await f.getByLabel('Date de mise en service').fill('2025-11-15');
    await f.getByLabel('Durée d’amortissement (mois)').fill('120');
    await expect(f.getByTestId('coefficient-attendu')).toContainText('le coefficient cohérent est 2,25');

    // 360 px, formulaire dégressif ouvert.
    await page.setViewportSize({ width: 360, height: 800 });
    await sansDebordement('formulaire dégressif à 360 px');

    // Un coefficient incohérent avec la durée est refusé par l'API réelle ; rien n'est enregistré.
    await f.getByLabel('Coefficient dégressif déclaré').selectOption('1.75');
    await f.getByLabel('Je confirme que le bien remplit les conditions du dégressif').check();
    await f.getByTestId('justification-degressif').fill('Matériel neuf, durée normale de 10 ans, bien visé selon le cabinet (fiche fictive).');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    await expect(f.getByRole('alert')).toContainText('incohérent');
    await expect(page.locator('[data-immobilisation]', { hasText: libelle })).toHaveCount(0);

    await f.getByLabel('Coefficient dégressif déclaré').selectOption('2.25');
    await f.getByRole('button', { name: 'Enregistrer l’immobilisation' }).click();
    const ligne = page.locator('[data-immobilisation]', { hasText: libelle });
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText('Dégressif (coefficient 2,25, éligibilité confirmée)');
    await sansDebordement('fichier saisi à 360 px');

    // Propositions : le dégressif n'est PAS activé par défaut : aucune proposition dégressive, jamais de plan ; l'état est dit en clair.
    await expect(page.locator('[data-proposition^="INV-AMORT-DEG|"]')).toHaveCount(0);
    await expect(page.locator('[data-signalement="amortissement_derogatoire"]')).toHaveCount(0);
    const sansDonnees = page.getByText('Aucune donnée comptable importée pour cet exercice');
    const etat = page.getByTestId('etat-degressif');
    await expect(etat.or(sansDonnees).first()).toBeVisible();
    const avecPropositions = await etat.isVisible();
    console.log(`[amortissements réel] état du dégressif affiché : ${avecPropositions} ; rapprochement affiché : ${await page.getByTestId('rapprochement-immobilisations').isVisible()}`);
    if (avecPropositions) {
      await expect(etat).toHaveAttribute('data-degressif-active', 'non');
      await expect(etat).toContainText('Amortissement dégressif : non activé');
      await expect(etat).toContainText('texte de loi (CGI art. 39 A) n’a pas été vérifié');
      const abstentions = page.getByText(/Le moteur s’est abstenu/);
      await abstentions.click();
      await expect(page.getByText(/Calcul du dégressif non activé : le texte de loi/).first()).toBeVisible();
      await sansDebordement('état du dégressif à 360 px');
    }
    if (await page.getByTestId('rapprochement-immobilisations').isVisible()) {
      await expect(page.getByTestId('rapprochement-immobilisations')).toContainText('jamais corrigé');
      await sansDebordement('rapprochement à 360 px');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  } finally {
    // Nettoyage : l'immobilisation d'essai est retirée du fichier (aucune écriture n'avait été créée).
    const retirer = page.getByRole('button', { name: `Retirer du fichier : ${libelle}` });
    if (await retirer.count()) {
      await retirer.click();
      await expect(page.locator('[data-immobilisation]', { hasText: libelle })).toHaveCount(0);
    }
    await contexte.close();
  }
});
