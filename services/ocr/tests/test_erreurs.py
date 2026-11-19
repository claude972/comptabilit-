"""Codes d'erreur du contrat : 413, 415, 422, 503."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Configuration
from app.main import creer_application
from factures import Facture, dessiner_facture, en_octets, pdf_images

PNG = {"Content-Type": "image/png"}


def verifier_erreur(reponse, code: int, identifiant: str) -> dict:
    assert reponse.status_code == code, reponse.text
    corps = reponse.json()
    assert corps["erreur"] == identifiant
    assert isinstance(corps["message"], str) and len(corps["message"]) > 10
    return corps


# ------------------------------------------------------------------ 413


def test_413_taille_annoncee(fabrique_client):
    client = fabrique_client(taille_max_octets=1024)
    reponse = client.post("/ocr", content=b"\x89PNG" + b"0" * 2000, headers=PNG)
    corps = verifier_erreur(reponse, 413, "fichier_trop_volumineux")
    assert "1024" in corps["message"]


def test_413_corps_en_flux_sans_longueur(fabrique_client):
    """Sans Content-Length (envoi par morceaux), la limite est appliquée pendant la lecture."""
    client = fabrique_client(taille_max_octets=1024)

    def morceaux():
        for _ in range(10):
            yield b"0" * 500

    reponse = client.post("/ocr", content=morceaux(), headers=PNG)
    assert "content-length" not in reponse.request.headers
    verifier_erreur(reponse, 413, "fichier_trop_volumineux")


def test_juste_sous_la_limite_accepte(fabrique_client):
    octets = en_octets(dessiner_facture(Facture()), "PNG")
    client = fabrique_client(taille_max_octets=len(octets))
    assert client.post("/ocr", content=octets, headers=PNG).status_code == 200
    client = fabrique_client(taille_max_octets=len(octets) - 1)
    assert client.post("/ocr", content=octets, headers=PNG).status_code == 413


def test_limite_par_defaut_25_mo():
    assert Configuration().taille_max_octets == 25 * 1024 * 1024
    assert Configuration().pages_max == 30


# ------------------------------------------------------------------ 415


@pytest.mark.parametrize(
    "type_mime", ["text/plain", "application/json", "image/gif", "image/bmp", "application/zip", "application/octet-stream"]
)
def test_415_type_non_pris_en_charge(client, type_mime):
    reponse = client.post("/ocr", content=b"GIF89a....", headers={"Content-Type": type_mime})
    verifier_erreur(reponse, 415, "type_non_pris_en_charge")


def test_415_sans_type(client):
    verifier_erreur(client.post("/ocr", content=b"abc"), 415, "type_non_pris_en_charge")


def test_type_insensible_a_la_casse_et_aux_parametres(client):
    octets = en_octets(Image.new("RGB", (200, 100), "white"), "PNG")
    assert client.post("/ocr", content=octets, headers={"Content-Type": "IMAGE/PNG; q=1"}).status_code == 200


# ------------------------------------------------------------------ 422


def test_422_corps_vide(client):
    verifier_erreur(client.post("/ocr", content=b"", headers=PNG), 422, "fichier_illisible")


@pytest.mark.parametrize("type_mime", ["image/png", "image/jpeg", "image/webp", "image/tiff", "application/pdf"])
def test_422_octets_aleatoires(client, type_mime):
    reponse = client.post("/ocr", content=os.urandom(4096), headers={"Content-Type": type_mime})
    verifier_erreur(reponse, 422, "fichier_illisible")


def test_422_type_declare_errone(client):
    """Un PNG valide annoncé comme JPEG est refusé (le décodeur est restreint au type annoncé)."""
    octets = en_octets(dessiner_facture(Facture()), "PNG")
    corps = verifier_erreur(client.post("/ocr", content=octets, headers={"Content-Type": "image/jpeg"}), 422, "fichier_illisible")
    assert "JPEG" in corps["message"]


def test_422_image_tronquee(client):
    octets = en_octets(dessiner_facture(Facture()), "PNG")
    verifier_erreur(client.post("/ocr", content=octets[: len(octets) // 2], headers=PNG), 422, "fichier_illisible")
    jpeg = en_octets(dessiner_facture(Facture()), "JPEG")
    verifier_erreur(
        client.post("/ocr", content=jpeg[: len(jpeg) // 2], headers={"Content-Type": "image/jpeg"}), 422, "fichier_illisible"
    )


def test_422_pdf_tronque(client):
    octets = pdf_images([dessiner_facture(Facture())])
    reponse = client.post("/ocr", content=octets[:300], headers={"Content-Type": "application/pdf"})
    verifier_erreur(reponse, 422, "fichier_illisible")


def test_422_bombe_de_decompression(fabrique_client):
    """Image de quelques kilo-octets mais de 36 millions de pixels : refusée avant décodage."""
    octets = en_octets(Image.new("L", (6000, 6000), 255), "PNG", optimize=True)
    assert len(octets) < 100_000
    client = fabrique_client(pixels_max=20_000_000)
    corps = verifier_erreur(client.post("/ocr", content=octets, headers=PNG), 422, "fichier_illisible")
    assert "trop grande" in corps["message"]


def test_page_pdf_geante_reduite(fabrique_client):
    """Une page PDF démesurée est rastérisée à une échelle réduite pour rester sous le plafond de pixels."""
    from factures import pdf_vectoriel

    octets = pdf_vectoriel([[(50, 780, 14, "FACTURE GEANTE")]]).replace(b"[0 0 595 842]", b"[0 0 9999 9999]")
    client = fabrique_client(pixels_max=4_000_000)
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "application/pdf"})
    assert reponse.status_code == 200, reponse.text
    page = reponse.json()["pages"][0]
    assert page["largeur"] * page["hauteur"] <= 4_000_000


def test_le_message_422_ne_contient_pas_le_contenu(client):
    marqueur = b"SECRET-CLIENT-123456"
    reponse = client.post("/ocr", content=b"%PDF-1.4\n" + marqueur * 50, headers={"Content-Type": "application/pdf"})
    verifier_erreur(reponse, 422, "fichier_illisible")
    assert marqueur.decode() not in reponse.text


# ------------------------------------------------------------------ 503 / méthodes


def test_503_tant_que_les_modeles_ne_sont_pas_charges(cfg):
    # Sans exécution du cycle de vie, le moteur n'est jamais chargé : l'état « avant chargement » est figé.
    client = TestClient(creer_application(cfg))
    reponse = client.get("/sante")
    assert reponse.status_code == 503
    assert reponse.json()["statut"] == "chargement"
    reponse = client.post("/ocr", content=b"x", headers=PNG)
    verifier_erreur(reponse, 503, "moteur_non_pret")


def test_pas_de_documentation_interactive(client):
    for chemin in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(chemin).status_code == 404
    assert client.get("/ocr").status_code == 405
