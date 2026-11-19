terraform {
  required_version = ">= 1.13.0"
  required_providers {
    ovh = {
      source  = "ovh/ovh"
      version = "2.25.0"
    }
  }

  # État : LOCAL par défaut (la CI exécute `tofu init -input=false && tofu validate` sans aucun identifiant).
  # L'état contient des secrets (clé S3 de l'application, mots de passe des utilisateurs de base) : avant tout
  # `tofu apply` réel, le placer dans un stockage chiffré à accès restreint, par exemple un bucket S3 OVHcloud dédié,
  # créé à la main, déclaré dans un fichier `backend.tf` NON versionné :
  #
  #   terraform {
  #     backend "s3" {
  #       bucket = "<bucket-d-etat>"
  #       key    = "comtaple/<environnement>.tfstate"
  #       region = "gra"
  #       endpoints = { s3 = "https://s3.gra.io.cloud.ovh.net" }
  #       skip_credentials_validation = true
  #       skip_region_validation      = true
  #       skip_requesting_account_id  = true
  #       skip_s3_checksum            = true
  #     }
  #   }
  #
  # Ce bloc n'a jamais été essayé (aucun compte OVHcloud).
}
