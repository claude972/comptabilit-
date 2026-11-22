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
| Import XLSX des immobilisations | D-124 | (ce commit) |

## Restes explicites (ordre de travail)
1. ~~2059-A à D~~ FAIT (D-121, D-122).
2. ~~2065~~ page 1 FAIT (D-123) ; restes : annexe 2065 bis-SD, cases à cocher, identification.
3. ~~Import XLSX~~ FAIT (D-124) ; reste : rattachement de composants (`composantDe`) par import.
4. **Restes des séries 2033 et 2058** : cadre IV du 2033-D (690 à 693), dates du 2033-E (024, 016, cessation), tableaux supplémentaires des 2033-F et G (et 2059-F et G), états joints du cadre III du 2033-C (> 10 cessions) et du cadre C du 2033-D (> 7 lignes), feuillet des déficits transférés de plein droit ; 2058-A : feuillets joints ; 2058-B : libellés de nature des provisions, cellules sans code du cadre « méthode par composants » ; 2058-C : rapprochement de ZJ et YX avec les lignes FW et FX du 2052.
5. Restes antérieurs : 2054 (réévaluation, ventilation des diminutions, composants), 2056, 2057, renvois des tableaux 2050, 2051, 2054, 2055, 2033-A, scission biens / services des comptes 70 (convention à valider), détail (8) des exercices antérieurs du 2053.

## Sources officielles (SHA-256 vérifiés, millésime 2026)
- `2050-liasse_5320.pdf` (régime réel normal) : 0bba33528b893ba8aa581d97bbc6ddb7d59a78fdbc234920596bce228f8453e1, URL `https://www.impots.gouv.fr/sites/default/files/formulaires/2050-liasse/2026/2050-liasse_5320.pdf`.
- `2033-sd_5394.pdf` (régime simplifié) : ce4c519097fa435e9bd0ca3956016e5e05321c6f07db341285c9f46fb177b6cb, `…/formulaires/2033-sd/2026/2033-sd_5394.pdf`.
- Notices `2032-not-sd_5323.pdf` (68ac608323f7dfca3fa86606856f115db800a20c5cb7c0505d69f56c50f26f39) et `2033-sd_5395.pdf` (b0a4352237d3ef279a87…7a6d1).
- Méthode de vérification : extraction de texte positionnée (pdf.js, `pdfjs-dist` du dépôt) puis rendu image des pages dans le navigateur (serveur HTTP local temporaire, pdf.js), codes comparés à l'image. Ce n'est pas une validation professionnelle.

## GitHub : quota et CI
- L'API GitHub a atteint sa limite (HTTP 403) à cause de surveillances par boucle ; réinitialisation à l'instant epoch 1795323833 (≈ 2026-11-22 07:03 UTC). **Aucune boucle de surveillance** ; faire UNE lecture groupée (`/actions/runs?per_page=15` puis annotations des jobs en échec) après le reset.
- Verts, annotations lues : 533329a, 2106374, f2536f6 (étape des conteneurs d'analyse durcie réellement verte une fois).
- **Défaut non résolu** : CI de f6295b8 en échec sur WebKit, test `ecrans-cabinet.spec.ts:125` « règle : proposée par la collaboratrice … effet visible dans la révision » (`origine-parametres` de la ligne `TIE-001` introuvable après 120 s). Intermittence ou défaut réel : non tranché ; à diagnostiquer sur les runs suivants (a487710 et après), sans masquer le test.
- Sans verdict connu : a487710, 6a86aa7, 81aa858, 9566172, dbedb6c, 0d735c5, 11c11ed, f7d6981, f4ade36, ce7e5ca.
- Les « verts » d'étapes `continue-on-error` ne se lisent que par les annotations, jamais par la conclusion.

## Garde-fous et état local
- Données conservées : aucune suppression, aucune purge ; migrations 0050 à 0056 additives. Le disque Colima vide créé par erreur dans `/Volumes/Stockage/colima-dev-home/_lima/_disks/colima/` est **laissé intact** (suppression refusée par le garde-fou, à décider par son propriétaire).
- `scripts/verifier-profil-colima.sh` et `~/.comtaple-outils/env.sh` (LIMA_HOME forcé) protègent les autres projets ; ne jamais lancer `colima start` sans `source ~/.comtaple-outils/env.sh`.
- Dossier fictif de démonstration : « Maison Lefèvre Distribution SAS (fictive) », dossier `1c624aea-e3c7-498e-bce0-bb72b4cf6552`, exercice `c2730848-08de-4ccb-b4e8-ca7d403cc9a0` ; captures dans `var/captures/` ; script `apps/web/tests/reel/captures-fiscal.mjs` (options `--2058a`, `--2058bc`, `--2033d`…).
- Pile locale : API 4000, web 3100 ; reconstruction : `pnpm --filter … run build`, tuer le processus qui écoute sur 4000 / 3100 puis `sh scripts/applis.sh serveur|web`.
- Règle de travail : tests ciblés par lot, une suite complète en CI par livraison cohérente ; aucune validation fiscale présentée comme acquise ; statut « projet » ; rien de partiel présenté comme complet.
