# Exemple à copier (en `<environnement>.tfvars`, non versionné) et à compléter. AUCUNE valeur réelle ici : les
# identifiants de projet, d'image et de gabarit, les plans et les versions se relèvent sur le catalogue de l'hébergeur.
# Les identifiants d'accès à l'API OVHcloud ne vont PAS dans ce fichier : variables d'environnement
# OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET, OVH_CONSUMER_KEY (ou OVH_CLIENT_ID / OVH_CLIENT_SECRET).
projet_ovh       = "<identifiant-du-projet-public-cloud>"
region           = "GRA"
region_instances = "GRA11"
environnement    = "recette"

# Adresses d'administration autorisées en SSH (jamais 0.0.0.0/0).
ssh_origines = ["<adresse-d-administration>/32"]

cle_ssh_publique        = "ssh-ed25519 <clé-publique-du-compte-de-déploiement>"
image_id                = "<uuid-de-l-image-système>"
gabarit_applications_id = "<uuid-du-gabarit-applications>"
gabarit_supervision_id  = "<uuid-du-gabarit-supervision>"

postgresql_version = "<version>"
postgresql_plan    = "<plan>"
postgresql_gabarit = "<gabarit>"
postgresql_noeuds  = 2

# Files : Redis sur l'instance applicative par défaut (voir main.tf).
valkey_manage = false

# Bucket d'archives : Object Lock armé à la création, SANS rétention par défaut. Ne renseigner
# `archives_retention_defaut` qu'une fois les durées arrêtées (décision irréversible en mode COMPLIANCE) :
# archives_retention_defaut = { mode = "GOVERNANCE", annees = <durée validée> }
archives_object_lock = true

registre_actif = true
registre_plan  = "SMALL"
