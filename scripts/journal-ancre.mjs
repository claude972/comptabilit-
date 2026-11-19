#!/usr/bin/env node
/**
 * Journal d'audit : export, ancres et vérification HORS BASE (outil de l'éditeur ; lecture seule sur la base).
 *
 *   node scripts/journal-ancre.mjs exporter <cabinetId> <fichier.jsonl>
 *       Écrit le journal du cabinet, une ligne JSON par ligne du journal, avec les octets exacts de chaque empreinte.
 *   node scripts/journal-ancre.mjs ancrer <cabinetId> [dossier=var/ancres]
 *       Établit l'ancre suivante (dernière ligne, son empreinte, nombre de lignes), chaînée à la précédente du dossier.
 *   node scripts/journal-ancre.mjs verifier <fichier.jsonl> <dossier d'ancres du cabinet>
 *       Vérifie l'export contre les ancres, SANS base ni réseau ni fichier .env. Code de sortie 0 si conforme, 1 sinon.
 *
 * CE N'EST PAS UN ANCRAGE EXTERNE. Aucune destination indépendante n'est configurée : les ancres sont écrites dans un
 * dossier local, à la portée de qui administre ce poste. Elles ne prouvent quelque chose que si leur empreinte (ou le
 * fichier) est déposée ailleurs, chez un tiers que l'administrateur de la base ne contrôle pas. Ce dépôt reste à faire.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const a = await import('../packages/db/dist/ancre-journal.js');
const [commande, ...args] = process.argv.slice(2);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomAncre = (rang) => `ancre-${String(rang).padStart(6, '0')}.json`;
const lireAncres = (dossier) => (existsSync(dossier) ? readdirSync(dossier).filter((f) => /^ancre-\d{6}\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(dossier, f), 'utf8'))) : []);

async function base() {
  const { default: pg } = await import('../packages/db/node_modules/pg/lib/index.js');
  const { urlBd } = await import('../packages/db/dist/index.js');
  const { chargerEnvLocal } = await import('../packages/db/dist/env.js');
  chargerEnvLocal();
  const client = new pg.Client({ connectionString: urlBd('admin') });
  await client.connect();
  await client.query('set default_transaction_read_only = on'); // cet outil ne modifie jamais la base
  return client;
}

try {
  if (commande === 'exporter' && UUID.test(args[0] ?? '') && args[1]) {
    const client = await base();
    const sortie = createWriteStream(args[1]);
    let n = 0;
    for await (const ligne of a.exporterJournal(client, args[0])) {
      if (!sortie.write(`${JSON.stringify(ligne)}\n`)) await once(sortie, 'drain');
      n++;
    }
    sortie.end();
    await once(sortie, 'finish');
    await client.end();
    console.log(`${n} ligne(s) exportée(s) dans ${args[1]} (format ${a.FORMAT_EXPORT}).`);
  } else if (commande === 'ancrer' && UUID.test(args[0] ?? '')) {
    const dossier = join(args[1] ?? 'var/ancres', args[0]);
    const client = await base();
    const precedentes = lireAncres(dossier);
    const ancre = a.etablirAncre(await a.lireEtatJournal(client, args[0]), precedentes.at(-1) ?? null);
    await client.end();
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, nomAncre(ancre.rang)), `${a.serialiserAncre(ancre)}\n`, { flag: 'wx' });
    console.log(`Ancre n° ${ancre.rang} : ${ancre.nombreLignes} ligne(s), dernière ligne ${ancre.derniereLigne ?? '—'}.`);
    console.log(`Vérification stricte de la base à cet instant : ${ancre.verificationStricte === null ? 'intègre' : `rupture à la ligne ${ancre.verificationStricte}`}.`);
    console.log(`Empreinte de l'ancre (à déposer chez un tiers indépendant) : ${a.empreinteAncre(ancre)}`);
    console.log(`ATTENTION : ancre écrite dans ${dossier}, un dossier LOCAL. Ce n'est pas un ancrage externe : aucune destination indépendante n'est configurée.`);
  } else if (commande === 'verifier' && args[0] && args[1]) {
    const ancres = lireAncres(args[1]);
    const lignes = (async function* () {
      for await (const texte of createInterface({ input: createReadStream(args[0]), crlfDelay: Infinity })) if (texte.trim()) yield JSON.parse(texte);
    })();
    const r = await a.verifierExport(lignes, ancres);
    console.log(`Lignes lues : ${r.lignes} ; ancres : ${ancres.length}`);
    console.log(`Chaîne (équivalent hors base de la vérification stricte) : ${r.rupture ? `RUPTURE à la ligne ${r.rupture.ligne} — ${r.rupture.motif}` : 'intègre'}`);
    for (const x of r.ancres) console.log(`Ancre n° ${x.rang} : ${x.conforme ? 'conforme' : `NON CONFORME — ${x.motif}`}`);
    if (ancres.length === 0) console.log('Aucune ancre fournie : seule la cohérence interne de la chaîne est vérifiée ; une réécriture complète de la fin du journal ne serait pas détectée.');
    else console.log('Rappel : ces ancres ne valent preuve que si elles proviennent d’une destination indépendante de la base. Les lignes postérieures à la dernière ancre ne sont couvertes que par la chaîne.');
    console.log(r.conforme ? 'CONFORME' : 'NON CONFORME');
    process.exit(r.conforme ? 0 : 1);
  } else {
    console.error('Usage : journal-ancre.mjs exporter <cabinetId> <fichier.jsonl> | ancrer <cabinetId> [dossier] | verifier <fichier.jsonl> <dossier d’ancres>');
    process.exit(2);
  }
} catch (e) {
  console.error(`ÉCHEC : ${e.message}`);
  process.exit(1);
}
