"""Dernier fichier de la session (ordre alphabétique) : aucune tentative de sortie réseau n'a eu lieu.

`conftest.py` enveloppe `socket.connect` et `socket.getaddrinfo` dès le démarrage : tout appel réseau
émis depuis Python pendant le chargement des modèles ou pendant les OCR des autres tests y est noté.
(La preuve la plus forte reste l'exécution de toute la suite avec `docker run --network none`.)
"""

from __future__ import annotations

import conftest
from factures import Facture, dessiner_facture, en_octets


def test_aucune_tentative_reseau(client):
    # Garantit qu'au moins un OCR réel a eu lieu dans cette session, même si ce fichier est lancé seul.
    reponse = client.post(
        "/ocr", content=en_octets(dessiner_facture(Facture()), "PNG"), headers={"Content-Type": "image/png"}
    )
    assert reponse.status_code == 200
    assert conftest.TENTATIVES_RESEAU == []
