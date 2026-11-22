#!/usr/bin/env node
/**
 * LIVRABLE UTILISABLE (D-163) : dossier de démonstration → import XLSX par l'interface → immobilisations → bilan et liasse → export PDF et CSV, en une commande, sur la pile locale
 * démarrée. Réutilise `scripts/demo-parcours-immobilisations.mjs` (FEC et classeur fictifs, comparaison écran / CSV / PDF ↔ API) puis range les fichiers dans `var/livrables/demo/`
 * avec un lien local exact. Données synthétiques ; statut « projet », aucune validation professionnelle, aucune transmission.
 *   node scripts/livrable-demo.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const r = spawnSync(process.execPath, [join(racine, 'scripts/demo-parcours-immobilisations.mjs')], { env: { ...process.env, DOTATION_NOUVEAU: '1300.93', VUE_ESSENTIEL: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
const lignes = r.stdout.split('\n');
const verdicts = lignes.filter((l) => /^(OK|ÉCHEC) /.test(l));
const echecs = verdicts.filter((l) => l.startsWith('ÉCHEC'));
const ids = JSON.parse([...lignes].reverse().find((l) => l.startsWith('{"dossier"')) ?? 'null');
if (r.status !== 0 || echecs.length > 0 || !ids) {
  console.error(r.stdout.slice(-3000), r.stderr.slice(-1500));
  process.exit(1);
}
const sortie = join(racine, 'var/livrables/demo');
mkdirSync(sortie, { recursive: true });
const captures = join(racine, 'var/captures');
for (const [src, dst] of [['parcours-immo-etat-joint.pdf', 'etat-joint-bilan-liasse-immobilisations.pdf'], ['parcours-immo-etat-joint.csv', 'etat-joint-bilan-liasse-immobilisations.csv'], ['parcours-immo-etat-joint.png', 'ecran-etat-joint.png'], ['parcours-immo-import-xlsx.png', 'ecran-import-xlsx.png']]) copyFileSync(join(captures, src), join(sortie, dst));
const lien = `http://localhost:3100/dossiers/${ids.dossier}/fiscal?vue=liasse`;
const lienEtat = `http://localhost:3100/dossiers/${ids.dossier}/fiscal/etat-joint?exercice=${ids.exercice}&regime=reel_normal&vue=essentiel`;
writeFileSync(join(sortie, 'LISEZ-MOI.txt'), `Dossier de démonstration FICTIF (Atelier Démo Immobilisations SAS), exercice 2025 — statut PROJET.\nAucune validation professionnelle, aucune transmission, aucune connexion externe.\n\nLiasse (écran) : ${lien}\nÉtat joint imprimable : ${lienEtat}\nConnexion : alice.admin@cabinet-a.test (mot de passe de démonstration du fichier .env, DEV_MDP_UTILISATEURS)\n\nVentilations 2050, cases BN à BS retenues, 2057 et lignes sans case : voir LISEZ-MOI-ventilations-2050.txt (PDF et CSV bilan-et-ventilation-stocks.*).\n\nFichiers :\n- etat-joint-bilan-liasse-immobilisations.pdf : bilan et comptes de résultat (2050 à 2053), immobilisations et amortissements (2054, 2055)  ; l’état joint complet (tous les tableaux préparés) : même adresse sans « &vue=essentiel »\n- etat-joint-bilan-liasse-immobilisations.csv : mêmes tableaux, ouvrable dans un tableur\n- ecran-etat-joint.png, ecran-import-xlsx.png : écrans\n\nVérifications faites par le script : ${verdicts.length} contrôles, tous OK (import XLSX par l'interface sans écriture à l'aperçu, valeurs de l'écran, du CSV et du PDF égales à celles de l'API).\n`);
const v2 = spawnSync(process.execPath, [join(racine, 'scripts/livrable-ventilation-2050.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (v2.status !== 0) {
  console.error(v2.stdout.slice(-3000), v2.stderr.slice(-1500));
  process.exit(1);
}
const v3 = spawnSync(process.execPath, [join(racine, 'scripts/livrable-releve-charges.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (v3.status !== 0) {
  console.error(v3.stdout.slice(-3000), v3.stderr.slice(-1500));
  process.exit(1);
}
console.log(verdicts.join('\n'));
console.log(v3.stdout.split('\n').filter((l) => /^(OK|ÉCHEC) /.test(l) || l.startsWith('LIVRABLE') || l.startsWith('  ')).join('\n'));
console.log(v2.stdout.split('\n').filter((l) => /^(OK|ÉCHEC) /.test(l) || l.startsWith('LIVRABLE') || l.startsWith('  ')).join('\n'));
console.log(`\nLIVRABLE PRÊT\n  dossier  : ${lien}\n  état joint : ${lienEtat}\n  PDF      : ${join(sortie, 'etat-joint-bilan-liasse-immobilisations.pdf')}\n  CSV      : ${join(sortie, 'etat-joint-bilan-liasse-immobilisations.csv')}`);
