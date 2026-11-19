"""Journalisation structurée (une ligne JSON par événement, sur la sortie standard).

RÈGLE DE CONFIDENTIALITÉ : on ne journalise JAMAIS le texte reconnu, ni les octets des pièces,
ni les messages d'exception des bibliothèques de décodage (ils pourraient contenir des fragments
du fichier). Seules des métadonnées techniques sont écrites : taille, type, nombre de pages,
durée, code de retour, nom de classe d'une exception.
"""

from __future__ import annotations

import json
import sys
import threading
import time

_verrou = threading.Lock()

# Seuls ces champs peuvent apparaître dans une ligne de journal (liste blanche).
_CHAMPS_AUTORISES = frozenset(
    {
        "evenement",
        "code",
        "type",
        "taille_octets",
        "pages",
        "pages_ignorees",
        "duree_ms",
        "erreur",
        "exception",
        "moteur",
        "version_moteur",
        "modeles",
        "en_attente",
    }
)


def journaliser(evenement: str, **champs: object) -> None:
    ligne: dict[str, object] = {
        "horodatage": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "service": "ocr",
        "evenement": evenement,
    }
    for cle, valeur in champs.items():
        if cle in _CHAMPS_AUTORISES and valeur is not None:
            ligne[cle] = valeur
    texte = json.dumps(ligne, ensure_ascii=False, separators=(",", ":"))
    with _verrou:
        sys.stdout.write(texte + "\n")
        sys.stdout.flush()
