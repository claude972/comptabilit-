# Recette sur appareils réels, Safari et lecteurs d'écran — à jouer

> **ÉTAT : PRÉPARÉE, JAMAIS JOUÉE.** Aucune des vérifications de ce document n'a été exécutée sur un appareil réel, sur
> Safari lui-même ni avec VoiceOver ou NVDA. Les suites automatisées citées ci-dessous (Chromium, WebKit, émulations
> Pixel 7 et iPhone 15) sont des **émulations** : elles ne prouvent pas ces points (voir `rapport-de-tests.md`,
> `couverture.md` § Écrans). Ce document est la procédure et la fiche de résultat à remplir par la personne qui joue la
> recette. Tant que la fiche de la section 7 n'est pas remplie et signée, aucune ligne de la documentation ne doit
> présenter ces points comme vérifiés.
>
> Origine : lot P3 du plan d'achèvement (`plan-achevement.md`), décision D-101. Dépendance associée dans
> `acces-externes.md` : « appareils réels » (externe).

## 1. Ce que cette recette prouve, et ce qu'elle ne prouve pas

| Prouve (si tous les critères sont satisfaits) | Ne prouve pas |
|---|---|
| Le dépôt de pièces depuis un téléphone réel (appareil photo, photothèque, fichiers), sa reprise après coupure, l'installation de l'application, le mode hors connexion | Une conformité légale à l'accessibilité (RGAA, EN 301 549) : cela exige un audit par une personne qualifiée |
| Le comportement sur Safari (macOS et iOS) des écrans parcourus | Le comportement sur d'autres versions que celles notées sur la fiche |
| Les écrans parcourus sont utilisables et compréhensibles avec VoiceOver et NVDA | Les écrans non listés ci-dessous (la liste couvre les parcours principaux, pas toute l'application) |
| Les messages d'échec sont lisibles et actionnables sur ces appareils | La réception réelle de notifications poussées (voir § 4, T11, qui n'a de sens que si leur activation est décidée) |

Aucun corpus réel n'est nécessaire et aucun ne doit être utilisé : pièces et comptes d'essai **synthétiques** seulement (§ 2.3).

## 2. Préparation commune

### 2.1 Environnement à disposition de l'appareil

- **HTTPS obligatoire pour un téléphone.** Hors `localhost`, un navigateur désactive le service worker, l'installation de
  l'application et le calcul d'empreinte `crypto.subtle` (l'écran de dépôt refuse alors d'envoyer et affiche l'alerte « Dépôt
  impossible avec ce navigateur »). Un téléphone qui ouvre `http://<adresse du poste>:3100` n'est donc **pas** une recette valable.
  Il faut une adresse HTTPS accessible depuis l'appareil : environnement d'essai avec certificat valide, ou proxy TLS local
  dont l'autorité est installée sur le téléphone (opération à documenter sur la fiche). La CI et le poste de développement
  ne fournissent pas cette adresse.
- L'adresse HTTPS doit être déclarée comme URI de redirection du client OIDC (`WEB_URL`, voir `exploitation.md` § royaume).
- Pile démarrée avec le jeu de démonstration (comptes `alice.admin`, `remi.reviseur`, `chloe.collab`,
  `client.depot`, `bruno.admin` ; mot de passe dans le fichier `.env` local, jamais copié dans ce document).
- Service antivirus et OCR démarrés (`GET /v1/integrations` doit indiquer « disponible » pour les deux).
- **Aucune** connexion à une vraie boîte mail, banque, ni activation de notifications poussées pour cette recette, sauf T11.

### 2.2 Appareils et logiciels à noter sur la fiche (§ 7.1)

Minimum recommandé : un iPhone (iOS récent) avec Safari ; un téléphone Android avec Chrome ; un Mac avec Safari ;
un Mac avec VoiceOver ; un poste Windows avec NVDA et Firefox (et Chrome si possible). Relever pour chacun : modèle,
version du système, navigateur et version, taille d'écran, langue du système, zoom du texte, mode sombre (oui/non).

### 2.3 Jeu de pièces d'essai (à préparer avant la séance)

| Réf. | Contenu | Usage |
|---|---|---|
| P1 | Photo nette d'une facture papier **fictive** imprimée (A4, bon éclairage) | Dépôt nominal, OCR |
| P2 | Photo floue ou sombre de la même facture | Indicateur de lisibilité |
| P3 | Deux photos de pages successives d'une même facture fictive | Assemblage de pages en un PDF |
| P4 | PDF à couche texte d'une facture fictive (≈ 100 Ko) | Dépôt d'un fichier |
| P5 | PDF volumineux (≈ 20 Mo, pages d'images) | Dépôt long, coupure réseau |
| P6 | Fichier non pris en charge (`.docx` ou `.zip`) | Message de refus |
| P7 | Fichier de test antivirus **EICAR** (texte inoffensif standard) | Quarantaine, message |

Ne jamais utiliser un document réel d'un client, d'un salarié ou du cabinet.

### 2.4 Règles de consignation

Pour chaque cas : relever le résultat **OK / KO / NA**, une capture ou un enregistrement d'écran **sans donnée réelle**, l'heure,
et le numéro de la fiche d'anomalie (§ 7.2) si KO. Un cas est **KO** dès qu'un critère d'acceptation n'est pas satisfait.
**NA** n'est admis que pour une fonction absente de l'appareil (par exemple pas d'appareil photo) et doit être justifié.

### 2.5 Gravité des anomalies

| Gravité | Définition | Conséquence |
|---|---|---|
| Bloquante | Parcours impossible ou donnée perdue ou envoyée à tort ; un utilisateur de lecteur d'écran ne peut pas terminer le parcours | Recette non réussie |
| Majeure | Parcours possible mais en contournant, ou message trompeur, ou information essentielle non annoncée | À corriger avant toute mise en service |
| Mineure | Défaut de confort sans effet sur l'accomplissement | À planifier |

**Règle de décision :** la recette d'un appareil ou d'un lecteur d'écran est « réussie » si aucun cas n'est KO bloquant ou majeur
et si tous les cas notés « (essentiel) » sont OK. Sinon elle est « non réussie » ; les anomalies sont corrigées puis les cas concernés rejoués.

## 3. Parcours préalable : connexion (tous appareils)

| Étape | Action | Résultat attendu |
|---|---|---|
| C1 | Ouvrir l'adresse HTTPS de l'application dans le navigateur de l'appareil | La page « connexion » s'affiche, en français, sans avertissement de certificat |
| C2 | Choisir de se connecter ; saisir l'identifiant et le mot de passe du compte `client.depot` | Redirection vers le fournisseur d'identité puis retour sur l'application, connecté |
| C3 | Fermer l'onglet puis rouvrir l'adresse | Session toujours ouverte (cookie), sans nouvelle saisie |
| C4 | Se déconnecter | Retour à la connexion ; le bouton « retour » du navigateur n'affiche aucune donnée du compte |

**Critères d'acceptation :** aucune étape ne montre une page blanche, une erreur technique ou un jeton dans l'adresse ; les champs
sont utilisables avec le gestionnaire de mots de passe du système ; la déconnexion purge les dépôts en attente de l'appareil (voir T9).

## 4. Partie A — Téléphone réel (iPhone et Android, à jouer sur chacun)

Compte : `client.depot` (rôle déposant), dossier de démonstration où il est habilité. Écran : « Déposer une pièce » (`/deposer`).

| Cas | Étapes | Résultat attendu | Critères d'acceptation |
|---|---|---|---|
| T1 (essentiel) **Installation** | Ouvrir l'adresse, utiliser « Ajouter à l'écran d'accueil » (iOS) ou « Installer l'application » (Android) ; lancer l'icône | L'application s'ouvre en plein écran, nom « Comtaple », icône et couleurs du manifeste, ouverture directe sur l'accueil connecté | Icône nette (pas de capture d'écran de page) ; pas de barre d'adresse en mode installé ; raccourcis « Déposer une pièce » et « Mes dépôts » proposés (appui long sur l'icône sur Android) |
| T2 (essentiel) **Photo nominale (P1)** | « Déposer une pièce » → choisir le dossier → bouton appareil photo → photographier P1 → choisir la nature → « Envoyer » | L'application affiche « reçue » **seulement après** confirmation du serveur ; la pièce apparaît dans « Mes dépôts » ; après quelques secondes les champs extraits (numéro, date, total) apparaissent comme **projet** | Temps entre l'envoi et « reçue » ≤ 10 s en Wi-Fi ; le mot « reçu » n'est jamais affiché avant la confirmation ; l'appareil photo s'ouvre sans quitter l'application ; l'image n'est pas pivotée à l'envers |
| T3 **Lisibilité (P2)** | Photographier P2 | Un indicateur de lisibilité signale une photo à reprendre ; l'envoi reste possible | Message clair, non bloquant, en français |
| T4 (essentiel) **Plusieurs pages (P3)** | Prendre deux photos, réordonner (« Monter la page 2 »), pivoter une page, ajuster le cadrage, supprimer puis reprendre une page, envoyer | Un **seul** PDF est produit avec les pages dans l'ordre choisi ; une seule pièce « reçue » | Chaque commande tactile ≥ 44 × 44 px (mesure à vue : pouce sans erreur de cible) ; l'aperçu reflète exactement la rotation et le cadrage |
| T5 **Photothèque et fichiers (P4)** | Choisir un PDF depuis « Fichiers » (iOS) ou le sélecteur Android, puis une image depuis la photothèque | PDF envoyé tel quel ; image traitée comme une page | Le sélecteur système s'ouvre et se ferme sans perdre le formulaire |
| T6 (essentiel) **Coupure réseau (P5)** | Lancer l'envoi de P5 ; au milieu (barre de progression), activer le mode avion 20 s ; le désactiver | L'envoi indique « Interrompu — reprendre » (ou « En attente de connexion ») ou reprend seul ; **aucun octet ne repart de zéro** ; une seule pièce reçue à la fin | Progression jamais inversée au-delà d'un morceau (4 Mio) ; au retour, la pièce est reçue **une seule fois** (vérifier « Mes dépôts ») |
| T7 **Hors connexion dès le départ** | Mode avion, ouvrir l'application installée, déposer P4 | État « En attente de connexion » ; le dépôt est conservé sur l'appareil ; au retour du réseau, envoi automatique ou bouton explicite | Texte explicite « Rien n'est envoyé tant que l'application est fermée » (le cas échéant) ; aucune perte à la fermeture et réouverture de l'application |
| T8 **Refus du serveur (P6, P7)** | Envoyer P6 puis P7 | P6 : « type de fichier non pris en charge » renvoyé au déposant ; P7 : pièce en quarantaine, jamais consultable | Message en français, sans terme technique ; le dépôt refusé n'est jamais affiché « reçu » comme un succès |
| T9 **Déconnexion** | Mettre un dépôt en attente (mode avion), se déconnecter | Les dépôts en attente sont **purgés** de l'appareil | Après reconnexion avec un autre compte, aucun dépôt de l'ancien compte n'apparaît |
| T10 **Rotation et grand texte** | Tourner l'appareil ; régler la taille de texte du système au maximum | Aucun contenu coupé ; pas de défilement horizontal de la page ; boutons toujours accessibles | Lisible à 200 % ; aucun chevauchement de texte |
| T11 *(seulement si l'activation des notifications poussées est décidée)* | Activer, déclencher une demande de complément, écran verrouillé | Notification **sans aucune donnée** (texte générique) ; toucher ouvre l'application | Aucune donnée de dossier visible écran verrouillé |

## 5. Partie B — Safari (macOS et iOS)

Jouer sur Safari macOS (ordinateur) et Safari iOS (T-S6 à T-S8). WebKit sous Playwright n'est **pas** Safari : mêmes moteur de rendu, pas
les mêmes protections (ITP, stockage, politiques de cookies, cache de retour).

| Cas | Étapes | Résultat attendu | Critères d'acceptation |
|---|---|---|---|
| S1 (essentiel) **Connexion et cookies** | C1 à C4 sous Safari, **avec** « Empêcher le suivi inter-sites » activé (réglage par défaut) | Session ouverte et conservée ; déconnexion effective | Aucune boucle de redirection ; le cookie de session survit à un rechargement ; pas d'avertissement « cookies bloqués » |
| S2 **Mode navigation privée** | Répéter C1 à C3 en fenêtre privée | Connexion possible ; message clair si le dépôt hors connexion (IndexedDB) n'est pas disponible | Aucune erreur silencieuse ; si un stockage manque, l'écran le dit |
| S3 (essentiel) **Revue d'une pièce** (compte `remi.reviseur`) | Ouvrir une pièce, vérifier l'aperçu PDF, corriger un champ, valider | L'aperçu s'affiche en ligne ; la validation porte la version affichée | Aperçu PDF visible (Safari lit le PDF natif) ; aucune différence de mise en page bloquante avec Chromium |
| S4 **Import FEC** (compte `remi.reviseur`) | Déposer un FEC synthétique ≈ 5 Mo depuis le Finder ; suivre l'import | Progression, puis « terminé » ; contrôles visibles | Le glisser-déposer et le sélecteur fonctionnent ; la barre de progression avance |
| S5 **Tableaux larges** | Ouvrir balance, états, constats sur fenêtre étroite (≈ 800 px) | Défilement horizontal du tableau seul ; en-têtes lisibles | La page ne déborde pas ; pas de texte tronqué sans accès à sa valeur |
| S6 (essentiel, iOS) **Dépôt photo** | T2 et T4 sous Safari iOS (non installé) | Identique à T2/T4 | `crypto.subtle` disponible (adresse HTTPS) ; pas de rechargement intempestif en revenant de l'appareil photo (mémoire du navigateur) |
| S7 (iOS) **Retour depuis l'appareil photo** | Dans T4, prendre 5 photos successives | Les pages déjà prises restent présentes | Aucune perte de page ; si l'onglet est rechargé par le système, le message le dit et ne perd pas les dépôts déjà confirmés |
| S8 (iOS) **Écran d'accueil** | T1 sous Safari iOS puis ouverture depuis l'icône | Mode autonome ; connexion conservée ou redemandée avec un message clair | Après fermeture complète de l'application, la session est restaurée ou la reconnexion est expliquée |

## 6. Partie C — Lecteurs d'écran (VoiceOver et NVDA)

Jouer **chaque** cas avec : VoiceOver + Safari (macOS), VoiceOver + Safari (iOS), NVDA + Firefox, NVDA + Chrome. Écran éteint ou
non regardé (ne pas se fier à la vue). Noter à chaque cas la combinaison utilisée. Raccourcis utiles : VoiceOver macOS
`Ctrl+Option` (VO), rotor `VO+U` ; NVDA touche `Insert` (ou `Verr.Maj`), liste d'éléments `NVDA+F7`, titres `H`, repères `D`, champs `F`, tableaux `T`.

| Cas | Étapes | Résultat attendu | Critères d'acceptation |
|---|---|---|---|
| L1 (essentiel) **Structure et repères** | Ouvrir l'accueil connecté ; lister titres et repères (rotor / `NVDA+F7`) | Un titre de niveau 1 par page, hiérarchie logique, repères « Navigation principale », contenu principal | Titre de page annoncé à l'ouverture ; aucun titre sauté ; la navigation principale a un nom |
| L2 (essentiel) **Connexion** | Se connecter au clavier et au lecteur seuls | Champs identifiés (étiquettes), erreurs de saisie annoncées | Chaque champ annonce son nom et son rôle ; une erreur est lue sans quitter le champ |
| L3 (essentiel) **Dépôt d'une pièce** | `/deposer` : choisir le dossier, ajouter un fichier, choisir la nature, envoyer | Étiquettes « Dossier », « De quoi s'agit-il ? », « Commentaire… » ; boutons nommés ; progression annoncée ; « reçue » annoncé | La zone d'état (`role="status"`, annonce polie) lit les changements (envoi en cours, reçu, erreur) **sans** voler le focus ; la barre de progression a un nom (« Progression de l'envoi de … ») |
| L4 **Assemblage de pages** | Ajouter deux images ; utiliser « Monter la page 2 », « Ajuster la page 1 », « Supprimer la page 2 » | Chaque bouton a un nom explicite avec le numéro de page ; l'état « ajustement ouvert » est annoncé | Aucun bouton ne s'annonce « bouton » seul ; l'ordre de lecture suit l'ordre des pages |
| L5 (essentiel) **Message d'échec** | Provoquer un refus (P6) et un échec réseau | L'erreur est annoncée sans action de l'utilisateur, en français, avec la marche à suivre | Le message est lu automatiquement (région d'alerte) ; il ne disparaît pas avant d'avoir pu être lu ; le focus n'est pas perdu |
| L6 (essentiel) **Revue d'une pièce** (compte `remi.reviseur`) | Ouvrir une pièce, lire les champs extraits, leur statut « projet », les vérifications, valider | Chaque champ annonce son libellé, sa valeur, sa méthode et sa confiance ; le bouton de validation annonce **quelle version** il valide | Aucune information portée par la seule couleur ; les statuts (« projet », « à valider », « validé ») sont du texte |
| L7 **Tableaux** | Ouvrir une balance, la liste des constats, une liste de tiers | Tableaux avec en-têtes de colonnes et de lignes annoncés ; navigation cellule par cellule (`Ctrl+Alt+flèches`, `T`) | Chaque cellule est annoncée avec son en-tête ; les montants sont lisibles (signe, devise) ; le tri/filtrage annonce son état |
| L8 (essentiel) **Constat et décision motivée** | Ouvrir un constat, prendre en charge, conclure avec motif | Formulaire avec étiquettes, motif obligatoire signalé, confirmation annoncée | Le caractère obligatoire est annoncé ; l'issue de l'action est annoncée |
| L9 **Navigation clavier seule** | Parcourir connexion, dépôt, revue sans souris | Ordre de tabulation logique ; focus visible ; aucun piège au clavier ; fenêtres modales fermables par `Échap` | Contraste du focus visible ; aucun élément atteignable hors ordre |
| L10 **Zoom et contraste** | Zoom de page à 200 % et 400 %, mode contraste élevé du système, mode sombre | Aucune perte d'information ni de fonction ; texte non tronqué | Contrastes lisibles ; pas de défilement bidimensionnel à 400 % hors tableaux |
| L11 **Assistant** (compte `chloe.collab`) | Poser une question dans l'onglet « Assistant » | Réponse annoncée par segments typés (fait, calcul, hypothèse, interprétation) avec citations lisibles ; mention « sans IA » annoncée | Les citations sont des liens nommés ; le mode « sans IA » est dit |

## 7. Fiche de résultat (vierge — à remplir à la main ou en copie du document)

### 7.1 Appareils et séance

| Champ | Valeur |
|---|---|
| Date de la séance | |
| Personne qui joue la recette | |
| Adresse HTTPS d'essai (sans secret) | |
| Version du code (commit) | |
| Appareil 1 : modèle / système / navigateur / version | |
| Appareil 2 : modèle / système / navigateur / version | |
| Appareil 3 : modèle / système / navigateur / version | |
| Lecteur d'écran 1 : nom / version / navigateur / système | |
| Lecteur d'écran 2 : nom / version / navigateur / système | |
| Jeu de pièces utilisé (références P1 à P7) | |

### 7.2 Résultats par cas (une ligne par cas et par appareil ou combinaison)

| Cas | Appareil / combinaison | Résultat (OK / KO / NA) | Gravité si KO | Preuve (capture, nom de fichier) | N° d'anomalie | Observation |
|---|---|---|---|---|---|---|
| C1–C4 | | | | | | |
| T1 | | | | | | |
| T2 | | | | | | |
| T3 | | | | | | |
| T4 | | | | | | |
| T5 | | | | | | |
| T6 | | | | | | |
| T7 | | | | | | |
| T8 | | | | | | |
| T9 | | | | | | |
| T10 | | | | | | |
| T11 (si décidé) | | | | | | |
| S1 | | | | | | |
| S2 | | | | | | |
| S3 | | | | | | |
| S4 | | | | | | |
| S5 | | | | | | |
| S6 | | | | | | |
| S7 | | | | | | |
| S8 | | | | | | |
| L1 | | | | | | |
| L2 | | | | | | |
| L3 | | | | | | |
| L4 | | | | | | |
| L5 | | | | | | |
| L6 | | | | | | |
| L7 | | | | | | |
| L8 | | | | | | |
| L9 | | | | | | |
| L10 | | | | | | |
| L11 | | | | | | |

### 7.3 Fiche d'anomalie (une par anomalie)

| Champ | Valeur |
|---|---|
| N° d'anomalie | |
| Cas concerné et combinaison | |
| Gravité (bloquante / majeure / mineure) | |
| Étapes pour reproduire | |
| Résultat observé | |
| Résultat attendu | |
| Preuve (capture / enregistrement, sans donnée réelle) | |
| Cause suspectée (facultatif) | |
| Correction (commit) et date | |
| Cas rejoué après correction : résultat | |

### 7.4 Conclusion (à ne remplir qu'après la séance)

| Rubrique | Conclusion (réussie / non réussie / non jouée) | Réserves |
|---|---|---|
| Téléphone iPhone | | |
| Téléphone Android | | |
| Safari macOS | | |
| Safari iOS | | |
| VoiceOver (macOS) | | |
| VoiceOver (iOS) | | |
| NVDA + Firefox | | |
| NVDA + Chrome | | |

| Validation | Nom | Fonction | Date | Signature |
|---|---|---|---|---|
| Personne qui a joué la recette | | | | |
| Responsable produit | | | | |

> Une conclusion « réussie » ne vaut ni audit d'accessibilité indépendant, ni validation professionnelle ou juridique. Elle
> se limite aux cas listés, sur les appareils et versions consignés.

## 8. Après la séance

1. Reporter dans `couverture.md` (§ Écrans) et `exigences.md` (§17, « Navigateurs / émulations / appareils distingués ») **uniquement** les
   rubriques dont la conclusion est « réussie », avec la date et la version du code.
2. Ouvrir une correction par anomalie bloquante ou majeure ; rejouer les seuls cas concernés ; consigner le rejeu sur la fiche.
3. Ne pas retirer la mention « appareils réels (externe) » de `acces-externes.md` tant qu'une rubrique reste « non jouée » ou « non réussie ».
4. Les cas de ce document que l'automatisation peut déjà couvrir en émulation (T2, T4, T6, T7, T9, S1, L3) restent à jouer en réel :
   l'émulation ne reproduit ni l'appareil photo réel, ni les protections de Safari, ni la sortie d'un lecteur d'écran.
