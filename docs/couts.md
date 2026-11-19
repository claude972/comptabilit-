# Estimation des coûts par profil de dossier

État : estimation PARTIELLE. Seuls les tarifs d'IA ont pu être relevés sur une page officielle ; les tarifs d'infrastructure ne sont pas chiffrés ici (voir « Ce qui manque »). Aucun de ces montants n'a été confronté à une facture réelle.

## Tarifs relevés

Source : catalogue OVHcloud AI Endpoints, <https://www.ovhcloud.com/fr/public-cloud/ai-endpoints/catalog/>, consulté le 2026-11-19 (prix affichés en euros, hors taxes selon la page).

| Modèle | Usage prévu | Prix | Autres éléments affichés |
|---|---|---|---|
| Mistral-Small-3.2-24B-Instruct-2506 | Classement, explication, rédaction | 0,09 € / M tokens en entrée ; 0,28 € / M tokens en sortie | Licence Apache 2.0, contexte 128K, appel de fonctions, sortie structurée, vision |
| bge-m3 | Embeddings | 0,01 € / M tokens | Licence MIT, 1 024 dimensions, séquence max. 8 192 tokens |

Les deux modèles retenus par le cahier des charges sont présents au catalogue à cette date et ne portent pas la mention « en cours de retrait ». Non vérifié sur cette page : région de traitement, conservation des requêtes, engagement de non-réutilisation pour l'entraînement, conditions contractuelles. Ces points conditionnent l'activation (voir `acces-externes.md`).

## Hypothèses d'usage de l'IA (à valider par la mesure)

Ces volumes sont des hypothèses de conception, pas des mesures : l'IA n'est appelée par aucun traitement livré à ce jour.

| Profil de dossier | Pièces / an | Appels IA par pièce | Tokens entrée / appel | Tokens sortie / appel | Questions assistant / an |
|---|---|---|---|---|---|
| Petit (TPE) | 300 | 1 | 2 000 | 300 | 50 |
| Moyen | 1 200 | 1 | 2 000 | 300 | 150 |
| Important (PME) | 4 000 | 1 | 2 000 | 300 | 400 |

Hypothèse pour une question à l'assistant : 6 000 tokens en entrée, 600 en sortie. Embeddings : 1 500 tokens par pièce.

## Coût d'IA annuel estimé par dossier

Calcul : `pièces × (2 000 × 0,09 + 300 × 0,28) / 1 000 000 + questions × (6 000 × 0,09 + 600 × 0,28) / 1 000 000 + pièces × 1 500 × 0,01 / 1 000 000`.

| Profil | Qualification des pièces | Assistant | Embeddings | Total IA / an |
|---|---|---|---|---|
| Petit | 0,08 € | 0,04 € | 0,005 € | ≈ 0,12 € |
| Moyen | 0,32 € | 0,11 € | 0,02 € | ≈ 0,44 € |
| Important | 1,06 € | 0,28 € | 0,06 € | ≈ 1,40 € |

Avec ces hypothèses, l'IA est un poste marginal ; le coût d'un dossier sera dominé par l'infrastructure fixe (base, calcul, OCR) répartie sur le nombre de dossiers actifs.

## Ce qui manque

| Poste | Raison | Action |
|---|---|---|
| Instances de calcul (API, worker, OCR, Keycloak) | Tableaux de prix non lisibles par l'outil de consultation (page dynamique) | Relever sur <https://www.ovhcloud.com/fr/public-cloud/prices/> |
| PostgreSQL managé, Valkey/Redis managé | Idem | Idem |
| Stockage objet (Go/mois), archive froide | Idem. La page produit annonce un stockage « sans frais de sortie », sans chiffre. | Idem |
| Temps d'OCR par page en production | Mesuré seulement en local (voir `services/ocr/README.md`) | Mesurer sur l'instance cible |
| Volumes réels de tokens | Aucun appel IA réel | Mesurer lors de l'évaluation du modèle |

Volumes de stockage à prévoir (hypothèse) : 0,3 Mo par page de pièce, soit environ 0,2 Go par an pour un petit dossier et 2,5 Go pour un dossier important, hors sauvegardes.
