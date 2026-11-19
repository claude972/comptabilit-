# Sources — points vérifiés dans la documentation officielle

Toutes les pages ont été consultées le **2026-11-19**. « Vérifié » signifie : la page officielle l'énonce. Cela ne signifie
**pas** que le comportement a été observé sur les services réels : aucun appel réel n'a été fait (voir la fin du document).

Abréviations : `GW` = `https://developers.google.com/workspace/gmail/api`, `GI` = `https://developers.google.com/identity/protocols/oauth2`,
`MG` = `https://learn.microsoft.com/en-us/graph`, `ME` = `https://learn.microsoft.com/en-us/entra/identity-platform`.

## Google / Gmail

| # | Affirmation | URL officielle | État |
|---|---|---|---|
| G1 | `https://www.googleapis.com/auth/gmail.readonly` est un scope **restreint** (« Read messages and settings »). | GW/auth/scopes | Vérifié |
| G2 | Aucun scope plus étroit ne suffit : `gmail.metadata` est lui aussi restreint et ne donne pas le corps (« but not the email body ») ; `messages.attachments.get` n'accepte que `mail.google.com`, `gmail.modify`, `gmail.readonly`. | GW/auth/scopes ; GW/reference/rest/v1/users.messages.attachments/get | Vérifié |
| G3 | Les scopes restreints exigent la vérification de l'application ; une évaluation de sécurité est requise si les données restreintes sont stockées ou transmises par un serveur. | GW/auth/scopes ; GI/production-readiness/restricted-scope-verification | Vérifié |
| G4 | Évaluation de sécurité (CASA) par des évaluateurs agréés par Google, à refaire au moins tous les 12 mois ; vérification « several weeks ». | GI/production-readiness/restricted-scope-verification ; https://support.google.com/cloud/answer/13465431 | Vérifié |
| G5 | Coût de l'évaluation CASA. | mêmes pages ; https://www.appdefensealliance.org/standards/casa | **Non vérifié** : aucun prix n'est indiqué sur les pages officielles consultées |
| G6 | Points OAuth : autorisation `https://accounts.google.com/o/oauth2/v2/auth`, jetons `https://oauth2.googleapis.com/token`, révocation `https://oauth2.googleapis.com/revoke`, clés `https://www.googleapis.com/oauth2/v3/certs`. | https://accounts.google.com/.well-known/openid-configuration ; GI/web-server | Vérifié |
| G7 | `access_type=offline` nécessaire pour le jeton de rafraîchissement ; celui-ci n'est renvoyé qu'à la première autorisation, sinon `prompt=consent`. | GI/web-server | Vérifié |
| G8 | Consentement granulaire : l'utilisateur peut n'accorder qu'une partie des scopes ; contrôler le champ `scope` de la réponse. | GI/web-server | Vérifié |
| G9 | PKCE : `code_challenge_method` `S256` ou `plain`, vérifieur de 43 à 128 caractères non réservés ; `S256` figure dans `code_challenge_methods_supported`. | GI/native-app ; document de découverte | Vérifié |
| G10 | PKCE pour un client **web (confidentiel)** Google. | GI/web-server | **Non vérifié** : la page « web server » ne mentionne pas PKCE. Le paquet l'envoie quand même (annoncé par la découverte) ; à confirmer en réel |
| G11 | Révocation : `POST` avec `token` (jeton d'accès ou de rafraîchissement), `200` en cas de succès ; révoquer retire tous les scopes accordés au projet. | GI/web-server | Vérifié |
| G12 | Un jeton de rafraîchissement cesse de fonctionner : accès retiré par l'utilisateur, 6 mois sans usage, changement de mot de passe (scopes Gmail), plus de 100 jetons par compte et par client, politique d'administration ; **7 jours** pour une application « External » en statut « Testing ». | GI (section « Refresh token expiration ») ; https://support.google.com/cloud/answer/15549945 | Vérifié |
| G13 | Statut « Testing » : 100 utilisateurs de test au plus ; application non vérifiée : 100 nouveaux utilisateurs au total. | https://support.google.com/cloud/answer/15549945 | Vérifié |
| G14 | `users.watch` : `POST …/users/{userId}/watch`, corps `topicName`, `labelIds`, `labelFilterBehavior` (`include`/`exclude` ; `labelFilterAction` est obsolète) ; réponse `historyId`, `expiration` (millisecondes Unix). | GW/reference/rest/v1/users/watch | Vérifié |
| G15 | Rappeler `watch` au moins tous les 7 jours ; une fois par jour recommandé. | GW/guides/push | Vérifié |
| G16 | Donner le droit de publication sur le sujet à `gmail-api-push@system.gserviceaccount.com`. | GW/guides/push | Vérifié (le nom de rôle « Pub/Sub Publisher » n'est pas écrit sur la page) |
| G17 | Notification : `message.data` en base64url, JSON `{emailAddress, historyId}` ; un événement par seconde et par utilisateur au plus ; notifications parfois retardées ou perdues → prévoir un `history.list` périodique. | GW/guides/push | Vérifié |
| G18 | `users.history.list` : `startHistoryId` obligatoire, `maxResults` 100 par défaut / 500 au plus, `labelId`, `historyTypes` (`messageAdded`, `labelAdded`…) ; **404** si l'identifiant est trop ancien → synchronisation complète ; historique disponible en général au moins une semaine, parfois quelques heures. | GW/reference/rest/v1/users.history/list ; GW/guides/sync | Vérifié |
| G19 | `users.messages.list` : `maxResults` 100 / 500, `q`, `labelIds` (tous les libellés doivent correspondre), `pageToken`. | GW/reference/rest/v1/users.messages/list | Vérifié |
| G20 | Recherche `q` : `after:` accepte des secondes Unix ; les dates `AAAA/MM/JJ` sont interprétées à minuit, heure du Pacifique. | GW/guides/filtering | Vérifié |
| G21 | Message : `internalDate` (millisecondes Unix), `payload` (arbre `MessagePart` : `partId`, `mimeType`, `filename`, `headers`, `body.attachmentId`, `body.data` en base64url). | GW/reference/rest/v1/users.messages | Vérifié |
| G22 | `users.getProfile` renvoie `emailAddress` et `historyId` ; accepté avec `gmail.readonly`. | GW/reference/rest/v1/users/getProfile | Vérifié |
| G23 | Quotas : 1 200 000 unités/min par projet, 6 000 unités/min par utilisateur ; `messages.get` 20 (60 en `full`), `messages.list` 5, `history.list` 2, `attachments.get` 20, `watch` 100. | GW/reference/quota | Vérifié (l'ancienne limite « par seconde » n'apparaît plus) |
| G24 | Erreurs : 403 `rateLimitExceeded` / `userRateLimitExceeded`, 429, 5xx `backendError` → attente exponentielle ; 401 → renouveler le jeton. | GW/guides/handle-errors | Vérifié |
| G25 | Push Pub/Sub authentifié : JWT RS256 dans `Authorization: Bearer`, revendications `iss`, `aud`, `email`, `email_verified`, `exp` ; contrôler signature, audience, compte de service. | https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions | Vérifié |
| G26 | Pub/Sub : livraison « au moins une fois », sans garantie d'ordre ; accusé par les statuts 102, 200, 201, 202, 204. | https://docs.cloud.google.com/pubsub/docs/push ; …/subscription-overview | Vérifié |
| G27 | `partId` stable pour un message alors que `attachmentId` peut changer d'un appel à l'autre. | — | **Non vérifié** (non documenté). Par prudence, l'idempotence s'appuie sur `partId` |

## Microsoft / Graph

| # | Affirmation | URL officielle | État |
|---|---|---|---|
| M1 | Points : `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` et `/token` ; `tenant` = `common`, `organizations`, `consumers` ou identifiant. | ME/v2-oauth2-auth-code-flow | Vérifié |
| M2 | PKCE recommandé pour tous les types d'application, y compris confidentiels ; `S256`. | ME/v2-oauth2-auth-code-flow | Vérifié |
| M3 | `refresh_token` fourni seulement si `offline_access` est demandé ; `id_token` seulement si `openid`. | ME/v2-oauth2-auth-code-flow | Vérifié |
| M4 | Chaque renouvellement renvoie un **nouveau** jeton de rafraîchissement, à substituer à l'ancien. Durée : 90 jours (24 h pour les applications monopage). | ME/v2-oauth2-auth-code-flow ; ME/refresh-tokens | Vérifié |
| M5 | `Mail.Read` délégué : « Read user mail », sans consentement administrateur. | MG/permissions-reference | Vérifié |
| M6 | `Mail.Read.Shared` délégué : « Read user and shared mail », sans consentement administrateur, **comptes professionnels ou scolaires uniquement**. | MG/permissions-reference | Vérifié |
| M7 | Description de `offline_access` dans la référence des permissions Graph. | MG/permissions-reference | **Non vérifié** : absent de cette page (son effet est vérifié en M3) |
| M8 | Lecture d'une boîte ou d'un dossier partagé : `users/{id \| userPrincipalName}/mailFolders/…/messages` avec `Mail.Read.Shared`. | MG/outlook-share-messages-folders | Vérifié |
| M9 | **Les permissions de partage ne permettent pas de s'abonner aux notifications** ; une permission déléguée ne permet de s'abonner qu'à la boîte de l'utilisateur connecté ; pour une autre boîte, il faudrait la permission d'application `Mail.Read` (toutes les boîtes du locataire). | MG/api/subscription-post-subscriptions ; MG/outlook-share-messages-folders | Vérifié |
| M10 | Requête delta sur un dossier partagé (`users/{…}/mailFolders/{id}/messages/delta`) avec `Mail.Read.Shared`. | MG/api/message-delta | **Non vérifié** : la forme `users/{id}` existe mais la page ne cite que `Mail.ReadBasic` / `Mail.Read` |
| M11 | Delta par dossier ; `$select`, `$top`, `Prefer: odata.maxpagesize` ; suivre `@odata.nextLink` jusqu'à `@odata.deltaLink` ; `$filter=receivedDateTime ge …` limité à 5 000 messages ; suppressions en `@removed`. | MG/api/message-delta ; MG/delta-query-messages | Vérifié |
| M12 | Jeton delta périmé : `410 Gone` ou erreur 40x `syncStateNotFound` → synchronisation complète ; pas de durée de validité fixe pour Outlook. | MG/delta-query-overview | Vérifié |
| M13 | Abonnement : `POST /subscriptions` (`changeType`, `notificationUrl`, `lifecycleNotificationUrl`, `resource`, `expirationDateTime`, `clientState` ≤ 128 caractères) ; durée maximale pour les messages Outlook : **10 080 minutes** (« under seven days ») ; 1 000 abonnements actifs par boîte au plus. | MG/api/resources/subscription ; MG/change-notifications-overview | Vérifié |
| M14 | Validation du point de notification : `POST …?validationToken=…`, réponse `200` `text/plain` avec le jeton décodé, sous 10 secondes. | MG/change-notifications-delivery-webhooks | Vérifié |
| M15 | Notification à accuser par un 2xx sous 3 secondes (sinon nouvelles tentatives pendant 4 heures) ; valider `clientState`. | MG/change-notifications-delivery-webhooks | Vérifié |
| M16 | Les notifications **sans** données de ressource ne portent pas de JWT (`validationTokens`) : seule la valeur `clientState` les authentifie. | MG/change-notifications-with-resource-data | Vérifié |
| M17 | Cycle de vie : `reauthorizationRequired` (un seul `PATCH` renouvelle et réautorise ; ne pas enchaîner `reauthorize` et `PATCH` à moins de 10 minutes), `subscriptionRemoved` (recréer puis rattraper par delta), `missed` (resynchroniser) ; pris en charge pour les messages Outlook. | MG/change-notifications-lifecycle-events ; MG/api/subscription-reauthorize | Vérifié |
| M18 | Identifiants immuables : en-tête `Prefer: IdType="ImmutableId"`, stables tant que l'élément reste dans la même boîte ; compatibles delta et abonnements. | MG/outlook-immutable-id | Vérifié |
| M19 | Pièces : `GET …/messages/{id}/attachments` ; contenu brut par `…/attachments/{id}/$value` ; `Mail.Read` ; `fileAttachment` (`name`, `contentType`, `size`, `isInline`, `contentId`). `hasAttachments` ne compte pas les pièces en ligne. | MG/api/attachment-get ; MG/api/message-list-attachments ; MG/api/resources/fileattachment ; MG/api/resources/message | Vérifié |
| M20 | Pagination et `$select` sur la liste des pièces jointes. | MG/api/message-list-attachments | **Non vérifié** : la page dit seulement « supports the OData Query Parameters » |
| M21 | Limites Outlook : 10 000 requêtes par 10 minutes et 4 requêtes simultanées par application et par boîte ; 429 avec `Retry-After` ; sinon attente exponentielle. | MG/throttling-limits ; MG/throttling | Vérifié |
| M22 | Aucun point de révocation de jeton (RFC 7009) côté application : le document de découverte n'a pas de clé `revocation_endpoint`. `revokeSignInSessions` exige `User.RevokeSessions.All` et invalide les jetons de **toutes** les applications de l'utilisateur. | https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration ; MG/api/user-revokesigninsessions | Vérifié (absence constatée ; aucune page ne l'énonce en toutes lettres) |
| M23 | Jeton d'identité : `aud`, `tid`, `nonce`, `exp`, émetteur `https://login.microsoftonline.com/{tid}/v2.0`, clés `…/common/discovery/v2.0/keys` ; `preferred_username` exige le scope `profile`. | ME/id-tokens ; ME/id-token-claims-reference ; document de découverte | Vérifié |
| M24 | Vérification de l'éditeur : gratuite ; sans elle, les utilisateurs d'autres locataires ne peuvent pas consentir à la plupart des applications multilocataires récentes. | ME/publisher-verification-overview | Vérifié |
| M25 | Codes d'erreur Graph exacts (`InvalidAuthenticationToken`, …). | MG/errors | **Non vérifié** : la page ne liste que les statuts HTTP ; le paquet ne s'appuie que sur les statuts (401, 404, 410, 429, 5xx) et sur `syncStateNotFound` (M12) |

## Écarts entre la documentation et le cahier des charges

1. **Scope Gmail plus étroit** : il n'en existe pas (G2). `gmail.readonly` est le minimum.
2. **`nonce`** : il ne s'applique qu'à Microsoft. Pour Gmail, aucun scope OpenID n'est demandé (minimisation) ; l'adresse vient de `users.getProfile`.
3. **Scope `profile` (Microsoft)** ajouté à `openid`, `offline_access`, `Mail.Read` : sans lui, le jeton d'identité ne contient pas l'adresse de connexion (M23). Il ne donne aucun accès aux messages.
4. **Boîtes partagées Microsoft** : aucune notification possible sans passer à une permission d'application couvrant tout le locataire (M9). Le paquet ne le fait pas : synchronisation périodique par delta uniquement.
5. **« Validation du jeton de création »** : il s'agit du `validationToken` renvoyé tel quel (M14). Les notifications de base ne sont pas signées (M16).
6. **Date de début côté Microsoft** : appliquée par le paquet et non par `$filter`, à cause du plafond de 5 000 messages (M11).
7. **Révocation Microsoft** : impossible depuis l'application (M22) ; le paquet efface ses jetons, supprime ses abonnements et dit ce qui reste à faire.
8. **PKCE côté Google** pour un client web : non documenté sur la page concernée (G10).

## Ce qui n'a pas pu être vérifié sans identifiants réels

Aucun appel n'a été fait vers Google ou Microsoft. Tout le comportement réseau n'est vérifié que contre le simulateur local,
écrit à partir de la documentation ci-dessus : une divergence entre le simulateur et les services réels reste possible.
