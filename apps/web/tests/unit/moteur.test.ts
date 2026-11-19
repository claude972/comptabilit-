import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type EtatDepot, repriseAutomatique, transition } from '@/lib/televersement/etats';
import { ErreurHttp, ErreurReseau, type Ouverture, type Transport, televerser } from '@/lib/televersement/moteur';
import type { VueTeleversement, VueTerminee } from '@/lib/types-api';

/** Serveur de téléversement en mémoire, calqué sur le contrôleur de l'API (409 sur décalage inattendu, rejeu sûr, vérification d'empreinte). */
class ServeurMemoire implements Transport {
  tailleMorceau = 4;
  sessions = new Map<string, { o: Ouverture; recus: Uint8Array; octetsRecus: number; statut: VueTeleversement['statut'] }>();
  appels: string[] = [];
  /** Pannes programmées : fonction appelée avant chaque opération ; peut lever. */
  avant: (operation: string, n: number) => void = () => undefined;
  /** Si vrai, le morceau est enregistré mais la réponse est perdue (coupure après réception). */
  perdreReponseMorceau: (n: number) => boolean = () => false;
  private compteur = 0;

  private vue(id: string): VueTeleversement {
    const s = this.sessions.get(id);
    if (!s) throw new ErreurHttp(404, { message: 'Téléversement introuvable' });
    return { id, statut: s.statut, octetsRecus: s.octetsRecus, tailleAttendue: s.o.taille, tailleMorceau: this.tailleMorceau, documentId: null, lotImportId: null, expireLe: '' };
  }
  private tracer(op: string) {
    this.appels.push(op);
    this.avant(op, this.appels.filter((a) => a.split(' ')[0] === op.split(' ')[0]).length);
  }
  async ouvrir(o: Ouverture) {
    this.tracer('ouvrir');
    for (const [id, s] of this.sessions) if (s.statut === 'ouvert' && s.o.sha256 === o.sha256 && s.o.taille === o.taille) return this.vue(id);
    const id = `t${++this.compteur}`;
    this.sessions.set(id, { o, recus: new Uint8Array(o.taille), octetsRecus: 0, statut: 'ouvert' });
    return this.vue(id);
  }
  async etat(id: string) {
    this.tracer('etat');
    return this.vue(id);
  }
  async envoyerMorceau(id: string, decalage: number, donnees: Blob) {
    this.tracer(`morceau ${decalage}`);
    const s = this.sessions.get(id);
    if (!s) throw new ErreurHttp(404, { message: 'Téléversement introuvable' });
    if (s.statut !== 'ouvert') throw new ErreurHttp(409, { message: 'Téléversement clos', statut: s.statut });
    const octets = new Uint8Array(await donnees.arrayBuffer());
    if (octets.length > this.tailleMorceau) throw new ErreurHttp(413, { message: 'Morceau trop volumineux' });
    if (decalage + octets.length <= s.octetsRecus) return this.vue(id);
    if (decalage !== s.octetsRecus) throw new ErreurHttp(409, { message: 'Décalage inattendu', octetsRecus: s.octetsRecus });
    s.recus.set(octets, decalage);
    s.octetsRecus = decalage + octets.length;
    if (this.perdreReponseMorceau(this.appels.filter((a) => a.startsWith('morceau')).length)) throw new ErreurReseau('réponse perdue');
    return this.vue(id);
  }
  async terminer(id: string): Promise<VueTerminee> {
    this.tracer('terminer');
    const s = this.sessions.get(id);
    if (!s) throw new ErreurHttp(404, { message: 'Téléversement introuvable' });
    if (s.statut !== 'complet') {
      if (s.octetsRecus !== s.o.taille) throw new ErreurHttp(409, { message: 'Téléversement incomplet', octetsRecus: s.octetsRecus, tailleAttendue: s.o.taille });
      if (createHash('sha256').update(s.recus).digest('hex') !== s.o.sha256) {
        s.statut = 'refuse';
        throw new ErreurHttp(422, { message: 'Le fichier reçu ne correspond pas à l’empreinte annoncée' });
      }
      s.statut = 'complet';
    }
    return { ...this.vue(id), recu: true, doublonBinaire: false, dejaImporte: false };
  }
}

const contenu = new Uint8Array(Array.from({ length: 10 }, (_, i) => i + 1));
const fichier = () => new Blob([contenu]);
const ouverture = (sha = createHash('sha256').update(contenu).digest('hex')): Ouverture => ({ entiteId: 'e', nomFichier: 'f.pdf', taille: 10, sha256: sha, canal: 'telephone' });

describe('téléversement reprenable', () => {
  it('envoie les morceaux dans l’ordre puis ne déclare « reçu » qu’après terminer', async () => {
    const serveur = new ServeurMemoire();
    const progression: number[] = [];
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, surProgression: (p) => progression.push(p.octetsConfirmes) });
    expect(r.issue).toBe('recu');
    expect(serveur.appels).toEqual(['ouvrir', 'morceau 0', 'morceau 4', 'morceau 8', 'terminer']);
    expect(progression).toEqual([0, 4, 8, 10, 10]);
    expect(Array.from(serveur.sessions.get('t1')!.recus)).toEqual(Array.from(contenu));
  });

  it('s’arrête sur une coupure en rapportant les octets confirmés, puis reprend au bon décalage', async () => {
    const serveur = new ServeurMemoire();
    serveur.avant = (op) => {
      if (op === 'morceau 4') throw new ErreurReseau('coupure');
    };
    const premier = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    expect(premier).toEqual({ issue: 'coupure', televersementId: 't1', octetsConfirmes: 4 });

    serveur.avant = () => undefined;
    serveur.appels = [];
    const second = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, televersementId: 't1' });
    expect(second.issue).toBe('recu');
    expect(serveur.appels).toEqual(['etat', 'morceau 4', 'morceau 8', 'terminer']); // rien n'est renvoyé depuis le début
  });

  it('reprend après une réponse perdue : le morceau reçu par le serveur n’est pas renvoyé', async () => {
    const serveur = new ServeurMemoire();
    serveur.perdreReponseMorceau = (n) => n === 2;
    const premier = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    expect(premier).toMatchObject({ issue: 'coupure', octetsConfirmes: 4 }); // côté client : 4 ; côté serveur : 8
    serveur.perdreReponseMorceau = () => false;
    serveur.appels = [];
    const second = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, televersementId: 't1' });
    expect(second.issue).toBe('recu');
    expect(serveur.appels).toEqual(['etat', 'morceau 8', 'terminer']);
  });

  it('sur un 409 « décalage inattendu », reprend à octetsRecus indiqué par le serveur', async () => {
    const serveur = new ServeurMemoire();
    // Le client croit reprendre à 0 alors que le serveur a déjà 4 octets (état local périmé, sans appel préalable à etat).
    const vraiOuvrir = serveur.ouvrir.bind(serveur);
    serveur.ouvrir = async (o) => {
      const v = await vraiOuvrir(o);
      serveur.sessions.get(v.id)!.recus.set(contenu.slice(0, 4), 0);
      serveur.sessions.get(v.id)!.octetsRecus = 4;
      return { ...v, octetsRecus: 0 };
    };
    // Morceaux de 3 octets : « 0-3 » est déjà couvert (rejeu accepté), « 3-6 » chevauche → 409.
    serveur.tailleMorceau = 3;
    const progression: number[] = [];
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, surProgression: (p) => progression.push(p.octetsConfirmes) });
    expect(r.issue).toBe('recu');
    expect(serveur.appels).toEqual(['ouvrir', 'morceau 0', 'morceau 4', 'morceau 7', 'terminer']);
    expect(Array.from(serveur.sessions.get('t1')!.recus)).toEqual(Array.from(contenu));
  });

  it('gère le 409 strict (désaccord pur) en repartant du décalage du serveur', async () => {
    const serveur = new ServeurMemoire();
    let faux = true;
    const vraiEnvoi = serveur.envoyerMorceau.bind(serveur);
    serveur.envoyerMorceau = async (id, decalage, donnees) => {
      if (faux && decalage === 4) {
        faux = false;
        serveur.appels.push('morceau 4 (409)');
        throw new ErreurHttp(409, { message: 'Décalage inattendu', octetsRecus: 2 });
      }
      return vraiEnvoi(id, decalage, donnees);
    };
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    // Le serveur simulé a réellement 4 octets : le morceau « 2-6 » chevauche → nouveau 409 réel à 4, puis reprise.
    expect(r.issue).toBe('recu');
    expect(serveur.appels.filter((a) => a.startsWith('morceau'))).toEqual(['morceau 0', 'morceau 4 (409)', 'morceau 2', 'morceau 4', 'morceau 8']);
  });

  it('abandonne proprement après des désaccords répétés (pas de boucle infinie)', async () => {
    const serveur = new ServeurMemoire();
    serveur.envoyerMorceau = async () => {
      throw new ErreurHttp(409, { message: 'Décalage inattendu', octetsRecus: 1 });
    };
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    expect(r.issue).toBe('interrompu');
  });

  it('rouvre un téléversement inconnu du serveur (expiré) lors d’une reprise', async () => {
    const serveur = new ServeurMemoire();
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, televersementId: 'disparu' });
    expect(r.issue).toBe('recu');
    expect(serveur.appels.slice(0, 2)).toEqual(['etat', 'ouvrir']);
  });

  it('une coupure pendant terminer ne donne pas « reçu » ; la reprise confirme sans rien renvoyer', async () => {
    const serveur = new ServeurMemoire();
    serveur.avant = (op) => {
      if (op === 'terminer') throw new ErreurReseau('coupure');
    };
    const premier = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    expect(premier).toMatchObject({ issue: 'coupure', octetsConfirmes: 10 });
    serveur.avant = () => undefined;
    serveur.appels = [];
    const second = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, televersementId: 't1' });
    expect(second.issue).toBe('recu');
    expect(serveur.appels).toEqual(['etat', 'terminer']);
  });

  it('reprend après terminer réussi côté serveur mais réponse perdue (téléversement « complet »)', async () => {
    const serveur = new ServeurMemoire();
    await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur });
    serveur.appels = [];
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, televersementId: 't1' });
    expect(r.issue).toBe('recu');
    expect(serveur.appels).toEqual(['etat', 'terminer']);
  });

  it('signale un refus définitif si l’empreinte ne correspond pas (422)', async () => {
    const serveur = new ServeurMemoire();
    const r = await televerser({ fichier: fichier(), ouverture: ouverture('0'.repeat(64)), transport: serveur });
    expect(r).toMatchObject({ issue: 'refuse', statut: 422 });
  });

  it('distingue session expirée (401), erreur serveur (5xx) et refus (403/413)', async () => {
    for (const [statut, issue] of [[401, 'session_expiree'], [503, 'interrompu'], [403, 'refuse'], [413, 'refuse']] as const) {
      const serveur = new ServeurMemoire();
      serveur.avant = (op) => {
        if (op === 'ouvrir') throw new ErreurHttp(statut, { message: 'x' });
      };
      expect((await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur })).issue).toBe(issue);
    }
  });

  it('s’interrompt sur annulation', async () => {
    const serveur = new ServeurMemoire();
    const controleur = new AbortController();
    serveur.avant = (op) => {
      if (op === 'morceau 4') controleur.abort();
    };
    const r = await televerser({ fichier: fichier(), ouverture: ouverture(), transport: serveur, signal: controleur.signal });
    expect(r.issue).toBe('annule');
  });
});

describe('machine d’états d’un dépôt', () => {
  const recu = { issue: 'recu', vue: { recu: true } } as never;
  it('« reçu » n’est atteint que par la confirmation du serveur', () => {
    const etats: EtatDepot[] = ['en_file', 'envoi', 'attente_connexion', 'interrompu'];
    for (const e of etats) {
      expect(transition(e, { type: 'demarrer', enLigne: true })).not.toBe('recu');
      expect(transition(e, { type: 'retour_reseau' })).not.toBe('recu');
      expect(transition(e, { type: 'hors_ligne' })).not.toBe('recu');
    }
    expect(transition('envoi', { type: 'issue', issue: recu, enLigne: true })).toBe('recu');
    expect(transition('envoi', { type: 'issue', issue: { issue: 'recu', vue: { recu: false } } as never, enLigne: true })).toBe('interrompu');
  });
  it('une coupure hors ligne met en attente de connexion ; en ligne, elle interrompt', () => {
    const coupure = { issue: 'coupure', televersementId: 't', octetsConfirmes: 4 } as const;
    expect(transition('envoi', { type: 'issue', issue: coupure, enLigne: false })).toBe('attente_connexion');
    expect(transition('envoi', { type: 'issue', issue: coupure, enLigne: true })).toBe('interrompu');
    expect(transition('envoi', { type: 'hors_ligne' })).toBe('attente_connexion');
    expect(transition('en_file', { type: 'demarrer', enLigne: false })).toBe('attente_connexion');
  });
  it('le retour du réseau remet en file les dépôts en attente, sans toucher aux dépôts interrompus', () => {
    expect(transition('attente_connexion', { type: 'retour_reseau' })).toBe('en_file');
    expect(transition('interrompu', { type: 'retour_reseau' })).toBe('interrompu');
    expect(repriseAutomatique('attente_connexion')).toBe(true);
    expect(repriseAutomatique('interrompu')).toBe(false);
    expect(repriseAutomatique('envoi')).toBe(false);
  });
  it('les états terminaux ne bougent plus', () => {
    expect(transition('recu', { type: 'hors_ligne' })).toBe('recu');
    expect(transition('refuse', { type: 'demarrer', enLigne: true })).toBe('refuse');
    expect(transition('envoi', { type: 'issue', issue: { issue: 'refuse', statut: 422, message: '' }, enLigne: true })).toBe('refuse');
    expect(transition('envoi', { type: 'issue', issue: { issue: 'session_expiree', televersementId: null, octetsConfirmes: 0 }, enLigne: true })).toBe('interrompu');
  });
});
