/**
 * Configuration fonctionnelle d'une connexion (schéma Zod).
 * Ces réglages sont des FILTRES DU LOGICIEL : ils ne restreignent pas ce que le jeton OAuth permet.
 */
import { z } from 'zod';

const MO = 1024 * 1024;
export const JOURS_PAR_DEFAUT_AVANT_CONNEXION = 30;
export const TAILLE_MAX_PIECE_PAR_DEFAUT = 25 * MO;

const adresse = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/, 'Adresse de messagerie invalide.');

/** Adresse complète (`compta@exemple.fr`) ou domaine (`exemple.fr`, `@exemple.fr`). */
const adresseOuDomaine = z
  .string()
  .trim()
  .toLowerCase()
  .transform((valeur) => (valeur.startsWith('@') ? valeur.slice(1) : valeur))
  .refine((valeur) => /^(?:[^\s@<>,;]+@)?[a-z0-9.-]+\.[a-z]{2,}$/.test(valeur), 'Adresse ou domaine invalide.');

const identifiant = z.string().trim().min(1).max(256);

const regle = z.discriminatedUnion('type', [
  /** L'expéditeur (adresse ou domaine) désigne un dossier comptable. */
  z.object({ type: z.literal('expediteur'), valeur: adresseOuDomaine, dossierComptable: identifiant }),
  /** L'adresse de destination (alias, adresse dédiée) désigne un dossier comptable. */
  z.object({ type: z.literal('destinataire'), valeur: adresse, dossierComptable: identifiant }),
]);

export const schemaConfigurationConnexion = z
  .object({
    fournisseur: z.enum(['gmail', 'microsoft']),
    /** Boîte lue. `partagee` : boîte partagée Microsoft 365 (exige le scope Mail.Read.Shared). */
    boite: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('personnelle') }),
        z.object({ type: z.literal('partagee'), adresse }),
      ])
      .prefault({ type: 'personnelle' }),
    /** Libellés Gmail (identifiants) ou dossiers Microsoft (identifiant ou nom connu). Vide = boîte de réception. */
    dossiers: z.array(identifiant).max(50).prefault([]),
    filtres: z
      .object({
        /** Liste d'autorisation d'expéditeurs. Vide = tous les expéditeurs. */
        expediteursAutorises: z.array(adresseOuDomaine).max(1000).prefault([]),
        /** L'objet doit contenir au moins un de ces termes (insensible à la casse et aux accents). Vide = pas de critère. */
        objetContient: z.array(z.string().trim().min(1).max(200)).max(50).prefault([]),
        /** N'examiner que les messages portant au moins une pièce jointe. */
        avecPieceJointeUniquement: z.boolean().prefault(false),
      })
      .prefault({}),
    rattachement: z.object({
      dossiersComptables: z.array(identifiant).min(1).max(5000),
      /** Dossier explicite appliqué quand aucune règle ne correspond. Absent = `a_qualifier`. */
      dossierParDefaut: identifiant.optional(),
      regles: z.array(regle).max(10000).prefault([]),
    }),
    /** Date ISO de début de récupération. Absente = 30 jours avant la connexion. */
    dateDebut: z.iso.datetime({ offset: true }).optional(),
    tailleMaxPieceJointeOctets: z
      .number()
      .int()
      .positive()
      .max(150 * MO)
      .prefault(TAILLE_MAX_PIECE_PAR_DEFAUT),
  })
  .superRefine((config, ctx) => {
    if (config.boite.type === 'partagee' && config.fournisseur !== 'microsoft') {
      ctx.addIssue({ code: 'custom', path: ['boite'], message: 'Les boîtes partagées ne concernent que Microsoft 365.' });
    }
    const connus = new Set(config.rattachement.dossiersComptables);
    config.rattachement.regles.forEach((r, i) => {
      if (!connus.has(r.dossierComptable)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rattachement', 'regles', i, 'dossierComptable'],
          message: 'La règle vise un dossier comptable qui ne figure pas dans la liste des destinataires.',
        });
      }
    });
    const defaut = config.rattachement.dossierParDefaut;
    if (defaut !== undefined && !connus.has(defaut)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rattachement', 'dossierParDefaut'],
        message: 'Le dossier par défaut ne figure pas dans la liste des destinataires.',
      });
    }
  });

export type ConfigurationConnexion = z.output<typeof schemaConfigurationConnexion>;
export type ConfigurationConnexionEntree = z.input<typeof schemaConfigurationConnexion>;

/** Date de début effective : celle de la configuration, sinon 30 jours avant la connexion. */
export function resoudreDateDebut(configuration: ConfigurationConnexion, connecteeLe: Date): Date {
  if (configuration.dateDebut !== undefined) return new Date(configuration.dateDebut);
  return new Date(connecteeLe.getTime() - JOURS_PAR_DEFAUT_AVANT_CONNEXION * 24 * 3600 * 1000);
}

/** Portées surveillées : libellés Gmail ou dossiers Microsoft ; la boîte de réception par défaut. */
export function clesSurveillees(configuration: ConfigurationConnexion): string[] {
  if (configuration.dossiers.length > 0) return [...new Set(configuration.dossiers)];
  return [configuration.fournisseur === 'gmail' ? 'INBOX' : 'inbox'];
}
