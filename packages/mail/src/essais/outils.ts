/** Outils de test : ports en mémoire, horloge simulée et banc d'essai branché sur le simulateur. */
import { createHash } from 'node:crypto';
import type { ConfigurationConnexionEntree } from '../configuration.js';
import { creerFournisseurGmail } from '../fournisseurs/gmail.js';
import { creerFournisseurMicrosoft } from '../fournisseurs/microsoft.js';
import type { TypeBoite } from '../oauth.js';
import type { EvenementJournal, Horloge, Http, Journal, MagasinConnexions, MemoireEmpreintes, RecepteurPieces } from '../ports.js';
import { demarrerSimulateur, type SimulateurMail } from '../simulateur/index.js';
import { creerMoteurMail, type MoteurMail } from '../synchronisation.js';
import type { EtatConnexion, ExtraitQualification, IdFournisseur, Provenance, ProvenanceDepot, Rattachement, Signalement } from '../types.js';

export const DEBUT = new Date('2026-11-19T10:00:00.000Z');
export const JOUR = 24 * 3600 * 1000;
export const joursAvant = (n: number): Date => new Date(DEBUT.getTime() - n * JOUR);

export class HorlogeSimulee implements Horloge {
  t = DEBUT.getTime();
  readonly attentes: number[] = [];
  maintenant(): Date {
    return new Date(this.t);
  }
  attendre(ms: number): Promise<void> {
    this.attentes.push(ms);
    this.t += ms;
    return Promise.resolve();
  }
  avancer(ms: number): void {
    this.t += ms;
  }
}

export class MagasinMemoire implements MagasinConnexions {
  readonly etats = new Map<string, EtatConnexion>();
  lire(id: string): Promise<EtatConnexion | null> {
    const etat = this.etats.get(id);
    return Promise.resolve(etat ? structuredClone(etat) : null);
  }
  enregistrer(etat: EtatConnexion): Promise<void> {
    this.etats.set(etat.id, structuredClone(etat));
    return Promise.resolve();
  }
  obtenir(id: string): EtatConnexion {
    const etat = this.etats.get(id);
    if (!etat) throw new Error('état absent');
    return etat;
  }
}

export interface Depot {
  provenance: Provenance;
  rattachement: Rattachement;
  extrait: ExtraitQualification;
  octets: Buffer;
}

export class RecepteurMemoire implements RecepteurPieces {
  readonly depots: Depot[] = [];
  readonly signalements: Signalement[] = [];
  private readonly vues = new Set<string>();
  pieceDejaVue(connexionId: string, idMessage: string, idPieceJointe: string): Promise<boolean> {
    return Promise.resolve(this.vues.has(`${connexionId}|${idMessage}|${idPieceJointe}`));
  }
  async deposer(flux: AsyncIterable<Uint8Array>, provenance: ProvenanceDepot, rattachement: Rattachement, extrait: ExtraitQualification): Promise<void> {
    const blocs: Uint8Array[] = [];
    for await (const bloc of flux) blocs.push(bloc);
    const octets = Buffer.concat(blocs);
    const cle = `${provenance.connexionId}|${provenance.idMessage}|${provenance.idPieceJointe}`;
    if (this.vues.has(cle)) throw new Error(`doublon déposé : ${cle}`);
    this.vues.add(cle);
    this.depots.push({ provenance: { ...provenance, taille: octets.byteLength, empreinteSha256: await provenance.empreinteSha256 }, rattachement, extrait, octets });
  }
  signaler(signalement: Signalement): Promise<void> {
    this.signalements.push(signalement);
    return Promise.resolve();
  }
  get noms(): string[] {
    return this.depots.map((d) => d.provenance.nomFichier).sort();
  }
}

export class JournalMemoire implements Journal {
  readonly evenements: EvenementJournal[] = [];
  consigner(evenement: EvenementJournal): void {
    this.evenements.push(evenement);
  }
}

export class EmpreintesMemoire implements MemoireEmpreintes {
  private readonly vues = new Map<string, Set<string>>();
  noterImage(connexionId: string, empreinte: string, idMessage: string): Promise<number> {
    const cle = `${connexionId}|${empreinte}`;
    const messages = this.vues.get(cle) ?? new Set<string>();
    messages.add(idMessage);
    this.vues.set(cle, messages);
    return Promise.resolve(messages.size);
  }
}

export const sha256 = (octets: Uint8Array): string => createHash('sha256').update(octets).digest('hex');

export function pdf(texte: string, taille = 2048): Buffer {
  return Buffer.concat([Buffer.from(`%PDF-1.4\n% ${texte}\n`), Buffer.alloc(taille, 0x20), Buffer.from('\n%%EOF\n')]);
}

/** Image PNG factice : en-tête valide (signature + IHDR avec les dimensions), complétée jusqu'à la taille voulue. */
export function png(largeur: number, hauteur: number, taille: number, graine = 1): Buffer {
  const octets = Buffer.alloc(Math.max(taille, 33), graine);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(octets, 0);
  octets.writeUInt32BE(13, 8);
  octets.write('IHDR', 12, 'ascii');
  octets.writeUInt32BE(largeur, 16);
  octets.writeUInt32BE(hauteur, 20);
  return octets;
}

export const SECRET_ETAT = Buffer.alloc(32, 7);
export const CLE = { id: 'cle-2026', cle: Buffer.alloc(32, 9) };
export const CLIENT = { clientId: 'client-test', clientSecret: 'secret-de-test', uriRedirection: 'http://localhost:3000/retour' };

export interface Banc {
  sim: SimulateurMail;
  horloge: HorlogeSimulee;
  magasin: MagasinMemoire;
  recepteur: RecepteurMemoire;
  journal: JournalMemoire;
  moteur: MoteurMail;
  /** Hôtes de toutes les requêtes émises par le paquet. */
  hotes: string[];
  connecter(fournisseur: IdFournisseur, configuration?: Partial<ConfigurationConnexionEntree>, connexionId?: string): Promise<EtatConnexion>;
  fermer(): Promise<void>;
}

export async function creerBanc(options: { avecEmpreintes?: boolean; notifications?: boolean } = {}): Promise<Banc> {
  const sim = await demarrerSimulateur();
  const horloge = new HorlogeSimulee();
  sim.maintenant = () => horloge.maintenant();
  const magasin = new MagasinMemoire();
  const recepteur = new RecepteurMemoire();
  const journal = new JournalMemoire();
  const hotes: string[] = [];
  const http: Http = (url, init) => {
    hotes.push(new URL(url).host);
    return fetch(url, init);
  };
  const notifications = options.notifications ?? true;
  const fournisseurs = {
    gmail: creerFournisseurGmail({
      client: CLIENT,
      urls: sim.urlsGmail,
      ...(notifications ? { sujetPubSub: 'projects/projet-simule/topics/gmail' } : {}),
    }),
    microsoft: creerFournisseurMicrosoft({
      client: CLIENT,
      urls: sim.urlsMicrosoft,
      ...(notifications ? { urlNotification: 'https://api.comtaple.test/graph', urlCycleDeVie: 'https://api.comtaple.test/graph/cycle' } : {}),
    }),
  };
  const moteur = creerMoteurMail({
    fournisseurs,
    magasin,
    recepteur,
    journal,
    horloge,
    http,
    trousseau: { courante: CLE },
    hasard: () => 0.5,
    ...(options.avecEmpreintes ? { memoireEmpreintes: new EmpreintesMemoire() } : {}),
  });
  let compteur = 0;
  return {
    sim,
    horloge,
    magasin,
    recepteur,
    journal,
    moteur,
    hotes,
    async connecter(fournisseur, configuration = {}, connexionId = `cx-${++compteur}`) {
      const boite: TypeBoite = (configuration.boite as TypeBoite | undefined) ?? { type: 'personnelle' };
      const demande = fournisseurs[fournisseur].preparerAutorisation({
        boite,
        sessionId: 'session-1',
        secretEtat: SECRET_ETAT,
        maintenant: horloge.maintenant(),
      });
      // Le « navigateur » suit l'URL d'autorisation ; le simulateur redirige avec code et state.
      const redirection = await fetch(demande.url, { redirect: 'manual' });
      const retour = new URL(redirection.headers.get('location') ?? '').searchParams;
      return moteur.creerConnexion({
        connexionId,
        retour,
        attendu: demande.aConserver,
        sessionId: 'session-1',
        secretEtat: SECRET_ETAT,
        configuration: {
          fournisseur,
          rattachement: { dossiersComptables: ['DOSSIER-A', 'DOSSIER-B'], dossierParDefaut: 'DOSSIER-A' },
          ...configuration,
        },
      });
    },
    fermer: () => sim.arreter(),
  };
}

/** Ajoute un message au simulateur du fournisseur voulu. */
export function ajouter(
  banc: Banc,
  fournisseur: IdFournisseur,
  message: Partial<Parameters<SimulateurMail['ajouterMessageGmail']>[0]>,
  options: { boite?: string } = {},
): string {
  const complet = {
    de: 'Fournisseur <facturation@fournisseur.example>',
    a: ['compta@cabinet-simule.test'],
    objet: 'Votre facture',
    texte: 'Bonjour, veuillez trouver votre facture en pièce jointe.',
    date: joursAvant(1),
    ...message,
  };
  return fournisseur === 'gmail' ? banc.sim.ajouterMessageGmail(complet) : banc.sim.ajouterMessageMicrosoft(complet, options);
}
