# Politique de conservation, de restitution et de suppression

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

État : cadre technique en place pour une partie. Des durées sont PROPOSÉES plus bas avec leur fondement (section « Durées proposées ») ; aucune n'est arrêtée, et elles sont à valider par un professionnel du droit et par un expert-comptable avant toute mise en service. Aucune durée n'est appliquée automatiquement à ce jour, et aucune purge n'existe hors celles décrites ci-dessous.

## Ce que le logiciel fait aujourd'hui

| Catégorie | Emplacement | Comportement réel |
|---|---|---|
| Originaux des pièces et des fichiers comptables | Stockage objet, clé = empreinte SHA-256 | Jamais réécrits ni modifiés. Aucune suppression automatique. |
| Morceaux de téléversement | Stockage objet, préfixe `tmp/` | Supprimés dès la clôture ou l'abandon explicite du téléversement. Un téléversement jamais terminé expire après 7 jours ; ses morceaux sont alors purgés par le worker (purge non exercée par un test). |
| Données extraites, lignes d'écriture, constats, décisions | PostgreSQL | Versionnées ; les anciennes versions sont conservées. Aucune purge. |
| Journal d'audit | PostgreSQL, ajout seul, chaîné par empreinte | Ni modification ni suppression possibles, y compris par le propriétaire des tables. Pas encore d'archivage externe protégé. |
| Sauvegardes | Script local `scripts/sauvegarder.sh` | Développement uniquement. La politique de production est à définir. |
| Dépôts en attente sur le téléphone | IndexedDB de l'appareil | Voir la documentation de l'application web. |

## Ce qui est modélisé mais pas appliqué

La table `politiques_conservation` permet de déclarer, par cabinet et par catégorie, une durée, son fondement et le caractère immuable. Aucun traitement ne la lit encore. L'immuabilité est désactivée par défaut : une conservation irréversible n'est jamais appliquée sans durée ni responsable définis.

## Object Lock

Source : documentation OVHcloud, <https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-managing-object-lock> (page mise à jour le 5 novembre 2026, consultée le 2026-11-19).

- Deux modes de rétention, gouvernance et conformité, plus une conservation légale (« legal hold »).
- Le versionnement du bucket doit être activé.
- Le verrouillage se choisit À LA CRÉATION du bucket et ne peut pas être ajouté ensuite ; une fois activé, il est irréversible pour ce bucket.
- En mode conformité, ni le mode ni la durée ne peuvent être modifiés une fois appliqués à un objet.

Conséquence de conception : les buckets de production destinés aux éléments à rétention immuable doivent être créés avec le verrouillage dès l'origine, séparément du bucket courant. Rien de cela n'est testé : le stockage local de développement ne sert pas à valider Object Lock.

## Restitution

Export de restitution par dossier (habilitation de validation) : archive ZIP contenant les originaux non modifiés (relus et comparés à leur empreinte), les données structurées (pièces et leurs versions d'extraction, imports, révision, décisions, banque, rapprochements, règles du cabinet applicables, journal d'audit du dossier), les écritures normalisées en CSV, et un manifeste d'empreintes SHA-256. Les originaux écartés par l'antivirus ne sont pas restitués ; le manifeste les liste. L'export reste possible quand l'abonnement est suspendu ou résilié.

Restitution d'un cabinet entier (décision D-043, voir `couverture.md`) : réservée aux gestionnaires, limitée aux dossiers où le demandeur a le niveau « validation » (les autres sont listés et l'archive est marquée incomplète), archive construite en flux, téléchargeable par son seul demandeur, ni chiffrée ni signée.

Non couvert : restitution des sauvegardes et des journaux techniques ; format d'échange normalisé avec un autre logiciel.

## Suppression à la résiliation

Non implémentée. La résiliation d'un abonnement ferme les dépôts à son échéance mais ne supprime aucune donnée. Le devenir de chaque catégorie (suppression, conservation obligatoire, sauvegardes, journaux) reste à définir.

## Notifications internes : archivage et rétention

Les notifications n'existent que dans l'application (aucun envoi extérieur) et ne portent que des identifiants et quelques valeurs non sensibles ; leur texte est composé à la lecture.

| Étape | Qui | Effet | Réversible |
|---|---|---|---|
| Archivage par le destinataire | Chaque personne, pour ses notifications | Sort de la liste courante et du décompte ; reste consultable | Oui (désarchivage) |
| Archivage par la politique | Éditeur, opération explicite | Notifications LUES depuis plus de 30 jours | Oui |
| Suppression par la politique | Éditeur, opération explicite | Notifications ARCHIVÉES depuis plus de 180 jours | Non |

Une notification non lue n'est jamais archivée ni supprimée par la politique. La politique s'exécute par `node scripts/editeur.mjs notifications-retention [jours avant archivage] [jours avant suppression]`, qui SIMULE par défaut ; `--appliquer` l'exécute. Aucun traitement ne la lance automatiquement, et les rôles de l'application ne peuvent ni l'appeler ni supprimer une notification. État au 2026-11-19 : appliquée uniquement sur des données temporaires de test ; simulée sur la base locale (rien à faire) ; jamais appliquée à des données conservées. Les durées de 30 et 180 jours sont des valeurs de travail, sans fondement réglementaire, à valider.

## Durées proposées (à valider — rien n'est arrêté)

Cette section remplace l'ancienne mention « aucune durée chiffrée ». Elle PROPOSE, pour chaque catégorie, une durée, un point de départ et un fondement. Ce sont des propositions de travail rédigées sans juriste : elles ne sont ni arrêtées, ni paramétrées dans le logiciel, ni appliquées. Validation attendue : V8 de `risques.md`.

### Principes retenus pour les propositions

1. **Qui décide.** Pour les données des dossiers, la durée est un moyen essentiel du traitement : elle revient au responsable (le Cabinet, ou son client — voir `juridique/roles-rgpd.md`). L'Éditeur propose des valeurs par défaut et exécute. L'Éditeur ne fixe seul que les durées de ses propres traitements.
2. **Sur qui pèse l'obligation légale.** L'obligation de conserver les documents comptables et les pièces pèse sur l'entreprise (l'Entité cliente), pas sur le Cabinet ni sur l'Éditeur. Le Cabinet détient des copies et ses propres travaux. `[À TRANCHER : le Cabinet et l'Éditeur peuvent-ils se fonder sur l'obligation de leur client pour conserver dix ans, ou doivent-ils retenir une durée propre, plus courte, liée à la mission et à la prescription]`
3. **Trois temps** (méthode de la CNIL) : base active (dossier en cours), archivage intermédiaire (accès restreint, pour une obligation légale ou un contentieux), puis suppression. Le logiciel ne connaît aujourd'hui que la base active : il n'a ni archivage intermédiaire, ni suppression.
4. **Fin de contrat.** Les durées ci-dessous valent tant que le Cabinet est client. À la fin du contrat : restitution, puis suppression chez l'Éditeur dans un délai à fixer (proposition : 90 jours), le Cabinet poursuivant la conservation par ses propres moyens.
5. Une durée de conservation plus longue que l'obligation légale doit être justifiée ; la fiche Service-Public rappelle que l'archivage prolongé est possible sauf pour les documents contenant des données personnelles.

### Données des dossiers

| Catégorie | Durée proposée | Point de départ | Fondement | Vérification du fondement (2026-11-19) |
|---|---|---|---|---|
| Documents comptables : écritures importées (FEC, données de travail), lots d'import, balance, journaux | 10 ans | Clôture de l'exercice | Code de commerce, art. L. 123-22 (documents comptables et pièces justificatives) | Durée et point de départ lus sur la fiche Service-Public F10029 (« vérifié le 1er juillet 2024 »), qui cite l'article ; CNIL (page « durées de conservation », 2 avril 2026) cite « factures conservées 10 ans selon le Code de commerce ». **Article non revérifié sur Légifrance** (accès refusé) |
| Pièces justificatives : factures clients et fournisseurs, bons, relevés bancaires utilisés comme justificatifs, originaux déposés | 10 ans | Clôture de l'exercice | Idem | Idem |
| Délai fiscal applicable aux mêmes livres, registres, documents et pièces | 6 ans (couvert par les 10 ans) | Dernière opération mentionnée sur les livres ou registres, ou date d'établissement des documents | Livre des procédures fiscales, art. L. 102 B | Lu sur BOFiP, BOI-CF-COM-10-10-30 du 03/09/2025, et sur la fiche Service-Public. Article non revérifié sur Légifrance. Service-Public mentionne un délai porté à 10 ans en cas d'activité occulte |
| Factures électroniques : forme de conservation | Format d'origine, pendant le délai fiscal de 6 ans au moins | Idem | LPF, art. L. 102 B ; doctrine BOFiP | BOFiP du 03/09/2025 : conservation sur support informatique dans le format d'origine, avec garantie d'authenticité, d'intégrité et de lisibilité. Le logiciel conserve les originaux sans les modifier, adressés par empreinte : compatible dans son principe ; **aucune valeur d'archivage probant n'est revendiquée** |
| Relevés bancaires non retenus comme pièces justificatives | 5 ans | `[À TRANCHER]` | Délai des documents bancaires | Fiche Service-Public (« document bancaire : 5 ans ») ; texte de rattachement non identifié avec certitude |
| Données extraites des pièces, versions d'extraction, texte OCR, pages | Durée de la pièce dont elles dérivent | — | Accessoire de la pièce | Sans texte propre |
| Mouvements bancaires importés, rapprochements | 10 ans | Clôture de l'exercice | Rattachés aux documents comptables. `[À TRANCHER : ou 5 ans comme document bancaire]` | Voir ci-dessus |
| Lettres de mission, avenants, lettre signée jointe | 5 ans (proposition basse) à 10 ans (alignement) | Fin de la mission | Prescription de droit commun des actions personnelles (Code civil, art. 2224) ; délai des contrats et correspondances commerciales | Fiche Service-Public : « contrat ou convention conclu dans le cadre d'une relation commerciale : 5 ans » ; elle cite l'art. 2224 du Code civil et les art. L. 110-1 à L. 110-4 du Code de commerce. Articles non revérifiés sur Légifrance |
| Dossiers de travail du Cabinet : constats, décisions, commentaires, dossiers de révision, écritures d'inventaire proposées, registre des conseils, règles du Cabinet | 10 ans (alignement sur les pièces), et au minimum 5 ans après la fin de la mission | Clôture de l'exercice concerné | Défense du Cabinet en responsabilité (Code civil, art. 2224 : cinq ans à compter du jour où le titulaire du droit a connu ou aurait dû connaître les faits — formule citée de mémoire, **non revérifiée**) ; contrôle de l'Ordre | **Aucune source officielle vérifiée ne fixe une durée pour les dossiers de travail de l'expert-comptable.** Les normes professionnelles de l'Ordre n'ont pas été consultées. `[À TRANCHER avec un expert-comptable]` |
| Temps observés, rentabilité par mission | 5 ans | Fin de la mission | Gestion interne du Cabinet | Sans texte propre ; `[À TRANCHER]` |
| Pièces de paie éventuellement déposées (hors périmètre fonctionnel) | 5 ans pour le double du bulletin de paie | Émission | Code du travail, art. L. 3243-4 | Cité par la CNIL (page du 2 avril 2026) et par la fiche Service-Public ; article non revérifié sur Légifrance. `[À TRANCHER : interdire ou encadrer ces dépôts]` |
| Messagerie : métadonnées des messages lus, pièces à qualifier non retenues | 12 mois au plus pour les messages sans pièce retenue ; durée de la pièce pour ceux qui en ont fourni une | Lecture du message | Minimisation (RGPD, art. 5 §1 c) et e)) | Sans durée légale ; valeur de travail. Fonction jamais connectée |
| Jetons de messagerie (chiffrés) | Durée de la connexion | — | Nécessité | Comportement réel : supprimés à la déconnexion de la boîte |
| Fichiers écartés par l'antivirus (quarantaine) | 30 jours puis suppression | Verdict | Sécurité ; inutilité pour la mission | Sans texte ; valeur de travail. Aujourd'hui conservés sans limite et jamais servis |
| Morceaux de téléversement inachevé | 7 jours | Dernière activité | Nécessité | Déjà en place (voir plus haut) |
| Dépôts en attente sur le téléphone | 7 jours | Mise en attente | Nécessité | Purge testée unitairement seulement |
| Archives de restitution générées | 30 jours | Génération | Nécessité (elles dupliquent les données) | Sans texte ; aujourd'hui conservées sans limite |
| Notifications internes | 30 jours après lecture (archivage), 180 jours après archivage (suppression) | — | Valeurs de travail sans fondement réglementaire | Politique existante, non automatisée |
| Sorties d'IA (table `propositions_ia`, vide) | Durée de l'objet auquel elles se rattachent | — | Traçabilité de la décision humaine | Aucune donnée ; conservation des requêtes chez le fournisseur **non vérifiée** (V10) |

### Comptes, traces et exploitation

| Catégorie | Durée proposée | Point de départ | Fondement | Vérification |
|---|---|---|---|---|
| Comptes des utilisateurs (Keycloak, `utilisateurs`, appartenances, habilitations) | Durée de l'appartenance ; désactivation immédiate au départ ; suppression ou pseudonymisation du compte 12 mois après | Désactivation | Nécessité ; minimisation | Sans durée légale. Aujourd'hui : désactivation possible, aucune suppression. `[À TRANCHER : l'identité doit rester lisible dans le journal d'audit pendant sa durée]` |
| Journal d'audit — traces d'accès et de consultation (dont accès du support) | 12 mois ; jusqu'à 3 ans si un contrôle interne le justifie | Événement | Recommandation de la CNIL sur la journalisation (délibération n° 2021-122 du 14 octobre 2021) : six mois à un an ; au-delà, jusqu'à trois ans dans les cas les plus courants, si le besoin est démontré et documenté ; cas spécifiques au cas par cas | Lu sur la page CNIL du 18 novembre 2021. Délibération non revérifiée sur Légifrance. La recommandation « n'a pas vocation à être prescriptive » |
| Journal d'audit — traces d'actes métier (dépôt, validation, décision, approbation, restitution) | Durée du dossier de travail (10 ans proposés) | Événement | Preuve des diligences ; cas « spécifique » au sens de la recommandation CNIL | **Conflit à arbitrer** : le journal actuel est unique, chaîné et en ajout seul ; il ne distingue pas ces deux familles et ne permet aucune suppression. Appliquer deux durées suppose de le scinder ou de l'archiver par périodes (non conçu). `[À TRANCHER]` |
| Journaux techniques applicatifs, métriques | 6 mois | Événement | Recommandation CNIL (bas de la fourchette) | Idem. Les métriques ne portent aucun identifiant de personne |
| Sauvegardes | 30 à 90 jours de rétention glissante, à fixer avec l'hébergeur | Prise de la sauvegarde | Sécurité (RGPD, art. 32) ; cohérence avec l'effacement : une donnée supprimée subsiste dans les sauvegardes jusqu'à leur rotation | Sans durée légale. Politique de production non définie. Un bucket verrouillé (Object Lock, mode conformité) interdirait toute suppression avant l'échéance : à ne choisir qu'en connaissance de cause |
| Ancres du journal d'audit (empreintes déposées chez un tiers) | Durée du journal | — | Preuve d'intégrité | Aucun dépôt réalisé |
| Registre des violations de données | 5 ans | Clôture de l'incident | Démonstration de conformité (RGPD, art. 33 §5) ; prescription | Sans durée légale identifiée. `[À TRANCHER]` |
| Demandes d'exercice de droits et réponses | 5 ans `[À TRANCHER]` | Réponse | Preuve | Sans durée vérifiée |

### Données de l'Éditeur comme responsable

| Catégorie | Durée proposée | Point de départ | Fondement | Vérification |
|---|---|---|---|---|
| Contrats et échanges avec le Cabinet | 5 ans | Fin du contrat | Prescription (Code civil, art. 2224 ; Code de commerce, art. L. 110-4) | Fiche Service-Public ; articles non revérifiés sur Légifrance |
| Factures émises, pièces et documents comptables de l'Éditeur, événements de facturation | 10 ans | Clôture de l'exercice | Code de commerce, art. L. 123-22 ; LPF, art. L. 102 B (6 ans) | Voir plus haut |
| Données de contact du Cabinet | Durée de la relation, puis 3 ans `[À TRANCHER]` | Fin de la relation | Usage courant en gestion commerciale | **Non vérifié** : aucune source consultée pour ce délai |
| Traces d'ouverture et de fermeture des accès support | Comme le journal d'audit du Cabinet concerné | — | Preuve | — |

### Conséquences pour le logiciel (rien n'est fait)

1. La table `politiques_conservation` devrait porter ces catégories, avec une durée, un point de départ et un fondement par cabinet ; aucun traitement ne la lit.
2. Le point de départ « clôture de l'exercice » suppose de rattacher chaque pièce à un exercice : c'est le cas des écritures et des lots, pas de toutes les pièces.
3. Il manque : l'archivage intermédiaire (retrait des travaux courants avec accès restreint), la purge à l'échéance, la suppression à la résiliation, la rotation des sauvegardes, le traitement du journal d'audit.
4. Un original est adressé par son empreinte et peut être partagé entre réceptions (doublon binaire) : une purge doit vérifier qu'aucune autre référence ne subsiste.
5. Toute purge devra être simulable, journalisée, réversible pendant un délai de grâce, et laisser une trace de ce qui a été détruit sans en conserver le contenu.

### Ce qu'un professionnel doit valider

- Chaque ligne des tableaux ci-dessus : durée, point de départ, fondement.
- La question de principe n° 2 (obligation du client invoquée par le Cabinet et l'Éditeur).
- La durée des dossiers de travail du Cabinet (aucune source officielle vérifiée).
- Le double régime du journal d'audit et sa faisabilité.
- Le délai de suppression après fin de contrat et la rétention des sauvegardes.
- L'articulation avec le droit à l'effacement (`juridique/gestion-des-droits.md` §6).

### Sources des durées

Consultées le 2026-11-19.

- Service-Public Entreprendre, « Quels sont les délais de conservation des documents pour les entreprises ? », fiche F10029, vérifiée le 1er juillet 2024 : <https://entreprendre.service-public.gouv.fr/vosdroits/F10029>
- BOFiP, BOI-CF-COM-10-10-30, publication du 03/09/2025 : <https://bofip.impots.gouv.fr/bofip/645-PGP.html/identifiant=BOI-CF-COM-10-10-30-20250903>
- CNIL, « Les durées de conservation des données » (page du 2 avril 2026) : <https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees> ; guide pratique : <https://www.cnil.fr/sites/cnil/files/atoms/files/guide_durees_de_conservation.pdf> (guide non lu)
- CNIL, « La CNIL publie une recommandation relative aux mesures de journalisation » (page du 18 novembre 2021 ; délibération n° 2021-122 du 14 octobre 2021) : <https://www.cnil.fr/fr/la-cnil-publie-une-recommandation-relative-aux-mesures-de-journalisation>
- RGPD, art. 5 §1 e), 17 §3, 32, 33 §5 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- Légifrance (Code de commerce art. L. 123-22 et L. 110-4 ; LPF art. L. 102 B ; Code civil art. 2224 ; Code du travail art. L. 3243-4) : **références non revérifiées en ligne le 2026-11-19**, le site ayant refusé l'accès automatisé (erreur 403). Les durées citées viennent des sources officielles secondaires ci-dessus.
