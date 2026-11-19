# Prometheus avec les règles d'alerte de Comtaple embarquées (aucun montage de dossier hôte, D-006).
# La configuration de collecte (cibles) est passée par `configs` dans compose.supervision.yaml.
FROM prom/prometheus:v3.16.0
COPY alertes.yml /etc/prometheus/regles/alertes.yml
