"""OCR réel sur des factures synthétiques : PNG, JPEG pivoté (EXIF), WebP, TIFF et PDF multi-pages."""

from __future__ import annotations

import pytest

from factures import (
    HAUTEUR_A4,
    LARGEUR_A4,
    Facture,
    dessiner_facture,
    en_octets,
    facture_numero,
    jpeg_pivote_exif,
    montant_normalise,
    normaliser,
    page_vectorielle,
    pdf_images,
    pdf_vectoriel,
)


def verifier_structure(corps: dict, nb_pages: int) -> None:
    assert corps["moteur"] == "paddleocr"
    assert isinstance(corps["version_moteur"], str) and corps["version_moteur"][0].isdigit()
    assert isinstance(corps["duree_ms"], int) and corps["duree_ms"] >= 0
    assert isinstance(corps["pages_ignorees"], int)
    assert [p["page"] for p in corps["pages"]] == list(range(1, nb_pages + 1))
    for page in corps["pages"]:
        assert page["largeur"] > 0 and page["hauteur"] > 0
        assert page["texte"] == "\n".join(l["texte"] for l in page["lignes"])
        for ligne in page["lignes"]:
            assert ligne["texte"].strip()
            x0, y0, x1, y1 = ligne["boite"]
            assert all(isinstance(v, int) for v in ligne["boite"])
            assert 0 <= x0 < x1 <= page["largeur"]
            assert 0 <= y0 < y1 <= page["hauteur"]
            assert 0.0 <= ligne["score"] <= 1.0


def verifier_facture(page: dict, facture: Facture) -> None:
    """Le numéro, la date, le SIRET et les trois montants de pied de facture doivent être retrouvés."""
    texte = normaliser(page["texte"])
    assert normaliser(facture.numero) in texte, "numéro de facture non retrouvé"
    assert normaliser(facture.date) in texte, "date non retrouvée"
    assert normaliser(facture.siret) in texte, "SIRET non retrouvé"
    for nom, montant in (("Total HT", facture.total_ht), ("TVA", facture.tva), ("Total TTC", facture.total_ttc)):
        assert montant_normalise(montant) in texte, f"montant {nom} non retrouvé"
    for _, quantite, prix in facture.lignes:
        assert montant_normalise(quantite * prix) in texte, "montant de ligne non retrouvé"


def verifier_ordre_lecture(page: dict) -> None:
    """L'en-tête précède le tableau, qui précède les totaux ; sur une même rangée, le libellé précède le montant."""
    texte = normaliser(page["texte"])
    positions = [texte.find(repere) for repere in ("facture", "signation", "totalht", "tva20", "totalttc")]
    assert all(p >= 0 for p in positions), positions
    assert positions == sorted(positions), positions
    lignes = page["lignes"]
    indice_ttc = next(i for i, l in enumerate(lignes) if "totalttc" in normaliser(l["texte"]))
    libelle = lignes[indice_ttc]
    if normaliser(libelle["texte"]) == "totalttc":  # libellé et montant détectés séparément
        montant = lignes[indice_ttc + 1]
        assert montant["boite"][0] > libelle["boite"][0]
        assert abs(montant["boite"][1] - libelle["boite"][1]) < 30


def test_png(client):
    facture = Facture()
    reponse = client.post("/ocr", content=en_octets(dessiner_facture(facture), "PNG"), headers={"Content-Type": "image/png"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 1)
    assert corps["pages_ignorees"] == 0
    page = corps["pages"][0]
    assert (page["largeur"], page["hauteur"]) == (LARGEUR_A4, HAUTEUR_A4)
    verifier_facture(page, facture)
    verifier_ordre_lecture(page)
    # La boîte du numéro de facture se trouve bien dans le quart supérieur droit de la page.
    ligne_numero = next(l for l in page["lignes"] if normaliser(facture.numero) in normaliser(l["texte"]))
    assert ligne_numero["boite"][0] > LARGEUR_A4 / 2 and ligne_numero["boite"][3] < HAUTEUR_A4 / 4


def test_png_caracteres_accentues(client):
    """Les mots accentués du français sont restitués avec leurs accents."""
    reponse = client.post("/ocr", content=en_octets(dessiner_facture(Facture()), "PNG"), headers={"Content-Type": "image/png"})
    texte = reponse.json()["pages"][0]["texte"]
    for mot in ("Désignation", "Échéance", "Hébergement", "Lefèvre", "Pénalités", "intérêt"):
        assert mot in texte, f"« {mot} » non retrouvé tel quel"


@pytest.mark.parametrize("orientation", [3, 6, 8])
def test_jpeg_pivote_exif(client, orientation):
    facture = Facture(numero=f"F-2026-07{orientation}1")
    octets = jpeg_pivote_exif(dessiner_facture(facture), orientation)
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "image/jpeg"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 1)
    page = corps["pages"][0]
    # Les dimensions renvoyées sont celles de l'image APRÈS application de l'orientation EXIF.
    assert (page["largeur"], page["hauteur"]) == (LARGEUR_A4, HAUTEUR_A4)
    verifier_facture(page, facture)
    verifier_ordre_lecture(page)


def test_webp(client):
    facture = Facture(numero="F-2026-0555")
    octets = en_octets(dessiner_facture(facture), "WEBP", quality=85)
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "image/webp"})
    assert reponse.status_code == 200, reponse.text
    verifier_structure(reponse.json(), 1)
    verifier_facture(reponse.json()["pages"][0], facture)


def test_png_transparent(client):
    """Texte noir sur fond transparent : la transparence est aplatie sur du blanc (et non sur du noir)."""
    facture = Facture(numero="F-2026-0666")
    image = dessiner_facture(facture)
    alpha = image.convert("L").point(lambda v: 0 if v == 255 else 255)
    image = image.convert("RGBA")
    image.putalpha(alpha)
    reponse = client.post("/ocr", content=en_octets(image, "PNG"), headers={"Content-Type": "image/png"})
    assert reponse.status_code == 200, reponse.text
    verifier_facture(reponse.json()["pages"][0], facture)


def test_tiff_multi_pages(client):
    factures = [facture_numero(n) for n in range(2)]
    images = [dessiner_facture(f) for f in factures]
    octets = en_octets(images[0], "TIFF", save_all=True, append_images=images[1:], compression="tiff_lzw")
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "image/tiff"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 2)
    for page, facture in zip(corps["pages"], factures):
        verifier_facture(page, facture)


def test_pdf_multi_pages_numerise(client):
    factures = [facture_numero(n) for n in range(3)]
    octets = pdf_images([dessiner_facture(f) for f in factures])
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "application/pdf"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 3)
    assert corps["pages_ignorees"] == 0
    for page, facture in zip(corps["pages"], factures):
        # Page A4 rastérisée à 200 ppp (à un pixel d'arrondi près).
        assert abs(page["largeur"] - LARGEUR_A4) <= 2 and abs(page["hauteur"] - HAUTEUR_A4) <= 2
        verifier_facture(page, facture)
        verifier_ordre_lecture(page)
    # Chaque page porte son propre numéro : aucune inversion de pages.
    assert normaliser(factures[2].numero) not in normaliser(corps["pages"][0]["texte"])


def test_pdf_vectoriel(client):
    """PDF contenant du texte vectoriel (cas d'une facture émise par un logiciel)."""
    factures = [facture_numero(5), facture_numero(6)]
    octets = pdf_vectoriel([page_vectorielle(f) for f in factures])
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "application/pdf; charset=binary"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 2)
    for page, facture in zip(corps["pages"], factures):
        verifier_facture(page, facture)


def test_limite_de_pages_pdf(fabrique_client):
    factures = [facture_numero(n) for n in range(3)]
    octets = pdf_images([dessiner_facture(f) for f in factures])
    client = fabrique_client(pages_max=2)
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "application/pdf"})
    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    verifier_structure(corps, 2)
    assert corps["pages_ignorees"] == 1
    verifier_facture(corps["pages"][1], factures[1])


def test_page_blanche(client):
    """Une page sans texte donne une page vide, pas une erreur."""
    from PIL import Image

    reponse = client.post(
        "/ocr", content=en_octets(Image.new("RGB", (800, 600), "white"), "PNG"), headers={"Content-Type": "image/png"}
    )
    assert reponse.status_code == 200, reponse.text
    page = reponse.json()["pages"][0]
    assert page["lignes"] == [] and page["texte"] == ""
    assert (page["largeur"], page["hauteur"]) == (800, 600)


def test_sante(client):
    reponse = client.get("/sante")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["statut"] == "pret"
    assert corps["moteur"] == "paddleocr"
    assert corps["langue"] == "fr"
    assert corps["version_moteur"][0].isdigit()
    assert set(corps["modeles"]) == {"detection", "reconnaissance"}
