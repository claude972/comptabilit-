import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dechiffrerJetons } from './chiffrement.js';
import { ajouter, CLE, creerBanc, pdf, type Banc } from './essais/outils.js';
import type { IdFournisseur } from './types.js';

const CAS: { fournisseur: IdFournisseur; sim: 'google' | 'microsoft'; api: RegExp; jeton: RegExp }[] = [
  { fournisseur: 'gmail', sim: 'google', api: /^\/gmail\//, jeton: /^\/google\/token$/ },
  { fournisseur: 'microsoft', sim: 'microsoft', api: /^\/graph\//, jeton: /\/oauth2\/v2\.0\/token$/ },
];

describe.each(CAS)('Robustesse — $fournisseur', ({ fournisseur, sim, api, jeton }) => {
  let banc: Banc;
  beforeEach(async () => {
    banc = await creerBanc();
  });
  afterEach(() => banc.fermer());

  const facture = (nom: string) => ({ pieces: [{ nom, typeMime: 'application/pdf', contenu: pdf(nom) }] });

  it('jeton révoqué (invalid_grant) : statut « revoque », arrêt propre, aucune boucle', async () => {
    const etat = await banc.connecter(fournisseur);
    ajouter(banc, fournisseur, facture('avant.pdf'));
    await banc.moteur.synchroniser(etat.id);
    await banc.moteur.entretenirSurveillance(etat.id);

    ajouter(banc, fournisseur, facture('apres.pdf'));
    banc.sim.expirerJetonsAcces();
    banc.sim.revoquerAutorisation(sim);
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat).toMatchObject({ issue: 'arretee', statut: 'revoque' });
    expect(banc.magasin.obtenir(etat.id)).toMatchObject({ statut: 'revoque', motifStatut: 'jeton_revoque', surveillance: null });
    // Un seul appel au point de jetons, pas de nouvel essai.
    expect(banc.sim.compter(jeton, 'POST')).toBe(2); // échange initial + l'unique rafraîchissement refusé

    const avant = banc.sim.requetes.length;
    for (let i = 0; i < 5; i++) {
      expect((await banc.moteur.synchroniser(etat.id, { declencheur: 'periodique' })).issue).toBe('ignoree');
      expect(await banc.moteur.entretenirSurveillance(etat.id)).toBeNull();
    }
    expect(banc.sim.requetes.length).toBe(avant);
    expect(banc.horloge.attentes).toEqual([]);
    expect(banc.recepteur.noms).toEqual(['avant.pdf']);
  });

  it('jeton d’accès expiré : rafraîchi une seule fois, puis persisté chiffré', async () => {
    const etat = await banc.connecter(fournisseur);
    for (let i = 0; i < 4; i++) ajouter(banc, fournisseur, facture(`f${i}.pdf`));
    const ancien = dechiffrerJetons(etat.jetonsChiffres ?? '', etat.id, { courante: CLE });

    // Expiration connue par l'horloge : renouvellement anticipé, une seule fois pour toute la synchronisation.
    banc.horloge.avancer(2 * 3600 * 1000);
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.compteurs.piecesDeposees).toBe(4);
    expect(banc.sim.compteurs.rafraichissements).toBe(1);
    expect(banc.sim.compter(api)).toBeGreaterThan(8);
    const nouveau = dechiffrerJetons(banc.magasin.obtenir(etat.id).jetonsChiffres ?? '', etat.id, { courante: CLE });
    expect(nouveau.jetonAcces).not.toBe(ancien.jetonAcces);
    expect(nouveau.etatClient).toBe(ancien.etatClient);
    if (fournisseur === 'microsoft') expect(nouveau.jetonRafraichissement).not.toBe(ancien.jetonRafraichissement); // rotation
    else expect(nouveau.jetonRafraichissement).toBe(ancien.jetonRafraichissement);

    // Expiration inattendue (401 du fournisseur) : là encore un seul renouvellement.
    for (let i = 0; i < 3; i++) ajouter(banc, fournisseur, facture(`g${i}.pdf`));
    banc.sim.expirerJetonsAcces();
    const apres401 = await banc.moteur.synchroniser(etat.id);
    expect(apres401.compteurs.piecesDeposees).toBe(3);
    expect(banc.sim.compteurs.rafraichissements).toBe(2);
    expect(banc.magasin.obtenir(etat.id).statut).toBe('active');
  });

  it('401 persistant malgré le renouvellement : statut « expire », aucun nouvel essai', async () => {
    const etat = await banc.connecter(fournisseur);
    ajouter(banc, fournisseur, facture('a.pdf'));
    banc.sim.injecterErreur({ chemin: api, statut: 401, fois: 50 });
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat).toMatchObject({ issue: 'arretee', statut: 'expire' });
    expect(banc.sim.compteurs.rafraichissements).toBe(1);
    const avant = banc.sim.requetes.length;
    expect((await banc.moteur.synchroniser(etat.id)).issue).toBe('ignoree');
    expect(banc.sim.requetes.length).toBe(avant);
  });

  it('429 avec Retry-After : délai respecté ; 5xx : attente exponentielle bornée avec gigue', async () => {
    const etat = await banc.connecter(fournisseur);
    ajouter(banc, fournisseur, facture('a.pdf'));
    banc.sim.injecterErreur({ chemin: /\/messages\/[^/]+$/, statut: 429, entetes: { 'retry-after': '17' } });
    const debut = banc.horloge.t;
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.issue).toBe('terminee');
    expect(banc.recepteur.noms).toEqual(['a.pdf']);
    expect(banc.horloge.attentes).toEqual([17_000]);
    expect(banc.horloge.t - debut).toBe(17_000);

    // 503 sans Retry-After, trois fois de suite : 1 s, 2 s, 4 s (+ gigue < 1 s ; ici le hasard vaut 0,5).
    banc.horloge.attentes.length = 0;
    ajouter(banc, fournisseur, facture('b.pdf'));
    banc.sim.injecterErreur({ chemin: /\/messages\/[^/]+$/, statut: 503, fois: 3 });
    expect((await banc.moteur.synchroniser(etat.id)).issue).toBe('terminee');
    expect(banc.horloge.attentes).toEqual([1500, 2500, 4500]);
    expect(banc.recepteur.noms).toEqual(['a.pdf', 'b.pdf']);

    // Journal des reprises : statut et délais uniquement.
    expect(banc.journal.evenements.filter((e) => e.type === 'http.reprise')).toHaveLength(4);
  });

  it('Retry-After très long : synchronisation interrompue sans attendre, reprise ultérieure sans perte', async () => {
    const etat = await banc.connecter(fournisseur);
    ajouter(banc, fournisseur, facture('a.pdf'));
    banc.sim.injecterErreur({ chemin: api, statut: 429, entetes: { 'retry-after': '3600' } });
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat).toMatchObject({ issue: 'interrompue', statut: 'active', reprendreApresMs: 3_600_000 });
    expect(banc.horloge.attentes).toEqual([]);
    expect((await banc.moteur.synchroniser(etat.id)).compteurs.piecesDeposees).toBe(1);
  });
});
