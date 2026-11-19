# Comtaple

Couche de contrôle, de préparation et de preuve pour les cabinets d'expertise comptable français, connectée aux logiciels existants. Le logiciel prépare les travaux ; le cabinet les examine et les valide. Toute production non validée par un professionnel habilité est un **projet**.

> État : développement en cours, environnement local uniquement. Rien n'est en production, aucune intégration externe (messagerie, IA, banque) n'est connectée. L'état réel par fonctionnalité est dans [docs/couverture.md](docs/couverture.md) — c'est le document de référence, pas ce README.

## Prérequis

- macOS ou Linux, Node.js 24.22 (voir `.nvmrc`), pnpm 12.21, Docker avec Compose.
- Sur le poste de développement d'origine, ces outils sont installés sans droits administrateur dans `~/.comtaple-outils` ; chaque session de terminal commence par :

```bash
source "$HOME/.comtaple-outils/env.sh"
```

Si la machine virtuelle Docker est arrêtée (après un redémarrage du poste) : `colima start`.

## Installation

```bash
pnpm install
sh scripts/generer-env.sh        # crée .env avec des secrets locaux aléatoires (jamais versionné)
pnpm run services:up             # PostgreSQL 18 + pgvector, Redis, Keycloak, S3 local, ClamAV
pnpm run build
pnpm run db:migrate              # rôles techniques + migrations SQL versionnées
pnpm run db:seed                 # cabinets, dossiers et utilisateurs FICTIFS de démonstration
pnpm --filter @comtaple/worker exec playwright install chromium   # rendu PDF
```

Le service OCR se construit et se lance à part : voir `services/ocr/README.md`.

## Lancement

```bash
scripts/applis.sh demarrer       # API (http://127.0.0.1:4000, documentation /docs) + worker + web (http://localhost:3100)
# l'application web construite est servie sur http://localhost:3100 par le même script
pnpm --filter @comtaple/web dev  # ou en mode développement (même port : arrêter d'abord la version construite)
scripts/applis.sh etat
scripts/applis.sh arreter
```

Journaux : `var/api.log`, `var/worker.log`, `var/web.log`.

### Comptes de démonstration (royaume Keycloak local uniquement)

Le mot de passe commun est la valeur `DEV_MDP_UTILISATEURS` du fichier `.env`.

| Compte | Cabinet | Rôle | Habilitations |
|---|---|---|---|
| `alice.admin@cabinet-a.test` | Alpha | Administratrice | Validation sur Dupain ; aucune sur Martin (le rôle ne suffit pas) |
| `remi.reviseur@cabinet-a.test` | Alpha | Réviseur | Révision sur Dupain et Martin |
| `chloe.collab@cabinet-a.test` | Alpha | Collaboratrice | Collaboration sur Dupain |
| `client.depot@client-a.test` | Alpha | Client déposant | Dépôt sur Dupain |
| `bruno.admin@cabinet-b.test` | Bêta | Administrateur | Validation sur Leroy |

## Tests

```bash
pnpm run test                                         # tests unitaires de tous les paquets
pnpm --filter @comtaple/db run test:integration       # isolation RLS et journal d'audit sur PostgreSQL réel
pnpm --filter @comtaple/worker run test:integration   # surveillance des sources (base réelle, HTTP injecté)
pnpm --filter @comtaple/api run test:integration      # parcours de bout en bout (services, API et worker démarrés)
pnpm --filter @comtaple/web run test:e2e              # navigateur, API simulée
pnpm --filter @comtaple/web exec playwright test -c playwright.reel.config.ts   # navigateur, pile réelle
scripts/sauvegarder.sh && scripts/essai-restauration.sh   # sauvegarde puis restauration vérifiée dans une base neuve
```

Résultats de la dernière exécution : [docs/rapport-de-tests.md](docs/rapport-de-tests.md).

## Organisation

| Dossier | Contenu |
|---|---|
| `packages/core` | Moteur métier déterministe : montants, FEC, contrôles, extraction de factures, banque et rapprochements, abonnements, missions, veille, états et indicateurs, jeux synthétiques |
| `packages/db` | Schéma, migrations SQL, sécurité RLS, audit, amorçage |
| `packages/plateforme` | Configuration, stockage S3, files de tâches |
| `packages/mail` | Connecteurs Gmail et Microsoft 365 (lecture seule) |
| `apps/api` | API REST NestJS |
| `apps/worker` | Traitements différés |
| `apps/web` | Application web et PWA |
| `services/ocr` | Service OCR local (PaddleOCR) |
| `infra` | Royaume Keycloak de développement, ébauche OpenTofu de l'infrastructure cible |
| `Dockerfile` | Images de l'API, du worker et du web |
| `scripts` | Secrets locaux, démarrage, sauvegarde, essai de restauration |
| `docs` | Documentation |

## Documentation

- [Couverture fonctionnelle et état réel](docs/couverture.md)
- [Plan de travail par lot](docs/plan.md)
- [Architecture et modèle de données](docs/architecture.md)
- [Décisions et hypothèses](docs/decisions.md)
- [Catalogue des contrôles et sources](docs/catalogue-controles.md)
- [Catalogue des indicateurs](docs/catalogue-indicateurs.md)
- [API (OpenAPI)](docs/openapi.json) — aussi servie par l'API sur `/docs`
- [Rapport de tests](docs/rapport-de-tests.md)
- [Déploiement, sauvegarde et restauration](docs/deploiement.md)
- [Conservation, restitution, suppression](docs/conservation.md)
- [Risques et validations professionnelles attendues](docs/risques.md)
- [Coûts](docs/couts.md)
- [Accès et actions externes nécessaires](docs/acces-externes.md)
- Connexion des messageries : `packages/mail/docs/guide-connexion.md`

## Règles du projet

- Aucun montant n'est calculé en flottant ; les API transportent des chaînes décimales.
- Le moteur déterministe calcule ; l'IA, quand elle sera connectée, classera, expliquera et rédigera, sans jamais valider.
- Une absence de données ne produit jamais un résultat favorable.
- Aucune source réglementaire n'est inventée : chaque règle porte sa référence, son état de vérification et sa date.
- Une intégration simulée n'est jamais présentée comme réelle : son statut reste « non connecté ».
