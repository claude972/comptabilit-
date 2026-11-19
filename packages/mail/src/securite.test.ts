import { generateKeyPairSync, createSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chiffrerJetons, dechiffrerJetons, doitEtreRechiffre } from './chiffrement.js';
import { clesSurveillees, resoudreDateDebut, schemaConfigurationConnexion } from './configuration.js';
import { ErreurChiffrement, ErreurHoteInterdit, ErreurNotification, ErreurOAuth } from './erreurs.js';
import { ajouter, CLE, CLIENT, creerBanc, DEBUT, joursAvant, pdf, SECRET_ETAT, type Banc } from './essais/outils.js';
import { creerHttpGarde } from './http.js';
import * as paquet from './index.js';
import { chargerClesGoogle, validerPushPubSub } from './notifications.js';
import { defiPkceS256, preparerAutorisation, validerRetourAutorisation } from './oauth.js';
import { decrirePerimetre } from './perimetre.js';
import { COMPTE_SERVICE_PUBSUB_SIMULE, NOM_SIMULATEUR, SimulateurMail } from './simulateur/index.js';
import { evaluerStatutIntegration, STATUT_INTEGRATION_INITIAL } from './statut.js';
import type { JeuDeJetons } from './types.js';

const JETONS: JeuDeJetons = {
  jetonAcces: 'acces-secret',
  expireLe: '2026-11-19T11:00:00.000Z',
  jetonRafraichissement: 'rafraichissement-secret',
  scopes: ['Mail.Read'],
  etatClient: 'etat-client-secret',
};

describe('Chiffrement des jetons', () => {
  it('aller-retour, IV aléatoire, rien en clair', () => {
    const a = chiffrerJetons(JETONS, 'cx-1', CLE);
    const b = chiffrerJetons(JETONS, 'cx-1', CLE);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.cle-2026\.[\w-]{16}\.[\w-]+\.[\w-]{22}$/);
    expect(a).not.toContain('secret');
    expect(dechiffrerJetons(a, 'cx-1', { courante: CLE })).toEqual(JETONS);
  });

  it('altération détectée', () => {
    const enveloppe = chiffrerJetons(JETONS, 'cx-1', CLE);
    const parties = enveloppe.split('.');
    const chiffre = Buffer.from(parties[3] ?? '', 'base64url');
    chiffre[5] = (chiffre[5] ?? 0) ^ 0x01;
    const alteree = [parties[0], parties[1], parties[2], chiffre.toString('base64url'), parties[4]].join('.');
    expect(() => dechiffrerJetons(alteree, 'cx-1', { courante: CLE })).toThrow(ErreurChiffrement);
    const etiquette = [...parties.slice(0, 4), Buffer.alloc(16, 1).toString('base64url')].join('.');
    expect(() => dechiffrerJetons(etiquette, 'cx-1', { courante: CLE })).toThrow(ErreurChiffrement);
    expect(() => dechiffrerJetons('v2.x.y.z.t', 'cx-1', { courante: CLE })).toThrow(/format inconnu/);
  });

  it('mauvais identifiant de connexion refusé', () => {
    const enveloppe = chiffrerJetons(JETONS, 'cx-1', CLE);
    expect(() => dechiffrerJetons(enveloppe, 'cx-2', { courante: CLE })).toThrow(ErreurChiffrement);
  });

  it('rotation de clé et clés invalides', () => {
    const ancienne = chiffrerJetons(JETONS, 'cx-1', CLE);
    const nouvelle = { id: 'cle-2027', cle: Buffer.alloc(32, 3) };
    expect(dechiffrerJetons(ancienne, 'cx-1', { courante: nouvelle, anciennes: [CLE] })).toEqual(JETONS);
    expect(doitEtreRechiffre(ancienne, { courante: nouvelle, anciennes: [CLE] })).toBe(true);
    expect(() => dechiffrerJetons(ancienne, 'cx-1', { courante: nouvelle })).toThrow(/Aucune clé/);
    expect(() => dechiffrerJetons(ancienne, 'cx-1', { courante: { id: 'cle-2026', cle: Buffer.alloc(32, 1) } })).toThrow(ErreurChiffrement);
    expect(() => chiffrerJetons(JETONS, 'cx-1', { id: 'courte', cle: Buffer.alloc(16) })).toThrow(/32 octets/);
  });
});

describe('OAuth : state, PKCE, scopes', () => {
  const base = { client: CLIENT, sessionId: 'session-A', secretEtat: SECRET_ETAT, maintenant: DEBUT };
  const gmail = () =>
    preparerAutorisation({ ...base, fournisseur: 'gmail', urlAutorisation: 'https://accounts.google.com/o/oauth2/v2/auth', boite: { type: 'personnelle' } });
  const microsoft = (boite: paquet.TypeBoite) =>
    preparerAutorisation({ ...base, fournisseur: 'microsoft', urlAutorisation: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', boite });

  it('URL Gmail : PKCE S256, state, accès hors ligne, scope de lecture seul', () => {
    const { url, aConserver } = gmail();
    const q = new URL(url).searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(defiPkceS256(aConserver.codeVerifier));
    expect(aConserver.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toBe(aConserver.state);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('nonce')).toBeNull();
    expect(url).not.toContain(aConserver.codeVerifier);
    expect(gmail().aConserver.state).not.toBe(aConserver.state);
  });

  it('URL Microsoft : nonce OIDC ; Mail.Read.Shared uniquement pour une boîte partagée, avec consentement explicite', () => {
    const personnelle = new URL(microsoft({ type: 'personnelle' }).url).searchParams;
    expect(personnelle.get('scope')).toBe('openid profile offline_access https://graph.microsoft.com/Mail.Read');
    expect(personnelle.get('nonce')).toMatch(/^[\w-]{22}$/);
    expect(personnelle.get('code_challenge_method')).toBe('S256');
    const partagee = new URL(microsoft({ type: 'partagee', adresse: 'factures@cabinet.example' }).url).searchParams;
    expect(partagee.get('scope')).toBe('openid profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Read.Shared');
    expect(partagee.get('prompt')).toBe('consent');
    // Aucun scope d'envoi, de modification ou de suppression, quel que soit le cas.
    for (const scope of [personnelle.get('scope'), partagee.get('scope'), new URL(gmail().url).searchParams.get('scope')]) {
      expect(scope).not.toMatch(/send|write|modify|compose|insert|delete|mail\.google\.com|full/i);
    }
  });

  it('retour : bon state accepté ; mauvais state, autre session, expiration et refus rejetés', () => {
    const { aConserver } = gmail();
    const valider = (retour: Record<string, string>, autres: Partial<Parameters<typeof validerRetourAutorisation>[0]> = {}) =>
      validerRetourAutorisation({ retour, attendu: aConserver, sessionId: 'session-A', secretEtat: SECRET_ETAT, maintenant: DEBUT, ...autres });
    expect(valider({ state: aConserver.state, code: 'abc' })).toEqual({ code: 'abc' });
    expect(() => valider({ state: 'forge', code: 'abc' })).toThrow(expect.objectContaining({ code: 'state_invalide' }));
    expect(() => valider({ code: 'abc' })).toThrow(expect.objectContaining({ code: 'state_invalide' }));
    expect(() => valider({ state: aConserver.state, code: 'abc' }, { sessionId: 'session-B' })).toThrow(expect.objectContaining({ code: 'state_autre_session' }));
    expect(() => valider({ state: aConserver.state, code: 'abc' }, { attendu: null })).toThrow(expect.objectContaining({ code: 'demande_inconnue' }));
    expect(() => valider({ state: aConserver.state, code: 'abc' }, { maintenant: new Date(DEBUT.getTime() + 11 * 60 * 1000) })).toThrow(
      expect.objectContaining({ code: 'demande_expiree' }),
    );
    expect(() => valider({ state: aConserver.state, error: 'access_denied' })).toThrow(expect.objectContaining({ code: 'refus_fournisseur:access_denied' }));
    expect(() => valider({ state: aConserver.state })).toThrow(expect.objectContaining({ code: 'code_absent' }));
  });

  describe('contre le simulateur', () => {
    let banc: Banc;
    beforeEach(async () => {
      banc = await creerBanc();
    });
    afterEach(() => banc.fermer());

    it('retour avec mauvais state : refusé avant tout échange de code', async () => {
      const fournisseur = paquet.creerFournisseurGmail({ client: CLIENT, urls: banc.sim.urlsGmail });
      const demande = fournisseur.preparerAutorisation({ boite: { type: 'personnelle' }, sessionId: 's1', secretEtat: SECRET_ETAT, maintenant: DEBUT });
      const retour = new URL((await fetch(demande.url, { redirect: 'manual' })).headers.get('location') ?? '').searchParams;
      retour.set('state', 'state-d-un-attaquant');
      const tentative = banc.moteur.creerConnexion({
        connexionId: 'cx-x',
        retour,
        attendu: demande.aConserver,
        sessionId: 's1',
        secretEtat: SECRET_ETAT,
        configuration: { fournisseur: 'gmail', rattachement: { dossiersComptables: ['A'] } },
      });
      await expect(tentative).rejects.toBeInstanceOf(ErreurOAuth);
      await expect(tentative).rejects.toMatchObject({ code: 'state_invalide' });
      expect(banc.sim.compteurs.echanges).toBe(0);
      expect(banc.magasin.etats.size).toBe(0);
    });

    it('PKCE : un vérifieur qui ne correspond pas au défi est refusé par le point de jetons', async () => {
      const fournisseur = paquet.creerFournisseurGmail({ client: CLIENT, urls: banc.sim.urlsGmail });
      const demande = fournisseur.preparerAutorisation({ boite: { type: 'personnelle' }, sessionId: 's1', secretEtat: SECRET_ETAT, maintenant: DEBUT });
      const retour = new URL((await fetch(demande.url, { redirect: 'manual' })).headers.get('location') ?? '').searchParams;
      const tentative = banc.moteur.creerConnexion({
        connexionId: 'cx-y',
        retour,
        attendu: { ...demande.aConserver, codeVerifier: 'x'.repeat(43) },
        sessionId: 's1',
        secretEtat: SECRET_ETAT,
        configuration: { fournisseur: 'gmail', rattachement: { dossiersComptables: ['A'] } },
      });
      await expect(tentative).rejects.toMatchObject({ code: 'code_refuse' });
      expect(banc.magasin.etats.size).toBe(0);
    });

    it('push Pub/Sub : jeton OIDC valide accepté ; audience, compte, expiration et signature contrôlés', async () => {
      const cles = await chargerClesGoogle(fetch, banc.sim.urlClesGoogle);
      const exp = Math.floor(DEBUT.getTime() / 1000) + 600;
      const params = (jeton: string | undefined, corps: unknown = banc.sim.corpsPushGmail(4242)) => ({
        autorisation: jeton === undefined ? undefined : `Bearer ${jeton}`,
        corps,
        audienceAttendue: 'https://api.comtaple.test/gmail',
        compteServiceAttendu: COMPTE_SERVICE_PUBSUB_SIMULE,
        cles,
        maintenant: DEBUT,
      });
      const bon = banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp });
      expect(validerPushPubSub(params(bon))).toEqual({ adresse: banc.sim.gmail.adresse, idHistorique: '4242' });

      const refuse = (jeton: string | undefined, code: string, corps?: unknown) => {
        expect(() => validerPushPubSub(params(jeton, corps))).toThrow(ErreurNotification);
        expect(() => validerPushPubSub(params(jeton, corps))).toThrow(expect.objectContaining({ code }));
      };
      refuse(undefined, 'jeton_absent');
      refuse(banc.sim.jetonPushPubSub({ aud: 'https://autre.example', exp }), 'audience_invalide');
      refuse(banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp, email: 'intrus@projet.iam.gserviceaccount.com' }), 'compte_service_invalide');
      refuse(banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp, email_verified: false }), 'compte_service_invalide');
      refuse(banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp, iss: 'https://faux.example' }), 'emetteur_invalide');
      refuse(banc.sim.jetonPushPubSub({ aud: 'https://api.comtaple.test/gmail', exp: exp - 3600 }), 'jeton_invalide');
      // Signé par une autre clé.
      const autre = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const [entete, charge] = bon.split('.') as [string, string];
      const fausse = createSign('RSA-SHA256').update(`${entete}.${charge}`).sign(autre.privateKey).toString('base64url');
      refuse(`${entete}.${charge}.${fausse}`, 'jeton_invalide');
      // alg=none.
      const sansSignature = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${charge}.`;
      refuse(sansSignature, 'jeton_invalide');
      // Corps inattendu.
      refuse(bon, 'corps_invalide', { message: { data: Buffer.from('{"emailAddress":"pas une adresse"}').toString('base64url') } });
    });

    it('statut d’intégration : le simulateur ne donne jamais « connecte »', async () => {
      expect(STATUT_INTEGRATION_INITIAL).toEqual({ gmail: 'non_connecte', microsoft: 'non_connecte' });
      expect(evaluerStatutIntegration('gmail', null).statut).toBe('non_connecte');
      for (const fournisseur of ['gmail', 'microsoft'] as const) {
        const etat = await banc.connecter(fournisseur);
        const preuve = await banc.moteur.verifierConnexionReelle(etat.id);
        expect(preuve.reponseSimulateur).toBe(true);
        const evaluation = evaluerStatutIntegration(fournisseur, preuve);
        expect(evaluation.statut).toBe('non_connecte');
        expect(evaluation.raisons).toHaveLength(3);
        // Même en maquillant l'en-tête, les hôtes ne sont pas les hôtes officiels.
        expect(evaluerStatutIntegration(fournisseur, { ...preuve, reponseSimulateur: false }).statut).toBe('non_connecte');
      }
      // Seule une preuve obtenue sur les hôtes officiels, en HTTPS, donne « connecte ».
      const officielle = { fournisseur: 'gmail' as const, verifieeLe: DEBUT.toISOString(), urlApi: 'https://gmail.googleapis.com', urlJeton: 'https://oauth2.googleapis.com/token', reponseSimulateur: false };
      expect(evaluerStatutIntegration('gmail', officielle).statut).toBe('connecte');
      expect(evaluerStatutIntegration('microsoft', officielle).statut).toBe('non_connecte');
      expect(evaluerStatutIntegration('gmail', { ...officielle, urlApi: 'http://gmail.googleapis.com' }).statut).toBe('non_connecte');
      expect(evaluerStatutIntegration('gmail', { ...officielle, urlApi: 'https://gmail.googleapis.com.mal.example' }).statut).toBe('non_connecte');
    });

    it('simulateur clairement identifié : en-tête, refus en production, absent de l’export principal', async () => {
      const reponse = await fetch(`${banc.sim.origine}/gmail/v1/users/me/profile`);
      expect(reponse.status).toBe(401);
      expect(reponse.headers.get('x-simulateur')).toBe(NOM_SIMULATEUR);
      expect(Object.keys(paquet).filter((nom) => /simul/i.test(nom))).toEqual([]);

      const avant = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      try {
        await expect(new SimulateurMail().demarrer()).rejects.toThrow(/refuse de démarrer/);
      } finally {
        process.env['NODE_ENV'] = avant;
      }
    });

    it('suppression : révocation Google, jetons effacés ; Microsoft : ce qui reste à l’utilisateur est dit', async () => {
      const g = await banc.connecter('gmail');
      await banc.moteur.entretenirSurveillance(g.id);
      const resultatG = await banc.moteur.supprimerConnexion(g.id);
      expect(resultatG).toEqual({ revoqueChezFournisseur: true, actionsRestantes: [] });
      expect(banc.sim.compteurs.revocations).toBe(1);
      expect(banc.sim.gmail.surveillance).toBeNull();
      expect(banc.magasin.obtenir(g.id)).toMatchObject({ statut: 'supprimee', jetonsChiffres: null, surveillance: null });
      expect((await banc.moteur.synchroniser(g.id)).issue).toBe('ignoree');

      const m = await banc.connecter('microsoft');
      await banc.moteur.entretenirSurveillance(m.id);
      expect(banc.sim.microsoft.abonnements.size).toBe(1);
      const resultatM = await banc.moteur.supprimerConnexion(m.id);
      expect(resultatM.revoqueChezFournisseur).toBe(false);
      expect(resultatM.actionsRestantes.join(' ')).toMatch(/Mes applications/);
      expect(banc.sim.microsoft.abonnements.size).toBe(0);
      expect(banc.magasin.obtenir(m.id)).toMatchObject({ statut: 'supprimee', jetonsChiffres: null });
    });

    it('périmètre : permissions du jeton et filtres du logiciel sont deux listes distinctes', async () => {
      ajouter(banc, 'gmail', { pieces: [{ nom: 'a.pdf', typeMime: 'application/pdf', contenu: pdf('a') }] });
      const etat = await banc.connecter('gmail', {
        dossiers: ['Label_factures'],
        filtres: { expediteursAutorises: ['@fournisseur.example'], objetContient: ['facture'], avecPieceJointeUniquement: true },
      });
      const perimetre = decrirePerimetre(etat);
      expect(perimetre.permissionsOAuth).toHaveLength(1);
      expect(perimetre.permissionsOAuth[0]?.scope).toBe('https://www.googleapis.com/auth/gmail.readonly');
      expect(perimetre.permissionsOAuth[0]?.portee).toMatch(/TOUS les messages/);
      expect(perimetre.filtresLogiciel.map((f) => f.type)).toEqual(['dossiers', 'date_debut', 'taille_max', 'expediteurs', 'objet', 'piece_jointe']);
      // Le libellé n'apparaît que du côté des filtres, jamais comme une restriction du jeton.
      expect(JSON.stringify(perimetre.permissionsOAuth)).not.toContain('Label_factures');
      expect(perimetre.filtresLogiciel[0]?.libelle).toBe('Libellés surveillés : Label_factures');
      expect(perimetre.filtresLogiciel[1]?.libelle).toBe(`Messages reçus à partir du ${joursAvant(30).toISOString().slice(0, 10)}`);
      expect(perimetre.texte).toContain('Ils ne réduisent pas l’autorisation accordée');
      expect(perimetre.texte.indexOf('permet techniquement')).toBeLessThan(perimetre.texte.indexOf('filtres du logiciel'));

      // Les filtres s'appliquent bien : le message est hors du libellé surveillé.
      await banc.moteur.synchroniser(etat.id);
      expect(banc.recepteur.depots).toHaveLength(0);
    });

    it('filtres d’expéditeur et d’objet appliqués par le logiciel', async () => {
      ajouter(banc, 'gmail', { objet: 'Facture n° 12', pieces: [{ nom: 'retenue.pdf', typeMime: 'application/pdf', contenu: pdf('1') }] });
      ajouter(banc, 'gmail', { objet: 'Publicité', pieces: [{ nom: 'objet.pdf', typeMime: 'application/pdf', contenu: pdf('2') }] });
      ajouter(banc, 'gmail', { objet: 'Facture', de: 'x@inconnu.example', pieces: [{ nom: 'expediteur.pdf', typeMime: 'application/pdf', contenu: pdf('3') }] });
      const etat = await banc.connecter('gmail', { filtres: { expediteursAutorises: ['fournisseur.example'], objetContient: ['FACTURE'] } });
      const resultat = await banc.moteur.synchroniser(etat.id);
      expect(banc.recepteur.noms).toEqual(['retenue.pdf']);
      expect(resultat.compteurs.messagesFiltres).toBe(2);
    });
  });
});

describe('Garde d’hôtes et configuration', () => {
  it('toute requête hors des hôtes du fournisseur est refusée, sans appel réseau', async () => {
    let appels = 0;
    const garde = creerHttpGarde(() => {
      appels++;
      return Promise.resolve(new Response('ok'));
    }, ['https://gmail.googleapis.com']);
    await expect(garde('https://portail.fournisseur.example/facture')).rejects.toBeInstanceOf(ErreurHoteInterdit);
    await expect(garde('https://gmail.googleapis.com.mal.example/x')).rejects.toBeInstanceOf(ErreurHoteInterdit);
    await expect(garde('pas une url')).rejects.toBeInstanceOf(ErreurHoteInterdit);
    expect(appels).toBe(0);
    expect((await garde('https://gmail.googleapis.com/gmail/v1/users/me/profile')).ok).toBe(true);
  });

  it('schéma : valeurs par défaut, normalisation et incohérences refusées', () => {
    const config = schemaConfigurationConnexion.parse({
      fournisseur: 'gmail',
      filtres: { expediteursAutorises: ['@Fournisseur.EXAMPLE', 'Compta@Edf.example'] },
      rattachement: { dossiersComptables: ['A'] },
    });
    expect(config.boite).toEqual({ type: 'personnelle' });
    expect(config.tailleMaxPieceJointeOctets).toBe(25 * 1024 * 1024);
    expect(config.filtres).toEqual({ expediteursAutorises: ['fournisseur.example', 'compta@edf.example'], objetContient: [], avecPieceJointeUniquement: false });
    expect(clesSurveillees(config)).toEqual(['INBOX']);
    expect(resoudreDateDebut(config, DEBUT)).toEqual(joursAvant(30));
    expect(resoudreDateDebut({ ...config, dateDebut: '2026-01-01T00:00:00Z' }, DEBUT)).toEqual(new Date('2026-01-01T00:00:00Z'));

    const refuse = (entree: unknown) => expect(schemaConfigurationConnexion.safeParse(entree).success).toBe(false);
    refuse({ fournisseur: 'gmail', boite: { type: 'partagee', adresse: 'x@y.example' }, rattachement: { dossiersComptables: ['A'] } });
    refuse({ fournisseur: 'microsoft', rattachement: { dossiersComptables: [] } });
    refuse({ fournisseur: 'microsoft', rattachement: { dossiersComptables: ['A'], regles: [{ type: 'expediteur', valeur: 'x.example', dossierComptable: 'B' }] } });
    refuse({ fournisseur: 'microsoft', rattachement: { dossiersComptables: ['A'], dossierParDefaut: 'Z' } });
    refuse({ fournisseur: 'imap', rattachement: { dossiersComptables: ['A'] } });
  });
});
