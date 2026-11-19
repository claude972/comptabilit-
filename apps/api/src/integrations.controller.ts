import { connect } from 'node:net';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AccesBd, sql } from '@comtaple/db';
import { evaluerStatutIntegration, type IdFournisseur, type PreuveConnexion } from '@comtaple/mail';
import { type Config, type ConnecteursMail, type EtatAgregation, fournisseurDepuisBd, type FournisseurBd, PasserelleIa } from '@comtaple/plateforme';
import { type Acces, AccesCourant } from './acces.js';
import { AGREGATION, BD, CONFIG, MAIL } from './jetons.js';

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
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(BD) private readonly bd: AccesBd,
    @Inject(MAIL) private readonly mail: ConnecteursMail,
    @Inject(AGREGATION) private readonly agregation: EtatAgregation,
  ) {}

  /**
   * Statut d'un connecteur de messagerie pour le cabinet courant : « connecte » seulement si une connexion a réussi un
   * appel de lecture sur les hôtes OFFICIELS du fournisseur. Le simulateur de test ne peut pas donner ce statut.
   */
  private messagerie(fournisseur: IdFournisseur, preuves: PreuveConnexion[]) {
    const etat = this.mail.etat[fournisseur];
    if (!etat.configure) return { statut: 'non_connecte', detail: etat.detail };
    const evaluations = preuves.filter((p) => p.fournisseur === fournisseur).map((p) => evaluerStatutIntegration(fournisseur, p));
    if (evaluations.some((e) => e.statut === 'connecte')) return { statut: 'connecte', detail: 'Connexion réelle vérifiée auprès du fournisseur.' };
    const raisons = evaluations[0]?.raisons ?? evaluerStatutIntegration(fournisseur, null).raisons;
    return { statut: 'non_connecte', detail: raisons.join(' ') };
  }

  @Get()
  @ApiOperation({
    summary: 'État RÉEL des intégrations et services (aucune intégration simulée n’est présentée comme connectée)',
  })
  async etat(@AccesCourant() acces: Acces) {
    const preuves = await this.bd.avecContexte(acces, async (tx) => {
      const r = await tx.execute(sql`select fournisseur, preuve from mail_preuves_integration()`);
      return (r.rows as Array<{ fournisseur: FournisseurBd; preuve: PreuveConnexion }>).map((l) => ({ ...l.preuve, fournisseur: fournisseurDepuisBd(l.fournisseur) }));
    });
    const ocr = await fetch(`${this.cfg.OCR_URL}/sante`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => (r.ok ? { statut: 'disponible', detail: (await r.json()) as unknown } : { statut: 'indisponible', detail: `HTTP ${r.status}` }))
      .catch(() => ({ statut: 'indisponible', detail: 'injoignable' }));
    return {
      antivirus: { statut: (await clamdRepond(this.cfg.CLAMAV_HOST, this.cfg.CLAMAV_PORT)) ? 'disponible' : 'indisponible', obligatoire: this.cfg.ANTIVIRUS_OBLIGATOIRE },
      ocr,
      ia: { statut: new PasserelleIa(this.cfg).statut(), detail: 'Aucun traitement n’appelle l’IA à ce jour.' },
      messagerie: { gmail: this.messagerie('gmail', preuves), microsoft365: this.messagerie('microsoft', preuves) },
      agregationBancaire: { statut: this.agregation.statut, detail: this.agregation.detail },
    };
  }
}
