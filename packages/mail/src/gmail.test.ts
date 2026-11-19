import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ajouter, creerBanc, joursAvant, JOUR, pdf, sha256, type Banc } from './essais/outils.js';
import { chargerClesGoogle, validerPushPubSub } from './notifications.js';
import { COMPTE_SERVICE_PUBSUB_SIMULE } from './simulateur/index.js';

describe('Gmail — synchronisation contre le simulateur', () => {
  let banc: Banc;
  beforeEach(async () => {
    banc = await creerBanc();
  });
  afterEach(() => banc.fermer());

  /** Valide un push Pub/Sub comme le ferait le point d'entrée HTTP, puis déclenche la synchronisation. */
  async function recevoirPush(connexionId: string, corps: unknown) {
    const cles = await chargerClesGoogle(fetch, banc.sim.urlClesGoogle);
    const maintenant = banc.horloge.maintenant();
    const notification = validerPushPubSub({
      autorisation: `Bearer ${banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp: Math.floor(maintenant.getTime() / 1000) + 600 })}`,
      corps,
      audienceAttendue: 'https://api.comtaple.test/gmail',
      compteServiceAttendu: COMPTE_SERVICE_PUBSUB_SIMULE,
      cles,
      maintenant,
    });
    expect(notification.adresse).toBe(banc.sim.gmail.adresse);
    return banc.moteur.synchroniser(connexionId, { declencheur: 'notification' });
  }

  it('parcours nominal : OAuth, surveillance, dépôt avec provenance et empreinte', async () => {
    const contenu = pdf('facture 2026-041');
    const idMessage = ajouter(banc, 'gmail', { pieces: [{ nom: 'facture-041.pdf', typeMime: 'application/pdf', contenu }] });
    const etat = await banc.connecter('gmail', {
      rattachement: {
        dossiersComptables: ['DOSSIER-A', 'DOSSIER-B'],
        regles: [{ type: 'expediteur', valeur: 'fournisseur.example', dossierComptable: 'DOSSIER-B' }],
      },
    });
    expect(etat.statut).toBe('active');
    expect(etat.adresse).toBe(banc.sim.gmail.adresse);
    expect(etat.scopesAccordes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(etat.jetonsChiffres).toMatch(/^v1\.cle-2026\./);
    expect(etat.jetonsChiffres).not.toContain('simulateur-');

    const surveillance = await banc.moteur.entretenirSurveillance(etat.id);
    expect(surveillance?.mode).toBe('gmail_watch');
    expect(banc.sim.gmail.surveillance).toEqual({ sujet: 'projects/projet-simule/topics/gmail', libelles: ['INBOX'] });

    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.issue).toBe('terminee');
    expect(resultat.pieces).toHaveLength(1);
    expect(resultat.pieces[0]).toMatchObject({
      connexionId: etat.id,
      fournisseur: 'gmail',
      idMessage,
      dateReception: joursAvant(1).toISOString(),
      expediteur: 'facturation@fournisseur.example',
      nomFichier: 'facture-041.pdf',
      taille: contenu.byteLength,
      empreinteSha256: sha256(contenu),
    });
    expect(resultat.pieces[0]?.idPieceJointe).toBeTruthy();
    const depot = banc.recepteur.depots[0];
    expect(depot?.octets.equals(contenu)).toBe(true);
    expect(depot?.rattachement).toEqual({ statut: 'rattache', dossierComptable: 'DOSSIER-B', regles: ['regle_1:expediteur'] });
    expect(depot?.extrait.nonFiable).toBe(true);

    // Journal : événements techniques seulement — ni jeton, ni adresse complète, ni contenu.
    const journal = JSON.stringify(banc.journal.evenements);
    expect(journal).not.toContain('simulateur-acces');
    expect(journal).not.toContain('simulateur-rafraichissement');
    expect(journal).not.toContain(banc.sim.gmail.adresse);
    expect(journal).not.toContain('facturation@fournisseur.example');
    expect(journal).not.toContain('Votre facture');
    // Lecture seule : aucune requête d'écriture sur la boîte (seuls watch/stop sont des POST).
    expect(banc.sim.requetes.filter((r) => r.chemin.startsWith('/gmail/') && r.methode !== 'GET').map((r) => r.chemin)).toEqual([
      '/gmail/v1/users/me/watch',
    ]);
  });

  it('notification répétée : aucun doublon', async () => {
    const etat = await banc.connecter('gmail');
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'gmail', { pieces: [{ nom: 'a.pdf', typeMime: 'application/pdf', contenu: pdf('a') }] });
    const corps = banc.sim.corpsPushGmail();
    const resultats = [await recevoirPush(etat.id, corps), await recevoirPush(etat.id, corps), await recevoirPush(etat.id, corps)];
    expect(resultats.map((r) => r.compteurs.piecesDeposees)).toEqual([1, 0, 0]);
    expect(banc.recepteur.noms).toEqual(['a.pdf']);
  });

  it('notifications dans le désordre et simultanées : même résultat', async () => {
    const etat = await banc.connecter('gmail');
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'gmail', { pieces: [{ nom: 'a.pdf', typeMime: 'application/pdf', contenu: pdf('a') }] });
    const premiere = banc.sim.corpsPushGmail();
    ajouter(banc, 'gmail', { pieces: [{ nom: 'b.pdf', typeMime: 'application/pdf', contenu: pdf('b') }] });
    const seconde = banc.sim.corpsPushGmail();
    // La plus récente arrive d'abord, puis l'ancienne, puis les deux en même temps.
    await recevoirPush(etat.id, seconde);
    await recevoirPush(etat.id, premiere);
    await Promise.all([recevoirPush(etat.id, premiere), recevoirPush(etat.id, seconde)]);
    expect(banc.recepteur.noms).toEqual(['a.pdf', 'b.pdf']);
    // Le curseur n'a pas reculé : la synchronisation suivante n'a rien à faire et ne repart pas de zéro.
    const suivante = await banc.moteur.synchroniser(etat.id);
    expect(suivante.compteurs).toMatchObject({ messagesExamines: 0, resynchronisationsCompletes: 0 });
  });

  it('notification manquée : rattrapée par la synchronisation périodique', async () => {
    const etat = await banc.connecter('gmail');
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'gmail', { pieces: [{ nom: 'oubliee.pdf', typeMime: 'application/pdf', contenu: pdf('o') }] });
    // Aucune notification n'arrive.
    const resultat = await banc.moteur.synchroniser(etat.id, { declencheur: 'periodique' });
    expect(resultat.compteurs.piecesDeposees).toBe(1);
    expect(banc.recepteur.noms).toEqual(['oubliee.pdf']);
  });

  it('historique expiré (404) : resynchronisation complète bornée par la date de début et le libellé', async () => {
    ajouter(banc, 'gmail', { date: joursAvant(3), pieces: [{ nom: 'deja-vue.pdf', typeMime: 'application/pdf', contenu: pdf('1') }] });
    const etat = await banc.connecter('gmail');
    await banc.moteur.synchroniser(etat.id);
    ajouter(banc, 'gmail', { date: joursAvant(0.1), pieces: [{ nom: 'nouvelle.pdf', typeMime: 'application/pdf', contenu: pdf('2') }] });
    ajouter(banc, 'gmail', { date: joursAvant(45), pieces: [{ nom: 'trop-ancienne.pdf', typeMime: 'application/pdf', contenu: pdf('3') }] });
    banc.sim.ajouterMessageGmail(
      { de: 'x@fournisseur.example', a: [], objet: 'autre libellé', date: joursAvant(1), pieces: [{ nom: 'hors-libelle.pdf', typeMime: 'application/pdf', contenu: pdf('4') }] },
      ['Label_perso'],
    );
    banc.sim.expirerHistoriqueGmail();

    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.issue).toBe('terminee');
    expect(resultat.compteurs.resynchronisationsCompletes).toBe(1);
    expect(resultat.compteurs.piecesDejaVues).toBe(1);
    expect(banc.recepteur.noms).toEqual(['deja-vue.pdf', 'nouvelle.pdf']);
    // La liste complète est bornée : libellé surveillé + `after:` à la date de début (30 jours avant la connexion).
    const liste = banc.sim.requetes.filter((r) => r.chemin === '/gmail/v1/users/me/messages').at(-1);
    const q = new URLSearchParams(liste?.recherche);
    expect(q.get('labelIds')).toBe('INBOX');
    expect(q.get('q')).toBe(`after:${Math.floor(joursAvant(30).getTime() / 1000)}`);
    // Ensuite, retour au mode incrémental.
    const suivante = await banc.moteur.synchroniser(etat.id);
    expect(suivante.compteurs.resynchronisationsCompletes).toBe(0);
  });

  it('pagination sur plusieurs pages (liste complète puis historique)', async () => {
    banc.sim.taillePageMax = 2;
    for (let i = 0; i < 5; i++) ajouter(banc, 'gmail', { date: joursAvant(i + 1), pieces: [{ nom: `init-${i}.pdf`, typeMime: 'application/pdf', contenu: pdf(`i${i}`) }] });
    const etat = await banc.connecter('gmail');
    await banc.moteur.synchroniser(etat.id);
    expect(banc.recepteur.depots).toHaveLength(5);
    expect(banc.sim.compter(/\/users\/me\/messages$/)).toBe(3);

    for (let i = 0; i < 5; i++) ajouter(banc, 'gmail', { pieces: [{ nom: `suite-${i}.pdf`, typeMime: 'application/pdf', contenu: pdf(`s${i}`) }] });
    const resultat = await banc.moteur.synchroniser(etat.id);
    expect(resultat.compteurs.piecesDeposees).toBe(5);
    expect(banc.sim.compter(/\/users\/me\/history$/)).toBe(3);
    expect(banc.recepteur.depots).toHaveLength(10);
  });

  it('panne au milieu d’une page puis reprise : ni perte ni doublon', async () => {
    banc.sim.taillePageMax = 3;
    const ids = [1, 2, 3, 4, 5].map((i) =>
      ajouter(banc, 'gmail', { date: joursAvant(i), pieces: [{ nom: `p${i}.pdf`, typeMime: 'application/pdf', contenu: pdf(`p${i}`) }] }),
    );
    const etat = await banc.connecter('gmail');
    // Le deuxième message de la première page est en panne durable (plus que le nombre de reprises).
    banc.sim.injecterErreur({ chemin: new RegExp(`/messages/${ids[1]}$`), statut: 500, fois: 6 });
    const interrompue = await banc.moteur.synchroniser(etat.id);
    expect(interrompue.issue).toBe('interrompue');
    expect(banc.recepteur.noms).toEqual(['p1.pdf']);
    // Le curseur n'a pas avancé : la page sera rejouée en entier.
    expect(banc.magasin.obtenir(etat.id).curseurs['INBOX']).toBeUndefined();

    const reprise = await banc.moteur.synchroniser(etat.id);
    expect(reprise.issue).toBe('terminee');
    expect(reprise.compteurs.piecesDejaVues).toBe(1);
    expect(banc.recepteur.noms).toEqual(['p1.pdf', 'p2.pdf', 'p3.pdf', 'p4.pdf', 'p5.pdf']);
  });

  it('date de début : 30 jours avant la connexion par défaut, modifiable', async () => {
    ajouter(banc, 'gmail', { date: joursAvant(10), pieces: [{ nom: 'j-10.pdf', typeMime: 'application/pdf', contenu: pdf('10') }] });
    ajouter(banc, 'gmail', { date: joursAvant(45), pieces: [{ nom: 'j-45.pdf', typeMime: 'application/pdf', contenu: pdf('45') }] });
    const parDefaut = await banc.connecter('gmail');
    await banc.moteur.synchroniser(parDefaut.id);
    expect(banc.recepteur.noms).toEqual(['j-10.pdf']);

    const etendue = await banc.connecter('gmail', { dateDebut: joursAvant(60).toISOString() });
    await banc.moteur.synchroniser(etendue.id);
    expect(banc.recepteur.depots.filter((d) => d.provenance.connexionId === etendue.id).map((d) => d.provenance.nomFichier).sort()).toEqual([
      'j-10.pdf',
      'j-45.pdf',
    ]);
  });

  it('surveillance : renouvelée avant expiration, pas à chaque appel', async () => {
    const etat = await banc.connecter('gmail');
    await banc.moteur.entretenirSurveillance(etat.id);
    await banc.moteur.entretenirSurveillance(etat.id);
    expect(banc.sim.gmail.appelsWatch).toBe(1);
    banc.horloge.avancer(JOUR + 3600 * 1000);
    const renouvelee = await banc.moteur.entretenirSurveillance(etat.id);
    expect(banc.sim.gmail.appelsWatch).toBe(2);
    expect(renouvelee?.mode === 'gmail_watch' && new Date(renouvelee.echeance).getTime()).toBe(banc.horloge.t + 7 * JOUR);
  });

  it('sans sujet Pub/Sub : surveillance déclarée périodique', async () => {
    await banc.fermer();
    banc = await creerBanc({ notifications: false });
    const etat = await banc.connecter('gmail');
    expect((await banc.moteur.entretenirSurveillance(etat.id))?.mode).toBe('periodique');
    expect(banc.sim.gmail.appelsWatch).toBe(0);
  });
});
