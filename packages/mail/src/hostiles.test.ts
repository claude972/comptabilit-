/**
 * Messages et pièces jointes HOSTILES. Le paquet ne décode pas de MIME : Gmail et Microsoft Graph rendent des messages
 * déjà analysés, en JSON. Ces tests portent donc sur ce qui reste à la charge du paquet : la taille des réponses, le
 * parcours de l'arbre des parties, les noms de fichiers venus de l'expéditeur.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErreurProtocole } from './erreurs.js';
import { ajouter, creerBanc, pdf, type Banc } from './essais/outils.js';
import { lireJson, REPONSE_JSON_MAX_OCTETS, type ContexteAppel } from './fournisseurs/commun.js';
import { creerFournisseurGmail } from './fournisseurs/gmail.js';
import { creerFournisseurMicrosoft } from './fournisseurs/microsoft.js';
import { assainirNomPiece, categoriserPiece, LIMITES_MESSAGE } from './pieces.js';

const URLS_GMAIL = { autorisation: 'https://sim.test/auth', jeton: 'https://sim.test/jeton', revocation: 'https://sim.test/revoke', api: 'https://sim.test' };
const CLIENT = { clientId: 'client', clientSecret: 'secret', uriRedirection: 'https://app.test/retour' };
const json = (corps: unknown): Response => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
const contexte = (repondre: (url: string) => Response): ContexteAppel => ({ requete: (url) => Promise.resolve(repondre(url)), boite: { type: 'personnelle' } as ContexteAppel['boite'], dateDebut: new Date(0) });
const texte = (t: string) => Buffer.from(t).toString('base64url');
const feuille = (i: number, nom = `piece-${i}.pdf`) => ({ partId: `p${i}`, mimeType: 'application/pdf', filename: nom, headers: [], body: { attachmentId: `a${i}`, size: 1000 } });
const messageGmail = (payload: unknown) => ({ id: 'm1', internalDate: '1763546400000', payload });

describe('nom de pièce jointe piégé', () => {
  it.each([
    ['../../../../etc/passwd', 'passwd'],
    ['..\\..\\Windows\\System32\\config\\SAM.pdf', 'SAM.pdf'],
    ['/var/www/html/index.php', 'index.php'],
    ['C:\\Users\\Public\\facture.pdf', 'facture.pdf'],
    ['facture.pdf\u0000.exe', 'facture.pdf.exe'],
    ['facture\u202Efdp.exe', 'facturefdp.exe'],
    ['\u200Bfacture\uFEFF.pdf', 'facture.pdf'],
    ['  ...htaccess', 'htaccess'],
    ['fac\r\nture\t2026.pdf', 'facture2026.pdf'],
    ['', 'piece-jointe'],
    ['../', 'piece-jointe'],
    ['\u0000\u0001', 'piece-jointe'],
  ])('%j → %j', (brut, attendu) => {
    expect(assainirNomPiece(brut)).toBe(attendu);
  });

  it('nom démesuré : borné à 255 caractères en gardant l’extension ; valeur non textuelle neutralisée', () => {
    const long = assainirNomPiece(`${'a'.repeat(100_000)}.pdf`);
    expect(long).toHaveLength(LIMITES_MESSAGE.nomFichier);
    expect(long.endsWith('.pdf')).toBe(true);
    expect(assainirNomPiece({ toString: () => '../x' })).toBe('piece-jointe');
    expect(assainirNomPiece(undefined)).toBe('piece-jointe');
  });

  it('un nom qui s’affichait à l’envers ou cachait son extension est classé d’après son extension RÉELLE', () => {
    // « facture[RLO]fdp.exe » s'affiche « factureexe.pdf » : c'est un exécutable.
    expect(categoriserPiece(assainirNomPiece('facture\u202Efdp.exe'), 'application/pdf')).toBe('executable');
    expect(categoriserPiece(assainirNomPiece('facture.pdf\u0000.exe'), 'application/pdf')).toBe('executable');
    expect(categoriserPiece(assainirNomPiece('../../facture.pdf'), 'application/pdf')).toBe('pdf');
  });

  describe('chaîne complète contre le simulateur', () => {
    let banc: Banc;
    beforeEach(async () => {
      banc = await creerBanc({});
    });
    afterEach(() => banc.fermer());

    it.each(['gmail', 'microsoft'] as const)('%s : le dépôt et les signalements ne voient que des noms assainis ; l’exécutable déguisé est écarté', async (fournisseur) => {
      ajouter(banc, fournisseur, {
        pieces: [
          { nom: '../../../etc/cron.d/facture.pdf', typeMime: 'application/pdf', contenu: pdf('a') },
          { nom: 'releve\u202Efdp.exe', typeMime: 'application/pdf', contenu: Buffer.from('MZ') },
          { nom: `${'x'.repeat(600)}.pdf`, typeMime: 'application/pdf', contenu: pdf('b') },
        ],
      });
      const etat = await banc.connecter(fournisseur);
      const resultat = await banc.moteur.synchroniser(etat.id);
      expect(banc.recepteur.noms).toEqual(['facture.pdf', `${'x'.repeat(251)}.pdf`].sort());
      for (const nom of banc.recepteur.noms) expect(nom).not.toMatch(/[\\/\u0000-\u001f\u202a-\u202e]|\.\./);
      expect(resultat.signalements).toEqual([expect.objectContaining({ type: 'piece_ignoree', nomFichier: 'relevefdp.exe', motif: 'executable' })]);
      expect(resultat.pieces.map((p) => p.nomFichier).sort()).toEqual(banc.recepteur.noms);
    });
  });
});

describe('message Gmail à l’arbre de parties hostile (lecture directe de la réponse de l’API)', () => {
  const gmail = creerFournisseurGmail({ client: CLIENT, urls: URLS_GMAIL });
  const lire = (payload: unknown) => gmail.lireMessage(contexte(() => json(messageGmail(payload))), 'm1');

  it('parties imbriquées sur 5 000 niveaux : lecture bornée en profondeur, sans débordement de pile ; la pièce enfouie est ignorée', async () => {
    // Le JSON est assemblé à la main : sérialiser un objet aussi profond déborderait la pile du test lui-même.
    const niveaux = 5000;
    const arbre = `${'{"mimeType":"multipart/mixed","filename":"","body":{},"parts":['.repeat(niveaux)}${JSON.stringify(feuille(0, 'enfouie.pdf'))}${']}'.repeat(niveaux)}`;
    const entetes = JSON.stringify([{ name: 'From', value: 'a@b.fr' }, { name: 'Subject', value: 'profond' }]);
    const corps = `{"id":"m1","internalDate":"1763546400000","payload":{"mimeType":"multipart/mixed","filename":"","headers":${entetes},"body":{},"parts":[${JSON.stringify(feuille(1, 'visible.pdf'))},${arbre}]}}`;
    const m = await gmail.lireMessage(contexte(() => new Response(corps)), 'm1');
    expect(m).toMatchObject({ id: 'm1', expediteur: 'a@b.fr', objet: 'profond' });
    expect(m!.piecesJointes.map((p) => p.nom)).toEqual(['visible.pdf']);
  });

  it('imbrication juste sous la borne : la pièce est encore lue', async () => {
    let arbre: Record<string, unknown> = feuille(0, 'profonde.pdf');
    for (let i = 0; i < LIMITES_MESSAGE.profondeurParties - 1; i++) arbre = { mimeType: 'multipart/mixed', filename: '', body: {}, parts: [arbre] };
    expect((await lire({ mimeType: 'multipart/mixed', filename: '', body: {}, parts: [arbre] }))!.piecesJointes.map((p) => p.nom)).toEqual(['profonde.pdf']);
  });

  it('message très large : 50 000 parties et 50 000 pièces → au plus 2 000 parties visitées et 200 pièces retenues', async () => {
    const large = await lire({ mimeType: 'multipart/mixed', filename: '', body: {}, parts: Array.from({ length: 50_000 }, (_, i) => feuille(i)) });
    expect(large!.piecesJointes).toHaveLength(LIMITES_MESSAGE.pieces);
    // Arbre en éventail (10 × 10 × 10 × 10 × 10 nœuds) : le parcours s'arrête au nombre maximal de parties.
    const eventail = (niveau: number): Record<string, unknown> => ({ mimeType: 'multipart/mixed', filename: '', body: {}, parts: niveau === 0 ? [{ mimeType: 'text/plain', filename: '', body: { data: texte('x') } }] : Array.from({ length: 10 }, () => eventail(niveau - 1)) });
    const debut = performance.now();
    const m = await lire({ ...eventail(5), headers: [] });
    expect(m!.piecesJointes).toEqual([]);
    expect(performance.now() - debut).toBeLessThan(5000);
  });

  it('structures inattendues (parts qui n’est pas un tableau, types faux, noms non textuels) : ignorées sans erreur', async () => {
    const m = await lire({
      mimeType: 42, filename: null, headers: 'x', body: 'y',
      parts: [null, 'texte', 7, { filename: { a: 1 }, partId: 'p', body: { attachmentId: 'a' } }, { filename: '../../x.pdf', partId: 3, body: { attachmentId: 'a' } }, { filename: '..\\y.pdf\u0000', partId: 'ok', mimeType: 'application/pdf', body: { attachmentId: 'a', size: 'grand' } }],
    });
    expect(m!.piecesJointes).toEqual([expect.objectContaining({ id: 'ok', nom: 'y.pdf', taille: 0 })]);
    expect(await gmail.lireMessage(contexte(() => json({ id: 'm1', internalDate: '1763546400000', payload: { parts: { length: 1e9 } } })), 'm1')).toMatchObject({ piecesJointes: [] });
  });

  it('corps de texte démesuré : tronqué à 256 Ko', async () => {
    const m = await lire({ mimeType: 'text/plain', filename: '', headers: [], body: { data: texte('A'.repeat(2_000_000)) } });
    expect(m!.corpsTexte).toHaveLength(256 * 1024);
  });
});

describe('Microsoft : liste de pièces jointes sans fin', () => {
  it('pagination qui ne s’arrête jamais : au plus 200 pièces retenues, puis arrêt', async () => {
    const urls = { connexion: 'https://sim.test/login', api: 'https://sim.test/graph' };
    const microsoft = creerFournisseurMicrosoft({ client: CLIENT, urls });
    let pages = 0;
    const ctx = contexte((url) => {
      if (url.includes('/attachments')) {
        pages++;
        return json({ value: Array.from({ length: 50 }, (_, i) => ({ id: `p${pages}-${i}`, name: `../piece-${i}.pdf`, contentType: 'application/pdf', size: 10, isInline: false })), '@odata.nextLink': `${urls.api}/me/messages/m1/attachments?$skip=${pages}` });
      }
      return json({ id: 'm1', subject: 's', receivedDateTime: '2026-11-19T10:00:00Z', hasAttachments: true, body: { contentType: 'text', content: 'x' } });
    });
    const m = await microsoft.lireMessage(ctx, 'm1');
    expect(m!.piecesJointes).toHaveLength(LIMITES_MESSAGE.pieces);
    expect(pages).toBe(4);
    expect(m!.piecesJointes.every((p) => /^piece-\d+\.pdf$/.test(p.nom))).toBe(true);
  });
});

describe('réponses JSON du fournisseur : taille bornée', () => {
  it('réponse plus grosse que la borne (annoncée ou non) : abandonnée sans être analysée, erreur de protocole sans détail technique', async () => {
    const grosse = JSON.stringify({ data: 'x'.repeat(200_000) });
    await expect(lireJson(new Response(grosse), 100_000)).rejects.toThrow(ErreurProtocole);
    await expect(lireJson(new Response(grosse), 100_000)).rejects.toThrow(/^Réponse du fournisseur trop volumineuse \(statut 200\)\.$/);
    // Sans longueur annoncée (flux) : la lecture s'arrête dès la borne franchie, le reste n'est jamais lu.
    let blocsLus = 0;
    const flux = new ReadableStream<Uint8Array>({
      pull(controleur) {
        blocsLus++;
        controleur.enqueue(new Uint8Array(65_536).fill(0x20));
      },
    });
    await expect(lireJson(new Response(flux), 1_000_000)).rejects.toThrow(/trop volumineuse/);
    expect(blocsLus).toBeLessThan(40);
    expect(REPONSE_JSON_MAX_OCTETS).toBe(64 * 1024 * 1024);
  });

  it('JSON invalide, tableau, imbrication extrême : erreur de protocole, jamais le message de l’analyseur', async () => {
    for (const corps of ['{"a":', '[1,2]', 'null', `${'['.repeat(200_000)}`, `${'{"a":'.repeat(200_000)}1${'}'.repeat(200_000)}`.slice(0, -1)]) {
      const e = await lireJson(new Response(corps)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErreurProtocole);
      expect((e as Error).message).toBe('Réponse non JSON du fournisseur (statut 200).');
    }
    expect(await lireJson(new Response('{"ok":true}'))).toEqual({ ok: true });
    expect(await lireJson(new Response(null, { status: 204 })).catch((x: unknown) => (x as Error).message)).toBe('Réponse non JSON du fournisseur (statut 204).');
  });
});
