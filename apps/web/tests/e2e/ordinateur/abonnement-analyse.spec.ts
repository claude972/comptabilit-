import { type LigneFec, analyserFec, enBlocs, genererFecSynthetique } from '@comtaple/core';
import { expect, test } from '@playwright/test';
import { ID, etatDe, journal, pdf, simulateur, surveiller } from '../outils';

const fec = genererFecSynthetique({ exercice: { debut: '2025-01-01', fin: '2025-12-31' }, nbEcritures: 300, graine: 777 });
const abonnement = (corps: object) => simulateur<{ situation: string }>('abonnement', corps);

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('service fermé — déposant', () => {
  test.use({ storageState: etatDe('client') });

  test('affiché avant toute préparation ; fermeture en cours de session : le dépôt en attente est conservé, sans faux « Refusé »', async ({ page, context }) => {
    await page.goto('/deposer');
    await expect(page.getByTestId('service-ferme')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    // Le service ferme pendant que l'utilisateur prépare un dépôt hors connexion.
    await context.setOffline(true);
    await page.getByTestId('entree-fichiers').setInputFiles({ name: 'facture.pdf', mimeType: 'application/pdf', buffer: pdf('service-ferme') });
    await page.getByRole('radio', { name: 'Autre' }).check();
    await page.getByTestId('envoyer').click();
    const depot = page.getByTestId('liste-depots-en-attente').getByRole('listitem');
    await expect(depot).toContainText('En attente de connexion');
    expect((await abonnement({ statut: 'suspendu' })).situation).toBe('suspendu');
    await context.setOffline(false);
    await expect(depot).toContainText('Interrompu — reprendre');
    await expect(depot).toContainText('L’abonnement du cabinet est suspendu.');
    await expect(depot).toContainText('Ce n’est pas une panne');
    await expect(depot).toContainText('il n’est pas supprimé');
    await expect(depot).not.toContainText('Refusé');
    await expect(page.getByTestId('liste-recus')).toHaveCount(0);
    expect((await journal()).find((e) => e.methode === 'POST' && e.chemin === '/v1/televersements')).toMatchObject({ statut: 403 });

    // À la réouverture : message visible AVANT toute préparation, saisie masquée, dépôt en attente toujours là.
    await page.reload();
    const bandeau = page.getByTestId('service-ferme');
    await expect(bandeau).toHaveAttribute('data-situation', 'suspendu');
    await expect(bandeau).toContainText('La consultation des dossiers et la restitution des données restent possibles');
    await expect(bandeau).toContainText('n’est pas supprimé');
    await expect(page.getByText('Ajouter une facture')).toBeHidden();
    await expect(page.getByTestId('liste-depots-en-attente').getByRole('listitem')).toHaveCount(1);
    // La consultation reste possible.
    await page.goto('/depots');
    await expect(page.getByTestId('depots-autres')).toBeVisible();

    // Service rouvert : le dépôt conservé part enfin.
    await abonnement({ statut: 'actif' });
    await page.goto('/deposer');
    await expect(page.getByTestId('service-ferme')).toHaveCount(0);
    await expect(page.getByTestId('liste-recus').getByRole('listitem')).toHaveCount(1);
  });

  for (const [corps, situation, texte] of [
    [{ statut: 'essai', finEssai: '2020-01-01' }, 'essai_expire', 'La période d’essai du cabinet est terminée.'],
    [{ statut: 'resilie', fin: '2020-01-31' }, 'resilie', 'L’abonnement du cabinet est résilié.'],
    [{ aucun: true }, 'aucun', 'Aucun abonnement n’est ouvert pour ce cabinet.'],
  ] as const) {
    test(`message selon la situation : ${situation}`, async ({ page }) => {
      expect((await abonnement(corps)).situation).toBe(situation);
      await page.goto('/deposer');
      await expect(page.getByTestId('service-ferme')).toHaveAttribute('data-situation', situation);
      await expect(page.getByTestId('service-ferme')).toContainText(texte);
    });
  }
});

test.describe('service fermé — cabinet', () => {
  test.use({ storageState: etatDe('chloe') });
  test('dépôt ordinateur, import FEC et import de relevé remplacés par le message ; l’API refuse 403 « abonnement_inactif »', async ({ page }) => {
    // Résiliation programmée : le service reste ouvert jusqu'à l'échéance.
    await abonnement({ statut: 'resilie', fin: '2099-12-31' });
    await page.goto(`/dossiers/${ID.dupain}`);
    await expect(page.getByTestId('zone-depot')).toBeVisible();
    await abonnement({ statut: 'essai', finEssai: '2020-01-01' });
    for (const [chemin, absent] of [[`/dossiers/${ID.dupain}`, 'zone-depot'], [`/dossiers/${ID.dupain}/comptabilite`, 'entree-fec'], [`/dossiers/${ID.dupain}/banque`, 'entree-releve']] as const) {
      await page.goto(chemin);
      await expect(page.getByTestId('service-ferme')).toContainText('Ce n’est pas une panne');
      await expect(page.getByTestId(absent)).toHaveCount(0);
    }
    await expect(page.locator('tr[data-releve], [data-testid="imports-releves"]').first()).toBeAttached(); // consultation intacte
    const r = await page.evaluate(async (entiteId) => {
      const x = await fetch('/api/bff/v1/televersements', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ entiteId, nomFichier: 'a.pdf', taille: 3, sha256: 'a'.repeat(64), canal: 'ordinateur' }) });
      return { statut: x.status, corps: await x.json() };
    }, ID.dupain);
    expect(r).toMatchObject({ statut: 403, corps: { code: 'abonnement_inactif', situation: 'essai_expire' } });
  });

  test('onglet Analyse : balance, écart non forcé, projets d’états, indicateurs tracés jusqu’aux comptes, délais avec taux de TVA', async ({ page }) => {
    test.setTimeout(120_000);
    const erreurs = surveiller(page);
    // Données fictives initiales (3 lignes) : balance déséquilibrée, affichée telle quelle.
    await page.goto(`/dossiers/${ID.dupain}/analyse`);
    await expect(page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Analyse' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('mention-etats')).toContainText('PROJET');
    await expect(page.getByTestId('balance-equilibre')).toHaveText('Déséquilibrée — écart 179,50');
    await expect(page.getByTestId('totaux-balance')).toHaveText('Total des débits : 679,50 · Total des crédits : 500,00');
    // Projet de commentaire : aucune IA n'est connectée — le résultat est un repli sans IA, étiqueté, et rien n'est appliqué.
    const commentaire = page.locator('[data-bloc="commentaire-indicateurs"]');
    await commentaire.getByRole('button', { name: 'Préparer un commentaire des indicateurs' }).click();
    await expect(commentaire.getByTestId('origine-proposition')).toHaveText('Repli déterministe, sans IA');
    await expect(commentaire.getByTestId('etat-ia-tache')).toContainText('IA non connectée');
    await expect(commentaire).toContainText('rien n’a été appliqué ni enregistré');
    await expect(page.getByTestId('correspondance')).toContainText('en attente de validation professionnelle');
    await expect(page.locator('[data-controle-etat="ecart"]').first()).toBeVisible(); // jamais d'égalité forcée
    // Exercice ouvert avant 2025 : pas de table de correspondance, seule la balance est donnée.
    await simulateur('administration', { exercice: { debut: '2024-01-01', fin: '2024-12-31' } });
    await page.reload();
    await expect(page.getByTestId('sans-correspondance')).toContainText('exercice ouvert avant le 1er janvier 2025');
    await expect(page.getByTestId('bilan')).toHaveCount(0);
    await expect(page.getByTestId('balance-equilibre')).toBeVisible();
    await simulateur('administration', { exercice: { debut: '2025-01-01', fin: '2025-12-31' } });

    // FEC synthétique analysé par le vrai moteur.
    await page.goto(`/dossiers/${ID.dupain}/comptabilite`);
    await page.getByTestId('entree-fec').setInputFiles({ name: fec.nomFichier, mimeType: 'text/plain', buffer: Buffer.from(fec.contenu) });
    await page.getByRole('radio', { name: 'FEC', exact: true }).check();
    await page.getByRole('button', { name: 'Importer' }).click();
    await expect(page.locator('tr[data-actif="true"]')).toContainText('v3', { timeout: 20_000 });
    const lignes: LigneFec[] = [];
    await analyserFec(enBlocs(fec.contenu), { surLigne: (l) => void lignes.push(l) });
    const comptes = new Set(lignes.map((l) => l.compteNum)).size;

    await page.getByRole('navigation', { name: 'Sections du dossier' }).getByRole('link', { name: 'Analyse' }).click();
    await expect(page.getByTestId('balance-equilibre')).toHaveText('Équilibrée');
    await expect(page.getByRole('heading', { name: `Balance (${comptes} comptes)` })).toBeVisible();
    const totaux = await page.getByTestId('totaux-balance').innerText();
    const [, debit, credit] = /débits : ([\d ]+,\d{2}) · Total des crédits : ([\d ]+,\d{2})/.exec(totaux)!;
    expect(debit).toBe(credit);
    // Recherche de compte et pagination locale.
    const balance = page.getByRole('region', { name: 'Balance des comptes' }).locator('tbody tr');
    await expect(balance).toHaveCount(Math.min(50, comptes));
    await page.getByLabel('Rechercher un compte (numéro ou libellé)').fill('512');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(balance.first()).toContainText('512');
    for (const texte of await balance.locator('th .font-mono').allInnerTexts()) expect(texte.startsWith('512')).toBe(true);
    await page.getByRole('link', { name: 'Tous les comptes' }).click();

    // Projets d'états.
    for (const id of ['compte-de-resultat', 'bilan']) {
      const etat = page.getByTestId(id);
      await expect(etat.getByTestId('mention-projet-etat')).toHaveText('PROJET');
      await expect(etat.getByTestId('controles-internes')).toBeVisible();
      await expect(etat.getByTestId(`${id}-totaux`).locator('dd').first()).toHaveText(/^−?[\d ]+,\d{2}$/);
    }
    await expect(page.getByTestId('bilan').getByRole('columnheader', { name: 'Amortissements et dépréciations' })).toBeVisible();
    await expect(page.getByTestId('bilan').getByRole('columnheader', { name: 'Brut' })).toBeVisible();
    await expect(page.getByTestId('bilan').getByRole('columnheader', { name: 'Net' })).toBeVisible();

    // Indicateurs : valeur formatée, composantes jusqu'aux comptes ; non calculable avec son motif, jamais un zéro.
    const calcule = page.locator('[data-indicateur][data-statut="calcule"]').filter({ has: page.getByTestId('composantes') }).first();
    await expect(calcule.getByTestId('valeur-indicateur')).toHaveText(/[\d ]+(,\d+)?( (€|jours|%))?$/);
    await calcule.getByText(/^Composantes \(\d+\)$/).click();
    await calcule.getByText(/^\d+ comptes?$/).first().click();
    await expect(calcule.getByTestId('comptes-composante').first().locator('li').first()).toHaveText(/^\d{3,} : −?[\d ]+,\d{2}$/);
    const nonCalculables = page.locator('[data-indicateur][data-statut="non_calculable"]');
    const avant = await nonCalculables.count();
    expect(avant).toBeGreaterThan(0);
    await expect(nonCalculables.first().getByTestId('non-calculable')).toContainText('Non calculable');
    await expect(nonCalculables.first().getByTestId('valeur-indicateur')).toHaveCount(0);
    expect((await nonCalculables.first().getByTestId('non-calculable').innerText()).length).toBeGreaterThan('Non calculable '.length + 10); // motif présent
    // Taux de TVA moyens : les délais deviennent calculables.
    await page.getByLabel('Taux de TVA moyen des ventes (%)').fill('20');
    await page.getByLabel('Taux de TVA moyen des achats (%)').fill('5,5');
    await page.getByRole('button', { name: 'Calculer les délais' }).click();
    await expect(page).toHaveURL(/tauxTvaVentes=20&tauxTvaAchats=5%2C5|tauxTvaVentes=20&tauxTvaAchats=5,5/);
    await expect.poll(async () => page.locator('[data-indicateur][data-statut="non_calculable"]').count()).toBeLessThan(avant);
    expect((await journal()).some((e) => /indicateurs\?tauxTvaVentes=20&tauxTvaAchats=5\.5$/.test(e.chemin))).toBe(true);
    await expect(page.locator('[data-famille="bfr"]').getByTestId('valeur-indicateur').filter({ hasText: 'jours' }).first()).toBeVisible();
    // Signaux : des questions, pas un diagnostic.
    const signaux = page.locator('[data-famille="signal"]');
    await expect(signaux.getByRole('heading')).toHaveText('Questions à examiner');
    await expect(signaux.getByTestId('phrase-signaux')).toContainText('ni un diagnostic, ni une appréciation de la continuité d’exploitation');

    await page.getByRole('link', { name: /Catalogue des indicateurs/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalogue des indicateurs');
    const definition = page.locator('[data-definition]').first();
    for (const libelle of ['Formule', 'Convention', 'Si une donnée manque', 'Source']) await expect(definition.getByText(libelle, { exact: true })).toBeVisible();
    expect(erreurs).toEqual([]);
  });
});

test.describe('analyse — sans donnée', () => {
  test.use({ storageState: etatDe('remi') });
  test('exercice sans import : états et indicateurs non calculables, dit clairement', async ({ page }) => {
    await page.goto(`/dossiers/${ID.martin}/analyse`);
    await expect(page.getByTestId('etats-indisponibles')).toContainText('Aucune donnée comptable importée pour cet exercice');
    await expect(page.getByTestId('indicateurs-indisponibles')).toContainText('non calculable');
  });
});

test.describe('abonnement — administratrice', () => {
  test.use({ storageState: etatDe('alice') });
  test('situation, offre fictive, quotas, estimation, échéances, changement d’offre, résiliation confirmée', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/administration');
    await page.getByRole('link', { name: 'Abonnement du cabinet' }).click();
    await expect(page.getByTestId('situation-abonnement')).toHaveText('Période d’essai');
    expect(await page.getByTestId('montants-fictifs').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('montants-fictifs').first()).toHaveText('Montants de démonstration fictifs');
    await expect(page.getByRole('heading', { name: 'Offre : Essentiel (démonstration)' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Du 3ᵉ au 10ᵉ dossier/ })).toContainText('4,00');
    await expect(page.getByRole('row', { name: /À partir du 11ᵉ dossier/ })).toContainText('3,00');
    // Quotas : dépassement signalé, non bloquant.
    const pieces = page.locator('[data-quota="Pièces reçues ce mois"]');
    await expect(pieces).toContainText('7 pièces sur 5 inclus');
    await expect(pieces).toContainText('Quota dépassé');
    await expect(page.locator('[data-quota="Stockage"]')).not.toContainText('Quota dépassé');
    await expect(page.locator('[data-quota="Dossiers actifs"]')).toContainText('2 pour 2 inclus');
    await expect(page.getByTestId('quota-non-bloquant')).toContainText('n’empêche pas la collecte');
    // Estimation calculée par le moteur (aucun calcul dans l'interface).
    const estimation = page.getByTestId('estimation');
    await expect(estimation.getByRole('row').nth(1)).toContainText('49,00');
    await expect(estimation).toContainText('Total HT estimé : 49,00');
    await expect(estimation).toContainText('C’est une estimation, pas une facture');
    // Échéances : virement, référence, aucun bouton de paiement.
    const echeance = page.locator('tr[data-echeance]');
    await expect(echeance).toContainText('En attente du virement');
    await expect(echeance).toContainText('CMT-ALPHA-2026-10');
    await expect(echeance).toContainText('Montants de démonstration fictifs');
    await expect(page.getByTestId('paiement-editeur')).toContainText('Les paiements sont rapprochés par l’éditeur');
    await expect(page.getByRole('button', { name: /pay/i })).toHaveCount(0);

    const changement = page.locator('form[data-formulaire="changer-offre"]');
    await expect(changement.getByRole('button', { name: 'Demander ce changement' })).toBeDisabled();
    await changement.getByLabel('Offre souhaitée').selectOption('demo-etendu');
    const demande = page.waitForRequest((r) => r.url().endsWith('/abonnement/changement'));
    await changement.getByRole('button', { name: 'Demander ce changement' }).click();
    expect((await demande).postDataJSON()).toEqual({ offre: 'demo-etendu' });
    await expect(page.getByTestId('changement-demande')).toContainText('Étendu (démonstration)');
    await expect(page.getByTestId('changement-demande')).toContainText('appliqué à la prochaine échéance');
    await expect(page.getByRole('heading', { name: 'Offre : Essentiel (démonstration)' })).toBeVisible(); // pas appliqué tout de suite

    await page.getByRole('button', { name: 'Résilier l’abonnement…' }).click();
    const resiliation = page.locator('form[data-formulaire="resilier"]');
    await expect(resiliation).toContainText('Vos données ne sont pas supprimées par la résiliation');
    await expect(resiliation).toContainText('jusqu’à la fin du mois en cours');
    await resiliation.getByRole('button', { name: 'Confirmer la résiliation' }).click();
    await expect(resiliation.getByRole('alert')).toContainText('motif');
    await resiliation.getByLabel('Motif (obligatoire)').fill('Fin de l’essai de démonstration.');
    await resiliation.getByRole('button', { name: 'Confirmer la résiliation' }).click();
    await expect(resiliation.getByRole('alert')).toContainText('Cochez la case de confirmation');
    expect((await journal()).some((e) => e.chemin.endsWith('/resiliation'))).toBe(false);
    await resiliation.getByLabel('Je confirme vouloir résilier l’abonnement du cabinet').check();
    await resiliation.getByRole('button', { name: 'Confirmer la résiliation' }).click();
    await expect(page.getByTestId('situation-abonnement')).toHaveText('Résiliation programmée');
    await expect(page.getByTestId('resiliation-programmee')).toContainText('le service reste ouvert jusqu’au');
    await expect(page.locator('form[data-formulaire="changer-offre"]')).toHaveCount(0);
    await expect(page.getByTestId('historique-abonnement')).toContainText('Résiliation');
    await expect(page.getByTestId('historique-abonnement')).toContainText('Changement d’offre demandé');
    await expect(page.getByTestId('service-ferme')).toHaveCount(0); // encore ouvert jusqu'à l'échéance
    expect(erreurs).toEqual([]);
  });
});

test.describe('abonnement — non gestionnaire', () => {
  test.use({ storageState: etatDe('remi') });
  test('écran refusé ; seule la situation est lisible', async ({ page }) => {
    await page.goto('/administration/abonnement');
    await expect(page.getByTestId('erreur-403')).toContainText('réservé aux administrateurs et associés');
    const statuts = await page.evaluate(async () => {
      const s = async (c: string) => (await fetch(`/api/bff/v1/abonnement${c}`)).status;
      return [await s('/situation'), await s(''), await s('/offres'), await s('/echeances'), await s('/historique')];
    });
    expect(statuts).toEqual([200, 403, 403, 403, 403]);
  });
});
