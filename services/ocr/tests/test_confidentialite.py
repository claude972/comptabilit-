"""Confidentialité : rien du contenu des pièces dans les journaux, aucune tentative de sortie réseau."""

from __future__ import annotations

import json
import os

from factures import Facture, dessiner_facture, en_octets, normaliser


def test_le_journal_ne_contient_ni_texte_ni_octets(client, capfd):
    facture = Facture(numero="F-2026-9911", client="Société Confidentielle Dupont")
    octets = en_octets(dessiner_facture(facture), "PNG")
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "image/png"})
    assert reponse.status_code == 200
    assert normaliser(facture.numero) in normaliser(reponse.json()["pages"][0]["texte"])
    # Requête en erreur avec un en-tête et un contenu « sensibles ».
    client.post("/ocr", content=b"CONTENU-SECRET-42", headers={"Content-Type": "text/x-secret-dupont"})
    client.post("/ocr", content=b"%PDF-1.7 CONTENU-SECRET-42", headers={"Content-Type": "application/pdf"})

    sortie = capfd.readouterr()
    journal = sortie.out + sortie.err
    lignes_ocr = [json.loads(l) for l in sortie.out.splitlines() if l.startswith("{") and '"evenement":"ocr"' in l]
    assert len(lignes_ocr) == 3
    reussite = lignes_ocr[0]
    assert reussite["code"] == 200 and reussite["type"] == "image/png"
    assert reussite["taille_octets"] == len(octets) and reussite["pages"] == 1
    assert isinstance(reussite["duree_ms"], int)
    assert [l["code"] for l in lignes_ocr[1:]] == [415, 422]
    assert lignes_ocr[1]["type"] == "non_pris_en_charge"

    journal_normalise = normaliser(journal)
    for interdit in ("9911", "Dupont", "Lefèvre", "SECRET", "ATELIER", "1714,40", "2057,28", "12345678900012"):
        assert normaliser(interdit) not in journal_normalise, f"« {interdit} » apparaît dans le journal"
    # Seuls les champs techniques attendus sont journalisés.
    for ligne in lignes_ocr:
        assert set(ligne) <= {
            "horodatage", "service", "evenement", "code", "type", "taille_octets", "pages", "pages_ignorees", "duree_ms",
        }


def test_variables_hors_ligne_presentes():
    """L'image impose le mode hors ligne aux bibliothèques qui savent télécharger des modèles."""
    assert os.environ.get("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK") == "True"
    assert os.environ.get("HF_HUB_OFFLINE") == "1"


def test_pdfium_sans_javascript_ni_xfa():
    """La bibliothèque PDFium embarquée est compilée sans moteur JavaScript (V8) ni XFA."""
    import pypdfium2

    drapeaux = {str(d).upper() for d in pypdfium2.PDFIUM_INFO.flags}
    assert "V8" not in drapeaux and "XFA" not in drapeaux, drapeaux


def test_pdf_avec_action_javascript_traite_comme_un_document_inerte(client):
    """Un PDF déclarant un script à l'ouverture est simplement rastérisé : le script est ignoré."""
    from factures import page_vectorielle, pdf_vectoriel

    facture = Facture(numero="F-2026-0777")
    octets = pdf_vectoriel([page_vectorielle(facture)]).replace(
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\('x'\\);) >> >>",
    )
    # Le remplacement décale la table des références : PDFium doit la reconstruire, sans erreur.
    reponse = client.post("/ocr", content=octets, headers={"Content-Type": "application/pdf"})
    assert reponse.status_code == 200, reponse.text
    assert normaliser(facture.numero) in normaliser(reponse.json()["pages"][0]["texte"])
