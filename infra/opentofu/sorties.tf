output "bucket_documents" {
  value = ovh_cloud_storage_object_bucket.courant.name
}

output "bucket_archives_verrouillees" {
  value = ovh_cloud_storage_object_bucket.verrouille.name
}

output "base_postgresql_id" {
  value = ovh_cloud_project_database.postgresql.id
}
