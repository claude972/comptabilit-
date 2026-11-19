import { connect } from 'node:net';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Config, PasserelleIa } from '@comtaple/plateforme';
import { CONFIG } from './jetons.js';

function clamdRepond(hote: string, port: number): Promise<boolean> {
  return new Promise((resoudre) => {
    const s = connect({ host: hote, port });
    let recu = '';
    const finir = (ok: boolean) => {
      s.destroy();
      resoudre(ok);
    };
    s.setTimeout(3000, () => finir(false));
    s.on('error', () => finir(false));
    s.on('connect', () => s.write('zPING\0'));
    s.on('data', (d) => {
      recu += d.toString();
      if (recu.includes('PONG')) finir(true);
    });
  });
}

@ApiTags('Référentiel')
@ApiBearerAuth()
@Controller('v1/integrations')
export class IntegrationsController {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  @Get()
  @ApiOperation({
    summary: 'État RÉEL des intégrations et services (aucune intégration simulée n’est présentée comme connectée)',
  })
  async etat() {
    const ocr = await fetch(`${this.cfg.OCR_URL}/sante`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => (r.ok ? { statut: 'disponible', detail: (await r.json()) as unknown } : { statut: 'indisponible', detail: `HTTP ${r.status}` }))
      .catch(() => ({ statut: 'indisponible', detail: 'injoignable' }));
    return {
      antivirus: { statut: (await clamdRepond(this.cfg.CLAMAV_HOST, this.cfg.CLAMAV_PORT)) ? 'disponible' : 'indisponible', obligatoire: this.cfg.ANTIVIRUS_OBLIGATOIRE },
      ocr,
      ia: { statut: new PasserelleIa(this.cfg).statut(), detail: 'Aucun traitement n’appelle l’IA à ce jour.' },
      messagerie: {
        gmail: { statut: 'non_connecte', detail: 'Connecteur développé et testé contre un simulateur ; aucune application OAuth réelle configurée.' },
        microsoft365: { statut: 'non_connecte', detail: 'Connecteur développé et testé contre un simulateur ; aucune application OAuth réelle configurée.' },
      },
      agregationBancaire: { statut: 'non_implemente', detail: 'Aucun prestataire choisi. Les imports de fichiers bancaires n’en dépendent pas.' },
    };
  }
}
