# ── Projet, région, environnement ──

variable "projet_ovh" {
  description = "Identifiant du projet Public Cloud OVHcloud (service_name)."
  type        = string
}

variable "region" {
  description = "Région OVHcloud en France. Aucune valeur par défaut : le choix de la région est une décision explicite (localisation des données)."
  type        = string
  validation {
    condition     = contains(["GRA", "SBG", "RBX", "PAR", "EU-WEST-PAR"], upper(var.region))
    error_message = "La région doit être une région française d'OVHcloud."
  }
}

variable "region_instances" {
  description = "Région OpenStack des instances et du réseau privé (ex. GRA11, SBG5). Doit appartenir à la même localisation française que `region`."
  type        = string
  validation {
    condition     = can(regex("^(GRA|SBG|RBX|PAR|EU-WEST-PAR)", upper(var.region_instances)))
    error_message = "La région des instances doit être une région française d'OVHcloud."
  }
}

variable "environnement" {
  description = "Nom de l'environnement (ex. recette, production)."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9-]{2,20}$", var.environnement))
    error_message = "Minuscules, chiffres et tirets uniquement (le nom entre dans celui des buckets)."
  }
}

# ── Réseau privé ──

variable "reseau_vlan_id" {
  description = "Identifiant de VLAN du réseau privé dans le vRack du projet."
  type        = number
  default     = null
}

variable "reseau_cidr" {
  description = "Plage du sous-réseau privé."
  type        = string
  default     = "10.20.0.0/24"
}

variable "reseau_debut" {
  description = "Première adresse distribuée dans le sous-réseau."
  type        = string
  default     = "10.20.0.10"
}

variable "reseau_fin" {
  description = "Dernière adresse distribuée dans le sous-réseau."
  type        = string
  default     = "10.20.0.200"
}

variable "passerelle_modele" {
  description = "Modèle de la passerelle (sortie Internet de l'instance sans interface publique) : S, M, L…"
  type        = string
  default     = "S"
}

variable "ssh_origines" {
  description = "Plages d'adresses (CIDR) autorisées à joindre l'instance applicative en SSH. Aucune valeur par défaut : n'ouvrir SSH qu'aux adresses d'administration."
  type        = list(string)
  validation {
    condition     = alltrue([for o in var.ssh_origines : can(cidrhost(o, 0))]) && !contains(var.ssh_origines, "0.0.0.0/0")
    error_message = "Liste de plages CIDR ; 0.0.0.0/0 est refusé."
  }
}

# ── Instances ──

variable "cle_ssh_publique" {
  description = "Clé PUBLIQUE SSH du compte de déploiement (jamais la clé privée)."
  type        = string
}

variable "image_id" {
  description = "Identifiant (UUID régional) de l'image système des instances — une distribution Linux récente maintenue. À relever sur le catalogue du projet."
  type        = string
}

variable "gabarit_applications_id" {
  description = "Identifiant (UUID régional) du gabarit de l'instance applicative. Dimensionnement à fixer : la somme des plafonds mémoire de la composition de production est d'environ 12 Go (voir infra/production/compose.production.yaml)."
  type        = string
}

variable "gabarit_supervision_id" {
  description = "Identifiant (UUID régional) du gabarit de l'instance de supervision (Prometheus, Grafana, collecteur)."
  type        = string
}

# ── Base PostgreSQL managée ──

variable "postgresql_version" {
  description = "Version majeure de PostgreSQL managé (pgvector doit y être disponible : à vérifier chez l'hébergeur)."
  type        = string
}

variable "postgresql_plan" {
  description = "Plan du service de base managée (le nombre de nœuds en dépend : voir `postgresql_noeuds`)."
  type        = string
}

variable "postgresql_gabarit" {
  description = "Gabarit des nœuds de base de données."
  type        = string
}

variable "postgresql_noeuds" {
  description = "Nombre de nœuds, imposé par le plan (d'après la documentation du fournisseur : 1 en discovery, 2 en production, 3 en advanced). Un nombre incorrect échoue à l'application."
  type        = number
  default     = 2
  validation {
    condition     = var.postgresql_noeuds >= 1 && var.postgresql_noeuds <= 3
    error_message = "Entre 1 et 3 nœuds."
  }
}

variable "postgresql_heure_sauvegarde" {
  description = "Heure (UTC, hh:mm:ss) de la sauvegarde quotidienne de l'hébergeur. Nul : heure choisie par l'hébergeur."
  type        = string
  default     = null
}

# ── Valkey managé (facultatif) ──

variable "valkey_manage" {
  description = "Créer un Valkey managé. Faux par défaut : les files BullMQ tournent sur l'instance applicative (voir main.tf pour la justification)."
  type        = bool
  default     = false
}

variable "valkey_version" {
  description = "Version de Valkey managé (si `valkey_manage`)."
  type        = string
  default     = null
}

variable "valkey_plan" {
  description = "Plan de Valkey managé (si `valkey_manage`)."
  type        = string
  default     = null
}

variable "valkey_gabarit" {
  description = "Gabarit de Valkey managé (si `valkey_manage`)."
  type        = string
  default     = null
}

# ── Stockage objet ──

variable "archives_object_lock" {
  description = <<-EOT
    Armer Object Lock sur le bucket d'archives. Object Lock ne s'arme QU'À LA CRÉATION du bucket (le changer ensuite
    recrée le bucket). Armé sans règle par défaut, il ne retient RIEN : il rend seulement possible une rétention posée
    plus tard, objet par objet ou par règle par défaut. Mettre à faux crée un bucket qui ne pourra jamais être verrouillé.
  EOT
  type        = bool
  default     = true
}

variable "archives_retention_defaut" {
  description = <<-EOT
    Règle de rétention PAR DÉFAUT du bucket d'archives. NULLE par défaut : aucune conservation immuable n'est appliquée
    tant que les durées ne sont pas arrêtées (docs/conservation.md). En mode COMPLIANCE, un objet verrouillé ne peut
    plus être supprimé ni sa durée réduite par quiconque, hébergeur compris, jusqu'à l'échéance : décision irréversible.
  EOT
  type = object({
    mode   = string
    annees = number
  })
  default = null
  validation {
    condition     = var.archives_retention_defaut == null ? true : contains(["GOVERNANCE", "COMPLIANCE"], var.archives_retention_defaut.mode) && var.archives_retention_defaut.annees >= 1
    error_message = "Mode attendu : GOVERNANCE ou COMPLIANCE ; durée d'au moins une année."
  }
}

# ── Registre de conteneurs ──

variable "registre_actif" {
  description = "Créer un registre privé managé pour les images applicatives."
  type        = bool
  default     = true
}

variable "registre_plan" {
  description = "Nom du plan du registre managé (SMALL, MEDIUM ou LARGE)."
  type        = string
  default     = "SMALL"
}
