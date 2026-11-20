import { type Page, expect, test } from '@playwright/test';
import { etatDe, simulateur, statutBff, surveiller } from '../outils';

/**
 * Notifications poussées — écran « Sur cet appareil », contre l'API SIMULÉE (aucune notification n'est émise).
 * Le navigateur de test ne contacte AUCUN service de notification : `PushManager.subscribe` est remplacé par un faux
 * abonnement dont le point d'accès (hôte de la liste blanche) n'est jamais appelé, et chaque test vérifie qu'aucune
 * requête n'est sortie de la machine. Ce que ces tests ne peuvent pas montrer : la réception réelle sur un téléphone,
 * l'affichage sur un écran verrouillé, le comportement d'iOS.
 */
test.use({ storageState: etatDe('client') });

const PHRASES = ['Vous avez une nouvelle notification dans Comtaple.', 'Vous avez de nouvelles notifications dans Comtaple.', 'Un complément vous est demandé.', 'Une réponse a été apportée à une demande de complément.'];
const POINT_ACCES = 'https://fcm.googleapis.com/fcm/send/essai-e2e-jamais-contacte';

interface EtatPousseesSimule {
  statut: string;
  appareils: Array<{ id: string; utilisateurId: string; service: string; agent: string; empreinte: string }>;
  coupees: string[];
}

/** Remplace les API du navigateur : autorisation pilotée par le test, abonnement factice, appels comptés. */
async function preparerNavigateur(page: Page, options: { permission: 'default' | 'granted' | 'denied'; reponse?: 'granted' | 'denied' | 'default'; sansPush?: boolean }) {
  await page.addInitScript(
    ([o, pointAcces]) => {
      const etat = window as unknown as { demandes: number; optionsAbonnement: unknown };
      etat.demandes = 0;
      const permission = () => localStorage.getItem('essai-permission') ?? o.permission;
      if (o.sansPush) {
        delete (window as unknown as Record<string, unknown>).PushManager;
        return;
      }
      Object.defineProperty(Notification, 'permission', { configurable: true, get: permission });
      Notification.requestPermission = async () => {
        etat.demandes += 1;
        localStorage.setItem('essai-permission', o.reponse ?? 'granted');
        return (o.reponse ?? 'granted') as NotificationPermission;
      };
      // Le point d'accès peut être changé par le test (« essai-point-acces ») pour imiter un renouvellement par le navigateur.
      const adresse = () => localStorage.getItem('essai-point-acces') ?? pointAcces;
      const faux = {
        get endpoint() {
          return adresse();
        },
        toJSON: () => ({ endpoint: adresse(), keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } }),
        unsubscribe: async () => (localStorage.removeItem('essai-abonne'), true),
      };
      PushManager.prototype.getSubscription = async () => (localStorage.getItem('essai-abonne') ? (faux as unknown as PushSubscription) : null);
      PushManager.prototype.subscribe = async (options) => {
        etat.optionsAbonnement = { userVisibleOnly: options?.userVisibleOnly, cle: (options?.applicationServerKey as Uint8Array | undefined)?.length };
        localStorage.setItem('essai-abonne', '1');
        return faux as unknown as PushSubscription;
      };
    },
    [options, POINT_ACCES] as const,
  );
}

/** Hôtes contactés par la page, hors machine locale : doit rester vide (aucun service de notification réel). */
function hotesExternes(page: Page): string[] {
  const hotes: string[] = [];
  page.on('request', (r) => {
    const h = new URL(r.url()).hostname;
    if (!['localhost', '127.0.0.1'].includes(h) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) hotes.push(h);
  });
  return hotes;
}

test.describe('Notifications poussées : états de l’écran', () => {
  test.beforeEach(async () => {
    await simulateur('reinitialiser');
  });

  test('fonction non activée (défaut) : l’écran le dit, ne propose rien, ne demande aucune autorisation ; l’abonnement est refusé', async ({ page }) => {
    const erreurs = surveiller(page);
    const externes = hotesExternes(page);
    await preparerNavigateur(page, { permission: 'default' });
    await page.goto('/notifications');
    const bloc = page.getByTestId('notifications-poussees');
    await expect(bloc).toHaveAttribute('data-statut', 'non_configure');
    await expect(bloc.getByRole('heading', { name: 'Sur cet appareil' })).toBeVisible();
    await expect(page.getByTestId('poussees-non-activees')).toContainText('Les notifications poussées ne sont pas activées sur ce service.');
    await expect(page.getByTestId('activer-poussees')).toHaveCount(0);
    await expect(page.getByTestId('explication-poussees')).toHaveCount(0);
    await expect(page.getByTestId('preference-poussees')).toHaveCount(0);
    // Les mentions de la page restent celles d'un service sans aucun envoi extérieur.
    await expect(page.getByTestId('mention-notifications')).toContainText('rien n’est envoyé par courriel, SMS ou notification sur votre appareil');
    expect(await page.evaluate(() => (window as unknown as { demandes: number }).demandes)).toBe(0);
    // Côté serveur : aucun abonnement n'est accepté.
    expect(await statutBff(page, 'POST', 'v1/notifications/poussees/abonnements', { endpoint: POINT_ACCES, keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) } })).toBe(503);
    expect((await simulateur<EtatPousseesSimule>('poussees')).appareils).toEqual([]);
    expect(externes).toEqual([]);
    expect(erreurs).toEqual([]);
  });

  test('fonction activée : explication AVANT toute demande, autorisation sur geste explicite seulement, puis appareil listé et désabonnement', async ({ page }) => {
    await simulateur('poussees', { statut: 'simule' });
    const erreurs = surveiller(page);
    const externes = hotesExternes(page);
    await preparerNavigateur(page, { permission: 'default' });
    await page.goto('/notifications');
    const bloc = page.getByTestId('notifications-poussees');
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'a_activer');
    // État réel dit sans détour.
    await expect(page.getByTestId('poussees-etat-reel')).toContainText('La réception sur un téléphone réel et l’affichage sur un écran verrouillé n’ont pas été essayés.');
    // Explication : ce qui s'affichera sur l'écran verrouillé — la liste fermée des phrases, et rien d'autre.
    const explication = page.getByTestId('explication-poussees');
    await expect(explication).toContainText('Ce qui s’affiche, y compris sur l’écran verrouillé');
    await expect(explication).toContainText('Jamais de montant, de nom de dossier, de client ni de fichier.');
    await expect(page.getByTestId('phrases-poussees').getByRole('listitem')).toHaveText(PHRASES.map((p) => `« ${p} »`));
    await expect(page.getByTestId('aucun-appareil-poussees')).toBeVisible();
    // Aucune demande d'autorisation au chargement, ni après une navigation dans la page.
    await page.getByTestId('lien-archivees').click();
    await expect(page).toHaveURL(/archivees=1/);
    await page.goBack();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'a_activer');
    expect(await page.evaluate(() => (window as unknown as { demandes: number }).demandes)).toBe(0);
    expect((await simulateur<EtatPousseesSimule>('poussees')).appareils).toEqual([]);

    // Geste explicite : une seule demande, puis abonnement de l'appareil.
    await page.getByTestId('activer-poussees').click();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'abonne');
    await expect(page.getByTestId('poussees-abonne')).toContainText('Activées sur cet appareil');
    expect(await page.evaluate(() => (window as unknown as { demandes: number; optionsAbonnement: unknown }).demandes)).toBe(1);
    // « userVisibleOnly » et la clé publique du service (65 octets) ont été remis au navigateur.
    expect(await page.evaluate(() => (window as unknown as { optionsAbonnement: unknown }).optionsAbonnement)).toEqual({ userVisibleOnly: true, cle: 65 });
    const appareils = page.getByTestId('appareils-poussees').getByRole('listitem');
    await expect(appareils).toHaveCount(1);
    await expect(appareils.first()).toContainText('Chrome sur Android (cet appareil)');
    await expect(appareils.first()).toContainText('aucun envoi à ce jour');
    const enregistre = await simulateur<EtatPousseesSimule>('poussees');
    expect(enregistre.appareils).toHaveLength(1);
    expect(enregistre.appareils[0]).toMatchObject({ service: 'fcm', agent: 'Chrome sur Android' });
    expect(JSON.stringify(enregistre.appareils)).not.toContain('Pixel'); // agent utilisateur réduit

    // Après rechargement, l'état est relu sans nouvelle demande.
    await page.reload();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'abonne');
    expect(await page.evaluate(() => (window as unknown as { demandes: number }).demandes)).toBe(0);

    // Préférence globale : couper sans désabonner l'appareil.
    await page.getByTestId('preference-poussees').click();
    await expect(bloc.getByText('Notifications poussées coupées')).toBeVisible();
    await expect(page.getByTestId('preference-poussees')).not.toBeChecked();
    const coupe = await simulateur<EtatPousseesSimule>('poussees');
    expect(coupe.coupees).toHaveLength(1);
    expect(coupe.appareils).toHaveLength(1);

    // Désabonnement de l'appareil : retiré du service ET du navigateur.
    await page.getByTestId('desactiver-poussees').click();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'a_activer');
    await expect(page.getByTestId('aucun-appareil-poussees')).toBeVisible();
    expect((await simulateur<EtatPousseesSimule>('poussees')).appareils).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('essai-abonne'))).toBeNull();
    expect(externes).toEqual([]);
    expect(erreurs).toEqual([]);
  });

  test('autorisation refusée : dite clairement, sans bouton ; refus au moment de la demande : rien n’est activé', async ({ page, browser }) => {
    await simulateur('poussees', { statut: 'simule' });
    await preparerNavigateur(page, { permission: 'denied' });
    await page.goto('/notifications');
    await expect(page.getByTestId('notifications-poussees')).toHaveAttribute('data-etat-appareil', 'refusees');
    await expect(page.getByTestId('poussees-refusees')).toContainText('Comtaple ne peut pas redemander l’autorisation');
    await expect(page.getByTestId('activer-poussees')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { demandes: number }).demandes)).toBe(0);

    // La personne refuse dans la fenêtre du navigateur : message explicite, aucun abonnement.
    const contexte = await browser.newContext({ storageState: etatDe('client'), baseURL: 'http://localhost:3000', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const p = await contexte.newPage();
    await preparerNavigateur(p, { permission: 'default', reponse: 'denied' });
    await p.goto('/notifications');
    await p.getByTestId('activer-poussees').click();
    await expect(p.getByText('Autorisation refusée : aucune notification ne sera affichée sur cet appareil.')).toBeVisible();
    await expect(p.getByTestId('notifications-poussees')).toHaveAttribute('data-etat-appareil', 'refusees');
    expect((await simulateur<EtatPousseesSimule>('poussees')).appareils).toEqual([]);
    await contexte.close();
  });

  test('navigateur sans prise en charge : message explicite ; iPhone hors écran d’accueil : installation exigée, sans promesse', async ({ page, browser }) => {
    await simulateur('poussees', { statut: 'simule' });
    await preparerNavigateur(page, { permission: 'default', sansPush: true });
    await page.goto('/notifications');
    await expect(page.getByTestId('notifications-poussees')).toHaveAttribute('data-etat-appareil', 'non_pris_en_charge');
    await expect(page.getByTestId('poussees-non-prises-en-charge')).toContainText('Ce navigateur ne prend pas en charge les notifications poussées');
    await expect(page.getByTestId('activer-poussees')).toHaveCount(0);
    await expect(page.getByTestId('explication-poussees')).toHaveCount(0);

    const iphone = await browser.newContext({
      storageState: etatDe('client'),
      baseURL: 'http://localhost:3000',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const p = await iphone.newPage();
    await preparerNavigateur(p, { permission: 'default', sansPush: true }); // Safari iOS dans un onglet n'expose pas PushManager
    await p.goto('/notifications');
    await expect(p.getByTestId('notifications-poussees')).toHaveAttribute('data-etat-appareil', 'ios_a_installer');
    const ios = p.getByTestId('poussees-ios');
    await expect(ios).toContainText('ajoutée à l’écran d’accueil');
    await expect(ios).toContainText('iOS ou iPadOS 16.4 ou plus récent');
    await expect(ios).toContainText('elles n’ont pas été essayées sur un appareil réel avec Comtaple');
    await expect(p.getByTestId('activer-poussees')).toHaveCount(0);
    await iphone.close();
  });

  test('renouvellement par le navigateur non enregistré : l’écran le dit, retire l’ancien abonnement et propose « Réactiver » ; le remplacement ne laisse qu’un abonnement', async ({ page }) => {
    // Ce test imite ce que laisse le service worker après « pushsubscriptionchange » quand le service n'a pas pu être
    // joint (session fermée, hors connexion) : une MARQUE locale et un abonnement du navigateur à une nouvelle adresse.
    // L'événement lui-même n'est pas déclenchable dans un navigateur de test : son gestionnaire est vérifié en test unitaire.
    await simulateur('poussees', { statut: 'simule' });
    const erreurs = surveiller(page);
    const externes = hotesExternes(page);
    await preparerNavigateur(page, { permission: 'default' });
    await page.goto('/notifications');
    const bloc = page.getByTestId('notifications-poussees');
    await page.getByTestId('activer-poussees').click();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'abonne');
    const [ancien] = (await simulateur<EtatPousseesSimule>('poussees')).appareils;
    expect(ancien).toBeTruthy();

    const NOUVEAU = 'https://fcm.googleapis.com/fcm/send/essai-e2e-renouvele-jamais-contacte';
    await page.evaluate(
      async ([ancienneEmpreinte, nouveau]) => {
        localStorage.setItem('essai-point-acces', nouveau!);
        await new Promise<void>((ok, ko) => {
          const o = indexedDB.open('comtaple-poussees', 1);
          o.onupgradeneeded = () => o.result.createObjectStore('etat');
          o.onerror = () => ko(o.error);
          o.onsuccess = () => {
            const t = o.result.transaction('etat', 'readwrite');
            t.objectStore('etat').put({ ancienneEmpreinte, le: new Date().toISOString() }, 'renouvellement');
            t.oncomplete = () => (o.result.close(), ok());
            t.onerror = () => ko(t.error);
          };
        });
      },
      [ancien!.empreinte, NOUVEAU] as const,
    );
    await page.reload();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'a_reactiver');
    await expect(page.getByTestId('poussees-a-reactiver')).toContainText('Le navigateur a renouvelé ou perdu l’abonnement de cet appareil');
    // L'ancien abonnement, devenu inutilisable, est retiré du service sans attendre ; rien n'est réabonné sans geste.
    await expect(page.getByTestId('aucun-appareil-poussees')).toBeVisible();
    expect((await simulateur<EtatPousseesSimule>('poussees')).appareils).toEqual([]);
    await expect(page.getByTestId('activer-poussees')).toHaveText('Réactiver sur cet appareil');

    await page.getByTestId('activer-poussees').click();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'abonne');
    const apres = (await simulateur<EtatPousseesSimule>('poussees')).appareils;
    expect(apres).toHaveLength(1);
    expect(apres[0]!.empreinte).not.toBe(ancien!.empreinte);
    // La marque est effacée : après rechargement, l'appareil est simplement abonné.
    await page.reload();
    await expect(bloc).toHaveAttribute('data-etat-appareil', 'abonne');
    await expect(page.getByTestId('poussees-a-reactiver')).toHaveCount(0);
    expect(externes).toEqual([]);
    expect(erreurs).toEqual([]);
  });
});
