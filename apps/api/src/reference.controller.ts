import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CATALOGUE_CONTROLES } from '@comtaple/core';

@ApiTags('Référentiel')
@ApiBearerAuth()
@Controller('v1/reference')
export class ReferenceController {
  @Get('controles')
  @ApiOperation({ summary: 'Catalogue des contrôles : objectif, périmètre, données requises, logique, paramètres, source et version' })
  controles() {
    return CATALOGUE_CONTROLES.map((c) => ({
      id: c.id,
      version: c.version,
      cycle: c.cycle,
      titre: c.titre,
      objectif: c.objectif,
      perimetre: c.perimetre,
      donneesObligatoires: c.donneesObligatoires,
      logique: c.logique,
      parametresParDefaut: c.parametresParDefaut,
      exceptions: c.exceptions,
      source: c.source,
      resultatsAttendus: c.resultatsAttendus,
    }));
  }
}
