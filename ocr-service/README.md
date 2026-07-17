# HUAY GO OCR Service

Small FastAPI wrapper around the `paddleocr` PyPI package, used by the LINE OA bet-slip pipeline (`backend/src/routes/line.routes.ts`) to read handwritten/printed bet-slip photos.

Runs as a **separate, persistent process** — the OCR model loads once at startup, so this must stay running rather than being started per-request.

## First-time setup

Requires Python 3.10+.

```
start-ocr.bat
```

The first run creates a venv and installs dependencies from `requirements.txt` (pinned to `paddleocr==3.7.0` / `paddlepaddle==3.0.0` — see the comment in that file for why). This also triggers PaddleOCR's one-time model download on first inference — expect the first `/ocr` call after starting to be slower than subsequent ones.

## Manual run (after first setup)

```
cd ocr-service
venv\Scripts\activate
uvicorn app:app --host 127.0.0.1 --port 8000
```

## Testing without the full LINE pipeline

```
curl -F "file=@sample-slip.jpg" http://localhost:8000/ocr
```

Try this with a few real sample bet-slip photos before relying on it — PaddleOCR's Thai-text accuracy on handwriting varies, and the `backend/src/lib/lineBetParser.ts` parser downstream needs to tolerate whatever it produces. The `lang="th"` model in `app.py` can be swapped if a different PaddleOCR model performs better on real samples.

## Config

The backend reads `OCR_SERVICE_URL` (default `http://localhost:8000`) from `backend/.env`. If this service is down, submissions still queue in the review UI with the photo attached and no OCR text — staff reads the photo manually. It is not a hard dependency for the backend to start.
