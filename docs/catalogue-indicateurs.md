# Catalogue des indicateurs d’aide à la revue

25 indicateurs déterministes, calculés sur les seules écritures fournies. Ce sont des aides à la revue : aucun ne constitue une validation, une certification ou un diagnostic. Un indicateur dont une donnée manque rend `valeur: null` et le statut `non_calculable` avec son motif ; jamais un zéro par défaut. Les indicateurs de la famille `signal` sont des questions à examiner, jamais une conclusion sur la continuité d’exploitation.

Échelles : euros 2 décimales, jours 1 décimale, pourcentage 2 décimales, ratio 2 décimales (arrondi comptable). Les formules visent le plan de comptes applicable aux exercices ouverts à compter du 2025-01-01 (table PCG-SYSTEME-DE-BASE 2025.1).

| Identifiant | Version | Famille | Libellé | Unité | Type de source |
|---|---|---|---|---|---|
| SIG-CA | 1.0.0 | activite | Chiffre d’affaires net | euros | reglementaire |
| SIG-MARGE-COMMERCIALE | 1.0.0 | activite | Marge commerciale | euros | interne |
| SIG-PRODUCTION | 1.0.0 | activite | Production de l’exercice | euros | interne |
| SIG-VALEUR-AJOUTEE | 1.0.0 | activite | Valeur ajoutée | euros | interne |
| SIG-EBE | 1.0.0 | activite | Excédent brut d’exploitation | euros | interne |
| SIG-RESULTAT-EXPLOITATION | 1.0.0 | activite | Résultat d’exploitation | euros | reglementaire |
| SIG-RESULTAT-COURANT | 1.0.0 | activite | Résultat courant avant impôts | euros | reglementaire |
| SIG-RESULTAT-EXERCICE | 1.0.0 | activite | Résultat de l’exercice | euros | reglementaire |
| TAUX-MARGE-COMMERCIALE | 1.0.0 | rentabilite | Taux de marge commerciale | pourcentage | interne |
| TAUX-VALEUR-AJOUTEE | 1.0.0 | rentabilite | Taux de valeur ajoutée | pourcentage | interne |
| BFR | 1.0.0 | bfr | Besoin en fonds de roulement d’exploitation | euros | interne |
| BFR-JOURS | 1.0.0 | bfr | BFR en jours de chiffre d’affaires | jours | interne |
| DELAI-CLIENTS | 1.0.0 | bfr | Délai moyen de règlement des clients | jours | interne |
| DELAI-FOURNISSEURS | 1.0.0 | bfr | Délai moyen de règlement des fournisseurs | jours | interne |
| TRESORERIE-NETTE | 1.0.0 | tresorerie | Trésorerie nette | euros | reglementaire |
| CAPITAUX-PROPRES | 1.0.0 | structure | Capitaux propres | euros | reglementaire |
| ENDETTEMENT-FINANCIER | 1.0.0 | structure | Endettement financier | euros | interne |
| RATIO-ENDETTEMENT | 1.0.0 | structure | Ratio d’endettement financier | ratio | interne |
| FONDS-DE-ROULEMENT | 1.0.0 | structure | Fonds de roulement net global (haut de bilan) | euros | interne |
| COHERENCE-FR-BFR-TRESORERIE | 1.0.0 | structure | Contrôle de cohérence : fonds de roulement − BFR − trésorerie nette | euros | interne |
| SIGNAL-CAPITAUX-PROPRES-MOITIE-CAPITAL | 1.0.0 | signal | Les capitaux propres sont-ils inférieurs à la moitié du capital social ? | euros | reglementaire |
| SIGNAL-TRESORERIE-NETTE-NEGATIVE | 1.0.0 | signal | La trésorerie nette est-elle négative à la clôture ? | euros | interne |
| SIGNAL-EBE-NEGATIF | 1.0.0 | signal | L’excédent brut d’exploitation est-il négatif ? | euros | interne |
| SIGNAL-RESULTAT-NEGATIF-DEUX-EXERCICES | 1.0.0 | signal | Le résultat est-il négatif pour le deuxième exercice consécutif ? | euros | interne |
| SIGNAL-DETTES-FISCALES-SOCIALES-HAUSSE | 1.0.0 | signal | Les dettes fiscales et sociales sont-elles en forte hausse ? | pourcentage | interne |

## SIG-CA — Chiffre d’affaires net

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : Solde créditeur des comptes 70 (701 à 708, moins 709).
- **Convention et limites** : Montant net hors taxes tel que comptabilisé ; aucune écriture d’inventaire (factures à établir, produits constatés d’avance) n’est simulée.
- **Entrées** : 70
- **Donnée manquante** : Sans compte 70 mouvementé : non calculable (motif « compte manquant »).
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 512-2 : « Le chiffre d’affaires correspond au montant des affaires réalisées par l’entité avec les tiers dans le cadre de son activité professionnelle normale et courante » ; art. 821-2 : poste « Montant net du chiffre d’affaires » (ventes de marchandises + production vendue) ; art. 1222-70 : comptes 701 à 708 crédités des ventes, 709 débité des rabais, remises et ristournes accordés. — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## SIG-MARGE-COMMERCIALE — Marge commerciale

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : (707 − 7097) − (607 − 6097 + 6037).
- **Convention et limites** : Solde intermédiaire usuel, non défini par le PCG en vigueur. Sans variation de stocks comptabilisée (6037), la marge est calculée sur les achats : mention restituée.
- **Entrées** : 707, 7097, 607, 6097, 6037
- **Donnée manquante** : Sans compte 707 ni 607/6037 : non calculable. Si des comptes 709, 609, 608 ou 6098 non ventilés portent un solde : non calculable (pas d’hypothèse de répartition).
- **Source** (interne, sans_objet) : Convention interne d’analyse financière. Le PCG en vigueur (règlement ANC n° 2014-03 consolidé au 1er janvier 2026, lu intégralement le 2026-11-19) ne définit ni tableau des soldes intermédiaires de gestion, ni marge commerciale, ni production de l’exercice, ni valeur ajoutée, ni excédent brut d’exploitation : ces expressions n’y figurent pas. Les formules retenues reprennent la cascade usuelle en analyse financière, exprimée en comptes du plan de comptes de l’art. 1121-1.

## SIG-PRODUCTION — Production de l’exercice

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : (701 à 706 + 708 − 7091 à 7096 − 7098) + 71 + 72.
- **Convention et limites** : Solde intermédiaire usuel, non défini par le PCG en vigueur. La production stockée (71) peut être négative (déstockage).
- **Entrées** : 701 à 706, 708, 7091 à 7098 sauf 7097, 71, 72
- **Donnée manquante** : Sans aucun de ces comptes : non calculable. Compte 709 non ventilé portant un solde : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière. Le PCG en vigueur (règlement ANC n° 2014-03 consolidé au 1er janvier 2026, lu intégralement le 2026-11-19) ne définit ni tableau des soldes intermédiaires de gestion, ni marge commerciale, ni production de l’exercice, ni valeur ajoutée, ni excédent brut d’exploitation : ces expressions n’y figurent pas. Les formules retenues reprennent la cascade usuelle en analyse financière, exprimée en comptes du plan de comptes de l’art. 1121-1.

## SIG-VALEUR-AJOUTEE — Valeur ajoutée

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : 70 + 71 + 72 − 60 − 61 − 62.
- **Convention et limites** : Équivaut à marge commerciale + production de l’exercice − consommations en provenance des tiers. Redevances de crédit-bail et personnel extérieur non retraités ; subventions d’exploitation non comprises.
- **Entrées** : 70, 71, 72, 60, 61, 62
- **Donnée manquante** : Sans compte 70 mouvementé : non calculable (motif « compte manquant »). Sans compte 60, 61 ou 62 : calculé, avec mention.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière. Le PCG en vigueur (règlement ANC n° 2014-03 consolidé au 1er janvier 2026, lu intégralement le 2026-11-19) ne définit ni tableau des soldes intermédiaires de gestion, ni marge commerciale, ni production de l’exercice, ni valeur ajoutée, ni excédent brut d’exploitation : ces expressions n’y figurent pas. Les formules retenues reprennent la cascade usuelle en analyse financière, exprimée en comptes du plan de comptes de l’art. 1121-1.

## SIG-EBE — Excédent brut d’exploitation

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : Valeur ajoutée + 74 (sauf 747) − 63 − 64.
- **Convention et limites** : Solde intermédiaire usuel, non défini par le PCG en vigueur. La quote-part de subventions d’investissement virée au résultat (747) est exclue ; les autres produits et charges de gestion courante (75, 65) ne sont pas compris.
- **Entrées** : 70, 71, 72, 60, 61, 62, 74 sauf 747, 63, 64
- **Donnée manquante** : Sans compte 70 mouvementé : non calculable (motif « compte manquant »). Sans compte 64 : calculé, avec mention.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière. Le PCG en vigueur (règlement ANC n° 2014-03 consolidé au 1er janvier 2026, lu intégralement le 2026-11-19) ne définit ni tableau des soldes intermédiaires de gestion, ni marge commerciale, ni production de l’exercice, ni valeur ajoutée, ni excédent brut d’exploitation : ces expressions n’y figurent pas. Les formules retenues reprennent la cascade usuelle en analyse financière, exprimée en comptes du plan de comptes de l’art. 1121-1.

## SIG-RESULTAT-EXPLOITATION — Résultat d’exploitation

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : Total des produits d’exploitation (I) − total des charges d’exploitation (II) du modèle de l’art. 821-2.
- **Convention et limites** : Calculé sur le projet de compte de résultat (table de correspondance en attente de validation professionnelle). Depuis le règlement ANC n° 2022-06, les cessions d’immobilisations incorporelles et corporelles (657, 757) en font partie.
- **Entrées** : Rubriques PE et CE du projet de compte de résultat
- **Donnée manquante** : Exercice ouvert avant le 1er janvier 2025, absence de comptes des classes 6 et 7, ou compte de gestion non affecté à une rubrique : non calculable.
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 513-2 (les produits et charges sont classés de manière à faire apparaître les différents niveaux de résultat) et art. 821-2 : « 1. RESULTAT D’EXPLOITATION (I - II) », « 2. RESULTAT FINANCIER (V - VI) », « 3. RESULTAT COURANT avant impôts (I - II + III - IV + V - VI) », « 4. RESULTAT EXCEPTIONNEL (VII - VIII) », « BENEFICE OU PERTE » = total des produits (I+III+V+VII) − total des charges (II+IV+VI+VIII+IX+X). — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## SIG-RESULTAT-COURANT — Résultat courant avant impôts

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : I − II + III − IV + V − VI du modèle de l’art. 821-2.
- **Convention et limites** : Calculé sur le projet de compte de résultat (table de correspondance en attente de validation professionnelle).
- **Entrées** : Rubriques PE, CE, QPP, QPC, PF et CF du projet de compte de résultat
- **Donnée manquante** : Mêmes règles que le résultat d’exploitation.
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 513-2 (les produits et charges sont classés de manière à faire apparaître les différents niveaux de résultat) et art. 821-2 : « 1. RESULTAT D’EXPLOITATION (I - II) », « 2. RESULTAT FINANCIER (V - VI) », « 3. RESULTAT COURANT avant impôts (I - II + III - IV + V - VI) », « 4. RESULTAT EXCEPTIONNEL (VII - VIII) », « BENEFICE OU PERTE » = total des produits (I+III+V+VII) − total des charges (II+IV+VI+VIII+IX+X). — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## SIG-RESULTAT-EXERCICE — Résultat de l’exercice

- **Version** : 1.0.0
- **Famille** : activite
- **Unité** : euros
- **Formule** : Solde créditeur de la classe 7 − solde débiteur de la classe 6.
- **Convention et limites** : Résultat tel qu’il ressort des écritures fournies : ni écriture d’inventaire, ni impôt non comptabilisé ne sont simulés. Si les classes 6 et 7 sont déjà soldées, la valeur est nulle et une mention renvoie au compte 12.
- **Entrées** : 6, 7
- **Donnée manquante** : Sans aucun compte des classes 6 et 7 : non calculable.
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 513-1 : « Le résultat de l’exercice est égal tant à la différence entre les produits et les charges qu’à la variation des capitaux propres entre le début et la fin de l’exercice (…) » ; art. 1211-12 : le compte 12 enregistre pour solde les comptes de charges et de produits ; il est soldé après décision d’affectation. — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## TAUX-MARGE-COMMERCIALE — Taux de marge commerciale

- **Version** : 1.0.0
- **Famille** : rentabilite
- **Unité** : pourcentage
- **Formule** : Marge commerciale ÷ (707 − 7097) × 100.
- **Convention et limites** : Rapporté aux seules ventes de marchandises, hors taxes.
- **Entrées** : 707, 7097, 607, 6097, 6037
- **Donnée manquante** : Marge commerciale non calculable ou ventes de marchandises nulles (dénominateur nul) : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## TAUX-VALEUR-AJOUTEE — Taux de valeur ajoutée

- **Version** : 1.0.0
- **Famille** : rentabilite
- **Unité** : pourcentage
- **Formule** : Valeur ajoutée ÷ chiffre d’affaires net × 100.
- **Convention et limites** : Rapporté au chiffre d’affaires net hors taxes.
- **Entrées** : 70, 71, 72, 60, 61, 62
- **Donnée manquante** : Chiffre d’affaires absent ou nul (dénominateur nul) : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## BFR — Besoin en fonds de roulement d’exploitation

- **Version** : 1.0.0
- **Famille** : bfr
- **Unité** : euros
- **Formule** : Classe 3 (nette de 39) + soldes débiteurs 411/413/416/418 − 491 + soldes débiteurs 4091/4096/4097/4098/42/43/44 (sauf 449)/486 − soldes créditeurs 401/403/408 (sauf 4084) − soldes créditeurs 42/43/44 (sauf 449).
- **Convention et limites** : Convention interne. Exclus : avances reçues (4191), produits constatés d’avance (487), comptes 45 et 46, fournisseurs d’immobilisations (404, 405, 4084). Sens des soldes apprécié par compte général, non par tiers. Soldes de clôture, sensibles à la saisonnalité.
- **Entrées** : 3, 411, 413, 416, 418, 491, 4091, 4096 à 4098, 42, 43, 44, 486, 401, 403, 408
- **Donnée manquante** : Sans aucun compte de classe 4 : non calculable. Sans compte de stocks : calculé, avec mention.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## BFR-JOURS — BFR en jours de chiffre d’affaires

- **Version** : 1.0.0
- **Famille** : bfr
- **Unité** : jours
- **Formule** : BFR ÷ chiffre d’affaires net hors taxes × nombre de jours de l’exercice.
- **Convention et limites** : Le nombre de jours est la durée réelle de l’exercice (date de clôture − date d’ouverture + 1), jamais 360 ou 365 forfaitaires.
- **Entrées** : BFR, 70
- **Donnée manquante** : BFR non calculable, chiffre d’affaires absent ou nul : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## DELAI-CLIENTS — Délai moyen de règlement des clients

- **Version** : 1.0.0
- **Famille** : bfr
- **Unité** : jours
- **Formule** : Soldes débiteurs 411/413/416/418 (TTC) ÷ [chiffre d’affaires net × (1 + taux moyen de TVA sur ventes)] × nombre de jours de l’exercice.
- **Convention et limites** : Le taux moyen de TVA doit être FOURNI (`tauxTvaMoyen.ventes`, en pourcentage). Il n’est pas déduit des comptes 4457 : ces comptes sont soldés à chaque déclaration, enregistrent aussi des régularisations, et leurs mouvements créditeurs ne donnent pas un taux moyen fiable. Créances brutes à la clôture ; effets escomptés et créances cédées non compris ; ventes au comptant comprises au dénominateur.
- **Entrées** : 411, 413, 416, 418, 70, tauxTvaMoyen.ventes
- **Donnée manquante** : Taux non fourni : non calculable, motif « taux de TVA moyen à renseigner ». Sans compte client ou sans compte 70, ou chiffre d’affaires nul : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## DELAI-FOURNISSEURS — Délai moyen de règlement des fournisseurs

- **Version** : 1.0.0
- **Famille** : bfr
- **Unité** : jours
- **Formule** : Soldes créditeurs 401/403/408 sauf 4084 (TTC) ÷ [(60 sauf 603 + 61 + 62) × (1 + taux moyen de TVA sur achats)] × nombre de jours de l’exercice.
- **Convention et limites** : Le taux moyen de TVA doit être FOURNI (`tauxTvaMoyen.achats`, en pourcentage) : toutes les charges externes ne supportent pas la TVA (loyers, assurances…), le taux moyen relève de l’appréciation du réviseur. Fournisseurs d’immobilisations exclus.
- **Entrées** : 401, 403, 408, 60 sauf 603, 61, 62, tauxTvaMoyen.achats
- **Donnée manquante** : Taux non fourni : non calculable, motif « taux de TVA moyen à renseigner ». Sans compte fournisseur ou sans compte 60/61/62, ou achats nuls : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## TRESORERIE-NETTE — Trésorerie nette

- **Version** : 1.0.0
- **Famille** : tresorerie
- **Unité** : euros
- **Formule** : Soldes débiteurs 511/512/517/5188/53 − soldes créditeurs 512/517/53 − 519 − 5181.
- **Convention et limites** : Disponibilités moins concours bancaires courants et soldes créditeurs de banque, sans compensation entre comptes bancaires (PCG art. 1215-51). Valeurs mobilières de placement non comprises (mention). Solde comptable, non rapproché des relevés.
- **Entrées** : 511, 512, 517, 518, 519, 53
- **Donnée manquante** : Sans aucun de ces comptes : non calculable.
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 1215-51 (une subdivision du compte 512 par compte bancaire, aucune compensation entre comptes à solde créditeur et à solde débiteur ; mobilisations de créances au compte 519 « Concours bancaires courants ») et art. 1211-16 (les concours bancaires courants ne sont pas inscrits au compte 164). — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## CAPITAUX-PROPRES — Capitaux propres

- **Version** : 1.0.0
- **Famille** : structure
- **Unité** : euros
- **Formule** : 10 (sauf 109) + 11 + 12 + (classe 7 − classe 6 non soldées) + 13 + 14, soldes créditeurs nets.
- **Convention et limites** : Avant répartition, résultat de la période compris tel qu’il ressort des écritures. Le capital souscrit non appelé (109) n’est pas déduit.
- **Entrées** : 10 sauf 109, 11, 12, 13, 14, 6, 7
- **Donnée manquante** : Sans compte 10 (à-nouveaux absents) : non calculable.
- **Source** (reglementaire, verifiee) : PCG (règlement ANC n° 2014-03), art. 1141-1, a : les capitaux propres correspondent à la somme algébrique des apports (capital, primes liées au capital), des écarts de réévaluation, des écarts d’équivalence, des bénéfices non distribués (réserves, report à nouveau créditeur, bénéfice de l’exercice), des pertes (report à nouveau débiteur, perte de l’exercice), des subventions d’investissement et des provisions réglementées ; art. 821-1 : « Total des capitaux propres (I) ». — https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf (consultée le 2026-11-19)

## ENDETTEMENT-FINANCIER — Endettement financier

- **Version** : 1.0.0
- **Famille** : structure
- **Unité** : euros
- **Formule** : 16 (sauf 169) + 17 + soldes créditeurs 512/517 + 519 + 5181.
- **Convention et limites** : Convention interne. Les comptes courants d’associés et du groupe (451, 455) ne sont pas compris : leur montant créditeur est restitué en mention. Les engagements de crédit-bail ne figurent pas dans les écritures.
- **Entrées** : 16 sauf 169, 17, 512, 517, 519, 5181
- **Donnée manquante** : Sans aucun compte de classe 1 (à-nouveaux absents) : non calculable. Classe 1 présente sans emprunt : 0.00 avec mention.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## RATIO-ENDETTEMENT — Ratio d’endettement financier

- **Version** : 1.0.0
- **Famille** : structure
- **Unité** : ratio
- **Formule** : Endettement financier ÷ capitaux propres.
- **Convention et limites** : Convention interne ; mêmes limites que ses deux composantes.
- **Entrées** : ENDETTEMENT-FINANCIER, CAPITAUX-PROPRES
- **Donnée manquante** : Capitaux propres non calculables, nuls ou négatifs : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## FONDS-DE-ROULEMENT — Fonds de roulement net global (haut de bilan)

- **Version** : 1.0.0
- **Famille** : structure
- **Unité** : euros
- **Formule** : Capitaux propres + 15 + 16 + 17 − classe 2 nette (20 à 27 − 28 − 29) − 109.
- **Convention et limites** : Convention interne, par le haut du bilan, sur valeurs nettes. Comptes courants d’associés (45) et concours bancaires exclus des ressources stables.
- **Entrées** : 10 à 17, 6, 7, 2
- **Donnée manquante** : Sans aucun compte de classe 1 : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## COHERENCE-FR-BFR-TRESORERIE — Contrôle de cohérence : fonds de roulement − BFR − trésorerie nette

- **Version** : 1.0.0
- **Famille** : structure
- **Unité** : euros
- **Formule** : FONDS-DE-ROULEMENT − BFR − TRESORERIE-NETTE.
- **Convention et limites** : Avec une balance équilibrée, l’écart est égal au solde net débiteur des comptes qui n’entrent dans aucun des trois agrégats (BFR hors exploitation, comptes courants d’associés, valeurs mobilières de placement, comptes d’attente…), restitués en mention. Un écart non nul n’est pas en soi une erreur.
- **Entrées** : FONDS-DE-ROULEMENT, BFR, TRESORERIE-NETTE
- **Donnée manquante** : L’un des trois agrégats non calculable : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## SIGNAL-CAPITAUX-PROPRES-MOITIE-CAPITAL — Les capitaux propres sont-ils inférieurs à la moitié du capital social ?

- **Version** : 1.0.0
- **Famille** : signal
- **Unité** : euros
- **Formule** : Capitaux propres − (solde créditeur du compte 101 ÷ 2) ; à examiner si la valeur est négative.
- **Convention et limites** : Question posée au réviseur, pas une conclusion. La forme sociale n’est pas dans les écritures ; les textes visent des comptes approuvés, la valeur est un projet avant inventaire.
- **Entrées** : CAPITAUX-PROPRES, 101
- **Donnée manquante** : Capitaux propres non calculables, compte 101 absent, nul ou débiteur : non calculable.
- **Source** (reglementaire, verifiee) : Code de commerce, art. L223-42 (SARL) et art. L225-248 (SA), dans leur rédaction issue de la loi n° 2023-171 du 9 mars 2023, art. 14 : si, du fait de pertes constatées dans les documents comptables, les capitaux propres deviennent inférieurs à la moitié du capital social, les associés (SARL) ou l’assemblée générale extraordinaire convoquée par le conseil d’administration ou le directoire (SA) décident, dans les quatre mois qui suivent l’approbation des comptes ayant fait apparaître ces pertes, s’il y a lieu à dissolution anticipée ; à défaut de dissolution, reconstitution des capitaux propres ou réduction du capital au plus tard à la clôture du deuxième exercice suivant. Art. L227-1 (SAS) : les règles concernant les sociétés anonymes sont applicables à la SAS, à l’exception d’articles limitativement énumérés parmi lesquels L225-248 ne figure pas. La forme sociale n’est pas dans les écritures : l’article applicable est à déterminer par le réviseur. — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047292166 (consultée le 2026-11-19)

## SIGNAL-TRESORERIE-NETTE-NEGATIVE — La trésorerie nette est-elle négative à la clôture ?

- **Version** : 1.0.0
- **Famille** : signal
- **Unité** : euros
- **Formule** : TRESORERIE-NETTE ; à examiner si la valeur est négative.
- **Convention et limites** : Question posée au réviseur, pas une conclusion : un découvert autorisé ou saisonnier peut l’expliquer.
- **Entrées** : TRESORERIE-NETTE
- **Donnée manquante** : Trésorerie nette non calculable : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## SIGNAL-EBE-NEGATIF — L’excédent brut d’exploitation est-il négatif ?

- **Version** : 1.0.0
- **Famille** : signal
- **Unité** : euros
- **Formule** : SIG-EBE ; à examiner si la valeur est négative.
- **Convention et limites** : Question posée au réviseur, pas une conclusion.
- **Entrées** : SIG-EBE
- **Donnée manquante** : EBE non calculable : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## SIGNAL-RESULTAT-NEGATIF-DEUX-EXERCICES — Le résultat est-il négatif pour le deuxième exercice consécutif ?

- **Version** : 1.0.0
- **Famille** : signal
- **Unité** : euros
- **Formule** : SIG-RESULTAT-EXERCICE de N ; à examiner si N et N-1 sont tous deux négatifs.
- **Convention et limites** : Question posée au réviseur, pas une conclusion. Résultats avant écritures d’inventaire éventuelles.
- **Entrées** : 6, 7, exercice précédent
- **Donnée manquante** : Exercice précédent non fourni ou résultat non calculable sur l’un des deux exercices : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.

## SIGNAL-DETTES-FISCALES-SOCIALES-HAUSSE — Les dettes fiscales et sociales sont-elles en forte hausse ?

- **Version** : 1.0.0
- **Famille** : signal
- **Unité** : pourcentage
- **Formule** : (Soldes créditeurs 42/43/44 sauf 449 de N − ceux de N-1) ÷ ceux de N-1 × 100 ; à examiner au-delà du seuil.
- **Convention et limites** : Seuil interne paramétrable (défaut 30 %). Question posée au réviseur, pas une conclusion.
- **Entrées** : 42, 43, 44 sauf 449, exercice précédent
- **Donnée manquante** : Exercice précédent non fourni, comptes absents ou base nulle : non calculable.
- **Source** (interne, sans_objet) : Convention interne d’analyse financière (aucun texte ne définit cet indicateur) : formule exprimée en comptes du plan de comptes du PCG (art. 1121-1), à lire avec ses limites.
