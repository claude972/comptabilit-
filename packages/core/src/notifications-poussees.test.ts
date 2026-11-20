import { describe, expect, it } from 'vitest';
import { PHRASES_POUSSEES, SERVICES_NOTIFICATION, TYPES_POUSSES, chargeUtilePoussee, reduireAgentUtilisateur, serialiserChargeUtilePoussee, verifierPointAcces } from './notifications-poussees.js';

/** Générateur pseudo-aléatoire à graine (mulberry32) : tirages reproductibles. */
function alea(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ID = '3f2b8c1e-7a4d-4e9b-8c2a-1d5e6f7a8b9c';
const FORME = new RegExp(`^\\{"v":1,"t":"(${TYPES_POUSSES.join('|')})","i":"${ID}"\\}$`);

describe('charge utile d’une notification poussée', () => {
  it('ne contient que la version, un type générique de la liste fermée et l’identifiant opaque', () => {
    expect(chargeUtilePoussee({ type: 'document.complement_demande' }, ID)).toEqual({ v: 1, t: 'complement', i: ID });
    expect(chargeUtilePoussee({ type: 'document.reponse' }, ID)).toEqual({ v: 1, t: 'reponse', i: ID });
    expect(chargeUtilePoussee({ type: 'mixte' }, ID)).toEqual({ v: 1, t: 'plusieurs', i: ID });
    for (const type of ['regle.a_decider', 'import.echec', 'constat.affecte', 'restitution.prete', 'inconnu', '', '__proto__', 'constructor', 'toString']) {
      expect(chargeUtilePoussee({ type }, ID), type).toEqual({ v: 1, t: 'notification', i: ID });
    }
    expect(chargeUtilePoussee(null, ID).t).toBe('notification');
    expect(serialiserChargeUtilePoussee(chargeUtilePoussee({ type: 'document.reponse' }, ID))).toBe(`{"v":1,"t":"reponse","i":"${ID}"}`);
  });

  it('refuse un identifiant qui n’est pas un UUID (un texte libre ne peut pas s’y glisser)', () => {
    for (const i of ['', 'Dossier Dupain', `${ID} 1 234,56 €`, ID.toUpperCase(), '../notifications', 'https://exemple.test/']) expect(() => chargeUtilePoussee({ type: 'x.y' }, i), i).toThrow(/UUID/);
  });

  it('propriété sur 3 000 tirages : aucune donnée de la notification interne ne se retrouve dans la charge utile', () => {
    const tirer = alea(20261119);
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 éèàç€.,-_/@:"\\{}';
    const texte = (min = 4, max = 40) => Array.from({ length: min + Math.floor(tirer() * (max - min)) }, () => alphabet[Math.floor(tirer() * alphabet.length)]).join('');
    const montant = () => `${Math.floor(tirer() * 1_000_000)},${String(Math.floor(tirer() * 100)).padStart(2, '0')} €`;
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(tirer() * 16).toString(16));
    const types = ['document.complement_demande', 'document.reponse', 'mixte', 'regle.a_decider', 'import.termine', 'constat.affecte'];
    for (let n = 0; n < 3000; n++) {
      // Notification interne « riche » : tout ce qu'elle pourrait porter, y compris ce qu'elle ne devrait pas.
      const secrets = { raisonSociale: `Dossier ${texte()}`, nomFichier: `${texte(4, 20)}.pdf`, montant: montant(), libelle: texte(), adresse: `${texte(4, 10)}@${texte(4, 10)}.test`, extrait: texte(20, 80), entiteId: uuid(), cibleId: uuid(), notificationId: uuid(), destinataireId: uuid() };
      const type = tirer() < 0.7 ? types[Math.floor(tirer() * types.length)]! : texte();
      const interne = { ...secrets, id: secrets.notificationId, type, cibleType: 'document', titre: texte(), message: `${secrets.libelle} ${secrets.montant}`, lien: `/depots/${secrets.cibleId}`, donnees: { ...secrets, controleId: 'TIE-001' } };
      const sortie = serialiserChargeUtilePoussee(chargeUtilePoussee(interne, ID));
      // 1) Forme exacte : ensemble fini, à l'identifiant près.
      expect(sortie).toMatch(FORME);
      expect(sortie).toBe(JSON.stringify(chargeUtilePoussee(interne, ID)));
      // 2) Aucune valeur de la notification interne n'y figure (le type lui-même n'est jamais recopié).
      for (const valeur of [...Object.values(secrets), interne.titre, interne.message, interne.lien]) expect(sortie.includes(valeur), valeur).toBe(false);
      if (type.length >= 4 && !TYPES_POUSSES.some((t) => t.includes(type))) expect(sortie.includes(type), type).toBe(false);
      // 3) Non-interférence : en changeant TOUT sauf le type, la charge utile est identique.
      const autre = { ...interne, raisonSociale: texte(), nomFichier: texte(), montant: montant(), donnees: { x: texte() }, entiteId: uuid(), cibleId: uuid(), message: texte(), id: uuid() };
      expect(serialiserChargeUtilePoussee(chargeUtilePoussee(autre, ID))).toBe(sortie);
    }
  });

  it('les phrases affichées sont fixes : une par type, sans gabarit ni donnée variable', () => {
    expect(Object.keys(PHRASES_POUSSEES).sort()).toEqual([...TYPES_POUSSES].sort());
    for (const p of Object.values(PHRASES_POUSSEES)) {
      expect(p).not.toMatch(/[{}$%\d€]/);
      expect(p.length).toBeLessThan(80);
    }
  });
});

describe('point d’accès fourni par le navigateur : liste blanche des services de notification', () => {
  it('accepte les quatre services connus, en https et sur le port par défaut', () => {
    expect(verifierPointAcces('https://fcm.googleapis.com/fcm/send/abc:def')).toMatchObject({ ok: true, service: 'fcm', origine: 'https://fcm.googleapis.com' });
    expect(verifierPointAcces('https://fcm.googleapis.com:443/wp/abc')).toMatchObject({ ok: true, service: 'fcm' });
    expect(verifierPointAcces('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toMatchObject({ ok: true, service: 'mozilla' });
    expect(verifierPointAcces('https://web.push.apple.com/QGk3')).toMatchObject({ ok: true, service: 'apple', origine: 'https://web.push.apple.com' });
    expect(verifierPointAcces('https://db5p.notify.windows.com/w/?token=AwYAAAB')).toMatchObject({ ok: true, service: 'wns' });
    expect(SERVICES_NOTIFICATION.every((s) => s.source.startsWith('https://'))).toBe(true);
  });

  it('refuse tout autre hôte, y compris les imitations par suffixe, préfixe, point final ou identifiants', () => {
    const refus: Array<[string, string]> = [
      ['https://exemple.test/push/abc', 'hote_inconnu'],
      ['https://fcm.googleapis.com.exemple.test/fcm/send/abc', 'hote_inconnu'],
      ['https://fauxfcm.googleapis.com/fcm/send/abc', 'hote_inconnu'],
      ['https://autre.fcm.googleapis.com/fcm/send/abc', 'hote_inconnu'],
      ['https://push.apple.com/abc', 'hote_inconnu'], // le suffixe exige un sous-domaine
      ['https://fauxpush.apple.com/abc', 'hote_inconnu'],
      ['https://notify.windows.com.exemple.test/abc', 'hote_inconnu'],
      ['https://fcm.googleapis.com./fcm/send/abc', 'hote_inconnu'],
      ['https://android.googleapis.com/gcm/send/abc', 'hote_inconnu'],
      ['https://fcm.googleapis.com@10.0.0.1/abc', 'identifiants'],
      ['https://utilisateur:secret@fcm.googleapis.com/abc', 'identifiants'],
      ['https://fcm.googleapis.com:8443/fcm/send/abc', 'port'],
      ['http://fcm.googleapis.com/fcm/send/abc', 'schema'],
      ['ftp://fcm.googleapis.com/abc', 'schema'],
      ['file:///etc/passwd', 'schema'],
      ['https://fcm.googleapis.com', 'chemin'],
      ['https://fcm.googleapis.com/', 'chemin'],
    ];
    for (const [adresse, motif] of refus) expect(verifierPointAcces(adresse), adresse).toEqual({ ok: false, motif });
  });

  it('refuse toute adresse interne ou privée, sous toutes les écritures d’une adresse IP', () => {
    const internes = [
      'https://127.0.0.1/abc', 'https://localhost/abc', 'https://10.0.0.5/abc', 'https://172.16.3.4/abc', 'https://192.168.1.1/abc', 'https://169.254.169.254/latest/meta-data/',
      'https://0.0.0.0/abc', 'https://2130706433/abc', 'https://0x7f.1/abc', 'https://0177.0.0.1/abc', 'https://127.1/abc', 'https://①②⑦.0.0.1/abc',
      'https://[::1]/abc', 'https://[::ffff:10.0.0.1]/abc', 'https://[fd00::1]/abc', 'https://[fe80::1]/abc', 'https://8.8.8.8/abc',
      'https://postgres/abc', 'https://redis:6379/abc', 'https://keycloak.interne/abc', 'https://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1:4000/v1/sante', 'http://localhost:9000/comtaple',
    ];
    for (const adresse of internes) {
      const r = verifierPointAcces(adresse);
      expect(r.ok, adresse).toBe(false);
    }
    expect(verifierPointAcces('https://127.0.0.1/abc')).toEqual({ ok: false, motif: 'adresse_ip' });
    expect(verifierPointAcces('https://[::1]/abc')).toEqual({ ok: false, motif: 'adresse_ip' });
  });

  it('refuse ce qui n’est pas une adresse lisible', () => {
    for (const adresse of [undefined, null, 42, {}, '', 'pas une adresse', 'https://fcm.googleapis.com/a b', 'https://fcm.googleapis.com/a\nb', 'https://fcm.googleapis.com\\@10.0.0.1/abc', '//fcm.googleapis.com/abc']) {
      expect(verifierPointAcces(adresse), String(adresse)).toEqual({ ok: false, motif: 'illisible' });
    }
    expect(verifierPointAcces(`https://fcm.googleapis.com/${'a'.repeat(2100)}`)).toEqual({ ok: false, motif: 'trop_long' });
  });

  it('simulateur de test : seule son origine exacte est acceptée, et plus aucun service réel', () => {
    const sim = 'http://127.0.0.1:45678';
    expect(verifierPointAcces(`${sim}/push/abc`, sim)).toMatchObject({ ok: true, service: 'simulateur', origine: sim });
    expect(verifierPointAcces('http://127.0.0.1:45679/push/abc', sim)).toEqual({ ok: false, motif: 'hote_inconnu' });
    expect(verifierPointAcces('http://localhost:45678/push/abc', sim)).toEqual({ ok: false, motif: 'hote_inconnu' });
    expect(verifierPointAcces('https://fcm.googleapis.com/fcm/send/abc', sim)).toEqual({ ok: false, motif: 'hote_inconnu' });
    // Sans simulateur déclaré, une adresse locale n'est jamais acceptée.
    expect(verifierPointAcces(`${sim}/push/abc`).ok).toBe(false);
    expect(verifierPointAcces(`${sim}/push/abc`, '').ok).toBe(false);
  });
});

describe('agent utilisateur réduit', () => {
  it('ne garde que le navigateur et le système', () => {
    expect(reduireAgentUtilisateur('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Mobile Safari/537.36')).toBe('Chrome sur Android');
    expect(reduireAgentUtilisateur('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari sur iPhone');
    expect(reduireAgentUtilisateur('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0')).toBe('Firefox sur Windows');
    expect(reduireAgentUtilisateur('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge sur Windows');
    expect(reduireAgentUtilisateur('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari sur Mac');
    for (const v of [undefined, '', 'curl/8.0', 42]) expect(reduireAgentUtilisateur(v)).toBe('Appareil non reconnu');
    expect(reduireAgentUtilisateur(`<script>alert(1)</script> ${'x'.repeat(5000)}`)).toBe('Appareil non reconnu');
  });
});
