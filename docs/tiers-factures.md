# Tiers, factures et avoirs suivis, échéances et règlements

Aide à la révision, par dossier et par exercice. Rien n'est comptabilisé ni lettré : le logiciel de production comptable
reste la référence. Tout ce que le moteur déduit est un PROJET tant qu'une personne habilitée ne l'a pas confirmé.
Aucune règle de ce document n'a été validée par un expert-comptable (voir « Validations attendues »).

Code : moteur `packages/core/src/tiers/` (`suivreTiersEtFactures`, pur, 47 tests) ; destinataire et sens de la pièce
`packages/core/src/facture/` (`texte.ts`, `xml.ts`, `sens.ts`, 32 tests dans `destinataire.test.ts`) ; API `apps/api/src/tiers.controller.ts` ;
écran `apps/web/src/app/(app)/dossiers/[id]/tiers/page.tsx` ; tables `liens_tiers`, `liens_factures` (migration 0037).

## Ce qui est stocké, ce qui est recalculé

| Élément | Stocké ? | Pourquoi |
|---|---|---|
| Référentiel des tiers, soldes, mouvements | Non : recalculé à chaque lecture depuis les écritures du lot actif | Ne peut pas diverger des écritures |
| Fiche de facture ou d'avoir (numéro, dates, montants, tiers) | Non : lue dans l'extraction EN VIGUEUR de la version COURANTE de la pièce | Une correction ou une nouvelle version est prise en compte immédiatement |
| Lien facture ↔ écriture, règlements, reste dû, état, suspicions | Non : recalculés | Idem |
| Décision humaine sur un tiers (confirme / infirme) | Oui : `liens_tiers`, par dossier | Seule information que les données ne portent pas |
| Décision humaine sur une facture (écriture, règlement, suspicion) | Oui : `liens_factures`, par exercice, avec la version de l'extraction et des données | Idem |

La table `factures` (créée au lot initial, jamais alimentée par aucun code) n'est ni utilisée ni modifiée.

Invalidation : une décision est rattachée à l'identifiant de la pièce (donc à sa VERSION, D-031) et à la version de son
extraction. Nouvelle version de la pièce, correction des champs extraits, écriture disparue après un réimport : la décision
n'est plus appliquée et apparaît dans « Décisions à revoir » avec son motif. Elle n'est pas supprimée.

## Tiers

- Tiers comptable : un par compte auxiliaire (`CompAuxNum`) des lignes des comptes 401, 403, 404, 405 (fournisseurs) et
  411, 413, 416 (clients). Type : client, fournisseur, ou mixte si le même compte auxiliaire sert des deux côtés. Les
  lignes d'un compte collectif SANS compte auxiliaire sont regroupées par compte général et signalées « détail par tiers
  indisponible ». Solde = Σ débit − Σ crédit des lignes du lot.
- Tiers de pièce : l'ÉMETTEUR lu sur une pièce d'achat, le DESTINATAIRE lu sur une pièce de vente (`roleTiersPiece`). Clé,
  par ordre : SIREN valide (lu, ou tiré d'un SIRET ou d'un numéro de TVA français valides), sinon numéro de TVA étranger,
  sinon nom normalisé. Sans destinataire lu de façon sûre, le client d'une vente n'est pas identifié par la pièce.
- Pour une vente, le destinataire n'est PAS retenu si la pièce contredit le sens : émetteur lu différent du dossier,
  destinataire égal au dossier, ou dossier lu des deux côtés. Le motif est affiché (`motifTiers`) et le lien reste à confirmer.
- Rattachement automatique : uniquement par identifiant fort — un SIREN valide (clé de Luhn) présent dans le numéro ou le
  libellé du compte auxiliaire et égal à celui de la pièce.
- Sinon : PROPOSITION quand le nom normalisé de l'émetteur (sans accents, casse, ponctuation ni forme juridique) est
  identique à celui d'un compte auxiliaire du même côté (fournisseur pour un émetteur d'achat, client pour un destinataire
  de vente ; un compte mixte convient aux deux). Plusieurs comptes de même nom = homonymes : tous listés, aucun
  retenu, jamais fusionnés. Pas de rapprochement approximatif (inclusion, distance).
- Une personne confirme (niveau collaboration) ou infirme avec motif (niveau révision). La décision vaut pour le dossier.

## Lien facture ↔ écriture

Nature d'une ligne de tiers : « facture » (sens normal du compte, écriture sans compte 51/53, avec un compte de classe 2,
6 ou 7), « avoir » (sens inverse, mêmes conditions), « règlement » (sens inverse, écriture avec un compte 51/53), « autre ».
Une écriture d'à-nouveau ou une OD n'est jamais prise pour l'écriture d'une facture.

Candidates : lignes de la nature attendue, du bon côté (achat → fournisseurs, vente → clients), de montant STRICTEMENT
égal au TTC de la pièce (aucune tolérance). Critères :

| Critère | Valeurs |
|---|---|
| Référence | identique à `PieceRef` (alphanumérique, majuscules) ; ou citée dans `PieceRef` / le libellé (numéro d'au moins 5 caractères, non collé à d'autres chiffres) ; ou absente |
| Date | concordante si `PieceDate` = date d'émission, ou écart avec la date d'écriture ≤ 31 jours |
| Tiers | identifié (identifiant fort ou confirmation), proposé par son nom (candidat unique), homonymes, non lu, sans lien, différent |

- **Apparié** (déterministe) : une seule écriture réunit référence + date concordante + tiers identifié ou proposé.
- **Ambigu** : plusieurs écritures les réunissent, ou plusieurs pièces revendiquent la même écriture → aucune n'est retenue.
- **À confirmer** : montant égal et référence ou tiers concordant, mais pas tout (cas d'une vente dont le destinataire
  n'a pas été lu ou est contredit par la pièce).
- Les ventes suivent exactement les mêmes exigences que les achats, avec le destinataire pour tiers.
- **Non trouvé / non recherché** : avec le motif (TTC non lu, devise autre que l'euro, aucune écriture…).
- Une personne confirme (collaboration) ou infirme avec motif (révision) ; un lien confirmé l'emporte.

## Destinataire d'une facture et sens de la pièce

**Factures structurées (Factur-X / CII, UBL).** L'acheteur (groupe BG-7 de la norme EN 16931) est lu aux emplacements
normalisés ; la source, sa version et sa date de vérification sont dans `SOURCE_FACTURE_ACHETEUR` (`facture/xml.ts`).

| Champ | CII, sous `ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty` | UBL 2.1, sous `cac:AccountingCustomerParty/cac:Party` |
|---|---|---|
| Nom (BT-44) | `ram:Name` | `cac:PartyLegalEntity/cbc:RegistrationName`, à défaut `cac:PartyName/cbc:Name` (BT-45) |
| SIREN, SIRET (BT-47, BT-46) | `ram:SpecifiedLegalOrganization/ram:ID`, `ram:GlobalID` | `cac:PartyLegalEntity/cbc:CompanyID`, `cac:PartyIdentification/cbc:ID` |
| N° de TVA (BT-48) | `ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']` | `cac:PartyTaxScheme/cbc:CompanyID` si `cac:TaxScheme/cbc:ID` = VAT |
| Pays (BT-55) | `ram:PostalTradeAddress/ram:CountryID` | `cac:PostalAddress/cac:Country/cbc:IdentificationCode` |

Un identifiant n'est pris pour un SIREN ou un SIRET que si son attribut `schemeID` le déclare (0002, 0009) : sans schéma,
il n'est pas interprété. Vérifié en ligne le 2026-11-19 sur les règles et exemples du dépôt de validation CEN/TC 434
(version 1.3.17), Peppol BIS Billing 3.0 et les listes de codes de la Commission européenne (version 18). Non consultés :
le texte de la norme (payant), le dossier Factur-X (formulaire), les spécifications externes de la DGFiP (site en
maintenance ce jour-là : non vérifiées en ligne).

**Factures en texte (couche texte PDF, OCR).** Règles internes, prudentes ; chaque champ porte sa page, sa ligne et sa boîte.

- Un bloc de destinataire s'ouvre sur un repère de FACTURATION en début de ligne : « Client », « Client facturé »,
  « Destinataire », « Acheteur » (seuls ou suivis de « : »), « Facturé à », « Facturé et livré à », « Adressé à »,
  « Adresse de facturation ». Il couvre le repère et les cinq lignes suivantes de la même page au plus, et se ferme sur
  un repère d'émetteur ou sur le début du corps (« Facture », « Date », « Désignation », « Total »…).
- Nom : le texte qui suit le repère sur sa ligne, sinon la ligne suivante, si c'est un nom plausible (ni adresse, ni
  téléphone, ni identifiant).
- Identifiants : SIRET, SIREN (ou RCS), numéro de TVA français, numéro de TVA d'un autre État membre après une étiquette
  de TVA, lus DANS le bloc ; ou sur une ligne dont l'étiquette les attribue au client (« SIRET client », « N° TVA du
  client »), où qu'elle soit. Un tel identifiant n'est plus jamais proposé pour l'émetteur.
- La seule position d'un identifiant sur la page ne suffit jamais.

Abstention (champ vide, motif dans `destinataireAbstention`) : aucun repère ; seul un repère de LIVRAISON (« Livré à »,
« Adresse de livraison » : le lieu livré n'est pas nécessairement le client facturé) ; aucun identifiant lisible dans le
bloc ; plusieurs identifiants désignant des entités différentes (deux blocs contradictoires, deux SIREN) ; identifiant
unique de la pièce (aucun identifiant d'émetteur distinct n'a été lu) ; identifiant du bloc égal à celui de l'émetteur.
Dans les deux derniers cas et celui des identifiants multiples, rien n'est deviné ; le nom seul peut subsister.

Correction apportée au passage : les repères terminés par « à » (« Facturé à », « Livré à ») n'ouvraient pas la zone
client de l'extraction de l'émetteur (frontière de mot non reconnue après une lettre accentuée) ; un identifiant du
client placé sous « Facturé à » pouvait donc être compté parmi les candidats de l'émetteur. Ils l'ouvrent désormais.

**Sens de la pièce** (`determinerSensPiece`, pur) : émetteur = dossier → vente ; destinataire = dossier → achat ; aucun
des deux → indéterminé, avec le motif ; les deux, ou une partie portant deux SIREN → incohérence signalée. Seuls des SIREN
à la clé correcte sont comparés (lus, ou tirés d'un SIRET ou d'une TVA française valides) ; le nom n'est jamais un critère.
Le moteur des tiers garde la nature qualifiée par la personne pour une facture (`sens`) et expose à côté le sens lu
(`sensLu`, `motifSensLu`) ; une contradiction donne une réserve sur la fiche. Pour un avoir, le sens vient des identifiants.

## Règlements, avoirs, reste dû

1. Facture LETTRÉE (`EcritureLet`) : le lettrage du logiciel de production fait foi. Une seule facture dans le groupe :
   toutes les lignes de sens inverse lui sont imputées (règlements partiels, avoir). Plusieurs factures et groupe soldé :
   chacune est réglée, le règlement est marqué « groupé ». Plusieurs factures et groupe non soldé : non déterminable.
2. Facture NON lettrée : est imputée une ligne de sens inverse non lettrée du même compte et du même tiers qui CITE le
   numéro de la facture, ou qu'une personne a confirmée. Une ligne citant plusieurs factures les règle si elle égale leur
   somme ; sinon c'est une proposition. Plusieurs factures confirmées sur une même ligne sans montant saisi : répartition
   par ordre chronologique, marquée comme convention.
3. PROPOSITIONS (jamais comptées) : règlement non lettré du même tiers de montant égal au reste dû ; avoir non lettré du
   même tiers d'un montant au plus égal au reste dû.
4. Preuve bancaire : un règlement porte « rapprochement bancaire validé » quand la ligne de banque de son écriture figure
   dans un rapprochement VALIDÉ par un réviseur sur le lot actif (D-019). Une proposition de rapprochement ne compte pas.

États à la date d'appréciation (clôture de l'exercice par défaut, ou date fournie ; jamais la date du jour) : non échue,
échue non réglée, partiellement réglée, réglée, trop-perçu, non déterminable ; pour un avoir : imputé, partiellement
imputé, non imputé. Une écriture postérieure à la date d'appréciation est listée mais non comptée. Échue = échéance
strictement antérieure à la date d'appréciation. Échéance non lue : jamais inventée ; sans règlement, l'état est « non
déterminable ». Sans écriture identifiée : « non déterminable », reste dû inconnu.

## Suspicion de double comptabilisation

Distincte du doublon binaire (même fichier reçu deux fois, D-010) et de la nouvelle version d'une pièce (D-031).

- Plusieurs écritures : lignes de facture (ou d'avoir) de même compte et tiers, même `PieceRef` normalisée, même montant,
  dans des écritures distinctes — détectée même sans pièce déposée.
- Plusieurs pièces : pièces distinctes de même type, sens, émetteur, numéro et TTC.

Statut « à examiner » jusqu'à la décision d'un réviseur : confirmée (la correction se fait dans le logiciel de production)
ou écartée avec motif. Statuer ne choisit jamais l'écriture à la place de la personne.

## Routes (préfixe `v1`)

| Route | Niveau |
|---|---|
| `GET exercices/:id/tiers` (`q`, `type`, `date`, `page`) | lecture |
| `GET exercices/:id/tiers/fiche?cle=` | lecture |
| `GET exercices/:id/factures` (`etat`, `tiers`, `q`, `date`, `page`) | lecture |
| `GET exercices/:id/factures/:documentId` | lecture |
| `GET exercices/:id/tiers-factures/a-traiter` | lecture |
| `PUT exercices/:id/tiers/liens` | confirmer : collaboration ; infirmer, retirer : révision |
| `PUT exercices/:id/factures/:documentId/liens` | idem |
| `PUT exercices/:id/suspicions` | révision |

Pages de 50 (mouvements : 100). Un déposant ou un autre cabinet reçoit 404.

## Destinataire : correction humaine et réanalyse (D-091)

- **Correction** : `PUT v1/documents/:id/destinataire` (niveau « collaboration », motif obligatoire). Nouvelle version
  d'extraction non validée ; les anciennes versions, l'original et les décisions restent intacts. Chaque champ saisi
  (nom, SIREN, SIRET, TVA, pays) porte sa provenance (qui, quand, pourquoi) et la valeur automatique qu'il remplace ; la
  valeur humaine prime. `GET v1/documents/:id/destinataire` rend les valeurs côte à côte, l'historique des versions, le sens
  relu d'après les identifiants, les signalements et l'état des décisions d'appariement de la pièce.
- **Sens et appariement** : recalculés à chaque lecture, comme tout le reste ; le moteur reçoit désormais le destinataire
  retenu (humain ou automatique). Une décision humaine prise avant la lecture ou la correction du destinataire reste
  appliquée tant que les autres champs de la pièce n'ont pas changé ; la fiche porte alors une réserve. Une correction
  d'un autre champ la rend « à revoir », comme avant.
- **Réanalyse** : `GET v1/dossiers/:id/reanalyse-destinataire` (aperçu), `POST v1/dossiers/:id/reanalyses-destinataire`
  (simulation, puis exécution sur une simulation terminée ; niveau « révision », 50 pièces au plus), `GET
  v1/reanalyses-destinataire/:id` (rapport par pièce), `POST …/reprendre`. Page : `/dossiers/:id/reanalyse-destinataire`.
  Aucune réanalyse automatique. La simulation n'écrit rien ; l'exécution crée une nouvelle version par pièce changée, sans
  jamais écraser une correction humaine (désaccord signalé) ; une pièce déjà relue avec la même version de l'analyseur n'est
  pas refaite.

## Limites

- Destinataire : lu seulement dans les cas décrits plus haut ; une facture en colonnes (émetteur et client côte à côte
  sur les mêmes lignes) ou sans repère explicite donne une abstention, donc une vente « à confirmer ». Le destinataire
  se corrige à la main (couche humaine tracée) et les extractions antérieures se relisent par une réanalyse EXPLICITE :
  voir la section suivante (D-091).
- Euro seulement : une pièce dans une autre devise n'est pas traitée, et c'est dit. Devise non lue : traitée dans la
  devise du dossier, avec une réserve affichée.
- Aucune tolérance de montant (escompte, arrondi, retenue) : ces cas passent par une confirmation humaine.
- Pas de recherche combinatoire d'un règlement groupé non lettré et sans référence.
- Un règlement présent en banque mais pas encore comptabilisé n'est pas vu (le rapprochement porte sur des écritures).
- Calcul immédiat à chaque lecture : plafonds de 400 000 lignes et 5 000 pièces par exercice ; pas de chemin en flux.
- Pièces retenues : nature facture d'achat, facture de vente ou avoir, version courante, extraction non rejetée, rattachées
  à l'exercice ou dont la date d'émission y tombe (ou n'est pas lue).
- Préfixes de comptes et tolérance de date sont des paramètres du moteur, non réglables depuis l'écran.
- Reprise des à-nouveaux : une facture de l'exercice précédent n'est pas reliée à sa ligne d'à-nouveau.

## Validations attendues d'un expert-comptable

- Liste des comptes de tiers (401, 403, 404, 405 ; 411, 413, 416) et qualification des natures de lignes.
- Tolérance de 31 jours entre date de pièce et date d'écriture ; longueur minimale de 5 caractères d'un numéro cherché
  dans un libellé.
- Règle « un lien est déterministe si le tiers n'est que proposé par son nom, dès lors que référence, montant et date
  concordent » — elle vaut désormais aussi pour le client d'une vente, lu comme destinataire.
- Repères de destinataire retenus dans le texte d'une facture, et refus de « Livré à » comme repère du client facturé.
- Lecture du lettrage (groupe soldé à plusieurs factures = toutes réglées) et convention de répartition chronologique.
- Définition de l'échéance « échue » et choix de la clôture comme date d'appréciation par défaut.
- Critères de la suspicion de double comptabilisation.
