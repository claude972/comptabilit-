output "bucket_documents" {
  value = ovh_cloud_storage_object_bucket.courant.name
}

output "bucket_archives" {
  value = ovh_cloud_storage_object_bucket.archives.name
}

output "bucket_sauvegardes" {
  value = ovh_cloud_storage_object_bucket.sauvegardes.name
}

output "s3_cle_acces" {
  description = "Clé d'accès S3 de l'application (S3_ACCESS_KEY)."
  value       = ovh_cloud_project_user_s3_credential.stockage.access_key_id
}

output "s3_cle_secrete" {
  description = "Clé secrète S3 de l'application (S3_SECRET_KEY). Lire avec `tofu output -raw s3_cle_secrete`."
  value       = ovh_cloud_project_user_s3_credential.stockage.secret_access_key
  sensitive   = true
}

output "base_postgresql_id" {
  value = ovh_cloud_project_database.postgresql.id
}

output "base_postgresql_points_d_acces" {
  description = "Points d'accès de la base managée (hôte et port pour PG_HOST / PG_PORT)."
  value       = ovh_cloud_project_database.postgresql.endpoints
}

output "base_mot_de_passe_migration" {
  description = "Mot de passe initial du rôle de migration (PG_ADMIN_PASSWORD)."
  value       = ovh_cloud_project_database_postgresql_user.migration.password
  sensitive   = true
}

output "base_mot_de_passe_keycloak" {
  description = "Mot de passe initial de l'utilisateur de base de Keycloak (KC_DB_PASSWORD)."
  value       = ovh_cloud_project_database_postgresql_user.keycloak.password
  sensitive   = true
}

output "valkey_points_d_acces" {
  description = "Points d'accès du Valkey managé, s'il est créé."
  value       = one(ovh_cloud_project_database.valkey[*].endpoints)
}

output "instance_applications_adresses" {
  description = "Interfaces et adresses de l'instance applicative (l'adresse publique est celle à inscrire dans le DNS)."
  value       = ovh_cloud_instance.applications.current_state.networks
}

output "instance_supervision_adresses" {
  value = ovh_cloud_instance.supervision.current_state.networks
}

output "registre_url" {
  description = "Adresse du registre de conteneurs, s'il est créé."
  value       = one(ovh_cloud_project_containerregistry.images[*].url)
}
