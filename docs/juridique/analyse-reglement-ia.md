# Analyse des obligations du règlement (UE) 2024/1689 sur l'intelligence artificielle

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

État au 2026-11-19 : **aucune fonction d'IA n'est livrée**. La passerelle d'IA est à l'état « non connectée » ; aucun traitement n'appelle un modèle ; aucune pièce n'a été lue par une IA. Les usages analysés ci-dessous sont ceux PRÉVUS par le cahier des charges. L'analyse devra être reprise quand leur conception sera arrêtée.

## 1. Textes

- Règlement (UE) 2024/1689 du 13 juin 2024 (JO série L du 12.7.2024), ci-après « le règlement ».
- Modifié par le règlement (UE) 2026/1744 du 8 juillet 2026 (« train de mesures omnibus numérique sur l'IA », JO série L du 24.7.2026), entré en vigueur le troisième jour suivant sa publication. Les modifications utiles ici portent sur les articles 4, 5, 6, 50 §7, 99, 111 et 113. Le texte consolidé n'a pas été consulté : les deux textes ont été lus séparément ; les autres modifications apportées par le règlement (UE) 2026/1744 n'ont pas été examinées une à une.

## 2. Ce qui est, ou non, un « système d'IA » dans le produit

Définition (art. 3, point 1) : système automatisé conçu pour fonctionner à différents niveaux d'autonomie, pouvant faire preuve d'une capacité d'adaptation après son déploiement, et qui déduit, à partir des entrées qu'il reçoit, la manière de générer des sorties (prédictions, contenu, recommandations, décisions).

| Composant | État réel | Système d'IA ? (proposition) |
|---|---|---|
| Contrôles déterministes (19 au catalogue), calculs, états, indicateurs | Livré | Non : règles écrites, calcul décimal, aucun apprentissage |
| Extraction de factures par règles, lecture Factur-X / CII / UBL | Livré | Non : analyse syntaxique et règles |
| Rapprochement bancaire (appariement exact, groupé, par tolérance) | Livré | Non : algorithme déterministe |
| Applicabilité de la veille par critères | Livré | Non |
| OCR local (PaddleOCR) | Livré | **Oui probablement** : modèle appris qui déduit un texte d'une image. `[À TRANCHER : qualification ; les lignes directrices de la Commission sur la définition de système d'IA n'ont pas été consultées]` |
| Classement d'une pièce (type, dossier) par modèle de langage | Prévu | Oui |
| Suggestions (rapprochement, qualification) par modèle de langage | Prévu | Oui |
| Assistant documenté (réponse à une question à partir des pièces, écritures et sources autorisées) | Prévu | Oui |
| Embeddings (bge-m3) pour la recherche | Prévu ; pgvector inutilisé | Composant d'un système d'IA |

## 3. Qualité des acteurs (proposition)

| Acteur | Qualité proposée | Fondement |
|---|---|---|
| Éditeur du modèle (Mistral AI, pour Mistral-Small-3.2) | Fournisseur d'un modèle d'IA à usage général | Art. 3 point 63 ; obligations de l'art. 53 (documentation à l'intention des fournisseurs de systèmes qui intègrent le modèle, notamment) |
| OVHcloud (AI Endpoints) | `[À TRANCHER : simple hébergeur d'inférence, distributeur, ou autre qualité]` | Non analysé ; dépend de ses conditions, non lues |
| **Éditeur de Comtaple** | **Fournisseur d'un système d'IA** : il développe un système intégrant le modèle et le met sur le marché sous son propre nom | Art. 3 point 3 |
| **Cabinet** | **Déployeur** : il utilise le système sous sa propre autorité, à titre professionnel | Art. 3 point 4 |
| Utilisateurs de l'Entité cliente (déposant, lecture) | Personnes exposées aux sorties, le cas échéant | `[À TRANCHER : l'Entité cliente est-elle elle-même déployeur si ses utilisateurs accèdent à une fonction d'IA]` |

L'Éditeur n'est pas fournisseur d'un modèle à usage général : il n'en développe ni n'en met aucun sur le marché ; il n'entraîne ni n'ajuste de modèle (engagement de conception). Si un ajustement était envisagé un jour, cette analyse changerait.

## 4. Classification proposée des usages

### 4.1 Pratiques interdites (art. 5)

Aucun usage prévu ne s'en approche (manipulation, exploitation de vulnérabilités, notation sociale, évaluation du risque pénal, reconnaissance des émotions au travail, catégorisation biométrique, etc. ; points b bis et b ter ajoutés par le règlement (UE) 2026/1744 relatifs à certains contenus à caractère sexuel). Proposé : non concerné.

### 4.2 Haut risque (art. 6 et annexe III)

Art. 6 §1 (composant de sécurité d'un produit de l'annexe I) : sans objet.

Art. 6 §2 et annexe III, domaine par domaine :

| Domaine de l'annexe III | Usage du produit qui pourrait en relever | Appréciation proposée |
|---|---|---|
| 1. Biométrie | Aucun | Non |
| 2. Infrastructures critiques | Aucun | Non |
| 3. Éducation et formation | Aucun | Non |
| 4. Emploi, gestion de la main-d'œuvre : b) décisions sur les conditions de travail, attribution de tâches sur la base du comportement, **suivi et évaluation des performances et du comportement** | Aucune IA. Les indicateurs d'activité et de rentabilité sont déterministes et calculés par cabinet, dossier ou mission, jamais par personne | Non. **Garde-fou à maintenir : ne jamais faire évaluer un collaborateur par une IA, ni attribuer des dossiers ou des tâches par une IA sur la base du comportement individuel** |
| 5. Services essentiels : b) **évaluation de la solvabilité des personnes physiques** ou note de crédit | Les indicateurs financiers et les « signaux à examiner » portent sur une entreprise, sont déterministes et ne sont pas une note | Non. **Garde-fou : aucune fonction d'IA ne doit produire une appréciation de solvabilité d'une personne physique** — attention au dirigeant caution et à l'entrepreneur individuel. `[À TRANCHER]` |
| 6. Répression ; 7. Migration ; 8. Justice et processus démocratiques | Aucun | Non |

Proposition : **aucun usage prévu ne relève de l'annexe III**. La dérogation de l'art. 6 §3 (tâche procédurale étroite, amélioration d'une activité humaine préalable, tâche préparatoire) n'a donc pas à être invoquée ; elle ne s'applique qu'aux systèmes qui relèvent de l'annexe III. Le produit ne réalise pas de profilage de personnes physiques.

Conséquence : les obligations du chapitre III (gestion des risques, documentation technique, évaluation de la conformité, enregistrement, obligations du déployeur de l'art. 26) ne s'appliqueraient pas. `[À TRANCHER : valider cette classification ; consulter les lignes directrices de la Commission sur l'article 6, prévues par l'art. 6 §5 — existence et contenu non vérifiés le 2026-11-19]`

### 4.3 Classification par usage

| Usage prévu | Nature | Classe proposée | Obligations propres |
|---|---|---|---|
| OCR | Transcription d'image en texte | Hors annexe III ; pas d'interaction directe ; ne « génère » pas un contenu de synthèse au sens courant — `[À TRANCHER]` | Art. 4 seulement (proposé) |
| Extraction assistée et classement d'une pièce (type, dossier) | Sortie structurée, proposée à un collaborateur qui valide | Hors annexe III ; risque minimal | Art. 4. Art. 50 §2 : voir §5.2 |
| Suggestions (rapprochement, qualification, explication d'un constat) | Recommandation textuelle courte, vérifiée arithmétiquement par le moteur quand c'est possible, validée par un humain | Hors annexe III | Art. 4. Art. 50 §2 : voir §5.2 |
| Assistant documenté | Dialogue en langage naturel avec un utilisateur du Cabinet ; texte généré, sources citées | Hors annexe III ; **système destiné à interagir directement avec des personnes physiques** et **générant du texte** | Art. 4 ; **art. 50 §1** ; art. 50 §2 : voir §5.2 |
| Résumé d'une évolution réglementaire (veille) | Aujourd'hui rédigé par une personne ; l'IA n'est pas prévue pour publier | Hors annexe III | Si un texte généré était un jour diffusé aux Cabinets sans relecture : réexaminer l'art. 50 |

## 5. Obligations de transparence (art. 50)

### 5.1 Interaction directe — art. 50 §1 (fournisseur)

Le fournisseur veille à ce que les systèmes destinés à interagir directement avec des personnes physiques soient conçus de manière que ces personnes soient informées qu'elles interagissent avec un système d'IA, sauf si cela ressort clairement pour une personne normalement informée et raisonnablement attentive, compte tenu du contexte. L'information est donnée de manière claire et reconnaissable au plus tard à la première interaction, dans le respect des exigences d'accessibilité (art. 50 §5).

Application proposée : l'assistant est identifié comme une IA dans l'interface, dès son ouverture et de façon permanente. Par cohérence avec le principe du produit (calcul et IA séparés, voir `../architecture.md`), **toute sortie issue d'un modèle est marquée comme telle** dans l'interface, y compris les suggestions et classements, même si l'art. 50 §1 ne les vise pas strictement. Le modèle de données prévoit déjà une table distincte (`propositions_ia`) : l'origine d'une sortie est traçable par construction.

### 5.2 Marquage des contenus générés — art. 50 §2 (fournisseur)

Les fournisseurs de systèmes qui génèrent des contenus de synthèse (audio, image, vidéo ou **texte**) veillent à ce que les sorties soient marquées dans un format lisible par machine et identifiables comme générées par une IA. L'obligation ne s'applique pas dans la mesure où le système remplit une fonction d'assistance pour la mise en forme standard, ou ne modifie pas de manière substantielle les données d'entrée fournies par le déployeur ou leur sémantique.

Questions ouvertes :

1. L'assistant et les explications rédigées génèrent du texte : l'obligation paraît applicable. Forme du marquage pour du texte affiché dans une application et pour du texte exporté (PDF du dossier de révision, CSV, archive de restitution) : `[À TRANCHER, à la lumière des lignes directrices de la Commission du 20 juillet 2026 et du code de bonne pratique sur le marquage publié en 2026 — non lus]`.
2. L'extraction et le classement produisent des données structurées tirées de la pièce : relèvent-ils de l'exception « ne modifie pas de manière substantielle les données d'entrée » ? `[À TRANCHER]`
3. Proposition technique minimale, quelle que soit l'issue : champ d'origine sur chaque donnée (`moteur`, `regle`, `ocr`, `ia`, `humain`) conservé en base, repris dans les exports structurés et mentionné en clair dans les PDF.

### 5.3 Autres paragraphes

- Art. 50 §3 (reconnaissance des émotions, catégorisation biométrique) : sans objet.
- Art. 50 §4 (hypertrucages ; textes publiés pour informer le public sur des questions d'intérêt public) : sans objet pour le produit. Un Cabinet qui publierait un texte généré relèverait lui-même de cette disposition comme déployeur.

### 5.4 Sanction

Le non-respect des obligations de transparence de l'art. 50 est passible d'une amende administrative pouvant aller jusqu'à 15 000 000 EUR ou 3 % du chiffre d'affaires annuel mondial (art. 99 §4 g)). Le règlement (UE) 2026/1744 a modifié l'article 99, notamment pour la prise en compte des PME : `[À TRANCHER : régime applicable à l'Éditeur ; régime national de sanctions non examiné]`.

## 6. Maîtrise de l'IA (art. 4, rédaction issue du règlement (UE) 2026/1744)

Les fournisseurs et les déployeurs prennent des mesures pour favoriser le développement de la maîtrise de l'IA par leur personnel et les autres personnes s'occupant du fonctionnement et de l'utilisation des systèmes d'IA pour leur compte, compte tenu de leurs connaissances, de leur expérience et du contexte d'utilisation ; cette obligation ne les contraint pas à garantir un niveau spécifique de maîtrise par un individu.

- Pour l'Éditeur (fournisseur) : former son équipe ; `[À COMPLÉTER : plan]`.
- Pour le Cabinet (déployeur) : l'Éditeur peut l'aider par une documentation d'usage (ce que fait chaque fonction d'IA, ses limites, ce qu'elle ne doit pas servir à décider, l'obligation de validation humaine). À produire avant activation.

Ancienne rédaction (applicable depuis le 2 février 2025) : obligation de « veiller à garantir un niveau suffisant de maîtrise ». `[À TRANCHER : portée exacte du changement]`

## 7. Bonnes pratiques volontaires

Le règlement encourage l'application volontaire de certaines exigences aux systèmes qui ne sont pas à haut risque (art. 95, codes de conduite). Mesures déjà inscrites dans la conception et utiles à ce titre :

- contrôle humain : toute sortie d'IA est une proposition ; validation par un collaborateur ou un réviseur ; aucune écriture comptable n'est produite ;
- séparation du calcul : aucun montant ne vient d'un modèle ; une suggestion chiffrée est revérifiée par le moteur déterministe ;
- mode dégradé : le service fonctionne sans IA ;
- contenus non fiables : pièces et messages traités comme des données, jamais comme des instructions (un essai existe, mais aucune IA ne lit les pièces à ce jour) ;
- absence d'entraînement sur les données des Cabinets.

À construire avant activation : journal des appels au modèle (version du modèle, entrée minimisée, sortie, décision humaine) ; mesure de qualité sur un corpus autorisé ; procédure de changement de version de modèle ; documentation d'usage.

## 8. Calendrier d'application (art. 113 modifié)

| Date | Ce qui s'applique | Effet pour le produit |
|---|---|---|
| 1er août 2024 | Entrée en vigueur (vingtième jour après la publication du 12.7.2024) | — |
| 2 février 2025 | Chapitres I et II : définitions, maîtrise de l'IA (art. 4), pratiques interdites (art. 5) | Art. 4 applicable dès qu'un système d'IA est fourni ou utilisé |
| 2 août 2025 | Modèles à usage général (chapitre V), gouvernance, sanctions (sauf art. 101) | Concerne le fournisseur du modèle |
| 27 juillet 2026 | Entrée en vigueur du règlement (UE) 2026/1744 ; art. 4 dans sa nouvelle rédaction | — |
| **2 août 2026** | Date générale d'application, dont **l'art. 50** | **Déjà applicable** : toute fonction d'IA mise sur le marché à partir de maintenant doit respecter l'art. 50 dès son lancement |
| 2 décembre 2026 | Art. 5 §1 points b bis et b ter ; échéance transitoire de l'art. 111 §4 : les systèmes générant des contenus de synthèse mis sur le marché **avant le 2 août 2026** doivent se conformer à l'art. 50 §2 à cette date | La période transitoire ne bénéficie pas au produit, dont aucune fonction d'IA n'était sur le marché avant le 2 août 2026 `[À TRANCHER]` |
| 2 décembre 2027 | Chapitre III, sections 1 à 3, pour les systèmes à haut risque de l'annexe III (reporté par le règlement (UE) 2026/1744 ; date initiale : 2 août 2026) | Sans objet si la classification du §4.2 est validée |
| 2 août 2028 | Idem pour les systèmes à haut risque de l'art. 6 §1 et de l'annexe I (date initiale : 2 août 2027) | Sans objet |

## 9. Articulation avec le RGPD

Le droit de la protection des données s'applique aux données personnelles traitées en lien avec le règlement (art. 2 §7). Conséquences : flux vers le fournisseur d'inférence à inscrire au registre et dans la liste des sous-traitants (`sous-traitants.md`) ; minimisation des extraits transmis ; AIPD proposée avant activation (`analyse-aipd.md`) ; pas de décision individuelle automatisée (`gestion-des-droits.md` §4).

## 10. Ce qui reste à trancher

1. Qualification de l'OCR comme système d'IA et ses conséquences (§2).
2. Qualité d'OVHcloud dans la chaîne ; obtention de la documentation due par le fournisseur du modèle (§3).
3. Validation de la classification hors annexe III, notamment points 4 b) et 5 b) pour l'entrepreneur individuel et le dirigeant (§4.2).
4. Portée de l'art. 50 §2 pour l'extraction, le classement, les suggestions ; forme du marquage lisible par machine pour du texte et dans les exports (§5.2).
5. Statut de l'Entité cliente si ses utilisateurs accèdent à une fonction d'IA (§3).
6. Mesures de maîtrise de l'IA attendues de l'Éditeur et documentation due aux Cabinets (§6).
7. Régime de sanctions applicable et autorité nationale compétente en France (non examinés).
8. Relecture du texte consolidé du règlement et des lignes directrices de la Commission (définition du système d'IA, article 6, article 50).

## Références

Consultées le 2026-11-19.

- Règlement (UE) 2024/1689, art. 2, 3, 4, 5, 6, 25, 26, 50, 53, 95, 99, 111, 113, annexe III : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=OJ:L_202401689>
- Règlement (UE) 2026/1744 du 8 juillet 2026, article premier (points 5, 7, 8, 20, 38, 39, 40) et article 4 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=OJ:L_202601744>
- Commission européenne, annonce de la publication des lignes directrices sur les obligations de transparence de l'article 50 (20 juillet 2026) : <https://digital-strategy.ec.europa.eu/fr/news/commission-publishes-guidelines-transparency-obligations-providers-and-deployers-certain-ai-systems> — annonce lue ; lignes directrices non lues.
- Code de bonne pratique sur le marquage et l'étiquetage des contenus générés par l'IA : publication en 2026 relevée par une recherche, sur le site de la Commission ; date exacte et contenu non vérifiés.
- Lignes directrices de la Commission sur la définition de système d'IA et sur l'article 6 : non consultées.
