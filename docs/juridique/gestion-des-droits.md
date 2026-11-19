# Procédure d'exercice des droits des personnes

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Cette procédure n'a jamais été exercée : aucune donnée réelle n'est traitée et aucune personne n'a été désignée pour l'appliquer. Elle décrit ce que le logiciel permet réellement au 2026-11-19 et ce qui manque.

## 1. Principes

- Les droits s'exercent auprès du responsable du traitement. Pour les données des dossiers, c'est le Cabinet (ou l'Entité cliente, selon l'issue de `roles-rgpd.md` §5). L'Éditeur, sous-traitant, aide le responsable (RGPD, art. 28 §3 e)) et ne répond pas sur le fond à sa place.
- L'Éditeur répond lui-même pour les traitements dont il est responsable (relation commerciale, facturation, et selon arbitrage : sécurité, support).
- Délai : le responsable informe la personne des mesures prises dans les meilleurs délais et au plus tard un mois après réception ; ce délai peut être prolongé de deux mois selon la complexité et le nombre des demandes, à condition d'en informer la personne dans le premier mois (art. 12 §3). Un refus doit être motivé et indiquer les voies de recours (art. 12 §4).
- Gratuité, sauf demande manifestement infondée ou excessive (art. 12 §5).
- Identité : pas de pièce d'identité exigée par principe ; vérification proportionnée, seulement en cas de doute raisonnable (CNIL ; art. 12 §6).

## 2. Qui peut demander quoi

| Demandeur | Données en cause | Interlocuteur |
|---|---|---|
| Collaborateur du Cabinet | Son compte, ses actions tracées au journal, ses commentaires et décisions | Le Cabinet (son employeur) |
| Utilisateur de l'Entité cliente (déposant, lecture) | Son compte, ses dépôts, ses traces | Le Cabinet `[ou l'Entité cliente — À TRANCHER]` |
| Personne citée dans une pièce ou une écriture (salarié, fournisseur individuel, client particulier, dirigeant) | Mentions dans les originaux, les extractions, les écritures, les mouvements bancaires | L'Entité cliente ou le Cabinet selon la qualification |
| Correspondant d'une boîte connectée (fonction non activée) | Métadonnées de messages, pièces jointes retenues | Le Cabinet |
| Contact commercial du Cabinet | Données de la relation commerciale et de facturation | L'Éditeur |
| Personnel de l'Éditeur (compte support) | Compte, traces d'accès | L'Éditeur |

## 3. Circuit

### 3.1 Demande reçue par le Cabinet

1. Le Cabinet enregistre la demande (date, demandeur, droit invoqué, dossiers concernés) dans son propre registre des demandes — **le logiciel ne propose pas de registre des demandes**.
2. Il vérifie l'identité et la qualité du demandeur.
3. Il cherche les données avec les fonctions du §4.
4. S'il a besoin d'une opération que le service n'offre pas, il saisit l'Éditeur par `[À COMPLÉTER : canal]`. L'Éditeur accuse réception sous `[À TRANCHER : 2 jours ouvrés]` et répond sous `[À TRANCHER : 10 jours ouvrés]`, pour laisser au Cabinet le temps de répondre dans le mois.
5. Le Cabinet répond à la personne.

### 3.2 Demande reçue par l'Éditeur pour des données de dossier

1. L'Éditeur n'accède pas aux données pour instruire la demande.
2. Il la transmet au Cabinet concerné sous `[À TRANCHER : 3 jours ouvrés]` et en informe le demandeur, sans confirmer ni infirmer la présence de données (le seul fait qu'une entreprise soit cliente d'un cabinet est couvert par le secret professionnel du Cabinet).
3. S'il ne peut pas identifier le Cabinet, il demande des précisions au demandeur.
4. Il consigne la demande et sa transmission. `[À COMPLÉTER : registre de l'Éditeur — à créer]`

### 3.3 Demande reçue par l'Éditeur pour ses propres traitements

Traitée par `[À COMPLÉTER : personne désignée]` dans le délai d'un mois.

## 4. Ce que le logiciel permet réellement, droit par droit

| Droit (RGPD) | Ce qui existe | Ce qui manque |
|---|---|---|
| **Accès** (art. 15) | Recherche plein texte dans les pièces, écritures et constats des dossiers où l'utilisateur est habilité ; consultation et téléchargement des originaux ; consultation du journal d'audit par les gestionnaires ; restitution d'un dossier ou du cabinet (archive ZIP : originaux, données structurées, journal d'audit du périmètre, manifeste) | Aucun export « par personne » : il faut chercher par nom, dossier par dossier (la recherche ne couvre pas un portefeuille de dossiers en une fois). Une archive de restitution contient les données de nombreux tiers : elle ne peut pas être remise telle quelle au demandeur (droits d'autrui, art. 15 §4 ; secret professionnel). Pas d'export des données de compte d'un utilisateur depuis l'application. Les sauvegardes et journaux techniques ne sont pas interrogeables par personne. |
| **Rectification** (art. 16) | Données extraites d'une pièce : correction versionnée par un collaborateur, validation par un réviseur (l'ancienne version est conservée). Rôle et statut d'un membre : modifiables par un administrateur. | Les originaux ne sont jamais modifiés (par conception : valeur de preuve). Les écritures importées ne se corrigent que par un nouvel import (nouveau lot, les anciens lots sont conservés). L'identité d'un compte (nom, adresse) se modifie dans Keycloak, par l'Éditeur : pas d'écran pour le Cabinet ni pour l'utilisateur. Le journal d'audit ne peut pas être rectifié. `[À TRANCHER : la rectification d'une pièce comptable reçue d'un tiers est-elle seulement possible ; mention complémentaire plutôt que modification]` |
| **Effacement** (art. 17) | Abandon d'un téléversement non terminé (morceaux supprimés). Déconnexion d'une boîte de messagerie (jetons supprimés). Retrait d'une habilitation ; désactivation d'un membre. Suppression des notifications archivées par une opération explicite de l'Éditeur. | **Aucune purge automatique. Aucune fonction d'effacement d'une pièce, d'un dossier, d'un cabinet ou d'un compte.** Les originaux, extractions, lots et versions sont conservés sans limite. Le journal d'audit est techniquement non supprimable, y compris par le propriétaire des tables. Les sauvegardes ne sont pas purgées. Rien n'est supprimé à la résiliation. Un effacement demanderait aujourd'hui une intervention manuelle de l'Éditeur en base et dans le stockage, non outillée, non testée, et qui laisserait le journal intact. |
| **Limitation** (art. 18) | Statuts de pièce (`quarantaine`, `a_completer`) et annulation réversible d'un import : ces mécanismes retirent une donnée des travaux courants mais n'ont pas été conçus pour la limitation. | Aucun marquage « traitement limité » au sens de l'article 18 ; aucune restriction d'accès ciblée sur les données d'une personne. |
| **Portabilité** (art. 20) | Restitution : originaux dans leur format d'origine, données structurées en JSON / JSON Lines, écritures en CSV, manifeste d'empreintes. | Conçue pour la réversibilité du Cabinet, pas pour une personne. Ne porte que sur un dossier ou un cabinet. `[À TRANCHER : le droit à la portabilité ne vise que les données fournies par la personne, traitées par des moyens automatisés sur le fondement du consentement ou du contrat (art. 20 §1) — son champ réel ici est probablement étroit (comptes, dépôts d'un déposant)]` |
| **Opposition** (art. 21) | Préférences de notification par famille. | Aucun mécanisme d'opposition à un traitement. `[À TRANCHER : champ du droit selon la base légale retenue par le responsable ; il ne joue pas quand le traitement repose sur une obligation légale]` |
| **Décision individuelle automatisée** (art. 22) | Par conception, aucune décision n'est prise sans intervention humaine : les contrôles produisent des constats soumis à revue, les rapprochements sont des propositions validées par un réviseur, aucune écriture n'est générée automatiquement. | — `[À TRANCHER : confirmer que l'article 22 ne s'applique pas, y compris quand les fonctions d'IA seront activées]` |
| **Information** (art. 13 et 14) | — | Aucune mention d'information dans l'application ; aucune politique de confidentialité rédigée. |
| **Directives post-mortem** (loi n° 78-17) | — | Non traité. Référence non revérifiée en ligne le 2026-11-19. |

## 5. Notification des rectifications et effacements (art. 19)

Le responsable notifie à chaque destinataire toute rectification, tout effacement ou toute limitation. Destinataires possibles ici : les utilisateurs de l'Entité cliente ayant accès au dossier ; les détenteurs d'une archive de restitution déjà téléchargée (le logiciel trace qui a demandé et téléchargé une archive, mais ne maîtrise plus la copie). `[À COMPLÉTER : consigne au Cabinet]`

## 6. Effacement et obligations de conservation : le conflit à arbitrer

Trois obstacles à l'effacement, de natures différentes :

1. **Juridique** — Le droit à l'effacement ne s'applique pas dans la mesure où le traitement est nécessaire pour respecter une obligation légale ou pour la constatation, l'exercice ou la défense de droits en justice (art. 17 §3 b) et e)). Les documents comptables et pièces justificatives sont soumis à une conservation de dix ans (Code de commerce, art. L. 123-22 — voir `../conservation.md`). La plupart des demandes d'effacement portant sur une pièce comptable devraient donc être refusées, de façon motivée, pendant cette durée. `[À TRANCHER : sur qui pèse l'obligation — l'Entité cliente — et dans quelle mesure le Cabinet et l'Éditeur peuvent s'en prévaloir]`
2. **Technique, levable** — L'absence de fonction de suppression et de purge à l'échéance. À développer : la conservation illimitée actuelle n'est pas tenable au regard du principe de limitation de la conservation (art. 5 §1 e)) ; c'est le risque R9 de `../risques.md`.
3. **Technique, structurel** — Le journal d'audit en ajout seul et chaîné. Il contient des identifiants d'utilisateurs et des références d'objets. Pistes : n'y porter que des identifiants techniques et dissocier l'identité civile dans une table effaçable (pseudonymisation à l'échéance) ; clore et archiver le journal par périodes pour pouvoir détruire une période échue sans rompre la vérification des suivantes. Rien de cela n'est conçu. `[À TRANCHER : durée du journal — ../conservation.md — et acceptabilité d'une pseudonymisation plutôt que d'un effacement]`

Même arbitrage pour les sauvegardes : une donnée effacée en base reste dans les sauvegardes jusqu'à leur rotation ; pratique à décrire à la personne et durée de rotation à fixer.

## 7. À faire avant mise en service

| # | Action | Responsable |
|---|---|---|
| 1 | Désigner le point de contact de l'Éditeur et l'adresse dédiée | Éditeur |
| 2 | Rédiger les mentions d'information (application, contrat) | Éditeur / Cabinet, validation juridique |
| 3 | Créer le registre des demandes de l'Éditeur | Éditeur |
| 4 | Développer : suppression d'une pièce et d'un dossier sous contrôle, purge à l'échéance, suppression à la résiliation, export des données d'un compte | Éditeur |
| 5 | Décider du traitement du journal d'audit et des sauvegardes | Éditeur, avec avis juridique |
| 6 | Fournir au Cabinet un mode opératoire de réponse (recherche, extraction, masquage des tiers) | Éditeur |

## Références

Consultées le 2026-11-19.

- RGPD, art. 5 §1 e), 12 à 22, 28 §3 e) : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- CNIL, « Professionnels : comment répondre à une demande de droit d'accès ? » (page du 13 juin 2017, mise à jour depuis) : <https://www.cnil.fr/fr/professionnels-comment-repondre-une-demande-de-droit-dacces>
- Code de commerce, art. L. 123-22 : référence non revérifiée sur Légifrance le 2026-11-19 (accès automatisé refusé) ; durée de dix ans confirmée par la fiche Service-Public F10029 (voir `../conservation.md`).
- Loi n° 78-17 du 6 janvier 1978 : référence non revérifiée en ligne le 2026-11-19.
