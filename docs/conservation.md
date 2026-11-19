# Politique de conservation, de restitution et de suppression

État : cadre technique en place pour une partie ; les durées et leurs fondements juridiques sont à valider par un professionnel du droit avant toute mise en service. Aucune durée n'est appliquée automatiquement à ce jour.

## Ce que le logiciel fait aujourd'hui

| Catégorie | Emplacement | Comportement réel |
|---|---|---|
| Originaux des pièces et des fichiers comptables | Stockage objet, clé = empreinte SHA-256 | Jamais réécrits ni modifiés. Aucune suppression automatique. |
| Morceaux de téléversement | Stockage objet, préfixe `tmp/` | Supprimés dès la clôture du téléversement. Les morceaux d'un téléversement abandonné ne sont PAS encore purgés (tâche de purge à écrire). |
| Données extraites, lignes d'écriture, constats, décisions | PostgreSQL | Versionnées ; les anciennes versions sont conservées. Aucune purge. |
| Journal d'audit | PostgreSQL, ajout seul, chaîné par empreinte | Ni modification ni suppression possibles, y compris par le propriétaire des tables. Pas encore d'archivage externe protégé. |
| Sauvegardes | Script local `scripts/sauvegarder.sh` | Développement uniquement. La politique de production est à définir. |
| Dépôts en attente sur le téléphone | IndexedDB de l'appareil | Voir la documentation de l'application web. |

## Ce qui est modélisé mais pas appliqué

La table `politiques_conservation` permet de déclarer, par cabinet et par catégorie, une durée, son fondement et le caractère immuable. Aucun traitement ne la lit encore. L'immuabilité est désactivée par défaut : une conservation irréversible n'est jamais appliquée sans durée ni responsable définis.

## Object Lock

Source : documentation OVHcloud, <https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-managing-object-lock> (page mise à jour le 5 novembre 2026, consultée le 2026-11-19).

- Deux modes de rétention, gouvernance et conformité, plus une conservation légale (« legal hold »).
- Le versionnement du bucket doit être activé.
- Le verrouillage se choisit À LA CRÉATION du bucket et ne peut pas être ajouté ensuite ; une fois activé, il est irréversible pour ce bucket.
- En mode conformité, ni le mode ni la durée ne peuvent être modifiés une fois appliqués à un objet.

Conséquence de conception : les buckets de production destinés aux éléments à rétention immuable doivent être créés avec le verrouillage dès l'origine, séparément du bucket courant. Rien de cela n'est testé : le stockage local de développement ne sert pas à valider Object Lock.

## Restitution

Non implémentée comme fonction unique. Le dossier de révision exportable (PDF + JSON + inventaire des pièces avec empreintes) couvre un exercice. L'export complet prévu par le cahier des charges (originaux, données, liens, constats, décisions, règles propres au cabinet) reste à développer.

## Suppression à la résiliation

Non implémentée. À définir par catégorie, en conciliant suppression, obligations de conservation et restitution, sauvegardes et journaux compris.

## Durées à faire valider

Ce document ne propose volontairement aucune durée chiffrée : les durées applicables aux pièces comptables, aux documents fiscaux, aux dossiers de travail du cabinet et aux journaux dépendent de textes qui n'ont pas été vérifiés dans le cadre de ce lot.
