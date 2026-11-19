/**
 * Point d'entrée du PROCESSUS ENFANT d'analyse : un processus par fichier, lancé et borné par `analyse-isolee.ts`.
 *
 * Entrée standard : 4 octets (longueur de l'en-tête, gros-boutiste), l'en-tête JSON (`DemandeAnalyse`), puis les octets
 * à lire. Sortie standard : un unique document JSON (le résultat structuré). Aucun argument, aucune variable
 * d'environnement, aucun accès à la base, à Redis ou au stockage : l'enfant ne connaît que les octets qu'on lui passe.
 */
import './analyse-verrou.js'; // en premier : le réseau est neutralisé avant le chargement des lecteurs
import type { PageTexte } from '@comtaple/core';
import { analyserPiece, extraireDuTexte } from './analyse-contenu.js';
import type { DemandeAnalyse } from './analyse-types.js';

async function lireEntree(): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  for await (const m of process.stdin) morceaux.push(m as Buffer);
  return Buffer.concat(morceaux);
}

async function traiter(): Promise<unknown> {
  const entree = await lireEntree();
  if (entree.length < 4) throw new Error('demande vide');
  const longueur = entree.readUInt32BE(0);
  if (longueur > 4096 || entree.length < 4 + longueur) throw new Error('en-tête invalide');
  const demande = JSON.parse(entree.subarray(4, 4 + longueur).toString('utf8')) as DemandeAnalyse;
  const corps = entree.subarray(4 + longueur);
  if (demande.op === 'piece' && (demande.type === 'application/pdf' || demande.type === 'application/xml')) return analyserPiece(demande.type, corps);
  if (demande.op === 'texte') return extraireDuTexte(JSON.parse(corps.toString('utf8')) as PageTexte[]);
  throw new Error('opération inconnue');
}

traiter().then(
  (resultat) => process.stdout.write(JSON.stringify(resultat), () => process.exit(0)),
  (e: unknown) => {
    // Nom de l'erreur seulement : jamais de contenu de pièce ni de message de bibliothèque vers le parent.
    process.stderr.write(`analyse interrompue : ${e instanceof Error ? e.name : 'erreur'}\n`);
    process.exit(1);
  },
);
