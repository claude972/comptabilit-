// Captures de l'écran « États fiscaux » (comparatif N / N-1, tableaux 2054 / 2055 / 2033-C, euros entiers) sur un dossier fictif.
// Usage : node tests/reel/captures-fiscal.mjs <dossierId> <exerciceId> [--qualifier]   (écrit dans var/captures/)
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
const [dossier, exercice] = process.argv.slice(2, 4);
const mdp = /^DEV_MDP_UTILISATEURS=(.*)$/m.exec(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'))[1].trim();
const sortie = fileURLToPath(new URL('../../../../var/captures/', import.meta.url));
mkdirSync(sortie, { recursive: true });
const nav = await chromium.launch();
const ctx = await nav.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const base = `http://localhost:3100/dossiers/${dossier}/fiscal?exercice=${exercice}`;
await page.goto(base);
await page.getByRole('link', { name: 'Se connecter' }).click();
await page.locator('#username').fill('remi.reviseur@cabinet-a.test');
await page.locator('#password').fill(mdp);
await page.locator('#kc-login').click();
await page.waitForURL(/^http:\/\/localhost:3100\//);
// Captures ciblées (la page complète fait plus de 20 000 px) : bilan N / N-1, puis tableau 2054, puis 2033-C.
async function cible(nom, url, titre, hauteur = 1000) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const t = typeof titre === 'string' ? page.getByTestId(titre) : page.getByRole('heading', { name: titre }).first();
  await t.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({ path: `${sortie}${nom}.png` });
}
await cible('fiscal-bilan-n-n1-centimes', `${base}&vue=liasse&regime=reel_normal`, /^2050/);
await cible('fiscal-2054-euros', `${base}&vue=liasse&regime=reel_normal&montants=euros`, 'tableaux-immobilisations');
await cible('fiscal-2055-centimes', `${base}&vue=liasse&regime=reel_normal`, 'immobilisations-fichier');
await cible('fiscal-2033c-euros', `${base}&vue=liasse&regime=reel_simplifie&montants=euros`, 'tableaux-immobilisations');
// Détail 2052 / 2053 (D-106) : avant et après la qualification d'un compte par le formulaire (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--qualifier')) {
  const detail = `${base}&vue=liasse&regime=reel_normal`;
  await page.goto(detail);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-resultat').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -20));
  await page.screenshot({ path: `${sortie}fiscal-detail-avant.png` });
  const f = page.getByTestId('qualifier-707100');
  await f.scrollIntoViewIfNeeded();
  await f.getByLabel('France').fill('5000.00');
  await f.getByLabel('Export. et intracom.').fill('0.00');
  await f.getByLabel('Justification (obligatoire)').fill('Ventes au comptoir en France (démonstration fictive)');
  await f.getByRole('button', { name: /Qualifier le compte 707100/ }).click();
  await page.getByText('Qualification enregistrée.').first().waitFor();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-resultat').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-apres.png` });
  await page.getByTestId('qualification-comptes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-qualification.png` });
  await page.getByTestId('renvois-detail').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-detail-renvois.png` });
}
// Partie B du 2033-B (D-110) : saisie par les formulaires (MODIFIE le dossier fictif indiqué), avant / après.
if (process.argv.includes('--resultat-fiscal')) {
  const url = `${base}&vue=liasse&regime=reel_simplifie`;
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('resultat-fiscal').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-rf-avant.png` });
  const saisir = async (cle, montant, note) => {
    const f = page.getByTestId(`renvoi-RF_${cle}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(montant);
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi RF_${cle}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  };
  const neant = async (cle) => {
    const f = page.getByTestId(`renvoi-RF_${cle}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByRole('button', { name: new RegExp(`Déclarer néant pour RF_${cle}`) }).click();
    await f.getByText('Néant enregistré.').waitFor();
  };
  await saisir('316', '1000.00', 'Rémunération de l’exploitant non déductible (démonstration fictive)');
  await saisir('324', '250.00', 'Amendes et pénalités du compte 6712 (démonstration fictive)');
  await saisir('342', '500.00', 'Déduction de zone (démonstration fictive)');
  for (const c of ['318', '322', '330', '350', '356']) await neant(c);
  await saisir('360', '2000.00', 'Déficits antérieurs imputés dans la limite du plafond (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('resultat-fiscal').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-rf-apres.png` });
  await page.getByRole('region', { name: 'Calcul du résultat fiscal du tableau 2033-B' }).screenshot({ path: `${sortie}fiscal-rf-calcul.png` });
  await page.getByTestId('historique-RF_360').locator('summary').click();
  await page.getByTestId('lignes-resultat-fiscal').scrollIntoViewIfNeeded();
  await page.getByTestId('historique-RF_360').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-rf-historique.png` });
}
// Détail du total 330 (D-111) : saisies justifiées par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--detail-330')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-rf-RF_330').locator('summary').first().click();
  const saisir = async (cle, montant, note) => {
    const f = page.getByTestId(`renvoi-RF_${cle}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(montant);
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi RF_${cle}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  };
  await saisir('247', '200.00', 'Intérêts excédentaires du compte courant de l’associé (démonstration fictive)');
  await saisir('248', '-50.00', 'Écart net négatif de valeur liquidative sur OPC (démonstration fictive)');
  await saisir('251', '150.00', 'Fraction des loyers de crédit-bail à réintégrer (démonstration fictive)');
  await saisir('330', '300.00', 'Total de la ligne Divers établi par le cabinet (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('detail-rf-RF_330').locator('summary').first().click();
  await page.getByTestId('detail-rf-RF_330').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-rf-detail-330.png` });
}
// Cadre III du 2033-C et 2054 bis (D-112) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
async function saisirLigne(tableau, ligne, valeurs, note) {
  const f = page.getByTestId(`saisie-${tableau}-${ligne}`);
  await f.scrollIntoViewIfNeeded();
  for (const [libelle, v] of Object.entries(valeurs)) {
    const champ = f.getByLabel(libelle, { exact: true });
    if ((await champ.evaluate((e) => e.tagName)) === 'SELECT') await champ.selectOption({ value: v });
    else await champ.fill(v);
  }
  await f.getByLabel('Justification (obligatoire)').fill(note);
  await f.getByRole('button', { name: /^Enregistrer/ }).click();
  await f.getByText('Ligne enregistrée.').waitFor();
}
if (process.argv.includes('--cadre-iii')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('cadre-iii').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-cadre-iii-avant.png` });
  await saisirLigne('2033C_III', '01', { 'Nature de l’immobilisation cédée': 'Machine de découpe (démonstration fictive)', '① Valeur d’actif': '3000.00', '② Amortissements': '1500.00', '④ Prix de cession': '800.00', 'Régime de la plus ou moins-value (décision du cabinet)': 'court_terme' }, 'Cession de la machine au registre des immobilisations (démonstration fictive)');
  await saisirLigne('2033C_III', 'REG', { 'Colonne 5 (case 590, signée)': '100.00', 'Colonne 6 (case 583, signée)': '0.00', 'Colonne 7 (case 594, signée)': '0.00', 'Colonne 8 (case 595, signée)': '0.00' }, 'Amortissements irrégulièrement différés (démonstration fictive)');
  await saisirLigne('2033C_III', 'PV19', { 'Montant (case 579)': '0.00' }, 'Aucune plus-value à 19 % (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('cadre-iii').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-cadre-iii-apres.png` });
  await page.getByRole('region', { name: 'Cadre III du tableau 2033-C : cessions, plus-values et moins-values' }).screenshot({ path: `${sortie}fiscal-cadre-iii-tableau.png` });
}
if (process.argv.includes('--bis')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('ecarts-reevaluation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2054bis-avant.png` });
  const colonnes = (a, b, c, d, e) => ({ '① Augmentation du montant brut': a, '② Augmentation des amortissements': b, '③ Suppléments d’amortissement': c, '④ Fraction résiduelle (cédés)': d, '⑤ Montant cumulé fin d’exercice': e });
  await saisirLigne('2054BIS_A', '03', colonnes('5000.00', '0.00', '100.00', '50.00', '1200.00'), 'Réévaluation légale des terrains (démonstration fictive)');
  await saisirLigne('2054BIS_A', '04', colonnes('8000.00', '3000.00', '200.00', '0.00', '2000.00'), 'Réévaluation légale des constructions (démonstration fictive)');
  await saisirLigne('2054BIS_B', 'B1', { Montant: '900.00' }, 'Fraction incluse au début de l’exercice (démonstration fictive)');
  await saisirLigne('2054BIS_B', 'B2', { Montant: '250.50' }, 'Fraction rattachée au résultat (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('ecarts-reevaluation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2054bis-apres.png` });
  await page.getByRole('region', { name: 'Cadre A du tableau 2054 bis : écarts de réévaluation' }).screenshot({ path: `${sortie}fiscal-2054bis-tableau.png` });
}
// 2055 cadres B et C (D-113) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--b2055')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('amortissements-derogatoires').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2055-avant.png` });
  const derog = (a, b, c, d, e, f) => ({ 'Dotations : différentiel de durée et autres (1)': a, 'Dotations : mode dégressif (2)': b, 'Dotations : amortissement fiscal exceptionnel (3)': c, 'Reprises : différentiel de durée et autres (4)': d, 'Reprises : mode dégressif (5)': e, 'Reprises : amortissement fiscal exceptionnel (6)': f });
  await saisirLigne('2055_B', '01', derog('100.00', '0.00', '0.00', '20.00', '0.00', '0.00'), 'Dérogatoire sur frais d’établissement (démonstration fictive)');
  await saisirLigne('2055_B', '04', derog('50.00', '30.00', '10.00', '5.00', '5.00', '5.00'), 'Dérogatoire sur terrains (démonstration fictive)');
  await saisirLigne('2055_B', '13', { 'Dotations : différentiel de durée et autres (1)': '40.00', 'Reprises : différentiel de durée et autres (4)': '15.00' }, 'Frais d’acquisition de titres de participation (démonstration fictive)');
  await saisirLigne('2055_C', '01', { 'Montant net au début de l’exercice': '1000.00', Augmentations: '500.00', 'Dotations de l’exercice (case Z9)': '300.00' }, 'Frais d’émission de l’emprunt bancaire (démonstration fictive)');
  await saisirLigne('2055_C', '02', { 'Montant net au début de l’exercice': '0.00', Augmentations: '0.00', 'Dotations de l’exercice (case SP)': '0.00' }, 'Aucune prime de remboursement (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('region', { name: 'Cadre B du tableau 2055 : amortissements dérogatoires' }).screenshot({ path: `${sortie}fiscal-2055-b-tableau.png` });
  await page.getByTestId('charges-reparties').scrollIntoViewIfNeeded();
  await page.getByRole('region', { name: 'Cadre C du tableau 2055 : charges réparties sur plusieurs exercices' }).screenshot({ path: `${sortie}fiscal-2055-c-tableau.png` });
  await page.getByTestId('non-ventile-2055-b').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2055-apres.png` });
}
// 2033-D (D-114) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2033d')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-d').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033d-avant.png` });
  const ligneCases = async (testid, valeurs, note) => {
    const f = page.getByTestId(testid);
    await f.scrollIntoViewIfNeeded();
    for (const [code, v] of Object.entries(valeurs)) await f.getByLabel(new RegExp(`\\(case ${code}\\)$`)).fill(v);
    await f.getByLabel('Justification (obligatoire, commune aux cases saisies)').fill(note);
    await f.getByRole('button', { name: /^Enregistrer les cases/ }).click();
    await f.getByText('Case(s) enregistrée(s).').waitFor();
  };
  await ligneCases('cases-provisions-AD', { 600: '100.00', 602: '50.00', 604: '20.00', 606: '130.00' }, 'Amortissements dérogatoires : relevé du registre (démonstration fictive)');
  await ligneCases('cases-provisions-DCL', { 650: '400.00', 652: '150.00', 654: '50.00', 656: '500.00' }, 'Dépréciation des créances clients (démonstration fictive)');
  await ligneCases('cases-derogatoires-FC', { 681: '40.00', 683: '0.00' }, 'Amortissement dérogatoire du fonds commercial (démonstration fictive)');
  const lc = page.getByTestId('saisie-2033D_C-01');
  await lc.scrollIntoViewIfNeeded();
  await lc.getByLabel('Nature de la dotation non déductible').fill('Indemnités de congés à payer (démonstration fictive)');
  await lc.getByLabel('Montant', { exact: true }).fill('300.00');
  await lc.getByLabel('Justification (obligatoire)').fill('Dotation non déductible pour l’assiette de l’impôt (démonstration fictive)');
  await lc.getByRole('button', { name: /^Enregistrer/ }).click();
  await lc.getByText('Ligne enregistrée.').waitFor();
  for (const [cle, m, n] of [['984', '1000.00', 'Déficits reportables sans limite de durée (démonstration fictive)'], ['860', '250.00', 'Déficit de l’exercice (démonstration fictive)']]) {
    const f = page.getByTestId(`renvoi-D_${cle}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(m);
    await f.getByLabel('Justification (obligatoire)').fill(n);
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi D_${cle}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-d').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033d-apres.png` });
  await page.getByRole('region', { name: 'Cadre I-A du tableau 2033-D : relevé des provisions' }).screenshot({ path: `${sortie}fiscal-2033d-provisions.png` });
  await page.getByTestId('total-870').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033d-deficits.png` });
}
// 2033-E (D-115) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2033e')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-e').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033e-avant.png` });
  const valeurs = { 376: '12', 657: '2', 651: '1', 861: '0', 108: '11800.00', 118: '0.00', 119: '0.00', 115: '800.00', 143: '0.00', 113: '0.00', 111: '0.00', 153: '0.00', 121: '2400.00', 145: '0.00', 125: '1500.00', 310: '0.00', 133: '300.00', 148: '150.00', 128: '0.00', 135: '0.00', 150: '1500.00' };
  for (const [code, m] of Object.entries(valeurs)) {
    const f = page.getByTestId(`renvoi-E_${code}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(m);
    await f.getByLabel('Justification (obligatoire)').fill(Number(m) === 0 ? 'Néant : aucune opération de cette nature (démonstration fictive)' : 'Valeur retenue pour la CVAE (démonstration fictive)');
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi E_${code}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-e').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033e-apres.png` });
  await page.getByTestId('valeur-ajoutee-2033-e').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033e-valeur-ajoutee.png` });
  await page.getByTestId('groupe-2033-e-III').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033e-charges.png` });
}
// 2033-F (D-116) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2033f')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-f').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033f-avant.png` });
  const remplir = async (testid, valeurs, note, bouton) => {
    const f = page.getByTestId(testid);
    await f.scrollIntoViewIfNeeded();
    for (const [libelle, v] of Object.entries(valeurs)) {
      const champ = f.getByLabel(libelle, { exact: true });
      if ((await champ.evaluate((e) => e.tagName)) === 'SELECT') await champ.selectOption({ value: v });
      else await champ.fill(v);
    }
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: new RegExp(`^Enregistrer ${bouton}`) }).click();
    await f.getByText('Ligne enregistrée.').waitFor();
  };
  await remplir('saisie-2033F_NB-NB', { 901: '1', 902: '600.00', 903: '1', 904: '400.00' }, 'Registre des associés au 31 décembre (démonstration fictive)', 'les nombres');
  await remplir('saisie-2033F_PM-01', { 'Forme juridique': 'SAS', Dénomination: 'Holding Exemple (démonstration fictive)', 'N° SIREN (si établie en France)': '123456789', '% de détention': '60.00', 'Nb de parts ou actions': '600.00', 'N°': '12', Voie: 'rue de l’Exemple', 'Code postal': '75000', Commune: 'Paris', Pays: 'France' }, 'Associée personne morale inscrite au registre (démonstration fictive)', 'la personne morale 1');
  await remplir('saisie-2033F_PP-01', { Titre: 'MME', 'Nom de famille': 'Durand (démonstration fictive)', 'Nom d’usage': '', 'Prénom(s)': 'Alice', '% de détention': '40.00', 'Nb de parts ou actions': '400.00', 'Date de naissance (AAAA-MM-JJ)': '1980-05-17', 'N° département de naissance': '75', 'Commune de naissance': 'Paris', 'Pays de naissance': 'France', 'N°': '3', Voie: 'avenue du Test', 'Code postal': '69000', Commune: 'Lyon', Pays: 'France' }, 'Associée personne physique inscrite au registre (démonstration fictive)', 'la personne physique 1');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-f').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033f-apres.png` });
  await page.getByTestId('nombres-2033-f').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033f-nombres.png` });
}
// 2033-G (D-117) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2033g')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-g').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033g-avant.png` });
  const n = page.getByTestId('saisie-2033G_NB-NB');
  await n.scrollIntoViewIfNeeded();
  await n.getByLabel('Nombre total de filiales (905)').fill('1');
  await n.getByLabel('Justification (obligatoire)').fill('Registre des titres de participation (démonstration fictive)');
  await n.getByRole('button', { name: /^Enregistrer le nombre/ }).click();
  await n.getByText('Ligne enregistrée.').waitFor();
  const f = page.getByTestId('saisie-2033G_FIL-01');
  await f.scrollIntoViewIfNeeded();
  for (const [libelle, v] of Object.entries({ 'Forme juridique': 'SARL', Dénomination: 'Filiale Exemple (démonstration fictive)', 'N° SIREN (si établie en France)': '987654321', '% de détention': '55.00', 'N°': '5', Voie: 'rue du Test', 'Code postal': '33000', Commune: 'Bordeaux', Pays: 'France' })) await f.getByLabel(libelle, { exact: true }).fill(v);
  await f.getByLabel('Justification (obligatoire)').fill('Participation directe de 55 % inscrite au registre (démonstration fictive)');
  await f.getByRole('button', { name: /^Enregistrer la filiale 1/ }).click();
  await f.getByText('Ligne enregistrée.').waitFor();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2033-g').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033g-apres.png` });
}
// 2058-A (D-118) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2058a')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2058-A').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058a-avant.png` });
  await page.evaluate(() => document.querySelectorAll('[data-testid^="groupe-formulaire-2058-A"]').forEach((d) => d.setAttribute('open', '')));
  const valeurs = { WA: '8250.00', WB: '0.00', WD: '1000.00', WE: '0.00', WF: '0.00', WG: '0.00', RA: '0.00', RB: '0.00', XE: '1000.00', WI: '300.00', XX: '0.00', WJ: '250.00', XZ: '0.00', XW: '550.00', XY: '0.00', I7: '0.00', K7: '0.00', I8: '0.00', ZN: '0.00', WN: '0.00', WO: '0.00', XR: '0.00', WQ: '0.00', Y1: '0.00', Y3: '0.00', WR: '9800.00', WS: '0.00', XH: '500.00', ZL: '0.00', XL: '2000.00' };
  for (const [code, m] of Object.entries(valeurs)) {
    const f = page.getByTestId(`renvoi-A58_${code}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(m);
    await f.getByLabel('Justification (obligatoire)').fill(Number(m) === 0 ? 'Néant : aucune opération de cette nature (démonstration fictive)' : 'Valeur établie par le cabinet (démonstration fictive)');
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi A58_${code}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('imputation-formulaire-2058-A').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058a-resultat.png` });
  await page.getByTestId('controles-formulaire-2058-A').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058a-controles.png` });
}
// 2058-B et 2058-C (D-119) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2058bc')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelectorAll('[data-testid^="groupe-formulaire-2058"]').forEach((d) => d.setAttribute('open', '')));
  const saisir = async (prefixe, valeurs) => {
    for (const [code, m] of Object.entries(valeurs)) {
      const f = page.getByTestId(`renvoi-${prefixe}_${code}`);
      await f.scrollIntoViewIfNeeded();
      await f.getByLabel('Montant').fill(m);
      await f.getByLabel('Justification (obligatoire)').fill(Number(m) === 0 ? 'Néant : aucune opération de cette nature (démonstration fictive)' : 'Valeur établie par le cabinet (démonstration fictive)');
      await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi ${prefixe}_${code}`) }).click();
      await f.getByText('Renvoi enregistré.').waitFor();
    }
  };
  await saisir('B58', { K4: '1000.00', K4BIS: '0.00', K5: '2000.00', YJ: '0.00', ZT: '0.00', ZV: '300.00', ZW: '0.00', '8X': '0.00', '8Y': '0.00', '8Z': '0.00', '9A': '0.00', '9B': '0.00', '9C': '0.00', '9D': '0.00', '9E': '0.00', '9F': '0.00', '9G': '0.00', '9H': '0.00', '9J': '0.00', '9K': '250.00', '9L': '0.00', '9M': '0.00', '9N': '0.00', '9P': '0.00', '9R': '0.00', '9S': '0.00', '9T': '0.00' });
  await saisir('C58', { '0C': '1000.00', '0D': '500.00', '0E': '0.00', ZB: '75.00', ZD: '0.00', ZE: '1000.00', ZF: '0.00', ZG: '425.00' });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('controles-formulaire-2058-B').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058b-controles.png` });
  await page.evaluate(() => document.querySelectorAll('[data-testid^="groupe-formulaire-2058"]').forEach((d) => d.setAttribute('open', '')));
  await page.locator('[data-calcul-f="YN"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058b-totaux.png` });
  await page.locator('[data-calcul-f="ØF"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2058c-affectation.png` });
}
// 2059-A (D-121) : saisies par les formulaires (MODIFIE le dossier fictif indiqué), régime réel normal.
if (process.argv.includes('--2059a')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2059-a').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2059a-avant.png` });
  const c = page.getByTestId('saisie-2059A_IM-01');
  await c.scrollIntoViewIfNeeded();
  await c.getByLabel('Nature et date d’acquisition (colonne 1)').fill('Camionnette 2021 (démonstration fictive)');
  for (const [libelle, v] of Object.entries({ '2 Valeur d’origine': '30000.00', '5 Autres amortissements': '24000.00', '6 Valeur résiduelle': '6000.00', '7 Prix de vente': '9000.00', '8 Plus-value ou moins-value': '3000.00', '9 Court terme': '3000.00' })) await c.getByLabel(libelle, { exact: true }).fill(v);
  await c.getByLabel('Justification (obligatoire)').fill('Registre des cessions (démonstration fictive)');
  await c.getByRole('button', { name: /^Enregistrer la cession 1/ }).click();
  await c.getByText('Ligne enregistrée.').waitFor();
  for (const [ligne, col] of [['13', '9 Court terme'], ['14', '9 Court terme'], ['15', '9 Court terme'], ['16', '9 Court terme'], ['18', '10 Long terme 19 %'], ['19', '10 Long terme 19 %'], ['20', '9 Court terme']]) {
    const a = page.getByTestId(`saisie-2059A_AUT-${ligne}`);
    await a.scrollIntoViewIfNeeded();
    await a.getByLabel(col, { exact: true }).fill('0.00');
    await a.getByLabel('Justification (obligatoire)').fill('Aucun élément à cette ligne (démonstration fictive)');
    await a.getByRole('button', { name: new RegExp(`^Enregistrer la ligne ${ligne}`) }).click();
    await a.getByText('Ligne enregistrée.').waitFor();
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('formulaire-2059-a').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2059a-apres.png` });
}
// 2059-B, 2059-C, 2059-D (D-122) : saisies par les formulaires (MODIFIE le dossier fictif indiqué), régime réel normal.
if (process.argv.includes('--2059bcd')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('grille-2059-D').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2059d-avant.png` });
  const remplir = async (tableau, ligne, valeurs, bouton, note) => {
    const f = page.getByTestId(`saisie-${tableau}-${ligne}`);
    await f.scrollIntoViewIfNeeded();
    for (const [libelle, v] of Object.entries(valeurs)) await f.getByLabel(libelle, { exact: true }).fill(v);
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: bouton }).click();
    await f.getByText('Ligne enregistrée.').waitFor();
  };
  const t = (a, b) => ({ 'Taxées à 10 %': a, 'Taxées à 15 %': b, 'Taxées à 18 %': '0.00', 'Taxées à 19 %': '0.00', 'Taxées à 25 %': '0.00' });
  await remplir('2059D_I', 'L1', t('100.00', '50.00'), /^Enregistrer la ligne L1/, 'Réserve de clôture N-1 (démonstration fictive)');
  await remplir('2059D_I', 'L2', t('10.00', '0.00'), /^Enregistrer la ligne L2/, 'Aucune société absorbée sauf 10 (démonstration fictive)');
  await remplir('2059D_I', 'L4', t('20.00', '5.00'), /^Enregistrer la ligne L4/, 'Prélèvements de l’exercice (démonstration fictive)');
  await remplir('2059D_I', 'L5', t('0.00', '0.00'), /^Enregistrer la ligne L5/, 'Aucun prélèvement sans complément (démonstration fictive)');
  await remplir('2059C_II', 'N', { '2 Moins-values à 19 % ou à 15 %': '100.00', '3 À 19 % ou 15 % imputables sur le résultat de l’exercice': '10.00', '5 Imputations sur le résultat de l’exercice': '30.00' }, /^Enregistrer la ligne N du 2059C_II/, 'Moins-value nette de l’exercice (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('grille-2059-D').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2059d-apres.png` });
  await page.getByTestId('lignes-2059C_II').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2059c-apres.png` });
}
// 2065-SD (D-123) : saisies par les formulaires (MODIFIE le dossier fictif indiqué).
if (process.argv.includes('--2065')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('grille-2065').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2065-avant.png` });
  const remplir = async (tableau, ligne, valeur, bouton, note) => {
    const f = page.getByTestId(`saisie-${tableau}-${ligne}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant', { exact: true }).fill(valeur);
    await f.getByLabel('Justification (obligatoire)').fill(note);
    await f.getByRole('button', { name: bouton }).click();
    await f.getByText('Ligne enregistrée.').waitFor();
  };
  await remplir('2065_C1', 'BN', '12345.00', /^Enregistrer la ligne BN du 2065_C1/, 'Résultat fiscal retenu par le cabinet (démonstration fictive)');
  await remplir('2065_C1', 'DEF', '0.00', /^Enregistrer la ligne DEF du 2065_C1/, 'Pas de déficit (démonstration fictive)');
  await remplir('2065_C4', 'SIIC', '-500.00', /^Enregistrer la ligne SIIC du 2065_C4/, 'Déficit exonéré, exemple de signe (démonstration fictive)');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('grille-2065').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2065-apres.png` });
}
// Dates du 2033-E et cadre IV du 2033-D (D-126) : saisies par les formulaires (MODIFIE le dossier fictif indiqué), régime simplifié.
if (process.argv.includes('--2033reste')) {
  await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
  await page.waitForLoadState('networkidle');
  const per = page.getByTestId('saisie-2033E_DATES-PER');
  await per.scrollIntoViewIfNeeded();
  await per.getByLabel('Période de référence : du (case 024) — AAAA-MM-JJ').fill('2025-01-01');
  await per.getByLabel('Période de référence : au (case 016) — AAAA-MM-JJ').fill('2025-12-31');
  await per.getByLabel('Justification (obligatoire)').fill('Exercice de douze mois (démonstration fictive)');
  await per.getByRole('button', { name: /^Enregistrer la ligne PER/ }).click();
  await per.getByText('Ligne enregistrée.').waitFor();
  await page.getByTestId('grille-2033-E-DATES').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033e-dates.png` });
  const c690 = page.getByTestId('travailleurs-independants-2033-d');
  await c690.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2033d-cadre-iv.png` });
}
// 2056 (D-129) : saisies par les formulaires (MODIFIE le dossier fictif indiqué), régime réel normal.
if (process.argv.includes('--2056')) {
  await page.goto(`${base}&vue=liasse&regime=reel_normal`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelectorAll('[data-testid^="groupe-formulaire-2056"]').forEach((d) => d.setAttribute('open', '')));
  await page.getByTestId('formulaire-2056').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2056-avant.png` });
  for (const [code, m] of Object.entries({ '4A': '100.00', '4B': '30.00', '4C': '10.00', '4D': '120.00' })) {
    const f = page.getByTestId(`renvoi-P56_${code}`);
    await f.scrollIntoViewIfNeeded();
    await f.getByLabel('Montant').fill(m);
    await f.getByLabel('Justification (obligatoire)').fill('Provision pour litige du bilan (démonstration fictive)');
    await f.getByRole('button', { name: new RegExp(`Enregistrer le renvoi P56_${code}`) }).click();
    await f.getByText('Renvoi enregistré.').waitFor();
  }
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('controles-formulaire-2056').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${sortie}fiscal-2056-controles.png` });
}
// 2033-B (D-107) : « dont export » et lignes « dont » du régime simplifié.
await page.goto(`${base}&vue=liasse&regime=reel_simplifie`);
await page.waitForLoadState('networkidle');
await page.getByTestId('detail-resultat').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${sortie}fiscal-2033b-detail.png` });
await page.getByTestId('renvois-detail').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${sortie}fiscal-2033b-renvois.png` });
await nav.close();
console.log('captures écrites dans', sortie);
