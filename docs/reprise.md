# État de reprise du chantier P5 (mis à jour le 2026-11-22)

Document de passage pour reprendre le travail sans relire la conversation. À mettre à jour à chaque lot.

## Livré (commits sur `main`, tous publiés)
| Lot | Décision | Commit |
|---|---|---|
| Arrondi à l'euro (affichage), renvois | D-105 | 5e3a581 |
| 2052 (France / export), 2053 (exceptionnel, 13 renvois) | D-106 | a3a6bc1 |
| 2033-B : « dont export », 8 lignes « dont », 24 codes de cases | D-107 | 84717d9 |
| Contrôle du profil Colima | D-108 | 84717d9 |
| P0 4e passe (SIGKILL prouvé, suite groupée 33/33, entrée à crédit décidée) | D-109 | 84717d9, 32fd15a, df58793, 3e12fed, f2536f6 |
| 2033-B partie B (résultat fiscal), historique en ajout seul | D-110 | 533329a |
| Détail des totaux 330 / 342 / 350 | D-111 | 2106374 |
| Cadre III du 2033-C, 2054 bis | D-112 | f6295b8 |
| 2055 cadres B et C | D-113 | a487710 |
| 2033-D | D-114 | 9566172 |
| 2033-E | D-115 | dbedb6c |
| 2033-F | D-116 | 0d735c5 |
| 2033-G | D-117 | 11c11ed |
| Moteur générique de formulaires par cases, 2058-A | D-118 | f7d6981 |
| 2058-B, 2058-C | D-119 | f4ade36 |
| 2059-E, 2059-F, 2059-G (F et G = mêmes saisies que 2033-F et G) | D-120 | ce7e5ca |
| 2059-A | D-121 | e7ae833 |
| 2059-B, 2059-C, 2059-D (moteur de grilles) | D-122 | c248a4c |
| 2065 (page 1) | D-123 | ea2ccaf |
| Import XLSX des immobilisations | D-124 | df60b4f |
| Composants par import | D-125 | 048039f |
| Cadre IV du 2033-D (saisie), dates du 2033-E / 2059-E | D-126 | 1c506a3 |
| Rapprochement ZJ/YX du 2058-C avec FW/FX du 2052 | D-127 | d84485d |
| États joints (lignes au-delà de la capacité des formulaires 2033) | D-128 | dd00581 |
| 2056 (provisions inscrites au bilan) | D-129 | 095a564 |
| 2057 (échéances des créances et des dettes) | D-130 | 84337eb |
| Annexe 2065 bis-SD | D-131 | e777e24 |
| Feuillet des déficits transférés (982 bis, 982 ter) | D-132 | db47bad |
| Feuillets réel normal : K4 bis du 2058-B, détails du 2058-A | D-133 | c73872c |
| 2054 / 2033-C : cellules saisies (réévaluation, ventilation des diminutions, composants) | D-134 | (ce commit) |

## Restes explicites (ordre de travail)
1. ~~2059-A à D~~ FAIT (D-121, D-122).
2. ~~2065~~ page 1 FAIT (D-123), annexe 2065 bis FAITE (D-131) ; restes : cases à cocher, identification, liquidation.
3. ~~Import XLSX~~ FAIT (D-124) ; composants par import FAIT (D-125).
4. **Restes des séries 2033 et 2058** (la série 2033 n'est PAS déclarée complète) : formule du revenu brut social (cadre IV du 2033-D saisi seulement, D-126) ; état papier joint lui-même (lignes d'état joint saisies, D-128) ; 2058-B libellés de nature des provisions et cellules sans code (feuillets 2058-A et K4 bis saisis, D-133) ; cadre « méthode par composants » du 2058-B ; cases à cocher du 2065 ; en attente de vérification : CI et défaut WebKit (une seule lecture groupée après le reset du quota GitHub, 2026-11-22 07:03 UTC environ).
5. Restes antérieurs : renvois des tableaux 2050, 2051, 2054, 2055, 2033-A, scission biens / services des comptes 70 (convention à valider), détail (8) des exercices antérieurs du 2053.

## Sources officielles (SHA-256 vérifiés, millésime 2026)
- `2050-liasse_5320.pdf` (régime réel normal) : 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1, URL `https://www.impots.gouv.fr/sites/default/files/formulaires/2050-liasse/2026/2050-liasse_5320.pdf`.
- `2033-sd_5394.pdf` (régime simplifié) : ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb, `…/formulaires/2033-sd/2026/2033-sd_5394.pdf`.
- Notices `2032-not-sd_5323.pdf` (68ac608323f7dfca3fa86606856f115db800a20c5cb7c0505d69f56c50f26f39) et `2033-sd_5395.pdf` (b0a4352237d3ef279a87…7a6d1).
- Méthode de vérification : extraction de texte positionnée (pdf.js, `pdfjs-dist` du dépôt) puis rendu image des pages dans le navigateur (serveur HTTP local temporaire, pdf.js), codes comparés à l'image. Ce n'est pas une validation professionnelle.

## GitHub : quota et CI
- Le quota de l'API publique GitHub s'est reconstitué (vérifié le 2026-11-22 vers 05:45 UTC : 60/60, sans jeton). **Aucune boucle de surveillance** : lectures ponctuelles seulement (`/rate_limit` ne consomme rien) ; un run complet dure 30 à 40 min.
- **Lecture groupée du 2026-11-22 ~05:45 UTC** (runs des 30 derniers commits) :
  - **Succès** : f2536f6, 533329a, 2106374, a487710, 6a86aa7, 9566172, dbedb6c, 0d735c5, 11c11ed, f7d6981, f4ade36, 73f4de0 (étape des conteneurs d'analyse durcie : un succès est réel).
  - **WebKit `ecrans-cabinet.spec.ts:125`** (échec de f6295b8) : **non reproduit** sur les huit exécutions suivantes (a487710 à f4ade36, toutes vertes) : intermittence probable, cause racine non établie ; le test n'est ni masqué ni assoupli, à surveiller.
  - **81aa858** : échec de l'essai `analyse-conteneur.itest.ts` « arrêt forcé… 30 arrêts » (arrêt n° 28 : moteur bloqué, un conteneur résiduel) : c'est le défaut amont de dockerd déjà connu (P0 PARTIEL), non lié aux livraisons ; runs suivants verts.
  - **ce7e5ca** : échec de `ecrans-cabinet.spec.ts:324` « veille… BOFiP lues » (« Veille NON assurée » attendue « assurée ») : le test dépend de la disponibilité réelle du site BOFiP depuis le runner (réseau externe) ; run suivant (73f4de0) vert. Fragilité signalée, test inchangé.
  - **Échecs de e7ae833 à 048039f** (itest `parcours-detail-resultat` : 404 attendu, 400 reçu pour une ligne inconnue de tableau, lignes 236 et 313) : **régression réelle de mes livraisons D-121 à D-125** (la route acceptait des lignes plus larges) ; **corrigée dans 1c506a3** (D-126) en distinguant les familles de tableaux et en restaurant les 404 historiques. À confirmer sur les runs de 1c506a3 et suivants, en cours de lecture.
- Les « verts » d'étapes `continue-on-error` ne se lisent que par les annotations, jamais par la conclusion.

## Garde-fous et état local
- Données conservées : aucune suppression, aucune purge ; migrations 0050 à 0064 additives. Le disque Colima vide créé par erreur dans `/Volumes/Stockage/colima-dev-home/_lima/_disks/colima/` est **laissé intact** (suppression refusée par le garde-fou, à décider par son propriétaire).
- `scripts/verifier-profil-colima.sh` et `~/.comtaple-outils/env.sh` (LIMA_HOME forcé) protègent les autres projets ; ne jamais lancer `colima start` sans `source ~/.comtaple-outils/env.sh`.
- Dossier fictif de démonstration : « Maison Lefèvre Distribution SAS (fictive) », dossier `1c624aea-e3c7-498e-bce0-bb72b4cf6552`, exercice `c2730848-08de-4ccb-b4e8-ca7d403cc9a0` ; captures dans `var/captures/` ; script `apps/web/tests/reel/captures-fiscal.mjs` (options `--2058a`, `--2058bc`, `--2033d`…).
- Pile locale : API 4000, web 3100 ; reconstruction : `pnpm --filter … run build`, tuer le processus qui écoute sur 4000 / 3100 puis `sh scripts/applis.sh serveur|web`.
- Règle de travail : tests ciblés par lot, une suite complète en CI par livraison cohérente ; aucune validation fiscale présentée comme acquise ; statut « projet » ; rien de partiel présenté comme complet.
