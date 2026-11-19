# Rapport de tests

Dernière exécution complète : 2026-11-19 (douzième passe : TOUTES les suites ci-dessous marquées « relancée » ont été rejouées après la relecture complète du cahier des charges — invitations, agrégation bancaire, veille par taille, recette, intégration de l'IA en mode sans IA, états fiscaux).

Tous les jeux de données sont SYNTHÉTIQUES. Aucun service externe réel (Google, Microsoft, OVHcloud), aucun appareil réel, aucune donnée de cabinet.

## Résultats

| Suite | Commande | Résultat | Contre quoi |
|---|---|---|---|
| Moteur métier | `pnpm --filter @comtaple/core run test` | 532 réussis / 532 (relancée ; dont 56 sur la liasse, l'annexe et les propositions d'écritures d'inventaire, et les relevés d'agrégation) | Mémoire, jeux synthétiques |
| Connecteurs mail (bibliothèque) | `pnpm --filter @comtaple/mail run test` | 57 réussis / 57 (relancée) | Simulateur local des API Gmail et Graph |
| Paquet IA (passerelle, tâches, assistant, recherche, évaluation) | `pnpm --filter @comtaple/ia run test` | 92 réussis / 92 (relancée) | SIMULATEUR du paquet et HTTP injecté : aucun modèle réel, aucun appel sortant. Les 26 cas du corpus d'évaluation rejouent des réponses écrites à la main : test de non-régression du code, pas mesure d'un modèle |
| Application web (logique) | `pnpm --filter @comtaple/web run test` | 141 réussis / 141 (relancée) | Mémoire |
| Isolation et audit | `pnpm --filter @comtaple/db run test:integration` | 52 réussis / 52 (relancée ; 13 sur la base locale existante, 39 sur une base neuve isolée où les 37 migrations sont rejouées) | PostgreSQL réel |
| Surveillance des sources, rattrapage, limite de volume, passages de recherche | `pnpm --filter @comtaple/worker run test:integration` | 15 réussis / 15 (relancée ; dont 4 sur l'indexation en passages) | PostgreSQL réel, lecture HTTP injectée |
| Parcours de bout en bout | `pnpm --filter @comtaple/api run test:integration` | 196 réussis / 196 (relancée en entier, 18 fichiers ; dont 8 sur les invitations avec de vrais comptes Keycloak créés puis supprimés, 8 sur les états fiscaux, 24 sur l'assistant, 5 sur l'agrégation bancaire) | Pile réelle locale ; messagerie et agrégation bancaire contre leurs SIMULATEURS ; assistant : sans IA sur la pile réelle, et chemin « modèle » contre le SIMULATEUR avec la base réelle |
| Navigateur, API simulée | `pnpm --filter @comtaple/web run test:e2e` | 117 réussis / 117 (relancée) | Vrai Keycloak ; API remplacée par un simulateur de test ; Chromium ordinateur et émulation Pixel 7 |
| Navigateur, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.reel.config.ts` | 34 réussis / 34 (relancée : 33 en une exécution après correction d'un parcours rendu faux par la pagination des dossiers, puis le parcours des états fiscaux ajouté et exécuté seul) | Tout réel en local, Chromium ordinateur et émulation Pixel 7 |
| Service OCR | tests pytest dans l'image `comtaple-ocr:tests` | 48 réussis / 48 (exécution du développeur du service, non relancée lors des dernières passes) | Conteneur sans réseau |
| Navigateur WebKit, pile réelle | `pnpm --filter @comtaple/web exec playwright test -c playwright.navigateurs.config.ts --project=webkit` | 34 réussis / 34 (relancée : 33 en une exécution, puis le parcours des états fiscaux exécuté seul) | Mêmes parcours, moteur WebKit ; ce n'est pas Safari |
| Navigateur Firefox, pile réelle | idem `--project=firefox` | Non exécutable sur le poste (D-059) ; exécuté par l'intégration continue seulement (voir plus bas) | — |
| Plateforme : chiffrement de sauvegardes, jeux de sauvegarde, fabrique de la passerelle IA | `pnpm --filter @comtaple/plateforme run test` | 23 réussis / 23 (relancée) | Fichiers temporaires |
| Restauration depuis des copies chiffrées, sur un JEU cohérent | `scripts/sauvegarder.sh && scripts/essai-restauration-chiffree.sh` | **Restauration fidèle, contrôle d'intégrité du journal EN ÉCHEC** (code 3, comme en clair). Capture : Keycloak figé 144 ms, instantané de la base pris pendant le gel. Jeu chiffré : base, manifeste, export Keycloak, descripteur et 1 939 objets (8,0 Go) en 187 s ; déchiffré en 244 s et conforme à son descripteur ; base, manifeste et export identiques aux originaux ; base restaurée : 779 119 lignes d'écriture, 5 comptes sur 5 présents dans l'export Keycloak du jeu ; stockage rechargé et vérifié en 5 tranches : 1 844 objets référencés tous conformes ; Keycloak restauré : 16 contrôles conformes ; aucun service redémarré | Clé éphémère détruite ; dossiers temporaires ; PostgreSQL, stockage (une instance neuve par tranche) et Keycloak d'essai séparés. Sauvegardes d'origine inchangées (1 979 fichiers, aucun chiffré) |
| Sauvegarde et restauration : base et stockage objet | `scripts/sauvegarder.sh && scripts/essai-restauration.sh` | **Restauration fidèle, contrôle d'intégrité du journal EN ÉCHEC** (code de sortie 3). Base : restaurée en 10 s dans un PostgreSQL d'essai séparé, 460 344 lignes d'écriture, 114 politiques RLS, journal identique à l'origine. Stockage objet : 1 613 objets (4,4 Go) rechargés en 82 s dans une instance isolée, 1 514 objets référencés par la base restaurée tous relus et conformes. Aucun service de l'application n'a redémarré. La vérification stricte désigne la ligne 7603 du cabinet Alpha fictif (état historique dégradé, D-038) : l'essai ne sortira « réussi » que sur une base au journal intègre | Instances d'essai séparées (PostgreSQL et stockage), ressources plafonnées, détruites après l'essai |
| Sauvegarde et restauration : Keycloak | `scripts/essai-restauration-keycloak.sh` | Réussi : 16 contrôles conformes (comptes, « sub », connexions, refus d'un mauvais mot de passe, clients, secret, rôles) ; Keycloak local figé 0,3 s pour la copie, sans arrêt ni redémarrage | Instance Keycloak d'essai séparée, détruite après l'essai |
| Images de conteneurs | `docker build --target api\|worker\|web` puis démarrage | Trois images construites et démarrées | Réseau des services locaux ; lecture seule, sans capacités, utilisateur non privilégié |
| Infrastructure | `tofu validate` dans `infra/opentofu` ; `docker compose config` de la composition de production ; `scripts/essai-royaume-production.sh` ; pile de supervision en local | Valides ; royaume de production : 26 contrôles conformes ; supervision : cibles collectées, alerte déclenchée sur une cible absente (exécutés une fois le 2026-11-19, pile arrêtée ensuite) | Schéma du fournisseur et conteneurs éphémères locaux ; RIEN n'a été planifié ni appliqué chez l'hébergeur |

Typage : réussi pour tous les paquets. Les 37 migrations sont rejouées depuis une base vide à chaque exécution de la suite « Isolation et audit » (base neuve isolée), avec vérification que RLS est activé et forcé sur toute table portant `cabinet_id`.

Non relancés lors de cette passe (résultats des passes précédentes) : images de conteneurs applicatives, essais de sauvegarde et de restauration, mesures de mémoire. Les tests du service OCR ont été relancés le même jour après la correction oneDNN (48 / 48).

Recette par lecture des écrans (D-067) : tous les écrans visités sur la pile réelle par profil (administratrice, réviseur, collaboratrice, client), en bureau et en émulation mobile de 412 px ; aucun débordement horizontal, aucune erreur de console ; six écarts d'usage corrigés. Ce n'est pas un essai par des utilisateurs de cabinet.

Intégration continue GitHub : six exécutions le 2026-11-19 ; les cinq premières en échec, la sixième (run 44560095560, commit af548a9) ENTIÈREMENT RÉUSSIE : construction, typage, tests unitaires, services, tests de base, worker, parcours API, navigateur simulé, Chromium et WebKit sur pile réelle, validation OpenTofu. Causes des échecs établies et corrigées (D-063) : OCR inutilisable sur x86_64 (oneDNN), test du worker dépendant des données locales ; la cause du tout premier échec (run 44509674342) reste non établie. Les nombres de tests exécutés en CI ne sont pas relevés (journaux inaccessibles sans compte) : seul le succès des étapes est constaté. Firefox, exécuté par la CI seulement : 31 parcours sur 32 à la première exécution (run 44565575352), un défaut d'affichage corrigé (D-063), puis étape réussie au run 44571948858 (commit c58ecbe), dernière exécution complète, entièrement réussie. Non exécuté ; aucune analyse statique de style ; aucun test de charge ; aucun test d'intrusion ; aucune analyse de vulnérabilités des dépendances ou des images.

## Ce que couvrent les parcours de bout en bout (pile réelle)

**Authentification et cloisonnement** — jeton absent ou falsifié refusé ; un déposant ne voit que ses dossiers habilités ; une administratrice voit l'existence d'un dossier sans y accéder ; un autre cabinet ne peut ni lire ni déposer, même en forçant l'en-tête de cabinet ; journal d'audit réservé aux gestionnaires, chaîne intacte, paginé.

**Dépôt et pièce** — « reçu » seulement après vérification serveur ; extraction par couche texte ; image lue par l'OCR local ; doublon binaire entre canaux ; signalement ; correction versionnée ; validation réservée au réviseur ; contenu servi sous contrôle d'accès ; nom de fichier à caractère nul refusé.

**Coupure réseau** — reprise au décalage confirmé ; décalage faux refusé ; morceau et clôture rejoués sans effet ; empreinte différente refusée ; abandon explicite.

**Fichiers hostiles** — texte d'injection sans effet ; fichier EICAR en quarantaine ; type non pris en charge renvoyé au déposant ; requête de recherche hostile traitée comme une donnée.

**Versions d'une pièce** — nouvelle version déposée, original conservé et consultable, validation de l'ancienne version invalidée explicitement et tracée, fichier identique refusé sans remplacement, déposant limité à ses pièces non validées, liste filtrable sur les versions courantes et recherche par nom (jokers pris littéralement).

**Annulation et campagnes d'import** — annulation motivée par un réviseur, lot précédent réactivé, rétablissement, annulation pendant le traitement sans ligne conservée, reprise d'un import en échec, campagne sur plusieurs dossiers avec échec isolé, décompte en dossiers distincts, dossiers hors habilitation comptés sans être révélés, nom de l'auteur d'une annulation.

**Journal d'audit, sur base neuve isolée (non-régression)** — 240 écritures simultanées par deux rôles sur deux cabinets sans irrégularité ni prédécesseur déclaré deux fois ; modification, suppression, troncature refusées aux rôles applicatifs ; numéro, empreinte, prédécesseur et horodatage fournis par l'appelant ignorés ; écriture dans le journal d'un autre cabinet refusée ; avec les droits du propriétaire : contenu modifié, empreinte recalculée, ligne supprimée, début tronqué, prédécesseur inexistant, vidé ou emprunté à un autre cabinet — tous désignés par la vérification stricte et non consignables ; une consignation ne change jamais le résultat strict et ne masque pas une altération dans ou après sa plage ; lecture du journal réservée aux gestionnaires dans la base, écriture d'un non-gestionnaire correctement enchaînée.

**Ancres du journal, sur base neuve isolée** — le calcul hors base donne les mêmes empreintes que PostgreSQL sur un journal réel ; une rupture est désignée à la même ligne en base et hors base ; ancres chaînées vérifiées ; fin du journal entièrement réécrite avec empreintes recalculées (dans l'export, puis dans la base elle-même par son propriétaire) : invisible pour la chaîne et pour la vérification stricte, révélée par l'ancre ; lignes supprimées ou retirées, ancre modifiée, manquante ou d'un autre cabinet ; aucune ancre établie sur un journal amputé.

**Journal d'audit, sur la base locale existante (état historique dégradé)** — aucune conclusion d'intégrité : seulement l'absence de nouvelle irrégularité sur les lignes écrites pendant le test, et la cohérence entre l'API et la vérification stricte (rupture affichée, diagnostic à part).

**Restitution d'un cabinet (cabinet neuf créé pour le test)** — réservée aux gestionnaires ; périmètre annoncé puis figé selon les habilitations du demandeur ; dossier hors habilitation absent de toutes les tables, des écritures et des originaux ; manifeste complet et exact ; aucun secret ; téléchargement refusé à un autre gestionnaire, à un collaborateur et à un autre cabinet ; vérification hors application, archive altérée ou tronquée rejetée ; restitution complète après habilitation journalisée, avec un journal d'audit dont les lignes restituées s'enchaînent.

**Pagination (cabinet neuf créé pour le test)** — 57 règles et plus de 200 propositions de rapprochement parcourues page par page sans doublon ni oubli, ordre stable, décomptes sur l'ensemble, filtres, page au-delà de la fin, paramètres invalides refusés, ancienne forme conservée, une décision ne déplace aucune proposition d'une page à l'autre, cloisonnement inchangé.

**Correspondance des comptes de banque (cabinet neuf créé pour le test)** — deux comptes 512 et deux comptes bancaires : association indéterminée et TRE-003 « non réalisé » ; IBAN jamais renvoyé ; déposant, autre cabinet, référence inventée, compte non bancaire, doublons refusés ; proposition sans effet ; approbation refusée à l'auteure, au réviseur, et sans mesure d'impact ; impact mesuré sur les vrais relevés (non réalisé → réalisé) ; correspondance en vigueur après approbation, contrôle réalisé ; modification par nouvelle proposition, l'ancienne restant en vigueur.

**Notifications internes (cabinet neuf créé pour le test)** — personne n'en a au départ ; règle proposée → gestionnaires seulement ; décision → auteure seulement ; complément demandé → déposant, sans recopie du message ; réponse → demandeuse ; archive prête → demandeur ; chacun ne marque que les siennes ; décompte, filtre, pagination ; habilitation retirée → plus rien du dossier. Au niveau de la base (base neuve) : écriture directe refusée, membre d'un autre cabinet ignoré, dossier étranger refusé, seule la date de lecture modifiable.

**Original non conforme (cabinet neuf, objet de test altéré dans le stockage puis rétabli)** — non restitué et listé avec le même motif par la restitution du dossier et par celle du cabinet ; les autres originaux restitués ; archive conforme à son manifeste.

**Notifications d'import, de constat, préférences** — import terminé ou en échec : la personne qui l'a lancé, et elle seule ; constat affecté : la personne désignée, jamais celle qui affecte ; famille désactivée : plus de notification pour cette personne seulement, les autres familles et les autres personnes inchangées, réactivation effective. Au niveau de la base (base neuve) : ni annulation ni rétablissement ne notifient, les imports d'une campagne non plus, un changement de statut hors contexte ne fait rien échouer, les préférences d'autrui sont illisibles et non modifiables.

**Regroupement, archivage et rétention des notifications** — groupes par nature et par dossier couvrant exactement la liste ; un groupe lu, archivé puis désarchivé d'un geste ; l'archivage sort de la liste et du décompte sans supprimer ; identifiants d'autrui ignorés ; aucune route de suppression. Rétention, sur base neuve temporaire uniquement : simulation sans effet, application qui archive les lues anciennes et supprime les archivées anciennes, non lues jamais touchées, pas d'archivage puis suppression dans la même exécution, durées bornées, exécution interdite aux rôles applicatifs.

**Jeux de sauvegarde et reprises (copies temporaires)** — jeu complet conforme ; sauvegarde interrompue, fichier manquant, tronqué, altéré ou emprunté à un autre jeu : refusés en nommant le fichier ; écriture chiffrée interrompue : rien sous le nom définitif, reprise aboutie ; déchiffrement refusé : aucun fichier de sortie. Sur les sauvegardes réelles : le jeu réellement interrompu est refusé par le chiffrement et par l'essai de restauration.

**Limite de volume du worker** — au-delà de la limite, les 19 contrôles sont « non réalisés » avec leur motif, sans constat ni plantage ; à la limite et par défaut, ils sont réalisés ; rapprochement hors limite en échec avec son motif.

**Comptabilité** — import FEC en flux et idempotent ; anomalies injectées détectées ; revue des constats ; dossier de révision ; nouvelle version rendant les travaux « à revoir » ; faux FEC rejeté ; contrôles fiscaux non réalisés hors métropole ; cohérence entre deux exercices importés.

**Banque** — relevé camt.053 cadré ; réimport sans doublon ; CSV ambigu : aperçu des premières lignes puis profil confirmé ; faux relevé rejeté ; rapprochement vérifié arithmétiquement de façon indépendante ; mouvements sans contrepartie jamais appariés ; validation et rejet par le réviseur ; obsolescence après nouveau relevé.

**Administration et abonnement** — dossier créé avec territoire explicite ; habilitations plafonnées et journalisées ; membres ; rôle et désactivation avec garde-fous ; essai, échéance, virement rapproché par l'éditeur, changement d'offre, suspension, essai expiré, résiliation ; aucune écriture de tarif ni de paiement possible avec le rôle applicatif.

**Règles, états, inventaire** — règle proposée, impact mesuré, approuvée par une autre personne, appliquée et tracée, retirée ; balance, projets d'états, indicateurs tracés et non calculables motivés ; écriture d'inventaire équilibrée, approuvée par un tiers, balance ajustée, export, « à revoir » après changement des données.

**Missions, conseils, veille, recherche, restitution** — lettre validée, travail hors périmètre, projet d'avenant avec estimation sur base nommée ; rentabilité par mission (honoraires saisis, temps observés, coût horaire saisi, « non calculable » motivé sinon) ; affectation explicite d'un travail à une mission, écartée de la rentabilité des autres, retirée, journalisée ; pièces du dossier jointes à un conseil, une lettre, une écriture d'inventaire ; conseil validé puis autorisé puis faits consignés ; évolution qualifiée, applicabilité en trois états, suivi par cabinet ; recherche citant ses sources ; archive de restitution rouverte et vérifiée fichier par fichier contre son manifeste.

**Messagerie (contre simulateur)** — réception, pièce jointe, analyse ; doublon entre mail et téléversement ; notification répétée, falsifiée, manquée ; jeton révoqué ; cloisonnement ; file de qualification ; facture derrière un lien signalée sans requête vers le lien.

## Ce que couvrent les parcours navigateur sur la pile réelle

Dépôt depuis le téléphone (émulation) jusqu'aux champs extraits ; validation par le réviseur ; révision et catalogue ; cloisonnement dans l'interface ; messagerie « non connectée » ; création d'un dossier, habilitations et exercice par l'interface ; import d'un FEC et d'un relevé, cadrage, rapprochement, décisions ; ouverture d'un constat ; analyse (balance, états, indicateur tracé) ; abonnement ; règle de cabinet de la proposition à l'effet ; écriture d'inventaire ; lettre, travail, avenant ; conseil jusqu'à l'envoi consigné ; veille et sources ; recherche avec surlignage ; restitution téléchargée ; indicateurs du cabinet ; nouvelle version d'une pièce ; aperçu d'un CSV bancaire et confirmation du profil ; pièces jointes à un conseil et à une écriture d'inventaire ; annulation motivée puis rétablissement d'un import ; campagne d'import sur deux dossiers dont un fichier illisible ; rentabilité avec marge « non calculable » sans coût horaire.

Vérifié contre le simulateur d'API seulement : service fermé et actions d'abonnement, changement de rôle et désactivation dans l'interface, CSV à confirmer, cadrages « écart » et « non vérifiable », obsolescence d'un rapprochement, les trois états d'applicabilité de la veille, compte multi-cabinets, connexion et configuration d'une boîte mail, retour OAuth.

## Mesures relevées

| Mesure | Valeur | Conditions |
|---|---|---|
| Analyse d'un FEC de 105 869 lignes (14,1 Mo), en flux | 0,46 à 0,49 s, croissance du tas ≤ 0,17 Mo | Moteur seul, machine au repos. Jusqu'à 3,4 s observés machine chargée |
| OCR d'une page A4 à 200 ppp | 3,3 à 4,5 s | Conteneur limité à 2 Go, 2 fils d'exécution |
| OCR d'un PDF de 30 pages | 127 s (4,2 s par page) | Idem |
| Mémoire du service OCR | 260 Mio au repos, pic à 1 459 Mio | Idem |
| Rapprochement de 8 800 × 8 800 éléments | 81 ms au cas nominal, environ 1 s en données dégradées | Moteur seul |
| Campagne d'import sur 200 dossiers (`scripts/mesure-campagne.mjs`) | 192 imports réussis, 8 échecs (les 8 fichiers volontairement illisibles), aucun échec propagé ; 76 635 lignes importées et contrôlées ; 13,4 s de dépôt séquentiel, 1,3 s de plus pour la fin des imports, 14,8 s du premier dépôt à la fin des contrôles | Fichiers de 150 écritures (≈ 54 Ko), un seul utilisateur, worker à 2 traitements simultanés, poste local au repos |
| Annulation d'un import en cours | Fichier de 291 567 lignes interrompu pendant le traitement, aucune ligne conservée, lot actif inchangé | Parcours de bout en bout |
| Restitution du cabinet de démonstration (`scripts/mesure-restitution-cabinet.mjs`) | 235 dossiers inclus et 114 écartés (habilitations de la demandeuse), 844 originaux (719 Mo), 311 032 lignes d'écriture : archive de 359 Mo générée en 18 s, téléchargée en 6 s, vérifiée conforme hors application. Mémoire résidente du worker : 151 Mo au repos, 486 Mo au plus haut (relevé toutes les 0,5 s) | Poste local au repos ; une seule mesure ; le plus gros original fait quelques dizaines de Mo |
| Restitution d'un gros dossier synthétique (`scripts/mesure-restitution-dossier.mjs`) | 264 957 lignes d'écriture, 13 originaux (603 Mo, le plus gros 47 Mo) : archive de 576 Mo en 52 s, vérifiée conforme. Mémoire résidente du worker jusqu'à 519–555 Mo ; relevé interne : tampons 84–88 Mo, tas 266–332 Mo. **Avec un tas plafonné à 128 Mo, la restitution réussit** (tas 116 Mo, tampons 36 Mo, résidente 333 Mo) | Trois passes sur le même dossier, poste local ; détail et limites en D-056 |
| Mémoire des contrôles (dossier de 264 957 lignes) | Réussite avec un tas plafonné à 384 Mo, arrêt du worker à 256 Mo ; 687 Mo sans contrainte ; deux contrôles simultanés : 1 331 Mo sous le plafond retenu de 2 048 Mo. Après un arrêt par dépassement, les exécutions restées « en attente » sont reprises au redémarrage | Poste local, un seul jeu de données ; D-061 |
| Restauration de la base | 10 s pour une sauvegarde de 28 Mo (460 344 lignes d'écriture), dans un PostgreSQL d'essai séparé | Base locale d'essai ; 1 à 2 s pour 364 à 412 Ko lors des premières passes |

Ces chiffres décrivent ce poste et ces jeux. Ils ne sont pas des engagements de performance. La campagne de 200 dossiers porte sur de PETITS fichiers et un seul cabinet : ni des fichiers de 100 000 lignes par dossier, ni plusieurs cabinets simultanés n'ont été mesurés. L'import complet d'un FEC de 100 000 lignes à travers l'API, le worker et la base n'a pas été chronométré (seul le moteur l'a été).

## Qualité de l'extraction et de l'OCR

Aucune mesure sur des pièces réelles. Sur les gabarits synthétiques, numéro, date, SIRET et totaux sont retrouvés ; l'extraction s'abstient (champ vide) plutôt que de corriger une erreur d'OCR. Limites observées : page pivotée de 90° ou 180° sans information d'orientation → texte faux sans que le score du moteur d'OCR le signale ; ordre de lecture perturbé à 10° d'inclinaison ; pas de structure de tableau. Aucun taux d'erreur, de faux positif ou d'abstention ne peut être annoncé avant une évaluation sur un corpus réel autorisé.

## Écarts connus révélés par les tests ou les revues

| Sujet | État |
|---|---|
| Script de sauvegarde en jeu bloqué à sa première exécution (attente d'un événement déjà passé) | Corrigé ; Keycloak n'est pas resté figé ; le jeu interrompu qui en résulte est conservé et sert de cas de refus |
| Essai de restauration refusé faute d'espace quand le stockage dépasse le disque de la machine Docker | Corrigé : rechargement et vérification par tranches (D-062) |
| Contrôles chargés entièrement en mémoire : un exercice de plus de 500 000 lignes n'est pas contrôlé | Limite explicite et dite à l'écran (« non réalisé », avec motif) ; des contrôles en flux restent à faire (D-061) |
| Mémoire résidente du worker élevée pendant une restitution (jusqu'à 555 Mo pour une archive de 576 Mo) | Expliqué par la mesure : le besoin réel est borné (réussite avec un tas plafonné à 128 Mo), le reste est de la mémoire non encore récupérée. Le worker n'a pas de plafond de tas par défaut (D-056) |
| Traitement différent d'un original non conforme entre les deux restitutions | Corrigé (D-052) |
| Poste de développement très lent par moments (disque externe sollicité par d'autres traitements) : commandes de plusieurs minutes | Constaté le 2026-11-19 ; sans effet sur les résultats, mais les durées mesurées ce jour-là sont à lire avec prudence |
| **CI en échec à sa première exécution** (démarrage des services) | Cause NON établie : journaux inaccessibles sans authentification. Étape de diagnostic corrigée (elle s'arrêtait sur `tail`), étapes séparées et bornées ; à rejouer (D-051) |
| Mesure d'impact d'une règle sans les relevés bancaires : un contrôle bancaire était « non réalisé » avant comme après | Corrigé, vérifié par le parcours de correspondance |
| Chiffrement : écriture dans un fichier de sortie déjà existant bloquait au lieu d'être refusée | Trouvé par les tests, corrigé |
| Sauvegardes locales toujours en clair | Chiffrement complet et restauration depuis des copies chiffrées essayés avec une clé éphémère (D-055) ; activation suspendue à la décision sur la garde de la clé privée (D-050) |
| Export du journal et lecture de son état triés sur le numéro lu comme du texte (100 rangé avant 99) | Trouvé par les tests des ancres et par un essai sur les journaux locaux, corrigé avant toute utilisation |
| Simulateur d'API des tests navigateur : identifiants de contrôles écrits `TIE_001` au lieu de `TIE-001` | Corrigé : le simulateur utilise les identifiants du catalogue réel |
| Restitution d'un cabinet : mémoire du worker montée à 486 Mo pour une archive de 359 Mo | À surveiller : la construction est en flux, mais ce pic n'a pas été décomposé (compression, envoi par morceaux, tranches de 5 000 lignes) ni mesuré sur un cabinet plus gros |
| Deux archives de restitution du cabinet de démonstration (718 Mo) ajoutées au stockage local par la mesure, dont une par erreur de manipulation | Laissées en place (aucune suppression de données) ; elles alourdissent d'autant les sauvegardes locales |
| **PostgreSQL redémarré pendant un essai de restauration** (sonde de santé expirée sous charge disque, processus orphelin recueilli par le serveur) | Corrigé dans `compose.yaml` (processus d'init, sonde sans shell). Aucune donnée perdue ; essai rejoué sans redémarrage. Détail : `deploiement.md` |
| Firefox impossible à lancer par l'agent | Cause établie : protections appliquées aux processus de l'agent (D-059). Non contourné ; suite à lancer par l'utilisateur ou la CI |
| **Journal d'audit : bifurcation de la chaîne sous écritures simultanées** (numéro attribué avant le verrou). Constaté une fois en local, reproduit sur une copie | Défaut corrigé (migration 0025) et couvert par des tests sur base neuve. La base locale fictive reste dans un état historique dégradé : la vérification stricte y échoue et l'écran, l'API et l'essai de restauration le disent ; la consignation n'est qu'un diagnostic (D-038 révisée). Aucun ancrage externe des empreintes |
| Lecture du journal d'audit protégée par l'API seulement, pas par la base | Corrigé (migration 0026) |
| `scripts/applis.sh web` relançait l'application sans la reconstruire : un build périmé a fait échouer un parcours réel | Corrigé : le script reconstruit avant de relancer |
| Lignes d'un constat dans un format incohérent ; contrôles fiscaux exécutés quel que soit le territoire | Corrigés |
| Membres d'un dossier, cabinets d'un compte, pagination des documents et des anomalies, abandon et purge d'un téléversement, doublon à la clôture rejouée | Corrigés |
| Caractère nul dans un nom de fichier provoquant une erreur serveur | Corrigé (refus 400) |
| Rubriques des états sans nature ni parent ; audit sans nom d'acteur ni pagination | Corrigés |
| Noms des auteurs absents des listes de règles et d'écritures d'inventaire | Corrigé (noms renvoyés par l'API) |
| Motif de refus d'une règle conservé seulement dans l'audit | Corrigé (motif conservé sur la règle) |
| Estimation d'un projet d'avenant non conservée après rechargement | Corrigé (conservée avec le projet) |
| Marqueurs de surlignage de la recherche ambigus avec les guillemets français d'une pièce | Corrigé antérieurement (sentinelles hors texte, extrait renvoyé en segments) ; l'écart était resté noté ouvert à tort |
| Horodatages de formes différentes selon les routes | Ouvert (l'interface gère les deux) |
| `referentielComptable` et effacement d'un champ facultatif non modifiables sur un dossier | Corrigé antérieurement et testé (parcours d'administration) ; l'écart était resté noté ouvert à tort |
| Jonction de pièces à un conseil, une écriture d'inventaire, une lettre | Corrigé (formulaires livrés ; conseil et écriture vérifiés au navigateur sur pile réelle, lettre contre simulateur et par l'API) |
| Listes sans total | Corrigé : pièces, rapprochements et règles paginés avec total (D-044) |
| Aperçu d'un CSV bancaire avant confirmation du profil | Corrigé. Limite : aucun profil n'est pré-proposé (`profilPropose` toujours vide), l'utilisateur choisit toutes les colonnes |
| Correspondance comptes 512 ↔ comptes bancaires sans écran dédié | Corrigé (D-048) |
| Progression d'import sans total | Limite assumée : le fichier est lu en flux, le nombre de lignes n'est connu qu'à la fin |
| Points d'entrée publics de notification mail sans limitation de débit | Corrigé (l'écart était resté noté « ouvert » à tort) : limite globale par fournisseur, 300 par minute, testée unitairement. Limite : comptée par processus, donc non partagée entre plusieurs instances de l'API |
| Rotation de la clé de chiffrement des jetons mail | Corrigé (anciennes clés acceptées en déchiffrement seulement ; testé en bibliothèque) |
| Reprise après redémarrage de Redis pour les traitements en attente | Rattrapage au démarrage du worker, testé sur base réelle ; aucun essai avec un arrêt réel de Redis |
| Travaux non affectés comptés dans chaque mission d'un même dossier | Voulu et signalé avec leur nombre ; l'affectation explicite les départage |
| Rentabilité : honoraires non calculables renvoyés avec des sommes partielles (forfait, temps passé) | Corrigé le 2026-11-19 : aucune somme n'accompagne plus le motif ; testé dans le moteur |
| Projet d'avenant automatique : pas de choix de la lettre signée de référence quand il y en a plusieurs | Ouvert |
| Tests d'abonnement et d'isolation dépendant du nombre de dossiers présents en base | Corrigé (les attendus sont calculés d'après l'état réel) |
| Base locale encombrée par les dossiers d'essai des parcours (dont 200 dossiers « Mesure » dans le cabinet Bêta) | Laissée en l'état pour préserver les données ; `scripts/reinitialiser-base-locale.sh` existe mais est destructif et n'a jamais été lancé |
