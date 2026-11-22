# Politique de conservation, de restitution et de suppression

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

État : cadre technique en place pour une partie. Des durées sont PROPOSÉES plus bas avec leur fondement (section « Durées proposées ») ; aucune n'est arrêtée, et elles sont à valider par un professionnel du droit et par un expert-comptable avant toute mise en service. Aucune durée n'est appliquée automatiquement à ce jour, et aucune purge n'existe hors celles décrites ci-dessous. La procédure de fin de contrat (section « Fin de contrat ») existe mais n'est pas activée : elle n'a été appliquée que sur des bases d'essai.

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

La table `politiques_conservation` permet de déclarer, par cabinet et par catégorie, une durée, son fondement et le caractère immuable. Aucun traitement ne l'applique ; la procédure de fin de contrat la lit seulement pour refuser de supprimer une catégorie qu'une déclaration protège. L'immuabilité est désactivée par défaut : une conservation irréversible n'est jamais appliquée sans durée ni responsable définis.

## Object Lock

Source : documentation OVHcloud, <https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-managing-object-lock> (page mise à jour le 5 novembre 2026, consultée le 2026-11-19).

- Deux modes de rétention, gouvernance et conformité, plus une conservation légale (« legal hold »).
- Le versionnement du bucket doit être activé.
- Le verrouillage se choisit À LA CRÉATION du bucket et ne peut pas être ajouté ensuite ; une fois activé, il est irréversible pour ce bucket.
- En mode conformité, ni le mode ni la durée ne peuvent être modifiés une fois appliqués à un objet.

Conséquence de conception : les buckets de production destinés aux éléments à rétention immuable doivent être créés avec le verrouillage dès l'origine, séparément du bucket courant. Le SeaweedFS local (4.54) accepte pourtant le verrouillage à la création du bucket, le versionnement, une rétention par objet (mode gouvernance) et refuse la suppression d'une version verrouillée (`AccessDenied`) : le comportement « refus propre, jamais de contournement » de la suppression d'objets en fin de contrat y est exercé réellement (D-099). Ce n'est PAS une validation du verrouillage d'OVHcloud (mode conformité, conservation légale, comportement du fournisseur : non essayés).

## Restitution

Export de restitution par dossier (habilitation de validation) : archive ZIP contenant les originaux non modifiés (relus et comparés à leur empreinte), les données structurées (pièces et leurs versions d'extraction, imports, révision, décisions, banque, rapprochements, règles du cabinet applicables, journal d'audit du dossier), les écritures normalisées en CSV, et un manifeste d'empreintes SHA-256. Les originaux écartés par l'antivirus ne sont pas restitués ; le manifeste les liste. L'export reste possible quand l'abonnement est suspendu ou résilié.

Restitution d'un cabinet entier (décision D-043, voir `couverture.md`) : réservée aux gestionnaires, limitée aux dossiers où le demandeur a le niveau « validation » (les autres sont listés et l'archive est marquée incomplète), archive construite en flux, téléchargeable par son seul demandeur, ni chiffrée ni signée.

Non couvert : restitution des sauvegardes et des journaux techniques ; format d'échange normalisé avec un autre logiciel.

## Durées paramétrables et simulations (D-099)

Les durées juridiques restent **externes** (avocat, DPO : `acces-externes.md`). Ce que le projet fournit : des MÉCANISMES paramétrables, des SIMULATIONS et des essais sur ressources jetables, sans aucune purge réelle.

- **Jeu de paramètres versionné** (`packages/db/src/durees-conservation.ts`, format `comtaple.durees-conservation/1`) : une règle par catégorie de la politique (durée en jours OU « jusqu'au » une date, point de départ, devenir à l'échéance : supprimer, pseudonymiser ou, pour le journal, sceller), le délai de grâce, la rétention des sauvegardes (durée et nombre minimal de jeux conservés), les délais de désactivation et de suppression des comptes. Fichier JSON de l'éditeur (`--durees=<fichier>`), validé contre la politique (`editeur.mjs durees-verifier`). Le devenir de chaque catégorie reste dans le code (`POLITIQUE_FIN_DE_CONTRAT`, gardée par un test) : un fichier de paramètres ne peut ni le changer ni omettre une catégorie.
- **Aucune valeur par défaut n'est présentée comme validée.** Sans fichier, le jeu est la PROPOSITION NON VALIDÉE du code (`editeur.mjs durees-defauts`), marquée comme telle dans son statut, sa version et tout affichage. **Toute exécution réelle de fin de contrat exige `--durees-validees=<référence de la validation>`** (huitième pré-condition, `durees_validees`) : sans elle, ou avec une valeur vide (« oui », « ok »…), elle est refusée. La référence, la version, le statut et l'empreinte du jeu sont inscrits au journal du cabinet (`fin_de_contrat.executee`) et au procès-verbal. **Ce contrôle est formel : il impose qu'une personne affirme la validation et que l'affirmation soit tracée ; il ne prouve pas qu'elle a eu lieu.** Un jeu dont le statut n'est pas « PROPOSITION NON VALIDÉE » doit porter sa validation (référence, date, auteur) et la référence fournie doit être la même.
- **Le délai effectif** avant exécution est le plus long du délai de grâce et des durées des catégories supprimées à l'exécution : un jeu qui allonge la durée d'une catégorie reporte l'exécution de toute la procédure (elle supprime tout en une transaction).
- **Simulation par cabinet, table par table** : `node scripts/editeur.mjs conservation-simuler <cabinetId> [--durees=…]` (lecture seule) liste, pour chaque table : devenir, nombre de lignes, action (supprimer, anonymiser puis supprimer, conserver puis supprimer ou sceller), point de départ, première et dernière échéance, état (échue, à échoir, non calculable). Le point de départ « clôture de l'exercice de l'éditeur » est approché par le 31 décembre de l'année de l'événement.

## Fin de contrat : suppression à la résiliation

La résiliation d'un abonnement ferme les dépôts à son échéance et ne supprime, par elle-même, aucune donnée. Une PROCÉDURE de fin de contrat existe depuis le 2026-11-19 (`packages/db/src/provisionnement.ts`, fonctions `inventaireFinDeContrat`, `finDeContrat`, `objetsFinDeContrat` ; migration `0038_fin_de_contrat.sql`). **Elle n'est pas activée** : aucun traitement ne la lance, l'API ne l'expose pas, et elle n'a jamais été appliquée à des données conservées. Les durées qu'elle cite sont les propositions de ce document, non arrêtées.

### Devenir de chaque catégorie

Politique versionnée (`POLITIQUE_FIN_DE_CONTRAT`, version `2026-11-20.3`), reprise dans chaque procès-verbal. Quatre devenirs : `supprimer`, `restituer_puis_supprimer` (présent dans l'archive de restitution exigée avant toute suppression), `anonymiser`, `conserver_jusqu_a` (durée PROPOSÉE, non arrêtée). Toute table portant `cabinet_id` appartient à une catégorie : un test échoue, et la procédure refuse de s'exécuter, si une table en est dépourvue.

| Catégorie | Tables | Devenir | Durée proposée et fondement (non arrêtés) |
|---|---|---|---|
| Comptes : appartenances, habilitations, invitations | `appartenances`, `habilitations_dossier`, `invitations` | supprimer | — |
| Dossiers | `entites`, `etablissements`, `exercices` | restituer puis supprimer | — |
| Pièces et fichiers | `fichiers`, `documents`, `receptions`, `pages_document`, `extractions`, `echanges_document`, `televersements`, `passages_recherche`, `factures`, `reanalyses_destinataire`, `reanalyses_destinataire_pieces` | restituer puis supprimer | Les objets du stockage suivent une étape séparée |
| Écritures importées | `campagnes_import`, `lots_import`, `lignes_ecriture` | restituer puis supprimer | — |
| Relevés, mouvements, rapprochements | `releves_bancaires`, `mouvements_bancaires`, `mouvements_lots`, `executions_rapprochement`, `rapprochements` | restituer puis supprimer | — |
| Contrôles et constats | `executions_controles`, `resultats_controles`, `constats`, `exports_revision` | restituer puis supprimer | — |
| Décisions et validations | `decisions`, `commentaires`, `ecritures_inventaire`, `confirmations_annexe`, `qualifications_resultat`, `historique_qualifications`, `saisies_tableaux`, `immobilisations`, `reprises_immobilisations`, `lignes_reprise_immobilisations`, `suivis_evolution`, `liens_tiers`, `liens_factures` | restituer puis supprimer | — |
| Missions et conseils | `missions`, `lettres_mission`, `travaux`, `baremes_temps`, `conseils`, `evenements_conseil` | restituer puis supprimer | — |
| Règles et paramètres, réglages de la tolérance de montant des tiers et factures (historique, motif, auteur), suggestions d'amélioration écartées | `regles_cabinet`, `parametres_cabinet`, `reglages_tiers_factures`, `suggestions_ecartees` | restituer puis supprimer | — |
| Messagerie et jetons | `connexions_mail`, `demandes_connexion_mail`, `pieces_mail_vues`, `pieces_a_qualifier`, `signalements_mail`, `messages_mail` | supprimer | Les jetons ne sont jamais restitués |
| Notifications et préférences ; abonnements aux notifications poussées et file de leurs envois (fonction désactivée par défaut) | `notifications`, `preferences_notification`, `abonnements_pousses`, `envois_pousses` | supprimer | Points d'accès et clés des appareils (chiffrés) jamais restitués |
| Assistant et propositions d'IA | `echanges_assistant`, `echanges_portefeuille`, `propositions_ia` | supprimer | — (les échanges de portefeuille ne sont pas dans l'archive de restitution du cabinet) |
| Traces de la passerelle d'IA (sans contenu) | `evenements_ia` | anonymiser (personne et dossier effacés) | 6 mois, mesures d'exploitation — valeur de travail |
| Abonnement et facturation | `abonnements`, `echeances_abonnement`, `evenements_facturation` | conserver | 10 ans — Code de commerce, art. L. 123-22 ; LPF, art. L. 102 B (documents de l'Éditeur) |
| Restitutions par dossier (registre) | `restitutions` | supprimer | — |
| Restitutions du cabinet (registre, empreinte) | `restitutions_cabinet` | conserver | 5 ans — prescription (Code civil, art. 2224 ; Code de commerce, art. L. 110-4) |
| Journal d'audit et anomalies consignées | `journal_audit`, `anomalies_journal` | conserver | 12 mois (traces d'accès) à 10 ans (actes métier) ; tant que le journal n'est pas scindé, la plus longue s'applique |
| Politiques de conservation déclarées | `politiques_conservation` | conserver | 5 ans — idem |
| Procès-verbaux de fin de contrat | `fins_de_contrat` | conserver | 5 ans — idem |

Hors de ces tables, et NON traités par la procédure : la ligne `cabinets` (conservée : partie au contrat) ; la table `utilisateurs`, commune à tous les cabinets (les comptes qui n'appartiennent plus à aucun cabinet sont seulement décomptés) ; les comptes du fournisseur d'identité ; les journaux techniques ; les sauvegardes.

### Pré-conditions, toutes vérifiées avant la moindre suppression

1. Toute table portant `cabinet_id` a un devenir, et aucune table conservée ne référence une table supprimée.
2. Le registre des procès-verbaux existe (migration 0038) et la fin de contrat n'a pas déjà été exécutée pour ce cabinet.
3. L'abonnement est au statut « résilié » et sa date de fin est dépassée d'un délai de grâce paramétrable (celui du jeu de paramètres : 90 jours dans la proposition non validée ; 30 au minimum).
4. Une restitution du cabinet est terminée, complète (aucun dossier écarté ni hors périmètre), son empreinte SHA-256 est enregistrée et sa génération consignée au journal, et elle a été demandée APRÈS la dernière modification des données (horodatages des tables restituées ; actes inscrits au journal, hors consultations, restitutions et résiliation).
5. Le journal d'audit se vérifie par la vérification STRICTE. S'il ne se vérifie pas, la procédure s'arrête et le dit ; elle ne répare ni ne consigne rien.
6. Aucune politique de conservation déclarée pour le cabinet (`politiques_conservation`) ne s'oppose à la suppression d'une catégorie : conservation immuable, durée encore en cours (comptée, faute de mieux, depuis sa déclaration), ou catégorie non reconnue.
7. Une confirmation nomme le cabinet : son identifiant ET son nom exact.
8. Les durées de conservation sont déclarées validées : `--durees-validees=<référence>` fournie (D-099, ci-dessus).

### Exécution

`node scripts/editeur.mjs fin-de-contrat <cabinetId> [--durees=<fichier>]` SIMULE : inventaire, pré-conditions et plan ordonné, dans une transaction en lecture seule — la base elle-même y refuse toute écriture. Avec `--nom="<nom exact>" --durees-validees="<référence>" --appliquer`, et si toutes les pré-conditions sont réunies, une seule transaction : anonymisation des traces d'IA ; suppression table par table, les tables qui en référencent d'autres d'abord (ordre calculé d'après les clés étrangères), chaque décompte étant comparé au plan ; inscription de la dernière ligne du journal ; nouvelle vérification stricte ; inscription du procès-verbal. Un échec ou une interruption à n'importe quelle étape annule tout.

**Journal d'audit.** Il est conservé, jamais réécrit ni supprimé, et reçoit une dernière ligne `fin_de_contrat.executee` chaînée comme les autres : il reste vérifiable, en base et hors base. Raisons : c'est la preuve des diligences du Cabinet et de l'exécution de la fin de contrat ; sa durée n'est pas arrêtée (12 mois à 10 ans selon les lignes, non scindées) ; et le supprimer supposerait de désactiver ses protections d'ajout seul, ce que rien ne distinguerait d'une altération. Sa fin de vie est conçue (section « Fin de vie du journal et des éléments conservés ») et simulée ; elle n'est pas exécutable.

**Procès-verbal.** Document JSON canonique (clés triées) : cabinet, date, rôle exécutant, politique et sa version, abonnement, restitution et son empreinte, décomptes avant/après par catégorie et par table, état du journal, objets restant à supprimer, limite des sauvegardes, réserves. Son empreinte SHA-256 se recalcule à partir du seul document. Il est écrit dans un fichier, à remettre au Cabinet, et inscrit au registre `fins_de_contrat` (ajout seul, sans aucun droit pour les rôles de l'application).

**Objets du stockage.** Étape séparée (`objetsFinDeContrat`) : clés sous les préfixes `cabinets/<cabinet>/` et `tmp/<cabinet>/`, simulation par défaut, exécution seulement après la base, refusée si une ligne d'un autre cabinet référence un de ces objets, consignée au journal. L'outil de l'éditeur n'en propose que la simulation sur le stockage des données (`fin-de-contrat-objets`). Sur un STOCKAGE D'ESSAI versionné (`supprimerObjetsFinDeContratEssai`, D-099), la suppression est exercée réellement : voir « Suppression d'objets sur un stockage d'essai ». Une clé référencée hors de ces préfixes n'est jamais supprimée : elle est décomptée.

**Sauvegardes.** Elles ne sont pas modifiables une à une : les données supprimées y subsistent jusqu'à leur rotation (30 à 90 jours proposés, politique de production non définie). La procédure ne les purge pas ; le procès-verbal le mentionne. Une restauration postérieure à une fin de contrat devrait la rejouer.

### Suppression d'objets sur un stockage d'essai (D-099)

`packages/db/src/objets-fin-de-contrat.ts` (`supprimerObjetsFinDeContratEssai`) et `packages/plateforme/src/stockage-essai.ts` (`StockageEssaiS3`). Elle ne s'exécute que contre un bucket S3 qui **se déclare d'essai** : nom `comtaple-essai-…`, déclaré par la variable dédiée `STOCKAGE_ESSAI_BUCKET_DECLARE` (même nom exactement), et **distinct du bucket des données** (`S3_BUCKET`). La vérification a lieu à la construction de l'objet et avant chaque opération ; sinon refus, avant tout appel au stockage. Aucun code ne supprime d'objet du bucket des données : `fin-de-contrat-objets --appliquer` sans stockage d'essai déclaré est refusé.

Ce que fait la fonction : refuse sans confirmation (identifiant et nom), sans procès-verbal au registre, sans référence de validation des durées, ou si une ligne d'un autre cabinet référence un objet visé ; liste les VERSIONS et marqueurs de suppression sous les préfixes du cabinet ; supprime version par version, **sans jamais demander le contournement de la gouvernance** — une version sous Object Lock reste en place et est rapportée « verrouillée » avec le mode et l'échéance (échec propre : exception `SuppressionObjetsIncomplete`, le reste est supprimé) ; ajoute une ligne par version à un rapport (JSON par ligne : clé, version, taille, résultat, date, passage) ; consigne chaque passage au journal du cabinet. Reprise : rejouée, elle liste ce qui reste et complète le même rapport ; idempotente (rien à supprimer = aucune action).

### Comptes du fournisseur d'identité et fiches d'utilisateurs (D-099)

- **Plan, à établir AVANT la fin de contrat** (`editeur.mjs comptes-fin-de-contrat <cabinetId> [--plan=<fichier>]`, lecture seule) : comptes dont la SEULE appartenance est ce cabinet (accès support compris), avec date de désactivation (fin de l'abonnement + délai de grâce + délai de désactivation) puis de suppression (+ délai de suppression après désactivation), et devenir de la fiche. Un compte qui a une autre appartenance n'est jamais listé pour fermeture. Après l'exécution, les appartenances n'existent plus : le plan enregistré sert de référence ; `editeur.mjs fiches-orphelines` liste les fiches sans appartenance.
- **Fiche** (`utilisateurs`, sans `cabinet_id`) : supprimée si plus rien ne la référence, PSEUDONYMISÉE sinon (nom, e-mail et sujet remplacés, identifiant conservé) — par exemple le demandeur d'une restitution, référencé par le registre conservé. L'exécution (`appliquerFichesOrphelinesEssai`) refuse toute base dont le nom n'est pas `comtaple_essai_…` ou qui est la base configurée.
- **Fournisseur d'identité** (`FournisseurIdentiteEssai`, Keycloak) : désactivation puis suppression des seuls comptes du plan, aux dates, **uniquement dans un royaume d'essai** `essai-fin-contrat-…` déclaré par `KEYCLOAK_ROYAUME_ESSAI_DECLARE`, distinct du royaume de l'application et de « master ». Un compte dont l'e-mail dans Keycloak diffère de celui du plan n'est pas touché. **Aucune exécution contre un royaume réel n'est écrite** : à faire à la main d'après le plan (ou à écrire après décision).
- Ordre d'une fin de contrat réelle : plan des comptes ; fin de contrat en base ; objets ; fournisseur d'identité ; fiches (après le fournisseur : la pseudonymisation change le sujet).

### Rotation des sauvegardes (D-099)

`packages/plateforme/src/rotation-sauvegardes.ts`, `node scripts/sauvegardes-rotation.mjs [--retention=<jours>] [--minimum=<jeux>] [--durees=<fichier>]` : SIMULATION par défaut (liste de ce qui serait conservé, retiré ou laissé à examiner). Les `jeuxMinimumConserves` jeux complets les plus récents sont toujours conservés ; un jeu interrompu n'est jamais retiré (« à examiner ») ; ni `objets/` (dépôt adressé par empreinte : son nettoyage n'est pas conçu) ni un fichier étranger n'est touché. L'exécution (`appliquerRotation`) n'existe que pour un répertoire d'essai portant un marqueur posé par le test, distinct du répertoire réel (ni le même, ni dedans, ni le contenant, liens symboliques résolus) ; l'outil en ligne de commande n'en propose aucune. Aucune sauvegarde existante n'a été retirée ; la simulation sur `var/sauvegardes` rend, avec la rétention proposée, « rien à retirer » (tout date de moins de 90 jours).

### Fin de vie du journal et des éléments conservés (conception D-099, exécution sur ressources d'essai D-100)

Conception écrite (D-099) ; **simulation** sur toute base (`editeur.mjs journal-fin-de-vie`, `simulerFinDeVieJournal`) ; **scellement** exécutable (il n'écrit que des fichiers) ; **destruction exercée sur base d'essai seulement** (section « Cycle complet » ci-dessous, D-100).

1. **Le journal n'est jamais réécrit ni purgé** par un traitement : sa chaîne d'empreintes rend toute altération détectable, et sa suppression exigerait de désactiver ses protections d'ajout seul, ce que rien ne distinguerait d'une altération.
2. **Échéance paramétrable** : règle `journal_audit` du jeu de paramètres (durée, point de départ « événement » = l'horodatage de chaque ligne ; proposée 3652 jours, la plus longue du double régime). À l'échéance, l'action « sceller » : vérification stricte, export final vérifiable hors base (`comtaple.journal-export/1`), ancre finale chaînée à la précédente, dépôt de l'export et de l'ancre HORS de portée de l'administrateur de la base **(externe : aucune destination indépendante n'existe)**, puis revue humaine documentée : prolonger, ou détruire le journal de ce cabinet par une procédure distincte, jamais automatique.
3. **Données personnelles** : elles ne doivent pas être dans les lignes (qu'on ne peut réécrire) mais dans les tables modifiables. Les lignes désignent des personnes par `acteur_id` (sans clé étrangère) : la pseudonymisation de la fiche `utilisateurs` rompt le lien sans toucher une ligne. **La simulation révèle des lignes qui contiennent une adresse de courriel** (par exemple l'invitation d'un membre) : elles subsistent telles quelles. Deux voies, à arbitrer avec le DPO : ne plus écrire d'adresse dans les détails du journal (changement de code futur, ne corrige pas l'existant), ou consigner que ces lignes se conservent jusqu'à l'échéance. Rien n'est décidé.
4. **Éléments conservés** (facturation, restitutions du cabinet, politiques déclarées, traces d'IA anonymisées, procès-verbaux) : règle par catégorie ; à l'échéance, « supprimer » : `detruireElementsConservesEssai` (D-100), avec simulation, rapport et reprise, sur base d'essai seulement. Les procès-verbaux portent le nom du cabinet : leur pseudonymisation n'est pas prévue (le nom d'un cabinet est une donnée de personne morale, parfois d'un exercice individuel : à arbitrer).
5. **Ancres** : l'ancre n'a de valeur que conservée hors de portée de qui administre la base. La simulation n'en dépose aucune.

### Ce qui est réellement exercé

| | État au 2026-11-20 |
|---|---|
| Inventaire, pré-conditions, plan (simulation) | Testés sur une base neuve isolée ; simulés en lecture seule sur la base locale (aucun cabinet n'y remplit les pré-conditions) |
| Durées paramétrables, référence de validation, simulation par table | Testées (10 essais unitaires, 10 sur base neuve) ; simulation lancée en lecture seule sur la base locale |
| Suppression en base, journal, procès-verbal | Exécutés uniquement sur des bases d'essai créées puis supprimées par les tests. **Jamais sur la base locale ni sur des données conservées.** |
| Suppression des objets | Exercée réellement contre un bucket S3 d'ESSAI créé par le test (versions, marqueurs, Object Lock gouvernance, reprise, idempotence, autres cabinets intacts, bucket des données inchangé). **Jamais contre le bucket des données.** |
| Comptes Keycloak | Exercés contre un royaume d'essai créé puis supprimé par le test ; le royaume de développement n'est que lu (nombre de comptes avant et après) |
| Fiches orphelines | Exercées sur base d'essai uniquement |
| Rotation des sauvegardes | Exercée sur un répertoire d'essai créé par le test ; simulation seule sur `var/sauvegardes` (rien n'a été retiré) |
| Fin de vie du journal | Simulation (toute base) ; scellement (export + ancre, fichiers seulement) ; destruction, sur décision humaine, **sur base d'essai uniquement** (D-100) |
| Éléments conservés à terme (traces d'IA, facturation, restitutions du cabinet, politiques), procès-verbal, ligne du cabinet | Exercés sur base d'essai avec échéances avancées par `aujourdhui`, interruption, reprise, idempotence, certificat de destruction (D-100). **Jamais sur la base locale** |
| Nettoyage du dépôt d'objets des sauvegardes (`objets/`) | Simulation sur `var/sauvegardes` (bloquée par la sauvegarde interrompue) ; exécution sur répertoire d'essai (D-100) |
| Cycle enchaîné à état persistant (dix étapes) | Exercé de bout en bout sur ressources d'essai réelles (base, bucket S3 versionné avec Object Lock, royaume Keycloak, répertoire de sauvegardes) : arrêt brutal, reprise, attente de chaque échéance (D-100). Aucun lanceur dans l'outil de l'éditeur |
| Volume réel | MESURÉ sur base jetable : 50 dossiers, 500 001 lignes d'écriture, 580 220 lignes au total pour le cabinet : transaction de 7,8 s (voir « Mesure de la transaction ») |
| Durées, délai de grâce | Paramétrables ; valeurs proposées, **non validées** ; validation juridique externe |

### Mesure de la transaction de fin de contrat (D-099)

Essai `packages/db/src/mesure-fin-de-contrat.itest.ts` (activé par `MESURE_FIN_DE_CONTRAT=1`), base jetable `comtaple_essai_mesure_…`, cabinet synthétique : 50 dossiers, **500 001 lignes d'écriture**, 5 001 fichiers, 5 001 documents, 5 001 extractions, 10 001 pages, 5 001 réceptions, 20 001 mouvements bancaires, 5 001 décisions, 20 002 lignes de journal, soit **580 220 lignes** dans les tables du cabinet (base de 254 Mo). Résultats du 2026-11-20 (`var/mesures/fin-de-contrat-2026-11-20.json`), VM Docker 4 cœurs / 5,8 Gio, PostgreSQL 18 aux réglages par défaut (`shared_buffers` 160 Mo, `work_mem` 4 Mo) :

| Mesure | Valeur |
|---|---|
| Simulation (lecture seule) | 171 ms (62 ms pour la simulation de conservation) |
| **Transaction d'exécution réelle** | **7 845 ms** pour 560 210 lignes supprimées (≈ 71 000 lignes/s), dont 5 549 ms pour `lignes_ecriture`, 764 ms pour `documents`, 752 ms pour `entites` ; 20 012 lignes restent (journal, facturation, registres conservés) |
| Verrous tenus par la transaction (pic) | 584 |
| Journal écrit (WAL) | 177 152 352 octets (≈ 169 Mio) ; aucun fichier temporaire |
| Mémoire du processus serveur de la transaction | pic résident 194 Mo, 172 Mo en fin |
| Mémoire du processus Node de l'outil | 70 Mo avant, pic 84 Mo, tas 33 Mo : elle ne croît pas avec le volume (les suppressions se font côté base) |
| Sondes de concurrence lancées au début de la transaction | lecture du même cabinet : 24 ms (non bloquée) ; écriture sur un AUTRE cabinet : 6 ms ; insertion au journal d'un AUTRE cabinet : 7 ms ; **écriture sur la ligne du cabinet visé : 7 693 ms (bloquée jusqu'à la fin)** |
| Vérification stricte du journal après coup | intègre ; 57 ms pour 20 003 lignes |

**Limites de cette mesure** : une seule exécution, sur un poste de développement et une VM, aucune autre charge ; données synthétiques uniformes (50 dossiers identiques, pas de pièces volumineuses, pas de lignes très larges) ; les objets du stockage ne sont pas comptés (étape séparée) ; les index et tables supprimés laissent des lignes mortes que seul l'aspirateur automatique récupérera (non mesuré) ; la durée d'un cabinet de plusieurs millions de lignes ou d'une base managée n'est pas extrapolable. **Constat de conception, établi par un essai** : une ligne ajoutée au journal du cabinet par une AUTRE session pendant l'exécution (le journal n'est pas verrouillé par la transaction) fait tout annuler — le contrôle des décomptes après suppression échoue et la transaction est annulée sans effet ; la reprise exige alors une nouvelle restitution si l'action écrite modifie des données. En exploitation : n'exécuter que sur un cabinet dont l'abonnement est résilié depuis le délai de grâce, donc sans activité (c'est déjà une pré-condition).

## Cycle complet de conservation et de fin de contrat (D-100, lot P2)

Cette section rassemble l'état réel du cycle. Tout ce qui est « exercé » l'a été sur des ressources créées puis détruites par les tests ; **rien n'est exécutable contre les données existantes**, et rien n'est activé : chaque exécution exige une ressource déclarée d'essai, la référence de validation des durées et la confirmation du cabinet. Les durées restent celles de la proposition non validée, ou des durées d'essai de quelques jours dans les tests.

### État des lieux (mécanisme, existence, preuve, lacune)

| Mécanisme | Existe | Prouvé | Lacune constatée au départ, et suite |
|---|---|---|---|
| Durées et délai de grâce paramétrables, référence de validation | Oui (D-099) | 10 + 10 essais | Aucune (la validation reste formelle) |
| Simulation par cabinet, table par table | Oui (D-099) | Oui | Rendu en tableaux seulement : rapport en français ajouté (`rapport-lisible.ts`, `conservation-rapport`) |
| Échéancier tous cabinets | Non | — | **Ajouté** (`echeancier-conservation.ts`, `editeur.mjs echeancier`), lecture seule, lancé sur la base réelle |
| Fin de contrat en base (huit pré-conditions, transaction, procès-verbal) | Oui (D-078, D-099) | 32 essais + mesure 580 220 lignes | Aucune ; exécutée dans le cycle |
| Suppression des objets du stockage | Sur stockage d'essai (D-099) | 6 essais, Object Lock gouvernance | Aucune enchaînement ni attente du verrou dans un cycle : **ajoutés** |
| Comptes du fournisseur d'identité | Sur royaume d'essai (D-099) | 2 essais | Plan à enregistrer à la main avant la fin de contrat : **conservé dans l'état du cycle** ; fiches traitées globalement : **filtre `seulement`** |
| Rotation des sauvegardes | Sur répertoire d'essai (D-099) | Oui | Aucun constat qu'une sauvegarde ne contient plus le cabinet : **`jeuxContenantCabinet`** |
| Dépôt d'objets des sauvegardes (`objets/`) | Non conçu (D-099) | — | **Ajouté** : plan, exécution d'essai, blocage si sauvegarde interrompue ; les pièces d'un cabinet résilié restaient sinon indéfiniment |
| Destruction à terme (traces d'IA, facturation, restitutions du cabinet, politiques) | Non | — | **Ajoutée** (`destruction-terme.ts`) |
| Journal : simulation | Oui (D-099) | Oui | — |
| Journal : scellement (export, ancre), vérification hors base | Format et vérification (ancre-journal) ; pas de scellement de fin de vie | Vérification hors base : tests existants | **Scellement exécutable ajouté** (`journal-fin-de-vie.ts`) |
| Journal : destruction | Non | — | **Ajoutée**, base d'essai seulement, décision humaine obligatoire |
| Procès-verbal et ligne du cabinet à terme, certificat | Non | — | **Ajoutés** (`cloturerCabinetEssai`) |
| Enchaînement, état, reprise, attente d'échéance | Non (étapes séparées) | — | **Ajoutés** (`cycle-fin-de-vie.ts`) |
| Exécution réelle (base locale, bucket des données, royaume réel, sauvegardes réelles) | Non, volontairement | — | **Reste non écrite** : durées non validées, décision sur les protections d'ajout seul |

### Destruction à terme des éléments conservés

`node scripts/editeur.mjs destruction-terme <cabinetId> [--durees=…] [--aujourdhui=AAAA-MM-JJ]` SIMULE (lecture seule) ; l'exécution (`detruireElementsConservesEssai`) n'existe que pour une base d'essai. Catégories, dans l'ordre : traces d'IA anonymisées, abonnement et facturation, restitutions du cabinet, politiques déclarées ; puis, par leur propre procédure, le journal, puis le procès-verbal et la ligne du cabinet. L'échéance est calculée par LIGNE selon la règle de la catégorie. Une transaction par catégorie, une ligne `conservation.destruction_terme` au journal, un rapport JSON par table et par passage. Une ligne parente n'est jamais détruite tant qu'une ligne enfant non échue la référence.

### Journal : scellement, décision humaine, destruction

1. `editeur.mjs journal-sceller <cabinetId> --sortie=<dossier>` : vérification stricte (refus en cas de rupture), export JSONL et ancre chaînée, manifeste ; ne modifie pas la base. `journal-verifier-scellement` revérifie sans base. **Une ancre déposée sur le même poste ne prouve rien contre un administrateur** : le dépôt hors de portée reste externe.
2. Destruction (`detruireJournalEssai`, base d'essai) : décision humaine documentée obligatoire, journal entier échu, scellement vérifié hors base et encore exact. Toute écriture au journal après le scellement le périme : il faut resceller (le cycle le fait).
3. **L'export scellé est la seule trace qui reste du journal détruit et contient les adresses de courriel du journal.** Sa conservation, son lieu et sa destruction sont une décision du DPO, non prise.
4. Limite d'exploitation : la destruction neutralise les déclencheurs d'ajout seul sous verrou exclusif de `journal_audit` ; sur une base partagée elle suspendrait l'écriture du journal de tous les cabinets. D'où l'absence d'exécution réelle (décision à prendre : fonction dédiée à privilèges bornés, fenêtre de maintenance ou journal scindé).

### Clôture et certificat de destruction

`cloturerCabinetEssai` : procès-verbal échu, toutes les autres tables du cabinet vides, certificat (`comtaple.certificat-destruction/1`, empreinte recalculable) écrit hors base AVANT la suppression du procès-verbal et de la ligne du cabinet ; reprise après interruption sans réécrire le certificat. Le certificat contient le nom du cabinet (à remettre à lui) ; il ne vaut pas validation juridique des durées appliquées.

### Sauvegardes : rotation, dépôt d'objets, constat

`node scripts/sauvegardes-rotation.mjs` rapporte aussi le dépôt d'objets (simulation). Sur répertoire d'essai : rotation, puis nettoyage des objets que plus aucun manifeste ne référence (bloqué par prudence si un manifeste est illisible ou si une sauvegarde est interrompue : ce qui est le cas de `var/sauvegardes` aujourd'hui, à examiner par une personne), puis constat `jeuxContenantCabinet` : l'étape « sauvegardes » du cycle reste en attente tant qu'un jeu postérieur à la fin de contrat, aux objets et aux comptes ne remplace pas ceux qui contiennent le cabinet. Les `jeuxMinimumConserves` plus récents sont toujours conservés : un cabinet résilié peut donc subsister dans un jeu protégé par ce minimum jusqu'à la sauvegarde suivante.

### Cycle à état persistant

`avancerCycle` (`packages/plateforme/src/cycle-fin-de-vie.ts`, essais seulement) : plan des comptes, base, objets, identité, fiches, sauvegardes, éléments conservés, scellement du journal, destruction du journal (décision humaine), clôture. État écrit atomiquement (`cycle-<cabinet>.json`), rapport de cycle lisible (`rendreCycleLisible`). Rappelé à une date plus tardive, le cycle reprend à l'étape en attente ; une étape interrompue brutalement est rejouée ; une étape en échec s'arrête avec sa raison, sans rien masquer.

## Notifications internes : archivage et rétention

Les notifications se lisent dans l'application et ne portent que des identifiants et quelques valeurs non sensibles ; leur texte est composé à la lecture. Leur contenu ne sort jamais de l'application. Les notifications poussées (désactivées par défaut, `exploitation.md` § 13) n'adressent aux appareils abonnés qu'une phrase générique ; ce qu'elles conservent : un abonnement par appareil (empreinte du point d'accès, service, navigateur et système, dates ; point d'accès et clés chiffrés), gardé jusqu'à son retrait par la personne ou par le service de notification — **aucune durée maximale n'est définie pour un abonnement inactif : à décider** — et une file d'envois (type et décompte) purgée 7 jours après traitement.

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

1. La table `politiques_conservation` devrait porter ces catégories, avec une durée, un point de départ et un fondement par cabinet ; seule la procédure de fin de contrat la lit, pour refuser une suppression.
2. Le point de départ « clôture de l'exercice » suppose de rattacher chaque pièce à un exercice : c'est le cas des écritures et des lots, pas de toutes les pièces.
3. Il manque : l'archivage intermédiaire (retrait des travaux courants avec accès restreint) ; l'exécution RÉELLE (base locale, bucket des données, royaume réel, sauvegardes réelles) de la rotation, de la destruction à terme et de la fin de vie du journal, qui suppose une décision de conception sur les protections d'ajout seul (voir « Cycle complet », limites) et les durées validées. La suppression à la résiliation dispose d'une procédure, non activée (section « Fin de contrat ») ; la rotation, les comptes, la destruction à terme, le journal et la clôture ont des mécanismes paramétrables, des simulations et un cycle exercé sur ressources d'essai, sans exécution réelle.
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
