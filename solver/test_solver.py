import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import entropy
import match
from words import load_words


def test_pattern_speed_vs_erode():
    # SPEED gives ERODE: E yellow at 0, R/O gray, D yellow at 3, E yellow at 4
    assert match.pattern_for("erode", "speed") == "10011"
    assert match.matches("speed", "erode", "10011")
    assert not match.matches("speed", "erode", "10010")


def test_pattern_speed_secret():
    # ERODE gives SPEED: E green at 2, extra E yellow at 3, D yellow at 4
    assert match.pattern_for("speed", "erode") == "00111"
    assert match.matches("erode", "speed", "00111")


def test_gray_after_green():
    # GEESE vs THOSE: s and e green; g and the extra e's are gray, not yellow
    assert match.pattern_for("geese", "those") == "00022"
    assert match.matches("those", "geese", "00022")
    assert not match.matches("those", "geese", "10022")


def test_all_yellow_shift():
    # guess STATE vs secret TASTE: S,T,A all shifted one position right -> yellow
    assert match.pattern_for("state", "taste") == "11122"
    assert match.matches("taste", "state", "11122")
    assert not match.matches("taste", "state", "01122")


def test_gray_overconsumption():
    # secret METAL has one E, green under guess position 1; the other E's are gray
    assert match.pattern_for("eerie", "metal") == "02000"
    assert match.matches("metal", "eerie", "02000")
    assert not match.matches("metal", "eerie", "02100")


def test_filter():
    cands = ["those", "geese", "speed", "erode"]
    assert set(match.filter_candidates(cands, "geese", "00022")) == {"those"}


def test_invalid_pattern():
    assert not match.matches("crane", "crane", "22")     # wrong length
    assert not match.matches("crane", "crane", "22x22")  # bad digit


def test_numpy_engine_matches_reference():
    import numpy as np
    answers, guesses = load_words()
    pool = sorted(guesses)[:300]
    idx = entropy._pattern_indices(entropy._to_codes(pool), entropy._to_codes(answers))
    mismatches = 0
    for bi in range(0, len(pool), 41):
        for si in range(0, len(answers), 101):
            ref = int("".join(match.pattern_for(pool[bi], answers[si])), 3)
            mismatches += ref != idx[bi, si]
    assert mismatches == 0


def test_entropy_opener():
    answers, guesses = load_words()
    ranked = entropy.rank(answers, guesses, set(answers), top=1000)
    top = ranked[0]
    crane = next(s for s in ranked if s["word"] == "crane")
    # known optimum family: soare/roate ~5.88, crane ~5.74 on this 2,309-word list
    assert top["bits"] > 5.8, top
    assert crane["bits"] > 5.7, crane
    assert ranked.index(crane) < 50, crane
    print(f"opener: top={top['word']} {top['bits']:.3f} bits, crane={crane['bits']:.3f} bits")
