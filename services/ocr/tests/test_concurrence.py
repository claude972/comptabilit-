"""File d'attente bornée (429), délai par requête (504), exclusion mutuelle — avec un moteur factice."""

from __future__ import annotations

import asyncio
import dataclasses
import threading
import time

import httpx
import numpy as np

from app.main import creer_application
from app.moteur import Ligne, ordonner_lecture
from factures import en_octets

PNG = {"Content-Type": "image/png"}


class MoteurFactice:
    nom = "paddleocr"
    version = "0.0.0-factice"
    modeles = {"detection": "factice", "reconnaissance": "factice"}

    def __init__(self) -> None:
        self.feu_vert = threading.Event()
        self.simultanes = 0
        self.max_simultanes = 0
        self.appels = 0
        self._verrou = threading.Lock()

    def reconnaitre(self, image_bgr: np.ndarray) -> list[Ligne]:
        with self._verrou:
            self.appels += 1
            self.simultanes += 1
            self.max_simultanes = max(self.max_simultanes, self.simultanes)
        try:
            self.feu_vert.wait(timeout=20)
            return [Ligne("factice", (0, 0, 10, 10), 0.5)]
        finally:
            with self._verrou:
                self.simultanes -= 1


def _image() -> bytes:
    from PIL import Image

    return en_octets(Image.new("RGB", (100, 100), "white"), "PNG")


async def _attendre(condition, delai: float = 10.0) -> None:
    fin = time.monotonic() + delai
    while not condition():
        assert time.monotonic() < fin, "condition non atteinte"
        await asyncio.sleep(0.01)


def test_429_quand_la_file_est_pleine(cfg):
    moteur = MoteurFactice()
    app = creer_application(dataclasses.replace(cfg, file_attente_max=1), moteur=moteur)
    etat = app.state.etat
    octets = _image()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ocr") as client:
            premiere = asyncio.create_task(client.post("/ocr", content=octets, headers=PNG))
            deuxieme = asyncio.create_task(client.post("/ocr", content=octets, headers=PNG))
            await _attendre(lambda: etat.admises == 2 and moteur.simultanes == 1)
            # Une en traitement + une en attente : la troisième est refusée immédiatement.
            troisieme = await client.post("/ocr", content=octets, headers=PNG)
            assert troisieme.status_code == 429
            assert troisieme.json()["erreur"] == "service_sature"
            assert "retry-after" in troisieme.headers
            # /sante reste disponible pendant un traitement.
            assert (await client.get("/sante")).status_code == 200
            moteur.feu_vert.set()
            r1, r2 = await asyncio.gather(premiere, deuxieme)
            assert (r1.status_code, r2.status_code) == (200, 200)
            await _attendre(lambda: etat.admises == 0)
            # La place libérée est de nouveau utilisable.
            assert (await client.post("/ocr", content=octets, headers=PNG)).status_code == 200

    asyncio.run(scenario())
    assert moteur.max_simultanes == 1, "deux traitements OCR ont tourné en même temps"


def test_504_delai_depasse_puis_liberation(cfg):
    moteur = MoteurFactice()
    app = creer_application(dataclasses.replace(cfg, delai_requete_s=1, file_attente_max=0), moteur=moteur)
    etat = app.state.etat
    octets = _image()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ocr") as client:
            debut = time.monotonic()
            reponse = await client.post("/ocr", content=octets, headers=PNG)
            assert reponse.status_code == 504
            assert reponse.json()["erreur"] == "delai_depasse"
            assert 0.9 < time.monotonic() - debut < 5
            # Le thread de traitement tourne encore : la place n'est PAS rendue, donc 429.
            assert etat.admises == 1
            assert (await client.post("/ocr", content=octets, headers=PNG)).status_code == 429
            moteur.feu_vert.set()
            await _attendre(lambda: etat.admises == 0)
            assert (await client.post("/ocr", content=octets, headers=PNG)).status_code == 200

    asyncio.run(scenario())


def test_requete_en_file_au_dela_du_delai_non_traitee(cfg):
    """Une requête dont le délai expire pendant l'attente n'est jamais passée au moteur."""
    moteur = MoteurFactice()
    app = creer_application(dataclasses.replace(cfg, delai_requete_s=1, file_attente_max=1), moteur=moteur)
    etat = app.state.etat
    octets = _image()

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ocr") as client:
            r1, r2 = await asyncio.gather(
                client.post("/ocr", content=octets, headers=PNG), client.post("/ocr", content=octets, headers=PNG)
            )
            assert (r1.status_code, r2.status_code) == (504, 504)
            moteur.feu_vert.set()
            await _attendre(lambda: etat.admises == 0)

    asyncio.run(scenario())
    assert moteur.appels == 1


def test_ordre_de_lecture():
    lignes = [
        Ligne("Total TTC", (1020, 1000, 1180, 1034), 0.9),
        Ligne("2 057,28 €", (1320, 1003, 1500, 1036), 0.9),  # même rangée, légèrement décalée
        Ligne("FACTURE", (880, 120, 1300, 170), 0.9),
        Ligne("ATELIER", (110, 125, 500, 160), 0.9),
        Ligne("Client", (110, 400, 600, 432), 0.9),
    ]
    assert [l.texte for l in ordonner_lecture(lignes)] == ["ATELIER", "FACTURE", "Client", "Total TTC", "2 057,28 €"]
    assert ordonner_lecture([]) == []
