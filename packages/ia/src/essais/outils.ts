/** Outils de test : horloge simulée, journal d'audit en mémoire, passerelle adossée au SIMULATEUR. */
import type { EvenementAuditIa, TraceAppelIa, TraceFonctionMetier } from '../audit.js';
import type { FournisseurIa } from '../fournisseur.js';
import { PasserelleIa, type ConfigurationPasserelle } from '../passerelle.js';
import type { Horloge } from '../ports.js';
import { SimulateurIa } from '../simulateur/index.js';

export class HorlogeSimulee implements Horloge {
  attentes: number[] = [];
  #t = Date.parse('2026-11-19T10:00:00.000Z');
  maintenant(): Date {
    return new Date(this.#t);
  }
  async attendre(ms: number): Promise<void> {
    this.attentes.push(ms);
    this.#t += ms;
  }
  avancer(ms: number): void {
    this.#t += ms;
  }
}

export class JournalMemoire {
  evenements: EvenementAuditIa[] = [];
  consigner(e: EvenementAuditIa): void {
    this.evenements.push(e);
  }
  get appels(): TraceAppelIa[] {
    return this.evenements.filter((e): e is TraceAppelIa => e.type === 'appel_ia');
  }
  get fonctions(): TraceFonctionMetier[] {
    return this.evenements.filter((e): e is TraceFonctionMetier => e.type === 'fonction_metier');
  }
}

export const CONTEXTE = { cabinetId: 'CAB-1', dossierId: 'D-ALPHA', utilisateurId: 'U-1' };

export function monter(plus: Partial<ConfigurationPasserelle> = {}): { simulateur: SimulateurIa; journal: JournalMemoire; passerelle: PasserelleIa; horloge: HorlogeSimulee } {
  const simulateur = new SimulateurIa();
  const journal = new JournalMemoire();
  const horloge = new HorlogeSimulee();
  const passerelle = new PasserelleIa({ fournisseur: simulateur, journal, horloge, ...plus });
  return { simulateur, journal, passerelle, horloge };
}

/** Fournisseur « réel » factice pour les tests de statut : `nature = 'reel'`, réponses délégables. */
export function fauxFournisseurReel(urlBase: string, delegue: FournisseurIa, origineSimulateur = false): FournisseurIa {
  return {
    nature: 'reel',
    nom: 'faux-reel',
    urlBase,
    completer: async (d) => ({ ...(await delegue.completer(d)), origine: { url: `${urlBase}/chat/completions`, simulateur: origineSimulateur } }),
    vectoriser: async (d) => ({ ...(await delegue.vectoriser(d)), origine: { url: `${urlBase}/embeddings`, simulateur: origineSimulateur } }),
  };
}
