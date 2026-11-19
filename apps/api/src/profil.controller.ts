import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, asc, desc, eq, schema as s, sql } from '@comtaple/db';
import { type Acces, AccesCourant, exigerNiveau, exigerUuid, Public } from './acces.js';
import { BD } from './jetons.js';

@ApiTags('Profil et dossiers')
@Controller('v1')
export class ProfilController {
  constructor(@Inject(BD) private readonly bd: AccesBd) {}

  @Public()
  @Get('sante')
  @ApiOperation({ summary: 'État du service (sans authentification, sans donnée)' })
  async sante() {
    await this.bd.pool.query('select 1');
    return { statut: 'ok' };
  }

  @ApiBearerAuth()
  @Get('moi')
  @ApiOperation({ summary: 'Identité, cabinet courant et rôle, établis à partir du jeton vérifié' })
  async moi(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, async (tx) => {
      const [cabinet] = await tx.select().from(s.cabinets).where(eq(s.cabinets.id, acces.cabinetId));
      return { utilisateur: { id: acces.utilisateurId, nom: acces.nom, email: acces.email }, cabinet, role: acces.role };
    });
  }

  @ApiBearerAuth()
  @Get('dossiers')
  @ApiOperation({
    summary: 'Dossiers accessibles avec le niveau d’habilitation',
    description: 'Un gestionnaire voit la liste complète du cabinet ; « niveau » vaut null pour les dossiers où il n’est pas habilité (contenu inaccessible).',
  })
  async dossiers(@AccesCourant() acces: Acces) {
    return this.bd.avecContexte(acces, (tx) =>
      tx
        .select({
          id: s.entites.id,
          raisonSociale: s.entites.raisonSociale,
          formeJuridique: s.entites.formeJuridique,
          regimeFiscal: s.entites.regimeFiscal,
          territoireFiscal: s.entites.territoireFiscal,
          niveau: sql<string | null>`app_niveau_entite(${s.entites.id})`,
        })
        .from(s.entites)
        .where(eq(s.entites.actif, true))
        .orderBy(asc(s.entites.raisonSociale)),
    );
  }

  @ApiBearerAuth()
  @Get('dossiers/:entiteId/exercices')
  @ApiOperation({ summary: 'Exercices d’un dossier' })
  async exercices(@AccesCourant() acces: Acces, @Param('entiteId') entiteId: string) {
    exigerUuid(entiteId);
    return this.bd.avecContexte(acces, async (tx) => {
      await exigerNiveau(tx, entiteId, 'lecture');
      return tx.select().from(s.exercices).where(eq(s.exercices.entiteId, entiteId)).orderBy(desc(s.exercices.debut));
    });
  }
}
