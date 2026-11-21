/**
 * Contrôles de PRÉPARATION AU DÉPLOIEMENT (P4, D-102) : fonctions pures, sans entrée-sortie, partagées par
 *  - le démarrage de l'API et du worker (`lireConfig` refuse de démarrer en production avec une valeur de développement) ;
 *  - la commande de diagnostic `scripts/verifier-preparation.mjs` (lecture seule).
 * Aucune valeur de variable n'est jamais renvoyée : seulement des NOMS de variables.
 */

export type EtatControle = 'PRET' | 'MANQUANT' | 'NON_VERIFIE';

export interface Controle {
  groupe: string;
  nom: string;
  etat: EtatControle;
  motif: string;
  /** Action corrective ; absente quand l'état est PRET. */
  action?: string;
}

export type Env = Readonly<Record<string, string | undefined>>;
export type Cible = 'production' | 'local';

const vide = (v: string | undefined): boolean => v === undefined || v.trim() === '';
const hoteDe = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const hoteLocal = (h: string | null): boolean => h !== null && (HOTES_LOCAUX.has(h) || h.endsWith('.localhost') || h.endsWith('.test'));
const MARQUEURS_FACTICES = /factice|changeme|change-me|exemple|example|motdepasse|password|a-changer/i;

/** Un secret « aléatoire » doit être assez long et ne pas répéter quelques caractères (« aaaa… », « 1234… »). */
export function secretFaible(valeur: string, longueurMin: number): string | null {
  if (valeur.length < longueurMin) return `moins de ${longueurMin} caractères`;
  if (new Set(valeur).size < 10) return 'trop peu de caractères distincts';
  if (MARQUEURS_FACTICES.test(valeur)) return 'valeur d’exemple ou factice';
  return null;
}

export interface Violation {
  code: string;
  variables: string[];
  motif: string;
  action: string;
}

/**
 * Règles qui interdisent une valeur de DÉVELOPPEMENT en production. Chaque règle nomme les variables fautives (jamais leurs valeurs).
 * Les variables peuvent être celles de l'API et du worker (OIDC_ISSUER, REDIS_URL…) ou celles du fichier `production.env` de la
 * composition (DOMAINE_AUTH, REDIS_PASSWORD…) : les deux formes sont reconnues.
 */
export function violationsProduction(env: Env): Violation[] {
  const v: Violation[] = [];
  const ajouter = (code: string, variables: string[], motif: string, action: string) => {
    if (variables.length) v.push({ code, variables, motif, action });
  };

  if (!vide(env.NODE_ENV) && env.NODE_ENV !== 'production') {
    ajouter('node-env', ['NODE_ENV'], 'vaut autre chose que « production »', 'Poser NODE_ENV=production (la composition de production le fait).');
  } else if (vide(env.NODE_ENV)) {
    ajouter('node-env', ['NODE_ENV'], 'non défini : le mode de production n’est pas explicite', 'Poser NODE_ENV=production.');
  }

  ajouter(
    'simulateurs',
    ['MAIL_SIMULATEUR_URL', 'PUSH_SIMULATEUR_URL', 'AGREGATION_SIMULATEUR_URL'].filter((n) => !vide(env[n])),
    'simulateur de test défini',
    'Retirer ces variables : elles ne servent qu’aux tests.',
  );
  ajouter('comptes-de-developpement', ['DEV_MDP_UTILISATEURS'].filter((n) => !vide(env[n])), 'mot de passe des comptes du royaume de DÉVELOPPEMENT présent', 'Retirer DEV_MDP_UTILISATEURS : le royaume de production (gabarit) ne crée aucun compte.');

  // Chiffrement et authenticité des liaisons : HTTPS partout en production.
  const http: string[] = [];
  for (const n of ['OIDC_ISSUER', 'S3_ENDPOINT', 'WEB_URL', 'API_URL']) {
    if (!vide(env[n]) && !/^https:\/\//i.test(env[n]!)) http.push(n);
  }
  ajouter('https', http, 'adresse non HTTPS', 'Utiliser une adresse https:// (certificat valide).');

  const locaux: string[] = [];
  for (const n of ['OIDC_ISSUER', 'S3_ENDPOINT', 'WEB_URL', 'API_URL', 'OCR_URL_PUBLIQUE']) if (!vide(env[n]) && hoteLocal(hoteDe(env[n]!))) locaux.push(n);
  if (!vide(env.PG_HOST) && (HOTES_LOCAUX.has(env.PG_HOST!) || env.PG_HOST!.endsWith('.localhost'))) locaux.push('PG_HOST');
  if (!vide(env.REDIS_URL) && hoteLocal(hoteDe(env.REDIS_URL!)) && hoteDe(env.REDIS_URL!) !== null) locaux.push('REDIS_URL');
  for (const n of ['DOMAINE_WEB', 'DOMAINE_AUTH']) if (!vide(env[n]) && (hoteLocal(env[n]!) || env[n]!.endsWith('.exemple.test'))) locaux.push(n);
  ajouter('hotes-locaux', locaux, 'adresse locale ou de test', 'Désigner l’hôte de production (base managée, stockage S3, identités, domaine public).');

  const tests: string[] = [];
  if (!vide(env.S3_BUCKET) && /(^|-)(dev|test|essai|local)(-|$)/i.test(env.S3_BUCKET!)) tests.push('S3_BUCKET');
  if (!vide(env.OIDC_CLIENT_ID) && /test|dev/i.test(env.OIDC_CLIENT_ID!)) tests.push('OIDC_CLIENT_ID');
  if (!vide(env.PG_DATABASE) && /(^|_)(dev|test|essai)(_|$)/i.test(env.PG_DATABASE!)) tests.push('PG_DATABASE');
  ajouter('noms-de-test', tests, 'nom de ressource de développement ou d’essai', 'Utiliser les ressources de production (bucket, client OIDC, base).');

  if (env.ANTIVIRUS_OBLIGATOIRE !== undefined && env.ANTIVIRUS_OBLIGATOIRE.trim() === 'false') {
    ajouter('antivirus', ['ANTIVIRUS_OBLIGATOIRE'], 'antivirus facultatif', 'Retirer la variable (obligatoire par défaut).');
  }
  if (!vide(env.KC_BOOTSTRAP_ADMIN_USERNAME) || !vide(env.KC_BOOTSTRAP_ADMIN_PASSWORD)) {
    ajouter('amorcage-keycloak', ['KC_BOOTSTRAP_ADMIN_USERNAME', 'KC_BOOTSTRAP_ADMIN_PASSWORD'].filter((n) => !vide(env[n])), 'compte d’amorçage Keycloak encore configuré', 'Après avoir créé un administrateur nominatif avec second facteur, SUPPRIMER ces lignes (docs/exploitation.md § 2-F).');
  }

  // Secrets : longueur et caractère non factice.
  const faibles: string[] = [];
  const exigences: Array<[string, number]> = [
    ['SESSION_SECRET', 48],
    ['JETONS_CLE_CHIFFREMENT', 43],
    ['PG_APP_PASSWORD', 24],
    ['PG_WORKER_PASSWORD', 24],
    ['PG_ADMIN_PASSWORD', 24],
    ['REDIS_PASSWORD', 24],
    ['S3_SECRET_KEY', 24],
    ['OIDC_CLIENT_SECRET', 24],
    ['KC_DB_PASSWORD', 24],
  ];
  for (const [n, longueur] of exigences) if (!vide(env[n]) && secretFaible(env[n]!, longueur) !== null) faibles.push(n);
  ajouter('secrets-faibles', faibles, 'secret trop court, répétitif ou factice', 'Générer un secret aléatoire (docs/exploitation.md § 2-D : LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom | head -c 48).');
  return v;
}

/** Erreur lisible pour le démarrage : noms de variables seulement. */
export function messageRefusProduction(env: Env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  const v = violationsProduction(env).filter((x) => x.code !== 'amorcage-keycloak');
  if (!v.length) return null;
  return `Configuration refusée en production : ${v.map((x) => `${x.variables.join(', ')} (${x.motif})`).join(' ; ')}.`;
}

/** Variables sans lesquelles l'application ne démarre pas en production : un concept peut s'écrire de deux façons. */
const REQUIS: Array<{ nom: string; une: string[][]; aide: string }> = [
  { nom: 'Base de données (hôte, port)', une: [['PG_HOST', 'PG_PORT']], aide: 'PG_HOST et PG_PORT de la base managée' },
  { nom: 'Mots de passe des rôles applicatifs', une: [['PG_APP_PASSWORD', 'PG_WORKER_PASSWORD']], aide: 'PG_APP_PASSWORD et PG_WORKER_PASSWORD (posés par la commande de migration)' },
  { nom: 'Files (Redis)', une: [['REDIS_URL'], ['REDIS_PASSWORD']], aide: 'REDIS_PASSWORD (composition) ou REDIS_URL' },
  { nom: 'Stockage objet', une: [['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']], aide: 'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY' },
  { nom: 'Fournisseur d’identité', une: [['OIDC_ISSUER'], ['DOMAINE_AUTH']], aide: 'DOMAINE_AUTH (composition) ou OIDC_ISSUER' },
  { nom: 'Secret du client OIDC', une: [['OIDC_CLIENT_SECRET']], aide: 'OIDC_CLIENT_SECRET (même valeur que le client Keycloak)' },
  { nom: 'Adresse publique de l’application', une: [['WEB_URL'], ['DOMAINE_WEB']], aide: 'DOMAINE_WEB (composition) ou WEB_URL' },
  { nom: 'Secret de session web', une: [['SESSION_SECRET']], aide: 'SESSION_SECRET (48 caractères aléatoires)' },
  { nom: 'Secret de chiffrement des jetons', une: [['JETONS_CLE_CHIFFREMENT']], aide: 'JETONS_CLE_CHIFFREMENT (43 caractères aléatoires) ; à sauvegarder hors hôte' },
];

/**
 * Contrôle de la configuration. `cible: 'production'` : toute violation est MANQUANT. `cible: 'local'` : les valeurs de développement
 * sont attendues sur un poste de développement ; elles sont rapportées NON VÉRIFIÉ (« serait refusée en production »), pas MANQUANT.
 */
export function controlerConfiguration(env: Env, cible: Cible): Controle[] {
  const g = 'Configuration';
  const sortie: Controle[] = [];
  for (const r of REQUIS) {
    const manquantes = r.une.map((alt) => alt.filter((n) => vide(env[n])));
    const complet = manquantes.some((m) => m.length === 0);
    sortie.push(
      complet
        ? { groupe: g, nom: r.nom, etat: 'PRET', motif: 'définie' }
        : { groupe: g, nom: r.nom, etat: 'MANQUANT', motif: `variable(s) absente(s) : ${[...new Set(manquantes.flat())].join(', ')}`, action: `Définir ${r.aide} (modèle : infra/production/exemple.env).` },
    );
  }
  const violations = violationsProduction(env);
  if (!violations.length) {
    sortie.push({ groupe: g, nom: 'Valeurs de développement', etat: 'PRET', motif: 'aucune valeur de développement détectée (HTTPS, hôtes, secrets, simulateurs, comptes de test)' });
  }
  for (const x of violations) {
    if (cible === 'production') {
      sortie.push({ groupe: g, nom: `Valeur de développement (${x.code})`, etat: 'MANQUANT', motif: `${x.variables.join(', ')} : ${x.motif}`, action: x.action });
    } else {
      sortie.push({ groupe: g, nom: `Valeur de développement (${x.code})`, etat: 'NON_VERIFIE', motif: `${x.variables.join(', ')} : ${x.motif} — normal sur un poste local, REFUSÉ au démarrage en production`, action: x.action });
    }
  }
  return sortie;
}

// ───────────────────────────── Espace disque, sauvegardes ─────────────────────────────

export interface SeuilsDisque {
  libreMinOctets: number;
  libreMinPourcent: number;
}

/** Évalue un volume à partir de `df -Pk` : MANQUANT sous l'un des deux seuils. */
export function controlerVolume(nom: string, groupe: string, libreOctets: number, totalOctets: number, s: SeuilsDisque, action: string): Controle {
  const pct = totalOctets > 0 ? (libreOctets / totalOctets) * 100 : 0;
  const go = (o: number) => `${(o / 2 ** 30).toFixed(1).replace('.', ',')} Go`;
  const motif = `${go(libreOctets)} libres sur ${go(totalOctets)} (${pct.toFixed(0)} %) ; seuils : ${go(s.libreMinOctets)} et ${s.libreMinPourcent} %`;
  if (libreOctets < s.libreMinOctets || pct < s.libreMinPourcent) return { groupe, nom, etat: 'MANQUANT', motif, action };
  return { groupe, nom, etat: 'PRET', motif };
}

/** Analyse d'une sortie `df -Pk <chemin>` (deuxième ligne : total et disponible en Kio). */
export function lireDfPk(sortie: string): { totalOctets: number; libreOctets: number } | null {
  const ligne = sortie.trim().split('\n')[1];
  if (!ligne) return null;
  const c = ligne.trim().split(/\s+/);
  const total = Number(c[1]);
  const libre = Number(c[3]);
  if (!Number.isFinite(total) || !Number.isFinite(libre)) return null;
  return { totalOctets: total * 1024, libreOctets: libre * 1024 };
}

/** Analyse de /proc/meminfo : mémoire totale et disponible, en octets (null si illisible). */
export function lireMeminfo(texte: string): { totalOctets: number; disponibleOctets: number } | null {
  const lire = (cle: string) => {
    const m = new RegExp(`^${cle}:\\s+(\\d+) kB`, 'm').exec(texte);
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = lire('MemTotal');
  const dispo = lire('MemAvailable');
  return total === null || dispo === null ? null : { totalOctets: total, disponibleOctets: dispo };
}

/** Mémoire : MANQUANT sous le plancher d'octets disponibles ou de pourcentage. */
export function controlerMemoire(nom: string, groupe: string, disponibleOctets: number, totalOctets: number, minOctets: number, minPourcent: number, action: string): Controle {
  const pct = totalOctets > 0 ? (disponibleOctets / totalOctets) * 100 : 0;
  const mo = (o: number) => `${Math.round(o / 2 ** 20)} Mo`;
  const motif = `${mo(disponibleOctets)} disponibles sur ${mo(totalOctets)} (${pct.toFixed(0)} %) ; planchers : ${mo(minOctets)} et ${minPourcent} %`;
  return disponibleOctets < minOctets || pct < minPourcent ? { groupe, nom, etat: 'MANQUANT', motif, action } : { groupe, nom, etat: 'PRET', motif };
}

/** Certificat : MANQUANT s'il est expiré ou expire dans moins de `joursMin` jours. `finValidite` : date de fin (texte lisible par Date). */
export function controlerCertificat(nom: string, finValidite: string, maintenantMs: number, joursMin: number, action: string): Controle {
  const fin = Date.parse(finValidite);
  const groupe = 'Certificats';
  if (!Number.isFinite(fin)) return { groupe, nom, etat: 'NON_VERIFIE', motif: 'date de fin de validité illisible', action };
  const jours = (fin - maintenantMs) / 86_400_000;
  const quand = new Date(fin).toISOString().slice(0, 10);
  if (jours <= 0) return { groupe, nom, etat: 'MANQUANT', motif: `EXPIRÉ depuis le ${quand}`, action };
  if (jours < joursMin) return { groupe, nom, etat: 'MANQUANT', motif: `expire le ${quand}, dans ${jours.toFixed(0)} jour(s) (plancher ${joursMin})`, action };
  return { groupe, nom, etat: 'PRET', motif: `valable jusqu'au ${quand} (${jours.toFixed(0)} jours ; plancher ${joursMin})` };
}

export interface GroupeJeu {
  id: string;
  /** Instant de création, ms. */
  crealeMs: number;
  complet: boolean;
  interrompu: boolean;
  chiffre: boolean;
}

export interface ParametresSauvegarde {
  maintenantMs: number;
  ageMaxHeures: number;
  /** Une clé publique de chiffrement est désignée dans la configuration. */
  clePubliqueConfiguree: boolean;
  /** Résultat de la vérification d'empreintes du dernier jeu complet (null = non faite). */
  integrite: { conforme: boolean; ecarts: string[] } | null;
}

/** Contrôles du dernier jeu de sauvegarde : présence, âge, intégrité, chiffrement, sauvegarde interrompue. */
export function controlerSauvegardes(groupes: GroupeJeu[], p: ParametresSauvegarde): Controle[] {
  const g = 'Sauvegardes';
  const sortie: Controle[] = [];
  const complets = groupes.filter((x) => x.complet).sort((a, b) => b.crealeMs - a.crealeMs);
  const dernier = complets[0];
  if (!dernier) {
    sortie.push({ groupe: g, nom: 'Dernier jeu complet', etat: 'MANQUANT', motif: 'aucun jeu complet (base + objets + Keycloak + descripteur)', action: 'Lancer scripts/sauvegarder.sh (local) ou la sauvegarde logique de production (docs/exploitation.md § 4).' });
    return sortie;
  }
  const ageH = (p.maintenantMs - dernier.crealeMs) / 3_600_000;
  const duree = ageH >= 48 ? `${(ageH / 24).toFixed(1).replace('.', ',')} jours` : `${ageH.toFixed(1).replace('.', ',')} h`;
  sortie.push({ groupe: g, nom: 'Dernier jeu complet', etat: 'PRET', motif: `${dernier.id}` });
  sortie.push(
    ageH <= p.ageMaxHeures
      ? { groupe: g, nom: 'Âge de la dernière sauvegarde', etat: 'PRET', motif: `${duree} (maximum ${p.ageMaxHeures} h)` }
      : { groupe: g, nom: 'Âge de la dernière sauvegarde', etat: 'MANQUANT', motif: `${duree}, au-delà de ${p.ageMaxHeures} h`, action: 'Refaire une sauvegarde ; planifier la sauvegarde quotidienne (aucun ordonnanceur n’existe à ce jour).' },
  );
  sortie.push(
    p.integrite === null
      ? { groupe: g, nom: 'Intégrité du dernier jeu', etat: 'NON_VERIFIE', motif: 'vérification des empreintes non faite', action: 'Relancer sans --sans-empreintes.' }
      : p.integrite.conforme
        ? { groupe: g, nom: 'Intégrité du dernier jeu', etat: 'PRET', motif: 'empreintes SHA-256 de la base, du manifeste des objets et de l’export Keycloak conformes au descripteur' }
        : { groupe: g, nom: 'Intégrité du dernier jeu', etat: 'MANQUANT', motif: p.integrite.ecarts.join(' ; '), action: 'Ne pas s’appuyer sur ce jeu ; refaire une sauvegarde.' },
  );
  sortie.push(
    dernier.chiffre
      ? { groupe: g, nom: 'Chiffrement', etat: 'PRET', motif: 'copie chiffrée du dernier jeu présente' }
      : p.clePubliqueConfiguree
        ? { groupe: g, nom: 'Chiffrement', etat: 'NON_VERIFIE', motif: 'clé publique désignée (SAUVEGARDE_CLE_PUBLIQUE) mais pas de copie chiffrée de ce jeu', action: 'Relancer scripts/sauvegarder.sh avec la clé publique, ou node scripts/chiffrer-sauvegardes.mjs copie-chiffree.' }
        : { groupe: g, nom: 'Chiffrement', etat: 'MANQUANT', motif: 'sauvegardes EN CLAIR : aucune clé publique désignée', action: 'Décider la garde de la clé privée (D-050), générer la paire (chiffrer-sauvegardes.mjs generer-cles), désigner SAUVEGARDE_CLE_PUBLIQUE.' },
  );
  const interrompues = groupes.filter((x) => x.interrompu);
  const recentes = interrompues.filter((x) => x.crealeMs > dernier.crealeMs);
  if (recentes.length) {
    sortie.push({ groupe: g, nom: 'Sauvegarde interrompue', etat: 'MANQUANT', motif: `${recentes.map((x) => x.id).join(', ')} : plus récente que le dernier jeu complet`, action: 'Examiner puis refaire la sauvegarde ; un jeu sans descripteur n’est pas restaurable comme un tout.' });
  } else {
    sortie.push({ groupe: g, nom: 'Sauvegarde interrompue', etat: 'PRET', motif: interrompues.length ? `${interrompues.length} marqueur(s) ancien(s) (${interrompues.map((x) => x.id).join(', ')}), antérieur(s) au dernier jeu complet ; à examiner, jamais supprimé automatiquement` : 'aucune' });
  }
  return sortie;
}

/** Synthèse : code de sortie non nul dès qu'un contrôle est MANQUANT. */
export function synthese(controles: Controle[]): { pret: number; manquant: number; nonVerifie: number; codeSortie: number } {
  const n = (e: EtatControle) => controles.filter((c) => c.etat === e).length;
  return { pret: n('PRET'), manquant: n('MANQUANT'), nonVerifie: n('NON_VERIFIE'), codeSortie: n('MANQUANT') > 0 ? 1 : 0 };
}

const LIBELLE: Record<EtatControle, string> = { PRET: 'PRÊT       ', MANQUANT: 'MANQUANT   ', NON_VERIFIE: 'NON VÉRIFIÉ' };

/** Rendu lisible : un contrôle par ligne, motif, action corrective sous les lignes non prêtes. */
export function rendre(controles: Controle[]): string {
  const lignes: string[] = [];
  let groupe = '';
  for (const c of controles) {
    if (c.groupe !== groupe) {
      groupe = c.groupe;
      lignes.push('', `== ${groupe} ==`);
    }
    lignes.push(`[${LIBELLE[c.etat]}] ${c.nom} — ${c.motif}`);
    if (c.action && c.etat !== 'PRET') lignes.push(`               → ${c.action}`);
  }
  const s = synthese(controles);
  lignes.push('', `Synthèse : ${s.pret} prêt, ${s.manquant} manquant, ${s.nonVerifie} non vérifié.`);
  lignes.push(s.manquant ? 'Résultat : NON PRÊT (au moins un contrôle manquant). Ce diagnostic ne vaut pas autorisation de mise en production (V9).' : 'Résultat : aucun contrôle manquant. Ce diagnostic ne vaut pas autorisation de mise en production (V9) ; les contrôles « non vérifié » restent à traiter.');
  return lignes.join('\n');
}
