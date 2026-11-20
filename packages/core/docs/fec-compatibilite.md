# Lecture des FEC : variantes réellement testées

Ce document décrit ce que `analyserFec` (paquet `@comtaple/core`) sait lire **et qui est couvert par un test automatisé**. Il ne promet pas une compatibilité universelle : aucun FEC réel issu d'un logiciel du marché n'a été testé à ce jour, uniquement des fichiers construits pour les tests et les FEC du générateur synthétique (`genererFecSynthetique`).

Référentiel : Livre des procédures fiscales, article A47 A-1 (version en vigueur depuis le 2 août 2013, consultée sur Légifrance le 2026-11-19 : <https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775>) et BOFiP BOI-CF-IOR-60-40-20 (version du 07/06/2017 : <https://bofip.impots.gouv.fr/bofip/9028-PGP.html>).

## Trois notions distinctes dans le rapport

| Indicateur | Signification |
|---|---|
| `lisible` | Au moins une ligne a pu être lue et normalisée. |
| `conforme` | Aucun écart au référentiel A47 A-1 **parmi les contrôles implémentés** (liste dans `rapport.referentiel.controlesImplementes`, avec `ecartAuReferentiel: true`). Un fichier peut être conforme en format et comptablement déséquilibré. |
| `suffisantPourTravaux` | Fichier lisible, aucune anomalie bloquante, **aucune ligne écartée** : les contrôles de révision portent sur des données complètes. |

Exemples testés : Windows-1252 ou point décimal → lisible, suffisant, **non conforme** ; une ligne au montant illisible → lisible, non conforme, **insuffisant** ; écriture déséquilibrée → lisible, **conforme** (ce n'est pas un écart de format), suffisant, anomalie `ECRITURE_DESEQUILIBREE` signalée.

## Variantes testées

| Sujet | Variantes couvertes par les tests | Comportement |
|---|---|---|
| Encodage | ASCII ; UTF-8 sans BOM ; UTF-8 avec BOM ; ISO-8859-15 (dont « œ » et « € ») ; Windows-1252 (octets 0x80–0x9F) ; mélange UTF-8/Latin-9 ; UTF-16 | ASCII, UTF-8 et ISO-8859-15 : conformes. BOM : information. Windows-1252 : lu, **non conforme** (hors liste du XII de l'article). Mélange : `inconnu`, non conforme, lecture poursuivie. UTF-16 : refusé (bloquant). |
| Séparateur | tabulation ; `\|` ; point-virgule ; aucun | Tabulation et `\|` : conformes. Point-virgule : lu, **non conforme**. Aucun : bloquant. |
| Fins de ligne | CRLF ; LF ; CR seul ; avec ou sans fin de ligne finale ; lignes vides intercalées | Toutes lues ; lignes vides ignorées et signalées pour information ; `numeroLigne` reste le numéro de ligne physique (en-tête = 1). |
| Découpage du flux | blocs de 1, 2, 3, 7, 64 octets et 64 Kio | Résultat strictement identique. |
| En-têtes | casse quelconque ; alias `CompteAuxNum`/`CompteAuxLib` ; colonne supplémentaire (ex. `CodeEtbt`) ; colonnes permutées ; colonne obligatoire absente ; colonne indispensable absente | Lecture par nom de colonne. Permutation ou absence : non conforme. Absence de `JournalCode`, `EcritureNum`, `EcritureDate`, `CompteNum` ou des montants : bloquant. |
| Montants | virgule décimale ; point décimal ; signe à gauche ou à droite ; zone vide ; séparateur de milliers ; plus de 2 décimales ; valeur illisible (`12O,00`) | Virgule : conforme. Point, zone vide, milliers : lus et signalés non conformes. Négatifs : reportés dans le sens opposé (`debit`/`credit` toujours ≥ 0), information. Illisible : ligne écartée et comptée. |
| Variante de colonnes | `Debit`/`Credit` ; `Montant`/`Sens` avec `D`, `C`, `+1`, `-1` | Converti en débit/crédit. Sens inconnu : ligne écartée. |
| Dates | `AAAAMMJJ` ; `JJ/MM/AAAA` et `AAAA-MM-JJ` (tolérés, non conformes) ; date inexistante (30 février) ; 29 février | Date d'écriture illisible : ligne écartée. Date facultative illisible : `null` + anomalie. |
| Nom de fichier | `SirenFECAAAAMMJJ` avec extension ; SIREN à clé fausse ; SIREN différent de l'option `siren` ; date invalide ou différente de `exerciceFin` ; `fec` en minuscules ; suffixe `_01` | Contrôlé seulement si `nomFichier` est fourni. |
| Volume | 105 869 lignes (14,1 Mo), blocs de 64 Kio | Voir mesures dans le test `recette — volume` ; les lignes sont remises à `surLigne`, jamais accumulées. |
| Garde-fous | ligne de plus de 1 Mio ; plus de 5 000 anomalies | Lecture interrompue (bloquant) ; détail plafonné à 5 000, décompte complet dans `nbAnomaliesParCode`. |

## Choix d'interprétation à connaître

- **`Sens` = `+1` / `-1`** : l'article liste « D ou C, ou +1 ou -1 » sans préciser la correspondance. Le lecteur retient `+1` = débit et `-1` = crédit (ordre de l'énumération). À confirmer sur un fichier réel utilisant cette variante.
- **Windows-1252 contre ISO-8859-15** : les deux jeux ne se distinguent que par les octets 0x80–0x9F et huit positions (dont « € », « œ »). Sans octet 0x80–0x9F, le fichier est déclaré ISO-8859-15 et décodé comme tel. La détection se fait ligne par ligne (lecture en flux) : une ligne Windows-1252 sans octet 0x80–0x9F est décodée en ISO-8859-15.
- **Point décimal** : le cahier des charges demande de lire « virgule ou point » ; l'article A47 A-1 (XII, 2°) n'admet que la virgule. Le point est donc lu mais rend le fichier non conforme (`MONTANT_SEPARATEUR_POINT`).
- **Équilibre des écritures** : suivi par (journal, numéro d'écriture) même si les lignes ne sont pas contiguës. Ce n'est pas un contrôle du référentiel de format.
- **Champs obligatoires vides** : seuls les champs 7, 8, 14, 15, 17 et 18 peuvent être à blanc (A47 A-1, VII). Un `ValidDate`, `PieceRef`, `PieceDate`… vide est signalé (`CHAMP_OBLIGATOIRE_VIDE`, mineure) et rend le fichier non conforme ; la ligne est conservée.

- **Longueur maximale d'une ligne** (`LIGNE_TROP_LONGUE`, 1 048 576 octets) : la borne est appréciée au fil des blocs lus, sur les octets en attente d'une fin de ligne. Une ligne qui dépasse la borne de moins d'un bloc peut donc être acceptée ou refusée selon le découpage des blocs par la source (stockage, tube). Au-delà d'un bloc de dépassement, elle est toujours refusée et la lecture s'arrête.

## Exécution

Le moteur est pur et lit un flux de blocs. En service, le worker ne l'appelle pas dans son propre processus : l'analyse s'exécute dans un processus enfant borné qui renvoie les lignes normalisées par lots (voir `docs/architecture.md`, « Traitements isolés »). Les lignes et le rapport sont identiques à ceux d'un appel direct (vérifié par `apps/worker/src/isolement-imports.itest.ts`), sous la réserve du point précédent.

## Non pris en charge (voir aussi `rapport.referentiel.controlesNonImplementes`)

- FEC au format XML (XSD de l'administration), fichiers à zones de longueur fixe, EBCDIC.
- Champs entre guillemets ou séparateur présent dans un libellé : la ligne a alors trop de zones et est écartée.
- Jeu de plusieurs fichiers pour un même exercice, contrôle de l'ordre chronologique de validation, des à-nouveaux en tête, du descriptif d'accompagnement.
- Champs 19 à 22 (BA/BNC en comptabilité de trésorerie) : acceptés mais non interprétés.
- Exports « grand livre » ou « journal » qui ne sont pas des FEC.
