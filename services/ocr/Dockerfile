# Service OCR Comtaple — PaddleOCR exécuté localement, sans aucun accès réseau à l'exécution.
#
#   docker build -t comtaple-ocr:dev services/ocr                          # image d'exécution (étape finale)
#   docker build --target tests -t comtaple-ocr:tests services/ocr         # image de test (pytest)
#
# Tout ce qui vient du réseau est récupéré AU BUILD, par version exacte, et contrôlé par SHA-256
# quand la source n'est pas PyPI (roue PaddlePaddle, modèles).

# Image de base figée par tag ET par empreinte (index multi-architecture).
ARG IMAGE_PYTHON=python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

# ---------------------------------------------------------------------------------------------
# Étape 1 — téléchargements vérifiés (roue PaddlePaddle + modèles PP-OCRv6). Rien d'autre n'en sort.
# ---------------------------------------------------------------------------------------------
FROM ${IMAGE_PYTHON} AS telechargements
ARG TARGETARCH
COPY build/telecharger.py /build/telecharger.py

# PaddlePaddle 3.4.0 (CPU) : absent de PyPI, pris sur l'index officiel PaddlePaddle.
ARG PADDLE_VERSION=3.4.0
ARG PADDLE_SHA256_ARM64=69380ca113f3dcbe5804079d5baeee006acf74357aed903592ed05190514e89c
ARG PADDLE_SHA256_AMD64=166d66d2e873443f32e5f42bb08bf8dcf09109b94e4ab54f4683fbc1e2053f4b
RUN set -eu; \
    case "${TARGETARCH}" in \
      arm64) plateforme=linux_aarch64; empreinte="${PADDLE_SHA256_ARM64}" ;; \
      amd64) plateforme=linux_x86_64;  empreinte="${PADDLE_SHA256_AMD64}" ;; \
      *) echo "Architecture non prise en charge : ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    roue="paddlepaddle-${PADDLE_VERSION}-cp312-cp312-${plateforme}.whl"; \
    python /build/telecharger.py \
      "https://paddle-whl.cdn.bcebos.com/stable/cpu/paddlepaddle/${roue}" "${empreinte}" "/roues/${roue}"

# Modèles d'inférence officiels PP-OCRv6 « small » (licence Apache-2.0), format Paddle.
# Source : tableau des modèles de la documentation PaddleOCR 3.7 (pipeline OCR général).
ARG URL_MODELES=https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0
ARG MODELE_DET_SHA256=bfb7c1e59f0faa6b540ebdca93aea3f4b1f2477805b389fbee117820d68fe9f5
ARG MODELE_REC_SHA256=da460f968ce9f88325ac3a34fa302077d6e9b0dcefb16ba3137cd7796f879d06
RUN set -eu; \
    python /build/telecharger.py "${URL_MODELES}/PP-OCRv6_small_det_infer.tar" "${MODELE_DET_SHA256}" /modeles --extraire; \
    python /build/telecharger.py "${URL_MODELES}/PP-OCRv6_small_rec_infer.tar" "${MODELE_REC_SHA256}" /modeles --extraire; \
    test -f /modeles/PP-OCRv6_small_det_infer/inference.pdiparams; \
    test -f /modeles/PP-OCRv6_small_rec_infer/inference.pdiparams; \
    chmod -R a+rX,go-w /modeles

# ---------------------------------------------------------------------------------------------
# Étape 2 — image d'exécution
# ---------------------------------------------------------------------------------------------
FROM ${IMAGE_PYTHON} AS execution

# Bibliothèques système requises par opencv (libGL, glib) et paddle (OpenMP).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# 1) roue PaddlePaddle vérifiée ; 2) le reste, entièrement figé, depuis PyPI.
COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=bind,from=telechargements,source=/roues,target=/roues \
    pip install --no-deps /roues/paddlepaddle-*.whl \
 && pip install -r /tmp/requirements.txt \
 && pip check \
 && rm /tmp/requirements.txt

COPY --from=telechargements /modeles /opt/modeles

# Utilisateur non privilégié, sans shell de connexion.
RUN useradd --system --uid 10001 --user-group --home-dir /nonexistent --shell /usr/sbin/nologin ocr

WORKDIR /srv/ocr
COPY app ./app
RUN python -m compileall -q app

# Fonctionnement hors ligne et sobriété :
#  - PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK : paddlex ne teste pas la joignabilité des dépôts de modèles ;
#  - HF_HUB_OFFLINE / télémétries coupées : aucune bibliothèque ne tente de sortie réseau ;
#  - PADDLE_PDX_CACHE_HOME et HOME dans /tmp : seuls écrits du service (verrous paddlex), compatibles
#    avec un système de fichiers en lecture seule + tmpfs sur /tmp ;
#  - OPENBLAS_NUM_THREADS=1 : sans cela, les threads d'OpenBLAS se disputent les cœurs avec ceux de
#    Paddle (mesuré sur arm64 : 30 à 60 s par page au lieu de 3 à 4 s).
ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_PDX_CACHE_HOME=/tmp/paddlex \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1 \
    HOME=/tmp \
    OPENBLAS_NUM_THREADS=1

USER 10001:10001
EXPOSE 8500

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=4 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8500/sante', timeout=4).status == 200 else 1)"]

# Un seul processus : le traitement OCR est sérialisé par un verrou (voir app/main.py).
CMD ["python", "-m", "uvicorn", "app.main:app", "--factory", "--host", "0.0.0.0", "--port", "8500", \
     "--workers", "1", "--no-access-log", "--no-server-header", "--timeout-keep-alive", "15", "--limit-concurrency", "64"]

# ---------------------------------------------------------------------------------------------
# Étape 3 — image de test : image d'exécution + pytest + polices pour dessiner les factures synthétiques
#   docker run --rm --network none --read-only --tmpfs /tmp comtaple-ocr:tests
# ---------------------------------------------------------------------------------------------
FROM execution AS tests
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY requirements-tests.txt /tmp/requirements-tests.txt
RUN pip install -r /tmp/requirements-tests.txt && rm /tmp/requirements-tests.txt
COPY tests ./tests
USER 10001:10001
CMD ["python", "-m", "pytest", "tests", "-p", "no:cacheprovider", "-ra", "--durations=8"]

# ---------------------------------------------------------------------------------------------
# Étape finale (cible par défaut de `docker build`) : l'image d'exécution, sans rien des tests.
# ---------------------------------------------------------------------------------------------
FROM execution AS final
