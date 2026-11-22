# Tableaux d'immobilisations et d'amortissements de la liasse (projet)

**Ce que vous pouvez faire.** Ouvrir un dossier, puis **États fiscaux** (`/dossiers/:id/fiscal`) :

- onglet « Liasse — Régime réel normal » : sous les tableaux 2050 à 2053, la section « Immobilisations et amortissements » présente le **2054** (cadres A et B) et le **2055** (cadre A) ;
- onglet « Liasse — Régime simplifié » : la même section présente le **2033-C** (cadres I « Immobilisations » et II « Amortissements ») ;
- **API** : `GET v1/exercices/:id/liasse?regime=reel_normal|reel_simplifie`, champ `tableauxImmobilisations` (lecture du dossier ; le déposant reçoit 404, un exercice sans comptabilité importée 409).

**D'où viennent les chiffres.**
- La **balance importée** : mouvements des comptes 20 à 28, hors journaux d'à-nouveaux (même calcul que la rubrique 832-1 de l'annexe) : ouverture, augmentations (débits), diminutions (crédits), clôture. Chaque ligne du formulaire est un regroupement de comptes par leur numéro (convention interne, détail dans l'écran : « Détail : comptes et fichier »).
- Le **fichier des immobilisations** saisi ou repris (onglet Amortissements) et le **moteur d'amortissements** : valeur brute et amortissements à l'ouverture selon le fichier, dotation de l'exercice calculée, sorties d'actif, composants. Les **écarts avec la balance sont affichés, jamais corrigés**.
- La **colonne N-1** (même cellule, exercice précédent contigu importé, avant inventaire), sinon « indisponible » avec le motif.

**Ce que l'écran ne remplit jamais à votre place** (cellule « à saisir » ou « non établi », avec son motif) :
- les réévaluations et la valeur d'origine ; les montants « dont composants » ;
- la ventilation des diminutions entre virements de poste à poste et cessions ou mises hors service, dès qu'un compte a des mouvements de crédit (le total des diminutions est donné à part, hors formulaire) ;
- l'ouverture et les mouvements quand **aucun journal d'à-nouveaux** n'est identifié ;
- toute ligne du fichier incomplète (immobilisation sans date de mise en service ou sans base, composant mal rattaché, sortie d'actif) : exclue du rapprochement, signalée ; le **dégressif reste non activé** (abstention motivée).

**Non préparés** : 2054 bis (réévaluation légale), 2055 cadres B (amortissements dérogatoires) et C (charges réparties), 2033-C cadre III (plus-values et moins-values).

**À lire avant de s'en servir.**
- Tout reste un **projet** non validé par un professionnel ; aucune déclaration n'est transmise ; calcul sur les écritures importées avant écritures d'inventaire (les dotations de clôture non comptabilisées n'y figurent pas).
- Les **codes de cases** ont été relus sur les formulaires officiels du millésime 2026 (PDF du 2026-11-20) par extraction de texte, puis **vérifiés sur le rendu image des pages** le 2026-11-22 (2054 cadres A et B, 2055 cadre A, 2033-C cadres I et II ; aucun écart trouvé, D-152) : ils sont affichés « lue, vérifiée sur le PDF » ; le symbole « Ø » est un zéro barré. Montants au centime, **sans arrondi à l'euro**.
- Un compte qu'aucune ligne ne reprend est affiché « non ventilé », hors totaux ; les contrôles reprennent le projet de bilan, la reprise de N-1 et la dotation du compte 6811, sans rien ajuster.

Décision, sources et limites : `decisions.md` D-104 ; périmètre et tables : `etats-fiscaux.md`.
