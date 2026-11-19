/** Erreurs typées du paquet. Les messages ne contiennent jamais de jeton, de prompt ni de réponse du modèle. */

export class ErreurIa extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Configuration absente ou invalide (URL non https, jeton vide…). */
export class ErreurIaConfiguration extends ErreurIa {
  constructor(message: string) {
    super('configuration', message);
  }
}

/** 401 / 403 : jeton refusé. Jamais réessayé. */
export class ErreurIaAuthentification extends ErreurIa {
  constructor(readonly statutHttp: number) {
    super('authentification', `Le fournisseur IA refuse le jeton (statut ${statutHttp}).`);
  }
}

/** Autre 4xx : requête refusée (schéma non accepté, modèle inconnu, contexte trop long…). Jamais réessayé. */
export class ErreurIaRequete extends ErreurIa {
  constructor(readonly statutHttp: number) {
    super('requete_refusee', `Le fournisseur IA refuse la requête (statut ${statutHttp}).`);
  }
}

/** 429 / 5xx / réseau, après épuisement des reprises. */
export class ErreurIaTemporaire extends ErreurIa {
  constructor(
    readonly statutHttp: number | null,
    readonly reprendreApresMs: number | null,
    readonly tentatives: number,
  ) {
    super('temporaire', `Erreur passagère du fournisseur IA (statut ${statutHttp ?? 'réseau'}) après ${tentatives} tentative(s).`);
  }
}

/** Délai dépassé à chaque tentative. */
export class ErreurIaDelai extends ErreurIa {
  constructor(readonly tentatives: number) {
    super('delai_depasse', `Le fournisseur IA n'a pas répondu dans le délai imparti (${tentatives} tentative(s)).`);
  }
}

/** Réponse inattendue du fournisseur (forme, dimensions de vecteur, modèle renvoyé…). */
export class ErreurIaProtocole extends ErreurIa {
  constructor(message: string) {
    super('protocole', message);
  }
}

/** Requête vers un hôte autre que celui configuré : toujours refusée. */
export class ErreurIaHoteInterdit extends ErreurIa {
  constructor() {
    super('hote_interdit', 'Requête refusée : hôte différent de celui du fournisseur IA configuré.');
  }
}
