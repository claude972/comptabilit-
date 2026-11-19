"""Fixtures communes. Les tests s'exécutent DANS l'image de test (voir README.md)."""

from __future__ import annotations

import dataclasses
import socket
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import Configuration  # noqa: E402
from app.main import creer_application  # noqa: E402

# --- Surveillance du réseau : toute tentative de connexion ou de résolution DNS pendant la session est notée.
TENTATIVES_RESEAU: list[str] = []
_connect_origine = socket.socket.connect
_getaddrinfo_origine = socket.getaddrinfo


def _connect_surveille(self, adresse, *args, **kwargs):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        TENTATIVES_RESEAU.append(f"connect {adresse!r}")
    return _connect_origine(self, adresse, *args, **kwargs)


def _getaddrinfo_surveille(hote, *args, **kwargs):
    TENTATIVES_RESEAU.append(f"getaddrinfo {hote!r}")
    return _getaddrinfo_origine(hote, *args, **kwargs)


socket.socket.connect = _connect_surveille
socket.getaddrinfo = _getaddrinfo_surveille


@pytest.fixture(scope="session")
def cfg() -> Configuration:
    return Configuration.depuis_environnement()


@pytest.fixture(scope="session")
def moteur_reel(cfg):
    """Vrai moteur PaddleOCR, chargé une seule fois pour toute la session."""
    from app.moteur import MoteurPaddle

    return MoteurPaddle(cfg)


@pytest.fixture()
def client(cfg, moteur_reel):
    with TestClient(creer_application(cfg, moteur=moteur_reel)) as c:
        yield c


@pytest.fixture()
def fabrique_client(cfg, moteur_reel):
    """Client avec une configuration modifiée (limites réduites, etc.)."""
    ouverts = []

    def fabriquer(**changements) -> TestClient:
        c = TestClient(creer_application(dataclasses.replace(cfg, **changements), moteur=moteur_reel))
        c.__enter__()
        ouverts.append(c)
        return c

    yield fabriquer
    for c in ouverts:
        c.__exit__(None, None, None)
