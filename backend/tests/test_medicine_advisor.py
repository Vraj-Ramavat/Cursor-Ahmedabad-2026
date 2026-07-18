"""Local formulary + text Rx parsing (sample Sai Ram Clinic slip brands)."""

from app.services.medicine_advisor import (
    alternatives_for,
    analyze_prescription_text,
    consult,
    find_medicines_in_blob,
    lookup_medicine,
)


SAMPLE_RX = """
T. Oprox-CV 200mg 1-0-1
T. Altrose-SP 1-1-1
T. Breezy 0-0-1
T. Shipen-D 40mg 1-0-1 (B/F)
Dehydration cold fever throat irritation
"""


def test_lookup_oprox():
    hit = lookup_medicine("Oprox-CV")
    assert hit is not None
    assert "Cefpodoxime" in hit["generic_name"]


def test_fuzzy_ocr_typos():
    assert lookup_medicine("Oprok CV") is not None
    assert lookup_medicine("Altroze SP") is not None
    assert lookup_medicine("Shipan D 40") is not None
    ids = {m["id"] for m in find_medicines_in_blob("oprok cv altroze breezi shipan d 40")}
    assert {"oprox_cv", "altrose_sp", "breezy", "shipen_d"} <= ids


def test_analyze_sample_prescription_text():
    out = analyze_prescription_text(SAMPLE_RX)
    ids = {m["id"] for m in out["medicines"]}
    assert "oprox_cv" in ids
    assert "altrose_sp" in ids
    assert "breezy" in ids
    assert "shipen_d" in ids
    assert len(out["medicines"]) >= 4


def test_alternatives_shipen():
    alt = alternatives_for("Shipen-D")
    assert alt["found"] is True
    names = [a["name"] for a in alt["medicine"]["alternatives"]]
    assert any("Omeprazole" in n for n in names)


def test_consult_dont_want():
    res = consult("Mujhe Oprox-CV nahi khani — alternative?", ["Oprox-CV"])
    assert "disclaimer" in res
    assert res["answer"]
    assert res.get("matched") is not None
