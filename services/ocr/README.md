# Service OCR Comtaple

Petit service HTTP (FastAPI + uvicorn) qui exécute **PaddleOCR en local** dans un conteneur.
Les pièces comptables sont confidentielles : **aucun appel réseau sortant à l'exécution**, les modèles
sont téléchargés au build et embarqués dans l'image, rien n'est écrit sur disque, et le texte reconnu
n'est jamais journalisé.

## Versions figées

| Composant | Version | Source |
|---|---|---|
| Image de base | `python:3.12.16-slim-bookworm` (+ empreinte `sha256:935c3c5b…03df`) | Docker Hub |
| PaddleOCR | `3.7.0` (11/06/2026) | PyPI |
| PaddleX (dépendance de PaddleOCR) | `3.7.2` | PyPI |
| PaddlePaddle (CPU) | `3.4.0` (11/09/2026) | index officiel PaddlePaddle, roue contrôlée par SHA-256 |
| Modèle de détection | `PP-OCRv6_small_det` (archive du 09/06/2026, SHA-256 dans le Dockerfile) | `paddle-model-ecology.bj.bcebos.com` |
| Modèle de reconnaissance | `PP-OCRv6_small_rec` (idem) — un seul modèle pour 50 langues dont le français | idem |
| Rastérisation PDF | `pypdfium2 5.15.2` (PDFium 159.0.8149.0, compilé sans V8 ni XFA) | PyPI |
| Autres | `fastapi 0.165.0`, `uvicorn 0.54.0`, `pillow 13.0.0`, `numpy 2.3.5`, `opencv-contrib-python 4.10.0.84` | PyPI |

Toutes les dépendances Python, transitives comprises, sont épinglées avec `==` dans `requirements.txt`.

### Architecture : arm64 natif (pas d'émulation)

- Sur **PyPI**, `paddlepaddle` s'arrête à 3.3.1 et **ne publie plus de roue Linux aarch64 depuis la 3.3.0**
  (dernière roue aarch64 sur PyPI : 3.2.2).
- L'**index officiel PaddlePaddle** (`https://www.paddlepaddle.org.cn/packages/stable/cpu/`, celui que
  recommande la documentation d'installation de PaddleOCR) publie bien `paddlepaddle 3.4.0` pour
  `linux_aarch64`. C'est cette roue qui est utilisée : l'image tourne en **arm64 natif**, l'émulation amd64
  n'a pas été nécessaire.
- Le Dockerfile sait aussi construire en `linux/amd64` (roue x86_64 et son SHA-256 sont prévus), mais
  **cette variante n'a pas été construite ni testée**.

## Construction et lancement

Depuis la racine du dépôt :

```sh
docker build -t comtaple-ocr:dev services/ocr

docker run -d --name comtaple-ocr --restart unless-stopped \
  -p 127.0.0.1:8500:8500 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 2g --pids-limit 256 \
  comtaple-ocr:dev

curl -s http://127.0.0.1:8500/sante
curl -s -X POST -H 'Content-Type: application/pdf' --data-binary @facture.pdf http://127.0.0.1:8500/ocr
```

Le conteneur tourne sous l'utilisateur `10001` (non-root). Le seul répertoire inscriptible nécessaire est
`/tmp` (verrous de PaddleX, quelques octets) : d'où `--read-only` + `--tmpfs /tmp`.

En production, pour interdire toute sortie réseau au niveau de l'infrastructure, placer le service sur un
réseau Docker `internal: true` partagé avec le worker (sans port publié), ou appliquer une règle de
pare-feu en sortie. Le service fonctionne avec `--network none` (vérifié, voir plus bas).

### Tests

Les tests s'exécutent dans une image dédiée (image d'exécution + pytest + polices DejaVu) :

```sh
docker build --target tests -t comtaple-ocr:tests services/ocr
docker run --rm --network none --read-only --tmpfs /tmp comtaple-ocr:tests
```

Ils génèrent avec Pillow des factures françaises fictives (numéro, date, SIRET fictif, lignes, Total HT,
TVA 20 %, Total TTC) en PNG, JPEG pivoté par EXIF (orientations 3, 6, 8), WebP, PNG transparent, TIFF
multi-pages, PDF numérisé multi-pages et PDF vectoriel, puis vérifient que numéro, date, SIRET et montants
sont retrouvés. Ils couvrent aussi 413 / 415 / 422 / 429 / 503 / 504, la limite de pages, la bombe de
décompression, l'absence de contenu dans les journaux et l'absence de tentative de connexion réseau.

## Contrat HTTP

### `GET /sante`

- `200` `{"statut":"pret","moteur":"paddleocr","version_moteur":"3.7.0","modeles":{"detection":"PP-OCRv6_small_det","reconnaissance":"PP-OCRv6_small_rec"},"langue":"fr"}`
- `503` `{"statut":"chargement",…}` tant que les modèles ne sont pas chargés (2 à 3 s au démarrage), ou
  `{"statut":"erreur",…}` si le chargement a échoué.

### `POST /ocr`

Corps = octets bruts du fichier. `Content-Type` : `image/jpeg`, `image/png`, `image/webp`, `image/tiff`
ou `application/pdf`.

```json
{ "moteur": "paddleocr", "version_moteur": "3.7.0", "duree_ms": 3338, "pages_ignorees": 0,
  "pages": [ { "page": 1, "largeur": 1654, "hauteur": 2339,
               "texte": "ATELIER DURAND SARL\nFACTURE N°F-2026-0042\n…",
               "lignes": [ { "texte": "FACTURE N°F-2026-0042", "boite": [877, 120, 1532, 164], "score": 0.9975 } ] } ] }
```

- `largeur` / `hauteur` : dimensions en pixels de l'image de la page **après** application de l'orientation
  EXIF (images) ou après rastérisation à 200 ppp (PDF).
- `boite` : rectangle englobant `[x0, y0, x1, y1]` en pixels de cette image.
- `score` : score de reconnaissance brut du moteur, entre 0 et 1. **Il n'est pas calibré** : ce n'est pas
  une mesure fiable de la justesse du texte (voir « Limites » : une page à l'envers produit du texte faux).
- `texte` : les lignes jointes par `\n` dans l'ordre de lecture (haut → bas, puis gauche → droite ; les boîtes
  d'une même rangée sont regroupées). Une « ligne » est une zone de texte détectée : une rangée de tableau
  donne en général plusieurs lignes (une par cellule).
- Un TIFF multi-images est traité comme un document multi-pages ; pour les autres formats d'image, une page.

| Code | Cas | Corps |
|---|---|---|
| `408` | réception du corps plus longue que le délai de requête | `{"erreur":"delai_envoi_depasse",…}` |
| `413` | corps > `OCR_TAILLE_MAX_OCTETS` (vérifié sur `Content-Length` puis pendant la lecture) | `{"erreur":"fichier_trop_volumineux",…}` |
| `415` | `Content-Type` absent ou non pris en charge | `{"erreur":"type_non_pris_en_charge",…}` |
| `422` | fichier vide, corrompu, tronqué, type déclaré erroné, PDF protégé par mot de passe, image dépassant `OCR_PIXELS_MAX` | `{"erreur":"fichier_illisible","message":"…"}` |
| `429` | un traitement en cours + `OCR_FILE_ATTENTE_MAX` requêtes déjà en attente (`Retry-After: 10`) | `{"erreur":"service_sature",…}` |
| `500` | erreur interne du moteur | `{"erreur":"erreur_interne",…}` |
| `503` | modèles pas encore chargés (`Retry-After: 5`) | `{"erreur":"moteur_non_pret",…}` |
| `504` | délai de requête dépassé (attente en file + traitement) | `{"erreur":"delai_depasse",…}` |

Les codes 408, 429, 500, 503 et 504 ne figuraient pas tous dans le contrat d'origine : le worker Node doit
les traiter (nouvel essai différé pour 429 / 503 / 504).

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `OCR_TAILLE_MAX_OCTETS` | `26214400` (25 Mo) | taille maximale du corps → `413` |
| `OCR_PAGES_MAX` | `30` | pages traitées par document ; le reste est compté dans `pages_ignorees` |
| `OCR_PIXELS_MAX` | `40000000` | pixels maximum par page décodée (A4 à 600 ppp ≈ 35 Mpx) |
| `OCR_PDF_DPI` | `200` | résolution de rastérisation des PDF (réduite automatiquement pour une page géante) |
| `OCR_DELAI_REQUETE_S` | `300` | délai total par requête → `504` |
| `OCR_FILE_ATTENTE_MAX` | `4` | requêtes en attente derrière celle en cours → `429` au-delà |
| `OCR_THREADS_CPU` | `2` | threads d'inférence Paddle |
| `OCR_DETECTION_COTE_MAX` | `1536` | grand côté de l'image présentée au modèle de détection |

## Sécurité et robustesse

- **Hors ligne** : `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`, `HF_HUB_OFFLINE=1`, modèles chargés depuis
  `/opt/modeles` ; les modules optionnels de PaddleOCR qui exigeraient d'autres modèles sont désactivés.
- **Contenus non fiables** : tout se passe en mémoire, aucun fichier temporaire, aucun sous-processus, aucun
  nom de fichier fourni par l'utilisateur. Pillow est restreint au décodeur du type annoncé. PDFium est
  compilé sans moteur JavaScript (V8) ni XFA, l'environnement de formulaire n'est jamais initialisé, et il
  ne récupère aucune ressource externe.
- **Bombes de décompression** : le nombre de pixels est contrôlé sur l'en-tête, avant décodage ; les pages
  PDF géantes sont rastérisées à échelle réduite.
- **Concurrence** : un seul traitement à la fois (exécuteur à un thread + verrou du moteur), file bornée,
  pages traitées une à une (mémoire bornée quel que soit le nombre de pages). Après un `504`, la place
  n'est rendue que lorsque la page en cours est réellement terminée (un thread Python ne s'interrompt pas).
- **Journal** : une ligne JSON par requête, limitée par liste blanche à : type, taille, pages, pages
  ignorées, durée, code (et nom de classe d'exception en cas d'erreur interne). Jamais de texte reconnu,
  d'octets, ni de message d'exception. Le journal d'accès d'uvicorn est désactivé.
- La documentation interactive de FastAPI (`/docs`) est désactivée.

Ce que le service ne fait **pas** : authentification (il doit rester joignable uniquement par le worker,
sur un réseau privé), antivirus (ClamAV est un autre service), chiffrement TLS.

## Mesures (19/11/2026)

Machine de mesure : VM Colima arm64 (Apple Silicon), 4 CPU et 6 Go **partagés** avec PostgreSQL, Redis,
Keycloak, ClamAV et SeaweedFS ; conteneur limité à 2 Go ; 2 threads d'inférence. Ces chiffres valent pour
cette machine et pour des factures synthétiques d'une trentaine de lignes courtes.

| Mesure | Valeur |
|---|---|
| Taille de l'image | 1,8 Go sur disque (414 Mo compressée) |
| Chargement des modèles au démarrage | 2,1 à 2,4 s |
| Mémoire au repos, juste après démarrage (`docker stats`) | 264 Mio |
| Mémoire après quelques OCR (régime établi, `docker stats`) | 750 à 980 Mio |
| Mémoire pendant l'OCR d'un PDF de 30 pages (`docker stats`) | 906 Mio |
| Pic mémoire du cgroup sur toute la série (dont un PNG de 34,8 Mpx) | 1 459 Mio |
| PNG A4 200 ppp (1654×2339), 32 lignes | 3,3 à 4,5 s |
| JPEG pivoté EXIF, même page | 3,4 s |
| PDF numérisé 3 pages | 8,8 s (2,9 s/page) |
| PDF vectoriel 2 pages (19 lignes/page) | 4,0 s (2,0 s/page) |
| JPEG 12,7 Mpx (3000×4243) | 3,2 s |
| PNG 34,8 Mpx (4960×7016, A4 à 600 ppp) | 3,6 s |
| PDF numérisé de 35 pages (30 traitées, 5 ignorées) | 126,6 s (4,2 s/page) |
| 8 requêtes simultanées | 5 × `200` (3,4 à 14,5 s), 3 × `429` immédiats |

Constats faits pendant la mise au point (à connaître avant de changer un réglage) :

- **`OCR_DETECTION_COTE_MAX`** : par défaut PP-OCRv6 détecte à la résolution d'origine ; sur une page A4 à
  200 ppp cela coûtait ~6 s et **1,77 Go en pointe**. Plafonné à 1536 px : ~3,4 s et ~1,0 Go, sans perte
  sur les factures synthétiques (y compris avec un texte de ~10 px de haut).
- **`OPENBLAS_NUM_THREADS=1`** (fixé dans l'image) : sans lui, avec 2 threads Paddle, une page prenait
  30 à 60 s (les threads d'OpenBLAS et de Paddle se disputent les cœurs).
- **`OCR_THREADS_CPU`** : 1 thread ≈ 4,5 s/page, 2 threads ≈ 3,2 à 3,9 s/page. **4 threads ont provoqué une
  erreur de segmentation de Paddle 3.4.0** (une fois, non investiguée) : ne pas dépasser 2 sans test.
- Les modèles « medium » (`PP-OCRv6_medium_*`) ont été essayés : 15 à 21 s/page et 1,5 Go en pointe sur
  cette machine, sans gain visible sur les factures synthétiques → non retenus.
- Le moteur ONNX Runtime de PaddleOCR (`engine="onnxruntime"`, modèles ONNX officiels) a été essayé :
  ~1,2 s/page avec les mêmes textes, mais mémoire de ~1,0 Go (1,9 Go sans plafond de détection) et il
  remplace PaddlePaddle. Non retenu ici ; piste sérieuse si le débit devient un problème.

## Limites connues

- **Pages pivotées sans EXIF** (numérisation à l'envers ou couchée) : le texte renvoyé est **faux**
  (aucun champ retrouvé lors de l'essai à 90° et à 180°), alors que le score le plus bas observé reste à 0,52 :
  le score ne permet pas de détecter ce cas de façon fiable.
  Le classifieur d'orientation de document de PaddleOCR (`use_doc_orientation_classify`) n'est pas
  embarqué. À traiter avant d'accepter des numérisations non contrôlées.
- **Pages inclinées** : à 3° et 10° tous les champs sont lus, mais à 10° l'ordre de lecture entre colonnes
  est perturbé (les boîtes sont des rectangles droits).
- **Espaces** : l'espacement autour de la ponctuation n'est pas toujours restitué (`N°F-2026-0042` pour
  `N° F-2026-0042`, `Date: …` pour `Date : …`). Comparer numéros et montants après suppression des blancs.
- **Pas de structure de tableau** : chaque cellule est une ligne indépendante ; l'association libellé ↔
  montant est à reconstruire à partir des boîtes.
- **PDF** : toujours rastérisés puis OCRisés, même s'ils contiennent une couche de texte (non exploitée).
  Les PDF protégés par mot de passe sont refusés (`422`).
- **Débit** : un document à la fois, ~3 à 4 s par page ici ; un PDF de 30 pages denses peut approcher le
  délai de 300 s.
- **Non testé** : photographies réelles prises au téléphone (perspective, ombres, papier froissé),
  manuscrit, tampons, tickets de caisse thermiques, documents réels de clients. Les résultats ci-dessus
  portent uniquement sur des factures synthétiques propres ou dégradées artificiellement (JPEG qualité 20,
  flou, bruit, faible contraste, 72 ppp : tous les champs lus).
- Paquets système Debian (`libgomp1`, `libgl1`, `libglib2.0-0`) installés sans version figée ; les paquets
  PyPI sont épinglés par version mais sans `--require-hashes`.

## Licences

Code de ce service : celui du dépôt Comtaple.

| Composant | Licence | Source |
|---|---|---|
| PaddleOCR 3.7.0, PaddleX 3.7.2 | Apache-2.0 | <https://github.com/PaddlePaddle/PaddleOCR>, <https://github.com/PaddlePaddle/PaddleX> |
| PaddlePaddle 3.4.0 | Apache-2.0 | <https://github.com/PaddlePaddle/Paddle> |
| Modèles `PP-OCRv6_small_det`, `PP-OCRv6_small_rec` | Apache-2.0 (d'après les fiches de modèle) | <https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det>, <https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec> ; archives téléchargées depuis `paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/` (liens de la documentation PaddleOCR 3.7) |
| pypdfium2 5.15.2 / PDFium | BSD-3-Clause ou Apache-2.0 (+ licences permissives des bibliothèques liées, fournies dans la roue) | <https://github.com/pypdfium2-team/pypdfium2> |
| FastAPI / Starlette / uvicorn | MIT / BSD-3-Clause / BSD-3-Clause | PyPI |
| Pillow | MIT-CMU | PyPI |
| NumPy | BSD-3-Clause | PyPI |
| opencv-contrib-python 4.10.0.84 | Apache-2.0 ; la roue embarque des bibliothèques tierces (dont FFmpeg et Qt, sous LGPL) | <https://github.com/opencv/opencv-python> |
| Python 3.12, Debian 12 | PSF-2.0 ; licences Debian | image `python:3.12.16-slim-bookworm` |

PyMuPDF (AGPL) a été écarté au profit de pypdfium2. Aucune dépendance installée ne déclare de licence GPL
ou AGPL. Dépendances transitives à copyleft faible, à faire valider : `crc32c` (LGPL-2.1+),
`python-bidi` (LGPL), `certifi` et `tqdm` (MPL-2.0), bibliothèques LGPL embarquées dans la roue OpenCV.
Les modèles n'ont pas de fichier de licence dans leur archive : la licence Apache-2.0 est celle indiquée
sur leurs fiches Hugging Face et celle du dépôt PaddleOCR.
