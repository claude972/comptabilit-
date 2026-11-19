/**
 * Filtres fonctionnels et rattachement à un dossier comptable.
 * Uniquement des identifiants et des règles explicites : aucune IA, aucune interprétation du contenu.
 * L'objet et le corps du message ne participent JAMAIS au rattachement.
 */
import type { ConfigurationConnexion } from './configuration.js';
import type { MessageBrut, Rattachement } from './types.js';

function correspond(adresse: string, adresseOuDomaine: string): boolean {
  const a = adresse.toLowerCase();
  return adresseOuDomaine.includes('@') ? a === adresseOuDomaine : a.endsWith(`@${adresseOuDomaine}`);
}

const sansAccents = (texte: string): string => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export type MotifFiltre = 'expediteur_non_autorise' | 'objet_hors_critere' | 'sans_piece_jointe';

/** Applique les filtres du logiciel. `null` = le message est retenu. */
export function filtrerMessage(message: MessageBrut, configuration: ConfigurationConnexion): MotifFiltre | null {
  const f = configuration.filtres;
  if (f.expediteursAutorises.length > 0 && !f.expediteursAutorises.some((e) => correspond(message.expediteur, e))) {
    return 'expediteur_non_autorise';
  }
  if (f.objetContient.length > 0) {
    const objet = sansAccents(message.objet);
    if (!f.objetContient.some((terme) => objet.includes(sansAccents(terme)))) return 'objet_hors_critere';
  }
  if (f.avecPieceJointeUniquement && message.piecesJointes.length === 0) return 'sans_piece_jointe';
  return null;
}

/**
 * Rattache un message à un dossier comptable.
 * - une seule cible désignée par les règles → `rattache` ;
 * - plusieurs cibles → `a_qualifier` (ambigu) ;
 * - aucune règle : dossier par défaut explicite s'il existe, sinon `a_qualifier`.
 */
export function rattacher(message: MessageBrut, configuration: ConfigurationConnexion): Rattachement {
  const cibles = new Map<string, string[]>();
  configuration.rattachement.regles.forEach((regle, indice) => {
    const applicable =
      regle.type === 'expediteur'
        ? correspond(message.expediteur, regle.valeur)
        : message.destinataires.some((d) => d.toLowerCase() === regle.valeur);
    if (!applicable) return;
    const libelle = `regle_${indice + 1}:${regle.type}`;
    cibles.set(regle.dossierComptable, [...(cibles.get(regle.dossierComptable) ?? []), libelle]);
  });
  if (cibles.size === 1) {
    const [[dossierComptable, regles]] = [...cibles.entries()] as [[string, string[]]];
    return { statut: 'rattache', dossierComptable, regles };
  }
  if (cibles.size > 1) {
    return {
      statut: 'a_qualifier',
      raisons: ['plusieurs_dossiers_possibles', ...[...cibles.values()].flat()],
      candidats: [...cibles.keys()],
    };
  }
  const defaut = configuration.rattachement.dossierParDefaut;
  if (defaut !== undefined) return { statut: 'rattache', dossierComptable: defaut, regles: ['dossier_par_defaut'] };
  return { statut: 'a_qualifier', raisons: ['aucune_regle_applicable'], candidats: [] };
}
