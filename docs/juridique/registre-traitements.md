# Cartographie des traitements et projet de registre

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

État au 2026-11-19 : le logiciel ne tourne qu'en local, sur des jeux de données synthétiques. Aucune donnée personnelle réelle n'est traitée, aucun cabinet n'est client. Ce document décrit les traitements tels qu'ils existeraient à la mise en service, à partir de ce que le code fait réellement (voir `../couverture.md`, `../architecture.md`). Les qualifications de rôle renvoient à `roles-rgpd.md` et restent des propositions.

## 1. Identification

| Élément | Valeur |
|---|---|
| Organisme | `[À COMPLÉTER : dénomination de l'Éditeur, forme, siège, RCS]` |
| Représentant | `[À COMPLÉTER]` |
| Délégué à la protection des données | Aucun désigné. `[À TRANCHER : désignation obligatoire ou non au regard de l'article 37 §1 du RGPD (suivi régulier et systématique à grande échelle, ou catégories particulières à grande échelle) ; désignation volontaire recommandée ou non]` |
| Point de contact protection des données | `[À COMPLÉTER : adresse de contact]` |

Obligation de registre : l'article 30 du RGPD impose un registre au responsable (§1) et au sous-traitant (§2). La dérogation du §5 (moins de 250 employés) ne joue pas si le traitement n'est pas occasionnel : le service étant permanent, un registre est à tenir. La CNIL recommande deux registres distincts à l'organisme qui est à la fois responsable et sous-traitant.

## 2. Catégories de personnes et de données

### 2.1 Personnes concernées

| Catégorie | Qui |
|---|---|
| Utilisateurs du Cabinet | Administrateur, associé / expert-comptable, réviseur, collaborateur |
| Utilisateurs de l'Entité cliente | Client déposant, client en lecture |
| Personnel de l'Éditeur | Compte « support » à accès temporaire |
| Personnes citées dans les pièces et les écritures | Dirigeants, salariés, clients et fournisseurs personnes physiques (entrepreneurs individuels, particuliers), titulaires de comptes bancaires, signataires de lettres de mission, tiers mentionnés dans un libellé |
| Correspondants de messagerie | Expéditeurs et destinataires des messages lus par un connecteur (non activé) |
| Contacts commerciaux du Cabinet | Personne qui souscrit, contact de facturation |

### 2.2 Données

| Catégorie | Contenu | Où |
|---|---|---|
| Identité et compte | Nom, prénom, adresse électronique, identifiant technique, rôle, appartenances, habilitations par dossier ; empreinte du mot de passe et facteurs d'authentification | Keycloak (identités) ; PostgreSQL (`utilisateurs`, `appartenances`, `habilitations_dossier`) |
| Pièces comptables | Factures, relevés bancaires, lettres de mission signées, tout fichier déposé ; originaux non modifiés | Stockage objet (clé = empreinte SHA-256) |
| Données extraites des pièces | Champs de facture (émetteur, destinataire, montants, dates, identifiants), texte OCR, pages | PostgreSQL (`extractions`, `pages_document`, `factures`) |
| Données comptables | Lignes d'écriture (FEC et données de travail) : comptes, libellés, tiers, montants, références de pièce | PostgreSQL (`lignes_ecriture`, `lots_import`) |
| Données bancaires | Mouvements importés depuis des fichiers (camt.053, OFX, CSV) : dates, montants, libellés, contreparties, IBAN (masqué à l'affichage) | PostgreSQL (`mouvements_bancaires`, `rapprochements`) |
| Travaux du Cabinet | Constats, décisions motivées, commentaires, règles du Cabinet, dossiers de révision, écritures d'inventaire proposées, missions, lettres, conseils, temps observés | PostgreSQL ; exports dans le stockage objet |
| Journal d'audit | Qui a fait quoi, quand, sur quel objet ; consultations du support ; chaîné par empreinte, en ajout seul | PostgreSQL (`journal_audit`) |
| Messagerie (non activée) | Jetons OAuth chiffrés (AES-256, clé dérivée d'un secret d'environnement), métadonnées de messages, pièces jointes retenues | PostgreSQL (`connexions_mail`, `messages_mail`) ; stockage objet |
| Notifications internes | Identifiants et quelques valeurs non sensibles ; texte composé à la lecture | PostgreSQL |
| Abonnement | Offre, échéances, événements de facturation, virements rapprochés | PostgreSQL (`abonnements`, `evenements_facturation`) |
| Données sur l'appareil | Dépôts en attente (fichiers) dans le navigateur du téléphone ; cookie de session chiffré | IndexedDB de l'appareil ; navigateur |
| Journaux techniques et métriques | Journaux applicatifs ; métriques Prometheus sans identifiant de cabinet, de dossier ni de personne | Processus API / worker |

### 2.3 Données sensibles ou à risque

Le logiciel ne demande aucune donnée relevant de l'article 9 du RGPD. Mais le contenu des pièces n'est pas maîtrisé : une facture ou un relevé peut révéler une donnée de santé (facture médicale d'un entrepreneur individuel), une appartenance syndicale (cotisation), une condamnation (amende). Les relevés bancaires et les données de rémunération sont des données « à caractère hautement personnel » au sens des lignes directrices sur l'AIPD. Si un cabinet dépose des bulletins de paie ou des pièces sociales, le numéro de sécurité sociale (NIR) peut s'y trouver : le logiciel ne l'extrait pas, mais il le stocke dans l'original et, le cas échéant, dans le texte OCR. `[À TRANCHER : faut-il exclure contractuellement certaines catégories de pièces, ou encadrer leur présence]`

## 3. Projet de registre du sous-traitant (art. 30 §2)

Hypothèse : l'Éditeur agit pour le compte du Cabinet (voir `roles-rgpd.md`). Le registre réel listera chaque Cabinet client ; à ce jour il n'y en a aucun.

| # | Catégorie de traitement effectué pour le compte du Cabinet | Données | Personnes | État réel du logiciel |
|---|---|---|---|---|
| ST-1 | Collecte et conservation des pièces (dépôt depuis téléphone ou ordinateur, téléversement reprenable, analyse antivirus, détection de doublon) | Pièces, identité du déposant | Utilisateurs, personnes citées | Testé sur jeux synthétiques |
| ST-2 | Extraction des données des pièces (PDF à couche texte, Factur-X / CII / UBL, OCR local) | Pièces, données extraites | Personnes citées | En attente de validation ; qualité jamais mesurée sur pièces réelles |
| ST-3 | Import et normalisation des écritures (FEC, données de travail) | Données comptables | Personnes citées | Testé ; aucun FEC réel |
| ST-4 | Import de relevés bancaires par fichier et propositions de rapprochement | Données bancaires | Titulaires, contreparties | Testé / en attente de validation |
| ST-5 | Contrôles déterministes, constats, révision, dossier de révision, états en projet, indicateurs du dossier | Données comptables, travaux | Personnes citées, utilisateurs du Cabinet | En attente de validation métier |
| ST-6 | Missions, lettres de mission, avenants, registre des conseils, rentabilité par mission | Travaux, identité des signataires, temps observés (agrégés par cabinet et dossier, jamais par personne) | Utilisateurs, dirigeants | Testé / en attente de validation |
| ST-7 | Collecte de pièces par messagerie (Gmail, Microsoft 365, lecture seule) | Jetons, métadonnées de messages, pièces jointes | Correspondants | Développé, vérifié contre simulateur, jamais connecté à une vraie boîte |
| ST-8 | Recherche textuelle dans les pièces, écritures et constats autorisés | Toutes données du dossier | Toutes | Testé ; pas de recherche vectorielle |
| ST-9 | Gestion des comptes, des rôles et des habilitations du Cabinet | Identité et compte | Utilisateurs | Testé ; création des comptes par l'Éditeur |
| ST-10 | Journalisation des actions et des accès (journal d'audit du Cabinet) | Journal d'audit | Utilisateurs, support | Testé ; pas d'archivage externe |
| ST-11 | Restitution d'un dossier ou d'un cabinet (archive ZIP avec manifeste d'empreintes) | Toutes données du périmètre | Toutes | Testé |
| ST-12 | Sauvegarde et restauration | Toutes | Toutes | Testé en local seulement ; sauvegardes locales en clair ; politique de production non définie |
| ST-13 | Assistance par un compte support (lecture seule, 72 h au plus, sur habilitation donnée par un gestionnaire du Cabinet, chaque consultation tracée) | Données des dossiers habilités | Toutes | Testé |
| ST-14 | Notifications internes à l'application | Identifiants | Utilisateurs | Testé ; aucun envoi extérieur |
| ST-15 | Qualification assistée par IA, suggestions de rapprochement, assistant documenté | Extraits de pièces et d'écritures transmis au modèle | Personnes citées, utilisateurs | **Non implémenté** : passerelle IA non connectée ; aucune donnée n'est envoyée à un modèle |
| ST-16 | Veille réglementaire et applicabilité par dossier | Caractéristiques du dossier (territoire, régime, forme, NAF) ; pas de donnée personnelle hors entrepreneur individuel | Entités | Testé ; aucune évolution réelle qualifiée |

Pour chaque Cabinet, le registre devra porter (art. 30 §2) : nom et coordonnées du Cabinet responsable et de son DPO éventuel ; catégories de traitements ; transferts hors UE (aucun prévu, sous réserve des vérifications de `sous-traitants.md`) ; description générale des mesures de sécurité (§6 ci-dessous).

## 4. Projet de registre du responsable (art. 30 §1)

Traitements pour lesquels l'Éditeur déterminerait lui-même finalités et moyens. Bases légales proposées, à valider.

| # | Finalité | Données | Personnes | Base légale proposée (art. 6 §1) | Destinataires | Durée | État réel |
|---|---|---|---|---|---|---|---|
| RT-1 | Gestion de la relation contractuelle avec le Cabinet : ouverture du cabinet, essai, abonnement, changement d'offre, résiliation | Identité et coordonnées du contact, offre, historique | Contacts du Cabinet | b) exécution du contrat (personne morale cliente : `[À TRANCHER : b) ou f) intérêt légitime pour les données des contacts personnes physiques]`) | Éditeur | Voir `../conservation.md` | Testé avec grille fictive |
| RT-2 | Facturation et comptabilité de l'Éditeur | Échéances, virements, contact de facturation | Contacts du Cabinet | c) obligation légale | Éditeur, son expert-comptable, administration | 10 ans (proposition) | Facturation légale hors périmètre du logiciel |
| RT-3 | Sécurité du service : authentification, détection d'abus, journaux techniques, sauvegardes de la plateforme | Identité et compte, traces techniques | Utilisateurs | `[À TRANCHER : traitement propre de l'Éditeur fondé sur f) intérêt légitime, ou mesure de sécurité exécutée comme sous-traitant au titre de l'article 32 — voir roles-rgpd.md §4.2]` | Éditeur, hébergeur | Proposition : 6 mois à 1 an | Journaux applicatifs locaux ; pas de supervision déployée |
| RT-4 | Gestion des demandes de support | Identité du demandeur, contenu de la demande, trace d'ouverture de l'accès | Utilisateurs | b) ou f) `[À TRANCHER]` | Éditeur | `[À COMPLÉTER]` | Ouverture de l'accès par ligne de commande ; aucun outil de tickets |
| RT-5 | Mesure d'usage du service et amélioration du produit | Indicateurs par cabinet et par dossier, jamais par personne ; métriques sans identifiant | — (agrégats) | `[À TRANCHER : voir roles-rgpd.md §4.3]` | Éditeur | `[À COMPLÉTER]` | Indicateurs affichés au Cabinet ; aucune exploitation par l'Éditeur à ce jour |
| RT-6 | Gestion des violations de données et des demandes d'exercice de droits adressées à l'Éditeur | Identité, contenu de la demande, registre des violations | Demandeurs, personnes touchées | c) obligation légale | Éditeur, CNIL le cas échéant | `[À TRANCHER]` | Procédures à l'état de projet |
| RT-7 | Gestion du personnel de l'Éditeur (comptes support, habilitations internes) | Identité, traces d'accès | Personnel | b) / c) | Éditeur | `[À COMPLÉTER]` | Hors logiciel |

Ne figurent pas : prospection commerciale, site vitrine, cookies de mesure d'audience — rien de cela n'existe dans le dépôt. L'application n'utilise qu'un cookie de session chiffré, côté serveur (BFF) ; `[À TRANCHER : confirmer qu'il relève des traceurs strictement nécessaires, exemptés de consentement]`.

**Engagement produit à reprendre au contrat** : les données des Cabinets ne servent jamais à entraîner un modèle. Aucun traitement d'entraînement n'existe dans le code.

## 5. Cartographie des flux

### 5.1 Flux réels aujourd'hui (local)

Tout reste sur le poste de développement ; les ports ne sont publiés que sur `127.0.0.1`. Aucun flux sortant portant des données de dossier. Flux sortants existants : surveillance de pages officielles par la veille (requêtes vers des sites publics, sans donnée personnelle).

### 5.2 Flux prévus à la mise en service

| # | De | Vers | Données | Protection prévue | État |
|---|---|---|---|---|---|
| F1 | Navigateur / téléphone de l'utilisateur | Application web (BFF) | Identifiants de session, pièces, saisies | HTTPS ; session détenue côté serveur, aucun jeton dans le navigateur | Local uniquement |
| F2 | Web (BFF) | API | Requêtes avec jeton d'accès | Réseau interne, TLS prévu | Local |
| F3 | API / worker | PostgreSQL | Toutes données structurées | RLS activé et forcé par cabinet et par dossier ; rôles sans `BYPASSRLS` | Testé |
| F4 | API / worker | Stockage objet | Originaux, exports, archives | Adressage par empreinte ; chiffrement au repos `[À COMPLÉTER : mécanisme de l'hébergeur, non vérifié]` | S3 local |
| F5 | API | Redis (files) | Identifiants seulement, aucune donnée de dossier | Réseau interne | Testé |
| F6 | Worker | ClamAV | Contenu des fichiers (flux) | Local, aucun appel réseau externe | Testé |
| F7 | Worker | Service OCR (PaddleOCR) | Images de pages | Local ; le service ne doit avoir aucun accès sortant | Testé |
| F8 | Web / API | Keycloak | Authentification OIDC | Auto-hébergé | Royaume de développement, sans MFA |
| F9 | Tous services | Hébergeur (OVHcloud Public Cloud, région française) | Toutes | Contrat et accord de traitement à conclure | **Non déployé** |
| F10 | Worker | OVHcloud AI Endpoints | Extraits de pièces, d'écritures, questions | À définir (minimisation, absence de conservation à vérifier) | **Non connecté** |
| F11 | Google (Gmail API) / Microsoft (Graph) | Worker | Messages et pièces jointes des boîtes connectées, en lecture seule | OAuth ; jetons chiffrés | **Jamais connecté** |
| F12 | Plateforme | Destination de sauvegarde | Toutes | Chiffrement préparé, non activé | Local, en clair |
| F13 | Plateforme | Tiers d'ancrage du journal d'audit | Empreintes seulement (pas de donnée de dossier) | — | Aucun tiers choisi |
| F14 | Utilisateur habilité | Poste de l'utilisateur | Archive de restitution (ZIP, ni chiffrée ni signée) | Téléchargement authentifié, réservé au demandeur pour un cabinet entier | Testé |

Transferts hors Union européenne : aucun n'est prévu par conception. Cela reste à confirmer pour chaque fournisseur (`sous-traitants.md`), en particulier pour F11 : Google et Microsoft sont des groupes américains ; `[À TRANCHER : le flux F11 est-il un transfert imputable à l'Éditeur, sachant que les messages sont déjà chez le fournisseur de messagerie choisi par le Cabinet]`.

## 6. Mesures de sécurité (description générale, état réel)

En place et testé (local, jeux synthétiques) :

- Isolation par cabinet et par dossier : RLS PostgreSQL activé et forcé, trois rôles de base distincts, contexte tiré du jeton vérifié (décision D-007). Limite assumée : ne protège pas contre l'exécution de SQL arbitraire sous le rôle applicatif.
- Authentification OIDC avec PKCE, session côté serveur.
- Journal d'audit en ajout seul, chaîné par empreinte, avec vérification d'intégrité. Limites : un superutilisateur de la base peut désactiver les déclencheurs ; aucun ancrage externe.
- Antivirus bloquant ; détection du type réel ; limites de taille ; analyseurs sans exécution ni réseau ; contenus des pièces traités comme des données.
- Accès du support : ouvert par l'Éditeur, 72 h au plus, lecture seule, habilitation par un gestionnaire du Cabinet, consultation tracée.
- Jetons de messagerie chiffrés ; supprimés à la déconnexion d'une boîte.
- Conteneurs en lecture seule, sans privilèges, utilisateur non privilégié.
- Sauvegarde et essais de restauration (base, objets, Keycloak) en local.

Non en place à ce jour :

- Second facteur d'authentification (non imposé dans le royaume de développement).
- Chiffrement des sauvegardes (outil prêt, aucune clé durable).
- Chiffrement au repos et en transit en production (non déployé).
- Supervision, détection d'intrusion, analyse automatique des journaux.
- Test d'intrusion indépendant ; analyse de vulnérabilités des images.
- Bac à sable dédié pour l'analyse des pièces.
- Purge et effacement (voir `../conservation.md`).

## Références

Consultées le 2026-11-19, sauf mention contraire.

- RGPD, art. 4, 6, 9, 30, 32, 37 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- CNIL, « Le registre des activités de traitement » (page du 13 avril 2018) : <https://www.cnil.fr/fr/RGDP-le-registre-des-activites-de-traitement>
- CNIL, « Guide du sous-traitant », édition septembre 2017 : <https://www.cnil.fr/sites/default/files/atoms/files/rgpd-guide_sous-traitant-cnil.pdf>
- Règles sur les traceurs (loi n° 78-17, art. 82) : référence non revérifiée en ligne le 2026-11-19.
