/** Erreurs typées du paquet. Les messages ne contiennent jamais de jeton ni de contenu de message. */

export class ErreurMail extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Le jeton de rafraîchissement est refusé (`invalid_grant`) : la connexion est révoquée. */
export class ErreurJetonRevoque extends ErreurMail {
  constructor() {
    super('jeton_revoque', 'Le fournisseur refuse le jeton de rafraîchissement (invalid_grant).');
  }
}

/** 401 persistant malgré un renouvellement du jeton d'accès. */
export class ErreurConnexionExpiree extends ErreurMail {
  constructor(motif: string) {
    super('connexion_expiree', motif);
  }
}

/** Erreur passagère (quota, 5xx, réseau) après épuisement des reprises. */
export class ErreurTemporaire extends ErreurMail {
  constructor(
    readonly statutHttp: number | null,
    readonly reprendreApresMs: number | null,
  ) {
    super('temporaire', `Erreur passagère du fournisseur (statut ${statutHttp ?? 'réseau'}).`);
  }
}

/** Le curseur incrémental n'est plus valable (404 Gmail, 410 / syncStateNotFound Graph). */
export class ErreurCurseurExpire extends ErreurMail {
  constructor() {
    super('curseur_expire', 'Le curseur de synchronisation a expiré : resynchronisation complète bornée.');
  }
}

/** Réponse inattendue du fournisseur. */
export class ErreurProtocole extends ErreurMail {
  constructor(message: string) {
    super('protocole', message);
  }
}

/** Erreur du parcours OAuth (retour d'autorisation invalide, échange refusé, scope manquant…). */
export class ErreurOAuth extends ErreurMail {}

/** Tentative de requête vers un hôte qui n'est pas celui du fournisseur : toujours refusée. */
export class ErreurHoteInterdit extends ErreurMail {
  constructor() {
    super('hote_interdit', 'Requête refusée : hôte hors de la liste des hôtes du fournisseur.');
  }
}

/** Notification entrante non authentique (jeton OIDC Pub/Sub ou clientState Graph invalide). */
export class ErreurNotification extends ErreurMail {}

export class ErreurChiffrement extends ErreurMail {}
