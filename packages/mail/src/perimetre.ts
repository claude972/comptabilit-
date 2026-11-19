/**
 * Périmètre d'une connexion : ce que le JETON permet (permissions OAuth) et ce que le LOGICIEL
 * choisit de lire (filtres). Les deux listes sont toujours séparées : un filtre n'est jamais
 * présenté comme une restriction technique du jeton.
 */
import { clesSurveillees, resoudreDateDebut } from './configuration.js';
import { SCOPE_GMAIL_LECTURE, SCOPE_MS_LECTURE, SCOPE_MS_LECTURE_PARTAGEE } from './oauth.js';
import type { EtatConnexion } from './types.js';

export interface PermissionOAuth {
  scope: string;
  /** Ce que le jeton permet techniquement. */
  portee: string;
}

export interface FiltreLogiciel {
  type: 'dossiers' | 'expediteurs' | 'objet' | 'piece_jointe' | 'date_debut' | 'taille_max';
  libelle: string;
}

export interface Perimetre {
  permissionsOAuth: PermissionOAuth[];
  filtresLogiciel: FiltreLogiciel[];
  /** Texte explicite à afficher tel quel dans l'interface. */
  texte: string;
}

const PORTEES: Record<string, string> = {
  [SCOPE_GMAIL_LECTURE.toLowerCase()]:
    'Lecture de TOUS les messages, pièces jointes, libellés et paramètres de la boîte Gmail. Aucun envoi, aucune modification, aucune suppression.',
  [SCOPE_MS_LECTURE.toLowerCase()]:
    'Lecture de TOUS les messages et pièces jointes de la boîte de l’utilisateur connecté. Aucun envoi, aucune modification, aucune suppression.',
  [SCOPE_MS_LECTURE_PARTAGEE.toLowerCase()]:
    'Lecture de TOUS les messages des boîtes et dossiers partagés auxquels l’utilisateur connecté a accès (et de sa propre boîte). Aucun envoi, aucune modification, aucune suppression.',
  openid: 'Identification de l’utilisateur (aucun accès aux messages).',
  profile: 'Lecture du profil de base de l’utilisateur : nom, identifiant de connexion (aucun accès aux messages).',
  offline_access: 'Maintien de l’accès dans le temps (jeton de rafraîchissement), sans élargir les données accessibles.',
};

export function decrirePerimetre(connexion: EtatConnexion): Perimetre {
  const config = connexion.configuration;
  const permissionsOAuth = connexion.scopesAccordes.map((scope) => ({
    scope,
    portee: PORTEES[scope.toLowerCase()] ?? 'Permission non reconnue par Comtaple : à vérifier auprès du fournisseur.',
  }));

  const nomPortee = config.fournisseur === 'gmail' ? 'Libellés' : 'Dossiers';
  const filtresLogiciel: FiltreLogiciel[] = [
    { type: 'dossiers', libelle: `${nomPortee} surveillés : ${clesSurveillees(config).join(', ')}` },
    {
      type: 'date_debut',
      libelle: `Messages reçus à partir du ${resoudreDateDebut(config, new Date(connexion.connecteeLe)).toISOString().slice(0, 10)}`,
    },
    {
      type: 'taille_max',
      libelle: `Pièces jointes de ${Math.round(config.tailleMaxPieceJointeOctets / (1024 * 1024))} Mo au plus`,
    },
  ];
  if (config.filtres.expediteursAutorises.length > 0) {
    filtresLogiciel.push({ type: 'expediteurs', libelle: `Expéditeurs autorisés : ${config.filtres.expediteursAutorises.join(', ')}` });
  }
  if (config.filtres.objetContient.length > 0) {
    filtresLogiciel.push({ type: 'objet', libelle: `Objet contenant : ${config.filtres.objetContient.join(' ou ')}` });
  }
  if (config.filtres.avecPieceJointeUniquement) {
    filtresLogiciel.push({ type: 'piece_jointe', libelle: 'Uniquement les messages avec pièce jointe' });
  }

  const texte = [
    'Ce que l’autorisation accordée permet techniquement :',
    ...(permissionsOAuth.length > 0 ? permissionsOAuth.map((p) => `• ${p.scope} — ${p.portee}`) : ['• aucune permission enregistrée']),
    '',
    'Ce que Comtaple lit réellement (filtres du logiciel) :',
    ...filtresLogiciel.map((f) => `• ${f.libelle}`),
    '',
    'Important : ces filtres sont appliqués par Comtaple. Ils ne réduisent pas l’autorisation accordée : ' +
      'techniquement, le jeton donne accès en lecture à l’ensemble de la boîte. ' +
      'Seul le retrait de l’autorisation chez le fournisseur supprime cet accès.',
  ].join('\n');

  return { permissionsOAuth, filtresLogiciel, texte };
}
