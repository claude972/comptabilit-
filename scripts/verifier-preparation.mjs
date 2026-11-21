#!/usr/bin/env node
/**
 * DIAGNOSTIC DE PRÉPARATION AU DÉPLOIEMENT (P4, D-102). LECTURE SEULE : aucune écriture dans la base, le stockage, Redis, les
 * sauvegardes ni la configuration ; aucun appel hors des services désignés par la configuration ; AUCUN secret dans la sortie
 * (seulement des noms de variables ; toute valeur secrète de l'environnement est en plus masquée dans le texte final).
 *
 *   node scripts/verifier-preparation.mjs [--cible=local|production] [--env-fichier=<fichier>] [--sauvegardes=<dossier>]
 *                                         [--age-max-heures=26] [--disque-min-go=8] [--disque-min-pct=10]
 *                                         [--memoire-min-mo=512] [--certificat-min-jours=30]
 *                                         [--sans-sondes] [--sans-empreintes] [--sans-docker] [--projet=comtaple] [--json]
 *
 * Chaque contrôle est PRÊT, MANQUANT ou NON VÉRIFIÉ, avec son motif et, sinon, l'action corrective. Code de sortie : 0 si aucun
 * contrôle n'est MANQUANT, 1 sinon, 2 si l'outil lui-même n'a pas pu s'exécuter. Cible `production` : une valeur de développement
 * est MANQUANT ; cible `local` (défaut) : NON VÉRIFIÉ (elle serait refusée au démarrage en production).
 *
 * Sans `--env-fichier`, la configuration est celle du fichier .env du dépôt et de l'environnement du processus. Avec
 * `--env-fichier=/srv/comtaple/production.env`, on contrôle ce fichier (lu sans être exporté) ; les sondes visent alors ses hôtes.
 * Ce diagnostic n'est PAS une autorisation de mise en production (V9) ni un audit ; il ne remplace aucun essai de recette.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = promisify(execFile);
const args = process.argv.slice(2);
const option = (n, defaut) => args.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? defaut;
const drapeau = (n) => args.includes(`--${n}`);
const connus = ['cible', 'env-fichier', 'sauvegardes', 'age-max-heures', 'disque-min-go', 'disque-min-pct', 'projet'];
const drapeaux = ['sans-sondes', 'sans-empreintes', 'sans-docker', 'json', 'aide'];
const inconnus = args.filter((x) => !(connus.some((n) => x.startsWith(`--${n}=`)) || drapeaux.some((n) => x === `--${n}`)));
if (inconnus.length || drapeau('aide')) {
  console.error(`${inconnus.length ? `Option inconnue : ${inconnus.join(' ')}\n` : ''}Usage : voir l'en-tête de scripts/verifier-preparation.mjs`);
  process.exit(2);
}

const {
  controlerCertificat, controlerConfiguration, controlerMemoire, controlerSauvegardes, controlerVolume, lireDfPk, lireMeminfo, rendre, synthese,
} = await import('../packages/plateforme/dist/preparation.js');
const { verifierJeu } = await import('../packages/plateforme/dist/jeu-sauvegarde.js');

// ── Environnement : .env du dépôt (sans écraser l'environnement) ou fichier désigné ──
function lireEnvFichier(chemin) {
  const env = {};
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(ligne.trim());
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const cible = option('cible', 'local');
if (!['local', 'production'].includes(cible)) {
  console.error('--cible doit valoir local ou production');
  process.exit(2);
}
let env;
const fichierEnv = option('env-fichier');
if (fichierEnv) {
  if (!existsSync(fichierEnv)) {
    console.error(`Fichier d'environnement introuvable : ${fichierEnv}`);
    process.exit(2);
  }
  env = lireEnvFichier(fichierEnv);
} else {
  const f = join(racine, '.env');
  env = { ...(existsSync(f) ? lireEnvFichier(f) : {}), ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
}
// Adresses effectives des sondes, selon la forme du fichier (API/worker ou production.env de la composition).
const issuer = env.OIDC_ISSUER || (env.DOMAINE_AUTH ? `https://${env.DOMAINE_AUTH}/realms/comtaple` : '');
const urlRedis = env.REDIS_URL || (env.REDIS_PASSWORD ? `redis://:${env.REDIS_PASSWORD}@redis:6379` : '');

const secretes = Object.entries(env).filter(([k, v]) => /PASSWORD|SECRET|JETON|KEY|MDP|TOKEN/i.test(k) && typeof v === 'string' && v.length >= 8).map(([, v]) => v);
const masquer = (t) => {
  let r = String(t);
  for (const s of secretes) r = r.split(s).join('***');
  return r.replace(/:\/\/([^:@/\s]+):([^@/\s]+)@/g, '://$1:***@');
};
const bref = (e) => masquer(e instanceof Error ? e.message || e.name : e).slice(0, 160);

const controles = [];
const ajouter = (c) => controles.push(c);

// ── 1. Configuration ──
// Un `production.env` de la composition ne porte pas NODE_ENV (la composition le pose à « production »).
controles.push(...controlerConfiguration(fichierEnv && !env.NODE_ENV ? { ...env, NODE_ENV: 'production' } : env, cible));

// ── 2. Dépendances (lecture seule) ──
const G = 'Dépendances';
const delai = (ms) => AbortSignal.timeout(ms);
async function sonde(nom, fn, action) {
  try {
    const r = await fn();
    ajouter({ groupe: G, nom, etat: r.etat ?? 'PRET', motif: r.motif, ...(r.action || r.etat === 'NON_VERIFIE' ? { action: r.action ?? action } : {}) });
  } catch (e) {
    ajouter({ groupe: G, nom, etat: 'MANQUANT', motif: `injoignable ou en erreur : ${bref(e)}`, action });
  }
}
function tcp(hote, port, envoi, delaiMs = 4000) {
  return new Promise((resolve, reject) => {
    const s = connect({ host: hote, port });
    let tampon = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error('délai dépassé')); }, delaiMs);
    s.on('error', (e) => { clearTimeout(t); reject(e); });
    s.on('connect', () => envoi.forEach((x) => s.write(x)));
    s.on('data', (d) => { tampon += d.toString('latin1'); if (tampon.length > 0 && (tampon.includes('\n') && envoi.length === 1 || tampon.split('\n').length > envoi.length + 1 || tampon.includes('PONG'))) { clearTimeout(t); s.end(); resolve(tampon); } });
    s.on('close', () => { clearTimeout(t); resolve(tampon); });
  });
}

if (drapeau('sans-sondes')) {
  ajouter({ groupe: G, nom: 'Sondes', etat: 'NON_VERIFIE', motif: 'désactivées (--sans-sondes) : base, Redis, S3, Keycloak, antivirus, OCR et IA non contrôlés', action: 'Relancer sans --sans-sondes depuis un poste qui atteint ces services.' });
} else {
  const requirePg = createRequire(join(racine, 'packages/db/package.json'));
  const requireS3 = createRequire(join(racine, 'packages/plateforme/package.json'));

  // Base : connexion en lecture seule (administrateur si disponible, sinon rôle applicatif).
  let client = null;
  await sonde('Base de données (PostgreSQL)', async () => {
    const pg = requirePg('pg');
    const role = env.PG_ADMIN_PASSWORD ? 'admin' : 'app';
    const { urlBd } = await import('../packages/db/dist/index.js');
    client = new pg.Client({ connectionString: urlBd(role, env), connectionTimeoutMillis: 5000, ssl: undefined });
    await client.connect();
    await client.query('SET default_transaction_read_only = on');
    const v = (await client.query('show server_version')).rows[0].server_version;
    const ext = (await client.query("select extversion from pg_extension where extname = 'vector'")).rows[0]?.extversion;
    if (!ext) return { etat: 'MANQUANT', motif: `PostgreSQL ${v} joignable, extension « vector » absente`, action: 'Créer l’extension vector (la commande de migration le fait avec le rôle d’administration).' };
    return { motif: `PostgreSQL ${v} joignable (rôle ${role}, session en lecture seule), extension vector ${ext}` };
  }, 'Vérifier PG_HOST, PG_PORT, PG_DATABASE et les mots de passe ; démarrer la base (pnpm run services:up en local).');

  if (client) {
    await sonde('Migrations appliquées', async () => {
      const fichiers = readdirSync(join(racine, 'packages/db/migrations')).filter((f) => f.endsWith('.sql')).length;
      const { rows } = await client.query('select count(*)::int as n from public.migrations_drizzle');
      return rows[0].n === fichiers
        ? { motif: `${rows[0].n} migration(s) appliquée(s), autant que de fichiers` }
        : { etat: 'MANQUANT', motif: `${rows[0].n} appliquée(s) pour ${fichiers} fichier(s)`, action: 'Lancer la commande de migration (node packages/db/dist/migrer.js, ou le service « migration » de la composition).' };
    }, 'Lancer la commande de migration.');
    await sonde('RLS forcée sur les tables à cabinet_id', async () => {
      const { rows } = await client.query(`select count(*)::int as total, count(*) filter (where not (c.relrowsecurity and c.relforcerowsecurity))::int as sans
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'cabinet_id' and not a.attisdropped)`);
      return rows[0].sans === 0
        ? { motif: `${rows[0].total} table(s) à cabinet_id, toutes à RLS activée et forcée` }
        : { etat: 'MANQUANT', motif: `${rows[0].sans} table(s) à cabinet_id sans RLS forcée`, action: 'Appeler SELECT securite_appliquer_rls(); dans une migration (docs/exploitation.md § 10).' };
    }, 'Rechercher les tables sans RLS forcée (pg_class.relforcerowsecurity).');
    await sonde('Rôles applicatifs sans BYPASSRLS', async () => {
      const { rows } = await client.query("select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('comtaple_app','comtaple_worker') order by 1");
      if (rows.length < 2) return { etat: 'MANQUANT', motif: `${rows.length} rôle(s) applicatif(s) sur 2`, action: 'Lancer la commande de migration (elle crée les rôles).' };
      const mauvais = rows.filter((r) => r.rolbypassrls || r.rolsuper).map((r) => r.rolname);
      return mauvais.length ? { etat: 'MANQUANT', motif: `BYPASSRLS ou superutilisateur : ${mauvais.join(', ')}`, action: 'Retirer l’attribut (ALTER ROLE … NOBYPASSRLS NOSUPERUSER).' } : { motif: 'comtaple_app et comtaple_worker : ni BYPASSRLS ni superutilisateur' };
    }, 'Vérifier les rôles.');
  }

  await sonde('Files (Redis)', async () => {
    const u = new URL(urlRedis);
    const mdp = decodeURIComponent(u.password);
    const rep = await tcp(u.hostname, Number(u.port || 6379), [`*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(mdp)}\r\n${mdp}\r\n`, '*1\r\n$4\r\nPING\r\n', '*3\r\n$6\r\nCONFIG\r\n$3\r\nGET\r\n$16\r\nmaxmemory-policy\r\n']);
    if (!rep.includes('PONG')) throw new Error(`réponse inattendue (${rep.split('\r\n')[0].slice(0, 40)})`);
    return rep.includes('noeviction') ? { motif: 'PING/PONG, authentifié, politique « noeviction » (exigée par BullMQ)' } : { etat: 'MANQUANT', motif: 'répond, mais la politique d’éviction n’est pas « noeviction » (ou n’a pas pu être lue)', action: 'Lancer Redis avec --maxmemory-policy noeviction.' };
  }, 'Vérifier REDIS_URL / REDIS_PASSWORD et que Redis tourne.');

  await sonde('Stockage objet (S3)', async () => {
    const { S3Client, HeadBucketCommand, ListObjectsV2Command } = requireS3('@aws-sdk/client-s3');
    const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'local', forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), { abortSignal: delai(6000) });
      await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, MaxKeys: 1 }), { abortSignal: delai(6000) });
    } finally {
      s3.destroy();
    }
    return { motif: 'bucket accessible en lecture (HeadBucket, liste) ; aucune écriture tentée' };
  }, 'Vérifier S3_ENDPOINT, S3_BUCKET et les clés ; démarrer le stockage.');

  await sonde('Fournisseur d’identité (Keycloak)', async () => {
    const r = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: delai(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return d.issuer === issuer ? { motif: `royaume joignable, émetteur conforme (${new URL(issuer).origin})` } : { etat: 'MANQUANT', motif: 'l’émetteur annoncé diffère de OIDC_ISSUER : toute connexion serait refusée', action: 'Aligner le nom d’hôte public de Keycloak et OIDC_ISSUER.' };
  }, 'Vérifier OIDC_ISSUER / DOMAINE_AUTH et que Keycloak tourne.');

  await sonde('Antivirus (ClamAV)', async () => {
    const hote = env.CLAMAV_HOST || (cible === 'production' ? 'clamav' : '127.0.0.1');
    const rep = await tcp(hote, Number(env.CLAMAV_PORT || 3310), ['zPING\0'], 5000);
    if (!rep.includes('PONG')) throw new Error('pas de PONG');
    return { motif: 'clamd répond (PING/PONG)' };
  }, 'Démarrer ClamAV ; attendre le téléchargement des signatures au premier démarrage.');

  await sonde('OCR', async () => {
    const r = await fetch(`${env.OCR_URL || 'http://127.0.0.1:8500'}/sante`, { signal: delai(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { motif: 'service d’OCR en bonne santé' };
  }, 'Démarrer le service d’OCR (pièces scannées : saisie manuelle sinon).');

  // IA : lecture de l'état enregistré, aucun appel sortant.
  if (!env.IA_OVH_ENDPOINT && !env.IA_OVH_JETON) {
    ajouter({ groupe: G, nom: 'Passerelle IA', etat: 'NON_VERIFIE', motif: 'non configurée : fonctionnement SANS IA (aucun appel sortant) ; aucune preuve de connexion n’existe', action: 'Facultatif. Activation = décision de l’éditeur (V17), puis node scripts/editeur.mjs ia-verifier --appel-reel.' });
  } else if (!client) {
    ajouter({ groupe: G, nom: 'Passerelle IA', etat: 'NON_VERIFIE', motif: 'configurée, mais la base n’est pas lisible : preuve de connexion non lue', action: 'Rétablir la base puis relancer.' });
  } else {
    await sonde('Passerelle IA', async () => {
      const { dernieresVerificationsIa } = await import('../packages/plateforme/dist/ia.js');
      const [v] = await dernieresVerificationsIa(client, 1);
      if (!v) return { etat: 'NON_VERIFIE', motif: 'configurée, aucune vérification enregistrée : statut « configuré, non vérifié »', action: 'node scripts/editeur.mjs ia-verifier --appel-reel (coûte un appel réel).' };
      const reste = (new Date(v.valideJusquAu).getTime() - Date.now()) / 86_400_000;
      if (v.resultat !== 'connecte') return { etat: 'MANQUANT', motif: `dernière vérification : ${v.resultat}`, action: 'Corriger la configuration puis relancer ia-verifier --appel-reel.' };
      if (reste <= 0) return { etat: 'MANQUANT', motif: `preuve de connexion périmée depuis le ${String(v.valideJusquAu).slice(0, 10)}`, action: 'Relancer node scripts/editeur.mjs ia-verifier --appel-reel (décision explicite).' };
      return reste < 7 ? { etat: 'MANQUANT', motif: `preuve de connexion expirant dans ${reste.toFixed(1)} jour(s)`, action: 'Relancer ia-verifier --appel-reel avant l’échéance.' } : { motif: `preuve de connexion valable encore ${reste.toFixed(0)} jour(s) (lecture de l’état enregistré, aucun appel)` };
    }, 'Voir node scripts/editeur.mjs ia-etat.');
  }
  if (client) await client.end().catch(() => {});
}

// ── 3. Sauvegardes ──
{
  const dossier = option('sauvegardes', join(racine, 'var', 'sauvegardes'));
  if (!existsSync(dossier)) {
    ajouter({ groupe: 'Sauvegardes', nom: 'Dossier des sauvegardes', etat: 'MANQUANT', motif: 'dossier absent', action: 'Lancer scripts/sauvegarder.sh (local) ou désigner --sauvegardes=<dossier>.' });
  } else {
    const noms = readdirSync(dossier);
    const ids = new Set();
    for (const n of noms) { const m = /^(comtaple-\d{8}-\d{6})\./.exec(n); if (m) ids.add(m[1]); }
    const groupes = [];
    let dernierComplet = null;
    for (const id of ids) {
      const stamp = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
      const ms = Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]);
      const descripteur = join(dossier, `${id}.jeu.json`);
      const complet = existsSync(descripteur);
      const interrompu = noms.includes(`${id}.en-cours`);
      // Instant tiré du NOM du jeu (UTC : sauvegarder-jeu.mjs le forme avec toISOString), pour comparer jeux complets et interrompus sur la même base.
      const creeMs = ms;
      const chiffre = noms.some((n) => n.startsWith(`${id}.`) && n.endsWith('.chiffre'));
      groupes.push({ id, crealeMs: creeMs, complet, interrompu, chiffre });
      if (complet && (!dernierComplet || creeMs > dernierComplet.crealeMs)) dernierComplet = { id, crealeMs: creeMs, descripteur };
    }
    let integrite = null;
    if (!drapeau('sans-empreintes') && dernierComplet) {
      const v = await verifierJeu(dernierComplet.descripteur);
      integrite = { conforme: v.conforme, ecarts: v.ecarts };
    }
    controles.push(...controlerSauvegardes(groupes, { maintenantMs: Date.now(), ageMaxHeures: Number(option('age-max-heures', '26')), clePubliqueConfiguree: Boolean(env.SAUVEGARDE_CLE_PUBLIQUE), integrite }));
    ajouter({ groupe: 'Sauvegardes', nom: 'Ce qui n’est PAS vérifié ici', etat: 'NON_VERIFIE', motif: 'restaurabilité (jamais déduite de l’intégrité des fichiers), sauvegardes de l’hébergeur, copie hors hôte des fichiers d’environnement', action: 'Rejouer scripts/essai-restauration-chronometree.sh (jetable) ; en production : essai de restauration en recette (docs/exploitation.md § 4).' });
  }
}

// ── 4. Disque ──
{
  const G2 = 'Espace disque';
  const seuils = { libreMinOctets: Number(option('disque-min-go', '8')) * 2 ** 30, libreMinPourcent: Number(option('disque-min-pct', '10')) };
  try {
    const { stdout } = await sh('df', ['-Pk', racine]);
    const d = lireDfPk(stdout);
    if (!d) throw new Error('sortie de df illisible');
    ajouter(controlerVolume('Hôte (volume du dépôt et des sauvegardes)', G2, d.libreOctets, d.totalOctets, seuils, 'Libérer de la place ou déplacer var/sauvegardes (aucune suppression automatique).'));
  } catch (e) {
    ajouter({ groupe: G2, nom: 'Hôte', etat: 'NON_VERIFIE', motif: `df indisponible : ${bref(e)}`, action: 'Vérifier l’espace disque à la main.' });
  }
  if (drapeau('sans-docker')) {
    ajouter({ groupe: G2, nom: 'VM Docker et volume S3', etat: 'NON_VERIFIE', motif: 'désactivé (--sans-docker)', action: 'Relancer sans --sans-docker.' });
  } else {
    const projet = option('projet', 'comtaple');
    const dansConteneur = async (service, cmd) => (await sh('docker', ['exec', `${projet}-${service}-1`, ...cmd], { timeout: 120_000 })).stdout;
    try {
      const d = lireDfPk(await dansConteneur('postgres', ['df', '-Pk', '/var/lib/postgresql']));
      if (!d) throw new Error('sortie de df illisible');
      // Le disque de la VM est partagé par tous les volumes : plancher propre au stockage objet (3 Go libres), seuil plus strict que le défaut.
      ajouter(controlerVolume('VM Docker (disque partagé par les volumes)', G2, d.libreOctets, d.totalOctets, seuils, 'Agrandir le disque de la VM (colima stop ; colima start --disk <Go>) ou libérer des volumes d’essai ; sous 3 Go le stockage refuse les écritures.'));
    } catch (e) {
      ajouter({ groupe: G2, nom: 'VM Docker', etat: 'NON_VERIFIE', motif: `conteneur ${projet}-postgres-1 ou docker indisponible : ${bref(e)}`, action: 'Démarrer Docker (colima start) et la pile ; en production, surveiller le disque de l’hôte avec la sonde node-exporter (alerte à 15 % et 5 %).' });
    }
    try {
      const m = lireMeminfo(await dansConteneur('postgres', ['cat', '/proc/meminfo']));
      if (!m) throw new Error('meminfo illisible');
      ajouter(controlerMemoire('Mémoire de la VM Docker (disponible)', 'Mémoire', m.disponibleOctets, m.totalOctets, Number(option('memoire-min-mo', '512')) * 2 ** 20, 5, 'Arrêter des conteneurs inutiles ou agrandir la mémoire de la VM (colima start --memory <Go>) ; les limites de mémoire des conteneurs sont dans les compositions.'));
    } catch (e) {
      ajouter({ groupe: 'Mémoire', nom: 'Mémoire de la VM Docker', etat: 'NON_VERIFIE', motif: `non mesurée : ${bref(e)}`, action: 'En production, la mémoire de l’hôte est suivie par la sonde de l’hôte de la supervision (node-exporter).' });
    }
    try {
      const ko = Number((await dansConteneur('s3', ['du', '-sk', '/data'])).split(/\s+/)[0]);
      if (!Number.isFinite(ko)) throw new Error('du illisible');
      ajouter({ groupe: G2, nom: 'Volume des objets (S3 local)', etat: 'PRET', motif: `${(ko / 2 ** 20).toFixed(1).replace('.', ',')} Go occupés par /data (information ; le seuil porte sur l’espace libre de la VM)` });
    } catch (e) {
      ajouter({ groupe: G2, nom: 'Volume des objets (S3)', etat: 'NON_VERIFIE', motif: `non mesuré : ${bref(e)}`, action: 'En production le stockage est celui de l’hébergeur : suivre son volume dans la console.' });
    }
  }
}

// ── 5. Certificats (fin de validité) ──
{
  const { X509Certificate } = await import('node:crypto');
  const tls = await import('node:tls');
  const joursMin = Number(option('certificat-min-jours', '30'));
  const action = 'Renouveler le certificat avant l’échéance (TLS public : renouvellement automatique du proxy à vérifier ; certificats des traces : procédure § 9).';
  let vus = 0;
  for (const [nom, variable] of [['Autorité des traces (TRACES_AC_PEM)', 'TRACES_AC_PEM'], ['Certificat de l’agent de traces (TRACES_AGENT_CERT_PEM)', 'TRACES_AGENT_CERT_PEM'], ['Certificat de l’entrée des traces (TRACES_ENTREE_CERT_PEM)', 'TRACES_ENTREE_CERT_PEM'], ['Autorité de la base managée (PG_AC_PEM)', 'PG_AC_PEM']]) {
    const pem = env[variable];
    if (!pem || !pem.includes('BEGIN CERTIFICATE')) continue;
    vus++;
    try { controles.push(controlerCertificat(nom, new X509Certificate(pem.replace(/\\n/g, '\n')).validTo, Date.now(), joursMin, action)); } catch (e) { ajouter({ groupe: 'Certificats', nom, etat: 'NON_VERIFIE', motif: `illisible : ${bref(e)}`, action }); }
  }
  const domaines = [env.DOMAINE_WEB, env.DOMAINE_AUTH, ...[env.WEB_URL, env.OIDC_ISSUER].map((u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : null; } catch { return null; } })].filter(Boolean);
  for (const hote of [...new Set(domaines)]) {
    if (drapeau('sans-sondes')) break;
    vus++;
    try {
      const fin = await new Promise((resolve, reject) => {
        const s = tls.connect({ host: hote, port: 443, servername: hote, timeout: 6000 }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c.valid_to); });
        s.on('error', reject); s.on('timeout', () => { s.destroy(); reject(new Error('délai dépassé')); });
      });
      controles.push(controlerCertificat(`Certificat TLS public de ${hote}`, fin, Date.now(), joursMin, action));
    } catch (e) { ajouter({ groupe: 'Certificats', nom: `Certificat TLS public de ${hote}`, etat: 'MANQUANT', motif: `non lu : ${bref(e)}`, action: 'Vérifier le DNS, le proxy et l’émission du certificat.' }); }
  }
  if (!vus) ajouter({ groupe: 'Certificats', nom: 'Certificats', etat: 'NON_VERIFIE', motif: 'aucun certificat à contrôler dans cette configuration (aucun domaine public HTTPS, aucun PEM) : pile locale en HTTP', action: 'En production : relancer avec --env-fichier=production.env ; les certificats TLS publics sont lus sur le port 443.' });
}

if (drapeau('json')) {
  console.log(masquer(JSON.stringify({ cible, controles, synthese: synthese(controles) }, null, 2)));
} else {
  console.log(`Diagnostic de préparation au déploiement — cible « ${cible} » — ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC — LECTURE SEULE`);
  console.log(masquer(rendre(controles)));
}
process.exit(synthese(controles).codeSortie);
