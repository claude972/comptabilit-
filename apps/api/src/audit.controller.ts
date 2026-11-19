import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, desc, schema as s, sql } from '@comtaple/db';
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
  async journal(@AccesCourant() acces: Acces, @Query('limite') limiteBrute?: string) {
    const limite = Math.min(Math.max(Number(limiteBrute) || 100, 1), 500);
    return this.bd.avecContexte(acces, async (tx) => {
      const gestionnaire = (await tx.execute(sql`select app_est_gestionnaire() as ok`)).rows[0]?.ok;
      if (!gestionnaire) throw new ForbiddenException('Réservé aux administrateurs et associés du cabinet');
      const rupture = (await tx.execute(sql`select journal_audit_verifier(${acces.cabinetId}::uuid) as rupture`)).rows[0]?.rupture ?? null;
      const lignes = await tx.select().from(s.journalAudit).orderBy(desc(s.journalAudit.id)).limit(limite);
      return { integrite: { rupture }, lignes };
    });
  }
}
