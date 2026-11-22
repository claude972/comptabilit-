/**
 * ENFANT HOSTILE — essais uniquement (jamais chargé en service, absent de `dist`).
 * Lancé par les tests à la place de l'enfant réel, avec EXACTEMENT les mêmes options (permissions, environnement vide,
 * bornes) et le même verrou réseau. Il se comporte mal sur commande : le mode vient de l'en-tête (`mode`) ou, quand il
 * est lancé par la chaîne d'analyse réelle, d'une marque `%%HOSTILE:<mode>` dans le fichier.
 */
import '../dist/analyse-verrou.js';
import child_process from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { Worker } from 'node:worker_threads';

const morceaux = [];
let modeCredit = null;
for await (const m of process.stdin) {
  morceaux.push(m);
  if (modeCredit === null && morceaux.length === 1 && m.length >= 4) {
    // Modes de CRÉDIT (D-171) : annoncés dès le premier bloc, AVANT d'avoir tout lu, pour éprouver le parent.
    try {
      const l = m.readUInt32BE(0);
      const mode = JSON.parse(m.subarray(4, 4 + l).toString('utf8')).mode;
      modeCredit = mode === 'credit-malforme' || mode === 'credit-excessif' ? mode : '';
    } catch {
      modeCredit = '';
    }
    if (modeCredit === 'credit-malforme') for (const x of ['x', '-1', '99999999999999999999', '', '1e9', '12 ']) process.stderr.write(`\u0001CREDIT ${x}\n`);
  }
  // Crédit excessif : à CHAQUE bloc reçu, 4 milliards d'octets annoncés consommés (le parent doit les plafonner à ce qu'il a écrit).
  if (modeCredit === 'credit-excessif') process.stderr.write('\u0001CREDIT 4000000000\n');
}
const entree = Buffer.concat(morceaux);
const longueur = entree.readUInt32BE(0);
const entete = JSON.parse(entree.subarray(4, 4 + longueur).toString('utf8'));
const corps = entree.subarray(4 + longueur);
const marque = /%%HOSTILE:([a-z-]+)/.exec(corps.subarray(0, 200).toString('latin1'));
const mode = entete.mode ?? marque?.[1] ?? 'sain';
const rendre = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v), () => process.exit(0));
if (mode === 'credit-malforme' || mode === 'credit-excessif') {
  rendre({ ok: true });
  await new Promise(() => undefined); // rien d'autre n'est exécuté ni écrit
}
const pieceVide = { pages: [], nbPages: null, champs: null, methode: 'aucune', moteur: null, lectureImpossible: false };

function trame(objet) {
  const c = Buffer.from(JSON.stringify(objet), 'utf8');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(c.length);
  return new Promise((ok) => process.stdout.write(Buffer.concat([l, c]), () => ok()));
}
const ligneFec = (numeroLigne) => ({
  numeroLigne, journalCode: 'HOS', journalLib: 'Hostile', ecritureNum: `H${numeroLigne}`, ecritureDate: '2025-06-30', compteNum: '471000', compteLib: 'Attente', compAuxNum: null, compAuxLib: null,
  pieceRef: 'X', pieceDate: '2025-06-30', ecritureLib: 'ligne fabriquée par l’enfant hostile', debit: '1.00', credit: '0.00', ecritureLet: null, dateLet: null, validDate: null, montantDevise: null, idevise: null,
});
const rapportFec = (n) => ({
  encodage: 'utf-8', separateur: 'tabulation', variante: 'debit_credit', entetes: [], nbLignesLues: n, nbLignesNormalisees: n, anomalies: [], nbAnomaliesParCode: {}, lisible: true, conforme: true,
  suffisantPourTravaux: true, totalDebit: '0.00', totalCredit: '0.00', dateMin: null, dateMax: null,
});

async function tenter(rapport, nom, f) {
  try {
    await f();
    rapport[nom] = 'REUSSI';
  } catch (e) {
    rapport[nom] = `refuse:${e?.code ?? String(e?.message ?? e).slice(0, 60)}`;
  }
}

switch (mode) {
  case 'boucle':
    for (;;) {
      /* ne rend jamais la main */
    }
  case 'tas': {
    const t = [];
    for (;;) t.push(new Array(100_000).fill(`x${t.length}`));
  }
  case 'hors-tas': {
    // Tampons hors du tas JavaScript : invisibles pour --max-old-space-size, visibles dans la mémoire résidente.
    const t = [];
    setInterval(() => {
      if (t.length < 100) t.push(Buffer.alloc(16 * 1024 * 1024, 1));
    }, 10);
    break;
  }
  case 'sortie-enorme': {
    const bloc = 'x'.repeat(1024 * 1024);
    const ecrire = () => {
      while (process.stdout.write(bloc));
      process.stdout.once('drain', ecrire);
    };
    ecrire();
    break;
  }
  case 'sortie-invalide':
    rendre('ceci n’est pas du JSON {');
    break;
  case 'sortie-hors-schema':
    rendre({ ...pieceVide, pages: 'pas un tableau', methode: 'magie' });
    break;
  case 'trop-de-pages':
    rendre({ ...pieceVide, pages: Array.from({ length: 61 }, (_, i) => ({ page: i + 1, texte: 'x' })) });
    break;
  case 'cles-en-trop':
    rendre({ ...pieceVide, statut: 'traite', droits: 'tous', champs: null, moteur: 'essai' });
    break;
  case 'plantage':
    process.exit(3);
    break;
  case 'exception':
    throw new Error('message technique de bibliothèque : Unexpected token at offset 42');
  case 'evasion': {
    const r = { environnement: Object.keys(process.env), arguments: process.argv.slice(2) };
    const tcp = (creer) => new Promise((ok, ko) => creer().once('connect', ok).once('error', ko));
    await tenter(r, 'tcp', () => tcp(() => net.connect(entete.port, '127.0.0.1')));
    await tenter(r, 'tcpSocket', () => tcp(() => new net.Socket().connect(entete.port, '127.0.0.1')));
    await tenter(r, 'tls', () => tcp(() => tls.connect(entete.port, '127.0.0.1')));
    await tenter(r, 'fetch', () => fetch(`http://127.0.0.1:${entete.port}/`));
    await tenter(r, 'ecoute', () => new Promise((ok, ko) => net.createServer().once('error', ko).listen(0, '127.0.0.1', ok)));
    await tenter(r, 'udp', () => new Promise((ok, ko) => dgram.createSocket('udp4').send('x', entete.port, '127.0.0.1', (e) => (e ? ko(e) : ok()))));
    await tenter(r, 'dns', () => dns.promises.lookup('localhost'));
    await tenter(r, 'dnsRappel', () => new Promise((ok, ko) => dns.lookup('localhost', (e) => (e ? ko(e) : ok()))));
    await tenter(r, 'dnsResolveur', () => new dns.promises.Resolver().resolve4('example.com'));
    await tenter(r, 'liaisonInterne', () => process.binding('tcp_wrap'));
    for (const [nom, chemin] of Object.entries(entete.lectures ?? {})) await tenter(r, `lecture:${nom}`, () => fs.readFileSync(chemin));
    await tenter(r, 'lectureCodeAutorise', () => fs.readFileSync(new URL('../dist/analyse-verrou.js', import.meta.url)));
    await tenter(r, 'ecriture', () => fs.writeFileSync(entete.ecriture, 'x'));
    await tenter(r, 'processusFils', () => child_process.execFileSync('/bin/echo', ['x']));
    await tenter(r, 'filExecution', () => new Worker('process.exit(0)', { eval: true }));
    await tenter(r, 'eval', () => new Function('return 1')());
    rendre(r);
    break;
  }
  // ── Protocole en trames du FEC (4 octets de longueur puis JSON) ──
  case 'fec-lot-hors-schema':
    await trame({ t: 'lignes', lignes: [{ ...ligneFec(2), ecritureDate: '31/12/2025', debit: 'beaucoup' }] });
    await trame({ t: 'rapport', rapport: rapportFec(1) });
    process.exit(0);
    break;
  case 'fec-trame-enorme': {
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(0x7fffffff);
    process.stdout.write(longueur, () => undefined);
    setInterval(() => process.stdout.write('x'.repeat(65536)), 5);
    break;
  }
  case 'fec-sans-rapport':
    await trame({ t: 'lignes', lignes: [ligneFec(2)] });
    process.exit(0);
    break;
  case 'fec-compte-faux':
    await trame({ t: 'lignes', lignes: [ligneFec(2)] });
    await trame({ t: 'rapport', rapport: rapportFec(250_000) });
    process.exit(0);
    break;
  case 'fec-apres-rapport':
    await trame({ t: 'rapport', rapport: rapportFec(0) });
    await trame({ t: 'lignes', lignes: [ligneFec(2)] });
    process.exit(0);
    break;
  case 'fec-trame-inconnue':
    await trame({ t: 'ordre', sql: 'drop table lignes_ecriture' });
    process.exit(0);
    break;
  case 'fec-lignes-puis-boucle':
    // Des lignes valides, puis plus rien : le parent ne doit rien en garder.
    await trame({ t: 'lignes', lignes: Array.from({ length: 400 }, (_, i) => ligneFec(i + 2)) });
    for (;;) {
      /* ne rend jamais la main */
    }
  default:
    rendre(pieceVide);
}
