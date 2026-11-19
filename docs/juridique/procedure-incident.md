# Procédure de gestion d'un incident de sécurité et d'une violation de données

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

État au 2026-11-19 : procédure rédigée, jamais exercée. Aucune personne n'est désignée dans les rôles ci-dessous, aucune astreinte n'existe, aucun outil de détection n'est déployé (pas de supervision, pas d'analyse automatique des journaux). Le logiciel ne tourne qu'en local sur des données synthétiques : aucun incident réel n'a pu survenir.

## 1. Définitions et cadre

- **Violation de données à caractère personnel** : violation de la sécurité entraînant, de manière accidentelle ou illicite, la destruction, la perte, l'altération, la divulgation non autorisée de données ou l'accès non autorisé à de telles données (RGPD, art. 4 §12). Elle touche la confidentialité, l'intégrité ou la disponibilité.
- **Incident de sécurité** : tout événement qui compromet ou menace la sécurité du service, qu'il touche ou non des données personnelles. Tout incident est examiné sous l'angle d'une possible violation.

Obligations selon le rôle :

| Rôle | Obligation | Texte |
|---|---|---|
| Sous-traitant (l'Éditeur, pour les données des dossiers) | Notifier au responsable (le Cabinet) toute violation, dans les meilleurs délais après en avoir pris connaissance. Pas de seuil de risque : toute violation est notifiée au Cabinet. | Art. 33 §2 |
| Responsable (le Cabinet ; l'Éditeur pour ses propres traitements) | Notifier la CNIL dans les meilleurs délais et, si possible, 72 heures au plus tard après en avoir pris connaissance, sauf si la violation n'est pas susceptible d'engendrer un risque pour les droits et libertés ; au-delà de 72 heures, joindre les motifs du retard. | Art. 33 §1 |
| Responsable | Communiquer la violation aux personnes concernées dans les meilleurs délais si elle est susceptible d'engendrer un risque élevé ; exceptions de l'art. 34 §3 (données rendues incompréhensibles, par exemple par chiffrement ; mesures ultérieures écartant le risque ; efforts disproportionnés, avec communication publique à la place). | Art. 34 |
| Responsable | Documenter toute violation, notifiée ou non : faits, effets, mesures. | Art. 33 §5 |

Précisions de la CNIL : le délai de 72 heures court à partir du moment où le responsable a une certitude raisonnable qu'un incident a touché des données personnelles ; si toutes les informations ne sont pas disponibles, une notification initiale est faite puis complétée ; la notification se fait par le téléservice de la CNIL ; le responsable peut confier la notification au sous-traitant mais reste décisionnaire.

Avertissement : une proposition de règlement modifiant le RGPD (« omnibus numérique », procédure 2025/0360(COD)) prévoirait notamment de porter le délai de l'article 33 à 96 heures. Aucune adoption n'a été trouvée ; son état au 2026-11-19 n'a pas été confirmé sur une source officielle. `[À TRANCHER : vérifier le texte en vigueur au moment de la mise en service]`

## 2. Rôles

| Rôle | Mission | Titulaire |
|---|---|---|
| Responsable d'incident | Pilote, décide des mesures, tient la chronologie | `[À COMPLÉTER]` |
| Référent technique | Confinement, analyse, preuves, remise en état | `[À COMPLÉTER]` |
| Référent protection des données (DPO s'il est désigné) | Qualifie la violation, prépare les notifications, tient le registre | `[À COMPLÉTER]` |
| Direction | Arbitre, valide les communications | `[À COMPLÉTER]` |
| Contact d'urgence de chaque Cabinet | Reçoit les notifications | À recueillir à la souscription ; **aucun champ du logiciel ne le porte aujourd'hui** |

`[À COMPLÉTER : suppléances, joignabilité hors heures ouvrées]`

## 3. Sources de détection

Disponibles dans le logiciel :

- Alerte de rupture du journal d'audit (vérification d'intégrité du chaînage, diagnostic consigné).
- Journal d'audit par cabinet : actions, consultations du support.
- Verdicts de l'antivirus et quarantaine.
- Métriques techniques exposées (requêtes par route et code, tâches par file) — **non collectées** : ni Prometheus ni Grafana ne sont déployés.
- Signalement par un utilisateur, un Cabinet ou un fournisseur.

Manquantes : collecte et corrélation des journaux, alertes, détection d'intrusion, surveillance des accès du rôle technique de migration (qui contourne le cloisonnement).

## 4. Déroulé

### Étape 1 — Signalement et ouverture (immédiat)

Toute personne qui constate ou soupçonne un incident prévient le responsable d'incident par `[À COMPLÉTER : canal]`. Celui-ci ouvre une fiche (annexe A) et note l'heure de prise de connaissance : elle fonde le calcul des délais.

### Étape 2 — Confinement (premières heures)

Selon le cas, sans détruire les preuves :

- compte compromis : désactivation du membre, révocation des sessions dans Keycloak, retrait des habilitations ;
- accès support en cause : fermeture de l'accès (`scripts/editeur.mjs support-fermer`), qui retire les habilitations ;
- boîte de messagerie : déconnexion (suppression des jetons) ; révocation côté fournisseur par le Cabinet ;
- secret exposé (clé de chiffrement des jetons, secret OIDC, identifiants de base ou de stockage) : rotation. À noter : changer le secret de chiffrement des jetons rend les jetons stockés illisibles, les boîtes doivent être reconnectées ;
- fichier malveillant : vérifier la quarantaine, ne pas servir le contenu ;
- compromission d'un service : isolement réseau, arrêt du service si nécessaire (les dépôts échouent alors explicitement).

`[À COMPLÉTER : procédures de l'hébergeur une fois la production en place — instantanés, isolement, contact de sécurité]`

### Étape 3 — Qualification (au plus vite, cible : 24 heures)

Questions :

1. Des données personnelles sont-elles touchées ? Lesquelles (catégories du registre) ?
2. Quels Cabinets, quels dossiers ? Le cloisonnement RLS a-t-il été franchi ?
3. Nature : confidentialité, intégrité, disponibilité ?
4. Volume : personnes, enregistrements (ordre de grandeur) ?
5. Les données étaient-elles protégées (chiffrement) ? Aujourd'hui : jetons de messagerie chiffrés ; sauvegardes locales **en clair** ; archives de restitution **non chiffrées** ; chiffrement au repos de production non défini.
6. Conséquences probables pour les personnes : les relevés bancaires, IBAN, données de rémunération et pièces d'identité éventuellement présentes dans les pièces exposent à la fraude et à l'usurpation.
7. Pour le Cabinet : atteinte au secret professionnel (`secret-professionnel-responsabilites.md`).

Preuves à préserver : journal d'audit (et résultat de sa vérification d'intégrité), journaux applicatifs, journaux de Keycloak, journaux de l'hébergeur, instantanés.

### Étape 4 — Notification au Cabinet (sous-traitance)

Dès qu'une violation touchant ses données est établie avec une certitude raisonnable : notification au contact d'urgence du Cabinet, dans le délai contractuel `[À TRANCHER : 24 / 48 heures — contrat-sous-traitance-projet.md art. 10]`, sans attendre la fin de l'analyse. Contenu (annexe B) : nature, catégories et nombre approximatif de personnes et d'enregistrements, conséquences probables, mesures prises ou envisagées, point de contact. Compléments au fil de l'eau.

La notification à un Cabinet ne révèle rien des autres Cabinets touchés.

C'est le Cabinet qui apprécie le risque, notifie la CNIL et informe les personnes. L'Éditeur lui fournit les éléments nécessaires (art. 28 §3 f)).

### Étape 5 — Notification par l'Éditeur comme responsable

Si la violation touche des traitements dont l'Éditeur est responsable (comptes clients, facturation, `[selon arbitrage : comptes utilisateurs et traces de sécurité]`) : appréciation du risque, notification à la CNIL sous 72 heures par le téléservice si un risque existe, information des personnes si le risque est élevé.

Grille indicative d'appréciation (à valider) :

| Situation | Risque proposé | Suite |
|---|---|---|
| Indisponibilité brève sans perte ni accès | Pas de risque | Registre seulement |
| Perte d'un support ou d'une sauvegarde chiffrés, clé non compromise | Faible | Registre ; notification à apprécier |
| Accès d'un utilisateur à un dossier d'un autre cabinet (défaut de cloisonnement) | Risque | Notification du Cabinet ; notification CNIL probable par le Cabinet |
| Exfiltration de pièces (relevés bancaires, factures nominatives), d'une sauvegarde en clair ou d'une archive de restitution | Risque élevé | Notification du Cabinet, de la CNIL, information des personnes à apprécier par le responsable |
| Compromission de comptes (empreintes de mots de passe, export Keycloak) | Risque à risque élevé | Réinitialisation, notifications |
| Altération du journal d'audit ou des originaux | Risque (intégrité, valeur de preuve) | Notification du Cabinet |

### Étape 6 — Autres notifications à examiner

- Assureur de l'Éditeur `[À COMPLÉTER : police, délai de déclaration]`.
- Dépôt de plainte.
- Fournisseurs concernés ; réciproquement, exiger des fournisseurs qu'ils notifient l'Éditeur sans délai (à inscrire dans leurs contrats).
- Le Cabinet apprécie de son côté ses obligations envers ses clients, son assureur et l'Ordre.
- `[À TRANCHER : autres régimes de notification éventuellement applicables à l'Éditeur ou aux Cabinets (cybersécurité, services numériques) — non analysés dans ce projet]`

### Étape 7 — Remise en état

Correction de la cause ; restauration si nécessaire (essais de restauration réalisés en local seulement : base, stockage, Keycloak ; restauration à un instant donné non couverte ; objectifs de reprise non définis — `../deploiement.md`) ; vérification de l'intégrité du journal d'audit et des originaux par leurs empreintes.

### Étape 8 — Clôture et retour d'expérience

Inscription au registre des violations ; revue sous `[À COMPLÉTER : 30 jours]` : cause, délais réels, actions correctives, mise à jour de `../risques.md` et de la présente procédure.

## 5. Registre des violations

Tenu par l'Éditeur pour ses traitements de responsable (art. 33 §5) et, comme sous-traitant, pour tracer ce qu'il a notifié à chaque Cabinet. **Il n'existe pas encore** : ni fichier, ni table. Emplacement : `[À COMPLÉTER — hors du dépôt public]`.

Rubriques proposées (la CNIL indique que son formulaire de notification peut servir de modèle) :

| Rubrique | Contenu |
|---|---|
| Référence, dates | Survenance (estimée), détection, prise de connaissance, clôture |
| Description | Faits, cause, nature (confidentialité / intégrité / disponibilité) |
| Périmètre | Traitements, Cabinets, dossiers, catégories de données et de personnes, volumes approximatifs |
| Effets | Conséquences constatées et probables |
| Mesures | Confinement, correction, prévention |
| Qualité de l'Éditeur | Responsable / sous-traitant |
| Notifications | Cabinets (date, heure, contenu), CNIL (date, référence) ou justification de l'absence de notification, personnes concernées |
| Retard éventuel | Motifs |
| Suites | Actions correctives, responsable, échéance |

Durée de conservation du registre : `[À TRANCHER — aucune durée légale identifiée ; proposition dans ../conservation.md]`.

## 6. Préalables non remplis

| # | Préalable | État |
|---|---|---|
| 1 | Désigner les titulaires des rôles et l'astreinte | Non fait |
| 2 | Recueillir un contact d'urgence par Cabinet | Non prévu dans le logiciel |
| 3 | Déployer la collecte des journaux et des alertes | Non fait |
| 4 | Créer le registre des violations | Non fait |
| 5 | Chiffrer les sauvegardes ; définir le chiffrement au repos | Outil prêt, non activé ; production non définie |
| 6 | Obtenir des fournisseurs un engagement de notification | Aucun contrat |
| 7 | Exercer la procédure (simulation) | Jamais fait |
| 8 | Ouvrir l'accès au téléservice de notification de la CNIL | Non fait |

## Annexe A — Fiche d'incident

```
Référence :
Signalé par / le (date, heure) :
Prise de connaissance (date, heure) :
Description initiale :
Systèmes touchés :
Données personnelles touchées (oui / non / inconnu) :
Cabinets et dossiers touchés :
Mesures de confinement (heure, auteur) :
Preuves préservées :
Qualification (confidentialité / intégrité / disponibilité ; risque) :
Notifications faites (destinataire, date, heure) :
Décisions (heure, auteur) :
Clôture :
```

## Annexe B — Trame de notification au Cabinet

```
Objet : notification d'une violation de données — référence …
1. Ce qui s'est passé (faits établis à ce stade, date et heure de découverte)
2. Données et personnes concernées (catégories, dossiers, ordres de grandeur)
3. Conséquences probables
4. Mesures déjà prises / prévues
5. Ce que nous ne savons pas encore, et quand nous vous écrirons de nouveau
6. Votre interlocuteur
Rappel : il vous appartient d'apprécier la notification à la CNIL (72 heures) et
l'information des personnes ; nous vous fournissons les éléments nécessaires.
```

## Références

Consultées le 2026-11-19.

- RGPD, art. 4 §12, 28 §3 f), 33, 34 : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- CNIL, « Violations de données personnelles : les règles à suivre » (page du 19 juin 2018) : <https://www.cnil.fr/fr/violations-de-donnees-personnelles-les-regles-suivre>
- CEPD, lignes directrices 9/2022 sur la notification de violations de données à caractère personnel en vertu du RGPD, version 2.0 du 4 avril 2023 (page de présentation consultée ; texte non relu) : <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-92022-personal-data-breach-notification-under_fr>
- Proposition « omnibus numérique » (2025/0360(COD)) : état non confirmé sur source officielle le 2026-11-19.
