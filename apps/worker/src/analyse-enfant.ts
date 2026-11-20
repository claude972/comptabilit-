/**
 * Point d'entrée du PROCESSUS ENFANT d'analyse : un processus par fichier, lancé et borné par `analyse-isolee.ts`.
 *
 * Entrée standard : 4 octets (longueur de l'en-tête, gros-boutiste), l'en-tête JSON (`DemandeAnalyse`), puis les octets
 * à lire. Sortie standard : un unique document JSON (le résultat structuré) ; pour un FEC, lu en flux, une suite de
 * trames (4 octets de longueur puis JSON). Aucun argument, aucune variable d'environnement, aucun accès à la base, à
 * Redis ou au stockage : l'enfant ne connaît que les octets qu'on lui passe.
 */
import './analyse-verrou.js'; // en premier : le réseau est neutralisé avant le chargement des lecteurs
import type { PageTexte } from '@comtaple/core';
import { analyserPiece, extraireDuTexte } from './analyse-contenu.js';
import { type DemandeAnalyse, ENTETE_MAX_OCTETS, type TrameFec } from './analyse-types.js';
import { analyserFecEnFlux } from './fec-contenu.js';
import { lireReleve } from './releve-contenu.js';

/** Lit l'en-tête ; le corps reste un FLUX (un FEC n'est jamais chargé en entier). */
async function ouvrirEntree(): Promise<{ demande: DemandeAnalyse; corps: AsyncGenerator<Buffer> }> {
  const lecteur = (process.stdin as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  let tampon: Buffer = Buffer.alloc(0);
  for (;;) {
    if (tampon.length >= 4) {
      const longueur = tampon.readUInt32BE(0);
      if (longueur > ENTETE_MAX_OCTETS) throw new Error('en-tête invalide');
      if (tampon.length >= 4 + longueur) {
        const demande = JSON.parse(tampon.subarray(4, 4 + longueur).toString('utf8')) as DemandeAnalyse;
        const reste = tampon.subarray(4 + longueur);
        const corps = (async function* (): AsyncGenerator<Buffer> {
          if (reste.length > 0) yield reste;
          for (;;) {
            const suivant = await lecteur.next();
            if (suivant.done) return;
            yield suivant.value;
          }
        })();
        return { demande, corps };
      }
    }
    const suivant = await lecteur.next();
    if (suivant.done) throw new Error(tampon.length < 4 ? 'demande vide' : 'en-tête invalide');
    tampon = Buffer.concat([tampon, suivant.value]);
  }
}

async function toutLire(corps: AsyncIterable<Buffer>): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  for await (const m of corps) morceaux.push(m);
  return Buffer.concat(morceaux);
}

/** Écrit une trame et attend que la sortie standard l'ait acceptée (contre-pression). */
function emettreTrame(trame: TrameFec): Promise<void> {
  const corps = Buffer.from(JSON.stringify(trame), 'utf8');
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(corps.length);
  return new Promise((accepte, refuse) => process.stdout.write(Buffer.concat([longueur, corps]), (e) => (e ? refuse(e) : accepte())));
}

/** Rend le résultat à écrire, ou `undefined` quand l'opération a déjà émis sa sortie en trames. */
async function traiter(): Promise<unknown> {
  const { demande, corps } = await ouvrirEntree();
  if (demande.op === 'fec') {
    await analyserFecEnFlux(corps, { exerciceDebut: String(demande.exerciceDebut), exerciceFin: String(demande.exerciceFin), nomFichier: typeof demande.nomFichier === 'string' ? demande.nomFichier : null }, emettreTrame);
    return undefined;
  }
  const octets = await toutLire(corps);
  if (demande.op === 'piece' && (demande.type === 'application/pdf' || demande.type === 'application/xml')) return analyserPiece(demande.type, octets);
  if (demande.op === 'texte') return extraireDuTexte(JSON.parse(octets.toString('utf8')) as PageTexte[]);
  if (demande.op === 'releve') return lireReleve(octets, { profilCsv: demande.profilCsv ?? null, profilInvalide: demande.profilInvalide === true });
  throw new Error('opération inconnue');
}

traiter().then(
  (resultat) => {
    if (resultat === undefined) process.exit(0); // trames déjà acceptées par la sortie standard
    else process.stdout.write(JSON.stringify(resultat), () => process.exit(0));
  },
  (e: unknown) => {
    // Nom de l'erreur seulement : jamais de contenu de fichier ni de message de bibliothèque vers le parent.
    process.stderr.write(`analyse interrompue : ${e instanceof Error ? e.name : 'erreur'}\n`);
    process.exit(1);
  },
);
