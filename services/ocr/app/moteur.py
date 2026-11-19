"""Moteur OCR : enveloppe autour de PaddleOCR (modèles locaux, inférence CPU)."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .config import Configuration

# En dessous de cette taille, une page ne peut pas contenir de texte lisible : on n'appelle pas le moteur.
_COTE_MIN_PIXELS = 16


@dataclass(frozen=True)
class Ligne:
    texte: str
    boite: tuple[int, int, int, int]  # x0, y0, x1, y1 en pixels de l'image de la page
    score: float  # score de reconnaissance brut du moteur (non calibré)


class Moteur(Protocol):
    nom: str
    version: str
    modeles: dict[str, str]

    def reconnaitre(self, image_bgr: np.ndarray) -> list[Ligne]: ...


def ordonner_lecture(lignes: list[Ligne]) -> list[Ligne]:
    """Trie les lignes dans l'ordre de lecture : de haut en bas, puis de gauche à droite.

    Les boîtes dont les centres verticaux sont proches (moins d'une demi-hauteur d'écart)
    sont regroupées sur une même rangée, puis triées par abscisse.
    """
    rangees: list[list[Ligne]] = []
    centre_rangee = 0.0
    hauteur_rangee = 0.0
    for ligne in sorted(lignes, key=lambda l: ((l.boite[1] + l.boite[3]) / 2, l.boite[0])):
        centre = (ligne.boite[1] + ligne.boite[3]) / 2
        hauteur = max(1, ligne.boite[3] - ligne.boite[1])
        if rangees and abs(centre - centre_rangee) < 0.5 * min(hauteur, hauteur_rangee):
            rangees[-1].append(ligne)
        else:
            rangees.append([ligne])
            centre_rangee, hauteur_rangee = centre, float(hauteur)
    resultat: list[Ligne] = []
    for rangee in rangees:
        resultat.extend(sorted(rangee, key=lambda l: l.boite[0]))
    return resultat


class MoteurPaddle:
    """PaddleOCR (détection + reconnaissance) chargé depuis des dossiers de modèles locaux."""

    nom = "paddleocr"

    def __init__(self, cfg: Configuration) -> None:
        # Import tardif : le chargement de paddle est lent et ne doit pas bloquer /sante (503 pendant ce temps).
        import paddleocr
        from paddleocr import PaddleOCR

        self.version = paddleocr.__version__
        self.modeles = {
            "detection": cfg.modele_detection_nom,
            "reconnaissance": cfg.modele_reconnaissance_nom,
        }
        self._verrou = threading.Lock()
        self._ocr = PaddleOCR(
            text_detection_model_name=cfg.modele_detection_nom,
            text_detection_model_dir=cfg.modele_detection_dossier,
            text_recognition_model_name=cfg.modele_reconnaissance_nom,
            text_recognition_model_dir=cfg.modele_reconnaissance_dossier,
            # Modules optionnels désactivés : ils exigeraient d'autres modèles (non embarqués).
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            # Par défaut PP-OCRv6 détecte à la résolution d'origine (jusqu'à 4000 px de côté), ce qui
            # coûte plus de 1,7 Go en pointe pour une page A4 à 200 ppp : on plafonne le grand côté.
            text_det_limit_type="max",
            text_det_limit_side_len=cfg.detection_cote_max,
            device="cpu",
            cpu_threads=cfg.threads_cpu,
        )
        # Inférence à blanc : charge réellement les graphes et valide les modèles avant d'annoncer « prêt ».
        self.reconnaitre(np.full((64, 256, 3), 255, dtype=np.uint8))

    def reconnaitre(self, image_bgr: np.ndarray) -> list[Ligne]:
        hauteur, largeur = image_bgr.shape[:2]
        if hauteur < _COTE_MIN_PIXELS or largeur < _COTE_MIN_PIXELS:
            return []
        # Un seul traitement OCR à la fois par processus.
        with self._verrou:
            resultats = list(self._ocr.predict(image_bgr))
        lignes: list[Ligne] = []
        for resultat in resultats:
            textes = resultat["rec_texts"]
            scores = resultat["rec_scores"]
            polygones = resultat["rec_polys"]
            for texte, score, polygone in zip(textes, scores, polygones):
                if not texte or not texte.strip():
                    continue
                points = np.asarray(polygone, dtype=np.float64).reshape(-1, 2)
                x0 = int(max(0, min(largeur, np.floor(points[:, 0].min()))))
                y0 = int(max(0, min(hauteur, np.floor(points[:, 1].min()))))
                x1 = int(max(0, min(largeur, np.ceil(points[:, 0].max()))))
                y1 = int(max(0, min(hauteur, np.ceil(points[:, 1].max()))))
                lignes.append(Ligne(texte=texte.strip(), boite=(x0, y0, x1, y1), score=round(float(score), 4)))
        return ordonner_lecture(lignes)
