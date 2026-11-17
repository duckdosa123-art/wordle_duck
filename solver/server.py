"""WordleCup solver server.

POST /board with a full board snapshot:
    {"v": 1, "sentAt": 1700000000000,
     "rows": [{"word": "crane", "pattern": "20100"}, ...]}

Pattern digits: 2 = green (correct), 1 = yellow (elsewhere), 0 = gray (absent).
The server is stateless: every snapshot is scored from scratch, so lost or
duplicate requests self-heal on the next tile flip.

Run:  python solver/server.py        (serves http://127.0.0.1:5000)
"""
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Flask, jsonify, request

import entropy
import match
from words import load_words

HOST, PORT = "127.0.0.1", 5000

answers, guesses = load_words()
ANSWER_SET = set(answers)
app = Flask(__name__)


def validate_snapshot(payload):
    """Return ([(word, pattern), ...], error_or_None)."""
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None, 'payload must be {"v": 1, "rows": [...]}'
    rows = payload.get("rows")
    if not isinstance(rows, list) or len(rows) > 6:
        return None, "rows must be a list of at most 6 rows"
    clean = []
    for r in rows:
        if not isinstance(r, dict):
            return None, "each row must be an object"
        word = str(r.get("word", "")).lower()
        pattern = str(r.get("pattern", ""))
        if len(word) != 5 or not word.isalpha() or not word.isascii():
            return None, f"invalid word in row {r!r}"
        if len(pattern) != 5 or not set(pattern) <= set("012"):
            return None, f"invalid pattern in row {r!r}"
        clean.append((word, pattern))
    return clean, None


def solve(rows):
    """Filter candidates through every finished guess, then rank."""
    candidates, source = list(answers), "answers"
    for word, pattern in rows:
        nxt = [c for c in candidates if match.matches(c, word, pattern)]
        if not nxt and source == "answers":
            # the answer may be a word outside the curated answer list
            candidates, source = list(guesses), "guesses"
            nxt = [c for c in candidates if match.matches(c, word, pattern)]
        candidates = nxt
        if not candidates:
            break

    if not candidates:
        note = "no candidates match - double-check the snapshot"
        suggestions = []
    elif len(candidates) == 1:
        note = "solved!" if candidates[0] in ANSWER_SET else "single candidate (not in answer list)"
        suggestions = [{"word": candidates[0], "bits": 0.0, "is_answer": candidates[0] in ANSWER_SET}]
    else:
        note = "" if source == "answers" else "candidates from extended guess list"
        # When only a handful of candidates remain, suggest exactly those
        # (never pad with non-candidate words from the wider guess pool).
        if len(candidates) <= 5:
            suggestions = entropy.rank(candidates, candidates, ANSWER_SET, top=5)
        else:
            suggestions = entropy.rank(candidates, guesses, ANSWER_SET, top=5)
    return candidates, source, note, suggestions


@app.post("/board")
def board():
    rows, err = validate_snapshot(request.get_json(silent=True))
    if err:
        return jsonify({"v": 1, "error": err}), 400

    candidates, source, note, suggestions = solve(rows)

    print(f"[{time.strftime('%H:%M:%S')}] rows={len(rows)} "
          f"remaining={len(candidates)} source={source}"
          + (f" ({note})" if note else ""))
    for i, s in enumerate(suggestions, 1):
        tag = "answer" if s["is_answer"] else "guess "
        print(f"  {i}. {s['word']}  {s['bits']:.3f} bits  [{tag}]")

    return jsonify({
        "v": 1,
        "received_rows": rows,
        "remaining": len(candidates),
        "source": source,
        "note": note,
        "candidates_sample": candidates[:20],
        "suggestions": suggestions,
    })


@app.get("/health")
def health():
    return jsonify({"ok": True, "answers": len(answers), "guesses": len(guesses)})


if __name__ == "__main__":
    # warm the opener ranking (first full-board request) in the background
    threading.Thread(
        target=entropy.rank, args=(answers, guesses, ANSWER_SET), daemon=True
    ).start()
    print(f"solver server on http://{HOST}:{PORT}  "
          f"({len(answers)} answers, {len(guesses)} guesses)  POST /board")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
