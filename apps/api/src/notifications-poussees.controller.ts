import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PHRASES_POUSSEES, reduireAgentUtilisateur, SERVICES_NOTIFICATION, verifierPointAcces } from '@comtaple/core';
import { type AccesBd, journaliser, sql } from '@comtaple/db';
import { associeAbonnement, chiffrerAbonnement, clesAbonnementValides, empreintePointAcces, type EtatPoussees } from '@comtaple/plateforme';
import { type Acces, AccesCourant, exigerUuid } from './acces.js';
import { BD, POUSSEES } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

/** Ce que `PushSubscription.toJSON()` rend dans le navigateur, plus l'agent utilisateur (réduit côté serveur avant d'être conservé). */
const abonnement = z.object({
  endpoint: z.string().min(1).max(2000),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }),
  agentUtilisateur: z.string().max(600).optional(),
});
/** Renouvellement par le navigateur : le nouvel abonnement, et l'EMPREINTE (SHA-256) du point d'accès qu'il remplace — jamais l'ancienne adresse. */
const remplacement = abonnement.extend({ ancienneEmpreinte: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional() });
const preference = z.object({ active: z.boolean() });

interface LigneAppareil {
  id: string;
  service: string;
  agent: string;
  creeLe: string;
  dernierSuccesLe: string | null;
  empreinte: string;
}

const LIBELLES_SERVICE: Record<string, string> = { ...Object.fromEntries(SERVICES_NOTIFICATION.map((s) => [s.id, s.libelle])), simulateur: 'Simulateur de test (aucun service réel)' };
const NON_ACTIVE = 'Les notifications poussées ne sont pas activées sur ce service.';

/**
 * Notifications poussées DISCRÈTES. DÉSACTIVÉES par défaut : sans clés VAPID configurées par l'éditeur, le statut est
 * « non_configure » et aucune route n'accepte d'abonnement. L'envoi lui-même est fait par le worker, jamais ici.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('v1/notifications/poussees')
export class NotificationsPousseesController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(POUSSEES) private readonly poussees: EtatPoussees,
  ) {}

  private async appareils(acces: Acces): Promise<LigneAppareil[]> {
    return this.bd.avecContexte(acces, async (tx) => {
      // La politique de la base ne laisse voir que les abonnements de l'appelant ; le filtre explicite la double.
      const r = await tx.execute(sql`
        select id, service, agent, cree_le as "creeLe", dernier_succes_le as "dernierSuccesLe", empreinte_point_acces as empreinte
          from abonnements_pousses where utilisateur_id = ${acces.utilisateurId}::uuid order by cree_le desc, id`);
      return r.rows as unknown as LigneAppareil[];
    });
  }
  private presenter = (a: LigneAppareil) => ({ id: a.id, service: a.service, libelleService: LIBELLES_SERVICE[a.service] ?? a.service, agent: a.agent, creeLe: a.creeLe, dernierEnvoiAccepteLe: a.dernierSuccesLe, empreinte: a.empreinte });

  @Get()
  @ApiOperation({
    summary: 'État des notifications poussées, clé publique VAPID, ma préférence et mes appareils',
    description:
      'Statuts : « non_configure » (défaut : rien n’est accepté ni envoyé, « clePublique » vaut null), « simule » (tests : simulateur local), « configure_non_verifie » (clés présentes ; la réception sur un appareil réel n’a jamais été constatée — « verifieSurAppareilReel » vaut toujours faux). ' +
      '« phrases » est la liste FERMÉE des textes qu’une notification poussée peut afficher : aucune ne contient de montant, de nom de dossier, de client ou de fichier. « empreinte » (SHA-256 du point d’accès) permet au navigateur de reconnaître son propre abonnement ; le point d’accès et les clés ne sont jamais rendus.',
  })
  async etat(@AccesCourant() acces: Acces) {
    const [appareils, pref] = await Promise.all([
      this.appareils(acces),
      this.bd.avecContexte(acces, async (tx) => (await tx.execute(sql`select active from preferences_notification where utilisateur_id = ${acces.utilisateurId}::uuid and famille = 'poussees'`)).rows[0] as { active: boolean } | undefined),
    ]);
    return {
      statut: this.poussees.statut,
      detail: this.poussees.detail,
      activees: this.poussees.statut !== 'non_configure',
      clePublique: this.poussees.clePublique,
      verifieSurAppareilReel: false,
      preference: { active: pref?.active ?? true },
      phrases: Object.values(PHRASES_POUSSEES),
      services: this.poussees.statut === 'simule' ? [LIBELLES_SERVICE.simulateur] : SERVICES_NOTIFICATION.map((s) => s.libelle),
      appareils: appareils.map(this.presenter),
    };
  }

  @Get('abonnements')
  @ApiOperation({ summary: 'Mes appareils abonnés aux notifications poussées, dans ce cabinet', description: 'Chacun ne voit que les siens. Ni le point d’accès ni les clés de l’appareil ne sont rendus.' })
  async lister(@AccesCourant() acces: Acces) {
    return { appareils: (await this.appareils(acces)).map(this.presenter) };
  }

  @Post('abonnements')
  @ApiOperation({
    summary: 'Abonner cet appareil aux notifications poussées',
    description:
      'Refusé (503, code « poussees_non_configurees ») tant que la fonction n’est pas activée par l’éditeur. Le point d’accès vient du navigateur : seuls `https` et les hôtes connus des services de notification (Google FCM, Mozilla, Apple, Microsoft WNS) sont admis ; toute adresse interne, privée ou inconnue est refusée (400). ' +
      'Point d’accès et clés sont chiffrés avant d’être enregistrés ; l’agent utilisateur est réduit à « navigateur sur système ». Un appareil n’est abonné que pour un compte à la fois ; dix appareils au plus par personne. Rejouable : le même appareil met à jour son abonnement.',
  })
  @ApiBody({ schema: schemaOpenApi(abonnement) })
  async abonner(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    if (this.poussees.statut === 'non_configure') throw new ServiceUnavailableException({ message: NON_ACTIVE, code: 'poussees_non_configurees' });
    return this.enregistrer(acces, valider(abonnement, corps), null);
  }

  @Post('abonnements/remplacement')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remplacer l’abonnement de cet appareil après son renouvellement par le navigateur',
    description:
      'Appelée par le service worker (événement « pushsubscriptionchange ») ou par l’écran (« Réactiver »), avec la session de la personne. « ancienneEmpreinte » est le SHA-256 du point d’accès remplacé — l’ancienne adresse n’est jamais transmise. ' +
      'ATOMIQUE : dans une seule transaction, l’ancien abonnement DE L’APPELANT dans ce cabinet est retiré (s’il existe) et le nouveau enregistré ; en cas de refus du nouveau (point d’accès non admis, clés invalides, trop d’appareils), rien n’est retiré. ' +
      'L’abonnement d’une autre personne n’est jamais retiré sur la foi d’une empreinte : « ancienRetire » vaut alors faux et seul le nouvel abonnement est enregistré. Rejouable. Mêmes contrôles et mêmes refus que l’abonnement. ' +
      'Cet événement est peu fiable selon les navigateurs (disponibilité limitée d’après MDN) : sans lui, l’ancien abonnement est retiré au premier refus du service de notification et l’écran propose de réactiver.',
  })
  @ApiBody({ schema: schemaOpenApi(remplacement) })
  async remplacer(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const { ancienneEmpreinte, ...d } = valider(remplacement, corps);
    return this.enregistrer(acces, d, ancienneEmpreinte ?? null);
  }

  /**
   * Enregistre l'abonnement d'un appareil ; avec `ancienneEmpreinte`, retire d'abord, DANS LA MÊME TRANSACTION, l'ancien
   * abonnement de l'appelant pour cet appareil (renouvellement). Tout refus annule l'ensemble.
   */
  private async enregistrer(acces: Acces, d: z.infer<typeof abonnement>, ancienneEmpreinte: string | null) {
    if (this.poussees.statut === 'non_configure') throw new ServiceUnavailableException({ message: NON_ACTIVE, code: 'poussees_non_configurees' });
    const destination = verifierPointAcces(d.endpoint, this.poussees.origineSimulateur ?? undefined);
    // Le motif est donné, jamais l'adresse soumise.
    if (!destination.ok) throw new BadRequestException({ message: 'Point d’accès refusé : ce n’est pas l’adresse d’un service de notification connu.', code: 'point_acces_refuse', motif: destination.motif });
    if (!clesAbonnementValides(d.keys)) throw new BadRequestException({ message: 'Clés de l’abonnement invalides.', code: 'cles_invalides' });
    // Empreinte de l'adresse TELLE QUE le navigateur la donne : c'est celle qu'il recalcule pour reconnaître son abonnement.
    const empreinte = empreintePointAcces(d.endpoint);
    const secrets = chiffrerAbonnement(this.poussees, { endpoint: destination.url, p256dh: d.keys.p256dh, auth: d.keys.auth }, associeAbonnement(acces.cabinetId, acces.utilisateurId, empreinte));
    const agent = reduireAgentUtilisateur(d.agentUtilisateur);
    return this.bd.avecContexte(acces, async (tx) => {
      // Renouvellement : l'ancien abonnement n'est retiré que s'il est CELUI DE L'APPELANT, dans ce cabinet (le filtre
      // explicite double la politique de la base). Une empreinte ne suffit jamais à retirer l'abonnement d'autrui.
      let ancienRetire = false;
      if (ancienneEmpreinte !== null && ancienneEmpreinte !== empreinte) {
        const r = await tx.execute(sql`delete from abonnements_pousses where empreinte_point_acces = ${ancienneEmpreinte} and utilisateur_id = ${acces.utilisateurId}::uuid and cabinet_id = ${acces.cabinetId}::uuid returning id, service`);
        for (const ancien of r.rows as Array<{ id: string; service: string }>) {
          ancienRetire = true;
          await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'notification_poussee.appareil_retire', cibleType: 'abonnement_pousse', cibleId: ancien.id, details: { service: ancien.service, par: 'navigateur', motif: 'renouvellement' } });
        }
      }
      let id: string;
      try {
        // Point de reprise : un refus de la fonction (trop d'appareils) ne doit pas condamner la transaction.
        id = await tx.transaction(async (sp) => ((await sp.execute(sql`select abonnement_pousse_enregistrer(${empreinte}, ${destination.service}, ${secrets}, ${agent}) as id`)).rows[0] as { id: string }).id);
      } catch (e) {
        if (/trop d'appareils/.test(String((e as { cause?: { message?: string }; message?: string }).cause?.message ?? (e as Error).message))) {
          throw new ConflictException({ message: 'Dix appareils sont déjà abonnés pour ce compte : retirez-en un avant d’en ajouter.', code: 'trop_d_appareils' });
        }
        throw e;
      }
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'notification_poussee.appareil_abonne', cibleType: 'abonnement_pousse', cibleId: id, details: { service: destination.service, agent, ...(ancienneEmpreinte !== null ? { renouvellement: true, ancienRetire } : {}) } });
      const [a] = (await tx.execute(sql`select id, service, agent, cree_le as "creeLe", dernier_succes_le as "dernierSuccesLe", empreinte_point_acces as empreinte from abonnements_pousses where id = ${id}::uuid`)).rows as unknown as LigneAppareil[];
      return ancienneEmpreinte !== null ? { ...this.presenter(a!), ancienRetire } : this.presenter(a!);
    });
  }

  @Delete('abonnements/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retirer un de mes appareils',
    description: 'Supprime l’abonnement et ses clés : plus rien n’est adressé à cet appareil. Possible même si la fonction a été désactivée depuis. L’abonnement côté navigateur se retire depuis l’appareil lui-même (l’écran le fait pour l’appareil courant).',
  })
  async retirer(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`delete from abonnements_pousses where id = ${id}::uuid and utilisateur_id = ${acces.utilisateurId}::uuid returning service`);
      if (!r.rowCount) throw new NotFoundException('Appareil introuvable');
      await journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'notification_poussee.appareil_retire', cibleType: 'abonnement_pousse', cibleId: id, details: { service: (r.rows[0] as { service: string }).service, par: 'utilisateur' } });
      return { retire: true };
    });
  }

  @Put('preference')
  @ApiOperation({
    summary: 'Activer ou couper TOUTES les notifications poussées pour moi, dans ce cabinet',
    description: 'Préférence globale, en plus des préférences par famille (une famille désactivée n’est déjà plus notifiée, ni dans l’application ni sur l’appareil). Coupée : plus rien n’est adressé à mes appareils, qui restent abonnés ; les notifications dans l’application continuent.',
  })
  @ApiBody({ schema: schemaOpenApi(preference) })
  async reglerPreference(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(preference, corps);
    return this.bd.avecContexte(acces, async (tx) => {
      await tx.execute(sql`
        insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values (${acces.cabinetId}::uuid, ${acces.utilisateurId}::uuid, 'poussees', ${d.active})
        on conflict (cabinet_id, utilisateur_id, famille) do update set active = excluded.active, maj_le = now()`);
      return { active: d.active };
    });
  }
}
