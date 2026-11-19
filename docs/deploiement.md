# Déploiement, sauvegarde et restauration

État : seul l'environnement LOCAL existe et a été vérifié. La cible de production décrite ici est un plan ; aucune ressource OVHcloud n'a été créée, et la configuration OpenTofu n'est pas écrite.

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

## Cible de production (à réaliser)

| Élément | Choix prévu | À faire |
|---|---|---|
| Hébergement | OVHcloud Public Cloud, région française | Ouvrir le projet, choisir la région |
| Description | OpenTofu + scripts de déploiement | À écrire |
| Base | PostgreSQL managé avec pgvector, sauvegardes de l'hébergeur | Vérifier la disponibilité de pgvector et des rôles sans `BYPASSRLS` |
| Files | Valkey/Redis managé, politique `noeviction` | Vérifier la compatibilité BullMQ |
| Stockage | Object Storage S3, buckets séparés ; bucket verrouillé créé avec Object Lock dès l'origine | Voir `conservation.md` |
| Identités | Keycloak auto-hébergé, base dédiée, MFA imposé, SSO | Royaume de production à définir |
| Applications | Conteneurs API, worker, web, OCR ; pas de Kubernetes au lancement | Images de conteneurs applicatives à écrire |
| Supervision | OpenTelemetry, Prometheus, Grafana | Non instrumenté à ce jour |
| Secrets | Gestionnaire de secrets de l'hébergeur | Aujourd'hui : fichier `.env` local |
| Réseau | TLS partout, services internes non exposés | — |

Points d'attention déjà identifiés :

- Le rôle qui exécute les migrations doit posséder `BYPASSRLS` (ou être superutilisateur) et ne doit être utilisé par aucun service en fonctionnement normal. Les services se connectent avec `comtaple_app` et `comtaple_worker`.
- Toute migration qui ajoute une table portant `cabinet_id` doit appeler `SELECT securite_appliquer_rls();`. Un test d'intégration échoue si une telle table n'a pas RLS activé et forcé.
- Le worker a besoin de Chromium (Playwright) pour le rendu PDF, et d'un accès réseau limité à PostgreSQL, Redis, S3, ClamAV et OCR.
- Le service OCR ne doit avoir aucun accès réseau sortant.

## Sauvegarde et restauration

### Ce qui est vérifié (local)

`scripts/sauvegarder.sh` produit une sauvegarde logique (`pg_dump`, format personnalisé) et son empreinte dans `var/sauvegardes/`.

`scripts/essai-restauration.sh` restaure la dernière sauvegarde dans une base neuve, sans toucher à la base courante, puis vérifie :

1. l'empreinte de la sauvegarde ;
2. les volumes de lignes restaurés ;
3. l'intégrité de la chaîne du journal d'audit pour chaque cabinet ;
4. que RLS est toujours activé et forcé sur toutes les tables concernées, et le nombre de politiques ;
5. qu'un échantillon d'originaux du stockage objet correspond aux empreintes enregistrées en base.

Dernier essai : voir `rapport-de-tests.md`.

### Ce qui n'est pas vérifié

- Restauration du stockage objet lui-même (seule la cohérence base ↔ objets est contrôlée).
- Restauration à un instant donné (journaux de transactions).
- Restauration de Redis : les files sont reconstructibles. Les pièces confirmées « reçues » mais non traitées sont remises en file par le rattrapage du worker ; les imports comptables et les exports en attente ne le sont pas encore.
- Restauration de Keycloak.
- Objectifs de perte de données admissible et de délai de reprise : non définis. Ils dépendent des mécanismes de l'hébergeur et sont à fixer avec lui.

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
