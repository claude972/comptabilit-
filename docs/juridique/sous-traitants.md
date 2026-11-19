# Sous-traitants ultérieurs prévus

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

**État au 2026-11-19 : aucun sous-traitant n'est contracté.** Aucun compte n'a été ouvert chez un fournisseur, aucune dépense engagée, aucun accord de traitement de données signé ni même lu. Le logiciel tourne uniquement en local. La liste ci-dessous décrit ce qui est PRÉVU.

## 1. Sous-traitants ultérieurs prévus

| # | Fournisseur | Service | Traitement confié | Données | Localisation prévue | Statut réel | À vérifier avant tout engagement |
|---|---|---|---|---|---|---|---|
| S1 | OVHcloud (`[À COMPLÉTER : entité contractante exacte]`) | Public Cloud : calcul, base PostgreSQL managée, files (Valkey/Redis managé), Object Storage S3, gestionnaire de secrets, sauvegardes de l'hébergeur | Hébergement de toute la plateforme | Toutes les données (voir `registre-traitements.md` §2) | Région française, à choisir | **Non contracté, non déployé.** Ébauche d'infrastructure validée syntaxiquement, jamais appliquée | Accord de traitement (art. 28) ; région et absence de transfert hors UE ; sous-traitants d'OVHcloud ; chiffrement au repos ; accès du personnel de l'hébergeur ; conservation et effacement des sauvegardes ; Object Lock ; réversibilité ; certifications revendiquées par le fournisseur (à lire sur ses documents, rien n'est repris ici) |
| S2 | OVHcloud | AI Endpoints : modèle Mistral-Small-3.2-24B-Instruct-2506 (classement, explication, rédaction) et bge-m3 (embeddings) | Inférence sur des extraits de pièces, d'écritures et de questions | Extraits pouvant contenir des données personnelles | À vérifier | **Non connecté, non contracté.** Aucune donnée n'a jamais été envoyée ; aucun traitement livré n'appelle l'IA | Région de traitement ; conservation des requêtes et des réponses ; engagement contractuel de non-réutilisation pour l'entraînement ; journalisation côté fournisseur ; conditions particulières applicables ; qualité de sous-traitant ; intervention éventuelle de tiers (éditeur du modèle) |

Constat du 2026-11-19 sur S2 : les pages publiques d'OVHcloud affirment que les données ne sont pas utilisées pour l'entraînement, ne sont pas conservées hors facturation, et que le service s'exécute dans l'Union européenne ; la documentation renvoie à des conditions particulières du Public Cloud. Ce sont des déclarations de pages produit, relevées par une recherche : **les conditions contractuelles n'ont pas été lues**. Elles ne peuvent fonder aucun engagement envers un Cabinet tant qu'elles ne sont pas vérifiées dans le contrat (validation V10 de `../risques.md`).

## 2. Composants sans sous-traitant

Exécutés par l'Éditeur sur sa propre infrastructure (donc chez S1 en production), sans envoi de données à un tiers :

| Composant | Rôle | Remarque |
|---|---|---|
| PaddleOCR (service `services/ocr`) | OCR | Local, sans appel réseau à l'exécution ; ne doit avoir aucun accès sortant |
| ClamAV | Antivirus | Local. `[À COMPLÉTER : la mise à jour des signatures suppose un flux entrant depuis les serveurs de l'éditeur de ClamAV ; il ne porte aucune donnée de dossier — à confirmer à la mise en production]` |
| Keycloak | Identités | Auto-hébergé |
| PostgreSQL, Redis, stockage objet | Données | Locaux aujourd'hui ; services managés de S1 en production |
| Chromium / Playwright | Rendu PDF | Hors ligne |

Les logiciels libres utilisés ne sont pas des sous-traitants : leurs éditeurs ne reçoivent aucune donnée.

## 3. Tiers qui ne sont pas (a priori) des sous-traitants de l'Éditeur — à trancher

| Tiers | Lien | État réel | Question |
|---|---|---|---|
| Google (API Gmail) | Source de messages pour le connecteur en lecture seule | Jamais connecté ; aucune application OAuth créée | Google héberge déjà la boîte par choix du Cabinet ou de l'Entité cliente : il serait leur prestataire, pas celui de l'Éditeur. `[À TRANCHER : qualification ; existence d'un transfert hors UE imputable à l'Éditeur ; obligations liées aux conditions d'usage des API]`. Les règles de Google sur les données utilisateur (page mise à jour le 15 février 2024) imposent une « utilisation limitée » des données des scopes restreints et, selon les cas, une évaluation de sécurité annuelle par un tiers : à lire et à intégrer au projet avant toute demande de vérification. |
| Microsoft (Graph, Microsoft 365) | Idem | Jamais connecté ; aucune inscription d'application | Idem ; consentement des administrateurs des tenants ; conditions des API non lues |
| Fournisseur d'ancrage du journal d'audit | Dépôt d'empreintes chez un tiers indépendant | Aucun tiers choisi, aucun dépôt | Seules des empreintes seraient transmises : `[À TRANCHER : absence de donnée personnelle à confirmer]` |
| Prestataire d'agrégation bancaire | Connexion bancaire directe | Non développé, aucun prestataire choisi | Hors périmètre actuel |
| GitHub | Hébergement du code source et intégration continue | Dépôt public | Ne reçoit aucune donnée de Cabinet ; les jeux de test sont synthétiques. À surveiller : ne jamais y placer de données réelles |
| Sites officiels surveillés par la veille (BOFiP, Légifrance) | Requêtes de lecture | En place | Aucune donnée personnelle transmise |

## 4. Services absents

Aucun service d'envoi de courriels, de SMS ou de notifications poussées ; aucun outil de mesure d'audience, de suivi d'erreurs ou de support hébergé par un tiers ; aucun outil de facturation tiers. S'ils sont ajoutés, ils devront entrer dans cette liste avant leur mise en service.

## 5. Procédure proposée de gestion de la liste

1. Aucun fournisseur recevant des données de Cabinets n'est mis en service avant : lecture de son contrat et de son accord de traitement, vérification de la localisation, inscription dans cette liste, mise à jour du registre.
2. Le contrat avec le Cabinet prévoit une autorisation générale avec information préalable de tout ajout ou remplacement et droit d'objection (art. 28 §2) — délai proposé `[À TRANCHER : 30 jours]`.
3. Les obligations du contrat Cabinet ↔ Éditeur sont répercutées au fournisseur (art. 28 §4) ; l'Éditeur demeure responsable devant le Cabinet de l'exécution par le fournisseur.
4. La liste publiée aux Cabinets indique : identité, service, localisation, date d'effet.

## Références

Consultées le 2026-11-19.

- RGPD, art. 28 §2 et §4, chapitre V (transferts) : <https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679>
- OVHcloud, catalogue AI Endpoints (déjà cité dans `../couts.md`) : <https://www.ovhcloud.com/fr/public-cloud/ai-endpoints/catalog/> — page tarifaire ; conditions contractuelles non lues.
- Google, « Google API Services User Data Policy » (mise à jour du 15 février 2024) : <https://developers.google.com/terms/api-services-user-data-policy> — lue par résumé automatique ; à relire intégralement.
- Conditions des API Microsoft Graph : non consultées.
