# Passerelle IA interne — `@comtaple/ia`

État au **2026-11-19** : paquet écrit et testé contre un **SIMULATEUR**. **Aucun jeton d'IA n'existe : aucun appel de
génération n'a jamais été fait sur le service réel.** Le paquet est branché dans l'API, le worker et l'interface
(section 10), dans l'état réel `non_connecte` : les fonctions marchent en mode « sans IA », étiqueté comme tel, et le
chemin « modèle » n'est exercé que contre le simulateur, dans les tests.

## 1. Principe

Le moteur déterministe calcule ; l'IA classe, extrait, recherche, explique et rédige. Tout ce que produit un modèle est
une **proposition** soumise à des vérifications faites par du code, puis à une validation humaine. Le paquet ne contient
que des fonctions pures et des ports injectés : ni base de données, ni NestJS, ni file de tâches.

```
appelant (API / worker)
   │  contexte imposé (cabinet, dossier, utilisateur) + données minimisées
   ▼
tâche (src/taches/*, src/assistant/*)      prompt versionné, schéma Zod d'entrée et de sortie
   │
   ▼
PasserelleIa (src/passerelle.ts)           point de passage UNIQUE
   │  1. pseudonymisation (jetons ⟦TYPE_n⟧)        4. validation JSON + schéma
   │  2. modèle figé imposé                         5. garde-fou déterministe de la tâche
   │  3. appel du fournisseur, mesure               6. trace d'audit sans contenu
   ▼
FournisseurIa (port)  ──►  FournisseurOvh (réel, fetch)   ou   SimulateurIa (SIMULATEUR de test)
```

| Répertoire | Contenu |
|---|---|
| `src/passerelle.ts`, `fournisseur*.ts`, `statut.ts`, `audit.ts`, `pseudonymisation.ts` | passerelle, port, adaptateur réel, statuts, audit, pseudonymisation |
| `src/garde-fous/` | chiffres, citations mot pour mot, repérage réglementaire, délimitation des contenus non fiables |
| `src/taches/` | `classerPiece`, `suggererRapprochements`, `analyserLettreMission`, `commenterIndicateurs`, `expliquerConstat` |
| `src/assistant/` | `repondreQuestion`, `repondreSansIa`, fonctions métier (liste blanche) |
| `src/recherche/` | découpage en passages, embeddings par lots, fusion RRF |
| `src/evaluation/` | harnais `evaluer` et corpus synthétique versionné (`@comtaple/ia/evaluation`) |
| `src/simulateur/` | `SimulateurIa` (`@comtaple/ia/simulateur`, jamais exporté par l'entrée principale) |

## 2. Modèles figés

| Usage | Identifiant | Paramètres imposés |
|---|---|---|
| Langage | `Mistral-Small-3.2-24B-Instruct-2506` | température 0, 2048 jetons de sortie au plus |
| Embeddings | `bge-m3` | 1024 dimensions |

Aucun alias. L'appelant ne choisit jamais le modèle. Si le fournisseur répond en annonçant un autre modèle, la réponse
est refusée (`modele_inattendu`) ; si les vecteurs n'ont pas 1024 dimensions, idem (`vecteurs_invalides`).
Changer de modèle = modifier `src/modeles.ts`, refaire l'évaluation, ré-indexer tous les vecteurs.

## 3. Statuts

`PasserelleIa.statut()` renvoie quatre valeurs jamais confondues :

| Statut | Signification |
|---|---|
| `non_connecte` | aucun fournisseur configuré (URL ou jeton absent). Toute tâche renvoie « IA indisponible » et son repli. |
| `configure_non_verifie` | URL et jeton présents, aucun appel réel réussi constaté (ou preuve invalide). |
| `connecte` | `verifierConnexion()` a réussi une complétion **et** un embedding sur l'hôte officiel `oai.endpoints.kepler.ai.cloud.ovh.net` (https, port par défaut), avec les deux modèles figés, 1024 dimensions, et sans marque de simulateur. |
| `simule` | le fournisseur est le SIMULATEUR. Ne peut **jamais** devenir `connecte`, même avec une preuve forgée. |

`connecte` atteste que le service répond. Il ne dit **rien** de la qualité du modèle sur les tâches métier.
La preuve (`PreuveConnexionIa`) est à conserver par l'intégrateur et à repasser au constructeur (`preuveConnexion`) ou
à `retenirPreuve()` ; elle est réévaluée à chaque lecture du statut (autre URL de base → `configure_non_verifie`).
Dans l'application, elle est persistée et relue de la base : voir 10.8.

## 4. Garde-fous (tous vérifiés par code et testés)

| Règle | Mise en œuvre |
|---|---|
| Les chiffres viennent des données | `verifierNombres` : tout nombre d'un texte produit par le modèle doit figurer dans les faits fournis (forme canonique, sans flottant). Strict : un arrondi ou un nombre recalculé est refusé. Commentaire d'indicateurs et explication de constat : rejet. Rapprochements : l'explication est retirée et signalée. Assistant : le segment est écarté. |
| Jamais de source inventée | Une citation ne peut désigner qu'un identifiant renvoyé par une fonction pendant la réponse (registre de session) ; un type ou un dossier doit appartenir aux listes fournies ; un extrait doit se retrouver mot pour mot (`extraitPresent`). Sinon rejet. |
| Scores | `Confiance.statut` vaut toujours `non_evaluee` ; l'auto-évaluation du modèle est exposée comme `indiceModele` avec la mention « ce n'est pas une probabilité ». Chaque tâche peut s'abstenir. |
| Confidentialité | Pseudonymisation systématique dans la passerelle (IBAN, e-mails, téléphones, SIRET, SIREN, TVA, noms fournis) ; restauration locale. Minimisation : texte de pièce tronqué à 6 000 caractères, contenu d'un élément de l'assistant à 1 500, 20 éléments par appel. Aucune fonction ne lit une boîte mail ni un fil entier. |
| Contenus non fiables | Toujours dans un bloc `<<<DONNEES nom>>> … <<<FIN_DONNEES nom>>>` (séquences `<<<` / `>>>` neutralisées), jamais dans le message système. La protection réelle vient des contrôles **après** la réponse. |
| Aucun outil libre | Le modèle ne peut demander que des `FonctionMetier` de la liste blanche passée par l'appelant. Toute clé d'argument non déclarée est refusée (pas de `sql`, pas de `code`). Les fonctions types sont en lecture seule. |
| Contexte imposé | Cabinet et utilisateur ne sont jamais des arguments : leur présence fait refuser l'appel (`changement_de_contexte_refuse`). `dossierId` doit appartenir au périmètre, `periode` y être incluse. Les éléments renvoyés par une fonction pour un dossier hors périmètre sont écartés. |
| Habilitations | Port `Habilitations.autoriser` appelé avant **chaque** exécution, en mode IA comme sans IA. |
| Affirmation réglementaire | Segment déclaré `reglementaire` ou repéré par motifs : exige une citation de nature `source_officielle`, sinon le point est écarté et listé dans `abstentionsPartielles`. |
| Liens | Une URL absente des références des sources citées fait écarter le segment (pas de lien d'exfiltration). |
| Panne | La passerelle ne lève jamais pour une panne : `indisponible`. Chaque tâche renvoie `ia_indisponible` avec son repli déterministe étiqueté s'il existe ; l'assistant bascule sur `repondreSansIa`. |
| Audit | Chaque appel de modèle (`appel_ia`) et chaque appel ou refus de fonction (`fonction_metier`) produit une trace **sans contenu** : tâche, prompt (id, version), modèle, tailles, SHA-256 du prompt pseudonymisé, durée, jetons, coût estimé, résultat `ok` / `abstention` / `rejet` / `erreur`, codes. |

Replis déterministes : `classerPiece` (rattachement par indice exact, type « à qualifier »), `commenterIndicateurs`
(restitution par gabarit), `expliquerConstat` (message du moteur), assistant (`repondreSansIa`). `suggererRapprochements`
et `analyserLettreMission` n'ont pas de repli (`repli: null`) : le rapprochement déterministe relève du moteur, et une
lettre se saisit à la main.

## 5. Ce qui est simulé, connecté, à valider

| Élément | État |
|---|---|
| `FournisseurOvh` (adaptateur réel) | Écrit d'après la documentation. Testé contre un HTTP injecté et le simulateur. **Jamais exercé contre OVHcloud.** |
| `SimulateurIa` | SIMULATEUR : rejoue des réponses écrites à la main. Ses embeddings sont un hachage de mots, sans valeur sémantique. |
| Tâches, assistant, garde-fous | Testés contre le simulateur (92 tests). Comportement du modèle réel inconnu. |
| Évaluation | Corpus **synthétique**. Tout rapport porte la mention « mesuré contre un SIMULATEUR : ne dit rien de la qualité du modèle réel ». |
| Coût estimé | Calcul exact (entiers) à partir de tarifs **passés en configuration et datés** (`TarifsIa`). Le code n'embarque aucun tarif. Sans tarif ou sans décompte de jetons : `null`. |
| Intégration (API, worker, interface, tables d'audit, pgvector) | Faite, dans l'état `non_connecte` (section 10). Chemin « modèle » : testé contre le simulateur avec les ports réels, jamais contre un modèle réel. |

## 6. Vérifications sur la documentation officielle OVHcloud (2026-11-19)

« Vérifié » = la page officielle l'énonce, ou la liste publique des modèles le montre. Cela ne vaut pas observation en
appel réel. Seul appel émis vers OVHcloud : un `GET /v1/models` anonyme (liste publique, sans compte ni coût).

| # | Affirmation | Source | État |
|---|---|---|---|
| O1 | Identifiants exacts `Mistral-Small-3.2-24B-Instruct-2506` et `bge-m3` | `GET https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models` (33 modèles listés) | Vérifié |
| O2 | URL de base `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1`, route `/chat/completions`, jeton en `Authorization: Bearer` | guides « Function calling » et « Structured output » (docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-function-calling, …-structured-output) | Vérifié |
| O3 | Appel de fonctions : `tools: [{type:"function", function:{name, description, parameters}}]` ; `tool_choice` = `auto`, `required`, `none` ou fonction nommée ; réponse `message.tool_calls[{id, type, function:{name, arguments}}]`, `arguments` étant une chaîne JSON ; message de retour `role:"tool"` avec `tool_call_id`, `name`, `content` ; plusieurs appels possibles par réponse ; `parallel_tool_calls: false` non pris en charge | guide « Function calling » | Vérifié (exemples donnés avec un autre modèle) |
| O4 | Sortie structurée : `response_format: {type:"json_schema", json_schema:{name, schema}}` ; `json_object` est un mode ancien sans schéma ; seul un sous-ensemble de JSON Schema est accepté ; conseil `additionalProperties: false` et champs requis explicites ; clés générées par ordre alphabétique | guide « Structured output » | Vérifié (exemples donnés avec un autre modèle) |
| O5 | Limites : 400 requêtes/minute par projet et par modèle avec jeton, 2/minute en anonyme, `429` au-delà ; 2 Mo par corps de requête | docs.ovhcloud.com/…/ai-endpoints-capabilities (mise à jour le 10 novembre 2026) | Vérifié |
| O6 | « Data is not stored or shared during or after model use » ; infrastructure « hosted in Europe » | même page | Vérifié comme **déclaration de la documentation**, pas comme engagement contractuel |
| O7 | Prise en charge de l'appel de fonctions par Mistral Small 3.2 ; contexte de 128K | fiche catalogue du modèle | **Partiel** : lu dans un extrait de moteur de recherche, la fiche n'a pas pu être lue directement |
| O8 | `bge-m3` : 1024 dimensions, 8192 jetons, 25 textes au plus par appel | fiche catalogue | **Partiel** : même réserve. `TAILLE_LOT_EMBEDDINGS = 25` en découle |
| O9 | Route `/embeddings` au format OpenAI (`input`, `data[].embedding`, `data[].index`) | — | **Non vérifié** sur une page officielle (déduit de la compatibilité OpenAI annoncée) |
| O10 | Sortie structurée par schéma acceptée par Mistral Small 3.2 ; champ `strict: true` accepté (le guide ne le mentionne pas, l'adaptateur l'envoie) | — | **Non vérifié** |
| O11 | `tool_choice: "required"` combiné à plusieurs fonctions avec ce modèle ; qualité des arguments produits | — | **Non vérifié** |
| O12 | Valeur exacte du champ `model` dans les réponses (la passerelle exige l'identifiant figé, casse indifférente) ; présence de `usage.prompt_tokens` / `completion_tokens` ; nom du paramètre `max_tokens` | — | **Non vérifié** : un écart rendrait la passerelle `indisponible` (`modele_inattendu`) dès `verifierConnexion`, sans dégât |
| O13 | Tarifs | fiche catalogue | **Non vérifié** par ce travail (fiche illisible par l'outil). Aucun tarif n'est codé |
| O14 | Région exacte de traitement, durée de conservation des requêtes et journaux, non-réutilisation pour l'entraînement **au contrat** | Conditions particulières Public Cloud (annexe AI Endpoints) | **Non vérifié** : document non lu |

## 7. Procédure d'activation

Aucune tâche ne doit être confiée au modèle avant la fin de cette procédure.

1. **Vérifications contractuelles préalables**, par écrit, sur les conditions applicables au compte (et non sur les pages
   commerciales) : région de traitement ; conservation des requêtes, réponses et journaux ; **non-réutilisation des
   données clients pour l'entraînement ou l'amélioration des modèles** ; sous-traitants ; qualification au regard du RGPD
   et du secret professionnel. Le code ne peut pas garantir ces points : c'est une exigence contractuelle.
2. Mise à jour du registre des traitements et de l'information des cabinets.
3. Création du jeton AI Endpoints par une personne habilitée ; `IA_OVH_ENDPOINT` et `IA_OVH_JETON` dans le coffre de
   secrets (jamais dans le dépôt). `creerFournisseurOvhDepuisEnv` renvoie `null` tant que l'un manque.
4. Vérification par l'éditeur : `node scripts/editeur.mjs ia-verifier --appel-reel` (deux appels RÉELS : une complétion
   de quelques jetons, un vecteur). Le résultat est enregistré dans `verifications_connexion_ia` ; le statut passe à
   `connecte` dans l'API et le worker en moins d'une minute s'ils ont la même configuration. Sinon lire les raisons
   affichées (points O9 à O12). La preuve vaut `IA_PREUVE_VALIDITE_JOURS` jours (30 par défaut) : voir 10.8.
5. Relevé des tarifs sur le catalogue, daté, passé en `TarifsIa`.
6. **Évaluation sur corpus métier réel**, par tâche, avec `evaluer(tache, jeu, fournisseurReel)` sur un corpus constitué
   et annoté par des professionnels, sur des données autorisées. Fixer par tâche un seuil d'exactitude et un taux de
   rejet acceptables **avant** de regarder les résultats. Le corpus synthétique fourni ne suffit pas.
7. Activation tâche par tâche, derrière un réglage par cabinet, en commençant par les tâches à repli déterministe.
8. Suivi : taux de rejet et d'abstention par tâche et par version de prompt (traces d'audit), coût estimé, échantillon
   relu par un humain. Toute modification d'un prompt change sa version (test d'empreinte) et relance l'évaluation.

## 8. Ce que l'intégrateur doit fournir

- `JournalAuditIa.consigner` : écriture des `EvenementAuditIa` dans une table d'audit (aucun contenu n'y figure).
- La preuve de connexion persistée, et les `TarifsIa`.
- `VerifierSuggestion` : `(s) => verifierSuggestion(s, mouvements, ecritures, parametres)` de `@comtaple/core`.
- `Habilitations.autoriser` et les `PortsFonctionsMetier` (requêtes filtrées par `cabinetId`, `dossierId`, `periode` du
  `ContexteFonction`, sous RLS) ; les identifiants d'`ElementSource` doivent être ceux de l'application.
- Le périmètre imposé (`PerimetreImpose`) : calculé côté serveur à partir de la session, jamais à partir de la requête.
- Stockage vectoriel : une ligne par `PassageVectorise` — `id`, `documentId`, `index`, `debut`, `fin`, `texte`,
  `empreinte`, `vecteur vector(1024)`, `modele`, `dimensions`, `decoupage` — plus `cabinet_id` et `dossier_id` pour le
  cloisonnement. Ne recalculer un embedding que si `empreinte`, `modele` ou `decoupage` change. Recherche : un classement
  plein texte et un classement vectoriel (`<=>`), fusionnés par `fusionnerClassements`.
- Le texte à vectoriser est pseudonymisé par la passerelle ; le texte stocké reste l'original.

## 9. Limites connues

- **Pseudonymisation par motifs** : un nom absent de la liste fournie, une adresse postale, un numéro mal formé, une
  raison sociale ne sont pas masqués. SIREN et SIRET ne sont reconnus que s'ils satisfont la clé de Luhn. Les jetons
  sont numérotés par appel (ou par réponse de l'assistant) : ils ne sont pas stables d'un appel à l'autre.
- **Garde-fou des chiffres** : ne voit pas un nombre écrit en toutes lettres ; refuse les arrondis (faux rejets
  attendus avec un modèle réel) ; vérifie la présence d'un chiffre dans les faits, pas qu'il est employé à bon escient.
- **Repérage réglementaire** par motifs : une règle énoncée sans aucun marqueur et non déclarée par le modèle passe.
  Le garde-fou vérifie qu'une source officielle est citée, pas qu'elle dit bien ce que le segment affirme.
- **Citations de l'assistant** : le code vérifie que la source existe et que les chiffres s'y trouvent, pas que le
  texte du segment est fidèle à la source. `hypothese` et `interpretation` sont du texte libre du modèle, étiqueté.
  Le motif d'abstention et les données manquantes rédigés par le modèle ne sont filtrés que sur les chiffres et les liens.
- **Injection** : les contrôles empêchent l'appel d'une fonction interdite, le changement de périmètre, les citations
  et liens fabriqués. Ils n'empêchent pas un modèle manipulé de rédiger une interprétation trompeuse à partir de
  sources valides : d'où l'étiquette « à vérifier » et la validation humaine.
- **Mode sans IA** : mots-clés simples, sans compréhension de la question ; il restitue des éléments, il ne répond pas.
- **Découpage** en caractères, non en jetons : 1 200 caractères restent très en deçà de la limite annoncée de `bge-m3`.
- **Coût** : estimation, non facturation. Jetons du simulateur : approximation (caractères / 4).
- Pas de diffusion en flux (`stream`), pas d'images, pas de mémoire de conversation entre deux questions.
- L'ébauche `packages/plateforme/src/passerelle-ia.ts` a été retirée ; la passerelle de l'application est construite par `packages/plateforme/src/ia.ts`.

## 10. Intégration dans l'application (2026-11-19)

### 10.1 Assemblage

| Élément | Où | Rôle |
|---|---|---|
| `creerIa(cfg, bd)` | `packages/plateforme/src/ia.ts` | Construit la `PasserelleIa` à partir de `IA_OVH_ENDPOINT`, `IA_OVH_JETON` et `IA_TARIFS` (JSON de `TarifsIa`, vide par défaut : coût non estimé). Sans jeton : aucun fournisseur, `non_connecte`, aucun appel sortant. |
| `assemblerIa(bd, fournisseur, tarifs)` | idem | Même assemblage sur un fournisseur donné. Hors des tests, seul `creerIa` l'appelle. **Aucune variable de configuration n'active un simulateur** : `SimulateurIa` n'est instancié que dans du code de test (`*.itest.ts`). |
| `ServicesIa.active()` | idem | Passerelle remise aux tâches et à l'assistant : celle du fournisseur seulement si le statut est `connecte` (ou `simule` dans un test) ; sinon une passerelle sans fournisseur. Un fournisseur configuré mais **non vérifié n'est donc jamais sollicité** (procédure d'activation, section 7). |
| `JournalIaBd` | idem | `JournalAuditIa` écrivant dans `evenements_ia` : une ligne par `EvenementAuditIa`, sans contenu. Écritures regroupées en arrière-plan ; `vider()` les attend (appelé en fin de requête). |

Correspondance des traces : `nature` vaut `reel`, `simulateur` ou `sans_ia` (aucun fournisseur, ou fonction métier exécutée
en mode sans IA) ; `resultat` vaut `ok` / `abstention` / `rejet` / `erreur` pour un appel de modèle, `indisponible` quand
aucun fournisseur n'existe, `executee` / `refusee` / `erreur` pour une fonction métier. `mesures` ne porte que des tailles,
des décomptes, le nom de la fonction et la référence du prompt.

### 10.2 Routes de l'API

| Route | Habilitation | Comportement aujourd'hui (sans IA) |
|---|---|---|
| `POST v1/dossiers/:id/assistant/questions` `{ question, exerciceId? }` | niveau `lecture` sur le dossier, vérifié avant toute recherche (404 si le dossier n'est pas visible, 403 en dessous) | `repondreQuestion` bascule sur `repondreSansIa` : réponse `mode: "sans_ia"`, `iaIndisponible.code = "non_connecte"`. Renvoie `{ echangeId, echangeEnregistre, mode, exercice, reponse, ia }`. Question de 3 à 1 000 caractères, objet strict (aucune clé libre), 20 questions par minute et par utilisateur. |
| `GET v1/dossiers/:id/assistant/questions?page=` | niveau `lecture` | Ses propres échanges, les plus récents d'abord (20 par page). |
| `POST v1/assistant/questions` `{ question, dossierIds?, periode? }` | tout rôle sauf déposant ; au moins un dossier ouvert au niveau `lecture` (403 sinon) | Question sur un PORTEFEUILLE (section 10.9). Renvoie `{ echangeId, echangeEnregistre, mode, perimetre, reponse, ia }`. Même borne de question et même limite de débit que l'assistant d'un dossier. |
| `GET v1/assistant/questions?page=` | idem | Ses propres échanges de portefeuille, FILTRÉS à la lecture selon les habilitations du moment. |
| `GET v1/assistant/perimetre` | idem | Dossiers que l'assistant peut interroger pour la personne, borne par question. |
| `GET v1/ia` | tout membre authentifié ; mesures pour les gestionnaires seulement | Statut, phrase d'état, modèles figés, prompts et versions, tarifs configurés ; `mesures` (par nature, type, tâche, résultat : nombre, durées, jetons, coût estimé) tirées de `evenements_ia`. |
| `POST v1/documents/:id/proposition-classement` | niveau `collaboration` | `classerPiece` → `ia_indisponible` + repli étiqueté (rattachement par indice exact — SIREN ou raison sociale d'un dossier où l'utilisateur est habilité —, type « à qualifier »). |
| `POST v1/constats/:id/explication` | `collaboration` | `expliquerConstat` → repli étiqueté = message du moteur. |
| `POST v1/exercices/:id/indicateurs/commentaire` | `collaboration` | `commenterIndicateurs` sur les indicateurs calculés par `@comtaple/core` → repli étiqueté = restitution par gabarit. |
| `POST v1/lettres/:id/analyse` | `collaboration` | `analyserLettreMission` sur le texte des pages de la pièce jointe à la lettre ; 409 sans pièce jointe, sans texte, ou au-delà de 40 000 caractères. Pas de repli : `ia_indisponible`, `proposition: null`. |
| `POST v1/exercices/:id/rapprochements/suggestions` | `collaboration` | `suggererRapprochements` sur les éléments restés sans rapprochement de la dernière exécution à jour (150 par côté au plus), vérification par `verifierSuggestion` de `@comtaple/core` (côté A = mouvements, côté B = écritures de banque) ; 409 sans exécution terminée. Pas de repli : `ia_indisponible`. |

Chaque tâche renvoie `{ tache, statut, origine, etiquette, proposition, preuves, confiance, avertissements, motif, codes,
propositionId, applique: false, ia }`. `origine` vaut `ia`, `simulateur`, `repli_deterministe` ou `aucune`. Une proposition
(modèle ou repli) est enregistrée dans `propositions_ia` avec `statut = non_examinee` et `confiance = non_evaluee` ; pour un
repli, `modele = "aucun (repli déterministe, sans IA)"` et `version_prompt = "sans-ia"` ; pour le simulateur, le modèle est
préfixé `SIMULATEUR`. **Rien n'est jamais appliqué à la pièce, au constat, à la lettre ni aux rapprochements.**
Chaque question et chaque tâche est aussi tracée au journal d'audit applicatif (`assistant.question`, `ia.tache`), sans
le texte de la question.

### 10.3 Ports de l'assistant (`apps/api/src/assistant.service.ts`)

`poserQuestion(dependances, acces, dossierId, demande)` est appelable sans HTTP ; le contrôleur et les tests appellent la
même fonction. Périmètre imposé : cabinet et utilisateur de l'identité authentifiée, dossier de l'URL validée, période de
l'exercice choisi (à défaut le dernier ; sans exercice, l'année civile en cours et la comptabilité n'est pas interrogée).
Chaque port lit ses données dans `bd.avecContexte(acces, …)` — donc sous RLS, avec l'identité de l'utilisateur — et par
des requêtes à paramètres liés uniquement.

| Port | Données | Identifiant de source |
|---|---|---|
| `rechercherDocuments` | plein texte français « l'un des mots » sur `passages_recherche` ; pour une pièce analysée avant l'indexation, sur `pages_document`. Pièces remplacées ou en quarantaine exclues. Les pièces ne sont pas filtrées par période. | `piece:<document>:p<page>` |
| `rechercherEcritures` | lignes du lot actif de l'exercice, dans la période, plein texte et préfixe de compte | `ecriture:<ligne>` |
| `lireBalance` | agrégation en base (totaux et soldes par compte, 40 comptes au plus) | `balance:<exercice>:<compte>:<début>:<fin>` |
| `calculerIndicateur` | `calculerIndicateurs` de `@comtaple/core` sur l'exercice entier (17 indicateurs proposés) | `indicateur:<exercice>:<id>` |
| `listerConstats` | constats de la dernière exécution terminée des contrôles (20 au plus) | `constat:<id>` |
| `rechercherSourcesReglementaires` | évolutions de la veille à l'état `verifiee`, puis sources vérifiées du catalogue du moteur (`SOURCES`) | `evolution:<id>`, `source:<clé>` |

`Habilitations.autoriser` relit en base le niveau réel de l'utilisateur sur le dossier à chaque appel de fonction.
Recherche hybride : le classement vectoriel n'est calculé et fusionné (`fusionnerClassements`) que si la passerelle est
utilisable **et** que le dossier a des vecteurs de la nature du fournisseur en service ; l'application réelle n'utilise
donc jamais un vecteur de simulateur.

### 10.4 Worker

Après l'analyse d'une pièce (`apps/worker/src/analyse-document.ts`), `apps/worker/src/passages.ts` découpe le texte de
chaque page (`decouperEnPassages`, 1 200 caractères, recouvrement 200) et remplace les passages de la pièce dans
`passages_recherche` (suppression puis insertion dans la transaction de fin d'analyse : idempotent). Les passages de la
version qu'elle remplace sont retirés. `vecteur`, `modele` et `nature_vecteur` restent NULL tant que la passerelle n'est
pas utilisable ; sinon `vectoriserPassages` (une panne laisse le texte indexé, sans vecteur).

### 10.5 Tables

| Table | Écrite par | Lue par | Contenu |
|---|---|---|---|
| `evenements_ia` | API et worker (ajout seul) | gestionnaires du cabinet | traces sans contenu |
| `echanges_assistant` | API | l'auteur seulement | question, mode (`sans_ia`, `simulateur`, `ia`), statut, réponse |
| `echanges_portefeuille` | API (ajout seul) | l'auteur seulement ; contenu filtré à la lecture par l'API | question, mode, statut, dossiers interrogés, `{ perimetre, reponse }` où chaque source porte son dossier |
| `passages_recherche` | worker seulement | API, sous la politique du dossier | texte des passages, vecteur éventuel |
| `propositions_ia` | API | membres habilités du dossier | propositions des tâches, jamais appliquées |

### 10.6 Interface

Page « Assistant » du cabinet (`/assistant`, lien de navigation pour tous les rôles sauf déposant : portefeuille, section
10.9) ; onglet « Assistant » du dossier (bandeau d'état tiré de `GET v1/ia`, exercice, question, réponse structurée, citations,
historique) ; « Proposer un classement » sur la page d'une pièce ; « Expliquer ce constat » sur la page d'un constat ;
`/administration/ia` pour les gestionnaires (état, modèles, mesures).

### 10.7 Ce qui est sans IA, simulé, connecté

| Élément | État |
|---|---|
| Assistant, classement, explication de constat, commentaire d'indicateurs | **Sans IA** en service (repli déterministe étiqueté), testés de bout en bout sur la pile réelle. |
| Analyse de lettre de mission, suggestions de rapprochement | **`ia_indisponible`** en service (aucun repli) ; contrôles d'accès et d'état testés sur la pile réelle. |
| Chemin « modèle » de l'assistant (appels de fonctions, citations, refus d'un modèle manipulé, traces) | **Simulé** : `SimulateurIa` avec les ports réels et la base réelle sous RLS (`apps/api/src/parcours-assistant.itest.ts`). |
| Vecteurs et recherche hybride | **Simulé** : hachage de mots du simulateur (`apps/worker/src/passages.itest.ts`, test d'intégration de l'API). Aucun vecteur réel n'existe. |
| Chemin « modèle » des cinq tâches dans l'API | Non exercé au-delà des tests du paquet (les contrôleurs appellent les mêmes fonctions, mais aucun test d'intégration ne les passe au simulateur). |
| Appel d'un modèle réel | **Jamais fait.** |

### 10.8 Limites de l'intégration

- **Mode sans IA, 40 éléments.** `repondreSansIa` ne restitue que les 40 premiers éléments trouvés et n'annonce pas ceux
  qu'il laisse de côté (ils restent dans `sources`). L'assistant d'un dossier peut donc atteindre ce plafond en silence
  (balance de 40 comptes, par exemple) ; l'assistant de portefeuille l'évite par un décompte par dossier (10.9).

- **Preuve de connexion persistée (2026-11-19), jamais produite par un appel réel.** Table `verifications_connexion_ia`
  (migration 0041), SANS `cabinet_id` : la passerelle est un service de l'éditeur, commun à tous les cabinets. L'API et
  le worker la LISENT ; ni l'un ni l'autre ne peut y écrire (droits en base, testés). Une ligne ne contient ni prompt ni
  réponse : date, résultat (`connecte`, `refusee`, `echec`), URL de base et hôte, adresses appelées, modèles renvoyés,
  dimension, empreinte de la configuration (SHA-256 de l'URL de base, des modèles figés et d'un condensé du jeton), fin
  de validité. Ajout seul.
  - **Qui vérifie** : l'éditeur, par `node scripts/editeur.mjs ia-verifier --appel-reel` (rôle d'administration).
    L'opération émet un appel réel — un coût et un flux sortant : il n'existe AUCUNE route pour la déclencher, ni pour un
    cabinet ni pour un gestionnaire. `GET /v1/ia` (lecture) rend `verification` : état de la preuve, date, fin de
    validité, ce qu'elle atteste, et pourquoi le statut n'est pas `connecte`.
  - **Statut** : `connecte` exige que la ligne la PLUS RÉCENTE pour l'empreinte de la configuration courante soit
    `connecte`, non périmée, et repasse `evaluerStatutIa` (hôte officiel en https, modèles figés, dimension). Changer
    l'URL, le jeton ou un modèle figé change l'empreinte : retour à `configure_non_verifie`. Une vérification en échec
    ou refusée invalide la preuve précédente. Rien de ce que porte la ligne n'est cru sur parole (lignes forgées testées).
  - **Péremption, pas de revérification automatique** : au bout de `IA_PREUVE_VALIDITE_JOURS` jours (30 par défaut,
    90 au plus) la preuve est périmée ; le statut revient à `configure_non_verifie` et plus aucune tâche ne sollicite le
    modèle, jusqu'à une nouvelle vérification EXPLICITE. Aucun appel n'est émis sans avoir été demandé.
  - **Simulateur** : jamais de ligne écrite, statut `simule` quoi que contienne la table.
  - **Non vérifié** : la commande n'a jamais été lancée avec un jeton réel (il n'en existe pas). Le chemin
    « preuve valide → les tâches passent par le fournisseur » est prouvé avec un faux fournisseur injecté dans un test :
    c'est le câblage qui est prouvé, pas la connexion.
- **Niveau « lecture » et historique.** La politique `acces_dossier` de `echanges_assistant` n'admet l'écriture qu'à
  partir du niveau `collaboration` : à ce niveau, la réponse est rendue (`echangeEnregistre: false`) mais l'échange
  n'est pas conservé.
- Les pièces analysées avant cette intégration n'ont pas de passages : elles sont cherchées par le texte de leurs pages
  (repli de la requête) jusqu'à leur prochaine ré-analyse.
- `nomsPersonnes` n'est transmis par aucun appelant : seule la pseudonymisation par motifs s'appliquera.
- La limite de débit est en mémoire du processus (une par instance de l'API).
- Le mode sans IA déclenche les fonctions par mots-clés : « compte » ou « facture » lancent aussi une recherche
  d'écritures sur les mots de la question, ce qui peut ramener des écritures sans rapport.

### 10.9 Assistant sur un portefeuille de dossiers (`apps/api/src/assistant-portefeuille.service.ts`)

Le paquet n'a pas été modifié. `repondreQuestion` accepte déjà un périmètre de plusieurs dossiers ; l'intégration s'y
adapte ainsi :

| Comportement du paquet (constaté dans `assistant/fonctions.ts`, `sans-ia.ts`, `types.ts`) | Adaptation dans l'application |
|---|---|
| `PerimetreImpose.dossierIds` : 1 à **20** identifiants | Borne de 20 dossiers par question. Au-delà, le périmètre est réduit (ordre alphabétique) et les dossiers non interrogés sont nommés dans `perimetre.nonInterroges`. |
| Une seule `periode` pour tout le périmètre | Le périmètre porte l'ENVELOPPE des périodes ; chaque port ramène le contexte à la période analysée de SON dossier (dernier exercice, ou sa part dans la période commune fournie). La période est rendue dossier par dossier. |
| Mode modèle, plusieurs dossiers : `dossierId` devient obligatoire dans la déclaration des fonctions à portée de dossier ; absent → refus `dossier_a_preciser` ; hors de la liste → refus `dossier_hors_perimetre` (la trace du refus ne porte pas le dossier demandé) | Rien à ajouter : les refus sont rendus dans `reponse.refus` et tracés dans `evenements_ia`. |
| Mode sans IA : chaque fonction déclenchée est exécutée pour CHAQUE dossier du périmètre, dans l'ordre de déclaration des fonctions ; 40 éléments au plus, sans annonce | Décompte par dossier : `floor(35 / n)` éléments au plus par dossier (35, 11, 7, 3, 1 pour 1, 3, 5, 10, 20 dossiers), 5 places gardées pour les sources officielles ; fonctions réordonnées (calculs du moteur, balance, constats, écritures, pièces en dernier). Ce qui dépasse est décompté par dossier (`nonRestitues`) et affiché. Le plafond de 40 n'est donc jamais atteint. |
| `donneesManquantes` : liste à plat, dédoublonnée, sans dossier | Les ports préfixent chaque mention par `Dossier <identifiant> :` pour le paquet (et donc pour le modèle), et l'application les range par dossier dans `perimetre.dossiers[].donneesManquantes`. |
| `Citation` sans dossier | L'application ajoute `dossierId` à chaque citation et à chaque source (`null` pour une source officielle), d'après le port qui a rendu l'élément. |
| `Habilitations.autoriser` appelé avant chaque exécution | Le niveau de la personne sur LE dossier visé est relu en base à chaque appel : un retrait d'habilitation pendant la réponse fait refuser l'appel suivant (`habilitation_refusee`). |

Périmètre : dossiers actifs où `app_niveau_entite(id) >= 'lecture'`, calculé par la base sous l'identité de la session.
`dossierIds` est intersecté avec ce périmètre ; un identifiant écarté (non habilité, autre cabinet, inexistant) est rendu
tel que reçu dans `perimetre.horsPerimetre`, sans distinction ; 404 si aucun n'est retenu ; 403 pour un déposant ou sans
aucun dossier en lecture. Indicateurs : pas de calcul à la volée au-delà de 100 000 lignes par dossier (dit comme donnée
manquante).

**Relecture et retrait d'habilitation.** L'échange conservé contient la réponse telle que rendue. `GET
v1/assistant/questions` la filtre selon le périmètre du moment (`filtrerSelonHabilitations`, fonction pure) : un dossier
qui n'est plus autorisé disparaît du périmètre, avec ses données manquantes, ses sources et les segments qui les citent ;
`masque.dossiers` dit combien, sans les nommer. Si la réponse avait été RÉDIGÉE par un modèle, toute la rédaction est
alors retirée (un texte libre peut mentionner un dossier sans le citer) et il ne reste que les sources encore autorisées.
La ligne en base n'est pas réécrite : si l'habilitation est rendue, l'échange redevient complet. Le texte de la question,
écrit par la personne, n'est pas filtré.

État : sans IA en service, testé sur la pile réelle ; chemin « modèle » testé contre le simulateur avec les ports réels
(`apps/api/src/parcours-assistant-portefeuille.itest.ts`), jamais contre un modèle réel. Limites : le modèle ne reçoit
que des identifiants de dossiers, pas leurs noms ; la limite de débit est commune aux deux assistants ; le simulateur
d'API du navigateur n'imite pas la période commune.
