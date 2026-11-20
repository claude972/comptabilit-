#!/usr/bin/env node
/**
 * Rotation des jeux de sauvegarde LOCAUX selon une rétention PARAMÉTRABLE (D-099). SIMULATION uniquement dans cet outil.
 *
 *   node scripts/sauvegardes-rotation.mjs [--repertoire=<dossier>] [--retention=<jours>] [--minimum=<jeux>] [--durees=<fichier.json>]
 *       Liste, en lecture seule, ce qui serait CONSERVÉ, RETIRÉ ou laissé À EXAMINER. Par défaut : var/sauvegardes, rétention et
 *       minimum du jeu de durées (PROPOSITION NON VALIDÉE à défaut de « --durees »). Ne supprime RIEN. Indique aussi le nombre d'objets
 *       orphelins du dépôt `objets/` (D-100).
 *
 * L'exécution (`appliquerRotation`, packages/plateforme/src/rotation-sauvegardes.ts) n'est pas branchée ici : elle n'existe que
 * pour un répertoire d'ESSAI créé par un test (marqueur posé par le test, répertoire distinct du répertoire réel). Aucune
 * sauvegarde existante (les neuf anciennes, le jeu interrompu, les jeux complets) ne peut être retirée par cet outil.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chargerParametres } = await import('../packages/db/dist/durees-conservation.js');
const { POLITIQUE_FIN_DE_CONTRAT } = await import('../packages/db/dist/provisionnement.js');
const { planifierRotation, planifierNettoyageObjets } = await import('../packages/plateforme/dist/rotation-sauvegardes.js');

const args = process.argv.slice(2);
const option = (nom) => args.find((x) => x.startsWith(`--${nom}=`))?.slice(nom.length + 3);
try {
  if (args.includes('--appliquer')) throw new Error('Refusé : cet outil ne retire aucune sauvegarde. L’exécution n’existe que pour un répertoire d’essai créé par un test (D-099).');
  const inconnus = args.filter((x) => !['repertoire', 'retention', 'minimum', 'durees'].some((n) => x.startsWith(`--${n}=`)));
  if (inconnus.length) throw new Error(`Option inconnue : ${inconnus.join(' ')}`);
  const c = chargerParametres(POLITIQUE_FIN_DE_CONTRAT.categories, option('durees'));
  const retentionJours = option('retention') === undefined ? c.parametres.sauvegardes.retentionJours : Number(option('retention'));
  const jeuxMinimumConserves = option('minimum') === undefined ? c.parametres.sauvegardes.jeuxMinimumConserves : Number(option('minimum'));
  const repertoire = option('repertoire') ?? join(racine, 'var', 'sauvegardes');
  const plan = planifierRotation(repertoire, { retentionJours, jeuxMinimumConserves });
  console.log(`Répertoire : ${repertoire}`);
  console.log(`Rétention ${retentionJours} jour(s), ${jeuxMinimumConserves} jeu(x) minimum conservé(s) — durées : jeu ${c.parametres.version}, « ${c.parametres.statut} »${c.nonValide && option('retention') === undefined ? ' (PROPOSITION NON VALIDÉE)' : ''}.`);
  console.table(plan.groupes.map((g) => ({ identifiant: g.id, type: g.type, 'âge (jours)': g.ageJours, fichiers: g.fichiers.length, 'octets': g.octets, décision: g.decision.toUpperCase(), motif: g.motif })));
  const mo = (o) => `${(o / 2 ** 20).toFixed(1)} Mio`;
  console.log(`À retirer si la rotation s'exécutait : ${plan.aRetirer.groupes} groupe(s), ${plan.aRetirer.fichiers} fichier(s), ${mo(plan.aRetirer.octets)}.`);
  if (plan.nonReconnus.length) console.log(`Fichiers non reconnus (jamais touchés) : ${plan.nonReconnus.join(', ')}`);
  // Nettoyage du dépôt d'objets adressés (D-100) : ce que la rotation ci-dessus laisserait sans référence. Lecture seule.
  const net = planifierNettoyageObjets(repertoire);
  if (net.bloque) console.log(`Dépôt d'objets (objets/) : nettoyage BLOQUÉ — ${net.bloque}.`);
  else console.log(`Dépôt d'objets (objets/) : ${net.blobs} objet(s), ${net.references} référencé(s) par ${net.manifestes} manifeste(s) ; ${net.orphelins.fichiers.length} orphelin(s) (${mo(net.orphelins.octets)}) dès AUJOURD'HUI, hors rotation. Après la rotation ci-dessus, d'autres deviendraient orphelins (les jeux retirés ne les référencent plus).`);
  console.log('SIMULATION : rien n’a été supprimé, ni jeu, ni objet.');
} catch (e) {
  console.error(`Échec : ${e.message}`);
  process.exitCode = 1;
}
