# Déploiement, sauvegarde et restauration

État au 2026-11-19 : seul l'environnement LOCAL existe et a été vérifié. La cible de production est **préparée et validée syntaxiquement, jamais appliquée** : aucune ressource OVHcloud n'a été créée, aucun jeton n'est disponible, aucune dépense n'a été engagée. Les procédures d'exploitation (mise en service pas à pas, sauvegardes de production, objectifs de reprise, incidents, rotation des secrets, fonctionnement dégradé, montée de version, checklist, tableau « préparé / essayé en local / jamais exécuté ») sont dans **`docs/exploitation.md`**.

## Environnement local (vérifié)

Décrit par `compose.yaml` ; procédure dans le README. Images figées :

| Service | Image | Rôle |
|---|---|---|
| PostgreSQL | `pgvector/pgvector:0.8.7-pg18-trixie` | Base relationnelle |
| Redis | `redis:8.8.4-alpine` | Files BullMQ, sans éviction, persistance AOF |
| Keycloak | `quay.io/keycloak/keycloak:26.8.2` | Identités (royaume de développement importé) |
| S3 local | `chrislusf/seaweedfs:4.54` | Stockage objet de développement |
| ClamAV | `clamav/clamav-debian:1.5.4` | Antivirus |

Les ports ne sont publiés que sur `127.0.0.1`.

## Images de conteneurs (vérifiées en local)

`Dockerfile` à la racine, trois cibles. Aucun secret n'entre dans les images.

| Image | Construction | Vérification réalisée |
|---|---|---|
| `comtaple-api` | `docker build --target api -t comtaple-api:dev .` | Démarrée sur le réseau des services en lecture seule, sans capacités, utilisateur non privilégié : `/v1/sante` répond, `/v1/moi` exige un jeton |
| `comtaple-worker` | `docker build --target worker -t comtaple-worker:dev .` | Démarrée dans les mêmes conditions : connexion aux files, passe de veille exécutée, PDF rendu par Chromium dans le conteneur |
| `comtaple-web` | `docker build --target web -t comtaple-web:dev .` | Démarrée dans les mêmes conditions : redirection vers la connexion, page de connexion et manifeste servis |

Limites : tailles non optimisées (1,1 à 2,6 Go : dépendances de développement et sources embarquées) ; images jamais poussées vers un registre ; aucun parcours métier complet exécuté à travers les trois conteneurs ensemble (l'émetteur OIDC vu du navigateur et vu des conteneurs diffère en local) ; pas d'analyse de vulnérabilités des images.

Variables propres aux conteneurs : `API_HOTE=0.0.0.0`, `METRIQUES_HOTE=0.0.0.0` (déjà posées dans l'image), et les adresses des services (`PG_HOST`, `REDIS_URL`, `S3_ENDPOINT`, `CLAMAV_HOST`, `OCR_URL`, `OIDC_ISSUER`, `API_URL`, `WEB_URL`).

## Cible de production (préparée, jamais appliquée)

OVHcloud Public Cloud, région française ; OpenTofu et scripts ; Docker Compose, pas de Kubernetes ; supervision dans le même périmètre.

| Élément | Choix | Fichiers | État |
|---|---|---|---|
| Réseau | Réseau privé (vRack), sous-réseau, passerelle de sortie, groupes de sécurité (web public ; SSH limité aux adresses d'administration ; supervision sans entrée d'Internet : du réseau privé, SSH et l'entrée des traces seulement) | `infra/opentofu/main.tf` | Validé syntaxiquement |
| Instances | Une instance applicative (adresse publique), une instance de supervision (réseau privé seulement) | `infra/opentofu/main.tf`, `cloud-init.yaml.tftpl` | Validé syntaxiquement ; cloud-init jamais exécuté |
| Base | PostgreSQL managé dans le réseau privé ; bases `comtaple` et `keycloak` ; rôle de migration et utilisateur Keycloak | `infra/opentofu/main.tf` | Validé syntaxiquement ; `vector`, création de rôles et `BYPASSRLS` à vérifier chez l'hébergeur |
| Files | **Redis sur l'instance applicative**, pas de service managé par défaut (Valkey managé descriptible par `valkey_manage = true`) | `infra/production/compose.production.yaml` | Conteneur durci essayé en local |
| Stockage | Trois buckets S3 versionnés et chiffrés : documents, archives, sauvegardes ; utilisateur S3 restreint | `infra/opentofu/main.tf` | Validé syntaxiquement |
| Registre | Registre privé managé | `infra/opentofu/main.tf` | Validé syntaxiquement |
| Applications | Proxy TLS Caddy, web, API, worker, OCR, antivirus, Keycloak, Redis, deux sondes | `infra/production/compose.production.yaml` | `docker compose config` réussi ; jamais démarré dans son ensemble |
| Identités | Keycloak `start --optimized` sur PostgreSQL ; royaume de production avec TOTP exigé | `infra/keycloak/` | Essayé en local (26 contrôles) |
| Supervision | Prometheus, Grafana, collecteur OpenTelemetry, entrepôt de traces Tempo (rétention 72 h), liés à 127.0.0.1 | `infra/supervision/` | Essayée en local ; Tempo essayé par `scripts/essai-traces.sh`, sans Grafana |
| Traces | Désactivées par défaut. Agent sur l'instance applicative (profil `traces`) → TLS mutuel sur le réseau privé, port 4319 → entrée de l'instance de supervision (profil `acheminement`) → collecteur → Tempo | `infra/production/compose.production.yaml`, `infra/supervision/`, `infra/opentofu/main.tf` (groupe de sécurité : SSH et 4319 du réseau privé seulement) | Chaîne essayée en local sur un seul poste ; jamais sur deux hôtes (`docs/exploitation.md`, § 9) |
| Déploiement | Images étiquetées par commit, migration avant bascule, vérification, retour arrière | `scripts/deployer.sh` | Mode à blanc essayé seulement |
| Secrets | Fichiers d'environnement sur les hôtes (`chmod 600`), jamais versionnés | `infra/production/exemple.env` (valeurs factices) | Gestionnaire de secrets de l'hébergeur non utilisé : à décider |

### Description OpenTofu (`infra/opentofu`)

Fournisseur `ovh/ovh` 2.25.0, figé. `tofu init -backend=false && tofu validate` et la commande de la CI (`tofu init -input=false && tofu validate`) réussissent sans avertissement. **Jamais planifiée ni appliquée.**

- Les noms de ressources et d'attributs ont été vérifiés contre le schéma du fournisseur installé (`tofu providers schema -json`) et contre sa documentation officielle. La première rédaction utilisait `ovh_cloud_project_network_private`, `_instance` et `_ssh_key` : le fournisseur les signale dépréciées ; la description utilise donc `ovh_cloud_network_private_vrack`, `ovh_cloud_network_private_vrack_subnet`, `ovh_cloud_gateway`, `ovh_cloud_security_group`, `ovh_cloud_instance`, `ovh_cloud_ssh_key` et `ovh_cloud_storage_object_bucket`. La base, ses utilisateurs, l'utilisateur S3 et le registre restent sous `ovh_cloud_project_*` (seule forme existante).
- **Bucket d'archives et Object Lock.** Object Lock ne s'arme qu'à la création du bucket (le changer ensuite recrée le bucket) et exige les versions. Le bucket est donc créé avec Object Lock ARMÉ mais **sans règle de rétention** (`archives_retention_defaut = null`) : dans cet état, aucun objet n'est retenu et rien n'est irréversible. Une rétention ne s'applique que si l'éditeur renseigne explicitement un mode et une durée, une fois les durées arrêtées (`conservation.md`). En mode COMPLIANCE, la décision est irréversible pour chaque objet verrouillé.
- **Redis sur instance plutôt que Valkey managé** : BullMQ exige `maxmemory-policy noeviction`, maîtrisé dans la composition et non constaté sur le service managé ; les files ne portent que des identifiants et sont reconstructibles ; API, worker et Redis étant sur la même instance, un service managé n'ajouterait pas de disponibilité. À réévaluer si l'application passe sur plusieurs instances.
- Variables sans valeur par défaut, donc décisions explicites : région, adresses autorisées en SSH (`0.0.0.0/0` refusé), clé publique, image, gabarits, version et plan de la base.
- L'état OpenTofu contient des secrets (clé S3, mots de passe initiaux) : à placer dans un stockage chiffré avant toute application (`versions.tf`).
- Non décrit : DNS, sauvegarde logique indépendante, réplication hors région, utilisateur S3 des sauvegardes, comptes du registre.
- À constater au premier `tofu plan` (jamais vérifié) : identifiant de réseau attendu par les nœuds de la base, région des nœuds de base face à celle des instances, plans et gabarits disponibles, règles implicites des groupes de sécurité.

### Composition de production (`infra/production`)

`docker compose --env-file infra/production/exemple.env -f infra/production/compose.production.yaml config` réussit ; sans fichier d'environnement, la commande échoue en nommant la variable manquante. **Jamais démarrée dans son ensemble.**

- Seul le proxy publie des ports : 80 et 443 vers Internet, et 9100 sur l'adresse PRIVÉE de l'instance (collecte des métriques). L'API n'est pas publique : le navigateur ne parle qu'au web, sauf les deux points de notification des fournisseurs de messagerie, routés par le proxy.
- Keycloak : seuls `/realms`, `/resources` et `/.well-known` sont publics ; `/admin` n'est servi qu'aux adresses d'administration ; santé et métriques ne sortent pas.
- Conteneurs en lecture seule, sans capacités (le proxy garde `NET_BIND_SERVICE`), sans élévation de privilèges, mémoire, processeur et nombre de processus plafonnés (environ 12 Go de plafonds mémoire au total). Exception documentée : l'antivirus (image officielle démarrant en root), seulement « sans élévation de privilèges ».
- Le service OCR est sur un réseau interne sans sortie ; les points de métriques aussi.
- Le rôle de migration de la base n'est donné à aucun service : il vit dans un fichier séparé (`migration.env`) lu par la seule commande de migration.
- Constats faits en préparant, et leurs corrections : Compose refuse `configs` en ligne pour un service en lecture seule (la configuration du proxy, de Prometheus et l'autorité de certification de la base passent par l'environnement et un système de fichiers en mémoire) ; Redis sans capacités doit recevoir explicitement l'utilisateur de son image ; Keycloak refuse de démarrer avec des variables d'amorçage vides (elles ne sont transmises que si elles existent).

### Royaume Keycloak de production, supervision, déploiement

Voir `docs/exploitation.md` (§ 3, § 9, § 2 et § 10).

### Points d'attention

- Le rôle qui exécute les migrations doit posséder `BYPASSRLS` (ou être superutilisateur) et ne doit être utilisé par aucun service en fonctionnement normal. Les services se connectent avec `comtaple_app` et `comtaple_worker`. Sur une base managée, ce droit n'est pas acquis : c'est le premier point à vérifier.
- Les opérations de l'éditeur (ouverture d'un cabinet, grille tarifaire, échéances, virements, sources de veille, qualification des évolutions) utilisent le rôle de migration via `packages/db/src/provisionnement.ts` : il n'existe pas encore d'outil d'exploitation, et ce rôle doit rester hors des services.
- Toute migration qui ajoute une table portant `cabinet_id` doit appeler `SELECT securite_appliquer_rls();`. Un test d'intégration échoue si une telle table n'a pas RLS activé et forcé.
- Le worker a besoin de Chromium (Playwright) pour le rendu PDF, et d'un accès réseau limité à PostgreSQL, Redis, S3, ClamAV et OCR. Dans la composition, sa sortie vers Internet n'est pas filtrée au-delà du groupe de sécurité : à restreindre si l'hébergeur le permet.
- La connexion à la base managée est chiffrée (`PGSSLMODE`, lu par le pilote) ; l'autorité de certification se fournit par `PG_AC_PEM`. Jamais essayé contre une base managée.

## Métriques

L'API (port 9464) et le worker (port 9465) exposent `/metrics` au format Prometheus : requêtes par gabarit de route et code, durées, tâches par file et issue, métriques du processus. Aucune étiquette ne porte d'identifiant de cabinet, de dossier ou de personne. Ces ports ne doivent jamais être exposés publiquement. La collecte (Prometheus), les alertes et les tableaux de bord (Grafana) sont préparés dans `infra/supervision/` et ont été essayés en local ; ils ne sont pas déployés. L'API et le worker émettent des traces OpenTelemetry (OTLP/HTTP) quand `OTEL_EXPORTER_OTLP_ENDPOINT` est renseigné ; vide (défaut), rien n'est émis (`docs/exploitation.md`, § 9).

## Sauvegarde et restauration

### Ce qui est vérifié (local, 2026-11-19)

**Sauvegarde** — `scripts/sauvegarder.sh` produit dans `var/sauvegardes/` (hors dépôt) un JEU décrit par un fichier `.jeu.json` écrit en dernier : la base (`pg_dump`, exportée depuis un instantané pris pendant que Keycloak était figé), l'export Keycloak (à partir d'une copie faite pendant ce même gel, d'environ un dixième de seconde, sans arrêt du service), puis TOUS les objets du stockage (fichiers adressés par empreinte, manifeste clé / taille / empreinte). Le descripteur porte les empreintes des trois fichiers, les instants de capture, et ce qui est garanti ou non : la base et Keycloak sont alignés à l'instant du gel, les objets sont postérieurs et contiennent tout ce que la base référence ; ce n'est pas une capture atomique de l'ensemble (D-060). Un jeu sans descripteur est une sauvegarde interrompue : il n'est ni chiffré ni restauré comme un tout, et n'est pas supprimé.

**Essai de restauration de la base et du stockage objet** — `scripts/essai-restauration.sh`, sans jamais écrire dans la base ni dans le stockage de l'application :

1. empreintes de la sauvegarde et du manifeste ;
2. restauration dans un PostgreSQL d'essai SÉPARÉ (autre conteneur, autre volume, sans port publié, ressources plafonnées) ; volumes de lignes ;
3. journal d'audit : (a) fidélité — le résultat de la vérification stricte est identique à l'origine, cabinet par cabinet ; (b) intégrité — vérification stricte, seule référence (D-038) ;
4. RLS activé et forcé sur toutes les tables portant `cabinet_id` ; nombre de politiques ;
5. stockage objet, par tranches de 2 000 Mo au plus (une instance d'essai neuve par tranche, D-062) : rechargement de la sauvegarde dans une instance SÉPARÉE (autre conteneur, autre volume, autres identifiants générés pour l'essai, autre port, accès anonyme refusé), puis relecture de TOUS les objets référencés par la base restaurée (originaux, exports de révision, archives de restitution) et comparaison à l'empreinte enregistrée en base ; l'instance est détruite ensuite.

6. aucun service de l'application n'a redémarré pendant l'essai (instants de démarrage comparés avant et après).

Avant de commencer, l'essai vérifie que les services sont en bonne santé et que l'espace disque laisse 2 Go de marge ; sinon il refuse de se lancer (code 5).

Codes de sortie : 0 réussi ; 3 données restaurées fidèlement mais journal d'audit non intègre ; 4 un service de l'application a redémarré pendant l'essai ; 5 essai refusé par un pré-contrôle ; autre : échec. Sur la base locale fictive, l'essai sort en 3 à cause de l'irrégularité historique du journal du cabinet Alpha (D-038) : c'est voulu, et il ne sortira en 0 que sur une base au journal intègre. Dernier résultat : base restaurée en 10 s ; 1 613 objets (4,4 Go) rechargés en 82 s ; 1 514 objets référencés, tous conformes ; aucun redémarrage de service.

**Essai de restauration de Keycloak** — `scripts/essai-restauration-keycloak.sh` : export complet du royaume (comptes, empreintes de mots de passe, clients, rôles), import dans une instance d'essai séparée, puis comparaison à l'origine et à la base de l'application : mêmes comptes et mêmes identifiants (« sub »), connexion acceptée avec le mot de passe d'origine, mauvais mot de passe refusé, mêmes clients, même secret du client confidentiel, mêmes rôles (16 contrôles conformes). Le Keycloak local n'est pas arrêté : son conteneur est figé le temps de copier sa base embarquée (0,3 s constaté), puis repris ; l'export est fait à part, à partir de la copie, qui a la cohérence d'un arrêt brutal (les toutes dernières écritures peuvent manquer, d'où la comparaison à l'origine). Le fichier d'export contient des empreintes de mots de passe et un secret : il reste dans `var/sauvegardes/`, lisible par son seul propriétaire.

### Ce qui n'est pas vérifié

- Tout ce qui précède vaut pour l'environnement LOCAL. En production, la base et Keycloak (adossé à PostgreSQL, et non à une base embarquée) relèveront des sauvegardes de l'hébergeur, et le stockage objet de ses mécanismes (versions, réplication, verrouillage) : aucun n'a été essayé.
- Restauration à un instant donné (journaux de transactions).
- Cohérence d'une sauvegarde prise pendant une forte activité d'écriture : la base et le stockage ne sont pas figés ensemble ; seul le sens « tout objet référencé est présent » est garanti par l'ordre des copies.
- Objets du stockage non référencés par la base (dépôts interrompus, anciennes archives) : sauvegardés et rechargés, mais non contrôlés un par un.
- Chiffrement des sauvegardes : l'outil existe (`scripts/chiffrer-sauvegardes.mjs`, D-050 et D-055) et la restauration à partir d'un jeu entièrement chiffré a été essayée de bout en bout avec une clé éphémère (`scripts/essai-restauration-chiffree.sh`), mais AUCUNE clé durable n'est configurée : les sauvegardes locales sont toujours en clair, et `scripts/sauvegarder.sh` le dit à chaque exécution. Pour l'activer, après décision sur la garde de la clé privée : `node scripts/chiffrer-sauvegardes.mjs generer-cles <dossier extérieur au dépôt>`, mettre la clé privée en lieu sûr, puis `node scripts/chiffrer-sauvegardes.mjs copie-chiffree --cle-publique <clé publique> --destination <autre dossier> <sauvegarde.dump>`. Rien n'est chiffré en place ni supprimé : retirer les copies en clair reste une décision humaine.
- Conservation hors du poste : non faite (dossier local seulement).
- Restauration de Redis : les files sont reconstructibles ; le rattrapage du worker remet en file les traitements confirmés en base restés en attente (D-035). Aucun essai avec un arrêt réel de Redis.
- Objectifs de perte de données admissible et de délai de reprise : PROPOSÉS dans `docs/exploitation.md` (§ 5), non mesurés et non engagés. Ils dépendent des mécanismes de l'hébergeur et sont à fixer avec lui.
- Les jetons émis par l'instance Keycloak d'essai n'ont pas été présentés à l'API (émetteur différent) : l'essai compare les comptes et les secrets, il ne rejoue pas un parcours applicatif sur l'instance restaurée.

**Essai de restauration depuis des copies chiffrées** — `scripts/essai-restauration-chiffree.sh`. Le jeu chiffré comprend aussi le dernier export Keycloak des sauvegardes, déchiffré puis restauré dans une instance Keycloak d'essai (16 contrôles conformes au dernier essai). Résultat pour la base et les objets (2026-11-19) : 1 823 objets distincts (4,5 Go) chiffrés en 149 s dans un dossier temporaire, aucun fichier en clair, base et manifeste illisibles sans la clé, autre clé et objet altéré refusés ; déchiffrement en 161 s à partir des seules copies chiffrées, base identique à l'originale ; restauration isolée : 1 724 objets référencés tous conformes, aucun service redémarré ; dossiers temporaires et clé éphémère détruits, sauvegardes d'origine inchangées (1 854 fichiers avant et après, aucun chiffré). Code de sortie 3, comme l'essai en clair, à cause du journal historique (D-038).

### Incident constaté pendant l'essai, et correction

Pendant le premier rechargement de 3,6 Go, PostgreSQL a redémarré de lui-même. Cause : la sonde de santé (`pg_isready` lancée par un shell) a expiré sous la charge disque ; son processus, devenu orphelin, a été recueilli par PostgreSQL, qui est le premier processus de son conteneur et qui, depuis la version 17, traite la fin anormale d'un enfant inconnu comme un crash. La reprise automatique a rejoué les journaux : aucune donnée perdue (volumes identiques avant et après). Correction dans `compose.yaml` : un processus d'init dans le conteneur et une sonde sans shell intermédiaire ; l'essai rejoué ensuite n'a provoqué aucun redémarrage. À reprendre pour la production si PostgreSQL y est exécuté en conteneur.

## Mode dégradé

Tableau complet dans `docs/exploitation.md` (§ 8). Les cas OCR et antivirus indisponibles découlent du code mais n'ont pas fait l'objet d'un test automatisé de panne.
