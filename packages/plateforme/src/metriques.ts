import { createServer, type Server } from 'node:http';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Métriques techniques au format Prometheus. Aucune donnée métier ni personnelle : pas d'identifiant de cabinet, de
 * dossier ou d'utilisateur dans les étiquettes (uniquement méthode, gabarit de route, code, file, nom de tâche).
 * Servies sur un port séparé, lié à l'adresse locale : à ne jamais exposer publiquement.
 */
export class Metriques {
  readonly registre = new Registry();
  readonly requetes: Counter<'methode' | 'route' | 'code'>;
  readonly dureeRequetes: Histogram<'methode' | 'route'>;
  readonly taches: Counter<'file' | 'tache' | 'issue'>;
  readonly dureeTaches: Histogram<'file' | 'tache'>;
  private serveur?: Server;

  constructor(service: string) {
    this.registre.setDefaultLabels({ service });
    collectDefaultMetrics({ register: this.registre });
    this.requetes = new Counter({ name: 'comtaple_http_requetes_total', help: 'Requêtes HTTP traitées', labelNames: ['methode', 'route', 'code'], registers: [this.registre] });
    this.dureeRequetes = new Histogram({ name: 'comtaple_http_duree_secondes', help: 'Durée des requêtes HTTP', labelNames: ['methode', 'route'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60], registers: [this.registre] });
    this.taches = new Counter({ name: 'comtaple_taches_total', help: 'Tâches différées terminées ou en échec', labelNames: ['file', 'tache', 'issue'], registers: [this.registre] });
    this.dureeTaches = new Histogram({ name: 'comtaple_taches_duree_secondes', help: 'Durée des tâches différées', labelNames: ['file', 'tache'], buckets: [0.1, 0.5, 1, 5, 15, 60, 300, 900], registers: [this.registre] });
  }

  /** Démarre le point de collecte. Port 0 ou absent : métriques non servies. */
  servir(port: number | undefined, hote = '127.0.0.1'): void {
    if (!port) return;
    this.serveur = createServer(async (req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': this.registre.contentType });
      res.end(await this.registre.metrics());
    });
    // Un port déjà pris (second processus sur le même poste) ne doit jamais empêcher le service de fonctionner.
    this.serveur.on('error', (e) => console.warn(`métriques non servies sur ${hote}:${port} : ${e.message}`));
    this.serveur.listen(port, hote);
    this.serveur.unref();
  }

  arreter(): void {
    this.serveur?.close();
  }
}
