# Architecture

Monolithe modulaire en monorepo pnpm, avec des traitements différés séparés du serveur interactif. Pas de microservices ni de Kubernetes au lancement.

## Vue d'ensemble

```
Téléphone / navigateur
        │  HTTPS (cookie de session chiffré ; aucun jeton côté navigateur)
        ▼
apps/web  — Next.js (App Router) + PWA ; BFF : détient la session OIDC, relaie vers l'API
        │  Bearer (jeton d'accès Keycloak)
        ▼
apps/api  — NestJS, REST + OpenAPI ; rôle PostgreSQL comtaple_app (RLS cabinet + dossier)
        │                         │ identifiants seulement
        │                         ▼
        │                   Redis / BullMQ
        │                         │
        ▼                         ▼
PostgreSQL 18 (+ pgvector)  apps/worker — rôle comtaple_worker (RLS cabinet)
        ▲                         │
        │                         ├── ClamAV (clamd, INSTREAM)
        │                         ├── services/ocr (PaddleOCR local, HTTP)
        │                         ├── pdf.js (couche texte, XML Factur-X embarqué)
        │                         └── Chromium/Playwright (rendu PDF hors ligne)
        ▼
Stockage objet S3 (originaux adressés par SHA-256, dérivés, exports)
```

## Paquets

| Paquet | Rôle | Dépend de |
|---|---|---|
| `packages/core` | Moteur métier déterministe et pur : montants décimaux, identifiants, analyse de FEC en flux, catalogue de contrôles, extraction de factures (texte, Factur-X/CII, UBL), jeux synthétiques. Aucun accès réseau, base ou fichier. | decimal.js, zod, fast-xml-parser, iconv-lite |
| `packages/db` | Schéma Drizzle, migrations SQL versionnées, contexte de sécurité par transaction, journal d'audit, amorçage de démonstration. | drizzle-orm, pg |
| `packages/plateforme` | Configuration validée, stockage S3, files BullMQ (charges utiles = identifiants). | AWS SDK S3, bullmq |
| `packages/mail` | Connecteurs Gmail et Microsoft Graph en lecture seule, moteur de synchronisation, simulateur de test. | (ports injectés) |
| `apps/api` | API REST : téléversements reprenables, documents, révision, exports, référentiel. | core, db, plateforme |
| `apps/worker` | Traitements différés : analyse de pièce, import FEC, contrôles, dossier de révision. | core, db, plateforme |
| `apps/web` | Application web et PWA installable. | API via BFF |
| `services/ocr` | Service OCR conteneurisé (Python, PaddleOCR), sans accès réseau à l'exécution. | — |

## Principes structurants

**Calcul et IA séparés.** Tout chiffre (solde, total, écart, seuil) vient du moteur `core` ou d'une donnée identifiée. Aucun montant n'est un flottant : `NUMERIC(18,2)` en base, `decimal.js` dans le moteur, chaînes décimales dans les API. L'IA n'intervient dans aucun traitement livré à ce jour ; la passerelle IA est à l'état « non connectée ».

**Isolation.** Voir la décision D-007 : trois rôles PostgreSQL, RLS activé et forcé, politique par cabinet pour tous, politique par dossier pour le serveur interactif, contexte posé par transaction depuis le jeton vérifié.

**Traçabilité des versions.** Un lot d'import porte une version ; l'exercice porte un compteur `version_donnees` incrémenté à chaque nouveau lot actif. Une exécution de contrôles référence le lot et la version des données ; chaque résultat référence l'identifiant et la version du contrôle, ses paramètres et sa source. Une extraction de pièce est versionnée ; une validation référence la version validée. Quand les données changent, les exécutions antérieures passent `obsolete` et les constats déjà décidés passent `a_revoir`.

**Trois notions distinctes pour une pièce.** Nouvelle version d'un document (`documents.version`, `remplace_document_id`), doublon binaire (même empreinte dans le même dossier : nouvelle ligne `receptions` avec `doublon_binaire`), suspicion de double comptabilisation (contrôle `GEN-004` sur les écritures).

**Contenus non fiables.** Pièces, messages, libellés d'écritures et noms de fichiers sont des données. Ils ne sont jamais interprétés comme des instructions, toujours échappés à l'affichage et au rendu PDF, et lus par des analyseurs sans exécution (pas de JavaScript PDF, pas d'entité XML externe, pas de requête réseau).

**Mode dégradé.** La collecte, la conservation et les contrôles déterministes ne dépendent ni de l'IA ni de l'OCR. OCR indisponible : la pièce est conservée et part en saisie manuelle. Antivirus indisponible : la pièce est conservée mais n'est ni analysée ni servie tant qu'aucun verdict n'est rendu.

## Cycle de vie d'une pièce

1. `POST /v1/televersements` — taille et SHA-256 annoncés ; vérification de l'habilitation sur le dossier.
2. `PUT …/morceaux?decalage=N` — morceaux de 4 Mo, décalage vérifié, rejeu sans effet.
3. `POST …/terminer` — assemblage, vérification taille + empreinte, original stocké par empreinte, création du document (ou d'une réception supplémentaire si doublon binaire), statut `recu`, écriture d'audit, mise en file.
4. Worker — antivirus → type réel → extraction (structuré > couche texte > OCR) → vérifications arithmétiques → statut `a_controler` (ou `a_completer`, `quarantaine`).
5. Revue — corrections versionnées par un collaborateur, validation par un réviseur → `traite`.

## Cycle de vie d'un import comptable

1. Téléversement reprenable avec `usage: fec` → lot d'import (clé d'idempotence = exercice + empreinte).
2. Worker — lecture en flux, normalisation, rapport (lisible / conforme / suffisant), activation du lot, incrément de `version_donnees`, marquage des travaux antérieurs.
3. Exécution des contrôles sur le lot actif → résultats (cinq statuts) et constats.
4. Revue humaine des constats ; dossier de révision (PDF + JSON + inventaire) figé sur une exécution.

## Modèle de données

Le schéma complet et commenté est `packages/db/src/schema.ts` ; les règles de sécurité sont dans `packages/db/migrations/0001_securite.sql`. Tables par domaine :

- Identités : `cabinets`, `utilisateurs`, `appartenances`, `habilitations_dossier`.
- Dossiers : `entites`, `etablissements`, `exercices`, `missions`, `lettres_mission`.
- Collecte : `televersements`, `fichiers`, `documents`, `receptions`, `pages_document`, `extractions`, `echanges_document`.
- Comptabilité : `lots_import`, `lignes_ecriture`, `mouvements_bancaires`, `factures`, `rapprochements`.
- Révision : `executions_controles`, `resultats_controles`, `constats`, `decisions`, `commentaires`, `regles_cabinet`, `exports_revision`.
- IA et veille : `propositions_ia`, `sources_reglementaires`.
- Messagerie : `connexions_mail`, `messages_mail`.
- Abonnements : `abonnements`, `evenements_facturation`.
- Audit et conservation : `journal_audit`, `politiques_conservation`.

Plusieurs de ces tables sont modélisées sans fonctionnalité encore branchée dessus ; l'état réel par fonctionnalité est dans `docs/couverture.md`.
