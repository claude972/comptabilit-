/**
 * Comptes du fournisseur d'identité (Keycloak) en fin de contrat (D-099) : plan et exécution contre un ROYAUME D'ESSAI.
 *
 * L'exécution (désactivation, suppression) n'est possible que dans un royaume qui se déclare d'essai : nom
 * `essai-fin-contrat-…`, déclaré par `KEYCLOAK_ROYAUME_ESSAI_DECLARE`, distinct du royaume de l'application (celui de
 * `OIDC_ISSUER`) et de « master ». Toute autre cible est refusée AVANT le moindre appel. Le royaume de développement
 * n'est jamais visé. La désactivation est réversible ; la suppression ne l'est pas, d'où deux dates distinctes.
 *
 * Hors essai (royaume réel), seule la SIMULATION existe (`planifierComptesIdentite`, pure) : aucun code d'exécution
 * contre un royaume réel n'est écrit ici.
 */
export interface ConfigFournisseurEssai {
  /** Origine de Keycloak (ex. http://localhost:8080). */
  url: string;
  royaume: string;
  adminUtilisateur: string;
  adminMotDePasse: string;
}
export interface EnvFournisseurEssai {
  KEYCLOAK_ROYAUME_ESSAI_DECLARE?: string;
  OIDC_ISSUER?: string;
}

const NOM_ROYAUME_ESSAI = /^essai-fin-contrat-[a-z0-9][a-z0-9-]{3,40}$/;

export function royaumeDeIssuer(issuer: string | undefined): string | null {
  const m = /\/realms\/([^/]+)\/?$/.exec(issuer ?? '');
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Vérifie la déclaration « essai » d'un royaume ; lève sinon. Pure : aucun appel réseau. */
export function exigerRoyaumeEssai(royaume: string, env: EnvFournisseurEssai = process.env): void {
  if (!NOM_ROYAUME_ESSAI.test(royaume)) throw new Error(`Refus : « ${royaume} » n’est pas un royaume d’essai (nom attendu : essai-fin-contrat-…).`);
  if (!env.KEYCLOAK_ROYAUME_ESSAI_DECLARE) throw new Error('Refus : aucun royaume d’essai n’est déclaré (variable KEYCLOAK_ROYAUME_ESSAI_DECLARE absente).');
  if (env.KEYCLOAK_ROYAUME_ESSAI_DECLARE !== royaume) throw new Error(`Refus : le royaume « ${royaume} » n’est pas celui déclaré d’essai (« ${env.KEYCLOAK_ROYAUME_ESSAI_DECLARE} »).`);
  const reel = royaumeDeIssuer(env.OIDC_ISSUER);
  if (!reel) throw new Error('Refus : le royaume de l’application (OIDC_ISSUER) n’est pas connu, la distinction ne peut pas être établie.');
  if (reel.toLowerCase() === royaume.toLowerCase() || royaume.toLowerCase() === 'master') throw new Error(`Refus : « ${royaume} » est le royaume de l’application ou « master ».`);
}

export type EtatCompteIdentite = 'actif' | 'desactive' | 'absent';
export interface CompteAFermer { sujetOidc: string; email: string; desactiverLe: string | null; supprimerLe: string | null }
export type ActionCompte = 'aucune' | 'attente' | 'desactiver' | 'supprimer' | 'ignore_identite_differente' | 'non_planifie';
export interface LigneCompteIdentite { sujetOidc: string; email: string; avant: EtatCompteIdentite; action: ActionCompte; apres: EtatCompteIdentite; detail: string }

/** Décision pure pour un compte : d'après son état, ses dates et la date du jour. */
export function decisionCompte(c: CompteAFermer, etat: EtatCompteIdentite, aujourdhui: string): { action: ActionCompte; detail: string } {
  if (!c.desactiverLe || !c.supprimerLe) return { action: 'non_planifie', detail: 'dates absentes (abonnement non résilié) : rien n’est fait' };
  if (etat === 'absent') return { action: 'aucune', detail: 'compte déjà absent du fournisseur d’identité' };
  if (aujourdhui >= c.supprimerLe) return { action: 'supprimer', detail: `suppression due depuis le ${c.supprimerLe}` };
  if (aujourdhui >= c.desactiverLe) return etat === 'desactive' ? { action: 'attente', detail: `déjà désactivé ; suppression le ${c.supprimerLe}` } : { action: 'desactiver', detail: `désactivation due depuis le ${c.desactiverLe}` };
  return { action: 'attente', detail: `désactivation le ${c.desactiverLe}` };
}

/** SIMULATION pure : ce qui serait fait, d'après les états connus (aucun appel réseau). */
export function planifierComptesIdentite(comptes: readonly CompteAFermer[], etats: ReadonlyMap<string, EtatCompteIdentite>, aujourdhui: string): LigneCompteIdentite[] {
  return comptes.map((c) => {
    const avant = etats.get(c.sujetOidc) ?? 'absent';
    const d = decisionCompte(c, avant, aujourdhui);
    return { sujetOidc: c.sujetOidc, email: c.email, avant, action: d.action, apres: avant, detail: d.detail };
  });
}

export class FournisseurIdentiteEssai {
  private jeton: { valeur: string; expire: number } | null = null;
  constructor(private readonly cfg: ConfigFournisseurEssai, private readonly env: EnvFournisseurEssai = process.env) {
    exigerRoyaumeEssai(cfg.royaume, env); // dès la construction : aucune instance ne peut viser un autre royaume
  }
  get royaume(): string {
    return this.cfg.royaume;
  }

  private async entete(): Promise<Record<string, string>> {
    if (!this.jeton || this.jeton.expire < Date.now() + 5000) {
      const r = await fetch(`${this.cfg.url}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: this.cfg.adminUtilisateur, password: this.cfg.adminMotDePasse }) });
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (!j.access_token) throw new Error(`Administration de Keycloak indisponible (HTTP ${r.status})`);
      this.jeton = { valeur: j.access_token, expire: Date.now() + (j.expires_in ?? 60) * 1000 };
    }
    return { authorization: `Bearer ${this.jeton.valeur}`, 'content-type': 'application/json' };
  }
  private async appel(chemin: string, init: RequestInit = {}, royaume = true): Promise<Response> {
    exigerRoyaumeEssai(this.cfg.royaume, this.env);
    return fetch(`${this.cfg.url}/admin/realms${royaume ? `/${this.cfg.royaume}` : ''}${chemin}`, { ...init, headers: { ...(await this.entete()), ...(init.headers as Record<string, string> | undefined) } });
  }

  async creerRoyaume(): Promise<void> {
    const r = await this.appel('', { method: 'POST', body: JSON.stringify({ realm: this.cfg.royaume, enabled: true }) }, false);
    if (r.status !== 201) throw new Error(`Création du royaume d’essai refusée (HTTP ${r.status})`);
  }
  async supprimerRoyaume(): Promise<void> {
    const r = await this.appel('', { method: 'DELETE' });
    if (r.status !== 204 && r.status !== 404) throw new Error(`Suppression du royaume d’essai en échec (HTTP ${r.status})`);
  }
  async royaumeExiste(): Promise<boolean> {
    return (await this.appel('')).status === 200;
  }
  async creerUtilisateur(nomUtilisateur: string, email: string): Promise<string> {
    const r = await this.appel('/users', { method: 'POST', body: JSON.stringify({ username: nomUtilisateur, email, enabled: true, emailVerified: true }) });
    if (r.status !== 201) throw new Error(`Création de l’utilisateur d’essai refusée (HTTP ${r.status})`);
    return r.headers.get('location')!.split('/').pop()!;
  }
  async lister(): Promise<Array<{ id: string; email: string | null; enabled: boolean }>> {
    const r = await this.appel('/users?max=1000');
    return (await r.json()) as Array<{ id: string; email: string | null; enabled: boolean }>;
  }
  async lire(id: string): Promise<{ id: string; email: string | null; enabled: boolean } | null> {
    const r = await this.appel(`/users/${encodeURIComponent(id)}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`Lecture d’un compte en échec (HTTP ${r.status})`);
    return (await r.json()) as { id: string; email: string | null; enabled: boolean };
  }
  async etat(id: string): Promise<EtatCompteIdentite> {
    const u = await this.lire(id);
    return !u ? 'absent' : u.enabled ? 'actif' : 'desactive';
  }
  async desactiver(id: string): Promise<void> {
    const u = await this.lire(id);
    if (!u) return;
    const r = await this.appel(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...u, enabled: false }) });
    if (r.status !== 204) throw new Error(`Désactivation en échec (HTTP ${r.status})`);
  }
  async supprimer(id: string): Promise<void> {
    const r = await this.appel(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.status !== 204 && r.status !== 404) throw new Error(`Suppression en échec (HTTP ${r.status})`);
  }

  /**
   * Applique le plan au royaume d'essai : désactive ou supprime les seuls comptes listés, d'après leurs dates. Idempotent.
   * Un compte dont l'e-mail dans Keycloak diffère de celui du plan n'est JAMAIS touché (identité douteuse).
   */
  async appliquerPlan(comptes: readonly CompteAFermer[], options: { appliquer: boolean; aujourdhui: string }): Promise<LigneCompteIdentite[]> {
    exigerRoyaumeEssai(this.cfg.royaume, this.env);
    const lignes: LigneCompteIdentite[] = [];
    for (const c of comptes) {
      const u = await this.lire(c.sujetOidc);
      const avant: EtatCompteIdentite = !u ? 'absent' : u.enabled ? 'actif' : 'desactive';
      if (u && u.email !== null && u.email.toLowerCase() !== c.email.toLowerCase()) {
        lignes.push({ sujetOidc: c.sujetOidc, email: c.email, avant, action: 'ignore_identite_differente', apres: avant, detail: 'l’e-mail du compte du fournisseur d’identité diffère de celui du plan : non touché' });
        continue;
      }
      const d = decisionCompte(c, avant, options.aujourdhui);
      let apres = avant;
      if (options.appliquer) {
        if (d.action === 'supprimer') {
          await this.supprimer(c.sujetOidc);
          apres = 'absent';
        } else if (d.action === 'desactiver') {
          await this.desactiver(c.sujetOidc);
          apres = 'desactive';
        }
      }
      lignes.push({ sujetOidc: c.sujetOidc, email: c.email, avant, action: d.action, apres, detail: d.detail });
    }
    return lignes;
  }
}
