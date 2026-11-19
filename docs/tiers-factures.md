# Tiers, factures et avoirs suivis, échéances et règlements

Aide à la révision, par dossier et par exercice. Rien n'est comptabilisé ni lettré : le logiciel de production comptable
reste la référence. Tout ce que le moteur déduit est un PROJET tant qu'une personne habilitée ne l'a pas confirmé.
Aucune règle de ce document n'a été validée par un expert-comptable (voir « Validations attendues »).

Code : moteur `packages/core/src/tiers/` (`suivreTiersEtFactures`, pur, 36 tests) ; API `apps/api/src/tiers.controller.ts` ;
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
- Tiers de pièce : l'émetteur lu sur une facture d'ACHAT. Clé, par ordre : SIREN valide (lu, ou tiré d'un SIRET ou d'un
  numéro de TVA français valides), sinon numéro de TVA étranger, sinon nom normalisé. Le destinataire n'est pas extrait des
  pièces : le client d'une facture de VENTE n'est jamais identifié par la pièce.
- Rattachement automatique : uniquement par identifiant fort — un SIREN valide (clé de Luhn) présent dans le numéro ou le
  libellé du compte auxiliaire et égal à celui de la pièce.
- Sinon : PROPOSITION quand le nom normalisé de l'émetteur (sans accents, casse, ponctuation ni forme juridique) est
  identique à celui d'un compte auxiliaire fournisseur. Plusieurs comptes de même nom = homonymes : tous listés, aucun
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
- **À confirmer** : montant égal et référence ou tiers concordant, mais pas tout (cas de toutes les ventes).
- **Non trouvé / non recherché** : avec le motif (TTC non lu, devise autre que l'euro, aucune écriture…).
- Une personne confirme (collaboration) ou infirme avec motif (révision) ; un lien confirmé l'emporte.

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

## Limites

- Destinataire non extrait : ventes jamais appariées d'office ; avoirs dont le sens n'est déductible que si le SIREN du
  dossier et celui de l'émetteur sont connus.
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
  concordent ».
- Lecture du lettrage (groupe soldé à plusieurs factures = toutes réglées) et convention de répartition chronologique.
- Définition de l'échéance « échue » et choix de la clôture comme date d'appréciation par défaut.
- Critères de la suspicion de double comptabilisation.
