"""Décodage des pièces (images et PDF) en pages matricielles, entièrement en mémoire.

Les fichiers reçus sont des contenus NON FIABLES :
- aucun fichier n'est écrit sur disque, aucun sous-processus n'est lancé ;
- les images sont décodées par Pillow en restreignant le décodeur au format annoncé ;
- les PDF sont rastérisés par PDFium (pypdfium2) : pas d'exécution de JavaScript (les binaires
  pypdfium2 sont compilés sans V8, et l'environnement de formulaire n'est jamais initialisé),
  pas de XFA, et PDFium ne récupère aucune ressource externe ;
- le nombre de pixels par page est plafonné AVANT toute allocation (bombes de décompression).
"""

from __future__ import annotations

import io
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Configuration

_FORMATS_PILLOW = {
    "image/jpeg": ("JPEG",),
    "image/png": ("PNG",),
    "image/webp": ("WEBP",),
    "image/tiff": ("TIFF",),
}


class DocumentIllisible(Exception):
    """Le fichier ne peut pas être décodé ; le message est destiné au client (sans contenu de la pièce)."""


@dataclass
class Document:
    """Document ouvert : `pages()` produit les pages une par une (mémoire bornée)."""

    nb_pages_total: int
    pages_ignorees: int
    pages: Callable[[], Iterator[np.ndarray]]
    fermer: Callable[[], None]


def ouvrir_document(octets: bytes, type_mime: str, cfg: Configuration) -> Document:
    """Ouvre la pièce. Lève `DocumentIllisible` si elle ne peut pas être lue."""
    if type_mime == "application/pdf":
        return _ouvrir_pdf(octets, cfg)
    return _ouvrir_image(octets, type_mime, cfg)


# --------------------------------------------------------------------------- images


def _verifier_pixels(largeur: int, hauteur: int, cfg: Configuration) -> None:
    if largeur <= 0 or hauteur <= 0:
        raise DocumentIllisible("Image illisible : dimensions invalides.")
    if largeur * hauteur > cfg.pixels_max:
        raise DocumentIllisible(
            f"Image trop grande : {largeur}×{hauteur} pixels dépasse la limite de {cfg.pixels_max} pixels par page."
        )


def _vers_bgr(image: Image.Image) -> np.ndarray:
    """Applique l'orientation EXIF, aplatit la transparence sur fond blanc, renvoie un tableau BGR."""
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        fond = Image.new("RGB", rgba.size, (255, 255, 255))
        fond.paste(rgba, mask=rgba.getchannel("A"))
        image = fond
    elif image.mode != "RGB":
        image = image.convert("RGB")
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


def _ouvrir_image(octets: bytes, type_mime: str, cfg: Configuration) -> Document:
    Image.MAX_IMAGE_PIXELS = cfg.pixels_max
    nom_type = type_mime.split("/", 1)[1].upper()
    try:
        # Pillow avertit au-delà de MAX_IMAGE_PIXELS et ne refuse qu'au-delà du double : on transforme
        # l'avertissement en erreur pour que le plafond soit strict, dès la lecture de l'en-tête.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(octets), formats=_FORMATS_PILLOW[type_mime])
    except UnidentifiedImageError:
        raise DocumentIllisible(
            f"Fichier illisible : le contenu n'est pas une image {nom_type} valide (fichier corrompu ou type déclaré erroné)."
        ) from None
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise DocumentIllisible(
            f"Image trop grande : dépasse la limite de {cfg.pixels_max} pixels par page."
        ) from None
    except Exception:
        raise DocumentIllisible(f"Fichier illisible : image {nom_type} corrompue.") from None

    _verifier_pixels(image.width, image.height, cfg)
    # Seul le TIFF est traité comme multi-pages ; pour les autres formats, seule la première image compte.
    nb_total = int(getattr(image, "n_frames", 1)) if type_mime == "image/tiff" else 1
    nb_traitees = min(nb_total, cfg.pages_max)

    def pages() -> Iterator[np.ndarray]:
        for indice in range(nb_traitees):
            try:
                if indice > 0:
                    image.seek(indice)
                _verifier_pixels(image.width, image.height, cfg)
                image.load()
                yield _vers_bgr(image)
            except DocumentIllisible:
                raise
            except (Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise DocumentIllisible(
                    f"Image trop grande : dépasse la limite de {cfg.pixels_max} pixels par page."
                ) from None
            except Exception:
                raise DocumentIllisible(
                    f"Fichier illisible : image {nom_type} corrompue ou tronquée."
                ) from None

    return Document(nb_total, nb_total - nb_traitees, pages, image.close)


# --------------------------------------------------------------------------- PDF


def _ouvrir_pdf(octets: bytes, cfg: Configuration) -> Document:
    if not octets.lstrip()[:5].startswith(b"%PDF-") and b"%PDF-" not in octets[:1024]:
        raise DocumentIllisible("Fichier illisible : le contenu n'est pas un PDF valide.")
    try:
        pdf = pdfium.PdfDocument(octets)
        nb_total = len(pdf)
    except pdfium.PdfiumError as erreur:
        # Le message de PDFium ne contient qu'un code d'erreur (jamais de contenu du document).
        if "password" in str(erreur).lower():
            raise DocumentIllisible(
                "PDF protégé par mot de passe : impossible de le lire. Fournissez une version non protégée."
            ) from None
        raise DocumentIllisible("Fichier illisible : PDF corrompu ou non conforme.") from None
    except Exception:
        raise DocumentIllisible("Fichier illisible : PDF corrompu ou non conforme.") from None
    if nb_total < 1:
        pdf.close()
        raise DocumentIllisible("PDF sans aucune page.")
    nb_traitees = min(nb_total, cfg.pages_max)

    def pages() -> Iterator[np.ndarray]:
        for indice in range(nb_traitees):
            page = None
            bitmap = None
            try:
                page = pdf[indice]
                largeur_pt, hauteur_pt = page.get_size()
                if not (largeur_pt > 0 and hauteur_pt > 0):
                    raise DocumentIllisible(f"PDF illisible : page {indice + 1} de dimensions invalides.")
                echelle = cfg.pdf_dpi / 72.0
                # Page gigantesque : on réduit l'échelle pour rester sous le plafond de pixels.
                pixels = (largeur_pt * echelle) * (hauteur_pt * echelle)
                if pixels > cfg.pixels_max:
                    echelle *= (cfg.pixels_max / pixels) ** 0.5 * 0.999
                # may_draw_forms=False : l'environnement de formulaire (et donc tout script) n'est jamais initialisé.
                bitmap = page.render(scale=echelle, may_draw_forms=False)
                tableau = bitmap.to_numpy()
                if tableau.ndim == 2:
                    tableau = np.stack([tableau] * 3, axis=-1)
                # PDFium produit du BGR(X) : on garde les trois premiers canaux, copiés hors du tampon natif.
                yield np.ascontiguousarray(tableau[:, :, :3])
            except DocumentIllisible:
                raise
            except Exception:
                raise DocumentIllisible(
                    f"PDF illisible : la page {indice + 1} ne peut pas être rendue."
                ) from None
            finally:
                if bitmap is not None:
                    bitmap.close()
                if page is not None:
                    page.close()

    return Document(nb_total, nb_total - nb_traitees, pages, pdf.close)
