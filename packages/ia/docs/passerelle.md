# Passerelle IA interne — `@comtaple/ia`

État au **2026-11-19** : paquet écrit et testé contre un **SIMULATEUR**. **Aucun jeton d'IA n'existe : aucun appel de
génération n'a jamais été fait sur le service réel.** Rien de ce paquet n'est encore branché dans l'API, le worker ou
l'interface. Le statut réel de l'intégration est donc `non_connecte`.

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
La preuve (`PreuveConnexionIa`) est à conserver par l'intégrateur et à repasser au constructeur (`preuveConnexion`) ;
elle est réévaluée à chaque lecture du statut (autre URL de base → `configure_non_verifie`).

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
| Intégration (API, worker, interface, tables d'audit, pgvector) | Non faite. |

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
4. `verifierConnexion()` : le statut doit passer à `connecte`. Sinon lire `raisons` (points O9 à O12).
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
- L'ébauche `packages/plateforme/src/passerelle-ia.ts` existe toujours ; elle doit être retirée lors de la bascule.
