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

**Lignes déjà écrites.** Le journal est en ajout seul : il n'est ni réécrit ni « réparé ». L'éditeur — et lui seul, par l'outil en ligne de commande — peut consigner une anomalie d'enchaînement sur une plage courte (50 lignes au plus), avec une cause décrite. La consignation est refusée si une ligne de la plage a une empreinte fausse (contenu altéré), si la plage ne contient aucune irrégularité ou si elle n'explique pas la rupture. Elle est en ajout seul, inscrite au journal du cabinet et affichée au gestionnaire : l'écran dit « chaîne vérifiée, avec une irrégularité d'ordre consignée », jamais « intacte ». La vérification stricte (`journal_audit_verifier`) reste inchangée ; l'API renvoie les deux résultats.

**Limites, à arbitrer.** Ce mécanisme est une tolérance : quiconque dispose du rôle d'administration de la base peut consigner une plage (mais ne peut pas masquer une ligne au contenu modifié). Il ne remplace pas un ancrage externe des empreintes (horodatage qualifié ou dépôt périodique hors de la base), non réalisé. La consignation faite sur la base locale porte sur des données fictives ; en exploitation, elle devrait relever d'une procédure à deux personnes. Décision prise sans arbitrage de l'utilisateur, à confirmer.

### D-039 — Affectation explicite des travaux à une mission (2026-11-19)
Un travail peut être affecté à une mission de son dossier, à la saisie ou après coup, par un membre du cabinet (niveau collaboration) ; le changement est journalisé. L'affectation n'est jamais déduite de la prestation ou de la date. Un travail affecté est situé par rapport aux seules lettres de sa mission et n'est compté que dans la rentabilité de celle-ci ; un travail non affecté reste compté dans chaque mission du dossier, et la rentabilité le dit et le dénombre quand le dossier a plusieurs missions.

## Écarts par rapport au cahier des charges

| Sujet | Écart | Raison |
|---|---|---|
| TypeScript « en mode strict » | Version 6 et non la dernière (7) | D-003 |
| Stockage S3 local | SeaweedFS, pas de test d'Object Lock | D-005 |
| MFA | Non imposé en développement | D-016 |
