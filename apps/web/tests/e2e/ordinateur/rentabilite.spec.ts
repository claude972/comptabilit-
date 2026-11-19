import { type Browser, type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSuite, simulateur, statutBff, surveiller } from '../outils';

const mission = `/dossiers/${ID.dupain}/mission`;
const F = ' '; // espace fine insécable des montants
const contenu = (montantAnnuelHt: string | null) => ({
  perimetre: [{ prestation: 'tenue' }],
  duree: { debut: '2025-01-01', fin: null, taciteReconduction: true },
  honoraires: { mode: 'forfait', montantAnnuelHt, tauxHoraireHt: null, conditionsRevision: '' },
  obligationsCabinet: '', obligationsClient: '', livrables: [], mandats: [], limites: '',
});
const ouvrir = async (browser: Browser, qui: 'chloe' | 'remi' | 'alice', chemin: string) => {
  const page = await (await browser.newContext({ storageState: etatDe(qui) })).newPage();
  await page.goto(chemin);
  return page;
};

/** Mission avec une lettre validée (forfait annuel) et trois travaux : dans le périmètre, hors périmètre, sans temps saisi. */
async function preparer(browser: Browser, montantAnnuelHt: string | null = '3600.00'): Promise<string> {
  const chloe = await ouvrir(browser, 'chloe', mission);
  expect(await statutBff(chloe, 'POST', `v1/dossiers/${ID.dupain}/missions`, { libelle: 'Mission comptable 2025' })).toBe(201);
  const missionId = (await simulateur<{ missions: Array<{ id: string }> }>('suite')).missions[0]!.id;
  expect(await statutBff(chloe, 'POST', `v1/missions/${missionId}/lettres`, { dateEffet: '2025-01-01', contenu: contenu(montantAnnuelHt) })).toBe(201);
  const lettreId = (await etatSuite()).lettres[0]!.id;
  const alice = await ouvrir(browser, 'alice', mission);
  expect(await statutBff(alice, 'POST', `v1/lettres/${lettreId}/validation`)).toBe(200);
  for (const t of [
    { dateTravail: '2025-02-10', prestation: 'tenue', description: 'Saisie de février', tempsObserveMinutes: 120 },
    { dateTravail: '2025-03-05', prestation: 'fiscal_tva', description: 'Déclaration de TVA', tempsObserveMinutes: 45 },
    { dateTravail: '2025-04-02', prestation: 'tenue', description: 'Saisie de mars, temps non relevé' },
  ]) expect(await statutBff(chloe, 'POST', `v1/dossiers/${ID.dupain}/travaux`, t)).toBe(201);
  await chloe.context().close();
  await alice.context().close();
  return missionId;
}

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('rentabilité d’une mission', () => {
  test('collaboratrice : pas de lien, page réservée au niveau révision, refus de l’API', async ({ browser }) => {
    const missionId = await preparer(browser);
    const page = await ouvrir(browser, 'chloe', mission);
    await expect(page.getByRole('navigation', { name: 'Pages de l’onglet Mission' }).getByRole('link')).toHaveText(['Missions, lettres et travaux', 'Registre des conseils']);
    await page.goto(`${mission}/rentabilite`);
    await expect(page.getByTestId('rentabilite-reservee')).toContainText('réservée au niveau « Révision »');
    await expect(page.getByTestId('rentabilite')).toHaveCount(0);
    expect(await statutBff(page, 'GET', `v1/missions/${missionId}/rentabilite?du=2025-01-01&au=2025-12-31`)).toBe(403);
  });

  test('réviseur : honoraires, temps observés, taux « partiel » avec motif, marge réservée, mentions ; « non calculable » hors de toute lettre', async ({ browser }) => {
    await preparer(browser);
    const page = await ouvrir(browser, 'remi', mission);
    const erreurs = surveiller(page);
    await page.getByRole('navigation', { name: 'Pages de l’onglet Mission' }).getByRole('link', { name: 'Rentabilité' }).click();
    await expect(page.getByTestId('periode')).toContainText('Période par défaut : l’année civile en cours'); // l'exercice 2025 du dossier ne couvre pas la date du jour
    await page.getByLabel('Du', { exact: true }).fill('2025-01-01');
    await page.getByLabel('Au', { exact: true }).fill('2025-12-31');
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page.getByTestId('periode')).toContainText('Du 01/01/2025 au 31/12/2025. Période choisie.');
    await expect(page.getByTestId('mention-generale')).toHaveText('Aide à la gestion, calculée sur les saisies du cabinet ; ni une facturation, ni une comptabilité analytique.');

    const honoraires = page.getByTestId('honoraires');
    await expect(honoraires).toHaveAttribute('data-statut', 'calcule');
    await expect(honoraires.locator('[data-valeur="forfait"]')).toHaveText(`3${F}600,00 €`);
    await expect(honoraires.locator('[data-valeur="temps-passe"]')).toHaveText('0,00 €'); // calculé : aucune lettre au temps passé
    await expect(honoraires.locator('[data-valeur="total"]')).toHaveText(`3${F}600,00 €`);
    const detail = honoraires.locator('tr[data-detail]');
    await expect(detail).toHaveCount(1);
    await expect(detail).toContainText('Lettre de mission — version 1');
    await expect(detail).toContainText('365');
    await expect(detail).toContainText('Forfait');

    const temps = page.getByTestId('temps-observes');
    await expect(temps.locator('[data-valeur="dans-perimetre"]')).toHaveText('2 h');
    await expect(temps.locator('[data-valeur="hors-perimetre"]')).toHaveText('45 min');
    await expect(temps.locator('[data-valeur="sans-lettre"]')).toHaveText('0 min');
    await expect(temps.locator('[data-valeur="sans-temps"]')).toContainText('1 — leur durée est inconnue');

    const taux = page.getByTestId('taux-horaire');
    await expect(taux).toHaveAttribute('data-statut', 'partiel');
    await expect(taux).toContainText('Partiel');
    await expect(taux.locator('[data-valeur="taux"]')).toContainText(`1${F}800,00 €`); // 3 600 / 2 h, calculé par l'API
    await expect(taux).toContainText('Des travaux n’ont pas de temps saisi');

    // Réviseur non gestionnaire : ni coût ni marge, mais le motif de l'API, tel quel.
    const marge = page.getByTestId('marge');
    await expect(marge.getByTestId('non-calculable')).toHaveText('Non calculable — Le coût et la marge sont réservés aux administrateurs et associés du cabinet.');
    await expect(marge.locator('[data-valeur]')).toHaveCount(0);
    const mentions = page.getByTestId('mentions').getByRole('listitem');
    await expect(mentions).toHaveText([
      'Prorata des forfaits annuels sur 365 jours (convention interne).',
      '45 minute(s) observées sur des travaux potentiellement hors périmètre : non couvertes par les honoraires calculés.',
      '1 travail(aux) sans temps saisi : les ratios horaires sont partiels.',
    ]);

    // Avant toute lettre : rien n'est supposé, et aucun zéro ne tient lieu de résultat.
    await page.goto(`${mission}/rentabilite?du=2024-01-01&au=2024-12-31`);
    await expect(page.getByTestId('honoraires')).toHaveAttribute('data-statut', 'non_calculable');
    await expect(page.getByTestId('honoraires').getByTestId('non-calculable')).toHaveText('Non calculable — Aucune lettre de mission validée n’est applicable sur la période.');
    await expect(page.getByTestId('honoraires')).not.toContainText('0,00');
    await expect(page.getByTestId('taux-horaire').getByTestId('non-calculable')).toContainText('Aucune lettre de mission validée');
    await expect(page.getByTestId('taux-horaire')).not.toContainText('0,00');
    await expect(page.getByTestId('marge')).not.toContainText('0,00');
    // Période inversée : signalée, jamais envoyée telle quelle.
    await page.goto(`${mission}/rentabilite?du=2025-12-31&au=2025-01-01`);
    await expect(page.getByRole('alert').filter({ hasText: 'La période demandée n’est pas valide' })).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('affectation explicite d’un travail à une mission : choisie par la collaboratrice, lue par le réviseur, écartée de la rentabilité de l’autre mission', async ({ browser }) => {
    const missionId = await preparer(browser);
    const chloe = await ouvrir(browser, 'chloe', mission);
    const erreurs = surveiller(chloe);
    expect(await statutBff(chloe, 'POST', `v1/dossiers/${ID.dupain}/missions`, { libelle: 'Mission exceptionnelle 2025' })).toBe(201);
    await chloe.reload();
    const ligne = chloe.locator('tr[data-travail]', { hasText: 'Saisie de février' });
    await expect(ligne).toHaveAttribute('data-situation', 'dans_le_perimetre');
    await expect(ligne.getByLabel('Mission de ce travail')).toHaveValue(''); // rien n'est déduit : non affecté par défaut
    await ligne.getByLabel('Mission de ce travail').selectOption({ label: 'Mission exceptionnelle 2025' });
    await expect(ligne.getByText('Travail affecté.')).toBeVisible();
    // Située par rapport aux seules lettres de sa mission, qui n'en a pas.
    await expect(chloe.locator('tr[data-travail]', { hasText: 'Saisie de février' })).toHaveAttribute('data-situation', 'aucune_lettre_applicable');
    const suite = await simulateur<{ travaux: Array<{ description: string; missionId: string | null }>; missions: Array<{ id: string; libelle: string }> }>('suite');
    const autre = { missionId: suite.travaux.find((t) => t.description === 'Saisie de février')!.missionId! };
    expect(autre.missionId).toBe(suite.missions.find((x) => x.libelle === 'Mission exceptionnelle 2025')!.id);
    expect(autre.missionId).not.toBe(missionId);
    expect(erreurs).toEqual([]);
    await chloe.context().close();

    const remi = await ouvrir(browser, 'remi', `${mission}/rentabilite?du=2025-01-01&au=2025-12-31`);
    await expect(remi.getByTestId('mentions')).toContainText('1 travail(aux) de la période, affecté(s) à une autre mission du dossier, ne sont pas comptés ici.');
    await expect(remi.getByTestId('mentions')).toContainText('ne sont affectés à aucune');
    await remi.context().close();
    // Le réviseur retrouve l'affectation enregistrée.
    const relecture = await ouvrir(browser, 'remi', mission);
    await expect(relecture.locator('tr[data-travail]', { hasText: 'Saisie de février' }).getByLabel('Mission de ce travail')).toHaveValue(autre.missionId);
    await relecture.context().close();
  });

  test('lettre au forfait sans montant : honoraires « non calculable » avec le motif de l’API, jamais zéro', async ({ browser }) => {
    await preparer(browser, null);
    const page = await ouvrir(browser, 'remi', `${mission}/rentabilite?du=2025-01-01&au=2025-12-31`);
    const honoraires = page.getByTestId('honoraires');
    await expect(honoraires.getByTestId('non-calculable')).toHaveText('Non calculable — Une lettre au forfait ne porte pas de montant annuel : les honoraires ne sont pas calculables.');
    await expect(honoraires.locator('[data-valeur]')).toHaveCount(0);
    await expect(honoraires).not.toContainText('0,00');
    await expect(page.getByTestId('temps-observes').locator('[data-valeur="dans-perimetre"]')).toHaveText('2 h'); // les temps, eux, restent observés
  });

  test('administratrice : marge « non calculable » tant qu’aucun coût n’est saisi ; saisie puis effacement du coût horaire dans l’administration', async ({ browser }) => {
    await preparer(browser);
    const url = `${mission}/rentabilite?du=2025-01-01&au=2025-12-31`;
    const page = await ouvrir(browser, 'alice', url);
    await expect(page.getByTestId('marge').getByTestId('non-calculable')).toHaveText('Non calculable — Coût horaire interne du cabinet non renseigné : aucune marge n’est calculée.');

    await page.goto('/administration');
    const f = page.locator('form[data-formulaire="cout-horaire"]');
    await expect(f.getByTestId('cout-horaire-actuel')).toContainText('non saisi');
    await expect(f).toContainText('Aucune valeur par défaut : tant qu’il n’est pas saisi, aucune marge n’est calculée.');
    await expect(f.getByRole('button', { name: 'Effacer le coût horaire' })).toHaveCount(0);
    await f.getByLabel('Coût horaire interne HT (en euros)').fill('0');
    await f.getByRole('button', { name: 'Enregistrer le coût horaire' }).click();
    await expect(f.getByRole('alert')).toContainText('strictement positif');
    expect((await simulateur<{ coutHoraire: string | null }>('suite')).coutHoraire).toBeNull();
    const envoi = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/cabinet/cout-horaire'));
    await f.getByLabel('Coût horaire interne HT (en euros)').fill('60');
    await f.getByRole('button', { name: 'Enregistrer le coût horaire' }).click();
    expect((await envoi).postDataJSON()).toEqual({ coutHoraireInterneHt: '60.00' }); // une chaîne décimale, jamais un nombre
    await expect(f.getByTestId('cout-horaire-actuel')).toContainText('60,00 € HT par heure');

    await page.goto(url);
    const marge = page.getByTestId('marge');
    await expect(marge).toHaveAttribute('data-statut', 'partiel');
    await expect(marge.locator('[data-valeur="cout"]')).toHaveText('165,00 €'); // 2 h 45 observées × 60 €, calculé par l'API
    await expect(marge.locator('[data-valeur="marge"]')).toHaveText(`3${F}435,00 €`);
    await expect(marge).toContainText('95,42 %'); // 3 435 / 3 600, arrondi par l'API
    await expect(marge).toContainText('Des travaux n’ont pas de temps saisi : le coût réel est supérieur, la marge réelle inférieure.');

    await page.goto('/administration');
    await f.getByRole('button', { name: 'Effacer le coût horaire' }).click();
    await expect(f.getByTestId('cout-horaire-actuel')).toContainText('non saisi');
    await expect(f).toContainText('plus aucune marge n’est calculée');
    await page.goto(url);
    await expect(page.getByTestId('marge').getByTestId('non-calculable')).toContainText('Coût horaire interne du cabinet non renseigné');

    // Un réviseur ne lit ni ne modifie le coût horaire.
    const remi = await ouvrir(browser, 'remi', mission);
    expect(await statutBff(remi, 'GET', 'v1/cabinet/cout-horaire')).toBe(403);
    expect(await statutBff(remi, 'PUT', 'v1/cabinet/cout-horaire', { coutHoraireInterneHt: '60.00' })).toBe(403);
  });
});
