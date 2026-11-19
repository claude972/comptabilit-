import type { Canal, Gravite, MethodeChamp, NatureDocument, Niveau, NomChamp, Role, StatutControle, StatutDocument, StatutDonnees, StatutLot, StatutRevue } from './types-api';

export const MENTION_PROJET = 'Projet — non validé';

export const LIBELLE_ROLE: Record<Role, string> = {
  administrateur: 'Administrateur du cabinet',
  associe: 'Associé',
  reviseur: 'Réviseur',
  collaborateur: 'Collaborateur',
  client_deposant: 'Client (dépôt de pièces)',
  client_lecture: 'Client (consultation)',
  support: 'Support',
};
export const LIBELLE_NIVEAU: Record<Niveau, string> = {
  depot: 'Dépôt',
  lecture: 'Lecture',
  collaboration: 'Collaboration',
  revision: 'Révision',
  validation: 'Validation',
};
export const LIBELLE_NATURE: Record<NatureDocument, string> = {
  facture_achat: 'Facture d’achat',
  facture_vente: 'Facture de vente',
  avoir: 'Avoir',
  releve_bancaire: 'Relevé bancaire',
  lettre_mission: 'Lettre de mission',
  contrat: 'Contrat',
  autre: 'Autre',
  a_qualifier: 'À qualifier',
};
/** Natures proposées au dépôt. « Je ne sais pas » correspond à `a_qualifier`. */
export const NATURES_DEPOT: ReadonlyArray<{ valeur: NatureDocument; libelle: string }> = [
  { valeur: 'facture_achat', libelle: 'Facture d’achat' },
  { valeur: 'facture_vente', libelle: 'Facture de vente' },
  { valeur: 'avoir', libelle: 'Avoir' },
  { valeur: 'autre', libelle: 'Autre' },
  { valeur: 'a_qualifier', libelle: 'Je ne sais pas' },
];
export const LIBELLE_STATUT_DOCUMENT: Record<StatutDocument, string> = {
  recu: 'Reçu',
  en_analyse: 'En analyse',
  a_completer: 'À compléter',
  a_controler: 'À contrôler',
  traite: 'Traité',
  quarantaine: 'En quarantaine',
  rejete: 'Rejeté',
  remplace: 'Remplacée',
};
/** Ordre d'urgence dans la file. Les versions remplacées, conservées pour mémoire, viennent en dernier. */
export const ORDRE_STATUTS_DOCUMENT: readonly StatutDocument[] = ['a_completer', 'a_controler', 'en_analyse', 'recu', 'quarantaine', 'rejete', 'traite', 'remplace'];
export const LIBELLE_CANAL: Record<Canal, string> = { telephone: 'Téléphone', ordinateur: 'Ordinateur', mail: 'Courriel', import_lot: 'Import par lot' };
export const LIBELLE_METHODE: Record<MethodeChamp, string> = {
  structure: 'Donnée structurée',
  regle: 'Règle',
  ia: 'Proposition IA',
  saisie_humaine: 'Saisie humaine',
};
export const LIBELLE_CHAMP: Record<NomChamp, string> = {
  typeDocument: 'Type de document',
  numero: 'Numéro',
  dateEmission: 'Date d’émission',
  dateEcheance: 'Date d’échéance',
  emetteurNom: 'Émetteur',
  emetteurSiren: 'SIREN de l’émetteur',
  emetteurSiret: 'SIRET de l’émetteur',
  emetteurTva: 'N° de TVA de l’émetteur',
  totalHt: 'Total HT',
  totalTva: 'Total TVA',
  totalTtc: 'Total TTC',
  devise: 'Devise',
};
export const CHAMPS_MONTANT: readonly NomChamp[] = ['totalHt', 'totalTva', 'totalTtc'];
export const CHAMPS_DATE: readonly NomChamp[] = ['dateEmission', 'dateEcheance'];

export const LIBELLE_STATUT_DONNEES: Record<StatutDonnees, string> = {
  travail_avant_cloture: 'Données de travail avant clôture',
  fec: 'FEC',
};
export const LIBELLE_STATUT_LOT: Record<StatutLot, string> = {
  en_attente: 'En attente',
  en_cours: 'En cours',
  termine: 'Terminé',
  termine_avec_erreurs: 'Terminé avec anomalies',
  echec: 'Échec',
  annule: 'Annulé',
};
/** Les cinq statuts d'un contrôle. « Non réalisé » n'est jamais présenté comme un succès. */
export const LIBELLE_STATUT_CONTROLE: Record<StatutControle, string> = {
  sans_anomalie: 'Exécuté sans anomalie détectée',
  constat: 'Constat à examiner',
  non_applicable: 'Non applicable',
  non_realise: 'Non réalisé faute de données',
  erreur: 'Erreur technique',
};
export const LIBELLE_GRAVITE: Record<Gravite, string> = { critique: 'Critique', elevee: 'Élevée', moyenne: 'Moyenne', faible: 'Faible' };
export const LIBELLE_STATUT_REVUE: Record<StatutRevue, string> = {
  a_examiner: 'À examiner',
  en_cours: 'En cours',
  piece_demandee: 'Pièce demandée',
  accepte: 'Accepté',
  corrige: 'Corrigé',
  rejete: 'Rejeté',
  anomalie_confirmee: 'Anomalie confirmée',
  cloture: 'Clôturé',
};
/** Actions de revue d'un constat, telles que définies par l'API (niveau minimal et motif obligatoire). */
export const ACTIONS_CONSTAT: ReadonlyArray<{ action: string; libelle: string; niveau: Niveau; motifRequis: boolean }> = [
  { action: 'prendre_en_charge', libelle: 'Prendre en charge', niveau: 'collaboration', motifRequis: false },
  { action: 'affecter', libelle: 'Affecter', niveau: 'collaboration', motifRequis: false },
  { action: 'commenter', libelle: 'Commenter', niveau: 'collaboration', motifRequis: true },
  { action: 'demander_piece', libelle: 'Demander une pièce', niveau: 'collaboration', motifRequis: true },
  { action: 'corriger', libelle: 'Marquer comme corrigé', niveau: 'collaboration', motifRequis: true },
  { action: 'accepter', libelle: 'Accepter', niveau: 'revision', motifRequis: true },
  { action: 'rejeter', libelle: 'Rejeter', niveau: 'revision', motifRequis: true },
  { action: 'confirmer_anomalie', libelle: 'Confirmer l’anomalie', niveau: 'revision', motifRequis: true },
  { action: 'cloturer', libelle: 'Clôturer', niveau: 'revision', motifRequis: true },
  { action: 'rouvrir', libelle: 'Rouvrir', niveau: 'revision', motifRequis: true },
];
export const LIBELLE_ACTION: Record<string, string> = {
  ...Object.fromEntries(ACTIONS_CONSTAT.map((a) => [a.action, a.libelle])),
  valider: 'Valider',
};
export const LIBELLE_CYCLE: Record<string, string> = {
  general: 'Général',
  tresorerie: 'Trésorerie',
  clients: 'Clients',
  fournisseurs: 'Fournisseurs',
  tva: 'TVA',
  immobilisations: 'Immobilisations',
  social: 'Social',
  capitaux_propres: 'Capitaux propres',
  cloture: 'Clôture',
};
export const LIBELLE_VERIFICATION_SOURCE: Record<string, string> = {
  verifiee: 'Source vérifiée',
  non_verifiee: 'Source non vérifiée',
  sans_objet: 'Sans objet (règle interne)',
};
