import { BadRequestException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AccesBd, sql } from '@comtaple/db';
import { type Acces, AccesCourant, exigerUuid } from './acces.js';
import { BD } from './jetons.js';

interface LigneNotification {
  id: string;
  type: string;
  entiteId: string | null;
  cibleType: string | null;
  cibleId: string | null;
  donnees: Record<string, unknown>;
  creeLe: string;
  lueLe: string | null;
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
  async lister(@AccesCourant() acces: Acces, @Query('page') pageBrute?: string, @Query('nonLues') nonLues?: string) {
    if (pageBrute !== undefined && !/^[1-9]\d{0,5}$/.test(pageBrute)) throw new BadRequestException('Page invalide');
    const page = Number(pageBrute ?? 1);
    const TAILLE = 30;
    return this.bd.avecContexte(acces, async (tx) => {
      // La politique de la base ne laisse voir que les notifications du destinataire ; le filtre explicite la double.
      const lignes = (
        await tx.execute(sql`
          select n.id, n.type, n.entite_id_cible as "entiteId", n.cible_type as "cibleType", n.cible_id as "cibleId", n.donnees, n.cree_le as "creeLe", n.lue_le as "lueLe",
                 e.raison_sociale as "raisonSociale", (n.entite_id_cible is null or app_niveau_entite(n.entite_id_cible) is not null) as accessible
            from notifications n left join entites e on e.id = n.entite_id_cible and app_niveau_entite(e.id) is not null
           where n.destinataire_id = ${acces.utilisateurId}::uuid ${nonLues === '1' ? sql`and n.lue_le is null` : sql``}
           order by n.cree_le desc, n.id desc limit ${TAILLE + 1} offset ${(page - 1) * TAILLE}`)
      ).rows as unknown as LigneNotification[];
      const [d] = (await tx.execute(sql`select count(*)::int as total, count(*) filter (where lue_le is null)::int as "nonLues" from notifications where destinataire_id = ${acces.utilisateurId}::uuid`)).rows as Array<{ total: number; nonLues: number }>;
      return {
        page,
        taillePage: TAILLE,
        total: d?.total ?? 0,
        nonLues: d?.nonLues ?? 0,
        suite: lignes.length > TAILLE,
        envoiExterne: false,
        notifications: lignes.slice(0, TAILLE).map((n) => ({ id: n.id, type: n.type, creeLe: n.creeLe, lueLe: n.lueLe, ...presenterNotification(n) })),
      };
    });
  }

  @Get('decompte')
  @ApiOperation({ summary: 'Nombre de mes notifications non lues' })
  async decompte(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const [d] = (await tx.execute(sql`select count(*)::int as "nonLues" from notifications where destinataire_id = ${acces.utilisateurId}::uuid and lue_le is null`)).rows as Array<{ nonLues: number }>;
      return { nonLues: d?.nonLues ?? 0 };
    });
  }

  @Post('lues')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marquer toutes mes notifications comme lues' })
  async toutLire(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`update notifications set lue_le = now() where destinataire_id = ${acces.utilisateurId}::uuid and lue_le is null`);
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
