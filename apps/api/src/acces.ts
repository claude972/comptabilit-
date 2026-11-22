import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AccesBd, and, eq, journaliser, schema as s, sql, type Tx } from '@comtaple/db';
import type { Config } from '@comtaple/plateforme';
import { createRemoteJWKSet, errors as erreursJose, jwtVerify } from 'jose';
import { BD, CONFIG } from './jetons.js';

export type RoleCabinet = (typeof s.roleCabinet.enumValues)[number];
export type Niveau = (typeof s.niveauHabilitation.enumValues)[number];

/** Identité et cabinet établis à partir du jeton vérifié et de la base. Seule source du contexte de sécurité. */
export interface Acces {
  cabinetId: string;
  utilisateurId: string;
  sujet: string;
  role: RoleCabinet;
  email: string;
  nom: string;
}

export const Public = () => SetMetadata('public', true);
/** Route utilisable avant le choix du cabinet (liste des cabinets d'un compte qui en a plusieurs). */
export const SansCabinet = () => SetMetadata('sans_cabinet', true);
export const AccesCourant = createParamDecorator((_: unknown, ctx: ExecutionContext): Acces => ctx.switchToHttp().getRequest().acces);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function exigerUuid(v: string, nom = 'identifiant'): string {
  if (!UUID.test(v)) throw new BadRequestException(`${nom} invalide`);
  return v;
}

@Injectable()
export class GardeAcces implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const entete: string | undefined = req.headers.authorization;
    if (!entete?.startsWith('Bearer ')) throw new UnauthorizedException('Jeton manquant');

    let sujet: string;
    // Adresse du jeton, retenue seulement si le fournisseur d'identité la déclare vérifiée (acceptation d'invitation).
    let emailAtteste: string | null = null;
    let nomJeton = '';
    try {
      this.jwks ??= createRemoteJWKSet(new URL(`${this.cfg.OIDC_ISSUER}/protocol/openid-connect/certs`));
      const { payload } = await jwtVerify(entete.slice(7), this.jwks, {
        issuer: this.cfg.OIDC_ISSUER,
        audience: this.cfg.OIDC_AUDIENCE,
        algorithms: ['RS256', 'ES256', 'PS256'],
      });
      if (!payload.sub) throw new Error('sub absent');
      sujet = payload.sub;
      if (payload.email_verified === true && typeof payload.email === 'string') emailAtteste = payload.email;
      if (typeof payload.name === 'string') nomJeton = payload.name;
    } catch (e) {
      // Une panne du fournisseur d'identité (clés injoignables, délai dépassé) n'est pas un jeton invalide : message distinct,
      // et le jeton n'est de toute façon jamais accepté sans vérification.
      if (e instanceof erreursJose.JWKSTimeout || !(e instanceof erreursJose.JOSEError)) {
        throw new ServiceUnavailableException('Service d’identité indisponible : la session ne peut pas être vérifiée pour le moment. Réessayez dans quelques instants.');
      }
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }

    // 1) L'utilisateur est retrouvé par le sujet du jeton ; 2) ses appartenances actives sont lues avec son identité.
    const chercher = () =>
      this.bd.avecContexte({ sujet }, async (tx) => {
        const [u] = await tx.select().from(s.utilisateurs).where(eq(s.utilisateurs.sujetOidc, sujet));
        return u;
      });
    // Invitations en attente pour l'adresse attestée du compte : acceptées par une fonction étroite de la base
    // (le sujet vient du contexte). Tentée quand le compte n'a pas de fiche ou pas de cabinet actif, et à la demande
    // des routes « sans cabinet » (un compte déjà membre invité dans un autre cabinet).
    const accepterInvitations = async (): Promise<number> => {
      if (!emailAtteste) return 0;
      const r = await this.bd.avecContexte({ sujet }, (tx) => tx.execute(sql`select invitations_accepter(${emailAtteste}, ${nomJeton}) as n`));
      return Number(r.rows[0]?.n ?? 0);
    };
    const sansCabinet = this.reflector.getAllAndOverride<boolean>('sans_cabinet', [ctx.getHandler(), ctx.getClass()]);
    let utilisateur = await chercher();
    if (!utilisateur && (await accepterInvitations()) > 0) utilisateur = await chercher();
    if (!utilisateur) throw new ForbiddenException('Compte non rattaché à un cabinet');
    const idUtilisateur = utilisateur.id;

    const lireAppartenances = () =>
      this.bd.avecContexte({ sujet, utilisateurId: idUtilisateur }, (tx) =>
        tx
          .select()
          .from(s.appartenances)
          .where(
            and(
              eq(s.appartenances.utilisateurId, idUtilisateur),
              eq(s.appartenances.actif, true),
              sql`(${s.appartenances.expireLe} is null or ${s.appartenances.expireLe} > now())`,
            ),
          ),
      );
    let appartenances = await lireAppartenances();
    if ((appartenances.length === 0 || sansCabinet) && (await accepterInvitations()) > 0) appartenances = await lireAppartenances();
    if (appartenances.length === 0) throw new ForbiddenException('Aucun cabinet actif pour ce compte');

    // Le cabinet demandé doit faire partie des appartenances vérifiées : il n'est jamais accepté tel quel.
    const demande = req.headers['x-cabinet-id'];
    let choisie = appartenances.length === 1 ? appartenances[0] : undefined;
    if (typeof demande === 'string' && demande) {
      choisie = appartenances.find((a) => a.cabinetId === demande);
      if (!choisie) throw new ForbiddenException('Cabinet non autorisé');
    }
    if (!choisie) {
      if (sansCabinet) {
        // Aucun cabinet dans le contexte : les politiques RLS ne laissent voir que les appartenances de l'utilisateur.
        req.acces = { cabinetId: '', utilisateurId: utilisateur.id, sujet, role: 'client_lecture', email: utilisateur.email, nom: utilisateur.nom } satisfies Acces;
        return true;
      }
      throw new BadRequestException('Plusieurs cabinets : préciser l’en-tête X-Cabinet-Id');
    }

    const acces: Acces = {
      cabinetId: choisie.cabinetId,
      utilisateurId: utilisateur.id,
      sujet,
      role: choisie.role,
      email: utilisateur.email,
      nom: utilisateur.nom,
    };
    // Support : accès temporaire, en LECTURE SEULE quelle que soit l'habilitation reçue, et chaque accès est tracé
    // dans le journal du cabinet (gabarit de route seulement, jamais de contenu).
    if (acces.role === 'support') {
      if (!['GET', 'HEAD'].includes(req.method)) throw new ForbiddenException('L’accès support est en lecture seule');
      await this.bd.avecContexte(acces, (tx) =>
        journaliser(tx, { cabinetId: acces.cabinetId, acteurId: acces.utilisateurId, action: 'support.consultation', details: { methode: req.method, route: req.route?.path ?? null } }),
      );
    }
    req.acces = acces;
    return true;
  }
}

const ORDRE: Niveau[] = ['depot', 'lecture', 'collaboration', 'revision', 'validation'];

/** Niveau de l'utilisateur courant sur un dossier (calculé en base par la même fonction que les politiques RLS). */
export async function niveauSur(tx: Tx, entiteId: string): Promise<Niveau | null> {
  const r = await tx.execute(sql`select app_niveau_entite(${entiteId}::uuid) as niveau`);
  return (r.rows[0]?.niveau as Niveau | null) ?? null;
}

/**
 * Vérifie le niveau minimal sur un dossier. Sans aucun accès, répond 404 (l'existence du dossier n'est pas révélée) ;
 * avec un accès insuffisant, 403.
 */
export async function exigerNiveau(tx: Tx, entiteId: string, minimum: Niveau): Promise<Niveau> {
  const n = await niveauSur(tx, entiteId);
  if (!n) throw new NotFoundException('Dossier introuvable');
  if (ORDRE.indexOf(n) < ORDRE.indexOf(minimum)) throw new ForbiddenException('Habilitation insuffisante sur ce dossier');
  return n;
}

/**
 * Travaux internes du cabinet (D-142) : un « client en lecture » ne lit ni la revue des contrôles et ses constats, ni les dossiers de révision, ni
 * l'assistant (constats internes, hypothèses de travail). Il garde la lecture des états et des tiers de son dossier.
 */
export function reserverAuxMembresDuCabinet(acces: Acces): void {
  if (acces.role === 'client_lecture') throw new ForbiddenException('Réservé aux membres du cabinet : travaux internes de révision');
}

export function auMoins(n: Niveau, minimum: Niveau): boolean {
  return ORDRE.indexOf(n) >= ORDRE.indexOf(minimum);
}
