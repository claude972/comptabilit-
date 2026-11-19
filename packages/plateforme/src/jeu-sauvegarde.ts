/**
 * JEU DE SAUVEGARDE : la base, le manifeste des objets et l'export Keycloak produits ensemble, décrits par un fichier
 * « .jeu.json » écrit EN DERNIER. Un jeu sans ce fichier est une sauvegarde interrompue : il n'est pas restaurable comme
 * un tout. Le descripteur dit aussi ce qui est garanti et ce qui ne l'est pas (voir `coherence`).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const FORMAT_JEU = 'comtaple.jeu-sauvegarde/1';

export interface FichierDuJeu {
  role: 'base' | 'objets' | 'keycloak';
  nom: string;
  taille: number;
  sha256: string;
}
export interface JeuDeSauvegarde {
  format: typeof FORMAT_JEU;
  identifiant: string;
  cree: string;
  fichiers: FichierDuJeu[];
  /** Ce que la capture garantit, et ses limites : jamais présenté comme une atomicité complète. */
  coherence: {
    /** Instant de l'instantané de la base (pris pendant que Keycloak était figé). */
    instantaneBase: string;
    keycloakFigeDe: string;
    keycloakFigeA: string;
    /** Comptes de la base, à l'instant de l'instantané, et ceux retrouvés dans l'export Keycloak. */
    comptesBase: number;
    comptesBaseDansKeycloak: number;
    garanties: string[];
    limites: string[];
  };
}

export async function sha256Fichier(chemin: string): Promise<string> {
  const h = createHash('sha256');
  for await (const m of createReadStream(chemin)) h.update(m as Buffer);
  return h.digest('hex');
}

export interface VerificationJeu {
  conforme: boolean;
  identifiant: string | null;
  ecarts: string[];
}

/** Vérifie un jeu à partir de son descripteur : chaque fichier présent, de la bonne taille et de la bonne empreinte. */
export async function verifierJeu(cheminDescripteur: string): Promise<VerificationJeu> {
  const ecarts: string[] = [];
  let jeu: JeuDeSauvegarde;
  try {
    jeu = JSON.parse(readFileSync(cheminDescripteur, 'utf8')) as JeuDeSauvegarde;
  } catch {
    return { conforme: false, identifiant: null, ecarts: ['descripteur du jeu absent ou illisible : sauvegarde interrompue ou incomplète'] };
  }
  if (jeu.format !== FORMAT_JEU) return { conforme: false, identifiant: null, ecarts: [`format de jeu inconnu : ${String(jeu.format)}`] };
  if (basename(cheminDescripteur) !== `${jeu.identifiant}.jeu.json`) ecarts.push('le descripteur ne porte pas le nom de son jeu');
  for (const role of ['base', 'objets', 'keycloak'] as const) {
    const f = jeu.fichiers.filter((x) => x.role === role);
    if (f.length !== 1) ecarts.push(`le jeu doit contenir exactement un fichier « ${role} » (${f.length} trouvé(s))`);
  }
  for (const f of jeu.fichiers) {
    // Un fichier d'un autre jeu (autre identifiant) ne peut pas compléter celui-ci.
    if (!f.nom.startsWith(`${jeu.identifiant}.`) || f.nom.includes('/') || f.nom.includes('..')) {
      ecarts.push(`fichier étranger au jeu : ${f.nom}`);
      continue;
    }
    const chemin = join(dirname(cheminDescripteur), f.nom);
    if (!existsSync(chemin)) ecarts.push(`fichier manquant : ${f.nom}`);
    else if (statSync(chemin).size !== f.taille) ecarts.push(`taille différente : ${f.nom}`);
    else if ((await sha256Fichier(chemin)) !== f.sha256) ecarts.push(`empreinte différente : ${f.nom}`);
  }
  return { conforme: ecarts.length === 0, identifiant: jeu.identifiant, ecarts };
}

/** Jeux présents dans un dossier de sauvegardes : complets (descripteur présent) ou interrompus (base sans descripteur). */
export function listerJeux(dossier: string): Array<{ identifiant: string; etat: 'complet' | 'interrompu' | 'ancien_format' }> {
  if (!existsSync(dossier)) return [];
  const noms = readdirSync(dossier);
  return noms
    .filter((n) => n.endsWith('.dump'))
    .map((n) => n.slice(0, -'.dump'.length))
    .sort()
    .map((identifiant) => ({
      identifiant,
      // Avant l'introduction des jeux, une sauvegarde n'avait ni export Keycloak ni descripteur : ce n'est pas une interruption.
      etat: noms.includes(`${identifiant}.jeu.json`) ? ('complet' as const) : noms.includes(`${identifiant}.keycloak.json`) || noms.includes(`${identifiant}.en-cours`) ? ('interrompu' as const) : ('ancien_format' as const),
    }));
}
