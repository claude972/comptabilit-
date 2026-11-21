# Comparatif N-1 des états et de la liasse (projet)

**Ce que vous pouvez faire.** Ouvrir un dossier, puis :

- **Analyse** (`/dossiers/:id/analyse`) : les projets de bilan et de compte de résultat affichent une colonne « N-1 » (net pour l'actif) et le total N-1 à côté de chaque total.
- **États fiscaux** (`/dossiers/:id/fiscal`, liasse réel normal ou simplifié) : chaque tableau (2050 à 2053, 2033-A et 2033-B) affiche une colonne « N-1 ».
- **API** : `GET v1/exercices/:id/etats` (champ `comparatif`) et `GET v1/exercices/:id/liasse` (`resultat.comparatif` et `n1` sur chaque ligne).

**Quand la colonne apparaît.** L'exercice précédent du dossier doit être *contigu* (il se termine la veille de l'ouverture de l'exercice demandé), avoir une comptabilité importée (FEC) active, et entrer dans la période couverte par les tables (exercice ouvert à compter du 1er janvier 2025). Sinon l'écran dit pourquoi la colonne est « indisponible » : aucun chiffre n'est inventé ni extrapolé.

**À lire avant de s'en servir.**
- Le N-1 est calculé sur les écritures importées de l'exercice précédent, avant écritures d'inventaire, avec la même table de correspondance que N : ce n'est pas le N-1 des comptes annuels approuvés. Une différence avec les comptes approuvés est normale si des écritures d'inventaire ou d'approbation n'ont pas été importées.
- Si l'exercice précédent ne dure pas douze mois, l'écran le signale : les montants ne sont pas comparables.
- Tout reste un **projet** non validé par un professionnel ; aucune déclaration n'est transmise. Les codes de cases des formulaires restent « à confirmer », les montants ne sont pas arrondis à l'euro.
- Les droits sont ceux de la lecture du dossier ; un client « dépôt » n'y accède pas.

Décision et limites : `decisions.md`, D-103.
