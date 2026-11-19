"""Génération de factures synthétiques françaises (données entièrement fictives) pour les tests."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from PIL import Image, ImageDraw, ImageFont

POLICE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
POLICE_GRAS = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# A4 à 200 points par pouce.
LARGEUR_A4 = 1654
HAUTEUR_A4 = 2339


def euros(montant: Decimal) -> str:
    """Formate un montant à la française : « 1 714,40 € »."""
    entier, _, decimales = f"{montant:.2f}".partition(".")
    groupes = []
    while entier:
        groupes.insert(0, entier[-3:])
        entier = entier[:-3]
    return f"{' '.join(groupes)},{decimales} €"


@dataclass
class Facture:
    numero: str = "F-2026-0042"
    date: str = "19/11/2026"
    siret: str = "123 456 789 00012"  # fictif
    emetteur: str = "ATELIER DURAND SARL"
    client: str = "Cabinet Lefèvre & Associés"
    # (désignation, quantité, prix unitaire HT)
    lignes: list[tuple[str, int, Decimal]] = field(
        default_factory=lambda: [
            ("Prestation de conseil comptable", 3, Decimal("450.00")),
            ("Hébergement annuel du logiciel", 1, Decimal("289.90")),
            ("Frais de déplacement", 2, Decimal("37.25")),
        ]
    )

    @property
    def total_ht(self) -> Decimal:
        return sum((q * pu for _, q, pu in self.lignes), Decimal("0"))

    @property
    def tva(self) -> Decimal:
        return (self.total_ht * Decimal("0.20")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @property
    def total_ttc(self) -> Decimal:
        return self.total_ht + self.tva


def facture_numero(n: int) -> Facture:
    """Variante déterministe (numéro et montants différents) pour les documents multi-pages."""
    return Facture(
        numero=f"F-2026-{100 + n:04d}",
        lignes=[
            ("Tenue de comptabilité mensuelle", n + 1, Decimal("320.00")),
            ("Établissement des bulletins de paie", 4 + n, Decimal("18.50")),
        ],
    )


def dessiner_facture(facture: Facture, largeur: int = LARGEUR_A4, hauteur: int = HAUTEUR_A4) -> Image.Image:
    image = Image.new("RGB", (largeur, hauteur), "white")
    d = ImageDraw.Draw(image)
    titre = ImageFont.truetype(POLICE_GRAS, 46)
    gras = ImageFont.truetype(POLICE_GRAS, 30)
    normal = ImageFont.truetype(POLICE, 28)
    marge = 110

    d.text((marge, 120), facture.emetteur, font=gras, fill="black")
    d.text((marge, 170), "12 rue des Lilas, 69003 Lyon", font=normal, fill="black")
    d.text((marge, 215), f"SIRET : {facture.siret}", font=normal, fill="black")
    d.text((marge, 260), "TVA intracommunautaire : FR12 123456789", font=normal, fill="black")

    d.text((880, 120), f"FACTURE N° {facture.numero}", font=titre, fill="black")
    d.text((880, 200), f"Date : {facture.date}", font=normal, fill="black")
    d.text((880, 245), "Échéance : 19/12/2026", font=normal, fill="black")

    d.text((marge, 400), f"Client : {facture.client}", font=normal, fill="black")

    y = 560
    colonnes = (marge, 900, 1080, 1320)
    d.rectangle((marge - 10, y - 12, largeur - marge + 10, y + 48), fill=(230, 230, 230))
    for x, entete in zip(colonnes, ("Désignation", "Qté", "PU HT", "Montant HT")):
        d.text((x, y), entete, font=gras, fill="black")
    y += 80
    for designation, quantite, prix in facture.lignes:
        d.text((colonnes[0], y), designation, font=normal, fill="black")
        d.text((colonnes[1], y), str(quantite), font=normal, fill="black")
        d.text((colonnes[2], y), euros(prix), font=normal, fill="black")
        d.text((colonnes[3], y), euros(quantite * prix), font=normal, fill="black")
        y += 60
        d.line((marge - 10, y - 14, largeur - marge + 10, y - 14), fill=(190, 190, 190), width=2)

    y += 60
    for libelle, montant, police in (
        ("Total HT", facture.total_ht, normal),
        ("TVA 20 %", facture.tva, normal),
        ("Total TTC", facture.total_ttc, gras),
    ):
        d.text((1020, y), libelle, font=police, fill="black")
        d.text((1320, y), euros(montant), font=police, fill="black")
        y += 58

    d.text((marge, hauteur - 220), "Paiement à 30 jours par virement bancaire.", font=normal, fill="black")
    d.text((marge, hauteur - 175), "Pénalités de retard : trois fois le taux d'intérêt légal.", font=normal, fill="black")
    return image


def en_octets(image: Image.Image, format_pillow: str, **options) -> bytes:
    tampon = io.BytesIO()
    image.save(tampon, format_pillow, **options)
    return tampon.getvalue()


def jpeg_pivote_exif(image: Image.Image, orientation: int = 6) -> bytes:
    """JPEG dont les pixels sont stockés pivotés, avec la balise EXIF Orientation qui rétablit le sens de lecture."""
    transposition = {
        3: Image.Transpose.ROTATE_180,  # stocké tête en bas
        6: Image.Transpose.ROTATE_90,  # stocké pivoté de 90° en sens antihoraire
        8: Image.Transpose.ROTATE_270,  # stocké pivoté de 90° en sens horaire
    }[orientation]
    stockee = image.transpose(transposition)
    exif = Image.Exif()
    exif[0x0112] = orientation
    return en_octets(stockee, "JPEG", quality=90, exif=exif)


def pdf_images(images: list[Image.Image]) -> bytes:
    """PDF multi-pages dont chaque page est une image (cas d'un document numérisé)."""
    tampon = io.BytesIO()
    images[0].save(tampon, "PDF", save_all=True, append_images=images[1:], resolution=200.0)
    return tampon.getvalue()


def pdf_vectoriel(pages: list[list[tuple[float, float, int, str]]]) -> bytes:
    """PDF minimal écrit à la main, avec du texte vectoriel (police standard Helvetica).

    Chaque page est une liste de (x, y, taille, texte) en points PDF (origine en bas à gauche, A4 = 595×842).
    """

    def chaine(texte: str) -> bytes:
        brut = texte.encode("cp1252")
        return brut.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")

    objets: list[bytes] = []
    nb = len(pages)
    refs_pages = " ".join(f"{4 + 2 * i} 0 R" for i in range(nb))
    objets.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objets.append(f"<< /Type /Pages /Kids [{refs_pages}] /Count {nb} >>".encode())
    objets.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    for i, lignes in enumerate(pages):
        contenu = b"".join(
            b"BT /F1 %d Tf %.1f %.1f Td (%s) Tj ET\n" % (taille, x, y, chaine(texte)) for x, y, taille, texte in lignes
        )
        objets.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>".encode()
        )
        objets.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(contenu), contenu))

    sortie = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    decalages = []
    for numero, objet in enumerate(objets, start=1):
        decalages.append(len(sortie))
        sortie += b"%d 0 obj\n%s\nendobj\n" % (numero, objet)
    debut_xref = len(sortie)
    sortie += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objets) + 1)
    for decalage in decalages:
        sortie += b"%010d 00000 n \n" % decalage
    sortie += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objets) + 1, debut_xref)
    return bytes(sortie)


def page_vectorielle(facture: Facture) -> list[tuple[float, float, int, str]]:
    lignes = [
        (50, 780, 12, facture.emetteur),
        (50, 762, 10, f"SIRET : {facture.siret}"),
        (320, 780, 16, f"FACTURE N° {facture.numero}"),
        (320, 760, 10, f"Date : {facture.date}"),
        (50, 700, 10, f"Client : {facture.client}"),
    ]
    y = 640
    for designation, quantite, prix in facture.lignes:
        lignes.append((50, y, 10, designation))
        lignes.append((330, y, 10, str(quantite)))
        lignes.append((390, y, 10, euros(prix).replace("€", "EUR")))
        lignes.append((470, y, 10, euros(quantite * prix).replace("€", "EUR")))
        y -= 22
    y -= 20
    for libelle, montant in (("Total HT", facture.total_ht), ("TVA 20 %", facture.tva), ("Total TTC", facture.total_ttc)):
        lignes.append((370, y, 11, libelle))
        lignes.append((470, y, 11, euros(montant).replace("€", "EUR")))
        y -= 22
    return lignes


def normaliser(texte: str) -> str:
    """Supprime tous les blancs et passe en minuscules, pour comparer montants et identifiants sans dépendre des espaces."""
    return re.sub(r"\s+", "", texte).lower()


def montant_normalise(montant: Decimal) -> str:
    return normaliser(euros(montant).replace("€", ""))
