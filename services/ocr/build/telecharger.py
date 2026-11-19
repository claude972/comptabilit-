"""Outil de BUILD uniquement : télécharge un fichier, vérifie son SHA-256, et extrait les archives tar.

Usage : python telecharger.py <url> <sha256 attendu> <destination> [--extraire]

Il n'est pas copié dans l'image finale : à l'exécution, le service ne télécharge jamais rien.
"""

from __future__ import annotations

import hashlib
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path


def principal() -> int:
    url, attendu, destination = sys.argv[1], sys.argv[2].lower(), Path(sys.argv[3])
    extraire = "--extraire" in sys.argv[4:]
    if not url.startswith("https://"):
        print(f"URL refusée (https obligatoire) : {url}", file=sys.stderr)
        return 2
    empreinte = hashlib.sha256()
    with tempfile.NamedTemporaryFile(delete=False) as temporaire:
        with urllib.request.urlopen(url, timeout=120) as reponse:  # noqa: S310 — https vérifié ci-dessus
            while morceau := reponse.read(1 << 20):
                empreinte.update(morceau)
                temporaire.write(morceau)
        chemin = Path(temporaire.name)
    obtenu = empreinte.hexdigest()
    if obtenu != attendu:
        chemin.unlink()
        print(f"SHA-256 inattendu pour {url}\n  attendu : {attendu}\n  obtenu  : {obtenu}", file=sys.stderr)
        return 1
    if extraire:
        destination.mkdir(parents=True, exist_ok=True)
        with tarfile.open(chemin) as archive:
            # filter="data" : refuse les chemins absolus, les « .. », les liens et les fichiers spéciaux.
            archive.extractall(destination, filter="data")
        chemin.unlink()
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        chemin.replace(destination)
    print(f"OK {url} (sha256 {obtenu})")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
