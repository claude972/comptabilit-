# Projet de contrat de traitement de données (article 28 du RGPD)

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Mode d'emploi :

- Ce texte est une trame de travail rédigée par l'équipe de développement. Il ne doit être ni signé ni proposé à un client en l'état.
- `[À COMPLÉTER : …]` : information factuelle manquante. `[À TRANCHER : …]` : choix juridique ou commercial ouvert. `[OPTION A / OPTION B]` : rédactions alternatives.
- Alternative à cette rédaction : reprendre les clauses contractuelles types de la décision d'exécution (UE) 2021/915 de la Commission du 4 juin 2021. Selon la CNIL, elles peuvent fonder tout ou partie du contrat, ne doivent pas être modifiées hors annexes, peuvent être complétées par des clauses qui ne les contredisent pas, et ne couvrent pas les transferts hors Union. `[À TRANCHER : rédaction propre ci-dessous ou clauses types + annexes]`
- Les annexes décrivent l'état réel du produit au 2026-11-19. Plusieurs mesures prévues ne sont pas en place (signalées « non en place ») : le contrat ne peut pas les promettre avant qu'elles le soient.
- Chaque article indique entre parenthèses la disposition du RGPD qu'il met en œuvre.

---

## Contrat de traitement de données à caractère personnel

**Entre**

`[À COMPLÉTER : dénomination du Cabinet, forme, siège, numéro d'inscription à l'Ordre, représentant]`, ci-après « le Cabinet »,

**et**

`[À COMPLÉTER : dénomination de l'Éditeur, forme, siège, RCS, représentant]`, ci-après « l'Éditeur ».

Le présent contrat est une annexe du contrat de service `[À COMPLÉTER : référence des conditions générales — non rédigées à ce jour]`. En cas de contradiction sur la protection des données, il prévaut.

### Article 1 — Objet (art. 28 §3, phrase introductive)

L'Éditeur fournit au Cabinet le service Comtaple. À cette occasion il traite des données à caractère personnel pour le compte du Cabinet. Le présent contrat fixe les conditions de ce traitement. L'objet, la durée, la nature, la finalité, le type de données et les catégories de personnes figurent en annexe 1.

### Article 2 — Qualité des parties

`[OPTION A — Cabinet responsable]` Le Cabinet agit comme responsable du traitement. L'Éditeur agit comme sous-traitant.

`[OPTION B — Cabinet sous-traitant de ses clients pour tout ou partie des missions]` Pour les missions listées en annexe 1, le Cabinet agit comme sous-traitant de ses propres clients, et l'Éditeur comme sous-traitant ultérieur. Le Cabinet déclare avoir obtenu de ses clients l'autorisation de recourir à l'Éditeur et aux sous-traitants de l'annexe 3, et répercute à l'Éditeur les instructions qu'il reçoit.

`[À TRANCHER : voir roles-rgpd.md §5 ; la combinaison des deux options par mission est possible]`

Ne relèvent pas du présent contrat les traitements que l'Éditeur réalise pour son propre compte comme responsable : gestion de la relation commerciale et de l'abonnement, facturation, `[À TRANCHER : sécurité de la plateforme ; mesure d'usage — voir roles-rgpd.md §4]`. L'Éditeur en informe les personnes concernées par `[À COMPLÉTER : politique de confidentialité — non rédigée]`.

### Article 3 — Instructions du Cabinet (art. 28 §3 a))

3.1 L'Éditeur ne traite les données que sur instruction documentée du Cabinet. Constituent des instructions : le présent contrat, le paramétrage du service par les utilisateurs habilités du Cabinet (ouverture des dossiers, habilitations, règles du Cabinet, connexion d'une boîte de messagerie, activation d'une fonction), et toute demande écrite adressée à `[À COMPLÉTER : canal]`.

3.2 Si l'Éditeur est tenu de traiter les données en vertu du droit de l'Union ou du droit français, il en informe le Cabinet avant le traitement, sauf si ce droit interdit cette information pour des motifs importants d'intérêt public.

3.3 L'Éditeur informe immédiatement le Cabinet si, selon lui, une instruction constitue une violation du RGPD ou d'une autre disposition de protection des données (art. 28 §3, dernier alinéa). `[À TRANCHER : droit de suspendre l'exécution de l'instruction dans l'attente]`

3.4 L'Éditeur n'utilise pas les données pour son propre compte. En particulier, **il ne les utilise pas et ne les laisse pas utiliser pour entraîner, ajuster ou évaluer un modèle d'intelligence artificielle**. `[À TRANCHER : exception éventuelle pour des statistiques anonymes d'usage, à définir précisément — roles-rgpd.md §4.3]`

### Article 4 — Confidentialité (art. 28 §3 b))

4.1 L'Éditeur veille à ce que les personnes autorisées à traiter les données soient engagées à la confidentialité par contrat ou soumises à une obligation légale appropriée.

4.2 L'accès du personnel de l'Éditeur aux données d'un dossier n'est possible que par le compte « support » : ouvert pour une durée déterminée d'au plus 72 heures, avec un motif ; sans effet tant qu'un gestionnaire du Cabinet n'a pas habilité ce compte sur le dossier ; limité à la lecture ; chaque consultation est inscrite au journal d'audit du Cabinet. *(État réel : en place et testé.)*

4.3 Le Cabinet est informé que les opérations d'exploitation de l'Éditeur (migrations, provisionnement) utilisent un rôle technique de base de données qui n'est pas soumis au cloisonnement par cabinet. L'Éditeur s'engage à `[À COMPLÉTER : mesures d'encadrement de ce rôle — personnes habilitées, traçabilité, double contrôle ; non définies à ce jour]`.

4.4 `[À TRANCHER : clause propre au secret professionnel du Cabinet — voir secret-professionnel-responsabilites.md §2]`

### Article 5 — Sécurité (art. 28 §3 c), art. 32)

L'Éditeur met en œuvre les mesures techniques et organisationnelles décrites en annexe 2. Il peut les faire évoluer sans en diminuer le niveau global. `[À TRANCHER : modalités d'information du Cabinet sur les évolutions]`

### Article 6 — Sous-traitants ultérieurs (art. 28 §2, §3 d) et §4)

6.1 `[OPTION A — autorisation générale]` Le Cabinet autorise de manière générale le recours aux sous-traitants ultérieurs listés en annexe 3. L'Éditeur informe le Cabinet de tout projet d'ajout ou de remplacement au moins `[À TRANCHER : 30]` jours à l'avance par `[À COMPLÉTER : canal]`. Le Cabinet peut s'y opposer pendant ce délai ; à défaut d'accord, `[À TRANCHER : résiliation sans frais de la partie du service concernée]`.

`[OPTION B — autorisation spécifique]` Tout recours à un sous-traitant ultérieur est soumis à l'autorisation écrite préalable du Cabinet.

6.2 L'Éditeur impose à chaque sous-traitant ultérieur, par contrat, les mêmes obligations de protection des données que celles du présent contrat. Si le sous-traitant ultérieur ne remplit pas ses obligations, l'Éditeur demeure pleinement responsable devant le Cabinet de leur exécution.

### Article 7 — Localisation et transferts (art. 28 §3 a), chapitre V)

Les données sont hébergées et traitées en `[À COMPLÉTER : France — région de l'hébergeur à préciser une fois le contrat d'hébergement conclu]`. L'Éditeur ne transfère pas les données hors de l'Union européenne sans instruction documentée du Cabinet et sans les garanties du chapitre V du RGPD. `[À TRANCHER : traitement du cas des connecteurs de messagerie, dont les fournisseurs sont choisis par le Cabinet — sous-traitants.md §3]`

### Article 8 — Droits des personnes concernées (art. 28 §3 e))

8.1 L'Éditeur aide le Cabinet, par des mesures techniques et organisationnelles appropriées et dans toute la mesure du possible, à donner suite aux demandes d'exercice des droits.

8.2 Si une personne s'adresse directement à l'Éditeur pour des données traitées pour le compte du Cabinet, l'Éditeur ne répond pas sur le fond ; il transmet la demande au Cabinet sous `[À TRANCHER : 3 jours ouvrés]`.

8.3 Les moyens mis à disposition et leurs limites figurent dans `gestion-des-droits.md` ; à la date du projet, le service ne comporte pas de fonction d'effacement d'une pièce, d'un dossier ou d'une personne, ni d'export par personne ; la seule suppression outillée est celle de l'ensemble d'un cabinet en fin de contrat (article 11), non activée. `[À TRANCHER : conditions, délais et coût éventuel de l'assistance qui excède les fonctions du service]`

### Article 9 — Assistance au Cabinet (art. 28 §3 f))

Compte tenu de la nature du traitement et des informations dont il dispose, l'Éditeur aide le Cabinet à respecter ses obligations relatives à la sécurité (art. 32), à la notification des violations (art. 33 et 34), à l'analyse d'impact (art. 35) et à la consultation préalable (art. 36). Il fournit à cette fin la documentation décrivant le service et ses mesures de sécurité. `[À TRANCHER : gratuité ou facturation au-delà d'un volume]`

### Article 10 — Violation de données (art. 33 §2)

10.1 L'Éditeur notifie au Cabinet toute violation de données à caractère personnel dans les meilleurs délais après en avoir pris connaissance, et au plus tard dans un délai de `[À TRANCHER : 24 / 48 heures — le RGPD impose « dans les meilleurs délais » sans chiffre ; le Cabinet dispose lui-même de 72 heures pour notifier la CNIL]`, à `[À COMPLÉTER : contact d'urgence désigné par le Cabinet]`.

10.2 La notification comporte, dans la mesure où ils sont connus et au besoin de façon échelonnée : la nature de la violation, les catégories et le nombre approximatif de personnes et d'enregistrements concernés, les conséquences probables, les mesures prises ou envisagées, le point de contact.

10.3 L'Éditeur ne notifie pas la CNIL ni les personnes concernées à la place du Cabinet, sauf mandat écrit. `[À TRANCHER]`

10.4 La procédure interne de l'Éditeur est décrite dans `procedure-incident.md`.

### Article 11 — Sort des données en fin de contrat (art. 28 §3 g))

11.1 Au terme du contrat, selon le choix du Cabinet, l'Éditeur supprime toutes les données ou les lui renvoie, et détruit les copies existantes, sauf si le droit de l'Union ou le droit français exige leur conservation.

11.2 Restitution : le Cabinet peut à tout moment, y compris lorsque l'abonnement est suspendu ou résilié, produire une archive de restitution par dossier ou pour l'ensemble du cabinet (originaux non modifiés, données structurées, journal d'audit du périmètre, manifeste d'empreintes vérifiable sans le logiciel). *(État réel : en place et testé ; l'archive n'est ni chiffrée ni signée ; la restitution d'un cabinet est limitée aux dossiers sur lesquels le demandeur est habilité au niveau « validation » ; les originaux écartés par l'antivirus ne sont pas restitués et sont listés ; les sauvegardes et les journaux techniques ne sont pas restitués.)*

11.3 Suppression : `[À COMPLÉTER : délai après la fin du contrat — proposition 90 jours après l'échéance, puis délai de purge des sauvegardes]`. L'Éditeur atteste par écrit de la suppression. ***(État réel au 2026-11-19 : une procédure de fin de contrat existe désormais — inventaire par catégorie, pré-conditions, suppression en une transaction, procès-verbal d'empreinte vérifiable valant attestation écrite — mais elle n'est PAS ACTIVÉE : elle ne s'exécute que par l'outil de l'Éditeur, en simulation par défaut, n'a été appliquée que sur des bases d'essai temporaires, jamais sur des données conservées, et la suppression des objets du stockage n'a jamais été exercée contre un stockage réel. Elle ne supprime pas tout : le journal d'audit, la facturation, le registre des restitutions et le procès-verbal sont CONSERVÉS pour des durées seulement proposées ; les comptes du fournisseur d'identité ne sont pas traités ; les sauvegardes ne sont pas purgées et aucune rotation n'est définie. Le délai (90 jours proposés), les durées de conservation et le sort des sauvegardes restent à arrêter : tant qu'ils ne le sont pas, cette clause ne peut pas être signée telle quelle. Détail : `../conservation.md`, « Fin de contrat ».)***

11.4 `[À TRANCHER : conservation par l'Éditeur, après la fin du contrat, des éléments nécessaires à sa propre défense (journal des accès du support, preuves d'exécution) : durée, fondement, périmètre]` *(État réel : la procédure conserve le journal d'audit du Cabinet, le registre de ses restitutions, ses politiques de conservation déclarées, les éléments de facturation et le procès-verbal de fin de contrat ; les traces de la passerelle d'IA sont conservées sans identifiant de personne ni de dossier. Durées proposées dans `../conservation.md`, non arrêtées ; la destruction de ces éléments à leur terme n'est pas conçue.)*

### Article 12 — Documentation et audits (art. 28 §3 h))

12.1 L'Éditeur met à la disposition du Cabinet les informations nécessaires pour démontrer le respect du présent contrat.

12.2 Le Cabinet peut réaliser ou faire réaliser par un auditeur mandaté des audits, y compris des inspections ; l'Éditeur y contribue. Modalités : `[À TRANCHER : préavis de 30 jours ; une fois par an sauf incident ; auditeur soumis à confidentialité et non concurrent ; répartition des coûts ; possibilité de satisfaire la demande par un rapport d'audit tiers ; limites tenant à la protection des données des autres cabinets]`.

12.3 Le Cabinet dispose en permanence, dans le service, de son journal d'audit et du résultat de la vérification de son intégrité. *(État réel : en place ; aucun ancrage externe du journal.)*

### Article 13 — Registre et coopération

L'Éditeur tient le registre prévu à l'article 30 §2 du RGPD et coopère avec la CNIL à sa demande (art. 31). Il communique au Cabinet l'identité de son délégué à la protection des données s'il en a désigné un. `[À COMPLÉTER]`

### Article 14 — Obligations du Cabinet

Le Cabinet : fournit les informations de l'annexe 1 ; s'assure de la licéité des traitements qu'il confie et de l'information des personnes ; gère les comptes et habilitations de ses utilisateurs ; `[OPTION B : garantit avoir l'autorisation de ses clients]` ; désigne un contact pour les incidents et les demandes de droits ; ne dépose dans le service que des données nécessaires à ses missions `[À TRANCHER : exclusion de certaines catégories — données de santé, pièces sans rapport avec la mission]`.

### Article 15 — Responsabilité

`[À TRANCHER : articulation avec la clause de responsabilité du contrat de service ; l'article 82 du RGPD régit la réparation due aux personnes concernées et ne peut être écarté à leur égard ; plafonds entre les parties, exclusions, assurance — voir secret-professionnel-responsabilites.md §4]`

### Article 16 — Durée, droit applicable

Le présent contrat dure aussi longtemps que l'Éditeur traite des données pour le compte du Cabinet, y compris pendant la période de restitution. Droit français. `[À COMPLÉTER : juridiction ; conciliation préalable]`

---

## Annexe 1 — Description du traitement

| Rubrique | Contenu |
|---|---|
| Objet | Fourniture du service Comtaple : collecte de pièces, import de données comptables et bancaires, contrôles, révision, restitution |
| Durée | Durée du contrat de service, augmentée de la période de restitution |
| Nature des opérations | Collecte, enregistrement, organisation, conservation, extraction, consultation, rapprochement, mise à disposition, restitution, `[à terme : effacement]` |
| Finalités | Voir `registre-traitements.md` §3, lignes ST-1 à ST-16, en retirant les fonctions non activées |
| Fonctions non activées à la date du projet | Fonctions d'IA (ST-15) ; messagerie (ST-7) tant qu'aucune boîte n'est connectée |
| Types de données | Voir `registre-traitements.md` §2.2 |
| Catégories particulières | Non recherchées ; présence fortuite possible dans les pièces (`registre-traitements.md` §2.3) |
| Catégories de personnes | Voir `registre-traitements.md` §2.1 |
| Qualité du Cabinet par mission | `[À COMPLÉTER par le Cabinet : responsable / sous-traitant de son client]` |
| Durées de conservation | Fixées par le Cabinet ; valeurs proposées dans `../conservation.md` ; **aucune durée n'est appliquée automatiquement par le logiciel à ce jour** |
| Contacts | Cabinet : `[À COMPLÉTER]` — Éditeur : `[À COMPLÉTER]` |

## Annexe 2 — Mesures techniques et organisationnelles

À reprendre de `registre-traitements.md` §6 au jour de la signature, en distinguant strictement :

- les mesures en place et vérifiées ;
- les mesures prévues, avec leur date d'effet ;
- les limites connues (voir `../risques.md`, risques R3, R5, R6, R7, R16).

Mesures que le contrat ne peut pas affirmer au 2026-11-19 parce qu'elles n'existent pas : second facteur d'authentification imposé ; chiffrement des sauvegardes ; chiffrement au repos chez l'hébergeur ; supervision et détection ; test d'intrusion ; archivage externe du journal d'audit ; purge.

Organisation à définir : `[À COMPLÉTER : politique d'habilitation interne de l'Éditeur, sensibilisation, gestion des postes, gestion des secrets, plan de continuité, objectifs de perte de données admissible et de délai de reprise — non définis]`.

## Annexe 3 — Sous-traitants ultérieurs

Reprendre `sous-traitants.md` §1 au jour de la signature. À la date du projet : **aucun sous-traitant ultérieur n'est contracté** ; deux sont prévus (hébergement, inférence d'IA), sous réserve de vérification de leurs conditions.

---

## Table de concordance avec l'article 28 §3

| Exigence | Article du projet |
|---|---|
| Objet, durée, nature, finalité, types de données, catégories de personnes | 1, annexe 1 |
| a) instructions documentées, transferts | 3, 7 |
| b) confidentialité | 4 |
| c) sécurité (art. 32) | 5, annexe 2 |
| d) sous-traitants ultérieurs (§2 et §4) | 6, annexe 3 |
| e) aide pour les droits des personnes | 8 |
| f) aide pour les articles 32 à 36 | 9, 10 |
| g) suppression ou renvoi en fin de prestation | 11 |
| h) information, audits ; alerte sur une instruction illicite | 12, 3.3 |

## Références

Consultées le 2026-11-19.

- RGPD, art. 28, 30, 31, 32, 33, 82 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- Décision d'exécution (UE) 2021/915 de la Commission du 4 juin 2021 (JO L 199 du 7.6.2021, p. 18) : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32021D0915>
- CNIL, « Clauses contractuelles types entre responsable de traitement et sous-traitant » (page du 30 juin 2021) : <https://www.cnil.fr/fr/clauses-contractuelles-types-entre-responsable-de-traitement-et-sous-traitant>
- CNIL, « Guide du sous-traitant », édition septembre 2017, contenant un exemple de clauses : <https://www.cnil.fr/sites/default/files/atoms/files/rgpd-guide_sous-traitant-cnil.pdf> — l'exemple de clauses n'a pas été recopié ; la trame ci-dessus suit directement l'article 28.
