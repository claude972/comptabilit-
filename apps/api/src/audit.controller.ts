import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, desc, inArray, lt, schema as s, sql } from '@comtaple/db';
import { type Acces, AccesCourant } from './acces.js';
import { BD } from './jetons.js';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('v1/audit')
export class AuditController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Get()
  @ApiOperation({
    summary: 'Journal d’audit du cabinet (administrateur ou associé) et contrôle d’intégrité de la chaîne',
    description: '« rupture » vaut null si la chaîne d’empreintes est intacte, sinon l’identifiant de la première ligne incohérente.',
  })
  async journal(@AccesCourant() acces: Acces, @Query('limite') limiteBrute?: string, @Query('avant') avantBrut?: string) {
    const limite = Math.min(Math.max(Number(limiteBrute) || 100, 1), 500);
    return this.bd.avecContexte(acces, async (tx) => {
      const gestionnaire = (await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok;
      if (!gestionnaire) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const rupture = (await tx.execute(sql`select journal_audit_verifier(${acces.cabinetId}::uuid) as rupture`)).rows[0]?.rupture ?? null;
      const avant = Number(avantBrut);
      const brutes = await tx
        .select()
        .from(s.journalAudit)
        .where(Number.isSafeInteger(avant) && avant > 0 ? lt(s.journalAudit.id, avant) : undefined)
        .orderBy(desc(s.journalAudit.id))
        .limit(limite + 1);
      const page = brutes.slice(0, limite);
      // Nom de l'acteur quand il est membre du cabinet ; sinon l'identifiant seul (acteur système ou compte retiré).
      const ids = [...new Set(page.map((l) => l.acteurId).filter((x): x is string => Boolean(x)))];
      const noms = ids.length ? await tx.select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom }).from(s.utilisateurs).where(inArray(s.utilisateurs.id, ids)) : [];
      const parId = new Map(noms.map((n) => [n.id, n.nom]));
      return {
        integrite: { rupture },
        lignes: page.map((l) => ({ ...l, acteurNom: l.acteurId ? (parId.get(l.acteurId) ?? null) : null })),
        // Pagination : repasser « avant » avec cette valeur pour la page suivante (plus ancienne).
        suivant: brutes.length > limite ? page[page.length - 1]!.id : null,
      };
    });
  }
}
