# Déploiement, sauvegarde et restauration

État : seul l'environnement LOCAL existe et a été vérifié. La cible de production décrite ici est un plan ; aucune ressource OVHcloud n'a été créée. Les images de conteneurs sont construites et démarrées en local ; la description OpenTofu est une ébauche validée syntaxiquement.

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

## Métriques

L'API (port 9464) et le worker (port 9465) exposent `/metrics` au format Prometheus sur une adresse locale : requêtes par gabarit de route et code, durées, tâches par file et issue, métriques du processus. Aucune étiquette ne porte d'identifiant de cabinet, de dossier ou de personne. Ces ports ne doivent jamais être exposés publiquement. Ni Prometheus ni Grafana ne sont déployés ; les traces OpenTelemetry ne sont pas instrumentées.

## Description d'infrastructure

`infra/opentofu/` : ébauche pour OVHcloud (fournisseur `ovh/ovh` 2.25.0) couvrant la base PostgreSQL managée et deux buckets, dont un verrouillé par Object Lock dès sa création. `tofu validate` réussit. Elle n'a jamais été planifiée ni appliquée : aucun identifiant OVHcloud, aucune ressource créée. La région n'a pas de valeur par défaut et doit être française ; la durée de rétention immuable n'a pas de valeur par défaut.

## Cible de production (à réaliser)

| Élément | Choix prévu | À faire |
|---|---|---|
| Hébergement | OVHcloud Public Cloud, région française | Ouvrir le projet, choisir la région |
| Description | OpenTofu + scripts de déploiement | Ébauche partielle (`infra/opentofu`) ; scripts de déploiement à écrire |
| Base | PostgreSQL managé avec pgvector, sauvegardes de l'hébergeur | Vérifier la disponibilité de pgvector et des rôles sans `BYPASSRLS` |
| Files | Valkey/Redis managé, politique `noeviction` | Vérifier la compatibilité BullMQ |
| Stockage | Object Storage S3, buckets séparés ; bucket verrouillé créé avec Object Lock dès l'origine | Voir `conservation.md` |
| Identités | Keycloak auto-hébergé, base dédiée, MFA imposé, SSO | Royaume de production à définir |
| Applications | Conteneurs API, worker, web, OCR ; pas de Kubernetes au lancement | Images construites ; orchestration et registre à définir |
| Supervision | OpenTelemetry, Prometheus, Grafana | Métriques exposées ; collecte, tableaux de bord et traces à mettre en place |
| Secrets | Gestionnaire de secrets de l'hébergeur | Aujourd'hui : fichier `.env` local |
| Réseau | TLS partout, services internes non exposés | — |

Points d'attention déjà identifiés :

- Le rôle qui exécute les migrations doit posséder `BYPASSRLS` (ou être superutilisateur) et ne doit être utilisé par aucun service en fonctionnement normal. Les services se connectent avec `comtaple_app` et `comtaple_worker`.
- Les opérations de l'éditeur (ouverture d'un cabinet, grille tarifaire, échéances, virements, sources de veille, qualification des évolutions) utilisent le rôle de migration via `packages/db/src/provisionnement.ts` : il n'existe pas encore d'outil d'exploitation, et ce rôle doit rester hors des services.
- Toute migration qui ajoute une table portant `cabinet_id` doit appeler `SELECT securite_appliquer_rls();`. Un test d'intégration échoue si une telle table n'a pas RLS activé et forcé.
- Le worker a besoin de Chromium (Playwright) pour le rendu PDF, et d'un accès réseau limité à PostgreSQL, Redis, S3, ClamAV et OCR.
- Le service OCR ne doit avoir aucun accès réseau sortant.

## Sauvegarde et restauration

### Ce qui est vérifié (local, 2026-11-19)

**Sauvegarde** — `scripts/sauvegarder.sh` produit dans `var/sauvegardes/` (hors dépôt) : la base (`pg_dump`, format personnalisé) puis TOUS les objets du stockage (fichiers adressés par empreinte SHA-256, jamais dupliqués d'une sauvegarde à l'autre, et un manifeste clé / taille / empreinte), chacun avec son empreinte. L'ordre compte : les originaux n'étant jamais réécrits ni supprimés, un stockage copié après la base contient tout ce qu'elle référence.

**Essai de restauration de la base et du stockage objet** — `scripts/essai-restauration.sh`, sans jamais écrire dans la base ni dans le stockage de l'application :

1. empreintes de la sauvegarde et du manifeste ;
2. restauration dans un PostgreSQL d'essai SÉPARÉ (autre conteneur, autre volume, sans port publié, ressources plafonnées) ; volumes de lignes ;
3. journal d'audit : (a) fidélité — le résultat de la vérification stricte est identique à l'origine, cabinet par cabinet ; (b) intégrité — vérification stricte, seule référence (D-038) ;
4. RLS activé et forcé sur toutes les tables portant `cabinet_id` ; nombre de politiques ;
5. stockage objet : rechargement de la sauvegarde dans une instance SÉPARÉE (autre conteneur, autre volume, autres identifiants générés pour l'essai, autre port, accès anonyme refusé), puis relecture de TOUS les objets référencés par la base restaurée (originaux, exports de révision, archives de restitution) et comparaison à l'empreinte enregistrée en base ; l'instance est détruite ensuite.

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
- Objectifs de perte de données admissible et de délai de reprise : non définis. Ils dépendent des mécanismes de l'hébergeur et sont à fixer avec lui.
- Les jetons émis par l'instance Keycloak d'essai n'ont pas été présentés à l'API (émetteur différent) : l'essai compare les comptes et les secrets, il ne rejoue pas un parcours applicatif sur l'instance restaurée.

**Essai de restauration depuis des copies chiffrées** — `scripts/essai-restauration-chiffree.sh` (dernier résultat, 2026-11-19) : 1 823 objets distincts (4,5 Go) chiffrés en 149 s dans un dossier temporaire, aucun fichier en clair, base et manifeste illisibles sans la clé, autre clé et objet altéré refusés ; déchiffrement en 161 s à partir des seules copies chiffrées, base identique à l'originale ; restauration isolée : 1 724 objets référencés tous conformes, aucun service redémarré ; dossiers temporaires et clé éphémère détruits, sauvegardes d'origine inchangées (1 854 fichiers avant et après, aucun chiffré). Code de sortie 3, comme l'essai en clair, à cause du journal historique (D-038).

### Incident constaté pendant l'essai, et correction

Pendant le premier rechargement de 3,6 Go, PostgreSQL a redémarré de lui-même. Cause : la sonde de santé (`pg_isready` lancée par un shell) a expiré sous la charge disque ; son processus, devenu orphelin, a été recueilli par PostgreSQL, qui est le premier processus de son conteneur et qui, depuis la version 17, traite la fin anormale d'un enfant inconnu comme un crash. La reprise automatique a rejoué les journaux : aucune donnée perdue (volumes identiques avant et après). Correction dans `compose.yaml` : un processus d'init dans le conteneur et une sonde sans shell intermédiaire ; l'essai rejoué ensuite n'a provoqué aucun redémarrage. À reprendre pour la production si PostgreSQL y est exécuté en conteneur.

## Mode dégradé

| Panne | Comportement |
|---|---|
| IA indisponible | Sans effet : aucun traitement livré ne dépend de l'IA |
| OCR indisponible | La pièce est reçue et conservée, puis passe « à contrôler » avec le motif « saisie manuelle nécessaire ». Les PDF à couche texte et les factures structurées sont traités normalement |
| Antivirus indisponible | La pièce est reçue et conservée ; l'analyse est retentée ; le contenu n'est pas servi sans verdict |
| Redis indisponible | Le dépôt aboutit (réception confirmée) ; l'analyse est rattrapée au retour de Redis |
| Worker arrêté | Les dépôts et la consultation fonctionnent ; les tâches attendent |
| Stockage objet indisponible | Les dépôts échouent explicitement ; aucun « reçu » n'est affiché |

Les cas OCR et antivirus indisponibles découlent du code mais n'ont pas fait l'objet d'un test automatisé de panne.
