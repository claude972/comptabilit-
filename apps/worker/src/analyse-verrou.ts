/**
 * Verrou du processus enfant d'analyse — à importer AVANT tout lecteur de fichier.
 *
 * Node 24 ne sait pas interdire le réseau par son modèle de permissions (`--allow-net` n'existe qu'à partir de Node 25).
 * Ce module neutralise donc, DANS le processus, les points d'entrée réseau de Node (TCP, TLS, HTTP, fetch, UDP, DNS) :
 * une bibliothèque de lecture qui tenterait de récupérer une ressource distante (DTD, police, image, lien) échoue.
 *
 * LIMITE ASSUMÉE : c'est un verrou applicatif, pas un bac à sable du noyau. Il arrête un accès réseau déclenché par un
 * lecteur ; il ne résisterait pas à une exécution de code natif arbitraire dans l'enfant. La barrière réseau forte reste
 * celle du déploiement (réseau du conteneur). Le système de fichiers, les processus fils, les fils d'exécution et les
 * modules natifs sont, eux, fermés par le modèle de permissions de Node (`--permission`), posé par le parent.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

function refus(quoi: string) {
  return function accesReseauRefuse(): never {
    throw new Error(`Accès réseau interdit dans le processus d'analyse (${quoi})`);
  };
}

function neutraliser(cible: object, noms: string[], quoi: string): void {
  for (const nom of noms) {
    if (typeof (cible as Record<string, unknown>)[nom] !== 'function') continue;
    Object.defineProperty(cible, nom, { value: refus(quoi), writable: false, configurable: false });
  }
}

const estResolution = (nom: string) => /^(lookup|lookupService|resolve\w*|reverse)$/.test(nom);

// TCP (donc TLS, HTTP, HTTPS, HTTP/2 et fetch, qui passent tous par net.Socket.prototype.connect) et écoute.
neutraliser(net.Socket.prototype, ['connect'], 'connexion sortante');
neutraliser(net.Server.prototype, ['listen'], 'écoute');
neutraliser(net, ['connect', 'createConnection'], 'connexion sortante');
// UDP.
neutraliser(dgram.Socket.prototype, ['bind', 'connect', 'send'], 'UDP');
neutraliser(dgram, ['createSocket'], 'UDP');
// Résolution de noms (elle n'emprunte pas net/dgram : un nom résolu serait déjà une fuite).
neutraliser(dns, Object.keys(dns).filter(estResolution), 'DNS');
neutraliser(dns.promises, Object.keys(dns.promises).filter(estResolution), 'DNS');
neutraliser(dns.Resolver.prototype, Object.getOwnPropertyNames(dns.Resolver.prototype).filter(estResolution), 'DNS');
neutraliser(dns.promises.Resolver.prototype, Object.getOwnPropertyNames(dns.promises.Resolver.prototype).filter(estResolution), 'DNS');
// Interfaces globales du Web.
for (const nom of ['fetch', 'WebSocket', 'EventSource']) {
  if (nom in globalThis) Object.defineProperty(globalThis, nom, { value: refus(nom), writable: false, configurable: false });
}
// Les modules déjà importés par nom (`import { connect } from 'node:net'`) voient les versions neutralisées.
syncBuiltinESMExports();

// La sortie standard est réservée au résultat structuré : les messages des bibliothèques vont à la sortie d'erreur,
// que le parent ne relaie jamais à l'utilisateur.
console.log = console.info = console.debug = console.warn = (...a: unknown[]) => console.error(...a);
