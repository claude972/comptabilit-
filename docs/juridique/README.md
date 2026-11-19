# Dossier juridique — index

> **PROJET — à faire valider par un DPO / avocat. Aucune approbation juridique n'a été donnée.**

Ce dossier rassemble les projets de documents demandés par le cahier des charges (section « RGPD et réglementation »). Ils ont été rédigés par l'équipe de développement, sans juriste. Ils décrivent l'état réel du logiciel au 2026-11-19 (environnement local uniquement, aucune donnée réelle, aucun sous-traitant contracté) et proposent des analyses à faire valider. Aucun de ces documents ne permet d'affirmer une conformité, une certification ou une validation.

Conventions :

- `[À COMPLÉTER : …]` : information que seul l'éditeur ou le cabinet peut fournir.
- `[À TRANCHER : …]` : choix qui relève d'un DPO ou d'un avocat.
- « l'Éditeur » : la société qui édite Comtaple (`[À COMPLÉTER : dénomination, forme, siège, RCS]`). « le Cabinet » : le cabinet d'expertise comptable client. « l'Entité cliente » : l'entreprise cliente du Cabinet, dont le dossier est traité.

## Documents

| Fichier | Objet | Statut au 2026-11-19 |
|---|---|---|
| [`registre-traitements.md`](registre-traitements.md) | Cartographie des traitements et des flux ; projet de registre (art. 30 RGPD) | Projet, non validé |
| [`roles-rgpd.md`](roles-rgpd.md) | Qualification des rôles par finalité | Projet ; plusieurs qualifications ouvertes |
| [`contrat-sous-traitance-projet.md`](contrat-sous-traitance-projet.md) | Projet de contrat de traitement (art. 28 RGPD) | Projet ; clauses à compléter balisées |
| [`sous-traitants.md`](sous-traitants.md) | Sous-traitants ultérieurs prévus | Projet ; aucun contrat conclu, aucune condition vérifiée |
| [`gestion-des-droits.md`](gestion-des-droits.md) | Procédure d'exercice des droits des personnes | Projet ; plusieurs droits sans outillage logiciel |
| [`procedure-incident.md`](procedure-incident.md) | Gestion d'un incident de sécurité / d'une violation de données | Projet ; jamais exercée, rôles non désignés |
| [`analyse-aipd.md`](analyse-aipd.md) | Analyse de nécessité d'une AIPD | Projet ; conclusion proposée, non validée |
| [`analyse-reglement-ia.md`](analyse-reglement-ia.md) | Obligations du règlement (UE) 2024/1689 | Projet ; classification proposée, non validée |
| [`secret-professionnel-responsabilites.md`](secret-professionnel-responsabilites.md) | Secret professionnel, responsabilités contractuelles | Projet ; points d'attention et clauses à prévoir |
| [`../conservation.md`](../conservation.md) | Durées de conservation proposées et fondements | Propositions, rien n'est arrêté ni appliqué |

## Ce qu'un DPO / avocat doit valider

Liste de contrôle. Chaque ligne renvoie au document où la question est posée.

### Rôles et contrat (V4)

1. Qualification de l'Éditeur comme sous-traitant du Cabinet pour le service, et la liste des finalités où il serait responsable de traitement (`roles-rgpd.md` §3 et §4).
2. Qualification du Cabinet vis-à-vis de l'Entité cliente, mission par mission (tenue, révision, paie, conseil) : responsable, sous-traitant ou responsable conjoint ; conséquence sur le rang de l'Éditeur (sous-traitant ou sous-traitant ultérieur) (`roles-rgpd.md` §5).
3. Qualification des mesures d'usage (« indicateurs d'activité du logiciel », métriques techniques) : sous-traitance ou finalité propre de l'Éditeur ; conditions d'une éventuelle réutilisation (`roles-rgpd.md` §4.3).
4. Statut des connecteurs Gmail / Microsoft 365 : Google et Microsoft sont-ils de simples sources choisies par le Cabinet, ou faut-il les inscrire quelque part dans la chaîne ? Transferts hors UE éventuels (`sous-traitants.md` §3).
5. Projet de contrat : choix entre rédaction propre et clauses contractuelles types de la décision (UE) 2021/915 ; régime d'autorisation des sous-traitants ultérieurs ; délais de préavis, d'audit, de notification ; sort des données en fin de contrat (`contrat-sous-traitance-projet.md`).
6. Nécessité de désigner un DPO pour l'Éditeur (art. 37 RGPD) (`registre-traitements.md` §1).
7. Contenu et forme du registre : registre de sous-traitant (art. 30.2) et registre de responsable (art. 30.1) (`registre-traitements.md`).
8. Bases légales proposées pour les traitements dont l'Éditeur serait responsable (`registre-traitements.md` §4).
9. Mentions d'information des personnes (utilisateurs du Cabinet, clients déposants) : non rédigées ; à produire.

### Droits, incidents, conservation (V4, V8)

10. Procédure d'exercice des droits et répartition Cabinet / Éditeur ; traitement des demandes d'effacement face aux obligations de conservation et au journal d'audit en ajout seul (`gestion-des-droits.md` §4 et §6).
11. Procédure d'incident : délais contractuels de notification au Cabinet, critères de qualification du risque, modèle de registre des violations (`procedure-incident.md`).
12. Chaque durée proposée dans `../conservation.md`, son point de départ et son fondement ; en particulier le journal d'audit, les dossiers de travail du Cabinet et les sauvegardes.
13. Sort des données à la résiliation (aucune suppression n'est implémentée aujourd'hui).

### AIPD (V5)

14. Conclusion proposée sur la nécessité d'une AIPD, appréciation des critères « grande échelle », « usage innovant », « données à caractère hautement personnel » ; qui la réalise (le Cabinet responsable, avec l'aide de l'Éditeur) (`analyse-aipd.md`).

### Règlement IA (V6)

15. Qualification de l'Éditeur (fournisseur d'un système d'IA) et du Cabinet (déployeur) ; classification proposée de chaque usage hors annexe III ; portée de l'article 50 §1 et §2 pour l'assistant et les suggestions ; mesures de « maîtrise de l'IA » (art. 4 modifié) (`analyse-reglement-ia.md`).

### Secret professionnel et responsabilités (V7)

16. Compatibilité de l'hébergement et de l'accès du support avec le secret professionnel du Cabinet ; clauses de confidentialité, de réversibilité, de responsabilité, plafonds, assurance ; conditions générales (non rédigées) (`secret-professionnel-responsabilites.md`).

### Fournisseurs (V10)

17. Conditions contractuelles réelles d'OVHcloud (Public Cloud, AI Endpoints), de Google et de Microsoft : accord de traitement, localisation, conservation des requêtes, non-réutilisation, sous-traitants de rang suivant (`sous-traitants.md`).

## Sources et vérification

Chaque document liste ses références avec lien et date de consultation. Synthèse des vérifications faites le 2026-11-19 :

**Lues en ligne sur la source officielle (texte consulté)**

- Règlement (UE) 2016/679 (RGPD), texte du JO L 119 du 4.5.2016, EUR-Lex. Version initiale ; les versions consolidées et rectificatifs n'ont pas été comparés.
- Règlement (UE) 2024/1689 (IA), JO série L du 12.7.2024, EUR-Lex.
- Règlement (UE) 2026/1744 du 8 juillet 2026 (« omnibus numérique sur l'IA »), JO série L du 24.7.2026, EUR-Lex : modifie notamment les articles 4, 50 §7, 99, 111 et 113 du règlement (UE) 2024/1689.
- Décision d'exécution (UE) 2021/915 du 4 juin 2021 (clauses contractuelles types art. 28), EUR-Lex.
- CNIL : pages AIPD, violations de données, registre, identification des rôles, réutilisation par le sous-traitant, clauses contractuelles types, droit d'accès, durées de conservation, recommandation journalisation ; listes AIPD requise / non requise (PDF) ; guide du sous-traitant (édition septembre 2017, PDF).
- CEPD : pages de présentation des lignes directrices 07/2020 et 9/2022 (titres, versions et dates ; le corps des lignes directrices n'a pas été relu).
- Service-Public Entreprendre, fiche F10029 (délais de conservation), « vérifié le 1er juillet 2024 ».
- BOFiP, BOI-CF-COM-10-10-30 du 03/09/2025 (art. L. 102 B du LPF).
- Ordre des experts-comptables : « Code de déontologie », édition janvier 2024, et « Réglementation de l'expertise comptable », édition mars 2024 (textes reproduits par le Conseil national ; éditions de 2024, modifications postérieures non vérifiées).
- Commission européenne : annonce des lignes directrices sur l'article 50 du règlement IA (20 juillet 2026) ; le texte des lignes directrices n'a pas été lu.

**Non revérifiées en ligne le 2026-11-19 (Légifrance a refusé l'accès automatisé, erreur 403)**

- Code de commerce, art. L. 123-22 ; Livre des procédures fiscales, art. L. 102 B et L. 169 ; Code civil, art. 2224 ; Code pénal, art. 226-13 et 226-14 ; Code du travail, art. L. 3243-4 ; Code monétaire et financier, art. L. 561-2 et L. 561-12 ; loi n° 78-17 du 6 janvier 1978 ; ordonnance n° 45-2138 et décret n° 2012-432 dans leur version en vigueur ; délibérations CNIL n° 2018-326, 2018-327, 2019-118 et 2021-122 dans leur version publiée au JO.
- Pour ces textes, le contenu cité provient d'une source officielle secondaire (Service-Public, BOFiP, CNIL, Ordre) quand elle existe ; c'est indiqué à chaque fois. Un juriste doit relire les textes eux-mêmes.

**Non vérifiées du tout**

- Conditions contractuelles d'OVHcloud, de Google et de Microsoft (seules des pages publiques ont été vues ; aucun contrat lu).
- Lignes directrices de la Commission sur l'article 6 du règlement IA (classification à haut risque) : existence et contenu non vérifiés.
- État de la proposition « omnibus numérique » modifiant le RGPD (procédure 2025/0360(COD)) : aucune adoption n'a été trouvée ; l'état exact à ce jour n'a pas été confirmé sur une source officielle. Si elle est adoptée, les délais de l'article 33 notamment peuvent changer.
- Normes professionnelles de l'Ordre (NPMQ, norme anti-blanchiment) et recommandations de l'Ordre sur l'externalisation ou la conservation des dossiers de travail.
