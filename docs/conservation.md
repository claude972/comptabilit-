# Politique de conservation, de restitution et de suppression

État : cadre technique en place pour une partie ; les durées et leurs fondements juridiques sont à valider par un professionnel du droit avant toute mise en service. Aucune durée n'est appliquée automatiquement à ce jour.

## Ce que le logiciel fait aujourd'hui

| Catégorie | Emplacement | Comportement réel |
|---|---|---|
| Originaux des pièces et des fichiers comptables | Stockage objet, clé = empreinte SHA-256 | Jamais réécrits ni modifiés. Aucune suppression automatique. |
| Morceaux de téléversement | Stockage objet, préfixe `tmp/` | Supprimés dès la clôture ou l'abandon explicite du téléversement. Un téléversement jamais terminé expire après 7 jours ; ses morceaux sont alors purgés par le worker (purge non exercée par un test). |
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

Export de restitution par dossier (habilitation de validation) : archive ZIP contenant les originaux non modifiés (relus et comparés à leur empreinte), les données structurées (pièces et leurs versions d'extraction, imports, révision, décisions, banque, rapprochements, règles du cabinet applicables, journal d'audit du dossier), les écritures normalisées en CSV, et un manifeste d'empreintes SHA-256. Les originaux écartés par l'antivirus ne sont pas restitués ; le manifeste les liste. L'export reste possible quand l'abonnement est suspendu ou résilié.

Non couvert : restitution d'un cabinet entier en une opération ; restitution des sauvegardes et des journaux techniques ; format d'échange normalisé avec un autre logiciel.

## Suppression à la résiliation

Non implémentée. La résiliation d'un abonnement ferme les dépôts à son échéance mais ne supprime aucune donnée. Le devenir de chaque catégorie (suppression, conservation obligatoire, sauvegardes, journaux) reste à définir.

## Durées à faire valider

Ce document ne propose volontairement aucune durée chiffrée : les durées applicables aux pièces comptables, aux documents fiscaux, aux dossiers de travail du cabinet et aux journaux dépendent de textes qui n'ont pas été vérifiés dans le cadre de ce lot.
