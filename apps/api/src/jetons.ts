/** Jetons d'injection (l'injection est toujours explicite : aucune dépendance aux métadonnées de types). */
export const BD = Symbol('BD');
export const STOCKAGE = Symbol('STOCKAGE');
export const TACHES = Symbol('TACHES');
export const CONFIG = Symbol('CONFIG');
/** Connecteurs de messagerie (@comtaple/mail) construits à partir de la configuration. */
export const MAIL = Symbol('MAIL');
/** État de l'agrégation bancaire (prestataire éventuel) construit à partir de la configuration. */
export const AGREGATION = Symbol('AGREGATION');
