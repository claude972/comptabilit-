/**
 * Sonde de santé élargie (P4, D-102) : sobre, sans donnée, bornée.
 *  - la BASE est vitale : si elle ne répond pas, la sonde échoue (503), comme avant ;
 *  - Redis (files), stockage objet et fournisseur d'identité sont rapportés « ok » ou « indisponible » ; leur panne rend le statut
 *    « degrade » mais PAS une erreur HTTP (l'application sert encore ce qui n'en dépend pas : D-101) ; la sonde ne dit jamais POURQUOI
 *    (ni adresse, ni message d'erreur du service) ;
 *  - chaque sonde est bornée par un délai, les trois s'exécutent ensemble, et le résultat est gardé quelques secondes : une sonde
 *    interrogée en boucle ne démultiplie pas les appels aux dépendances.
 */
export type EtatDependance = 'ok' | 'indisponible';
export interface Sante {
  statut: 'ok' | 'degrade';
  dependances: { base: 'ok'; files: EtatDependance; stockage: EtatDependance; identite: EtatDependance };
}
export interface Sondes {
  files: () => Promise<unknown>;
  stockage: () => Promise<unknown>;
  identite: () => Promise<unknown>;
}

async function borner(sonde: () => Promise<unknown>, delaiMs: number): Promise<EtatDependance> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      sonde(),
      new Promise<never>((_, rejeter) => {
        minuterie = setTimeout(() => rejeter(new Error('délai')), delaiMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'indisponible';
  } finally {
    clearTimeout(minuterie);
  }
}

export class SondeSante {
  private memo: { jusqua: number; promesse: Promise<Sante['dependances']> } | null = null;
  constructor(
    private readonly sondes: Sondes,
    private readonly delaiMs = 1500,
    private readonly memoireMs = 5000,
    private readonly maintenant: () => number = Date.now,
  ) {}

  async evaluer(): Promise<Sante> {
    const t = this.maintenant();
    if (!this.memo || this.memo.jusqua <= t) {
      const promesse = Promise.all([borner(this.sondes.files, this.delaiMs), borner(this.sondes.stockage, this.delaiMs), borner(this.sondes.identite, this.delaiMs)]).then(
        ([files, stockage, identite]) => ({ base: 'ok' as const, files, stockage, identite }),
      );
      this.memo = { jusqua: t + this.memoireMs, promesse };
    }
    const dependances = await this.memo.promesse;
    const degrade = dependances.files !== 'ok' || dependances.stockage !== 'ok' || dependances.identite !== 'ok';
    return { statut: degrade ? 'degrade' : 'ok', dependances };
  }
}
