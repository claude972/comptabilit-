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

## Liste unique (réconciliée le 2026-11-22) — livré, incomplet, dépendance externe

C'est LA liste de référence ; les tableaux par section plus bas en donnent le détail et les preuves, `couverture.md` l'état fonctionnalité par fonctionnalité, `plan.md` et `reprise.md` le séquencement. **Aucune exigence du cahier initial n'est rendue optionnelle** : une ligne « incomplet » reste due ; une ligne « dépendance externe » attend un accès, une dépense, une personne ou un appareil que le développement ne peut pas fournir (détail : `acces-externes.md`) ; seule la télétransmission est hors périmètre, par le cahier lui-même.
« Livré » = implémenté ET prouvé en local sur jeux synthétiques (jamais « validé » par un professionnel ni « connecté » à un service réel).

| # | Exigence (cahier initial) | Statut | Ce qui est livré et prouvé | Ce qui reste |
|---|---|---|---|---|
| 1 | Socle SaaS : sept rôles, habilitation par dossier, RLS forcé, journal chaîné, sessions, quarantaine, antivirus (§6, §16) | **Livré** | Matrice 28 fonctions × 11 profils, suites base et API | Test d'intrusion indépendant ; MFA du royaume de production (externes) |
| 2 | Collecte et import : téléphone, FEC, relevés, factures, lots, reprise des immobilisations CSV/XLSX (§8) | **Livré** | Suites navigateur émulé, parcours de bout en bout sur dossier fictif (D-148) | Appareils, FEC, pièces et relevés réels (externes) |
| 3 | Contrôles, rapprochements, dossier de révision (§9) | **Livré** | 19 contrôles, six statuts, revue humaine, export | Validation professionnelle (externe) |
| 4 | Bilan, compte de résultat, annexe, indicateurs (§10, §14) | **Livré** (projets) | Colonne N-1, indicateurs du dossier et du cabinet | Validation des tables (externe) |
| 5 | Liasse fiscale : tableaux préparés, saisie justifiée et historisée, néant ≠ manque, abstention (§10) | **Livré en statut « projet »** : 2050-2053, 2033-A à G, 2054, 2054 bis, 2055, 2056, 2057, 2058, 2059, 2065, 2065 bis, états joints imprimables et exportables | Tests moteur, API, navigateurs ; parcours non nul de bout en bout, automatisé dans la suite réelle (D-148) | **Incomplet** : voir « Détail de la ligne 5 » ci-dessous (ce qui est FAIT, ce qui manque réellement) |
| 6 | Veille réglementaire (§11) | **Livré** (local) | Surveillance, applicabilité, aucune modification automatique | API Légifrance, qualification par une personne compétente (externes) |
| 7 | Lettre de mission, conseil tracé, amélioration contrôlée (§12, §13) | **Livré** | Registre, suggestions jamais activées seules | Modèle réel, seuils à valider (externes) |
| 8 | Assistant documenté (§15) | **Livré sans IA** | Portefeuille autorisé, abstentions, garde-fous | Rédaction par le modèle réel (externe) |
| 9 | Sauvegarde et restauration (§17) | **Livré** (démonstration stricte, D-145) ; **incomplet** : la base locale historique reste en échec strict (D-144), chiffrée/hébergeur à raccorder | Restauration stricte sur base et stockage neufs, contrôle négatif | RPO/RTO en cible, clé réelle, ordonnanceur, destination d'ancrage (externes) |
| 10 | Fin de contrat et devenir des données (§16) | **Livré, désactivé** : cycle complet (D-078, D-099, D-100) éprouvé de bout en bout sur ressources jetables | Aucune exécution réelle écrite | Durées juridiques, décision sur la destruction du journal en production, DPO (externes) |
| 11 | Isolation des analyseurs PDF, image, XML par conteneurs (§16) | **Incomplet** (exigé, jamais reclassé en option) | Mode conteneur éprouvé (sans réseau, sans privilège), arrêt ordonné, worker tué par SIGKILL prouvé (orphelin borné et balayé, D-109) ; **étape CI durcie : dans la FENÊTRE des 35 derniers runs terminés lus le 2026-11-22 (du 11c11ed au 7e615eb, tous du même jour), 16 exécutions réussies sur 16 là où elle a été atteinte et aucun échec de l'étape ; 19 runs l'ont sautée parce qu'une étape antérieure avait échoué. Hors de cette fenêtre l'historique reste : 81aa858 a ÉCHOUÉ sur l'essai d'arrêt forcé 28/30 (D-143) — compteur D-151** | Le défaut amont de dockerd (reproduit, atténué, aucune version corrigée) n'est PAS clos : l'absence d'échec sur 16 exécutions ne le prouve pas ; mode jamais activé sur un hôte de production ; protocole d'entrée à crédit décidé non fait (D-109) |
| 12 | Intégration continue stable sur Chromium, WebKit, Firefox | **Incomplet** | CI exécutée et lue par annotations ; correctifs D-143, D-147 | Deux échecs WebKit « pile réelle » (`ecrans-cabinet`, `fiscal`) : attentes d'hydratation et délai d'action augmenté = HYPOTHÈSE non confirmée (D-147, D-149) ; cause non reproduite en local. Un test unitaire flaky (UUID contenant « 1248 ») corrigé, cause confirmée |
| 13 | Notifications discrètes poussées (§8) | **Livré, désactivé** | Aucune donnée dans la notification ; simulateur | Réception réelle, écran verrouillé (externes : appareils) |
| 14 | Connecteurs Gmail / Microsoft 365, IA réelle, agrégation bancaire (§5, §8) | **Dépendance externe** | Adaptateurs réels et simulateurs ; statut « non connecté » affiché | Applications OAuth, jetons, prestataire agréé |
| 15 | Infrastructure OVHcloud, supervision déployée (§5) | **Dépendance externe** | OpenTofu validé, mode à blanc ; traces locales | Compte, dépense, application réelle |
| 16 | Recette sur appareils réels, lecteurs d'écran, Safari (§17) | **Dépendance externe** | `recette-appareils.md` préparée | Personne et appareils ; jamais jouée |
| 17 | Documents RGPD, sous-traitance, AI Act, clauses (§16) | **Dépendance externe** | Projets dans `docs/juridique/` | Validation DPO / avocat |
| 18 | Télétransmission fiscale (§10) | **Hors périmètre par le cahier** | Aucune télétransmission, aucune signature | Périmètre et autorisation spécifiques |

### Détail de la ligne 5 (audit du 2026-11-22 : ce qui est fait, ce qui manque réellement)

Plusieurs libellés « manque » des tableaux de `etats-fiscaux.md` datent d'avant les lots D-126 à D-141 ; cet audit les remplace.

**Déjà FAIT (ne plus le compter comme reste)** : renvois des bilans 2050 et 2051 (D-135) ; détails (7) et (8) du 2053 (D-136) ; libellés de nature et méthode par composants du 2058-B (D-139) ; dates du 2033-E / 2059-E et cadre IV du 2033-D (D-126) ; rapprochement ZJ / YX du 2058-C avec le 2052 (D-127) ; champs d'identification et cases à cocher du 2065-SD (D-137, D-140) ; rubrique 380 et revenu brut social d'après la notice (D-141) ; feuillets de déficits transférés et détails du 2058-A (D-132, D-133) ; cellules 2054 / 2033-C non déductibles de la balance saisies (D-134) ; composants et XLSX des immobilisations (D-124, D-125) ; lignes au-delà de la capacité des formulaires, portées par l'état joint (D-128) ; arrondi à l'euro à l'affichage (D-105) ; **dégressif : calcul sur déclaration justifiée du cabinet (D-150)**. Les tableaux 2059-A à 2059-G sans code de case officiel (saisie ligne par ligne) ne sont pas un manque : le formulaire n'imprime pas de code.

**FAIT depuis (D-152 à D-154, 2026-11-22)** : codes de cases de 2054, 2055 (cadre A) et 2033-C vérifiés sur le rendu image, aucun écart ; reports 2059 → 2058-A (WN proposée depuis le 2059-B, WV / WH / WP / I6 rapprochés du 2059-A, aucune décision) ; feuillets du 2056 (six lignes marquées (1)) et du 2057 (titres prêtés, empruntés) ; rapprochement du 2057 avec le projet de bilan sur quatre postes (correspondance interne non validée).

**Reste RÉEL, réalisable sans tiers** : (1) codes de cases des lignes de la liasse restées sans code : **2050 (actif : deux codes par ligne, numérotation du formulaire à rapprocher de celle de la liasse)** et **2033-A** (D-155 : 2051, 2052, 2053 faits) ; relecture sur le rendu des codes des autres tableaux (2054 bis, 2055 cadres B et C, 2058-A à C, 2059, 2065…) ; (2) note annexe de la ligne 20 du 2059-A, en-têtes cochables des 2059-B, C et D, reports entre 2059-B, C et D ; (3) état détaillé des charges à payer (art. 38 II de l'annexe III) ; rapprochement des autres lignes du 2057 ; (4) colonnes du 2033-C non couvertes (réévaluation) ; liquidation de l'impôt (2065) **seulement si une source l'énonce** : aucune règle de liquidation n'est inventée.

**Non établi, donc abstention (pas du développement)** : arrondi des totaux (somme des arrondis ou arrondi de la somme) et des montants négatifs — la notice est muette (D-105) ; texte de l'article 39 A du CGI, que Légifrance refuse de servir (HTTP 403 à nouveau le 2026-11-22) : l'éligibilité reste la déclaration justifiée du cabinet ; coefficients majorés ou diminués de certains biens d'équipement (BOI-BIC-AMT-20-20-50, non lu).

**Dépendance externe** : validation des codes et tables par un professionnel ; activation du dégressif par l'éditeur (`AMORTISSEMENT_DEGRESSIF_ACTIVE`).

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
| Supervision OpenTelemetry, Prometheus, Grafana | `infra/supervision/` (Prometheus, Grafana, collecteur) | Essai local | Traces émises par l'API et le worker (D-074, D-083) ; déploiement réel **(externe)** |
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
| Entités listées (cabinets … politiques de conservation) | `packages/db/src/schema.ts`, migrations 0000 → 003x | Migrations rejouées sur base neuve en CI | Tiers, factures, avoirs, échéances et règlements : FAITS (D-077, D-096, tables dédiées, essais `tiers-reglements`) ; règles de suivi à valider **(externe)** |
| Liens pièce ↔ réceptions ↔ écritures ↔ contrôles ↔ décisions | Tables de réception, d'échange, de pièces jointes, de décisions | Parcours API | — |
| Nouvelle version / doublon binaire / suspicion de double comptabilisation | Versions de pièce, empreinte, contrôle de doublons d'écritures | Tests | — |
| Résultats rattachés aux versions des données et des règles ; obsolescence | `version_donnees`, versions de règles, « à revoir » | Tests API | — |

## §8 — Collecte et import

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Parcours téléphone complet (installation, photo, pages, rotation, recadrage, lisibilité, commentaire, nature, progression, reprise, « reçu » après confirmation, statuts, champs extraits, signalement, demandes de complément) | `apps/web` (PWA) | Suites navigateur (émulation) | Appareils réels **(externe)** |
| Pas de documents sensibles dans le cache du service worker ; purge | Service worker sans cache de documents ; stockage temporaire purgé | Tests | — |
| Notifications discrètes | Notifications internes sans montant | Tests | Notifications poussées FAITES sans aucune donnée par construction, désactivées par défaut, vérifiées contre simulateur (D-081, D-086, D-097) ; réception réelle et écran verrouillé **(externe : appareils, décision d'activation)** |
| Connecteurs Gmail et Microsoft 365 réels, lecture seule, OAuth/PKCE, jetons chiffrés, renouvellement, révocation | `@comtaple/mail`, API, worker, écrans | 57 tests + 20 parcours **simulés** | Connexion réelle **(externe : applications OAuth)** |
| Périmètre de connexion, reprise 30 jours, différence permissions / filtres | Écrans de connexion | Parcours simulés | — |
| Notifications fournisseur, rattrapage, doublons, quotas, reprises, expiration, suivi, déconnexion | Idem | Idem | — |
| Import FEC et données de travail (tolérant, rapport ligne à ligne, lisible/conforme/suffisant, original conservé) | Moteur + worker | Tests | FEC réels **(externe)** ; validation **(externe)** |
| Factures PDF/images, Factur-X, UBL, CII | Extraction structurée puis texte puis OCR | Tests | Pièces réelles **(externe)** |
| Relevés CAMT.053, OFX, CSV | Moteur + worker | Tests | Relevés réels **(externe)** |
| Reprise du fichier des immobilisations (import CSV ou XLSX, D-124) : aperçu sans écriture, correspondance des colonnes, validation explicite par une personne habilitée, rapport ligne par ligne conservé et téléchargeable, original et provenance conservés, doublons jamais écrasants, idempotence, limites | `schemaImmobilisation` du moteur (source unique avec la saisie manuelle), `reprises-immobilisations.controller.ts`, migration 0046, écran `/dossiers/:id/inventaire/reprise` (D-092) | Tests moteur (40), parcours API sur pile réelle (20 + restitution), navigateur simulé et réel | Lecture XLSX FAITE (D-124, classeurs synthétiques) ; rattachement de composants par import FAIT (D-125) ; essai sur de vrais exports de logiciels comptables **(externe)** ; validation des conventions **(externe)** |
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
| Préparation de la liasse, régimes explicitement couverts | Tableaux déduits de la balance, périmètre documenté (`etats-fiscaux.md`) ; **colonne N-1** sur la liasse, le bilan et le compte de résultat projetés (D-103, `comparatif.ts`, `comparatif-n1.md`) ; **tableaux 2054, 2055 et 2033-C** (immobilisations et amortissements) déduits de la balance et du fichier des immobilisations (D-104, `tableaux-immobilisations.ts`, `tableaux-immobilisations.md`) | Tests moteur (`comparatif.test.ts`, `tableaux-immobilisations.test.ts`), parcours sur pile réelle (`parcours-comparatif-n1.itest.ts`, `parcours-tableaux-immobilisations.itest.ts`) | Tableaux non couverts listés (priorité suivante : 2033-D à G, 2058, 2059, 2065, `plan-achevement.md` P5 rang 6) ; livrés depuis : arrondi à l'euro (D-105), détail du compte de résultat et renvois des 2052, 2053 et 2033-B (D-106, D-107), résultat fiscal du 2033-B (D-110, D-111), 2054 bis, 2033-C cadre III et 2055 cadres B et C par saisie (D-112, D-113) ; cellules à saisir du 2054 (réévaluation, ventilation des diminutions, composants) ; codes de cases : vérifiés sur le rendu des PDF pour 2052, 2053, 2033-B, cadre III, 2055 B et C, à confirmer pour les autres tableaux ; N-1 sans inventaire de N-1, exercice précédent contigu seulement ; validation **(externe)** |
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
| Questions sur un dossier autorisé ; habilitations avant recherche ; citations ; période et périmètre ; données manquantes ; fait/calcul/hypothèse/interprétation ; abstention ; fonctions métier autorisées seulement ; pas de SQL libre ; contenus non fiables | `@comtaple/ia` (orchestration et garde-fous), routes `v1/dossiers/:id/assistant/questions`, onglet « Assistant » | 24 parcours API (sans IA sur pile réelle ; modèle contre simulateur avec la base réelle), navigateur simulé et réel | Portefeuille de dossiers autorisés FAIT (D-079, D-088) ; rédaction par le modèle réel **(externe)** ; d'ici là, mode « sans IA » étiqueté ; l'assistant est réservé aux membres du cabinet (D-142) |

## §16 — Socle SaaS, sécurité, conservation

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Sept rôles, habilitation par dossier | Énumérations, RLS, gardes d'API | Tests | — |
| MFA pour les comptes du cabinet, SSO | Gabarit de royaume de production (MFA obligatoire, emplacement SSO) | Import d'essai ; **enrôlement TOTP et connexion avec code essayés sur instance jetable (D-102, 36 contrôles)** | Royaume de production réel **(externe)** ; royaume de développement sans MFA (D-016) |
| Sessions, révocation, secrets, liens temporaires, types réels, quarantaine, antivirus, limites de débit, journaux sans secret | En place | Tests | Bac à sable dédié des analyseurs (aujourd'hui : processus du worker, conteneur sans privilèges) |
| Journal en ajout seul, intégrité, archivage protégé | Journal chaîné ; ancres préparées | Tests | Destination indépendante **(externe)** ; Object Lock **(externe)** |
| Documents RGPD et réglementaires | `docs/juridique/` (projets) | Documents | Validation DPO / avocat **(externe)** |
| Abonnements complets, virement, historique, exports de facturation | Moteur, API, outil éditeur, export des éléments de facturation | Tests | Grille tarifaire réelle **(externe)** |
| Restitution complète et devenir des données | Restitutions dossier et cabinet ; cycle complet de conservation et de fin de contrat IMPLÉMENTÉ MAIS DÉSACTIVÉ (échéances, reprise, objets, comptes, sauvegardes, éléments conservés détruits à terme, journal scellé puis détruit sur décision humaine, clôture avec certificat) ; `conservation.md`, D-100 | Tests, dont un cycle de bout en bout sur ressources JETABLES (base, bucket S3 d'essai, royaume Keycloak d'essai, répertoire de sauvegardes d'essai) | Durées à arrêter **(externe)** ; AUCUNE exécution réelle écrite ni activée : base locale, bucket des données, royaume réel, sauvegardes réelles et journal réel intacts ; décision à prendre sur la destruction du journal en production (protections d'ajout seul) et sur le sort de l'export scellé (DPO) |

## §17 — Qualité, exploitation, tests

| Exigence | Implémentation | Preuve | Reste réel |
|---|---|---|---|
| Capacités mesurées, pas d'objectif présenté comme mesure | `rapport-de-tests.md`, `exploitation.md` § 16, `scripts/mesure-portefeuille.mjs` | Mesures locales datées, dont un portefeuille de 300 dossiers (D-094) | Mesures sur l'environnement cible **(externe)** ; plusieurs utilisateurs simultanés ; portefeuille réel |
| Sauvegardes, restauration, RPO/RTO, reprise | Scripts, essais isolés, `exploitation.md` ; **restauration chronométrée depuis copies chiffrées (626 s, 7,5 Go, D-102)**, mise à jour et retour arrière essayés, diagnostic de préparation (`scripts/verifier-preparation.mjs`) | Essais sur ressources jetables | RPO/RTO : objectifs proposés, non mesurés en cible (le chiffre de 626 s n'est pas un RTO) ; clé réelle, hébergeur, ordonnanceur, destination d'ancrage externe : à raccorder **(externe)** |
| Fonctionnement dégradé sans IA | Aucune fonction ne dépend de l'IA ; replis étiquetés | Tests | — |
| Jeux synthétiques et exigences de recette | `packages/core/src/synthetique`, recettes | Tests | — |
| Dix parcours de bout en bout | Matrice parcours × preuve × lacune dans `couverture.md` (P3, D-101) ; parcours 1 enchaîné de bout en bout (`parcours-recette-dix.itest.ts`) | Tests | Parcours 2, 6, 7 : **simulés** (boîte réelle externe) ; parcours 10 : essai de restauration existant, non rejoué à la passe P3 (reste de P4) ; parcours 1 et 5 sur appareil réel : `recette-appareils.md` **jamais jouée** |
| Navigateurs / émulations / appareils distingués | `rapport-de-tests.md` ; procédure pas à pas et fiche de résultat vierge pour téléphone réel, Safari, VoiceOver et NVDA : `recette-appareils.md` (**préparée, jamais jouée**) | — | Appareils réels, Safari lui-même, lecteurs d'écran **(externe : personne et appareils)** |
| Profils et droits : refus attendus prouvés | Matrice 28 fonctions × 11 profils sur deux cabinets neufs, multi-cabinet, habilitation par dossier, expiration (D-101) | `parcours-droits-matrice.itest.ts` | Politique du « client en lecture » ARBITRÉE (D-142, R36 levé) ; test d'intrusion indépendant **(externe)** |
| Erreurs, dépendances indisponibles, reprise, messages d'échec explicites | 503 nommés (files, stockage, base, identité), bassin PostgreSQL non fatal, pièce jamais « en analyse » sans fin, reprise d'un import après arrêt brutal du worker (D-101, migration 0049) | `parcours-dependances.itest.ts`, `dependances.itest.ts`, `parcours-reprise-worker.itest.ts` | Pas de redondance ; pannes de la pile normale elle-même non jouées ; arrêt brutal pendant contrôles / exports non mesuré |
| Charge concurrente multi-utilisateur et multi-cabinet, gros imports avec budgets | Verrous consultatifs sur les clôtures identiques et la création d'exercices ; budgets mesurés (D-101) | `parcours-charge.itest.ts`, `parcours-gros-imports.itest.ts` | 12 sessions et 4 identités seulement ; une API et un worker ; mesures non transposables à la cible **(externe)** |

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
| Supervision OpenTelemetry (§5) | Aucune trace émise par l'API ni le worker | Fait (D-074, D-083) : traces de l'API et du worker propagées jusqu'aux travaux, sans donnée comptable, conservées dans un entrepôt auto-hébergé, essayées en local ; reste le déploiement |
| Fichiers volumineux en flux (§17) | Contrôles non réalisés au-delà de 500 000 lignes | Fait (D-075) : 19 contrôles en flux, égalité prouvée, mesuré sur 1 060 006 lignes ; reste borné par un budget explicite pour trois d'entre eux. Les écrans de l'API qui calculent en mémoire ont désormais des plafonds explicites, configurables et motivés (D-093), calés sur une mesure de mémoire (264 957 lignes) |
| Isolation des traitements PDF, image et XML (§16) | Analyseurs exécutés dans le processus du worker | PARTIEL — voir la ligne 11 de la liste unique (réconciliée le 2026-11-22). PROUVÉ : mode `processus` (défaut) : pièces, relevés et FEC dans un processus enfant borné ; mode `conteneur` : un conteneur dédié par fichier, supprimé après lui, sans réseau, sans privilège (capacités à zéro, `no-new-privileges`, utilisateur 65532), racine en lecture seule, tmpfs borné, mémoire, processus et durée bornés, sans variable ni fichier ni socket de l'hôte ; socket du moteur non exposé aux entrées non fiables (lanceur restreint) ; blocage de dockerd (29.5.2 et 29.10.0, aucune version corrigée publiée) reproduit et ATTÉNUÉ par un arrêt ordonné (≈ 310 arrêts sans blocage) ; **worker tué par SIGKILL : prouvé (D-109)** — le conteneur orphelin survit à son parent, borné à sa durée + 60 s + 5 minutes, puis balayé ; suite groupée 33 / 33 contre le moteur de la pile ; **étape CI exécutée sur GitHub** : verte et durcie depuis f2536f6, 16 réussites sur 16 dans la fenêtre des 35 runs du 2026-11-22 (81aa858 a échoué avant, D-151). RESTE : atténuation empirique et non garantie du défaut amont (NON clos, même après 16 exécutions CI vertes de l'étape dans la fenêtre bornée : D-151) ; mode jamais activé sur un hôte de production (décision d'exploitation) ; entrée à crédit non implémentée (D-109, à rouvrir si le mode est activé en production). Voir D-076, D-085, D-098, D-098 bis, D-109. |
| Tiers, factures, échéances et règlements (§7) | Pas de table des tiers ni de suivi des règlements par facture | Fait (D-077) : tiers, factures et avoirs suivis, échéances, règlements partiels et groupés, suspicion de double comptabilisation ; **tolérance de montant réglable** (nulle par défaut, par cabinet ou par dossier, écart toujours affiché, jamais appliqué seul) et **règlement groupé non lettré probable** proposé à confirmer (D-096) ; destinataire lu pour apparier les ventes (D-084), corrigeable à la main avec trace et relisible par une réanalyse explicite des pièces déjà stockées (D-091), euro seulement ; règles à valider **(externe)** |
| Assistant sur un portefeuille autorisé (§15) | Un seul dossier à la fois | Fait (D-079, D-088) : portefeuille de dossiers autorisés par tranches de vingt, période commune, recherche multi-dossiers, habilitations revérifiées à la relecture ; sans IA aujourd'hui |
| Notifications discrètes sur téléphone (§8A) | Notifications internes seulement, aucune notification poussée | Fait en partie (D-081, D-086) : cycle de vie complet (renouvellement, rotation du secret, retrait, **retrait en masse après rotation des clés VAPID** par commande de l'éditeur, D-097) ; notifications poussées sans aucune donnée par construction, désactivées par défaut, vérifiées contre simulateur ; réception réelle et écran verrouillé non essayés **(externe : appareils, décision d'activation)** |
| Amélioration contrôlée à partir des corrections (§13) | Les règles ne sont proposées que par saisie humaine ; aucune proposition tirée des corrections | Fait (D-080) : suggestions déterministes en cinq catégories, jamais activées seules, toutes branches exercées sur pile réelle ; seuils à valider **(externe)** |
| Devenir des données à la résiliation (§16) | Documenté, mais aucune procédure exécutable | Fait, DÉSACTIVÉ (D-078, D-099, D-100) : cycle complet de dix étapes (plan des comptes, base, objets, identité, fiches, sauvegardes, éléments conservés détruits à terme, scellement et destruction du journal sur décision humaine, clôture avec certificat), simulation par défaut, durées paramétrables (proposition non validée), exécution réelle refusée sans référence de validation ; éprouvé de bout en bout sur ressources JETABLES (base, bucket S3 versionné avec Object Lock, royaume Keycloak d'essai, répertoire de sauvegardes d'essai). AUCUNE exécution sur les données réelles ; durées juridiques et destruction du journal en production à arrêter **(externe)** |

## Reste réel, hors dépendances externes

Les huit lacunes rouvertes à la seconde relecture sont traitées (tableau ci-dessus, décisions D-074 à D-081) ; ce qui reste de chacune est dit dans sa ligne. Liste d'ensemble du reste réalisable sans intervention extérieure : `plan.md`, section « Chantier du 2026-11-19 (soir) ».
