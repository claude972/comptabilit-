# Guide de connexion — Gmail et Microsoft 365

Ce guide décrit ce qu'un humain doit faire pour que les connecteurs fonctionnent avec les services réels.
Les numéros `G…` / `M…` renvoient à [sources.md](./sources.md) (pages officielles consultées le 2026-11-19).

> **État actuel : `non_connecte` pour les deux fournisseurs.** Le paquet n'a été exécuté que contre son simulateur de test.
> Rien de ce qui suit n'a été essayé avec de vrais identifiants.
>
> Les règles (scopes, durées, limites, obligations de vérification) sont tirées des pages officielles citées. En revanche, les **intitulés de menus**
> des consoles Google Cloud et Microsoft Entra sont donnés de mémoire et n'ont pas été contrôlés à l'écran : ils peuvent avoir changé.

## 1. Ce que l'intégrateur doit fournir

| Élément | Rôle |
|---|---|
| `MagasinConnexions` | Lire / enregistrer l'état d'une connexion (statut, jetons chiffrés, curseurs, surveillance). Prévoir un verrou par connexion entre processus. |
| `RecepteurPieces` | `pieceDejaVue`, `deposer` (enregistre le triplet connexion / message / pièce de façon atomique avec le dépôt), `signaler`. |
| `Journal` | Reçoit des événements techniques (aucun jeton, aucun contenu, adresses masquées). |
| `MemoireEmpreintes` (facultatif) | Compte les messages distincts où une petite image a été vue (logo répété). |
| Clé de chiffrement | 32 octets aléatoires + un identifiant de clé (`Trousseau`). |
| Secret de `state` | 32 octets au moins, pour lier le `state` OAuth à la session. |
| Trois points d'entrée HTTP | Retour OAuth ; push Pub/Sub (Gmail) ; notifications Graph (changements et cycle de vie). |
| Deux tâches planifiées | `synchroniser` périodique pour chaque connexion active (rattrapage ; seul mécanisme pour les boîtes partagées) ; `entretenirSurveillance` une fois par jour. |

Variables de configuration attendues (noms proposés, à déclarer par l'intégrateur) :

| Variable | Contenu |
|---|---|
| `MAIL_CLE_CHIFFREMENT_ID`, `MAIL_CLE_CHIFFREMENT` | Identifiant et clé AES-256 (32 octets, base64). Anciennes clés à conserver pendant une rotation. |
| `MAIL_SECRET_ETAT` | Secret du `state` (≥ 32 octets). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_URI_REDIRECTION` | Client OAuth « application Web ». |
| `GOOGLE_SUJET_PUBSUB` | `projects/<projet>/topics/<sujet>`. Absent : pas de notifications, synchronisation périodique seule. |
| `GOOGLE_PUSH_AUDIENCE`, `GOOGLE_PUSH_COMPTE_SERVICE` | Audience et compte de service du push authentifié, passés à `validerPushPubSub`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_URI_REDIRECTION` | Inscription d'application Entra. |
| `MICROSOFT_LOCATAIRE` | `common` (défaut), `organizations` ou identifiant de locataire. |
| `MICROSOFT_URL_NOTIFICATION`, `MICROSOFT_URL_CYCLE_DE_VIE` | URL HTTPS publiques. Absentes : synchronisation périodique seule. |

Ne jamais passer d'autres URL que les URL officielles (valeurs par défaut des adaptateurs) hors des tests.

## 2. Google — Gmail / Google Workspace

### 2.1 Configuration de test (utilisateurs de test, non diffusable)

1. **Google Cloud Console** : créer un projet, activer **Gmail API** et **Cloud Pub/Sub API**.
2. **Écran de consentement OAuth** (Google Auth Platform) : type d'utilisateur **External**, statut de publication **Testing**.
   Ajouter les comptes de test (100 au plus, G13). Déclarer le scope `https://www.googleapis.com/auth/gmail.readonly`.
3. **Identifiants** : créer un ID client OAuth de type **Application Web** ; URI de redirection autorisée = `GOOGLE_URI_REDIRECTION`
   (correspondance exacte).
4. **Pub/Sub** :
   - créer un sujet ; lui donner le droit de **publication** pour `gmail-api-push@system.gserviceaccount.com` (G16) ;
     une politique d'organisation de partage restreint au domaine peut l'empêcher et demander une exception ;
   - créer un abonnement **push** vers le point d'entrée de Comtaple, avec **authentification** : choisir un compte de service
     (`GOOGLE_PUSH_COMPTE_SERVICE`) et une audience (`GOOGLE_PUSH_AUDIENCE`). L'agent de service Pub/Sub doit pouvoir créer des jetons pour ce compte
     (`roles/iam.serviceAccountTokenCreator`, G25).
5. Limites de ce mode : **le jeton de rafraîchissement expire au bout de 7 jours** (G12) — les connexions passeront en `revoque` chaque semaine,
   c'est attendu ; écran « application non vérifiée » ; aucun utilisateur hors liste.

Exception utile : un cabinet qui a **son propre** Google Workspace peut créer l'application en type **Internal** dans son organisation ;
elle n'est alors pas soumise à la vérification (G3, exemptions), mais ne sert qu'à cette organisation.

### 2.2 Diffusion publique

`gmail.readonly` est un scope **restreint** (G1) et il n'existe pas de scope plus étroit pour lire les pièces jointes (G2). Il faut donc :

1. **Vérification de la marque** : domaine vérifié dans Search Console, page d'accueil publique, politique de confidentialité sur le même domaine.
2. **Vérification des scopes restreints** : justification du besoin, vidéo de démonstration du parcours de consentement (non répertoriée, en anglais),
   conformité aux règles d'« usage limité » (pas de transfert ni de lecture humaine hors des cas prévus, pas de publicité). Délai annoncé : plusieurs semaines.
3. **Évaluation de sécurité (CASA)** : obligatoire car Comtaple traite les données sur ses serveurs (G3) ; réalisée par un évaluateur agréé par Google,
   **à refaire au moins tous les 12 mois** (G4). **Coût : non indiqué par les pages officielles (G5)** — à demander aux évaluateurs.
4. Passer le statut de publication à **In production**.

Tant que la vérification n'est pas obtenue, l'application reste plafonnée (100 utilisateurs, G13).

### 2.3 Fonctionnement et limites

- Surveillance : `users.watch` restreint aux libellés surveillés, renouvelé chaque jour (expiration à 7 jours, G15). La notification ne contient
  que l'adresse et un `historyId` ; elle déclenche `synchroniser`, qui repart toujours du curseur mémorisé.
- Historique trop ancien (404) : resynchronisation complète bornée par le libellé et la date de début (G18).
- Révocation : `supprimerConnexion` appelle le point de révocation de Google puis efface les jetons. Révoquer retire l'accès de tout le projet
  pour cet utilisateur (G11).

## 3. Microsoft — Microsoft 365 / Outlook

### 3.1 Configuration de test

1. **Centre d'administration Microsoft Entra → Inscriptions d'applications → Nouvelle inscription**. Types de comptes pris en charge :
   un seul locataire pour un test interne, ou « tout annuaire + comptes personnels » si `MICROSOFT_LOCATAIRE=common`.
2. **Authentification** : plateforme **Web**, URI de redirection = `MICROSOFT_URI_REDIRECTION`. Ne pas activer le flux implicite.
3. **Certificats et secrets** : créer un secret client (noter sa date d'expiration) — Microsoft recommande plutôt un certificat ; le paquet ne gère que le secret.
4. **Autorisations d'API → Microsoft Graph → déléguées** : `Mail.Read`, `offline_access`, `openid`, `profile`.
   Ajouter `Mail.Read.Shared` **seulement** si des boîtes partagées doivent être proposées. Aucune de ces permissions n'exige en elle-même
   le consentement d'un administrateur (M5, M6), mais un locataire peut interdire le consentement des utilisateurs : dans ce cas,
   un administrateur doit l'accorder.
5. Points d'entrée HTTPS publics pour les notifications ; ils doivent répondre à la validation (`repondreValidationGraph`) en moins de 10 secondes
   et accuser chaque notification en moins de 3 secondes (M14, M15) : mettre en file, répondre `202`, traiter ensuite.

Dans le locataire où l'application est inscrite, les utilisateurs peuvent en général consentir directement : c'est la configuration de test.

### 3.2 Diffusion publique (clients dans d'autres locataires)

1. **Vérification de l'éditeur** : associer un compte Microsoft AI Cloud Partner Program vérifié à l'inscription d'application, avec un domaine d'éditeur
   vérifié. **Gratuit** (M24). Sans elle, les utilisateurs d'autres locataires ne peuvent le plus souvent pas consentir eux-mêmes : il faut alors le
   consentement de leur administrateur.
2. Prévoir le parcours « consentement administrateur » pour les cabinets dont le locataire bloque le consentement des utilisateurs.
3. Renouveler le secret client avant son expiration.

### 3.3 Boîtes partagées

- Choisir une boîte partagée déclenche une **nouvelle demande de consentement explicite** incluant `Mail.Read.Shared` (comptes professionnels uniquement, M6).
  Si la configuration désigne une boîte partagée alors que ce scope n'a pas été accordé, `synchroniser` renvoie `consentement_requis` et ne fait aucun appel.
- **Pas de notifications** : les permissions déléguées de partage ne permettent pas de s'abonner (M9). Le paquet n'utilise pas la permission
  d'application `Mail.Read`, qui donnerait accès à toutes les boîtes du locataire. Les messages arrivent donc au rythme de la tâche périodique.
- La requête delta sur un dossier partagé avec `Mail.Read.Shared` n'est pas explicitement documentée (M10) : **premier point à vérifier en réel**.

### 3.4 Fonctionnement et limites

- Abonnement par dossier surveillé, durée demandée 6 jours (maximum : 10 080 minutes, M13), renouvelé quand il reste moins de 48 h ;
  `clientState` aléatoire par connexion, conservé chiffré avec les jetons.
- Cycle de vie : `reauthorizationRequired` → renouvellement ; `subscriptionRemoved` → nouvel abonnement puis rattrapage ; `missed` → rattrapage (M17).
- Révocation : Microsoft n'offre pas de point de révocation à l'application (M22). `supprimerConnexion` supprime abonnements et jetons, et renvoie
  le texte des démarches restantes : l'utilisateur retire l'application depuis « Mes applications » (ou la page de confidentialité de son compte
  personnel) ; un administrateur peut retirer le consentement dans Entra ou révoquer les sessions.

## 4. Permissions accordées et filtres du logiciel

Le jeton donne accès **en lecture à toute la boîte**. Dossiers, libellés, expéditeurs, objet et date de début sont des filtres appliqués par Comtaple :
ils ne restreignent pas le jeton. `decrirePerimetre(connexion)` renvoie les deux listes séparément et un texte prêt à afficher ; l'interface ne doit
jamais présenter un filtre comme une limite technique de l'autorisation.

## 5. Règles internes de sélection des pièces

Ces seuils sont des choix de Comtaple (constante `REGLES_INTERNES_PIECES`), sans valeur normative.

| Règle | Effet |
|---|---|
| Types retenus | PDF ; images JPEG, PNG, TIFF, WebP ; XML. D'après l'extension, puis le type MIME déclaré. |
| Archives et exécutables (zip, rar, 7z, exe, js, docm, xlsm…) | Ignorés **et signalés**. La dernière extension fait foi (`facture.pdf.exe` est un exécutable). |
| Taille maximale (25 Mo par défaut) | Au-delà : ignorée et signalée, sans téléchargement. |
| Image en ligne de moins de 100 Ko | Écartée. « En ligne » = `Content-ID` référencé par `cid:` dans le HTML ou disposition `inline` (Gmail) ; `isInline` (Microsoft). |
| Nom décoratif | `image001.png`, `Outlook-….png`, `logo…`, `signature…`, `banniere…`, noms de réseaux sociaux : écartée. |
| Image de moins de 5 Ko | Écartée. |
| Image de 150 Ko au plus | Lue en mémoire : écartée si sa largeur ou sa hauteur est inférieure à 200 px (PNG et JPEG seulement). |
| Logo répété | Avec `MemoireEmpreintes` : une image de 150 Ko au plus vue dans 3 messages distincts est écartée à partir de la troisième fois (les deux premières ont été déposées). |
| Autres types (docx, ics…) | Ignorés sans signalement. |

Limites connues : une photo de reçu de moins de 100 Ko insérée dans le corps du message est écartée ; les dimensions des TIFF et WebP ne sont pas lues ;
côté Microsoft, un message dont toutes les pièces sont « en ligne » n'est pas exploré (`hasAttachments` vaut faux, M19).

**Facture derrière un lien** : pour un message sans pièce retenue, un lien dont l'ancre ou le texte voisin évoque à la fois un document comptable et
une action de consultation produit un signalement `facture_derriere_lien` avec le **domaine** seul. Le lien n'est jamais suivi : l'accès réseau du paquet
est limité aux hôtes du fournisseur.

**Rattachement** : uniquement les règles explicites (expéditeur → dossier, adresse de destination → dossier, dossier par défaut). Zéro ou plusieurs
dossiers possibles → `a_qualifier`. L'adresse d'expéditeur est celle de l'en-tête `From`, qui peut être falsifiée : une règle par expéditeur ne vaut pas
authentification.
