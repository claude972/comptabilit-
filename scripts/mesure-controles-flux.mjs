#!/usr/bin/env node
/**
 * MESURE (environnement local) : contrôles d'un gros exercice par le chemin EN FLUX, en mémoire bornée.
 *
 * Crée un cabinet d'essai NEUF, un dossier d'essai NEUF, un exercice N-1 et un exercice N synthétiques (générateur du
 * moteur, toutes les anomalies connues), un relevé bancaire de janvier, puis exécute `executerControlesExecution` (la
 * fonction du worker, telle que construite dans apps/worker/dist) dans des processus séparés dont le tas est plafonné,
 * et relève durée, pic de tas, pic de mémoire résidente, contrôles réalisés et non réalisés.
 * N'utilise ni l'API ni le worker en service ; n'écrit que des lignes rattachées au cabinet qu'il crée.
 *
 * Usage :
 *   node scripts/mesure-controles-flux.mjs [--ecritures 400000] [--tas 0,384] [--budget 100000] [--seuil 500000] [--comparer-memoire]
 *                                           [--garder] [--seuil-libre 12] [--forcer]
 *   node scripts/mesure-controles-flux.mjs --retirer <cabinetId>      # retire un jeu laissé par une mesure précédente
 *
 *   --ecritures N        nombre d'écritures de l'exercice N (environ 2,65 lignes par écriture ; 400 000 ≈ 1 060 000 lignes)
 *   --tas a,b            plafonds de tas (Mo, --max-old-space-size) des exécutions en flux ; 0 = valeur par défaut de Node ;
 *                        « 384:400000 » = tas de 384 Mo avec un budget d'état de 400 000 lignes pour cette exécution
 *   --budget N           LIGNES_MAX_ETAT_FLUX des exécutions (défaut : celui de la configuration)
 *   --seuil N            LIGNES_MAX_PAR_TRAITEMENT des exécutions en flux (défaut : celui de la configuration ; à abaisser pour un essai sur un petit jeu)
 *   --comparer-memoire   exécute aussi le chemin EN MÉMOIRE (seuil relevé, tas de 6 144 Mo) et compare les résultats
 *   --garder             ne retire pas le jeu à la fin si l'espace libre reste au-dessus du seuil
 *   --seuil-libre P      en dessous de P % d'espace libre sur le volume de PostgreSQL, le jeu est retiré à la fin (défaut 12)
 *   --forcer             prépare le jeu même si l'espace libre paraît insuffisant
 * Le volume de PostgreSQL est lu par `docker exec` dans le conteneur PG_CONTENEUR (défaut comtaple-postgres-1) ; s'il
 * n'est pas lisible, le jeu est toujours retiré à la fin.
 *
 * ESPACE DISQUE : compter environ 1,1 Ko libre par ligne d'écriture au plus fort (jeu, journaux de transactions, tris
 * temporaires) ; le script refuse de créer le jeu s'il ne tient pas. Après le retrait, l'espace de la table redevient
 * utilisable par PostgreSQL mais n'est pas forcément rendu au système (voir le message de fin).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const pg = (await import('../packages/db/node_modules/pg/lib/index.js')).default;
const { creerAccesBd, urlBd } = await import('../packages/db/dist/index.js');

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : defaut;
};
const drapeau = (nom) => args.includes(`--${nom}`);
const NOM_CABINET = 'Mesure contrôles en flux';
const ANOMALIES = ['desequilibre', 'rupture_sequence', 'hors_exercice', 'doublon', 'caisse_crediteur', 'attente_non_solde', 'client_crediteur', 'cca_debiteur', 'amortissement_superieur_brut', 'charge_immobilisable', 'salaires_sans_charges', 'piece_hors_exercice'];
const TABLES = ['rapprochements', 'executions_rapprochement', 'constats', 'resultats_controles', 'executions_controles', 'mouvements_lots', 'mouvements_bancaires', 'releves_bancaires', 'lignes_ecriture', 'lots_import', 'exercices', 'entites'];
const Mo = (octets) => Math.round(octets / 1024 / 1024);

/** Espace du volume de PostgreSQL, en Mo, ou null s'il n'est pas lisible. */
function espace() {
  try {
    const sortie = execFileSync('docker', ['exec', process.env.PG_CONTENEUR ?? 'comtaple-postgres-1', 'sh', '-c', 'df -Pk "$PGDATA" | tail -1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [, total, , libre] = sortie.trim().split(/\s+/).map(Number);
    return { totalMo: Math.round(total / 1024), libreMo: Math.round(libre / 1024), librePourCent: Math.round((libre / total) * 1000) / 10 };
  } catch {
    return null;
  }
}
const direEspace = (e) => (e ? `${e.libreMo} Mo libres sur ${e.totalMo} Mo (${e.librePourCent} %)` : 'non lisible');

async function retirer(admin, cabinetId) {
  const cabinet = (await admin.query('select nom from cabinets where id = $1', [cabinetId])).rows[0];
  if (!cabinet) return console.log(`Cabinet ${cabinetId} introuvable : rien à retirer.`);
  if (!cabinet.nom.startsWith(NOM_CABINET)) throw new Error(`Refus : le cabinet ${cabinetId} (« ${cabinet.nom} ») n'a pas été créé par ce script.`);
  for (const table of TABLES) {
    let retirees = 0;
    if (table === 'lignes_ecriture') {
      // Par tranches, avec un point de contrôle entre deux : une suppression massive d'un seul tenant écrit autant de
      // journaux de transactions que le jeu lui-même (mesuré : le volume libre a baissé de 280 Mo pendant le retrait d'un million de lignes).
      for (;;) {
        const r = await admin.query('delete from lignes_ecriture where ctid in (select ctid from lignes_ecriture where cabinet_id = $1 limit 100000)', [cabinetId]);
        retirees += r.rowCount;
        if (r.rowCount === 0) break;
        await admin.query('checkpoint').catch(() => undefined);
      }
    } else retirees = (await admin.query(`delete from ${table} where cabinet_id = $1`, [cabinetId])).rowCount;
    if (retirees > 0) console.log(`  retiré : ${retirees} ligne(s) de ${table}`);
  }
  await admin.query('delete from cabinets where id = $1', [cabinetId]);
  // VACUUM simple (ni réécriture ni verrou exclusif durable) : l'espace des lignes retirées redevient utilisable par
  // PostgreSQL ; il n'est rendu au système que s'il se trouve en fin de table. Les index, eux, ne rétrécissent pas.
  await admin.query('vacuum lignes_ecriture').catch((e) => console.log(`  vacuum non effectué : ${e.message}`));
  await admin.query('checkpoint').catch(() => undefined);
  const tailles = (await admin.query(`select pg_size_pretty(pg_relation_size('lignes_ecriture')) as table, pg_size_pretty(pg_indexes_size('lignes_ecriture')) as index, (select count(*) from lignes_ecriture) as lignes`)).rows[0];
  console.log(`Jeu de mesure retiré (cabinet ${cabinetId}). Les lignes du journal d'audit de ce cabinet restent (journal en ajout seul).`);
  console.log(`lignes_ecriture : ${tailles.lignes} lignes, table ${tailles.table}, index ${tailles.index}. Si la table ou ses index restent gonflés après une grosse mesure, l'espace est réutilisable par PostgreSQL mais n'est rendu au système que par « reindex index concurrently <index> » (en ligne) ou « vacuum full lignes_ecriture » (verrou exclusif) : décision à prendre à la main, ce script ne le fait pas.`);
}

// ───────────────────────────── Processus enfant : une exécution mesurée ─────────────────────────────
if (drapeau('executer')) {
  const { lireConfig } = await import('../packages/plateforme/dist/index.js');
  const { executerControlesExecution } = await import('../apps/worker/dist/controles.js');
  const { CATALOGUE_CONTROLES } = await import('../packages/core/dist/index.js');
  const cabinetId = option('cabinet');
  const cfg = lireConfig();
  if (option('seuil')) cfg.LIGNES_MAX_PAR_TRAITEMENT = Number(option('seuil'));
  if (option('budget')) cfg.LIGNES_MAX_ETAT_FLUX = Number(option('budget'));
  const admin = new pg.Client({ connectionString: urlBd('admin') });
  await admin.connect();
  const bd = creerAccesBd(urlBd('worker'));
  const execution = (await admin.query(`insert into executions_controles (cabinet_id, entite_id, exercice_id, lot_import_id, version_donnees) values ($1, $2, $3, $4, 0) returning id`, [cabinetId, option('entite'), option('exercice'), option('lot')])).rows[0].id;
  globalThis.gc?.();
  const depart = process.memoryUsage();
  let picTas = depart.heapUsed;
  let picResidente = depart.rss;
  let picExterne = depart.external;
  const releve = setInterval(() => {
    const m = process.memoryUsage();
    if (m.heapUsed > picTas) picTas = m.heapUsed;
    if (m.rss > picResidente) picResidente = m.rss;
    if (m.external > picExterne) picExterne = m.external;
  }, 20);
  const t0 = performance.now();
  let erreur = null;
  try {
    await executerControlesExecution({ bd, cfg }, { cabinetId, executionId: execution });
  } catch (e) {
    erreur = String(e?.message ?? e).slice(0, 300);
  }
  const duree = (performance.now() - t0) / 1000;
  clearInterval(releve);
  const resultats = (await admin.query('select controle_id, version_controle, statut, motif, parametres, mesures from resultats_controles where execution_id = $1 order by controle_id', [execution])).rows;
  const constats = (await admin.query('select controle_id, cle, gravite, titre, explication, action_proposee, montant, lignes_concernees, preuves from constats where execution_id = $1 order by controle_id, cle', [execution])).rows;
  const journal = (await admin.query(`select details from journal_audit where cabinet_id = $1 and action = 'controles.termines' and cible_id = $2`, [cabinetId, execution])).rows[0]?.details ?? null;
  if (erreur) await admin.query(`delete from executions_controles where id = $1 and statut <> 'termine'`, [execution]);
  const realises = resultats.filter((r) => ['sans_anomalie', 'constat', 'non_applicable'].includes(r.statut));
  console.log(
    `RESULTAT ${JSON.stringify({
      execution,
      erreur,
      chemin: journal?.chemin ?? null,
      lignes: journal?.lignes ?? null,
      dureeS: Math.round(duree * 10) / 10,
      tasPlafondMo: Mo(getHeapStatistics().heap_size_limit),
      tasDepartMo: Mo(depart.heapUsed),
      picTasMo: Mo(picTas),
      picResidenteReleveeMo: Mo(picResidente),
      picResidenteSystemeMo: Math.round(process.resourceUsage().maxRSS / 1024),
      picExterneMo: Mo(picExterne),
      nbControles: CATALOGUE_CONTROLES.length,
      nbResultats: resultats.length,
      nbRealises: realises.length,
      statuts: Object.fromEntries(resultats.map((r) => [r.controle_id, r.statut])),
      nonRealises: resultats.filter((r) => !realises.includes(r)).map((r) => ({ controle: r.controle_id, statut: r.statut, motif: r.motif })),
      nbConstats: constats.length,
      nbConstatsComptes: Object.fromEntries(resultats.map((r) => [r.controle_id, r.mesures?.nbConstats ?? null])),
      empreinte: createHash('sha256').update(JSON.stringify({ resultats, constats })).digest('hex'),
      empreintes: Object.fromEntries(resultats.map((r) => [r.controle_id, createHash('sha256').update(JSON.stringify({ r, c: constats.filter((k) => k.controle_id === r.controle_id) })).digest('hex').slice(0, 16)])),
    })}`,
  );
  await bd.fermer();
  await admin.end();
  process.exit(0);
}

// ───────────────────────────── Processus principal ─────────────────────────────
// Une sortie fermée par le lecteur (« | head ») ne doit pas tuer le script avant qu'il ait retiré son jeu.
process.stdout.on('error', () => undefined);
process.stderr.on('error', () => undefined);
const admin = new pg.Client({ connectionString: urlBd('admin') });
await admin.connect();

if (option('retirer')) {
  console.log(`Espace avant : ${direEspace(espace())}`);
  await retirer(admin, option('retirer'));
  console.log(`Espace après : ${direEspace(espace())}`);
  await admin.end();
  process.exit(0);
}

const { analyserFec, enBlocs, genererFecSynthetique, genererReleveSynthetique, lireCamt053 } = await import('../packages/core/dist/index.js');
const ECRITURES = Number(option('ecritures', '400000'));
const TAS = option('tas', '0,384').split(',').map((x) => ({ tas: Number(x.split(':')[0]), budget: x.split(':')[1] ?? option('budget') ?? null }));
const SEUIL_LIBRE = Number(option('seuil-libre', '12'));
const marque = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

const avant = espace();
console.log(`Environnement : Node ${process.version}, ${process.platform} ${process.arch} ; PostgreSQL ${(await admin.query('show server_version')).rows[0].server_version} ; volume de PostgreSQL : ${direEspace(avant)}.`);
// Besoin estimé, d'après la mesure du 2026-11-19 sur 1 060 006 lignes (le volume libre a baissé de 1 090 Mo au plus
// fort, retrait compris) : environ 400 octets par ligne pour la table et ses index, autant de journaux de transactions
// (chargement, premières lectures, retrait), 200 octets de tris temporaires ; soit 1 100 octets par ligne, plus 300 Mo de marge.
const besoinMo = Math.round((ECRITURES * 2.65 * 1100) / 1024 / 1024) + 300;
if (avant && avant.libreMo < besoinMo && !drapeau('forcer')) {
  console.log(`Espace insuffisant : ${avant.libreMo} Mo libres pour un besoin estimé de ${besoinMo} Mo (jeu, tris temporaires, marge). Rien n'a été créé. Réduire --ecritures ou libérer de l'espace (--forcer pour passer outre).`);
  await admin.end();
  process.exit(2);
}

let cabinetId = null;
let echec = null;
let enfantEnCours = null;
// Interruption (Ctrl-C, arrêt) : l'exécution en cours est arrêtée, puis le bloc « finally » retire le jeu.
let interrompre = () => undefined;
const interruption = new Promise((_, rejeter) => (interrompre = () => rejeter(new Error('interrompue par un signal'))));
interruption.catch(() => undefined);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => (enfantEnCours?.kill('SIGKILL'), interrompre()));
try {
  cabinetId = (await admin.query('insert into cabinets (nom) values ($1) returning id', [`${NOM_CABINET} ${marque} (fictif)`])).rows[0].id;
  const entiteId = (await admin.query(`insert into entites (cabinet_id, raison_sociale, territoire_fiscal) values ($1, $2, 'metropole') returning id`, [cabinetId, `Dossier de mesure ${marque} (fictif)`])).rows[0].id;
  const exercice = async (debut, fin) => (await admin.query('insert into exercices (cabinet_id, entite_id, debut, fin) values ($1, $2, $3, $4) returning id', [cabinetId, entiteId, debut, fin])).rows[0].id;
  console.log(`Cabinet d'essai ${cabinetId}, dossier ${entiteId}.`);

  /** Génère un FEC synthétique et l'insère par tranches (analyse en flux : jamais toutes les lignes en mémoire). */
  async function creerLot(exerciceId, debut, fin, nbEcritures, graine, anomalies, surLigne) {
    const fec = genererFecSynthetique({ exercice: { debut, fin }, nbEcritures, graine, anomalies });
    const lot = (await admin.query(`insert into lots_import (cabinet_id, entite_id, exercice_id, type, cle_idempotence, actif, statut, progression) values ($1, $2, $3, 'fec', $4, true, 'termine', $5) returning id`, [cabinetId, entiteId, exerciceId, `mesure-flux-${marque}-${debut}`, fec.nbLignes])).rows[0].id;
    let tranche = [];
    let inserees = 0;
    const vider = async () => {
      if (tranche.length === 0) return;
      await admin.query(
        `insert into lignes_ecriture (cabinet_id, entite_id, exercice_id, lot_import_id, numero_ligne, journal_code, journal_lib, ecriture_num, ecriture_date, compte_num, compte_lib, comp_aux_num, comp_aux_lib,
                                      piece_ref, piece_date, ecriture_lib, debit, credit, ecriture_let, date_let, valid_date, montant_devise, idevise)
         select $1, $2, $3, $4, x."numeroLigne", x."journalCode", x."journalLib", x."ecritureNum", x."ecritureDate", x."compteNum", x."compteLib", x."compAuxNum", x."compAuxLib",
                x."pieceRef", x."pieceDate", x."ecritureLib", x.debit, x.credit, x."ecritureLet", x."dateLet", x."validDate", x."montantDevise", x.idevise
           from jsonb_to_recordset($5::jsonb) as x("numeroLigne" int, "journalCode" text, "journalLib" text, "ecritureNum" text, "ecritureDate" date, "compteNum" text, "compteLib" text, "compAuxNum" text,
                "compAuxLib" text, "pieceRef" text, "pieceDate" date, "ecritureLib" text, debit numeric, credit numeric, "ecritureLet" text, "dateLet" date, "validDate" date, "montantDevise" numeric, idevise text)`,
        [cabinetId, entiteId, exerciceId, lot, JSON.stringify(tranche)],
      );
      inserees += tranche.length;
      tranche = [];
      // Point de contrôle régulier : les journaux de transactions sont recyclés au fur et à mesure au lieu de s'accumuler.
      if (inserees % 100_000 === 0) await admin.query('checkpoint').catch(() => undefined);
    };
    await analyserFec(enBlocs(fec.contenu, 1 << 20), {
      nomFichier: fec.nomFichier,
      siren: '123456782',
      exerciceDebut: debut,
      exerciceFin: fin,
      surLigne: async (l) => {
        surLigne?.(l);
        tranche.push(l);
        if (tranche.length >= 5000) await vider();
      },
    });
    await vider();
    await admin.query('checkpoint').catch(() => undefined);
    return { id: lot, exerciceId, n: fec.nbLignes };
  }

  let t = Date.now();
  await creerLot(await exercice('2024-01-01', '2024-12-31'), '2024-01-01', '2024-12-31', Math.max(100, Math.round(ECRITURES / 20)), 11, []);
  const banque = [];
  const lotN = await creerLot(await exercice('2025-01-01', '2025-12-31'), '2025-01-01', '2025-12-31', ECRITURES, 5, ANOMALIES, (l) => {
    if (l.compteNum.startsWith('512') && (l.journalCode === 'AN' || l.ecritureDate <= '2025-01-31')) banque.push(l);
  });
  // Relevé bancaire de janvier, tiré des lignes de banque (avec suspens), enregistré comme le fait l'import d'un relevé.
  const releve = lireCamt053(genererReleveSynthetique({ graine: 5, format: 'camt.053', debut: '2025-01-01', fin: '2025-01-31', nbMouvements: 500, coherentAvec: banque }).contenu);
  const lotReleve = (await admin.query(`insert into lots_import (cabinet_id, entite_id, type, cle_idempotence, actif, statut) values ($1, $2, 'releve_bancaire', $3, true, 'termine') returning id`, [cabinetId, entiteId, `mesure-flux-${marque}-releve`])).rows[0].id;
  for (const compte of releve.comptes) {
    await admin.query(
      `insert into releves_bancaires (cabinet_id, entite_id, lot_import_id, format, iban, identifiant, devise, solde_ouverture, date_ouverture, solde_cloture, date_cloture, total_mouvements, nb_mouvements, cadrage, ecart, brut)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [cabinetId, entiteId, lotReleve, releve.format, compte.iban, compte.identifiant, compte.devise, compte.soldeOuverture, compte.dateOuverture, compte.soldeCloture, compte.dateCloture, compte.totalMouvements, compte.nbMouvements, compte.cadrage, compte.ecart, JSON.stringify(compte)],
    );
  }
  for (const m of releve.mouvements) {
    const id = (
      await admin.query(
        `insert into mouvements_bancaires (cabinet_id, entite_id, lot_import_id, rang, cle_idempotence, iban, identifiant_compte, devise, date_operation, date_valeur, montant, libelle, reference_banque, reference_bout_en_bout, brut)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [cabinetId, entiteId, lotReleve, m.rang, m.cleIdempotence, m.compte.iban, m.compte.identifiant, m.compte.devise, m.dateOperation, m.dateValeur, m.montant, m.libelle, m.referenceBanque, m.referenceBoutEnBout, JSON.stringify(m)],
      )
    ).rows[0].id;
    await admin.query('insert into mouvements_lots (cabinet_id, entite_id, mouvement_id, lot_import_id) values ($1, $2, $3, $4)', [cabinetId, entiteId, id, lotReleve]);
  }
  const volumes = (await admin.query(`select count(*)::int as lignes, count(distinct journal_code || chr(1) || ecriture_num)::int as ecritures, count(distinct compte_num)::int as comptes, count(distinct comp_aux_num)::int as tiers from lignes_ecriture where lot_import_id = $1`, [lotN.id])).rows[0];
  console.log(`Jeu prêt en ${((Date.now() - t) / 1000).toFixed(0)} s : exercice N de ${volumes.lignes} lignes (${volumes.ecritures} écritures, ${volumes.comptes} comptes, ${volumes.tiers} tiers), exercice N-1, relevé de ${releve.mouvements.length} mouvements (cadrage ${releve.comptes[0]?.cadrage}). Volume : ${direEspace(espace())}.`);

  const lancer = (tasMo, extra = []) =>
    new Promise((resoudre) => {
      const enfant = (enfantEnCours = spawn(process.execPath, [...(tasMo > 0 ? [`--max-old-space-size=${tasMo}`] : []), '--expose-gc', fileURLToPath(import.meta.url), '--executer', '--cabinet', cabinetId, '--entite', entiteId, '--exercice', lotN.exerciceId, '--lot', lotN.id, ...extra, ...(option('seuil') ? ['--seuil', option('seuil')] : [])], { stdio: ['ignore', 'pipe', 'pipe'] }));
      let sortie = '';
      let erreurs = '';
      enfant.stdout.on('data', (d) => (sortie += d));
      enfant.stderr.on('data', (d) => (erreurs += d));
      enfant.on('close', (code, signal) => {
        const ligne = sortie.split('\n').find((l) => l.startsWith('RESULTAT '));
        resoudre(ligne ? JSON.parse(ligne.slice(9)) : { erreur: `processus terminé sans résultat (code ${code}, signal ${signal}) : ${erreurs.trim().split('\n').filter((l) => /heap|memory|Error/i.test(l)).slice(0, 2).join(' | ').slice(0, 300)}` });
      });
    });
  const dire = (titre, r) => {
    if (r.erreur) return console.log(`${titre} : ÉCHEC — ${r.erreur}`);
    console.log(`${titre} : chemin « ${r.chemin} », ${r.lignes} lignes, ${r.dureeS} s ; tas : limite vue par V8 ${r.tasPlafondMo} Mo, pic relevé ${r.picTasMo} Mo (départ ${r.tasDepartMo} Mo) ; mémoire résidente : pic ${r.picResidenteSystemeMo} Mo (système), ${r.picResidenteReleveeMo} Mo (relevé toutes les 20 ms) ; ${r.nbRealises} contrôle(s) réalisé(s) sur ${r.nbControles}, ${r.nbConstats} constat(s) restitué(s).`);
    for (const n of r.nonRealises) console.log(`    ${n.controle} — ${n.statut} : ${n.motif}`);
  };

  const mesures = [];
  for (const { tas, budget } of TAS) {
    const r = await Promise.race([lancer(tas, budget ? ['--budget', budget] : []), interruption]);
    r.budget = budget;
    mesures.push(r);
    dire(`Flux, tas ${tas > 0 ? `plafonné à ${tas} Mo` : 'par défaut'}${budget ? `, budget d'état de ${budget} lignes` : ''}`, r);
  }
  const reussies = mesures.filter((m) => !m.erreur);
  if (reussies.length > 1) console.log(`Résultats des exécutions en flux entre elles : ${reussies.every((m) => m.empreinte === reussies[0].empreinte) ? 'IDENTIQUES (même empreinte des résultats et des constats)' : 'différents selon le budget ou le plafond (voir les contrôles non réalisés de chacune)'}.`);
  if (drapeau('comparer-memoire') && reussies.length > 0) {
    const r = await Promise.race([lancer(6144, ['--seuil', '100000000']), interruption]);
    dire('Mémoire (référence), tas plafonné à 6 144 Mo', r);
    if (!r.erreur) {
      for (const [i, m] of reussies.entries()) {
        const differents = Object.keys(r.empreintes).filter((id) => r.empreintes[id] !== m.empreintes[id]);
        console.log(`Flux n° ${i + 1}${m.budget ? ` (budget ${m.budget})` : ''} comparé à la référence en mémoire : ${differents.length === 0 ? 'IDENTIQUE pour les ' + Object.keys(r.empreintes).length + ' contrôles (statut, motif, mesures, constats)' : 'identique pour ' + (Object.keys(r.empreintes).length - differents.length) + ' contrôles ; différences sur ' + differents.join(', ')}.`);
        for (const id of differents) console.log(`    ${id} : en mémoire ${r.statuts[id]} (${r.nbConstatsComptes[id]} constat(s)) ; en flux ${m.statuts[id]} (${m.nbConstatsComptes[id] ?? 0} constat(s))`);
      }
    }
  }
  console.log(`Statuts (flux) : ${JSON.stringify(reussies[0]?.statuts ?? {})}`);
} catch (e) {
  echec = e;
  console.log(`Mesure interrompue : ${e.message}`);
} finally {
  const apres = espace();
  console.log(`Volume de PostgreSQL après la mesure : ${direEspace(apres)}.`);
  if (cabinetId) {
    const garder = drapeau('garder') && apres !== null && apres.librePourCent >= SEUIL_LIBRE && !echec;
    if (garder) console.log(`Jeu de mesure LAISSÉ en base (cabinet ${cabinetId}). Pour le retirer : node scripts/mesure-controles-flux.mjs --retirer ${cabinetId}`);
    else {
      if (drapeau('garder')) console.log(`Espace libre sous ${SEUIL_LIBRE} % (ou illisible) : le jeu est retiré malgré --garder.`);
      await retirer(admin, cabinetId);
      console.log(`Volume de PostgreSQL après retrait : ${direEspace(espace())}.`);
    }
  }
  await admin.end();
}
process.exit(echec ? 1 : 0);
