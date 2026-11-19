import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { ID, etatDe, etatSimule, journal, pdf, simulateur, surveiller } from '../outils';

const dossier = `/dossiers/${ID.dupain}`;
const piece = async (page: Page, nom: string) => {
  await page.goto(dossier);
  await page.getByRole('link', { name: nom }).click();
  await expect(page.getByRole('heading', { level: 2, name: nom })).toBeVisible();
};

test.beforeEach(async () => {
  await simulateur('reinitialiser');
});

test.describe('espace cabinet — collaboratrice (niveau collaboration)', () => {
  test.use({ storageState: etatDe('chloe') });

  test('tableau de bord, liste des dossiers, onglets du dossier', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
    // Navigation au clavier : le lien d'évitement est le premier élément atteint, le focus est visible.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe('none');
    await expect(page.getByRole('heading', { name: 'Boulangerie Dupain SAS (fictive)' })).toBeVisible();
    await expect(page.getByText('À contrôler : 1')).toBeVisible();
    await expect(page.getByText('À compléter : 1')).toBeVisible();
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Dossiers' }).click();
    const ligne = page.locator(`tr[data-dossier="${ID.dupain}"]`);
    await expect(ligne).toContainText('Collaboration');
    await ligne.getByRole('link', { name: 'Boulangerie Dupain SAS (fictive)' }).click();
    const onglets = page.getByRole('navigation', { name: 'Sections du dossier' });
    await expect(onglets.getByRole('link')).toHaveText(['Pièces', 'Comptabilité', 'Banque', 'Révision', 'Analyse', 'Inventaire', 'Mission', 'Veille']); // « Restitution » : niveau validation seulement
    await expect(onglets.getByRole('link', { name: 'Pièces' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Habilitation : Collaboration')).toBeVisible();
    expect(erreurs).toEqual([]);
  });

  test('pièces : file par statut et dépôt depuis l’ordinateur (canal « ordinateur », protocole reprenable)', async ({ page }) => {
    await page.goto(dossier);
    await expect(page.getByRole('link', { name: 'Toutes (4)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'À compléter (1)' })).toBeVisible();
    await page.getByRole('link', { name: 'À contrôler (1)' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('facture-meunerie-2025-03.pdf');
    await page.getByRole('link', { name: 'Toutes (4)' }).click();
    await expect(page.locator('tbody tr').first()).toContainText('photo-ticket-caisse.png'); // « À compléter » en tête de file

    await page.getByLabel('Nature des pièces déposées').selectOption('facture_vente');
    await simulateur('pannes', { erreurTerminer: 1 });
    await page.getByTestId('entree-pieces').setInputFiles({ name: 'facture-client-42.pdf', mimeType: 'application/pdf', buffer: pdf('ordinateur') });
    const envoi = page.getByTestId('liste-envois').getByRole('listitem');
    await expect(envoi).toContainText('Interrompu — reprendre'); // clôture refusée une fois : pas « Reçu »
    await envoi.getByRole('button', { name: 'Reprendre l’envoi' }).click();
    await expect(envoi).toContainText('Reçu');
    await expect(page.getByRole('link', { name: 'Toutes (5)' })).toBeVisible();
    const doc = (await etatSimule()).documents.find((d) => d.nomOrigine === 'facture-client-42.pdf')!;
    expect(doc).toMatchObject({ nature: 'facture_vente', canal: 'ordinateur', statut: 'recu' });
    const puts = (await journal()).filter((e) => e.methode === 'PUT');
    expect(puts.length).toBeGreaterThan(1); // envoyé par morceaux, une seule fois malgré la reprise
    expect(new Set(puts.map((e) => e.chemin)).size).toBe(puts.length);
  });

  test('revue d’une pièce : aperçu, champs avec preuve, vérifications, correction, qualification, demande de complément ; pas de validation', async ({ page }) => {
    const erreurs = surveiller(page);
    await piece(page, 'facture-meunerie-2025-03.pdf');
    await expect(page.getByText('Projet — non validé')).toBeVisible();
    await expect(page.getByText('Extraction automatique — projet')).toBeVisible();
    await expect(page.getByTestId('apercu-piece')).toHaveAttribute('data-type', 'application/pdf');
    const champ = (nom: string) => page.locator(`tr[data-champ="${nom}"]`);
    await expect(champ('totalHt')).toContainText('1 234,56');
    await expect(champ('totalHt')).toContainText('Page 1');
    await expect(champ('totalHt')).toContainText('Total HT 1 234,56'); // extrait de texte servant de preuve
    await expect(champ('totalHt')).toContainText('Règle');
    await expect(page.locator('[data-verification="ecart"]')).toContainText('Écart : 0,04');
    await expect(page.locator('[data-verification="non_verifiable"]')).toBeVisible();
    // Valider / Rejeter réservés au niveau « révision ».
    await expect(page.getByTestId('decision-reviseur')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Valider/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rejeter' })).toHaveCount(0);

    // Correction : montant saisi avec une virgule, transmis en chaîne décimale.
    const correction = page.locator('form[data-formulaire="correction"]');
    await correction.getByLabel('Total TTC').fill('1 302,46');
    await expect(correction.getByText('Champs modifiés : Total TTC.')).toBeVisible();
    const requete = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/extraction'));
    await correction.getByRole('button', { name: 'Enregistrer la correction' }).click();
    expect((await requete).postDataJSON()).toEqual({ champs: { totalTtc: '1302.46' } });
    await expect(page.getByText('Correction enregistrée')).toBeVisible();
    await expect(champ('totalTtc')).toContainText('1 302,46');
    await expect(champ('totalTtc')).toContainText('Saisie humaine');
    await expect(page.locator('[data-verification="ok"]')).toContainText('cohérent');
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Projet — non validé')).toBeVisible(); // une correction reste un projet
    // Montant invalide : refusé par l'API, message affiché.
    await correction.getByLabel('Total HT').evaluate((e: HTMLInputElement) => e.removeAttribute('pattern'));
    await correction.getByLabel('Total HT').fill('12e3');
    await correction.getByRole('button', { name: 'Enregistrer la correction' }).click();
    await expect(correction.getByRole('alert')).toContainText('Requête invalide');
    await expect(correction.getByRole('alert')).toContainText('champs.totalHt');

    const qualification = page.locator('form[data-formulaire="qualification"]');
    await qualification.getByLabel('Nature').selectOption('avoir');
    await qualification.getByLabel('Exercice de rattachement').selectOption({ label: 'Du 01/01/2025 au 31/12/2025' });
    await qualification.getByRole('button', { name: 'Enregistrer la qualification' }).click();
    await expect(page.getByText('Qualification enregistrée.')).toBeVisible();
    await expect(page.locator('dl').getByText('Du 01/01/2025 au 31/12/2025')).toBeVisible();

    const demande = page.locator('form[data-formulaire="demande_complement"]');
    await demande.getByLabel('Complément demandé').fill('Merci de joindre le bon de livraison.');
    await demande.getByRole('button', { name: 'Demander un complément' }).click();
    await expect(page.getByText('Demande envoyée')).toBeVisible();
    await expect(page.getByTestId('entete-piece')).toContainText('À compléter');
    const etat = await etatSimule();
    expect(etat.documents.find((d) => d.nomOrigine === 'facture-meunerie-2025-03.pdf')).toMatchObject({ nature: 'avoir', statut: 'a_completer' });
    expect(erreurs).toEqual([]);
  });

  test('comptabilité : versions des lots, lot actif, trois indicateurs distincts, anomalies par code et détail paginé', async ({ page }) => {
    await page.goto(`${dossier}/comptabilite`);
    await expect(page.getByLabel('Exercice', { exact: true })).toContainText('Du 01/01/2025 au 31/12/2025');
    const lots = page.locator('tr[data-lot]');
    await expect(lots).toHaveCount(2);
    await expect(lots.nth(0)).toContainText('v2');
    await expect(lots.nth(0)).toContainText('Lot actif');
    await expect(lots.nth(0)).toHaveAttribute('data-actif', 'true');
    await expect(lots.nth(0)).toContainText('FEC');
    await expect(lots.nth(1)).toContainText('Données de travail avant clôture');
    await expect(lots.nth(1)).not.toContainText('Lot actif');
    // Le lot actif est mis en évidence (fond différent).
    const fond = (i: number) => lots.nth(i).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await fond(0)).not.toBe(await fond(1));

    const rapport = page.getByTestId('rapport-import');
    await expect(rapport).toContainText('Rapport d’import — version 2');
    await expect(rapport.locator('[data-indicateur]')).toHaveText([/^Lisible : oui/, /^Conforme au référentiel contrôlé : oui/, /^Suffisant pour les travaux : oui/]);
    await expect(rapport).toContainText('1 234 567,89');
    await expect(rapport).toContainText('Aucune anomalie relevée par les contrôles implémentés');

    await lots.nth(1).getByRole('link', { name: 'Voir le rapport' }).click();
    await expect(rapport).toContainText('Rapport d’import — version 1');
    await expect(rapport.locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true');
    await expect(rapport.locator('[data-indicateur="Conforme au référentiel contrôlé"]')).toHaveAttribute('data-valeur', 'false');
    await expect(rapport.locator('[data-indicateur="Conforme au référentiel contrôlé"]')).toContainText('non');
    await expect(rapport.locator('[data-indicateur="Suffisant pour les travaux"]')).toHaveAttribute('data-valeur', 'true');
    await expect(rapport.getByRole('row', { name: /CHAMP_VIDE 60/ })).toBeVisible();
    await expect(rapport.getByRole('row', { name: /DATE_INVALIDE 60/ })).toBeVisible();
    // Pagination et filtre par code faits par le serveur (GET v1/imports/:id/anomalies).
    await expect(rapport.getByRole('heading', { name: /Détail ligne par ligne — 1 à 100 sur 120/ })).toBeVisible();
    await expect(rapport.getByText('Page 1 sur 2')).toBeVisible();
    await expect(rapport.getByText('Libellé d’écriture vide (ligne 52).')).toBeVisible();
    await rapport.getByRole('link', { name: 'Suivantes →' }).click();
    await expect(rapport.getByRole('heading', { name: /101 à 120 sur 120/ })).toBeVisible();
    await expect(rapport.getByText('Suivantes →')).not.toHaveAttribute('href');
    await rapport.getByRole('link', { name: 'Voir le détail des anomalies CHAMP_VIDE' }).click();
    await expect(rapport.getByRole('heading', { name: /Détail ligne par ligne \(CHAMP_VIDE\) — 1 à 60 sur 60/ })).toBeVisible();
    await expect(rapport.getByText('Date de pièce invalide')).toHaveCount(0);
    expect((await journal()).some((e) => /\/anomalies\?page=1&code=CHAMP_VIDE$/.test(e.chemin))).toBe(true);
    await rapport.getByRole('link', { name: 'Voir tous les codes' }).click();
    await expect(rapport.getByRole('heading', { name: /1 à 100 sur 120/ })).toBeVisible();
  });

  test('import comptable : choix explicite du statut des données, suivi de progression par interrogation, nouveau lot actif', async ({ page }) => {
    await page.goto(`${dossier}/comptabilite`);
    const importer = page.getByRole('button', { name: 'Importer' });
    await page.getByTestId('entree-fec').setInputFiles({ name: '123456789FEC20251231-v3.txt', mimeType: 'text/plain', buffer: Buffer.from(`JournalCode\tJournalLib\n${'VT\tVentes\n'.repeat(9000)}`) });
    await expect(importer).toBeDisabled(); // aucun statut présumé
    await expect(page.getByRole('radio', { name: 'FEC', exact: true })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: 'Données de travail avant clôture' })).not.toBeChecked();
    await page.getByRole('radio', { name: 'Données de travail avant clôture' }).check();
    const ouverture = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/bff/v1/televersements'));
    await importer.click();
    expect((await ouverture).postDataJSON()).toMatchObject({ usage: 'fec', statutDonnees: 'travail_avant_cloture', exerciceId: ID.exDupain, canal: 'ordinateur', entiteId: ID.dupain });
    // Suivi : le lot en attente puis en cours est interrogé périodiquement.
    await expect(page.getByTestId('suivi-import')).toBeVisible();
    await expect(page).toHaveURL(/lot=[0-9a-f-]{36}/);
    await expect(page.getByTestId('suivi-import')).toContainText('lignes enregistrées');
    const rapport = page.getByTestId('rapport-import');
    await expect(rapport.locator('[data-indicateur="Lisible"]')).toHaveAttribute('data-valeur', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('suivi-import')).toHaveCount(0);
    await expect(rapport).toContainText('Rapport d’import — version 3');
    await expect(rapport).toContainText('Lot actif');
    await expect(page.locator('tr[data-lot]')).toHaveCount(3);
    await expect(page.locator('tr[data-actif="true"]')).toHaveCount(1);
    await expect(page.locator('tr[data-actif="true"]')).toContainText('v3');
    const sondages = (await journal()).filter((e) => e.methode === 'GET' && /^\/v1\/imports\//.test(e.chemin));
    expect(sondages.length).toBeGreaterThanOrEqual(1);
  });

  test('révision au niveau collaboration : actions de réviseur absentes, refus de l’API affiché', async ({ page }) => {
    await page.goto(`${dossier}/revision`);
    await page.getByTestId('liste-constats').getByRole('link', { name: /Caisse créditrice/ }).click();
    const actions = page.locator('form[data-formulaire="constat"]').getByLabel('Action');
    await expect(actions.locator('option')).toHaveText(['Prendre en charge', 'Affecter', 'Commenter', 'Demander une pièce', 'Marquer comme corrigé']);
    // Requête forgée vers une action de réviseur : l'API répond 403, relayé tel quel.
    const id = page.url().split('/').pop()!;
    const statut = await page.evaluate(async (c) => (await fetch(`/api/bff/v1/constats/${c}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Comtaple-Csrf': '1' }, body: JSON.stringify({ action: 'accepter', motif: 'x' }) })).status, id);
    expect(statut).toBe(403);
    await page.locator('form[data-formulaire="constat"]').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Action enregistrée : prendre en charge.')).toBeVisible();
    await expect(page.getByTestId('historique-decisions')).toContainText('Chloé Collab');
  });

  test('catalogue des contrôles', async ({ page }) => {
    await page.goto('/reference/controles');
    await expect(page.locator('[data-controle]')).toHaveCount(12);
    const caisse = page.locator('[data-controle="TRE-001"]');
    await expect(caisse).toContainText('Caisse créditrice');
    await expect(caisse).toContainText('Règle réglementaire');
    await expect(caisse).toContainText('Source vérifiée');
    await expect(caisse).toContainText('le 19/11/2026');
    await expect(page.locator('[data-controle="GEN-005"]')).toContainText('seuil');
    await expect(page.locator('[data-controle="GEN-001"]')).toContainText('Règle interne');
  });
});

test.describe('espace cabinet — réviseur (niveau révision)', () => {
  test.use({ storageState: etatDe('remi') });

  test('validation d’une pièce : rappel de la version, rejet sans motif refusé, validation', async ({ page }) => {
    await piece(page, 'facture-meunerie-2025-03.pdf');
    const decision = page.getByTestId('decision-reviseur');
    await expect(decision).toContainText('La validation porte sur la version 1 affichée');
    await decision.getByRole('button', { name: 'Rejeter' }).click();
    await expect(decision.getByRole('alert')).toContainText('Un motif est requis pour rejeter');
    expect((await journal()).some((e) => e.chemin.endsWith('/validation'))).toBe(false);
    const requete = page.waitForRequest((r) => r.url().endsWith('/validation'));
    await decision.getByRole('button', { name: 'Valider la version 1' }).click();
    expect((await requete).postDataJSON()).toEqual({ decision: 'valider' });
    await expect(page.getByText('Validé par un réviseur (version 1)')).toBeVisible();
    await expect(page.getByText('Projet — non validé')).toHaveCount(0);
    await expect(page.getByTestId('entete-piece')).toContainText('Traité');
  });

  test('révision : cinq statuts de contrôle distincts, « non réalisé » jamais présenté comme un succès', async ({ page }) => {
    const erreurs = surveiller(page);
    await page.goto(`${dossier}/revision`);
    await expect(page.getByText('Projet — non validé')).toBeVisible();
    const synthese = page.getByTestId('synthese-controles');
    await expect(synthese.getByRole('listitem')).toHaveText([
      /Constat à examiner\s*3/,
      /Erreur technique\s*1/,
      /Non réalisé faute de données\s*2/,
      /Non applicable\s*1/,
      /Exécuté sans anomalie détectée\s*5/,
    ]);
    await expect(page.locator('tr[data-controle]')).toHaveCount(12);
    // Apparence : cinq rendus différents (couleur de fond, bordure) et cinq icônes différentes.
    const rendu = (statut: string) =>
      page.locator(`tr[data-statut="${statut}"] [data-statut-controle]`).first().evaluate((e) => {
        const s = getComputedStyle(e);
        return { fond: s.backgroundColor, bordure: s.borderTopStyle, texte: s.color, icone: e.querySelector('svg')!.innerHTML };
      });
    const statuts = ['sans_anomalie', 'constat', 'non_applicable', 'non_realise', 'erreur'];
    const rendus = await Promise.all(statuts.map(rendu));
    expect(new Set(rendus.map((r) => `${r.fond}|${r.bordure}`)).size).toBe(5);
    expect(new Set(rendus.map((r) => r.icone)).size).toBe(5);
    const [succes, , , nonRealise] = rendus;
    expect(nonRealise!.fond).not.toBe(succes!.fond);
    expect(nonRealise!.texte).not.toBe(succes!.texte);
    expect(nonRealise!.bordure).toBe('dashed');
    const ligne = page.locator('tr[data-controle="TIE-003"]');
    await expect(ligne).toContainText('Non réalisé faute de données');
    await expect(ligne).toContainText('Dates de lettrage absentes');
    await expect(ligne).toContainText('aucune conclusion ne peut en être tirée');
    await expect(page.locator('tr[data-controle="CAP-001"]')).toContainText('Erreur technique');
    await expect(page.locator('tr[data-controle="GEN-004"]')).toContainText('Non applicable');
    await expect(page.getByTestId('bandeau-obsolete')).toHaveCount(0);
    expect(erreurs).toEqual([]);
  });

  test('constats : filtres, détail (explication, montant, preuves, écritures, source, historique), motif obligatoire', async ({ page }) => {
    const erreurs = surveiller(page);
    let alerte = false;
    page.on('dialog', async (d) => {
      alerte = true;
      await d.dismiss();
    });
    await page.goto(`${dossier}/revision`);
    const constats = page.getByTestId('liste-constats').getByRole('listitem');
    await expect(constats).toHaveCount(3);
    const effacerFiltres = async () => {
      await page.getByRole('link', { name: 'Effacer les filtres' }).click();
      await expect(page.getByRole('link', { name: 'Effacer les filtres' })).toHaveCount(0); // formulaire réinitialisé
      await expect(page.getByLabel('Gravité')).toHaveValue('');
    };
    await page.getByLabel('Gravité').selectOption('critique');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(constats).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Constats (1 sur 3)' })).toBeVisible();
    await effacerFiltres();
    await page.getByLabel('Statut de revue').selectOption('accepte');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(constats).toHaveCount(1);
    await expect(constats).toContainText('Client 411DUPONT créditeur');
    await effacerFiltres();
    await page.getByLabel('À revoir uniquement').check();
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(constats).toHaveCount(1);
    await expect(constats).toContainText('À revoir : données modifiées depuis la décision');
    await page.getByLabel('Gravité').selectOption('critique');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page.getByText('Aucun constat ne correspond à ces filtres.')).toBeVisible();
    await effacerFiltres();

    await constats.getByRole('link', { name: 'Caisse créditrice au 14/03/2025' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Caisse créditrice au 14/03/2025' })).toBeVisible();
    await expect(page.getByText('Le solde du compte 530000 devient créditeur')).toBeVisible();
    await expect(page.getByText('Montant concerné :').locator('..')).toContainText('−320,50'); // chaîne négative mise en forme sans flottant
    await expect(page.getByTestId('preuves')).toContainText('Solde constaté');
    await expect(page.getByRole('heading', { name: 'Écritures concernées (3)' })).toBeVisible();
    // Libellé d'écriture hostile : affiché comme du texte, jamais interprété.
    await expect(page.getByRole('cell', { name: 'Retrait espèces <script>alert(1)</script>' })).toBeVisible();
    await expect(page.getByRole('row', { name: /CA11/ })).toContainText('500,00');
    const source = page.getByTestId('source-regle');
    await expect(source).toContainText('Règle réglementaire');
    await expect(source).toContainText('art. 1215-53');
    await expect(source).toContainText('Source vérifiée');
    await expect(source).toContainText('le 19/11/2026');
    await expect(source.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByText('Aucune décision enregistrée.')).toBeVisible();

    const formulaire = page.locator('form[data-formulaire="constat"]');
    await expect(formulaire.getByLabel('Action').locator('option')).toHaveCount(10);
    await formulaire.getByLabel('Action').selectOption('confirmer_anomalie');
    await expect(formulaire.getByLabel('Motif (obligatoire)')).toHaveAttribute('required', '');
    // Contournement de la contrainte du formulaire : le motif reste exigé avant tout envoi.
    await formulaire.evaluate((f: HTMLFormElement) => (f.noValidate = true));
    await formulaire.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(formulaire.getByRole('alert')).toContainText('Un motif est requis');
    expect((await journal()).some((e) => e.methode === 'PATCH')).toBe(false);
    await formulaire.getByLabel('Motif (obligatoire)').fill('Recette du 14/03 non enregistrée, confirmée par le client.');
    await formulaire.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Action enregistrée : confirmer l’anomalie.')).toBeVisible();
    await expect(page.getByText('Anomalie confirmée', { exact: true })).toBeVisible();
    const historique = page.getByTestId('historique-decisions');
    await expect(historique).toContainText('Confirmer l’anomalie');
    await expect(historique).toContainText('Rémi Réviseur');
    await expect(historique).toContainText('Recette du 14/03 non enregistrée');
    await expect(historique).toContainText('version des données 2');

    // Constat déjà traité : son historique mentionne la décision antérieure.
    await page.getByRole('link', { name: '← Retour à la révision' }).click();
    await page.getByRole('link', { name: 'Client 411DUPONT créditeur' }).click();
    await expect(page.getByTestId('historique-decisions')).toContainText('Avoir à établir en janvier');
    await expect(page.getByTestId('source-regle')).toContainText('Règle interne');
    expect(alerte).toBe(false);
    expect(erreurs).toEqual([]);
  });

  test('bandeau « obsolète », relance des contrôles, dossier de révision « Projet » généré puis téléchargé via le BFF', async ({ page }) => {
    await simulateur('obsolete', {});
    await page.goto(`${dossier}/revision`);
    await expect(page.getByTestId('bandeau-obsolete')).toContainText('Les données comptables ont changé depuis cette exécution');
    await page.getByRole('button', { name: 'Relancer les contrôles' }).click();
    await expect(page.getByText('Nouvelle exécution des contrôles demandée.')).toBeVisible();
    await expect(page.getByText('Contrôles en cours d’exécution')).toBeVisible();
    // La page se met à jour seule quand l'exécution est terminée.
    await expect(page.getByTestId('bandeau-obsolete')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('tr[data-controle]')).toHaveCount(12, { timeout: 15_000 });
    await expect(page.getByText('Contrôles en cours d’exécution')).toHaveCount(0);
    // La décision antérieure est reportée mais marquée « à revoir ».
    await expect(page.getByTestId('liste-constats')).toContainText('À revoir : données modifiées depuis la décision');

    const exports = page.locator('tr[data-export]');
    await expect(exports).toHaveCount(1);
    await page.getByRole('button', { name: 'Générer le dossier de révision (projet)' }).click();
    await expect(page.getByText('Génération demandée.')).toBeVisible();
    await expect(exports).toHaveCount(2);
    await expect(exports.first()).toContainText('Non disponible');
    await expect(exports.first().getByRole('link', { name: 'PDF (projet)' })).toBeVisible({ timeout: 15_000 });
    await expect(exports.first()).toContainText('Projet');
    const telechargement = page.waitForEvent('download');
    await exports.first().getByRole('link', { name: 'PDF (projet)' }).click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toMatch(/^dossier-revision-[0-9a-f-]{36}\.pdf$/);
    expect(readFileSync(await fichier.path()).subarray(0, 5).toString()).toBe('%PDF-');
    const donnees = page.waitForEvent('download');
    await exports.first().getByRole('link', { name: 'Données (projet)' }).click();
    expect(JSON.parse(readFileSync(await (await donnees).path(), 'utf8'))).toMatchObject({ mention: 'projet' });
  });

  test('exercice sans donnée : aucun contrôle exécuté, relance refusée proprement (409)', async ({ page }) => {
    await page.goto(`/dossiers/${ID.martin}/revision`);
    await expect(page.getByText('Aucun contrôle n’a encore été exécuté pour cet exercice')).toBeVisible();
    await page.getByRole('button', { name: 'Relancer les contrôles' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Aucune donnée comptable importée' })).toBeVisible();
    await page.getByRole('button', { name: 'Générer le dossier de révision (projet)' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Aucune exécution de contrôles terminée' })).toBeVisible();
    await page.goto(`/dossiers/${ID.martin}/comptabilite`);
    await expect(page.getByText('Aucune donnée comptable importée pour cet exercice.')).toBeVisible();
  });
});

test.describe('espace cabinet — administratrice non habilitée sur un dossier', () => {
  test.use({ storageState: etatDe('alice') });

  test('dossier « non habilité » sans lien ; accès direct refusé proprement', async ({ page }) => {
    await page.goto('/dossiers');
    const martin = page.locator(`tr[data-dossier="${ID.martin}"]`);
    await expect(martin).toContainText('Garage Martin SARL (fictif)');
    await expect(martin).toContainText('Non habilité');
    await expect(martin.getByRole('link')).toHaveCount(0);
    await expect(page.locator(`tr[data-dossier="${ID.dupain}"]`).getByRole('link')).toHaveCount(1);
    await expect(page.locator(`tr[data-dossier="${ID.dupain}"]`)).toContainText('Validation');
    // Recherche par nom (sans tenir compte des accents ni de la casse) et filtre « habilité », par l'adresse : sans script.
    await page.getByRole('search', { name: 'Rechercher un dossier' }).getByLabel('Nom du dossier').fill('BOULANGERIE');
    await page.getByRole('search', { name: 'Rechercher un dossier' }).getByRole('button', { name: 'Rechercher' }).click();
    await expect(page).toHaveURL(/\/dossiers\?q=BOULANGERIE/);
    await expect(page.locator('tr[data-dossier]')).toHaveCount(1);
    await expect(page.getByTestId('decompte-dossiers')).toContainText('1 dossier sur');
    await page.goto('/dossiers?habilites=1');
    await expect(page.locator(`tr[data-dossier="${ID.martin}"]`)).toHaveCount(0);
    await page.goto('/dossiers?q=introuvable-xyz');
    await expect(page.getByText('Aucun dossier ne correspond à cette recherche.')).toBeVisible();
    await page.goto('/dossiers');
    for (const suffixe of ['', '/comptabilite', '/revision']) {
      await page.goto(`/dossiers/${ID.martin}${suffixe}`);
      await expect(page.getByTestId('erreur-403')).toContainText('Vous n’êtes pas habilité à consulter ce dossier');
    }
    // Le dossier non habilité n'est pas proposé au dépôt.
    await page.goto('/deposer');
    await expect(page.getByTestId('dossier-unique')).toHaveText('Boulangerie Dupain SAS (fictive)');
    await page.goto('/');
    await expect(page.getByText('1 autre du cabinet sans habilitation')).toBeVisible();
  });
});
