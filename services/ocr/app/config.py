"""Configuration du service, lue une seule fois depuis les variables d'environnement."""

from __future__ import annotations

import os
from dataclasses import dataclass

# Types MIME acceptés par POST /ocr (contrat HTTP avec le worker Node).
TYPES_PRIS_EN_CHARGE = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/tiff",
    "application/pdf",
)


def _entier(nom: str, defaut: int, minimum: int = 1) -> int:
    brut = os.environ.get(nom)
    if brut is None or brut.strip() == "":
        return defaut
    try:
        valeur = int(brut)
    except ValueError as erreur:
        raise ValueError(f"Variable {nom} invalide : entier attendu") from erreur
    if valeur < minimum:
        raise ValueError(f"Variable {nom} invalide : minimum {minimum}")
    return valeur


@dataclass(frozen=True)
class Configuration:
    # Taille maximale du corps de requête, en octets (au-delà : 413).
    taille_max_octets: int = 25 * 1024 * 1024
    # Nombre maximal de pages traitées par document (les suivantes sont ignorées et comptées).
    pages_max: int = 30
    # Nombre maximal de pixels par page décodée (protection contre les bombes de décompression).
    pixels_max: int = 40_000_000
    # Résolution de rastérisation des PDF.
    pdf_dpi: int = 200
    # Délai maximal d'une requête (lecture du corps + attente en file + OCR), en secondes.
    delai_requete_s: int = 300
    # Nombre de requêtes pouvant ATTENDRE derrière celle en cours de traitement (au-delà : 429).
    file_attente_max: int = 4
    # Nombre de threads CPU utilisés par l'inférence (voir README : 4 threads ont provoqué une
    # erreur de segmentation de Paddle sur arm64 pendant les essais ; ne pas dépasser 2 sans test).
    threads_cpu: int = 2
    # Plus grand côté (en pixels) de l'image présentée au modèle de DÉTECTION. Les pages plus grandes
    # sont réduites pour la détection seulement (la reconnaissance lit toujours les pixels d'origine).
    # C'est le réglage qui borne la mémoire et le temps par page.
    detection_cote_max: int = 1536
    # Modèles embarqués dans l'image (aucun téléchargement à l'exécution).
    modele_detection_nom: str = "PP-OCRv6_small_det"
    modele_detection_dossier: str = "/opt/modeles/PP-OCRv6_small_det_infer"
    modele_reconnaissance_nom: str = "PP-OCRv6_small_rec"
    modele_reconnaissance_dossier: str = "/opt/modeles/PP-OCRv6_small_rec_infer"

    @classmethod
    def depuis_environnement(cls) -> "Configuration":
        d = cls()
        return cls(
            taille_max_octets=_entier("OCR_TAILLE_MAX_OCTETS", d.taille_max_octets),
            pages_max=_entier("OCR_PAGES_MAX", d.pages_max),
            pixels_max=_entier("OCR_PIXELS_MAX", d.pixels_max, minimum=10_000),
            pdf_dpi=_entier("OCR_PDF_DPI", d.pdf_dpi, minimum=50),
            delai_requete_s=_entier("OCR_DELAI_REQUETE_S", d.delai_requete_s),
            file_attente_max=_entier("OCR_FILE_ATTENTE_MAX", d.file_attente_max, minimum=0),
            threads_cpu=_entier("OCR_THREADS_CPU", d.threads_cpu),
            detection_cote_max=_entier("OCR_DETECTION_COTE_MAX", d.detection_cote_max, minimum=320),
            modele_detection_nom=os.environ.get("OCR_MODELE_DETECTION_NOM", d.modele_detection_nom),
            modele_detection_dossier=os.environ.get("OCR_MODELE_DETECTION_DOSSIER", d.modele_detection_dossier),
            modele_reconnaissance_nom=os.environ.get("OCR_MODELE_RECONNAISSANCE_NOM", d.modele_reconnaissance_nom),
            modele_reconnaissance_dossier=os.environ.get(
                "OCR_MODELE_RECONNAISSANCE_DOSSIER", d.modele_reconnaissance_dossier
            ),
        )
