/**
 * Collecte par mail : types des réponses de `apps/api/src/mail.controller.ts` et logique pure de l'interface
 * (formulaire de configuration, libellés, codes de retour OAuth). Expéditeurs, objets, extraits et noms de fichiers
 * viennent des messages : contenus non fiables, toujours rendus comme du texte.
 */
export type Fournisseur = 'gmail' | 'microsoft';
export type StatutConnexionMail = 'active' | 'expire' | 'revoque' | 'supprimee' | 'erreur' | 'non_connecte' | 'connecte';

export interface RegleRattachement {
  type: 'expediteur' | 'destinataire';
  valeur: string;
  dossierComptable: string;
}
export interface ConfigurationMail {
  fournisseur: Fournisseur;
  boite: { type: 'personnelle' } | { type: 'partagee'; adresse: string };
  dossiers: string[];
  filtres: { expediteursAutorises: string[]; objetContient: string[]; avecPieceJointeUniquement: boolean };
  rattachement: { dossiersComptables: string[]; dossierParDefaut?: string; regles: RegleRattachement[] };
  dateDebut?: string;
  tailleMaxPieceJointeOctets: number;
}
export interface ConnexionMail {
  id: string;
  fournisseur: Fournisseur;
  adresse: string;
  statut: StatutConnexionMail;
  motifStatut: string | null;
  creeLe: string;
  derniereSynchro: string | null;
  derniereIssue: string | null;
  surveillance: { mode: string; echeance: string | null; raison: string | null } | null;
  configuration: ConfigurationMail;
  permissionsAccordees: Array<{ scope: string; portee: string }>;
  filtresFonctionnels: Array<{ type: string; libelle: string }>;
  textePerimetre: string;
}
export interface EtatConnecteur {
  configure: boolean;
  detail: string;
}
export interface ListeConnexionsMail {
  connecteurs: Record<Fournisseur, EtatConnecteur>;
  connexions: ConnexionMail[];
}
export interface Integrations {
  messagerie: { gmail: { statut: string; detail: string }; microsoft365: { statut: string; detail: string } };
}
export interface SuiviConnexion {
  connexion: ConnexionMail;
  imports: Record<string, number>;
  pieces: Array<{ nomFichier: string; issue: string; documentId: string | null; idMessage: string; recueLe: string }>;
  signalements: Array<{ id: string; type: string; idMessage: string; detail: { domaines?: unknown; nomFichier?: unknown; motif?: unknown } | null; creeLe: string }>;
  erreur: { statut: string; motif: string | null } | null;
  evenements: Array<{ action: string; details: unknown; creeLe: string }>;
}
export interface PieceAQualifier {
  id: string;
  connexionId: string;
  nomFichier: string;
  provenance: { fournisseur?: string; expediteur?: string; dateReception?: string; nomFichier?: string } | null;
  raisons: string[];
  candidats: string[];
  extraitNonFiable: { expediteur?: string; destinataires?: string[]; objet?: string; dateReception?: string; extrait?: string } | null;
  statut: 'en_attente' | 'affectee';
  dossierAffecteId: string | null;
  documentId: string | null;
  recueLe: string;
}
export interface ResultatDeconnexion {
  statut: 'supprimee';
  jetonsSupprimes: boolean;
  revoqueChezFournisseur: boolean;
  actionsRestantes: string[];
}

export const LIBELLE_FOURNISSEUR: Record<Fournisseur, string> = { gmail: 'Gmail', microsoft: 'Microsoft 365' };
export const LIBELLE_STATUT_CONNEXION: Record<string, string> = {
  active: 'Active',
  expire: 'Expirée — à reconnecter',
  revoque: 'Révoquée — à reconnecter',
  supprimee: 'Déconnectée',
  erreur: 'En erreur',
  non_connecte: 'Non connectée',
  connecte: 'Connectée',
};
export const LIBELLE_ISSUE_SYNCHRO: Record<string, string> = {
  terminee: 'terminée',
  interrompue: 'interrompue (erreur passagère, sera relancée)',
  arretee: 'arrêtée (connexion expirée ou révoquée)',
  ignoree: 'non tentée (connexion inactive)',
  consentement_requis: 'impossible : un nouveau consentement est nécessaire',
};
export const LIBELLE_ISSUE_PIECE: Record<string, string> = {
  document: 'Importée dans un dossier',
  doublon_binaire: 'Déjà reçue (fichier identique)',
  a_qualifier: 'À qualifier',
  en_cours: 'En cours',
};
const MOTIF_PIECE_IGNOREE: Record<string, string> = { archive: 'archive', executable: 'fichier exécutable', trop_volumineuse: 'pièce trop volumineuse' };

/** Jours récupérés avant la connexion quand aucune date de début n'est choisie (valeur par défaut de l'API). */
export const JOURS_PAR_DEFAUT = 30;
const MO = 1024 * 1024;
export const TAILLE_MAX_MO = 150;

/** Date (AAAA-MM-JJ, UTC) située `JOURS_PAR_DEFAUT` jours avant l'instant donné. */
export function dateDebutParDefaut(reference: Date | string): string {
  const t = new Date(reference).getTime();
  return Number.isNaN(t) ? '' : new Date(t - JOURS_PAR_DEFAUT * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Raison d'ambiguïté renvoyée par l'API → phrase lisible. Une raison inconnue est rendue telle quelle. */
export function libelleRaison(raison: string): string {
  if (raison === 'aucune_regle_applicable') return 'Aucune règle de rattachement ne correspond à ce message.';
  if (raison === 'plusieurs_dossiers_possibles') return 'Plusieurs dossiers sont possibles pour ce message.';
  if (raison === 'dossier_introuvable') return 'Le dossier désigné par la règle n’existe plus.';
  const m = /^regle_(\d+):(expediteur|destinataire)$/.exec(raison);
  if (m) return `La règle n° ${m[1]} (${m[2] === 'expediteur' ? 'expéditeur' : 'adresse de destination'}) s’applique.`;
  return raison;
}

const DOMAINE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
/** Signalement → texte. Pour une facture derrière un lien, seuls des noms de domaine sont affichés (jamais l'adresse du lien). */
export function decrireSignalement(s: { type: string; detail: SuiviConnexion['signalements'][number]['detail'] }): { titre: string; precision: string } {
  if (s.type === 'facture_derriere_lien') {
    const domaines = Array.isArray(s.detail?.domaines) ? s.detail.domaines.filter((d): d is string => typeof d === 'string' && DOMAINE.test(d)).slice(0, 10) : [];
    return {
      titre: 'Facture disponible derrière un lien',
      precision: `${domaines.length ? `Domaine${domaines.length > 1 ? 's' : ''} : ${domaines.join(', ')}. ` : ''}Le lien n’a pas été suivi : la facture est à récupérer manuellement.`,
    };
  }
  if (s.type === 'piece_ignoree') {
    const motif = typeof s.detail?.motif === 'string' ? (MOTIF_PIECE_IGNOREE[s.detail.motif] ?? s.detail.motif) : 'motif non précisé';
    return { titre: 'Pièce jointe ignorée', precision: `${typeof s.detail?.nomFichier === 'string' ? `${s.detail.nomFichier} — ` : ''}${motif}.` };
  }
  return { titre: s.type, precision: '' };
}

// ───────────── Formulaire de configuration ─────────────
export interface FormulaireConfiguration {
  dossiers: string;
  expediteurs: string;
  objets: string;
  avecPieceJointe: boolean;
  dossiersComptables: string[];
  dossierParDefaut: string;
  regles: RegleRattachement[];
  dateDebut: string;
  tailleMaxMo: string;
}

export function formulaireDepuis(c: ConfigurationMail, connecteeLe: string): FormulaireConfiguration {
  return {
    dossiers: c.dossiers.join('\n'),
    expediteurs: c.filtres.expediteursAutorises.join('\n'),
    objets: c.filtres.objetContient.join('\n'),
    avecPieceJointe: c.filtres.avecPieceJointeUniquement,
    dossiersComptables: [...c.rattachement.dossiersComptables],
    dossierParDefaut: c.rattachement.dossierParDefaut ?? '',
    regles: c.rattachement.regles.map((r) => ({ ...r })),
    // Sans date choisie, l'API retient 30 jours avant la connexion : c'est cette date qui est proposée.
    dateDebut: c.dateDebut ? c.dateDebut.slice(0, 10) : dateDebutParDefaut(connecteeLe),
    tailleMaxMo: String(Math.max(1, Math.round(c.tailleMaxPieceJointeOctets / MO))),
  };
}

/** Une valeur par ligne (ou séparées par des virgules ou points-virgules), sans doublon ni ligne vide. */
export function lignes(texte: string): string[] {
  return [...new Set(texte.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean))];
}

const ADRESSE = /^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ADRESSE_OU_DOMAINE = /^@?(?:[^\s@<>,;]+@)?[a-z0-9.-]+\.[a-z]{2,}$/;

export type CorpsConfiguration = Omit<ConfigurationMail, 'fournisseur' | 'boite'>;

/**
 * Formulaire → corps de `PUT v1/mail/connexions/:id/configuration`. Mêmes contraintes que le schéma de l'API
 * (qui reste seule juge) : les erreurs détectées ici évitent un aller-retour inutile.
 */
export function corpsDepuis(f: FormulaireConfiguration): { ok: true; corps: CorpsConfiguration } | { ok: false; erreurs: string[] } {
  const erreurs: string[] = [];
  const expediteurs = lignes(f.expediteurs).map((v) => v.toLowerCase());
  for (const e of expediteurs) if (!ADRESSE_OU_DOMAINE.test(e)) erreurs.push(`Expéditeur autorisé invalide : « ${e} » (adresse ou domaine attendu).`);
  if (f.dossiersComptables.length === 0) erreurs.push('Sélectionnez au moins un dossier comptable destinataire.');
  const connus = new Set(f.dossiersComptables);
  if (f.dossierParDefaut && !connus.has(f.dossierParDefaut)) erreurs.push('Le dossier par défaut doit faire partie des dossiers destinataires.');
  const regles = f.regles.map((r) => ({ type: r.type, valeur: r.valeur.trim().toLowerCase(), dossierComptable: r.dossierComptable }));
  regles.forEach((r, i) => {
    if (!(r.type === 'expediteur' ? ADRESSE_OU_DOMAINE : ADRESSE).test(r.valeur)) {
      erreurs.push(`Règle n° ${i + 1} : ${r.type === 'expediteur' ? 'adresse ou domaine d’expéditeur' : 'adresse de destination'} invalide.`);
    }
    if (!connus.has(r.dossierComptable)) erreurs.push(`Règle n° ${i + 1} : choisissez un dossier parmi les dossiers destinataires.`);
  });
  if (f.dateDebut && !/^\d{4}-\d{2}-\d{2}$/.test(f.dateDebut)) erreurs.push('Date de début invalide.');
  const taille = /^\d{1,3}$/.test(f.tailleMaxMo.trim()) ? Number(f.tailleMaxMo.trim()) : 0;
  if (taille < 1 || taille > TAILLE_MAX_MO) erreurs.push(`Taille maximale : un nombre entier de 1 à ${TAILLE_MAX_MO} Mo.`);
  if (erreurs.length) return { ok: false, erreurs };
  return {
    ok: true,
    corps: {
      dossiers: lignes(f.dossiers),
      filtres: { expediteursAutorises: expediteurs, objetContient: lignes(f.objets), avecPieceJointeUniquement: f.avecPieceJointe },
      rattachement: { dossiersComptables: [...f.dossiersComptables], ...(f.dossierParDefaut ? { dossierParDefaut: f.dossierParDefaut } : {}), regles },
      ...(f.dateDebut ? { dateDebut: `${f.dateDebut}T00:00:00Z` } : {}),
      tailleMaxPieceJointeOctets: taille * MO,
    },
  };
}

// ───────────── Retour OAuth ─────────────
export type CodeRetour =
  | 'retour_incomplet'
  | 'consentement_refuse'
  | 'state_invalide'
  | 'permission_non_accordee'
  | 'connecteur_non_configure'
  | 'fournisseur_indisponible'
  | 'reserve_gestionnaires'
  | 'echec';

/** Réponse d'erreur de `POST v1/mail/retour` → code d'affichage (jamais le code d'autorisation ni le state). */
export function codeRetour(statut: number, corps: unknown): CodeRetour {
  const code = typeof (corps as { code?: unknown } | null)?.code === 'string' ? (corps as { code: string }).code : '';
  if (statut === 503) return code === 'connecteur_non_configure' ? 'connecteur_non_configure' : 'fournisseur_indisponible';
  if (statut === 403) return 'reserve_gestionnaires';
  if (statut === 400) {
    if (code.startsWith('refus_fournisseur')) return 'consentement_refuse';
    if (['state_invalide', 'state_autre_session', 'demande_expiree', 'demande_inconnue'].includes(code)) return 'state_invalide';
    if (code === 'scope_refuse') return 'permission_non_accordee';
  }
  return 'echec';
}

export const MESSAGE_RETOUR: Record<CodeRetour, string> = {
  retour_incomplet: 'Le retour du fournisseur de messagerie est incomplet : aucune boîte n’a été connectée. Recommencez la connexion.',
  consentement_refuse: 'L’autorisation a été refusée chez le fournisseur : aucune boîte n’a été connectée et aucun jeton n’a été enregistré.',
  state_invalide:
    'La demande d’autorisation est inconnue, expirée, déjà utilisée, ou a été lancée par un autre utilisateur : rien n’a été échangé avec le fournisseur. Recommencez la connexion depuis cet écran.',
  permission_non_accordee: 'La lecture de la messagerie n’a pas été accordée chez le fournisseur : la boîte n’a pas été connectée.',
  connecteur_non_configure: 'Le connecteur de messagerie n’est pas configuré sur cette installation : aucune connexion n’est possible.',
  fournisseur_indisponible: 'Le fournisseur de messagerie est momentanément indisponible. Recommencez la connexion dans quelques minutes.',
  reserve_gestionnaires: 'La connexion d’une boîte est réservée aux gestionnaires du cabinet (administrateur, associé).',
  echec: 'La connexion de la boîte n’a pas abouti. Recommencez ; si l’échec persiste, signalez-le.',
};
export function messageRetour(code: string | undefined): string | null {
  return code && Object.hasOwn(MESSAGE_RETOUR, code) ? MESSAGE_RETOUR[code as CodeRetour] : null;
}

export function estGestionnaire(role: string): boolean {
  return role === 'administrateur' || role === 'associe';
}
