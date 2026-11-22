# État de reprise du chantier P5 (mis à jour le 2026-11-22)

Document de passage pour reprendre le travail sans relire la conversation. À mettre à jour à chaque lot. **Liste unique des exigences (livré / incomplet / dépendance externe) : `exigences.md`.**

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
| 2054 / 2033-C : cellules saisies (réévaluation, ventilation des diminutions, composants) | D-134 | 4122ef6 |
| Renvois des bilans 2050, 2051 et 2033-A | D-135 | 80ec17b |
| 2053 : détails (7) et (8) | D-136 | e74241c |
| 2065 : options (cases à cocher), comptabilité informatisée, activités | D-137 | (ce commit) |

## Restes explicites (ordre de travail)
1. ~~2059-A à D~~ FAIT (D-121, D-122).
2. ~~2065~~ page 1 FAIT (D-123), annexe 2065 bis FAITE (D-131) ; restes : signatures (jamais), liquidation (options D-137 et identification D-140 saisies).
3. ~~Import XLSX~~ FAIT (D-124) ; composants par import FAIT (D-125).
4. **Restes des séries 2033 et 2058** (la série 2033 n'est PAS déclarée complète) : (revenu brut social calculé si tout est saisi, D-141) ; état papier joint lui-même (lignes d'état joint saisies, D-128) ; (2058-B libellés et composants FAITS, D-139) ; cadre « méthode par composants » du 2058-B ; signatures et liquidation du 2065 ; en attente de vérification : CI et défaut WebKit (une seule lecture groupée après le reset du quota GitHub, 2026-11-22 07:03 UTC environ).
5. Restes antérieurs : (les tableaux 2054 et 2055 ne portent pas de renvois ; renvois 2050, 2051 et 2033-A FAITS, D-135), scission biens / services des comptes 70 (convention à valider), détail (8) du 2053 FAIT (D-136).

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

## Essai de restauration (2026-11-22)
ÉCHEC conservé : journal Alpha (historique, D-038) et 1 874 lignes de fixtures d'essai sans objet (D-144) ; fixtures corrigées pour l'avenir ; restauration stricte réussie sur base et stockage neufs cohérents : démontrée (D-145, `scripts/demo-restauration-stricte.mjs`, contrôle négatif inclus).

## Garde-fous et état local
- Données conservées : aucune suppression, aucune purge ; migrations 0050 à 0064 additives. Le disque Colima vide créé par erreur dans `/Volumes/Stockage/colima-dev-home/_lima/_disks/colima/` est **laissé intact** (suppression refusée par le garde-fou, à décider par son propriétaire).
- `scripts/verifier-profil-colima.sh` et `~/.comtaple-outils/env.sh` (LIMA_HOME forcé) protègent les autres projets ; ne jamais lancer `colima start` sans `source ~/.comtaple-outils/env.sh`.
- Dossier fictif de démonstration : « Maison Lefèvre Distribution SAS (fictive) », dossier `1c624aea-e3c7-498e-bce0-bb72b4cf6552`, exercice `c2730848-08de-4ccb-b4e8-ca7d403cc9a0` ; captures dans `var/captures/` ; script `apps/web/tests/reel/captures-fiscal.mjs` (options `--2058a`, `--2058bc`, `--2033d`…).
- Pile locale : API 4000, web 3100 ; reconstruction : `pnpm --filter … run build`, tuer le processus qui écoute sur 4000 / 3100 puis `sh scripts/applis.sh serveur|web`.
- Règle de travail : tests ciblés par lot, une suite complète en CI par livraison cohérente ; aucune validation fiscale présentée comme acquise ; statut « projet » ; rien de partiel présenté comme complet.

## Point du 2026-11-22 (suite)
- Restauration stricte démontrée sur base et stockage neufs (D-145, `scripts/demo-restauration-stricte.mjs`) ; base historique toujours en échec strict (D-144), inchangée.
- État joint : 2054, 2055 A, 2033-C I/II repris de l'API (D-146).
- WebKit `ecrans-cabinet.spec.ts` : correctif d'hydratation poussé (4e9b230, D-147), **à confirmer par UNE lecture groupée de CI** (runs c1c31c4, 10cd7a2, 4e9b230), sans boucle.

## Point du 2026-11-22 (après-midi)
- Parcours de bout en bout non nul (D-148) : `scripts/demo-parcours-immobilisations.mjs` (preuve : écran, CSV, PDF) et test réel `parcours-immobilisations.spec.ts` ; intitulé « import CSV ou XLSX » corrigé.
- Liste unique des exigences : `exigences.md` (livré / incomplet / dépendance externe) ; isolation et fin de contrat remises à jour.
- CI (D-149) : flaky `assistant.test.ts` corrigé (cause confirmée) ; WebKit `fiscal.spec.ts` : correctif d'hydratation, cause NON confirmée. Runs c1c31c4, 4e9b230, ecd40cb et ceux d'après : à lire UNE fois quand ils seront terminés.
- Dossier de démonstration à ouvrir : voir la sortie du script (`{"dossier":…,"exercice":…}`), lien `http://localhost:3100/dossiers/<dossier>/fiscal?vue=liasse`.

## Point du 2026-11-22 (soir) — D-150, D-151
- Dégressif : déclaration justifiée par écrit du cabinet (colonne `justification_degressif`, migration 0070 appliquée à la base locale), abstention sans justification, exemple fictif `scripts/demo-degressif.mjs`. Activation par l'éditeur inchangée (faux par défaut). Texte de l'art. 39 A toujours non lu (Légifrance 403).
- Compteur CI des conteneurs : 16 réussites sur 16 atteintes, défaut dockerd NON clos (D-151). Instabilité des navigateurs en CI (WebKit, Firefox) = reste principal de la ligne 12 ; correctifs d'attente appliqués, causes non confirmées.
- Prochain reste réel de la ligne 5 : vérification visuelle des codes de cases 2054 / 2055 / 2033-C, puis reports 2059-A → 2058-A.

## Point du 2026-11-22 (nuit) — D-152, D-153, D-154
- Codes 2054 / 2055 A / 2033-C vérifiés sur le rendu image : aucun écart (D-152). Reports 2059 → 2058-A : WN proposée, WV / WH / WP / I6 rapprochés, rien décidé (D-153). Feuillets 2056 et 2057, rapprochement 2057 / bilan sur 4 postes (D-154, migration 0071 appliquée à la base locale).
- Preuves : `scripts/demo-reports-feuillets.mjs`, `parcours-reports-feuillets.spec.ts`, captures `var/captures/reports-*.png`. Compteur CI des conteneurs : fenêtre bornée des 35 derniers runs (81aa858 a échoué avant).
- Prochain reste réel : codes des autres tableaux (relecture sur rendu), note annexe 2059-A ligne 20, reports 2059-B/C/D, état détaillé des charges à payer.

## Point du 2026-11-22 (fin de nuit) — D-155 à D-158
- Codes de cases vérifiés sur le rendu : 2051 (32), 2052 (43), 2053 (8), actif du 2050 (31, deux codes brut / amortissements), 2033-A (31 : actif et passif) — lignes encore sans code : 12 au 2050 (sous-totaux, totaux, lignes regroupées), 3 au 2051, 2 au 2052, 1 au 2033-A (D-155, D-156).
- Note annexe de la ligne 20 du 2059-A (D-157, migration 0072). Migrations jouées sur la base locale : jusqu'à 0072. Piège : toute migration se crée par `drizzle-kit generate --custom` (entrée de journal), jamais à la main.
- CI : deuxième lecture (D-158) ; c9c932f et a769790 verts ; échecs Firefox / WebKit de même famille, attentes ajoutées, causes non confirmées ; runs 82a9514 → cbb535c et fcbb825 à lire une fois terminés.
- Prochains restes réalisables : en-têtes cochables des 2059-B, C, D ; totaux de l'actif du 2050 (numérotation à trancher) ; état détaillé des charges à payer seulement si une source accessible l'énonce (Légifrance refuse l'accès).

## Point du 2026-11-22 (matin) — D-159 à D-163
- **Livrable à rejouer** : `node scripts/livrable-demo.mjs` (pile locale démarrée : `scripts/applis.sh demarrer`) → `var/livrables/demo/` (PDF 16 pages, CSV, captures, LISEZ-MOI avec liens). C'est le parcours utilisable de bout en bout ; il ne vaut ni validation professionnelle ni connexion externe.
- Cause produit probable des échecs de navigation CI trouvée et corrigée : `<div>` / `<ul>` dans `<p>` → erreur d'hydratation (D-159) ; diagnostic de navigation et garde-fou d'hydratation dans `tests/reel/base.ts`. À confirmer par les prochains runs (CI non relue depuis D-158).
- Faits : en-têtes cochables 2059-B et rappels 2059-C (D-160, migration 0073) ; total (II) / (III) du 2050 (D-161) ; arrêt brutal pendant les contrôles prouvé (D-162).
- Reste réel indépendant, par impact : relecture de la CI (confirmer D-159) ; arrêt brutal pendant la génération d'un export (non mesuré) ; codes de cases des autres tableaux (2054 bis, 2055 B et C, 2058, 2059, 2065) ; reports 2059-B/C/D. Tout le reste de `exigences.md` est une dépendance externe ou le défaut dockerd non clos.

## Point du 2026-11-22 (midi) — D-164
- Reports notice entre 2059-B, 2059-D, 2058-A et 2051 faits (D-164) ; aucun report énoncé pour le 2059-C. Parcours D-163 rejoué, inchangé (`node scripts/livrable-demo.mjs`).
- **CI rouge expliquée (étape « Parcours de bout en bout »)** de 69dbb44 à d2dc92e : deux tests d'intégration périmés par mes changements (`parcours-fiscal` : « aucune ligne n'a de code » ; `parcours-detail-resultat` : cadres du 2059-B / C retrouvés par rang). Corrigés en f40a979 et d8a26bf ; relire la CI pour confirmer. Leçon : lancer les itests des tableaux touchés AVANT chaque push (fait ensuite).
- Reste réel : relecture de la CI (confirmer D-159 et ces corrections) ; arrêt brutal pendant la génération d'un export (non mesuré) ; relecture sur rendu des codes des autres tableaux ; sous-totaux du 2050 sans code. Le reste est externe.

## État compact (2026-11-22, après D-167) — à lire en premier
- **Rejouable** : `node scripts/livrable-demo.mjs` (parcours dossier fictif → XLSX → liasse → PDF/CSV) ; `node scripts/demo-reports-feuillets.mjs` (reports, feuillets, rapprochements 2057 dont les six de D-167). Pile : `scripts/applis.sh demarrer` puis `scripts/applis.sh web` ; après un changement de `packages/core` : build core puis api.
- **Fait depuis D-164** : exports interrompus (verrou, rattrapage, migration 0074, D-165) ; audit des codes de cases (D-166) ; relecture des 44 lignes « (externe) » avec preuve (section de `exigences.md`) ; cadres saisissables jamais « non préparés » ; charge de trois cabinets × ~100 000 lignes simultanés (`rapport-de-tests.md`, aucun défaut produit).
- **Restes réels locaux** : sous-totaux du 2050 sans code (abstention délibérée) ; « produits finis »/« en-cours » ambigus ; charge : lots de centaines de dossiers et plusieurs workers non mesurés ; état détaillé des charges à payer (source Légifrance inaccessible). Tout le reste est externe (validation professionnelle, IA réelle, connexions, appareils, hébergeur, cible).
- **CI** : lire UNE FOIS, groupée, les runs de 72b3aa1 et suivants ; confirmer D-159 (hydratation) et les corrections de tests périmés. Jamais de boucle d'attente.
- **Garde-fous** : restauration STRICTE inchangée ; défaut dockerd non masqué ; Légifrance 403 jamais contourné ; aucune règle de calcul inventée ; données historiques conservées.

## Point du 2026-11-22 (après-midi) — D-168 à D-171
- **Fait** : lots multi-dossiers × trois workers (D-168) ; ventilation `2050_STOCKS` puis REPRISE explicite dans les cases BN à BS, écran / état joint / CSV / PDF concordants (D-169, D-170, migration 0075) ; protocole d'entrée à crédit worker ↔ analyseurs (D-171, 34/34 essais conteneurs contre le moteur Colima, défaut dockerd NON clos, production non activée).
- **Colima** : `source ~/.comtaple-outils/env.sh; unset LIMA_HOME` avant `colima status` / `docker` (sans cela « colima is not running » est trompeur). Image d'analyse reconstruite : `docker build --target analyse -t comtaple-analyse:dev .`.
- **CI** : le test de reprise d'export (`parcours-reprise-worker`) a échoué sur 72b3aa1 puis sur 5dd7e34 ; cause de la seconde : les workers des essais précédents du même fichier restaient vivants et généraient l'export en quelques ms ; correctif : tous les workers du fichier sont tués avant la demande, état « en cours » simulé (ce n'est PAS un SIGKILL réel en pleine génération). À relire UNE fois.
- **Restes locaux** : sous-totaux du 2050 sans code ; état détaillé des charges à payer (contenu non publié dans les sources accessibles, BOFiP lu = version périmée) ; charge au-delà de 12 dossiers simultanés / un poste ; `limite-volume.itest.ts` échoue localement au nettoyage final (délai de 10 s, base locale volumineuse).

## Point du 2026-11-22 (soir) — D-172, D-173
- Recette d'usage par l'interface de la ventilation 2050 (`parcours-ventilation-2050-ui.spec.ts`), crédits malformés ou excessifs éprouvés (D-172) ; **plus aucun « reste indéfini » de codes au 2050 / 2051 / 2052** : 16 lignes avec nature écrite (D-173).
- **Livraison rejouable** : `node scripts/livrable-demo.mjs` (pile locale démarrée) → `var/livrables/demo/` : deux PDF et deux CSV, captures, `LISEZ-MOI.txt` et `LISEZ-MOI-ventilations-2050.txt` (liens et marche à suivre).
- Restes réels : état détaillé des charges à payer (source actuelle inexploitable) ; charge au-delà de 12 dossiers simultanés / un poste ; dépendances externes (validation professionnelle, IA réelle, connexions, appareils, hébergeur, cible).
