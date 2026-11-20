# Grafana Tempo (entrepôt de traces) avec la configuration de Comtaple embarquée : l'image officielle n'a pas de shell
# et aucun dossier de l'hôte n'est monté (D-006). Les bornes (rétention, débit) viennent de l'environnement.
FROM grafana/tempo:3.1.1
COPY tempo.yaml /etc/tempo/tempo.yaml
