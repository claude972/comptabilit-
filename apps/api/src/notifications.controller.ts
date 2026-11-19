import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { type AccesBd, sql } from '@comtaple/db';
import { type Acces, AccesCourant, exigerUuid } from './acces.js';
import { BD } from './jetons.js';
import { schemaOpenApi, valider } from './validation.js';

interface LigneNotification {
  id: string;
  type: string;
  entiteId: string | null;
  cibleType: string | null;
  cibleId: string | null;
  donnees: Record<string, unknown>;
  creeLe: string;
  lueLe: string | null;
  archiveeLe?: string | null;
  raisonSociale: string | null;
  accessible: boolean;
}

const texte = (v: unknown, max = 40) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');

/**
 * Texte et lien d'une notification, composés À LA LECTURE. Une notification liée à un dossier auquel le lecteur n'a
 * plus accès ne dit plus rien de ce dossier et ne propose aucun lien.
 */
export function presenterNotification(n: LigneNotification): { titre: string; message: string; lien: string | null } {
  if (n.entiteId && !n.accessible) return { titre: 'Notification d’un dossier auquel vous n’avez plus accès', message: 'Son contenu n’est plus affiché.', lien: null };
  const dossier = n.raisonSociale ? ` — dossier ${n.raisonSociale}` : '';
  const regle = `contrôle ${texte(n.donnees.controleId)}, version ${texte(n.donnees.version)}`;
  switch (n.type) {
    case 'regle.a_decider':
      return {
        titre: n.donnees.origine === 'correspondance_banque' ? 'Une correspondance de comptes de banque attend une décision' : 'Une règle proposée attend une décision',
        message: `Proposition à examiner (${regle})${dossier}. Elle n’a aucun effet tant qu’elle n’est pas approuvée.`,
        lien: '/regles',
      };
    case 'regle.decidee':
      return { titre: n.donnees.decision === 'approuvee' ? 'Votre proposition de règle a été approuvée' : 'Votre proposition de règle a été refusée', message: `Décision rendue (${regle})${dossier}.`, lien: '/regles' };
    case 'document.complement_demande':
      return { titre: 'Un complément vous est demandé sur une pièce', message: `Le cabinet a posé une question sur une pièce déposée${dossier}.`, lien: n.cibleId ? `/depots/${n.cibleId}` : '/depots' };
    case 'document.reponse':
      return { titre: 'Une réponse a été apportée à votre demande de complément', message: `Le déposant a répondu sur une pièce${dossier}.`, lien: n.cibleId ? `/depots/${n.cibleId}` : '/depots' };
    case 'import.termine':
    case 'import.echec': {
      const quoi = n.donnees.type === 'fec' ? 'des écritures comptables' : 'du relevé bancaire';
      const lien = n.entiteId ? `/dossiers/${n.entiteId}/${n.donnees.type === 'fec' ? 'comptabilite' : 'banque'}` : null;
      if (n.type === 'import.echec') return { titre: `L’import ${quoi} a échoué`, message: `Aucune donnée n’a été prise en compte ; le rapport d’import en donne la raison${dossier}.`, lien };
      return {
        titre: n.donnees.statut === 'termine_avec_erreurs' ? `L’import ${quoi} est terminé, avec des anomalies` : `L’import ${quoi} est terminé`,
        message: `Le rapport d’import est disponible${dossier}. Terminé ne veut pas dire conforme : lisez le rapport.`,
        lien,
      };
    }
    case 'constat.affecte':
      return { titre: 'Un constat de révision vous a été affecté', message: `Constat du contrôle ${texte(n.donnees.controleId)} à examiner${dossier}.`, lien: n.entiteId ? `/dossiers/${n.entiteId}/revision` : null };
    case 'restitution.prete':
      return { titre: 'L’archive de restitution du dossier est prête', message: `Elle peut être téléchargée${dossier}.`, lien: n.entiteId ? `/dossiers/${n.entiteId}/restitution` : null };
    case 'restitution.echec':
      return { titre: 'La préparation de l’archive de restitution a échoué', message: `Demandez un nouvel export${dossier}.`, lien: n.entiteId ? `/dossiers/${n.entiteId}/restitution` : null };
    case 'restitution_cabinet.prete':
      return { titre: 'L’archive de restitution du cabinet est prête', message: 'Elle peut être téléchargée par vous seul.', lien: '/administration/restitution' };
    case 'restitution_cabinet.echec':
      return { titre: 'La préparation de l’archive de restitution du cabinet a échoué', message: 'Demandez une nouvelle restitution.', lien: '/administration/restitution' };
    default:
      return { titre: 'Notification', message: '', lien: null };
  }
}

/** Familles de notifications réglables par chacun. La clé de base est le préfixe du type (`regle.a_decider` → `regle`). */
export const FAMILLES_NOTIFICATION = [
  { famille: 'regles', prefixes: ['regle'], libelle: 'Règles du cabinet et correspondances à décider ou décidées' },
  { famille: 'pieces', prefixes: ['document'], libelle: 'Compléments demandés sur une pièce et réponses' },
  { famille: 'imports', prefixes: ['import'], libelle: 'Imports terminés ou en échec' },
  { famille: 'constats', prefixes: ['constat'], libelle: 'Constats de révision qui me sont affectés' },
  { famille: 'restitutions', prefixes: ['restitution', 'restitution_cabinet'], libelle: 'Archives de restitution prêtes ou en échec' },
] as const;
const lot = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), action: z.enum(['lire', 'archiver', 'desarchiver']) });
const preference = z.object({ famille: z.enum(FAMILLES_NOTIFICATION.map((f) => f.famille) as [string, ...string[]]), active: z.boolean() });

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get()
  @ApiOperation({
    summary: 'Mes notifications dans l’application',
    description:
      'Notifications INTERNES uniquement : rien n’est envoyé par courriel, SMS ou notification poussée. Chacun ne voit que les siennes. Le texte est composé à la lecture ; une notification d’un dossier auquel l’appelant n’a plus accès n’en dit plus rien.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'nonLues', required: false, description: '« 1 » : seulement les non lues' })
  @ApiQuery({ name: 'archivees', required: false, description: '« 1 » : les notifications archivées (sinon les notifications courantes)' })
  async lister(@AccesCourant() acces: Acces, @Query('page') pageBrute?: string, @Query('nonLues') nonLues?: string, @Query('archivees') archivees?: string) {
    if (pageBrute !== undefined && !/^[1-9]\d{0,5}$/.test(pageBrute)) throw new BadRequestException('Page invalide');
    const page = Number(pageBrute ?? 1);
    const TAILLE = 30;
    return this.bd.avecContexte(acces, async (tx) => {
      // La politique de la base ne laisse voir que les notifications du destinataire ; le filtre explicite la double.
      const lignes = (
        await tx.execute(sql`
          select n.id, n.type, n.entite_id_cible as "entiteId", n.cible_type as "cibleType", n.cible_id as "cibleId", n.donnees, n.cree_le as "creeLe", n.lue_le as "lueLe",
                 n.archivee_le as "archiveeLe", e.raison_sociale as "raisonSociale", (n.entite_id_cible is null or app_niveau_entite(n.entite_id_cible) is not null) as accessible
            from notifications n left join entites e on e.id = n.entite_id_cible and app_niveau_entite(e.id) is not null
           where n.destinataire_id = ${acces.utilisateurId}::uuid and n.archivee_le is ${archivees === '1' ? sql`not null` : sql`null`} ${nonLues === '1' ? sql`and n.lue_le is null` : sql``}
           order by n.cree_le desc, n.id desc limit ${TAILLE + 1} offset ${(page - 1) * TAILLE}`)
      ).rows as unknown as LigneNotification[];
      // Décomptes sur les notifications COURANTES (non archivées) ; les archivées sont comptées à part.
      const [d] = (await tx.execute(sql`select count(*) filter (where archivee_le is null)::int as courantes, count(*) filter (where archivee_le is null and lue_le is null)::int as "nonLues", count(*) filter (where archivee_le is not null)::int as archivees from notifications where destinataire_id = ${acces.utilisateurId}::uuid`)).rows as Array<{ courantes: number; nonLues: number; archivees: number }>;
      return {
        page,
        taillePage: TAILLE,
        total: archivees === '1' ? (d?.archivees ?? 0) : (d?.courantes ?? 0),
        nonLues: d?.nonLues ?? 0,
        archivees: d?.archivees ?? 0,
        suite: lignes.length > TAILLE,
        envoiExterne: false,
        notifications: lignes.slice(0, TAILLE).map((n) => ({ id: n.id, type: n.type, creeLe: n.creeLe, lueLe: n.lueLe, archiveeLe: n.archiveeLe, ...presenterNotification(n) })),
      };
    });
  }

  @Get('decompte')
  @ApiOperation({ summary: 'Nombre de mes notifications non lues' })
  async decompte(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const [d] = (await tx.execute(sql`select count(*)::int as "nonLues" from notifications where destinataire_id = ${acces.utilisateurId}::uuid and lue_le is null and archivee_le is null`)).rows as Array<{ nonLues: number }>;
      return { nonLues: d?.nonLues ?? 0 };
    });
  }

  @Get('groupes')
  @ApiOperation({
    summary: 'Mes notifications courantes, regroupées par nature et par dossier',
    description: 'Un groupe réunit les notifications non archivées de même type et de même dossier : la plus récente est présentée, avec leur nombre, le nombre de non lues et leurs identifiants (200 au plus) pour agir sur le groupe entier.',
  })
  async groupes(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const lignes = (
        await tx.execute(sql`
          with g as (
            select n.type, n.entite_id_cible, count(*)::int as nombre, count(*) filter (where n.lue_le is null)::int as "nonLues", max(n.cree_le) as derniere,
                   (array_agg(n.id order by n.cree_le desc, n.id desc))[1:200] as ids
              from notifications n where n.destinataire_id = ${acces.utilisateurId}::uuid and n.archivee_le is null
             group by n.type, n.entite_id_cible)
          select g.nombre, g."nonLues", g.ids, n.id, n.type, n.entite_id_cible as "entiteId", n.cible_type as "cibleType", n.cible_id as "cibleId", n.donnees, n.cree_le as "creeLe", n.lue_le as "lueLe",
                 e.raison_sociale as "raisonSociale", (n.entite_id_cible is null or app_niveau_entite(n.entite_id_cible) is not null) as accessible
            from g join notifications n on n.id = g.ids[1]
            left join entites e on e.id = n.entite_id_cible and app_niveau_entite(e.id) is not null
           order by (g."nonLues" > 0) desc, g.derniere desc limit 100`)
      ).rows as unknown as Array<LigneNotification & { nombre: number; nonLues: number; ids: string[] }>;
      return {
        envoiExterne: false,
        groupes: lignes.map((n) => {
          const p = presenterNotification(n);
          // Un groupe de plusieurs notifications ne renvoie pas vers une pièce précise, mais vers l'écran qui les liste.
          const lien = n.nombre > 1 && n.type.startsWith('document.') ? '/depots' : p.lien;
          return { type: n.type, nombre: n.nombre, nonLues: n.nonLues, derniere: n.creeLe, ids: n.ids, titre: p.titre, message: p.message, lien };
        }),
      };
    });
  }

  @Post('lot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marquer comme lues, archiver ou désarchiver plusieurs de mes notifications',
    description: 'L’archivage est RÉVERSIBLE : une notification archivée sort de la liste courante, reste consultable (« archivees=1 ») et se désarchive. Rien n’est supprimé par cette route. Les identifiants qui ne sont pas à l’appelant sont ignorés.',
  })
  @ApiBody({ schema: schemaOpenApi(lot) })
  async agirEnLot(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(lot, corps);
    const ids = `{${d.ids.join(',')}}`;
    return this.bd.avecContexte(acces, async (tx) => {
      const moi = sql`destinataire_id = ${acces.utilisateurId}::uuid and id = any(${ids}::uuid[])`;
      const r =
        d.action === 'lire' ? await tx.execute(sql`update notifications set lue_le = now() where ${moi} and lue_le is null`)
        : d.action === 'archiver' ? await tx.execute(sql`update notifications set archivee_le = now(), lue_le = coalesce(lue_le, now()) where ${moi} and archivee_le is null`)
        : await tx.execute(sql`update notifications set archivee_le = null where ${moi} and archivee_le is not null`);
      return { action: d.action, modifiees: r.rowCount ?? 0 };
    });
  }

  @Post('archiver-lues')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archiver toutes mes notifications déjà lues (réversible)' })
  async archiverLues(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`update notifications set archivee_le = now() where destinataire_id = ${acces.utilisateurId}::uuid and lue_le is not null and archivee_le is null`);
      return { archivees: r.rowCount ?? 0 };
    });
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Mes préférences de notification dans l’application',
    description: 'Par famille de notifications. Une famille désactivée n’est plus notifiée à l’appelant ; les notifications déjà reçues restent. Aucun réglage d’envoi extérieur n’existe : rien n’est jamais envoyé hors de l’application.',
  })
  async preferences(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const lignes = (await tx.execute(sql`select famille, active from preferences_notification where utilisateur_id = ${acces.utilisateurId}::uuid`)).rows as Array<{ famille: string; active: boolean }>;
      const inactives = new Set(lignes.filter((l) => !l.active).map((l) => l.famille));
      return { envoiExterne: false, familles: FAMILLES_NOTIFICATION.map((f) => ({ famille: f.famille, libelle: f.libelle, active: !f.prefixes.some((p) => inactives.has(p)) })) };
    });
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Activer ou désactiver une famille de notifications pour moi, dans ce cabinet' })
  @ApiBody({ schema: schemaOpenApi(preference) })
  async reglerPreference(@AccesCourant() acces: Acces, @Body() corps: unknown) {
    const d = valider(preference, corps);
    const f = FAMILLES_NOTIFICATION.find((x) => x.famille === d.famille)!;
    return this.bd.avecContexte(acces, async (tx) => {
      for (const prefixe of f.prefixes) {
        await tx.execute(sql`
          insert into preferences_notification (cabinet_id, utilisateur_id, famille, active) values (${acces.cabinetId}::uuid, ${acces.utilisateurId}::uuid, ${prefixe}, ${d.active})
          on conflict (cabinet_id, utilisateur_id, famille) do update set active = excluded.active, maj_le = now()`);
      }
      return { famille: f.famille, libelle: f.libelle, active: d.active };
    });
  }

  @Post('lues')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marquer toutes mes notifications comme lues' })
  async toutLire(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`update notifications set lue_le = now() where destinataire_id = ${acces.utilisateurId}::uuid and lue_le is null and archivee_le is null`);
      return { marquees: r.rowCount ?? 0 };
    });
  }

  @Post(':id/lue')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marquer une de mes notifications comme lue' })
  async lire(@AccesCourant() acces: Acces, @Param('id') id: string) {
    exigerUuid(id);
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`update notifications set lue_le = coalesce(lue_le, now()) where id = ${id}::uuid and destinataire_id = ${acces.utilisateurId}::uuid returning id, lue_le as "lueLe"`);
      if (!r.rowCount) throw new NotFoundException('Notification introuvable');
      return r.rows[0];
    });
  }
}
