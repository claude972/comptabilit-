# Secret professionnel de l'expert-comptable et responsabilités contractuelles

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Ce document liste des points d'attention et des clauses à prévoir. Il ne contient ni consultation juridique ni conditions générales : celles-ci ne sont pas rédigées.

## 1. Cadre rappelé

Textes lus dans les recueils publiés par l'Ordre des experts-comptables (éditions de janvier et mars 2024). Leur version en vigueur n'a pas pu être revérifiée sur Légifrance le 2026-11-19 (accès automatisé refusé).

| Texte | Contenu utile |
|---|---|
| Ordonnance n° 45-2138 du 19 septembre 1945, art. 21 | Les experts-comptables, leurs salariés visés aux articles 83 ter et 83 quater, les experts-comptables stagiaires et les professionnels autorisés à exercer partiellement sont tenus au secret professionnel « dans les conditions et sous les peines fixées par l'article 226-13 du code pénal », sous réserve de toute disposition législative contraire. |
| Code pénal, art. 226-13 | Sanctionne la révélation d'une information à caractère secret par son dépositaire. Texte et peines non revérifiés en ligne le 2026-11-19. |
| Décret n° 2012-432 du 30 mars 2012, art. 147 (code de déontologie) | Sans préjudice du secret professionnel, devoir de discrétion dans l'utilisation de toutes les informations connues dans le cadre de l'activité. |
| Même décret, art. 148 | Le professionnel s'assure que les collaborateurs auxquels il confie des travaux respectent notamment les règles des articles 146 et 147. |
| Même décret, art. 151 | Contrat écrit avec le client (lettre de mission) définissant la mission et les droits et obligations de chacun. |
| Même décret, art. 168 | Information du président du conseil régional de l'Ordre avant toute rétention des travaux pour non-paiement des honoraires. |
| Ordonnance de 1945, art. 12 | Les experts-comptables assument dans tous les cas la responsabilité de leurs travaux et activités. |
| Ordonnance de 1945, art. 17 | Obligation d'assurance de responsabilité civile pour l'ensemble des travaux et activités. |

Conséquence de principe : le secret pèse sur le professionnel, personnellement. L'Éditeur n'y est pas soumis par ces textes : il n'est tenu que par le contrat et par le RGPD. C'est donc le contrat qui doit donner au Cabinet les moyens de respecter son propre secret quand il confie des données à un prestataire. `[À TRANCHER : le recours à un logiciel hébergé par un tiers est-il en soi compatible avec le secret professionnel de l'expert-comptable, et à quelles conditions ; existence de recommandations ou de normes de l'Ordre sur l'externalisation et l'hébergement — non trouvées, non vérifiées]`

## 2. Points d'attention liés au secret professionnel

| # | Point | État réel du produit | À prévoir |
|---|---|---|---|
| S1 | **Accès du personnel de l'Éditeur aux dossiers** | Uniquement par le compte support : ouvert par l'Éditeur pour 72 h au plus, avec motif ; sans effet tant qu'un gestionnaire du Cabinet ne l'a pas habilité sur un dossier ; lecture seule ; chaque consultation tracée dans le journal du Cabinet | Clause : aucun accès sans demande et habilitation du Cabinet ; engagement individuel de confidentialité des personnes concernées ; liste nominative tenue à disposition. `[À TRANCHER : le Cabinet doit-il recueillir l'accord de son client avant d'habiliter le support ; mention à porter dans la lettre de mission]` |
| S2 | **Accès technique hors cloisonnement** | Le rôle de migration contourne le RLS ; il sert aux opérations de l'Éditeur (ouverture d'un cabinet, échéances, etc.) par un module, sans outil d'exploitation ni traçabilité dédiée. En production, des administrateurs de l'Éditeur et de l'hébergeur auront un accès technique aux bases et au stockage | Encadrer : personnes habilitées, journalisation, double contrôle, interdiction de consultation hors nécessité. Chiffrement au repos avec maîtrise des clés `[À TRANCHER : niveau exigé]`. Dire la vérité au Cabinet sur ce que l'Éditeur peut techniquement voir : aujourd'hui, **les données ne sont pas chiffrées de bout en bout ; l'Éditeur peut techniquement y accéder** |
| S3 | **Hébergeur et fournisseur d'IA** | Non contractés (`sous-traitants.md`) | Obligations de confidentialité répercutées ; localisation ; pour l'IA : pas de conservation des requêtes, pas de réutilisation, pas de relecture humaine par le fournisseur — à obtenir par contrat avant activation |
| S4 | **Isolation entre cabinets et entre dossiers** | RLS forcé, testé ; un administrateur du Cabinet ne voit pas le contenu d'un dossier où il n'est pas habilité | Test d'intrusion indépendant avant mise en service (non fait) |
| S5 | **Utilisateurs de l'Entité cliente** | Rôles « déposant » et « lecture » limités à leur dossier | Le Cabinet décide de ce qu'il ouvre à son client ; vérifier que les travaux internes du Cabinet (commentaires, constats non validés, rentabilité) ne sont pas visibles du client `[À COMPLÉTER : matrice des droits par rôle à annexer au contrat]` |
| S6 | **Restitutions** | Archives ZIP ni chiffrées ni signées ; l'archive d'un cabinet n'est téléchargeable que par son demandeur | Avertir : une fois téléchargée, l'archive est sous la seule garde du Cabinet. Chiffrement de l'archive à envisager |
| S7 | **Sauvegardes** | En clair en local ; politique de production non définie | Chiffrement et garde des clés avant toute donnée réelle |
| S8 | **Messagerie** | Lecture seule ; jamais connectée | Une boîte contient des échanges couverts par le secret et sans rapport avec la collecte : minimisation, périmètre des dossiers lus, information `[À TRANCHER]` |
| S9 | **Réquisitions et demandes d'autorités adressées à l'Éditeur** | Aucune procédure | Clause : l'Éditeur informe le Cabinet de toute demande, sauf interdiction légale, ne communique que ce que la loi impose, et renvoie l'autorité vers le Cabinet quand c'est possible. `[À TRANCHER : le secret de l'expert-comptable n'est pas opposable de la même façon par un prestataire ; conduite à tenir]` |
| S10 | **Exceptions légales au secret** (obligations déclaratives du professionnel, notamment en matière de lutte contre le blanchiment) | Hors périmètre fonctionnel | Le logiciel ne doit pas faire obstacle aux obligations du Cabinet ni les exécuter à sa place. Références (code monétaire et financier) non vérifiées |
| S11 | **Références commerciales** | — | L'Éditeur ne cite pas un Cabinet comme client sans accord écrit, et jamais une Entité cliente |
| S12 | **Dépôt de code public** | Le dépôt est public ; aucun secret versionné ; jeux de test synthétiques | Interdiction de toute donnée réelle dans le dépôt, les tickets et les journaux de CI |
| S13 | **Violation de données** | Procédure à l'état de projet | Une fuite est aussi, pour le Cabinet, une atteinte au secret : notification rapide et précise par dossier (`procedure-incident.md`) |

## 3. Responsabilité du professionnel et place du logiciel

Principe à écrire noir sur blanc dans le contrat et dans l'interface : **le logiciel prépare, contrôle et documente ; il ne conclut pas.** L'expert-comptable assume la responsabilité de ses travaux ; le logiciel ne se substitue ni à lui ni à un avocat (`../risques.md`).

Ce que le produit fait déjà en ce sens :

- mention « projet » sur les états, dossiers de révision et documents produits ;
- cinq statuts de contrôle distincts ; « non réalisé » n'est jamais présenté comme favorable ;
- propositions (rapprochements, écritures d'inventaire, avenants) toujours soumises à validation par une personne habilitée, distincte de l'auteur quand c'est prévu ;
- aucune écriture intégrée en comptabilité, aucun envoi, aucune télétransmission ;
- signaux formulés en questions, sans diagnostic ;
- constat « hors périmètre » de la lettre de mission présenté comme un signalement, pas comme une conclusion contractuelle.

Ce que le contrat doit dire des limites réelles (à reprendre de `../couverture.md` au jour de la signature) :

- contrôles, seuils, table de correspondance des états et indicateurs **non validés par un professionnel** à ce jour (V1 à V3, V11, V12) ;
- extraction et OCR jamais mesurés sur des pièces réelles ;
- périmètre : TPE / PME commerciales, PCG, IS, euro, métropole ; hors de ce périmètre, les contrôles ne s'appliquent pas ou s'abstiennent ;
- veille : une source indisponible n'est pas une absence de nouveauté ;
- le logiciel n'est pas un logiciel de tenue comptable, de caisse, de facturation ni d'archivage à valeur probante ; aucune certification n'est revendiquée.

## 4. Clauses à prévoir entre l'Éditeur et le Cabinet

Liste de travail pour les conditions générales (non rédigées) :

| # | Clause | Contenu à arbitrer |
|---|---|---|
| C1 | Objet et nature de l'obligation | Fourniture d'un service en ligne ; obligation de moyens `[À TRANCHER]` ; description fonctionnelle opposable = documentation à jour, états « en attente de validation » compris |
| C2 | Rôle d'aide à la décision | Le Cabinet reste seul responsable de ses travaux, de la validation des sorties et de leur usage envers ses clients ; l'Éditeur ne fournit ni conseil comptable, fiscal ou juridique |
| C3 | Responsabilité de l'Éditeur | Périmètre (disponibilité, intégrité et confidentialité des données, conformité à la documentation) ; plafond `[À TRANCHER : montant, par an / par sinistre]` ; exclusions des dommages indirects `[À TRANCHER : validité, notamment au regard d'une obligation essentielle et de la faute lourde ou dolosive]` ; **les plafonds ne s'appliquent pas aux droits des personnes concernées au titre de l'article 82 du RGPD** ; répartition finale entre les parties (art. 82 §5) |
| C4 | Assurance | Responsabilité civile professionnelle et risques numériques de l'Éditeur `[À COMPLÉTER : aucune police souscrite à ce jour]` ; le Cabinet reste tenu de sa propre assurance (ordonnance de 1945, art. 17) |
| C5 | Niveaux de service | Disponibilité, sauvegardes, perte de données admissible, délai de reprise : **non définis** ; ne rien promettre avant de les avoir fixés avec l'hébergeur |
| C6 | Confidentialité renforcée | Voir §2 ; durée survivant au contrat ; engagement du personnel |
| C7 | Propriété et usage des données | Les données restent au Cabinet et à ses clients ; aucun usage par l'Éditeur hors exécution ; interdiction d'entraînement de modèles ; statistiques anonymes éventuelles à encadrer (`roles-rgpd.md` §4.3) |
| C8 | Réversibilité | Restitution par dossier et par cabinet, disponible même en cas de suspension ou de résiliation (en place) ; format ; durée d'accès après la fin ; pas de format d'échange normalisé avec un autre logiciel |
| C9 | **Absence de rétention des données** | L'Éditeur ne subordonne pas la restitution au paiement. Aujourd'hui le produit garde consultation, téléchargement et restitution ouverts quand l'abonnement est suspendu ou résilié (décision D-024) : à inscrire comme engagement. `[À TRANCHER : durée]` |
| C10 | Suppression en fin de contrat | Voir `contrat-sous-traitance-projet.md` art. 11 — procédure de l'éditeur **non activée** (D-078) ; durées paramétrables, **non validées** : toute exécution réelle exige la référence d'une validation (D-099) ; suppression des objets, des comptes d'identité et rotation des sauvegardes exercées sur ressources d'essai seulement |
| C11 | Suspension du service | Effets limités aux nouveaux dépôts et imports ; un téléversement commencé se termine (D-027) ; une pièce transmise par un client n'est jamais refusée pour dépassement de quota (D-024) |
| C12 | Sécurité à la charge du Cabinet | Gestion des comptes et habilitations, retrait des partants, second facteur quand il sera disponible, postes et téléphones des utilisateurs (des dépôts en attente sont stockés sur le téléphone) |
| C13 | Fonctions d'IA | Activation explicite par le Cabinet ; information sur le fournisseur et les limites ; marquage des sorties ; validation humaine obligatoire (`analyse-reglement-ia.md`) |
| C14 | Messagerie | Conditions de connexion d'une boîte ; responsabilité du Cabinet sur le choix des boîtes et l'information des titulaires |
| C15 | Évolution du service et de la documentation | Information préalable ; non-régression de la sécurité |
| C16 | Audit et contrôle de l'Ordre | Coopération de l'Éditeur lorsque le Cabinet fait l'objet d'un contrôle ; accès du Cabinet à ses journaux |
| C17 | Force probante | Portée du journal d'audit et des empreintes : éléments de preuve entre les parties ; **aucune valeur d'archivage électronique qualifié n'est revendiquée** ; pas d'ancrage externe à ce jour |
| C18 | Droit applicable, litiges | `[À COMPLÉTER]` ; conciliation préalable éventuelle |

## 5. Clauses à suggérer au Cabinet pour ses lettres de mission

Le logiciel permet de structurer missions et lettres, dont le contenu est saisi par le Cabinet. Points que le Cabinet devrait examiner avec son propre conseil (l'Éditeur ne rédige pas ses lettres de mission) :

1. Information du client sur l'usage d'un outil hébergé par un prestataire, et sur l'identité des sous-traitants (cohérent avec l'article 28 du RGPD si le Cabinet est sous-traitant de son client).
2. Autorisation éventuelle du client pour l'accès d'assistance du prestataire à son dossier.
3. Modalités de dépôt des pièces par le client (portail, téléphone) et responsabilités du client sur ce qu'il dépose.
4. Usage éventuel de fonctions d'IA sur le dossier.
5. Durées de conservation et restitution en fin de mission.

`[À TRANCHER : faut-il fournir des modèles de clauses, au risque de sortir du rôle d'éditeur]`

## 6. Points que seul un avocat peut trancher

1. Compatibilité de l'hébergement externalisé et de l'accès support avec le secret professionnel ; garanties minimales.
2. Nécessité d'un accord du client final pour l'accès support et pour les fonctions d'IA.
3. Conduite en cas de réquisition adressée à l'Éditeur.
4. Validité et niveau des plafonds et exclusions de responsabilité ; qualification de l'obligation.
5. Portée probatoire à reconnaître contractuellement au journal d'audit.
6. Rédaction des conditions générales et de la politique de confidentialité.
7. Assurances à souscrire par l'Éditeur.

## Références

Consultées le 2026-11-19.

- Ordre des experts-comptables, « Réglementation de l'expertise comptable », édition mars 2024 (ordonnance n° 45-2138, art. 12, 17 et 21 ; décret n° 2012-432) : <https://www.paysdelaloire.experts-comptables.fr/wp-content/uploads/2024/06/2024-reglementation-expert-comptable.pdf>
- Ordre des experts-comptables, « Code de déontologie », édition janvier 2024 (décret n° 2012-432, art. 141 à 169 ; art. 147, 148, 151, 168 lus) : <https://www.bretagne.experts-comptables.fr/wp-content/uploads/2024/04/code_deontologie_012024.pdf>
- Légifrance, code de déontologie des professionnels de l'expertise comptable (articles 141 à 169) : <https://www.legifrance.gouv.fr/codes/id/LEGISCTA000025599334> — non revérifié en ligne le 2026-11-19 (erreur 403). Les modifications postérieures aux éditions 2024 de l'Ordre ne sont donc pas vérifiées.
- Code pénal, art. 226-13 et 226-14 ; code monétaire et financier (lutte contre le blanchiment) : références non revérifiées en ligne le 2026-11-19.
- RGPD, art. 28 et 82 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
