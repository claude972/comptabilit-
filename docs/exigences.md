# Matrice des exigences — exigence → implémentation → preuve → reste réel

Relecture complète du cahier des charges initial, section par section, faite le 2026-11-19 après la première intégration
continue entièrement réussie, et recalée sur l'état réel en fin de chantier (décisions D-064 à D-072). Ce document ne remplace pas `couverture.md` (état fonctionnalité par fonctionnalité) : il
part des EXIGENCES et dit, pour chacune, où elle est réalisée, par quoi c'est prouvé, et ce qui reste réellement.

Lecture des colonnes :
- **Preuve** : test automatisé exécuté (suite nommée dans `rapport-de-tests.md`), essai consigné, ou « aucune ».
- **Reste réel** : `—` si rien ; sinon le travail restant. Un reste marqué **(externe)** dépend d'un accès, d'une dépense,
  d'une validation professionnelle, d'un appareil ou d'un corpus que le développement ne peut pas fournir.
- Vocabulaire constant : **simulé** (vérifié contre un simulateur identifié), **connecté** (exercé contre le service
  réel), **validé** (approuvé par un professionnel habilité). À ce jour RIEN n'est « connecté » à un service externe
  réel et RIEN n'est « validé » par un professionnel.

## §2 — Mode de travail

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Hypothèses et décisions consignées | `docs/decisions.md` (D-001 → D-072) | Document | — |
| Dépôt distant autorisé uniquement | `origin` = dépôt de l'utilisateur | `git remote -v` | — |
| Simulé jamais présenté comme réel | Statuts `non_connecte` / `simule` ; `GET v1/integrations` | Tests API « intégrations », parcours réel messagerie | — |
| Sans clé : adaptateur réel + simulateur | Mail (Gmail, Microsoft), IA (`@comtaple/ia`), agrégation bancaire (port) | Suites mail (57) et IA | Connexions réelles **(externe)** |

## §4 — Périmètre et couverture

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Territoire fiscal explicite, jamais de règle métropolitaine appliquée en silence | Donnée du dossier ; garde D-018 | Tests moteur et API (contrôles fiscaux « non réalisés » hors métropole) | — |
| Matrice pris en charge / partiel / non pris en charge | `couverture.md`, « Couverture par type de dossier » | Document | — |
| Une limite de couverture n'empêche ni conservation ni import | Collecte et import indépendants des contrôles | Parcours API | — |

## §5 — Technologies

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Stack imposée (TypeScript strict, Next.js, NestJS, PostgreSQL/Drizzle, Redis/BullMQ, Keycloak, S3, PaddleOCR, ClamAV, Playwright, Vitest, Compose, OpenTofu) | Monorepo | CI réussie | TypeScript 6 au lieu de 7 (D-003) ; S3 local SeaweedFS (D-005) |
| shadcn/ui | Composants accessibles écrits pour le projet sur Tailwind, sans la bibliothèque shadcn/ui | — | Écart assumé (table des écarts de `decisions.md`) |
| Recherche textuelle PostgreSQL **et pgvector** | Plein texte en place ; stockage vectoriel et recherche hybride préparés | Tests | Embeddings réels **(externe : jeton IA)** |
| Passerelle IA unique, modèles figés | `@comtaple/ia` | Tests contre simulateur | Activation **(externe)** : jeton, vérifications contractuelles, évaluation sur corpus métier |
| Supervision OpenTelemetry, Prometheus, Grafana | `infra/supervision/` (Prometheus, Grafana, collecteur) | Essai local | Traces non émises par l'API et le worker (SDK à ajouter) ; déploiement réel **(externe)** |
| Infrastructure OVHcloud décrite par OpenTofu et scripts | `infra/opentofu/`, `infra/production/`, `scripts/deployer.sh` | `tofu validate`, `compose config`, mode à blanc | Jamais appliqué **(externe : compte, dépense)** |
| Montants jamais en flottant ; chaînes décimales dans les API | `montant.ts`, schémas Zod | Tests moteur | — |

## §6 — Principes non négociables

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Le moteur calcule, l'IA classe/explique/rédige | Moteur `@comtaple/core` ; garde-fous de `@comtaple/ia` (chiffres et citations vérifiés par code) | Tests moteur et IA | — |
| Preuves pour chaque proposition ; aucune source inventée | Preuves stockées avec chaque proposition, rejet des citations inconnues | Tests | — |
| Confiance par tâche, « non évaluée », abstention | Champ `confiance` (défaut `non_evaluee`), abstentions | Tests | Calibration **(externe : corpus réel)** |
| Validation humaine distincte (préparation, revue, validation, autorisation de transmission) | Statuts et rôles distincts ; validateur ≠ auteur | Tests API | — |
| Hébergement France/UE, chaîne des sous-traitants | Cible décrite ; `docs/juridique/sous-traitants.md` | Document (projet) | Contrats et vérifications **(externe)** |
| Données jamais utilisées pour l'entraînement | Exigence contractuelle documentée ; aucun appel IA réel | — | Clause à obtenir du fournisseur **(externe)** |
| Minimisation et pseudonymisation avant appel IA | `@comtaple/ia` | Tests | — |
| Isolation cabinets / dossiers ; contexte tiré de l'identité | RLS forcé, rôles sans `BYPASSRLS`, contexte du jeton | Suites base et API | Test d'intrusion indépendant **(externe)** |

## §7 — Modèle de données et traçabilité

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Entités listées (cabinets … politiques de conservation) | `packages/db/src/schema.ts`, migrations 0000 → 003x | Migrations rejouées sur base neuve en CI | « Tiers » : pas de table propre (dérivés des comptes auxiliaires des écritures) ; « échéances et règlements » de factures : champs extraits de la pièce, pas de suivi de règlement par facture hors rapprochement bancaire |
| Liens pièce ↔ réceptions ↔ écritures ↔ contrôles ↔ décisions | Tables de réception, d'échange, de pièces jointes, de décisions | Parcours API | — |
| Nouvelle version / doublon binaire / suspicion de double comptabilisation | Versions de pièce, empreinte, contrôle de doublons d'écritures | Tests | — |
| Résultats rattachés aux versions des données et des règles ; obsolescence | `version_donnees`, versions de règles, « à revoir » | Tests API | — |

## §8 — Collecte et import

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Parcours téléphone complet (installation, photo, pages, rotation, recadrage, lisibilité, commentaire, nature, progression, reprise, « reçu » après confirmation, statuts, champs extraits, signalement, demandes de complément) | `apps/web` (PWA) | Suites navigateur (émulation) | Appareils réels **(externe)** |
| Pas de documents sensibles dans le cache du service worker ; purge | Service worker sans cache de documents ; stockage temporaire purgé | Tests | — |
| Notifications discrètes | Notifications internes sans montant | Tests | Notifications poussées : non faites (aucun service d'envoi) — voir « Reste » en fin de document |
| Connecteurs Gmail et Microsoft 365 réels, lecture seule, OAuth/PKCE, jetons chiffrés, renouvellement, révocation | `@comtaple/mail`, API, worker, écrans | 57 tests + 20 parcours **simulés** | Connexion réelle **(externe : applications OAuth)** |
| Périmètre de connexion, reprise 30 jours, différence permissions / filtres | Écrans de connexion | Parcours simulés | — |
| Notifications fournisseur, rattrapage, doublons, quotas, reprises, expiration, suivi, déconnexion | Idem | Idem | — |
| Import FEC et données de travail (tolérant, rapport ligne à ligne, lisible/conforme/suffisant, original conservé) | Moteur + worker | Tests | FEC réels **(externe)** ; validation **(externe)** |
| Factures PDF/images, Factur-X, UBL, CII | Extraction structurée puis texte puis OCR | Tests | Pièces réelles **(externe)** |
| Relevés CAMT.053, OFX, CSV | Moteur + worker | Tests | Relevés réels **(externe)** |
| Lots : file durable, parallélisme limité, progression, reprise, annulation, rapport, idempotence, versions | Campagnes d'import | Tests + mesure 200 dossiers | — |
| IA : proposition de type de pièce et de dossier, incertitude → à qualifier | Tâche `classerPiece`, route et bouton ; sans IA : repli déterministe étiqueté | Tests API (repli) ; modèle contre simulateur au niveau du paquet | Modèle réel **(externe)** |
| Adaptateur d'agrégation bancaire | Port, simulateur, statut « non connecté » | Tests | Prestataire agréé à choisir et contrat **(externe)** |

## §9 — Contrôles, rapprochements, dossier de révision

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Rapprochements : exact, règles explicites, suggestions IA vérifiées arithmétiquement | Niveaux 1 et 2 ; niveau 3 : route `suggererRapprochements` + vérification du moteur branchée | Tests (niveaux 1 et 2 ; niveau 3 : « IA indisponible ») | Modèle réel **(externe)** |
| Bibliothèque de contrôles par cycle, avec fiche complète | 19 contrôles, `catalogue-controles.md` | 465 tests moteur | Validation professionnelle **(externe)** |
| Six statuts distincts ; absence de données jamais favorable | `sans_anomalie`, `constat`, `non_applicable`, `non_realise`, `erreur` + « anomalie confirmée » par décision de revue | Tests | — |
| Revue humaine (affecter, commenter, demander une pièce, accepter, corriger, rejeter, clôturer avec motif) | API + écrans | Tests API et navigateur | — |
| Dossier exportable (PDF, données, inventaire, contrôles réalisés et non réalisés, constats, règles et sources, décisions) | Worker + gabarits | Tests | — |

## §10 — États comptables et fiscaux

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Propositions d'écritures d'inventaire | Saisie humaine + propositions assistées déterministes | Tests | Validation **(externe)** |
| Balance ajustée, projets de bilan et de compte de résultat | Moteur, API, écrans | Tests | Validation de la table **(externe)** |
| Projet d'annexe | Modèle par rubrique, pré-remplissage, informations à compléter | Tests | Validation **(externe)** |
| Préparation de la liasse, régimes explicitement couverts | Tableaux déduits de la balance, périmètre documenté (`etats-fiscaux.md`) | Tests | Tableaux non couverts listés ; validation **(externe)** |
| Correspondances versionnées ; incomplet jamais présenté comme complet | Tables versionnées, statut `complet: false` et manques listés | Tests | — |
| Préparer / approuver / exporter / intégrer / transmettre distincts ; pas de télétransmission | Statuts distincts ; aucune télétransmission | Tests | Télétransmission : hors périmètre par conception |

## §11 — Veille réglementaire

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Surveillance planifiée, sources indisponibles suivies | Worker + écran | Tests | API Légifrance **(externe)** |
| Évolutions qualifiées, applicabilité par dossier expliquée, « à confirmer » | Outil éditeur + API + écran | Tests | Qualification réelle par une personne compétente **(externe)** |
| Aucune modification automatique des règles | Par conception | Tests | — |

## §12 — Lettre de mission et conseil tracé

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Analyse des lettres et avenants (périmètre, durée, honoraires, obligations, livrables, mandats, révision) | Saisie structurée + route `analyserLettreMission` (citations exactes exigées, projet jamais appliqué) | Tests (saisie ; route : « IA indisponible ») | Modèle réel **(externe)** |
| Rattachement des travaux, hors périmètre, projet d'avenant, estimations par le moteur | Moteur + API + écrans | Tests | Validation **(externe)** |
| Registre des conseils, faits d'envoi distingués | API + écrans | Tests | — |

## §13 — Amélioration contrôlée

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Règles explicites, versionnées, testables, approuvées, réversibles, impact mesuré | Règles de cabinet | Tests | Distinction fine « exception de dossier / préférence de cabinet » : portée par le champ de portée de la règle |
| Pas de mutualisation entre cabinets, pas d'entraînement, pas d'activation autonome | Par conception (RLS, aucune IA entraînée) | Tests d'isolation | — |

## §14 — Performance

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Indicateurs du dossier (SIG, BFR, délais, trésorerie, évolutions, signaux) | 25 indicateurs | Tests | Validation **(externe)** |
| Commentaire rédigé par l'IA à partir des résultats | Tâche `commenterIndicateurs` (chiffres vérifiés), route ; sans IA : gabarit étiqueté | Tests API (repli), navigateur simulé | Modèle réel **(externe)** |
| Indicateurs du cabinet (temps, rentabilité, volumes, délais, charge, anomalies) | API + écrans | Tests | — |
| Indicateurs du logiciel (imports, rapprochements, propositions, abstentions, coût) | Indicateurs d'activité + mesures de la passerelle IA | Tests | Qualité d'extraction et faux positifs : exigent un corpus évalué **(externe)** |

## §15 — Assistant documenté

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Questions sur un dossier autorisé ; habilitations avant recherche ; citations ; période et périmètre ; données manquantes ; fait/calcul/hypothèse/interprétation ; abstention ; fonctions métier autorisées seulement ; pas de SQL libre ; contenus non fiables | `@comtaple/ia` (orchestration et garde-fous), routes `v1/dossiers/:id/assistant/questions`, onglet « Assistant » | 24 parcours API (sans IA sur pile réelle ; modèle contre simulateur avec la base réelle), navigateur simulé et réel | Portefeuille de plusieurs dossiers : non couvert ; rédaction par le modèle réel **(externe)** ; d'ici là, mode « sans IA » étiqueté |

## §16 — Socle SaaS, sécurité, conservation

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Sept rôles, habilitation par dossier | Énumérations, RLS, gardes d'API | Tests | — |
| MFA pour les comptes du cabinet, SSO | Gabarit de royaume de production (MFA obligatoire, emplacement SSO) | Import d'essai | Royaume de production réel **(externe)** ; royaume de développement sans MFA (D-016) |
| Sessions, révocation, secrets, liens temporaires, types réels, quarantaine, antivirus, limites de débit, journaux sans secret | En place | Tests | Bac à sable dédié des analyseurs (aujourd'hui : processus du worker, conteneur sans privilèges) |
| Journal en ajout seul, intégrité, archivage protégé | Journal chaîné ; ancres préparées | Tests | Destination indépendante **(externe)** ; Object Lock **(externe)** |
| Documents RGPD et réglementaires | `docs/juridique/` (projets) | Documents | Validation DPO / avocat **(externe)** |
| Abonnements complets, virement, historique, exports de facturation | Moteur, API, outil éditeur, export des éléments de facturation | Tests | Grille tarifaire réelle **(externe)** |
| Restitution complète et devenir des données | Restitutions dossier et cabinet ; `conservation.md` | Tests | Durées à arrêter **(externe)** ; purge effective non activée tant que les durées ne sont pas arrêtées |

## §17 — Qualité, exploitation, tests

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Capacités mesurées, pas d'objectif présenté comme mesure | `rapport-de-tests.md` | Mesures locales datées | Mesures sur l'environnement cible **(externe)** |
| Sauvegardes, restauration, RPO/RTO, reprise | Scripts, essais isolés, `exploitation.md` | Essais | RPO/RTO : objectifs proposés, non mesurés en cible |
| Fonctionnement dégradé sans IA | Aucune fonction ne dépend de l'IA ; replis étiquetés | Tests | — |
| Jeux synthétiques et exigences de recette | `packages/core/src/synthetique`, recettes | Tests | — |
| Dix parcours de bout en bout | Voir `couverture.md` | Tests | Parcours 2, 6, 7 : **simulés** |
| Navigateurs / émulations / appareils distingués | `rapport-de-tests.md` | — | Appareils réels **(externe)** |

## §19 — Livrables

Tous présents dans le dépôt : code, README, commandes, configuration locale, migrations et jeux synthétiques,
architecture et modèle de données, décisions, OpenAPI, catalogues, matrice de couverture, rapport de tests, guide des
messageries, guide de déploiement / sauvegarde / restauration, politique de conservation, registre des risques,
estimation des coûts, liste des accès externes.

## Seconde relecture : lacunes rouvertes (2026-11-19, nuit)

Relecture faite pour ne pas laisser une lacune se transformer en exclusion. Ces exigences du cahier des charges étaient
notées « limite assumée » ou absentes de la matrice ; elles sont rouvertes et traitées par lots, l'état étant recalé ici
à mesure. Les connexions réelles restent seules à dépendre d'un accès externe.

| Exigence (section) | Ce qui manquait | État |
|---|---|---|
| Supervision OpenTelemetry (§5) | Aucune trace émise par l'API ni le worker | Fait (D-074) : traces de l'API et du worker, propagées jusqu'aux travaux, sans donnée comptable ; reste un entrepôt de traces et le déploiement |
| Fichiers volumineux en flux (§17) | Contrôles non réalisés au-delà de 500 000 lignes | Fait (D-075) : 19 contrôles en flux, égalité prouvée, mesuré sur 1 060 006 lignes ; reste borné par un budget explicite pour trois d'entre eux |
| Isolation des traitements PDF, image et XML (§16) | Analyseurs exécutés dans le processus du worker | Fait pour les pièces (D-076) : processus enfant borné par fichier ; pas d'isolation par le noyau ; relevés, FEC et mail restent dans le worker |
| Tiers, factures, échéances et règlements (§7) | Pas de table des tiers ni de suivi des règlements par facture | Fait (D-077) : tiers, factures et avoirs suivis, échéances, règlements partiels et groupés, suspicion de double comptabilisation ; ventes à confirmer à la main, euro seulement ; règles à valider **(externe)** |
| Assistant sur un portefeuille autorisé (§15) | Un seul dossier à la fois | À faire |
| Notifications discrètes sur téléphone (§8A) | Notifications internes seulement, aucune notification poussée | À faire |
| Amélioration contrôlée à partir des corrections (§13) | Les règles ne sont proposées que par saisie humaine ; aucune proposition tirée des corrections | À faire |
| Devenir des données à la résiliation (§16) | Documenté, mais aucune procédure exécutable | Fait en partie (D-078) : procédure de l'éditeur en simulation par défaut, prouvée sur base isolée, non activée ; durées à arrêter **(externe)** ; sauvegardes et fournisseur d'identité non traités |

## Reste réel, hors dépendances externes

Liste tenue dans `plan.md`, section « Chantier du 2026-11-19 (soir) » : preuve de connexion de la passerelle, amortissements non linéaires, assistant multi-dossiers, table des tiers et suivi des règlements, traces OpenTelemetry, contrôles en flux au-delà de 500 000 lignes, notifications poussées, purge à l'issue des durées de conservation.
