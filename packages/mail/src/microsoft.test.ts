import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErreurOAuth } from './erreurs.js';
import { ajouter, creerBanc, joursAvant, JOUR, pdf, SECRET_ETAT, sha256, CLIENT, type Banc } from './essais/outils.js';
import { creerFournisseurMicrosoft } from './fournisseurs/microsoft.js';
import { repondreValidationGraph } from './notifications.js';

const PARTAGEE = 'factures@cabinet-simule.test';

describe('Microsoft 365 — synchronisation contre le simulateur', () => {
  let banc: Banc;
  beforeEach(async () => {
    banc = await creerBanc();
  });
  afterEach(() => banc.fermer());

  it('parcours nominal : OAuth + id_token, abonnement, notification validée, dépôt', async () => {
    const contenu = pdf('facture ms');
    const idMessage = ajouter(banc, 'microsoft', { pieces: [{ nom: 'facture-ms.pdf', typeMime: 'application/pdf', contenu }] });
    const etat = await banc.connecter('microsoft');
    expect(etat.adresse).toBe(banc.sim.microsoft.adresse);
    expect(etat.scopesAccordes).toContain('Mail.Read');
    expect(etat.scopesAccordes).not.toContain('Mail.Read.Shared');

    const surveillance = await banc.moteur.entretenirSurveillance(etat.id);
    expect(surveillance?.mode).toBe('graph_abonnements');
    const [idAbonnement, abonnement] = [...banc.sim.microsoft.abonnements.entries()][0] ?? [];
    expect(abonnement?.ressource).toBe("me/mailFolders('inbox')/messages");
    expect(abonnement?.etatClient.length).toBeGreaterThanOrEqual(32);
    // Le secret clientState n'est stocké que dans l'enveloppe chiffrée.
    expect(JSON.stringify(banc.magasin.obtenir(etat.id))).not.toContain(abonnement?.etatClient);

    // Validation du point de notification : le jeton est renvoyé en text/plain.
    expect(repondreValidationGraph(new URLSearchParams('validationToken=abc%20123'))).toEqual({ statut: 200, typeContenu: 'text/plain', corps: 'abc 123' });
    expect(repondreValidationGraph(new URLSearchParams(''))).toBeNull();

    // Notification authentique acceptée ; clientState falsifié ou abonnement inconnu rejetés.
    const authentique = await banc.moteur.validerNotificationsGraph(etat.id, banc.sim.corpsNotificationGraph(idAbonnement ?? ''));
    expect(authentique).toEqual({ acceptees: [{ idAbonnement, nature: 'changement', evenement: null }], rejetees: 0 });
    const falsifiee = await banc.moteur.validerNotificationsGraph(etat.id, {
      value: [
        { subscriptionId: idAbonnement, clientState: 'devine' },
        { subscriptionId: 'inconnu', clientState: abonnement?.etatClient },
      ],
    });
    expect(falsifiee).toEqual({ acceptees: [], rejetees: 2 });

    const resultat = await banc.moteur.synchroniser(etat.id, { declencheur: 'notification' });
    expect(resultat.pieces).toHaveLength(1);
    expect(resultat.pieces[0]).toMatchObject({
      fournisseur: 'microsoft',
      idMessage,
      idPieceJointe: 'pj-0',
      expediteur: 'facturation@fournisseur.example',
      nomFichier: 'facture-ms.pdf',
      taille: contenu.byteLength,
      empreinteSha256: sha256(contenu),
      dateReception: joursAvant(1).toISOString(),
    });
    // Lecture seule : aucune écriture hors gestion des abonnements.
    expect(banc.sim.requetes.filter((r) => r.chemin.startsWith('/graph/') && r.methode !== 'GET').every((r) => r.chemin.includes('/subscriptions'))).toBe(true);
  });

  it('notification répétée, désordre, notification manquée : même résultat', async () => {
    const etat = await banc.connecter('microsoft');
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'a.pdf', typeMime: 'application/pdf', contenu: pdf('a') }] });
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'b.pdf', typeMime: 'application/pdf', contenu: pdf('b') }] });
    await Promise.all([1, 2, 3].map(() => banc.moteur.synchroniser(etat.id, { declencheur: 'notification' })));
    expect(banc.recepteur.noms).toEqual(['a.pdf', 'b.pdf']);
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'c.pdf', typeMime: 'application/pdf', contenu: pdf('c') }] });
    const periodique = await banc.moteur.synchroniser(etat.id, { declencheur: 'periodique' });
    expect(periodique.compteurs.piecesDeposees).toBe(1);
    expect(banc.recepteur.noms).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });

  it('boîte partagée : Mail.Read.Shared demandé explicitement, pas d’abonnement, delta périodique', async () => {
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'partagee.pdf', typeMime: 'application/pdf', contenu: pdf('p') }] }, { boite: PARTAGEE });
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'personnelle.pdf', typeMime: 'application/pdf', contenu: pdf('q') }] });
    const etat = await banc.connecter('microsoft', { boite: { type: 'partagee', adresse: PARTAGEE } });
    expect(etat.scopesAccordes).toEqual(expect.arrayContaining(['Mail.Read', 'Mail.Read.Shared']));
    expect(etat.adresse).toBe(PARTAGEE);

    const surveillance = await banc.moteur.entretenirSurveillance(etat.id);
    expect(surveillance?.mode).toBe('periodique');
    expect(surveillance?.mode === 'periodique' && surveillance.raison).toContain('Mail.Read.Shared');
    expect(banc.sim.compter(/\/subscriptions/)).toBe(0);

    const resultat = await banc.moteur.synchroniser(etat.id, { declencheur: 'periodique' });
    expect(resultat.issue).toBe('terminee');
    expect(banc.recepteur.noms).toEqual(['partagee.pdf']);
    expect(banc.sim.compter(new RegExp(`/users/${PARTAGEE}/mailFolders/inbox/messages/delta`))).toBe(1);
    expect(banc.sim.compter(/\/graph\/v1\.0\/me\//)).toBe(0);
  });

  it('boîte partagée sans le scope : arrêt avec « consentement requis », jamais d’élargissement silencieux', async () => {
    ajouter(banc, 'microsoft', { pieces: [{ nom: 'partagee.pdf', typeMime: 'application/pdf', contenu: pdf('p') }] }, { boite: PARTAGEE });
    const etat = await banc.connecter('microsoft');
    // L'utilisateur choisit ensuite une boîte partagée dans la configuration, sans nouveau consentement.
    const modifie = banc.magasin.obtenir(etat.id);
    modifie.configuration.boite = { type: 'partagee', adresse: PARTAGEE };
    const avant = banc.sim.requetes.length;
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.issue).toBe('consentement_requis');
    expect(resultat.scopesManquants).toEqual(['Mail.Read.Shared']);
    expect(await banc.moteur.entretenirSurveillance(etat.id)).toBeNull();
    expect(banc.sim.requetes.length).toBe(avant);
    expect(banc.recepteur.depots).toHaveLength(0);
    expect(banc.magasin.obtenir(etat.id).statut).toBe('active');
  });

  it('pagination delta sur plusieurs pages, puis jeton delta expiré (410) → resynchronisation sans doublon', async () => {
    banc.sim.taillePageMax = 2;
    for (let i = 0; i < 5; i++) ajouter(banc, 'microsoft', { pieces: [{ nom: `m${i}.pdf`, typeMime: 'application/pdf', contenu: pdf(`m${i}`) }] });
    ajouter(banc, 'microsoft', { date: joursAvant(40), pieces: [{ nom: 'trop-ancienne.pdf', typeMime: 'application/pdf', contenu: pdf('x') }] });
    const etat = await banc.connecter('microsoft');
    const premiere = await banc.moteur.synchroniser(etat.id);
    expect(premiere.compteurs.piecesDeposees).toBe(5);
    expect(banc.sim.compter(/messages\/delta$/)).toBe(3);
    // Le message antérieur à la date de début n'est même pas lu.
    expect(premiere.compteurs.messagesExamines).toBe(5);

    ajouter(banc, 'microsoft', { pieces: [{ nom: 'apres.pdf', typeMime: 'application/pdf', contenu: pdf('apres') }] });
    banc.sim.expirerDeltaMicrosoft();
    const seconde = await banc.moteur.synchroniser(etat.id);
    expect(seconde.issue).toBe('terminee');
    expect(seconde.compteurs.resynchronisationsCompletes).toBe(1);
    expect(seconde.compteurs.piecesDeposees).toBe(1);
    expect(banc.recepteur.depots).toHaveLength(6);
  });

  it('panne au milieu d’une page puis reprise : ni perte ni doublon', async () => {
    banc.sim.taillePageMax = 3;
    const ids = [1, 2, 3, 4].map((i) => ajouter(banc, 'microsoft', { pieces: [{ nom: `p${i}.pdf`, typeMime: 'application/pdf', contenu: pdf(`p${i}`) }] }));
    const etat = await banc.connecter('microsoft');
    banc.sim.injecterErreur({ chemin: new RegExp(`/messages/${ids[1]}/attachments/pj-0/\\$value$`), statut: 503, fois: 6 });
    expect((await banc.moteur.synchroniser(etat.id)).issue).toBe('interrompue');
    expect(banc.recepteur.noms).toEqual(['p1.pdf']);
    const reprise = await banc.moteur.synchroniser(etat.id);
    expect(reprise.issue).toBe('terminee');
    expect(banc.recepteur.noms).toEqual(['p1.pdf', 'p2.pdf', 'p3.pdf', 'p4.pdf']);
  });

  it('abonnements : renouvellement avant expiration et notifications de cycle de vie', async () => {
    const etat = await banc.connecter('microsoft');
    await banc.moteur.entretenirSurveillance(etat.id);
    await banc.moteur.entretenirSurveillance(etat.id);
    expect(banc.sim.compter(/\/subscriptions$/, 'POST')).toBe(1);
    const idInitial = [...banc.sim.microsoft.abonnements.keys()][0] ?? '';

    // Il reste moins de 48 h : un PATCH renouvelle (et réautorise) l'abonnement.
    banc.horloge.avancer(5 * JOUR);
    await banc.moteur.entretenirSurveillance(etat.id);
    expect(banc.sim.compter(/\/subscriptions\/[^/]+$/, 'PATCH')).toBe(1);
    expect(new Date(banc.sim.microsoft.abonnements.get(idInitial)?.echeance ?? 0).getTime()).toBe(banc.horloge.t + 6 * JOUR);

    // reauthorizationRequired : renouvellement forcé.
    const [reautorisation] = (await banc.moteur.validerNotificationsGraph(etat.id, banc.sim.corpsNotificationGraph(idInitial, 'reauthorizationRequired'))).acceptees;
    expect(reautorisation?.evenement).toBe('reauthorizationRequired');
    if (reautorisation) await banc.moteur.traiterCycleDeVie(etat.id, reautorisation);
    expect(banc.sim.compter(/\/subscriptions\/[^/]+$/, 'PATCH')).toBe(2);

    // subscriptionRemoved : l'abonnement est recréé et les messages manqués sont rattrapés par delta.
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'microsoft', { date: banc.horloge.maintenant(), pieces: [{ nom: 'manquee.pdf', typeMime: 'application/pdf', contenu: pdf('m') }] });
    const [retrait] = (await banc.moteur.validerNotificationsGraph(etat.id, banc.sim.corpsNotificationGraph(idInitial, 'subscriptionRemoved'))).acceptees;
    banc.sim.microsoft.abonnements.delete(idInitial);
    const rattrapage = retrait ? await banc.moteur.traiterCycleDeVie(etat.id, retrait) : null;
    expect(rattrapage?.compteurs.piecesDeposees).toBe(1);
    expect(banc.sim.microsoft.abonnements.size).toBe(1);
    expect([...banc.sim.microsoft.abonnements.keys()][0]).not.toBe(idInitial);
  });

  it('jeton d’identité : nonce inattendu refusé', async () => {
    const fournisseur = creerFournisseurMicrosoft({ client: CLIENT, urls: banc.sim.urlsMicrosoft });
    const demande = fournisseur.preparerAutorisation({ boite: { type: 'personnelle' }, sessionId: 's', secretEtat: SECRET_ETAT, maintenant: banc.horloge.maintenant() });
    const retour = new URL((await fetch(demande.url, { redirect: 'manual' })).headers.get('location') ?? '').searchParams;
    const tentative = banc.moteur.creerConnexion({
      connexionId: 'cx-nonce',
      retour,
      attendu: { ...demande.aConserver, nonce: 'autre-nonce' },
      sessionId: 's',
      secretEtat: SECRET_ETAT,
      configuration: { fournisseur: 'microsoft', rattachement: { dossiersComptables: ['A'] } },
    });
    await expect(tentative).rejects.toMatchObject({ code: 'nonce_invalide' });
    await expect(tentative).rejects.toBeInstanceOf(ErreurOAuth);
    expect(banc.magasin.etats.has('cx-nonce')).toBe(false);
  });
});
