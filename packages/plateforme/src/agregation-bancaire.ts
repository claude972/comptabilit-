/**
 * Agrégation bancaire par un prestataire — PORT, adaptateur « pivot », simulateur de test, statut.
 *
 * ÉTAT RÉEL : aucun prestataire n'est choisi ni contracté. Un prestataire d'agrégation doit être un prestataire de
 * services d'information sur les comptes agréé ou enregistré (registre de l'ACPR / REGAFI) ; son statut et ses conditions
 * sont à vérifier avant tout branchement. Tant que ce n'est pas fait, le statut affiché est « non connecté », et les
 * imports de fichiers bancaires (camt.053, OFX, CSV) fonctionnent sans lui.
 *
 * Ce module fournit ce qui ne dépend pas de ce choix :
 *  - le PORT (`PrestataireAgregation`) que l'adaptateur du prestataire retenu devra implémenter ;
 *  - un adaptateur HTTP « pivot » pour un service exposant le contrat minimal décrit plus bas (c'est celui du simulateur
 *    de test ; un vrai prestataire aura son propre adaptateur, écrit quand il sera choisi) ;
 *  - la conversion vers le format pivot des relevés (`comtaple.releve-agregation/1`, lu par le moteur), dont le document
 *    est conservé comme original de l'import : la suite (idempotence, cadrage, versions) est celle des fichiers.
 *
 * Le recueil du consentement du client auprès de sa banque se fait CHEZ le prestataire : il n'est pas simulé ici.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FORMAT_RELEVE_AGREGATION, type ReleveAgregation, schemaReleveAgregation } from '@comtaple/core';
import type { Config } from './config.js';

export interface CompteAgrege {
  identifiant: string;
  libelle: string | null;
  iban: string | null;
  devise: string | null;
  solde: { montant: string; date: string } | null;
}
export interface MouvementAgrege {
  identifiant: string;
  dateOperation: string;
  dateValeur: string | null;
  /** Chaîne décimale signée : jamais un nombre flottant. */
  montant: string;
  libelle: string;
  contrepartie: string | null;
}

/** Ce que doit savoir faire l'adaptateur d'un prestataire. Lecture seule : aucun ordre de paiement. */
export interface PrestataireAgregation {
  /** Identifiant technique, repris dans la provenance des relevés. */
  readonly id: string;
  listerComptes(): Promise<CompteAgrege[]>;
  /** Mouvements comptabilisés du compte depuis une date incluse, toutes pages lues, dans la limite donnée. */
  listerMouvements(compteId: string, depuis: string, limite: number): Promise<{ mouvements: MouvementAgrege[]; tronque: boolean }>;
}

export type StatutAgregation = 'non_connecte' | 'simule' | 'configure_non_verifie';
export interface EtatAgregation {
  statut: StatutAgregation;
  detail: string;
  prestataire: PrestataireAgregation | null;
}

export class ErreurAgregation extends Error {}

const DELAI_MS = 20_000;
const PAGES_MAX = 50;

/**
 * Adaptateur du contrat HTTP pivot :
 *   GET {base}/comptes                                   → { comptes: CompteAgrege[] }
 *   GET {base}/comptes/{id}/mouvements?depuis=&curseur=  → { mouvements: MouvementAgrege[], suivant: string | null }
 * Authentification par jeton porteur. Les réponses sont validées ; un montant non décimal fait échouer l'appel.
 */
export class PrestatairePivot implements PrestataireAgregation {
  constructor(
    readonly id: string,
    private readonly base: string,
    private readonly jeton: string,
  ) {}

  private async lire(chemin: string): Promise<any> {
    let r: Response;
    try {
      // Aucune redirection suivie : un prestataire ne doit pas pouvoir renvoyer l'appel (et le jeton) ailleurs.
      r = await fetch(`${this.base.replace(/\/$/, '')}${chemin}`, { headers: { authorization: `Bearer ${this.jeton}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(DELAI_MS) });
    } catch {
      throw new ErreurAgregation('Prestataire d’agrégation injoignable');
    }
    if (r.status === 401 || r.status === 403) throw new ErreurAgregation('Accès refusé par le prestataire d’agrégation (jeton ou consentement expiré)');
    if (!r.ok) throw new ErreurAgregation(`Prestataire d’agrégation : HTTP ${r.status}`);
    try {
      return await r.json();
    } catch {
      throw new ErreurAgregation('Réponse illisible du prestataire d’agrégation');
    }
  }

  async listerComptes(): Promise<CompteAgrege[]> {
    const d = await this.lire('/comptes');
    if (!Array.isArray(d?.comptes)) throw new ErreurAgregation('Réponse inattendue du prestataire d’agrégation (comptes)');
    return d.comptes.slice(0, 200).map((c: any) => ({
      identifiant: String(c.identifiant ?? ''),
      libelle: typeof c.libelle === 'string' ? c.libelle.slice(0, 120) : null,
      iban: typeof c.iban === 'string' ? c.iban : null,
      devise: typeof c.devise === 'string' ? c.devise : null,
      solde: c.solde && typeof c.solde.montant === 'string' && typeof c.solde.date === 'string' ? { montant: c.solde.montant, date: c.solde.date } : null,
    })).filter((c: CompteAgrege) => c.identifiant !== '');
  }

  async listerMouvements(compteId: string, depuis: string, limite: number): Promise<{ mouvements: MouvementAgrege[]; tronque: boolean }> {
    const mouvements: MouvementAgrege[] = [];
    let curseur: string | null = null;
    for (let page = 0; page < PAGES_MAX; page++) {
      const q = new URLSearchParams({ depuis, ...(curseur ? { curseur } : {}) });
      const d = await this.lire(`/comptes/${encodeURIComponent(compteId)}/mouvements?${q}`);
      if (!Array.isArray(d?.mouvements)) throw new ErreurAgregation('Réponse inattendue du prestataire d’agrégation (mouvements)');
      for (const m of d.mouvements) {
        if (mouvements.length >= limite) return { mouvements, tronque: true };
        mouvements.push({
          identifiant: String(m.identifiant ?? ''),
          dateOperation: String(m.dateOperation ?? ''),
          dateValeur: typeof m.dateValeur === 'string' ? m.dateValeur : null,
          montant: typeof m.montant === 'string' ? m.montant : '', // un nombre est refusé à la validation du document
          libelle: typeof m.libelle === 'string' ? m.libelle : '',
          contrepartie: typeof m.contrepartie === 'string' ? m.contrepartie : null,
        });
      }
      curseur = typeof d.suivant === 'string' && d.suivant !== '' ? d.suivant : null;
      if (curseur === null) return { mouvements, tronque: false };
    }
    return { mouvements, tronque: true };
  }
}

/**
 * Document pivot d'un compte, validé. Il devient l'ORIGINAL de l'import. Deux extractions identiques donnent le même
 * document (donc la même empreinte) : `extraitLe` est tronqué au jour pour ne pas défaire l'idempotence d'une relance.
 */
export function documentReleveAgregation(prestataire: string, compte: CompteAgrege, mouvements: MouvementAgrege[], jour: string): { document: ReleveAgregation; octets: Buffer } {
  const document = schemaReleveAgregation.safeParse({
    format: FORMAT_RELEVE_AGREGATION,
    prestataire,
    extraitLe: jour,
    comptes: [{ identifiant: compte.identifiant, iban: compte.iban, devise: compte.devise, solde: compte.solde, mouvements }],
  });
  if (!document.success) {
    const p = document.error.issues[0];
    throw new ErreurAgregation(`Données du prestataire d’agrégation non conformes (${p ? `${p.path.join('.')} : ${p.message}` : 'structure'})`);
  }
  return { document: document.data, octets: Buffer.from(JSON.stringify(document.data), 'utf8') };
}

/**
 * État de l'agrégation d'après la configuration. Jamais « connecté » : ce statut exigera un prestataire choisi, ses hôtes
 * officiels connus et un appel réel réussi. Le simulateur est refusé en production.
 */
export function agregationBancaire(cfg: Pick<Config, 'AGREGATION_SIMULATEUR_URL' | 'AGREGATION_URL' | 'AGREGATION_JETON' | 'AGREGATION_PRESTATAIRE'>): EtatAgregation {
  if (cfg.AGREGATION_SIMULATEUR_URL) {
    if (process.env.NODE_ENV === 'production') throw new Error('AGREGATION_SIMULATEUR_URL est interdit avec NODE_ENV=production');
    return { statut: 'simule', detail: 'SIMULATEUR de test : aucune banque réelle n’est interrogée.', prestataire: new PrestatairePivot('simulateur', cfg.AGREGATION_SIMULATEUR_URL, 'jeton-simulateur') };
  }
  if (cfg.AGREGATION_URL && cfg.AGREGATION_JETON && cfg.AGREGATION_PRESTATAIRE) {
    if (!cfg.AGREGATION_URL.startsWith('https://')) throw new Error('AGREGATION_URL doit être une adresse https');
    return {
      statut: 'configure_non_verifie',
      detail: `Service « ${cfg.AGREGATION_PRESTATAIRE} » configuré au contrat pivot ; aucune vérification de son statut réglementaire ni de ses conditions n’est enregistrée.`,
      prestataire: new PrestatairePivot(cfg.AGREGATION_PRESTATAIRE, cfg.AGREGATION_URL, cfg.AGREGATION_JETON),
    };
  }
  return { statut: 'non_connecte', detail: 'Aucun prestataire d’agrégation choisi ni contracté. Les imports de fichiers bancaires n’en dépendent pas.', prestataire: null };
}

// ───────────────────────────── SIMULATEUR de test (jamais en production) ─────────────────────────────

export interface SimulateurAgregation {
  origine: string;
  comptes: Array<CompteAgrege & { mouvements: MouvementAgrege[] }>;
  /** Prochaine réponse forcée (ex. 401 pour un consentement expiré), consommée une fois. */
  forcer(statut: number): void;
  /** Requêtes reçues (chemins), pour vérifier ce qui a été demandé. */
  requetes: string[];
  arreter(): Promise<void>;
}

/** Démarre un service local implémentant le contrat pivot, avec pagination (2 mouvements par page). */
export async function demarrerSimulateurAgregation(comptes: SimulateurAgregation['comptes']): Promise<SimulateurAgregation> {
  let force: number | null = null;
  const requetes: string[] = [];
  const serveur: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://simulateur');
    requetes.push(url.pathname + url.search);
    const repondre = (statut: number, corps: unknown) => {
      res.writeHead(statut, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (req.headers.authorization !== 'Bearer jeton-simulateur') return repondre(401, { erreur: 'jeton' });
    if (force !== null) {
      const s = force;
      force = null;
      return repondre(s, { erreur: 'forcee' });
    }
    if (url.pathname === '/comptes') return repondre(200, { comptes: comptes.map(({ mouvements: _m, ...c }) => c) });
    const m = /^\/comptes\/([^/]+)\/mouvements$/.exec(url.pathname);
    const compte = m ? comptes.find((c) => c.identifiant === decodeURIComponent(m[1]!)) : undefined;
    if (!compte) return repondre(404, { erreur: 'inconnu' });
    const depuis = url.searchParams.get('depuis') ?? '';
    const tous = compte.mouvements.filter((x) => x.dateOperation >= depuis);
    const debut = Number(url.searchParams.get('curseur') ?? '0');
    const page = tous.slice(debut, debut + 2);
    return repondre(200, { mouvements: page, suivant: debut + 2 < tous.length ? String(debut + 2) : null });
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
  const port = (serveur.address() as AddressInfo).port;
  return {
    origine: `http://127.0.0.1:${port}`,
    comptes,
    requetes,
    forcer: (s) => {
      force = s;
    },
    arreter: () => new Promise<void>((r) => serveur.close(() => r())),
  };
}
