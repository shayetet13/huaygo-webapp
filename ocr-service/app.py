"""OCR microservice wrapping PaddleOCR-main for the HUAY GO LINE bet-slip pipeline.

Runs as a standalone long-lived process so the OCR model loads once at
startup instead of once per request (Node calls this over HTTP instead of
spawning Python per image — see backend/src/routes/line.routes.ts).
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="huay-go-ocr")
ocr = PaddleOCR(lang="th")


class OcrResponseLine:
    def __init__(self, text: str, score: float) -> None:
        self.text = text
        self.score = score

    def to_dict(self) -> dict[str, float | str]:
        return {"text": self.text, "score": self.score}


@app.post("/ocr")
async def run_ocr(file: UploadFile) -> dict[str, object]:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="empty file")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        results = ocr.predict(str(tmp_path))
        lines: list[OcrResponseLine] = []
        for result in results:
            texts = result.get("rec_texts", [])
            scores = result.get("rec_scores", [])
            for text, score in zip(texts, scores):
                lines.append(OcrResponseLine(text, float(score)))

        full_text = "\n".join(line.text for line in lines)
        avg_confidence = sum(line.score for line in lines) / len(lines) if lines else 0.0

        return {
            "text": full_text,
            "confidence": avg_confidence,
            "lines": [line.to_dict() for line in lines],
        }
    finally:
        tmp_path.unlink(missing_ok=True)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
