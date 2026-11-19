"""API HTTP du service OCR (FastAPI).

Contrat :
- GET  /sante → 200 une fois les modèles chargés, 503 avant.
- POST /ocr   → corps = octets bruts de la pièce ; voir README.md pour les codes de retour.

Concurrence : un seul traitement OCR à la fois (exécuteur à un seul thread + verrou du moteur),
file d'attente bornée (429 au-delà), délai maximal par requête (504).
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import TYPES_PRIS_EN_CHARGE, Configuration
from .documents import DocumentIllisible, ouvrir_document
from .journal import journaliser
from .moteur import Moteur

LANGUE = "fr"


class _Annule(Exception):
    """Le délai de la requête est dépassé : le traitement s'arrête à la page suivante."""


class _CorpsTropGrand(Exception):
    pass


@dataclass
class _Etat:
    cfg: Configuration
    moteur: Moteur | None = None
    echec_chargement: bool = False
    # Nombre de requêtes admises (en cours de lecture, en attente ou en traitement).
    admises: int = 0
    executeur: ThreadPoolExecutor = field(
        default_factory=lambda: ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr")
    )


def _erreur(code: int, identifiant: str, message: str, entetes: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"erreur": identifiant, "message": message}, status_code=code, headers=entetes)


def creer_application(cfg: Configuration | None = None, moteur: Moteur | None = None) -> FastAPI:
    """Fabrique l'application. `moteur` permet d'injecter un moteur factice dans les tests."""
    cfg = cfg or Configuration.depuis_environnement()
    etat = _Etat(cfg=cfg, moteur=moteur)

    def charger_moteur() -> None:
        try:
            from .moteur import MoteurPaddle

            debut = time.monotonic()
            m = MoteurPaddle(cfg)
            etat.moteur = m
            journaliser(
                "moteur_pret",
                moteur=m.nom,
                version_moteur=m.version,
                modeles=m.modeles,
                duree_ms=int((time.monotonic() - debut) * 1000),
            )
        except Exception as erreur:  # noqa: BLE001
            etat.echec_chargement = True
            # Au chargement, aucune pièce n'a encore été lue (seule une image blanche de contrôle est traitée) : le
            # message de l'exception ne peut contenir aucun fragment de document, et il est indispensable au diagnostic.
            journaliser("moteur_echec_chargement", exception=type(erreur).__name__, message_chargement=str(erreur)[-1500:])

    @asynccontextmanager
    async def cycle_de_vie(_: FastAPI):
        if etat.moteur is None:
            # Chargement en arrière-plan : /sante répond 503 tant que les modèles ne sont pas prêts.
            threading.Thread(target=charger_moteur, name="chargement-modeles", daemon=True).start()
        yield
        etat.executeur.shutdown(wait=False, cancel_futures=True)

    # Pas de documentation interactive : elle chargerait des ressources depuis un CDN externe.
    app = FastAPI(title="Comtaple OCR", docs_url=None, redoc_url=None, openapi_url=None, lifespan=cycle_de_vie)
    app.state.etat = etat

    @app.get("/sante")
    async def sante() -> JSONResponse:
        m = etat.moteur
        if m is None:
            statut = "erreur" if etat.echec_chargement else "chargement"
            return JSONResponse(
                {"statut": statut, "moteur": "paddleocr", "langue": LANGUE},
                status_code=503,
                headers={"Retry-After": "5"},
            )
        return JSONResponse(
            {
                "statut": "pret",
                "moteur": m.nom,
                "version_moteur": m.version,
                "modeles": m.modeles,
                "langue": LANGUE,
            }
        )

    def traiter(octets: bytes, type_mime: str, annulation: threading.Event) -> dict:
        """Décodage + OCR, exécuté dans l'unique thread de traitement."""
        m = etat.moteur
        assert m is not None
        if annulation.is_set():
            raise _Annule()
        document = ouvrir_document(octets, type_mime, cfg)
        try:
            pages = []
            with contextlib.closing(document.pages()) as iterateur:
                for numero, image in enumerate(iterateur, start=1):
                    if annulation.is_set():
                        raise _Annule()
                    hauteur, largeur = image.shape[:2]
                    lignes = m.reconnaitre(image)
                    del image
                    pages.append(
                        {
                            "page": numero,
                            "largeur": int(largeur),
                            "hauteur": int(hauteur),
                            "texte": "\n".join(l.texte for l in lignes),
                            "lignes": [
                                {"texte": l.texte, "boite": list(l.boite), "score": l.score} for l in lignes
                            ],
                        }
                    )
            return {"pages_ignorees": document.pages_ignorees, "pages": pages}
        finally:
            document.fermer()

    async def lire_corps(requete: Request) -> bytes:
        tampon = bytearray()
        async for morceau in requete.stream():
            if len(tampon) + len(morceau) > cfg.taille_max_octets:
                raise _CorpsTropGrand()
            tampon += morceau
        return bytes(tampon)

    @app.post("/ocr")
    async def ocr(requete: Request) -> JSONResponse:
        debut = time.monotonic()
        echeance = debut + cfg.delai_requete_s
        type_mime = requete.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        type_journal = type_mime if type_mime in TYPES_PRIS_EN_CHARGE else "non_pris_en_charge"
        taille: int | None = None

        def repondre(reponse: JSONResponse, **champs: object) -> JSONResponse:
            journaliser(
                "ocr",
                code=reponse.status_code,
                type=type_journal,
                taille_octets=taille,
                duree_ms=int((time.monotonic() - debut) * 1000),
                **champs,
            )
            return reponse

        if etat.moteur is None:
            return repondre(
                _erreur(503, "moteur_non_pret", "Les modèles OCR ne sont pas encore chargés.", {"Retry-After": "5"})
            )
        if type_mime not in TYPES_PRIS_EN_CHARGE:
            return repondre(
                _erreur(
                    415,
                    "type_non_pris_en_charge",
                    "Type de contenu non pris en charge. Types acceptés : " + ", ".join(TYPES_PRIS_EN_CHARGE) + ".",
                )
            )
        message_413 = f"Fichier trop volumineux : la limite est de {cfg.taille_max_octets} octets."
        annonce = requete.headers.get("content-length")
        if annonce is not None and annonce.isdigit() and int(annonce) > cfg.taille_max_octets:
            return repondre(_erreur(413, "fichier_trop_volumineux", message_413))

        # Admission : une requête en traitement + `file_attente_max` en attente, pas davantage.
        if etat.admises >= 1 + cfg.file_attente_max:
            return repondre(
                _erreur(
                    429,
                    "service_sature",
                    "Service OCR saturé : trop de documents en attente. Réessayez plus tard.",
                    {"Retry-After": "10"},
                ),
                en_attente=etat.admises,
            )
        etat.admises += 1
        liberee = False

        def liberer(_: object = None) -> None:
            nonlocal liberee
            if not liberee:
                liberee = True
                etat.admises -= 1

        boucle = asyncio.get_running_loop()
        annulation = threading.Event()
        tache: asyncio.Future | None = None
        try:
            try:
                octets = await asyncio.wait_for(lire_corps(requete), timeout=max(0.001, echeance - time.monotonic()))
            except _CorpsTropGrand:
                return repondre(_erreur(413, "fichier_trop_volumineux", message_413))
            except asyncio.TimeoutError:
                return repondre(_erreur(408, "delai_envoi_depasse", "Délai dépassé pendant la réception du fichier."))
            taille = len(octets)
            if taille == 0:
                return repondre(_erreur(422, "fichier_illisible", "Fichier vide : aucun octet reçu."))

            tache = boucle.run_in_executor(etat.executeur, traiter, octets, type_mime, annulation)
            del octets
            # La place n'est rendue que lorsque le thread de traitement a réellement terminé,
            # même si la réponse (504) est partie avant. Les rappels s'exécutent dans la boucle asyncio.
            tache.add_done_callback(liberer)
            tache.add_done_callback(lambda f: f.cancelled() or f.exception())  # évite « exception never retrieved »
        finally:
            if tache is None:
                liberer()

        try:
            resultat = await asyncio.wait_for(asyncio.shield(tache), timeout=max(0.001, echeance - time.monotonic()))
        except asyncio.TimeoutError:
            annulation.set()
            return repondre(
                _erreur(
                    504,
                    "delai_depasse",
                    f"Délai de traitement dépassé ({cfg.delai_requete_s} s). Réessayez plus tard ou réduisez le document.",
                )
            )
        except DocumentIllisible as erreur:
            return repondre(_erreur(422, "fichier_illisible", str(erreur)))
        except _Annule:
            return repondre(_erreur(504, "delai_depasse", "Délai de traitement dépassé."))
        except Exception as erreur:  # noqa: BLE001 — jamais de message d'exception dans le journal
            return repondre(
                _erreur(500, "erreur_interne", "Erreur interne du moteur OCR."), exception=type(erreur).__name__
            )

        m = etat.moteur
        corps = {
            "moteur": m.nom,
            "version_moteur": m.version,
            "duree_ms": int((time.monotonic() - debut) * 1000),
            "pages_ignorees": resultat["pages_ignorees"],
            "pages": resultat["pages"],
        }
        return repondre(JSONResponse(corps), pages=len(resultat["pages"]), pages_ignorees=resultat["pages_ignorees"])

    return app


def app() -> FastAPI:
    """Point d'entrée uvicorn (`--factory`)."""
    return creer_application()
