import { mkdirSync } from 'node:fs';
import { expect, test as preparation } from '@playwright/test';
import { COMPTES, type Compte, DOSSIER_AUTH, etatDe, seConnecter, simulateur } from './outils';

/** Ouvre une session réelle (Keycloak) pour chaque compte de test et la conserve pour les autres fichiers de test. */
preparation.describe.configure({ mode: 'serial' });
mkdirSync(DOSSIER_AUTH, { recursive: true });

preparation('réinitialise le simulateur d’API', async () => {
  await simulateur('reinitialiser');
});

for (const qui of ['client', 'chloe', 'remi', 'alice'] satisfies Compte[]) {
  preparation(`connexion OIDC réelle : ${COMPTES[qui]}`, async ({ page }) => {
    await seConnecter(page, qui, '/depots');
    await expect(page).toHaveURL(/\/depots$/);
    await expect(page.getByTestId('utilisateur')).not.toBeEmpty();
    await page.context().storageState({ path: etatDe(qui) });
  });
}
