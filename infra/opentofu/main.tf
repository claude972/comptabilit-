# Infrastructure cible Comtaple sur OVHcloud Public Cloud (France).
#
# ÉTAT : validée syntaxiquement par `tofu validate` contre le schéma du fournisseur ovh/ovh 2.25.0 ; JAMAIS planifiée ni
# appliquée contre un projet réel (aucun identifiant OVHcloud, aucune dépense autorisée). Les noms de ressources et
# d'attributs viennent du schéma et de la documentation du fournisseur ; leur comportement réel (identifiant de réseau
# attendu par la base managée, région des nœuds de base face à la région des instances, plans et gabarits disponibles,
# règles implicites des groupes de sécurité) reste à constater au premier `tofu plan`. Voir docs/deploiement.md.
#
# Ce que cette description crée : réseau privé et passerelle, deux instances (applications, supervision), base
# PostgreSQL managée (bases et utilisateurs de l'application et de Keycloak), trois buckets S3, un utilisateur S3
# restreint, un registre de conteneurs. Ce qu'elle ne crée pas : DNS, certificats (émis par le proxy de l'instance),
# pare-feu local des instances (posé par cloud-init, en plus des groupes de sécurité), secrets applicatifs (générés sur l'hôte).
#
# Famille de ressources : la nouvelle famille `ovh_cloud_*` pour le réseau, les instances et les buckets (l'ancienne,
# `ovh_cloud_project_network_private`, `_instance`, `_ssh_key`…, est marquée dépréciée par le fournisseur) ; la base
# managée, les utilisateurs et le registre n'existent que sous `ovh_cloud_project_*`.

provider "ovh" {
  endpoint = "ovh-eu"
}

locals {
  prefixe  = "comtaple-${var.environnement}"
  region   = upper(var.region)
  region_i = upper(var.region_instances)
}

# ───────────────────────── Réseau privé ─────────────────────────

resource "ovh_cloud_network_private_vrack" "prive" {
  service_name = var.projet_ovh
  region       = local.region_i
  name         = "${local.prefixe}-prive"
  vlan_id      = var.reseau_vlan_id
}

resource "ovh_cloud_network_private_vrack_subnet" "prive" {
  service_name = var.projet_ovh
  network_id   = ovh_cloud_network_private_vrack.prive.id
  region       = local.region_i
  name         = "${local.prefixe}-prive"
  cidr         = var.reseau_cidr
  dhcp_enabled = true

  allocation_pools = [
    { start = var.reseau_debut, end = var.reseau_fin },
  ]
}

# Passerelle : sortie Internet de l'instance de supervision, qui n'a pas d'interface publique (mises à jour, images).
resource "ovh_cloud_gateway" "sortie" {
  service_name = var.projet_ovh
  region       = local.region_i
  name         = "${local.prefixe}-passerelle"

  external_gateway = {
    enabled = true
    model   = var.passerelle_modele
  }

  subnet_ids = [ovh_cloud_network_private_vrack_subnet.prive.id]
}

# ───────────────────────── Groupes de sécurité ─────────────────────────

# Instance applicative : HTTP/HTTPS de partout (le proxy redirige HTTP vers HTTPS), SSH depuis les seules adresses
# d'administration, tout le sous-réseau privé (collecte des métriques par l'instance de supervision).
resource "ovh_cloud_security_group" "applications" {
  service_name = var.projet_ovh
  region       = local.region_i
  name         = "${local.prefixe}-applications"
  description  = "Entree web publique, SSH restreint, reseau prive"

  rule = concat(
    [
      { description = "HTTP (redirection et certificats)", direction = "INGRESS", ethernet_type = "IPV4", protocol = "TCP", port_range_min = 80, port_range_max = 80, remote_ip_prefix = "0.0.0.0/0", remote_group_id = null },
      { description = "HTTPS", direction = "INGRESS", ethernet_type = "IPV4", protocol = "TCP", port_range_min = 443, port_range_max = 443, remote_ip_prefix = "0.0.0.0/0", remote_group_id = null },
      { description = "HTTP/3", direction = "INGRESS", ethernet_type = "IPV4", protocol = "UDP", port_range_min = 443, port_range_max = 443, remote_ip_prefix = "0.0.0.0/0", remote_group_id = null },
      { description = "Reseau prive", direction = "INGRESS", ethernet_type = "IPV4", protocol = null, port_range_min = null, port_range_max = null, remote_ip_prefix = var.reseau_cidr, remote_group_id = null },
      { description = "Sortie", direction = "EGRESS", ethernet_type = "IPV4", protocol = null, port_range_min = null, port_range_max = null, remote_ip_prefix = "0.0.0.0/0", remote_group_id = null },
    ],
    [for origine in var.ssh_origines : { description = "SSH administration", direction = "INGRESS", ethernet_type = "IPV4", protocol = "TCP", port_range_min = 22, port_range_max = 22, remote_ip_prefix = origine, remote_group_id = null }],
  )
}

# Instance de supervision : aucune entrée d'Internet (elle n'a pas d'interface publique) ; du réseau privé, deux ports
# seulement : SSH (rebond par l'instance applicative) et l'entrée des traces (OTLP/HTTP en TLS mutuel, service
# `entree-traces` de infra/supervision, publié sur l'adresse privée). Prometheus, Grafana, Tempo et le collecteur
# n'écoutent que sur 127.0.0.1 : on les joint par tunnel SSH. La collecte des métriques PART de cette instance (sortie).
resource "ovh_cloud_security_group" "supervision" {
  service_name = var.projet_ovh
  region       = local.region_i
  name         = "${local.prefixe}-supervision"
  description  = "Reseau prive seulement : SSH et entree des traces"

  rule = [
    { description = "SSH depuis le reseau prive (rebond)", direction = "INGRESS", ethernet_type = "IPV4", protocol = "TCP", port_range_min = 22, port_range_max = 22, remote_ip_prefix = var.reseau_cidr, remote_group_id = null },
    { description = "Entree des traces (OTLP/HTTP, TLS mutuel) depuis le reseau prive", direction = "INGRESS", ethernet_type = "IPV4", protocol = "TCP", port_range_min = var.port_entree_traces, port_range_max = var.port_entree_traces, remote_ip_prefix = var.reseau_cidr, remote_group_id = null },
    { description = "Sortie", direction = "EGRESS", ethernet_type = "IPV4", protocol = null, port_range_min = null, port_range_max = null, remote_ip_prefix = "0.0.0.0/0", remote_group_id = null },
  ]
}

# ───────────────────────── Instances ─────────────────────────

resource "ovh_cloud_ssh_key" "deploiement" {
  service_name = var.projet_ovh
  name         = "${local.prefixe}-deploiement"
  public_key   = var.cle_ssh_publique
}

# Instance applicative : proxy TLS, web, API, worker, OCR, antivirus, Keycloak, Redis (Docker Compose, pas de
# Kubernetes). Seule machine joignable d'Internet. L'adresse publique attribuée par la plateforme change si l'instance
# est recréée : pour une adresse stable, la remplacer par une `ovh_cloud_floating_ip` associée à l'interface privée.
resource "ovh_cloud_instance" "applications" {
  service_name       = var.projet_ovh
  region             = local.region_i
  name               = "${local.prefixe}-applications"
  flavor_id          = var.gabarit_applications_id
  image_id           = var.image_id
  ssh_key_name       = ovh_cloud_ssh_key.deploiement.name
  security_group_ids = [ovh_cloud_security_group.applications.id]
  user_data          = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", { role = "applications", reseau_cidr = var.reseau_cidr, port_entree_traces = var.port_entree_traces }))

  networks = [
    { auto_assign_public_ip = true },
    {
      network_id = ovh_cloud_network_private_vrack.prive.id
      subnet_id  = ovh_cloud_network_private_vrack_subnet.prive.id
    },
  ]

  lifecycle {
    # Changer l'image ou `user_data` RÉINSTALLE l'instance et efface son disque (volumes Docker compris : Redis,
    # signatures antivirus, certificats). Ces changements sont donc ignorés ici et se font à la main, en connaissance
    # de cause.
    ignore_changes = [image_id, user_data]
  }
}

# Instance de supervision : Prometheus, Grafana, collecteur OpenTelemetry, entrepôt de traces Tempo (infra/supervision).
# Réseau privé seulement. Son disque porte les métriques (30 jours) et les traces (72 h, 2,1 Go reçus au plus) :
# dimensionnement indicatif, non mesuré, dans docs/exploitation.md, § 9.
resource "ovh_cloud_instance" "supervision" {
  service_name       = var.projet_ovh
  region             = local.region_i
  name               = "${local.prefixe}-supervision"
  flavor_id          = var.gabarit_supervision_id
  image_id           = var.image_id
  ssh_key_name       = ovh_cloud_ssh_key.deploiement.name
  security_group_ids = [ovh_cloud_security_group.supervision.id]
  user_data          = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", { role = "supervision", reseau_cidr = var.reseau_cidr, port_entree_traces = var.port_entree_traces }))

  networks = [
    {
      network_id = ovh_cloud_network_private_vrack.prive.id
      subnet_id  = ovh_cloud_network_private_vrack_subnet.prive.id
    },
  ]

  depends_on = [ovh_cloud_gateway.sortie]

  lifecycle {
    ignore_changes = [image_id, user_data]
  }
}

# ───────────────────────── Base PostgreSQL managée ─────────────────────────

# Nœuds dans le réseau privé, accès limité au sous-réseau. Sauvegardes quotidiennes et restauration à un instant donné
# assurées par l'hébergeur selon le plan (à constater : docs/exploitation.md).
resource "ovh_cloud_project_database" "postgresql" {
  service_name        = var.projet_ovh
  description         = "${local.prefixe}-postgresql"
  engine              = "postgresql"
  version             = var.postgresql_version
  plan                = var.postgresql_plan
  flavor              = var.postgresql_gabarit
  backup_time         = var.postgresql_heure_sauvegarde
  deletion_protection = true

  dynamic "nodes" {
    for_each = range(var.postgresql_noeuds)
    content {
      region     = local.region
      network_id = ovh_cloud_network_private_vrack.prive.id
      subnet_id  = ovh_cloud_network_private_vrack_subnet.prive.id
    }
  }

  ip_restrictions {
    description = "sous-reseau prive ${local.prefixe}"
    ip          = var.reseau_cidr
  }
}

resource "ovh_cloud_project_database_database" "comtaple" {
  service_name = var.projet_ovh
  engine       = "postgresql"
  cluster_id   = ovh_cloud_project_database.postgresql.id
  name         = "comtaple"
}

# Base distincte pour Keycloak : ses tables ne côtoient pas celles de l'application et ne sont pas soumises à ses rôles.
resource "ovh_cloud_project_database_database" "keycloak" {
  service_name = var.projet_ovh
  engine       = "postgresql"
  cluster_id   = ovh_cloud_project_database.postgresql.id
  name         = "keycloak"
}

# Rôle de MIGRATION de l'application : crée les rôles applicatifs (`comtaple_app`, `comtaple_worker`, sans BYPASSRLS),
# l'extension vector et le schéma (packages/db/src/migrer.ts). N'est utilisé par AUCUN service en fonctionnement.
# À vérifier chez l'hébergeur : droit de créer des rôles, d'installer `vector`, et attribut BYPASSRLS (ou équivalent)
# nécessaire aux opérations de l'éditeur — un service managé n'offre pas de superutilisateur.
resource "ovh_cloud_project_database_postgresql_user" "migration" {
  service_name = var.projet_ovh
  cluster_id   = ovh_cloud_project_database.postgresql.id
  name         = "comtaple_admin"
}

resource "ovh_cloud_project_database_postgresql_user" "keycloak" {
  service_name = var.projet_ovh
  cluster_id   = ovh_cloud_project_database.postgresql.id
  name         = "keycloak"
}

# ───────────────────────── Files (Redis / Valkey) ─────────────────────────

# CHOIX PAR DÉFAUT : Redis sur l'instance applicative (même image que l'environnement local, où BullMQ est essayé),
# et non un service managé. Raisons : (1) BullMQ exige `maxmemory-policy noeviction` ; ce réglage est maîtrisé dans la
# composition, alors que sa disponibilité sur le Valkey managé n'a pas pu être constatée ; (2) les files ne portent
# que des identifiants et sont reconstructibles depuis la base (rattrapage du worker) : leur perte n'est pas une perte
# de données ; (3) l'API, le worker et Redis vivant sur la même instance, un service managé n'apporterait pas de
# disponibilité supplémentaire ; (4) coût nul. À réévaluer si l'API et le worker passent sur plusieurs instances.
# Le Valkey managé reste descriptible ici (`valkey_manage = true`) ; il impose TLS (`rediss://`) et un utilisateur.
resource "ovh_cloud_project_database" "valkey" {
  count        = var.valkey_manage ? 1 : 0
  service_name = var.projet_ovh
  description  = "${local.prefixe}-valkey"
  engine       = "valkey"
  version      = var.valkey_version
  plan         = var.valkey_plan
  flavor       = var.valkey_gabarit

  nodes {
    region     = local.region
    network_id = ovh_cloud_network_private_vrack.prive.id
    subnet_id  = ovh_cloud_network_private_vrack_subnet.prive.id
  }

  ip_restrictions {
    description = "sous-reseau prive ${local.prefixe}"
    ip          = var.reseau_cidr
  }

  lifecycle {
    precondition {
      condition     = var.valkey_version != null && var.valkey_plan != null && var.valkey_gabarit != null
      error_message = "valkey_manage exige valkey_version, valkey_plan et valkey_gabarit."
    }
  }
}

# ───────────────────────── Stockage objet S3 ─────────────────────────

# Stockage courant : originaux adressés par empreinte, dérivés, exports. Versionné, chiffré côté serveur.
resource "ovh_cloud_storage_object_bucket" "courant" {
  service_name = var.projet_ovh
  region       = local.region
  name         = "${local.prefixe}-documents"

  versioning = {
    status = "ENABLED"
  }
  encryption = {
    algorithm = "AES256"
  }
}

# Bucket d'archives (ancres et archives du journal d'audit, éléments à conservation immuable).
# Object Lock ne s'arme qu'à la création : il est donc ARMÉ par défaut, SANS règle de rétention — dans cet état, aucun
# objet n'est retenu et rien n'est irréversible. La rétention ne s'applique que si `archives_retention_defaut` est
# renseignée (ou posée objet par objet par l'application, ce qui n'est pas développé). Durées non arrêtées :
# docs/conservation.md.
resource "ovh_cloud_storage_object_bucket" "archives" {
  service_name = var.projet_ovh
  region       = local.region
  name         = "${local.prefixe}-archives"

  versioning = {
    status = "ENABLED"
  }
  encryption = {
    algorithm = "AES256"
  }
  object_lock = var.archives_object_lock ? {
    status          = "ENABLED"
    mode            = try(var.archives_retention_defaut.mode, null)
    retention_years = try(var.archives_retention_defaut.annees, null)
  } : null

  lifecycle {
    precondition {
      condition     = var.archives_object_lock || var.archives_retention_defaut == null
      error_message = "Une règle de rétention exige archives_object_lock = true."
    }
  }
}

# Sauvegardes applicatives hors base (jeux chiffrés produits par scripts/, exports Keycloak). Versionné.
resource "ovh_cloud_storage_object_bucket" "sauvegardes" {
  service_name = var.projet_ovh
  region       = local.region
  name         = "${local.prefixe}-sauvegardes"

  versioning = {
    status = "ENABLED"
  }
  encryption = {
    algorithm = "AES256"
  }
}

# Utilisateur S3 de l'application, restreint au bucket courant et au bucket d'archives. Le bucket de sauvegardes
# demande un autre utilisateur, à créer avec la procédure de sauvegarde (non décrit ici).
resource "ovh_cloud_project_user" "stockage" {
  service_name = var.projet_ovh
  description  = "${local.prefixe}-stockage-application"
  role_name    = "objectstore_operator"
}

resource "ovh_cloud_project_user_s3_credential" "stockage" {
  service_name = var.projet_ovh
  user_id      = ovh_cloud_project_user.stockage.id
}

resource "ovh_cloud_project_user_s3_policy" "stockage" {
  service_name = var.projet_ovh
  user_id      = ovh_cloud_project_user.stockage.id
  policy = jsonencode({
    Statement = [
      {
        Sid    = "ApplicationComtaple"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:ListMultipartUploadParts", "s3:ListBucketMultipartUploads", "s3:AbortMultipartUpload", "s3:GetBucketLocation"]
        Resource = [
          "arn:aws:s3:::${ovh_cloud_storage_object_bucket.courant.name}",
          "arn:aws:s3:::${ovh_cloud_storage_object_bucket.courant.name}/*",
          "arn:aws:s3:::${ovh_cloud_storage_object_bucket.archives.name}",
          "arn:aws:s3:::${ovh_cloud_storage_object_bucket.archives.name}/*",
        ]
      },
    ]
  })
}

# ───────────────────────── Registre de conteneurs ─────────────────────────

# Registre privé managé : les images sont construites hors de l'hôte de production (scripts/deployer.sh) et tirées par
# lui. Les comptes du registre (un pour pousser, un pour tirer) sont à créer à la main dans le registre : leurs mots de
# passe n'ont pas à entrer dans l'état OpenTofu.
data "ovh_cloud_project_capabilities_containerregistry_filter" "plan" {
  count        = var.registre_actif ? 1 : 0
  service_name = var.projet_ovh
  plan_name    = var.registre_plan
  region       = local.region
}

resource "ovh_cloud_project_containerregistry" "images" {
  count        = var.registre_actif ? 1 : 0
  service_name = var.projet_ovh
  plan_id      = data.ovh_cloud_project_capabilities_containerregistry_filter.plan[0].id
  region       = local.region
  name         = "${local.prefixe}-images"
}
