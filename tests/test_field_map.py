from __future__ import annotations

from microscopy_naming_assistant.field_map import _transform_magnification


def test_unit_anchored_magnification_from_full_objective_strings() -> None:
    assert _transform_magnification("HC PL APO 40x/0.95 DRY") == "X40"
    assert _transform_magnification("HC PL APO CS2 20x/0.75 DRY") == "X20"
    assert _transform_magnification("HC PL APO CS2 63x/1.40 OIL") == "X63"
    assert _transform_magnification("Plan-Apochromat 20x/0.8 M27") == "X20"


def test_bare_number_fallback_for_lif_and_ome_atomic_values() -> None:
    """LIF's atomic `Magnification` key is literally '40'; OME's
    `NominalMagnification` is '63' -- neither has a unit to anchor on, so the
    whole-string bare-number fallback is mandatory, not optional."""
    assert _transform_magnification("40") == "X40"
    assert _transform_magnification("63") == "X63"
    assert _transform_magnification("1.0") == "X1"


def test_non_positive_and_empty_values_return_none() -> None:
    assert _transform_magnification("0") is None
    assert _transform_magnification("") is None


def test_objective_string_never_yields_the_numerical_aperture_or_model_number() -> None:
    """The exact regression this rewrite fixes: taking the first digit run
    anywhere in 'HC PL APO CS2 63x/1.40 OIL' would grab '1' from the NA
    ('/1.40') if it were scanned last-to-first, or '2' from the 'CS2' model
    designation if scanned first-to-first (bug's actual historical shape).
    Neither may ever be the result -- only the unit-anchored '63x' may."""
    result = _transform_magnification("HC PL APO CS2 63x/1.40 OIL")
    assert result == "X63"
    assert result != "X1"
    assert result != "X2"
