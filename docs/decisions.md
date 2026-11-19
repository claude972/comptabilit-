# Registre des décisions et hypothèses

Chaque entrée indique la décision, sa raison et, le cas échéant, ce qui la ferait réviser. Les dates sont celles de la décision.

## Hypothèses de périmètre (cahier des charges, §4)

| Hypothèse | Valeur retenue |
|---|---|
| Clients des cabinets | TPE et PME commerciales |
| Référentiel | Comptabilité d'engagement, PCG |
| Imposition des bénéfices | IS |
| Devise | Euro |
| Territoire fiscal | Donnée explicite du dossier ; valeur initiale « à confirmer ». Seules les règles de France métropolitaine sont implémentées. |
| Exercices | Plusieurs par entité |
| Données comptables | Données de travail avant clôture et FEC, statuts distincts |

Tout dossier hors de ce périmètre peut déposer des pièces et importer des données lisibles ; la couverture réelle par lot est dans `docs/couverture.md`.

## Décisions techniques

### D-001 — Outillage installé sans droits administrateur sur « Stockage 2 » (2026-11-19)
Le poste ne disposait ni de Node.js, ni de Docker, ni de Homebrew. Avec l'accord de l'utilisateur, Node.js, pnpm, Lima, Colima, Docker CLI, Compose, Buildx et Chromium sont installés dans `/Volumes/Stockage 2 /DEV/comtaple-outils` (lien `~/.comtaple-outils`), sommes de contrôle vérifiées quand l'éditeur en publie. La machine virtuelle Docker et ses volumes sont sur ce disque, comme demandé. Rien n'est installé au niveau système.
Conséquence : toute commande commence par `source "$HOME/.comtaple-outils/env.sh"`.

### D-002 — Node.js 24 LTS plutôt que 26 LTS (2026-11-19)
Les deux lignes sont LTS à cette date. La 24.22.3 est retenue pour la maturité de l'écosystème (modules natifs, images de conteneurs). À réviser avant la fin de maintenance de la ligne 24.

### D-003 — TypeScript 6.0.3 et non 7.0.2 (2026-11-19)
TypeScript 7 est la dernière version publiée, mais `@nestjs/swagger` 12.1.2 déclare `typescript ^5.5 || ^6` et `@nestjs/cli` 12 dépend de `~6.0.2`. La 6.0.3 est donc la dernière version compatible avec la stack imposée. À réviser quand NestJS déclarera la compatibilité 7.

### D-004 — Versions figées (2026-11-19)
Dépendances épinglées sans plage (`save-exact`), `pnpm-lock.yaml` versionné, images de conteneurs référencées par étiquette de version. pnpm 12 applique un délai minimal d'ancienneté des paquets et bloque les scripts d'installation : seuls `esbuild` (et les scripts nécessaires à l'application web) sont autorisés ; `msgpackr-extract` (binaire natif facultatif) et `@scarf/scarf` (télémétrie de `swagger-ui-dist`) sont refusés. Trois paquets `vitest` 5.1.1 sont exemptés du délai d'ancienneté.

### D-005 — Stockage objet local : SeaweedFS au lieu de MinIO (2026-11-19)
L'image `minio/minio` n'est plus publiée sur Docker Hub. SeaweedFS 4.54 fournit l'API S3 en local. C'est un choix de DÉVELOPPEMENT uniquement : la cible reste OVHcloud Object Storage (région française). Le verrouillage d'objets (Object Lock) n'est ni testé ni activé en local.

### D-006 — Aucun montage de dossier hôte dans les conteneurs (2026-11-19)
Le dépôt est sur un volume dont le chemin contient des espaces et qui n'est pas partagé avec la machine virtuelle. Les services utilisent des volumes Docker ; les fichiers de configuration sont embarqués à la construction de l'image ou passés par `configs` de Compose.

### D-007 — Isolation : trois rôles PostgreSQL et RLS forcé (2026-11-19)
- `comtaple_app` (serveur interactif) et `comtaple_worker` (traitements différés) : ni superutilisateur, ni `BYPASSRLS`, propriétaires d'aucune table.
- Toutes les tables portant `cabinet_id` ont `ENABLE` et `FORCE ROW LEVEL SECURITY` : le propriétaire des tables y est soumis aussi.
- Politique permissive par cabinet pour tous ; politique restrictive par dossier pour `comtaple_app`, fondée sur la table `habilitations_dossier`. Un administrateur voit la liste des dossiers mais pas le contenu d'un dossier où il n'est pas habilité.
- Le contexte (`app.cabinet_id`, `app.utilisateur_id`, `app.sujet`) est posé par transaction à partir du jeton vérifié. Le cabinet demandé par l'en-tête `X-Cabinet-Id` n'est accepté que s'il figure parmi les appartenances actives lues en base.
- Le rôle de migration doit posséder `BYPASSRLS` (ou être superutilisateur, comme en local) : il sert au provisionnement des cabinets et à une fonction `SECURITY DEFINER` étroite (`worker_documents_en_retard`) qui ne renvoie que des identifiants. Aucun service ne l'utilise en fonctionnement normal.
- Limite assumée : RLS protège contre un oubli de filtre dans le code applicatif, pas contre un attaquant capable d'exécuter du SQL arbitraire sous le rôle applicatif (il pourrait poser lui-même les variables de contexte). La défense contre ce cas repose sur les requêtes paramétrées et l'absence de SQL libre.

### D-008 — Injection de dépendances explicite dans NestJS (2026-11-19)
NestJS 12 est distribué en modules ES. Toutes les injections utilisent `@Inject(jeton)` : le fonctionnement ne dépend pas des métadonnées de types émises par le compilateur.

### D-009 — Protocole de téléversement reprenable propre (2026-11-19)
Ouverture avec taille et SHA-256 annoncés, morceaux de 4 Mo à décalage vérifié, clôture avec vérification serveur de la taille et de l'empreinte. Le statut « reçu » n'existe qu'après cette vérification. Un morceau rejoué est sans effet ; un décalage inattendu renvoie 409 avec le décalage attendu. Le protocole tus a été écarté pour limiter les dépendances ; à réviser si des clients tiers doivent déposer.

### D-010 — Originaux adressés par empreinte (2026-11-19)
Clé de stockage `cabinets/{cabinet}/originaux/{sha256}`. Un original n'est jamais réécrit. Un même binaire arrivant plusieurs fois dans un dossier crée des occurrences de réception distinctes rattachées au même document (doublon binaire), ce qui est distinct d'une nouvelle version et d'une suspicion de double comptabilisation.

### D-011 — Ordre des méthodes d'extraction (2026-11-19)
Données structurées (Factur-X embarqué, CII, UBL) avant la couche texte du PDF, avant l'OCR. L'extraction des champs est déterministe (règles). La passerelle IA n'est pas sollicitée par l'analyse de pièces à ce stade ; son statut est « non connectée » tant qu'aucune clé n'est fournie et vérifiée.

### D-012 — Seuils internes de lisibilité (2026-11-19)
Couche texte retenue à partir de 40 caractères utiles ; pièce jugée illisible sous 25 caractères reconnus par l'OCR. Ce sont des règles internes non calibrées sur des pièces réelles, à ajuster après évaluation sur un corpus autorisé.

### D-013 — Antivirus bloquant par défaut (2026-11-19)
Sans verdict ClamAV, une pièce n'est ni analysée ni servie (`ANTIVIRUS_OBLIGATOIRE=true`) ; la tâche est retentée. Une pièce infectée passe en quarantaine.

### D-014 — Rendu PDF hors ligne (2026-11-19)
Le dossier de révision est rendu par Chromium (Playwright) avec JavaScript désactivé et toute requête réseau refusée ; tout texte issu des données est échappé.

### D-015 — Authentification côté navigateur par BFF (2026-11-19)
Les jetons OIDC ne sont jamais exposés au navigateur : le serveur Next.js détient la session (cookie chiffré) et relaie les appels à l'API.

### D-016 — MFA non imposé dans le royaume de développement (2026-11-19)
Le royaume Keycloak local sert aux tests automatisés et n'impose pas de second facteur. Le royaume de production devra l'imposer pour les comptes du cabinet ; ce point figure dans `docs/acces-externes.md`. Le client `comtaple-tests` (mot de passe direct) n'existe que dans le royaume de développement.

### D-017 — Port 3100 pour l'application web (2026-11-19)
Le port 3000 du poste est occupé par un autre projet. L'application est servie sur 3100 ; le royaume Keycloak de développement accepte les deux origines. Ports réservés aux tests : 3200 (web simulé), 4100 (simulateur d'API des tests navigateur), 4300 (seconde API des parcours mail).

### D-018 — Garde de territoire fiscal (2026-11-19)
Hors « métropole », ou tant que le territoire est « à confirmer », les contrôles dont la règle ou le seuil relève de la fiscalité métropolitaine (`TVA-001`, `TVA-002`, `IMM-002`) ne sont pas réalisés et l'indiquent. Le territoire est obligatoire et sans valeur par défaut à la création d'un dossier. Un changement de territoire rend les contrôles exécutés obsolètes.

### D-019 — Rapprochement bancaire : proposition, jamais écriture (2026-11-19)
Le moteur propose ; un réviseur valide ou rejette. Une validation ne modifie aucune écriture importée et n'écrit aucun lettrage : le logiciel de production comptable reste le système de référence. Une ambiguïté n'est jamais tranchée ; un abandon pour borne de calcul est toujours signalé. Convention de sens : positif = encaissement, des deux côtés.

### D-020 — Identité d'un mouvement bancaire (2026-11-19)
Un mouvement est unique par dossier et par clé stable (compte, date, montant, référence bancaire ; à défaut empreinte des champs et rang parmi les homonymes du jour). Limite : deux exports de périodes différentes sans référence bancaire peuvent décaler le rang d'homonymes et créer un doublon ; le cadrage des soldes le révèle.

### D-021 — CSV bancaire : abstention puis confirmation humaine (2026-11-19)
Si les colonnes ne sont pas reconnues avec certitude, l'import échoue en demandant un profil ; l'utilisateur le confirme et relance. Un profil proposé automatiquement est marqué comme tel dans le rapport.

### D-022 — Fonctions SQL étroites à droits du propriétaire (2026-11-19)
Quelques besoins traversent volontairement le cloisonnement par dossier ou par cabinet : rattrapage du worker, purge des téléversements, membres d'un dossier, décomptes d'usage de l'abonnement, situation de l'abonnement, obsolescence après changement de règle, résolution d'une notification mail. Chacun passe par une fonction `SECURITY DEFINER` qui vérifie l'appelant, ne renvoie que des identifiants, des décomptes ou des champs non sensibles, et n'est exécutable que par le rôle qui en a besoin. La liste est dans les migrations ; toute nouvelle fonction de ce type doit être justifiée ici.

### D-023 — Abonnements : séparation éditeur / cabinet (2026-11-19)
La grille tarifaire, l'ouverture d'un essai, l'émission des échéances et le rapprochement des virements sont des opérations de l'éditeur (rôle d'administration, module de provisionnement). Le rôle applicatif n'a aucun droit d'écriture sur les offres et les échéances. Le cabinet peut seulement demander un changement d'offre ou résilier. Les montants de la grille de démonstration sont fictifs. Il n'existe pas encore d'outil d'exploitation pour l'éditeur : les opérations se font par les fonctions du module.

### D-024 — Service fermé, données accessibles (2026-11-19)
Essai expiré, abonnement suspendu ou résilié : les nouveaux dépôts et imports sont refusés ; consultation, téléchargement et restitution restent possibles. Les quotas de pièces et de stockage sont affichés et signalés, mais ne bloquent pas la collecte : une pièce transmise par un client n'est jamais refusée pour dépassement.

### D-025 — Règles de cabinet (2026-11-19)
Une préférence de cabinet ou une exception de dossier est un jeu de paramètres d'un contrôle, validé par le schéma du contrôle, versionné, sans effet tant qu'il n'est pas approuvé. L'approbation exige une mesure d'impact préalable et une autre personne que l'auteur (administrateur ou associé). Le retrait rétablit les paramètres par défaut. Les contrôles à fondement réglementaire ne sont pas paramétrables par ce parcours. Aucune règle n'est jamais partagée entre cabinets.

### D-026 — Restitution (2026-11-19)
Archive ZIP par dossier, au niveau d'habilitation « validation ». Les originaux sont relus et comparés à leur empreinte avant d'entrer dans l'archive ; ceux que l'antivirus a écartés sont exclus et listés. Les noms d'origine ne déterminent jamais les chemins. Limite : les données structurées sont assemblées en mémoire (les écritures sont lues par tranches) ; une restitution de tout un cabinet en une fois n'existe pas.

### D-027 — Un téléversement déjà ouvert se termine même si le service ferme (2026-11-19)
La situation de l'abonnement est vérifiée à l'OUVERTURE d'un téléversement, pas à sa clôture : une pièce en cours de transmission au moment où le service ferme (essai expiré, suspension) est reçue et conservée plutôt que perdue. Aucun nouveau téléversement ne peut être ouvert ensuite.

### D-028 — Écritures d'inventaire : proposer, approuver, exporter, intégrer (2026-11-19)
Quatre étapes distinctes. Une écriture proposée est séparée des écritures importées, équilibrée (vérifié en décimal exact), justifiée, et sans effet tant qu'un réviseur autre que son auteur ne l'a pas approuvée. La balance ajustée de travail additionne les importées et les approuvées sans modifier les premières. L'export produit un fichier remis à l'utilisateur ; l'intégration dans le logiciel comptable n'est pas faite par ce logiciel. Une proposition antérieure à un changement des données importées est « à revoir » et sort de la balance ajustée. Seule l'origine « saisie humaine » existe : aucune écriture n'est générée automatiquement.

### D-029 — Veille : détecter n'est pas résumer (2026-11-19)
La surveillance compare l'empreinte du texte d'une page officielle à la précédente. Un changement crée une évolution « détectée, à qualifier » sans résumé ; seule une personne de l'éditeur, après lecture, la qualifie (résumé, dates, conditions, critères). Les cabinets ne voient que les évolutions qualifiées. Une source injoignable est « indisponible », avec sa dernière vérification réussie ; au-delà de 7 jours sans succès, la veille sur cette source n'est plus dite assurée (seuil interne). Seuls des domaines officiels en https sont interrogés.

### D-030 — Indicateurs et états : traçabilité et abstention (2026-11-19)
Chaque indicateur porte sa formule, sa convention et les comptes qui le composent ; non calculable, il vaut `null` avec son motif, jamais zéro. Les soldes intermédiaires de gestion ne figurent plus dans le PCG en vigueur : ils sont des conventions internes, présentées comme telles. La table de correspondance comptes → rubriques est une lecture des intitulés du PCG, marquée « en attente de validation professionnelle » ; un compte que l'on ne sait pas rattacher avec certitude reste « non affecté » et rend l'état incomplet. Aucune égalité n'est forcée. Les indicateurs d'activité du cabinet sont agrégés par cabinet et par dossier, jamais par personne.

### D-031 — Nouvelle version d'une pièce (2026-11-19)
Une nouvelle version se dépose explicitement sur la version la plus récente d'un document. L'ancienne version et son fichier original sont conservés et restent consultables ; elle passe au statut « remplacé » et n'est plus jamais la version de travail. Si son extraction avait été validée, cette validation est invalidée de façon explicite (statut « validation_invalidee », décision historisée avec son auteur, ligne d'audit) : une validation porte sur une version et ne se transmet pas. Redéposer le même fichier n'est pas une nouvelle version mais un doublon binaire. Un déposant peut remplacer sa propre pièce tant que le cabinet ne l'a pas validée ; ensuite seul un collaborateur habilité le peut. Limite : les références à l'ancienne version (pièce jointe d'un conseil, d'une écriture d'inventaire) ne sont pas basculées vers la nouvelle ; l'interface signale la pièce comme remplacée.

### D-032 — Annulation réversible d'un import (2026-11-19)
Annuler un import ne supprime rien : fichier original, lignes et rapport sont conservés ; le lot est seulement écarté et peut être rétabli. Import comptable actif : le lot précédent encore valable redevient actif, la version des données de l'exercice est incrémentée, les exécutions de contrôles et de rapprochement passent obsolètes, les constats déjà décidés passent « à revoir », et les contrôles sont relancés sur le lot actif. S'il n'y a pas de lot précédent, l'exercice n'a plus de données actives et les travaux le disent. Relevé bancaire : chaque mouvement est rattaché à tous les lots où il a été vu ; il reste pris en compte tant qu'un de ces lots est actif. Un import annulé avant d'aboutir se relance par « reprise », il ne se « rétablit » pas. Annulation et rétablissement exigent l'habilitation de révision et un motif.

### D-033 — Campagnes d'import (2026-11-19)
Une campagne regroupe l'import d'un même type de fichier pour de nombreux dossiers. Chaque dossier garde son propre lot, sa propre tâche et sa propre transaction : l'échec de l'un n'affecte pas les autres. Le suivi ne détaille que les dossiers où l'appelant est habilité et compte les autres sans rien en révéler. L'annulation d'une campagne n'annule que les imports des dossiers où l'appelant est habilité en révision ; chaque import reste rétablissable individuellement. Limite : les fichiers se déposent un par un (dossier par dossier) ; il n'y a pas de dépôt d'une archive répartie automatiquement entre les dossiers.

### D-034 — Rentabilité d'une mission (2026-11-19)
Calculée sur des données explicitement saisies : honoraires des lettres validées (forfait annuel au prorata sur 365 jours — convention interne —, ou temps passé au taux horaire de la lettre) et temps observés des travaux. Rien n'est supposé : un montant ou un taux manquant rend les honoraires non calculables ; des temps non saisis rendent les ratios « partiels ». Le coût horaire interne du cabinet n'a aucune valeur par défaut ; tant qu'il n'est pas saisi par un gestionnaire, aucune marge n'est calculée. Coût et marge ne sont montrés qu'aux gestionnaires. Les travaux ne sont pas affectés à une mission : ils lui sont rattachés par le périmètre de sa lettre applicable à leur date.

### D-035 — Rattrapage et prise en charge atomique (2026-11-19)
Toutes les cinq minutes, le worker remet en file les traitements confirmés en base mais restés en attente plus de dix minutes (pièces, imports, contrôles, rapprochements, exports, restitutions) et purge les téléversements expirés. Un import est pris en charge de façon atomique (passage de « en attente » ou « échec » à « en cours ») : une tâche en double s'efface. Limite : un import interrompu brutalement en cours de traitement reste « en cours » et n'est pas repris automatiquement ; il s'annule puis se reprend à la main.

### D-036 — Accès temporaire du support (2026-11-19)
Ouvert par l'éditeur seulement (outil en ligne de commande), pour 1 à 72 heures, avec motif, inscrit au journal du cabinet. Il ne donne accès à aucun dossier : un gestionnaire du cabinet habilite ensuite ce compte, en lecture au plus. L'application refuse toute écriture à ce rôle et trace chaque consultation (gabarit de route). L'accès expire seul ; sa fermeture retire les habilitations. Une personne déjà membre du cabinet ne peut pas recevoir en plus un accès support.

### D-037 — Capacité du stockage objet local et volume des jeux de test (2026-11-19)
Le stockage S3 local de développement était plafonné à 20 volumes de 256 Mo. Les parcours de test l'ont rempli (notamment une archive de restitution de 173 Mo produite à chaque exécution), ce qui s'est manifesté par des erreurs internes du stockage au dépôt d'un fichier. Le plafond est porté à 120 volumes, sans suppression de données, et le parcours de restitution travaille désormais sur un petit dossier neuf. Seul du cache de construction Docker (régénérable) a été libéré. Enseignement pour la production : la saturation du stockage doit être supervisée et produire une alerte avant d'atteindre l'application ; aujourd'hui elle se traduit par un échec de dépôt explicite (aucun « reçu » n'est affiché), sans alerte préalable.

### D-038 — Chaînage du journal d'audit sous écritures simultanées, et anomalies consignées (2026-11-19)
**Défaut constaté.** Le numéro d'une ligne du journal était attribué avant la prise du verrou du cabinet. Deux écritures simultanées (API et worker) pouvaient donc être chaînées dans l'ordre inverse de leurs numéros, et la ligne suivante se rattacher une seconde fois au même prédécesseur. Constaté une fois sur la base locale d'essai (cabinet Alpha fictif, lignes 7603 et 7604), reproduit à volonté sur une copie de la base (300 insertions parallèles). Aucune ligne n'a été modifiée : chaque empreinte reste valide ; c'est l'ordre qui est irrégulier. Les passes de tests précédentes n'avaient pas rencontré ce croisement.

**Correctif (migration 0025).** Le numéro est attribué sous le verrou : pour un cabinet, l'ordre des numéros est celui de la chaîne. Prouvé sur la copie (600 insertions parallèles sans rupture) puis par un test permanent (80 écritures parallèles sur la base réelle). Des trous dans la numérotation sont normaux.

**Révision du même jour, sur arbitrage de supervision (« à revoir pour l'exploitation »).** La première version laissait une anomalie consignée rendre « vert » l'écran, l'API, les tests et l'essai de restauration. C'est retiré :

- **Référence unique : la vérification stricte** (`journal_audit_verifier`). L'API renvoie son résultat dans `integrite.rupture` ; l'écran affiche une rupture tant qu'elle existe ; l'essai de restauration sort en échec d'intégrité (code 3) tout en constatant, à part, que la restauration est fidèle à l'origine.
- **La consignation n'est qu'un diagnostic.** Elle est affichée DANS l'alerte de rupture, avec la mention qu'elle ne rétablit pas l'intégrité. Elle n'ouvre aucun droit, ne modifie pas le journal et ne change le résultat d'aucun contrôle. Elle reste réservée à l'éditeur, en ajout seul, refusée si une empreinte est fausse, si un prédécesseur déclaré n'existe pas dans le journal du cabinet, si la plage ne contient pas d'irrégularité ou ne l'explique pas entièrement.
- **Historique conservé.** Les lignes 7603 et 7604 du cabinet Alpha fictif et la consignation déjà faite restent en place, sans effacement ni réécriture. Cette base locale est donc dans un état HISTORIQUE DÉGRADÉ, affiché comme tel partout ; il ne sera pas « réparé ».
- **Non-régression séparée de l'historique.** Les tests de la chaîne tournent sur une base neuve et isolée, créée puis supprimée à chaque exécution (`packages/db/src/journal.itest.ts`), où la vérification stricte doit réussir : rejeu de toutes les migrations depuis zéro, 240 écritures simultanées par deux rôles sur deux cabinets, altérations par les rôles applicatifs (refusées) et par le propriétaire (contenu modifié, empreinte recalculée, ligne supprimée, début tronqué : toujours désignées), prédécesseur inexistant, vidé ou pris dans le journal d'un autre cabinet, altération dans et après une plage consignée, isolation entre cabinets. Les tests qui tournent sur la base locale existante ne concluent plus à l'intégrité : ils vérifient seulement que les lignes écrites aujourd'hui n'ajoutent aucune irrégularité.
- **Durcissement trouvé par ces tests (migration 0026).** La lecture du journal et des anomalies n'était réservée aux gestionnaires que par l'API ; la base laissait lire tout contexte portant le bon cabinet. Elle est maintenant réservée aux gestionnaires dans la base elle-même. Le chaînage s'exécute avec les droits du propriétaire pour que l'écriture d'un non-gestionnaire continue de s'enchaîner (testé).

**Limites qui demeurent.** Le propriétaire de la base peut toujours désactiver les déclencheurs ; la chaîne rend alors l'altération visible, sauf réécriture complète de la fin du journal, que seul un ancrage externe des empreintes (non réalisé) révélerait. `journal_audit_verifier` appelée par un non-gestionnaire ne voit aucune ligne et renvoie « rien à signaler » : seule l'API, qui exige un gestionnaire, l'appelle. Aucune validation professionnelle ni de production n'est attachée à cette décision.

### D-039 — Affectation explicite des travaux à une mission (2026-11-19)
Un travail peut être affecté à une mission de son dossier, à la saisie ou après coup, par un membre du cabinet (niveau collaboration) ; le changement est journalisé. L'affectation n'est jamais déduite de la prestation ou de la date. Un travail affecté est situé par rapport aux seules lettres de sa mission et n'est compté que dans la rentabilité de celle-ci ; un travail non affecté reste compté dans chaque mission du dossier, et la rentabilité le dit et le dénombre quand le dossier a plusieurs missions.

### D-040 — Sauvegarde et essais de restauration isolés, en local (2026-11-19)
La sauvegarde locale couvre la base puis tous les objets du stockage (dans cet ordre) ; Keycloak est exporté à part. Un essai de restauration ne lit ni n'écrit jamais dans les services de l'application : la base est restaurée dans une base neuve, les objets dans une instance de stockage créée pour l'essai avec ses propres identifiants, Keycloak dans une instance séparée ; toutes sont détruites ensuite. Le script de rechargement refuse d'écrire dans le stockage de l'application. Le contrôle porte sur TOUS les objets référencés par la base restaurée, comparés à l'empreinte enregistrée en base, et non plus sur un échantillon lu dans le stockage d'origine. L'essai échoue (code 3) quand la vérification stricte du journal d'audit échoue, même si la restauration est fidèle. Ces essais valident la démarche en local ; ils ne valent pas pour la production, dont les sauvegardes relèveront de l'hébergeur.

### D-041 — PostgreSQL en conteneur : processus d'init obligatoire (2026-11-19)
Depuis PostgreSQL 17, le serveur redémarre quand un processus enfant qu'il ne connaît pas se termine anormalement. Dans un conteneur où il est le premier processus, il recueille les orphelins des sondes et des commandes lancées de l'extérieur : une sonde de santé expirée a suffi à le faire redémarrer pendant un essai. Le conteneur local a désormais un processus d'init et une sonde sans shell. Même précaution à prévoir partout où PostgreSQL tournerait en conteneur.

### D-042 — Essais multi-navigateurs (2026-11-19)
Les parcours sur pile réelle choisissent leur profil d'après le moteur réellement lancé (plus d'agent utilisateur Chrome annoncé par un autre moteur) et sont rejoués sous WebKit. Les parcours contre le simulateur d'API restent propres à Chromium : ils dépendent d'une option de résolution d'hôte que seul Chromium accepte. Firefox est configuré mais n'a pas pu être lancé sur ce poste. WebKit n'est pas Safari, et une émulation n'est pas un appareil.

### D-043 — Restitution d'un cabinet entier (2026-11-19)
Réservée aux gestionnaires (administrateur, associé), dans la base comme dans l'API. **Le périmètre suit les habilitations du demandeur** : un dossier n'entre dans l'archive que s'il y a le niveau « validation » ; les autres sont listés avec leur motif, et l'archive est marquée incomplète. Être gestionnaire ne suffit donc pas à sortir les données d'un dossier ; pour une restitution complète, le demandeur doit être habilité sur tous les dossiers (opération journalisée). Le périmètre est figé à la demande. L'archive n'est téléchargeable que par son demandeur : sinon un autre gestionnaire lirait, par elle, des dossiers où il n'est pas habilité. L'archive est construite en flux (tables lues par tranches en JSON Lines, originaux recopiés sans chargement en mémoire et comparés à leur empreinte, envoi au stockage au fil de l'eau). Sont exclus et nommés au manifeste : jetons et secrets de connexion, lignes brutes des relevés (présentes dans les originaux), originaux écartés par l'antivirus. Le journal d'audit restitué ne contient que les lignes du cabinet et des dossiers du périmètre ; le manifeste porte le résultat de la vérification stricte au moment de la génération. Le manifeste se vérifie sans le logiciel (`scripts/verifier-restitution.mjs`, ou tout outil de calcul d'empreinte). Limites : les lignes d'audit sans dossier cible sont toutes restituées, même si leur détail mentionne un dossier écarté ; l'archive n'est ni chiffrée ni signée ; la restitution d’un dossier isolé assemble encore ses données en mémoire.

### D-044 — Pagination des rapprochements et des règles (2026-11-19)
Rapprochements : pages de 200, ordre stable (niveau, règle, date, identifiant), décomptes par statut et par règle calculés sur toutes les propositions de l'exécution et renvoyés avec chaque page ; chaque page porte les écritures et mouvements dont elle a besoin. Sans paramètre, la première page est renvoyée (le plafond silencieux de 2 000 disparaît). Règles : avec `page`, réponse paginée de 50 avec total et décomptes ; sans `page`, l'ancienne forme (tableau des 500 plus récentes) est conservée pour ne rien casser, et signalée comme à ne plus utiliser. Pagination par décalage : une règle créée pendant un parcours peut décaler les pages suivantes d'un rang ; jugé acceptable pour des listes consultées par quelques personnes.

### D-045 — Essais de restauration sans effet sur les services locaux (2026-11-19)
Suite au redémarrage de PostgreSQL et à l'arrêt de Keycloak constatés lors des premiers essais : la base est restaurée dans un PostgreSQL d'essai séparé (plus aucune base créée ni supprimée dans le serveur de l'application, plus de charge d'écriture sur son journal de transactions) ; les instances d'essai ont des ressources plafonnées ; l'essai est refusé si un service n'est pas en bonne santé ou si l'espace disque ne laisse pas 2 Go de marge ; il compare les instants de démarrage des services avant et après et sort en erreur (code 4) si l'un d'eux a redémarré. Keycloak est exporté sans arrêt : le conteneur est figé le temps de copier sa base embarquée (0,3 s constaté), la copie ayant la cohérence d'un arrêt brutal, puis l'export est fait à part ; la comparaison à l'origine reste la garantie. Rien de ceci ne modifie les données existantes.

### D-046 — Ancres du journal d'audit : format et vérification préparés, ancrage non réalisé (2026-11-19)
La chaîne d'empreintes ne révèle pas une réécriture complète de la fin du journal par qui administre la base (limite de D-038, désormais démontrée par un test). Ce qu'il faut pour la révéler est préparé : un export du journal vérifiable sans PostgreSQL, une « ancre » (dernière ligne, son empreinte, nombre de lignes, résultat de la vérification stricte, chaînage à l'ancre précédente) et une vérification sans base ni réseau (`scripts/journal-ancre.mjs`). **Aucun ancrage externe n'est fourni** : une ancre ne prouve quelque chose que si elle est déposée hors de portée de l'administrateur de la base (tiers, horodatage qualifié, publication), et aucune destination indépendante n'est configurée ; l'outil écrit dans un dossier local et le dit à chaque exécution. Le choix de cette destination, sa fréquence et son coût éventuel sont un arbitrage externe (`acces-externes.md`). La vérification stricte reste la référence ; l'ancre la complète sans la remplacer. Les lignes postérieures à la dernière ancre ne sont couvertes que par la chaîne.

### D-047 — Restitution d'un dossier isolé en flux (2026-11-19)
Même construction que la restitution du cabinet (outils communs `apps/worker/src/archive.ts`) : tables lues par tranches et écrites au fil de l'eau, écritures en CSV par tranches, originaux relus en flux. Le format de l'archive (`comtaple.restitution/1`) et son contenu sont inchangés. Chaque original est lu deux fois — une pour vérifier son empreinte, une pour le recopier — afin de conserver la règle « un original dont le contenu ne correspond plus à son empreinte n'est pas restitué » sans le charger en mémoire. La restitution du cabinet garde sa propre règle (l'original est restitué et signalé non conforme) : les deux comportements diffèrent encore.

### D-048 — Correspondance comptes 512 / comptes bancaires (2026-11-19)
L'écran ne décide rien. Il montre l'état de l'association utilisée par le rapprochement bancaire (TRE-003) et permet à un collaborateur habilité de PROPOSER une correspondance, qui devient une proposition de règle propre au dossier et suit le circuit existant : mesure d'impact, puis approbation par une autre personne, administrateur ou associé. Tant qu'elle n'est pas approuvée, rien ne change et le contrôle reste « non réalisé ». Une proposition n'est recevable que sur des comptes existants du dossier, un pour un ; les autres paramètres approuvés du contrôle sont conservés. L'IBAN complet n'est ni renvoyé par ces routes ni attendu en entrée : référence opaque propre au dossier et libellé masqué (quatre derniers caractères). Correction liée : la mesure d'impact d'une règle recevait les écritures mais pas les relevés, si bien qu'un contrôle bancaire était « non réalisé » avant comme après ; elle reçoit maintenant les relevés actifs. Limites : la référence opaque est une empreinte tronquée de l'IBAN et du dossier, non salée par un secret ; pas de correspondance au niveau du cabinet entier par cet écran ; l'approbation se fait dans l'écran des règles.

### D-049 — Notifications internes, sans envoi extérieur (2026-11-19)
Les notifications n'existent que dans l'application : aucun courriel, SMS ni notification poussée, et aucun service tiers. Chacun ne lit que les siennes (politique de la base) et ne peut que les marquer « lues ». L'application n'écrit pas la table : elle passe par une fonction de la base qui impose le cabinet du contexte, ne retient que les membres actifs, exclut l'auteur de l'action et refuse un dossier d'un autre cabinet. Une notification ne porte que des identifiants et quelques valeurs non sensibles ; son texte est composé à la lecture selon les droits du lecteur à cet instant, de sorte qu'une notification d'un dossier devenu inaccessible n'en dit plus rien. Déclencheurs : règle ou correspondance à décider (gestionnaires), décision rendue (auteur), complément demandé sur une pièce (déposant) et réponse (demandeur), archives de restitution prêtes ou en échec (demandeur). Limites : pas de préférences par personne, pas de purge, décompte lu à chaque page ; les autres événements (import terminé, constat affecté, échéance) ne notifient pas encore.

### D-050 — Chiffrement des sauvegardes locales : préparé, non activé (2026-11-19)
Un outil chiffre les fichiers de sauvegarde pour un destinataire désigné par sa clé publique (X25519, HKDF-SHA-256, AES-256-GCM par blocs authentifiés avec leur rang et un indicateur de fin). Le poste qui sauvegarde n'a besoin que de la clé publique et ne peut pas relire ses sauvegardes. Rien n'est supprimé ni écrasé : les fichiers en clair, existants ou nouveaux, restent en place. **Aucune clé n'a été créée ni configurée** : où conserver la clé privée (qui la détient lit tout, qui la perd ne restaure plus rien) est une décision de l'utilisateur ; tant qu'elle n'est pas prise, `scripts/sauvegarder.sh` écrit « sauvegarde EN CLAIR ». Limites : format maison assemblant des primitives standard, ni audité ni comparé à un outil reconnu — à faire revoir, ou à remplacer par le chiffrement de l'hébergeur ou un outil éprouvé, avant toute exploitation ; les objets du stockage (plusieurs Go) ne sont pas encore chiffrés ; l'essai de restauration ne lit pas encore des sauvegardes chiffrées.

### D-051 — Première exécution de la CI en échec : ce qui est établi et ce qui ne l'est pas (2026-11-19)
Run 44509674342 (commit 07db781) : build, typage et tests unitaires réussis ; échec de l'étape « Services » (`docker compose up -d --build --wait`) après 5 min 07 s, puis de l'étape « Journaux en cas d'échec ». **La cause de l'échec des services n'est pas établie** : les journaux ne se lisent qu'avec une authentification à l'API GitHub que ni cette session ni la session GitHub (clé SSH seule) ne possèdent. Vérifié en local sans reproduire l'échec : démarrage à neuf, dans un projet séparé, de PostgreSQL, Redis, S3 et Keycloak (35 s) puis de l'OCR ; téléchargements vérifiés de l'image OCR pour amd64 (en émulation). Non vérifiable ici : construction complète et exécution de l'OCR sur amd64 sans cache, premier téléchargement des signatures ClamAV, ressources du runner. Établi et corrigé : l'étape de diagnostic s'arrêtait sur `tail` quand les journaux de l'API n'existaient pas (scripts en arrêt à la première erreur), sans jamais afficher l'état des conteneurs. La CI sépare désormais la construction, les services de base, l'antivirus et l'OCR, chacun avec son délai, et l'étape de diagnostic ne peut plus échouer. Corrections commitées en local ; leur effet ne sera connu qu'à la prochaine exécution, après un push décidé dans la session GitHub.

## Écarts par rapport au cahier des charges

| Sujet | Écart | Raison |
|---|---|---|
| TypeScript « en mode strict » | Version 6 et non la dernière (7) | D-003 |
| Stockage S3 local | SeaweedFS, pas de test d'Object Lock | D-005 |
| MFA | Non imposé en développement | D-016 |
