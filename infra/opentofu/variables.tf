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

variable "environnement" {
  description = "Nom de l'environnement (ex. recette, production)."
  type        = string
}

variable "postgresql_version" {
  description = "Version majeure de PostgreSQL managé (pgvector doit y être disponible : à vérifier chez l'hébergeur)."
  type        = string
}

variable "postgresql_plan" {
  description = "Plan du service de base managée."
  type        = string
}

variable "postgresql_gabarit" {
  description = "Gabarit des nœuds de base de données."
  type        = string
}

variable "retention_immuable_annees" {
  description = "Durée de rétention par défaut du bucket verrouillé, en années. Aucune valeur par défaut : une conservation irréversible exige une durée et un responsable définis."
  type        = number
}

variable "mode_verrouillage" {
  description = "Mode Object Lock : GOVERNANCE ou COMPLIANCE. En mode COMPLIANCE, ni le mode ni la durée ne peuvent plus être modifiés pour un objet."
  type        = string
  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.mode_verrouillage)
    error_message = "Mode attendu : GOVERNANCE ou COMPLIANCE."
  }
}
