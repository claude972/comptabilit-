# Infrastructure cible — ÉBAUCHE.
# État : validée syntaxiquement par `tofu validate` (schéma du fournisseur ovh/ovh 2.25.0) ; JAMAIS appliquée ni même
# planifiée contre un projet réel (aucun identifiant OVHcloud). Elle ne couvre que la base managée et le stockage objet.
# Restent à décrire : réseau privé (vRack), instances ou service de conteneurs (API, worker, web, OCR, Keycloak), Valkey
# managé, répartition de charge et TLS, supervision, secrets, sauvegardes et leur restauration.

provider "ovh" {
  endpoint = "ovh-eu"
}

locals {
  prefixe = "comtaple-${var.environnement}"
}

# Base de données managée. Les rôles applicatifs (sans BYPASSRLS) et les migrations sont créés par l'application
# (packages/db), pas ici : voir docs/deploiement.md pour le rôle de migration.
resource "ovh_cloud_project_database" "postgresql" {
  service_name        = var.projet_ovh
  description         = "${local.prefixe}-postgresql"
  engine              = "postgresql"
  version             = var.postgresql_version
  plan                = var.postgresql_plan
  flavor              = var.postgresql_gabarit
  deletion_protection = true

  nodes {
    region = upper(var.region)
  }
}

# Stockage courant : originaux adressés par empreinte, dérivés, exports. Versionné, chiffré côté serveur.
resource "ovh_cloud_storage_object_bucket" "courant" {
  service_name = var.projet_ovh
  region       = upper(var.region)
  name         = "${local.prefixe}-documents"

  versioning = {
    status = "ENABLED"
  }
  encryption = {
    algorithm = "AES256"
  }
}

# Bucket à rétention immuable (archives du journal d'audit, pièces soumises à conservation).
# Object Lock se choisit À LA CRÉATION du bucket et est irréversible : il est donc séparé du stockage courant.
resource "ovh_cloud_storage_object_bucket" "verrouille" {
  service_name = var.projet_ovh
  region       = upper(var.region)
  name         = "${local.prefixe}-archives-verrouillees"

  versioning = {
    status = "ENABLED"
  }
  encryption = {
    algorithm = "AES256"
  }
  object_lock = {
    status          = "ENABLED"
    mode            = var.mode_verrouillage
    retention_years = var.retention_immuable_annees
  }
}
