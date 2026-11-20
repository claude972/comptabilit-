import { chiffrerJetons, dechiffrerJetons, doitEtreRechiffre } from '@comtaple/mail';
import { describe, expect, it } from 'vitest';
import { clesMail } from './mail.js';
import { abonnementARechiffrer, associeAbonnement, chiffrerAbonnement, clesReposAbonnements, dechiffrerAbonnement } from './notifications-poussees.js';

const ANCIEN = 'ancien-secret-de-chiffrement-des-jetons-0001';
const NOUVEAU = 'nouveau-secret-de-chiffrement-des-jetons-0002';
const jetons = { jetonAcces: 'jeton-d-acces-fictif', expireLe: '2030-01-01T00:00:00.000Z', jetonRafraichissement: 'jeton-de-rafraichissement-fictif', scopes: ['lecture'], etatClient: 'etat-fictif' };

describe('rotation de la clé de chiffrement des jetons mail', () => {
  it('après rotation, un jeton chiffré avec l’ancien secret reste lisible, est signalé à rechiffrer, et les nouveaux utilisent le nouveau secret', () => {
    const avant = clesMail({ JETONS_CLE_CHIFFREMENT: ANCIEN })!;
    const enveloppe = chiffrerJetons(jetons, 'connexion-1', avant.trousseau.courante);
    const apres = clesMail({ JETONS_CLE_CHIFFREMENT: NOUVEAU, JETONS_CLES_ANCIENNES: `${ANCIEN}, trop-court` })!;
    expect(apres.trousseau.courante.id).not.toBe(avant.trousseau.courante.id);
    expect(apres.trousseau.anciennes).toHaveLength(1); // le secret trop court est ignoré
    expect(dechiffrerJetons(enveloppe, 'connexion-1', apres.trousseau)).toEqual(jetons);
    expect(doitEtreRechiffre(enveloppe, apres.trousseau)).toBe(true);
    const neuve = chiffrerJetons(jetons, 'connexion-1', apres.trousseau.courante);
    expect(doitEtreRechiffre(neuve, apres.trousseau)).toBe(false);
    // Une fois l'ancien secret retiré, seules les enveloppes rechiffrées restent lisibles.
    const final = clesMail({ JETONS_CLE_CHIFFREMENT: NOUVEAU })!;
    expect(dechiffrerJetons(neuve, 'connexion-1', final.trousseau)).toEqual(jetons);
    expect(() => dechiffrerJetons(enveloppe, 'connexion-1', final.trousseau)).toThrow();
    // Sans l'ancien secret déclaré, la rotation ne donne JAMAIS accès aux anciens jetons par un autre chemin.
    expect(() => dechiffrerJetons(enveloppe, 'connexion-1', clesMail({ JETONS_CLE_CHIFFREMENT: NOUVEAU, JETONS_CLES_ANCIENNES: 'un-autre-secret-suffisamment-long-0003' })!.trousseau)).toThrow();
  });
});

describe('rotation de la clé de chiffrement des abonnements aux notifications poussées', () => {
  const secrets = { endpoint: 'https://fcm.googleapis.com/fcm/send/fictif', p256dh: 'cle-publique-fictive', auth: 'secret-fictif' };
  const associe = associeAbonnement('cabinet-1', 'utilisateur-1', 'a'.repeat(64));

  it('même mécanisme que les jetons mail : l’ancien secret déchiffre seulement, l’enveloppe est signalée à rechiffrer, le nouveau secret chiffre', () => {
    const avant = { clesRepos: clesReposAbonnements({ JETONS_CLE_CHIFFREMENT: ANCIEN }) };
    const enveloppe = chiffrerAbonnement(avant, secrets, associe);
    const apres = { clesRepos: clesReposAbonnements({ JETONS_CLE_CHIFFREMENT: NOUVEAU, JETONS_CLES_ANCIENNES: `${ANCIEN}, trop-court, ${NOUVEAU}` }) };
    expect(apres.clesRepos.map((k) => k.id)).toEqual([clesReposAbonnements({ JETONS_CLE_CHIFFREMENT: NOUVEAU })[0]!.id, avant.clesRepos[0]!.id]); // courante d'abord ; trop court et doublon ignorés
    expect(dechiffrerAbonnement(apres, enveloppe, associe)).toEqual(secrets);
    expect(abonnementARechiffrer(apres, enveloppe)).toBe(true);
    const neuve = chiffrerAbonnement(apres, secrets, associe);
    expect(abonnementARechiffrer(apres, neuve)).toBe(false);
    // Ancien secret retiré : seule l'enveloppe rechiffrée reste lisible ; l'usage « abonnements » a sa propre clé dérivée.
    const final = { clesRepos: clesReposAbonnements({ JETONS_CLE_CHIFFREMENT: NOUVEAU }) };
    expect(dechiffrerAbonnement(final, neuve, associe)).toEqual(secrets);
    expect(dechiffrerAbonnement(final, enveloppe, associe)).toBeNull();
    expect(final.clesRepos[0]!.id).not.toBe(clesMail({ JETONS_CLE_CHIFFREMENT: NOUVEAU })!.trousseau.courante.id.replace(/^k-/, 'p-'));
    expect(clesReposAbonnements({ JETONS_CLE_CHIFFREMENT: 'trop-court' })).toEqual([]);
  });
});
