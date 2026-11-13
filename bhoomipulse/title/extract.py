"""M4 Title health, part 1: read a 7/12 or 8A extract.

Pipeline: PDF -> OCR (Tesseract, Gujarati pack) -> LLM extraction into
schemas/title_record.json with field-level confidence. A field the document
does not contain stays null. Needs requirements-full.txt, the `guj` Tesseract
language pack and ANTHROPIC_API_KEY. NOT exercised in the build environment:
no sample document was supplied and the Gujarati pack was not installed.
"""
from __future__ import annotations

import json
import os

from ..config import ROOT

FIELDS = ["survey_number", "village", "area_sqm", "owner_count", "encumbrances", "mutation_entries", "crop_entries"]
PROMPT = """You are reading OCR text of a Gujarat land record (7/12 or 8A extract), mostly in Gujarati.
Return JSON only, with exactly these keys: {fields}.
Each key maps to {{"value": ..., "confidence": 0-1}}. If the text does not contain a field, use null with confidence 0.
Do not guess. Do not output owner names: report only the number of owners in owner_count.
OCR text:
---
{text}
---"""


def empty(reason: str) -> dict:
    rec = {f: {"value": None, "confidence": 0.0} for f in FIELDS}
    rec["_status"] = reason
    return rec


def ocr_pdf(path: str, lang: str = "guj+eng") -> str:
    import pytesseract
    from pdf2image import convert_from_path

    return "\n".join(pytesseract.image_to_string(img, lang=lang) for img in convert_from_path(path, dpi=300))


def extract(path: str | None) -> dict:
    if not path or not os.path.exists(path):
        return empty("No land-record document supplied.")
    try:
        text = ocr_pdf(path)
    except Exception as e:
        return empty(f"OCR unavailable: {type(e).__name__}: {e}")
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return empty("OCR done, but no ANTHROPIC_API_KEY for extraction.")
    import anthropic

    msg = anthropic.Anthropic(api_key=key).messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens=1500,
        messages=[{"role": "user", "content": PROMPT.format(fields=", ".join(FIELDS), text=text[:20000])}])
    raw = msg.content[0].text
    rec = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
    rec = {f: rec.get(f, {"value": None, "confidence": 0.0}) for f in FIELDS}
    from jsonschema import validate

    validate(rec, json.loads((ROOT / "schemas" / "title_record.json").read_text()))
    rec["_status"] = "Extracted by OCR + LLM; verify against the original."
    return rec
