import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AccesBd, sql } from '@comtaple/db';
import {
  ETIQUETTE_IA,
  ETIQUETTE_SANS_IA,
  MENTION_CONFIANCE,
  MODELES_IA,
  PROMPT_ASSISTANT,
  PROMPT_CLASSER_PIECE,
  PROMPT_CONSTAT,
  PROMPT_INDICATEURS,
  PROMPT_LETTRE_MISSION,
  PROMPT_RAPPROCHEMENTS,
} from '@comtaple/ia';
import type { ServicesIa } from '@comtaple/plateforme';
import { z } from 'zod';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid } from './acces.js';
import { limiterDebitIa, poserQuestion, QUESTION_MAX, QUESTION_MIN } from './assistant.service.js';
import { BD, IA } from './jetons.js';
import { schemaOpenApi, uuid, valider } from './validation.js';

const question = z.strictObject({
  question: z.string().trim().min(QUESTION_MIN, `question de ${QUESTION_MIN} caractères au moins`).max(QUESTION_MAX, `question de ${QUESTION_MAX} caractères au plus`),
  exerciceId: uuid.optional(),
});
const TAILLE_PAGE = 20;

/** Texte d'état affiché en permanence par l'interface : il découle du statut RÉEL de la passerelle, jamais d'un réglage d'affichage. */
export function messageEtatIa(statut: string): string {
  if (statut === 'connecte') return 'IA connectée : les réponses sont rédigées par un modèle à partir des sources citées, et restent à vérifier. Les calculs proviennent du moteur.';
  if (statut === 'simule') return 'SIMULATEUR de test : aucune IA réelle n’est appelée. Les réponses « rédigées » sont des réponses programmées pour les essais.';
  if (statut === 'configure_non_verifie') return 'IA configurée mais non vérifiée : aucun modèle n’est sollicité. Les réponses ci-dessous sont des résultats de recherche et des calculs du moteur, sans rédaction par un modèle.';
  return 'IA non connectée : les réponses ci-dessous sont des résultats de recherche et des calculs du moteur, sans rédaction par un modèle.';
}

@ApiTags('Assistant et IA')
@ApiBearerAuth()
@Controller('v1')
export class AssistantController {
  constructor(
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(IA) private readonly ia: ServicesIa,
  ) {}

  private etat() {
    const { statut, raisons } = this.ia.statut();
    return { statut, raisons, message: messageEtatIa(statut), modeleSollicite: this.ia.modeleUtilisable() };
  }

  @Post('dossiers/:id/assistant/questions')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Poser une question documentée sur un dossier (niveau « lecture » au moins)',
    description:
      'Périmètre imposé par le serveur : le cabinet et l’utilisateur de la session, ce dossier, la période de l’exercice choisi (à défaut le dernier). La réponse est structurée en segments typés (fait, calcul, hypothèse, interprétation), chacun avec ses citations vers des pièces, écritures, constats, résultats du moteur ou sources officielles. Sans IA connectée — état actuel — la réponse porte « mode: sans_ia » : résultats de recherche et calculs du moteur, sans rédaction par un modèle. Les contenus de pièces sont des données non fiables, restituées en texte brut et jamais interprétées. L’échange est enregistré pour son auteur seulement.',
  })
  @ApiBody({ schema: schemaOpenApi(question) })
  async poser(@AccesCourant() acces: Acces, @Param('id') id: string, @Body() corps: unknown) {
    exigerUuid(id);
    const d = valider(question, corps);
    limiterDebitIa(`question:${acces.utilisateurId}`);
    const r = await poserQuestion({ bd: this.bd, ia: this.ia }, acces, id, d);
    return { ...r, ia: this.etat() };
  }

  @Get('dossiers/:id/assistant/questions')
  @ApiOperation({ summary: 'Mes questions à l’assistant sur ce dossier, les plus récentes d’abord', description: 'Chacun ne relit que ses propres échanges (règle appliquée par la base).' })
  @ApiQuery({ name: 'page', required: false })
  async historique(@AccesCourant() acces: Acces, @Param('id') id: string, @Query('page') pageBrute?: string) {
    exigerUuid(id);
    const page = Number(pageBrute ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new BadRequestException('page : entier positif attendu');
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, id, 'lecture');
      const filtre = sql`entite_id = ${id}::uuid and utilisateur_id = ${acces.utilisateurId}::uuid`;
      const [{ n } = { n: 0 }] = (await tx.execute(sql`select count(*)::int as n from echanges_assistant where ${filtre}`)).rows as Array<{ n: number }>;
      const echanges = (
        await tx.execute(sql`
          select id, exercice_id as "exerciceId", question, mode, statut, reponse, cree_le as "creeLe"
          from echanges_assistant where ${filtre}
          order by cree_le desc, id desc limit ${TAILLE_PAGE} offset ${(page - 1) * TAILLE_PAGE}`)
      ).rows;
      return { page, taillePage: TAILLE_PAGE, total: n, echanges };
    });
  }

  @Get('ia')
  @ApiOperation({
    summary: 'État RÉEL de la passerelle IA, modèles figés, prompts versionnés et — pour les gestionnaires — mesures',
    description:
      'Statut : non_connecte, configure_non_verifie, connecte (appel réel vérifié sur l’hôte officiel) ou simule (tests). Les mesures viennent des traces sans contenu (table en ajout seul) et distinguent toujours les natures « reel », « simulateur » et « sans_ia » : un appel au simulateur n’est jamais compté comme un appel réel. Le coût est une estimation (jetons × tarif configuré et daté), nulle si aucun tarif n’est configuré.',
  })
  async etatIa(@AccesCourant() acces: Acces) {
    const base = {
      ...this.etat(),
      fournisseur: 'OVHcloud AI Endpoints',
      modeles: MODELES_IA,
      prompts: [
        { tache: 'assistant', ...PROMPT_ASSISTANT },
        { tache: 'classer_piece', ...PROMPT_CLASSER_PIECE },
        { tache: 'expliquer_constat', ...PROMPT_CONSTAT },
        { tache: 'commenter_indicateurs', ...PROMPT_INDICATEURS },
        { tache: 'analyser_lettre_mission', ...PROMPT_LETTRE_MISSION },
        { tache: 'suggerer_rapprochements', ...PROMPT_RAPPROCHEMENTS },
      ],
      etiquettes: { sansIa: ETIQUETTE_SANS_IA, ia: ETIQUETTE_IA, confiance: MENTION_CONFIANCE },
      tarifs: this.ia.tarifs ? { relevesLe: this.ia.tarifs.relevesLe, devise: this.ia.tarifs.devise, source: this.ia.tarifs.source, modeles: Object.keys(this.ia.tarifs.parMillionDeJetons) } : null,
    };
    // Les traces en attente d'écriture sont enregistrées avant la lecture des mesures.
    await this.ia.journal.vider();
    return this.bd.avecContexte(acces, async (tx) => {
      const gestionnaire = Boolean((await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok);
      if (!gestionnaire) return { ...base, mesures: null, mesuresReservees: 'Les mesures sont réservées aux administrateurs et associés du cabinet.' };
      const lignes = (
        await tx.execute(sql`
          select nature, type, tache, resultat, count(*)::int as nombre,
                 coalesce(sum(duree_ms), 0)::int as "dureeTotaleMs", round(avg(duree_ms))::int as "dureeMoyenneMs",
                 sum(jetons_entree)::int as "jetonsEntree", sum(jetons_sortie)::int as "jetonsSortie",
                 sum(cout_estime)::text as "coutEstime", max(devise) as devise, min(cree_le) as "premierLe", max(cree_le) as "dernierLe"
          from evenements_ia where cabinet_id = ${acces.cabinetId}::uuid
          group by nature, type, tache, resultat order by nature, type, tache, resultat`)
      ).rows as Array<{ nature: string; type: string; tache: string; resultat: string; nombre: number; coutEstime: string | null; devise: string | null }>;
      const natures = ['reel', 'simulateur', 'sans_ia'] as const;
      const totaux = Object.fromEntries(
        natures.map((nature) => {
          const l = lignes.filter((x) => x.nature === nature);
          const appels = l.filter((x) => x.type === 'appel_ia');
          const compter = (liste: typeof l, resultat?: string) => liste.filter((x) => resultat === undefined || x.resultat === resultat).reduce((n, x) => n + x.nombre, 0);
          return [
            nature,
            {
              appelsModele: compter(appels),
              reussis: compter(appels, 'ok'),
              abstentions: compter(appels, 'abstention'),
              rejets: compter(appels, 'rejet'),
              erreurs: compter(appels, 'erreur'),
              indisponibles: compter(appels, 'indisponible'),
              fonctionsExecutees: compter(l.filter((x) => x.type === 'fonction_metier'), 'executee'),
              fonctionsRefusees: compter(l.filter((x) => x.type === 'fonction_metier'), 'refusee'),
            },
          ];
        }),
      );
      return {
        ...base,
        mesures: {
          mention: 'Mesures tirées des traces sans contenu. « sans_ia » : aucun modèle appelé. « simulateur » : essais, jamais un appel réel. Coût : estimation, pas une facture.',
          totaux,
          parTache: lignes,
        },
      };
    });
  }
}
